// oxlint-disable unicorn/no-thenable -- `then` is the JSON Schema conditional keyword in a structured body (spec §20), not a promise
/**
 * Compiled-host.test.ts — what a compiled element does to its own host (spec.md §16.1): the
 * definition's root-level event handlers listen on it, and the definition's root `attributes` are
 * written on it, as the interpreter does both.
 *
 * The emission cases pin the lowering; the render cases load the module and drive it, because a
 * listener that calls a computed, or an attribute effect that reads the wrong scope, looks
 * plausible in source and fails only when it runs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { HTMLElement } from "happy-dom";
import { buildInitialScope, resolveHostAttributes } from "../src/shared";
import { buildSite } from "../src/site/site-build";
import { compileElement } from "../src/targets/compile-element";

const TMP = resolve(import.meta.dir, "__test-compiled-host__");

const moduleOf = async (doc: JxDocument): Promise<string> => {
  const { files } = await compileElement(doc);
  return files[0]!.content;
};

describe("compileElement — root-level handlers on the host (spec.md §16.1)", () => {
  test("each root handler spelling becomes one host listener in the constructor", async () => {
    const source = await moduleOf({
      "onjx-ready": {
        $prototype: "Function",
        body: [{ operator: "+=", target: { $ref: "#/state/n" }, value: 1 }],
      },
      onclick: { $ref: "#/state/pick" },
      onkeydown: { $prototype: "Function", body: "state.n++" },
      ontoggle: { $expression: { operator: "+=", target: { $ref: "#/state/n" }, value: 1 } },
      state: { n: 0, pick: { $prototype: "Function", body: "state.n = 9" } },
      tagName: "test-host-spellings",
    });
    const from = source.indexOf("constructor() {");
    const to = source.indexOf("template() {");
    const inConstructor = (text: string): boolean => {
      const at = source.indexOf(text);
      return at > from && at < to;
    };
    expect(inConstructor("const s = this.state;")).toBe(true);
    expect(inConstructor('this.addEventListener("click", (e) => s.pick(s, e));')).toBe(true);
    expect(inConstructor('this.addEventListener("keydown", (e) => { s.n++')).toBe(true);
    expect(inConstructor('this.addEventListener("jx-ready", (e) => {')).toBe(true);
    expect(inConstructor('this.addEventListener("toggle", (e) => {')).toBe(true);
  });

  test("a definition with no root handler emits no host listener", async () => {
    const source = await moduleOf({
      children: [{ onclick: { $ref: "#/state/pick" }, tagName: "button" }],
      state: { pick: { $prototype: "Function", body: "state.n = 9" } },
      tagName: "test-host-none",
    });
    expect(source).not.toContain("addEventListener");
  });

  test("observedAttributes and a root on* value that is no handler bind nothing", async () => {
    const source = await moduleOf({
      observedAttributes: ["label"],
      onlabel: "text",
      state: { label: "" },
      tagName: "test-host-nothing",
    });
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("@label");
  });

  test("a root handler that names both a body and a $src is refused", async () => {
    let message = "";
    try {
      await moduleOf({
        onclick: { $prototype: "Function", $src: "./lib.js", body: "state.n++" },
        tagName: "test-host-both",
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('root "onclick" handler');
  });

  test("a map root binds every handler spelling, with the iteration published", async () => {
    const list = (onclick: JsonValue): JxDocument => ({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { onclick, tagName: "li" },
        },
      ],
      state: { n: 0, pick: { $prototype: "Function", body: "state.n = 9" }, rows: [] },
      tagName: "test-map-root",
    });
    expect(await moduleOf(list({ $prototype: "Function", body: "state.n++" }))).toContain(
      '@click="${(e) => { s.$map = $map; s.n++',
    );
    expect(await moduleOf(list({ $ref: "#/state/pick" }))).toContain(
      '@click="${(e) => { s.$map = $map; s.pick(s, e); }}"',
    );
    expect(
      await moduleOf(
        list({ $expression: { operator: "+=", target: { $ref: "#/state/n" }, value: 1 } }),
      ),
    ).toContain('@click="${(e) => { s.$map = $map; ');
    expect(
      await moduleOf(
        list({
          $prototype: "Function",
          body: [{ operator: "+=", target: { $ref: "#/state/n" }, value: 1 }],
        }),
      ),
    ).toContain('@click="${(e) => { s.$map = $map; ');
    // A value that is no handler binds nothing.
    expect(await moduleOf(list("text"))).not.toContain("@click");
  });

  test("a bodyless $src bound only by a root handler stays callable, lazy or not", async () => {
    const doc = (lazy: boolean): JxDocument => ({
      children: [],
      onclick: { $ref: "#/state/rows" },
      state: { rows: { $prototype: "Function", $src: "./lib.js", ...(lazy && { $lazy: true }) } },
      tagName: "test-host-src",
    });
    const eager = await moduleOf(doc(false));
    expect(eager).not.toContain("computed(() => rows(");
    expect(eager).toContain("this.state.rows = rows;");
    expect(await moduleOf(doc(true))).toContain("const rows = (...args) =>");
  });
});

describe("compileElement — root attributes on the host (spec.md §16.1)", () => {
  test("a literal is written once and a binding is an effect, each by the attribute rule", async () => {
    const source = await moduleOf({
      attributes: {
        "aria-label": "${state.label}",
        "data-count": "n=${state.n}",
        "data-off": false,
        "data-on": true,
        "data-ref": { $ref: "#/state/label" },
        draggable: true,
        role: "tablist",
        tabindex: -1,
      },
      state: { label: "Tabs", n: 1 },
      tagName: "test-host-attrs",
    });
    expect(source).toContain('if (_first) this.setAttribute("role", "tablist");');
    expect(source).toContain('if (_first) this.setAttribute("tabindex", "-1");');
    // A presence boolean is the bare attribute or nothing; an enumerated one is its word.
    expect(source).toContain('if (_first) this.setAttribute("data-on", "");');
    expect(source).toContain('if (_first) this.setAttribute("draggable", "true");');
    expect(source).not.toContain('"data-off"');
    expect(source).toContain('const _v = __jxAttrText("aria-label", s.label);');
    expect(source).toContain('const _v = __jxAttrText("data-count", `n=${s.n}`);');
    expect(source).toContain('const _v = __jxAttrText("data-ref", s.label);');
    expect(source).toContain(
      'if (_v === null || _v === undefined) this.removeAttribute("aria-label");',
    );
    // In connectedCallback, never the constructor: a constructor must not add attributes.
    expect(source.indexOf('this.setAttribute("role"')).toBeGreaterThan(
      source.indexOf("connectedCallback() {"),
    );
  });

  test("the scope alias is declared only where a template hole names state on its own", async () => {
    const plain = await moduleOf({
      children: [{ tagName: "p", textContent: "The state is ${state.n}" }],
      state: { n: 1, shout: "state ${state.n}" },
      tagName: "test-alias-none",
    });
    expect(plain).not.toContain("const state =");
    const handed = await moduleOf({
      children: [{ tagName: "p", textContent: "${state.fn({ a: state })}" }],
      state: { fn: { $prototype: "Function", body: "return 1", parameters: ["x"] }, n: 1 },
      tagName: "test-alias-hole",
    });
    expect(handed).toContain("    const state = s;");
  });

  test("a definition with no root attributes emits nothing for them", async () => {
    const source = await moduleOf({ state: { n: 1 }, tagName: "test-host-bare" });
    expect(source).not.toContain("this.setAttribute(");
  });

  test("resolveHostAttributes resolves against the instance and leaves out what it cannot", () => {
    const scope = buildInitialScope({
      feed: { $prototype: "Request", url: "/api" },
      n: 2,
      on: true,
      thrower: { $prototype: "Function", body: "return state.missing.deep" },
      variant: "accent",
    });
    expect(
      resolveHostAttributes(
        {
          "data-feed": { $ref: "#/state/feed" },
          "data-late": "${state.feed}",
          "data-n": { $ref: "#/state/n" },
          "data-none": "${state.variant === 'x' ? '' : null}",
          "data-on": { $ref: "#/state/on" },
          "data-throws": { $ref: "#/state/thrower" },
          "data-variant": "${state.variant}",
          role: "list",
        },
        scope,
      ),
    ).toEqual({ "data-n": 2, "data-on": true, "data-variant": "accent", role: "list" });
    expect(resolveHostAttributes(undefined, scope)).toEqual({});
  });
});

describe("a compiled element's host, rendered", () => {
  let win: Window;

  /** A compiled element with the state its module builds. */
  type HostElement = HTMLElement & { state: Record<string, JsonValue> };
  function isHost(element: HTMLElement): element is HostElement {
    return "state" in element;
  }
  const mount = (tagName: string, parent: HTMLElement): HostElement => {
    const el = win.document.createElement(tagName);
    parent.append(el);
    if (!isHost(el)) {
      throw new Error(`Expected <${tagName}> to carry its state`);
    }
    return el;
  };

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    mkdirSync(TMP, { recursive: true });
    win = new Window({ url: "https://example.test" });
    Object.assign(globalThis, {
      CustomEvent: win.CustomEvent,
      Element: win.Element,
      Event: win.Event,
      HTMLElement: win.HTMLElement,
      Node: win.Node,
      customElements: win.customElements,
      document: win.document,
      window: win.window,
    });
    writeFileSync(
      resolve(TMP, "lib.js"),
      "export function onPing(state, event) { state.last = event.type; }\n" +
        "export function twice(scope) { return scope.n * 2; }\n",
      "utf8",
    );
    const docs: JxDocument[] = [
      {
        attributes: {
          "aria-label": "${state.label || null}",
          "data-busy": "${state.disabled ? '' : null}",
          "data-value": { $ref: "#/state/value" },
          role: "option",
        },
        children: [{ tagName: "span", textContent: "row" }],
        onclick: { $ref: "#/state/onClick" },
        onkeydown: { $ref: "#/state/onKeydown" },
        state: {
          disabled: false,
          label: "",
          onClick: {
            $prototype: "Function",
            body: [
              { stopPropagation: true },
              {
                if: { operator: "!", target: { $ref: "#/state/disabled" } },
                then: [
                  { bubbles: true, detail: { $ref: "#/state/value" }, dispatchEvent: "select" },
                ],
              },
            ],
          },
          onKeydown: {
            $prototype: "Function",
            body: "state.seen = event.currentTarget.tagName + ':' + state.value",
            parameters: ["event"],
          },
          seen: "",
          value: "copy",
        },
        tagName: "ch-row",
      },
      {
        onpang: { $expression: { operator: "+=", target: { $ref: "#/state/n" }, value: 1 } },
        onping: { $prototype: "Function", body: "state.n++" },
        onpong: {
          $prototype: "Function",
          body: [{ operator: "+=", target: { $ref: "#/state/n" }, value: 1 }],
        },
        state: { n: 0 },
        tagName: "ch-spellings",
        textContent: "${state.n}",
      },
      {
        onping: { $ref: "#/state/onPing" },
        state: { last: "", onPing: { $prototype: "Function", $src: "./lib.js" } },
        tagName: "ch-src",
      },
      /* A template that hands the scope itself to a helper, in each place a template is lowered:
         a computed state entry, a child's text, and a root attribute. */
      {
        attributes: { "data-twice": "${state.twice(state)}" },
        children: [
          { tagName: "b", textContent: "${state.twice(state)}" },
          { tagName: "i", textContent: "${state.sync}" },
        ],
        state: {
          n: 2,
          sync: "${state.twice(state)}",
          twice: { $prototype: "Function", $src: "./lib.js", parameters: ["scope"] },
        },
        tagName: "ch-scope",
      },
    ];
    for (const doc of docs) {
      const file = resolve(TMP, `${doc.tagName}.js`);
      writeFileSync(file, await moduleOf(doc), "utf8");
      await import(file);
    }
  }, 30_000);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("a click on a rendered child reaches the host handler and stops there", () => {
    const outer = win.document.createElement("div");
    win.document.body.append(outer);
    const selected: JsonValue[] = [];
    let clicks = 0;
    outer.addEventListener("select", (event) => {
      // The fixture dispatches `select` as a CustomEvent whose detail is its value.
      if (event instanceof win.CustomEvent) {
        selected.push(String(event.detail));
      }
    });
    outer.addEventListener("click", () => {
      clicks += 1;
    });
    const el = mount("ch-row", outer);
    el.querySelector("span")?.dispatchEvent(new win.Event("click", { bubbles: true }));
    expect(selected).toEqual(["copy"]);
    expect(clicks).toBe(0);
    // The handler reads the state at event time.
    el.state.disabled = true;
    el.dispatchEvent(new win.Event("click", { bubbles: true }));
    expect(selected).toEqual(["copy"]);
    outer.remove();
  });

  test("the host is event.currentTarget", () => {
    const el = mount("ch-row", win.document.body);
    el.querySelector("span")?.dispatchEvent(new win.Event("keydown", { bubbles: true }));
    expect(el.state.seen).toBe("CH-ROW:copy");
    el.remove();
  });

  test("every spelling listens, once per instance", () => {
    const el = mount("ch-spellings", win.document.body);
    for (const type of ["ping", "pong", "pang"]) {
      el.dispatchEvent(new win.Event(type));
    }
    expect(el.state.n).toBe(3);
    el.remove();
    win.document.body.append(el);
    el.dispatchEvent(new win.Event("ping"));
    expect(el.state.n).toBe(4);
    el.remove();
  });

  test("a bodyless $src root handler receives the state and the event", () => {
    const el = mount("ch-src", win.document.body);
    el.dispatchEvent(new win.Event("ping"));
    expect(el.state.last).toBe("ping");
    el.remove();
  });

  test("a template may hand the scope itself to a helper, as the interpreter lets it", () => {
    const el = mount("ch-scope", win.document.body);
    expect(el.querySelector("b")?.textContent).toBe("4");
    expect(el.querySelector("i")?.textContent).toBe("4");
    expect(el.dataset.twice).toBe("4");
    el.state.n = 5;
    expect(el.querySelector("b")?.textContent).toBe("10");
    expect(el.querySelector("i")?.textContent).toBe("10");
    expect(el.dataset.twice).toBe("10");
    el.remove();
  });

  test("root attributes are on the host, follow state, and leave when they resolve to nothing", () => {
    const el = mount("ch-row", win.document.body);
    expect(el.getAttribute("role")).toBe("option");
    expect(el.dataset.value).toBe("copy");
    expect(el.hasAttribute("aria-label")).toBe(false);
    expect(el.dataset.busy).toBeUndefined();
    el.state.label = "Copy";
    el.state.disabled = true;
    el.state.value = "paste";
    expect(el.getAttribute("aria-label")).toBe("Copy");
    expect(el.dataset.busy).toBe("");
    expect(el.dataset.value).toBe("paste");
    el.state.label = "";
    expect(el.hasAttribute("aria-label")).toBe(false);
    // Removed, the effects stop; put back, they run again from the state as it stands.
    el.remove();
    el.state.value = "cut";
    expect(el.dataset.value).toBe("paste");
    win.document.body.append(el);
    expect(el.dataset.value).toBe("cut");
    el.remove();
  });
});

describe("buildSite — a definition's root attributes are in the prerender", () => {
  const SITE = resolve(import.meta.dir, "__test-compiled-host-site__");
  const writeJSON = (path: string, value: JsonValue): void => {
    const full = resolve(SITE, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(value, null, 2), "utf8");
  };

  afterAll(() => {
    rmSync(SITE, { force: true, recursive: true });
  });

  test("on a static instance, a live one and a nested one, resolved against each instance", async () => {
    rmSync(SITE, { force: true, recursive: true });
    writeJSON("project.json", { build: { outDir: "./dist" }, name: "host" });
    // Static: no handler, no binding the build cannot finish. It never loads a module.
    writeJSON("components/x-chip.json", {
      attributes: { "data-tone": "${state.tone}", role: "note" },
      children: [{ tagName: "span", textContent: "${state.tone}" }],
      state: { tone: "info" },
      tagName: "x-chip",
    });
    writeJSON("components/x-press.json", {
      $elements: [{ $ref: "./x-chip.json" }],
      attributes: { "data-variant": "${state.variant}", id: "from-definition" },
      children: [{ $props: { tone: "warn" }, tagName: "x-chip" }],
      onclick: { $prototype: "Function", body: "state.n++" },
      state: { n: 0, variant: "secondary" },
      tagName: "x-press",
    });
    writeJSON("pages/index.json", {
      $elements: [{ $ref: "../components/x-chip.json" }, { $ref: "../components/x-press.json" }],
      children: [
        { tagName: "x-chip" },
        { $props: { variant: "accent" }, attributes: { id: "from-page" }, tagName: "x-press" },
      ],
      tagName: "main",
    });
    const { errors } = await buildSite(SITE);
    expect(errors).toEqual([]);
    const html = readFileSync(resolve(SITE, "dist/index.html"), "utf8");
    expect(html).toMatch(/<x-chip[^>]* data-tone="info"[^>]* role="note"/);
    // The live instance: resolved against its own props, the definition's value over the page's.
    expect(html).toMatch(/<x-press[^>]* id="from-definition"[^>]* data-variant="accent"/);
    expect(html).not.toContain("from-page");
    // And the instance one level down, against the props its parent gave it.
    expect(html).toMatch(/<x-chip[^>]* data-tone="warn"/);
  }, 30_000);
});
