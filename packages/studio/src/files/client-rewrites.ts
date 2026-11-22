/**
 * Client-rewrites.ts — the rewrites a rename carries for the documents its host cannot parse
 * (`project-state.md` §8.2, §9.1).
 *
 * A host whose graph is partial (the cloud's, which cannot run a project's parser code) can neither
 * find nor rewrite the references in a document it holds as unindexed, and refuses a rename that
 * does not carry them. Studio can: it has the project's formats loaded. So before a rename goes to
 * the host, Studio reads every document the store holds as `indexed: false`, parses it with the
 * format that claims it, rewrites its references with the same walk the hosts use (`rewriteDocRefs`
 * and `rewriteTagName` from `@jxsuite/protocol/refs`, `project-state.md` §12), and sends the bytes
 * it would write with the hash it read. A list with nothing in it asserts that Studio searched
 * every unindexed document and found no reference.
 *
 * A file no format parses is not a document (§9.1) and is skipped; a document Studio found
 * references in and has no serializer for is named in the report's `errors` instead, as the host
 * names one of its own.
 *
 * @license MIT
 * @docs studio/projects/pages-layouts-components
 */

import { rewriteDocRefs, rewriteTagName } from "@jxsuite/protocol/refs";
import { rewriteJson } from "@jxsuite/schema/json-layout";
import type { SerializableValue } from "@jxsuite/schema/json-layout";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ContentHash } from "@jxsuite/protocol/project-state";
import type { ContentStore } from "../project-state/store";
import type { FormatActionOptions, StudioFormat } from "../format/format-host";

/** One document's rewrite: what the operation sends, and what Studio applies to a dirty buffer. */
export interface ClientRewrite {
  /** The document's path before the move. */
  path: string;
  /** The hash of the bytes the rewrite was computed from. */
  baseHash: ContentHash;
  /** The rewritten bytes. */
  contents: string;
  /** Every reference value the rewrite replaced, with its replacement. */
  changes: { from: string; to: string }[];
  /** The component tag it renamed, when the renamed file is a component. */
  tag?: { from: string; to: string };
}

/** What Studio could rewrite, and the documents it could not write. */
export interface ClientRewritePlan {
  rewrites: ClientRewrite[];
  /** Each by its path after the move, as the host names its own. */
  errors: { path: string; error: string }[];
}

/** A document as Studio parses it for a rewrite: its tree, and how to write it back. */
export interface LoadedDocument {
  doc: JsonValue;
  /** Write the rewritten tree back to text; `null` for a format that cannot be written. */
  serialize: ((doc: JsonValue) => Promise<string>) | null;
}

/** What the planner reads through. */
export interface ClientRewriteDeps {
  /** The store whose unindexed documents are the ones to rewrite. */
  store: Pick<ContentStore, "contentsAt" | "docAt" | "documents">;
  /** A document's text, when the store does not hold it. */
  read: (path: string) => Promise<string>;
  /** Parse a document, or `null` when no format parses its path. */
  load: (path: string, text: string) => Promise<LoadedDocument | null>;
  /** The project-relative asset mounts that resolve a rooted reference in the document at `path`. */
  mounts: (path: string) => AssetMount[];
}

/** An absolute root for the walk's path arithmetic; only differences between paths matter. */
const WALK_ROOT = "/project";

/** Whether `path` is `dir` or lies under it. */
function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** Where `path` is once `from` has moved to `to`. */
function moved(path: string, from: string, to: string): string {
  return within(path, from) ? to + path.slice(from.length) : path;
}

function dirOf(abs: string): string {
  return abs.slice(0, abs.lastIndexOf("/"));
}

/** The tag a component file's name gives it, as the hosts derive it (`deriveTag`). */
export function tagForPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.endsWith(".class.json")) {
    return base.slice(0, -".class.json".length);
  }
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The document's text: the store's copy when it holds one, else a read. */
async function textOf(deps: ClientRewriteDeps, path: string): Promise<string> {
  const held = deps.store.contentsAt(path);
  return isString(held) ? held : deps.read(path);
}

/** The tag rename a component's move makes, when the renamed file is one (§9.1). */
async function tagRename(
  from: string,
  to: string,
  deps: ClientRewriteDeps,
): Promise<{ from: string; to: string } | undefined> {
  if (deps.store.docAt(from)?.isDir !== false) {
    return undefined;
  }
  let loaded: LoadedDocument | null;
  try {
    loaded = await deps.load(from, await textOf(deps, from));
  } catch {
    // Not a parseable document: no tag to derive.
    return undefined;
  }
  const tag = loaded !== null && isJsonObject(loaded.doc) ? loaded.doc.tagName : undefined;
  const next = tagForPath(to);
  return isString(tag) && tag.includes("-") && next.includes("-") && next !== tag
    ? { from: tag, to: next }
    : undefined;
}

/** How many documents the planner reads at once. */
export const CLIENT_REWRITE_READS = 8;

/**
 * The strings a document must contain to refer to what moves: the moved name without its extension
 * (a reference may omit it), as authored and as a URL encodes it, and the component's old tag. A
 * document that holds none of them is not parsed. Cheap, and never too strict: every reference to
 * `from` or beneath it names its last segment.
 */
function needlesOf(from: string, tag: { from: string } | undefined): string[] {
  const base = from.slice(from.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const needles = new Set([stem, encodeURIComponent(stem), encodeURI(stem)]);
  if (tag !== undefined) {
    needles.add(tag.from);
  }
  return [...needles];
}

/** Read every document of `paths`, at most {@link CLIENT_REWRITE_READS} at a time. */
async function readAll(
  deps: ClientRewriteDeps,
  paths: readonly string[],
): Promise<Map<string, { text: string } | { error: unknown }>> {
  const read = new Map<string, { text: string } | { error: unknown }>();
  const queue = [...paths];
  const reader = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        read.set(path, { text: await textOf(deps, path) });
      } catch (error) {
        read.set(path, { error });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CLIENT_REWRITE_READS, queue.length) }, () => reader()),
  );
  return read;
}

/**
 * Plan the rewrites a rename of `from` to `to` carries for the documents the store holds as
 * unindexed, or `null` when it holds none, so the rename carries no `rewrites` at all. The
 * documents are read a few at a time rather than one after another, since in the cloud each read is
 * a round trip, and only one that could name what moves is parsed.
 */
export async function planClientRewrites(
  from: string,
  to: string,
  deps: ClientRewriteDeps,
): Promise<ClientRewritePlan | null> {
  const unindexed = deps.store
    .documents()
    .filter((doc) => !doc.isDir && !doc.indexed)
    .map((doc) => doc.path)
    .toSorted();
  if (unindexed.length === 0) {
    return null;
  }
  const tag = await tagRename(from, to, deps);
  const needles = needlesOf(from, tag);
  const texts = await readAll(deps, unindexed);
  const plan: ClientRewritePlan = { errors: [], rewrites: [] };
  for (const path of unindexed) {
    try {
      const read = texts.get(path);
      if (read === undefined || "error" in read) {
        throw read?.error ?? new Error(`${path} was not read.`);
      }
      const { text } = read;
      // A document that moves has every relative reference of its own to rewrite, whatever it names.
      if (!within(path, from) && !needles.some((needle) => text.includes(needle))) {
        continue;
      }
      const loaded = await deps.load(path, text);
      if (loaded === null) {
        continue;
      }
      const { doc } = loaded;
      const docOldDir = dirOf(`${WALK_ROOT}/${path}`);
      const docNewDir = dirOf(`${WALK_ROOT}/${moved(path, from, to)}`);
      const { changes } = rewriteDocRefs(doc, {
        docNewDir,
        docOldDir,
        mounts: deps.mounts(path),
        newAbs: `${WALK_ROOT}/${to}`,
        oldAbs: `${WALK_ROOT}/${from}`,
        root: WALK_ROOT,
      });
      const tags = tag === undefined ? 0 : rewriteTagName(doc, tag.from, tag.to).count;
      if (changes.length === 0 && tags === 0) {
        continue;
      }
      if (loaded.serialize === null) {
        plan.errors.push({ error: "Its format cannot be written.", path: moved(path, from, to) });
        continue;
      }
      const rewrite: ClientRewrite = {
        baseHash: await contentHash(text),
        changes: changes.map((change) => ({ from: change.from, to: change.to })),
        contents: await loaded.serialize(doc),
        path,
      };
      if (tags > 0 && tag !== undefined) {
        rewrite.tag = { ...tag };
      }
      plan.rewrites.push(rewrite);
    } catch (error) {
      plan.errors.push({ error: errorMessage(error), path: moved(path, from, to) });
    }
  }
  return plan;
}

/** The formats Studio has loaded, as the default {@link ClientRewriteDeps.load} reaches them. */
export interface FormatAccess {
  loadFormats: () => Promise<StudioFormat[]>;
  formatForPath: (path: string) => StudioFormat | undefined;
  formatParse: (name: string, source: string) => Promise<JxMutableNode>;
  formatSerialize: (
    name: string,
    doc: JxMutableNode,
    options: FormatActionOptions,
  ) => Promise<string>;
}

/**
 * Parse a document the way Studio opens one: JSON as itself, written back over the text it was read
 * from so its layout survives, and every other document through the format that claims its path,
 * written back in round-trip mode over its source. `null` when no format parses it.
 */
export function loadWithFormats(formats: FormatAccess): ClientRewriteDeps["load"] {
  return async (path, text) => {
    if (/\.json$/i.test(path)) {
      return {
        // SAFETY: JSON.parse without a reviver only ever yields a JSON value.
        doc: JSON.parse(text) as JsonValue,
        // SAFETY: the document this just parsed, with reference strings replaced by strings.
        serialize: async (doc) => rewriteJson(doc as SerializableValue, text),
      };
    }
    await formats.loadFormats();
    const format = formats.formatForPath(path);
    if (format?.capabilities.parse === undefined) {
      return null;
    }
    const { name } = format;
    // SAFETY: a parsed document is a JSON tree (every Jx node member is JSON), walked as one.
    const doc = (await formats.formatParse(name, text)) as JsonValue;
    return {
      doc,
      serialize:
        format.capabilities.serialize === undefined
          ? null
          : // SAFETY: the tree the format parsed, with reference strings replaced by strings.
            (next) =>
              formats.formatSerialize(name, next as JxMutableNode, {
                mode: "roundtrip",
                source: text,
              }),
    };
  };
}
