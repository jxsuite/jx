/**
 * Inert tests: template-looking text in Markdown content stays text (src/inert.ts).
 *
 * The compiler reads any string containing `${` as an expression, so a code sample that shows one
 * used to lose it. These pin the escape the loader writes and where it does and does not apply.
 */

import { describe, expect, it } from "bun:test";
import type { JxElement } from "@jxsuite/schema/types";
import {
  escapeTemplateText,
  makeTemplatesInert,
  neutralizeTemplateAttribute,
} from "../src/inert.ts";
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

describe("attributes that carry prose", () => {
  it("alt, title and data-title keep a ${ from being read as a template", () => {
    const nodes: (JxElement | string)[] = [
      {
        attributes: { alt: "set ${HOME}", src: "a.png", title: "tip ${x}" },
        tagName: "img",
      },
      { attributes: { "data-title": "Use ${HOME}" }, tagName: "doc-note" },
    ];
    makeTemplatesInert(nodes);
    const [img, note] = nodes as JxElement[];
    expect(img!.attributes?.alt).toBe("set $\u200B{HOME}");
    expect(img!.attributes?.title).toBe("tip $\u200B{x}");
    expect(note!.attributes?.["data-title"]).toBe("Use $\u200B{HOME}");
    expect(JSON.stringify(nodes)).not.toContain("${");
  });

  it("neutralizeTemplateAttribute leaves text with no ${ exactly alone", () => {
    expect(neutralizeTemplateAttribute("a $5 {b}")).toBe("a $5 {b}");
    expect(neutralizeTemplateAttribute("${a}${b}")).toBe("$\u200B{a}$\u200B{b}");
  });

  it("href and src are the page author's to template, and are not touched", () => {
    const nodes: (JxElement | string)[] = [
      { attributes: { href: "${state.base}/x" }, tagName: "a", textContent: "x" },
      { attributes: { src: "${state.cdn}/a.png" }, tagName: "img" },
    ];
    makeTemplatesInert(nodes);
    expect(JSON.stringify(nodes)).toContain("${state.base}/x");
    expect(JSON.stringify(nodes)).toContain("${state.cdn}/a.png");
  });

  it("through processMarkdown: an image description and a callout title", () => {
    const [p, note] = processMarkdown(
      '![diagram of ${HOME}](x.png "t ${y}")\n\n> [!NOTE] Use ${HOME}\n> body\n',
      "/x/a.md",
      { alerts: { NOTE: "doc-note" } },
    ).$children as JxElement[];
    const img = (p!.children as JxElement[])[0]!;
    expect(img.attributes?.alt).toContain("$\u200B{");
    expect(img.attributes?.title).toContain("$\u200B{");
    expect(note!.attributes?.["data-title"]).toBe("Use $\u200B{HOME}");
  });
});

describe("a raw HTML block", () => {
  it("is a nested list of nodes, and its text is made inert too", () => {
    const out = render('<div class="a">\n<b>${y}</b>\n</div>\n');
    expect(hasTemplate(out)).toBe(false);
    expect(visible(out.flat() as (JxElement | string)[])).toContain("${y}");
  });

  it("makeTemplatesInert descends into a nested array", () => {
    const nodes = [[{ tagName: "b", textContent: "${x}" }, "and ${y}"]] as never;
    makeTemplatesInert(nodes);
    expect(JSON.stringify(nodes)).not.toContain("${");
  });
});
