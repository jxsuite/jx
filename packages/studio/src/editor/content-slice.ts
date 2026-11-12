/**
 * Slicing a block's content by CHARACTER OFFSET, preserving inline markup.
 *
 * A selection that spans blocks cuts through the middle of the first and last of them, so deleting
 * it means keeping `[0, from)` of one block and `[to, end)` of another — by rendered character
 * position, across whatever nesting of `<strong>`, `<em>`, `<code>` and links the author has built.
 * Cutting "he**ll**o" at offset 3 has to yield "he" + a bold "l", not a truncated string.
 *
 * The offsets here are the same ones {@link file://../canvas/iframe-position.ts} produces from the
 * DOM, so a caret position and a content slice always agree on what "offset 3" means.
 *
 * Pure: no DOM, no document, no reactivity — the whole thing is exercisable as data.
 *
 * @docs studio/editing/writing
 */

import { isNonNullObject, isString, templateExpressions } from "@jxsuite/schema/guards";
import { escapeTemplateText, isClosedContent } from "../utils/edit-display";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** A block's content as a children array — the form both storage shapes normalize to. */
export type Content = (JxMutableNode | string)[];

/** A block's content in the form it is stored: `children` for markup, folded `textContent` else. */
export interface StoredContent {
  children?: Content;
  textContent?: string;
}

/**
 * The content of `node` as a children array, whichever way it is stored.
 *
 * A block holds its text either as `textContent` (all-plain) or as `children` (mixed inline
 * markup), and every operation that joins or cuts blocks has to handle both.
 */
export function contentOf(node: JxMutableNode | undefined | null): Content {
  if (!node) {
    return [];
  }
  if (Array.isArray(node.children)) {
    return node.children;
  }
  return isString(node.textContent) && node.textContent.length > 0 ? [node.textContent] : [];
}

/**
 * Whether an inline child is ATOMIC: one unit no offset falls inside, with no length of its own.
 *
 * True of an element whose content is a value rather than the author's text (`isClosedContent`) and
 * of a component instance, whose content is another document's. The canvas draws both closed to the
 * caret and counts each as nothing (`canvas/iframe-position.ts`), because what one shows has no
 * relation to what it stores: a `{ "$ref" }` text is no characters of content however long its
 * value is. Counting it here as its stored text would put every later offset out by the difference,
 * and a cross-block delete would then take text the author never selected.
 */
export function isAtomicInline(node: JxMutableNode): boolean {
  return (isString(node.tagName) && node.tagName.includes("-")) || isClosedContent(node);
}

/** The content of an inline child that offsets are counted through: none for an atomic one. */
function innerContent(child: JxMutableNode): Content {
  return isAtomicInline(child) ? [] : contentOf(child);
}

/** The rendered text length of a content array. */
export function contentLength(children: Content): number {
  let n = 0;
  for (const child of children) {
    n += isString(child) ? child.length : contentLength(innerContent(child));
  }
  return n;
}

/**
 * Whether a string is one whole `${…}` and nothing else. As a member of `children` it is the one
 * string whose value may be nodes: an array there is spliced in (spec.md §8.4), where the same
 * expression as a `textContent` is printed. So it is never folded into `textContent` and never
 * joined with the string beside it.
 */
export function isWholeTemplate(text: string): boolean {
  const [only, ...rest] = templateExpressions(text);
  return only !== undefined && rest.length === 0 && only.start === 0 && only.end === text.length;
}

/**
 * The sub-content covering characters `[start, end)`, with inline elements preserved.
 *
 * An inline element that straddles a boundary is kept with its content clipped — so cutting a bold
 * run in half leaves a shorter bold run, not plain text. Elements that fall entirely outside the
 * range are dropped; empty results are omitted rather than left as empty tags.
 */
export function sliceContent(children: Content, start: number, end: number): Content {
  const out: Content = [];
  let pos = 0;
  for (const child of children) {
    if (pos >= end) {
      break;
    }
    if (isString(child)) {
      const childEnd = pos + child.length;
      if (childEnd > start) {
        const text = child.slice(
          Math.max(0, start - pos),
          Math.max(0, Math.min(end, childEnd) - pos),
        );
        if (text) {
          out.push(text);
        }
      }
      pos = childEnd;
      continue;
    }
    const inner = innerContent(child);
    const len = contentLength(inner);
    const childEnd = pos + len;
    if (len === 0) {
      // A void inline (a `<br>`, an `<img>`) or an atomic one contributes no characters, so it can
      // Never satisfy a length-based overlap test — it sits AT a position rather than spanning one.
      // Keep it when the range covers that position, or every slice would silently drop it.
      if (pos >= start && pos < end) {
        // Copied verbatim: giving a `<br>` an empty `textContent` would be noise in the source.
        out.push({ ...child });
      }
    } else if (pos >= start && childEnd <= end) {
      // Kept whole: copied as it is stored, so a slice never re-spells content it did not cut.
      out.push({ ...child });
    } else if (childEnd > start) {
      const kept = sliceContent(inner, Math.max(0, start - pos), Math.min(end, childEnd) - pos);
      if (kept.length > 0) {
        out.push(withContent(child, kept));
      }
    }
    pos = childEnd;
  }
  return out;
}

/** A copy of `node` carrying `children`, folded back to `textContent` when it is one string. */
function withContent(node: JxMutableNode, children: Content): JxMutableNode {
  const { children: _drop, textContent: _dropText, ...rest } = node;
  return { ...rest, ...toStored(children) };
}

/**
 * The one string two adjacent strings are, or null when they must stay two members.
 *
 * Two plain strings are their concatenation. Once either holds a `${` the result is a template, the
 * inside of a template literal, where a backslash is an escape: so the plain one is escaped on the
 * way in, or `C:\\temp` joined to `${state.x}` would read as a tab. Two strings are NOT joined when
 * either is one whole `${…}` ({@link isWholeTemplate}), which as a member may be a list of nodes
 * and joined to anything is that list's string form; or when the join would make or unmake an
 * expression (a `$` meeting a `{`, an unclosed `${` swallowing the next string's).
 */
function joinStrings(a: string, b: string): string | null {
  const templated = a.includes("${") || b.includes("${");
  if (!templated) {
    return (a + b).includes("${") ? null : a + b;
  }
  if (isWholeTemplate(a) || isWholeTemplate(b)) {
    return null;
  }
  const head = a.includes("${") ? a : escapeTemplateText(a);
  const tail = b.includes("${") ? b : escapeTemplateText(b);
  const joined = head + tail;
  const sources = (text: string): string[] =>
    templateExpressions(text).map(({ start, end }) => text.slice(start, end));
  // The same expressions, each as written, in the same order: else the join changed what one is.
  return sources(joined).join("\n") === [...sources(head), ...sources(tail)].join("\n")
    ? joined
    : null;
}

/**
 * Merge adjacent strings where that changes nothing they mean ({@link joinStrings}) and drop
 * empties, so a spliced result does not carry the seams of how it was built. Strings that cannot be
 * joined stay side by side as members of their own, each still meaning what it meant.
 */
export function normalizeContent(children: Content): Content {
  const out: Content = [];
  for (const child of children) {
    if (isString(child)) {
      if (child.length === 0) {
        continue;
      }
      const prev = out.at(-1);
      const joined = isString(prev) ? joinStrings(prev, child) : null;
      if (joined !== null) {
        out[out.length - 1] = joined;
        continue;
      }
    }
    out.push(child);
  }
  return out;
}

/**
 * The content a block should hold after `[from, to)` is replaced by `text`, where `head` is the
 * block the range starts in and `tail` the block it ends in.
 *
 * Collapsing a cross-block range is the same shape as a merge: keep the head's prefix, keep the
 * tail's suffix, and join them — with any typed replacement between.
 */
export function spliceAcross(
  head: Content,
  from: number,
  tail: Content,
  to: number,
  text = "",
): Content {
  return normalizeContent([
    ...sliceContent(head, 0, from),
    ...(text ? [text] : []),
    ...sliceContent(tail, to, contentLength(tail)),
  ]);
}

/**
 * `{ children }` when the content carries markup, else the folded `{ textContent }` form.
 *
 * One string is folded unless it is one whole `${…}` ({@link isWholeTemplate}): as a member that
 * may be a list of nodes, and as a `textContent` it never is.
 */
export function toStored(children: Content): StoredContent {
  const normalized = normalizeContent(children);
  const [only] = normalized;
  if (only === undefined) {
    return { textContent: "" };
  }
  if (normalized.length === 1 && isString(only) && !isWholeTemplate(only)) {
    return { textContent: only };
  }
  return { children: normalized };
}

/**
 * Anything that holds a block's content: a stored node, or what a commit carries. A commit's
 * `textContent` may be null where it carries `children` instead.
 */
export interface StoredContentLike {
  children?: JxMutableNode["children"];
  textContent?: JxMutableNode["textContent"] | null;
}

/**
 * A block's content in one canonical form, so two spellings of the same content compare equal and
 * two that differ in meaning never do: adjacent plain strings joined, and content that is one
 * string folded into `textContent` unless that string is one whole `${…}`, at every depth
 * (`editor/content-slice.ts`). An element's empty `textContent` is no content, so a `<br>` the
 * canvas serialized with one is the `<br>` the document holds without.
 */
function canonicalContent(content: StoredContentLike): StoredContent {
  const children = Array.isArray(content.children) ? content.children : [];
  if (!Array.isArray(content.children) && isString(content.textContent)) {
    // Stored as text already: one string, kept as it is whatever it holds.
    return { textContent: content.textContent };
  }
  return toStored(
    children.map((child) => {
      if (isString(child) || !isNonNullObject(child)) {
        return child;
      }
      if (!Array.isArray(child.children) && !isString(child.textContent)) {
        return child;
      }
      const { children: _children, textContent: _text, ...rest } = child;
      const canonical: JxMutableNode = rest;
      const inner = canonicalContent(child);
      return inner.textContent === "" ? canonical : Object.assign(canonical, inner);
    }),
  );
}

/** `value` as JSON with every object's keys in one order, so key order is not a difference. */
export function stableJson(value: StoredContent | Content): string {
  return JSON.stringify(value, (_key, member: JxDocumentValue) =>
    isNonNullObject(member) && !Array.isArray(member)
      ? Object.fromEntries(Object.entries(member).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : member,
  );
}

/** Whether `committed` says what `node` already holds, however either spells it. */
export function sameContent(node: StoredContentLike, committed: StoredContentLike): boolean {
  return stableJson(canonicalContent(node)) === stableJson(canonicalContent(committed));
}
