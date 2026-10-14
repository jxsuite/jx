/**
 * Md-html — browser-safe markdown → sanitized HTML string
 *
 * Small display pipeline for rendering untrusted markdown (e.g. LLM chat output) as HTML:
 * remark-parse + remark-gfm → remark-rehype (raw HTML disabled) → rehype-sanitize (default schema:
 * strips scripts, event handlers, javascript:/data: URLs) → stringify.
 *
 * Like everything in @jxsuite/markup this module has no node-only imports, so it is safe for the
 * studio bundle. It intentionally produces an HTML _string_, not Jx nodes — use
 * `@jxsuite/parser/markdown` for markdown → Jx document transpilation.
 *
 * @module @jxsuite/markup/md-html
 * @license MIT
 */

import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * A unified attacher: called with `this` bound to the processor and the plugin's optional settings.
 * Its result (a parser, compiler or transformer) is consumed by unified, never by us.
 */
type UnifiedPlugin = (...settings: never[]) => void;

/**
 * Minimal structural surface of the unified processor used here — same rationale as
 * `UnifiedProcessor` in @jxsuite/parser's types (oxlint sees the ESM-only unified types as `any`),
 * plus `processSync` which that shared type doesn't carry.
 */
interface MdHtmlProcessor {
  use: (plugin: UnifiedPlugin) => MdHtmlProcessor;
  processSync: (source: string) => { toString: () => string };
}

/* SAFETY: `unified`, `remark-parse`, `remark-rehype` and `rehype-stringify` are shorthand
   `declare module` entries in the root types.d.ts, so their imports are `any` here. unified@11
   exports `unified` as a callable Processor whose call returns a fresh Processor; that Processor's
   `use(plugin)` returns itself and `processSync(string)` returns a VFile whose toString() yields
   the compiled HTML, which is exactly the MdHtmlProcessor surface. Each of the three plugin
   packages default-exports a unified attacher function taking optional settings, which is the
   UnifiedPlugin shape. */
const processor = (unified as () => MdHtmlProcessor)()
  .use(remarkParse as UnifiedPlugin)
  .use(remarkGfm)
  .use(remarkRehype as UnifiedPlugin)
  .use(rehypeSanitize)
  .use(rehypeStringify as UnifiedPlugin);

/**
 * Convert markdown source to a sanitized HTML string (GFM tables/strikethrough/task lists
 * supported). Raw HTML in the source is dropped, not passed through.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}
