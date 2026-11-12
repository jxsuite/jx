/**
 * The row bookkeeping of the canvas frame (`src/canvas/iframe-rows.ts`, studio.md §4.5), below the
 * end-to-end run in `canvas-rows.test.ts`: nested repeaters, the clamp, a keyed list that reorders,
 * a list that fills and empties after the first draw, and where a drop or an insert aimed at a
 * row's root lands.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { flush, stubRect } from "./harness";
import { reactive } from "@vue/reactivity";
import { renderNode } from "@jxsuite/runtime";
import { computeDropInstruction, resolveDropTarget } from "../src/canvas/iframe-drop";
import { bindRepeaterContext } from "../src/canvas/iframe-eval";
import { computeInsertZones } from "../src/canvas/iframe-insert";
import { nearestHit } from "../src/canvas/iframe-interaction";
import { makeStamper, prepareResolvedDocument } from "../src/canvas/iframe-render";
import {
  activeRowsRecord,
  adoptActiveRows,
  instancesOf,
  isActiveRow,
  nearestStampedEl,
  newRowView,
  normalizeRowLimit,
  promoteRowAt,
  repeaterRect,
  restampMovedRow,
  rowHooks,
  syncRows,
} from "../src/canvas/iframe-rows";
import { rowsOf, stampedPathOf } from "../src/canvas/path-mapping";
import { repeaterSampleItems } from "../src/editor/repeater-scope";
import { prepareForEditMode } from "../src/utils/edit-display";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { PathMapCtx } from "../src/canvas/path-mapping";
import type { RowView } from "../src/canvas/iframe-rows";
import type { JxPath } from "../src/state";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxMutableNode } from "@jxsuite/schema/types";

const MAPPER: PathMapCtx = {
  canvasMode: "edit",
  layoutWrapped: false,
  pageContentOffset: null,
  pageContentPrefix: null,
};

afterEach(() => {
  document.body.innerHTML = "";
});

/** What {@link draw} hands back: the tree, the view it was stamped with, and how often it redrew. */
interface Drawn {
  root: HTMLElement;
  view: RowView;
  redraws: () => number;
}

/** Draw `doc` as the frame does: prepared, with the list hooks, stamped, mounted and settled. */
function draw(
  doc: JxMutableNode,
  scope: JxScope,
  view: RowView = newRowView(),
  ctx: PathMapCtx = MAPPER,
): Drawn {
  const prepared = prepareForEditMode(structuredClone(doc));
  let redraws = 0;
  let live: HTMLElement | null = null;
  const hooks = rowHooks(view, ctx, () => {
    if (live) {
      redraws += 1;
      syncRows(live, view);
    }
  });
  const root = renderNode(prepared, scope, {
    ...hooks,
    _path: [],
    onNodeCreated: makeStamper(ctx, view),
  });
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  document.body.append(root);
  syncRows(root, view);
  live = root;
  return { redraws: () => redraws, root, view };
}

/** Each element drawn for `path`, as `row coordinates → addressable?`. */
function stamps(root: ParentNode, path: JxPath): Record<string, boolean> {
  return Object.fromEntries(
    instancesOf(root, path).map((el) => [rowsOf(el).join("."), el.dataset.jxPath !== undefined]),
  );
}

/** The paths more than one element carries as `data-jx-path`. */
function duplicates(root: ParentNode): string[] {
  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-jx-path]")) {
    seen.set(el.dataset.jxPath ?? "", (seen.get(el.dataset.jxPath ?? "") ?? 0) + 1);
  }
  return [...seen].flatMap(([key, count]) => (count > 1 ? [key] : []));
}

const OUTER: JxPath = ["children", 0];
const OUTER_ROW: JxPath = [...OUTER, "map"];
const INNER: JxPath = [...OUTER_ROW, "children", 1];
const INNER_ROW: JxPath = [...INNER, "map"];
const NAME: JxPath = [...OUTER_ROW, "children", 0];

/** Seasons, each a heading and a list of episodes: a repeater inside a repeater. */
const NESTED: JxMutableNode = {
  children: [
    {
      $prototype: "Array",
      items: { $ref: "#/state/seasons" },
      map: {
        children: [
          { tagName: "h2", textContent: "${item.name}" },
          {
            $prototype: "Array",
            items: { $ref: "$map/item/episodes" },
            map: { tagName: "li", textContent: "${item}" },
          },
        ],
        tagName: "section",
      },
    },
  ],
  tagName: "main",
};

const SEASONS = [
  { episodes: ["a1", "a2", "a3"], name: "One" },
  { episodes: ["b1"], name: "Two" },
  { episodes: ["c1", "c2"], name: "Three" },
];

describe("nested repeaters", () => {
  test("a node is addressable only in the active row of EVERY repeater around it", () => {
    const { root } = draw(NESTED, { seasons: SEASONS });
    expect(stamps(root, NAME)).toEqual({ "0": true, "1": false, "2": false });
    // Six episodes are drawn, and one is addressable: outer row 0, inner row 0.
    expect(stamps(root, INNER_ROW)).toEqual({
      "0.0": true,
      "0.1": false,
      "0.2": false,
      "1.0": false,
      "2.0": false,
      "2.1": false,
    });
    expect(duplicates(root)).toEqual([]);
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
      "c1",
      "c2",
    ]);
  });

  test("a press makes every repeater around the pressed node active at the pressed coordinates", () => {
    const { root, view } = draw(NESTED, { seasons: SEASONS });
    const pressed = instancesOf(root, INNER_ROW).find((el) => el.textContent === "c2")!;
    expect(promoteRowAt(pressed, root, view)).toEqual([
      { path: OUTER, row: 2 },
      { path: INNER, row: 1 },
    ]);
    expect(pressed.dataset.jxPath).toBe(JSON.stringify(INNER_ROW));
    expect(stamps(root, NAME)).toEqual({ "0": false, "1": false, "2": true });
    expect(stamps(root, INNER_ROW)).toEqual({
      "0.0": false,
      "0.1": false,
      "0.2": false,
      "1.0": false,
      "2.0": false,
      "2.1": true,
    });
    expect(duplicates(root)).toEqual([]);
    // Pressing it again changes nothing, and neither does a press on what is no echo.
    expect(promoteRowAt(pressed, root, view)).toBeNull();
    expect(promoteRowAt(root, root, view)).toBeNull();
    expect(promoteRowAt(null, root, view)).toBeNull();
  });

  test("an inner active row the outer row's list does not have is clamped to its last", () => {
    const { root, view } = draw(NESTED, { seasons: SEASONS });
    // Inner row 2 exists only in the first season. Make the SECOND season active, whose list has one.
    adoptActiveRows(view, { [JSON.stringify(OUTER)]: 1, [JSON.stringify(INNER)]: 2 });
    syncRows(root, view);
    expect(stamps(root, INNER_ROW)).toEqual({
      "0.0": false,
      "0.1": false,
      "0.2": false,
      "1.0": true,
      "2.0": false,
      "2.1": false,
    });
    // The third season has two: there the last it has is row 1.
    adoptActiveRows(view, { [JSON.stringify(OUTER)]: 2, [JSON.stringify(INNER)]: 2 });
    syncRows(root, view);
    expect(stamps(root, INNER_ROW)["2.1"]).toBe(true);
    expect(duplicates(root)).toEqual([]);
  });

  test("the stamper asks the view, and a path whose rows do not line up is plain", () => {
    const view = newRowView();
    adoptActiveRows(view, { [JSON.stringify(OUTER)]: 1 });
    expect(isActiveRow(view, NAME, [1])).toBe(true);
    expect(isActiveRow(view, NAME, [0])).toBe(false);
    expect(isActiveRow(view, INNER_ROW, [1, 0])).toBe(true);
    expect(isActiveRow(view, INNER_ROW, [1, 3])).toBe(false);
    expect(isActiveRow(view, ["children", 4], [])).toBe(true);
    // One coordinate for two repeaters: not a shape the stamper wrote, so not an echo.
    expect(isActiveRow(view, INNER_ROW, [0])).toBe(true);
  });
});

describe("the view the host names", () => {
  test("adoptActiveRows keeps row indices and drops everything else", () => {
    const view = newRowView();
    adoptActiveRows(view, { a: 2, b: -1, c: 1.5, d: "3", e: null, f: 0 });
    expect(activeRowsRecord(view)).toEqual({ a: 2, f: 0 });
    adoptActiveRows(view, null);
    expect(activeRowsRecord(view)).toEqual({});
  });

  test("a row cap is a whole number of rows, at least one and at most the maximum", () => {
    expect(normalizeRowLimit(5)).toBe(5);
    expect(normalizeRowLimit(100_000)).toBe(1000);
    for (const bad of [0, -3, 2.5, "9", null, undefined]) {
      expect(normalizeRowLimit(bad)).toBe(24);
    }
  });
});

describe("a list that redraws itself", () => {
  const KEYED: JxMutableNode = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        key: { $ref: "$map/item/id" },
        map: {
          children: [{ tagName: "b", textContent: "${item.id}" }],
          tagName: "li",
        },
      },
    ],
    tagName: "ul",
  };
  const ROW: JxPath = ["children", 0, "map"];
  const LABEL: JxPath = [...ROW, "children", 0];

  test("a keyed row reused at another index is restamped, subtree and all", async () => {
    const state = reactive({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const { redraws, root } = draw(KEYED, state);
    const byId = (id: string) =>
      [...root.querySelectorAll("li")].find((li) => li.textContent === id)!;
    const c = byId("c");
    expect(rowsOf(c)).toEqual([2]);
    expect(c.dataset.jxEchoPath).toBe(JSON.stringify(ROW));

    state.rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
    await flush();
    expect(redraws()).toBe(1);
    // The same node, now the first row: its coordinates moved, and so did the addressable stamp.
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["c", "a", "b"]);
    expect(byId("c")).toBe(c);
    expect(rowsOf(c)).toEqual([0]);
    expect(rowsOf(c.querySelector("b")!)).toEqual([0]);
    expect(c.dataset.jxPath).toBe(JSON.stringify(ROW));
    expect(stamps(root, LABEL)).toEqual({ "0": true, "1": false, "2": false });
    expect(duplicates(root)).toEqual([]);
  });

  test("a list that shrinks below its active row keeps an addressable one", async () => {
    const state = reactive({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const view = newRowView();
    adoptActiveRows(view, { '["children",0]': 2 });
    const { root } = draw(KEYED, state, view);
    expect(stamps(root, ROW)).toEqual({ "0": false, "1": false, "2": true });
    state.rows = [{ id: "a" }, { id: "b" }];
    await flush();
    expect(stamps(root, ROW)).toEqual({ "0": false, "1": true });
    // And when it grows back, the row the author chose is the active one again.
    state.rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    await flush();
    expect(stamps(root, ROW)).toEqual({ "0": false, "1": false, "2": true, "3": false });
  });

  test("the template row comes and goes with the list, and the cap's mark follows it", async () => {
    const state = reactive<{ rows: { id: string }[] }>({ rows: [] });
    const view = newRowView({ limit: 2, samples: { '["children",0]': { id: "" } } });
    const { root } = draw(KEYED, state, view);
    const rows = () => instancesOf(root, ROW);
    expect(rows().map((row) => row.dataset.jxTemplateRow)).toEqual([""]);
    state.rows = [{ id: "a" }];
    await flush();
    expect(rows().map((row) => row.dataset.jxTemplateRow ?? null)).toEqual([null]);
    expect(rows().map((row) => row.dataset.jxRowsMore ?? null)).toEqual([null]);
    state.rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    await flush();
    expect(rows().map((row) => row.dataset.jxRowsMore ?? null)).toEqual([null, "2 of 3 rows"]);
    state.rows = [{ id: "a" }, { id: "b" }];
    await flush();
    expect(rows().map((row) => row.dataset.jxRowsMore ?? null)).toEqual([null, null]);
    state.rows = [];
    await flush();
    expect(rows().map((row) => row.dataset.jxTemplateRow)).toEqual([""]);
  });

  test("restampMovedRow ignores what is no stamped row", () => {
    const text = document.createTextNode("x");
    expect(() => restampMovedRow(text, ["children", 0, "map", 1])).not.toThrow();
    const el = document.createElement("li");
    el.dataset.jxRow = "[4]";
    // A path that names no row leaves the coordinates alone.
    restampMovedRow(el, ["children", 0]);
    expect(rowsOf(el)).toEqual([4]);
    restampMovedRow(el, ["children", 0, "map", 1]);
    expect(rowsOf(el)).toEqual([1]);
  });
});

describe("an echo row is closed to the caret, and opens when it is the active one", () => {
  const SLOTTED: JxMutableNode = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: {
          children: [
            // A component instance is an island; the page content slotted into it is re-opened.
            { children: [{ tagName: "p", textContent: "${item}" }], tagName: "x-rows-card" },
            { innerHTML: "${item}", tagName: "div" },
          ],
          tagName: "article",
        },
      },
    ],
    tagName: "main",
  };

  test("only what the echo closed is re-opened: an island and content drawn from data stay shut", () => {
    const { root, view } = draw(SLOTTED, { rows: ["one", "two"] });
    const [first, second] = [...root.querySelectorAll<HTMLElement>("article")];
    const editable = (el: Element | null | undefined) =>
      el?.getAttribute("contenteditable") ?? null;
    // The active row: open, its island closed, the paragraph slotted into the island re-opened.
    expect(editable(first)).toBeNull();
    expect(editable(first?.querySelector("x-rows-card"))).toBe("false");
    expect(editable(first?.querySelector("p"))).toBe("true");
    // The echo row: closed at its root, and the re-opened paragraph closed with it.
    expect(editable(second)).toBe("false");
    expect(editable(second?.querySelector("p"))).toBe("false");
    expect(editable(second?.querySelector("div"))).toBe("false");

    promoteRowAt(second!, root, view);
    expect(editable(second)).toBeNull();
    expect(editable(second?.querySelector("x-rows-card"))).toBe("false");
    expect(editable(second?.querySelector("p"))).toBe("true");
    // Content drawn from data was closed by the document, not by the echo, and stays closed.
    expect(editable(second?.querySelector("div"))).toBe("false");
    expect(editable(first)).toBe("false");
    expect(editable(first?.querySelector("p"))).toBe("false");
  });

  test("a row whose root is itself closed stays closed when it becomes the active row", () => {
    const doc: JxMutableNode = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { tagName: "x-rows-chip", textContent: "x" },
        },
      ],
      tagName: "main",
    };
    const { root, view } = draw(doc, { rows: [1, 2] });
    const [, second] = [...root.querySelectorAll<HTMLElement>("x-rows-chip")];
    expect(second?.getAttribute("contenteditable")).toBe("false");
    promoteRowAt(second!, root, view);
    expect(second?.dataset.jxPath).toBe('["children",0,"map"]');
    expect(second?.getAttribute("contenteditable")).toBe("false");
  });
});

describe("a list inside a layout", () => {
  /** A layout whose own nav is a list, around a page whose list is drawn into the slot. */
  const WRAPPED: PathMapCtx = {
    canvasMode: "edit",
    layoutWrapped: true,
    pageContentOffset: 0,
    pageContentPrefix: ["children", 1, "children"],
  };
  const layoutMark = (path: JxPath) => ({ $__layout: { file: "layouts/base.json", path } });
  const doc: JxMutableNode = {
    ...layoutMark([]),
    children: [
      {
        ...layoutMark(["children", 0]),
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/links" },
            map: { ...layoutMark(["children", 0, "children", "map"]), tagName: "a" },
          },
        ],
        tagName: "nav",
      },
      {
        ...layoutMark(["children", 1]),
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/posts" },
            map: { tagName: "article", textContent: "${item}" },
          },
        ],
        tagName: "main",
      },
    ],
    tagName: "div",
  };

  test("the page's empty list shows its template; the layout's own draws what the page will", () => {
    const { root } = draw(doc, { links: [], posts: [] }, newRowView(), WRAPPED);
    // The page's repeater is the page document's first child, whatever the layout put around it.
    const articles = [...root.querySelectorAll<HTMLElement>("article")];
    expect(articles.map((el) => el.dataset.jxPath)).toEqual(['["children",0,"map"]']);
    expect(articles[0]?.dataset.jxTemplateRow).toBe("");
    // The layout's nav has no links, and gets no made-up one: it is chrome, not the page.
    expect(root.querySelectorAll("a")).toHaveLength(0);
  });

  test("rows of the page's list are stamped with page paths, and the layout's stay chrome", () => {
    const { root } = draw(
      doc,
      { links: ["/", "/about"], posts: ["p1", "p2"] },
      newRowView(),
      WRAPPED,
    );
    expect(stamps(root, ["children", 0, "map"])).toEqual({ "0": true, "1": false });
    const links = [...root.querySelectorAll<HTMLElement>("a")];
    expect(links).toHaveLength(2);
    expect(links.some((a) => stampedPathOf(a) !== undefined)).toBe(false);
    expect(links.every((a) => a.dataset.jxLayoutFile === "layouts/base.json")).toBe(true);
  });
});

describe("the repeater's box", () => {
  test("is the union of its rendered rows, and null when it has none", () => {
    document.body.innerHTML =
      `<ul><li data-jx-path='["children",0,"map"]' data-jx-row="[0]"></li>` +
      `<li data-jx-echo-path='["children",0,"map"]' data-jx-row="[1]"></li>` +
      `<li data-jx-echo-path='["children",0,"map"]' data-jx-row="[2]"></li></ul>`;
    const [a, b, c] = [...document.querySelectorAll("li")];
    stubRect(a!, { height: 10, left: 5, top: 0, width: 50 });
    stubRect(b!, { height: 10, left: 0, top: 20, width: 80 });
    stubRect(c!, { height: 10, left: 5, top: 40, width: 50 });
    expect(repeaterRect(document, ["children", 0], () => true)).toEqual({
      rect: { height: 50, width: 80, x: 0, y: 0 },
      rows: 3,
    });
    // A row that is not rendered contributes nothing; with none rendered there is no box.
    expect(repeaterRect(document, ["children", 0], (el) => el !== c).rect).toEqual({
      height: 30,
      width: 80,
      x: 0,
      y: 0,
    });
    expect(repeaterRect(document, ["children", 0], () => false)).toEqual({ rect: null, rows: 3 });
    expect(repeaterRect(document, ["children", 7], () => true)).toEqual({ rect: null, rows: 0 });
  });
});

describe("pointing at a row", () => {
  /** A list of three stamped rows between a heading and a footer, with stubbed rects. */
  function list() {
    document.body.innerHTML =
      `<section data-jx-path='["children",1]'>` +
      `<h2 data-jx-path='["children",1,"children",0]'>Head</h2>` +
      `<article data-jx-path='["children",1,"children",1,"map"]' data-jx-row="[0]"><b data-jx-path='["children",1,"children",1,"map","children",0]' data-jx-row="[0]">a</b></article>` +
      `<article data-jx-echo-path='["children",1,"children",1,"map"]' data-jx-row="[1]"><b data-jx-echo-path='["children",1,"children",1,"map","children",0]' data-jx-row="[1]">b</b></article>` +
      `<article data-jx-echo-path='["children",1,"children",1,"map"]' data-jx-row="[2]"><b data-jx-echo-path='["children",1,"children",1,"map","children",0]' data-jx-row="[2]">c</b></article>` +
      `</section>`;
    const rows = [...document.querySelectorAll<HTMLElement>("article")];
    for (const [i, row] of rows.entries()) {
      stubRect(row, { height: 100, left: 0, top: 100 + i * 100, width: 400 });
    }
    return { parent: document.querySelector<HTMLElement>("section")!, rows };
  }
  const DOC: JxMutableNode = {
    children: [
      { tagName: "h1" },
      {
        children: [
          { tagName: "h2", textContent: "Head" },
          {
            $prototype: "Array",
            items: [],
            map: { children: [{ tagName: "b", textContent: "x" }], tagName: "article" },
          },
        ],
        tagName: "section",
      },
    ],
    tagName: "main",
  };
  const LIST: JxPath = ["children", 1, "children", 1];
  const SECTION: JxPath = ["children", 1];

  test("an insert zone on a row's root is a place beside the repeater, at the list's two ends only", () => {
    const { rows } = list();
    // The first row's leading edge: before the repeater, which is child 1 of the section.
    expect(computeInsertZones(rows[0]!, { x: 50, y: 105 }, DOC)).toEqual([
      {
        edge: "top",
        index: 1,
        insertParentPath: SECTION,
        rect: { height: 0, width: 400, x: 0, y: 100 },
      },
    ]);
    // The last row's trailing edge: after it. An echo row is aimed at like the active one.
    expect(computeInsertZones(rows[2]!, { x: 50, y: 395 }, DOC)).toEqual([
      {
        edge: "bottom",
        index: 2,
        insertParentPath: SECTION,
        rect: { height: 0, width: 400, x: 0, y: 400 },
      },
    ]);
    // Between two rows there is nowhere to insert: a template has one root.
    expect(computeInsertZones(rows[0]!, { x: 50, y: 195 }, DOC)).toBeNull();
    expect(computeInsertZones(rows[1]!, { x: 50, y: 205 }, DOC)).toBeNull();
    expect(computeInsertZones(rows[1]!, { x: 50, y: 295 }, DOC)).toBeNull();
    expect(computeInsertZones(rows[2]!, { x: 50, y: 305 }, DOC)).toBeNull();
  });

  test("an empty row root still offers its own inside, and a node within a row is a sibling as ever", () => {
    const { rows } = list();
    rows[1]!.classList.add("empty-container-placeholder");
    expect(computeInsertZones(rows[1]!, { x: 50, y: 250 }, DOC)).toEqual([
      {
        edge: "center",
        index: 0,
        insertParentPath: [...LIST, "map"],
        rect: { height: 100, width: 400, x: 0, y: 200 },
      },
    ]);
    const inner = rows[2]!.querySelector<HTMLElement>("b")!;
    stubRect(inner, { height: 20, left: 0, top: 310, width: 100 });
    expect(computeInsertZones(inner, { x: 5, y: 312 }, DOC)?.[0]).toMatchObject({
      edge: "top",
      index: 0,
      insertParentPath: [...LIST, "map"],
    });
  });

  test("a drop on a row's root lands beside the repeater, drawn on the whole list", () => {
    const { rows } = list();
    const src = { type: "block" as const };
    const whole = { height: 300, width: 400, x: 0, y: 100 };
    // The upper band of ANY row is above the repeater; the lower band, below it.
    expect(computeDropInstruction(rows[1]!, 205, DOC, src)).toEqual({
      edge: "top",
      instruction: "reorder-above",
      referenceRect: whole,
      targetPath: LIST,
    });
    expect(computeDropInstruction(rows[2]!, 395, DOC, src)).toEqual({
      edge: "bottom",
      instruction: "reorder-below",
      referenceRect: whole,
      targetPath: LIST,
    });
    // The middle band is inside the template, addressed by the row root's own path.
    expect(computeDropInstruction(rows[1]!, 250, DOC, src)).toEqual({
      edge: "inside",
      instruction: "make-child",
      referenceRect: { height: 100, width: 400, x: 0, y: 200 },
      targetPath: [...LIST, "map"],
    });
    // The repeater dragged onto its own rows is not dropped beside itself.
    expect(
      computeDropInstruction(rows[0]!, 105, DOC, { path: LIST, type: "tree-node" }),
    ).toBeNull();
  });

  test("a leaf row root has no inside, and a whole-children repeater no slot to land beside", () => {
    const { rows } = list();
    const leaf: JxMutableNode = structuredClone(DOC);
    const section = Array.isArray(leaf.children) ? leaf.children[1] : undefined;
    if (!isNodeObject(section) || !Array.isArray(section.children)) {
      throw new TypeError("fixture");
    }
    section.children[1] = { $prototype: "Array", items: [], map: { tagName: "hr" } };
    const src = { type: "block" as const };
    expect(computeDropInstruction(rows[1]!, 240, leaf, src)?.instruction).toBe("reorder-above");
    expect(computeDropInstruction(rows[1]!, 260, leaf, src)?.instruction).toBe("reorder-below");

    document.body.innerHTML = `<ul data-jx-path='["children",0]'><li data-jx-path='["children",0,"children","map"]' data-jx-row="[0]"></li></ul>`;
    const row = document.querySelector<HTMLElement>("li")!;
    stubRect(row, { height: 100, left: 0, top: 0, width: 100 });
    const whole: JxMutableNode = {
      children: [
        {
          children: {
            $prototype: "Array",
            items: [],
            map: { children: [{ tagName: "b" }], tagName: "li" },
          },
          tagName: "ul",
        },
      ],
      tagName: "main",
    };
    expect(computeDropInstruction(row, 5, whole, src)).toBeNull();
    expect(computeDropInstruction(row, 50, whole, src)?.instruction).toBe("make-child");
    // And its insert zone has no numbered slot either.
    expect(computeInsertZones(row, { x: 5, y: 2 }, whole)).toBeNull();
  });

  test("a hit-test walks to the node under the pointer in any row; a click needs the addressable one", () => {
    const { rows } = list();
    const echoed = rows[1]!.querySelector("b")!;
    expect(nearestStampedEl(echoed)).toBe(echoed);
    expect(nearestStampedEl(document.body)).toBeNull();
    // A click reports by `data-jx-path`, so in an echo row it climbs out to the row's container.
    expect(nearestHit(echoed)?.path).toEqual(SECTION);
    expect(nearestHit(rows[0]!.querySelector("b"))?.path).toEqual([...LIST, "map", "children", 0]);
    // `elementFromPoint` is the browser's; with none under the point there is no target.
    expect(resolveDropTarget(-1, -1, document)).toBeNull();
  });
});

describe("a live expression preview reads the active row", () => {
  const doc: JxMutableNode = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: { tagName: "li" },
      },
    ],
    tagName: "ul",
  };
  const scope: JxScope = { rows: [{ t: "first" }, { t: "second" }, { t: "third" }] };
  const context: JxPath = ["children", 0, "map"];

  test("the row the author is working in, the first when none is chosen, the last when out of range", () => {
    const itemOf = (rows: Map<string, number>) =>
      bindRepeaterContext(scope, doc, context, rows)["$map/item"];
    expect(bindRepeaterContext(scope, doc, context)["$map/item"]).toEqual({ t: "first" });
    expect(itemOf(new Map([['["children",0]', 1]]))).toEqual({ t: "second" });
    expect(itemOf(new Map([['["children",0]', 9]]))).toEqual({ t: "third" });
    const bound = bindRepeaterContext(scope, doc, context, new Map([['["children",0]', 2]]));
    expect(bound["$map"]).toEqual({ index: 2, item: { t: "third" } });
    expect(bound["$map/index"]).toBe(2);
  });
});

describe("sample items", () => {
  const config = {
    content: {
      post: {
        format: "Markdown",
        schema: {
          properties: {
            author: { $ref: "#/content/person" },
            draft: { type: "boolean" },
            kind: { enum: ["note", "essay"] },
            rating: { type: "number" },
            tags: { items: { type: "string" }, type: "array" },
            title: { type: "string" },
            weight: { default: 7, type: "integer" },
            when: { type: ["null", "string"] },
          },
        },
      },
      person: {
        format: "CSV",
        schema: { properties: { name: { type: "string" }, posts: { $ref: "#/content/person" } } },
      },
    },
  };

  test("a collection's item is every declared field, empty", () => {
    const doc: JxMutableNode = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/posts" },
          map: {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "$map/item/data/tags" },
                map: { tagName: "i" },
              },
            ],
            tagName: "li",
          },
        },
      ],
      state: { posts: { $prototype: "ContentCollection", contentType: "post" } },
      tagName: "ul",
    };
    expect(repeaterSampleItems(doc, config)).toEqual({
      '["children",0]': {
        $children: [],
        body: "",
        data: {
          // A relationship is entered once: the person's own relationship back ends the cycle.
          author: { body: "", data: { name: "", posts: {} }, id: "" },
          draft: false,
          kind: "note",
          rating: 0,
          tags: [],
          title: "",
          weight: 7,
          when: "",
        },
        id: "",
      },
      // The inner list's item is a tag: a string, so an empty one.
      '["children",0,"map","children",0]': "",
    });
  });

  test("a literal list samples its own members, and a list nothing describes has no sample", () => {
    const doc: JxMutableNode = {
      $switch: { $ref: "#/state/view" },
      cases: {
        list: {
          children: [
            { $prototype: "Array", items: [{ flag: true, n: 3, o: {} }], map: { tagName: "li" } },
          ],
          tagName: "ul",
        },
      },
      children: [
        "text",
        { $prototype: "Array", items: { $ref: "#/state/unknown" }, map: { tagName: "li" } },
        { children: { $prototype: "Array", items: { $ref: "window#/x" } }, tagName: "ol" },
      ],
      tagName: "div",
    };
    expect(repeaterSampleItems(doc, null)).toEqual({
      '["cases","list","children",0]': { flag: "", n: "", o: {} },
      '["children",1]': null,
      '["children",2,"children"]': null,
    });
  });
});

/** Each element drawn for `path`, as `addressable or echo @ rows : text`. */
function picture(root: ParentNode, path: JxPath): string[] {
  return instancesOf(root, path).map(
    (el) =>
      `${el.dataset.jxPath === undefined ? "echo" : "path"}@${rowsOf(el).join(".")}:${el.textContent}`,
  );
}

describe("a stamp says where a node is, not where it was drawn", () => {
  /** A keyed list whose rows each hold a `$switch` on the item's kind. */
  const SWITCHED: JxMutableNode = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        key: { $ref: "$map/item/id" },
        map: {
          children: [
            { tagName: "b", textContent: "${$map.item.id}" },
            {
              $switch: { $ref: "$map/item/kind" },
              cases: {
                x: { tagName: "span", textContent: "X" },
                y: { tagName: "p", textContent: "Y" },
              },
              tagName: "div",
            },
          ],
          tagName: "li",
        },
      },
    ],
    tagName: "ul",
  };
  const CASE_Y: JxPath = ["children", 0, "map", "children", 1, "cases", "y"];
  const kinds = () => [
    { id: "a", kind: "y" },
    { id: "b", kind: "x" },
    { id: "c", kind: "x" },
  ];
  /** `rows` with row `c` replaced by one of kind `y`: a new item under the same key. */
  const withCFlipped = (rows: readonly { id: string; kind: string }[]) =>
    rows.map((row) => (row.id === "c" ? { id: "c", kind: "y" } : row));

  test("a case that flips in a row that has moved is stamped with the row it is in", async () => {
    const state = reactive({ rows: kinds() });
    const { root } = draw(SWITCHED, state);
    state.rows = state.rows.toReversed();
    await flush();
    // Row `c` is the first row now. Its switch was created as row 2's, and still says so.
    state.rows = withCFlipped(state.rows);
    await flush();
    expect(picture(root, CASE_Y)).toEqual(["path@0:Y", "echo@2:Y"]);
    expect(duplicates(root)).toEqual([]);
  });

  test("and with another row active no path is given to two elements", async () => {
    const state = reactive({ rows: kinds() });
    const view = newRowView();
    adoptActiveRows(view, { '["children",0]': 2 });
    const { root } = draw(SWITCHED, state, view);
    state.rows = state.rows.toReversed();
    await flush();
    state.rows = withCFlipped(state.rows);
    await flush();
    expect(picture(root, CASE_Y)).toEqual(["echo@0:Y", "path@2:Y"]);
    expect(duplicates(root)).toEqual([]);
  });

  test("a row an inner list adds inside an outer row that has moved is in that outer row", async () => {
    const doc: JxMutableNode = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          key: { $ref: "$map/item/id" },
          map: {
            children: [
              {
                children: [
                  {
                    $prototype: "Array",
                    items: { $ref: "$map/item/subs" },
                    map: { tagName: "li", textContent: "${$map.item}" },
                  },
                ],
                tagName: "ul",
              },
            ],
            tagName: "section",
          },
        },
      ],
      tagName: "main",
    };
    const inner: JxPath = ["children", 0, "map", "children", 0, "children", 0, "map"];
    const state = reactive({
      rows: [
        { id: "a", subs: ["a1"] },
        { id: "b", subs: ["b1"] },
        { id: "c", subs: ["c1"] },
      ],
    });
    const { root } = draw(doc, state);
    state.rows = state.rows.toReversed();
    await flush();
    state.rows[0]!.subs.push("c2");
    await flush();
    state.rows[2]!.subs.push("a2");
    await flush();
    expect(picture(root, inner)).toEqual([
      "path@0.0:c1",
      "echo@0.1:c2",
      "echo@1.0:b1",
      "echo@2.0:a1",
      "echo@2.1:a2",
    ]);
    expect(duplicates(root)).toEqual([]);
  });

  test("a keyed INNER row reused at another index is restamped at its own depth", async () => {
    const doc = structuredClone(NESTED);
    // SAFETY: `NESTED` is built above with `children` an array holding the outer Array node.
    const outer = (doc.children as JxMutableNode[])[0]!;
    // SAFETY: whose `map` is a node.
    const template = outer.map as JxMutableNode;
    // SAFETY: and whose second child is the inner Array node.
    const inner = (template.children as JxMutableNode[])[1]!;
    inner.key = { $ref: "$map/item" };
    const state = reactive({ seasons: structuredClone(SEASONS) });
    const { root } = draw(doc, state);
    const item = (text: string) =>
      [...root.querySelectorAll("li")].find((el) => el.textContent === text)!;
    const c2 = item("c2");
    expect(rowsOf(c2)).toEqual([2, 1]);
    state.seasons[2]!.episodes = ["c2", "c1"];
    await flush();
    expect(item("c2")).toBe(c2);
    expect(rowsOf(c2)).toEqual([2, 0]);
    expect(rowsOf(item("c1"))).toEqual([2, 1]);
  });

  test("a case that flips with no list redrawing is settled in the same turn", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = newRowView();
    // Row 5 of two: the last row stands in, so the stamper's own answer (row 5) is nobody's.
    adoptActiveRows(view, { '["children",0]': 5 });
    let settled = 0;
    // SAFETY: a prepared document is the document the frame is sent, which is what this takes.
    const commit = await prepareResolvedDocument({
      container,
      doc: {
        ...prepareForEditMode(structuredClone(SWITCHED)),
        state: {
          rows: [
            { id: "a", kind: "x" },
            { id: "b", kind: "x" },
          ],
        },
      } as never,
      docBase: "http://localhost/",
      mapperCtx: MAPPER,
      mode: "edit",
      onRowsChanged: () => {
        settled += 1;
      },
      rows: view,
    });
    const handle = commit();
    // In place, on the second row's own item: the list has nothing to reconcile.
    const drawnRows = handle.ctx.defs["rows"];
    const second = Array.isArray(drawnRows) ? drawnRows[1] : null;
    expect(isNodeObject(second)).toBe(true);
    if (isNodeObject(second)) {
      second["kind"] = "y";
    }
    await flush();
    // No list reported anything: the stamper asked, and one settle followed.
    expect(settled).toBe(1);
    expect(picture(container, CASE_Y)).toEqual(["path@1:Y"]);
    handle.dispose();
  });
});

describe("the marks of a list are its rows' own", () => {
  test("an empty inner list keeps its template mark when its outer row moves", async () => {
    const doc: JxMutableNode = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          key: { $ref: "$map/item/id" },
          map: {
            children: [
              {
                children: [
                  {
                    $prototype: "Array",
                    items: { $ref: "$map/item/subs" },
                    map: { tagName: "li", textContent: "${$map.item}" },
                  },
                ],
                tagName: "ul",
              },
            ],
            tagName: "section",
          },
        },
      ],
      tagName: "main",
    };
    const innerList: JxPath = ["children", 0, "map", "children", 0, "children", 0];
    const state = reactive({
      rows: [
        { id: "a", subs: ["a1"] },
        { id: "b", subs: new Array<string>() },
        { id: "c", subs: ["c1", "c2"] },
      ],
    });
    const view = newRowView({ samples: { [JSON.stringify(innerList)]: "sample" } });
    const { root } = draw(doc, state, view);
    const marks = () =>
      instancesOf(root, [...innerList, "map"]).map(
        (el) => `${el.textContent}:${el.dataset.jxTemplateRow === undefined ? "-" : "template"}`,
      );
    expect(marks()).toEqual(["a1:-", "sample:template", "c1:-", "c2:-"]);
    // Row `a` goes, so `b` and `c` each move up one: the mark goes with `b`'s list.
    state.rows = state.rows.slice(1);
    await flush();
    expect(marks()).toEqual(["sample:template", "c1:-", "c2:-"]);
    state.rows = state.rows.toReversed();
    await flush();
    expect(marks()).toEqual(["c1:-", "c2:-", "sample:template"]);
  });

  test("an inner list is capped and sampled for itself, in its own outer row", () => {
    const seasons = [
      { episodes: ["a1", "a2", "a3"], name: "One" },
      { episodes: [], name: "Two" },
    ];
    const view = newRowView({ limit: 2, samples: { [JSON.stringify(INNER)]: "sample" } });
    const { root } = draw(NESTED, { seasons }, view);
    expect(
      instancesOf(root, INNER_ROW).map((el) => [
        rowsOf(el).join("."),
        el.dataset.jxTemplateRow ?? null,
        el.dataset.jxRowsMore ?? null,
      ]),
    ).toEqual([
      ["0.0", null, null],
      ["0.1", null, "2 of 3 rows"],
      ["1.0", "", null],
    ]);
  });
});

describe("a list that redraws itself after a full render", () => {
  test("is settled again, capped again, and the frame is told", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = newRowView({ limit: 2 });
    adoptActiveRows(view, { '["children",0]': 2 });
    let changed = 0;
    // SAFETY: a prepared document is the document the frame is sent, which is what this takes.
    const commit = await prepareResolvedDocument({
      container,
      doc: prepareForEditMode({
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: "${item.id}" },
          },
        ],
        state: { rows: [{ id: "a" }] },
        tagName: "ul",
      }) as never,
      docBase: "http://localhost/",
      mapperCtx: MAPPER,
      mode: "edit",
      onRowsChanged: () => {
        changed += 1;
      },
      rows: view,
    });
    const handle = commit();
    const row: JxPath = ["children", 0, "map"];
    const drawn = () =>
      instancesOf(container, row).map(
        (el) =>
          `${el.textContent}:${el.dataset.jxPath === undefined ? "echo" : "path"}:${el.dataset.jxRowsMore ?? "-"}`,
      );
    expect(drawn()).toEqual(["a:path:-"]);
    // The first draw is settled by the render itself, and nobody is told of it.
    expect(changed).toBe(0);
    const scope = handle.ctx.defs;
    scope["rows"] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    await flush();
    // Active row 2 of two drawn: the last stands in. Unsettled, row `a` would still be the path.
    expect(drawn()).toEqual(["a:echo:-", "b:path:2 of 3 rows"]);
    expect(changed).toBe(1);
    handle.dispose();
    // A render that is gone settles nothing.
    scope["rows"] = [{ id: "a" }];
    await flush();
    expect(changed).toBe(1);
  });
});

describe("the union of rows that do not stack", () => {
  test("its bottom is the lowest row's, whichever row that is", () => {
    document.body.innerHTML =
      `<ul><li data-jx-path='["children",0,"map"]' data-jx-row="[0]"></li>` +
      `<li data-jx-echo-path='["children",0,"map"]' data-jx-row="[1]"></li></ul>`;
    const [tall, short] = [...document.querySelectorAll("li")];
    // Two cards side by side, the first the taller.
    stubRect(tall!, { height: 300, left: 0, top: 0, width: 100 });
    stubRect(short!, { height: 120, left: 110, top: 0, width: 100 });
    expect(repeaterRect(document, ["children", 0], () => true).rect).toEqual({
      height: 300,
      width: 210,
      x: 0,
      y: 0,
    });
  });

  test("in a row layout only the list's two ends offer an insert zone", () => {
    document.body.innerHTML =
      `<section data-jx-path='["children",1]' style="display:flex;flex-direction:row">` +
      `<article data-jx-path='["children",1,"children",1,"map"]' data-jx-row="[0]"></article>` +
      `<article data-jx-echo-path='["children",1,"children",1,"map"]' data-jx-row="[1]"></article>` +
      `<article data-jx-echo-path='["children",1,"children",1,"map"]' data-jx-row="[2]"></article>` +
      `</section>`;
    const rows = [...document.querySelectorAll<HTMLElement>("article")];
    for (const [i, row] of rows.entries()) {
      stubRect(row, { height: 100, left: i * 100, top: 0, width: 100 });
    }
    const zones = (row: number, x: number) =>
      computeInsertZones(rows[row]!, { x, y: 50 }, { tagName: "main" })?.map(
        (zone) => `${zone.edge}@${zone.index}`,
      ) ?? null;
    expect({
      firstLeading: zones(0, 2),
      lastTrailing: zones(2, 298),
      middleLeading: zones(1, 102),
      middleTrailing: zones(1, 198),
    }).toEqual({
      firstLeading: ["left@1"],
      lastTrailing: ["right@2"],
      middleLeading: null,
      middleTrailing: null,
    });
  });
});

describe("sample items of a shape nothing declares", () => {
  test("a nullable number, a list with no type and a bare object each read as their kind", () => {
    const doc: JxMutableNode = {
      children: [{ $prototype: "Array", items: { $ref: "#/state/posts" }, map: { tagName: "li" } }],
      state: { posts: { $prototype: "ContentCollection", contentType: "post" } },
      tagName: "ul",
    };
    const samples = repeaterSampleItems(doc, {
      content: {
        post: {
          format: "Markdown",
          schema: {
            properties: {
              count: { type: ["null", "integer"] },
              links: { items: { type: "string" } },
              meta: { type: "object" },
            },
          },
        },
      },
    });
    expect(samples['["children",0]']).toMatchObject({ data: { count: 0, links: [], meta: {} } });
  });

  test("an empty state list with no declared item has no sample item at all", () => {
    const list = (items: string): JxMutableNode => ({
      $prototype: "Array",
      items: { $ref: items },
      map: { tagName: "h3", textContent: "Empty ${$map.item.title}" },
    });
    const doc: JxMutableNode = {
      children: [list("#/state/none"), list("#/state/defaulted"), list("#/state/typed")],
      state: { defaulted: { default: [] }, none: [], typed: { default: [], type: "array" } },
      tagName: "main",
    };
    // `""` would be an item: `"".title` is `undefined`, and the row would spell that word.
    expect(repeaterSampleItems(doc, null)).toEqual({
      '["children",0]': null,
      '["children",1]': null,
      '["children",2]': null,
    });
    const samples = repeaterSampleItems(doc, null);
    const view = newRowView({ samples });
    const { root } = draw(doc, reactive({ defaulted: [], none: [], typed: [] }), view);
    expect([...root.querySelectorAll("h3")].map((h3) => h3.textContent)).toEqual([
      "Empty ",
      "Empty ",
      "Empty ",
    ]);
  });
});
