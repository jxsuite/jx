import { describe, test, expect } from "bun:test";
import {
  getNodeAtPath,
  parentElementPath,
  childIndex,
  pathKey,
  pathsEqual,
  isAncestor,
  flattenTree,
  nodeLabel,
  createState,
  applyMutation,
  selectNode,
  hoverNode,
  undo,
  redo,
  insertNode,
  removeNode,
  duplicateNode,
  moveNode,
  updateProperty,
  updateStyle,
  updateAttribute,
  addDef,
  removeDef,
  updateDef,
  renameDef,
  updateMediaStyle,
  updateNestedStyle,
  updateMediaNestedStyle,
  updateMedia,
  pushDocument,
  popDocument,
  updateProp,
  addSwitchCase,
  removeSwitchCase,
  renameSwitchCase,
} from "../src/state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDoc() {
  return {
    tagName: "div",
    children: [
      { tagName: "h1", textContent: "Hello" },
      {
        tagName: "section",
        children: [{ tagName: "p", textContent: "Paragraph" }, { tagName: "span" }],
      },
    ],
  };
}

/** @param {any} [doc] */
function makeState(doc) {
  return createState(doc || makeDoc());
}

// ─── Path utilities ──────────────────────────────────────────────────────────

describe("getNodeAtPath", () => {
  const doc = makeDoc();

  test("empty path returns root", () => {
    expect(getNodeAtPath(doc, [])).toBe(doc);
  });

  test("resolves first child", () => {
    expect(getNodeAtPath(doc, ["children", 0])).toBe(doc.children[0]);
  });

  test("resolves deeply nested child", () => {
    expect(getNodeAtPath(doc, ["children", 1, "children", 0])).toBe(
      /** @type {any} */ (doc.children[1]).children[0],
    );
  });

  test("returns undefined for invalid path", () => {
    expect(getNodeAtPath(doc, ["children", 99])).toBeUndefined();
  });

  test("returns undefined when traversing through null", () => {
    expect(getNodeAtPath(doc, ["children", 0, "children", 0])).toBeUndefined();
  });

  test("resolves a non-children key", () => {
    expect(getNodeAtPath(doc, ["tagName"])).toBe("div");
  });
});

describe("parentElementPath", () => {
  test("returns parent of a child path", () => {
    expect(parentElementPath(["children", 0])).toEqual([]);
  });

  test("returns parent of a deeply nested path", () => {
    expect(parentElementPath(["children", 1, "children", 0])).toEqual(["children", 1]);
  });

  test("returns null for root path", () => {
    expect(parentElementPath([])).toBeNull();
  });

  test("returns null for single-segment path", () => {
    expect(parentElementPath(["children"])).toBeNull();
  });
});

describe("childIndex", () => {
  test("returns last segment", () => {
    expect(childIndex(["children", 2])).toBe(2);
  });

  test("works with string segment", () => {
    expect(childIndex(["cases", "home"])).toBe("home");
  });
});

describe("pathKey", () => {
  test("empty path", () => {
    expect(pathKey([])).toBe("");
  });

  test("joins segments with /", () => {
    expect(pathKey(["children", 0, "children", 1])).toBe("children/0/children/1");
  });
});

describe("pathsEqual", () => {
  test("same reference", () => {
    const p = ["children", 0];
    expect(pathsEqual(p, p)).toBe(true);
  });

  test("equal paths", () => {
    expect(pathsEqual(["children", 0], ["children", 0])).toBe(true);
  });

  test("different lengths", () => {
    expect(pathsEqual(["children", 0], ["children", 0, "children"])).toBe(false);
  });

  test("different values", () => {
    expect(pathsEqual(["children", 0], ["children", 1])).toBe(false);
  });

  test("null paths", () => {
    expect(pathsEqual(null, ["children"])).toBe(false);
    expect(pathsEqual(["children"], null)).toBe(false);
  });

  test("null === null (identity check)", () => {
    expect(pathsEqual(null, null)).toBe(true);
  });

  test("empty paths are equal", () => {
    expect(pathsEqual([], [])).toBe(true);
  });
});

describe("isAncestor", () => {
  test("root is ancestor of everything", () => {
    expect(isAncestor([], ["children", 0])).toBe(true);
  });

  test("path is ancestor of itself", () => {
    expect(isAncestor(["children", 0], ["children", 0])).toBe(true);
  });

  test("parent is ancestor of child", () => {
    expect(isAncestor(["children", 1], ["children", 1, "children", 0])).toBe(true);
  });

  test("child is not ancestor of parent", () => {
    expect(isAncestor(["children", 1, "children", 0], ["children", 1])).toBe(false);
  });

  test("sibling is not ancestor", () => {
    expect(isAncestor(["children", 0], ["children", 1])).toBe(false);
  });
});

// ─── Tree flattening ─────────────────────────────────────────────────────────

describe("flattenTree", () => {
  test("flattens static children", () => {
    const doc = makeDoc();
    const rows = flattenTree(doc);
    expect(rows.length).toBe(5); // root + h1 + section + p + span
    expect(rows[0].nodeType).toBe("element");
    expect(rows[0].depth).toBe(0);
    expect(rows[1].node.tagName).toBe("h1");
    expect(rows[1].depth).toBe(1);
  });

  test("flattens $map children", () => {
    const doc = {
      tagName: "ul",
      children: {
        $prototype: "Array",
        items: { $ref: "#/$defs/list" },
        map: { tagName: "li", textContent: "item" },
      },
    };
    const rows = flattenTree(doc);
    expect(rows.some((r) => r.nodeType === "map")).toBe(true);
    const mapRow = rows.find((r) => r.nodeType === "map");
    expect(/** @type {any} */ (mapRow).depth).toBe(1);
    // Template element should be at depth 2
    const templateRow = rows.find((r) => r.node.tagName === "li" && r.depth === 2);
    expect(templateRow).toBeDefined();
  });

  test("flattens $switch cases", () => {
    const doc = {
      tagName: "div",
      $switch: "${route}",
      cases: {
        home: { tagName: "main", textContent: "Home" },
        about: { tagName: "main", textContent: "About" },
      },
    };
    const rows = flattenTree(doc);
    const caseRows = rows.filter((r) => r.nodeType === "case");
    expect(caseRows.length).toBe(2);
    expect(caseRows[0].depth).toBe(1);
  });

  test("emits case-ref for $ref cases", () => {
    const doc = {
      tagName: "div",
      $switch: "${route}",
      cases: {
        home: { $ref: "#/components/home" },
      },
    };
    const rows = flattenTree(doc);
    const refRows = rows.filter((r) => r.nodeType === "case-ref");
    expect(refRows.length).toBe(1);
  });

  test("stops recursion for custom component instances", () => {
    const doc = {
      tagName: "my-card",
      $props: { title: "Hi" },
      children: [{ tagName: "p" }],
    };
    const rows = flattenTree(doc);
    // Should only have the root — children are not recursed
    expect(rows.length).toBe(1);
  });

  test("leaf node returns single row", () => {
    const doc = { tagName: "br" };
    const rows = flattenTree(doc);
    expect(rows.length).toBe(1);
    expect(rows[0].path).toEqual([]);
  });
});

// ─── Node labels ─────────────────────────────────────────────────────────────

describe("nodeLabel", () => {
  test("null node returns ?", () => {
    expect(nodeLabel(null)).toBe("?");
  });

  test("$prototype Array shows Repeater", () => {
    expect(nodeLabel({ $prototype: "Array", items: { $ref: "#/$defs/posts" } })).toBe(
      "Repeater → #/$defs/posts",
    );
  });

  test("$id takes priority", () => {
    expect(nodeLabel({ $id: "hero", tagName: "section" })).toBe("hero");
  });

  test("tag + textContent", () => {
    expect(nodeLabel({ tagName: "p", textContent: "Hello world" })).toBe("p — Hello world");
  });

  test("truncates long text to 24 chars", () => {
    const label = nodeLabel({
      tagName: "p",
      textContent: "This is a very long paragraph text that exceeds the limit",
    });
    expect(label).toBe("p — This is a very long para");
  });

  test("$switch suffix", () => {
    expect(nodeLabel({ tagName: "div", $switch: "${x}" })).toBe("div ⇆");
  });

  test("defaults to div when no tagName", () => {
    expect(nodeLabel({})).toBe("div");
  });
});

// ─── State factory ───────────────────────────────────────────────────────────

describe("createState", () => {
  test("initializes with document", () => {
    const doc = makeDoc();
    const s = createState(doc);
    expect(s.document).toBe(doc);
    expect(s.selection).toBeNull();
    expect(s.hover).toBeNull();
  });

  test("history starts with one snapshot", () => {
    const s = makeState();
    expect(s.history.length).toBe(1);
    expect(s.historyIndex).toBe(0);
  });

  test("dirty starts as false", () => {
    expect(makeState().dirty).toBe(false);
  });

  test("ui defaults", () => {
    const s = makeState();
    expect(s.ui.leftTab).toBe("layers");
    expect(s.ui.rightTab).toBe("properties");
    expect(s.ui.zoom).toBe(1);
    expect(s.ui.activeMedia).toBeNull();
  });
});

// ─── Core mutation ───────────────────────────────────────────────────────────

describe("applyMutation", () => {
  test("returns new state with cloned document", () => {
    const s = makeState();
    const s2 = applyMutation(s, (doc) => {
      doc.tagName = "section";
    });
    expect(s2).not.toBe(s);
    expect(s2.document.tagName).toBe("section");
    expect(s.document.tagName).toBe("div"); // original unchanged
  });

  test("pushes to history", () => {
    const s = makeState();
    const s2 = applyMutation(s, () => {});
    expect(s2.history.length).toBe(2);
    expect(s2.historyIndex).toBe(1);
  });

  test("sets dirty to true", () => {
    const s = makeState();
    const s2 = applyMutation(s, () => {});
    expect(s2.dirty).toBe(true);
  });

  test("truncates future history on new mutation after undo", () => {
    let s = makeState();
    s = applyMutation(s, (doc) => (doc.tagName = "a"));
    s = applyMutation(s, (doc) => (doc.tagName = "b"));
    s = undo(s); // back to "a"
    s = applyMutation(s, (doc) => (doc.tagName = "c"));
    expect(s.history.length).toBe(3); // initial, "a", "c" — "b" discarded
    expect(s.document.tagName).toBe("c");
  });
});

// ─── Selection / hover ───────────────────────────────────────────────────────

describe("selectNode", () => {
  test("sets selection", () => {
    const s = selectNode(makeState(), ["children", 0]);
    expect(s.selection).toEqual(["children", 0]);
  });

  test("clears selection with null", () => {
    let s = selectNode(makeState(), ["children", 0]);
    s = selectNode(s, null);
    expect(s.selection).toBeNull();
  });
});

describe("hoverNode", () => {
  test("sets hover", () => {
    const s = hoverNode(makeState(), ["children", 1]);
    expect(s.hover).toEqual(["children", 1]);
  });
});

// ─── Undo / redo ─────────────────────────────────────────────────────────────

describe("undo", () => {
  test("does nothing at beginning of history", () => {
    const s = makeState();
    expect(undo(s)).toBe(s);
  });

  test("restores previous state", () => {
    let s = makeState();
    s = updateProperty(s, [], "tagName", "section");
    s = undo(s);
    expect(s.document.tagName).toBe("div");
    expect(s.historyIndex).toBe(0);
  });

  test("sets dirty to true", () => {
    let s = makeState();
    s = updateProperty(s, [], "tagName", "section");
    s = undo(s);
    expect(s.dirty).toBe(true);
  });
});

describe("redo", () => {
  test("does nothing at end of history", () => {
    const s = makeState();
    expect(redo(s)).toBe(s);
  });

  test("restores next state", () => {
    let s = makeState();
    s = updateProperty(s, [], "tagName", "section");
    s = undo(s);
    s = redo(s);
    expect(s.document.tagName).toBe("section");
    expect(s.historyIndex).toBe(1);
  });

  test("undo-redo round-trip preserves document", () => {
    let s = makeState();
    const original = s.document;
    s = updateProperty(s, [], "tagName", "section");
    s = undo(s);
    // After undo, document should equal original
    expect(s.document).toEqual(original);
  });
});

// ─── Document mutations ──────────────────────────────────────────────────────

describe("insertNode", () => {
  test("inserts a node at index", () => {
    let s = makeState();
    s = insertNode(s, [], 1, { tagName: "nav" });
    expect(s.document.children.length).toBe(3);
    expect(s.document.children[1].tagName).toBe("nav");
  });

  test("creates children array if missing", () => {
    let s = createState({ tagName: "div" });
    s = insertNode(s, [], 0, { tagName: "p" });
    expect(s.document.children).toEqual([{ tagName: "p" }]);
  });

  test("inserts at beginning", () => {
    let s = makeState();
    s = insertNode(s, [], 0, { tagName: "header" });
    expect(s.document.children[0].tagName).toBe("header");
  });
});

describe("removeNode", () => {
  test("removes a child", () => {
    let s = makeState();
    s = removeNode(s, ["children", 0]);
    expect(s.document.children.length).toBe(1);
    expect(s.document.children[0].tagName).toBe("section");
  });

  test("does nothing for root path", () => {
    const s = makeState();
    expect(removeNode(s, [])).toBe(s);
  });

  test("does nothing for null path", () => {
    const s = makeState();
    expect(removeNode(s, /** @type {any} */ (null))).toBe(s);
  });

  test("clears selection if removed node was selected", () => {
    let s = selectNode(makeState(), ["children", 0]);
    s = removeNode(s, ["children", 0]);
    expect(s.selection).toBeNull();
  });

  test("clears selection if selected node is descendant of removed", () => {
    let s = selectNode(makeState(), ["children", 1, "children", 0]);
    s = removeNode(s, ["children", 1]);
    expect(s.selection).toBeNull();
  });

  test("preserves selection if unrelated node removed", () => {
    let s = selectNode(makeState(), ["children", 1]);
    s = removeNode(s, ["children", 0]);
    expect(s.selection).toEqual(["children", 1]);
  });
});

describe("duplicateNode", () => {
  test("duplicates a node after original", () => {
    let s = makeState();
    s = duplicateNode(s, ["children", 0]);
    expect(s.document.children.length).toBe(3);
    expect(s.document.children[1].tagName).toBe("h1");
    expect(s.document.children[1].textContent).toBe("Hello");
  });

  test("selects the new duplicate", () => {
    let s = makeState();
    s = duplicateNode(s, ["children", 0]);
    expect(s.selection).toEqual(["children", 1]);
  });

  test("does nothing for root", () => {
    const s = makeState();
    expect(duplicateNode(s, [])).toBe(s);
  });

  test("does nothing for null path", () => {
    const s = makeState();
    expect(duplicateNode(s, /** @type {any} */ (null))).toBe(s);
  });

  test("creates a deep clone", () => {
    let s = makeState();
    s = duplicateNode(s, ["children", 1]); // section with nested children
    const original = s.document.children[1];
    const duplicate = s.document.children[2];
    expect(duplicate).toEqual(original);
    expect(duplicate).not.toBe(original);
    expect(duplicate.children).not.toBe(original.children);
  });
});

describe("moveNode", () => {
  test("moves node to different parent", () => {
    let s = makeState();
    // Move h1 (children[0]) into section (children[1]) at index 0
    s = moveNode(s, ["children", 0], ["children", 0], 0);
    // After removal of children[0], old section is now children[0]
    expect(s.document.children.length).toBe(1);
    expect(s.document.children[0].tagName).toBe("section");
    expect(s.document.children[0].children[0].tagName).toBe("h1");
  });

  test("moves within same parent — forward", () => {
    let s = makeState();
    // Move first child to end
    s = moveNode(s, ["children", 0], [], 2);
    expect(s.document.children[0].tagName).toBe("section");
    expect(s.document.children[1].tagName).toBe("h1");
  });
});

// ─── Property / style / attribute mutations ──────────────────────────────────

describe("updateProperty", () => {
  test("sets a property", () => {
    let s = makeState();
    s = updateProperty(s, ["children", 0], "textContent", "Updated");
    expect(s.document.children[0].textContent).toBe("Updated");
  });

  test("deletes property when value is empty string", () => {
    let s = makeState();
    s = updateProperty(s, ["children", 0], "textContent", "");
    expect(s.document.children[0].textContent).toBeUndefined();
  });

  test("deletes property when value is undefined", () => {
    let s = makeState();
    s = updateProperty(s, ["children", 0], "textContent", undefined);
    expect(s.document.children[0].textContent).toBeUndefined();
  });

  test("deletes property when value is null", () => {
    let s = makeState();
    s = updateProperty(s, ["children", 0], "textContent", null);
    expect(s.document.children[0].textContent).toBeUndefined();
  });
});

describe("updateStyle", () => {
  test("creates style object and sets property", () => {
    let s = makeState();
    s = updateStyle(s, [], "color", "red");
    expect(s.document.style).toEqual({ color: "red" });
  });

  test("removes style property on empty string", () => {
    let s = makeState();
    s = updateStyle(s, [], "color", "red");
    s = updateStyle(s, [], "color", "");
    expect(s.document.style).toBeUndefined(); // cleaned up empty object
  });

  test("removes style property on undefined", () => {
    let s = makeState();
    s = updateStyle(s, [], "color", "red");
    s = updateStyle(s, [], "color", undefined);
    expect(s.document.style).toBeUndefined();
  });

  test("preserves other style properties", () => {
    let s = makeState();
    s = updateStyle(s, [], "color", "red");
    s = updateStyle(s, [], "display", "flex");
    s = updateStyle(s, [], "color", "");
    expect(s.document.style).toEqual({ display: "flex" });
  });
});

describe("updateAttribute", () => {
  test("creates attributes object and sets attribute", () => {
    let s = makeState();
    s = updateAttribute(s, [], "id", "main");
    expect(s.document.attributes).toEqual({ id: "main" });
  });

  test("removes attribute on empty string", () => {
    let s = makeState();
    s = updateAttribute(s, [], "id", "main");
    s = updateAttribute(s, [], "id", "");
    expect(s.document.attributes).toBeUndefined();
  });

  test("preserves other attributes", () => {
    let s = makeState();
    s = updateAttribute(s, [], "id", "main");
    s = updateAttribute(s, [], "class", "container");
    s = updateAttribute(s, [], "id", "");
    expect(s.document.attributes).toEqual({ class: "container" });
  });
});

// ─── Def management ──────────────────────────────────────────────────────────

describe("addDef", () => {
  test("creates state object and adds def", () => {
    let s = makeState();
    s = addDef(s, "counter", { $prototype: "Number", value: 0 });
    expect(s.document.state.counter).toEqual({
      $prototype: "Number",
      value: 0,
    });
  });

  test("adds to existing state", () => {
    let s = createState({ tagName: "div", state: { x: { value: 1 } } });
    s = addDef(s, "y", { value: 2 });
    expect(s.document.state.x).toBeDefined();
    expect(s.document.state.y).toEqual({ value: 2 });
  });
});

describe("removeDef", () => {
  test("removes a def", () => {
    let s = createState({ tagName: "div", state: { x: { value: 1 } } });
    s = removeDef(s, "x");
    expect(s.document.state).toBeUndefined(); // cleaned up empty object
  });

  test("preserves other defs", () => {
    let s = createState({
      tagName: "div",
      state: { x: { value: 1 }, y: { value: 2 } },
    });
    s = removeDef(s, "x");
    expect(s.document.state.y).toEqual({ value: 2 });
    expect(s.document.state.x).toBeUndefined();
  });
});

describe("updateDef", () => {
  test("updates existing def fields", () => {
    let s = createState({
      tagName: "div",
      state: { x: { value: 1, label: "X" } },
    });
    s = updateDef(s, "x", { value: 42 });
    expect(s.document.state.x.value).toBe(42);
    expect(s.document.state.x.label).toBe("X"); // preserved
  });

  test("removes fields set to undefined", () => {
    let s = createState({
      tagName: "div",
      state: { x: { value: 1, label: "X" } },
    });
    s = updateDef(s, "x", { label: undefined });
    expect(s.document.state.x.label).toBeUndefined();
  });

  test("creates def if it does not exist", () => {
    let s = makeState();
    s = updateDef(s, "newDef", { value: "hello" });
    expect(s.document.state.newDef).toEqual({ value: "hello" });
  });
});

describe("renameDef", () => {
  test("renames a def key", () => {
    let s = createState({
      tagName: "div",
      state: { oldName: { value: 1 } },
    });
    s = renameDef(s, "oldName", "newName");
    expect(s.document.state.newName).toEqual({ value: 1 });
    expect(s.document.state.oldName).toBeUndefined();
  });

  test("does nothing if old name does not exist", () => {
    let s = createState({
      tagName: "div",
      state: { x: { value: 1 } },
    });
    s = renameDef(s, "nonexistent", "newName");
    expect(s.document.state.newName).toBeUndefined();
  });
});

// ─── Media / nested style mutations ──────────────────────────────────────────

describe("updateMediaStyle", () => {
  test("creates media block and sets property", () => {
    let s = makeState();
    s = updateMediaStyle(s, [], "--md", "display", "block");
    expect(s.document.style["@--md"]).toEqual({ display: "block" });
  });

  test("removes media block when last property cleared", () => {
    let s = makeState();
    s = updateMediaStyle(s, [], "--md", "display", "block");
    s = updateMediaStyle(s, [], "--md", "display", "");
    expect(s.document.style).toBeUndefined();
  });
});

describe("updateNestedStyle", () => {
  test("creates nested selector block", () => {
    let s = makeState();
    s = updateNestedStyle(s, [], ":hover", "color", "blue");
    expect(s.document.style[":hover"]).toEqual({ color: "blue" });
  });

  test("cleans up empty nested block", () => {
    let s = makeState();
    s = updateNestedStyle(s, [], ":hover", "color", "blue");
    s = updateNestedStyle(s, [], ":hover", "color", "");
    expect(s.document.style).toBeUndefined();
  });
});

describe("updateMediaNestedStyle", () => {
  test("creates media > nested selector block", () => {
    let s = makeState();
    s = updateMediaNestedStyle(s, [], "--md", ":hover", "color", "blue");
    expect(s.document.style["@--md"][":hover"]).toEqual({ color: "blue" });
  });

  test("cleans up empty media > nested block", () => {
    let s = makeState();
    s = updateMediaNestedStyle(s, [], "--md", ":hover", "color", "blue");
    s = updateMediaNestedStyle(s, [], "--md", ":hover", "color", "");
    expect(s.document.style).toBeUndefined();
  });
});

describe("updateMedia", () => {
  test("adds a media entry", () => {
    let s = makeState();
    s = updateMedia(s, "--md", "(min-width: 768px)");
    expect(s.document.$media["--md"]).toBe("(min-width: 768px)");
  });

  test("removes media entry on empty string", () => {
    let s = makeState();
    s = updateMedia(s, "--md", "(min-width: 768px)");
    s = updateMedia(s, "--md", "");
    expect(s.document.$media).toBeUndefined();
  });
});

// ─── Document stack ──────────────────────────────────────────────────────────

describe("pushDocument / popDocument", () => {
  test("push saves current document and opens new one", () => {
    let s = makeState();
    const newDoc = { tagName: "article" };
    s = pushDocument(s, newDoc, "components/card.json");
    expect(s.document).toBe(newDoc);
    expect(s.documentPath).toBe("components/card.json");
    expect(s.documentStack.length).toBe(1);
    expect(s.selection).toBeNull();
  });

  test("pop restores previous document", () => {
    let s = makeState();
    s = selectNode(s, ["children", 0]);
    const origDoc = s.document;
    s = pushDocument(s, { tagName: "article" }, "card.json");
    s = popDocument(s);
    expect(s.document).toEqual(origDoc);
    expect(s.documentStack.length).toBe(0);
  });

  test("pop returns same state if stack is empty", () => {
    const s = makeState();
    expect(popDocument(s)).toBe(s);
  });

  test("push resets ui tabs", () => {
    let s = makeState();
    s = { ...s, ui: { ...s.ui, leftTab: "files" } };
    s = pushDocument(s, { tagName: "nav" }, "nav.json");
    expect(s.ui.leftTab).toBe("layers");
    expect(s.ui.activeMedia).toBeNull();
  });
});

// ─── $props mutations ────────────────────────────────────────────────────────

describe("updateProp", () => {
  test("creates $props and sets a prop", () => {
    let s = createState({ tagName: "my-card" });
    s = updateProp(s, [], "title", "Hello");
    expect(s.document.$props).toEqual({ title: "Hello" });
  });

  test("removes prop on empty string", () => {
    let s = createState({ tagName: "my-card", $props: { title: "Hello" } });
    s = updateProp(s, [], "title", "");
    expect(s.document.$props).toBeUndefined();
  });

  test("preserves other props", () => {
    let s = createState({
      tagName: "my-card",
      $props: { title: "Hello", subtitle: "World" },
    });
    s = updateProp(s, [], "title", "");
    expect(s.document.$props).toEqual({ subtitle: "World" });
  });
});

// ─── $switch case mutations ──────────────────────────────────────────────────

describe("addSwitchCase", () => {
  test("creates cases object and adds case", () => {
    let s = createState({ tagName: "div", $switch: "${route}" });
    s = addSwitchCase(s, [], "home", { tagName: "main" });
    expect(s.document.cases.home).toEqual({ tagName: "main" });
  });

  test("uses default case def when none provided", () => {
    let s = createState({ tagName: "div", $switch: "${route}" });
    s = addSwitchCase(s, [], "about");
    expect(s.document.cases.about.tagName).toBe("div");
    expect(s.document.cases.about.textContent).toBe("about");
  });
});

describe("removeSwitchCase", () => {
  test("removes a case", () => {
    let s = createState({
      tagName: "div",
      $switch: "${route}",
      cases: { home: { tagName: "main" }, about: { tagName: "article" } },
    });
    s = removeSwitchCase(s, [], "home");
    expect(s.document.cases.home).toBeUndefined();
    expect(s.document.cases.about).toBeDefined();
  });
});

describe("renameSwitchCase", () => {
  test("renames a case key", () => {
    let s = createState({
      tagName: "div",
      $switch: "${route}",
      cases: { home: { tagName: "main" } },
    });
    s = renameSwitchCase(s, [], "home", "landing");
    expect(s.document.cases.landing).toEqual({ tagName: "main" });
    expect(s.document.cases.home).toBeUndefined();
  });

  test("does nothing if case does not exist", () => {
    let s = createState({
      tagName: "div",
      $switch: "${route}",
      cases: { home: { tagName: "main" } },
    });
    s = renameSwitchCase(s, [], "nonexistent", "new");
    expect(s.document.cases.new).toBeUndefined();
    expect(s.document.cases.home).toBeDefined();
  });
});
