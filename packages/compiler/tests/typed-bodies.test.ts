/**
 * Function bodies in TypeScript (`spec.md` §23.1): erased as a document is read, so every target
 * and every analysis sees JavaScript, and a body of more than one line emits correctly.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeProjectSchemas } from "../src/site/schema-command.ts";
import { validateProjectTree } from "../src/site/validate-command.ts";
import { compile } from "../src/compiler.ts";
import { compileElement } from "../src/targets/compile-element.ts";
import { rewriteState } from "../src/shared.ts";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** A page whose one handler has this body, and a binding over the list it may change. */
function page(body: string): JxDocument {
  return {
    children: [
      { onclick: { $prototype: "Function", body }, tagName: "button", textContent: "Add" },
      { tagName: "p", textContent: "${state.items.length}" },
    ],
    state: { items: { default: [1], type: "array" } },
    tagName: "main",
  };
}

/** A component with one state function of this body. */
function component(body: string): JxDocument {
  return {
    state: { count: 0, run: { $prototype: "Function", body } },
    tagName: "x-typed",
  };
}

/** Whether emitted module text parses as JavaScript. */
function parses(code: string): boolean {
  try {
    new Bun.Transpiler({ loader: "js" }).scan(code);
    return true;
  } catch {
    return false;
  }
}

describe("a typed body", () => {
  test("compiles exactly as its JavaScript twin, in the page and the element target", async () => {
    const typed = "const list = state.items as number[];\nlist!.push(2)";
    const twin = "const list = state.items            ;\nlist .push(2)";
    const [typedPage, twinPage] = await Promise.all([compile(page(typed)), compile(page(twin))]);
    expect(typedPage.html).toBe(twinPage.html);
    expect(typedPage.files.map((file) => file.content)).toEqual(
      twinPage.files.map((file) => file.content),
    );
    const [typedEl, twinEl] = await Promise.all([
      compileElement(component(typed)),
      compileElement(component(twin)),
    ]);
    expect(typedEl.files[0]?.content).toBe(twinEl.files[0]?.content);
    expect(typedEl.files[0]?.content).not.toContain("as number");
  });

  test("a typed mutation is seen, so prerender does not bake the value it changes", async () => {
    const [typed, plain] = await Promise.all([
      compile(page("state.items!.push(2)")),
      compile(page("state.items.push(2)")),
    ]);
    expect(typed.html).toBe(plain.html);
  });

  test("JavaScript that reads differently as TypeScript is said once, and built as TypeScript", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await compile(page("state.r = a < b > (c)"));
      await compile(page("state.r = a < b > (c)"));
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(said.filter((line) => line.includes("reading it as TypeScript"))).toHaveLength(1);
      expect(said[0]).toContain("/children/0/onclick/body (line 1, column");
    } finally {
      warn.mockRestore();
    }
  });

  test("TypeScript that cannot be erased stops the build, naming the body", async () => {
    let refusal = "";
    try {
      await compile(page("enum A { B }"));
    } catch (error_) {
      refusal = String(error_);
    }
    expect(refusal).toContain("/children/0/onclick/body");
    expect(refusal).toContain("`enum`");
  });
});

describe("a body of more than one line", () => {
  test("a last-line comment does not swallow the brace, in either target", async () => {
    const body = "state.items.push(2) // done";
    const built = await compile(page(body));
    for (const file of built.files) {
      expect([file.path, parses(file.content)]).toEqual([file.path, true]);
    }
    const element = await compileElement({
      children: [{ onclick: { $prototype: "Function", body }, tagName: "b" }],
      state: { items: [] },
      tagName: "x-commented",
    });
    expect(parses(element.files[0]?.content ?? "")).toBe(true);
  });

  test("a comment that says return does not make a handler a computed", async () => {
    const element = await compileElement(component("// return early when closed\nstate.count++"));
    expect(element.files[0]?.content).not.toContain("computed(() => {");
  });

  test("only a standalone state is rewritten", async () => {
    const element = await compileElement(
      component('const prevstate = { n: 1 };\nreturn prevstate.n + state.count + "state.x".length'),
    );
    const content = element.files[0]?.content ?? "";
    expect(content).toContain("prevstate.n + this.state.count");
    expect(content).not.toContain("prevthis.state");
    // A string that mentions state is left as written.
    expect(content).toContain('"state.x"');
  });
});

describe("rewriteState", () => {
  test("moves state and state.member, and leaves what only looks like them", () => {
    expect(rewriteState("state.a + this.state.b + prevstate.c", "s")).toBe(
      "s.a + this.state.b + prevstate.c",
    );
    expect(rewriteState("f(state); state.a", "s", { bare: true })).toBe("f(s); s.a");
    expect(rewriteState("'state.a' + state.b", "s")).toBe("'state.a' + s.b");
    // An attribute's template is not code, so what reads as a string there is still rewritten.
    expect(rewriteState("'${state.a}'", "s", { code: false })).toBe("'${s.a}'");
  });

  test("reads a member across whitespace, and never a longer name that starts with state", () => {
    expect(rewriteState("state\n  .a + state (b)", "s")).toBe("s\n  .a + state (b)");
    expect(rewriteState("stateful + state$ + states.a + state", "s", { bare: true })).toBe(
      "stateful + state$ + states.a + s",
    );
  });
});

describe("jx validate", () => {
  const root = mkdtempSync(join(import.meta.dir, ".typed-bodies-"));
  const write = (path: string, value: JsonValue): void => {
    const absolute = resolve(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, JSON.stringify(value));
  };
  const fn = (body: string) => ({ $prototype: "Function", body });

  beforeAll(async () => {
    write("project.json", { name: "Typed" });
    write("pages/index.json", {
      state: { go: fn("state.n = (state.n as number) + 1") },
      tagName: "main",
    });
    await writeProjectSchemas(root);
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  test("a typed body passes", async () => {
    const result = await validateProjectTree(root);
    expect(result.valid).toBe(true);
    expect(result.lint).toEqual([]);
  });

  test("a body that cannot be erased is an issue, in a page and in a class", async () => {
    write("pages/enum.json", { state: { go: fn("enum A { B }") }, tagName: "main" });
    write("components/x.class.json", {
      $defs: { methods: { run: { ...fn("namespace N { export const a = 1 }"), role: "method" } } },
      title: "X",
    });
    try {
      const result = await validateProjectTree(root);
      expect(result.valid).toBe(false);
      const files = result.issues.map((issue) => issue.file);
      expect(files).toContain("pages/enum.json");
      expect(files).toContain("components/x.class.json");
      expect(JSON.stringify(result.issues)).toContain("/state/go/body: `enum`");
    } finally {
      rmSync(resolve(root, "pages/enum.json"));
      rmSync(resolve(root, "components/x.class.json"));
    }
  });

  test("a body whose meaning TypeScript changes warns, with where, and does not fail", async () => {
    write("pages/generic.json", { state: { go: fn("state.r = a < b > (c)") }, tagName: "main" });
    try {
      const result = await validateProjectTree(root);
      expect(result.valid).toBe(true);
      expect(result.lint).toEqual([
        expect.objectContaining({
          file: "pages/generic.json",
          path: ["state", "go", "body"],
          source: "function-body",
        }),
      ]);
    } finally {
      rmSync(resolve(root, "pages/generic.json"));
    }
  });
});
