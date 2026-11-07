/**
 * Jx Notation in the Code view: a Monarch grammar, with TypeScript inside a multi-line raw string.
 *
 * Multi-line raw strings are where a `.jxn` file keeps code (`spec.md` §22.3), so highlighting one
 * as TypeScript is the common case and not a guess about a particular file.
 *
 * @docs framework/concepts/jxn-files
 */

import type { languages } from "monaco-editor/editor";

/** The language id, as `monacoLangForPath` answers it. */
export const JXN_LANGUAGE_ID = "jxn";

/** Comments and brackets, which is what typing and folding need to know. */
export const JXN_LANGUAGE_CONFIGURATION: languages.LanguageConfiguration = {
  autoClosingPairs: [
    { close: "}", open: "{" },
    { close: ")", open: "(" },
    { close: '"', open: '"' },
  ],
  brackets: [
    ["{", "}"],
    ["(", ")"],
  ],
  comments: { blockComment: ["/*", "*/"], lineComment: "//" },
};

/** The tokenizer. */
export const JXN_MONARCH: languages.IMonarchLanguage = {
  defaultToken: "",
  // Monarch otherwise starts in the first state listed, and these are sorted.
  start: "root",
  tokenizer: {
    blockComment: [
      [/[^/*]+/u, "comment"],
      [/\/\*/u, "comment", "@push"],
      [/\*\//u, "comment", "@pop"],
      [/[/*]/u, "comment"],
    ],
    quoted: [
      [/[^\\"]+/u, "string"],
      [/\\./u, "string.escape"],
      [/"/u, "string", "@pop"],
    ],
    quotedLines: [
      [/"""/u, "string", "@pop"],
      [/\\./u, "string.escape"],
      [/./u, "string"],
    ],
    raw: [
      [/"#+/u, { cases: { "$0==$S2": { next: "@pop", token: "string" }, "@default": "string" } }],
      [/[^"]+/u, "string"],
      [/"/u, "string"],
    ],
    rawLines: [
      [
        /"""#+/u,
        {
          cases: {
            "$0==$S2": { next: "@pop", nextEmbedded: "@pop", token: "string.quote" },
            "@default": "",
          },
        },
      ],
      [/[^"]+/u, ""],
      [/"/u, ""],
    ],
    root: [
      [/\/\/.*$/u, "comment"],
      [/\/\*/u, "comment", "@blockComment"],
      [/\/-/u, "comment"],
      [/\((?:array|fn|object|on|ref)\)/u, "type"],
      [/\([^)\s]*\)/u, "invalid"],
      [/#"""/u, { next: '@rawLines."""#', nextEmbedded: "typescript", token: "string.quote" }],
      [/##+"""/u, { next: '@rawLines."""$0', nextEmbedded: "typescript", token: "string.quote" }],
      [/#+"/u, { next: '@raw."$0', token: "string" }],
      [/"""/u, "string", "@quotedLines"],
      [/"/u, "string", "@quoted"],
      [/#(?:true|false|null|inf|-inf|nan)\b/u, "keyword"],
      [/[-+]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?/u, "number"],
      [/[{};]/u, "delimiter"],
      [/\$[^\s=(){};"]*/u, "keyword"],
      [/[^\s=(){};"#]+(?==)/u, "attribute.name"],
      [/[^\s=(){};"#]+/u, "identifier"],
      [/[=]/u, "delimiter"],
    ],
  },
};

/** The part of Monaco's API registering a language uses. */
export type MonacoLanguages = Pick<
  typeof languages,
  "register" | "setLanguageConfiguration" | "setMonarchTokensProvider"
>;

/**
 * Teach Monaco the language.
 *
 * @param languages `monaco.languages`. Absent under a double of Monaco that has no language API,
 *   and there is nothing to teach then.
 */
export function registerJxnLanguage(languages?: MonacoLanguages): void {
  if (!languages) {
    return;
  }
  languages.register({ extensions: [".jxn"], id: JXN_LANGUAGE_ID });
  languages.setLanguageConfiguration(JXN_LANGUAGE_ID, JXN_LANGUAGE_CONFIGURATION);
  languages.setMonarchTokensProvider(JXN_LANGUAGE_ID, JXN_MONARCH);
}
