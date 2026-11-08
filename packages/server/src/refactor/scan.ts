/**
 * Scan.ts — the project document sweep the refactor engines share.
 *
 * `applyRename` (write pass) and `findReferences` (read pass) walk exactly the same file set: every
 * JSON document plus every extension the project's format registry claims, minus the vendored /
 * build / agent directories. Keeping one definition of "the project's documents" is the point — a
 * rename that rewrites a file the usage count never looked at is a lie in both directions.
 */

import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import type { FormatRegistry, ValueEdit } from "@jxsuite/schema/format-registry";
import { isJsonObject } from "@jxsuite/schema/guards";
import { rewriteJson } from "@jxsuite/schema/json-layout";
import {
  classifyJxn,
  isJxnPath,
  parseJxn,
  parseProject,
  serializeJxn,
  serializeProject,
} from "@jxsuite/schema/jxn";
import type { JsonValue, JxDocument, ProjectConfig } from "@jxsuite/schema/types";

/** Normalise a path to forward slashes (Windows `path` returns backslashes). */
export const fwd = (p: string) => p.replaceAll("\\", "/");

/** A parsed document and the two ways it might be written back. */
export interface LoadedDoc {
  doc: JsonValue;
  /** Round-trips the whole document. Null when the format declares no `serialize`. */
  serialize: ((doc: JsonValue) => Promise<string>) | null;
  /**
   * Replaces authored values in the file's own bytes, changing nothing else. Null when the format
   * declares no `rewrite`.
   *
   * The narrower of the two, and the only one a load-only format can offer: a CSV collection is a
   * data source entries are read FROM, so there is no document to serialize — but one cell's text
   * can be changed without inventing a quoting style. `applyRename` prefers `serialize` where it
   * exists, because a full round trip can express a change (a tag rename) that a list of value
   * edits cannot.
   */
  rewrite: ((edits: readonly ValueEdit[]) => Promise<string>) | null;
}

const isJsonPath = (p: string) => p.endsWith(".json");

/**
 * Skip vendored / build / agent directories (mirrors the component-discovery filter), and generated
 * schema artifacts.
 *
 * Every committed `*.schema.json` in a project is a build output — `bun run schema:generate-all`
 * composes the `project.schema.json` / `document.schema.json` pair into each project root — and the
 * generators embed live `examples` blocks. `project.core.schema.json`'s `$head` example carries
 * `/favicon.svg`, and the per-project entry schema enumerates the project's own layouts, so a sweep
 * that reads them makes every project report its own schema as a referrer of its favicon and its
 * base layout. Those are not references anyone authored, and nobody should be told a rename will
 * break one.
 *
 * The stale-schema problem a skipped file leaves behind already has an owner: `bun run
 * schema:verify` catches it and `schema:sync` regenerates it. A rewrite here would be a second
 * writer on a generated file.
 */
export function skipScanPath(match: string): boolean {
  const f = fwd(match);
  return (
    match.includes("node_modules") ||
    f.includes("dist/") ||
    f.includes(".claude/") ||
    f.endsWith(".schema.json")
  );
}

/** The recursive glob pattern covering JSON plus every registered document/content extension. */
export function documentGlob(registry: FormatRegistry): string {
  const exts = new Set(["json"]);
  for (const ext of registry.documentExtensions()) {
    exts.add(ext.replace(/^\./, ""));
  }
  return `**/*.{${[...exts].join(",")}}`;
}

/**
 * Read + parse a file, returning the doc and whichever write-back paths the format declares. Throws
 * when no parser claims the extension.
 */
export async function loadDoc(fp: string, registry: FormatRegistry): Promise<LoadedDoc> {
  const raw = await readFile(fp, "utf8");
  if (isJsonPath(fp)) {
    return {
      // SAFETY: JSON.parse without a reviver only ever yields a JSON value; its `any` says no more.
      doc: JSON.parse(raw) as JsonValue,
      rewrite: null,
      // Over the text it replaces, so a rename changes the references and not the formatting.
      serialize: (doc) => Promise.resolve(rewriteJson(doc, raw)),
    };
  }
  if (basename(fp) === "project.jxn" && classifyJxn(raw) === "project") {
    /* The project file, in its own grammar (`site-architecture.md` §2.3): a rename repairs the
       references it holds, `defaults.layout` among them, and the merge keeps its comments. A page
       named `project.jxn` declares no project, and is read as the document it is below. */
    const config: unknown = parseProject(raw, fp);
    return {
      doc: isJsonObject(config) ? config : null,
      rewrite: null,
      // SAFETY: the configuration this just read, with reference values replaced by reference values.
      serialize: (doc) => Promise.resolve(serializeProject(doc as ProjectConfig, raw)),
    };
  }
  if (isJxnPath(fp)) {
    /* The one format whose writer can be told what it is replacing, so repairing a reference in a
       `.jxn` file changes that reference and leaves its comments where they were. */
    const document = parseJxn(raw);
    return {
      doc: isJsonObject(document) ? document : null,
      rewrite: null,
      // SAFETY: the document this just read, with reference values replaced by reference values.
      serialize: (doc) => Promise.resolve(serializeJxn(doc as JxDocument, raw)),
    };
  }
  const ext = extname(fp);
  const parseEntry = registry.byExtension(ext, "parse");
  if (!parseEntry) {
    throw new Error(`No parser for "${ext}"`);
  }
  /* SAFETY: read as a JSON tree. A `parse` answer is a JxDocument or a ContentLoaderEntry[]
     (specs/extensions.md §8), both JSON trees but for leaves such as a frontmatter Date. Every walk
     over it in refs.ts re-checks each node with Array.isArray / isJsonObject / isString before
     reading it, so such a leaf is skipped rather than misread. */
  const doc = (await parseEntry.call("parse", raw)) as JsonValue;
  const serializeEntry = registry.byExtension(ext, "serialize");
  const rewriteEntry = registry.byExtension(ext, "rewrite");
  return {
    doc,
    rewrite: rewriteEntry
      ? async (edits) => String(await rewriteEntry.call("rewrite", raw, edits))
      : null,
    serialize: serializeEntry
      ? async (d) => String(await serializeEntry.call("serialize", d))
      : null,
  };
}
