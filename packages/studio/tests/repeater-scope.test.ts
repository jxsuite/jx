/**
 * Tests for src/editor/repeater-scope.ts — the pure schema-driven repeater local-scope resolver.
 *
 * Pure module (no DOM/lit), so no harness is needed. findEnclosingRepeater walks a doc by the
 * selected element's real-doc path (which carries a `map` segment inside a repeater);
 * resolveRepeaterItemFields turns the repeater's `items` binding into `item`/`index`/field tokens.
 */
import { describe, expect, test } from "bun:test";
import { isMappedArray } from "@jxsuite/schema/guards";
import { findEnclosingRepeater, resolveRepeaterItemFields } from "../src/editor/repeater-scope";

import type { JxPath } from "../src/state";
import type {
  Bindable,
  JsonValue,
  JxMappedArray,
  JxMutableNode,
  ProjectConfig,
} from "@jxsuite/schema/types";

/**
 * A minimal repeater node bound to `items`. It is typed as both a document node (so it can sit in a
 * `children` array) and a mapped array (so it can be handed to the resolver), which is exactly what
 * the editor's working document holds for a repeater member.
 */
function repeater(
  items: Bindable<JsonValue[]>,
  map?: JxMutableNode,
): JxMutableNode & JxMappedArray {
  const node: JxMutableNode = { $prototype: "Array", items, map: map ?? { tagName: "li" } };
  if (!isMappedArray(node)) {
    throw new Error('repeater fixture must carry $prototype: "Array"');
  }
  return node;
}

describe("findEnclosingRepeater", () => {
  test("finds the Array node at the prefix before the last `map`", () => {
    const arr = repeater({ $ref: "#/state/rows" });
    const doc: JxMutableNode = {
      children: [{ children: [arr], tagName: "ul" }],
      tagName: "div",
    };
    // Path to the <li> template's text: [...,"map","children",0]
    const path = ["children", 0, "children", 0, "map", "children", 0];
    expect(findEnclosingRepeater(doc, path)).toBe(arr);
  });

  test("nested repeaters — the last `map` picks the innermost Array", () => {
    const inner = repeater({ $ref: "#/state/inner" });
    const outer = repeater({ $ref: "#/state/outer" }, { children: [inner], tagName: "ul" });
    const doc: JxMutableNode = { children: [outer], tagName: "div" };
    // Outer at ["children",0]; its map template holds inner at ["map","children",0].
    // Inner element path: [...,"map","children",0,"map","children",0]
    const path = ["children", 0, "map", "children", 0, "map", "children", 0];
    expect(findEnclosingRepeater(doc, path)).toBe(inner);
  });

  test("returns null when the path contains no `map` segment", () => {
    const doc: JxMutableNode = {
      children: [{ tagName: "p" }],
      tagName: "div",
    };
    expect(findEnclosingRepeater(doc, ["children", 0])).toBeNull();
  });

  test("returns null when the node before `map` is not an Array", () => {
    // A `map` key that is not the repeater map: the prefix node is a plain element.
    const doc: JxMutableNode = {
      children: [{ map: { tagName: "span" }, tagName: "div" }],
      tagName: "div",
    };
    const path = ["children", 0, "map", "tagName"];
    expect(findEnclosingRepeater(doc, path)).toBeNull();
  });

  test("returns null for empty / null / short paths", () => {
    const doc: JxMutableNode = { tagName: "div" };
    // The first path of an empty multi-selection: there is none, so it reads as `undefined`.
    const selectedPaths: JxPath[] = [];
    const missing = selectedPaths.at(0);
    expect(findEnclosingRepeater(doc, [])).toBeNull();
    expect(findEnclosingRepeater(doc, null)).toBeNull();
    expect(findEnclosingRepeater(doc, missing)).toBeNull();
    // `map` at index 0 (mapIdx <= 0) is not a repeater interior.
    expect(findEnclosingRepeater(doc, ["map", "children", 0])).toBeNull();
  });
});

describe("resolveRepeaterItemFields", () => {
  test("(a) content collection → item.id / item.body / item.data.<field>", () => {
    const arr = repeater({ $ref: "#/state/$docs" });
    const state = { $docs: { $prototype: "ContentCollection", contentType: "docs" } };
    const projectConfig: ProjectConfig = {
      content: {
        docs: { schema: { properties: { order: { type: "number" }, title: { type: "string" } } } },
      },
    };

    const tokens = resolveRepeaterItemFields(arr, state, projectConfig);
    expect(tokens).toEqual([
      "item",
      "index",
      "item.id",
      "item.body",
      "item.data.order",
      "item.data.title",
    ]);
  });

  test("(a') import-aliased contentType def still resolves via the `contentType` string", () => {
    const arr = repeater({ $ref: "#/state/$posts" });
    // Import-aliased prototype name — detection is on the `contentType` string, not `$prototype`.
    const state = { $posts: { $prototype: "Coll", contentType: "blog" } };
    const projectConfig: ProjectConfig = {
      content: { blog: { schema: { properties: { slug: { type: "string" } } } } },
    };

    expect(resolveRepeaterItemFields(arr, state, projectConfig)).toEqual([
      "item",
      "index",
      "item.id",
      "item.body",
      "item.data.slug",
    ]);
  });

  test("(b) state-array with declared items.properties → flat item.<field>", () => {
    const arr = repeater({ $ref: "#/state/rows" });
    const state = {
      rows: {
        default: [],
        items: { properties: { name: { type: "string" }, qty: { type: "number" } } },
      },
    };
    expect(resolveRepeaterItemFields(arr, state, null)).toEqual([
      "item",
      "index",
      "item.name",
      "item.qty",
    ]);
  });

  test("(c) state-array inferred from default[0], with $-keys filtered", () => {
    const arr = repeater({ $ref: "#/state/rows" });
    const state = { rows: { default: [{ $internal: 1, label: "a", value: 2 }] } };
    expect(resolveRepeaterItemFields(arr, state, null)).toEqual([
      "item",
      "index",
      "item.label",
      "item.value",
    ]);
  });

  test("(d) inline literal array → infer fields from items[0]", () => {
    const arr = repeater([
      { done: false, title: "x" },
      { done: true, title: "y" },
    ]);
    expect(resolveRepeaterItemFields(arr, {}, null)).toEqual([
      "item",
      "index",
      "item.done",
      "item.title",
    ]);
  });

  test("(e) fallback → exactly ['item','index'] for unresolvable/primitive/empty bindings", () => {
    // Ref target missing from state.
    expect(resolveRepeaterItemFields(repeater({ $ref: "#/state/gone" }), {}, null)).toEqual([
      "item",
      "index",
    ]);
    // Ref to a non-object def with neither contentType, items.properties, nor object default[0].
    expect(
      resolveRepeaterItemFields(
        repeater({ $ref: "#/state/nums" }),
        { nums: { default: [1, 2, 3] } },
        null,
      ),
    ).toEqual(["item", "index"]);
    // Content collection whose contentType has no schema in projectConfig → just item.id/body.
    expect(
      resolveRepeaterItemFields(
        repeater({ $ref: "#/state/c" }),
        { c: { contentType: "missing" } },
        { content: {} } satisfies ProjectConfig,
      ),
    ).toEqual(["item", "index", "item.id", "item.body"]);
    // Inline array of primitives → no fields.
    expect(resolveRepeaterItemFields(repeater([1, 2, 3]), {}, null)).toEqual(["item", "index"]);
    // Empty inline array.
    expect(resolveRepeaterItemFields(repeater([]), {}, null)).toEqual(["item", "index"]);
    // A non-state, non-array `items` (e.g. a bare ref not under #/state/).
    expect(resolveRepeaterItemFields(repeater({ $ref: "#/context/x" }), {}, null)).toEqual([
      "item",
      "index",
    ]);
  });

  test("caps inferred breadth at 50 fields", () => {
    const wide = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`f${i}`, i]));
    const arr = repeater([wide]);
    const tokens = resolveRepeaterItemFields(arr, {}, null);
    // 2 base (item/index) + 50 capped fields.
    expect(tokens.length).toBe(52);
  });
});
