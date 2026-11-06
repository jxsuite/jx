/**
 * A whole-`children` template (spec.md §8.4), rendered from the source document rather than the
 * build's output, which is what Studio's Preview does with an item's parsed body.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { effectScope, reactive } from "@vue/reactivity";
import { renderNode } from "../src/runtime";
import type { JsonObject, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** A child definition, kept flat: `reactive` over the recursive element type never terminates. */
interface Leaf {
  tagName: string;
  textContent?: string;
}

/* SAFETY: deliberately outside the type, which a hand-edited document can be: the JSON reaches the
   renderer with nothing having checked it. */
const handEdited = (json: JsonObject) => json as JxElement;

/** Render an element definition, which `renderNode` answers with an element and not a Text. */
function render(def: JxElement, state: JxScope): HTMLElement {
  const node = renderNode(def, state);
  if (!(node instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return node;
}

describe("computed children", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("a row's template draws that row's nodes", () => {
    const state = reactive({
      team: [
        { $children: [{ tagName: "p", textContent: "First bio" }], id: "a" },
        { $children: [{ tagName: "p", textContent: "Second bio" }, "and text"], id: "b" },
      ],
    });
    const el = render(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/team" },
            map: { children: "${item.$children ?? []}", tagName: "section" },
          },
        ],
        tagName: "div",
      },
      state,
    );
    const sections = [...el.querySelectorAll("section")];
    expect(sections.map((s) => s.innerHTML)).toEqual([
      "<p>First bio</p>",
      "<p>Second bio</p>and text",
    ]);
  });

  test("an entry with no body draws nothing rather than failing", () => {
    const el = render(
      { children: "${state.entry.$children ?? []}", tagName: "div" },
      reactive({ entry: { id: "a" } }),
    );
    expect(el.childNodes).toHaveLength(0);
  });

  test("a template that yields no array draws nothing", () => {
    const el = render({ children: "${state.title}", tagName: "div" }, reactive({ title: "Words" }));
    expect(el.childNodes).toHaveLength(0);
    const mixed = render(
      { children: "a ${state.title}", tagName: "div" },
      reactive({ title: "Words" }),
    );
    expect(mixed.childNodes).toHaveLength(0);
  });

  test("a plain string is not a template, and draws nothing", () => {
    const el = render(handEdited({ children: "plain", tagName: "div" }), reactive({}));
    expect(el.childNodes).toHaveLength(0);
  });

  test("the children follow the value, so a collection still loading fills in", async () => {
    const state = reactive<{ entry: { $children: Leaf[] } | null }>({ entry: null });
    const el = render({ children: "${state.entry?.$children ?? []}", tagName: "div" }, state);
    expect(el.childNodes).toHaveLength(0);

    state.entry = { $children: [{ tagName: "p", textContent: "Loaded" }] };
    await flush();
    expect(el.innerHTML).toBe("<p>Loaded</p>");

    state.entry = { $children: [{ tagName: "h2", textContent: "Replaced" }] };
    await flush();
    expect(el.innerHTML).toBe("<h2>Replaced</h2>");

    state.entry = null;
    await flush();
    expect(el.childNodes).toHaveLength(0);
  });

  test("a binding inside the children tracks for itself, without redrawing them", async () => {
    const state = reactive({
      count: 1,
      nodes: [{ tagName: "p", textContent: "${state.count}" }],
    });
    const el = render({ children: "${state.nodes}", tagName: "div" }, state);
    const paragraph = el.querySelector("p")!;
    expect(paragraph.textContent).toBe("1");

    state.count = 2;
    await flush();
    expect(el.querySelector("p")).toBe(paragraph);
    expect(paragraph.textContent).toBe("2");
  });

  test("a child takes the namespace its parent gives its children", () => {
    const el = renderNode(
      { children: "${state.nodes}", tagName: "svg" },
      reactive({ nodes: [{ tagName: "circle" }] }),
    );
    if (!(el instanceof Element)) {
      throw new TypeError("expected an element");
    }
    expect(el.firstElementChild!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  test("each child is told its position", () => {
    const seen: (string | number)[][] = [];
    renderNode(
      { children: "${state.nodes}", tagName: "div" },
      reactive({ nodes: [{ tagName: "p" }] }),
      {
        _path: ["children", 0],
        onNodeCreated: (_el, path) => {
          seen.push([...path]);
        },
      },
    );
    expect(seen).toEqual([
      ["children", 0],
      ["children", 0, "children", 0],
    ]);
  });

  test("a template that throws draws nothing, and reports", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = reactive<{ nodes: Leaf[]; boom: boolean }>({
        boom: false,
        nodes: [{ tagName: "p" }],
      });
      const el = render(
        { children: "${state.boom ? missing.member : state.nodes}", tagName: "div" },
        state,
      );
      expect(el.childNodes).toHaveLength(1);

      state.boom = true;
      await flush();
      expect(el.childNodes).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("stopping the scope that drew them stops the bindings inside", async () => {
    const state = reactive({ count: 1, nodes: [{ tagName: "p", textContent: "${state.count}" }] });
    const scope = effectScope(true);
    let el: HTMLElement | undefined;
    scope.run(() => {
      el = render({ children: "${state.nodes}", tagName: "div" }, state);
    });
    scope.stop();

    state.count = 2;
    await flush();
    expect(el!.querySelector("p")!.textContent).toBe("1");
  });
});
