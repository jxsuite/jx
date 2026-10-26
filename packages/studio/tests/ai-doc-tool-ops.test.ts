/**
 * The op golden for the assistant's tree tools (specs/ai.md §3.1): what each call records in the
 * tab's history, op for op, frozen in `fixtures/doc-tool-ops.json`.
 *
 * The golden was recorded from the tools as they wrote through Studio's mutators, before they
 * became pure producers of doc ops, so it is the proof that the producers emit what the mutators
 * recorded. Each probe runs on a fresh tab and records the result the model reads, the forward and
 * inverse ops of the one history entry the call left (or none), the selection afterwards, the
 * ledger entry, and whether undo restored the document exactly.
 *
 * A red golden means a tool's edit moved: if that was the intent, re-record with
 * `JX_UPDATE_GOLDENS=1 bun test --isolate tests/ai-doc-tool-ops.test.ts` and review the diff.
 */
import "./with-dom.ts";
import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createToolRegistry } from "@jxsuite/ai/tools";
import type { ToolArguments } from "@jxsuite/ai/tools";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import { toRaw } from "../src/reactivity";
import { registerAiTools } from "../src/services/ai-tools";
import { createTab, disposeTab } from "../src/tabs/tab";
import type { Tab } from "../src/tabs/tab";
import { undo } from "../src/tabs/transact";
import { recordingContext } from "./harness/recording-context";
import { jsonSafe, matchGolden } from "./harness/trace-recorder";

const GOLDEN = resolve(import.meta.dir, "fixtures", "doc-tool-ops.json");

/** Every child shape a tree tool meets: text, a styled section, a leaf, and a single-key state. */
function fixture(): JxMutableNode {
  return {
    children: [
      { children: ["hello"], tagName: "p" },
      {
        children: [
          { tagName: "p", textContent: "a" },
          { tagName: "p", textContent: "b" },
        ],
        style: { padding: "1rem" },
        tagName: "section",
      },
      { tagName: "hr" },
    ],
    state: { count: 0 },
    tagName: "div",
  };
}

interface Probe {
  /** What the probe pins, as the golden's key. */
  name: string;
  tool: string;
  args: ToolArguments;
  /** The selection before the call, when the tool's selection rule is what the probe pins. */
  selection?: JxPath[];
}

const PROBES: Probe[] = [
  {
    args: { key: "id", path: ["children", 0], value: "intro" },
    name: "set a key",
    tool: "set_property",
  },
  {
    args: { key: "textContent", path: ["children", 1, "children", 0], value: null },
    name: "remove a key with null",
    tool: "set_property",
  },
  {
    args: { key: "textContent", path: ["children", 1, "children", 1], value: "" },
    name: "remove a key with an empty string",
    tool: "set_property",
  },
  {
    args: { key: "title", path: ["children", 2] },
    name: "remove a key that is absent",
    tool: "set_property",
  },
  {
    args: { key: "children", path: ["children", 1], value: [{ tagName: "em" }] },
    name: "replace children, pruning the selection under them",
    selection: [
      ["children", 1, "children", 0],
      ["children", 1],
    ],
    tool: "set_property",
  },
  {
    args: { key: "attributes", path: ["children", 2], value: { "aria-hidden": "true" } },
    name: "set an object value",
    tool: "set_property",
  },
  {
    args: { key: "state", path: [], value: { open: false } },
    name: "set a document-level key",
    tool: "set_property",
  },
  {
    args: { key: "id", path: ["children", "1"], value: "s" },
    name: "a numeric-string index in a path",
    tool: "set_property",
  },
  {
    args: { path: ["children", 0], property: "color", value: "red" },
    name: "style a node with none",
    tool: "set_style",
  },
  {
    args: { path: ["children", 1], property: "margin", value: "0" },
    name: "add a style property",
    tool: "set_style",
  },
  {
    args: { path: ["children", 1], property: "padding", value: null },
    name: "remove the last style property",
    tool: "set_style",
  },
  {
    args: { path: ["children", 1], property: "zIndex", value: 2 },
    name: "a number style value is a string",
    tool: "set_style",
  },
  {
    args: { path: ["children", 1], value: "plain" },
    name: "set text, pruning the selection under the node",
    selection: [["children", 1, "children", 1]],
    tool: "set_text",
  },
  {
    args: { path: ["children", 2], value: "" },
    name: "set empty text on a leaf",
    tool: "set_text",
  },
  {
    args: { index: 0, node: { tagName: "h1" }, parentPath: [] },
    name: "insert first",
    tool: "add_child",
  },
  {
    args: { index: 99, node: { tagName: "p" }, parentPath: ["children", 1] },
    name: "insert past the end",
    tool: "add_child",
  },
  {
    args: { index: 0, node: { tagName: "i" }, parentPath: ["children", 2] },
    name: "insert into a node with no children",
    tool: "add_child",
  },
  {
    args: { index: "1", node: { tagName: "b" }, parentPath: ["children", "1"] },
    name: "insert at numeric-string coordinates",
    tool: "add_child",
  },
  { args: { key: "open", value: false }, name: "add a state entry", tool: "add_state" },
  {
    args: { key: "label", value: { default: "", type: "string" } },
    name: "add a typed state entry",
    tool: "add_state",
  },
  { args: { key: "count", value: 5 }, name: "update a state entry", tool: "update_state" },
  {
    args: { key: "count", value: null },
    name: "remove the last state entry",
    tool: "update_state",
  },
  {
    args: { fromPath: ["children", 0], toIndex: 3, toParentPath: [] },
    name: "move later in the same parent",
    selection: [["children", 0]],
    tool: "move_node",
  },
  {
    args: { fromPath: ["children", 2], toIndex: 0, toParentPath: [] },
    name: "move earlier in the same parent",
    selection: [["children", 2]],
    tool: "move_node",
  },
  {
    args: { fromPath: ["children", 0], toIndex: 1, toParentPath: ["children", 1] },
    name: "move into a later sibling",
    selection: [["children", 0]],
    tool: "move_node",
  },
  {
    args: { fromPath: ["children", 1, "children", 1], toIndex: 99, toParentPath: [] },
    name: "move out past the end",
    selection: [["children", 0]],
    tool: "move_node",
  },
  {
    args: { fromPath: ["children", 0], toIndex: 0, toParentPath: ["children", 2] },
    name: "move into a node with no children",
    tool: "move_node",
  },
  {
    args: { key: "id", path: ["children", 9], value: "x" },
    name: "refused: no node",
    tool: "set_property",
  },
  {
    args: { index: -1, node: { tagName: "b" }, parentPath: [] },
    name: "refused: negative index",
    tool: "add_child",
  },
  { args: { key: "count", value: 1 }, name: "refused: state exists", tool: "add_state" },
  { args: { key: "nope", value: 1 }, name: "refused: state missing", tool: "update_state" },
  {
    args: { fromPath: ["children", 1], toIndex: 0, toParentPath: ["children", 1, "children", 0] },
    name: "refused: into its own subtree",
    tool: "move_node",
  },
];

const tabs: Tab[] = [];

afterEach(() => {
  for (const tab of tabs.splice(0)) {
    disposeTab(tab);
  }
});

function snapshot(tab: Tab): string {
  return JSON.stringify(toRaw(tab.doc.document));
}

/** Run one probe on a fresh tab and record everything the golden pins. */
async function record(probe: Probe) {
  const tab = createTab({ document: fixture(), documentPath: "pages/probe.json", id: "probe" });
  tabs.push(tab);
  if (probe.selection) {
    tab.session.selection = probe.selection;
  }
  const registry = createToolRegistry();
  registerAiTools(registry, { getTab: () => tab, validate: async () => [] });
  const before = snapshot(tab);
  const ctx = recordingContext();

  const result = await registry.execute(probe.tool, probe.args, ctx);

  const entry = tab.history.snapshots.length > 1 ? tab.history.snapshots.at(-1)! : null;
  const selection = toRaw(tab.session.selection);
  let undone: boolean | null = null;
  if (entry) {
    undo(tab);
    // Structural, not textual: a deleted key that undo restores comes back last in key order.
    undone = Bun.deepEquals(JSON.parse(snapshot(tab)), JSON.parse(before));
  }
  return {
    forward: entry?.forwardOps ?? null,
    inverse: entry?.inverseOps ?? null,
    ledger: ctx.ledger.writes,
    result,
    selection,
    undone,
  };
}

test("each tree tool records the ops in the golden", async () => {
  const trace: Record<string, Awaited<ReturnType<typeof record>> & Pick<Probe, "args" | "tool">> =
    {};
  for (const probe of PROBES) {
    trace[probe.name] = { args: probe.args, tool: probe.tool, ...(await record(probe)) };
  }
  matchGolden(GOLDEN, jsonSafe(trace));
});

/**
 * The probes whose undo leaves `children: []` on a parent that had no children: one op cannot both
 * take the node back out and delete the key, and the residue renders and validates as the absent
 * key does (`inverseOf` in `@jxsuite/schema/doc-ops`).
 */
const CHILDREN_RESIDUE = new Set([
  "insert into a node with no children",
  "move into a node with no children",
]);

test("every probe that wrote is undone exactly, but for the children residue", async () => {
  for (const probe of PROBES) {
    const { undone } = await record(probe);
    if (undone !== null) {
      expect([probe.name, undone]).toEqual([probe.name, !CHILDREN_RESIDUE.has(probe.name)]);
    }
  }
});
