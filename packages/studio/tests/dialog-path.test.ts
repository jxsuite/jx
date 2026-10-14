import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { ancestorDialogPath, dialogPathFor } from "../src/canvas/dialog-path";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";
import { DIALOG_DOC } from "./shared-fixtures";

describe("ancestorDialogPath", () => {
  test("a dialog is its own answer", () => {
    expect(ancestorDialogPath(DIALOG_DOC, ["children", 1])).toEqual(["children", 1]);
  });

  test("a node INSIDE one answers with the panel, which is what open-on-selection needs", () => {
    expect(ancestorDialogPath(DIALOG_DOC, ["children", 1, "children", 0])).toEqual(["children", 1]);
  });

  test("a node outside every dialog answers null", () => {
    expect(ancestorDialogPath(DIALOG_DOC, ["children", 0])).toBeNull();
    expect(ancestorDialogPath(DIALOG_DOC, [])).toBeNull();
  });

  test("it walks prefixes, so a `map` or `cases` hop needs no special case", () => {
    const doc: JxMutableNode = {
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
    };
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
    const doc: JxMutableNode = {
      tagName: "dialog",
      children: [{ tagName: "dialog", children: [{ tagName: "p" }] }],
    };
    expect(ancestorDialogPath(doc, ["children", 0, "children", 0])).toEqual(["children", 0]);
  });

  test("a missing document or path answers null rather than throwing", () => {
    expect(ancestorDialogPath(null, ["children", 0])).toBeNull();
    expect(ancestorDialogPath(DIALOG_DOC, null)).toBeNull();
  });

  test("a path that runs off the tree answers null", () => {
    expect(ancestorDialogPath(DIALOG_DOC, ["children", 9, "children", 3])).toBeNull();
  });
});

describe("dialogPathFor", () => {
  /** The members of a tab `dialogPathFor` reads, with the document allowed to be missing. */
  interface DialogTabDouble {
    doc: { document?: JxMutableNode };
    id: string;
    session: { selection: JxPath[] };
  }

  function asTab(double: DialogTabDouble): Tab {
    /* SAFETY: `dialogPathFor` reads only `tab.doc.document`, which it widens to possibly-undefined
       and answers null for, and `tab.session.selection`; every member the double omits is unread. */
    return double as Tab;
  }

  /** A tab-shaped double carrying the document and a selection. */
  function tabWith(selection: JxPath[]): Tab {
    return asTab({ doc: { document: DIALOG_DOC }, id: "t1", session: { selection } });
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
    const tab = asTab({ doc: {}, id: "t", session: { selection: [] } });
    expect(dialogPathFor(tab)).toBeNull();
  });
});
