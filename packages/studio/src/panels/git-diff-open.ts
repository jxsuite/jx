/**
 * Which changed files have a comparison, and which half of one (studio.md §21.3, §22.8).
 *
 * Review changes draws every change it can in its centre, and these two answers decide how: a file
 * the canvas can draw gets both halves, Visual and Code; any other text file gets the Code half;
 * and a change no comparison can be built for is refused with a sentence the centre shows instead.
 * The Diff lens (`workspace/pane-derive.ts`) asks the same two questions.
 */

import { formatForPath } from "../format/format-host";
import { isViewableMedia } from "../media/media-open";

/** `.json` files that configure a project rather than being documents of it. */
const NON_DOCUMENT_JSON = new Set([
  "bunfig.json",
  "jsconfig.json",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "wrangler.json",
]);

/**
 * Whether this path has a visual half: a document the canvas can draw from its text.
 *
 * The same test `onFileClick` used to REFUSE on, inverted into a decision about which view to open
 * in. A file with no format class and no `.json` extension is not undiffable; it is un-renderable,
 * and its comparison belongs in the Code view.
 */
export function canRenderComparison(path: string): boolean {
  /* NOT EVERY `.json` IS A DOCUMENT, and the visual half is meaningless for the ones that are not.
     `package.json`, `tsconfig.json` and the generated schema files are all `.json` and none of them
     has a `tagName`; offered a Visual view they draw whatever the runtime makes of an object with
     no tag, and the change map reports every top-level key as "document settings changed" — which
     is how a dependency bump came to be described as a settings change. */
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (NON_DOCUMENT_JSON.has(name) || name.endsWith(".schema.json")) {
    return false;
  }
  return path.endsWith(".json") || Boolean(formatForPath(path));
}

/**
 * Why this file's change cannot be opened as a comparison, or null when it can.
 *
 * Two refusals, and both are stated rather than silent — the whole complaint this work answers was
 * a panel whose rows did nothing when clicked.
 *
 * - **A rename** carries only its new path in `GitFileStatus`, so the old name is not in hand and
 *   there is nothing to compare against. Shown as a whole-file rewrite it would be a lie.
 * - **A binary file** has no text on either side. `readFile` would hand Monaco bytes to render as
 *   mojibake, and the visual half cannot parse a PNG into a document either. An image comparison is
 *   a real feature and a different one; this is the boundary, said out loud.
 *
 * @param {string} path
 * @param {string} fileStatus
 * @returns {string | null}
 */
export function comparisonRefusal(path: string, fileStatus: string): string | null {
  /* ABOVE THE PROJECT ROOT. `git status` reports paths relative to the cwd, so a project nested in
     a larger repository legitimately lists files outside itself — `../bun.lock`, a sibling package.
     Those are real changes and the panel is right to show them, but a comparison cannot be built:
     the server refuses a `..` in a git path outright, which is a traversal guard worth keeping.
     Refused here by name, rather than as a failed read after the click. */
  if (path.startsWith("../") || path.includes("/../")) {
    return `"${path}" is outside this project, so its comparison belongs to the project that owns it.`;
  }
  if (fileStatus === "R") {
    return `A renamed file's comparison needs both paths, and Studio does not model the old name yet.`;
  }
  if (isViewableMedia(path)) {
    return `"${path}" is an image or media file, and a comparison of one is not text.`;
  }
  return null;
}
