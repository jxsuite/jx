import { describe, test, expect } from "bun:test";
import { compileClient } from "../src/targets/compile-client.js";

describe("compileClient", () => {
  test("compiles counter example to pre-rendered HTML with bindings", () => {
    const counter = {
      state: {
        count: { type: "integer", default: 0, description: "Current counter value" },
        label: {
          $prototype: "Function",
          body: "const c = state.count; return c > 0 ? 'Clicked ' + c + ' time' + (c === 1 ? '' : 's') : 'Click me!';",
        },
        increment: { $prototype: "Function", body: "state.count++" },
        decrement: { $prototype: "Function", body: "state.count = Math.max(0, state.count - 1)" },
        reset: { $prototype: "Function", body: "state.count = 0" },
      },
      tagName: "div",
      style: { display: "block", fontFamily: "system-ui, sans-serif" },
      children: [
        {
          tagName: "h1",
          textContent: { $ref: "#/state/label" },
          style: { fontSize: "1.5rem", color: "#333" },
        },
        {
          tagName: "p",
          textContent: "${state.count}",
          style: { fontSize: "3rem", fontWeight: "bold" },
        },
        {
          tagName: "div",
          style: { display: "flex", gap: "0.5rem" },
          children: [
            { tagName: "button", textContent: "\u2212", onclick: { $ref: "#/state/decrement" } },
            { tagName: "button", textContent: "+", onclick: { $ref: "#/state/increment" } },
            { tagName: "button", textContent: "Reset", onclick: { $ref: "#/state/reset" } },
          ],
        },
      ],
    };

    const result = compileClient(counter, {
      title: "Counter",
      reactivitySrc: "https://esm.sh/@vue/reactivity@3.5.32",
    });

    // Should produce HTML and one JS file
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("app.js");

    // HTML should contain data-bind markers
    expect(result.html).toContain("data-bind");
    expect(result.html).toContain(":text-content=");
    expect(result.html).toContain("@click=");

    // HTML should contain pre-rendered static content
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<button");

    // HTML should NOT contain custom element registration
    expect(result.html).not.toContain("customElements.define");

    // JS module should have reactive state, bind, on
    const js = result.files[0].content;
    expect(js).toContain("const state = reactive({");
    expect(js).toContain("count: 0,");
    expect(js).toContain("const bind = {");
    expect(js).toContain("const on = {");
    expect(js).toContain("hydrate(document)");

    // Should NOT contain the whole expanded signal object
    expect(js).not.toContain('"type":"integer"');
  });

  test("extracts default from expanded signals", () => {
    const doc = {
      state: {
        name: { type: "string", default: "World", description: "Name to greet" },
      },
      tagName: "div",
      children: [{ tagName: "span", textContent: "${state.name}" }],
    };

    const result = compileClient(doc, { title: "Test" });
    const js = result.files[0].content;

    // Should use "World" as the default, not the full object
    expect(js).toContain('name: "World"');
    expect(js).not.toContain('"type":"string"');
  });

  test("handles $ref textContent correctly", () => {
    const doc = {
      state: {
        label: {
          $prototype: "Function",
          body: "return 'Hello';",
        },
      },
      tagName: "div",
      children: [{ tagName: "h1", textContent: { $ref: "#/state/label" } }],
    };

    const result = compileClient(doc, { title: "Test" });

    // h1 should have data-bind and :textContent binding
    expect(result.html).toContain("data-bind");
    expect(result.html).toContain(':text-content="label"');
    // Should NOT contain [object Object]
    expect(result.html).not.toContain("[object Object]");
  });

  test("handles event handlers with $ref", () => {
    const doc = {
      state: {
        doSomething: { $prototype: "Function", body: "console.log('clicked')" },
      },
      tagName: "div",
      children: [
        { tagName: "button", textContent: "Click", onclick: { $ref: "#/state/doSomething" } },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    expect(result.html).toContain('@click="doSomething"');
    expect(result.html).toContain("data-bind");
  });

  test("handles inline event handlers", () => {
    const doc = {
      state: { count: 0 },
      tagName: "div",
      children: [
        {
          tagName: "button",
          textContent: "+",
          onclick: { $prototype: "Function", body: "state.count++" },
        },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // Should create an anonymous handler in the `on` object
    expect(result.html).toContain("data-bind");
    expect(result.html).toContain("@click=");
    const js = result.files[0].content;
    expect(js).toContain("state.count++");
  });

  test("handles dynamic style properties", () => {
    const doc = {
      state: { color: "red" },
      tagName: "div",
      children: [
        {
          tagName: "span",
          textContent: "Hello",
          style: { color: "${state.color}", fontSize: "1rem" },
        },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // Static style should be inline
    expect(result.html).toContain("font-size: 1rem");
    // Dynamic style should be a binding
    expect(result.html).toContain(":style.color=");
    expect(result.html).toContain("data-bind");
  });

  test("skips schema-only type defs", () => {
    const doc = {
      state: {
        nameType: { type: "string", minLength: 1, maxLength: 100 },
        count: 0,
      },
      tagName: "div",
      children: [{ tagName: "span", textContent: "${state.count}" }],
    };

    const result = compileClient(doc, { title: "Test" });
    const js = result.files[0].content;

    // Should skip nameType (schema-only), include count
    expect(js).toContain("count: 0");
    expect(js).not.toContain("nameType");
  });

  test("static node without dynamic values has no data-bind", () => {
    const doc = {
      state: { count: 0 },
      tagName: "div",
      children: [
        { tagName: "p", textContent: "Static text" },
        { tagName: "span", textContent: "${state.count}" },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // The <p> should NOT have data-bind (it's fully static)
    expect(result.html).toContain("<p>Static text</p>");
    // The <span> should have data-bind
    expect(result.html).toMatch(/<span[^>]*data-bind/);
  });
});

// ─── Additional coverage: prototypes and bindings ──────────────────────────────

describe("compileClient — prototypes", () => {
  test("LocalStorage generates localStorage init with key and default", () => {
    const doc = {
      state: {
        prefs: { $prototype: "LocalStorage", key: "user-prefs", default: { theme: "dark" } },
      },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("localStorage");
    expect(js).toContain("user-prefs");
    expect(js).toContain("JSON.parse");
    expect(js).toContain("effect(");
  });

  test("SessionStorage generates sessionStorage init", () => {
    const doc = {
      state: { token: { $prototype: "SessionStorage", key: "auth-token" } },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("sessionStorage");
    expect(js).toContain("auth-token");
  });

  test("Request with headers and body generates fetch options", () => {
    const doc = {
      state: {
        data: {
          $prototype: "Request",
          url: "/api/submit",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: { action: "save" },
        },
      },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("method:");
    expect(js).toContain("POST");
    expect(js).toContain("headers:");
    expect(js).toContain("body:");
  });

  test("Request with template URL checks for undefined", () => {
    const doc = {
      state: { id: 1, user: { $prototype: "Request", url: "/api/${state.id}" } },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("undefined");
    expect(js).toContain("const url = `");
  });

  test("Cookie generates document.cookie read and parse", () => {
    const doc = {
      state: { session: { $prototype: "Cookie", name: "sid", default: "anon" } },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("document.cookie");
    expect(js).toContain("sid");
    expect(js).toContain("decodeURIComponent");
  });

  test("manual Request emits only a comment", () => {
    const doc = {
      state: { data: { $prototype: "Request", url: "/api", manual: true } },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("manual Request");
    expect(js).not.toContain("fetch(url");
  });
});

describe("compileClient — mapped arrays", () => {
  test("generates lit-html imports for mapped arrays", () => {
    const doc = {
      state: { items: [{ name: "A" }] },
      tagName: "div",
      children: [
        {
          tagName: "ul",
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: { tagName: "li", textContent: "${$map.item.name}" },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("import { html, render } from 'lit-html'");
    expect(js).toContain(".map((item, index)");
  });

  test("mapped array with static items array", () => {
    const doc = {
      tagName: "div",
      children: [
        {
          tagName: "ul",
          children: {
            $prototype: "Array",
            items: ["one", "two"],
            map: { tagName: "li", textContent: "${$map.item}" },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain('["one","two"]');
  });

  test("mapped array with nested children in map template", () => {
    const doc = {
      state: { todos: [] },
      tagName: "div",
      children: [
        {
          tagName: "div",
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/todos" },
            map: {
              tagName: "div",
              children: [
                { tagName: "span", textContent: "${$map.item.text}" },
                { tagName: "button", textContent: "X" },
              ],
            },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("<span>");
    expect(js).toContain("<button>");
  });

  test("mapped array with style in map template", () => {
    const doc = {
      state: { items: [] },
      tagName: "div",
      children: [
        {
          tagName: "div",
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: {
              tagName: "div",
              style: { color: "red", fontWeight: "bold" },
              textContent: "${$map.item}",
            },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("color: red");
    expect(js).toContain("font-weight: bold");
  });
});

describe("compileClient — $ref bindings and attributes", () => {
  test("$ref attribute creates :attr binding", () => {
    const doc = {
      state: { link: "/home" },
      tagName: "div",
      children: [
        {
          tagName: "a",
          attributes: { href: { $ref: "#/state/link" } },
          textContent: "Home",
        },
      ],
    };
    const { html, files } = compileClient(doc, { title: "Test" });
    expect(html).toContain(':attr.href="link"');
    expect(files[0].content).toContain("() => state.link");
  });

  test("template attribute creates :attr binding", () => {
    const doc = {
      state: { id: 5 },
      tagName: "div",
      children: [
        {
          tagName: "a",
          attributes: { href: "/item/${state.id}" },
          textContent: "View",
        },
      ],
    };
    const { html } = compileClient(doc, { title: "Test" });
    expect(html).toContain(":attr.href=");
    expect(html).toContain("data-bind");
  });

  test("$ref on non-reserved prop creates property binding", () => {
    const doc = {
      state: { val: "hello" },
      tagName: "div",
      children: [{ tagName: "input", value: { $ref: "#/state/val" } }],
    };
    const { html } = compileClient(doc, { title: "Test" });
    expect(html).toContain(':value="val"');
  });

  test("template on non-reserved prop creates property binding", () => {
    const doc = {
      state: { x: 10 },
      tagName: "div",
      children: [{ tagName: "div", title: "Position: ${state.x}" }],
    };
    const { html } = compileClient(doc, { title: "Test" });
    expect(html).toContain(":title=");
  });

  test("nested $ref path uses underscore-delimited key", () => {
    const doc = {
      state: { user: { name: "Alice" } },
      tagName: "div",
      children: [{ tagName: "span", textContent: { $ref: "#/state/user/name" } }],
    };
    const { html, files } = compileClient(doc, { title: "Test" });
    expect(html).toContain(':text-content="user_name"');
    expect(files[0].content).toContain("state.user.name");
  });
});

describe("compileClient — module structure", () => {
  test("Function with $src generates import statement", () => {
    const doc = {
      state: {
        compute: { $prototype: "Function", $src: "./helpers.js" },
        transform: { $prototype: "Function", $src: "./helpers.js" },
      },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("import { compute, transform } from './helpers.js'");
  });

  test("includes computed import when computed entries present", () => {
    const doc = {
      state: { count: 0, doubled: { $prototype: "Function", body: "return state.count * 2;" } },
      tagName: "div",
      children: [],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("import { reactive, effect, computed }");
  });

  test("hydrate includes render branch when lit-html is used", () => {
    const doc = {
      state: { items: [] },
      tagName: "div",
      children: [
        {
          tagName: "ul",
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/items" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("'render'");
    expect(js).toContain("render(bind[key](), el)");
  });

  test("custom modulePath reflected in output", () => {
    const doc = { tagName: "div", children: [] };
    const { html, files } = compileClient(doc, { title: "Test", modulePath: "scripts/main.js" });
    expect(html).toContain('src="/scripts/main.js"');
    expect(files[0].path).toBe("scripts/main.js");
  });

  test("null/undefined children are handled gracefully", () => {
    const doc = { tagName: "div", children: [null, undefined, "text"] };
    const { html } = compileClient(doc, { title: "Test" });
    expect(html).toContain("text");
  });

  test("self-closing tags in mapped array", () => {
    const doc = {
      state: { images: [] },
      tagName: "div",
      children: [
        {
          tagName: "div",
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/images" },
            map: { tagName: "img" },
          },
        },
      ],
    };
    const { files } = compileClient(doc, { title: "Test" });
    const js = files[0].content;
    expect(js).toContain("<img>");
  });
});
