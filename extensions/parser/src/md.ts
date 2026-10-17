/**
 * Jxsuite/md — Markdown integration for Jx
 *
 * Provides two exports:
 *
 * - MarkdownFile — Parse a single markdown file (external class for $prototype)
 * - MarkdownCollection — Parse a glob of markdown files as a content collection
 *
 * Built on the unified/remark ecosystem. Converts MDAST to JX node trees via mdastNodeToJx.
 *
 * @module @jxsuite/md
 * @license MIT
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { readFileSync } from "node:fs";
import { DEFAULT_FORMAT_LOCALE } from "@jxsuite/schema/intl";
import { basename, extname, relative, resolve } from "node:path";
import { globSync } from "glob";
import { normalizeAlerts, transformAlerts } from "./alerts.ts";
import { assignHeadingIds, mdastNodeToJx } from "./transpile.ts";
import { highlightCodeBlocks } from "./highlight.ts";
import { makeTemplatesInert } from "./inert.ts";
import type {
  MarkdownFileResult,
  MdastNode,
  UnifiedFile,
  UnifiedPlugin,
  UnifiedProcessor,
} from "./types.ts";
import { isFunction } from "@jxsuite/schema/guards";
import type { ContentFieldValue, JsonObject, JsonValue, JxElement } from "@jxsuite/schema/types";

// ─── Tree utilities (inline to avoid Bun ESM resolution issues with unist-util-*) ──

/**
 * Find the first node of a type in an AST tree, in document (depth-first, pre-order) order.
 *
 * @param {MdastNode} node
 * @param {string} type
 * @returns {MdastNode | null}
 */
function findFirst(node: MdastNode, type: string): MdastNode | null {
  if (node.type === type) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findFirst(child, type);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Serialize an mdast tree to plain text.
 *
 * @param {MdastNode} node
 * @returns {string}
 */
function mdastToString(node: MdastNode): string {
  if (node.value) {
    return node.value;
  }
  if (Array.isArray(node.children)) {
    return node.children.map(mdastToString).join("");
  }
  return "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The unified processor chain, through the hand-written surface `UnifiedProcessor` describes.
 *
 * SAFETY: `unified()` returns a remark-compatible Processor whose `use`, `parse`, `runSync` and
 * `stringify` are the four members `UnifiedProcessor` declares; the assertion only states that
 * surface for a type-aware linter that resolves the package's ESM-only types as `any`.
 */
const createProcessor = unified as () => UnifiedProcessor;

/** Average reading speed. See {@link readingTime} for why this is one number and not a table. */
const WORDS_PER_MINUTE = 200;

/**
 * One segmenter, built once.
 *
 * The locale is fixed rather than the host's: word boundaries are a property of the text, and a
 * word count that changed with the build machine's locale would be the same determinism bug the
 * `Intl` helpers exist to avoid.
 */
const WORD_SEGMENTER = new Intl.Segmenter(DEFAULT_FORMAT_LOCALE, { granularity: "word" });

/** A segment is a word when it carries a letter or a digit. See {@link countWords}. */
const WORD_LIKE = /[\p{L}\p{N}]/u;

/**
 * Count the words in a string by **segmenting** it, not by splitting on whitespace (UAX #29).
 *
 * Splitting on `\s+` assumes a script that puts spaces between its words. Japanese, Chinese and
 * Thai do not, so an entire article in any of them counted as **one word** — and therefore one
 * minute to read, whatever its length. `Intl.Segmenter` applies the Unicode word-boundary rules.
 *
 * **A segment counts when it contains a letter or a digit, rather than when `isWordLike` says so.**
 * That property is what `isWordLike` is defined to mean, but Bun's engine answers `false` for a
 * mixed alphanumeric segment — `w0`, `v3`, `h1` — so trusting it would drop every token of that
 * shape from the count, silently and only for some documents. The predicate is spelled out because
 * it has to be correct on the runtime this actually runs on.
 *
 * This runs in the parser under Bun, so there is no browser-support question to weigh.
 *
 * @param {string} text
 * @returns {number}
 */
function countWords(text: string): number {
  let words = 0;
  for (const { segment } of WORD_SEGMENTER.segment(text)) {
    if (WORD_LIKE.test(segment)) {
      words += 1;
    }
  }
  return words;
}

/**
 * Estimate reading time from the word count.
 *
 * **200 wpm, and the limitation is stated rather than modelled.** Real reading speed varies by
 * script, by density and by reader — a Japanese character carries more than a Latin one, so a
 * per-script table would be more accurate and would also be a table of guesses nobody could verify.
 * One honest constant that the docs name beats a plausible one that they cannot.
 *
 * @param {string} text
 * @returns {number} Minutes (rounded up, minimum 1)
 */
function readingTime(text: string) {
  return Math.max(1, Math.ceil(countWords(text) / WORDS_PER_MINUTE));
}

/**
 * Extract first paragraph as a JX text string from an mdast tree.
 *
 * @param {object} tree - Mdast AST
 * @returns {string} Plain text of first paragraph, or empty string
 */
function extractExcerpt(tree: MdastNode) {
  const firstParagraph = findFirst(tree, "paragraph");
  if (!firstParagraph) {
    return "";
  }
  return mdastToString(firstParagraph);
}

/**
 * Derive an entry slug from a file path. Without a source root (or for files directly at the root),
 * the slug is the basename — the historical behavior every flat collection relies on. Files in
 * subdirectories of the root get path-based slugs with POSIX separators and a trailing `/index` or
 * `/README` (either case, as the link and route rules read them) stripped, so `studio/canvas.md`,
 * `studio/canvas/index.md` and `studio/canvas/README.md` all yield `studio/canvas`: the file a
 * folder shows (on GitHub, in Obsidian) is that folder's entry. Case and spaces in names are kept
 * as written, so `Linux/Swap Configuration.md` is the id `Linux/Swap Configuration`; a collection
 * that wants URL-friendly ids sets `idField` or slugifies in its `route`.
 *
 * @param {string} filePath - Absolute path to the markdown file
 * @param {string} [sourceRoot] - Resolved content-source root directory
 * @returns {string} The entry slug
 */
function deriveSlug(filePath: string, sourceRoot?: string): string {
  if (sourceRoot) {
    const rel = relative(sourceRoot, filePath).split("\\").join("/");
    if (rel && !rel.startsWith("..") && rel.includes("/")) {
      let slug = rel.slice(0, rel.length - extname(rel).length);
      if (/\/(?:index|readme)$/i.test(slug)) {
        slug = slug.slice(0, slug.lastIndexOf("/"));
      }
      return slug;
    }
  }
  return basename(filePath, extname(filePath));
}

/** A frontmatter fence line: `---`, optionally followed by spaces or tabs (micromark's rule). */
const FENCE_LINE = /^---[ \t]*\r?$/;

/**
 * Where a leading frontmatter block ends: the index just past its closing fence line, or 0 when the
 * source does not open with one. Only the cut is decided here; whether the block IS frontmatter is
 * still decided by the same remark plugins {@link processMarkdown} runs.
 */
function frontmatterEnd(source: string): number {
  const firstBreak = source.indexOf("\n");
  if (firstBreak === -1 || !FENCE_LINE.test(source.slice(0, firstBreak))) {
    return 0;
  }
  let start = firstBreak + 1;
  while (start < source.length) {
    const lineEnd = source.indexOf("\n", start);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (FENCE_LINE.test(source.slice(start, end))) {
      return end;
    }
    start = end + 1;
  }
  return 0;
}

/**
 * The parsed frontmatter and slug of a markdown file, without parsing its body.
 *
 * A collection's queries, routes, ids and `where` rules read frontmatter alone, and the body is
 * where the cost is: one knowledge base spent three of its four load seconds highlighting code
 * blocks in articles no request had asked for. The block is parsed by the same plugins
 * {@link processMarkdown} uses, cut off after its closing fence, so the two always agree on what the
 * frontmatter is (specs/parser.md).
 *
 * @param {string} source - Raw markdown string
 * @param {string} filePath - File path (for slug derivation)
 * @param {string} [sourceRoot] - Content-source root; files below it get path-based slugs
 * @returns {{ frontmatter: JsonObject; slug: string }}
 */
export function readFrontmatter(source: string, filePath: string, sourceRoot?: string) {
  const slug = deriveSlug(filePath, sourceRoot);
  const end = frontmatterEnd(source);
  if (end === 0) {
    return { frontmatter: {}, slug };
  }
  /* SAFETY: as in processMarkdown below — the three remark packages are shorthand `declare module`
     entries whose default exports are unified attachers taking optional JSON settings. */
  const processor = createProcessor()
    .use(remarkParse as UnifiedPlugin)
    .use(remarkFrontmatter as UnifiedPlugin, ["yaml"])
    .use(remarkParseFrontmatter as UnifiedPlugin);
  const vfile: UnifiedFile = { data: {} };
  processor.runSync(processor.parse(source.slice(0, end)), vfile);
  /* SAFETY: the same claim processMarkdown makes of the same plugin's output: a mapping parses to
     a JsonObject, and no block gives `{}`. */
  return { frontmatter: (vfile.data.frontmatter ?? {}) as JsonObject, slug };
}

/**
 * Process a single markdown source string into a MarkdownFileResult.
 *
 * Converts the MDAST directly to JX nodes via mdastNodeToJx — no rehype/HTML intermediary.
 *
 * @param {string} source - Raw markdown string
 * @param {string} filePath - File path (for slug derivation)
 * @param {object} config - Processing options
 * @param {boolean} [config.directives] - Enable directive support
 * @param {unknown} [config.directiveOptions] - Directive plugin options
 * @param {string} [config.sourceRoot] - Content-source root; files below it get path-based slugs
 * @param {unknown} [config.alerts] - The content type's `alerts` option: alert type → element name,
 *   or `false` to leave `> [!NOTE]` blockquotes as written. Absent means the built-in callouts.
 * @param {(type: string) => void} [config.onUnknownAlert] - Told of each `[!type]` marker whose
 *   type is not enabled, which stays a blockquote.
 * @returns {MarkdownFileResult}
 */
export function processMarkdown(
  source: string,
  filePath: string,
  config: {
    directives?: boolean;
    directiveOptions?: unknown;
    sourceRoot?: string;
    alerts?: JsonValue;
    onUnknownAlert?: (type: string) => void;
  } = {},
) {
  /* SAFETY: `remark-parse`, `remark-frontmatter` and `remark-parse-frontmatter` are shorthand
     `declare module` entries in the root types.d.ts, so their default imports are `any` here. Each
     package default-exports a unified attacher taking optional JSON settings (remark-frontmatter
     receives the `["yaml"]` preset list), which is the UnifiedPlugin shape. */
  let processor = createProcessor()
    .use(remarkParse as UnifiedPlugin)
    .use(remarkFrontmatter as UnifiedPlugin, ["yaml"])
    .use(remarkParseFrontmatter as UnifiedPlugin)
    .use(remarkGfm);

  if (config.directives || config.directiveOptions) {
    processor = processor.use(remarkDirective);
  }

  const tree = processor.parse(source);
  const vfile: UnifiedFile = { data: {} };
  processor.runSync(tree, vfile);

  // Callouts first, so the excerpt and word count read the alert's own text, not its `[!NOTE]` marker.
  const alerts = normalizeAlerts(config.alerts);
  if (alerts) {
    transformAlerts(tree, alerts, config.onUnknownAlert);
  }

  /* SAFETY: a front-matter block is a YAML mapping by convention, which yaml.parse gives as a
     JsonObject, and no block (or an empty one) gives `{}`. A block that parses to a scalar or a
     list is not a mapping; it is relayed as the result's `frontmatter` unchanged, as it always has
     been, so the claimed object type does not hold for that malformed input. */
  const frontmatter = (vfile.data.frontmatter ?? {}) as JsonObject;
  const plainText = mdastToString(tree);
  const excerpt = extractExcerpt(tree);
  const slug = deriveSlug(filePath, config.sourceRoot);

  const bodyNodes = (tree.children ?? []).filter(
    (n: MdastNode) => n.type !== "yaml" && n.type !== "toml",
  );
  /*
   * SAFETY: `filter(Boolean)` drops the nulls (and empty text), and what remains is an element, a
   * string, or the node array a raw HTML block converts to, kept nested as one element. `$children`
   * is declared flat, and every walk over it handles that nested array: highlightCodeBlocks and
   * assignHeadingIds skip it (it has no `tagName` or `children`), while makeTemplatesInert and the
   * content loader's link and asset passes descend into it as `ContentNodes`.
   */
  const $children = bodyNodes.map((n: MdastNode) => mdastNodeToJx(n)).filter(Boolean) as (
    | JxElement
    | string
  )[];

  // Build-time syntax highlighting: fence text becomes dual-theme token spans in place.
  highlightCodeBlocks($children);

  // One walk assigns deduplicated heading ids AND builds $toc, so rendered anchors and the
  // Table of contents agree by construction (specs/parser.md).
  const toc = assignHeadingIds($children);

  // Last, because the ids and the table of contents above read `textContent`. Text that happens
  // To contain `${` is content, not a template (inert.ts).
  makeTemplatesInert($children);

  return {
    $children,
    $excerpt: excerpt,
    $readingTime: readingTime(plainText),
    $toc: toc,
    $wordCount: countWords(plainText),
    frontmatter,
    path: filePath,
    slug,
  };
}

/**
 * Resolve a dot-notation path within an object.
 *
 * @param {MarkdownFileResult} obj
 * @param {string} path
 * @returns {ContentFieldValue | MarkdownFileResult | undefined}
 */
function getNestedValue(obj: MarkdownFileResult, path: string) {
  let current: ContentFieldValue | MarkdownFileResult | undefined = obj;
  for (const k of path.split(".")) {
    /*
     * SAFETY: `processMarkdown` builds a result out of strings, numbers, node arrays and the JSON
     * frontmatter object, so every key a path steps through holds a content field value, or
     * nothing, which `?.` carries to the end of the path.
     */
    current = (current as Record<string, ContentFieldValue | undefined> | null | undefined)?.[k];
  }
  return current;
}

// ─── Markdown format class (re-exported from browser-safe module) ────────────

export { Markdown } from "./markdown.ts";

// ─── MarkdownCollection ───────────────────────────────────────────────────────

/**
 * Parse a glob of markdown files into a sorted, filterable array. Satisfies the Jx external class
 * contract ($prototype).
 *
 * @example
 *   { "$prototype": "MarkdownCollection", "$src": "@jxsuite/md", "src": "./posts/*.md" }
 */
export class MarkdownCollection {
  config: {
    src: string;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    filter?: (result: MarkdownFileResult) => boolean;
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    basePath?: string;
    directives?: boolean;
  };
  /**
   * @param {object} config
   * @param {string} config.src - Glob pattern or directory path
   * @param {string} [config.sortBy] Default is `'frontmatter.date'`
   * @param {string} [config.sortOrder] Default is `'desc'`
   * @param {number} [config.limit]
   * @param {(result: MarkdownFileResult) => boolean} [config.filter] - Filter function
   * @param {unknown[]} [config.remarkPlugins] Default is `[]`
   * @param {unknown[]} [config.rehypePlugins] Default is `[]`
   * @param {string} [config.basePath] - Base path for resolving glob
   * @param {boolean} [config.directives] - Enable directive support
   */
  constructor(config: {
    src: string;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    filter?: (result: MarkdownFileResult) => boolean;
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    basePath?: string;
    directives?: boolean;
  }) {
    this.config = config;
  }

  /**
   * Glob files, parse each, sort, filter, and limit.
   *
   * @returns {Promise<MarkdownFileResult[]>} Array of MarkdownFileResult
   */
  async resolve() {
    const {
      src,
      sortBy = "frontmatter.date",
      sortOrder = "desc",
      limit,
      filter,
      basePath,
      ...processorConfig
    } = this.config;

    const resolved = basePath ? resolve(basePath, src) : src;
    // Normalize to forward slashes — glob requires POSIX paths on all platforms
    const pattern = resolved.split("\\").join("/");
    // SAFETY: with `absolute: true` and no `withFileTypes`, `globSync` returns the matched paths as strings.
    const files = (globSync as (p: string, o: { absolute: boolean }) => string[])(pattern, {
      absolute: true,
    });

    const results = files.map((filePath: string) => {
      const source = readFileSync(filePath, "utf8");
      return processMarkdown(source, filePath, processorConfig);
    });

    // Filter
    let filtered = results;
    if (isFunction(filter)) {
      filtered = results.filter((r: MarkdownFileResult) => filter(r));
    }

    // Sort
    filtered.sort((a: MarkdownFileResult, b: MarkdownFileResult) => {
      const aVal = getNestedValue(a, sortBy) ?? "";
      const bVal = getNestedValue(b, sortBy) ?? "";
      if (aVal < bVal) {
        return sortOrder === "asc" ? -1 : 1;
      }
      if (aVal > bVal) {
        return sortOrder === "asc" ? 1 : -1;
      }
      return 0;
    });

    // Limit
    if (limit && limit > 0) {
      return filtered.slice(0, limit);
    }

    return filtered;
  }
}

// ─── Jx Markdown Transpiler (re-exported from browser-safe module) ──────────

export {
  expandDotPaths,
  collapseDotPaths,
  expandStylePaths,
  collapseStylePaths,
  applyStyleKeyMapping,
  isJxMarkdown,
  transpileJxMarkdown,
  mdastNodeToJx,
  convertChildren,
  jxKey,
  mdKey,
} from "./transpile.ts";
