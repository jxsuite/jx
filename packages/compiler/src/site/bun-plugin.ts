/**
 * Lets Bun import a `.jxn` document as the module it carries (spec.md §23.2), so a document's
 * functions can be unit tested where they are written.
 *
 * Importing this file registers the plugin. A project names it in `bunfig.toml`:
 *
 *     [test];
 *     preload = ["@jxsuite/compiler/bun-plugin"];
 *
 * After that `import { bump } from "./components/counter.jxn"` is the document's client module,
 * exactly as the build's bundler resolves the same import, and `./pages/index.jxn?server` is its
 * server module. The query is a test's spelling only: nothing a browser runs can import a server
 * module, and the build refuses one that tries.
 *
 * A module's own relative imports resolve from the document's directory, because the module is
 * loaded at the document's path.
 *
 * @docs framework/concepts/functions
 */

import { readFileSync } from "node:fs";
import type { BunPlugin } from "bun";
import type { ScriptSide } from "@jxsuite/schema/document-scripts";
import { parseNativeDocument } from "@jxsuite/schema/jxn";

/** What an import of a document's server module ends with. */
const SERVER_QUERY = "?server";

/** Matches an import of a `.jxn` document, with or without the server query. */
const JXN_MODULE = /\.jxn(?:\?server)?$/;

/**
 * The text of one of a document's modules.
 *
 * @param modulePath The document's absolute path, ending in `?server` for its server module.
 * @throws {Error} When the document carries no module for that side.
 */
export function documentModuleText(modulePath: string): string {
  const side: ScriptSide = modulePath.endsWith(SERVER_QUERY) ? "server" : "client";
  const documentPath = side === "server" ? modulePath.slice(0, -SERVER_QUERY.length) : modulePath;
  const text = parseNativeDocument(readFileSync(documentPath, "utf8"), documentPath).$script?.[
    side
  ];
  if (text === undefined) {
    throw new Error(`${documentPath} has no ${side} script, so there is nothing to import from it`);
  }
  return text;
}

/** The plugin itself, for a process that would rather register it than preload this file. */
export const documentScriptsPlugin: BunPlugin = {
  name: "jx-document-scripts",
  setup: (build) => {
    build.onLoad({ filter: JXN_MODULE }, ({ path }) => ({
      contents: documentModuleText(path),
      loader: "ts",
    }));
  },
};

void Bun.plugin(documentScriptsPlugin);
