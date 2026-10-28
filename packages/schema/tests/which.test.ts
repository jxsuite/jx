import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { which } from "../src/which.ts";

const root = mkdtempSync(join(tmpdir(), "jx-which-"));
const bin = join(root, "bin");
const second = join(root, "b2");
mkdirSync(join(bin, "dirtool"), { recursive: true });
mkdirSync(second, { recursive: true });
for (const file of [join(bin, "tool"), join(second, "tool"), join(second, "only")]) {
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
}
writeFileSync(join(bin, "noexec"), "");
chmodSync(join(bin, "dirtool"), 0o755);
const PATH = `${bin}:${second}`;

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe("which answers what Bun.which answered", () => {
  const names = [
    "tool",
    "only",
    "noexec",
    "dirtool",
    "missing",
    "",
    join(bin, "tool"),
    join(bin, "noexec"),
    relative(process.cwd(), join(bin, "tool")),
  ];
  for (const name of names) {
    test(JSON.stringify(name), () => {
      // Bun keeps a relative name's `..` segments in its answer; the file named is the same.
      const bunAnswer = Bun.which(name, { PATH });
      expect(which(name, { PATH })).toBe(bunAnswer === null ? null : resolve(bunAnswer));
    });
  }

  test("empty PATH entries are skipped", () => {
    expect(which("tool", { PATH: `:${bin}` })).toBe(Bun.which("tool", { PATH: `:${bin}` }));
    expect(which("tool", { PATH: "" })).toBeNull();
  });

  test("the environment's PATH is the default", () => {
    expect(which("sh")).toBe(Bun.which("sh"));
  });
});

describe("which on Windows", () => {
  const winDir = join(root, "win");
  mkdirSync(winDir, { recursive: true });
  writeFileSync(join(winDir, "git.EXE"), "");
  chmodSync(join(winDir, "git.EXE"), 0o755);

  test("tries each PATHEXT extension", () => {
    const saved = process.env.PATHEXT;
    process.env.PATHEXT = ".COM;.EXE";
    try {
      expect(which("git", { PATH: winDir, platform: "win32" })).toBe(join(winDir, "git.EXE"));
    } finally {
      process.env.PATHEXT = saved;
    }
  });

  test("falls back to the default extensions and treats a backslash as a path", () => {
    const saved = process.env.PATHEXT;
    delete process.env.PATHEXT;
    try {
      expect(which("git", { PATH: winDir, platform: "win32" })).toBe(join(winDir, "git.EXE"));
      expect(which(String.raw`no\such`, { platform: "win32" })).toBeNull();
    } finally {
      process.env.PATHEXT = saved;
    }
  });
});
