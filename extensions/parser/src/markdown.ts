/**
 * Markdown — the markdown format-extension class for Jx
 *
 * Single class carrying every format capability:
 *
 * - Static `parse` (markdown source → Jx document) — browser-safe
 * - Static `serialize` (Jx document → markdown source) — browser-safe
 * - Static `discover` / `load` (compile-time content access) — node-only, dynamic imports
 * - Instance `resolve` (runtime on-demand access for `$prototype: "Markdown"` state)
 *
 * The node-only capabilities dynamically import `node:fs` / `./md.ts` inside the method so this
 * module stays importable in the browser (studio calls parse/serialize in-process).
 *
 * @module @jxsuite/parser/markdown
 * @license MIT
 */

import { compileExclude } from "./content-rules.ts";
import { transpileJxMarkdown } from "./transpile.ts";
import { serializeJxMarkdown } from "./serialize.ts";
import type { SerializeOptions } from "./serialize.ts";
import type { JxDocument } from "@jxsuite/schema/types";
import type { ContentLoaderEntry, MarkdownFileResult } from "./types.ts";

export interface MarkdownLoadOptions {
  /** Options for the MarkdownDirective plugin (allowedNames, prefix, ...). */
  directiveOptions?: unknown;
  /** Enable remark-directive parsing. Implied by directiveOptions. */
  directives?: boolean;
  /**
   * Resolved content-source root directory. When set, entries in subdirectories get path-based ids
   * (`studio/canvas` for `studio/canvas.md`, `/index` stripped); files directly at the root keep
   * basename ids.
   */
  sourceRoot?: string;
  /**
   * The content type's `alerts` option: alert type → custom element, or `false` to leave GitHub
   * alerts (`> [!NOTE]`) as plain blockquotes. Absent renders the built-in callout markup.
   */
  alerts?: unknown;
  /** Told of each `[!type]` marker whose type is not enabled (it stays a blockquote). */
  onUnknownAlert?: (type: string) => void;
}

/** Options for {@link Markdown.discover}. */
export interface MarkdownDiscoverOptions {
  /** Directory the `source` is relative to. */
  baseDir?: string;
  /**
   * Glob patterns, relative to the source directory, for files (and whole directories) to leave
   * out. A directory every file of which is excluded is not read at all.
   */
  exclude?: readonly string[];
}

/**
 * Markdown format class. Satisfies the Jx external class contract ($prototype + instance resolve)
 * and the format capability contract (static parse / serialize / discover / load).
 *
 * @example
 *   { "$prototype": "Markdown", "$src": "@jxsuite/parser/Markdown.class.json", "src": "./post.md" }
 */
export class Markdown {
  config: { src: string; basePath?: string } & MarkdownLoadOptions;

  constructor(config: { src: string; basePath?: string } & MarkdownLoadOptions) {
    this.config = config;
  }

  /** Transpile Jx Markdown source into a complete Jx JSON document (browser-safe). */
  static parse(source: string): JxDocument {
    return transpileJxMarkdown(source);
  }

  /** Serialize a Jx document to markdown source (browser-safe). See SerializeOptions. */
  static serialize(doc: JxDocument, options?: SerializeOptions): string {
    return serializeJxMarkdown(doc, options);
  }

  /**
   * List .md entry files for a content-type source (file path or directory).
   *
   * A directory is walked in sorted order, so the entries of a collection come back in the same
   * order on every machine. The platform's own directory order is whatever the filesystem happens
   * to return, which made an unsorted listing differ between a laptop and CI.
   */
  static async discover(source: string, options: MarkdownDiscoverOptions = {}): Promise<string[]> {
    const { existsSync } = await import("node:fs");
    const { resolve, extname } = await import("node:path");
    const { walkFiles } = await import("./walk.ts");
    const resolved = options.baseDir ? resolve(options.baseDir, source) : resolve(source);

    if (extname(resolved)) {
      return existsSync(resolved) ? [resolved] : [];
    }
    return walkFiles(
      resolved,
      (name) => name.toLowerCase().endsWith(".md"),
      compileExclude(options.exclude),
    );
  }

  /** Load one markdown file into a content entry (frontmatter → data, body preserved). */
  static async load(
    path: string,
    options: MarkdownLoadOptions = {},
  ): Promise<ContentLoaderEntry[]> {
    const { processMarkdown } = await import("./md.ts");
    const { readFileSync, statSync } = await import("node:fs");
    const source = readFileSync(path, "utf8");
    const result = processMarkdown(source, path, {
      ...(options.directives !== undefined && { directives: options.directives }),
      ...(options.directiveOptions !== undefined && {
        directiveOptions: options.directiveOptions,
      }),
      ...(options.sourceRoot !== undefined && { sourceRoot: options.sourceRoot }),
      ...(options.alerts !== undefined && { alerts: options.alerts }),
      ...(options.onUnknownAlert !== undefined && { onUnknownAlert: options.onUnknownAlert }),
    });
    const _meta: ContentLoaderEntry["_meta"] = {};
    /*
     * The modification time is the only date a file always has. A feed falls back to it when the
     * frontmatter carries none, and it is what would let the sitemap stop giving every page
     * generated from one template that template's `<lastmod>`.
     */
    try {
      _meta.mtime = statSync(path)
        .mtime.toISOString()
        .replace(/\.\d{3}Z$/, "Z");
    } catch {
      // A format class may be handed content that is not on disk; an absent mtime is not an error.
    }
    if (result.$excerpt != null) {
      _meta.excerpt = result.$excerpt;
    }
    if (result.$toc != null) {
      _meta.toc = result.$toc;
    }
    if (result.$readingTime != null) {
      _meta.readingTime = result.$readingTime;
    }
    if (result.$wordCount != null) {
      _meta.wordCount = result.$wordCount;
    }
    return [
      {
        $children: result.$children,
        _meta,
        body: source,
        data: result.frontmatter,
        id: result.slug,
      },
    ];
  }

  /** Runtime on-demand access: parse the configured markdown file. */
  async resolve(): Promise<MarkdownFileResult> {
    const { processMarkdown } = await import("./md.ts");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { src, basePath, ...processorConfig } = this.config;
    const filePath = basePath ? resolve(basePath, src) : resolve(src);
    const source = readFileSync(filePath, "utf8");
    return processMarkdown(source, filePath, processorConfig);
  }
}
