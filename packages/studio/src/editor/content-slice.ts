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
import {
  escapeTemplateText,
  isClosedContent,
  openMarkup,
  unescapeTemplateText,
} from "../utils/edit-display";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** A block's content as a children array — the form both storage shapes normalize to. */
export type Content = (JxMutableNode | string)[];

/** A block's content in the form it is stored: `children` for markup, folded `textContent` else. */
export interface StoredContent {
  children?: Content;
  textContent?: string;
}

/**
 * One whole `${…}` that is PRINTED wherever it stands: it was a `textContent`, or was cut out of a
 * longer string.
 *
 * As a string member of `children` the same text would be the one string whose value may be nodes
 * ({@link isWholeTemplate}), so it cannot travel as a bare string through a slice or a join without
 * changing what it means. Wrapped, it is joined to the text beside it like any other template,
 * folded back into a `textContent` when it ends up alone, and refused when it would have to stand
 * as a member ({@link storePieces}).
 */
export class Printed {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** One member of content in transit: an element, a string, or a {@link Printed} whole template. */
export type ContentPiece = JxMutableNode | string | Printed;

/** Whether a piece is text of either sort. */
function isText(piece: ContentPiece | undefined): piece is string | Printed {
  return isString(piece) || piece instanceof Printed;
}

/** The text of a text piece. */
function textOf(piece: string | Printed): string {
  return isString(piece) ? piece : piece.text;
}

/**
 * The content of `node` as a children array, whichever way it is stored.
 *
 * A block holds its text either as `textContent` (all-plain) or as `children` (mixed inline
 * markup), and every operation that joins or cuts blocks has to handle both. A third spelling is
 * read and never written: a literal `innerHTML` of text and bare formatting elements, which is the
 * content it spells (`openMarkup`). Whatever writes content to a block removes that key.
 */
export function contentOf(node: JxMutableNode | undefined | null): Content {
  if (!node) {
    return [];
  }
  const markup = openMarkup(node);
  if (markup) {
    return markup;
  }
  if (Array.isArray(node.children)) {
    return node.children;
  }
  return isString(node.textContent) && node.textContent.length > 0 ? [node.textContent] : [];
}

/**
 * {@link contentOf} for content that is about to be cut or joined: a `textContent` that is one whole
 * `${…}` is marked {@link Printed}, so it is not taken for a member on the way.
 */
export function piecesOf(node: JxMutableNode | undefined | null): ContentPiece[] {
  if (!node || Array.isArray(node.children) || openMarkup(node)) {
    return contentOf(node);
  }
  const { textContent } = node;
  if (!isString(textContent) || textContent.length === 0) {
    return [];
  }
  return [isWholeTemplate(textContent) ? new Printed(textContent) : textContent];
}

/**
 * Whether an inline child is ATOMIC: one unit no offset falls inside, one position long.
 *
 * True of an element whose content is a value rather than the author's text (`isClosedContent`) and
 * of a component instance, whose content is another document's. The canvas draws both closed to the
 * caret and counts each as ONE (`canvas/iframe-position.ts`), because what one shows has no
 * relation to what it stores: a `{ "$ref" }` text is no characters of content however long its
 * value is. Counting it here as its stored text would put every later offset out by the difference,
 * and a cross-block delete would then take text the author never selected. Counting it as nothing
 * made the position before it and the one after it the same offset, and a delete that began after
 * it took it too.
 */
export function isAtomicInline(node: JxMutableNode): boolean {
  return (isString(node.tagName) && node.tagName.includes("-")) || isClosedContent(node);
}

/** The length of one piece: a string's own, one for an atomic inline, an element's content's. */
function pieceLength(piece: ContentPiece): number {
  if (isText(piece)) {
    return textOf(piece).length;
  }
  return isAtomicInline(piece) ? 1 : contentLength(piecesOf(piece));
}

/** The rendered text length of a content array, in the canvas's own units. */
export function contentLength(children: readonly ContentPiece[]): number {
  let n = 0;
  for (const child of children) {
    n += pieceLength(child);
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
 * What is left of the string `whole` when `cut` is the part of it a slice keeps.
 *
 * A piece of plain text is itself. A piece of a template that still holds a `${` is still a
 * template, and {@link Printed} when it is one whole `${…}`: inside the longer string it was
 * interpolated, and alone it must not become a member. A piece that holds no `${` is no template
 * any more, so it is the text its escapes spell: `C:\\temp` is stored as the one backslash the page
 * showed.
 */
function cutText(whole: string, cut: string): string | Printed {
  if (!whole.includes("${")) {
    return cut;
  }
  if (cut.includes("${")) {
    return isWholeTemplate(cut) ? new Printed(cut) : cut;
  }
  return unescapeTemplateText(cut) ?? cut;
}

/**
 * The sub-content covering characters `[start, end)`, with inline elements preserved, or null when
 * an inline element that was cut cannot hold what is left of it ({@link storePieces}).
 *
 * An inline element that straddles a boundary is kept with its content clipped — so cutting a bold
 * run in half leaves a shorter bold run, not plain text. Elements that fall entirely outside the
 * range are dropped; empty results are omitted rather than left as empty tags. An atomic inline is
 * one position long: kept when the range covers it, never cut. A string cut out of a template is
 * what {@link cutText} says it is.
 */
export function sliceContent(
  children: readonly ContentPiece[],
  start: number,
  end: number,
): ContentPiece[] | null {
  const out: ContentPiece[] = [];
  let pos = 0;
  for (const child of children) {
    if (pos >= end) {
      break;
    }
    if (isText(child)) {
      const text = textOf(child);
      const childEnd = pos + text.length;
      if (childEnd > start) {
        const cut = text.slice(
          Math.max(0, start - pos),
          Math.max(0, Math.min(end, childEnd) - pos),
        );
        if (cut) {
          out.push(cut === text ? child : cutText(text, cut));
        }
      }
      pos = childEnd;
      continue;
    }
    const len = pieceLength(child);
    const childEnd = pos + len;
    if (len === 0) {
      // A void inline (a `<br>`, an `<img>`) contributes no characters, so it can never satisfy a
      // Length-based overlap test — it sits AT a position rather than spanning one. Keep it when
      // The range covers that position, or every slice would silently drop it.
      if (pos >= start && pos < end) {
        // Copied verbatim: giving a `<br>` an empty `textContent` would be noise in the source.
        out.push({ ...child });
      }
    } else if (pos >= start && childEnd <= end) {
      // Kept whole: copied as it is stored, so a slice never re-spells content it did not cut.
      out.push({ ...child });
    } else if (childEnd > start && !isAtomicInline(child)) {
      // To the range's own end, not the element's: one that reaches past it keeps a `<br>` that
      // Ends the element, which is no characters long and so sits AT the element's end.
      const kept = sliceContent(piecesOf(child), Math.max(0, start - pos), end - pos);
      if (kept === null) {
        return null;
      }
      if (kept.length > 0) {
        const stored = storePieces(kept);
        if (stored === null) {
          return null;
        }
        // Its markup too: what is kept of it is stored as the other two keys from here on.
        const { children: _drop, innerHTML: _dropMarkup, textContent: _dropText, ...rest } = child;
        out.push({ ...rest, ...stored });
      }
    }
    pos = childEnd;
  }
  return out;
}

/** Content with every {@link Printed} piece as the bare string it holds. */
function bare(pieces: readonly ContentPiece[]): Content {
  return pieces.map((piece) => (piece instanceof Printed ? piece.text : piece));
}

/**
 * The one piece two adjacent text pieces are, or null when they must stay two members.
 *
 * Two plain strings are their concatenation. Once either holds a `${` the result is a template, the
 * inside of a template literal, where a backslash is an escape: so the plain one is escaped on the
 * way in, or `C:\\temp` joined to `${state.x}` would read as a tab. Two strings are NOT joined when
 * either is one whole `${…}` standing as a member ({@link isWholeTemplate}), which may be a list of
 * nodes and joined to anything is that list's string form; or when the join would make or unmake an
 * expression (a `$` meeting a `{`, an unclosed `${` swallowing the next string's). A
 * {@link Printed} whole template is text already, and joins like any other template.
 */
function joinText(a: string | Printed, b: string | Printed): string | null {
  const first = textOf(a);
  const second = textOf(b);
  const templated = first.includes("${") || second.includes("${");
  if (!templated) {
    return (first + second).includes("${") ? null : first + second;
  }
  if ((isString(a) && isWholeTemplate(a)) || (isString(b) && isWholeTemplate(b))) {
    return null;
  }
  const head = first.includes("${") ? first : escapeTemplateText(first);
  const tail = second.includes("${") ? second : escapeTemplateText(second);
  const joined = head + tail;
  const sources = (text: string): string[] =>
    templateExpressions(text).map(({ start, end }) => text.slice(start, end));
  // The same expressions, each as written, in the same order: else the join changed what one is.
  return sources(joined).join("\n") === [...sources(head), ...sources(tail)].join("\n")
    ? joined
    : null;
}

/** {@link normalizeContent} for pieces: a {@link Printed} one stays marked until it is joined. */
function normalizePieces(children: readonly ContentPiece[]): ContentPiece[] {
  const out: ContentPiece[] = [];
  for (const child of children) {
    if (isText(child)) {
      if (textOf(child).length === 0) {
        continue;
      }
      const prev = out.at(-1);
      const joined = isText(prev) ? joinText(prev, child) : null;
      if (joined !== null) {
        // Two templates joined are never one whole `${…}`, so the result needs no mark.
        out[out.length - 1] = joined;
        continue;
      }
    }
    out.push(child);
  }
  return out;
}

/**
 * Merge adjacent strings where that changes nothing they mean ({@link joinText}) and drop empties,
 * so a spliced result does not carry the seams of how it was built. Strings that cannot be joined
 * stay side by side as members of their own, each still meaning what it meant.
 */
export function normalizeContent(children: Content): Content {
  return bare(normalizePieces(children));
}

/**
 * The content a block should hold after `[from, to)` is replaced by `text`, where `head` is the
 * block the range starts in and `tail` the block it ends in. Null when a cut cannot be stored
 * ({@link sliceContent}).
 *
 * Collapsing a cross-block range is the same shape as a merge: keep the head's prefix, keep the
 * tail's suffix, and join them — with any typed replacement between. The tail is kept to no end at
 * all, so a `<br>` that ends it, which is no characters long, is kept too.
 */
export function spliceAcross(
  head: readonly ContentPiece[],
  from: number,
  tail: readonly ContentPiece[],
  to: number,
  text = "",
): ContentPiece[] | null {
  const keptHead = sliceContent(head, 0, from);
  const keptTail = sliceContent(tail, to, Number.POSITIVE_INFINITY);
  return keptHead && keptTail
    ? normalizePieces([...keptHead, ...(text ? [text] : []), ...keptTail])
    : null;
}

/**
 * Pieces in the form a node stores them, or null when no form says what they mean.
 *
 * One string is folded into `textContent` unless it is a whole-template MEMBER, which as a
 * `textContent` would be printed where it was spliced. A {@link Printed} whole template alone is a
 * `textContent`; one that could not be joined to what stands beside it (an element, a member) would
 * have to be stored as a member, where an array it yields is spliced in as nodes instead of
 * printed. Nothing spells that, so the write that needed it is refused.
 */
export function storePieces(pieces: readonly ContentPiece[]): StoredContent | null {
  const normalized = normalizePieces(pieces);
  const [only] = normalized;
  if (only === undefined) {
    return { textContent: "" };
  }
  if (normalized.length === 1 && isText(only) && !(isString(only) && isWholeTemplate(only))) {
    return { textContent: textOf(only) };
  }
  return normalized.some((piece) => piece instanceof Printed)
    ? null
    : { children: bare(normalized) };
}

/**
 * `{ children }` when the content carries markup, else the folded `{ textContent }` form.
 *
 * One string is folded unless it is one whole `${…}` ({@link isWholeTemplate}): as a member that
 * may be a list of nodes, and as a `textContent` it never is.
 */
export function toStored(children: Content): StoredContent {
  // No piece of a plain array is marked printed, so there is always a form.
  return storePieces(children) ?? { children: normalizeContent(children) };
}

/**
 * Anything that holds a block's content: a stored node, or what a commit carries. A commit's
 * `textContent` may be null where it carries `children` instead.
 */
export interface StoredContentLike {
  children?: JxMutableNode["children"];
  innerHTML?: JxMutableNode["innerHTML"];
  textContent?: JxMutableNode["textContent"] | null;
}

/**
 * A block's content in one canonical form, so two spellings of the same content compare equal and
 * two that differ in meaning never do: adjacent plain strings joined, and content that is one
 * string folded into `textContent` unless that string is one whole `${…}`, at every depth
 * (`editor/content-slice.ts`). An element's empty `textContent` is no content, so a `<br>` the
 * canvas serialized with one is the `<br>` the document holds without. Content spelled as a literal
 * `innerHTML` (`openMarkup`) is the children it spells, so a commit of a block nobody typed in
 * compares equal to the markup it was drawn from.
 */
function canonicalContent(content: StoredContentLike): StoredContent {
  const markup = openMarkup(content);
  const children = markup ?? (Array.isArray(content.children) ? content.children : []);
  if (!markup && !Array.isArray(content.children) && isString(content.textContent)) {
    // Stored as text already: one string, kept as it is whatever it holds.
    return { textContent: content.textContent };
  }
  return toStored(
    children.map((child) => {
      if (isString(child) || !isNonNullObject(child)) {
        return child;
      }
      const spelled = openMarkup(child) !== null;
      if (!spelled && !Array.isArray(child.children) && !isString(child.textContent)) {
        return child;
      }
      const { children: _children, textContent: _text, ...kept } = child;
      const { innerHTML: _markup, ...unspelled } = kept;
      const rest = spelled ? unspelled : kept;
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
