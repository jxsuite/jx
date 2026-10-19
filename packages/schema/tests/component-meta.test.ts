/**
 * Component metadata, derived rather than executed.
 *
 * This module exists because three backends need the same answer and two had already written it
 * twice — and the third could not write it at all: Jx Cloud refused component discovery under a "no
 * execution of project JS" posture, when for a JSON component discovery is a file read and a
 * property lookup. The cost was not the loss of a feature list. The canvas injects the `$elements`
 * a document's tags need only when the registry is non-empty, so an empty registry meant no
 * component was ever registered or fetched, and every instance rendered as an unregistered custom
 * element — an empty inline box where the component should be.
 */
import { describe, expect, test } from "bun:test";
import { collectSlotDefs, collectUsedTags, componentMetaFrom } from "../src/component-meta";

describe("componentMetaFrom", () => {
  test("a hyphenated tagName is a component; anything else is not", () => {
    // The single test that keeps a whole-project scan from reporting pages and data files as
    // Components: every backend globs the whole tree for JSON, so most of what it reads is not one.
    expect(componentMetaFrom({ tagName: "my-card" }, "c.json")?.tagName).toBe("my-card");
    expect(componentMetaFrom({ tagName: "div" }, "p.json")).toBeNull();
    expect(componentMetaFrom({ children: [] }, "p.json")).toBeNull();
  });

  test("non-objects and arrays are refused rather than throwing", () => {
    // A scan reads whatever JSON it finds, including `[]` and `"text"`.
    for (const doc of [null, undefined, 42, "str", [], true]) {
      expect(componentMetaFrom(doc, "x.json")).toBeNull();
    }
  });

  test("the path is reported verbatim — the caller owns its shape", () => {
    // One backend globs from the project root, another walks a session tree; normalising here
    // Would fight whichever one already had it right.
    expect(componentMetaFrom({ tagName: "a-b" }, "components/deep/a.json")?.path).toBe(
      "components/deep/a.json",
    );
  });

  describe("which state entries are props", () => {
    test("shorthand entries are props, and the value is both default and type", () => {
      const meta = componentMetaFrom(
        { state: { count: 3, title: "Hi" }, tagName: "a-b" },
        "a.json",
      );
      expect(meta?.props).toEqual([
        { default: 3, name: "count", type: "number" },
        { default: "Hi", name: "title", type: "string" },
      ]);
    });

    test("machinery is NOT a prop — computed, handler and prototype entries", () => {
      /* Offering these would put a text box in front of a function. This is the rule the two
         copies stated in different words, which is the drift this module ends. */
      const meta = componentMetaFrom(
        {
          state: {
            items: { $prototype: "Array" },
            onClick: { $handler: "x" },
            plain: { default: "d", type: "string" },
            total: { $compute: "a+b" },
          },
          tagName: "a-b",
        },
        "a.json",
      );
      expect(meta?.props.map((p) => p.name)).toEqual(["plain"]);
    });

    test("a null entry is not a prop", () => {
      expect(componentMetaFrom({ state: { x: null }, tagName: "a-b" }, "a.json")?.props).toEqual(
        [],
      );
    });

    test("the full form carries default, type and format through", () => {
      const meta = componentMetaFrom(
        { state: { img: { default: "/a.png", format: "media", type: "string" } }, tagName: "a-b" },
        "a.json",
      );
      expect(meta?.props).toEqual([
        { default: "/a.png", format: "media", name: "img", type: "string" },
      ]);
    });

    test("no state at all yields no props, not a throw", () => {
      expect(componentMetaFrom({ tagName: "a-b" }, "a.json")?.props).toEqual([]);
    });
  });

  describe("slots", () => {
    test("an unnamed slot, and a whitespace-only name, are both the unnamed slot", () => {
      const meta = componentMetaFrom(
        {
          children: [
            { tagName: "slot" },
            { attributes: { name: "   " }, tagName: "slot" },
            { attributes: { name: "footer" }, tagName: "slot" },
          ],
          tagName: "a-b",
        },
        "a.json",
      );
      expect(meta?.slots?.map((s) => s.name)).toEqual(["", "", "footer"]);
    });

    test("a slot's children are its fallback; an empty slot has none", () => {
      const meta = componentMetaFrom(
        { children: [{ children: ["Nothing here"], tagName: "slot" }], tagName: "a-b" },
        "a.json",
      );
      expect(meta?.slots?.[0]?.fallback).toEqual(["Nothing here"]);
      const bare = componentMetaFrom({ children: [{ tagName: "slot" }], tagName: "a-b" }, "a.json");
      expect(bare?.slots?.[0]).toEqual({ name: "" });
    });

    test("slots are found at any depth", () => {
      const meta = componentMetaFrom(
        {
          children: [
            { children: [{ children: [{ tagName: "slot" }], tagName: "div" }], tagName: "section" },
          ],
          tagName: "a-b",
        },
        "a.json",
      );
      expect(meta?.slots).toHaveLength(1);
    });

    test("the key is omitted entirely when there are no slots", () => {
      // Rather than an empty array, so a component with no slots serialises without the key.
      expect(componentMetaFrom({ tagName: "a-b" }, "a.json")).not.toHaveProperty("slots");
    });
  });

  test("hasElements reports a NON-EMPTY $elements only", () => {
    // It answers "does this component bring its own dependencies", so an empty array is a no.
    expect(
      componentMetaFrom({ $elements: [{ $ref: "./x.json" }], tagName: "a-b" }, "a")?.hasElements,
    ).toBe(true);
    expect(componentMetaFrom({ $elements: [], tagName: "a-b" }, "a")?.hasElements).toBe(false);
    expect(componentMetaFrom({ tagName: "a-b" }, "a")?.hasElements).toBe(false);
  });

  test("uses lists the custom-element tags its tree renders, sorted, itself excluded", () => {
    /* Components address one another by bare tagName and declare no `$elements`, so this is how a
       live renderer learns that a card needs its panel registered too. */
    const meta = componentMetaFrom(
      {
        children: [
          { children: [{ tagName: "x-panel" }, { tagName: "span" }], tagName: "div" },
          { tagName: "a-b" },
          { tagName: "x-icon" },
        ],
        tagName: "a-b",
      },
      "a",
    );
    expect(meta?.uses).toEqual(["x-icon", "x-panel"]);
    expect(
      componentMetaFrom({ children: [{ tagName: "p" }], tagName: "a-b" }, "a"),
    ).not.toHaveProperty("uses");
  });

  test("$id is null rather than absent or empty", () => {
    expect(componentMetaFrom({ $id: "c-1", tagName: "a-b" }, "a")?.$id).toBe("c-1");
    expect(componentMetaFrom({ $id: "", tagName: "a-b" }, "a")?.$id).toBeNull();
    expect(componentMetaFrom({ tagName: "a-b" }, "a")?.$id).toBeNull();
  });
});

describe("collectSlotDefs", () => {
  test("only static children arrays are walked", () => {
    /* A slot produced by a `$map` or a `$switch` has no fixed identity to report, so it is not a
       slot the studio can offer to fill. */
    expect(collectSlotDefs({ children: { $prototype: "Array" }, tagName: "div" })).toEqual([]);
  });

  test("a non-object is not walked", () => {
    expect(collectSlotDefs(null)).toEqual([]);
    expect(collectSlotDefs(["slot"])).toEqual([]);
  });
});

describe("collectUsedTags", () => {
  test("walks a repeater's map, a $switch's cases and a whole-slot child, not just children", () => {
    const tags = collectUsedTags({
      children: [
        { $prototype: "Array", map: { tagName: "x-row" } },
        { $switch: "${state.k}", cases: { a: { tagName: "x-case" } } },
        { children: { tagName: "x-only" }, tagName: "div" },
        "text",
      ],
      tagName: "x-root",
    });
    expect([...tags].toSorted()).toEqual(["x-case", "x-only", "x-row"]);
  });

  test("a non-object is not walked", () => {
    expect(collectUsedTags(null).size).toBe(0);
  });
});
