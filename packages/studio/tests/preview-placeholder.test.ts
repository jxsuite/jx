/**
 * The stand-in picture for a component preview's source-less images
 * (src/canvas/preview-placeholder.ts): filled now and as the tree changes, never over a real
 * source.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import {
  PLACEHOLDER_ATTR,
  PREVIEW_IMAGE_PLACEHOLDER,
  fillPreviewImages,
  hasNoImageSource,
} from "../src/canvas/preview-placeholder";

/** Let the MutationObserver deliver its records. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function img(attrs: Record<string, string> = {}): HTMLImageElement {
  const element = document.createElement("img");
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  return element;
}

describe("hasNoImageSource", () => {
  test("a missing or blank src with no srcset names nothing", () => {
    expect(hasNoImageSource(img())).toBe(true);
    expect(hasNoImageSource(img({ src: "" }))).toBe(true);
    expect(hasNoImageSource(img({ src: "  " }))).toBe(true);
  });

  test("a src, a srcset or a picture's source names an image", () => {
    expect(hasNoImageSource(img({ src: "/a.jpg" }))).toBe(false);
    expect(hasNoImageSource(img({ srcset: "/a.jpg 1x" }))).toBe(false);
    const picture = document.createElement("picture");
    const source = document.createElement("source");
    source.setAttribute("srcset", "/a.webp");
    const inner = img();
    picture.append(source, inner);
    expect(hasNoImageSource(inner)).toBe(false);
  });
});

describe("fillPreviewImages", () => {
  test("fills source-less images already there, and leaves real ones alone", () => {
    const root = document.createElement("div");
    const empty = img({ src: "" });
    const missing = img();
    const real = img({ src: "/hero.jpg" });
    root.append(empty, missing, real);
    const stop = fillPreviewImages(root);
    expect(empty.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    expect(missing.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    expect(empty.hasAttribute(PLACEHOLDER_ATTR)).toBe(true);
    expect(real.getAttribute("src")).toBe("/hero.jpg");
    expect(real.hasAttribute(PLACEHOLDER_ATTR)).toBe(false);
    stop();
  });

  test("fills the root itself when it is an image", () => {
    const root = img();
    fillPreviewImages(root)();
    expect(root.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
  });

  test("fills an image drawn later, as a component draws its children when it connects", async () => {
    const root = document.createElement("div");
    const stop = fillPreviewImages(root);
    const card = document.createElement("article");
    const later = img({ src: "" });
    card.append(later);
    root.append(card);
    await settle();
    expect(later.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    stop();
  });

  test("a real source set later wins and drops the mark; a cleared one is filled again", async () => {
    const root = document.createElement("div");
    const image = img();
    root.append(image);
    const stop = fillPreviewImages(root);
    image.setAttribute("src", "/real.jpg");
    await settle();
    expect(image.getAttribute("src")).toBe("/real.jpg");
    expect(image.hasAttribute(PLACEHOLDER_ATTR)).toBe(false);
    image.setAttribute("src", "");
    await settle();
    expect(image.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    stop();
  });

  test("text added beside an image is ignored, and only the image is filled", async () => {
    const root = document.createElement("div");
    const stop = fillPreviewImages(root);
    const image = img();
    root.append(document.createTextNode("caption"), image);
    await settle();
    expect(image.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    expect(root.textContent).toBe("caption");
    stop();
  });

  test("a tree in a parsed document is filled too", () => {
    // A parsed document may have no `defaultView`; this realm's observer watches it instead.
    const parsed = new DOMParser().parseFromString("<div><img></div>", "text/html");
    const root = parsed.querySelector("div");
    if (!root) {
      throw new Error("the parsed fixture lost its root");
    }
    const stop = fillPreviewImages(root);
    expect(root.querySelector("img")?.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
    stop();
  });

  test("stops watching once disposed", async () => {
    const root = document.createElement("div");
    fillPreviewImages(root)();
    const after = img();
    root.append(after);
    await settle();
    expect(after.hasAttribute("src")).toBe(false);
  });

  test("the placeholder is an inline SVG image, so the canvas never retries or waits on it", () => {
    const [scheme, body] = PREVIEW_IMAGE_PLACEHOLDER.split(",", 2);
    expect(scheme).toBe("data:image/svg+xml");
    const svg = new DOMParser().parseFromString(decodeURIComponent(body ?? ""), "image/svg+xml");
    expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 320 180");
  });
});
