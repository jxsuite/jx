/**
 * Build-time syntax highlighting for fenced code blocks (node-only).
 *
 * A synchronous Shiki core (JavaScript regex engine — no WASM, no async) tokenizes a fixed grammar
 * set (see `getHighlighter` for the list) against a light + dark GitHub theme pair. Tokens are
 * emitted as span elements carrying both colors as CSS custom properties (--shiki-light /
 * --shiki-dark); the page's stylesheet decides which one paints, so highlighting follows the
 * color-scheme contract (spec §9.5) for auto and forced schemes alike.
 *
 * Lives outside the browser-safe transpile module: only the compile-time markdown path
 * (processMarkdown in md.ts) pays for the grammars.
 *
 * @module @jxsuite/parser/highlight
 * @license MIT
 * @docs framework/site/jx-markdown
 */

import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "@shikijs/themes/github-dark-default";
import githubLight from "@shikijs/themes/github-light-default";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import dockerfile from "@shikijs/langs/dockerfile";
import html from "@shikijs/langs/html";
import ini from "@shikijs/langs/ini";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import markdown from "@shikijs/langs/markdown";
import nginx from "@shikijs/langs/nginx";
import nix from "@shikijs/langs/nix";
import php from "@shikijs/langs/php";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import toml from "@shikijs/langs/toml";
import typescript from "@shikijs/langs/typescript";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import type { JxElement } from "@jxsuite/schema/types";
import type { HighlighterCore } from "shiki/core";
import { caddyfile } from "./grammars/caddyfile.ts";

const THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;

let _highlighter: HighlighterCore | null = null;

/** Lazy singleton — grammar/theme setup only runs when a fence is actually highlighted. */
function getHighlighter(): HighlighterCore {
  _highlighter ??= createHighlighterCoreSync({
    engine: createJavaScriptRegexEngine(),
    langs: [
      json,
      jsonc,
      typescript,
      javascript,
      markdown,
      html,
      shellscript,
      css,
      yaml,
      /* The languages a technical knowledge base reaches for next: server config, scripting,
         databases, data files, and patches. They were chosen by reading every fence in a real
         operations vault, and tests/highlight.test.ts tokenizes a sample of each. */
      sql,
      php,
      python,
      ruby,
      nix,
      nginx,
      caddyfile,
      toml,
      ini,
      diff,
      xml,
      dockerfile,
    ],
    themes: [githubLight, githubDark],
  });
  return _highlighter;
}

/**
 * Tokenize a fenced code block into span elements with dual-theme color variables. Returns null for
 * unknown languages (callers keep the plain-text fallback).
 *
 * @param {string} code
 * @param {string} lang - Fence info string (grammar name or registered alias)
 * @returns {(JxElement | string)[] | null}
 */
export function highlightFence(code: string, lang: string): (JxElement | string)[] | null {
  const h = getHighlighter();
  if (!h.getLoadedLanguages().includes(lang)) {
    return null;
  }
  const { tokens } = h.codeToTokens(code, { defaultColor: false, lang, themes: THEMES });
  const out: (JxElement | string)[] = [];
  for (const [i, line] of tokens.entries()) {
    if (i > 0) {
      out.push("\n");
    }
    for (const token of line) {
      const span: JxElement = { tagName: "span", textContent: token.content };
      if (token.htmlStyle && Object.keys(token.htmlStyle).length > 0) {
        span.style = token.htmlStyle as Record<string, string>;
      }
      out.push(span);
    }
  }
  return out;
}

/**
 * Walk a transpiled Jx tree and highlight every `pre > code.language-*` block in place. Unknown
 * languages and bare fences keep their plain textContent.
 *
 * @param {(JxElement | string)[]} nodes
 */
export function highlightCodeBlocks(nodes: (JxElement | string)[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    if (node.tagName === "pre" && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (!child || typeof child !== "object" || child.tagName !== "code") {
          continue;
        }
        const lang = /^language-(\S+)/.exec(child.className ?? "")?.[1];
        const code = child.textContent;
        if (!lang || typeof code !== "string" || code.length === 0) {
          continue;
        }
        const spans = highlightFence(code, lang);
        if (!spans) {
          continue;
        }
        delete child.textContent;
        child.children = spans;
        child.className = `${child.className} shiki`;
      }
      continue;
    }
    if (Array.isArray(node.children)) {
      highlightCodeBlocks(node.children as (JxElement | string)[]);
    }
  }
}
