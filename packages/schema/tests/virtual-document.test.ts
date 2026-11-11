/**
 * The modules a checker reads for a whole `.jxn` document (`spec.md` §23.3): what each one says,
 * and that every stretch of one that stands for the author's text says where that text is.
 */
import { describe, expect, test } from "bun:test";
import { generateVirtualDocument } from "../src/jxn/virtual-document.ts";
import type { OutsideState, VirtualDocument, VirtualUnit } from "../src/jxn/virtual-document.ts";
import { BOTH, CURRENT, EVENT_GLOBALS, eventOn } from "./event-types.ts";

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
function mapped(unit: VirtualUnit | undefined, source: string): string[][] {
  return (unit?.spans ?? []).map((span) => [
    span.kind,
    (unit?.text ?? "").slice(span.virtualStart, span.virtualStart + span.virtualLength),
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

/** The line a body module adds for the names it is given, and the body's first line. */
function insideOf(unit: VirtualUnit): string[] {
  const lines = unit.text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("void ["));
  return lines.slice(start, start + 2);
}

/** What a body module says before the function: what it imports, and what its event is. */
function headOf(unit: VirtualUnit | undefined): string[] {
  const lines = unit?.text.split("\n") ?? [];
  return lines
    .slice(
      0,
      lines.findIndex((line) => line.startsWith("void [")),
    )
    .filter((line) => !EVENT_GLOBALS.includes(line));
}

const CLOSED = "[key: `$${string}`]: any;";
/** The function of a body that names no parameter. */
const SIGNED = "export async function body(this: any, state: State) {";
const OPEN = "[key: string]: any;";
/** What a document that is no component says it defines, which ends its main module. */
const DEFINES_NONE = "export interface $elements {}";

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
        DEFINES_NONE,
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
      file("export interface State {", "  count: number;", `  ${CLOSED}`, "}", DEFINES_NONE),
    );
    expect(generate("").main.text).toBe(
      file("export interface State {", `  ${CLOSED}`, "}", DEFINES_NONE),
    );
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
    expect(written.supplemental.map((unit) => insideOf(unit))).toEqual([
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
  test("reads a State the main module declares, under each element on the way down", () => {
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
    expect(written.main.text).toBe(
      file(
        "export interface State {",
        "  count: number;",
        `  ${CLOSED}`,
        "}",
        "export interface State$1 extends State {",
        "  label: string;",
        "  pick: any;",
        "}",
        "export interface State$2 extends State$1 {",
        "  deep: boolean;",
        "}",
        DEFINES_NONE,
      ),
    );
    // Every entry is its own token, so a rename from a body reaches the one that declares it.
    expect(mapped(written.main, source)).toEqual([
      ["verbatim", "count", "count"],
      ["verbatim", "label", "label"],
      ["verbatim", "pick", "pick"],
      ["verbatim", "deep", "deep"],
    ]);
    expect(written.supplemental.map((unit) => [headOf(unit), insideOf(unit)])).toEqual([
      [
        ['import type { State$1 as State } from "./a.jxn";', "declare const event: any;", SIGNED],
        ["void [state];", "return 1"],
      ],
      [
        [
          'import type { State$1 as State } from "./a.jxn";',
          `declare const event: ${eventOn("ul", "keydown", CURRENT)};`,
          SIGNED,
        ],
        ["void [state];", "state.label"],
      ],
      [
        [
          'import type { State$2 as State } from "./a.jxn";',
          `declare const event: ${eventOn("li", "click", BOTH)};`,
          "export async function body(this: any, state: State, e: typeof event) {",
        ],
        ["void [state, e];", "state.deep"],
      ],
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
    expect(written.main.text).toBe(
      file(
        "interface State { a: number }",
        "export interface JxState {",
        "  count: number;",
        '  "my key": number;',
        "  title: string;",
        `  ${OPEN}`,
        "}",
        "export interface JxState$1 {",
        '  "my key": JxState["my key"];',
        '  title: JxState["title"];',
        "  count: string;",
        "  extra: number;",
        `  ${OPEN}`,
        "}",
        DEFINES_NONE,
      ),
    );
    expect(headOf(written.supplemental[0])[0]).toBe(
      'import type { JxState$1 as State } from "./a.jxn";',
    );
    expectSound(written, source);
  });

  test("is given what the scripts export to an entry of that scope", () => {
    const source = file(
      "div {",
      '  script "export const twice = (state: State$1) => state.n * 2;"',
      '  script timing=server "export async function user() { return 1; }"',
      "  state { top 1 }",
      "  p {",
      "    state { n 1; (export)twice; (server)user }",
      '    (fn)onclick "state.twice"',
      "  }",
      "  b {",
      "    state { z 1 }",
      "  }",
      "}",
    );
    const written = generate(source);
    expect(written.main.text).toBe(
      file(
        "export const twice = (state: State$1) => state.n * 2;",
        "export interface State {",
        "  top: number;",
        `  ${CLOSED}`,
        "}",
        "export interface State$1 extends State {",
        "  n: number;",
        '  twice: (typeof import("./a.jxn").twice) extends (...args: any[]) => infer R ? R : any;',
        "}",
        "export interface State$2 extends State {",
        "  z: number;",
        "}",
        DEFINES_NONE,
      ),
    );
    // The root is augmented whatever it holds, and another scope only by what the server gives it.
    expect(written.supplemental[0]?.text).toBe(
      file(
        "export async function user() { return 1; }",
        'declare module "./a.jxn" {',
        "  interface State {",
        "  }",
        "  interface State$1 {",
        "    user: typeof user extends (...args: any[]) => infer R ? Awaited<R> | null : any;",
        "  }",
        "}",
        "export {};",
      ),
    );
    expectSound(written, source);
  });
});

describe("a body drawn by a map", () => {
  const source = file(
    "ul {",
    "  state {",
    "    todos {",
    '      - { title "a"; tags { - "x" } }',
    "    }",
    "  }",
    '  $array items=(ref)"#/state/todos" {',
    "    li {",
    '      (fn)onclick "state.$map.item.title"',
    '      (fn)onkeydown "state.$map.index"',
    '      $array items=(ref)"$map/item/tags" {',
    '        b { (fn)onclick "state.$map.item" }',
    "      }",
    "    }",
    "  }",
    '  (fn)onscroll "state.todos"',
    "}",
  );
  const written = generate(source);
  const item =
    "(NonNullable<(State extends { todos: infer V } ? V : any)> extends readonly (infer I)[] ? I : any)";

  test("reads the row it is drawn for as $map, declared over the state around it", () => {
    const tags = `(NonNullable<${item}> extends { tags: infer V } ? V : any)`;
    expect(written.main.text).toBe(
      file(
        "export interface State {",
        "  todos: { title: string; tags: string[] }[];",
        `  ${CLOSED}`,
        "}",
        "export interface State$1 extends State {",
        `  $map: { item: ${item}; index: number };`,
        "}",
        "export interface State$2 extends State {",
        `  $map: { item: (NonNullable<${tags}> extends readonly (infer I)[] ? I : any); index: number };`,
        "}",
        DEFINES_NONE,
      ),
    );
    expectSound(written, source);
  });

  test("shares one State between the bodies of a row, and reads the nearest map's", () => {
    const bodies = written.supplemental.slice(0, 4);
    expect(bodies.map((unit) => [headOf(unit)[0], insideOf(unit)[1]])).toEqual([
      ['import type { State } from "./a.jxn";', "state.todos"],
      ['import type { State$1 as State } from "./a.jxn";', "state.$map.item.title"],
      ['import type { State$1 as State } from "./a.jxn";', "state.$map.index"],
      ['import type { State$2 as State } from "./a.jxn";', "state.$map.item"],
    ]);
  });

  test("is told nothing of $map where the document's own state declares one", () => {
    const own = generate(
      file(
        "ul {",
        "  state { $map 1 }",
        '  $array items=(ref)"#/state/todos" {',
        '    li { (fn)onclick "state.$map" }',
        "  }",
        "}",
      ),
    );
    expect(own.main.text).toBe(
      file("export interface State {", "  $map: number;", `  ${CLOSED}`, "}", DEFINES_NONE),
    );
    expect(headOf(own.supplemental[0])[0]).toBe('import type { State } from "./a.jxn";');
  });
});

describe("the event a body is given", () => {
  const source = file(
    "div {",
    "  state {",
    '    (fn)save e "void e"',
    '    (fn)both e "void e"',
    '    (fn)called e "state.called(e)"',
    '    (fn)free "return 1"',
    "  }",
    '  button "Go" onclick=(ref)"#/state/save" onkeydown=(ref)"#/state/both"',
    '  form onsubmit=(ref)"#/state/both" {',
    '    input oninput=(ref)"#/state/called"',
    '    (fn)onreset event more "event.preventDefault()"',
    "  }",
    "  svg {",
    '    circle { (fn)onclick "event.currentTarget.r" }',
    '    foreignObject { p { (fn)onclick "event" } }',
    "  }",
    '  my-el { (fn)onchange "event.detail" }',
    "}",
  );
  const written = generate(source);
  const heads = written.supplemental.map((unit) => headOf(unit).slice(1));

  test("is the event of the binding that names a state function, and any of several", () => {
    expect(heads.slice(0, 2)).toEqual([
      [
        `declare const event: ${eventOn("button", "click", BOTH)};`,
        "export async function body(this: any, state: State, e: typeof event) {",
      ],
      [
        `declare const event: ${eventOn("button", "keydown", BOTH)} | ${eventOn("form", "submit", CURRENT)};`,
        "export async function body(this: any, state: State, e: typeof event) {",
      ],
    ]);
  });

  test("is any for a function the document also calls, and for one nothing binds", () => {
    expect(heads.slice(2, 4)).toEqual([
      [
        "declare const event: any;",
        "export async function body(this: any, state: State, e: any) {",
      ],
      ["declare const event: any;", SIGNED],
    ]);
  });

  test("is written on a parameter called event, and nothing after it is typed", () => {
    expect(heads[4]).toEqual([
      `export async function body(this: any, state: State, event: ${eventOn("form", "reset", CURRENT)}, more: any) {`,
    ]);
  });

  test("is read off the SVG elements inside svg, and off HTML's again inside foreignObject", () => {
    expect(heads.slice(5, 7)).toEqual([
      [`declare const event: ${eventOn("circle", "click", BOTH, "SVGElementTagNameMap")};`, SIGNED],
      [`declare const event: ${eventOn("p", "click", BOTH)};`, SIGNED],
    ]);
  });

  test("is looked up for a custom element too, which answers any unless the project names it", () => {
    expect(heads[7]).toEqual([
      `declare const event: ${eventOn('"my-el"', "change", BOTH)};`,
      SIGNED,
    ]);
  });

  test("declares the interfaces it reads, so a project without the DOM library has them", () => {
    const lines = written.supplemental[0]?.text.split("\n") ?? [];
    expect(lines.slice(1, 6)).toEqual(EVENT_GLOBALS);
    // Where the event is any there is nothing to read.
    expect(written.supplemental[3]?.text).not.toContain("declare global");
    expectSound(written, source);
  });
});

/** The module of one template: the function it is the value of. */
const templateOf = (imported: string, value: string): string =>
  file(
    "// @ts-check",
    `/** @import { ${imported} } from "./a.jxn" */`,
    "/**",
    " * @param {State} state",
    ' * @param {State["$map"]} $map',
    ' * @param {State["$map"] extends { item: infer I } ? I : any} item',
    ' * @param {State["$map"] extends { index: infer I } ? I : any} index',
    ' * @param {State["$site"]} $site',
    ' * @param {State["$page"]} $page',
    " */",
    "export function template(state, $map, item, index, $site, $page) {",
    "void [state, $map, item, index, $site, $page];",
    `return \`${value}\`;`,
    "}",
  );

describe("a template", () => {
  const source = file(
    "div {",
    "  state {",
    "    count 0",
    '    label "${state.count} left"',
    "    todos {",
    '      - { title "a" }',
    "    }",
    "  }",
    '  p "Said \\"${state.label}\\"" title="${state.count}"',
    "  ul {",
    '    $array items=(ref)"#/state/todos" {',
    '      li #"${item.title}"#',
    "    }",
    "  }",
    "}",
  );
  const written = generate(source);

  test("is a module of JavaScript, as the runtime compiles it, after the bodies", () => {
    expect(written.supplemental.map((unit) => unit.extension)).toEqual([
      ".js",
      ".js",
      ".js",
      ".js",
      ".ts",
    ]);
    expect(
      generate(file("div {", '  (fn)onclick "void 0"', '  p "${1}"', "}")).supplemental,
    ).toEqual([
      expect.objectContaining({ extension: ".ts" }),
      expect.objectContaining({ extension: ".js" }),
    ]);
  });

  test("is the function it is the value of, given the names the runtime gives one", () => {
    expect(written.supplemental.slice(0, 4).map((unit) => unit.text)).toEqual([
      templateOf("State", "${state.count} left"),
      templateOf("State", 'Said "${state.label}"'),
      templateOf("State", "${state.count}"),
      // In a row it reads the row's State, by the name every module calls its own.
      templateOf("State$1 as State", "${item.title}"),
    ]);
  });

  test("is joined to the string it is, its quotes standing for the backticks", () => {
    expect(mapped(written.supplemental[0], source)).toEqual([
      ["atom", "`", '"'],
      ["verbatim", "${state.count} left", "${state.count} left"],
      ["atom", "`;\n}\n", '"'],
    ]);
    // An escape is one stretch, and so is each end of a string written raw.
    expect(mapped(written.supplemental[1], source)).toEqual([
      ["atom", "`", '"'],
      ["verbatim", "Said ", "Said "],
      ["atom", '"', String.raw`\"`],
      ["verbatim", "${state.label}", "${state.label}"],
      ["atom", '"', String.raw`\"`],
      ["atom", "`;\n}\n", '"'],
    ]);
    expect(mapped(written.supplemental[3], source)).toEqual([
      ["atom", "`", "#"],
      ["verbatim", "${item.title}", "${item.title}"],
      ["atom", "`;\n}\n", "#"],
    ]);
    expectSound(written, source);
  });

  test("is not read where a string is data", () => {
    const data = generate(
      file(
        "div {",
        "  state {",
        '    list { - "${data}" }',
        '    (fn)go "return `${1}`"',
        "  }",
        "}",
      ),
    );
    expect(data.supplemental.map((unit) => unit.extension)).toEqual([".ts"]);
  });
});

describe("a reference", () => {
  const source = file(
    "div {",
    "  state {",
    "    count 0",
    '    "my key" { "a/b" 1 }',
    "    todos {",
    '      - { title "a" }',
    "    }",
    '    (fn)save "void 0"',
    "  }",
    '  p (ref)"#/state/count" title=(ref)"#/state/my key/a~1b" hidden=(ref)"#/state/todos/0/title"',
    String.raw`  button onclick=(ref)"#/state/save" onkeydown=(ref)"#/state/todos/0" lang=(ref)"#/state/sa\u{76}e"`,
    "  ul {",
    '    $array items=(ref)"#/state/todos" {',
    String.raw`      li textContent=(ref)"$map/item/title" title=(ref)"#/$map/index" id=(ref)"\u{24}map/item" {`,
    '        lang { $ref "#/state/count" }',
    "      }",
    "    }",
    "  }",
    '  i title=(ref)"window#/name"',
    "}",
  );
  const written = generate(source);
  const unit = written.supplemental.at(-1);
  const click = eventOn("button", "click", BOTH);

  test("is its path read off the State of where it stands, in one module for them all", () => {
    expect(written.supplemental).toHaveLength(2);
    expect(unit?.extension).toBe(".ts");
    expect(unit?.text).toBe(
      file(
        'import type { State, State$1 } from "./a.jxn";',
        ...EVENT_GLOBALS,
        "declare function bound<E>(handler: (state: any, event: E) => unknown): void;",
        "declare const s0: State;",
        "declare const s1: State$1;",
        "void s0.count;",
        // A name that is no identifier is read by its string, and each step after the first asks.
        'void s0["my key"]?.["a/b"];',
        'void s0.todos?.["0"]?.title;',
        // A handler is given to what a binding calls, and only a function of state itself is one.
        `bound<${click}>(s0.save);`,
        'void s0.todos?.["0"];',
        "void s0.save;",
        "void s0.todos;",
        // One written out as a block is the same reference.
        "void s0.count;",
        // A row is read off the State that declares it, in either spelling.
        "void s1.$map?.item?.title;",
        "void s1.$map?.index;",
        "void s1.$map?.item;",
      ),
    );
  });

  test("is joined name by name to the string it is written as", () => {
    const spans = mapped(unit, source);
    expect(spans.slice(0, 6)).toEqual([
      ["atom", "s0.", "#/state/"],
      ["verbatim", "count", "count"],
      ["atom", "s0", "#/state/"],
      ["atom", '["my key"]', "my key"],
      ["atom", "?.", "/"],
      ["atom", '["a/b"]', "a~1b"],
    ]);
    // A name the file spells another way is one stretch, whole.
    expect(spans).toContainEqual(["atom", "save", String.raw`sa\u{76}e`]);
    expect(spans.slice(-12)).toEqual([
      ["atom", "s1.$map", "$map"],
      ["atom", "?.", "/"],
      ["verbatim", "item", "item"],
      ["atom", "?.", "/"],
      ["verbatim", "title", "title"],
      ["atom", "s1.", "#/"],
      ["verbatim", "$map", "$map"],
      ["atom", "?.", "/"],
      ["verbatim", "index", "index"],
      ["atom", "s1.$map", String.raw`\u{24}map`],
      ["atom", "?.", "/"],
      ["verbatim", "item", "item"],
    ]);
    expectSound(written, source);
  });

  test("declares nothing for a handler where no reference binds one", () => {
    const plain = generate(file("div {", "  state { count 0 }", '  p (ref)"#/state/count"', "}"));
    expect(plain.supplemental.map((each) => each.text)).toEqual([
      file('import type { State } from "./a.jxn";', "declare const s0: State;", "void s0.count;"),
    ]);
  });

  test("is no module where a document refers to nothing in state or a row", () => {
    const none = generate(
      file("div {", '  i title=(ref)"window#/name" lang=(ref)"#/$defs/a"', "}"),
    );
    expect(none.supplemental).toEqual([]);
  });
});

/** What the references module declares before it holds a prop against its component. */
const PROPS = [
  "type Props<S> = { [K in keyof S]?: S[K] | null | undefined };",
  "declare function props<T extends string>(",
  "  given: T extends keyof Elements ? Props<Elements[T]> : any,",
  "): void;",
  "declare const unchecked: any;",
];

describe("what a document defines", () => {
  /** The last line of a document's main module. */
  const defined = (source: string): string | undefined =>
    generate(source).main.text.trimEnd().split("\n").at(-1);

  test("is its State under its root's tag, when that is one a component has", () => {
    expect(defined(file("my-card {", '  state { title "t"; count 0 }', "}"))).toBe(
      'export interface $elements { "my-card": State }',
    );
  });

  test("is JxState where that is what its State is called", () => {
    const source = file(
      "my-card {",
      '  script "export interface State { a: 1 }"',
      "  state { count 0 }",
      "}",
    );
    expect(defined(source)).toBe('export interface $elements { "my-card": JxState }');
  });

  test("is nothing for a root the platform names, or one with no tag", () => {
    expect(defined(file("div {", "  state { count 0 }", "}"))).toBe(DEFINES_NONE);
    expect(defined(file("state { count 0 }"))).toBe(DEFINES_NONE);
  });
});

describe("what a component is given", () => {
  const source = file(
    '$elements (ref)"./my-card.jxn" (ref)"./old.json" "pkg" (ref)"/abs/x-y.jxn"',
    "div {",
    '  state { heading "x"; total 3; rows { - { name "a" } } }',
    "  my-card {",
    '    $props title=(ref)"#/state/heading" count="3" "my key"=#true ratio=1.5 tpl="${state.total}" far=(ref)"window#/x" none=#null {',
    "      list { - 1 }",
    '      deep { inner (ref)"#/state/total" }',
    "    }",
    "  }",
    '  other-thing { $props { c { $ref "#/state/rows/0/name" } } }',
    '  p hidden=(ref)"#/state/total" { $props a=1 }',
    '  $element "x-${state.heading}" { $props b=2 }',
    "  ul {",
    '    $array items=(ref)"#/state/rows" {',
    '      my-card { $props title=(ref)"$map/item/name" }',
    "    }",
    "  }",
    "}",
  );
  const written = generate(source, {
    components: { "my-card": "./my-card.jxn", "other-thing": "../components/other-thing.jxn" },
  });
  const unit = written.supplemental.at(-1);

  test("is held, one prop to a line, against the State of the document its tag names", () => {
    expect(written.problems).toEqual([]);
    expect(unit?.extension).toBe(".ts");
    expect(unit?.text).toBe(
      file(
        'import type { State, State$1 } from "./a.jxn";',
        // Itself, then each `.jxn` file `$elements` names, then each project component a prop names.
        'import type { $elements as e0 } from "./a.jxn";',
        'import type { $elements as e1 } from "./my-card.jxn";',
        'import type { $elements as e2 } from "../components/other-thing.jxn";',
        "export type Elements = e0 & e1 & e2;",
        ...PROPS,
        "declare const s0: State;",
        "declare const s1: State$1;",
        // A reference inside a prop's value is read for itself, and so is one that is no prop.
        "void s0.total;",
        "void s0.total;",
        "void s0.rows;",
        // One that is the prop is the prop's value, and is written the once.
        'props<"my-card">({ title: s0.heading });',
        'props<"my-card">({ count: "3" });',
        'props<"my-card">({ "my key": true });',
        'props<"my-card">({ ratio: 1.5 });',
        // A template, a reference out of the document, nothing, a list and an object are not held.
        'props<"my-card">({ tpl: unchecked });',
        'props<"my-card">({ far: unchecked });',
        'props<"my-card">({ none: unchecked });',
        'props<"my-card">({ list: unchecked });',
        'props<"my-card">({ deep: unchecked });',
        'props<"other-thing">({ c: s0.rows?.["0"]?.name });',
        'props<"my-card">({ title: s1.$map?.item?.name });',
      ),
    );
  });

  test("is joined to its name and its value, and a file to the entry that names it", () => {
    const spans = mapped(unit, source);
    expect(spans.slice(0, 1)).toEqual([["atom", '"./my-card.jxn"', '"./my-card.jxn"']]);
    expect(spans.slice(7, 21)).toEqual([
      ["verbatim", "title", "title"],
      ["atom", "s0.", "#/state/"],
      ["verbatim", "heading", "heading"],
      ["verbatim", "count", "count"],
      ["atom", '"3"', '"3"'],
      ["atom", '"my key"', '"my key"'],
      ["atom", "true", "#true"],
      ["verbatim", "ratio", "ratio"],
      ["atom", "1.5", "1.5"],
      ["verbatim", "tpl", "tpl"],
      ["verbatim", "far", "far"],
      ["verbatim", "none", "none"],
      ["verbatim", "list", "list"],
      ["verbatim", "deep", "deep"],
    ]);
    expect(spans.slice(-6)).toEqual([
      ["verbatim", "title", "title"],
      ["atom", "s1.$map", "$map"],
      ["atom", "?.", "/"],
      ["verbatim", "item", "item"],
      ["atom", "?.", "/"],
      ["verbatim", "name", "name"],
    ]);
    expectSound(written, source);
  });

  test("leaves alone an element the platform names, and a tag that is made when it runs", () => {
    expect(unit?.text).not.toContain("a: 1");
    expect(unit?.text).not.toContain("b: 2");
  });

  test("takes anything where no document read here defines the tag", () => {
    const alone = file("div {", "  my-card { $props count=3 }", "}");
    const made = generate(alone);
    expect(made.supplemental.map((each) => each.text)).toEqual([
      file(
        'import type { $elements as e0 } from "./a.jxn";',
        "export type Elements = e0;",
        ...PROPS,
        'props<"my-card">({ count: 3 });',
      ),
    ]);
    expect(mapped(made.supplemental[0], alone)).toEqual([
      ["verbatim", "count", "count"],
      ["atom", "3", "3"],
    ]);
    expectSound(made, alone);
  });

  test("is nothing where an instance is given no props", () => {
    expect(generate(file("div {", '  my-card "text"', "}")).supplemental).toEqual([]);
  });
});

describe("a document that names its components", () => {
  const source = file(
    "$elements {",
    '  - { $ref "./x-y.jxn" }',
    '  - (ref)"../z-z.jxn"',
    '  - (ref)"./a.jxn"',
    '  - "pkg"',
    "}",
    "div",
  );
  const written = generate(source);

  test("imports each one though it gives them nothing, so a file that is not there is told of", () => {
    expect(written.supplemental.map((each) => each.text)).toEqual([
      file(
        // The document itself is first, and naming it again is the same import.
        'import type { $elements as e0 } from "./a.jxn";',
        'import type { $elements as e1 } from "./x-y.jxn";',
        'import type { $elements as e2 } from "../z-z.jxn";',
        "export type Elements = e0 & e1 & e2;",
      ),
    ]);
  });

  test("joins each file to the string that names it, in either spelling", () => {
    expect(mapped(written.supplemental[0], source)).toEqual([
      ["atom", '"./a.jxn"', '"./a.jxn"'],
      ["atom", '"./x-y.jxn"', '"./x-y.jxn"'],
      ["atom", '"../z-z.jxn"', '"../z-z.jxn"'],
    ]);
    expectSound(written, source);
  });
});

describe("a file that is not a document", () => {
  test("is a module that defines nothing when it is a project file, which holds no code", () => {
    const written = generate(file('project "x"', 'defaults layout="./layouts/base.jxn"'));
    expect(written).toEqual({
      main: { extension: ".ts", spans: [], text: file(DEFINES_NONE) },
      problems: [],
      supplemental: [],
    });
  });

  test("is a module that defines nothing, and one problem, when it is not Jx Notation", () => {
    const source = file("div {", "  state { count 0 }", "}", "p");
    const written = generate(source);
    expect(written.main).toEqual({ extension: ".ts", spans: [], text: file(DEFINES_NONE) });
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
