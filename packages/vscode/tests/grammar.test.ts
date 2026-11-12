/**
 * What the grammar paints a `.jxn` file as (`spec.md` §22.6), asked of the engine VS Code runs it
 * with rather than read off its rules.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { JXN_ANNOTATIONS } from "@jxsuite/schema/jxn";

import { loadGrammar, paint, ROOT } from "./grammar";
import type { Painted } from "./grammar";

const grammar = await loadGrammar();

const ANNOTATION = "storage.type.annotation.jxn";
const ATTRIBUTE = "entity.other.attribute-name.jxn";
const BLOCK = "comment.block.jxn";
const CODE = "meta.embedded.block.typescript";
const DOUBLE = "string.quoted.double.jxn";
const RAW = "string.quoted.other.raw.jxn";
const TAG = "entity.name.tag.jxn";
const TRIPLE = "string.quoted.triple.jxn";
const WORD = "string.unquoted.jxn";

/** The opening and closing delimiters of a block of code. */
const OPENS = [RAW, "punctuation.definition.string.begin.jxn"];
const CLOSES = [RAW, "punctuation.definition.string.end.jxn"];

/** A file's lines as painted. */
const painted = (...lines: string[]): Painted[][] => paint(grammar, lines.join("\n"));

/** One line as painted. */
const line = (text: string): Painted[] => painted(text)[0] ?? [];

describe("a raw string", () => {
  test("on one line ends where it closes, so what follows is not string", () => {
    expect(line('c #"x"# #"y"# z')).toEqual([
      ["c", TAG],
      ['#"', RAW],
      ["x", RAW],
      ['"#', RAW],
      ['#"', RAW],
      ["y", RAW],
      ['"#', RAW],
      ["z", WORD],
    ]);
  });

  test("closes at as many hashes as opened it, and at no fewer", () => {
    expect(line('c ##"a"#b"## z')).toEqual([
      ["c", TAG],
      ['##"', RAW],
      ['a"#b', RAW],
      ['"##', RAW],
      ["z", WORD],
    ]);
  });
});

describe("a block of code", () => {
  test("is TypeScript between its delimiters, and the file again after them", () => {
    expect(painted('(fn)load ##"""', '  const a = "x";', '  """##', "after 1")).toEqual([
      [
        ["(fn)", ANNOTATION],
        ["load", "entity.name.function.jxn"],
        ['##"""', ...OPENS],
      ],
      [
        ["const", CODE, "storage.type.ts"],
        [" a = ", CODE],
        ['"', CODE, "string.quoted.double.ts"],
        ["x", CODE, "string.quoted.double.ts"],
        ['"', CODE, "string.quoted.double.ts"],
        [";", CODE],
      ],
      [['"""##', ...CLOSES]],
      [
        ["after", TAG],
        ["1", "constant.numeric.jxn"],
      ],
    ]);
  });

  test("is not closed by fewer hashes than opened it", () => {
    const [, inner, close, after] = painted('b ###"""', '  """#', '  """###', "after");
    expect(inner?.every(([, scope]) => scope === CODE)).toBe(true);
    expect(close).toEqual([['"""###', ...CLOSES]]);
    expect(after).toEqual([["after", TAG]]);
  });

  test("closes after a line of code that left a string open", () => {
    expect(painted('a #"""', '  const s = "x', '  """#').at(-1)).toEqual([['"""#', ...CLOSES]]);
  });
});

describe("a quoted string", () => {
  test("holds its escapes, and a quote that is escaped does not close it", () => {
    expect(line(String.raw`s "a\"b" t`)).toEqual([
      ["s", TAG],
      ['"', DOUBLE],
      ["a", DOUBLE],
      [String.raw`\"`, DOUBLE, "constant.character.escape.jxn"],
      ["b", DOUBLE],
      ['"', DOUBLE],
      ["t", WORD],
    ]);
  });

  test("of several lines runs to its closing quotes", () => {
    expect(painted('s """', "  t", '  """', "u")).toEqual([
      [
        ["s", TAG],
        ['"""', TRIPLE],
      ],
      [["  t", TRIPLE]],
      [['"""', TRIPLE]],
      [["u", TAG]],
    ]);
  });
});

describe("a comment", () => {
  test("runs to the end of its line", () => {
    expect(line("div // not { a block")).toEqual([
      ["div", TAG],
      ["// not { a block", "comment.line.double-slash.jxn"],
    ]);
  });

  test("in a block nests, and ends where the outermost one closes", () => {
    expect(line("/* a /* b */ c */ p")).toEqual([
      ["/*", BLOCK],
      [" a ", BLOCK],
      ["/*", BLOCK, BLOCK],
      [" b ", BLOCK, BLOCK],
      ["*/", BLOCK, BLOCK],
      [" c ", BLOCK],
      ["*/", BLOCK],
      ["p", WORD],
    ]);
  });

  test("of one node is marked where it begins, as the version line is", () => {
    expect(line("/- kdl-version 2")).toEqual([
      ["/-", "comment.block.slashdash.jxn"],
      ["kdl-version", WORD],
      ["2", "constant.numeric.jxn"],
    ]);
  });
});

describe("an annotation", () => {
  /** The words the grammar's rule for an annotation alone names. */
  function known(): string[] {
    // SAFETY: the grammar is this workspace's own file, and its annotation rule is a list of matches.
    const { repository } = JSON.parse(
      readFileSync(join(ROOT, "syntaxes/jxn.tmLanguage.json"), "utf8"),
    ) as { repository: { annotation: { patterns: { match: string; name?: string }[] } } };
    const rule = repository.annotation.patterns.find((pattern) => pattern.name === ANNOTATION);
    return /\(\?:([a-z|]+)\)/u.exec(rule?.match ?? "")?.[1]?.split("|") ?? [];
  }

  test("is one the parser reads, and each of those is one the grammar knows", () => {
    expect(known()).toEqual([...JXN_ANNOTATIONS].toSorted());
    for (const word of JXN_ANNOTATIONS) {
      expect(line(`(${word})"x"`)[0]).toEqual([`(${word})`, ANNOTATION]);
    }
  });

  test("that the parser refuses is painted as a mistake", () => {
    expect(line("(bad)y")).toEqual([
      ["(bad)", "invalid.illegal.annotation.jxn"],
      ["y", WORD],
    ]);
  });

  test("that names a function paints the name as one", () => {
    expect(line('(on)click #"go()"#').slice(0, 2)).toEqual([
      ["(on)", ANNOTATION],
      ["click", "entity.name.function.jxn"],
    ]);
  });
});

describe("a node", () => {
  test("is its name, then members, properties and values", () => {
    expect(line("div .dir=ltr $x=1 lang=en 10px #true -1.5e3 {")).toEqual([
      ["div", TAG],
      [".dir", ATTRIBUTE],
      ["=", "punctuation.separator.key-value.jxn"],
      ["ltr", WORD],
      ["$x", "keyword.other.jxn"],
      ["=", "punctuation.separator.key-value.jxn"],
      ["1", "constant.numeric.jxn"],
      ["lang", ATTRIBUTE],
      ["=", "punctuation.separator.key-value.jxn"],
      ["en", WORD],
      ["10px", WORD],
      ["#true", "constant.language.jxn"],
      ["-1.5e3", "constant.numeric.jxn"],
      ["{", "punctuation.section.block.begin.jxn"],
    ]);
  });

  test("may be a row of a list, which a number is not", () => {
    expect(painted('- "a"', "-1", "}; ")).toEqual([
      [
        ["-", TAG],
        ['"', DOUBLE],
        ["a", DOUBLE],
        ['"', DOUBLE],
      ],
      [["-1", "constant.numeric.jxn"]],
      [
        ["}", "punctuation.section.block.end.jxn"],
        [";", "punctuation.terminator.jxn"],
      ],
    ]);
  });
});
