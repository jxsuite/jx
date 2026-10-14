/**
 * No Studio surface baseline-aligns a row on a kit control that has no baseline to give.
 *
 * A small jx-button, jx-action-button or jx-checkbox extends its pointer target past its drawn box
 * with an absolutely positioned `::before` (ui.md §4.3), and that box would count toward the
 * SCROLLABLE overflow of the nearest ancestor whose `overflow` is not `visible`, painted or not: an
 * sm action button touching the edge of Preferences · Keyboard drew a 2px phantom scrollbar under
 * the whole sheet. So the kit declares `contain: layout` on those controls, and a layout-contained
 * box exports no baseline. A flex row aligned on `baseline` then synthesises one from the button's
 * bottom edge and drops the row's text onto it: the Keyboard rows grew from 24px to 29px, and
 * Welcome's `Recent` header had stood 7px tall for the same reason since jx-button took the
 * containment. The rows that hold one now centre it.
 *
 * Happy-dom lays nothing out, so this reads the documents instead: for every style rule, and every
 * inline style, that aligns a container's items on a baseline, it resolves the nodes that carry the
 * rule's part and lists their flex items, looking through what renders no box of its own (a mapped
 * array's rows land in the parent; a `display: contents` wrapper, `$switch` container included,
 * passes its children up). The set of controls without a baseline is DERIVED from the kit, so a kit
 * element that gains the containment is covered without an edit here.
 *
 * **And then the row that centres has to actually centre.** `align-items: center` aligns MARGIN
 * boxes, not border boxes, so an item carrying a block margin of its own is centred including that
 * margin and its ink comes out off the line. Welcome's `Recent` header is the case: moved off
 * `baseline`, its `h2` still had `margin: 0 0 var(--jx-space-3)`, whose margin box measured 26px —
 * exactly the header's height — so `center` had nothing to move, the title sat flush at the top and
 * `Clear all` centred 3.6px below its baseline. A fix that measured right and still looked wrong,
 * and the rule's own `$description` claimed the baseline it was not delivering. So the second sweep
 * below reads every centred flex ROW (block margins are irrelevant on a column's cross axis) and
 * fails on an item with an asymmetric block margin, a `<p>` or `<h2>` left on its UA margin
 * included. The spacing belongs on the row.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { documents } from "@jxsuite/ui/documents";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const dir = resolve(import.meta.dir, "../src/surfaces");
const surfaces = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .toSorted();

/**
 * The object nodes under `value`, depth first, never descending into a `style` block.
 *
 * @yields {JsonObject} Each object node, `value` itself first when it is one.
 */
function* nodesUnder(value: JsonValue | undefined): Generator<JsonObject> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* nodesUnder(item);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  yield value;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "style") {
      yield* nodesUnder(child);
    }
  }
}

/**
 * Every nested rule of a style block, with the selector it is reached by.
 *
 * @yields {[string, JsonObject]} The selector (every key from the block down, space-joined) and the
 *   rule.
 */
function* rulesOf(block: JsonObject, selector = ""): Generator<[string, JsonObject]> {
  for (const [key, value] of Object.entries(block)) {
    if (isJsonObject(value)) {
      const nested = `${selector} ${key}`;
      yield [nested, value];
      yield* rulesOf(value, nested);
    }
  }
}

/** The part name each comma-separated piece of a selector ends on, where it names one. */
function lastParts(selector: string): string[] {
  return selector.split(",").flatMap((piece) => {
    const parts = [...piece.matchAll(/\[part="([^"]+)"\]/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    const last = parts.at(-1);
    return last === undefined ? [] : [last];
  });
}

/** Whether a `contain` value includes layout containment (`strict` and `content` both do). */
const containsLayout = (value: JsonValue | undefined): boolean =>
  /\b(layout|strict|content)\b/.test(String(value ?? ""));

/**
 * `tag` → the sizes whose control is layout-contained, `"*"` for every size. Read off each kit
 * document's `& > [part="control"]` and `&[data-size="…"] > [part="control"]` rules, the control
 * being what gives the host its baseline.
 */
function baselinelessControls(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [tag, doc] of Object.entries(documents)) {
    const style = isJsonObject(doc.style) ? doc.style : {};
    for (const [key, block] of Object.entries(style)) {
      const m = /^&(?:\[data-size="(\w+)"\])? > \[part="control"\]$/.exec(key);
      if (!m || !isJsonObject(block) || !containsLayout(block["contain"])) {
        continue;
      }
      const sizes = found.get(tag) ?? new Set<string>();
      sizes.add(m[1] ?? "*");
      found.set(tag, sizes);
    }
  }
  return found;
}

const BASELINELESS = baselinelessControls();

/** The size a surface declares for a kit control, when it is a literal. */
function sizeOf(node: JsonObject): string | undefined {
  const props = isJsonObject(node["$props"]) ? node["$props"] : {};
  const attributes = isJsonObject(node["attributes"]) ? node["attributes"] : {};
  const size = props["size"] ?? attributes["size"];
  return isString(size) ? size : undefined;
}

/** Whether a node is a kit control that exports no baseline. */
function isBaselineless(node: JsonObject): boolean {
  const { tagName } = node;
  const sizes = isString(tagName) ? BASELINELESS.get(tagName) : undefined;
  if (!sizes) {
    return false;
  }
  return sizes.has("*") || sizes.has(sizeOf(node) ?? "md");
}

/** The part names a node carries (the attribute is a space-separated list). */
function partsOf(node: JsonObject): string[] {
  const attributes = isJsonObject(node["attributes"]) ? node["attributes"] : {};
  const { part } = attributes;
  return isString(part) ? part.split(/\s+/) : [];
}

/** The parts a surface's own sheet renders as `display: contents`. */
function contentsParts(style: JsonObject): Set<string> {
  const parts = new Set<string>();
  for (const [selector, rule] of rulesOf(style)) {
    if (rule["display"] === "contents") {
      for (const part of lastParts(selector)) {
        parts.add(part);
      }
    }
  }
  return parts;
}

const aligned = (value: JsonValue | undefined): boolean => String(value ?? "").includes("baseline");

/**
 * The boxes a container lays out as its own items: a mapped array's `map` renders straight into the
 * parent, and a node that is `display: contents` (by inline style or by its part's rule) hands its
 * children up, a `$switch` container's children being its cases.
 */
function flexItems(container: JsonObject, contents: Set<string>): JsonObject[] {
  const items: JsonObject[] = [];
  const visit = (value: JsonValue | undefined): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }
    if (value["$prototype"] === "Array") {
      visit(value["map"]);
      return;
    }
    const style = isJsonObject(value["style"]) ? value["style"] : {};
    const passesThrough =
      style["display"] === "contents" || partsOf(value).some((part) => contents.has(part));
    if (!passesThrough) {
      items.push(value);
      return;
    }
    visit(value["children"]);
    if (isJsonObject(value["cases"])) {
      visit(Object.values(value["cases"]));
    }
  };
  visit(container["children"]);
  return items;
}

/** A readable name for a node: its tag, size and part. */
function nameOf(node: JsonObject): string {
  const size = sizeOf(node);
  const parts = partsOf(node);
  const sized = size === undefined ? "" : `(${size})`;
  const named = parts.length > 0 ? `[${parts.join(" ")}]` : "";
  return `${String(node["tagName"] ?? "?")}${sized}${named}`;
}

/**
 * Every baseline-aligned container in a surface, by the part (or inline style) that aligns it,
 * crossed with the flex items it holds that have no baseline.
 */
function offenders(doc: JsonObject): string[] {
  const style = isJsonObject(doc["style"]) ? doc["style"] : {};
  const contents = contentsParts(style);
  const containers: [string, JsonObject][] = [];
  for (const [selector, rule] of rulesOf(style)) {
    if (!aligned(rule["alignItems"]) && !aligned(rule["placeItems"])) {
      continue;
    }
    for (const part of lastParts(selector)) {
      for (const node of nodesUnder(doc)) {
        if (partsOf(node).includes(part)) {
          containers.push([`[part="${part}"]`, node]);
        }
      }
    }
  }
  for (const node of nodesUnder(doc)) {
    const inline = node["style"];
    if (isString(node["tagName"]) && isJsonObject(inline) && aligned(inline["alignItems"])) {
      containers.push([`inline style on ${nameOf(node)}`, node]);
    }
  }
  return containers.flatMap(([where, node]) =>
    flexItems(node, contents)
      .filter((item) => isBaselineless(item))
      .map((item) => `${where} aligns ${nameOf(item)} on a baseline it does not have`),
  );
}

/** A surface document, refused unless its top level is a JSON object. */
function read(name: string): JsonObject {
  const parsed: JsonValue = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`${name} is not a JSON object`);
  }
  return parsed;
}

/** A nested object of `doc` that the test is about to edit, refused unless it is one. */
function objectAt(doc: JsonObject, key: string): JsonObject {
  const value = doc[key];
  if (!isJsonObject(value)) {
    throw new Error(`expected an object at ${JSON.stringify(key)}`);
  }
  return value;
}

/**
 * The tags whose UA sheet gives them a block margin. A row's item left on one is the same defect as
 * one given a margin by a rule, and it is the commoner half: nothing in the document says so.
 */
const UA_BLOCK_MARGIN = new Set([
  "blockquote",
  "dl",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "menu",
  "ol",
  "p",
  "pre",
  "ul",
]);

/** An item's block-start and block-end margins, each absent when nothing sets it. */
interface BlockMargins {
  start?: string;
  end?: string;
}

/** A rule's own block-start and block-end margins, reading the shorthands the surfaces use. */
function blockMargins(rule: JsonObject): BlockMargins {
  const out: BlockMargins = {};
  for (const [property, value] of Object.entries(rule)) {
    if (!isString(value)) {
      continue;
    }
    const sides = value.trim().split(/\s+/);
    if (property === "margin") {
      out.start = sides[0]!;
      out.end = sides.length >= 3 ? sides[2]! : sides[0]!;
    } else if (property === "marginBlock") {
      out.start = sides[0]!;
      out.end = sides[1] ?? sides[0]!;
    } else if (property === "marginTop" || property === "marginBlockStart") {
      out.start = value;
    } else if (property === "marginBottom" || property === "marginBlockEnd") {
      out.end = value;
    }
  }
  return out;
}

/** Whether a margin is absent or zero. A token is never zero, so any `var()` counts as a margin. */
const isZero = (value: string | undefined): boolean =>
  value === undefined || /^0(\D|$)/.test(value.trim());

/** Whether a rule lays its items out as a flex ROW, the one axis a block margin can spoil. */
function isFlexRow(rule: JsonObject): boolean {
  return (
    /flex/.test(String(rule["display"] ?? "")) &&
    !String(rule["flexDirection"] ?? "row").startsWith("column")
  );
}

/**
 * Every centred flex row in a surface, crossed with the items whose own block margin means the row
 * centres something other than what a reader sees.
 *
 * The margins a part carries are collected from every rule that names it LAST, in document order,
 * so `[part="section-header"] [part="section-title"]` overriding `[part="section-title"]` reads the
 * way the cascade reads it.
 */
function marginOffenders(doc: JsonObject): string[] {
  const style = isJsonObject(doc["style"]) ? doc["style"] : {};
  const contents = contentsParts(style);
  const centred = new Set<string>();
  const margins = new Map<string, BlockMargins>();
  for (const [selector, rule] of rulesOf(style)) {
    const parts = lastParts(selector);
    if (
      isFlexRow(rule) &&
      /\bcenter\b/.test(String(rule["alignItems"] ?? rule["placeItems"] ?? ""))
    ) {
      for (const part of parts) {
        centred.add(part);
      }
    }
    const own = blockMargins(rule);
    if (own.start !== undefined || own.end !== undefined) {
      for (const part of parts) {
        margins.set(part, Object.assign(margins.get(part) ?? {}, own));
      }
    }
  }
  const found: string[] = [];
  for (const node of nodesUnder(doc)) {
    if (!partsOf(node).some((part) => centred.has(part))) {
      continue;
    }
    for (const item of flexItems(node, contents)) {
      const margin: BlockMargins = {};
      for (const part of partsOf(item)) {
        Object.assign(margin, margins.get(part));
      }
      if (isJsonObject(item["style"])) {
        Object.assign(margin, blockMargins(item["style"]));
      }
      const untouchedUa =
        UA_BLOCK_MARGIN.has(String(item["tagName"] ?? "")) &&
        margin.start === undefined &&
        margin.end === undefined;
      const asymmetric =
        isZero(margin.start) !== isZero(margin.end) ||
        (!isZero(margin.start) && margin.start !== margin.end);
      if (untouchedUa) {
        found.push(`${nameOf(item)} keeps its UA block margin in a centred row`);
      } else if (asymmetric) {
        found.push(
          `${nameOf(item)} carries an uneven block margin (${margin.start ?? "unset"} / ${margin.end ?? "unset"}) in a centred row`,
        );
      }
    }
  }
  return found;
}

describe("kit controls without a baseline", () => {
  test("the kit's small buttons, action buttons and checkboxes are layout-contained", () => {
    /* The negative control: a derivation that found nothing would pass every surface below. */
    for (const tag of ["jx-button", "jx-action-button", "jx-checkbox"]) {
      expect(BASELINELESS.get(tag)?.has("sm"), `${tag}'s sm control`).toBe(true);
    }
  });

  test("the walker sees a small control in a baseline row, through a map and a switch", () => {
    /* Preferences' key row is the case this file exists for, put back the way it shipped: the
       rows come from a mapped array, and `Reset` sits in a `display: contents` `$switch`. */
    const doc = read("preferences.json");
    const style = objectAt(doc, "style");
    // The sheet has no bare `[part="key"]` rule today, so this usually starts from nothing.
    const keyRule: JsonObject = {};
    const existing = style['& [part="key"]'];
    if (isJsonObject(existing)) {
      Object.assign(keyRule, existing);
    }
    keyRule["alignItems"] = "baseline";
    style['& [part="key"]'] = keyRule;
    expect(offenders(doc)).toEqual([
      '[part="key"] aligns jx-action-button(sm)[change] on a baseline it does not have',
      '[part="key"] aligns jx-action-button(sm)[reset] on a baseline it does not have',
    ]);
  });

  test("an inline baseline style and a contents part are read too", () => {
    const doc: JsonObject = {
      tagName: "div",
      style: { '& [part="wrap"]': { display: "contents" } },
      children: [
        {
          tagName: "div",
          style: { display: "flex", alignItems: "first baseline" },
          children: [
            { tagName: "span", textContent: "Label" },
            {
              tagName: "span",
              attributes: { part: "wrap" },
              children: [{ tagName: "jx-checkbox", attributes: { size: "sm" } }],
            },
            { tagName: "jx-button", children: [{ tagName: "span", textContent: "Go" }] },
          ],
        },
      ],
    };
    expect(offenders(doc)).toEqual([
      "inline style on div aligns jx-checkbox(sm) on a baseline it does not have",
    ]);
  });
});

describe("surface baseline rows", () => {
  test("there are surfaces to judge", () => {
    expect(surfaces.length).toBeGreaterThan(0);
  });

  for (const name of surfaces) {
    test(`${name} centres its small kit controls rather than baseline-aligning them`, () => {
      expect(
        offenders(read(name)),
        `${name}: a small kit button, action button or checkbox is layout-contained so its outset hit area adds nothing to a scrolling ancestor's overflow, and so it has no baseline; centre the row (align-items: center)`,
      ).toEqual([]);
    });
  }
});

describe("a centred row centres what a reader sees", () => {
  test("the walker reads the header Welcome shipped, and the one it ships now", () => {
    /* The negative control, and it is the real case: with the h2's own block-end margin still on it
       the header had nothing to centre, because the margin box already filled the line. */
    const doc = read("welcome.json");
    expect(marginOffenders(doc)).toEqual([]);
    const style = objectAt(doc, "style");
    delete style['& [part="section-header"] [part="section-title"]'];
    expect(marginOffenders(doc)).toEqual([
      "h2[section-title] carries an uneven block margin (0 / var(--jx-space-3)) in a centred row",
    ]);
  });

  test("a UA block margin counts, and a column's cross axis does not", () => {
    const row: JsonObject = {
      tagName: "div",
      style: {
        '& [part="row"]': { display: "flex", alignItems: "center" },
        '& [part="col"]': { display: "flex", flexDirection: "column", alignItems: "center" },
      },
      children: [
        {
          tagName: "div",
          attributes: { part: "row" },
          children: [{ tagName: "p", textContent: "Nothing zeroed this" }],
        },
        {
          tagName: "div",
          attributes: { part: "col" },
          // A column centres on the INLINE axis, so a block margin is nothing to do with it.
          children: [{ tagName: "p", textContent: "Fine here" }],
        },
      ],
    };
    expect(marginOffenders(row)).toEqual(["p keeps its UA block margin in a centred row"]);
  });

  test("an even margin is not an offender, however it is spelled", () => {
    const doc: JsonObject = {
      tagName: "div",
      style: {
        '& [part="row"]': { display: "flex", alignItems: "center" },
        '& [part="even"]': { marginBlock: "var(--jx-space-2)" },
        '& [part="none"]': { margin: "0 var(--jx-space-2)" },
      },
      children: [
        {
          tagName: "div",
          attributes: { part: "row" },
          children: [
            { tagName: "h2", attributes: { part: "even" }, textContent: "Even" },
            { tagName: "p", attributes: { part: "none" }, textContent: "Inline only" },
          ],
        },
      ],
    };
    expect(marginOffenders(doc)).toEqual([]);
  });

  for (const name of surfaces) {
    test(`${name} leaves no block margin on an item of a centred row`, () => {
      expect(
        marginOffenders(read(name)),
        `${name}: \`align-items: center\` aligns MARGIN boxes, so an item's own block margin moves its ink off the line; zero it on the item and put the spacing on the row`,
      ).toEqual([]);
    });
  }
});
