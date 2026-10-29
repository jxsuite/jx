import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";
import { which } from "../src/which.ts";

const root = mkdtempSync(join(tmpdir(), "jx-which-"));
const bin = join(root, "bin");
const second = join(root, "b2");
mkdirSync(join(bin, "dirtool"), { recursive: true });
mkdirSync(second, { recursive: true });
/* The Windows-shaped names are plain executables elsewhere, so every host compares like with like:
   on Windows they exercise the extension rules, and elsewhere the bare-name lookup. */
const executables = [
  join(bin, "tool"),
  join(second, "tool"),
  join(second, "only"),
  join(bin, "launch.EXE"),
  join(bin, "script.cmd"),
  join(bin, "both"),
  join(bin, "both.exe"),
  join(bin, "notes.js"),
];
for (const file of executables) {
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
}
writeFileSync(join(bin, "noexec"), "");
chmodSync(join(bin, "dirtool"), 0o755);
const PATH = `${bin}${delimiter}${second}`;

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe("which answers what Bun.which answered", () => {
  const names = [
    "tool",
    "only",
    "noexec",
    "dirtool",
    "missing",
    "",
    "launch",
    "launch.exe",
    "script",
    "script.cmd",
    "both",
    "notes",
    "notes.js",
    join(bin, "tool"),
    join(bin, "noexec"),
    join(bin, "launch"),
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
    const padded = `${delimiter}${bin}`;
    expect(which("tool", { PATH: padded })).toBe(Bun.which("tool", { PATH: padded }));
    expect(which("tool", { PATH: "" })).toBeNull();
  });

  test("a directory is never the answer, under the POSIX rules on any host", () => {
    // Under the POSIX rules only `/` marks a path, and Windows accepts it too.
    const dirtool = join(bin, "dirtool").replaceAll("\\", "/");
    expect(which(dirtool, { platform: "linux" })).toBeNull();
  });

  test("the environment's PATH is the default", () => {
    expect(which("sh")).toBe(Bun.which("sh"));
  });
});

describe("which on Windows", () => {
  /* Lower-case files, so a case-sensitive host finds the names the Windows rules try. */
  const winDir = join(root, "win");
  mkdirSync(winDir, { recursive: true });
  for (const file of ["git", "git.exe", "git.cmd", "run.cmd", "notes.js"]) {
    writeFileSync(join(winDir, file), "");
    chmodSync(join(winDir, file), 0o755);
  }
  const win = { PATH: winDir, platform: "win32" } as const;

  test("appends .exe, .cmd, .bat and .com in that order, and never answers the bare name", () => {
    expect(which("git", win)).toBe(join(winDir, "git.exe"));
    expect(which("run", win)).toBe(join(winDir, "run.cmd"));
  });

  test("tries a name that already has a launchable extension as written", () => {
    expect(which("git.cmd", win)).toBe(join(winDir, "git.cmd"));
  });

  test("ignores PATHEXT, whose script extensions name files a process cannot spawn", () => {
    const saved = process.env.PATHEXT;
    process.env.PATHEXT = ".JS;.EXE";
    try {
      expect(which("notes", win)).toBeNull();
      expect(which("notes.js", win)).toBeNull();
    } finally {
      if (saved === undefined) {
        delete process.env.PATHEXT;
      } else {
        process.env.PATHEXT = saved;
      }
    }
  });

  test("holds a path to the same extension rules, and treats a backslash as a path", () => {
    expect(which(join(winDir, "git"), { platform: "win32" })).toBe(join(winDir, "git.exe"));
    expect(which(String.raw`no\such`, { platform: "win32" })).toBeNull();
  });
});
