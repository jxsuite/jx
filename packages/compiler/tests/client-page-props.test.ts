/**
 * Client-page-props.test.ts — executes a compiled page module in a DOM to prove a component
 * instance receives the props it binds, and again when the state changes (spec.md §13.3).
 *
 * Happy-dom globals are installed before the module is imported, as in compile-element-render.test.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNumber } from "@jxsuite/schema/guards";
import type { JxDocument } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import { compileClient } from "../src/targets/compile-client";

const TMP = resolve(import.meta.dir, "__test-client-page-props__");

const DOC: JxDocument = {
  children: [
    { id: "inc", onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "inc" },
    { $props: { count: { $ref: "#/state/n" } }, id: "card", tagName: "my-count" },
  ],
  state: { inc: { $prototype: "Function", body: "state.n++" }, n: 1 },
  tagName: "div",
  title: "Page",
};

let win: Window;

/** The element a query found, failing the suite when the page rendered none. */
function found(element: Element | null, selector: string): Element {
  if (!element) {
    throw new Error(`Expected the page to render ${selector}`);
  }
  return element;
}

/** The `count` property the page module wrote onto an element. */
function countOf(element: Element): number | undefined {
  return "count" in element && isNumber(element.count) ? element.count : undefined;
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });
  const result = compileClient(DOC, {});
  writeFileSync(resolve(TMP, "app.js"), result.files[0]!.content, "utf8");

  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(result.html)?.[1] ?? "";
  win.document.body.innerHTML = body.replaceAll(/<script[\s\S]*?<\/script>/g, "");
  await import(resolve(TMP, "app.js"));
  await new Promise((r) => {
    setTimeout(r, 20);
  });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a page module delivers a bound prop to an instance", () => {
  test("the page module sets the prop before the element upgrades", () => {
    const card = found(win.document.querySelector("#card"), "#card");
    expect(countOf(card)).toBe(1);
  });

  test("and sets it again when the state changes", () => {
    const button = found(win.document.querySelector("#inc"), "#inc");
    button.dispatchEvent(new win.Event("click", { bubbles: true }));
    const card = found(win.document.querySelector("#card"), "#card");
    expect(countOf(card)).toBe(2);
  });
});
