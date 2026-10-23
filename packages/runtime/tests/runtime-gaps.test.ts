import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { isRef, reactive } from "@vue/reactivity";
import {
  applyStyle,
  buildScope,
  Jx,
  reapplyStyle,
  renderNode as _renderNode,
  resetDocumentStyles,
  resolvePrototype,
  resolveRef,
  setTemplateErrorHandler,
} from "../src/runtime";
import type { JsonValue, JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxPath } from "../src/types.ts";
import { adoptedCSS, elementCSS } from "./style-text.ts";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** Every definition these tests render is an element, so a Text result is a runtime regression. */
function renderNode(...args: Parameters<typeof _renderNode>): HTMLElement {
  const node = _renderNode(...args);
  if (!(node instanceof HTMLElement)) {
    throw new TypeError("renderNode returned a Text node for an element definition");
  }
  return node;
}

/** Install `respond` as `fetch`, keeping Bun's `preconnect` so the stub is a whole `fetch`. */
function stubFetch(respond: (url: string) => Promise<Response>) {
  const { preconnect } = fetch;
  const handler = mock((input: RequestInfo | URL) => respond(String(input)));
  globalThis.fetch = Object.assign(handler, { preconnect });
  return handler;
}

/** A successful JSON response, the way the runtime's `$ref` and Request loaders read one. */
const jsonResponse = (body: JsonValue) => Promise.resolve(Response.json(body));

const wait = (ms = 0) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ─── renderNode: text nodes & local $-bindings ───────────────────────────────

describe("renderNode text nodes", () => {
  test("bare string/number/boolean children become text nodes", () => {
    /* SAFETY: the document type narrows children to elements and strings, but each child goes
       through renderNode, whose own signature accepts number and boolean definitions and renders
       them as Text; this test pins that runtime tolerance for hand-built definitions. */
    const def = { children: ["hi", 5, true], tagName: "div" } as JxElement;
    const el = renderNode(def, reactive({}));
    expect(el.childNodes.length).toBe(3);
    expect(el.childNodes[0]!.textContent).toBe("hi");
    expect(el.childNodes[1]!.textContent).toBe("5");
    expect(el.childNodes[2]!.textContent).toBe("true");
  });

  test("template string child is reactive", async () => {
    const state = reactive({ msg: "first" });
    const el = renderNode({ children: ["${state.msg}"], tagName: "div" }, state);
    expect(el.textContent).toBe("first");
    state.msg = "second";
    await wait();
    expect(el.textContent).toBe("second");
  });

  test("$-prefixed local bindings extend scope ($ref and literal)", async () => {
    const state = reactive({ x: "from-state" });
    const el = renderNode(
      {
        $bar: "literal",
        $foo: { $ref: "#/state/x" },
        children: ["${state.$foo}-${state.$bar}"],
        tagName: "div",
      },
      state,
    );
    expect(el.textContent).toBe("from-state-literal");
  });

  test("onNodeCreated fires with element, path, def, state", () => {
    const seen: { path: JxPath; tag: string }[] = [];
    const el = renderNode({ children: [{ tagName: "span" }], tagName: "div" }, reactive({}), {
      onNodeCreated: (node, path) => {
        seen.push({ path, tag: node.nodeName.toLowerCase() });
      },
    });
    expect(el.tagName.toLowerCase()).toBe("div");
    expect(seen.length).toBe(2);
    expect(seen[0]!.tag).toBe("div");
    expect(seen[1]!.tag).toBe("span");
    expect(seen[1]!.path).toEqual(["children", 0]);
  });
});

// ─── applyProperties: inline handlers ─────────────────────────────────────────

describe("inline event handlers", () => {
  test("inline $prototype Function handler is wired", () => {
    const state = reactive({ clicked: false });
    const el = renderNode(
      {
        onclick: {
          $prototype: "Function",
          body: "state.clicked = true;",
          parameters: ["event"],
        },
        tagName: "button",
      },
      state,
    );
    el.dispatchEvent(new Event("click"));
    expect(state.clicked).toBe(true);
  });

  test("inline $expression handler is wired", () => {
    const state = reactive({ count: 0 });
    const el = renderNode(
      {
        onclick: {
          $expression: { operator: "+=", target: { $ref: "#/state/count" }, value: 1 },
        },
        tagName: "button",
      },
      state,
    );
    el.dispatchEvent(new Event("click"));
    el.dispatchEvent(new Event("click"));
    expect(state.count).toBe(2);
  });

  test("on*-keyed value that is not a handler shape falls through to property binding", () => {
    const el = renderNode({ onfake: "not-a-handler", tagName: "div" }, reactive({}));
    expect(el).toHaveProperty("onfake", "not-a-handler");
  });
});

// ─── applyAttributes: template strings ───────────────────────────────────────

describe("applyAttributes template strings", () => {
  test("template attribute is reactive", async () => {
    const state = reactive({ t: "one" });
    const el = renderNode({ attributes: { title: "${state.t}" }, tagName: "div" }, state);
    expect(el.getAttribute("title")).toBe("one");
    state.t = "two";
    await wait();
    expect(el.getAttribute("title")).toBe("two");
  });
});

// ─── applyStyle: template strings, nested-in-nested, media ───────────────────

describe("applyStyle gaps", () => {
  test("a template value becomes a var() the rule reads and an effect writes", async () => {
    /* The indirection is what lets a reactive declaration live in a RULE. The rule text is static,
       so it is never mutated on an update — the effect writes one inline custom property, which is
       12.4ms per 300 edits against 84.5ms for tearing the rule down and rebuilding it, and it does
       not degrade as the sheet grows. It is also what makes `${…}` work inside `:hover` at all. */
    const state = reactive({ c: "red" });
    const el = document.createElement("div");
    document.body.append(el);
    applyStyle(el, { ":hover": { color: "${state.c}" }, "--accent": "${state.c}" }, {}, state);
    const uid = el.dataset.jx;
    /* The `:hover` declaration keeps the indirection, because a rule is where it has to live.
       `--accent` does NOT: a reactive value on a custom property, in a rule targeting the element
       itself, is written inline under the AUTHOR'S name and emits no declaration. That keeps
       everything per-element out of the rule text, so two elements styled alike share one interned
       rule. The `:hover` rule targets the element itself too, so its variable is named by position
       alone (`--jx-s0`), with no per-element serial to keep it from interning either. */
    expect(elementCSS(el).split("\n")).toEqual([
      `[data-jx="${uid}"]:hover { color: var(--jx-s0) }`,
    ]);
    expect(el.style.getPropertyValue("--accent")).toBe("red");
    expect(el.style.cssText).toContain("--jx-s0: red");
    state.c = "blue";
    await wait();
    expect(el.style.getPropertyValue("--accent")).toBe("blue");
    expect(el.style.getPropertyValue("--jx-s0")).toBe("blue");
  });

  test("two elements with the same reactive custom property share ONE interned rule", async () => {
    /* The point of writing it under the author's name. Before, the variable was `--jx-rN-M` with a
       per-element serial, that name was in the rule text, and the interning handle is a hash of
       the text — so a repeater of 200 rows each carrying its own font produced 200 handles and 200
       rules. The declaration that READS the variable is identical across rows and interns once. */
    const rows = ["Charter, serif", "system-ui, sans-serif", "ui-monospace, monospace"].map(
      (face) => {
        const el = document.createElement("div");
        document.body.append(el);
        const scope = reactive({ face });
        applyStyle(
          el,
          { "--row-face": "${state.face}", fontFamily: "var(--row-face, inherit)" },
          {},
          scope,
        );
        return el;
      },
    );
    const handles = new Set(rows.map((el) => el.dataset.jx));
    expect(handles.size).toBe(1);
    expect(elementCSS(rows[0]!)).toContain("font-family: var(--row-face, inherit)");
    expect(rows.map((el) => el.style.getPropertyValue("--row-face"))).toEqual([
      "Charter, serif",
      "system-ui, sans-serif",
      "ui-monospace, monospace",
    ]);
  });

  test("a DESCENDANT rule keeps the indirection, because its variable must not be set here", async () => {
    /* A `var()` resolves from the nearest ancestor that set it. A descendant rule's variable
       written inline on the element carrying the rule would be read by every matching descendant
       of every element sharing that rule, which is the wrong element's value. */
    const scope = reactive({ tint: "red" });
    const el = document.createElement("div");
    document.body.append(el);
    applyStyle(el, { "& > b": { "--tint": "${state.tint}" } }, {}, scope);
    expect(elementCSS(el)).toContain("--tint: var(--jx-r");
  });

  test("elements styled alike with a reactive SELF declaration share ONE interned rule", () => {
    /* A self-target rule reads the variable its own element sets, so the name needs no serial. With
       one, every row of a tree binding its indent interned fifteen rules of its own, and an Outline
       scrolled through a long page grew the shared sheet past fourteen thousand rules. */
    const rows = [0, 1, 2].map((depth) => {
      const el = document.createElement("div");
      document.body.append(el);
      applyStyle(
        el,
        { ":hover": { opacity: "0.5" }, paddingInline: "${state.depth * 12}px" },
        {},
        reactive({ depth }),
      );
      return el;
    });
    expect(new Set(rows.map((el) => el.dataset.jx)).size).toBe(1);
    expect(elementCSS(rows[0]!)).toContain("padding-inline: var(--jx-s0)");
    expect(rows.map((el) => el.style.getPropertyValue("--jx-s0"))).toEqual(["0px", "12px", "24px"]);
  });

  test("a DESCENDANT reactive declaration still keeps each element's variable apart", () => {
    const [a, b] = ["red", "blue"].map((tint) => {
      const el = document.createElement("div");
      document.body.append(el);
      applyStyle(el, { "& > b": { color: "${state.tint}" } }, {}, reactive({ tint }));
      return el;
    });
    expect(a!.dataset.jx).not.toBe(b!.dataset.jx);
    expect(elementCSS(a!)).toMatch(/color: var\(--jx-r\d+-0\)/u);
  });

  test("nested selectors recurse (&, [attr], :pseudo, .class, descendant, and @media too)", () => {
    const el = document.createElement("div");
    applyStyle(el, {
      ".kid": {
        "&:hover": { color: "blue" },
        ":focus": { outline: "1px solid" },
        ".sub": { margin: "1px" },
        "@media print": { color: "black" },
        "[data-a]": { padding: "2px" },
        color: "red",
        span: { fontSize: "10px" },
      },
    });
    const uid = el.dataset.jx;
    expect(uid).toBeTruthy();
    const css = elementCSS(el);
    expect(css).toContain(`[data-jx="${uid}"].kid { color: red }`);
    expect(css).toContain(`[data-jx="${uid}"].kid:hover { color: blue }`);
    expect(css).toContain(`[data-jx="${uid}"].kid:focus { outline: 1px solid }`);
    expect(css).toContain(`[data-jx="${uid}"].kid[data-a] { padding: 2px }`);
    expect(css).toContain(`[data-jx="${uid}"].kid.sub { margin: 1px }`);
    expect(css).toContain(`[data-jx="${uid}"].kid span { font-size: 10px }`);
    /* Defect 1: `emitNested` skipped `@` keys, so a media query nested UNDER a selector was
       dropped outright while the same pair in the other order emitted. Studio carried a hoisting
       workaround for exactly this. */
    expect(css).toContain(`@media print { [data-jx="${uid}"].kid { color: black } }`);
  });

  test("media queries: named breakpoint, @( shorthand, raw @media, @-- skipped, base decls", () => {
    const el = document.createElement("div");
    applyStyle(
      el,
      {
        "@(max-width: 100px)": { margin: "0" },
        "@--": { color: "ignored" },
        "@--sm": {
          ".inner": { "&:active": { color: "green" }, color: "teal" },
          color: "blue",
        },
        "@media (min-width: 900px)": { padding: "4px" },
        color: "red",
      },
      { "--sm": "(min-width: 640px)" },
    );
    const uid = el.dataset.jx;
    const css = elementCSS(el);
    // Every declaration is a rule now, so nothing authored is left inline to outrank one.
    expect(el.style.cssText).toBe("");
    expect(css).toContain(`[data-jx="${uid}"] { color: red }`);
    expect(css).toContain(`@media (min-width: 640px) { [data-jx="${uid}"] { color: blue } }`);
    expect(css).toContain(`@media (max-width: 100px) { [data-jx="${uid}"] { margin: 0 } }`);
    expect(css).toContain(`@media (min-width: 900px) { [data-jx="${uid}"] { padding: 4px } }`);
    // Nested selector inside media query
    expect(css).toContain(`@media (min-width: 640px) { [data-jx="${uid}"].inner { color: teal } }`);
    expect(css).toContain(
      `@media (min-width: 640px) { [data-jx="${uid}"].inner:active { color: green } }`,
    );
    expect(css).not.toContain("ignored");
  });

  test("scalar under a selector-like key is dropped", () => {
    const el = document.createElement("div");
    applyStyle(el, { ":hover": "red", color: "green" });
    // The base declaration is a rule now; only the malformed `:hover` scalar is dropped.
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { color: green }`);
  });
});

// ─── reapplyStyle ─────────────────────────────────────────────────────────────

describe("reapplyStyle", () => {
  beforeEach(() => {
    resetDocumentStyles();
  });

  test("releases the previous rule set rather than accumulating one per keystroke", () => {
    const el = document.createElement("div");
    document.body.append(el);
    applyStyle(el, { ".kid": { color: "red" }, color: "purple" });
    expect(adoptedCSS()).toContain("purple");
    reapplyStyle(el, { color: "green" });
    // Defect 5 was one orphaned `<style>` per re-render; a leaked rule set is the same bug.
    expect(adoptedCSS()).not.toContain("purple");
    expect(elementCSS(el)).toBe(`[data-jx="${el.dataset.jx}"] { color: green }`);
  });

  test("an undefined def clears the rules and leaves the author's own inline style alone", () => {
    /* `el.style.cssText = ""` used to run here, and it destroyed an author's
       `attributes: { style: "…" }` along with the runtime's own writes. Only the `--jx-r…`
       properties this engine wrote are removed now. */
    const el = document.createElement("div");
    document.body.append(el);
    el.style.color = "red";
    applyStyle(el, { fontSize: "1rem" });
    // oxlint-disable-next-line unicorn/no-useless-undefined -- param is required; exercises the undefined styleDef branch
    reapplyStyle(el, undefined);
    expect({ css: adoptedCSS(), inline: el.style.color, uid: el.dataset.jx }).toEqual({
      css: "",
      inline: "red",
      uid: undefined,
    });
  });
});

// ─── renderSwitch gaps ────────────────────────────────────────────────────────

describe("renderSwitch gaps", () => {
  test("non-ref $switch renders empty container", () => {
    const el = renderNode(
      { $switch: "not-a-ref", cases: { a: { tagName: "span" } }, tagName: "div" },
      reactive({}),
    );
    expect(el.children.length).toBe(0);
  });

  test("onNodeCreated fires for switch container", () => {
    const created: string[] = [];
    renderNode(
      { $switch: { $ref: "#/state/k" }, cases: {}, tagName: "section" },
      reactive({ k: "x" }),
      { onNodeCreated: (n) => created.push(n.nodeName.toLowerCase()) },
    );
    expect(created).toEqual(["section"]);
  });

  test("external $ref case fetches, builds scope, and renders", async () => {
    const extDoc = {
      children: ["${state.label}"],
      state: { label: "external!" },
      tagName: "article",
    };
    stubFetch(() => jsonResponse(extDoc));
    const state = reactive({ page: "ext" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/page" },
        cases: { ext: { $ref: "http://localhost/gaps-ext-case.json" } },
        tagName: "div",
      },
      state,
    );
    await wait(10);
    expect(el.children.length).toBe(1);
    expect(el.children[0]!.tagName.toLowerCase()).toBe("article");
    expect(el.children[0]!.textContent).toBe("external!");
  });

  test("stale external case (superseded before fetch resolves) is dropped", async () => {
    const dA = deferred<Response>();
    const dB = deferred<Response>();
    stubFetch((url) => (url.includes("gaps-stale-a") ? dA.promise : dB.promise));
    const state = reactive({ page: "a" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/page" },
        cases: {
          a: { $ref: "http://localhost/gaps-stale-a.json" },
          b: { $ref: "http://localhost/gaps-stale-b.json" },
        },
        tagName: "div",
      },
      state,
    );
    state.page = "b"; // Supersede before A's fetch resolves
    dA.resolve(Response.json({ children: ["A"], tagName: "article" }));
    dB.resolve(Response.json({ children: ["B"], tagName: "aside" }));
    await wait(10);
    expect(el.children.length).toBe(1);
    expect(el.children[0]!.tagName.toLowerCase()).toBe("aside");
    expect(el.textContent).toBe("B");
  });

  test("stale external case (superseded during buildScope) is dropped", async () => {
    const dClass = deferred<Response>();
    const docA = {
      children: ["A944"],
      state: { slow: { $prototype: "Slow", $src: "http://localhost/gaps-slow.class.json" } },
      tagName: "article",
    };
    const docB = { children: ["B944"], tagName: "aside" };
    stubFetch((url) => {
      if (url.includes("gaps-slow.class.json")) {
        return dClass.promise;
      }
      return jsonResponse(url.includes("gaps-944-a") ? docA : docB);
    });
    const state = reactive({ page: "a" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/page" },
        cases: {
          a: { $ref: "http://localhost/gaps-944-a.json" },
          b: { $ref: "http://localhost/gaps-944-b.json" },
        },
        tagName: "div",
      },
      state,
    );
    await wait(10); // A's scope build is now blocked on the pending .class.json fetch
    state.page = "b"; // Supersede while A is mid-buildScope
    await wait(10);
    expect(el.textContent).toBe("B944");
    dClass.resolve(Response.json({ $defs: { fields: {} }, title: "Slow" }));
    await wait(10);
    expect(el.textContent).toBe("B944"); // A944 never lands
  });

  test("external $ref case failure logs error", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => Promise.resolve(new Response(null, { status: 500 })));
    const state = reactive({ page: "bad" });
    const el = renderNode(
      {
        $switch: { $ref: "#/state/page" },
        cases: { bad: { $ref: "http://localhost/gaps-bad-case.json" } },
        tagName: "div",
      },
      state,
    );
    await wait(10);
    expect(el.children.length).toBe(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

// ─── renderMappedArray: onNodeCreated ────────────────────────────────────────

describe("renderMappedArray onNodeCreated", () => {
  test("container reported to onNodeCreated", () => {
    const created: string[] = [];
    const state = reactive({ items: ["a", "b"] });
    const el = renderNode(
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/items" },
          map: { tagName: "li", textContent: "${$map.item}" },
        },
        tagName: "ul",
      },
      state,
      { onNodeCreated: (n) => created.push(n.nodeName.toLowerCase()) },
    );
    expect(created[0]).toBe("ul");
    expect(el.children.length).toBe(2);
  });
});

// ─── Request prototype gaps ──────────────────────────────────────────────────

describe("Request prototype gaps", () => {
  test("template URL is evaluated, cleanup aborts on re-run", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return jsonResponse({ u: url });
    });
    const doc: JxDocument = {
      state: {
        endpoint: { default: "http://api.test/one" },
        result: { $prototype: "Request", url: "${state.endpoint}" },
      },
    };
    const state = await buildScope(doc);
    await wait(5);
    expect(urls).toContain("http://api.test/one");
    expect(state.result).toEqual({ u: "http://api.test/one" });
    state.endpoint = "http://api.test/two";
    await wait(5);
    expect(urls).toContain("http://api.test/two");
    expect(state.result).toEqual({ u: "http://api.test/two" });
  });

  test("URL containing 'undefined' is skipped", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const doc: JxDocument = {
      state: {
        result: { $prototype: "Request", url: "${state.missing}/items" },
      },
    };
    const state = await buildScope(doc);
    await wait(5);
    expect(fetchMock.mock.calls.length).toBe(0);
    expect(state.result).toBe(null);
  });

  test("debounce delays fetch and clears timer on re-trigger", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return jsonResponse("done");
    });
    const doc: JxDocument = {
      state: {
        q: { default: "a" },
        result: { $prototype: "Request", debounce: 10, url: "http://api.test/?q=${state.q}" },
      },
    };
    const state = await buildScope(doc);
    expect(urls.length).toBe(0);
    state.q = "b"; // Re-trigger before debounce fires — clears the first timer
    await wait(30);
    expect(urls).toEqual(["http://api.test/?q=b"]);
    expect(state.result).toBe("done");
  });
});

// ─── URLSearchParams prototype ───────────────────────────────────────────────

describe("URLSearchParams prototype", () => {
  test("builds query string from $ref, template, and literal values", async () => {
    const doc: JxDocument = {
      state: {
        qs: {
          $prototype: "URLSearchParams",
          a: { $ref: "#/state/x" },
          b: "${state.x}-suffix",
          c: "plain",
        },
        x: { default: "1" },
      },
    };
    const state = await buildScope(doc);
    expect(state.qs).toBe("a=1&b=1-suffix&c=plain");
    state.x = "2";
    await wait();
    expect(state.qs).toBe("a=2&b=2-suffix&c=plain");
  });
});

// ─── LocalStorage gaps ───────────────────────────────────────────────────────

describe("LocalStorage gaps", () => {
  test("invalid JSON in storage falls back to default", async () => {
    localStorage.setItem("gapsBadJson", "{not json");
    const doc: JxDocument = {
      state: { v: { $prototype: "LocalStorage", default: "fallback", key: "gapsBadJson" } },
    };
    const state = await buildScope(doc);
    expect(state.v).toBe("fallback");
    localStorage.removeItem("gapsBadJson");
  });

  test("setting value to null removes the key", async () => {
    const doc: JxDocument = {
      state: { v: { $prototype: "LocalStorage", default: "keep", key: "gapsNull" } },
    };
    const state = await buildScope(doc);
    await wait();
    expect(localStorage.getItem("gapsNull")).toBe(JSON.stringify("keep"));
    state.v = null;
    await wait();
    expect(localStorage.getItem("gapsNull")).toBe(null);
  });
});

// ─── Cookie gaps ─────────────────────────────────────────────────────────────

describe("Cookie gaps", () => {
  test("reads existing JSON cookie", async () => {
    // oxlint-disable-next-line unicorn/no-document-cookie -- seeding the cookie store for the Cookie prototype read path
    document.cookie = `gapsJsonCk=${encodeURIComponent(JSON.stringify({ a: 1 }))}`;
    const doc: JxDocument = { state: { ck: { $prototype: "Cookie", name: "gapsJsonCk" } } };
    const state = await buildScope(doc);
    expect(state.ck).toEqual({ a: 1 });
  });

  test("reads existing non-JSON cookie as raw string", async () => {
    // oxlint-disable-next-line unicorn/no-document-cookie -- seeding the cookie store for the Cookie prototype read path
    document.cookie = "gapsRawCk=hello";
    const doc: JxDocument = { state: { ck: { $prototype: "Cookie", name: "gapsRawCk" } } };
    const state = await buildScope(doc);
    expect(state.ck).toBe("hello");
  });

  test("persists with maxAge, path, domain, secure, sameSite options", async () => {
    const doc: JxDocument = {
      state: {
        ck: {
          $prototype: "Cookie",
          default: "opt",
          domain: "localhost",
          maxAge: 60,
          name: "gapsOptCk",
          path: "/",
          sameSite: "Lax",
          secure: false,
        },
      },
    };
    const state = await buildScope(doc);
    expect(state.ck).toBe("opt");
    state.ck = "updated";
    await wait();
    expect(state.ck).toBe("updated");
  });

  test("secure flag branch executes", async () => {
    const doc: JxDocument = {
      state: {
        ck: { $prototype: "Cookie", default: "s", name: "gapsSecCk", secure: true },
      },
    };
    const state = await buildScope(doc);
    expect(state.ck).toBe("s");
  });
});

// ─── IndexedDB gaps ──────────────────────────────────────────────────────────

describe("IndexedDB gaps", () => {
  test("throws without database/store", async () => {
    expect(resolvePrototype({ $prototype: "IndexedDB" }, reactive({}), "idb")).rejects.toThrow(
      "requires database and store",
    );
  });

  test("upgradeneeded creates store + indexes, success exposes getStore", async () => {
    const indexCalls: [string, string, IDBIndexParameters][] = [];
    const objectStore = {
      createIndex: (name: string, keyPath: string, options: IDBIndexParameters) =>
        indexCalls.push([name, keyPath, options]),
    };
    const storeNames = new Set<string>();
    const db = {
      createObjectStore: (name: string) => {
        storeNames.add(name);
        return objectStore;
      },
      objectStoreNames: { contains: (n: string) => storeNames.has(n) },
      transaction: () => ({ objectStore: () => "the-store" }),
    };
    /* The runtime reads only `event.target.result` from an open-request event, and its `error`
       listener takes no argument at all. */
    const listeners: Record<string, (event?: { target: { result: typeof db } }) => void> = {};
    const fakeReq = {
      addEventListener: (n: string, cb: (event?: { target: { result: typeof db } }) => void) => {
        listeners[n] = cb;
      },
      error: { message: "idb fail" },
    };
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open: mock(() => fakeReq) },
      writable: true,
    });

    const result = await resolvePrototype(
      {
        $prototype: "IndexedDB",
        database: "gapsDb",
        indexes: [{ keyPath: "name", name: "byName", unique: true }],
        store: "gapsStore",
      },
      reactive({}),
      "idb",
    );
    if (!isRef(result)) {
      throw new Error("an IndexedDB entry must resolve to a ref");
    }
    expect(result.value).toBe(null);

    listeners.upgradeneeded!({ target: { result: db } });
    expect(storeNames.has("gapsStore")).toBe(true);
    expect(indexCalls).toEqual([["byName", "name", { unique: true }]]);

    listeners.success!({ target: { result: db } });
    /* SAFETY: the `success` listener just ran synchronously and assigned the runtime's store API
       object to the ref; `getStore` resolves to whatever the fake db's
       `transaction().objectStore()` returns, which is the string "the-store". */
    const api = result.value as {
      database: string;
      getStore: () => Promise<string>;
      isReady: boolean;
      store: string;
      version: number;
    };
    expect(api.isReady).toBe(true);
    expect(api.database).toBe("gapsDb");
    expect(api.store).toBe("gapsStore");
    expect(api.version).toBe(1);
    expect(await api.getStore()).toBe("the-store");

    listeners.error!();
    expect(result.value).toEqual({ error: "idb fail" });
    Reflect.deleteProperty(globalThis, "indexedDB");
  });
});

// ─── resolveRef deep paths ───────────────────────────────────────────────────

describe("resolveRef deep paths", () => {
  test("#/state/key/sub/path navigates nested objects", () => {
    const state = reactive({ post: { frontmatter: { title: "Deep" } } });
    expect(resolveRef("#/state/post/frontmatter/title", state)).toBe("Deep");
  });

  test("$map/item/sub navigates into item", () => {
    const state = reactive({ $map: { index: 0, item: { name: "n1" } } });
    expect(resolveRef("$map/item/name", state)).toBe("n1");
  });
});

// ─── Jx top-level: $head, $media propagation, resolve cache ─────────────────

describe("Jx gaps", () => {
  test("$media on root doc propagates to scopes built without $media", async () => {
    const target = document.createElement("div");
    await Jx({ $media: { "--sm": "(min-width: 640px)" }, state: {}, tagName: "div" }, target);
    const child = await buildScope({ state: {}, tagName: "div" });
    expect(child["$media"]).toEqual({ "--sm": "(min-width: 640px)" });
  });

  test("resolve cache returns same promise for repeated source", async () => {
    const doc = { tagName: "div" };
    const fetchMock = stubFetch(() => jsonResponse(doc));
    const target = document.createElement("div");
    await Jx("http://localhost/gaps-cached.json", target);
    await Jx("http://localhost/gaps-cached.json", target);
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(target.children.length).toBe(2);
  });
});

// ─── Template bindings over state that is not there yet ──────────────────────

describe("a template binding that throws", () => {
  test("renders empty, keeps tracking, and fills in when its data arrives", async () => {
    /* A collection resolved asynchronously reads `null` first. The binding's TypeError used to
       escape `effect()`, which stops the effect, so it never re-ran — and the throw unwound the
       whole render, blanking the page around it. */
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const state = reactive<{ posts: string[] | null }>({ posts: null });
    const el = renderNode(
      {
        attributes: { "data-count": "${state.posts.length}" },
        children: ["${state.posts.length} posts"],
        tagName: "p",
        title: "${state.posts[0]}",
      },
      state,
    );
    expect(el.textContent).toBe("");
    expect(Object.hasOwn(el.dataset, "count")).toBe(false);
    state.posts = ["a", "b"];
    await wait();
    expect(el.textContent).toBe("2 posts");
    expect(el.dataset.count).toBe("2");
    expect(el.title).toBe("a");
    state.posts = null;
    await wait();
    state.posts = ["c"];
    await wait();
    // Reported once per template source, however many times it re-runs.
    expect(
      warn.mock.calls.filter(([msg]) => String(msg).includes("state.posts.length} posts")),
    ).toHaveLength(1);
    warn.mockRestore();
  });

  test("a host's handler hears every throw, in place of the once-per-source warning", () => {
    // Studio's render critic must still refuse a page whose template can never evaluate.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const heard: string[] = [];
    setTemplateErrorHandler((error, source) => {
      heard.push(`${source}: ${error instanceof Error ? error.constructor.name : "?"}`);
    });
    for (let i = 0; i < 2; i += 1) {
      renderNode({ tagName: "b", textContent: "${missingThing}" }, reactive({}));
    }
    setTemplateErrorHandler(null);
    expect(heard).toEqual(["${missingThing}: ReferenceError", "${missingThing}: ReferenceError"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("one template source evaluates against each scope it is bound in", () => {
    // Compiled functions are cached by source; the scope is an argument, never captured.
    const a = renderNode(
      { tagName: "span", textContent: "${state.name}" },
      reactive({ name: "a" }),
    );
    const b = renderNode(
      { tagName: "span", textContent: "${state.name}" },
      reactive({ name: "b" }),
    );
    expect([a.textContent, b.textContent]).toEqual(["a", "b"]);
  });

  test("a cache that fills starts over and keeps answering correctly", () => {
    /* Editing mints a source per keystroke, so the cache is bounded rather than left to grow.
       Only the ends are asserted: Bun's JavaScriptCore can hand back another source's code for
       `new Function` across thousands of near-identical bodies (seen with no cache at all), and
       V8, where Studio runs, does not — that engine defect is not what this test is about. */
    const state = reactive({ n: 2 });
    const first = renderNode({ tagName: "i", textContent: "${state.n * 10}" }, state);
    for (let i = 0; i < 4200; i += 1) {
      renderNode({ tagName: "i", textContent: `\${state.n + ${i}}` }, state);
    }
    const again = renderNode({ tagName: "i", textContent: "${state.n * 10}" }, state);
    expect([first.textContent, again.textContent]).toEqual(["20", "20"]);
  });
});
