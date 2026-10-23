/**
 * Layout resolution — $layout loading and slot distribution.
 *
 * Resolves $layout references, loads layout documents, and distributes page content into layout
 * <slot> elements. This is the compile-time equivalent of the runtime's distributeSlots()
 * algorithm.
 *
 * Per site-architecture spec §5:
 *
 * - Layouts are JSON files in the layouts/ directory
 * - Pages reference layouts via "$layout": "./layouts/base.json"
 * - The page's children are distributed into the layout's <slot> elements
 * - Named slots use attributes.slot on page children
 *
 * Reading is injected rather than imported. The rule "a page wrapped in its layout looks like THIS"
 * is the same rule whether the layout comes off a disk, out of a Durable Object's SQLite table, or
 * over `fetch` — and the two hosts that are not the compiler cannot import `node:fs` at all. So the
 * only thing this module asks for is a {@link LayoutLoader}, and everything else is pure.
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JxAttributeValue, JxDocument, JxElement, ProjectConfig } from "@jxsuite/schema/types";

/**
 * Read one layout document by the `$layout` reference that named it.
 *
 * The reference is project-relative as authored (`./layouts/base.json`); resolving it against
 * wherever the project actually lives is the host's job, because only the host knows.
 */
export type LayoutLoader = (layoutRef: string) => Promise<JxDocument> | JxDocument;

/**
 * Resolve a page's layout, wrapping the page content in the layout structure.
 *
 * @param {JxDocument} pageDoc - The raw page JSON document
 * @param {ProjectConfig} projectConfig - Site configuration (for defaults.layout)
 * @param {LayoutLoader} load - Reads a layout document by its `$layout` reference
 * @returns {Promise<JxDocument>} The merged document (layout wrapping page content)
 */
export async function resolveLayout(
  pageDoc: JxDocument,
  projectConfig: ProjectConfig,
  load: LayoutLoader,
): Promise<JxDocument> {
  // Determine which layout to use
  const layoutRef = pageDoc.$layout ?? projectConfig.defaults?.layout ?? null;

  if (!layoutRef) {
    // No layout — return page as-is
    return pageDoc;
  }

  let layoutDoc = await load(layoutRef);

  // Check for nested layouts (layout inheriting from another layout)
  if (layoutDoc.$layout) {
    layoutDoc = await resolveLayout(layoutDoc, projectConfig, load);
  }

  // Distribute page children into layout slots
  const rawChildren = pageDoc.children ?? [];
  /* The declared type has no string form, but an authored page can still write `"children": "Hi"`
     and the parser does not reject it, so the bare string is kept as the one child it means. */
  const pageChildren: (JxElement | string)[] = isString(rawChildren)
    ? [rawChildren]
    : Array.isArray(rawChildren)
      ? rawChildren
      : [];
  const merged = deepClone(layoutDoc);

  distributeSlots(merged, pageChildren);

  // Merge page-level properties onto the resolved document
  // Page state extends layout state
  if (pageDoc.state) {
    merged.state = { ...merged.state, ...pageDoc.state };
  }

  // Page $media extends layout $media
  if (pageDoc.$media) {
    merged.$media = { ...merged.$media, ...pageDoc.$media };
  }

  // Page style extends layout style
  if (pageDoc.style) {
    merged.style = { ...merged.style, ...pageDoc.style };
  }

  // Page attributes extend layout attributes
  if (pageDoc.attributes) {
    merged.attributes = { ...merged.attributes, ...pageDoc.attributes };
  }

  // Preserve page-level metadata
  if (pageDoc.$head) {
    merged._pageHead = pageDoc.$head;
  }
  if (pageDoc.title) {
    merged._pageTitle = pageDoc.title;
  }

  // Remove $layout from merged doc (already resolved)
  delete merged.$layout;

  return merged;
}

/**
 * Distribute children into <slot> elements within a layout document tree. This is the compile-time
 * equivalent of the runtime's distributeSlots().
 *
 * Algorithm:
 *
 * 1. Find all <slot> elements in the layout tree
 * 2. For each child with attributes.slot, distribute to the matching named slot
 * 3. Remaining children go into the default (unnamed) slot
 * 4. Replace each <slot> element with its distributed children
 *
 * @param {JxElement} node - Layout document tree (mutated in place)
 * @param {(JxElement | string)[]} children - Page children to distribute
 */
function distributeSlots(node: JxElement, children: (JxElement | string)[]) {
  /* Collect named and default children. A layout with no children array has no slots, and
     `fillSlots` returns before reading either collection, so collecting first changes nothing. */
  const named = new Map<JxAttributeValue, (JxElement | string)[]>(); // Slot name → children[]
  const defaults: (JxElement | string)[] = []; // Children without a slot target

  for (const child of children) {
    const slotName = isNonNullObject(child) ? child.attributes?.slot : undefined;
    if (slotName) {
      let bucket = named.get(slotName);
      if (!bucket) {
        bucket = [];
        named.set(slotName, bucket);
      }
      bucket.push(child);
    } else {
      defaults.push(child);
    }
  }

  // Walk the tree and replace <slot> elements
  fillSlots(node, named, defaults);
}

/**
 * Recursively walk the tree and replace <slot> elements with distributed content.
 *
 * @param {JxElement | string} node - A text child is passed through and ignored
 * @param {Map<JxAttributeValue, (JxElement | string)[]>} named
 * @param {(JxElement | string)[]} defaults
 */
function fillSlots(
  node: JxElement | string,
  named: Map<JxAttributeValue, (JxElement | string)[]>,
  defaults: (JxElement | string)[],
) {
  if (!isNonNullObject(node)) {
    return;
  }
  if (!Array.isArray(node.children)) {
    return;
  }

  const newChildren: (JxElement | string)[] = [];

  for (const child of node.children) {
    if (isNonNullObject(child) && child.tagName === "slot") {
      const slotName = child.attributes?.name;
      const slotted = slotName ? named.get(slotName) : undefined;

      if (slotName && slotted) {
        // Named slot — replace with matching children
        newChildren.push(...slotted);
        named.delete(slotName); // Consumed
      } else if (!slotName && defaults.length > 0) {
        // Default slot — replace with unassigned children
        newChildren.push(...defaults);
        // Don't clear defaults — only one default slot should exist,
        // But if there are multiple, the first one wins
      } else if (Array.isArray(child.children)) {
        // No matching content — keep slot's fallback children
        newChildren.push(...child.children);
      }
    } else {
      // Not a slot — recurse into it
      fillSlots(child, named, defaults);
      newChildren.push(child);
    }
  }

  node.children = newChildren;
}

/**
 * Deep clone a JSON-serializable object.
 *
 * @param {JxDocument} obj
 * @returns {JxDocument}
 */
function deepClone(obj: JxDocument) {
  return structuredClone(obj);
}
