/// <reference lib="dom" />
/**
 * Geometry read funnel — the single place the studio reads element bounds and does point hit-tests.
 *
 * Centralizing these reads is a seam for the iframe-canvas migration: today every call delegates
 * straight to the DOM, but routing them through one module lets later phases redirect
 * CANVAS-element geometry to rects posted out of the iframe (which the parent can't measure
 * directly) without touching dozens of call sites. A test (`geometry.test.ts`) asserts no raw
 * `getBoundingClientRect`/`elementFromPoint`/`elementsFromPoint` calls exist elsewhere in `src`.
 */

/**
 * Whether an element is `display: contents`, so it generates no box of its own (CSS Display §2.5).
 * Component hosts are the common case: the host steps aside and its rendered root does the layout.
 */
export function isDisplayContents(el: Element): boolean {
  return el.ownerDocument.defaultView?.getComputedStyle(el).display === "contents";
}

/**
 * Bounding rect of an element, in viewport coordinates.
 *
 * An element with no box (`display: contents`) answers a zero rect at the origin, which is useless
 * for drawing a selection or hover box around it. Its visible extent is what its contents render,
 * so it is measured as the union of its children's rects, each measured by this same rule. A Range
 * over the contents is NOT enough: CSSOM View takes a selected child's own client rects and skips
 * its descendants, so a component whose root is another `display: contents` component (a CTA
 * wrapping a section) measured as only the text runs that happened to sit directly inside it. The
 * style read happens only when the element's own rect is empty, so an ordinary element pays nothing
 * for it.
 */
export function rectOf(el: Element): DOMRect {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0 || !el.hasChildNodes() || !isDisplayContents(el)) {
    return rect;
  }
  let union: { bottom: number; left: number; right: number; top: number } | null = null;
  for (const child of el.childNodes) {
    let r: DOMRect | null = null;
    if (child instanceof Element) {
      r = rectOf(child);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(child);
      r = range.getBoundingClientRect();
    }
    if (!r || (r.width === 0 && r.height === 0)) {
      continue;
    }
    union = union
      ? {
          bottom: Math.max(union.bottom, r.bottom),
          left: Math.min(union.left, r.left),
          right: Math.max(union.right, r.right),
          top: Math.min(union.top, r.top),
        }
      : { bottom: r.bottom, left: r.left, right: r.right, top: r.top };
  }
  return union
    ? new DOMRect(union.left, union.top, union.right - union.left, union.bottom - union.top)
    : rect;
}

/**
 * Bounding rect of a Range, in viewport coordinates. Lives here (the one allowlisted home for
 * `getBoundingClientRect`) so the `geometry.test.ts` textual guard passes — the iframe-side
 * selection snapshot funnels its caret/selection geometry through this, never calling
 * `range.getBoundingClientRect()` directly.
 */
export function rectOfRange(r: Range): DOMRect {
  return r.getBoundingClientRect();
}

/** Topmost element at a viewport point, in `root` (defaults to the global document). */
export function elementAtPoint(
  x: number,
  y: number,
  root: Document | ShadowRoot = document,
): Element | null {
  return root.elementFromPoint(x, y);
}

/** All elements at a viewport point, front-to-back, in `root` (defaults to the global document). */
export function elementsAtPoint(
  x: number,
  y: number,
  root: Document | ShadowRoot = document,
): Element[] {
  return root.elementsFromPoint(x, y);
}
