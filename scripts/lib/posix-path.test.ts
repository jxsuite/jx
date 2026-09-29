import { describe, expect, test } from "bun:test";
import { toPosixPath } from "./posix-path.ts";

describe("toPosixPath", () => {
  test("rewrites backslashes to forward slashes", () => {
    expect(toPosixPath(String.raw`src\panels\x.ts`)).toBe("src/panels/x.ts");
  });

  test("leaves an already-posix path untouched", () => {
    expect(toPosixPath("src/panels/x.ts")).toBe("src/panels/x.ts");
  });

  test("handles a mix of both, the shape a Windows path.join over a posix literal produces", () => {
    expect(toPosixPath(String.raw`docs/studio\projects\create.md`)).toBe(
      "docs/studio/projects/create.md",
    );
  });

  test("a bare filename with no separator at all is unchanged", () => {
    expect(toPosixPath("desktop.md")).toBe("desktop.md");
  });
});
