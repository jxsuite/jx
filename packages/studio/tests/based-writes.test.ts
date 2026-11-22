import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type {
  ContentHash,
  DeleteRequest,
  DeleteResult,
  IndexedFile,
  SubscribeRequest,
  WriteRequest,
  WriteResult,
} from "@jxsuite/protocol/project-state";

const { initLayers } = await import("../src/ui/layers");
const { deletePath, plainWriteRoute, saveWithBase, StaleWriteError, writesWithBase } =
  await import("../src/files/based-writes");
const { getPlatform, routePlainWrites } = await import("../src/platform");
const { shell } = await import("../src/shell");
const { DISK_COMPARISON_STATUS } = await import("../src/panels/git-diff-open");
const { saveFile } = await import("../src/files/file-ops");
const { noteBufferRead, noteDiskHash, tabBufferStatus } =
  await import("../src/project-state/buffer");
const { contentStore } = await import("../src/project-state/store");
const { startProjectStateSync, stopProjectStateSync } =
  await import("../src/project-state/subscription");
const { workspace } = await import("../src/workspace/workspace");

type Tab = ReturnType<typeof resetWorkspaceWithTab>;

/** The error `run` rejects with, or `null` when it resolves. */
async function rejection(run: () => Promise<void>): Promise<Error | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const sleep = (ms: number) =>
  new Promise((resume) => {
    setTimeout(resume, ms);
  });

/** A host that answers a subscribe with these files, and records every write and delete. */
function host(files: IndexedFile[]) {
  const log = createMemoryEventLog({ epoch: "e1" });
  const writes: WriteRequest[] = [];
  const deletes: DeleteRequest[] = [];
  const writeAnswers: WriteResult[] = [];
  const deleteAnswers: DeleteResult[] = [];
  return {
    deleteAnswers,
    deletes,
    subscribe: async (request: SubscribeRequest) =>
      answerSubscribe(log, request, () => ({
        components: [],
        files,
        formats: "f",
        readiness: "ready",
      })),
    writeAnswers,
    writes,
    write: async (request: WriteRequest): Promise<WriteResult> => {
      writes.push(request);
      return (
        writeAnswers.shift() ?? { hash: await contentHash(request.contents), ok: true, rev: 9 }
      );
    },
    delete: async (request: DeleteRequest): Promise<DeleteResult> => {
      deletes.push(request);
      return deleteAnswers.shift() ?? { ok: true, rev: 10 };
    },
  };
}

const file = (path: string, docId: string, hash?: ContentHash): IndexedFile => ({
  docId,
  indexed: true,
  isDir: hash === undefined && !path.includes("."),
  kind: "page",
  path,
  ...(hash !== undefined && { hash }),
});

/** Install a platform whose host serves the contract, and wait for its answer. */
async function serve(files: IndexedFile[], seed: Record<string, string> = {}) {
  const fake = host(files);
  const installed = installMockPlatform(
    {
      deleteProjectState: fake.delete,
      subscribeProjectState: fake.subscribe,
      writeProjectState: fake.write,
    },
    seed,
  );
  startProjectStateSync(installed.platform);
  for (let i = 0; i < 5; i += 1) {
    await sleep(0);
  }
  return { ...fake, ...installed };
}

/** An open tab at `path`, read from `text`, with an edit. */
async function editedTab(path: string, text: string): Promise<Tab> {
  const tab = resetWorkspaceWithTab(JSON.parse(text), { documentPath: path, id: path });
  await noteBufferRead(tab, text, path);
  tab.doc.dirty = true;
  return tab;
}

/** Answer the conflict question with one of its three buttons. */
async function answer(button: "confirm" | "secondary" | "cancel") {
  await flush();
  const dialog = topDialog();
  expect(dialog?.getAttribute("headline")).toBe("a.json Changed on Disk");
  dialog!.dispatchEvent(new Event(button));
}

beforeAll(() => {
  mountOverlayLayers(document.body);
  initLayers();
  // As the bootstrap installs it: every write through `getPlatform()` takes the route.
  routePlainWrites(plainWriteRoute);
});

afterAll(() => {
  routePlainWrites(null);
});

beforeEach(() => {
  resetStudioState();
  shell.git.diffState = null;
});

afterEach(() => {
  stopProjectStateSync();
  contentStore.reset();
});

describe("saves against the tab's base (project-state.md §5, §6.1)", () => {
  test("only once the host has answered a subscribe, and only with the member", async () => {
    const plain = installMockPlatform();
    expect(writesWithBase(plain.platform)).toBe(false);
    const served = await serve([]);
    expect(writesWithBase(served.platform)).toBe(true);
    expect(writesWithBase({})).toBe(false);
  });

  test("a save names the hash it read and becomes the new base", async () => {
    const served = await serve([]);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    const read = await contentHash('{"tagName":"div"}');
    expect(await saveWithBase(tab, "a.json", '{"tagName":"p"}')).toBe(true);
    expect(served.writes).toHaveLength(1);
    expect(served.writes[0]).toMatchObject({
      baseHash: read,
      bufferRev: 1,
      contents: '{"tagName":"p"}',
      path: "a.json",
    });
    expect(served.writes[0]!.writeId).toStartWith("studio-");
    expect(tab.doc.dirty).toBe(false);
    expect(tab.doc.buffer.baseHash).toBe(await contentHash('{"tagName":"p"}'));
  });

  test("a refusal asks first, and Keep Mine writes again against what is on disk", async () => {
    const served = await serve([]);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    served.writeAnswers.push({
      conflict: { diskHash: "sha256-theirs", docId: "d1", path: "a.json" },
      ok: false,
    });
    const saving = saveWithBase(tab, "a.json", '{"tagName":"p"}');
    await answer("confirm");
    expect(await saving).toBe(true);
    expect(served.writes.map((write) => write.baseHash)).toEqual([
      await contentHash('{"tagName":"div"}'),
      "sha256-theirs",
    ]);
    expect(tabBufferStatus(tab)).toBe("clean");
  });

  test("Take Disk Copy discards the buffer and reads the file", async () => {
    const served = await serve([], { "a.json": '{"tagName":"section"}' });
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    served.writeAnswers.push({
      conflict: { diskHash: "sha256-theirs", docId: "d1", path: "a.json" },
      ok: false,
    });
    const saving = saveWithBase(tab, "a.json", '{"tagName":"p"}');
    await answer("secondary");
    expect(await saving).toBe(false);
    expect(served.writes).toHaveLength(1);
    const open = workspace.tabs.get("a.json")!;
    expect(open.doc.document.tagName).toBe("section");
    expect(open.doc.dirty).toBe(false);
    await sleep(0);
    expect(open.doc.buffer.baseHash).toBe(await contentHash('{"tagName":"section"}'));
  });

  test("Compare writes nothing and compares the copy on disk with the unsaved version", async () => {
    const served = await serve([], { "a.json": '{"tagName":"section"}' });
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    served.writeAnswers.push({
      conflict: { diskHash: "sha256-theirs", docId: "d1", path: "a.json" },
      ok: false,
    });
    const saving = saveWithBase(tab, "a.json", '{"tagName":"p"}');
    await answer("cancel");
    expect(await saving).toBe(false);
    expect(served.writes).toHaveLength(1);
    expect(shell.git.diffState).toEqual({
      currentContent: '{"tagName":"p"}',
      filePath: "a.json",
      fileStatus: DISK_COMPARISON_STATUS,
      originalContent: '{"tagName":"section"}',
    });
    expect(tab.session.ui.canvasMode).toBe("git-diff");
    // The buffer is untouched: saving again asks the same question.
    expect(tabBufferStatus(tab)).toBe("conflicted");
    expect(tab.doc.dirty).toBe(true);
  });

  test("Compare with a file gone from disk compares with nothing", async () => {
    const served = await serve([]);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    served.writeAnswers.push({
      conflict: { diskHash: null, docId: null, path: "a.json" },
      ok: false,
    });
    const saving = saveWithBase(tab, "a.json", '{"tagName":"p"}');
    await answer("cancel");
    expect(await saving).toBe(false);
    expect(shell.git.diffState?.originalContent).toBe("");
  });

  test("a tab another writer already conflicted asks before anything is written", async () => {
    const served = await serve([]);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    noteDiskHash([tab], "a.json", "sha256-theirs", { rev: 3 });
    const saving = saveWithBase(tab, "a.json", '{"tagName":"p"}');
    await flush();
    expect(served.writes).toHaveLength(0);
    await answer("confirm");
    expect(await saving).toBe(true);
    expect(served.writes[0]!.baseHash).toBe("sha256-theirs");
  });

  test("saveFile writes through the contract when the host serves it, and reports a refusal", async () => {
    const served = await serve([]);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    expect(await saveFile(tab)).toBe(true);
    expect(served.writes).toHaveLength(1);
    expect(served.state.calls.some(([name]) => name === "writeFile")).toBe(false);

    tab.doc.dirty = true;
    served.writeAnswers.push({
      conflict: { diskHash: "sha256-theirs", docId: "d1", path: "a.json" },
      ok: false,
    });
    const saving = saveFile(tab);
    await answer("cancel");
    expect(await saving).toBe(false);
    expect(tab.doc.dirty).toBe(true);
  });

  test("a host that refuses the subscription takes plain saves, whose bytes become the base", async () => {
    const plain = installMockPlatform({
      subscribeProjectState: () => Promise.reject(new Error("404")),
      writeProjectState: () => Promise.reject(new Error("not served")),
    });
    startProjectStateSync(plain.platform);
    await sleep(0);
    const tab = await editedTab("a.json", '{"tagName":"div"}');
    expect(await saveFile(tab)).toBe(true);
    expect(plain.state.calls.some(([name]) => name === "writeFile")).toBe(true);
    await sleep(0);
    expect(tab.doc.buffer.baseHash).toBe(await contentHash(plain.state.files.get("a.json")!));
  });

  test("a platform with no project state client saves plainly and hashes nothing", async () => {
    const plain = installMockPlatform();
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { documentPath: "a.json", id: "a.json" });
    tab.doc.dirty = true;
    expect(await saveFile(tab)).toBe(true);
    expect(plain.state.calls.some(([name]) => name === "writeFile")).toBe(true);
    await sleep(0);
    expect(tab.doc.buffer.baseHash).toBeNull();
  });
});

describe("deletes name what they remove (project-state.md §5)", () => {
  test("without the contract, a plain delete", async () => {
    const plain = installMockPlatform({}, { "a.json": "{}" });
    await deletePath("a.json");
    expect(plain.state.files.has("a.json")).toBe(false);
  });

  test("a file's base is its hash, a directory's every file beneath it", async () => {
    const served = await serve([
      file("a.json", "d1", "sha256-a"),
      file("pages", "d2"),
      file("pages/one.json", "d3", "sha256-one"),
      file("pages/sub", "d4"),
      file("pages/sub/two.json", "d5", "sha256-two"),
      file("other/three.json", "d6", "sha256-three"),
    ]);
    await deletePath("a.json");
    await deletePath("pages");
    expect(served.deletes.map((remove) => [remove.path, remove.base])).toEqual([
      ["a.json", { hash: "sha256-a" }],
      ["pages", { files: { "one.json": "sha256-one", "sub/two.json": "sha256-two" } }],
    ]);
    expect(served.deletes[0]!.writeId).toStartWith("studio-");
  });

  test("a path the host has not hashed is deleted as a plain delete would, still with a base", async () => {
    const served = await serve([
      file("a.json", "d1"),
      file("pages", "d2"),
      file("pages/one.json", "d3"),
    ]);
    // `file` reads a dotted path with no hash as a file the host has not hashed yet.
    served.deleteAnswers.push({
      conflict: { diskHash: "sha256-a", docId: "d1", path: "a.json" },
      ok: false,
    });
    await deletePath("a.json");
    // A directory the host knows: only with nothing beneath it, as `deleteFile` removes one.
    served.deleteAnswers.push({
      conflict: { diskHash: null, docId: "d2", path: "pages" },
      ok: false,
    });
    expect(await rejection(() => deletePath("pages"))).toBeInstanceOf(StaleWriteError);
    // Nothing there at all: a no-op, as a plain delete of a missing path is.
    served.deleteAnswers.push({
      conflict: { diskHash: null, docId: null, path: "missing.json" },
      ok: false,
    });
    await deletePath("missing.json");
    expect(served.deletes.map((remove) => [remove.path, remove.base])).toEqual([
      ["a.json", { files: {} }],
      ["a.json", { hash: "sha256-a" }],
      ["pages", { files: {} }],
      ["missing.json", { files: {} }],
    ]);
    expect(served.state.calls.some(([name]) => name === "deleteFile")).toBe(false);
  });

  test("a delete refused because the file changed rejects; one already gone resolves", async () => {
    const served = await serve([file("a.json", "d1", "sha256-a")]);
    served.deleteAnswers.push({
      conflict: { diskHash: "sha256-b", docId: "d1", path: "a.json" },
      ok: false,
    });
    let refused = "";
    try {
      await deletePath("a.json");
    } catch (error) {
      refused = error instanceof Error ? error.message : "";
    }
    expect(refused).toStartWith(
      "a.json changed on disk after Studio last read it, so it was not deleted.",
    );
    served.deleteAnswers.push({
      conflict: { diskHash: null, docId: null, path: "a.json" },
      ok: false,
    });
    await deletePath("a.json");
    expect(served.deletes).toHaveLength(2);
  });
});

describe("every other write names a base while the host serves the contract (project-state.md §5)", () => {
  test("a platform without the contract's members is handed each call at once", async () => {
    const plain = installMockPlatform({}, { "gone.json": "{}" });
    const platform = getPlatform();
    const writing = platform.writeFile("a.json", "{}");
    // Synchronously, as before the route: the adapter has the call before anything is awaited.
    expect(plain.state.calls.some(([name]) => name === "writeFile")).toBe(true);
    await writing;
    await platform.uploadFile("b.bin", new Uint8Array([1, 2]).buffer);
    await platform.deleteFile("gone.json");
    expect(plain.state.calls.map(([name]) => name)).toEqual([
      "writeFile",
      "uploadFile",
      "deleteFile",
    ]);
  });

  test("before the host answers, a write waits for it and then names the store's account", async () => {
    const fake = host([file("a.json", "d1", "sha256-a")]);
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const installed = installMockPlatform({
      deleteProjectState: fake.delete,
      subscribeProjectState: async (request) => {
        await gate;
        return fake.subscribe(request);
      },
      writeProjectState: fake.write,
    });
    startProjectStateSync(installed.platform);
    const writing = getPlatform().writeFile("a.json", "next");
    await sleep(0);
    expect(fake.writes).toHaveLength(0);
    open();
    await writing;
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      baseHash: "sha256-a",
      contents: "next",
      path: "a.json",
    });
    expect(installed.state.calls.some(([name]) => name === "writeFile")).toBe(false);
  });

  test("a host that refuses the subscription takes every write plainly", async () => {
    const installed = installMockPlatform({
      deleteProjectState: () => Promise.reject(new Error("not served")),
      subscribeProjectState: () => Promise.reject(new Error("404")),
      writeProjectState: () => Promise.reject(new Error("not served")),
    });
    startProjectStateSync(installed.platform);
    const platform = getPlatform();
    await platform.writeFile("a.json", "{}");
    await platform.uploadFile("b.bin", new Uint8Array([1]).buffer);
    await platform.deleteFile("a.json");
    expect(installed.state.calls.map(([name]) => name)).toEqual([
      "writeFile",
      "uploadFile",
      "deleteFile",
    ]);
  });

  test("a write names Studio's own write still on its way, and never its own bytes", async () => {
    const served = await serve([file("a.json", "d1", "sha256-a")]);
    const platform = getPlatform();
    await platform.writeFile("a.json", "one");
    // The caller's own note of these bytes (`markLocalWrite`) is not what they replace.
    await contentStore.noteOwnWrite("a.json", "two");
    await platform.writeFile("a.json", "two");
    expect(served.writes.map((write) => write.baseHash)).toEqual([
      "sha256-a",
      await contentHash("one"),
    ]);
    expect(served.writes[0]!.writeId).not.toBe(served.writes[1]!.writeId);
  });

  test("a refused write rejects, writes nothing, and leaves no note behind", async () => {
    const served = await serve([file("a.json", "d1", "sha256-a")]);
    served.writeAnswers.push({
      conflict: { diskHash: "sha256-theirs", docId: "d1", path: "a.json" },
      ok: false,
    });
    const refused = await rejection(() => getPlatform().writeFile("a.json", "mine"));
    expect(refused).toBeInstanceOf(StaleWriteError);
    expect(refused instanceof StaleWriteError ? refused.conflict.diskHash : null).toBe(
      "sha256-theirs",
    );
    expect(refused?.message).toBe(
      "a.json changed on disk after Studio last read it, so it was not written. Look at it again, then try again.",
    );
    expect(served.writes).toHaveLength(1);
    expect(contentStore.pendingWriteAt("a.json")).toBeUndefined();
  });

  test("a path the store has no account of is written against what is there, once", async () => {
    const served = await serve([]);
    served.writeAnswers.push(
      { conflict: { diskHash: "sha256-out", docId: null, path: "x.txt" }, ok: false },
      { conflict: { diskHash: "sha256-moved", docId: null, path: "x.txt" }, ok: false },
    );
    const refused = await rejection(() => getPlatform().writeFile("x.txt", "text"));
    expect(served.writes.map((write) => write.baseHash)).toEqual([null, "sha256-out"]);
    expect(refused).toBeInstanceOf(StaleWriteError);

    // A new file, as `writeNewFile` makes one: asserting nothing is there.
    await getPlatform().writeFile("new.json", "{}");
    expect(served.writes.at(-1)).toMatchObject({ baseHash: null, path: "new.json" });
  });

  test("where nothing can hash, a write names the host's hash and is still made", async () => {
    const served = await serve([file("a.json", "d1", "sha256-a")]);
    served.writeAnswers.push({ hash: "sha256-next", ok: true, rev: 2 });
    const digest = spyOn(crypto.subtle, "digest").mockImplementation(() =>
      Promise.reject(new Error("crypto.subtle is unavailable")),
    );
    try {
      await getPlatform().writeFile("a.json", "next");
    } finally {
      digest.mockRestore();
    }
    expect(served.writes[0]).toMatchObject({ baseHash: "sha256-a", path: "a.json" });
  });

  test("an upload goes through the contract as bytes, and reports the path it wrote", async () => {
    const served = await serve([]);
    const platform = getPlatform();
    expect(await platform.uploadFile("a.bin", new Uint8Array([1, 2, 3]).buffer)).toEqual({
      path: "a.bin",
      size: 3,
    });
    const blob = new Blob([new Uint8Array([4])]);
    expect(await platform.uploadFile("b.bin", blob)).toEqual({
      path: "b.bin",
      size: 1,
    });
    // A string is base64, as the RPC hosts have always read one.
    expect(await platform.uploadFile("c.bin", btoa("hi"))).toEqual({ path: "c.bin", size: 2 });
    const bytes = served.writes.map((write) =>
      write.contents instanceof Uint8Array ? [...write.contents] : write.contents,
    );
    expect(bytes).toEqual([[1, 2, 3], [4], [104, 105]]);
    expect(served.state.calls.some(([name]) => name === "uploadFile")).toBe(false);
  });

  test("a plain delete names the file's hash, and a refusal of it rejects", async () => {
    const served = await serve([
      file("a.json", "d1", "sha256-a"),
      file("b.json", "d2", "sha256-b"),
    ]);
    await getPlatform().deleteFile("a.json");
    served.deleteAnswers.push({
      conflict: { diskHash: "sha256-c", docId: "d2", path: "b.json" },
      ok: false,
    });
    expect(await rejection(() => getPlatform().deleteFile("b.json"))).toBeInstanceOf(
      StaleWriteError,
    );
    expect(served.deletes.map((remove) => remove.base)).toEqual([
      { hash: "sha256-a" },
      { hash: "sha256-b" },
    ]);
  });
});
