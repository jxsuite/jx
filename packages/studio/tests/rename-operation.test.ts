import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { answerSubscribe, createMemoryEventLog } from "@jxsuite/protocol/project-state";
import type {
  ProjectEvent,
  RenameApplied,
  RenameOperation,
  RenameOperationResult,
  SubscribeRequest,
} from "@jxsuite/protocol/project-state";

const { applyBufferRewrite, RenameRefusedError, renamesThroughHost, renameThroughHost } =
  await import("../src/files/rename-operation");
const { commitRename } = await import("../src/files/files");
const { startProjectStateSync, stopProjectStateSync } =
  await import("../src/project-state/subscription");
const { openTab, workspace } = await import("../src/workspace/workspace");
const { canUndo } = await import("../src/tabs/transact");
const { collabState } = await import("../src/collab/collab-state");
const { contentStore } = await import("../src/project-state/store");

const sleep = (ms: number) =>
  new Promise((resume) => {
    setTimeout(resume, ms);
  });

/** What a host answers a rename with when it applied it. */
const APPLIED: RenameApplied = {
  buffers: [],
  errors: [{ error: "No serializer", path: "content/a.csv" }],
  files: ["media/brand.png", "pages/home.json"],
  from: "media/logo.png",
  isDir: false,
  ok: true,
  opId: "op",
  references: { files: [{ count: 1, path: "pages/home.json" }], filesChanged: 1, refsUpdated: 1 },
  rev: 7,
  to: "media/brand.png",
};

/** Install a platform whose host serves the subscription and answers renames with `answer`. */
async function serve(answer: (operation: RenameOperation) => RenameOperationResult) {
  const log = createMemoryEventLog({ epoch: "e1" });
  const sent: RenameOperation[] = [];
  const installed = installMockPlatform({
    renameProjectState: (operation: RenameOperation) => {
      sent.push(operation);
      return Promise.resolve(answer(operation));
    },
    subscribeProjectState: (request: SubscribeRequest) =>
      Promise.resolve(
        answerSubscribe(log, request, () => ({
          components: [],
          files: [],
          formats: "f",
          readiness: "ready",
        })),
      ),
  });
  startProjectStateSync(installed.platform);
  for (let i = 0; i < 5; i += 1) {
    await sleep(0);
  }
  return { ...installed, sent };
}

/** An open referrer with unsaved edits. */
function dirtyReferrer(path = "pages/about.json") {
  const tab = resetWorkspaceWithTab(
    {
      $elements: [{ $ref: "../media/logo.png" }, "keep"],
      $props: {
        count: 3,
        cover: { src: "../media/logo.png" },
        list: { map: { tagName: "my-card" } },
        note: { textContent: "../media/logo.png" },
      },
      children: [
        { src: "../media/logo.png", tagName: "img" },
        { tagName: "my-card", textContent: "../media/logo.png" },
        "text",
      ],
      tagName: "main",
    },
    { documentPath: path, id: path },
  );
  tab.doc.content.frontmatter = { draft: undefined, image: "../media/logo.png", title: "About" };
  tab.doc.dirty = true;
  return tab;
}

beforeEach(() => {
  resetStudioState();
});

afterEach(() => {
  stopProjectStateSync();
});

describe("whether a rename goes through the host (project-state.md §9)", () => {
  test("only with the member, and only once the host has answered a subscribe", async () => {
    expect(await renamesThroughHost({})).toBe(false);
    const plain = installMockPlatform({
      renameProjectState: () => Promise.resolve(APPLIED),
    });
    expect(await renamesThroughHost(plain.platform)).toBe(false);
    const served = await serve(() => APPLIED);
    expect(await renamesThroughHost(served.platform)).toBe(true);
  });
});

describe("a rename as one operation", () => {
  test("names every dirty tab, applies the host's rewrite to its buffer, and reports", async () => {
    const served = await serve((operation) => ({
      ...APPLIED,
      buffers: [
        {
          bufferRev: operation.dirtyReferrers[0]!.bufferRev,
          changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
          path: "pages/about.json",
          tag: { from: "my-card", to: "my-badge" },
        },
      ],
      tag: { filesChanged: 1, from: "my-card", refsUpdated: 1, to: "my-badge" },
      tagSkipped: "kept",
    }));
    const tab = dirtyReferrer();
    const clean = openTab({
      document: { tagName: "main" },
      documentPath: "pages/clean.json",
      id: "pages/clean.json",
    });
    const report = await renameThroughHost("media/logo.png", "media/brand.png");
    expect(served.sent).toHaveLength(1);
    expect(served.sent[0]).toMatchObject({
      from: "media/logo.png",
      policy: "rewrite-buffer",
      to: "media/brand.png",
    });
    expect(served.sent[0]!.dirtyReferrers.map((item) => item.path)).toEqual(["pages/about.json"]);
    expect(clean.doc.dirty).toBe(false);
    const doc = tab.doc.document;
    // Prose is never rewritten.
    expect(doc.children).toEqual([
      { src: "../media/brand.png", tagName: "img" },
      { tagName: "my-badge", textContent: "../media/logo.png" },
      "text",
    ]);
    expect(doc.$props).toEqual({
      count: 3,
      cover: { src: "../media/brand.png" },
      list: { map: { tagName: "my-badge" } },
      note: { textContent: "../media/logo.png" },
    });
    expect(doc.$elements).toEqual([{ $ref: "../media/brand.png" }, "keep"]);
    expect(tab.doc.content.frontmatter).toEqual({
      draft: undefined,
      image: "../media/brand.png",
      title: "About",
    });
    expect(tab.doc.dirty).toBe(true);
    expect(canUndo(tab)).toBe(true);
    expect(report).toEqual({
      errors: APPLIED.errors,
      from: "media/logo.png",
      isDir: false,
      ok: true,
      references: APPLIED.references,
      tag: { filesChanged: 1, from: "my-card", refsUpdated: 1, to: "my-badge" },
      tagSkipped: "kept",
      to: "media/brand.png",
    });
  });

  test("a rewrite still applies to a buffer edited while the rename was in flight", async () => {
    await serve(() => ({
      ...APPLIED,
      buffers: [
        {
          bufferRev: 999,
          changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
          path: "pages/about.json",
        },
      ],
    }));
    const tab = dirtyReferrer();
    const report = await renameThroughHost("media/logo.png", "media/brand.png");
    expect(JSON.stringify(tab.doc.document.children)).toContain("../media/brand.png");
    expect(report.errors).toEqual(APPLIED.errors);
  });

  test("a rewrite with nothing left to change, or no tab to change, is named in the report", async () => {
    await serve(() => ({
      ...APPLIED,
      buffers: [
        { bufferRev: 1, changes: [{ from: "gone.png", to: "x.png" }], path: "pages/about.json" },
        { bufferRev: 1, changes: [{ from: "a.png", to: "b.png" }], path: "media/logo.png" },
        { bufferRev: 1, changes: [], path: "pages/other.json" },
      ],
    }));
    dirtyReferrer();
    const report = await renameThroughHost("media/logo.png", "media/brand.png");
    expect((report.errors ?? []).slice(APPLIED.errors.length)).toEqual([
      { error: expect.stringContaining("no longer name"), path: "pages/about.json" },
      { error: expect.stringContaining("tab closed"), path: "media/brand.png" },
    ]);
  });

  test("a co-edited tab is named, and its rewrite is an edit through its room", async () => {
    const served = await serve((operation) => ({
      ...APPLIED,
      buffers: [
        {
          bufferRev: operation.dirtyReferrers[0]!.bufferRev,
          changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
          path: "pages/about.json",
        },
      ],
    }));
    const tab = dirtyReferrer();
    collabState(tab).active = true;
    await renameThroughHost("media/logo.png", "media/brand.png");
    expect(served.sent[0]!.dirtyReferrers.map((item) => item.path)).toEqual(["pages/about.json"]);
    expect(JSON.stringify(tab.doc.document.children)).toContain("../media/brand.png");
  });

  test("its steps' events are this window's own", async () => {
    const served = await serve(() => APPLIED);
    await renameThroughHost("media/logo.png", "media/brand.png");
    const { opId } = served.sent[0]!;
    const event = (writeId: string): ProjectEvent => ({
      docId: "d",
      hash: "sha256-x",
      origin: { writeHash: "sha256-x", writeId },
      path: "pages/home.json",
      rev: 1,
      type: "fileChanged",
    });
    expect(contentStore.isOwnEvent(event(`${opId}:1`))).toBe(true);
    expect(contentStore.isOwnEvent(event(`${opId}:rollback:0`))).toBe(true);
    expect(contentStore.isOwnEvent(event("someone-else:1"))).toBe(false);
  });

  test("a refusal throws, naming the host's reason", async () => {
    await serve(() => ({
      message: "Some documents that refer to it have unsaved edits.",
      ok: false,
      opId: "op",
      paths: ["pages/about.json"],
      reason: "dirty-referrers",
    }));
    const failure = await renameThroughHost("media/logo.png", "media/brand.png").then(
      () => null,
      (error: Error) => error,
    );
    expect(failure).toBeInstanceOf(RenameRefusedError);
    expect(failure instanceof RenameRefusedError && failure.refusal.reason).toBe("dirty-referrers");
    expect(failure?.message).toContain("unsaved edits");
  });

  test("a rewrite that names nothing in the buffer changes nothing, and says so", () => {
    const tab = dirtyReferrer();
    const before = JSON.stringify(tab.doc.document);
    expect(
      applyBufferRewrite(tab, {
        bufferRev: tab.doc.buffer.bufferRev,
        changes: [{ from: "elsewhere.png", to: "x.png" }],
        path: "pages/about.json",
      }),
    ).toBe(false);
    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(canUndo(tab)).toBe(false);
  });

  test("a rewrite reaches a url() inside a style string and a map's keys", () => {
    const tab = resetWorkspaceWithTab(
      {
        copy: { "../media/logo.png": "logo.png", "keep.txt": "keep.txt" },
        style: {
          backgroundImage: "url(../media/logo.png)",
          color: "red",
          mask: 'url("../media/logo.png") no-repeat, url(other.png)',
        },
        tagName: "main",
      },
      { documentPath: "pages/styled.json", id: "pages/styled.json" },
    );
    expect(
      applyBufferRewrite(tab, {
        bufferRev: tab.doc.buffer.bufferRev,
        changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
        path: "pages/styled.json",
      }),
    ).toBe(true);
    expect(tab.doc.document.style).toEqual({
      backgroundImage: "url(../media/brand.png)",
      color: "red",
      mask: 'url("../media/brand.png") no-repeat, url(other.png)',
    });
    // SAFETY: the document above sets `copy` to an object.
    expect(Object.keys(tab.doc.document.copy as object)).toEqual([
      "../media/brand.png",
      "keep.txt",
    ]);
  });
});

describe("commitRename", () => {
  test("goes through the host when it serves one, and re-keys the tab", async () => {
    const served = await serve(() => ({ ...APPLIED, files: ["media/brand.png"] }));
    const { renameFile } = served.platform;
    let legacy = 0;
    served.platform.renameFile = (from, to) => {
      legacy += 1;
      return renameFile(from, to);
    };
    openTab({ document: { tagName: "img" }, documentPath: "media/logo.png", id: "media/logo.png" });
    const report = await commitRename("media/logo.png", "media/brand.png");
    expect(report.references?.filesChanged).toBe(1);
    expect(served.sent).toHaveLength(1);
    expect(legacy).toBe(0);
    expect(workspace.tabs.has("media/brand.png")).toBe(true);
  });

  test("a rollback that left the entry at its new path moves its tab there, and still throws", async () => {
    await serve(() => ({
      message: "Some steps could not be undone.",
      ok: false,
      opId: "op",
      paths: ["pages/home.json"],
      reason: "failed",
      unrestored: ["media/brand.png"],
    }));
    openTab({ document: { tagName: "img" }, documentPath: "media/logo.png", id: "media/logo.png" });
    const failure = await commitRename("media/logo.png", "media/brand.png").then(
      () => null,
      (error: Error) => error,
    );
    expect(failure).toBeInstanceOf(RenameRefusedError);
    expect(workspace.tabs.has("media/brand.png")).toBe(true);
  });

  test("a clean refusal leaves the tab where it was", async () => {
    await serve(() => ({
      message: "No.",
      ok: false,
      opId: "op",
      paths: [],
      reason: "failed",
    }));
    openTab({ document: { tagName: "img" }, documentPath: "media/logo.png", id: "media/logo.png" });
    const failure = await commitRename("media/logo.png", "media/brand.png").then(
      () => null,
      (error: Error) => error,
    );
    expect(failure).toBeInstanceOf(RenameRefusedError);
    expect(workspace.tabs.has("media/logo.png")).toBe(true);
  });

  test("keeps the existing path without a served host", async () => {
    const plain = installMockPlatform({}, { "media/logo.png": "png" });
    let legacy = 0;
    const { renameFile } = plain.platform;
    plain.platform.renameFile = (from, to) => {
      legacy += 1;
      return renameFile(from, to);
    };
    await commitRename("media/logo.png", "media/brand.png");
    expect(legacy).toBe(1);
  });
});
