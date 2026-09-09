/**
 * Chat-markdown.ts — memoized markdown rendering for assistant chat messages.
 *
 * Wraps @jxsuite/markup/md-html (sanitized markdown → HTML) with a per-message cache
 * keyed by message id + content length, so re-renders during streaming only re-parse
 * the message that actually grew.
 *
 * The HTML ends up in `[part="md"]`, the assistant surface's island — this app's ONE injection
 * sink — and it goes through the Trusted Types policy on the way THERE, in
 * `surfaces/ai-chat.ts`. md-html already sanitizes — raw HTML dropped, javascript: URLs
 * stripped — and the policy asserts that it did, rather than taking a comment's word for it. A
 * `createHTML` that passed its input through unchanged would satisfy the API and defend nothing.
 *
 * **It returns markup, not a template.** It used to hand back a `TemplateResult` wrapping
 * `unsafeHTML` (which stringified the trusted value straight back again); the assistant is a Jx
 * document now, so the island is filled with a string and the policy runs at the assignment, where
 * a Trusted Types enforcement can actually see it. Nothing about the sanitisation moved.
 *
 * @license MIT
 */

import { markdownToHtml } from "@jxsuite/markup/md-html";

const cache = new Map<string, { len: number; html: string }>();

/**
 * Render a message's markdown content, memoized by message id.
 *
 * @param {string} id - Stable message id (cache key).
 * @param {string} content
 * @returns {string} Sanitized markup, for the island's Trusted Types sink.
 */
export function renderMarkdown(id: string, content: string): string {
  let entry = cache.get(id);
  if (!entry || entry.len !== content.length) {
    entry = { html: markdownToHtml(content), len: content.length };
    cache.set(id, entry);
  }
  return entry.html;
}

/** Drop all cached renders (call on session switch / new chat). */
export function clearMarkdownCache() {
  cache.clear();
}
