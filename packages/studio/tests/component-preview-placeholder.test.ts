/**
 * A component preview's source-less image is the preview placeholder
 * (src/panels/component-preview.ts over src/canvas/preview-placeholder.ts), including one the
 * instance draws only once it connects.
 */
import "./with-dom.js";
import { expect, test } from "bun:test";
import { renderComponentPreview } from "../src/panels/component-preview";
import { PREVIEW_IMAGE_PLACEHOLDER } from "../src/canvas/preview-placeholder";

/** Draws the way a card whose image prop defaults to `""` does: its children, after it connects. */
class PreviewCard extends HTMLElement {
  connectedCallback(): void {
    const image = document.createElement("img");
    image.setAttribute("src", "");
    this.append(image);
  }
}

test("an image the instance draws with no source shows the preview placeholder", async () => {
  customElements.define("x-preview-card", PreviewCard);
  const el = await renderComponentPreview({ source: "npm", tagName: "x-preview-card" });
  document.body.append(el);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(el.querySelector("img")?.getAttribute("src")).toBe(PREVIEW_IMAGE_PLACEHOLDER);
  el.remove();
});
