/**
 * A literal `innerHTML` read as the content it spells, when the canvas can be read back for all of
 * it (studio.md §4.5).
 *
 * `innerHTML` is a third way a block holds its content, beside `textContent` and `children`, and
 * the one an edit session cannot write: a commit rebuilds content from the canvas as text and
 * elements, and stores it under the other two. So a caret may enter an `innerHTML` block only when
 * what the commit rebuilds is everything the markup said. That is true of text and of formatting
 * elements that hold no attribute, which is what {@link plainMarkup} admits. Anything else (an
 * attribute, a comment, an element that is not formatting, an entity outside the handful decoded
 * here) is markup a commit would lose a part of, and the block that holds it is closed to the
 * caret.
 *
 * Pure: no DOM. The same answer is needed where the document is prepared for the canvas, where a
 * commit is compared with what the block holds, and where content is cut by offset.
 *
 * @docs studio/editing/writing
 */

import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** Content as a children array (`editor/content-slice.ts` names the same shape). */
type Markup = (JxMutableNode | string)[];

/**
 * The elements read back whole from the canvas when they hold no attribute: a tag and content. `b`,
 * `i`, `s` and `strike` are left out because a commit stores them under another tag, and `a`
 * because it is nothing without an attribute.
 */
const FORMATTING_TAGS = new Set([
  "abbr",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "ins",
  "kbd",
  "mark",
  "q",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
  "var",
]);

/** The named character references decoded; any other one closes the block. */
const NAMED_REFERENCES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

/** A tag with no attribute: `<em>`, `</em>`, `<br>`, `<br/>`. */
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*(\/?)>/;

/** A character reference, named or numeric. */
const REFERENCE = /^&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/;

/** An element being read: its tag and what it holds so far. */
interface Frame {
  members: Markup;
  tag: string;
}

/** The character a reference names, or null for one that is not decoded here. */
function decodeReference(match: RegExpExecArray): string | null {
  const [, decimal, hex, name] = match;
  if (name !== undefined) {
    return NAMED_REFERENCES.get(name) ?? null;
  }
  const code = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number(decimal);
  // A reference to NUL, a surrogate or a code point past the last one is replaced by the parser.
  if (code === 0 || code > 0x10_ff_ff || (code >= 0xd8_00 && code <= 0xdf_ff)) {
    return null;
  }
  return String.fromCodePoint(code);
}

/**
 * Add `text` to the end of `members`, joined to a string already there.
 *
 * @returns Whether the string it is now part of holds a `${`.
 */
function pushText(members: Markup, text: string): boolean {
  const last = members.at(-1);
  const joined = isString(last) ? last + text : text;
  if (isString(last)) {
    members[members.length - 1] = joined;
  } else {
    members.push(joined);
  }
  return joined.includes("${");
}

/** The element a closed frame stands for, its content stored as a block's own is. */
function elementOf(frame: Frame): JxMutableNode {
  const [only] = frame.members;
  if (frame.members.length === 0) {
    return { tagName: frame.tag };
  }
  if (frame.members.length === 1 && isString(only)) {
    return { tagName: frame.tag, textContent: only };
  }
  return { children: frame.members, tagName: frame.tag };
}

/**
 * The content `html` spells, or null when it holds anything a commit could not write back: see the
 * file comment. Text that holds a `${` is refused too, since stored as a string member it would be
 * read as a template (`&#36;{` is how markup spells that text so that it is not one).
 */
export function plainMarkup(html: string): Markup | null {
  const root: Markup = [];
  const open: Frame[] = [];
  let rest = html;
  while (rest !== "") {
    const members = open.at(-1)?.members ?? root;
    const next = rest.search(/[<&]/);
    if (next !== 0) {
      const text = next === -1 ? rest : rest.slice(0, next);
      if (pushText(members, text)) {
        return null;
      }
      rest = rest.slice(text.length);
      continue;
    }
    if (rest.startsWith("&")) {
      const reference = REFERENCE.exec(rest);
      if (!reference) {
        // The parser reads an `&` that begins no reference as itself, unless it might begin one.
        if (/^&[a-zA-Z#]/.test(rest)) {
          return null;
        }
        if (pushText(members, "&")) {
          return null;
        }
        rest = rest.slice(1);
        continue;
      }
      const decoded = decodeReference(reference);
      if (decoded === null || pushText(members, decoded)) {
        return null;
      }
      rest = rest.slice(reference[0].length);
      continue;
    }
    const tag = TAG.exec(rest);
    if (!tag) {
      return null;
    }
    const [whole, closing, rawName = "", selfClosing] = tag;
    const name = rawName.toLowerCase();
    rest = rest.slice(whole.length);
    if (name === "br" && closing === "") {
      members.push({ tagName: "br" });
      continue;
    }
    if (!FORMATTING_TAGS.has(name) || selfClosing !== "") {
      return null;
    }
    if (closing === "") {
      // Markup inside `<code>` is flattened to text by a commit, so it is not read back whole.
      if (open.some((frame) => frame.tag === "code")) {
        return null;
      }
      open.push({ members: [], tag: name });
      continue;
    }
    const frame = open.pop();
    if (frame?.tag !== name) {
      return null;
    }
    (open.at(-1)?.members ?? root).push(elementOf(frame));
  }
  return open.length > 0 ? null : root;
}
