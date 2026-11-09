/**
 * The runtime's seam for TypeScript function bodies (`spec.md` §23.1): every body compiles through
 * one `compileBody`, erased by what the host installs, and a page loads the eraser only when a body
 * needs it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { eraseBody } from "@jxsuite/erase/browser";
import { isRef } from "@vue/reactivity";
import { bodyNeedsEraser, compileBody, prepareBodies } from "../src/body-eraser.ts";
import {
  Jx,
  resolve,
  resolvePrototype,
  setBodyEraser,
  setBodyEraserLoader,
} from "../src/runtime.ts";
import type { JxScope } from "../src/types.ts";

/** A compiled body, called the way a state function is. */
type StateFn = (s: JxScope) => number;

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

afterEach(() => {
  setBodyEraser(null);
  setBodyEraserLoader(null);
});

const TYPED = "const n: number = state.n as number; return n + 1;";

describe("compileBody", () => {
  test("compiles JavaScript as written when no eraser is installed", () => {
    // SAFETY: the body reads `state.n` and returns a number.
    const fn = compileBody(["state"], "return state.n + 1;", "'next'") as StateFn;
    expect(fn({ n: 1 })).toBe(2);
  });

  test("names the body and the fix when TypeScript arrives with no eraser", () => {
    expect(() => compileBody(["state"], TYPED, "'next'")).toThrow(
      /'next' does not compile as JavaScript .*setBodyEraser\(eraseBody\)/u,
    );
  });

  test("erases through the installed eraser, once per text", () => {
    let calls = 0;
    setBodyEraser((text) => {
      calls += 1;
      return eraseBody(text);
    });
    // SAFETY: the body reads `state.n` and returns a number.
    const fn = compileBody(["state"], TYPED, "'next'") as StateFn;
    compileBody(["state"], TYPED, "'next'");
    expect(fn({ n: 4 })).toBe(5);
    expect(calls).toBe(1);
  });

  test("refuses what cannot be erased, naming the body", () => {
    setBodyEraser(eraseBody);
    expect(() => compileBody([], "enum E { A }", "'e'")).toThrow(/'e' cannot run: `enum`/u);
  });

  test("a SyntaxError with an eraser installed is the engine's own", () => {
    setBodyEraser(eraseBody);
    expect(() => compileBody([], "return )", "'bad'")).toThrow(SyntaxError);
  });
});

describe("bodyNeedsEraser", () => {
  test("JavaScript does not; TypeScript and a generic call do", () => {
    expect(bodyNeedsEraser("return state.n + 1;")).toBe(false);
    expect(bodyNeedsEraser("await state.load();")).toBe(false);
    expect(bodyNeedsEraser(TYPED)).toBe(true);
    expect(bodyNeedsEraser("return pick<Item>(state.items);")).toBe(true);
  });
});

describe("the loader", () => {
  test("is not called for a document with no typed body", async () => {
    let loads = 0;
    setBodyEraserLoader(() => {
      loads += 1;
      return Promise.resolve({ eraseBody });
    });
    await prepareBodies({
      state: {
        data: { body: "not code at all" },
        next: { $prototype: "Function", body: "return 1;" },
      },
    });
    expect(loads).toBe(0);
  });

  test("is called once, and installs what it gives, for a typed body", async () => {
    let loads = 0;
    setBodyEraserLoader(() => {
      loads += 1;
      return Promise.resolve({ eraseBody });
    });
    const doc = { state: { next: { $prototype: "Function", body: TYPED } } };
    await Promise.all([prepareBodies(doc), prepareBodies(doc)]);
    await prepareBodies(doc);
    expect(loads).toBe(1);
    // SAFETY: the body reads `state.n` and returns a number.
    const fn = compileBody(["state"], TYPED, "'next'") as StateFn;
    expect(fn({ n: 1 })).toBe(2);
  });

  test("finds class members, accessor halves and bodies held as lines", async () => {
    const found: string[] = [];
    setBodyEraserLoader(() => Promise.resolve({ eraseBody }));
    for (const definition of [
      {
        $defs: { methods: { m: { body: ["const x: number = 1;", "return x;"], role: "method" } } },
      },
      { m: { $prototype: "Function", getter: { body: "return this.n as number;" } } },
      { m: { $prototype: "Function", setter: { body: "this.n = v as number;" } } },
      { children: [{ state: { f: { $prototype: "Function", body: TYPED } } }] },
      { m: { $prototype: "Function", body: { if: true } } },
    ]) {
      setBodyEraser(null);
      // oxlint-disable-next-line no-await-in-loop -- each definition is checked from a clean state
      await prepareBodies(definition);
      found.push(String(compileBodyWorks()));
    }
    expect(found).toEqual(["true", "true", "true", "true", "false"]);
  });

  test("a loader replaced while loading does not install the old eraser", async () => {
    let release = (): void => {};
    setBodyEraserLoader(
      () =>
        new Promise((done) => {
          release = () => {
            done({ eraseBody });
          };
        }),
    );
    const pending = prepareBodies({ s: { $prototype: "Function", body: TYPED } });
    setBodyEraserLoader(null);
    release();
    await pending;
    expect(compileBodyWorks()).toBe(false);
  });
});

/** Whether an eraser is installed now, judged by whether a typed body compiles. */
function compileBodyWorks(): boolean {
  try {
    compileBody([], "const x: number = 1;", "'probe'");
    return true;
  } catch {
    return false;
  }
}

describe("a typed page", () => {
  test("runs its typed state function and handler once the loader has run", async () => {
    setBodyEraserLoader(() => Promise.resolve({ eraseBody }));
    const host = document.createElement("div");
    document.body.append(host);
    const scope = await Jx(
      {
        onclick: {
          $prototype: "Function",
          body: "const input = event.target as HTMLElement; state.label = input.tagName;",
          parameters: ["state", "event"],
        },
        state: {
          double: { $prototype: "Function", body: "return (state.n as number) * 2;" },
          label: "",
          n: 3,
        },
        tagName: "button",
        textContent: "${state.label}",
      },
      host,
    );
    // A body that returns a value is a computed (`spec.md` §5.3), read as its value.
    expect(scope["double"]).toBe(6);
    host.querySelector("button")?.click();
    expect(scope["label"]).toBe("BUTTON");
    host.remove();
  });

  test("a fetched document has its eraser before it resolves", async () => {
    setBodyEraserLoader(() => Promise.resolve({ eraseBody }));
    const doc = { state: { f: { $prototype: "Function", body: TYPED } }, tagName: "div" };
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(doc));
    await resolve("https://example.com/typed-page.json");
    fetchSpy.mockRestore();
    expect(compileBodyWorks()).toBe(true);
  });

  test("a fetched class with typed members constructs and runs", async () => {
    setBodyEraserLoader(() => Promise.resolve({ eraseBody }));
    const classDef = {
      $defs: {
        constructor: { body: "this.n = (config.n as number) ?? 0;", role: "constructor" },
        methods: {
          resolve: {
            body: "return (this.n as number) + 1;",
            identifier: "resolve",
            role: "method",
          },
        },
      },
      $prototype: "Class",
      title: "Counter",
    };
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(classDef));
    const value = await resolvePrototype(
      { $prototype: "Counter", $src: "https://example.com/Counter.class.json", n: 4 },
      {},
      "counter",
    );
    fetchSpy.mockRestore();
    expect(isRef(value) ? value.value : value).toBe(5);
  });
});

describe("the core bundle", () => {
  test("carries the seam and not the compiler", async () => {
    const result = await Bun.build({
      entrypoints: [new URL("../src/runtime.ts", import.meta.url).pathname],
      target: "browser",
    });
    const code = await result.outputs[0]!.text();
    expect(code).toContain("setBodyEraserLoader");
    expect(code).not.toContain("createSourceFile");
    expect(code).not.toContain("ts-blank-space");
  });
});
