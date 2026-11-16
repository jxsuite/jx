/**
 * Inline-whitespace.test.ts — the emitters write no whitespace between inline siblings or beside
 * text (compiler.md §8.1, "Whitespace between siblings"), whichever emitter and whichever path the
 * siblings take to the page.
 *
 * The cases are the ones Markdown builds: `[link](/x/).` is an `<a>` then a text node, and ``
 * `code`, `` a `<code>` then a text node.
 */

import { describe, expect, test } from "bun:test";
import type { JxDocument, JxElement, JxMutableNode } from "@jxsuite/schema/types";
import { compileClient } from "../src/targets/compile-client.ts";
import { emitElementModule } from "../src/targets/compile-element.ts";
import { compileStaticPage } from "../src/targets/compile-static.ts";
import { createSlotFill, preRenderComponentHtml, renderStaticNode } from "../src/shared.ts";
import type { ComponentPrerenderContext } from "../src/shared.ts";

/** A paragraph the way Markdown builds one: inline directives with the text around them. */
const inlineRun = [
  "See ",
  { attributes: { href: "/x/" }, tagName: "a", textContent: "the link" },
  ".",
  { tagName: "code", textContent: "x" },
  ",",
  { tagName: "strong", textContent: "y" },
  " and ",
  { tagName: "em", textContent: "z" },
  { tagName: "span", children: [{ tagName: "a", textContent: "nested" }, "!"] },
];

const paragraph: JxMutableNode = { children: inlineRun, tagName: "p" };

const flush =
  'See <a href="/x/">the link</a>.<code>x</code>,<strong>y</strong> and <em>z</em>' +
  "<span><a>nested</a>!</span>";

function squash(html: string): string {
  return html.replaceAll(/\s*\n\s*/g, "");
}

describe("the static target", () => {
  test("writes an inline run flush, inside a block that is still indented", () => {
    const doc: JxDocument = {
      children: [
        { tagName: "h1", textContent: "T" },
        paragraph,
        {
          tagName: "ul",
          children: [
            { tagName: "li", textContent: "1" },
            { tagName: "li", textContent: "2" },
          ],
        },
      ],
    };
    const { html } = compileStaticPage(doc, {});
    expect(html).toContain(`<h1>T</h1>\n  <p>${flush}</p>\n  <ul><li>1</li>\n  <li>2</li></ul>`);
  });

  test("an inline parent's content touches both of its tags", () => {
    const doc: JxDocument = {
      children: [
        {
          tagName: "a",
          children: [
            { tagName: "span", textContent: "a" },
            { tagName: "span", textContent: "b" },
          ],
        },
      ],
    };
    expect(compileStaticPage(doc, {}).html).toContain("<a><span>a</span><span>b</span></a>");
  });
});

describe("a component's prerender and its slots", () => {
  const note: JxElement = {
    children: [{ children: [{ tagName: "slot" }], tagName: "div" }, paragraph],
    tagName: "x-note",
  };
  const context: ComponentPrerenderContext = { componentDefs: new Map([["x-note", note]]) };

  test("the definition's own children are written flush", () => {
    expect(preRenderComponentHtml(note, null, null, context)).toBe(
      `<div><slot></slot></div>\n<p>${flush}</p>`,
    );
  });

  test("slotted inline children arrive flush, and so does the fallback beside them", () => {
    const children: JxMutableNode["children"] = [
      { attributes: { href: "/x/" }, tagName: "a", textContent: "link" },
      ".",
      { tagName: "code", textContent: "c" },
      ",",
    ];
    const fill = createSlotFill(children, null, (c) => renderStaticNode(c, null));
    expect(renderStaticNode({ children: [{ tagName: "slot" }], tagName: "p" }, null, fill)).toBe(
      '<p><a href="/x/">link</a>.<code>c</code>,</p>',
    );
  });

  test("an instance is expanded in place without a space around the text beside it", () => {
    const page: JxMutableNode = {
      children: ["before", { tagName: "x-note" }, "after"],
      tagName: "div",
    };
    expect(squash(renderStaticNode(page, null, null, context))).toBe(
      `<div>before<x-note data-jx-static><div></div><p>${flush}</p></x-note>after</div>`,
    );
  });

  test("the rows of a repeater are separated as siblings are", () => {
    const rows = (map: JxMutableNode) =>
      renderStaticNode(
        { children: { $prototype: "Array", items: ["a", "b"], map }, tagName: "div" },
        null,
      );
    expect(rows({ tagName: "li", textContent: "x" })).toBe("<div><li>x</li>\n<li>x</li></div>");
    expect(rows({ tagName: "b", textContent: "x" })).toBe("<div><b>x</b><b>x</b></div>");
  });
});

describe("the client target", () => {
  test("a dynamic page writes the same inline run flush", () => {
    const doc: JxDocument = {
      children: [{ ...paragraph, children: [...inlineRun, "${state.n}"] }],
      state: { n: 1 },
    };
    const { html } = compileClient(doc, {});
    expect(html).toContain(`<p>${flush}<!--jx-text:_t0-->1<!--/jx-text--></p>`);
  });
});

describe("the element target", () => {
  test("a component's template writes the inline run flush and keeps its block lines", () => {
    const content = emitElementModule(
      {
        children: [
          paragraph,
          {
            tagName: "ul",
            children: [
              { tagName: "li", textContent: "1" },
              { tagName: "li", textContent: "2" },
            ],
          },
        ],
        tagName: "x-demo",
      },
      "XDemo",
      [],
    );
    const template = content.slice(content.indexOf("return html`"));
    expect(template).toContain(
      ">the link</a>.<code\n        >x</code>,<strong\n        >y</strong> and <em\n        >z</em>",
    );
    expect(template).toContain(
      "<ul\n      >\n        <li\n        >1</li>\n        <li\n        >2</li>\n      </ul>",
    );
  });
});
