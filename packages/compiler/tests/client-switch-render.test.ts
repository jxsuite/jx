/**
 * Client-switch-render.test.ts — executes a dynamic page whose `$switch` sits in a lit region.
 *
 * Emitted-text assertions cannot tell a template hole that renders from one that is silently
 * dropped, so the compiled page is loaded into a DOM and driven. Happy-dom globals are installed
 * before the module is imported, because lit-html captures `document` at import time.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JxElement } from "@jxsuite/schema/types";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import { compileClient } from "../src/targets/compile-client";

const TMP = resolve(import.meta.dir, "__test-client-switch-render__");

let win: Window;
let root: Element;

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const rowSwitch: JxElement = {
  $switch: { $ref: "$map/item/kind" },
  attributes: { class: "slot" },
  cases: {
    a: { tagName: "b", textContent: "ROW-A" },
    b: {
      $switch: { $ref: "$map/item/sub" },
      cases: {
        x: { tagName: "i", textContent: "NESTED-X" },
        y: { tagName: "i", textContent: "NESTED-Y" },
      },
      tagName: "span",
    },
  },
  tagName: "li",
};

function slots(): Element[] {
  return [...root.querySelectorAll("li.slot")];
}

/** Press a page button, so the test drives state the way a visitor does. */
function press(id: string): void {
  const el = root.querySelector(`#${id}`);
  if (!el) {
    throw new Error(`Expected the page to hold #${id}`);
  }
  el.dispatchEvent(new win.Event("click"));
}

const button = (id: string, body: string): JxElement => ({
  id,
  onclick: { $prototype: "Function", body },
  tagName: "button",
});

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
  const { files, html } = compileClient(
    {
      children: [
        {
          children: [{ $prototype: "Array", items: { $ref: "#/state/rows" }, map: rowSwitch }],
          id: "page",
          tagName: "ul",
        },
        button("swap", "state.rows[0] = { kind: 'b', sub: 'y' }"),
        button("sub", "state.rows[1].sub = 'y'"),
      ],
      state: {
        rows: [
          { kind: "a", sub: "x" },
          { kind: "b", sub: "x" },
          { kind: "none", sub: "x" },
        ],
      },
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
  await settle();
}, 30_000);

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a dynamic page's switch inside a list row", () => {
  test("each row renders the case its item selects", () => {
    const rows = slots();

    expect(rows.map((li) => li.textContent.trim())).toEqual(["ROW-A", "NESTED-X", ""]);
  });

  test("replacing a row's item with a different key swaps that row's case", async () => {
    press("swap");
    await settle();

    expect(slots()[0]?.textContent.trim()).toBe("NESTED-Y");
  });

  test("a nested switch follows its own discriminant", async () => {
    press("sub");
    await settle();

    expect(slots()[1]?.textContent.trim()).toBe("NESTED-Y");
  });
});
