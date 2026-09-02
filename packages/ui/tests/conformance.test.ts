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

  test("the icon gallery shows every shipped glyph", () => {
    const names = stylebook["jx-icon.json"]!.state!.names as string[];
    expect([...names].toSorted()).toEqual([...ICON_NAMES]);
  });
});
