/**
 * What the Outline opens, and when (studio.md §5.2 "Expansion").
 *
 * The tree opens CLOSED down to its top level, follows the selection by opening the branches it
 * sits in, and keeps whatever the reader closed closed until the selection next moves inside it.
 * The first block drives the pure module, the second the mounted panel, and the third the action
 * bar and its two commands, including a document large enough to need the window.
 */
import { flush, resetWorkspaceWithTab, stubRect } from "./harness";
import {
  click,
  control,
  mountOutline,
  outlineHost,
  part,
  resetOutline,
  row,
  treeItems,
} from "./outline-fixture";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import {
  OUTLINE_ROOT_KEY,
  closeOutlineKey,
  collapseAllOutline,
  expandAllOutline,
  isExpandableNode,
  openOutlineAncestors,
  openOutlineKey,
  outlineCommands,
  setOutlineRedraw,
  syncOutlineToSelection,
} from "../src/panels/outline-expansion";
import { makeContext } from "../src/commands/context";
import { appCommandSet } from "../src/commands/app-commands";
import { selectionCommandRegistry } from "../src/panels/block-action-bar";
import { resetPanels } from "../src/panels/panel-registry";
import type { AnyCommand } from "../src/commands/registry";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { OUTLINE_ROW_HEIGHT, outlineValues } = await import("../src/panels/layers-panel");

/**
 * Root > [ section > [ h2, div > [ p > [ span ] ] ], aside > [ ul > map(li) ], div $switch(a, b),
 * img ]
 *
 * Deep enough that "open to the selection" and "open everything" differ at every level.
 */
function makeDoc(): JxMutableNode {
  return {
    children: [
      {
        children: [
          { tagName: "h2", textContent: "Title" },
          {
            children: [{ children: [{ tagName: "h4", textContent: "x" }], tagName: "article" }],
            tagName: "div",
          },
        ],
        tagName: "section",
      },
      {
        children: [
          {
            children: {
              $prototype: "Array",
              items: { $ref: "#/state/things" },
              map: { children: [{ tagName: "b", textContent: "b" }], tagName: "li" },
            },
            tagName: "ul",
          },
        ],
        tagName: "aside",
      },
      {
        $switch: "${mode}",
        cases: {
          a: { children: [{ tagName: "i", textContent: "i" }], tagName: "p" },
          b: { tagName: "p" },
        },
        tagName: "div",
      },
      { tagName: "img" },
    ],
    tagName: "div",
  };
}

const FIRST_SECTION: JxPath = ["children", 0];
const DEEP_DIV: JxPath = ["children", 0, "children", 1];
const DEEP_P: JxPath = ["children", 0, "children", 1, "children", 0];
const DEEP_SPAN: JxPath = [...DEEP_P, "children", 0];
const ASIDE: JxPath = ["children", 1];
const UL: JxPath = [...ASIDE, "children", 0];
const MAP_TEMPLATE: JxPath = [...UL, "children", 0, "map"];
const SWITCH: JxPath = ["children", 2];
const CASE_A_CHILD: JxPath = [...SWITCH, "cases", "a", "children", 0];

/** Run a record's `run` the way the registry does, minus the gate the test is not about. */
function runDirect(command: AnyCommand | undefined): void {
  if (!command) {
    throw new TypeError("no such outline command");
  }
  // SAFETY: both records take no arguments, so `run` never reads its second parameter.
  void command.run(makeContext({}), undefined as never);
}

function record(): Record<string, boolean> {
  return activeTab.value!.session.ui.outlineOpen;
}

function keysOf(): string[] {
  return Object.keys(record()).toSorted();
}

let host: HTMLElement;

beforeEach(() => {
  host = outlineHost();
  resetWorkspaceWithTab(makeDoc());
});

afterEach(() => {
  resetOutline();
  closeAllTabs();
  resetPanels();
  setOutlineRedraw(null);
});

describe("the open record", () => {
  test("a new tab opens with only the document root open", () => {
    expect(record()).toEqual({ [OUTLINE_ROOT_KEY]: true });
    expect(activeTab.value!.session.ui.outlineSeen).toBe("");
  });

  test("each tab keeps its own record", () => {
    const first = activeTab.value!;
    openOutlineKey(first, "children/0");
    const second = resetWorkspaceWithTab(makeDoc(), { id: "other-tab" });
    expect(second.session.ui.outlineOpen).toEqual({ "": true });
    expect(first.session.ui.outlineOpen["children/0"]).toBe(true);
  });

  test("closing forgets the key rather than storing a false", () => {
    const tab = activeTab.value!;
    openOutlineKey(tab, "children/0");
    closeOutlineKey(tab, "children/0");
    expect("children/0" in record()).toBe(false);
  });

  test("isExpandableNode: children, a template, cases; never a leaf", () => {
    expect(isExpandableNode({ children: [{ tagName: "p" }], tagName: "div" }, "element")).toBe(
      true,
    );
    expect(isExpandableNode({ children: [], tagName: "div" }, "element")).toBe(false);
    expect(isExpandableNode({ tagName: "img" }, "element")).toBe(false);
    expect(
      isExpandableNode(
        { $switch: "${m}", cases: { a: { tagName: "p" } }, tagName: "div" },
        "element",
      ),
    ).toBe(true);
    expect(isExpandableNode({ $prototype: "Array", map: { tagName: "li" } }, "map")).toBe(true);
    expect(isExpandableNode({ $prototype: "Array" }, "map")).toBe(false);
  });
});

describe("the selection rule", () => {
  test("opens every strict ancestor of the selection and never the selected node", () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_P];
    expect(syncOutlineToSelection(tab)).toBe(true);
    expect(keysOf()).toEqual(["", "children/0", "children/0/children/1"]);
    // The node itself, its siblings and its children are as they were.
    expect(record()["children/0/children/1/children/0"]).toBeUndefined();
  });

  test("resolves a repeater template and a $switch case through their own rows", () => {
    const tab = activeTab.value!;
    tab.session.selection = [MAP_TEMPLATE];
    syncOutlineToSelection(tab);
    expect(keysOf()).toEqual([
      "",
      "children/1",
      "children/1/children/0",
      "children/1/children/0/children/0",
    ]);

    tab.session.selection = [CASE_A_CHILD];
    syncOutlineToSelection(tab);
    expect(record()["children/2"]).toBe(true);
    expect(record()["children/2/cases/a"]).toBe(true);
    // `children` and `cases` name an array, not a row, so they are not stored.
    expect(
      Object.keys(record()).some((key) => key.endsWith("/cases") || key.endsWith("children")),
    ).toBe(false);
  });

  test("a legacy whole-children repeater keeps its own row open", () => {
    const tab = activeTab.value!;
    openOutlineAncestors(tab, ["children", 1, "children", 0, "children", "map"]);
    expect(record()["children/1/children/0/children"]).toBe(true);
  });

  test("a multi-selection opens the ancestors of every path", () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_SPAN, CASE_A_CHILD];
    syncOutlineToSelection(tab);
    expect(record()["children/0/children/1/children/0"]).toBe(true);
    expect(record()["children/2/cases/a"]).toBe(true);
  });

  test("does nothing again until the selection moves, so a closed branch stays closed", () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_P];
    syncOutlineToSelection(tab);
    closeOutlineKey(tab, "children/0");

    expect(syncOutlineToSelection(tab)).toBe(false);
    expect(record()["children/0"]).toBeUndefined();

    // Moving INSIDE the closed row is what reopens it, and moving elsewhere is not.
    tab.session.selection = [FIRST_SECTION];
    expect(syncOutlineToSelection(tab)).toBe(true);
    expect(record()["children/0"]).toBeUndefined();
    tab.session.selection = [DEEP_DIV];
    syncOutlineToSelection(tab);
    expect(record()["children/0"]).toBe(true);
  });

  test("selecting in a second branch opens it and leaves the first open", () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_SPAN];
    syncOutlineToSelection(tab);
    tab.session.selection = [MAP_TEMPLATE];
    syncOutlineToSelection(tab);
    expect(record()["children/0/children/1"]).toBe(true);
    expect(record()["children/1/children/0"]).toBe(true);
  });
});

describe("expand all and collapse all", () => {
  test("expand all opens exactly the rows that have something under them", () => {
    const tab = activeTab.value!;
    expandAllOutline(tab);
    expect(keysOf()).toEqual(
      [
        "",
        "children/0",
        "children/0/children/1",
        "children/0/children/1/children/0",
        "children/1",
        "children/1/children/0",
        "children/1/children/0/children/0",
        "children/1/children/0/children/0/map",
        "children/2",
        "children/2/cases/a",
      ].toSorted(),
    );
  });

  test("collapse all leaves the root open and nothing else", () => {
    const tab = activeTab.value!;
    expandAllOutline(tab);
    collapseAllOutline(tab);
    expect(record()).toEqual({ "": true });
  });

  test("collapse all is not undone by a repaint, and the next selection change reopens its branch", async () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_P];
    await mountOutline(host);
    expect(row(host, "children/0/children/1/children/0")).not.toBeNull();

    collapseAllOutline(tab);
    await mountOutline(host);
    expect(treeItems(host).map((el) => el.dataset.value)).toEqual([
      "",
      "children/0",
      "children/1",
      "children/2",
      "children/3",
    ]);

    tab.session.selection = [DEEP_SPAN];
    await mountOutline(host);
    expect(row(host, "children/0/children/1/children/0/children/0")).not.toBeNull();
  });
});

describe("the mounted Outline", () => {
  test("opens closed to the top level", async () => {
    await mountOutline(host);
    expect(treeItems(host).map((el) => el.dataset.value)).toEqual([
      "",
      "children/0",
      "children/1",
      "children/2",
      "children/3",
    ]);
    expect(row(host, "children/0")!.getAttribute("aria-expanded")).toBe("false");
    // A leaf has no expansion to speak of.
    expect(row(host, "children/3")!.hasAttribute("aria-expanded")).toBe(false);
  });

  test("a document opened in content mode still shows its top level under the hidden root", async () => {
    const tab = activeTab.value!;
    tab.doc.mode = "content";
    collapseAllOutline(tab);
    closeOutlineKey(tab, OUTLINE_ROOT_KEY);
    await mountOutline(host);
    expect(treeItems(host).map((el) => el.dataset.value)).toEqual([
      "children/0",
      "children/1",
      "children/2",
      "children/3",
    ]);
  });

  test("a selection made while the Outline was not mounted is applied at the next mount", async () => {
    activeTab.value!.session.selection = [DEEP_SPAN];
    await mountOutline(host);
    expect(row(host, "children/0/children/1/children/0/children/0")).not.toBeNull();
    // The selected node's own parent is open, and nothing below the selection was touched.
    expect(row(host, "children/0/children/1/children/0")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  test("the twisty opens a row, and a repaint keeps it open", async () => {
    await mountOutline(host);
    const twisty = part(row(host, "children/0")!, "twisty");
    twisty.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(row(host, "children/0/children/0")).not.toBeNull();
    await mountOutline(host);
    expect(row(host, "children/0/children/0")).not.toBeNull();
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("a row the reader closed stays closed across a repaint and a hover, and reopens on a move inside", async () => {
    const tab = activeTab.value!;
    tab.session.selection = [DEEP_P];
    await mountOutline(host);
    const twisty = part(row(host, "children/0")!, "twisty");
    twisty.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(row(host, "children/0/children/0")).toBeNull();

    row(host, "children/1")!.dispatchEvent(new MouseEvent("mouseenter"));
    await mountOutline(host);
    expect(row(host, "children/0/children/0")).toBeNull();

    click(row(host, "children/2")!);
    await flush();
    expect(row(host, "children/0/children/0")).toBeNull();
    tab.session.selection = [DEEP_DIV];
    await mountOutline(host);
    expect(row(host, "children/0/children/0")).not.toBeNull();
  });
});

describe("the action bar", () => {
  function tools(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[part="tool"]')];
  }

  test("both commands are placed on the bar, in order, and in the palette set", () => {
    const registry = selectionCommandRegistry();
    expect(registry.forPlacement("outline/toolbar").map((command) => command.id)).toEqual([
      "outline.expandAll",
      "outline.collapseAll",
    ]);
    const ids = appCommandSet().map((command) => command.id);
    expect(ids).toContain("outline.expandAll");
    expect(ids).toContain("outline.collapseAll");
    for (const command of outlineCommands()) {
      expect(command.menus).toEqual(["outline/toolbar", "palette"]);
      expect(command.level).toBe("document");
      expect(command.undo).toBe("none");
    }
  });

  test("the bar draws one button per tool, with the title and the tooltip", async () => {
    await mountOutline(host);
    expect(tools().map((el) => el.dataset.command)).toEqual([
      "outline.expandAll",
      "outline.collapseAll",
    ]);
    expect(tools().map((el) => control(el).getAttribute("aria-label"))).toEqual([
      "Expand All",
      "Collapse All",
    ]);
    // The tooltip is the kit's own popover, which the control is described by.
    const tips = tools().map(
      (el) =>
        document.querySelector(`#${control(el).getAttribute("aria-describedby")}`)?.textContent,
    );
    expect(tips).toEqual(["Expand All", "Collapse All"]);
    expect(host.querySelector('[part="toolbar"]')!.getAttribute("role")).toBe("toolbar");
  });

  test("Expand All opens the tree, and Collapse All closes it again", async () => {
    await mountOutline(host);
    click(tools()[0]!);
    await flush(3);
    expect(row(host, "children/0/children/1/children/0")).not.toBeNull();
    expect(row(host, "children/2/cases/a")).not.toBeNull();

    click(tools()[1]!);
    await flush(3);
    expect(row(host, "children/0/children/0")).toBeNull();
    expect(row(host, "children/0")).not.toBeNull();
  });

  test("a palette run repaints through the panel's hook, and works with nothing mounted", () => {
    const redraw = mock(() => {});
    setOutlineRedraw(redraw);
    const [expand, collapse] = outlineCommands();
    runDirect(expand);
    expect(record()["children/0"]).toBe(true);
    runDirect(collapse);
    expect(record()).toEqual({ "": true });
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  test("with no tab open the commands change nothing", () => {
    closeAllTabs();
    const redraw = mock(() => {});
    setOutlineRedraw(redraw);
    for (const command of outlineCommands()) {
      runDirect(command);
    }
    expect(redraw.mock.calls).toEqual([]);
  });

  test("the tools are disabled with their reason when no page is open", () => {
    closeAllTabs();
    const { tools: shown } = outlineValues();
    expect(shown.map((tool) => tool.disabled)).toEqual([true, true]);
    expect(shown[0]!.tooltip).toBe("Expand All — requires an open page");
  });

  test("the empty page keeps its sentence and draws no bar", async () => {
    resetWorkspaceWithTab({ tagName: "div" });
    // A root with no children still has the root row; empty means no document at all.
    closeAllTabs();
    await mountOutline(host);
    expect(host.querySelector('[part="toolbar"]')).toBeNull();
    expect(host.querySelector('[part="empty"]')).not.toBeNull();
  });
});

describe("a document large enough to need the window", () => {
  const FIRST_SECTIONS = 1000;

  test("Expand All opens thousands of rows and the DOM still draws only the window", async () => {
    const big: JxMutableNode = {
      children: Array.from({ length: FIRST_SECTIONS }, (_v, i) => ({
        children: [
          { tagName: "h3", textContent: `H ${i}` },
          { children: [{ tagName: "span", textContent: `s ${i}` }], tagName: "p" },
        ],
        tagName: "section",
      })),
      tagName: "div",
    };
    host = outlineHost(true);
    const scroller = document.querySelector<HTMLElement>("#scroller")!;
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 5000 * OUTLINE_ROW_HEIGHT,
    });
    stubRect(scroller, { height: 240, top: 0 });
    const tab = resetWorkspaceWithTab(big);
    const place = () => {
      const el = host.querySelector('[part="tree"]');
      if (el) {
        el.getBoundingClientRect = () =>
          new DOMRect(0, -scroller.scrollTop, 0, 5000 * OUTLINE_ROW_HEIGHT);
      }
    };
    await mountOutline(host);
    place();
    await mountOutline(host);

    const started = performance.now();
    expandAllOutline(tab);
    expect(Object.keys(tab.session.ui.outlineOpen)).toHaveLength(2 * FIRST_SECTIONS + 1);
    const values = outlineValues();
    const elapsed = performance.now() - started;

    // Root + 1000 sections + 1000 h3 + 1000 p + 1000 span + 1000 text rows.
    expect(values.rows.length).toBeLessThan(40);
    expect(values.padBottom).toBeGreaterThan(OUTLINE_ROW_HEIGHT * 1000);
    expect(elapsed).toBeLessThan(2000);
  });
});
