import { describe, expect, test } from "bun:test";
import { SITE_STYLE_ID, buildSiteStyleCSS } from "../src/site-style.ts";
/* The build's emitter, read across the workspace boundary: `shared.ts` is not a package export,
   and the dependency runs the other way (the compiler depends on this package). The parity test
   below is why `scripts/ci/affected.ts` carries an inverted edge from that file to this suite. */
import { compileStyles } from "../../compiler/src/shared.ts";

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
       override shipped a sheet without one. The class key beside it was still skipped on the same
       belief, which was never true either (#296): it is a rule of the page's stylesheet, and it is
       emitted as itself, not as a state of the root. */
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
    expect(css).toContain("\n.card { color: red }");
    expect(css).not.toContain(":root .card");
  });

  /*
   * #296. A site whose typography and link styling live at project level looked right in the built
   * output and wrong in Studio: `jx build` writes `"h1, h2"` and `a` rules from `project.json#/style`
   * into every page's stylesheet, and this builder skipped every selector-keyed block that was not
   * `&` or `@`, on the stated belief that the document's own style pass covered page content. Nothing
   * else reads the project block, so the canvas simply had no such rules — headings in the fallback
   * face, links underlined — while the `:root` tokens from the same block were present, which is what
   * made the divergence hard to see from the canvas alone.
   */
  describe("selector-keyed blocks (#296)", () => {
    test("an element key is a rule of its own, unscoped", () => {
      const css = buildSiteStyleCSS(
        { fontFamily: "system-ui, sans-serif", a: { textDecoration: "none" } },
        {},
        id,
      );
      expect(css).toBe("body { font-family: system-ui, sans-serif }\na { text-decoration: none }");
      // Not `:root a`, not `body a`: the project block IS the page's stylesheet, as it is in the build.
      expect(css).not.toContain(" a {");
    });

    test("a selector list is emitted as the list it was written as", () => {
      const css = buildSiteStyleCSS(
        {
          "--font-display": "Forum, Georgia, serif",
          "h1, h2": { fontFamily: "var(--font-display)", textTransform: "uppercase" },
        },
        {},
        id,
      );
      expect(css).toBe(
        ":root { --font-display: Forum, Georgia, serif }\n" +
          "h1, h2 { font-family: var(--font-display); text-transform: uppercase }",
      );
    });

    test("a pseudo nested under an element key compounds onto every member of it", () => {
      const css = buildSiteStyleCSS(
        {
          a: { textDecoration: "none", ":hover": { textDecoration: "underline" } },
          "h1, h2": { ":first-child": { marginTop: "0" } },
        },
        {},
        id,
      );
      expect(css).toContain("a { text-decoration: none }\na:hover { text-decoration: underline }");
      // The list is split before the pseudo is spliced — `h1, h2:first-child` would style the wrong `h1`.
      expect(css).toContain("h1:first-child, h2:first-child { margin-top: 0 }");
    });

    test("a breakpoint nested under an element key resolves against the media map", () => {
      const css = buildSiteStyleCSS(
        { "h1, h2": { fontSize: "1.5rem", "@--md": { fontSize: "2rem" } } },
        { "--md": "(min-width: 768px)" },
        id,
      );
      expect(css).toBe(
        "h1, h2 { font-size: 1.5rem }\n@media (min-width: 768px) { h1, h2 { font-size: 2rem } }",
      );
    });

    test("the transposer reaches element rules too", () => {
      // The canvas rewrites viewport units to container units; a `min-height: 100vh` on `main` must not escape it.
      const css = buildSiteStyleCSS({ main: { minHeight: "100vh" } }, {}, (v) =>
        v.replace("vh", "cqh"),
      );
      expect(css).toBe("main { min-height: 100cqh }");
    });

    test("selector blocks keep authored order between themselves and follow the base rules", () => {
      /* Source order is what decides between two rules of equal specificity, so the sheet may not
         reorder what the author wrote: `a` then `&[data-theme="dark"]` then `.card` stays in that
         order, after `:root` and `body`, and before every conditional block. */
      const css = buildSiteStyleCSS(
        {
          a: { color: "blue" },
          '&[data-theme="dark"]': { "--bg": "#000" },
          ".card": { color: "red" },
          "--bg": "#fff",
          margin: "0",
          "@--md": { margin: "1rem" },
        },
        { "--md": "(min-width: 768px)" },
        id,
      );
      expect(css.split("\n")).toEqual([
        ":root { --bg: #fff }",
        "body { margin: 0 }",
        "a { color: blue }",
        ':root[data-theme="dark"] { --bg: #000 }',
        ".card { color: red }",
        "@media (min-width: 768px) { body { margin: 1rem } }",
      ]);
    });

    test("a block under a custom-property key is not a rule", () => {
      // A custom property has no block value; the compiler skips the shape, and so does this.
      expect(buildSiteStyleCSS({ "--tokens": { color: "red" } }, {}, id)).toBe("");
    });

    test("the sheet is byte-for-byte what the build writes for the same block", () => {
      /* The assertion the issue is really asking for: not that each rule is present, but that a
         host shows what `jx build` ships. `compileStyles` is the emitter the build reaches
         (`site-build.ts` → `compile()` → `projectStyle`), and its project half is held here to this
         builder's whole output for one block that exercises every shape both accept — tokens, body
         declarations, a selector list with a nested pseudo and a nested breakpoint, an element, a
         class, a scheme block with a selector sub-block, `@font-face`, `@keyframes` — under a media
         map with a scheme query, so the `color-scheme` triplet is compared too.

         Two shapes are deliberately absent, because the COMPILER still gets them wrong and this
         test must not pin a defect: a top-level `&` key, which it passes through as a raw `&`
         selector where this builder splices `:root`, and a top-level `colorScheme`, which it routes
         to `body` where spec.md §9.5 says `:root`. Both are the compiler's to fix; the day it does,
         they belong in this block. */
      const style = {
        "--font-display": "Forum, Georgia, serif",
        "--bg": "light-dark(#fff, #111)",
        fontFamily: "system-ui, sans-serif",
        margin: "0",
        "h1, h2": {
          fontFamily: "var(--font-display)",
          textTransform: "uppercase",
          ":hover": { color: "red" },
          "@--md": { fontSize: "2rem" },
        },
        a: { textDecoration: "none" },
        ".card": { color: "red" },
        "@--dark": { "--bg": "#000", margin: "1px", ".card": { borderColor: "#333" } },
        "@font-face": { fontFamily: "Jx", src: "url(/a.woff2)" },
        "@keyframes toast-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      };
      const media = { "--dark": "(prefers-color-scheme: dark)", "--md": "(min-width: 768px)" };
      const built = compileStyles({ tagName: "div" }, media, style);
      expect(built.startsWith("<style>\n") && built.endsWith("\n</style>")).toBe(true);
      const pageSheet = built.slice("<style>\n".length, -"\n</style>".length);
      expect(buildSiteStyleCSS(style, media, id)).toBe(pageSheet);
      // And it is not vacuous: the rules the issue names are in both.
      expect(pageSheet).toContain(
        "\nh1, h2 { font-family: var(--font-display); text-transform: uppercase }\n",
      );
      expect(pageSheet).toContain("\na { text-decoration: none }\n");
    });
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

  test("the color-scheme hint is the compiler's triplet, and an authored colorScheme suppresses it", () => {
    /* Native widgets follow `color-scheme`, not the author's tokens, so the forced root attribute
       has to re-point it — the two per-attribute lines the build has always written and this
       builder did not, which left the canvas's Light/Dark preview driving every `light-dark()`
       token and no scrollbar. The suppression is spec.md §9.5, and it was also a cascade bug here:
       the hint was emitted unconditionally AFTER the `:root` rule carrying the author's own value,
       so `colorScheme: "light"` under a scheme query became `light dark` in every host. */
    const media = { "--dark": "(prefers-color-scheme: dark)" };
    const hinted = buildSiteStyleCSS({ "--bg": "#fff" }, media, id);
    expect(hinted.split("\n")).toEqual([
      ":root { --bg: #fff }",
      ":root { color-scheme: light dark }",
      ':root:where([data-color-scheme="light"]) { color-scheme: light }',
      ':root:where([data-color-scheme="dark"]) { color-scheme: dark }',
    ]);
    const authored = buildSiteStyleCSS({ "--bg": "#fff", colorScheme: "light" }, media, id);
    expect(authored).toBe(":root { --bg: #fff; color-scheme: light }");
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
