import { describe, expect, test } from "bun:test";
import { parseCemType, propChoices } from "../src/utils/prop-choices";

describe("parseCemType", () => {
  test("names the scalar kinds and falls back to text", () => {
    expect(parseCemType(null)).toEqual({ kind: "text" });
    expect(parseCemType("boolean | undefined")).toEqual({ kind: "boolean" });
    expect(parseCemType("number")).toEqual({ kind: "number" });
    expect(parseCemType("string")).toEqual({ kind: "text" });
    expect(parseCemType("'only'")).toEqual({ kind: "text" });
  });

  test("a union of literals is a closed set of the values it names", () => {
    expect(parseCemType("'sm' | 'lg' | undefined")).toEqual({
      kind: "combobox",
      options: ["sm", "lg"],
    });
    expect(parseCemType('"a b" | "c"')).toEqual({ kind: "combobox", options: ["a b", "c"] });
    expect(parseCemType("1 | 2.5 | -3")).toEqual({ kind: "combobox", options: [1, 2.5, -3] });
    expect(parseCemType("true | 'auto'")).toEqual({ kind: "combobox", options: [true, "auto"] });
    expect(parseCemType("'a' | string")).toEqual({ kind: "text" });
  });
});

describe("propChoices", () => {
  test("a declared enum wins over the type text", () => {
    expect(propChoices({ enum: ["md", "lg"], type: "'x' | 'y'" })).toEqual(["md", "lg"]);
  });

  test("an enum a select cannot offer is no choice list", () => {
    expect(propChoices({ enum: [], type: "string" })).toBeNull();
    expect(propChoices({ enum: [[1]], type: "string" })).toBeNull();
  });

  test("without an enum, a manifest's literal union is the list", () => {
    expect(propChoices({ type: "'plain' | 'fancy'" })).toEqual(["plain", "fancy"]);
    expect(propChoices({ type: "string" })).toBeNull();
    expect(propChoices({ type: 7 })).toBeNull();
    expect(propChoices({})).toBeNull();
  });
});
