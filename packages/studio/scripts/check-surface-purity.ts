/**
 * A surface is ONE substrate (specs/studio-ui-guidelines.md §1, §9.4): a Jx document over the UI
 * kit, with lit reserved for the overlay layers, the canvas realm and the grid's cell editors. Two
 * things would blur that, and each is cheap to catch from the source alone:
 *
 * 1. A lit template that renders a kit element — the migration path is a document, not a tag swap, and
 *    a kit element under lit would need the child-part bridge this design avoids.
 * 2. An adapter (`src/surfaces/*.ts`) that imports lit — an adapter passes state in; its markup is the
 *    document beside it.
 * 3. A specimen (`src/surfaces/*.specimen.ts`) that imports a value from anywhere but the reactivity
 *    primitives and the specimen contract: its chunk runs in the canvas frame.
 *
 * **There were three, and the third is retired rather than kept as a matcher over a dead string.**
 * It failed on a surface document whose `tagName` began `sp-`, because a document could only use
 * the kit while Adobe Spectrum still drew half the app. Spectrum is removed, and two other gates
 * cover between them what that rule did — in both directions rather than one. `check-styles.ts`
 * bans `sp-` anywhere in the package, document or not, with an allow-list that is empty on purpose;
 * and `check-icons.ts` fails on a `"tagName": "jx-*"` the kit will not define, which is the general
 * form of "a document may only name an element that exists" that the old rule only ever asked about
 * one library. A third copy pointed at a string that can no longer appear would read as a live
 * constraint on a dead subject.
 *
 * Usage: `bun --cwd packages/studio scripts/check-surface-purity.ts` (CI's `checks` job).
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { KIT_TAGS } from "@jxsuite/ui";
import type { CliReport } from "../../../scripts/lib/cli-report.ts";
import type { Finding } from "./check-styles.ts";
import { toPosixPath } from "./lib/posix-path";

export interface SourceFile {
  /** Path relative to the package root, forward slashes. */
  path: string;
  text: string;
}

const ADAPTER_TS = /^src\/surfaces\/.*\.ts$/;
const STUDIO_TS = /^src\/.*\.ts$/;
const LIT_IMPORT = /from\s+["'](?:lit|lit-html)(?:\/[^"']*)?["']/;
const KIT_TAG_IN_TEMPLATE = /<(jx-[a-z0-9-]+)/g;
const SPECIMEN_TS = /^src\/surfaces\/.*\.specimen\.ts$/;
/**
 * An import: the clause between the keyword and the module (empty for a side-effect import, a
 * parenthesis for a dynamic one), and the module it names.
 */
const IMPORT_STATEMENT =
  /\bimport(\s*\(\s*|\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?)["']([^"']+)["']/g;
/** A clause that begins `type`: the whole statement is erased. */
const TYPE_ONLY = /^\s+type\s/;
/** The modules a specimen may import a VALUE from: the reactivity primitives and the contract. */
const SPECIMEN_VALUE_IMPORTS: ReadonlySet<string> = new Set(["../reactivity", "./specimen"]);

/**
 * A specimen that imports a value from the shell (studio-ui-guidelines.md §9.4).
 *
 * A specimen's chunk is loaded by the canvas frame, where there is no shell: an adapter imports the
 * store, the registry and the workspace, and a specimen that imported its adapter would carry all
 * of it into the frame. The bundler would not object, so this does. A type import is erased and
 * costs nothing, which is how a specimen is typed against its adapter's scope.
 *
 * @param {SourceFile} file - One `src/surfaces/*.specimen.ts` source
 * @returns {Finding[]}
 */
function specimenImportFindings({ path, text }: SourceFile): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(IMPORT_STATEMENT)) {
    // Both groups take part in every match, so neither is ever absent.
    const clause = String(match[1]);
    const source = String(match[2]);
    if (!TYPE_ONLY.test(clause) && !SPECIMEN_VALUE_IMPORTS.has(source)) {
      findings.push({
        file: path,
        line: text.slice(0, match.index).split("\n").length,
        text: `a specimen imports a value from "${source}"; import the adapter's types only, since its chunk runs in the canvas frame, where there is no shell`,
      });
    }
  }
  return findings;
}

/**
 * Every violation in the given sources.
 *
 * @param {SourceFile[]} files - The package's `src/**` TypeScript and JSON files
 * @param {readonly string[]} [kitTags] - The kit's tag names; the real ones by default
 * @returns {Finding[]}
 */
export function surfacePurityFindings(
  files: SourceFile[],
  kitTags: readonly string[] = KIT_TAGS,
): Finding[] {
  const kit = new Set(kitTags);
  const findings: Finding[] = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
    if (!STUDIO_TS.test(path)) {
      continue;
    }
    const adapter = ADAPTER_TS.test(path);
    if (SPECIMEN_TS.test(path)) {
      findings.push(...specimenImportFindings({ path, text }));
    }
    for (const [i, line] of lines.entries()) {
      if (adapter && LIT_IMPORT.test(line)) {
        findings.push({
          file: path,
          line: i + 1,
          text: "an adapter imports lit; a surface's markup is the document beside it",
        });
      }
      for (const match of line.matchAll(KIT_TAG_IN_TEMPLATE)) {
        if (kit.has(match[1]!)) {
          findings.push({
            file: path,
            line: i + 1,
            text: `a lit template renders the kit element <${match[1]}>; migrate the surface as a document instead of swapping the tag`,
          });
        }
      }
    }
  }
  return findings;
}

/** Read every `src/**` TypeScript and JSON file under a package root. */
export function collectSources(root: string): SourceFile[] {
  const glob = new Bun.Glob("src/**/*.{ts,json}");
  return [...glob.scanSync({ cwd: root })].toSorted().map((path) => ({
    path: path.replaceAll("\\", "/"),
    text: readFileSync(resolve(root, path), "utf8"),
  }));
}

/**
 * The report a run prints and whether it failed. Separate from `import.meta.main` so a test can run
 * it, where a `process.exit` inside the block is something nothing can.
 *
 * @param {Finding[]} findings
 * @param {string} root - The package root the findings are relative to
 * @returns {CliReport}
 */
export function report(findings: Finding[], root: string): CliReport {
  if (findings.length > 0) {
    return {
      failed: true,
      lines: [
        `✗ check-surface-purity: ${findings.length} finding(s)`,
        ...findings.map(
          (f) =>
            `   ${toPosixPath(relative(process.cwd(), resolve(root, f.file)))}:${f.line}  ${f.text}`,
        ),
      ],
    };
  }
  return {
    failed: false,
    lines: [
      "✓ check-surface-purity: no kit tag in a lit template, no lit import in an adapter, no shell import in a specimen",
    ],
  };
}

/**
 * Collect, judge, print, and hand back the exit code.
 *
 * Separate from the `import.meta.main` block for the reason `check-icons.ts` and `check-styles.ts`
 * give at their own entry points: a function that RETURNS the code is one a test can run, where a
 * `process.exit` inside the block is one nothing can. It became worth extracting when this file
 * lost its Spectrum rule — the module got smaller, the four unreachable lines did not, and a file's
 * coverage floor is a ratio.
 *
 * @param {string} [root] Default is the package root this script sits in
 * @returns {number} 0 when the package is pure, 1 when it is not
 */
export function runCli(root = resolve(import.meta.dir, "..")): number {
  const { failed, lines } = report(surfacePurityFindings(collectSources(root)), root);
  console.log(lines.join("\n"));
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exit(runCli());
}
