import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyStyleKeyMapping,
  collapseDotPaths,
  collapseStylePaths,
  expandDotPaths,
  expandStylePaths,
  isJxMarkdown,
  transpileJxMarkdown,
} from "../src/md";

import { jxKey, mdKey } from "../src/transpile";
import { isString } from "@jxsuite/schema/guards";
import type { JxElement } from "@jxsuite/schema/types";

const __dirname = import.meta.dirname;
const EXAMPLES_DIR = join(__dirname, "..", "..", "..", "examples");

/** `el`'s children as a list, failing the test when they are a mapped array or absent. */
function childList(el: JxElement): (JxElement | string)[] {
  if (!Array.isArray(el.children)) {
    throw new TypeError(`<${el.tagName ?? "?"}> has no children list`);
  }
  return el.children;
}

/** Child `index` of `el` as an element, failing the test when a string or nothing sits there. */
function childAt(el: JxElement, index: number): JxElement {
  const node = childList(el)[index];
  if (node === undefined || isString(node)) {
    throw new TypeError(`child ${index} of <${el.tagName ?? "?"}> is not an element`);
  }
  return node;
}

/** The first child of `el` whose tag is `tagName`, failing the test when there is none. */
function childTagged(el: JxElement, tagName: string): JxElement {
  const found = childList(el).find((c): c is JxElement => !isString(c) && c.tagName === tagName);
  if (found === undefined) {
    throw new TypeError(`<${el.tagName ?? "?"}> has no <${tagName}> child`);
  }
  return found;
}

// ─── jxKey / mdKey ──────────────────────────────────────────────────────────

describe("jxKey", () => {
  test("adds $ to reserved keywords", () => {
    expect(jxKey("prototype")).toBe("$prototype");
    expect(jxKey("ref")).toBe("$ref");
    expect(jxKey("props")).toBe("$props");
    expect(jxKey("switch")).toBe("$switch");
    expect(jxKey("elements")).toBe("$elements");
    expect(jxKey("component")).toBe("$component");
  });

  test("passes through non-reserved keys", () => {
    expect(jxKey("style")).toBe("style");
    expect(jxKey("children")).toBe("children");
    expect(jxKey("id")).toBe("id");
  });
});

describe("mdKey", () => {
  test("strips $ from reserved keywords", () => {
    expect(mdKey("$prototype")).toBe("prototype");
    expect(mdKey("$ref")).toBe("ref");
    expect(mdKey("$props")).toBe("props");
    expect(mdKey("$switch")).toBe("switch");
    expect(mdKey("$elements")).toBe("elements");
  });

  test("passes through non-reserved $ keys", () => {
    expect(mdKey("$schema")).toBe("$schema");
    expect(mdKey("$id")).toBe("$id");
  });

  test("passes through non-$ keys", () => {
    expect(mdKey("style")).toBe("style");
    expect(mdKey("id")).toBe("id");
  });
});

// ─── expandDotPaths ──────────────────────────────────────────────────────────

describe("expandDotPaths", () => {
  test("passes through flat attributes unchanged", () => {
    const result = expandDotPaths({ color: "red", fontSize: "16px" });
    expect(result).toEqual({ color: "red", fontSize: "16px" });
  });

  test("expands pseudo-selector dot-paths", () => {
    const result = expandDotPaths({
      ":hover.backgroundColor": "darkblue",
      ":hover.cursor": "pointer",
      backgroundColor: "blue",
    });
    expect(result).toEqual({
      ":hover": { backgroundColor: "darkblue", cursor: "pointer" },
      backgroundColor: "blue",
    });
  });

  test("expands media query dot-paths", () => {
    const result = expandDotPaths({
      "--dark.backgroundColor": "#1a1a1a",
      "--dark.color": "#f0f0f0",
      "--md.gap": "1rem",
      gap: "0.5rem",
    });
    expect(result).toEqual({
      "--dark": { backgroundColor: "#1a1a1a", color: "#f0f0f0" },
      "--md": { gap: "1rem" },
      gap: "0.5rem",
    });
  });

  test("expands deeply nested dot-paths with Jx keyword mapping", () => {
    const result = expandDotPaths({
      "items.ref": "#/state/items",
      "map.component": "todo-item",
      "map.props.item.ref": "$map/item",
      "map.props.onToggle.ref": "#/state/toggleItem",
      prototype: "Array",
    });
    expect(result).toEqual({
      $prototype: "Array",
      items: { $ref: "#/state/items" },
      map: {
        $component: "todo-item",
        $props: {
          item: { $ref: "$map/item" },
          onToggle: { $ref: "#/state/toggleItem" },
        },
      },
    });
  });
});

// ─── expandStylePaths ────────────────────────────────────────────────────────

describe("expandStylePaths", () => {
  test("maps pseudo-class names to colon prefix", () => {
    const result = expandStylePaths({
      color: "red",
      "disabled.opacity": "0.5",
      "hover.color": "blue",
      "hover.cursor": "pointer",
    });
    expect(result).toEqual({
      ":disabled": { opacity: "0.5" },
      ":hover": { color: "blue", cursor: "pointer" },
      color: "red",
    });
  });

  test("maps --prefixed keys to @ prefix for media queries", () => {
    const result = expandStylePaths({
      "--dark.backgroundColor": "#1a1a1a",
      "--md.gap": "1rem",
      gap: "0.5rem",
    });
    expect(result).toEqual({
      "@--dark": { backgroundColor: "#1a1a1a" },
      "@--md": { gap: "1rem" },
      gap: "0.5rem",
    });
  });

  test("passes through non-pseudo non-media keys unchanged", () => {
    const result = expandStylePaths({
      color: "red",
      fontSize: "16px",
    });
    expect(result).toEqual({ color: "red", fontSize: "16px" });
  });
});

// ─── collapseDotPaths ────────────────────────────────────────────────────────

describe("collapseDotPaths", () => {
  test("collapses nested objects to dot-paths", () => {
    const result = collapseDotPaths({
      ":hover": { backgroundColor: "darkblue", cursor: "pointer" },
      backgroundColor: "blue",
    });
    expect(result).toEqual({
      ":hover.backgroundColor": "darkblue",
      ":hover.cursor": "pointer",
      backgroundColor: "blue",
    });
  });

  test("round-trips with expandDotPaths", () => {
    const original = {
      ":hover.color": "red",
      "@--md.gap": "1rem",
      gap: "0.5rem",
    };
    expect(collapseDotPaths(expandDotPaths(original))).toEqual(original);
  });
});

// ─── collapseStylePaths ────────────────────────────────────────────────────

describe("collapseStylePaths", () => {
  test("strips colon prefix from pseudo-class keys", () => {
    const result = collapseStylePaths({
      ":hover": { color: "blue", cursor: "pointer" },
      color: "red",
    });
    expect(result).toEqual({
      color: "red",
      "hover.color": "blue",
      "hover.cursor": "pointer",
    });
  });

  test("strips @ prefix from media query keys", () => {
    const result = collapseStylePaths({
      "@--md": { gap: "1rem" },
      gap: "0.5rem",
    });
    expect(result).toEqual({
      "--md.gap": "1rem",
      gap: "0.5rem",
    });
  });

  test("round-trips with expandStylePaths", () => {
    const original = {
      "--md.gap": "1rem",
      gap: "0.5rem",
      "hover.color": "red",
    };
    expect(collapseStylePaths(expandStylePaths(original))).toEqual(original);
  });
});

// ─── applyStyleKeyMapping ──────────────────────────────────────────────────

describe("applyStyleKeyMapping", () => {
  test("maps pseudo-class names to colon prefix", () => {
    const result = applyStyleKeyMapping({
      focus: { outline: "none" },
      hover: { color: "red" },
    });
    expect(result).toEqual({
      ":focus": { outline: "none" },
      ":hover": { color: "red" },
    });
  });

  test("maps -- keys to @ prefix", () => {
    const result = applyStyleKeyMapping({ "--dark": { color: "white" } });
    expect(result).toEqual({ "@--dark": { color: "white" } });
  });

  test("passes through regular keys unchanged", () => {
    const result = applyStyleKeyMapping({ color: "red", fontSize: "16px" });
    expect(result).toEqual({ color: "red", fontSize: "16px" });
  });
});

// ─── isJxMarkdown ────────────────────────────────────────────────────────────

describe("isJxMarkdown", () => {
  test("returns true for markdown with hyphenated tagName", () => {
    const source = `---\ntagName: todo-app\n---\n\nHello`;
    expect(isJxMarkdown(source)).toBe(true);
  });

  test("returns false for content markdown without tagName", () => {
    const source = `---\ntitle: My Post\ndate: 2024-01-01\n---\n\nHello`;
    expect(isJxMarkdown(source)).toBe(false);
  });

  test("returns false for tagName without hyphen", () => {
    const source = `---\ntagName: div\n---\n\nHello`;
    expect(isJxMarkdown(source)).toBe(false);
  });

  test("returns false for no frontmatter", () => {
    expect(isJxMarkdown("# Just a heading\n\nSome content")).toBe(false);
  });
});

// ─── transpileJxMarkdown ─────────────────────────────────────────────────────

describe("transpileJxMarkdown", () => {
  test("extracts frontmatter as top-level Jx properties", () => {
    const source = `---
$schema: https://jxsuite.com/schema/v1
$id: TestComponent
tagName: test-component
state:
  count: 0
  label: hello
---

# Title
`;
    const doc = transpileJxMarkdown(source);
    expect(doc.$schema).toBe("https://jxsuite.com/schema/v1");
    expect(doc.$id).toBe("TestComponent");
    expect(doc.tagName).toBe("test-component");
    expect(doc.state).toEqual({ count: 0, label: "hello" });
  });

  test("converts frontmatter style to document style", () => {
    const source = `---
tagName: my-comp
style:
  color: red
  fontSize: 16px
---

# Hello
`;
    const doc = transpileJxMarkdown(source);
    expect(doc.style).toEqual({ color: "red", fontSize: "16px" });
  });

  test("preserves pseudo-class and media keys in frontmatter style", () => {
    const source = `---
tagName: my-comp
style:
  color: red
  ":hover":
    color: blue
  "@--dark":
    color: white
---
`;
    const doc = transpileJxMarkdown(source);
    expect(doc.style).toEqual({
      ":hover": { color: "blue" },
      "@--dark": { color: "white" },
      color: "red",
    });
  });

  test("expands style.* dot-path attributes on containers", () => {
    const source = `---
tagName: my-comp
---

::::my-section{style.padding="1rem" style.backgroundColor="white"}

Some content here.
::::
`;
    const doc = transpileJxMarkdown(source);
    const section = childAt(doc, 0);
    expect(section.tagName).toBe("my-section");
    expect(section.style).toEqual({
      backgroundColor: "white",
      padding: "1rem",
    });
  });

  test("maps pseudo-class names in style.* attributes", () => {
    const source = `---
tagName: my-comp
---

::button{style.color="red" style.hover.color="blue" style.hover.cursor="pointer"}
`;
    const doc = transpileJxMarkdown(source);
    const button = childAt(doc, 0);
    expect(button.style).toEqual({
      ":hover": { color: "blue", cursor: "pointer" },
      color: "red",
    });
  });

  test("maps media query keys in style.* attributes", () => {
    const source = `---
tagName: my-comp
---

::div{style.gap="0.5rem" style.--md.gap="1rem" style.--dark.backgroundColor="#1a1a1a"}
`;
    const doc = transpileJxMarkdown(source);
    const div = childAt(doc, 0);
    expect(div.style).toEqual({
      "@--dark": { backgroundColor: "#1a1a1a" },
      "@--md": { gap: "1rem" },
      gap: "0.5rem",
    });
  });

  test("maps directive attributes to HTML attributes for standard elements", () => {
    const source = `---
tagName: my-comp
---

::input{type="text" value="\${state.name}" placeholder="Enter name"}
`;
    const doc = transpileJxMarkdown(source);
    const input = childAt(doc, 0);
    expect(input.tagName).toBe("input");
    expect(input.attributes?.type).toBe("text");
    expect(input.attributes?.value).toBe("${state.name}");
    expect(input.attributes?.placeholder).toBe("Enter name");
  });

  test("routes aria-* and data-* to attributes sub-object", () => {
    const source = `---
tagName: my-comp
---

::button{onclick="handleClick()" aria-label="Close" data-id="42"}
`;
    const doc = transpileJxMarkdown(source);
    const button = childAt(doc, 0);
    expect(button.onclick).toBe("handleClick()");
    expect(button.attributes).toEqual({
      "aria-label": "Close",
      "data-id": "42",
    });
  });

  test("handles leaf directives as self-closing elements", () => {
    const source = `---
tagName: my-comp
---

::hr
::img{src="/photo.jpg" alt="A photo"}
`;
    const doc = transpileJxMarkdown(source);
    expect(childAt(doc, 0).tagName).toBe("hr");
    expect(childAt(doc, 1).tagName).toBe("img");
    expect(childAt(doc, 1).attributes?.src).toBe("/photo.jpg");
    expect(childAt(doc, 1).attributes?.alt).toBe("A photo");
  });

  test("handles container directives with nested children", () => {
    const source = `---
tagName: my-comp
---

::::::outer
:::::inner
Content
:::::
::::::
`;
    const doc = transpileJxMarkdown(source);
    const outer = childAt(doc, 0);
    expect(outer.tagName).toBe("outer");
    const inner = childAt(outer, 0);
    expect(inner.tagName).toBe("inner");
  });

  test("unwraps paragraph children inside phrasing-content directives", () => {
    const source = `---
tagName: my-comp
---

:::::::::p{style.fontSize="1.25rem" style.color="red"}
Hello world
:::::::::
`;
    const doc = transpileJxMarkdown(source);
    const p = childAt(doc, 0);
    expect(p.tagName).toBe("p");
    expect(p.style).toEqual({ color: "red", fontSize: "1.25rem" });
    // Text should be textContent, NOT a nested paragraph
    expect(p.textContent).toBe("Hello world");
    expect(p.children).toBeUndefined();
  });

  test("unwraps paragraph children in h1 directive with mixed content", () => {
    const source = `---
tagName: my-comp
---

:::::::::h1{style.fontSize="3rem"}
Design visually.
::br
::::span{style.color="gray"}
Ship as static HTML.
::::
:::::::::
`;
    const doc = transpileJxMarkdown(source);
    const h1 = childAt(doc, 0);
    expect(h1.tagName).toBe("h1");
    expect(h1.style).toEqual({ fontSize: "3rem" });
    // Should have mixed children: text, br, span
    expect(childList(h1).length).toBe(3);
    expect(childList(h1)[0]).toBe("Design visually.");
    expect(childAt(h1, 1).tagName).toBe("br");
    expect(childAt(h1, 2).tagName).toBe("span");
    expect(childAt(h1, 2).style).toEqual({ color: "gray" });
    expect(childAt(h1, 2).textContent).toBe("Ship as static HTML.");
  });

  test("preserves paragraph children in block-level directives", () => {
    const source = `---
tagName: my-comp
---

:::div
Some text
:::
`;
    const doc = transpileJxMarkdown(source);
    const div = childAt(doc, 0);
    expect(div.tagName).toBe("div");
    // Div CAN contain paragraphs, so they should NOT be unwrapped
    expect(childAt(div, 0).tagName).toBe("p");
  });

  test("converts standard markdown nodes to Jx elements", () => {
    const source = `---
tagName: my-comp
---

# Hello World

A paragraph with **bold** and *italic* text.
`;
    const doc = transpileJxMarkdown(source);
    const h1 = childAt(doc, 0);
    expect(h1.tagName).toBe("h1");
    expect(h1.textContent).toBe("Hello World");

    const p = childAt(doc, 1);
    expect(p.tagName).toBe("p");
    // Should have mixed children (text, strong, text, em, text)
    expect(childList(p).length).toBeGreaterThan(1);
  });

  test("expands dot-paths for Array namespace children on parent", () => {
    const source = `---
tagName: my-comp
state:
  items: []
---

::::::todo-list{children.prototype="Array" children.items.ref="#/state/items" children.map.component="todo-item" children.map.props.item.ref="$map/item"}
::::::
`;
    const doc = transpileJxMarkdown(source);
    const list = childAt(doc, 0);
    expect(list.tagName).toBe("todo-list");
    expect(list.children).toEqual({
      $prototype: "Array",
      items: { $ref: "#/state/items" },
      map: {
        $component: "todo-item",
        $props: { item: { $ref: "$map/item" } },
      },
    });
  });

  test("transpiles the todo-item example", () => {
    const source = readFileSync(join(EXAMPLES_DIR, "components", "todo-item.md"), "utf8");
    const doc = transpileJxMarkdown(source);

    expect(doc.$schema).toBe("https://jxsuite.com/schema/v1");
    expect(doc.$id).toBe("TodoItem");
    expect(doc.tagName).toBe("todo-item");
    expect(doc.state?.item).toEqual({});
    expect(doc.state?.onToggle).toMatchObject({ $prototype: "Function" });
    expect(doc.style).toBeDefined();
    expect(doc.style?.display).toBe("flex");
    expect(childList(doc).length).toBe(3); // Input, span, button
    expect(childAt(doc, 0).tagName).toBe("input");
    expect(childAt(doc, 1).tagName).toBe("span");
    expect(childAt(doc, 2).tagName).toBe("button");
    // Each child should have its own style from dot-path attributes
    expect(childAt(doc, 0).style).toBeDefined();
    expect(childAt(doc, 1).style).toBeDefined();
    expect(childAt(doc, 2).style).toBeDefined();
    // Button should have :hover styles from style.hover.* attributes
    expect(childAt(doc, 2).style?.[":hover"]).toMatchObject({ color: "var(--color-danger)" });
  });

  test("transpiles the todo-app example", () => {
    const source = readFileSync(join(EXAMPLES_DIR, "components", "todo-app.md"), "utf8");
    const doc = transpileJxMarkdown(source);

    expect(doc.$schema).toBe("https://jxsuite.com/schema/v1");
    // The markdown twin of components/todo-app.json carries its own tag/$id so both can register
    // As custom elements in the same project (componentDefs are keyed by tagName).
    expect(doc.$id).toBe("MarkdownTodoApp");
    expect(doc.tagName).toBe("markdown-todo-app");
    expect(doc.$media).toBeDefined();
    expect(doc.state?.items).toMatchObject({ $prototype: "LocalStorage" });
    expect(doc.state?.addItem).toMatchObject({ $prototype: "Function" });
    expect(doc.style).toBeDefined();
    expect(doc.style?.["@--dark"]).toBeDefined();
    // Should have header, add-form, todo-list, footer sections
    expect(childList(doc).length).toBe(4);
    expect(childAt(doc, 0).tagName).toBe("header");
    expect(childAt(doc, 1).tagName).toBe("add-form");
    expect(childAt(doc, 2).tagName).toBe("todo-list");
    expect(childAt(doc, 3).tagName).toBe("footer");
  });
});

// ─── transpileJxMarkdown — markdown body node conversions ───────────────────

describe("transpileJxMarkdown — body nodes", () => {
  test("inline code converts to code element", () => {
    const source = `---
tagName: my-comp
---

This has \`inline code\` in it.
`;
    const doc = transpileJxMarkdown(source);
    const para = childAt(doc, 0);
    expect(para.tagName).toBe("p");
    const codeNode = childTagged(para, "code");
    expect(codeNode).toBeDefined();
    expect(codeNode.textContent).toBe("inline code");
  });

  test("links convert to anchor elements", () => {
    const source = `---
tagName: my-comp
---

Click [here](https://example.com "Example") for more.
`;
    const doc = transpileJxMarkdown(source);
    const para = childAt(doc, 0);
    const link = childTagged(para, "a");
    expect(link).toBeDefined();
    expect(link.attributes?.href).toBe("https://example.com");
    expect(link.attributes?.title).toBe("Example");
  });

  test("images convert to img elements", () => {
    const source = `---
tagName: my-comp
---

![Alt text](image.png "Image title")
`;
    const doc = transpileJxMarkdown(source);
    const para = childAt(doc, 0);
    const img = childTagged(para, "img");
    expect(img).toBeDefined();
    expect(img.attributes?.src).toBe("image.png");
    expect(img.attributes?.alt).toBe("Alt text");
    expect(img.attributes?.title).toBe("Image title");
  });

  test("ordered list converts to ol element", () => {
    const source = `---
tagName: my-comp
---

1. First
2. Second
3. Third
`;
    const doc = transpileJxMarkdown(source);
    const list = childTagged(doc, "ol");
    expect(list).toBeDefined();
    expect(childList(list).length).toBe(3);
    expect(childAt(list, 0).tagName).toBe("li");
  });

  test("ordered list with non-1 start gets start attribute", () => {
    const source = `---
tagName: my-comp
---

5. Fifth
6. Sixth
`;
    const doc = transpileJxMarkdown(source);
    const list = childTagged(doc, "ol");
    expect(list).toBeDefined();
    expect(list.attributes?.start).toBe("5");
  });

  test("fenced code block converts to pre > code", () => {
    const source = `---
tagName: my-comp
---

\`\`\`javascript
const x = 42;
\`\`\`
`;
    const doc = transpileJxMarkdown(source);
    const pre = childTagged(doc, "pre");
    expect(pre).toBeDefined();
    const code = childAt(pre, 0);
    expect(code.tagName).toBe("code");
    expect(code.className).toBe("language-javascript");
    expect(code.textContent).toContain("const x = 42;");
  });

  test("table converts to table with thead and tbody", () => {
    const source = `---
tagName: my-comp
---

| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |
`;
    const doc = transpileJxMarkdown(source);
    const table = childTagged(doc, "table");
    expect(table).toBeDefined();
    const thead = childTagged(table, "thead");
    const tbody = childTagged(table, "tbody");
    expect(thead).toBeDefined();
    expect(tbody).toBeDefined();
  });

  test("link with complex children preserves structure", () => {
    const source = `---
tagName: my-comp
---

[**Bold link** text](https://example.com)
`;
    const doc = transpileJxMarkdown(source);
    const para = childAt(doc, 0);
    const link = childTagged(para, "a");
    expect(link).toBeDefined();
    expect(link.children).toBeDefined();
    expect(childList(link).length).toBeGreaterThan(0);
  });
});
