/**
 * The extension's grammar, run by the engine VS Code runs it with: `vscode-textmate` over the
 * Oniguruma build VS Code ships. A grammar is a state machine, and reading its rules says little
 * about what a file is painted as, which is how Studio's grammar shipped a raw string that never
 * closed.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { INITIAL, parseRawGrammar, Registry } from "vscode-textmate";
import type { IGrammar } from "vscode-textmate";

/** The workspace's folder. */
export const ROOT = join(import.meta.dir, "..");

/** The grammar's own scope, which every token of a file carries. */
export const SCOPE = "source.jxn";

/**
 * As much of TypeScript's grammar as a block's edges are tested against: a keyword, and a string,
 * which begins at the quote a block ends with and, as TypeScript's does, ends with its line.
 */
const TYPESCRIPT = {
  patterns: [
    { match: String.raw`\bconst\b`, name: "storage.type.ts" },
    { begin: '"', end: '"|$', name: "string.quoted.double.ts" },
  ],
  scopeName: "source.ts",
};

/** One stretch of a line with the scopes it is painted by, the grammar's own left out. */
export type Painted = [text: string, ...scopes: string[]];

/**
 * Load the grammar the manifest contributes.
 *
 * TypeScript's own grammar is stood in for by {@link TYPESCRIPT}: what a block of code holds is
 * `source.ts`'s to say, and what is asked here is where the block begins and ends. It cannot be
 * left out, because the engine drops a rule whose every pattern is a grammar it does not have, and
 * a block is then painted as a one-line raw string that never closed.
 */
export async function loadGrammar(): Promise<IGrammar> {
  const wasm = createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm");
  const bytes = await readFile(wasm);
  const registry = new Registry({
    loadGrammar: async (scopeName) => {
      if (scopeName === "source.ts") {
        return parseRawGrammar(JSON.stringify(TYPESCRIPT), "typescript.tmLanguage.json");
      }
      if (scopeName !== SCOPE) {
        return null;
      }
      const path = join(ROOT, "syntaxes/jxn.tmLanguage.json");
      return parseRawGrammar(await readFile(path, "utf8"), path);
    },
    onigLib: loadWASM(bytes.buffer).then(() => ({ createOnigScanner, createOnigString })),
  });
  const grammar = await registry.loadGrammar(SCOPE);
  if (!grammar) {
    throw new Error("the grammar did not load");
  }
  return grammar;
}

/**
 * Paint a file.
 *
 * @param grammar The grammar.
 * @param text The file.
 * @returns Each line's stretches that are not blank, in order.
 */
export function paint(grammar: IGrammar, text: string): Painted[][] {
  let state = INITIAL;
  return text.split("\n").map((line) => {
    const { ruleStack, tokens } = grammar.tokenizeLine(line, state);
    state = ruleStack;
    return tokens.flatMap((token): Painted[] => {
      const stretch = line.slice(token.startIndex, token.endIndex);
      return stretch.trim() === ""
        ? []
        : [[stretch, ...token.scopes.filter((scope) => scope !== SCOPE)]];
    });
  });
}
