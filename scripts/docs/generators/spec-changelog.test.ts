/**
 * The spec changelog page renders each spec's `## Changelog`, and a release recorded as a fragment
 * under `specs/changes/` but not yet minted shows above it as **unreleased**, so a reader on `main`
 * sees what the next release carries.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FRAGMENTS_DIR, renderFragment } from "../lib/spec-release.ts";
import { generateSpecChangelog } from "./spec-changelog.ts";

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
  "Body.",
  "",
  "## Changelog",
  "",
  "- **0.4.3-draft** (2026-09-01) — The previous release.",
  "",
  "_Jx Example Specification v0.4.3-draft_",
  "",
].join("\n");

function tree(fragments: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "spec-changelog-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "example.md"), SPEC);
  writeFileSync(join(root, "specs", "bare.md"), SPEC.replace(/## Changelog[\s\S]*?\n\n/, ""));
  if (Object.keys(fragments).length > 0) {
    mkdirSync(join(root, FRAGMENTS_DIR), { recursive: true });
    for (const [name, text] of Object.entries(fragments)) {
      writeFileSync(join(root, FRAGMENTS_DIR, name), text);
    }
  }
  return root;
}

describe("generateSpecChangelog", () => {
  test("renders each spec's entries, and says so when a spec has none", () => {
    const page = generateSpecChangelog(tree({}));
    expect(page).toContain(
      "## `example.md`\n\n- **0.4.3-draft** (2026-09-01) — The previous release.",
    );
    expect(page).toContain("## `bare.md`\n\n_No changelog entries._");
    expect(page).not.toContain("- **unreleased**");
  });

  test("a fragment shows as unreleased above the minted entries, with a full stop", () => {
    const page = generateSpecChangelog(
      tree({
        "bare-1.md": renderFragment("bare.md", "major", "A first thing."),
        "example-1.md": renderFragment("example.md", "minor", "A new thing"),
      }),
    );
    expect(page).toContain(
      "## `example.md`\n\n- **unreleased** (minor) — A new thing.\n- **0.4.3-draft** (2026-09-01)",
    );
    // A spec with a fragment and no minted entry is no longer "no entries".
    expect(page).toContain("## `bare.md`\n\n- **unreleased** (major) — A first thing.");
    expect(page).not.toContain("_No changelog entries._");
  });
});
