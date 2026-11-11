/**
 * Jx Notation: every grammar row, the writer against what KDL can silently change, and the corpus.
 *
 * The corpus test is the one that matters. KDL is a spelling and the data model does not change, so
 * every tracked document has to come back deep-equal, with `style` order intact.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonValue, JxDocument } from "../types.ts";
import {
  JxnError,
  classifyJxn,
  lintJxn,
  parseJxn,
  parseJxnWithSpans,
  serializeJxn,
} from "../src/jxn/index.ts";
import { EVENT_HANDLER_NAMES } from "../src/jxn/event-handlers.ts";
import { isJsonObject, isString } from "../src/guards.ts";

const ROOT = resolve(import.meta.dir, "../../..");

/**
 * A document, from a loose literal.
 *
 * @param value The literal, which is what these tests are about, valid or not.
 */
function asDoc(value: JsonValue): JxDocument {
  // SAFETY: every JxDocument member is optional, and each test here decides what it holds.
  return value as JxDocument;
}

/** What the grammar reads a piece of text as. */
function read(text: string): JsonValue {
  const document = parseJxn(text);
  return isJsonObject(document) ? document : null;
}

/** Write it and read it back. */
const roundTrip = (value: JsonValue): JsonValue => read(serializeJxn(asDoc(value)));

/** The error a piece of text is refused with. */
function refusal(text: string): JxnError {
  try {
    read(text);
  } catch (error) {
    if (error instanceof JxnError) {
      return error;
    }
  }
  throw new Error(`Expected a JxnError for: ${text}`);
}

describe("the grammar", () => {
  test.each<[string, string, JsonValue]>([
    ["a node name is the tag", "div", { tagName: "div" }],
    ["`div {}` is `div`", "div {}", { tagName: "div" }],
    ["one value is its text", 'p "Hello"', { tagName: "p", textContent: "Hello" }],
    ["a name is an attribute", "a href=x", { attributes: { href: "x" }, tagName: "a" }],
    ["a dotted name is a member", 'input .value="v"', { tagName: "input", value: "v" }],
    ["a dollar name is a member", "div $id=A", { $id: "A", tagName: "div" }],
    ["a ref as text", 'p (ref)"#/state/a"', { tagName: "p", textContent: { $ref: "#/state/a" } }],
    [
      "a child node is a child element",
      "ul { li }",
      { children: [{ tagName: "li" }], tagName: "ul" },
    ],
    [
      "a dash is text among children",
      'p { - "a"; b "c"; - (ref)"#/x" }',
      { children: ["a", { tagName: "b", textContent: "c" }, { $ref: "#/x" }], tagName: "p" },
    ],
    [
      "a handler by ref",
      'b onclick=(ref)"#/state/go"',
      { onclick: { $ref: "#/state/go" }, tagName: "b" },
    ],
    [
      "$array, with its element as map",
      'ul { $array items=(ref)"#/state/r" { li } }',
      {
        children: [{ $prototype: "Array", items: { $ref: "#/state/r" }, map: { tagName: "li" } }],
        tagName: "ul",
      },
    ],
    ["$element for a tagless node", "$element .textContent=x", { textContent: "x" }],
    [
      "$element for a reserved tag",
      'head { $element "style" "a{}" }',
      {
        children: [{ tagName: "style", textContent: "a{}" }],
        tagName: "head",
      },
    ],
    ["$element project is the escape", '$element "project"', { tagName: "project" }],
    [
      "a top-level $ node is metadata",
      '$id A\n$schema "s"\ndiv',
      { $id: "A", $schema: "s", tagName: "div" },
    ],
    [
      "$head holds element rows",
      "$head {\n  meta name=x\n}\ndiv",
      { $head: [{ attributes: { name: "x" }, tagName: "meta" }], tagName: "div" },
    ],
  ])("%s", (_label, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  test("a function block holds its parameters, then its body", () => {
    expect(read('b {\n  (fn)onclick e "go(e)"\n}')).toEqual({
      onclick: { $prototype: "Function", body: "go(e)", parameters: ["e"] },
      tagName: "b",
    });
  });

  test("(on) marks a handler in block form", () => {
    expect(read('b {\n  (on)onclick { $expression "x" }\n}')).toEqual({
      onclick: { $expression: "x" },
      tagName: "b",
    });
  });

  test("without the annotation, a node named on… is an element", () => {
    expect(read("div {\n  onboarding-flow part=x\n}")).toEqual({
      children: [{ attributes: { part: "x" }, tagName: "onboarding-flow" }],
      tagName: "div",
    });
  });

  test("empty children have a spelling", () => {
    expect(read("div {\n  (array).children\n}")).toEqual({ children: [], tagName: "div" });
  });

  test("the whole of children being one mapped array is spelled out", () => {
    const value = {
      children: { $prototype: "Array", items: { $ref: "#/a" }, map: { tagName: "li" } },
      tagName: "ul",
    };
    expect(roundTrip(value)).toEqual(value);
    const list = { ...value, children: [value.children] };
    expect(roundTrip(list)).toEqual(list);
  });

  test("state is a block, with functions in it", () => {
    expect(
      read('div {\n  state {\n    count 0\n    (fn)reset "state.count = 0"\n    tags a b\n  }\n}'),
    ).toEqual({
      state: {
        count: 0,
        reset: { $prototype: "Function", body: "state.count = 0" },
        tags: ["a", "b"],
      },
      tagName: "div",
    });
  });

  test("the spec's sample reads", () => {
    const sample = read(`/- kdl-version 2
$schema "https://jxsuite.com/schema/v1"
$id Counter

// Comments stay in the file.
my-counter {
    state {
        count 0
        rows {
            - id=a name="First"
        }
        (fn)rename event #"""
            const input = event.target as HTMLInputElement
            state.label = input.value
            """#
    }

    style display=inline-flex gap="6px" {
        "&:hover" color="var(--color-action)"
        #"&[data-kind="urgent"]"# backgroundColor="var(--chip-urgent-bg)"
    }

    span part=value aria-live=polite "\${state.count}"
    button type=button onclick=(ref)"#/state/reset" "Reset"
    $array items=(ref)"#/state/rows" key=(ref)"$map/item/id" {
        li (ref)"$map/item/name"
    }
    slot
}
`);
    expect(sample).toMatchObject({ $id: "Counter", tagName: "my-counter" });
    expect(sample).toHaveProperty("style.&:hover.color", "var(--color-action)");
    expect(sample).toHaveProperty(
      "state.rename.body",
      "const input = event.target as HTMLInputElement\nstate.label = input.value",
    );
  });
});

/*
 * The pinned parser passes 318 of the 319 cases in KDL's own suite at its 2.0.0 tag, and through
 * `parseJxn` none of the 319 throws anything but a JxnError. The one miss admits `node/-arg`, which
 * loses nothing. These are the parts of KDL's syntax the grammar leans on: if a parser replacing it
 * reads one differently, a document changes silently.
 */
describe("KDL's syntax reaches the grammar", () => {
  test.each([
    ["a line comment", "// a\ndiv", { tagName: "div" }],
    ["a nested block comment", "/* a /* b */ c */ div", { tagName: "div" }],
    ["a slashdash on a node", "/- b\ndiv", { tagName: "div" }],
    ["a slashdash on an entry", "div /- a=1", { tagName: "div" }],
    ["a slashdash on a block", "div /- { b }", { tagName: "div" }],
    [
      "a semicolon between nodes",
      "ul { li; li }",
      { children: [{ tagName: "li" }, { tagName: "li" }], tagName: "ul" },
    ],
    ["a line continuation", "div \\\n  a=1", { attributes: { a: 1 }, tagName: "div" }],
    [
      "#true and #false",
      "div a=#true b=#false",
      { attributes: { a: true, b: false }, tagName: "div" },
    ],
    ["#null", "div a=#null", { attributes: { a: null }, tagName: "div" }],
    [
      "hex, octal and binary",
      "div a=0xff b=0o7 c=0b11",
      { attributes: { a: 255, b: 7, c: 3 }, tagName: "div" },
    ],
    ["underscores in a number", "div a=1_000", { attributes: { a: 1000 }, tagName: "div" }],
    ["an exponent", "div a=1.5e2", { attributes: { a: 150 }, tagName: "div" }],
    ["a bare string", "a href=b", { attributes: { href: "b" }, tagName: "a" }],
    ["a quoted node name", '"my-el" "x"', { tagName: "my-el", textContent: "x" }],
    ["a quoted property name", 'a "b c"=1', { attributes: { "b c": 1 }, tagName: "a" }],
    ["a raw string", String.raw`p #"a\sb"#`, { tagName: "p", textContent: String.raw`a\sb` }],
    ["a raw string with more hashes", 'p ##"a"#b"##', { tagName: "p", textContent: 'a"#b' }],
    ["a multi-line string", 'p """\n  a\n    b\n  """', { tagName: "p", textContent: "a\n  b" }],
    ["a unicode escape", String.raw`p "\u{e9}"`, { tagName: "p", textContent: "é" }],
    ["an escaped line break in a string", 'p "a\\\n   b"', { tagName: "p", textContent: "ab" }],
  ])("%s", (_label, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  test.each([
    ["a version 1 raw string", 'p r#"a"#'],
    ["a version 1 boolean", "p a=true"],
    ["an unquoted keyword", "p null"],
    ["an unknown escape", String.raw`p "\d"`],
    ["a brace with no node", "{ a }"],
    ["an unclosed block", "div {"],
  ])("%s is refused", (_label, text) => {
    expect(() => parseJxn(text)).toThrow(JxnError);
  });
});

describe("the on* rule", () => {
  test("a non-ref value on a real handler name is refused, pointing at what to write", () => {
    expect(() => read('button onclick="state.x++"')).toThrow("(fn)onclick");
  });

  test("any other on* name is an attribute", () => {
    expect(read('my-el once="x" only=y')).toEqual({
      attributes: { once: "x", only: "y" },
      tagName: "my-el",
    });
  });

  test("the attributes block is the escape for a real handler name", () => {
    expect(read('b {\n  attributes { onclick "x" }\n}')).toEqual({
      attributes: { onclick: "x" },
      tagName: "b",
    });
  });

  test("(fn) as a property value is refused", () => {
    expect(() => read('b onclick=(fn)"x"')).toThrow("line of its own");
  });

  test("a ref-valued attribute with such a name round-trips, in the one spelling that can", () => {
    const value = { attributes: { once: { $ref: "#/a" } }, tagName: "b" };
    expect(serializeJxn(asDoc(value))).toContain("attributes");
    expect(roundTrip(value)).toEqual(value);
  });

  test("the handler list is the schema's", () => {
    /** The object in the schema that declares `onclick`, which is the list of handlers. */
    const handlers = (value: JsonValue | undefined): string[] => {
      if (isJsonObject(value) && "onclick" in value) {
        return Object.keys(value).filter((key) => key.startsWith("on"));
      }
      const inner = isJsonObject(value) || Array.isArray(value) ? Object.values(value) : [];
      return inner.map((item) => handlers(item)).find((found) => found.length > 0) ?? [];
    };
    // SAFETY: JSON.parse without a reviver only ever yields a JSON value.
    const schema = JSON.parse(
      readFileSync(join(ROOT, "packages/schema/schema.json"), "utf8"),
    ) as JsonValue;
    const names = handlers(schema);
    expect(names.length).toBeGreaterThan(100);
    expect([...EVENT_HANDLER_NAMES].toSorted()).toEqual(names.toSorted());
  });
});

describe("a document's own script", () => {
  const CLIENT =
    'import { clamp } from "./math.ts";\n\nexport function bump(state) {\n  state.count = clamp(state.count + 1);\n}\n';
  const SERVER = "export async function history(args, env) {\n  return [];\n}\n";

  test.each<[string, string, JsonValue]>([
    [
      "a script in the root element is the client module",
      'div {\n  script "export const a = 1"\n}',
      { $script: { client: "export const a = 1" }, tagName: "div" },
    ],
    [
      "timing=server makes it the server module",
      'div {\n  script timing=server "export const a = 1"\n}',
      { $script: { server: "export const a = 1" }, tagName: "div" },
    ],
    [
      "a document holds one of each, in either order",
      'div {\n  script timing=server "s"\n  script "c"\n  p\n}',
      { $script: { client: "c", server: "s" }, children: [{ tagName: "p" }], tagName: "div" },
    ],
    ["a tagless root holds one too", '$element {\n  script "c"\n}', { $script: { client: "c" } }],
    [
      "a <script> element is still $element",
      'div {\n  $element "script" "x()"\n}',
      { children: [{ tagName: "script", textContent: "x()" }], tagName: "div" },
    ],
    [
      "a <script> in $head is an element",
      "$head {\n  script src=x\n}\ndiv",
      { $head: [{ attributes: { src: "x" }, tagName: "script" }], tagName: "div" },
    ],
    [
      "(export) is a function the client module exports, under the node's name",
      "div {\n  state {\n    (export)bump\n  }\n}",
      {
        state: { bump: { $export: "bump", $prototype: "Function", $src: "#client" } },
        tagName: "div",
      },
    ],
    [
      "(export) takes another export name, and any other member",
      "div {\n  state {\n    (export)add $export=bump $lazy=#true\n  }\n}",
      {
        state: {
          add: { $export: "bump", $lazy: true, $prototype: "Function", $src: "#client" },
        },
        tagName: "div",
      },
    ],
    [
      "(server) is a function the server module exports",
      "div {\n  state {\n    (server)history\n  }\n}",
      {
        state: { history: { $export: "history", $src: "#server", timing: "server" } },
        tagName: "div",
      },
    ],
    [
      "(server) holds its arguments as names",
      'div {\n  state {\n    (server)history limit=(ref)"#/state/limit" kind=all\n  }\n}',
      {
        state: {
          history: {
            $export: "history",
            $src: "#server",
            arguments: { kind: "all", limit: { $ref: "#/state/limit" } },
            timing: "server",
          },
        },
        tagName: "div",
      },
    ],
  ])("%s", (_label, text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  test("a multi-line script is its text, with the file's indent gone", () => {
    const text = [
      "my-counter {",
      '    script #"""',
      '        import { clamp } from "./math.ts";',
      "",
      "        export function bump(state) {",
      "          state.count = clamp(state.count + 1);",
      "        }",
      "",
      '        """#',
      "}",
    ].join("\n");
    expect(read(text)).toEqual({ $script: { client: CLIENT }, tagName: "my-counter" });
  });

  test("the writer spells a script as script nodes, first in the root element", () => {
    const written = serializeJxn(
      asDoc({
        $id: "Counter",
        $script: { client: CLIENT, server: SERVER },
        state: {
          bump: { $export: "bump", $prototype: "Function", $src: "#client" },
          count: 0,
          history: {
            $export: "history",
            $src: "#server",
            arguments: { limit: { $ref: "#/state/limit" } },
            timing: "server",
          },
          limit: 20,
          other: { $export: "bump", $prototype: "Function", $src: "#client" },
        },
        tagName: "my-counter",
      }),
    );
    expect(written).toBe(
      [
        "/- kdl-version 2",
        "$id Counter",
        "",
        "my-counter {",
        '    script #"""',
        '        import { clamp } from "./math.ts";',
        "",
        "        export function bump(state) {",
        "          state.count = clamp(state.count + 1);",
        "        }",
        "",
        '        """#',
        '    script timing=server #"""',
        "        export async function history(args, env) {",
        "          return [];",
        "        }",
        "",
        '        """#',
        "    state {",
        "        (export)bump",
        "        count 0",
        '        (server)history limit=(ref)"#/state/limit"',
        "        limit 20",
        "        (export)other $export=bump",
        "    }",
        "}",
        "",
      ].join("\n"),
    );
  });

  test.each<[string, JsonValue]>([
    ["both scripts", { $script: { client: CLIENT, server: SERVER }, tagName: "x" }],
    ["a server script alone", { $script: { server: SERVER }, tagName: "x" }],
    ["a one-line script", { $script: { client: "export const a = 1" }, tagName: "x" }],
    ["an empty script", { $script: { client: "" }, tagName: "x" }],
    ["a script holding a raw-string breaker", { $script: { client: 'a\n"""#\nb' }, tagName: "x" }],
    ["a script with CRLF", { $script: { client: "a\r\nb" }, tagName: "x" }],
    ["a script on a tagless root", { $script: { client: "a" }, textContent: "x" }],
    ["a script with no root element", { $id: "A", $script: { client: "a" } }],
    ["an empty $script", { $script: {}, tagName: "x" }],
    ["a $script with another member", { $script: { client: "a", worker: "b" }, tagName: "x" }],
    ["a $script member that is not text", { $script: { client: 5 }, tagName: "x" }],
    ["a $script that is not an object", { $script: "a", tagName: "x" }],
    [
      "an export under its own name",
      { state: { f: { $export: "f", $prototype: "Function", $src: "#client" } }, tagName: "x" },
    ],
    [
      "an export under another name",
      { state: { f: { $export: "g", $prototype: "Function", $src: "#client" } }, tagName: "x" },
    ],
    [
      "an export with other members",
      {
        state: {
          f: { $export: "f", $lazy: true, $prototype: "Function", $src: "#client", emits: "a" },
        },
        tagName: "x",
      },
    ],
    [
      "an export naming no export, which has no row",
      { state: { f: { $prototype: "Function", $src: "#client" } }, tagName: "x" },
    ],
    [
      "an export with parameters, which is a function row",
      {
        state: {
          f: {
            $export: "f",
            $prototype: "Function",
            $src: "#client",
            body: "x",
            parameters: ["a"],
          },
        },
        tagName: "x",
      },
    ],
    [
      "an export with a member that needs a block",
      {
        state: { f: { $export: "f", $prototype: "Function", $src: "#client", emits: ["a"] } },
        tagName: "x",
      },
    ],
    [
      "a server function with no arguments",
      { state: { f: { $export: "f", $src: "#server", timing: "server" } }, tagName: "x" },
    ],
    [
      "a server function with arguments",
      {
        state: {
          f: {
            $export: "f",
            $src: "#server",
            arguments: { a: 1, b: "two", c: { $ref: "#/state/c" }, d: null },
            timing: "server",
          },
        },
        tagName: "x",
      },
    ],
    [
      "a server function with empty arguments, which has no row",
      {
        state: { f: { $export: "f", $src: "#server", arguments: {}, timing: "server" } },
        tagName: "x",
      },
    ],
    [
      "a server function with an argument that needs a block",
      {
        state: {
          f: { $export: "f", $src: "#server", arguments: { a: { b: 1 } }, timing: "server" },
        },
        tagName: "x",
      },
    ],
    [
      "a server function with arguments that are not an object",
      {
        state: { f: { $export: "f", $src: "#server", arguments: "a", timing: "server" } },
        tagName: "x",
      },
    ],
    [
      "a server function under another name",
      { state: { f: { $export: "g", $src: "#server", timing: "server" } }, tagName: "x" },
    ],
    [
      "a server function with another member",
      {
        state: { f: { $export: "f", $lazy: true, $src: "#server", timing: "server" } },
        tagName: "x",
      },
    ],
    [
      "a server function in a module of its own",
      { state: { f: { $export: "f", $src: "./a.server.js", timing: "server" } }, tagName: "x" },
    ],
  ])("%s comes back as it was", (_label, value) => {
    expect(roundTrip(value)).toEqual(value);
  });

  test.each<[string, JsonValue, string]>([
    ["a script on a document with a root", { $script: { client: "a" }, tagName: "x" }, "script a"],
    ["a script with no root", { $id: "A", $script: { client: "a" } }, "$script client=a"],
    [
      "a $script with another member",
      { $script: { client: "a", worker: "b" }, tagName: "x" },
      "$script client=a worker=b",
    ],
    [
      "an export naming no export",
      { state: { f: { $prototype: "Function", $src: "#client" } }, tagName: "x" },
      '(fn)f $src="#client"',
    ],
    [
      "a server function under another name",
      { state: { f: { $export: "g", $src: "#server", timing: "server" } }, tagName: "x" },
      'f $export=g $src="#server" timing=server',
    ],
  ])("%s is written as what reads back", (_label, value, line) => {
    expect(
      serializeJxn(asDoc(value))
        .split("\n")
        .map((row) => row.trim()),
    ).toContain(line);
  });

  test("a script's place in the file is recorded under its pointer", () => {
    const text =
      'div {\n  script "c"\n  script timing=server "s"\n  state {\n    (server)f a=1\n  }\n}';
    const { spans } = parseJxnWithSpans(text);
    const at = (pointer: string): string => {
      const span = spans.get(pointer);
      return span ? text.slice(span.start, span.end) : "";
    };
    expect(at("/$script/client")).toBe('script "c"');
    expect(at("/$script/server")).toBe('script timing=server "s"');
    expect(at("/state/f/arguments/a")).toBe("a=1");
  });

  test("every tracked component comes back with a script written into it", () => {
    let checked = 0;
    for (const file of trackedDocuments()) {
      const parsed = readTracked(file);
      if (isJsonObject(parsed) && isString(parsed.tagName) && !("$script" in parsed)) {
        checked += 1;
        const state = isJsonObject(parsed.state) ? parsed.state : {};
        const scripted = {
          ...parsed,
          $script: { client: CLIENT, server: SERVER },
          state: {
            ...state,
            "jx-script-export": { $export: "bump", $prototype: "Function", $src: "#client" },
            "jx-script-server": {
              $export: "jx-script-server",
              $src: "#server",
              arguments: { limit: 20 },
              timing: "server",
            },
          },
        };
        expect([file, sortKeys(roundTrip(scripted))]).toEqual([file, sortKeys(scripted)]);
      }
    }
    expect(checked).toBeGreaterThan(300);
  }, 60_000);
});

describe("what would silently lose data is refused", () => {
  test.each([
    ["a repeated property", "div a=1 a=2", "written twice"],
    ["a property and its block", "div a=1 {\n  attributes { a 2 }\n}", "written twice"],
    ["two style blocks", "div {\n  style a=1\n  style b=2\n}", "written twice"],
    ["$id twice", "$id A\ndiv $id=B", "written twice"],
    ["children spelled two ways", 'div {\n  (array).children\n  - "x"\n}', "written twice"],
    ["a key after NFC", 'div "e\u0301"=1 "\u00E9"=2', "written twice"],
    ["__proto__", "div {\n  state { __proto__ 1 }\n}", "__proto__"],
    ["#inf", "div {\n  state { a #inf }\n}", "#inf"],
    ["#nan", "div {\n  state { a #nan }\n}", "#inf or #nan"],
    ["a number JSON would round", "div {\n  state { a 9007199254740993 }\n}", "too large"],
    ["an unknown annotation", "(date)div", "not an annotation"],
    ["an unknown annotation on a value", 'div a=(date)"x"', "only (ref)"],
    ["(ref) on a name", "(ref)div", "annotates a value"],
    ["(ref) on something else", "div a=(ref)5", "needs a string"],
    ["more than one value", 'p "a" "b"', "one text value"],
    ["more than one root", "div\nspan", "second"],
    ["a raw control character", 'p "\u001B"', "control character"],
    ["a script below the root element", 'div {\n  p {\n    script "x"\n  }\n}', "root element"],
    ["two client scripts", 'div {\n  script "a"\n  script "b"\n}', "written twice"],
    [
      "two server scripts",
      'div {\n  script timing=server "a"\n  script timing=server "b"\n}',
      "written twice",
    ],
    ["a script and a $script block", '$script { client "a" }\ndiv {\n  script "b"\n}', "twice"],
    ["a $script member and a script", 'div $script=a {\n  script "b"\n}', "written twice"],
    ["a script with another timing", 'div {\n  script timing=client "a"\n}', "timing=server"],
    ["a script with another name", 'div {\n  script type=module "a"\n}', "timing=server"],
    ["a script with timing twice", 'div {\n  script timing=server timing=server "a"\n}', "twice"],
    ["a script with no text", "div {\n  script\n}", "one string"],
    ["a script with two strings", 'div {\n  script "a" "b"\n}', "one string"],
    ["a script that is not a string", "div {\n  script 5\n}", "one string"],
    ["a script with a block", 'div {\n  script "a" { b }\n}', "one string"],
    ["an annotated script", 'div {\n  (fn)script "a"\n}', "not one"],
    ["a script with another annotation", 'div {\n  (array)script "a"\n}', "annotate a script"],
    ["(export) with a body", 'div {\n  state {\n    (export)a "x"\n  }\n}', "no body"],
    ["(export) with a block", "div {\n  state {\n    (export)a { - 1 }\n  }\n}", "no body"],
    ["(export) with $src", 'div {\n  state {\n    (export)a $src="./a.js"\n  }\n}', "twice"],
    ["(export) on an element", "div {\n  (export)a\n}", "annotate an element"],
    ["(server) with a value", "div {\n  state {\n    (server)a 1\n  }\n}", "name=value"],
    ["(server) with a block", "div {\n  state {\n    (server)a { b 1 }\n  }\n}", "name=value"],
    ["(server) with a name twice", "div {\n  state {\n    (server)a b=1 b=2\n  }\n}", "twice"],
    ["(server) on an element", "div {\n  (server)a\n}", "annotate an element"],
    [
      "a selector that needs quotes",
      "div {\n  style {\n    > li color=red\n  }\n}",
      "needs quotes",
    ],
    ["a selector with two values", "div {\n  style {\n    a b c\n  }\n}", "needs quotes"],
    ["a project file read as a document", 'project "x"', "project file"],
    ["(fn) on a non-handler in an element", 'div {\n  (fn)nope "x"\n}', "not one"],
    ["a list holding something else", "div {\n  state {\n    (array)a { b 1 }\n  }\n}", "only"],
    ["(array) with names", "div {\n  state {\n    (array)a b=1\n  }\n}", "named"],
    ["a list with names", "div {\n  state {\n    a 1 2 b=3\n  }\n}", "cannot also"],
    ["a value with names", "div {\n  state {\n    a 1 b=3\n  }\n}", "cannot also"],
    ["(object) with a value", "div {\n  state {\n    (object)a 1\n  }\n}", "(object) holds"],
    ["a style with a value", 'div {\n  style "x"\n}', "declarations"],
    ["$array with a value", 'div {\n  $array "x"\n}', "one element"],
    ["a dash with two values", 'div {\n  - "a" "b"\n}', "one piece"],
    ["$element with too much", '$element "a" "b" "c"', "at most"],
    ["a $ node that is no kind of element", "ul {\n  $array { $nope }\n}", "kind of element"],
    ["map with two elements", "ul {\n  .map { a; b }\n}", "one element"],
    ["an annotated element", "ul {\n  (object)li\n}", "annotate an element"],
  ])("%s", (_label, text, words) => {
    expect(() => read(text)).toThrow(words);
  });

  test("an error names its line and column", () => {
    const error = refusal('div {\n  p "a" "b"\n}');
    expect(error.line).toBe(2);
    expect(error.column).toBe(3);
    expect(error.offset).toBe(8);
  });

  test("KDL's own syntax errors name theirs too", () => {
    expect(refusal("div {\n  p bad=\n}").line).toBeNumber();
  });
});

describe("the writer", () => {
  test.each<[string, JsonValue]>([
    [
      "keywords as strings",
      { state: { a: "true", b: "null", c: "#true", d: "inf" }, tagName: "x" },
    ],
    [
      "number-like strings",
      { state: { a: "1", b: "1.0", c: "0x10", d: "-1", e: "1e5" }, tagName: "x" },
    ],
    ["scalars", { state: { a: null, b: true, c: false, d: 1.5, e: -2 }, tagName: "x" }],
    ["-0", { state: { a: -0 }, tagName: "x" }],
    ["empties", { state: { a: [], b: {}, c: "" }, tagName: "x" }],
    ["one-item lists", { state: { a: ["b"], b: [1], c: [{ d: 1 }], e: [[]] }, tagName: "x" }],
    ["nested lists", { state: { a: [[1, 2], [3]], b: [[{ c: 1 }]] }, tagName: "x" }],
    [
      "a key of dash",
      { state: { a: { "-": 1 }, b: { "-": { c: 1 }, d: 2 }, e: { "-": { c: 1 } } }, tagName: "x" },
    ],
    ["a ref with a sibling", { state: { a: { $ref: "#/a", b: 1 } }, tagName: "x" }],
    ["awkward keys", { state: { "": 1, "a b": 2, "1": 3, "#x": 4, true: 5 }, tagName: "x" }],
    ["a tag no bare name can be", { tagName: "a b" }],
    ["a tag with a $", { tagName: "$weird" }],
    ["a reserved tag with text", { tagName: "style", textContent: "a{}" }],
    ["no tag at all", { textContent: "x" }],
    ["an expression as a tag", { tagName: { $ref: "#/t" } }],
    ["a non-scalar text", { tagName: "p", textContent: { a: 1 } }],
    ["typed text", { tagName: "p", textContent: 5 }],
    [
      "a function with extras",
      { state: { f: { $prototype: "Function", $src: "./a.js", $export: "f" } }, tagName: "x" },
    ],
    [
      "a structured body",
      { state: { f: { $prototype: "Function", body: [{ a: 1 }] } }, tagName: "x" },
    ],
    [
      "parameters and a structured body",
      {
        state: { f: { $prototype: "Function", body: [{ a: 1 }], parameters: ["e"] } },
        tagName: "x",
      },
    ],
    [
      "parameters with no body, which have no row",
      { state: { f: { $prototype: "Function", parameters: ["e"] } }, tagName: "x" },
    ],
    [
      "a function that needs a block",
      { state: { f: { $prototype: "Function", body: "x", emits: ["a"] } }, tagName: "x" },
    ],
    [
      "an empty structured body",
      { state: { f: { $prototype: "Function", body: [] } }, tagName: "x" },
    ],
    [
      "a handler that is a function",
      { onclick: { $prototype: "Function", body: "x" }, tagName: "b" },
    ],
    ["a handler that is neither", { onclick: { $expression: "x" }, tagName: "b" }],
    [
      "a mapped array with a block",
      {
        children: [{ $prototype: "Array", items: { a: 1 }, map: { tagName: "li" } }],
        tagName: "ul",
      },
    ],
    [
      "an array row with no map",
      { children: [{ $prototype: "Array", items: { $ref: "#/a" } }], tagName: "ul" },
    ],
    ["a switch", { $switch: { $ref: "#/a" }, cases: { a: { tagName: "b" } } }],
    [
      "cases with odd names",
      { $switch: "x", cases: { "a b": { tagName: "b" }, "": { tagName: "c" } } },
    ],
    ["map as a member", { map: { tagName: "b" }, tagName: "x" }],
    ["a dollar member holding a block", { $props: { a: { b: 1 } }, tagName: "x" }],
    ["a dollar member holding a list", { $elements: [{ $ref: "./a.json" }, "b"], tagName: "x" }],
    ["a tagless child", { children: [{ $switch: "x", cases: {} }], tagName: "x" }],
    ["a metadata-only document", { $id: "A", $title: "B" }],
    [
      "attributes that need a block",
      { attributes: { a: { b: 1 }, c: "d", $e: "f", ".g": "h" }, tagName: "x" },
    ],
    ["a member with a multi-line value", { tagName: "x", title: "a\nb" }],
    ["an empty style", { style: {}, tagName: "x" }],
    ["a style's lists", { style: { "@font-face": [{ a: 1 }], x: [] }, tagName: "x" }],
    [
      "a style that is one long line",
      { style: { a: "x".repeat(60), b: "y".repeat(60) }, tagName: "x" },
    ],
    ["a long list", { state: { a: ["x".repeat(60), "y".repeat(60)] }, tagName: "x" }],
    ["a long object", { state: { a: { b: "x".repeat(60), c: "y".repeat(60) } }, tagName: "x" }],
    [
      "a head row that is a ref",
      { $head: [{ $ref: "./h.json" }, { tagName: "meta" }], tagName: "x" },
    ],
    ["children as a ref", { children: { $ref: "#/c" }, tagName: "x" }],
    ["a $head that is not a list", { $head: { a: 1 }, tagName: "x" }],
    ["attributes that are not an object", { attributes: "x", tagName: "b" }],
  ])("%s come back as they were", (_label, value) => {
    expect(roundTrip(value)).toEqual(value);
  });

  test.each([
    ["a quote and a backslash", String.raw`a"b\c`],
    ["a raw-string breaker", String.raw`x"#\y`],
    ["a multi-line raw breaker", 'a\n"""#\nb'],
    ["CRLF", "a\r\nb"],
    ["a whitespace-only line", "a\n   \nb"],
    ["indentation", "a\n  b\n    c"],
    ["a trailing newline", "a\n"],
    ["a leading newline", "\na"],
    ["blank lines", "a\n\nb"],
    ["U+2028", "a\u2028b"],
    ["U+2029", "a\u2029b"],
    ["U+0085", "a\u0085b"],
    ["a control character", "a\u001Bb"],
    ["a backspace", "a\u0008b"],
    ["a form feed", "a\fb"],
    ["a bidi override", "a\u202Eb"],
    ["a byte order mark", "a\uFEFFb"],
    ["a tab", "a\tb"],
    ["a line starting with a tab", "a\n\tb"],
    ["a template", "`${state.x}`\nnext"],
    ["only quotes", '"""'],
    ["a backslash at the end", String.raw`a\ `.trimEnd()],
    ["an escape that means something", String.raw`a\sb`],
  ])("a string with %s survives, everywhere a string goes", (_label, text) => {
    const value = {
      attributes: { title: text },
      state: {
        a: text,
        f: { $prototype: "Function", body: text, parameters: ["e"] },
        list: [text, "x"],
      },
      style: { color: text },
      tagName: "x",
      textContent: text,
      title: text,
    };
    expect(roundTrip(value)).toEqual(value);
  });

  test("a string with a backslash is raw, so nobody has to know KDL's escapes", () => {
    const text = serializeJxn(
      asDoc({ attributes: { pattern: String.raw`\s+` }, tagName: "input" }),
    );
    expect(text).toContain(String.raw`#"\s+"#`);
  });

  test("a lone surrogate is refused, naming where", () => {
    expect(() => serializeJxn(asDoc({ state: { a: "\uD800" }, tagName: "x" }))).toThrow("/state/a");
    expect(() => serializeJxn(asDoc({ state: { "\uD800": 1 }, tagName: "x" }))).toThrow(
      "lone surrogate",
    );
  });

  test("a list inside a list of children is refused rather than dropped", () => {
    expect(() => serializeJxn(asDoc({ children: [[]], tagName: "x" }))).toThrow(
      "list inside a list",
    );
  });

  test("style order survives, including inside a nested block", () => {
    const value = {
      style: { z: "1", a: "2", "@media x": { y: "1", b: "2" }, m: "3" },
      tagName: "x",
    };
    const back = roundTrip(value);
    expect(JSON.stringify(isJsonObject(back) ? back.style : null)).toBe(
      JSON.stringify(value.style),
    );
  });

  test("the canonical form hoists a short style's leading declarations", () => {
    const text = serializeJxn(
      asDoc({ style: { color: "red", "&:hover": { color: "blue" } }, tagName: "x" }),
    );
    expect(text).toContain("style color=red {");
  });

  test("the canonical form is stable", () => {
    const value = { children: [{ tagName: "a" }], state: { b: [1, 2] }, tagName: "x" };
    const once = serializeJxn(asDoc(value));
    expect(serializeJxn(parseJxn(once))).toBe(once);
  });
});

describe("classifyJxn", () => {
  test.each([
    ["a project", 'project "x"\nurl "y"', "project"],
    ["one with a later unclosed block", 'project "x"\ndefaults {', "project"],
    ["one with a later bad property", 'project "y"\nbad=', "project"],
    [
      "after the marker and metadata",
      '/- kdl-version 2\n$schema "./p.json"\nproject "x"\n{{{',
      "project",
    ],
    ["after a byte order mark", "\uFEFFproject", "project"],
    ["after nested block comments", "/* hi\n /* nested */ */\n// x\nproject", "project"],
    ["after a $ node with a block", '$defs {\n  a "}"\n}\nproject "x"', "project"],
    ["after a $ node with a comment in it", "$defs { // }\n  a 1\n}\nproject", "project"],
    ["after a $ node with a block comment in it", "$defs { /* } */ a 1 }\nproject", "project"],
    ["after a $ node with a raw string", '$x #"""\n  " } {\n  """#\nproject', "project"],
    ["after an escape in a string", `${String.raw`$x "a\"b"`}\nproject`, "project"],
    ["with no name", 'project\nurl "x"', "project"],
    ["after a semicolon", '$schema "a"; project "x"', "project"],
    ["after an annotation", "(x)project", "project"],
    ["a document", "my-counter {\n}", "document"],
    ["a document after metadata", '$id A\ndiv "x"', "document"],
    ["a tag starting the same way", 'project-card "x"', "document"],
    ["a longer word", "projects {}", "document"],
    ["the escape", '$element "project"', "document"],
    ["a quoted name", '"a b"', "document"],
    ["nothing", "", "document"],
    ["only comments", "// nothing", "document"],
    ["only a slashdashed node", "/- project", "document"],
    ["a binary", "JX\u0000\u0001garbage", "unreadable"],
    ["punctuation", "{", "unreadable"],
    ["a broken $ node", '$x "unterminated\nproject', "unreadable"],
    ["an unterminated multi-line $ node", '$x """\nproject', "unreadable"],
    ["a stray close in a $ node", "$x }\nproject", "unreadable"],
    ["an unclosed $ block", "$x {\nproject", "unreadable"],
    ["an unclosed annotation", "(x", "unreadable"],
    ["an unclosed block comment", "/* never", "document"],
    ["a line comment with no end", "// never", "document"],
  ])("%s", (_label, text, kind) => {
    expect<string>(classifyJxn(text)).toBe(kind);
  });

  test("a $ node's comment with no line end ends the file", () => {
    expect(classifyJxn("$x // never")).toBe("document");
  });
});

describe("lintJxn", () => {
  test(String.raw`\s and \b in a quoted string are said, with where`, () => {
    const warnings = lintJxn(String.raw`input pattern="\s+"
p "${"$"}{x.replace(/\b/g, '')}"`);
    expect(warnings.map((warning) => [warning.line, warning.column])).toEqual([
      [1, 16],
      [2, 17],
    ]);
    expect(warnings[0]?.message).toContain("raw string");
  });

  test.each([
    ["a raw string", String.raw`a #"\s"#`],
    ["a multi-line raw string", ['#"""', String.raw`\s`, '"""#'].join("\n")],
    ["a raw string with no end", String.raw`a #"\s`],
    ["escapes that mean what they say", String.raw`a "\n\t\"\\s"`],
    ["a line comment", String.raw`// "\s"`],
    ["a line comment with no end, after code", String.raw`a // "\s"`],
    ["a block comment", String.raw`/* "\s" */ a`],
    ["a block comment with no end", String.raw`/* "\s"`],
  ])("%s is left alone", (_label, text) => {
    expect(lintJxn(text)).toEqual([]);
  });

  test("a multi-line quoted string is read too", () => {
    expect(lintJxn(['a """', String.raw`  \s`, '  """'].join("\n"))).toHaveLength(1);
  });
});

describe("spans", () => {
  test("say where each part of a document came from", () => {
    const text = 'div part=x {\n  span "hi"\n  state { a 1 }\n  style color=red\n}\n';
    const { document, spans } = parseJxnWithSpans(text);
    expect(document.tagName).toBe("div");
    const slice = (pointer: string): string => {
      const span = spans.get(pointer);
      return span ? text.slice(span.start, span.end) : "";
    };
    expect(slice("/attributes/part")).toBe("part=x");
    expect(slice("/children/0")).toContain('span "hi"');
    expect(slice("/state/a")).toContain("a 1");
    expect(slice("/style/color")).toContain("color=red");
  });

  test("a plain parse does not pay for them", () => {
    expect(parseJxn("div").tagName).toBe("div");
  });
});

/** Everything in the repository that is a Jx document. */
function trackedDocuments(): string[] {
  const NOT_DOCUMENTS =
    /(^|\/)(package|tsconfig|project|jx-extension|bun|nav|catalog|registry|release-assets|template-versions|bundle-budget|prose|claims|standards|renovate|manifest|capture\.lock)[^/]*\.(?:json|jxn)$|schema\.json$|\.class\.(?:json|jxn)$|\.schema\.|\/messages\/|\/data\/|\/content\/|fixtures|\.oxlint|\.vscode|\.release/u;
  return execFileSync("git", ["ls-files", "*.json", "*.jxn"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "" && !NOT_DOCUMENTS.test(file));
}

/** A tracked file's value: JSON as JSON, and a `.jxn` file through the grammar. */
function readTracked(file: string): JsonValue {
  const text = readFileSync(join(ROOT, file), "utf8");
  // SAFETY: JSON.parse without a reviver only ever yields a JSON value.
  return file.endsWith(".jxn") ? read(text) : (JSON.parse(text) as JsonValue);
}

/** Sorted keys, because only `style`'s order means anything. */
function sortKeys(value: JsonValue | undefined): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (!isJsonObject(value)) {
    return value ?? null;
  }
  const keys = Object.keys(value).toSorted();
  return Object.fromEntries(keys.map((key) => [key, sortKeys(value[key])]));
}

/** Every `style` in a document, as written, which is what proves their order. */
function stylesOf(value: JsonValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stylesOf(item));
  }
  if (!isJsonObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (key === "style") {
      return [JSON.stringify(item)];
    }
    if (key === "cases" && isJsonObject(item)) {
      // A case can be named `style`, and its value is an element.
      return Object.values(item).flatMap((entry) => stylesOf(entry));
    }
    return stylesOf(item);
  });
}

describe("the corpus", () => {
  test("every tracked document comes back deep-equal, with style order intact", () => {
    let checked = 0;
    for (const file of trackedDocuments()) {
      const parsed = readTracked(file);
      const isDocument =
        isJsonObject(parsed) &&
        (isString(parsed.tagName) || "children" in parsed || "$layout" in parsed);
      if (isDocument) {
        checked += 1;
        const back = roundTrip(parsed);
        expect([file, sortKeys(back)]).toEqual([file, sortKeys(parsed)]);
        expect([file, stylesOf(back)]).toEqual([file, stylesOf(parsed)]);
      }
    }
    // Enough that this cannot pass by finding nothing.
    expect(checked).toBeGreaterThan(400);
  }, 60_000);
});
