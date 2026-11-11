/**
 * The mapper under the real compiler (`spec.md` §23.3): `tsc` prints an error in a document's code
 * at the line and column its author wrote it, however the file spells the string it is in.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { Fixture, SLOW, buildMapper, printed } from "./fixture";
import type { Finding } from "./fixture";

const fixtures: Fixture[] = [];

/** A project deleted when the file's tests are done. */
function project(options?: ConstructorParameters<typeof Fixture>[0]): Fixture {
  const made = new Fixture(options);
  fixtures.push(made);
  return made;
}

/** A file, one line to a string. */
const lines = (...written: string[]): string => `${written.join("\n")}\n`;

/** The findings about one file, as `(line,column) code`. */
const about = (findings: readonly Finding[], name: string): string[] =>
  findings.flatMap((finding) =>
    finding.at.startsWith(`src/${name}(`)
      ? [`${finding.at.slice(`src/${name}`.length)} ${finding.code}`]
      : [],
  );

beforeAll(() => {
  buildMapper();
}, SLOW);

afterAll(() => {
  for (const made of fixtures) {
    made.remove();
  }
});

describe("an error in a document's code", () => {
  const plain = lines(
    "div {",
    "  state {",
    "    count 0",
    '    (fn)go a b """',
    "      state.count = a + b;",
    "      state.nope = 1;",
    '      """',
    "  }",
    String.raw`  (fn)onclick "state.count += 1;\n\tconst s = \"\u{e9}\"; state.gone(s)"`,
    "}",
  );
  const crlf = [
    "div {",
    "\tstate { count 0 }",
    '\t(fn)onclick """',
    '\t\tconst s = "hé\u{1F600}"; state.nope = s;',
    "\t\tstate.gone()",
    '\t\t"""',
    "}",
    "",
  ].join("\r\n");
  const raw = lines(
    "div {",
    "  state { count 0 }",
    String.raw`  (fn)onclick #"const s = "a\d"; state.nope = s;"#`,
    '  (fn)oninput ##"""',
    String.raw`    const t = "a\d" + '"#';`,
    "    state.gone(t);",
    '    """##',
    "}",
  );
  const script = lines(
    "div {",
    '  script #"""',
    "    export const double = (state: State) => state.count * 2;",
    "    export function greet(state: State, event: Event) {",
    "      state.count += 1;",
    "      void event;",
    "    }",
    "    function helper() { return 1; }",
    "    export const wrong: string = helper();",
    '    export const start = (state: State): State["count"] => state.count;',
    '    """#',
    '  script timing=server #"""',
    "    export async function user(args: { id: number }) {",
    '      return { name: "a", id: args.id };',
    "    }",
    '    """#',
    "  state {",
    "    count 0",
    "    (export)double",
    "    (export)hello $export=greet",
    "    (export)missing",
    "    (export)start",
    "    (server)user id=1",
    '    (fn)go "helper();"',
    "  }",
    "  button {",
    "    state { local 1 }",
    '    (fn)onclick "state.local += state.double; state.user?.name.toFixed(); state.hello(1)"',
    '    (fn)onkeyup "state.missing.anything; state.start.toFixed(1, 2)"',
    "  }",
    "}",
  );
  const none = lines("div {", '  (fn)onclick "state.count += 1"', "}");
  const user = lines(
    'import type { State } from "./script.jxn";',
    'import { double } from "./script.jxn";',
    "export const n: string = double({} as State);",
    'export const u: State["user"] = 5;',
  );
  const page = lines("div {", '  (fn)onclick "state.fromProject; state.$media"', "}");
  let findings: Finding[] = [];

  beforeAll(() => {
    const made = project();
    made.write("src/plain.jxn", plain);
    made.write("src/crlf.jxn", crlf);
    made.write("src/raw.jxn", raw);
    made.write("src/script.jxn", script);
    made.write("src/none.jxn", none);
    made.write("src/empty.jxn", "");
    made.write("src/comment.jxn", "// Nothing here yet.\n");
    made.write("src/bare.jxn", "p\n");
    made.write("src/user.ts", user);
    made.write("src/site/project.jxn", lines('project "x"', "state {", "  fromProject 1", "}"));
    made.write("src/site/pages/index.jxn", page);
    made.write("src/site/components/card.jxn", page);
    ({ findings } = made.check("--runExternalCode"));
  }, SLOW);

  test("is at its own line and column in a string over several lines, and after an escape", () => {
    expect(about(findings, "plain.jxn")).toEqual([
      `${printed(plain, "nope")} TS2339`,
      `${printed(plain, "gone")} TS2339`,
    ]);
  });

  test("is at its own column past tabs, CRLF line endings and characters of two code units", () => {
    expect(about(findings, "crlf.jxn")).toEqual([
      `${printed(crlf, "nope")} TS2339`,
      `${printed(crlf, "gone")} TS2339`,
    ]);
    // Two tabs, then eleven characters, then one of one code unit and one of two.
    expect(printed(crlf, "nope")).toBe("(4,27)");
  });

  test("is at its own column in a raw string, whatever its count of #", () => {
    expect(about(findings, "raw.jxn")).toEqual([
      `${printed(raw, "nope")} TS2339`,
      `${printed(raw, "gone")} TS2339`,
    ]);
  });

  test("is found in a script, at an entry naming no export, and in a body calling a helper", () => {
    expect(about(findings, "script.jxn")).toEqual([
      // The script's own mistake, where it was written.
      `${printed(script, "wrong: string")} TS2322`,
      // An entry naming an export the script does not have, on the entry.
      `${printed(script, "(export)missing", "(export)".length)} TS2694`,
      // A body is not inside the script, so it cannot call what the script keeps to itself.
      `${printed(script, '"helper();"', 1)} TS2304`,
      // What the server function resolves to reaches a body: `name` is a string.
      `${printed(script, "toFixed")} TS2551`,
      // An export is called as it is declared.
      `${printed(script, "state.hello(1)", "state.".length)} TS2554`,
      // An entry named for no export is said once, on the entry, and is anything where it is read.
      // And an export typed by the state that holds it is that type: `start` is a number.
      `${printed(script, "2)")} TS2554`,
    ]);
  });

  test("is found in a document with no state, whose State declares nothing", () => {
    expect(about(findings, "none.jxn")).toEqual([`${printed(none, "count")} TS2339`]);
  });

  test("is not found in a document with nothing to check", () => {
    for (const name of ["empty.jxn", "comment.jxn", "bare.jxn", "site/project.jxn"]) {
      expect(about(findings, name)).toEqual([]);
    }
  });

  test("is found in a module that imports a document, which is typed as what it exports", () => {
    expect(about(findings, "user.ts")).toEqual([
      `${printed(user, "n: string")} TS2322`,
      `${printed(user, "u: State")} TS2322`,
    ]);
  });

  test("is not a read of project state in a page, and is in a component", () => {
    expect(about(findings, "site/pages/index.jxn")).toEqual([]);
    expect(about(findings, "site/components/card.jxn")).toEqual([
      `${printed(page, "fromProject")} TS2339`,
    ]);
  });

  test("is never reported where the author wrote nothing", () => {
    // `noUnusedLocals` and `noUnusedParameters` are on, and would say so of a line the mapper adds.
    expect(findings.map((finding) => finding.code).filter((code) => code === "TS6133")).toEqual([]);
    const named = [
      "plain.jxn",
      "crlf.jxn",
      "raw.jxn",
      "script.jxn",
      "none.jxn",
      "user.ts",
      "site/components/card.jxn",
    ];
    expect(findings.length).toBe(named.flatMap((name) => about(findings, name)).length);
  });
});

describe("what a document says of where a body stands", () => {
  const source = lines(
    "div {",
    "  state {",
    "    count 0",
    "    todos {",
    '      - { title "a"; done #false; tags { - "x" } }',
    "    }",
    '    (fn)save e "e.currentTarget.disabled = true; e.currentTarget.nope; void e.target.form"',
    '    (fn)pick e "state.count = e.currentTarget.selectedIndex; void e.target.value; e.key"',
    "  }",
    '  button "Go" onclick=(ref)"#/state/save"',
    '  select onchange=(ref)"#/state/pick" {',
    '    option "a"',
    "  }",
    "  form {",
    "    input",
    '    (fn)onsubmit "event.preventDefault(); void event.submitter; event.currentTarget.reset(); event.target.reset()"',
    "  }",
    "  ul {",
    '    state { label "x"; count "now a string" }',
    '    $array items=(ref)"#/state/todos" {',
    "      li {",
    '        (fn)onclick "state.$map.item.done = !state.$map.item.done; state.$map.item.gone; state.$map.index.toFixed(); state.label.toFixed(); void state.count.trim(); state.todos.wrong"',
    '        $array items=(ref)"$map/item/tags" {',
    '          b { (fn)onclick "state.$map.item.toUpperCase(); state.$map.item.missing" }',
    "        }",
    "      }",
    "    }",
    "  }",
    '  svg { circle { (fn)onclick "void event.currentTarget.r.baseVal; event.currentTarget.absent" } }',
    '  my-el { (fn)onchange "void event.detail.anything" }',
    "}",
  );
  /** What every project is told, with the DOM library or without: what `state` holds. */
  const ofState = [
    // A row is an item of the list the map names, so what the item lacks is an error.
    `${printed(source, "gone")} TS2339`,
    // A scope inside the document still reads what it declares: `label` is a string.
    `${printed(source, "toFixed(); state.label.toFixed", "toFixed(); state.label.".length)} TS2551`,
    /* It declares `count` over the root's, which is a string there and nothing is said of its
       `trim`. What it does not declare is still what the root holds: `todos` is a list. */
    `${printed(source, "wrong")} TS2339`,
    // The row of the nearest map, whose list is read off the row around it: a tag is a string.
    `${printed(source, "missing")} TS2339`,
  ];

  test(
    "is the element and the event of each handler, and the row of each map",
    () => {
      const made = project();
      made.write("src/a.jxn", source);
      const { findings } = made.check("--runExternalCode");
      expect(about(findings, "a.jxn")).toEqual([
        // A function a handler names is given that binding's event, on that element.
        `${printed(source, "nope")} TS2339`,
        // A `change` is no key press, though the element it is on is the `select`.
        `${printed(source, "e.key", 2)} TS2339`,
        // Inside a form, what an event started on is not known to be the form.
        `${printed(source, "event.target.reset")} TS18047`,
        `${printed(source, "event.target.reset", "event.target.".length)} TS2339`,
        ...ofState,
        // An element inside `svg` is SVG's.
        `${printed(source, "absent")} TS2339`,
      ]);
    },
    SLOW,
  );

  test(
    "is any event at all in a project without the DOM library, and the same state",
    () => {
      const made = project({ compilerOptions: { lib: ["esnext"] } });
      made.write("src/a.jxn", source);
      const { findings } = made.check("--runExternalCode");
      expect(about(findings, "a.jxn")).toEqual(ofState);
    },
    SLOW,
  );
});

describe("an error outside a document's functions", () => {
  const templates = lines(
    "div {",
    "  state {",
    "    count 0",
    '    name "a"',
    "    todos {",
    '      - { title "a"; done #false }',
    "    }",
    '    label "${state.count.toFixed()} of ${state.nolabel}"',
    '    request { $prototype Request; url "/api/${state.count.nourl}" }',
    "  }",
    '  p "Said \\"${state.name.toFixed()}\\" and ${missing}" title="${state.notitle}"',
    '  a { attributes { href "${state.nohref}" }; style { color "${state.nocolor}" } }',
    '  p "${$site.any.thing} ${item} ${index} ${$map.x} ${$page.title}"',
    "  ul {",
    '    $array items=(ref)"#/state/todos" {',
    '      li "${item.title.notext} ${index.noindex} ${$map.item.norow} ${state.$map.item.nostate}"',
    "    }",
    "  }",
    "}",
  );
  const refs = lines(
    "div {",
    '  script #"""',
    "    export function key(state: State, event: KeyboardEvent) { void state; void event; }",
    "    export function any(state: State) { void state; }",
    '    """#',
    "  state {",
    "    count 0",
    "    user #null",
    "    todos {",
    '      - { title "a" }',
    "    }",
    "    (export)key",
    "    (export)any",
    "  }",
    '  button "Go" onclick=(ref)"#/state/key" onkeydown=(ref)"#/state/key" onfocus=(ref)"#/state/any"',
    '  button onclick=(ref)"#/state/count" hidden=(ref)"#/state/gone" title=(ref)"#/state/user/name"',
    '  input value=(ref)"#/state/todos/0/title" placeholder=(ref)"#/state/todos/0/nope"',
    "  ul {",
    '    $array items=(ref)"#/state/todos" {',
    '      li textContent=(ref)"$map/item/title" hidden=(ref)"$map/item/absent" id=(ref)"#/$map/index/zzz"',
    "    }",
    "  }",
    "}",
  );
  const syntax = lines(
    "div {",
    "  state { count 0 }",
    '  p "${(state.count as number)}"',
    '  p title="${state.count"',
    "}",
  );
  let findings: Finding[] = [];

  beforeAll(() => {
    const made = project();
    made.write("src/templates.jxn", templates);
    made.write("src/refs.jxn", refs);
    ({ findings } = made.check("--runExternalCode"));
  }, SLOW);

  test("is at its own column in a template, wherever an element holds one", () => {
    expect(about(findings, "templates.jxn")).toEqual([
      // An entry of `state` that is a string, and what configures a `Request`.
      `${printed(templates, "nolabel")} TS2551`,
      `${printed(templates, "nourl")} TS2339`,
      // What an element says, past an escape, and a name nothing declares.
      `${printed(templates, "toFixed()}\\")} TS2551`,
      `${printed(templates, "missing")} TS2304`,
      `${printed(templates, "notitle")} TS2339`,
      `${printed(templates, "nohref")} TS2339`,
      `${printed(templates, "nocolor")} TS2339`,
      // A row is typed in every name it goes by, and outside one those names are any.
      `${printed(templates, "notext")} TS2339`,
      `${printed(templates, "noindex")} TS2339`,
      `${printed(templates, "norow")} TS2339`,
      `${printed(templates, "nostate")} TS2339`,
    ]);
  });

  test("is at the name a reference misses, and at a handler its binding cannot call", () => {
    expect(about(findings, "refs.jxn")).toEqual([
      // A click is no key press: the function is not one this binding can call.
      `${printed(refs, '"#/state/key"', 1)} TS2345`,
      // What is no function is no handler.
      `${printed(refs, '"#/state/count"', 1)} TS2345`,
      `${printed(refs, "gone")} TS2339`,
      // Through what is null until it loads nothing is said, and through a list it is.
      `${printed(refs, "nope")} TS2339`,
      `${printed(refs, "absent")} TS2339`,
      `${printed(refs, "zzz")} TS2339`,
    ]);
  });

  test(
    "is at its own column where a template is not JavaScript, or does not end",
    () => {
      // A mistake of syntax is all a run reports, so these have a project of their own.
      const made = project();
      made.write("src/syntax.jxn", syntax);
      expect(about(made.check("--runExternalCode").findings, "syntax.jxn")).toEqual([
        // A type is TypeScript, and the runtime compiles a template as JavaScript.
        `${printed(syntax, "number")} TS8016`,
        // Reported on the string it is: the quote that should have followed a brace.
        `${printed(syntax, 'count"', "count".length)} TS1160`,
      ]);
    },
    SLOW,
  );
});

describe("what a component is given", () => {
  const card = lines(
    "x-card {",
    "  state {",
    '    title "t"',
    "    count 0",
    "    open #false",
    "  }",
    '  h2 "${state.title}"',
    "}",
  );
  const band = lines("y-band {", '  state { tone "chalk" }', "  x-card { $props title=1 }", "}");
  const page = lines(
    "div {",
    '  state { heading "x"; total 3; rows { - { name "a"; n 1 } } }',
    '  x-card { $props title=(ref)"#/state/heading" count=(ref)"#/state/total" open=#true }',
    '  x-card { $props title=(ref)"#/state/total" count="3" titel="x" label="${state.total}" }',
    "  y-band { $props tone=1 nope=#null }",
    "  z-none { $props anything=1 }",
    "  ul {",
    '    $array items=(ref)"#/state/rows" {',
    '      x-card { $props title=(ref)"$map/item/n" count=(ref)"$map/item/n" }',
    "    }",
    "  }",
    "}",
  );
  const lost = lines(
    "$elements {",
    '  - (ref)"../components/gone-card.jxn"',
    '  - (ref)"../components/x-card.jxn"',
    "}",
    "div {",
    "  x-card { $props title=1 }",
    "}",
  );
  const widget = lines("my-card {", '  state { title "t" }', "}");
  const uses = lines(
    '(array)$elements (ref)"./my-card.jxn"',
    "div {",
    '  my-card { $props title="a" nope=1 }',
    "}",
  );
  const loose = lines("div {", "  my-card { $props nope=1 }", "}");
  let findings: Finding[] = [];

  beforeAll(() => {
    const made = project();
    made.write("src/site/project.jxn", lines('project "x"', "state {", "  fromProject 1", "}"));
    made.write("src/site/components/x-card.jxn", card);
    made.write("src/site/components/y-band.jxn", band);
    made.write("src/site/pages/index.jxn", page);
    made.write("src/site/pages/lost.jxn", lost);
    made.write("src/widgets/my-card.jxn", widget);
    made.write("src/widgets/uses.jxn", uses);
    made.write("src/widgets/loose.jxn", loose);
    ({ findings } = made.check("--runExternalCode"));
  }, SLOW);

  test("is held against the State of a component its project keeps, at the prop's name", () => {
    expect(about(findings, "site/pages/index.jxn")).toEqual([
      // What a reference reads is not what the component holds there, and neither is a string.
      `${printed(page, 'title=(ref)"#/state/total"')} TS2322`,
      `${printed(page, 'count="3"')} TS2322`,
      // A name the component does not have, with the one it is nearest to, and one it has not.
      `${printed(page, "titel")} TS2561`,
      `${printed(page, "label")} TS2353`,
      // Each prop is told of by itself, so one mistake does not hide the next, whatever it is given.
      `${printed(page, "tone=1")} TS2322`,
      `${printed(page, "nope")} TS2353`,
      // A row is typed where a prop reads it.
      `${printed(page, 'title=(ref)"$map')} TS2322`,
    ]);
  });

  test("is held the same in a component, which uses the others", () => {
    expect(about(findings, "site/components/y-band.jxn")).toEqual([
      `${printed(band, "title=1")} TS2322`,
    ]);
    expect(about(findings, "site/components/x-card.jxn")).toEqual([]);
  });

  test("is one error at the entry naming a file that is not there, until it is", () => {
    expect(about(findings, "site/pages/lost.jxn")).toEqual([
      `${printed(lost, '"../components/gone-card.jxn"')} TS2307`,
    ]);
  });

  test("is held against a file `$elements` names, and is anything for a tag nothing names", () => {
    expect(about(findings, "widgets/uses.jxn")).toEqual([`${printed(uses, "nope")} TS2353`]);
    expect(about(findings, "widgets/loose.jxn")).toEqual([]);
    expect(about(findings, "widgets/my-card.jxn")).toEqual([]);
  });

  test("is never reported where the author wrote nothing", () => {
    expect(findings.map((finding) => finding.code).filter((code) => code === "TS6133")).toEqual([]);
    const named = [
      "site/pages/index.jxn",
      "site/components/y-band.jxn",
      "site/pages/lost.jxn",
      "widgets/uses.jxn",
    ];
    expect(findings.length).toBe(named.flatMap((name) => about(findings, name)).length);
  });
});

describe("the types a document declares", () => {
  const list = lines(
    "$defs {",
    "  TodoItem {",
    "    type object",
    "    properties {",
    "      id type=integer",
    "      text type=string",
    "      done type=boolean",
    "    }",
    "    required id text",
    "  }",
    "  Status {",
    "    type string",
    "    enum idle loading",
    "  }",
    "}",
    "todo-list {",
    "  state {",
    "    items {",
    '      type type=array items=(ref)"#/$defs/TodoItem"',
    "      (array)default",
    "    }",
    '    status type=(ref)"#/$defs/Status" default=idle',
    '    lost type=(ref)"#/$defs/Nope" default=#null',
    '    (fn)add "state.items.push({ id: 1, text: 2 })"',
    String.raw`    (fn)flip "state.status = \"done\"; state.items[0].done.valueOf()"`,
    String.raw`    (fn)fine "state.status = \"loading\"; state.items.push({ id: 1, text: \"a\" })"`,
    "  }",
    '  p "${state.items[0].txt}"',
    "  ul {",
    '    $array items=(ref)"#/state/items" {',
    '      li { (fn)onclick "state.$map.item.text.toFixed(); state.$map.item.absent" }',
    "    }",
    "  }",
    "}",
  );
  const page = lines(
    "div {",
    '  todo-list { $props status="nope" }',
    '  todo-list { $props status="idle" }',
    "}",
  );
  const uses = lines(
    'import type { $defs } from "./site/components/todo-list.jxn";',
    'export const item: $defs.TodoItem = { id: "x", text: "a" };',
    'export const state: $defs.Status = "loading";',
  );
  let findings: Finding[] = [];

  beforeAll(() => {
    const made = project();
    made.write("src/site/project.jxn", lines('project "x"'));
    made.write("src/site/components/todo-list.jxn", list);
    made.write("src/site/pages/index.jxn", page);
    made.write("src/uses.ts", uses);
    ({ findings } = made.check("--runExternalCode"));
  }, SLOW);

  test("are what its code is held to, at the name a reference ends in where that is no definition", () => {
    expect(about(findings, "site/components/todo-list.jxn")).toEqual([
      // A reference to a definition the document does not hold, at the name and not the string.
      `${printed(list, "Nope")} TS2694`,
      // A property of a definition is the type its schema says.
      `${printed(list, "text: 2")} TS2322`,
      // An enumeration is its values and no other.
      `${printed(list, "state.status")} TS2322`,
      // A property that is not required may be missing.
      `${printed(list, "state.items[0].done")} TS2532`,
      // A row of a list of a definition is that definition.
      `${printed(list, "toFixed")} TS2551`,
      `${printed(list, "absent")} TS2339`,
      // A template reads the same State.
      `${printed(list, "txt")} TS2551`,
    ]);
  });

  test("name each definition in what the compiler says, as the document does", () => {
    const said = findings.map((finding) => finding.message).join("\n");
    expect(said).toContain("'Status'");
    expect(said).toContain("'TodoItem'");
    expect(said).toContain("has no exported member 'Nope'");
  });

  test("are what a component's props are held to in a document that uses it", () => {
    expect(about(findings, "site/pages/index.jxn")).toEqual([
      `${printed(page, 'status="nope"')} TS2322`,
    ]);
  });

  test("are what a module that imports the document can name", () => {
    expect(about(findings, "uses.ts")).toEqual([`${printed(uses, 'id: "x"')} TS2322`]);
  });
});

describe("a file that is not Jx Notation", () => {
  test(
    "is reported as the mapper's own error, at its position",
    () => {
      const made = project();
      const bad = lines("div {", "  state { count 0 }", "}", "p");
      made.write("src/bad.jxn", bad);
      made.write("src/fine.jxn", lines("div {", '  (fn)onclick "state.nope"', "}"));
      const { findings, status } = made.check("--runExternalCode");
      expect(findings).toEqual([
        {
          at: `src/bad.jxn${printed(bad, "p\n")}`,
          code: "jx1",
          message: "A document has one root element, and this is a second",
        },
      ]);
      expect(status).not.toBe(0);
    },
    SLOW,
  );
});

describe("running the mapper", () => {
  /** A mapper that says it was started, and does nothing a mapper should. */
  function other(made: Fixture): string {
    made.write(
      "node_modules/other-mapper/package.json",
      JSON.stringify({
        name: "other-mapper",
        typescript: { contentMapper: { exec: ["node", "server.js"] } },
        version: "1.0.0",
      }),
    );
    made.write(
      "node_modules/other-mapper/server.js",
      'require("node:fs").writeFileSync(require("node:path").join(__dirname, "started"), "");\n',
    );
    return join(made.root, "node_modules/other-mapper/started");
  }
  const declared = { mappers: [{ extensions: [".other"], package: "other-mapper" }] };

  test(
    "is refused without the flag, and no document is read",
    () => {
      const made = project(declared);
      const started = other(made);
      made.write("src/a.jxn", lines("div {", '  (fn)onclick "state.nope"', "}"));
      made.write("src/b.other", "x\n");
      const { findings, output, status } = made.check();
      expect(output).toContain("error TS18068");
      expect(about(findings, "a.jxn")).toEqual([]);
      expect(existsSync(started)).toBe(false);
      expect(status).not.toBe(0);
    },
    SLOW,
  );

  test(
    "starts every mapper the project declares that has a file to read, with one flag",
    () => {
      const made = project(declared);
      const started = other(made);
      made.write("src/a.jxn", lines("div {", '  (fn)onclick "state.nope"', "}"));
      made.write("src/b.other", "x\n");
      const { output } = made.check("--runExternalCode");
      // The flag is not given to one mapper: it lets the compiler run whatever the project names.
      expect(existsSync(started)).toBe(true);
      expect(output).toContain("other-mapper");
    },
    SLOW,
  );

  test(
    "does not start a declared mapper that has no file to read",
    () => {
      const made = project(declared);
      const started = other(made);
      const source = lines("div {", '  (fn)onclick "state.nope"', "}");
      made.write("src/a.jxn", source);
      const { findings } = made.check("--runExternalCode");
      expect(existsSync(started)).toBe(false);
      expect(about(findings, "a.jxn")).toEqual([`${printed(source, "nope")} TS2339`]);
    },
    SLOW,
  );
});
