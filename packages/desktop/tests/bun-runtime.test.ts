import { describe, expect, test } from "bun:test";
import { readPinnedBunVersion } from "@jxsuite/test-support/bun-pin";
import { bunRuntimeFor, matchesChecksum } from "../scripts/lib/bun-runtime";

describe("bunRuntimeFor", () => {
  test.each([
    ["darwin", "arm64", "bun-darwin-aarch64", "bun"],
    ["linux", "x64", "bun-linux-x64", "bun"],
    ["linux", "arm64", "bun-linux-aarch64", "bun"],
    ["win32", "x64", "bun-windows-x64", "bun.exe"],
  ])("%s-%s is the official %s release", (platform, arch, file, binary) => {
    const runtime = bunRuntimeFor(platform, arch);
    expect(runtime.file).toBe(file);
    expect(runtime.binary).toBe(binary);
    expect(runtime.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(runtime.url).toBe(
      `https://github.com/oven-sh/bun/releases/download/bun-v${runtime.version}/${file}.zip`,
    );
  });

  test("carries exactly the Bun CI tests against, the repository's .bun-version", () => {
    /* The repository's `.bun-version` is the one pin every workflow installs (.github/actions/setup-bun
       reads it), so the backend a user runs is the Bun the test matrix ran. Bump the two together. */
    const pinned = readPinnedBunVersion();
    expect(pinned).toBeDefined();
    expect(bunRuntimeFor("linux", "x64").version).toBe(pinned ?? "");
  });

  test("a platform with no pinned release is an error, not an app that cannot start its backend", () => {
    expect(() => bunRuntimeFor("darwin", "x64")).toThrow("No Bun release is pinned for darwin-x64");
  });
});

describe("matchesChecksum", () => {
  const bytes = new TextEncoder().encode("jx");
  const pinned = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

  test("accepts exactly the pinned bytes", () => {
    expect(matchesChecksum(bytes, pinned)).toBe(true);
  });

  test("refuses a different archive, and a different sum", () => {
    expect(matchesChecksum(new TextEncoder().encode("jy"), pinned)).toBe(false);
    expect(matchesChecksum(bytes, "0".repeat(64))).toBe(false);
  });
});
