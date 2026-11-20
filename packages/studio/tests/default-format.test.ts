/**
 * Tests for src/format/default-format.ts and the section helpers over it: an unset project writes
 * Jx Notation, `defaults.format` chooses, and a value that is neither is ignored.
 */
import { resetStudioState } from "./harness";
import { describe, expect, test } from "bun:test";
import { NATIVE_FORMATS, defaultNativeExt, nativeExtOf } from "../src/format/default-format";
import { convertOffer, summaryOf } from "../src/settings/format-section";
import { defaultExtensionIn } from "../src/files/files";

describe("defaultNativeExt", () => {
  test("is Jx Notation when the project says nothing", () => {
    resetStudioState({ projectConfig: {} });
    expect(defaultNativeExt()).toBe(".jxn");
  });

  test("follows defaults.format", () => {
    resetStudioState({ projectConfig: { defaults: { format: "json" } } });
    expect(defaultNativeExt()).toBe(".json");
    expect(defaultExtensionIn("pages")).toBe(".json");
    resetStudioState({ projectConfig: { defaults: { format: "jxn" } } });
    expect(defaultExtensionIn("components/x")).toBe(".jxn");
  });

  test("ignores a hand-written value that is not a notation", () => {
    /* SAFETY: a hand-edited file can hold any string; the type only describes what Studio writes. */
    resetStudioState({ projectConfig: { defaults: { format: "yaml" as never } } });
    expect(defaultNativeExt()).toBe(".jxn");
    expect(nativeExtOf("yaml")).toBeNull();
    expect(NATIVE_FORMATS.map((row) => row.value)).toEqual(["jxn", "json"]);
  });
});

describe("the section's sentences", () => {
  test("summaryOf", () => {
    expect(summaryOf(null)).toContain("Counting");
    expect(summaryOf({ json: 0, jxn: 0 })).toContain("no pages");
    expect(summaryOf({ json: 0, jxn: 4 })).toBe("All 4 documents are Jx Notation.");
    expect(summaryOf({ json: 3, jxn: 0 })).toBe("All 3 documents are JSON.");
    expect(summaryOf({ json: 1, jxn: 1 })).toBe("1 document is JSON and 1 is Jx Notation.");
  });

  test("convertOffer counts what is not in the chosen notation", () => {
    expect(convertOffer({ json: 12, jxn: 3 }, ".jxn")).toEqual({
      canConvert: true,
      label: "Convert 12 documents to Jx Notation (.jxn)…",
    });
    expect(convertOffer({ json: 0, jxn: 1 }, ".json").label).toBe(
      "Convert 1 document to JSON (.json)…",
    );
    expect(convertOffer({ json: 0, jxn: 3 }, ".jxn").canConvert).toBe(false);
    expect(convertOffer(null, ".jxn").canConvert).toBe(false);
  });
});
