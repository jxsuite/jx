/**
 * The Outline as a tree: what a row SAYS, what a row COSTS, and how a keyboard walks it.
 *
 * `tests/layers-panel-gaps.test.ts` covers the rows' badges, collapse and rename. This file covers
 * the three things the audit found by driving the real app — a wall of rows all reading "div", five
 * always-visible action buttons on every one of them, and a tree no keyboard could reach.
 *
 * **Everything is addressed by `part`, `role` and `data-*`.** The panel's body is a Jx document
 * (`src/surfaces/panel-outline.json`), which emits no classes at all, so the questions that used to
 * be asked of `.layer-row` and `sp-action-button` are asked of `[part="row"]` and `[part="action"]`
 * — and the two that named a Spectrum attribute are re-asked of the kit's own `[part="control"]`,
 * which is where a `jx-action-button` puts `disabled` and the tooltip.
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import {
  allRows,
  click,
  control,
  hover,
  isRefusing,
  mountOutline,
  needRow,
  outlineHost,
  press,
  resetOutline,
  row,
  rowActions,
  textOf,
  tree,
  treeItems,
} from "./outline-fixture";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { pathKey } from "../src/store";
import { view } from "../src/view";

import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { OUTLINE_ROW_MAX_ITEMS, indentWidth, onOutlineKey, outlineLabel } =
  await import("../src/panels/layers-panel");

// ─── Harness ─────────────────────────────────────────────────────────────────

let host: HTMLElement;
const log = { dnd: 0, rerenders: 0 };

async function draw(): Promise<HTMLElement> {
  return mountOutline(host, log);
}

function at(path: JxPath): HTMLElement {
  return needRow(host, pathKey(path));
}

/** Whether the row's verb cluster is drawn with its backing plate, or invisible and empty. */
function clusterState(el: HTMLElement): string | undefined {
  return el.querySelector<HTMLElement>('[part="actions"]')?.dataset.state;
}

/** A section containing a heading and a paragraph, a bare div, and a nested chain. */
function makeDoc(): JxMutableNode {
  return {
    children: [
      {
        children: [
          { tagName: "h2", textContent: "Opening hours" },
          { tagName: "p", textContent: "Every day" },
        ],
        tagName: "section",
      },
      { children: [{ children: [{ tagName: "span" }], tagName: "div" }], tagName: "div" },
      { tagName: "img" },
    ],
    tagName: "div",
  };
}

beforeEach(() => {
  host = outlineHost();
  log.dnd = 0;
  log.rerenders = 0;
  resetWorkspaceWithTab(makeDoc());
});

afterEach(() => {
  resetOutline();
  closeAllTabs();
});

// ─── What a row says ─────────────────────────────────────────────────────────

describe("outlineLabel", () => {
  const label = (node: Partial<JxMutableNode>) => outlineLabel(node as JxMutableNode);

  test("a $title wins over everything", () => {
    expect(label({ $id: "hero", $title: "Hero band", tagName: "section" })).toBe("Hero band");
  });

  test("an $id reads as one", () => {
    expect(label({ $id: "hero", tagName: "section" })).toBe("#hero");
  });

  test("own text beats a class", () => {
    expect(label({ attributes: { class: "lede" }, tagName: "p", textContent: "Hello" })).toBe(
      "Hello",
    );
  });

  test("a class reads as one, and only the first", () => {
    expect(label({ attributes: { class: "card  card--wide" }, tagName: "div" })).toBe(".card");
  });

  test("a bound class attribute is not a name", () => {
    expect(label({ attributes: { class: { $ref: "#/state/cls" } }, tagName: "div" } as never)).toBe(
      "",
    );
  });

  test("a landmark gets its human name", () => {
    expect(label({ children: [], tagName: "nav" })).toBe("Navigation");
    expect(label({ children: [], tagName: "aside" })).toBe("Sidebar");
  });

  test("a container borrows the first text under it, quoted", () => {
    expect(
      label({
        children: [{ children: [{ tagName: "h2", textContent: "Opening hours" }], tagName: "div" }],
        tagName: "section",
      }),
    ).toBe("“Opening hours”");
  });

  test("a bare string child counts as text", () => {
    expect(label({ children: ["Just words"], tagName: "div" })).toBe("“Just words”");
  });

  test("the walk is bounded, so a deep wrapper falls back to its child count", () => {
    // Five levels of wrapper: past the depth bound, so the text is not borrowed.
    let node: JxMutableNode = { tagName: "span", textContent: "deep" };
    for (let i = 0; i < 5; i++) {
      node = { children: [node], tagName: "div" };
    }
    expect(label(node)).toBe("1 item");
  });

  test("a container with nothing to say counts its children instead of repeating the tag", () => {
    expect(label({ children: [{ tagName: "br" }, { tagName: "br" }], tagName: "div" })).toBe(
      "2 items",
    );
  });

  test("an empty node says nothing at all — the badge is the whole answer", () => {
    expect(label({ children: [], tagName: "div" })).toBe("");
    expect(label({ tagName: "img" })).toBe("");
  });

  test("repeaters and slots keep the composed name nodeLabel gives them", () => {
    expect(label({ $prototype: "Array", items: { $ref: "#/state/posts" } } as never)).toBe(
      "Repeater → #/state/posts",
    );
    expect(label({ attributes: { name: "footer" }, tagName: "slot" })).toContain("footer");
  });

  test("long text is trimmed and ellipsized to the column's budget", () => {
    const long = "a very long sentence that no 240 pixel column will ever manage to show in full";
    const out = label({ tagName: "p", textContent: long });
    expect(out.length).toBe(33);
    expect(out.endsWith("…")).toBe(true);
  });

  test("rows are what the panel actually renders", async () => {
    await draw();
    const labels = treeItems(host).map((r) => textOf(r, "label"));
    // The old tree printed "div" four times over; nothing here repeats its own badge.
    expect(labels).toEqual([
      "“Opening hours”", // The document root borrows the first words on the page…
      "“Opening hours”", // …as does the section wrapping them.
      "Opening hours",
      "Every day",
      "1 item",
      "1 item",
      "",
      "",
    ]);
  });
});

// ─── What a row costs, and where the verbs are ───────────────────────────────

describe("row actions", () => {
  test("only the selected row carries buttons; every other row's cluster is empty", async () => {
    activeTab.value!.session.selection = [["children", 2]];
    await draw();
    const selected = at(["children", 2]);
    expect(selected.querySelectorAll("jx-action-button").length).toBe(
      OUTLINE_ROW_MAX_ITEMS + 1, // The four moves plus ⋮.
    );
    expect(clusterState(selected)).toBe("shown");
    for (const other of treeItems(host).filter((r) => r !== selected)) {
      expect(other.querySelectorAll("jx-action-button")).toHaveLength(0);
      expect(clusterState(other)).toBe("hidden");
    }
  });

  test("hovering a row builds its cluster, and leaving the tree takes it down", async () => {
    activeTab.value!.session.selection = [["children", 2]];
    await draw();
    const hovered = at(["children", 0]);
    expect(hovered.querySelectorAll("jx-action-button")).toHaveLength(0);

    hover(hovered);
    await flush();
    const first = at(["children", 0]);
    expect(first.querySelectorAll("jx-action-button").length).toBeGreaterThan(0);
    // The verbs are the HOVERED row's, not the selection's: children/0 is first, so it cannot move up.
    expect(isRefusing(rowActions(first), "selection.moveUp")).toBe(true);

    tree(host).dispatchEvent(new MouseEvent("mouseleave"));
    await flush();
    expect(at(["children", 0]).querySelectorAll("jx-action-button")).toHaveLength(0);
  });

  test("the same row hovered twice is one cluster, not two repaints", async () => {
    await draw();
    hover(at(["children", 1]));
    await flush();
    const cluster = at(["children", 1]).querySelector('[part="actions"]');
    // A pointer crossing a row's own children raises `mouseenter` on the row it is already on; a
    // Redraw there would rebuild the cluster the pointer is travelling towards.
    hover(at(["children", 1]));
    await flush();
    expect(at(["children", 1]).querySelector('[part="actions"]')).toBe(cluster);
    expect(host.querySelectorAll('[part="actions"][data-state="shown"]')).toHaveLength(1);
  });

  test("moving the pointer to another row moves the cluster with it — one at a time", async () => {
    await draw();
    hover(at(["children", 0]));
    await flush();
    hover(at(["children", 1]));
    await flush();
    expect(at(["children", 0]).querySelectorAll("jx-action-button")).toHaveLength(0);
    expect(at(["children", 1]).querySelectorAll("jx-action-button").length).toBeGreaterThan(0);
    // And exactly one cluster is drawn in the whole tree.
    expect(host.querySelectorAll('[part="actions"][data-state="shown"]')).toHaveLength(1);
  });

  test("the hovered row's cluster is recomputed after a repaint", async () => {
    // Rows are keyed by path, so an edit can leave the pointer on a DOM row whose node — and whose
    // Answer to "can this move down" — has changed underneath it.
    await draw();
    const hovered = at(["children", 2]);
    hover(hovered);
    await flush();
    const canMoveDown = () => !isRefusing(rowActions(at(["children", 2])), "selection.moveDown");
    expect(canMoveDown()).toBe(false); // Last child.

    (activeTab.value!.doc.document.children as JxMutableNode[]).push({ tagName: "hr" });
    await draw();
    expect(at(["children", 2]).isConnected).toBe(true);
    expect(canMoveDown()).toBe(true); // No longer last.
  });

  test("a row that becomes the selection keeps its verbs, and the hover cluster steps aside", async () => {
    await draw();
    hover(at(["children", 1]));
    await flush();
    activeTab.value!.session.selection = [["children", 1]];
    await draw();

    const now = at(["children", 1]);
    expect(now.getAttribute("aria-selected")).toBe("true");
    expect(now.querySelectorAll("jx-action-button").length).toBe(OUTLINE_ROW_MAX_ITEMS + 1);
    expect(host.querySelectorAll('[part="actions"][data-state="shown"]')).toHaveLength(1);
  });

  test("the root row has no verbs at all — it is not a node you can move or delete", async () => {
    activeTab.value!.session.selection = [[]];
    await draw();
    expect(at([]).querySelectorAll("jx-action-button")).toHaveLength(0);
    hover(at([]));
    await flush();
    expect(at([]).querySelectorAll("jx-action-button")).toHaveLength(0);
  });

  test("a verb names itself and states its refusal in one place", async () => {
    activeTab.value!.session.selection = [["children", 0]];
    await draw();
    const moveUp = rowActions(at(["children", 0]))["selection.moveUp"]!;
    // The accessible name is the bare record title; the tooltip is the record's own sentence.
    expect(control(moveUp).getAttribute("aria-label")).toBe("Move Up");
    expect(control(moveUp).getAttribute("title")).toBe(
      "Move Up — requires an element with a sibling above it",
    );
  });
});

// ─── The column, and the indent that broke it ────────────────────────────────

describe("indentWidth", () => {
  test("indent grows by a step per level", () => {
    expect(indentWidth(0)).toBe(0);
    expect(indentWidth(1)).toBe(16);
    expect(indentWidth(3)).toBe(48);
  });

  test("and stops, so a deep node cannot push the tree out of a 240px column", () => {
    expect(indentWidth(6)).toBe(96);
    expect(indentWidth(7)).toBe(96);
    expect(indentWidth(40)).toBe(96);
  });

  test("the row writes it as one custom property, not as a per-row padding rule", async () => {
    await draw();
    // A `padding-left` declaration interns one rule per row; `--row-indent` interns one for all.
    expect(at([]).style.getPropertyValue("--row-indent")).toBe("8px");
    expect(at(["children", 0]).style.getPropertyValue("--row-indent")).toBe("24px");
    expect(at(["children", 0, "children", 0]).style.getPropertyValue("--row-indent")).toBe("40px");
    expect(at([]).style.paddingLeft).toBe("");
  });
});

// ─── The tree, as a keyboard surface ─────────────────────────────────────────

describe("role=tree and the keyboard model", () => {
  test("the container and its rows declare themselves", async () => {
    await draw();
    expect(tree(host).getAttribute("role")).toBe("tree");
    expect(tree(host).getAttribute("aria-label")).toBe("Document outline");
    expect(at([]).getAttribute("role")).toBe("treeitem");
    expect(at([]).getAttribute("aria-level")).toBe("1");
    expect(at(["children", 0]).getAttribute("aria-level")).toBe("2");
    expect(at(["children", 0]).getAttribute("aria-expanded")).toBe("true");
    expect(at(["children", 2]).getAttribute("aria-expanded")).toBeNull(); // A leaf.
  });

  test("aria-selected follows the selection, and so does the single tab stop", async () => {
    activeTab.value!.session.selection = [["children", 2]];
    await draw();
    expect(at(["children", 2]).getAttribute("aria-selected")).toBe("true");
    const stops = treeItems(host).filter((r) => r.tabIndex === 0);
    expect(stops.map((r) => r.dataset.path)).toEqual(["children/2"]);
  });

  test("with nothing selected the first row is the way in", async () => {
    await draw();
    expect(
      treeItems(host)
        .filter((r) => r.tabIndex === 0)
        .map((r) => r.dataset.path),
    ).toEqual([""]);
  });

  test("an empty tree has no rows to hand a tab stop to, and teaches instead", async () => {
    resetWorkspaceWithTab({ children: [], tagName: "div" } as JxMutableNode);
    activeTab.value!.doc.mode = "content";
    await draw();
    expect(treeItems(host)).toHaveLength(0);
    expect(host.querySelector('[part="empty"]')).not.toBeNull();
  });

  test("↑ and ↓ walk the visible rows and take the selection with them", async () => {
    activeTab.value!.session.selection = [[]];
    await draw();
    press(at([]), "ArrowDown");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 0]]);
    expect((document.activeElement as HTMLElement).dataset.path).toBe("children/0");

    press(at(["children", 0]), "ArrowUp");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([[]]);
  });

  test("↓ at the last row and ↑ at the first stay put", async () => {
    await draw();
    const before = treeItems(host).length;
    press(treeItems(host).at(-1)!, "ArrowDown");
    press(treeItems(host)[0]!, "ArrowUp");
    await flush();
    expect(treeItems(host)).toHaveLength(before);
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("→ expands a collapsed row, then descends into it", async () => {
    view._layersCollapsed = new Set([pathKey(["children", 0])]);
    await draw();
    expect(at(["children", 0]).getAttribute("aria-expanded")).toBe("false");

    press(at(["children", 0]), "ArrowRight");
    await flush();
    expect(view._layersCollapsed!.has(pathKey(["children", 0]))).toBe(false);
    expect(at(["children", 0]).getAttribute("aria-expanded")).toBe("true");

    press(at(["children", 0]), "ArrowRight");
    await flush();
    expect((document.activeElement as HTMLElement).dataset.path).toBe("children/0/children/0");
  });

  test("→ on a leaf does nothing", async () => {
    await draw();
    press(at(["children", 2]), "ArrowRight");
    await flush();
    expect(view._layersCollapsed!.size).toBe(0);
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("← collapses an expanded row, then climbs to its parent", async () => {
    await draw();
    press(at(["children", 0]), "ArrowLeft");
    await flush();
    expect(view._layersCollapsed!.has(pathKey(["children", 0]))).toBe(true);
    expect(row(host, pathKey(["children", 0, "children", 0]))).toBeNull();

    press(at(["children", 0]), "ArrowLeft");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([[]]);
    expect((document.activeElement as HTMLElement).dataset.path).toBe("");
  });

  test("← at the top of the tree has nowhere to go", async () => {
    await draw();
    press(at([]), "ArrowLeft");
    await flush();
    // The root is expandable, so the first ← collapses it; the second has no parent to climb to.
    press(at([]), "ArrowLeft");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("Home and End jump to the ends and select", async () => {
    await draw();
    press(at(["children", 0]), "End");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 2]]);
    press(at(["children", 2]), "Home");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([[]]);
  });

  test("Enter and F2 rename the row in place", async () => {
    await draw();
    press(at(["children", 2]), "Enter");
    await flush();
    expect(at(["children", 2]).querySelector('[part="title-input"]')).not.toBeNull();
    expect(activeTab.value!.session.selection).toEqual([["children", 2]]);

    press(at(["children", 2]), "Escape");
    await flush();
    press(at(["children", 0]), "F2");
    await flush();
    expect(at(["children", 0]).querySelector('[part="title-input"]')).not.toBeNull();
  });

  test("a key the tree does not answer to falls through", async () => {
    activeTab.value!.session.selection = [[]];
    await draw();
    press(at([]), "a");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([[]]);
    expect(at([]).querySelector('[part="title-input"]')).toBeNull();
  });

  test("leaving a tree the pointer was never in changes nothing", async () => {
    await draw();
    const before = host.innerHTML;
    tree(host).dispatchEvent(new MouseEvent("mouseleave"));
    await flush();
    expect(host.innerHTML).toBe(before);
  });

  test("a key naming a row the model does not hold is not an index", async () => {
    await draw();
    const before = activeTab.value!.session.selection;
    // The document only binds the keyboard on tree items, so this is the exported entry point
    // Being addressed with a key from a stale projection — the shape a windowed repaint can hand it.
    expect(() => {
      onOutlineKey("children/99", "ArrowDown", false);
    }).not.toThrow();
    await flush();
    expect(activeTab.value!.session.selection).toBe(before);
  });

  test("a text line answers to no key, because it can expand into nothing", async () => {
    resetWorkspaceWithTab({
      children: [{ children: ["Just words"], tagName: "p" }],
      tagName: "div",
    } as JxMutableNode);
    await draw();
    const textKey = pathKey(["children", 0, "children", 0]);
    onOutlineKey(textKey, "ArrowRight", false);
    await flush();
    expect(view._layersCollapsed!.size).toBe(0);
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("a text-node line is drawn but is not a tree item", async () => {
    resetWorkspaceWithTab({
      children: [{ children: ["Just words"], tagName: "p" }],
      tagName: "div",
    } as JxMutableNode);
    await draw();
    const text = needRow(host, pathKey(["children", 0, "children", 0]));
    expect(text.dataset.kind).toBe("text");
    expect(text.getAttribute("role")).toBeNull();
    expect(textOf(text, "badge")).toBe("text");
    expect(textOf(text, "label")).toBe("Just words");
    // Drawn, and outside the keyboard walk: the ↓ from the paragraph has nowhere to go.
    expect(allRows(host)).toHaveLength(treeItems(host).length + 1);
    press(needRow(host, pathKey(["children", 0])), "ArrowDown");
    await flush();
    expect(activeTab.value!.session.selection).toEqual([]);
  });
});

// ─── Selection, and what a click means ───────────────────────────────────────

describe("clicking a row", () => {
  test("selects it, and a modified click accumulates rather than replacing", async () => {
    await draw();
    click(at(["children", 0]));
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 0]]);

    click(at(["children", 2]), { metaKey: true });
    await flush();
    expect(activeTab.value!.session.selection).toEqual([
      ["children", 0],
      ["children", 2],
    ]);
  });

  test("a click on the chevron collapses instead of selecting", async () => {
    await draw();
    const toggle = at(["children", 0]).querySelector('[part="toggle"]') as HTMLElement;
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(view._layersCollapsed!.has(pathKey(["children", 0]))).toBe(true);
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("a click on the empty chevron of a leaf collapses nothing", async () => {
    await draw();
    const toggle = at(["children", 2]).querySelector('[part="toggle"]') as HTMLElement;
    expect(toggle.children).toHaveLength(0);
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    // A key in the collapsed set for a row with nothing under it is one nothing ever removes.
    expect(view._layersCollapsed!.size).toBe(0);
  });
});
