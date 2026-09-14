/**
 * `git status --porcelain=v1` as the git panel reads it.
 *
 * The bug this file exists for: the first changed file in a project showed as `index.md` under a
 * folder called `ages`, and clicking it asked git for `ages/index.md`. The old parser trimmed the
 * whole output before splitting it into lines, which ate the leading space of the first line only —
 * an unstaged modification's index column IS a space — so `slice(3)` landed one character late for
 * that line and no other.
 */

import { describe, expect, test } from "bun:test";

import { parsePorcelainV1 } from "../src/git";

describe("parsePorcelainV1", () => {
  test("the first line's leading space is a column, not whitespace to trim", () => {
    // Exactly the output for one unstaged edit — the case that produced `ages/index.md`.
    expect(parsePorcelainV1(" M pages/index.md\n")).toEqual([
      { path: "pages/index.md", staged: false, status: "M" },
    ]);
  });

  test("every line keeps its path, whatever its position", () => {
    const out = " M pages/index.md\nA  pages/about.md\n D public/old.png\n";
    expect(parsePorcelainV1(out).map((f) => f.path)).toEqual([
      "pages/index.md",
      "pages/about.md",
      "public/old.png",
    ]);
  });

  test("statuses are the single letters the panel can open, not the raw two columns", () => {
    /* `??` and `MM` used to pass through as themselves. Neither is in the panel's set of diffable
       statuses, so an untracked file — the commonest change there is — could not be opened. */
    const out = "?? pages/new.md\nMM pages/index.md\nA  pages/about.md\n";
    const rows = parsePorcelainV1(out);
    expect(rows).toEqual([
      { path: "pages/new.md", staged: false, status: "U" },
      { path: "pages/index.md", staged: true, status: "M" },
      { path: "pages/index.md", staged: false, status: "M" },
      { path: "pages/about.md", staged: true, status: "A" },
    ]);
  });

  test("a rename names the file the working tree has", () => {
    expect(parsePorcelainV1("R  pages/old.md -> pages/new.md\n")).toEqual([
      { path: "pages/new.md", staged: true, status: "R" },
    ]);
  });

  test("ignored files and blank lines are not rows", () => {
    expect(parsePorcelainV1("!! node_modules/\n\n")).toEqual([]);
    expect(parsePorcelainV1("")).toEqual([]);
  });

  test("a path with spaces survives", () => {
    expect(parsePorcelainV1(" M pages/my page.md\n")[0]?.path).toBe("pages/my page.md");
  });
});
