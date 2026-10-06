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
 * read `textContent`.
 *
 * **Attribute values are different, and the rule is stated rather than hidden.** An entity cannot
 * be written into an attribute (the serializer would escape its `&`), and a link's `href` or an
 * image's `src` may legitimately name a template, so those two are left to the page author. The
 * attributes that carry prose are made inert instead: `alt` and `title` (an image's description, a
 * link's tooltip) and `data-title` (a callout's title), by writing a zero-width space between the
 * `$` and the `{`. A note that says "set `${HOME}`" in an image description would otherwise become
 * a binding whose evaluation throws in every visitor's browser, and the page would stop hydrating.
 *
 * Pure: no `node:` imports.
 *
 * @module @jxsuite/parser/inert
 * @license MIT
 * @docs framework/site/jx-markdown
 */

import type { JxElement } from "@jxsuite/schema/types";

/**
 * A content tree. A raw HTML block arrives as a nested array of nodes, so the shape is recursive
 * and every walk over it has to descend into arrays as well as into `children`.
 */
export type ContentNodes = (JxElement | string | ContentNodes)[];

/** HTML-escape text, and spell `${` as `&#36;{` so nothing downstream reads it as a template. */
export function escapeTemplateText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("${", "&#36;{");
}

/** The attributes whose value is prose, so a `${` in one is text and never a binding. */
const PROSE_ATTRIBUTES = ["alt", "title", "data-title"] as const;

/** `${` spelled so an attribute value is not read as a template: a zero-width space splits it. */
export function neutralizeTemplateAttribute(value: string): string {
  return value.replaceAll("${", "$\u200B{");
}

/**
 * Make every `${` in a content tree plain text, in place.
 *
 * @param {ContentNodes} nodes - An entry's `$children`
 */
export function makeTemplatesInert(nodes: ContentNodes): void {
  for (const [i, node] of nodes.entries()) {
    if (typeof node === "string") {
      if (node.includes("${")) {
        nodes[i] = { innerHTML: escapeTemplateText(node), tagName: "span" };
      }
      continue;
    }
    if (Array.isArray(node)) {
      makeTemplatesInert(node);
      continue;
    }
    if (typeof node !== "object" || node === null) {
      continue;
    }
    if (typeof node.textContent === "string" && node.textContent.includes("${")) {
      node.innerHTML = escapeTemplateText(node.textContent);
      delete node.textContent;
    }
    const { attributes } = node;
    if (attributes) {
      for (const name of PROSE_ATTRIBUTES) {
        const value = attributes[name];
        if (typeof value === "string" && value.includes("${")) {
          attributes[name] = neutralizeTemplateAttribute(value);
        }
      }
    }
    if (Array.isArray(node.children)) {
      makeTemplatesInert(node.children as ContentNodes);
    }
  }
}
