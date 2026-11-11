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
    "    (server)user id=1",
    '    (fn)go "helper();"',
    "  }",
    "  button {",
    "    state { local 1 }",
    '    (fn)onclick "state.local += state.double; state.user?.name.toFixed(); state.hello(1)"',
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
    '    state { label "x" }',
    '    $array items=(ref)"#/state/todos" {',
    "      li {",
    '        (fn)onclick "state.$map.item.done = !state.$map.item.done; state.$map.item.gone; state.$map.index.toFixed(); state.label.toFixed()"',
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
