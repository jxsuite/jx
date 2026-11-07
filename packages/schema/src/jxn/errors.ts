/** What is wrong with a `.jxn` file, and where. */

/** A place in a `.jxn` file. Offsets count UTF-16 code units, as a JavaScript string does. */
export interface JxnSpan {
  /** One past the last character. */
  end: number;
  start: number;
}

/** A `.jxn` file that is not a Jx document. */
export class JxnError extends Error {
  /** One-based, when the problem has a place. */
  readonly column: number | null;
  /** One-based, when the problem has a place. */
  readonly line: number | null;
  /** The offset of the problem, when it has a place. */
  readonly offset: number | null;

  /**
   * @param message What is wrong.
   * @param where Where, when known.
   */
  constructor(
    message: string,
    where: { column: number; line: number; offset: number } | null = null,
  ) {
    super(where ? `${message} (line ${where.line}, column ${where.column})` : message);
    this.name = "JxnError";
    this.column = where?.column ?? null;
    this.line = where?.line ?? null;
    this.offset = where?.offset ?? null;
  }
}

/**
 * The line and column of an offset.
 *
 * @param text The file.
 * @param offset The offset.
 */
export function locate(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { column: offset - before.lastIndexOf("\n"), line, offset };
}
