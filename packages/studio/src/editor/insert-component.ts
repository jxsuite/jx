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
import { mutateUpdateProperty } from "../tabs/transact";
import type { JxNodeValue } from "../tabs/transact";
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
 * This is a MUTATION: call it inside the transaction that inserts the instance, so the instance and
 * its import are one undo step. As a transaction of its own after the insert, the first ⌘Z took
 * back only the import and left a document using a component it no longer imported, which saves as
 * an instance the page cannot resolve.
 *
 * @param tab The document the node was inserted into, inside a `transactDoc`.
 * @param tagName The inserted node's tag.
 */
export function mutateImportComponent(tab: Tab, tagName: JxMutableNode["tagName"]): void {
  const after = elementsImporting(tab, tagName);
  if (after) {
    /* Through the recorded mutator, not a bare assignment: a transaction that records ops is
       undone by replaying their inverses, so an unrecorded write beside the insert would survive
       the ⌘Z that took the instance back, and never reach a co-editor.
       SAFETY: `$elements` entries are JSON — module specifiers, `{ $ref }` imports and inline
       element definitions — which is what a node key holds. */
    mutateUpdateProperty(tab, [], "$elements", after as JxNodeValue);
  }
}

/** The document's `$elements` with the component imported, or null when nothing would change. */
function elementsImporting(tab: Tab, tagName: JxMutableNode["tagName"]): ElementsEntry[] | null {
  if (!isString(tagName) || !tagName.includes("-")) {
    return null;
  }
  const comp = componentRegistry.find((entry) => entry.tagName === tagName);
  if (!comp) {
    return null;
  }
  /* SAFETY: `$elements` holds module specifiers and `{ $ref }` imports; the document type and
     files/elements.ts spell an inline entry as JxMutableNode and JxElement respectively, two editor
     views of the same JSON object that enableElement only compares by `$ref`. */
  const before = (tab.doc.document.$elements ?? []) as ElementsEntry[];
  const after = enableElement(before, comp, tab.documentPath ?? null);
  return after.length === before.length ? null : after;
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
 * package ({@link mutateImportComponent}), exactly as the canvas drop does.
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
