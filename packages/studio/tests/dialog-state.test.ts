import "./with-dom.js";
import { describe, expect, mock, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";

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

describe("the dialog reveal rule", () => {
  /** Load the module with the frame post doubled, as the popover suite does. */
  async function loadWithDoubles() {
    const posted: { path: unknown }[] = [];
    void mock.module("../src/canvas/iframe-host", () => ({
      postDialogOpen: (_tab: unknown, path: unknown) => {
        posted.push({ path });
      },
      postPopoverOpen: () => {},
      revealCanvasPath: () => Promise.resolve(),
    }));
    const mod = await import("../src/canvas/dialog-state");
    return { mod, posted };
  }

  function fakeTab(selection: (string | number)[][], openDialog: unknown = null) {
    return {
      doc: { document: DOC },
      id: "t1",
      session: { selection, ui: { openDialog } },
    } as never;
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
    expect(
      (tab as unknown as { session: { ui: { openDialog: unknown } } }).session.ui.openDialog,
    ).toEqual(["children", 1]);
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
