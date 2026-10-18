/// <reference lib="dom" />
/**
 * A live preview's root: the shadow root an island shows a rendered document or component in (the
 * Site panel's component cards and the Content home's cards, `specs/studio.md` §5.7 and §9.1.2).
 *
 * A module of its own, apart from `library-preview.ts`, because what a preview IS (the render, the
 * cache, the visibility gate) and where it is SHOWN are separate questions, and the second is plain
 * DOM that every surface hosting a preview answers the same way.
 *
 * @docs studio/interface
 */

import { isFunction } from "@jxsuite/schema/guards";

/**
 * The one rule a preview needs that its box cannot give it from outside: an image whose prop
 * defaults to nothing draws a broken-image icon and its alt text, which in a thumbnail is noise,
 * not the component. Everything else about the box (its size, its scale, its light surface) is the
 * surface document's, on the island itself.
 */
const PREVIEW_RULES = 'img:not([src]), img[src=""] { visibility: hidden; }';

const _previewSheets = new WeakMap<Document, CSSStyleSheet>();

/** The preview rules as a sheet of `doc`'s own (a constructed sheet is adoptable only there). */
function previewSheetFor(doc: Document): CSSStyleSheet | null {
  const known = _previewSheets.get(doc);
  if (known) {
    return known;
  }
  const Sheet = doc.defaultView?.CSSStyleSheet;
  if (!isFunction(Sheet)) {
    return null;
  }
  const sheet = new Sheet();
  sheet.replaceSync(PREVIEW_RULES);
  _previewSheets.set(doc, sheet);
  return sheet;
}

/**
 * Show a rendered preview in its island, inside a shadow root of the island's own.
 *
 * **A preview is a page's part, rendered in Studio's window, and the shadow root is what keeps it a
 * guest there.** It used to be appended straight into the island, so a component's own ids joined
 * Studio's: Elite Equipment Rental's `<h2 id="equipment">` was the document's `#equipment`, an
 * `aria-labelledby` or a fragment link anywhere in the chrome could resolve to a thumbnail, and two
 * cards of one component made the id a duplicate. Ids, `getElementById` and Studio's linked
 * stylesheets all stop at the root's boundary; inherited properties (the island's text colour and
 * size) still cross it, which is what the light document surface relies on.
 *
 * The runtime's rules are not lost: the Jx runtime writes every element's style into sheets it
 * adopts on the document (`openSink` in `@jxsuite/runtime`), keyed on each element's `data-jx`
 * hash, and those sheets are adopted into the root too, so a component draws as it did. They are
 * read at each fill, so a sheet the runtime opened since the last one is included.
 *
 * @param slot The island the surface document drew empty.
 * @param rendered The preview, from `previewFor` (`library-preview.ts`).
 */
export function mountPreview(slot: HTMLElement, rendered: HTMLElement): void {
  const root = slot.shadowRoot ?? slot.attachShadow({ mode: "open" });
  const own = previewSheetFor(slot.ownerDocument);
  root.adoptedStyleSheets = [...slot.ownerDocument.adoptedStyleSheets, ...(own ? [own] : [])];
  root.replaceChildren(rendered);
}

/** The preview an island is showing, or null while it shows none. */
export function shownPreview(slot: Element): Element | null {
  return slot.shadowRoot?.firstElementChild ?? null;
}
