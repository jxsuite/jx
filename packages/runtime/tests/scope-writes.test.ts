import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { buildScope, renderNode, runScoped } from "../src/runtime";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/**
 * The three spellings a handler that writes `state.count` can take; each reaches the scope
 * differently.
 */
const HANDLERS = {
  "a $expression": {
    $expression: { operator: "+=", target: { $ref: "#/state/count" }, value: 1 },
  },
  "a string body": { $prototype: "Function", body: "state.count += 1" },
  "a structured body": {
    $prototype: "Function",
    body: [{ operator: "+=", target: { $ref: "#/state/count" }, value: 1 }],
  },
};

const EXPRESSION = HANDLERS["a $expression"];

const COUNT = { count: { default: 0, type: "integer" } };

async function render(source: JsonValue): Promise<HTMLElement> {
  /* SAFETY: these literals are the documents under test. They carry `$`-local keys and bodies the
     authored document type does not spell, and the runtime reads them as untyped JSON regardless. */
  const doc = source as JxDocument;
  const scope = await buildScope(doc);
  /* SAFETY: every document here has a tagName at its root, so renderNode answers an element. */
  const el = runScoped(() => renderNode(doc, scope, { _path: [] })).result as HTMLElement;
  document.body.replaceChildren(el);
  return el;
}

async function clickAndRead(root: HTMLElement): Promise<string | null> {
  root.querySelector("button")!.click();
  await tick();
  return root.querySelector("p")!.textContent;
}

const output = { tagName: "p", textContent: "${state.count}" };

describe("a write from a child scope reaches the state it names", () => {
  for (const [name, onclick] of Object.entries(HANDLERS)) {
    test(`under a $-local binding, from ${name}`, async () => {
      const root = await render({
        $local: "x",
        children: [{ onclick, tagName: "button" }, output],
        state: COUNT,
        tagName: "div",
      });
      const first = await clickAndRead(root);
      const second = await clickAndRead(root);
      expect([first, second]).toEqual(["1", "2"]);
    });

    test(`from a $map row, with ${name}`, async () => {
      const root = await render({
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { onclick, tagName: "button" },
          },
          output,
        ],
        state: { ...COUNT, rows: { default: ["only"] } },
        tagName: "div",
      });
      expect(await clickAndRead(root)).toBe("1");
    });
  }

  test("through two child scopes at once", async () => {
    const root = await render({
      $local: "x",
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { $inner: "y", onclick: EXPRESSION, tagName: "button" },
        },
        output,
      ],
      state: { ...COUNT, rows: { default: ["only"] } },
      tagName: "div",
    });
    expect(await clickAndRead(root)).toBe("1");
  });

  test("a document-level $head does not cost the document its reactivity", async () => {
    // Studio's canvas adds `$head` to every document it renders, which is how this surfaced.
    const root = await render({
      $head: [],
      children: [{ onclick: EXPRESSION, tagName: "button" }, output],
      state: COUNT,
      tagName: "div",
    });
    expect(await clickAndRead(root)).toBe("1");
  });
});

describe("what a child scope owns stays its own", () => {
  test("a $-local shadows the state of the same name and does not write through", async () => {
    const root = await render({
      children: [
        {
          $count: "local",
          children: [{ tagName: "span", textContent: "${state.$count}" }],
          tagName: "section",
        },
        { tagName: "em", textContent: "${state.$count}" },
      ],
      state: { $count: { default: "root" } },
      tagName: "div",
    });
    expect(root.querySelector("span")!.textContent).toBe("local");
    expect(root.querySelector("em")!.textContent).toBe("root");
  });

  test("a handler's write to a local stays on the scope that declared it", async () => {
    const root = await render({
      children: [
        {
          $note: "before",
          children: [
            {
              onclick: {
                $prototype: "Function",
                body: "state.$note = 'after'; state.seen = state.$note",
              },
              tagName: "button",
            },
          ],
          tagName: "section",
        },
        { tagName: "p", textContent: "${state.seen}/${state.$note}" },
      ],
      state: { $note: { default: "root" }, seen: { default: "" } },
      tagName: "div",
    });
    root.querySelector("button")!.click();
    await tick();
    expect(root.querySelector("p")!.textContent).toBe("after/root");
  });

  test("nested $map rows each read their own $map", async () => {
    const root = await render({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            children: [
              {
                $prototype: "Array",
                items: ["inner"],
                map: { tagName: "span", textContent: "${$map.item}" },
              },
            ],
            tagName: "section",
          },
        },
      ],
      state: { rows: { default: ["outer"] } },
      tagName: "div",
    });
    expect(root.querySelector("span")!.textContent).toBe("inner");
  });

  test("a key no scope declares stays on the child that wrote it", async () => {
    const root = await render({
      children: [
        {
          $local: "x",
          children: [
            { onclick: { $prototype: "Function", body: "state.draft = 1" }, tagName: "button" },
            { tagName: "p", textContent: "${typeof state.draft}" },
          ],
          tagName: "section",
        },
        { tagName: "em", textContent: "${typeof state.draft}" },
      ],
      tagName: "div",
    });
    root.querySelector("button")!.click();
    await tick();
    expect(root.querySelector("em")!.textContent).toBe("undefined");
  });
});
