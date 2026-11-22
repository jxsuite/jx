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
  isRecentLocal,
  markLocalMutation,
  markLocalWrite,
  noteLocalWrite,
  startFsSync,
} from "../src/files/fs-events";
import { versionOf } from "../src/files/asset-versions";
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
  return {
    subscribe: async (
      request: SubscribeRequest,
      next: ProjectStateListener,
    ): Promise<SubscribeResponse> => {
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
    /** Forget a file without an event, for a snapshot to report. */
    drop(path: string) {
      files.delete(path);
    },
    restart() {
      log = createMemoryEventLog({ epoch: "e2" });
      listener?.ended?.("e1");
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
    expect(isRecentLocal("live/a.json")).toBe(false);
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

  test("without a subscription, a watcher's change reaches the open tab and the component lane", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (next) => {
        handler = next;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const calls: string[] = [];
    const stop = startFsSync({
      onContentChange: (path) => calls.push(`content ${path}`),
      onDocumentChange: (path) => calls.push(`document ${path}`),
      renderLeftPanel: () => {},
    });
    handler([{ isDir: false, path: "components/x-card.json", type: "change" }]);
    await sleep(70);
    expect(calls).toEqual(["content components/x-card.json", "document components/x-card.json"]);
    stop();
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

  test("without a subscription a write is marked by the window and nothing is hashed", async () => {
    installMockPlatform({ subscribeFileEvents: () => () => {} });
    resetStudioState();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    noteLocalWrite("solo.json", "S");
    markLocalWrite("solo2.json", "S");
    await contentStore.settled();
    expect(isRecentLocal("solo2.json")).toBe(true);
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
