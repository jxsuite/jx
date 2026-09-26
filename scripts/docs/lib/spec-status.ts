// Shared parser for the spec status-marker vocabulary and per-spec release metadata. Used by
// Check-spec-status.ts (enforcement), check-spec-release.ts (the bump gate), spec-bump.ts (the
// Release CLI), and the implementation-status / spec-changelog generators. One canonical parser so
// A machine can read "what is built" and "what changed when" straight from the specs.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The one canonical status vocabulary. */
export const STATUS_VOCAB = ["Implemented", "Partial", "Pending", "Future", "Removed"] as const;
export type Status = (typeof STATUS_VOCAB)[number];

export function isStatus(word: string): word is Status {
  return (STATUS_VOCAB as readonly string[]).includes(word);
}

/**
 * One status claim found in a spec body: a `> **Status: X.**` blockquote, or a table cell that
 * opens with a bold status word (`| **Pending** — stub returns null |`).
 */
export interface StatusMarker {
  status: Status;
  line: number;
  form: "blockquote" | "cell";
}

/** A numbered section and the status marker (if any) that sits under its heading. */
export interface SectionStatus {
  anchor: string; // E.g. "13.1"
  title: string;
  /**
   * The FIRST blockquote marker under the heading. This is the section's status as the
   * implementation-status page and the standards tiers read it, so its meaning does not change:
   * `markers` is where everything else a section says about itself is kept.
   */
  status?: Status;
  line: number;
  /** Heading depth: 2 for `##`, 3 for `###`. */
  depth: number;
  /** Every marker credited to this section, in source order, `status`'s own included. */
  markers: StatusMarker[];
}

/** A heading that holds an in-spec roadmap: work tracking that belongs in plans/, not in a spec. */
export interface RoadmapHeading {
  line: number;
  title: string;
  /** The numbered anchor, when the roadmap is a numbered section. */
  anchor?: string;
}

/**
 * A place in a spec that admits something is not built: a Partial or Pending marker anywhere in a
 * section (its leading blockquote, a later blockquote, a table cell, a second status on a marker
 * line) or in the preamble above the first numbered heading. One item per section.
 */
export interface OpenItem {
  file: string;
  /** Absent for a whole-spec (preamble) marker. */
  anchor?: string;
  title: string;
  status: "Partial" | "Pending";
  /** The first open marker's line. */
  line: number;
  form: "blockquote" | "cell" | "preamble";
  /** True when the section's leading marker (`SectionStatus.status`) is itself open. */
  leading: boolean;
}

/** One release recorded in a spec's `## Changelog` section. */
export interface ChangelogEntry {
  version: string;
  date: string; // ISO YYYY-MM-DD
  summary: string;
  line: number;
}

export interface SpecStatus {
  file: string; // Basename, e.g. "spec.md"
  headerVersion?: string;
  headerStatus?: string; // Raw (may be off-vocab — the checker validates)
  headerUpdated?: string; // ISO YYYY-MM-DD from the **Updated:** line
  footerVersion?: string;
  sections: SectionStatus[];
  /** Markers above the first numbered heading: a claim about the whole spec. */
  preamble: StatusMarker[];
  roadmaps: RoadmapHeading[];
  changelog: ChangelogEntry[]; // Newest first, as written
  /** Legacy / off-vocabulary forms found, for the checker to reject. */
  badForms: { line: number; text: string; reason: string }[];
}

/*
 * The dot after a top-level number is OPTIONAL, because the specs write both forms: `### 12.3
 * Incremental Builds` and `## 13. Internationalization`. Requiring whitespace straight after the
 * number made every `## N.` heading invisible — 141 of them across 13 specs — so a marker under a
 * top-level section was silently credited to the last SUBSECTION above it. `site-architecture.md`
 * §15's "Implemented" was being reported against §14.2, which carries no marker at all.
 * `check-doc-refs.ts:80` has always used `\b` here and resolved the same headings correctly.
 */
/*
 * `\\?` tolerates the backslash a WYSIWYG editor inserts before the dot (`## 18\.`). Same class of
 * bug as the `\b` note above: a heading pattern that fails to match does not report anything, it
 * just stops seeing sections. `check-standards.ts` reports the escape as `heading-escaped`.
 */
export const NUMBERED_HEADING = /^#{2,6}\s+(\d+(?:\.\d+)*[a-z]?)\\?\.?\s+(.*)$/;
const BLOCKQUOTE_STATUS = /^>\s*\*\*Status:\s*([A-Za-z]+)/;
/*
 * `> **Status:** Implemented`: the colon inside the bold and the word outside it. BLOCKQUOTE_STATUS
 * needs a letter straight after `Status:`, so this form was never a marker and never an error
 * either: three sections carried it and read as unmarked on every page that derives from the specs.
 */
const BLOCKQUOTE_STATUS_COLON_OUTSIDE = /^>\s*\*\*Status:\*\*/;
/*
 * A further Partial or Pending on a marker line is a second claim (`**Implemented** for X. **Partial**
 * for Y`). Implemented, Future and Removed prose words are not: "this section said **Future** for as
 * long as…" is history, and only an admission that something is unbuilt changes what is open.
 */
const INLINE_OPEN_STATUS = /\*\*(Partial|Pending)\b[^*]*\*\*/g;
/** A table cell that OPENS with a bold status word. A status word mid-cell is prose. */
const CELL_STATUS = /^\*\*([A-Za-z]+)\b[^*]*\*\*/;
const ANY_HEADING = /^(#{2,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const ROADMAP_TITLE = /\bRoadmap\b/i;
/*
 * Sections whose tables use `**Pending**` as a conformance class (standards.md §3.5), not as an
 * implementation status. Matched on the title so this module stays independent of standards.ts,
 * which imports it.
 */
const CONFORMANCE_TABLE_TITLE = /^(Standards Alignment|Adoption Backlog)$/;
/*
 * The header block is four labelled lines that must stay four lines, so each carries an explicit
 * `\` hard break (see scripts/lib/unwrap-prose.ts). `[^\\]+` stops the value swallowing it; no
 * metadata value contains a backslash.
 */
const HEADER_VERSION = /^\*\*Version:\*\*\s*([^\\]+)/;
const HEADER_STATUS = /^\*\*Status:\*\*\s*([^\\]+)/;
const HEADER_UPDATED = /^\*\*Updated:\*\*\s*([^\\]+)/;
const FOOTER_VERSION = /Specification v([0-9][A-Za-z0-9.-]*)/;
const CHANGELOG_HEADING = /^##\s+Changelog\s*$/;
// `- **<version>** (<YYYY-MM-DD>) — <summary>` (em-dash or hyphen separator).
const CHANGELOG_ENTRY = /^-\s+\*\*([^*]+)\*\*\s*\((\d{4}-\d{2}-\d{2})\)\s*[—-]\s*(.+)$/;

/** Legacy forms the normalization removed; the checker rejects their reintroduction. */
const LEGACY = [
  {
    re: /\*\*Not implemented\*\*/,
    reason: 'use **Pending** (or **Future**), not "**Not implemented**"',
  },
  {
    re: /\*\*Partially implemented\*\*/,
    reason: 'use **Partial**, not "**Partially implemented**"',
  },
  { re: /^>\s*\*\*Current status:/, reason: 'use "> **Status: X.**", not "> **Current status:**"' },
  {
    re: /\(Not Yet Implemented\)/,
    reason: 'drop the heading suffix; add a "> **Status: Pending.**" line',
  },
  { re: /\|\s*Planned\s*\|/, reason: 'use a bold cell "**Pending**", not plain "Planned"' },
];

/** A `MAJOR.MINOR.PATCH` version, optionally a `-draft` prerelease. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  draft: boolean;
  raw: string;
}

/** Parse a spec version string; returns null if it is not `X.Y.Z` (optionally `-draft`). */
export function splitVersion(v: string): ParsedVersion | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(-draft)?$/);
  if (!m) {
    return null;
  }
  return {
    major: Number(m[1]!),
    minor: Number(m[2]!),
    patch: Number(m[3]!),
    draft: Boolean(m[4]),
    raw: v.trim(),
  };
}

/**
 * Compare two spec versions. Negative if a < b, 0 if equal, positive if a > b. A `-draft`
 * Prerelease sorts below the same released tuple (2.1.0-draft < 2.1.0). Returns null if either
 * String is not a valid spec version.
 */
export function compareSpecVersion(a: string, b: string): number | null {
  const pa = splitVersion(a);
  const pb = splitVersion(b);
  if (!pa || !pb) {
    return null;
  }
  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch - pb.patch;
  }
  if (pa.draft === pb.draft) {
    return 0;
  }
  return pa.draft ? -1 : 1;
}

/**
 * The version a bump has to clear: the higher of the working file's and the base branch's.
 *
 * `spec:bump` used to read only the working file, so a branch forked before a release on main saw
 * the old version, minted the next one, and landed a number main had already used — two changelog
 * entries claiming `0.9.31-draft`. Nothing caught it until the merge, where check-spec-status
 * reported it as an ordering fault ("0.9.31-draft is not older than 0.9.31-draft") and unpicking it
 * meant renumbering the header, the footer and every entry above the collision by hand.
 *
 * A null base means no floor: an unfetched ref, a shallow clone, or a spec that does not exist on
 * the base yet because this branch is what adds it.
 */
export function versionFloor(
  local: ParsedVersion,
  base: ParsedVersion | null,
): { version: ParsedVersion; raised: boolean } {
  if (!base) {
    return { version: local, raised: false };
  }
  const raised = (compareSpecVersion(base.raw, local.raw) ?? 0) > 0;
  return { version: raised ? base : local, raised };
}

/** Parse one spec file's status markers and release metadata. */
export function parseSpecFile(path: string, file: string): SpecStatus {
  return parseSpecSource(readFileSync(path, "utf8"), file);
}

/** Split a Markdown table row into trimmed cell texts, honouring `\|` escapes. */
function tableCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/** Parse spec source text (shared by parseSpecFile and callers that already hold the text). */
export function parseSpecSource(source: string, file: string): SpecStatus {
  const lines = source.split("\n");
  const out: SpecStatus = {
    file,
    sections: [],
    preamble: [],
    roadmaps: [],
    changelog: [],
    badForms: [],
  };
  /*
   * The numbered sections enclosing the current line, outermost first. An unnumbered heading ends
   * every section at its depth or deeper, so a marker under `## Appendix C` is not credited to the
   * last numbered section above it, while one under `#### Security Boundary` inside `### 11.4` still
   * is.
   */
  const stack: SectionStatus[] = [];
  let seenNumbered = false;
  let inChangelog = false;
  let inFence = false;

  const credit = (marker: StatusMarker, text: string) => {
    const section = stack.at(-1);
    if (section) {
      section.markers.push(marker);
      if (marker.form === "blockquote" && section.status === undefined) {
        section.status = marker.status;
      }
    } else if (!seenNumbered) {
      out.preamble.push(marker);
    } else {
      out.badForms.push({
        line: marker.line,
        text,
        reason:
          "this status marker belongs to no numbered section: number the heading above it, or move the marker under the section it describes",
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // Header/footer metadata (guards keep the first match; harmless to retry in the changelog).
    const v = line.match(HEADER_VERSION);
    if (v && out.headerVersion === undefined) {
      out.headerVersion = v[1]!.trim();
    }
    const u = line.match(HEADER_UPDATED);
    if (u && out.headerUpdated === undefined) {
      out.headerUpdated = u[1]!.trim();
    }
    const hs = line.match(HEADER_STATUS);
    if (hs && out.headerStatus === undefined && !line.startsWith(">")) {
      out.headerStatus = hs[1]!.trim().replace(/\.$/, "");
    }
    const fv = line.match(FOOTER_VERSION);
    if (fv) {
      out.footerVersion = fv[1]!;
    }

    // The `## Changelog` section ends spec-body scanning; the rest is release metadata.
    if (CHANGELOG_HEADING.test(line)) {
      inChangelog = true;
      stack.length = 0;
      continue;
    }
    if (inChangelog) {
      const ce = line.match(CHANGELOG_ENTRY);
      if (ce) {
        out.changelog.push({
          version: ce[1]!.trim(),
          date: ce[2]!,
          summary: ce[3]!.trim(),
          line: lineNo,
        });
      }
      continue;
    }

    // Legacy forms (e.g. **Not implemented**) are rejected anywhere in the body, fenced or not.
    for (const l of LEGACY) {
      if (l.re.test(line)) {
        out.badForms.push({ line: lineNo, text: line.trim(), reason: l.reason });
      }
    }

    // A fenced block is an example: its headings, markers and cells describe nothing.
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const heading = line.match(ANY_HEADING);
    if (heading) {
      const depth = heading[1]!.length;
      while (stack.length > 0 && stack.at(-1)!.depth >= depth) {
        stack.pop();
      }
      const h = line.match(NUMBERED_HEADING);
      if (h) {
        const section: SectionStatus = {
          anchor: h[1]!,
          title: h[2]!.trim(),
          line: lineNo,
          depth,
          markers: [],
        };
        out.sections.push(section);
        stack.push(section);
        seenNumbered = true;
      }
      if (ROADMAP_TITLE.test(heading[2]!)) {
        out.roadmaps.push({ line: lineNo, title: heading[2]!.trim(), anchor: h?.[1] });
      }
      continue;
    }

    // A bare `**Status:** X` line below the header: the header's form, not a marker's.
    if (seenNumbered && HEADER_STATUS.test(line)) {
      out.badForms.push({
        line: lineNo,
        text: line.trim(),
        reason:
          "a section's status is a blockquote, not a header line: write `> **Status: X.**`, or no parser reads it",
      });
      continue;
    }

    if (BLOCKQUOTE_STATUS_COLON_OUTSIDE.test(line)) {
      out.badForms.push({
        line: lineNo,
        text: line.trim(),
        reason:
          "the colon sits inside the bold, so no parser reads this as a marker: write `> **Status: X.**`",
      });
      continue;
    }

    const bq = line.match(BLOCKQUOTE_STATUS);
    if (bq) {
      const word = bq[1]!;
      if (!isStatus(word)) {
        out.badForms.push({
          line: lineNo,
          text: line.trim(),
          reason: `"${word}" is not in the status vocabulary`,
        });
        continue;
      }
      credit({ status: word, line: lineNo, form: "blockquote" }, line.trim());
      // Everything after the leading marker: a second status on the same line is a second claim.
      const rest = line.slice(bq.index! + bq[0].length);
      for (const m of rest.matchAll(INLINE_OPEN_STATUS)) {
        credit({ status: m[1] as Status, line: lineNo, form: "blockquote" }, line.trim());
      }
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      if (stack.some((s) => CONFORMANCE_TABLE_TITLE.test(s.title))) {
        continue;
      }
      for (const cell of tableCells(line)) {
        const c = cell.match(CELL_STATUS);
        if (c && isStatus(c[1]!)) {
          credit({ status: c[1]!, line: lineNo, form: "cell" }, line.trim());
        }
      }
    }
  }
  return out;
}

/** Partial and Pending are the statuses that admit something is not built. */
export function isOpen(status: Status | undefined): status is "Partial" | "Pending" {
  return status === "Partial" || status === "Pending";
}

/**
 * What a set of markers says is open, or undefined when nothing is. A leading open blockquote is
 * the section's own word for itself; otherwise the section is Pending only when every marker in it
 * is, and Partial when built and unbuilt parts sit side by side.
 */
function openStatusOf(
  markers: StatusMarker[],
  leading?: Status,
): "Partial" | "Pending" | undefined {
  if (!markers.some((m) => isOpen(m.status))) {
    return undefined;
  }
  if (isOpen(leading)) {
    return leading;
  }
  return markers.every((m) => m.status === "Pending") ? "Pending" : "Partial";
}

/** Every open item in a spec, in source order: the preamble first, then one per section. */
export function openItems(spec: SpecStatus): OpenItem[] {
  const items: OpenItem[] = [];
  const preambleStatus = openStatusOf(spec.preamble, spec.preamble[0]?.status);
  if (preambleStatus) {
    const first = spec.preamble.find((m) => isOpen(m.status))!;
    items.push({
      file: spec.file,
      title: "(whole spec)",
      status: preambleStatus,
      line: first.line,
      form: "preamble",
      leading: isOpen(spec.preamble[0]?.status),
    });
  }
  for (const section of spec.sections) {
    const status = openStatusOf(section.markers, section.status);
    if (!status) {
      continue;
    }
    const first = section.markers.find((m) => isOpen(m.status))!;
    items.push({
      file: spec.file,
      anchor: section.anchor,
      title: section.title,
      status,
      line: first.line,
      form: first.form,
      leading: isOpen(section.status),
    });
  }
  return items;
}

/**
 * Parse every spec file in `specsDir` (top-level only; `README.md`, design-notes, and subdirs are
 * Exempt).
 */
export function parseSpecStatuses(specsDir: string): SpecStatus[] {
  return readdirSync(specsDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .toSorted()
    .map((f) => parseSpecFile(join(specsDir, f), f));
}
