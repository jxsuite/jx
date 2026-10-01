import { installMockPlatform, resetStudioState } from "./harness";
import { describe, expect, mock, test } from "bun:test";
import {
  applyFsEvents,
  cleanOpenTabPaths,
  isRecentLocal,
  markLocalMutation,
  relistLoadedDirs,
  startFsSync,
} from "../src/files/fs-events";
import { ensureIgnoreLayers, isIgnoredEntry } from "../src/files/gitignore";
import { invalidateUsages, loadUsages } from "../src/services/references";
import { registerCollabPath, unregisterCollabPath } from "../src/collab/collab-state";
import { getPlatform } from "../src/platform";
import { projectState, setProjectState } from "../src/store";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import type { DirEntry, FsEvent } from "../src/types";

const entry = (path: string, type: "file" | "directory" = "file"): DirEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  type,
});

const sleep = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

describe("applyFsEvents", () => {
  test("adds new files to a loaded parent and dedupes echoes", () => {
    const dirs = new Map<string, DirEntry[]>([["pages", [entry("pages/a.json")]]]);
    const changed = applyFsEvents(dirs, new Set(), [
      { isDir: false, path: "pages/b.json", type: "add" },
      { isDir: false, path: "pages/a.json", type: "add" },
    ]);
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual(["pages/a.json", "pages/b.json"]);
    expect([...changed]).toEqual(["pages"]);
  });

  test("ignores adds for an unloaded parent", () => {
    const dirs = new Map<string, DirEntry[]>();
    const changed = applyFsEvents(dirs, new Set(), [
      { isDir: false, path: "pages/x.json", type: "add" },
    ]);
    expect(changed.size).toBe(0);
    expect(dirs.has("pages")).toBe(false);
  });

  test("addDir splices into the loaded parent and seeds an empty list", () => {
    const dirs = new Map<string, DirEntry[]>([[".", [entry("pages", "directory")]]]);
    applyFsEvents(dirs, new Set(), [{ isDir: true, path: "widgets", type: "addDir" }]);
    expect(dirs.get(".")?.some((e) => e.path === "widgets")).toBe(true);
    expect(dirs.get("widgets")).toEqual([]);
  });

  test("unlink removes a tree entry", () => {
    const dirs = new Map<string, DirEntry[]>([
      ["pages", [entry("pages/a.json"), entry("pages/b.json")]],
    ]);
    const changed = applyFsEvents(dirs, new Set(), [
      { isDir: false, path: "pages/a.json", type: "unlink" },
    ]);
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual(["pages/b.json"]);
    expect([...changed]).toEqual(["pages"]);
  });

  test("unlinkDir prunes nested dirs and expanded keys", () => {
    const dirs = new Map<string, DirEntry[]>([
      [".", [entry("sub", "directory")]],
      ["sub", [entry("sub/x.json")]],
      ["sub/deep", [entry("sub/deep/y.json")]],
    ]);
    const expanded = new Set(["sub", "sub/deep"]);
    applyFsEvents(dirs, expanded, [{ isDir: true, path: "sub", type: "unlinkDir" }]);
    expect(dirs.has("sub")).toBe(false);
    expect(dirs.has("sub/deep")).toBe(false);
    expect(dirs.get(".")?.some((e) => e.path === "sub")).toBe(false);
    expect(expanded.size).toBe(0);
  });

  test("change events touch no tree state", () => {
    const dirs = new Map<string, DirEntry[]>([["pages", [entry("pages/a.json")]]]);
    const changed = applyFsEvents(dirs, new Set(), [
      { isDir: false, path: "pages/a.json", type: "change" },
    ]);
    expect(changed.size).toBe(0);
    expect(dirs.get("pages")).toHaveLength(1);
  });
});

describe("markLocalMutation / isRecentLocal", () => {
  test("marks and detects recently mutated paths", () => {
    markLocalMutation("mark/x.json", "mark/y.json");
    expect(isRecentLocal("mark/x.json")).toBe(true);
    expect(isRecentLocal("mark/y.json")).toBe(true);
    expect(isRecentLocal("mark/z.json")).toBe(false);
  });
});

describe("startFsSync", () => {
  test("is a no-op when the platform has no watcher", () => {
    installMockPlatform();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    expect(typeof stop).toBe("function");
    stop();
  });

  test("debounces a burst into one render and reloads on content change", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map([["burst", [entry("burst/a.json")]]]), expanded: new Set() });
    const renders: number[] = [];
    const changed: string[] = [];
    const stop = startFsSync({
      onContentChange: (p) => changed.push(p),
      renderLeftPanel: () => renders.push(1),
    });
    handler([{ isDir: false, path: "burst/b.json", type: "add" }]);
    handler([{ isDir: false, path: "burst/a.json", type: "change" }]);
    await sleep(70);
    expect(renders).toHaveLength(1);
    expect(changed).toEqual(["burst/a.json"]);
    stop();
  });

  test("drops the usage cache on any event, including the ones the tree suppresses", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    const findReferences = mock(async () => ({
      errors: [],
      files: [],
      filesReferencing: 0,
      path: "a.json",
      refsTotal: 0,
      tagName: null,
    }));
    installMockPlatform({
      findReferences: findReferences as never,
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    invalidateUsages();
    const stop = startFsSync({ renderLeftPanel: () => {} });

    await loadUsages({ path: "a.json" });
    await loadUsages({ path: "a.json" });
    expect(findReferences).toHaveBeenCalledTimes(1);

    // A LOCAL mutation: the tree ignores its echo (it already repainted), but the reference count
    // Must not — Studio's own write changes who refers to what as much as anyone else's.
    markLocalMutation("a.json");
    handler([{ isDir: false, path: "a.json", type: "change" }]);
    await loadUsages({ path: "a.json" });
    expect(findReferences).toHaveBeenCalledTimes(2);
    stop();
  });

  test("drops the derived caches on every event, echoes included", () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    let drops = 0;
    const stop = startFsSync({
      invalidateDerivedCaches: () => {
        drops += 1;
      },
      renderLeftPanel: () => {},
    });

    // Same argument as the usage counts above, and the same placement — BEFORE the echo filter.
    // The page-route list, the layout picker and the `$paths` enumerations are all derived from
    // Which files exist, and Studio's own write changes that as much as anyone else's does.
    markLocalMutation("pages/new.md");
    handler([{ isDir: false, path: "pages/new.md", type: "add" }]);
    expect(drops).toBe(1);

    handler([{ isDir: false, path: "layouts/base.json", type: "unlink" }]);
    expect(drops).toBe(2);
    stop();
  });

  test("suppresses echoes of recent local mutations", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map([["sup", [entry("sup/a.json")]]]), expanded: new Set() });
    markLocalMutation("sup/local.json");
    const renders: number[] = [];
    const stop = startFsSync({ renderLeftPanel: () => renders.push(1) });
    handler([{ isDir: false, path: "sup/local.json", type: "add" }]);
    await sleep(70);
    expect(renders).toHaveLength(0);
    stop();
  });
});

// ─── A .gitignore is a tree-wide event ────────────────────────────────────────

/**
 * The watcher's `.gitignore` branch, which is the one event that changes every row at once.
 *
 * It sits ahead of the debounced batch in `startFsSync` for two reasons the cases below hold to:
 * the file reaches `applyFsEvents` as a change to a dotfile nobody listed, so no directory reads as
 * changed and no repaint would follow; and the echo filter would drop it exactly when the author
 * who just edited their own `.gitignore` is waiting to see the tree respond.
 */
describe("startFsSync and .gitignore", () => {
  /** Install a watcher-capable backend and hand back the handler it registered. */
  function installWatchedPlatform(files: Record<string, string>) {
    let handler: (events: FsEvent[]) => void = () => {};
    const handle = installMockPlatform(
      {
        subscribeFileEvents: (h) => {
          handler = h;
          return () => {};
        },
      },
      files,
    );
    return { fire: (events: FsEvent[]) => handler(events), state: handle.state };
  }

  test("a .gitignore event repaints, though no directory reads as changed", async () => {
    const { fire, state } = installWatchedPlatform({ ".gitignore": "dist/\n" });
    resetStudioState({
      dirs: new Map([[".", [entry("dist", "directory"), entry("keep.md")]]]),
      expanded: new Set(),
    });
    // The tree has listed the root, so its rules are cached — only probed directories are re-read.
    await ensureIgnoreLayers(".");
    state.calls.length = 0;

    const renders: number[] = [];
    const stop = startFsSync({ renderLeftPanel: () => renders.push(1) });
    fire([{ isDir: false, path: ".gitignore", type: "change" }]);
    await sleep(70);

    /* `applyFsEvents` reports nothing for a `change`, so the debounced flush raises no repaint at
       all: the one render here is the reload's, and without it the tree would keep drawing the old
       rules until something unrelated happened to redraw it. */
    expect(state.calls).toContainEqual(["readFile", ".gitignore"]);
    expect(renders).toHaveLength(1);
    stop();
  });

  test("an edited .gitignore changes what the tree hides", async () => {
    const { fire, state } = installWatchedPlatform({ ".gitignore": "dist/\n" });
    resetStudioState({ dirs: new Map([[".", [entry("dist", "directory")]]]), expanded: new Set() });
    await ensureIgnoreLayers(".");
    expect(isIgnoredEntry(".", "dist", true)).toBe(true);
    expect(isIgnoredEntry(".", "coverage", true)).toBe(false);

    const stop = startFsSync({ renderLeftPanel: () => {} });
    /* What an author's own edit looks like from here: the bytes on disk moved, then the watcher
       said so. */
    state.files.set(".gitignore", "coverage/\n");
    fire([{ isDir: false, path: ".gitignore", type: "change" }]);
    await sleep(70);

    expect(isIgnoredEntry(".", "dist", true)).toBe(false);
    expect(isIgnoredEntry(".", "coverage", true)).toBe(true);
    stop();
  });

  test("Studio's own edit is not treated as an echo", async () => {
    const { fire, state } = installWatchedPlatform({ ".gitignore": "dist/\n" });
    resetStudioState({ dirs: new Map([[".", [entry("dist", "directory")]]]), expanded: new Set() });
    await ensureIgnoreLayers(".");
    state.calls.length = 0;

    const renders: number[] = [];
    const stop = startFsSync({ renderLeftPanel: () => renders.push(1) });
    /* `isRecentLocal` suppresses the events Studio caused, because the tree already repainted for
       them. A `.gitignore` written in Studio is the exception: nothing repainted, and the author
       editing it is precisely the one waiting for the rows to change. */
    markLocalMutation(".gitignore");
    state.files.set(".gitignore", "coverage/\n");
    fire([{ isDir: false, path: ".gitignore", type: "change" }]);
    await sleep(70);

    expect(state.calls).toContainEqual(["readFile", ".gitignore"]);
    expect(renders).toHaveLength(1);
    expect(isIgnoredEntry(".", "coverage", true)).toBe(true);
    stop();
  });
});

// ─── Resync: when the event stream itself cannot be trusted ───────────────────

/**
 * `onResync` is the transport saying its deltas have a gap (a reconnect) or never carried the
 * change (a commit). Deltas cannot repair a gap in deltas, so the cases below hold the resync to
 * re-reading what this window has cached — and to touching nothing the author is holding.
 */
describe("relistLoadedDirs", () => {
  test("replaces every cached listing and drops a directory that no longer lists", async () => {
    const dirs = new Map<string, DirEntry[]>([
      [".", [entry("pages", "directory")]],
      ["pages", [entry("pages/stale.json")]],
      ["gone", [entry("gone/x.json")]],
    ]);
    const fresh: Record<string, DirEntry[]> = {
      ".": [entry("pages", "directory"), entry("README.md")],
      pages: [entry("pages/a.json")],
    };
    await relistLoadedDirs(dirs, async (dir) => {
      const listing = fresh[dir];
      if (!listing) {
        throw new Error(`ENOENT ${dir}`);
      }
      return listing;
    });
    expect(dirs.get(".")?.map((e) => e.path)).toEqual(["pages", "README.md"]);
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual(["pages/a.json"]);
    expect(dirs.has("gone")).toBe(false);
  });

  test("never grows the cache, and a directory removed mid-flight stays removed", async () => {
    const dirs = new Map<string, DirEntry[]>([
      ["a", []],
      ["b", []],
    ]);
    await relistLoadedDirs(dirs, async (dir) => {
      // An `unlinkDir` for `b` lands while the listings are in flight: the event is the newer fact.
      dirs.delete("b");
      return [entry(`${dir}/new.json`)];
    });
    expect([...dirs.keys()]).toEqual(["a"]);
  });

  test("keeps at most eight listings in flight", async () => {
    const dirs = new Map<string, DirEntry[]>(
      Array.from({ length: 20 }, (_, i) => [`d${i}`, []] as [string, DirEntry[]]),
    );
    let inFlight = 0;
    let peak = 0;
    const listed: string[] = [];
    await relistLoadedDirs(dirs, async (dir) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(1);
      inFlight -= 1;
      listed.push(dir);
      return [];
    });
    expect(peak).toBe(8);
    expect(listed).toHaveLength(20);
  });

  /*
   * Nothing orders a listing's HTTP response against a message on the event socket, so a listing
   * can arrive OLDER than an event applied while it was in flight. Applying it would drop the new
   * file from the tree until something touched that directory again.
   */
  test("a listing overtaken by an event is read again, and the second read wins", async () => {
    const dirs = new Map<string, DirEntry[]>([["pages", [entry("pages/a.json")]]]);
    const reads: string[] = [];
    await relistLoadedDirs(dirs, async (dir) => {
      reads.push(dir);
      if (reads.length === 1) {
        // The server read `pages`, then another window created `new.json`, whose event lands
        // Before this response does — in place, which is why identity alone could not tell.
        applyFsEvents(dirs, new Set(), [{ isDir: false, path: "pages/new.json", type: "add" }]);
        return [entry("pages/a.json"), entry("pages/missed.json")];
      }
      return [entry("pages/a.json"), entry("pages/missed.json"), entry("pages/new.json")];
    });
    expect(reads).toEqual(["pages", "pages"]);
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual([
      "pages/a.json",
      "pages/missed.json",
      "pages/new.json",
    ]);
  });

  test("a local re-load mid-flight also counts as newer than the read", async () => {
    const dirs = new Map<string, DirEntry[]>([["pages", [entry("pages/a.json")]]]);
    let reads = 0;
    await relistLoadedDirs(dirs, async () => {
      reads += 1;
      if (reads === 1) {
        // Studio deleted `a.json` and re-loaded the parent; the echo of it will be filtered.
        dirs.set("pages", []);
        return [entry("pages/a.json")];
      }
      return [];
    });
    expect(reads).toBe(2);
    expect(dirs.get("pages")).toEqual([]);
  });

  test("a directory that moves under every read keeps what the newer changes made of it", async () => {
    const dirs = new Map<string, DirEntry[]>([["pages", []]]);
    let reads = 0;
    await relistLoadedDirs(dirs, async () => {
      reads += 1;
      applyFsEvents(dirs, new Set(), [
        { isDir: false, path: `pages/event-${reads}.json`, type: "add" },
      ]);
      return [entry("pages/stale.json")];
    });
    expect(reads).toBe(2);
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual([
      "pages/event-1.json",
      "pages/event-2.json",
    ]);
  });

  test("a failed read overtaken by an event does not drop the directory", async () => {
    const dirs = new Map<string, DirEntry[]>([["pages", []]]);
    let reads = 0;
    await relistLoadedDirs(dirs, async () => {
      reads += 1;
      if (reads === 1) {
        applyFsEvents(dirs, new Set(), [{ isDir: false, path: "pages/new.json", type: "add" }]);
        throw new Error("network");
      }
      return [entry("pages/new.json")];
    });
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual(["pages/new.json"]);
  });

  test("an empty cache lists nothing", async () => {
    const list = mock(async () => []);
    await relistLoadedDirs(new Map(), list);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("cleanOpenTabPaths", () => {
  test("names clean tabs once each, and never a dirty, co-edited or unsaved one", () => {
    closeAllTabs();
    openTab({ document: { tagName: "div" }, documentPath: "pages/clean.json", id: "t1" });
    openTab({ document: { tagName: "div" }, documentPath: "pages/clean.json", id: "t1-again" });
    const dirty = openTab({
      document: { tagName: "div" },
      documentPath: "pages/dirty.json",
      id: "t2",
    });
    dirty.doc.dirty = true;
    openTab({ document: { tagName: "div" }, documentPath: "pages/shared.json", id: "t3" });
    openTab({ document: { tagName: "div" }, documentPath: null, id: "t4" });
    /* Tabs whose document is a placeholder: re-reading their file has nothing to refresh, and on
       cloud a binary read is refused, so each reconnect would raise a false "could not reload". */
    openTab({
      capabilities: { modes: ["media"] },
      document: { children: [], tagName: "div" },
      documentPath: "img/logo.png",
      id: "img/logo.png",
    });
    openTab({
      capabilities: { modes: ["media", "source"] },
      document: { children: [], tagName: "div" },
      documentPath: "img/icon.svg",
      id: "img/icon.svg",
    });
    openTab({
      capabilities: { modes: ["grid", "source"] },
      document: { tagName: "div" },
      documentPath: "data/rows.csv",
      id: "data/rows.csv",
    });
    openTab({
      capabilities: { modes: ["git-diff"] },
      document: { tagName: "div" },
      documentPath: "fonts/a.woff2",
      id: "fonts/a.woff2",
    });
    openTab({
      capabilities: { modes: ["manage"] },
      document: { tagName: "div" },
      documentPath: "library.json",
      id: "library",
    });
    registerCollabPath("pages/shared.json");
    try {
      expect(cleanOpenTabPaths()).toEqual(["pages/clean.json"]);
    } finally {
      unregisterCollabPath("pages/shared.json");
      closeAllTabs();
    }
  });
});

describe("startFsSync resync", () => {
  /** A watcher-capable backend whose `onResync` the test can fire. */
  function installResyncPlatform(files: Record<string, string>, failing: string[] = []) {
    let onResync: ((reason: "reconnect" | "commit") => void) | undefined;
    let unsubscribed = false;
    const handle = installMockPlatform(
      {
        subscribeFileEvents: (_handler, options) => {
          onResync = options?.onResync;
          return () => {
            unsubscribed = true;
          };
        },
      },
      files,
    );
    const { listDirectory: list } = handle.platform;
    handle.platform.listDirectory = async (dir) => {
      if (failing.includes(dir)) {
        throw new Error(`ENOENT ${dir}`);
      }
      return list(dir);
    };
    return {
      fire: (reason: "reconnect" | "commit") => onResync?.(reason),
      state: handle.state,
      unsubscribed: () => unsubscribed,
    };
  }

  function context() {
    const calls = { content: [] as string[][], drops: 0, renders: 0 };
    const ctx = {
      invalidateDerivedCaches: () => {
        calls.drops += 1;
      },
      onResyncContent: (paths: string[]) => {
        calls.content.push(paths);
      },
      renderLeftPanel: () => {
        calls.renders += 1;
      },
    };
    return { calls, ctx };
  }

  test("a reconnect re-lists the loaded tree, re-reads the rules, and offers the clean tabs", async () => {
    const { fire, state } = installResyncPlatform(
      { ".gitignore": "dist/\n", "pages/a.json": "{}", "pages/b.json": "{}" },
      ["removed"],
    );
    resetStudioState({
      dirs: new Map([
        [".", [entry("pages", "directory"), entry("removed", "directory")]],
        ["pages", [entry("pages/a.json")]],
        ["removed", [entry("removed/x.json")]],
      ]),
      expanded: new Set(["pages", "removed"]),
    });
    await ensureIgnoreLayers(".");
    closeAllTabs();
    openTab({ document: { tagName: "div" }, documentPath: "pages/a.json", id: "a" });
    const dirty = openTab({ document: { tagName: "div" }, documentPath: "pages/b.json", id: "b" });
    dirty.doc.dirty = true;
    openTab({
      capabilities: { modes: ["media"] },
      document: { children: [], tagName: "div" },
      documentPath: "img/logo.png",
      id: "img/logo.png",
    });
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);
    state.calls.length = 0;
    /* What the stream missed while it was down: `.gitignore` now hides `pages` instead of `dist`.
       No event will ever say so — that is what the resync is for. */
    state.files.set(".gitignore", "pages/\n");

    fire("reconnect");
    await sleep(300);

    const { dirs } = projectState!;
    expect(dirs.get("pages")?.map((e) => e.path)).toEqual(["pages/a.json", "pages/b.json"]);
    expect(dirs.has("removed")).toBe(false);
    expect(state.calls).toContainEqual(["readFile", ".gitignore"]);
    expect(isIgnoredEntry(".", "pages", true)).toBe(true);
    expect(calls.drops).toBe(1);
    expect(calls.content).toEqual([["pages/a.json"]]);
    expect(calls.renders).toBe(1);
    stop();
    closeAllTabs();
  });

  test("a commit re-lists and repaints, and leaves the caches and open tabs alone", async () => {
    const { fire } = installResyncPlatform({ "pages/a.json": "{}", "pages/new.json": "{}" });
    resetStudioState({
      dirs: new Map([["pages", [entry("pages/a.json")]]]),
      expanded: new Set(["pages"]),
    });
    closeAllTabs();
    openTab({ document: { tagName: "div" }, documentPath: "pages/a.json", id: "a" });
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);

    fire("commit");
    await sleep(300);

    expect(projectState!.dirs.get("pages")?.map((e) => e.path)).toEqual([
      "pages/a.json",
      "pages/new.json",
    ]);
    expect(calls.drops).toBe(0);
    expect(calls.content).toEqual([]);
    expect(calls.renders).toBe(1);
    stop();
    closeAllTabs();
  });

  test("a burst is debounced into one pass, and a reconnect in it wins over a commit", async () => {
    const { fire, state } = installResyncPlatform({ "pages/a.json": "{}" });
    resetStudioState({ dirs: new Map([["pages", []]]), expanded: new Set() });
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);
    state.calls.length = 0;

    fire("reconnect");
    fire("commit");
    fire("commit");
    await sleep(100);
    // Still inside the window: nothing has been read yet.
    expect(state.calls.filter(([name]) => name === "listDirectory")).toHaveLength(0);
    await sleep(250);

    expect(state.calls.filter(([name]) => name === "listDirectory")).toHaveLength(1);
    expect(calls.drops).toBe(1);
    expect(calls.content).toHaveLength(1);
    expect(calls.renders).toBe(1);
    stop();
  });

  test("a project switched mid-resync is not repainted with the old project's listings", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fire } = installResyncPlatform({});
    const platform = getPlatform();
    platform.listDirectory = async () => {
      await gate;
      return [];
    };
    resetStudioState({ dirs: new Map([["pages", []]]), expanded: new Set() });
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);

    fire("reconnect");
    await sleep(300);
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    release();
    await sleep(10);

    expect(calls.content).toEqual([]);
    expect(calls.renders).toBe(0);
    stop();
  });

  test("with no project open, a resync does nothing", async () => {
    const { fire, state } = installResyncPlatform({});
    setProjectState(null);
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);
    state.calls.length = 0;

    fire("reconnect");
    await sleep(300);

    expect(state.calls).toEqual([]);
    expect(calls.renders).toBe(0);
    stop();
  });

  test("unsubscribing cancels a pending resync", async () => {
    const { fire, state, unsubscribed } = installResyncPlatform({});
    resetStudioState({ dirs: new Map([["pages", []]]), expanded: new Set() });
    const { calls, ctx } = context();
    const stop = startFsSync(ctx);
    state.calls.length = 0;

    fire("reconnect");
    stop();
    await sleep(300);

    expect(unsubscribed()).toBe(true);
    expect(state.calls).toEqual([]);
    expect(calls.renders).toBe(0);
  });
});
