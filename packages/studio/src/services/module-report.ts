/**
 * Advice about how the document an author is editing names its modules (`spec.md` §23.2).
 *
 * A third document report beside the popover and accessibility ones, and unlike both of them it
 * finds nothing wrong: a relative `$src` runs everywhere it ever did. What it says is that the file
 * could be the document's own script, so every record here is `info`, and none carries a repair.
 * Moving code between a file and a document is the author's to do, and a button that did half of it
 * would be worse than a sentence.
 *
 * The rules live in `@jxsuite/schema/document-scripts`, where `jx validate` reads them too, so the
 * Problems panel and the command line say the same thing about the same document.
 *
 * @docs studio/interface/problems-and-progress
 */
import { findScriptAdvice } from "@jxsuite/schema/document-scripts";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import { clearProblems, notify } from "./notify";
import type { NotifyOptions } from "./notify";

/** The `source` every record here files under, so a re-run clears exactly its own. */
export const MODULE_PROBLEM_SOURCE = "Modules";

/**
 * File the advice about `doc`'s modules as Problems, replacing whatever this source filed before.
 *
 * @param doc The document to read.
 * @param path The document's project-relative path, for the Problem's file column.
 * @returns How many records were filed.
 */
export function reportModuleAdvice(doc: JxDocument | JxElement, path?: string): number {
  clearProblems((record) => record.source === MODULE_PROBLEM_SOURCE);
  const advice = findScriptAdvice(doc);
  for (const entry of advice) {
    const options: NotifyOptions = {
      detail: entry.detail,
      // Rule and path: two entries importing one file are two records, not one that replaced one.
      key: `module.${entry.rule}.${entry.path.join("/")}`,
      source: MODULE_PROBLEM_SOURCE,
      tier: "problem",
    };
    if (path !== undefined) {
      options.path = path;
    }
    notify.info(entry.message, options);
  }
  return advice.length;
}
