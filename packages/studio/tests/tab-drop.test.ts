/**
 * `panels/tab-drop.ts` — turning a completed pragmatic drag into a workspace write.
 *
 * Pure model logic: `resolveTabDrop` takes only the `{ data }` a source and a target carried, never
 * a real `DragLocationHistory`, so these cases call it directly with synthetic data rather than
 * driving a pointer through `panels/tab-strip.ts`'s registrations (that lifecycle is
 * `tests/tab-strip-dnd.test.ts`'s job). `../src/files/files` is mocked so a file-drop case never
 * reaches the platform.
 */
import { stubRect } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

const opened: { path: string; paneId?: string; focus?: boolean }[] = [];
let openLands = true;

void mock.module("../src/files/files", () => ({
  openFileInTab: async (path: string, opts: { paneId?: string; focus?: boolean } = {}) => {
    opened.push({ path, ...opts });
    if (openLands) {
      const { openTab } = await import("../src/workspace/workspace");
      openTab({
        document: { children: [], tagName: "div" },
        documentPath: path,
        id: path,
        ...(opts.paneId !== undefined && { paneId: opts.paneId }),
        ...(opts.focus === false && { focus: false }),
      });
    }
  },
}));

const {
  PRIMARY_PANE,
  SECONDARY_PANE,
  activateTab,
  closeAllTabs,
  focusPane,
  openTab,
  paneBeside,
  paneById,
  workspace,
} = await import("../src/workspace/workspace");
const { setPaneDerivation } = await import("../src/workspace/pane-derive");
const { isTabDropSource, resolveTabDrop } = await import("../src/panels/tab-drop");

function open(id: string, paneId?: string) {
  return openTab({
    document: { children: [], tagName: "div" },
    documentPath: `${id}.json`,
    id,
    ...(paneId !== undefined && { paneId }),
  });
}

function tabSource(tabId: string, paneId?: string) {
  return { data: { paneId, tabId, type: "tab" } };
}

function fileSource(path: string) {
  return { data: { entryType: "file", path, type: "file-tree" } };
}

function slotTarget(paneId: string, index: number, tabId?: string) {
  return { data: { index, paneId, tabId, type: "tab-slot" } };
}

function edgeTarget(paneId: string) {
  return { data: { paneId, type: "pane-edge" } };
}

beforeEach(() => {
  closeAllTabs();
  opened.length = 0;
  openLands = true;
});

describe("isTabDropSource", () => {
  test("accepts a tab and a file row, refuses a directory row and anything else", () => {
    expect(isTabDropSource({ paneId: "primary", tabId: "a", type: "tab" })).toBe(true);
    expect(isTabDropSource({ entryType: "file", path: "a.json", type: "file-tree" })).toBe(true);
    expect(isTabDropSource({ entryType: "directory", path: "a", type: "file-tree" })).toBe(false);
    expect(isTabDropSource({ type: "block" })).toBe(false);
    expect(isTabDropSource({})).toBe(false);
  });
});

describe("resolveTabDrop — refused and cancelled", () => {
  test("no target (a cancelled drag) writes nothing", async () => {
    open("a");
    // oxlint-disable-next-line unicorn/no-useless-undefined -- `target` is required; this is the cancelled-drag shape `location.current.dropTargets[0]` produces.
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), undefined);
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a"]);
  });

  test("a refused target writes nothing", async () => {
    open("a");
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), { data: { type: "tab-slot-refused" } });
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), { data: { type: "pane-edge-refused" } });
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a"]);
  });

  test("a source this module does not know how to land writes nothing", async () => {
    open("a");
    await resolveTabDrop({ data: { type: "block" } }, slotTarget(PRIMARY_PANE, 0, "a"));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a"]);
  });
});

describe("resolveTabDrop — tab onto a slot in its OWN pane", () => {
  test("forward reorder", async () => {
    open("a");
    open("b");
    open("c");
    // Drop "a" onto "c"'s slot (index 2) — a forward move lands AFTER the target.
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), slotTarget(PRIMARY_PANE, 2, "c"));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["b", "c", "a"]);
  });

  test("backward reorder", async () => {
    open("a");
    open("b");
    open("c");
    await resolveTabDrop(tabSource("c", PRIMARY_PANE), slotTarget(PRIMARY_PANE, 0, "a"));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["c", "a", "b"]);
  });

  test("dropping a tab on its own slot is a no-op", async () => {
    open("a");
    open("b");
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), slotTarget(PRIMARY_PANE, 0, "a"));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a", "b"]);
  });

  test("the tail target moves it to the end", async () => {
    open("a");
    open("b");
    open("c");
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), slotTarget(PRIMARY_PANE, 3));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["b", "c", "a"]);
  });

  test("an unknown tab id or pane id writes nothing", async () => {
    open("a");
    await resolveTabDrop(tabSource("nope", PRIMARY_PANE), slotTarget(PRIMARY_PANE, 0, "a"));
    await resolveTabDrop(tabSource("a", "ghost"), slotTarget("ghost", 0));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a"]);
  });
});

describe("resolveTabDrop — tab onto a slot in the OTHER pane", () => {
  test("lands at the slot, is promoted, and takes the keyboard", async () => {
    const a = open("a", PRIMARY_PANE);
    a.preview = true;
    open("b", PRIMARY_PANE);
    paneBeside(PRIMARY_PANE);
    open("c", SECONDARY_PANE);
    focusPane(PRIMARY_PANE);

    // No real `attachClosestEdge` ran over this synthetic target, so `extractClosestEdge` reads no
    // Edge and `resolveTabDrop` takes the "not left" branch — landing AFTER the target slot.
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), slotTarget(SECONDARY_PANE, 0, "c"));

    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["b"]);
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["c", "a"]);
    expect(workspace.tabs.get("a")!.preview).toBe(false);
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    expect(workspace.activeTabId).toBe("a");
  });

  test("dropped onto a lens's strip, it releases the derivation first", async () => {
    open("a", PRIMARY_PANE);
    open("b", PRIMARY_PANE);
    paneBeside(PRIMARY_PANE);
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "source",
      preset: "code",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });

    // The tail target on an empty lens strip: no `tabId`, index 0.
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), slotTarget(SECONDARY_PANE, 0));

    expect(paneById(SECONDARY_PANE)!.derived).toBeNull();
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["a"]);
  });
});

describe("resolveTabDrop — file onto a slot", () => {
  test("an already-open file's tab moves, rather than reopening", async () => {
    open("a", PRIMARY_PANE);
    paneBeside(PRIMARY_PANE);
    open("b", SECONDARY_PANE);
    // A second tab keeps the secondary from auto-collapsing (§18.1 rule 3) once "b" leaves it —
    // The point of this case is the MOVE, not the pane housekeeping `detachTab` already owns.
    open("keep", SECONDARY_PANE);

    // Not "left" (no real edge attached to this synthetic target — see the note above), so "b"
    // Lands AFTER "a"'s slot.
    await resolveTabDrop(fileSource("b.json"), slotTarget(PRIMARY_PANE, 0, "a"));

    expect(opened).toEqual([]);
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a", "b"]);
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["keep"]);
  });

  test("a file with no open tab is opened, focused, at the requested slot", async () => {
    open("a", PRIMARY_PANE);

    await resolveTabDrop(fileSource("new.json"), slotTarget(PRIMARY_PANE, 0, "a"));

    expect(opened).toEqual([{ focus: true, path: "new.json", paneId: PRIMARY_PANE }]);
    // Landed at the default slot (the opener's own), then re-found and idempotently placed at the
    // Requested slot — which, with no real edge attached, is AFTER "a".
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a", "new.json"]);
    expect(workspace.activeTabId).toBe("new.json");
  });

  test("a file that fails to open lands nothing", async () => {
    open("a", PRIMARY_PANE);
    openLands = false;

    await resolveTabDrop(fileSource("missing.json"), slotTarget(PRIMARY_PANE, 0, "a"));

    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a"]);
  });
});

describe("resolveTabDrop — the right-edge zone", () => {
  test("a tab drop splits and promotes it", async () => {
    const a = open("a");
    a.preview = true;
    open("b");
    activateTab("a");

    await resolveTabDrop(tabSource("a", PRIMARY_PANE), edgeTarget(PRIMARY_PANE));

    expect(workspace.panes).toHaveLength(2);
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["a"]);
    expect(workspace.tabs.get("a")!.preview).toBe(false);
  });

  test("a file drop opens the new pane", async () => {
    open("a");

    await resolveTabDrop(fileSource("b.json"), edgeTarget(PRIMARY_PANE));

    expect(opened).toEqual([{ path: "b.json", paneId: SECONDARY_PANE }]);
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["b.json"]);
  });

  test("a file that fails to open collapses the pane it minted", async () => {
    open("a");
    openLands = false;

    await resolveTabDrop(fileSource("missing.json"), edgeTarget(PRIMARY_PANE));

    expect(workspace.panes).toHaveLength(1);
    expect(workspace.panes[0]!.id).toBe(PRIMARY_PANE);
  });

  test("splitRight refusing (no tab named) promotes nothing and creates no pane", async () => {
    await resolveTabDrop(tabSource("nope", PRIMARY_PANE), edgeTarget(PRIMARY_PANE));
    expect(workspace.panes).toHaveLength(1);
  });
});

describe("resolveTabDrop — a genuinely attached edge", () => {
  /** A real chip-slot target, its edge computed by the real `attachClosestEdge` against a rect. */
  function realSlotTarget(paneId: string, tabId: string, index: number, clientX: number) {
    const element = document.createElement("div");
    stubRect(element, { left: 0, width: 100 });
    return {
      data: attachClosestEdge(
        { index, paneId, tabId, type: "tab-slot" },
        {
          allowedEdges: ["left", "right"],
          element,
          input: {
            altKey: false,
            button: 0,
            buttons: 0,
            clientX,
            clientY: 0,
            ctrlKey: false,
            metaKey: false,
            pageX: clientX,
            pageY: 0,
            shiftKey: false,
          },
        },
      ),
    };
  }

  test("the LEFT edge lands the drop BEFORE the target slot", async () => {
    open("a", PRIMARY_PANE);
    open("b", PRIMARY_PANE);
    open("c", PRIMARY_PANE);
    // Hovering near x=0 of a [0, 100] box reads as the left edge.
    await resolveTabDrop(tabSource("c", PRIMARY_PANE), realSlotTarget(PRIMARY_PANE, "a", 0, 5));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["c", "a", "b"]);
  });

  test("the RIGHT edge lands the drop AFTER the target slot", async () => {
    open("a", PRIMARY_PANE);
    open("b", PRIMARY_PANE);
    open("c", PRIMARY_PANE);
    // Hovering near x=100 of a [0, 100] box reads as the right edge.
    await resolveTabDrop(tabSource("c", PRIMARY_PANE), realSlotTarget(PRIMARY_PANE, "a", 0, 95));
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual(["a", "c", "b"]);
  });

  test("a cross-pane LEFT edge inserts before the target slot", async () => {
    open("a", PRIMARY_PANE);
    paneBeside(PRIMARY_PANE);
    open("b", SECONDARY_PANE);
    open("c", SECONDARY_PANE);
    await resolveTabDrop(tabSource("a", PRIMARY_PANE), realSlotTarget(SECONDARY_PANE, "c", 1, 5));
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["b", "a", "c"]);
  });
});
