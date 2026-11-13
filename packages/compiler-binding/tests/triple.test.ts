import { describe, expect, test } from "bun:test";
import { RELEASE_TRIPLES, addonFileName, addonPackageName, hostTriples } from "../src/triple.ts";

describe("hostTriples", () => {
  test("Linux offers both C libraries, the detected one first", () => {
    expect(hostTriples({ arch: "x64", musl: false, platform: "linux" })).toEqual([
      "linux-x64-gnu",
      "linux-x64-musl",
    ]);
    expect(hostTriples({ arch: "arm64", musl: true, platform: "linux" })).toEqual([
      "linux-arm64-musl",
      "linux-arm64-gnu",
    ]);
  });

  test("macOS and Windows have one build per CPU", () => {
    expect(hostTriples({ arch: "arm64", musl: false, platform: "darwin" })).toEqual([
      "darwin-arm64",
    ]);
    expect(hostTriples({ arch: "x64", musl: false, platform: "win32" })).toEqual([
      "win32-x64-msvc",
    ]);
  });

  test("a CPU or platform no release covers has no triple", () => {
    expect(hostTriples({ arch: "ia32", musl: false, platform: "linux" })).toEqual([]);
    expect(hostTriples({ arch: "x64", musl: false, platform: "freebsd" })).toEqual([]);
  });

  test("every triple a host can ask for is one a release builds", () => {
    const asked = ["linux", "darwin", "win32"].flatMap((platform) =>
      ["x64", "arm64"].flatMap((arch) => hostTriples({ arch, musl: false, platform })),
    );
    expect(asked.toSorted()).toEqual([...RELEASE_TRIPLES].toSorted());
  });
});

test("a triple names its file and its package", () => {
  expect(addonFileName("darwin-arm64")).toBe("jx-compiler.darwin-arm64.node");
  expect(addonPackageName("darwin-arm64")).toBe("@jxsuite/compiler-binding-darwin-arm64");
});
