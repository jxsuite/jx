/**
 * Tests for `restoreTurn` in src/services/ai-writes.ts (ai.md §3.2): Restore takes back every step
 * a turn's batch lane left, across every document it wrote, while each is still the top of its
 * tab's history, and otherwise refuses the whole turn with a sentence naming the document.
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import { toRaw } from "../src/reactivity";
import { fileTurn, resetAiWrites, restoreTurn } from "../src/services/ai-writes";
import { createTab, disposeTab } from "../src/tabs/tab";
import {
  flushOpenBatches,
  mutateUpdateProperty,
  openBatchLane,
  redo,
  setHistoryDelegate,
  transactDoc,
  undo,
} from "../src/tabs/transact";
import type { ActorRef, BatchReceipt } from "../src/tabs/transact";
import type { Tab } from "../src/tabs/tab";

const assistant: ActorRef = { id: "assistant:local:t1", kind: "assistant", turnId: "t1" };

const tabs: Tab[] = [];

function makeTab(path: string): Tab {
  const tab = createTab({
    document: { tagName: "div", title: "start" },
    documentPath: path,
    id: path,
  });
  tabs.push(tab);
  return tab;
}

/** Set the root's `title` as `actor` (the person at the keyboard when `null`). */
function write(tab: Tab, title: string, actor: ActorRef | null = null): void {
  transactDoc(tab, (t) => mutateUpdateProperty(t, [], "title", title), { actor });
}

function titleOf(tab: Tab): string | undefined {
  const value = toRaw(tab.doc.document).title;
  return isString(value) ? value : undefined;
}

/** File a turn the way the loop does: one ledger write per tab, and the lane's receipts. */
function file(batches: readonly BatchReceipt[]): void {
  const paths = new Set(batches.map((receipt) => receipt.tab.documentPath ?? "(untitled)"));
  const writes = [...paths].map((path) => ({ disk: false, ok: true, path, tool: "update_style" }));
  fileTurn("m1", writes, batches);
}

/** Run one assistant turn that writes each of `targets` once, then file it. */
function turn(...targets: Tab[]): void {
  const lane = openBatchLane(assistant);
  for (const tab of targets) {
    write(tab, `assistant-${tab.documentPath}`, assistant);
  }
  file(lane.close());
}

beforeEach(() => {
  resetAiWrites();
});

afterEach(() => {
  flushOpenBatches();
  for (const tab of tabs.splice(0)) {
    disposeTab(tab);
  }
});

describe("restoring a turn", () => {
  test("undoes the turn in every document it wrote, and names the tabs it undid", () => {
    const a = makeTab("pages/a.json");
    const b = makeTab("pages/b.json");
    turn(a, b);

    const restored = restoreTurn("m1");

    expect(restored).toEqual([a, b]);
    expect(titleOf(a)).toBe("start");
    expect(titleOf(b)).toBe("start");
  });

  test("finds its step after the history limit moved every index", () => {
    const tab = makeTab("pages/a.json");
    for (let edit = 0; edit < 99; edit++) {
      write(tab, `person-${edit}`);
    }
    turn(tab);
    write(tab, "after");
    undo(tab);
    // The limit dropped the two oldest entries, so only the entry itself still names the step.
    expect(restoreTurn("m1")).toEqual([tab]);
    expect(titleOf(tab)).toBe("person-98");
  });
});

describe("refusing the whole turn", () => {
  test("after a person's later edit, and undoes nothing anywhere", () => {
    const a = makeTab("pages/a.json");
    const b = makeTab("pages/b.json");
    turn(a, b);
    write(b, "person");

    expect(restoreTurn("m1")).toBe(
      "Cannot restore: pages/b.json has edits made since that turn began, which Restore would undo too.",
    );
    expect(titleOf(a)).toBe("assistant-pages/a.json");
    expect(titleOf(b)).toBe("person");
  });

  test("when a person's edit split the turn, since undoing it would take that edit too", () => {
    const tab = makeTab("pages/a.json");
    const lane = openBatchLane(assistant);
    write(tab, "assistant-1", assistant);
    write(tab, "person");
    write(tab, "assistant-2", assistant);
    file(lane.close());

    expect(restoreTurn("m1")).toContain("pages/a.json has edits made since that turn began");
    expect(titleOf(tab)).toBe("assistant-2");
  });

  test("when the step was already undone", () => {
    const tab = makeTab("pages/a.json");
    turn(tab);
    undo(tab);

    expect(restoreTurn("m1")).toBe(
      "Cannot restore: that turn's change to pages/a.json was already undone.",
    );
    redo(tab);
    expect(restoreTurn("m1")).toEqual([tab]);
  });

  test("when a document it wrote was closed", () => {
    const a = makeTab("pages/a.json");
    turn(a);
    disposeTab(a);

    expect(restoreTurn("m1")).toBe("Cannot restore: pages/a.json was closed after that turn.");
  });

  test("when a document it wrote is shared live, whose undo the session owns", () => {
    const tab = makeTab("pages/a.json");
    setHistoryDelegate(tab, {
      canRedo: () => false,
      canUndo: () => true,
      redo: () => {},
      undo: () => {},
    });
    turn(tab);

    expect(restoreTurn("m1")).toContain("pages/a.json is shared live");
    setHistoryDelegate(tab, null);
  });

  test("when the turn left no steps, or no record at all", () => {
    fileTurn("m1", [{ disk: false, ok: true, path: "pages/a.json", tool: "update_style" }]);
    expect(restoreTurn("m1")).toBe("There is no longer a record of what that turn changed.");
    expect(restoreTurn("nope")).toBe("There is no longer a record of what that turn changed.");
  });

  test("when it wrote to disk, naming every file", () => {
    const tab = makeTab("pages/a.json");
    const lane = openBatchLane(assistant);
    write(tab, "mine", assistant);
    fileTurn(
      "m1",
      [
        { disk: false, ok: true, path: "pages/a.json", tool: "update_style" },
        { disk: true, ok: true, path: "a.json", tool: "write_file" },
        { disk: true, ok: true, path: "b.json", tool: "write_file" },
      ],
      lane.close(),
    );

    expect(restoreTurn("m1")).toBe(
      "Cannot restore: a.json, b.json were written straight to disk, which undo cannot reach.",
    );
    expect(titleOf(tab)).toBe("mine");
  });
});
