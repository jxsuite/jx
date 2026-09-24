import { describe, expect, test } from "bun:test";
import type { JxMutableNode } from "../types.ts";
import type { JxDocOp } from "../src/doc-ops.ts";
import {
  applyDocOpToDoc,
  applyDocOpsWithInverse,
  childArray,
  cloneValue,
  getNodeAtPath,
  inverseOf,
} from "../src/doc-ops.ts";

function doc(): JxMutableNode {
  return {
    children: [
      { tagName: "h1", textContent: "Title" },
      { children: [{ tagName: "p" }], tagName: "section" },
    ],
    tagName: "div",
  };
}

describe("getNodeAtPath", () => {
  test("walks nested paths and tolerates missing segments", () => {
    const d = doc();
    expect(getNodeAtPath(d, [])).toBe(d);
    expect(getNodeAtPath(d, ["children", 0, "textContent"])).toBe(
      "Title" as unknown as JxMutableNode,
    );
    expect(getNodeAtPath(d, ["children", 9, "textContent"])).toBeUndefined();
  });
});

describe("childArray", () => {
  test("lazily creates children on a leaf node", () => {
    const node: JxMutableNode = { tagName: "p" };
    const children = childArray(node);
    expect(children).toEqual([]);
    expect(node.children).toBe(children);
  });

  test("refuses a children array passed as the node", () => {
    expect(() => childArray([] as unknown as JxMutableNode)).toThrow(TypeError);
  });

  test("refuses mapped-array children", () => {
    const node = {
      children: { map: {} },
      tagName: "ul",
    } as unknown as JxMutableNode as unknown as JxMutableNode;
    expect(() => childArray(node)).toThrow(TypeError);
  });
});

describe("cloneValue", () => {
  test("deep-clones objects and passes null/undefined through", () => {
    const value = { nested: { a: [1, 2] } };
    const clone = cloneValue(value);
    expect(clone).toEqual(value);
    expect(clone).not.toBe(value);
    expect(clone.nested).not.toBe(value.nested);
    expect(cloneValue(null)).toBeNull();
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the undefined pass-through IS the case under test
    expect(cloneValue(undefined)).toBeUndefined();
  });
});

describe("applyDocOpToDoc", () => {
  test("set-key sets, replaces, and deletes", () => {
    const d = doc();
    applyDocOpToDoc(d, { key: "textContent", op: "set-key", path: ["children", 0], value: "New" });
    expect((d.children as JxMutableNode[])[0]!.textContent).toBe("New");
    applyDocOpToDoc(d, { key: "textContent", op: "set-key", path: ["children", 0] });
    expect("textContent" in (d.children as JxMutableNode[])[0]!).toBe(false);
  });

  test("set-key on a missing node throws with a machine-readable reason", () => {
    expect(() =>
      applyDocOpToDoc(doc(), { key: "x", op: "set-key", path: ["children", 9], value: 1 }),
    ).toThrow("doc-op-node-not-found:children/9");
  });

  test("insert/remove/set-child splice the children array", () => {
    const d = doc();
    applyDocOpToDoc(d, { index: 1, node: "loose", op: "insert-child", parentPath: [] });
    expect((d.children as unknown[])[1]).toBe("loose");
    applyDocOpToDoc(d, {
      index: 1,
      node: { tagName: "aside" },
      op: "set-child",
      parentPath: [],
    });
    expect((d.children as JxMutableNode[])[1]!.tagName).toBe("aside");
    applyDocOpToDoc(d, { index: 1, op: "remove-child", parentPath: [] });
    expect(d.children).toHaveLength(2);
  });

  test("move-child resolves both parents before splicing (same-level sibling move)", () => {
    const d = doc();
    // Move h1 into the section (which sits at index 1 BEFORE the removal).
    applyDocOpToDoc(d, {
      fromIndex: 0,
      fromParentPath: [],
      op: "move-child",
      toIndex: 1,
      toParentPath: ["children", 1],
    });
    expect(d.children).toHaveLength(1);
    const section = (d.children as JxMutableNode[])[0]!;
    expect((section.children as JxMutableNode[])[1]!.tagName).toBe("h1");
  });

  test("inserted nodes are cloned, never aliased to the op", () => {
    const d = doc();
    const node = { tagName: "em" };
    applyDocOpToDoc(d, { index: 0, node, op: "insert-child", parentPath: [] });
    node.tagName = "mutated";
    expect((d.children as JxMutableNode[])[0]!.tagName).toBe("em");
  });

  test("unknown op kinds throw", () => {
    expect(() => applyDocOpToDoc(doc(), { op: "nope" } as unknown as JxDocOp)).toThrow(
      "unknown-doc-op:nope",
    );
  });
});

// ─── inverseOf ───────────────────────────────────────────────────────────────

/** Apply `op`, then its inverse, and hand back the document — which must equal what it started as. */
function roundTrip(start: JxMutableNode, op: JxDocOp): JxMutableNode {
  const d = cloneValue(start);
  const inverse = inverseOf(d, op);
  applyDocOpToDoc(d, op);
  applyDocOpToDoc(d, inverse);
  return d;
}

describe("inverseOf", () => {
  test("set-key restores a changed value, and deletes a key the op created", () => {
    expect(inverseOf(doc(), { key: "tagName", op: "set-key", path: [], value: "main" })).toEqual({
      key: "tagName",
      op: "set-key",
      path: [],
      value: "div",
    });
    // No `value` member at all: absent is "delete", which is what undoing a creation must do.
    expect(inverseOf(doc(), { key: "id", op: "set-key", path: [], value: "x" })).toEqual({
      key: "id",
      op: "set-key",
      path: [],
    });
    expect(roundTrip(doc(), { key: "id", op: "set-key", path: [], value: "x" })).toEqual(doc());
    expect(roundTrip(doc(), { key: "textContent", op: "set-key", path: ["children", 0] })).toEqual(
      doc(),
    );
  });

  test("the inverse holds a clone, never the document's own object", () => {
    const d = doc();
    const inverse = inverseOf(d, { key: "children", op: "set-key", path: [] }) as {
      value: unknown;
    };
    expect(inverse.value).toEqual(d.children);
    expect(inverse.value).not.toBe(d.children);
  });

  test("insert-child, remove-child and set-child invert one another", () => {
    const node = { tagName: "hr" };
    expect(inverseOf(doc(), { index: 1, node, op: "insert-child", parentPath: [] })).toEqual({
      index: 1,
      op: "remove-child",
      parentPath: [],
    });
    expect(inverseOf(doc(), { index: 0, op: "remove-child", parentPath: [] })).toEqual({
      index: 0,
      node: { tagName: "h1", textContent: "Title" },
      op: "insert-child",
      parentPath: [],
    });
    for (const op of [
      { index: 2, node, op: "insert-child", parentPath: [] },
      { index: 0, op: "remove-child", parentPath: ["children", 1] },
      { index: 0, node, op: "set-child", parentPath: [] },
    ] as JxDocOp[]) {
      expect(roundTrip(doc(), op)).toEqual(doc());
    }
  });

  /* A move shifts sibling paths under both parents, so each parent path of the inverse is written
     in post-move coordinates. These are the shapes that shift, including the insertion side's
     inclusive boundary. */
  test("move-child inverts in post-move coordinates, whichever parent the shift lands on", () => {
    const tree = (): JxMutableNode => ({
      children: [
        { tagName: "a" },
        { children: [{ tagName: "b1" }, { tagName: "b2" }], tagName: "b" },
        { children: [{ tagName: "c1" }], tagName: "c" },
      ],
      tagName: "root",
    });
    const moves: JxDocOp[] = [
      // Same parent, forwards and backwards (toIndex in post-removal coordinates).
      { fromIndex: 0, fromParentPath: [], op: "move-child", toIndex: 2, toParentPath: [] },
      { fromIndex: 2, fromParentPath: [], op: "move-child", toIndex: 0, toParentPath: [] },
      // Into a later sibling: the removal shifts the target parent's own path down.
      {
        fromIndex: 0,
        fromParentPath: [],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 2],
      },
      // Out of a nested parent to an earlier root index: the insertion shifts the source path up.
      {
        fromIndex: 0,
        fromParentPath: ["children", 1],
        op: "move-child",
        toIndex: 0,
        toParentPath: [],
      },
      // Between two nested parents.
      {
        fromIndex: 1,
        fromParentPath: ["children", 1],
        op: "move-child",
        toIndex: 1,
        toParentPath: ["children", 2],
      },
      // Out to the root AT the source parent's own index: the insertion shifts it, inclusively.
      {
        fromIndex: 0,
        fromParentPath: ["children", 1],
        op: "move-child",
        toIndex: 1,
        toParentPath: [],
      },
    ];
    for (const op of moves) {
      expect(roundTrip(tree(), op)).toEqual(tree());
    }
    expect(
      inverseOf(tree(), {
        fromIndex: 0,
        fromParentPath: [],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 2],
      }),
    ).toEqual({
      fromIndex: 0,
      fromParentPath: ["children", 1],
      op: "move-child",
      toIndex: 0,
      toParentPath: [],
    });
  });

  test("undoing an insert into a childless node leaves an empty children array, as Studio's does", () => {
    const d = doc();
    const inverse = inverseOf(d, {
      index: 0,
      node: { tagName: "b" },
      op: "insert-child",
      parentPath: ["children", 0],
    });
    applyDocOpToDoc(d, {
      index: 0,
      node: { tagName: "b" },
      op: "insert-child",
      parentPath: ["children", 0],
    });
    applyDocOpToDoc(d, inverse);
    expect((d.children as JxMutableNode[])[0]).toEqual({
      children: [],
      tagName: "h1",
      textContent: "Title",
    });
  });

  test("the insertion side's shift is inclusive: a node inserted AT a parent's index moves it", () => {
    const tree: JxMutableNode = {
      children: [{ tagName: "a" }, { children: [{ tagName: "b1" }], tagName: "b" }],
      tagName: "root",
    };
    expect(
      inverseOf(tree, {
        fromIndex: 0,
        fromParentPath: ["children", 1],
        op: "move-child",
        toIndex: 1,
        toParentPath: [],
      }),
    ).toEqual({
      fromIndex: 1,
      fromParentPath: [],
      op: "move-child",
      toIndex: 0,
      toParentPath: ["children", 2],
    });
  });

  /* The applier inserts with `splice`, which appends past the end and counts a negative index from
     it, so the inverse must name the slot the node really landed in. */
  test("an index the applier clamps is recorded as the slot the node landed in", () => {
    for (const [index, slot] of [
      [99, 2],
      [-1, 1],
      [-99, 0],
    ] as const) {
      const d = doc();
      const op: JxDocOp = { index, node: { tagName: "x" }, op: "insert-child", parentPath: [] };
      expect(inverseOf(d, op)).toEqual({ index: slot, op: "remove-child", parentPath: [] });
      expect(roundTrip(d, op)).toEqual(doc());
    }
    const move: JxDocOp = {
      fromIndex: 0,
      fromParentPath: [],
      op: "move-child",
      toIndex: 99,
      toParentPath: [],
    };
    expect((inverseOf(doc(), move) as { fromIndex: number }).fromIndex).toBe(1);
    expect(roundTrip(doc(), move)).toEqual(doc());
  });

  test("an insert or move into something that cannot hold children has no inverse", () => {
    const d: JxMutableNode = {
      children: [
        "loose text",
        { children: { map: {} }, tagName: "ul" } as unknown as JxMutableNode,
        { tagName: "p" },
      ],
      tagName: "div",
    };
    const into = (toParentPath: (string | number)[]): JxDocOp => ({
      fromIndex: 2,
      fromParentPath: [],
      op: "move-child",
      toIndex: 0,
      toParentPath,
    });
    expect(() => inverseOf(d, into(["children", 9]))).toThrow("doc-op-node-not-found:children/9");
    expect(() => inverseOf(d, into(["children", 0]))).toThrow("doc-op-node-not-found:children/0");
    expect(() => inverseOf(d, into(["children"]))).toThrow("doc-op-node-not-found:children");
    expect(() => inverseOf(d, into(["children", 1]))).toThrow("doc-op-mapped-children:children/1");
    expect(() =>
      inverseOf(d, { index: 0, node: {}, op: "insert-child", parentPath: ["children", 9] }),
    ).toThrow("doc-op-node-not-found:children/9");
    expect(() =>
      inverseOf(d, { index: 0, node: {}, op: "insert-child", parentPath: ["children", 1] }),
    ).toThrow("doc-op-mapped-children:children/1");
  });

  test("a move into the moved node's own subtree is refused, by the inverse and the applier", () => {
    const d = doc();
    const intoSelf: JxDocOp = {
      fromIndex: 1,
      fromParentPath: [],
      op: "move-child",
      toIndex: 0,
      toParentPath: ["children", 1],
    };
    const intoDescendant: JxDocOp = { ...intoSelf, toParentPath: ["children", 1, "children", 0] };
    expect(() => inverseOf(d, intoSelf)).toThrow("doc-op-move-into-self:children/1");
    expect(() => inverseOf(d, intoDescendant)).toThrow("doc-op-move-into-self");
    expect(() => applyDocOpToDoc(d, intoSelf)).toThrow("doc-op-move-into-self");
    expect(d).toEqual(doc());
  });

  test("an op whose target does not resolve has no inverse", () => {
    const d = doc();
    expect(() => inverseOf(d, { key: "x", op: "set-key", path: ["children", 9] })).toThrow(
      "doc-op-node-not-found:children/9",
    );
    expect(() => inverseOf(d, { index: 5, op: "remove-child", parentPath: [] })).toThrow(
      "doc-op-node-not-found:children/5",
    );
    expect(() =>
      inverseOf(d, { index: 0, node: {}, op: "set-child", parentPath: ["children", 0] }),
    ).toThrow("doc-op-node-not-found:children/0/children/0");
    expect(() =>
      inverseOf(d, {
        fromIndex: 0,
        fromParentPath: ["children", 7],
        op: "move-child",
        toIndex: 0,
        toParentPath: [],
      }),
    ).toThrow("doc-op-node-not-found");
    expect(() => inverseOf(d, { op: "bogus" } as unknown as JxDocOp)).toThrow(
      "unknown-doc-op:bogus",
    );
  });

  /** A copy of `node` with every empty `children` array removed. */
  function withoutEmptyChildren(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => withoutEmptyChildren(item));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === "children" && Array.isArray(value) && value.length === 0) {
          continue;
        }
        out[key] = withoutEmptyChildren(value);
      }
      return out;
    }
    return node;
  }

  /* The property every consumer relies on — Studio's undo, a run's journal, a room's rollback:
     apply any sequence, then every inverse in reverse, and the document is what it was. */
  test("any sequence undone in reverse restores the document exactly", () => {
    let seed = 20_260_924;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    /** Every element node's path, root first. */
    const nodePaths = (
      node: JxMutableNode,
      at: (string | number)[] = [],
    ): (string | number)[][] => {
      const kids = Array.isArray(node.children) ? node.children : [];
      return [
        at,
        ...kids.flatMap((kid, i) =>
          typeof kid === "object" ? nodePaths(kid as JxMutableNode, [...at, "children", i]) : [],
        ),
      ];
    };
    const childCount = (d: JxMutableNode, path: (string | number)[]) => {
      const node = getNodeAtPath(d, path);
      return Array.isArray(node?.children) ? node.children.length : 0;
    };

    for (let trial = 0; trial < 200; trial++) {
      const start: JxMutableNode = {
        children: [
          { tagName: "p", textContent: "one" },
          { children: [{ tagName: "em" }, "text"], tagName: "div" },
          { style: { color: "red" }, tagName: "span" },
        ],
        tagName: "section",
      };
      const d = cloneValue(start);
      const pairs: ReturnType<typeof applyDocOpsWithInverse> = [];
      for (let step = 0; step < 6; step++) {
        const paths = nodePaths(d);
        const path = pick(paths);
        const kind = pick(["set-key", "insert-child", "remove-child", "set-child", "move-child"]);
        let op: JxDocOp | null = null;
        const count = childCount(d, path);
        if (kind === "set-key") {
          op = pick([
            { key: "id", op: "set-key", path, value: `n${step}` },
            { key: "style", op: "set-key", path },
            { key: "textContent", op: "set-key", path, value: "t" },
          ] as JxDocOp[]);
        } else if (kind === "insert-child") {
          op = {
            index: Math.floor(random() * (count + 1)),
            node: { tagName: "i" },
            op: "insert-child",
            parentPath: path,
          };
        } else if (count > 0 && kind === "remove-child") {
          op = { index: Math.floor(random() * count), op: "remove-child", parentPath: path };
        } else if (count > 0 && kind === "set-child") {
          op = {
            index: Math.floor(random() * count),
            node: "swapped",
            op: "set-child",
            parentPath: path,
          };
        } else if (count > 0 && kind === "move-child") {
          const fromIndex = Math.floor(random() * count);
          const moving = [...path, "children", fromIndex];
          // Never into the moved node's own subtree.
          const targets = paths.filter(
            (p) => !(p.length >= moving.length && moving.every((seg, i) => seg === p[i])),
          );
          const toParentPath = pick(targets);
          const sameParent =
            toParentPath.length === path.length && toParentPath.every((s, i) => s === path[i]);
          const room = childCount(d, toParentPath) - (sameParent ? 1 : 0);
          op = {
            fromIndex,
            fromParentPath: path,
            op: "move-child",
            toIndex: Math.floor(random() * (room + 1)),
            toParentPath,
          };
        }
        if (op) {
          pairs.push(...applyDocOpsWithInverse(d, [op]));
        }
      }
      for (const { inverse } of pairs.toReversed()) {
        applyDocOpToDoc(d, inverse);
      }
      // Modulo the one documented residue: an empty `children` a forward op created.
      expect(withoutEmptyChildren(d)).toEqual(start);
    }
  });
});

describe("applyDocOpsWithInverse", () => {
  test("answers each op's pair, computed against the document just before it", () => {
    const d = doc();
    const pairs = applyDocOpsWithInverse(d, [
      { index: 0, node: { tagName: "hr" }, op: "insert-child", parentPath: [] },
      // Addresses the node the first op created.
      { key: "id", op: "set-key", path: ["children", 0], value: "rule" },
    ]);
    expect(pairs.map((p) => p.inverse)).toEqual([
      { index: 0, op: "remove-child", parentPath: [] },
      { key: "id", op: "set-key", path: ["children", 0] },
    ]);
    expect((d.children as JxMutableNode[])[0]).toEqual({ id: "rule", tagName: "hr" });
  });

  test("stops at the first op that does not apply, carrying the pairs already applied", () => {
    const d = doc();
    let caught: (Error & { applied?: unknown[] }) | null = null;
    try {
      applyDocOpsWithInverse(d, [
        { key: "id", op: "set-key", path: [], value: "kept" },
        { key: "x", op: "set-key", path: ["children", 9], value: 1 },
      ]);
    } catch (error) {
      caught = error as Error & { applied?: unknown[] };
    }
    expect(caught?.message).toBe("doc-op-node-not-found:children/9");
    expect(caught?.applied).toHaveLength(1);
    expect(d.id).toBe("kept");
  });

  /* The applier resolves a move's target before splicing the source, so a move that cannot land
     leaves the document untouched, and rolling back the applied pairs restores it exactly. */
  test("a move that cannot land loses nothing, and the applied pairs roll back exactly", () => {
    for (const toParentPath of [["children", 9], ["children"]]) {
      const d = doc();
      let caught: (Error & { applied?: { inverse: JxDocOp }[] }) | null = null;
      try {
        applyDocOpsWithInverse(d, [
          { key: "id", op: "set-key", path: [], value: "kept" },
          { fromIndex: 0, fromParentPath: [], op: "move-child", toIndex: 0, toParentPath },
        ]);
      } catch (error) {
        caught = error as Error & { applied?: { inverse: JxDocOp }[] };
      }
      expect(caught?.applied).toHaveLength(1);
      for (const { inverse } of caught!.applied!.toReversed()) {
        applyDocOpToDoc(d, inverse);
      }
      expect(d).toEqual(doc());
    }
  });

  test("the applier itself refuses a move into mapped children before splicing anything", () => {
    const d: JxMutableNode = {
      children: [
        { tagName: "p" },
        { children: { map: {} }, tagName: "ul" } as unknown as JxMutableNode,
      ],
      tagName: "div",
    };
    const before = cloneValue(d);
    expect(() =>
      applyDocOpToDoc(d, {
        fromIndex: 0,
        fromParentPath: [],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 1],
      }),
    ).toThrow(TypeError);
    expect(d).toEqual(before);
  });

  test("a non-Error thrown by the applier still carries the applied pairs", () => {
    const d = doc();
    const hostile = {
      key: "k",
      op: "set-key",
      path: [],
      get value() {
        // oxlint-disable-next-line no-throw-literal -- the case under test
        throw "not an error";
      },
    } as unknown as JxDocOp;
    let caught: (Error & { applied?: unknown[] }) | null = null;
    try {
      applyDocOpsWithInverse(d, [hostile]);
    } catch (error) {
      caught = error as Error & { applied?: unknown[] };
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("not an error");
    expect(caught?.applied).toEqual([]);
  });
});
