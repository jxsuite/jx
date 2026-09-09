/**
 * Generate `styles/tokens.css` from `styles/tokens.json`.
 *
 * Studio's chrome is authored as Jx documents, and a stylesheet is the one thing that contradicts
 * that — so this file's contents are a Jx style block like any surface's, and the CSS beside it is
 * a BUILD OUTPUT. It is the screenshot policy and the schema policy applied to one more artifact: a
 * generator produces the bytes, and a reviewer reads the meaning.
 *
 * **The stylesheet survives on purpose, and that is the whole design.** Every declaration in
 * `tokens.json` is PRE-PAINT. The kit's own theme is adopted from JavaScript at boot, so the hex
 * fallbacks here — `var(--jx-bg, #111114)` — are what paints the shell before that lands, and the
 * `@font-face` rules are what keep the first frame from being drawn in a fallback face. Moving them
 * into the adopted sheet would delete the thing they exist to be. So the SOURCE moves into the
 * schema and the artifact stays a `<link>`, which is the only arrangement that is both.
 *
 * `bun run tokens:check` is the gate and `bun run tokens:sync` is the fixer, exactly as
 * `schema:verify` / `schema:sync` are for the committed schemas. Never hand-edit `tokens.css`: the
 * fix belongs in `tokens.json`.
 *
 * Run: bun run scripts/build-tokens.ts [--fix]
 */

import { buildStyleRules, splitSelectorList } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SOURCE = "styles/tokens.json";
const OUTPUT = "styles/tokens.css";

/** The header the generated file opens with, so nobody edits the wrong one of the pair. */
const HEADER = `/* GENERATED FILE — do not edit.
   Source: ${SOURCE}. Regenerate with \`bun run tokens:sync\`.

   Studio's global base and semantic token layer. It is a linked stylesheet rather than part of the
   kit's adopted theme because every declaration here is PRE-PAINT: the kit's sheet is adopted from
   JavaScript at boot, so these hex fallbacks are what paints the shell before that lands, and the
   @font-face rules are what keep the first frame out of a fallback face.

   Every --name here is an ALIAS of a kit token (packages/ui/project.json, specs/ui.md §4). The
   fallbacks are the kit's DARK values, because the app boots dark; check-styles.ts holds them to
   the table in specs/studio-ui-guidelines.md §1.1. */
`;

/**
 * One rule per line is unreadable for a 30-declaration `:root`, and this file is the palette — the
 * artifact a reviewer most wants to read in a diff. So each rule is expanded, splitting only on the
 * semicolons that separate declarations: a `;` inside quotes or parentheses belongs to a value.
 *
 * **The shape is oxfmt's, not one of this file's choosing**, and that is a correctness requirement
 * rather than a preference: `bun run format` rewrites every tracked `.css`, so a generator that
 * emitted anything else would be undone by the next format and leave the gate red with nothing
 * wrong. One selector per line is what the formatter does, so the two agree by construction and
 * `tokens:sync` is idempotent under `format`.
 *
 * @param rule One rule's text, as the builder emits it
 * @returns The same rule, one declaration per line
 */
export function expandRule(rule: string): string {
  const open = rule.indexOf("{");
  const close = rule.lastIndexOf("}");
  if (open === -1 || close < open) {
    return rule;
  }
  const prelude = splitSelectorList(rule.slice(0, open).trim()).join(",\n");
  const body = rule.slice(open + 1, close).trim();
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (quote !== "") {
      if (c === "\\") {
        i += 1;
      } else if (c === quote) {
        quote = "";
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === ";" && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  const declarations = parts.filter(Boolean);
  if (declarations.length === 0) {
    return `${prelude} {\n}`;
  }
  return `${prelude} {\n${declarations.map((d) => `  ${d};`).join("\n")}\n}`;
}

/** The stylesheet `tokens.json` means, header and all. */
export function tokensCSS(style: JxStyle): string {
  const rules = buildStyleRules(style, { scope: ":root" }).map((rule) => expandRule(rule.text));
  return `${HEADER}\n${rules.join("\n")}\n`;
}

/** Read the authored block. Exported so a test can read it the way the generator does. */
export async function readSource(root = ROOT): Promise<JxStyle> {
  const doc = (await Bun.file(join(root, SOURCE)).json()) as { style?: JxStyle };
  return doc.style ?? {};
}

/**
 * Compare, or write.
 *
 * @param root The package directory
 * @param fix Write the generated file instead of reporting drift
 * @returns Whether the committed file matches (always true after a fix)
 */
export async function run(root = ROOT, fix = false): Promise<boolean> {
  const wanted = tokensCSS(await readSource(root));
  const path = join(root, OUTPUT);
  const file = Bun.file(path);
  const actual = (await file.exists()) ? await file.text() : "";
  if (actual === wanted) {
    return true;
  }
  if (fix) {
    await Bun.write(path, wanted);
    return true;
  }
  const wantedLines = new Set(wanted.split("\n"));
  const actualLines = new Set(actual.split("\n"));
  const added = [...wantedLines].filter((line) => line.trim() !== "" && !actualLines.has(line));
  const removed = [...actualLines].filter((line) => line.trim() !== "" && !wantedLines.has(line));
  console.error(`❌ ${OUTPUT} does not match ${SOURCE}.`);
  for (const line of removed.slice(0, 12)) {
    console.error(`   - ${line.trim()}`);
  }
  for (const line of added.slice(0, 12)) {
    console.error(`   + ${line.trim()}`);
  }
  if (added.length + removed.length > 24) {
    console.error(`   …and ${added.length + removed.length - 24} more line(s)`);
  }
  console.error(`\nRun \`bun run tokens:sync\`. Never edit ${OUTPUT} by hand.`);
  return false;
}

if (import.meta.main) {
  const ok = await run(ROOT, process.argv.includes("--fix"));
  if (!ok) {
    process.exit(1);
  }
  console.log(`✓ ${OUTPUT} matches ${SOURCE}.`);
}
