/**
 * What the emitters put between an element's children (compiler.md §8.1, "Whitespace between
 * siblings").
 *
 * A static emitter writes each child as a string and joins the strings. A newline and indent
 * between two block elements is formatting: the browser drops it. Between two inline-level
 * siblings, or beside text, the same run of whitespace is a text node the page renders, so
 * `[link](/x/).` would build as `<a>link</a>\n.` and read "link ." (`` `code`, `` as "code ,"). The
 * separator is therefore written only where nothing it touches can render it, and never otherwise;
 * the text the document holds is never touched.
 *
 * The decision is made from the two strings being joined (the tag that ends the left one and the
 * tag or text that begins the right one), not from the nodes that produced them, so it holds for
 * everything that ends up between siblings: an element, a text node, a component instance expanded
 * in place, the rows of a repeater, a slot's content.
 *
 * @docs framework/build
 */

/** What stands at one edge of a rendered child. */
export type EdgeKind = "text" | "inline" | "block";

/**
 * Elements whose default `display` is `block` (or a table or list-item box), and `<br>`, which ends
 * the line it is on: whitespace on either side of one is at the edge of a line, where it is
 * collapsed away. Everything else is inline-level, whatever the author's CSS later makes of it.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "legend",
  "li",
  "listing",
  "main",
  "menu",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "plaintext",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "xmp",
]);

/** The tag a rendered edge opens or closes. */
function kindOfTag(tag: string): EdgeKind {
  return BLOCK_TAGS.has(tag.toLowerCase()) ? "block" : "inline";
}

/** A comment at the start of a string. */
const LEADING_COMMENT = /^<!--[\s\S]*?-->/u;
/** A start tag at the start of a string. */
const LEADING_TAG = /^<([a-zA-Z][^\s/>]*)/u;
/** The end tag that closes a string. */
const TRAILING_CLOSE = /<\/([a-zA-Z][^\s>]*)\s*>$/u;
/** The start tag of a void element that ends a string (it has no end tag to find). */
const TRAILING_VOID = /<([a-zA-Z][^\s/<>]*)(?:\s[^<]*)?>$/u;

/**
 * The kind of the node that begins `html`, looking past comments (the hydration markers a slot's
 * content is bracketed with): `null` when nothing but comments is there.
 *
 * @param {string} html
 * @returns {EdgeKind | null}
 */
function leadingKind(html: string): EdgeKind | null {
  let rest = html;
  for (let match = LEADING_COMMENT.exec(rest); match; match = LEADING_COMMENT.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  if (rest === "") {
    return null;
  }
  const tag = LEADING_TAG.exec(rest);
  return tag ? kindOfTag(tag[1]!) : "text";
}

/**
 * The kind of the node that ends `html`, looking past comments: `null` when nothing but comments is
 * there. Text is anything that does not end in a tag, which includes a template hole.
 *
 * @param {string} html
 * @returns {EdgeKind | null}
 */
function trailingKind(html: string): EdgeKind | null {
  let rest = html;
  while (rest.endsWith("-->")) {
    const open = rest.lastIndexOf("<!--");
    if (open === -1) {
      break;
    }
    rest = rest.slice(0, open);
  }
  if (rest === "") {
    return null;
  }
  const close = TRAILING_CLOSE.exec(rest) ?? TRAILING_VOID.exec(rest);
  return close ? kindOfTag(close[1]!) : "text";
}

/**
 * Whether a newline between `left` and `right` is formatting only: one of the two is a block-level
 * element, so the whitespace falls at the edge of a line, and neither is text. Two inline-level
 * siblings never qualify (the whitespace would be a space between them), and nor does anything
 * beside text. A string of nothing but comments never asks for one.
 *
 * @param {string} left - The child rendered before the separator
 * @param {string} right - The child rendered after it
 * @returns {boolean}
 */
export function separatorIsSafe(left: string, right: string): boolean {
  const before = trailingKind(left);
  const after = leadingKind(right);
  if (before === null || after === null) {
    return false;
  }
  return before !== "text" && after !== "text" && (before === "block" || after === "block");
}

/** How {@link joinChildren} writes a separator. */
export interface JoinOptions {
  /** Inside a `<pre>`-like subtree, where whitespace is content: the parts are concatenated. */
  preformatted?: boolean | undefined;
  /** Written between two siblings that may be separated (`"\n "` by default). */
  separator?: string | undefined;
  /**
   * What each part starts with because its emitter indented it. It is part of the layout, never of
   * the content: a part is classified without it, and it is dropped when no separator is written,
   * where it would be a run of spaces the page renders.
   */
  lead?: string | undefined;
}

/**
 * Join the rendered children of one element.
 *
 * Where a newline is formatting only (`separatorIsSafe`) it is written, so a block-level tree reads
 * as an indented one. Anywhere else the two children are joined with nothing between them, so the
 * output renders exactly what the document says. A part that is empty (a slot with nothing in it, a
 * child that renders nothing) takes no separator of its own.
 *
 * @param {readonly string[]} parts - The children, each as its emitter rendered it
 * @param {JoinOptions} [options]
 * @returns {string}
 */
export function joinChildren(parts: readonly string[], options: JoinOptions = {}): string {
  const { lead = "", preformatted = false, separator = "\n  " } = options;
  if (preformatted) {
    return parts.join("");
  }
  const present = parts.filter((part) => part !== "" && part !== lead);
  let out = "";
  for (const [index, part] of present.entries()) {
    if (index === 0) {
      out = part;
      continue;
    }
    const previous = present[index - 1]!;
    const body = stripLead(part, lead);
    out += separatorIsSafe(previous, body) ? `${separator}${part}` : body;
  }
  return out;
}

/** How {@link padChildren} writes the edges of an element's content. */
export interface PadOptions {
  /** Written before the first child, if what it touches is not text or inline-level. */
  open: string;
  /** Written after the last child, on the same condition. */
  close: string;
  /** What each part starts with because its emitter indented it (see {@link JoinOptions}). */
  lead?: string | undefined;
}

/**
 * Put a newline and indent between an element's start tag and its content, and between its content
 * and its end tag, where the child at that edge is block-level. Inside an inline parent (`<a>`,
 * `<em>`) text is flush against both tags, because a space there is a space the page shows. With no
 * `open` written, the first child loses the indent its emitter gave it.
 *
 * @param {string} joined - The content, as {@link joinChildren} returned it
 * @param {PadOptions} options
 * @returns {string}
 */
export function padChildren(joined: string, options: PadOptions): string {
  const { close, lead = "", open } = options;
  if (joined === "") {
    return joined;
  }
  const first = leadingKind(stripLead(joined, lead));
  const last = trailingKind(joined);
  const head = first === "block" ? open : "";
  const tail = last === "block" ? close : "";
  return `${head}${head === "" ? stripLead(joined, lead) : joined}${tail}`;
}

/** How {@link blockChildren} lays out an element's whole content. */
export interface BlockOptions extends JoinOptions, PadOptions {}

/**
 * The content of an element laid out one child per line: {@link joinChildren} then
 * {@link padChildren}.
 *
 * @param {readonly string[]} parts
 * @param {BlockOptions} options
 * @returns {string}
 */
export function blockChildren(parts: readonly string[], options: BlockOptions): string {
  const { close, open, ...join } = options;
  const joined = joinChildren(parts, join);
  return join.preformatted ? joined : padChildren(joined, { close, lead: join.lead, open });
}

/** A part without the indent its emitter gave it. */
function stripLead(part: string, lead: string): string {
  return part.startsWith(lead) ? part.slice(lead.length) : part;
}
