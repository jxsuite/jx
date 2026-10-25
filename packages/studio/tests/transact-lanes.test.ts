/**
 * Tests for the batch lanes in src/tabs/transact.ts (specs/ai.md §3.3): an actor's run of writes is
 * one undo step per document it writes, a person's edit is never folded into it, and a document the
 * lane never wrote gets no entry.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import { toRaw } from "../src/reactivity";
import { createTab, disposeTab } from "../src/tabs/tab";
import {
  canRedo,
  canUndo,
  flushOpenBatches,
  isBatched,
  mutateUpdateProperty,
  openBatchLane,
  redo,
  runAsActor,
  setBatchEndNotifier,
  setHistoryDelegate,
  setTransactGate,
  transactDoc,
  undo,
} from "../src/tabs/transact";
import type { ActorRef } from "../src/tabs/transact";
import type { Tab } from "../src/tabs/tab";

const assistant: ActorRef = { id: "assistant:local:t1", kind: "assistant", turnId: "t1" };
const other: ActorRef = { id: "assistant:local:t2", kind: "assistant", turnId: "t2" };

const tabs: Tab[] = [];

function makeTab(id: string): Tab {
  const tab = createTab({ document: { tagName: "div", title: "start" }, id });
  tabs.push(tab);
  return tab;
}

/** Set the root's `title` as `actor` (the person at the keyboard when `null`). */
function write(tab: Tab, title: string, actor: ActorRef | null = null): boolean {
  return transactDoc(tab, (t) => mutateUpdateProperty(t, [], "title", title), { actor });
}

function titleOf(tab: Tab): string | undefined {
  const value = toRaw(tab.doc.document).title;
  return isString(value) ? value : undefined;
}

afterEach(() => {
  flushOpenBatches();
  setBatchEndNotifier(null);
  setTransactGate(null);
  for (const tab of tabs.splice(0)) {
    disposeTab(tab);
  }
});

describe("one step per document the lane writes", () => {
  test("a lane's writes on one tab undo as one step, tagged with the lane's owner", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "one", assistant);
    write(tab, "two", assistant);
    expect(tab.history.snapshots).toHaveLength(1);

    const receipts = lane.close();

    expect(tab.history.snapshots).toHaveLength(2);
    expect(tab.history.snapshots[1]).toMatchObject({ actor: assistant.id, turnId: "t1" });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.tab).toBe(tab);
    expect(receipts[0]).toMatchObject({ entryIndex: 1, turnId: "t1" });
    undo(tab);
    expect(titleOf(tab)).toBe("start");
  });

  test("A then B then A gives one entry per document", () => {
    const a = makeTab("a");
    const b = makeTab("b");
    const lane = openBatchLane(assistant);
    write(a, "a1", assistant);
    write(b, "b1", assistant);
    write(a, "a2", assistant);

    expect(lane.close().map((receipt) => receipt.tab.id)).toEqual(["a", "b"]);
    expect(a.history.snapshots).toHaveLength(2);
    expect(b.history.snapshots).toHaveLength(2);
    undo(a);
    expect(titleOf(a)).toBe("start");
  });

  test("an empty lane adds no entry anywhere", () => {
    const tab = makeTab("a");
    const notified: Tab[] = [];
    setBatchEndNotifier((t) => notified.push(t));

    expect(openBatchLane(assistant).close()).toEqual([]);

    expect(tab.history.snapshots).toHaveLength(1);
    expect(notified).toEqual([]);
  });

  test("a flushed lane stays open: the next write opens a new segment", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "one", assistant);
    lane.flush();
    expect(isBatched(tab)).toBe(false);
    write(tab, "two", assistant);
    expect(isBatched(tab, assistant)).toBe(true);

    expect(lane.close().map((receipt) => receipt.entryIndex)).toEqual([1, 2]);
  });

  test("a write the lane's owner makes after the lane closes is its own step", () => {
    const tab = makeTab("a");
    openBatchLane(assistant).close();
    write(tab, "late", assistant);
    expect(tab.history.snapshots).toHaveLength(2);
    expect(tab.history.snapshots[1]!.actor).toBeUndefined();
  });

  test("opening a second lane for the same owner closes the first one's segments", () => {
    const tab = makeTab("a");
    const first = openBatchLane(assistant);
    write(tab, "one", assistant);
    const second = openBatchLane(assistant);
    expect(tab.history.snapshots).toHaveLength(2);
    // The first handle no longer owns the lane, so closing it leaves the second open.
    first.close();
    write(tab, "two", assistant);
    expect(isBatched(tab, assistant)).toBe(true);
    expect(second.close()).toHaveLength(1);
  });
});

describe("a person's edit is never folded into the lane's step", () => {
  test("the F2/D12 probe: a person's edit on another tab keeps its own history", () => {
    const a = makeTab("a");
    const b = makeTab("b");
    const lane = openBatchLane(assistant);
    write(a, "assistant", assistant);
    write(b, "person");

    expect(b.history.snapshots).toHaveLength(2);
    expect(b.history.snapshots[1]!.actor).toBeUndefined();
    lane.close();
    undo(b);
    expect(titleOf(b)).toBe("start");
    expect(titleOf(a)).toBe("assistant");
  });

  test("a person's edit on the lane's tab splits the segment, in the order it happened", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "assistant-1", assistant);
    write(tab, "person");
    write(tab, "assistant-2", assistant);
    lane.close();

    expect(tab.history.snapshots.map((entry) => entry.actor ?? null)).toEqual([
      null,
      assistant.id,
      null,
      assistant.id,
    ]);
    undo(tab);
    expect(titleOf(tab)).toBe("person");
    undo(tab);
    expect(titleOf(tab)).toBe("assistant-1");
    undo(tab);
    expect(titleOf(tab)).toBe("start");
  });

  test("another actor's write closes the segment too", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    write(tab, "theirs", other);
    expect(isBatched(tab)).toBe(false);
    expect(tab.history.snapshots).toHaveLength(3);
    lane.close();
  });

  test("a write the gate refuses closes nothing", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    setTransactGate(() => "frozen");
    expect(write(tab, "person")).toBe(false);
    setTransactGate(null);
    expect(isBatched(tab, assistant)).toBe(true);
    expect(tab.history.snapshots).toHaveLength(1);
    lane.close();
  });

  test("a remote collaborator's ops neither join nor close the segment", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    transactDoc(tab, (t) => mutateUpdateProperty(t, [], "id", "remote"), {
      actor: assistant,
      origin: "remote",
      skipHistory: true,
    });
    expect(isBatched(tab, assistant)).toBe(true);
    expect(tab.history.snapshots).toHaveLength(1);
    lane.close();
  });
});

describe("undo and redo while a segment is open", () => {
  test("undo closes the segment and takes it back", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    expect(canUndo(tab)).toBe(true);

    undo(tab);

    expect(titleOf(tab)).toBe("start");
    expect(isBatched(tab)).toBe(false);
    expect(lane.close()).toHaveLength(1);
  });

  test("there is nothing to redo while a segment is open, and redo pushes the segment", () => {
    const tab = makeTab("a");
    write(tab, "person");
    undo(tab);
    expect(canRedo(tab)).toBe(true);
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    expect(canRedo(tab)).toBe(false);

    redo(tab);

    // The redo stack was measured against a document the segment had already changed.
    expect(titleOf(tab)).toBe("mine");
    expect(tab.history.snapshots.at(-1)!.actor).toBe(assistant.id);
    lane.close();
  });
});

describe("runAsActor", () => {
  test("attributes the writes made inside it, and only those", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    const result = runAsActor(assistant, () => write(tab, "inside"));
    expect(result).toBe(true);
    expect(isBatched(tab, assistant)).toBe(true);
    write(tab, "outside");
    expect(isBatched(tab)).toBe(false);
    lane.close();
  });

  test("is synchronous only: a write after an await inside it is the person's", async () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    await runAsActor(assistant, async () => {
      await Promise.resolve();
      write(tab, "after-await");
    });
    expect(isBatched(tab)).toBe(false);
    expect(tab.history.snapshots[1]!.actor).toBeUndefined();
    lane.close();
  });

  test("restores the outer scope when the inner one throws", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    runAsActor(assistant, () => {
      expect(() =>
        runAsActor(other, () => {
          throw new Error("boom");
        }),
      ).toThrow("boom");
      write(tab, "outer");
    });
    expect(isBatched(tab, assistant)).toBe(true);
    lane.close();
  });
});

describe("segments on unusual tabs", () => {
  test("a history-delegate tab gets no entry, and collab is still told the segment closed", () => {
    const tab = makeTab("a");
    setHistoryDelegate(tab, {
      canRedo: () => false,
      canUndo: () => false,
      redo: () => {},
      undo: () => {},
    });
    const notified: Tab[] = [];
    setBatchEndNotifier((t) => notified.push(t));
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);

    expect(lane.close()).toEqual([]);

    expect(tab.history.snapshots).toHaveLength(1);
    expect(notified).toEqual([tab]);
    setHistoryDelegate(tab, null);
  });

  test("an unrecorded mutation makes the segment's entry a snapshot, which still undoes", () => {
    const tab = makeTab("a");
    const lane = openBatchLane(assistant);
    write(tab, "recorded", assistant);
    transactDoc(
      tab,
      (t) => {
        t.doc.document.id = "unrecorded";
      },
      { actor: assistant },
    );
    lane.close();

    const entry = tab.history.snapshots.at(-1)!;
    expect(entry.forwardOps).toBeNull();
    expect(entry.document).not.toBeNull();
    undo(tab);
    expect(titleOf(tab)).toBe("start");
    expect(toRaw(tab.doc.document).id).toBeUndefined();
  });

  test("flushOpenBatches closes every lane's segments", () => {
    const a = makeTab("a");
    const b = makeTab("b");
    const first = openBatchLane(assistant);
    const second = openBatchLane(other);
    write(a, "one", assistant);
    write(b, "two", other);

    flushOpenBatches();

    expect(isBatched(a)).toBe(false);
    expect(isBatched(b)).toBe(false);
    expect(a.history.snapshots).toHaveLength(2);
    expect(b.history.snapshots).toHaveLength(2);
    expect(first.close()).toHaveLength(1);
    expect(second.close()).toHaveLength(1);
  });
});
