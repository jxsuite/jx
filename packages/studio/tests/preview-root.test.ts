/**
 * A preview's root (`src/browse/preview-root.ts`): a rendered document or component is shown in its
 * island's own shadow root, so its ids stay out of Studio's document while the runtime's rules and
 * the broken-image rule still reach it.
 */
import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { mountPreview, shownPreview } from "../src/browse/preview-root";

afterEach(() => {
  document.body.replaceChildren();
  document.adoptedStyleSheets = [];
});

/** A rendered preview carrying an id the chrome could also use. */
function render(id: string): HTMLElement {
  const heading = document.createElement("h2");
  heading.id = id;
  heading.textContent = "Available Equipment";
  return heading;
}

describe("mountPreview", () => {
  test("the render is in the island's shadow root, so its id is not the document's", () => {
    const island = document.createElement("div");
    document.body.append(island);
    expect(shownPreview(island)).toBeNull();
    mountPreview(island, render("equipment"));
    expect(document.querySelector("#equipment")).toBeNull();
    expect(island.childElementCount).toBe(0);
    expect(shownPreview(island)?.id).toBe("equipment");
  });

  test("two cards of one component do not make its id a duplicate", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    mountPreview(first, render("equipment"));
    mountPreview(second, render("equipment"));
    expect(document.querySelectorAll("#equipment")).toHaveLength(0);
    expect(shownPreview(first)).not.toBe(shownPreview(second));
  });

  test("a refill replaces the render in the same root, and a cached render moves with it", () => {
    const island = document.createElement("div");
    const other = document.createElement("div");
    document.body.append(island, other);
    const cached = render("a");
    mountPreview(island, cached);
    const root = island.shadowRoot;
    mountPreview(island, render("b"));
    expect(island.shadowRoot).toBe(root);
    expect(root?.childElementCount).toBe(1);
    expect(shownPreview(island)?.id).toBe("b");
    mountPreview(other, cached);
    expect(shownPreview(other)).toBe(cached);
  });

  test("the root adopts the document's runtime sheets and the broken-image rule", () => {
    const runtime = new CSSStyleSheet();
    document.adoptedStyleSheets = [runtime];
    const island = document.createElement("div");
    document.body.append(island);
    mountPreview(island, render("x"));
    const sheets = island.shadowRoot?.adoptedStyleSheets ?? [];
    expect(sheets[0]).toBe(runtime);
    expect(sheets).toHaveLength(2);
    const rule = sheets[1]?.cssRules[0];
    expect(sheets[1]?.cssRules).toHaveLength(1);
    expect(rule instanceof CSSStyleRule ? rule.style.visibility : null).toBe("hidden");
    // One preview sheet per document, shared by every island rather than built per card.
    const again = document.createElement("div");
    document.body.append(again);
    mountPreview(again, render("y"));
    expect(again.shadowRoot?.adoptedStyleSheets[1]).toBe(sheets[1]);
  });
});
