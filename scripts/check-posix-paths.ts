/**
 * Regression guard, generalized: `packages/desktop/tests/posix-paths.test.ts` enforced this
 * convention inside ONE file (`project-session.ts`); this is the same rule over the whole repo.
 *
 * `Bun.Glob(...).scan()`/`.scanSync()` (and, the same way, `node:path`'s `relative()`/`join()`)
 * return paths in the HOST's native separator — forward slash on Linux and macOS, backslash on
 * Windows — while every git-reported path, every `code:`/`spec:` frontmatter value, and every
 * hardcoded ratchet Set in this repo is written with forward slashes, because whoever wrote it was
 * on Linux or macOS and never saw a backslash. A scan result compared or printed without
 * normalizing first silently fails to match on Windows: not an error, just a `Set.has()` or
 * `.endsWith(...)` or `.has(pagePath)` that is always false. Five real instances of exactly this
 * shipped before this gate existed (`check-surface-purity.ts`, `check-icons.ts`,
 * `json-layout.test.ts`, `run-reported.test.ts`'s bare-`.run(` ratchet, and
 * `scripts/docs/check-doc-sync.ts`).
 *
 * CI runs on Linux, where `relative()`/`Bun.Glob` never produce backslashes, so a RUNTIME "no
 * backslash" check would pass vacuously there and catch nothing before it reaches a Windows
 * developer. This is a STATIC check instead — it reads source text, not path values — so it holds
 * on any OS. If it trips, route the flagged variable through `toPosixPath`
 * (`scripts/lib/posix-path.ts` at the repo root, or a package's own `scripts/lib/posix-path.ts` —
 * see that module's doc comment for why there's more than one copy) rather than relaxing the rule.
 *
 * The check: for every `for (const X of Y.scan(...))` / `.scanSync(...)` loop, `X` may not appear
 * anywhere in the loop's own body except as the sole argument to a `toPosix`/`toPosixPath`-named
 * call. That covers both idioms already in use — wrapping `X` at every use, and renaming it once
 * (`const rel = toPosixPath(rawRel)`) and using only the renamed binding afterward, which leaves
 * `X` with zero further occurrences (vacuously fine).
 *
 * Usage: `bun scripts/check-posix-paths.ts` (also run as the integration case in
 * `scripts/check-posix-paths.test.ts`, which is what puts it in the `changes` job's `bun test
 * --isolate scripts` — see CLAUDE.md's "Dependency Autopilot"/testing sections for why `scripts/**`
 * has no coverage workspace of its own).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export interface PosixPathFinding {
  file: string;
  line: number;
  variable: string;
}

const SCAN_LOOP = /for\s*(?:await\s*)?\(\s*const\s+(\w+)\s+of\s+[^;{]*?\.(?:scan|scanSync)\(/g;

/** The matching `}` for the `{` at `openIndex`, or -1 if the braces never balance. */
function matchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Every glob-scan loop in `text` whose bound variable escapes un-normalized. */
export function findingsIn(file: string, text: string): PosixPathFinding[] {
  const findings: PosixPathFinding[] = [];
  for (const match of text.matchAll(SCAN_LOOP)) {
    const ident = match[1]!;
    const headerEnd = match.index! + match[0].length;
    const braceStart = text.indexOf("{", headerEnd - 1);
    if (braceStart === -1) {
      continue; // A single-statement loop body has nothing to check.
    }
    const braceEnd = matchingBrace(text, braceStart);
    if (braceEnd === -1) {
      continue;
    }
    const body = text.slice(braceStart + 1, braceEnd);
    const identRe = new RegExp(`\\b${ident}\\b`, "g");
    const wrapRe = new RegExp(`\\btoPosix(?:Path)?\\(\\s*${ident}\\s*\\)`, "g");
    const allUses = body.match(identRe)?.length ?? 0;
    const wrappedUses = body.match(wrapRe)?.length ?? 0;
    if (allUses > wrappedUses) {
      const line = text.slice(0, match.index!).split("\n").length;
      findings.push({ file, line, variable: ident });
    }
  }
  return findings;
}

/** Every tracked `.ts`/`.tsx` file — `git ls-files` so node_modules, dist and vendor never enter. */
function trackedTsFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** {@link findingsIn}, over every tracked file the real repo has. */
export function scanRepo(): PosixPathFinding[] {
  const findings: PosixPathFinding[] = [];
  for (const file of trackedTsFiles()) {
    // The checker's own fixtures deliberately contain the pattern it looks for as string literals,
    // Not real code — scanning them would be the gate finding itself.
    if (file === "scripts/check-posix-paths.ts" || file === "scripts/check-posix-paths.test.ts") {
      continue;
    }
    const text = readFileSync(`${ROOT}/${file}`, "utf8");
    if (!/\.(?:scan|scanSync)\(/.test(text)) {
      continue; // Cheap skip before the regex engine sees a file with no glob scan at all.
    }
    findings.push(...findingsIn(file, text));
  }
  return findings;
}

/** The report a run prints, and whether it failed — separate so a test can run it without exiting. */
export function report(findings: PosixPathFinding[]): { failed: boolean; lines: string[] } {
  if (findings.length > 0) {
    return {
      failed: true,
      lines: [
        `✗ check-posix-paths: ${findings.length} finding(s)`,
        ...findings.map(
          (f) =>
            `   ${f.file}:${f.line}  \`${f.variable}\` from a glob scan is used before ` +
            `toPosixPath(${f.variable}) — it will silently fail to match a forward-slash ` +
            `comparison on Windows`,
        ),
      ],
    };
  }
  return {
    failed: false,
    lines: ["✓ check-posix-paths: every glob-scan result is normalized before use"],
  };
}

async function main(): Promise<number> {
  const { failed, lines } = report(scanRepo());
  for (const line of lines) {
    console.error(line);
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
