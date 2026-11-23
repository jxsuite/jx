/**
 * A preview's root (`src/browse/preview-root.ts`): a snapshot the preview realm drew is shown in
 * its island's own shadow root, so its ids stay out of Studio's document while the realm's rules
 * and the preview rules still reach it.
 */
import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  makeInert,
  mountPreview,
  shownPreview,
  unmountPreview,
  previewRootOf,
} from "../src/browse/preview-root";
import type { PreviewSnapshot } from "../src/preview-realm/host";

afterEach(() => {
  document.body.replaceChildren();
});

/** A snapshot carrying an id the chrome could also use. */
function render(id: string, sheet: CSSStyleSheet | null = null): PreviewSnapshot {
  return { html: `<h2 id="${id}">Available Equipment</h2>`, sheet };
}

/** An island in the document. */
function island(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

describe("mountPreview", () => {
  test("the snapshot is parsed into the island's shadow root, so its id is not the document's", () => {
    const box = island();
    expect(shownPreview(box)).toBeNull();
    const snapshot = render("equipment");
    mountPreview(box, snapshot);
    expect(document.querySelector("#equipment")).toBeNull();
    expect(box.childElementCount).toBe(0);
    expect(previewRootOf(box)?.querySelector("#equipment")?.textContent).toBe(
      "Available Equipment",
    );
    expect(shownPreview(box)).toBe(snapshot);
  });

  test("nothing in a snapshot runs in Studio's window: handlers, frames, scripts and javascript: URLs go", () => {
    const box = island();
    mountPreview(box, {
      html: [
        '<img src="x.png" onerror="parent.alert(1)" alt="kept">',
        '<iframe srcdoc="<script>parent.alert(2)</script>"></iframe>',
        "<script>parent.alert(3)</script>",
        '<object data="x"></object><embed src="x"><base href="/"><meta http-equiv="refresh">',
        '<a href=" java\tscript:alert(4)" title="kept">link</a>',
        '<a href="https://example.com/">safe</a>',
        '<div srcdoc="x" ONCLICK="y"><template shadowrootmode="open">',
        '<p onmouseover="z">inside</p><script>w()</script></template></div>',
      ].join(""),
      sheet: null,
    });
    const root = previewRootOf(box)!;
    const img = root.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
    expect(img?.getAttribute("alt")).toBe("kept");
    expect(root.querySelector("iframe, script, object, embed, base, meta")).toBeNull();
    const [unsafe, safe] = root.querySelectorAll("a");
    expect(unsafe?.hasAttribute("href")).toBe(false);
    expect(unsafe?.getAttribute("title")).toBe("kept");
    expect(safe?.getAttribute("href")).toBe("https://example.com/");
    const div = root.querySelector("div");
    expect(div?.attributes).toHaveLength(0);
    // A declarative shadow root this parser leaves as a template is made inert as well.
    const template = root.querySelector("template");
    expect(template?.content.querySelector("p")?.getAttribute("onmouseover")).toBeNull();
    expect(template?.content.querySelector("script")).toBeNull();
  });

  test("an attached shadow root in a parsed snapshot is made inert too", () => {
    const fragment = document.createDocumentFragment();
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = '<b onclick="x">in</b><script></script>';
    fragment.append(host);
    makeInert(fragment);
    expect(host.shadowRoot?.querySelector("b")?.hasAttribute("onclick")).toBe(false);
    expect(host.shadowRoot?.querySelector("script")).toBeNull();
  });

  test("two cards of one component do not make its id a duplicate", () => {
    const first = island();
    const second = island();
    const snapshot = render("equipment");
    mountPreview(first, snapshot);
    mountPreview(second, snapshot);
    expect(document.querySelectorAll("#equipment")).toHaveLength(0);
    expect(previewRootOf(first)?.firstElementChild).not.toBe(
      previewRootOf(second)?.firstElementChild,
    );
  });

  test("a refill replaces the render in the same root", () => {
    const box = island();
    mountPreview(box, render("a"));
    const root = previewRootOf(box);
    const next = render("b");
    mountPreview(box, next);
    expect(previewRootOf(box)).toBe(root);
    expect(root?.childElementCount).toBe(1);
    expect(root?.firstElementChild?.id).toBe("b");
    expect(shownPreview(box)).toBe(next);
  });

  test("the root adopts the realm's rules, then the preview rules", () => {
    const realm = new CSSStyleSheet();
    const box = island();
    mountPreview(box, render("x", realm));
    const sheets = previewRootOf(box)?.adoptedStyleSheets ?? [];
    expect(sheets[0]).toBe(realm);
    expect(sheets).toHaveLength(2);
    const [hidden, fallback] = [...(sheets[1]?.cssRules ?? [])];
    expect(hidden instanceof CSSStyleRule ? hidden.style.visibility : null).toBe("hidden");
    expect(fallback instanceof CSSStyleRule ? fallback.selectorText : null).toBe(
      ".jx-preview-fallback",
    );
    /* One preview sheet per document, shared by every island rather than built per card; a
       snapshot with no sheet of its own adopts the preview rules alone. */
    const again = island();
    mountPreview(again, render("y"));
    expect(previewRootOf(again)?.adoptedStyleSheets).toEqual([sheets[1]!]);
  });

  test("a preview is bounded by its island, on an element no project rule can select", () => {
    /* A page's fixed header (`position: fixed; top: 0`) is placed against the viewport unless an
       ancestor is its containing block; a shadow boundary, `overflow: hidden` and the surfaces'
       `zoom` are none of those, so a component card once drew its nav over the Command Bar. */
    const box = island();
    mountPreview(box, render("fixed"));
    const outer = box.shadowRoot!;
    const [bound, fill] = [...(outer.adoptedStyleSheets[0]?.cssRules ?? [])];
    expect(outer.adoptedStyleSheets).toHaveLength(1);
    expect(bound instanceof CSSStyleRule ? bound.selectorText : null).toBe(":host");
    const style = bound instanceof CSSStyleRule ? bound.style : null;
    expect(style?.getPropertyValue("contain")).toBe("layout paint style");
    // Important, so an outer rule a surface writes on the island cannot switch it off.
    expect(style?.getPropertyPriority("contain")).toBe("important");
    expect(
      fill instanceof CSSStyleRule ? fill.style.getPropertyValue("min-block-size") : null,
    ).toBe("100%");
    /* The island's root holds one element, and the preview's root is that element's: a project
       rule the preview carries (a site's `body` re-pointed to `:host`, an authored `:host(...)`)
       selects that element at most, which the island contains, and never the island itself. */
    expect(outer.childElementCount).toBe(1);
    const inner = outer.firstElementChild;
    if (!(inner instanceof HTMLElement)) {
      throw new TypeError("the island's root holds no element");
    }
    expect(previewRootOf(box)).toBe(inner.shadowRoot);
    expect(previewRootOf(box)?.querySelector("#fixed")).not.toBeNull();
    expect(outer.querySelector("#fixed")).toBeNull();
    // Inert from the mount, so no surface has to remember to mark its island.
    expect(inner.inert).toBe(true);
    // A refill keeps both roots.
    mountPreview(box, render("again"));
    expect(box.shadowRoot).toBe(outer);
    expect(outer.firstElementChild).toBe(inner);
  });

  test("an island with nothing mounted has no preview root", () => {
    expect(previewRootOf(island())).toBeNull();
  });

  test("an island in a document with no window takes the realm's rules alone", () => {
    const detached = document.implementation.createHTMLDocument("detached");
    const box = detached.createElement("div");
    detached.body.append(box);
    mountPreview(box, render("z"));
    expect(previewRootOf(box)?.adoptedStyleSheets).toEqual([]);
    expect(box.shadowRoot?.adoptedStyleSheets).toEqual([]);
    expect(previewRootOf(box)?.querySelector("#z")).not.toBeNull();
  });
});

describe("unmountPreview", () => {
  test("empties every island still showing the snapshot, and leaves one that moved on", () => {
    const snapshot = render("a");
    const showing = island();
    const moved = island();
    mountPreview(showing, snapshot);
    mountPreview(moved, snapshot);
    const other = render("b");
    mountPreview(moved, other);
    unmountPreview(snapshot);
    expect(shownPreview(showing)).toBeNull();
    expect(previewRootOf(showing)?.childElementCount).toBe(0);
    expect(shownPreview(moved)).toBe(other);
    // Once let go, it is let go: a second unmount has nothing to do.
    expect(() => {
      unmountPreview(snapshot);
    }).not.toThrow();
  });
});
