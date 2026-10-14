import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { reactive, ref, computed, effect, isRef } from "@vue/reactivity";
import {
  resolve,
  buildScope,
  renderNode as _renderNode,
  applyStyle,
  resolveRef,
  resolvePrototype,
  isSignal,
  camelToKebab,
  toCSSText,
  RESERVED_KEYS,
  Jx,
  setSkipServerFunctions,
  pureSchemeOf,
  schemeSelectors,
  COLOR_SCHEME_ATTR,
  COLOR_SCHEME_STORAGE_KEY,
  booleanAttrValue,
  enumeratedAttrNames,
  isDeclarationAtRule,
  isKeyframesAtRule,
  isSingleExpression,
  releaseElementStyles,
  resetDocumentStyles,
} from "../src/runtime";
import { evaluateExpression, isMutating } from "../src/expression";
import { BASE } from "./base-url.ts";
import { adoptedCSS, elementCSS } from "./style-text.ts";
import { isFunction } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope, JxScopeValue } from "../src/types";

/** What a test hands a compiled scope function: the scope itself, an event stand-in, or data. */
type ScopeArgument = JxScope | JsonValue;

/** A function `buildScope` compiled from a `Function` or `$expression` state entry. */
type ScopeFunction = (...args: ScopeArgument[]) => JsonValue | undefined;

/** A `Function` entry with a structured body AND parameters, which runs its statements async. */
type StatementsFunction = (...args: ScopeArgument[]) => Promise<void>;

/** Read a scope member that must be callable, failing the test when it is not. */
function scopeCallable(scope: JxScope, key: string): (...args: never[]) => void {
  const member = scope[key];
  if (!isFunction(member)) {
    throw new TypeError(`scope.${key} is not a function`);
  }
  return member;
}

/** Read a scope member as a callable — tests poke the dynamic scope directly. */
function fnOf(scope: JxScope, key: string): ScopeFunction {
  /* SAFETY: buildScope builds every callable entry from document code (`new Function`, an
     `$expression` closure or a parameterless statements handler), so it accepts any arguments,
     and each entry these tests call through here returns JSON data or nothing. */
  return scopeCallable(scope, key) as ScopeFunction;
}

/** Read a parameterized structured-body entry, which buildScope wraps around `runStatements`. */
function statementsFnOf(scope: JxScope, key: string): StatementsFunction {
  /* SAFETY: buildScope maps a structured body with parameters to
     `(...argValues) => runStatements(...)`, and runStatements is async and resolves to nothing. */
  return scopeCallable(scope, key) as StatementsFunction;
}

/** Read a scope member as an array. */
function arrOf(scope: JxScope, key: string): JxScopeValue[] {
  const member = scope[key];
  if (!Array.isArray(member)) {
    throw new TypeError(`scope.${key} is not an array`);
  }
  return member;
}

/** Fail the test unless `value` is an instance of `ctor`, narrowing it for the assertions after. */
function assertInstance<T>(
  value: unknown,
  ctor: abstract new (...args: never[]) => T,
): asserts value is T {
  if (!(value instanceof ctor)) {
    throw new Error(`expected an instance of ${ctor.name}`);
  }
}

/** Install `respond` as `fetch`, keeping Bun's `preconnect` so the stub is a whole `fetch`. */
function stubFetch(respond: (url: string, init: RequestInit | undefined) => Response) {
  const { preconnect } = fetch;
  const handler = mock((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(respond(String(input), init)),
  );
  globalThis.fetch = Object.assign(handler, { preconnect });
  return handler;
}

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** Render an element definition, failing the test if a Text node or a non-HTML element comes back. */
function renderNode(...args: Parameters<typeof _renderNode>): HTMLElement {
  const node = _renderNode(...args);
  if (!(node instanceof HTMLElement)) {
    throw new Error("renderNode did not return an HTML element");
  }
  return node;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const wait = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

// ─── isSignal ─────────────────────────────────────────────────────────────────

describe("isSignal", () => {
  test("true for ref", () => expect(isSignal(ref(0))).toBe(true));
  test("true for computed", () => expect(isSignal(computed(() => 1))).toBe(true));
  test("false for plain value", () => expect(isSignal(42)).toBe(false));
  test("false for null", () => expect(isSignal(null)).toBe(false));
  test("false for object", () => expect(isSignal({})).toBe(false));
});

// ─── camelToKebab ─────────────────────────────────────────────────────────────

describe("camelToKebab", () => {
  test("single word unchanged", () => expect(camelToKebab("color")).toBe("color"));
  test("converts camelCase", () =>
    expect(camelToKebab("backgroundColor")).toBe("background-color"));
  test("multiple humps", () => expect(camelToKebab("marginTopLeft")).toBe("margin-top-left"));
  test("already kebab", () => expect(camelToKebab("font-size")).toBe("font-size"));
});

// ─── toCSSText ────────────────────────────────────────────────────────────────

describe("toCSSText", () => {
  test("converts properties to CSS text", () => {
    expect(toCSSText({ backgroundColor: "red", fontSize: "16px" })).toBe(
      "background-color: red; font-size: 16px",
    );
  });
  test("skips nested selectors", () => {
    expect(toCSSText({ ".child": {}, ":hover": { color: "red" }, color: "blue" })).toBe(
      "color: blue",
    );
  });
  test("empty object", () => expect(toCSSText({})).toBe(""));
});

// ─── isSingleExpression ─────────────────────────────────────────────────────

describe("isSingleExpression", () => {
  test("a bare ${expr} with nothing before or after is one expression", () => {
    expect(isSingleExpression("${state.count}")).toBe(true);
  });
  test("text before or after the expression disqualifies it", () => {
    expect(isSingleExpression("count: ${state.count}")).toBe(false);
    expect(isSingleExpression("${state.count} items")).toBe(false);
  });
  test("two adjacent expressions are not one, even with nothing between them", () => {
    // The outer braces close at the midpoint, well short of the string's end.
    expect(isSingleExpression("${state.a}${state.b}")).toBe(false);
  });
  test("braces that never return to depth zero are not a single expression either", () => {
    // A malformed/hand-edited document can carry this; it must fail closed, not throw.
    expect(isSingleExpression("${`${a}")).toBe(false);
  });
});

// ─── RESERVED_KEYS ────────────────────────────────────────────────────────────

describe("RESERVED_KEYS", () => {
  test("is a Set", () => expect(RESERVED_KEYS).toBeInstanceOf(Set));

  const required = [
    "$schema",
    "$id",
    "state",
    "$ref",
    "$props",
    "$switch",
    "$prototype",
    "$media",
    "$map",
    "$src",
    "$export",
    "timing",
    "default",
    "tagName",
    "children",
    "style",
    "attributes",
    "items",
    "map",
    "filter",
    "sort",
    "cases",
    "body",
    "parameters",
    "arguments",
    "name",
  ];
  for (const k of required) {
    test(`contains "${k}"`, () => expect(RESERVED_KEYS.has(k)).toBe(true));
  }

  const removed = ["$handlers", "$handler", "$compute", "$deps", "signal"];
  for (const k of removed) {
    test(`does NOT contain "${k}"`, () => expect(RESERVED_KEYS.has(k)).toBe(false));
  }
});

// ─── resolveRef ───────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  const state = reactive({
    count: 5,
    name: "Alice",
  });
  // Simulate a child scope with $map
  const child = Object.create(state);
  child.$map = { index: 3, item: { nested: { deep: 42 }, text: "hello" } };
  child["$map/item"] = child.$map.item;
  child["$map/index"] = child.$map.index;

  test("non-string returns as-is", () => {
    const doc: JsonObject = { $ref: 42 };
    /* SAFETY: deliberately unsound. A `$ref` read from unvalidated document JSON can be a number,
       and resolveRef hands any non-string back untouched, which is what this test pins. */
    expect(resolveRef(doc.$ref as string, state)).toBe(42);
  });
  test("#/state/ prefix resolves from scope", () => {
    expect(resolveRef("#/state/count", state)).toBe(5);
  });
  test("parent#/ prefix resolves from scope", () => {
    expect(resolveRef("parent#/name", state)).toBe("Alice");
  });
  test("window#/ resolves global window property", () => {
    Object.assign(window, { _testProp: "win" });
    expect(resolveRef("window#/_testProp", state)).toBe("win");
    Reflect.deleteProperty(window, "_testProp");
  });
  test("document#/ resolves global document property", () => {
    Object.assign(document, { _testProp: "doc" });
    expect(resolveRef("document#/_testProp", state)).toBe("doc");
    Reflect.deleteProperty(document, "_testProp");
  });
  test("$map/item resolves map item", () => {
    expect(resolveRef("$map/item", child)).toEqual({
      nested: { deep: 42 },
      text: "hello",
    });
  });
  test("$map/index resolves map index", () => {
    expect(resolveRef("$map/index", child)).toBe(3);
  });
  test("$map/item/text resolves nested path", () => {
    expect(resolveRef("$map/item/text", child)).toBe("hello");
  });
  test("$map/item/nested/deep resolves deep nested path", () => {
    expect(resolveRef("$map/item/nested/deep", child)).toBe(42);
  });
  test("unknown ref returns null", () => {
    expect(resolveRef("nonexistent", state)).toBeNull();
  });
  test("bare key resolves from scope", () => {
    expect(resolveRef("name", state)).toBe("Alice");
  });
});

// ─── resolve ──────────────────────────────────────────────────────────────────

describe("resolve", () => {
  test("returns object as-is (no fetch)", async () => {
    const obj = { tagName: "div" };
    expect(await resolve(obj)).toBe(obj);
  });

  test("fetches string URL and parses JSON", async () => {
    const payload = { tagName: "span" };
    stubFetch(() => Response.json(payload));
    const result = await resolve("http://example.com/comp.json");
    expect(result).toEqual(payload);
  });

  test("throws on non-ok response", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    // oxlint-disable-next-line typescript/await-thenable -- bun-types types `.rejects.toThrow()` as void, but it returns a Promise at runtime that must be awaited
    await expect(resolve("http://example.com/missing.json")).rejects.toThrow("404");
  });

  test("a 200 carrying HTML is a MISSING file, and says so", async () => {
    /* A static host with a single-page fallback answers a path it does not have with the app shell
       at HTTP 200, so `res.ok` is true and the failure surfaces from `res.json()` as
       `Unexpected token '<'` — a parser error for what is really a 404. Jx Cloud did this to every
       component $ref in the Studio canvas. The message has to name the cause, because the parser's
       does not. */
    stubFetch(
      () =>
        new Response("<!doctype html><html></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    // oxlint-disable-next-line typescript/await-thenable -- see above
    await expect(resolve("http://example.com/spa-fallback.json")).rejects.toThrow(
      "returned HTML, not a document",
    );
  });

  test("a response with no headers at all is still parsed — no evidence, no guess", async () => {
    // The check is evidence-based. A custom fetch that omits headers must not be broken by it.
    const payload = { tagName: "b" };
    // A real Response whose `headers` reads as absent, as a host's `fetch` stand-in may answer.
    stubFetch(() => Object.defineProperty(Response.json(payload), "headers", { value: undefined }));
    expect(await resolve("http://example.com/headerless.json")).toEqual(payload);
  });
});

// ─── buildScope — Five-Shape state Grammar ───────────────────────────────────

describe("buildScope", () => {
  test("returns empty scope for empty doc", async () => {
    const state = await buildScope({}, {}, BASE);
    expect(Object.keys(state).length).toBe(0);
  });

  // Shape 1: Naked values → reactive property
  test("Shape 1: string → reactive property", async () => {
    const state = await buildScope({ state: { name: "hello" } }, {}, BASE);
    expect(state.name).toBe("hello");
  });

  test("Shape 1: number → reactive property", async () => {
    const state = await buildScope({ state: { count: 42 } }, {}, BASE);
    expect(state.count).toBe(42);
  });

  test("Shape 1: boolean → reactive property", async () => {
    const state = await buildScope({ state: { flag: false } }, {}, BASE);
    expect(state.flag).toBe(false);
  });

  test("Shape 1: null → reactive property", async () => {
    const state = await buildScope({ state: { x: null } }, {}, BASE);
    expect(state.x).toBeNull();
  });

  test("Shape 1: array → reactive property", async () => {
    const state = await buildScope({ state: { items: [1, 2, 3] } }, {}, BASE);
    expect(state.items).toEqual([1, 2, 3]);
  });

  test("Shape 1: plain object → reactive property", async () => {
    const state = await buildScope({ state: { cfg: { x: 1, y: 2 } } }, {}, BASE);
    expect(state.cfg).toEqual({ x: 1, y: 2 });
  });

  // Reactivity test
  test("Shape 1: reactive property tracks mutations", async () => {
    const state = await buildScope({ state: { count: 0 } }, {}, BASE);
    let observed: unknown;
    effect(() => {
      observed = state.count;
    });
    expect(observed).toBe(0);
    state.count = 42;
    await wait();
    expect(observed).toBe(42);
  });

  test("Shape 1: array reactive property tracks push", async () => {
    const state = await buildScope({ state: { items: [1, 2] } }, {}, BASE);
    let length: unknown;
    effect(() => {
      ({ length } = arrOf(state, "items"));
    });
    expect(length).toBe(2);
    arrOf(state, "items").push(3);
    await wait();
    expect(length).toBe(3);
  });

  // Shape 2: Expanded signal with default
  test("Shape 2: object with default → reactive property initialized to default", async () => {
    const state = await buildScope({ state: { count: { default: 7, type: "integer" } } }, {}, BASE);
    expect(state.count).toBe(7);
  });

  // Shape 2b: Pure type definition
  test("Shape 2b: object with only schema keywords → skipped", async () => {
    const state = await buildScope(
      { state: { email: { format: "email", type: "string" } } },
      {},
      BASE,
    );
    expect(state.email).toBeUndefined();
  });

  // Shape 3: Template string → computed
  test("Shape 3: string with ${} → computed", async () => {
    const state = await buildScope(
      {
        state: {
          count: 5,
          label: "${state.count} items",
        },
      },
      {},
      BASE,
    );
    expect(state.label).toBe("5 items");
  });

  test("Shape 3: computed updates when dependency changes", async () => {
    const state = await buildScope(
      {
        state: {
          count: 5,
          label: "${state.count} items",
        },
      },
      {},
      BASE,
    );
    expect(state.label).toBe("5 items");
    state.count = 10;
    expect(state.label).toBe("10 items");
  });

  // Shape 4: $prototype: "Function" with body
  test("Shape 4: Function with body → callable function", async () => {
    const state = await buildScope(
      {
        state: {
          count: 0,
          increment: { $prototype: "Function", body: "state.count++" },
        },
      },
      {},
      BASE,
    );
    expect(state.increment).toBeTypeOf("function");
    fnOf(state, "increment")(state);
    expect(state.count).toBe(1);
  });

  test("Shape 4: Function with return in body → computed", async () => {
    const state = await buildScope(
      {
        state: {
          doubled: { $prototype: "Function", body: "return state.n * 2" },
          n: 3,
        },
      },
      {},
      BASE,
    );
    expect(state.doubled).toBe(6);
    state.n = 5;
    expect(state.doubled).toBe(10);
  });

  test("Shape 4: Function with return + parameters → callable (not computed)", async () => {
    const state = await buildScope(
      {
        state: {
          addItem: {
            $prototype: "Function",
            body: "if (event.key !== 'Enter') return; state.items.push({ id: 2, text: 'b' });",
            parameters: ["event"],
          },
          items: { default: [{ id: 1, text: "a" }], type: "array" },
        },
      },
      {},
      BASE,
    );
    expect(state.addItem).toBeTypeOf("function");
  });

  test("Shape 4: Function with return + parameters is not auto-evaluated", async () => {
    const state = await buildScope(
      {
        state: {
          handler: {
            $prototype: "Function",
            body: "return event.target.value;",
            parameters: ["event"],
          },
        },
      },
      {},
      BASE,
    );
    expect(state.handler).toBeTypeOf("function");
    const result = fnOf(state, "handler")(state, { target: { value: "hello" } });
    expect(result).toBe("hello");
  });

  test("Shape 4: Function with $src → computed via introspection (has return, ≤1 param)", async () => {
    const srcUrl = new URL("_test_computed_src.js", import.meta.url).href;
    const state = await buildScope(
      {
        state: {
          items: { default: [1, 2, 3], type: "array" },
          total: { $export: "total", $prototype: "Function", $src: srcUrl },
        },
      },
      {},
      BASE,
    );
    expect(state.total).toBe(3);
  });

  test("Shape 4: Function with $src + parameters in def → callable (not computed)", async () => {
    const srcUrl = new URL("_test_handlers_fn.js", import.meta.url).href;
    const state = await buildScope(
      {
        state: {
          handler: {
            $export: "myFn",
            $prototype: "Function",
            $src: srcUrl,
            parameters: ["event"],
          },
        },
      },
      {},
      BASE,
    );
    expect(state.handler).toBeTypeOf("function");
  });

  test("Shape 4: Function with $src → computed when fn has return and ≤1 param", async () => {
    const srcUrl = new URL("_test_handlers_fn.js", import.meta.url).href;
    const state = await buildScope(
      {
        state: {
          myFn: { $prototype: "Function", $src: srcUrl },
        },
      },
      {},
      BASE,
    );
    expect(state.myFn).toBe(42);
  });

  test("Shape 4: Function with both body and $src → throws", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun-types types `.rejects.toThrow()` as void, but it returns a Promise at runtime that must be awaited
    await expect(
      buildScope(
        {
          state: {
            bad: {
              $prototype: "Function",
              $src: "./foo.js",
              body: "return 1;",
            },
          },
        },
        {},
        BASE,
      ),
    ).rejects.toThrow("mutually exclusive");
  });

  test("Shape 4: a non-string body with no $src throws — untrusted JSON, not a TS guarantee", async () => {
    // The `body`/`$src` union is a TypeScript-only contract; a raw document can still carry a
    // Truthy, non-string `body` (e.g. malformed authoring tooling), which skips both the
    // String-body branch and the neither-nor-body-nor-$src no-op.
    const doc: JsonObject = { state: { bad: { $prototype: "Function", body: true } } };
    /* SAFETY: deliberately unsound. `body: true` is outside JxFunctionDef, which is the point: the
       runtime must refuse it rather than trust the TypeScript-only `body`/`$src` contract. */
    const malformed = doc as JxDocument;
    // oxlint-disable-next-line typescript/await-thenable -- bun-types types `.rejects.toThrow()` as void, but it returns a Promise at runtime that must be awaited
    await expect(buildScope(malformed, {}, BASE)).rejects.toThrow("neither body nor $src");
  });

  test("Shape 4: Function with neither body nor $src → returns no-op", async () => {
    const state = await buildScope(
      {
        state: {
          empty: { $prototype: "Function" },
        },
      },
      {},
      BASE,
    );
    expect(state.empty).toBeTypeOf("function");
    expect(fnOf(state, "empty")()).toBeUndefined();
  });

  // Shape 5: External class $prototype
  test("Shape 5: $prototype other than Function → resolvePrototype", async () => {
    const doc: JxDocument = { state: { items: { $prototype: "Set", default: [1, 2] } } };
    const state = await buildScope(doc, {}, BASE);
    expect(state.items).toBeInstanceOf(Set);
  });

  // Scope merging
  test("merges parentScope", async () => {
    const parent = { existing: "from-parent" };
    const state = await buildScope({}, parent, BASE);
    expect(state.existing).toBe("from-parent");
  });

  test("stores $media in scope", async () => {
    const doc: JxDocument = { $media: { "--md": "(min-width: 768px)" } };
    const state = await buildScope(doc, {}, BASE);
    expect(state["$media"]).toEqual({ "--md": "(min-width: 768px)" });
  });
});

// ─── setSkipServerFunctions ──────────────────────────────────────────────────

describe("setSkipServerFunctions", () => {
  test("skips timing:'server' entries when flag is true", async () => {
    setSkipServerFunctions(true);
    try {
      const state = await buildScope(
        {
          state: {
            count: 5,
            data: {
              $export: "getData",
              $src: "./nonexistent.js",
              timing: "server",
            },
          },
        },
        {},
        BASE,
      );
      expect(state.count).toBe(5);
      expect(state.data).toBeUndefined();
    } finally {
      setSkipServerFunctions(false);
    }
  });

  test("does not skip non-server state entries when flag is true", async () => {
    setSkipServerFunctions(true);
    try {
      const state = await buildScope(
        {
          state: {
            count: { default: 42, type: "integer" },
            name: "hello",
          },
        },
        {},
        BASE,
      );
      expect(state.name).toBe("hello");
      expect(state.count).toBe(42);
    } finally {
      setSkipServerFunctions(false);
    }
  });

  test("flag defaults to false (server entries would be attempted)", async () => {
    setSkipServerFunctions(false);
    const state = await buildScope(
      {
        state: {
          plain: "value",
          serverEntry: {
            $export: "missing",
            $src: "./nonexistent.js",
            timing: "server",
          },
        },
      },
      {},
      BASE,
    );
    expect(state.plain).toBe("value");
    // Server entry attempted resolution (will fail/fallback but won't be undefined like skip mode)
    // The key point: it's not skipped — resolution was attempted
    expect("serverEntry" in state).toBe(true);
  });
});

// ─── applyStyle ───────────────────────────────────────────────────────────────

describe("applyStyle", () => {
  let el: HTMLElement;
  beforeEach(() => {
    resetDocumentStyles();
    el = document.createElement("div");
    document.body.append(el);
  });

  test("a base declaration is a RULE, not an inline style", () => {
    /* The whole point. An inline declaration beats any non-`!important` rule, so as long as the
       base went inline no authored `:hover` or `@media` could ever override it. */
    applyStyle(el, { color: "red", fontSize: "14px" });
    expect(el.style.cssText).toBe("");
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { color: red; font-size: 14px }`);
  });

  test("a nested override of a base property wins, because both are rules", () => {
    /* The regression test that would have caught the original defect, and the reason it is written
       against `getComputedStyle` rather than against the sheet text: the emitted CSS was always
       right. Built after the rules because the test DOM caches computed style permanently. */
    applyStyle(el, { ":hover": { backgroundColor: "#15164a" }, backgroundColor: "#6e0303" });
    const css = elementCSS(el).split("\n");
    expect(css).toEqual([
      `[data-jx="${el.dataset.jx}"] { background-color: #6e0303 }`,
      `[data-jx="${el.dataset.jx}"]:hover { background-color: #15164a }`,
    ]);
    const probe = document.createElement("div");
    probe.dataset.jx = el.dataset.jx;
    document.body.append(probe);
    expect(getComputedStyle(probe).backgroundColor).toBe("#6e0303");
  });

  test("two elements that style alike share one interned rule set", () => {
    // `Math.random()` handles could not dedup and were not stable across a server render.
    const twin = document.createElement("span");
    document.body.append(twin);
    applyStyle(el, { ":hover": { color: "blue" }, color: "red" });
    applyStyle(twin, { ":hover": { color: "blue" }, color: "red" });
    expect(twin.dataset.jx).toBe(el.dataset.jx);
    expect(adoptedCSS().split("\n").length).toBe(2);
  });

  test("releasing one of two sharers leaves the rules for the other", () => {
    const twin = document.createElement("span");
    document.body.append(twin);
    applyStyle(el, { color: "red" });
    applyStyle(twin, { color: "red" });
    releaseElementStyles(el);
    expect({ el: el.dataset.jx, css: adoptedCSS() }).toEqual({
      css: `[data-jx="${twin.dataset.jx}"] { color: red }`,
      el: undefined,
    });
    releaseElementStyles(twin);
    expect(adoptedCSS()).toBe("");
  });

  test("empty style object — no side effects", () => {
    applyStyle(el, {});
    expect(el.dataset.jx).toBeUndefined();
    expect(adoptedCSS()).toBe("");
  });

  test("Jx emits no cascade layer of its own", () => {
    /* Load-bearing rather than stylistic: third-party CSS arrives through `$head` UNLAYERED, and
       an unlayered rule beats a layered one at any specificity. Layering Jx's rules would hand
       every page's `$head` a win over the document's own styles. */
    applyStyle(el, { ":hover": { color: "blue" }, "@(min-width: 1px)": { gap: "1px" }, gap: "0" });
    expect(adoptedCSS()).not.toContain("@layer");
  });

  test("emits a scoped rule for a :pseudo selector", () => {
    applyStyle(el, { ":hover": { color: "blue" } });
    expect(el.dataset.jx).toBeDefined();
    const uid = el.dataset.jx;
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).not.toBe("");
    expect(style.textContent).toContain(`[data-jx="${uid}"]:hover`);
    expect(style.textContent).toContain("color: blue");
  });

  test("emits a scoped rule for a .class selector", () => {
    applyStyle(el, { ".child": { marginTop: "4px" } });
    const uid = el.dataset.jx;
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain(`[data-jx="${uid}"].child`);
  });

  test("emits a scoped rule for an &.compound selector", () => {
    applyStyle(el, { "&.active": { fontWeight: "bold" } });
    const uid = el.dataset.jx;
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain(`[data-jx="${uid}"].active`);
  });

  test("emits a scoped rule for an [attr] selector", () => {
    applyStyle(el, { "[disabled]": { opacity: "0.5" } });
    const uid = el.dataset.jx;
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain(`[data-jx="${uid}"][disabled]`);
  });

  test("resolves named @--breakpoint from mediaQueries", () => {
    applyStyle(el, { "@--md": { fontSize: "18px" } }, { "--md": "(min-width: 768px)" });
    const uid = el.dataset.jx;
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media (min-width: 768px)");
    expect(style.textContent).toContain(`[data-jx="${uid}"]`);
    expect(style.textContent).toContain("font-size: 18px");
  });

  test("uses literal condition for @(min-width:...) keys", () => {
    applyStyle(el, { "@(min-width: 1024px)": { padding: "2rem" } });
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media (min-width: 1024px)");
  });

  test("falls back to raw name when @--name not found in mediaQueries", () => {
    applyStyle(el, { "@--xl": { gap: "2rem" } }, {});
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media --xl");
  });

  /*
   * `@(…)` carries its own parentheses, but a media TYPE is bare. Emitting `@media (print)` reads
   * as a boolean media feature named `print`, which does not exist, so the rule never applied.
   */
  test("@(print) emits the bare media type", () => {
    applyStyle(el, { "@(print)": { display: "none" } }, {});
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media print");
    expect(style.textContent).not.toContain("@media (print)");
  });

  test("@(feature: value) keeps its parentheses", () => {
    applyStyle(el, { "@(min-width: 40rem)": { gap: "2rem" } }, {});
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media (min-width: 40rem)");
  });

  test("combined base + nested + media", () => {
    applyStyle(
      el,
      {
        ":focus": { outline: "2px solid blue" },
        "@--sm": { color: "red" },
        color: "green",
      },
      { "--sm": "(min-width: 640px)" },
    );
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("color: green");
    expect(style.textContent).toContain("]:focus");
    expect(style.textContent).toContain("@media (min-width: 640px)");
  });

  test("nested selector inside media block", () => {
    applyStyle(
      el,
      { "@--md": { ":hover": { color: "blue" }, fontSize: "2rem" } },
      { "--md": "(min-width: 768px)" },
    );
    const css = elementCSS(el);
    // Media block flat props
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("font-size: 2rem");
    // Nested selector within media
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{ \[data-jx="[^"]+"\]:hover \{ color: blue \} \}/,
    );
  });

  test("& compound selector inside media block", () => {
    applyStyle(
      el,
      { "@--sm": { "&.active": { fontWeight: "bold" } } },
      { "--sm": "(min-width: 640px)" },
    );
    const css = elementCSS(el);
    expect(css).toMatch(
      /@media \(min-width: 640px\) \{ \[data-jx="[^"]+"\]\.active \{ font-weight: bold \} \}/,
    );
  });
  test("custom properties are rules too, and keep their exact spelling", () => {
    /* In a rule rather than inline so `:hover { --my-color: … }` can override the base, and
       verbatim because a custom property is case-sensitive: kebab-casing `--myColor` renames it. */
    applyStyle(el, { "--my-color": "red", "--myColor": "8px" });
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { --my-color: red; --myColor: 8px }`);
  });

  test("custom properties and regular properties coexist", () => {
    applyStyle(el, { "--accent": "green", color: "blue" });
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { --accent: green; color: blue }`);
  });
});

// ─── Color-scheme helpers + dual emission ─────────────────────────────────────

describe("color-scheme helpers", () => {
  test("normative constants", () => {
    expect(COLOR_SCHEME_ATTR).toBe("data-color-scheme");
    expect(COLOR_SCHEME_STORAGE_KEY).toBe("jx-color-scheme");
  });

  test("pureSchemeOf recognizes pure scheme queries", () => {
    expect(pureSchemeOf("(prefers-color-scheme: dark)")).toBe("dark");
    expect(pureSchemeOf("(prefers-color-scheme: light)")).toBe("light");
    expect(pureSchemeOf("  ( prefers-color-scheme :dark )  ")).toBe("dark");
  });

  test("pureSchemeOf rejects compound and non-scheme queries", () => {
    expect(pureSchemeOf("(prefers-color-scheme: dark) and (min-width: 768px)")).toBeNull();
    expect(pureSchemeOf("(min-width: 768px)")).toBeNull();
    expect(pureSchemeOf("(prefers-color-scheme: no-preference)")).toBeNull();
    expect(pureSchemeOf("--dark")).toBeNull();
  });

  test("schemeSelectors for root selectors", () => {
    expect(schemeSelectors(":root", "dark")).toEqual({
      auto: ":root:where(:not([data-color-scheme]))",
      forced: ':root:where([data-color-scheme="dark"])',
    });
    expect(schemeSelectors("html", "light").forced).toBe('html:where([data-color-scheme="light"])');
  });

  test("schemeSelectors for scoped selectors", () => {
    expect(schemeSelectors('[data-jx="jx-abc"]', "dark")).toEqual({
      auto: ':where(:root:not([data-color-scheme])) [data-jx="jx-abc"]',
      forced: ':where(:root[data-color-scheme="dark"]) [data-jx="jx-abc"]',
    });
  });
});

describe("applyStyle color-scheme dual emission", () => {
  let el: HTMLElement;
  beforeEach(() => {
    resetDocumentStyles();
    el = document.createElement("div");
    document.body.append(el);
  });

  test("@--dark scheme block emits guarded media copy plus forced copy", () => {
    applyStyle(el, { "@--dark": { color: "white" } }, { "--dark": "(prefers-color-scheme: dark)" });
    const uid = el.dataset.jx;
    const css = elementCSS(el);
    expect(css).toContain(
      `@media (prefers-color-scheme: dark) { :where(:root:not([data-color-scheme])) [data-jx="${uid}"] { color: white } }`,
    );
    expect(css).toContain(
      `:where(:root[data-color-scheme="dark"]) [data-jx="${uid}"] { color: white }`,
    );
  });

  test("literal @(prefers-color-scheme: light) dual-emits too", () => {
    applyStyle(el, { "@(prefers-color-scheme: light)": { color: "black" } });
    const css = elementCSS(el);
    expect(css).toContain(
      "@media (prefers-color-scheme: light) { :where(:root:not([data-color-scheme]))",
    );
    expect(css).toContain(':where(:root[data-color-scheme="light"])');
  });

  test("nested selector inside scheme block gets both copies", () => {
    applyStyle(
      el,
      { "@--dark": { "&.active": { borderColor: "red" }, color: "white" } },
      { "--dark": "(prefers-color-scheme: dark)" },
    );
    const uid = el.dataset.jx;
    const css = elementCSS(el);
    expect(css).toContain(
      `@media (prefers-color-scheme: dark) { :where(:root:not([data-color-scheme])) [data-jx="${uid}"].active { border-color: red } }`,
    );
    expect(css).toContain(
      `:where(:root[data-color-scheme="dark"]) [data-jx="${uid}"].active { border-color: red }`,
    );
  });

  test("compound scheme query keeps plain single emission", () => {
    applyStyle(el, { "@(prefers-color-scheme: dark) and (min-width: 600px)": { color: "white" } });
    const css = elementCSS(el);
    expect(css).toContain("@media (prefers-color-scheme: dark) and (min-width: 600px)");
    expect(css).not.toContain("data-color-scheme");
  });

  test("the base property is a rule, so the forced-scheme copy can override it", () => {
    applyStyle(
      el,
      { "@--dark": { color: "white" }, color: "black" },
      {
        "--dark": "(prefers-color-scheme: dark)",
      },
    );
    const uid = el.dataset.jx;
    expect(el.style.cssText).toBe("");
    const css = elementCSS(el);
    expect(css.split("\n")[0]).toBe(`[data-jx="${uid}"] { color: black }`);
  });
});

// ─── resolvePrototype ─────────────────────────────────────────────────────────

/* A test below binds a resolved entry into a reactive scope and reads it back. The read goes through
   the proxy, which unwraps the ref, so it is compared as a scope member rather than as the ref
   type the assignment narrowed it to. */
describe("resolvePrototype", () => {
  test("Request: returns ref, starts null, fetches and sets data", async () => {
    stubFetch(() => Response.json({ id: 1 }));
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "Request", url: "/api/test" },
      state,
      "data",
    );
    state.data = result;
    expect(isRef(result)).toBe(true);
    await wait();
    expect(state.data).toEqual<JxScopeValue>({ id: 1 });
  });

  test("Request: manual:true does not auto-fetch", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    const state = reactive<JxScope>({});
    await resolvePrototype({ $prototype: "Request", manual: true, url: "/api/x" }, state, "x");
    await wait();
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  test("Request: sets error on non-ok response", async () => {
    stubFetch(() => Response.json({}, { status: 404, statusText: "Not Found" }));
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Request", url: "/api/z" }, state, "z");
    state.z = result;
    await wait();
    expect(state.z).toHaveProperty("error");
  });

  test("Request: POST with headers and body", async () => {
    const fetchMock = stubFetch(() => Response.json({}));
    const state = reactive<JxScope>({});
    await resolvePrototype(
      {
        $prototype: "Request",
        body: { a: 1 },
        headers: { x: "1" },
        method: "POST",
        url: "/api",
      },
      state,
      "r",
    );
    await wait();
    const captured = fetchMock.mock.calls[0]?.[1];
    expect(captured?.method).toBe("POST");
    expect(captured?.headers).toEqual({ x: "1" });
    expect(captured?.body).toBe('{"a":1}');
  });

  test("URLSearchParams: returns computed ref", async () => {
    const state = reactive({ q: "hello" });
    const result = await resolvePrototype(
      { $prototype: "URLSearchParams", q: { $ref: "#/state/q" } },
      state,
      "params",
    );
    expect(isRef(result)).toBe(true);
  });

  test("LocalStorage: reads existing value", async () => {
    localStorage.setItem("lsKey", JSON.stringify(99));
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", key: "lsKey" },
      state,
      "ls",
    );
    state.ls = result;
    expect(state.ls).toBe<JxScopeValue>(99);
    localStorage.removeItem("lsKey");
  });

  test("LocalStorage: defaults to def.default when key absent", async () => {
    localStorage.removeItem("lsMissing");
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", default: "fallback", key: "lsMissing" },
      state,
      "ls",
    );
    state.ls = result;
    expect(state.ls).toBe<JxScopeValue>("fallback");
  });

  test("LocalStorage: assignment persists to storage", async () => {
    localStorage.removeItem("lsPersist");
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", default: 0, key: "lsPersist" },
      state,
      "ls",
    );
    state.ls = result;
    state.ls = 123;
    await wait();
    expect(JSON.parse(localStorage.getItem("lsPersist") ?? "null")).toBe(123);
    localStorage.removeItem("lsPersist");
  });

  test("SessionStorage: reads and writes session storage", async () => {
    sessionStorage.setItem("ssKey", JSON.stringify("hello"));
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "SessionStorage", key: "ssKey" },
      state,
      "ss",
    );
    state.ss = result;
    expect(state.ss).toBe<JxScopeValue>("hello");
    state.ss = "world";
    await wait();
    expect(JSON.parse(sessionStorage.getItem("ssKey") ?? "null")).toBe("world");
    sessionStorage.removeItem("ssKey");
  });

  test("Cookie: reads, writes cookie", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      {
        $prototype: "Cookie",
        default: null,
        maxAge: 3600,
        name: "testCookie",
        path: "/",
      },
      state,
      "ck",
    );
    state.ck = result;
    expect(state.ck).toBeNull();
    state.ck = { user: "bob" };
    await wait();
    expect(state.ck).toEqual({ user: "bob" });
  });

  test("IndexedDB: returns ref", async () => {
    const fakeReq = { addEventListener: () => {} };
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open: () => fakeReq },
      writable: true,
    });
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      {
        $prototype: "IndexedDB",
        database: "testDB",
        store: "items",
      },
      state,
      "db",
    );
    expect(isRef(result)).toBe(true);
    Reflect.deleteProperty(globalThis, "indexedDB");
  });

  test("Set: returns a Set", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Set" }, state, "s");
    state.s = result;
    const set = state.s;
    expect(set).toBeInstanceOf(Set);
    assertInstance(set, Set);
    expect(set.size).toBe(0);
  });

  test("Set: default values", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Set", default: [1, 2] }, state, "s");
    state.s = result;
    const set = state.s;
    assertInstance(set, Set);
    expect(set.has(1)).toBe(true);
  });

  test("Map: returns a Map", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Map" }, state, "m");
    state.m = result;
    expect(state.m).toBeInstanceOf(Map);
  });

  test("Map: default object", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Map", default: { a: 1 } }, state, "m");
    state.m = result;
    const map = state.m;
    assertInstance(map, Map);
    expect(map.get("a")).toBe(1);
  });

  test("FormData: returns FormData", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "FormData", fields: { name: "Alice" } },
      state,
      "fd",
    );
    expect(result).toBeInstanceOf(FormData);
    assertInstance(result, FormData);
    expect(result.get("name")).toBe("Alice");
  });

  test("Blob: returns Blob", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "Blob", parts: ["hello"], type: "text/plain" },
      state,
      "b",
    );
    expect(result).toBeInstanceOf(Blob);
  });

  test("ReadableStream: returns null", async () => {
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "ReadableStream" }, state, "rs");
    expect(result).toBeNull();
  });

  test("unknown $prototype: warns and returns ref(null)", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const state = reactive<JxScope>({});
    const result = await resolvePrototype({ $prototype: "Unknown" }, state, "u");
    expect(isRef(result)).toBe(true);
    expect(isRef(result) ? result.value : undefined).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown"));
    warn.mockRestore();
  });
});

// ─── renderNode ───────────────────────────────────────────────────────────────

describe("renderNode", () => {
  test("creates element with correct tagName", () => {
    const el = renderNode({ tagName: "section" }, reactive({}));
    expect(el.tagName.toLowerCase()).toBe("section");
  });

  test("defaults tagName to div", () => {
    const el = renderNode({}, reactive({}));
    expect(el.tagName.toLowerCase()).toBe("div");
  });

  test("sets plain string property", () => {
    const el = renderNode({ tagName: "p", textContent: "Hello" }, reactive({}));
    expect(el.textContent).toBe("Hello");
  });

  test("sets plain boolean property", () => {
    const el = renderNode({ disabled: true, tagName: "button" }, reactive({}));
    expect(el instanceof HTMLButtonElement && el.disabled).toBe(true);
  });

  test("sets reactive property from $ref", async () => {
    const state = reactive({ msg: "initial" });
    const el = renderNode({ tagName: "span", textContent: { $ref: "#/state/msg" } }, state);
    expect(el.textContent).toBe("initial");
    state.msg = "updated";
    await wait();
    expect(el.textContent).toBe("updated");
  });

  test("sets non-reactive property from plain value $ref", () => {
    const state = reactive({ label: "static" });
    const el = renderNode({ tagName: "span", textContent: { $ref: "#/state/label" } }, state);
    expect(el.textContent).toBe("static");
  });

  test("protected id property: set once, not reactive", () => {
    const state = reactive({ myId: "my-id" });
    const def: JsonObject = { id: { $ref: "#/state/myId" }, tagName: "div" };
    /* SAFETY: deliberately outside JxElement, which types `id` as a string. The runtime still
       accepts a `$ref` there and binds it once, which is the behavior this test pins. */
    const el = renderNode(def as JxElement, state);
    expect(el.id).toBe("my-id");
  });

  test("binds event handler via onclick $ref", async () => {
    const state = reactive<JxScope>({ count: 0 });
    state.clickHandler = function clickHandler(s: { count: number }) {
      s.count += 1;
    };
    const el = renderNode({ onclick: { $ref: "#/state/clickHandler" }, tagName: "button" }, state);
    el.dispatchEvent(new Event("click"));
    expect(state.count).toBe(1);
  });

  test("ignores handler $ref when not a function", () => {
    const state = reactive({ notFn: 42 });
    expect(() =>
      renderNode({ onclick: { $ref: "#/state/notFn" }, tagName: "div" }, state),
    ).not.toThrow();
  });

  test("applies attributes", () => {
    const el = renderNode({ attributes: { "data-x": "val" }, tagName: "div" }, reactive({}));
    expect(el.dataset.x).toBe("val");
  });

  test("applies reactive attribute from $ref", async () => {
    const state = reactive({ cls: "a" });
    const el = renderNode(
      { attributes: { "data-cls": { $ref: "#/state/cls" } }, tagName: "div" },
      state,
    );
    expect(el.dataset.cls).toBe("a");
    state.cls = "b";
    await wait();
    expect(el.dataset.cls).toBe("b");
  });

  test("applies static attribute from plain $ref", () => {
    const state = reactive({ val: "hello" });
    const el = renderNode(
      { attributes: { "aria-label": { $ref: "#/state/val" } }, tagName: "div" },
      state,
    );
    expect(el.getAttribute("aria-label")).toBe("hello");
  });

  /*
   * The two attribute families (see `booleanAttrValue`). These render through `renderNode` rather
   * than calling the helper, because the defect being guarded is the WRITE — a false that reaches
   * `setAttribute` as the string "false" is present, and present is true.
   */
  test("a true boolean attribute is written bare, not as text", () => {
    const el = renderNode({ attributes: { open: true }, tagName: "details" }, reactive({}));
    expect(el.getAttribute("open")).toBe("");
    expect(el.outerHTML).toContain("<details open");
  });

  test("a false boolean attribute is absent, because presence would mean true", () => {
    const el = renderNode({ attributes: { open: false }, tagName: "details" }, reactive({}));
    expect(el.hasAttribute("open")).toBe(false);
  });

  test("an aria-* boolean is written as text, because bare aria-hidden is not hidden", () => {
    const el = renderNode({ attributes: { "aria-hidden": true }, tagName: "div" }, reactive({}));
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  test("an aria-* false is written rather than dropped", () => {
    const el = renderNode({ attributes: { "aria-expanded": false }, tagName: "div" }, reactive({}));
    expect(el.getAttribute("aria-expanded")).toBe("false");
  });

  test("contenteditable is enumerated: false is explicit, not inherit", () => {
    const el = renderNode({ attributes: { contenteditable: false }, tagName: "div" }, reactive({}));
    expect(el.getAttribute("contenteditable")).toBe("false");
  });

  /*
   * The reactive half, and the reason a plain `setAttribute` could not have been left in place: an
   * element is re-used across renders, so a binding that flips back has to REMOVE the attribute.
   * Writing "false" leaves `<details open="false">`, which is an open `<details>`.
   */
  test("a value that resolves to null or undefined removes the attribute", async () => {
    const state = reactive<{ haspopup: boolean; missing: string | undefined }>({
      haspopup: true,
      missing: undefined,
    });
    const attributes: JsonObject = {
      "aria-haspopup": "${state.haspopup ? 'menu' : null}",
      title: { $ref: "#/state/missing" },
      lang: null,
    };
    const el = renderNode(
      {
        /* SAFETY: deliberately outside JxAttributeValue: a hand-written document can carry a
           literal `null`, and the runtime must treat it as "absent" exactly as a binding that
           resolves to null, which the assertions below check. */
        attributes: attributes as NonNullable<JxElement["attributes"]>,
        tagName: "div",
      },
      state,
    );
    expect(el.getAttribute("aria-haspopup")).toBe("menu");
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.hasAttribute("lang")).toBe(false);
    state.haspopup = false;
    await Promise.resolve();
    expect(el.hasAttribute("aria-haspopup")).toBe(false);
    state.missing = "Needs a selection";
    await Promise.resolve();
    expect(el.getAttribute("title")).toBe("Needs a selection");
  });

  test("a boolean binding that flips to false removes the attribute", async () => {
    const state = reactive({ expanded: true });
    const el = renderNode({ attributes: { open: "${state.expanded}" }, tagName: "details" }, state);
    expect(el.hasAttribute("open")).toBe(true);
    state.expanded = false;
    await wait();
    expect(el.hasAttribute("open")).toBe(false);
    state.expanded = true;
    await wait();
    expect(el.getAttribute("open")).toBe("");
  });

  test("an attribute template with text around the expression stays a string, not a single value", () => {
    // Mixed content can never carry a type of its own, so it always goes through the
    // String-interpolating path, unlike a bare `${expr}` attribute.
    const state = reactive({ count: 3 });
    const el = renderNode({ attributes: { title: "${state.count} items" }, tagName: "div" }, state);
    expect(el.getAttribute("title")).toBe("3 items");
  });

  test("an aria-* binding that flips writes the word both ways", async () => {
    const state = reactive({ open: false });
    const el = renderNode(
      { attributes: { "aria-expanded": "${state.open}" }, tagName: "button" },
      state,
    );
    expect(el.getAttribute("aria-expanded")).toBe("false");
    state.open = true;
    await wait();
    expect(el.getAttribute("aria-expanded")).toBe("true");
  });

  test('a string "false" is never reinterpreted as the boolean', () => {
    const el = renderNode(
      { attributes: { "aria-current": "false", "data-flag": "false" }, tagName: "div" },
      reactive({}),
    );
    expect(el.getAttribute("aria-current")).toBe("false");
    expect(el.dataset.flag).toBe("false");
  });

  // Template string ${} tests
  test("${} template string in textContent renders reactively", async () => {
    const state = reactive({ count: 5 });
    const el = renderNode({ tagName: "span", textContent: "${state.count} items" }, state);
    expect(el.textContent).toBe("5 items");
    state.count = 10;
    await wait();
    expect(el.textContent).toBe("10 items");
  });

  test("${} template string in className", async () => {
    const state = reactive({ active: true });
    const el = renderNode(
      { className: '${state.active ? "active" : "inactive"}', tagName: "div" },
      state,
    );
    expect(el.className).toBe("active");
    state.active = false;
    await wait();
    expect(el.className).toBe("inactive");
  });

  test("renders children recursively", () => {
    const el = renderNode(
      {
        children: [
          { tagName: "li", textContent: "A" },
          { tagName: "li", textContent: "B" },
        ],
        tagName: "ul",
      },
      reactive({}),
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0]!.textContent).toBe("A");
    expect(el.children[1]!.textContent).toBe("B");
  });

  test("$switch renders correct case", () => {
    const state = reactive({ route: "about" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/route" },
        cases: {
          about: { tagName: "section", textContent: "About" },
          home: { tagName: "section", textContent: "Home" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.textContent).toBe("About");
  });

  test("$switch reacts to change", async () => {
    const state = reactive({ route: "home" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/route" },
        cases: {
          about: { tagName: "div", textContent: "About" },
          home: { tagName: "div", textContent: "Home" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.textContent).toBe("Home");
    state.route = "about";
    await wait();
    expect(el.textContent).toBe("About");
  });

  test("$switch with missing case renders empty", () => {
    const state = reactive({ route: "404" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/route" },
        cases: { home: { tagName: "div", textContent: "Home" } },
        tagName: "div",
      },
      state,
    );
    expect(el.textContent).toBe("");
  });

  test("Array map renders static items", () => {
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: [{ id: 1, label: "X" }],
          map: { tagName: "li" },
        },
        tagName: "ul",
      },
      reactive({}),
    );
    expect(el.children.length).toBe(1);
  });

  test("Array map re-renders on reactive change", async () => {
    const state = reactive({ list: [{ v: "a" }, { v: "b" }] });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/list" },
          map: { tagName: "li" },
        },
        tagName: "ul",
      },
      state,
    );
    expect(el.children.length).toBe(2);
    state.list = [{ v: "x" }];
    await wait();
    expect(el.children.length).toBe(1);
  });

  test("Array map grows with push", async () => {
    const state = reactive({ list: [1, 2] });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/list" },
          map: { tagName: "span" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(2);
    state.list.push(3);
    await wait();
    expect(el.children.length).toBe(3);
  });

  test("Array map with filter", () => {
    const state = reactive({
      isEven: (x: any) => x % 2 === 0,
      list: [1, 2, 3, 4],
    });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          filter: { $ref: "#/state/isEven" },
          items: { $ref: "#/state/list" },
          map: { tagName: "span" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(2);
  });

  test("Array map with sort", () => {
    const state = reactive({
      list: [3, 1, 2],
      sortAsc: (a: any, b: any) => a - b,
    });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/list" },
          map: { tagName: "span" },
          sort: { $ref: "#/state/sortAsc" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(3);
  });

  test("Array map: items not an array returns empty", () => {
    const state = reactive({ list: null });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/list" },
          map: { tagName: "span" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(0);
  });

  test("Array map with computed signal items updates reactively", async () => {
    const allItems = reactive([
      { id: 1, text: "alpha" },
      { id: 2, text: "beta" },
      { id: 3, text: "gamma" },
    ]);
    const filterTerm = ref("");
    const filteredItems = computed(() => {
      const term = filterTerm.value.toLowerCase();
      if (!term) {
        return allItems;
      }
      return allItems.filter((i) => i.text.includes(term));
    });
    const state = reactive({ filteredItems });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/filteredItems" },
          map: { tagName: "div", textContent: "${$map.item.text}" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(3);
    filterTerm.value = "alph";
    await wait();
    expect(el.children.length).toBe(1);
    expect(el.children[0]!.textContent).toBe("alpha");
  });

  test("Array map with paginated computed slice", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
    const page = ref(1);
    const perPage = 10;
    const paginatedItems = computed(() => {
      const start = (page.value - 1) * perPage;
      return items.slice(start, start + perPage);
    });
    const state = reactive({ paginatedItems });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/paginatedItems" },
          map: { tagName: "div" },
        },
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(10);
    page.value = 3;
    await wait();
    expect(el.children.length).toBe(5);
  });

  test("$props merges into scope", () => {
    const state = reactive({ count: 10 });
    const def = {
      $props: { val: { $ref: "#/state/count" } },
      tagName: "span",
      textContent: "ok",
    };
    const el = renderNode(def, state);
    expect(el.textContent).toBe("ok");
  });

  test("style object applied", () => {
    const el = renderNode({ style: { color: "green" }, tagName: "div" }, reactive({}));
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { color: green }`);
  });
});

// ─── Integration: computed $src functions + Array map (fetch-demo pattern) ────

describe("computed $src + Array map integration", () => {
  test("computed function filters items for Array map rendering", async () => {
    const srcUrl = new URL("_test_computed_src.js", import.meta.url).href;
    const doc: JxDocument = {
      children: {
        $prototype: "Array",
        items: { $ref: "#/state/filteredPosts" },
        map: { tagName: "div", textContent: "${$map.item.title}" },
      },
      state: {
        allPosts: {
          default: [
            { body: "first", id: 1, title: "Hello World" },
            { body: "second", id: 2, title: "Goodbye" },
            { body: "third", id: 3, title: "Hello Again" },
          ],
          type: "array",
        },
        filteredPosts: { $prototype: "Function", $src: srcUrl },
        searchTerm: { default: "", type: "string" },
      },
      tagName: "div",
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.filteredPosts).toHaveLength(3);

    const el = renderNode(doc, state);
    expect(el.children.length).toBe(3);
    expect(el.children[0]!.textContent).toBe("Hello World");

    state.searchTerm = "hello";
    await wait();
    expect(state.filteredPosts).toHaveLength(2);
    expect(el.children.length).toBe(2);
    expect(el.children[0]!.textContent).toBe("Hello World");
    expect(el.children[1]!.textContent).toBe("Hello Again");
  });

  test("computed function paginates items reactively", async () => {
    const srcUrl = new URL("_test_computed_src.js", import.meta.url).href;
    const doc: JxDocument = {
      children: {
        $prototype: "Array",
        items: { $ref: "#/state/paginatedItems" },
        map: { tagName: "span", textContent: "${$map.item.name}" },
      },
      state: {
        allItems: {
          default: Array.from({ length: 12 }, (_, i) => ({
            id: i + 1,
            name: `Item ${i + 1}`,
          })),
          type: "array",
        },
        currentPage: { default: 1, type: "integer" },
        paginatedItems: { $prototype: "Function", $src: srcUrl },
        perPage: { default: 5, type: "integer" },
      },
      tagName: "div",
    };
    const state = await buildScope(doc, {}, BASE);
    const el = renderNode(doc, state);
    expect(el.children.length).toBe(5);
    expect(el.children[0]!.textContent).toBe("Item 1");

    state.currentPage = 2;
    await wait();
    expect(el.children.length).toBe(5);
    expect(el.children[0]!.textContent).toBe("Item 6");

    state.currentPage = 3;
    await wait();
    expect(el.children.length).toBe(2);
    expect(el.children[0]!.textContent).toBe("Item 11");
  });

  test("event handler with parameters + return is callable, not computed", async () => {
    const doc: JxDocument = {
      state: {
        addItem: {
          $prototype: "Function",
          body: "if (!event.text) return; state.items = [...state.items, { text: event.text }]; return true;",
          parameters: ["event"],
        },
        items: { default: [], type: "array" },
      },
      tagName: "div",
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.addItem).toBeTypeOf("function");
    expect(state.items).toHaveLength(0);
    const result = fnOf(state, "addItem")(state, { text: "new item" });
    expect(result).toBe(true);
    expect(state.items).toHaveLength(1);
    expect(arrOf(state, "items")[0]).toMatchObject({ text: "new item" });
  });
});

// ─── Array pseudo-elements among siblings (wrapper-less) ──────────────────────

describe("Array members in a children array", () => {
  test("array member renders items in place between static siblings, no wrapper", () => {
    const state = reactive({ list: [{ v: "a" }, { v: "b" }] });
    const el = renderNode(
      {
        children: [
          { tagName: "h1", textContent: "head" },
          {
            $prototype: "Array",
            items: { $ref: "#/state/list" },
            map: { tagName: "li", textContent: "${$map.item.v}" },
          },
          { tagName: "footer", textContent: "foot" },
        ],
        tagName: "div",
      },
      state,
    );
    // No extra wrapper: h1 + 2×li + footer are all direct children of <div>.
    const tags = [...el.children].map((c) => c.tagName.toLowerCase());
    expect(tags).toEqual(["h1", "li", "li", "footer"]);
    expect(el.children[1]!.textContent).toBe("a");
    expect(el.children[2]!.textContent).toBe("b");
  });

  test("array member as the sole child renders items directly into the parent", () => {
    const state = reactive({ list: [1, 2, 3] });
    const el = renderNode(
      {
        children: [
          { $prototype: "Array", items: { $ref: "#/state/list" }, map: { tagName: "li" } },
        ],
        tagName: "ul",
      },
      state,
    );
    expect([...el.children].map((c) => c.tagName.toLowerCase())).toEqual(["li", "li", "li"]);
  });

  test("array member re-renders only its own items, leaving siblings intact", async () => {
    const state = reactive({ list: [{ v: "a" }, { v: "b" }] });
    const el = renderNode(
      {
        children: [
          { tagName: "h1", textContent: "head" },
          {
            $prototype: "Array",
            items: { $ref: "#/state/list" },
            map: { tagName: "li", textContent: "${$map.item.v}" },
          },
        ],
        tagName: "div",
      },
      state,
    );
    expect(el.children.length).toBe(3);
    state.list = [{ v: "x" }];
    await wait();
    const tags = [...el.children].map((c) => c.tagName.toLowerCase());
    expect(tags).toEqual(["h1", "li"]);
    expect(el.children[0]!.textContent).toBe("head");
    expect(el.children[1]!.textContent).toBe("x");
  });

  test("two array members as siblings keep their relative order", () => {
    const state = reactive({ a: ["a1", "a2"], b: ["b1"] });
    const el = renderNode(
      {
        children: [
          { $prototype: "Array", items: { $ref: "#/state/a" }, map: { tagName: "i" } },
          { $prototype: "Array", items: { $ref: "#/state/b" }, map: { tagName: "b" } },
        ],
        tagName: "div",
      },
      state,
    );
    expect([...el.children].map((c) => c.tagName.toLowerCase())).toEqual(["i", "i", "b"]);
  });

  test("nested array (array template containing an array) renders and disposes cleanly", async () => {
    const state = reactive({ groups: [{ items: ["x", "y"] }, { items: ["z"] }] });
    const el = renderNode(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/groups" },
            map: {
              children: [
                {
                  $prototype: "Array",
                  items: { $ref: "$map/item/items" },
                  map: { tagName: "span" },
                },
              ],
              tagName: "section",
            },
          },
        ],
        tagName: "div",
      },
      state,
    );
    const sections = el.querySelectorAll("section");
    expect(sections.length).toBe(2);
    expect(sections[0]!.querySelectorAll("span").length).toBe(2);
    expect(sections[1]!.querySelectorAll("span").length).toBe(1);
    // Replacing the outer list disposes the old generation's inner arrays and rebuilds.
    state.groups = [{ items: ["only"] }];
    await wait();
    expect(el.querySelectorAll("section").length).toBe(1);
    expect(el.querySelectorAll("span").length).toBe(1);
  });

  test("empty items array renders no item nodes but keeps siblings", async () => {
    const state = reactive<{ list: number[] }>({ list: [] });
    const el = renderNode(
      {
        children: [
          { tagName: "h1" },
          { $prototype: "Array", items: { $ref: "#/state/list" }, map: { tagName: "li" } },
        ],
        tagName: "div",
      },
      state,
    );
    expect(el.querySelectorAll("li").length).toBe(0);
    expect(el.children.length).toBe(1);
    state.list = [1, 2];
    await wait();
    expect(el.querySelectorAll("li").length).toBe(2);
  });
});

// ─── Jx (top-level mount) ─────────────────────────────────────────────────

describe("Jx", () => {
  test("mounts object doc into target", async () => {
    const target = document.createElement("div");
    await Jx({ tagName: "span", textContent: "mounted" }, target);
    expect(target.children[0]!.tagName.toLowerCase()).toBe("span");
    expect(target.children[0]!.textContent).toBe("mounted");
  });

  test("returns scope with naked value property", async () => {
    const target = document.createElement("div");
    const state = await Jx({ state: { x: 1 }, tagName: "div" }, target);
    expect(state.x).toBe(1);
  });

  test("returns scope with expanded signal property", async () => {
    const target = document.createElement("div");
    const state = await Jx({ state: { x: { default: 5 } }, tagName: "div" }, target);
    expect(state.x).toBe(5);
  });

  test("calls onMount if present in scope", async () => {
    const target = document.createElement("div");
    const srcUrl = new URL("_test_handlers.js", import.meta.url).href;
    await Jx(
      {
        state: {
          onMount: { $prototype: "Function", $src: srcUrl },
        },
        tagName: "div",
      },
      target,
    );
    await wait();
    expect(globalThis).toHaveProperty("_testMounted", true);
    Reflect.deleteProperty(globalThis, "_testMounted");
  });

  test("fetches string source", async () => {
    const doc = { tagName: "article" };
    stubFetch(() => Response.json(doc));
    const target = document.createElement("div");
    await Jx("http://example.com/test.json", target);
    expect(target.children[0]!.tagName.toLowerCase()).toBe("article");
  });

  test("defaults target to document.body", async () => {
    const before = document.body.children.length;
    await Jx({ tagName: "div" });
    expect(document.body.children.length).toBe(before + 1);
  });
});

// ─── $media inheritance in buildScope ───────────────────────────────────────

describe("buildScope — $media inheritance", () => {
  test("sets $media on state when doc has $media", async () => {
    const state = await buildScope(
      { $media: { "--md": "(max-width: 768px)" }, state: {} },
      {},
      BASE,
    );
    expect(state.$media).toEqual({ "--md": "(max-width: 768px)" });
  });

  test("inherits $media from parentScope when doc has no $media", async () => {
    const parentScope = { $media: { "--sm": "(max-width: 640px)" } };
    const state = await buildScope({ state: {} }, parentScope, BASE);
    expect(state.$media).toEqual({ "--sm": "(max-width: 640px)" });
  });

  test("doc $media overrides inherited $media", async () => {
    const parentScope = { $media: { "--md": "(max-width: 768px)" } };
    const state = await buildScope(
      { $media: { "--md": "(max-width: 900px)" }, state: {} },
      parentScope,
      BASE,
    );
    expect(state.$media).toEqual({ "--md": "(max-width: 900px)" });
  });

  test("does not add $media to empty doc state when _rootMedia is empty", async () => {
    const state = await buildScope({}, {}, BASE);
    expect(Object.keys(state).length).toBe(0);
  });
});

// ─── applyStyle — non-media at-rules ────────────────────────────────────────

describe("applyStyle — non-media at-rules", () => {
  let el: HTMLElement;
  beforeEach(() => {
    resetDocumentStyles();
    el = document.createElement("div");
    document.body.append(el);
  });

  test("@starting-style emits without @media wrapper", () => {
    applyStyle(el, {
      "@starting-style": {
        ":popover-open": { transform: "translateX(100%)" },
      },
    });
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@starting-style");
    expect(style.textContent).not.toContain("@media starting-style");
    expect(style.textContent).toContain(":popover-open");
    expect(style.textContent).toContain("transform: translateX(100%)");
  });

  test("@supports emits as-is", () => {
    applyStyle(el, {
      "@supports (display: grid)": { display: "grid" },
    });
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@supports (display: grid)");
    expect(style.textContent).not.toContain("@media");
  });

  test("@(condition) emits as @media shorthand", () => {
    applyStyle(el, {
      "@(max-width: 600px)": { fontSize: "14px" },
    });
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media (max-width: 600px)");
  });

  test("@--breakpoint still resolves from mediaQueries", () => {
    applyStyle(el, { "@--lg": { fontSize: "20px" } }, { "--lg": "(min-width: 1024px)" });
    const style = { textContent: elementCSS(el) };
    expect(style.textContent).toContain("@media (min-width: 1024px)");
  });
});

// ─── $expression (Shape 5) ───────────────────────────────────────────────────

describe("isMutating", () => {
  test("identifies mutating operators", () => {
    expect(isMutating("=")).toBe(true);
    expect(isMutating("+=")).toBe(true);
    expect(isMutating("push")).toBe(true);
    expect(isMutating("splice")).toBe(true);
  });
  test("identifies pure operators", () => {
    expect(isMutating("+")).toBe(false);
    expect(isMutating("!")).toBe(false);
    expect(isMutating("===")).toBe(false);
    expect(isMutating("reduce")).toBe(false);
  });
});

describe("evaluateExpression — pure operators", () => {
  const state = reactive({ count: 5, flag: true, items: [1, 2, 3] });

  test("unary ! negation", () => {
    const node = { operator: "!", target: { $ref: "#/state/flag" } };
    expect(evaluateExpression(node, state, null)).toBe(false);
  });

  test("unary - negation", () => {
    const node = { operator: "-", target: { $ref: "#/state/count" } };
    expect(evaluateExpression(node, state, null)).toBe(-5);
  });

  test("binary arithmetic +", () => {
    const node = { operator: "+", target: { $ref: "#/state/count" }, value: 3 };
    expect(evaluateExpression(node, state, null)).toBe(8);
  });

  test("binary arithmetic *", () => {
    const node = { operator: "*", target: 4, value: 3 };
    expect(evaluateExpression(node, state, null)).toBe(12);
  });

  test("comparison ===", () => {
    const node = {
      operator: "===",
      target: { $ref: "#/state/count" },
      value: 5,
    };
    expect(evaluateExpression(node, state, null)).toBe(true);
  });

  test("comparison !==", () => {
    const node = {
      operator: "!==",
      target: { $ref: "#/state/count" },
      value: 3,
    };
    expect(evaluateExpression(node, state, null)).toBe(true);
  });

  test("logical &&", () => {
    const node = {
      operator: "&&",
      target: { $ref: "#/state/flag" },
      value: { $ref: "#/state/count" },
    };
    expect(evaluateExpression(node, state, null)).toBe(5);
  });

  test("logical ||", () => {
    const node = {
      operator: "||",
      target: false,
      value: { $ref: "#/state/count" },
    };
    expect(evaluateExpression(node, state, null)).toBe(5);
  });

  test("nested expression: count + 1", () => {
    const node = {
      operator: "+",
      target: { $ref: "#/state/count" },
      value: { operator: "*", target: 2, value: 3 },
    };
    expect(evaluateExpression(node, state, null)).toBe(11);
  });

  test("throws on unknown operator", () => {
    const node = { operator: "**", target: 2, value: 3 };
    expect(() => evaluateExpression(node, state, null)).toThrow('unknown operator "**"');
  });
});

describe("evaluateExpression — mutating operators", () => {
  test("assignment =", () => {
    const state = reactive({ count: 0 });
    const node = {
      operator: "=",
      target: { $ref: "#/state/count" },
      value: 42,
    };
    void evaluateExpression(node, state, null);
    expect(state.count).toBe(42);
  });

  test("compound +=", () => {
    const state = reactive({ count: 10 });
    const node = {
      operator: "+=",
      target: { $ref: "#/state/count" },
      value: 5,
    };
    void evaluateExpression(node, state, null);
    expect(state.count).toBe(15);
  });

  test("compound -=", () => {
    const state = reactive({ count: 10 });
    const node = {
      operator: "-=",
      target: { $ref: "#/state/count" },
      value: 3,
    };
    void evaluateExpression(node, state, null);
    expect(state.count).toBe(7);
  });

  test("toggle via = and nested !", () => {
    const state = reactive({ dark: false });
    const node = {
      operator: "=",
      target: { $ref: "#/state/dark" },
      value: { operator: "!", target: { $ref: "#/state/dark" } },
    };
    void evaluateExpression(node, state, null);
    expect(state.dark).toBe(true);
    void evaluateExpression(node, state, null);
    expect(state.dark).toBe(false);
  });

  test("push to array", () => {
    const state = reactive({ items: [1, 2] });
    const node = {
      operator: "push",
      target: { $ref: "#/state/items" },
      value: 3,
    };
    void evaluateExpression(node, state, null);
    expect(state.items).toEqual([1, 2, 3]);
  });

  test("pop from array", () => {
    const state = reactive({ items: [1, 2, 3] });
    const node = { operator: "pop", target: { $ref: "#/state/items" } };
    void evaluateExpression(node, state, null);
    expect(state.items).toEqual([1, 2]);
  });

  test("splice array", () => {
    const state = reactive({ items: ["a", "b", "c", "d"] });
    const node = {
      operator: "splice",
      target: { $ref: "#/state/items" },
      value: [1, 2],
    };
    void evaluateExpression(node, state, null);
    expect(state.items).toEqual(["a", "d"]);
  });

  test("assignment with event# ref", () => {
    const state = reactive({ name: "" });
    // A real Event whose `target` reads as an input holding "hello", as it does in a listener.
    const event = Object.defineProperty(new Event("input"), "target", {
      value: { value: "hello" },
    });
    const node = {
      operator: "=",
      target: { $ref: "#/state/name" },
      value: { $ref: "event#/target/value" },
    };
    void evaluateExpression(node, state, event);
    expect(state.name).toBe("hello");
  });

  test("assignment to nested path", () => {
    const state = reactive({ user: { name: "old" } });
    const node = {
      operator: "=",
      target: { $ref: "#/state/user/name" },
      value: "new",
    };
    void evaluateExpression(node, state, null);
    expect(state.user.name).toBe("new");
  });
});

describe("evaluateExpression — aggregates", () => {
  test("reduce: sum", () => {
    const state = reactive({ nums: [1, 2, 3, 4] });
    const node = {
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/nums" },
      value: {
        operator: "+",
        target: { $ref: "$reduce/acc" },
        value: { $ref: "$map/item" },
      },
    };
    expect(evaluateExpression(node, state, null)).toBe(10);
  });

  test("reduce: cart total (acc + price * qty)", () => {
    const state = reactive({
      cart: [
        { price: 10, qty: 2 },
        { price: 5, qty: 3 },
      ],
    });
    const node = {
      initial: 0,
      operator: "reduce",
      target: { $ref: "#/state/cart" },
      value: {
        operator: "+",
        target: { $ref: "$reduce/acc" },
        value: {
          operator: "*",
          target: { $ref: "$map/item/price" },
          value: { $ref: "$map/item/qty" },
        },
      },
    };
    expect(evaluateExpression(node, state, null)).toBe(35);
  });

  test("map: double each item", () => {
    const state = reactive({ nums: [1, 2, 3] });
    const node = {
      operator: "map",
      target: { $ref: "#/state/nums" },
      value: { operator: "*", target: { $ref: "$map/item" }, value: 2 },
    };
    expect(evaluateExpression(node, state, null)).toEqual([2, 4, 6]);
  });

  test("filter: keep items > 2", () => {
    const state = reactive({ nums: [1, 2, 3, 4] });
    const node = {
      operator: "filter",
      target: { $ref: "#/state/nums" },
      value: { operator: ">", target: { $ref: "$map/item" }, value: 2 },
    };
    expect(evaluateExpression(node, state, null)).toEqual([3, 4]);
  });
});

describe("buildScope — $expression (Shape 5)", () => {
  test("mutating expression becomes a handler function", async () => {
    const scope = await buildScope({
      state: {
        count: 0,
        increment: {
          $expression: {
            operator: "+=",
            target: { $ref: "#/state/count" },
            value: 1,
          },
        },
      },
    });
    expect(scope.increment).toBeTypeOf("function");
    fnOf(scope, "increment")(scope, null);
    expect(scope.count).toBe(1);
  });

  test("pure expression becomes a computed value", async () => {
    const scope = await buildScope({
      state: {
        a: 3,
        b: 4,
        sum: {
          $expression: {
            operator: "+",
            target: { $ref: "#/state/a" },
            value: { $ref: "#/state/b" },
          },
        },
      },
    });
    expect(scope.sum).toBe(7);
  });

  test("pure reduce expression is reactive", async () => {
    const scope = await buildScope({
      state: {
        nums: [1, 2, 3],
        total: {
          $expression: {
            initial: 0,
            operator: "reduce",
            target: { $ref: "#/state/nums" },
            value: {
              operator: "+",
              target: { $ref: "$reduce/acc" },
              value: { $ref: "$map/item" },
            },
          },
        },
      },
    });
    expect(scope.total).toBe(6);
    arrOf(scope, "nums").push(4);
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(scope.total).toBe(10);
  });

  test("named expression bound via $ref from event handler", async () => {
    const scope = await buildScope({
      state: {
        count: 0,
        increment: {
          $expression: {
            operator: "+=",
            target: { $ref: "#/state/count" },
            value: 1,
          },
        },
      },
    });
    const el = renderNode({ onclick: { $ref: "#/state/increment" }, tagName: "button" }, scope);
    el.dispatchEvent(new Event("click"));
    expect(scope.count).toBe(1);
  });

  test("inline $expression on event handler", async () => {
    const scope = await buildScope({ state: { count: 0 } });
    const el = renderNode(
      {
        onclick: {
          $expression: {
            operator: "+=",
            target: { $ref: "#/state/count" },
            value: 5,
          },
        },
        tagName: "button",
      },
      scope,
    );
    el.dispatchEvent(new Event("click"));
    expect(scope.count).toBe(5);
  });

  test("$expression not treated as plain object value", async () => {
    const scope = await buildScope({
      state: {
        on: false,
        toggle: {
          $expression: {
            operator: "=",
            target: { $ref: "#/state/on" },
            value: { operator: "!", target: { $ref: "#/state/on" } },
          },
        },
      },
    });
    expect(scope.toggle).toBeTypeOf("function");
    expect(scope.on).toBe(false);
    fnOf(scope, "toggle")(scope, null);
    expect(scope.on).toBe(true);
  });
});

// ─── Named formulas (call operator, spec §19.4c) ─────────────────────────────

describe("buildScope — named formulas", () => {
  test("parameterized pure entry becomes a callable, not a computed", async () => {
    const state = await buildScope(
      {
        state: {
          lineTotal: {
            $expression: {
              operator: "*",
              target: { $ref: "$args/price" },
              value: { $ref: "$args/qty" },
            },
            parameters: [{ name: "price" }, { name: "qty", default: 1 }],
          },
        },
      },
      {},
      BASE,
    );
    expect(state.lineTotal).toBeTypeOf("function");
    const lineTotal = fnOf(state, "lineTotal");
    expect(lineTotal(3, 4)).toBe(12);
    expect(lineTotal(5)).toBe(5);
  });

  test("call expression entries resolve scope callables reactively", async () => {
    const state = await buildScope(
      {
        state: {
          double: {
            $expression: {
              operator: "*",
              target: { $ref: "$args/n" },
              value: 2,
            },
            parameters: ["n"],
          },
          n: 10,
          result: {
            $expression: {
              operator: "call",
              target: { $ref: "#/state/double" },
              value: [{ $ref: "#/state/n" }],
            },
          },
        },
      },
      {},
      BASE,
    );
    expect(state.result).toBe(20);
    state.n = 21;
    expect(state.result).toBe(42);
  });
});

// ─── Structured function bodies (spec §20) ───────────────────────────────────

describe("buildScope — structured function bodies", () => {
  test("parameterless structured body becomes an event handler", async () => {
    const state = await buildScope(
      {
        state: {
          cart: [1],
          addOne: {
            $prototype: "Function",
            body: [{ operator: "push", target: { $ref: "#/state/cart" }, value: 2 }],
          },
        },
      },
      {},
      BASE,
    );
    expect(state.addOne).toBeTypeOf("function");
    fnOf(state, "addOne")(state, null);
    expect(state.cart).toEqual([1, 2]);
  });

  test("parameterized structured body is callable with positional args", async () => {
    const state = await buildScope(
      {
        state: {
          cart: [],
          addToCart: {
            $prototype: "Function",
            parameters: ["item"],
            body: [
              { operator: "push", target: { $ref: "#/state/cart" }, value: { $ref: "$args/item" } },
            ],
          },
        },
      },
      {},
      BASE,
    );
    await statementsFnOf(state, "addToCart")("apple");
    expect(state.cart).toEqual(["apple"]);
  });
});

describe("renderNode — §13 $ref-child diagnostic", () => {
  test("warns once for a node-level $ref child and renders an empty div", async () => {
    const state = await buildScope({}, {}, BASE);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const el = renderNode({ $ref: "./components/card.json" }, state);
      expect(el.tagName).toBe("DIV");
      expect(el.childNodes.length).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("$elements");
      // Second render of the same $ref does not warn again (dedup).
      _renderNode({ $ref: "./components/card.json" }, state);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Jx — $schema version guard", () => {
  test("warns once for a document declaring a newer hosted $schema", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const target = document.createElement("div");
      await Jx({ $schema: "https://jxsuite.com/schema/v2", tagName: "div" }, target);
      const called = warn.mock.calls.some((c) => String(c[0]).includes("v2"));
      expect(called).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("enumeratedAttrNames — the compiler's copy of the family rule", () => {
  test("names exactly the three HTML enumerated attributes, sorted", () => {
    expect(enumeratedAttrNames()).toEqual(["contenteditable", "draggable", "spellcheck"]);
  });

  test("every name it returns is treated as enumerated by booleanAttrValue", () => {
    for (const name of enumeratedAttrNames()) {
      expect(booleanAttrValue(name, true)).toBe("true");
      expect(booleanAttrValue(name, false)).toBe("false");
    }
  });

  test('popover is deliberately absent — popover="true" is invalid and means manual', () => {
    expect(enumeratedAttrNames()).not.toContain("popover");
    expect(booleanAttrValue("popover", true)).toBe("");
    expect(booleanAttrValue("popover", false)).toBeNull();
  });
});

describe("applyStyle — declaration-body at-rules", () => {
  test("@position-try emits its declarations with no element scope", () => {
    const el = document.createElement("nav");
    document.body.append(el);
    applyStyle(el, {
      "@position-try --flip-up": { insetBlockStart: "auto" },
      positionAnchor: "--btn",
    });
    /* Hoisted, not scoped: the name it declares is document-global, so it is written once for the
       whole document rather than once per element that mentions it. */
    const css = adoptedCSS();
    expect(css).toContain("@position-try --flip-up { inset-block-start: auto }");
    // The defect: a `[data-jx=…]` selector inside kills the whole block, silently.
    expect(css).not.toContain("@position-try --flip-up { [data-jx");
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { position-anchor: --btn }`);
  });

  test("@media still scopes its rules to the element", () => {
    const el = document.createElement("div");
    document.body.append(el);
    applyStyle(el, { "@(min-width: 40rem)": { color: "red" } });
    expect(elementCSS(el)).toContain("@media (min-width: 40rem) { [data-jx=");
  });

  test("isDeclarationAtRule knows the four, and rejects every other body shape", () => {
    for (const key of ["@position-try --x", "@property --y", "@font-face", "@counter-style c"]) {
      expect(isDeclarationAtRule(key)).toBe(true);
    }
    for (const key of ["@media screen", "@supports (x: y)", "@starting-style"]) {
      expect(isDeclarationAtRule(key)).toBe(false);
    }
    /* `@keyframes` is a THIRD shape rather than a rule-bodied one — its children are keyframe
       selectors, not element selectors — so it has its own predicate and its own serializer.
       Adding it here instead would emit nothing at all: every child of the block is a block,
       `declarationsOf` skips blocks, and a rule with no declarations is never written. */
    expect(isDeclarationAtRule("@keyframes spin")).toBe(false);
    expect(isKeyframesAtRule("@keyframes spin")).toBe(true);
  });
});
