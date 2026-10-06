/**
 * Walk tests: the sorted, pruned directory walk behind every collection's discovery (src/walk.ts),
 * and `Markdown.discover` which delegates to it.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { compileExclude } from "../src/content-rules.ts";
import { Markdown } from "../src/markdown.ts";
import { walkFiles } from "../src/walk.ts";

const ROOT = mkdtempSync(join(tmpdir(), "jx-parser-walk-"));
const OUTSIDE = mkdtempSync(join(tmpdir(), "jx-parser-walk-outside-"));
const rel = (paths: string[]) => paths.map((p) => relative(ROOT, p).split("\\").join("/"));

beforeAll(() => {
  const files = [
    "zeta.md",
    "alpha.md",
    "a-b.md",
    "a.md",
    "a/b.md",
    "Upper.md",
    "notes.txt",
    "node_modules/pkg/README.md",
    ".hidden/secret.md",
    "internal/plan.md",
    "internal/deep/more.md",
    "sub/Page.md",
    "sub/_draft.md",
  ];
  for (const file of files) {
    mkdirSync(join(ROOT, file, ".."), { recursive: true });
    writeFileSync(join(ROOT, file), "# x\n");
  }
  symlinkSync(join(ROOT, "alpha.md"), join(ROOT, "link.md"));
  symlinkSync(join(ROOT, "missing.md"), join(ROOT, "dangling.md"));
  symlinkSync(ROOT, join(ROOT, "loop"));
  /* A directory outside the root, linked in (a monorepo mounting shared docs), with its own link
     back into the walk. */
  mkdirSync(join(OUTSIDE, "nested"), { recursive: true });
  writeFileSync(join(OUTSIDE, "s.md"), "# s\n");
  writeFileSync(join(OUTSIDE, "nested/n.md"), "# n\n");
  symlinkSync(OUTSIDE, join(ROOT, "shared-docs"));
  symlinkSync(ROOT, join(OUTSIDE, "back"));
  symlinkSync(join(ROOT, "no-such-dir"), join(ROOT, "gone"));
  mkdirSync(join(ROOT, "locked"));
  writeFileSync(join(ROOT, "locked/hidden.md"), "# x\n");
  chmodSync(join(ROOT, "locked"), 0o000);
});

afterAll(() => {
  chmodSync(join(ROOT, "locked"), 0o755);
  rmSync(ROOT, { force: true, recursive: true });
  rmSync(OUTSIDE, { force: true, recursive: true });
});

const accept = (name: string) => name.endsWith(".md");
const none = compileExclude();

describe("walkFiles", () => {
  it("visits entries by name within each directory, depth first, in a stable order", () => {
    const first = rel(walkFiles(ROOT, accept, none));
    const second = rel(walkFiles(ROOT, accept, none));
    expect(second).toEqual(first);
    // Uppercase before lowercase; a directory sorts among the files by its own name.
    expect(first.slice(0, 4)).toEqual([".hidden/secret.md", "Upper.md", "a/b.md", "a-b.md"]);
    expect(first.indexOf("a-b.md")).toBeLessThan(first.indexOf("a.md"));
  });

  it("returns only files the predicate accepts", () => {
    expect(rel(walkFiles(ROOT, accept, none))).not.toContain("notes.txt");
  });

  it("skips what exclude hides, and does not even enter a directory it excludes whole", () => {
    const exclude = compileExclude(["internal/**", "**/node_modules/**", ".*/**", "**/_*.md"]);
    const found = rel(walkFiles(ROOT, accept, exclude));
    expect(found).not.toContain("internal/plan.md");
    expect(found).not.toContain("internal/deep/more.md");
    expect(found).not.toContain("node_modules/pkg/README.md");
    expect(found).not.toContain(".hidden/secret.md");
    expect(found).not.toContain("sub/_draft.md");
    expect(found).toContain("sub/Page.md");
  });

  it("treats a symlink to a file as a file and ignores a dangling one", () => {
    const found = rel(walkFiles(ROOT, accept, none));
    expect(found).toContain("link.md");
    expect(found).not.toContain("dangling.md");
  });

  it("follows a symlinked directory, as readdirSync always did, once per path that reaches it", () => {
    const found = rel(walkFiles(ROOT, accept, none));
    expect(found).toContain("shared-docs/s.md");
    expect(found).toContain("shared-docs/nested/n.md");
    // The same files are also reachable at their own path, outside the source.
    const direct = walkFiles(OUTSIDE, accept, none).map((p) => relative(OUTSIDE, p));
    expect(direct).toContain("s.md");
    expect(direct).toContain("nested/n.md");
  });

  it("refuses a link back into a directory it is already inside, so a loop ends", () => {
    const found = rel(walkFiles(ROOT, accept, none));
    expect(found.some((p) => p.startsWith("loop/"))).toBe(false);
    expect(found.some((p) => p.startsWith("shared-docs/back/"))).toBe(false);
    expect(found.filter((p) => p === "alpha.md")).toHaveLength(1);
  });

  it("applies exclude to a linked directory by the path it is reached at", () => {
    const exclude = compileExclude(["shared-docs/**"]);
    expect(rel(walkFiles(ROOT, accept, exclude)).some((p) => p.startsWith("shared-docs/"))).toBe(
      false,
    );
  });

  it("ignores a link whose target cannot be resolved", () => {
    expect(rel(walkFiles(ROOT, accept, none)).some((p) => p.startsWith("gone/"))).toBe(false);
  });

  // Root can read a mode-000 directory, so there is nothing to skip when this suite runs as root.
  it.skipIf(process.getuid?.() === 0)(
    "skips a directory it cannot read instead of failing the whole walk",
    () => {
      expect(rel(walkFiles(ROOT, accept, none))).not.toContain("locked/hidden.md");
    },
  );

  it("an empty or missing root yields nothing", () => {
    expect(walkFiles(join(ROOT, "nope"), accept, none)).toEqual([]);
  });
});

describe("Markdown.discover", () => {
  it("lists a directory's .md files, sorted", async () => {
    const found = rel(await Markdown.discover(ROOT));
    expect(found).toContain("zeta.md");
    expect(found.indexOf("alpha.md")).toBeLessThan(found.indexOf("zeta.md"));
  });

  it("takes exclude, relative to the source", async () => {
    const found = rel(
      await Markdown.discover(".", { baseDir: ROOT, exclude: ["internal/**", ".*/**"] }),
    );
    expect(found).not.toContain("internal/plan.md");
    expect(found).not.toContain(".hidden/secret.md");
    expect(found).toContain("sub/Page.md");
  });

  it("a single file source is that file when it exists", async () => {
    expect(rel(await Markdown.discover("zeta.md", { baseDir: ROOT }))).toEqual(["zeta.md"]);
    expect(await Markdown.discover("absent.md", { baseDir: ROOT })).toEqual([]);
  });

  it("a missing directory is empty", async () => {
    expect(await Markdown.discover("nope", { baseDir: ROOT })).toEqual([]);
  });

  it("resolves a source without a baseDir against the working directory", async () => {
    expect(await Markdown.discover(join(ROOT, "sub"))).toHaveLength(2);
  });
});
