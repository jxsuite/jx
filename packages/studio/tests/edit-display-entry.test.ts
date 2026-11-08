/** Entry-bound text in edit mode (studio.md §4.1): src/utils/edit-display.ts. */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  BOUND_FIELD_ATTR,
  entryBoundFields,
  entryFieldsOfNode,
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
  test("renders the entry's value, badged with its field and closed to the caret", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: "${state.entry.data.title}" }]),
    );
    const h1 = firstChild(out);
    expect(h1.attributes).toEqual({ [BOUND_FIELD_ATTR]: "title", contenteditable: "false" });
    const host = rendered(out, { data: { title: "Designing for Slowness" } });
    expect(host.querySelector("h1")?.textContent).toBe("Designing for Slowness");
  });

  test("keeps the author's attributes and joins several fields", () => {
    const out = prepareForEditMode(
      page([
        {
          attributes: { class: "meta" },
          tagName: "p",
          textContent: "${state.entry.data.date} · ${state.entry.data.tag}",
        },
      ]),
    );
    expect(firstChild(out).attributes).toEqual({
      [BOUND_FIELD_ATTR]: "date · tag",
      class: "meta",
      contenteditable: "false",
    });
    const host = rendered(out, { data: { date: "May 3", tag: "Essays" } });
    expect(host.querySelector("p")?.textContent).toBe("May 3 · Essays");
  });

  test("reads as its binding while there is no entry to read it from", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: "${state.entry.data.title}" }]),
    );
    expect(rendered(out).querySelector("h1")?.textContent).toBe("❪ state.entry.data.title ❫");
    expect(rendered(out, { data: {} }).querySelector("h1")?.textContent).toBe(
      "❪ state.entry.data.title ❫",
    );
  });

  test("a $ref to an entry field is drawn the same way", () => {
    const out = prepareForEditMode(
      page([{ tagName: "h1", textContent: { $ref: "#/state/entry/data/title" } }]),
    );
    expect(firstChild(out).attributes).toEqual({
      [BOUND_FIELD_ATTR]: "title",
      contenteditable: "false",
    });
    expect(rendered(out, { data: { title: "Tools" } }).querySelector("h1")?.textContent).toBe(
      "Tools",
    );
  });

  test("text that reads anything else stays its binding", () => {
    const out = prepareForEditMode(
      page([
        { tagName: "h2", textContent: "${state.heading}" },
        { tagName: "h3", textContent: { $ref: "#/state/heading" } },
        { tagName: "h4", textContent: { $ref: "window#/title" } },
      ]),
    );
    const children = [0, 1, 2].map((index) => childAt(out, index));
    expect(children.map((c) => c.textContent)).toEqual([
      "❪ state.heading ❫",
      "{heading}",
      "{window#/title}",
    ]);
    expect(children.every((c) => c.attributes === undefined)).toBe(true);
  });

  test("an entry's body is drawn as its nodes, badged, rather than as a label", () => {
    const out = prepareForEditMode(
      page([{ children: "${state.entry.$children ?? []}", tagName: "div" }]),
    );
    const div = firstChild(out);
    expect(div.children).toBe("${state.entry.$children ?? []}");
    expect(div.textContent).toBeUndefined();
    expect(div.attributes).toEqual({ [BOUND_FIELD_ATTR]: "body", contenteditable: "false" });
  });

  test("computed children that read anything else keep their label", () => {
    const out = prepareForEditMode(page([{ children: "${state.heading}", tagName: "div" }]));
    const div = firstChild(out);
    expect(div.children).toBeUndefined();
    expect(div.textContent).toBe("❪ state.heading ❫");
    expect(div.attributes).toEqual({ contenteditable: "false" });
  });

  test("a second walk (a page merged into its layout) leaves a prepared node as it is", () => {
    const once = prepareForEditMode(
      page([
        { tagName: "h1", textContent: "${state.entry.data.title}" },
        { children: "${state.entry.$children ?? []}", tagName: "div" },
      ]),
    );
    const twice = prepareForEditMode(once);
    expect(twice).toEqual(once);
    // Even when the second walk cannot see the page's state, the mark carries the binding.
    const [h1, body] = [childAt(once, 0), childAt(once, 1)];
    expect(prepareForEditMode(h1, null, new Set())).toEqual(h1);
    expect(prepareForEditMode(body, null, new Set())).toEqual(body);
  });

  test("a subtree walked on its own is given the document's roots", () => {
    const node: JxMutableNode = { tagName: "h1", textContent: "${state.entry.data.title}" };
    expect(prepareForEditMode(node).textContent).toBe("❪ state.entry.data.title ❫");
    expect(prepareForEditMode(node, null, ROOTS).attributes).toEqual({
      [BOUND_FIELD_ATTR]: "title",
      contenteditable: "false",
    });
  });

  test("entryFieldsOfNode answers for text, children and anything else", () => {
    expect(entryFieldsOfNode({ textContent: "${state.entry.data.title}" }, ROOTS)).toEqual([
      "title",
    ]);
    expect(entryFieldsOfNode({ children: "${state.entry.$children}" }, ROOTS)).toEqual(["body"]);
    expect(entryFieldsOfNode({ textContent: "Plain" }, ROOTS)).toBeNull();
    expect(entryFieldsOfNode("text", ROOTS)).toBeNull();
    expect(entryFieldsOfNode(undefined, ROOTS)).toBeNull();
  });
});
