import type { Root } from "mdast";
import type {
  ContentFieldValue,
  ContentTypeSchema,
  JsonObject,
  JsonValue,
  JxElement,
  TocEntry,
} from "@jxsuite/schema/types";

// The content wire types are core (extensions implement them, hosts thread them); re-exported here
// So parser-internal modules and downstream consumers keep their historical import path.
export type { ContentLoaderEntry, TocEntry } from "@jxsuite/schema/types";

export interface MarkdownFileResult {
  slug: string;
  path: string;
  /** The parsed front matter: the same field space a loaded content entry's `data` carries. */
  frontmatter: Record<string, ContentFieldValue | undefined>;
  $children: (JxElement | string)[];
  $excerpt?: string;
  $toc?: TocEntry[];
  $readingTime?: number;
  $wordCount?: number;
}

/**
 * A processed markdown file that may carry fields beyond the ones {@link MarkdownFileResult}
 * declares: any value one of those members holds, or a front-matter field value.
 */
export type ContentEntry = MarkdownFileResult &
  Record<string, MarkdownFileResult[keyof MarkdownFileResult] | ContentFieldValue>;

/**
 * A content-type definition in the project.json `content` section — the parser extension owns this
 * shape (its project fragment schema is the validation source of truth).
 */
export interface ContentTypeDef {
  source?: string;
  format?: string;
  schema?: ContentTypeSchema;
  $elements?: (string | { $ref: string })[];
  /** Globs, relative to a directory `source`, for files that are never read. */
  exclude?: string[];
  /** Declarative frontmatter filter: only entries that satisfy it are kept. */
  where?: JsonObject;
  /** Frontmatter field whose value is the entry id (the path-derived id when absent). */
  idField?: string;
  /** Route template giving each entry its URL. */
  route?: string;
  /** Route template for a directory's README.md or index.md (`route` is used when absent). */
  indexRoute?: string;
  /** How a link that has no page is reported. Default `"warn"`. */
  links?: "warn" | "error" | "ignore";
  /**
   * GitHub alert type → custom element, `true` for the built-in markup, `false` to leave it a
   * blockquote. `false` for the whole option turns callouts off, `true` is the default.
   */
  alerts?: Record<string, string | boolean | null> | boolean;
  /** Format-specific options, read from `project.json` like every key above. */
  [key: string]: JsonValue | ContentTypeSchema | undefined;
}

export interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  data?: unknown;
  position?: unknown;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean;
  isHeader?: boolean;
  name?: string;
  attributes?: Record<string, string>;
  url?: string;
  alt?: string;
  title?: string | null;
  lang?: string | null;
  meta?: string | null;
  align?: (string | null)[] | null;
}

/**
 * A unified attacher: called by unified with `this` bound to the processor and the settings passed
 * after it to `use`. Its result (a parser, compiler or transformer) is consumed by unified, never
 * by the pipeline, and every plugin this package installs takes only JSON settings.
 */
export type UnifiedPlugin = (...settings: never[]) => void;

/**
 * Minimal structural type for the unified() processor chain.
 *
 * The unified/remark packages ship ESM-only types that oxlint's type-aware engine cannot resolve
 * under `moduleResolution: bundler` (it sees them as `any`), even though tsgo resolves them
 * correctly. We cast the `unified()` result to this hand-written surface once, at the construction
 * boundary, so the rest of the pipeline is properly typed instead of `any`.
 */
export interface UnifiedProcessor {
  use: (plugin: UnifiedPlugin, ...settings: JsonValue[]) => UnifiedProcessor;
  parse: (source: string) => MdastNode;
  runSync: (tree: MdastNode, file?: UnifiedFile) => MdastNode;
  stringify: (tree: MdastNode | Root) => string;
}

/**
 * The part of a VFile the pipeline hands to `runSync` and reads back. unified wraps the object in a
 * VFile that shares this `data` record, and `remark-parse-frontmatter` stores the YAML block's
 * parse there. `yaml.parse` uses the YAML 1.2 core schema (no timestamps), so the result is plain
 * JSON; a document with no front matter, or an empty block, leaves it absent or `null`.
 */
export interface UnifiedFile {
  data: { frontmatter?: JsonValue };
}

export interface HastNode {
  type: string;
  tagName?: string;
  /** Hast's property values (`hast` Properties). */
  properties?: Record<string, string | number | boolean | (string | number)[] | null | undefined>;
  children?: HastNode[];
  value?: string;
}
