import { describe, expect, test } from "bun:test";
import {
  buildComponentCSS,
  collectSrcImports,
  compileStyles,
  hasAnyIsland,
  isComponentFullyStatic,
  isNodeDynamic,
  renderStaticNode,
  resolveRefValue,
} from "../src/shared";
import type { JsonObject, JxElement, JxStyle } from "@jxsuite/schema/types";

/**
 * A style block as a JSON document can carry it, including entries `JxStyle` does not admit (the
 * numeric `arr` arrays below), which the emitter must skip rather than print.
 */
function styleFromJson(json: JsonObject): JxStyle {
  /* SAFETY: style blocks reach `buildStyleRules` from parsed documents, so it classifies every entry
     at runtime: an object that is not a block (a numeric array included) makes `declarationValue`
     return null and the entry is dropped. The non-`JxStyle` entries here exist to reach that branch. */
  return json as JxStyle;
}

describe("isNodeDynamic — style template string", () => {
  test("template string in style marks node dynamic", () => {
    expect(isNodeDynamic({ style: { color: "${theme}" }, tagName: "div" })).toBe(true);
  });
});

describe("hasAnyIsland — non-object", () => {
  test("string is never an island", () => {
    expect(hasAnyIsland("just text")).toBe(false);
  });
});

describe("resolveRefValue — non-string passthrough", () => {
  test("returns non-string ref values unchanged", () => {
    expect(resolveRefValue(42, {})).toBe(42);
    expect(resolveRefValue(null, {})).toBeNull();
  });
});

describe("collectSrcImports — string children", () => {
  test("string children are skipped", () => {
    const srcs = collectSrcImports({
      children: ["raw text", { tagName: "div" }],
      tagName: "div",
    });
    expect(srcs).toEqual([]);
  });
});

describe("compileStyles — projectStyle deep nesting", () => {
  test("nested selectors, media blocks, & selectors and recursion", () => {
    const projectStyle = styleFromJson({
      ".card": {
        ".child": {
          deep: { lineHeight: "1.5" },
          fontSize: "2rem",
        },
        "& span": { fontWeight: "bold" },
        "@(min-width: 600px)": {
          ".inner": { margin: "0" },
          "@nested": { foo: "bar" },
          arr: [1, 2],
          "&:hover": { color: "blue" },
          padding: "1rem",
        },
        color: "red",
        skipString: "x",
      },
      html: { margin: "0" },
    });
    const result = compileStyles({ children: [], tagName: "div" }, {}, projectStyle);
    expect(result).toContain(".card {");
    expect(result).toContain("(min-width: 600px)");
    expect(result).toContain(".card:hover");
    expect(result).toContain(".card.inner");
    expect(result).toContain(".card span");
    expect(result).toContain(".card.child");
    expect(result).toContain("html {");
  });

  test("projectStyle @--named media block resolves from mediaQueries", () => {
    const result = compileStyles(
      { children: [], tagName: "div" },
      { "--mobile": "(max-width: 600px)" },
      { "@--mobile": { backgroundColor: "#111" } },
    );
    expect(result).toContain("@media (max-width: 600px)");
    expect(result).toContain("body {");
  });
});

describe("compileStyles — element-level nested selectors", () => {
  test("nested selector with media, sub-selectors and recursion", () => {
    const doc = {
      children: [],
      id: "box",
      style: styleFromJson({
        ".child": {
          ".grand": { lineHeight: "1.5" },
          "& > span": { fontWeight: "bold" },
          "@(min-width: 700px)": {
            ".deep": { margin: "0" },
            "@bad": { x: "y" },
            arr: [1],
            "&:hover": { color: "blue" },
            padding: "2rem",
          },
          color: "red",
        },
      }),
      tagName: "div",
    };
    const result = compileStyles(doc);
    expect(result).toContain("#box.child {");
    expect(result).toContain("@media (min-width: 700px)");
    expect(result).toContain("#box.child:hover");
    expect(result).toContain("#box.child.deep");
    expect(result).toContain("#box.child > span");
    expect(result).toContain("#box.child.grand");
  });
});

describe("compileStyles — the nesting the compiler used to drop", () => {
  test("@media then selector then pseudo now emits all three levels", () => {
    /* The compiler emitted ONE selector level inside an at-rule group and dropped anything under
       it, so `@media → .child → :hover` was silently lost. It is the mirror of the runtime's own
       defect (which dropped `selector → @media`), which is why preview and shipped page disagreed
       in both directions. */
    const result = compileStyles({
      children: [],
      id: "box",
      style: { "@(min-width: 700px)": { ".child": { ":hover": { color: "blue" } } } },
      tagName: "div",
    });
    expect(result).toContain("@media (min-width: 700px) { #box.child:hover { color: blue } }");
  });

  test("at-rules compose to any depth, in either order", () => {
    const result = compileStyles({
      children: [],
      id: "box",
      style: {
        ":hover": { "@supports (display: grid)": { "@(min-width: 1px)": { display: "grid" } } },
      },
      tagName: "div",
    });
    expect(result).toContain(
      "@supports (display: grid) { @media (min-width: 1px) { #box:hover { display: grid } } }",
    );
  });

  test("a component's nested selector recurses too", () => {
    // `buildComponentCSS` emitted exactly one level and dropped whatever was below it.
    const css = buildComponentCSS("my-el", { "& .inner": { ":hover": { color: "blue" } } });
    expect(css).toContain("my-el .inner:hover { color: blue }");
  });

  test(":host is still translated, in both modes", () => {
    // The one top-level key that does NOT resolve like ordinary nesting.
    expect(buildComponentCSS("my-el", { ":host(.wide)": { gap: "1rem" } })).toContain(
      "my-el.wide { gap: 1rem }",
    );
    expect(
      buildComponentCSS("my-el", { ":host(.wide)": { gap: "1rem" } }, null, {}, "open"),
    ).toContain(":host(.wide) { gap: 1rem }");
  });
});

describe("collectStyles — $switch case styles", () => {
  test("styles inside $switch cases are collected", () => {
    const doc = {
      $switch: "k",
      cases: {
        a: { id: "case-a", style: { color: "red" }, tagName: "div" },
      },
      tagName: "div",
    };
    const result = compileStyles(doc);
    expect(result).toContain("#case-a");
    expect(result).toContain("color: red");
  });
});

describe("renderStaticNode — $switch", () => {
  test("renders the matched case inside the container", () => {
    const html = renderStaticNode(
      {
        $switch: "a",
        cases: { a: { tagName: "span", textContent: "Hello" } },
        tagName: "div",
      },
      {},
    );
    expect(html).toContain("<div>");
    expect(html).toContain("<span>Hello</span>");
  });

  test("renders empty container when no case matches", () => {
    const html = renderStaticNode(
      {
        $switch: { $ref: "#/state/missing" },
        cases: { a: { tagName: "span", textContent: "X" } },
        tagName: "section",
      },
      {},
    );
    expect(html).toBe("<section></section>");
  });

  test("renders empty container when matched case is an external $ref", () => {
    const html = renderStaticNode(
      {
        $switch: "a",
        cases: { a: { $ref: "./external.json" } },
        tagName: "div",
      },
      {},
    );
    expect(html).toBe("<div></div>");
  });
});

describe("isComponentFullyStatic — dynamic markers", () => {
  test("nested array children are walked", () => {
    const nested: JsonObject = { children: [[{ tagName: "span" }]] };
    /* SAFETY: deliberately unsound. A JSON component can nest an array inside `children`, which
       JxElement omits; the walker must still treat it as static, which is what this test pins. */
    expect(isComponentFullyStatic(nested as JxElement)).toBe(true);
  });

  test("$prototype node is not static", () => {
    expect(isComponentFullyStatic({ children: [{ $prototype: "Request" }] })).toBe(false);
  });

  test("$ref node is not static", () => {
    expect(isComponentFullyStatic({ children: [{ $ref: "#/x" }] })).toBe(false);
  });

  test("state entry with $ref is not static", () => {
    expect(isComponentFullyStatic({ state: { x: { $ref: "#/y" } } })).toBe(false);
  });
});

describe("buildComponentCSS — media blocks", () => {
  test("@--named and @(...) media blocks", () => {
    const css = buildComponentCSS(
      "my-el",
      {
        "@(min-width: 1px)": { color: "green" },
        "@--mobile": { color: "red" },
      },
      null,
      { "--mobile": "(max-width: 600px)" },
    );
    expect(css).toContain("@media (max-width: 600px) { my-el {");
    expect(css).toContain("@media (min-width: 1px) { my-el {");
  });

  test("a non-object @-block value is ignored", () => {
    const css = buildComponentCSS("my-el", {
      "@--mobile": "not-an-object",
      color: "red",
    });
    expect(css).toContain("my-el { color: red }");
    expect(css).not.toContain("@media");
    expect(css).not.toContain("not-an-object");
  });
});
