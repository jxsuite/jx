import elementsMeta from "../../data/elements-meta.json";

import { ELEMENT_DEFS } from "./editable-tags";
import type { SlashCommand } from "./inline-edit";

export type { SlashCommand } from "./inline-edit";

const TAG_LABELS = new Map<string, string>([
  ["article", "Article"],
  ["aside", "Aside"],
  ["blockquote", "Blockquote"],
  ["div", "Div"],
  ["footer", "Footer"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["h4", "Heading 4"],
  ["h5", "Heading 5"],
  ["h6", "Heading 6"],
  ["header", "Header"],
  ["main", "Main"],
  ["nav", "Nav"],
  ["ol", "Numbered List"],
  ["p", "Paragraph"],
  ["search", "Search"],
  ["section", "Section"],
  ["ul", "Bulleted List"],
]);

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
    label: TAG_LABELS.get(tag) || tag.charAt(0).toUpperCase() + tag.slice(1),
    tag,
  }));
}
