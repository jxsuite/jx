import { describe, test, expect } from "bun:test";
import { mdToJsonsx, jsonsxToMd } from "../md-convert.js";

// ─── Helpers — build mdast nodes ─────────────────────────────────────────────

function root(...children) {
  return { type: "root", children };
}

function heading(depth, text) {
  return { type: "heading", depth, children: [{ type: "text", value: text }] };
}

function paragraph(text) {
  return { type: "paragraph", children: [{ type: "text", value: text }] };
}

function emphasis(text) {
  return { type: "emphasis", children: [{ type: "text", value: text }] };
}

function strong(text) {
  return { type: "strong", children: [{ type: "text", value: text }] };
}

function link(url, text, title) {
  return { type: "link", url, title: title ?? null, children: [{ type: "text", value: text }] };
}

function image(url, alt, title) {
  return { type: "image", url, alt: alt ?? "", title: title ?? null };
}

function inlineCode(value) {
  return { type: "inlineCode", value };
}

function list(ordered, ...items) {
  return { type: "list", ordered, spread: false, children: items };
}

function listItem(...children) {
  return { type: "listItem", spread: false, children };
}

function codeBlock(value, lang) {
  return { type: "code", lang: lang ?? null, value };
}

function thematicBreak() {
  return { type: "thematicBreak" };
}

// ─── mdToJsonsx ──────────────────────────────────────────────────────────────

describe("mdToJsonsx", () => {
  test("root node becomes content div", () => {
    const result = mdToJsonsx(root());
    expect(result.tagName).toBe("div");
    expect(result.$id).toBe("content");
    expect(result.children).toEqual([]);
  });

  test("converts heading", () => {
    const result = mdToJsonsx(root(heading(2, "Hello")));
    expect(result.children[0]).toEqual({ tagName: "h2", textContent: "Hello" });
  });

  test("converts all heading depths", () => {
    for (let i = 1; i <= 6; i++) {
      const result = mdToJsonsx(root(heading(i, "H")));
      expect(result.children[0].tagName).toBe(`h${i}`);
    }
  });

  test("converts paragraph", () => {
    const result = mdToJsonsx(root(paragraph("Some text")));
    expect(result.children[0]).toEqual({ tagName: "p", textContent: "Some text" });
  });

  test("converts emphasis", () => {
    const mdast = root({
      type: "paragraph",
      children: [emphasis("italic")],
    });
    const result = mdToJsonsx(mdast);
    const p = result.children[0];
    expect(p.children[0]).toEqual({ tagName: "em", textContent: "italic" });
  });

  test("converts strong", () => {
    const mdast = root({
      type: "paragraph",
      children: [strong("bold")],
    });
    const result = mdToJsonsx(mdast);
    const p = result.children[0];
    expect(p.children[0]).toEqual({ tagName: "strong", textContent: "bold" });
  });

  test("converts inline code", () => {
    const mdast = root({
      type: "paragraph",
      children: [inlineCode("const x = 1")],
    });
    const result = mdToJsonsx(mdast);
    const p = result.children[0];
    expect(p.children[0]).toEqual({ tagName: "code", textContent: "const x = 1" });
  });

  test("converts link", () => {
    const mdast = root({
      type: "paragraph",
      children: [link("https://example.com", "Example")],
    });
    const result = mdToJsonsx(mdast);
    const a = result.children[0].children[0];
    expect(a.tagName).toBe("a");
    expect(a.attributes.href).toBe("https://example.com");
    expect(a.textContent).toBe("Example");
  });

  test("converts image", () => {
    const mdast = root({
      type: "paragraph",
      children: [image("img.png", "Alt text", "Title")],
    });
    const result = mdToJsonsx(mdast);
    const img = result.children[0].children[0];
    expect(img.tagName).toBe("img");
    expect(img.attributes.src).toBe("img.png");
    expect(img.attributes.alt).toBe("Alt text");
    expect(img.attributes.title).toBe("Title");
  });

  test("converts unordered list", () => {
    const mdast = root(
      list(false, listItem(paragraph("Item 1")), listItem(paragraph("Item 2"))),
    );
    const result = mdToJsonsx(mdast);
    const ul = result.children[0];
    expect(ul.tagName).toBe("ul");
    expect(ul.children.length).toBe(2);
    expect(ul.children[0].tagName).toBe("li");
  });

  test("converts ordered list", () => {
    const mdast = root(list(true, listItem(paragraph("First"))));
    const result = mdToJsonsx(mdast);
    expect(result.children[0].tagName).toBe("ol");
  });

  test("converts code block", () => {
    const mdast = root(codeBlock("console.log('hi')", "js"));
    const result = mdToJsonsx(mdast);
    const pre = result.children[0];
    expect(pre.tagName).toBe("pre");
    expect(pre.children[0].tagName).toBe("code");
    expect(pre.children[0].textContent).toBe("console.log('hi')");
    expect(pre.children[0].attributes.class).toBe("language-js");
  });

  test("converts thematic break", () => {
    const mdast = root(thematicBreak());
    const result = mdToJsonsx(mdast);
    expect(result.children[0]).toEqual({ tagName: "hr" });
  });

  test("filters out yaml frontmatter nodes", () => {
    const mdast = root({ type: "yaml", value: "title: Test" }, paragraph("Hello"));
    const result = mdToJsonsx(mdast);
    expect(result.children.length).toBe(1);
    expect(result.children[0].tagName).toBe("p");
  });

  test("converts blockquote", () => {
    const mdast = root({
      type: "blockquote",
      children: [paragraph("Quoted text")],
    });
    const result = mdToJsonsx(mdast);
    const bq = result.children[0];
    expect(bq.tagName).toBe("blockquote");
    expect(bq.children[0]).toEqual({ tagName: "p", textContent: "Quoted text" });
  });
});

// ─── jsonsxToMd ──────────────────────────────────────────────────────────────

describe("jsonsxToMd", () => {
  test("empty document", () => {
    const result = jsonsxToMd({ tagName: "div", children: [] });
    expect(result).toEqual({ type: "root", children: [] });
  });

  test("paragraph", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [{ tagName: "p", textContent: "Hello" }],
    });
    expect(result.children[0].type).toBe("paragraph");
    expect(result.children[0].children[0]).toEqual({ type: "text", value: "Hello" });
  });

  test("heading depth", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [{ tagName: "h3", textContent: "Title" }],
    });
    expect(result.children[0].type).toBe("heading");
    expect(result.children[0].depth).toBe(3);
  });

  test("link", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [
        {
          tagName: "p",
          children: [
            { tagName: "a", attributes: { href: "https://x.com" }, textContent: "Link" },
          ],
        },
      ],
    });
    const link = result.children[0].children[0];
    expect(link.type).toBe("link");
    expect(link.url).toBe("https://x.com");
  });

  test("image", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [
        {
          tagName: "p",
          children: [
            { tagName: "img", attributes: { src: "photo.jpg", alt: "A photo" } },
          ],
        },
      ],
    });
    const img = result.children[0].children[0];
    expect(img.type).toBe("image");
    expect(img.url).toBe("photo.jpg");
    expect(img.alt).toBe("A photo");
  });

  test("unordered list", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [
        {
          tagName: "ul",
          children: [
            { tagName: "li", children: [{ tagName: "p", textContent: "A" }] },
            { tagName: "li", children: [{ tagName: "p", textContent: "B" }] },
          ],
        },
      ],
    });
    const list = result.children[0];
    expect(list.type).toBe("list");
    expect(list.ordered).toBe(false);
    expect(list.children.length).toBe(2);
  });

  test("ordered list", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [
        {
          tagName: "ol",
          children: [{ tagName: "li", children: [{ tagName: "p", textContent: "First" }] }],
        },
      ],
    });
    expect(result.children[0].ordered).toBe(true);
  });

  test("code block with language", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [
        {
          tagName: "pre",
          children: [
            {
              tagName: "code",
              textContent: "const x = 1",
              attributes: { class: "language-js" },
            },
          ],
        },
      ],
    });
    const code = result.children[0];
    expect(code.type).toBe("code");
    expect(code.lang).toBe("js");
    expect(code.value).toBe("const x = 1");
  });

  test("thematic break", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [{ tagName: "hr" }],
    });
    expect(result.children[0].type).toBe("thematicBreak");
  });

  test("non-markdown tag becomes directive", () => {
    const result = jsonsxToMd({
      tagName: "div",
      children: [{ tagName: "my-widget", attributes: { color: "red" } }],
    });
    const directive = result.children[0];
    expect(directive.type).toBe("leafDirective");
    expect(directive.name).toBe("my-widget");
    expect(directive.attributes.color).toBe("red");
  });
});

// ─── Round-trip ──────────────────────────────────────────────────────────────

describe("round-trip", () => {
  test("paragraph survives round-trip", () => {
    const mdast = root(paragraph("Hello world"));
    const jsonsx = mdToJsonsx(mdast);
    const back = jsonsxToMd(jsonsx);
    expect(back.children[0].type).toBe("paragraph");
    expect(back.children[0].children[0].value).toBe("Hello world");
  });

  test("heading survives round-trip", () => {
    const mdast = root(heading(2, "Title"));
    const jsonsx = mdToJsonsx(mdast);
    const back = jsonsxToMd(jsonsx);
    expect(back.children[0].type).toBe("heading");
    expect(back.children[0].depth).toBe(2);
    expect(back.children[0].children[0].value).toBe("Title");
  });

  test("code block survives round-trip", () => {
    const mdast = root(codeBlock("x = 1", "python"));
    const jsonsx = mdToJsonsx(mdast);
    const back = jsonsxToMd(jsonsx);
    expect(back.children[0].type).toBe("code");
    expect(back.children[0].lang).toBe("python");
    expect(back.children[0].value).toBe("x = 1");
  });

  test("thematic break survives round-trip", () => {
    const mdast = root(thematicBreak());
    const jsonsx = mdToJsonsx(mdast);
    const back = jsonsxToMd(jsonsx);
    expect(back.children[0].type).toBe("thematicBreak");
  });
});
