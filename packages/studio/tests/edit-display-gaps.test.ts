/** Gap coverage for src/utils/edit-display.ts — edit-mode display transforms. */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  BOUND_FIELD_ATTR,
  COMPUTED_LIST_LABEL,
  computeEmptyPlaceholderClass,
  CUSTOM_TAG_LABEL,
  describeTag,
  editModeStyle,
  EMPTY_PLACEHOLDER_CLASSES,
  isRowBound,
  isTextRun,
  liveEditProp,
  prepareForEditMode,
  prepareTextMember,
  sampleRowAt,
  tagMarkOf,
} from "../src/utils/edit-display";
import { makeStamper } from "../src/canvas/iframe-render";
import { renderNode } from "@jxsuite/runtime";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JsonValue, JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** A property an element was given, read as the instance would read it. */
function propertyOf(el: Element | null, key: string): string {
  if (!el) {
    return "<no element>";
  }
  /* SAFETY: an element is an ordinary extensible object; the runtime writes each `$props` value
     onto it as a property, and a key it did not write reads undefined. */
  const props = el as Element & Record<string, JsonValue | undefined>;
  return String(props[key]);
}

/**
 * Prepare a node-shaped value. The input is any document value because several fixtures are
 * deliberately malformed (a lone object as `children`, a `null` style); the output of an object
 * input is always an object, which the guard checks rather than assumes.
 */
function prep(node: JxDocumentValue): JxMutableNode {
  const out = prepareForEditMode(node);
  if (!isNodeObject(out)) {
    throw new Error("prepareForEditMode returned a non-node for a node input");
  }
  return out;
}

/** The element children of a prepared node; none of these fixtures hold text children. */
function elementChildren(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !children.every((child) => isNodeObject(child))) {
    throw new Error("expected an array of element children");
  }
  return children;
}

/** Prepare `node` and render it as the canvas frame does, stamper included. */
function draw(node: JxDocumentValue, scope: JxScope = {}): HTMLElement {
  const el = renderNode(prep(node), scope, {
    _path: [],
    onNodeCreated: makeStamper({
      arrayPaths: new Set(),
      canvasMode: "edit",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    }),
  });
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return el;
}

/** What each chip under `el` stands for and shows: `[source, label, kind, text]`. */
function chipsOf(el: Element): string[][] {
  return [...el.querySelectorAll<HTMLElement>("data[data-jx-tag]")].map((chip) => [
    chip.dataset.jxTag ?? "",
    chip.dataset.jxTagLabel ?? "",
    chip.dataset.jxTagKind ?? "",
    chip.textContent,
  ]);
}

// ─── computeEmptyPlaceholderClass ─────────────────────────────────────────────

describe("computeEmptyPlaceholderClass", () => {
  test("empty text tag gets text placeholder", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "p" })).toBe("empty-text-placeholder");
  });

  test("empty container tag gets container placeholder", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "section" })).toBe(
      "empty-container-placeholder",
    );
  });

  test("returns null without tagName", () => {
    expect(computeEmptyPlaceholderClass({})).toBeNull();
  });

  test("returns null when textContent present", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "p", textContent: "hi" })).toBeNull();
  });

  test("returns null when innerHTML present", () => {
    expect(computeEmptyPlaceholderClass({ innerHTML: "<b>x</b>", tagName: "p" })).toBeNull();
  });

  test("returns null when children non-empty", () => {
    expect(
      computeEmptyPlaceholderClass({
        children: [{ tagName: "span" }],
        tagName: "div",
      }),
    ).toBeNull();
  });

  test("empty children array still counts as empty", () => {
    expect(computeEmptyPlaceholderClass({ children: [], tagName: "div" })).toBe(
      "empty-container-placeholder",
    );
  });

  test("non-text non-container tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "img" })).toBeNull();
  });

  test("layout-originated empty text tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ $__layout: true, tagName: "span" })).toBeNull();
  });

  test("layout-originated empty container tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ $__layout: true, tagName: "div" })).toBeNull();
  });

  test("exported placeholder class list matches the two classes", () => {
    expect([...EMPTY_PLACEHOLDER_CLASSES]).toEqual([
      "empty-text-placeholder",
      "empty-container-placeholder",
    ]);
  });
});

// ─── templateToEditDisplay / restoreTemplateExpressions ──────────────────────

// ─── Bound text: runs and chips ───────────────────────────────────────────────

describe("prepareForEditMode bound text", () => {
  test("a templated textContent is its literal runs and one chip per expression", () => {
    const out = prep({ tagName: "p", textContent: "By ${state.author} on ${state.date}" });
    expect(out.textContent).toBeUndefined();
    const runs = Array.isArray(out.children) ? out.children : [];
    expect(runs.map((run) => (isString(run) ? run : tagMarkOf(run)?.source))).toEqual([
      "By ",
      "${state.author}",
      " on ",
      "${state.date}",
    ]);
  });

  test("the canvas draws the value, and the chip carries the expression, its name and its kind", () => {
    const el = draw(
      { tagName: "p", textContent: "By ${state.author} on ${state.fmt(state.date)}" },
      { author: "Ada", date: "2026", fmt: (value: string) => `<${value}>` },
    );
    expect(el.textContent).toBe("By Ada on <2026>");
    expect(chipsOf(el)).toEqual([
      ["${state.author}", "Author", "field", "Ada"],
      ["${state.fmt(state.date)}", "Date", "format", "<2026>"],
    ]);
    for (const chip of el.querySelectorAll("data[data-jx-tag]")) {
      expect(chip.matches('[contenteditable="false"]:not([data-jx-path])')).toBe(true);
    }
    expect(el.dataset.jxPath).toBe("[]");
  });

  test("no raw expression is drawn for a parseable or an unparseable one", () => {
    const el = draw(
      {
        tagName: "p",
        textContent: "${state.n > 1 ? `${state.n} items` : 'one'} ${state.missing.deep}",
      },
      { n: 3 },
    );
    expect(el.textContent).toBe("3 items ");
    expect(el.textContent).not.toContain("${");
    expect(el.textContent).not.toContain("\u276A");
    expect(chipsOf(el).map(([, label, kind]) => [label, kind])).toEqual([
      [CUSTOM_TAG_LABEL, "custom"],
      ["Deep", "field"],
    ]);
  });

  test("describeTag names a path, a formula and anything else", () => {
    expect(describeTag("$map.item.data.featuredImage")).toEqual({
      kind: "field",
      label: "Featured image",
    });
    expect(describeTag("state.formatDate(item.data.date, 'long')")).toEqual({
      kind: "format",
      label: "Date",
    });
    expect(describeTag("a ? b : c")).toEqual({ kind: "custom", label: CUSTOM_TAG_LABEL });
  });

  test("a literal run that holds an escape is evaluated inside a chip of its own", () => {
    // `\n` is an escape in a template string; left as text it would be drawn as a backslash and an n.
    const el = draw({ tagName: "p", textContent: "a\\nb ${state.x}" }, { x: "X" });
    expect(el.textContent).toBe("a\nb X");
    expect(chipsOf(el)[0]).toEqual([String.raw`a\nb `, "Escaped text", "custom", "a\nb "]);
  });

  test("a `${` nothing closes is kept verbatim in a chip, whatever it draws", () => {
    const out = prep({ tagName: "p", textContent: "cost ${ 5" });
    const [only] = Array.isArray(out.children) ? out.children : [];
    expect(tagMarkOf(only)?.source).toBe("cost ${ 5");
  });

  test("a { $ref } text is one chip of kind ref, and its block is closed to the caret", () => {
    const el = draw(
      { tagName: "p", textContent: { $ref: "#/state/pageTitle" } },
      { pageTitle: "Home" },
    );
    expect(el.textContent).toBe("Home");
    expect(chipsOf(el)).toEqual([['${state?.["pageTitle"]}', "Page title", "ref", "Home"]]);
    expect(el.getAttribute("contenteditable")).toBe("false");
  });

  test("a pointer no template reaches keeps its $ref inside the chip", () => {
    const out = prep({ tagName: "p", textContent: { $ref: "window#/title" } });
    const [chip] = elementChildren(out);
    expect(tagMarkOf(chip)).toEqual({
      kind: "ref",
      label: "Title",
      ref: "window#/title",
      source: "window#/title",
    });
    expect(chip!.textContent).toEqual({ $ref: "window#/title" });
    const [rootRef] = elementChildren(prep({ tagName: "p", textContent: { $ref: "#/" } }));
    expect(tagMarkOf(rootRef)?.label).toBe("Reference");
  });

  test("a row pointer text resolves against the sample row", () => {
    const el = draw(
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { tagName: "li", textContent: { $ref: "$map/item/t" } },
          },
        ],
        tagName: "ul",
      },
      { rows: [{ t: "First" }, { t: "Second" }] },
    );
    expect(el.querySelector("li")?.textContent).toBe("First");
  });

  test("text beside children stays a property, live, and closes its block", () => {
    const out = prep({
      children: [{ tagName: "em", textContent: "x" }],
      tagName: "p",
      textContent: "${state.title}",
    });
    // Parenthesised, so the runtime does not take a bare state path for a component's prop binding.
    expect(out.textContent).toBe("${(state.title)}");
    expect(out.attributes).toMatchObject({ contenteditable: "false" });
    expect(elementChildren(out)).toHaveLength(1);
    const ref = prep({
      children: [{ tagName: "em", textContent: "x" }],
      tagName: "p",
      textContent: { $ref: "#/state/title" },
    });
    expect(ref.textContent).toEqual({ $ref: "#/state/title" });
    expect(ref.attributes).toMatchObject({ contenteditable: "false" });
  });

  test("an entry field the author types in place keeps its text live, with no chip", () => {
    const out = prep({
      attributes: { "data-jx-entry-field": "title" },
      tagName: "h1",
      textContent: "${state.entry.data.title}",
    });
    expect(out.textContent).toBe("${state.entry.data.title}");
    expect(out.children).toBeUndefined();
  });
});

describe("prepareForEditMode string members of children", () => {
  test("a plain member is itself, a whole-template member one chip", () => {
    expect(prepareTextMember("plain")).toBe("plain");
    const chip = prepareTextMember("${state.name}");
    // Marked as a member: where the chip stands in the document is part of what it stands for.
    expect(tagMarkOf(chip)).toEqual({
      kind: "field",
      label: "Name",
      member: true,
      source: "${state.name}",
    });
  });

  test("any other templated member is ONE element, so sibling indices hold", () => {
    const out = prep({
      children: ["Hello ${state.name}!", { tagName: "em", textContent: "x" }],
      tagName: "p",
    });
    const children = Array.isArray(out.children) ? out.children : [];
    expect(children).toHaveLength(2);
    expect(isTextRun(children[0])).toBe(true);
    const el = draw(
      { children: ["Hello ${state.name}!", { tagName: "em", textContent: "x" }], tagName: "p" },
      { name: "Ada" },
    );
    expect(el.childNodes).toHaveLength(2);
    expect(el.textContent).toBe("Hello Ada!x");
    const run = el.firstElementChild;
    expect(run?.matches("data[data-jx-text]:not([data-jx-path])")).toBe(true);
    // The sibling keeps the path its document index gives it.
    expect(el.querySelector("em")?.dataset.jxPath).toBe('["children",1]');
  });

  test("a member that resolves to an array is spliced inside its chip, unstamped", () => {
    const el = draw(
      { children: ["${state.list}", { tagName: "p", textContent: "after" }], tagName: "div" },
      {
        list: [
          { tagName: "li", textContent: "one" },
          { tagName: "li", textContent: "two" },
        ],
      },
    );
    const chip = el.querySelector("data[data-jx-tag]");
    expect(chip?.querySelectorAll("li")).toHaveLength(2);
    expect(el.querySelectorAll("li[data-jx-path]")).toHaveLength(0);
    expect(el.querySelector("p")?.dataset.jxPath).toBe('["children",1]');
  });
});

// ─── Row-bound values ─────────────────────────────────────────────────────────

describe("prepareForEditMode row-bound values", () => {
  /* The converted site's premium badge: hidden unless the row says otherwise. */
  const HIDDEN =
    "${!(((v) => !!v && v != '0' && !(Array.isArray(v) && !v.length))($map.item.data.premium))}";

  /** A one-template repeater over `state.rows`. */
  const repeater = (map: JxMutableNode): JxMutableNode => ({
    children: [{ $prototype: "Array", items: { $ref: "#/state/rows" }, map }],
    tagName: "section",
  });

  test("text, attributes, src and style resolve against the repeater's first item", () => {
    const el = draw(
      repeater({
        attributes: { "data-slug": "${item.slug}", title: { $ref: "$map/item/title" } },
        children: [
          { tagName: "h3", textContent: "${$map.item.title}" },
          { attributes: { alt: "${item.title}" }, src: "${item.image}", tagName: "img" },
        ],
        className: "card ${item.kind}",
        style: { color: "${item.color}" },
        tagName: "article",
      }),
      { rows: [{ color: "red", image: "/a.jpg", kind: "wide", slug: "a", title: "Alpha" }, {}] },
    );
    const card = el.querySelector("article");
    expect(card?.dataset.slug).toBe("a");
    expect(card?.getAttribute("title")).toBe("Alpha");
    expect(card?.className).toBe("card wide");
    expect(el.querySelector("h3")?.textContent).toBe("Alpha");
    const img = el.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Alpha");
    expect(img?.getAttribute("src")).toBe("/a.jpg");
    // A bound src is not a missing one: no placeholder is drawn for it.
    expect(img?.classList.contains("empty-media-placeholder")).toBe(false);
    expect(card?.getAttribute("style") ?? "").toContain("red");
  });

  test("a row-bound hidden follows the row, and a failing one is removed, not stuck", () => {
    const badge = { attributes: { hidden: HIDDEN }, tagName: "span", textContent: "Premium" };
    const shown = draw(repeater(badge), { rows: [{ data: { premium: "1" } }] });
    expect(shown.querySelector("span")?.hasAttribute("hidden")).toBe(false);
    const hidden = draw(repeater(badge), { rows: [{ data: { premium: "0" } }] });
    expect(hidden.querySelector("span")?.hasAttribute("hidden")).toBe(true);
    // No row to read: the binding throws, yields null, and the attribute comes off.
    const empty = draw(repeater(badge), { rows: [] });
    expect(empty.querySelector("span")?.hasAttribute("hidden")).toBe(false);
    const outside = draw(badge);
    expect(outside.hasAttribute("hidden")).toBe(false);
  });

  test("the same binding written as a property is empty when it fails", () => {
    const out = prep({ hidden: HIDDEN, tagName: "span", textContent: "Premium" });
    expect(isRowBound(out.hidden)).toBe(false);
    expect(out.hidden).toContain("catch");
    expect(draw({ hidden: HIDDEN, tagName: "span", textContent: "Premium" }).hidden).toBe(false);
  });

  test("with no sample row a row-bound chip is empty and still names its tag", () => {
    const el = draw({ tagName: "p", textContent: "${item.data.title}" });
    expect(chipsOf(el)).toEqual([["${item.data.title}", "Title", "field", ""]]);
    const empty = draw(repeater({ tagName: "p", textContent: "${item.data.title}" }), { rows: [] });
    expect(chipsOf(empty)).toEqual([["${item.data.title}", "Title", "field", ""]]);
  });

  test("a row pointer attribute resolves against the row, and is left off with none", () => {
    const node: JxMutableNode = {
      attributes: { "data-a": { $ref: "$map/item/a" } },
      "data-b": { $ref: "$map/item/b" },
      tagName: "div",
      textContent: "x",
    };
    const rowless = prep(node);
    expect(rowless.attributes).not.toHaveProperty("data-a");
    expect(isString(rowless["data-b"])).toBe(true);
    const inRow = prepareForEditMode(node, "state.rows?.[0]");
    expect(isString(inRow.attributes?.["data-a"])).toBe(true);
  });

  test("a hidden that does not read the row stays live, and a literal one is the author's", () => {
    const out = prep({
      attributes: { hidden: "${state.closed}" },
      hidden: "${state.closed}",
      tagName: "div",
      textContent: "x",
    });
    expect(out.attributes).toMatchObject({ hidden: "${state.closed}" });
    expect(out.hidden).toBe("${state.closed}");
    const literal = prep({ attributes: { hidden: "" }, tagName: "div", textContent: "x" });
    expect(literal.attributes).toEqual({ hidden: "" });
  });

  test("preparing a prepared tree changes nothing", () => {
    const doc = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            $props: { title: "${item.t}" },
            attributes: { hidden: "${!item.t}" },
            children: ["${item.t} and ${state.x}", { tagName: "p", textContent: "${item.t}" }],
            style: { color: "${item.c}" },
            tagName: "x-row",
          },
        },
        { children: "${state.list}", tagName: "ul" },
        { children: [{ tagName: "b" }], tagName: "p", textContent: "${state.x}" },
        { tagName: "span" },
        { innerHTML: "${state.html}", tagName: "div" },
      ],
      tagName: "main",
    };
    const once = prep(doc);
    expect(prep(once)).toEqual(once);
  });
});

// ─── prepareForEditMode ───────────────────────────────────────────────────────

describe("prepareForEditMode basics", () => {
  test("returns primitives unchanged", () => {
    expect(prepareForEditMode("text")).toBe("text");
    expect(prepareForEditMode(null)).toBeNull();
  });

  test("maps arrays element-wise", () => {
    const out = prepareForEditMode([{ tagName: "p", textContent: "plain" }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toMatchObject([{ textContent: "plain" }]);
  });

  test("preserves state, $media and $elements untouched", () => {
    const state = { count: { default: 1 } };
    const $media = { md: "(min-width: 768px)" };
    const $elements = { "x-c": "./x.json" };
    const out = prep({ $elements, $media, state, tagName: "div", textContent: "x" });
    expect(out.state).toBe(state);
    expect(out.$media).toBe($media);
    // The fixture's `$elements` is deliberately not the declared array form: pass-through is blind to shape.
    expect<JxDocumentValue | undefined>(out.$elements).toBe($elements);
  });

  test("bound url properties render live, since the canvas de-links what they point at", () => {
    const a = prep({ href: "${state.url}", tagName: "a", textContent: "go" });
    expect(a.href).toBe("${state.url}");
    const form = prep({ action: "${state.ep}", tagName: "form", textContent: "f" });
    expect(form.action).toBe("${state.ep}");
  });

  test("a bound className renders live, and one that reads the row is resolved against it", () => {
    const div = (className: string) => prep({ children: ["x"], className, tagName: "div" });
    expect(div("${state.cls}").className).toBe("${state.cls}");
    expect(div("${item.cls}").className).toContain("item.cls");
    expect(isRowBound(div("${item.cls}").className)).toBe(false);
  });

  test("a block with any bound property is named for what it draws", () => {
    const named = (node: JxDocumentValue) => prep(node).attributes?.[BOUND_FIELD_ATTR];
    expect(named({ tagName: "p", textContent: "${state.title} by ${state.author}" })).toBe(
      "Title \u00B7 Author",
    );
    expect(named({ src: "${item.data.featuredImage}", tagName: "img" })).toBe("Featured image");
    expect(named({ children: "${state.entry.$children ?? []}", tagName: "div" })).toBe(
      COMPUTED_LIST_LABEL,
    );
    expect(named({ tagName: "p", textContent: { $ref: "#/state/heading" } })).toBe("Heading");
    expect(
      named({
        $props: { a: "${state.one}" },
        attributes: { b: "${state.two}" },
        children: ["${state.three}", { tagName: "b" }],
        style: { color: "${state.four}" },
        tagName: "x-card",
        title: "${state.five}",
      }),
    ).toBe("One \u00B7 Two \u00B7 Three +2");
    expect(named({ tagName: "p", textContent: "plain" })).toBeUndefined();
    // A name is not repeated, and an unparseable expression is named as one.
    expect(named({ tagName: "p", textContent: "${state.a} ${state.a} ${1 + 1}" })).toBe(
      `A \u00B7 ${CUSTOM_TAG_LABEL}`,
    );
  });
});

describe("prepareForEditMode $props", () => {
  test("a bound prop stays a live binding; a ref passes through; url props blank", () => {
    const out = prep({
      $props: {
        href: "${s}",
        label: "${t}",
        link: { $ref: "#/state/url" },
        other: { $ref: "raw.path" },
        plain: 5,
        row: { $ref: "$map/item/t" },
      },
      tagName: "x-card",
    });
    /* A component's inputs render live: a header's variant shown as `❪ state.variant ❫` reached the
       component as that literal text and matched none of its styles. A row pointer outside any
       repeater has no row to read, so the component keeps its default. */
    expect(out.$props).toEqual({
      href: "${s}",
      label: "${t}",
      link: { $ref: "#/state/url" },
      other: { $ref: "raw.path" },
      plain: 5,
    });
  });

  test("a component in a repeater is drawn with the repeater's first item", () => {
    const out = prep({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            $props: {
              count: "${index + 1}",
              label: "${item.t} (${$page.locale})",
              locale: "${$page.locale}",
              title: { $ref: "$map/item/t" },
            },
            tagName: "x-row",
          },
        },
      ],
      tagName: "section",
    });
    const scope: JxScope = { $page: { locale: "fr" }, rows: [{ t: "Harbour" }, { t: "Crane" }] };
    const host = renderNode(out, scope);
    const row = host instanceof HTMLElement ? host.querySelector("x-row") : null;
    expect(row).not.toBeNull();
    expect(propertyOf(row, "title")).toBe("Harbour");
    expect(propertyOf(row, "locale")).toBe("fr");
    expect(propertyOf(row, "label")).toBe("Harbour (fr)");
    expect(propertyOf(row, "count")).toBe("1");
  });

  test("an empty or unreadable list gives the instance empty values, not a thrown binding", () => {
    const out = prep({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { $props: { title: "${item.data.title}" }, tagName: "x-row" },
        },
        {
          $prototype: "Array",
          items: { $ref: "window#/rows" },
          map: { $props: { title: "${item.data.title}" }, tagName: "x-other" },
        },
      ],
      tagName: "section",
    });
    const host = renderNode(out, { rows: [] });
    const rows = host instanceof HTMLElement ? [...host.querySelectorAll("x-row, x-other")] : [];
    expect(rows.map((row) => propertyOf(row, "title"))).toEqual(["", ""]);
  });

  test("a literal list, a template list and a nested list each give a sample row", () => {
    const out = prep({
      children: [
        {
          $prototype: "Array",
          items: [{ groups: [{ name: "inner" }], t: "literal" }],
          map: {
            children: [
              {
                $prototype: "Array",
                items: { $ref: "$map/item/groups" },
                map: { $props: { name: "${item.name}" }, tagName: "x-inner" },
              },
            ],
            $props: { title: "${item.t}" },
            tagName: "x-outer",
          },
        },
        {
          $prototype: "Array",
          items: "${state.rows}",
          map: { $props: { title: "${item.t}" }, tagName: "x-templated" },
        },
      ],
      tagName: "section",
    });
    const host = renderNode(out, { rows: [{ t: "templated" }] });
    const at = (sel: string) => (host instanceof HTMLElement ? host.querySelector(sel) : null);
    expect(propertyOf(at("x-outer"), "title")).toBe("literal");
    expect(propertyOf(at("x-inner"), "name")).toBe("inner");
    expect(propertyOf(at("x-templated"), "title")).toBe("templated");
  });

  test("sampleRowAt gives a subtree under a repeater the row the full render used", () => {
    const doc: JxMutableNode = {
      children: [{ $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: "li" } }],
      tagName: "ul",
    };
    expect(sampleRowAt(doc, ["children", 0, "map"])).toContain('state?.["rows"]');
    expect(sampleRowAt(doc, ["children", 0])).toBeNull();
    expect(sampleRowAt(doc, ["children", 5, "map"])).toBeNull();
    expect(liveEditProp("plain text")).toBe("plain text");
    // An unterminated `${` is left as written rather than cut short.
    expect(liveEditProp("a ${b")).toBe("a ${b");
  });

  test("props that read the repeater row are bindings resolved against it, link and image included", () => {
    const out = prep({
      $props: {
        featuredImage: "${state.x}",
        heroBg: "${item.bg}",
        href: "${item.h}",
        row: { $ref: "$map/item/t" },
        title: "${item.t}",
      },
      tagName: "eer-category",
    });
    // One that reads the page's state is live like any other.
    expect(out.$props?.featuredImage).toBe("${state.x}");
    // A row pointer with no row to read is dropped: the component keeps its default.
    expect(out.$props).not.toHaveProperty("row");
    for (const key of ["heroBg", "href", "title"]) {
      expect(isRowBound(out.$props?.[key])).toBe(false);
      expect(out.$props?.[key]).toContain("catch");
    }
  });

  test("a static (non-template) image prop is left untouched", () => {
    const out = prep({ $props: { image: "/photo.png" }, tagName: "eer-category" });
    expect(out.$props?.image).toBe("/photo.png");
  });
});

/*
 * Computed children render live, as the build renders them. The nodes are not the document's, so
 * the element that hosts them is closed to the caret and nothing under it is stamped.
 */
describe("prepareForEditMode computed children", () => {
  test("the binding reaches the runtime, and the host is closed to the caret", () => {
    const out = prepareForEditMode({ children: "${state.entry.$children ?? []}", tagName: "div" });
    expect(out.children).toBe("${state.entry.$children ?? []}");
    expect(out.textContent).toBeUndefined();
    expect(out.attributes).toMatchObject({ contenteditable: "false" });
    expect(out.className).toBeUndefined();
  });

  test("the list is drawn as elements, unstamped, and keeps the host's own attributes", () => {
    const el = draw(
      { attributes: { title: "Bio" }, children: "${state.body}", tagName: "div" },
      {
        body: [
          { tagName: "p", textContent: "one" },
          { tagName: "p", textContent: "two" },
        ],
      },
    );
    expect([...el.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["one", "two"]);
    expect(el.querySelectorAll("p[data-jx-path]")).toHaveLength(0);
    expect(el.getAttribute("title")).toBe("Bio");
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.dataset.jxPath).toBe("[]");
  });

  test("inside a repeater it reads the sample row, and draws nothing when that fails", () => {
    const doc = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/team" },
          map: { children: "${item.$children ?? []}", tagName: "div" },
        },
      ],
      tagName: "section",
    };
    const el = draw(doc, { team: [{ $children: [{ tagName: "b", textContent: "bio" }] }] });
    expect(el.querySelector("b")?.textContent).toBe("bio");
    expect(draw(doc, { team: [] }).querySelector("b")).toBeNull();
  });

  test("a plain string in `children` is not a binding, and is left as it was", () => {
    // `prep` takes any document value, because a hand-edited document can be outside the node type.
    const out: { children?: unknown; textContent?: unknown } = prep({
      children: "text",
      tagName: "div",
    });
    expect(out.children).toBe("text");
    expect(out.textContent).toBeUndefined();
  });

  test("a node holding a template is not empty, so the patcher gives it no placeholder", () => {
    expect(
      computeEmptyPlaceholderClass({ children: "${item.$children}", tagName: "div" }),
    ).toBeNull();
  });
});

describe("prepareForEditMode innerHTML", () => {
  test("bound markup renders live and its host is closed to the caret", () => {
    const el = draw({ innerHTML: "<b>${state.word}</b>", tagName: "div" }, { word: "bold" });
    expect(el.querySelector("b")?.textContent).toBe("bold");
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.querySelector("b")?.matches("[data-jx-path]")).toBe(false);
  });

  test("row-bound markup reads the sample row; a pointer passes through; literal markup is open", () => {
    const row = prep({ innerHTML: "${item.html}", tagName: "div" });
    expect(isRowBound(row.innerHTML)).toBe(false);
    expect(row.innerHTML).toContain("catch");
    const ref = prep({ innerHTML: { $ref: "#/state/html" }, tagName: "div" });
    expect<JxDocumentValue | undefined>(ref.innerHTML).toEqual({ $ref: "#/state/html" });
    expect(ref.attributes).toMatchObject({ contenteditable: "false" });
    expect(prep({ innerHTML: "<i>x</i>", tagName: "div" }).attributes).toBeUndefined();
  });
});

describe("prepareForEditMode children", () => {
  test("recurses into array children", () => {
    const out = prep({
      children: [{ tagName: "p", textContent: "${a}" }],
      tagName: "div",
    });
    const [paragraph] = elementChildren(out);
    expect(tagMarkOf(elementChildren(paragraph)[0])?.source).toBe("${a}");
  });

  test("wraps mapped-array children in a repeater perimeter", () => {
    const out = prep({
      children: {
        $prototype: "Array",
        map: { tagName: "li", textContent: "plain" },
      },
      tagName: "ul",
    });
    expect(out.children).toHaveLength(1);
    expect(elementChildren(out)[0]!.className).toBe("repeater-perimeter");
    expect(elementChildren(out)[0]!.tagName).toBe("div");
    expect(elementChildren(elementChildren(out)[0])[0]!.textContent).toBe("plain");
  });

  test("mapped-array children without a template still emit one (empty) perimeter", () => {
    // One DOM node per array keeps the 1:1 sibling-index correspondence the patcher relies on.
    const out = prep({
      children: { $prototype: "Array" },
      tagName: "ul",
    });
    expect(out.children).toHaveLength(1);
    expect(elementChildren(out)[0]!.className).toBe("repeater-perimeter");
    expect(elementChildren(elementChildren(out)[0])).toEqual([]);
  });

  test("array pseudo-element among siblings becomes one perimeter in place", () => {
    const out = prep({
      children: [
        { tagName: "li", textContent: "header" },
        { $prototype: "Array", map: { tagName: "li", textContent: "row" } },
        { tagName: "li", textContent: "footer" },
      ],
      tagName: "ul",
    });
    expect(out.children).toHaveLength(3);
    expect(elementChildren(out)[0]!.textContent).toBe("header");
    expect(elementChildren(out)[1]!.className).toBe("repeater-perimeter");
    expect(elementChildren(elementChildren(out)[1])[0]!.textContent).toBe("row");
    expect(elementChildren(out)[2]!.textContent).toBe("footer");
  });

  test("single object children recurse", () => {
    const out = prep({
      children: { className: "${state.c}", tagName: "span", textContent: "x" },
      tagName: "div",
    });
    expect(out.children).toMatchObject({ className: "${state.c}", textContent: "x" });
  });
});

describe("prepareForEditMode $switch cases", () => {
  test("the discriminant and every case reach the runtime, each case prepared", () => {
    const out = prep({
      $switch: { $ref: "#/state/mode" },
      cases: {
        edit: { tagName: "section", textContent: "Editing ${state.name}" },
        remote: { $ref: "./remote.json" },
        view: { tagName: "p", textContent: "View" },
      },
      tagName: "div",
    });
    expect(out.$switch).toEqual({ $ref: "#/state/mode" });
    expect(out.children).toBeUndefined();
    const cases = out.cases ?? {};
    expect(Object.keys(cases)).toEqual(["edit", "remote", "view"]);
    expect(cases.remote).toEqual({ $ref: "./remote.json" });
    const runs = Array.isArray(cases.edit?.children) ? cases.edit.children : [];
    expect(tagMarkOf(runs[1])?.source).toBe("${state.name}");
  });

  test("the live case renders, stamped at its own path under cases", () => {
    const doc = {
      $switch: { $ref: "#/state/mode" },
      cases: {
        edit: {
          children: [{ tagName: "h2", textContent: "Editing ${state.name}" }],
          tagName: "section",
        },
        view: { tagName: "p", textContent: "View" },
      },
      tagName: "div",
    };
    const edit = draw(doc, { mode: "edit", name: "Ada" });
    expect(edit.dataset.jxPath).toBe("[]");
    expect(edit.querySelector("section")?.dataset.jxPath).toBe('["cases","edit"]');
    expect(edit.querySelector("h2")?.dataset.jxPath).toBe('["cases","edit","children",0]');
    expect(edit.querySelector("h2")?.textContent).toBe("Editing Ada");
    const view = draw(doc, { mode: "view" });
    expect(view.querySelector("p")?.dataset.jxPath).toBe('["cases","view"]');
    expect(view.querySelector("section")).toBeNull();
  });

  test("a discriminant no case answers, and an empty cases object, draw the bare container", () => {
    expect(
      draw({ $switch: { $ref: "#/state/mode" }, cases: {}, tagName: "div" }, { mode: "x" })
        .childNodes,
    ).toHaveLength(0);
    // Not a switch at all without a discriminant: `cases` is then an ordinary key.
    const plain: JxDocumentValue = { cases: { a: 1 }, tagName: "div", textContent: "x" };
    expect<JxDocumentValue | undefined>(prep(plain).cases).toEqual({ a: 1 });
  });
});

describe("prepareForEditMode media elements", () => {
  test("an empty src is left as written and gets the media placeholder class", () => {
    const out = prep({ src: "", tagName: "img" });
    expect(out.src).toBe("");
    expect(out.className).toBe("empty-media-placeholder");
  });

  test("a bound src renders live, whether or not it reads the repeater row", () => {
    expect(prep({ src: "${state.url}", tagName: "video" }).src).toBe("${state.url}");
    const cover = prep({ src: { $ref: "#/state/cover" }, tagName: "img" });
    expect(cover.src).toEqual({ $ref: "#/state/cover" });
    expect(cover.className).toBeUndefined();
    const row = prep({ src: "${item.src}", tagName: "img" });
    expect(row.src).toContain("item.src");
    expect(row.className).toBeUndefined();
  });

  test("media element with no src at all gets placeholder class", () => {
    const out = prep({ tagName: "img" });
    expect(out.className).toBe("empty-media-placeholder");
  });

  test("media element with a real src keeps it and gets no placeholder", () => {
    const out = prep({ src: "/photo.png", tagName: "img" });
    expect(out.src).toBe("/photo.png");
    expect(out.className).toBeUndefined();
  });

  test("poster in attributes counts as resolvable media source", () => {
    const out = prep({ attributes: { poster: "/poster.jpg" }, tagName: "video" });
    expect(out.attributes?.poster).toBe("/poster.jpg");
    expect(out.className).toBeUndefined();
  });

  test("attributes: bindings render live, and row bindings resolve against the row", () => {
    const out = prep({
      attributes: {
        alt: { $ref: "#/state/altText" },
        "data-cap": "${item.caption}",
        src: "${state.url}",
      },
      tagName: "img",
    });
    expect(out.attributes?.src).toBe("${state.url}");
    expect(out.attributes?.alt).toEqual({ $ref: "#/state/altText" });
    // No row to read it against: left off, not evaluated to whatever no row makes it.
    expect(out.attributes).not.toHaveProperty("data-cap");
    expect(out.className).toBeUndefined();
    const row = prepareForEditMode(
      { attributes: { src: "${item.src}" }, tagName: "img" },
      "state.rows?.[0]",
    );
    expect(row.attributes?.src).toContain("item.src");
    expect(row.className).toBeUndefined();
  });

  test("attributes: an empty src is a missing one", () => {
    const out = prep({ attributes: { src: "" }, tagName: "img" });
    expect(out.attributes?.src).toBe("");
    expect(out.className).toBe("empty-media-placeholder");
  });

  test("does not duplicate the media placeholder class", () => {
    const out = prep({ className: "empty-media-placeholder", src: "", tagName: "img" });
    expect(out.className).toBe("empty-media-placeholder");
  });
});

describe("prepareForEditMode style handling", () => {
  test("bound declarations are live; one that reads the row is dropped only when there is no row", () => {
    /* Dropped, not blanked to `""`: `width: ` is a malformed declaration in a rule, and omitting it
       lets the cascade answer. */
    const style = {
      "&:hover": { color: "${item.hover}", opacity: "1" },
      color: "red",
      height: "${item.h}px",
      margin: { $ref: "$map/item/m" },
      width: "${state.w}px",
    };
    const out = prep({ style, tagName: "div", textContent: "x" });
    expect(out.style).toEqual({ "&:hover": { opacity: "1" }, color: "red", width: "${state.w}px" });
    const inRow = editModeStyle(style, "state.rows[0]");
    if (!isNodeObject(inRow)) {
      throw new TypeError("expected a style object");
    }
    expect(Object.keys(inRow).toSorted()).toEqual([
      "&:hover",
      "color",
      "height",
      "margin",
      "width",
    ]);
    expect(inRow.height).toContain("state.rows[0]");
    expect(inRow.margin).toContain("state.rows[0]");
    // A row pointer no template reaches has nothing to resolve against, row or not.
    expect(editModeStyle({ gap: { $ref: "$map/~1/x" }, top: { $ref: "#/state/t" } }, "r")).toEqual({
      gap: expect.stringContaining("catch"),
      top: { $ref: "#/state/t" },
    });
  });

  test("non-object style passes through", () => {
    const out = prep({ style: null, tagName: "div", textContent: "x" });
    expect(out.style).toBeNull();
    expect(editModeStyle(undefined, null)).toBeUndefined();
  });
});

describe("prepareForEditMode empty placeholders", () => {
  test("empty text tag gains placeholder class merged with existing className", () => {
    const out = prep({ className: "lead", tagName: "p" });
    expect(out.className).toBe("lead empty-text-placeholder");
  });

  test("empty container without className gets bare placeholder class", () => {
    const out = prep({ tagName: "section" });
    expect(out.className).toBe("empty-container-placeholder");
  });

  test("layout-marked empty elements get no placeholder class", () => {
    // Regression: decorative hamburger-bar spans in a page's layout shell rendered
    // Overlapping "Click here to add text..." placeholders.
    const out = prep({
      $__layout: true,
      children: [
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
      ],
      tagName: "button",
    });
    for (const bar of elementChildren(out)) {
      expect(bar.className).toBeUndefined();
      expect(bar.$__layout).toBe(true);
    }
  });

  test("a non-layout empty span gets the text placeholder", () => {
    const out = prep({ tagName: "span" });
    expect(out.className).toBe("empty-text-placeholder");
  });

  test("an empty element whose own style sizes it is a shape, and gets no placeholder", () => {
    // The jxsuite.com home's status dot: the placeholder text drew a one-glyph column over the hero.
    const dot = {
      style: { backgroundColor: "#22c55e", borderRadius: "50%", height: "6px", width: "6px" },
      tagName: "span",
    };
    expect(computeEmptyPlaceholderClass(dot)).toBeNull();
    expect(prep(dot).className).toBeUndefined();
    expect(
      computeEmptyPlaceholderClass({ style: { blockSize: "3px" }, tagName: "div" }),
    ).toBeNull();
    expect(computeEmptyPlaceholderClass({ style: { width: 12 }, tagName: "p" })).toBeNull();
  });

  test("an automatic or responsive-only size still leaves the element a text slot", () => {
    expect(computeEmptyPlaceholderClass({ style: { width: "auto" }, tagName: "p" })).toBe(
      "empty-text-placeholder",
    );
    expect(
      computeEmptyPlaceholderClass({
        style: { "@media (min-width: 40rem)": { width: "50%" } },
        tagName: "section",
      }),
    ).toBe("empty-container-placeholder");
  });
});
