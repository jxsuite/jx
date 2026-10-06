/**
 * Inert — making template-looking text in Markdown content stay text.
 *
 * Jx treats any string that contains `${` as a template and evaluates it, at build time and again
 * in the browser (`isTemplateString`, `@jxsuite/schema/guards`). That is the right rule for a
 * document an author wrote, and the wrong one for content: the body of a Markdown entry is prose
 * and code samples, and a JavaScript template literal, a shell `${HOME}` or a GitHub Actions `${{
 * secrets.TOKEN }}` in a fence is **text to show**, not an expression to run. Left alone, a
 * highlighted fence containing `${` had its tokens turned into reactive bindings whose value is
 * whatever the page's state says (usually nothing), so the sample silently lost the very code it
 * was there to show.
 *
 * The framework's own guidance for content that reaches the tree is to escape `${` first (spec.md
 * §21.1), and the compiler already has an idiom for it: it writes `&#36;{` into `innerHTML` so "the
 * compile phase won't re-interpret" the result as a template. This module applies that idiom at the
 * source, to the one producer that knows its text is content. A node whose `textContent` holds `${`
 * gets the same text as HTML-escaped `innerHTML`, and a bare string child holding `${` becomes a
 * `span` doing the same, so every other part of the pipeline sees nothing it could mistake for a
 * template.
 *
 * It runs last, after heading ids and the table of contents are built from the text, because those
 * read `textContent`. Attribute values are not touched: an entity cannot be written into one.
 *
 * Pure: no `node:` imports.
 *
 * @module @jxsuite/parser/inert
 * @license MIT
 * @docs framework/site/jx-markdown
 */

import type { JxElement } from "@jxsuite/schema/types";

/** HTML-escape text, and spell `${` as `&#36;{` so nothing downstream reads it as a template. */
export function escapeTemplateText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("${", "&#36;{");
}

/**
 * Make every `${` in a content tree plain text, in place.
 *
 * @param {(JxElement | string)[]} nodes - An entry's `$children`
 */
export function makeTemplatesInert(nodes: (JxElement | string)[]): void {
  for (const [i, node] of nodes.entries()) {
    if (typeof node === "string") {
      if (node.includes("${")) {
        nodes[i] = { innerHTML: escapeTemplateText(node), tagName: "span" };
      }
      continue;
    }
    if (typeof node !== "object" || node === null) {
      continue;
    }
    if (typeof node.textContent === "string" && node.textContent.includes("${")) {
      node.innerHTML = escapeTemplateText(node.textContent);
      delete node.textContent;
    }
    if (Array.isArray(node.children)) {
      makeTemplatesInert(node.children as (JxElement | string)[]);
    }
  }
}
