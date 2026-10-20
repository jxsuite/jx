/**
 * Saving a Markdown entry writes back what was read.
 *
 * Studio saves an entry by parsing the file into a Jx tree and serializing the tree. Anything the
 * serializer cannot say in markdown has to come back as the directive it was read from, or a
 * one-word edit rewrites the file: an image's `width` and `height`, a table GFM cannot write, a
 * frontmatter date a YAML 1.1 reader would turn into a `Date`. Each test reads a source, writes it
 * back unedited, and checks the bytes or the tree survive.
 */

import { describe, expect, test } from "bun:test";
import { serializeJxMarkdown } from "../src/serialize";
import { transpileJxMarkdown } from "../src/transpile";
import type { JxElement } from "@jxsuite/schema/types";

/** Read `source` and write it straight back. */
const roundtrip = (source: string): string => serializeJxMarkdown(transpileJxMarkdown(source));

describe("attributes markdown cannot spell", () => {
  test("an image with a width and height stays a directive, at block level and inline", () => {
    const source = [
      ':::figure{className="wp-block-image"}',
      '::img{src="/media/a.jpg" alt="a house" width="1600" height="1067"}',
      ":::",
      "",
      'Before :img{src="/b.png" alt="b" width="10"} after.',
      "",
    ].join("\n");
    expect(roundtrip(source)).toBe(source);
  });

  test("an image with only what markdown says is written as markdown", () => {
    const source = 'Text ![alt](/c.png "Title") more.\n';
    expect(roundtrip(source)).toBe(source);
  });

  test("an image standing alone at block level is its leaf directive, not glued to a paragraph", () => {
    const source = 'First paragraph.\n\n::img{src="/d.png" alt="d"}\n\nLast paragraph.\n';
    expect(roundtrip(source)).toBe(source);
  });

  test("a link with a target and a heading with an id keep them", () => {
    const tree = transpileJxMarkdown("x\n");
    tree.children = [
      { attributes: { id: "intro" }, tagName: "h2", textContent: "Intro" },
      {
        children: [
          { attributes: { href: "/x", target: "_blank" }, tagName: "a", textContent: "go" },
        ],
        tagName: "p",
      },
      {
        attributes: { start: "3" },
        children: [{ tagName: "li", textContent: "c" }],
        tagName: "ol",
      },
    ];
    const out = serializeJxMarkdown(tree);
    expect(out).toBe(':::h2{#intro}\nIntro\n:::\n\n:a[go]{href="/x" target="_blank"}\n\n3. c\n');
  });
});

describe("tables", () => {
  const directiveTable = [
    ':::::::figure{className="wp-block-table"}',
    "::::::table",
    ":::::tbody",
    "::::tr",
    ":::td",
    "House Size",
    ":::",
    "",
    ":::td",
    "Budget",
    ":::",
    "::::",
    "",
    "::::tr",
    ":::td",
    "1 Bedroom",
    ":::",
    "",
    ":::td",
    "$2,100",
    ":::",
    "::::",
    ":::::",
    "::::::",
    ":::::::",
    "",
  ].join("\n");

  test("a table with no header row stays the directive table it was, every row kept", () => {
    expect(roundtrip(directiveTable)).toBe(directiveTable);
  });

  test("a pipe table is written as a pipe table", () => {
    const source = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(roundtrip(source)).toBe(source);
  });

  test("a header-only pipe table round-trips", () => {
    const source = "| a | b |\n| - | - |\n";
    expect(roundtrip(source)).toBe(source);
  });

  test("tables GFM cannot write are directives", () => {
    const cell = (tagName: string, text: string) => ({ tagName, textContent: text });
    const row = (...cells: object[]) => ({ children: cells, tagName: "tr" });
    const tables = [
      // A class on a cell.
      {
        children: [
          { children: [row({ ...cell("th", "a"), attributes: { class: "x" } })], tagName: "thead" },
        ],
        tagName: "table",
      },
      // A body row with fewer cells than the header.
      {
        children: [
          { children: [row(cell("th", "a"), cell("th", "b"))], tagName: "thead" },
          { children: [row(cell("td", "1"))], tagName: "tbody" },
        ],
        tagName: "table",
      },
      // Two header rows.
      {
        children: [{ children: [row(cell("th", "a")), row(cell("th", "b"))], tagName: "thead" }],
        tagName: "table",
      },
      // A block inside a cell, and a cell spanning two lines.
      {
        children: [
          {
            children: [
              row(
                { children: [{ tagName: "p", textContent: "p" }], tagName: "th" },
                cell("th", "two\nlines"),
              ),
            ],
            tagName: "thead",
          },
        ],
        tagName: "table",
      },
      // An empty body, a caption after the body, and text standing in for the table's rows.
      {
        children: [
          { children: [row(cell("th", "a"))], tagName: "thead" },
          { children: [], tagName: "tbody" },
        ],
        tagName: "table",
      },
      {
        children: [
          { children: [row(cell("th", "a"))], tagName: "thead" },
          { children: [row(cell("td", "1"))], tagName: "tbody" },
          { tagName: "caption", textContent: "c" },
        ],
        tagName: "table",
      },
      { tagName: "table", textContent: "t" },
      { children: [{ children: [], tagName: "thead" }], tagName: "table" },
      {
        children: [{ children: [{ tagName: "tr", textContent: "r" }], tagName: "thead" }],
        tagName: "table",
      },
      {
        children: [
          {
            children: [
              row({ children: ["one\ntwo"], tagName: "th" }, { children: ["ok"], tagName: "th" }),
            ],
            tagName: "thead",
          },
        ],
        tagName: "table",
      },
    ];
    for (const table of tables) {
      const tree = transpileJxMarkdown("x\n");
      // SAFETY: each fixture is a Jx element tree written out by hand above.
      tree.children = [table as JxElement];
      const out = serializeJxMarkdown(tree);
      expect(out).toStartWith(":::");
      expect(out).not.toContain("| -");
    }
  });
});

describe("frontmatter", () => {
  test("a quoted timestamp stays quoted, long text stays on its line, and blank lines in a block stay", () => {
    const long = "word ".repeat(40).trim();
    const source = [
      "---",
      'date: "2024-07-26T17:39:36Z"',
      `excerpt: |-`,
      `  ${long}`,
      "",
      "",
      "",
      "  After three blank lines.",
      `title: ${long}`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n");
    const out = roundtrip(source);
    expect(out).toBe(source);
    const reread = transpileJxMarkdown(out);
    expect(reread.date).toBe("2024-07-26T17:39:36Z");
    expect(reread.excerpt).toBe(`${long}\n\n\n\nAfter three blank lines.`);
  });
});
