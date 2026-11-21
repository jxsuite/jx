/**
 * The project state host's paths the conformance suite cannot reach through a real watcher: each
 * observation is delivered by hand through a fake watcher, so the order, the races and the failures
 * are the test's to choose (`specs/project-state.md` §2.4, §5, §7, §8).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ProjectEvent, SubscribeResponse } from "@jxsuite/protocol/project-state";
import { toError } from "@jxsuite/schema/parse";
import type { JsonValue } from "@jxsuite/schema/types";
import { createProjectStateHost } from "../src/project-state/host.ts";
import type {
  ProjectStateFs,
  ProjectStateHostOptions,
  ProjectWatchEvent,
  ProjectWatchSink,
  ProjectWatcherFactory,
} from "../src/project-state/host.ts";
import type { ProjectFormats } from "../src/project-state/host-deps.ts";

type Host = Awaited<ReturnType<typeof createProjectStateHost>>;

const json = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`;

/** What `promise` rejected with; fails the test when it resolves. */
async function rejection<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return toError(error);
  }
  throw new Error("expected a rejection");
}

/** An error carrying a node error code. */
const coded = (code: string): Error => Object.assign(new Error(code), { code });

const roots: string[] = [];
const hosts: Host[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
  for (const root of roots.splice(0)) {
    await chmod(root, 0o755).catch(() => {});
    await rm(root, { force: true, recursive: true });
  }
});

async function project(files: Record<string, string>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "jx-host-gaps-"));
  roots.push(base);
  const root = join(base, "project");
  await mkdir(root, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

/** A watcher that reports only what the test tells it to. */
function fakeWatcher() {
  let sink: ProjectWatchSink | null = null;
  let root = "";
  const factory: ProjectWatcherFactory = (watched, given) => {
    sink = given;
    root = watched;
    return { close: () => Promise.resolve(), ready: Promise.resolve() };
  };
  return {
    error: (message: string) => sink?.error(new Error(message)),
    event: (type: ProjectWatchEvent, path: string) => sink?.event(type, join(root, path)),
    factory,
    outside: (type: ProjectWatchEvent) => sink?.event(type, join(root, "..", "elsewhere")),
  };
}

/** Formats that register `.md`, parsed as a page instantiating `my-card`, and fail on `.bad`. */
const markdownFormats = (): Promise<ProjectFormats> =>
  Promise.resolve({
    extensions: [".md", ".bad"],
    mounts: [],
    parse: (extension) =>
      extension === ".bad"
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve({ children: [{ tagName: "my-card" }], tagName: "article" }),
  });

async function start(
  root: string,
  options: Partial<ProjectStateHostOptions> = {},
): Promise<{ host: Host; events: ProjectEvent[] }> {
  const host = await createProjectStateHost({
    extensions: markdownFormats,
    git: false,
    installed: () => Promise.resolve(true),
    onError: () => {},
    root,
    ...options,
  });
  hosts.push(host);
  await host.idle(0);
  const events: ProjectEvent[] = [];
  host.subscribe(
    {},
    {
      events: (batch) => {
        events.push(...batch);
      },
    },
  );
  return { events, host };
}

const types = (events: readonly ProjectEvent[]): string[] => events.map((event) => event.type);

describe("the host's requests", () => {
  test("refuses a path that is not project-relative, a write over a directory and a rename", async () => {
    const root = await project({ "pages/index.json": json({ tagName: "main" }) });
    const { host } = await start(root, { watcher: fakeWatcher().factory });
    for (const path of ["", "../x.json", "a//b.json", "./a.json", String.raw`a\b.json`]) {
      const refused = await rejection(
        host.write({ baseHash: null, contents: "x", path, writeId: "w" }),
      );
      expect(refused).toBeInstanceOf(TypeError);
    }
    const overDir = await rejection(
      host.write({ baseHash: null, contents: "x", path: "pages", writeId: "w" }),
    );
    expect(overDir.message).toContain("directory");
    const renamed = await rejection(
      host.rename({ dirtyReferrers: [], from: "a", opId: "o", policy: "refuse", to: "b" }),
    );
    expect(renamed.message).toContain("rename cascade");
    expect(host.epoch.length > 0).toBe(true);
    expect(host.rev > 0).toBe(true);
    expect(host.readiness).toBe("ready");
    expect(host.root).toBe(root);
    await host.close();
    await host.close();
    // A closed host still answers, and streams nothing.
    expect(host.subscribe({}, { events: () => {} }).response.kind).toBe("snapshot");
  });

  test("refuses a path that leads out of the root through a link", async () => {
    const root = await project({ "pages/index.json": "{}\n" });
    await mkdir(join(dirname(root), "elsewhere"));
    await symlink(join(dirname(root), "elsewhere"), join(root, "out"));
    const { host } = await start(root, { watcher: fakeWatcher().factory });
    const requests: Promise<object>[] = [
      host.write({ baseHash: null, contents: "x", path: "out/new/file.json", writeId: "w" }),
      host.delete({ base: { files: {} }, path: "out", writeId: "d" }),
      host.createDirectory("out/sub", "c"),
    ];
    for (const request of requests) {
      const refused = await rejection(request);
      expect(refused.message).toContain("outside the project");
    }
  });

  test("a write outside the index scope answers the current revision and emits nothing", async () => {
    const root = await project({ "package.json": json({ dependencies: {} }) });
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    const { rev } = host;
    const built = await host.write({
      baseHash: null,
      contents: "<p>built</p>",
      path: "dist/index.html",
      writeId: "w1",
    });
    expect(built).toEqual({ hash: await contentHash("<p>built</p>"), ok: true, rev });
    const lock = await host.write({
      baseHash: null,
      contents: "{}",
      path: "bun.lock",
      writeId: "w2",
    });
    expect(lock.ok).toBe(true);
    await host.idle(0);
    // The lockfile moved the fingerprint, so readiness steps back and forward again (§7).
    expect(types(events)).toEqual([
      "readiness",
      "readiness",
      "readiness",
      "readiness",
      "readiness",
    ]);
  });

  test("a write whose target changes after its check is refused, and the disk keeps the change", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const fs: ProjectStateFs = {
      ...nodeFs,
      writeFile: async (path, data) => {
        await nodeFs.writeFile(path, data);
        if (path.includes(".jx-write-")) {
          await nodeFs.writeFile(join(root, "data/a.json"), "[9]\n");
        }
      },
    };
    const { events, host } = await start(root, { fs, watcher: fakeWatcher().factory });
    const result = await host.write({
      baseHash: await contentHash("[]\n"),
      contents: "[1]\n",
      path: "data/a.json",
      writeId: "late",
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.conflict.diskHash).toBe(await contentHash("[9]\n"));
    expect(types(events)).toEqual(["conflict"]);
    expect(await nodeFs.readdir(join(root, "data"))).toEqual(["a.json"]);
  });

  test("a delete forgets the pending writes beneath it", async () => {
    const root = await project({ "drafts/a.json": "[]\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    const write = await host.write({
      baseHash: await contentHash("[]\n"),
      contents: "[1]\n",
      path: "drafts/a.json",
      writeId: "w",
    });
    expect(write.ok).toBe(true);
    const removed = await host.delete({
      base: { files: { "a.json": await contentHash("[1]\n") } },
      path: "drafts",
      writeId: "d",
    });
    expect(removed.ok).toBe(true);
    // The write's echo arrives after the delete: nothing is there, so nothing is reported.
    watcher.event("change", "drafts/a.json");
    watcher.event("unlinkDir", "drafts");
    await host.idle(0);
    expect(types(events)).toEqual(["fileChanged", "docChanged", "fileRemoved"]);
  });

  test("an unreported file can still be written and deleted", async () => {
    const root = await project({ "pages/index.json": json({ tagName: "main" }) });
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    await writeFile(join(root, "pages/late.json"), "{}\n");
    const removed = await host.delete({
      base: { hash: await contentHash("{}\n") },
      path: "pages/late.json",
      writeId: "d",
    });
    expect(removed).toEqual({ ok: true, rev: host.rev });
    const outside = await host.delete({
      base: { files: {} },
      path: "dist",
      writeId: "d2",
    });
    expect(outside.ok).toBe(false);
    expect(types(events)).toEqual(["conflict"]);
  });
});

describe("the host's failures", () => {
  test("reports through console.error without onError, and survives a failing sink and resolver", async () => {
    const root = await project({ "project.json": json({ name: "x" }) });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const host = await createProjectStateHost({
        collections: () => Promise.reject(new Error("no loader")),
        extensions: () => Promise.reject(new Error("no extensions")),
        git: false,
        installed: () => Promise.resolve(true),
        root,
        watcher: fakeWatcher().factory,
      });
      hosts.push(host);
      await host.idle(0);
      host.subscribe(
        {},
        {
          end: () => {
            throw new Error("end failed");
          },
          events: () => {
            throw new Error("sink failed");
          },
        },
      );
      await host.write({
        baseHash: await contentHash(json({ name: "x" })),
        contents: json({ name: "y" }),
        path: "project.json",
        writeId: "w",
      });
      await host.close();
      const messages = logged.mock.calls.map((call) => String(call[0]));
      for (const expected of ["no extensions", "no loader", "sink failed", "end failed"]) {
        expect(messages.some((message) => message.includes(expected))).toBe(true);
      }
    } finally {
      logged.mockRestore();
    }
  });

  test("a failing readiness step is reported, and the host stays where it was", async () => {
    const root = await project({});
    const errors: string[] = [];
    const { host } = await start(root, {
      installed: () => Promise.reject(new Error("check failed")),
      onError: (error) => errors.push(error.message),
      watcher: fakeWatcher().factory,
    });
    expect([host.readiness, errors]).toEqual(["scaffolded", ["check failed"]]);
  });

  test("a watcher error degrades the host once, until a restart", async () => {
    const root = await project({ "pages/index.json": json({ tagName: "main" }) });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    watcher.error("watch limit");
    watcher.error("again");
    expect(events.filter((event) => event.type === "watcherDegraded")).toHaveLength(1);
    const { epoch } = host;
    await host.restart();
    expect(host.epoch === epoch).toBe(false);
  });

  test("a root whose real path cannot be read indexes nothing", async () => {
    const root = await project({ "pages/index.json": "{}\n" });
    const fs: ProjectStateFs = { ...nodeFs, realpath: () => Promise.reject(new Error("no")) };
    const { host } = await start(root, { fs, watcher: fakeWatcher().factory });
    expect(host.snapshot().files).toEqual([]);
  });

  test("an unreadable directory and a link back into the tree are scanned once", async () => {
    const root = await project({ "locked/a.json": "{}\n", "pages/index.json": "{}\n" });
    await symlink(root, join(root, "pages/loop"));
    // Refused by the injected fs rather than by `chmod`, which neither root nor Windows honours.
    const fs: ProjectStateFs = {
      ...nodeFs,
      readdir: (path) =>
        path.endsWith("locked") ? Promise.reject(coded("EACCES")) : nodeFs.readdir(path),
    };
    const { host } = await start(root, { fs, watcher: fakeWatcher().factory });
    const paths = host.snapshot().files.map((file) => file.path);
    expect(paths.includes("pages/index.json")).toBe(true);
    expect(paths.includes("locked/a.json")).toBe(false);
    expect(paths.some((path) => path.startsWith("pages/loop/pages/loop"))).toBe(false);
  });
});

describe("classification and the graph", () => {
  test("a registered format is other until extensions resolve; unreadable documents stay unindexed", async () => {
    const root = await project({
      "content/a.md": "# A\n",
      "content/b.bad": "?",
      "data/broken.json": "{",
      "notes.txt": "hello\n",
      "pages/home.jxn": 'main {\n  textContent: "Home"\n}\n',
      "project.json": "{",
    });
    const { events, host } = await start(root, { hold: true, watcher: fakeWatcher().factory });
    const before = new Map(host.snapshot().files.map((file) => [file.path, file]));
    expect(before.get("content/a.md")?.kind).toBe("other");
    await host.release();
    await host.idle(0);
    const after = new Map(host.snapshot().files.map((file) => [file.path, file]));
    expect([after.get("content/a.md")?.kind, after.get("content/a.md")?.indexed]).toEqual([
      "content",
      true,
    ]);
    expect(after.get("content/b.bad")?.indexed).toBe(false);
    expect(after.get("data/broken.json")?.indexed).toBe(false);
    expect(after.get("notes.txt")?.kind).toBe("other");
    expect(after.get("pages/home.jxn")?.kind).toBe("page");
    expect(after.get("project.json")?.indexed).toBe(false);
    expect(events.filter((event) => event.type === "docChanged")).toHaveLength(6);
  });

  test("a change seen below indexed is reported, and refined once the host indexes", async () => {
    const root = await project({ "content/a.md": "# A\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { hold: true, watcher: watcher.factory });
    await writeFile(join(root, "content/a.md"), "# Changed\n");
    watcher.event("change", "content/a.md");
    await host.idle(0);
    expect(types(events)).toEqual(["fileChanged", "docChanged"]);
    await host.release();
    expect(types(events).filter((type) => type === "docChanged")).toHaveLength(2);
  });

  test("an entry joining a content type invalidates the type's readers", async () => {
    const root = await project({
      "content/blog/first.md": "# First\n",
      "pages/blog.json": json({
        state: { posts: { $prototype: "ContentCollection", contentType: "blog" } },
        tagName: "main",
      }),
      "project.json": json({ content: { blog: { source: "./content/blog/" } } }),
    });
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    const blog = host.snapshot().files.find((file) => file.path === "pages/blog.json")!;
    await host.write({
      baseHash: null,
      contents: "# Second\n",
      path: "content/blog/second.md",
      writeId: "w",
    });
    const invalidated = events.filter((event) => event.type === "dependentsInvalidated");
    expect(invalidated.map((event) => [event.cause.kind, event.docIds])).toEqual([
      ["content-collection", [blog.docId]],
    ]);
    // The entry leaves with its removal, and the readers hear of it once more.
    await host.delete({
      base: { hash: await contentHash("# Second\n") },
      path: "content/blog/second.md",
      writeId: "d",
    });
    expect(events.filter((event) => event.type === "dependentsInvalidated")).toHaveLength(2);
  });

  test("removing the configuration forgets it", async () => {
    const config = json({ build: { outDir: 5 }, name: "x" });
    const root = await project({
      "pages/index.json": json({ tagName: "main" }),
      "project.json": config,
    });
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    await host.delete({
      base: { hash: await contentHash(config) },
      path: "project.json",
      writeId: "d",
    });
    expect(types(events)[0]).toBe("fileRemoved");
    expect(events.some((event) => event.type === "dependentsInvalidated")).toBe(true);
  });

  test("moving the build output reconciles the index scope", async () => {
    const config = json({ build: { outDir: "./out" } });
    const root = await project({ "out/a.html": "a", "project.json": config, "site/b.html": "b" });
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    await host.write({
      baseHash: await contentHash(config),
      contents: json({ build: { outDir: "." } }),
      path: "project.json",
      writeId: "w1",
    });
    const paths = (): string[] => host.snapshot().files.map((file) => file.path);
    expect(paths().includes("out/a.html")).toBe(true);
    await host.write({
      baseHash: await contentHash(json({ build: { outDir: "." } })),
      contents: json({ build: { outDir: "./site/" } }),
      path: "project.json",
      writeId: "w2",
    });
    expect(paths().includes("site/b.html")).toBe(false);
    expect(paths().includes("out/a.html")).toBe(true);
    expect(events.some((event) => event.type === "fileRemoved" && event.path === "site")).toBe(
      true,
    );
  });
});

describe("observations", () => {
  test("directories come and go, and a file can replace one", async () => {
    const root = await project({ "pages/index.json": "{}\n", "x/inner.json": "{}\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    await mkdir(join(root, "fresh"));
    watcher.event("addDir", "fresh");
    watcher.event("addDir", "gone");
    watcher.event("change", "fresh");
    watcher.event("change", "missing.json");
    watcher.outside("change");
    await host.idle(0);
    await rm(join(root, "x"), { recursive: true });
    await writeFile(join(root, "x"), "now a file\n");
    watcher.event("add", "x");
    await rm(join(root, "fresh"), { recursive: true });
    watcher.event("unlinkDir", "fresh");
    watcher.event("unlink", "never-indexed.json");
    await host.idle(0);
    expect(
      events
        .filter((event) => event.type.startsWith("file"))
        .map((event) => [event.type, "path" in event ? event.path : ""]),
    ).toEqual([
      ["fileAdded", "fresh"],
      ["fileRemoved", "x"],
      ["fileAdded", "x"],
      ["fileRemoved", "fresh"],
    ]);
  });

  test.skipIf(process.platform === "win32")("a FIFO is not a document", async () => {
    const root = await project({});
    const { events, host } = await start(root, { watcher: fakeWatcher().factory });
    const made = spawnSync("mkfifo", [join(root, "pipe")]);
    expect(made.status).toBe(0);
    await host.restart();
    expect(host.snapshot().files).toEqual([]);
    expect(events).toEqual([]);
  });

  test("an echo after a touch refreshes the recorded size and time", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    await host.write({
      baseHash: await contentHash("[]\n"),
      contents: "[1]\n",
      path: "data/a.json",
      writeId: "w",
    });
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "data/a.json"), later, later);
    watcher.event("change", "data/a.json");
    watcher.event("change", "data/a.json");
    await host.idle(0);
    expect(types(events)).toEqual(["fileChanged", "docChanged"]);
  });

  test("a held removal becomes one directory removal, or a change when the file came back", async () => {
    const root = await project({ "a/b/c.json": "{}\n", "keep.json": "[]\n", "same.json": "{}\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, {
      atomicSaveMs: 1,
      stabilityMs: 0,
      watcher: watcher.factory,
    });
    await rm(join(root, "a"), { recursive: true });
    watcher.event("unlink", "a/b/c.json");
    watcher.event("unlink", "a/b/c.json");
    // Reported removed, but on disk again with new bytes; and one back with the same bytes.
    await writeFile(join(root, "keep.json"), "[2]\n");
    watcher.event("unlink", "keep.json");
    watcher.event("unlink", "same.json");
    await host.idle(150);
    expect(
      events
        .filter((event) => event.type.startsWith("file"))
        .map((event) => [event.type, "path" in event ? event.path : ""]),
    ).toEqual([
      ["fileRemoved", "a"],
      ["fileChanged", "keep.json"],
    ]);
  });

  test("a move whose add arrives first keeps its id, and a move into layouts reclassifies", async () => {
    const page = json({ tagName: "main" });
    const root = await project({
      "pages/moved.json": page,
      "pages/other.json": json({ $layout: "../layouts/base.json", tagName: "main" }),
    });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    const before = host.snapshot().files.find((file) => file.path === "pages/moved.json")!;
    await mkdir(join(root, "layouts"));
    await rename(join(root, "pages/moved.json"), join(root, "layouts/base.json"));
    watcher.event("add", "layouts/base.json");
    watcher.event("unlink", "pages/moved.json");
    await host.idle(0);
    const renamed = events.find((event) => event.type === "fileRenamed");
    expect(renamed?.type === "fileRenamed" ? [renamed.docId, renamed.to] : null).toEqual([
      before.docId,
      "layouts/base.json",
    ]);
    const changed = events.find((event) => event.type === "docChanged");
    expect(changed?.type === "docChanged" ? changed.kind : null).toBe("layout");
    expect(events.some((event) => event.type === "dependentsInvalidated")).toBe(true);
  });

  test("a read that fails after its stat reports nothing", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const watcher = fakeWatcher();
    let failReads = false;
    const fs: ProjectStateFs = {
      ...nodeFs,
      readFile: (path) => (failReads ? Promise.reject(coded("ENOENT")) : nodeFs.readFile(path)),
    };
    const { events, host } = await start(root, { fs, watcher: watcher.factory });
    await writeFile(join(root, "data/a.json"), "[3]\n");
    failReads = true;
    watcher.event("change", "data/a.json");
    await host.idle(0);
    expect(events).toEqual([]);
  });
});

describe("readiness inputs", () => {
  test("nothing installed: the host waits at scaffolded and re-checks on a manifest change", async () => {
    const root = await project({ "package.json": json({ dependencies: { missing: "1.0.0" } }) });
    let installed = false;
    const { events, host } = await start(root, {
      installed: () => Promise.resolve(installed),
      watcher: fakeWatcher().factory,
    });
    expect(host.readiness).toBe("scaffolded");
    installed = true;
    await host.write({
      baseHash: await contentHash(json({ dependencies: { missing: "1.0.0" } })),
      contents: "{",
      path: "package.json",
      writeId: "w",
    });
    await host.idle(0);
    expect(host.readiness).toBe("ready");
    expect(types(events).filter((type) => type === "readiness")).toHaveLength(4);
  });

  test("an install defers what the watcher reports meanwhile, and records a removed lockfile", async () => {
    const root = await project({ "package-lock.json": "{}\n", "package.json": json({}) });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, {
      installer: async (at) => {
        await rm(join(at, "package-lock.json"));
        await writeFile(join(at, "bun.lock"), "{}\n");
        watcher.event("unlink", "package-lock.json");
        watcher.event("add", "bun.lock");
      },
      watcher: watcher.factory,
    });
    await host.install();
    await host.idle(200);
    const removed = events.find((event) => event.type === "fileRemoved");
    expect(removed?.origin === "external").toBe(false);
    expect(types(events).includes("readiness")).toBe(false);
    watcher.event("change", "bun.lock");
    await host.idle(0);
    expect(types(events).includes("readiness")).toBe(false);
  });

  test("a failed install rejects, its writes are external, and the fingerprint is checked", async () => {
    const root = await project({ "package.json": json({}) });
    const { events, host } = await start(root, {
      installer: async (at) => {
        await writeFile(join(at, "package-lock.json"), "{}\n");
        throw new Error("network");
      },
      watcher: fakeWatcher().factory,
    });
    const failed = await rejection(host.install());
    expect(failed.message).toBe("network");
    const added = events.find((event) => event.type === "fileAdded");
    expect(added?.origin).toBe("external");
    expect(types(events).includes("readiness")).toBe(true);
  });

  test("the git monitor takes the runner, watch and debounce it is given", async () => {
    const root = await project({});
    const calls: string[][] = [];
    const { host } = await start(root, {
      git: (args) => {
        calls.push(args);
        return Promise.reject(new Error("not a repository"));
      },
      gitDebounceMs: 5,
      gitWatch: () => ({ close: () => Promise.resolve(), ready: Promise.resolve() }),
      watcher: fakeWatcher().factory,
    });
    expect(calls[0]?.[0]).toBe("rev-parse");
    expect(host.snapshot().git).toBeUndefined();
  });
});

describe("observations below indexed and around the hold", () => {
  test("a removal, a move and a vanished file before the graph is built", async () => {
    const root = await project({
      "data/a.json": "[1]\n",
      "data/b.json": "[2]\n",
      "data/c.json": "[3]\n",
    });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, {
      atomicSaveMs: 1,
      hold: true,
      stabilityMs: 0,
      watcher: watcher.factory,
    });
    // Hashed by a change, so a later add with the same bytes can be paired with it.
    await writeFile(join(root, "data/a.json"), "[10]\n");
    watcher.event("change", "data/a.json");
    await host.idle(0);
    // The removal is reported first and held; the add then finds it held (§2.4).
    await rename(join(root, "data/a.json"), join(root, "data/moved.json"));
    watcher.event("unlink", "data/a.json");
    watcher.event("add", "data/moved.json");
    await host.delete({
      base: { hash: await contentHash("[2]\n") },
      path: "data/b.json",
      writeId: "d",
    });
    await rm(join(root, "data/c.json"));
    await host.release();
    await host.idle(100);
    expect(types(events).filter((type) => type.startsWith("file"))).toEqual([
      "fileChanged",
      "fileRenamed",
      "fileRemoved",
    ]);
    expect(
      host.snapshot().files.some((file) => file.path === "data/c.json" && file.hash === undefined),
    ).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "a hold cancelled while its timer was queued, a FIFO and a link out of the root",
    async () => {
      const root = await project({ "data/a.json": "[]\n" });
      const outside = join(dirname(root), "outside.json");
      await writeFile(outside, "{}\n");
      const watcher = fakeWatcher();
      let slow = false;
      const fs: ProjectStateFs = {
        ...nodeFs,
        readFile: async (path) => {
          if (slow && path.endsWith("a.json")) {
            await new Promise((resolve) => {
              setTimeout(resolve, 120);
            });
          }
          return nodeFs.readFile(path);
        },
      };
      const { events, host } = await start(root, {
        atomicSaveMs: 1,
        fs,
        stabilityMs: 0,
        watcher: watcher.factory,
      });
      await writeFile(join(root, "data/a.json"), "[5]\n");
      slow = true;
      watcher.event("unlink", "data/a.json");
      watcher.event("add", "data/a.json");
      spawnSync("mkfifo", [join(root, "pipe")]);
      watcher.event("add", "pipe");
      await symlink(outside, join(root, "escape.json"));
      watcher.event("add", "escape.json");
      await host.idle(200);
      expect(types(events)).toEqual(["fileChanged", "docChanged"]);
    },
  );

  test("a change reported for a directory adds the directory", async () => {
    const root = await project({});
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    await mkdir(join(root, "made"));
    watcher.event("change", "made");
    await host.idle(0);
    expect(events.map((event) => [event.type, "path" in event ? event.path : ""])).toEqual([
      ["fileAdded", "made"],
    ]);
  });

  test("an observation queued before close is dropped", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    await writeFile(join(root, "data/a.json"), "[1]\n");
    watcher.event("change", "data/a.json");
    await host.close();
    expect(events).toEqual([]);
  });
});

describe("restarting under a subscriber", () => {
  test("a subscribe during a restart is answered from the old epoch and ended, and one from end() is whole", async () => {
    const root = await project({ "pages/index.json": json({ tagName: "main" }) });
    const sinks: ProjectWatchSink[] = [];
    let release = (): void => {};
    let asked = (): void => {};
    const askedReady = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delay = false;
    const factory: ProjectWatcherFactory = (_root, sink) => {
      sinks.push(sink);
      if (delay) {
        asked();
      }
      return { close: () => Promise.resolve(), ready: delay ? released : Promise.resolve() };
    };
    const { host } = await start(root, { watcher: factory });
    const old = host.epoch;
    const reopened: SubscribeResponse[] = [];
    let reopenedEnds = 0;
    host.subscribe(
      {},
      {
        end: () => {
          // A client resubscribes because its subscription ended, from inside end().
          reopened.push(
            host.subscribe(
              {},
              {
                end: () => {
                  reopenedEnds += 1;
                },
                events: () => {},
              },
            ).response,
          );
        },
        events: () => {},
      },
    );
    delay = true;
    const restarting = host.restart();
    await askedReady;
    // The new watcher fails before the swap; its degradation is the new epoch's.
    sinks[1]!.error(new Error("watch limit"));
    const midEvents: ProjectEvent[] = [];
    let midEnds = 0;
    const mid = host.subscribe(
      {},
      {
        end: () => {
          midEnds += 1;
        },
        events: (batch) => midEvents.push(...batch),
      },
    );
    expect(mid.response.epoch).toBe(old);
    release();
    await restarting;
    await host.idle(0);
    expect([midEnds, midEvents.length]).toEqual([1, 0]);
    expect(reopened).toHaveLength(1);
    const [fresh] = reopened;
    expect(fresh?.epoch).toBe(host.epoch);
    expect(fresh?.epoch === old).toBe(false);
    const files = fresh?.kind === "snapshot" ? fresh.snapshot.files.map((file) => file.path) : [];
    expect(files).toEqual(["pages", "pages/index.json"]);
    expect(reopenedEnds).toBe(0);
    // The old watcher, closed by the restart, can no longer degrade anything.
    sinks[0]!.error(new Error("stale"));
    const after: ProjectEvent[] = [];
    const answered = host.subscribe({ epoch: host.epoch, sinceRev: 0 }, { events: () => {} });
    if (answered.response.kind === "events") {
      after.push(...answered.response.events);
    }
    expect(after.filter((event) => event.type === "watcherDegraded")).toHaveLength(1);
  });
});

describe("observations the pairing must not merge", () => {
  test("a file replaced by a directory within the bound indexes the directory", async () => {
    const root = await project({ a: "a file\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, {
      atomicSaveMs: 1,
      stabilityMs: 0,
      watcher: watcher.factory,
    });
    await rm(join(root, "a"));
    await mkdir(join(root, "a"));
    watcher.event("unlink", "a");
    watcher.event("addDir", "a");
    await host.idle(100);
    expect(host.snapshot().files.map((file) => [file.path, file.isDir])).toEqual([["a", true]]);
    expect(
      events
        .filter((event) => event.type.startsWith("file"))
        .map((event) => [event.type, "isDir" in event ? event.isDir : null]),
    ).toEqual([
      ["fileRemoved", false],
      ["fileAdded", true],
    ]);
  });

  test("moving the configuration away and back moves the configuration, never pairs it", async () => {
    const config = json({ build: { outDir: "out" } });
    const root = await project({ "out/a.json": "{}\n", "project.json": config });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, {
      atomicSaveMs: 1,
      stabilityMs: 0,
      watcher: watcher.factory,
    });
    const paths = (): string[] => host.snapshot().files.map((file) => file.path);
    expect(paths().includes("out/a.json")).toBe(false);
    await rename(join(root, "project.json"), join(root, "old.json"));
    watcher.event("unlink", "project.json");
    watcher.event("add", "old.json");
    await host.idle(100);
    expect(types(events).includes("fileRenamed")).toBe(false);
    expect(paths().includes("out/a.json")).toBe(true);
    await rename(join(root, "old.json"), join(root, "project.json"));
    watcher.event("unlink", "old.json");
    watcher.event("add", "project.json");
    await host.idle(100);
    expect(types(events).includes("fileRenamed")).toBe(false);
    expect(types(events).includes("projectConfigChanged")).toBe(true);
    expect(paths().includes("out/a.json")).toBe(false);
  });
});

describe("the echo ledger and the recorded size and time", () => {
  test("a write outside the scope is indexed once the scope takes it in", async () => {
    const config = json({ build: { outDir: "build" } });
    const root = await project({ "project.json": config });
    const { host } = await start(root, { watcher: fakeWatcher().factory });
    await host.write({ baseHash: null, contents: "{}\n", path: "build/x.json", writeId: "w1" });
    await host.write({
      baseHash: await contentHash(config),
      contents: json({ build: { outDir: "out" } }),
      path: "project.json",
      writeId: "w2",
    });
    expect(host.snapshot().files.map((file) => file.path)).toContain("build/x.json");
  });

  test("a tree removed with its writes unobserved is indexed again when it comes back", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const watcher = fakeWatcher();
    const { events, host } = await start(root, { watcher: watcher.factory });
    await host.write({
      baseHash: await contentHash("[]\n"),
      contents: "[1]\n",
      path: "data/a.json",
      writeId: "w",
    });
    await rm(join(root, "data"), { recursive: true });
    watcher.event("unlinkDir", "data");
    await host.idle(0);
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data/a.json"), "[1]\n");
    watcher.event("add", "data/a.json");
    await host.idle(0);
    expect(host.snapshot().files.map((file) => file.path)).toEqual(["data", "data/a.json"]);
    expect(types(events).filter((type) => type === "fileAdded")).toHaveLength(2);
  });

  test("a size and time recorded within a tick are not trusted; older ones skip the read", async () => {
    const root = await project({ "data/a.json": '{"a":1}\n' });
    const watcher = fakeWatcher();
    let reads = 0;
    const fs: ProjectStateFs = {
      ...nodeFs,
      readFile: (path) => {
        reads += 1;
        return nodeFs.readFile(path);
      },
    };
    const { events, host } = await start(root, { fs, watcher: watcher.factory });
    const target = join(root, "data/a.json");
    await host.write({
      baseHash: await contentHash('{"a":1}\n'),
      contents: '{"a":2}\n',
      path: "data/a.json",
      writeId: "w",
    });
    const written = await nodeFs.stat(target);
    // Same size, same time: an edit in the write's own tick.
    await writeFile(target, '{"a":3}\n');
    await utimes(target, written.atime, written.mtime);
    watcher.event("change", "data/a.json");
    await host.idle(0);
    expect(types(events).filter((type) => type === "fileChanged")).toHaveLength(2);
    // And an external edit in the tick of the one just observed.
    const observed = await nodeFs.stat(target);
    await writeFile(target, '{"a":4}\n');
    await utimes(target, observed.atime, observed.mtime);
    watcher.event("change", "data/a.json");
    await host.idle(0);
    expect(types(events).filter((type) => type === "fileChanged")).toHaveLength(3);
    // Older than any tick: recorded at the next read, and trusted after it.
    const old = new Date(Date.now() - 60_000);
    await utimes(target, old, old);
    watcher.event("change", "data/a.json");
    await host.idle(0);
    const before = reads;
    watcher.event("change", "data/a.json");
    await host.idle(0);
    expect(reads).toBe(before);
    expect(types(events).filter((type) => type === "fileChanged")).toHaveLength(3);
  });
});

describe("writes that fail, and what they write through", () => {
  test("a failed rename leaves no temporary file and no pending echo", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const watcher = fakeWatcher();
    let failures = 1;
    const fs: ProjectStateFs = {
      ...nodeFs,
      rename: (from, to) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(coded("EPERM"));
        }
        return nodeFs.rename(from, to);
      },
    };
    const { events, host } = await start(root, { fs, renameRetryMs: [], watcher: watcher.factory });
    const failed = await rejection(
      host.write({
        baseHash: await contentHash("[]\n"),
        contents: '{"x":1}\n',
        path: "data/a.json",
        writeId: "w",
      }),
    );
    expect(failed.message).toBe("EPERM");
    expect(await nodeFs.readdir(join(root, "data"))).toEqual(["a.json"]);
    // The author then saves the same bytes: that is their change, not the failed write's echo.
    await writeFile(join(root, "data/a.json"), '{"x":1}\n');
    watcher.event("change", "data/a.json");
    await host.idle(0);
    const file = host.snapshot().files.find((entry) => entry.path === "data/a.json");
    expect(file?.hash).toBe(await contentHash('{"x":1}\n'));
    expect(types(events)).toEqual(["fileChanged", "docChanged"]);
  });

  test("a rename a held file refuses is retried, and any other failure is not", async () => {
    const root = await project({ "data/a.json": "[]\n" });
    const failures = [coded("EBUSY"), coded("ENOSPC")];
    const fs: ProjectStateFs = {
      ...nodeFs,
      rename: (from, to) => {
        const failure = failures.shift();
        return failure === undefined ? nodeFs.rename(from, to) : Promise.reject(failure);
      },
    };
    const { host } = await start(root, {
      fs,
      renameRetryMs: [1, 1],
      watcher: fakeWatcher().factory,
    });
    const failed = await rejection(
      host.write({
        baseHash: await contentHash("[]\n"),
        contents: "[1]\n",
        path: "data/a.json",
        writeId: "w1",
      }),
    );
    expect(failed.message).toBe("ENOSPC");
    failures.push(coded("EPERM"));
    const written = await host.write({
      baseHash: await contentHash("[]\n"),
      contents: "[2]\n",
      path: "data/a.json",
      writeId: "w2",
    });
    expect(written.ok).toBe(true);
    expect(await nodeFs.readFile(join(root, "data/a.json"), "utf8")).toBe("[2]\n");
  });

  test.skipIf(process.platform === "win32")(
    "a write through a link inside the root writes its target and keeps the link and the mode",
    async () => {
      const root = await project({ "shared/x.json": "{}\n" });
      await chmod(join(root, "shared/x.json"), 0o600);
      await mkdir(join(root, "pages"));
      await symlink(join(root, "shared/x.json"), join(root, "pages/x.json"));
      const { host } = await start(root, { watcher: fakeWatcher().factory });
      const written = await host.write({
        baseHash: await contentHash("{}\n"),
        contents: "[1]\n",
        path: "pages/x.json",
        writeId: "w",
      });
      expect(written.ok).toBe(true);
      const link = await nodeFs.lstat(join(root, "pages/x.json"));
      expect(link.isSymbolicLink()).toBe(true);
      expect(await nodeFs.readFile(join(root, "shared/x.json"), "utf8")).toBe("[1]\n");
      const shared = await nodeFs.stat(join(root, "shared/x.json"));
      expect(shared.mode % 0o1000).toBe(0o600);
      expect(await nodeFs.readdir(join(root, "shared"))).toEqual(["x.json"]);
    },
  );
});

describe("files the host cannot read whole", () => {
  test("media, stylesheets and files over the read limit are hashed as a stream", async () => {
    const big = "x".repeat(2.5 * 1024 * 1024);
    const config = json({ name: "large" });
    const root = await project({
      "data/big.json": json({ big: true }),
      "project.json": config,
      "public/logo.png": big,
      "styles/site.css": "body {}\n",
    });
    const { host } = await start(root, { readLimitBytes: 8, watcher: fakeWatcher().factory });
    const files = new Map(host.snapshot().files.map((file) => [file.path, file]));
    expect(files.get("public/logo.png")?.hash).toBe(await contentHash(big));
    expect(files.get("public/logo.png")?.kind).toBe("media");
    expect(files.get("styles/site.css")?.kind).toBe("style");
    expect([files.get("data/big.json")?.kind, files.get("data/big.json")?.indexed]).toEqual([
      "data",
      false,
    ]);
    expect(files.get("data/big.json")?.hash).toBe(await contentHash(json({ big: true })));
    expect([files.get("project.json")?.kind, files.get("project.json")?.indexed]).toEqual([
      "project-config",
      false,
    ]);
  });

  test("a file that exists but cannot be read stays unhashed, and a write or delete over it is refused", async () => {
    const root = await project({ "data/locked.json": "[]\n", "project.json": json({ name: "x" }) });
    const locked = (path: string): boolean =>
      path.endsWith("locked.json") || path.endsWith("project.json");
    const fs: ProjectStateFs = {
      ...nodeFs,
      open: (path) => (locked(path) ? Promise.reject(coded("EACCES")) : nodeFs.open(path)),
      readFile: (path) => (locked(path) ? Promise.reject(coded("EACCES")) : nodeFs.readFile(path)),
    };
    const errors: string[] = [];
    const { host } = await start(root, {
      fs,
      onError: (error) => errors.push(error.message),
      watcher: fakeWatcher().factory,
    });
    const file = host.snapshot().files.find((entry) => entry.path === "data/locked.json");
    expect([file?.hash, file?.indexed]).toEqual([undefined, false]);
    expect(errors.includes("EACCES")).toBe(true);
    const write = await rejection(
      host.write({ baseHash: null, contents: "[1]\n", path: "data/locked.json", writeId: "w" }),
    );
    expect(write.message).toBe("EACCES");
    const removed = await rejection(
      host.delete({
        base: { hash: await contentHash("[]\n") },
        path: "data/locked.json",
        writeId: "d",
      }),
    );
    expect(removed.message).toBe("EACCES");
    expect(await nodeFs.readFile(join(root, "data/locked.json"), "utf8")).toBe("[]\n");
  });
});
