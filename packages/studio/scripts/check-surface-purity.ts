/**
 * Coexistence is surface-level (specs/studio-ui-guidelines.md §1, §9.4): a surface is either a lit
 * template over Spectrum or a Jx document over the UI kit, never a mix. Three things would make it
 * a mix, and each is cheap to catch from the source alone:
 *
 * 1. A surface document (`src/surfaces/*.json`) that renders a Spectrum element — the kit is the only
 *    element set a document may use.
 * 2. A lit template that renders a kit element — the migration path is a document, not a tag swap, and
 *    a kit element under lit would need the child-part bridge this design avoids.
 * 3. An adapter (`src/surfaces/*.ts`) that imports lit — an adapter passes state in; its markup is the
 *    document beside it.
 *
 * Usage: `bun --cwd packages/studio scripts/check-surface-purity.ts` (CI's `checks` job).
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { KIT_TAGS } from "@jxsuite/ui";

export interface SourceFile {
  /** Path relative to the package root, forward slashes. */
  path: string;
  text: string;
}

export interface PurityFinding {
  file: string;
  line: number;
  text: string;
}

const SURFACE_JSON = /^src\/surfaces\/.*\.json$/;
const ADAPTER_TS = /^src\/surfaces\/.*\.ts$/;
const STUDIO_TS = /^src\/.*\.ts$/;
const SPECTRUM_TAG = /"tagName":\s*"sp-/;
const LIT_IMPORT = /from\s+["'](?:lit|lit-html)(?:\/[^"']*)?["']/;
const KIT_TAG_IN_TEMPLATE = /<(jx-[a-z0-9-]+)/g;

/**
 * Every violation in the given sources.
 *
 * @param {SourceFile[]} files - The package's `src/**` TypeScript and JSON files
 * @param {readonly string[]} [kitTags] - The kit's tag names; the real ones by default
 * @returns {PurityFinding[]}
 */
export function surfacePurityFindings(
  files: SourceFile[],
  kitTags: readonly string[] = KIT_TAGS,
): PurityFinding[] {
  const kit = new Set(kitTags);
  const findings: PurityFinding[] = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
    if (SURFACE_JSON.test(path)) {
      for (const [i, line] of lines.entries()) {
        if (SPECTRUM_TAG.test(line)) {
          findings.push({
            file: path,
            line: i + 1,
            text: "a surface document renders a Spectrum element; a document may only use the kit (ui.md §5)",
          });
        }
      }
      continue;
    }
    if (!STUDIO_TS.test(path)) {
      continue;
    }
    const adapter = ADAPTER_TS.test(path);
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

if (import.meta.main) {
  const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const findings = surfacePurityFindings(collectSources(root));
  if (findings.length > 0) {
    console.error(`✗ check-surface-purity: ${findings.length} finding(s)`);
    for (const f of findings) {
      console.error(`   ${relative(process.cwd(), resolve(root, f.file))}:${f.line}  ${f.text}`);
    }
    process.exit(1);
  }
  console.log(
    "✓ check-surface-purity: no Spectrum tag in a surface document, no kit tag in a lit template, no lit import in an adapter",
  );
}
