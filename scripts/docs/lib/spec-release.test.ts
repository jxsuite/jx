/**
 * Covers `spec-release.ts`: the version arithmetic `spec:bump` and `spec:release` share, the three
 * edits a release makes to a spec's source, the fragment format `spec:change` writes and the lane
 * reads, and the order fragments mint in.
 *
 * Everything here is pure: a spec is a string, a fragment is a string, and the clock is injected.
 */

import { describe, expect, test } from "bun:test";

import {
  applySpecRelease,
  fragmentName,
  isLevel,
  nextSpecVersion,
  orderFragments,
  parseFragment,
  releaseSpecSource,
  renderFragment,
} from "./spec-release.ts";
import type { Fragment } from "./spec-release.ts";
import { splitVersion } from "./spec-status.ts";

const v = (s: string) => splitVersion(s)!;

const SPEC = [
  "# Jx Example Specification",
  "",
  "**Version:** 0.4.3-draft\\",
  "**Status:** Partial\\",
  "**Updated:** 2026-09-01\\",
  "**License:** MIT",
  "",
  "## 1. Overview",
  "",
  "> **Status: Partial.**",
  "",
  "Body.",
  "",
  "## Changelog",
  "",
  "- **0.4.3-draft** (2026-09-01) — The previous release.",
  "",
  "---",
  "",
  "_Jx Example Specification v0.4.3-draft_",
  "",
].join("\n");

describe("nextSpecVersion", () => {
  test("pre-1.0: major moves the minor, minor and patch move the patch, stable graduates", () => {
    const cur = v("0.4.3-draft");
    expect(nextSpecVersion(cur, null, "major", true).version).toBe("0.5.0-draft");
    expect(nextSpecVersion(cur, null, "minor", true).version).toBe("0.4.4-draft");
    expect(nextSpecVersion(cur, null, "patch", true).version).toBe("0.4.4-draft");
    expect(nextSpecVersion(cur, null, "stable", true).version).toBe("1.0.0");
  });

  test("the -draft suffix follows the status, not the level", () => {
    expect(nextSpecVersion(v("0.4.3-draft"), null, "patch", false).version).toBe("0.4.4");
    expect(nextSpecVersion(v("0.4.3"), null, "patch", true).version).toBe("0.4.4-draft");
  });

  test("post-1.0: semver proper", () => {
    expect(nextSpecVersion(v("1.2.3"), null, "major", false).version).toBe("2.0.0");
    expect(nextSpecVersion(v("1.2.3"), null, "minor", false).version).toBe("1.3.0");
    expect(nextSpecVersion(v("1.2.3"), null, "patch", false).version).toBe("1.2.4");
    expect(() => nextSpecVersion(v("1.2.3"), null, "stable", false)).toThrow("already stable");
  });

  test("a base that has moved past the working file is the floor", () => {
    const next = nextSpecVersion(v("0.4.3-draft"), v("0.4.5-draft"), "patch", true);
    expect(next.version).toBe("0.4.6-draft");
    expect(next.raised).toBe(true);
    expect(nextSpecVersion(v("0.4.3-draft"), v("0.4.1-draft"), "patch", true).raised).toBe(false);
  });
});

describe("applySpecRelease", () => {
  const released = applySpecRelease(SPEC, "example.md", {
    nextVersion: "0.4.4-draft",
    summary: "Something changed",
    today: "2026-09-14",
  });

  test("rewrites the header version and keeps its hard-break marker", () => {
    expect(released).toContain("**Version:** 0.4.4-draft\\\n**Status:** Partial\\");
  });

  test("restamps Updated and the footer", () => {
    expect(released).toContain("**Updated:** 2026-09-14\\");
    expect(released).toContain("_Jx Example Specification v0.4.4-draft_");
  });

  test("prepends the changelog entry, newest first, with a full stop", () => {
    expect(released).toContain(
      "## Changelog\n\n- **0.4.4-draft** (2026-09-14) — Something changed.\n- **0.4.3-draft** (2026-09-01) — The previous release.",
    );
  });

  test("creates the changelog before the footer rule when the spec has none", () => {
    const bare = SPEC.replace(
      "## Changelog\n\n- **0.4.3-draft** (2026-09-01) — The previous release.\n\n",
      "",
    );
    const out = applySpecRelease(bare, "example.md", {
      nextVersion: "0.4.4-draft",
      summary: "First entry.",
      today: "2026-09-14",
    });
    expect(out).toContain("## Changelog\n\n- **0.4.4-draft** (2026-09-14) — First entry.\n\n---");
  });

  test("adds an Updated line after Status when the header lacks one", () => {
    const noUpdated = SPEC.replace("**Updated:** 2026-09-01\\\n", "");
    const out = applySpecRelease(noUpdated, "example.md", {
      nextVersion: "0.4.4-draft",
      summary: "x",
      today: "2026-09-14",
    });
    expect(out).toContain("**Status:** Partial\\\n**Updated:** 2026-09-14\\\n**License:** MIT");
  });

  test("refuses a source with no version line", () => {
    expect(() =>
      applySpecRelease("# Nothing\n", "nothing.md", {
        nextVersion: "0.0.1",
        summary: "x",
        today: "2026-09-14",
      }),
    ).toThrow("no **Version:** line");
  });
});

describe("releaseSpecSource", () => {
  test("reads the version and status off the source and applies one release", () => {
    const out = releaseSpecSource(SPEC, "example.md", "minor", "Added a thing", null, "2026-09-14");
    expect(out.from).toBe("0.4.3-draft");
    expect(out.version).toBe("0.4.4-draft");
    expect(out.source).toContain("- **0.4.4-draft** (2026-09-14) — Added a thing.");
  });

  test("an Implemented spec releases without the draft suffix", () => {
    const done = SPEC.replace("**Status:** Partial\\", "**Status:** Implemented\\");
    expect(releaseSpecSource(done, "example.md", "patch", "x", null, "2026-09-14").version).toBe(
      "0.4.4",
    );
  });

  test("a base ahead of the working file raises the floor", () => {
    const ahead = SPEC.replace("**Version:** 0.4.3-draft\\", "**Version:** 0.4.9-draft\\");
    const out = releaseSpecSource(SPEC, "example.md", "patch", "x", ahead, "2026-09-14");
    expect(out.version).toBe("0.4.10-draft");
    expect(out.raised).toBe(true);
  });

  test("two consecutive releases from one source mint consecutive versions", () => {
    const first = releaseSpecSource(SPEC, "example.md", "patch", "one", null, "2026-09-14");
    const second = releaseSpecSource(
      first.source,
      "example.md",
      "major",
      "two",
      null,
      "2026-09-14",
    );
    expect([first.version, second.version]).toEqual(["0.4.4-draft", "0.5.0-draft"]);
    expect(second.source).toContain(
      "- **0.5.0-draft** (2026-09-14) — two.\n- **0.4.4-draft** (2026-09-14) — one.",
    );
  });
});

describe("fragments", () => {
  test("render and parse are inverses, and the sentence is one line", () => {
    const text = renderFragment("ui.md", "minor", "jx-switch's hint is a\n  tooltip  ");
    expect(text).toBe("---\nspec: ui.md\nlevel: minor\n---\n\njx-switch's hint is a tooltip\n");
    expect(parseFragment(text, "ui-abc.md")).toEqual({
      level: "minor",
      name: "ui-abc.md",
      spec: "ui.md",
      summary: "jx-switch's hint is a tooltip",
    });
  });

  test("a fragment names its spec, its level and a sentence, or it is refused by name", () => {
    expect(() => parseFragment("no frontmatter\n", "x.md")).toThrow("no frontmatter block");
    expect(() => parseFragment("---\nspec: ../etc\nlevel: minor\n---\nx\n", "x.md")).toThrow(
      "spec must be a file name",
    );
    expect(() => parseFragment("---\nspec: ui.md\nlevel: huge\n---\nx\n", "x.md")).toThrow(
      "level must be",
    );
    expect(() => parseFragment("---\nspec: ui.md\nlevel: patch\n---\n\n", "x.md")).toThrow(
      "the body (the changelog sentence) is empty",
    );
  });

  test("the file name carries the spec's stem and a digest of the sentence", () => {
    const a = fragmentName("ui.md", "one thing");
    const b = fragmentName("ui.md", "another thing");
    expect(a).toMatch(/^ui-[0-9a-f]{8}\.md$/);
    expect(a).not.toBe(b);
    expect(fragmentName("ui.md", "one thing")).toBe(a);
  });

  test("isLevel admits exactly the four levels", () => {
    expect(["major", "minor", "patch", "stable"].every((level) => isLevel(level))).toBe(true);
    expect(isLevel("huge")).toBe(false);
  });

  test("fragments mint in landing order, then by name, and an unlanded one goes last", () => {
    const f = (name: string): Fragment => ({ level: "patch", name, spec: "ui.md", summary: name });
    const landed: Record<string, number> = { "ui-b.md": 10, "ui-a.md": 20, "ui-c.md": 10 };
    const ordered = orderFragments(
      [f("ui-a.md"), f("ui-z.md"), f("ui-c.md"), f("ui-b.md")],
      (x) => landed[x.name] ?? Number.POSITIVE_INFINITY,
    ).map((x) => x.name);
    expect(ordered).toEqual(["ui-b.md", "ui-c.md", "ui-a.md", "ui-z.md"]);
  });
});
