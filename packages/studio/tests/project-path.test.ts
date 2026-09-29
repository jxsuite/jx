/** The containment check every assistant tool that names a file runs first (specs/ai.md §4). */
import { describe, expect, test } from "bun:test";
import { invalidPathResult, normalizeRelPath } from "../src/services/project-path";

describe("normalizeRelPath", () => {
  test.each([
    ["pages/about.json", "pages/about.json"],
    ["./pages/about.json", "pages/about.json"],
    ["././pages/about.json", "pages/about.json"],
    ["  pages/about.json  ", "pages/about.json"],
    [String.raw`pages\about.json`, "pages/about.json"],
    ["pages/a..b.json", "pages/a..b.json"],
    [".", "."],
  ])("%p stays inside the project as %p", (input, expected) => {
    expect(normalizeRelPath(input)).toBe(expected);
  });

  test.each([
    ["..", "the parent itself"],
    ["../outside.json", "a leading parent segment"],
    ["pages/../../outside.json", "a parent segment past the root"],
    [String.raw`pages\..\..\outside.json`, "a parent segment written with backslashes"],
    ["/etc/passwd", "an absolute path"],
    [String.raw`\\server\share\x.json`, "a UNC path"],
    [String.raw`C:\Windows\x.json`, "a drive letter with backslashes"],
    ["c:/x.json", "a drive letter with slashes"],
    ["C:x.json", "a drive-relative path"],
    ["~/x.json", "a home directory"],
    ["", "an empty path"],
    ["   ", "a blank path"],
  ])("%p is refused: %s", (input) => {
    expect(normalizeRelPath(input)).toBeNull();
  });

  test("a value that is not a string is refused", () => {
    for (const input of [undefined, null, 42, {}, ["pages/a.json"]]) {
      expect(normalizeRelPath(input)).toBeNull();
    }
  });
});

describe("invalidPathResult", () => {
  test("fails, quoting the path the model sent", () => {
    const result = invalidPathResult("../outside.json");
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid path "../outside.json"');
    expect(result.error).toContain("relative to the project root");
  });

  test("quotes a value that is not a string as JSON", () => {
    expect(invalidPathResult(42).error).toContain("Invalid path 42");
  });
});
