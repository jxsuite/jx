import { describe, expect, test } from "bun:test";
import { SITE_STYLE_ID, buildSiteStyleCSS } from "../src/site-style.ts";

const id = (v: string) => v;

// ─── buildSiteStyleCSS ──────────────────────────────────────────────────────

describe("buildSiteStyleCSS", () => {
  test("splits custom properties to :root and plain props to body", () => {
    const css = buildSiteStyleCSS({ "--brand": "#0f0", color: "red", margin: "0" }, {}, id);
    expect(css).toContain(":root { --brand: #0f0 }");
    expect(css).toContain("body { color: red; margin: 0 }");
  });

  test("applies the transpose hook to values", () => {
    const css = buildSiteStyleCSS({ minHeight: "100vh" }, {}, (v) => v.replace("vh", "cqh"));
    expect(css).toContain("body { min-height: 100cqh }");
  });

  test("resolves @--name blocks against mediaQueries, tokens on :root", () => {
    const css = buildSiteStyleCSS(
      { "--pad": "1rem", "@--md": { "--pad": "2rem", margin: "0" } },
      { "--md": "(min-width: 768px)" },
      id,
    );
    expect(css).toContain("@media (min-width: 768px) { :root { --pad: 2rem } }");
    expect(css).toContain("@media (min-width: 768px) { body { margin: 0 } }");
    expect(css.indexOf(":root { --pad: 1rem")).toBeLessThan(css.indexOf("@media"));
    expect(css).not.toContain("color-scheme");
  });

  test("a &-prefixed block is a state of the root, and reaches the sheet", () => {
    /* `&[data-theme="light"]` means `:root[data-theme="light"]` — a project forcing a scheme. It
       used to fall in with every other nested selector under "page-content styling, the resolved
       document covers those" and was dropped in SILENCE, so a site declaring a forced-theme
       override shipped a sheet without one. A bare element or class key really is page content and
       is still skipped, which is the half that made the old rule look right. */
    const css = buildSiteStyleCSS(
      {
        "--bg": "light-dark(#fff, #111)",
        '&[data-theme="dark"]': { colorScheme: "dark" },
        '&[data-theme="light"]': { "--bg": "#fff", colorScheme: "light" },
        ".card": { color: "red" },
        colorScheme: "light dark",
      },
      {},
      id,
    );
    expect(css).toContain(':root[data-theme="light"] { --bg: #fff; color-scheme: light }');
    expect(css).toContain(':root[data-theme="dark"] { color-scheme: dark }');
    // Page content stays the document's own business.
    expect(css).not.toContain(".card");
  });

  test("color-scheme lands on :root, where light-dark() can see it", () => {
    /* The one non-custom property that must not go to `body`. Every semantic token is a
       `light-dark()` pair, and `light-dark()` resolves against the element carrying
       `color-scheme` — so declared on `body` it leaves every token on `:root` resolving against
       the wrong element. It is also what made the site builder and `installTheme`, which puts the
       same authored block on `:root`, disagree about one project. */
    const css = buildSiteStyleCSS(
      { "--bg": "light-dark(#fff, #111)", colorScheme: "light dark", margin: "0" },
      {},
      id,
    );
    expect(css).toContain(":root { --bg: light-dark(#fff, #111); color-scheme: light dark }");
    expect(css).toContain("body { margin: 0 }");
    expect(css).not.toContain("body { color-scheme");
  });

  test("dual-emits scheme blocks with the §9.5 selector contract", () => {
    const css = buildSiteStyleCSS(
      { "--bg": "#fff", "@--dark": { "--bg": "#000", ".card": { borderColor: "#333" } } },
      { "--dark": "(prefers-color-scheme: dark)" },
      id,
    );
    // Pin the exact selector contract shared with the compiler/runtime emission.
    expect(css).toContain(
      "@media (prefers-color-scheme: dark) { :root:where(:not([data-color-scheme])) { --bg: #000 } }",
    );
    expect(css).toContain(':root:where([data-color-scheme="dark"]) { --bg: #000 }');
    expect(css).toContain(':where(:root[data-color-scheme="dark"]) .card { border-color: #333 }');
    expect(css).toContain(":root { color-scheme: light dark }");
  });

  test("literal @(query) blocks work, and a non-media at-rule passes through", () => {
    /* `@supports` used to be dropped here and emitted by the compiler, so a project style meant
       one thing in a host and another on the shipped page. Both go through `buildStyleRules` now. */
    const css = buildSiteStyleCSS(
      {
        "@(prefers-color-scheme: light)": { "--fg": "#111" },
        "@supports (gap: 1px)": { gap: "1" },
      },
      {},
      id,
    );
    expect(css).toContain(':root:where([data-color-scheme="light"]) { --fg: #111 }');
    expect(css).toContain("@supports (gap: 1px) { body { gap: 1 } }");
  });

  test("a declaration-body at-rule is emitted once, with no selector", () => {
    // `@font-face { … }` IS the body; splitting it across `:root` and `body` would emit it twice.
    const css = buildSiteStyleCSS(
      { "@font-face": { fontFamily: "Jx", src: "url(/a.woff2)" } },
      {},
      id,
    );
    expect(css).toBe("@font-face { font-family: Jx; src: url(/a.woff2) }");
  });

  test("a project-level @keyframes is ONE block, not one rule per stop", () => {
    /* This path decomposed an `@` block itself before the builder ever saw it, so it pushed one
       call per sub-key with the stop as the SCOPE — output that looks like valid CSS and is not:
       the last definition of a `@keyframes` name replaces every earlier one, so a site-wide
       animation kept only its final stop. */
    const css = buildSiteStyleCSS(
      { "@keyframes toast-in": { from: { opacity: "0" }, to: { opacity: "1" } } },
      {},
      id,
    );
    expect(css).toBe("@keyframes toast-in { from { opacity: 0 } to { opacity: 1 } }");
  });

  /*
   * A media TYPE is bare. `@media (print)` reads as a boolean media feature named `print`, which
   * does not exist, so the canvas silently dropped every print rule.
   */
  test("@(print) emits the bare media type", () => {
    const css = buildSiteStyleCSS({ "@(print)": { color: "#000" } }, {}, id);
    expect(css).toContain("@media print");
    expect(css).not.toContain("@media (print)");
  });

  test("declares color-scheme when the media map has a scheme query even without blocks", () => {
    const css = buildSiteStyleCSS(
      { "--bg": "#fff" },
      { "--dark": "(prefers-color-scheme: dark)" },
      id,
    );
    expect(css).toContain(":root { color-scheme: light dark }");
  });

  test("empty style with no scheme query produces no rules", () => {
    expect(buildSiteStyleCSS({}, {}, id)).toBe("");
  });

  test("exports the stable style-tag id", () => {
    expect(SITE_STYLE_ID).toBe("jx-site-style");
  });
});
