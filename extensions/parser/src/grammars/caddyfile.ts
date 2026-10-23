/**
 * A TextMate grammar for the Caddyfile, the one language the knowledge-base conventions name that
 * Shiki does not ship.
 *
 * Deliberately small: a Caddyfile has no real syntax tree to highlight, only a column-0 site
 * address, a directive at the start of each line, and arguments that are strings, placeholders,
 * named matchers, durations or paths. That is enough to make a reverse-proxy snippet readable, and
 * every pattern here is plain enough for the JavaScript regex engine the highlighter runs on, which
 * has no Oniguruma-only constructs to lean on.
 *
 * @module @jxsuite/parser/grammars/caddyfile
 * @license MIT
 * @docs framework/site/jx-markdown
 */

import type { LanguageRegistration } from "shiki/core";

export const caddyfile: LanguageRegistration = {
  displayName: "Caddyfile",
  name: "caddyfile",
  patterns: [
    { include: "#comment" },
    { include: "#site-address" },
    { include: "#directive" },
    { include: "#string" },
    { include: "#placeholder" },
    { include: "#matcher" },
    { include: "#duration" },
    { include: "#constant" },
    { include: "#number" },
    { include: "#punctuation" },
  ],
  repository: {
    comment: {
      match: String.raw`(?:^|(?<=\s))#.*$`,
      name: "comment.line.number-sign.caddyfile",
    },
    constant: {
      match: String.raw`\b(?:on|off|true|false|h1|h2|h2c|h3)\b`,
      name: "constant.language.caddyfile",
    },
    directive: {
      /* The first word of a line is a directive or subdirective. A word that carries a dot or a
         colon straight after it (`example.com`, `http://…`) is a site address, not a directive. */
      match: String.raw`^\s*([A-Za-z_][\w]*)(?=\s|$)`,
      captures: { "1": { name: "entity.name.function.directive.caddyfile" } },
    },
    duration: {
      match: String.raw`\b\d+(?:\.\d+)?(?:ns|us|ms|s|m|h|d)\b`,
      name: "constant.numeric.duration.caddyfile",
    },
    matcher: {
      match: String.raw`(?<![\w])@[\w-]+`,
      name: "entity.name.tag.matcher.caddyfile",
    },
    number: {
      match: String.raw`\b\d+(?:\.\d+)?\b`,
      name: "constant.numeric.caddyfile",
    },
    placeholder: {
      match: String.raw`\{[$%]?[\w.>/:-]+\}`,
      name: "constant.other.placeholder.caddyfile",
    },
    punctuation: {
      match: "[{}]",
      name: "punctuation.section.block.caddyfile",
    },
    "site-address": {
      // A column-0 line that opens a block and names a host, a port or a wildcard.
      match: String.raw`^(?=\S)(?:[^\s{#,]*[.:*/][^\s{#,]*)(?:\s*,\s*[^\s{#,]+)*(?=\s*\{\s*$)`,
      name: "entity.name.type.address.caddyfile",
    },
    string: {
      patterns: [
        {
          begin: '"',
          end: '"',
          name: "string.quoted.double.caddyfile",
          patterns: [{ match: String.raw`\\.`, name: "constant.character.escape.caddyfile" }],
        },
        { begin: "`", end: "`", name: "string.quoted.other.caddyfile" },
      ],
    },
  },
  scopeName: "source.caddyfile",
};
