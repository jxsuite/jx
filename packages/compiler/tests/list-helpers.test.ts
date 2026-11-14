/**
 * Two list rules, two tiers (spec.md §10.3, §10.4): the interpreter's `mappedListItems` and
 * `mappedRowKeys`, and the copies a compiled module inlines (`listHelperSource`). The rules are
 * logic, so the guard is behavioural: the emitted source is loaded and both sides run over one
 * table and must answer alike, diagnostics included.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mappedListItems, mappedRowKeys } from "@jxsuite/runtime";
import type { JxScopeValue } from "@jxsuite/runtime/types";
import type { JxElement, JxMappedArray } from "@jxsuite/schema/types";
import {
  LIST_ITEMS_HELPER,
  LIST_KEYS_HELPER,
  buildInitialScope,
  keyPath,
  listHelperSource,
  listSettled,
  mappedArrayFeatures,
  pageImportMap,
  refuseTemplateItems,
} from "../src/shared";

/** The two functions a compiled module inlines, loaded from the source the compiler emits. */
interface ListHelpers {
  __jxListItems: (
    items: JxScopeValue,
    filter?: JxScopeValue,
    sort?: JxScopeValue,
  ) => JxScopeValue[];
  __jxRowKeys: (
    list: readonly JxScopeValue[],
    path: string[] | null,
    pointer: string | null,
    warn: (message: string) => void,
  ) => JxScopeValue[];
}

const dir = resolve(import.meta.dir, "__test-list-helpers__");
mkdirSync(dir, { recursive: true });
const helperFile = resolve(dir, "helpers.js");
writeFileSync(
  helperFile,
  `${listHelperSource()}\nexport { ${LIST_ITEMS_HELPER}, ${LIST_KEYS_HELPER} };\n`,
  "utf8",
);
/* SAFETY: the module written above exports exactly these two functions, from the source the
   compiler emits into every module that filters, sorts or keys a list. */
const helpers = (await import(helperFile)) as ListHelpers;

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("the emitted filter-and-sort rule is the interpreter's", () => {
  const items = [3, 1, 2];
  const over1 = (n: number) => n > 1;
  const ascending = (a: number, b: number) => a - b;

  test.each([
    ["a value that is not an array", "nope", over1, ascending],
    ["nothing at all", undefined, undefined, undefined],
    ["a filter and a sort that are not functions", items, "x", 7],
    ["a filter alone", items, over1, undefined],
    ["a sort alone", items, undefined, ascending],
    ["both", items, over1, ascending],
  ])("%s", (_label, source, filter, sort) => {
    expect(helpers.__jxListItems(source, filter, sort)).toEqual([
      ...mappedListItems(source, filter, sort),
    ]);
  });

  test("neither mutates the source, and with nothing to apply both return it", () => {
    const source = [3, 1, 2];
    expect(helpers.__jxListItems(source, over1, ascending)).toEqual([2, 3]);
    expect(mappedListItems(source, over1, ascending)).toEqual([2, 3]);
    expect(source).toEqual([3, 1, 2]);
    expect(helpers.__jxListItems(source)).toBe(source);
    expect(mappedListItems(source)).toBe(source);
  });

  test("a predicate is called with the item, its index and the list", () => {
    const seen: JxScopeValue[][] = [];
    const record = (...args: JxScopeValue[]) => {
      seen.push(args);
      return true;
    };
    const source = ["a"];
    expect(helpers.__jxListItems(source, record)).toEqual(["a"]);
    expect(mappedListItems(source, record)).toEqual(["a"]);
    expect(seen[0]).toEqual(["a", 0, source]);
    expect(seen[1]).toEqual(["a", 0, source]);
  });
});

describe("the emitted key rule is the interpreter's", () => {
  const LISTS = new Map<string, JxScopeValue[]>(
    Object.entries({
      "duplicate ids": [{ id: "a" }, { id: "a" }, { id: "b" }, { id: "a" }],
      "duplicate primitives": ["x", "y", "x"],
      ids: [{ id: "a" }, { id: "b" }],
      "missing ids": [{ id: "a" }, {}, { id: null }],
      nested: [
        { "a/b": 1, meta: { slug: "one" } },
        { "a/b": 2, meta: { slug: "two" } },
      ],
    }),
  );
  const POINTERS = [
    "$map/item",
    "$map/item/id",
    "#/$map/item/id",
    "$map/item/a~1b",
    "$map/item/meta/slug",
    "$map/index",
    "#/state/x",
  ];

  const names = [...LISTS.keys()];
  test.each(POINTERS.flatMap((pointer) => names.map((name) => [pointer, name])))(
    "%s over %s",
    (pointer, name) => {
      const list = LISTS.get(name!) ?? [];
      const emitted: string[] = [];
      const reference: string[] = [];
      const got = helpers.__jxRowKeys(list, keyPath(pointer!), pointer!, (m) => emitted.push(m));
      const want = mappedRowKeys(pointer!, list, (m) => reference.push(m));
      expect(got).toEqual(want);
      expect(emitted).toEqual(reference);
    },
  );

  test("no pointer keys every row by its index, without a word", () => {
    const messages: string[] = [];
    expect(helpers.__jxRowKeys(["a", "a"], null, null, (m) => messages.push(m))).toEqual([0, 1]);
    expect(mappedRowKeys(null, ["a", "a"], (m) => messages.push(m))).toEqual([0, 1]);
    expect(messages).toEqual([]);
  });

  test("keyPath splits a key pointer in either spelling, and refuses anything else", () => {
    expect(keyPath("$map/item")).toEqual([]);
    expect(keyPath("#/$map/item")).toEqual([]);
    expect(keyPath("$map/item/meta/a~1b")).toEqual(["meta", "a/b"]);
    expect(keyPath("#/$map/item/id")).toEqual(["id"]);
    expect(keyPath("$map/index")).toBeNull();
    expect(keyPath("#/state/id")).toBeNull();
  });
});

describe("what a document's lists need", () => {
  const list = (extra: JxElement): JxElement => ({
    $prototype: "Array",
    items: [],
    map: { tagName: "li" },
    ...extra,
  });

  test("mappedArrayFeatures finds a filter, a sort or a key wherever a list can sit", () => {
    expect(mappedArrayFeatures({ children: [list({})], tagName: "ul" })).toEqual({
      arranged: false,
      keyed: false,
    });
    // The whole `children` value.
    expect(
      mappedArrayFeatures({
        children: {
          $prototype: "Array",
          filter: { $ref: "#/state/f" },
          items: [],
          map: { tagName: "li" },
        },
        tagName: "ul",
      }),
    ).toEqual({ arranged: true, keyed: false });
    // Inside a row of another list.
    const sorted = list({ sort: { $ref: "#/state/s" } });
    const inRow = list({ map: { children: [sorted] } });
    expect(mappedArrayFeatures({ children: [inRow] }).arranged).toBe(true);
    // Inside a `$switch` case, past a case that is an external `$ref`.
    expect(
      mappedArrayFeatures({
        children: [
          {
            $switch: { $ref: "#/state/which" },
            cases: {
              a: { children: [list({ key: { $ref: "$map/item" } })], tagName: "ul" },
              b: { $ref: "./other.json" },
            },
          },
          "text",
        ],
      }),
    ).toEqual({ arranged: false, keyed: true });
    // A filter that is not a `$ref` is ignored in every tier, so it asks for nothing.
    expect(mappedArrayFeatures({ children: [list({ filter: "nope" })] }).arranged).toBe(false);
  });

  test("a template-string items is refused, and any other value is not", () => {
    expect(() => refuseTemplateItems({ items: "${state.rows}" })).toThrow(
      'A repeater\'s items must be a $ref or a literal array, not the template string "${state.rows}"',
    );
    expect(() => refuseTemplateItems({ items: "nope" })).not.toThrow();
    expect(() => refuseTemplateItems({ items: [] })).not.toThrow();
    expect(() => refuseTemplateItems({})).not.toThrow();
  });
});

describe("a list is settled when nothing it reads is runtime-only", () => {
  const scope = buildInitialScope(
    {
      add: { $prototype: "Function", body: "state.todos.push(1)" },
      feed: { $prototype: "Request", url: "/api" },
      keep: {
        $expression: { operator: "!", target: { $ref: "$args/item/done" } },
        parameters: ["item"],
      },
      open: {
        $expression: { operator: "===", target: { $ref: "#/state/todos" }, value: 1 },
        parameters: ["item"],
      },
      posts: ["a"],
      todos: [],
      visible: { $expression: { operator: "!", target: { $ref: "#/state/todos" } } },
    },
    null,
    { holdMutable: true },
  );
  /** The filter, sort and template a fixture list adds to its `items`. */
  type ListExtra = Pick<JxMappedArray, "filter" | "sort" | "map">;
  const over = (items: string, extra: ListExtra = {}): JxMappedArray => ({
    $prototype: "Array",
    items: { $ref: items },
    map: { tagName: "li" },
    ...extra,
  });

  test("a list over build-time data, filtered by a pure formula, is settled", () => {
    expect(listSettled(over("#/state/posts", { filter: { $ref: "#/state/keep" } }), scope)).toBe(
      true,
    );
    expect(listSettled({ $prototype: "Array", items: ["a"] }, scope)).toBe(true);
  });

  test("items, a filter or a sort that reads state a handler writes is not", () => {
    expect(listSettled(over("#/state/todos"), scope)).toBe(false);
    expect(listSettled(over("#/state/feed"), scope)).toBe(false);
    // A formula and an `$expression` computed that read the handler-written key are marked in turn.
    expect(listSettled(over("#/state/posts", { filter: { $ref: "#/state/open" } }), scope)).toBe(
      false,
    );
    expect(listSettled(over("#/state/posts", { sort: { $ref: "#/state/open" } }), scope)).toBe(
      false,
    );
    expect(listSettled(over("#/state/visible"), scope)).toBe(false);
  });

  test("a list nested in the template is asked too, through children and cases", () => {
    const nested = (inner: JxElement) => over("#/state/posts", { map: inner });
    const late = over("#/state/todos");
    // The same repeater as one child among siblings, which a document types as an element.
    const among = (ref: string): JxElement => ({
      $prototype: "Array",
      items: { $ref: ref },
      map: { tagName: "li" },
    });
    const lateChild = among("#/state/todos");
    const amongSiblings = nested({ children: [lateChild, "text"], tagName: "li" });
    expect(listSettled(amongSiblings, scope)).toBe(false);
    expect(listSettled(nested({ children: late, tagName: "li" }), scope)).toBe(false);
    const inCase = nested({
      $switch: { $ref: "$map/item" },
      cases: { a: { children: [lateChild] }, b: { $ref: "./x.json" } },
      tagName: "li",
    });
    expect(listSettled(inCase, scope)).toBe(false);
    const offTheRow = nested({ children: [among("$map/item/tags")], tagName: "li" });
    expect(listSettled(offTheRow, scope)).toBe(true);
  });
});

describe("pageImportMap", () => {
  test("the build's whole map wins, prefix keys included", () => {
    const map = pageImportMap({
      litHtmlSrc: "ignored",
      reactivitySrc: "ignored",
      runtimeImports: { "lit-html": "/assets/lit-html.js", "lit-html/": "/assets/lit-html/" },
    });
    expect(map).toContain('"lit-html/": "/assets/lit-html/"');
    expect(map).not.toContain("ignored");
  });

  test("the default CDN map carries the lit-html/ prefix, and a caller's own source does not", () => {
    const cdn = "https://esm.sh/lit-html@3.3.0";
    expect(pageImportMap({ litHtmlSrc: cdn, reactivitySrc: "/r.js" })).toContain(
      `"lit-html/": "${cdn}/"`,
    );
    expect(pageImportMap({ litHtmlSrc: "/vendor/lit.js", reactivitySrc: "/r.js" })).not.toContain(
      '"lit-html/"',
    );
  });
});
