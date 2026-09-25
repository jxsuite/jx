/**
 * No Studio style rule addresses a part the kit keeps in the tree as a permanent, empty live
 * region.
 *
 * `jx-textfield`, `jx-select` and `jx-combobox` each draw a `<p part="error" aria-live="polite">`
 * that exists, empty, from the first render, because a live region announces nothing unless it was
 * in the tree before its text arrived (ui.md §5.1). The kit is light DOM, so a surface that styles
 * its OWN banner with `& [part="error"]` also reaches that paragraph in every field inside it. The
 * kit's `:empty` rule now resets the region whatever an ancestor sets, but before it did, Source
 * Control's banner rule drew a 16x13 box over the branch picker's and the commit field's top-left
 * corners and took the click, and the Assistant's error card drew an 18x12 red bar on the model
 * picker. The kit fix cannot help once the field has text, though: the refusal sentence then drew
 * as git-panel's banner, padding, rule and wash included. So a surface names its own refusal
 * `failure` (a dialog or panel banner) or `section-error` (a settings section), as add-repo,
 * publish, new-project, preferences and the settings sections already did.
 *
 * The reserved names are DERIVED from the kit: every part carried by a kit node with `aria-live`.
 * So are the elements a rule may anchor on to address that region on purpose (`jx-textfield
 * [part="error"]`): every kit element whose tree holds the region, directly or through another such
 * element, which is how `jx-color-field` inherits it from the text field it embeds. Only the
 * permanent live region is reserved. Banning every kit part name from surface selectors was
 * measured at over 300 existing descendant hits (`row`, `badge`, `chip`, ...), and none of those
 * can paint while invisible.
 *
 * Selectors are resolved with the runtime's own `resolveNestedSelector`, so a nested `&` block and
 * a comma list are read exactly as the emitted sheet reads them, and an at-rule block passes its
 * parent's selector through unchanged, as the runtime's own walk does.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveNestedSelector, splitSelectorList } from "@jxsuite/runtime/css";
import { documents as kitDocuments } from "@jxsuite/ui/documents";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The element nodes under `value`, depth first, never descending into a `style` block.
 *
 * @yields {Json} Each object carrying a `tagName`, `value` itself first when it is one.
 */
function* elementsUnder(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* elementsUnder(item);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (typeof value["tagName"] === "string") {
    yield value;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "style") {
      yield* elementsUnder(child);
    }
  }
}

/** The whitespace-separated part names a node's own attributes give it. */
function partsOf(node: Json): string[] {
  const { attributes } = node;
  const part = isObject(attributes) ? attributes["part"] : undefined;
  return typeof part === "string" ? part.split(/\s+/).filter(Boolean) : [];
}

/** Every part a kit node keeps in the tree as a live region: the nodes that carry `aria-live`. */
function reservedParts(docs: Readonly<Record<string, unknown>>): Set<string> {
  const reserved = new Set<string>();
  for (const doc of Object.values(docs)) {
    for (const node of elementsUnder(doc)) {
      const { attributes } = node;
      if (isObject(attributes) && "aria-live" in attributes) {
        for (const part of partsOf(node)) {
          reserved.add(part);
        }
      }
    }
  }
  return reserved;
}

/**
 * The kit elements whose tree holds a reserved region, directly or by embedding another element
 * that does, found by growing the set until a pass adds nothing.
 */
function regionHolders(
  docs: Readonly<Record<string, unknown>>,
  reserved: ReadonlySet<string>,
): Set<string> {
  const holders = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [tag, doc] of Object.entries(docs)) {
      const inner = [...elementsUnder(doc)].filter((node) => node !== doc);
      const holds = inner.some(
        (node) =>
          partsOf(node).some((part) => reserved.has(part)) ||
          holders.has(node["tagName"] as string),
      );
      if (holds && !holders.has(tag)) {
        holders.add(tag);
        grew = true;
      }
    }
  }
  return holders;
}

/**
 * Every rule selector a style block produces, fully resolved against `scope`. An at-rule block
 * (`@(forced-colors: active)`, `@media …`) is transparent: its keys resolve against the selector
 * the at-rule sits in.
 *
 * @yields {string} Each nested rule's selector.
 */
function* selectorsOf(block: Json, scope: string): Generator<string> {
  for (const [key, value] of Object.entries(block)) {
    const blocks = Array.isArray(value)
      ? value.filter((entry) => isObject(entry))
      : isObject(value)
        ? [value]
        : [];
    for (const child of blocks) {
      if (key.startsWith("@")) {
        yield* selectorsOf(child, scope);
      } else {
        const selector = resolveNestedSelector(scope, key);
        yield selector;
        yield* selectorsOf(child, selector);
      }
    }
  }
}

/**
 * Every rule selector in a document: its root style and every node's own style block.
 *
 * @yields {string} Each rule's selector, the root's resolved against `SCOPE` and a node's against
 *   `NODE`.
 */
function* documentSelectors(doc: Json): Generator<string> {
  for (const node of elementsUnder(doc)) {
    const { style } = node;
    if (isObject(style)) {
      yield* selectorsOf(style, node === doc ? "SCOPE" : "NODE");
    }
  }
}

/** `[part="x"]`, `[part~='x']` or `[part=x]`, with the name in whichever group matched. */
const PART_SELECTOR = /\[part~?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*\]/g;

/** The compound selector that ends right before `index` in `member`, past any combinator. */
function compoundBefore(member: string, index: number): string {
  const head = member.slice(0, index);
  // The compound the part selector itself belongs to starts after the last combinator or space.
  const own = head.search(/[^\s>+~]*$/);
  const before = head.slice(0, own).replace(/[\s>+~]+$/, "");
  return before.slice(before.search(/[^\s>+~]*$/));
}

/**
 * Each member of `selector` that addresses a reserved part without anchoring on a kit element that
 * holds the region. Anchoring (`jx-textfield [part="error"]`) is how a rule says it means the kit's
 * own sentence, and it is the only reading of a reserved name that is not a collision.
 */
function collisions(
  selector: string,
  reserved: ReadonlySet<string>,
  holders: ReadonlySet<string>,
): string[] {
  return splitSelectorList(selector).filter((member) =>
    [...member.matchAll(PART_SELECTOR)].some((match) => {
      const name = match[1] ?? match[2] ?? match[3] ?? "";
      if (!reserved.has(name)) {
        return false;
      }
      const anchor = /^[a-z][a-z0-9]*-[a-z0-9-]*/.exec(compoundBefore(member, match.index))?.[0];
      return anchor === undefined || !holders.has(anchor);
    }),
  );
}

const RESERVED = reservedParts(kitDocuments);
const HOLDERS = regionHolders(kitDocuments, RESERVED);

const STUDIO = resolve(import.meta.dir, "..");
const SOURCES = [
  ...readdirSync(join(STUDIO, "src/surfaces"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `src/surfaces/${name}`),
  ...readdirSync(join(STUDIO, "styles"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `styles/${name}`),
].toSorted();

const read = (path: string) => JSON.parse(readFileSync(join(STUDIO, path), "utf8")) as Json;

describe("the reserved names are the kit's own", () => {
  test("the permanent live region is `error`, and the derivation cannot silently go empty", () => {
    expect(RESERVED.has("error")).toBe(true);
  });

  test("every field that draws the region is an anchor, including the one that embeds it", () => {
    for (const tag of ["jx-textfield", "jx-select", "jx-combobox", "jx-color-field"]) {
      expect(HOLDERS.has(tag)).toBe(true);
    }
    /* A kit element that merely CONTAINS content is not an anchor: `jx-dialog [part="error"]` is
       a banner rule inside a dialog, and it reaches a field in that dialog like any other. */
    expect(HOLDERS.has("jx-dialog")).toBe(false);
  });
});

describe("the walker sees every rule a style block emits", () => {
  const RESERVED_HERE = new Set(["error"]);
  const HOLDERS_HERE = new Set(["jx-textfield"]);
  const found = (style: Json) =>
    [...selectorsOf(style, "SCOPE")].flatMap((selector) =>
      collisions(selector, RESERVED_HERE, HOLDERS_HERE),
    );

  test("a nested at-rule block, a nested `&` block and a comma list", () => {
    const style: Json = {
      '& [part="row"]': { color: "red", "& [part='error']": { padding: "6px" } },
      "@(forced-colors: active)": { '& [part~="error"]': { border: "1px solid CanvasText" } },
      '& [part="help"], & [part=error]:empty': { margin: "0" },
    };
    expect(found(style)).toEqual([
      "SCOPE [part=\"row\"] [part='error']",
      'SCOPE [part~="error"]',
      "SCOPE [part=error]:empty",
    ]);
  });

  test("an anchor on the kit element that holds the region is not a collision", () => {
    const style: Json = {
      '& jx-textfield [part="error"]': { color: "red" },
      "& jx-textfield": { '& > [part="error"]': { margin: "0" } },
      '& jx-dialog [part="error"]': { margin: "0" },
      '& [part="error-card"], & [part="failure"]': { margin: "0" },
    };
    expect(found(style)).toEqual(['SCOPE jx-dialog [part="error"]']);
  });

  test("a document's node-level style blocks are read as well as its root's", () => {
    const doc: Json = {
      tagName: "section",
      style: { color: "red" },
      children: [{ tagName: "div", style: { '& [part="error"]': { margin: "0" } } }],
    };
    expect([...documentSelectors(doc)]).toEqual(['NODE [part="error"]']);
  });
});

describe("Studio names its own refusals something the kit does not use", () => {
  test.each(SOURCES)("%s", (path) => {
    const doc = read(path);
    const selectors = [...documentSelectors(doc)].flatMap((selector) =>
      collisions(selector, RESERVED, HOLDERS),
    );
    const nodes = [...elementsUnder(doc)]
      .flatMap((node) => partsOf(node))
      .filter((part) => RESERVED.has(part));
    const hint = "name your own banner `failure` or `section-error`";
    expect({ nodes, selectors }, `${path}: ${hint}`).toEqual({ nodes: [], selectors: [] });
  });
});
