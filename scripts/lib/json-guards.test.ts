import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isJsonRecord, isText } from "./json-guards.ts";

describe("isJsonRecord", () => {
  test("accepts a plain object, empty or not", () => {
    expect([isJsonRecord({}), isJsonRecord({ a: 1 })]).toEqual([true, true]);
  });

  test("refuses null, arrays and every primitive", () => {
    const verdicts = [null, [], [1], "x", 1, true, undefined].map((value) => isJsonRecord(value));
    expect(verdicts).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("isText", () => {
  test("accepts strings, the empty one included", () => {
    expect([isText(""), isText("a")]).toEqual([true, true]);
  });

  test("refuses everything that is not a string primitive", () => {
    const verdicts = [null, undefined, 1, true, {}, [], ["a"]].map((value) => isText(value));
    expect(verdicts).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("the no-install scripts", () => {
  // These run under `install: "false"`, where a runtime workspace-package import resolves against
  // The published package instead of the workspace. Only erased `import type` lines may name one.
  const scripts = ["check-bun-nix.ts", "ci/approve-held-runs.ts"];

  test.each(scripts)("%s imports no workspace package at runtime", (script) => {
    const source = readFileSync(join(import.meta.dir, "..", script), "utf8");
    const runtimeImports = [
      ...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gmu),
    ].flatMap((match) => (match[1]?.startsWith("@jxsuite/") ? [match[1]] : []));
    expect(runtimeImports).toEqual([]);
  });
});
