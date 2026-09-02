/**
 * The Markdown formatter: undo the escapes a visual editor leaves behind, and keep every paragraph
 * on one line.
 *
 * Two rules, run as one pass because they answer the same question — _is this file's SOURCE saying
 * something the rendered page does not?_
 *
 * **1. Visual-editor escapes.** A round trip through a WYSIWYG editor rewrites `## 18.` as `##
 * 18\.` and `RESERVED_KEYS` as `RESERVED\_KEYS`. Both render identically, so nothing looks wrong —
 * and one of them cost this repository every one of `spec.md`'s twelve standards rows, because
 * `STANDARDS_HEADING` could no longer find the section and a parser that cannot find a section
 * silently stops checking it.
 *
 * **This cannot undo the damage that matters most.** The same round trip flattens `[RFC
 * 6901](https://…)` to bare `RFC 6901` and `**Adopted**` to `Adopted`, and those URLs are simply
 * gone. Recovering them means `git show` on the last good commit. What this script does is remove
 * the _cosmetic_ residue; what protects the _content_ is `check-standards.ts`, which now reads the
 * section either way and reports the escape as `heading-escaped` precisely because it is the
 * visible symptom of an edit that probably also destroyed something invisible.
 *
 * Both escape rules are deliberately narrow. An escape is only removed where Markdown never needed
 * one: after the number of a numbered heading, and between two word characters. A `\*` in prose, or
 * a leading `\_`, is left alone — those may be load-bearing. Fenced code is skipped entirely, since
 * inside a fence a backslash is content.
 *
 * **2. One line per paragraph.** Source wrapping fights the editor's own soft wrap: soft wrap
 * re-flows to the viewport, a hard-wrapped file is already flowed to somebody else's, and the two
 * interleave into ragged half-width lines that change shape with the window. It also makes prose
 * diffs unreadable — editing a hard-wrapped paragraph re-flows every line after the edit, so a
 * one-word change reads as a five-line change. `lib/unwrap-prose.ts` does the work and its header
 * explains what it will not join; a line break that carries meaning is written as an explicit `\`
 * hard break rather than left to the reader to infer.
 *
 * Oxfmt normalizes plenty of Markdown (`* * *` becomes `---`) but preserves both escapes, and its
 * own `proseWrap: "never"` is unusable here (see `lib/unwrap-prose.ts`). A formatter has no rule
 * system to extend — hence this pass, run beside it.
 *
 * Usage: `bun scripts/normalize-markdown.ts [--check] [paths…]` `bun run format:md` fixes; `bun run
 * docs:markdown` is the CI gate.
 *
 * @docs extending/contributing/docs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { unwrapProse } from "./lib/unwrap-prose.ts";

/** `## 18\.` — the editor is stopping the line re-parsing as an ordered-list item. */
const ESCAPED_HEADING = /^(#{1,6}\s+\d+(?:\.\d+)*[a-z]?)\\\./;

/** `RESERVED\_KEYS` — the editor is stopping the underscore reading as emphasis. Never needed. */
const ESCAPED_INNER_UNDERSCORE = /(\w)\\_(?=\w)/g;

const FENCE = /^\s*(```|~~~)/;

/**
 * Paths the sweep never touches, mirroring `.oxfmtrc.json`'s `ignorePatterns`.
 *
 * A CHANGELOG is written by release-please and a fixture is an exact input: both are files whose
 * bytes belong to something other than a formatter. `vendor/` is the pinned Electrobun SDK, which
 * is a tracked path and therefore ignored by nothing implicitly (see CLAUDE.md).
 */
const NEVER = [/(?:^|\/)CHANGELOG\.md$/, /(?:^|\/)_[a-z_]*fixtures?[a-z_]*\//, /^vendor\//];

export interface NormalizeResult {
  text: string;
  /** 1-based lines that changed, for a `--check` report that points somewhere. */
  lines: number[];
}

/**
 * Remove the escapes a visual Markdown editor inserts.
 *
 * @param {string} source
 * @returns {NormalizeResult}
 */
export function normalizeMarkdown(source: string): NormalizeResult {
  const lines = source.split("\n");
  const changed: number[] = [];
  let inFence = false;

  const out = lines.map((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) {
      return line;
    }
    const next = line.replace(ESCAPED_HEADING, "$1.").replaceAll(ESCAPED_INNER_UNDERSCORE, "$1_");
    if (next !== line) {
      changed.push(i + 1);
    }
    return next;
  });

  return { lines: changed, text: out.join("\n") };
}

/** A table row: opens and closes with a pipe. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The delimiter row under a table's header, which is what fixes its column count. */
const TABLE_DELIM = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Cells in one row, splitting on pipes the author did not escape.
 *
 * `\|` inside a cell is a literal pipe — a spec row writing `popover="auto\|manual"` has one — so a
 * naive split reports a phantom extra column, which is exactly the mistake this rule exists to
 * catch in an edit.
 *
 * @param {string} row
 * @returns {number} The cell count
 */
function cellCount(row: string): number {
  const trimmed = row.trim();
  const inner = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined);
  return inner.split(/(?<!\\)\|/).length;
}

/**
 * Rows whose cell count disagrees with their own table's header.
 *
 * A renderer silently drops the extra cells, so a row edited by a script that split on a `\|` ships
 * a mangled column to the published page and every other gate stays green — `docs:markdown` sees no
 * escape, `docs:links` no broken link, `docs:prose` no banned pattern. That happened to
 * `specs/ui.md`'s element catalogue, which is why this is a rule and not a convention.
 *
 * @param {string} source
 * @returns {number[]} 1-based line numbers
 */
export function tableDefects(source: string): number[] {
  const lines = source.split("\n");
  const bad: number[] = [];
  let inFence = false;
  let columns = 0;
  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (!TABLE_ROW.test(line)) {
      columns = 0;
      continue;
    }
    if (TABLE_DELIM.test(line)) {
      columns = cellCount(line);
      continue;
    }
    if (columns === 0) {
      continue;
    }
    if (cellCount(line) !== columns) {
      bad.push(i + 1);
    }
  }
  return bad;
}

export interface FormatResult {
  text: string;
  /** 1-based lines carrying a visual-editor escape. */
  escaped: number[];
  /** 1-based lines a paragraph wrapped across. */
  wrapped: number[];
}

/**
 * Both rules, in the order they must run: unescaping first, because `## 18\.` is a heading the
 * unwrapper has to recognise as one.
 *
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.wrap] Apply rule 2. Off until the sweep lands — see the header.
 * @returns {FormatResult}
 */
export function formatMarkdown(source: string, options: { wrap?: boolean } = {}): FormatResult {
  const unescaped = normalizeMarkdown(source);
  if (options.wrap === false) {
    return { escaped: unescaped.lines, text: unescaped.text, wrapped: [] };
  }
  const unwrapped = unwrapProse(unescaped.text);
  return { escaped: unescaped.lines, text: unwrapped.text, wrapped: unwrapped.lines };
}

/**
 * Whether this path is the sweep's business.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isFormattable(path: string): boolean {
  return !NEVER.some((re) => re.test(path));
}

/** Files to sweep when none are named: everything tracked, minus what nothing may rewrite. */
async function defaultPaths(): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "*.md"], { stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  const listed = text.trim();
  return listed === "" ? [] : listed.split("\n").filter((path) => isFormattable(path));
}

/** `3, 4, 9` — capped, because a first-run sweep moves a thousand lines in one spec. */
function where(lines: number[]): string {
  return lines.slice(0, 6).join(", ") + (lines.length > 6 ? ", …" : "");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const wrap = !args.includes("--no-wrap");
  const named = args.filter((a) => !a.startsWith("--"));
  const paths =
    named.length > 0 ? named.filter((path) => isFormattable(path)) : await defaultPaths();

  const offenders: { path: string; escaped: number[]; wrapped: number[] }[] = [];
  const malformed: { path: string; rows: number[] }[] = [];
  for (const path of paths) {
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const rows = tableDefects(source);
    if (rows.length > 0) {
      malformed.push({ path, rows });
    }
    const result = formatMarkdown(source, { wrap });
    if (result.escaped.length === 0 && result.wrapped.length === 0) {
      continue;
    }
    offenders.push({ escaped: result.escaped, path, wrapped: result.wrapped });
    if (!check) {
      writeFileSync(path, result.text, "utf8");
    }
  }

  for (const t of malformed) {
    console.log(`malformed table row ${t.path}: line ${where(t.rows)}`);
  }
  if (offenders.length === 0 && malformed.length === 0) {
    console.log(
      wrap
        ? `markdown: ${paths.length} file(s) are clean and write one line per paragraph.`
        : `markdown: ${paths.length} file(s) carry no visual-editor escapes.`,
    );
    return;
  }
  for (const o of offenders) {
    if (o.escaped.length > 0) {
      console.log(`${check ? "escaped" : "unescaped"} ${o.path}: line ${where(o.escaped)}`);
    }
    if (o.wrapped.length > 0) {
      console.log(`${check ? "wrapped" : "unwrapped"} ${o.path}: line ${where(o.wrapped)}`);
    }
  }
  if (malformed.length > 0) {
    console.error(
      `\n${malformed.length} file(s) carry a table row whose cell count differs from its header. ` +
        "A renderer drops the extra cells, and no formatter can guess the intent — fix the row.",
    );
    process.exit(1);
  }
  if (check) {
    const escaped = offenders.filter((o) => o.escaped.length > 0);
    console.error(`\n${offenders.length} file(s) need \`bun run format:md\`.`);
    if (escaped.length > 0) {
      console.error(
        `${escaped.length} of them carry visual-editor escapes; check that those files' links ` +
          "and bold survived the edit that caused them.",
      );
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
