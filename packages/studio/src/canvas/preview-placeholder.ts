/// <reference lib="dom" />
/**
 * A stand-in picture for an image a component preview has no source for.
 *
 * Component previews draw a definition with only its own declared `examples` (`browse/
 * component-examples.ts`), never with data borrowed from the project. A card component whose image
 * prop defaults to `""` therefore drew a broken-image glyph — or, worse, an `<img src="">`, which
 * resolves to the document's own url and fails as an image. Previews show the component's SHAPE, so
 * an empty image is drawn as a neutral placeholder of a typical photo's proportions instead.
 *
 * Used by the two surfaces that draw components on their own: the parent-realm previews
 * (`panels/component-preview.ts`: the Library, the Site panel's component cards, the palette) and
 * the Stylebook's specimen render in the canvas frame (`canvas/iframe-render.ts`). Never the page
 * canvas: an empty image on a page is something its author should see.
 *
 * Plain DOM with no realm-specific imports, so the frame and the editor share one definition.
 */

/**
 * A neutral landscape glyph: the canvas's one structural gray (`#808080`, as `STYLEBOOK_CSS` uses
 * it) at low opacity, so it reads as a quiet tint on a light card and a dark one alike. A `data:`
 * image is a document of its own, which no theme token or custom property can reach into.
 */
export const PREVIEW_IMAGE_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">' +
    '<rect width="320" height="180" fill="#808080" fill-opacity="0.16"/>' +
    '<g fill="#808080" fill-opacity="0.38">' +
    '<circle cx="118" cy="64" r="14"/>' +
    '<path d="M60 140l52-50 34 30 38-46 76 66z"/>' +
    "</g></svg>",
)}`;

/** Marks an `<img>` whose source is the placeholder, so a later real source is told apart. */
export const PLACEHOLDER_ATTR = "data-jx-image-placeholder";

/** Whether an image names no source at all: a blank `src` (or none) and a blank `srcset`. */
export function hasNoImageSource(img: HTMLImageElement): boolean {
  const src = img.getAttribute("src")?.trim() ?? "";
  const srcset = img.getAttribute("srcset")?.trim() ?? "";
  if (src !== "" || srcset !== "") {
    return false;
  }
  // A <picture>'s <source srcset> picks the image even when the <img> itself names none.
  const picture = img.parentElement?.localName === "picture" ? img.parentElement : null;
  return !picture?.querySelector("source[srcset]:not([srcset=''])");
}

/** Give one image the placeholder when it has no source; clear the mark once it has a real one. */
function fill(img: HTMLImageElement): void {
  if (hasNoImageSource(img)) {
    img.setAttribute(PLACEHOLDER_ATTR, "");
    img.setAttribute("src", PREVIEW_IMAGE_PLACEHOLDER);
  } else if (
    img.hasAttribute(PLACEHOLDER_ATTR) &&
    img.getAttribute("src") !== PREVIEW_IMAGE_PLACEHOLDER
  ) {
    img.removeAttribute(PLACEHOLDER_ATTR);
  }
}

/**
 * Whether an element is an `<img>`. By tag name rather than `instanceof`: the Stylebook's frame is
 * another realm, whose `HTMLImageElement` is not this module's.
 */
function isImage(element: Element): element is HTMLImageElement {
  return element.localName === "img";
}

/** Every `<img>` at or under `node`. */
function imagesIn(node: Node): HTMLImageElement[] {
  if (node.nodeType !== node.ELEMENT_NODE || !("querySelectorAll" in node)) {
    return [];
  }
  // SAFETY: an ELEMENT_NODE with `querySelectorAll` is an Element, in whichever realm it lives.
  const element = node as Element;
  const found = [...element.querySelectorAll("img")];
  return isImage(element) ? [element, ...found] : found;
}

/**
 * Fill every source-less image under `root` with {@link PREVIEW_IMAGE_PLACEHOLDER}, now and as the
 * tree changes: a component draws its own children in its `connectedCallback`, after the preview
 * element is created, and a binding can clear an image's source later. A real source always wins —
 * the placeholder only ever replaces nothing. Returns a function that stops watching.
 */
export function fillPreviewImages(root: Element): () => void {
  for (const img of imagesIn(root)) {
    fill(img);
  }
  /* The root's own realm's observer where it has one (the Stylebook's frame); this realm's for a
     document with no window, such as a parsed one — an observer watches any same-origin node. */
  const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const { target } = record;
        if (target.nodeType === target.ELEMENT_NODE && "localName" in target) {
          // SAFETY: an ELEMENT_NODE target with `localName` is an Element (attributes only land on elements).
          const element = target as Element;
          if (isImage(element)) {
            fill(element);
          }
        }
        continue;
      }
      for (const added of record.addedNodes) {
        for (const img of imagesIn(added)) {
          fill(img);
        }
      }
    }
  });
  observer.observe(root, {
    attributeFilter: ["src", "srcset"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
