/**
 * One slot rule, three tiers (spec.md §8.5): the interpreter's `distributeSlots`, the copy a
 * compiled component module inlines (`slotHelperSource`), and the static prerender
 * (`createSlotFill` + `renderStaticNode`). Every row of `SLOT_CASES` runs through all three and
 * must land on the same markup, which is what "the module and the prerender distribute as the
 * interpreter does" means as a check rather than a sentence.
 *
 * The prerender joins siblings with "\n" where the DOM tiers place nodes side by side, so both
 * sides are compared with newlines removed and the non-breaking space spelled one way.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SLOT_ATTR,
  SLOT_MARK,
  SLOT_RECORD_KEY,
  SLOT_WHITESPACE,
  captureSlotted,
  distributeSlots,
} from "@jxsuite/runtime";
import type { JxMutableNode } from "@jxsuite/schema/types";
import {
  createSlotFill,
  preRenderComponentHtml,
  renderStaticNode,
  slotHelperSource,
} from "../src/shared";
import type { StaticChild } from "../src/shared";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** One row: a definition's template, an instance's children, and where every tier must put them. */
export interface SlotCase {
  name: string;
  template: JxMutableNode[];
  children: StaticChild[];
  expected: string;
}

function slot(name: string | null, fallback: (string | JxMutableNode)[] = []): JxMutableNode {
  const node: JxMutableNode = { children: fallback, tagName: "slot" };
  if (name !== null) {
    node.attributes = { name };
  }
  return node;
}

export const SLOT_CASES: readonly SlotCase[] = [
  {
    children: [
      { attributes: { slot: "header" }, tagName: "h1", textContent: "T" },
      { tagName: "p", textContent: "Body" },
    ],
    expected: '<header><h1 slot="header">T</h1></header><main><p>Body</p></main>',
    name: "the §8.5 card",
    template: [
      { children: [slot("header")], tagName: "header" },
      { children: [slot(null)], tagName: "main" },
    ],
  },
  {
    children: ["text", { tagName: "b", textContent: "B" }],
    expected: "<div>text<b>B</b></div>",
    name: "unnamed only",
    template: [{ children: [slot(null)], tagName: "div" }],
  },
  {
    children: [{ tagName: "p", textContent: "P" }],
    expected: "<i>fa</i><b><p>P</p></b>",
    name: "an unmatched name shows its fallback",
    template: [
      { children: [slot("a", ["fa"])], tagName: "i" },
      { children: [slot(null, ["fb"])], tagName: "b" },
    ],
  },
  {
    children: [],
    expected: "<i>f</i>",
    name: "an empty instance shows every fallback",
    template: [{ children: [slot(null, ["f"])], tagName: "i" }],
  },
  {
    children: [{ attributes: { slot: "a" }, tagName: "u", textContent: "A" }],
    expected: '<i><u slot="a">A</u></i><b>two</b>',
    name: "the first slot of a name takes the group",
    template: [
      { children: [slot("a", ["one"])], tagName: "i" },
      { children: [slot("a", ["two"])], tagName: "b" },
    ],
  },
  {
    children: [{ attributes: { slot: "" }, tagName: "u", textContent: "A" }],
    expected: '<b><u slot="">A</u></b>',
    name: 'slot="" and name="" are the unnamed slot',
    template: [{ children: [slot("")], tagName: "b" }],
  },
  {
    children: [
      { attributes: { slot: "nowhere" }, tagName: "u", textContent: "A" },
      { tagName: "p", textContent: "p" },
    ],
    expected: "<b><p>p</p></b>",
    name: "a group no slot takes is not rendered",
    template: [{ children: [slot(null)], tagName: "b" }],
  },
  {
    children: ["  ", { attributes: { slot: "a" }, tagName: "u", textContent: "A" }, "\n  "],
    expected: '<i><u slot="a">A</u></i><b>fb</b>',
    name: "whitespace between named children is not content",
    template: [
      { children: [slot("a")], tagName: "i" },
      { children: [slot(null, ["fb"])], tagName: "b" },
    ],
  },
  {
    children: [" "],
    expected: "<b> </b>",
    name: "a non-breaking space is content",
    template: [{ children: [slot(null, ["fb"])], tagName: "b" }],
  },
  {
    children: [
      { tagName: "p", textContent: "p" },
      { attributes: { slot: "x" }, tagName: "u", textContent: "X" },
    ],
    expected: "<b><p>p</p></b><s>late</s>",
    name: "a slot in a discarded fallback still takes its name",
    template: [
      {
        children: [slot(null, [{ children: [slot("x", ["inner"])], tagName: "i" }])],
        tagName: "b",
      },
      { children: [slot("x", ["late"])], tagName: "s" },
    ],
  },
];

/** The two functions a compiled module inlines, loaded from the source the compiler emits. */
interface SlotHelpers {
  __jxCaptureSlotted: (host: Element) => ChildNode[];
  __jxDistributeSlots: (host: Element, captured: readonly ChildNode[]) => void;
}

const dir = mkdtempSync(join(tmpdir(), "jx-slot-helper-"));
const helperFile = join(dir, "helpers.js");
writeFileSync(
  helperFile,
  `${slotHelperSource()}\nexport { __jxCaptureSlotted, __jxDistributeSlots };\n`,
  "utf8",
);
/* SAFETY: the module written above exports exactly these two functions, from the source the
   compiler emits into every light-DOM component module that draws a slot. */
const helpers = (await import(helperFile)) as SlotHelpers;

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Compare as the file header says: newlines out, one spelling of the non-breaking space. */
const normalize = (html: string) => html.replaceAll("\n", "").replaceAll("&nbsp;", " ");

/** A host rendered from the template with literal slots, and the children parsed to nodes. */
function domCase(row: SlotCase) {
  const host = document.createElement("x-case");
  host.innerHTML = renderStaticNode(row.template, null);
  const source = document.createElement("div");
  source.innerHTML = renderStaticNode(row.children, null);
  return { captured: [...source.childNodes], host };
}

describe("one slot rule in three tiers", () => {
  for (const row of SLOT_CASES) {
    test(`interpreter: ${row.name}`, () => {
      const { captured, host } = domCase(row);
      distributeSlots(host, captured);
      expect(normalize(host.innerHTML)).toBe(row.expected);
    });

    test(`module: ${row.name}`, () => {
      const { captured, host } = domCase(row);
      helpers.__jxDistributeSlots(host, captured);
      expect(normalize(host.innerHTML)).toBe(row.expected);
    });

    test(`prerender: ${row.name}`, () => {
      const fill = createSlotFill(row.children, {}, (c) => renderStaticNode(c, {}));
      const html = preRenderComponentHtml(
        { children: row.template, tagName: "x-case" },
        null,
        fill,
      );
      expect(normalize(html)).toBe(row.expected);
    });
  }

  for (const [tier, run] of [
    ["interpreter", distributeSlots],
    ["module", (h: Element, c: readonly ChildNode[]) => helpers.__jxDistributeSlots(h, c)],
  ] as const) {
    test(`${tier}: a comment-only group and an empty text node still show the fallback`, () => {
      const host = document.createElement("x-case");
      host.innerHTML = "<b><slot>fb</slot></b>";
      run(host, [document.createComment("anchor"), document.createTextNode("")]);
      expect(host.innerHTML).toBe("<b><!--anchor-->fb</b>");
    });
  }
});

describe("recovering a prerendered instance's children", () => {
  const FIXTURES = [
    "<header><!--jx-slot 1 head--><h1>T</h1><!--/jx-slot 1--></header>",
    "<main><!--jx-slot 1 --><p>a</p>\n<p>b</p><!--/jx-slot 1--></main><footer>own</footer>",
    '<x-in data-jx-slots="2"><!--jx-slot 2 --><!--jx-slot 1 a%20b--><em>fw</em><!--/jx-slot 1--><!--/jx-slot 2--></x-in>',
  ];

  test("the inlined capture agrees with captureSlotted", () => {
    const record = () => {
      const map: unknown = Object.getOwnPropertyDescriptor(
        globalThis,
        Symbol.for(SLOT_RECORD_KEY),
      )?.value;
      if (!(map instanceof WeakMap)) {
        throw new TypeError("the runtime installs the slot record when it loads");
      }
      return map;
    };
    for (const markup of FIXTURES) {
      const answers = [captureSlotted, helpers.__jxCaptureSlotted].map((capture) => {
        const host = document.createElement("x-card");
        host.setAttribute(SLOT_ATTR, "1");
        host.innerHTML = markup;
        const captured = capture(host);
        const out = captured.map((n) => `${String(record().get(n))}:${n.textContent ?? ""}`);
        for (const n of captured) {
          record().delete(n);
        }
        return { attr: host.hasAttribute(SLOT_ATTR), out };
      });
      expect(answers[1]).toEqual(answers[0]!);
      expect(answers[0]!.attr).toBe(false);
    }
  });

  test("a record written by the runtime is read by the helper", () => {
    const host = document.createElement("x-card");
    host.setAttribute(SLOT_ATTR, "9");
    host.innerHTML = "<!--jx-slot 9 head--><h1>T</h1><!--/jx-slot 9-->";
    const captured = captureSlotted(host);
    const target = document.createElement("x-card");
    target.innerHTML = '<header><slot name="head"></slot></header><main><slot></slot></main>';
    helpers.__jxDistributeSlots(target, captured);
    expect(target.innerHTML).toBe("<header><h1>T</h1></header><main></main>");
  });

  test("the helper serializes the runtime's pattern, mark, attribute and record key", () => {
    const source = slotHelperSource();
    expect(source).toContain(JSON.stringify(SLOT_WHITESPACE.source));
    expect(source).toContain(JSON.stringify(SLOT_MARK));
    expect(source).toContain(JSON.stringify(SLOT_ATTR));
    expect(source).toContain(JSON.stringify(SLOT_RECORD_KEY));
  });
});
