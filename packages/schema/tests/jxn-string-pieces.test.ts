/**
 * Where each character of a string's value was written (`spec.md` §23.3): every spelling KDL has
 * for a string, checked against what the parser read it as, and the token map that finds a string.
 */
import { describe, expect, test } from "bun:test";
import { parseJxnWithTokens } from "../src/jxn/index.ts";
import { stringPieces } from "../src/jxn/string-pieces.ts";
import type { StringPiece } from "../src/jxn/string-pieces.ts";

/** A `(fn)` body written as `spelling`, and what was read from it. */
function bodyOf(spelling: string, before = "div {\n  state {\n    (fn)go ", after = "\n  }\n}\n") {
  const source = `${before}${spelling}${after}`;
  const { document, tokens } = parseJxnWithTokens(source);
  const span = tokens.values.get("/state/go/body");
  // SAFETY: each test writes a `go` function whose body is one string.
  const value = (document.state as { go: { body: string } }).go.body;
  if (!span) {
    throw new Error("The body's token was not recorded");
  }
  return { pieces: stringPieces(source, span, value), source, span, value };
}

/** Each piece as `[text, source, verbatim]`. */
const shown = (source: string, pieces: readonly StringPiece[]) =>
  pieces.map((piece) => [piece.text, source.slice(piece.start, piece.end), piece.verbatim]);

/** What holds for every answer: the pieces spell the value, and a verbatim one is its source. */
function expectSound(read: ReturnType<typeof bodyOf>): void {
  expect(read.pieces.map((piece) => piece.text).join("")).toBe(read.value);
  for (const piece of read.pieces) {
    expect(piece.start).toBeGreaterThanOrEqual(read.span.start);
    expect(piece.end).toBeLessThanOrEqual(read.span.end);
    if (piece.verbatim) {
      expect(read.source.slice(piece.start, piece.end)).toBe(piece.text);
    }
  }
}

describe("a string on one line", () => {
  test("a quoted string is one run, without its quotes", () => {
    const read = bodyOf(`"state.count += 1"`);
    expect(shown(read.source, read.pieces)).toEqual([
      ["state.count += 1", "state.count += 1", true],
    ]);
    expectSound(read);
  });

  test("a bare word is its own value", () => {
    const read = bodyOf("x", "div {\n  state {\n    (fn)go a ");
    expect(shown(read.source, read.pieces)).toEqual([["x", "x", true]]);
  });

  test("an escape is one piece, and the text around it stays exact", () => {
    const read = bodyOf(String.raw`"a\tb\\c\"d\u{1F600}e\sf"`);
    expect(read.value).toBe('a\tb\\c"d\u{1F600}e f');
    expect(shown(read.source, read.pieces)).toEqual([
      ["a", "a", true],
      ["\t", String.raw`\t`, false],
      ["b", "b", true],
      ["\\", String.raw`\\`, false],
      ["c", "c", true],
      ['"', String.raw`\"`, false],
      ["d", "d", true],
      ["\u{1F600}", String.raw`\u{1F600}`, false],
      ["e", "e", true],
      [" ", String.raw`\s`, false],
      ["f", "f", true],
    ]);
    expectSound(read);
  });

  test("every single-character escape reads as the parser read it", () => {
    const read = bodyOf(String.raw`"\n\r\b\f"`);
    expect(read.value).toBe("\n\r\b\f");
    expectSound(read);
    expect(read.pieces.every((piece) => !piece.verbatim)).toBe(true);
  });

  test("a backslash before whitespace discards it, and what follows is still exact", () => {
    const read = bodyOf('"a\\   \n      b"');
    expect(read.value).toBe("ab");
    expect(shown(read.source, read.pieces)).toEqual([
      ["a", "a", true],
      ["b", "b", true],
    ]);
  });

  test("a raw string has no escapes, with any number of hashes", () => {
    for (const hashes of ["#", "##", "###"]) {
      const read = bodyOf(String.raw`${hashes}"a\n"b"${hashes}`);
      expect(read.value).toBe(String.raw`a\n"b`);
      expect(shown(read.source, read.pieces)).toEqual([
        [String.raw`a\n"b`, String.raw`a\n"b`, true],
      ]);
    }
  });

  test("an empty string has no pieces", () => {
    expect(bodyOf(`""`).pieces).toEqual([]);
  });

  test("multibyte text keeps its offsets in UTF-16", () => {
    const read = bodyOf(`"state.name = '日本語 😀'"`);
    expectSound(read);
    expect(read.pieces).toHaveLength(1);
  });
});

describe("a string over several lines", () => {
  test("each line is exact once its block's indentation is off, and a line feed is part of it", () => {
    const read = bodyOf(`"""\n      if (a) {\n        b();\n      }\n      """`);
    expect(read.value).toBe("if (a) {\n  b();\n}");
    expect(shown(read.source, read.pieces)).toEqual([
      ["if (a) {\n", "if (a) {\n", true],
      ["  b();\n", "  b();\n", true],
      ["}", "}", true],
    ]);
    expectSound(read);
  });

  test("a raw one reads the same way and keeps its backslashes", () => {
    const read = bodyOf(`#"""\n      a("\\n");\n      b\n      """#`);
    expect(read.value).toBe('a("\\n");\nb');
    expect(read.pieces.every((piece) => piece.verbatim)).toBe(true);
    expectSound(read);
  });

  test("CRLF line endings are a line feed in the value, as one piece each", () => {
    const read = bodyOf(`"""\r\n      a\r\n      b\r\n      """`);
    expect(read.value).toBe("a\nb");
    expect(shown(read.source, read.pieces)).toEqual([
      ["a", "a", true],
      ["\n", "\r\n", false],
      ["b", "b", true],
    ]);
  });

  test("tabs indent as well as spaces do", () => {
    const read = bodyOf(`"""\n\t\t\ta\n\t\t\t\tb\n\t\t\t"""`);
    expect(read.value).toBe("a\n\tb");
    expectSound(read);
    expect(read.pieces.every((piece) => piece.verbatim)).toBe(true);
  });

  test("a line of nothing but whitespace is an empty line", () => {
    const read = bodyOf(`"""\n      a\n   \n\n      b\n      """`);
    expect(read.value).toBe("a\n\n\nb");
    expectSound(read);
  });

  test("an escape inside a line is one piece", () => {
    const read = bodyOf(`"""\n      a\\tb\n      c\n      """`);
    expect(read.value).toBe("a\tb\nc");
    expect(shown(read.source, read.pieces)).toEqual([
      ["a", "a", true],
      ["\t", String.raw`\t`, false],
      ["b\n", "b\n", true],
      ["c", "c", true],
    ]);
  });

  test("an empty one has no pieces", () => {
    expect(bodyOf(`"""\n      """`).pieces).toEqual([]);
  });

  test("lines joined by a backslash are placed on the whole string, not on a wrong character", () => {
    const read = bodyOf(`"""\n      a\\\n      b\n      """`);
    expect(read.value).toBe("ab");
    expect(shown(read.source, read.pieces)).toEqual([
      ["ab", read.source.slice(read.span.start, read.span.end), false],
    ]);
  });
});

describe("a token that is not read", () => {
  /** The whole of `source` as one token, read as `value`. */
  const whole = (source: string, value: string) =>
    stringPieces(source, { end: source.length, start: 0 }, value);

  test("is one piece over the whole token", () => {
    const cases: [string, string][] = [
      // An escape KDL does not have.
      [String.raw`"a\qb"`, "ab"],
      // A code point past the last one, and a surrogate.
      [String.raw`"\u{110000}"`, "x"],
      [String.raw`"\u{D800}"`, "x"],
      // A keyword rather than a string.
      ["#true", "true"],
      // Quotes that do not close as they opened.
      ['#"abc"', "abc"],
      ['"', "x"],
      // A multi-line string with text on its first line, and with text before its closing quotes.
      ['"""a\n  b\n  """', "b"],
      ['"""\n  b\n  c"""', "b"],
      // A line that does not carry the closing line's indentation.
      ['"""\n b\n    """', "b"],
      // No line structure at all.
      ['""""""', "x"],
    ];
    for (const [source, value] of cases) {
      expect(whole(source, value)).toEqual([
        { end: source.length, start: 0, text: value, verbatim: false },
      ]);
    }
  });

  test("is one piece when the runs do not spell what the parser read", () => {
    expect(whole('"abc"', "something else")).toEqual([
      { end: 5, start: 0, text: "something else", verbatim: false },
    ]);
  });
});

describe("the token map", () => {
  const source = [
    "$layout #false",
    "div {",
    '  script #"""',
    "    export const a = 1;",
    '    """#',
    '  script timing=server "export const b = 2;"',
    "  state {",
    "    count 0",
    '    "my key" "v"',
    "    wide a=1 {",
    "      b 2",
    "    }",
    '    (fn)go x y "x + y"',
    "    (fn)steps x {",
    '      - "a"',
    "    }",
    '    (export)greet $export="hello"',
    "    (server)load id=1",
    "  }",
    "  button {",
    '    (fn)onclick "state.go(1, 2)"',
    "    state {",
    "      local 1",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const { tokens } = parseJxnWithTokens(source);
  const text = (span: { end: number; start: number } | undefined) =>
    span ? source.slice(span.start, span.end) : null;

  test("names are the name alone, quotes included when written with them", () => {
    expect(text(tokens.names.get("/state/count"))).toBe("count");
    expect(text(tokens.names.get("/state/my key"))).toBe('"my key"');
    expect(text(tokens.names.get("/state/go"))).toBe("go");
    expect(text(tokens.names.get("/state/greet"))).toBe("greet");
    expect(text(tokens.names.get("/state/load"))).toBe("load");
    expect(text(tokens.names.get("/state/wide/a"))).toBe("a");
    expect(text(tokens.names.get("/state/wide/b"))).toBe("b");
    expect(text(tokens.names.get("/children/0/state/local"))).toBe("local");
  });

  test("values are the token as written", () => {
    expect(text(tokens.values.get("/$layout"))).toBe("#false");
    expect(text(tokens.values.get("/$script/client"))).toBe(
      '#"""\n    export const a = 1;\n    """#',
    );
    expect(text(tokens.values.get("/$script/server"))).toBe('"export const b = 2;"');
    expect(text(tokens.values.get("/state/count"))).toBe("0");
    expect(text(tokens.values.get("/state/wide/a"))).toBe("1");
    expect(text(tokens.values.get("/state/go/body"))).toBe('"x + y"');
    expect(text(tokens.values.get("/state/go/parameters/0"))).toBe("x");
    expect(text(tokens.values.get("/state/go/parameters/1"))).toBe("y");
    expect(text(tokens.values.get("/state/greet/$export"))).toBe('"hello"');
    expect(text(tokens.values.get("/children/0/onclick/body"))).toBe('"state.go(1, 2)"');
  });

  test("a structured body has parameters and no body token", () => {
    expect(text(tokens.values.get("/state/steps/parameters/0"))).toBe("x");
    expect(tokens.values.has("/state/steps/body")).toBe(false);
  });
});
