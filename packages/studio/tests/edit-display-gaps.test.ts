/** Gap coverage for src/utils/edit-display.ts — edit-mode display transforms. */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  BOUND_FIELD_ATTR,
  COMPUTED_LIST_LABEL,
  computeEmptyPlaceholderClass,
  CUSTOM_TAG_LABEL,
  describeTag,
  drawsManyNodes,
  EMPTY_PLACEHOLDER_CLASSES,
  isTextRun,
  prepareForEditMode,
  prepareTextMember,
  readableTemplate,
  refLabel,
  rowFieldKey,
  tagMarkOf,
  withTagTitles,
} from "../src/utils/edit-display";
import { makeStamper } from "../src/canvas/iframe-render";
import { renderNode } from "@jxsuite/runtime";
import { parseDynamicTag } from "@jxsuite/schema/dynamic-tag";
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

  test("a schema title names a tag wherever the row field is read, and no other", () => {
    const titles = { index: "Position", "item.data.date": "Post date" };
    const label = (expr: string): string => describeTag(expr, titles).label;
    expect(label("$map.item.data.date ?? ''")).toBe("Post date");
    expect(label("item.data.date")).toBe("Post date");
    expect(label('state.formatDate($map.item.data.date, {"dateStyle":"long"})')).toBe("Post date");
    expect(label("$map.index")).toBe("Position");
    expect(label("index")).toBe("Position");
    // Not the row's: the path names itself.
    expect(label("state.item.data.date")).toBe("Date");
    expect(label("$map.other.date")).toBe("Date");
    expect(label("$map")).toBe("Item");
    expect(label('item["my-field"]')).toBe("My field");
    expect(rowFieldKey(parseDynamicTag('item["my-field"].x')!)).toBe('item["my-field"].x');
    expect(rowFieldKey(parseDynamicTag("item.rows[0]")!)).toBe("item.rows[0]");
    expect(label("a ? b : c")).toBe(CUSTOM_TAG_LABEL);
    // A pointer into the row is named the same way; any other by its last segment.
    expect(refLabel("$map/item/data/date", titles)).toBe("Post date");
    expect(refLabel("#/state/date", titles)).toBe("Date");
    expect(refLabel("window#/location/href", titles)).toBe("Href");
  });

  test("the transform names its chips, and a bound block's own names, by the titles it is given", () => {
    const doc: JxMutableNode = {
      attributes: { title: { $ref: "$map/item/data/date" } },
      tagName: "p",
      textContent: "On ${$map.item.data.date ?? ''}",
    };
    const titled = prepareForEditMode(doc, { "item.data.date": "Post date" });
    const plain = prepareForEditMode(doc);
    const chipLabel = (node: JxMutableNode): string | undefined =>
      (Array.isArray(node.children) ? node.children : [])
        .map((child) => tagMarkOf(child)?.label)
        .find((name) => name !== undefined);
    expect(chipLabel(titled)).toBe("Post date");
    expect(chipLabel(plain)).toBe("Date");
    expect(titled.attributes?.["data-jx-bound-field"]).toBe("Post date");
    // The titles are the walk's own: a walk after it, given none, names by the path again.
    expect(describeTag("item.data.date").label).toBe("Date");
    expect(
      withTagTitles({ "item.data.date": "Inside" }, () => describeTag("item.data.date").label),
    ).toBe("Inside");
    expect(describeTag("item.data.date").label).toBe("Date");
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

  test("a row pointer text resolves against each row's own item", () => {
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
    expect([...el.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["First", "Second"]);
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

  test("text, attributes, src and style resolve in every row against that row's item", () => {
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
      {
        rows: [
          { color: "red", image: "/a.jpg", kind: "wide", slug: "a", title: "Alpha" },
          { color: "blue", image: "/b.jpg", kind: "tall", slug: "b", title: "Beta" },
        ],
      },
    );
    const cards = [...el.querySelectorAll("article")];
    expect(cards.map((card) => card.dataset.slug)).toEqual(["a", "b"]);
    expect(cards.map((card) => card.getAttribute("title"))).toEqual(["Alpha", "Beta"]);
    expect(cards.map((card) => card.className)).toEqual(["card wide", "card tall"]);
    expect([...el.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Alpha", "Beta"]);
    const images = [...el.querySelectorAll("img")];
    expect(images.map((img) => img.getAttribute("alt"))).toEqual(["Alpha", "Beta"]);
    expect(images.map((img) => img.getAttribute("src"))).toEqual(["/a.jpg", "/b.jpg"]);
    // A bound src is not a missing one: no placeholder is drawn for it.
    expect(images.some((img) => img.classList.contains("empty-media-placeholder"))).toBe(false);
    expect(cards[0]?.getAttribute("style") ?? "").toContain("red");
    expect(cards[1]?.getAttribute("style") ?? "").toContain("blue");
  });

  test("a row-bound hidden follows its own row, and a failing one is removed, not stuck", () => {
    const badge = { attributes: { hidden: HIDDEN }, tagName: "span", textContent: "Premium" };
    const el = draw(repeater(badge), {
      rows: [{ data: { premium: "1" } }, { data: { premium: "0" } }, {}],
    });
    // Shown, hidden, and a row whose item has no `data` at all: the binding throws, and the
    // Attribute is left off rather than stuck on.
    expect([...el.querySelectorAll("span")].map((span) => span.hasAttribute("hidden"))).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("a row binding reaches the runtime as written, wherever it is held", () => {
    const node: JxMutableNode = {
      $props: { title: "${item.t}", when: { $ref: "$map/item/date" } },
      attributes: { "data-a": { $ref: "$map/item/a" }, hidden: HIDDEN },
      className: "card ${item.kind}",
      hidden: HIDDEN,
      innerHTML: "${item.html}",
      src: "${item.src}",
      style: { "&:hover": { color: "${item.hover}" }, margin: { $ref: "$map/item/m" } },
      tagName: "x-card",
    };
    const out = prep(node);
    /* Nothing is wrapped, guarded or resolved against a sample: the runtime draws the template once
       per item and each of these reads its own row's scope (studio.md §4.5). */
    for (const key of ["$props", "className", "hidden", "innerHTML", "src", "style"] as const) {
      expect<JxDocumentValue | undefined>(out[key]).toEqual(node[key]);
    }
  });

  test("a row-bound attribute is live in a row and off where there is none", () => {
    const badge = { attributes: { hidden: "${!item?.published}" }, tagName: "span" };
    // `!item?.published` is true with no item at all: outside a repeater the attribute stays off.
    expect(draw(badge).hasAttribute("hidden")).toBe(false);
    const link = { attributes: { "data-href": "/p/${item?.slug}" }, tagName: "a" };
    expect(draw(link).dataset.href).toBeUndefined();
    const pointer = { attributes: { title: { $ref: "$map/item/title" } }, tagName: "i" };
    expect(draw(pointer).hasAttribute("title")).toBe(false);
    const rows = draw(
      repeater({ ...pointer, attributes: { ...pointer.attributes, ...link.attributes } }),
      {
        rows: [{ slug: "a", title: "Alpha" }],
      },
    );
    expect(rows.querySelector("i")?.dataset.href).toBe("/p/a");
    expect(rows.querySelector("i")?.getAttribute("title")).toBe("Alpha");
    // A pointer no template reaches is the runtime's to resolve, as written.
    const odd = prep({ attributes: { "data-x": { $ref: "$map/~1/x" } }, tagName: "i" });
    expect(odd.attributes?.["data-x"]).toEqual(expect.any(String));
  });

  test("a row-bound chip with nothing to read is empty and still names its tag", () => {
    // Outside any repeater there is no row, and a row whose item lacks the field reads nothing.
    const el = draw({ tagName: "p", textContent: "${item.data.title}" });
    expect(chipsOf(el)).toEqual([["${item.data.title}", "Title", "field", ""]]);
    const sparse = draw(repeater({ tagName: "p", textContent: "${item.data.title}" }), {
      rows: [{}, { data: { title: "Set" } }],
    });
    expect(chipsOf(sparse)).toEqual([
      ["${item.data.title}", "Title", "field", ""],
      ["${item.data.title}", "Title", "field", "Set"],
    ]);
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

  test("a bound className renders live, whether it reads the page or the row", () => {
    const div = (className: string) => prep({ children: ["x"], className, tagName: "div" });
    expect(div("${state.cls}").className).toBe("${state.cls}");
    expect(div("${item.cls}").className).toBe("${item.cls}");
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
       component as that literal text and matched none of its styles. A row pointer is the
       runtime's to resolve like the rest, against the row the instance is drawn in. */
    expect(out.$props).toEqual({
      href: "${s}",
      label: "${t}",
      link: { $ref: "#/state/url" },
      other: { $ref: "raw.path" },
      plain: 5,
      row: { $ref: "$map/item/t" },
    });
  });

  test("a component in a repeater is drawn once per item, each with its own row's props", () => {
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
    const rows = host instanceof HTMLElement ? [...host.querySelectorAll("x-row")] : [];
    expect(rows.map((row) => propertyOf(row, "title"))).toEqual(["Harbour", "Crane"]);
    expect(rows.map((row) => propertyOf(row, "locale"))).toEqual(["fr", "fr"]);
    expect(rows.map((row) => propertyOf(row, "label"))).toEqual(["Harbour (fr)", "Crane (fr)"]);
    expect(rows.map((row) => propertyOf(row, "count"))).toEqual(["1", "2"]);
  });

  test("a row whose item lacks what a prop reads leaves the prop unset, not the instance undrawn", () => {
    const out = prep({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { $props: { title: "${item.data.title}" }, tagName: "x-row" },
        },
      ],
      tagName: "section",
    });
    const host = renderNode(out, { rows: [{}, { data: { title: "Set" } }] });
    const rows = host instanceof HTMLElement ? [...host.querySelectorAll("x-row")] : [];
    // The first binding throws on a missing `data` and is survived; the second row is unaffected.
    expect(rows).toHaveLength(2);
    expect(propertyOf(rows[1] ?? null, "title")).toBe("Set");
  });

  test("a literal list and a nested list each draw their rows", () => {
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
      ],
      tagName: "section",
    });
    const host = renderNode(out, {});
    const at = (sel: string) => (host instanceof HTMLElement ? host.querySelector(sel) : null);
    expect(propertyOf(at("x-outer"), "title")).toBe("literal");
    expect(propertyOf(at("x-inner"), "name")).toBe("inner");
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

  test("inside a repeater it reads each row's item, and draws nothing where that has none", () => {
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
    const el = draw(doc, { team: [{ $children: [{ tagName: "b", textContent: "bio" }] }, {}] });
    expect(
      [...el.querySelectorAll("div")].map((row) => row.querySelector("b")?.textContent),
    ).toEqual(["bio", undefined]);
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

  test("row-bound markup and a pointer pass through and close; literal markup is open", () => {
    const row = prep({ innerHTML: "${item.html}", tagName: "div" });
    expect(row.innerHTML).toBe("${item.html}");
    expect(row.attributes).toMatchObject({ contenteditable: "false" });
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

  test("a whole-children repeater passes through with its template prepared", () => {
    const out = prep({
      children: {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: { tagName: "li", textContent: "${item.t}" },
      },
      tagName: "ul",
    });
    const { children } = out;
    if (!isNodeObject(children) || !isNodeObject(children.map)) {
      throw new TypeError("expected the repeater to survive");
    }
    expect(children.$prototype).toBe("Array");
    expect<JxDocumentValue | undefined>(children.items).toEqual({ $ref: "#/state/rows" });
    // The template is prepared as any node is: its bound text is a chip.
    expect(tagMarkOf(elementChildren(children.map)[0])?.source).toBe("${item.t}");
    // A list that draws its rows there is not an empty container.
    expect(out.className).toBeUndefined();
  });

  test("a repeater with no template passes through untouched", () => {
    const out = prep({ children: { $prototype: "Array" }, tagName: "ul" });
    expect<JxDocumentValue | undefined>(out.children).toEqual({ $prototype: "Array" });
  });

  test("a repeater among siblings stays one member at its index", () => {
    const out = prep({
      children: [
        { tagName: "li", textContent: "header" },
        { $prototype: "Array", map: { tagName: "li", textContent: "row" } },
        { tagName: "li", textContent: "footer" },
      ],
      tagName: "ul",
    });
    expect(out.children).toHaveLength(3);
    const [header, repeater, footer] = elementChildren(out);
    expect(header!.textContent).toBe("header");
    expect(repeater!.$prototype).toBe("Array");
    expect(repeater!.tagName).toBeUndefined();
    expect(footer!.textContent).toBe("footer");
  });

  test("drawsManyNodes names the members a child index cannot count past", () => {
    expect(drawsManyNodes({ $prototype: "Array", map: { tagName: "li" } })).toBe(true);
    // A whole `${…}` may splice an array in as nodes; inside a longer string it is text.
    expect(drawsManyNodes("${state.items}")).toBe(true);
    expect(drawsManyNodes("${a ? '}' : b}")).toBe(true);
    expect(drawsManyNodes("Hello ${state.name}")).toBe(false);
    expect(drawsManyNodes("${a}${b}")).toBe(false);
    expect(drawsManyNodes("plain")).toBe(false);
    expect(drawsManyNodes({ tagName: "p" })).toBe(false);
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
    expect(row.src).toBe("${item.src}");
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

  test("attributes: bindings render live, a row binding among them", () => {
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
    // Guarded for the template row, and otherwise the binding itself.
    expect(out.attributes?.["data-cap"]).toContain("(item.caption)");
    expect(out.className).toBeUndefined();
    const row = prep({ attributes: { src: "${item.src}" }, tagName: "img" });
    expect(row.attributes?.src).toContain("(item.src)");
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
  test("every declaration is live, at any depth, whether it reads the page or the row", () => {
    const style = {
      "&:hover": { color: "${item.hover}", opacity: "1" },
      color: "red",
      height: "${item.h}px",
      margin: { $ref: "$map/item/m" },
      width: "${state.w}px",
    };
    const out = prep({ style, tagName: "div", textContent: "x" });
    expect(out.style).toEqual(style);
  });

  test("non-object style passes through", () => {
    const out = prep({ style: null, tagName: "div", textContent: "x" });
    expect(out.style).toBeNull();
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

describe("readableTemplate", () => {
  test("text stays, and each tag is its name in braces: a title where there is one, else the words", () => {
    expect(readableTemplate("Plain")).toBe("Plain");
    expect(readableTemplate("By ${item.data.author} on ${item.data.date}!")).toBe(
      "By {Author} on {Date}!",
    );
    expect(readableTemplate("On ${item.data.date}", { "item.data.date": "Post date" })).toBe(
      "On {Post date}",
    );
    expect(readableTemplate("${(d) => d}")).toBe(`{${CUSTOM_TAG_LABEL}}`);
  });
});
