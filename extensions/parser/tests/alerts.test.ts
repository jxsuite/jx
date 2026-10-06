/**
 * Alerts tests: GitHub-style callouts (`> [!NOTE]`) recognised in Markdown entries (src/alerts.ts,
 * rendered by `alertToJx` in src/transpile.ts, applied by `processMarkdown`).
 *
 * Most cases go through `processMarkdown`, because the contract is what a content entry renders as,
 * not what the intermediate tree looks like.
 */

import { describe, expect, it } from "bun:test";
import type { JxElement } from "@jxsuite/schema/types";
import { DEFAULT_ALERT_TITLES, inlineText, normalizeAlerts } from "../src/alerts.ts";
import { processMarkdown } from "../src/md.ts";
import { transpileJxMarkdown } from "../src/transpile.ts";

/** Render markdown to the Jx children a content entry carries. */
function render(source: string, alerts?: unknown): JxElement[] {
  return processMarkdown(source, "/x/entry.md", alerts === undefined ? {} : { alerts })
    .$children as JxElement[];
}

const kids = (el: JxElement) => el.children as (JxElement | string)[];

describe("built-in callouts", () => {
  it("renders each GitHub alert type as an accessible note with a visible title", () => {
    for (const [type, title] of Object.entries(DEFAULT_ALERT_TITLES)) {
      const [el] = render(`> [!${type.toUpperCase()}]\n> Body text.\n`);
      expect(el!.tagName).toBe("div");
      expect(el!.className).toBe(`jx-alert jx-alert-${type}`);
      expect(el!.attributes).toEqual({ "data-alert": type, role: "note" });
      const [titleEl, body] = kids(el!) as JxElement[];
      expect(titleEl).toEqual({ className: "jx-alert-title", tagName: "p", textContent: title });
      expect(body).toEqual({ tagName: "p", textContent: "Body text." });
    }
  });

  it("the title is a paragraph, never a heading", () => {
    const [el] = render("> [!NOTE]\n> x\n");
    expect((kids(el!)[0] as JxElement).tagName).toBe("p");
  });

  it("recognises the marker in any case", () => {
    expect(render("> [!note]\n> x")[0]!.className).toBe("jx-alert jx-alert-note");
    expect(render("> [!Warning]\n> x")[0]!.className).toBe("jx-alert jx-alert-warning");
  });

  it("keeps inline formatting and later paragraphs and lists in the body", () => {
    const [el] = render(
      "> [!TIP]\n> Use **bold** and `code`.\n>\n> Second paragraph.\n>\n> - one\n",
    );
    const [, first, second, list] = kids(el!) as JxElement[];
    expect(first!.children).toEqual([
      "Use ",
      { tagName: "strong", textContent: "bold" },
      " and ",
      { tagName: "code", textContent: "code" },
      ".",
    ]);
    expect(second).toEqual({ tagName: "p", textContent: "Second paragraph." });
    expect(list!.tagName).toBe("ul");
  });

  it("an alert with a marker and no body is just its title", () => {
    const [el] = render("> [!NOTE]\n");
    expect(kids(el!)).toHaveLength(1);
  });

  it("does not change what follows the callout", () => {
    const out = render("> [!NOTE]\n> inside\n\noutside\n");
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ tagName: "p", textContent: "outside" });
  });
});

describe("custom titles", () => {
  it("takes the rest of the marker line, with its inline formatting, as the title", () => {
    const [el] = render("> [!TIP] A **custom** title\n> Body");
    const [title, body] = kids(el!) as JxElement[];
    expect(title!.className).toBe("jx-alert-title");
    expect(title!.children).toEqual(["A ", { tagName: "strong", textContent: "custom" }, " title"]);
    expect(body).toEqual({ tagName: "p", textContent: "Body" });
  });

  it("a plain-text title is the title element's text", () => {
    const [el] = render("> [!WARNING] Back up first\n> Body");
    expect((kids(el!)[0] as JxElement).textContent).toBe("Back up first");
  });

  it("a hard break ends the title line", () => {
    const [el] = render("> [!NOTE] Title\\\n> body after the break\n");
    const [title, body] = kids(el!) as JxElement[];
    expect(title!.textContent).toBe("Title");
    expect(body!.textContent).toBe("body after the break");
  });

  it("a marker followed by a hard break uses the default title", () => {
    const [el] = render("> [!NOTE]\\\n> body\n");
    expect((kids(el!)[0] as JxElement).textContent).toBe("Note");
  });

  it("accepts and ignores Obsidian's fold markers", () => {
    for (const marker of ["+", "-"]) {
      const [el] = render(`> [!NOTE]${marker} Folded\n> Body`);
      expect((kids(el!)[0] as JxElement).textContent).toBe("Folded");
    }
  });
});

describe("nesting", () => {
  it("finds an alert inside a list item", () => {
    const [ul] = render("- item\n  > [!WARNING]\n  > careful\n");
    const li = kids(ul!)[0] as JxElement;
    const alert = kids(li)[1] as JxElement;
    expect(alert.className).toBe("jx-alert jx-alert-warning");
  });

  it("finds an alert inside an ordinary blockquote", () => {
    const [quote] = render("> quoted\n>\n> > [!TIP]\n> > inner\n");
    expect(quote!.tagName).toBe("blockquote");
    const inner = (kids(quote!) as JxElement[]).find((c) => c.className?.includes("jx-alert"));
    expect(inner?.attributes?.["data-alert"]).toBe("tip");
  });

  it("finds an alert inside another alert", () => {
    const [outer] = render("> [!NOTE]\n> outer\n>\n> > [!WARNING]\n> > inner\n");
    const inner = (kids(outer!) as JxElement[]).find(
      (c) => c.attributes?.["data-alert"] === "warning",
    );
    expect(inner).toBeDefined();
  });
});

describe("what is left alone", () => {
  it("an ordinary blockquote is untouched", () => {
    const [el] = render("> Just a quotation.\n");
    expect(el).toEqual({
      tagName: "blockquote",
      children: [{ tagName: "p", textContent: "Just a quotation." }],
    });
  });

  it("a blockquote whose first paragraph merely mentions a marker is untouched", () => {
    expect(render("> See [!NOTE] below\n")[0]!.tagName).toBe("blockquote");
    expect(render("> [!NOTE]x\n")[0]!.tagName).toBe("blockquote");
  });

  it("a type with no meaning stays a blockquote with its text intact", () => {
    const [el] = render("> [!BUG]\n> unknown\n");
    expect(el!.tagName).toBe("blockquote");
    expect((kids(el!)[0] as JxElement).textContent).toBe("[!BUG]\nunknown");
  });

  it("a blockquote that begins with something other than a paragraph is untouched", () => {
    expect(render("> - [!NOTE]\n")[0]!.tagName).toBe("blockquote");
    expect(render("> **[!NOTE]**\n")[0]!.tagName).toBe("blockquote");
  });

  it("jxsuite's :::doc-note directives still work beside callouts", () => {
    const out = processMarkdown(
      ":::doc-note\nDirective.\n:::\n\n> [!NOTE]\n> Alert.\n",
      "/x/a.md",
      {
        directiveOptions: { allowedNames: ["doc-note"] },
      },
    ).$children as JxElement[];
    expect(out[0]!.tagName).toBe("doc-note");
    expect(out[1]!.className).toBe("jx-alert jx-alert-note");
  });

  it("the component path (what Studio parses) never rewrites alerts", () => {
    const doc = transpileJxMarkdown("> [!NOTE]\n> Body\n");
    const [quote] = doc.children as JxElement[];
    expect(quote!.tagName).toBe("blockquote");
  });

  it("the excerpt and word count read the callout's own text, not its marker", () => {
    const result = processMarkdown("> [!NOTE]\n> Real words here.\n", "/x/a.md");
    expect(result.$excerpt).toBe("Real words here.");
    expect(result.$wordCount).toBe(3);
  });
});

describe("alerts option", () => {
  it("maps an alert type to a custom element, like :::that-element", () => {
    const [el] = render("> [!NOTE]\n> Body\n", { NOTE: "doc-note" });
    expect(el).toEqual({
      attributes: { "data-alert": "note" },
      children: [{ tagName: "p", textContent: "Body" }],
      tagName: "doc-note",
    });
  });

  it("hands an author's title to the component as data-title", () => {
    const [el] = render("> [!NOTE] Heads **up**\n> Body\n", { note: "doc-note" });
    expect(el!.attributes).toEqual({ "data-alert": "note", "data-title": "Heads up" });
  });

  it("a mapped alert with no body has no children", () => {
    const [el] = render("> [!TIP]\n", { TIP: "doc-tip" });
    expect(el!.children).toBeUndefined();
  });

  it("leaves unmapped types on the built-in markup", () => {
    const out = render("> [!NOTE]\n> a\n\n> [!TIP]\n> b\n", { NOTE: "doc-note" });
    expect(out[0]!.tagName).toBe("doc-note");
    expect(out[1]!.className).toBe("jx-alert jx-alert-tip");
  });

  it("switches on a type beyond GitHub's five with the built-in markup and a capitalised title", () => {
    expect(render("> [!info]\n> a\n")[0]!.tagName).toBe("blockquote");
    const [el] = render("> [!info]\n> a\n", { INFO: true });
    expect(el!.className).toBe("jx-alert jx-alert-info");
    expect((kids(el!)[0] as JxElement).textContent).toBe("Info");
  });

  it("adds a type the author defines, mapped to an element", () => {
    expect(render("> [!info]\n> a\n", { INFO: "doc-note" })[0]!.tagName).toBe("doc-note");
  });

  it("a type mapped to null or false stays a blockquote", () => {
    expect(render("> [!NOTE]\n> a\n", { NOTE: null })[0]!.tagName).toBe("blockquote");
    expect(render("> [!NOTE]\n> a\n", { NOTE: false })[0]!.tagName).toBe("blockquote");
  });

  it("false turns recognition off entirely", () => {
    expect(render("> [!NOTE]\n> a\n", false)[0]!.tagName).toBe("blockquote");
  });
});

describe("normalizeAlerts", () => {
  it("is off for false and defaults to the five GitHub types otherwise", () => {
    expect(normalizeAlerts(false)).toBeNull();
    expect([...normalizeAlerts()!.types.keys()]).toEqual([
      "caution",
      "important",
      "note",
      "tip",
      "warning",
    ]);
    expect(normalizeAlerts(true)!.types.size).toBe(5);
  });

  it("lower-cases keys and records the element", () => {
    const { types } = normalizeAlerts({ NOTE: "doc-note", Danger: "doc-danger" })!;
    expect(types.get("note")).toBe("doc-note");
    expect(types.get("danger")).toBe("doc-danger");
    expect(types.get("tip")).toBeNull();
    expect(normalizeAlerts({ INFO: true })!.types.get("info")).toBeNull();
    expect(normalizeAlerts({ INFO: true })!.types.has("info")).toBe(true);
    expect(normalizeAlerts({ TIP: false })!.types.has("tip")).toBe(false);
  });

  it("refuses values that could not be an element", () => {
    expect(() => normalizeAlerts("doc-note")).toThrow(/expected an object/);
    expect(() => normalizeAlerts(["NOTE"])).toThrow(/expected an object/);
    expect(() => normalizeAlerts(null)).toThrow(/expected an object/);
    expect(() => normalizeAlerts({ NOTE: 3 })).toThrow(/alerts\.NOTE: expected an element name/);
    expect(() => normalizeAlerts({ NOTE: "<script>" })).toThrow(/expected an element name/);
    expect(() => normalizeAlerts({ "9": "x-y" })).toThrow(/not a valid alert type name/);
  });

  it("names where the option was written", () => {
    expect(() => normalizeAlerts({ NOTE: 1 }, 'Content type "kb": alerts')).toThrow(
      /Content type "kb": alerts\.NOTE/,
    );
  });
});

describe("inlineText", () => {
  it("flattens nested inline nodes to their text", () => {
    expect(
      inlineText([
        { type: "text", value: "a " },
        { children: [{ type: "text", value: "b" }], type: "strong" },
        { type: "break" },
        { type: "inlineCode", value: " c" },
      ]),
    ).toBe("a b c");
  });
});
