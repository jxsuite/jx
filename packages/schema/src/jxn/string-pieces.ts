/**
 * Where each character of a string's value was written (`spec.md` §23.3).
 *
 * A type error in a function body is found in the body's value, and has to be shown in the file,
 * where that value is spelled as a KDL string: inside quotes, with escapes, or over several lines
 * with the indentation of its block taken off each. This reads one string token and answers with
 * the runs of its value, each beside the source it came from. A run that is the source character
 * for character can be mapped one to one, so a column in it is exact. A run that is not (an escape,
 * a line ending the file spells `\r\n`) is one indivisible piece.
 *
 * `@bgotink/kdl` decodes a string and does not say where its characters came from, so this reads
 * the token again. It is checked against the decoder rather than trusted: when the runs do not
 * spell the value the parser read, the answer is one piece covering the whole token, which places
 * an error on the right string and never on the wrong character.
 */
import type { JxnSpan } from "./errors.ts";

/** A run of a string's value, beside the source it was written as. */
export interface StringPiece {
  /** One past the last source character. */
  end: number;
  start: number;
  /** The run of the value. */
  text: string;
  /** Whether {@link StringPiece.text} is the source, character for character. */
  verbatim: boolean;
}

/** One line of a multi-line string: its text, and where the next line starts. */
interface Line {
  end: number;
  next: number;
  start: number;
}

/** What KDL calls whitespace inside a line. */
const SPACE = String.raw`\t    -   　`;

/** What KDL calls a line ending. */
const BREAK = String.raw`\n\r\u0085\v\f  `;

const NEWLINE = new RegExp(String.raw`\r\n|[${BREAK}]`, "gu");

/** A line holding nothing but whitespace, which a multi-line string reads as an empty one. */
const BLANK = new RegExp(`^[${SPACE}]*$`, "u");

/** What a backslash before whitespace discards: all of it, line endings included. */
const DISCARDED = new RegExp(`[${SPACE}${BREAK}]+`, "uy");

const UNICODE = /u\{([0-9A-Fa-f]{1,6})\}/uy;

/** The escapes that stand for one character each. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["s", " "],
  ["t", "\t"],
]);

/** The escape whose backslash is at `at`, or null when it is not one this reads. */
function readEscape(source: string, at: number, to: number): StringPiece | null {
  const simple = ESCAPES.get(source.charAt(at + 1));
  if (simple !== undefined) {
    return { end: at + 2, start: at, text: simple, verbatim: false };
  }
  UNICODE.lastIndex = at + 1;
  const unicode = UNICODE.exec(source);
  if (unicode) {
    const point = Number.parseInt(unicode[1] ?? "", 16);
    // A surrogate is not a character, and KDL refuses one, so the parser never got this far.
    return point > 0x10_ff_ff || (point >= 0xd8_00 && point <= 0xdf_ff)
      ? null
      : { end: UNICODE.lastIndex, start: at, text: String.fromCodePoint(point), verbatim: false };
  }
  DISCARDED.lastIndex = at + 1;
  /* Whitespace cannot run past a closing quote, so the one way this passes `to` is from inside a
     line of a multi-line string, where it joins two lines and the line structure is not ours. */
  return DISCARDED.test(source) && DISCARDED.lastIndex <= to
    ? { end: DISCARDED.lastIndex, start: at, text: "", verbatim: false }
    : null;
}

/** The pieces of a stretch that holds no line structure. False when something in it is not read. */
function readRun(
  source: string,
  from: number,
  to: number,
  escapes: boolean,
  out: StringPiece[],
): boolean {
  let at = from;
  while (at < to) {
    const slash = escapes ? source.indexOf("\\", at) : -1;
    const stop = slash === -1 || slash >= to ? to : slash;
    if (stop > at) {
      out.push({ end: stop, start: at, text: source.slice(at, stop), verbatim: true });
    }
    if (stop === to) {
      break;
    }
    const escape = readEscape(source, stop, to);
    if (!escape) {
      return false;
    }
    out.push(escape);
    at = escape.end;
  }
  return true;
}

/** The lines of a stretch, each with where the next starts. */
function linesOf(source: string, from: number, to: number): Line[] {
  const lines: Line[] = [];
  let start = from;
  NEWLINE.lastIndex = from;
  for (;;) {
    const match = NEWLINE.exec(source);
    if (!match || match.index >= to) {
      lines.push({ end: to, next: to, start });
      return lines;
    }
    const next = match.index + match[0].length;
    lines.push({ end: match.index, next, start });
    start = next;
  }
}

/**
 * The pieces of a multi-line string: its lines without the indentation of the closing line, joined
 * by `\n` whatever the file's line endings are. False when its shape is not the one this reads.
 */
function readLines(
  source: string,
  from: number,
  to: number,
  escapes: boolean,
  out: StringPiece[],
): boolean {
  const lines = linesOf(source, from, to);
  const [first] = lines;
  const last = lines.at(-1);
  if (!first || !last || lines.length < 2 || first.end !== first.start) {
    return false;
  }
  const prefix = source.slice(last.start, last.end);
  if (!BLANK.test(prefix)) {
    return false;
  }
  const content = lines.slice(1, -1);
  for (const [index, line] of content.entries()) {
    const written = source.slice(line.start, line.end);
    const read =
      BLANK.test(written) ||
      (written.startsWith(prefix) &&
        readRun(source, line.start + prefix.length, line.end, escapes, out));
    if (!read) {
      return false;
    }
    if (index < content.length - 1) {
      out.push({
        end: line.next,
        start: line.end,
        text: "\n",
        verbatim: source.slice(line.end, line.next) === "\n",
      });
    }
  }
  return true;
}

/** The pieces of a token as this reads it, unchecked. Null when it is not a string this reads. */
function scan(source: string, span: JxnSpan): StringPiece[] | null {
  let open = span.start;
  while (source.charAt(open) === "#") {
    open += 1;
  }
  const hashes = open - span.start;
  if (source.charAt(open) !== '"') {
    // A bare word is its own value. With hashes and no quote it is a keyword, and not a string.
    return hashes === 0
      ? [
          {
            end: span.end,
            start: span.start,
            text: source.slice(span.start, span.end),
            verbatim: true,
          },
        ]
      : null;
  }
  const multiline = source.startsWith('"""', open);
  const quotes = multiline ? 3 : 1;
  const from = open + quotes;
  const to = span.end - quotes - hashes;
  if (to < from || source.slice(to, span.end) !== '"'.repeat(quotes) + "#".repeat(hashes)) {
    return null;
  }
  const out: StringPiece[] = [];
  const read = multiline ? readLines : readRun;
  return read(source, from, to, hashes === 0, out) ? out : null;
}

/** Join the runs that are one stretch of source, and drop the ones that hold nothing. */
function joined(pieces: readonly StringPiece[]): StringPiece[] {
  const out: StringPiece[] = [];
  for (const piece of pieces) {
    const before = out.at(-1);
    if (piece.text === "") {
      continue;
    }
    if (before?.verbatim && piece.verbatim && before.end === piece.start) {
      before.end = piece.end;
      before.text += piece.text;
    } else {
      out.push({ ...piece });
    }
  }
  return out;
}

/**
 * The runs of a string's value, in order, each beside the source it was written as.
 *
 * @param source The file.
 * @param span The string's token: a bare word, or everything from its first `#` or quote to its
 *   last.
 * @param value What the parser read the token as.
 * @returns Runs whose text spells `value`. An empty value has none.
 */
export function stringPieces(source: string, span: JxnSpan, value: string): StringPiece[] {
  const pieces = scan(source, span);
  if (pieces && pieces.map((piece) => piece.text).join("") === value) {
    return joined(pieces);
  }
  return joined([{ end: span.end, start: span.start, text: value, verbatim: false }]);
}
