/**
 * An edited tab whose file another program changes (`project-state.md` §6.1): the tab stays dirty
 * and becomes conflicted, Save stays enabled, and saving asks the author before anything is
 * written. Driven through the real file sync (`startFsSync` with `reloadCleanTab`, as the bootstrap
 * wires it) and the real save (`saveFile`), for an edit made in the canvas or inspector of a tab of
 * its own, and for the co-edited tab the dev server opens, edited in the Code view or the canvas.
 * Before the fix the dev server reseeded a co-edited room under its unsaved edits: the tab
 * re-joined a room that reported itself clean, its dirty dot went out with the edits still on the
 * canvas, and nothing could save them.
 */

import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetStudioState,
  topDialog,
} from "./harness";
import { childNode, createMockCollabHub, waitForCollab } from "./collab-mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type {
  ContentHash,
  IndexedFile,
  SubscribeRequest,
  SubscribeResponse,
  WriteRequest,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import { acquireSourceCanonical, sourceText } from "@jxsuite/collab";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import { initLayers } from "../src/ui/layers";
import { plainWriteRoute } from "../src/files/based-writes";
import { routePlainWrites } from "../src/platform";
import { shell } from "../src/shell";
import { DISK_COMPARISON_STATUS } from "../src/panels/git-diff-open";
import { saveFile } from "../src/files/file-ops";
import { reloadCleanTab, reloadFileInTab } from "../src/files/files";
import { startFsSync } from "../src/files/fs-events";
import { noteBufferRead, tabBufferStatus } from "../src/project-state/buffer";
import { contentStore } from "../src/project-state/store";
import { stopProjectStateSync } from "../src/project-state/subscription";
import {
  collabSourceContext,
  configureCollabParser,
  configureCollabReloader,
  configureCollabSerializer,
  resetCollabForTests,
  roomSource,
} from "../src/collab/collab-session";
import { collabState } from "../src/collab/collab-state";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { mutateUpdateProperty, transactDoc } from "../src/tabs/transact";
import type { Tab } from "../src/tabs/tab";

const INDEX = "pages/index.json";
const MINE = '{"tagName":"div","children":[{"tagName":"p","textContent":"Mine"}]}';
const ORIGINAL = '{"tagName":"div","children":[{"tagName":"p","textContent":"Original"}]}';
const THEIRS = '{"tagName":"div","children":[{"tagName":"p","textContent":"Theirs"}]}';

const sleep = (ms: number) =>
  new Promise((resume) => {
    setTimeout(resume, ms);
  });

/** Every turn the subscription and the sync take to apply what they were sent. */
async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await sleep(0);
  }
}

/** A host on the protocol's reference log, recording every write a save makes through it. */
function fakeHost() {
  const log = createMemoryEventLog({ epoch: "e1" });
  const files = new Map<string, IndexedFile>();
  const writes: WriteRequest[] = [];
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
    /** Another program writes `text`: the file event and its `docChanged`, as a host reports them. */
    async change(path: string, text: string, deliver = true) {
      const hash = await contentHash(text);
      const existed = files.has(path);
      files.set(path, { docId: "d1", hash, indexed: true, isDir: false, kind: "page", path });
      const events = [
        log.append(
          existed
            ? { docId: "d1", hash, origin: "external", path, type: "fileChanged" }
            : { docId: "d1", hash, isDir: false, origin: "external", path, type: "fileAdded" },
        ),
        log.append({
          docId: "d1",
          hash,
          indexed: true,
          kind: "page",
          origin: "external",
          path,
          type: "docChanged",
        }),
      ];
      if (deliver) {
        listener?.events({ epoch: log.epoch, events });
      }
    },
    write: async (request: WriteRequest): Promise<WriteResult> => {
      writes.push(request);
      const onDisk = files.get(request.path)?.hash ?? null;
      if (onDisk !== request.baseHash) {
        return { conflict: { diskHash: onDisk, docId: "d1", path: request.path }, ok: false };
      }
      return { hash: await contentHash(request.contents), ok: true, rev: 99 };
    },
    writes,
  };
}

/** Answer the conflict question with one of its three buttons. */
async function answer(button: "confirm" | "secondary" | "cancel") {
  await flush();
  const dialog = topDialog();
  expect(dialog?.getAttribute("headline")).toBe("index.json Changed on Disk");
  dialog!.dispatchEvent(new Event(button));
}

/** Whether the conflict question is up. */
function asking(): boolean {
  return topDialog()?.getAttribute("headline") === "index.json Changed on Disk";
}

/** The text of the `p` the fixtures hold, read off a tab's document. */
function paragraph(tab: Tab): string | undefined {
  const text = childNode(tab.doc.document, 0).textContent;
  return isString(text) ? text : undefined;
}

/**
 * A project whose host serves the contract, with `index.json` on disk and open in a tab read from
 * it, as `openFileInTab` opens one. `collab` gives the platform the dev server's co-editing.
 */
async function project(collab?: ReturnType<typeof createMockCollabHub>) {
  const host = fakeHost();
  const installed = installMockPlatform(
    {
      ...(collab && { collab: collab.capability }),
      subscribeFileEvents: () => () => {},
      subscribeProjectState: host.subscribe,
      writeProjectState: host.write,
    },
    { [INDEX]: ORIGINAL },
  );
  await host.change(INDEX, ORIGINAL, false);
  const stop = startFsSync({ onContentChange: reloadCleanTab, renderLeftPanel: () => {} });
  stops.push(stop);
  await settle();
  const tab = openTab({ document: JSON.parse(ORIGINAL), documentPath: INDEX, id: INDEX });
  await noteBufferRead(tab, ORIGINAL, INDEX);
  if (collab) {
    await waitForCollab(() => collabState(tab).active);
    expect(collabState(tab).active).toBe(true);
  }
  /** Another program rewrites the file on disk. */
  const external = async (text: string) => {
    installed.state.files.set(INDEX, text);
    await host.change(INDEX, text);
    await settle();
  };
  return { external, host, tab };
}

const stops: (() => void)[] = [];

beforeAll(() => {
  mountOverlayLayers(document.body);
  initLayers();
  routePlainWrites(plainWriteRoute);
});

afterAll(() => {
  routePlainWrites(null);
});

beforeEach(() => {
  resetStudioState();
  shell.git.diffState = null;
  /* As the bootstrap configures them: the room's text is the serialized document, and a reset
     room's tab re-reads its file. */
  configureCollabSerializer((tab) => Promise.resolve(JSON.stringify(tab.doc.document)));
  configureCollabParser((_tab, text) => {
    const parsed: unknown = JSON.parse(text);
    if (!isNodeObject(parsed)) {
      throw new TypeError("not a document node");
    }
    return Promise.resolve({ document: parsed });
  });
  configureCollabReloader((path) => reloadFileInTab(path, { onlyIfChanged: true }));
});

afterEach(() => {
  for (const stop of stops.splice(0)) {
    stop();
  }
  closeAllTabs();
  resetCollabForTests();
  stopProjectStateSync();
  contentStore.reset();
});

describe("an edit in the canvas or inspector, then another program's change", () => {
  test("stays dirty and conflicted, and Save asks before it writes", async () => {
    const { external, host, tab } = await project();
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Mine"));
    expect(tab.doc.dirty).toBe(true);

    await external(THEIRS);
    // The edit is still there, still unsaved, and Save (enabled by `dirty`) still offered.
    expect(paragraph(tab)).toBe("Mine");
    expect(tab.doc.dirty).toBe(true);
    expect(tabBufferStatus(tab)).toBe("conflicted");

    const saving = saveFile(tab);
    await flush();
    expect(asking()).toBe(true);
    expect(host.writes).toHaveLength(0);
    await answer("confirm");
    expect(await saving).toBe(true);
    // Keep Mine names the bytes the author was told about.
    expect(host.writes.map((write) => write.baseHash)).toEqual([await contentHash(THEIRS)]);
    expect(tab.doc.dirty).toBe(false);
    expect(tabBufferStatus(tab)).toBe("clean");
  });
});

describe("a co-edited tab, then another program's change (the dev server)", () => {
  test("an edit held in the Code view stays dirty, and Save asks before the room writes", async () => {
    const hub = createMockCollabHub();
    const { external, host, tab } = await project(hub);
    // The Code view takes the room's source lock and the author types into the shared text.
    const room = hub.serverDoc(INDEX);
    acquireSourceCanonical(room, ORIGINAL, "code-view");
    sourceText(room).delete(0, sourceText(room).length);
    sourceText(room).insert(0, MINE);
    hub.setDirty(INDEX, true);
    await waitForCollab(() => collabState(tab).sourceCanonical);
    expect(collabState(tab).sourceCanonical).toBe(true);
    expect(tab.doc.dirty).toBe(true);

    /* Another program rewrites the file. The dev server keeps the room's edits and tells every
       participant (`doc-conflict`) instead of reseeding the room under them. */
    await external(THEIRS);
    const theirs: ContentHash = await contentHash(THEIRS);
    hub.conflict(INDEX, { diskHash: theirs, docId: "d1" });
    expect(tab.doc.dirty).toBe(true);
    expect(tabBufferStatus(tab)).toBe("conflicted");
    expect(collabState(tab).active).toBe(true);

    // Saving asks first: the room is not flushed, and nothing reaches the disk around it.
    hub.onFlush = (path, options) => {
      if (options?.baseHash === theirs) {
        hub.setDirty(path, false);
      }
    };
    const saving = saveFile(tab);
    await flush();
    expect(asking()).toBe(true);
    expect(hub.flushes).toEqual([]);
    expect(host.writes).toHaveLength(0);
    await answer("confirm");
    expect(await saving).toBe(true);
    expect(hub.flushOptions).toEqual([{ baseHash: theirs }]);
    expect(host.writes).toHaveLength(0);
    expect(tab.doc.dirty).toBe(false);
    expect(tabBufferStatus(tab)).toBe("clean");
  });

  test("a canvas edit's refused save asks, and Take Disk Copy reverts the room and re-reads", async () => {
    const hub = createMockCollabHub();
    const { external, tab } = await project(hub);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Mine"));
    hub.setDirty(INDEX, true);
    expect(tab.doc.dirty).toBe(true);

    // Here the change reaches the room only when it saves: the host refuses the stale base.
    await external(THEIRS);
    const theirs = await contentHash(THEIRS);
    expect(tab.doc.dirty).toBe(true);
    expect(paragraph(tab)).toBe("Mine");
    hub.onFlush = (path) => {
      hub.conflict(path, { diskHash: theirs, docId: "d1" });
    };
    const saving = saveFile(tab);
    await answer("secondary");
    expect(await saving).toBe(false);
    expect(hub.flushes).toEqual([INDEX]);
    expect(hub.reverts).toEqual([INDEX]);
    // The tab re-read the file before it joined the fresh room, so the room seeds from the disk's.
    await waitForCollab(() => collabState(tab).active);
    expect(paragraph(tab)).toBe("Theirs");
    expect(tab.doc.dirty).toBe(false);
    expect(tabBufferStatus(tab)).toBe("clean");
  });

  test("Compare writes nothing and shows the room's bytes beside the disk's", async () => {
    const hub = createMockCollabHub();
    const { external, tab } = await project(hub);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Mine"));
    hub.setDirty(INDEX, true);
    await external(THEIRS);
    hub.conflict(INDEX, { diskHash: await contentHash(THEIRS), docId: "d1" });
    const saving = saveFile(tab);
    await answer("cancel");
    expect(await saving).toBe(false);
    expect(hub.flushes).toEqual([]);
    expect(shell.git.diffState).toEqual({
      currentContent: JSON.stringify(tab.doc.document),
      filePath: INDEX,
      fileStatus: DISK_COMPARISON_STATUS,
      originalContent: THEIRS,
    });
    expect(tab.doc.dirty).toBe(true);
    expect(tabBufferStatus(tab)).toBe("conflicted");
  });

  test("Keep Mine refused again asks again", async () => {
    const hub = createMockCollabHub();
    const { tab } = await project(hub);
    const first = await contentHash("first");
    const second = await contentHash("second");
    hub.setDirty(INDEX, true);
    hub.conflict(INDEX, { diskHash: first, docId: "d1" });
    let refusals = 0;
    hub.onFlush = (path, options) => {
      if (refusals === 0) {
        refusals += 1;
        hub.conflict(path, { diskHash: second, docId: "d1" });
      } else if (options?.baseHash === second) {
        hub.setDirty(path, false);
      }
    };
    const saving = saveFile(tab);
    await answer("confirm");
    await answer("confirm");
    expect(await saving).toBe(true);
    expect(hub.flushOptions).toEqual([{ baseHash: first }, { baseHash: second }]);
    expect(tabBufferStatus(tab)).toBe("clean");
  });

  /**
   * THE FILE'S OWN BYTES, NEVER A RE-SERIALIZATION. The server seeds a room from the file, and a
   * Code view that seeded the room again from its serialization of the same document normalized it:
   * after Take Disk Copy, and on a plain first open in Code view, the tab went dirty with no edit
   * and its save rewrote the file in the serializer's layout.
   */
  test("after Take Disk Copy the room holds the disk bytes, and the Code view leaves the tab clean", async () => {
    // A layout the serializer would not write: every byte of it must survive.
    const DISK =
      '{\n    "tagName": "div",\n    "children": [ { "tagName": "p", "textContent": "Theirs" } ]\n}\n';
    const files = new Map<string, string>();
    const hub = createMockCollabHub({ source: (path) => files.get(path) ?? null });
    const { external, tab } = await project(hub);
    transactDoc(tab, (t) => mutateUpdateProperty(t, ["children", 0], "textContent", "Mine"));
    hub.setDirty(INDEX, true);
    await external(DISK);
    files.set(INDEX, DISK);
    hub.conflict(INDEX, { diskHash: await contentHash(DISK), docId: "d1" });
    const saving = saveFile(tab);
    await answer("secondary");
    expect(await saving).toBe(false);
    await waitForCollab(() => collabState(tab).active);
    expect(paragraph(tab)).toBe("Theirs");
    expect(sourceText(hub.serverDoc(INDEX)).toString()).toBe(DISK);

    // The Code view mounts on the fresh room: the text stays the file's, byte for byte.
    await collabSourceContext(tab)!.enter();
    await waitForCollab(() => collabState(tab).sourceCanonical);
    expect(collabState(tab).sourceCanonical).toBe(true);
    expect(sourceText(hub.serverDoc(INDEX)).toString()).toBe(DISK);
    // What a save would write is the same bytes, so nothing is rewritten.
    expect(await roomSource(tab)).toBe(DISK);
    expect(tab.doc.dirty).toBe(false);
  });

  test("a first open in the Code view keeps the file's bytes and leaves the tab clean", async () => {
    const DISK =
      '{ "tagName": "div", "children": [ { "tagName": "p", "textContent": "Original" } ] }\n';
    const hub = createMockCollabHub({ source: () => DISK });
    const { tab } = await project(hub);
    // The structure the client seeded parses out of the file: the shared text already says it.
    expect(await roomSource(tab)).toBe(DISK);
    await collabSourceContext(tab)!.enter();
    await waitForCollab(() => collabState(tab).sourceCanonical);
    expect(sourceText(hub.serverDoc(INDEX)).toString()).toBe(DISK);
    expect(tab.doc.dirty).toBe(false);
  });
});
