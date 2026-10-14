import { describe, test, expect } from "bun:test";
import { convertToJx } from "../src/to-jx.ts";
import { isString } from "@jxsuite/schema/guards";
import type { JxElement } from "@jxsuite/schema/types";

/** A converted node's child list; every node `convertToJx` builds keeps them in a plain array. */
function childNodes(node: JxElement | string | undefined): (JxElement | string)[] {
  if (node === undefined || isString(node) || !Array.isArray(node.children)) {
    throw new Error("expected a converted element with a children array");
  }
  return node.children;
}

describe("convertToJx", () => {
  test("converts basic HTML to a valid Jx document", () => {
    const html = `
      <div class="container">
        <h1>Hello World</h1>
        <p>Some text</p>
      </div>
    `;
    const result = convertToJx(html);

    expect(result.document.tagName).toBe("div");
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.collectedStyles).toEqual([]);

    // The wrapper div should contain the converted tree
    expect(childNodes(result.document).length).toBeGreaterThan(0);
  });

  test("strips script and noscript tags", () => {
    const html = `
      <div>
        <script>alert('xss')</script>
        <noscript>Enable JS</noscript>
        <p>Keep me</p>
      </div>
    `;
    const result = convertToJx(html);
    const json = JSON.stringify(result.document);
    expect(json).not.toContain("script");
    expect(json).not.toContain("alert");
    expect(json).toContain("Keep me");
  });

  test("strips iframe, object, embed tags", () => {
    const html = `
      <div>
        <iframe src="https://evil.com"></iframe>
        <object data="flash.swf"></object>
        <embed src="plugin.swf">
        <p>Safe content</p>
      </div>
    `;
    const result = convertToJx(html);
    const json = JSON.stringify(result.document);
    expect(json).not.toContain("iframe");
    expect(json).not.toContain("object");
    expect(json).not.toContain("embed");
    expect(json).toContain("Safe content");
  });

  test("collects inline style content", () => {
    const html = `
      <style>.foo { color: red; }</style>
      <div><p>Hello</p></div>
    `;
    const result = convertToJx(html);
    expect(result.collectedStyles.length).toBe(1);
    expect(result.collectedStyles[0]).toContain(".foo");
    // Style element itself should be stripped from the tree
    const json = JSON.stringify(result.document);
    expect(json).not.toContain('"style"');
  });

  test("strips link and meta tags", () => {
    const html = `
      <link rel="stylesheet" href="styles.css">
      <meta name="viewport" content="width=device-width">
      <div>Content</div>
    `;
    const result = convertToJx(html);
    const json = JSON.stringify(result.document);
    expect(json).not.toContain("stylesheet");
    expect(json).not.toContain("viewport");
    expect(json).toContain("Content");
  });

  test("handles inline styles on elements", () => {
    const html = `<div style="color: red; font-size: 16px"><p>Styled</p></div>`;
    const result = convertToJx(html);
    const [outerDiv] = childNodes(result.document);
    expect(outerDiv).toMatchObject({ style: { color: "red", "font-size": "16px" } });
  });

  test("reports node count accurately", () => {
    const html = `
      <header>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
      </header>
      <main><p>Body</p></main>
      <footer><p>Footer</p></footer>
    `;
    const result = convertToJx(html);
    // Wrapper(1) + header(1) + nav(1) + a(2) + main(1) + p(1) + footer(1) + p(1) = 9
    expect(result.nodeCount).toBe(9);
  });

  test("warns-worthy large page produces valid output", () => {
    // Generate a page with many nodes
    const items = Array.from({ length: 200 }, (_, i) => `<li>Item ${i}</li>`).join("");
    const html = `<ul>${items}</ul>`;
    const result = convertToJx(html);
    expect(result.nodeCount).toBe(202); // Wrapper + ul + 200 li
    expect(result.document.tagName).toBe("div");
  });

  test("empty body produces minimal valid document", () => {
    const result = convertToJx("");
    expect(result.document.tagName).toBe("div");
    expect(result.nodeCount).toBe(1);
    expect(result.collectedStyles).toEqual([]);
  });

  test("keeps text nodes alongside element children", () => {
    const result = convertToJx("<p>Hello <b>bold</b></p>");
    const [p] = childNodes(result.document);
    const [text, bold] = childNodes(p);
    expect(text).toBe("Hello ");
    expect(bold).toMatchObject({ tagName: "b" });
    // Wrapper(1) + p(1) + b(1) — text nodes are not counted
    expect(result.nodeCount).toBe(3);
  });

  test("preserves top-level bare text", () => {
    const result = convertToJx("plain text <span>x</span>");
    const [text, span] = childNodes(result.document);
    expect(text).toBe("plain text ");
    expect(span).toMatchObject({ tagName: "span" });
    expect(result.nodeCount).toBe(2);
  });
});
