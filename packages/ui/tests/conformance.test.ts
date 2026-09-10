/**
 * Every kit document, held to the kit contract (specs/ui.md §3.2): valid against the schema, clean
 * under the overlay lint, a `part` on every internal node, no raw colour in a style, and every icon
 * a stylebook page names actually shipped.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { splitSelectorList } from "@jxsuite/runtime/css";
import { validateDocument } from "@jxsuite/schema";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { themeCSS } from "../src/theme.ts";
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
 * `src/documents.ts` IS a hand-maintained second list, and this is what keeps it in step.
 *
 * `check-icons.ts` retired its Spectrum rule 2 — "a registered element the registry never imports"
 * — on the stated ground that the kit has no such seam, because `registerUi()` defines each tag
 * from the document itself. That is half true: there is no tag/class split any more, but a
 * component whose JSON is never IMPORTED here is silently not a kit element at all. It ships in the
 * repository, passes every per-document check below, and does not exist at runtime — the same class
 * of failure the old rule caught, one seam further along, so it gets the same treatment.
 */
describe("every authored component is a registered document", () => {
  test("components/*.json and documents name the same tags", () => {
    const authored = readdirSync(resolve(root, "components"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .toSorted();
    expect(Object.keys(documents).toSorted()).toEqual(authored);
    /* And each key is the tag the document declares, so the map cannot file one under another's
       name — the second half of the seam, and the half a key list alone would not see. */
    for (const [tag, doc] of Object.entries(documents)) {
      expect((doc as { tagName?: string }).tagName, tag).toBe(tag);
    }
  });
});

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
          /* Except a `<slot>`, which leaves NO NODE once its content is distributed (spec.md
             §16.6). A `part` there names nothing at runtime, so requiring one would require every
             element to carry a provably dead attribute — and worse, would make a reader think the
             slot is addressable. Its CONTAINER is what a rule keys on. */
          if (node.tagName === "slot") {
            expect(node.attributes?.part, `${label} <slot> must NOT carry a part`).toBeUndefined();
            continue;
          }
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
        /* The UA's `[hidden] { display: none }` loses to any authored `display`, so a part that is
           both bound to `hidden` and given a display of its own needs a `[hidden]` rule, or it
           never hides — the chevron on every context-menu row, verified in Chrome.

           Three things this gate used to miss, each of which is how a document escapes it rather
           than how it fails. It read `node.hidden` only, so a part bound through
           `attributes.hidden` — the only spelling available inside a `$map` row — was invisible to
           it: `jx-select` has six such parts and the gate saw none of them. It looked up
           `& > [part="X"]` by exact key, so a part styled as a DESCENDANT rather than a child was
           invisible too. And it compared the whole key, so a rule written as a selector LIST —
           three parts hidden by one rule, which is the compact and correct way to write it — was
           invisible a third time. Each blind spot passes silently, which is the shape the `[hidden]`
           defect itself has. */
        const style = (doc.style ?? {}) as Record<string, unknown>;
        /* Every selector member in the block, mapped to the declarations written for it. A key is
           a selector LIST, so it is split before anything is looked up. */
        const members = new Map<string, Record<string, unknown>>();
        for (const [key, value] of Object.entries(style)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }
          for (const member of splitSelectorList(key)) {
            const at = members.get(member) ?? {};
            Object.assign(at, value as Record<string, unknown>);
            members.set(member, at);
          }
        }
        /** Declarations for a member selecting `part`, `combinator` being `""` or `"[hidden]"`. */
        const forPart = (part: string, suffix: string) => {
          const wanted = `[part="${part}"]${suffix}`;
          const hit = [...members].find(([member]) => {
            const rest = member.startsWith("&") ? member.slice(1).trimStart() : member;
            return (rest.startsWith(">") ? rest.slice(1).trimStart() : rest) === wanted;
          });
          return hit?.[1];
        };
        for (const [label, node] of internalNodes(doc)) {
          const part = node.attributes?.part;
          const bound = node.hidden !== undefined || node.attributes?.hidden !== undefined;
          if (!bound || typeof part !== "string") {
            continue;
          }
          const rule = forPart(part, "");
          if (rule && "display" in rule) {
            expect(
              forPart(part, "[hidden]")?.["display"],
              `${label} <${node.tagName} part=${part}> declares a display and binds hidden, so it needs a [hidden] rule`,
            ).toBe("none");
          }
        }
      });

      test("every element says what hidden means to it", () => {
        /* EVERY element, not only one that declares a display. The runtime now writes
           `display: block` into the element's OWN RULE when its base block declares none
           (spec.md §9.6), and an author declaration beats the UA's `[hidden] { display: none }`
           at any specificity — so an element gets a box it cannot hide either way, and which one
           it is makes no difference.

           This gate used to be written `if ("display" in style)`, which made it SELF-DISABLING:
           deleting an element's base display did not redden it, it silenced it. The one check
           that touched the base display was the one check its absence turned off. */
        const style = (doc.style ?? {}) as Record<string, unknown>;
        const hiddenRule = style["&[hidden]"] as Record<string, unknown> | undefined;
        expect(hiddenRule?.display, `${doc.tagName} needs "&[hidden]": { "display": "none" }`).toBe(
          "none",
        );
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

describe("the kit ships no CSS class", () => {
  /* The rule, in the project owner's words: "HTML and CSS are entirely eclipsed and contained
     within the Jx schema." Every declaration lives in the `style` object of the definition that
     owns the box it paints (ui.md §3.1), so a `class` attribute is a rule reached by name from
     somewhere else — which is the shape that has nowhere to live. The kit carried nine of them and
     now carries none; this is what keeps it there.

     The one legal reason for a class is a platform or third-party contract the schema does not
     own. There is no such case in the kit today, so the allowance is empty rather than notional:
     an entry has to be added deliberately, with its owner named. */
  const PLATFORM_CLASSES: readonly string[] = [];

  /**
   * Every `class` a document writes, however it is spelled.
   *
   * @param node The document or subtree.
   * @yields {[string, string]} A label for messages, and the class value.
   */
  function* classAttributes(node: unknown, path = "root"): Generator<[string, string]> {
    if (Array.isArray(node)) {
      for (const [i, item] of node.entries()) {
        yield* classAttributes(item, `${path}[${i}]`);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // `className` is the DOM property spelling; `class` the attribute one. Both are a class.
      if ((key === "class" || key === "className") && typeof value === "string") {
        yield [`${path}.${key}`, value];
      }
      yield* classAttributes(value, `${path}.${key}`);
    }
  }

  for (const [tag, doc] of Object.entries(documents)) {
    test(`${tag} writes no class`, () => {
      for (const [where, value] of classAttributes(doc)) {
        for (const name of value.split(/\s+/).filter(Boolean)) {
          expect(PLATFORM_CLASSES, `${where}: ${name}`).toContain(name);
        }
      }
    });
  }

  for (const [name, page] of Object.entries(stylebook)) {
    test(`${name} writes no class`, () => {
      for (const [where, value] of classAttributes(page)) {
        for (const cls of value.split(/\s+/).filter(Boolean)) {
          expect(PLATFORM_CLASSES, `${where}: ${cls}`).toContain(cls);
        }
      }
    });
  }

  test("and the theme sheet declares none either", () => {
    expect([...themeCSS().matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])).toEqual([]);
  });
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
