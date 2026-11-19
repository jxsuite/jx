import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { folderIsMissing } from "../src/backend/folder-exists";

/** An error carrying a Node-style code, as `statSync` throws. */
class CodedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CodedError";
    this.code = code;
  }
}

describe("folderIsMissing", () => {
  test("a folder that exists is not missing, and one that was deleted is", () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-folder-"));
    expect(folderIsMissing(dir)).toBe(false);
    rmSync(dir, { recursive: true });
    expect(folderIsMissing(dir)).toBe(true);
  });

  test("a path under a file is missing (ENOTDIR)", () => {
    const stat = (): never => {
      throw new CodedError("ENOTDIR");
    };
    expect(folderIsMissing("/a/file/b", stat)).toBe(true);
  });

  test("a refusal is not absence: the Mac App Store sandbox answers EPERM for an ungranted folder", () => {
    const stat = (): never => {
      throw new CodedError("EPERM");
    };
    expect(folderIsMissing("/Users/someone/project", stat)).toBe(false);
  });

  test("an error with no code is not absence", () => {
    const stat = (): never => {
      throw new Error("boom");
    };
    expect(folderIsMissing("/x", stat)).toBe(false);
  });
});
