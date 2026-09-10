/**
 * Generate Studio's stylesheets from the Jx style blocks that author them.
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
 * Run: bun run scripts/build-styles.ts [--fix]
 */

import { buildStyleRules, splitSelectorList } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** One generated stylesheet: where it is authored, where it lands, and what its rules are scoped to. */
interface Sheet {
  source: string;
  output: string;
  /**
   * The selector every rule hangs off, or `""` for a GLOBAL sheet.
   *
   * `:root` is right for the token layer, which really is the root element's own style. It is wrong
   * for a sheet whose rules address the whole app: a `.pane-tab` key under `:root` resolves to
   * `:root.pane-tab`, which matches nothing, because a class key COMPOUNDS onto its scope. An empty
   * scope emits each selector exactly as written, which is what a global sheet needs and what keeps
   * a migrated rule matching the elements it always did.
   */
  scope: string;
  header: string;
}

/** The header the generated file opens with, so nobody edits the wrong one of the pair. */
const TOKENS_HEADER = `/* GENERATED FILE — do not edit.
   Source: styles/tokens.json. Regenerate with \`bun run styles:sync\`.

   Studio's global base and semantic token layer. It is a linked stylesheet rather than part of the
   kit's adopted theme because every declaration here is PRE-PAINT: the kit's sheet is adopted from
   JavaScript at boot, so these hex fallbacks are what paints the shell before that lands, and the
   @font-face rules are what keep the first frame out of a fallback face.

   Every --name here is an ALIAS of a kit token (packages/ui/project.json, specs/ui.md §4). The
   fallbacks are the kit's DARK values, because the app boots dark; check-styles.ts holds them to
   the table in specs/studio-ui-guidelines.md §1.1.

   The four --canvas-* steps are the exception and are meant to be: they colour surfaces that
   render as a light DOCUMENT in both chromes, so they are mixed from the black and white keywords
   and do not follow the theme. See tokens.json for what else moved here out of styles/spectrum.css. */
`;

const FORCED_COLORS_HEADER = `/* GENERATED FILE — do not edit.
   Source: styles/forced-colors.json. Regenerate with \`bun run styles:sync\`.

   Forced colours (Windows High Contrast, and its equivalents). In that mode the browser replaces
   every author colour with one from the user's palette, and drops background-image and box-shadow
   outright — so every "you are here" affordance drawn with a shadow vanishes silently, and an
   editor where nothing shows what is selected is not a contrast problem to tune but a category of
   affordance the mode deletes. Each is redrawn below with a border or an outline, which forced
   colours keep and recolour, and the system keywords (Highlight, CanvasText, GrayText) resolve to
   whatever palette the user chose rather than to this app's idea of one.

   This file is linked LAST, so it wins a specificity tie without reaching for !important. Its rules
   are emitted UNSCOPED for the same reason they were written that way: each addresses elements
   across the whole app rather than one element's own subtree. */
`;

const SHELL_FRAME_HEADER = `/* GENERATED FILE — do not edit.
   Source: styles/shell-frame.json. Regenerate with \`bun run styles:sync\`.

   The application FRAME: the #app grid, the cells every surface mounts into, the resize handles
   and edges, the collapsed-dock variants, and the four overlay layers.

   It is a linked stylesheet rather than a surface's own style block for the reason tokens.css is
   one: the frame is what the first paint lays out. Its cells are addressed by id because
   TypeScript adopts them (store.ts's initShellRefs) and the overlay API renders into them, so the
   ids are a contract rather than styling — which is also why these rules are emitted UNSCOPED. */
`;

/**
 * Every stylesheet generated from a style block.
 *
 * Each output is also in `.oxfmtrc.json`'s ignore list, and it has to be: a generated file has ONE
 * author. `bun run format` wraps a declaration at its own print width, which this does not, so the
 * two rewrote the same long `grid-template-columns` in turn and left `styles:check` red with
 * nothing wrong. `tests/build-styles.test.ts` holds the two lists equal, since a sheet added here
 * and not there fails that way rather than obviously.
 */
export const SHEETS: readonly Sheet[] = [
  {
    header: TOKENS_HEADER,
    output: "styles/tokens.css",
    scope: ":root",
    source: "styles/tokens.json",
  },
  {
    header: SHELL_FRAME_HEADER,
    output: "styles/shell-frame.css",
    scope: "",
    source: "styles/shell-frame.json",
  },
  {
    header: FORCED_COLORS_HEADER,
    output: "styles/forced-colors.css",
    scope: "",
    source: "styles/forced-colors.json",
  },
];

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
export function expandRule(rule: string, indent = ""): string {
  const open = topLevel(rule, "{");
  if (open === -1) {
    return `${indent}${rule.trim()}`;
  }
  const close = closingBrace(rule, open);
  const prelude = splitSelectorList(rule.slice(0, open).trim()).join(`,\n${indent}`);
  const body = rule.slice(open + 1, close).trim();
  const inner = `${indent}  `;
  /* A body holding a `{` is a WRAPPER — `@media`, or a `@keyframes` and its stops — so it is
     expanded as rules rather than split as declarations. Doing it the other way round is what
     produced `@media (…) { .sel { … }; }`: the inner rule read as one declaration, semicolon and
     all, and the selector list inside it never split. */
  const parts =
    topLevel(body, "{") === -1
      ? splitDeclarations(body).map((declaration) => `${inner}${declaration};`)
      : splitRules(body).map((nested) => expandRule(nested, inner));
  if (parts.length === 0) {
    return `${indent}${prelude} {\n${indent}}`;
  }
  return `${indent}${prelude} {\n${parts.join("\n")}\n${indent}}`;
}

/** Index of `char` outside every quote, paren and brace, or -1. */
function topLevel(text: string, char: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
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
    } else if (c === char && depth === 0) {
      return i;
    } else if (c === "(" || c === "{") {
      depth += 1;
    } else if (c === ")" || c === "}") {
      depth -= 1;
    }
  }
  return -1;
}

/** Index of the `}` closing the `{` at `open`. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
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
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return text.length;
}

/** A wrapper's body split into the whole rules it holds. */
function splitRules(body: string): string[] {
  const rules: string[] = [];
  let at = 0;
  while (at < body.length) {
    const open = topLevel(body.slice(at), "{");
    if (open === -1) {
      break;
    }
    const close = closingBrace(body.slice(at), open);
    rules.push(body.slice(at, at + close + 1).trim());
    at += close + 1;
  }
  return rules.filter(Boolean);
}

/** A rule body split on the semicolons that separate declarations, and no others. */
function splitDeclarations(body: string): string[] {
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
  return parts.filter(Boolean);
}

/**
 * A rule's `$description` as the comment above it, wrapped to something a person reads.
 *
 * This is why the prose mechanism exists at all: the stylesheets being replaced explain each rule,
 * and those sentences are the most valuable thing in them. A migration that moved the declarations
 * and dropped the reasoning would be a loss no gate could see.
 *
 * @param text The block's prose
 * @returns A CSS comment, indented as a block
 */
export function commentOf(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line !== "" && `${line} ${word}`.length > 96) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  if (lines.length === 1) {
    return `/* ${lines[0]} */`;
  }
  return `/* ${lines.join("\n   ")} */`;
}

/** The stylesheet a style block means, header and all. */
export function sheetCSS(style: JxStyle, scope: string, header: string): string {
  const rules = buildStyleRules(style, { scope }).map((rule) =>
    rule.description === undefined
      ? expandRule(rule.text)
      : `${commentOf(rule.description)}\n${expandRule(rule.text)}`,
  );
  return `${header}\n${rules.join("\n")}\n`;
}

/** The stylesheet `tokens.json` means, header and all. */
export function tokensCSS(style: JxStyle): string {
  return sheetCSS(style, ":root", TOKENS_HEADER);
}

/** Read one authored block. Exported so a test can read it the way the generator does. */
export async function readSource(root = ROOT, source = "styles/tokens.json"): Promise<JxStyle> {
  const doc = (await Bun.file(join(root, source)).json()) as { style?: JxStyle };
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
  let ok = true;
  for (const sheet of SHEETS) {
    if (!(await runSheet(root, fix, sheet))) {
      ok = false;
    }
  }
  return ok;
}

/** One sheet's half of {@link run}. */
async function runSheet(root: string, fix: boolean, sheet: Sheet): Promise<boolean> {
  const { header, output: OUTPUT, scope, source } = sheet;
  const wanted = sheetCSS(await readSource(root, source), scope, header);
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
  console.error(`❌ ${OUTPUT} does not match ${source}.`);
  for (const line of removed.slice(0, 12)) {
    console.error(`   - ${line.trim()}`);
  }
  for (const line of added.slice(0, 12)) {
    console.error(`   + ${line.trim()}`);
  }
  if (added.length + removed.length > 24) {
    console.error(`   …and ${added.length + removed.length - 24} more line(s)`);
  }
  console.error(`\nRun \`bun run styles:sync\`. Never edit ${OUTPUT} by hand.`);
  return false;
}

/**
 * The command line: compare or write, say so, and answer with an exit code.
 *
 * A function rather than five statements under `import.meta.main`, because that flag is false for
 * every importer — so the half a person actually reads, the green line naming what matched, was the
 * one half no test could reach. Everything but the exit itself lives here now.
 *
 * @param root The package directory
 * @param argv The invocation, so `--fix` is an argument rather than an ambient fact
 * @returns The process exit code: 0 when every sheet matches (or was just written), 1 on drift
 */
export async function main(root = ROOT, argv: readonly string[] = process.argv): Promise<number> {
  if (!(await run(root, argv.includes("--fix")))) {
    return 1;
  }
  console.log(`✓ ${SHEETS.map((sheet) => sheet.output).join(" and ")} match their sources.`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
