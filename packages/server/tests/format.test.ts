/** `jx format`: the code a `.jxn` file holds, the file around it, and what the command reports. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatFiles, formatJxn, parseFormatArgs, runFormat } from "../src/format.ts";

/** A document with code in every place a document keeps it, laid out as its author left it. */
const PAGE = `/- kdl-version 2
div {
  state {
    count 0
    save $prototype=Request url="/x" method=POST body="a = 1"
    label "\${state.count}  items"
    (fn)bump "state.count++"
    (fn)blank "  "
    (fn)add a b "return a+b"
  }
  button Go {
    (fn)onclick "state.count=state.count+1"
  }
  $array tagName=ul items=(ref)"#/state/list" {
    li {
      (fn)onclick "if(a){b()}"
    }
  }
}
$script {
  client "export const a=1"
  server "export async function load(){return 1}"
}
`;

/** What formatting {@link PAGE} gives: the writer's one layout, and each piece of code formatted. */
const PAGE_FORMATTED = `/- kdl-version 2

div {
    script "export const a = 1;"
    script timing=server #"""
        export async function load() {
          return 1;
        }
        """#
    state {
        count 0
        save $prototype=Request url="/x" method=POST body="a = 1"
        label "\${state.count}  items"
        (fn)bump "state.count++;"
        (fn)blank "  "
        (fn)add a b "return a + b;"
    }
    button Go {
        (fn)onclick "state.count = state.count + 1;"
    }
    $array tagName=ul items=(ref)"#/state/list" {
        li {
            (fn)onclick #"""
                if (a) {
                  b();
                }
                """#
        }
    }
}
`;

describe("formatJxn", () => {
  test("formats every function body and both scripts, and nothing that is not code", async () => {
    const { problems, text } = await formatJxn(PAGE);
    expect(problems).toEqual([]);
    expect(text).toBe(PAGE_FORMATTED);
  });

  test("formatting what it formatted changes nothing", async () => {
    const again = await formatJxn(PAGE_FORMATTED);
    expect(again.text).toBe(PAGE_FORMATTED);
  });

  test("a file with a comment keeps it, and every node the formatter did not change", async () => {
    const commented = `/- kdl-version 2
div {
  state {
    // How many times.
    count   0
    (fn)bump "state.count++"
  }
  /-p "Not yet"
}
`;
    const { text } = await formatJxn(commented);
    expect(text).toBe(`/- kdl-version 2
div {
  state {
    // How many times.
    count   0
    (fn)bump "state.count++;"
  }
  /-p "Not yet"
}
`);
  });

  test("a commented file whose code is already formatted is the same file", async () => {
    const commented = `/- kdl-version 2
div {
  // Odd spacing, kept.
  p   Hello
}
`;
    const again = await formatJxn(commented);
    expect(again.text).toBe(commented);
  });

  test("code that does not parse is left as written and named, and the rest is formatted", async () => {
    const { problems, text } = await formatJxn(`/- kdl-version 2
div {
    state {
        (fn)broken "if ("
        (fn)fine "a=1"
        "a/b" 1
    }
}
$script {
    client "export const = 2"
}
`);
    expect(problems).toEqual([
      { message: "Unexpected token (line 1)", pointer: "/$script/client" },
      { message: "Unexpected token (line 1)", pointer: "/state/broken/body" },
    ]);
    expect(text).toContain('(fn)broken "if ("');
    expect(text).toContain('(fn)fine "a = 1;"');
    expect(text).toContain('script "export const = 2"');
  });

  test("a project file's functions are formatted, and the file stays a project file", async () => {
    const { problems, text } = await formatJxn(`/- kdl-version 2
project x

state {
    (fn)twice n "return n*2"
}
`);
    expect(problems).toEqual([]);
    expect(text).toBe(`/- kdl-version 2
project x

state {
    (fn)twice n "return n * 2;"
}
`);
  });

  test("a project file with a comment keeps it", async () => {
    const { text } = await formatJxn(`/- kdl-version 2
project x

// What every page reads.
state {
  (fn)twice n "return n*2"
}
`);
    expect(text).toContain("// What every page reads.");
    expect(text).toContain('(fn)twice n "return n * 2;"');
  });

  test("a file that is not Jx Notation says where it stops being one", async () => {
    let said = "";
    try {
      await formatJxn("/- kdl-version 2\ndiv {\n");
    } catch (error) {
      said = String(error);
    }
    expect(said).toContain("line 3");
  });
});

describe("parseFormatArgs", () => {
  test("with no path, the project is what is formatted", () => {
    expect(parseFormatArgs([])).toEqual({ check: false, paths: ["."], root: process.cwd() });
  });

  test("reads the paths, --check and --root", () => {
    expect(parseFormatArgs(["pages", "--check", "--root", "/srv/site", "project.jxn"])).toEqual({
      check: true,
      paths: ["pages", "project.jxn"],
      root: "/srv/site",
    });
  });

  test("--root with nothing after it is where the command was run", () => {
    expect(parseFormatArgs(["--root"])?.root).toBe(process.cwd());
  });

  test("an option there is not is no request at all", () => {
    expect(parseFormatArgs(["--write"])).toBeNull();
    expect(parseFormatArgs(["-c"])).toBeNull();
  });
});

describe("jx format, in a project", () => {
  let root = "";

  /** Write a file under the project, with the folders it needs. */
  function put(name: string, text: string): void {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }

  /** A file under the project. */
  function read(name: string): string {
    return readFileSync(join(root, name), "utf8");
  }

  /** Run the command there, and collect what it prints. */
  async function run(...argv: string[]) {
    const lines: string[] = [];
    const code = await runFormat(["--root", root, ...argv], (line) => lines.push(line));
    return { code, lines };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "jx-format-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  test("formats every .jxn file under the project, and says which it changed", async () => {
    put("pages/index.jxn", PAGE);
    put("pages/done.jxn", PAGE_FORMATTED);
    put("project.jxn", "/- kdl-version 2\nproject x\n");
    const { code, lines } = await run();
    expect(lines).toEqual(["pages/index.jxn formatted", "1 file(s) formatted, 2 left as written"]);
    expect(code).toBe(0);
    expect(read("pages/index.jxn")).toBe(PAGE_FORMATTED);
  });

  test("leaves what an author did not write: dependencies, the build, and dot-folders", async () => {
    put("node_modules/pkg/a.jxn", PAGE);
    put("dist/a.jxn", PAGE);
    put(".cache/a.jxn", PAGE);
    put("pages/notes.md", "# Notes\n");
    const { code, lines } = await run();
    expect(lines).toEqual(["0 file(s) formatted, 0 left as written"]);
    expect(code).toBe(0);
    expect(read("dist/a.jxn")).toBe(PAGE);
  });

  test("--check writes nothing, names what would change, and fails", async () => {
    put("pages/index.jxn", PAGE);
    const { code, lines } = await run("--check", "pages");
    expect(lines).toEqual([
      "pages/index.jxn would be formatted",
      "1 file(s) would be formatted, 0 left as written",
    ]);
    expect(code).toBe(1);
    expect(read("pages/index.jxn")).toBe(PAGE);
  });

  test("--check passes a project that is formatted", async () => {
    put("pages/index.jxn", PAGE_FORMATTED);
    const { code } = await run("--check");
    expect(code).toBe(0);
  });

  test("a file named twice is formatted once", async () => {
    put("pages/index.jxn", PAGE);
    const rows = await formatFiles(root, ["pages", "pages/index.jxn"], false);
    expect(rows).toEqual([{ changed: true, path: "pages/index.jxn", problems: [] }]);
  });

  test("code that does not parse fails the run, names where, and formats the rest", async () => {
    put("pages/index.jxn", '/- kdl-version 2\n\ndiv {\n    (fn)onclick "if ("\n    p Hi\n}\n');
    put("pages/other.jxn", PAGE);
    const { code, lines } = await run();
    expect(lines).toEqual([
      "pages/index.jxn#/onclick/body: Unexpected token (line 1)",
      "pages/other.jxn formatted",
      "1 file(s) formatted, 1 left as written",
    ]);
    expect(code).toBe(1);
  });

  test("a file that cannot be read is named with why, and is not written", async () => {
    put("pages/index.jxn", "/- kdl-version 2\ndiv {\n");
    const { code, lines } = await run();
    expect(lines[0]).toStartWith("pages/index.jxn: ");
    expect(lines[0]).toContain("line 3");
    expect(code).toBe(1);
    expect(read("pages/index.jxn")).toBe("/- kdl-version 2\ndiv {\n");
  });

  test("a path that is not there, and one that is not a .jxn file, are each said", async () => {
    put("pages/about.json", "{}\n");
    const { code, lines } = await run("pages/gone.jxn", "pages/about.json");
    expect(lines).toEqual([
      "pages/about.json: only a .jxn file holds code this can reach",
      "pages/gone.jxn: there is no such file",
      "0 file(s) formatted, 2 left as written",
    ]);
    expect(code).toBe(1);
  });

  test("an option there is not prints the usage and exits 2", async () => {
    const { code, lines } = await run("--fix");
    expect(lines).toEqual(["Usage: jx format [paths…] [--check]"]);
    expect(code).toBe(2);
  });
});
