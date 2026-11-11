/**
 * Patch-op recording and transactDoc → patch-consumer wiring. Verifies that every instrumented
 * mutator emits the right ops, that un-instrumented mutations escalate, and that the
 * consumed-reference handshake and apply/escalate flow behave.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isReactive, toRaw } from "../src/reactivity";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { getNodeAtPath } from "../src/state";
import {
  beginRecording,
  endRecording,
  markNonInvertible,
  recordDocOp,
  setPatchConsumer,
} from "../src/tabs/patch-ops";
import { primarySelection, selectionAnchor } from "../src/tabs/selection";
import {
  mutateAddDef,
  mutateDuplicateNode,
  mutateInsertNode,
  mutateMoveNode,
  mutateRemoveNode,
  mutateUpdateAttribute,
  mutateUpdateFrontmatter,
  mutateUpdateMedia,
  mutateUpdateMediaStyle,
  mutateUpdateProp,
  mutateUpdateProperty,
  mutateUpdateStyle,
  mutateWrapNode,
  redo,
  transact,
  transactDoc,
  undo,
} from "../src/tabs/transact";

import type { JxDocOp, JxDocOpPair, JxPatchOp } from "../src/tabs/patch-ops";
import type { JxPath } from "../src/state";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";

let tab: Tab;
let tabCount = 0;

interface ConsumerLog {
  classified: JxPatchOp[][];
  marked: JxMutableNode[];
  applied: JxPatchOp[][];
  /** The VALUE-CARRYING forward ops each apply received — what actually crosses to the canvas. */
  appliedDocOps: JxDocOp[][];
  /** The whole pairs each apply received, for assertions about the inverse half. */
  appliedPairs: JxDocOpPair[][];
  escalated: string[];
}

function installConsumer({
  patchable = true,
  applyThrows = false,
}: { patchable?: boolean; applyThrows?: boolean } = {}): ConsumerLog {
  const log: ConsumerLog = {
    applied: [],
    appliedDocOps: [],
    appliedPairs: [],
    classified: [],
    escalated: [],
    marked: [],
  };
  setPatchConsumer({
    apply: (_tab, ops, record) => {
      log.applied.push(ops);
      log.appliedDocOps.push((record?.docOps ?? []).map((pair) => pair.forward));
      log.appliedPairs.push(record?.docOps ?? []);
      if (applyThrows) {
        throw new Error("boom");
      }
    },
    classify: (_tab, ops) => {
      log.classified.push(ops);
      return { patchable, reason: patchable ? "" : "test-reject" };
    },
    escalate: (reason) => {
      log.escalated.push(reason);
    },
    markConsumed: (ref) => {
      log.marked.push(ref);
    },
  });
  return log;
}

function freshDoc() {
  return {
    children: [
      { style: { color: "red" }, tagName: "p", textContent: "hello" },
      { tagName: "span", textContent: "world" },
    ],
    tagName: "div",
  };
}

beforeEach(() => {
  tabCount += 1;
  tab = openTab({ document: freshDoc(), id: `patch-test-${tabCount}` });
});

afterEach(() => {
  setPatchConsumer(null);
  closeAllTabs();
});

describe("mutator op recording", () => {
  function opsFor(mutation: (t: Tab) => void): JxPatchOp[] {
    const log = installConsumer();
    transactDoc(tab, mutation);
    expect(log.classified.length).toBe(1);
    return log.classified[0]!;
  }

  test("mutateUpdateStyle → set-style", () => {
    const ops = opsFor((t) => mutateUpdateStyle(t, ["children", 0], "color", "blue"));
    expect(ops).toEqual([{ op: "set-style", path: ["children", 0] }]);
  });

  test("mutateUpdateMediaStyle → set-style (including the no-media delegation)", () => {
    const withMedia = opsFor((t) =>
      mutateUpdateMediaStyle(t, ["children", 0], "sm", "color", "blue"),
    );
    expect(withMedia).toEqual([{ op: "set-style", path: ["children", 0] }]);
    const noMedia = opsFor((t) => mutateUpdateMediaStyle(t, ["children", 0], "", "color", "blue"));
    expect(noMedia).toEqual([{ op: "set-style", path: ["children", 0] }]);
  });

  test("mutateUpdateProperty textContent → set-text", () => {
    const ops = opsFor((t) => mutateUpdateProperty(t, ["children", 0], "textContent", "hi"));
    expect(ops).toEqual([{ op: "set-text", path: ["children", 0] }]);
  });

  test("mutateUpdateProperty event binding → set-prop with isEvent", () => {
    const ops = opsFor((t) =>
      mutateUpdateProperty(t, ["children", 0], "onclick", { $ref: "#/state/handler" }),
    );
    expect(ops).toEqual([{ isEvent: true, key: "onclick", op: "set-prop", path: ["children", 0] }]);
  });

  test("mutateUpdateProperty deleting an event binding keeps isEvent via the previous value", () => {
    transact(tab, (doc) => {
      const button = getNodeAtPath(doc, ["children", 0]);
      if (!button) {
        throw new Error("the fixture's first child is missing");
      }
      button["onclick"] = { $ref: "#/state/handler" };
    });
    const ops = opsFor((t) => mutateUpdateProperty(t, ["children", 0], "onclick"));
    expect(ops).toEqual([{ isEvent: true, key: "onclick", op: "set-prop", path: ["children", 0] }]);
  });

  test("mutateUpdateProperty plain property → set-prop without isEvent", () => {
    const ops = opsFor((t) => mutateUpdateProperty(t, ["children", 0], "href", "/x"));
    expect(ops).toEqual([{ isEvent: false, key: "href", op: "set-prop", path: ["children", 0] }]);
  });

  test("mutateUpdateAttribute → set-attr", () => {
    const ops = opsFor((t) => mutateUpdateAttribute(t, ["children", 0], "title", "t"));
    expect(ops).toEqual([{ attr: "title", op: "set-attr", path: ["children", 0] }]);
  });

  test("structural mutators → insert/remove/move/replace", () => {
    expect(opsFor((t) => mutateInsertNode(t, [], 1, { tagName: "div" }))).toEqual([
      { index: 1, op: "insert", parentPath: [] },
    ]);
    expect(opsFor((t) => mutateRemoveNode(t, ["children", 0]))).toEqual([
      { op: "remove", path: ["children", 0] },
    ]);
    expect(opsFor((t) => mutateDuplicateNode(t, ["children", 0]))).toEqual([
      { index: 1, op: "insert", parentPath: [] },
    ]);
    expect(opsFor((t) => mutateWrapNode(t, ["children", 0]))).toEqual([
      { op: "replace", path: ["children", 0] },
    ]);
    expect(opsFor((t) => mutateMoveNode(t, ["children", 0], [], 2))).toEqual([
      { fromPath: ["children", 0], op: "move", toIndex: 1, toParentPath: [] },
    ]);
  });

  test("compound transaction records all ops in order", () => {
    const ops = opsFor((t) => {
      mutateUpdateProperty(t, ["children", 0], "textContent", "a");
      mutateInsertNode(t, [], 1, { tagName: "p" });
    });
    expect(ops.map((o) => o.op)).toEqual(["set-text", "insert"]);
  });

  test("doc-level mutators → doc-meta", () => {
    expect(opsFor((t) => mutateAddDef(t, "count", { default: 0 }))).toEqual([
      { key: "state", op: "doc-meta" },
    ]);
    expect(opsFor((t) => mutateUpdateMedia(t, "sm", "(max-width: 640px)"))).toEqual([
      { key: "$media", op: "doc-meta" },
    ]);
    expect(opsFor((t) => mutateUpdateProp(t, ["children", 0], "label", "x"))).toEqual([
      { op: "replace", path: ["children", 0] },
    ]);
  });
});

describe("recording primitives", () => {
  test("markNonInvertible flags the current transaction record", () => {
    beginRecording();
    markNonInvertible();
    const record = endRecording();
    expect(record.invertible).toBe(false);
    // Recording state resets after endRecording.
    beginRecording();
    expect(endRecording().invertible).toBe(true);
  });
});

describe("transactDoc consumer wiring", () => {
  test("patchable verdict marks the new root reference consumed, then applies", () => {
    const log = installConsumer({ patchable: true });
    transactDoc(tab, (t) => mutateUpdateStyle(t, ["children", 0], "color", "blue"));
    expect(log.marked.length).toBe(1);
    expect(log.marked[0]).toBe(toRaw(tab.doc.document));
    expect(log.applied.length).toBe(1);
    expect(log.escalated.length).toBe(0);
    expect(tab.doc.dirty).toBe(true);
    expect(tab.history.snapshots.length).toBe(2);
  });

  test("non-patchable verdict neither marks nor applies", () => {
    const log = installConsumer({ patchable: false });
    transactDoc(tab, (t) => mutateUpdateStyle(t, ["children", 0], "color", "blue"));
    expect(log.marked.length).toBe(0);
    expect(log.applied.length).toBe(0);
  });

  test("un-instrumented mutation skips classification entirely", () => {
    const log = installConsumer();
    transact(tab, (doc) => {
      doc.className = "custom";
    });
    expect(log.classified.length).toBe(0);
    expect(log.marked.length).toBe(0);
    expect(log.applied.length).toBe(0);
  });

  test("apply failure escalates", () => {
    const log = installConsumer({ applyThrows: true, patchable: true });
    transactDoc(tab, (t) => mutateUpdateStyle(t, ["children", 0], "color", "blue"));
    expect(log.escalated.length).toBe(1);
    expect(log.escalated[0]).toStartWith("patch-apply-failed");
  });

  test("works without a registered consumer", () => {
    setPatchConsumer(null);
    transactDoc(tab, (t) => mutateUpdateStyle(t, ["children", 0], "color", "blue"));
    expect(getNodeAtPath(toRaw(tab.doc.document), ["children", 0])?.style).toEqual({
      color: "blue",
    });
  });
});

describe("transactDoc on a change to frontmatter fields alone", () => {
  /** A consumer that answers the fields verdict too (studio.md §22.5), recording what it is asked. */
  function installFieldsConsumer(patchable: boolean, applyThrows = false) {
    const asked: string[][] = [];
    const escalated: string[] = [];
    const log = { applied: 0, asked, escalated, marked: 0 };
    setPatchConsumer({
      apply: () => {
        throw new Error("a fields-only change must not post document ops");
      },
      applyFields: () => {
        log.applied += 1;
        if (applyThrows) {
          throw new Error("no host");
        }
      },
      classify: () => ({ patchable: false, reason: "not asked" }),
      classifyFields: (_tab, fmOps) => {
        log.asked.push(fmOps.map((op) => op.field));
        return { patchable, reason: patchable ? "" : "test-reject" };
      },
      escalate: (reason) => {
        log.escalated.push(reason);
      },
      markConsumed: () => {
        log.marked += 1;
      },
    });
    return log;
  }

  test("is asked of the fields verdict, and applied in place when it says so", () => {
    const log = installFieldsConsumer(true);
    transactDoc(tab, (t) => mutateUpdateFrontmatter(t, "title", "Spring"));
    expect(log.asked).toEqual([["title"]]);
    expect(log.marked).toBe(1);
    expect(log.applied).toBe(1);
    expect(tab.doc.content.frontmatter.title).toBe("Spring");
  });

  test("is redrawn as before when the verdict refuses it, and escalates when the post fails", () => {
    const refused = installFieldsConsumer(false);
    transactDoc(tab, (t) => mutateUpdateFrontmatter(t, "title", "Spring"));
    expect(refused.marked).toBe(0);
    expect(refused.applied).toBe(0);
    const failing = installFieldsConsumer(true, true);
    transactDoc(tab, (t) => mutateUpdateFrontmatter(t, "title", "Summer"));
    expect(failing.escalated[0]).toStartWith("patch-apply-failed");
  });

  test("a consumer with no fields verdict leaves it unrecorded, as before", () => {
    const log = installConsumer({ patchable: true });
    transactDoc(tab, (t) => mutateUpdateFrontmatter(t, "title", "Spring"));
    expect(log.classified).toEqual([]);
    expect(log.marked).toEqual([]);
  });
});

// ─── Undo/redo must carry values, not just classifications ────────────────────

describe("history replay records value-carrying ops", () => {
  test("undo posts the ops the canvas needs, not an empty patch", () => {
    // The canvas lives in an iframe and can only be patched from `record.docOps`. Recording only
    // The classification patch left this empty, so undo posted an EMPTY patch: the document
    // Changed, the patch classified as applicable (suppressing the full render), and the canvas
    // Silently kept showing the pre-undo content.
    const log = installConsumer();
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "edited"));
    log.appliedDocOps.length = 0;

    undo(tab);

    expect(log.appliedDocOps).toHaveLength(1);
    expect(log.appliedDocOps[0]).toEqual([
      { key: "textContent", op: "set-key", path: ["children", 0], value: "hello" },
    ]);
  });

  test("redo carries values too", () => {
    const log = installConsumer();
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "edited"));
    undo(tab);
    log.appliedDocOps.length = 0;

    redo(tab);

    expect(log.appliedDocOps[0]).toEqual([
      { key: "textContent", op: "set-key", path: ["children", 0], value: "edited" },
    ]);
  });

  test("undoing a structural change carries the reinserted node", () => {
    const log = installConsumer();
    transactDoc(tab, (t) => mutateRemoveNode(t, ["children", 1]));
    log.appliedDocOps.length = 0;

    undo(tab);

    const [op] = log.appliedDocOps[0]!;
    // Without the node itself the canvas could not re-render the restored block.
    expect(op).toMatchObject({
      index: 1,
      node: { tagName: "span", textContent: "world" },
      op: "insert-child",
    });
  });
});

// ─── A recorded op is plain data, whatever path the caller held (§4.1) ────────

describe("a mutator handed a reactive path records plain data", () => {
  /**
   * The path the Inspector edits at: the selection, read back off reactive session state. The
   * checks are what keep these tests honest. A plain array here would pass every one of them with
   * no copy taken at all.
   */
  function select(...paths: JxPath[]): JxPath {
    tab.session.selection = paths;
    const path = primarySelection(tab.session.selection);
    if (!path) {
      throw new Error("the selection just written is empty");
    }
    expect(isReactive(path)).toBe(true);
    expect(() => structuredClone(path)).toThrow();
    return path;
  }

  /** Every path an op names. */
  function pathsOf(op: JxDocOp): JxPath[] {
    switch (op.op) {
      case "set-key": {
        return [op.path];
      }
      case "move-child": {
        return [op.fromParentPath, op.toParentPath];
      }
      default: {
        return [op.parentPath];
      }
    }
  }

  /** Neither half of the pair may hold a Proxy, nor one of the caller's own arrays. */
  function expectOwnPlainPaths(pair: JxDocOpPair, ...given: JxPath[]) {
    for (const op of [pair.forward, pair.inverse]) {
      expect(() => structuredClone(op)).not.toThrow();
      for (const path of pathsOf(op)) {
        expect(isReactive(path)).toBe(false);
        for (const callers of given) {
          expect(path).not.toBe(callers);
          expect(path).not.toBe(toRaw(callers));
        }
      }
    }
  }

  /** Run one mutation and return the single pair the patch consumer was handed. */
  function pairFor(mutation: (t: Tab) => void): JxDocOpPair {
    const log = installConsumer();
    transactDoc(tab, mutation);
    expect(log.escalated).toEqual([]);
    expect(log.appliedPairs).toHaveLength(1);
    expect(log.appliedPairs[0]).toHaveLength(1);
    // What the iframe consumer posts is this array, so it is the thing that has to clone.
    expect(() => structuredClone(log.appliedDocOps[0])).not.toThrow();
    return log.appliedPairs[0]![0]!;
  }

  test("mutateUpdateProp: the set-key that reaches the canvas clones", () => {
    const path = select(["children", 0]);
    const pair = pairFor((t) => mutateUpdateProp(t, path, "label", "x"));
    expectOwnPlainPaths(pair, path);
    expect(pair.forward).toEqual({
      key: "$props",
      op: "set-key",
      path: ["children", 0],
      value: { label: "x" },
    });
    expect(pair.inverse).toEqual({
      key: "$props",
      op: "set-key",
      path: ["children", 0],
      value: undefined,
    });
  });

  test("mutateUpdateStyle and mutateUpdateAttribute: every set-key pair is plain", () => {
    const stylePath = select(["children", 0]);
    const style = pairFor((t) => mutateUpdateStyle(t, stylePath, "color", "blue"));
    expectOwnPlainPaths(style, stylePath);
    expect(style.forward).toMatchObject({ key: "style", path: ["children", 0] });

    const attrPath = select(["children", 1]);
    const attr = pairFor((t) => mutateUpdateAttribute(t, attrPath, "title", "t"));
    expectOwnPlainPaths(attr, attrPath);
    expect(attr.forward).toMatchObject({ key: "attributes", path: ["children", 1] });
  });

  test("mutateInsertNode: a reactive parentPath is copied into both halves", () => {
    const parentPath = select(["children", 0]);
    const pair = pairFor((t) => mutateInsertNode(t, parentPath, 0, { tagName: "b" }));
    expectOwnPlainPaths(pair, parentPath);
    expect(pair.forward).toEqual({
      index: 0,
      node: { tagName: "b" },
      op: "insert-child",
      parentPath: ["children", 0],
    });
    expect(pair.inverse).toEqual({ index: 0, op: "remove-child", parentPath: ["children", 0] });
  });

  test("mutateMoveNode: reactive fromPath and toParentPath are copied", () => {
    // The anchor is the target parent and the primary the node to move: both come off the selection.
    const fromPath = select(["children", 1], ["children", 0]);
    const toParentPath = selectionAnchor(tab.session.selection);
    if (!toParentPath) {
      throw new Error("the selection just written has no anchor");
    }
    expect(isReactive(toParentPath)).toBe(true);

    const pair = pairFor((t) => mutateMoveNode(t, fromPath, toParentPath, 0));
    expectOwnPlainPaths(pair, fromPath, toParentPath);
    expect(pair.forward.op).toBe("move-child");
    // The <p> left the root, so the <span> it moved into is now the root's first child.
    const moved = getNodeAtPath(toRaw(tab.doc.document), ["children", 0, "children", 0]);
    expect(moved?.tagName).toBe("p");
  });

  test("history holds plain ops, and undo then redo hand the canvas plain ops", () => {
    const path = select(["children", 0]);
    const log = installConsumer();
    transactDoc(tab, (t) => mutateUpdateProp(t, path, "label", "x"));

    // Replay hands recordDocOp the very op the entry holds, so the entry is where a Proxy would
    // Outlive the edit that recorded it.
    const entry = toRaw(tab.history.snapshots.at(-1)!);
    expect(entry.forwardOps).toHaveLength(1);
    expect(entry.inverseOps).toHaveLength(1);
    expect(() => structuredClone(toRaw(entry.forwardOps))).not.toThrow();
    expect(() => structuredClone(toRaw(entry.inverseOps))).not.toThrow();

    log.appliedDocOps.length = 0;
    undo(tab);
    expect(log.appliedDocOps).toHaveLength(1);
    expect(() => structuredClone(log.appliedDocOps[0])).not.toThrow();
    expect(log.appliedDocOps[0]).toEqual([
      { key: "$props", op: "set-key", path: ["children", 0], value: undefined },
    ]);

    log.appliedDocOps.length = 0;
    redo(tab);
    expect(log.appliedDocOps).toHaveLength(1);
    expect(() => structuredClone(log.appliedDocOps[0])).not.toThrow();
    expect(log.appliedDocOps[0]).toEqual([
      { key: "$props", op: "set-key", path: ["children", 0], value: { label: "x" } },
    ]);
    expect(log.escalated).toEqual([]);
  });

  test("recordDocOp copies, and leaves the pair it was given alone", () => {
    // A replay passes in the op history is holding: writing the copy back onto it would be a
    // Mutation of a stored entry from inside a transaction.
    const forwardPath: JxPath = ["children", 0];
    const inversePath: JxPath = ["children", 0];
    const parentPath: JxPath = [];
    const fromParentPath: JxPath = [];
    const toParentPath: JxPath = ["children", 1];
    const setKey: JxDocOpPair = {
      forward: { key: "hidden", op: "set-key", path: forwardPath, value: true },
      inverse: { key: "hidden", op: "set-key", path: inversePath, value: false },
    };
    const insert: JxDocOpPair = {
      forward: { index: 0, node: { tagName: "b" }, op: "insert-child", parentPath },
      inverse: { index: 0, op: "remove-child", parentPath },
    };
    const move: JxDocOpPair = {
      forward: { fromIndex: 0, fromParentPath, op: "move-child", toIndex: 0, toParentPath },
      inverse: {
        fromIndex: 0,
        fromParentPath: toParentPath,
        op: "move-child",
        toIndex: 0,
        toParentPath: fromParentPath,
      },
    };
    const given = [setKey, insert, move];
    const halves = given.map((pair): [JxDocOp, JxDocOp] => [pair.forward, pair.inverse]);
    const before = structuredClone(given);

    beginRecording();
    for (const pair of given) {
      recordDocOp(pair);
    }
    const { docOps } = endRecording();

    expect(docOps).toEqual(before);
    for (const [i, pair] of docOps.entries()) {
      expectOwnPlainPaths(pair, forwardPath, inversePath, parentPath, fromParentPath, toParentPath);
      expect(pair).not.toBe(given[i]);
      expect(pair.forward).not.toBe(given[i]!.forward);
      expect(pair.inverse).not.toBe(given[i]!.inverse);
    }

    // The caller's objects are untouched: same op objects, same path arrays, same contents.
    expect(given).toEqual(before);
    for (const [i, pair] of given.entries()) {
      const [forward, inverse] = halves[i]!;
      expect(pair.forward).toBe(forward);
      expect(pair.inverse).toBe(inverse);
    }
    expect(pathsOf(setKey.forward)[0]).toBe(forwardPath);
    expect(pathsOf(setKey.inverse)[0]).toBe(inversePath);
    expect(pathsOf(insert.forward)[0]).toBe(parentPath);
    expect(pathsOf(insert.inverse)[0]).toBe(parentPath);
    expect(pathsOf(move.forward)[0]).toBe(fromParentPath);
    expect(pathsOf(move.forward)[1]).toBe(toParentPath);
    expect(pathsOf(move.inverse)[0]).toBe(toParentPath);
    expect(pathsOf(move.inverse)[1]).toBe(fromParentPath);
  });
});
