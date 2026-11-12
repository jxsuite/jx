/**
 * A state value set for the canvas (`canvas/state-values.ts`, studio.md §4.5): which entries can be
 * set, how a set value reaches the render document without reaching the tab's own, and how the Data
 * panel's control reads and writes one.
 */
import { describe, expect, test } from "bun:test";
import {
  documentStateValue,
  isPlainStateEntry,
  parseStateValue,
  stateValueControl,
  stateValueText,
  withStateValues,
} from "../src/canvas/state-values";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** A document's state with no entries: what reading a key the document lacks answers from. */
const NO_ENTRIES: NonNullable<JxMutableNode["state"]> = {};

describe("isPlainStateEntry", () => {
  test("is true of a literal and of a declared value", () => {
    for (const def of [
      "text",
      0,
      false,
      null,
      [1, 2],
      { a: 1 },
      { default: 1 },
      { type: "string" },
    ]) {
      expect(isPlainStateEntry(def)).toBe(true);
    }
  });

  test("is false of anything whose value something else decides, and of no entry at all", () => {
    expect(isPlainStateEntry("${state.a + 1}")).toBe(false);
    expect(isPlainStateEntry({ $prototype: "Request", url: "/x" })).toBe(false);
    expect(isPlainStateEntry({ $expression: { operator: "add", value: [1, 2] } })).toBe(false);
    expect(isPlainStateEntry({ $compute: "a + 1" })).toBe(false);
    expect(isPlainStateEntry({ $export: "sum", $src: "./s.js", timing: "server" })).toBe(false);
    expect(isPlainStateEntry({ $handler: true })).toBe(false);
    expect(isPlainStateEntry({ $src: "./x.js" })).toBe(false);
    expect(isPlainStateEntry(NO_ENTRIES.missing)).toBe(false);
  });
});

describe("documentStateValue", () => {
  test("is the literal, the declared default, or nothing for a bare declaration", () => {
    expect(documentStateValue("text")).toBe("text");
    expect(documentStateValue(3)).toBe(3);
    expect(documentStateValue({ default: [1], type: "array" })).toEqual([1]);
    expect(documentStateValue({ type: "string" })).toBeUndefined();
    expect(documentStateValue({ a: 1 })).toEqual({ a: 1 });
    expect(documentStateValue(NO_ENTRIES.missing)).toBeUndefined();
  });
});

describe("withStateValues", () => {
  const source: NonNullable<JxMutableNode["state"]> = {
    count: 1,
    double: "${state.count * 2}",
    mode: { default: "list", enum: ["list", "grid"], type: "string" },
    name: { type: "string" },
    open: false,
  };
  const doc = (): JxMutableNode => ({ state: { ...source, injected: "kept" }, tagName: "div" });

  test("puts each set value in its entry's place, as the entry's default", () => {
    const renderDoc = doc();
    const out = withStateValues(renderDoc, source, {
      count: 5,
      mode: "grid",
      name: "Ada",
      open: true,
    });
    expect(out.state).toEqual({
      count: { default: 5 },
      double: "${state.count * 2}",
      injected: "kept",
      // A declared entry keeps what it declares.
      mode: { default: "grid", enum: ["list", "grid"], type: "string" },
      name: { default: "Ada", type: "string" },
      open: { default: true },
    });
  });

  test("is a rebuild: the render document it was given, and the tab's state, are untouched", () => {
    const renderDoc = doc();
    const before = structuredClone(renderDoc);
    const out = withStateValues(renderDoc, source, { open: true });
    expect(out).not.toBe(renderDoc);
    expect(renderDoc).toEqual(before);
    expect(source.open).toBe(false);
  });

  test("a value that would be read as something else goes in as a default, never bare", () => {
    // Bare, the first would become a template and the second a request.
    const out = withStateValues(doc(), source, {
      count: "${state.open}",
      open: { $prototype: "Request", url: "/x" },
    });
    expect(out.state?.count).toEqual({ default: "${state.open}" });
    expect(out.state?.open).toEqual({ default: { $prototype: "Request", url: "/x" } });
  });

  test("applies nothing for a key that is not a plain entry of the document", () => {
    const renderDoc = doc();
    expect(withStateValues(renderDoc, source, {})).toBe(renderDoc);
    expect(withStateValues(renderDoc, source, { double: 4, gone: 1, injected: "x" })).toBe(
      renderDoc,
    );
    expect(withStateValues(renderDoc, undefined, { count: 2 })).toBe(renderDoc);
    // A key the record holds as undefined is no value.
    expect(withStateValues(renderDoc, source, { count: undefined }).state?.count).toBe(1);
  });
});

describe("the Data panel's control", () => {
  test("offers true and false for a boolean, the options of an entry that declares them, or text", () => {
    expect(stateValueControl(false)).toEqual({ choices: ["true", "false"], documentText: "false" });
    expect(stateValueControl({ type: "boolean" })).toEqual({
      choices: ["true", "false"],
      documentText: "",
    });
    expect(stateValueControl({ default: 2, enum: [1, 2, 3], type: "integer" })).toEqual({
      choices: ["1", "2", "3"],
      documentText: "2",
    });
    expect(stateValueControl("hello")).toEqual({ choices: null, documentText: "hello" });
    expect(stateValueControl({ default: [1], enum: [] })).toEqual({
      choices: null,
      documentText: "[1]",
    });
  });

  test("shows a string as itself and anything else as JSON", () => {
    expect(stateValueText("a b")).toBe("a b");
    expect(stateValueText(3)).toBe("3");
    expect(stateValueText({ a: [1] })).toBe('{"a":[1]}');
    expect(stateValueText(null)).toBe("null");
    expect(stateValueText(documentStateValue(NO_ENTRIES.missing))).toBe("");
  });

  test("reads typed text as the entry's own kind of value", () => {
    expect(parseStateValue("true", false)).toBe(true);
    expect(parseStateValue("false", { type: "boolean" })).toBe(false);
    expect(parseStateValue("4.5", 1)).toBe(4.5);
    expect(parseStateValue("4.5", { type: "integer" })).toBe(4);
    expect(parseStateValue("[1,2]", [])).toEqual([1, 2]);
    expect(parseStateValue('{"a":1}', { type: "object" })).toEqual({ a: 1 });
    // Declared a list: the declared kind is what the text is read as, not what the default holds.
    expect(parseStateValue("[1,2]", { default: [], type: "array" })).toEqual([1, 2]);
    expect(parseStateValue("[1,2]", { type: "array" })).toEqual([1, 2]);
    expect(parseStateValue("12", "text")).toBe("12");
    expect(parseStateValue("12", null)).toBe("12");
    expect(parseStateValue("12", { type: "string" })).toBe("12");
  });

  test("keeps text that does not parse as its kind, so nothing typed is dropped", () => {
    expect(parseStateValue("many", 1)).toBe("many");
    expect(parseStateValue(" ", { type: "number" })).toBe(" ");
    expect(parseStateValue("[1,", [])).toBe("[1,");
  });
});
