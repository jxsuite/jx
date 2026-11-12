import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { reactive } from "@vue/reactivity";

import {
  defineElement,
  preloadDocument,
  redefineElement,
  renderNode,
  setCanvasDelinkPopovers,
  setTemplateErrorHandler,
  updateInstanceProps,
} from "../src/runtime";

import type { JxDocument, JxElement, JxTagExpression } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

type Props = JxElement["$props"];

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** Long enough for an instance, the instances it draws and every queued `onMount` to finish. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await tick();
  }
}

/** What {@link card} draws, as a list a definition can add its own children to. */
function cardChildren(): (JxElement | string)[] {
  return [
    { className: "out", tagName: "span", textContent: "${state.label}:${state.count}" },
    { children: [{ tagName: "slot" }], className: "body", tagName: "div" },
  ];
}

/** A card that draws its `label` and `count` into one `<span>` and keeps a slot for its content. */
function card(tagName: string, extra: Partial<JxDocument> = {}): JxDocument {
  return {
    children: cardChildren(),
    state: { count: { default: 1 }, label: "none" },
    tagName,
    ...extra,
  };
}

/** Draw one instance the way a document does, `$props` and children included, and connect it. */
async function place(def: JxElement): Promise<HTMLElement> {
  const el = renderNode(def, reactive({}));
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("an element definition renders an element");
  }
  document.body.append(el);
  await settle();
  return el;
}

/** The text of the instance's bound `<span>`. */
function shown(el: HTMLElement): string | null | undefined {
  return el.querySelector(".out")?.textContent;
}

/**
 * An own property of an element, printed. A forwarding accessor and a plain expando are both own
 * properties of the instance, and one that is absent prints as "undefined".
 */
function prop(el: Element, key: string): string {
  const own = Object.getOwnPropertyDescriptor(el, key);
  return String(own?.get ? own.get.call(el) : own?.value);
}

/** An own property of an element as JSON, so an array or an object it holds can be compared. */
function propJson(el: Element, key: string): string | undefined {
  const own = Object.getOwnPropertyDescriptor(el, key);
  return JSON.stringify(own?.get ? own.get.call(el) : own?.value);
}

/** An element with no `$props` block at all, which is how an absent block reaches the function. */
const bare: JxElement = { tagName: "div" };

afterEach(() => {
  document.body.replaceChildren();
});

describe("updateInstanceProps: writing in place", () => {
  test("a changed literal redraws what reads it, in the same host with the same slotted nodes", async () => {
    await defineElement(card("uip-literal"));
    const before: Props = { count: 2, label: "a" };
    const el = await place({
      $props: before,
      children: [{ className: "kept", tagName: "em", textContent: "slotted" }, "tail"],
      tagName: "uip-literal",
    });
    expect(shown(el)).toBe("a:2");
    const span = el.querySelector(".out");
    const body = el.querySelector(".body");
    const slotted = el.querySelector(".kept");
    const text = slotted?.nextSibling;
    expect(slotted?.textContent).toBe("slotted");
    expect(text?.textContent).toBe("tail");

    expect(updateInstanceProps(el, before, { count: 2, label: "b" })).toBe(true);
    await tick();

    expect(shown(el)).toBe("b:2");
    expect(document.body.firstElementChild).toBe(el);
    expect(el.querySelector(".out")).toBe(span);
    expect(el.querySelector(".body")).toBe(body);
    expect(el.querySelector(".kept")).toBe(slotted);
    expect(el.querySelector(".kept")?.nextSibling).toBe(text ?? null);
    expect(slotted?.parentNode).toBe(body);
  });

  test("an added prop is written, and an unchanged one beside it is left alone", async () => {
    await defineElement(card("uip-added"));
    const el = await place({ $props: { label: "a" }, tagName: "uip-added" });
    expect(shown(el)).toBe("a:1");
    expect(updateInstanceProps(el, { label: "a" }, { count: 7, label: "a" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("a:7");
  });

  const scalarPairs: [string, NonNullable<Props>, NonNullable<Props>, string][] = [
    ["a string becoming a number", { label: "a" }, { label: 5 }, "5:1"],
    ["a number becoming a string", { count: 2 }, { count: "two" }, "none:two"],
    ["a number becoming a boolean", { count: 2 }, { count: true }, "none:true"],
    ["a boolean becoming a string", { label: false }, { label: "yes" }, "yes:1"],
    ["an absent prop given a string", {}, { label: "new" }, "new:1"],
    ["an absent prop given a number", {}, { count: 0 }, "none:0"],
    ["an absent prop given a boolean", {}, { label: false }, "false:1"],
    ["an absent prop given the empty string", {}, { label: "" }, ":1"],
  ];
  for (const [index, [name, before, after, drawn]] of scalarPairs.entries()) {
    test(`${name} is written`, async () => {
      const tagName = `uip-scalar-${index}`;
      await defineElement(card(tagName));
      const el = await place({ $props: before, tagName });
      const span = el.querySelector(".out");

      expect(updateInstanceProps(el, before, after)).toBe(true);
      await tick();
      expect(shown(el)).toBe(drawn);
      expect(el.querySelector(".out")).toBe(span);
    });
  }

  test("a block absent before, or absent after, is read as an empty one", async () => {
    await defineElement(card("uip-absent"));
    const el = await place({ tagName: "uip-absent" });
    expect(shown(el)).toBe("none:1");
    expect(updateInstanceProps(el, bare.$props, { label: "now" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("now:1");
    expect(updateInstanceProps(el, { label: "now" }, bare.$props)).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:1");
  });

  test("a bound platform-named prop still reaches state after connection", async () => {
    // The binding's own write, not an in-place edit: it is what `updateInstanceProps` leaves alone.
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.title}" }],
      state: { title: "untitled" },
      tagName: "uip-title-bound",
    });
    const scope = reactive({ name: "first" });
    const el = renderNode(
      { $props: { title: "${state.name}" }, tagName: "uip-title-bound" },
      scope,
    );
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("an element definition renders an element");
    }
    document.body.append(el);
    await settle();
    expect(shown(el)).toBe("first");

    scope.name = "second";
    await tick();
    expect(shown(el)).toBe("second");
    expect(el.title).toBe("second");
  });
});

describe("updateInstanceProps: a prop named for a platform property", () => {
  test("a declared `title` given a string reaches state and the render, and still reflects", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.title}" }],
      state: { title: "untitled" },
      tagName: "uip-title-set",
    });
    const before: Props = { title: "first" };
    const el = await place({ $props: before, tagName: "uip-title-set" });
    expect(shown(el)).toBe("first");
    const span = el.querySelector(".out");

    expect(updateInstanceProps(el, before, { title: "second" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("second");
    expect(el.title).toBe("second");
    expect(el.querySelector(".out")).toBe(span);
  });

  test("a declared `title` given anything but a string is refused and nothing is written", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.title}" }],
      state: { title: "untitled" },
      tagName: "uip-title-coerced",
    });
    const before: Props = { title: "first" };
    const el = await place({ $props: before, tagName: "uip-title-coerced" });
    expect(shown(el)).toBe("first");
    const span = el.querySelector(".out");

    // The platform's accessor would read each of these back as a string.
    for (const value of [7, true, null, ["a"]]) {
      expect(updateInstanceProps(el, before, { title: value })).toBe(false);
    }
    await tick();
    expect(shown(el)).toBe("first");
    expect(el.title).toBe("first");
    expect(prop(el, "title")).toBe("first");
    expect(el.querySelector(".out")).toBe(span);
  });

  test("a changed `title` the definition never declared is refused and nothing is written", async () => {
    await defineElement(card("uip-title-undeclared"));
    const before: Props = { label: "a", title: "first" };
    const el = await place({ $props: before, tagName: "uip-title-undeclared" });
    expect(el.title).toBe("first");

    expect(updateInstanceProps(el, before, { label: "a", title: "second" })).toBe(false);
    // Added where there was none, and beside a writable change.
    expect(updateInstanceProps(el, { label: "a" }, { label: "b", title: "second" })).toBe(false);
    await tick();
    expect(el.title).toBe("first");
    expect(el.getAttribute("title")).toBe("first");
    expect(shown(el)).toBe("a:1");
    expect(prop(el, "label")).toBe("a");
  });

  test("a changed declared `hidden` is refused and nothing is written", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${String(state.hidden)}" }],
      state: { hidden: false },
      tagName: "uip-hidden-set",
    });
    const before: Props = { hidden: false };
    const el = await place({ $props: before, tagName: "uip-hidden-set" });
    expect(shown(el)).toBe("false");

    expect(updateInstanceProps(el, before, { hidden: true })).toBe(false);
    await tick();
    expect(shown(el)).toBe("false");
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(prop(el, "hidden")).toBe("false");
  });

  test("a changed declared `tabIndex` is refused and nothing is written", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.tabIndex}" }],
      state: { tabIndex: 0 },
      tagName: "uip-tabindex-set",
    });
    const before: Props = { tabIndex: 0 };
    const el = await place({ $props: before, tagName: "uip-tabindex-set" });
    expect(shown(el)).toBe("0");
    const attribute = el.getAttribute("tabindex");

    expect(updateInstanceProps(el, before, { tabIndex: 3 })).toBe(false);
    await tick();
    expect(shown(el)).toBe("0");
    expect(el.getAttribute("tabindex")).toBe(attribute);
    expect(prop(el, "tabIndex")).toBe("0");
  });

  test("an undeclared `textContent` is refused, and the tree it would wipe stays", async () => {
    await defineElement(card("uip-text-content"));
    const before: Props = { label: "a" };
    const el = await place({
      $props: before,
      children: [{ className: "kept", tagName: "em", textContent: "slotted" }],
      tagName: "uip-text-content",
    });
    const span = el.querySelector(".out");
    const slotted = el.querySelector(".kept");
    expect(span).not.toBeNull();
    expect(slotted).not.toBeNull();

    // Set where there was none, changed from one value to another, and beside a writable change.
    expect(updateInstanceProps(el, before, { label: "a", textContent: "wipe" })).toBe(false);
    expect(
      updateInstanceProps(
        el,
        { label: "a", textContent: "old" },
        { label: "a", textContent: "wipe" },
      ),
    ).toBe(false);
    expect(updateInstanceProps(el, before, { label: "b", textContent: "wipe" })).toBe(false);
    await tick();
    expect(el.querySelector(".out")).toBe(span);
    expect(el.querySelector(".kept")).toBe(slotted);
    expect(shown(el)).toBe("a:1");
    expect(el.textContent).not.toContain("wipe");
  });
});

describe("updateInstanceProps: nothing to write into", () => {
  test("an unchanged block is a request to draw again", async () => {
    await defineElement(card("uip-same"));
    const el = await place({ $props: { count: 2, label: "a" }, tagName: "uip-same" });
    // Equal by value, not by identity, and in another key order for the keys that are compared.
    expect(updateInstanceProps(el, { count: 2, label: "a" }, { count: 2, label: "a" })).toBe(false);
    expect(updateInstanceProps(el, {}, {})).toBe(false);
    expect(updateInstanceProps(el, bare.$props, bare.$props)).toBe(false);
    expect(shown(el)).toBe("a:2");
  });

  test("a plain element is not an instance", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(updateInstanceProps(div, { label: "a" }, { label: "b" })).toBe(false);
    expect(prop(div, "label")).toBe("undefined");
  });

  test("a hyphenated tag nobody defined is not an instance", () => {
    const el = document.createElement("uip-undefined");
    document.body.append(el);
    expect(updateInstanceProps(el, { label: "a" }, { label: "b" })).toBe(false);
    expect(prop(el, "label")).toBe("undefined");
  });

  test("an element carrying a state expando but no definition is refused", () => {
    const div = document.createElement("div");
    Reflect.set(div, "_state", reactive({ label: "a" }));
    document.body.append(div);
    expect(updateInstanceProps(div, { label: "a" }, { label: "b" })).toBe(false);
    expect(prop(div, "label")).toBe("undefined");
  });

  test("an instance that has not connected yet has no state to write", async () => {
    await defineElement(card("uip-detached"));
    const el = document.createElement("uip-detached");
    expect(updateInstanceProps(el, { label: "a" }, { label: "b" })).toBe(false);
    expect(prop(el, "label")).toBe("undefined");
    // And once it connects, the same call writes.
    document.body.append(el);
    await settle();
    expect(updateInstanceProps(el, { label: "a" }, { label: "b" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("b:1");
  });
});

describe("updateInstanceProps: bindings and private keys", () => {
  const bound: [string, Props, Props][] = [
    ["a $ref after", { label: "a" }, { label: { $ref: "#/state/name" } }],
    ["a $ref before", { label: { $ref: "#/state/name" } }, { label: "b" }],
    ["a template after", { label: "a" }, { label: "${state.name}!" }],
    ["a template before", { label: "${state.name}!" }, { label: "b" }],
    ["a string that is one bare template after", { label: "a" }, { label: "${x}" }],
    ["a string that is one bare template before", { label: "${x}" }, { label: "b" }],
  ];
  for (const [name, before, after] of bound) {
    const index = bound.findIndex(([n]) => n === name);
    test(`${name} is refused and nothing is written`, async () => {
      const tagName = `uip-bound-${index}`;
      await defineElement(card(tagName));
      const el = await place({ $props: { label: "a" }, tagName });
      expect(updateInstanceProps(el, before, after)).toBe(false);
      await tick();
      expect(shown(el)).toBe("a:1");
      expect(prop(el, "label")).toBe("a");
    });
  }

  test("a binding that did not change does not refuse the literal beside it", async () => {
    await defineElement(card("uip-bound-same"));
    const el = renderNode(
      { $props: { count: 1, label: "${state.name}" }, tagName: "uip-bound-same" },
      reactive({ name: "n" }),
    );
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("an element definition renders an element");
    }
    document.body.append(el);
    await settle();
    expect(shown(el)).toBe("n:1");
    expect(
      updateInstanceProps(
        el,
        { count: 1, label: "${state.name}" },
        { count: 5, label: "${state.name}" },
      ),
    ).toBe(true);
    await tick();
    expect(shown(el)).toBe("n:5");
  });

  test("a refused key later in the block means the earlier ones were not written", async () => {
    await defineElement(card("uip-all-or-nothing"));
    const before: Props = { count: 1, label: "a" };
    const el = await place({ $props: before, tagName: "uip-all-or-nothing" });
    // `count` and `label` are both writable and come first; `zeta` is the one that refuses.
    expect(
      updateInstanceProps(
        el,
        { ...before, zeta: "z" },
        { count: 9, label: "b", zeta: { $ref: "#/state/z" } },
      ),
    ).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
    expect(prop(el, "count")).toBe("1");
    expect(prop(el, "label")).toBe("a");
  });

  test("a refused removal later in the block means the earlier ones were not written", async () => {
    await defineElement(card("uip-all-or-nothing-removal"));
    const before: Props = { label: "a", title: "t" };
    const el = await place({ $props: before, tagName: "uip-all-or-nothing-removal" });
    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
    expect(el.title).toBe("t");
  });

  test("a private key is ignored on both sides", async () => {
    await defineElement(
      card("uip-private", {
        children: [
          {
            className: "out",
            tagName: "span",
            textContent: "${state.label}:${state['#secret']}",
          },
        ],
        state: { "#secret": "kept", label: "none" },
      }),
    );
    const el = await place({ $props: { label: "a" }, tagName: "uip-private" });
    expect(shown(el)).toBe("a:kept");

    // Alone, it is nothing to write.
    expect(updateInstanceProps(el, { label: "a" }, { "#secret": "leak", label: "a" })).toBe(false);
    expect(updateInstanceProps(el, { "#secret": "leak", label: "a" }, { label: "a" })).toBe(false);
    // Beside a real change it is skipped, bound or not, and the change is still written.
    expect(
      updateInstanceProps(
        el,
        { "#secret": "x", label: "a" },
        { "#secret": { $ref: "#/state/y" }, label: "b" },
      ),
    ).toBe(true);
    await tick();
    expect(shown(el)).toBe("b:kept");
    expect(Object.hasOwn(el, "#secret")).toBe(false);
  });
});

describe("updateInstanceProps: a removed prop", () => {
  test("goes back to a primitive default, in the `{ default }` form and the shorthand", async () => {
    await defineElement(card("uip-remove-default"));
    const before: Props = { count: 4, label: "a" };
    const el = await place({ $props: before, tagName: "uip-remove-default" });
    expect(shown(el)).toBe("a:4");
    const span = el.querySelector(".out");

    // `count` is declared `{ default: 1 }`.
    expect(updateInstanceProps(el, before, { label: "a" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("a:1");
    // `label` is declared in the shorthand, `"none"`.
    expect(updateInstanceProps(el, { label: "a" }, {})).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:1");
    expect(el.querySelector(".out")).toBe(span);
  });

  test("goes back to a falsy scalar default: `0`, `false` and the empty string", async () => {
    await defineElement({
      children: [
        {
          className: "out",
          tagName: "span",
          textContent: "${JSON.stringify([state.a, state.b, state.c, state.d])}",
        },
      ],
      state: { a: { default: "" }, b: { default: 0 }, c: false, d: "" },
      tagName: "uip-remove-falsy",
    });
    const before: Props = { a: "x", b: 3, c: true, d: "y" };
    const el = await place({ $props: before, tagName: "uip-remove-falsy" });
    expect(shown(el)).toBe('["x",3,true,"y"]');
    const span = el.querySelector(".out");
    expect(updateInstanceProps(el, before, {})).toBe(true);
    await tick();
    expect(shown(el)).toBe('["",0,false,""]');
    expect(el.querySelector(".out")).toBe(span);
  });

  const nullDefaults: [string, NonNullable<JxDocument["state"]>][] = [
    ["in the `{ default }` form", { a: { default: null }, label: "none" }],
    ["in the shorthand", { a: null, label: "none" }],
  ];
  for (const [index, [name, state]] of nullDefaults.entries()) {
    test(`with a \`null\` default ${name} is refused, and the change beside it is not written`, async () => {
      const tagName = `uip-remove-null-${index}`;
      await defineElement({
        children: [
          { className: "out", tagName: "span", textContent: "${state.label}:${String(state.a)}" },
        ],
        state,
        tagName,
      });
      const before: Props = { a: "x", label: "a" };
      const el = await place({ $props: before, tagName });
      expect(shown(el)).toBe("a:x");
      expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
      await tick();
      expect(shown(el)).toBe("a:x");
      expect(prop(el, "a")).toBe("x");
      expect(prop(el, "label")).toBe("a");
    });
  }

  test("with an object default is refused", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.items.length}" }],
      state: { items: { default: ["x", "y"] } },
      tagName: "uip-remove-object",
    });
    const before: Props = { items: ["a"] };
    const el = await place({ $props: before, tagName: "uip-remove-object" });
    expect(shown(el)).toBe("1");
    expect(updateInstanceProps(el, before, {})).toBe(false);
    await tick();
    expect(shown(el)).toBe("1");
  });

  test("with a default that is itself a template is refused", async () => {
    await defineElement(
      card("uip-remove-template", {
        state: { count: 1, label: { default: "${state.count}x" } },
      }),
    );
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-remove-template" });
    expect(shown(el)).toBe("a:1");
    expect(updateInstanceProps(el, before, {})).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
  });

  test("of a computed entry is refused: it has no default to go back to", async () => {
    await defineElement(
      card("uip-remove-computed", {
        state: {
          count: 2,
          label: { $expression: { operator: "*", target: { $ref: "#/state/count" }, value: 2 } },
        },
      }),
    );
    const el = await place({ tagName: "uip-remove-computed" });
    expect(shown(el)).toBe("4:2");
    expect(updateInstanceProps(el, { label: "a" }, {})).toBe(false);
    await tick();
    expect(shown(el)).toBe("4:2");
  });

  test("the definition never declared deletes the own property", async () => {
    await defineElement(card("uip-remove-undeclared"));
    const before: Props = { extra: "e", label: "a" };
    const el = await place({ $props: before, tagName: "uip-remove-undeclared" });
    expect(Object.hasOwn(el, "extra")).toBe(true);
    expect(prop(el, "extra")).toBe("e");

    expect(updateInstanceProps(el, before, { label: "a" })).toBe(true);
    expect(Object.hasOwn(el, "extra")).toBe(false);
    expect(prop(el, "extra")).toBe("undefined");
    expect(shown(el)).toBe("a:1");
  });

  test("named for a platform property is refused, declared or not", async () => {
    await defineElement(card("uip-remove-title"));
    const before: Props = { label: "a", title: "tip" };
    const el = await place({ $props: before, tagName: "uip-remove-title" });
    expect(el.title).toBe("tip");
    expect(updateInstanceProps(el, before, { label: "a" })).toBe(false);
    expect(el.title).toBe("tip");

    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: "${state.title}" }],
      state: { title: "untitled" },
      tagName: "uip-remove-title-declared",
    });
    const declared = await place({
      $props: { title: "tip" },
      tagName: "uip-remove-title-declared",
    });
    expect(shown(declared)).toBe("tip");
    expect(updateInstanceProps(declared, { title: "tip" }, {})).toBe(false);
    await tick();
    expect(shown(declared)).toBe("tip");
    expect(declared.title).toBe("tip");
  });
});

describe("updateInstanceProps: onMount ran once", () => {
  const mount = { $prototype: "Function", body: "state.seen = state.label" } as const;

  test("on the instance itself, the write is refused", async () => {
    await defineElement(
      card("uip-mount-self", { state: { label: "none", count: 1, onMount: mount, seen: "" } }),
    );
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-mount-self" });
    expect(prop(el, "seen")).toBe("a");

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
    expect(prop(el, "label")).toBe("a");
    // A removal that would otherwise be written is refused for the same reason.
    expect(updateInstanceProps(el, before, {})).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
  });

  test("on an instance the definition drew, the write is refused", async () => {
    await defineElement({
      children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
      state: { label: "none", onMount: mount, seen: "" },
      tagName: "uip-mount-leaf",
    });
    await defineElement(
      card("uip-mount-outer", {
        children: [
          { className: "out", tagName: "span", textContent: "${state.label}:${state.count}" },
          {
            // An ordinary element between the two: still nothing the document placed.
            children: [{ $props: { label: "${state.label}" }, tagName: "uip-mount-leaf" }],
            tagName: "section",
          },
        ],
      }),
    );
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-mount-outer" });
    expect(el.querySelector(".leaf")?.textContent).toBe("a");

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
    expect(el.querySelector(".leaf")?.textContent).toBe("a");
  });

  test("on slot content the document placed, stamped with its path, the write goes through", async () => {
    await defineElement({
      children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
      state: { label: "none", onMount: mount, seen: "" },
      tagName: "uip-mount-slotted",
    });
    // And an instance with no `onMount` at all, which the walk passes over.
    await defineElement({ tagName: "uip-mount-plain", textContent: "plain" });
    await defineElement(card("uip-mount-host"));
    const before: Props = { label: "a" };
    const el = await place({
      $props: before,
      children: [
        {
          attributes: { "data-jx-path": "children/0" },
          $props: { label: "mine" },
          tagName: "uip-mount-slotted",
        },
        {
          // Stamped on an ancestor rather than on the instance: the document still placed it.
          attributes: { "data-jx-path": "children/1" },
          children: [{ $props: { label: "deep" }, tagName: "uip-mount-slotted" }],
          tagName: "div",
        },
        { tagName: "uip-mount-plain" },
      ],
      tagName: "uip-mount-host",
    });
    const slotted = [...el.querySelectorAll("uip-mount-slotted")];
    expect(slotted).toHaveLength(2);
    expect(slotted.map((node) => prop(node, "seen"))).toStrictEqual(["mine", "deep"]);
    const [first] = slotted;

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("b:1");
    expect(el.querySelector("uip-mount-slotted")).toBe(first ?? null);
    expect(el.querySelector(".leaf")?.textContent).toBe("mine");
  });

  test("on slot content with no stamp between it and the host, the write is refused", async () => {
    await defineElement({
      state: { label: "none", onMount: mount, seen: "" },
      tagName: "uip-mount-unstamped",
      textContent: "${state.label}",
    });
    await defineElement(card("uip-mount-host-two"));
    const before: Props = { label: "a" };
    const el = await place({
      $props: before,
      children: [{ $props: { label: "mine" }, tagName: "uip-mount-unstamped" }],
      tagName: "uip-mount-host-two",
    });
    expect(el.querySelector("uip-mount-unstamped")?.textContent).toBe("mine");
    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
  });
});

/** A tag chosen once, when the element is created, from the instance's `label`. */
const chosenTag = {
  $expression: {
    initial: "i",
    operator: "?:" as const,
    target: { $ref: "#/state/label" },
    value: "b",
  },
} satisfies { $expression: JxTagExpression };

/** The three things a definition reads once at render, each as one child of a definition. */
const onceChildren: [string, JxElement][] = [
  ["a tag expression", { className: "once", tagName: chosenTag, textContent: "tagged" }],
  [
    "a `$`-local bound to a `$ref`",
    { $copy: { $ref: "#/state/label" }, className: "once", tagName: "i", textContent: "local" },
  ],
  [
    "a `$ref` in the `$props` of a plain element",
    { $props: { value: { $ref: "#/state/label" } }, className: "once", tagName: "input" },
  ],
];

describe("updateInstanceProps: the definition reads something once at render", () => {
  for (const [index, [name, child]] of onceChildren.entries()) {
    test(`${name} in the definition refuses the write`, async () => {
      const tagName = `uip-once-${index}`;
      const base = card(tagName);
      await defineElement({ ...base, children: [...cardChildren(), child] });
      const before: Props = { count: 1, label: "a" };
      const el = await place({ $props: before, tagName });
      expect(shown(el)).toBe("a:1");
      const once = el.querySelector(".once");
      expect(once).not.toBeNull();

      expect(updateInstanceProps(el, before, { count: 2, label: "b" })).toBe(false);
      // Asked again, of another edit: the answer is the definition's, and it is remembered.
      expect(updateInstanceProps(el, before, { count: 3, label: "c" })).toBe(false);
      await tick();
      expect(shown(el)).toBe("a:1");
      expect(prop(el, "label")).toBe("a");
      expect(prop(el, "count")).toBe("1");
      expect(el.querySelector(".once")).toBe(once);
    });

    test(`${name} in a definition the outer one draws refuses the write`, async () => {
      const leaf = `uip-once-leaf-${index}`;
      const tagName = `uip-once-outer-${index}`;
      await defineElement({ children: [child], state: { label: "none" }, tagName: leaf });
      const base = card(tagName);
      await defineElement({
        ...base,
        children: [
          ...cardChildren(),
          // Under an ordinary element, and given a literal: nothing in the outer one is bound.
          { children: [{ $props: { label: "fixed" }, tagName: leaf }], tagName: "section" },
        ],
      });
      const before: Props = { count: 1, label: "a" };
      const el = await place({ $props: before, tagName });
      expect(shown(el)).toBe("a:1");
      const once = el.querySelector(".once");
      expect(once).not.toBeNull();

      expect(updateInstanceProps(el, before, { count: 2, label: "b" })).toBe(false);
      await tick();
      expect(shown(el)).toBe("a:1");
      expect(prop(el, "label")).toBe("a");
      expect(prop(el, "count")).toBe("1");
      expect(el.querySelector(".once")).toBe(once);
    });
  }

  test("a `$ref` in the `$props` of a component the definition draws is a binding, not a copy", async () => {
    await defineElement({
      children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
      state: { label: "none" },
      tagName: "uip-once-bound-leaf",
    });
    const base = card("uip-once-bound-outer");
    await defineElement({
      ...base,
      children: [
        ...cardChildren(),
        { $props: { label: { $ref: "#/state/label" } }, tagName: "uip-once-bound-leaf" },
        "text",
      ],
    });
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-once-bound-outer" });
    const leaf = el.querySelector(".leaf");
    expect(leaf?.textContent).toBe("a");

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("b:1");
    expect(el.querySelector(".leaf")).toBe(leaf);
    expect(leaf?.textContent).toBe("b");
  });

  /* A definition that can draw itself is refused outright (§16.9): each level was admitted against
     the props the one above connected with, and a case the write draws would be admitted against
     stale ones. The scan also has to END on such a definition, which is the other thing this
     proves. */
  test("a definition that can draw itself is refused, and the scan ends", async () => {
    const base = card("uip-once-self");
    await defineElement({
      ...base,
      children: [
        ...cardChildren(),
        {
          $switch: { $ref: "#/state/depth" },
          cases: {
            deeper: { $props: { depth: "stop", label: "inner" }, tagName: "uip-once-self" },
            stop: { className: "end", tagName: "i" },
          },
          tagName: "section",
        },
      ],
      state: { ...base.state, depth: "stop" },
    });
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-once-self" });
    expect(el.querySelector(".end")).not.toBeNull();
    expect(el.querySelector("uip-once-self")).toBeNull();

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
  });

  test("two definitions that draw each other are refused the same way", async () => {
    const pair = (tagName: string, other: string): JxDocument => {
      const base = card(tagName);
      return {
        ...base,
        children: [
          ...cardChildren(),
          {
            $switch: { $ref: "#/state/depth" },
            cases: {
              deeper: { $props: { depth: "stop" }, tagName: other },
              stop: { className: "end", tagName: "i" },
            },
            tagName: "section",
          },
        ],
        state: { ...base.state, depth: "stop" },
      };
    };
    await defineElement(pair("uip-once-ping", "uip-once-pong"));
    await defineElement(pair("uip-once-pong", "uip-once-ping"));
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-once-ping" });
    expect(el.querySelector(".end")).not.toBeNull();

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
  });
});

describe("updateInstanceProps: a removed prop whose attribute is observed", () => {
  const observed = (tagName: string): JxDocument => ({
    children: [
      { className: "out", tagName: "span", textContent: "${state.label}:${state.itemCount}" },
    ],
    observedAttributes: ["label", "item-count"],
    state: { itemCount: 1, label: "none" },
    tagName,
  });

  test("is refused while the host carries the attribute", async () => {
    await defineElement(observed("uip-observed-carried"));
    const before: Props = { itemCount: 5, label: "a" };
    const el = await place({
      $props: before,
      attributes: { "item-count": "9", label: "attr" },
      tagName: "uip-observed-carried",
    });
    const drawn = shown(el);
    expect(drawn).toBeString();

    expect(updateInstanceProps(el, before, { itemCount: 5 })).toBe(false);
    // The camel-cased prop is matched to its kebab attribute.
    expect(updateInstanceProps(el, before, { label: "a" })).toBe(false);
    // And a writable change beside the refused removal is not written.
    expect(updateInstanceProps(el, before, { label: "b" })).toBe(false);
    await tick();
    expect(shown(el)).toBe(drawn ?? null);
    expect(el.getAttribute("label")).toBe("attr");
    expect(el.getAttribute("item-count")).toBe("9");
  });

  test("goes back to the default when the host does not carry it", async () => {
    await defineElement(observed("uip-observed-absent"));
    const before: Props = { itemCount: 5, label: "a" };
    const el = await place({ $props: before, tagName: "uip-observed-absent" });
    expect(shown(el)).toBe("a:5");
    expect(el.hasAttribute("label")).toBe(false);
    expect(el.hasAttribute("item-count")).toBe(false);

    expect(updateInstanceProps(el, before, { itemCount: 5 })).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:5");
    expect(updateInstanceProps(el, { itemCount: 5 }, {})).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:1");
  });

  test("is not held back by an attribute the definition does not observe", async () => {
    await defineElement(card("uip-observed-other"));
    const before: Props = { label: "a" };
    const el = await place({
      $props: before,
      attributes: { label: "attr" },
      tagName: "uip-observed-other",
    });
    expect(shown(el)).toBe("a:1");
    expect(updateInstanceProps(el, before, {})).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:1");
  });
});

describe("updateInstanceProps: an instance the document put inside another of its tag", () => {
  /* Slot content is the document's, created under the page and not under this instance's chain, so
     it is no self-drawing definition and the write goes ahead. */
  test("is written in place, and the inner instance is left alone", async () => {
    await defineElement(card("uip-own-tag"));
    const before: Props = { label: "a" };
    const el = await place({
      $props: before,
      children: [
        {
          $props: { label: "inner" },
          attributes: { "data-jx-path": "children/0" },
          tagName: "uip-own-tag",
        },
      ],
      tagName: "uip-own-tag",
    });
    const inner = el.querySelector("uip-own-tag");
    expect(inner).not.toBeNull();
    expect(shown(el)).toBe("a:1");

    expect(updateInstanceProps(el, before, { label: "b" })).toBe(true);
    await tick();
    expect(prop(el, "label")).toBe("b");
    expect(el.querySelector("uip-own-tag")).toBe(inner);
    expect(prop(el.querySelector<HTMLElement>("uip-own-tag") ?? el, "label")).toBe("inner");
  });
});

describe("updateInstanceProps: a write that throws", () => {
  test("answers false instead of throwing", async () => {
    await defineElement({
      children: [{ className: "out", tagName: "span", textContent: { $ref: "#/state/loud" } }],
      state: { label: "none", loud: "${state.label.toUpperCase()}" },
      tagName: "uip-throws",
    });
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-throws" });
    expect(shown(el)).toBe("A");

    let answer: boolean | undefined;
    expect(() => {
      answer = updateInstanceProps(el, before, { label: 5 });
    }).not.toThrow();
    expect(answer).toBe(false);
    expect(shown(el)).toBe("A");
  });
});

describe("updateInstanceProps: what a write draws is drawn inside the host", () => {
  const overlays = (tagName: string): JxDocument => ({
    children: [
      {
        $switch: { $ref: "#/state/view" },
        cases: {
          closed: { className: "case", tagName: "p", textContent: "closed" },
          open: { attributes: { popover: "auto" }, className: "case", tagName: "div" },
        },
        tagName: "section",
      },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { attributes: { popover: "auto" }, tagName: "li", textContent: "${$map.item}" },
          },
        ],
        tagName: "ul",
      },
    ],
    // The list is derived from a scalar: a list given as a prop is not written in place at all.
    state: { names: "", rows: "${state.names.split(' ').filter(Boolean)}", view: "closed" },
    tagName,
  });

  afterEach(() => {
    setCanvasDelinkPopovers(false);
  });

  test("a `$switch` case drawn by a write in a stamped host is de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(overlays("uip-delink-case"));
    const before: Props = { names: "", view: "closed" };
    const el = await place({
      $props: before,
      attributes: { "data-jx-path": "children/0" },
      tagName: "uip-delink-case",
    });
    expect(el.querySelector(".case")?.textContent).toBe("closed");

    expect(updateInstanceProps(el, before, { names: "", view: "open" })).toBe(true);
    await tick();

    const drawn = el.querySelector<HTMLElement>(".case");
    expect(drawn?.localName).toBe("div");
    expect(drawn?.dataset.jxPopover).toBe("auto");
    expect(drawn?.hasAttribute("popover")).toBe(false);
    expect(el.querySelector("[popover]")).toBeNull();
  });

  /* A list reconciles in a later microtask, with nothing on the stack: the list itself carries
     whether it was first drawn inside a stamped host. A write that asks one to redraw is answered
     false for the same reason, so the rows here arrive by the instance's own property instead. */
  test("a new `$map` row drawn later in a stamped host is de-linked, and a write that asks for one is answered false", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(overlays("uip-delink-row"));
    const before: Props = { names: "one", view: "closed" };
    const el = await place({
      $props: before,
      attributes: { "data-jx-path": "children/0" },
      tagName: "uip-delink-row",
    });
    const first = el.querySelector<HTMLElement>("li");
    expect(first?.dataset.jxPopover).toBe("auto");

    expect(updateInstanceProps(el, before, { names: "one two", view: "closed" })).toBe(false);
    await settle();

    Object.assign(el, { names: "one two three" });
    await settle();

    const rows = [...el.querySelectorAll<HTMLElement>("li")];
    expect(rows.map((row) => row.textContent)).toStrictEqual(["one", "two", "three"]);
    expect(rows[0]).toBe(first ?? undefined);
    expect(rows.map((row) => row.dataset.jxPopover)).toStrictEqual(["auto", "auto", "auto"]);
    expect(el.querySelector("[popover]")).toBeNull();
  });

  test("the same redraws in a host nobody stamped keep the native attribute", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(overlays("uip-delink-unstamped"));
    const before: Props = { names: "one", view: "closed" };
    const el = await place({ $props: before, tagName: "uip-delink-unstamped" });

    // The case is drawn by the write itself, in the same turn, and is answered for.
    const opened: Props = { names: "one", view: "open" };
    expect(updateInstanceProps(el, before, opened)).toBe(true);
    expect(el.querySelector(".case")?.getAttribute("popover")).toBe("auto");

    // A row is not: it is drawn in a later microtask.
    expect(updateInstanceProps(el, opened, { names: "one two", view: "open" })).toBe(false);
    Object.assign(el, { names: "one two three" });
    await settle();

    expect(el.querySelector(".case")?.getAttribute("popover")).toBe("auto");
    expect([...el.querySelectorAll("li")].map((row) => row.getAttribute("popover"))).toStrictEqual([
      "auto",
      "auto",
      "auto",
    ]);
    expect(el.querySelector("[data-jx-popover]")).toBeNull();
  });

  test("the flag is put back, so a later render outside any host is not de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(overlays("uip-delink-restored"));
    const before: Props = { names: "", view: "closed" };
    const el = await place({
      $props: before,
      attributes: { "data-jx-path": "children/0" },
      tagName: "uip-delink-restored",
    });
    expect(updateInstanceProps(el, before, { names: "", view: "open" })).toBe(true);

    const outside = renderNode({ attributes: { popover: "auto" }, tagName: "div" }, reactive({}));
    if (!(outside instanceof HTMLElement)) {
      throw new TypeError("an element definition renders an element");
    }
    expect(outside.getAttribute("popover")).toBe("auto");
    expect(outside.dataset.jxPopover).toBeUndefined();
  });
});

/** A card with more children after its own, and more state beside its own. */
function cardWith(
  tagName: string,
  extra: (JxElement | string)[],
  state: JxDocument["state"] = {},
): JxDocument {
  const base = card(tagName);
  return { ...base, children: [...cardChildren(), ...extra], state: { ...base.state, ...state } };
}

/** Place a card with one slotted `<em class="kept">`, drawn with `count: 1` and `label: "a"`. */
async function placeCard(tagName: string): Promise<HTMLElement> {
  const el = await place({
    $props: { count: 1, label: "a" },
    children: [{ className: "kept", tagName: "em", textContent: "slotted" }],
    tagName,
  });
  expect(shown(el)).toBe("a:1");
  return el;
}

/** Ask for `label: "b"` and `count: 2`, and prove the answer was no and nothing was written. */
async function expectRefused(el: HTMLElement): Promise<void> {
  const span = el.querySelector(".out");
  const slotted = el.querySelector(".kept");
  const drawn = el.innerHTML;
  expect(updateInstanceProps(el, { count: 1, label: "a" }, { count: 2, label: "b" })).toBe(false);
  await settle();
  expect(shown(el)).toBe("a:1");
  expect(prop(el, "label")).toBe("a");
  expect(prop(el, "count")).toBe("1");
  expect(el.querySelector(".out")).toBe(span);
  expect(el.querySelector(".kept")).toBe(slotted);
  expect(el.innerHTML).toBe(drawn);
}

/** Ask for `label: "b"` and `count: 2`, and prove it was written into the same nodes. */
async function expectWritten(el: HTMLElement): Promise<void> {
  const span = el.querySelector(".out");
  const slotted = el.querySelector(".kept");
  expect(updateInstanceProps(el, { count: 1, label: "a" }, { count: 2, label: "b" })).toBe(true);
  await settle();
  expect(shown(el)).toBe("b:2");
  expect(prop(el, "label")).toBe("b");
  expect(prop(el, "count")).toBe("2");
  expect(el.querySelector(".out")).toBe(span);
  expect(el.querySelector(".kept")).toBe(slotted);
}

/** Draw a second instance from a usage, and prove the first shows exactly what that one shows. */
async function expectLikeFresh(el: HTMLElement, usage: JxElement): Promise<void> {
  const fresh = await place(usage);
  expect(el.outerHTML).toBe(fresh.outerHTML);
  fresh.remove();
}

describe("updateInstanceProps: an `id` the definition draws", () => {
  test("bound to a `$ref` is written once, so the write is refused", async () => {
    // `JxElement` types `id` as a string; a document can still bind one, and the runtime draws it.
    const plain: JxElement = { className: "once", tagName: "i" };
    const once: JxElement = Object.assign(plain, { id: { $ref: "#/state/label" } });
    await defineElement(cardWith("uip-id-ref", [once]));
    const el = await placeCard("uip-id-ref");
    expect(el.querySelector(".once")?.id).toBe("a");
    await expectRefused(el);
    expect(el.querySelector(".once")?.id).toBe("a");
  });

  test("bound to a template is a live binding, and the write reaches it", async () => {
    await defineElement(
      cardWith("uip-id-template", [{ className: "live", id: "${state.label}-t", tagName: "i" }]),
    );
    const el = await placeCard("uip-id-template");
    const live = el.querySelector(".live");
    expect(live?.id).toBe("a-t");
    await expectWritten(el);
    expect(el.querySelector(".live")).toBe(live);
    expect(live?.id).toBe("b-t");
  });
});

describe("updateInstanceProps: a slot the definition draws", () => {
  test("inside a `$switch` case is refused", async () => {
    await defineElement(
      cardWith(
        "uip-slot-case",
        [
          {
            $switch: { $ref: "#/state/view" },
            cases: {
              one: { children: [{ attributes: { name: "aside" }, tagName: "slot" }], tagName: "p" },
              two: { className: "two", tagName: "p" },
            },
            tagName: "section",
          },
        ],
        { view: "one" },
      ),
    );
    await expectRefused(await placeCard("uip-slot-case"));
  });

  test("inside a `$map` template is refused", async () => {
    await defineElement(
      cardWith(
        "uip-slot-map",
        [
          {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "#/state/rows" },
                map: {
                  children: [{ attributes: { name: "row" }, tagName: "slot" }],
                  tagName: "li",
                },
              },
            ],
            tagName: "ul",
          },
        ],
        { rows: { default: ["one"] } },
      ),
    );
    await expectRefused(await placeCard("uip-slot-map"));
  });

  const named: [string, JxElement][] = [
    ["attribute bound to a template", { attributes: { name: "${state.label}" }, tagName: "slot" }],
    [
      "attribute bound to a `$ref`",
      { attributes: { name: { $ref: "#/state/label" } }, tagName: "slot" },
    ],
    ["property bound to a template", { name: "${state.label}", tagName: "slot" }],
    ["property bound to a `$ref`", { name: { $ref: "#/state/label" }, tagName: "slot" }],
  ];
  for (const [index, [name, slot]] of named.entries()) {
    test(`with its \`name\` ${name} is refused`, async () => {
      const tagName = `uip-slot-named-${index}`;
      await defineElement(cardWith(tagName, [{ children: [slot], tagName: "aside" }]));
      await expectRefused(await placeCard(tagName));
    });
  }

  test("with a literal `name`, and one at the top level, is written past", async () => {
    await defineElement({
      children: [
        { className: "out", tagName: "span", textContent: "${state.label}:${state.count}" },
        { tagName: "slot" },
        { children: [{ attributes: { name: "foot" }, tagName: "slot" }], tagName: "footer" },
      ],
      state: { count: { default: 1 }, label: "none" },
      tagName: "uip-slot-plain",
    });
    const el = await place({
      $props: { count: 1, label: "a" },
      children: [
        { className: "kept", tagName: "em", textContent: "slotted" },
        "tail",
        { attributes: { slot: "foot" }, className: "footed", tagName: "small" },
      ],
      tagName: "uip-slot-plain",
    });
    const slotted = el.querySelector(".kept");
    const tail = slotted?.nextSibling;
    const footed = el.querySelector(".footed");
    expect(slotted?.parentNode).toBe(el);
    expect(tail?.textContent).toBe("tail");
    expect(footed?.parentElement?.localName).toBe("footer");

    await expectWritten(el);
    expect(el.querySelector(".kept")?.nextSibling).toBe(tail ?? null);
    expect(el.querySelector(".footed")).toBe(footed);
    expect(footed?.parentElement?.localName).toBe("footer");
    expect(el.querySelector("slot")).toBeNull();
  });
});

describe("updateInstanceProps: a component the definition draws and hands a value", () => {
  /** A leaf that declares `label` and `itemCount`, observing neither unless told to. */
  const leafOf = (tagName: string, extra: Partial<JxDocument> = {}): JxDocument => ({
    children: [
      { className: "leaf", tagName: "i", textContent: "${state.label}:${state.itemCount}" },
    ],
    state: { itemCount: 1, label: "none" },
    tagName,
    ...extra,
  });

  const handed: [string, Partial<JxElement>][] = [
    ["bound `textContent`", { textContent: "${state.label}" }],
    ["`textContent` bound to a `$ref`", { textContent: { $ref: "#/state/label" } }],
    ["bound `innerHTML`", { innerHTML: "<b>${state.label}</b>" }],
    ["`children` that are one template", { children: "${state.kids}" }],
    ["a bound `props.*` attribute", { attributes: { "props.label": "${state.label}" } }],
    [
      "a bound attribute for a prop it declares and does not observe",
      { attributes: { label: "${state.label}" } },
    ],
    [
      "a bound kebab attribute for a camel-cased prop it does not observe",
      { attributes: { "item-count": { $ref: "#/state/count" } } },
    ],
  ];
  for (const [index, [name, given]] of handed.entries()) {
    test(`${name} is read at connection only, so the write is refused`, async () => {
      const leaf = `uip-hand-leaf-${index}`;
      const tagName = `uip-hand-outer-${index}`;
      await defineElement(leafOf(leaf));
      await defineElement(
        cardWith(tagName, [{ children: [{ ...given, tagName: leaf }], tagName: "section" }], {
          kids: { default: [] },
        }),
      );
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      expect(inner).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(leaf)).toBe(inner);
    });
  }

  test("a bound attribute for a prop the component observes is written through", async () => {
    await defineElement(
      leafOf("uip-hand-observed-leaf", { observedAttributes: ["label", "item-count"] }),
    );
    await defineElement(
      cardWith("uip-hand-observed", [
        {
          attributes: { "item-count": "${state.count}", label: { $ref: "#/state/label" } },
          tagName: "uip-hand-observed-leaf",
        },
      ]),
    );
    const el = await placeCard("uip-hand-observed");
    const inner = el.querySelector("uip-hand-observed-leaf");
    const leaf = el.querySelector(".leaf");
    expect(leaf?.textContent).toBe("a:1");

    await expectWritten(el);
    expect(el.querySelector("uip-hand-observed-leaf")).toBe(inner);
    expect(el.querySelector(".leaf")).toBe(leaf);
    expect(inner?.getAttribute("label")).toBe("b");
    expect(inner?.getAttribute("item-count")).toBe("2");
    expect(leaf?.textContent).toBe("b:2");
  });

  test("a bound attribute that is no prop of the component is written through", async () => {
    await defineElement(leafOf("uip-hand-plain-leaf"));
    await defineElement(
      cardWith("uip-hand-plain", [
        {
          attributes: {
            class: "tone-${state.label}",
            "data-x": { $ref: "#/state/label" },
            // Literals for the props it does declare: nothing bound, nothing to read once.
            label: "fixed",
            "props.item-count": "4",
          },
          tagName: "uip-hand-plain-leaf",
        },
      ]),
    );
    const el = await placeCard("uip-hand-plain");
    const inner = el.querySelector<HTMLElement>("uip-hand-plain-leaf");
    expect(inner?.getAttribute("class")).toBe("tone-a");
    expect(inner?.dataset.x).toBe("a");

    await expectWritten(el);
    expect(el.querySelector("uip-hand-plain-leaf")).toBe(inner);
    expect(inner?.getAttribute("class")).toBe("tone-b");
    expect(inner?.dataset.x).toBe("b");
  });

  test("a bound attribute on a component that declares no state at all is written through", async () => {
    await defineElement({ tagName: "uip-hand-stateless-leaf", textContent: "plain" });
    await defineElement(
      cardWith("uip-hand-stateless", [
        { attributes: { label: "${state.label}" }, tagName: "uip-hand-stateless-leaf" },
      ]),
    );
    const el = await placeCard("uip-hand-stateless");
    const inner = el.querySelector("uip-hand-stateless-leaf");
    expect(inner?.getAttribute("label")).toBe("a");

    await expectWritten(el);
    expect(el.querySelector("uip-hand-stateless-leaf")).toBe(inner);
    expect(inner?.getAttribute("label")).toBe("b");
  });

  const unknown: NonNullable<JxElement["attributes"]>[] = [
    { "data-x": "${state.label}" },
    { class: { $ref: "#/state/label" } },
  ];
  for (const [index, attributes] of unknown.entries()) {
    test(`a bound \`${Object.keys(attributes).join("")}\` on a hyphenated tag nobody registered is refused`, async () => {
      const tagName = `uip-hand-unknown-${index}`;
      await defineElement(cardWith(tagName, [{ attributes, tagName: "uip-hand-nobody" }]));
      const el = await placeCard(tagName);
      expect(el.querySelector("uip-hand-nobody")).not.toBeNull();
      await expectRefused(el);
    });
  }

  test("a literal attribute on a hyphenated tag nobody registered is written past", async () => {
    await defineElement(
      cardWith("uip-hand-unknown-literal", [
        { attributes: { "data-x": "fixed" }, tagName: "uip-hand-nobody", textContent: "plain" },
      ]),
    );
    await expectWritten(await placeCard("uip-hand-unknown-literal"));
  });
});

describe("updateInstanceProps: after a redefinition", () => {
  const plainLeaf = (tagName: string): JxDocument => ({
    children: [{ className: "leaf", tagName: "i", textContent: "leaf" }],
    state: { label: "none" },
    tagName,
  });
  const onceLeaf = (tagName: string): JxDocument => ({
    children: [{ className: "leaf", tagName: chosenTag, textContent: "leaf" }],
    state: { label: "none" },
    tagName,
  });

  /** Ask an instance that was written once (`b:2`) for another edit, and prove it was refused. */
  async function expectRefusedAgain(el: HTMLElement): Promise<void> {
    const drawn = el.innerHTML;
    const span = el.querySelector(".out");
    expect(updateInstanceProps(el, { count: 2, label: "b" }, { count: 3, label: "c" })).toBe(false);
    await settle();
    expect(shown(el)).toBe("b:2");
    expect(prop(el, "label")).toBe("b");
    expect(prop(el, "count")).toBe("2");
    expect(el.querySelector(".out")).toBe(span);
    expect(el.innerHTML).toBe(drawn);
  }

  test("of a tag the instance drew, the instance is refused, and one placed afterwards follows the new definition", async () => {
    await defineElement(plainLeaf("uip-fresh-leaf"));
    await defineElement(cardWith("uip-fresh-outer", [{ tagName: "uip-fresh-leaf" }]));
    const el = await placeCard("uip-fresh-outer");
    const inner = el.querySelector("uip-fresh-leaf");
    await expectWritten(el);

    // The inner instance still draws the definition it connected with, whatever the new one says.
    await redefineElement(onceLeaf("uip-fresh-leaf"));
    await expectRefusedAgain(el);
    expect(el.querySelector("uip-fresh-leaf")).toBe(inner);

    // An instance placed now draws the new inner definition, which reads once.
    const second = await placeCard("uip-fresh-outer");
    expect(second.querySelector(".leaf")?.localName).toBe("b");
    await expectRefused(second);

    // Put back, neither is freed: each holds an inner instance no current definition drew.
    await redefineElement(plainLeaf("uip-fresh-leaf"));
    await expectRefusedAgain(el);
    await expectRefused(second);

    const third = await placeCard("uip-fresh-outer");
    await expectWritten(third);
    expect(el.querySelector("uip-fresh-leaf")).toBe(inner);
  });

  test("of a drawn tag to one that reads nothing once, only an instance placed afterwards is written", async () => {
    await defineElement(onceLeaf("uip-stale-leaf"));
    await defineElement(cardWith("uip-stale-outer", [{ tagName: "uip-stale-leaf" }]));
    const el = await placeCard("uip-stale-outer");
    await expectRefused(el);

    await redefineElement(plainLeaf("uip-stale-leaf"));
    await expectRefused(el);
    expect(el.querySelector(".leaf")?.localName).toBe("b");

    const fresh = await placeCard("uip-stale-outer");
    expect(fresh.querySelector(".leaf")?.localName).toBe("i");
    await expectWritten(fresh);
  });

  test("of its own tag, an instance is refused, and one placed afterwards is written", async () => {
    await defineElement(card("uip-fresh-own"));
    const el = await placeCard("uip-fresh-own");

    // The new definition is writable and draws one more node, which the old instance never gets.
    await redefineElement(
      cardWith("uip-fresh-own", [{ className: "added", tagName: "i", textContent: "new" }]),
    );
    await expectRefused(el);
    expect(el.querySelector(".added")).toBeNull();

    const fresh = await placeCard("uip-fresh-own");
    expect(fresh.querySelector(".added")?.textContent).toBe("new");
    await expectWritten(fresh);
    await expectLikeFresh(fresh, {
      $props: { count: 2, label: "b" },
      children: [{ className: "kept", tagName: "em", textContent: "slotted" }],
      tagName: "uip-fresh-own",
    });
    // And the first is still the old drawing, untouched by the second's write.
    expect(shown(el)).toBe("a:1");
  });

  test("of its own tag to one that reads once and back, each instance answers for the definition it connected with", async () => {
    await defineElement(card("uip-fresh-self"));
    const el = await placeCard("uip-fresh-self");
    await redefineElement(
      cardWith("uip-fresh-self", [{ className: "once", tagName: chosenTag, textContent: "t" }]),
    );
    await expectRefused(el);

    // Placed under the definition that reads once: refused for that, then for being left behind.
    const second = await placeCard("uip-fresh-self");
    expect(second.querySelector(".once")).not.toBeNull();
    await expectRefused(second);

    await redefineElement(card("uip-fresh-self"));
    await expectRefused(el);
    await expectRefused(second);
    await expectWritten(await placeCard("uip-fresh-self"));
  });

  test("with the very document it was defined with, an instance is still drawn by the current one", async () => {
    const doc = card("uip-fresh-same");
    await defineElement(doc);
    const el = await placeCard("uip-fresh-same");
    await redefineElement(doc);
    await expectWritten(el);
  });
});

describe("updateInstanceProps: a definition that draws itself where nothing is drawn yet", () => {
  test("only inside a `$map` template is refused", async () => {
    await defineElement(
      cardWith(
        "uip-self-map",
        [
          {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "#/state/rows" },
                map: { $props: { label: "inner" }, tagName: "uip-self-map" },
              },
            ],
            tagName: "section",
          },
        ],
        { rows: { default: [] } },
      ),
    );
    const el = await placeCard("uip-self-map");
    expect(el.querySelector("uip-self-map")).toBeNull();
    await expectRefused(el);
  });

  test("only inside a `$switch` case nobody chose is refused", async () => {
    await defineElement(
      cardWith(
        "uip-self-case",
        [
          {
            $switch: { $ref: "#/state/depth" },
            cases: { deeper: { $props: { depth: "stop" }, tagName: "uip-self-case" } },
            tagName: "section",
          },
        ],
        { depth: "stop" },
      ),
    );
    const el = await placeCard("uip-self-case");
    expect(el.querySelector("uip-self-case")).toBeNull();
    await expectRefused(el);
  });

  test("through a second definition's `$map` template is refused from either end", async () => {
    const half = (tagName: string, other: string): JxDocument =>
      cardWith(
        tagName,
        [
          {
            children: [
              { $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: other } },
            ],
            tagName: "section",
          },
        ],
        { rows: { default: [] } },
      );
    await defineElement(half("uip-self-tick", "uip-self-tock"));
    await defineElement(half("uip-self-tock", "uip-self-tick"));
    await expectRefused(await placeCard("uip-self-tick"));
    document.body.replaceChildren();
    await expectRefused(await placeCard("uip-self-tock"));
  });
});

describe("a redraw the instance makes for itself is drawn as its first render was", () => {
  const CASE_URL = "https://uip.test/cases/remote.json";

  /** A switch, a list and an externally referenced case, each moved by the instance's own state. */
  const selfDriven = (tagName: string): JxDocument => ({
    children: [
      {
        $switch: { $ref: "#/state/view" },
        cases: {
          closed: { className: "case", tagName: "p", textContent: "closed" },
          open: { attributes: { popover: "auto" }, className: "case", tagName: "div" },
          remote: { $ref: CASE_URL },
        },
        tagName: "section",
      },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { attributes: { popover: "auto" }, tagName: "li", textContent: "${$map.item}" },
          },
        ],
        tagName: "ul",
      },
      { className: "open", onclick: { $ref: "#/state/open" }, tagName: "button" },
      { className: "more", onclick: { $ref: "#/state/more" }, tagName: "button" },
    ],
    state: {
      more: { $prototype: "Function", body: "state.rows = [...state.rows, 'new']" },
      open: { $prototype: "Function", body: "state.view = 'open'" },
      rows: { default: [] },
      view: "closed",
    },
    tagName,
  });

  const stamped = { "data-jx-path": "children/0" };

  afterEach(() => {
    setCanvasDelinkPopovers(false);
  });

  test("a `$switch` case flipped by a property write in a stamped host is de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-case-prop"));
    const el = await place({ attributes: stamped, tagName: "uip-self-case-prop" });
    expect(el.querySelector(".case")?.textContent).toBe("closed");

    Object.assign(el, { view: "open" });
    await settle();

    const drawn = el.querySelector<HTMLElement>(".case");
    expect(drawn?.localName).toBe("div");
    expect(drawn?.dataset.jxPopover).toBe("auto");
    expect(el.querySelector("[popover]")).toBeNull();
  });

  test("a `$switch` case flipped by the instance's own handler in a stamped host is de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-case-handler"));
    const el = await place({ attributes: stamped, tagName: "uip-self-case-handler" });

    el.querySelector<HTMLElement>(".open")?.click();
    await settle();

    const drawn = el.querySelector<HTMLElement>(".case");
    expect(drawn?.localName).toBe("div");
    expect(drawn?.dataset.jxPopover).toBe("auto");
    expect(el.querySelector("[popover]")).toBeNull();
  });

  test("a `$map` row that arrives by a property write in a stamped host is de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-row-prop"));
    const el = await place({
      $props: { rows: ["one"] },
      attributes: stamped,
      tagName: "uip-self-row-prop",
    });
    const [first] = el.querySelectorAll("li");

    Object.assign(el, { rows: ["one", "two"] });
    await settle();

    const rows = [...el.querySelectorAll<HTMLElement>("li")];
    expect(rows.map((row) => row.textContent)).toStrictEqual(["one", "two"]);
    expect(rows[0]).toBe(first);
    expect(rows.map((row) => row.dataset.jxPopover)).toStrictEqual(["auto", "auto"]);
    expect(el.querySelector("[popover]")).toBeNull();
  });

  test("a `$map` row that arrives by the instance's own handler in a stamped host is de-linked", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-row-handler"));
    const el = await place({ attributes: stamped, tagName: "uip-self-row-handler" });
    expect(el.querySelector("li")).toBeNull();

    el.querySelector<HTMLElement>(".more")?.click();
    await settle();
    el.querySelector<HTMLElement>(".more")?.click();
    await settle();

    const rows = [...el.querySelectorAll<HTMLElement>("li")];
    expect(rows.map((row) => row.textContent)).toStrictEqual(["new", "new"]);
    expect(rows.map((row) => row.dataset.jxPopover)).toStrictEqual(["auto", "auto"]);
    expect(el.querySelector("[popover]")).toBeNull();
  });

  test("the same redraws in a host nobody stamped keep the native attribute", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-unstamped"));
    const el = await place({ tagName: "uip-self-unstamped" });

    Object.assign(el, { view: "open" });
    el.querySelector<HTMLElement>(".more")?.click();
    await settle();

    expect(el.querySelector(".case")?.getAttribute("popover")).toBe("auto");
    expect(el.querySelector("li")?.getAttribute("popover")).toBe("auto");
    expect(el.querySelector("[data-jx-popover]")).toBeNull();
  });

  test("an unstamped host redrawing in the same turn as a stamped one stays native", async () => {
    setCanvasDelinkPopovers(true);
    await defineElement(selfDriven("uip-self-mixed"));
    const inside = await place({ attributes: stamped, tagName: "uip-self-mixed" });
    const outside = await place({ tagName: "uip-self-mixed" });

    Object.assign(inside, { rows: ["in"], view: "open" });
    Object.assign(outside, { rows: ["out"], view: "open" });
    await settle();

    expect(inside.querySelector<HTMLElement>(".case")?.dataset.jxPopover).toBe("auto");
    expect(inside.querySelector<HTMLElement>("li")?.dataset.jxPopover).toBe("auto");
    expect(inside.querySelector("[popover]")).toBeNull();
    expect(outside.querySelector(".case")?.getAttribute("popover")).toBe("auto");
    expect(outside.querySelector("li")?.getAttribute("popover")).toBe("auto");
    expect(outside.querySelector("[data-jx-popover]")).toBeNull();
  });

  test("a case that is an external `$ref` is de-linked in a stamped host and native outside one", async () => {
    setCanvasDelinkPopovers(true);
    preloadDocument(CASE_URL, {
      attributes: { popover: "auto" },
      className: "case",
      tagName: "div",
      textContent: "remote",
    });
    await defineElement(selfDriven("uip-self-remote"));
    const inside = await place({ attributes: stamped, tagName: "uip-self-remote" });
    const outside = await place({ tagName: "uip-self-remote" });

    Object.assign(inside, { view: "remote" });
    Object.assign(outside, { view: "remote" });
    await settle();
    await settle();

    const drawn = inside.querySelector<HTMLElement>(".case");
    expect(drawn?.textContent).toBe("remote");
    expect(drawn?.dataset.jxPopover).toBe("auto");
    expect(inside.querySelector("[popover]")).toBeNull();
    const native = outside.querySelector<HTMLElement>(".case");
    expect(native?.textContent).toBe("remote");
    expect(native?.getAttribute("popover")).toBe("auto");
    expect(outside.querySelector("[data-jx-popover]")).toBeNull();
  });
});

describe("updateInstanceProps: a value that is not a scalar", () => {
  const notScalar: [string, Props, Props][] = [
    ["an array given more items", { data: ["a"] }, { data: ["a", "b"] }],
    ["an object given another member", { data: { k: 1 } }, { data: { k: 2 } }],
    ["a string becoming an array", { data: "a" }, { data: ["a"] }],
    ["an array becoming a string", { data: ["a"] }, { data: "a" }],
    ["a number becoming an object", { data: 1 }, { data: { k: 1 } }],
    ["an object becoming a boolean", { data: { k: 1 } }, { data: true }],
    ["a string becoming `null`", { data: "a" }, { data: null }],
    ["`null` becoming a string", { data: null }, { data: "a" }],
    ["an absent prop given an array", {}, { data: [] }],
    ["an absent prop given an object", {}, { data: {} }],
    ["an absent prop given `null`", {}, { data: null }],
    ["an array taken away", { data: ["a"] }, {}],
    ["an object taken away", { data: { k: 1 } }, {}],
    ["`null` taken away", { data: null }, {}],
  ];
  for (const [index, [name, before, after]] of notScalar.entries()) {
    test(`${name} is refused and nothing is written`, async () => {
      const tagName = `uip-not-scalar-${index}`;
      await defineElement(
        cardWith(
          tagName,
          [{ className: "data", tagName: "i", textContent: "${JSON.stringify(state.data)}" }],
          { data: "d" },
        ),
      );
      // A writable change comes first in the block, so a refusal has something not to write.
      const el = await place({ $props: { label: "a", ...before }, tagName });
      const drawn = el.innerHTML;
      const data = propJson(el, "data");
      const span = el.querySelector(".out");

      expect(updateInstanceProps(el, { label: "a", ...before }, { label: "b", ...after })).toBe(
        false,
      );
      await settle();
      expect(el.innerHTML).toBe(drawn);
      expect(propJson(el, "data")).toBe(data ?? "");
      expect(prop(el, "label")).toBe("a");
      expect(el.querySelector(".out")).toBe(span);
    });
  }

  test("an array or an object that did not change does not refuse the scalar beside it", async () => {
    await defineElement(
      cardWith(
        "uip-not-scalar-same",
        [{ className: "data", tagName: "i", textContent: "${JSON.stringify(state.data)}" }],
        { data: "d", more: { default: null } },
      ),
    );
    const before: Props = { count: 1, data: ["a", { k: 1 }], label: "a", more: null };
    const el = await place({
      $props: before,
      children: [{ className: "kept", tagName: "em", textContent: "slotted" }],
      tagName: "uip-not-scalar-same",
    });
    const data = el.querySelector(".data");
    expect(data?.textContent).toBe('["a",{"k":1}]');

    expect(
      updateInstanceProps(el, before, { count: 2, data: ["a", { k: 1 }], label: "b", more: null }),
    ).toBe(true);
    await settle();
    expect(shown(el)).toBe("b:2");
    expect(el.querySelector(".data")).toBe(data);
    expect(data?.textContent).toBe('["a",{"k":1}]');
  });
});

describe("updateInstanceProps: a state entry produced elsewhere", () => {
  const STORE_KEY = "uip-elsewhere-theme";

  afterEach(() => {
    localStorage.clear();
  });

  test("a prop overriding a `LocalStorage` entry is refused, and the store is untouched", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify("stored"));
    await defineElement(
      cardWith(
        "uip-elsewhere-store",
        [{ className: "theme", tagName: "i", textContent: "${state.theme}" }],
        { theme: { $prototype: "LocalStorage", default: "light", key: STORE_KEY } },
      ),
    );
    const before: Props = { label: "a", theme: "dark" };
    const el = await place({ $props: before, tagName: "uip-elsewhere-store" });
    const stored = localStorage.getItem(STORE_KEY);
    const drawn = el.innerHTML;
    expect(stored).toBeString();

    // Changed alone, changed beside a writable prop, and taken away: each is refused.
    expect(updateInstanceProps(el, before, { label: "a", theme: "blue" })).toBe(false);
    expect(updateInstanceProps(el, before, { label: "b", theme: "blue" })).toBe(false);
    expect(updateInstanceProps(el, before, { label: "a" })).toBe(false);
    await settle();
    expect(localStorage.getItem(STORE_KEY)).toBe(stored);
    expect(el.innerHTML).toBe(drawn);
    expect(prop(el, "label")).toBe("a");
  });

  const elsewhere: [string, NonNullable<JxDocument["state"]>[string]][] = [
    [
      "a `LocalStorage` entry",
      { $prototype: "LocalStorage", default: "light", key: "uip-elsewhere-unrelated" },
    ],
    ["a `Set` entry", { $prototype: "Set", default: ["x"] }],
    ["an entry with a `$src`", { $export: "load", $src: "./uip-elsewhere-module.js" }],
    ["an entry with a `timing`", { default: "t", timing: "client" }],
  ];
  for (const [index, [name, entry]] of elsewhere.entries()) {
    test(`${name} in the definition refuses a write to an unrelated prop`, async () => {
      const tagName = `uip-elsewhere-own-${index}`;
      await defineElement(cardWith(tagName, [], { other: entry }));
      await expectRefused(await placeCard(tagName));
    });

    test(`${name} in a definition the outer one draws refuses the write`, async () => {
      const leaf = `uip-elsewhere-leaf-${index}`;
      const tagName = `uip-elsewhere-outer-${index}`;
      await defineElement({
        children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
        state: { label: "none", other: entry },
        tagName: leaf,
      });
      await defineElement(
        cardWith(tagName, [
          // Under an ordinary element, and given a literal: nothing in the outer one is bound.
          { children: [{ $props: { label: "fixed" }, tagName: leaf }], tagName: "section" },
        ]),
      );
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      expect(inner).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(leaf)).toBe(inner);
    });
  }

  test("a `Function` entry is not produced elsewhere: here, and in a definition this one draws", async () => {
    const bump = { $prototype: "Function", body: "state.count = state.count + 1" } as const;
    await defineElement({
      children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
      state: { bump, count: 0, label: "none" },
      tagName: "uip-elsewhere-fn-leaf",
    });
    await defineElement(
      cardWith(
        "uip-elsewhere-fn",
        [
          { className: "bump", onclick: { $ref: "#/state/bump" }, tagName: "button" },
          { $props: { label: "fixed" }, tagName: "uip-elsewhere-fn-leaf" },
        ],
        { bump },
      ),
    );
    const el = await placeCard("uip-elsewhere-fn");
    const inner = el.querySelector("uip-elsewhere-fn-leaf");
    await expectWritten(el);
    expect(el.querySelector("uip-elsewhere-fn-leaf")).toBe(inner);
  });

  test("a prop overriding a `Function` entry is refused: what the instance holds there is no scalar", async () => {
    await defineElement(
      cardWith(
        "uip-elsewhere-fn-prop",
        [{ className: "bump", onclick: { $ref: "#/state/bump" }, tagName: "button" }],
        { bump: { $prototype: "Function", body: "state.count = state.count + 1" } },
      ),
    );
    const el = await placeCard("uip-elsewhere-fn-prop");
    const drawn = el.innerHTML;
    const span = el.querySelector(".out");

    // Added beside a writable change, and alone.
    expect(
      updateInstanceProps(el, { count: 1, label: "a" }, { bump: "off", count: 1, label: "b" }),
    ).toBe(false);
    expect(
      updateInstanceProps(el, { count: 1, label: "a" }, { bump: "off", count: 1, label: "a" }),
    ).toBe(false);
    await settle();
    expect(el.innerHTML).toBe(drawn);
    expect(prop(el, "label")).toBe("a");
    expect(el.querySelector(".out")).toBe(span);

    // The handler the render bound is still the function.
    el.querySelector<HTMLElement>(".bump")?.click();
    await settle();
    expect(shown(el)).toBe("a:2");
  });
});

describe("updateInstanceProps: content a plain node draws from a binding", () => {
  // `JxElement` types `innerHTML` as a string; a document can still bind one, and the runtime draws it.
  const unbound: Partial<JxElement> = { className: "drawn" };
  const htmlRef: Partial<JxElement> = Object.assign(unbound, {
    innerHTML: { $ref: "#/state/label" },
  });
  const drawnFromBinding: [string, Partial<JxElement>][] = [
    ["`innerHTML` bound to a template", { innerHTML: "<b>${state.label}</b>" }],
    ["`innerHTML` bound to a `$ref`", htmlRef],
    ["`children` that are one template", { children: "${state.kids}" }],
  ];
  for (const [index, [name, given]] of drawnFromBinding.entries()) {
    test(`${name} on a plain node is refused`, async () => {
      const tagName = `uip-drawn-${index}`;
      await defineElement(
        cardWith(tagName, [{ ...given, className: "drawn", tagName: "p" }], {
          kids: { default: [] },
        }),
      );
      const el = await placeCard(tagName);
      const drawn = el.querySelector(".drawn");
      expect(drawn).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(".drawn")).toBe(drawn);
    });

    test(`${name} on a plain node of a definition the outer one draws is refused`, async () => {
      const leaf = `uip-drawn-leaf-${index}`;
      const tagName = `uip-drawn-outer-${index}`;
      await defineElement({
        children: [{ ...given, className: "drawn", tagName: "p" }],
        state: { kids: { default: [] }, label: "none" },
        tagName: leaf,
      });
      await defineElement(cardWith(tagName, [{ $props: { label: "fixed" }, tagName: leaf }]));
      await expectRefused(await placeCard(tagName));
    });
  }

  test("literal `innerHTML` and literal children are written past", async () => {
    await defineElement(
      cardWith("uip-drawn-literal", [
        { className: "drawn", innerHTML: "<b>fixed</b>", tagName: "p" },
        { children: ["text", { tagName: "b", textContent: "${state.label}" }], tagName: "p" },
      ]),
    );
    const el = await placeCard("uip-drawn-literal");
    const drawn = el.querySelector(".drawn");
    await expectWritten(el);
    expect(el.querySelector(".drawn")).toBe(drawn);
    expect(drawn?.innerHTML).toBe("<b>fixed</b>");
  });
});

describe("updateInstanceProps: a component the definition draws and forwards a prop to", () => {
  const leafOf = (tagName: string): JxDocument => ({
    children: [
      { className: "leaf", tagName: "i", textContent: "${state.label}:${state.itemCount}" },
    ],
    state: { itemCount: 1, label: "none" },
    tagName,
  });

  const platformNamed: [string, NonNullable<Props>][] = [
    ["`hidden` bound to a `$ref`", { hidden: { $ref: "#/state/flag" } }],
    ["`hidden` bound to a template", { hidden: "${state.flag}" }],
    ["`title` bound to a template", { title: "${state.label}" }],
    ["`title` bound to a `$ref`", { title: { $ref: "#/state/label" } }],
    ["`title` bound beside a prop it declares", { label: "fixed", title: "${state.label}" }],
  ];
  for (const [index, [name, $props]] of platformNamed.entries()) {
    test(`${name} is read back through the platform at connection, so the write is refused`, async () => {
      const leaf = `uip-forward-leaf-${index}`;
      const tagName = `uip-forward-outer-${index}`;
      await defineElement(leafOf(leaf));
      await defineElement(cardWith(tagName, [{ $props, tagName: leaf }], { flag: false }));
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      expect(inner).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(leaf)).toBe(inner);
    });
  }

  test("a bound prop the platform has no property for is written through", async () => {
    await defineElement(leafOf("uip-forward-plain-leaf"));
    await defineElement(
      cardWith("uip-forward-plain", [
        {
          $props: { itemCount: { $ref: "#/state/count" }, label: "${state.label}" },
          tagName: "uip-forward-plain-leaf",
        },
      ]),
    );
    const el = await placeCard("uip-forward-plain");
    const inner = el.querySelector("uip-forward-plain-leaf");
    const leaf = el.querySelector(".leaf");
    expect(leaf?.textContent).toBe("a:1");

    await expectWritten(el);
    expect(el.querySelector("uip-forward-plain-leaf")).toBe(inner);
    expect(el.querySelector(".leaf")).toBe(leaf);
    expect(leaf?.textContent).toBe("b:2");
  });

  test("a literal `title` or `hidden` is not a binding, and is written past", async () => {
    await defineElement(leafOf("uip-forward-literal-leaf"));
    await defineElement(
      cardWith("uip-forward-literal", [
        {
          $props: { hidden: false, label: "${state.label}", title: "fixed" },
          tagName: "uip-forward-literal-leaf",
        },
      ]),
    );
    const el = await placeCard("uip-forward-literal");
    const inner = el.querySelector<HTMLElement>("uip-forward-literal-leaf");
    expect(inner?.title).toBe("fixed");

    await expectWritten(el);
    expect(el.querySelector("uip-forward-literal-leaf")).toBe(inner);
    expect(inner?.title).toBe("fixed");
    expect(el.querySelector(".leaf")?.textContent).toBe("b:1");
  });
});

describe("updateInstanceProps: the observed attributes are the list first defined", () => {
  const observing = (tagName: string, observedAttributes?: string[]): JxDocument => {
    const doc: JxDocument = {
      children: [
        { className: "out", tagName: "span", textContent: "${state.label}:${state.itemCount}" },
      ],
      state: { itemCount: 1, label: "none" },
      tagName,
    };
    if (observedAttributes) {
      doc.observedAttributes = observedAttributes;
    }
    return doc;
  };

  /** Redefine with the warning about the frozen list kept out of the run's output. */
  async function redefineQuietly(doc: JxDocument): Promise<string[]> {
    const warned: string[] = [];
    const warn = spyOn(console, "warn").mockImplementation((message: string) => {
      warned.push(message);
    });
    try {
      await redefineElement(doc);
    } finally {
      warn.mockRestore();
    }
    return warned;
  }

  test("a redefinition that drops the list still refuses a removal whose attribute is on the host", async () => {
    const tagName = "uip-frozen-dropped";
    await defineElement(observing(tagName, ["label", "item-count"]));
    const before: Props = { itemCount: 5, label: "a" };
    const el = await place({
      $props: before,
      attributes: { "item-count": "9", label: "attr" },
      tagName,
    });
    const drawn = shown(el);
    expect(drawn).toBeString();
    expect(updateInstanceProps(el, before, { itemCount: 5 })).toBe(false);

    const warned = await redefineQuietly(observing(tagName));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("keeps observedAttributes [label, item-count]");

    expect(updateInstanceProps(el, before, { itemCount: 5 })).toBe(false);
    expect(updateInstanceProps(el, before, { label: "a" })).toBe(false);
    await tick();
    expect(shown(el)).toBe(drawn ?? null);
    expect(prop(el, "label")).toBe("a");
    expect(prop(el, "itemCount")).toBe("5");

    // The attribute is still read by the class the platform kept: the list is live, not a relic.
    el.setAttribute("label", "again");
    await tick();
    expect(shown(el)).toStartWith("again:");
  });

  test("a redefinition that adds a list refuses the instance placed before it, and holds nothing back in one placed after", async () => {
    const tagName = "uip-frozen-added";
    await defineElement(observing(tagName));
    const before: Props = { label: "a" };
    const usage: JxElement = { $props: before, attributes: { label: "attr" }, tagName };
    const el = await place(usage);
    expect(shown(el)).toBe("a:1");

    const warned = await redefineQuietly(observing(tagName, ["label"]));
    expect(warned).toHaveLength(1);

    // Connected with the definition that is gone: refused, and nothing is written.
    expect(updateInstanceProps(el, before, {})).toBe(false);
    await tick();
    expect(shown(el)).toBe("a:1");
    expect(prop(el, "label")).toBe("a");

    // Connected with the new one, whose list the platform never took: nothing observes `label`.
    const fresh = await place(usage);
    expect(shown(fresh)).toBe("a:1");
    expect(updateInstanceProps(fresh, before, {})).toBe(true);
    await tick();
    expect(shown(fresh)).toBe("none:1");
    await expectLikeFresh(fresh, { attributes: { label: "attr" }, tagName });
    fresh.setAttribute("label", "again");
    await tick();
    expect(shown(fresh)).toBe("none:1");
  });

  test("a list nobody redefined does not hold back a removal whose attribute it does not name", async () => {
    const tagName = "uip-frozen-unnamed";
    await defineElement(observing(tagName, ["item-count"]));
    const before: Props = { label: "a" };
    const el = await place({ $props: before, attributes: { label: "attr" }, tagName });
    expect(shown(el)).toBe("a:1");

    expect(updateInstanceProps(el, before, {})).toBe(true);
    await tick();
    expect(shown(el)).toBe("none:1");
    await expectLikeFresh(el, { attributes: { label: "attr" }, tagName });
  });

  test("a component drawn inside is asked about the list it was first defined with", async () => {
    // First defined observing `label`, then redefined to say it observes nothing.
    await defineElement(observing("uip-frozen-leaf-kept", ["label"]));
    await redefineQuietly(observing("uip-frozen-leaf-kept"));
    await defineElement(
      cardWith("uip-frozen-outer-kept", [
        { attributes: { label: "${state.label}" }, tagName: "uip-frozen-leaf-kept" },
      ]),
    );
    const kept = await placeCard("uip-frozen-outer-kept");
    const inner = kept.querySelector("uip-frozen-leaf-kept");
    expect(inner?.textContent).toBe("a:1");
    await expectWritten(kept);
    expect(kept.querySelector("uip-frozen-leaf-kept")).toBe(inner);
    expect(inner?.textContent).toBe("b:1");
    document.body.replaceChildren();

    // First defined observing nothing, then redefined to say it observes `label`.
    await defineElement(observing("uip-frozen-leaf-never"));
    await redefineQuietly(observing("uip-frozen-leaf-never", ["label"]));
    await defineElement(
      cardWith("uip-frozen-outer-never", [
        { attributes: { label: "${state.label}" }, tagName: "uip-frozen-leaf-never" },
      ]),
    );
    await expectRefused(await placeCard("uip-frozen-outer-never"));
  });
});

describe("updateInstanceProps: a template binding that throws", () => {
  let thrown: string[] = [];

  beforeEach(() => {
    thrown = [];
    setTemplateErrorHandler((_error, source) => {
      thrown.push(source);
    });
  });

  afterEach(() => {
    setTemplateErrorHandler(null);
  });

  const LOUD = "${state.label.toUpperCase()}";
  const loud = (tagName: string): JxDocument => ({
    children: [
      { className: "out", tagName: "span", textContent: LOUD },
      { className: "count", tagName: "i", textContent: "${state.count}" },
    ],
    state: { count: 1, label: "none" },
    tagName,
  });

  test("on the value just written is survived, and the answer is false", async () => {
    await defineElement(loud("uip-template-throws"));
    const before: Props = { label: "a" };
    const el = await place({ $props: before, tagName: "uip-template-throws" });
    expect(shown(el)).toBe("A");
    expect(thrown).toStrictEqual([]);

    let answer: boolean | undefined;
    expect(() => {
      answer = updateInstanceProps(el, before, { label: 5 });
    }).not.toThrow();
    expect(answer).toBe(false);
    expect(thrown).toStrictEqual([LOUD]);
    // The binding kept what it last drew, which is what a fresh render of `5` would not show.
    expect(shown(el)).toBe("A");
  });

  test("on one prop of several still answers false, though the others drew", async () => {
    await defineElement(loud("uip-template-throws-beside"));
    const before: Props = { count: 1, label: "a" };
    const el = await place({ $props: before, tagName: "uip-template-throws-beside" });

    expect(updateInstanceProps(el, before, { count: 2, label: 5 })).toBe(false);
    expect(thrown).toStrictEqual([LOUD]);
  });

  test("a write the binding survives without throwing is answered true, and the next is too", async () => {
    await defineElement(loud("uip-template-recovers"));
    const el = await place({ $props: { label: "a" }, tagName: "uip-template-recovers" });

    expect(updateInstanceProps(el, { label: "a" }, { label: 5 })).toBe(false);
    // The count moved once and is read around each call, not against zero.
    expect(updateInstanceProps(el, { label: 5 }, { label: "b" })).toBe(true);
    await tick();
    expect(shown(el)).toBe("B");
    expect(thrown).toStrictEqual([LOUD]);
  });

  test("an unrelated template that had already thrown does not refuse the write", async () => {
    const BROKEN = "${state.missing.name}";
    await defineElement(
      cardWith(
        "uip-template-thrown-before",
        [{ className: "broken", tagName: "i", textContent: BROKEN }],
        {
          missing: { default: null },
        },
      ),
    );
    const el = await placeCard("uip-template-thrown-before");
    expect(thrown).toStrictEqual([BROKEN]);
    const broken = el.querySelector(".broken");

    await expectWritten(el);
    expect(thrown).toStrictEqual([BROKEN]);
    expect(el.querySelector(".broken")).toBe(broken);
  });
});

/** The usage {@link placeCard} draws, after the edit {@link expectWritten} makes. */
function cardAfter(tagName: string): JxElement {
  return {
    $props: { count: 2, label: "b" },
    children: [{ className: "kept", tagName: "em", textContent: "slotted" }],
    tagName,
  };
}

/** A node with one more member than `JxElement` types, which a document can still carry. */
function withMember(node: JxElement, key: string, value: NonNullable<Props>[string]): JxElement {
  return Object.assign(node, { [key]: value });
}

describe("updateInstanceProps: a scalar that feeds a list", () => {
  /** A label, and a list whose rows are derived from the scalar `names`. */
  const listed = (tagName: string): JxDocument => ({
    children: [
      { className: "out", tagName: "span", textContent: "${state.label}:${state.count}" },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: "${$map.item}" },
          },
        ],
        tagName: "ul",
      },
    ],
    state: {
      count: 1,
      label: "none",
      names: "",
      rows: "${state.names.split(' ').filter(Boolean)}",
    },
    tagName,
  });

  test("through a computed entry is answered false: the rows are drawn in a later microtask", async () => {
    await defineElement(listed("uip-list-fed"));
    const before: Props = { label: "a", names: "one" };
    const el = await place({ $props: before, tagName: "uip-list-fed" });
    const [first] = el.querySelectorAll("li");
    expect(first?.textContent).toBe("one");

    expect(updateInstanceProps(el, before, { label: "a", names: "one two" })).toBe(false);
    // Known only after the fact: at the answer the prop is written and the row is not drawn yet.
    expect(prop(el, "names")).toBe("one two");
    expect(el.querySelectorAll("li")).toHaveLength(1);
    await settle();
    expect([...el.querySelectorAll("li")].map((row) => row.textContent)).toStrictEqual([
      "one",
      "two",
    ]);

    // Beside a prop no list reads, the answer is still the list's.
    expect(
      updateInstanceProps(el, { label: "a", names: "one two" }, { label: "b", names: "one" }),
    ).toBe(false);
    // And a removal that empties the list is a redraw too.
    await settle();
    expect(updateInstanceProps(el, { label: "b", names: "one" }, { label: "b" })).toBe(false);
  });

  test("is written when the write reaches no list, though the definition draws one", async () => {
    await defineElement(listed("uip-list-unfed"));
    const before: Props = { count: 1, label: "a", names: "one two" };
    const after: Props = { count: 2, label: "b", names: "one two" };
    const el = await place({ $props: before, tagName: "uip-list-unfed" });
    const rows = [...el.querySelectorAll("li")];
    expect(rows).toHaveLength(2);

    expect(updateInstanceProps(el, before, after)).toBe(true);
    await settle();
    expect(shown(el)).toBe("b:2");
    const kept = [...el.querySelectorAll("li")];
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe(rows[0]);
    expect(kept[1]).toBe(rows[1]);
    await expectLikeFresh(el, { $props: after, tagName: "uip-list-unfed" });

    // The count is read around each call: an earlier redraw does not refuse a later write.
    expect(updateInstanceProps(el, after, { count: 2, label: "b", names: "one" })).toBe(false);
    await settle();
    const last: Props = { count: 3, label: "c", names: "one" };
    expect(updateInstanceProps(el, { count: 2, label: "b", names: "one" }, last)).toBe(true);
    await settle();
    await expectLikeFresh(el, { $props: last, tagName: "uip-list-unfed" });
  });
});

describe("updateInstanceProps: a slot's own fallback content", () => {
  const fallbacks: [string, JxElement][] = [
    [
      "bound `textContent`",
      { attributes: { name: "aside" }, tagName: "slot", textContent: "${state.label}" },
    ],
    [
      "`textContent` bound to a `$ref`",
      { attributes: { name: "aside" }, tagName: "slot", textContent: { $ref: "#/state/label" } },
    ],
    [
      "a `$switch` of its own",
      {
        $switch: { $ref: "#/state/label" },
        attributes: { name: "aside" },
        cases: {
          a: { tagName: "b", textContent: "first" },
          b: { tagName: "b", textContent: "second" },
        },
        tagName: "slot",
      },
    ],
  ];
  for (const [index, [name, slot]] of fallbacks.entries()) {
    test(`with ${name} is refused`, async () => {
      const tagName = `uip-slot-fallback-${index}`;
      await defineElement(cardWith(tagName, [{ children: [slot], tagName: "aside" }]));
      await expectRefused(await placeCard(tagName));
    });
  }

  test("with a bound child string is a live text binding, and is written like a fresh render", async () => {
    const tagName = "uip-slot-fallback-child";
    await defineElement(
      cardWith(tagName, [
        {
          children: [
            { attributes: { name: "aside" }, children: ["${state.label}"], tagName: "slot" },
          ],
          className: "aside",
          tagName: "aside",
        },
      ]),
    );
    // Nothing fills the slot: the fallback is what is drawn.
    const empty = await placeCard(tagName);
    expect(empty.querySelector(".aside")?.textContent).toBe("a");
    await expectWritten(empty);
    expect(empty.querySelector(".aside")?.textContent).toBe("b");
    await expectLikeFresh(empty, cardAfter(tagName));

    // Something fills it: the fallback is not drawn, before or after.
    const filled: JxElement = {
      $props: { count: 1, label: "a" },
      children: [{ attributes: { slot: "aside" }, className: "kept", tagName: "em" }],
      tagName,
    };
    const el = await place(filled);
    await expectWritten(el);
    expect(el.querySelector(".kept")?.parentElement?.localName).toBe("aside");
    await expectLikeFresh(el, { ...filled, $props: { count: 2, label: "b" } });
  });

  test("with a bound element child is written like a fresh render", async () => {
    const tagName = "uip-slot-fallback-element";
    await defineElement(
      cardWith(tagName, [
        {
          children: [
            {
              attributes: { name: "aside" },
              children: [{ className: "fallback", tagName: "b", textContent: "${state.label}" }],
              tagName: "slot",
            },
          ],
          tagName: "aside",
        },
      ]),
    );
    const el = await placeCard(tagName);
    const fallback = el.querySelector(".fallback");
    expect(fallback?.textContent).toBe("a");
    await expectWritten(el);
    expect(el.querySelector(".fallback")).toBe(fallback);
    expect(fallback?.textContent).toBe("b");
    await expectLikeFresh(el, cardAfter(tagName));
  });
});

describe("updateInstanceProps: the slot content a definition gives a component it draws", () => {
  /** A leaf with a default slot and two named ones, which groups its content once. */
  const slotted = (tagName: string): JxDocument => ({
    children: [
      { children: [{ tagName: "slot" }], className: "main", tagName: "div" },
      {
        children: [{ attributes: { name: "a" }, tagName: "slot" }],
        className: "a",
        tagName: "div",
      },
      {
        children: [{ attributes: { name: "b" }, tagName: "slot" }],
        className: "b",
        tagName: "div",
      },
    ],
    state: { label: "none" },
    tagName,
  });

  const row: JxElement = { tagName: "b", textContent: "x" };
  const given: [string, NonNullable<JxElement["children"]>][] = [
    ["a template string", ["${state.label}"]],
    ["a template string beside literal children", ["text", "${state.label}", { tagName: "b" }]],
    ["a mapped array", [{ $prototype: "Array", items: { $ref: "#/state/rows" }, map: row }]],
    [
      "a child whose `slot` attribute is a template",
      [{ attributes: { slot: "${state.label}" }, tagName: "b", textContent: "x" }],
    ],
    [
      "a child whose `slot` attribute is a `$ref`",
      [{ attributes: { slot: { $ref: "#/state/label" } }, tagName: "b", textContent: "x" }],
    ],
    [
      "a child whose `slot` property is a template",
      [withMember({ tagName: "b", textContent: "x" }, "slot", "${state.label}")],
    ],
    [
      "a child whose `slot` property is a `$ref`",
      [withMember({ tagName: "b", textContent: "x" }, "slot", { $ref: "#/state/label" })],
    ],
  ];
  for (const [index, [name, children]] of given.entries()) {
    test(`${name} is grouped once, so the write is refused`, async () => {
      const leaf = `uip-kids-leaf-${index}`;
      const tagName = `uip-kids-outer-${index}`;
      await defineElement(slotted(leaf));
      await defineElement(
        cardWith(tagName, [{ children, tagName: leaf }], { rows: { default: ["r"] } }),
      );
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      expect(inner).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(leaf)).toBe(inner);
    });
  }

  test("a `$ref` item among the children is refused", async () => {
    await defineElement(slotted("uip-kids-leaf-ref"));
    // `JxElement` has no `$ref` child; a document can still carry one, and the runtime warns of it.
    const item = withMember({ tagName: "b" }, "$ref", "#/state/label");
    await defineElement(
      cardWith("uip-kids-outer-ref", [{ children: [item], tagName: "uip-kids-leaf-ref" }]),
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {
      /* The unsupported child is reported once per render: kept out of the run's output. */
    });
    try {
      await expectRefused(await placeCard("uip-kids-outer-ref"));
    } finally {
      warn.mockRestore();
    }
  });

  test("only literal children, and a binding inside one of them, are written like a fresh render", async () => {
    await defineElement(slotted("uip-kids-leaf-literal"));
    await defineElement(
      cardWith("uip-kids-outer-literal", [
        {
          children: [
            "text",
            { attributes: { slot: "a" }, className: "named", tagName: "b", textContent: "x" },
            // Bound below the child the component groups: the child itself never moves.
            { className: "deep", tagName: "i", textContent: "${state.label}" },
          ],
          tagName: "uip-kids-leaf-literal",
        },
      ]),
    );
    const el = await placeCard("uip-kids-outer-literal");
    const inner = el.querySelector("uip-kids-leaf-literal");
    const named = el.querySelector(".named");
    const deep = el.querySelector(".deep");
    expect(named?.parentElement?.className).toBe("a");
    expect(deep?.textContent).toBe("a");

    await expectWritten(el);
    expect(el.querySelector("uip-kids-leaf-literal")).toBe(inner);
    expect(el.querySelector(".named")).toBe(named);
    expect(el.querySelector(".deep")).toBe(deep);
    expect(deep?.textContent).toBe("b");
    expect(deep?.parentElement?.className).toBe("main");
    await expectLikeFresh(el, cardAfter("uip-kids-outer-literal"));
  });
});

describe("updateInstanceProps: a `$switch` case with the name of a root key", () => {
  for (const [index, name] of ["state", "$props"].entries()) {
    test(`a slot under a case called \`${name}\` is refused: the cases are walked by value`, async () => {
      const tagName = `uip-case-named-${index}`;
      await defineElement(
        cardWith(
          tagName,
          [
            {
              $switch: { $ref: "#/state/view" },
              cases: {
                [name]: {
                  children: [{ attributes: { name: "aside" }, tagName: "slot" }],
                  tagName: "p",
                },
                two: { className: "two", tagName: "p" },
              },
              tagName: "section",
            },
          ],
          // The case is not the one drawn: the answer is the document's.
          { view: "two" },
        ),
      );
      const el = await placeCard(tagName);
      expect(el.querySelector(".two")).not.toBeNull();
      await expectRefused(el);
    });
  }

  test("the root's own `state` is still not walked, whatever an entry's default looks like", async () => {
    const tagName = "uip-case-root-state";
    await defineElement(
      cardWith(tagName, [{ className: "sketch", tagName: "i", textContent: "${state.label}" }], {
        // A default that reads as a node which would refuse the write, were it drawn.
        sketch: {
          default: { name: "${state.label}", tagName: "slot", textContent: "${state.label}" },
        },
      }),
    );
    const el = await placeCard(tagName);
    await expectWritten(el);
    expect(el.querySelector(".sketch")?.textContent).toBe("b");
    await expectLikeFresh(el, cardAfter(tagName));
  });
});

describe("updateInstanceProps: a bound property on the node that draws a component", () => {
  const leafOf = (tagName: string): JxDocument => ({
    children: [
      { className: "leaf", tagName: "i", textContent: "${state.label}:${state.itemCount}" },
    ],
    state: { itemCount: 1, label: "none" },
    tagName,
  });

  const platformNamed: [string, string, NonNullable<Props>[string]][] = [
    ["`hidden` bound to a `$ref`", "hidden", { $ref: "#/state/flag" }],
    ["`hidden` bound to a template", "hidden", "${state.flag}"],
    ["`title` bound to a template", "title", "${state.label}"],
    ["`title` bound to a `$ref`", "title", { $ref: "#/state/label" }],
    ["`tabIndex` bound to a `$ref`", "tabIndex", { $ref: "#/state/count" }],
  ];
  for (const [index, [name, key, value]] of platformNamed.entries()) {
    test(`${name} is read back through the platform at connection, so the write is refused`, async () => {
      const leaf = `uip-node-leaf-${index}`;
      const tagName = `uip-node-outer-${index}`;
      await defineElement(leafOf(leaf));
      await defineElement(
        cardWith(tagName, [withMember({ tagName: leaf }, key, value)], { flag: false }),
      );
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      expect(inner).not.toBeNull();
      await expectRefused(el);
      expect(el.querySelector(leaf)).toBe(inner);
    });
  }

  const forwarded: [string, NonNullable<Props>[string]][] = [
    ["a template", "${state.label}"],
    ["a `$ref`", { $ref: "#/state/label" }],
  ];
  for (const [index, [name, value]] of forwarded.entries()) {
    test(`a prop the platform has no property for, bound to ${name}, is written through`, async () => {
      const leaf = `uip-node-plain-leaf-${index}`;
      const tagName = `uip-node-plain-outer-${index}`;
      await defineElement(leafOf(leaf));
      await defineElement(cardWith(tagName, [withMember({ tagName: leaf }, "label", value)]));
      const el = await placeCard(tagName);
      const inner = el.querySelector(leaf);
      const drawn = el.querySelector(".leaf");
      expect(drawn?.textContent).toBe("a:1");

      await expectWritten(el);
      expect(el.querySelector(leaf)).toBe(inner);
      expect(el.querySelector(".leaf")).toBe(drawn);
      expect(drawn?.textContent).toBe("b:1");
      await expectLikeFresh(el, cardAfter(tagName));
    });
  }

  test("a literal `title` or `hidden` on the node is not a binding, and is written past", async () => {
    await defineElement(leafOf("uip-node-literal-leaf"));
    await defineElement(
      cardWith("uip-node-literal", [
        { hidden: false, tagName: "uip-node-literal-leaf", title: "fixed" },
      ]),
    );
    const el = await placeCard("uip-node-literal");
    await expectWritten(el);
    expect(el.querySelector<HTMLElement>("uip-node-literal-leaf")?.title).toBe("fixed");
    await expectLikeFresh(el, cardAfter("uip-node-literal"));
  });
});

describe("updateInstanceProps: what the instance holds for a declared key", () => {
  const held: [string, NonNullable<JxDocument["state"]>[string], string][] = [
    ["an object default", { default: { k: 1 } }, '{"k":1}'],
    ["an array default", { default: ["x"] }, '["x"]'],
    ["a `null` default", { default: null }, "null"],
    [
      "a computed `$expression`",
      { $expression: { operator: "*", target: { $ref: "#/state/count" }, value: 2 } },
      "2",
    ],
    ["a template", "${state.label}!", '"a!"'],
  ];
  for (const [index, [name, entry, drawn]] of held.entries()) {
    test(`a prop added over ${name} is refused and nothing is written`, async () => {
      const tagName = `uip-held-${index}`;
      await defineElement(
        cardWith(
          tagName,
          [{ className: "data", tagName: "i", textContent: "${JSON.stringify(state.data)}" }],
          { data: entry },
        ),
      );
      const el = await placeCard(tagName);
      const data = el.querySelector(".data");
      expect(data?.textContent).toBe(drawn);
      const html = el.innerHTML;

      // Alone, and beside a change that would otherwise be written.
      expect(
        updateInstanceProps(el, { count: 1, label: "a" }, { count: 1, data: "s", label: "a" }),
      ).toBe(false);
      expect(
        updateInstanceProps(el, { count: 1, label: "a" }, { count: 2, data: 7, label: "b" }),
      ).toBe(false);
      await settle();
      expect(el.innerHTML).toBe(html);
      expect(el.querySelector(".data")).toBe(data);
      expect(prop(el, "label")).toBe("a");
      expect(prop(el, "count")).toBe("1");
    });
  }

  test("an entry that is not a scalar does not refuse a write to the props beside it", async () => {
    const tagName = "uip-held-beside";
    await defineElement(
      cardWith(
        tagName,
        [{ className: "data", tagName: "i", textContent: "${JSON.stringify(state.data)}" }],
        {
          data: { default: { k: 1 } },
          twice: { $expression: { operator: "*", target: { $ref: "#/state/count" }, value: 2 } },
        },
      ),
    );
    const el = await placeCard(tagName);
    await expectWritten(el);
    expect(prop(el, "twice")).toBe("4");
    await expectLikeFresh(el, cardAfter(tagName));
  });
});

describe("updateInstanceProps: an `onMount` the document declares", () => {
  const mount = { $prototype: "Function", body: "state.seen = state.label" } as const;
  const mounting = (tagName: string): JxDocument => ({
    children: [{ className: "leaf", tagName: "i", textContent: "${state.seen}" }],
    state: { label: "none", onMount: mount, seen: "" },
    tagName,
  });

  test("in the definition's own state refuses, and nothing is written", async () => {
    await defineElement(cardWith("uip-static-mount-own", [], { onMount: mount, seen: "" }));
    const el = await placeCard("uip-static-mount-own");
    expect(prop(el, "seen")).toBe("a");
    await expectRefused(el);
    expect(prop(el, "seen")).toBe("a");
  });

  test("in a definition drawn only inside a `$switch` case nobody chose refuses", async () => {
    await defineElement(mounting("uip-static-mount-leaf"));
    await defineElement(
      cardWith(
        "uip-static-mount-case",
        [
          {
            $switch: { $ref: "#/state/view" },
            cases: {
              closed: { className: "case", tagName: "p", textContent: "closed" },
              open: { $props: { label: "fixed" }, tagName: "uip-static-mount-leaf" },
            },
            tagName: "section",
          },
        ],
        { view: "closed" },
      ),
    );
    const el = await placeCard("uip-static-mount-case");
    // No instance of the leaf exists, so nothing mounted: the answer is the document's.
    expect(el.querySelector("uip-static-mount-leaf")).toBeNull();
    await expectRefused(el);
    expect(el.querySelector("uip-static-mount-leaf")).toBeNull();
  });

  test("in a definition drawn only by a `$map` with no rows yet refuses", async () => {
    await defineElement(mounting("uip-static-mount-row"));
    await defineElement(
      cardWith(
        "uip-static-mount-map",
        [
          {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "#/state/rows" },
                map: { $props: { label: "fixed" }, tagName: "uip-static-mount-row" },
              },
            ],
            tagName: "ul",
          },
        ],
        { rows: { default: [] } },
      ),
    );
    const el = await placeCard("uip-static-mount-map");
    expect(el.querySelector("uip-static-mount-row")).toBeNull();
    await expectRefused(el);
  });

  test("a case nobody chose that draws a component with no `onMount` is written past", async () => {
    await defineElement({
      children: [{ className: "leaf", tagName: "i", textContent: "${state.label}" }],
      state: { label: "none" },
      tagName: "uip-static-plain-leaf",
    });
    await defineElement(
      cardWith(
        "uip-static-plain-case",
        [
          {
            $switch: { $ref: "#/state/view" },
            cases: {
              closed: { className: "case", tagName: "p", textContent: "closed" },
              open: { $props: { label: "fixed" }, tagName: "uip-static-plain-leaf" },
            },
            tagName: "section",
          },
        ],
        { view: "closed" },
      ),
    );
    const el = await placeCard("uip-static-plain-case");
    await expectWritten(el);
    await expectLikeFresh(el, cardAfter("uip-static-plain-case"));
  });
});

describe("updateInstanceProps: the element class's own fields", () => {
  /** An own data property of the element, read as its descriptor so no accessor is run. */
  function field(el: Element, key: string): PropertyDescriptor | undefined {
    return Object.getOwnPropertyDescriptor(el, key);
  }

  const blocks: [string, Props, Props][] = [
    ["`_state` added", { label: "a" }, { _state: "x", label: "b" }],
    ["`_state` changed", { _state: "x", label: "a" }, { _state: "y", label: "b" }],
    ["`_state` removed", { _state: "x", label: "a" }, { label: "b" }],
    ["`_state` added alone", { label: "a" }, { _state: "x", label: "a" }],
    ["`_jxInitialized` added", { label: "a" }, { _jxInitialized: false, label: "b" }],
    [
      "`_jxInitialized` changed",
      { _jxInitialized: true, label: "a" },
      { _jxInitialized: false, label: "b" },
    ],
    ["`_jxInitialized` removed", { _jxInitialized: true, label: "a" }, { label: "b" }],
  ];
  for (const [index, [name, before, after]] of blocks.entries()) {
    test(`${name} is refused, and the instance keeps its scope`, async () => {
      const tagName = `uip-field-${index}`;
      await defineElement(card(tagName));
      const el = await place({ $props: { label: "a" }, tagName });
      const scope = field(el, "_state");
      expect(scope?.value).toBeObject();
      expect(field(el, "_jxInitialized")?.value).toBe(true);
      const drawn = el.innerHTML;

      expect(updateInstanceProps(el, before, after)).toBe(false);
      await settle();
      expect(field(el, "_state")?.value).toBe(scope?.value);
      expect(field(el, "_jxInitialized")?.value).toBe(true);
      expect(el.innerHTML).toBe(drawn);
      expect(prop(el, "label")).toBe("a");

      // The scope is still the one the instance draws from.
      expect(updateInstanceProps(el, { label: "a" }, { label: "b" })).toBe(true);
      await tick();
      expect(shown(el)).toBe("b:1");
      expect(field(el, "_state")?.value).toBe(scope?.value);
    });
  }
});
