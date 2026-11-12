/**
 * The VS Code extension for Jx Notation: what the editor starts when a `.jxn` file is first opened.
 *
 * The manifest contributes the language and its grammar, which need no code. This adds the two
 * things that do: completion from a project's schemas (`spec.md` §22.6), and type checking through
 * TypeScript's own language server (`spec.md` §23.3).
 *
 * @docs framework/concepts/jxn-files
 */
import { window } from "vscode";
import type { ExtensionContext } from "vscode";

import { registerJxnCompletion } from "./completion.ts";
import { registerContentMapper } from "./content-mapper.ts";
import { schemasFor } from "./schemas.ts";

/**
 * Start the extension.
 *
 * @param context What VS Code gives an extension: where it is installed, and the list of what to
 *   take away when it stops.
 */
export function activate(context: ExtensionContext): void {
  const log = window.createOutputChannel("Jx Suite", { log: true });
  context.subscriptions.push(
    log,
    registerJxnCompletion(schemasFor),
    registerContentMapper(context.extensionPath, (message) => {
      log.warn(message);
    }),
  );
}
