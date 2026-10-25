import { installMockPlatform } from "./harness";
import { childNode, createMockCollabHub, settleCollab } from "./collab-mock";
import { toRaw } from "../src/reactivity";
import { jsonClone } from "../src/utils/studio-utils";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { resetCollabForTests } from "../src/collab/collab-session";
import {
  isBatched,
  mutateInsertNode,
  mutateUpdateFrontmatter,
  mutateUpdateProperty,
  openBatchLane,
  transact,
  transactDoc,
  undo,
} from "../src/tabs/transact";
import { applyDocOpsToY, frontmatterMap, LOCAL_ORIGIN, yDocToJson } from "@jxsuite/collab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";
import { afterEach, describe, expect, test } from "bun:test";

const DOC: JxMutableNode = {
  children: [
    { tagName: "h1", textContent: "Title" },
    { tagName: "p", textContent: "Body" },
  ],
  tagName: "div",
};

const PATH = "pages/page.json";
const SECOND = "pages/second.json";

const assistant = { id: "assistant:local:collab", kind: "assistant", turnId: "collab" } as const;

async function openAttached(hub: ReturnType<typeof createMockCollabHub>) {
  installMockPlatform({ collab: hub.capability });
  const tab = openTab({ document: structuredClone(DOC), documentPath: PATH, id: PATH });
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

describe("outbound publishing", () => {
  test("instrumented mutations land op-for-op in the shared tree", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Edited"));
    transactDoc(tab, (t) => mutateInsertNode(t, [], 2, { tagName: "footer" }));

    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
    // Local edits leave the tab dirty (explicit-save model): syncing to peers is automatic, but the
    // Save affordance stays lit until an explicit flush clears it via the server's doc-dirty.
    expect(tab.doc.dirty).toBe(true);
  });

  test("un-instrumented mutations reconcile by diff", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    transact(tab, (doc) => {
      doc.tagName = "main";
    });

    expect(yDocToJson(hub.serverDoc(PATH)).tagName).toBe("main");
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
  });

  test("bypass root swaps (Monaco-style parse flush) publish via the microtask net", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    // Whole-document replace outside transactDoc, exactly like canvas-render's source flush.
    tab.doc.document = {
      children: [{ tagName: "article", textContent: "reparsed" }],
      tagName: "body",
    };
    await settleCollab();

    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
  });

  test("no republish loops: a quiet doc stays quiet", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Once"));
    await settleCollab();

    let updates = 0;
    const count = () => {
      updates += 1;
    };
    hub.serverDoc(PATH).on("update", count);
    await settleCollab(10);
    hub.serverDoc(PATH).off("update", count);
    expect(updates).toBe(0);
  });
});

describe("inbound application", () => {
  test("a peer's ops apply to the tab through the transaction pipeline", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    const peer = (await hub.capability(PATH))!;
    applyDocOpsToY(
      peer.doc,
      [{ key: "textContent", op: "set-key", path: ["children", 1], value: "From peer" }],
      LOCAL_ORIGIN,
    );
    await settleCollab();

    expect(childNode(tabJson(tab), 1).textContent).toBe("From peer");
    // Remote edits never create local history entries.
    expect(tab.history.snapshots).toHaveLength(1);
    // A peer's edit means the shared doc now differs from disk: the room is dirty for this tab too.
    expect(tab.doc.dirty).toBe(true);
    peer.destroy();
  });

  test("concurrent local+peer sibling inserts converge on both sides", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    const peer = (await hub.capability(PATH))!;

    transactDoc(tab, (t) => mutateInsertNode(t, [], 0, { tagName: "local-nav" }));
    applyDocOpsToY(
      peer.doc,
      [{ index: 0, node: { tagName: "peer-aside" }, op: "insert-child", parentPath: [] }],
      LOCAL_ORIGIN,
    );
    await settleCollab();

    expect(tabJson(tab)).toEqual(yDocToJson(hub.serverDoc(PATH)));
    expect(tabJson(tab).children).toHaveLength(4);
    peer.destroy();
  });
});

describe("frontmatter sync", () => {
  test("local frontmatter edits publish per-field", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    mutateUpdateFrontmatter(tab, "title", "New Title");
    await settleCollab();

    expect(frontmatterMap(hub.serverDoc(PATH)).get("title")).toBe("New Title");
  });

  test("peer frontmatter edits arrive per-field", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    const peer = (await hub.capability(PATH))!;

    peer.doc.transact(() => {
      frontmatterMap(peer.doc).set("description", "From peer");
    }, LOCAL_ORIGIN);
    await settleCollab();

    expect(tab.doc.content.frontmatter["description"]).toBe("From peer");
    peer.destroy();
  });
});

describe("batching", () => {
  test("an AI batch publishes once and undoes as one step", async () => {
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);

    let serverTransactions = 0;
    hub.serverDoc(PATH).on("update", () => {
      serverTransactions += 1;
    });
    const lane = openBatchLane(assistant);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Step 1"), {
      actor: assistant,
    });
    transactDoc(tab, (t) => mutateInsertNode(t, [], 2, { tagName: "step-two" }), {
      actor: assistant,
    });
    expect(serverTransactions).toBe(0);
    lane.close();
    await settleCollab();

    expect(serverTransactions).toBe(1);
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));

    undo(tab);
    await settleCollab();
    const doc = tabJson(tab);
    expect(childNode(doc, 0).textContent).toBe("Title");
    expect(doc.children).toHaveLength(2);
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
  });
});

describe("batching beside a person's edits", () => {
  test("a person's edit on the batched tab publishes after the assistant's buffered ops", async () => {
    /* The assistant's ops are buffered until its segment closes, and the person's edit closes it
       first. Published the other way round, the Y tree would apply the person's insert at an index
       computed after the assistant's, and the shared document would diverge from the tab. */
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    const lane = openBatchLane(assistant);
    transactDoc(tab, (t) => mutateInsertNode(t, [], 0, { tagName: "assistant-first" }), {
      actor: assistant,
    });

    transactDoc(tab, (t) => mutateInsertNode(t, [], 1, { tagName: "person-second" }));

    expect(isBatched(tab)).toBe(false);
    expect(yDocToJson(hub.serverDoc(PATH))).toEqual(tabJson(tab));
    expect(childNode(tabJson(tab), 0).tagName).toBe("assistant-first");
    expect(childNode(tabJson(tab), 1).tagName).toBe("person-second");
    lane.close();
  });

  test("a person's edit on another collab tab publishes at once, not into the batch", async () => {
    /* The batch used to be global, so the second tab's edit was buffered on ITS session and only
       the batched tab's buffer was ever flushed: the person's change never reached the room. */
    const hub = createMockCollabHub();
    const tab = await openAttached(hub);
    const other = openTab({ document: structuredClone(DOC), documentPath: SECOND, id: SECOND });
    await settleCollab();
    const lane = openBatchLane(assistant);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Assistant"), {
      actor: assistant,
    });

    transactDoc(other, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Person"));

    const room = yDocToJson(hub.serverDoc(SECOND));
    expect(childNode(room, 0).textContent).toBe("Person");
    lane.close();
    await settleCollab();
    const batched = yDocToJson(hub.serverDoc(PATH));
    expect(childNode(batched, 0).textContent).toBe("Assistant");
  });
});
