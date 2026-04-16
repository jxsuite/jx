/**
 * jxplatform/md — Markdown integration for Jx
 *
 * Provides three exports:
 *   - MarkdownFile       — Parse a single markdown file (external class for $prototype)
 *   - MarkdownCollection — Parse a glob of markdown files as a content collection
 *   - MarkdownDirective  — Remark plugin mapping directives to custom element tags
 *
 * Built on the unified/remark/rehype ecosystem. No framework dependency.
 *
 * @module @jxplatform/md
 * @license MIT
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { readFileSync } from "node:fs";
import { basename, extname, resolve as resolvePath } from "node:path";
import { globSync } from "glob";

// ─── Tree utilities (inline to avoid Bun ESM resolution issues with unist-util-*) ──

/**
 * Walk an AST tree, calling visitor for nodes matching the given type.
 *
 * @param {any} tree
 * @param {string | function} typeOrVisitor
 * @param {function} [maybeVisitor]
 */
function visit(tree, typeOrVisitor, maybeVisitor) {
  const type = typeof typeOrVisitor === "string" ? typeOrVisitor : null;
  const visitor = type ? maybeVisitor : typeOrVisitor;

  function walk(/** @type {any} */ node) {
    if (!node || typeof node !== "object") return;
    if (!type || node.type === type) /** @type {Function} */ (visitor)(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
}

/**
 * Serialize an mdast tree to plain text.
 *
 * @param {any} node
 * @returns {string}
 */
function mdastToString(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.value) return node.value;
  if (Array.isArray(node.children)) return node.children.map(mdastToString).join("");
  return "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Estimate reading time based on word count (~200 wpm average).
 *
 * @param {string} text
 * @returns {number} Minutes (rounded up, minimum 1)
 */
function readingTime(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/**
 * Extract table of contents entries from an mdast tree.
 *
 * @param {object} tree - Mdast AST
 * @returns {{ depth: number; text: string; id: string }[]}
 */
function extractToc(tree) {
  /** @type {{ depth: number; text: string; id: string }[]} */
  const entries = [];
  visit(tree, "heading", (/** @type {any} */ node) => {
    const text = mdastToString(node);
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    entries.push({ depth: node.depth, text, id });
  });
  return entries;
}

/**
 * Extract first paragraph as HTML excerpt from an mdast tree.
 *
 * @param {object} tree - Mdast AST
 * @returns {Promise<string>} HTML string of first paragraph, or empty string
 */
async function extractExcerpt(tree) {
  /** @type {any} */
  let firstParagraph = null;
  visit(tree, "paragraph", (/** @type {any} */ node) => {
    if (!firstParagraph) firstParagraph = node;
  });
  if (!firstParagraph) return "";
  const excerptTree = { type: "root", children: [firstParagraph] };
  const result = await unified()
    .use(remarkRehype)
    .use(rehypeStringify)
    .stringify(
      /** @type {any} */ (await unified().use(remarkRehype).run(/** @type {any} */ (excerptTree))),
    );
  return String(result);
}

/**
 * Build the unified processing pipeline with standard plugins.
 *
 * @param {object} config
 * @param {any} [config.directiveOptions]
 * @param {any[]} [config.remarkPlugins]
 * @param {any[]} [config.rehypePlugins]
 * @returns {any} Unified processor
 */
function buildProcessor(config = {}) {
  let processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkParseFrontmatter)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(/** @type {any} */ (MarkdownDirective), config.directiveOptions ?? {});

  for (const plugin of config.remarkPlugins ?? []) {
    processor = Array.isArray(plugin) ? processor.use(plugin[0], plugin[1]) : processor.use(plugin);
  }

  processor = processor.use(remarkRehype, { allowDangerousHtml: true });

  for (const plugin of config.rehypePlugins ?? []) {
    processor = Array.isArray(plugin) ? processor.use(plugin[0], plugin[1]) : processor.use(plugin);
  }

  processor = /** @type {any} */ (
    processor.use(rehypeStringify, /** @type {any} */ ({ allowDangerousHtml: true }))
  );

  return processor;
}

/**
 * Process a single markdown source string into a MarkdownFileResult.
 *
 * @param {string} source - Raw markdown string
 * @param {string} filePath - File path (for slug derivation)
 * @param {any} config - Processing options
 * @returns {Promise<object>} MarkdownFileResult
 */
async function processMarkdown(source, filePath, config = {}) {
  const processor = buildProcessor(config);

  const vfile = await processor.process(source);
  const frontmatter = /** @type {any} */ (vfile.data)?.frontmatter ?? {};

  // Parse a separate tree for TOC/excerpt extraction (without rehype transform)
  const mdProcessor = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm);
  const tree = mdProcessor.parse(source);

  const plainText = mdastToString(tree);
  const toc = extractToc(tree);
  const excerpt = await extractExcerpt(tree);
  const slug = basename(filePath, extname(filePath));

  return {
    slug,
    path: filePath,
    frontmatter,
    $body: String(vfile),
    $excerpt: excerpt,
    $toc: toc,
    $readingTime: readingTime(plainText),
    $wordCount: plainText.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Resolve a dot-notation path within an object.
 *
 * @param {any} obj
 * @param {string} path
 * @returns {any}
 */
function getNestedValue(obj, path) {
  return path.split(".").reduce((/** @type {any} */ o, k) => o?.[k], obj);
}

// ─── MarkdownFile ─────────────────────────────────────────────────────────────

/**
 * Parse a single markdown file. Satisfies the Jx external class contract ($prototype).
 *
 * @example
 *   { "$prototype": "MarkdownFile", "$src": "@jxplatform/md", "src": "./content/about.md", "signal": true }
 */
export class MarkdownFile {
  /**
   * @param {object} config
   * @param {string} config.src - File path to markdown file
   * @param {any[]} [config.remarkPlugins] Default is `[]`
   * @param {any[]} [config.rehypePlugins] Default is `[]`
   * @param {string} [config.basePath] - Base path for resolving src
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Parse and resolve the markdown file.
   *
   * @returns {Promise<object>} MarkdownFileResult
   */
  async resolve() {
    const { src, basePath, ...processorConfig } = this.config;
    const filePath = basePath ? resolvePath(basePath, src) : resolvePath(src);
    const source = readFileSync(filePath, "utf-8");
    return processMarkdown(source, filePath, processorConfig);
  }
}

// ─── MarkdownCollection ───────────────────────────────────────────────────────

/**
 * Parse a glob of markdown files into a sorted, filterable array. Satisfies the Jx external class
 * contract ($prototype).
 *
 * @example
 *   { "$prototype": "MarkdownCollection", "$src": "@jxplatform/md", "src": "./posts/*.md", "signal": true }
 */
export class MarkdownCollection {
  /**
   * @param {object} config
   * @param {string} config.src - Glob pattern or directory path
   * @param {string} [config.sortBy] Default is `'frontmatter.date'`
   * @param {string} [config.sortOrder] Default is `'desc'`
   * @param {number} [config.limit]
   * @param {Function} [config.filter] - Filter function
   * @param {any[]} [config.remarkPlugins] Default is `[]`
   * @param {any[]} [config.rehypePlugins] Default is `[]`
   * @param {string} [config.basePath] - Base path for resolving glob
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Glob files, parse each, sort, filter, and limit.
   *
   * @returns {Promise<object[]>} Array of MarkdownFileResult
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

    const resolved = basePath ? resolvePath(basePath, src) : src;
    // Normalize to forward slashes — glob requires POSIX paths on all platforms
    const pattern = resolved.split("\\").join("/");
    const files = globSync(pattern, { absolute: true });

    const results = await Promise.all(
      files.map(async (filePath) => {
        const source = readFileSync(filePath, "utf-8");
        return processMarkdown(source, filePath, processorConfig);
      }),
    );

    // Filter
    let filtered = results;
    if (typeof filter === "function") {
      filtered = results.filter(/** @type {any} */ (filter));
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = getNestedValue(a, sortBy) ?? "";
      const bVal = getNestedValue(b, sortBy) ?? "";
      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    // Limit
    if (limit && limit > 0) {
      return filtered.slice(0, limit);
    }

    return filtered;
  }
}

// ─── MarkdownDirective ────────────────────────────────────────────────────────

/**
 * Remark plugin: map markdown directives to custom element tags in HTML output.
 *
 * Works with `remark-directive` — must be placed after it in the pipeline. Converts
 * ::directive-name{attrs} → <directive-name attrs> in hast output.
 *
 * @example
 *   unified()
 *     .use(remarkParse)
 *     .use(remarkDirective)
 *     .use(MarkdownDirective, { prefix: "jx-" })
 *     .use(remarkRehype)
 *     .use(rehypeStringify);
 *
 * @param {object} [options]
 * @param {string} [options.prefix] - Prefix for directives without hyphens. Default is `'jx-'`
 * @param {boolean} [options.passContent] - Pass container content as slot. Default is `true`
 * @param {string[]} [options.allowedNames] - Whitelist of allowed directive names
 * @returns {function} Remark plugin transform function
 */
export function MarkdownDirective(options = {}) {
  const { prefix = "jx-", passContent = true, allowedNames } = options;

  return (/** @type {any} */ tree) => {
    visit(tree, (/** @type {any} */ node) => {
      if (
        node.type === "leafDirective" ||
        node.type === "containerDirective" ||
        node.type === "textDirective"
      ) {
        const rawName = node.name;

        // Check whitelist
        if (allowedNames && !allowedNames.includes(rawName)) return;

        // Custom element names must contain a hyphen per Web Components spec
        const tagName = rawName.includes("-") ? rawName : `${prefix}${rawName}`;

        // Set hast properties for remarkRehype
        const data = node.data || (node.data = {});
        data.hName = tagName;
        data.hProperties = { ...node.attributes };

        // For text directives, preserve label as children
        if (node.type === "textDirective" && node.children?.length > 0) {
          // Children are already part of the mdast node; remarkRehype handles them
        }

        // For container directives, content is already in node.children
        if (node.type === "containerDirective" && !passContent) {
          node.children = [];
        }
      }
    });
  };
}
