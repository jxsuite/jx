/**
 * Where a position is in a `.jxn` file that may not parse (`spec.md` §22.6).
 *
 * Each case writes the file with a `|` where the position is. What is asserted is what a completion
 * needs of it: what would be typed there, the text an offer replaces, and the nodes around it.
 */
import { describe, expect, test } from "bun:test";
import { outlineJxn } from "../src/jxn/outline.ts";
import type { OutlineEntry, OutlineNode, OutlineSlot } from "../src/jxn/outline.ts";

/** A position as a case states it. */
interface Seen {
  /** The value the position is in or annotates. */
  entry: OutlineEntry | null;
  /** The name of the node whose line the position is on. */
  node: string | null;
  /** The names of the nodes whose blocks hold it. */
  path: string[];
  quoted: boolean;
  /** The text an offer replaces. */
  replaces: string;
  slot: OutlineSlot;
}

/** A case, split at its `|`. */
interface Marked {
  offset: number;
  text: string;
}

/** Split a case at its `|`. */
function marked(source: string): Marked {
  const offset = source.indexOf("|");
  if (offset === -1) {
    throw new Error("the case marks no position");
  }
  return { offset, text: source.slice(0, offset) + source.slice(offset + 1) };
}

/** The position marked in a file, or null where nothing is offered at it. */
function seen(source: string): Seen | null {
  const { offset, text } = marked(source);
  const { cursor } = outlineJxn(text, offset);
  if (!cursor) {
    return null;
  }
  expect(cursor.start).toBeLessThanOrEqual(offset);
  expect(cursor.end).toBeGreaterThanOrEqual(offset);
  return {
    entry: cursor.entry,
    node: cursor.node?.name ?? null,
    path: cursor.path.map((node) => node.name),
    quoted: cursor.quoted,
    replaces: text.slice(cursor.start, cursor.end),
    slot: cursor.slot,
  };
}

/** A node as a case states it: its name and annotation, its line, and its block. */
type Sketch = [name: string, entries: string[], children?: Sketch[]];

function sketch(node: OutlineNode): Sketch {
  const name = node.annotation === null ? node.name : `(${node.annotation})${node.name}`;
  const entries = node.entries.map((entry) => {
    const value = entry.annotation === null ? "_" : `(${entry.annotation})_`;
    return entry.key === null ? value : `${entry.key}=${value}`;
  });
  return node.children ? [name, entries, node.children.map(sketch)] : [name, entries];
}

const sketches = (text: string): Sketch[] => outlineJxn(text, 0).nodes.map(sketch);

describe("the nodes of a file", () => {
  test("are read with their names, annotations, lines and blocks", () => {
    const text = [
      "$layout #false",
      'div class="a b" .hidden=#true "text" {',
      '  (fn)onclick "state.count += 1"',
      '  "quoted name" 1 2',
      '  button "Go" onclick=(ref)"#/state/bump"',
      '  - (ref)"#/state/count"',
      "  p; q",
      "}",
    ].join("\n");
    expect(sketches(text)).toEqual([
      ["$layout", ["_"]],
      [
        "div",
        ["class=_", ".hidden=_", "_"],
        [
          ["(fn)onclick", ["_"]],
          ["quoted name", ["_", "_"]],
          ["button", ["_", "onclick=(ref)_"]],
          ["-", ["(ref)_"]],
          ["p", []],
          ["q", []],
        ],
      ],
    ]);
  });

  test("are read past everything that is not one", () => {
    const text = [
      "\u{FEFF}/- kdl-version 2",
      "// a line of comment",
      String.raw`/* a block /* of */ comment */ div /* between */ a=1 \ // carried on`,
      "  b=2 /-c=3 /- (ref)d /-{",
      "    gone",
      "  } {",
      "  p",
      "  /- span {",
      "    gone",
      "  }",
      "  /-",
      "  em x=1",
      "  q",
      "}",
    ].join("\n");
    // A slashdash comments out what follows it: a node with its block, a value, a block.
    expect(sketches(text)).toEqual([
      [
        "div",
        ["a=_", "b=_"],
        [
          ["p", []],
          ["q", []],
        ],
      ],
    ]);
    // One with nothing after it comments out nothing, and the block it is in still ends.
    expect(sketches("div {\n  p\n  /-\n}\nq /-")).toEqual([
      ["div", [], [["p", []]]],
      ["q", []],
    ]);
  });

  test("are read where the file does not parse", () => {
    // A block left open ends with the file, and a string left open ends at its line.
    expect(sketches('div {\n  p "open\n  span {\n    b')).toEqual([
      [
        "div",
        [],
        [
          ["p", ["_"]],
          ["span", [], [["b", []]]],
        ],
      ],
    ]);
    // What belongs nowhere is stepped over: a stray close, an `=` with no name, a lone bracket.
    expect(sketches("}\n= ) ]\ndiv a= [ b")).toEqual([["div", ["a=_", "_"]]]);
    expect(sketches("div {\n}\n}\np")).toEqual([
      ["div", [], []],
      ["p", []],
    ]);
  });

  test("hold their code as one value, whatever is in it", () => {
    const text = [
      "div {",
      '  script #"""',
      "    export const a = () => { return `}`; };",
      '    """#',
      '  (fn)a ##"say "#hi"# {"##',
      '  p """',
      '    lines "of" text {',
      '    """',
      String.raw`  q "an \" escaped { quote"`,
      "  r",
      "}",
    ].join("\n");
    expect(sketches(text)).toEqual([
      [
        "div",
        [],
        [
          ["script", ["_"]],
          ["(fn)a", ["_"]],
          ["p", ["_"]],
          ["q", ["_"]],
          ["r", []],
        ],
      ],
    ]);
  });

  test("keep an annotation that is not closed, and a name in raw quotes", () => {
    expect(sketches('(fn name\n( ref ) other\n#"raw name"# 1\n"""\n  lines\n  """ 2')).toEqual([
      ["(fn)name", []],
      ["(ref)other", []],
      ["raw name", ["_"]],
      ["\n  lines\n  ", ["_"]],
    ]);
  });
});

describe("a position where a node begins", () => {
  test("is a name with nothing to replace, in the block it is in", () => {
    expect(seen("|")).toEqual({
      entry: null,
      node: null,
      path: [],
      quoted: false,
      replaces: "",
      slot: "name",
    });
    expect(seen("div {\n  |\n}")).toMatchObject({ node: null, path: ["div"], slot: "name" });
    expect(seen("div {\n  state {\n    count 0\n    |\n  }\n}")).toMatchObject({
      path: ["div", "state"],
      slot: "name",
    });
    expect(seen("div {\n  p\n}\n|")).toMatchObject({ path: [], slot: "name" });
    // After a node that ends with `;`, and in a block that is never closed.
    expect(seen("div { p; | }")).toMatchObject({ path: ["div"], slot: "name" });
    expect(seen("$media {\n  |")).toMatchObject({ path: ["$media"], slot: "name" });
  });

  test("is the name it is in, which an offer replaces", () => {
    expect(seen("div {\n  bu|\n}")).toEqual({
      entry: null,
      node: "bu",
      path: ["div"],
      quoted: false,
      replaces: "bu",
      slot: "name",
    });
    expect(seen("div {\n  bu|tton x=1\n}")).toMatchObject({ replaces: "button", slot: "name" });
    expect(seen("$la|")).toMatchObject({ path: [], replaces: "$la", slot: "name" });
    expect(seen("div {\n  .chil|\n}")).toMatchObject({ replaces: ".chil", slot: "name" });
    expect(seen("div {\n  (fn)on|\n}")).toMatchObject({ node: "on", replaces: "on" });
  });

  test("sees the nodes written after it", () => {
    const { offset, text } = marked("div {\n  |\n  state\n  style\n}");
    const { cursor } = outlineJxn(text, offset);
    expect(cursor?.path[0]?.children?.map((node) => node.name)).toEqual(["state", "style"]);
  });
});

describe("a position on a node's line", () => {
  test("is an entry with nothing to replace, where nothing is written", () => {
    expect(seen("div {\n  button |\n}")).toEqual({
      entry: null,
      node: "button",
      path: ["div"],
      quoted: false,
      replaces: "",
      slot: "entry",
    });
    expect(seen("div a=1 | b=2")).toMatchObject({ node: "div", replaces: "", slot: "entry" });
    expect(seen("div a=1 | {")).toMatchObject({ node: "div", slot: "entry" });
    expect(seen('div "a" |')).toMatchObject({ node: "div", slot: "entry" });
    // A line carried on is the same line.
    expect(seen("div a=1 \\\n  |")).toMatchObject({ node: "div", path: [], slot: "entry" });
  });

  test("is the word it is in, with the `=` a name already has", () => {
    expect(seen("div {\n  button oncl|\n}")).toEqual({
      entry: { annotation: null, key: null },
      node: "button",
      path: ["div"],
      quoted: false,
      replaces: "oncl",
      slot: "entry",
    });
    expect(seen('div {\n  button oncl|ick=(ref)"#/state/x"\n}')).toMatchObject({
      entry: { annotation: "ref", key: "onclick" },
      replaces: "onclick=",
      slot: "entry",
    });
    expect(seen("div #tr|")).toMatchObject({ replaces: "#tr", slot: "entry" });
  });

  test("is a value after `name=`, with or without an annotation", () => {
    expect(seen("div dir=|")).toEqual({
      entry: { annotation: null, key: "dir" },
      node: "div",
      path: [],
      quoted: false,
      replaces: "",
      slot: "value",
    });
    expect(seen("div dir=l|tr x")).toMatchObject({ replaces: "ltr", slot: "value" });
    expect(seen("div .hidden=#t|")).toMatchObject({ replaces: "#t", slot: "value" });
    expect(seen("div onclick=(ref)|")).toMatchObject({
      entry: { annotation: "ref", key: "onclick" },
      replaces: "",
      slot: "value",
    });
    expect(seen("div {\n  - (ref)|\n}")).toMatchObject({
      entry: { annotation: "ref", key: null },
      node: "-",
      slot: "value",
    });
  });

  test("is the inside of the string it is in", () => {
    expect(seen('div dir="|"')).toEqual({
      entry: { annotation: null, key: "dir" },
      node: "div",
      path: [],
      quoted: true,
      replaces: "",
      slot: "value",
    });
    expect(seen('div onclick=(ref)"#/st|ate/x" a=1')).toMatchObject({
      entry: { annotation: "ref", key: "onclick" },
      quoted: true,
      replaces: "#/state/x",
    });
    // One left open ends at its line.
    expect(seen('div {\n  p dir="lt|\n}')).toMatchObject({ quoted: true, replaces: "lt" });
    expect(seen('div "te|xt"')).toMatchObject({
      entry: { annotation: null, key: null },
      quoted: true,
      replaces: "text",
    });
    expect(seen(String.raw`div "a \" b|"`)).toMatchObject({ replaces: String.raw`a \" b` });
  });

  test("is an annotation between parentheses", () => {
    expect(seen("div {\n  (|\n}")).toEqual({
      entry: null,
      node: "",
      path: ["div"],
      quoted: false,
      replaces: "",
      slot: "annotation",
    });
    expect(seen("div {\n  (f|)onclick\n}")).toMatchObject({
      node: "onclick",
      replaces: "f",
      slot: "annotation",
    });
    expect(seen("div onclick=(|)")).toMatchObject({
      entry: { annotation: "", key: "onclick" },
      node: "div",
      slot: "annotation",
    });
    expect(seen('div {\n  - (re|)"#/state/x"\n}')).toMatchObject({
      entry: { annotation: "re", key: null },
      replaces: "re",
      slot: "annotation",
    });
  });
});

describe("a position nothing is offered at", () => {
  test("is in a comment", () => {
    expect(seen("div { // a |comment\n}")).toBeNull();
    expect(seen("div a=1 // a comment|")).toBeNull();
    expect(seen("div /* a | b */ x")).toBeNull();
    expect(seen("div /* never closed |")).toBeNull();
    expect(seen("// before any node|\ndiv")).toBeNull();
    expect(seen("div \\ // after a line is carried on|\n  a=1")).toBeNull();
  });

  test("is in what a slashdash comments out", () => {
    expect(seen("/- kdl|-version 2\ndiv")).toBeNull();
    expect(seen("/- kdl-version 2|\ndiv")).toBeNull();
    expect(seen("/-| div")).toBeNull();
    expect(seen("div /-a=| b=1")).toBeNull();
    expect(seen("div /-{\n  |\n}")).toBeNull();
    expect(seen("div {\n  /- p {\n    |\n  }\n}")).toBeNull();
    // What follows it is read as it would have been.
    expect(seen("/- kdl-version 2\n|")).toMatchObject({ path: [], slot: "name" });
    expect(seen("div /-a=1 b=|")).toMatchObject({
      entry: { annotation: null, key: "b" },
      node: "div",
      slot: "value",
    });
    expect(seen("div /-{\n  p\n} {\n  |\n}")).toMatchObject({ path: ["div"], slot: "name" });
  });

  test("is in code", () => {
    expect(seen('div {\n  script #"""\n    a |\n    """#\n}')).toBeNull();
    expect(seen('div {\n  p """\n    a |\n    """\n}')).toBeNull();
    expect(seen('div {\n  (fn)a #"state.|"#\n}')).toBeNull();
    expect(seen('div {\n  script #"""\n    never closed |')).toBeNull();
  });

  test("is in a name that is quoted, or against a string that is closed", () => {
    expect(seen('div {\n  "quoted| name" 1\n}')).toBeNull();
    expect(seen('div "a"|')).toBeNull();
    expect(seen('div dir="ltr"| x')).toBeNull();
    expect(seen('div dir=(ref)|"x"')).toBeNull();
  });

  test("is outside the file", () => {
    expect(outlineJxn("div", 9).cursor).toBeNull();
    expect(outlineJxn("div", -1).cursor).toBeNull();
  });
});

describe("the edges of a comment and of a word", () => {
  test("a position against a comment is not in it", () => {
    expect(seen("div |// comment")).toMatchObject({ node: "div", slot: "entry" });
    expect(seen("div /* a */| x")).toMatchObject({ node: "div", slot: "entry" });
    expect(seen("|/* a */ div")).toMatchObject({ slot: "name" });
  });

  test("a position before a word is where the word would be typed, and after it is in it", () => {
    expect(seen("div {\n  |p\n}")).toMatchObject({ node: null, replaces: "", slot: "name" });
    expect(seen("div {\n  p|\n}")).toMatchObject({ node: "p", replaces: "p", slot: "name" });
    expect(seen("div |a=1")).toMatchObject({ replaces: "", slot: "entry" });
    expect(seen("div a|=1")).toMatchObject({ replaces: "a=", slot: "entry" });
    expect(seen("div a=|1")).toMatchObject({ replaces: "1", slot: "value" });
  });
});
