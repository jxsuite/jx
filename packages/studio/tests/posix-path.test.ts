import { describe, expect, test } from "bun:test";
import { toPosixPath } from "../scripts/lib/posix-path.ts";

describe("toPosixPath", () => {
  test("rewrites backslashes to forward slashes", () => {
    expect(toPosixPath(String.raw`surfaces\nested\b.json`)).toBe("surfaces/nested/b.json");
  });

  test("leaves an already-posix path untouched", () => {
    expect(toPosixPath("surfaces/nested/b.json")).toBe("surfaces/nested/b.json");
  });

  test("a bare filename with no separator at all is unchanged", () => {
    expect(toPosixPath("statusbar.json")).toBe("statusbar.json");
  });
});
