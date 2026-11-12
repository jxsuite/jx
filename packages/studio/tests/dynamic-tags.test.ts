/**
 * Tests for src/editor/dynamic-tags.ts: where a node's tags are stored, what each control of the
 * tag popover changes in a tag, and what is written back (studio.md §6.9).
 *
 * Pure module, so no harness. Every rewrite is asserted as the exact text stored, because the
 * contract is that an edit changes one tag and nothing beside it.
 */
import { describe, expect, test } from "bun:test";
import { parseDynamicTag, printDynamicTag } from "@jxsuite/schema/dynamic-tag";
import {
  boundTagsOf,
  chipTag,
  fallbackLiteral,
  fallbackText,
  formatAccepts,
  formatCall,
  formatFormulas,
  formatPresets,
  parameterFields,
  pillLabel,
  presetExpression,
  presetOfTag,
  presetsOf,
  propertyLabel,
  refOfTag,
  replaceExpression,
  rewrittenValue,
  sameSlot,
  slotValue,
  sourcePath,
  sourceValue,
  tagAt,
  withFallback,
  withFormat,
  withNegations,
  withParameter,
  withSource,
} from "../src/editor/dynamic-tags";

import type { DynamicTag, DynamicTagPath } from "@jxsuite/schema/dynamic-tag";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { BoundTag, FormatPreset } from "../src/editor/dynamic-tags";

/** A tag read from an expression the test knows is in the grammar. */
function tagOf(expr: string): DynamicTag {
  const tag = parseDynamicTag(expr);
  if (tag === null) {
    throw new TypeError(`not a structured tag: ${expr}`);
  }
  return tag;
}

/** `expr` after one edit, as the text that is stored. */
function edited(expr: string, change: (tag: DynamicTag) => DynamicTag): string {
  const next = change(tagOf(expr));
  return printDynamicTag(next);
}

/** `tag` reading the picked source `value`, as the text that is stored. */
function resourced(tag: DynamicTag, value: string, like: DynamicTagPath | null): string {
  const path = sourcePath(value, like);
  if (path === null) {
    throw new TypeError(`not a source: ${value}`);
  }
  return printDynamicTag(withSource(tag, path));
}

/** The tag of `node` at a slot, which the test knows it holds. */
function boundAt(node: JxMutableNode, slot: (string | number)[], index = 0): BoundTag {
  const bound = tagAt(node, slot, index);
  if (bound === null) {
    throw new TypeError(`no tag at ${JSON.stringify(slot)}#${index}`);
  }
  return bound;
}

/** The preset of `formula` whose arguments print as `args`. */
function presetNamed(presets: readonly FormatPreset[], id: string): FormatPreset {
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset) {
    throw new TypeError(`no preset ${id} among ${presets.map((p) => p.id).join(" ")}`);
  }
  return preset;
}

const DATE = "$map.item.data.date";
const LONG_DATE = `state.formatDate(${DATE}, {"dateStyle":"long"})`;

describe("where a node's tags are stored", () => {
  const node: JxMutableNode = {
    $props: { heading: "${item.data.title}", plain: "Fixed" },
    attributes: { alt: { $ref: "$map/item/data/alt" }, href: "/posts/${item.id}" },
    children: ["By ", "${item.data.author ?? ''}", { tagName: "em", textContent: "${state.x}" }],
    innerHTML: "${state.html}",
    src: "${item.data.image.src}",
    style: { color: "${state.brand}", margin: "0" },
    tagName: "img",
    textContent: "${state.a} and ${state.b}",
  };

  test("an event handler's reference is a function, not a source", () => {
    /* SAFETY: `onclick` is a property any node may carry (spec.md §8.1 lists no closed set of
       event keys); the node type does not name each one. */
    const handlers = {
      attributes: { onfocus: { $ref: "#/state/focus" }, title: { $ref: "#/state/t" } },
      onclick: { $ref: "#/state/go" },
      tagName: "button",
      textContent: "${state.label}",
    } as JxMutableNode;
    expect(boundTagsOf(handlers).map((tag) => tag.slot)).toEqual([
      ["attributes", "title"],
      ["textContent"],
    ]);
    // A property that merely starts with an o is not a handler, and a template is a value.
    /* SAFETY: as above, a property the node type does not name. */
    const other = {
      attributes: { order: { $ref: "#/state/o" } },
      href: { $ref: "#/state/one" },
      onclick: "${state.x}",
      tagName: "div",
    } as JxMutableNode;
    expect(boundTagsOf(other).map((tag) => tag.slot)).toEqual([
      ["attributes", "order"],
      ["href"],
      ["onclick"],
    ]);
  });

  test("one tag per binding of each property kind, named for the property and the value", () => {
    expect(boundTagsOf(node).map((tag) => [tag.slot, tag.index, pillLabel(tag), tag.kind])).toEqual(
      [
        [["$props", "heading"], 0, "Heading: Title", "field"],
        [["attributes", "alt"], 0, "Alt text: Alt", "ref"],
        [["attributes", "href"], 0, "Link: Id", "field"],
        [["children", 1], 0, "Text: Author", "field"],
        [["innerHTML"], 0, "HTML: Html", "field"],
        [["src"], 0, "Image: Src", "field"],
        [["style", "color"], 0, "Color: Brand", "field"],
        [["textContent"], 0, "Text: A", "field"],
        [["textContent"], 1, "Text: B", "field"],
      ],
    );
  });

  test("a descendant's bindings are its own, and a repeater and a plain node have none", () => {
    expect(boundTagsOf({ children: [{ tagName: "p", textContent: "${state.x}" }] })).toEqual([]);
    expect(boundTagsOf({ $prototype: "Array", items: { $ref: "#/state/rows" }, map: {} })).toEqual(
      [],
    );
    expect(boundTagsOf(null)).toEqual([]);
    expect(boundTagsOf({ tagName: "p", textContent: "Hello" })).toEqual([]);
  });

  test("a tag carries what it is stored as, verbatim", () => {
    const text = boundAt(node, ["textContent"], 1);
    expect(text).toMatchObject({
      expr: "state.b",
      form: "template",
      ref: null,
      source: "${state.b}",
      text: true,
    });
    const alt = boundAt(node, ["attributes", "alt"]);
    expect(alt).toMatchObject({
      expr: "$map?.item?.data?.alt",
      form: "ref",
      ref: "$map/item/data/alt",
      source: '{"$ref":"$map/item/data/alt"}',
      text: false,
    });
  });

  test("computed children are one tag over the whole of children", () => {
    const list = boundTagsOf({ children: "${item.$children ?? []}", tagName: "div" });
    expect(list.map((tag) => [tag.slot, tag.property, tag.label])).toEqual([
      [["children"], "Content", "Computed list"],
    ]);
  });

  test("an expression outside the grammar is a Custom expression, and a pointer no template reaches keeps its pointer", () => {
    const custom = boundAt({ textContent: "${a ? b : c}" }, ["textContent"]);
    expect(custom).toMatchObject({ kind: "custom", label: "Custom expression", tag: null });
    const outside = boundAt({ textContent: { $ref: "window#/location/href" } }, ["textContent"]);
    expect(outside).toMatchObject({ expr: null, kind: "ref", label: "Href", tag: null });
  });

  test("a schema title names the tag where the titles hold one", () => {
    const titles = { "item.data.date": "Post date" };
    const [dollar, bare, ref] = boundTagsOf(
      {
        attributes: { title: { $ref: "$map/item/data/date" } },
        children: ["${$map.item.data.date ?? ''}", "${item.data.date}"],
      },
      titles,
    );
    expect([ref?.label, dollar?.label, bare?.label]).toEqual([
      "Post date",
      "Post date",
      "Post date",
    ]);
  });

  test("what a property is called", () => {
    expect(propertyLabel(["src"], "video")).toBe("Video");
    expect(propertyLabel(["src"], "embed")).toBe("Source");
    expect(propertyLabel(["poster"], "video")).toBe("Poster");
    expect(propertyLabel(["attributes", "src"], "img")).toBe("Image");
    expect(propertyLabel(["attributes", "data-post-id"], "div")).toBe("Data post id");
    expect(propertyLabel(["className"], "div")).toBe("Class");
    expect(propertyLabel(["style", "backgroundImage"], "div")).toBe("Background image");
  });

  test("slotValue reads a key path, and nothing where the node has none", () => {
    expect(slotValue(node, ["attributes", "href"])).toBe("/posts/${item.id}");
    expect(slotValue(node, ["children", 1])).toBe("${item.data.author ?? ''}");
    expect(slotValue(node, ["children", "x"])).toBeUndefined();
    expect(slotValue(node, ["style", "color", "deep"])).toBeUndefined();
    expect(slotValue(null, ["src"])).toBeUndefined();
  });

  test("tagAt finds one tag by its place, and sameSlot compares key paths", () => {
    expect(tagAt(node, ["textContent"], 2)).toBeNull();
    expect(tagAt(node, ["attributes", "missing"], 0)).toBeNull();
    expect(sameSlot(["children", 1], ["children", 1])).toBe(true);
    expect(sameSlot(["children", 1], ["children"])).toBe(false);
    expect(sameSlot(["children", 1], ["children", 2])).toBe(false);
  });
});

describe("the tag a pressed chip stands for", () => {
  const node: JxMutableNode = {
    attributes: { title: "${state.x}" },
    children: ["${state.x}", " and ", "${state.x} then ${state.y}"],
  };

  test("the n-th text tag with the chip's source, never an attribute's", () => {
    const first = chipTag(node, { occurrence: 0, ref: null, source: "${state.x}" });
    const second = chipTag(node, { occurrence: 1, ref: null, source: "${state.x}" });
    expect([first?.slot, first?.index]).toEqual([["children", 0], 0]);
    expect([second?.slot, second?.index]).toEqual([["children", 2], 0]);
    expect(chipTag(node, { occurrence: 0, ref: null, source: "${state.y}" })?.index).toBe(1);
  });

  test("a count the document no longer has falls back to the first, and no match is null", () => {
    expect(chipTag(node, { occurrence: 7, ref: null, source: "${state.x}" })?.slot).toEqual([
      "children",
      0,
    ]);
    expect(chipTag(node, { occurrence: 0, ref: null, source: "${state.gone}" })).toBeNull();
    // An escaped-text chip carries literal text, which is no tag of the document.
    expect(chipTag(node, { occurrence: 0, ref: null, source: " and " })).toBeNull();
  });

  test("a { $ref } chip is found by its pointer", () => {
    const bound = chipTag(
      { textContent: { $ref: "#/state/title" } },
      { occurrence: 0, ref: "#/state/title", source: '${state?.["title"]}' },
    );
    expect(bound?.slot).toEqual(["textContent"]);
    expect(bound?.ref).toBe("#/state/title");
  });
});

describe("Source", () => {
  test("the picker's value is the field from the bare row words, whichever way the tag spells the row", () => {
    expect(sourceValue(tagOf("$map.item.data.title ?? ''"))).toBe("item.data.title");
    expect(sourceValue(tagOf("item.data.title"))).toBe("item.data.title");
    expect(sourceValue(tagOf("$map.index"))).toBe("index");
    expect(sourceValue(tagOf(LONG_DATE))).toBe("item.data.date");
    expect(sourceValue(tagOf("state.user.name"))).toBe("state.user.name");
    expect(sourceValue(tagOf('item["a-b"].c'))).toBe('item["a-b"].c');
    expect(sourceValue(tagOf("$map.other"))).toBe("$map.other");
  });

  test("a picked row field is written the way the tag spells the row, so picking back restores the text", () => {
    const original = "$map.item.data.title ?? ''";
    const tag = tagOf(original);
    const dollar = tag.pipe.type === "path" ? tag.pipe : null;
    const toDate = withSource(tag, sourcePath("item.data.date", dollar)!);
    expect(printDynamicTag(toDate)).toBe("$map.item.data.date ?? ''");
    const back = withSource(toDate, sourcePath("item.data.title", dollar)!);
    expect(printDynamicTag(back)).toBe(original);

    const bare = tagOf("item.data.title");
    expect(resourced(bare, "item.data.date", null)).toBe("item.data.date");
    expect(resourced(tag, "index", dollar)).toBe("$map.index ?? ''");
    expect(resourced(tag, "state.site.name", dollar)).toBe("state.site.name ?? ''");
  });

  test("another source keeps the format, the fallback and the negation", () => {
    const tag = tagOf(`!${LONG_DATE} || 'none'`);
    const next = withSource(
      tag,
      sourcePath("item.data.modified", { root: "$map", steps: [], type: "path" })!,
    );
    expect(printDynamicTag(next)).toBe(
      `!state.formatDate($map.item.data.modified, {"dateStyle":"long"}) || 'none'`,
    );
  });

  test("a picked field is read the way the path being replaced is: optional where it was", () => {
    const like = (expr: string) => {
      const tag = tagOf(expr);
      return tag.pipe.type === "path" ? tag.pipe : null;
    };
    const printed = (value: string, from: string) => {
      const path = sourcePath(value, like(from));
      return path === null ? null : printDynamicTag({ ...tagOf(from), pipe: path });
    };
    expect(printed("state.b", "state?.a")).toBe("state?.b");
    expect(printed("item.data.date", "$map.item?.data?.title")).toBe("$map.item?.data?.date");
    // Beyond the end, as the last step was; a plain path stays plain.
    expect(printed("state.a.b.c", "state?.x")).toBe("state?.a?.b?.c");
    expect(printed("state.a.b", "state.x.y")).toBe("state.a.b");
  });

  test("a value that is no plain path is not a source", () => {
    expect(sourcePath("a ? b : c", null)).toBeNull();
    expect(sourcePath("state.x ?? ''", null)).toBeNull();
    expect(sourcePath("!state.x", null)).toBeNull();
    expect(sourcePath("state.f(state.x)", null)).toBeNull();
  });

  test("a tag is storable as a pointer only when it is a plain read of state or the row", () => {
    expect(refOfTag(tagOf("state.user.name"))).toBe("#/state/user/name");
    expect(refOfTag(tagOf("$map.item.data.title"))).toBe("$map/item/data/title");
    expect(refOfTag(tagOf("item.data.title"))).toBe("$map/item/data/title");
    expect(refOfTag(tagOf("index"))).toBeNull();
    expect(refOfTag(tagOf('state["a/b"]["c~d"]'))).toBe("#/state/a~1b/c~0d");
    expect(refOfTag(tagOf("state.x ?? ''"))).toBeNull();
    expect(refOfTag(tagOf("!state.x"))).toBeNull();
    expect(refOfTag(tagOf("state.f(state.x)"))).toBeNull();
    // A pointer is read through optional steps, so `?.` is how one is spelled.
    expect(refOfTag(tagOf("state?.x"))).toBe("#/state/x");
    expect(refOfTag(tagOf("state.rows[0]"))).toBeNull();
    expect(refOfTag(tagOf("$page.title"))).toBeNull();
    expect(refOfTag(tagOf("state"))).toBeNull();
  });
});

describe("Fallback", () => {
  test("both forms are written, and the operator alone can change", () => {
    const tag = tagOf("state.title");
    expect(printDynamicTag(withFallback(tag, "||", "Untitled"))).toBe("state.title || 'Untitled'");
    expect(printDynamicTag(withFallback(tag, "??", "Untitled"))).toBe("state.title ?? 'Untitled'");
    const or = withFallback(tagOf("state.title ?? ''"), "||");
    expect(printDynamicTag(or)).toBe("state.title || ''");
    expect(printDynamicTag(withFallback(or, null))).toBe("state.title");
  });

  test("a fallback nobody retyped is printed from the text it was written as", () => {
    const tag = tagOf(String.raw`state.n ?? "kept \u0041"`);
    expect(printDynamicTag(withFallback(tag, "||"))).toBe(String.raw`state.n || "kept \u0041"`);
    expect(printDynamicTag(withFallback(tag, "??", "kept A"))).toBe(
      String.raw`state.n ?? "kept \u0041"`,
    );
  });

  test("new text keeps the quotes of the fallback it replaces", () => {
    expect(edited('state.n ?? "a"', (tag) => withFallback(tag, "??", "b"))).toBe('state.n ?? "b"');
    expect(edited("state.n ?? 'a'", (tag) => withFallback(tag, "??", "it's"))).toBe(
      String.raw`state.n ?? 'it\'s'`,
    );
    expect(fallbackLiteral('say "hi"').raw).toBe(`'say "hi"'`);
    expect(fallbackLiteral("line\nbreak")).toEqual({
      raw: String.raw`'line\nbreak'`,
      value: "line\nbreak",
    });
    expect(fallbackLiteral(String.raw`back\slash`).value).toBe(String.raw`back\slash`);
  });

  test("a fallback that was not a string stays what it reads as", () => {
    const zero = tagOf("state.count ?? 0");
    expect(printDynamicTag(withFallback(zero, "??", "12"))).toBe("state.count ?? 12");
    expect(printDynamicTag(withFallback(zero, "??", "false"))).toBe("state.count ?? false");
    expect(printDynamicTag(withFallback(zero, "??", "none"))).toBe("state.count ?? 'none'");
    expect(fallbackText(zero)).toBe("0");
    expect(fallbackText(tagOf("state.x ?? 'a'"))).toBe("a");
    expect(fallbackText(tagOf("state.x"))).toBe("");
  });

  test("the ! forms survive every other edit, and are set by themselves", () => {
    const tag = tagOf("!!$map.item.data.premium");
    expect(printDynamicTag(withFallback(tag, "||", "no"))).toBe("!!$map.item.data.premium || 'no'");
    expect(printDynamicTag(withNegations(tag, 1))).toBe("!$map.item.data.premium");
    expect(printDynamicTag(withNegations(tag, 0))).toBe("$map.item.data.premium");
    expect(edited("state.x ?? ''", (held) => withNegations(held, 2))).toBe("!!state.x ?? ''");
  });
});

describe("Format", () => {
  const formulas = formatFormulas({});
  const presets = formatPresets(formulas);

  test("the formulas offered are derived from what their parameters declare", () => {
    const names = formulas.map((formula) => formula.name);
    // One value in, and every other parameter optional, defaulted or a closed set.
    expect(names).toEqual(
      expect.arrayContaining([
        "formatDate",
        "formatNumber",
        "relativeTime",
        "orBlank",
        "escapeHtml",
        "notEmpty",
        "capitalize",
        "roundTo",
      ]),
    );
    // A list in, or a second value nothing declares a default for.
    for (const excluded of ["sum", "average", "count", "clamp", "truncate", "percent"]) {
      expect(names).not.toContain(excluded);
    }
    expect(formulas.every((formula) => formula.ensure !== undefined)).toBe(true);
  });

  test("a formula the document already holds is offered once, with nothing to copy in", () => {
    const own = {
      shout: {
        $expression: { operator: "call", target: { $ref: "$args/text/toUpperCase" }, value: [] },
        parameters: [{ name: "text", type: { text: "string" } }],
      },
    };
    const mine = formatFormulas(own).find((formula) => formula.name === "shout");
    expect(mine?.ensure).toBeUndefined();
    expect(presetsOf(mine!).map((preset) => preset.id)).toEqual(["shout:"]);
  });

  test("presets are read off the second parameter's type", () => {
    const ids = (name: string): string[] =>
      presetsOf(formulas.find((formula) => formula.name === name)!).map((preset) => preset.id);
    expect(ids("formatDate")).toEqual([
      "formatDate:",
      'formatDate:{"dateStyle":"full"}',
      'formatDate:{"dateStyle":"long"}',
      'formatDate:{"dateStyle":"medium"}',
      'formatDate:{"dateStyle":"short"}',
    ]);
    // The default unit is the preset with the value alone; every other unit is its own.
    expect(ids("relativeTime")).toEqual([
      "relativeTime:",
      'relativeTime:"year"',
      'relativeTime:"quarter"',
      'relativeTime:"month"',
      'relativeTime:"week"',
      'relativeTime:"hour"',
      'relativeTime:"minute"',
      'relativeTime:"second"',
    ]);
    expect(ids("orBlank")).toEqual(["orBlank:"]);
    expect(presetNamed(presets, 'formatDate:{"dateStyle":"long"}').label).toBe("Format date: long");
    expect(presetNamed(presets, "orBlank:").label).toBe("Or blank");
  });

  test("a preset writes a formula call with its arguments, and none takes the call away", () => {
    const tag = tagOf(`${DATE} ?? ''`);
    const long = withFormat(tag, presetNamed(presets, 'formatDate:{"dateStyle":"long"}'));
    expect(printDynamicTag(long)).toBe(`${LONG_DATE} ?? ''`);
    const plain = presetNamed(presets, "formatDate:");
    expect(printDynamicTag(withFormat(long, plain))).toBe(`state.formatDate(${DATE}) ?? ''`);
    expect(printDynamicTag(withFormat(long, null))).toBe(`${DATE} ?? ''`);
    // A chain of formulas is replaced whole: the preset is applied to the value read.
    const nested = tagOf(`state.escapeHtml(state.orBlank(${DATE}))`);
    const orBlank = presetNamed(presets, "orBlank:");
    expect(printDynamicTag(withFormat(nested, orBlank))).toBe(`state.orBlank(${DATE})`);
  });

  test("which preset a tag is on", () => {
    expect(presetOfTag(tagOf(DATE), presets)).toBe("");
    expect(presetOfTag(tagOf(LONG_DATE), presets)).toBe('formatDate:{"dateStyle":"long"}');
    // Spacing inside the argument is the author's; the value is what is compared.
    expect(presetOfTag(tagOf(`state.formatDate(${DATE}, { "dateStyle": "long" })`), presets)).toBe(
      'formatDate:{"dateStyle":"long"}',
    );
    expect(presetOfTag(tagOf(`state.formatDate(${DATE}, {"month":"short"})`), presets)).toBe(
      "custom",
    );
    expect(presetOfTag(tagOf(`state.mine(${DATE})`), presets)).toBe("custom");
    expect(presetOfTag(tagOf(`state.escapeHtml(state.orBlank(${DATE}))`), presets)).toBe("custom");
    expect(formatCall(tagOf(LONG_DATE))?.name).toBe("formatDate");
    expect(formatCall(tagOf(DATE))).toBeNull();
    expect(formatCall(tagOf(`state.a(state.b(${DATE}))`))).toBeNull();
  });

  test("a preset is drawn with the value alone: no fallback, no negation", () => {
    const tag = tagOf(`!${DATE} ?? 'none'`);
    expect(presetExpression(tag, presetNamed(presets, 'formatDate:{"dateStyle":"short"}'))).toBe(
      `state.formatDate(${DATE}, {"dateStyle":"short"})`,
    );
    expect(presetExpression(tagOf(LONG_DATE), null)).toBe(DATE);
  });

  test("a formula is offered for the kind of value it declares it takes", () => {
    const named = (name: string) => formulas.find((formula) => formula.name === name)!;
    expect(formatAccepts(named("relativeTime"), "string")).toBe(false);
    expect(formatAccepts(named("relativeTime"), "number")).toBe(true);
    expect(formatAccepts(named("formatDate"), "string")).toBe(true);
    expect(formatAccepts(named("formatDate"), "array")).toBe(false);
    expect(formatAccepts(named("capitalize"), "number")).toBe(false);
    // Nothing declared takes anything, and an empty value rules nothing out.
    expect(formatAccepts(named("orBlank"), "object")).toBe(true);
    expect(formatAccepts(named("relativeTime"), "empty")).toBe(true);
  });
});

describe("a format's own parameters", () => {
  const formulas = formatFormulas({});

  test("an options object is one field per property: the first two, then any it holds", () => {
    const fields = parameterFields(
      tagOf(`state.formatDate(${DATE}, {"dateStyle":"long","timeZone":"UTC"})`),
      formulas,
    );
    expect(fields.map((field) => [field.key, field.label, field.kind, field.value])).toEqual([
      ["1.dateStyle", "Date style", "select", "long"],
      ["1.timeStyle", "Time style", "select", ""],
      ["1.timeZone", "Time zone", "text", "UTC"],
    ]);
    expect(fields[0]?.options.map((option) => option.value)).toEqual([
      "",
      "full",
      "long",
      "medium",
      "short",
    ]);
  });

  test("an argument that is one value is one field, showing its default when unset", () => {
    expect(parameterFields(tagOf("state.relativeTime(state.n)"), formulas)).toMatchObject([
      { key: "1", kind: "select", label: "Unit", value: "day" },
    ]);
    expect(parameterFields(tagOf("state.roundTo(state.n, 2)"), formulas)).toMatchObject([
      { key: "1", kind: "text", label: "Digits", value: "2" },
    ]);
    expect(parameterFields(tagOf("state.n"), formulas)).toEqual([]);
    expect(parameterFields(tagOf("state.unknown(state.n, 1)"), formulas)).toEqual([]);
    expect(parameterFields(tagOf("state.orBlank(state.n)"), formulas)).toEqual([]);
  });

  test("setting one property rewrites that argument and keeps the others as written", () => {
    const tag = tagOf(`state.formatDate(${DATE}, {"dateStyle":"long"}) ?? ''`);
    expect(printDynamicTag(withParameter(tag, formulas, "1.timeStyle", "short"))).toBe(
      `state.formatDate(${DATE}, {"dateStyle":"long","timeStyle":"short"}) ?? ''`,
    );
    expect(printDynamicTag(withParameter(tag, formulas, "1.dateStyle", "medium"))).toBe(
      `state.formatDate(${DATE}, {"dateStyle":"medium"}) ?? ''`,
    );
    // The last property unset leaves no options argument at all.
    expect(printDynamicTag(withParameter(tag, formulas, "1.dateStyle", ""))).toBe(
      `state.formatDate(${DATE}) ?? ''`,
    );
    expect(
      edited(`state.formatNumber(state.n, {"style":"decimal"})`, (held) =>
        withParameter(held, formulas, "1.maximumFractionDigits", "2"),
      ),
    ).toBe(`state.formatNumber(state.n, {"style":"decimal","maximumFractionDigits":2})`);
    expect(
      edited("state.formatNumber(state.n)", (held) =>
        withParameter(held, formulas, "1.useGrouping", "false"),
      ),
    ).toBe(`state.formatNumber(state.n, {"useGrouping":false})`);
  });

  test("a single-value argument is set and unset, and a field of no parameter changes nothing", () => {
    const tag = tagOf("state.relativeTime(state.n)");
    expect(printDynamicTag(withParameter(tag, formulas, "1", "hour"))).toBe(
      'state.relativeTime(state.n, "hour")',
    );
    const hours = tagOf('state.relativeTime(state.n, "hour")');
    expect(printDynamicTag(withParameter(hours, formulas, "1", ""))).toBe(
      "state.relativeTime(state.n)",
    );
    expect(
      edited("state.roundTo(state.n)", (held) => withParameter(held, formulas, "1", "3")),
    ).toBe("state.roundTo(state.n, 3)");
    expect(
      edited("state.roundTo(state.n)", (held) => withParameter(held, formulas, "1", "x")),
    ).toBe('state.roundTo(state.n, "x")');
    expect(withParameter(tag, formulas, "9", "x")).toBe(tag);
    expect(withParameter(tag, formulas, "0", "x")).toBe(tag);
    expect(withParameter(tagOf("state.n"), formulas, "1", "x")).toEqual(tagOf("state.n"));
  });
});

describe("writing back", () => {
  test("one expression of a template is replaced and every other character kept", () => {
    const template = 'By ${ item.a } on ${state.f(item.b, {"k":"}"})} end';
    expect(replaceExpression(template, 1, "item.c")).toBe("By ${ item.a } on ${item.c} end");
    expect(replaceExpression(template, 0, "item.z ?? ''")).toBe(
      'By ${item.z ?? \'\'} on ${state.f(item.b, {"k":"}"})} end',
    );
    expect(replaceExpression(template, 5, "item.c")).toBe(template);
  });

  test("an edit that changes nothing answers the stored value itself", () => {
    const node = { textContent: "A ${ state.x  ??  '' } B" };
    const bound = boundAt(node, ["textContent"]);
    // Not canonical spacing, and still untouched: nothing is written by looking.
    expect(rewrittenValue(node.textContent, bound, " state.x  ??  '' ")).toBe(node.textContent);
    expect(rewrittenValue(node.textContent, bound, "state.x  ??  ''")).toBe(node.textContent);
    expect(rewrittenValue(node.textContent, bound, "state.y")).toBe("A ${state.y} B");
    expect(rewrittenValue(undefined, bound, "state.y")).toBeUndefined();
  });

  test("a { $ref } stays a pointer for a plain read and becomes a template for anything more", () => {
    const held = { $ref: "$map/item/data/title" };
    const bound = boundAt({ textContent: held }, ["textContent"]);
    expect(rewrittenValue(held, bound, bound.expr!)).toBe(held);
    expect(rewrittenValue(held, bound, "$map.item.data.date")).toEqual({
      $ref: "$map/item/data/date",
    });
    expect(rewrittenValue(held, bound, "state.site.name")).toEqual({ $ref: "#/state/site/name" });
    expect(rewrittenValue(held, bound, "$map.item.data.title ?? ''")).toBe(
      "${$map.item.data.title ?? ''}",
    );
    expect(rewrittenValue(held, bound, "a ? b : c")).toBe("${a ? b : c}");
  });

  test("a pointer no template reaches is edited as the pointer it is", () => {
    const held = { $ref: "window#/location/href" };
    const bound = boundAt({ textContent: held }, ["textContent"]);
    expect(rewrittenValue(held, bound, "window#/location/href")).toBe(held);
    expect(rewrittenValue(held, bound, "  ")).toBe(held);
    expect(rewrittenValue(held, bound, "window#/location/host")).toEqual({
      $ref: "window#/location/host",
    });
  });
});
