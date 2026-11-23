import { installMockPlatform, resetStudioState } from "./harness";
import { describe, expect, mock, test } from "bun:test";
import {
  applyFsEvents,
  forgetEventVersions,
  markLocalMutation,
  snapshotTreeEvents,
  startFsSync,
  storeTreeEvents,
} from "../src/files/fs-events";
import { ensureIgnoreLayers, isIgnoredEntry } from "../src/files/gitignore";
import {
  beginListing,
  noteListing,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";
import { invalidateUsages, loadUsages } from "../src/services/references";
import { projectState, setProjectState } from "../src/store";
import type { DirEntry, FsEvent, ReferencesResult } from "../src/types";
import type { UsageQuery } from "../src/services/references";

const entry = (path: string, type: "file" | "directory" = "file"): DirEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  type,
});

/** The paths a cached listing holds, in order. */
function projectStateDirs(dir: string): string[] {
  return (projectState?.dirs.get(dir) ?? []).map((item) => item.path);
}

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

describe("the store's file events, as the tree reads them", () => {
  const origin = "external" as const;
  test("an addition, a removal and a rename; a directory is never an empty listing", () => {
    expect(
      storeTreeEvents([
        {
          docId: "a",
          hash: "sha256-a",
          isDir: false,
          origin,
          path: "pages/a.json",
          rev: 1,
          type: "fileAdded",
        },
        { docId: "d", isDir: true, origin, path: "pages/blog", rev: 2, type: "fileAdded" },
        { docId: "b", isDir: false, origin, path: "pages/b.json", rev: 3, type: "fileRemoved" },
        { docId: "c", isDir: true, origin, path: "old", rev: 4, type: "fileRemoved" },
        {
          docId: "e",
          from: "x.json",
          isDir: false,
          origin,
          rev: 5,
          to: "y.json",
          type: "fileRenamed",
        },
        { docId: "a", hash: "sha256-b", origin, path: "pages/a.json", rev: 6, type: "fileChanged" },
      ]),
    ).toEqual([
      { isDir: false, path: "pages/a.json", type: "add" },
      { isDir: true, path: "pages/blog", type: "add" },
      { isDir: false, path: "pages/b.json", type: "unlink" },
      { isDir: true, path: "old", type: "unlinkDir" },
      { isDir: false, path: "x.json", type: "unlink" },
      { isDir: false, path: "y.json", type: "add" },
    ]);
  });

  test("a dotfile is in no listing, so the tree never hears of one", () => {
    expect(
      storeTreeEvents([
        {
          docId: "g",
          hash: "sha256-g",
          isDir: false,
          origin,
          path: ".gitignore",
          rev: 1,
          type: "fileAdded",
        },
        { docId: "h", isDir: false, origin, path: "a/.env", rev: 2, type: "fileRemoved" },
      ]),
    ).toEqual([]);
  });

  test("a snapshot's account removes before it adds", () => {
    expect(
      snapshotTreeEvents(
        [
          { isDir: false, path: "pages/new.json" },
          { isDir: true, path: "media" },
          { isDir: false, path: ".hidden" },
        ],
        [
          { isDir: false, path: "pages/gone.json" },
          { isDir: true, path: "drafts" },
        ],
      ),
    ).toEqual([
      { isDir: false, path: "pages/gone.json", type: "unlink" },
      { isDir: true, path: "drafts", type: "unlinkDir" },
      { isDir: false, path: "pages/new.json", type: "add" },
      { isDir: true, path: "media", type: "add" },
    ]);
  });

  test("a store addition of a directory leaves its own listing unread", () => {
    const dirs = new Map<string, DirEntry[]>([[".", []]]);
    applyFsEvents(
      dirs,
      new Set(),
      storeTreeEvents([
        { docId: "d", isDir: true, origin, path: "media", rev: 1, type: "fileAdded" },
      ]),
    );
    expect(dirs.get(".")).toEqual([{ name: "media", path: "media", type: "directory" }]);
    expect(dirs.has("media")).toBe(false);
  });
});

describe("startFsSync", () => {
  test("is a no-op when the platform has no watcher", () => {
    installMockPlatform();
    const stop = startFsSync({ renderLeftPanel: () => {} });
    expect(() => stop()).not.toThrow();
  });

  test("debounces a burst into one render, and re-reads no content without a subscription", async () => {
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
    // Nothing can tell Studio's own write from another's, so no open tab is re-read (§9.2).
    expect(changed).toEqual([]);
    stop();
  });

  test("drops the usage cache on any event, Studio's own included", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    const findReferences = mock(async (_target: UsageQuery): Promise<ReferencesResult> => ({
      errors: [],
      files: [],
      filesReferencing: 0,
      path: "a.json",
      refsTotal: 0,
      tagName: null,
    }));
    installMockPlatform({
      findReferences,
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

    // A LOCAL mutation: Studio's own write changes who refers to what as much as anyone else's.
    markLocalMutation("a.json");
    handler([{ isDir: false, path: "a.json", type: "change" }]);
    await loadUsages({ path: "a.json" });
    expect(findReferences).toHaveBeenCalledTimes(2);
    expect(findReferences).toHaveBeenLastCalledWith({ path: "a.json" });
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
    const seen: (readonly string[] | undefined)[] = [];
    const structural: (boolean | undefined)[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: (paths, changedSet) => {
        drops += 1;
        seen.push(paths);
        structural.push(changedSet);
      },
      renderLeftPanel: () => {},
    });

    /* Same argument as the usage counts above. The page-route list, the layout picker and the
       `$paths` enumerations are all derived from which files exist, and Studio's own write
       changes that as much as anyone else's does. */
    markLocalMutation("pages/new.md");
    handler([{ isDir: false, path: "pages/new.md", type: "add" }]);
    expect(drops).toBe(1);

    handler([{ isDir: false, path: "layouts/base.json", type: "unlink" }]);
    expect(drops).toBe(2);
    // Each drop names the batch's paths, so a cache one directory owns can ignore the rest.
    expect(seen).toEqual([["pages/new.md"], ["layouts/base.json"]]);

    // A batch that only rewrote existing files says so, so a cache of the file SET can skip it.
    handler([{ isDir: false, path: "pages/new.md", type: "change" }]);
    expect(drops).toBe(3);
    expect(structural).toEqual([true, true, false]);
    stop();
  });

  test("folds Studio's own addition like any other: no window, and the fold is idempotent", async () => {
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
    handler([{ isDir: false, path: "sup/local.json", type: "add" }]);
    await sleep(70);
    expect(renders).toHaveLength(1);
    expect(projectStateDirs("sup")).toEqual(["sup/a.json", "sup/local.json"]);
    stop();
  });

  test("reports every batch to git status, echoes included", () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    let notes = 0;
    const stop = startFsSync({
      noteRepositoryChange: () => {
        notes += 1;
      },
      renderLeftPanel: () => {},
    });
    // Studio's own write changes what git reports exactly as an outside one does.
    markLocalMutation("git/own.json");
    handler([{ isDir: false, path: "git/own.json", type: "change" }]);
    handler([{ isDir: false, path: "git/other.json", type: "add" }]);
    expect(notes).toBe(2);
    stop();
  });

  test("repaints on a structural batch even when no cached listing changed", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    // Nothing is listed: the Site panel draws pages and templates from an index, not a listing.
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const renders: number[] = [];
    const stop = startFsSync({ renderLeftPanel: () => renders.push(1) });
    handler([{ isDir: false, path: "pages/about.json", type: "add" }]);
    await sleep(70);
    expect(renders).toHaveLength(1);
    // A batch of plain rewrites, with no derived cache to drop, leaves the panel alone.
    handler([{ isDir: false, path: "pages/about.json", type: "change" }]);
    await sleep(70);
    expect(renders).toHaveLength(1);
    stop();
  });

  test("repaints once the derived caches were dropped, even for an echo", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const renders: number[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: () => {},
      renderLeftPanel: () => renders.push(1),
    });
    markLocalMutation("components/card.json");
    handler([{ isDir: false, path: "components/card.json", type: "change" }]);
    await sleep(70);
    // The dropped index is only re-read by a paint, so the echo still earns one.
    expect(renders).toHaveLength(1);
    handler([{ isDir: false, path: "components/card.json", type: "change" }]);
    await sleep(70);
    expect(renders).toHaveLength(2);
    stop();
  });

  test("a flush with no project open draws nothing", async () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    const renders: number[] = [];
    const stop = startFsSync({
      invalidateDerivedCaches: () => {},
      renderLeftPanel: () => renders.push(1),
    });
    handler([{ isDir: false, path: "x/y.json", type: "add" }]);
    setProjectState(null);
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
    /* A `.gitignore` written in Studio: nothing repainted for it, and the author editing it is
       precisely the one waiting for the rows to change. */
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

// ─── Content versions ─────────────────────────────────────────────────────────

/**
 * A content version is what lets a host cache a file's URL immutably, so it must not outlive the
 * bytes it names. Studio's own upload changes a file's bytes exactly as much as anyone else's
 * write, and without a served subscription nothing says when the watcher's stream had a gap, so no
 * listing vouches for a version at all.
 */
describe("content versions", () => {
  const versioned = (path: string, version: string): DirEntry => ({ ...entry(path), version });

  function learn(...entries: DirEntry[]): void {
    noteListing(entries, beginListing());
  }

  test("forgetEventVersions forgets changed, added and removed files and removed directories", () => {
    resetAssetVersions();
    learn(
      versioned("public/a.png", "1"),
      versioned("public/b.png", "2"),
      versioned("public/c.png", "3"),
      versioned("public/img/d.png", "4"),
      versioned("public/keep.png", "5"),
      versioned("public/new/e.png", "6"),
    );
    forgetEventVersions([
      { isDir: false, path: "public/a.png", type: "change" },
      { isDir: false, path: "public/b.png", type: "add" },
      { isDir: false, path: "public/c.png", type: "unlink" },
      { isDir: true, path: "public/img", type: "unlinkDir" },
      // An added directory names no bytes the map holds.
      { isDir: true, path: "public/new", type: "addDir" },
    ]);
    expect(versionOf("public/a.png")).toBeUndefined();
    expect(versionOf("public/b.png")).toBeUndefined();
    expect(versionOf("public/c.png")).toBeUndefined();
    expect(versionOf("public/img/d.png")).toBeUndefined();
    expect(versionOf("public/keep.png")).toBe("5");
    expect(versionOf("public/new/e.png")).toBe("6");
    // A batch with nothing to forget is a no-op.
    forgetEventVersions([{ isDir: true, path: "public/other", type: "addDir" }]);
    expect(versionOf("public/keep.png")).toBe("5");
    resetAssetVersions();
  });

  test("without a served subscription no listing vouches, and stopping restores them", () => {
    let handler: (events: FsEvent[]) => void = () => {};
    installMockPlatform({
      subscribeFileEvents: (h) => {
        handler = h;
        return () => {};
      },
    });
    resetStudioState({ dirs: new Map(), expanded: new Set() });
    resetAssetVersions();
    learn(versioned("public/hero.png", "held"));
    const stop = startFsSync({ renderLeftPanel: () => {} });
    // Turning the listings off forgets what they had vouched for.
    expect(versionOf("public/hero.png")).toBeUndefined();
    learn(versioned("public/hero.png", "old"));
    expect(versionOf("public/hero.png")).toBeUndefined();
    handler([{ isDir: false, path: "public/hero.png", type: "change" }]);
    expect(versionOf("public/hero.png")).toBeUndefined();
    stop();
    learn(versioned("public/hero.png", "again"));
    expect(versionOf("public/hero.png")).toBe("again");
    resetAssetVersions();
  });

  test("markLocalMutation forgets a written file and everything under a moved directory", () => {
    resetAssetVersions();
    learn(versioned("public/hero.png", "1"), versioned("public/img/a.png", "2"));
    markLocalMutation("public/hero.png", "public/img");
    expect(versionOf("public/hero.png")).toBeUndefined();
    expect(versionOf("public/img/a.png")).toBeUndefined();
    resetAssetVersions();
  });
});
