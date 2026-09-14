/**
 * Releasing a spec, as pure functions, and the release FRAGMENT a pull request records instead.
 *
 * A spec release is three edits to one file: the header `**Version:**` (and the footer's copy of
 * it) advances, `**Updated:**` is restamped, and a `## Changelog` entry is prepended. Written in
 * the pull request, those three edits are where two pull requests that release the same spec
 * collide: both rewrite the version line and both prepend at the top of the changelog, so whichever
 * merges second conflicts on lines that carry no information of its own (#335 — three `studio.md`
 * releases and two `ui.md` releases in one day, each pair resolved by hand).
 *
 * So a pull request may record the release as a FRAGMENT instead: one small file under
 * `specs/changes/`, naming the spec, the level and the changelog sentence, and touching nothing in
 * the spec's metadata. Two fragments never conflict. The versions are minted on the release branch,
 * in merge order, by `spec:release` — the same way release-please mints package versions — so the
 * number a change gets is decided by when it lands, not by when it was written.
 *
 * `spec:bump` (in place, now) and `spec:release` (every fragment, in order) both call
 * {@link applySpecRelease}; the gate (`check-spec-release.ts`) accepts either form.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { endsInHardBreak } from "../../lib/unwrap-prose.ts";
import { parseSpecSource, splitVersion, versionFloor } from "./spec-status.ts";
import type { ParsedVersion } from "./spec-status.ts";

export const LEVELS = ["major", "minor", "patch", "stable"] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(word: string): word is Level {
  return (LEVELS as readonly string[]).includes(word);
}

/** Where a pull request's release fragments live, relative to the repository root. */
export const FRAGMENTS_DIR = "specs/changes";

const CHANGELOG_HEADING = /^##\s+Changelog\s*$/;
const FOOTER_VERSION_LINE = /Specification v[0-9][A-Za-z0-9.-]*/;
const STATUS_LINE = /^\*\*Status:\*\*/;

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * The version after `level`, from `current` or from `base` when the base is ahead.
 *
 * Pre-1.0 specs (every spec today) follow release-please's bump-minor-pre-major policy, the same
 * one the reconstructed history was derived under: a structural break moves the minor, everything
 * else moves the patch. `stable` is the deliberate graduation to 1.0.0. The `-draft` suffix is
 * derived from the header `**Status:**` — only an Implemented spec releases without it.
 */
export function nextSpecVersion(
  current: ParsedVersion,
  base: ParsedVersion | null,
  level: Level,
  draft: boolean,
): { version: string; floor: ParsedVersion; raised: boolean } {
  const { version: floor, raised } = versionFloor(current, base);
  const preMajor = floor.major === 0;
  let next: { major: number; minor: number; patch: number };
  if (level === "stable") {
    if (!preMajor) {
      throw new Error(`is already stable at ${floor.raw}`);
    }
    next = { major: 1, minor: 0, patch: 0 };
  } else if (level === "major") {
    next = preMajor
      ? { major: 0, minor: floor.minor + 1, patch: 0 }
      : { major: floor.major + 1, minor: 0, patch: 0 };
  } else if (level === "minor") {
    next = preMajor
      ? { major: 0, minor: floor.minor, patch: floor.patch + 1 }
      : { major: floor.major, minor: floor.minor + 1, patch: 0 };
  } else {
    next = { major: floor.major, minor: floor.minor, patch: floor.patch + 1 };
  }
  const suffix = draft && level !== "stable" ? "-draft" : "";
  return { floor, raised, version: `${next.major}.${next.minor}.${next.patch}${suffix}` };
}

// ─── The three edits ─────────────────────────────────────────────────────────

export interface ReleaseEdit {
  nextVersion: string;
  /** `YYYY-MM-DD`. */
  today: string;
  summary: string;
}

/**
 * The spec's source after one release: header and footer version, `**Updated:**`, and the new
 * changelog entry at the top of `## Changelog` (created before the footer rule when absent).
 *
 * The header block is a labelled run — `**Version:** / **Status:** / **Updated:** / **License:**` —
 * and once the Markdown sweep lands, every line but the last carries a trailing `\` hard break to
 * hold it there (see scripts/lib/unwrap-prose.ts). Rewriting a line whole would drop the marker and
 * join the header into one sentence, so the marker is read off the line being replaced.
 */
export function applySpecRelease(source: string, file: string, edit: ReleaseEdit): string {
  const lines = source.split("\n");
  const versionIdx = lines.findIndex((l) => l.startsWith("**Version:**"));
  if (versionIdx === -1) {
    throw new Error(`specs/${file} has no **Version:** line`);
  }
  const versionBreak = endsInHardBreak(lines[versionIdx]!) ? "\\" : "";
  lines[versionIdx] = `**Version:** ${edit.nextVersion}${versionBreak}`;
  const footerIdx = lines.findLastIndex((l) => FOOTER_VERSION_LINE.test(l));
  if (footerIdx !== -1) {
    lines[footerIdx] = lines[footerIdx]!.replace(
      FOOTER_VERSION_LINE,
      `Specification v${edit.nextVersion}`,
    );
  }

  const updatedIdx = lines.findIndex((l) => l.startsWith("**Updated:**"));
  if (updatedIdx === -1) {
    const statusIdx = lines.findIndex((l) => STATUS_LINE.test(l));
    if (statusIdx === -1) {
      throw new Error(`specs/${file} has no **Status:** line to anchor **Updated:** to`);
    }
    const statusBreak = endsInHardBreak(lines[statusIdx]!) ? "\\" : "";
    lines.splice(statusIdx + 1, 0, `**Updated:** ${edit.today}${statusBreak}`);
  } else {
    const updatedBreak = endsInHardBreak(lines[updatedIdx]!) ? "\\" : "";
    lines[updatedIdx] = `**Updated:** ${edit.today}${updatedBreak}`;
  }

  const summary = edit.summary.replaceAll(/\s+/g, " ").trim();
  const entry = `- **${edit.nextVersion}** (${edit.today}) — ${summary.endsWith(".") ? summary : `${summary}.`}`;
  const changelogIdx = lines.findIndex((l) => CHANGELOG_HEADING.test(l));
  if (changelogIdx === -1) {
    const block = ["## Changelog", "", entry];
    const tailIdx = lines.findLastIndex((l) => FOOTER_VERSION_LINE.test(l));
    if (tailIdx === -1) {
      while (lines.length > 0 && lines.at(-1)!.trim() === "") {
        lines.pop();
      }
      lines.push("", ...block, "");
    } else {
      let insertAt = tailIdx;
      let j = tailIdx - 1;
      while (j >= 0 && lines[j]!.trim() === "") {
        j -= 1;
      }
      if (j >= 0 && lines[j]!.trim() === "---") {
        insertAt = j;
      }
      lines.splice(insertAt, 0, ...block, "");
    }
  } else {
    let insertAt = changelogIdx + 1;
    while (insertAt < lines.length && lines[insertAt]!.trim() === "") {
      insertAt += 1;
    }
    lines.splice(insertAt, 0, entry);
  }
  return lines.join("\n");
}

/**
 * One release of one spec's source: the next version from its header (and the base's, when that is
 * ahead), then the three edits. What both `spec:bump` and `spec:release` do per release.
 */
export function releaseSpecSource(
  source: string,
  file: string,
  level: Level,
  summary: string,
  baseSource: string | null,
  today: string,
): { source: string; version: string; from: string; floor: string; raised: boolean } {
  const parsed = parseSpecSource(source, file);
  if (!parsed.headerVersion) {
    throw new Error(`specs/${file} has no **Version:** line`);
  }
  const current = splitVersion(parsed.headerVersion);
  if (!current) {
    throw new Error(
      `specs/${file} version "${parsed.headerVersion}" is not MAJOR.MINOR.PATCH (optionally -draft)`,
    );
  }
  const baseHeader = baseSource ? parseSpecSource(baseSource, file).headerVersion : undefined;
  const base = baseHeader ? splitVersion(baseHeader) : null;
  const draft = parsed.headerStatus !== "Implemented";
  let next: ReturnType<typeof nextSpecVersion>;
  try {
    next = nextSpecVersion(current, base, level, draft);
  } catch (error) {
    throw new Error(`specs/${file} ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const { version, raised, floor } = next;
  return {
    floor: floor.raw,
    from: current.raw,
    raised,
    source: applySpecRelease(source, file, { nextVersion: version, summary, today }),
    version,
  };
}

// ─── Fragments ───────────────────────────────────────────────────────────────

export interface Fragment {
  /** The fragment's file name under `specs/changes/`. */
  name: string;
  /** The spec's file name, e.g. `ui.md`. */
  spec: string;
  level: Level;
  /** The changelog sentence, one line. */
  summary: string;
}

/**
 * A fragment is a Markdown file whose frontmatter names the spec and the level, and whose body is
 * the changelog sentence. Markdown rather than JSON so the sentence reads as prose in a review and
 * the repository's Markdown gates (visual-editor escapes) read it too.
 *
 *     ---
 *     spec: ui.md
 *     level: minor
 *     ---
 *
 *     jx-switch's hint is a jx-tooltip while it can act.
 */
export function parseFragment(text: string, name: string): Fragment {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`${FRAGMENTS_DIR}/${name}: no frontmatter block (spec:, level:)`);
  }
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) {
      fields.set(kv[1]!, kv[2]!.trim().replaceAll(/^["']|["']$/g, ""));
    }
  }
  const spec = fields.get("spec") ?? "";
  const level = fields.get("level") ?? "";
  if (!/^[a-z0-9-]+\.md$/.test(spec)) {
    throw new Error(
      `${FRAGMENTS_DIR}/${name}: spec must be a file name such as ui.md (got "${spec}")`,
    );
  }
  if (!isLevel(level)) {
    throw new Error(
      `${FRAGMENTS_DIR}/${name}: level must be major|minor|patch|stable (got "${level}")`,
    );
  }
  const summary = match[2]!.replaceAll(/\s+/g, " ").trim();
  if (!summary) {
    throw new Error(`${FRAGMENTS_DIR}/${name}: the body (the changelog sentence) is empty`);
  }
  return { level, name, spec, summary };
}

/** The fragment's text for a spec, level and sentence: what `spec:change` writes. */
export function renderFragment(spec: string, level: Level, summary: string): string {
  return `---\nspec: ${spec}\nlevel: ${level}\n---\n\n${summary.replaceAll(/\s+/g, " ").trim()}\n`;
}

/**
 * The file name a fragment gets: the spec's stem and a short digest of the sentence, so two pull
 * requests recording different changes to one spec never write the same path.
 */
export function fragmentName(spec: string, summary: string): string {
  const stem = basename(spec, ".md");
  const digest = new Bun.CryptoHasher("sha1").update(summary.trim()).digest("hex").slice(0, 8);
  return `${stem}-${digest}.md`;
}

/** Every fragment under the root's `specs/changes/`, parsed; the order is the caller's. */
export function readFragments(root: string): Fragment[] {
  const dir = join(root, FRAGMENTS_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .toSorted()
    .map((name) => parseFragment(readFileSync(join(dir, name), "utf8"), name));
}

/**
 * When a fragment LANDED on the branch: the committer date of the first-parent commit that added
 * it, which for a merged pull request is the merge commit — so the order is merge order, not the
 * author's clock. Without `--first-parent`, `--diff-filter=A` finds the pull-request commit that
 * wrote the fragment, and `%at` is when the developer typed it: a fragment written nine days before
 * it merged would mint before one written yesterday and merged an hour ago. `%ct` rather than `%at`
 * because a rebase-merge re-stamps the committer date to the landing and leaves the author date
 * alone. A fragment git has not seen yet (a local preview) is `Infinity`, and sorts last.
 */
export function fragmentLandingClock(root: string): (fragment: Fragment) => number {
  return (fragment) => {
    try {
      const out = execFileSync(
        "git",
        [
          "log",
          "--first-parent",
          "--diff-filter=A",
          "--format=%ct",
          "-n",
          "1",
          "--",
          `${FRAGMENTS_DIR}/${fragment.name}`,
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return out ? Number(out) : Number.POSITIVE_INFINITY;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
}

/**
 * Fragments in the order they should mint: by when each landed (the caller supplies the clock,
 * normally {@link fragmentLandingClock}, `Infinity` for one git has not seen), then by name, so the
 * result is stable for two fragments that landed in one commit.
 */
export function orderFragments(fragments: Fragment[], at: (f: Fragment) => number): Fragment[] {
  return fragments
    .map((fragment, index) => ({ at: at(fragment), fragment, index }))
    .toSorted(
      (a, b) => a.at - b.at || a.fragment.name.localeCompare(b.fragment.name) || a.index - b.index,
    )
    .map((entry) => entry.fragment);
}
