/**
 * Prerender-hydration.test.ts — the prerender and the module's first render are the same markup.
 *
 * A live component's element clears its prerendered children and renders its own tree in one
 * synchronous `connectedCallback` (compiler.md §4.4), so the browser never paints between the two.
 * That is only flash-free while both emitters draw the same thing, and they are separate code: the
 * static renderer in `shared.ts` and the lit template in `compile-element.ts`. This builds a site,
 * loads the page into a DOM, lets every module upgrade its instances, and compares each host's
 * markup before and after.
 *
 * Happy-dom is not a browser: this proves markup equality, not the absence of a paint.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonValue } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import { buildSite } from "../src/site/site-build";

const TMP = resolve(import.meta.dir, "__test-prerender-hydration__");

function writeJSON(path: string, obj: JsonValue) {
  const full = resolve(TMP, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2), "utf8");
}

/**
 * Markup as a reader sees it: comments (lit's part markers, the slot brackets) and the `data-jx-*`
 * stamps are bookkeeping, and whitespace between tags is the emitters' own indentation.
 */
function normalize(html: string): string {
  return html
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/\sdata-jx-[a-z]+(?:="[^"]*")?/g, "")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*(<|>)\s*/g, "$1")
    .trim();
}

const inc = { $prototype: "Function", body: "state.n++" };
const list = (items: JsonValue): JsonValue => ({
  children: {
    $prototype: "Array",
    items,
    map: { tagName: "li", textContent: "${$map.index}:${$map.item}" },
  },
  tagName: "ul",
});

const COMPONENTS = {
  "click-box": {
    children: [
      { tagName: "p", textContent: "num: ${state.n}" },
      { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "Add" },
    ],
    state: { inc, n: 5 },
    tagName: "click-box",
  },
  "list-literal": { children: [list(["alpha", "beta"])], tagName: "list-literal" },
  "list-map": {
    children: [list({ $ref: "#/state/items" })],
    state: { items: ["alpha", "beta", "gamma"] },
    tagName: "list-map",
  },
  "live-parent": {
    $elements: [{ $ref: "./static-chip.json" }, { $ref: "./list-literal.json" }],
    children: [
      { $props: { label: "INSIDE" }, tagName: "static-chip" },
      { tagName: "list-literal" },
      { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "+${state.n}" },
    ],
    state: { inc, n: 1 },
    tagName: "live-parent",
  },
  /* Element properties (spec.md §8.1): the module binds each as a property and the platform
     reflects it; the prerender writes the attribute it reflects to. */
  "prop-box": {
    children: [
      { href: "/pricing", tagName: "a", textContent: "go ${state.n}" },
      { name: "q", placeholder: "Search", tagName: "input", type: "search" },
      { disabled: true, onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "+" },
      { htmlFor: "q", tagName: "label", textContent: "Query" },
    ],
    state: { inc, n: 1 },
    tagName: "prop-box",
  },
  "rows-rich": {
    children: [
      { tagName: "h4", textContent: "head" },
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: {
          attributes: { "data-name": { $ref: "$map/item/name" } },
          children: [
            { tagName: "b", textContent: "${$map.item.name}" },
            {
              $prototype: "Array",
              items: { $ref: "$map/item/tags" },
              map: { tagName: "u", textContent: "${$map.item}" },
            },
          ],
          tagName: "li",
        },
      },
    ],
    state: {
      rows: [
        { name: "A", tags: ["x", "y"] },
        { name: "B", tags: [] },
      ],
    },
    tagName: "rows-rich",
  },
  "slot-live": {
    children: [
      { tagName: "h3", textContent: "head ${state.n}" },
      { children: [{ tagName: "slot" }], tagName: "div" },
      { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "+" },
    ],
    state: { inc, n: 1 },
    tagName: "slot-live",
  },
  "static-chip": {
    children: [{ tagName: "span", textContent: "[${state.label}]" }],
    state: { label: "chip" },
    tagName: "static-chip",
  },
  "switch-box": {
    children: [
      {
        $switch: { $ref: "#/state/variant" },
        cases: {
          a: { tagName: "p", textContent: "CASE A" },
          b: { tagName: "p", textContent: "CASE B" },
        },
        tagName: "div",
      },
    ],
    state: { variant: "b" },
    tagName: "switch-box",
  },
} satisfies Record<string, JsonValue>;

/** The hosts compared, by the `id` the page gives each. */
const HOSTS = ["list", "click", "switch", "rows", "slot", "parent", "alone", "props"] as const;

let win: Window;
const before = new Map<string, string>();

/** The element with this id, failing the suite when the page lost it. */
function host(id: string): Element {
  const el = win.document.querySelector(`#${id}`);
  if (!el) {
    throw new Error(`Expected the built page to hold #${id}`);
  }
  return el;
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeJSON("project.json", { build: { outDir: "./dist" }, name: "hydrate" });
  for (const [name, doc] of Object.entries(COMPONENTS)) {
    writeJSON(`components/${name}.json`, doc);
  }
  writeJSON("pages/index.json", {
    $elements: Object.keys(COMPONENTS).map((name) => ({ $ref: `../components/${name}.json` })),
    children: [
      { id: "list", tagName: "list-map" },
      { id: "click", tagName: "click-box" },
      { id: "switch", tagName: "switch-box" },
      { id: "rows", tagName: "rows-rich" },
      { children: [{ tagName: "em", textContent: "given" }], id: "slot", tagName: "slot-live" },
      { id: "parent", tagName: "live-parent" },
      { $props: { label: "ALONE" }, id: "alone", tagName: "static-chip" },
      { id: "props", tagName: "prop-box" },
    ],
    tagName: "main",
  });
  const { errors } = await buildSite(TMP);
  expect(errors).toEqual([]);

  const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
  const scripts = [
    ...html.matchAll(/<script type="module" src="\/components\/([\w-]+)\.js">/g),
  ].map((m) => m[1]!);
  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });
  win.document.body.innerHTML = html
    .slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"))
    .replaceAll(/<script[^>]*><\/script>/g, "");
  for (const id of HOSTS) {
    before.set(id, normalize(host(id).innerHTML));
  }
  // In the page's own script order, one at a time: two imports of a module must never overlap.
  for (const tag of scripts) {
    await import(resolve(TMP, "dist/components", `${tag}.js`));
  }
}, 30_000);

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a prerendered instance upgrades to the markup it was built with", () => {
  test.each(HOSTS)("#%s is unchanged by its module's first render", (id) => {
    const prerendered = before.get(id) ?? "";
    expect(prerendered).not.toBe("");
    expect(normalize(host(id).innerHTML)).toBe(prerendered);
  });

  test("the upgrade consumed every stamp", () => {
    for (const id of HOSTS) {
      const stamps = host(id)
        .getAttributeNames()
        .filter((name) => name.startsWith("data-jx-"));
      expect(stamps).toEqual([]);
    }
  });

  test("slotted content is placed once, not beside a copy of the prerender", () => {
    expect(host("slot").querySelectorAll("em")).toHaveLength(1);
    expect(host("slot").querySelectorAll("h3")).toHaveLength(1);
  });

  test("a static component inside a live one keeps its content and its props", () => {
    expect(host("parent").querySelector("static-chip")?.textContent.trim()).toBe("[INSIDE]");
    // The same module upgraded the instance written on the page, from its own props.
    expect(host("alone").textContent.trim()).toBe("[ALONE]");
  });

  test("a repeater over a literal array renders from its module without throwing", () => {
    expect(host("parent").querySelectorAll("list-literal li")).toHaveLength(2);
  });

  test("the bindings are live after the upgrade", () => {
    host("click").querySelector("button")?.dispatchEvent(new win.Event("click"));
    expect(host("click").querySelector("p")?.textContent).toBe("num: 6");
    host("parent").querySelector("button")?.dispatchEvent(new win.Event("click"));
    expect(host("parent").querySelector("button")?.textContent).toBe("+2");
    expect(host("parent").querySelector("static-chip")?.textContent.trim()).toBe("[INSIDE]");
  });

  test("an element's properties are in the prerender as the attributes they reflect to", () => {
    // Read back through the DOM, which serializes a bare attribute as `disabled=""`.
    expect(before.get("props")).toBe(
      '<a href="/pricing">go 1</a><input name="q" placeholder="Search" type="search">' +
        '<button disabled="">+</button><label for="q">Query</label>',
    );
  });

  test("an element written with no prerender renders the same markup from nothing", () => {
    const fresh = win.document.createElement("click-box");
    win.document.body.append(fresh);
    expect(normalize(fresh.innerHTML)).toBe("<p>num: 5</p><button>Add</button>");
    fresh.remove();
  });
});
