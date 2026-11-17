/**
 * The body of a `desktop-v*` GitHub release: what changed in Studio, not just that desktop moved.
 *
 * Release-please writes a component's release notes from the commits under that component's own
 * directory, and `packages/desktop` holds a manifest and a bundler. So the notes of the one release
 * people read are a "Dependencies: studio bumped to 13.0.0" list, while the changes live in
 * `packages/studio/CHANGELOG.md`. Library components are no longer GitHub releases at all
 * (`.github/AGENTS.md`, "Only desktop is a GitHub release"), so this is the one place a reader of
 * the Releases page can see them.
 *
 *     bun scripts/desktop-release-notes.ts --tag desktop-v9.4.0 --body-file notes.md
 *
 * Prints `notes.md` with one marked block appended (or replaced, so a re-run does not stack
 * blocks). The block holds:
 *
 * - Every `packages/studio/CHANGELOG.md` section that exists at the tag and did not at the previous
 *   desktop tag, which is exactly "what Studio released since the last desktop build" even when a
 *   release skipped a desktop build in between;
 * - One line naming every other component whose version moved, with the compare link for the rest.
 *
 * It reads git history and two JSON files with Bun builtins, so the job that runs it installs
 * nothing.
 */

import { readFileSync } from "node:fs";

/** Components whose changelog sections are copied into the release notes, by manifest path. */
export const INCLUDED_CHANGELOGS: readonly string[] = ["packages/studio"];

/**
 * The manifest path of the component the release is named for; it is never listed as "also
 * released".
 */
export const DESKTOP_PATH = "packages/desktop";

/** The repository the compare links point at. */
export const REPOSITORY_URL = "https://github.com/jxsuite/jx";

/** GitHub refuses a release body over 125,000 characters, so a block is cut well before that. */
export const MAX_BLOCK_LENGTH = 60_000;

export const BLOCK_START = "<!-- jx:release-contents -->";
export const BLOCK_END = "<!-- /jx:release-contents -->";

/** One `## [x.y.z](compare-url) (date)` section of a release-please changelog. */
export interface ChangelogSection {
  version: string;
  /** The `(2026-11-15)` part, when the heading has one. */
  date: string | undefined;
  /** Everything under the heading, up to the next section, trimmed. */
  body: string;
}

const SECTION_HEADING = /^## \[?(\d+\.\d+\.\d+[^\]\s)]*)\]?(?:\([^)]*\))?(?: \(([^)]*)\))?\s*$/;

/** Split a release-please `CHANGELOG.md` into its version sections, newest first as written. */
export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { version: string; date: string | undefined; lines: string[] } | undefined;
  const flush = () => {
    if (current) {
      sections.push({
        version: current.version,
        date: current.date,
        body: current.lines.join("\n").trim(),
      });
    }
  };
  for (const line of text.split("\n")) {
    const match = SECTION_HEADING.exec(line);
    if (match) {
      flush();
      current = { version: match[1]!, date: match[2], lines: [] };
    } else if (line.startsWith("## ")) {
      // Some other level-two heading ends the section without starting a version.
      flush();
      current = undefined;
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

/** The sections of `current` whose version `previous` does not have. */
export function newSections(
  current: readonly ChangelogSection[],
  previous: readonly ChangelogSection[],
): ChangelogSection[] {
  const seen = new Set(previous.map((s) => s.version));
  return current.filter((s) => !seen.has(s.version));
}

/**
 * Drop the `### Dependencies` subsection release-please appends ("The following workspace
 * dependencies were updated"). On the release page it is a list of version bumps that says nothing
 * a reader can use, and the packages that moved are named once below.
 */
export function stripDependencies(body: string): string {
  const lines = body.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      skipping = /^### Dependencies\s*$/.test(line);
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join("\n").trim();
}

/** Push every Markdown heading one level down, so a section nests under the block's own headings. */
export function demoteHeadings(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        inFence = !inFence;
      }
      return !inFence && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

/** A component whose manifest version differs between two releases. */
export interface MovedComponent {
  name: string;
  from: string | undefined;
  to: string;
}

type Manifest = Record<string, string>;

/**
 * The components, other than the desktop app itself and the ones whose changelog is copied in,
 * whose version moved. A component absent from `previous` is new, and one at the `0.0.0` sentinel
 * claims nothing yet.
 */
export function movedComponents(
  current: Manifest,
  previous: Manifest,
  skip: readonly string[] = [DESKTOP_PATH, ...INCLUDED_CHANGELOGS],
): MovedComponent[] {
  return Object.entries(current)
    .filter(([path, version]) => !skip.includes(path) && version !== "0.0.0")
    .filter(([path, version]) => previous[path] !== version)
    .map(([path, to]) => ({ name: path.split("/").at(-1)!, from: previous[path], to }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export interface BlockInput {
  /** `desktop-v9.4.0`. */
  tag: string;
  /** The previous desktop tag the sections were diffed against, when there is one. */
  previousTag: string | undefined;
  /** New changelog sections per component display name, e.g. `Studio`. */
  changelogs: ReadonlyMap<string, readonly ChangelogSection[]>;
  moved: readonly MovedComponent[];
}

function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The marked block, or an empty string when there is nothing to say. */
export function renderBlock(input: BlockInput): string {
  const parts: string[] = [];

  for (const [name, sections] of input.changelogs) {
    if (sections.length === 0) {
      continue;
    }
    parts.push(`## Changes in ${name}`);
    for (const section of sections) {
      const date = section.date ? ` (${section.date})` : "";
      parts.push(
        `### ${name} ${section.version}${date}`,
        demoteHeadings(stripDependencies(section.body)),
      );
    }
  }

  if (input.moved.length > 0) {
    const list = input.moved.map((m) => `${m.name} ${m.to}`).join(", ");
    const compare = input.previousTag
      ? ` ([everything since ${input.previousTag}](${REPOSITORY_URL}/compare/${input.previousTag}...${input.tag}))`
      : "";
    parts.push(
      "## Also released",
      `Packages that moved in this release, each tagged in the repository: ${list}${compare}.`,
    );
  }

  if (parts.length === 0) {
    return "";
  }

  let content = parts.join("\n\n");
  if (content.length > MAX_BLOCK_LENGTH) {
    content = `${content.slice(0, MAX_BLOCK_LENGTH).trimEnd()}\n\n_The notes were cut here. The rest is in each package's \`CHANGELOG.md\` at this tag._`;
  }
  return `${BLOCK_START}\n${content}\n${BLOCK_END}`;
}

/**
 * Put `block` at the end of `body`, replacing a block this script wrote earlier, so running it
 * twice gives the same text. An empty `block` removes an old one and adds nothing.
 */
export function spliceBlock(body: string, block: string): string {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END);
  const without =
    start !== -1 && end > start ? body.slice(0, start) + body.slice(end + BLOCK_END.length) : body;
  const base = without.trimEnd();
  return block ? `${base}\n\n${block}\n` : `${base}\n`;
}

/** The desktop tag released just before `tag`, by version rather than by date. */
export function previousDesktopTag(tag: string, tags: readonly string[]): string | undefined {
  const version = (t: string) => t.replace(/^desktop-v/, "");
  return tags
    .filter((t) => /^desktop-v\d+\.\d+\.\d+$/.test(t) && t !== tag)
    .filter((t) => Bun.semver.order(version(t), version(tag)) === -1)
    .toSorted((a, b) => Bun.semver.order(version(b), version(a)))[0];
}

/** `git show <ref>:<path>`, or undefined when the path does not exist at that ref. */
function gitShow(ref: string, path: string): string | undefined {
  const proc = Bun.spawnSync(["git", "show", `${ref}:${path}`], { stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString() : undefined;
}

function readManifest(ref: string): Manifest {
  /* SAFETY: release-please writes this manifest as one `"<path>": "<version>"` string per package. */
  return JSON.parse(gitShow(ref, ".release-please-manifest.json") ?? "{}") as Manifest;
}

/** Build the block for `tag` from the repository's git history. */
export function blockForTag(tag: string): string {
  const tags = Bun.spawnSync(["git", "tag", "--list", "desktop-v*"])
    .stdout.toString()
    .split("\n")
    .filter(Boolean);
  const previousTag = previousDesktopTag(tag, tags);

  const changelogs = new Map<string, ChangelogSection[]>();
  for (const path of INCLUDED_CHANGELOGS) {
    const file = `${path}/CHANGELOG.md`;
    const current = parseChangelog(gitShow(tag, file) ?? "");
    const previous = previousTag ? parseChangelog(gitShow(previousTag, file) ?? "") : [];
    changelogs.set(titleCase(path.split("/").at(-1)!), newSections(current, previous));
  }

  const moved = movedComponents(readManifest(tag), previousTag ? readManifest(previousTag) : {});
  return renderBlock({ tag, previousTag, changelogs, moved });
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

if (import.meta.main) {
  const tag = argument("--tag");
  const body = readFileSync(argument("--body-file"), "utf8");
  process.stdout.write(spliceBlock(body, blockForTag(tag)));
}
