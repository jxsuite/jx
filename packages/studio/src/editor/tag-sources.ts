/**
 * What a dynamic tag can read, as the Source picker offers it (studio.md §6.8, §6.9).
 *
 * Apart from `dynamic-tags.ts` because this half reads the Data panel's own list of state entries
 * (`buildMergeTags`), and the tag model is read by the command registry, which that list is built
 * on top of.
 *
 * @docs studio/editing/dynamic-tags
 */

import { dynamicTagPath, humanizeIdentifier, parseDynamicTag } from "@jxsuite/schema/dynamic-tag";
import { tagLabel } from "../utils/edit-display";
import { buildMergeTags } from "./merge-tags";
import { repeaterItemFields } from "./repeater-scope";

import type { JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";
import type { JxPath } from "../state";
import type { SourceGroup, SourceRow } from "./dynamic-tags";
import type { ScopeRecord } from "./merge-tags";

/** A path as words: `state.user.name` is "User › Name". */
function pathWords(token: string): string {
  const tag = parseDynamicTag(token);
  if (tag === null) {
    return token;
  }
  const names = dynamicTagPath(tag).steps.map((step) =>
    step.type === "member" ? step.name : String(step.key.value),
  );
  // An entry's `data` is a level of the path and not a word of its name, unless it is all there is.
  const words = names
    .filter((name, index) => name !== "data" || index === names.length - 1)
    .map((name) => humanizeIdentifier(name))
    .filter((name) => name !== "");
  return words.length > 0 ? words.join(" › ") : tagLabel(tag, null);
}

/** Give rows that share a label the value beside it, so no two read alike. */
function distinct(rows: SourceRow[]): SourceRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  }
  return rows.map((row) =>
    (counts.get(row.label) ?? 0) > 1 ? { ...row, label: `${row.label} (${row.value})` } : row,
  );
}

/**
 * What a tag at `path` can read (studio.md §6.8): inside a repeater the row's fields first, named
 * by their schema titles where they have one, then the document's state. The one walk every picker
 * reads (`repeaterItemFields`, `buildMergeTags`), so the popover offers what the Inspector offers.
 */
export function sourceGroups(
  doc: JxMutableNode,
  path: JxPath,
  config: ProjectConfig | null | undefined,
  scope: ScopeRecord | null,
): SourceGroup[] {
  const groups: SourceGroup[] = [];
  if (path.includes("map")) {
    // Fields that hold nodes are not listed unless asked for, and a text source is not that.
    const fields = repeaterItemFields(doc, path, config);
    groups.push({
      id: "row",
      label: "This row",
      rows: distinct([
        ...fields.map((field) => ({
          label: field.title ?? pathWords(field.token),
          value: field.token,
        })),
        { label: "Whole item", value: "item" },
        { label: "Row number", value: "index" },
      ]),
    });
  }
  const state = buildMergeTags(doc.state, scope, null);
  if (state.length > 0) {
    groups.push({
      id: "state",
      label: "Page data",
      rows: distinct(
        state.map((tag) => ({
          hint: scope === null ? "" : tag.hint,
          label: pathWords(tag.token),
          value: tag.token,
        })),
      ),
    });
  }
  return groups;
}
