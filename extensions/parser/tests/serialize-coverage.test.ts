import { describe, expect, test } from "bun:test";
import { jxToMdast, mdastToJx, serializeJxMarkdown } from "../src/serialize";
import type { SerializeOptions } from "../src/serialize";
import type { MdastNode } from "../src/types";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonValue, JxDocument, JxElement, JxStateDefinition } from "@jxsuite/schema/types";

// ─── Export-mode helpers (mirror serialize-export.test.ts) ───────────────────
// Typed through SerializeOptions so each hook takes exactly the parameters the serializer passes.
const templateHooks: Pick<SerializeOptions, "buildScope" | "evaluateTemplate"> = {
  buildScope(stateDefs) {
    const scope: Record<string, JsonValue | JxStateDefinition> = {};
    for (const [key, def] of Object.entries(stateDefs)) {
      scope[key] = isJsonObject(def) && "default" in def ? def.default : def;
    }
    return scope;
  },
  evaluateTemplate(str, scope) {
    if (!str.includes("${")) {
      return;
    }
    try {
      const singleExprMatch = str.match(/^\$\{(.+)\}$/s);
      if (singleExprMatch) {
        const fn = new Function("state", "$map", `return (${singleExprMatch[1]})`);
        return fn(scope, scope.$map) ?? str;
      }
      const fn = new Function("state", "$map", `return \`${str}\``);
      return fn(scope, scope.$map) ?? str;
    } catch {
      return str;
    }
  },
};

function exportMd(doc: JxDocument, componentDefs?: Map<string, JxElement>) {
  const options: SerializeOptions = { mode: "export", ...templateHooks };
  if (componentDefs) {
    options.componentDefs = componentDefs;
  }
  return serializeJxMarkdown(doc, options);
}

/** An mdast tree as a remark plugin can leave it: a children array may hold a null hole. */
interface AuthoredMdast {
  type: string;
  children?: (AuthoredMdast | null)[];
  value?: string;
}

/* SAFETY: deliberately outside MdastNode, whose `children` holds only nodes. convertMdastNode
   returns null for a falsy node before any typed access, so a null hole reaches no field read; the
   tests using this pin that the hole is dropped. */
const authoredMdast = (node: AuthoredMdast) => node as MdastNode;

/* SAFETY: deliberately outside JxElement["children"], which holds only elements and strings (and an
   element's own `children` only a list or a repeater). A hand-built tree can carry a null hole or an
   element whose `children` is a plain object. nodeToMdast returns [] for anything that is not a
   string, number or non-null object, and collectDirectiveAttrs copies a non-array object `children`
   into the directive attributes without reading any repeater field, so neither reaches a typed
   access; the tests using this pin both. */
const authoredChildren = (children: JsonValue[]) => children as (JxElement | string)[];

// ═════════════════════════════════════════════════════════════════════════════
// Roundtrip: mdast → Jx (mdastToJx)
// ═════════════════════════════════════════════════════════════════════════════

describe("mdToJx — uncovered node types", () => {
  test("non-root node is converted directly", () => {
    const el: any = mdastToJx({
      children: [{ type: "text", value: "hi" }],
      type: "paragraph",
    });
    expect(el.tagName).toBe("p");
    expect(el.textContent).toBe("hi");
  });

  test("null children are dropped (convertMdastNode null guard)", () => {
    const el: any = mdastToJx(
      authoredMdast({
        children: [
          {
            children: [null, { children: [{ type: "text", value: "x" }], type: "paragraph" }],
            type: "blockquote",
          },
        ],
        type: "root",
      }),
    );
    const [bq] = el.children;
    expect(bq.tagName).toBe("blockquote");
    expect(bq.children.length).toBe(1);
  });

  test("html node with single element", () => {
    const el: any = mdastToJx({
      children: [{ type: "html", value: "<strong>bold</strong>" }],
      type: "root",
    });
    expect(el.children.length).toBeGreaterThan(0);
    expect(el.children[0].tagName).toBe("strong");
  });

  test("html node with empty value is dropped", () => {
    const el: any = mdastToJx({
      children: [{ type: "html", value: "" }],
      type: "root",
    });
    expect(el.children.length).toBe(0);
  });

  test("html node with multiple elements wraps in div", () => {
    const el: any = mdastToJx({
      children: [{ type: "html", value: "<strong>a</strong><em>b</em>" }],
      type: "root",
    });
    expect(el.children[0].tagName).toBe("div");
    expect(el.children[0].children.length).toBe(2);
  });

  test("unknown mdast node type yields null", () => {
    // A definition node carries an `identifier` that MdastNode does not name; it is still a node.
    const definition = { identifier: "x", type: "definition", url: "y" };
    const el: any = mdastToJx({ children: [definition], type: "root" });
    expect(el.children.length).toBe(0);
  });

  test("link with title attribute", () => {
    const el: any = mdastToJx({
      children: [
        {
          children: [
            {
              children: [{ type: "text", value: "L" }],
              title: "T",
              type: "link",
              url: "u",
            },
          ],
          type: "paragraph",
        },
      ],
      type: "root",
    });
    const [a] = el.children[0].children;
    expect(a.attributes.href).toBe("u");
    expect(a.attributes.title).toBe("T");
  });

  test("ordered list with non-default start gets start attribute", () => {
    const el: any = mdastToJx({
      children: [
        {
          children: [
            {
              children: [{ children: [{ type: "text", value: "i" }], type: "paragraph" }],
              type: "listItem",
            },
          ],
          ordered: true,
          start: 3,
          type: "list",
        },
      ],
      type: "root",
    });
    expect(el.children[0].attributes.start).toBe("3");
  });

  test("table with header and body rows splits into thead/tbody", () => {
    const cell = (v: string) => ({ children: [{ type: "text", value: v }], type: "tableCell" });
    const row = (...cells: any[]) => ({ children: cells, type: "tableRow" });
    const el: any = mdastToJx({
      children: [
        {
          children: [row(cell("H1")), row(cell("C1"))],
          type: "table",
        },
      ],
      type: "root",
    });
    const [table] = el.children;
    expect(table.tagName).toBe("table");
    expect(table.children[0].tagName).toBe("thead");
    expect(table.children[1].tagName).toBe("tbody");
  });

  test("table with one row produces thead only", () => {
    const cell = (v: string) => ({ children: [{ type: "text", value: v }], type: "tableCell" });
    const el: any = mdastToJx({
      children: [{ children: [{ children: [cell("only")], type: "tableRow" }], type: "table" }],
      type: "root",
    });
    const [table] = el.children;
    expect(table.children.length).toBe(1);
    expect(table.children[0].tagName).toBe("thead");
  });

  test("table with zero rows produces no sections", () => {
    const el: any = mdastToJx({
      children: [{ children: [], type: "table" }],
      type: "root",
    });
    expect(el.children[0].children).toEqual([]);
  });
});

describe("mdToJx — directives", () => {
  test("prototype directive (Array) becomes $prototype with map", () => {
    const el: any = mdastToJx({
      children: [
        {
          attributes: { items: "#/state/list" },
          children: [{ children: [{ type: "text", value: "tpl" }], type: "paragraph" }],
          name: "Array",
          type: "containerDirective",
        },
      ],
      type: "root",
    });
    const [node] = el.children;
    expect(node.$prototype).toBe("Array");
    expect(node.map).toBeTruthy();
  });

  test("leaf directive with attributes", () => {
    const el: any = mdastToJx({
      children: [{ attributes: { color: "red" }, name: "my-widget", type: "leafDirective" }],
      type: "root",
    });
    const [node] = el.children;
    expect(node.tagName).toBe("my-widget");
    expect(node.attributes.color).toBe("red");
  });

  test("text directive with single text child", () => {
    const el: any = mdastToJx({
      children: [{ children: [{ type: "text", value: "hi" }], name: "foo", type: "textDirective" }],
      type: "root",
    });
    expect(el.children[0].textContent).toBe("hi");
  });

  test("text directive with multiple children", () => {
    const el: any = mdastToJx({
      children: [
        {
          children: [
            { type: "text", value: "a" },
            { children: [{ type: "text", value: "b" }], type: "emphasis" },
          ],
          name: "foo",
          type: "textDirective",
        },
      ],
      type: "root",
    });
    expect(el.children[0].children.length).toBe(2);
  });

  test("container directive with children", () => {
    const el: any = mdastToJx({
      children: [
        {
          children: [{ children: [{ type: "text", value: "note" }], type: "paragraph" }],
          name: "callout",
          type: "containerDirective",
        },
      ],
      type: "root",
    });
    const [node] = el.children;
    expect(node.tagName).toBe("callout");
    expect(node.children[0].tagName).toBe("p");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Roundtrip: Jx → mdast (jxToMdast)
// ═════════════════════════════════════════════════════════════════════════════

describe("jxToMd — uncovered tag types", () => {
  test("span maps to text node (custom allowlist)", () => {
    const result: any = jxToMdast(
      { children: [{ tagName: "span", textContent: "hi" }], tagName: "div" },
      {
        allowlist: ["span"],
      },
    );
    expect(result.children[0]).toEqual({ type: "text", value: "hi" });
  });

  test("allowlisted tag with no mdast mapping yields nothing (array allowlist)", () => {
    const result: any = jxToMdast(
      { children: [{ tagName: "custom" }], tagName: "div" },
      {
        allowlist: ["custom"],
      },
    );
    expect(result.children.length).toBe(0);
  });

  test("emphasis, strong, delete", () => {
    const result: any = jxToMdast({
      children: [
        {
          children: [
            { tagName: "em", textContent: "i" },
            { tagName: "strong", textContent: "b" },
            { tagName: "del", textContent: "d" },
          ],
          tagName: "p",
        },
      ],
      tagName: "div",
    });
    const kids = result.children[0].children;
    expect(kids[0].type).toBe("emphasis");
    expect(kids[1].type).toBe("strong");
    expect(kids[2].type).toBe("delete");
  });

  test("inline code", () => {
    const result: any = jxToMdast({
      children: [{ children: [{ tagName: "code", textContent: "x" }], tagName: "p" }],
      tagName: "div",
    });
    expect(result.children[0].children[0]).toEqual({ type: "inlineCode", value: "x" });
  });

  test("blockquote", () => {
    const result: any = jxToMdast({
      children: [{ children: [{ tagName: "p", textContent: "q" }], tagName: "blockquote" }],
      tagName: "div",
    });
    expect(result.children[0].type).toBe("blockquote");
    expect(result.children[0].children[0].type).toBe("paragraph");
  });

  test("line break", () => {
    const result: any = jxToMdast({ children: [{ tagName: "br" }], tagName: "div" });
    expect(result.children[0]).toEqual({ type: "break" });
  });

  test("table with thead/tbody, rows and header cells", () => {
    const result: any = jxToMdast({
      children: [
        {
          children: [
            "   ",
            {
              children: [{ children: [{ tagName: "th", textContent: "H" }], tagName: "tr" }],
              tagName: "thead",
            },
            {
              children: [{ children: [{ tagName: "td", textContent: "C" }], tagName: "tr" }],
              tagName: "tbody",
            },
          ],
          tagName: "table",
        },
      ],
      tagName: "div",
    });
    const [table] = result.children;
    expect(table.type).toBe("table");
    expect(table.children.length).toBe(2);
    expect(table.children[0].type).toBe("tableRow");
    expect(table.children[0].children[0].isHeader).toBe(true);
    expect(table.children[1].children[0].isHeader).toBeUndefined();
  });
});

describe("jxToMd — directive conversion", () => {
  test("inline custom element with textContent becomes textDirective", () => {
    const result: any = jxToMdast({
      children: [{ children: [{ tagName: "x-icon", textContent: "star" }], tagName: "p" }],
      tagName: "div",
    });
    const [directive] = result.children[0].children;
    expect(directive.type).toBe("textDirective");
    expect(directive.name).toBe("x-icon");
    expect(directive.children[0].value).toBe("star");
  });

  test("inline custom element with children becomes textDirective with child nodes", () => {
    const result: any = jxToMdast({
      children: [
        {
          children: [{ children: [{ tagName: "em", textContent: "i" }], tagName: "x-wrap" }],
          tagName: "p",
        },
      ],
      tagName: "div",
    });
    const [directive] = result.children[0].children;
    expect(directive.type).toBe("textDirective");
    expect(directive.children[0].type).toBe("emphasis");
  });

  test("directive collects object-valued children into attributes", () => {
    const result: any = jxToMdast({
      // A hand-built element whose `children` is a plain object rather than a list or repeater.
      children: authoredChildren([{ children: { foo: "bar" }, tagName: "my-widget" }]),
      tagName: "div",
    });
    const [directive] = result.children;
    expect(directive.attributes["children.foo"]).toBe("bar");
  });

  test("directive attribute key normalization (annotations, pseudo, media)", () => {
    const result: any = jxToMdast({
      children: [
        {
          "@": { margin: "0" },
          "@--breakpoint": "600px",
          ":hover": { color: "red" },
          $title: "My Title",
          tagName: "my-widget",
        },
      ],
      tagName: "div",
    });
    const attrs = result.children[0].attributes;
    expect(attrs["--title"]).toBe("My Title");
    expect(attrs["hover.color"]).toBe("red");
    expect(attrs.margin).toBe("0");
    expect(attrs["--breakpoint"]).toBe("600px");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Export mode — clean markdown
// ═════════════════════════════════════════════════════════════════════════════

describe("export mode — uncovered branches", () => {
  test("innerHTML that yields no parseable blocks falls through", () => {
    const content = exportMd({ children: [{ innerHTML: "<custom>x</custom>", tagName: "div" }] });
    expect(content).not.toContain("custom");
  });

  test("empty paragraph produces nothing", () => {
    const content = exportMd({ children: [{ tagName: "p" }] });
    expect(content.trim()).toBe("");
  });

  test("table with no rows produces nothing", () => {
    const content = exportMd({
      children: [{ children: [{ children: [], tagName: "thead" }], tagName: "table" }],
    });
    expect(content).not.toContain("|");
  });

  test("Array prototype with no map template produces nothing", () => {
    const content = exportMd({
      children: [{ $prototype: "Array", items: { $ref: "#/state/items" } }],
      state: { items: [{ name: "a" }] },
    });
    expect(content.trim()).toBe("");
  });

  test("Array prototype with string map template", () => {
    const content = exportMd({
      children: [{ $prototype: "Array", items: { $ref: "#/state/items" }, map: "plain" }],
      state: { items: [1, 2] },
    });
    expect(content).toContain("plain");
  });

  test("Array prototype with non-object child in map template", () => {
    const content = exportMd({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/items" },
          map: { children: [42], tagName: "p" },
        },
      ],
      state: { items: [1] },
    });
    expect(content).toContain("42");
  });

  test("Array prototype with items ref through a null branch", () => {
    const content = exportMd({
      children: [{ $prototype: "Array", items: { $ref: "#/state/obj/items" } }],
      state: { obj: null },
    });
    expect(content.trim()).toBe("");
  });

  test("innerHTML <p> with only whitespace yields no paragraph", () => {
    const content = exportMd({ children: [{ innerHTML: "<p> </p>", tagName: "div" }] });
    expect(content.trim()).toBe("");
  });

  test("innerHTML empty <ul> yields nothing", () => {
    const content = exportMd({ children: [{ innerHTML: "<ul></ul>", tagName: "div" }] });
    expect(content).not.toContain("-");
  });

  test("innerHTML empty <ol> yields nothing", () => {
    const content = exportMd({ children: [{ innerHTML: "<ol></ol>", tagName: "div" }] });
    expect(content.trim()).toBe("");
  });

  test("innerHTML table with no rows yields nothing", () => {
    const content = exportMd({ children: [{ innerHTML: "<table></table>", tagName: "div" }] });
    expect(content.trim()).toBe("");
  });

  test("innerHTML link with empty text uses decoded inner", () => {
    const content = exportMd({
      children: [{ innerHTML: '<p><a href="https://x.com"></a></p>', tagName: "div" }],
    });
    expect(content).toContain("https://x.com");
  });

  test("component definition with null child is skipped", () => {
    const defs = new Map<string, JxElement>([
      [
        "my-comp",
        {
          children: authoredChildren([null, { tagName: "p", textContent: "hi" }]),
          state: {},
          tagName: "my-comp",
        },
      ],
    ]);
    const content = exportMd({ children: [{ tagName: "my-comp" }] }, defs);
    expect(content).toContain("hi");
  });
});
