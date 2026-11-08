/**
 * The field an entry is called by (`specs/studio.md` §22.5): one rule, read by everything that
 * names an entry, so the Content home, the entry editor, a file's records and the route-parameter
 * pickers all call an entry the same thing. A module of its own because the route-parameter pickers
 * read it from `page-params.ts`, which every page-bearing module imports, and the entry summaries
 * it used to live in import half of Studio.
 *
 * @docs studio/projects/browse
 */

import { isString } from "@jxsuite/schema/guards";
import type { EntryFields } from "./entry-fields";
import type { ContentTypeSchema } from "@jxsuite/schema/types";

/** Field names that mean "what this entry is called", in the order they are preferred. */
const TITLE_FIELD_NAMES = ["title", "name", "label", "heading"];

/**
 * The field an entry is called by: `title` where there is one, else the first conventionally named
 * field (`name`, `label`, `heading`) the schema declares or the entry holds. A menu item with a
 * `name` and no `title` is "Espresso Tiramisu", not `tiramisu`.
 */
export function titleFieldOf(
  schema: ContentTypeSchema | null | undefined,
  fields: EntryFields = {},
): string | null {
  // Whatever its capitalisation: a CSV's header row is often `Title`, and it is still the title.
  const named = (keys: readonly string[]): string | null => {
    for (const wanted of TITLE_FIELD_NAMES) {
      const key = keys.find((candidate) => candidate.toLowerCase() === wanted);
      if (key !== undefined) {
        return key;
      }
    }
    return null;
  };
  return (
    named(Object.keys(schema?.properties ?? {})) ??
    named(Object.keys(fields).filter((key) => isString(fields[key])))
  );
}
