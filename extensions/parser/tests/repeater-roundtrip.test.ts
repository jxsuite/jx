import { describe, expect, test } from "bun:test";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import { serializeJxMarkdown } from "../src/serialize.ts";
import { transpileJxMarkdown } from "../src/transpile.ts";

/** Serialize in roundtrip mode and parse the result back. */
function write(doc: JxDocument): string {
  return serializeJxMarkdown(doc, { frontmatter: false });
}

function roundtrip(doc: JxDocument): string {
  const md = write(doc);
  expect(transpileJxMarkdown(md)).toEqual(doc);
  return md;
}

const rowRepeater = {
  $prototype: "Array",
  items: { $ref: "#/state/rows" },
  map: { tagName: "li", textContent: "${$map/item/title}" },
};

describe("repeater map template round trip", () => {
  test("§6.5's worked example parses to the JSON the section shows", () => {
    const md = [
      "# Recent posts",
      "",
      ':::Array{items.ref="#/state/posts"}',
      "::li[${$map/item/title}]",
      ":::",
      "",
    ].join("\n");
    expect(transpileJxMarkdown(md).children).toEqual([
      { tagName: "h1", textContent: "Recent posts" },
      {
        $prototype: "Array",
        items: { $ref: "#/state/posts" },
        map: { tagName: "li", textContent: "${$map/item/title}" },
      },
    ]);
  });

  test("an li template is a labelled leaf directive", () => {
    const md = roundtrip({ children: [rowRepeater] });
    expect(md).toContain("::li[${$map/item/title}]");
  });

  test("spec.md §10.1's list keeps its repeater inside the list", () => {
    const md = roundtrip({
      children: [
        {
          children: [
            { tagName: "li", textContent: "Header" },
            {
              $prototype: "Array",
              items: { $ref: "#/state/todoList" },
              map: { tagName: "li", textContent: { $ref: "$map/item" } },
            },
          ],
          tagName: "ul",
        },
      ],
    });
    expect(md).toContain('textContent.ref="$map/item"');
    expect(md).not.toContain("[object Object]");
    expect(md).toContain("::::ul");
  });

  test("a converted markdown list item keeps its paragraph", () => {
    roundtrip({
      children: [
        {
          children: [
            { children: [{ tagName: "p", textContent: "a" }], tagName: "li" },
            {
              $prototype: "Array",
              items: { $ref: "#/state/x" },
              map: { children: [{ tagName: "p", textContent: "b" }], tagName: "li" },
            },
          ],
          tagName: "ul",
        },
      ],
    });
  });

  test("an ordered list written as directives keeps its start", () => {
    roundtrip({
      children: [
        {
          attributes: { start: "3" },
          children: [{ tagName: "li", textContent: "a" }, rowRepeater],
          tagName: "ol",
        },
      ],
    });
  });

  test("an li template keeps inline elements", () => {
    roundtrip({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/x" },
          map: {
            children: [
              { attributes: { href: "/x" }, tagName: "a", textContent: "t" },
              " by ",
              { tagName: "em", textContent: "me" },
            ],
            tagName: "li",
          },
        },
      ],
    });
  });

  test("an li holding only components is a container", () => {
    const md = roundtrip({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/x" },
          map: {
            children: [{ tagName: "span" }, { onclick: { $ref: "#/state/go" }, tagName: "button" }],
            tagName: "li",
          },
        },
      ],
    });
    expect(md).toContain(":::li");
  });

  test("label text that looks like markdown stays text", () => {
    roundtrip({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/x" },
          map: { tagName: "li", textContent: "a *b* <c> :d[e] `f` _g_ ~~h~~ &amp;" },
        },
      ],
    });
  });

  test("label text keeps its edge whitespace", () => {
    roundtrip({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/x" },
          map: { tagName: "li", textContent: " lead " },
        },
      ],
    });
  });

  const rows = (map: JxElement) => ({ $prototype: "Array", items: { $ref: "#/state/r" }, map });
  const cell = (text: string, tagName = "td") => ({ tagName, textContent: text });

  test("a row template keeps the repeater inside the table body", () => {
    roundtrip({
      children: [
        {
          children: [
            { children: [{ children: [cell("H", "th")], tagName: "tr" }], tagName: "thead" },
            {
              children: [rows({ children: [cell("${$map/item}")], tagName: "tr" })],
              tagName: "tbody",
            },
          ],
          tagName: "table",
        },
      ],
    });
  });

  test("a cell template sits among a row's cells", () => {
    roundtrip({
      children: [
        {
          children: [
            {
              children: [
                {
                  children: [cell("a"), rows(cell("${$map/item}"))],
                  tagName: "tr",
                },
              ],
              tagName: "tbody",
            },
          ],
          tagName: "table",
        },
      ],
    });
  });

  test("a root row template writes its cells as directives", () => {
    roundtrip({ children: [rows({ children: [cell("a"), cell("b")], tagName: "tr" })] });
    roundtrip({ children: [rows(cell("a"))] });
  });

  test("an li with block content is a container directive", () => {
    const md = roundtrip({
      children: [
        rows({
          children: [
            { tagName: "h3", textContent: "t" },
            { tagName: "p", textContent: "b" },
          ],
          tagName: "li",
        }),
      ],
    });
    expect(md).toContain(":::li");
  });

  test("an empty li template is a bare leaf", () => {
    const md = roundtrip({ children: [rows({ tagName: "li" })] });
    expect(md).toContain("::li\n");
  });

  test("a repeater inside a template's list round-trips", () => {
    roundtrip({
      children: [
        rows({
          children: [{ children: [rows({ tagName: "li", textContent: "x" })], tagName: "ul" }],
          tagName: "section",
        }),
      ],
    });
  });

  test("a classed list item keeps its list", () => {
    roundtrip({
      children: [
        {
          children: [
            { className: "x", tagName: "li", textContent: "a" },
            { tagName: "li", textContent: "b" },
          ],
          tagName: "ul",
        },
      ],
    });
  });

  test("a classed list item at the root is a labelled leaf", () => {
    const md = roundtrip({ children: [{ className: "x", tagName: "li", textContent: "a" }] });
    expect(md).toContain('::li[a]{className="x"}');
  });

  test("a styled list and a styled table keep their items and rows", () => {
    roundtrip({
      children: [
        {
          children: [{ children: [{ tagName: "p", textContent: "a" }], tagName: "li" }],
          className: "x",
          tagName: "ul",
        },
        {
          children: [
            { children: [{ children: [cell("H", "th")], tagName: "tr" }], tagName: "thead" },
            { children: [{ children: [cell("v")], tagName: "tr" }], tagName: "tbody" },
          ],
          style: { color: "red" },
          tagName: "table",
        },
      ],
    });
  });

  test("a list or table with no repeater keeps its markdown form", () => {
    const md = write({
      children: [
        { children: [{ tagName: "li", textContent: "a" }], tagName: "ul" },
        {
          children: [
            { children: [{ children: [cell("H", "th")], tagName: "tr" }], tagName: "thead" },
            { children: [{ children: [cell("v")], tagName: "tr" }], tagName: "tbody" },
          ],
          tagName: "table",
        },
      ],
    });
    expect(md).toContain("- a");
    expect(md).toContain("| H |");
  });

  test("a legacy children-object list serializes to the §8 attributes instead of throwing", () => {
    const md = write({
      children: [
        {
          children: { $prototype: "Array", items: { $ref: "#/state/x" }, map: { tagName: "li" } },
          tagName: "ul",
        },
      ],
    });
    expect(md).toContain("::ul");
    expect(md).toContain("children.");
  });

  test("a bound textContent is written as an attribute, on a block and inline", () => {
    const bound = { $ref: "#/state/t" };
    const a = roundtrip({ children: [{ tagName: "p", textContent: bound }] });
    expect(a).not.toContain("[object Object]");
    const b = roundtrip({
      children: [
        {
          children: ["see ", { attributes: { href: "/x" }, tagName: "a", textContent: bound }],
          tagName: "p",
        },
      ],
    });
    expect(b).not.toContain("[object Object]");
  });

  test("p, section and custom-element templates, and filter, sort and key, still round-trip", () => {
    for (const map of [
      { tagName: "p", textContent: "x" },
      { children: [{ tagName: "h3", textContent: "x" }], tagName: "div" },
      { tagName: "todo-item" },
    ]) {
      roundtrip({
        children: [
          {
            $prototype: "Array",
            filter: { $ref: "#/state/f" },
            items: { $ref: "#/state/x" },
            key: "id",
            map,
            sort: { $ref: "#/state/s" },
          },
        ],
      });
    }
  });
});
