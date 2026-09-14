import { describe, expect, test } from "bun:test";
import { compileStyles, takeDroppedReactiveStyles } from "../src/shared.ts";

/*
 * `compileStyles` writes a page's `<style>` from two sources: the project's `style` block and the
 * document's own element styles. The project half is `buildSiteStyleCSS` (`@jxsuite/site`), the
 * same emitter the Studio canvas and the live preview use — it used to be a second copy of the
 * `:root` / `body` / selector / `@`-block split, and the two copies disagreed on the two shapes
 * below, which `site-style.test.ts`'s parity block had to leave out (#329). That parity test holds
 * the two emitters byte-for-byte; this file asserts what the BUILT PAGE says for the shapes the
 * compiler's own copy got wrong, so a regression names itself here rather than as a parity diff.
 */

const sheetOf = (built: string) => built.slice("<style>\n".length, -"\n</style>".length);

describe("compileStyles — the project block is the site builder's", () => {
  test("a top-level & key is a state of :root, not a raw & selector", () => {
    /* `&[data-theme="light"]` is how a project forces a scheme (spec.md §9.5). The compiler used to
       pass the key through as the SELECTOR, so the built page carried `&[data-theme="light"] {…}`,
       a rule no engine matches, while the canvas showed the forced scheme correctly. */
    const built = compileStyles(
      { children: [], tagName: "div" },
      {},
      { "--bg": "#111", '&[data-theme="light"]': { "--bg": "#fff", a: { color: "navy" } } },
    );
    expect(sheetOf(built).split("\n")).toEqual([
      ":root { --bg: #111 }",
      ':root[data-theme="light"] { --bg: #fff }',
      ':root[data-theme="light"] a { color: navy }',
    ]);
    expect(built).not.toContain("&");
  });

  test("a top-level colorScheme lands on :root, where light-dark() can see it", () => {
    /* `color-scheme` resolves against the element carrying it. Routed to `body`, every
       `light-dark()` token declared on `:root` read the UA default, so the built page and the
       canvas disagreed about which half of every pair a visitor saw (spec.md §9.5). */
    const built = compileStyles(
      { children: [], tagName: "div" },
      {},
      { "--fg": "light-dark(#111, #eee)", colorScheme: "light dark", margin: "0" },
    );
    expect(sheetOf(built).split("\n")).toEqual([
      ":root { --fg: light-dark(#111, #eee); color-scheme: light dark }",
      "body { margin: 0 }",
    ]);
  });

  test("the project sheet precedes the document's own rules, unchanged", () => {
    // Delegation moved the emitter, not the order: project rules first, then element rules.
    const built = compileStyles(
      { children: [], id: "hero", style: { color: "red" }, tagName: "div" },
      {},
      { margin: "0" },
    );
    expect(sheetOf(built)).toBe("body { margin: 0 }\n#hero { color: red }");
  });

  test("a document with no project block and no styles still emits nothing", () => {
    // The builder answers "" for `{}` with no scheme query, and "" is not a rule.
    expect(compileStyles({ children: [], tagName: "div" }, {}, null)).toBe("");
    expect(compileStyles({ children: [], tagName: "div" }, { "--md": "(min-width: 1px)" })).toBe(
      "",
    );
  });

  test("a reactive project declaration is dropped AND reported, naming its selector", () => {
    /* A host drops a reactive project declaration in silence, having nothing to evaluate it
       against; the build drops it for the same reason but says so, through the same recorder the
       element styles use — so delegating the project half did not lose the report. */
    takeDroppedReactiveStyles();
    const built = compileStyles({ children: [], tagName: "div" }, {}, {
      "--tint": "${state.tint}",
      padding: "4px",
      ".card": { color: { $ref: "#/state/fg" } },
    } as never);
    expect(sheetOf(built)).toBe("body { padding: 4px }");
    const dropped = takeDroppedReactiveStyles();
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toContain("`--tint: ${state.tint}` on `:root`");
    expect(dropped[1]).toContain("`color: #/state/fg` on `.card`");
  });
});
