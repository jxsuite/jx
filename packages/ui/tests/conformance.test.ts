/**
 * Every kit document, held to the kit contract (specs/ui.md §3.2): valid against the schema, clean
 * under the overlay lint, a `part` on every internal node, no raw colour in a style, and every icon
 * a stylebook page names actually shipped.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateDocument } from "@jxsuite/schema";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { ICON_NAMES } from "../src/icons.ts";
import type { IconList } from "../src/icons-build.ts";

const root = resolve(import.meta.dir, "..");
const stylebookDir = resolve(root, "stylebook");
const stylebook: Record<string, JxDocument> = Object.fromEntries(
  readdirSync(stylebookDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [
      name,
      JSON.parse(readFileSync(resolve(stylebookDir, name), "utf8")) as JxDocument,
    ]),
);
const list = JSON.parse(readFileSync(resolve(root, "icons/list.json"), "utf8")) as IconList;

/**
 * Every element node below the root, depth-first.
 *
 * @yields {[string, JxElement]} A label for messages, and the node
 */
function* internalNodes(node: JxElement, path = "root"): Generator<[string, JxElement]> {
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const [i, child] of kids.entries()) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const el = child as JxElement;
    const label = `${path}.children[${i}]`;
    if (typeof el.tagName === "string") {
      yield [label, el];
    }
    yield* internalNodes(el, label);
    const mapped = (el as { map?: JxElement }).map;
    if (mapped) {
      yield [`${label}.map`, mapped];
      yield* internalNodes(mapped, `${label}.map`);
    }
    // A `$switch` container's branches are real rendered nodes and were invisible here: every one
    // Of jx-textfield's controls lives in one, so the part, token and icon rules below were only
    // Ever checked against the containers.
    const { cases } = el as { cases?: Record<string, unknown> };
    for (const [key, branch] of Object.entries(cases ?? {})) {
      for (const [branchIndex, entry] of (Array.isArray(branch) ? branch : [branch]).entries()) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const caseLabel = `${label}.cases.${key}${Array.isArray(branch) ? `[${branchIndex}]` : ""}`;
        if (typeof (entry as JxElement).tagName === "string") {
          yield [caseLabel, entry as JxElement];
        }
        yield* internalNodes(entry as JxElement, caseLabel);
      }
    }
  }
}

/**
 * Every string value in a style object, nested selectors and at-rules included.
 *
 * @yields {string} One declaration value
 */
function* styleValues(style: unknown): Generator<string> {
  if (!style || typeof style !== "object") {
    return;
  }
  for (const value of Object.values(style as Record<string, unknown>)) {
    if (typeof value === "string") {
      yield value;
    } else {
      yield* styleValues(value);
    }
  }
}

/**
 * The state keys a document binds to an `on*` key, anywhere in its tree.
 *
 * @param node The document or subtree.
 * @returns {Set<string>} The state key names, without their pointer prefix.
 */
function handlerKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      handlerKeys(item, out);
    }
    return out;
  }
  if (!node || typeof node !== "object") {
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const ref = (value as { $ref?: string })?.$ref;
    if (key.startsWith("on") && typeof ref === "string") {
      out.add(ref.split("/").pop() ?? "");
    }
    handlerKeys(value, out);
  }
  return out;
}

const HEX = /#[0-9a-f]{3,8}\b/i;

describe("kit documents", () => {
  for (const [tag, doc] of Object.entries(documents)) {
    describe(tag, () => {
      test("is a valid custom-element document", async () => {
        expect(doc.tagName).toBe(tag);
        expect(tag).toContain("-");
        const result = await validateDocument(doc as Record<string, unknown>);
        expect(result.errors).toBeNull();
        expect(result.valid).toBe(true);
      });

      test("passes the overlay lint", () => {
        expect(findPopoverDefects(doc)).toEqual([]);
      });

      test("passes the accessibility lint", () => {
        expect(findA11yDefects(doc)).toEqual([]);
      });

      test("names every internal node with a part", () => {
        for (const [label, node] of internalNodes(doc)) {
          expect(node.attributes?.part, `${label} <${node.tagName}>`).toBeString();
        }
      });

      test("styles with tokens, never a raw colour", () => {
        const nodes: [string, JxElement][] = [["root", doc], ...internalNodes(doc)];
        for (const [label, node] of nodes) {
          for (const value of styleValues(node.style)) {
            expect(HEX.test(value), `${label}: ${value}`).toBe(false);
          }
        }
      });

      test("a part that is hidden by a binding says what hidden means to it", () => {
        // The UA's `[hidden] { display: none }` loses to any authored `display`, so a part that is
        // Both bound to `hidden` and given a display of its own needs a `[hidden]` rule, or it
        // Never hides — the chevron on every context-menu row, verified in Chrome.
        const style = (doc.style ?? {}) as Record<string, unknown>;
        for (const [label, node] of internalNodes(doc)) {
          const part = node.attributes?.part;
          if (node.hidden === undefined || typeof part !== "string") {
            continue;
          }
          const rule = style[`& > [part="${part}"]`] as Record<string, unknown> | undefined;
          if (rule && "display" in rule) {
            const hiddenRule = style[`& > [part="${part}"][hidden]`] as
              | Record<string, unknown>
              | undefined;
            expect(hiddenRule?.display, `${label} <${node.tagName} part=${part}>`).toBe("none");
          }
        }
      });

      test("a host that declares its own display says what hidden means to it", () => {
        // The runtime gives a custom element `display: block` only when its definition declares
        // No display; one that does beats the UA's `[hidden]` rule, so it needs its own.
        const style = (doc.style ?? {}) as Record<string, unknown>;
        if ("display" in style) {
          const hiddenRule = style["&[hidden]"] as Record<string, unknown> | undefined;
          expect(hiddenRule?.display).toBe("none");
        }
      });

      test("names only glyphs the kit ships", () => {
        // The stylebook gate below reads a page's `state.names`; nothing read an icon name inside
        // A COMPONENT until this. A typo there renders an empty 16x16 box with every gate green,
        // Which is how `jx-textfield`'s clear button nearly shipped one.
        for (const [label, node] of internalNodes(doc)) {
          if (node.tagName !== "jx-icon") {
            continue;
          }
          const props = (node as { $props?: Record<string, unknown> }).$props ?? {};
          const name = props["name"] ?? node.attributes?.["name"];
          if (typeof name !== "string" || name.includes("${")) {
            continue;
          }
          expect(ICON_NAMES, `${label} <jx-icon name="${name}">`).toContain(name);
        }
      });

      test("no event handler declares parameters", () => {
        /* A `$prototype: "Function"` WITH `parameters` is a callable the `call` operator invokes
           with positional arguments; WITHOUT them it is an event handler receiving the scope and
           the event. Bound to an `on*` key, the parameterised form is handed the scope as its
           first argument, so `$args/event` — and `event#/…` — resolve to undefined and the
           handler silently does nothing. Measured: a click through the parameterised form wrote
           "undefined" where the plain form wrote "click". No lint sees it and the page looks
           right until someone presses the control. */
        const bound = handlerKeys(doc);
        for (const [key, entry] of Object.entries(doc.state ?? {})) {
          if (!bound.has(key)) {
            continue;
          }
          const params = (entry as { parameters?: unknown }).parameters;
          expect(params, `state.${key} is bound to an on* key`).toBeUndefined();
        }
      });

      test("documents every prop", () => {
        for (const [key, entry] of Object.entries(doc.state ?? {})) {
          if (entry && typeof entry === "object" && "default" in entry) {
            expect((entry as { description?: string }).description, key).toBeString();
          }
        }
      });
    });
  }
});

describe("stylebook pages", () => {
  for (const [name, page] of Object.entries(stylebook)) {
    test(`${name} passes the overlay and accessibility lints`, () => {
      expect(findPopoverDefects(page)).toEqual([]);
      expect(findA11yDefects(page)).toEqual([]);
    });
  }

  test("exist for every element", () => {
    for (const tag of Object.keys(documents)) {
      expect(Object.keys(stylebook), tag).toContain(`${tag}.json`);
    }
  });

  for (const [name, page] of Object.entries(stylebook)) {
    test(`${name} is valid, lint-clean, and references only shipped elements and icons`, async () => {
      const result = await validateDocument(page as Record<string, unknown>);
      expect(result.errors).toBeNull();
      expect(result.valid).toBe(true);
      expect(findPopoverDefects(page)).toEqual([]);
      for (const entry of page.$elements ?? []) {
        if (typeof entry === "object" && "$ref" in entry) {
          const tag = entry.$ref.replace(/^.*\//, "").replace(/\.json$/, "");
          expect(Object.keys(documents), entry.$ref).toContain(tag);
        }
      }
      const names = (page.state?.names as string[] | undefined) ?? [];
      for (const iconName of names) {
        expect(ICON_NAMES, iconName).toContain(iconName);
        expect(Object.keys(list), iconName).toContain(iconName);
      }
    });
  }

  for (const [name, page] of Object.entries(stylebook)) {
    test(`${name} binds no parameterised body to an event`, () => {
      const bound = handlerKeys(page);
      for (const [key, entry] of Object.entries(page.state ?? {})) {
        if (!bound.has(key)) {
          continue;
        }
        expect((entry as { parameters?: unknown }).parameters, `state.${key}`).toBeUndefined();
      }
    });
  }

  test("the icon gallery shows every shipped glyph", () => {
    const names = stylebook["jx-icon.json"]!.state!.names as string[];
    expect([...names].toSorted()).toEqual([...ICON_NAMES]);
  });
});
