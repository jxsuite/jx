import "./with-dom.js";
import { describe, expect, mock, test } from "bun:test";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";
import { DIALOG_DOC } from "./shared-fixtures";

describe("the dialog reveal rule", () => {
  /** Load the module with the frame post doubled, as the popover suite does. */
  async function loadWithDoubles() {
    const posted: { path: JxPath | null }[] = [];
    void mock.module("../src/canvas/iframe-host", () => ({
      postDialogOpen: (_tab: Tab, path: JxPath | null) => {
        posted.push({ path });
      },
      postPopoverOpen: () => {},
      revealCanvasPath: () => Promise.resolve(),
    }));
    const mod = await import("../src/canvas/dialog-state");
    return { mod, posted };
  }

  /** The members of a tab the reveal rule reads and writes. */
  interface DialogTabDouble {
    doc: { document: JxMutableNode };
    id: string;
    session: { selection: JxPath[]; ui: { openDialog: JxPath | null } };
  }

  function fakeTab(selection: JxPath[], openDialog: JxPath | null = null): Tab {
    const double: DialogTabDouble = {
      doc: { document: DIALOG_DOC },
      id: "t1",
      session: { selection, ui: { openDialog } },
    };
    /* SAFETY: dialog-state reads `doc.document`, `session.selection` and `session.ui.openDialog`,
       writes `session.ui` through `updateSession`'s Object.assign, and hands the tab to the doubled
       `postDialogOpen`, which ignores it; no other member of the tab is touched. */
    return double as Tab;
  }

  test("selecting inside a dialog opens it, and tells the frames once", async () => {
    const { mod, posted } = await loadWithDoubles();
    mod.reconcileOpenDialog(fakeTab([["children", 1, "children", 0]]));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.path).toEqual(["children", 1]);
  });

  test("selecting OUTSIDE every dialog leaves the open one alone", async () => {
    const { mod, posted } = await loadWithDoubles();
    mod.reconcileOpenDialog(fakeTab([["children", 0]], ["children", 1]));
    expect(posted).toHaveLength(0);
  });

  test("re-selecting inside the dialog that is already open posts nothing", async () => {
    const { mod, posted } = await loadWithDoubles();
    mod.reconcileOpenDialog(fakeTab([["children", 1, "children", 0]], ["children", 1]));
    expect(posted).toHaveLength(0);
  });

  test("no tab is not an error", async () => {
    const { mod, posted } = await loadWithDoubles();
    mod.reconcileOpenDialog(null);
    expect(posted).toHaveLength(0);
  });

  test("setOpenDialog is the single writer: it writes the model AND posts", async () => {
    const { mod, posted } = await loadWithDoubles();
    const tab = fakeTab([]);
    mod.setOpenDialog(tab, ["children", 1]);
    expect(tab.session.ui.openDialog).toEqual(["children", 1]);
    expect(posted[0]!.path).toEqual(["children", 1]);
    mod.setOpenDialog(tab, null);
    expect(posted[1]!.path).toBeNull();
  });

  test("openDialogFor reports whether anything changed", async () => {
    const { mod } = await loadWithDoubles();
    const tab = fakeTab([]);
    expect(mod.openDialogFor(tab, ["children", 1, "children", 0])).toBe(true);
    expect(mod.openDialogFor(tab, ["children", 1])).toBe(false);
    expect(mod.openDialogFor(tab, ["children", 0])).toBe(false);
  });
});
