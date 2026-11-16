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
 * - Nested layouts contribute every level's `$head` to the layout layer, outermost first; no layout's
 *   `title` is the page's (§5.4)
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

/** One layout of a chain: the reference that named it, and the document the loader returned. */
export interface LayoutLevel {
  ref: string;
  doc: JxDocument;
}

/**
 * Why a chain of layouts could not be read: a layout reaches itself through `$layout`.
 *
 * The constructor is written out for the reason `ComposeError`'s comment in `compose.ts` gives: a
 * field initializer's synthesized constructor is never marked entered, and this workspace gates
 * functions at 1.0.
 */
export class LayoutCycleError extends Error {
  override readonly name: string;

  constructor(chain: readonly string[]) {
    super(`Layout cycle: ${chain.join(" → ")}`);
    this.name = "LayoutCycleError";
  }
}

/**
 * The layouts `layoutRef` wraps a page in, outermost first (site-architecture.md §5.4).
 *
 * Follows `layoutRef`, then each loaded document's `$layout` while it is a non-empty string, so
 * `"$layout": false` ends the chain. A reference that repeats is a cycle and throws
 * {@link LayoutCycleError} naming the chain; references are compared as authored, and a cycle
 * spelled two ways repeats an exact string within one more lap, because each file names a fixed
 * `$layout`.
 *
 * @param {string} layoutRef - The innermost layout, as its page named it
 * @param {LayoutLoader} load - Reads a layout document by its `$layout` reference
 * @returns {Promise<[LayoutLevel, ...LayoutLevel[]]>} Every level, each document as loaded
 */
export async function layoutLevels(
  layoutRef: string,
  load: LayoutLoader,
): Promise<[LayoutLevel, ...LayoutLevel[]]> {
  const seen: string[] = [];
  const levels: LayoutLevel[] = [];
  let ref: unknown = layoutRef;
  while (isString(ref) && ref !== "") {
    if (seen.includes(ref)) {
      throw new LayoutCycleError([...seen, ref]);
    }
    seen.push(ref);
    const doc = await load(ref);
    levels.unshift({ doc, ref });
    ref = isNonNullObject(doc) ? doc.$layout : undefined;
  }
  /* SAFETY: the loop body ran at least once, because `layoutRef` is a string the caller checked is
     non-empty, so `levels` is non-empty; TypeScript cannot see that through the loop. */
  return levels as [LayoutLevel, ...LayoutLevel[]];
}

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

  /* The chain is read once, outermost first, and the merge is the same one at every depth: each
     inner layout is wrapped into what the layouts outside it made, then the page into all of them. */
  const [outermost, ...inner] = await layoutLevels(layoutRef, load);
  const merged = deepClone(outermost.doc);

  for (const entry of inner) {
    const level = deepClone(entry.doc);
    wrapInto(merged, level);
    /* A layout's `$head` is the layout level of the head merge, whatever its depth, so each inner
       layout's entries follow the ones outside it. Only the page's own `$head` is `_pageHead`. */
    if (level.$head) {
      merged.$head = [...(merged.$head ?? []), ...level.$head];
    }
  }

  wrapInto(merged, pageDoc);

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
 * Wrap one document in the layout tree `merged` holds: its children fill the layout's slots, and
 * its `state`, `$media`, `style` and `attributes` extend the layout's, key by key. A page and every
 * inner layout take this same step, so a key added here applies at every level.
 *
 * @param {JxDocument} merged - The layout tree so far (mutated in place)
 * @param {JxDocument} inner - The page, or the layout nested in `merged`
 */
function wrapInto(merged: JxDocument, inner: JxDocument): void {
  // Distribute children into layout slots
  const rawChildren = inner.children ?? [];
  /* The declared type has no string form, but an authored page can still write `"children": "Hi"`
     and the parser does not reject it, so the bare string is kept as the one child it means. */
  const children: (JxElement | string)[] = isString(rawChildren)
    ? [rawChildren]
    : Array.isArray(rawChildren)
      ? rawChildren
      : [];

  distributeSlots(merged, children);

  // The inner document's state extends the layout's
  if (inner.state) {
    merged.state = { ...merged.state, ...inner.state };
  }

  // Its $media extends the layout's
  if (inner.$media) {
    merged.$media = { ...merged.$media, ...inner.$media };
  }

  // Its style extends the layout's
  if (inner.style) {
    merged.style = { ...merged.style, ...inner.style };
  }

  // Its attributes extend the layout's
  if (inner.attributes) {
    merged.attributes = { ...merged.attributes, ...inner.attributes };
  }
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
