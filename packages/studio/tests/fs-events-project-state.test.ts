import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type {
  IndexedFile,
  ProjectEventInit,
  ProjectEventLog,
  SubscribeRequest,
  SubscribeResponse,
} from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import {
  markLocalMutation,
  markLocalWrite,
  noteLocalWrite,
  startFsSync,
} from "../src/files/fs-events";
import { onForeignDocumentChange } from "../src/project-state/foreign";
import { beginListing, noteListing, versionOf } from "../src/files/asset-versions";
import { projectState } from "../src/store";
import { contentStore } from "../src/project-state/store";
import { noteBufferRead, tabBufferStatus } from "../src/project-state/buffer";
import { projectStateLive, stopProjectStateSync } from "../src/project-state/subscription";
import type { DirEntry, FsEvent } from "../src/types";

const entry = (path: string): DirEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  type: "file",
});

const sleep = (ms: number) =>
  new Promise((resume) => {
    setTimeout(resume, ms);
  });

/** A host on the protocol's reference log, as the desktop and dev-server adapters front one. */
function fakeHost() {
  let log: ProjectEventLog = createMemoryEventLog({ epoch: "e1" });
  const files = new Map<string, IndexedFile>();
  let listener: ProjectStateListener | null = null;
  const requests: SubscribeRequest[] = [];
  return {
    requests,
    subscribe: async (
      request: SubscribeRequest,
      next: ProjectStateListener,
    ): Promise<SubscribeResponse> => {
      requests.push(request);
      listener = next;
      return answerSubscribe(log, request, () => ({
        components: [],
        files: [...files.values()],
        formats: "f",
        readiness: "ready",
      }));
    },
    async file(path: string, docId: string, text: string | null, deliver = true) {
      const isDir = text === null;
      const hash = isDir ? undefined : await contentHash(text);
      const existing = files.get(path);
      files.set(path, {
        docId,
        indexed: true,
        isDir,
        kind: isDir ? "other" : "page",
        path,
        ...(hash !== undefined && { hash }),
      });
      const init: ProjectEventInit =
        existing && hash !== undefined
          ? { docId, hash, origin: "external", path, type: "fileChanged" }
          : { docId, isDir, origin: "external", path, type: "fileAdded", ...(hash && { hash }) };
      const events = [log.append(init)];
      // A host follows every file's add or change with its `docChanged` (`project-state.md` §4.3).
      if (hash !== undefined) {
        events.push(
          log.append({
            docId,
            hash,
            indexed: true,
            kind: "page",
            origin: "external",
            path,
            type: "docChanged",
          }),
        );
      }
      if (deliver) {
        for (const event of events) {
          listener?.events({ epoch: log.epoch, events: [event] });
        }
      }
    },
    /** Append any event and deliver it. */
    emit(init: ProjectEventInit) {
      const event = log.append(init);
      listener?.events({ epoch: log.epoch, events: [event] });
    },
    /** A restarted host that has not hashed `path` yet lists it without a hash. */
    unhash(path: string) {
      const { hash: _hash, ...rest } = files.get(path)!;
      files.set(path, rest);
    },
    /** Forget a file without an event, for a snapshot to report. */
    drop(path: string) {
      files.delete(path);
    },
    restart() {
      log = createMemoryEventLog({ epoch: "e2" });
      listener?.ended?.("e1");
    },
    /** A restart into a new epoch that mints every `DocId` again, bytes unchanged. */
    remint(epoch = "e2") {
      for (const [path, file] of files) {
        files.set(path, { ...file, docId: `${file.docId}-${epoch}` });
      }
      const ended = log.epoch;
      log = createMemoryEventLog({ epoch });
      listener?.ended?.(ended);
    },
    /** The host fills in what it learned about the bytes it holds at `path`: the same hash. */
    refill(path: string) {
      const file = files.get(path)!;
      const event = log.append({
        docId: file.docId,
        hash: file.hash!,
        indexed: true,
        kind: "page",
        origin: "external",
        path,
        type: "docChanged",
      });
      listener?.events({ epoch: log.epoch, events: [event] });
    },
    /** End the subscription without a restart: a dropped socket, a reader that fell behind. */
    end() {
      listener?.ended?.(log.epoch);
    },
  };
}

/** Wait until the subscription has answered and applied what it was sent. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await sleep(0);
  }
}

afterEach(() => {
  stopProjectStateSync();
  contentStore.reset();
});

describe("startFsSync beside a project state subscription", () => {
  test("content changes come from the subscription, and Studio's own write reloads nothing", async () => {
    const host = fakeHost();
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
      subscribeProjectState: host.subscribe,
    });
    resetStudioState({ dirs: new Map([["live", [entry("live/a.json")]]]), expanded: new Set() });
    await host.file("live/a.json", "d1", "A");
    const changed: string[] = [];
    const renders: number[] = [];
    const stop = startFsSync({
      onContentChange: (path) => changed.push(path),
      renderLeftPanel: () => renders.push(1),
    });
    await settle();
    expect(projectStateLive()).toBe(true);

    // The watcher's `change` no longer reloads anything: the subscription reports content.
    handler([{ isDir: false, path: "live/a.json", type: "change" }]);
    await sleep(70);
    expect(changed).toEqual([]);

    // Studio's own write: noted by its bytes, so its echo is no content change.
    markLocalWrite("live/a.json", "B");
    await host.file("live/a.json", "d1", "B");
    await settle();
    expect(changed).toEqual([]);

    // Somebody else's write, however soon after, is one.
    await host.file("live/a.json", "d1", "C");
    await settle();
    expect(changed).toEqual(["live/a.json"]);

    // The tree still follows the watcher, echoes included: no window drops an event.
    markLocalMutation("live/b.json");
    handler([{ isDir: false, path: "live/b.json", type: "add" }]);
    await sleep(70);
    expect(renders.length).toBeGreaterThan(0);
    stop();
    expect(projectStateLive()).toBe(false);
  });

  test("open tabs take the disk's hash: held bytes re-read nothing, edited tabs conflict", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("a.json", "d1", '{"tagName":"div"}');
    await host.file("b.json", "d2", '{"tagName":"div"}');
    const changed: string[] = [];
    const stop = startFsSync({
      onContentChange: (path) => changed.push(path),
      renderLeftPanel: () => {},
    });
    await settle();
    const clean = resetWorkspaceWithTab({ tagName: "div" }, { documentPath: "a.json", id: "a" });
    await noteBufferRead(clean, '{"tagName":"div"}', "a.json");

    // An indexing pass that reports the bytes the tab already holds re-reads nothing.
    host.emit({
      docId: "d1",
      hash: await contentHash('{"tagName":"div"}'),
      indexed: true,
      kind: "page",
      origin: "external",
      path: "a.json",
      type: "docChanged",
    });
    await settle();
    expect(changed).toEqual([]);

    /* Another writer's change to an edited tab conflicts it. The change is still reported, and
       `reloadCleanTab` spares a tab with edits. */
    clean.doc.dirty = true;
    await host.file("a.json", "d1", '{"tagName":"p"}');
    await settle();
    expect(changed).toEqual(["a.json"]);
    expect(tabBufferStatus(clean)).toBe("conflicted");

    // A removal leaves nothing on disk under the tab, and a directory's names no tab.
    host.emit({
      docId: "d1",
      isDir: false,
      origin: "external",
      path: "a.json",
      type: "fileRemoved",
    });
    host.emit({ docId: "d9", isDir: true, origin: "external", path: "dir", type: "fileRemoved" });
    await settle();
    expect(clean.doc.buffer.diskHash).toBeNull();

    // A snapshot: the removed file re-reads nothing, and a changed one is re-read.
    await host.file("b.json", "d2", '{"tagName":"p"}', false);
    host.drop("a.json");
    host.restart();
    await settle();
    expect(changed).toEqual(["a.json", "b.json"]);
    stop();
  });

  test("a snapshot after a restart reloads the files it changed, and no directory", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("pages", "d0", null);
    await host.file("pages/a.json", "d1", "A");
    const changed: string[] = [];
    const stop = startFsSync({
      onContentChange: (path) => changed.push(path),
      renderLeftPanel: () => {},
    });
    await settle();
    await host.file("pages", "d9", null, false);
    await host.file("pages/a.json", "d1", "A2", false);
    host.restart();
    await settle();
    expect(changed).toEqual(["pages/a.json"]);
    stop();
  });

  test("a snapshot from a host that has not hashed a file yet holds no tab against it", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("a.json", "d1", '{"tagName":"div"}');
    const changed: string[] = [];
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({
      onContentChange: (path) => changed.push(path),
      renderLeftPanel: () => {},
    });
    await settle();
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { documentPath: "a.json", id: "a" });
    await noteBufferRead(tab, '{"tagName":"div"}', "a.json");
    // The host restarts below `indexed`: the snapshot lists the file, and names no bytes for it.
    host.unhash("a.json");
    host.restart();
    await settle();
    expect(changed).toEqual([]);
    expect(foreign).toEqual([]);
    expect(tabBufferStatus(tab)).toBe("clean");
    expect(tab.doc.dirty).toBe(false);
    stop();
    stopForeign();
  });

  test("while live, the store's events drop the derived caches and the watcher's do not", async () => {
    const host = fakeHost();
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
      subscribeProjectState: host.subscribe,
    });
    resetStudioState({ dirs: new Map([["img", [entry("img/a.png")]]]), expanded: new Set() });
    await host.file("img/a.png", "d1", "png-1");
    const calls: string[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: (paths, structural) =>
        calls.push(`derived ${(paths ?? []).join(",")} ${structural}`),
      noteRepositoryChange: () => calls.push("git"),
      onComponentsChanged: () => calls.push("components"),
      onDependentsInvalidated: (paths, tags) => calls.push(`dependents ${paths} ${tags}`),
      onDocumentChange: (path) => calls.push(`document ${path}`),
      onFormatsChanged: () => calls.push("formats"),
      onReadiness: (state) => calls.push(`readiness ${state}`),
      renderLeftPanel: () => {},
    });
    await settle();
    expect(projectStateLive()).toBe(true);
    // The content version is the store's hash while the subscription is live.
    expect(versionOf("img/a.png")).toBe(await contentHash("png-1"));

    handler([{ isDir: false, path: "img/b.png", type: "add" }]);
    await sleep(70);
    /* The watcher's batch drops no derived cache, and still re-reads git status: the host's
       `gitChanged` moves only with the summary, which a second edit to a modified file leaves alone. */
    expect(calls).toEqual(["git"]);
    calls.length = 0;

    // The host follows the add with its `docChanged`.
    await host.file("img/b.png", "d2", "png-2");
    host.emit({
      origin: "external",
      status: { branch: "main", changed: {}, head: null },
      type: "gitChanged",
    });
    host.emit({ origin: "external", tags: ["x-card"], type: "componentsChanged" });
    host.emit({ formats: "f2", origin: "external", type: "formatsChanged" });
    host.emit({ origin: "external", state: "indexed", type: "readiness" });
    host.emit({
      cause: { docId: "d2", kind: "component-instance" },
      complete: true,
      docIds: ["d1"],
      origin: "external",
      tags: ["x-card"],
      type: "dependentsInvalidated",
    });
    await settle();
    expect(calls).toEqual([
      "derived img/b.png true",
      "document img/b.png",
      "derived img/b.png false",
      "git",
      "components",
      "formats",
      "readiness indexed",
      "dependents img/a.png x-card",
      "derived img/a.png false",
    ]);
    expect(versionOf("img/b.png")).toBe(await contentHash("png-2"));
    stop();
    // Stopped, the store vouches for nothing.
    expect(versionOf("img/a.png")).toBeUndefined();
  });

  test("without a subscription, a watcher's change re-reads no open tab and no component", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const calls: string[] = [];
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({
      invalidateDerivedCaches: (paths) => calls.push(`derived ${(paths ?? []).join(",")}`),
      onContentChange: (path) => calls.push(`content ${path}`),
      onDocumentChange: (path) => calls.push(`document ${path}`),
      renderLeftPanel: () => {},
    });
    handler([{ isDir: false, path: "components/x-card.json", type: "change" }]);
    await sleep(70);
    // Nothing can tell Studio's own write from another's: the caches of the file set still drop.
    expect(calls).toEqual(["derived components/x-card.json"]);
    expect(foreign).toEqual([]);
    stop();
    stopForeign();
  });

  test("a platform with a subscription and no watcher still subscribes, and stops", async () => {
    const host = fakeHost();
    installMockPlatform({ subscribeProjectState: host.subscribe });
    resetStudioState();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    await settle();
    expect(projectStateLive()).toBe(true);
    stop();
    expect(projectStateLive()).toBe(false);
  });

  test("without a subscription nothing is hashed", async () => {
    installMockPlatform({ subscribeFileEvents: () => () => {} });
    resetStudioState();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    noteLocalWrite("solo.json", "S");
    markLocalWrite("solo2.json", "S");
    await contentStore.settled();
    expect(contentStore.contentsAt("solo.json")).toBeUndefined();
    contentStore.applyEvent({
      docId: "d",
      hash: await contentHash("S"),
      isDir: false,
      origin: "external",
      path: "solo.json",
      rev: 1,
      type: "fileAdded",
    });
    expect(contentStore.contentsAt("solo.json")).toBeUndefined();
    stop();
  });
});

describe("a reconnect is a subscribe with its cursor (project-state.md §3.3)", () => {
  test("the missed events are replayed into the tree and the caches, and nothing is re-listed", async () => {
    const host = fakeHost();
    const handle = installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState({ dirs: new Map([["pages", [entry("pages/a.json")]]]), expanded: new Set() });
    await host.file("pages", "d0", null);
    await host.file("pages/a.json", "d1", "A");
    const calls: string[] = [];
    const renders: number[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: (paths, structural) =>
        calls.push(`derived ${(paths ?? []).join(",")} ${structural}`),
      onContentChange: (path) => calls.push(`content ${path}`),
      renderLeftPanel: () => renders.push(1),
    });
    await settle();
    expect(host.requests).toEqual([expect.objectContaining({})]);
    handle.state.calls.length = 0;
    // While the stream is down another writer adds a page and rewrites the first.
    await host.file("pages/b.json", "d2", "B", false);
    await host.file("pages/a.json", "d1", "A2", false);
    host.end();
    await settle();
    // The second subscribe names where the first left off.
    expect(host.requests).toHaveLength(2);
    expect(host.requests[1]).toEqual(expect.objectContaining({ epoch: "e1", sinceRev: 3 }));
    // No listing pass: the replay alone brings the tree and the open tabs current.
    expect(handle.state.calls.filter(([method]) => method === "listDirectory")).toEqual([]);
    expect(projectState?.dirs.get("pages")?.map((item) => item.path)).toEqual([
      "pages/a.json",
      "pages/b.json",
    ]);
    expect(calls).toContain("content pages/a.json");
    expect(calls).toContain("derived pages/b.json,pages/a.json true");
    expect(renders.length).toBeGreaterThan(0);
    stop();
  });

  test("a snapshot after a restart folds the files it added and removed into the tree", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState({
      dirs: new Map([["pages", [entry("pages/a.json"), entry("pages/old.json")]]]),
      expanded: new Set(),
    });
    await host.file("pages/a.json", "d1", "A");
    await host.file("pages/old.json", "d2", "O");
    const calls: string[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: (paths, structural) =>
        calls.push(`derived ${[...(paths ?? [])].toSorted().join(",")} ${structural}`),
      renderLeftPanel: () => {},
    });
    await settle();
    host.drop("pages/old.json");
    await host.file("pages/new.json", "d3", "N", false);
    host.restart();
    await settle();
    expect(projectState?.dirs.get("pages")?.map((item) => item.path)).toEqual([
      "pages/a.json",
      "pages/new.json",
    ]);
    expect(calls).toEqual(["derived pages/new.json,pages/old.json true"]);
    stop();
  });

  test("a subscription that drops forgets the versions listings vouched for", async () => {
    const host = fakeHost();
    let refuse = false;
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: (request, next) =>
        refuse ? Promise.reject(new Error("down")) : host.subscribe(request, next),
    });
    resetStudioState();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    await settle();
    expect(projectStateLive()).toBe(true);
    // A file the host does not index (outside its scope) keeps a listing's version while live.
    noteListing([{ ...entry("dist/hero.png"), version: "v1" }], beginListing());
    expect(versionOf("dist/hero.png")).toBe("v1");
    refuse = true;
    host.end();
    await settle();
    expect(projectStateLive()).toBe(false);
    expect(versionOf("dist/hero.png")).toBeUndefined();
    stop();
  });

  test("another writer's change reaches the foreign listeners, and Studio's own never does", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("data/rows.csv", "d1", "a");
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({ renderLeftPanel: () => {} });
    await settle();
    markLocalWrite("data/rows.csv", "b");
    await host.file("data/rows.csv", "d1", "b");
    await settle();
    expect(foreign).toEqual([]);
    await host.file("data/rows.csv", "d1", "c");
    host.emit({
      docId: "d1",
      isDir: false,
      origin: "external",
      path: "data/rows.csv",
      type: "fileRemoved",
    });
    await settle();
    expect(foreign).toEqual(["data/rows.csv", "data/rows.csv"]);
    // A snapshot that replaced earlier state reports what it changed as another writer's.
    await host.file("data/new.csv", "d2", "n", false);
    await host.file("data/new.csv", "d2", "n2", false);
    host.restart();
    await settle();
    expect(foreign.length).toBeGreaterThanOrEqual(2);
    stop();
    stopForeign();
  });
});

describe("only a change of bytes is another writer's change (project-state.md §4.3)", () => {
  test("a docChanged that fills in the same bytes reaches no foreign listener", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("content/a.csv", "d1", "a,b");
    const foreign: string[] = [];
    const documents: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({
      onDocumentChange: (path) => documents.push(path),
      renderLeftPanel: () => {},
    });
    await settle();
    host.refill("content/a.csv");
    await settle();
    expect(foreign).toEqual([]);
    expect(documents).toEqual([]);
    // Studio's own write, then a refill of those same bytes: still nobody else's.
    markLocalWrite("content/a.csv", "c,d");
    await host.file("content/a.csv", "d1", "c,d");
    host.refill("content/a.csv");
    await settle();
    expect(foreign).toEqual([]);
    // Another writer's bytes are news, once.
    await host.file("content/a.csv", "d1", "e,f");
    host.refill("content/a.csv");
    await settle();
    expect(foreign).toEqual(["content/a.csv"]);
    expect(documents).toEqual(["content/a.csv"]);
    stop();
    stopForeign();
  });

  test("what is known of a path follows a rename and leaves with its directory", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("data", "d0", null);
    await host.file("data/a.csv", "d1", "a");
    await host.file("data/sub/b.csv", "d2", "b");
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({ renderLeftPanel: () => {} });
    await settle();
    host.emit({
      docId: "d0",
      from: "data",
      isDir: true,
      origin: "external",
      to: "rows",
      type: "fileRenamed",
    });
    host.emit({
      docId: "d1",
      hash: await contentHash("a"),
      indexed: true,
      kind: "page",
      origin: "external",
      path: "rows/a.csv",
      type: "docChanged",
    });
    await settle();
    // The same bytes under the new name: nobody changed them.
    expect(foreign).toEqual([]);
    host.emit({ docId: "d0", isDir: true, origin: "external", path: "rows", type: "fileRemoved" });
    await settle();
    /* Named again after its directory went: nothing is known of it, and no file event of another
       writer says it moved. */
    host.emit({
      docId: "d3",
      hash: await contentHash("c"),
      indexed: true,
      kind: "page",
      origin: "external",
      path: "rows/sub/b.csv",
      type: "docChanged",
    });
    await settle();
    expect(foreign).toEqual([]);
    stop();
    stopForeign();
  });

  test("a new epoch's snapshot with the same bytes under new ids reports no change", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("pages", "d0", null);
    await host.file("pages/a.json", "d1", '{"tagName":"div"}');
    await host.file("content/a.csv", "d2", "a,b");
    const calls: string[] = [];
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({
      invalidateDerivedCaches: (paths) => calls.push(`derived ${(paths ?? []).join(",")}`),
      onContentChange: (path) => calls.push(`content ${path}`),
      onDocumentChange: (path) => calls.push(`document ${path}`),
      renderLeftPanel: () => {},
    });
    await settle();
    const tab = resetWorkspaceWithTab(
      { tagName: "div" },
      { documentPath: "pages/a.json", id: "a" },
    );
    await noteBufferRead(tab, '{"tagName":"div"}', "pages/a.json");
    host.remint();
    await settle();
    expect(contentStore.docAt("pages/a.json")?.docId).toBe("d1-e2");
    // The host indexes again after its restart: every file's bytes are named a second time.
    host.refill("pages/a.json");
    host.refill("content/a.csv");
    await settle();
    // No definition is re-read and the open tab, which holds those bytes, reloads nothing.
    expect(calls.filter((call) => call.startsWith("document"))).toEqual([]);
    expect(calls).not.toContain("content pages/a.json");
    expect(foreign).toEqual([]);
    expect(tabBufferStatus(tab)).toBe("clean");
    stop();
    stopForeign();
  });

  test("a snapshot that names a file without its hash keeps the bytes known before", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("content/a.csv", "d1", "a,b");
    const foreign: string[] = [];
    const stopForeign = onForeignDocumentChange((path) => foreign.push(path));
    const stop = startFsSync({ renderLeftPanel: () => {} });
    await settle();
    host.unhash("content/a.csv");
    host.restart();
    await settle();
    // The host names the bytes it found: the same ones, so nothing is reported.
    await host.file("content/a.csv", "d1", "a,b", false);
    host.refill("content/a.csv");
    await settle();
    expect(foreign).toEqual([]);
    stop();
    stopForeign();
  });
});

describe("git status follows what the watcher's batches would have said", () => {
  test("an empty batch reads git status again and drops nothing", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const calls: string[] = [];
    const renders: number[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: () => calls.push("derived"),
      noteRepositoryChange: () => calls.push("git"),
      renderLeftPanel: () => renders.push(1),
    });
    handler([]);
    await sleep(70);
    expect(calls).toEqual(["git"]);
    expect(renders).toEqual([]);
    stop();
  });

  test("an answer after a loss that replays or replaces anything reads git status again", async () => {
    const host = fakeHost();
    installMockPlatform({
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
    });
    resetStudioState();
    await host.file("pages/a.json", "d1", "A");
    const calls: string[] = [];
    const stop = startFsSync({
      noteRepositoryChange: () => calls.push("git"),
      renderLeftPanel: () => {},
    });
    await settle();
    expect(calls).toEqual([]);
    // A replay after a dropped stream.
    await host.file("pages/a.json", "d1", "A2", false);
    host.end();
    await settle();
    expect(calls).toEqual(["git"]);
    // A snapshot after a restart that changed a file.
    await host.file("pages/a.json", "d1", "A3", false);
    host.restart();
    await settle();
    expect(calls).toEqual(["git", "git"]);
    // A reconnect that missed nothing reads nothing.
    host.end();
    await settle();
    expect(calls).toEqual(["git", "git"]);
    stop();
  });
});

describe("the watcher's batches while the subscription is not live", () => {
  test("a subscription down after answering once leaves the watcher to drop the caches", async () => {
    const host = fakeHost();
    let refuse = false;
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
      subscribeProjectState: (request, next) =>
        refuse ? Promise.reject(new Error("down")) : host.subscribe(request, next),
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const calls: string[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: (paths, structural) =>
        calls.push(`derived ${(paths ?? []).join(",")} ${structural}`),
      renderLeftPanel: () => {},
    });
    await settle();
    expect(projectStateLive()).toBe(true);
    refuse = true;
    host.end();
    await settle();
    expect(projectStateLive()).toBe(false);
    noteListing([{ ...entry("dist/hero.png"), version: "v1" }], beginListing());
    expect(versionOf("dist/hero.png")).toBe("v1");
    handler([{ isDir: false, path: "dist/hero.png", type: "change" }]);
    await sleep(70);
    expect(calls).toEqual(["derived dist/hero.png false"]);
    // The change forgets the version a listing vouched for during the outage.
    expect(versionOf("dist/hero.png")).toBeUndefined();
    stop();
  });
});
