/**
 * The slot rule (spec.md §8.5), through the runtime's exports: capture, group, place, forward.
 *
 * The compiled component module runs an inlined copy and the static prerender applies the rule to
 * definitions; `packages/compiler/tests/slot-distribution-agreement.test.ts` holds all three to one
 * fixture table. These cases pin the interpreter's half on its own.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "bun:test";
import { SLOT_ATTR, SLOT_RECORD_KEY, captureSlotted, distributeSlots } from "../src/runtime";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** A host rendered from `template`, and the nodes `children` parses to, as capture would hand them. */
function setup(template: string, children: string) {
  const host = document.createElement("x-host");
  host.innerHTML = template;
  const source = document.createElement("div");
  source.innerHTML = children;
  return { captured: [...source.childNodes], host };
}

/** Distribute and answer the host's markup. */
function place(template: string, children: string): string {
  const { captured, host } = setup(template, children);
  distributeSlots(host, captured);
  return host.innerHTML;
}

/** The shared group record, as every tier reads it. */
function record(): WeakMap<WeakKey, unknown> {
  const map: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    Symbol.for(SLOT_RECORD_KEY),
  )?.value;
  if (!(map instanceof WeakMap)) {
    throw new TypeError("the runtime installs the slot record when it loads");
  }
  return map;
}

describe("distributeSlots", () => {
  test("each slot is replaced by the group its name selects, and none survives", () => {
    expect(
      place(
        '<header><slot name="head"></slot></header><main><slot></slot></main>',
        '<h1 slot="head">T</h1><p>Body</p>',
      ),
    ).toBe('<header><h1 slot="head">T</h1></header><main><p>Body</p></main>');
  });

  test("whitespace-only text is discarded, so a host given only named children shows its unnamed fallback", () => {
    expect(
      place(
        '<i><slot name="a"></slot></i><b><slot>fallback</slot></b>',
        '\n  <span slot="a">A</span>\n  ',
      ),
    ).toBe('<i><span slot="a">A</span></i><b>fallback</b>');
  });

  test("a non-breaking space is content", () => {
    expect(place("<b><slot>fallback</slot></b>", "&nbsp;")).toBe("<b>&nbsp;</b>");
  });

  test("an empty text node and a comment travel with the unnamed group and do not suppress fallback", () => {
    const { captured, host } = setup("<b><slot>fallback</slot></b>", "<!--marker-->");
    distributeSlots(host, [document.createTextNode(""), ...captured]);
    expect(host.innerHTML).toBe("<b><!--marker-->fallback</b>");
    expect(host.querySelector("b")?.childNodes).toHaveLength(3);
  });

  test("the first slot of a name takes the group and a later one shows its fallback", () => {
    expect(
      place(
        '<i><slot name="a">one</slot></i><b><slot name="a">two</slot></b>',
        '<u slot="a">A</u>',
      ),
    ).toBe('<i><u slot="a">A</u></i><b>two</b>');
  });

  test("an empty slot attribute and an empty name are the unnamed slot", () => {
    expect(place('<b><slot name=""></slot></b>', '<u slot="">A</u>')).toBe(
      '<b><u slot="">A</u></b>',
    );
  });

  test("a group no slot takes is not rendered", () => {
    expect(place("<b><slot></slot></b>", '<u slot="nowhere">A</u><p>p</p>')).toBe(
      "<b><p>p</p></b>",
    );
  });

  test("a slot inside a discarded fallback still takes its name", () => {
    expect(
      place(
        '<b><slot><i><slot name="x">inner</slot></i></slot></b><s><slot name="x">late</slot></s>',
        '<p>p</p><u slot="x">X</u>',
      ),
    ).toBe("<b><p>p</p></b><s>late</s>");
  });

  test("a node's record overrides its slot attribute and is consumed", () => {
    const { captured, host } = setup(
      '<i><slot name="a"></slot></i><b><slot></slot></b>',
      "<u>U</u>",
    );
    const [u] = captured;
    record().set(u!, "a");
    distributeSlots(host, captured);
    expect(host.innerHTML).toBe("<i><u>U</u></i><b></b>");
    expect(record().has(u!)).toBe(false);
  });

  test("a slot placed directly inside another custom element records its group name on what it places", () => {
    const { captured, host } = setup(
      '<x-inner><slot slot="title"></slot></x-inner>',
      "<em>forwarded</em>",
    );
    const [em] = captured;
    distributeSlots(host, captured);
    expect(host.innerHTML).toBe("<x-inner><em>forwarded</em></x-inner>");
    expect(record().get(em!)).toBe("title");
    record().delete(em!);
  });

  test("a host whose template has no slot is left alone", () => {
    expect(place("<b>static</b>", "<p>p</p>")).toBe("<b>static</b>");
  });
});

describe("captureSlotted", () => {
  test("returns the children when there is no data-jx-slots", () => {
    const host = document.createElement("x-host");
    host.innerHTML = "<p>a</p> <p>b</p>";
    expect(captureSlotted(host)).toHaveLength(3);
  });

  test("returns only its own brackets' nodes, including one inside a nested host, records each bracket's name, and removes the attribute", () => {
    const host = document.createElement("x-host");
    host.setAttribute(SLOT_ATTR, "1");
    host.innerHTML =
      "<header><!--jx-slot 1 head%20line--><h1>T</h1><!--/jx-slot 1--></header>" +
      '<x-inner data-jx-slots="2"><!--jx-slot 2 --><!--jx-slot 1 --><p>body</p><!--/jx-slot 1-->' +
      "<!--/jx-slot 2--></x-inner><footer>own markup</footer>";
    const captured = captureSlotted(host);
    expect(captured.map((n) => n.textContent)).toEqual(["T", "body"]);
    expect(captured.map((n) => record().get(n))).toEqual(["head line", ""]);
    expect(host.hasAttribute(SLOT_ATTR)).toBe(false);
    for (const n of captured) {
      record().delete(n);
    }
  });
});
