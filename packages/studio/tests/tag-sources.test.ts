/**
 * What a dynamic tag can read, as the Source picker offers it (src/editor/tag-sources.ts, studio.md
 * §6.8, §6.9): the row's fields first, under the names their schemas give them.
 */
import { describe, expect, test } from "bun:test";
import { sourceGroups } from "../src/editor/tag-sources";

import type { JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";

const config: ProjectConfig = {
  content: {
    posts: {
      schema: {
        properties: {
          author: { properties: { name: { type: "string" } }, type: "object" },
          date: { title: "Post date", type: "string" },
          title: { type: "string" },
        },
        type: "object",
      },
      source: "content/posts/*.md",
    },
  },
};

const doc: JxMutableNode = {
  children: [
    {
      $prototype: "Array",
      items: { $ref: "#/state/posts" },
      map: { children: [{ tagName: "h3", textContent: "${item.data.title}" }], tagName: "article" },
    },
  ],
  state: {
    posts: { $prototype: "ContentCollection", contentType: "posts" },
    site: { default: { name: "Blog" } },
  },
  tagName: "main",
};

describe("sourceGroups", () => {
  test("inside a repeater the row's fields come first, by their schema titles", () => {
    const [row, state] = sourceGroups(doc, ["children", 0, "map", "children", 0], config, {
      site: { name: "Blog" },
    });
    expect(row?.label).toBe("This row");
    const rows = Object.fromEntries(
      (row?.rows ?? []).map((option) => [option.value, option.label]),
    );
    expect(rows["item.data.date"]).toBe("Post date");
    expect(rows["item.data.title"]).toBe("Title");
    expect(rows["item.data.author.name"]).toBe("Author › Name");
    expect(rows["item"]).toBe("Whole item");
    expect(rows["index"]).toBe("Row number");
    expect(state?.label).toBe("Page data");
    expect(state?.rows.map((option) => option.value)).toContain("state.site.name");
    expect(state?.rows.find((option) => option.value === "state.site.name")?.label).toBe(
      "Site › Name",
    );
  });

  test("outside a repeater there is no row to read", () => {
    const groups = sourceGroups(doc, ["children", 0], config, null);
    expect(groups.map((group) => group.id)).toEqual(["state"]);
  });

  test("two fields a schema titles alike are told apart by what they read", () => {
    const titled: ProjectConfig = {
      content: {
        posts: {
          schema: {
            properties: {
              first: { title: "Name", type: "string" },
              last: { title: "Name", type: "string" },
            },
            type: "object",
          },
          source: "content/posts/*.md",
        },
      },
    };
    const [row] = sourceGroups(doc, ["children", 0, "map"], titled, null);
    const labels = row?.rows.map((option) => option.label) ?? [];
    expect(labels).toContain("Name (item.data.first)");
    expect(labels).toContain("Name (item.data.last)");
    expect(labels).toContain("Whole item");
  });

  test("a formula is a format a tag is passed through, and no source", () => {
    const withFormulas: JxMutableNode = {
      state: {
        capitalize: {
          $expression: { operator: "call", target: { $ref: "#/state/x" }, value: [] },
          parameters: [{ name: "value" }],
        },
        count: { default: 3 },
        total: { $expression: { operator: "+", value: [1, 2] } },
      },
      tagName: "div",
    };
    const [state] = sourceGroups(withFormulas, [], null, null);
    // A computed value with no parameters is a source; one that takes a value is a formula.
    expect(state?.rows.map((option) => option.value)).toEqual(["state.count", "state.total"]);
  });

  test("an entry's data is a level of the path, not a word, unless it is the whole name", () => {
    const [state] = sourceGroups(
      {
        state: { data: { default: "x" }, entry: { default: { data: { title: "T" } } } },
        tagName: "div",
      },
      [],
      null,
      { data: "x", entry: { data: { title: "T" } } },
    );
    const labels = Object.fromEntries((state?.rows ?? []).map((row) => [row.value, row.label]));
    expect(labels["state.data"]).toBe("Data");
    expect(labels["state.entry"]).toBe("Entry");
    // Two names that would read alike are told apart by the words, not by the code.
    expect(labels["state.entry.data"]).toBe("Entry › Data");
    expect(labels["state.entry.data.title"]).toBe("Entry › Title");
  });

  test("a name made of nothing a person can read is named for the tag", () => {
    const [state] = sourceGroups({ state: { _: { default: 1 } }, tagName: "div" }, [], null, null);
    expect(state?.rows).toEqual([{ hint: "", label: "State", value: "state._" }]);
  });

  test("a source carries what it holds today, where the scope says", () => {
    const [state] = sourceGroups(
      { state: { name: { default: "Ada" }, rows: { default: [1, 2] } }, tagName: "div" },
      [],
      null,
      { name: "Ada", rows: [1, 2] },
    );
    const hints = Object.fromEntries((state?.rows ?? []).map((row) => [row.value, row.hint]));
    expect(hints["state.name"]).toContain("Ada");
    expect(hints["state.rows.length"]).toBe("number · 2");
  });

  test("a document with no state and no repeater offers nothing", () => {
    expect(sourceGroups({ tagName: "div" }, [], null, null)).toEqual([]);
  });
});
