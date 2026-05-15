import { describe, test, expect } from "bun:test";
import { compileMarkdown } from "../src/targets/compile-markdown.js";

// ─── compileMarkdown ────────────────────────────────────────────────────────

describe("compileMarkdown", () => {
  test("returns empty content for doc with no children", () => {
    expect(compileMarkdown({})).toEqual({ content: "" });
    expect(compileMarkdown({ children: [] })).toEqual({ content: "" });
  });

  test("converts heading elements", () => {
    const doc = {
      children: [
        { tagName: "h1", textContent: "Title" },
        { tagName: "h2", textContent: "Subtitle" },
        { tagName: "h3", textContent: "Section" },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("# Title");
    expect(content).toContain("## Subtitle");
    expect(content).toContain("### Section");
  });

  test("converts paragraph elements", () => {
    const doc = {
      children: [{ tagName: "p", textContent: "Hello world" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Hello world");
  });

  test("converts emphasis and strong", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [
            { tagName: "em", textContent: "italic" },
            { tagName: "strong", textContent: "bold" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("*italic*");
    expect(content).toContain("**bold**");
  });

  test("converts inline code", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [{ tagName: "code", textContent: "const x = 1" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("`const x = 1`");
  });

  test("converts links", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [
            { tagName: "a", attributes: { href: "https://example.com" }, textContent: "Example" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("[Example](https://example.com)");
  });

  test("converts images", () => {
    const doc = {
      children: [{ tagName: "img", attributes: { src: "/photo.jpg", alt: "A photo" } }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("![A photo](/photo.jpg)");
  });

  test("converts blockquotes", () => {
    const doc = {
      children: [
        {
          tagName: "blockquote",
          children: [{ tagName: "p", textContent: "A quote" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("> A quote");
  });

  test("converts unordered lists", () => {
    const doc = {
      children: [
        {
          tagName: "ul",
          children: [
            { tagName: "li", textContent: "Item 1" },
            { tagName: "li", textContent: "Item 2" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("- Item 1");
    expect(content).toContain("- Item 2");
  });

  test("converts ordered lists", () => {
    const doc = {
      children: [
        {
          tagName: "ol",
          children: [
            { tagName: "li", textContent: "First" },
            { tagName: "li", textContent: "Second" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("1. First");
    expect(content).toContain("2. Second");
  });

  test("converts fenced code blocks (pre > code)", () => {
    const doc = {
      children: [
        {
          tagName: "pre",
          children: [
            { tagName: "code", className: "language-js", textContent: "console.log('hi')" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("```js");
    expect(content).toContain("console.log('hi')");
    expect(content).toContain("```");
  });

  test("converts horizontal rules", () => {
    const doc = {
      children: [
        { tagName: "p", textContent: "Before" },
        { tagName: "hr" },
        { tagName: "p", textContent: "After" },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("***");
  });

  test("converts tables", () => {
    const doc = {
      children: [
        {
          tagName: "table",
          children: [
            {
              tagName: "thead",
              children: [
                {
                  tagName: "tr",
                  children: [
                    { tagName: "th", textContent: "Name" },
                    { tagName: "th", textContent: "Age" },
                  ],
                },
              ],
            },
            {
              tagName: "tbody",
              children: [
                {
                  tagName: "tr",
                  children: [
                    { tagName: "td", textContent: "Alice" },
                    { tagName: "td", textContent: "30" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Name");
    expect(content).toContain("Age");
    expect(content).toContain("Alice");
    expect(content).toContain("30");
    expect(content).toContain("|");
  });

  test("unwraps wrapper tags (div, section, span, etc.)", () => {
    const doc = {
      children: [
        {
          tagName: "div",
          children: [{ tagName: "p", textContent: "Inside div" }],
        },
        {
          tagName: "section",
          children: [{ tagName: "p", textContent: "Inside section" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Inside div");
    expect(content).toContain("Inside section");
    expect(content).not.toContain("<div>");
    expect(content).not.toContain("<section>");
  });

  test("wrapper with only textContent wraps in paragraph", () => {
    const doc = {
      children: [{ tagName: "div", textContent: "Just text" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Just text");
  });

  test("converts delete (strikethrough)", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [{ tagName: "del", textContent: "removed" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("~~removed~~");
  });

  test("converts break elements", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [
            { tagName: "span", textContent: "Line 1" },
            { tagName: "br" },
            { tagName: "span", textContent: "Line 2" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Line 1");
    expect(content).toContain("Line 2");
  });

  test("inlines known component definitions", () => {
    const componentDefs = new Map([
      [
        "my-card",
        {
          state: { title: "Default" },
          children: [{ tagName: "h2", textContent: "${state.title}" }],
        },
      ],
    ]);

    const doc = {
      children: [{ tagName: "my-card", $props: { title: "Custom Title" } }],
    };

    const { content } = compileMarkdown(doc, componentDefs);
    expect(content).toContain("Custom Title");
  });

  test("unwraps unknown custom elements (no definition)", () => {
    const doc = {
      children: [
        {
          tagName: "my-widget",
          children: [{ tagName: "p", textContent: "Widget content" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Widget content");
  });

  test("resolves template strings in text content", () => {
    const doc = {
      state: { greeting: "Hello" },
      children: [{ tagName: "p", textContent: "${state.greeting} World" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Hello World");
  });

  test("handles innerHTML content", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p>HTML content</p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("HTML content");
  });

  test("handles innerHTML with headings", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<h2>Section Title</h2>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("## Section Title");
  });

  test("handles innerHTML with links", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: '<p><a href="https://test.com">Test</a></p>' }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("[Test](https://test.com)");
  });

  test("handles innerHTML with emphasis/strong", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p><em>italic</em> and <strong>bold</strong></p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("*italic*");
    expect(content).toContain("**bold**");
  });

  test("handles innerHTML with inline code", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p>Use <code>npm install</code></p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("`npm install`");
  });

  test("handles innerHTML with fenced code block", () => {
    const doc = {
      children: [
        {
          tagName: "div",
          innerHTML: '<pre><code class="language-python">print("hi")</code></pre>',
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("```python");
    expect(content).toContain('print("hi")');
  });

  test("handles innerHTML with blockquote", () => {
    const doc = {
      children: [
        {
          tagName: "blockquote",
          children: [{ tagName: "p", textContent: "Quoted" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("> Quoted");
  });

  test("handles innerHTML with unordered list", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<ul><li>Apple</li><li>Banana</li></ul>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("- Apple");
    expect(content).toContain("- Banana");
  });

  test("handles innerHTML with ordered list", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<ol><li>First</li><li>Second</li></ol>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("1. First");
    expect(content).toContain("2. Second");
  });

  test("handles innerHTML with hr", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p>Above</p><hr /><p>Below</p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Above");
    expect(content).toContain("Below");
  });

  test("handles innerHTML with table", () => {
    const doc = {
      children: [
        {
          tagName: "div",
          innerHTML:
            "<table><tr><th>Col1</th><th>Col2</th></tr><tr><td>a</td><td>b</td></tr></table>",
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Col1");
    expect(content).toContain("|");
  });

  test("handles innerHTML with br", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p>Line 1<br>Line 2</p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Line 1");
    expect(content).toContain("Line 2");
  });

  test("handles innerHTML with img", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: '<p><img src="/pic.jpg" alt="Pic"></p>' }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("![Pic](/pic.jpg)");
  });

  test("decodes HTML entities in innerHTML", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p>&lt;div&gt; &amp; &quot;test&quot;</p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain('<div> & "test"');
  });

  test("handles innerHTML with wrapper elements (unwraps)", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<div><p>Nested in div</p></div>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Nested in div");
  });

  test("handles innerHTML with del/s (strikethrough)", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p><del>deleted</del> and <s>struck</s></p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("~~deleted~~");
    expect(content).toContain("~~struck~~");
  });

  test("handles innerHTML with b/i tags", () => {
    const doc = {
      children: [{ tagName: "div", innerHTML: "<p><b>bold</b> and <i>italic</i></p>" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("**bold**");
    expect(content).toContain("*italic*");
  });

  test("expands $prototype Array with map template", () => {
    const doc = {
      state: { items: [{ name: "Apple" }, { name: "Banana" }, { name: "Cherry" }] },
      children: [
        {
          tagName: "ul",
          children: [
            {
              $prototype: "Array",
              items: { $ref: "#/state/items" },
              map: {
                tagName: "li",
                textContent: { $ref: "$map/item/name" },
              },
            },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("- Apple");
    expect(content).toContain("- Banana");
    expect(content).toContain("- Cherry");
  });

  test("handles number nodes", () => {
    const doc = {
      children: [{ tagName: "p", children: [42] }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("42");
  });

  test("skips null/undefined nodes", () => {
    const doc = {
      children: [null, undefined, { tagName: "p", textContent: "Valid" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Valid");
  });

  test("link with title attribute", () => {
    const doc = {
      children: [
        {
          tagName: "p",
          children: [
            {
              tagName: "a",
              attributes: { href: "https://x.com", title: "Visit X" },
              textContent: "X",
            },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain('[X](https://x.com "Visit X")');
  });

  test("image with title attribute", () => {
    const doc = {
      children: [{ tagName: "img", attributes: { src: "/img.png", alt: "Alt", title: "Title" } }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain('![Alt](/img.png "Title")');
  });

  test("code block without language", () => {
    const doc = {
      children: [
        {
          tagName: "pre",
          children: [{ tagName: "code", textContent: "plain code" }],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("```");
    expect(content).toContain("plain code");
  });

  test("pre with textContent directly (no code child)", () => {
    const doc = {
      children: [{ tagName: "pre", textContent: "raw text" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("raw text");
  });

  test("component with slot replacement", () => {
    const componentDefs = new Map([
      [
        "my-layout",
        {
          state: {},
          children: [{ tagName: "h1", textContent: "Header" }, { tagName: "slot" }],
        },
      ],
    ]);

    const doc = {
      children: [
        {
          tagName: "my-layout",
          children: [{ tagName: "p", textContent: "Slotted content" }],
        },
      ],
    };

    const { content } = compileMarkdown(doc, componentDefs);
    expect(content).toContain("# Header");
    expect(content).toContain("Slotted content");
  });

  test("component with no children in definition returns empty", () => {
    const componentDefs = new Map([["my-empty", { state: {} }]]);
    const doc = {
      children: [{ tagName: "my-empty" }],
    };
    const { content } = compileMarkdown(doc, componentDefs);
    expect(content).toBe("\n");
  });

  test("unknown tag with textContent wraps in paragraph", () => {
    const doc = {
      children: [{ tagName: "custom-unknown-tag", textContent: "Unknown" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Unknown");
  });

  test("empty paragraph produces no output", () => {
    const doc = {
      children: [{ tagName: "p", textContent: "" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content.trim()).toBe("");
  });

  test("list with non-listItem children filters them out", () => {
    const doc = {
      children: [
        {
          tagName: "ul",
          children: [
            { tagName: "li", textContent: "Valid" },
            { tagName: "p", textContent: "Not a list item" },
          ],
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("- Valid");
  });

  test("handles innerHTML with nested lists", () => {
    const doc = {
      children: [
        {
          tagName: "div",
          innerHTML: "<ul><li><ul><li>Nested</li></ul></li></ul>",
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("Nested");
  });

  test("handles link in innerHTML with title", () => {
    const doc = {
      children: [
        {
          tagName: "div",
          innerHTML: '<p><a href="/page" title="Go">Click</a></p>',
        },
      ],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("[Click](/page");
  });

  test("blockquote with bare text wraps in paragraph", () => {
    const doc = {
      children: [{ tagName: "blockquote", textContent: "Simple quote" }],
    };
    const { content } = compileMarkdown(doc);
    expect(content).toContain("> Simple quote");
  });
});
