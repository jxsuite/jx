/**
 * Every `§` citation in a workspace with a home spec resolves to a numbered heading that exists.
 *
 * A bare `§6.2` in `packages/studio` means `specs/studio.md` §6.2: that is the convention, and it
 * is the only reading under which a bare citation can be checked at all. It was not always true.
 * `packages/studio/UX-REDESIGN-PLAN.md` numbered its own sections, the code cited them bare for a
 * year, and when the plan was deleted about a thousand comments were left pointing at a document
 * nobody could open, most of them at numbers `studio.md` also has, with different content. The
 * cleanup that resolved them made the convention true; this gate keeps it true:
 *
 * - A bare `§X` resolves in the workspace's home spec.
 * - A qualified `name.md §X` (also `specs/name.md`, a backticked or linked file name, and a chain
 *   like `§5.1–§5.3`) resolves in THAT spec, when `name.md` is a spec.
 * - A circled region numeral (①–⑬) does not appear: it numbered the deleted plan's region table, and
 *   no spec numbers regions. Name the region.
 *
 * A `§` after an external standard's name (`RFC 9457 §3`, `HTML §4.10`) is that standard's and is
 * not judged. Phrases of the form "plan §N" are refused by `bun run plans:check`.
 *
 * Usage: bun scripts/docs/check-section-refs.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { NUMBERED_HEADING } from "./lib/spec-status.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** Workspaces whose bare `§` has a home spec. Grows one workspace at a time, each made true first. */
export const HOME_SPECS: Readonly<Record<string, string>> = {
  "packages/studio": "studio.md",
};

/** Build outputs and history: their bytes are written by a generator or by release-please. */
const SKIP = [
  /(?:^|\/)CHANGELOG\.md$/,
  /\.schema\.json$/,
  /^packages\/studio\/styles\/(?:shell-frame|tokens|forced-colors)\.css$/,
  /(?:^|\/)node_modules\//,
  /(?:^|\/)dist\//,
];
const EXTENSIONS = new Set([".ts", ".js", ".json", ".css", ".md", ".html"]);

const REF = /§\s?(\d+(?:\.\d+)*[a-z]?)/g;
/** The chain of citations immediately before a `§`: `§5.1–`, `§6, `, `§3 and `. */
const CHAIN = /(?:§\s?\d+(?:\.\d+)*[a-z]?[',’s]*\s*(?:,|–|-|—|and|or|\/|to|&)?\s*)+$/;
/** `studio.md`, `` `ui.md` ``, `specs/desktop.md`, `[ui.md](./ui.md)`, `ui.md#3` before the `§`. */
const SPEC_QUALIFIER = /([\w.-]+)\.md(?:\]\([^)]*\))?[`'"*]*\)?[,:]?\s*$/;
/** A standard or external document named just before the `§`. */
const EXTERNAL_QUALIFIER =
  /\b(?:RFC|BCP|STD|ECMA-?\d*|ECMAScript|HTML|CSS[\w -]*|WCAG|ARIA|WAI-ARIA|UAX|UTS|ISO|IEC|IETF|W3C|WHATWG|DOM|URL|Fetch|Infra|JSON Schema|TC39|OpenAPI|SemVer|CommonMark|GFM|YAML|Unicode|RFC\s*\d+)\b[\w .:#-]{0,24}$/;
const REGION_NUMERAL = /[①-⑬]/;
/** Nothing but a comment leader (and whitespace) before the `§` on its line. */
const COMMENT_LEADER = /^\s*(?:\*|\/\/|#|<!--)?\s*[([]?$/;

export interface SectionRefViolation {
  path: string;
  line: number;
  message: string;
}

export interface SectionRefsInput {
  /** Files to judge, as `{path, text}` with repository-relative paths. */
  files: readonly { path: string; text: string }[];
  /** Spec file name → the anchors of its numbered headings. */
  anchors: ReadonlyMap<string, ReadonlySet<string>>;
  homes?: Readonly<Record<string, string>>;
}

/** The anchors of every numbered heading in a spec's source (the Changelog excluded). */
export function specAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of source.split("\n")) {
    if (/^##\s+Changelog\s*$/.test(line)) {
      break;
    }
    const heading = line.match(NUMBERED_HEADING);
    if (heading) {
      anchors.add(heading[1]!);
    }
  }
  return anchors;
}

function homeOf(path: string, homes: Readonly<Record<string, string>>): string | undefined {
  const workspace = Object.keys(homes).find((w) => path === w || path.startsWith(`${w}/`));
  return workspace === undefined ? undefined : homes[workspace];
}

/** Every violation across `files`. Pure: the CLI reads the tree, the tests hand in fixtures. */
export function checkSectionRefs(input: SectionRefsInput): SectionRefViolation[] {
  const homes = input.homes ?? HOME_SPECS;
  const out: SectionRefViolation[] = [];
  for (const { path, text } of input.files) {
    const home = homeOf(path, homes);
    if (!home) {
      continue;
    }
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      const at = { path, line: i + 1 };
      if (REGION_NUMERAL.test(line)) {
        out.push({
          ...at,
          message:
            "a circled region numeral numbered the deleted UX plan's region table, and no spec numbers regions: name the region",
        });
      }
      for (const m of line.matchAll(REF)) {
        const anchor = m[1]!;
        let before = line.slice(0, m.index).replace(CHAIN, "");
        /*
         * A formatter re-wraps a comment paragraph wherever the width falls, so a spec's file name
         * can end one line and its `§12.2` open the next. A `§` with nothing but a comment leader
         * before it takes its qualifier from the end of the line above.
         */
        if (COMMENT_LEADER.test(before) && i > 0) {
          before = lines[i - 1]!.replace(CHAIN, "");
        }
        if (EXTERNAL_QUALIFIER.test(before)) {
          continue;
        }
        const qualified = before.match(SPEC_QUALIFIER);
        const spec = qualified ? `${qualified[1]}.md` : home;
        const known = input.anchors.get(spec);
        if (!known) {
          // `name.md` that is not a spec (a README, a docs page): nothing to resolve against.
          continue;
        }
        if (!known.has(anchor)) {
          out.push({
            ...at,
            message: qualified
              ? `${spec} has no numbered section §${anchor}`
              : `a bare §${anchor} here means ${home} §${anchor}, which does not exist: cite the section that holds the rule, qualified if it is in another spec (\`studio-ui-guidelines.md §12.2\`)`,
          });
        }
      }
    }
  }
  return out;
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const path = `${rel}/${name}`;
    if (SKIP.some((re) => re.test(`${path}/`) || re.test(path))) {
      continue;
    }
    if (statSync(abs).isDirectory()) {
      walk(abs, path, out);
    } else if (EXTENSIONS.has(extname(name))) {
      out.push(path);
    }
  }
}

/** The gate's input for the repository at `root`. */
export function loadSectionRefsInput(root = ROOT): SectionRefsInput {
  const specsDir = join(root, "specs");
  const anchors = new Map<string, Set<string>>();
  for (const file of readdirSync(specsDir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    const source = readFileSync(join(specsDir, file), "utf8");
    anchors.set(file, specAnchors(source));
  }
  const paths: string[] = [];
  for (const workspace of Object.keys(HOME_SPECS)) {
    walk(join(root, workspace), workspace, paths);
  }
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const files = paths.map((path) => ({ path, text: read(path) }));
  return { files, anchors };
}

if (import.meta.main) {
  const violations = checkSectionRefs(loadSectionRefsInput());
  if (violations.length > 0) {
    for (const x of violations) {
      console.error(`${x.path}:${x.line} ${x.message}`);
    }
    console.error(`\n${violations.length} unresolvable section citation(s).`);
    process.exit(1);
  }
  const scope = Object.entries(HOME_SPECS)
    .map(([w, s]) => `${w} → ${s}`)
    .join(", ");
  console.log(`section refs: every § citation resolves (${scope}).`);
}
