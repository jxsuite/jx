/**
 * What a Markdown file's own text says about how it is written, read back so a save keeps it.
 *
 * Studio saves a Markdown document by serializing a Jx tree, and a tree holds values, not spelling.
 * Without the text the file was read as, every save re-spells everything: a quoted `"717-669-8739"`
 * loses its quotes, a plain scalar the author wrapped over three lines is joined, a long string
 * becomes a `|` block, and `_emphasis_` becomes `*emphasis*`. A one-word edit then produces a diff
 * of the whole file. The serializer's `source` option hands that text back, and this module is what
 * reads it:
 *
 * - {@link spliceFrontmatter} keeps every top-level frontmatter key whose value did not change as the
 *   exact bytes it was read as, re-stringifies only the keys that changed, drops the removed ones
 *   and appends the new ones.
 * - {@link markdownMarkers} reports the emphasis, strong and bullet markers the body was written
 *   with, so the stringifier writes them the same way.
 *
 * @module @jxsuite/parser/source-style
 * @license MIT
 */

import { isMap, isScalar, parseDocument } from "yaml";
import type { Node, Pair } from "yaml";
import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JxDocumentValue } from "@jxsuite/schema/types";
import type { MdastNode } from "./types.ts";

/** Opening `---` line, the block's text, and the closing `---` line. */
const FRONTMATTER_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

/**
 * The YAML text of a source's leading frontmatter block, without its fences; `null` when the source
 * opens with none. An empty block (`---` twice) is the empty string.
 */
export function frontmatterText(source: string): string | null {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return null;
  }
  return match[1] ?? "";
}

/** The source with its leading frontmatter block (fences included) taken off. */
export function bodyText(source: string): string {
  return source.replace(FRONTMATTER_RE, "");
}

/** A frontmatter value as `yaml.parse` and a Jx document both hold it. */
type FrontmatterValue = JxDocumentValue | undefined;

/** A frontmatter block's values by key. */
export type FrontmatterValues = Record<string, FrontmatterValue>;

/** Whether two frontmatter values are the same value: JSON equality, key order ignored. */
export function sameValue(a: FrontmatterValue, b: FrontmatterValue): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (!isJsonObject(a) || !isJsonObject(b)) {
    return false;
  }
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => sameValue(a[key], b[key]));
}

/** The offset of the start of the line `offset` sits on. */
function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** The offset just past the end of the line `offset` sits on (past its newline, when it has one). */
function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline === -1 ? text.length : newline + 1;
}

/** One top-level key of the source block: where its text starts and ends, and its value. */
interface SourceEntry {
  key: string;
  /** Offset of the first line of the key. */
  start: number;
  /** Offset just past the last line of its value. */
  valueEnd: number;
  value: FrontmatterValue;
}

/** The source block's top-level keys, in order; `null` when the block is not a plain block map. */
function sourceEntries(text: string): SourceEntry[] | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || doc.warnings.length > 0) {
    return null;
  }
  const { contents } = doc;
  if (!isMap(contents) || contents.flow === true) {
    return null;
  }
  /* SAFETY: a parsed document's map holds parsed pairs, whose key and value are nodes (or null for
     a key with no value); `parseDocument` builds no other shape. */
  const pairs = contents.items as Pair<Node, Node | null>[];
  const keys: { name: string; range: [number, number, number] }[] = [];
  for (const { key } of pairs) {
    if (!isScalar(key) || !key.range || !isString(key.value)) {
      return null;
    }
    keys.push({ name: key.value, range: key.range });
  }
  // A block map's JS is a plain object keyed by the string keys just checked.
  const js: unknown = doc.toJS();
  const values = isJsonObject(js) ? js : {};
  const entries: SourceEntry[] = [];
  for (const [index, { name, range }] of keys.entries()) {
    const end = pairs[index]?.value?.range?.[1] ?? range[1];
    entries.push({
      key: name,
      start: lineStart(text, range[0]),
      value: values[name],
      valueEnd: lineEnd(text, Math.max(end - 1, range[0])),
    });
  }
  return entries;
}

/**
 * The frontmatter block's YAML, keeping the source's own text for every key that did not change.
 *
 * A top-level key whose value equals the value the source spelled is copied from the source byte
 * for byte, its comments and blank lines with it. A key whose value changed is written by `write`
 * in the source key's place, keeping the comment lines that followed it. A key the document no
 * longer has is dropped, and a key the source never had is written by `write` after the last one.
 * Anything above the first key (a leading comment) is kept.
 *
 * @param frontmatter The values the document holds now.
 * @param source The YAML text the file was read with ({@link frontmatterText}).
 * @param write Writes a mapping of keys as YAML, without a trailing newline.
 * @returns The new block's text, or `null` when the source is not a block map this can splice (a
 *   flow map, a parse error, a non-string key), in which case the caller writes the whole block.
 */
export function spliceFrontmatter(
  frontmatter: FrontmatterValues,
  source: string,
  write: (values: FrontmatterValues) => string,
): string | null {
  const entries = sourceEntries(source);
  if (!entries) {
    return null;
  }
  const present = (key: string) =>
    Object.hasOwn(frontmatter, key) && frontmatter[key] !== undefined;
  const segments: string[] = [];
  const head = source.slice(0, entries[0]?.start ?? source.length);
  if (head.trim().length > 0) {
    segments.push(head);
  }
  for (const [index, entry] of entries.entries()) {
    const chunkEnd = entries[index + 1]?.start ?? source.length;
    if (!present(entry.key)) {
      continue;
    }
    if (sameValue(entry.value, frontmatter[entry.key])) {
      segments.push(source.slice(entry.start, chunkEnd));
      continue;
    }
    const tail = source.slice(Math.min(entry.valueEnd, chunkEnd), chunkEnd);
    segments.push(`${write({ [entry.key]: frontmatter[entry.key] })}\n${tail}`);
  }
  const known = new Set(entries.map((entry) => entry.key));
  const added: FrontmatterValues = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!known.has(key) && value !== undefined) {
      added[key] = value;
    }
  }
  if (Object.keys(added).length > 0) {
    segments.push(write(added));
  }
  return segments
    .map((segment) => (segment.endsWith("\n") ? segment : `${segment}\n`))
    .join("")
    .replace(/\s+$/u, "");
}

/** The markers a Markdown body was written with, for remark-stringify's options of the same name. */
export interface MarkdownMarkers {
  emphasis: "*" | "_";
  strong: "*" | "_";
  bullet: "-" | "*" | "+";
}

/** The part of a unist position this module reads. */
interface StartPosition {
  start?: { offset?: number };
}

/** The source offset a parsed mdast node starts at, when the parser recorded one. */
function startOffset(node: MdastNode): number | null {
  /* SAFETY: remark-parse gives every node it parses a unist `Position`, whose `start` is a point
     carrying an `offset`; a hand-built node has none, and every read below is optional. */
  const position = node.position as StartPosition | undefined;
  const offset = position?.start?.offset;
  return isNumber(offset) ? offset : null;
}

/**
 * The emphasis, strong and bullet markers `tree` (parsed from `source`) was written with: the first
 * of each kind decides. A kind the body never uses keeps the house default (`*`, `*`, `-`).
 */
export function markdownMarkers(tree: MdastNode, source: string): MarkdownMarkers {
  const markers: MarkdownMarkers = { bullet: "-", emphasis: "*", strong: "*" };
  const seen = new Set<string>();
  const visit = (node: MdastNode) => {
    const offset = startOffset(node);
    if (offset !== null && !seen.has(node.type)) {
      const char = source[offset];
      if ((node.type === "emphasis" || node.type === "strong") && (char === "*" || char === "_")) {
        markers[node.type] = char;
        seen.add(node.type);
      } else if (node.type === "listItem" && (char === "-" || char === "*" || char === "+")) {
        markers.bullet = char;
        seen.add(node.type);
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(tree);
  return markers;
}
