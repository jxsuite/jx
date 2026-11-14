/**
 * Compiled-lists.test.ts — what each compiled path emits for a mapped array's `filter`, `sort` and
 * `key` (spec.md §10.3, §10.4, compiler.md §4.7), and what the site build does with one.
 *
 * `list-render.test.ts` drives the emitted modules; this file pins the lowering itself: which of
 * the three forms a list takes, which helpers and imports a module carries, and that a module with
 * no such list is byte-for-byte what it was.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonValue, JxDocument, JxElement } from "@jxsuite/schema/types";
import { compile } from "../src/compiler";
import { buildSite } from "../src/site/site-build";
import { compileClient } from "../src/targets/compile-client";
import { compileElement, compileElementPage } from "../src/targets/compile-element";

const list = (extra: JxElement = {}): JxElement => ({
  $prototype: "Array",
  items: { $ref: "#/state/rows" },
  map: { tagName: "li", textContent: { $ref: "$map/item" } },
  ...extra,
});

const FILTER = { filter: { $ref: "#/state/keep" }, sort: { $ref: "#/state/order" } };
const KEY = { key: { $ref: "#/$map/item/id" } };

const element = async (child: JxElement): Promise<string> => {
  const { files } = await compileElement({
    children: [{ children: [child], tagName: "ul" }],
    state: { rows: [] },
    tagName: "x-list",
  });
  return files[0]!.content;
};

const page = (children: NonNullable<JxDocument["children"]>): string =>
  compileClient({ children, state: { rows: [] }, tagName: "main" }, {}).files[0]!.content;

describe("the element target", () => {
  test("a list without filter, sort or key compiles to a plain .map with no helper", async () => {
    const source = await element(list());
    expect(source).toContain("${(s.rows ?? []).map((item, index) =>");
    expect(source).not.toContain("__jxListItems");
    expect(source).not.toContain("__jxKeyed");
    expect(source).not.toContain("lit-html/");
    expect(source).not.toContain("#part");
    expect(source).toContain("import { reactive, computed, effect, stop } from '@vue/reactivity';");
  });

  test("filter and sort wrap items in __jxListItems", async () => {
    const source = await element(list(FILTER));
    expect(source).toContain("${__jxListItems((s.rows ?? []), s.keep, s.order).map((item, index)");
    expect(source).toContain("function __jxListItems(items, filter, sort) {");
    expect(source).not.toContain("__jxKeyed");
    expect(source).not.toContain("lit-html/directives/repeat.js");
    // One of the two is enough, and the other is passed as nothing.
    expect(await element(list({ sort: { $ref: "#/state/order" } }))).toContain(
      "__jxListItems((s.rows ?? []), undefined, s.order)",
    );
  });

  test("a keyed list renders through __jxKeyed with its key path", async () => {
    const source = await element(list({ ...FILTER, ...KEY }));
    expect(source).toContain(
      '${__jxKeyed((s.rows ?? []), s.keep, s.order, ["id"], "#/$map/item/id", (item, index) =>',
    );
    expect(source).toContain("import { repeat } from 'lit-html/directives/repeat.js';");
    expect(source).toContain(
      "import { AsyncDirective, directive } from 'lit-html/async-directive.js';",
    );
    expect(source).toContain("stop, shallowRef } from '@vue/reactivity';");
    expect(source).toContain("const __jxKeyed = directive(__JxKeyedList);");
  });

  test("a module with a keyed list tells lit when its host leaves and returns", async () => {
    const source = await element(list(KEY));
    expect(source).toContain("  #part = null;");
    expect(source).toContain("this.#part?.setConnected(true);");
    expect(source).toContain("this.#part?.setConnected(false);");
    expect(source).toContain("effect(() => { this.#part = render(this.template(), this); })");
  });

  test("a keyed shadow component keeps its part too", async () => {
    const { files } = await compileElement({
      $shadow: "open",
      children: [list(KEY)],
      state: { rows: [] },
      tagName: "x-shadow-list",
    });
    expect(files[0]!.content).toContain(
      "effect(() => { this.#part = render(this.template(), _root); })",
    );
  });

  test("a keyed list over a literal array holds it across renders", async () => {
    const source = await element(list({ items: ["a", "b"], key: { $ref: "$map/item" } }));
    expect(source).toContain(
      String.raw`__jxKeyed(__jxLiteral("[\"a\",\"b\"]"), undefined, undefined, [],`,
    );
  });

  test("a #/$map pointer in a row binding reads the loop variable", async () => {
    const source = await element(
      list({
        map: {
          $props: { label: { $ref: "#/$map/item/name" } },
          tagName: "x-chip",
          title: { $ref: "#/$map/item/name" },
        },
      }),
    );
    expect(source).toContain('.title="${item.name}"');
    expect(source).toContain('.label="${item.name}"');
    expect(source).not.toContain('["#"]');
  });

  test("the page import map is the runtimeImports passed in, and the CDN map has the prefix", async () => {
    const doc: JxDocument = { children: [list(KEY)], state: { rows: [] }, tagName: "x-page-list" };
    const built = await compileElementPage(doc, {
      runtimeImports: { "lit-html": "/a/lit.js", "lit-html/": "/a/lit/" },
    });
    expect(built.html).toContain('"lit-html/": "/a/lit/"');
    const standalone = await compileElementPage(doc);
    expect(standalone.html).toContain('"lit-html/": "https://esm.sh/lit-html@3.3.0/"');
  });
});

describe("the client target", () => {
  test("a list without filter, sort or key compiles to a plain .map with no helper", () => {
    const source = page({
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { tagName: "li" },
    });
    expect(source).toContain("() => (state.rows ?? []).map((item, index) => html`<li></li>`)");
    expect(source).not.toContain("__jxListItems");
    expect(source).not.toContain("lit-html/");
  });

  test("filter and sort wrap both client list emitters", () => {
    const whole = page({
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { tagName: "li" },
      ...FILTER,
    });
    expect(whole).toContain(
      "() => __jxListItems(state.rows, state.keep, state.order).map((item, index) =>",
    );
    expect(whole).toContain("function __jxListItems(items, filter, sort) {");
    // A hole among siblings, and one nested in a row (reached through the row template).
    const among = page([
      { tagName: "h1", textContent: "Rows" },
      list({
        ...FILTER,
        map: { children: [{ tagName: "b" }, list({ items: { $ref: "$map/item/kids" } })] },
      }),
    ]);
    expect(among).toContain("${__jxListItems(state.rows, state.keep, state.order).map(");
    // A nested list reads its items off the row, not off a flattened state member.
    expect(among).toContain("${(item.kids ?? []).map((item, index) =>");
  });

  test("items at a nested path read state.user.posts", () => {
    expect(page([list({ items: { $ref: "#/state/user/posts" } })])).toContain(
      "(state.user?.posts ?? []).map(",
    );
  });

  test("a row's $ref textContent and bound attribute read the loop variable", () => {
    const source = page([
      list({
        map: {
          attributes: { "data-id": { $ref: "$map/item/id" } },
          tagName: "li",
          textContent: { $ref: "$map/item/name" },
        },
      }),
    ]);
    expect(source).toContain('<li data-id="${item.id}">${item.name}</li>');
    expect(source).not.toContain("$map_item");
  });

  test("a keyed list renders through __jxKeyed with its key path", () => {
    const source = page([list({ ...FILTER, ...KEY })]);
    expect(source).toContain(
      '${__jxKeyed((state.rows ?? []), state.keep, state.order, ["id"], "#/$map/item/id", (item, index) =>',
    );
    expect(source).toContain(
      "import { reactive, effect, stop, shallowRef } from '@vue/reactivity';",
    );
    expect(source).toContain("import { repeat } from 'lit-html/directives/repeat.js';");
    expect(page([list({ items: ["a"], key: { $ref: "$map/item" } })])).toContain(
      String.raw`__jxKeyed((__jxLiteral("[\"a\"]") ?? []), undefined, undefined, [],`,
    );
  });

  test("a #/$map pointer in a row prop reads the loop variable", () => {
    const source = page([
      list({ map: { $props: { label: { $ref: "#/$map/item/name" } }, tagName: "x-chip" } }),
    ]);
    expect(source).toContain('.label="${item.name}"');
  });

  test("a template string as items is refused", () => {
    expect(() => page([list({ items: "${state.rows}" })])).toThrow("not the template string");
  });

  test("the page import map is the runtimeImports passed in, and the CDN map has the prefix", () => {
    const doc: JxDocument = { children: [list(KEY)], state: { rows: [] }, tagName: "main" };
    const imports = { "lit-html": "/a/lit.js", "lit-html/": "/a/lit/" };
    expect(compileClient(doc, { runtimeImports: imports }).html).toContain(
      '"lit-html/": "/a/lit/"',
    );
    expect(compileClient(doc, {}).html).toContain('"lit-html/": "https://esm.sh/lit-html@3.3.0/"');
  });
});

describe("compile()", () => {
  test("forwards runtimeImports to the page it writes, on either route", async () => {
    const runtimeImports = { "lit-html": "/a/lit.js", "lit-html/": "/a/lit/" };
    const asElement = await compile(
      { children: [list(KEY)], state: { rows: [] }, tagName: "x-routed" },
      { runtimeImports },
    );
    expect(asElement.html).toContain('"lit-html/": "/a/lit/"');
    const asPage = await compile(
      { children: [list(KEY)], state: { rows: [] }, tagName: "main" },
      { runtimeImports },
    );
    expect(asPage.html).toContain('"lit-html/": "/a/lit/"');
    const standalone = await compile({ children: [list()], state: { rows: [] }, tagName: "x-cdn" });
    expect(standalone.html).toContain('"lit-html/": "https://esm.sh/lit-html@3.3.0/"');
  });
});

describe("buildSite — lists", () => {
  const TMP = resolve(import.meta.dir, "__test-compiled-lists__");
  let errors: string[] = [];

  const writeJSON = (path: string, value: JsonValue): void => {
    const full = resolve(TMP, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(value, null, 2), "utf8");
  };
  const read = (path: string): string => readFileSync(resolve(TMP, "dist", path), "utf8");
  const body = (path: string): string =>
    (/<main[\s\S]*<\/main>/.exec(read(path))?.[0] ?? "").replaceAll(/>\s+</g, "><");

  const formulas = {
    byN: {
      $expression: { operator: "-", target: { $ref: "$args/a/n" }, value: { $ref: "$args/b/n" } },
      parameters: ["a", "b"],
    },
    isOn: {
      $expression: { operator: "===", target: { $ref: "$args/item/on" }, value: true },
      parameters: ["item"],
    },
  };
  const rows = [
    { n: 3, name: "c", on: true },
    { n: 1, name: "a", on: false },
    { n: 2, name: "b", on: true },
  ];
  const row = { tagName: "li", textContent: "${$map.item.name}" };

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON("project.json", {
      build: { outDir: "./dist" },
      defaults: { layout: false },
      name: "Lists",
    });
    writeJSON("pages/index.json", { tagName: "main", textContent: "Home" });
    // Build-time data: expanded at build time, filtered then sorted.
    writeJSON("pages/settled.json", {
      children: [
        {
          children: [
            {
              $prototype: "Array",
              filter: { $ref: "#/state/isOn" },
              items: { $ref: "#/state/rows" },
              map: row,
              sort: { $ref: "#/state/byN" },
            },
          ],
          tagName: "ul",
        },
      ],
      state: { ...formulas, rows },
      tagName: "main",
    });
    // A list a handler changes: left for the client, keyed, so the page imports lit subpaths.
    writeJSON("pages/todos.json", {
      children: [
        {
          children: [
            {
              $prototype: "Array",
              items: { $ref: "#/state/rows" },
              key: { $ref: "$map/item/name" },
              map: row,
            },
          ],
          tagName: "ul",
        },
        {
          onclick: {
            $prototype: "Function",
            body: "state.rows.push({ n: 9, name: 'z', on: true })",
          },
          tagName: "button",
          textContent: "Add",
        },
      ],
      state: { rows },
      tagName: "main",
    });
    // The usual alternative to `filter`: an `$expression` computed over the handler-written list.
    writeJSON("pages/computed.json", {
      children: [
        {
          children: [{ $prototype: "Array", items: { $ref: "#/state/shown" }, map: row }],
          tagName: "ul",
        },
        { onclick: { $prototype: "Function", body: "state.rows.pop()" }, tagName: "button" },
      ],
      state: {
        rows,
        shown: {
          $expression: {
            operator: "filter",
            target: { $ref: "#/state/rows" },
            value: {
              $expression: { operator: "===", target: { $ref: "$map/item/on" }, value: true },
            },
          },
        },
      },
      tagName: "main",
    });
    // An outer list over build-time data whose rows hold a list over handler-written state.
    writeJSON("pages/nested.json", {
      children: [
        {
          children: [
            {
              $prototype: "Array",
              items: { $ref: "#/state/groups" },
              map: {
                children: [
                  { tagName: "b", textContent: "${$map.item}" },
                  { $prototype: "Array", items: { $ref: "#/state/rows" }, map: row },
                ],
                tagName: "li",
              },
            },
          ],
          tagName: "ul",
        },
        { onclick: { $prototype: "Function", body: "state.rows.pop()" }, tagName: "button" },
      ],
      state: { groups: ["g1", "g2"], rows },
      tagName: "main",
    });
    ({ errors } = await buildSite(TMP));
  }, 60_000);

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  test("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  test("applies filter and sort to a list expanded at build time", () => {
    expect(body("settled/index.html")).toContain("<ul><li>b</li><li>c</li></ul>");
  });

  test("leaves a list over handler-written state for the client", () => {
    expect(body("todos/index.html")).not.toContain("<li>");
    expect(read("todos/app.js")).toContain("__jxKeyed((state.rows ?? []),");
  });

  test("a dynamic page's own import map carries the prefix keys, and the subpaths are written", () => {
    expect(read("todos/index.html")).toContain('"lit-html/": "/assets/lit-html/"');
    expect(existsSync(resolve(TMP, "dist/assets/lit-html/directives/repeat.js"))).toBe(true);
    expect(existsSync(resolve(TMP, "dist/assets/lit-html/async-directive.js"))).toBe(true);
  });

  test("leaves a list over an $expression computed of handler-written state for the client", () => {
    expect(body("computed/index.html")).not.toContain("<li>");
    expect(read("computed/app.js")).toContain("(state.shown ?? []).map(");
  });

  test("leaves an outer list when a nested list reads runtime-only state", () => {
    expect(body("nested/index.html")).not.toContain("<li>");
    expect(read("nested/app.js")).toContain("(state.groups ?? []).map(");
  });
});
