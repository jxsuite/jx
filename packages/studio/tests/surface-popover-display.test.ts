/**
 * No surface may give a popover or dialog part a `display` of its own outside its open state.
 *
 * A closed popover is hidden by the platform's `[popover]:not(:popover-open)` rule, and a closed
 * dialog by `dialog:not([open])`; the kit lets both through with `display: revert-layer`. A
 * `display` a surface declares on the part outranks them, so the closed panel stays laid out. The
 * block action bar's link popover did exactly that: invisible at opacity 0 at the viewport origin,
 * it took every click and the text cursor meant for the workspace tabs beneath it, so a canvas
 * click followed by a click on Content did nothing.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";

const SURFACES = join(import.meta.dir, "../src/surfaces");

/** A surface document as `JSON.parse` returns it. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The elements the platform hides while closed. */
const CLOSABLE_TAGS = new Set(["dialog", "jx-dialog", "jx-menu", "jx-popover"]);

/** A selector that only matches the open state, where a `display` is the surface's to choose. */
const OPEN_STATE = /:popover-open|\[open\]|:modal/;

/** A JSON object, or null for an array or a primitive. */
function recordOf(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return isNonNullObject(value) && !Array.isArray(value) ? value : null;
}

/** The `part` of every closable element a document declares. */
function closableParts(node: JsonValue, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      closableParts(item, found);
    }
  } else if (isNonNullObject(node)) {
    const { attributes: declared, tagName: tag } = node;
    const attributes = recordOf(declared);
    const part = attributes?.["part"];
    const closable =
      (isString(tag) && CLOSABLE_TAGS.has(tag)) || (attributes !== null && "popover" in attributes);
    if (closable && isString(part)) {
      found.add(part);
    }
    for (const value of Object.values(node)) {
      closableParts(value, found);
    }
  }
  return found;
}

/** Every `display` declaration in a style tree, with the selector path that leads to it. */
function displays(style: JsonValue, selector = ""): { selector: string; value: JsonValue }[] {
  if (!isNonNullObject(style)) {
    return [];
  }
  return Object.entries(style).flatMap(([key, value]) =>
    key === "display" ? [{ selector, value }] : displays(value, `${selector} ${key}`),
  );
}

/** Every `style` block in a document, the root's and each element's. */
function styles(node: JsonValue): JsonValue[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => styles(item));
  }
  if (!isNonNullObject(node)) {
    return [];
  }
  const found: JsonValue[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "style") {
      found.push(value);
    }
    found.push(...styles(value));
  }
  return found;
}

/** Each offending declaration in one surface document, as `file: selector → value`. */
export function closedPartDisplays(file: string, doc: JsonValue): string[] {
  const parts = closableParts(doc);
  return styles(doc).flatMap((style) =>
    displays(style)
      .filter(
        ({ selector }) =>
          !OPEN_STATE.test(selector) &&
          [...parts].some((part) => selector.includes(`[part="${part}"]`)),
      )
      .map(({ selector, value }) => `${file}: ${selector.trim()} → ${String(value)}`),
  );
}

describe("closable parts in surface documents", () => {
  test("no surface declares a display on one outside its open state", () => {
    const offenders = readdirSync(SURFACES)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => {
        const source = readFileSync(join(SURFACES, file), "utf8");
        /* SAFETY: every file here is a surface document, and JSON.parse of a document yields
           exactly the JSON value it encodes. */
        return closedPartDisplays(file, JSON.parse(source) as JsonValue);
      });
    expect(offenders).toEqual([]);
  });

  test("the check finds the block action bar's old rule, and lets an open-state one pass", () => {
    const doc = {
      children: [{ attributes: { part: "link" }, tagName: "jx-popover" }],
      style: {
        '& [part="link"]': { display: "flex" },
        '& [part="link"]:popover-open': { display: "grid" },
        '& [part="other"]': { display: "flex" },
      },
    };
    expect(closedPartDisplays("bar.json", doc)).toEqual(['bar.json: & [part="link"] → flex']);
  });

  test("an element with a popover attribute counts, whatever its tag", () => {
    const doc = {
      children: [{ attributes: { part: "tip", popover: "hint" }, tagName: "div" }],
      style: { '& [part="tip"]': { display: "block" } },
    };
    expect(closedPartDisplays("tip.json", doc)).toEqual(['tip.json: & [part="tip"] → block']);
  });
});
