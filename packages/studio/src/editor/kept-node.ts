/// <reference lib="dom" />
/**
 * What an inline element of a block holds that the canvas cannot be read back for (studio.md §4.5).
 *
 * A commit rebuilds a block's content from the canvas: text nodes, chips, and the elements between
 * them. An element's CONTENT is on the canvas to be read. Everything else it holds is not: the
 * canvas shows a bound `href` as the URL it resolves to, a `class` and a `style` as what they look
 * like, an event handler as nothing at all. Rebuilt from what is drawn, a link bound to
 * `${state.url}` came back holding today's URL, so every commit of the paragraph around it was
 * refused for losing a binding nobody touched, and a `<span>` with a class came back a bare span.
 *
 * So the frame stamps on each such element what its document node holds besides content, verbatim,
 * and the serializer writes that back instead of reading attributes off the DOM
 * (`editor/inline-edit.ts`). An element closed to the caret (a component instance, an inline whose
 * content is a value) has no content the author can have edited, so it carries its node WHOLE and
 * is written back as exactly that.
 *
 * The stamp travels with the element: split a link with Enter and both halves keep the link's
 * `href`; a new `<strong>` the author made carries none and is read off the canvas.
 *
 * @docs studio/editing/writing
 */

import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import { parseJxPath } from "../canvas/path-mapping";
import { isClosedContent, slotBindingKeys } from "../utils/edit-display";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** The attribute an inline element carries {@link keptJson} in. */
export const KEEP_ATTR = "data-jx-keep";

/**
 * The keys that are an element's tag and content, which the canvas is read back for. `innerHTML` is
 * one of them wherever the element is open to the caret at all: markup a commit could not write
 * back closes its element (`isClosedContent`), which then carries its node whole.
 */
const CONTENT_KEYS = new Set(["tagName", "textContent", "children", "innerHTML"]);

/** Whether `node` is drawn closed to the caret: a component instance, or content that is a value. */
function isClosedNode(node: JxMutableNode): boolean {
  return (isString(node.tagName) && node.tagName.includes("-")) || isClosedContent(node);
}

/**
 * What the element drawn for `node` must carry, as JSON, or null when there is nothing to carry:
 * the whole node when it is closed to the caret, else every key but its tag and content.
 */
export function keptJson(node: JxMutableNode): string | null {
  if (isClosedNode(node)) {
    return JSON.stringify(node);
  }
  const rest = Object.entries(node).filter(([key]) => !CONTENT_KEYS.has(key));
  return rest.length === 0 ? null : JSON.stringify(Object.fromEntries(rest));
}

/**
 * Stamp {@link KEEP_ATTR} on `root` and on every element under it that is drawn for a node of `doc`
 * and whose parent can hold a caret (`holdsCaret`), which is every element a commit of that parent
 * would rebuild. An element whose node holds nothing to keep has the attribute taken off, so a
 * stamp never outlives the keys it carried.
 */
export function stampKept(
  root: Element,
  doc: JxMutableNode,
  holdsCaret: (parent: HTMLElement) => boolean,
): void {
  const stamped = root.querySelectorAll<HTMLElement>("[data-jx-path]");
  for (const el of root instanceof HTMLElement ? [root, ...stamped] : stamped) {
    const raw = el.dataset.jxPath;
    const parent = el.parentElement;
    if (raw === undefined || !parent || !holdsCaret(parent)) {
      continue;
    }
    const node = getNodeAtPath(doc, parseJxPath(raw));
    const json = isNodeObject(node) ? keptJson(node) : null;
    if (json === null) {
      el.removeAttribute(KEEP_ATTR);
    } else {
      el.setAttribute(KEEP_ATTR, json);
    }
  }
}

/** What `el` carries from its document node ({@link keptJson}), or null when it carries nothing. */
export function keptNodeOf(el: Element): JxMutableNode | null {
  const raw = el.getAttribute(KEEP_ATTR);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isNodeObject(parsed) ? parsed : null;
  } catch {
    // Not what the frame stamped: the element is read off the canvas instead.
    return null;
  }
}

/**
 * What the bindings `el` carries outside its content are counted as by the commit guard
 * (`slotBindingKeys`): those of one attribute, or with no `attribute` named, of every key. The
 * frame reports these when the author replaces or removes what held them, since a commit may drop a
 * binding only when it was told the author did (`editor/inline-edit-apply.ts`).
 */
export function keptBindingKeys(el: Element, attribute?: string): string[] {
  const kept = keptNodeOf(el);
  if (!kept) {
    return [];
  }
  if (attribute !== undefined) {
    return slotBindingKeys(kept.attributes?.[attribute], `attributes/${attribute}`);
  }
  return Object.entries(kept)
    .filter(([key]) => !CONTENT_KEYS.has(key))
    .flatMap(([key, value]) => slotBindingKeys(value, key));
}

/**
 * Drop one attribute from what `el` carries, because the author has just set it on the canvas: a
 * link's URL changed in the link popover is the canvas's to say from then on.
 */
export function forgetKeptAttribute(el: Element, name: string): void {
  const kept = keptNodeOf(el);
  const attributes = kept?.attributes;
  if (!kept || !attributes || !(name in attributes)) {
    return;
  }
  const { [name]: _dropped, ...rest } = attributes;
  const { attributes: _attributes, ...others } = kept;
  const next: JxMutableNode =
    Object.keys(rest).length > 0 ? { ...others, attributes: rest } : others;
  if (Object.keys(next).length === 0) {
    el.removeAttribute(KEEP_ATTR);
  } else {
    el.setAttribute(KEEP_ATTR, JSON.stringify(next));
  }
}
