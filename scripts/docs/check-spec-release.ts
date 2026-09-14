// The spec release gate: a spec whose body changed must also be released — EITHER in place (version
// Advanced, **Updated:** restamped, a new `## Changelog` entry: `spec:bump`) OR as a fragment under
// Specs/changes/ naming the spec, the level and the sentence (`spec:change`), which the release
// Lane mints in merge order. This is what stops many revisions from landing under one version
// Number, which is exactly how the spec versions became meaningless. A fragment is judged too: one
// That names no spec, or a spec that does not exist, or a level that is not a level, is a violation.
//
// A spec's "body" is everything except its release metadata: the **Version:** and **Updated:**
// Lines, the `## Changelog` heading and its entries, and the footer version line. The header
// **Status:** and the per-section
// `> **Status: …**` markers ARE body — changing what is built is a spec change worth releasing.
// Both sides are unwrapped before they are compared, so re-flowing a spec never demands a bump.
//
// The companion content check is check-spec-status.ts (`docs:status`), which enforces that the
// Newest changelog entry matches the header version and **Updated:** date — so an advanced version
// Necessarily means a new changelog entry.
//
// Usage:
//   `bun scripts/docs/check-spec-release.ts` — working tree vs merge-base with main
//   `... --staged` — staged content vs HEAD; `... --base <ref>` — vs an explicit ref
// Exits 1 on violations (CI gate). Wrapped with `|| true` in .husky/pre-commit to stay advisory.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unwrapProse } from "../lib/unwrap-prose.ts";
import { FRAGMENTS_DIR, parseFragment } from "./lib/spec-release.ts";
import { compareSpecVersion, parseSpecSource } from "./lib/spec-status.ts";

const ROOT = resolve(import.meta.dir, "../..");

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const baseFlag = args.indexOf("--base");
const explicitBase = baseFlag === -1 ? null : (args[baseFlag + 1] ?? null);

function gitSafe(gitArgs: string[]): string | null {
  try {
    return execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
  } catch {
    return null;
  }
}

/**
 * The commit to compare against: the merge base with `--base` (or with main by default), so a
 * Branch is judged on its own changes rather than on whatever main gained meanwhile. Falls back to
 * The ref itself when no merge base exists (unrelated histories), and to HEAD as a last resort.
 */
function resolveBase(): string {
  if (staged && !explicitBase) {
    return "HEAD";
  }
  const candidates = explicitBase ? [explicitBase] : ["origin/main", "main"];
  for (const ref of candidates) {
    const mergeBase = gitSafe(["merge-base", "HEAD", ref])?.trim();
    if (mergeBase) {
      return mergeBase;
    }
    if (gitSafe(["rev-parse", "--verify", ref])?.trim()) {
      return ref;
    }
  }
  if (!staged) {
    console.warn(
      "spec release: no merge base found (shallow clone?) — comparing against HEAD, which only " +
        "sees uncommitted work.",
    );
  }
  return "HEAD";
}

// Release metadata — invisible to the body comparison (changing it IS the release).
const METADATA = [
  /^\*\*Version:\*\*/,
  /^\*\*Updated:\*\*/,
  /^##\s+Changelog\s*$/,
  /^-\s+\*\*[^*]+\*\*\s*\(\d{4}-\d{2}-\d{2}\)\s*[—-]\s*/,
  /Specification v[0-9]/,
];

/**
 * Spec text minus its release metadata and its wrapping.
 *
 * Whitespace is not a spec change, and this gate is the one thing standing between a formatting
 * sweep and thirteen releases minted for it. **Unwrapping is what makes reflow invisible**, and it
 * happens before the metadata filter because both sides then read as the same document: a spec
 * written on 100-column lines and the same spec on one line per paragraph normalise to the same
 * text. Collapsing all whitespace instead would be simpler and wrong — it erases the `>` of a block
 * quote and the indent of a nested list item, so turning a paragraph into a quote would stop
 * counting as a change.
 *
 * The trailing `\` of an explicit hard break goes too: the formatter writes those into a labelled
 * run, and a marker that only exists to hold a line break is not body.
 */
export function normalizedBody(source: string): string {
  return unwrapProse(source)
    .text.split("\n")
    .filter((line) => !METADATA.some((re) => re.test(line)))
    .map((line) => line.replace(/\\$/, "").trimEnd())
    .filter((line) => line !== "")
    .join("\n");
}

export interface Violation {
  file: string;
  message: string;
}

/** What the gate reads: the changed paths, and each side's text (null when absent on that side). */
export interface ReleaseDiff {
  changed: readonly string[];
  /** The file's text on the base (before) — null for a new file. */
  before: (file: string) => string | null;
  /** The file's text now — null for a deleted file. */
  after: (file: string) => string | null;
  /** Whether a spec file exists now (a fragment must name one). */
  specExists: (spec: string) => boolean;
}

/**
 * The gate's judgement over a diff: which specs were released (in place or by fragment) and which
 * body changes have no release. Pure, so the test can hand it a diff without a git repository.
 */
export function judgeSpecReleases(diff: ReleaseDiff): {
  violations: Violation[];
  released: string[];
} {
  const specFiles = diff.changed.filter(
    (f) => /^specs\/[^/]+\.md$/.test(f) && f !== "specs/README.md",
  );
  const fragmentFiles = diff.changed.filter(
    (f) => f.startsWith(`${FRAGMENTS_DIR}/`) && f.endsWith(".md"),
  );
  const violations: Violation[] = [];
  const released: string[] = [];

  /** The specs the diff's fragments release, by spec file name; a malformed fragment is a violation. */
  const fragmented = new Set<string>();
  for (const file of fragmentFiles) {
    const text = diff.after(file);
    if (text === null) {
      continue; // Deleted: the release lane consumed it, which is the fragment's whole life.
    }
    try {
      const fragment = parseFragment(text, file.slice(FRAGMENTS_DIR.length + 1));
      if (!diff.specExists(fragment.spec)) {
        violations.push({ file, message: `names specs/${fragment.spec}, which does not exist` });
        continue;
      }
      fragmented.add(fragment.spec);
      released.push(`${fragment.spec} (${fragment.level} fragment: ${fragment.summary})`);
    } catch (error) {
      violations.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const file of specFiles) {
    const name = file.slice("specs/".length);
    const baseText = diff.before(file);
    if (baseText === null) {
      continue; // New spec — check-spec-status.ts requires it to ship a version + changelog baseline.
    }
    const headText = diff.after(file);
    if (headText === null) {
      continue; // Deleted.
    }
    if (normalizedBody(baseText) === normalizedBody(headText)) {
      continue; // Metadata-only change (a re-release, or no substantive edit).
    }
    if (fragmented.has(name)) {
      continue; // Released as a fragment; the lane mints the version in merge order.
    }
    const before = parseSpecSource(baseText, name).headerVersion;
    const after = parseSpecSource(headText, name).headerVersion;
    if (!before || !after) {
      violations.push({ file, message: "missing a header **Version:** line (see `docs:status`)" });
      continue;
    }
    const cmp = compareSpecVersion(after, before);
    if (cmp === null) {
      violations.push({
        file,
        message: `version "${before}" → "${after}" is not MAJOR.MINOR.PATCH (optionally -draft)`,
      });
    } else if (cmp <= 0) {
      violations.push({
        file,
        message: `body changed but the version did not advance (still "${after}")`,
      });
    } else {
      released.push(`${name} ${before} → ${after}`);
    }
  }
  return { released, violations };
}

if (import.meta.main) {
  const base = resolveBase();
  const changed =
    (staged
      ? gitSafe(["diff", "--name-only", "--cached", "--", "specs"])
      : gitSafe(["diff", "--name-only", base, "--", "specs"])
    )
      ?.split("\n")
      .filter(Boolean) ?? [];
  const specFiles = changed.filter((f) => /^specs\/[^/]+\.md$/.test(f) && f !== "specs/README.md");
  if (changed.length === 0) {
    process.exit(0);
  }
  const { violations, released } = judgeSpecReleases({
    after: (file) =>
      staged
        ? gitSafe(["show", `:${file}`])
        : existsSync(join(ROOT, file))
          ? readFileSync(join(ROOT, file), "utf8")
          : null,
    before: (file) => gitSafe(["show", `${base}:${file}`]),
    changed,
    specExists: (spec) => existsSync(join(ROOT, "specs", spec)),
  });
  report(violations, released, specFiles.length);
}

function report(violations: Violation[], released: string[], touched: number): void {
  if (violations.length > 0) {
    console.error(`\nspec release: ${violations.length} spec(s) changed without a release:`);
    for (const { file, message } of violations) {
      console.error(`  ${file}: ${message}`);
    }
    console.error(
      "\nEvery substantive spec edit is a release. Record it with:\n" +
        '  bun run spec:change <spec.md> <major|minor|patch> -m "<what changed>"\n' +
        "which writes a fragment under specs/changes/ that the release lane mints in merge order, so\n" +
        "two pull requests releasing one spec never conflict; or mint in place, now, with\n" +
        '  bun run spec:bump <spec.md> <major|minor|patch> -m "<what changed>"\n' +
        "major = breaking contract change, minor = additive, patch = editorial.\n" +
        "The derived reference pages are build outputs; nothing else to commit.",
    );
    process.exit(1);
  }

  console.log(
    released.length > 0
      ? `spec release: ${released.length} release(s) recorded — ${released.join(", ")}.`
      : `spec release: ${touched} spec file(s) touched, no body changes needing a release.`,
  );
}
