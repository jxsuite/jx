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
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { documents as kitDocuments } from "@jxsuite/ui/documents";

type Json = Record<string, unknown>;

const dir = resolve(import.meta.dir, "../src/surfaces");
const surfaces = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .toSorted();

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The object nodes under `value`, depth first, never descending into a `style` block.
 *
 * @yields {Json} Each object node, `value` itself first when it is one.
 */
function* nodesUnder(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* nodesUnder(item);
    }
    return;
  }
  if (!isObject(value)) {
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
 * @yields {[string, Json]} The selector (every key from the block down, space-joined) and the rule.
 */
function* rulesOf(block: Json, selector = ""): Generator<[string, Json]> {
  for (const [key, value] of Object.entries(block)) {
    if (isObject(value)) {
      const nested = `${selector} ${key}`;
      yield [nested, value];
      yield* rulesOf(value, nested);
    }
  }
}

/** The part name each comma-separated piece of a selector ends on, where it names one. */
function lastParts(selector: string): string[] {
  return selector.split(",").flatMap((piece) => {
    const parts = [...piece.matchAll(/\[part="([^"]+)"\]/g)].map((m) => m[1] as string);
    const last = parts.at(-1);
    return last === undefined ? [] : [last];
  });
}

/** Whether a `contain` value includes layout containment (`strict` and `content` both do). */
const containsLayout = (value: unknown): boolean =>
  /\b(layout|strict|content)\b/.test(String(value ?? ""));

/**
 * `tag` → the sizes whose control is layout-contained, `"*"` for every size. Read off each kit
 * document's `& > [part="control"]` and `&[data-size="…"] > [part="control"]` rules, the control
 * being what gives the host its baseline.
 */
function baselinelessControls(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [tag, doc] of Object.entries(kitDocuments)) {
    const style = isObject(doc.style) ? doc.style : {};
    for (const [key, block] of Object.entries(style)) {
      const m = /^&(?:\[data-size="(\w+)"\])? > \[part="control"\]$/.exec(key);
      if (!m || !isObject(block) || !containsLayout(block["contain"])) {
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
function sizeOf(node: Json): string | undefined {
  const props = isObject(node["$props"]) ? node["$props"] : {};
  const attributes = isObject(node["attributes"]) ? node["attributes"] : {};
  const size = props["size"] ?? attributes["size"];
  return typeof size === "string" ? size : undefined;
}

/** Whether a node is a kit control that exports no baseline. */
function isBaselineless(node: Json): boolean {
  const { tagName } = node;
  const sizes = typeof tagName === "string" ? BASELINELESS.get(tagName) : undefined;
  if (!sizes) {
    return false;
  }
  return sizes.has("*") || sizes.has(sizeOf(node) ?? "md");
}

/** The part names a node carries (the attribute is a space-separated list). */
function partsOf(node: Json): string[] {
  const attributes = isObject(node["attributes"]) ? node["attributes"] : {};
  return typeof attributes["part"] === "string" ? attributes["part"].split(/\s+/) : [];
}

/** The parts a surface's own sheet renders as `display: contents`. */
function contentsParts(style: Json): Set<string> {
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

const aligned = (value: unknown): boolean => String(value ?? "").includes("baseline");

/**
 * The boxes a container lays out as its own items: a mapped array's `map` renders straight into the
 * parent, and a node that is `display: contents` (by inline style or by its part's rule) hands its
 * children up, a `$switch` container's children being its cases.
 */
function flexItems(container: Json, contents: Set<string>): Json[] {
  const items: Json[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isObject(value)) {
      return;
    }
    if (value["$prototype"] === "Array") {
      visit(value["map"]);
      return;
    }
    const style = isObject(value["style"]) ? value["style"] : {};
    const passesThrough =
      style["display"] === "contents" || partsOf(value).some((part) => contents.has(part));
    if (!passesThrough) {
      items.push(value);
      return;
    }
    visit(value["children"]);
    if (isObject(value["cases"])) {
      visit(Object.values(value["cases"]));
    }
  };
  visit(container["children"]);
  return items;
}

/** A readable name for a node: its tag, size and part. */
function nameOf(node: Json): string {
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
function offenders(doc: Json): string[] {
  const style = isObject(doc["style"]) ? doc["style"] : {};
  const contents = contentsParts(style);
  const containers: [string, Json][] = [];
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
    if (typeof node["tagName"] === "string" && isObject(inline) && aligned(inline["alignItems"])) {
      containers.push([`inline style on ${nameOf(node)}`, node]);
    }
  }
  return containers.flatMap(([where, node]) =>
    flexItems(node, contents)
      .filter((item) => isBaselineless(item))
      .map((item) => `${where} aligns ${nameOf(item)} on a baseline it does not have`),
  );
}

const read = (name: string): Json => JSON.parse(readFileSync(join(dir, name), "utf8")) as Json;

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
    const style = doc["style"] as Json;
    style['& [part="key"]'] = { ...(style['& [part="key"]'] as Json), alignItems: "baseline" };
    expect(offenders(doc)).toEqual([
      '[part="key"] aligns jx-action-button(sm)[change] on a baseline it does not have',
      '[part="key"] aligns jx-action-button(sm)[reset] on a baseline it does not have',
    ]);
  });

  test("an inline baseline style and a contents part are read too", () => {
    const doc: Json = {
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
