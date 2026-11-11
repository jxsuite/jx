/**
 * A document's own server module, as a development host runs it (`spec.md` §23.2, `server.md`
 * §3.3).
 *
 * A `timing: "server"` entry may name the server script of the document it is written in, and that
 * script is text inside the document: there is no file for the host to import. So the host does for
 * one document what a build does for the site worker, with the build's own plugin. It bundles the
 * script from the place it stands beside its document, which is where its relative imports resolve
 * from, imports the bundle, and removes the file it imported.
 *
 * A script is imported once for as long as its text stays the same. An edited script is a different
 * module, so a document saved in an editing host answers with what it now says; a file the script
 * imports is read when the script is bundled, as any module a host imports is read once.
 *
 * @docs framework/concepts/functions
 */
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleEntry, useNodeFallback } from "@jxsuite/compiler/bundler";
import { documentScripts } from "@jxsuite/compiler/document-scripts";
import type { DocumentModule, DocumentScripts } from "@jxsuite/compiler/document-scripts";
import { parseScriptSpecifier, scriptSpecifier } from "@jxsuite/schema/document-scripts";

/** Matches the scheme of an address a browser reads a document from. */
const URL_SCHEME = /^(?:https?|file):/iu;

/** What a qualified `$src` on a server entry names, as a host can act on it. */
export type ServerScriptAddress =
  /** A document under the project, by its path from the project root. */
  | { kind: "path"; path: string }
  /** A document a browser read from a URL. Which file that is, is the host's to say. */
  | { kind: "url"; url: URL }
  /** Nothing a host can find, with the reason as a sentence. */
  | { kind: "refused"; reason: string };

/**
 * Read a `jx-script:` specifier a server entry carries.
 *
 * A document is named the way whoever read it knew it: by its project path when a build or a
 * composed page read it from the project, and by its URL when a browser fetched it (`spec.md`
 * §23.2). A document handed to the runtime as an object was never at either, so a host has nothing
 * to read its server script from.
 *
 * @param specifier The entry's `$src`, already known to be spelled `jx-script:…`.
 */
export function serverScriptAddress(specifier: string): ServerScriptAddress {
  const parsed = parseScriptSpecifier(specifier);
  if (parsed === null) {
    return { kind: "refused", reason: `$src "${specifier}" is not a document script specifier` };
  }
  if (parsed.side !== "server") {
    return {
      kind: "refused",
      reason: `$src "${specifier}" names a client script, which a server function cannot be in`,
    };
  }
  if (!URL_SCHEME.test(parsed.path)) {
    return { kind: "path", path: parsed.path };
  }
  if (!URL.canParse(parsed.path)) {
    return { kind: "refused", reason: `$src "${specifier}" names a document at no readable URL` };
  }
  const url = new URL(parsed.path);
  if (url.hash !== "") {
    return {
      kind: "refused",
      reason:
        `$src "${specifier}" names a document that was handed to the page as an object, so ` +
        `there is no file to read its server script from`,
    };
  }
  return { kind: "url", url };
}

/** A stable name for one document's script at one text. */
function scriptKey(modulePath: string, contents: string): string {
  return createHash("sha256")
    .update(modulePath)
    .update("\0")
    .update(contents)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Import a document's server module.
 *
 * @param documentPath Absolute path of the document. The caller has checked it may be read.
 * @param projectRoot The project root, which bare imports resolve from and messages are relative
 *   to.
 * @throws {Error} When the document cannot be read, carries no server script, uses TypeScript that
 *   has to be compiled, or its script does not bundle.
 */
export type ServerScriptImporter<T> = (documentPath: string, projectRoot: string) => Promise<T>;

/**
 * A host's importer of documents' server modules.
 *
 * @param importModule How the host imports a file, so a module is typed as that host reads one.
 */
export function serverScriptImporter<T>(
  importModule: (path: string) => Promise<T>,
): ServerScriptImporter<T> {
  /** Every server script imported so far, by its document and its text. */
  const imported = new Map<string, Promise<T>>();

  const bundled = async (
    scripts: DocumentScripts,
    module: DocumentModule,
    key: string,
  ): Promise<T> => {
    const outfile = join(tmpdir(), `jx-server-script-${process.pid}-${key}.mjs`);
    try {
      await bundleEntry(
        { contents: module.contents, entryPath: module.path, outfile },
        { plugins: [scripts.serverPlugin], target: useNodeFallback() ? "node" : "bun" },
      );
      return await importModule(outfile);
    } finally {
      // Imported or not, the file has done all it is for.
      rmSync(outfile, { force: true });
    }
  };

  return async (documentPath, projectRoot) => {
    // Read on every call: the text decides whether this is a module already imported.
    const scripts = documentScripts(projectRoot);
    const module = await scripts.module(scriptSpecifier(documentPath, "server"));
    const key = scriptKey(module.path, module.contents);

    let pending = imported.get(key);
    if (pending === undefined) {
      pending = bundled(scripts, module, key);
      imported.set(key, pending);
    }
    try {
      return await pending;
    } catch (error) {
      // A script that failed may be one whose import is being fixed: the next call tries again.
      if (imported.get(key) === pending) {
        imported.delete(key);
      }
      throw error;
    }
  };
}
