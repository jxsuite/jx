/**
 * Tests for src/editor/repeater-scope.ts — the pure schema-driven repeater local-scope resolver.
 *
 * Pure module (no DOM/lit), so no harness is needed. findEnclosingRepeater walks a doc by the
 * selected element's real-doc path (which carries a `map` segment inside a repeater);
 * repeaterItemFields turns the repeater's `items` binding into the item's fields, read here as the
 * tokens a template spells them with, after the two row words every repeater offers.
 */
import { describe, expect, test } from "bun:test";
import { isMappedArray } from "@jxsuite/schema/guards";
import {
  childrenTemplate,
  fieldOfChildrenTemplate,
  findEnclosingRepeater,
  mapRefLabel,
  repeaterItemFields,
  tagTitlesAt,
  tagTitlesOf,
} from "../src/editor/repeater-scope";

import type { JxPath } from "../src/state";
import type {
  Bindable,
  JsonObject,
  JsonValue,
  JxMappedArray,
  JxMutableNode,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";

/** The row words and every field token a template inside the repeater at `path` can read. */
function resolveRepeaterItemFields(
  doc: JxMutableNode,
  path: JxPath | null | undefined,
  config: ProjectConfig | null | undefined,
): string[] {
  return ["item", "index", ...repeaterItemFields(doc, path, config).map((field) => field.token)];
}

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

/** The tokens a template directly inside `arr` is offered, with `state` as its document's state. */
function fieldsOf(
  arr: JxMutableNode,
  state: Record<string, JxStateDefinition>,
  projectConfig: ProjectConfig | null,
): string[] {
  const doc: JxMutableNode = { children: [arr], state, tagName: "div" };
  return resolveRepeaterItemFields(doc, ["children", 0, "map"], projectConfig);
}

describe("resolveRepeaterItemFields", () => {
  test("(a) content collection → item.id / item.body / item.data.<field>", () => {
    const arr = repeater({ $ref: "#/state/$docs" });
    const state = { $docs: { $prototype: "ContentCollection", contentType: "docs" } };
    const projectConfig: ProjectConfig = {
      content: {
        docs: { schema: { properties: { order: { type: "number" }, title: { type: "string" } } } },
      },
    };

    const tokens = fieldsOf(arr, state, projectConfig);
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

    expect(fieldsOf(arr, state, projectConfig)).toEqual([
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
    expect(fieldsOf(arr, state, null)).toEqual(["item", "index", "item.name", "item.qty"]);
  });

  test("(c) state-array inferred from default[0], with $-keys filtered", () => {
    const arr = repeater({ $ref: "#/state/rows" });
    const state = { rows: { default: [{ $internal: 1, label: "a", value: 2 }] } };
    expect(fieldsOf(arr, state, null)).toEqual(["item", "index", "item.label", "item.value"]);
  });

  test("(d) inline literal array → infer fields from items[0]", () => {
    const arr = repeater([
      { done: false, title: "x" },
      { done: true, title: "y" },
    ]);
    expect(fieldsOf(arr, {}, null)).toEqual(["item", "index", "item.done", "item.title"]);
  });

  test("items that are neither a list nor a pointer say nothing", () => {
    // SAFETY: deliberately outside the type, as a hand-edited document can be.
    const asNode = (json: JsonObject) => json as JxMutableNode;
    const handEdited = asNode({ $prototype: "Array", items: "${state.rows}" });
    const doc: JxMutableNode = {
      children: [handEdited],
      state: { rows: [{ title: "x" }] },
      tagName: "div",
    };
    expect(resolveRepeaterItemFields(doc, ["children", 0, "map"], null)).toEqual(["item", "index"]);
  });

  test("(e) fallback → exactly ['item','index'] for unresolvable/primitive/empty bindings", () => {
    // Ref target missing from state.
    expect(fieldsOf(repeater({ $ref: "#/state/gone" }), {}, null)).toEqual(["item", "index"]);
    // Ref to a non-object def with neither contentType, items.properties, nor object default[0].
    expect(
      fieldsOf(repeater({ $ref: "#/state/nums" }), { nums: { default: [1, 2, 3] } }, null),
    ).toEqual(["item", "index"]);
    // Content collection whose contentType has no schema in projectConfig → just item.id/body.
    expect(
      fieldsOf(repeater({ $ref: "#/state/c" }), { c: { contentType: "missing" } }, {
        content: {},
      } satisfies ProjectConfig),
    ).toEqual(["item", "index", "item.id", "item.body"]);
    // Inline array of primitives → no fields.
    expect(fieldsOf(repeater([1, 2, 3]), {}, null)).toEqual(["item", "index"]);
    // Empty inline array.
    expect(fieldsOf(repeater([]), {}, null)).toEqual(["item", "index"]);
    // A non-state, non-array `items` (e.g. a bare ref not under #/state/).
    expect(fieldsOf(repeater({ $ref: "#/context/x" }), {}, null)).toEqual(["item", "index"]);
  });

  test("caps inferred breadth at 50 fields", () => {
    const wide = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`f${i}`, i]));
    const arr = repeater([wide]);
    const tokens = fieldsOf(arr, {}, null);
    // 2 base (item/index) + 50 capped fields.
    expect(tokens.length).toBe(52);
  });
});

describe("repeaterItemFields", () => {
  const inside: JxPath = ["children", 0, "map"];
  /** One repeater over `$ref`, with the given state, as the first child of a document. */
  const docWith = (ref: string, state: Record<string, JxStateDefinition>): JxMutableNode => ({
    children: [repeater({ $ref: ref })],
    state,
    tagName: "div",
  });
  const tokens = (doc: JxMutableNode, path: JxPath, config: ProjectConfig | null = null) =>
    repeaterItemFields(doc, path, config).map((field) => field.token);

  test("every field carries the pointer a $ref holds beside the token a template reads", () => {
    const doc = docWith("#/state/team", { team: { contentType: "team" } });
    const config: ProjectConfig = {
      content: { team: { schema: { properties: { role: { type: "string" } } } } },
    };
    expect(repeaterItemFields(doc, inside, config).at(-1)).toEqual({
      holdsNodes: false,
      isArray: false,
      path: ["data", "role"],
      pointer: "$map/item/data/role",
      token: "item.data.role",
    });
  });

  test("a field carries the title its schema declares, and none where it declares none", () => {
    const doc = docWith("#/state/team", { team: { contentType: "team" } });
    const config: ProjectConfig = {
      $defs: { Person: { title: "Team member", type: "object" } },
      content: {
        team: {
          schema: {
            properties: {
              bio: { title: "   ", type: "string" },
              joined: { title: "Start date", type: "string" },
              lead: { $ref: "#/$defs/Person" },
              role: { type: "string" },
            },
          },
        },
      },
    };
    const titles = Object.fromEntries(
      repeaterItemFields(doc, inside, config).map((field) => [field.token, field.title]),
    );
    expect(titles["item.data.joined"]).toBe("Start date");
    // The title a pointed-at definition declares.
    expect(titles["item.data.lead"]).toBe("Team member");
    expect(titles["item.data.role"]).toBeUndefined();
    // A blank title names nothing.
    expect(titles["item.data.bio"]).toBeUndefined();
    expect(tagTitlesAt(doc, inside, config)["item.data.joined"]).toBe("Start date");
    expect(tagTitlesAt(doc, ["children", 0], config)).toEqual({});
  });

  test("a document's titles are every repeater's, less a field two of them title differently", () => {
    const person = (title: string): ProjectConfig["content"] => ({
      a: {
        schema: {
          properties: {
            name: { title, type: "string" },
            when: { title: "Date A", type: "string" },
          },
        },
      },
      b: {
        schema: {
          properties: {
            name: { title: "Name", type: "string" },
            when: { title: "Date B", type: "string" },
          },
        },
      },
    });
    const doc: JxMutableNode = {
      children: [
        repeater({ $ref: "#/state/as" }),
        { children: [repeater({ $ref: "#/state/bs" })], tagName: "div" },
      ],
      state: { as: { contentType: "a" }, bs: { contentType: "b" } },
      tagName: "div",
    };
    // Both call the field "Name": one title. They disagree about `when`: neither is kept.
    expect(tagTitlesOf(doc, { content: person("Name") })).toEqual({ "item.data.name": "Name" });
    expect(tagTitlesOf(doc, null)).toEqual({});
    expect(
      tagTitlesOf({ tagName: "div", textContent: "No repeater" }, { content: person("x") }),
    ).toEqual({});
  });

  test("a title is trimmed, and a field titled differently once stays untitled for a third repeater that agrees with the first", () => {
    const named = (title: string) => ({
      schema: { properties: { name: { title, type: "string" } } },
    });
    const config: ProjectConfig = {
      content: { a: named("  Name  "), b: named("Label"), c: named("Name") },
    };
    const [first, second, third] = [
      repeater({ $ref: "#/state/as" }),
      repeater({ $ref: "#/state/bs" }),
      repeater({ $ref: "#/state/cs" }),
    ];
    const state = {
      as: { contentType: "a" },
      bs: { contentType: "b" },
      cs: { contentType: "c" },
    };
    const all: JxMutableNode = { children: [first, second, third], state, tagName: "div" };
    expect(tagTitlesOf(all, config)).toEqual({});
    const two: JxMutableNode = { children: [first, third], state, tagName: "div" };
    expect(tagTitlesOf(two, config)).toEqual({ "item.data.name": "Name" });
  });

  test("a repeater written in the document's state, media or elements is not one the page draws", () => {
    const config: ProjectConfig = {
      content: { a: { schema: { properties: { name: { title: "Name", type: "string" } } } } },
    };
    const inState = repeater({ $ref: "#/state/as" });
    // A hand-edited document holds a repeater wherever it likes; read as JSON, it is what is on disk.
    const held = JSON.stringify(inState);
    const doc: JxMutableNode = JSON.parse(
      `{"$elements":[${held}],"$media":{"wide":${held}},"children":[],"state":{"as":{"contentType":"a"},"held":${held}},"tagName":"div"}`,
    );
    expect(tagTitlesOf(doc, config)).toEqual({});
  });

  test("a member name is escaped in the pointer and bracketed in the token", () => {
    const doc = docWith("#/state/rows", { rows: [{ "a/b": 1, "my-field": 2, "t~x": 3 }] });
    expect(repeaterItemFields(doc, inside, null).map((f) => [f.token, f.pointer])).toEqual([
      ['item["a/b"]', "$map/item/a~1b"],
      ['item["my-field"]', "$map/item/my-field"],
      ['item["t~x"]', "$map/item/t~0x"],
    ]);
  });

  test("outside a repeater there is nothing, and no shape is invented for a null path", () => {
    const doc = docWith("#/state/rows", { rows: [{ a: 1 }] });
    expect(repeaterItemFields(doc, ["children", 0], null)).toEqual([]);
    expect(repeaterItemFields(doc, null, null)).toEqual([]);
  });

  describe("where a shape comes from", () => {
    test("a naked array state entry", () => {
      const doc = docWith("#/state/rows", { rows: [{ title: "x" }] });
      expect(tokens(doc, inside)).toEqual(["item.title"]);
    });

    test("a list inside a naked object state entry", () => {
      const doc = docWith("#/state/nav/sections", { nav: { sections: [{ label: "a" }] } });
      expect(tokens(doc, inside)).toEqual(["item.label"]);
    });

    test("a list inside a declared object, reached by a deep pointer", () => {
      const doc = docWith("#/state/nav/data/sections", {
        nav: {
          properties: {
            data: {
              properties: {
                sections: { items: { properties: { label: { type: "string" } } }, type: "array" },
              },
            },
          },
        },
      });
      expect(tokens(doc, inside)).toEqual(["item.label"]);
    });

    test("a numeric member of a pointer reads the list's items", () => {
      const doc = docWith("#/state/grid/0", { grid: [[{ cell: 1 }]] });
      expect(tokens(doc, inside)).toEqual(["item.cell"]);
    });

    test("a pointer that walks off the schema resolves to nothing", () => {
      const doc = docWith("#/state/rows/nope/deeper", { rows: { default: [{ a: 1 }] } });
      expect(tokens(doc, inside)).toEqual([]);
    });

    test("a list a ContentEntry holds, which is one entry and not a list of them", () => {
      const doc = docWith("#/state/post/data/related", {
        post: { $prototype: "ContentEntry", contentType: "posts", id: "a" },
      });
      const config: ProjectConfig = {
        content: {
          posts: {
            schema: {
              properties: {
                related: { items: { properties: { slug: { type: "string" } } }, type: "array" },
              },
            },
          },
        },
      };
      expect(tokens(doc, inside, config)).toEqual(["item.slug"]);
    });

    test("a type the document's $defs names, through a typed value and through items", () => {
      const doc: JxMutableNode = {
        $defs: {
          Member: { properties: { name: { type: "string" } }, type: "object" },
          Team: { items: { $ref: "#/$defs/Member" }, type: "array" },
        },
        children: [repeater({ $ref: "#/state/team" })],
        // SAFETY: `documents.md` Shape 2 permits a `$ref` type; `JxStateObject.type` names only a string.
        state: { team: { default: [], type: { $ref: "#/$defs/Team" } } as JsonObject },
        tagName: "div",
      };
      expect(tokens(doc, inside)).toEqual(["item.name"]);
    });

    test("a type the project's $defs names", () => {
      const doc = docWith("#/state/rows", {
        rows: { default: [], items: { $ref: "#/$defs/Row" } },
      });
      const config: ProjectConfig = {
        $defs: { Row: { properties: { sku: { type: "string" } } } },
      };
      expect(tokens(doc, inside, config)).toEqual(["item.sku"]);
    });

    test("a $defs pointer naming no type, and a pointer to no known place, say nothing", () => {
      const docOf = (pointer: string): JxMutableNode => ({
        children: [repeater({ $ref: "#/state/rows" })],
        state: { rows: { default: [], items: { $ref: pointer } } },
        tagName: "div",
      });
      expect(tokens(docOf("#/$defs/"), inside)).toEqual([]);
      expect(tokens(docOf("./member.schema.json"), inside)).toEqual([]);
    });

    test("a list of lists keeps the fields of every row's members", () => {
      const doc = docWith("#/state/rows", {
        rows: [{ tags: [[{ a: 1 }]] }, { tags: [[{ b: 2 }]] }],
      });
      const rows = docWith("#/state/rows", { rows: [[{ a: 1 }], [{ b: 2 }]] });
      expect(tokens(doc, inside)).toEqual(["item.tags"]);
      // A row of the outer list is itself a list, so its shape has `items` and no fields to offer.
      expect(tokens(rows, inside)).toEqual([]);
      const nested: JxMutableNode = {
        children: [
          repeater(
            { $ref: "#/state/rows" },
            { children: [repeater({ $ref: "$map/item" })], tagName: "ul" },
          ),
        ],
        state: { rows: [[{ a: 1 }], [{ b: 2 }]] },
        tagName: "div",
      };
      const innerTemplate = ["children", 0, "map", "children", 0, "map"];
      expect(tokens(nested, innerTemplate)).toEqual(["item.a", "item.b"]);
    });

    test("a pointer loop in $defs ends rather than hanging", () => {
      const doc: JxMutableNode = {
        $defs: { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } },
        children: [repeater({ $ref: "#/state/rows" })],
        state: { rows: { default: [], items: { $ref: "#/$defs/A" } } },
        tagName: "div",
      };
      expect(tokens(doc, inside)).toEqual([]);
    });

    test("the union of a sample's rows, so a field the first row lacks is still found", () => {
      const doc = docWith("#/state/rows", {
        rows: [{ a: 1, meta: { x: 1 } }, { b: 2, meta: { y: 2 } }, 3],
      });
      expect(tokens(doc, inside)).toEqual([
        "item.a",
        "item.meta",
        "item.b",
        "item.meta.x",
        "item.meta.y",
      ]);
    });

    test("a computed entry says nothing until it runs", () => {
      const doc = docWith("#/state/rows", {
        rows: { $expression: { operator: "??", target: null, value: null } },
      });
      expect(tokens(doc, inside)).toEqual([]);
    });

    test("a schema with no field declarations falls back to the sample beside it", () => {
      const doc = docWith("#/state/rows", {
        rows: { default: [{ a: 1 }], items: { type: "object" }, type: "array" },
      });
      expect(tokens(doc, inside)).toEqual(["item.a"]);
    });
  });

  describe("nested data", () => {
    test("a nested object is offered, and so are its members", () => {
      const doc = docWith("#/state/rows", { rows: [{ seo: { title: "x" } }] });
      expect(tokens(doc, inside)).toEqual(["item.seo", "item.seo.title"]);
    });

    test("a list is offered and flagged, and not entered", () => {
      const doc = docWith("#/state/rows", {
        rows: {
          default: [],
          items: {
            properties: {
              a: { type: "array" },
              tags: { items: { properties: { x: {} } }, type: "array" },
            },
          },
        },
      });
      const fields = repeaterItemFields(doc, inside, null);
      expect(fields.map((f) => [f.token, f.isArray])).toEqual([
        ["item.a", true],
        ["item.tags", true],
      ]);
    });

    test("a relationship is entered as the full entry the loader resolves it to", () => {
      const doc = docWith("#/state/posts", { posts: { contentType: "posts" } });
      const config: ProjectConfig = {
        content: {
          authors: { schema: { properties: { name: { type: "string" } } } },
          posts: { schema: { properties: { author: { $ref: "#/content/authors" } } } },
        },
      };
      expect(tokens(doc, inside, config)).toEqual([
        "item.id",
        "item.body",
        "item.data.author",
        "item.data.author.id",
        "item.data.author.body",
        "item.data.author.data.name",
      ]);
    });

    test("a relationship cycle stops at the content type it already passed through", () => {
      const doc = docWith("#/state/posts", { posts: { contentType: "posts" } });
      const config: ProjectConfig = {
        content: {
          authors: { schema: { properties: { latest: { $ref: "#/content/posts" } } } },
          posts: { schema: { properties: { author: { $ref: "#/content/authors" } } } },
        },
      };
      expect(tokens(doc, inside, config)).toEqual([
        "item.id",
        "item.body",
        "item.data.author",
        "item.data.author.id",
        "item.data.author.body",
        "item.data.author.data.latest",
      ]);
    });

    test("a nested repeater reads the field of the item around it", () => {
      const inner = repeater({ $ref: "$map/item/data/stops" });
      const doc: JxMutableNode = {
        children: [repeater({ $ref: "#/state/trips" }, inner)],
        state: { trips: { contentType: "trips" } },
        tagName: "div",
      };
      const config: ProjectConfig = {
        content: {
          trips: {
            schema: {
              properties: {
                stops: { items: { properties: { city: { type: "string" } } }, type: "array" },
              },
            },
          },
        },
      };
      expect(tokens(doc, ["children", 0, "map", "map"], config)).toEqual(["item.city"]);
      // The outer item is still what the inner repeater's own Items position reads.
      expect(tokens(doc, ["children", 0, "map"], config)).toContain("item.data.stops");
    });

    test("a repeater over the outer item itself reads a list of lists", () => {
      const inner = repeater({ $ref: "$map/item" });
      const doc: JxMutableNode = {
        children: [repeater({ $ref: "#/state/grid" }, inner)],
        state: { grid: [[{ cell: 1 }]] },
        tagName: "div",
      };
      expect(tokens(doc, ["children", 0, "map", "map"])).toEqual(["item.cell"]);
    });

    test("the #/$map/ spelling the runtime also accepts reads the same field", () => {
      const inner = repeater({ $ref: "#/$map/item/tags" });
      const doc: JxMutableNode = {
        children: [repeater({ $ref: "#/state/rows" }, inner)],
        state: { rows: [{ tags: [{ label: "x" }] }] },
        tagName: "div",
      };
      expect(tokens(doc, ["children", 0, "map", "map"])).toEqual(["item.label"]);
    });
  });

  test("the cap cuts the deepest fields, never a top-level one", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`deep${String(i)}`, { type: "string" }]),
    );
    const doc = docWith("#/state/rows", {
      rows: {
        default: [],
        items: { properties: { nested: { properties: wide }, plain: { type: "string" } } },
      },
    });
    const found = tokens(doc, inside);
    expect(found).toHaveLength(50);
    expect(found.slice(0, 2)).toEqual(["item.nested", "item.plain"]);
  });

  test("the depth cap ends a long chain of objects", () => {
    let leaf: JsonValue = 1;
    for (let i = 0; i < 10; i += 1) {
      leaf = { n: leaf };
    }
    // SAFETY: the loop above wrapped the number in an object at least once.
    const doc = docWith("#/state/rows", { rows: [leaf as JsonObject] });
    const deepest = tokens(doc, inside).at(-1) ?? "";
    expect(deepest.split(".")).toHaveLength(7);
  });

  /*
   * `$children` is what a Markdown entry's parsed body comes out as. It is a tree of nodes, so only
   * an element's content can draw it: every text position and operand must go on not seeing it.
   */
  describe("the field holding an item's child nodes", () => {
    const withNodes = { withNodes: true };
    const team = docWith("#/state/team", { team: { contentType: "team" } });
    const markdown: ProjectConfig = {
      content: {
        team: { format: "Markdown", schema: { properties: { role: { type: "string" } } } },
      },
    };

    test("is left out unless it is asked for", () => {
      expect(tokens(team, inside, markdown)).not.toContain("item.$children");
      expect(resolveRepeaterItemFields(team, inside, markdown)).not.toContain("item.$children");
    });

    test("is listed beside the body when asked for, and flagged", () => {
      const fields = repeaterItemFields(team, inside, markdown, withNodes);
      expect(fields.map((field) => field.token)).toEqual([
        "item.id",
        "item.body",
        "item.$children",
        "item.data.role",
      ]);
      expect(fields[2]).toEqual({
        holdsNodes: true,
        isArray: false,
        path: ["$children"],
        pointer: "$map/item/$children",
        token: "item.$children",
      });
      expect(fields.filter((field) => field.holdsNodes)).toHaveLength(1);
    });

    test("is offered for a type naming no format, and not for a format with no body", () => {
      const tokensFor = (format?: string) =>
        repeaterItemFields(
          team,
          inside,
          { content: { team: format === undefined ? {} : { format } } },
          withNodes,
        ).map((field) => field.token);
      expect(tokensFor()).toContain("item.$children");
      expect(tokensFor("Csv")).toEqual(["item.id", "item.body"]);
    });

    test("is reached through a relationship", () => {
      const doc = docWith("#/state/posts", { posts: { contentType: "posts" } });
      const config: ProjectConfig = {
        content: {
          authors: { format: "Markdown" },
          posts: {
            format: "Csv",
            schema: { properties: { author: { $ref: "#/content/authors" } } },
          },
        },
      };
      const nodes = repeaterItemFields(doc, inside, config, withNodes).filter((f) => f.holdsNodes);
      expect(nodes.map((field) => field.token)).toEqual(["item.data.author.$children"]);
    });

    test("is found in a sample, and no other $-key is", () => {
      const doc = docWith("#/state/rows", {
        rows: [{ $children: [{ tagName: "p" }], $other: 1, title: "A" }],
      });
      expect(repeaterItemFields(doc, inside, null, withNodes).map((f) => f.token)).toEqual([
        "item.$children",
        "item.title",
      ]);
    });

    test("a template names the field, with its fallback, and reads back to it", () => {
      const nodes = repeaterItemFields(team, inside, markdown, withNodes).filter(
        (field) => field.holdsNodes,
      );
      const [field] = nodes;
      expect(childrenTemplate(field!)).toBe("${item.$children ?? []}");
      for (const template of [
        "${item.$children ?? []}",
        "${item.$children}",
        "${ item.$children ?? [ ] }",
      ]) {
        expect(fieldOfChildrenTemplate(template, nodes)).toBe(field);
      }
    });

    test("any other expression is the author's own and names no field", () => {
      const nodes = repeaterItemFields(team, inside, markdown, withNodes);
      expect(fieldOfChildrenTemplate("${item.$children.slice(1)}", nodes)).toBeUndefined();
      expect(fieldOfChildrenTemplate("${state.entry.$children}", nodes)).toBeUndefined();
      expect(fieldOfChildrenTemplate("plain", nodes)).toBeUndefined();
    });
  });
});

describe("mapRefLabel", () => {
  test("a $map pointer reads as the name the picker offers it under", () => {
    expect(mapRefLabel("$map/item")).toBe("item");
    expect(mapRefLabel("$map/index")).toBe("index");
    expect(mapRefLabel("$map/item/data/title")).toBe("item.data.title");
    expect(mapRefLabel("$map/item/a~1b")).toBe('item["a/b"]');
  });

  test("any other pointer is not this function's to name", () => {
    expect(mapRefLabel("#/state/title")).toBeNull();
    expect(mapRefLabel("$map/other")).toBeNull();
  });
});
