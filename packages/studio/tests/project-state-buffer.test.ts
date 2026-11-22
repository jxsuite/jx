import { installMockPlatform } from "./harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { contentHash } from "@jxsuite/protocol/project-state";
import { createTab } from "../src/tabs/tab";
import type { Tab } from "../src/tabs/tab";
import {
  bufferBase,
  conflictProblemKey,
  forgetDiskRevisions,
  noteBufferClosed,
  noteBufferRead,
  noteBufferRefused,
  noteBufferSaved,
  noteDiskHash,
  noteRoomConflict,
  tabBufferStatus,
} from "../src/project-state/buffer";
import { contentStore } from "../src/project-state/store";
import { collabState } from "../src/collab/collab-state";
import { problems, resetNotifications } from "../src/services/notify";
import { reactive } from "../src/reactivity";

const tabAt = (path: string | null, id = path ?? "untitled"): Tab =>
  createTab({ document: { tagName: "div" }, documentPath: path, id });

const conflictProblems = (path: string) =>
  problems.filter((record) => record.key === conflictProblemKey(path));

beforeEach(() => {
  // A platform with a project state client: only there does a tab hold a base (`studio.md` §3.4).
  installMockPlatform({
    subscribeProjectState: async () => {
      throw new Error("unused");
    },
  });
});

afterEach(() => {
  contentStore.reset();
  resetNotifications();
});

describe("a tab's buffer state (project-state.md §6.1)", () => {
  test("dirty is the buffer's revisions: an edit moves bufferRev, a save moves savedRev", () => {
    const tab = tabAt("a.json");
    expect(tab.doc.buffer).toEqual({ baseHash: null, bufferRev: 0, diskHash: null, savedRev: 0 });
    expect(tab.doc.dirty).toBe(false);
    tab.doc.dirty = true;
    tab.doc.dirty = true;
    expect(tab.doc.buffer.bufferRev).toBe(2);
    expect(tab.doc.dirty).toBe(true);
    tab.doc.dirty = false;
    expect(tab.doc.buffer.savedRev).toBe(2);
    expect(tab.doc.dirty).toBe(false);
  });

  test("a read notes its hash as base and disk, and fills the store; a newer read wins", async () => {
    const tab = tabAt("a.json");
    // A tab whose bytes were never hashed is dirty or clean by its revisions alone.
    expect(tabBufferStatus(tab)).toBe("clean");
    tab.doc.dirty = true;
    expect(tabBufferStatus(tab)).toBe("dirty");
    tab.doc.dirty = false;

    const first = noteBufferRead(tab, "one", "a.json");
    const second = noteBufferRead(tab, "two", "a.json");
    await Promise.all([first, second]);
    const two = await contentHash("two");
    expect(tab.doc.buffer.baseHash).toBe(two);
    expect(tab.doc.buffer.diskHash).toBe(two);
    expect(tabBufferStatus(tab)).toBe("clean");

    // A read with no path notes the base and holds no bytes.
    const loose = tabAt(null);
    await noteBufferRead(loose, "three");
    expect(loose.doc.buffer.baseHash).toBe(await contentHash("three"));
  });

  test("a save names the base it read, waiting for the hash, or the host's hash when it read none", async () => {
    const tab = tabAt("a.json");
    void noteBufferRead(tab, "one", "a.json");
    expect(await bufferBase(tab, "a.json")).toBe(await contentHash("one"));

    const fresh = tabAt("b.json");
    expect(await bufferBase(fresh, "b.json")).toBeNull();
    contentStore.applySnapshot({
      components: [],
      files: [
        {
          docId: "d2",
          hash: "sha256-b",
          indexed: true,
          isDir: false,
          kind: "page",
          path: "b.json",
        },
      ],
      formats: "f",
      readiness: "ready",
    });
    expect(await bufferBase(fresh, "b.json")).toBe("sha256-b");
  });

  test("a save that reached disk becomes the base; an edit made during it stays dirty", async () => {
    const tab = tabAt("a.json");
    void noteBufferRead(tab, "one", "a.json");
    tab.doc.dirty = true;
    noteBufferSaved(tab, "a.json", { bufferRev: 1, contents: "two", hash: "sha256-2", rev: 4 });
    expect(tab.doc.buffer).toMatchObject({
      baseHash: "sha256-2",
      diskHash: "sha256-2",
      savedRev: 1,
    });
    expect(tab.doc.dirty).toBe(false);
    // The read still being hashed names older bytes, and is dropped.
    expect(await bufferBase(tab, "a.json")).toBe("sha256-2");

    tab.doc.dirty = true;
    tab.doc.dirty = true;
    noteBufferSaved(tab, "a.json", { bufferRev: 2, contents: "three", hash: "sha256-3", rev: 5 });
    expect(tab.doc.buffer.savedRev).toBe(2);
    expect(tabBufferStatus(tab)).toBe("dirty");
  });

  test("a refused write leaves the buffer conflicted until the author chooses", async () => {
    const tab = tabAt("a.json");
    tab.doc.dirty = true;
    noteBufferRefused(tab, "sha256-other");
    expect(tabBufferStatus(tab)).toBe("conflicted");
  });

  test("the disk's hash reaches every tab of the path; an edited tab whose base it misses conflicts", async () => {
    const clean = tabAt("a.json", "clean");
    const edited = tabAt("a.json", "edited");
    const other = tabAt("b.json");
    const unknown = tabAt("a.json", "unknown");
    await noteBufferRead(clean, "one", "a.json");
    await noteBufferRead(edited, "one", "a.json");
    edited.doc.dirty = true;
    unknown.doc.dirty = true;
    const one = await contentHash("one");

    // A tab that holds the bytes already: nothing to re-read.
    expect(noteDiskHash([clean, edited, other, unknown], "a.json", one, { rev: 3 })).toBe(true);
    expect(conflictProblems("a.json")).toHaveLength(0);

    // Another writer's bytes: the edited tab conflicts and the author is told once.
    expect(noteDiskHash([clean, edited, other, unknown], "a.json", "sha256-x", { rev: 4 })).toBe(
      false,
    );
    expect(tabBufferStatus(edited)).toBe("conflicted");
    expect(tabBufferStatus(clean)).toBe("clean");
    expect(tabBufferStatus(unknown)).toBe("dirty");
    expect(unknown.doc.buffer.diskHash).toBe("sha256-x");
    noteDiskHash([edited], "a.json", "sha256-y", { rev: 5 });
    expect(conflictProblems("a.json")).toHaveLength(1);
    expect(conflictProblems("a.json")[0]!.message).toBe(
      "a.json changed on disk while it had unsaved edits.",
    );

    // An event older than what the tab took is skipped, and re-reads nothing.
    expect(noteDiskHash([clean], "a.json", "sha256-old", { rev: 2 })).toBe(true);
    expect(clean.doc.buffer.diskHash).toBe("sha256-x");

    // A read of the new bytes takes the problem down.
    await noteBufferRead(edited, "fresh", "a.json");
    expect(conflictProblems("a.json")).toHaveLength(0);
  });

  test("Studio's own write never conflicts the tab, and a snapshot's hash carries no revision", async () => {
    const tab = tabAt("a.json");
    await noteBufferRead(tab, "one", "a.json");
    tab.doc.dirty = true;
    noteDiskHash([tab], "a.json", "sha256-mine", { own: true, rev: 1 });
    expect(conflictProblems("a.json")).toHaveLength(0);
    noteDiskHash([tab], "a.json", "sha256-snap");
    expect(tab.doc.buffer.diskHash).toBe("sha256-snap");
  });

  test("the reactive tab a workspace hands back is the same buffer as the raw one", async () => {
    const tab = tabAt("a.json");
    /* SAFETY: `reactive` returns a deep proxy carrying the tab's own members; the type argument is
       pinned because unwrapping a tab's nested refs recurses past what tsc follows. */
    const proxy = reactive<object>(tab) as Tab;
    await noteBufferRead(proxy, "one", "a.json");
    expect(tabBufferStatus(tab)).toBe("clean");
    tab.doc.dirty = true;
    noteDiskHash([proxy], "a.json", "sha256-x", { rev: 1 });
    expect(tabBufferStatus(tab)).toBe("conflicted");
  });
});

describe("a co-edited tab reads its room's buffer state", () => {
  test("the room's refusal is the tab's conflict, until the room saves", () => {
    const tab = tabAt("a.json");
    const room = collabState(tab);
    room.active = true;
    expect(tabBufferStatus(tab)).toBe("clean");
    tab.doc.dirty = true;
    expect(tabBufferStatus(tab)).toBe("dirty");
    // The room owns the disk hash: a host event leaves the tab alone.
    expect(noteDiskHash([tab], "a.json", "sha256-x", { rev: 1 })).toBe(false);
    expect(tab.doc.buffer.diskHash).toBeNull();

    noteRoomConflict(tab, true);
    noteRoomConflict(tab, true);
    expect(tabBufferStatus(tab)).toBe("conflicted");
    expect(conflictProblems("a.json")).toHaveLength(1);
    expect(conflictProblems("a.json")[0]!.source).toBe("Collaboration");

    noteRoomConflict(tab, false);
    expect(tabBufferStatus(tab)).toBe("dirty");
    expect(conflictProblems("a.json")).toHaveLength(0);
  });

  test("a room conflict on a tab with no path is recorded and reported nowhere", () => {
    const tab = tabAt(null);
    collabState(tab).active = true;
    noteRoomConflict(tab, true);
    expect(tabBufferStatus(tab)).toBe("conflicted");
    expect(problems).toHaveLength(0);
  });
});

describe("what a tab's buffer state survives", () => {
  test("a platform with no project state client notes nothing, and hashes nothing", async () => {
    installMockPlatform();
    const tab = tabAt("a.json");
    await noteBufferRead(tab, "one", "a.json");
    expect(tab.doc.buffer.baseHash).toBeNull();
    expect(contentStore.contentsAt("a.json")).toBeUndefined();
    expect(await bufferBase(tab, "a.json")).toBeNull();
  });

  test("bytes that cannot be hashed leave the tab without a base, and nothing rejects", async () => {
    const digest = spyOn(crypto.subtle, "digest").mockImplementation(() =>
      Promise.reject(new Error("crypto.subtle is unavailable")),
    );
    try {
      const tab = tabAt("a.json");
      await noteBufferRead(tab, "one", "a.json");
      expect(tab.doc.buffer.baseHash).toBeNull();
      // The save takes the host's hash, as for a tab Studio never hashed.
      expect(await bufferBase(tab, "a.json")).toBeNull();
      tab.doc.dirty = true;
      expect(tabBufferStatus(tab)).toBe("dirty");
      noteDiskHash([tab], "a.json", "sha256-x", { rev: 1 });
      expect(tabBufferStatus(tab)).toBe("dirty");
      // A read superseded before its hash failed is no business of the newer one.
      const older = noteBufferRead(tab, "two", "a.json");
      digest.mockRestore();
      await noteBufferRead(tab, "three", "a.json");
      await older;
      expect(tab.doc.buffer.baseHash).toBe(await contentHash("three"));
    } finally {
      digest.mockRestore();
    }
  });

  test("after a snapshot, revisions start over: a restarted host's changes still reach the tab", async () => {
    const tab = tabAt("a.json");
    await noteBufferRead(tab, "one", "a.json");
    noteBufferSaved(tab, "a.json", { bufferRev: 0, contents: "two", hash: "sha256-2", rev: 40 });
    tab.doc.dirty = true;
    // The old epoch: an event older than the save is skipped.
    expect(noteDiskHash([tab], "a.json", "sha256-old", { rev: 39 })).toBe(true);
    expect(tab.doc.buffer.diskHash).toBe("sha256-2");
    // The host restarted: its snapshot starts a new count, from 1.
    forgetDiskRevisions();
    expect(noteDiskHash([tab], "a.json", "sha256-new", { rev: 3 })).toBe(false);
    expect(tab.doc.buffer.diskHash).toBe("sha256-new");
    expect(tabBufferStatus(tab)).toBe("conflicted");
    expect(conflictProblems("a.json")).toHaveLength(1);
  });

  test("the conflict problem goes when the disk returns to the base, or the tab closes", async () => {
    const tab = tabAt("a.json");
    await noteBufferRead(tab, "one", "a.json");
    const one = await contentHash("one");
    tab.doc.dirty = true;
    noteDiskHash([tab], "a.json", "sha256-x", { rev: 1 });
    expect(conflictProblems("a.json")).toHaveLength(1);
    // Another writer undid its change: the tab is merely dirty again.
    noteDiskHash([tab], "a.json", one, { rev: 2 });
    expect(tabBufferStatus(tab)).toBe("dirty");
    expect(conflictProblems("a.json")).toHaveLength(0);

    noteDiskHash([tab], "a.json", "sha256-y", { rev: 3 });
    expect(conflictProblems("a.json")).toHaveLength(1);
    noteBufferClosed(tab);
    expect(conflictProblems("a.json")).toHaveLength(0);
    // A tab with no path reports nothing to take down.
    noteBufferClosed(tabAt(null));
    expect(problems).toHaveLength(0);
  });
});
