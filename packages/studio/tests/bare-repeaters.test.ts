/** A repeater a file wrote as a node's whole `children` survives a load and a save unchanged. */

import { describe, expect, test } from "bun:test";
import { normalizeDocument, restoreBareRepeaters } from "../src/tabs/bare-repeaters";
import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** Every member of a children array is a node, not a text run. */
function allNodes(children: (JxMutableNode | string)[]): children is JxMutableNode[] {
  return !children.some((child) => isString(child));
}

/**
 * A node's element children: the live array, so a test can edit through it. Every test document
 * here holds its children as an array of nodes.
 */
function kids(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !allNodes(children)) {
    throw new TypeError("expected a node with a children array of nodes");
  }
  return children;
}

/** A page with a bare repeater two levels down, beside a member-form one the author wrote. */
function page(): JxMutableNode {
  return {
    children: [
      { tagName: "h1", textContent: "About" },
      {
        children: [
          {
            children: {
              $prototype: "Array",
              items: { $ref: "#/state/rows" },
              map: { tagName: "li" },
            },
            tagName: "ul",
          },
          {
            children: [{ $prototype: "Array", items: [], map: { tagName: "li" } }],
            tagName: "ol",
          },
        ],
        tagName: "section",
      },
    ],
    tagName: "main",
  };
}

/** The bare-form `ul` of {@link page}, in a normalized document. */
function list(doc: JxMutableNode): JxMutableNode {
  return kids(kids(doc)[1])[0]!;
}

describe("normalizeDocument", () => {
  test("rewrites a bare repeater into the member form and records where it was", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    expect(record?.pointers).toEqual(new Set(["/children/1/children/0"]));
    expect(record?.fingerprints.size).toBe(1);
    expect(kids(list(doc))).toEqual([
      { $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: "li" } },
    ]);
  });

  test("records nothing for a document with no bare repeater", () => {
    expect(normalizeDocument({ children: [{ tagName: "p" }], tagName: "main" })).toBeNull();
  });

  test("addresses a bare repeater inside a template and a $switch case", () => {
    const doc: JxMutableNode = {
      $switch: { $ref: "#/state/view" },
      cases: {
        "a/b": {
          children: {
            $prototype: "Array",
            items: [],
            map: { children: { $prototype: "Array", items: [], map: {} }, tagName: "ul" },
          },
          tagName: "div",
        },
      },
    };
    expect(normalizeDocument(doc)?.pointers).toEqual(
      new Set(["/cases/a~1b", "/cases/a~1b/children/0/map"]),
    );
  });
});

describe("restoreBareRepeaters", () => {
  test("a load and a save with no edit between them give back the file", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    expect(restoreBareRepeaters(doc, record)).toEqual(page());
  });

  test("leaves the editor's document in the member form", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    const before = structuredClone(doc);
    restoreBareRepeaters(doc, record);
    expect(doc).toEqual(before);
  });

  test("returns the document itself when there is nothing to restore", () => {
    const doc = page();
    expect(restoreBareRepeaters(doc, null)).toBe(doc);
  });

  test("finds a repeater by its content after an insert above it shifts its pointer", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    kids(doc).unshift({ tagName: "p", textContent: "New" });
    const expected = page();
    kids(expected).unshift({ tagName: "p", textContent: "New" });
    expect(restoreBareRepeaters(doc, record)).toEqual(expected);
  });

  test("finds a repeater by its place after an edit inside it", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    const [repeater] = kids(list(doc));
    repeater!.map = { tagName: "li", textContent: "${item}" };
    const saved = restoreBareRepeaters(doc, record);
    expect(list(saved).children).toEqual({
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { tagName: "li", textContent: "${item}" },
    });
    const [, ordered] = kids(kids(saved)[1]);
    expect(kids(ordered)).toHaveLength(1);
  });

  test("keeps the member form once the repeater has a sibling", () => {
    const doc = page();
    const record = normalizeDocument(doc);
    kids(list(doc)).push({ tagName: "li", textContent: "Last" });
    const saved = restoreBareRepeaters(doc, record);
    expect(kids(list(saved)).map((child) => child.$prototype ?? child.tagName)).toEqual([
      "Array",
      "li",
    ]);
  });
});
