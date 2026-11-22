import { describe, expect, test } from "bun:test";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ContentHash, ProjectEvent, ProjectSnapshot } from "@jxsuite/protocol/project-state";
import { createStoreDerivations } from "../src/project-state/derive";
import type { DerivationTargets } from "../src/project-state/derive";
import { createContentStore } from "../src/project-state/store";
import type { ContentStore } from "../src/project-state/store";
import type { AppliedEvent } from "../src/project-state/subscription";
import {
  deriveVersionsFrom,
  derivedVersionsChanged,
  forgetVersions,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";

let rev = 0;
/** One event without its revision and origin, member by member. */
type BareEvent = ProjectEvent extends infer E
  ? E extends ProjectEvent
    ? Omit<E, "rev" | "origin">
    : never
  : never;

function ev(event: BareEvent): ProjectEvent {
  rev += 1;
  return { ...event, origin: "external", rev };
}

const A = await contentHash("A");
const B = await contentHash("B");
const C = await contentHash("C");

function snapshotOf(extra: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    components: ["x-card"],
    files: [
      { docId: "d1", hash: A, indexed: true, isDir: false, kind: "component", path: "x-card.json" },
      { docId: "d2", indexed: true, isDir: true, kind: "other", path: "pages" },
      { docId: "d3", hash: A, indexed: true, isDir: false, kind: "page", path: "pages/a.json" },
    ],
    formats: "f1",
    readiness: "indexed",
    ...extra,
  };
}

/** Targets that record every call as a line. */
function recorder() {
  const calls: string[] = [];
  let own: ((path: string) => boolean) | null = null;
  const targets: DerivationTargets = {
    componentsChanged: () => calls.push("components"),
    dependentsInvalidated: (paths, tags, applied) => {
      own = applied;
      calls.push(`dependents ${paths.join(",")} ${tags.join(",")}`);
    },
    documentChanged: (path) => calls.push(`document ${path}`),
    forgetVersions: (paths, dirs) => calls.push(`forget ${paths.join(",")} | ${dirs.join(",")}`),
    formatsChanged: () => calls.push("formats"),
    gitChanged: () => calls.push("git"),
    invalidateDerivedCaches: (paths, structural) =>
      calls.push(`derived ${paths.join(",")} ${structural}`),
    invalidateUsages: () => calls.push("usages"),
    readinessChanged: (state) => calls.push(`readiness ${state}`),
    releaseVersions: (paths) => calls.push(`release ${paths.join(",")}`),
    repaint: () => calls.push("repaint"),
  };
  return {
    calls,
    applied: (path: string) => own?.(path) ?? false,
    targets,
  };
}

/** Apply `events` to `store` as the subscription does, then hand them to the derivations. */
function feed(
  store: ContentStore,
  derive: ReturnType<typeof createStoreDerivations>,
  events: [ProjectEvent, boolean][],
) {
  const applied: AppliedEvent[] = [];
  for (const [event, own] of events) {
    store.applyEvent(event);
    applied.push({ event, own });
  }
  derive.events(applied);
}

describe("createStoreDerivations", () => {
  test("the file set drops the structural caches and forgets what went or moved", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    feed(store, derive, [
      [ev({ docId: "d4", hash: B, isDir: false, path: "pages/b.json", type: "fileAdded" }), false],
      [ev({ docId: "d3", isDir: false, path: "pages/a.json", type: "fileRemoved" }), false],
      [ev({ docId: "d2", from: "pages", isDir: true, to: "routes", type: "fileRenamed" }), false],
      [ev({ docId: "d9", isDir: true, path: "old", type: "fileRemoved" }), false],
      [ev({ docId: "d8", from: "x.png", isDir: false, to: "y.png", type: "fileRenamed" }), false],
    ]);
    expect(calls).toEqual([
      "forget pages/a.json,pages,old,x.png | pages,old",
      "usages",
      "derived pages/b.json,pages/a.json,pages,routes,old,x.png,y.png true",
      "repaint",
    ]);
  });

  test("a document another writer changed reaches the lane; Studio's own does not", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    // Studio's own save: the file event is attributed by hash, its docChanged is not.
    feed(store, derive, [
      [ev({ docId: "d1", hash: B, path: "x-card.json", type: "fileChanged" }), true],
      [
        ev({
          docId: "d1",
          hash: B,
          indexed: true,
          kind: "component",
          path: "x-card.json",
          type: "docChanged",
        }),
        false,
      ],
    ]);
    expect(calls).toEqual(["usages", "derived x-card.json false", "repaint"]);
    calls.length = 0;
    // Another writer's change, after it.
    feed(store, derive, [
      [ev({ docId: "d1", hash: C, path: "x-card.json", type: "fileChanged" }), false],
      [
        ev({
          docId: "d1",
          hash: C,
          indexed: true,
          kind: "component",
          path: "x-card.json",
          type: "docChanged",
        }),
        false,
      ],
      [ev({ hash: C, path: "project.json", type: "projectConfigChanged" }), false],
    ]);
    expect(calls).toEqual([
      "document x-card.json",
      "usages",
      "derived x-card.json,project.json false",
      "repaint",
    ]);
  });

  test("a document Studio created is its own; a removal forgets who wrote it", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    const docChanged = (hash: ContentHash) =>
      ev({
        docId: "d5",
        hash,
        indexed: true,
        kind: "page",
        path: "pages/c.json",
        type: "docChanged",
      });
    feed(store, derive, [
      [ev({ docId: "d5", hash: B, isDir: false, path: "pages/c.json", type: "fileAdded" }), true],
      [docChanged(B), false],
      [ev({ docId: "d5", isDir: false, path: "pages/c.json", type: "fileRemoved" }), false],
      [ev({ docId: "d5", hash: B, isDir: false, path: "pages/c.json", type: "fileAdded" }), false],
      [docChanged(B), false],
    ]);
    expect(calls.filter((call) => call.startsWith("document"))).toEqual(["document pages/c.json"]);
  });

  test("dependents are named by path, and applied knows the bytes Studio last wrote", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { calls, applied, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    feed(store, derive, [
      [ev({ docId: "d1", hash: B, path: "x-card.json", type: "fileChanged" }), true],
      [
        ev({
          cause: { docId: "d1", kind: "component-instance" },
          complete: true,
          docIds: ["d3", "gone"],
          tags: ["x-card"],
          type: "dependentsInvalidated",
        }),
        false,
      ],
    ]);
    expect(calls).toEqual([
      "dependents pages/a.json x-card",
      "usages",
      "derived pages/a.json false",
      "repaint",
    ]);
    expect(applied("x-card.json")).toBe(true);
    expect(applied("pages/a.json")).toBe(false);
    expect(applied("pages")).toBe(false);
    expect(applied("missing.json")).toBe(false);
  });

  test("an incomplete invalidation reaches every document the store holds as unindexed", () => {
    const store = createContentStore();
    store.applySnapshot(
      snapshotOf({
        files: [
          ...snapshotOf().files,
          {
            docId: "d6",
            hash: A,
            indexed: false,
            isDir: false,
            kind: "content",
            path: "posts/a.md",
          },
          { docId: "d7", hash: A, indexed: false, isDir: false, kind: "page", path: "pages/b.md" },
          { docId: "d8", indexed: false, isDir: true, kind: "other", path: "posts" },
        ],
      }),
    );
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    feed(store, derive, [
      [
        ev({
          cause: { docId: "d1", kind: "component-instance" },
          complete: false,
          docIds: ["d3", "d7"],
          tags: ["x-card"],
          type: "dependentsInvalidated",
        }),
        false,
      ],
    ]);
    expect(calls[0]).toBe("dependents pages/a.json,pages/b.md,posts/a.md x-card");
    expect(calls[2]).toBe("derived pages/a.json,pages/b.md,posts/a.md false");
    // A change no known document depends on names none, and still reaches the unindexed ones.
    feed(store, derive, [
      [
        ev({
          cause: { docId: "d1", kind: "media-referrer" },
          complete: false,
          docIds: [],
          tags: [],
          type: "dependentsInvalidated",
        }),
        false,
      ],
    ]);
    expect(calls).toContain("dependents posts/a.md,pages/b.md ");
  });

  test("a definition another writer changed is applied once, by its docChanged", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { applied, calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    feed(store, derive, [
      [ev({ docId: "d1", hash: C, path: "x-card.json", type: "fileChanged" }), false],
      [
        ev({
          docId: "d1",
          hash: C,
          indexed: true,
          kind: "component",
          path: "x-card.json",
          type: "docChanged",
        }),
        false,
      ],
      [
        ev({
          cause: { docId: "d1", kind: "component-instance" },
          complete: true,
          docIds: ["d3"],
          tags: ["x-card"],
          type: "dependentsInvalidated",
        }),
        false,
      ],
    ]);
    expect(calls.slice(0, 2)).toEqual(["document x-card.json", "dependents pages/a.json x-card"]);
    expect(applied("x-card.json")).toBe(true);
  });

  test("project events reach their caches", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    feed(store, derive, [
      [ev({ tags: ["x-card", "x-new"], type: "componentsChanged" }), false],
      [ev({ formats: "f2", type: "formatsChanged" }), false],
      [ev({ status: { branch: "main", changed: {}, head: "h" }, type: "gitChanged" }), false],
      [ev({ state: "ready", type: "readiness" }), false],
      [ev({ reason: "limit", type: "watcherDegraded" }), false],
    ]);
    expect(calls).toEqual(["components", "formats", "git", "readiness ready", "repaint"]);
    calls.length = 0;
    // A batch that changes nothing a cache holds repaints nothing.
    feed(store, derive, [[ev({ reason: "limit", type: "watcherDegraded" }), false]]);
    feed(store, derive, [
      [ev({ status: { branch: "dev", changed: {}, head: "h" }, type: "gitChanged" }), false],
    ]);
    expect(calls).toEqual(["git"]);
  });

  test("the first snapshot reports no project field; a later one reports each that moved", () => {
    const store = createContentStore();
    const { calls, targets } = recorder();
    const derive = createStoreDerivations(store, targets);
    derive.snapshot(store.applySnapshot(snapshotOf()));
    expect(calls).toEqual([]);

    // Same fields, one file changed: a structural drop and a document change.
    const changed = snapshotOf();
    changed.files[2] = { ...changed.files[2]!, hash: B };
    derive.snapshot(store.applySnapshot(changed));
    expect(calls).toEqual([
      "forget pages/a.json | ",
      "release pages/a.json",
      "usages",
      "derived pages/a.json true",
      "document pages/a.json",
      "repaint",
    ]);
    calls.length = 0;

    derive.snapshot(
      store.applySnapshot(
        snapshotOf({
          components: ["x-card", "x-new"],
          files: changed.files,
          formats: "f2",
          git: { branch: "main", changed: {}, head: "h" },
          readiness: "ready",
        }),
      ),
    );
    expect(calls).toEqual(["components", "formats", "git", "readiness ready", "repaint"]);
    calls.length = 0;

    // A removed directory is dropped but is no document change; nothing else moved.
    derive.snapshot(
      store.applySnapshot(
        snapshotOf({
          components: ["x-card", "x-new"],
          files: [changed.files[0]!],
          formats: "f2",
          git: { branch: "main", changed: {}, head: "h" },
          readiness: "ready",
        }),
      ),
    );
    expect(calls).toEqual([
      "forget pages,pages/a.json | ",
      "release pages,pages/a.json",
      "usages",
      "derived pages,pages/a.json true",
      "repaint",
    ]);
  });

  test("a store that already took a snapshot compares against it, and optional targets may be absent", () => {
    const store = createContentStore();
    store.applySnapshot(snapshotOf());
    const calls: string[] = [];
    const derive = createStoreDerivations(store, {
      forgetVersions: () => calls.push("forget"),
      invalidateUsages: () => calls.push("usages"),
      repaint: () => calls.push("repaint"),
    });
    derive.snapshot(store.applySnapshot(snapshotOf({ formats: "f2", readiness: "ready" })));
    feed(store, derive, [
      [ev({ docId: "d1", hash: B, path: "x-card.json", type: "fileChanged" }), false],
      [
        ev({
          docId: "d1",
          hash: B,
          indexed: true,
          kind: "component",
          path: "x-card.json",
          type: "docChanged",
        }),
        false,
      ],
      [
        ev({
          cause: { docId: "d1", kind: "component-instance" },
          complete: false,
          docIds: [],
          tags: [],
          type: "dependentsInvalidated",
        }),
        false,
      ],
      [ev({ tags: [], type: "componentsChanged" }), false],
      [ev({ formats: "f3", type: "formatsChanged" }), false],
      [ev({ status: { branch: null, changed: {}, head: null }, type: "gitChanged" }), false],
      [ev({ state: "indexed", type: "readiness" }), false],
    ]);
    derive.snapshot(store.applySnapshot(snapshotOf({ components: [] })));
    expect(calls).toEqual(["repaint", "usages", "repaint", "forget", "usages", "repaint"]);
  });
});

describe("a snapshot and the content versions derived from the store", () => {
  test("a path a later snapshot rehashed keeps a version: the new hash", () => {
    const store = createContentStore();
    const stopVersions = store.onChange((change) => {
      derivedVersionsChanged(change.paths);
    });
    const derive = createStoreDerivations(store, {
      forgetVersions,
      invalidateUsages: () => {},
      releaseVersions: derivedVersionsChanged,
      repaint: () => {},
    });
    const image = (hash: ContentHash) => ({
      docId: "d1",
      hash,
      indexed: true,
      isDir: false,
      kind: "other" as const,
      path: "public/a.png",
    });
    try {
      const first = snapshotOf({ files: [image(A)] });
      derive.snapshot(store.applySnapshot(first));
      // Attached as the subscription goes live, before the snapshot that follows a reconnect.
      deriveVersionsFrom(store);
      expect(versionOf("public/a.png")).toBe(A);
      const second = snapshotOf({ files: [image(B)] });
      derive.snapshot(store.applySnapshot(second));
      expect(store.hashAt("public/a.png")).toBe(B);
      expect(versionOf("public/a.png")).toBe(B);
    } finally {
      stopVersions();
      deriveVersionsFrom(null);
      resetAssetVersions();
    }
  });
});
