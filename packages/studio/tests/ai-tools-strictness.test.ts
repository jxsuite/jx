/**
 * The probe table for the document tools' strictness (specs/ai.md §3.1): a tool refuses an edit
 * that would corrupt the tree or succeed without effect, leaving the document, its history and the
 * ledger untouched, and coerces an index written as a canonical numeric string to the integer it
 * names.
 */
import "./with-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { createToolRegistry } from "@jxsuite/ai";
import type { ToolArguments } from "@jxsuite/ai/tools";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { toRaw } from "../src/reactivity";
import { registerAiTools } from "../src/services/ai-tools";
import { createTab, disposeTab } from "../src/tabs/tab";
import type { Tab } from "../src/tabs/tab";
import { undo } from "../src/tabs/transact";
import { recordingContext } from "./harness/recording-context";

/**
 * Text, a section with two paragraphs, a `$switch`, and a repeater: one of every child shape. A tab
 * stores the repeater as a member of the `ul`'s children array, so its template's path is
 * `["children", 3, "children", 0, "map"]`.
 */
function fixture(): JxMutableNode {
  return {
    children: [
      { children: ["hello"], tagName: "p" },
      {
        children: [
          { tagName: "p", textContent: "a" },
          { tagName: "p", textContent: "b" },
        ],
        tagName: "section",
      },
      { $switch: "${state.mode}", cases: { warn: { tagName: "em" } }, tagName: "div" },
      { children: { $prototype: "Array", items: [], map: { tagName: "li" } }, tagName: "ul" },
    ],
    state: { count: 0 },
    tagName: "div",
  };
}

const tabs: Tab[] = [];

function harness() {
  const tab = createTab({ document: fixture(), id: "probe" });
  tabs.push(tab);
  const registry = createToolRegistry();
  registerAiTools(registry, { getTab: () => tab, validate: async () => [] });
  return { registry, tab };
}

afterEach(() => {
  for (const tab of tabs.splice(0)) {
    disposeTab(tab);
  }
});

/** The document as JSON, so a refusal can be proven to have changed nothing at all. */
function snapshot(tab: Tab): string {
  return JSON.stringify(toRaw(tab.doc.document));
}

/** The forward ops of the newest history entry. */
function lastForward(tab: Tab) {
  return tab.history.snapshots[tab.history.index]!.forwardOps;
}

const REFUSALS: [string, string, ToolArguments, string][] = [
  [
    "a negative index",
    "add_child",
    { index: -1, node: { tagName: "b" }, parentPath: [] },
    "index must be a non-negative integer",
  ],
  [
    "a non-canonical numeric string",
    "add_child",
    { index: "01", node: { tagName: "b" }, parentPath: [] },
    '(got "01")',
  ],
  [
    "a fractional index",
    "add_child",
    { index: 1.5, node: { tagName: "b" }, parentPath: [] },
    "(got 1.5)",
  ],
  [
    "a word for an index",
    "add_child",
    { index: "first", node: { tagName: "b" }, parentPath: [] },
    'should be a number, got non-numeric string "first"',
  ],
  [
    "a parent that is a text child",
    "add_child",
    { index: 0, node: { tagName: "b" }, parentPath: ["children", 0, "children", 0] },
    "points at a text child, not a node",
  ],
  [
    "a move into the node's own subtree",
    "move_node",
    { fromPath: ["children", 1], toIndex: 0, toParentPath: ["children", 1, "children", 0] },
    "Cannot move a node into itself or its own descendants",
  ],
  [
    "a move of a $switch case",
    "move_node",
    { fromPath: ["children", 2, "cases", "warn"], toIndex: 0, toParentPath: [] },
    "is not a child in a children array",
  ],
  [
    "a move of a repeater's template",
    "move_node",
    { fromPath: ["children", 3, "children", 0, "map"], toIndex: 0, toParentPath: [] },
    "is not a child in a children array",
  ],
  [
    "a negative toIndex",
    "move_node",
    { fromPath: ["children", 0], toIndex: -1, toParentPath: [] },
    "toIndex must be a non-negative integer",
  ],
  [
    "a move into a children array",
    "move_node",
    { fromPath: ["children", 0], toIndex: 0, toParentPath: ["children", 1, "children"] },
    "points at a children array, not a node",
  ],
  [
    "a property on a text child",
    "set_property",
    { key: "id", path: ["children", 0, "children", 0], value: "x" },
    "points at a text child, not a node",
  ],
  [
    "a property on a children array",
    "set_property",
    { key: "id", path: ["children"], value: "x" },
    "points at a children array, not a node",
  ],
  [
    "a property on a state value",
    "set_property",
    { key: "id", path: ["state", "count"], value: "x" },
    "points at a value, not a node",
  ],
  [
    "a media query through set_style",
    "set_style",
    { path: ["children", 0], property: "@media (min-width: 600px)", value: "x" },
    'Use set_property with key "style"',
  ],
  [
    "a pseudo-class through set_style",
    "set_style",
    { path: ["children", 0], property: ":hover", value: "x" },
    "is a nested style rule",
  ],
  [
    "a style on a text child",
    "set_style",
    { path: ["children", 0, "children", 0], property: "color", value: "red" },
    "points at a text child",
  ],
  [
    "text on a text child",
    "set_text",
    { path: ["children", 0, "children", 0], value: "x" },
    "points at a text child",
  ],
];

describe("an edit that would corrupt the tree or change nothing is refused", () => {
  test.each(REFUSALS)("%s (%s)", async (_label, tool, args, sentence) => {
    const { registry, tab } = harness();
    const before = snapshot(tab);
    const ctx = recordingContext();

    const result = await registry.execute(tool, args, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain(sentence);
    expect(snapshot(tab)).toBe(before);
    expect(tab.history.snapshots).toHaveLength(1);
    expect(ctx.ledger.writes).toEqual([]);
  });
});

describe("an index written as a canonical numeric string names its integer", () => {
  test("add_child records the coerced index and parent path as numbers", async () => {
    const { registry, tab } = harness();
    const result = await registry.execute("add_child", {
      index: "1",
      node: { tagName: "b" },
      parentPath: ["children", "1"],
    });

    expect(result.success).toBe(true);
    expect(lastForward(tab)).toEqual([
      { index: 1, node: { tagName: "b" }, op: "insert-child", parentPath: ["children", 1] },
    ]);
  });

  test("set_property writes through a path whose index was a string", async () => {
    const { registry, tab } = harness();
    await registry.execute("set_property", { key: "id", path: ["children", "1"], value: "x" });
    expect(lastForward(tab)).toEqual([
      { key: "id", op: "set-key", path: ["children", 1], value: "x" },
    ]);
  });

  test("move_node coerces toIndex and both paths", async () => {
    const { registry, tab } = harness();
    const result = await registry.execute("move_node", {
      fromPath: ["children", "0"],
      toIndex: "0",
      toParentPath: ["children", "1"],
    });
    expect(result.success).toBe(true);
    expect(lastForward(tab)).toEqual([
      {
        fromIndex: 0,
        fromParentPath: [],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 1],
      },
    ]);
  });
});

describe("an index past the end lands at the end, and says so", () => {
  test("add_child appends, records the slot it landed in, and undoes exactly", async () => {
    const { registry, tab } = harness();
    const before = snapshot(tab);
    const result = await registry.execute("add_child", {
      index: 99,
      node: { tagName: "b" },
      parentPath: ["children", 1],
    });

    expect(result.summary).toContain('Inserted node at ["children",1,"children",2]');
    expect(lastForward(tab)![0]).toMatchObject({ index: 2, op: "insert-child" });
    undo(tab);
    expect(snapshot(tab)).toBe(before);
  });

  test("move_node lands at the end, names where, and undoes exactly", async () => {
    const { registry, tab } = harness();
    const before = snapshot(tab);
    const result = await registry.execute("move_node", {
      fromPath: ["children", 0],
      toIndex: 99,
      toParentPath: ["children", 1],
    });

    // The section moved up one when the paragraph before it left, so the landing path says 0.
    expect(result.summary).toContain('to ["children",0,"children",2]');
    expect(lastForward(tab)![0]).toMatchObject({ op: "move-child", toIndex: 2 });
    undo(tab);
    expect(snapshot(tab)).toBe(before);
  });
});

describe("the selection follows the edit", () => {
  test("a node moved into a later sibling is selected at its post-move path", async () => {
    const { registry, tab } = harness();
    tab.session.selection = [["children", 0]];
    await registry.execute("move_node", {
      fromPath: ["children", 0],
      toIndex: 1,
      toParentPath: ["children", 1],
    });

    expect(tab.session.selection).toEqual([["children", 0, "children", 1]]);
    expect(toRaw(tab.doc.document).children).toHaveLength(3);
  });

  test("replacing a node's children drops the selection under them, and keeps the node", async () => {
    const { registry, tab } = harness();
    tab.session.selection = [
      ["children", 1, "children", 0],
      ["children", 1],
      ["children", 0],
    ];
    await registry.execute("set_text", { path: ["children", 1], value: "plain" });

    expect(tab.session.selection).toEqual([
      ["children", 1],
      ["children", 0],
    ]);
  });
});
