import { GlobalRegistrator } from "@happy-dom/global-registrator";
try {
  GlobalRegistrator.register();
} catch {
  /* already registered */
}

import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { reactive, ref, computed, effect, isRef } from "@vue/reactivity";
import {
  resolve,
  buildScope,
  renderNode,
  applyStyle,
  resolveRef,
  resolvePrototype,
  isSignal,
  camelToKebab,
  toCSSText,
  RESERVED_KEYS,
  JSONsx,
} from "../runtime.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const wait = () => new Promise((r) => setTimeout(r, 0));

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
    expect(toCSSText({ color: "blue", ":hover": { color: "red" }, ".child": {} })).toBe(
      "color: blue",
    );
  });
  test("empty object", () => expect(toCSSText({})).toBe(""));
});

// ─── RESERVED_KEYS ────────────────────────────────────────────────────────────

describe("RESERVED_KEYS", () => {
  test("is a Set", () => expect(RESERVED_KEYS).toBeInstanceOf(Set));

  const required = [
    "$schema",
    "$id",
    "$defs",
    "$ref",
    "$props",
    "$switch",
    "$prototype",
    "$media",
    "$map",
    "$src",
    "$export",
    "signal",
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
    "arguments",
    "name",
  ];
  for (const k of required) {
    test(`contains "${k}"`, () => expect(RESERVED_KEYS.has(k)).toBe(true));
  }

  const removed = ["$handlers", "$handler", "$compute", "$deps"];
  for (const k of removed) {
    test(`does NOT contain "${k}"`, () => expect(RESERVED_KEYS.has(k)).toBe(false));
  }
});

// ─── resolveRef ───────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  const $defs = reactive({
    count: 5,
    name: "Alice",
  });
  // Simulate a child scope with $map
  const child = Object.create($defs);
  child.$map = { item: { text: "hello", nested: { deep: 42 } }, index: 3 };
  child["$map/item"] = child.$map.item;
  child["$map/index"] = child.$map.index;

  test("non-string returns as-is", () => expect(resolveRef(42, $defs)).toBe(42));
  test("#/$defs/ prefix resolves from scope", () => {
    expect(resolveRef("#/$defs/count", $defs)).toBe(5);
  });
  test("parent#/ prefix resolves from scope", () => {
    expect(resolveRef("parent#/name", $defs)).toBe("Alice");
  });
  test("window#/ resolves global window property", () => {
    window._testProp = "win";
    expect(resolveRef("window#/_testProp", $defs)).toBe("win");
    delete window._testProp;
  });
  test("document#/ resolves global document property", () => {
    document._testProp = "doc";
    expect(resolveRef("document#/_testProp", $defs)).toBe("doc");
    delete document._testProp;
  });
  test("$map/item resolves map item", () => {
    expect(resolveRef("$map/item", child)).toEqual({ text: "hello", nested: { deep: 42 } });
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
    expect(resolveRef("nonexistent", $defs)).toBeNull();
  });
  test("bare key resolves from scope", () => {
    expect(resolveRef("name", $defs)).toBe("Alice");
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
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payload),
      }),
    );
    const result = await resolve("http://example.com/comp.json");
    expect(result).toEqual(payload);
  });

  test("throws on non-ok response", async () => {
    global.fetch = mock(() => Promise.resolve({ ok: false, status: 404 }));
    await expect(resolve("http://example.com/missing.json")).rejects.toThrow("404");
  });
});

// ─── buildScope — Five-Shape $defs Grammar ───────────────────────────────────

describe("buildScope", () => {
  const BASE = "http://localhost/";

  test("returns empty scope for empty doc", async () => {
    const $defs = await buildScope({}, {}, BASE);
    expect(Object.keys($defs).length).toBe(0);
  });

  // Shape 1: Naked values → reactive property
  test("Shape 1: string → reactive property", async () => {
    const $defs = await buildScope({ $defs: { name: "hello" } }, {}, BASE);
    expect($defs.name).toBe("hello");
  });

  test("Shape 1: number → reactive property", async () => {
    const $defs = await buildScope({ $defs: { count: 42 } }, {}, BASE);
    expect($defs.count).toBe(42);
  });

  test("Shape 1: boolean → reactive property", async () => {
    const $defs = await buildScope({ $defs: { flag: false } }, {}, BASE);
    expect($defs.flag).toBe(false);
  });

  test("Shape 1: null → reactive property", async () => {
    const $defs = await buildScope({ $defs: { x: null } }, {}, BASE);
    expect($defs.x).toBeNull();
  });

  test("Shape 1: array → reactive property", async () => {
    const $defs = await buildScope({ $defs: { items: [1, 2, 3] } }, {}, BASE);
    expect($defs.items).toEqual([1, 2, 3]);
  });

  test("Shape 1: plain object → reactive property", async () => {
    const $defs = await buildScope({ $defs: { cfg: { x: 1, y: 2 } } }, {}, BASE);
    expect($defs.cfg).toEqual({ x: 1, y: 2 });
  });

  // Reactivity test
  test("Shape 1: reactive property tracks mutations", async () => {
    const $defs = await buildScope({ $defs: { count: 0 } }, {}, BASE);
    let observed;
    effect(() => {
      observed = $defs.count;
    });
    expect(observed).toBe(0);
    $defs.count = 42;
    await wait();
    expect(observed).toBe(42);
  });

  test("Shape 1: array reactive property tracks push", async () => {
    const $defs = await buildScope({ $defs: { items: [1, 2] } }, {}, BASE);
    let length;
    effect(() => {
      length = $defs.items.length;
    });
    expect(length).toBe(2);
    $defs.items.push(3);
    await wait();
    expect(length).toBe(3);
  });

  // Shape 2: Expanded signal with default
  test("Shape 2: object with default → reactive property initialized to default", async () => {
    const $defs = await buildScope({ $defs: { count: { type: "integer", default: 7 } } }, {}, BASE);
    expect($defs.count).toBe(7);
  });

  // Shape 2b: Pure type definition
  test("Shape 2b: object with only schema keywords → skipped", async () => {
    const $defs = await buildScope(
      { $defs: { email: { type: "string", format: "email" } } },
      {},
      BASE,
    );
    expect($defs.email).toBeUndefined();
  });

  // Shape 3: Template string → computed
  test("Shape 3: string with ${} → computed", async () => {
    const $defs = await buildScope(
      {
        $defs: {
          count: 5,
          label: "${$defs.count} items",
        },
      },
      {},
      BASE,
    );
    expect($defs.label).toBe("5 items");
  });

  test("Shape 3: computed updates when dependency changes", async () => {
    const $defs = await buildScope(
      {
        $defs: {
          count: 5,
          label: "${$defs.count} items",
        },
      },
      {},
      BASE,
    );
    expect($defs.label).toBe("5 items");
    $defs.count = 10;
    expect($defs.label).toBe("10 items");
  });

  // Shape 4: $prototype: "Function" with body
  test("Shape 4: Function with body → callable function", async () => {
    const $defs = await buildScope(
      {
        $defs: {
          count: 0,
          increment: { $prototype: "Function", body: "$defs.count++" },
        },
      },
      {},
      BASE,
    );
    expect(typeof $defs.increment).toBe("function");
    $defs.increment($defs);
    expect($defs.count).toBe(1);
  });

  test("Shape 4: Function with body and signal:true → computed", async () => {
    const $defs = await buildScope(
      {
        $defs: {
          n: 3,
          doubled: { $prototype: "Function", body: "return $defs.n * 2", signal: true },
        },
      },
      {},
      BASE,
    );
    expect($defs.doubled).toBe(6);
    $defs.n = 5;
    expect($defs.doubled).toBe(10);
  });

  test("Shape 4: Function with $src → loads external function", async () => {
    const srcUrl = new URL("./_test_handlers_fn.js", import.meta.url).href;
    const $defs = await buildScope(
      {
        $defs: {
          myFn: { $prototype: "Function", $src: srcUrl },
        },
      },
      {},
      BASE,
    );
    expect(typeof $defs.myFn).toBe("function");
  });

  test("Shape 4: Function with both body and $src → throws", async () => {
    await expect(
      buildScope(
        {
          $defs: {
            bad: { $prototype: "Function", body: "return 1;", $src: "./foo.js" },
          },
        },
        {},
        BASE,
      ),
    ).rejects.toThrow("mutually exclusive");
  });

  test("Shape 4: Function with neither body nor $src → throws", async () => {
    await expect(
      buildScope(
        {
          $defs: {
            bad: { $prototype: "Function" },
          },
        },
        {},
        BASE,
      ),
    ).rejects.toThrow("no body or $src");
  });

  // Shape 5: External class $prototype
  test("Shape 5: $prototype other than Function → resolvePrototype", async () => {
    const doc = { $defs: { items: { $prototype: "Set", default: [1, 2] } } };
    const $defs = await buildScope(doc, {}, BASE);
    expect($defs.items).toBeInstanceOf(Set);
  });

  // Scope merging
  test("merges parentScope", async () => {
    const parent = { existing: "from-parent" };
    const $defs = await buildScope({}, parent, BASE);
    expect($defs.existing).toBe("from-parent");
  });

  test("stores $media in scope", async () => {
    const doc = { $media: { "--md": "(min-width: 768px)" } };
    const $defs = await buildScope(doc, {}, BASE);
    expect($defs["$media"]).toEqual({ "--md": "(min-width: 768px)" });
  });
});

// ─── applyStyle ───────────────────────────────────────────────────────────────

describe("applyStyle", () => {
  let el;
  beforeEach(() => {
    el = document.createElement("div");
    document.head.querySelectorAll("style").forEach((s) => s.remove());
  });

  test("sets inline style properties", () => {
    applyStyle(el, { color: "red", fontSize: "14px" });
    expect(el.style.color).toBe("red");
    expect(el.style.fontSize).toBe("14px");
  });

  test("empty style object — no side effects", () => {
    applyStyle(el, {});
    expect(el.dataset.jsonsx).toBeUndefined();
    expect(document.head.querySelectorAll("style").length).toBe(0);
  });

  test("emits scoped <style> for :pseudo selector", () => {
    applyStyle(el, { ":hover": { color: "blue" } });
    expect(el.dataset.jsonsx).toBeDefined();
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector("style");
    expect(style).not.toBeNull();
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"] :hover`);
    expect(style.textContent).toContain("color: blue");
  });

  test("emits scoped <style> for .class selector", () => {
    applyStyle(el, { ".child": { marginTop: "4px" } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"] .child`);
  });

  test("emits scoped <style> for &.compound selector", () => {
    applyStyle(el, { "&.active": { fontWeight: "bold" } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"].active`);
  });

  test("emits scoped <style> for [attr] selector", () => {
    applyStyle(el, { "[disabled]": { opacity: "0.5" } });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"][disabled]`);
  });

  test("resolves named @--breakpoint from mediaQueries", () => {
    applyStyle(el, { "@--md": { fontSize: "18px" } }, { "--md": "(min-width: 768px)" });
    const uid = el.dataset.jsonsx;
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain("@media (min-width: 768px)");
    expect(style.textContent).toContain(`[data-jsonsx="${uid}"]`);
    expect(style.textContent).toContain("font-size: 18px");
  });

  test("uses literal condition for @(min-width:...) keys", () => {
    applyStyle(el, { "@(min-width: 1024px)": { padding: "2rem" } });
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain("@media (min-width: 1024px)");
  });

  test("falls back to raw name when @--name not found in mediaQueries", () => {
    applyStyle(el, { "@--xl": { gap: "2rem" } }, {});
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain("@media --xl");
  });

  test("combined inline + nested + media", () => {
    applyStyle(
      el,
      { color: "green", ":focus": { outline: "2px solid blue" }, "@--sm": { color: "red" } },
      { "--sm": "(min-width: 640px)" },
    );
    expect(el.style.color).toBe("green");
    const style = document.head.querySelector("style");
    expect(style.textContent).toContain("] :focus");
    expect(style.textContent).toContain("@media (min-width: 640px)");
  });

  test("nested selector inside media block", () => {
    applyStyle(
      el,
      { "@--md": { fontSize: "2rem", ":hover": { color: "blue" } } },
      { "--md": "(min-width: 768px)" },
    );
    const style = document.head.querySelector("style");
    const css = style.textContent;
    // Media block flat props
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain("font-size: 2rem");
    // Nested selector within media
    expect(css).toMatch(/@media \(min-width: 768px\) \{ \[data-jsonsx="[^"]+"\] :hover \{ color: blue \} \}/);
  });

  test("& compound selector inside media block", () => {
    applyStyle(
      el,
      { "@--sm": { "&.active": { fontWeight: "bold" } } },
      { "--sm": "(min-width: 640px)" },
    );
    const style = document.head.querySelector("style");
    const css = style.textContent;
    expect(css).toMatch(/@media \(min-width: 640px\) \{ \[data-jsonsx="[^"]+"\]\.active \{ font-weight: bold \} \}/);
  });
});

// ─── resolvePrototype ─────────────────────────────────────────────────────────

describe("resolvePrototype", () => {
  test("Request: returns ref, starts null, fetches and sets data", async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      }),
    );
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "Request", url: "/api/test" },
      $defs,
      "data",
    );
    $defs.data = result;
    expect(isRef(result)).toBe(true);
    await wait();
    expect($defs.data).toEqual({ id: 1 });
  });

  test("Request: manual:true does not auto-fetch", async () => {
    const fetchMock = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    global.fetch = fetchMock;
    const $defs = reactive({});
    await resolvePrototype({ $prototype: "Request", url: "/api/x", manual: true }, $defs, "x");
    await wait();
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  test("Request: sets error on non-ok response", async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        statusText: "Not Found",
        json: () => Promise.resolve({}),
      }),
    );
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Request", url: "/api/z" }, $defs, "z");
    $defs.z = result;
    await wait();
    expect($defs.z).toHaveProperty("error");
  });

  test("Request: POST with headers and body", async () => {
    let captured;
    global.fetch = mock((_url, opts) => {
      captured = opts;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const $defs = reactive({});
    await resolvePrototype(
      { $prototype: "Request", url: "/api", method: "POST", headers: { x: "1" }, body: { a: 1 } },
      $defs,
      "r",
    );
    await wait();
    expect(captured.method).toBe("POST");
    expect(captured.headers).toEqual({ x: "1" });
    expect(captured.body).toBe('{"a":1}');
  });

  test("URLSearchParams: returns computed ref", async () => {
    const $defs = reactive({ q: "hello" });
    const result = await resolvePrototype(
      { $prototype: "URLSearchParams", q: { $ref: "#/$defs/q" } },
      $defs,
      "params",
    );
    expect(isRef(result)).toBe(true);
  });

  test("LocalStorage: reads existing value", async () => {
    localStorage.setItem("lsKey", JSON.stringify(99));
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", key: "lsKey" },
      $defs,
      "ls",
    );
    $defs.ls = result;
    expect($defs.ls).toBe(99);
    localStorage.removeItem("lsKey");
  });

  test("LocalStorage: defaults to def.default when key absent", async () => {
    localStorage.removeItem("lsMissing");
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", key: "lsMissing", default: "fallback" },
      $defs,
      "ls",
    );
    $defs.ls = result;
    expect($defs.ls).toBe("fallback");
  });

  test("LocalStorage: assignment persists to storage", async () => {
    localStorage.removeItem("lsPersist");
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "LocalStorage", key: "lsPersist", default: 0 },
      $defs,
      "ls",
    );
    $defs.ls = result;
    $defs.ls = 123;
    await wait();
    expect(JSON.parse(localStorage.getItem("lsPersist"))).toBe(123);
    localStorage.removeItem("lsPersist");
  });

  test("SessionStorage: reads and writes session storage", async () => {
    sessionStorage.setItem("ssKey", JSON.stringify("hello"));
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "SessionStorage", key: "ssKey" },
      $defs,
      "ss",
    );
    $defs.ss = result;
    expect($defs.ss).toBe("hello");
    $defs.ss = "world";
    await wait();
    expect(JSON.parse(sessionStorage.getItem("ssKey"))).toBe("world");
    sessionStorage.removeItem("ssKey");
  });

  test("Cookie: reads, writes cookie", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype(
      {
        $prototype: "Cookie",
        name: "testCookie",
        default: null,
        maxAge: 3600,
        path: "/",
      },
      $defs,
      "ck",
    );
    $defs.ck = result;
    expect($defs.ck).toBeNull();
    $defs.ck = { user: "bob" };
    await wait();
    expect($defs.ck).toEqual({ user: "bob" });
  });

  test("IndexedDB: returns ref", async () => {
    const fakeReq = { onupgradeneeded: null, onsuccess: null, onerror: null };
    global.indexedDB = { open: () => fakeReq };
    const $defs = reactive({});
    const result = await resolvePrototype(
      {
        $prototype: "IndexedDB",
        database: "testDB",
        store: "items",
      },
      $defs,
      "db",
    );
    expect(isRef(result)).toBe(true);
    delete global.indexedDB;
  });

  test("Set: returns a Set", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Set" }, $defs, "s");
    $defs.s = result;
    expect($defs.s).toBeInstanceOf(Set);
    expect($defs.s.size).toBe(0);
  });

  test("Set: default values", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Set", default: [1, 2] }, $defs, "s");
    $defs.s = result;
    expect($defs.s.has(1)).toBe(true);
  });

  test("Map: returns a Map", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Map" }, $defs, "m");
    $defs.m = result;
    expect($defs.m).toBeInstanceOf(Map);
  });

  test("Map: default object", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Map", default: { a: 1 } }, $defs, "m");
    $defs.m = result;
    expect($defs.m.get("a")).toBe(1);
  });

  test("FormData: returns FormData", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "FormData", fields: { name: "Alice" } },
      $defs,
      "fd",
    );
    expect(result).toBeInstanceOf(FormData);
    expect(result.get("name")).toBe("Alice");
  });

  test("Blob: returns Blob", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype(
      { $prototype: "Blob", parts: ["hello"], type: "text/plain" },
      $defs,
      "b",
    );
    expect(result).toBeInstanceOf(Blob);
  });

  test("ReadableStream: returns null", async () => {
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "ReadableStream" }, $defs, "rs");
    expect(result).toBeNull();
  });

  test("unknown $prototype: warns and returns ref(null)", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const $defs = reactive({});
    const result = await resolvePrototype({ $prototype: "Unknown" }, $defs, "u");
    expect(isRef(result)).toBe(true);
    expect(result.value).toBeNull();
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
    const el = renderNode({ tagName: "button", disabled: true }, reactive({}));
    expect(el.disabled).toBe(true);
  });

  test("sets reactive property from $ref", async () => {
    const $defs = reactive({ msg: "initial" });
    const el = renderNode({ tagName: "span", textContent: { $ref: "#/$defs/msg" } }, $defs);
    expect(el.textContent).toBe("initial");
    $defs.msg = "updated";
    await wait();
    expect(el.textContent).toBe("updated");
  });

  test("sets non-reactive property from plain value $ref", () => {
    const $defs = reactive({ label: "static" });
    const el = renderNode({ tagName: "span", textContent: { $ref: "#/$defs/label" } }, $defs);
    expect(el.textContent).toBe("static");
  });

  test("protected id property: set once, not reactive", () => {
    const $defs = reactive({ myId: "my-id" });
    const el = renderNode({ tagName: "div", id: { $ref: "#/$defs/myId" } }, $defs);
    expect(el.id).toBe("my-id");
  });

  test("binds event handler via onclick $ref", async () => {
    const $defs = reactive({ count: 0 });
    $defs.clickHandler = function ($defs) {
      $defs.count++;
    };
    const el = renderNode({ tagName: "button", onclick: { $ref: "#/$defs/clickHandler" } }, $defs);
    el.dispatchEvent(new Event("click"));
    expect($defs.count).toBe(1);
  });

  test("ignores handler $ref when not a function", () => {
    const $defs = reactive({ notFn: 42 });
    expect(() =>
      renderNode({ tagName: "div", onclick: { $ref: "#/$defs/notFn" } }, $defs),
    ).not.toThrow();
  });

  test("applies attributes", () => {
    const el = renderNode({ tagName: "div", attributes: { "data-x": "val" } }, reactive({}));
    expect(el.getAttribute("data-x")).toBe("val");
  });

  test("applies reactive attribute from $ref", async () => {
    const $defs = reactive({ cls: "a" });
    const el = renderNode(
      { tagName: "div", attributes: { "data-cls": { $ref: "#/$defs/cls" } } },
      $defs,
    );
    expect(el.getAttribute("data-cls")).toBe("a");
    $defs.cls = "b";
    await wait();
    expect(el.getAttribute("data-cls")).toBe("b");
  });

  test("applies static attribute from plain $ref", () => {
    const $defs = reactive({ val: "hello" });
    const el = renderNode(
      { tagName: "div", attributes: { "aria-label": { $ref: "#/$defs/val" } } },
      $defs,
    );
    expect(el.getAttribute("aria-label")).toBe("hello");
  });

  // Template string ${} tests
  test("${} template string in textContent renders reactively", async () => {
    const $defs = reactive({ count: 5 });
    const el = renderNode({ tagName: "span", textContent: "${$defs.count} items" }, $defs);
    expect(el.textContent).toBe("5 items");
    $defs.count = 10;
    await wait();
    expect(el.textContent).toBe("10 items");
  });

  test("${} template string in className", async () => {
    const $defs = reactive({ active: true });
    const el = renderNode(
      { tagName: "div", className: '${$defs.active ? "active" : "inactive"}' },
      $defs,
    );
    expect(el.className).toBe("active");
    $defs.active = false;
    await wait();
    expect(el.className).toBe("inactive");
  });

  test("renders children recursively", () => {
    const el = renderNode(
      {
        tagName: "ul",
        children: [
          { tagName: "li", textContent: "A" },
          { tagName: "li", textContent: "B" },
        ],
      },
      reactive({}),
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0].textContent).toBe("A");
    expect(el.children[1].textContent).toBe("B");
  });

  test("$switch renders correct case", () => {
    const $defs = reactive({ route: "about" });
    const el = renderNode(
      {
        tagName: "div",
        $switch: { $ref: "#/$defs/route" },
        cases: {
          home: { tagName: "section", textContent: "Home" },
          about: { tagName: "section", textContent: "About" },
        },
      },
      $defs,
    );
    expect(el.textContent).toBe("About");
  });

  test("$switch reacts to change", async () => {
    const $defs = reactive({ route: "home" });
    const el = renderNode(
      {
        tagName: "div",
        $switch: { $ref: "#/$defs/route" },
        cases: {
          home: { tagName: "div", textContent: "Home" },
          about: { tagName: "div", textContent: "About" },
        },
      },
      $defs,
    );
    expect(el.textContent).toBe("Home");
    $defs.route = "about";
    await wait();
    expect(el.textContent).toBe("About");
  });

  test("$switch with missing case renders empty", () => {
    const $defs = reactive({ route: "404" });
    const el = renderNode(
      {
        tagName: "div",
        $switch: { $ref: "#/$defs/route" },
        cases: { home: { tagName: "div", textContent: "Home" } },
      },
      $defs,
    );
    expect(el.textContent).toBe("");
  });

  test("Array map renders static items", () => {
    const el = renderNode(
      {
        tagName: "ul",
        children: {
          $prototype: "Array",
          items: [{ id: 1, label: "X" }],
          map: { tagName: "li" },
        },
      },
      reactive({}),
    );
    expect(el.children.length).toBe(1);
  });

  test("Array map re-renders on reactive change", async () => {
    const $defs = reactive({ list: [{ v: "a" }, { v: "b" }] });
    const el = renderNode(
      {
        tagName: "ul",
        children: {
          $prototype: "Array",
          items: { $ref: "#/$defs/list" },
          map: { tagName: "li" },
        },
      },
      $defs,
    );
    expect(el.children.length).toBe(2);
    $defs.list = [{ v: "x" }];
    await wait();
    expect(el.children.length).toBe(1);
  });

  test("Array map grows with push", async () => {
    const $defs = reactive({ list: [1, 2] });
    const el = renderNode(
      {
        tagName: "div",
        children: {
          $prototype: "Array",
          items: { $ref: "#/$defs/list" },
          map: { tagName: "span" },
        },
      },
      $defs,
    );
    expect(el.children.length).toBe(2);
    $defs.list.push(3);
    await wait();
    expect(el.children.length).toBe(3);
  });

  test("Array map with filter", () => {
    const $defs = reactive({
      list: [1, 2, 3, 4],
      isEven: (x) => x % 2 === 0,
    });
    const el = renderNode(
      {
        tagName: "div",
        children: {
          $prototype: "Array",
          items: { $ref: "#/$defs/list" },
          filter: { $ref: "#/$defs/isEven" },
          map: { tagName: "span" },
        },
      },
      $defs,
    );
    expect(el.children.length).toBe(2);
  });

  test("Array map with sort", () => {
    const $defs = reactive({
      list: [3, 1, 2],
      sortAsc: (a, b) => a - b,
    });
    const el = renderNode(
      {
        tagName: "div",
        children: {
          $prototype: "Array",
          items: { $ref: "#/$defs/list" },
          sort: { $ref: "#/$defs/sortAsc" },
          map: { tagName: "span" },
        },
      },
      $defs,
    );
    expect(el.children.length).toBe(3);
  });

  test("Array map: items not an array returns empty", () => {
    const $defs = reactive({ list: null });
    const el = renderNode(
      {
        tagName: "div",
        children: {
          $prototype: "Array",
          items: { $ref: "#/$defs/list" },
          map: { tagName: "span" },
        },
      },
      $defs,
    );
    expect(el.children.length).toBe(0);
  });

  test("$props merges into scope", () => {
    const $defs = reactive({ count: 10 });
    const def = {
      tagName: "span",
      $props: { val: { $ref: "#/$defs/count" } },
      textContent: "ok",
    };
    const el = renderNode(def, $defs);
    expect(el.textContent).toBe("ok");
  });

  test("style object applied", () => {
    const el = renderNode({ tagName: "div", style: { color: "green" } }, reactive({}));
    expect(el.style.color).toBe("green");
  });
});

// ─── JSONsx (top-level mount) ─────────────────────────────────────────────────

describe("JSONsx", () => {
  test("mounts object doc into target", async () => {
    const target = document.createElement("div");
    await JSONsx({ tagName: "span", textContent: "mounted" }, target);
    expect(target.children[0].tagName.toLowerCase()).toBe("span");
    expect(target.children[0].textContent).toBe("mounted");
  });

  test("returns scope with naked value property", async () => {
    const target = document.createElement("div");
    const $defs = await JSONsx({ tagName: "div", $defs: { x: 1 } }, target);
    expect($defs.x).toBe(1);
  });

  test("returns scope with expanded signal property", async () => {
    const target = document.createElement("div");
    const $defs = await JSONsx({ tagName: "div", $defs: { x: { default: 5 } } }, target);
    expect($defs.x).toBe(5);
  });

  test("calls onMount if present in scope", async () => {
    const target = document.createElement("div");
    const srcUrl = new URL("./_test_handlers.js", import.meta.url).href;
    await JSONsx(
      {
        tagName: "div",
        $defs: {
          onMount: { $prototype: "Function", $src: srcUrl },
        },
      },
      target,
    );
    await wait();
    expect(globalThis._testMounted).toBe(true);
    delete globalThis._testMounted;
  });

  test("fetches string source", async () => {
    const doc = { tagName: "article" };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(doc),
      }),
    );
    const target = document.createElement("div");
    await JSONsx("http://example.com/test.json", target);
    expect(target.children[0].tagName.toLowerCase()).toBe("article");
  });

  test("defaults target to document.body", async () => {
    const before = document.body.children.length;
    await JSONsx({ tagName: "div" });
    expect(document.body.children.length).toBe(before + 1);
  });
});
