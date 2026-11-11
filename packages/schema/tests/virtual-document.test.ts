/**
 * The modules a checker reads for a whole `.jxn` document (`spec.md` §23.3): what each one says,
 * and that every stretch of one that stands for the author's text says where that text is.
 */
import { describe, expect, test } from "bun:test";
import { generateVirtualDocument } from "../src/jxn/virtual-document.ts";
import type { OutsideState, VirtualDocument, VirtualUnit } from "../src/jxn/virtual-document.ts";

const SPECIFIER = "./a.jxn";

/** A file, one line to a string. */
const file = (...lines: string[]): string => `${lines.join("\n")}\n`;

/** The modules written for a file. */
function generate(source: string, outside?: OutsideState): VirtualDocument {
  return generateVirtualDocument(
    source,
    outside ? { outside, specifier: SPECIFIER } : { specifier: SPECIFIER },
  );
}

/** What each span of a module says: its kind, the module's text, and the file's. */
function mapped(unit: VirtualUnit, source: string): string[][] {
  return unit.spans.map((span) => [
    span.kind,
    unit.text.slice(span.virtualStart, span.virtualStart + span.virtualLength),
    source.slice(span.originalStart, span.originalStart + span.originalLength),
  ]);
}

/**
 * What must hold of every module whatever the file: a span is inside both texts, the spans go up
 * the module without overlapping, and a verbatim one is the same text on both sides.
 */
function expectSound(written: VirtualDocument, source: string): void {
  for (const unit of [written.main, ...written.supplemental]) {
    let end = 0;
    for (const span of unit.spans) {
      expect(span.virtualStart).toBeGreaterThanOrEqual(end);
      end = span.virtualStart + span.virtualLength;
      expect(end).toBeLessThanOrEqual(unit.text.length);
      expect(span.originalStart).toBeGreaterThanOrEqual(0);
      expect(span.originalStart + span.originalLength).toBeLessThanOrEqual(source.length);
      if (span.kind === "verbatim") {
        expect(unit.text.slice(span.virtualStart, end)).toBe(
          source.slice(span.originalStart, span.originalStart + span.originalLength),
        );
      }
    }
  }
}

/** The members of the first interface a module declares, one to a line. */
function membersOf(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^\s*(?:export )?interface /u.test(line));
  const end = lines.findIndex((line, index) => index > start && line.trim() === "}");
  return lines.slice(start + 1, end).map((line) => line.trim());
}

const CLOSED = "[key: `$${string}`]: any;";
const OPEN = "[key: string]: any;";

describe("the main module", () => {
  const source = file(
    "div {",
    '  script #"""',
    "    export const double = (state: State) => state.count * 2;",
    "    export function greet(state: State, event: Event) {",
    "      state.count += 1;",
    "      void event;",
    "    }",
    '    """#',
    "  state {",
    "    count 0",
    '    "my key" "x"',
    "    (export)double",
    "    (export)hello $export=greet",
    "    (export)later $lazy=#true",
    '    (fn)go a b "state.count = a + b"',
    "  }",
    '  (fn)onclick "state.hello(event); state.later()"',
    "}",
  );
  const written = generate(source);

  test("is the client script as written, then State", () => {
    expect(written.main.text).toBe(
      file(
        "export const double = (state: State) => state.count * 2;",
        "export function greet(state: State, event: Event) {",
        "  state.count += 1;",
        "  void event;",
        "}",
        "export interface State {",
        "  count: number;",
        '  "my key": string;',
        '  double: (typeof import("./a.jxn").double) extends (...args: any[]) => infer R ? R : any;',
        '  hello: typeof import("./a.jxn").greet;',
        '  later: (typeof import("./a.jxn").later) extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : any;',
        "  go: (...args: any[]) => any;",
        `  ${CLOSED}`,
        "}",
      ),
    );
    expect(written.problems).toEqual([]);
    expectSound(written, source);
  });

  test("maps each line of the script to where it was written", () => {
    const lines = mapped(written.main, source).slice(0, 5);
    expect(lines.map(([kind]) => kind)).toEqual(Array.from({ length: 5 }, () => "verbatim"));
    expect(lines.map(([, text]) => text)).toEqual([
      "export const double = (state: State) => state.count * 2;\n",
      "export function greet(state: State, event: Event) {\n",
      "  state.count += 1;\n",
      "  void event;\n",
      "}",
    ]);
  });

  test("maps a name to its own token, and an export to the token that names it", () => {
    expect(mapped(written.main, source).slice(5)).toEqual([
      ["verbatim", "count", "count"],
      // A name TypeScript writes differently stands for its token as a whole.
      ["atom", '"my key"', '"my key"'],
      // One token is both the entry's name and the export's.
      ["verbatim", "double", "double"],
      ["verbatim", "double", "double"],
      ["verbatim", "hello", "hello"],
      ["verbatim", "greet", "greet"],
      ["verbatim", "later", "later"],
      ["verbatim", "later", "later"],
      ["verbatim", "go", "go"],
    ]);
  });

  test("ends a script that has no line ending of its own, and adds none to one that has", () => {
    const without = generate(file("div {", '  script "export const a = 1;"', "}"));
    expect(without.main.text.startsWith("export const a = 1;\nexport interface State {")).toBe(
      true,
    );
    const withOne = generate(file("div {", String.raw`  script "export const a = 1;\n"`, "}"));
    expect(withOne.main.text.startsWith("export const a = 1;\nexport interface State {")).toBe(
      true,
    );
  });

  test("is State alone for a document with no script", () => {
    expect(generate(file("div {", "  state { count 0 }", "}")).main.text).toBe(
      file("export interface State {", "  count: number;", `  ${CLOSED}`, "}"),
    );
    expect(generate("").main.text).toBe(file("export interface State {", `  ${CLOSED}`, "}"));
  });

  test("leaves to the entry's own shape an export no token can carry", () => {
    const other = file(
      "div {",
      '  script "export const a = 1;"',
      "  state {",
      "    (export)d $export=my-fn",
      '    (fn)c $src="./other.ts" $export=c',
      '    (fn)onclick "state.d()"',
      "  }",
      "}",
    );
    const result = generate(other);
    expect(membersOf(result.main.text)).toEqual([
      // A name that is not an identifier, which `import("…").` cannot be followed by.
      "d: (...args: any[]) => any;",
      // Another module's export, which is not this document's to describe.
      "c: any;",
      "onclick: (...args: any[]) => any;",
      CLOSED,
    ]);
    expectSound(result, other);
  });

  test("calls its State JxState when the script has a State of its own", () => {
    for (const declared of [
      "interface State { a: number }",
      "type State = { a: number };",
      "class State {}",
      'import type { State } from "./state.ts";',
      'import { helper, State } from "./state.ts";',
    ]) {
      const other = file(
        "div {",
        `  script #"${declared}"#`,
        "  state {",
        "    count 0",
        '    (fn)go "state.count += 1"',
        "  }",
        "}",
      );
      const result = generate(other);
      expect(result.main.text).toContain("export interface JxState {");
      expect(result.supplemental[0]?.text.split("\n")[0]).toBe(
        'import type { JxState as State } from "./a.jxn";',
      );
      expectSound(result, other);
    }
    const plain = generate(file("div {", '  script "export const estate = 1;"', "}"));
    expect(plain.main.text).toContain("export interface State {");
  });
});

describe("what a document is given from outside", () => {
  const page = file("div {", "  state { count 0 }", "}");

  test("closes State when the reader knows of no project", () => {
    expect(membersOf(generate(page).main.text).at(-1)).toBe(CLOSED);
    expect(membersOf(generate(page, {}).main.text).at(-1)).toBe(CLOSED);
  });

  test("opens State in a project with state of its own, or with a default layout", () => {
    expect(membersOf(generate(page, { state: true }).main.text).at(-1)).toBe(OPEN);
    expect(membersOf(generate(page, { layout: true }).main.text).at(-1)).toBe(OPEN);
    expect(membersOf(generate(page, { layout: false, state: false }).main.text).at(-1)).toBe(
      CLOSED,
    );
  });

  test("lets a document say for itself whether it has a layout", () => {
    const named = file('$layout "./layouts/base.jxn"', "div {", "  state { count 0 }", "}");
    expect(membersOf(generate(named).main.text).at(-1)).toBe(OPEN);
    const none = file("$layout #false", "div {", "  state { count 0 }", "}");
    expect(membersOf(generate(none, { layout: true }).main.text).at(-1)).toBe(CLOSED);
    // The project's own state reaches a page whatever wraps it.
    expect(membersOf(generate(none, { state: true }).main.text).at(-1)).toBe(OPEN);
  });
});

describe("the server module", () => {
  const source = file(
    "div {",
    '  script "export const count = (state: State) => 1;"',
    '  script timing=server #"""',
    "    export async function user(args: { id: number }) {",
    '      return { name: "a", id: args.id };',
    "    }",
    '    """#',
    "  state {",
    "    (export)count",
    "    (server)user id=1",
    "    who {",
    '      $src "#server"',
    "      $export user",
    "      timing server",
    "    }",
    "    (server)gone",
    "  }",
    "}",
  );
  const written = generate(source);

  test("is the server script, then what its functions add to State", () => {
    expect(written.supplemental).toHaveLength(1);
    expect(written.supplemental[0]?.text).toBe(
      file(
        "export async function user(args: { id: number }) {",
        '  return { name: "a", id: args.id };',
        "}",
        'declare module "./a.jxn" {',
        "  interface State {",
        "    user: typeof user extends (...args: any[]) => infer R ? Awaited<R> | null : any;",
        "    who: typeof user extends (...args: any[]) => infer R ? Awaited<R> | null : any;",
        "    gone: typeof gone extends (...args: any[]) => infer R ? Awaited<R> | null : any;",
        "  }",
        "}",
        "export {};",
      ),
    );
    expectSound(written, source);
  });

  test("maps each entry's name, and the export it names", () => {
    const [server] = written.supplemental;
    expect(server && mapped(server, source).slice(-6)).toEqual([
      ["verbatim", "user", "user"],
      ["verbatim", "user", "user"],
      ["verbatim", "who", "who"],
      ["verbatim", "user", "user"],
      ["verbatim", "gone", "gone"],
      ["verbatim", "gone", "gone"],
    ]);
  });

  test("leaves its entries out of the main module, which cannot see the functions", () => {
    expect(membersOf(written.main.text)).toEqual([
      'count: (typeof import("./a.jxn").count) extends (...args: any[]) => infer R ? R : any;',
      CLOSED,
    ]);
  });

  test("augments JxState when that is what State is called", () => {
    const own = generate(
      file(
        "div {",
        '  script "interface State { a: number }"',
        '  script timing=server "export const user = async () => 1;"',
        "  state { (server)user }",
        "}",
      ),
    );
    expect(own.supplemental[0]?.text).toContain("  interface JxState {\n    user: typeof user ");
  });

  test("is not written without a server script, and its entries are then unknown", () => {
    const none = generate(file("div {", "  state {", "    (server)user id=1", "  }", "}"));
    expect(none.supplemental).toEqual([]);
    expect(membersOf(none.main.text)).toEqual(["user: any;", CLOSED]);
  });
});

describe("a body module", () => {
  test("is the function a body is the inside of", () => {
    const source = file(
      "div {",
      "  state {",
      "    count 0",
      '    (fn)go a b """',
      "      state.count = a + b;",
      "      return state.count;",
      '      """',
      "  }",
      "}",
    );
    const written = generate(source);
    expect(written.supplemental).toHaveLength(1);
    const [body] = written.supplemental;
    expect(body?.text).toBe(
      file(
        'import type { State } from "./a.jxn";',
        "declare const event: any;",
        "export async function body(this: any, state: State, a: any, b: any) {",
        "void [state, a, b];",
        "state.count = a + b;",
        "return state.count;",
        "}",
      ),
    );
    expect(body && mapped(body, source)).toEqual([
      ["verbatim", "a", "a"],
      ["verbatim", "b", "b"],
      ["verbatim", "state.count = a + b;\n", "state.count = a + b;\n"],
      ["verbatim", "return state.count;", "return state.count;"],
    ]);
    expectSound(written, source);
  });

  test("puts state first wherever it was written, and maps it to where that was", () => {
    const source = file("div {", "  state {", '    (fn)go b state c "return b"', "  }", "}");
    const [body] = generate(source).supplemental;
    expect(body?.text).toContain("body(this: any, state: State, b: any, c: any) {");
    const spans = body ? mapped(body, source) : [];
    expect(spans).toEqual([
      ["verbatim", "state", "state"],
      ["verbatim", "b", "b"],
      ["verbatim", "c", "c"],
      ["verbatim", "return b", "return b"],
    ]);
    // The written order is `b state c`, so the spans are not in the order of the file.
    const starts = body?.spans.map((span) => span.originalStart) ?? [];
    expect(starts[0]).toBeGreaterThan(starts[1] ?? Infinity);
    expect(starts[2]).toBeGreaterThan(starts[0] ?? Infinity);
  });

  test("maps a parameter written twice to each place it was written", () => {
    const source = file("div {", "  state {", '    (fn)go a a "return a"', "  }", "}");
    const [body] = generate(source).supplemental;
    const starts = body?.spans.slice(0, 2).map((span) => span.originalStart) ?? [];
    expect(starts[1]).toBeGreaterThan(starts[0] ?? Infinity);
  });

  test("does not read a name that is not an identifier in the line it adds", () => {
    const source = file("div {", "  state {", '    (fn)go a "my-arg" "return a"', "  }", "}");
    const written = generate(source);
    const [body] = written.supplemental;
    // The name is the author's mistake, and is reported on the name: it maps to its own token.
    expect(body?.text).toContain("state: State, a: any, my-arg: any) {\nvoid [state, a];\n");
    expect(body && mapped(body, source)[1]).toEqual(["verbatim", "my-arg", "my-arg"]);
    expectSound(written, source);
  });

  test("maps an escape as one piece, and the text either side of it exactly", () => {
    const source = file(
      "div {",
      "  state { count 0 }",
      String.raw`  (fn)onclick "state.count += 1;\n state.nope()"`,
      "}",
    );
    const written = generate(source);
    const [body] = written.supplemental;
    expect(body?.text).toContain("void [state];\nstate.count += 1;\n state.nope()\n}\n");
    expect(body && mapped(body, source)).toEqual([
      ["verbatim", "state.count += 1;", "state.count += 1;"],
      ["atom", "\n", String.raw`\n`],
      ["verbatim", " state.nope()", " state.nope()"],
    ]);
    expectSound(written, source);
  });

  test("is written for every string body, wherever in the tree it is", () => {
    const source = file(
      "div {",
      "  state {",
      '    (fn)go "return 1"',
      "    (export)other",
      '    (fn)far $src="./far.ts" $export=far',
      "  }",
      '  (fn)onclick "state.go()"',
      "  ul {",
      "    li {",
      '      (fn)onkeydown e "void e"',
      "    }",
      "    li {",
      "      style color=red",
      '      (fn)oninput "void 0"',
      "    }",
      "  }",
      "}",
    );
    const written = generate(source);
    expect(written.supplemental.map((unit) => unit.text.split("\n").slice(3, 5))).toEqual([
      ["void [state];", "return 1"],
      ["void [state];", "state.go()"],
      ["void [state, e];", "void e"],
      ["void [state];", "void 0"],
    ]);
    expectSound(written, source);
  });

  test("is unmapped where the file spells a key in a form the document does not hold", () => {
    // A document's keys are NFC, and this one is written decomposed.
    const source = file("div {", "  state {", '    (fn)"e\u0301" "return 1"', "  }", "}");
    const written = generate(source);
    expect(written.main.spans).toEqual([]);
    expect(written.main.text).toContain('  "\u00E9": any;');
    expect(written.supplemental[0]?.spans).toEqual([]);
    expect(written.supplemental[0]?.text).toContain("void [state];\nreturn 1\n}\n");
  });
});

describe("a body inside a nested scope", () => {
  test("reads a State that extends the root's, under each element on the way down", () => {
    const source = file(
      "div {",
      "  state { count 0 }",
      "  ul {",
      '    state { label "x"; (fn)pick "return 1" }',
      "    li {",
      "      state { deep #true }",
      '      (fn)onclick e "state.deep"',
      "    }",
      '    (fn)onkeydown "state.label"',
      "  }",
      "}",
    );
    const written = generate(source);
    expect(written.supplemental.map((unit) => unit.text)).toEqual([
      file(
        'import type { State as Root } from "./a.jxn";',
        "interface State extends Root {",
        "  label: string;",
        "  pick: any;",
        "}",
        "declare const event: any;",
        "export async function body(this: any, state: State) {",
        "void [state];",
        "return 1",
        "}",
      ),
      file(
        'import type { State as Root } from "./a.jxn";',
        "interface State extends Root {",
        "  label: string;",
        "  pick: any;",
        "}",
        "declare const event: any;",
        "export async function body(this: any, state: State) {",
        "void [state];",
        "state.label",
        "}",
      ),
      file(
        'import type { State as Root } from "./a.jxn";',
        "interface State extends Root {",
        "  label: string;",
        "  pick: any;",
        "  deep: boolean;",
        "}",
        "declare const event: any;",
        "export async function body(this: any, state: State, e: any) {",
        "void [state, e];",
        "state.deep",
        "}",
      ),
    ]);
    expectSound(written, source);
  });

  test("lists the root's members by reference where an element declares one of its names", () => {
    const source = file(
      "div {",
      '  script "interface State { a: number }"',
      '  state { count 0; "my key" 1; title "x" }',
      "  p {",
      '    state { count "now a string"; extra 1 }',
      '    (fn)onclick "state.count"',
      "  }",
      "}",
    );
    const written = generate(source, { state: true });
    expect(written.supplemental[0]?.text).toBe(
      file(
        'import type { JxState as Root } from "./a.jxn";',
        "interface State {",
        '  "my key": Root["my key"];',
        '  title: Root["title"];',
        "  count: string;",
        "  extra: number;",
        `  ${OPEN}`,
        "}",
        "declare const event: any;",
        "export async function body(this: any, state: State) {",
        "void [state];",
        "state.count",
        "}",
      ),
    );
    expectSound(written, source);
  });
});

describe("a file that is not a document", () => {
  test("is an empty module when it is a project file, which holds no code", () => {
    const written = generate(file('project "x"', 'defaults layout="./layouts/base.jxn"'));
    expect(written).toEqual({
      main: { spans: [], text: "export {};\n" },
      problems: [],
      supplemental: [],
    });
  });

  test("is an empty module and one problem when it is not Jx Notation", () => {
    const source = file("div {", "  state { count 0 }", "}", "p");
    const written = generate(source);
    expect(written.main).toEqual({ spans: [], text: "export {};\n" });
    expect(written.supplemental).toEqual([]);
    expect(written.problems).toEqual([
      {
        length: 1,
        message: "A document has one root element, and this is a second",
        offset: source.indexOf("p\n"),
      },
    ]);
  });

  test("places a problem at the end of the file on nothing, and never past it", () => {
    const written = generate("div {");
    expect(written.problems).toHaveLength(1);
    expect(written.problems[0]).toMatchObject({ length: 0, offset: 5 });
  });
});
