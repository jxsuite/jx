/**
 * A string member of a `children` array that resolves to an array of nodes (spec.md §8.4): the site
 * build's template pass splices the nodes in where the string stood, and the interpreter draws the
 * same thing.
 *
 * The parity fixtures compare against a hand-written expected document, not against the build
 * itself: `resolveDocTemplates` is private to `packages/compiler`, and the compiler depends on the
 * runtime rather than the reverse, so this workspace cannot import it. Each expected document is
 * what that pass leaves for the fixture's state, read off its rules: any array is spliced, every
 * member of it, and a value that is not an array leaves the string a text child.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { effectScope, reactive } from "@vue/reactivity";
import { defineElement, renderNode } from "../src/runtime";
import type { JsonObject, JxElement, JxPath } from "@jxsuite/schema/types";
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
type Leaf = Record<"tagName" | "textContent", string> | Record<"tagName", string>;

/* SAFETY: deliberately outside the type, which a resolved value can be: the array a template
   yields reaches the renderer with nothing having checked its members. */
const unchecked = (json: JsonObject) => json as JxElement;

/** Render an element definition, which `renderNode` answers with an element and not a Text. */
function render(
  def: JxElement,
  state: JxScope,
  options?: Parameters<typeof renderNode>[2],
): HTMLElement {
  const node = renderNode(def, state, options);
  if (!(node instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return node;
}

/** The text nodes among an element's children that hold any text. */
const texts = (el: Element) =>
  [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent !== "");

describe("a templated string child that resolves to nodes — parity with the site build", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("the nodes stand where the string stood, among their siblings", () => {
    const state = () =>
      reactive({
        body: [
          { tagName: "p", textContent: "First" },
          { tagName: "p", textContent: "Second" },
        ],
      });
    const source = render(
      {
        children: [{ tagName: "h1", textContent: "Title" }, "${state.body}", { tagName: "hr" }],
        tagName: "article",
      },
      state(),
    );
    // What `resolveDocTemplates` leaves: the string replaced by the two members, the rule moved on.
    const built = render(
      {
        children: [
          { tagName: "h1", textContent: "Title" },
          { tagName: "p", textContent: "First" },
          { tagName: "p", textContent: "Second" },
          { tagName: "hr" },
        ],
        tagName: "article",
      },
      state(),
    );
    expect(source.innerHTML).toBe(built.innerHTML);
    expect(source.innerHTML).toBe("<h1>Title</h1><p>First</p><p>Second</p><hr>");
  });

  test("a mixed array splices every member: elements, strings and numbers", () => {
    const state = () =>
      reactive({
        body: [{ tagName: "em", textContent: "one" }, " loose text ", 7],
        title: "Words",
      });
    const source = render({ children: ["Before ", "${state.body}", "!"], tagName: "p" }, state());
    const built = render(
      unchecked({
        children: ["Before ", { tagName: "em", textContent: "one" }, " loose text ", 7, "!"],
        tagName: "p",
      }),
      state(),
    );
    expect(source.innerHTML).toBe(built.innerHTML);
    expect(source.innerHTML).toBe("Before <em>one</em> loose text 7!");
  });

  test("an empty array splices nothing, and a value that is not an array stays text", () => {
    const state = () => reactive({ count: 3, none: [], title: "Words" });
    const source = render(
      {
        children: ["${state.none}", "${state.title}", "${state.count}", "${state.missing}"],
        tagName: "p",
      },
      state(),
    );
    // The build removes the empty array's string and leaves the other three as text templates.
    const built = render(
      { children: ["${state.title}", "${state.count}", "${state.missing}"], tagName: "p" },
      state(),
    );
    expect(source.innerHTML).toBe(built.innerHTML);
    expect(source.innerHTML).toBe("Words3undefined");
  });

  test("a spliced member that is a template is bound as text, and not spliced again", () => {
    // The build steps over what it spliced in, so a string member is never expanded a second time:
    // It is a text child, which a later stage binds. Its array value prints as text does.
    const state = reactive({
      body: ["${state.title}", "${state.inner}"],
      inner: [{ tagName: "b" }],
      title: "Words",
    });
    const el = render({ children: ["${state.body}"], tagName: "p" }, state);
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("Words[object Object]");
  });

  test("a member's own children are spliced in turn, as the build recurses into it", () => {
    const state = reactive({
      body: [{ children: ["${state.inner}"], tagName: "section" }],
      inner: [{ tagName: "b", textContent: "deep" }],
    });
    const el = render({ children: ["${state.body}"], tagName: "div" }, state);
    expect(el.innerHTML).toBe("<section><b>deep</b></section>");
  });

  test("inside a mapped row the template reads the row", () => {
    const state = reactive({
      team: [
        { $children: [{ tagName: "p", textContent: "First bio" }], name: "A" },
        { $children: [{ tagName: "p", textContent: "Second bio" }], name: "B" },
      ],
    });
    const el = render(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/team" },
            map: {
              children: [{ tagName: "h2", textContent: "${item.name}" }, "${item.$children}"],
              tagName: "section",
            },
          },
        ],
        tagName: "div",
      },
      state,
    );
    expect([...el.querySelectorAll("section")].map((s) => s.innerHTML)).toEqual([
      "<h2>A</h2><p>First bio</p>",
      "<h2>B</h2><p>Second bio</p>",
    ]);
  });
});

describe("a templated string child — text is unchanged", () => {
  test("a text value is one Text node, updated in place", async () => {
    const state = reactive({ title: "Words" });
    const el = render({ children: ["${state.title}"], tagName: "p" }, state);
    expect(el.childNodes).toHaveLength(1);
    const text = el.firstChild!;
    expect(text.nodeType).toBe(3);
    expect(text.textContent).toBe("Words");

    state.title = "Other";
    await flush();
    expect(el.childNodes).toHaveLength(1);
    expect(el.firstChild).toBe(text);
    expect(text.textContent).toBe("Other");
  });

  test("text mixed with an expression never splices, whatever the expression holds", () => {
    const state = reactive({ body: [{ tagName: "b" }] });
    const el = render({ children: ["See ${state.body}"], tagName: "p" }, state);
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("See [object Object]");
  });

  test("a value with no text form reports, and writes nothing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const el = render({ children: ["${Symbol('x')}"], tagName: "p" }, reactive({}));
      expect(el.textContent).toBe("");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a templated string child that resolves to nodes — reactivity", () => {
  test("a change replaces the spliced range and leaves the siblings alone", async () => {
    const state = reactive<{ body: Leaf[] | string }>({
      body: [{ tagName: "p", textContent: "One" }],
    });
    const el = render(
      {
        children: [{ tagName: "h1" }, "lead", "${state.body}", "tail", { tagName: "hr" }],
        tagName: "article",
      },
      state,
    );
    const h1 = el.querySelector("h1")!;
    const hr = el.querySelector("hr")!;
    const [lead, tail] = texts(el);
    const first = el.querySelector("p")!;
    expect(el.innerHTML).toBe("<h1></h1>lead<p>One</p>tail<hr>");

    state.body = [
      { tagName: "p", textContent: "Two" },
      { tagName: "p", textContent: "Three" },
    ];
    await flush();
    expect(el.innerHTML).toBe("<h1></h1>lead<p>Two</p><p>Three</p>tail<hr>");
    expect(first.isConnected).toBe(false);
    expect(el.querySelector("h1")).toBe(h1);
    expect(el.querySelector("hr")).toBe(hr);
    expect(texts(el)[0]).toBe(lead!);
    expect(texts(el)[1]).toBe(tail!);

    // An array that becomes text, and text that becomes an array again, in the same place.
    state.body = "plain";
    await flush();
    expect(el.innerHTML).toBe("<h1></h1>leadplaintail<hr>");

    state.body = [{ tagName: "b", textContent: "Back" }];
    await flush();
    expect(el.innerHTML).toBe("<h1></h1>lead<b>Back</b>tail<hr>");

    state.body = [];
    await flush();
    expect(el.innerHTML).toBe("<h1></h1>leadtail<hr>");
    expect(el.querySelector("h1")).toBe(h1);
    expect(el.querySelector("hr")).toBe(hr);
  });

  test("an array changed in place redraws the range: a push, an index write, a length of zero", async () => {
    const state = reactive<{ body: (Leaf | string)[] }>({
      body: [{ tagName: "p", textContent: "One" }],
    });
    const el = render({ children: ["lead", "${state.body}", "tail"], tagName: "article" }, state);
    expect(el.innerHTML).toBe("lead<p>One</p>tail");

    state.body.push({ tagName: "p", textContent: "Two" });
    await flush();
    expect(el.innerHTML).toBe("lead<p>One</p><p>Two</p>tail");

    state.body[0] = "text";
    await flush();
    expect(el.innerHTML).toBe("leadtext<p>Two</p>tail");

    state.body.length = 0;
    await flush();
    expect(el.innerHTML).toBe("leadtail");
  });

  test("a whole-children template follows an array changed in place too", async () => {
    const state = reactive<{ body: Leaf[] }>({ body: [{ tagName: "p", textContent: "One" }] });
    const el = render({ children: "${state.body}", tagName: "article" }, state);
    expect(el.innerHTML).toBe("<p>One</p>");

    state.body.push({ tagName: "p", textContent: "Two" });
    await flush();
    expect(el.innerHTML).toBe("<p>One</p><p>Two</p>");
  });

  test("a binding inside a spliced node tracks for itself, without redrawing the range", async () => {
    const state = reactive({
      count: 1,
      nodes: [{ tagName: "p", textContent: "${state.count}" }],
    });
    const el = render({ children: ["${state.nodes}"], tagName: "div" }, state);
    const paragraph = el.querySelector("p")!;
    state.count = 2;
    await flush();
    expect(el.querySelector("p")).toBe(paragraph);
    expect(paragraph.textContent).toBe("2");
  });

  test("a template that throws clears the range, reports, and recovers", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = reactive<{ boom: boolean; nodes: Leaf[] }>({
        boom: false,
        nodes: [{ tagName: "p" }],
      });
      const el = render(
        { children: ["a", "${state.boom ? missing.member : state.nodes}", "b"], tagName: "div" },
        state,
      );
      expect(el.innerHTML).toBe("a<p></p>b");

      state.boom = true;
      await flush();
      expect(el.innerHTML).toBe("ab");
      expect(warn).toHaveBeenCalled();

      state.boom = false;
      await flush();
      expect(el.innerHTML).toBe("a<p></p>b");
    } finally {
      warn.mockRestore();
    }
  });

  test("a member that cannot be rendered takes the members drawn before it with it", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = reactive({ nodes: [{ tagName: "p" }, null] });
      const el = render({ children: ["a", "${state.nodes}", "b"], tagName: "div" }, state);
      expect(el.innerHTML).toBe("ab");
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
      el = render({ children: ["${state.nodes}"], tagName: "div" }, state);
    });
    scope.stop();

    state.count = 2;
    await flush();
    expect(el!.querySelector("p")!.textContent).toBe("1");
  });
});

describe("a templated string child that resolves to nodes — where it is drawn", () => {
  test("a spliced node takes the namespace its parent gives its children", () => {
    const el = renderNode(
      { children: ["${state.nodes}"], tagName: "svg" },
      reactive({ nodes: [{ tagName: "circle" }] }),
    );
    if (!(el instanceof Element)) {
      throw new TypeError("expected an element");
    }
    expect(el.firstElementChild!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  test("each spliced element is reported at the string's position, then its own index", () => {
    const seen: [string, JxPath][] = [];
    render(
      { children: [{ tagName: "h1" }, "${state.nodes}", { tagName: "hr" }], tagName: "div" },
      reactive({ nodes: [{ tagName: "p" }, "text", { tagName: "b" }] }),
      {
        _path: ["children", 4],
        onNodeCreated: (el, path) => {
          seen.push([el instanceof Element ? el.localName : "#text", [...path]]);
        },
      },
    );
    // A text member is not reported, as no text node is; the string's own index (1) is not reused
    // By a sibling, so `[…, 1, 0]` and `[…, 2]` cannot be confused.
    expect(seen).toEqual([
      ["div", ["children", 4]],
      ["h1", ["children", 4, "children", 0]],
      ["p", ["children", 4, "children", 1, 0]],
      ["b", ["children", 4, "children", 1, 2]],
      ["hr", ["children", 4, "children", 2]],
    ]);
  });

  test("it is spliced among a defined element's slotted children too", async () => {
    await defineElement({ children: [{ tagName: "slot" }], tagName: "sp-card" });
    const state = reactive<{ nodes: Leaf[] }>({
      nodes: [{ tagName: "p", textContent: "Slotted" }],
    });
    const el = render(
      {
        children: [
          {
            $props: {},
            children: [{ tagName: "h2" }, "${state.nodes}"],
            tagName: "sp-card",
          },
        ],
        tagName: "div",
      },
      state,
      { _path: [] },
    );
    document.body.append(el);
    await flush();
    const card = el.querySelector("sp-card")!;
    expect(card.querySelector("h2")).not.toBeNull();
    expect(card.querySelector("p")!.textContent).toBe("Slotted");

    state.nodes = [{ tagName: "p", textContent: "Again" }];
    await flush();
    expect([...card.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Again"]);
    el.remove();
  });
});
