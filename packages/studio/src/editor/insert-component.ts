/**
 * Inserting a component has one meaning everywhere (`specs/studio.md` §5.7, §9.1.3).
 *
 * A component instance is only a usable element in a document that imports it: the canvas drop did
 * that, and the Insert panel's click, the slash menu and the canvas `+` did not, so a component
 * clicked in rendered as an element the page could not resolve. This module is the one rule the
 * four doors share — the instance comes from `buildComponentInstance`, and the import from the one
 * `$elements` service, `files/elements.ts`'s `enableElement`.
 *
 * @docs studio/design/components
 */

import { isString } from "@jxsuite/schema/guards";
import { buildComponentInstance, componentRegistry } from "../files/components";
import { enableElement } from "../files/elements";
import { transact } from "../tabs/transact";
import type { ElementsEntry } from "../files/elements";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import type { SlashCommand } from "./inline-edit";

/** The slash menu's group heading for the project's components. */
export const COMPONENTS_GROUP = "Components";

/**
 * Import the component a node is an instance of into `tab`'s document, when it is one and is not
 * imported yet. A node whose tag has no hyphen is an HTML element and is left alone, and a
 * component the registry cannot name (an npm entry with no package, a local one with no path)
 * changes nothing, so a document that had no `$elements` is not handed an empty one.
 *
 * A computed tag (`{ $expression }`) names no registered component, so it is left alone too.
 *
 * @param tab The document the node was inserted into.
 * @param tagName The inserted node's tag.
 */
export function importComponentInto(tab: Tab, tagName: JxMutableNode["tagName"]): void {
  if (!isString(tagName) || !tagName.includes("-")) {
    return;
  }
  const comp = componentRegistry.find((entry) => entry.tagName === tagName);
  if (!comp) {
    return;
  }
  /* SAFETY: `$elements` holds module specifiers and `{ $ref }` imports; the document type and
     files/elements.ts spell an inline entry as JxMutableNode and JxElement respectively, two editor
     views of the same JSON object that enableElement only compares by `$ref`. */
  const before = (tab.doc.document.$elements ?? []) as ElementsEntry[];
  const after = enableElement(before, comp, tab.documentPath ?? null);
  if (after.length !== before.length) {
    transact(tab, (doc: JxMutableNode) => {
      doc.$elements = after;
    });
  }
}

/** A fresh instance of a registered component, or null for a tag the registry does not know. */
export function componentInstance(tagName: string): JxMutableNode | null {
  const comp = componentRegistry.find((entry) => entry.tagName === tagName);
  return comp ? buildComponentInstance(comp) : null;
}

/**
 * Every registered component as a slash-menu offer, under the Components heading: the project's
 * own, described by their definition file, and the ones installed packages provide, described by
 * their package. A package component needs no prior enabling, because inserting one imports its
 * package ({@link importComponentInto}), exactly as the canvas drop does.
 */
export function componentSlashCommands(): SlashCommand[] {
  return componentRegistry.map((comp) => ({
    component: true,
    description: (comp.source === "npm" ? comp.package : comp.path) ?? "",
    group: COMPONENTS_GROUP,
    label: `<${comp.tagName}>`,
    tag: comp.tagName,
  }));
}
