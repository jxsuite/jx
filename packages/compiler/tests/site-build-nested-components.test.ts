/**
 * Site-build-nested-components.test.ts — issue #286, built end to end.
 *
 * The reproduction in the issue, verbatim: two static components and one page. Page-level and
 * slotted instances always expanded; the instance written inside `outer-box`'s own `children` came
 * out as `<inner-chip></inner-chip>` under a parent stamped `data-jx-static`, so the content was
 * simply gone — no markup, and no module to fill it in later. The component-library shape (card →
 * button → icon, with per-instance host styles) is here too, because that is what the issue was
 * actually hit on.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";

/** @param {string} root @param {string} path @param {unknown} obj */
function writeJSON(root: string, path: string, obj: unknown) {
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

// ── The issue's reproduction ──────────────────────────────────────────────────

describe("buildSite — a component instance inside another component's children (issue #286)", () => {
  const TMP = resolve(import.meta.dir, "__test-site-nested-comp__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "repro" });
    writeJSON(TMP, "components/inner-chip.json", {
      children: [{ tagName: "span", textContent: "[${state.label}]" }],
      state: { label: "chip" },
      tagName: "inner-chip",
    });
    writeJSON(TMP, "components/outer-box.json", {
      $elements: [{ $ref: "./inner-chip.json" }],
      children: [
        { tagName: "h2", textContent: "${state.title}" },
        { $props: { label: "NESTED" }, tagName: "inner-chip" },
        { children: [{ tagName: "slot" }], tagName: "div" },
      ],
      state: { title: "box" },
      tagName: "outer-box",
    });
    writeJSON(TMP, "pages/index.json", {
      $elements: [
        { $ref: "../components/outer-box.json" },
        { $ref: "../components/inner-chip.json" },
      ],
      $layout: false,
      children: [
        { $props: { label: "PAGE-LEVEL" }, tagName: "inner-chip" },
        {
          $props: { title: "Outer" },
          children: [{ $props: { label: "SLOTTED" }, tagName: "inner-chip" }],
          tagName: "outer-box",
        },
      ],
      tagName: "div",
      title: "repro",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without error", () => {
    expect(errors).toEqual([]);
  });

  it("expands the page-level instance, as before", () => {
    expect(bodyOf(TMP)).toContain(
      "<inner-chip data-jx-static><span>[PAGE-LEVEL]</span></inner-chip>",
    );
  });

  it("expands the slotted instance, as before", () => {
    expect(bodyOf(TMP)).toContain(
      "<div><inner-chip data-jx-static><span>[SLOTTED]</span></inner-chip></div>",
    );
  });

  it("expands the instance written inside the definition — the issue's Expected", () => {
    expect(bodyOf(TMP)).toContain("<inner-chip data-jx-static><span>[NESTED]</span></inner-chip>");
    expect(bodyOf(TMP)).not.toContain("<inner-chip></inner-chip>");
  });

  it("the whole tree, in order", () => {
    expect(bodyOf(TMP)).toBe(
      '<div title="repro">' +
        "<inner-chip data-jx-static><span>[PAGE-LEVEL]</span></inner-chip>" +
        "<outer-box data-jx-static><h2>Outer</h2>" +
        "<inner-chip data-jx-static><span>[NESTED]</span></inner-chip>" +
        "<div><inner-chip data-jx-static><span>[SLOTTED]</span></inner-chip></div>" +
        "</outer-box></div>",
    );
  });

  it("ships no JavaScript: both components are fully static and now fully rendered", () => {
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("modulepreload");
  });
});

// ── A component library: card → button → icon, with per-instance host styles ─

describe("buildSite — two levels of nesting and a per-instance host style", () => {
  const TMP = resolve(import.meta.dir, "__test-site-nested-library__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "library" });
    // The issue's `lcb-icon`: a glyph masked from a `--icon-*` custom property, sized per instance.
    writeJSON(TMP, "components/lcb-icon.json", {
      state: { name: "arrow", size: "16px" },
      style: {
        display: "inline-block",
        height: "${state.size}",
        maskImage: "${'var(--icon-' + state.name + ')'}",
      },
      tagName: "lcb-icon",
    });
    writeJSON(TMP, "components/lcb-button.json", {
      $elements: [{ $ref: "./lcb-icon.json" }],
      children: [
        {
          attributes: { href: "/quote" },
          children: [
            "${state.label}",
            {
              $props: { name: "${state.icon}", size: "24px" },
              style: { marginLeft: "4px" },
              tagName: "lcb-icon",
            },
          ],
          tagName: "a",
        },
      ],
      state: { icon: "arrow", label: "Go" },
      tagName: "lcb-button",
    });
    writeJSON(TMP, "components/lcb-card.json", {
      $elements: [{ $ref: "./lcb-button.json" }],
      children: [
        { tagName: "h3", textContent: "${state.title}" },
        { $props: { icon: "phone", label: "Free Quote" }, tagName: "lcb-button" },
      ],
      state: { title: "Card" },
      tagName: "lcb-card",
    });
    writeJSON(TMP, "pages/index.json", {
      $layout: false,
      children: [
        { $props: { name: "page", size: "32px" }, tagName: "lcb-icon" },
        { $props: { title: "Outer" }, tagName: "lcb-card" },
        { tagName: "lcb-icon" },
      ],
      tagName: "div",
      title: "library",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without error", () => {
    expect(errors).toEqual([]);
  });

  it("expands card → button → icon, each level with its own props", () => {
    expect(bodyOf(TMP)).toContain(
      '<lcb-card data-jx-static><h3>Outer</h3><lcb-button data-jx-static><a href="/quote">Free Quote',
    );
  });

  it("writes the nested icon's host style on the element, resolved against its own props", () => {
    // The mask and the size are the two declarations that were missing entirely when nested — an
    // Invisible icon. `mask-image` reads the prop the BUTTON passed, which the CARD chose.
    expect(bodyOf(TMP)).toContain(
      '<lcb-icon class="lcb-button-0" style="height: 24px; mask-image: var(--icon-phone)" ' +
        "data-jx-static></lcb-icon>",
    );
  });

  it("keeps the nested instance's own class handle, so its stylesheet rule still reaches it", () => {
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).toContain(".lcb-button-0 { margin-left: 4px }");
  });

  it("gives the page-level icon the same values, through the page's own style pass", () => {
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).toContain('<lcb-icon class="jx-0" data-jx-static></lcb-icon>');
    expect(html).toContain(".jx-0 { height: 32px; mask-image: var(--icon-page) }");
  });

  it("resolves a page-level instance's host style from the defaults when it passes no props", () => {
    /* A template declaration is dropped from the component stylesheet, so this is the only route
       by which the default mask and size reach a static page. The resolution was guarded on
       `$props`, and an instance taking the definition's defaults had no size and no mask at page
       level while the same instance one level down had both. */
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).toContain('<lcb-icon class="jx-1" data-jx-static></lcb-icon>');
    expect(html).toContain(".jx-1 { height: 16px; mask-image: var(--icon-arrow) }");
  });

  it("ships no JavaScript for a static library", () => {
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).not.toContain("<script");
  });
});

// ── A live child inside a static parent ───────────────────────────────────────

describe("buildSite — a non-static instance nested inside a static component", () => {
  const TMP = resolve(import.meta.dir, "__test-site-nested-live__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "live" });
    writeJSON(TMP, "components/live-chip.json", {
      children: [
        { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "${state.label}" },
      ],
      state: { bump: { $prototype: "Function", body: "state.n++;" }, label: "chip", n: 0 },
      tagName: "live-chip",
    });
    writeJSON(TMP, "components/static-shell.json", {
      $elements: [{ $ref: "./live-chip.json" }],
      children: [
        { tagName: "p", textContent: "shell" },
        { $props: { label: "inside" }, tagName: "live-chip" },
      ],
      tagName: "static-shell",
    });
    writeJSON(TMP, "pages/index.json", {
      $layout: false,
      children: [{ tagName: "static-shell" }],
      tagName: "div",
      title: "live",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without error", () => {
    expect(errors).toEqual([]);
  });

  it("prerenders the child as a shell carrying its props, exactly as a page-level instance", () => {
    expect(bodyOf(TMP)).toContain(
      '<live-chip data-jx-props="{&quot;label&quot;:&quot;inside&quot;}" data-jx-prerendered>' +
        "<button>inside</button></live-chip>",
    );
  });

  it("loads the child's module and not the parent's", () => {
    // The parent is static and its markup is final; the child upgrades in place inside it. The
    // Parent needs no script for that, and the page walk reaches the same conclusion for a live
    // Instance written directly on a static page.
    const html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
    expect(html).toContain('<script type="module" src="/components/live-chip.js"></script>');
    expect(html).toContain('<link rel="modulepreload" href="/components/live-chip.js">');
    expect(html).not.toContain("/components/static-shell.js");
    expect(bodyOf(TMP)).toContain("<static-shell data-jx-static><p>shell</p>");
  });
});

// ── A definition that names itself ────────────────────────────────────────────

describe("buildSite — a component that renders itself", () => {
  const TMP = resolve(import.meta.dir, "__test-site-nested-cycle__");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "cycle" });
    writeJSON(TMP, "components/a-loop.json", {
      children: [{ tagName: "p", textContent: "loop" }, { tagName: "a-loop" }],
      tagName: "a-loop",
    });
    writeJSON(TMP, "pages/index.json", {
      $layout: false,
      children: [{ tagName: "a-loop" }],
      tagName: "div",
      title: "cycle",
    });
    writeJSON(TMP, "pages/plain.json", {
      $layout: false,
      children: [{ tagName: "p", textContent: "no components here" }],
      tagName: "div",
      title: "plain",
    });
    ({ errors } = await buildSite(TMP, { verbose: false }));
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("fails that route with a diagnostic naming the chain, not a stack overflow", () => {
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^Error compiling \/: Component <a-loop> renders itself: a-loop → a-loop\./,
    );
    expect(errors[0]).not.toContain("Maximum call stack");
  });

  it("still builds the routes that do not use it", () => {
    expect(existsSync(resolve(TMP, "dist/index.html"))).toBe(false);
    expect(bodyOf(TMP, "plain/index.html")).toContain("<p>no components here</p>");
  });
});
