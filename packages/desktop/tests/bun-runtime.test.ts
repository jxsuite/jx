import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bunRuntimeFor, matchesChecksum } from "../scripts/lib/bun-runtime";

const DESKTOP = resolve(import.meta.dir, "..");

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

  test("a platform with no pinned release is an error, not an app that cannot start its backend", () => {
    expect(() => bunRuntimeFor("darwin", "x64")).toThrow("No Bun release is pinned for darwin-x64");
  });

  test("the Linux sums are the ones the snap pins, so the two cannot drift apart", () => {
    const snap = readFileSync(resolve(DESKTOP, "snap/snapcraft.yaml"), "utf8");
    expect(snap).toContain(bunRuntimeFor("linux", "x64").sha256);
    expect(snap).toContain(bunRuntimeFor("linux", "arm64").sha256);
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
