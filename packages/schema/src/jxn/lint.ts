/**
 * What parses and still means something other than it says.
 *
 * KDL's `\s` is a space and `\b` a backspace, so `pattern="\s+"` and `"${x.replace(/\b/g, "")}"`
 * both parse cleanly and silently mean something else. JSON rejects `\s`, so this failure is new
 * with KDL, and it arrives exactly where people write code by hand. The parsed value has lost the
 * evidence, so this reads the source.
 */
import { locate } from "./errors.ts";

/** Something to warn about. */
export interface JxnWarning {
  column: number;
  line: number;
  message: string;
  offset: number;
}

const EXPLAIN = new Map([
  [
    "b",
    String.raw`\b in a quoted string is a backspace, not a word boundary. Use a raw string, like #"…"#, if this is a pattern.`,
  ],
  [
    "s",
    String.raw`\s in a quoted string is a space, not whitespace. Use a raw string, like #"…"#, if this is a pattern.`,
  ],
]);

/** What a walk over a file's text found, each only where a string could not be hiding it. */
interface JxnScan {
  comments: number;
  /** Where each backslash in a quoted string is. */
  escapes: number[];
}

/**
 * The `/- kdl-version 2` line a file may open with. It is a slashdash by spelling, but it says
 * which KDL the file is written in and holds nothing `.json` would lose, so it is not counted.
 */
const VERSION_MARKER = /^\uFEFF?\s*\/-[^\S\n]*kdl-version[^\S\n]+\d+[^\S\n]*(?:\n|$)/u;

/** Walk a file's text, knowing what is a string and what is a comment. */
function scanJxn(text: string): JxnScan {
  const scan: JxnScan = { comments: 0, escapes: [] };
  let index = VERSION_MARKER.exec(text)?.[0].length ?? 0;
  while (index < text.length) {
    if (text.startsWith("//", index)) {
      scan.comments += 1;
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", index)) {
      scan.comments += 1;
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else if (text.startsWith("/-", index)) {
      scan.comments += 1;
      index += 2;
    } else if (text.charAt(index) === "#" && /^#+"/u.test(text.slice(index, index + 16))) {
      // A raw string: nothing in it is an escape.
      const [hashes = ""] = /^#+/u.exec(text.slice(index)) ?? [];
      const open = index + hashes.length;
      const quote = text.startsWith('"""', open) ? '"""' : '"';
      const end = text.indexOf(quote + hashes, open + quote.length);
      index = end === -1 ? text.length : end + quote.length + hashes.length;
    } else if (text.charAt(index) === '"') {
      const quote = text.startsWith('"""', index) ? '"""' : '"';
      index += quote.length;
      while (index < text.length && !text.startsWith(quote, index)) {
        if (text.charAt(index) === "\\") {
          scan.escapes.push(index);
          index += 2;
        } else {
          index += 1;
        }
      }
      index += quote.length;
    } else {
      index += 1;
    }
  }
  return scan;
}

/**
 * Find the escapes in quoted strings that mean something other than a person likely meant.
 *
 * @param text The file.
 */
export function lintJxn(text: string): JxnWarning[] {
  return scanJxn(text).escapes.flatMap((index) => {
    const message = EXPLAIN.get(text.charAt(index + 1));
    return message ? [{ ...locate(text, index), message }] : [];
  });
}

/**
 * Count what `.json` has nowhere to keep: comments, and what a slashdash has commented out.
 *
 * @param text The file.
 */
export function countJxnComments(text: string): number {
  return scanJxn(text).comments;
}
