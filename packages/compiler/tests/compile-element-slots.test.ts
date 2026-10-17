/**
 * Compiled component modules distributing slotted children (spec.md §8.5), executed in a DOM.
 *
 * Source-text assertions cannot see the failures this guards: a lit part that ended at a moved node
 * clears its new parent on the next update and throws, and an element upgrading over its own
 * prerender captures its template as slot content. So the modules are compiled, written beside this
 * file (where `lit-html` and `@vue/reactivity` resolve), loaded, and driven.
 *
 * Happy-dom globals are installed before any module is imported: lit-html captures `document` at
 * import time.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import type { JxDocument } from "@jxsuite/schema/types";
import { compileElement } from "../src/targets/compile-element";
import { createSlotFill, preRenderComponentHtml, renderStaticNode } from "../src/shared";

const TMP = resolve(import.meta.dir, "__test-element-slots__");

/** The §8.5 card, with a list written directly before its unnamed slot. */
function card(tagName: string): JxDocument {
  return {
    children: [
      {
        children: [{ attributes: { name: "head" }, children: ["Untitled"], tagName: "slot" }],
        tagName: "header",
      },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "i", textContent: "${$map.item}" },
          },
          { children: ["Empty"], tagName: "slot" },
        ],
        tagName: "main",
      },
    ],
    state: { rows: ["r1"] },
    tagName,
  };
}

/** A parent that slots bindings, a list and a static paragraph into a card. */
function parent(tagName: string, cardTag: string): JxDocument {
  return {
    children: [
      {
        children: [
          { attributes: { slot: "head" }, tagName: "h1", textContent: "${state.title}" },
          "${state.body}",
          {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
          { tagName: "p", textContent: "after" },
        ],
        tagName: cardTag,
      },
    ],
    state: { body: "B", items: ["a"], title: "T" },
    tagName,
  };
}

/** A wrapper that forwards its own default slot into a card's `head` slot. */
function wrapper(tagName: string, cardTag: string): JxDocument {
  return {
    children: [
      {
        children: [{ attributes: { slot: "head" }, tagName: "slot" }],
        tagName: cardTag,
      },
    ],
    state: {},
    tagName,
  };
}

let win: Window;

/** Compile one definition and load its module. */
async function load(doc: JxDocument): Promise<void> {
  const { files } = await compileElement(doc);
  const file = resolve(TMP, `${String(doc.tagName)}.js`);
  writeFileSync(file, files[0]!.content, "utf8");
  await import(file);
}

/** Mount markup and let the elements connect and render. */
async function mount(html: string): Promise<Element> {
  const host = win.document.createElement("div");
  host.innerHTML = html;
  win.document.body.append(host);
  await settle();
  return host;
}

async function settle(): Promise<void> {
  await new Promise((r) => {
    setTimeout(r, 10);
  });
}

/**
 * What an element shows, child by child: an element's text, or a text node's, with whitespace-only
 * text and comments (the template's formatting, lit's markers and the part guards) left out.
 */
function text(el: Element | null): string {
  const out: string[] = [];
  for (const n of el?.childNodes ?? []) {
    const value = n.nodeType === 8 ? "" : (n.textContent ?? "").trim();
    if (value !== "") {
      out.push(value.replaceAll(/\s+/gu, " "));
    }
  }
  return out.join(" ");
}

/** A compiled element's reactive state, as the module exposes it. */
function stateOf(el: Element | null): Record<string, string | string[]> {
  if (!el || !("state" in el)) {
    throw new Error("expected a compiled element exposing its state");
  }
  /* SAFETY: every compiled element module assigns its reactive scope to `this.state`. */
  return el.state as Record<string, string | string[]>;
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });
  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    Comment: win.Comment,
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    NodeFilter: win.NodeFilter,
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });
  await load(card("cs-card"));
  await load(parent("cs-parent", "cs-card"));
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a compiled module distributes its slots", () => {
  test("distributes by name and leaves no slot", async () => {
    const host = await mount('<cs-card><h2 slot="head">Head</h2>\n  <p>Body</p></cs-card>');
    expect(host.querySelector("slot")).toBeNull();
    expect(host.querySelector("header > h2[slot=head]")?.textContent).toBe("Head");
    expect(text(host.querySelector("header"))).toBe("Head");
    expect(text(host.querySelector("main"))).toBe("r1 Body");
    host.remove();
  });

  test("an unmatched slot shows its fallback, and an empty host shows every fallback", async () => {
    const some = await mount("<cs-card><p>Body</p></cs-card>");
    expect(text(some.querySelector("header"))).toBe("Untitled");
    const none = await mount("<cs-card></cs-card>");
    expect(text(none.querySelector("header"))).toBe("Untitled");
    expect(text(none.querySelector("main"))).toBe("r1 Empty");
    some.remove();
    none.remove();
  });

  test("a list before a slot updates without disturbing the slotted children", async () => {
    const host = await mount("<cs-card><p>Body</p></cs-card>");
    const el = host.querySelector("cs-card");
    stateOf(el).rows = ["r1", "r2", "r3"];
    await settle();
    expect(text(host.querySelector("main"))).toBe("r1 r2 r3 Body");
    stateOf(el).rows = [];
    await settle();
    expect(text(host.querySelector("main"))).toBe("Body");
    host.remove();
  });

  test("a compiled parent's bindings keep updating inside the child's slots", async () => {
    const host = await mount("<cs-parent></cs-parent>");
    const el = host.querySelector("cs-parent");
    const main = () => text(host.querySelector("cs-card main"));
    expect(text(host.querySelector("cs-card header"))).toBe("T");
    expect(main()).toBe("r1 B a after");
    stateOf(el).body = "";
    await settle();
    stateOf(el).body = "B2";
    stateOf(el).title = "T2";
    await settle();
    expect(text(host.querySelector("cs-card header"))).toBe("T2");
    expect(main()).toBe("r1 B2 a after");
    stateOf(el).items = ["a", "b", "c"];
    await settle();
    expect(main()).toBe("r1 B2 a b c after");
    stateOf(el).items = [];
    await settle();
    expect(main()).toBe("r1 B2 after");
    host.remove();
  });
});

describe("forwarding", () => {
  test("a forwarded slot lands where the nested element puts it, whichever module is defined first", async () => {
    // Card already defined: the wrapper defined after it.
    await load(wrapper("cs-wrap-late", "cs-card"));
    const late = await mount("<cs-wrap-late><b>forwarded</b></cs-wrap-late>");
    expect(text(late.querySelector("header"))).toBe("forwarded");
    expect(text(late.querySelector("main"))).toBe("r1 Empty");

    // Wrapper defined BEFORE its card: the wrapper distributes into a card that has not captured.
    await load(wrapper("cs-wrap-early", "cs-card-late"));
    const early = await mount("<cs-wrap-early><b>forwarded</b></cs-wrap-early>");
    await load(card("cs-card-late"));
    await settle();
    expect(text(early.querySelector("header"))).toBe("forwarded");
    expect(text(early.querySelector("main"))).toBe("r1 Empty");
    late.remove();
    early.remove();
  });
});

describe("upgrading over a prerender", () => {
  /** The card's prerendered markup for `children`, bracketed under id 1, as the build writes it. */
  function prerendered(children: JxDocument["children"]): string {
    const fill = createSlotFill(children, {}, (c) => renderStaticNode(c, {}), 1);
    return preRenderComponentHtml(card("cs-card"), null, fill);
  }

  test("a bracketed prerender upgrades to the fresh render", async () => {
    const markup = prerendered([
      { attributes: { slot: "head" }, tagName: "h2", textContent: "Head" },
      { tagName: "p", textContent: "Body" },
    ]);
    const host = await mount(`<cs-card data-jx-slots="1" data-jx-prerendered>${markup}</cs-card>`);
    expect(host.querySelectorAll("header")).toHaveLength(1);
    expect(host.querySelector("header > h2[slot=head]")?.textContent).toBe("Head");
    expect(text(host.querySelector("header"))).toBe("Head");
    expect(text(host.querySelector("main"))).toBe("r1 Body");
    expect(host.querySelector("cs-card")?.getAttributeNames()).not.toContain("data-jx-slots");
    host.remove();
  });

  test("a non-static card given no children upgrades to its fallbacks, not its own markup", async () => {
    const markup = prerendered([]);
    const host = await mount(`<cs-card data-jx-slots="1" data-jx-prerendered>${markup}</cs-card>`);
    expect(host.querySelectorAll("header")).toHaveLength(1);
    expect(text(host.querySelector("header"))).toBe("Untitled");
    expect(text(host.querySelector("main"))).toBe("r1 Empty");
    host.remove();
  });
});
