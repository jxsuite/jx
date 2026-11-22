/**
 * Collaboration rooms keyed by document (`specs/project-state.md` §5, §11.3): inside the project
 * the dev server's host serves, a room follows its document across a rename, closes when it is
 * removed, saves through the host's conditional write with the hash it loaded or last saved, and a
 * refused save reaches every participant. The host is a stand-in, so each of its events is placed
 * exactly; the rooms, the sockets and the wire are the real ones.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ContentHash, ProjectEvent, WriteResult } from "@jxsuite/protocol/project-state";
import { createWsCollabConnection } from "@jxsuite/collab/client";
import type { WsCollabConnection } from "@jxsuite/collab/client";
import type { CollabConflict, CollabHandle } from "@jxsuite/collab";
import { sourceText, updateSourceText } from "@jxsuite/collab";
import { serve } from "#serve";
import { createCollabRegistry } from "../src/collab.ts";
import type { CollabRegistry, CollabSocketData } from "../src/collab.ts";
import { createProjectEventsService } from "../src/project-events.ts";
import type { ProjectEventsService } from "../src/project-events.ts";
import { fakeHost } from "./_fake-project-host.ts";
import type { FakeHost } from "./_fake-project-host.ts";

const ORIGINAL = "# A\n";

let dir: string;
let project: string;
let hosts: FakeHost[];
let events: ProjectEventsService;
let registry: CollabRegistry;
let server: Awaited<ReturnType<typeof serve<CollabSocketData>>>;
let connections: WsCollabConnection[];
/** What the stand-in host's next write answers instead of writing; `null` writes. */
let refuseNext: WriteResult | Error | null;
let rev: number;
/** How many writes the stand-in host refused for a stale base. */
let refusals: number;

/** The hash of the file at `path`, `null` when there is none. */
async function diskHash(path: string): Promise<ContentHash | null> {
  return existsSync(path) ? contentHash(readFileSync(path)) : null;
}

/**
 * The stand-in host: it checks the write's base against the disk, writes, and emits the write's own
 * `fileChanged`, as the real one does.
 */
function host(root: string): FakeHost {
  const made = fakeHost(root);
  made.docs.set("pages/a.md", "d1");
  made.write = async (request) => {
    made.writes.push(request);
    const refusal = refuseNext;
    refuseNext = null;
    if (refusal instanceof Error) {
      throw refusal;
    }
    if (refusal !== null) {
      return refusal;
    }
    const onDisk = await diskHash(join(root, request.path));
    if (onDisk !== request.baseHash) {
      refusals += 1;
      return { conflict: { diskHash: onDisk, docId: "d1", path: request.path }, ok: false };
    }
    writeFileSync(join(root, request.path), request.contents);
    const hash = await contentHash(request.contents);
    rev += 1;
    made.emit([
      {
        docId: "d1",
        hash,
        origin: { writeHash: hash, writeId: request.writeId },
        path: request.path,
        rev,
        type: "fileChanged",
      },
    ]);
    return { hash, ok: true, rev };
  };
  hosts.push(made);
  return made;
}

/** An event of any one type, before the host gives it a revision. */
type Unrevised<E> = E extends unknown ? Omit<E, "rev"> : never;

/** Emit `event` from the running host, at the next revision. */
function emit(event: Unrevised<ProjectEvent>): void {
  rev += 1;
  // SAFETY: an event of one type and the revision every event carries.
  hosts.at(-1)!.emit([{ ...event, rev } as ProjectEvent]);
}

async function open(path: string): Promise<CollabHandle> {
  const connection = createWsCollabConnection({
    openTimeoutMs: 5000,
    url: `ws://localhost:${server.port}`,
  });
  connections.push(connection);
  const handle = await connection.openDoc(path);
  expect(handle).not.toBeNull();
  await handle!.whenSynced;
  return handle!;
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await Bun.sleep(5);
  }
}

/** An unsaved edit, once the room reports it dirty. */
async function edit(handle: CollabHandle, text: string): Promise<void> {
  let dirty = false;
  const off = handle.onDirty((now) => {
    dirty = now;
  });
  updateSourceText(handle.doc, text, "test");
  await until(() => dirty);
  off();
}

/** How many times the server reset a handle's room. */
interface ResetCount {
  count: number;
}

function resets(handle: CollabHandle): ResetCount {
  const seen: ResetCount = { count: 0 };
  handle.onReset(() => {
    seen.count += 1;
  });
  return seen;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "jx-collab-rooms-"));
  project = join(dir, "site");
  mkdirSync(join(project, "pages"), { recursive: true });
  writeFileSync(join(project, "pages/a.md"), ORIGINAL);
  writeFileSync(join(dir, "outside.md"), "outside\n");
  hosts = [];
  connections = [];
  refuseNext = null;
  rev = 0;
  refusals = 0;
  events = createProjectEventsService({
    createHost: (options) => Promise.resolve(host(options.root)),
  });
  await events.activate(project);
  registry = createCollabRegistry({
    absRoot: dir,
    activeProjectRoot: () => project,
    projectEvents: events,
  });
  server = await serve<CollabSocketData>({
    fetch: (req, handle) => registry.handleRequest(req, handle) ?? new Response("ok"),
    port: 0,
    websocket: registry.websocket,
  });
});

afterEach(async () => {
  for (const connection of connections) {
    connection.destroy();
  }
  await registry.stop();
  await events.close();
  void server.stop(true);
  rmSync(dir, { force: true, recursive: true });
});

describe("a room keyed by document (§11.3)", () => {
  test("follows its document across a rename, and saves there with the base it loaded", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    await edit(a, "# A\n\nunsaved\n");
    renameSync(join(project, "pages/a.md"), join(project, "pages/b.md"));
    hosts[0]!.docs.delete("pages/a.md");
    hosts[0]!.docs.set("pages/b.md", "d1");
    emit({
      docId: "d1",
      from: "pages/a.md",
      isDir: false,
      origin: "external",
      to: "pages/b.md",
      type: "fileRenamed",
    });
    // A peer opening the new path joins the same room, unsaved edit and all.
    const b = await open("site/pages/b.md");
    expect(sourceText(b.doc).toString()).toBe("# A\n\nunsaved\n");
    // The peer still at the old path keeps talking to it.
    updateSourceText(a.doc, "# A\n\nunsaved, twice\n", "test");
    await until(() => sourceText(b.doc).toString().includes("twice"));
    await b.flush();
    const [write] = hosts[0]!.writes;
    expect(write).toMatchObject({ baseHash: await contentHash(ORIGINAL), path: "pages/b.md" });
    expect(readFileSync(join(project, "pages/b.md"), "utf8")).toBe("# A\n\nunsaved, twice\n");
    // Its own save is not an external change: the room is not reset, and the next save's base moved.
    const seen = resets(a);
    await edit(a, "# A\n\nthird\n");
    await a.flush();
    expect(hosts[0]!.writes[1]!.baseHash).toBe(await contentHash("# A\n\nunsaved, twice\n"));
    expect(seen.count).toBe(0);
  });

  test("a room opened before the host knew its document follows it by path", async () => {
    const a = await open("site/pages/a.md");
    await until(() => hosts.length === 1);
    emit({
      docId: "d9",
      from: "pages/a.md",
      isDir: false,
      origin: "external",
      to: "pages/c.md",
      type: "fileRenamed",
    });
    emit({
      docId: "d8",
      from: "pages",
      isDir: true,
      origin: "external",
      to: "docs",
      type: "fileRenamed",
    });
    renameSync(join(project, "pages"), join(project, "docs"));
    renameSync(join(project, "docs/a.md"), join(project, "docs/c.md"));
    await edit(a, "# moved\n");
    await a.flush();
    expect(hosts[0]!.writes[0]!.path).toBe("docs/c.md");
  });

  test("a document moved onto a path another room holds displaces that room", async () => {
    await events.start();
    hosts[0]!.docs.set("pages/b.md", "d2");
    writeFileSync(join(project, "pages/b.md"), "# B\n");
    const a = await open("site/pages/a.md");
    const b = await open("site/pages/b.md");
    const seen = resets(b);
    emit({
      docId: "d1",
      from: "pages/a.md",
      isDir: false,
      origin: "external",
      to: "pages/b.md",
      type: "fileRenamed",
    });
    await until(() => seen.count === 1);
    expect(sourceText(a.doc).toString()).toBe(ORIGINAL);
  });

  test("closes when its document is removed", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const seen = resets(a);
    await edit(a, "# A\n\ngone\n");
    rmSync(join(project, "pages"), { force: true, recursive: true });
    emit({ docId: "dir", isDir: true, origin: "external", path: "pages", type: "fileRemoved" });
    await until(() => seen.count === 1);
    // Nothing is left to flush on shutdown, so the removed file stays removed.
    await registry.stop();
    expect(hosts[0]!.writes).toEqual([]);
  });

  test("a change that is not its own reseeds it, unless it holds the room's bytes", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const seen = resets(a);
    await edit(a, "# A\n\nsame\n");
    // Another writer saved exactly the room's bytes: the room is clean, not reset.
    let dirty = true;
    a.onDirty((now) => {
      dirty = now;
    });
    const same = await contentHash("# A\n\nsame\n");
    emit({ docId: "d1", hash: same, origin: "external", path: "pages/a.md", type: "fileChanged" });
    await until(() => !dirty);
    // The same hash again, and a change elsewhere, are nothing to this room.
    emit({ docId: "d1", hash: same, origin: "external", path: "pages/a.md", type: "fileChanged" });
    emit({
      docId: "d5",
      hash: same,
      origin: "external",
      path: "pages/other.md",
      type: "fileChanged",
    });
    emit({
      docId: "d5",
      hash: same,
      isDir: false,
      origin: "external",
      path: "pages/other.md",
      type: "fileAdded",
    });
    expect(seen.count).toBe(0);
    writeFileSync(join(project, "pages/a.md"), "# rewritten\n");
    const other = (await contentHash("# rewritten\n")) satisfies ContentHash;
    emit({
      docId: "d1",
      hash: other,
      origin: { writeHash: other, writeId: "someone-else" },
      path: "pages/a.md",
      type: "fileChanged",
    });
    await until(() => seen.count === 1);
  });

  test("a change under unsaved edits keeps them as a conflict until a participant chooses", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const b = await open("site/pages/a.md");
    const seen = resets(a);
    const conflicts: CollabConflict[] = [];
    a.onConflict!((conflict) => conflicts.push(conflict));
    b.onConflict!((conflict) => conflicts.push(conflict));
    let dirty = false;
    a.onDirty((now) => {
      dirty = now;
    });
    await edit(a, "# A\n\nmine\n");
    // Another program rewrites the file while the room holds unsaved edits.
    writeFileSync(join(project, "pages/a.md"), "# theirs\n");
    const theirs = await contentHash("# theirs\n");
    emit({
      docId: "d1",
      hash: theirs,
      origin: "external",
      path: "pages/a.md",
      type: "fileChanged",
    });
    await until(() => conflicts.length === 2);
    // The room keeps the edits and stays dirty: nothing reseeded it, and every participant knows.
    expect(conflicts[0]).toEqual({ diskHash: theirs, docId: "d1" });
    expect(seen.count).toBe(0);
    expect(dirty).toBe(true);
    expect(sourceText(b.doc).toString()).toBe("# A\n\nmine\n");
    // A plain save is refused: the room's base is still the bytes it loaded.
    await a.flush();
    await until(() => conflicts.length === 4);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# theirs\n");
    // Keep Mine names what is on disk now, and the room's edits land.
    await a.flush({ baseHash: theirs });
    await until(() => !dirty);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nmine\n");
    // The room's base moved with the save: the next one is not refused.
    await edit(a, "# A\n\nagain\n");
    await a.flush();
    await until(() => !dirty);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nagain\n");
    expect(conflicts).toHaveLength(4);
  });

  test("a base that names no bytes is ignored, and one naming the room's own bytes saves nothing", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    let dirty = false;
    a.onDirty((now) => {
      dirty = now;
    });
    await edit(a, "# A\n\nmine\n");
    await a.flush({ baseHash: "not-a-hash" });
    await until(() => !dirty);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nmine\n");
    const writes = hosts[0]!.writes.length;
    // The room already holds what the named base is: it is persisted without a write.
    await edit(a, ORIGINAL);
    await a.flush({ baseHash: await contentHash(ORIGINAL) });
    await until(() => !dirty);
    expect(hosts[0]!.writes).toHaveLength(writes);
  });

  test("taking the disk's copy reverts the room for every participant", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const b = await open("site/pages/a.md");
    const seenA = resets(a);
    const seenB = resets(b);
    await edit(a, "# A\n\nmine\n");
    writeFileSync(join(project, "pages/a.md"), "# theirs\n");
    await a.revert!();
    await until(() => seenA.count === 1 && seenB.count === 1);
    // Nothing is left to flush on shutdown, and the room reopens from the file.
    const again = await open("site/pages/a.md");
    expect(sourceText(again.doc).toString()).toBe("# theirs\n");
    await registry.stop();
    expect(hosts[0]!.writes).toEqual([]);
  });

  test("a stale save is refused, leaves the disk, and reaches every participant", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const b = await open("site/pages/a.md");
    const conflicts: CollabConflict[] = [];
    a.onConflict!((conflict) => conflicts.push(conflict));
    b.onConflict!((conflict) => conflicts.push(conflict));
    await edit(a, "# A\n\nmine\n");
    const disk = await contentHash("# theirs\n");
    refuseNext = { conflict: { diskHash: disk, docId: "d1", path: "pages/a.md" }, ok: false };
    await a.flush();
    await until(() => conflicts.length === 2);
    expect(conflicts[0]).toEqual({ diskHash: disk, docId: "d1" });
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe(ORIGINAL);
    // A write that fails outright is retried by the next save.
    refuseNext = new Error("disk full");
    await a.flush();
    await a.flush();
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nmine\n");
  });

  test("a shutdown flush that is refused leaves the disk untouched", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    await edit(a, "# A\n\nunsaved\n");
    refuseNext = { conflict: { diskHash: null, docId: null, path: "pages/a.md" }, ok: false };
    await registry.stop();
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe(ORIGINAL);
  });

  test("activating another project saves its rooms through their host, then closes them", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const seen = resets(a);
    await edit(a, "# A\n\nunsaved\n");
    await events.activate(dir);
    await until(() => seen.count === 1);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nunsaved\n");
    expect(hosts[0]!.writes).toHaveLength(1);
    expect(hosts[0]!.writes[0]!.baseHash).toBe(await contentHash(ORIGINAL));
  });

  test("a room keyed by its path that the next project covers closes, saved first", async () => {
    const outside = await open("outside.md");
    const seen = resets(outside);
    await edit(outside, "outside, unsaved\n");
    await events.activate(dir);
    await until(() => seen.count === 1);
    await until(() => readFileSync(join(dir, "outside.md"), "utf8") === "outside, unsaved\n");
    // Opened again, the file is the new project's, keyed by its document, one room.
    await events.start();
    hosts.at(-1)!.docs.set("outside.md", "d7");
    const again = await open("outside.md");
    const twice = await open("outside.md");
    await edit(again, "outside, again\n");
    await until(() => sourceText(twice.doc).toString() === "outside, again\n");
    await again.flush();
    expect(hosts.at(-1)!.writes.map((write) => write.path)).toEqual(["outside.md"]);
  });

  test("a room keyed by its path the next project does not cover stays open", async () => {
    mkdirSync(join(dir, "other"));
    const outside = await open("outside.md");
    const seen = resets(outside);
    await events.activate(join(dir, "other"));
    await events.activate(project);
    expect(seen.count).toBe(0);
  });

  test("two saves pressed together are one save after another, never a conflict", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const b = await open("site/pages/a.md");
    const refused: CollabConflict[] = [];
    a.onConflict!((conflict) => refused.push(conflict));
    await edit(a, "# A\n\nboth\n");
    await Promise.all([a.flush(), b.flush(), a.flush()]);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe("# A\n\nboth\n");
    expect(refusals).toBe(0);
    expect(refused).toEqual([]);
    expect(hosts[0]!.writes).toHaveLength(1);
  });

  test("a peer opening the new path before the rename event reaches the room saves there", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    await edit(a, "# A\n\nmoving\n");
    // The host has indexed the move; its event has not been emitted yet.
    renameSync(join(project, "pages/a.md"), join(project, "pages/b.md"));
    hosts[0]!.docs.delete("pages/a.md");
    hosts[0]!.docs.set("pages/b.md", "d1");
    const b = await open("site/pages/b.md");
    expect(sourceText(b.doc).toString()).toBe("# A\n\nmoving\n");
    await b.flush();
    expect(hosts[0]!.writes[0]).toMatchObject({
      baseHash: await contentHash(ORIGINAL),
      path: "pages/b.md",
    });
    expect(refusals).toBe(0);
    // The event arrives after: the room stays where it is, and a later save still has its base.
    emit({
      docId: "d1",
      from: "pages/a.md",
      isDir: false,
      origin: "external",
      to: "pages/b.md",
      type: "fileRenamed",
    });
    await edit(a, "# A\n\nmoved\n");
    await a.flush();
    expect(readFileSync(join(project, "pages/b.md"), "utf8")).toBe("# A\n\nmoved\n");
    expect(refusals).toBe(0);
  });

  test("a room that does not load leaves nothing behind, and starts no host", async () => {
    const connection = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${server.port}`,
    });
    connections.push(connection);
    expect(await connection.openDoc("site/pages/missing.md")).toBeNull();
    expect(await connection.openDoc("missing.md")).toBeNull();
    // The file appears: it opens as any other, keyed by its path outside the project.
    writeFileSync(join(dir, "missing.md"), "here\n");
    const found = await open("missing.md");
    expect(sourceText(found.doc).toString()).toBe("here\n");
    expect(hosts).toHaveLength(0);
  });

  test("a resubscribe answered by a snapshot reaches each room as what changed", async () => {
    await events.start();
    writeFileSync(join(project, "pages/c.md"), "# C\n");
    writeFileSync(join(project, "pages/d.md"), "# D\n");
    hosts[0]!.docs.set("pages/c.md", "d3");
    hosts[0]!.docs.set("pages/d.md", "d4");
    const a = await open("site/pages/a.md");
    const c = await open("site/pages/c.md");
    const d = await open("site/pages/d.md");
    const goneA = resets(a);
    const changedC = resets(c);
    const keptD = resets(d);
    const file = (path: string, hash?: ContentHash) => ({
      docId: "x",
      indexed: true,
      isDir: false,
      kind: "other" as const,
      path,
      ...(hash !== undefined && { hash }),
    });
    const changed = await contentHash("# C, elsewhere\n");
    // While the watcher was degraded a.md went away and c.md changed; d.md is not hashed yet.
    hosts[0]!.snapshot = () => ({
      components: [],
      files: [file("pages/c.md", changed), file("pages/d.md")],
      formats: "",
      readiness: "ready",
    });
    hosts[0]!.end();
    await until(() => goneA.count === 1 && changedC.count === 1);
    expect(keptD.count).toBe(0);
  });

  test("a follower step that fails is reported, and the next one still runs", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    const seen = resets(a);
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      // A snapshot whose entry for the room's file cannot be read, which is the point.
      hosts[0]!.snapshot = () => ({
        components: [],
        files: [
          {
            docId: "d1",
            get hash(): ContentHash {
              throw new Error("unreadable");
            },
            indexed: true,
            isDir: false,
            kind: "other",
            path: "pages/a.md",
          },
        ],
        formats: "",
        readiness: "ready",
      });
      hosts[0]!.end();
      await until(() => errors.length === 1);
      emit({
        docId: "d1",
        isDir: false,
        origin: "external",
        path: "pages/a.md",
        type: "fileRemoved",
      });
      await until(() => seen.count === 1);
    } finally {
      console.error = original;
    }
    expect(errors[0]).toContain("[collab]");
  });

  test("a save racing the activation of another project saves only in its own project", async () => {
    await events.start();
    const a = await open("site/pages/a.md");
    await edit(a, "# A\n\nunsaved\n");
    // The activation's own save fails, so the room is still unsaved when the racing one arrives.
    refuseNext = new Error("disk full");
    let release!: () => void;
    hosts[0]!.close = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const switching = events.activate(dir);
    await a.flush();
    release();
    await switching;
    expect(hosts[0]!.writes).toHaveLength(1);
    expect(hosts.slice(1).flatMap((made) => made.writes)).toEqual([]);
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe(ORIGINAL);
  });

  test("outside the project, a room is keyed by path and saves as before", async () => {
    const outside = await open("outside.md");
    await edit(outside, "outside, edited\n");
    await outside.flush();
    expect(readFileSync(join(dir, "outside.md"), "utf8")).toBe("outside, edited\n");
    // Saving again with nothing new writes nothing.
    await outside.flush();
    expect(hosts.flatMap((made) => made.writes)).toEqual([]);
  });

  test("a host that cannot start saves nothing, and the room keeps its edits", async () => {
    await events.close();
    events = createProjectEventsService({
      createHost: () => Promise.reject(new Error("no watcher")),
    });
    await events.activate(project);
    await registry.stop();
    registry = createCollabRegistry({
      absRoot: dir,
      activeProjectRoot: () => project,
      projectEvents: events,
    });
    void server.stop(true);
    server = await serve<CollabSocketData>({
      fetch: (req, handle) => registry.handleRequest(req, handle) ?? new Response("ok"),
      port: 0,
      websocket: registry.websocket,
    });
    const a = await open("site/pages/a.md");
    await edit(a, "# A\n\nkept\n");
    await a.flush();
    expect(readFileSync(join(project, "pages/a.md"), "utf8")).toBe(ORIGINAL);
    expect(sourceText(a.doc).toString()).toBe("# A\n\nkept\n");
  });
});
