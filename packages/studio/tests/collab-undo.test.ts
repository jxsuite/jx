import { installMockPlatform } from "./harness";
import { BASE_DOC, childNode, createMockCollabHub, settleCollab } from "./collab-mock";
import { toRaw } from "../src/reactivity";
import { jsonClone } from "../src/utils/studio-utils";
import { closeAllTabs, closeTab, openTab } from "../src/workspace/workspace";
import { resetCollabForTests } from "../src/collab/collab-session";
import {
  canRedo,
  canUndo,
  getHistoryDelegate,
  mutateInsertNode,
  mutateUpdateProperty,
  redo,
  transactDoc,
  undo,
} from "../src/tabs/transact";
import { applyDocOpsToY, LOCAL_ORIGIN, yDocToJson } from "@jxsuite/collab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";
import { afterEach, describe, expect, test } from "bun:test";

const PATH = "pages/undo.json";

async function openAttached(hub: ReturnType<typeof createMockCollabHub>) {
  installMockPlatform({ collab: hub.capability });
  const tab = openTab({ document: structuredClone(BASE_DOC), documentPath: PATH, id: PATH });
  await settleCollab();
  return tab;
}

function tabJson(tab: Tab): JxMutableNode {
  return jsonClone(toRaw(tab.doc.document));
}

afterEach(() => {
  closeAllTabs();
  resetCollabForTests();
});

describe("collab undo (Y.UndoManager delegate)", () => {
  test("a delegate replaces the op-log history while attached", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    expect(getHistoryDelegate(tab)).not.toBeNull();
    expect(canUndo(tab)).toBe(false);

    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Edited"));
    expect(canUndo(tab)).toBe(true);

    undo(tab);
    await settleCollab();
    expect(childNode(tabJson(tab), 0).textContent).toBe("Base");
    // The undo propagated to the shared tree, not just locally.
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
    expect(canRedo(tab)).toBe(true);

    redo(tab);
    await settleCollab();
    expect(childNode(tabJson(tab), 0).textContent).toBe("Edited");
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
  });

  test("undo is local-only: a peer's interleaved edit survives", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    const peer = (await hub.capability(PATH))!;

    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Mine"));
    applyDocOpsToY(
      peer.doc,
      [
        {
          index: 1,
          node: { tagName: "aside", textContent: "Theirs" },
          op: "insert-child",
          parentPath: [],
        },
      ],
      LOCAL_ORIGIN,
    );
    await settleCollab();

    undo(tab);
    await settleCollab();

    const doc = tabJson(tab);
    expect(childNode(doc, 0).textContent).toBe("Base");
    expect(childNode(doc, 1).textContent).toBe("Theirs");
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
    peer.destroy();
  });

  test("selection restores from the undo stack item", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    tab.session.selection = [["children", 0]];
    transactDoc(tab, (t) => mutateInsertNode(t, [], 1, { tagName: "span" }));
    tab.session.selection = [["children", 1]];

    undo(tab);
    expect(tab.session.selection).toEqual([["children", 0]]);
  });

  test("detaching restores solo history rebased on the current doc", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Kept"));
    await settleCollab();

    closeTab(tab.id);
    await settleCollab();
    expect(getHistoryDelegate(tab)).toBeNull();
    expect(tab.history.snapshots).toHaveLength(1);
    const kept = tab.history.snapshots[0]?.document;
    if (!kept) {
      throw new TypeError("the closed tab's history kept no document checkpoint");
    }
    expect(childNode(kept, 0).textContent).toBe("Kept");
  });
});
