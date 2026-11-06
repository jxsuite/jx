/**
 * Content rules — the declarative filters a content type can carry: `exclude` (which files are
 * never read), here, and `where` and `hold` (what is kept once frontmatter is known), which live in
 * `@jxsuite/schema/content-query` because Studio has to answer them too and a core package may not
 * import an extension.
 *
 * Both are **data, never code**. A `project.json` is read by Studio, by the dev server and by CI,
 * so a filter that needed `eval` or a function would make every one of those a place that executes
 * the project's text. `exclude` is a list of globs and `where` is a small JSON query, and the
 * grammar of each is closed: an unknown operator is a build error naming the key, never a silent
 * no-match.
 *
 * Pure string and object logic with no `node:` imports, so the same rules answer the loader, a
 * format class's `discover`, the link resolver and any host that wants to preview them.
 *
 * @module @jxsuite/parser/content-rules
 * @license MIT
 * @docs framework/site/content-collections
 */

import { isString } from "@jxsuite/schema/guards";

export { compileHold, compileWhere, readField } from "@jxsuite/schema/content-query";
export type { HoldPredicate, HoldRule, WherePredicate } from "@jxsuite/schema/content-query";

// ─── exclude: globs relative to the source root ─────────────────────────────

/**
 * What an `exclude` list says about a path.
 *
 * `excludedBy` answers "is this FILE excluded, and by which pattern" so a build message can name
 * the rule that hid a document. `excludesDir` answers "is everything below this DIRECTORY
 * excluded", which is what lets a walk skip `node_modules` or `.obsidian` without listing a single
 * file in them.
 */
export interface ExcludeMatcher {
  /** The pattern that excludes `path` (relative to the source root, `/`-separated), if any. */
  excludedBy: (path: string) => string | undefined;
  /** Whether a pattern excludes every file under `dir`, so a walker can prune it. */
  excludesDir: (dir: string) => boolean;
  /** True when there are no patterns, so a caller can skip the work. */
  readonly empty: boolean;
}

/** The answer of a rule that matched nothing. */
const nothing = (): undefined => {};

/** Characters that are syntax in a regular expression and mean nothing special in a glob. */
const REGEXP_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

function escapeRegExp(text: string): string {
  return text.replaceAll(REGEXP_SPECIAL, String.raw`\$&`);
}

/**
 * Expand `{a,b}` alternatives into one pattern per choice (`a/{x,y}.md` → `a/x.md`, `a/y.md`).
 *
 * Nested groups expand recursively and a group with no top-level comma stays literal, as in a
 * shell, so `{}` and `{a}` are not accidentally deleted. A backslash escapes a brace.
 */
export function expandBraces(pattern: string): string[] {
  let depth = 0;
  let open = -1;
  const commas: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
    } else if (ch === "{") {
      if (depth === 0) {
        open = i;
        commas.length = 0;
      }
      depth += 1;
    } else if (ch === "," && depth === 1) {
      commas.push(i);
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && commas.length > 0) {
        const head = pattern.slice(0, open);
        const tail = pattern.slice(i + 1);
        const bounds = [open, ...commas, i];
        const out: string[] = [];
        for (let b = 0; b < bounds.length - 1; b++) {
          const choice = pattern.slice(bounds[b]! + 1, bounds[b + 1]!);
          out.push(...expandBraces(`${head}${choice}${tail}`));
        }
        return out;
      }
    }
  }
  return [pattern];
}

/**
 * The most `*` runs one path segment may carry. A regular expression has no possessive quantifier,
 * so each further run multiplies the work a non-matching name costs (`*a*a*a*a*a*a*a*a*b` against
 * sixty letters took twenty seconds). No real pattern needs more than a couple, and a limit that
 * names the pattern is kinder than a build that appears to hang.
 */
const MAX_STAR_RUNS = 4;

/** One path segment of a glob as a regular-expression source (`*`, `?`, `[...]`, escapes). */
function segmentToRegExp(segment: string): string {
  let out = "";
  let stars = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === "\\" && i + 1 < segment.length) {
      i += 1;
      out += escapeRegExp(segment[i]!);
    } else if (ch === "*") {
      while (segment[i + 1] === "*") {
        i += 1;
      }
      stars += 1;
      if (stars > MAX_STAR_RUNS) {
        throw new TypeError(`more than ${MAX_STAR_RUNS} "*" wildcards in one path segment`);
      }
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const close = segment.indexOf("]", i + 2);
      let body = close === -1 ? "" : segment.slice(i + 1, close);
      let negate = false;
      if (body.startsWith("!") || body.startsWith("^")) {
        negate = true;
        body = body.slice(1);
      }
      if (close === -1 || body === "") {
        // No closing bracket, or nothing inside one: the bracket is an ordinary character.
        out += String.raw`\[`;
      } else {
        // A negated class must not match "/", or `a[!x]b` would reach across directories.
        out += `[${negate ? "^/" : ""}${body.replaceAll("\\", String.raw`\\`)}]`;
        i = close;
      }
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

/** Strip the decorations that do not change what a pattern means. */
function cleanPattern(pattern: string): string {
  let out = pattern.replace(/^\.\//, "").replace(/^\/+/, "");
  // A trailing slash names a directory, so it means "everything below it".
  if (out.endsWith("/")) {
    out += "**";
  }
  return out;
}

/**
 * Compile a glob (already brace-expanded) to an anchored regular expression over a relative path.
 *
 * Semantics, chosen to be predictable rather than shell-like: `*` and `?` stop at `/`, `**` as a
 * whole segment crosses directories, and **dotfiles are ordinary files**. A pattern that should
 * skip `.obsidian/` says so (the pattern `.*` followed by `/**`) instead of relying on a hidden
 * default, because the same glob must behave identically in a vault, a checkout and CI.
 */
export function globToRegExp(pattern: string): RegExp {
  // Adjacent `**` segments mean what one does, and each extra one would multiply the matching work.
  const segments = cleanPattern(pattern)
    .split("/")
    .filter((segment, i, all) => !(segment === "**" && all[i - 1] === "**"));
  let source = "";
  try {
    for (const [i, segment] of segments.entries()) {
      const last = i === segments.length - 1;
      if (segment === "**") {
        source += last ? ".+" : "(?:[^/]+/)*";
      } else {
        source += segmentToRegExp(segment) + (last ? "" : "/");
      }
    }
    return new RegExp(`^${source}$`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`invalid glob "${pattern}": ${reason}`, { cause: error });
  }
}

/** Whether a pattern has a `{` that is never closed (a typo that would otherwise match nothing). */
function hasUnclosedBrace(pattern: string): boolean {
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
    }
  }
  return depth > 0;
}

/**
 * Whether a pattern is a bare name that could be a folder: no wildcard and a last segment with no
 * extension (`internal`, `.obsidian`, `Clients/Acme`, but not `STYLE.md`). Such a pattern names the
 * folder as well as a file of that name, the way `.gitignore` reads it, so `exclude: ["internal"]`
 * does what it says instead of excluding nothing.
 */
function mayNameDirectory(pattern: string): boolean {
  const cleaned = cleanPattern(pattern);
  if (cleaned === "" || /[*?[\\]/.test(cleaned) || cleaned.endsWith("**")) {
    return false;
  }
  const last = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  return !last.slice(1).includes(".");
}

/**
 * Compile an `exclude` list. Throws a readable error for a malformed list so a typo is a build
 * failure naming the pattern rather than a file that quietly stays in.
 *
 * @param {readonly string[]} patterns
 * @returns {ExcludeMatcher}
 */
export function compileExclude(patterns?: readonly string[]): ExcludeMatcher {
  if (patterns === undefined) {
    return { empty: true, excludedBy: nothing, excludesDir: () => false };
  }
  if (!Array.isArray(patterns)) {
    throw new TypeError(`"exclude" must be an array of glob patterns`);
  }
  const files: { pattern: string; re: RegExp }[] = [];
  const dirs: RegExp[] = [];
  let everything = false;
  for (const pattern of patterns) {
    // The list is project.json data, so an entry is checked rather than trusted to be text.
    if (!isString(pattern) || pattern.trim() === "") {
      throw new TypeError(
        `"exclude" entries must be non-empty strings, got ${JSON.stringify(pattern)}`,
      );
    }
    if (pattern.startsWith("!")) {
      throw new TypeError(
        `"exclude" pattern "${pattern}": negated patterns are not supported, list what to exclude instead`,
      );
    }
    if (/^(?:\.\/)?\.\.(?:\/|$)/.test(pattern)) {
      throw new TypeError(
        `"exclude" pattern "${pattern}": patterns are relative to the source directory and cannot climb out of it`,
      );
    }
    if (hasUnclosedBrace(pattern)) {
      throw new TypeError(`"exclude" pattern "${pattern}": a "{" is never closed`);
    }
    for (const expanded of expandBraces(pattern)) {
      files.push({ pattern, re: globToRegExp(expanded) });
      const cleaned = cleanPattern(expanded);
      if (cleaned === "**") {
        everything = true;
      } else if (cleaned.endsWith("/**")) {
        dirs.push(globToRegExp(cleaned.slice(0, -"/**".length)));
      } else if (mayNameDirectory(expanded)) {
        // A bare name excludes the folder of that name too (see mayNameDirectory).
        files.push({ pattern, re: globToRegExp(`${cleaned}/**`) });
        dirs.push(globToRegExp(cleaned));
      }
    }
  }
  return {
    empty: files.length === 0,
    excludesDir: (dir) => everything || dirs.some((re) => re.test(dir)),
    excludedBy: (path) => files.find((f) => f.re.test(path))?.pattern,
  };
}
