import elementsMeta from "../../data/elements-meta.json";

import { elementName } from "../locale/element-names";
import { ELEMENT_DEFS } from "./editable-tags";
import type { SlashCommand } from "./inline-edit";

export type { SlashCommand } from "./inline-edit";

const groups: Readonly<Record<string, string[]>> = elementsMeta.$convertGroups;

/**
 * Get the list of tags the current element can be converted to.
 *
 * @param {string} currentTag
 * @param {boolean} isEmpty
 * @returns {SlashCommand[]}
 */
export function getConvertTargets(currentTag: string, isEmpty: boolean): SlashCommand[] {
  const def = ELEMENT_DEFS[currentTag];
  if (!def?.$convertTo) {
    return [];
  }

  const groupNames =
    isEmpty && def.$convertToWhenEmpty ? def.$convertToWhenEmpty : [def.$convertTo];

  const tags = new Set<string>();
  for (const name of groupNames) {
    for (const tag of groups[name] || []) {
      if (tag !== currentTag) {
        tags.add(tag);
      }
    }
  }

  return [...tags].map((tag) => ({
    description: "",
    label: elementName(tag),
    tag,
  }));
}
