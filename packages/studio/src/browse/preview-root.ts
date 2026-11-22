/// <reference lib="dom" />
/**
 * A live preview's root: the shadow root an island shows a document or component the preview realm
 * drew (the Site panel's component cards and the Content home's cards, `specs/studio.md` §5.7 and
 * §9.1.2, `project-state.md` §11.2).
 *
 * A module of its own, apart from `library-preview.ts`, because what a preview IS (the render, the
 * cache, the visibility gate) and where it is SHOWN are separate questions, and the second is plain
 * DOM that every surface hosting a preview answers the same way.
 *
 * @docs studio/interface
 */

import { isFunction } from "@jxsuite/schema/guards";
import { PREVIEW_FALLBACK_CLASS } from "../preview-realm/protocol";
import type { PreviewSnapshot } from "../preview-realm/host";
import { projectPreviewSheets } from "./preview-style";

/**
 * The rules a preview needs that its box cannot give it from outside. An image with no source draws
 * a broken-image icon and its alt text, which in a thumbnail is noise. A COMPONENT preview never
 * reaches that rule (the realm fills such an image with the preview placeholder,
 * `canvas/preview-placeholder.ts`, whose `data:` source this selector does not match), so it hides
 * the empty images of DOCUMENT previews (the Content home's cards), which draw what the page wrote.
 * The realm's box for an element it cannot draw (`preview-realm/frame.ts`) names its tag in the dim
 * text the chrome uses. Everything else about the box (its size, its scale, its light surface) is
 * the surface document's, on the island itself, except its bound ({@link BOUND_RULES}).
 */
const PREVIEW_RULES = `img:not([src]), img[src=""] { visibility: hidden; }
.${PREVIEW_FALLBACK_CLASS} { padding: 12px; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--fg-dim); }`;

/**
 * **A preview is bounded by its island** (`studio.md` §9.1.2), and these are the rules that bound
 * it, in the island's own shadow root, which holds nothing else but the one element the preview's
 * root is attached to ({@link mountPreview}).
 *
 * The `:host` rule contains the island's layout, paint and style, so the island is the containing
 * block of everything the preview positions, `position: fixed` included, and nothing the preview
 * draws paints outside it. Without it a page's own fixed header (`position: fixed;
 * inset-block-start: 0`, the commonest navigation there is) is placed against Studio's viewport:
 * neither a shadow boundary nor `overflow: hidden` contains a fixed box, and the `zoom` the
 * surfaces scale an island by does not make it a containing block either (only `transform`,
 * `filter`, `contain` and their kin do), so a component card once drew its nav across the top of
 * the window, over the Command Bar. It is `!important` because an outer rule on a shadow host beats
 * `:host` unless the inner one is important (CSS Cascade 4 §6.1, "Context"), so no surface can
 * switch it off; and it is declared here, in the root every preview is mounted through, because a
 * bound one surface may forget is not a bound.
 *
 * **The bound is on an element no project rule can select.** The project's stylesheet reaches the
 * preview with its `:root`, `html` and `body` re-pointed at `:host` (`browse/preview-style.ts`),
 * and a document may carry a `<style>` of its own; were the preview's root the island's, a site's
 * `body { position: fixed; inset: 0 }` would move the island itself, which containment cannot hold
 * in place, and an authored `:host(:not(.x)) { contain: none !important }` would outrank the bound.
 * So the preview's root is attached to an element inside this one, and `:host` there is that
 * element, which the island contains whatever a project rule does to it. It fills the island as a
 * page's body fills its viewport, so a site's background covers the card unless the surface
 * declares its own on {@link PREVIEW_PART}.
 */
const BOUND_RULES = `:host { contain: layout paint style !important; }
div { display: block; min-block-size: 100%; }`;

/**
 * The part the element the preview's root is attached to exposes. A surface that draws its previews
 * on a surface of its own (the light document surface of the Site panel's and the palette's
 * component cards) declares it on `::part(preview)`: that rule is the outermost one on the element,
 * so it wins over what a project's root rules (re-pointed at its `:host`) declare there, as the
 * island's own rule did when the preview's root was the island's. A surface that declares nothing
 * there (the Content home's document cards) shows the page's own background, as it always did.
 */
export const PREVIEW_PART = "preview";

const _sheets = new WeakMap<Document, { bound: CSSStyleSheet; preview: CSSStyleSheet }>();

/**
 * The preview rules and the bound as sheets of `doc`'s own (a constructed sheet is adoptable only
 * there), made once per document and shared by every island; null where `doc` cannot make one.
 */
function sheetsFor(doc: Document): { bound: CSSStyleSheet; preview: CSSStyleSheet } | null {
  const known = _sheets.get(doc);
  if (known) {
    return known;
  }
  const Sheet = doc.defaultView?.CSSStyleSheet;
  if (!isFunction(Sheet)) {
    return null;
  }
  const bound = new Sheet();
  bound.replaceSync(BOUND_RULES);
  const preview = new Sheet();
  preview.replaceSync(PREVIEW_RULES);
  const sheets = { bound, preview };
  _sheets.set(doc, sheets);
  return sheets;
}

/** Elements that run, embed or redirect something: a preview is a picture, and needs none. */
const ACTIVE_ELEMENTS = "script, iframe, frame, frameset, object, embed, base, meta";
/** Attributes whose value is a URL a `javascript:` scheme would run. */
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "data",
  "formaction",
  "href",
  "ping",
  "poster",
  "src",
  "xlink:href",
]);

/** Whether `name="value"` would run script once the element is in Studio's window. */
function isActiveAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on") || lower === "srcdoc") {
    return true;
  }
  if (!URL_ATTRIBUTES.has(lower)) {
    return false;
  }
  // A URL parser drops ASCII whitespace and controls before the scheme, so they are dropped here too.
  const bare = [...value].filter((char) => (char.codePointAt(0) ?? 0) > 0x20).join("");
  return /^javascript:/iu.test(bare);
}

/**
 * Make a parsed snapshot inert: remove every element that runs, embeds or redirects something, and
 * every event-handler attribute, `srcdoc` and `javascript:` URL, in `scope`, in every shadow root
 * it holds and in every template's contents. The runtime writes a document's `attributes` verbatim,
 * so a page's `onerror` reaches the realm's markup; the realm is where a project's code runs, and
 * its snapshot is a picture.
 */
export function makeInert(scope: DocumentFragment): void {
  for (const element of scope.querySelectorAll(ACTIVE_ELEMENTS)) {
    element.remove();
  }
  for (const element of scope.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (isActiveAttribute(name, element.getAttribute(name) ?? "")) {
        element.removeAttribute(name);
      }
    }
    if (element.shadowRoot) {
      makeInert(element.shadowRoot);
    }
    if (element.localName === "template") {
      /* SAFETY: an element named `template` in an HTML document is an HTMLTemplateElement, whose
         contents are where a declarative shadow root this parser left unattached is. */
      makeInert((element as HTMLTemplateElement).content);
    }
  }
}

/**
 * The island's own root, holding the bound and the one element the preview's root is attached to:
 * that element is `inert`, so a preview's links and buttons are neither focusable nor named in any
 * surface that shows one, whether or not the surface marked its island.
 */
function attachPreviewRoot(slot: HTMLElement): ShadowRoot {
  const doc = slot.ownerDocument;
  const outer = slot.shadowRoot ?? slot.attachShadow({ mode: "open" });
  const sheets = sheetsFor(doc);
  outer.adoptedStyleSheets = sheets ? [sheets.bound] : [];
  const host = doc.createElement("div");
  host.setAttribute("part", PREVIEW_PART);
  host.inert = true;
  outer.replaceChildren(host);
  return host.attachShadow({ mode: "open" });
}

/** The root a preview of `slot` is shown in, or null while none was mounted there. */
export function previewRootOf(slot: Element): ShadowRoot | null {
  return slot.shadowRoot?.firstElementChild?.shadowRoot ?? null;
}

/** The snapshot each root shows. */
const _shown = new WeakMap<ShadowRoot, PreviewSnapshot>();
/** The roots each snapshot was mounted in, held weakly: a card that went is not kept for this. */
const _mounts = new WeakMap<PreviewSnapshot, Set<WeakRef<ShadowRoot>>>();

/**
 * Show a preview in its island, inside a shadow root of its own, held in the island's
 * ({@link BOUND_RULES} says why there are two).
 *
 * **A preview is a page's part, drawn in the preview realm and shown in Studio's window, and the
 * shadow root is what keeps it a guest here.** A component's own ids never join Studio's (two cards
 * of one component would make an id a duplicate, and an `aria-labelledby` in the chrome could
 * resolve to a thumbnail), and Studio's linked stylesheets stop at the root's boundary; inherited
 * properties (the island's text colour and size) still cross it, which is what the light document
 * surface relies on.
 *
 * The snapshot is the realm's markup (`preview-realm/frame.ts`), parsed first into a document with
 * no browsing context, where nothing loads or runs, and made inert there ({@link makeInert}) before
 * it is moved into the root: no element that runs or embeds something, no event-handler attribute,
 * no `srcdoc` and no `javascript:` URL reaches Studio's window. A project's custom elements are
 * names this window never defines, so none of them is upgraded here; a tag of the `@jxsuite/ui` kit
 * Studio is drawn with is, by Studio's own definition. The rules that draw it are adopted beside
 * it: the project's stylesheet first, then the rules the realm's runtime wrote, as a page orders
 * them, so a component's own rule wins over a site rule of equal specificity here as it does
 * there.
 *
 * @param slot The island the surface document drew empty.
 * @param snapshot The preview, from `previewFor` (`library-preview.ts`).
 */
export function mountPreview(slot: HTMLElement, snapshot: PreviewSnapshot): void {
  const root = previewRootOf(slot) ?? attachPreviewRoot(slot);
  const sheets = sheetsFor(slot.ownerDocument);
  root.adoptedStyleSheets = [
    ...projectPreviewSheets(),
    ...(snapshot.sheet ? [snapshot.sheet] : []),
    ...(sheets ? [sheets.preview] : []),
  ];
  const staging = slot.ownerDocument.implementation
    .createHTMLDocument("")
    .createElement("div")
    .attachShadow({ mode: "open" });
  staging.setHTMLUnsafe(snapshot.html);
  makeInert(staging);
  root.replaceChildren(...staging.childNodes);
  _shown.set(root, snapshot);
  let mounts = _mounts.get(snapshot);
  if (!mounts) {
    mounts = new Set();
    _mounts.set(snapshot, mounts);
  }
  mounts.add(new WeakRef(root));
}

/** The preview an island is showing, or null while it shows none. */
export function shownPreview(slot: Element): PreviewSnapshot | null {
  const root = previewRootOf(slot);
  return root ? (_shown.get(root) ?? null) : null;
}

/**
 * Take `snapshot` out of every island still showing it, leaving each box empty for the next paint
 * to fill: a cache that let it go (`library-preview.ts`) does so because what it drew is stale.
 */
export function unmountPreview(snapshot: PreviewSnapshot): void {
  for (const ref of _mounts.get(snapshot) ?? []) {
    const root = ref.deref();
    if (root && _shown.get(root) === snapshot) {
      root.replaceChildren();
      _shown.delete(root);
    }
  }
  _mounts.delete(snapshot);
}
