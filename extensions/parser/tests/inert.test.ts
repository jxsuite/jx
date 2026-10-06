/**
 * Inert tests: template-looking text in Markdown content stays text (src/inert.ts).
 *
 * The compiler reads any string containing `${` as an expression, so a code sample that shows one
 * used to lose it. These pin the escape the loader writes and where it does and does not apply.
 */

import { describe, expect, it } from "bun:test";
import type { JxElement } from "@jxsuite/schema/types";
import { escapeTemplateText, makeTemplatesInert } from "../src/inert.ts";
import { processMarkdown } from "../src/md.ts";

const render = (source: string) =>
  processMarkdown(source, "/x/a.md").$children as (JxElement | string)[];

/** The text of a tree, reading innerHTML back the way a browser would. */
function visible(nodes: (JxElement | string)[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") {
      out += node;
    } else if (typeof node.innerHTML === "string") {
      out += node.innerHTML
        .replaceAll("&#36;", "$")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
    } else {
      out += (node.textContent ?? "") + visible((node.children as (JxElement | string)[]) ?? []);
    }
  }
  return out;
}

/** True when nothing in the tree contains the two characters a template starts with. */
const hasTemplate = (nodes: unknown): boolean => JSON.stringify(nodes).includes("${");

describe("escapeTemplateText", () => {
  it("escapes markup and spells ${ as an entity", () => {
    expect(escapeTemplateText("a < b && c > d ${x} {{ y }}")).toBe(
      "a &lt; b &amp;&amp; c &gt; d &#36;{x} {{ y }}",
    );
  });
});

describe("makeTemplatesInert", () => {
  it("moves textContent holding ${ to escaped innerHTML", () => {
    const nodes: (JxElement | string)[] = [{ tagName: "code", textContent: "a ${b} <c>" }];
    makeTemplatesInert(nodes);
    expect(nodes).toEqual([{ innerHTML: "a &#36;{b} &lt;c&gt;", tagName: "code" }]);
  });

  it("wraps a bare string child holding ${ in a span, and recurses", () => {
    const nodes: (JxElement | string)[] = [
      { children: ["plain ", "and ${x}", { tagName: "em", textContent: "${y}" }], tagName: "p" },
    ];
    makeTemplatesInert(nodes);
    const [p] = nodes as JxElement[];
    expect(p!.children).toEqual([
      "plain ",
      { innerHTML: "and &#36;{x}", tagName: "span" },
      { innerHTML: "&#36;{y}", tagName: "em" },
    ]);
  });

  it("leaves text without ${ alone, and non-array children and odd nodes", () => {
    const nodes = [
      { tagName: "p", textContent: "$ {not} a template" },
      "text",
      null,
      { children: { $prototype: "Array" }, tagName: "div" },
    ] as unknown as (JxElement | string)[];
    const before = JSON.stringify(nodes);
    makeTemplatesInert(nodes);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe("through processMarkdown", () => {
  it("a highlighted fence keeps ${…} and ${{…}} whole", () => {
    const code = [
      "const s = `x ${y} z`;",
      "echo ${HOME} ${{ github.event.pull_request.number }}",
    ].join("\n");
    const out = render(`\`\`\`js\n${code}\n\`\`\`\n`);
    expect(hasTemplate(out)).toBe(false);
    expect(visible(out)).toBe(code);
  });

  it("an unhighlighted fence and inline code keep it too", () => {
    const out = render("```text\nplain ${VAR} {{ jinja }}\n```\n\nUse `${y}` here.\n");
    expect(hasTemplate(out)).toBe(false);
    expect(visible(out)).toContain("plain ${VAR} {{ jinja }}");
    expect(visible(out)).toContain("${y}");
  });

  it("prose, headings, list items and table cells keep it", () => {
    const out = render(
      ["# Title ${a}", "", "Prose ${b}", "", "- item ${c}", "", "| h |", "| - |", "| ${d} |"].join(
        "\n",
      ),
    );
    expect(hasTemplate(out)).toBe(false);
    const text = visible(out);
    for (const part of ["${a}", "${b}", "${c}", "${d}"]) {
      expect(text).toContain(part);
    }
  });

  it("the heading id and the table of contents are built from the original text", () => {
    const result = processMarkdown("## Use ${name} wisely\n", "/x/a.md");
    expect(result.$toc).toEqual([{ depth: 2, id: "use-name-wisely", text: "Use ${name} wisely" }]);
    const [h2] = result.$children as JxElement[];
    expect(h2!.id).toBe("use-name-wisely");
  });

  it("text without ${ is exactly as it was", () => {
    const [p] = render("Plain {{ text }} and $5.\n") as JxElement[];
    expect(p).toEqual({ tagName: "p", textContent: "Plain {{ text }} and $5." });
  });

  it("a link's own text is covered, though its href is not rewritten", () => {
    const out = render("[see ${x}](https://example.com/a)\n");
    expect(hasTemplate(out)).toBe(false);
  });
});
