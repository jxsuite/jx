/**
 * Covers `check-spec-release.ts`'s judgement: a body change needs a release, recorded in place (the
 * version advanced) or as a fragment under `specs/changes/`; a fragment is judged too. The git half
 * is not here — the judge takes the diff as data, which is what makes it testable.
 */

import { describe, expect, test } from "bun:test";

import { judgeSpecReleases, normalizedBody } from "./check-spec-release.ts";
import type { ReleaseDiff } from "./check-spec-release.ts";

const spec = (version: string, body: string) =>
  [
    "# Example",
    "",
    `**Version:** ${version}\\`,
    "**Status:** Partial\\",
    "**Updated:** 2026-09-01\\",
    "**License:** MIT",
    "",
    "## 1. Overview",
    "",
    body,
    "",
    "## Changelog",
    "",
    `- **${version}** (2026-09-01) — Released.`,
    "",
    `_Example Specification v${version}_`,
    "",
  ].join("\n");

const FRAGMENT = "---\nspec: example.md\nlevel: minor\n---\n\nA new thing.\n";

/** A diff over in-memory files: `before` is the base, `after` the working tree. */
function diff(
  before: Record<string, string>,
  after: Record<string, string>,
  changed = [...new Set([...Object.keys(before), ...Object.keys(after)])],
): ReleaseDiff {
  return {
    after: (file) => after[file] ?? null,
    before: (file) => before[file] ?? null,
    changed,
    specExists: (name) => `specs/${name}` in after || `specs/${name}` in before,
  };
}

describe("normalizedBody", () => {
  test("release metadata and wrapping are invisible; the body is not", () => {
    const a = spec("0.1.0-draft", "One paragraph\nwrapped here.");
    const b = spec("0.1.1-draft", "One paragraph wrapped here.");
    expect(normalizedBody(a)).toBe(normalizedBody(b));
    expect(normalizedBody(a)).not.toBe(normalizedBody(spec("0.1.0-draft", "Another paragraph.")));
  });
});

describe("judgeSpecReleases", () => {
  test("a body change released in place is a release", () => {
    const out = judgeSpecReleases(
      diff(
        { "specs/example.md": spec("0.1.0-draft", "Old.") },
        { "specs/example.md": spec("0.1.1-draft", "New.") },
      ),
    );
    expect(out.violations).toEqual([]);
    expect(out.released).toEqual(["example.md 0.1.0-draft → 0.1.1-draft"]);
  });

  test("a body change with no release is a violation naming the stuck version", () => {
    const out = judgeSpecReleases(
      diff(
        { "specs/example.md": spec("0.1.0-draft", "Old.") },
        { "specs/example.md": spec("0.1.0-draft", "New.") },
      ),
    );
    expect(out.violations).toEqual([
      {
        file: "specs/example.md",
        message: 'body changed but the version did not advance (still "0.1.0-draft")',
      },
    ]);
  });

  test("a body change recorded as a fragment is a release, and the version may stand", () => {
    const out = judgeSpecReleases(
      diff(
        { "specs/example.md": spec("0.1.0-draft", "Old.") },
        {
          "specs/changes/example-abc12345.md": FRAGMENT,
          "specs/example.md": spec("0.1.0-draft", "New."),
        },
      ),
    );
    expect(out.violations).toEqual([]);
    expect(out.released).toEqual(["example.md (minor fragment: A new thing.)"]);
  });

  test("a fragment for another spec does not release this one", () => {
    const out = judgeSpecReleases(
      diff(
        { "specs/example.md": spec("0.1.0-draft", "Old."), "specs/other.md": spec("0.2.0", "x") },
        {
          "specs/changes/other-abc12345.md": FRAGMENT.replace("example.md", "other.md"),
          "specs/example.md": spec("0.1.0-draft", "New."),
          "specs/other.md": spec("0.2.0", "x"),
        },
      ),
    );
    expect(out.violations.map((v) => v.file)).toEqual(["specs/example.md"]);
  });

  test("a malformed fragment, or one naming a spec that does not exist, is a violation", () => {
    const out = judgeSpecReleases(
      diff(
        {},
        {
          "specs/changes/bad-1.md": "no frontmatter\n",
          "specs/changes/bad-2.md": FRAGMENT.replace("example.md", "missing.md"),
        },
      ),
    );
    expect(out.violations.map((v) => [v.file, v.message])).toEqual([
      ["specs/changes/bad-1.md", "specs/changes/bad-1.md: no frontmatter block (spec:, level:)"],
      ["specs/changes/bad-2.md", "names specs/missing.md, which does not exist"],
    ]);
  });

  test("a deleted fragment (the lane consumed it) and a metadata-only edit are not judged", () => {
    const out = judgeSpecReleases(
      diff(
        {
          "specs/changes/example-abc12345.md": FRAGMENT,
          "specs/example.md": spec("0.1.0-draft", "Same."),
        },
        { "specs/example.md": spec("0.1.1-draft", "Same.") },
      ),
    );
    expect(out).toEqual({ released: [], violations: [] });
  });

  test("a new spec and a deleted spec are left to check-spec-status", () => {
    const out = judgeSpecReleases(
      diff(
        { "specs/gone.md": spec("0.1.0-draft", "x") },
        { "specs/new.md": spec("0.1.0-draft", "x") },
      ),
    );
    expect(out).toEqual({ released: [], violations: [] });
  });

  test("specs/README.md is not a spec", () => {
    const out = judgeSpecReleases(
      diff({ "specs/README.md": "before" }, { "specs/README.md": "after" }),
    );
    expect(out).toEqual({ released: [], violations: [] });
  });
});
