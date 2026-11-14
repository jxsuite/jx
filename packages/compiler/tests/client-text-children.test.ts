/**
 * Client-text-children.test.ts — a bound text child, executed (compiler.md §2.2).
 *
 * The emitter's own assertions are on bytes; this file runs the emitted module in a DOM, because
 * the binding is a contract between two comment nodes and a `Text` node the module has to find, and
 * only a parsed document shows whether the separator after the markers stays out of the bound
 * node.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JxDocument } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element, Node } from "happy-dom";
import { compileClient } from "../src/targets/compile-client";

const TMP = resolve(import.meta.dir, "__test-client-text__");

const doc: JxDocument = {
  children: [
    {
      children: [
        "Hello ${state.name}",
        { onclick: { $ref: "#/state/rename" }, tagName: "button", textContent: "Rename" },
      ],
      id: "live",
      tagName: "div",
    },
    {
      children: ["Total: ${state.total}", { tagName: "b", textContent: "!" }],
      id: "baked",
      tagName: "div",
    },
  ],
  state: {
    name: "World",
    rename: { $prototype: "Function", body: "state.name = 'Ada'" },
    total: 3,
  },
  tagName: "main",
};

let win: Window;
let live: Element;
let baked: Element;
let button: Element;
let bakedTextBefore: Node | null;

function required(selector: string): Element {
  const found = win.document.querySelector(selector);
  if (found === null) {
    throw new Error(`Expected ${selector} in the compiled page`);
  }
  return found;
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });
  const { html, files } = compileClient(doc, {});
  writeFileSync(resolve(TMP, "app.js"), files[0]!.content, "utf8");

  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    document: win.document,
    window: win.window,
  });
  win.document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  live = required("#live");
  baked = required("#baked");
  button = required("#live button");
  bakedTextBefore = baked.firstChild?.nextSibling ?? null;

  await import(resolve(TMP, "app.js"));
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a bound text child in a hydrated page (compiler.md §2.2)", () => {
  test("a runtime-only text child is filled at hydration and follows state", () => {
    expect(live.textContent).toContain("Hello World");
    // The separator the emitter writes between siblings is its own text node, outside the markers.
    const separator = button.previousSibling;
    expect(separator?.nodeType).toBe(3);
    expect(separator?.textContent.trim()).toBe("");

    button.dispatchEvent(new win.Event("click"));

    expect(live.textContent).toContain("Hello Ada");
    expect(live.textContent).not.toContain("World");
    expect(win.document.querySelector("#live button")).toBe(button);
    expect(button.previousSibling).toBe(separator);
  });

  test("a prerendered text node is reused, not duplicated", () => {
    expect(bakedTextBefore?.nodeType).toBe(3);
    expect(baked.firstChild?.nextSibling).toBe(bakedTextBefore);
    expect(baked.textContent.split("Total: 3").length).toBe(2);
  });
});
