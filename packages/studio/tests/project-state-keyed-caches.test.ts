/**
 * The caches keyed by the content store (`project-state.md` §11.1): while the subscription is live,
 * each remembers the key of what it was derived from, so a change to one document drops its entry
 * and keeps the others.
 */
import { installMockPlatform } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  componentRegistry,
  loadComponentRegistry,
  refreshStaleComponents,
} from "../src/files/components";
import { loadUsages, peekUsages } from "../src/services/references";
import type { ComponentEntry } from "../src/files/components";
import { getFormats, loadFormats, refreshFormats, setFormats } from "../src/format/format-host";
import { startLiveProjectState } from "./live-project-state";
import { contentStore } from "../src/project-state/store";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ReferencesResult, StudioPlatform } from "../src/types";

const CARD = '{"tagName":"x-card","$props":{"title":{"type":"string"}}}';
const BADGE = '{"tagName":"x-badge"}';

let live: Awaited<ReturnType<typeof startLiveProjectState>> | null = null;

afterEach(() => {
  live?.stop();
  live = null;
  refreshFormats();
});

/** A platform holding two component definitions, whose scan names both. */
function components(files: Record<string, string> = {}) {
  const kit: ComponentEntry = {
    package: "@acme/kit",
    props: [],
    source: "npm",
    tagName: "acme-button",
  };
  /* SAFETY: the registry keeps this answer as `ComponentEntry[]`; the package entry mirrors the
     server's npm discovery, which sends `package` with no `path` (the cast `site-panel.test.ts`
     makes). */
  const discoverComponents = (async () => [
    { path: "components/card.json", props: [], tagName: "x-card" },
    { path: "components/badge.json", props: [], tagName: "x-badge" },
    kit,
  ]) as StudioPlatform["discoverComponents"];
  return installMockPlatform(
    { discoverComponents },
    { "components/badge.json": BADGE, "components/card.json": CARD, ...files },
  );
}

const reads = (state: { calls: unknown[][] }) =>
  state.calls.filter(([method]) => method === "readFile").map(([, path]) => path);

describe("the component registry", () => {
  test("a change to one definition re-derives its entry and keeps the others", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    // A package component has no document, so no key.
    expect(componentRegistry.map((entry) => entry.tagName)).toContain("acme-button");
    // Nothing moved: nothing is read.
    expect(await refreshStaleComponents()).toBe(false);
    state.calls.length = 0;

    const badge = componentRegistry.find((entry) => entry.tagName === "x-badge");
    const next = '{"tagName":"x-card-next"}';
    state.files.set("components/card.json", next);
    await live.change("components/card.json", next);
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual(["components/card.json"]);
    expect(componentRegistry.find((entry) => entry.path === "components/card.json")?.tagName).toBe(
      "x-card-next",
    );
    // The other entry is the very one it was: nothing re-derived it.
    expect(componentRegistry.find((entry) => entry.tagName === "x-badge")).toBe(badge);
  });

  test("a renamed definition is relabelled without a read, and a removed one leaves", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    state.calls.length = 0;
    await live.rename("components/badge.json", "components/ui/badge.json");
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual([]);
    expect(componentRegistry.find((entry) => entry.tagName === "x-badge")?.path).toBe(
      "components/ui/badge.json",
    );
    await live.remove("components/card.json");
    expect(await refreshStaleComponents()).toBe(true);
    expect(componentRegistry.some((entry) => entry.tagName === "x-card")).toBe(false);
    expect(componentRegistry.some((entry) => entry.tagName === "x-badge")).toBe(true);
  });

  test("a definition moved and rewritten at once is derived again at its new path", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    const next = '{"tagName":"x-card-two"}';
    await live.rename("components/card.json", "components/card2.json");
    state.files.set("components/card2.json", next);
    await live.change("components/card2.json", next);
    expect(await refreshStaleComponents()).toBe(true);
    expect(componentRegistry.some((entry) => entry.path === "components/card.json")).toBe(false);
    expect(componentRegistry.find((entry) => entry.path === "components/card2.json")?.tagName).toBe(
      "x-card-two",
    );
  });

  test("a definition that no longer reads keeps its entry", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    state.files.set("components/card.json", "{ not json");
    await live.change("components/card.json", "{ not json");
    expect(await refreshStaleComponents()).toBe(false);
    expect(componentRegistry.some((entry) => entry.tagName === "x-card")).toBe(true);
  });
});

describe("the component registry across snapshots and a late subscription", () => {
  /** A snapshot of a host holding `files` (path → [docId, text]), as a new epoch would send it. */
  async function snapshotOf(files: Record<string, [docId: string, text: string]>) {
    return {
      components: [],
      files: await Promise.all(
        Object.entries(files).map(async ([path, [docId, text]]) => ({
          docId,
          hash: await contentHash(text),
          indexed: true,
          isDir: false,
          kind: "component" as const,
          path,
        })),
      ),
      formats: "f1",
      readiness: "ready" as const,
    };
  }

  test("a new epoch's snapshot, same bytes under new ids, keeps every entry and reads nothing", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    const before = [...componentRegistry];
    state.calls.length = 0;
    contentStore.applySnapshot(
      await snapshotOf({
        "components/badge.json": ["n1", BADGE],
        "components/card.json": ["n2", CARD],
      }),
    );
    expect(await refreshStaleComponents()).toBe(false);
    expect(reads(state)).toEqual([]);
    expect(componentRegistry).toHaveLength(before.length);
    expect(componentRegistry.every((entry, i) => entry === before[i])).toBe(true);
    // Re-keyed: a rename in the new epoch is followed without a read.
    contentStore.applyEvent({
      docId: "n2",
      from: "components/card.json",
      isDir: false,
      origin: "external",
      rev: 1,
      to: "components/ui/card.json",
      type: "fileRenamed",
    });
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual([]);
    expect(componentRegistry.find((entry) => entry.tagName === "x-card")?.path).toBe(
      "components/ui/card.json",
    );
  });

  test("a new epoch's snapshot that changed a definition's bytes re-derives that entry alone", async () => {
    const { state } = components();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    await loadComponentRegistry();
    state.calls.length = 0;
    const next = '{"tagName":"x-card-next"}';
    state.files.set("components/card.json", next);
    contentStore.applySnapshot(
      await snapshotOf({
        "components/badge.json": ["n1", BADGE],
        "components/card.json": ["n2", next],
      }),
    );
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual(["components/card.json"]);
    expect(componentRegistry.find((entry) => entry.path === "components/card.json")?.tagName).toBe(
      "x-card-next",
    );
    expect(componentRegistry.some((entry) => entry.tagName === "x-badge")).toBe(true);
  });

  test("a registry scanned before the subscription answered is keyed by its first snapshot", async () => {
    const { state } = components();
    contentStore.reset();
    // The project opens: the registry is scanned while the store holds nothing.
    await loadComponentRegistry();
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    state.calls.length = 0;
    // Renamed on disk with its tag unchanged: the host's set of tags does not move.
    await live.rename("components/card.json", "components/kit/card.json");
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual([]);
    expect(componentRegistry.find((entry) => entry.tagName === "x-card")?.path).toBe(
      "components/kit/card.json",
    );
  });

  test("an entry with no key is read once the store holds one, and rescanned once it is gone", async () => {
    let scans = 0;
    /* SAFETY: the registry keeps this answer as `ComponentEntry[]`, the cast `components()` above
       makes; both entries are project definitions with a path. */
    const discoverComponents = (async () => {
      scans += 1;
      return [
        { path: "components/card.json", props: [], tagName: "x-card" },
        { path: "components/badge.json", props: [], tagName: "x-badge" },
      ];
    }) as StudioPlatform["discoverComponents"];
    const { state } = installMockPlatform(
      { discoverComponents },
      { "components/badge.json": BADGE, "components/card.json": CARD },
    );
    live = await startLiveProjectState({
      "components/badge.json": ["d1", BADGE],
      "components/card.json": ["d2", CARD],
    });
    // A host that restarted below `indexed` names the files without their hashes.
    const { files, ...rest } = await snapshotOf({
      "components/badge.json": ["n1", BADGE],
      "components/card.json": ["n2", CARD],
    });
    contentStore.applySnapshot({ ...rest, files: files.map(({ hash: _hash, ...file }) => file) });
    await loadComponentRegistry();
    expect(scans).toBe(1);
    state.calls.length = 0;
    // The host names the card's bytes: its entry is read again, once.
    contentStore.applyEvent({
      docId: "n2",
      hash: await contentHash(CARD),
      indexed: true,
      kind: "component",
      origin: "external",
      path: "components/card.json",
      rev: 1,
      type: "docChanged",
    });
    expect(await refreshStaleComponents()).toBe(true);
    expect(reads(state)).toEqual(["components/card.json"]);
    expect(await refreshStaleComponents()).toBe(false);
    // The badge, still unhashed, moves: nothing says where, so the registry is scanned again.
    contentStore.applyEvent({
      docId: "n1",
      from: "components/badge.json",
      isDir: false,
      origin: "external",
      rev: 2,
      to: "components/ui/badge.json",
      type: "fileRenamed",
    });
    expect(await refreshStaleComponents()).toBe(true);
    expect(scans).toBe(2);
  });
});

describe("the usage answers", () => {
  const answer = (path: string): ReferencesResult => ({
    errors: [],
    files: [],
    filesReferencing: 0,
    path,
    refsTotal: 0,
    tagName: null,
  });

  test("keyed by the store's generation: refilled bytes keep them, a rewrite drops them", async () => {
    let asks = 0;
    installMockPlatform({
      findReferences: async (target) => {
        asks += 1;
        return answer(target.path ?? "");
      },
    });
    live = await startLiveProjectState({
      "pages/a.json": ["d1", "{}"],
      "pages/b.json": ["d2", "{}"],
    });
    await loadUsages({ path: "pages/a.json" });
    expect(asks).toBe(1);
    // The host fills in what it learned about the same bytes: the answer stands.
    await live.refill("pages/b.json");
    expect(peekUsages({ path: "pages/a.json" })?.status).toBe("ready");
    await loadUsages({ path: "pages/a.json" });
    expect(asks).toBe(1);
    // Any document's new bytes may add or drop a reference: the answer is asked again.
    await live.change("pages/b.json", '{"$ref":"./a.json"}');
    expect(peekUsages({ path: "pages/a.json" })).toBeNull();
    await loadUsages({ path: "pages/a.json" });
    expect(asks).toBe(2);
  });

  test("an answer asked before the generation moved is handed back and not kept", async () => {
    let release: (result: ReferencesResult) => void = () => {};
    installMockPlatform({
      findReferences: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    live = await startLiveProjectState({ "pages/a.json": ["d1", "{}"] });
    const pending = loadUsages({ path: "pages/a.json" });
    await live.change("pages/a.json", '{"tagName":"main"}');
    release(answer("pages/a.json"));
    const handed = await pending;
    expect(handed.status).toBe("ready");
    expect(peekUsages({ path: "pages/a.json" })).toBeNull();
  });
});

describe("the format registry", () => {
  const markdown = {
    capabilities: {},
    documentKinds: ["page"],
    exportTarget: false,
    extensions: [".md"],
    mediaType: "text/markdown",
    name: "Markdown",
    remote: false,
    studio: null,
  };

  test("keyed by the host's format-set token: another token fetches again", async () => {
    let fetches = 0;
    installMockPlatform({
      listFormats: async () => {
        fetches += 1;
        return fetches === 1 ? [] : [markdown];
      },
    });
    live = await startLiveProjectState({}, { formats: "t1" });
    refreshFormats();
    await loadFormats();
    await loadFormats();
    expect(fetches).toBe(1);
    await live.formatsChanged("t2");
    await loadFormats();
    expect(fetches).toBe(2);
    expect(getFormats().map((format) => format.name)).toEqual(["Markdown"]);
    // Seeded under the current token, the registry is current.
    setFormats([]);
    await loadFormats();
    expect(fetches).toBe(2);
  });
});
