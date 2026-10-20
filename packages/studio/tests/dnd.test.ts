import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { activeTab, closeTab, openTab, workspace } from "../src/workspace/workspace";
import { applyDropInstruction } from "../src/panels/dnd";
import { jsonClone } from "../src/utils/studio-utils";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

function openDoc(doc: JxMutableNode) {
  return openTab({ document: doc, id: "dnd-test" });
}

function makeDoc(): JxMutableNode {
  return {
    children: [
      {
        children: [{ tagName: "h2", textContent: "title" }],
        tagName: "section",
      },
      { tagName: "p", textContent: "first" },
      { tagName: "p", textContent: "second" },
    ],
    tagName: "div",
  };
}

/** The element children of `node`; the fixtures here hold no text or repeater children. */
function elementChildren(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !children.every((child) => isNodeObject(child))) {
    throw new Error("expected an array of element children");
  }
  return children;
}

/**
 * Walk the tree and assert no children array contains undefined/null holes. A hole fails its
 * `expect` before the walk recurses into it, so only real members are descended into.
 */
function assertNoHoles(node: JxMutableNode | string) {
  if (isString(node)) {
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      expect(child).toBeDefined();
      expect(child).not.toBeNull();
      assertNoHoles(child);
    }
  }
}

describe("applyDropInstruction — tree-node moves", () => {
  beforeEach(() => {
    for (const id of workspace.tabs.keys()) {
      closeTab(id);
    }
  });

  test("reorder-above moves node before target", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-above" },
      { path: ["children", 2], type: "tree-node" },
      ["children", 0],
    );
    const children = elementChildren(tab.doc.document);
    expect(children.map((c) => c.textContent ?? c.tagName)).toEqual(["second", "section", "first"]);
    assertNoHoles(tab.doc.document);
  });

  test("reorder-below moves node after target", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-below" },
      { path: ["children", 0], type: "tree-node" },
      ["children", 2],
    );
    const children = elementChildren(tab.doc.document);
    expect(children.map((c) => c.textContent ?? c.tagName)).toEqual(["first", "second", "section"]);
    assertNoHoles(tab.doc.document);
  });

  test("make-child appends node into target's children", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "make-child" },
      { path: ["children", 1], type: "tree-node" },
      ["children", 0],
    );
    const sectionChildren = elementChildren(elementChildren(tab.doc.document)[0]);
    expect(sectionChildren).toHaveLength(2);
    expect(sectionChildren[1]!.textContent).toBe("first");
    expect(tab.doc.document.children).toHaveLength(2);
    assertNoHoles(tab.doc.document);
  });

  test("repeated application with stale paths never corrupts the document", () => {
    // Regression: pragmatic-dnd fires onDrop on every stacked drop target, so the
    // Same drop used to apply once per nested ancestor. After the first move the
    // Source path is stale; subsequent applications spliced undefined into children
    // And crashed the layers panel. The mutation layer must stay corruption-free
    // Even if called repeatedly with the same (now stale) arguments.
    const tab = openDoc(makeDoc());
    const src = { path: ["children", 2], type: "tree-node" };
    applyDropInstruction(activeTab.value, { type: "make-child" }, src, ["children", 0]);
    // Simulate the outer stacked targets firing with the same stale source path
    applyDropInstruction(activeTab.value, { type: "make-child" }, src, [
      "children",
      0,
      "children",
      0,
    ]);
    applyDropInstruction(activeTab.value, { type: "reorder-above" }, src, ["children", 0]);

    assertNoHoles(tab.doc.document);
    // First application moved "second" into the section; stale repeats were no-ops
    const children = elementChildren(tab.doc.document);
    expect(children).toHaveLength(2);
    expect(elementChildren(children[0]).map((c) => c.textContent)).toEqual(["title", "second"]);
  });

  test("reorder around a root-level path is a no-op", () => {
    const tab = openDoc(makeDoc());
    const before = jsonClone(tab.doc.document);
    // TargetPath ["children"] has no parent element and a non-numeric index
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-above" },
      { path: ["children", 1], type: "tree-node" },
      ["children"],
    );
    expect(jsonClone(tab.doc.document)).toEqual(before);
  });
});

describe("applyDropInstruction — block inserts", () => {
  beforeEach(() => {
    for (const id of workspace.tabs.keys()) {
      closeTab(id);
    }
  });

  test("reorder-above inserts fragment before target", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-above" },
      { fragment: { tagName: "hr" }, type: "block" },
      ["children", 1],
    );
    const children = elementChildren(tab.doc.document);
    expect(children).toHaveLength(4);
    expect(children[1]!.tagName).toBe("hr");
    assertNoHoles(tab.doc.document);
  });

  test("make-child appends fragment into target", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "make-child" },
      { fragment: { tagName: "img" }, type: "block" },
      ["children", 0],
    );
    const sectionChildren = elementChildren(elementChildren(tab.doc.document)[0]);
    expect(sectionChildren).toHaveLength(2);
    expect(sectionChildren[1]!.tagName).toBe("img");
    assertNoHoles(tab.doc.document);
  });

  test("the dropped block is the selection afterwards, wherever it landed", () => {
    const tab = openDoc(makeDoc());
    applyDropInstruction(
      activeTab.value,
      { type: "make-child" },
      { fragment: { tagName: "img" }, type: "block" },
      ["children", 0],
    );
    expect(tab.session.selection).toEqual([["children", 0, "children", 1]]);
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-below" },
      { fragment: { tagName: "hr" }, type: "block" },
      ["children", 1],
    );
    expect(tab.session.selection).toEqual([["children", 2]]);
  });

  test("reorder on a root-level path is a no-op", () => {
    const tab = openDoc(makeDoc());
    const before = jsonClone(tab.doc.document);
    applyDropInstruction(
      activeTab.value,
      { type: "reorder-below" },
      { fragment: { tagName: "hr" }, type: "block" },
      ["children"],
    );
    expect(jsonClone(tab.doc.document)).toEqual(before);
  });
});

describe("applyDropInstruction — tab routing", () => {
  test("a null tab is a no-op (the originating tab is gone)", () => {
    const tab = openDoc(makeDoc());
    const before = JSON.stringify(tab.doc.document);
    applyDropInstruction(
      null,
      { type: "reorder-above" },
      {
        path: ["children", 2],
        type: "tree-node",
      },
      ["children", 0],
    );
    applyDropInstruction(
      null,
      { type: "make-child" },
      {
        fragment: { tagName: "img" },
        type: "block",
      },
      ["children", 0],
    );
    expect(JSON.stringify(tab.doc.document)).toBe(before);
  });
});
