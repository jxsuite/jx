/**
 * `@jxsuite/runtime/css` exists to be importable where the DOM runtime is not.
 *
 * Two things are asserted here. The first is the property that made it a subpath, and which no
 * behavioural test can see: that importing it costs nothing. A single `import` added to `css.ts` —
 * a helper from `./runtime.ts` — would put the renderer and `@vue/reactivity` back inside every
 * Worker that composes a stylesheet, and every behavioural test would still pass. The allowlist is
 * one entry long and `@jxsuite/schema/guards` is on it because that module imports nothing but
 * types; anything else has to justify itself here first.
 *
 * The second is `buildStyleRules`, which is the one place that decides what a Jx style object MEANS
 * as CSS. Three emitters used to answer that separately and each dropped a different nesting order,
 * so the composition cases below are the contract the runtime, the compiler and the site builder
 * are now all held to at once.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import * as css from "../src/css.ts";

const SOURCE = readFileSync(join(import.meta.dirname, "../src/css.ts"), "utf8");

/** The source with comments removed — `localStorage` and the DOM are named in prose throughout. */
const CODE = SOURCE.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");

describe("the module has no dependencies at all", () => {
  test("it imports nothing, from anywhere", () => {
    const imports = [
      ...CODE.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect({
      imports,
      why: "this subpath exists so a Worker can compose a stylesheet without the DOM runtime",
    }).toEqual({
      imports: ["@jxsuite/schema/guards", "@jxsuite/schema/types"],
      why: "this subpath exists so a Worker can compose a stylesheet without the DOM runtime",
    });
  });

  test("it names no DOM or platform global", () => {
    // Pure string and regex math. A `document` here would throw in workerd rather than degrade.
    for (const global of ["document.", "window.", "navigator.", "localStorage", "process."]) {
      expect({ global, present: CODE.includes(global) }).toEqual({ global, present: false });
    }
  });
});

describe("the subpath carries what @jxsuite/site/site-style needs", () => {
  test("every export is present", () => {
    // A move that dropped one would surface as a build failure three packages away.
    expect(Object.keys(css).toSorted()).toEqual([
      "COLOR_SCHEME_ATTR",
      "COLOR_SCHEME_STORAGE_KEY",
      "buildStyleRules",
      "camelToKebab",
      "cssPropertyName",
      "cssRuleText",
      "hashCss",
      "isDeclarationAtRule",
      "isKeyframesAtRule",
      "isNestedSelectorKey",
      "pureSchemeOf",
      "resolveAtQuery",
      "resolveNestedSelector",
      "schemeSelectors",
      "splitSelectorList",
      "transposeCanvasOverlaySelector",
      "transposeCanvasPopoverSelector",
    ]);
  });

  test("the root export still answers for every one of them", async () => {
    /* Moving these must not be a breaking change: the compiler and the studio both import
       camelToKebab from "@jxsuite/runtime", and canvas-media imports pureSchemeOf. */
    const root = (await import("../src/runtime.ts")) as Record<string, unknown>;
    for (const name of Object.keys(css)) {
      expect({ name, same: root[name] === (css as Record<string, unknown>)[name] }).toEqual({
        name,
        same: true,
      });
    }
  });
});

/** Rule texts only — the shape assertions below read better as a list of strings. */
const textsOf = (style: css.CssRule[]) => style.map((rule) => rule.text);

describe("buildStyleRules composes nesting and at-rules in both orders", () => {
  test("a base declaration and a state override are two rules, base first", () => {
    /* The defect this whole engine exists for: the base property used to be written INLINE and the
       `:hover` rule to a `<style>` tag, so the override could never win. As two rules in one sheet
       they are an ordinary equal-specificity pair and source order decides. */
    const rules = css.buildStyleRules(
      { ":hover": { backgroundColor: "#15164a" }, backgroundColor: "#6e0303", fontSize: "45px" },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      ".s { background-color: #6e0303; font-size: 45px }",
      ".s:hover { background-color: #15164a }",
    ]);
  });

  test("selector then @media — the order the runtime used to drop", () => {
    const rules = css.buildStyleRules(
      { ":hover": { "@--md": { color: "blue" }, color: "red" } },
      { mediaQueries: { "--md": "(min-width: 40rem)" }, scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      ".s:hover { color: red }",
      "@media (min-width: 40rem) { .s:hover { color: blue } }",
    ]);
  });

  test("@media then selector then pseudo — the order the compiler used to drop", () => {
    const rules = css.buildStyleRules(
      { "@(min-width: 40rem)": { li: { ":hover": { color: "blue" } } } },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual(["@media (min-width: 40rem) { .s li:hover { color: blue } }"]);
  });

  test("at-rules nest into each other to any depth", () => {
    const rules = css.buildStyleRules(
      { "@supports (display: grid)": { "@(min-width: 40rem)": { display: "grid" } } },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      "@supports (display: grid) { @media (min-width: 40rem) { .s { display: grid } } }",
    ]);
  });
});

describe("buildStyleRules classifies what a rule points at", () => {
  test("compounding keys stay on the element; a descendant key does not", () => {
    const rules = css.buildStyleRules(
      { "& > li": { color: "b" }, ".wide": { color: "c" }, ":hover": { color: "a" } },
      { scope: ".s" },
    );
    expect(rules.map((r) => [r.selector, r.target])).toEqual([
      [".s > li", "descendant"],
      [".s.wide", "self"],
      [".s:hover", "self"],
    ]);
  });

  test("a declaration-body at-rule is unscoped and keeps no selector", () => {
    // `@position-try --flip { … }` IS the body; wrapping it in a selector makes the parser drop it.
    const rules = css.buildStyleRules(
      { "@position-try --flip": { insetBlockStart: "auto" } },
      { scope: ".s" },
    );
    expect(rules).toMatchObject([
      {
        selector: null,
        target: "unscoped",
        text: "@position-try --flip { inset-block-start: auto }",
      },
    ]);
  });

  test("a descendant classification survives further compounding", () => {
    const rules = css.buildStyleRules({ li: { ":hover": { color: "a" } } }, { scope: ".s" });
    expect(rules.map((r) => [r.selector, r.target])).toEqual([[".s li:hover", "descendant"]]);
  });
});

describe("buildStyleRules on @keyframes", () => {
  test("the stops are not scoped, and the whole block is ONE rule", () => {
    /* The defect: `@keyframes` fell through to the verbatim-at-rule branch, so the emitter walked
       its body carrying the element scope and wrote `@keyframes toast-in { .s from { … } }` — one
       rule per stop. Chrome parses that into a keyframes rule holding NO keyframes, so the
       `animation` beside it names a live animation that animates nothing. */
    const rules = css.buildStyleRules(
      {
        animation: "toast-in 180ms ease-out",
        "@keyframes toast-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      ".s { animation: toast-in 180ms ease-out }",
      "@keyframes toast-in { from { opacity: 0 } to { opacity: 1 } }",
    ]);
  });

  test("one rule, not one per stop — a repeated name would erase all but the last", () => {
    /* CSS Animations 1: where two `@keyframes` share a name the last wins and the earlier ones are
       ignored entirely. So a per-stop emission is valid CSS that animates only its final stop, and
       "the scope is gone" is not enough to assert. */
    const rules = css.buildStyleRules(
      { "@keyframes fade": { from: { opacity: "0" }, to: { opacity: "1" } } },
      { scope: ".s" },
    );
    expect(rules.length).toBe(1);
    expect(rules[0]).toMatchObject({
      blocks: [
        { declarations: [["opacity", "0"]], selector: "from" },
        { declarations: [["opacity", "1"]], selector: "to" },
      ],
      declarations: [],
      selector: null,
      target: "unscoped",
    });
  });

  test("percentage stops and a comma-separated stop are taken verbatim", () => {
    // `"0%, 100%"` is ONE valid keyframe selector; distributing it as a selector list splits a
    // Stop in two and, scoped, produced `.s 0%, .s 100%`.
    const rules = css.buildStyleRules(
      { "@keyframes blink": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0" } } },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      "@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }",
    ]);
  });

  test("no element scope reaches a keyframe selector, whatever the scope is", () => {
    for (const scope of [".s", "#box", "jx-scope", "html body .deep > li"]) {
      const rules = css.buildStyleRules(
        { "@keyframes k": { from: { opacity: "0" }, to: { opacity: "1" } } },
        { scope },
      );
      expect({ scope, text: textsOf(rules).join("\n") }).toEqual({
        scope,
        text: "@keyframes k { from { opacity: 0 } to { opacity: 1 } }",
      });
    }
  });

  test("a keyframes block inside @media keeps the media wrapper", () => {
    const rules = css.buildStyleRules(
      { "@(min-width: 40rem)": { "@keyframes k": { from: { opacity: "0" } } } },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      "@media (min-width: 40rem) { @keyframes k { from { opacity: 0 } } }",
    ]);
  });

  test("with no scope at all it still emits — the site-style path passes null", () => {
    // The nested-block recursion is guarded on a non-null selector, so before the branch existed a
    // Project-level `@keyframes` emitted nothing whatsoever.
    const rules = css.buildStyleRules(
      { "@keyframes fade": { from: { opacity: "0" }, to: { opacity: "1" } } },
      { scope: null },
    );
    expect(textsOf(rules)).toEqual(["@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"]);
  });

  test("the value transposer runs inside a stop; the selector transposer never sees one", () => {
    /* The canvas hook returns null for `::backdrop`, and a keyframe selector handed to it would be
       a category error whose cost is a deleted stop. The unit rewrite still has to reach the
       declarations. */
    const seen: string[] = [];
    const rules = css.buildStyleRules(
      { "@keyframes rise": { from: { transform: "translateY(10vh)" } } },
      {
        scope: ".s",
        transposeSelector: (selector) => {
          seen.push(selector);
          return null;
        },
        transposeValue: (value) => value.replace("vh", "cqh"),
      },
    );
    expect({ seen, texts: textsOf(rules) }).toEqual({
      seen: [],
      texts: ["@keyframes rise { from { transform: translateY(10cqh) } }"],
    });
  });

  test("a reactive value inside a stop is dropped rather than indirected through a var()", () => {
    /* The resolver answers `var(--jx-rN-M)`, a property the runtime sets INLINE on the one element
       that declared the style — while this rule is hoisted for the whole document. It would also
       make the text per-element, so two elements naming one animation would be two definitions of
       one name and the later would erase the earlier. */
    const seen: string[] = [];
    const rules = css.buildStyleRules(
      {
        "@keyframes k": {
          from: { color: { $ref: "#/state/tint" }, opacity: "${state.a}", transform: "none" },
        },
      },
      {
        resolveValue: (property) => {
          seen.push(property);
          return "var(--jx-r0-0)";
        },
        scope: ".s",
      },
    );
    expect({ seen, texts: textsOf(rules) }).toEqual({
      seen: [],
      texts: ["@keyframes k { from { transform: none } }"],
    });
  });

  test("a scheme-pure query emits the block once, under the media guard", () => {
    /* The forced-scheme twin re-points a SELECTOR at the root attribute. A keyframes name has no
       selector, so a second copy would be a second definition of one name — and the unconditional
       one would win for every visitor, forced scheme or not. */
    const rules = css.buildStyleRules(
      {
        "@(prefers-color-scheme: dark)": { "@keyframes k": { from: { opacity: "0" } }, color: "a" },
      },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      "@media (prefers-color-scheme: dark) { :where(:root:not([data-color-scheme])) .s { color: a } }",
      "@media (prefers-color-scheme: dark) { @keyframes k { from { opacity: 0 } } }",
      ':where(:root[data-color-scheme="dark"]) .s { color: a }',
    ]);
  });

  test("an unnamed block, or one whose stops say nothing, emits nothing", () => {
    expect(
      css.buildStyleRules(
        { "@keyframes": { from: { opacity: "0" } }, "@keyframes empty": { from: {} } },
        { scope: ".s" },
      ),
    ).toEqual([]);
  });

  test("@keyframes is its own predicate and is NOT a declaration at-rule", () => {
    /* The tempting one-line fix is to add it to `isDeclarationAtRule`, and it deletes the
       animation in silence: every child of a keyframes block is a block, `declarationsOf` skips
       blocks, and a rule with no declarations is never emitted. */
    expect(
      ["@keyframes spin", "@keyframes  spin ", "@keyframes"].map((key) =>
        css.isKeyframesAtRule(key),
      ),
    ).toEqual([true, true, true]);
    expect(
      ["@media screen", "@font-face", "@property --p", "@starting-style"].map((key) =>
        css.isKeyframesAtRule(key),
      ),
    ).toEqual([false, false, false, false]);
    expect(css.isDeclarationAtRule("@keyframes spin")).toBe(false);
  });
});

describe("buildStyleRules on values", () => {
  test("custom property names are never kebab-cased", () => {
    // `--fooBar` and `--foo-bar` are two different properties; renaming one orphans its `var()`.
    const rules = css.buildStyleRules({ "--fooBar": "1px", fontSize: "2rem" }, { scope: ".s" });
    expect(textsOf(rules)).toEqual([".s { --fooBar: 1px; font-size: 2rem }"]);
  });

  test("a $ref is a value, not a nested selector", () => {
    const seen: [string, unknown][] = [];
    const rules = css.buildStyleRules(
      { color: { $ref: "#/state/tint" } },
      {
        resolveValue: (property, value) => {
          seen.push([property, value]);
          return "var(--jx-r0)";
        },
        scope: ".s",
      },
    );
    expect({ rules: textsOf(rules), seen }).toEqual({
      rules: [".s { color: var(--jx-r0) }"],
      seen: [["color", { $ref: "#/state/tint" }]],
    });
  });

  test("with no resolver, a $ref and a template are dropped rather than emitted", () => {
    const rules = css.buildStyleRules(
      { color: { $ref: "#/state/tint" }, fontSize: "${state.size}", margin: "0" },
      { scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([".s { margin: 0 }"]);
  });

  test("a template inside a nested block reaches the resolver too", () => {
    // Defect 4: `${…}` used to reach the sheet literally from anywhere but the top level.
    const rules = css.buildStyleRules(
      { ":hover": { color: "${state.tint}" } },
      { resolveValue: () => "var(--jx-r0)", scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([".s:hover { color: var(--jx-r0) }"]);
  });

  test("the value transposer runs on every declaration, at every depth", () => {
    const rules = css.buildStyleRules(
      { "@(min-width: 1px)": { ":hover": { width: "50vw" } }, width: "10vw" },
      { scope: ".s", transposeValue: (value) => value.replace("vw", "cqw") },
    );
    expect(textsOf(rules)).toEqual([
      ".s { width: 10cqw }",
      "@media (min-width: 1px) { .s:hover { width: 50cqw } }",
    ]);
  });
});

describe("buildStyleRules on selectors", () => {
  test("the selector transposer can rewrite a rule or refuse it entirely", () => {
    const rules = css.buildStyleRules(
      { ":popover-open": { color: "a" }, "::backdrop": { color: "b" } },
      { scope: ".s", transposeSelector: css.transposeCanvasPopoverSelector },
    );
    expect(textsOf(rules)).toEqual([".s[data-jx-popover-open] { color: a }"]);
  });

  test("a scheme-pure query dual-emits, and the forced copy keeps recursing", () => {
    const rules = css.buildStyleRules(
      { "@(prefers-color-scheme: dark)": { "@--md": { color: "b" }, color: "a" } },
      { mediaQueries: { "--md": "(min-width: 40rem)" }, scope: ".s" },
    );
    expect(textsOf(rules)).toEqual([
      "@media (prefers-color-scheme: dark) { :where(:root:not([data-color-scheme])) .s { color: a } }",
      "@media (prefers-color-scheme: dark) { @media (min-width: 40rem) { :where(:root:not([data-color-scheme])) .s { color: b } } }",
      ':where(:root[data-color-scheme="dark"]) .s { color: a }',
      '@media (min-width: 40rem) { :where(:root[data-color-scheme="dark"]) .s { color: b } }',
    ]);
  });

  test("`@--` names no query and emits nothing", () => {
    // The canvas base-width block. Resolved, it would emit the invalid `@media --`.
    expect(css.buildStyleRules({ "@--": { width: "1280px" } }, { scope: ".s" })).toEqual([]);
  });

  test("no `&` ever reaches the output", () => {
    /* Jx flattens nesting itself. It has to: `.child` COMPOUNDS here where CSS Nesting would make
       it a descendant, so handing `&` to a parser would silently change what a style object means. */
    const rules = css.buildStyleRules(
      { "& .inner": { "&:hover": { color: "a" } } },
      { scope: ".s" },
    );
    expect(textsOf(rules).join("\n")).not.toContain("&");
  });

  test("a scalar under a selector key is an invalid shape and is dropped", () => {
    expect(css.buildStyleRules({ ":hover": "red", color: "blue" }, { scope: ".s" })).toMatchObject([
      { text: ".s { color: blue }" },
    ]);
  });
});

describe("buildStyleRules on a block that documents itself", () => {
  const build = (style: unknown) => css.buildStyleRules(style as never, { scope: ":root" });

  test("$description reaches the rule and stays out of its text", () => {
    /* Out of `text` is the load-bearing half. `text` is what a sheet inserts and what `hashCss`
       interns, so prose there would make two otherwise identical rules two rules, and would put a
       paragraph into every adopted sheet at runtime. */
    const [rule] = build({ $description: "why this exists", color: "red" });
    expect(rule!.text).toBe(":root { color: red }");
    expect(rule!.description).toBe("why this exists");
    expect(rule!.key).toBe(css.hashCss(":root { color: red }"));
  });

  test("two rules alike but for their prose intern as one", () => {
    const [a] = build({ $description: "one reason", color: "red" });
    const [b] = build({ $description: "a different reason", color: "red" });
    expect(a!.key).toBe(b!.key);
  });

  test("a nested block and a declaration at-rule each carry their own", () => {
    const rules = build({
      "&:hover": { $description: "the hover", color: "blue" },
      "@font-face": { $description: "the face", fontFamily: "A" },
    });
    expect(rules.map((rule) => rule.description)).toEqual(["the hover", "the face"]);
  });

  test("a rule that documents nothing carries no description at all", () => {
    const [rule] = build({ color: "red" });
    expect(rule!.description).toBeUndefined();
    expect("description" in rule!).toBe(false);
  });

  test("every $-prefixed key is metadata, and none is a declaration", () => {
    /* The prefix rather than the one name: no CSS property begins with `$` — a custom property
       begins with `--` — so a document's metadata can never be mistaken for styling. It used to
       emit `$description: why this exists;`, an invalid declaration the parser drops in silence. */
    expect(build({ $description: "a", $anything: "b", color: "red" })[0]!.text).toBe(
      ":root { color: red }",
    );
    // A block that is nothing BUT metadata emits no rule, rather than an empty one.
    expect(build({ $description: "a" })).toEqual([]);
  });

  test("an empty or non-string description is not carried", () => {
    expect(build({ $description: "", color: "red" })[0]!.description).toBeUndefined();
    expect(build({ $description: 42, color: "red" })[0]!.description).toBeUndefined();
  });
});

describe("buildStyleRules on a key written more than once", () => {
  const rules = (style: unknown) =>
    css.buildStyleRules(style as never, { scope: ":root" }).map((rule) => rule.text);

  test("a declaration at-rule may hold several blocks, emitted in order", () => {
    /* An object's keys are unique, so `@font-face` — the at-rule whose identity is NOT in its key —
       had no spelling for a family's second weight. Studio ships three JetBrains Mono faces. */
    expect(
      rules({
        "@font-face": [
          { fontFamily: "JetBrains Mono", fontWeight: "400", src: 'url("a.woff2")' },
          { fontFamily: "JetBrains Mono", fontWeight: "700", src: 'url("b.woff2")' },
        ],
      }),
    ).toEqual([
      '@font-face { font-family: JetBrains Mono; font-weight: 400; src: url("a.woff2") }',
      '@font-face { font-family: JetBrains Mono; font-weight: 700; src: url("b.woff2") }',
    ]);
  });

  test("every declaration at-rule takes the form, and each block is its own rule", () => {
    for (const key of ["@font-face", "@property --a", "@position-try --p", "@counter-style c"]) {
      expect(rules({ [key]: [{ syntax: "a" }, { syntax: "b" }] }).length, key).toBe(2);
    }
  });

  test("one block under the same key still means one rule", () => {
    expect(rules({ "@font-face": { fontFamily: "A" } })).toEqual(["@font-face { font-family: A }"]);
  });

  test("a SELECTOR key takes no array, and is unchanged by this", () => {
    /* Deliberately still dropped. Under a selector an array says what one block already says, and
       every other style walker in the repo — the overlay lint, the a11y lint, the canvas — assumes
       a block key holds one block. Admitting it there would leave those reading past it in
       silence. */
    expect(rules({ "&:hover": [{ color: "red" }] })).toEqual([]);
    expect(rules({ "@media (min-width: 40em)": [{ color: "red" }] })).toEqual([]);
  });

  test("an array is never read as a declaration value", () => {
    // It used to reach `String(value)` and emit `@font-face: [object Object]` as a declaration.
    expect(rules({ color: [{ a: "1" }] })).toEqual([]);
    expect(rules({ "@font-face": [] })).toEqual([]);
    expect(rules({ "@font-face": [{ fontFamily: "A" }, "not-a-block"] })).toEqual([]);
  });
});

describe("hashCss keys a rule by what it says", () => {
  test("identical style objects produce identical keys", () => {
    const of = () => css.buildStyleRules({ ":hover": { color: "b" }, color: "a" }, { scope: ".s" });
    expect(of().map((r) => r.key)).toEqual(of().map((r) => r.key));
  });

  test("a changed value changes the key", () => {
    const [a] = css.buildStyleRules({ color: "a" }, { scope: ".s" });
    const [b] = css.buildStyleRules({ color: "b" }, { scope: ".s" });
    expect(a?.key === b?.key).toBe(false);
  });

  test("it stays base36 when the mix goes negative", () => {
    // `>>> 0` before `toString(36)`, or a hash lands as `-1x2y` and reads as two dashed idents.
    for (const input of ["a", "the-quick-brown-fox", ".s:hover { color: rebeccapurple }"]) {
      expect({ input, key: css.hashCss(input) }).toMatchObject({
        input,
        key: expect.stringMatching(/^[0-9a-z]+$/),
      });
    }
  });
});
