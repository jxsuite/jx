/**
 * Prerender-initial-state.test.ts — a live component's prerender is its first render (compiler.md
 * §8.1).
 *
 * A component that held anything dynamic used to prerender a hollow shell: a repeater rendered no
 * rows, a template over state a handler writes rendered nothing, and a `$switch` was stamped static
 * with no module to ever change it. These build the shapes end to end, through `buildSite`, and
 * read the HTML a crawler reads.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

function writeJSON(root: string, path: string, obj: JsonValue) {
  const full = resolve(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2), "utf8");
}

/** The `<body>` of a built page, with the emitter's indentation and newlines collapsed. */
function bodyOf(root: string, page = "index.html"): string {
  const html = readFileSync(resolve(root, "dist", page), "utf8");
  return html
    .slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"))
    .replaceAll(/\s*\n\s*/g, "");
}

/** The component module scripts a built page loads, in document order. */
function scriptsOf(root: string, page = "index.html"): string[] {
  const html = readFileSync(resolve(root, "dist", page), "utf8");
  return [...html.matchAll(/<script type="module" src="\/components\/([\w-]+)\.js">/g)].map(
    (m) => m[1]!,
  );
}

const inc = { $prototype: "Function", body: "state.n++" };

// ── The four reported components ──────────────────────────────────────────────

describe("buildSite — a live component prerenders its initial state", () => {
  const TMP = resolve(import.meta.dir, "__test-prerender-initial__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "repro" });
    writeJSON(TMP, "components/list-map.json", {
      children: [
        {
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
          tagName: "ul",
        },
      ],
      state: { items: ["alpha", "beta", "gamma"] },
      tagName: "list-map",
    });
    writeJSON(TMP, "components/list-literal.json", {
      children: [
        {
          children: {
            $prototype: "Array",
            items: ["alpha", "beta", "gamma"],
            map: { tagName: "li", textContent: "${$map.item}" },
          },
          tagName: "ul",
        },
      ],
      tagName: "list-literal",
    });
    writeJSON(TMP, "components/click-box.json", {
      children: [
        { tagName: "p", textContent: "num: ${state.n}" },
        { tagName: "p", textContent: "untouched: ${state.untouched}" },
        { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "Add" },
      ],
      state: { inc, n: 5, untouched: 7 },
      tagName: "click-box",
    });
    writeJSON(TMP, "components/switch-box.json", {
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
    });
    writeJSON(TMP, "pages/index.json", {
      $elements: ["list-map", "list-literal", "click-box", "switch-box"].map((name) => ({
        $ref: `../components/${name}.json`,
      })),
      children: [
        { tagName: "list-map" },
        { tagName: "list-literal" },
        { tagName: "click-box" },
        { tagName: "switch-box" },
      ],
      tagName: "main",
    });
    ({ errors } = await buildSite(TMP));
  }, 30_000);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  it("renders a repeater's rows over state, and stamps the component live", () => {
    expect(bodyOf(TMP)).toContain(
      "<list-map data-jx-prerendered><ul><li>alpha</li><li>beta</li><li>gamma</li></ul></list-map>",
    );
  });

  it("stamps a repeater over a literal array static", () => {
    expect(bodyOf(TMP)).toContain(
      "<list-literal data-jx-static><ul><li>alpha</li><li>beta</li><li>gamma</li></ul></list-literal>",
    );
  });

  it("bakes the initial value of state a handler writes", () => {
    expect(bodyOf(TMP)).toContain(
      "<click-box data-jx-prerendered><p>num: 5</p><p>untouched: 7</p><button>Add</button></click-box>",
    );
  });

  it("renders the initial case of a $switch and stamps the component live", () => {
    expect(bodyOf(TMP)).toContain(
      "<switch-box data-jx-prerendered><div><p>CASE B</p></div></switch-box>",
    );
  });

  it("loads a module for each live component and none for the static one", () => {
    expect(scriptsOf(TMP)).toEqual(["click-box", "list-map", "switch-box"]);
  });

  it("leaves the page itself with no module", () => {
    expect(existsSync(resolve(TMP, "dist/app.js"))).toBe(false);
    expect(bodyOf(TMP)).not.toContain("${");
  });
});

// ── Repeater shapes ───────────────────────────────────────────────────────────

describe("buildSite — repeater rows inside a component", () => {
  const TMP = resolve(import.meta.dir, "__test-prerender-rows__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "rows" });
    writeJSON(TMP, "components/row-chip.json", {
      children: [{ tagName: "b", textContent: "<${state.label}>" }],
      state: { label: "chip" },
      tagName: "row-chip",
    });
    writeJSON(TMP, "components/rows-sibling.json", {
      children: [
        { tagName: "h4", textContent: "head" },
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            attributes: { "data-i": "${$map.index}", "data-name": { $ref: "$map/item/name" } },
            children: [
              "${index}:${item.name}",
              {
                $switch: { $ref: "$map/item/kind" },
                cases: {
                  hot: { tagName: "em", textContent: "hot" },
                  cold: { tagName: "i", textContent: "cold" },
                },
                tagName: "span",
              },
              {
                $prototype: "Array",
                items: { $ref: "$map/item/tags" },
                map: { tagName: "u", textContent: "${$map.item}" },
              },
              { $props: { label: "${$map.item.name}" }, tagName: "row-chip" },
            ],
            tagName: "li",
          },
        },
        { tagName: "footer", textContent: "foot" },
      ],
      $elements: [{ $ref: "./row-chip.json" }],
      state: {
        rows: [
          { kind: "hot", name: "A", tags: ["x", "y"] },
          { kind: "cold", name: "B", tags: [] },
        ],
      },
      tagName: "rows-sibling",
    });
    writeJSON(TMP, "components/rows-arranged.json", {
      children: [
        {
          children: {
            $prototype: "Array",
            filter: { $ref: "#/state/keep" },
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
          tagName: "ul",
        },
        {
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: "${$map.item}" },
            sort: { $ref: "#/state/order" },
          },
          tagName: "ol",
        },
      ],
      // Named formulas: the form every tier calls the same way (spec.md §10.3).
      state: {
        keep: {
          $expression: { operator: ">", target: { $ref: "$args/item" }, value: 1 },
          parameters: ["item"],
        },
        order: {
          $expression: { operator: "-", target: { $ref: "$args/a" }, value: { $ref: "$args/b" } },
          parameters: ["a", "b"],
        },
        rows: [3, 1, 2],
      },
      tagName: "rows-arranged",
    });
    writeJSON(TMP, "components/rows-late.json", {
      children: [
        {
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/feed" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
          tagName: "ul",
        },
        { tagName: "p", textContent: "feed: ${state.feed}" },
        { children: ["late ${state.feed}"], tagName: "p" },
      ],
      state: { feed: { $prototype: "Request", url: "/api/feed" } },
      tagName: "rows-late",
    });
    writeJSON(TMP, "components/pre-box.json", {
      children: [
        {
          children: [
            { tagName: "code", textContent: "a" },
            { tagName: "code", textContent: "b" },
            {
              $prototype: "Array",
              items: ["c", "d"],
              map: { tagName: "code", textContent: "${$map.item}" },
            },
          ],
          tagName: "pre",
        },
      ],
      tagName: "pre-box",
    });
    writeJSON(TMP, "pages/index.json", {
      $elements: ["rows-sibling", "rows-arranged", "rows-late", "pre-box", "row-chip"].map(
        (name) => ({ $ref: `../components/${name}.json` }),
      ),
      children: [
        { tagName: "rows-sibling" },
        { tagName: "rows-arranged" },
        { tagName: "rows-late" },
        { tagName: "pre-box" },
      ],
      tagName: "main",
    });
    ({ errors } = await buildSite(TMP));
  }, 30_000);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  it("renders a repeater among siblings in place, each row in its own scope", () => {
    const body = bodyOf(TMP);
    const chip = (label: string) =>
      `<row-chip data-jx-props="{&quot;label&quot;:&quot;${label}&quot;}" data-jx-prerendered>` +
      `<b>&lt;${label}&gt;</b></row-chip>`;
    expect(body).toContain(
      "<rows-sibling data-jx-prerendered><h4>head</h4>" +
        `<li data-i="0" data-name="A">0:A<span><em>hot</em></span><u>x</u><u>y</u>${chip("A")}</li>` +
        `<li data-i="1" data-name="B">1:B<span><i>cold</i></span>${chip("B")}</li>` +
        "<footer>foot</footer></rows-sibling>",
    );
  });

  it("stamps a static component a live one renders live, and loads its module first", () => {
    // `row-chip` has nothing dynamic of its own, but `rows-sibling`'s module creates it bare.
    const scripts = scriptsOf(TMP);
    expect(scripts).toContain("row-chip");
    expect(scripts.indexOf("row-chip")).toBeLessThan(scripts.indexOf("rows-sibling"));
  });

  it("renders the rows a filter keeps and the order a sort gives", () => {
    expect(bodyOf(TMP)).toContain(
      "<rows-arranged data-jx-prerendered><ul><li>3</li><li>2</li></ul>" +
        "<ol><li>1</li><li>2</li><li>3</li></ol></rows-arranged>",
    );
  });

  it("renders no rows, and no template source, over state with no build-time value", () => {
    expect(bodyOf(TMP)).toContain(
      "<rows-late data-jx-prerendered><ul></ul><p></p><p></p></rows-late>",
    );
  });

  it("joins the children of a preformatted element with nothing", () => {
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).toContain("<pre><code>a</code><code>b</code><code>c</code><code>d</code></pre>");
  });
});

// ── Live tags, slot content and finished markup ───────────────────────────────

describe("buildSite — what a live component renders, and what a page gives it", () => {
  const TMP = resolve(import.meta.dir, "__test-prerender-live-tags__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "live" });
    writeJSON(TMP, "components/static-chip.json", {
      children: [{ tagName: "span", textContent: "[${state.label}]" }],
      state: { label: "chip" },
      tagName: "static-chip",
    });
    writeJSON(TMP, "components/live-parent.json", {
      $elements: [{ $ref: "./static-chip.json" }],
      children: [
        { $props: { label: "INSIDE", n: "${state.n}" }, tagName: "static-chip" },
        {
          attributes: { "data-n": "${state.n}" },
          onclick: { $ref: "#/state/inc" },
          style: { order: "${state.n}" },
          tagName: "button",
          textContent: "+${state.n}",
        },
      ],
      state: { inc, n: 1 },
      tagName: "live-parent",
    });
    writeJSON(TMP, "components/slot-live.json", {
      children: [
        { tagName: "h3", textContent: "head ${state.n}" },
        { children: [{ tagName: "slot" }], tagName: "div" },
        { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "+" },
      ],
      state: { inc, n: 1 },
      tagName: "slot-live",
    });
    writeJSON(TMP, "components/slot-static.json", {
      children: [{ children: [{ tagName: "slot" }], tagName: "div" }],
      tagName: "slot-static",
    });
    // A component whose rendered text holds `${`: a code sample about templates.
    writeJSON(TMP, "components/code-sample.json", {
      children: [{ tagName: "code", textContent: "${state.parts.join('')}" }],
      state: { parts: ["$", "{state.zzz} stays"] },
      tagName: "code-sample",
    });
    writeJSON(TMP, "pages/index.json", {
      $elements: ["static-chip", "live-parent", "slot-live", "slot-static", "code-sample"].map(
        (name) => ({ $ref: `../components/${name}.json` }),
      ),
      children: [
        { tagName: "live-parent" },
        { $props: { label: "ALONE" }, tagName: "static-chip" },
        { children: [{ tagName: "em", textContent: "given" }], tagName: "slot-live" },
        { children: [{ tagName: "em", textContent: "given" }], tagName: "slot-static" },
        { tagName: "code-sample" },
      ],
      tagName: "main",
    });
    writeJSON(TMP, "pages/alone.json", {
      $elements: [{ $ref: "../components/static-chip.json" }],
      children: [{ $props: { label: "ONLY" }, tagName: "static-chip" }],
      tagName: "main",
    });
    // A page with state a handler writes, read inside the children it gives an instance.
    writeJSON(TMP, "pages/counter.json", {
      $elements: [{ $ref: "../components/slot-static.json" }],
      children: [
        {
          children: [
            { tagName: "span", textContent: "count ${state.count}" },
            "plain ${state.count}",
          ],
          tagName: "slot-static",
        },
        { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "bump" },
      ],
      state: { bump: { $prototype: "Function", body: "state.count++" }, count: 3 },
      tagName: "main",
    });
    ({ errors } = await buildSite(TMP));
  }, 30_000);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  it("bakes handler-written state in text, attributes, inline style and a nested prop", () => {
    expect(bodyOf(TMP)).toContain(
      "<live-parent data-jx-prerendered>" +
        '<static-chip data-jx-props="{&quot;label&quot;:&quot;INSIDE&quot;,&quot;n&quot;:1}" ' +
        "data-jx-prerendered><span>[INSIDE]</span></static-chip>" +
        '<button class="live-parent-0" style="order: 1" data-n="1">+1</button></live-parent>',
    );
  });

  it("stamps a tag a live component renders live on the pages that draw that component", () => {
    // The module loads for `live-parent`'s sake and upgrades this instance too: without its props
    // As data it would come back with the definition's defaults.
    expect(bodyOf(TMP)).toContain(
      '<static-chip data-jx-props="{&quot;label&quot;:&quot;ALONE&quot;}" data-jx-prerendered>' +
        "<span>[ALONE]</span></static-chip>",
    );
    // A page that places the chip without the live component keeps it static, with no script.
    expect(bodyOf(TMP, "alone/index.html")).toContain(
      "<static-chip data-jx-static><span>[ONLY]</span></static-chip>",
    );
    expect(scriptsOf(TMP, "alone/index.html")).toEqual([]);
  });

  it("writes a tag's module script after the scripts of the tags it renders", () => {
    const scripts = scriptsOf(TMP);
    expect(scripts.indexOf("static-chip")).toBeLessThan(scripts.indexOf("live-parent"));
    expect(scripts).not.toContain("slot-static");
    expect(scripts).not.toContain("code-sample");
  });

  it("brackets slotted content only on a live instance", () => {
    const body = bodyOf(TMP);
    expect(body).toContain(
      '<slot-live data-jx-slots="1" data-jx-prerendered><h3>head 1</h3>' +
        "<div><!--jx-slot 1 --><em>given</em><!--/jx-slot 1--></div><button>+</button></slot-live>",
    );
    expect(body).toContain("<slot-static data-jx-static><div><em>given</em></div></slot-static>");
  });

  it("keeps a `${` a component rendered as text, and the page static", () => {
    expect(bodyOf(TMP)).toContain(
      "<code-sample data-jx-static><code>${state.zzz} stays</code></code-sample>",
    );
    expect(existsSync(resolve(TMP, "dist/app.js"))).toBe(false);
  });

  it("bakes the page's handler-written state into the children it gives an instance", () => {
    expect(bodyOf(TMP, "counter/index.html")).toContain(
      "<slot-static data-jx-static><div><span>count 3</span>plain 3</div></slot-static>",
    );
  });
});
