/**
 * The portable document tools (specs/ai.md §3.9): the producers in `DOC_TOOLS`, and the registry
 * entries `docToolEntries` builds over a host. A memory host stands in for Studio's tab, applying
 * ops with `applyDocOpsWithInverse` and keeping its own undo stack.
 */
import { describe, expect, test } from "bun:test";
import { applyDocOpToDoc, applyDocOpsWithInverse, cloneValue } from "@jxsuite/schema/doc-ops";
import type { JxDocOp } from "@jxsuite/schema/doc-ops";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { coerceIndex, DOC_TOOLS, docToolEntries, FROZEN_SENTENCE } from "../src/jx-tools/index.ts";
import type {
  DocTool,
  DocumentHost,
  DocumentRef,
  EditReceipt,
  Undoability,
  WriteReporter,
} from "../src/jx-tools/index.ts";
import { createLedger, createToolContext, createToolRegistry } from "../src/tools.ts";
import type { ToolArguments, ToolContext } from "../src/tools.ts";

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
      { $switch: "${state.mode}", cases: { warn: { tagName: "em" } }, tagName: "div" },
      { children: { $prototype: "Array", items: [], map: { tagName: "li" } }, tagName: "ul" },
    ],
    state: { count: 0 },
    tagName: "div",
  };
}

/** The static children of a fixture node, which every node these tests read has. */
function childrenOf(node: JxMutableNode): (JxMutableNode | string)[] {
  if (!Array.isArray(node.children)) {
    throw new TypeError("no static children");
  }
  return node.children;
}

function tool(name: string): DocTool {
  const found = DOC_TOOLS.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no producer ${name}`);
  }
  return found;
}

/** Freeze every object and array in `value`, so a producer that writes throws. */
function deepFreeze<T>(value: T): T {
  if (isNonNullObject(value)) {
    for (const member of Object.values(value)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

/** Run a producer against a frozen copy of `doc`, proving it reads and never writes. */
function plan(name: string, args: ToolArguments, doc: JxMutableNode = fixture()) {
  return tool(name).edit(deepFreeze(cloneValue(doc)), args);
}

function refusal(name: string, args: ToolArguments, doc?: JxMutableNode): string {
  const edit = plan(name, args, doc);
  if (edit.ok) {
    throw new Error(`${name} accepted ${JSON.stringify(args)}`);
  }
  return edit.error;
}

describe("the producers", () => {
  test("are the seven tree tools, in the order the model is offered them", () => {
    expect(DOC_TOOLS.map((producer) => producer.name)).toEqual([
      "set_property",
      "add_child",
      "set_style",
      "set_text",
      "add_state",
      "update_state",
      "move_node",
    ]);
  });

  test("coerceIndex is the schema's, re-exported", () => {
    expect(coerceIndex("3")).toBe(3);
    expect(coerceIndex("03")).toBeNull();
  });

  test("set_property sets, deletes on null or empty, and prunes under replaced children", () => {
    expect(plan("set_property", { key: "id", path: ["children", "0"], value: "x" })).toEqual({
      ok: true,
      ops: [{ key: "id", op: "set-key", path: ["children", 0], value: "x" }],
      selection: { kind: "keep" },
      summary: 'Set "id" at ["children",0].',
    });
    for (const value of [null, ""]) {
      const edit = plan("set_property", { key: "id", path: [], value });
      expect(edit.ok && edit.ops).toEqual([{ key: "id", op: "set-key", path: [] }]);
    }
    const children = plan("set_property", { key: "children", path: ["children", 1], value: [] });
    expect(children.ok && children.selection).toEqual({
      kind: "prune",
      under: [["children", 1, "children"]],
    });
  });

  test("set_property refuses what is not an element", () => {
    expect(refusal("set_property", { key: "id", path: ["children", 9] })).toBe(
      'No node exists at path ["children",9].',
    );
    expect(refusal("set_property", { key: "id", path: ["children"] })).toContain(
      "points at a children array",
    );
    expect(refusal("set_property", { key: "id", path: ["children", 0, "children", 0] })).toContain(
      "points at a text child",
    );
    expect(refusal("set_property", { key: "id", path: ["state", "count"] })).toContain(
      "points at a value",
    );
  });

  test("add_child inserts a clone at the slot it lands in", () => {
    const node = { tagName: "b" };
    const edit = plan("add_child", { index: 99, node, parentPath: ["children", 1] });
    expect(edit).toEqual({
      ok: true,
      ops: [{ index: 2, node, op: "insert-child", parentPath: ["children", 1] }],
      selection: { kind: "keep" },
      summary: 'Inserted node at ["children",1,"children",2].',
    });
    // The op carries a clone, so the arguments can never alias the document.
    const [insert] = edit.ok ? edit.ops : [];
    expect(insert?.op === "insert-child" && insert.node).not.toBe(node);
    const empty = plan("add_child", { index: 0, node, parentPath: ["children", 0, "children", 0] });
    expect(empty.ok).toBe(false);
    const leaf = plan("add_child", { index: 3, node, parentPath: [] }, { tagName: "hr" });
    expect(leaf.ok && leaf.ops).toEqual([{ index: 0, node, op: "insert-child", parentPath: [] }]);
  });

  test("add_child refuses a bad index, a missing parent, an array, a text child and a repeater", () => {
    const node = { tagName: "b" };
    expect(refusal("add_child", { index: -1, node, parentPath: [] })).toBe(
      "index must be a non-negative integer, such as 0 or 2 (got -1).",
    );
    expect(refusal("add_child", { index: 0, node, parentPath: ["children", 9] })).toBe(
      'No node exists at path ["children",9].',
    );
    expect(refusal("add_child", { index: 0, node, parentPath: ["children"] })).toContain(
      'Drop the trailing "children" segment — add_child appends',
    );
    expect(
      refusal("add_child", { index: 0, node, parentPath: ["children", 0, "children", 0] }),
    ).toContain("parentPath");
    expect(refusal("add_child", { index: 0, node, parentPath: ["children", 3] })).toBe(
      "Cannot insert into mapped-array children; edit the map template instead.",
    );
  });

  test("set_style writes the whole style object, and drops it when it empties", () => {
    expect(plan("set_style", { path: ["children", 0], property: "color", value: "red" })).toEqual({
      ok: true,
      ops: [{ key: "style", op: "set-key", path: ["children", 0], value: { color: "red" } }],
      selection: { kind: "keep" },
      summary: 'Set style "color" at ["children",0].',
    });
    const number = plan("set_style", { path: ["children", 1], property: "zIndex", value: 2 });
    expect(number.ok && number.ops).toEqual([
      {
        key: "style",
        op: "set-key",
        path: ["children", 1],
        value: { padding: "1rem", zIndex: "2" },
      },
    ]);
    const removed = plan("set_style", { path: ["children", 1], property: "padding", value: null });
    expect(removed.ok && removed.ops).toEqual([
      { key: "style", op: "set-key", path: ["children", 1] },
    ]);
  });

  test("set_style refuses a nested rule and a non-element", () => {
    for (const property of ["@media (min-width: 1px)", ":hover", "&.on", "[open]"]) {
      expect(refusal("set_style", { path: [], property, value: "x" })).toContain(
        "is a nested style rule",
      );
    }
    expect(refusal("set_style", { path: ["children", 9], property: "color" })).toContain(
      "No node exists",
    );
  });

  test("set_text replaces the text and the children, pruning the selection under them", () => {
    expect(plan("set_text", { path: ["children", 1], value: "t" })).toEqual({
      ok: true,
      ops: [
        { key: "textContent", op: "set-key", path: ["children", 1] },
        { key: "children", op: "set-key", path: ["children", 1], value: ["t"] },
      ],
      selection: { kind: "prune", under: [["children", 1, "children"]] },
      summary: 'Set text at ["children",1].',
    });
    expect(refusal("set_text", { path: ["children", 9], value: "t" })).toContain("No node exists");
  });

  test("add_state adds an entry, creating `state` when the document has none", () => {
    const edit = plan("add_state", { key: "title", value: "" });
    expect(edit.ok && edit.ops).toEqual([
      { key: "state", op: "set-key", path: [], value: { count: 0, title: "" } },
    ]);
    const fresh = plan("add_state", { key: "open", value: false }, { tagName: "div" });
    expect(fresh.ok && fresh.ops).toEqual([
      { key: "state", op: "set-key", path: [], value: { open: false } },
    ]);
    expect(refusal("add_state", { key: "count", value: 1 })).toContain('"count" already exists');
  });

  test("update_state changes or removes an entry, and refuses one that is absent", () => {
    const changed = plan("update_state", { key: "count", value: 2 });
    expect(changed.ok && [changed.ops, changed.summary]).toEqual([
      [{ key: "state", op: "set-key", path: [], value: { count: 2 } }],
      'Updated state "count".',
    ]);
    const removed = plan("update_state", { key: "count", value: null });
    expect(removed.ok && [removed.ops, removed.summary]).toEqual([
      [{ key: "state", op: "set-key", path: [] }],
      'Removed state "count".',
    ]);
    const kept = plan("update_state", { key: "a" }, { state: { a: 1, b: 2 }, tagName: "div" });
    expect(kept.ok && kept.ops).toEqual([
      { key: "state", op: "set-key", path: [], value: { b: 2 } },
    ]);
    expect(refusal("update_state", { key: "nope" })).toContain("Current state keys: count");
    expect(refusal("update_state", { key: "nope" }, { tagName: "div" })).toContain("(none)");
  });

  test("move_node plans the move and follows the node to where it lands", () => {
    expect(
      plan("move_node", { fromPath: ["children", 0], toIndex: 1, toParentPath: ["children", 1] }),
    ).toEqual({
      ok: true,
      ops: [
        {
          fromIndex: 0,
          fromParentPath: [],
          op: "move-child",
          toIndex: 1,
          toParentPath: ["children", 1],
        },
      ],
      selection: { from: ["children", 0], kind: "follow", to: ["children", 0, "children", 1] },
      summary: 'Moved node from ["children",0] to ["children",0,"children",1].',
    });
  });

  test("move_node refuses every move that cannot happen", () => {
    const move = (fromPath: (string | number)[], toParentPath: (string | number)[], toIndex = 0) =>
      refusal("move_node", { fromPath, toIndex, toParentPath });
    expect(
      refusal("move_node", { fromPath: ["children", 0], toIndex: 1.5, toParentPath: [] }),
    ).toBe("toIndex must be a non-negative integer, such as 0 or 2 (got 1.5).");
    expect(move([], [])).toBe("Cannot move the document root.");
    expect(move(["children", 9], [])).toBe('No node exists at fromPath ["children",9].');
    expect(move(["children", 2, "cases", "warn"], [])).toContain("is not a child in a children");
    expect(move(["children", 0], ["children", 9])).toBe(
      'No node exists at toParentPath ["children",9].',
    );
    expect(move(["children", 1], ["children", 1, "children", 0])).toContain(
      "Cannot move a node into itself",
    );
  });
});

/** A pseudo-random sequence, so the property test is reproducible from its seed. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Every element path in `doc`, the root included. */
function elementPaths(node: JxMutableNode, path: (string | number)[] = []): (string | number)[][] {
  const out = [path];
  if (Array.isArray(node.children)) {
    for (const [index, child] of node.children.entries()) {
      if (isNonNullObject(child)) {
        out.push(...elementPaths(child, [...path, "children", index]));
      }
    }
  }
  return out;
}

/** A random tree whose every element has a children array, so no edit creates one. */
function randomDoc(random: () => number, depth = 0): JxMutableNode {
  const count = depth > 2 ? 0 : Math.floor(random() * 4);
  const node: JxMutableNode = {
    children: Array.from({ length: count }, () => randomDoc(random, depth + 1)),
    tagName: ["div", "p", "section"][Math.floor(random() * 3)]!,
  };
  if (depth === 0) {
    node.state = { count: 0 };
  }
  return node;
}

/** Random arguments for `name` over `doc`, mostly addressing real elements. */
function randomArgs(name: string, doc: JxMutableNode, random: () => number): ToolArguments {
  const paths = elementPaths(doc);
  const pick = () => paths[Math.floor(random() * paths.length)]!;
  const index = Math.floor(random() * 5) - 1;
  switch (name) {
    case "set_property": {
      return {
        key: random() < 0.3 ? "children" : "id",
        path: pick(),
        value: random() < 0.3 ? null : [],
      };
    }
    case "add_child": {
      return { index, node: { tagName: "b" }, parentPath: pick() };
    }
    case "set_style": {
      return { path: pick(), property: "color", value: random() < 0.5 ? null : "red" };
    }
    case "set_text": {
      return { path: pick(), value: "t" };
    }
    case "add_state":
    case "update_state": {
      return { key: random() < 0.5 ? "count" : "other", value: random() < 0.3 ? null : 1 };
    }
    default: {
      return { fromPath: pick(), toIndex: index, toParentPath: pick() };
    }
  }
}

test("D1: an accepted edit applies to a clone without throwing, and its inverses restore it", () => {
  const random = rng(16);
  let accepted = 0;
  for (let trial = 0; trial < 400; trial++) {
    const doc = randomDoc(random);
    const producer = DOC_TOOLS[trial % DOC_TOOLS.length]!;
    const edit = producer.edit(deepFreeze(cloneValue(doc)), randomArgs(producer.name, doc, random));
    if (!edit.ok) {
      continue;
    }
    accepted += 1;
    const working = cloneValue(doc);
    const pairs = applyDocOpsWithInverse(working, edit.ops);
    for (const { inverse } of pairs.toReversed()) {
      applyDocOpToDoc(working, inverse);
    }
    expect([producer.name, working]).toEqual([producer.name, doc]);
  }
  // Non-vacuity: most trials produce an edit.
  expect(accepted).toBeGreaterThan(200);
});

// ─── The entries ─────────────────────────────────────────────────────────────

interface MemoryHostOptions {
  undoable?: Undoability;
  /** What `edit` answers instead of applying, when set. */
  receipt?: EditReceipt;
  /** Run between the plan and the commit, as a person editing during validation would. */
  meanwhile?: (doc: JxMutableNode) => void;
}

function memoryHost(doc: JxMutableNode | null, options: MemoryHostOptions = {}) {
  const undo: JxDocOp[][] = [];
  const ref: DocumentRef = { id: "doc", path: null };
  const host: DocumentHost = {
    edit(_ref, produce) {
      if (options.receipt) {
        return options.receipt;
      }
      // SAFETY: `resolve` only issues a ref when there is a document.
      const live = doc!;
      options.meanwhile?.(live);
      const edit = produce(live);
      if (!edit.ok) {
        return { applied: false, message: edit.error, reason: "refused" };
      }
      undo.push(applyDocOpsWithInverse(live, edit.ops).map((pair) => pair.inverse));
      return Promise.resolve({ applied: true, changed: edit.ops.length > 0 });
    },
    resolve: () => (doc ? ref : "Open a document first."),
    snapshot: () => doc!,
    undoable: options.undoable ?? "document",
  };
  return { host, undo };
}

const reporter: WriteReporter<string> = {
  after: async (_ref, before, summary) => ({ success: true, summary: `${before}|${summary}` }),
  before: async () => "before",
};

function harness(doc: JxMutableNode | null, options?: MemoryHostOptions) {
  const { host, undo } = memoryHost(doc, options);
  const registry = createToolRegistry();
  for (const entry of docToolEntries(host, { reporter })) {
    registry.register(entry);
  }
  const ctx: ToolContext = createToolContext({ callId: "call_1", ledger: createLedger() });
  return { ctx, registry, undo };
}

describe("docToolEntries", () => {
  test("lists read_document and the seven tree tools with their schemas", () => {
    const { registry } = harness(fixture());
    expect(registry.list().map((entry) => entry.name)).toEqual([
      "read_document",
      ...DOC_TOOLS.map((producer) => producer.name),
    ]);
    expect(registry.list()[1]?.parameters).toBe(DOC_TOOLS[0]!.parameters);
  });

  test("read_document reads the document, a subtree, or says nothing is there", async () => {
    const doc = fixture();
    const { registry } = harness(doc);
    expect(await registry.execute("read_document", {})).toEqual({ data: doc, success: true });
    expect(await registry.execute("read_document", { path: ["children", "0"] })).toEqual({
      data: childrenOf(doc)[0],
      success: true,
    });
    expect(await registry.execute("read_document", { path: ["children", 9] })).toEqual({
      error: 'No node exists at path ["children",9].',
      success: false,
    });
  });

  test("with no document, every tool answers the host's sentence", async () => {
    const { registry } = harness(null);
    for (const name of ["read_document", "set_text"]) {
      expect(await registry.execute(name, { path: [], value: "t" })).toEqual({
        error: "Open a document first.",
        success: false,
      });
    }
  });

  test("an edit is applied, recorded once in the ledger, and reported", async () => {
    const doc = fixture();
    const { ctx, registry, undo } = harness(doc);
    const result = await registry.execute("set_text", { path: ["children", 0], value: "t" }, ctx);

    expect(result).toEqual({ success: true, summary: 'before|Set text at ["children",0].' });
    expect(childrenOf(doc)[0]).toEqual({ children: ["t"], tagName: "p" });
    expect(undo).toHaveLength(1);
    expect(ctx.ledger.writes).toEqual([
      { disk: false, ok: true, path: "(untitled)", tool: 'Set text at ["children",0].' },
    ]);
  });

  test("a refusal costs no report, no write and no ledger entry", async () => {
    const { ctx, registry, undo } = harness(fixture());
    const result = await registry.execute("set_text", { path: ["children", 9], value: "t" }, ctx);
    expect(result.success).toBe(false);
    expect(undo).toEqual([]);
    expect(ctx.ledger.writes).toEqual([]);
  });

  test("the summary names where the edit landed in the document it ran on", async () => {
    const doc = fixture();
    // Someone appends a child to the root while the call validates.
    const { registry } = harness(doc, {
      meanwhile: (live) => childrenOf(live).push({ tagName: "hr" }),
    });
    const result = await registry.execute("add_child", {
      index: 99,
      node: { tagName: "b" },
      parentPath: [],
    });
    expect(result.summary).toBe('before|Inserted node at ["children",5].');
  });

  test("an edit the document no longer admits is refused at commit", async () => {
    const { ctx, registry } = harness(fixture(), {
      meanwhile: (live) => {
        live.children = [];
      },
    });
    const result = await registry.execute("set_text", { path: ["children", 0], value: "t" }, ctx);
    expect(result).toEqual({ error: 'No node exists at path ["children",0].', success: false });
    expect(ctx.ledger.writes).toEqual([]);
  });

  test("a frozen document answers the frozen sentence; any other refusal its own message", async () => {
    const frozen = harness(fixture(), {
      receipt: { applied: false, message: "ignored", reason: "frozen" },
    });
    expect(await frozen.registry.execute("set_text", { path: [], value: "t" })).toEqual({
      error: FROZEN_SENTENCE,
      success: false,
    });
    const invalid = harness(fixture(), {
      receipt: { applied: false, message: "It would not validate.", reason: "invalid" },
    });
    expect(await invalid.registry.execute("set_text", { path: [], value: "t" })).toEqual({
      error: "It would not validate.",
      success: false,
    });
  });

  test("a host that cannot undo records its write as a disk write", async () => {
    const { ctx, registry } = harness(fixture(), { undoable: "none" });
    await registry.execute("update_state", { key: "count", value: 1 }, ctx);
    expect(ctx.ledger.writes.map((write) => write.disk)).toEqual([true]);
  });
});
