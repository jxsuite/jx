import { describe, expect, test } from "bun:test";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ContentHash, ProjectEvent } from "@jxsuite/protocol/project-state";
import { contentStore, createContentStore, resetContentStore } from "../src/project-state/store";
import type { StoreChange } from "../src/project-state/store";

const hashes = new Map<string, ContentHash>();
/** The hash of `text`, computed once per test file. */
async function h(text: string): Promise<ContentHash> {
  const known = hashes.get(text);
  if (known) {
    return known;
  }
  const hash = await contentHash(text);
  hashes.set(text, hash);
  return hash;
}

/** A snapshot of `files`, each `[path, docId, text | null]` where `null` is a directory. */
async function snapshot(files: [string, string, string | null][], extra = {}) {
  return {
    components: ["x-card"],
    files: await Promise.all(
      files.map(async ([path, docId, text]) => ({
        docId,
        indexed: true,
        isDir: text === null,
        kind: "page" as const,
        path,
        ...(text !== null && { hash: await h(text) }),
      })),
    ),
    formats: "f1",
    readiness: "ready" as const,
    ...extra,
  };
}

let rev = 0;
/** One event without its revision and origin, member by member. */
type BareEvent = ProjectEvent extends infer E
  ? E extends ProjectEvent
    ? Omit<E, "rev" | "origin">
    : never
  : never;

/** An event with the next revision and an external origin unless one is given. */
function ev(event: BareEvent, origin: ProjectEvent["origin"] = "external"): ProjectEvent {
  rev += 1;
  return { ...event, origin, rev };
}

/** A `fileChanged` reporting `text` at `path`. */
async function fc(
  path: string,
  docId: string,
  text: string,
  origin: ProjectEvent["origin"] = "external",
): Promise<ProjectEvent> {
  return ev({ docId, hash: await h(text), path, type: "fileChanged" }, origin);
}

describe("content store", () => {
  test("a snapshot indexes documents by id and path, with the project fields", async () => {
    const store = createContentStore();
    const git = { branch: "main", changed: {}, head: "abc" };
    const change = store.applySnapshot(
      await snapshot(
        [
          ["pages", "d0", null],
          ["pages/a.json", "d1", "A"],
        ],
        { git },
      ),
    );
    expect(change).toEqual({ docIds: [], paths: [], snapshot: true });
    expect(store.docAt("pages/a.json")?.docId).toBe("d1");
    expect(store.document("d0")?.isDir).toBe(true);
    expect(store.hashAt("pages/a.json")).toBe(await h("A"));
    expect(store.hashAt("pages")).toBeUndefined();
    expect(store.hashAt("missing")).toBeUndefined();
    expect(store.documents()).toHaveLength(2);
    expect(store.components).toEqual(["x-card"]);
    expect(store.formats).toBe("f1");
    expect(store.readiness).toBe("ready");
    expect(store.git).toEqual(git);
  });

  test("contents are held by (docId, hash) and follow a rename without moving", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    store.put("a.json", await h("A"), "A");
    expect(store.contents("d1", await h("A"))).toBe("A");
    expect(store.contentsAt("a.json")).toBe("A");
    const change = store.applyEvent(
      ev({ docId: "d1", from: "a.json", isDir: false, to: "b.json", type: "fileRenamed" }),
    );
    expect(change.docIds).toEqual([]);
    expect(change.paths).toEqual(["a.json", "b.json"]);
    expect(store.docAt("a.json")).toBeUndefined();
    expect(store.contentsAt("b.json")).toBe("A");
    expect(store.contentsAt("missing")).toBeUndefined();
  });

  test("a directory rename relabels everything under it", async () => {
    const store = createContentStore();
    store.applySnapshot(
      await snapshot([
        ["pages", "d0", null],
        ["pages/a.json", "d1", "A"],
        ["pagesx.json", "d2", "X"],
      ]),
    );
    store.applyEvent(
      ev({ docId: "d0", from: "pages", isDir: true, to: "docs", type: "fileRenamed" }),
    );
    expect(store.docAt("docs/a.json")?.docId).toBe("d1");
    expect(store.docAt("docs")?.docId).toBe("d0");
    expect(store.docAt("pagesx.json")?.docId).toBe("d2");
  });

  test("a change drops the bytes it replaced and keeps bytes that match the new hash", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    store.put("a.json", await h("A"), "A");
    // Bytes for a hash the host has not reported yet wait for it.
    store.put("a.json", await h("B"), "B");
    expect(store.contentsAt("a.json")).toBe("A");
    const change = store.applyEvent(await fc("a.json", "d1", "B"));
    expect(change.docIds).toEqual(["d1"]);
    expect(change.paths).toEqual(["a.json"]);
    expect(store.contentsAt("a.json")).toBe("B");
    expect(store.contents("d1", await h("A"))).toBeUndefined();
    // A change to other bytes drops what was held.
    store.applyEvent(await fc("a.json", "d1", "C"));
    expect(store.contentsAt("a.json")).toBeUndefined();
    // The same hash again changes nothing.
    const same = store.applyEvent(await fc("a.json", "d1", "C"));
    expect(same.docIds).toEqual([]);
  });

  test("a change drops held bytes the host no longer has", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    store.put("a.json", await h("A"), "A");
    store.applyEvent(await fc("a.json", "d1", "B"));
    expect(store.contentsAt("a.json")).toBeUndefined();
  });

  test("a change for an unknown document creates it, and one at a new path moves it", async () => {
    const store = createContentStore();
    store.applyEvent(await fc("z.json", "d9", "Z"));
    expect(store.docAt("z.json")).toMatchObject({ docId: "d9", indexed: false, kind: "other" });
    store.applyEvent(await fc("y.json", "d9", "Y"));
    expect(store.docAt("z.json")).toBeUndefined();
    expect(store.docAt("y.json")?.hash).toBe(await h("Y"));
  });

  test("an add binds bytes written before the host indexed the path", async () => {
    const store = createContentStore();
    store.put("new.json", await h("N"), "N");
    // An add without a hash cannot be matched yet; its docChanged can.
    store.applyEvent(ev({ docId: "d5", isDir: false, path: "new.json", type: "fileAdded" }));
    expect(store.contentsAt("new.json")).toBeUndefined();
    store.applyEvent(
      ev({
        docId: "d5",
        hash: await h("N"),
        indexed: true,
        kind: "page",
        path: "new.json",
        type: "docChanged",
      }),
    );
    expect(store.docAt("new.json")).toMatchObject({ indexed: true, kind: "page" });
    expect(store.contentsAt("new.json")).toBe("N");
  });

  test("an add with other bytes drops the waiting ones", async () => {
    const store = createContentStore();
    store.put("new.json", await h("N"), "N");
    store.applyEvent(
      ev({ docId: "d5", hash: await h("M"), isDir: false, path: "new.json", type: "fileAdded" }),
    );
    expect(store.contentsAt("new.json")).toBeUndefined();
    store.put("new.json", await h("M"), "M");
    expect(store.contentsAt("new.json")).toBe("M");
  });

  test("an add at an indexed path displaces the document there", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    const change = store.applyEvent(
      ev({ docId: "d2", hash: await h("B"), isDir: false, path: "a.json", type: "fileAdded" }),
    );
    expect(change.docIds.toSorted()).toEqual(["d1", "d2"]);
    expect(store.document("d1")).toBeUndefined();
    expect(store.docAt("a.json")?.docId).toBe("d2");
  });

  test("a removal drops a document, and a directory's removal everything under it", async () => {
    const store = createContentStore();
    store.applySnapshot(
      await snapshot([
        ["pages", "d0", null],
        ["pages/a.json", "d1", "A"],
        ["b.json", "d2", "B"],
      ]),
    );
    store.put("b.json", await h("B"), "B");
    let change = store.applyEvent(
      ev({ docId: "d2", isDir: false, path: "b.json", type: "fileRemoved" }),
    );
    expect(change.docIds).toEqual(["d2"]);
    expect(store.contents("d2", await h("B"))).toBeUndefined();
    change = store.applyEvent(ev({ docId: "d0", isDir: true, path: "pages", type: "fileRemoved" }));
    expect(change.docIds.toSorted()).toEqual(["d0", "d1"]);
    expect(store.documents()).toEqual([]);
  });

  test("a document event refines kind and index state", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    store.applyEvent(
      ev({
        docId: "d1",
        hash: await h("A"),
        indexed: false,
        kind: "layout",
        path: "a.json",
        type: "docChanged",
      }),
    );
    expect(store.docAt("a.json")).toMatchObject({ indexed: false, kind: "layout" });
  });

  test("project-level events update the project fields", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["project.json", "d1", "P"]]));
    store.applyEvent(ev({ tags: ["x-a", "x-b"], type: "componentsChanged" }));
    store.applyEvent(ev({ formats: "f2", type: "formatsChanged" }));
    const status = { branch: null, changed: { "a.json": "modified" as const }, head: null };
    store.applyEvent(ev({ status, type: "gitChanged" }));
    store.applyEvent(ev({ state: "indexed", type: "readiness" }));
    const config = store.applyEvent(
      ev({ hash: await h("Q"), path: "project.json", type: "projectConfigChanged" }),
    );
    expect(config.docIds).toEqual(["d1"]);
    // A config event for a path the store has not indexed changes nothing.
    const elsewhere = ev({ hash: await h("Q"), path: "other.json", type: "projectConfigChanged" });
    expect(store.applyEvent(elsewhere).docIds).toEqual([]);
    store.applyEvent(ev({ reason: "gone", type: "watcherDegraded" }));
    expect(store.components).toEqual(["x-a", "x-b"]);
    expect(store.formats).toBe("f2");
    expect(store.git).toEqual(status);
    expect(store.readiness).toBe("indexed");
    expect(store.hashAt("project.json")).toBe(await h("Q"));
  });

  test("a snapshot replaces state: what it omits or rehashes is reported and dropped", async () => {
    const store = createContentStore();
    store.applySnapshot(
      await snapshot([
        ["a.json", "d1", "A"],
        ["b.json", "d2", "B"],
        ["c.json", "d3", "C"],
      ]),
    );
    store.put("a.json", await h("A"), "A");
    store.put("b.json", await h("B"), "B");
    store.put("c.json", await h("C"), "C");
    const seen: StoreChange[] = [];
    const stop = store.onChange((change) => seen.push(change));
    const change = store.applySnapshot(
      await snapshot([
        ["a.json", "d1", "A"],
        ["b.json", "d2", "B2"],
      ]),
    );
    stop();
    store.applyEvent(ev({ state: "ready", type: "readiness" }));
    expect(seen).toHaveLength(1);
    expect(change.docIds.toSorted()).toEqual(["d2", "d3"]);
    expect(change.paths.toSorted()).toEqual(["b.json", "c.json"]);
    expect(store.contentsAt("a.json")).toBe("A");
    expect(store.contents("d2", await h("B"))).toBeUndefined();
    expect(store.document("d3")).toBeUndefined();
    expect(store.git).toBeNull();
  });

  test("own writes are recognised by their bytes, once, and an older report clears nothing", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    expect(store.pendingWriteAt("a.json")).toBeUndefined();
    await store.noteOwnWrite("a.json", "B");
    // Until its echo arrives, the write's hash is the bytes the path is about to hold.
    expect(store.pendingWriteAt("a.json")).toBe(await h("B"));
    const echo = await fc("a.json", "d1", "B");
    const first = store.isOwnEvent(echo);
    expect(store.pendingWriteAt("a.json")).toBeUndefined();
    // The note is consumed: the same bytes again are somebody else's.
    const again = store.isOwnEvent(echo);
    expect([first, again]).toEqual([true, false]);
    // A report of other bytes queued ahead of the echo does not cancel the note.
    await store.noteOwnWrite("a.json", "C");
    const other = await fc("a.json", "d1", "D");
    expect(store.isOwnEvent(other)).toBe(false);
    const late = await fc("a.json", "d1", "C");
    expect(store.isOwnEvent(late)).toBe(true);
  });

  test("a coalesced report of the last write consumes the notes before it", async () => {
    const store = createContentStore();
    await store.noteOwnWrite("a.json", "1");
    await store.noteOwnWrite("a.json", "2");
    await store.noteOwnWrite("a.json", "3");
    const report = async (text: string) => store.isOwnEvent(await fc("a.json", "d1", text));
    expect(await report("2")).toBe(true);
    expect(await report("1")).toBe(false);
    expect(await report("3")).toBe(true);
  });

  test("an own write of the bytes already on disk notes nothing, but holds them", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    await store.noteOwnWrite("a.json", "A");
    expect(store.contentsAt("a.json")).toBe("A");
    expect(store.isOwnEvent(await fc("a.json", "d1", "A"))).toBe(false);
  });

  test("bytes, buffers and blobs are hashed as the bytes they hold", async () => {
    const store = createContentStore();
    const bytes = new TextEncoder().encode("bin");
    await store.noteOwnWrite("a.bin", bytes);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    await store.noteOwnWrite("b.bin", copy.buffer);
    await store.noteOwnWrite("c.bin", new Blob([bytes]));
    for (const path of ["a.bin", "b.bin", "c.bin"]) {
      const add = ev({ docId: path, hash: await h("bin"), isDir: false, path, type: "fileAdded" });
      expect(store.isOwnEvent(add)).toBe(true);
    }
    // An add the host has not hashed cannot be attributed.
    expect(
      store.isOwnEvent(ev({ docId: "d", isDir: false, path: "d.bin", type: "fileAdded" })),
    ).toBe(false);
  });

  test("an own write's id is recognised whatever the bytes, and removals clear notes", async () => {
    const store = createContentStore();
    store.noteWriteId("w1");
    const origin = { writeHash: null, writeId: "w1" };
    expect(
      store.isOwnEvent(
        ev({ docId: "d1", isDir: false, path: "a.json", type: "fileRemoved" }, origin),
      ),
    ).toBe(true);
    await store.noteOwnWrite("b.json", "B");
    expect(
      store.isOwnEvent(ev({ docId: "d2", isDir: false, path: "b.json", type: "fileRemoved" })),
    ).toBe(false);
    expect(store.isOwnEvent(await fc("b.json", "d2", "B"))).toBe(false);
    expect(store.isOwnEvent(ev({ state: "ready", type: "readiness" }))).toBe(false);
  });

  test("a write attributed by its id consumes its note, so a later return to its bytes is not", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "0"]]));
    // Save A, then save B, each through the contract with its id and its bytes noted.
    store.noteWriteId("w1");
    await store.noteOwnWrite("a.json", "A");
    store.noteWriteId("w2");
    await store.noteOwnWrite("a.json", "B");
    expect(store.pendingWriteAt("a.json")).toBe(await h("B"));
    expect(store.pendingWriteAt("a.json", await h("B"))).toBe(await h("A"));
    const own = async (text: string, writeId: string) =>
      ev(
        { docId: "d1", hash: await h(text), path: "a.json", type: "fileChanged" },
        {
          writeHash: await h(text),
          writeId,
        },
      );
    expect(store.isOwnEvent(await own("A", "w1"))).toBe(true);
    expect(store.isOwnEvent(await own("B", "w2"))).toBe(true);
    expect(store.pendingWriteAt("a.json")).toBeUndefined();
    // Another writer puts A back (an undo, a checkout): not Studio's.
    expect(store.isOwnEvent(await fc("a.json", "d1", "A"))).toBe(false);
    // An own event of bytes Studio never noted is still its own, and consumes nothing.
    await store.noteOwnWrite("a.json", "C");
    expect(store.isOwnEvent(await own("D", "w2"))).toBe(true);
    expect(store.pendingWriteAt("a.json")).toBe(await h("C"));
    // An event with no hash is attributed by its id alone.
    expect(
      store.isOwnEvent(
        ev(
          { docId: "d9", isDir: true, path: "dir", type: "fileAdded" },
          {
            writeHash: null,
            writeId: "w2",
          },
        ),
      ),
    ).toBe(true);
  });

  test("a refused write's note is forgotten; unknown bytes and unreadable ones change nothing", async () => {
    const store = createContentStore();
    await store.noteOwnWrite("a.json", "A");
    await store.noteOwnWrite("a.json", "B");
    await store.forgetOwnWrite("a.json", "A");
    expect(store.pendingWriteAt("a.json")).toBe(await h("B"));
    await store.forgetOwnWrite("a.json", "Z");
    await store.forgetOwnWrite("b.json", "B");
    const unreadable = new Blob(["x"]);
    unreadable.arrayBuffer = () => Promise.reject(new Error("gone"));
    await store.forgetOwnWrite("a.json", unreadable);
    expect(store.pendingWriteAt("a.json")).toBe(await h("B"));
    await store.forgetOwnWrite("a.json", "B");
    expect(store.pendingWriteAt("a.json")).toBeUndefined();
    expect(store.isOwnEvent(await fc("a.json", "d1", "B"))).toBe(false);
  });

  test("bytes that cannot be read are not noted, and the note does not reject", async () => {
    const store = createContentStore();
    const unreadable = new Blob(["x"]);
    unreadable.arrayBuffer = () => Promise.reject(new Error("gone"));
    await store.noteOwnWrite("u.bin", unreadable);
    await store.settled();
    expect(store.isOwnEvent(await fc("u.bin", "du", "x"))).toBe(false);
  });

  test("settled waits for every note in flight", async () => {
    const store = createContentStore();
    store.applySnapshot(await snapshot([["a.json", "d1", "A"]]));
    void store.noteOwnWrite("a.json", "B");
    await store.settled();
    expect(store.isOwnEvent(await fc("a.json", "d1", "B"))).toBe(true);
  });

  test("reset forgets the documents, the bytes, the notes and the project fields", async () => {
    contentStore.applySnapshot(
      await snapshot([["a.json", "d1", "A"]], { git: { branch: "x", changed: {}, head: null } }),
    );
    contentStore.put("a.json", await h("A"), "A");
    contentStore.put("later.json", await h("L"), "L");
    contentStore.noteWriteId("w");
    await contentStore.noteOwnWrite("a.json", "B");
    resetContentStore();
    expect(contentStore.documents()).toEqual([]);
    expect(contentStore.components).toEqual([]);
    expect(contentStore.formats).toBeNull();
    expect(contentStore.readiness).toBeNull();
    expect(contentStore.git).toBeNull();
    expect(
      contentStore.isOwnEvent(await fc("a.json", "d1", "B", { writeHash: null, writeId: "w" })),
    ).toBe(false);
    contentStore.applyEvent(
      ev({ docId: "d7", hash: await h("L"), isDir: false, path: "later.json", type: "fileAdded" }),
    );
    expect(contentStore.contentsAt("later.json")).toBeUndefined();
  });
});
