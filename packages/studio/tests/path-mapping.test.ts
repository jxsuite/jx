import "./harness";
import { describe, expect, test } from "bun:test";
import {
  classifyRenderNode,
  enclosingRepeaterPaths,
  jxInstanceSelector,
  pageDocPath,
  parseJxPath,
  rowsOf,
  serializeJxPath,
  stampedPathOf,
  stripRowIndices,
  withRowIndices,
} from "../src/canvas/path-mapping";
import type { PathMapCtx } from "../src/canvas/path-mapping";

const plain: PathMapCtx = {
  canvasMode: "design",
  layoutWrapped: false,
  pageContentOffset: null,
  pageContentPrefix: null,
};

describe("serializeJxPath / parseJxPath", () => {
  test("round-trips, preserving string-vs-number segments", () => {
    const path = ["children", 0, "map", 2];
    const s = serializeJxPath(path);
    expect(s).toBe('["children",0,"map",2]');
    expect(parseJxPath(s)).toEqual(path);
  });
});

describe("classifyRenderNode", () => {
  test("passes non-layout, non-repeater paths through unchanged", () => {
    expect(classifyRenderNode(["children", 1], { tagName: "p" }, plain)).toEqual({
      kind: "path",
      path: ["children", 1],
      rows: [],
    });
  });

  test("flags layout-originated nodes only when layout-wrapped, carrying their origin", () => {
    const ctx = { ...plain, layoutWrapped: true };
    const marker = { $__layout: { file: "layouts/base.json", path: ["children", 0] } };
    expect(classifyRenderNode(["children", 0], marker, ctx)).toEqual({
      chrome: true,
      kind: "layout",
      layoutFile: "layouts/base.json",
      layoutPath: ["children", 0],
    });
    // Not layout-wrapped → the $__layout marker is ignored.
    expect(classifyRenderNode(["children", 0], marker, plain)).toEqual({
      kind: "path",
      path: ["children", 0],
      rows: [],
    });
  });

  test("a legacy boolean marker still classifies, with an empty origin", () => {
    // The marker was a bare `true` before it carried an origin; degrade to "layout, unaddressable"
    // Rather than mistaking the node for page content and stamping it with a page path.
    const ctx = { ...plain, layoutWrapped: true };
    expect(classifyRenderNode(["children", 0], { $__layout: true }, ctx)).toEqual({
      chrome: true,
      kind: "layout",
      layoutFile: "",
      layoutPath: [],
    });
  });

  test("the nodes on the way down to the page content are NOT chrome", () => {
    // Dimming/freezing them would dim and freeze the page itself: they wrap it.
    const ctx: PathMapCtx = {
      ...plain,
      layoutWrapped: true,
      pageContentPrefix: ["children", 1, "children"],
    };
    const marker = (path: (string | number)[]) => ({ $__layout: { file: "l.json", path } });
    // The layout root and the <main> that holds the slot.
    expect(classifyRenderNode([], marker([]), ctx)).toMatchObject({ chrome: false });
    expect(classifyRenderNode(["children", 1], marker(["children", 1]), ctx)).toMatchObject({
      chrome: false,
    });
    // A sibling header, and a layout <noscript> sitting BEFORE the slot inside <main>.
    expect(classifyRenderNode(["children", 0], marker(["children", 0]), ctx)).toMatchObject({
      chrome: true,
    });
    expect(classifyRenderNode(["children", 1, "children", 0], marker(["c"]), ctx)).toMatchObject({
      chrome: true,
    });
  });

  test("with no page content distributed, only the root escapes chrome", () => {
    const ctx = { ...plain, layoutWrapped: true };
    const marker = { $__layout: { file: "l.json", path: [] } };
    expect(classifyRenderNode([], marker, ctx)).toMatchObject({ chrome: false });
    expect(classifyRenderNode(["children", 0], marker, ctx)).toMatchObject({ chrome: true });
  });

  test("strips the layout prefix and subtracts the page-content offset", () => {
    const ctx: PathMapCtx = {
      ...plain,
      layoutWrapped: true,
      pageContentOffset: 1,
      pageContentPrefix: ["children", 0, "children"],
    };
    // Render path under the layout prefix, container index 2 → page child index 2 - 1 = 1.
    expect(classifyRenderNode(["children", 0, "children", 2, "children", 3], {}, ctx)).toEqual({
      kind: "path",
      path: ["children", 1, "children", 3],
      rows: [],
    });
  });

  test("a row's index is a coordinate of its own, never part of the path", () => {
    // The runtime draws row 3 of the repeater at ["children", 2] at [...P, "map", 3, ...rest].
    expect(classifyRenderNode(["children", 2, "map", 3, "children", 1], {}, plain)).toEqual({
      kind: "path",
      path: ["children", 2, "map", "children", 1],
      rows: [3],
    });
    // Every row's instance of a node has the template's path, so the paths of two rows are equal.
    const first = classifyRenderNode(["children", 2, "map", 0, "children", 1], {}, plain);
    const fourth = classifyRenderNode(["children", 2, "map", 3, "children", 1], {}, plain);
    expect(first).toMatchObject({ path: ["children", 2, "map", "children", 1], rows: [0] });
    expect(fourth).toMatchObject({ path: ["children", 2, "map", "children", 1], rows: [3] });
  });

  test("a row's root, a nested repeater and a whole-children repeater each strip", () => {
    expect(classifyRenderNode(["children", 2, "map", 5], {}, plain)).toEqual({
      kind: "path",
      path: ["children", 2, "map"],
      rows: [5],
    });
    // Outer row 1, inner row 4: one coordinate per repeater, outermost first.
    expect(
      classifyRenderNode(
        ["children", 0, "map", 1, "children", 2, "map", 4, "children", 0],
        {},
        plain,
      ),
    ).toEqual({
      kind: "path",
      path: ["children", 0, "map", "children", 2, "map", "children", 0],
      rows: [1, 4],
    });
    expect(classifyRenderNode(["children", 0, "children", "map", 2], {}, plain)).toEqual({
      kind: "path",
      path: ["children", 0, "children", "map"],
      rows: [2],
    });
  });

  test("rows are stripped below a layout prefix, in every mode that renders them", () => {
    const ctx: PathMapCtx = {
      ...plain,
      canvasMode: "git-diff",
      layoutWrapped: true,
      pageContentOffset: 1,
      pageContentPrefix: ["children", 0, "children"],
    };
    expect(
      classifyRenderNode(["children", 0, "children", 3, "map", 2, "children", 0], {}, ctx),
    ).toEqual({ kind: "path", path: ["children", 2, "map", "children", 0], rows: [2] });
    // The prefix alone, with the rows left in: what a list's own render path maps to.
    expect(pageDocPath(["children", 0, "children", 3, "map", 2], ctx)).toEqual([
      "children",
      2,
      "map",
      2,
    ]);
    // A path that is not under the prefix is not the page's, and is left as it is.
    expect(pageDocPath(["children", 4], ctx)).toEqual(["children", 4]);
  });
});

describe("row coordinates", () => {
  test("a $switch case named `map` is a key, not a row", () => {
    // The body of a case is a node, so no number follows; a `cases` key is skipped all the same.
    expect(stripRowIndices(["cases", "map", "children", 0])).toEqual({
      path: ["cases", "map", "children", 0],
      rows: [],
    });
    expect(stripRowIndices(["cases", "map", 3])).toEqual({ path: ["cases", "map", 3], rows: [] });
    expect(enclosingRepeaterPaths(["cases", "map", "children", 0])).toEqual([]);
    expect(withRowIndices(["cases", "map", "children", 0], [7])).toEqual([
      "cases",
      "map",
      "children",
      0,
    ]);
  });

  test("the repeaters around a path are the prefixes before each map", () => {
    expect(enclosingRepeaterPaths(["children", 1])).toEqual([]);
    expect(
      enclosingRepeaterPaths(["children", 0, "map", "children", 2, "map", "children", 0]),
    ).toEqual([
      ["children", 0],
      ["children", 0, "map", "children", 2],
    ]);
  });

  test("withRowIndices is the inverse of stripRowIndices", () => {
    const render = ["children", 0, "map", 1, "children", 2, "map", 4, "children", 0];
    const { path, rows } = stripRowIndices(render);
    expect(withRowIndices(path, rows)).toEqual(render);
    // A repeater with no row named is left without one, and extra rows name nothing.
    expect(withRowIndices(path, [1])).toEqual([
      "children",
      0,
      "map",
      1,
      "children",
      2,
      "map",
      "children",
      0,
    ]);
    expect(withRowIndices(["children", 1], [9])).toEqual(["children", 1]);
  });

  test("an element's path and rows are read from whichever attribute holds them", () => {
    document.body.innerHTML =
      `<p id="a" data-jx-path='["children",0,"map"]' data-jx-row="[0]"></p>` +
      `<p id="b" data-jx-echo-path='["children",0,"map"]' data-jx-row="[1]"></p>` +
      `<p id="c"></p>`;
    const [a, b, c] = ["a", "b", "c"].map((id) => document.querySelector<HTMLElement>(`#${id}`)!);
    expect(stampedPathOf(a!)).toBe('["children",0,"map"]');
    expect(stampedPathOf(b!)).toBe('["children",0,"map"]');
    expect(stampedPathOf(c!)).toBeUndefined();
    expect(rowsOf(a!)).toEqual([0]);
    expect(rowsOf(b!)).toEqual([1]);
    expect(rowsOf(c!)).toEqual([]);
    // Both rows answer the instance selector; a path with a quote in it is escaped like the other.
    const selector = jxInstanceSelector('["children",0,"map"]');
    expect(document.querySelectorAll(selector).length).toBe(2);
    expect(jxInstanceSelector(`["it's"]`)).toContain(String.raw`it\'s`);
    document.body.innerHTML = "";
  });
});
