/** Entry-bound text in edit mode (studio.md §4.5): src/utils/edit-display.ts. */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  BOUND_FIELD_ATTR,
  entryBoundFields,
  entryRootsOf,
  prepareForEditMode,
} from "../src/utils/edit-display";
import { renderNode } from "@jxsuite/runtime";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

const ROOTS: ReadonlySet<string> = new Set(["entry"]);

/** A collection's page: a `ContentEntry` named `entry`, and whatever children the test gives. */
function page(children: (JxMutableNode | string)[]): JxMutableNode {
  return {
    children,
    state: {
      entry: {
        $prototype: "ContentEntry",
        contentType: "posts",
        id: { $ref: "#/$params/slug" },
      },
      heading: "Plain state",
    },
    tagName: "article",
  };
}

/** The child at `index` of a prepared node, asserted to be a node. */
function childAt(node: JxDocumentValue, index: number): JxMutableNode {
  const children = isNodeObject(node) ? node.children : undefined;
  const child = Array.isArray(children) ? children[index] : undefined;
  if (!isNodeObject(child)) {
    throw new TypeError(`expected a node child at ${index}`);
  }
  return child;
}

/** The first child of a prepared node, asserted to be a node. */
function firstChild(node: JxDocumentValue): JxMutableNode {
  return childAt(node, 0);
}

/** Render a prepared node against a scope whose `entry` is a resolved post. */
function rendered(node: JxMutableNode, entry: JxDocumentValue = null): HTMLElement {
  const host = renderNode(node, { entry, heading: "Plain state" });
  if (!(host instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return host;
}

describe("which state an entry is", () => {
  test("every ContentEntry the document declares, and nothing else", () => {
    expect([...entryRootsOf(page([]))]).toEqual(["entry"]);
    expect(entryRootsOf({ tagName: "div" }).size).toBe(0);
    expect(entryRootsOf("text").size).toBe(0);
    expect(entryRootsOf({ state: [], tagName: "div" }).size).toBe(0);
  });

  test("a template reads entry fields only when every expression does", () => {
    expect(entryBoundFields("${state.entry.data.title}", ROOTS)).toEqual(["title"]);
    expect(entryBoundFields("${state.entry.data.date} · ${state.entry.data.tag}", ROOTS)).toEqual([
      "date",
      "tag",
    ]);
    expect(entryBoundFields("${state.entry.data.title}${state.entry.data.title}", ROOTS)).toEqual([
      "title",
    ]);
    expect(entryBoundFields("${state.entry.$children ?? []}", ROOTS)).toEqual(["body"]);
    expect(entryBoundFields("${state.entry.id}", ROOTS)).toEqual(["id"]);
    expect(entryBoundFields("${state.entry}", ROOTS)).toEqual(["entry"]);
    expect(entryBoundFields("${state.entry.data.title} ${state.heading}", ROOTS)).toBeNull();
    expect(entryBoundFields("${state.entry.data.title.toUpperCase()}", ROOTS)).toBeNull();
    expect(entryBoundFields("No binding", ROOTS)).toBeNull();
    expect(entryBoundFields("${state.entry.data.title}", new Set())).toBeNull();
  });
});

describe("entry-bound text on the canvas", () => {
  test("renders the entry's value in a chip, named for its field, and stays open to the caret", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: "${state.entry.data.title}" }]),
    );
    const heading = firstChild(out);
    expect(heading.textContent).toBeUndefined();
    expect(heading.attributes).toEqual({ [BOUND_FIELD_ATTR]: "Title" });
    const host = rendered(out, { data: { title: "Harbour light" } });
    expect(host.querySelector("h1")?.textContent).toBe("Harbour light");
    expect(host.querySelector("h1 > data")?.getAttribute("contenteditable")).toBe("false");
  });

  test("keeps the author's attributes and names several fields", () => {
    const out = prepareForEditMode(
      page([
        {
          attributes: { id: "byline" },
          tagName: "p",
          textContent: "${state.entry.data.date} · ${state.entry.data.tag}",
        },
      ]),
    );
    expect(firstChild(out).attributes).toEqual({
      [BOUND_FIELD_ATTR]: "Date \u00B7 Tag",
      id: "byline",
    });
    const host = rendered(out, { data: { date: "2026-03-01", tag: "notes" } });
    expect(host.querySelector("p")?.textContent).toBe("2026-03-01 · notes");
  });

  test("draws nothing but its chip while there is no entry to read it from", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: "${state.entry.data.title}" }]),
    );
    const heading = rendered(out, null).querySelector("h1");
    expect(heading?.textContent).toBe("");
    expect(heading?.querySelectorAll("data")).toHaveLength(1);
  });

  test("a $ref to an entry field is one chip, and closes its block", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: { $ref: "#/state/entry/data/title" } }]),
    );
    expect(firstChild(out).attributes).toEqual({
      [BOUND_FIELD_ATTR]: "Title",
      contenteditable: "false",
    });
    const host = rendered(out, { data: { title: "Harbour light" } });
    expect(host.querySelector("h1")?.textContent).toBe("Harbour light");
  });

  test("an entry's body is drawn as its nodes, named a computed list and closed to the caret", () => {
    const out = prepareForEditMode(
      page([{ children: "${state.entry.$children ?? []}", tagName: "div" }]),
    );
    const body = firstChild(out);
    expect(body.children).toBe("${state.entry.$children ?? []}");
    expect(body.attributes).toEqual({
      [BOUND_FIELD_ATTR]: "Computed list",
      contenteditable: "false",
    });
    const host = rendered(out, { $children: [{ tagName: "p", textContent: "First." }] });
    expect(host.querySelector("div > p")?.textContent).toBe("First.");
  });

  test("a second walk (a page merged into its layout) leaves a prepared node as it is", () => {
    const once = prepareForEditMode(
      page([
        { tagName: "h1", textContent: "${state.entry.data.title}" },
        { children: "${state.entry.$children ?? []}", tagName: "div" },
      ]),
    );
    expect(prepareForEditMode(once)).toEqual(once);
  });
});
