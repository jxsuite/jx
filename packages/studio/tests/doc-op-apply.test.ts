import { describe, expect, test } from "bun:test";
import { applyDocOpToDoc, childArray, cloneValue } from "../src/tabs/doc-op-apply";
import type { JxDocOp } from "../src/tabs/patch-ops";
import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

const doc = (): JxMutableNode => ({
  children: [
    { tagName: "p", textContent: "a" },
    { tagName: "p", textContent: "b" },
  ],
  tagName: "div",
});

/** The element children of `node`; the fixtures here hold no text or repeater children. */
function elementChildren(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !children.every((child) => isNodeObject(child))) {
    throw new Error("expected an array of element children");
  }
  return children;
}

describe("applyDocOpToDoc", () => {
  test("set-key sets a value (cloned, not aliased)", () => {
    const d = doc();
    const value = { color: "red" };
    applyDocOpToDoc(d, { key: "style", op: "set-key", path: ["children", 0], value });
    const node = elementChildren(d)[0]!;
    expect(node.style).toEqual({ color: "red" });
    // Stored value is a clone — mutating the source must not leak in.
    value.color = "blue";
    expect(node.style).toEqual({ color: "red" });
  });

  test("set-key with undefined value deletes the key", () => {
    const d = doc();
    applyDocOpToDoc(d, {
      key: "textContent",
      op: "set-key",
      path: ["children", 0],
      value: undefined,
    });
    expect(elementChildren(d)[0]!.textContent).toBeUndefined();
  });

  test("set-key throws on a missing node", () => {
    expect(() =>
      applyDocOpToDoc(doc(), { key: "x", op: "set-key", path: ["children", 9], value: 1 }),
    ).toThrow(/doc-op-node-not-found/);
  });

  test("insert-child / remove-child / set-child splice the children array", () => {
    const d = doc();
    applyDocOpToDoc(d, {
      index: 1,
      node: { tagName: "span" },
      op: "insert-child",
      parentPath: [],
    });
    expect(elementChildren(d).map((c) => c.tagName)).toEqual(["p", "span", "p"]);

    applyDocOpToDoc(d, { index: 0, op: "remove-child", parentPath: [] });
    expect(elementChildren(d).map((c) => c.tagName)).toEqual(["span", "p"]);

    applyDocOpToDoc(d, { index: 0, node: { tagName: "h1" }, op: "set-child", parentPath: [] });
    expect(elementChildren(d).map((c) => c.tagName)).toEqual(["h1", "p"]);
  });

  test("move-child relocates a node between children arrays", () => {
    const d: JxMutableNode = {
      children: [
        { children: [{ tagName: "a" }], tagName: "div" },
        { children: [], tagName: "div" },
      ],
      tagName: "div",
    };
    applyDocOpToDoc(d, {
      fromIndex: 0,
      fromParentPath: ["children", 0],
      op: "move-child",
      toIndex: 0,
      toParentPath: ["children", 1],
    });
    const kids = elementChildren(d);
    expect(elementChildren(kids[0])).toHaveLength(0);
    expect(elementChildren(kids[1])[0]!.tagName).toBe("a");
  });

  test("throws on an unknown op", () => {
    const foreign = { op: "bogus" };
    /* SAFETY: deliberately not a JxDocOp. Ops replayed from a collab peer or a stored history cross
       a wire, so a kind outside the union can reach applyDocOpToDoc; this is that input, and the
       only member the applier reads before throwing is `op`. */
    const op = foreign as JxDocOp;
    expect(() => applyDocOpToDoc(doc(), op)).toThrow(/unknown-doc-op/);
  });
});

describe("cloneValue", () => {
  test("passes through null/undefined and deep-clones objects", () => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- verifying the undefined pass-through
    expect(cloneValue(undefined)).toBeUndefined();
    expect(cloneValue(null)).toBeNull();
    const src = { a: { b: 1 } };
    const out = cloneValue(src);
    expect(out).toEqual(src);
    expect(out.a).not.toBe(src.a);
  });
});

describe("childArray", () => {
  test("lazily creates the children array", () => {
    const node: JxMutableNode = { tagName: "div" };
    const arr = childArray(node);
    expect(arr).toEqual([]);
    expect(node.children).toBe(arr);
  });

  test("throws when the target is a children array, not a node", () => {
    // A path that stops on "children" resolves to the children array itself, which is the mistake
    // The guard exists for.
    const list = getNodeAtPath(doc(), ["children"]);
    expect(Array.isArray(list)).toBe(true);
    expect(() => childArray(list ?? {})).toThrow(/must point at a node/);
  });

  test("throws on mapped-array (non-array) children", () => {
    const mapped: JxMutableNode = { children: { $prototype: "Array", items: [] } };
    expect(() => childArray(mapped)).toThrow(/mapped-array/);
  });
});
