import { describe, expect, test } from "bun:test";
import { toPosixPath } from "../scripts/lib/posix-path.ts";

describe("toPosixPath", () => {
  test("rewrites backslashes to forward slashes", () => {
    expect(toPosixPath(String.raw`latest.json`)).toBe("latest.json");
    expect(toPosixPath(String.raw`chunks\a.msi`)).toBe("chunks/a.msi");
  });

  test("leaves an already-posix path untouched", () => {
    expect(toPosixPath("chunks/a.msi")).toBe("chunks/a.msi");
  });
});
