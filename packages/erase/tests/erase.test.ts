/** Erasing TypeScript from function bodies (`spec.md` §23.1). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { EraseError, eraseBody, eraseClass, eraseDocument } from "../src/index.ts";
import * as browser from "../src/browser.ts";
import type { EraseWarning } from "../src/index.ts";
import type { JsonValue } from "@jxsuite/schema/types";

describe("eraseBody", () => {
  test.each([
    ["an assertion", "const input = event.target as HTMLInputElement; state.label = input.value"],
    ["a non-null assertion", "state.items!.push(1)"],
    ["an annotation", "let n: number = state.n;\nreturn n * 2"],
    [
      "an assertion before a newline and a bracket",
      "const x = state.a as number\n[1, 2].forEach(f)",
    ],
    ["a top-level return with await", "await state.ready;\nreturn state.n as number"],
    ["a type alias", "type Row = { id: number };\nconst row: Row = state.row;\nreturn row.id"],
  ])("%s becomes JavaScript of the same shape", (_label, text) => {
    const { code, problems } = eraseBody(text);
    expect(problems).toEqual([]);
    // Same length and the same lines, so a stack trace's line and column match the body.
    expect(code).toHaveLength(text.length);
    expect(code.split("\n")).toHaveLength(text.split("\n").length);
    expect(code).not.toContain(" as ");
    expect(eraseBody(code).code).toBe(code);
  });

  test("JavaScript comes back byte for byte", () => {
    const text = "state.count++; // tally\nif (!state.open) return;\nstate.items.push(`a ${1}`)";
    expect(eraseBody(text)).toEqual({ code: text, problems: [] });
  });

  test.each([
    ["enum", "enum Mode { A }\nreturn Mode.A", "`enum`", 1, 1],
    ["a value namespace", "state.n = 1;\nnamespace N { export const x = 1 }", "`namespace`", 2, 1],
    ["an import", 'const x = 1;\nimport y from "y"', "cannot import", 2, 1],
    ["an export", "export const x = 1", "cannot export", 1, 1],
  ])("%s is refused at its place", (_label, text, words, line, column) => {
    const [problem] = eraseBody(text).problems;
    expect(problem).toMatchObject({ column, kind: "unsupported", line });
    expect(problem?.message).toContain(words);
  });

  test("a dynamic import and an import in a string are not refused", () => {
    expect(eraseBody('const m = await import("./m.js");\nreturn "import x"').problems).toEqual([]);
  });

  test("text that was JavaScript and reads differently as TypeScript is said", () => {
    const { code, problems } = eraseBody("return a < b > (c)");
    expect(code).not.toBe("return a < b > (c)");
    expect(problems).toEqual([expect.objectContaining({ kind: "meaning", line: 1 })]);
  });

  test("the browser entry is the same function", () => {
    expect(browser.eraseBody).toBe(eraseBody);
  });
});

describe("eraseDocument", () => {
  const typed = {
    $elements: [{ $ref: "./x.json" }],
    state: {
      count: 0,
      data: { $prototype: "Request", body: "a as b", url: "/api" },
      increment: { $prototype: "Function", body: "state.count = (state.count as number) + 1" },
      steps: { $prototype: "Function", body: [{ op: "set" }] },
    },
    tagName: "main",
    children: [
      {
        onclick: { $prototype: "Function", body: "const e = event as MouseEvent; state.x = e.x" },
        tagName: "button",
      },
    ],
  } satisfies JsonValue;

  test("erases every Function body, and leaves any other body and the original alone", () => {
    const erased = eraseDocument(typed, "pages/index.json");
    expect(erased.state.increment.body).toBe("state.count = (state.count          ) + 1");
    expect(erased.children[0]?.onclick.body).not.toContain("as MouseEvent");
    // A Request's body is a payload, and a structured body has no text.
    expect(erased.state.data.body).toBe("a as b");
    expect(erased.state.steps.body).toEqual([{ op: "set" }]);
    expect(typed.state.increment.body).toContain("as number");
  });

  test("refuses a body that cannot be erased, naming the file, the pointer and the place", () => {
    const bad = { state: { f: { $prototype: "Function", body: "enum A { B }" } } };
    expect(() => eraseDocument(bad, "pages/a.json")).toThrow(
      "pages/a.json/state/f/body: `enum` is TypeScript",
    );
    try {
      eraseDocument(bad, "pages/a.json");
    } catch (error_) {
      expect(error_).toBeInstanceOf(EraseError);
      expect(error_ instanceof EraseError ? error_.site.pointer : "").toBe("/state/f/body");
    }
  });

  test("collects what changed meaning, without stopping", () => {
    const warnings: EraseWarning[] = [];
    eraseDocument(
      { state: { f: { $prototype: "Function", body: "return a < b > (c)" } } },
      "p.json",
      warnings,
    );
    expect(warnings).toEqual([
      expect.objectContaining({ path: "p.json", pointer: "/state/f/body" }),
    ]);
  });
});

describe("eraseClass", () => {
  test("erases a constructor, methods held as lines, and accessors", () => {
    const definition = {
      $defs: {
        constructor: { $prototype: "Function", body: ["const n: number = 1;", "this.n = n;"] },
        methods: {
          read: {
            $prototype: "Function",
            getter: { body: "return this.n as number" },
            setter: { body: "this.n = value as number" },
          },
        },
      },
    } satisfies JsonValue;
    const erased = eraseClass(definition, "x.class.json");
    expect(erased.$defs.constructor.body).toEqual(["const n         = 1;", "this.n = n;"]);
    // An assertion that ends a body leaves a semicolon, so a line after it cannot join it.
    expect(erased.$defs.methods.read.getter.body).toBe("return this.n;         ");
    expect(erased.$defs.methods.read.setter.body).toBe("this.n = value;         ");
  });

  test("erases a member a .class.json names by its role alone", () => {
    const definition = {
      $defs: {
        constructor: { body: "this.n = 1 as number;", role: "constructor" },
        fields: { n: { body: "data, not code", role: "field" } },
        methods: { read: { body: "return this.n as number;", role: "method" } },
      },
      $prototype: "Class",
    } satisfies JsonValue;
    const erased = eraseClass(definition, "x.class.json");
    expect(erased.$defs.constructor.body).toBe("this.n = 1          ;");
    expect(erased.$defs.methods.read.body).toBe("return this.n          ;");
    expect(erased.$defs.fields.n.body).toBe("data, not code");
  });

  test("an accessor with no body keeps its shape", () => {
    const erased = eraseClass({ m: { $prototype: "Function", getter: {} } }, "x.class.json");
    expect(erased).toEqual({ m: { $prototype: "Function", getter: {} } });
  });
});

describe("the repository", () => {
  test("every tracked body comes back byte for byte, and data bodies are left alone", () => {
    const root = resolve(import.meta.dir, "../../..");
    const files = execFileSync("git", ["ls-files", "*.json"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(
        (file) =>
          /(?:^|\/)(?:pages|components|layouts|stylebook|surfaces)\//u.test(file) ||
          file.endsWith(".class.json"),
      );
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const parsed: JsonValue = JSON.parse(readFileSync(resolve(root, file), "utf8"));
      expect([file, eraseDocument(parsed, file)]).toEqual([file, parsed]);
    }
  });
});
