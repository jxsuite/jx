/**
 * List-render.test.ts — executes compiled lists in a DOM, in both compiled targets.
 *
 * `filter`, `sort` and `key` (spec.md §10.3, §10.4) are properties of what a list does over time: a
 * row that keeps its node across a reorder, a reconciliation that waits for the microtask. None of
 * that can be read off emitted source, so each fixture is compiled, imported and driven.
 *
 * Happy-dom globals are installed before any module is imported, because lit-html captures
 * `document` at import time. Modules are imported one at a time.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonValue, JxDocument, JxElement } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element, HTMLElement } from "happy-dom";
import { compileClient } from "../src/targets/compile-client";
import { compileElement } from "../src/targets/compile-element";

const TMP = resolve(import.meta.dir, "__test-list-render__");

/** A list's reactive state as each fixture declares it. */
interface ListState {
  rows: { id: string; n: number; on: boolean }[];
  label: string;
}

/** A compiled element with the state its module builds. */
type ListElement = Element & { state: ListState };

function isListElement(element: Element): element is ListElement {
  return "state" in element;
}

let win: Window;

/** One microtask turn, twice: the list's own, then the host render it triggers. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const ROWS: JsonValue = [
  { id: "a", n: 3, on: true },
  { id: "b", n: 1, on: false },
  { id: "c", n: 2, on: true },
];

/** Named formulas: the form every tier calls the same way (spec.md §10.3). */
const FORMULAS = {
  byN: {
    $expression: { operator: "-", target: { $ref: "$args/a/n" }, value: { $ref: "$args/b/n" } },
    parameters: ["a", "b"],
  },
  isOn: {
    $expression: { operator: "===", target: { $ref: "$args/item/on" }, value: true },
    parameters: ["item"],
  },
} satisfies Record<string, JsonValue>;

const rowTemplate = {
  attributes: { "data-id": { $ref: "$map/item/id" } },
  tagName: "li",
  textContent: "${$map.item.id}${$map.item.n}${state.label}",
};

/** The list every fixture renders, with the keys under test added. */
const listNode = (extra: Record<string, JsonValue>): JxElement => ({
  children: [
    { tagName: "li", textContent: "head" },
    { $prototype: "Array", items: { $ref: "#/state/rows" }, map: rowTemplate, ...extra },
  ],
  tagName: "ul",
});

const ARRANGED = { filter: { $ref: "#/state/isOn" }, sort: { $ref: "#/state/byN" } };
const KEYED = { key: { $ref: "$map/item/id" } };

function elementDoc(tagName: string, extra: Record<string, JsonValue>): JxDocument {
  return {
    children: [listNode(extra)],
    state: { ...FORMULAS, label: "", rows: ROWS },
    tagName,
  };
}

/** The row elements a host shows, in DOM order. */
const rowsOf = (host: Element): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>("li[data-id]"),
];

/** The ids of the rows a host shows, in DOM order. */
const ids = (host: Element): string[] => rowsOf(host).map((li) => li.dataset.id ?? "");

/** The row nodes by id. */
function nodesById(host: Element): Map<string, Element> {
  return new Map(rowsOf(host).map((li) => [li.dataset.id ?? "", li]));
}

async function defineElement(doc: JxDocument): Promise<void> {
  const { files } = await compileElement(doc);
  const file = resolve(TMP, `${doc.tagName}.js`);
  writeFileSync(file, files[0]!.content, "utf8");
  await import(file);
}

/** Mount a compiled element and hand back the host with its state. */
function mountElement(tagName: string): ListElement {
  const host = win.document.createElement(tagName);
  win.document.body.append(host);
  if (!isListElement(host)) {
    throw new Error(`Expected <${tagName}> to carry its state`);
  }
  return host;
}

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
  await defineElement(elementDoc("lr-arranged", ARRANGED));
  await defineElement(elementDoc("lr-keyed", KEYED));
  await defineElement(elementDoc("lr-both", { ...ARRANGED, ...KEYED }));
  await defineElement(elementDoc("lr-hash", { key: { $ref: "#/$map/item/id" } }));
  await defineElement(elementDoc("lr-nokey", { key: { $ref: "$map/item/missing" } }));
  await defineElement({
    children: [
      {
        children: [
          {
            $prototype: "Array",
            items: ["x", "y"],
            key: { $ref: "$map/item" },
            map: { attributes: { "data-id": { $ref: "$map/item" } }, tagName: "li" },
          },
        ],
        tagName: "ul",
      },
      { tagName: "p", textContent: "${state.label}" },
    ],
    state: { label: "" },
    tagName: "lr-literal",
  });
  await defineElement({
    children: [
      listNode({
        filter: { $ref: "#/state/counted" },
        ...KEYED,
      }),
    ],
    state: {
      // A string body is called as `Array.prototype.filter` calls it, so it counts on the document.
      counted: {
        $prototype: "Function",
        body: "document.body.dataset.lrCalls = String(Number(document.body.dataset.lrCalls ?? 0) + 1); return true;",
        parameters: ["item"],
      },
      label: "",
      rows: ROWS,
    },
    tagName: "lr-counted",
  });
}, 30_000);

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a compiled element's list", () => {
  test("renders only the rows the filter keeps, in comparator order", () => {
    const host = mountElement("lr-arranged");
    expect(ids(host)).toEqual(["c", "a"]);
    host.remove();
  });

  test("re-filters when a field the filter reads changes", async () => {
    const host = mountElement("lr-arranged");
    host.state.rows[1]!.on = true;
    await settle();
    expect(ids(host)).toEqual(["b", "c", "a"]);
    host.state.rows[1]!.on = false;
    host.remove();
  });

  test("a keyed row keeps its node across an in-place reverse and a sort", async () => {
    const host = mountElement("lr-keyed");
    const before = nodesById(host);
    host.state.rows.reverse();
    await settle();
    expect(ids(host)).toEqual(["c", "b", "a"]);
    host.state.rows.sort((x, y) => x.n - y.n);
    await settle();
    expect(ids(host)).toEqual(["b", "c", "a"]);
    const after = nodesById(host);
    for (const id of ["a", "b", "c"]) {
      expect(after.get(id)).toBe(before.get(id));
    }
    host.state.rows.sort((x, y) => x.id.localeCompare(y.id));
    await settle();
    host.remove();
  });

  test("an in-place reverse changes nothing on screen until the microtask", async () => {
    const host = mountElement("lr-keyed");
    const text = () => rowsOf(host).map((li) => li.textContent);
    const before = text();
    host.state.rows.reverse();
    // Synchronously, each row node still shows its own item: nothing was written across rows.
    expect(text()).toEqual(before);
    await settle();
    expect(text()).toEqual(before.toReversed());
    host.state.rows.reverse();
    await settle();
    host.remove();
  });

  test("an insertion creates only the new row and a removal removes only its row", async () => {
    const host = mountElement("lr-keyed");
    const before = nodesById(host);
    host.state.rows.splice(1, 0, { id: "z", n: 9, on: true });
    await settle();
    expect(ids(host)).toEqual(["a", "z", "b", "c"]);
    expect(nodesById(host).get("c")).toBe(before.get("c"));
    host.state.rows.splice(1, 1);
    await settle();
    expect(ids(host)).toEqual(["a", "b", "c"]);
    expect(nodesById(host).get("b")).toBe(before.get("b"));
    host.remove();
  });

  test("a row's own binding updates synchronously", () => {
    const host = mountElement("lr-keyed");
    host.state.label = "!";
    expect(host.querySelector('li[data-id="a"]')?.textContent).toBe("a3!");
    host.state.label = "";
    host.remove();
  });

  test("filter, sort and key together keep the rows the filter still passes", async () => {
    const host = mountElement("lr-both");
    expect(ids(host)).toEqual(["c", "a"]);
    const kept = nodesById(host).get("a");
    host.state.rows[1]!.on = true;
    await settle();
    expect(ids(host)).toEqual(["b", "c", "a"]);
    expect(nodesById(host).get("a")).toBe(kept);
    host.state.rows[1]!.on = false;
    await settle();
    host.remove();
  });

  test("a key spelled #/$map/item/id keys by that field", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = mountElement("lr-hash");
      const before = nodesById(host);
      host.state.rows.reverse();
      await settle();
      expect(nodesById(host).get("a")).toBe(before.get("a"));
      expect(warn).not.toHaveBeenCalled();
      host.state.rows.reverse();
      await settle();
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  test("a duplicate key warns once and renders every row", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = mountElement("lr-keyed");
      host.state.rows.push({ id: "a", n: 7, on: true }, { id: "a", n: 8, on: true });
      await settle();
      expect(ids(host)).toEqual(["a", "b", "c", "a", "a"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toStartWith("Jx $map: duplicate key a");
      host.state.rows.splice(3, 2);
      await settle();
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  test("an empty key falls back to the index with one warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const host = mountElement("lr-nokey");
      expect(ids(host)).toEqual(["a", "b", "c"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toBe(
        'Jx $map: key "$map/item/missing" is empty for some items — those rows fall back to their index',
      );
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  test("a keyed list over a literal array settles, and its rows survive a host re-render", async () => {
    const host = mountElement("lr-literal");
    const before = nodesById(host);
    expect(ids(host)).toEqual(["x", "y"]);
    host.state.label = "again";
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("again");
    expect(nodesById(host).get("x")).toBe(before.get("x"));
    host.remove();
  });

  test("removing the host stops the list's effect, and putting it back restarts it", async () => {
    const count = () => Number(win.document.body.dataset.lrCalls ?? 0);
    const host = mountElement("lr-counted");
    await settle();
    host.remove();
    const calls = count();
    expect(calls).toBeGreaterThan(0);
    host.state.rows.push({ id: "q", n: 4, on: true });
    await settle();
    // Nothing called the predicate for an element that is not in a document.
    expect(count()).toBe(calls);
    win.document.body.append(host);
    await settle();
    expect(count()).toBeGreaterThan(calls);
    expect(ids(host)).toEqual(["a", "b", "c", "q"]);
    host.state.rows.pop();
    await settle();
    host.remove();
  });
});

describe("a dynamic page's list", () => {
  let root: Element;

  /** A handler the page binds to a button, so the test drives state the way a visitor does. */
  const button = (id: string, body: string): JxElement => ({
    id,
    onclick: { $prototype: "Function", body },
    tagName: "button",
  });

  beforeAll(async () => {
    const { files, html } = compileClient(
      {
        children: [
          { id: "arranged", ...listNode(ARRANGED) },
          { id: "keyed", ...listNode(KEYED) },
          {
            children: {
              $prototype: "Array",
              items: { $ref: "#/state/rows" },
              map: rowTemplate,
              ...ARRANGED,
              ...KEYED,
            },
            id: "whole",
            tagName: "ol",
          },
          button(
            "toggle",
            "state.rows.find((row) => row.id === 'b').on = !state.rows.find((row) => row.id === 'b').on",
          ),
          button("reverse", "state.rows.reverse()"),
          button("label", "state.label = state.label ? '' : '?'"),
        ],
        state: { ...FORMULAS, label: "", rows: ROWS },
        tagName: "main",
      },
      { modulePath: "page.js" },
    );
    root = win.document.createElement("div");
    root.innerHTML = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"));
    win.document.body.append(root);
    const file = resolve(TMP, "page.js");
    writeFileSync(file, files[0]!.content, "utf8");
    await import(file);
  }, 30_000);

  const part = (id: string): Element => {
    const el = root.querySelector(`#${id}`);
    if (!el) {
      throw new Error(`Expected the page to hold #${id}`);
    }
    return el;
  };
  const press = (id: string): void => {
    part(id).dispatchEvent(new win.Event("click"));
  };

  test("renders only the rows the filter keeps, in comparator order", () => {
    expect(ids(part("arranged"))).toEqual(["c", "a"]);
    expect(ids(part("whole"))).toEqual(["c", "a"]);
  });

  test("re-filters when a field the filter reads changes", async () => {
    press("toggle");
    await settle();
    expect(ids(part("arranged"))).toEqual(["b", "c", "a"]);
    expect(ids(part("whole"))).toEqual(["b", "c", "a"]);
    press("toggle");
    await settle();
    expect(ids(part("whole"))).toEqual(["c", "a"]);
  });

  test("a keyed row keeps its node across an in-place reverse", async () => {
    const before = nodesById(part("keyed"));
    press("reverse");
    await settle();
    expect(ids(part("keyed"))).toEqual(["c", "b", "a"]);
    const after = nodesById(part("keyed"));
    for (const id of ["a", "b", "c"]) {
      expect(after.get(id)).toBe(before.get(id));
    }
    press("reverse");
    await settle();
  });

  test("a row's own binding updates synchronously", () => {
    press("label");
    expect(part("keyed").querySelector('li[data-id="a"]')?.textContent).toBe("a3?");
    press("label");
  });
});
