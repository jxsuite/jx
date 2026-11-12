/**
 * What a `.jxn` file may hold at a position (`spec.md` §22.6).
 *
 * Each case writes the file with a `|` where the position is. The small schemas below say exactly
 * what is offered, so a case states the whole list. The committed core schema is asked last, flat
 * and nested the way a project's composed schema nests it, for what a small schema cannot show:
 * that an element and a `$array` row are found by what they are.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completeJxn } from "../src/jxn/complete.ts";
import type { JxnCompletion } from "../src/jxn/complete.ts";
import type { ComposedProjectSchemas } from "../src/project-schemas.ts";
import { flattenSchema } from "../src/project-schemas.ts";
import type { JsonObject } from "../types.ts";

/** A document's schema, with one of everything the reader asks a schema for. */
const DOCUMENT: JsonObject = {
  $defs: {
    Children: {
      oneOf: [
        { items: { anyOf: [{ $ref: "#/$defs/Element" }, { type: "string" }] }, type: "array" },
        { $ref: "#/$defs/Repeater" },
      ],
    },
    Element: {
      properties: {
        $map: {},
        "$map/item": {},
        $props: { description: "What a component is given.", properties: { size: {} } },
        attributes: { additionalProperties: { type: "string" } },
        children: { $ref: "#/$defs/Children" },
        dir: { description: "Which way text runs.", enum: ["ltr", "rtl"] },
        hidden: { type: "boolean" },
        onclick: { description: "A click." },
        oninput: {},
        state: { additionalProperties: { properties: { default: {}, type: { enum: ["a"] } } } },
        style: { $ref: "#/$defs/Style" },
        tagName: { $ref: "#/$defs/Tag" },
        title: { examples: ['say "hi"', "plain", 2], type: "string" },
      },
    },
    Repeater: {
      properties: {
        $prototype: { const: "Array" },
        filter: {},
        items: { description: "What is repeated." },
        key: { examples: ["id"] },
        map: { $ref: "#/$defs/Element" },
      },
    },
    Style: {
      additionalProperties: { $ref: "#/$defs/Style" },
      properties: { color: { examples: ["red"] }, display: { enum: ["block", "none"] } },
    },
    Tag: { examples: ["div", "p"], type: "string" },
  },
  properties: {
    $head: { type: "array" },
    $layout: {
      description: "The layout a page is put in.",
      examples: ["./base.json"],
      oneOf: [{ type: "string" }, { const: false, type: "boolean" }],
    },
    $paths: { items: { enum: ["a", "b"] }, type: "array" },
    $ref: { type: "string" },
    children: { $ref: "#/$defs/Children" },
    lang: { description: "The language of the document." },
    state: { additionalProperties: { properties: { default: {}, type: { enum: ["doc"] } } } },
    tagName: { $ref: "#/$defs/Tag" },
  },
};

/** A project file's schema. */
const PROJECT: JsonObject = {
  $defs: { Style: { properties: { color: {}, margin: {} } } },
  properties: {
    $media: { additionalProperties: { $ref: "#/$defs/Style" } },
    build: {
      properties: { adapter: { enum: ["node", "cloudflare"] }, minify: { type: "boolean" } },
    },
    extensions: { items: { examples: ["@jxsuite/parser"], type: "string" }, type: "array" },
    mixed: {
      oneOf: [{ items: { enum: ["x"] }, type: "array" }, { properties: { one: {}, two: {} } }],
    },
    name: { type: "string" },
    state: {},
    style: { $ref: "#/$defs/Style" },
  },
};

const SMALL: ComposedProjectSchemas = { document: DOCUMENT, project: PROJECT };

/** What is offered at the `|` of a case. */
function offers(source: string, schemas: ComposedProjectSchemas = SMALL): JxnCompletion[] {
  return completeJxn(source.replace("|", ""), source.indexOf("|"), schemas).items;
}

/** What is offered at the `|` of a case, as each offer is listed. */
const labels = (source: string, schemas: ComposedProjectSchemas = SMALL): string[] =>
  offers(source, schemas).map((item) => item.label);

/** What accepting each offer writes, where that is not what it is listed as. */
const inserts = (source: string): string[] => offers(source).map((item) => item.insert);

/** A document whose root element has state, with the position somewhere in it. */
const stateful = (inside: string): string =>
  [
    "div {",
    "  state {",
    "    count 0",
    '    (fn)bump "state.count += 1"',
    '    (export)load ""',
    '    "a/b" 1',
    "  }",
    inside,
    "}",
  ].join("\n");

describe("the stretch an offer replaces", () => {
  test("is the word the position is in, and the position itself where there is none", () => {
    expect(completeJxn("div {\n  bu\n}", 10, SMALL)).toMatchObject({ end: 10, start: 8 });
    expect(completeJxn("div {\n  \n}", 8, SMALL)).toMatchObject({ end: 8, start: 8 });
  });

  test("is the position where nothing is offered, with nothing offered", () => {
    expect(completeJxn("div // a comment", 12, SMALL)).toEqual({ end: 12, items: [], start: 12 });
  });
});

describe("the top of a document", () => {
  test("offers the tag names and then the document's `$` members", () => {
    expect(labels("|")).toEqual(["div", "p", "$head", "$layout", "$paths", "$ref"]);
    expect(offers("|")[0]).toEqual({ insert: "div", kind: "element", label: "div" });
    expect(offers("|")[3]).toEqual({
      detail: "The layout a page is put in.",
      insert: "$layout",
      kind: "member",
      label: "$layout",
    });
  });

  test("leaves out what is written, and the tag names once there is a root", () => {
    expect(labels("$layout #false\n|")).toEqual(["div", "p", "$head", "$paths", "$ref"]);
    expect(labels("$layout #false\n|\ndiv")).toEqual(["$head", "$paths", "$ref"]);
    expect(labels('$element "x-card"\n|')).toEqual(["$head", "$layout", "$paths", "$ref"]);
    expect(labels("$array items=1\n|")).toEqual(["$head", "$layout", "$paths", "$ref"]);
    expect(labels("$array |")).toEqual(["filter=", "items=", "key="]);
    // The name being typed is not one that is taken.
    expect(labels("$lay|")).toEqual(["div", "p", "$head", "$layout", "$paths", "$ref"]);
  });

  test("offers a member's values on its line, as the writer spells each", () => {
    expect(labels("$layout |")).toEqual(["#false", '"./base.json"']);
    expect(labels('$layout "|"')).toEqual(["./base.json"]);
    expect(labels("$paths |")).toEqual(["a", "b"]);
    expect(labels("$paths {\n  |\n}")).toEqual(["-"]);
    expect(labels("$paths {\n  - |\n}")).toEqual(["a", "b"]);
    expect(labels("$unknown |")).toEqual([]);
    expect(labels("$unknown {\n  |\n}")).toEqual([]);
  });

  test("offers nothing in `$head`", () => {
    expect(labels("$head {\n  |\n}")).toEqual([]);
    expect(labels("$head {\n  meta |\n}")).toEqual([]);
    expect(labels("$head {\n  meta charset=|\n}")).toEqual([]);
  });

  test("offers the annotations a top-level node may carry", () => {
    expect(labels("(|")).toEqual(["object", "array"]);
    expect(offers("(|")[0]).toEqual({
      detail: "A JSON block that is an object, where its contents would not say so.",
      insert: "object",
      kind: "annotation",
      label: "object",
    });
  });
});

describe("the block of an element", () => {
  test("offers its child nodes, the tag names, and its members", () => {
    expect(labels("div {\n  |\n}")).toEqual([
      "state",
      "style",
      "attributes",
      "script",
      "div",
      "p",
      "-",
      "$array",
      "$element",
      "$map",
      "$props",
      ".children",
      ".dir",
      ".hidden",
      ".title",
      ".lang",
    ]);
    // What only the document's root holds is not offered below it.
    expect(labels("div {\n  p {\n    |\n  }\n}")).toEqual([
      "state",
      "style",
      "attributes",
      "div",
      "p",
      "-",
      "$array",
      "$element",
      "$map",
      "$props",
      ".children",
      ".dir",
      ".hidden",
      ".title",
    ]);
  });

  test("leaves out the members that are written, and never an element", () => {
    const got = labels("div {\n  state\n  script\n  .dir ltr\n  $props\n  p\n  |\n}");
    expect(got).toEqual([
      "style",
      "attributes",
      "div",
      "p",
      "-",
      "$array",
      "$element",
      "$map",
      ".children",
      ".hidden",
      ".title",
      ".lang",
    ]);
  });

  test("offers a handler's name after `(fn)` or `(on)`", () => {
    expect(labels("div {\n  (fn)|\n}")).toEqual(["onclick", "oninput"]);
    expect(labels("div {\n  (on)on|\n}")).toEqual(["onclick", "oninput"]);
    expect(labels('div {\n  (fn)onclick ""\n  (fn)|\n}')).toEqual(["oninput"]);
    expect(offers("div {\n  (fn)|\n}")[0]).toMatchObject({ detail: "A click.", kind: "member" });
  });

  test("offers the annotations a child node may carry", () => {
    expect(labels("div {\n  (|\n}")).toEqual(["fn", "on", "object", "array"]);
    expect(labels("div {\n  state {\n    (|\n  }\n}")).toEqual([
      "fn",
      "export",
      "server",
      "object",
      "array",
    ]);
    expect(labels("div {\n  style {\n    (|\n  }\n}")).toEqual(["array"]);
    expect(labels("div {\n  .map {\n    (|\n  }\n}")).toEqual([]);
  });

  test("offers nothing in what is code or text", () => {
    expect(labels("div {\n  (fn)onclick |\n}")).toEqual([]);
    expect(labels("div {\n  (on)onclick {\n    |\n  }\n}")).toEqual([]);
    expect(labels("div {\n  - |\n}")).toEqual([]);
    expect(labels('div {\n  - "|"\n}')).toEqual([]);
    expect(labels("div {\n  state {\n    (fn)bump |\n  }\n}")).toEqual([]);
    expect(labels("div {\n  state {\n    (export)load {\n      |\n    }\n  }\n}")).toEqual([]);
  });

  test("reads `script` in the root alone", () => {
    expect(labels("div {\n  script |\n}")).toEqual(["timing=server"]);
    expect(labels("div {\n  script timing=|\n}")).toEqual(["server"]);
    expect(labels('div {\n  script timing="|"\n}')).toEqual(["server"]);
    expect(labels("div {\n  script timing=server |\n}")).toEqual([]);
    expect(labels("div {\n  script other=|\n}")).toEqual([]);
    expect(labels("div {\n  script {\n    |\n  }\n}")).toEqual([]);
    expect(labels("div {\n  p {\n    script |\n  }\n}")).toEqual([]);
  });
});

describe("an element's line", () => {
  test("offers its members, each with its `=`", () => {
    expect(labels("div |")).toEqual([
      ".children=",
      ".dir=",
      ".hidden=",
      ".title=",
      ".lang=",
      "$map=",
      "$props=",
      "onclick=",
      "oninput=",
    ]);
    expect(offers("div |")[1]).toEqual({
      detail: "Which way text runs.",
      insert: ".dir=",
      kind: "member",
      label: ".dir=",
    });
    expect(labels("div {\n  p |\n}")).not.toContain(".lang=");
  });

  test("leaves out the names that are written, but for the one being typed", () => {
    expect(labels('div .dir=ltr onclick=(ref)"#/state/x" class="a" |')).toEqual([
      ".children=",
      ".hidden=",
      ".title=",
      ".lang=",
      "$map=",
      "$props=",
      "oninput=",
    ]);
    expect(labels("div .di|r=ltr")).toContain(".dir=");
  });

  test("offers a member's values, and none for an attribute", () => {
    expect(labels("div .dir=|")).toEqual(["ltr", "rtl"]);
    expect(labels('div .dir="|"')).toEqual(["ltr", "rtl"]);
    expect(labels("div .hidden=|")).toEqual(["#true", "#false"]);
    expect(labels("div .lang=|")).toEqual([]);
    expect(labels("div $props=|")).toEqual([]);
    expect(labels("div class=|")).toEqual([]);
    expect(labels("div dir=|")).toEqual([]);
    expect(labels("div .unknown=|")).toEqual([]);
    expect(labels('div "|"')).toEqual([]);
  });

  test("spells a value as the writer would, and inside quotes offers only what fits", () => {
    expect(labels("div .title=|")).toEqual(['#"say "hi""#', "plain", "2"]);
    expect(labels('div .title="|"')).toEqual(["plain"]);
    expect(labels('div .hidden="|"')).toEqual([]);
  });

  test("offers the tag names after `$element`, for its first value", () => {
    expect(labels("div {\n  $element |\n}").slice(0, 3)).toEqual(["div", "p", ".children="]);
    expect(labels('div {\n  $element "|"\n}')).toEqual(["div", "p"]);
    expect(labels('div {\n  $element "x-card" |\n}')).not.toContain("div");
    expect(labels('div {\n  $element "x-card" "|"\n}')).toEqual([]);
    expect(labels("$element |").slice(0, 2)).toEqual(["div", "p"]);
  });

  test("offers `ref` as the one annotation of a value", () => {
    expect(labels("div onclick=(|)")).toEqual(["ref"]);
    expect(labels("div {\n  - (|\n}")).toEqual(["ref"]);
  });

  test("offers nothing under an annotation that is not `ref`", () => {
    expect(labels("div .dir=(fn)|")).toEqual([]);
  });
});

describe("a pointer", () => {
  test("is offered for a handler: the functions of the file's state", () => {
    expect(labels(stateful("  button onclick=|"))).toEqual(["#/state/bump", "#/state/load"]);
    expect(inserts(stateful("  button onclick=|"))).toEqual([
      '(ref)"#/state/bump"',
      '(ref)"#/state/load"',
    ]);
    expect(inserts(stateful("  button onclick=(ref)|"))).toEqual([
      '"#/state/bump"',
      '"#/state/load"',
    ]);
    expect(inserts(stateful('  button onclick=(ref)"|"'))).toEqual([
      "#/state/bump",
      "#/state/load",
    ]);
  });

  test("is offered under the version marker a file opens with, and nothing in the marker", () => {
    const file = (inside: string): string => `/- kdl-version 2\n${stateful(inside)}`;
    expect(labels(file("  button onclick=|"))).toEqual(["#/state/bump", "#/state/load"]);
    expect(labels(file("  button onclick=1").replace("kdl-version ", "kdl-version |"))).toEqual([]);
    expect(labels(file("  /- button onclick=|"))).toEqual([]);
  });

  test("is offered after `(ref)`: every entry, with its name escaped", () => {
    expect(labels(stateful("  - (ref)|"))).toEqual([
      "#/state/count",
      "#/state/bump",
      "#/state/load",
      "#/state/a~1b",
    ]);
    expect(labels(stateful("  p .hidden=(ref)|"))).toHaveLength(4);
    expect(offers(stateful("  - (ref)|"))[0]).toEqual({
      insert: '"#/state/count"',
      kind: "value",
      label: "#/state/count",
    });
  });

  test("is offered for a `$array` row, but for its `key`", () => {
    expect(inserts(stateful("  ul {\n    $array items=|\n  }"))).toEqual([
      '(ref)"#/state/count"',
      '(ref)"#/state/bump"',
      '(ref)"#/state/load"',
      '(ref)"#/state/a~1b"',
    ]);
    // A key is a name of the item's own, which no schema lists.
    expect(labels(stateful("  ul {\n    $array key=|\n  }"))).toEqual([]);
    expect(labels(stateful("  ul {\n    $array |\n  }"))).toEqual(["filter=", "items=", "key="]);
    expect(labels(stateful("  ul {\n    $array items=1 |\n  }"))).toEqual(["filter=", "key="]);
    expect(labels(stateful('  ul {\n    $array 1 "|"\n  }'))).toEqual([]);
  });

  test("is of the root element's state, wherever the position is", () => {
    expect(labels(stateful("  ul {\n    li {\n      button onclick=|\n    }\n  }"))).toEqual([
      "#/state/bump",
      "#/state/load",
    ]);
    // A file with no state has none, and neither has one whose state is written elsewhere.
    expect(labels("div {\n  button onclick=|\n}")).toEqual([]);
    expect(
      labels('div {\n  p {\n    state {\n      (fn)a ""\n    }\n  }\n  button onclick=|\n}'),
    ).toEqual([]);
    expect(labels("$layout #false\nbutton onclick=|")).toEqual([]);
    // An entry whose name is not written yet is not one to point at.
    expect(labels("div {\n  state {\n    (fn)\n  }\n  button onclick=|\n}")).toEqual([]);
  });
});

describe("a JSON block", () => {
  test("offers the members its schema declares that are not written", () => {
    expect(labels("div {\n  $props {\n    |\n  }\n}")).toEqual(["size"]);
    expect(labels("div {\n  $props {\n    size 1\n    |\n  }\n}")).toEqual([]);
    expect(labels("div {\n  $props |\n}")).toEqual(["size="]);
    expect(labels("div {\n  $props size=|\n}")).toEqual([]);
    expect(labels("div {\n  $props missing=|\n}")).toEqual([]);
    expect(labels("div {\n  .dir |\n}")).toEqual(["ltr", "rtl"]);
    expect(labels("div {\n  .hidden |\n}")).toEqual(["#true", "#false"]);
  });

  test("follows the schema of each member down", () => {
    expect(labels("div {\n  state {\n    count {\n      |\n    }\n  }\n}")).toEqual([
      "default",
      "type",
    ]);
    expect(labels("div {\n  state {\n    count {\n      type |\n    }\n  }\n}")).toEqual(["doc"]);
    expect(labels("div {\n  state {\n    count type=|\n  }\n}")).toEqual(["doc"]);
    // Below the root, `state` is still the document's.
    expect(labels("div {\n  p {\n    state {\n      count type=|\n    }\n  }\n}")).toEqual(["doc"]);
    expect(labels("div {\n  attributes {\n    |\n  }\n}")).toEqual([]);
  });

  test("reads `.children` as a block of one element, unless it is a list", () => {
    expect(labels("div {\n  .children {\n    |\n  }\n}")).toEqual([
      "div",
      "p",
      "$array",
      "$element",
    ]);
    expect(labels("div {\n  .children {\n    $array |\n  }\n}")).toEqual([
      "filter=",
      "items=",
      "key=",
    ]);
    expect(labels("div {\n  .children {\n    p |\n  }\n}")).toContain(".dir=");
    expect(labels("div {\n  (array).children {\n    |\n  }\n}")).toEqual(["-"]);
    // With no block it is a JSON block like any other member, and its schema's names are offered.
    expect(labels("div {\n  .children |\n}")).toContain("items=");
  });

  test("reads `.map` and each of `.cases` as a block of one element", () => {
    expect(labels("div {\n  $array {\n    |\n  }\n}")).toEqual(["div", "p", "$element"]);
    expect(labels("div {\n  $array {\n    li |\n  }\n}")).toContain(".dir=");
    expect(labels("div {\n  .map {\n    |\n  }\n}")).toEqual(["div", "p", "$array", "$element"]);
    expect(labels("div {\n  .cases {\n    |\n  }\n}")).toEqual([]);
    expect(labels("div {\n  .cases {\n    one {\n      |\n    }\n  }\n}")).toEqual([
      "div",
      "p",
      "$array",
      "$element",
    ]);
    expect(labels("div {\n  .cases {\n    one |\n  }\n}")).toEqual([]);
    expect(
      labels("div {\n  .cases {\n    one {\n      p {\n        |\n      }\n    }\n  }\n}"),
    ).toContain("state");
  });
});

describe("a `style` block", () => {
  test("offers the names of the schema, and a name's values", () => {
    expect(labels("div {\n  style {\n    |\n  }\n}")).toEqual(["color", "display"]);
    expect(labels("div {\n  style {\n    color red\n    |\n  }\n}")).toEqual(["display"]);
    expect(labels("div {\n  style {\n    display |\n  }\n}")).toEqual(["block", "none"]);
    expect(labels("div {\n  style {\n    color |\n  }\n}")).toEqual(["red"]);
    expect(labels("div {\n  style |\n}")).toEqual(["color=", "display="]);
    expect(labels("div {\n  style display=|\n}")).toEqual(["block", "none"]);
  });

  test("reads a nested rule against the same schema", () => {
    expect(labels('div {\n  style {\n    ":hover" {\n      |\n    }\n  }\n}')).toEqual([
      "color",
      "display",
    ]);
  });
});

describe("a project file", () => {
  test("offers its members at the top, and `project` where it is not written", () => {
    expect(labels('project "x"\n|')).toEqual([
      "$media",
      "build",
      "extensions",
      "mixed",
      "state",
      "style",
    ]);
    expect(labels('project "x"\nbuild\n|')).toEqual([
      "$media",
      "extensions",
      "mixed",
      "state",
      "style",
    ]);
    expect(labels('project "x"\n(|')).toEqual(["object", "array"]);
    expect(labels("project |")).toEqual([]);
    expect(labels("project {\n  |\n}")).toEqual([]);
  });

  test("reads each member as a JSON block of its schema", () => {
    expect(labels('project "x"\nbuild |')).toEqual(["adapter=", "minify="]);
    expect(labels('project "x"\nbuild adapter=|')).toEqual(["node", "cloudflare"]);
    expect(labels('project "x"\nbuild {\n  minify |\n}')).toEqual(["#true", "#false"]);
    expect(labels('project "x"\nextensions {\n  |\n}')).toEqual(["-"]);
    expect(labels('project "x"\nextensions {\n  - |\n}')).toEqual(['"@jxsuite/parser"']);
    expect(labels('project "x"\nextensions |')).toEqual(['"@jxsuite/parser"']);
    expect(labels('project "x"\nunknown {\n  |\n}')).toEqual([]);
  });

  test("offers a block that may be a list or an object what it has said it is", () => {
    expect(labels('project "x"\nmixed {\n  |\n}')).toEqual(["-", "one", "two"]);
    expect(labels('project "x"\n(array)mixed {\n  |\n}')).toEqual(["-"]);
    expect(labels('project "x"\n(object)mixed {\n  |\n}')).toEqual(["one", "two"]);
    expect(labels('project "x"\nmixed {\n  - x\n  |\n}')).toEqual(["-"]);
    expect(labels('project "x"\nmixed {\n  one 1\n  |\n}')).toEqual(["two"]);
    expect(labels('project "x"\n(object)mixed {\n  - x\n  |\n}')).toEqual(["one", "two"]);
    expect(labels('project "x"\nmixed |')).toEqual(["one=", "two=", "x"]);
  });

  test("reads `style` and `$media` as style blocks", () => {
    expect(labels('project "x"\nstyle {\n  |\n}')).toEqual(["color", "margin"]);
    expect(labels('project "x"\n$media {\n  "(width > 40em)" {\n    |\n  }\n}')).toEqual([
      "color",
      "margin",
    ]);
    expect(labels('project "x"\nstyle {\n  (|\n}')).toEqual(["array"]);
  });

  test("offers pointers into its own state", () => {
    const file = 'project "x"\nstate {\n  theme "dark"\n  (fn)toggle ""\n}\nbuild adapter=(ref)|';
    expect(labels(file)).toEqual(["#/state/theme", "#/state/toggle"]);
  });

  test("leaves `$head` to its rows", () => {
    expect(labels('project "x"\n$head {\n  |\n}')).toEqual([]);
  });

  test("offers `project` in a file that is one before the node is written again", () => {
    expect(labels("project\n|", { document: DOCUMENT, project: { properties: {} } })).toEqual([]);
    expect(
      labels('/- project "old"\nproject "x"\n|', {
        document: DOCUMENT,
        project: { properties: {} },
      }),
    ).toEqual([]);
  });
});

describe("a schema that says less", () => {
  const bare: ComposedProjectSchemas = { document: {}, project: {} };

  test("offers what the notation has and nothing it would have to guess", () => {
    expect(labels("|", bare)).toEqual([]);
    expect(labels("div {\n  |\n}", bare)).toEqual([
      "state",
      "style",
      "attributes",
      "script",
      "-",
      "$array",
      "$element",
    ]);
    expect(labels("div |", bare)).toEqual([]);
    expect(labels("div .dir=|", bare)).toEqual([]);
    expect(labels("div {\n  $array |\n}", bare)).toEqual([]);
    expect(labels("div {\n  style {\n    |\n  }\n}", bare)).toEqual([]);
    expect(labels("div {\n  style |\n}", bare)).toEqual([]);
    expect(labels("div {\n  style color=|\n}", bare)).toEqual([]);
    expect(labels("div {\n  style {\n    a {\n      |\n    }\n  }\n}", bare)).toEqual([]);
    expect(labels("div {\n  state {\n    a {\n      |\n    }\n  }\n}", bare)).toEqual([]);
    expect(labels('project "x"\n|', bare)).toEqual([]);
  });

  test("finds no element where `children` holds none", () => {
    const flat: ComposedProjectSchemas = {
      document: { properties: { children: { items: { type: "string" }, type: "array" } } },
      project: {},
    };
    // What the document itself declares is still the root's.
    expect(labels("div |", flat)).toEqual([".children="]);
    expect(labels("div {\n  p |\n}", flat)).toEqual([]);
    expect(labels("div {\n  $array |\n}", flat)).toEqual([]);
  });
});

describe("the committed schemas", () => {
  const read = (name: string): JsonObject => {
    const text = readFileSync(join(import.meta.dir, "..", name), "utf8");
    return flattenSchema(JSON.parse(text));
  };
  const core: ComposedProjectSchemas = {
    document: read("schema.json"),
    project: read("project-schema.json"),
  };
  /** The core as a project's composed schema holds it: under `$defs`, behind an `allOf`. */
  const nest = (schema: JsonObject): JsonObject =>
    flattenSchema({
      $defs: { [String(schema.$id)]: schema },
      allOf: [{ $ref: String(schema.$id) }],
    });
  const nested: ComposedProjectSchemas = {
    document: nest(core.document),
    project: nest(core.project),
  };

  const cases = [
    "|",
    "div {\n  |\n}",
    "div |",
    "div .dir=|",
    "div .hidden=|",
    "div {\n  ul {\n    $array |\n  }\n}",
    "div {\n  style {\n    |\n  }\n}",
    "div {\n  (fn)|\n}",
    "$layout |",
    'project "x"\n|',
    'project "x"\nbuild |',
  ];

  test("give the same offers flat and nested", () => {
    for (const source of cases) {
      const flat = offers(source, core);
      expect(flat.length).toBeGreaterThan(0);
      expect(offers(source, nested)).toEqual(flat);
    }
  });

  test("give what the notation is written with", () => {
    expect(labels("|", core)).toEqual(expect.arrayContaining(["div", "main", "$layout", "$head"]));
    const line = offers("div |", core);
    const names = line.map((item) => item.label);
    expect(names).toEqual(expect.arrayContaining([".hidden=", ".dir=", "$props=", "onclick="]));
    expect(names).not.toContain("$map/item=");
    expect(labels("div .dir=|", core)).toEqual(["ltr", "rtl", "auto"]);
    expect(labels("div .hidden=|", core)).toEqual(["#true", "#false"]);
    expect(labels("div {\n  ul {\n    $array |\n  }\n}", core)).toEqual([
      "filter=",
      "items=",
      "key=",
      "sort=",
    ]);
    expect(labels("div {\n  style {\n    |\n  }\n}", core)).toEqual(
      expect.arrayContaining(["color", "display"]),
    );
    expect(labels("$layout |", core)).toEqual(["#false", '"./layouts/base.json"']);
    expect(labels('project "x"\nbuild |', core)).toContain("adapter=");
    expect(line.find((item) => item.label === ".hidden=")?.detail).toBeString();
  });
});
