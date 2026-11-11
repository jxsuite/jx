/**
 * A document's own modules, as the build sees them (spec.md §23.2, compiler.md §12).
 *
 * A document carries its client and server modules as text in `$script`. To a bundler that text has
 * to be a module somewhere, because a module's relative imports are relative to where it stands. So
 * each one is given a place beside its document, in a file that is never written:
 *
 *     components/counter.jxn  →  components/counter.jxn.jx-client.ts
 *                                components/counter.jxn.jx-server.ts
 *
 * One plugin, in the shape both bundler backends accept, answers for those places. It resolves a
 * qualified specifier (`jx-script:components/counter.jxn#client`, which is how an entry names its
 * own document's module once the document is read) and an import of another `.jxn` document (that
 * document's client module), and it loads either from the document on disk. Nothing else in the
 * build knows that a module can live inside a document.
 *
 * @docs framework/concepts/functions
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { EraseError, eraseModule } from "@jxsuite/erase";
import { parseScriptSpecifier, qualifyScripts } from "@jxsuite/schema/document-scripts";
import type { ScriptSide } from "@jxsuite/schema/document-scripts";
import { parseNativeDocument } from "@jxsuite/schema/jxn";
import type { JxDocument } from "@jxsuite/schema/types";
import type { BundlePlugin, LoadedModule } from "./bundler-backend.ts";

/** What a document's path gains to name the place its client module stands. */
export const CLIENT_MODULE_SUFFIX = ".jx-client.ts";

/** What a document's path gains to name the place its server module stands. */
export const SERVER_MODULE_SUFFIX = ".jx-server.ts";

/** Matches the place of either module. */
const MODULE_PATH = /\.jx-(?:client|server)\.ts$/;

/** Matches a qualified script specifier. */
const SCRIPT_SPECIFIER = /^jx-script:/;

/** Matches an import of a `.jxn` document. */
const JXN_IMPORT = /\.jxn$/;

/** One of a document's modules: where it stands, and its text. */
export interface DocumentModule {
  /** Absolute path of the place the module stands. No file is there. */
  path: string;
  /** The module's TypeScript, as the document holds it. */
  contents: string;
}

/** What {@link documentScripts} hands a build. */
export interface DocumentScripts {
  /**
   * Resolves and loads documents' modules for a bundle a browser runs. Hand it to every such
   * bundle, because any module may import a `.jxn` document. It refuses a server module, so no
   * import, however it was spelled, can carry server text into a page.
   */
  clientPlugin: BundlePlugin;
  /** The same for the site worker's bundle, where a server module is what is being bundled. */
  serverPlugin: BundlePlugin;
  /**
   * The module a qualified specifier names, to bundle as an entry.
   *
   * @throws {Error} When the specifier is not a qualified one, the document cannot be read, or it
   *   carries no module for that side.
   */
  module: (specifier: string) => Promise<DocumentModule>;
}

/** Reads a document from an absolute path. A build passes one that knows its registered formats. */
export type DocumentReader = (path: string) => JxDocument | Promise<JxDocument>;

/** The place a document's module stands: the document's own path with the side's suffix. */
export function scriptModulePath(documentPath: string, side: ScriptSide): string {
  return `${documentPath}${side === "client" ? CLIENT_MODULE_SUFFIX : SERVER_MODULE_SUFFIX}`;
}

/** The document and side a module's place names, or `null` when the path is not such a place. */
export function scriptModuleOwner(
  modulePath: string,
): { documentPath: string; side: ScriptSide } | null {
  if (modulePath.endsWith(CLIENT_MODULE_SUFFIX)) {
    return { documentPath: modulePath.slice(0, -CLIENT_MODULE_SUFFIX.length), side: "client" };
  }
  if (modulePath.endsWith(SERVER_MODULE_SUFFIX)) {
    return { documentPath: modulePath.slice(0, -SERVER_MODULE_SUFFIX.length), side: "server" };
  }
  return null;
}

/**
 * A document as the build holds it: every `$src: "#client"` and `$src: "#server"` in it naming this
 * document by its project-relative path (spec.md §23.2).
 *
 * Applied wherever the build reads a document it may later merge with another, a page with its
 * layout above all, because the merged document no longer says which file an entry was written in.
 *
 * @param doc The document as read.
 * @param documentPath Absolute path it was read from.
 * @param projectRoot The project root its specifiers are relative to.
 */
export function qualifiedDocument<T extends JxDocument>(
  doc: T,
  documentPath: string,
  projectRoot: string,
): T {
  return qualifyScripts(doc, projectRelative(documentPath, projectRoot));
}

/** `path` from the project root, with `/` separators whatever the platform's own. */
function projectRelative(path: string, projectRoot: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

/** Read a `.json` or `.jxn` document, the two formats every build reads without an extension. */
function readNativeDocument(path: string): JxDocument {
  return parseNativeDocument(readFileSync(path, "utf8"), path);
}

/**
 * The build's view of every document's modules under one project root.
 *
 * A document is read once however many of its modules, or importers of them, a build bundles.
 *
 * @param projectRoot The project root qualified specifiers are relative to.
 * @param read How a document is read. Defaults to the two native formats.
 */
export function documentScripts(
  projectRoot: string,
  read: DocumentReader = readNativeDocument,
): DocumentScripts {
  const documents = new Map<string, Promise<JxDocument>>();
  const named = (path: string) => projectRelative(path, projectRoot);

  const documentAt = (path: string): Promise<JxDocument> => {
    let pending = documents.get(path);
    if (pending === undefined) {
      pending = (async () => read(path))();
      documents.set(path, pending);
    }
    return pending;
  };

  const scriptOf = async (documentPath: string, side: ScriptSide): Promise<string> => {
    let doc: JxDocument;
    try {
      doc = await documentAt(documentPath);
    } catch (error) {
      throw new Error(`Cannot read ${named(documentPath)} for its ${side} script`, {
        cause: error,
      });
    }
    const text = doc.$script?.[side];
    if (text === undefined) {
      throw new Error(
        `${named(documentPath)} has no ${side} script: nothing in it is $script.${side}, ` +
          `but something names its ${side} module`,
      );
    }
    /* What a browser's module loader would refuse, a build refuses (spec.md §23.2): the bundler
       compiles an `enum` without a word, and the same script would then run built and stop a page
       that interprets it. A server module is held to the one rule, so a script is one language. */
    const [refused, ...rest] = eraseModule(text).problems;
    if (refused !== undefined) {
      throw new EraseError({ path: named(documentPath), pointer: `/$script/${side}` }, [
        refused,
        ...rest,
      ]);
    }
    return text;
  };

  const placeOf = (specifier: string): { documentPath: string; side: ScriptSide } | null => {
    const parsed = parseScriptSpecifier(specifier);
    if (parsed === null) {
      return null;
    }
    return { documentPath: resolve(projectRoot, parsed.path), side: parsed.side };
  };

  const pluginFor = (bundle: ScriptSide): BundlePlugin => ({
    name: `jx-document-scripts-${bundle}`,
    setup: (build) => {
      build.onResolve({ filter: SCRIPT_SPECIFIER }, ({ path }) => {
        const place = placeOf(path);
        if (place === null) {
          // Not a specifier this build wrote: the bundler reports it as the import it cannot find.
          return;
        }
        if (place.side === "server" && bundle === "client") {
          throw new Error(
            `${named(place.documentPath)}: its server script cannot be imported by code a ` +
              `browser runs`,
          );
        }
        return { path: scriptModulePath(place.documentPath, place.side) };
      });
      // Importing a document means importing what it exports, and only its client module exports
      // To other modules: a server module is reached by a `timing: "server"` entry and nothing else.
      build.onResolve({ filter: JXN_IMPORT }, ({ importer, path }) => {
        if (isAbsolute(path)) {
          return { path: scriptModulePath(path, "client") };
        }
        // A bare specifier that happens to end in `.jxn` is the bundler's own to resolve.
        return path.startsWith("./") || path.startsWith("../")
          ? { path: scriptModulePath(resolve(dirname(importer), path), "client") }
          : undefined;
      });
      build.onLoad({ filter: MODULE_PATH }, async ({ path }): Promise<LoadedModule> => {
        /* SAFETY: the filter matched one of the two suffixes `scriptModuleOwner` reads, so the path
           has an owner. */
        const owner = scriptModuleOwner(path)!;
        return { contents: await scriptOf(owner.documentPath, owner.side), loader: "ts" };
      });
    },
  });

  const module = async (specifier: string): Promise<DocumentModule> => {
    const place = placeOf(specifier);
    if (place === null) {
      throw new Error(`"${specifier}" does not name a document's script`);
    }
    return {
      contents: await scriptOf(place.documentPath, place.side),
      path: scriptModulePath(place.documentPath, place.side),
    };
  };

  return { clientPlugin: pluginFor("client"), module, serverPlugin: pluginFor("server") };
}
