import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { ancestorDialogPath, dialogPathFor } from "../src/canvas/dialog-path";
import type { JxMutableNode } from "@jxsuite/schema/types";

/**
 * The dialog twin of `popover-state.test.ts`'s pure half: the same walks over a document whose
 * overlay is a `<dialog>` rather than a `[popover]`, because `isDialog` answers by tag.
 */
const DOC = {
  children: [
    { attributes: { command: "show-modal", commandfor: "d" }, tagName: "button" },
    {
      attributes: { id: "d" },
      children: [{ attributes: { href: "/a" }, tagName: "a" }],
      tagName: "dialog",
    },
  ],
  tagName: "div",
} as unknown as JxMutableNode;

describe("ancestorDialogPath", () => {
  test("a dialog is its own answer", () => {
    expect(ancestorDialogPath(DOC, ["children", 1])).toEqual(["children", 1]);
  });

  test("a node INSIDE one answers with the panel, which is what open-on-selection needs", () => {
    expect(ancestorDialogPath(DOC, ["children", 1, "children", 0])).toEqual(["children", 1]);
  });

  test("a node outside every dialog answers null", () => {
    expect(ancestorDialogPath(DOC, ["children", 0])).toBeNull();
    expect(ancestorDialogPath(DOC, [])).toBeNull();
  });

  test("it walks prefixes, so a `map` or `cases` hop needs no special case", () => {
    const doc = {
      children: [
        {
          $switch: "#/state/x",
          cases: {
            one: {
              tagName: "dialog",
              children: [{ tagName: "p", textContent: "in a case" }],
            },
          },
          tagName: "div",
        },
        {
          $prototype: "Array",
          items: [],
          map: {
            tagName: "dialog",
            children: [{ tagName: "li" }],
          },
          tagName: "div",
        },
      ],
      tagName: "div",
    } as unknown as JxMutableNode;
    expect(ancestorDialogPath(doc, ["children", 0, "cases", "one", "children", 0])).toEqual([
      "children",
      0,
      "cases",
      "one",
    ]);
    expect(ancestorDialogPath(doc, ["children", 1, "map", "children", 0])).toEqual([
      "children",
      1,
      "map",
    ]);
  });

  test("the NEAREST dialog wins when they nest", () => {
    const doc = {
      tagName: "dialog",
      children: [{ tagName: "dialog", children: [{ tagName: "p" }] }],
    } as unknown as JxMutableNode;
    expect(ancestorDialogPath(doc, ["children", 0, "children", 0])).toEqual(["children", 0]);
  });

  test("a missing document or path answers null rather than throwing", () => {
    expect(ancestorDialogPath(null, ["children", 0])).toBeNull();
    expect(ancestorDialogPath(DOC, null)).toBeNull();
  });

  test("a path that runs off the tree answers null", () => {
    expect(ancestorDialogPath(DOC, ["children", 9, "children", 3])).toBeNull();
  });
});

describe("dialogPathFor", () => {
  /** A tab-shaped double carrying the document and a selection. */
  function tabWith(selection: (string | number)[][]) {
    return { doc: { document: DOC }, id: "t1", session: { selection, ui: {} } } as never;
  }

  test("dialogPathFor takes an explicit path at its word, but checks it", () => {
    const tab = tabWith([]);
    expect(dialogPathFor(tab, ["children", 1])).toEqual(["children", 1]);
    // Not a dialog — refused, so the command can say so rather than opening nothing.
    expect(dialogPathFor(tab, ["children", 0])).toBeNull();
    expect(dialogPathFor(tab, ["children", 9])).toBeNull();
  });

  test("with no explicit path it falls back to the selection", () => {
    expect(dialogPathFor(tabWith([["children", 1, "children", 0]]))).toEqual(["children", 1]);
    expect(dialogPathFor(tabWith([]))).toBeNull();
  });

  test("a tab with no document answers null", () => {
    const tab = { doc: {}, id: "t", session: { selection: [], ui: {} } } as never;
    expect(dialogPathFor(tab)).toBeNull();
  });
});
