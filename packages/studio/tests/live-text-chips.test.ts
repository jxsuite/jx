/**
 * A commit can never write a resolved value (studio.md §4.5): the first two of the three guards,
 * and the round trip that tests them together. The third guard, the refusal, is in
 * `inline-edit-apply.test.ts`.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { renderNode } from "@jxsuite/runtime";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import { makeStamper } from "../src/canvas/iframe-render";
import { normalizeInlineContent } from "../src/editor/inline-format";
import { serializeContent } from "../src/editor/inline-edit";
import { prepareForEditMode } from "../src/utils/edit-display";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxContentResult } from "../src/editor/inline-edit";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** Prepare `node` and render it as the canvas frame does, stamper included. */
function draw(node: JxDocumentValue, scope: JxScope): HTMLElement {
  const prepared = prepareForEditMode(node);
  if (!isNodeObject(prepared)) {
    throw new TypeError("expected a node");
  }
  const el = renderNode(prepared, scope, {
    _path: [],
    onNodeCreated: makeStamper({
      canvasMode: "edit",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    }),
  });
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return el;
}

/** What an edit session would commit for the block `el`: normalized, then serialized. */
function serialize(el: HTMLElement): JxContentResult {
  normalizeInlineContent(el);
  return serializeContent(el);
}

/** Every value the scope below can resolve to is spelled with this, and no source text is. */
const MARK = "░";

/** A scope whose every value differs from any expression that reads it. */
const scope = (): JxScope => ({
  fmt: (value: number, options: { style: string }) => `${MARK}${value}/${options.style}${MARK}`,
  html: `<i>${MARK}markup${MARK}</i>`,
  list: [`${MARK}one`, `${MARK}two`],
  n: 3,
  name: `${MARK}Ada${MARK}`,
  nodes: [
    { tagName: "li", textContent: `${MARK}first` },
    { tagName: "li", textContent: `${MARK}second` },
  ],
  obj: { "a}b": `${MARK}keyed` },
  rows: [{ author: `${MARK}Grace`, title: `${MARK}Row title` }, { title: `${MARK}Other` }],
  user: { first: `${MARK}Grace` },
});

describe("guard 1: resolved values exist only inside elements closed to the caret", () => {
  const PAGE: JxMutableNode = {
    children: [
      { tagName: "h1", textContent: "Title: ${state.name}" },
      {
        children: ["By ${state.user.first} ", { tagName: "em", textContent: "${state.name}" }],
        tagName: "p",
      },
      { children: ["${state.name}", { tagName: "br" }, "plain"], tagName: "p" },
      { children: ["${state.nodes}"], tagName: "ul" },
      { children: "${state.nodes}", tagName: "ol" },
      { innerHTML: "${state.html}", tagName: "div" },
      { tagName: "h2", textContent: { $ref: "#/state/name" } },
      {
        children: [{ tagName: "b", textContent: "x" }],
        tagName: "p",
        textContent: "${state.name}",
      },
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: {
          children: [
            { tagName: "h3", textContent: "${item.title}" },
            { tagName: "span", textContent: { $ref: "$map/item/author" } },
            { children: ["by ${$map.item.author}"], tagName: "p" },
          ],
          tagName: "article",
        },
      },
    ],
    tagName: "main",
  };

  /** Whether `node` sits inside an element the caret cannot enter. */
  const closed = (node: Node): boolean =>
    node.parentElement?.closest('[contenteditable="false"]') != null;

  test("every text node that shows a value is closed to the caret", () => {
    const root = draw(PAGE, scope());
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const values: string[] = [];
    const open: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue ?? "";
      if (text.includes(MARK)) {
        values.push(text);
        if (!closed(walker.currentNode)) {
          open.push(text);
        }
      }
    }
    // Every form drew its value, and none of them where the author can type.
    expect(values.length).toBeGreaterThanOrEqual(12);
    expect(open).toEqual([]);
    expect(root.textContent).not.toContain("${");
  });

  test("the literal text around a chip stays open, so it can be edited", () => {
    const root = draw(PAGE, scope());
    const title = root.querySelector("h1")?.firstChild ?? null;
    expect(title?.nodeValue).toBe("Title: ");
    expect(title && closed(title)).toBe(false);
  });
});

describe("guard 2: a chip serializes to the expression it carries, never its text", () => {
  test("a block's commit is its template, whatever its chips show", () => {
    const h1 = draw({ tagName: "h1", textContent: "Title: ${state.name}!" }, scope());
    expect(h1.textContent).toBe(`Title: ${MARK}Ada${MARK}!`);
    expect(serialize(h1)).toEqual({ textContent: "Title: ${state.name}!" });
  });

  test("a chip whose content was tampered with still writes its expression", () => {
    const p = draw({ tagName: "p", textContent: "${state.name}" }, scope());
    const chip = p.querySelector("data");
    if (!chip) {
      throw new TypeError("expected a chip");
    }
    chip.textContent = "anything at all";
    chip.append(document.createElement("b"));
    expect(serialize(p)).toEqual({ textContent: "${state.name}" });
  });

  test("a chip inside inline markup, and inside <code>, is written as its expression", () => {
    const p = draw(
      {
        children: [
          "See ",
          { tagName: "strong", textContent: "${state.name}" },
          { tagName: "code", textContent: "id=${state.n}" },
        ],
        tagName: "p",
      },
      scope(),
    );
    expect(serialize(p)).toEqual({
      children: [
        "See ",
        { tagName: "strong", textContent: "${state.name}" },
        { tagName: "code", textContent: "id=${state.n}" },
      ],
    });
  });

  test("a spliced list is written as the one string it came from", () => {
    const ul = draw(
      { children: ["${state.nodes}", { tagName: "li", textContent: "own" }], tagName: "ul" },
      scope(),
    );
    expect(ul.querySelectorAll("li")).toHaveLength(3);
    expect(serialize(ul).children?.[0]).toBe("${state.nodes}");
  });

  test("the text-run element is not written: its runs join back into one string", () => {
    const p = draw(
      { children: ["Hello ${state.name}, ${state.n}", { tagName: "br" }], tagName: "p" },
      scope(),
    );
    expect(p.firstElementChild?.matches("data[data-jx-text]")).toBe(true);
    expect(serialize(p).children?.[0]).toBe("Hello ${state.name}, ${state.n}");
  });

  test("typing around a chip keeps the chip", () => {
    const p = draw({ tagName: "p", textContent: "By ${state.user.first}" }, scope());
    const lead = p.firstChild;
    if (!lead) {
      throw new TypeError("expected a text node");
    }
    lead.nodeValue = "Written by ";
    p.append(document.createTextNode(", today"));
    expect(serialize(p)).toEqual({ textContent: "Written by ${state.user.first}, today" });
  });
});

describe("the round trip: serialize(render(prepare(t))) is t", () => {
  /** Expressions that hold quotes, braces in strings, nested templates, lambdas and comments. */
  const EXPRESSIONS = [
    "state.name",
    "state.user.first ?? ''",
    "state.n + 1",
    'state.fmt(state.n, { style: "}" })',
    "`${state.name}!`",
    'state.name ? "}" : "{"',
    "state.list.map((x) => `<${x}>`).join(', ')",
    "'${not a tag}'",
    "state.missing?.deep || 'none'",
    "/* } */ state.n",
    'state.obj["a}b"]',
    "(() => { return state.name; })()",
    "state.gone.deep",
    " state.name ",
    "item?.title ?? index",
  ];
  /** Literal runs: braces, quotes, a lone dollar, spaces, markup-looking text, an escape. */
  const LITERALS = [
    "Hello ",
    " and ",
    "{",
    "}",
    "{}",
    " $ ",
    '"q" ',
    "'",
    "  ",
    "a}b{c ",
    "日本語 ",
    ".",
    "$",
    "<b>not markup</b>",
    String.raw`line\nbreak`,
  ];

  /** A small deterministic generator, so a failure names a template that fails again. */
  function generator(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  }

  /** One template: `count` expressions with literal runs between, before and after them or not. */
  function template(next: () => number, count: number): string {
    const pick = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)]!;
    let out = next() < 0.5 ? pick(LITERALS) : "";
    for (let i = 0; i < count; i++) {
      out += `\${${pick(EXPRESSIONS)}}`;
      // Adjacent tags half the time, a run between them otherwise.
      if (i < count - 1 && next() < 0.5) {
        out += pick(LITERALS);
      }
    }
    return out + (next() < 0.5 ? pick(LITERALS) : "");
  }

  const TEMPLATES: string[] = [
    // The shapes named in the guarantee, written out.
    "${state.name}",
    "${state.name}${state.n}",
    "${state.name} at the start",
    "at the end ${state.name}",
    "${state.name}${state.n}${state.user.first}",
    "quoted \"${state.name}\" and '${state.n}'",
    'braces {${state.name}} and ${ state.fmt(state.n, { style: "{}" }) }',
    "nested ${`a${`b${state.n}`}`} template",
    '${state.list.map((x) => { return `[${x}]`; }).join("}{")}',
    "cost ${ 5",
    "escaped \\${state.name} and ${state.name}",
  ];
  const next = generator(20_261_111);
  for (let i = 0; i < 400; i++) {
    const count = 1 + Math.floor(next() * 4);
    TEMPLATES.push(template(next, count));
  }

  test("a templated textContent comes back byte for byte", () => {
    const failures: string[] = [];
    for (const source of TEMPLATES) {
      const got = serialize(draw({ tagName: "p", textContent: source }, scope()));
      if (got.textContent !== source || got.children !== undefined) {
        failures.push(`${JSON.stringify(source)} -> ${JSON.stringify(got)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("what was drawn is the value, not the source", () => {
    const drawn = draw({ tagName: "p", textContent: "${state.name}${state.n}" }, scope());
    expect(drawn.textContent).toBe(`${MARK}Ada${MARK}3`);
  });

  test("templated string members of children come back as the same strings", () => {
    const failures: string[] = [];
    for (let i = 0; i + 1 < TEMPLATES.length; i += 2) {
      const first = TEMPLATES[i]!;
      const second = TEMPLATES[i + 1]!;
      const got = serialize(
        draw({ children: [first, { tagName: "br" }, second], tagName: "p" }, scope()),
      );
      const strings = (got.children ?? []).filter((child) => isString(child));
      if (strings.length !== 2 || strings[0] !== first || strings[1] !== second) {
        failures.push(`${JSON.stringify([first, second])} -> ${JSON.stringify(got)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("a template in a repeater's row comes back too, drawn from the sample row", () => {
    const source = "${item.title} by ${$map.item.author ?? 'nobody'} (#${index + 1})";
    const root = draw(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: source },
          },
        ],
        tagName: "ul",
      },
      scope(),
    );
    const row = root.querySelector("li");
    if (!row) {
      throw new TypeError("expected a row");
    }
    expect(row.textContent).toBe(`${MARK}Row title by ${MARK}Grace (#1)`);
    expect(serialize(row)).toEqual({ textContent: source });
  });
});
