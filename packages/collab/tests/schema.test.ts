import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import type { YStructureValue } from "../src/schema.ts";
import {
  applyTextEdit,
  frontmatterMap,
  mergeYChildren,
  mergeYNode,
  mergeYObject,
  metaMap,
  resolveYPath,
  seedStructure,
  sourceText,
  structureMap,
  toYFunction,
  toYNode,
  toYObject,
  toYState,
  toYNodeValue,
  updateSourceText,
  writeNodeKey,
  yDocToJson,
  yValueToJson,
} from "../src/schema.ts";

const SAMPLE: JxMutableNode = {
  children: [
    { tagName: "h1", textContent: "Title" },
    "loose text",
    {
      children: [{ tagName: "span", textContent: "deep" }],
      style: { color: "red", "@md": { color: "blue" } },
      tagName: "section",
    },
  ],
  state: { count: { default: 0 } },
  tagName: "div",
};

/** Fail the test unless `value` is a `ctor` instance, narrowing it for the assertions that follow. */
function assertInstance<T>(
  value: unknown,
  ctor: abstract new (...args: never[]) => T,
): asserts value is T {
  if (!(value instanceof ctor)) {
    throw new TypeError(`expected a ${ctor.name} instance`);
  }
}

function seeded(doc: JxMutableNode = SAMPLE): Y.Doc {
  const ydoc = new Y.Doc();
  seedStructure(ydoc, doc, { frontmatter: { title: "Hello" }, sourceFormat: "markdown" });
  return ydoc;
}

describe("seedStructure / yDocToJson", () => {
  test("roundtrips a representative document identically", () => {
    const ydoc = seeded();
    expect(yDocToJson(ydoc)).toEqual(SAMPLE);
  });

  test("roundtrips an empty document", () => {
    const ydoc = seeded({});
    expect(yDocToJson(ydoc)).toEqual({});
  });

  test("string children and nested arrays survive", () => {
    const doc: JxMutableNode = { children: ["a", "b", { children: ["c"], tagName: "p" }] };
    expect(yDocToJson(seeded(doc))).toEqual(doc);
  });

  test("records meta and frontmatter", () => {
    const ydoc = seeded();
    expect(metaMap(ydoc).get("structureSeeded")).toBe(true);
    expect(metaMap(ydoc).get("canonical")).toBe("structure");
    expect(metaMap(ydoc).get("sourceFormat")).toBe("markdown");
    expect(frontmatterMap(ydoc).get("title")).toBe("Hello");
  });

  test("second seed is a no-op (another seeder already won)", () => {
    const ydoc = seeded();
    const won = seedStructure(ydoc, { tagName: "other" });
    expect(won).toBe(false);
    expect(yDocToJson(ydoc).tagName).toBe("div");
  });

  test("undefined-valued keys are dropped, not stored", () => {
    const doc: JxMutableNode = { tagName: "div" };
    /* An in-memory edit can leave a declared key present but undefined, which the
       exactOptionalPropertyTypes-checked literal cannot spell; an own enumerable property is what
       Object.entries (and so the seeder) sees either way. */
    Object.defineProperty(doc, "textContent", { enumerable: true, value: undefined });
    const ydoc = seeded(doc);
    expect("textContent" in yDocToJson(ydoc)).toBe(false);
  });

  test("concurrent seeders converge without duplicating children", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // Both seed the same parsed document before hearing from each other.
    seedStructure(a, SAMPLE);
    seedStructure(b, SAMPLE);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(yDocToJson(a)).toEqual(SAMPLE);
    expect(yDocToJson(b)).toEqual(yDocToJson(a));
    const { children } = yDocToJson(a);
    expect(children).toHaveLength(3);
  });
});

describe("resolveYPath", () => {
  test("resolves nodes, children arrays, string children, and leaves", () => {
    const ydoc = seeded();
    expect(resolveYPath(ydoc, [])).toBe(structureMap(ydoc));
    const h1 = resolveYPath(ydoc, ["children", 0]);
    assertInstance(h1, Y.Map);
    // Text is a Y.Text, not an opaque string — that is what makes concurrent typing merge per
    // Character instead of whole-value last-writer-wins.
    const title = h1.get("textContent");
    assertInstance(title, Y.Text);
    expect(title.toString()).toBe("Title");
    const loose = resolveYPath(ydoc, ["children", 1]);
    assertInstance(loose, Y.Text);
    expect(loose.toString()).toBe("loose text");
    const deep = resolveYPath(ydoc, ["children", 2, "children", 0, "textContent"]);
    assertInstance(deep, Y.Text);
    expect(deep.toString()).toBe("deep");
    expect(resolveYPath(ydoc, ["children"])).toBeInstanceOf(Y.Array);
  });

  test("missing segments resolve to undefined", () => {
    const ydoc = seeded();
    expect(resolveYPath(ydoc, ["children", 9])).toBeUndefined();
    expect(resolveYPath(ydoc, ["children", -1])).toBeUndefined();
    expect(resolveYPath(ydoc, ["nope", 0])).toBeUndefined();
    expect(resolveYPath(ydoc, ["children", 1, "children", 0])).toBeUndefined();
  });
});

describe("toYNode / yValueToJson", () => {
  test("rejects non-object nodes", () => {
    expect(() => toYNode("just a string")).toThrow(TypeError);
    expect(() => toYNode([1, 2])).toThrow(TypeError);
  });

  test("plain leaves pass through yValueToJson", () => {
    expect(yValueToJson("x")).toBe("x");
    expect(yValueToJson(3)).toBe(3);
    expect(yValueToJson(null)).toBeNull();
  });
});

describe("sourceText", () => {
  test("is an initially-empty Y.Text the provider seeds", () => {
    const ydoc = new Y.Doc();
    expect(sourceText(ydoc).toString()).toBe("");
    sourceText(ydoc).insert(0, "# Hello");
    expect(sourceText(ydoc).toString()).toBe("# Hello");
  });
});

describe("applyTextEdit", () => {
  /* Its only caller, updateSourceText, short-circuits its own identical-content case before ever
     calling applyTextEdit, so that guard never exercises this one — applyTextEdit is exported
     and called directly elsewhere too (setNodeKey's textContent path), so its own no-op return
     needs a direct call to cover. */
  test("no-ops on already-equal content", () => {
    const ydoc = new Y.Doc();
    const text = sourceText(ydoc);
    text.insert(0, "same");
    expect(applyTextEdit(text, "same")).toBe(false);
    expect(text.toString()).toBe("same");
  });
});

describe("updateSourceText", () => {
  test("applies a minimal middle edit, not a whole replace", () => {
    const ydoc = new Y.Doc();
    updateSourceText(ydoc, "# Title\n\nHello world\n");
    let deleted = 0;
    let inserted = "";
    sourceText(ydoc).observe((event) => {
      for (const delta of event.changes.delta) {
        if (delta.delete !== undefined) {
          deleted += delta.delete;
        }
        if (isString(delta.insert)) {
          inserted += delta.insert;
        }
      }
    });
    const changed = updateSourceText(ydoc, "# Title\n\nGoodbye world\n", "test-origin");
    expect(changed).toBe(true);
    expect(sourceText(ydoc).toString()).toBe("# Title\n\nGoodbye world\n");
    expect(deleted).toBe("Hello".length);
    expect(inserted).toBe("Goodbye");
  });

  test("no-ops on identical content", () => {
    const ydoc = new Y.Doc();
    updateSourceText(ydoc, "same");
    expect(updateSourceText(ydoc, "same")).toBe(false);
  });

  test("handles pure append, pure truncation, and empty transitions", () => {
    const ydoc = new Y.Doc();
    updateSourceText(ydoc, "abc");
    updateSourceText(ydoc, "abcdef");
    expect(sourceText(ydoc).toString()).toBe("abcdef");
    updateSourceText(ydoc, "abc");
    expect(sourceText(ydoc).toString()).toBe("abc");
    updateSourceText(ydoc, "");
    expect(sourceText(ydoc).toString()).toBe("");
    updateSourceText(ydoc, "fresh");
    expect(sourceText(ydoc).toString()).toBe("fresh");
  });
});

describe("the shared write rule", () => {
  test("seedStructure stores root keys by the same rule as every node", () => {
    const doc = new Y.Doc();
    seedStructure(doc, {
      children: ["a"],
      state: { n: 1 },
      style: { color: "red" },
      tagName: "p",
      textContent: "hi",
    });
    const root = structureMap(doc);
    expect(root.get("textContent")).toBeInstanceOf(Y.Text);
    expect(root.get("style")).toBeInstanceOf(Y.Map);
    expect(root.get("children")).toBeInstanceOf(Y.Array);
    expect(root.get("state")).toBeInstanceOf(Y.Map);
    expect(yDocToJson(doc)["state"]).toEqual({ n: 1 });
  });

  test("mergeYChildren removes, inserts, edits in place and replaces a legacy item", () => {
    const doc = new Y.Doc();
    const array = new Y.Array<YStructureValue>();
    doc.getMap<YStructureValue>("holder").set("children", array);
    array.insert(0, [
      toYNode({ tagName: "a", textContent: "one" }),
      new Y.Text("text"),
      "legacy",
      toYNode({ tagName: "gone" }),
    ]);
    const node = array.get(0);
    const text = array.get(1);
    mergeYChildren(array, [
      { tagName: "a", textContent: "one!" },
      "text!",
      "legacy!",
      { tagName: "new" },
    ]);
    expect(yValueToJson(array)).toEqual([
      { tagName: "a", textContent: "one!" },
      "text!",
      "legacy!",
      { tagName: "new" },
    ]);
    expect(array.get(0)).toBe(node);
    expect(array.get(1)).toBe(text);
    expect(array.get(2)).toBeInstanceOf(Y.Text);
  });

  test("writeNodeKey skips a plain value equal to the stored one", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<YStructureValue>("structure");
    root.set("tagName", "p");
    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });
    writeNodeKey(root, "tagName", "p");
    expect(updates).toBe(0);
  });

  test("writeNodeKey and mergeYObject write a new null-valued key", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<YStructureValue>("structure");
    writeNodeKey(root, "meta", null);
    expect(root.has("meta")).toBe(true);
    const style = new Y.Map<YStructureValue>();
    root.set("style", style);
    mergeYObject(style, { color: null });
    expect(style.has("color")).toBe(true);
  });

  test("mergeYNode deletes the keys the value no longer has", () => {
    const node = new Y.Doc().getMap<YStructureValue>("structure");
    mergeYNode(node, { a: 1, b: 2, tagName: "p" });
    mergeYNode(node, { tagName: "p" });
    expect(yValueToJson(node)).toEqual({ tagName: "p" });
  });

  test("an ordered style, state and function entry read back in their written order", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<YStructureValue>("structure");
    const value = {
      onclick: { $prototype: "Function", body: "a()", name: "x" },
      state: { z: { body: "1", name: "z" }, a: 1 },
      style: { padding: "1px", ":hover": { b: "1", a: "2" }, color: "red" },
    };
    for (const [key, entry] of Object.entries(value)) {
      root.set(key, toYNodeValue(key, entry));
    }
    mergeYNode(root, {
      ...value,
      state: { a: 1, z: { name: "z", body: "2" } },
      style: { color: "red" },
    });
    const json = yValueToJson(root);
    expect(keysOf(memberOf(json, "state"))).toEqual(["a", "z"]);
    expect(memberOf(json, "style")).toEqual({ color: "red" });
    // A map written before the companion array existed still reads, in its own order.
    const legacy = new Y.Map<YStructureValue>();
    legacy.set("b", 1);
    legacy.set("a", 2);
    root.set("attributes", legacy);
    expect(keysAt(root, "attributes")).toEqual(["b", "a"]);
    // A function entry changing type, and a state entry becoming a function and back, replace.
    mergeYNode(root, { onclick: "text", state: { a: { body: "x" } } });
    expect(memberOf(yValueToJson(root), "onclick")).toBe("text");
    expect(memberOf(yValueToJson(root), "state")).toEqual({ a: { body: "x" } });
    mergeYNode(root, { state: { a: 2 } });
    expect(memberOf(yValueToJson(root), "state")).toEqual({ a: 2 });
    // A stale key left in the companion array, and a duplicate, are ignored on read.
    const style = new Y.Map<YStructureValue>();
    const order = new Y.Array<YStructureValue>();
    order.insert(0, ["x", "x", "gone", "y"]);
    style.set("y", 1);
    style.set("x", 2);
    style.set("\0order", order);
    root.set("style", style);
    expect(keysAt(root, "style")).toEqual(["x", "y"]);
    mergeYNode(root, { style: { y: 1, x: 2, w: 3 } });
    expect(keysAt(root, "style")).toEqual(["y", "x", "w"]);
  });

  test("writers reject what is not a node or a child, and skip cleared keys", () => {
    const doc = new Y.Doc();
    const array = new Y.Array<YStructureValue>();
    doc.getMap<YStructureValue>("holder").set("children", array);
    expect(() => mergeYChildren(array, [1])).toThrow(TypeError);
    array.insert(0, [1]);
    expect(() => mergeYChildren(array, [])).toThrow(TypeError);
    const root = doc.getMap<YStructureValue>("structure");
    mergeYNode(root, {
      onclick: { $prototype: "Function", body: "a", gone: undefined },
      state: { f: { body: "a", gone: undefined }, g: undefined },
      style: { a: "1", b: undefined, nested: { c: undefined, d: "1" } },
      tagName: "p",
    });
    mergeYNode(root, {
      onclick: { $prototype: "Function", body: "b" },
      state: { f: { body: "b", extra: 1 } },
      style: { a: "1", nested: { d: "2" } },
      tagName: "p",
    });
    expect(yValueToJson(root)).toEqual({
      onclick: { $prototype: "Function", body: "b" },
      state: { f: { body: "b", extra: 1 } },
      style: { a: "1", nested: { d: "2" } },
      tagName: "p",
    });
    // A function entry whose body stopped being a string is stored plain, then text again.
    mergeYNode(root, { onclick: { $prototype: "Function", body: "c", extra: 1 } });
    const fn = root.get("onclick");
    expect(fn).toBeInstanceOf(Y.Map);
    mergeYNode(root, { onclick: { $prototype: "Function", body: "d", extra: 1 } });
    expect(root.get("onclick")).toBe(fn);
  });

  test("stored shapes older writers left are healed and every cleared key is dropped", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<YStructureValue>("structure");
    // A style map with no companion array, a state map and a handler holding plain values.
    const style = new Y.Map<YStructureValue>();
    style.set("a", "1");
    root.set("style", style);
    const fn = new Y.Map<YStructureValue>();
    fn.set("body", "plain body");
    fn.set("keep", 1);
    fn.set("drop", 1);
    root.set("onclick", fn);
    const state = new Y.Map<YStructureValue>();
    state.set("keep", 1);
    state.set("drop", 1);
    root.set("state", state);
    root.set("tagName", "p");
    root.set("dropped", "x");
    mergeYNode(root, {
      dropped: undefined,
      onclick: { $prototype: "Function", body: "text now", keep: 1, other: undefined },
      state: { keep: 2, drop: undefined, skip: undefined, g: { body: "g" } },
      style: { a: "1", z: "2" },
      tagName: "p",
    });
    expect(yValueToJson(root)).toEqual({
      onclick: { $prototype: "Function", body: "text now", keep: 1 },
      state: { keep: 2, g: { body: "g" } },
      style: { a: "1", z: "2" },
      tagName: "p",
    });
    const handler = root.get("onclick");
    expect(handler).toBeInstanceOf(Y.Map);
    expect(handler instanceof Y.Map ? handler.get("body") : null).toBeInstanceOf(Y.Text);
    // The state's own keys keep the written order, with a shared prefix left alone.
    mergeYNode(root, { state: { keep: 2, h: 1, g: { body: "g" } } });
    expect(keysAt(root, "state")).toEqual(["keep", "h", "g"]);
    // Seeding drops cleared keys too.
    const holder = new Y.Doc().getMap<YStructureValue>("holder");
    holder.set("style", toYObject({ a: undefined, b: { c: undefined, d: 1 } }, true));
    holder.set("state", toYState({ a: undefined, b: 1 }));
    holder.set("onclick", toYFunction({ body: "x", y: undefined }));
    const read = yValueToJson(holder);
    expect(keysOf(memberOf(read, "style"))).toEqual(["b"]);
    expect(keysOf(memberOf(read, "state"))).toEqual(["b"]);
    expect(keysOf(memberOf(read, "onclick"))).toEqual(["body"]);
  });
});

/** The own keys of an object value, in order. */
function keysOf(value: JxDocumentValue | undefined): string[] {
  if (!isJsonObject(value)) {
    throw new TypeError("expected an object value");
  }
  return Object.keys(value);
}

/** One named member of an object value. */
function memberOf(value: JxDocumentValue | undefined, key: string): JxDocumentValue | undefined {
  if (!isJsonObject(value)) {
    throw new TypeError("expected an object value");
  }
  return value[key];
}

/** The own keys of one node key's object value, in stored order. */
function keysAt(root: Y.Map<YStructureValue>, key: string): string[] {
  return keysOf(memberOf(yValueToJson(root), key));
}
