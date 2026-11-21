/**
 * The project state conformance suite (`specs/project-state.md` §10.4): one set of cases every host
 * runs through the same driver interface, so the desktop backend, the dev server and the cloud's
 * Durable Object are held to one contract rather than three readings of it.
 *
 * The suite takes `describe`, `test` and `expect` as a parameter instead of importing a test
 * runner, so it runs under `bun:test` here and under Vitest in a Worker in the platform repository,
 * where the cloud host lives. A host passes when every case registered for it is green.
 *
 * A host that does not serve §8 (the dependency graph) or §9 (the rename cascade) runs a negative
 * case for each instead: it emits no `dependentsInvalidated` or `operationApplied`. A driver that
 * declares {@link ProjectStateDriver.graph} runs §10.4's §8 cases in place of the first. The §9
 * cases are not written yet, so a driver that declares {@link ProjectStateDriver.rename} gets a
 * failing case naming the missing section rather than fewer checks.
 *
 * @module
 */

import {
  checkContinuity,
  decodeCloudHostMessage,
  decodeDesktopPush,
  encodeCloudSubscribeAnswer,
  encodeDesktopEvents,
} from "./project-state-frames.ts";
import { contentHash, isOwnOrigin, READINESS_ORDER } from "./project-state.ts";
import { PROJECT_FILE_NAMES } from "@jxsuite/schema/project-file";
import type { JsonValue } from "@jxsuite/schema/types";
import type {
  ContentHash,
  DependencyKind,
  EventOrigin,
  DeleteRequest,
  DeleteResult,
  DocKind,
  IndexedFile,
  ProjectEvent,
  ProjectEventType,
  ProjectSnapshot,
  ReadinessState,
  RenameOperation,
  SubscribeRequest,
  SubscribeResponse,
  WriteRequest,
  WriteResult,
} from "./project-state.ts";

// ─── The test API the suite is handed ─────────────────────────────────────────────────────────

/** The matchers the suite uses; `bun:test`'s and Vitest's `expect` both provide them. */
export interface ConformanceMatchers {
  toBe: <E>(expected: E) => void;
  toEqual: <E>(expected: E) => void;
  toBeUndefined: () => void;
}

/** One assertion, with its negation. */
export interface ConformanceAssertion extends ConformanceMatchers {
  not: ConformanceMatchers;
}

/** The test runner primitives the suite registers its cases with. */
export interface ConformanceTestApi {
  describe: (name: string, body: () => void) => void;
  test: (name: string, body: () => Promise<void>) => void;
  expect: <A>(actual: A, message?: string) => ConformanceAssertion;
}

// ─── The driver a host implements ─────────────────────────────────────────────────────────────

/** A fixture project: project-relative path to contents. Directories are implied by the paths. */
export type FixtureFiles = Record<string, string | Uint8Array>;

/** How the suite asks for a host. */
export interface ProjectStateHostOptions {
  /**
   * Hold the host at a readiness state below `indexed` until {@link ProjectStateHost.release}; it
   * still answers a subscribe (§3.1, §7).
   */
  hold?: boolean;
  /** The replay window, in events, so the suite can step outside it (§2.3). */
  logCapacity?: number;
}

/** One subscription, as the driver observed it. */
export interface ProjectStateSubscription {
  /** The host's answer to the subscribe. */
  readonly response: SubscribeResponse;
  /** Every event streamed after the answer, in the order it arrived. */
  readonly events: readonly ProjectEvent[];
  /** Whether the host ended the subscription (a restart, a watcher recovery, §4.8). */
  readonly ended: boolean;
  /** End the subscription from the client's side. */
  close: () => void;
}

/** Changes made behind the host's back, the way another program would make them. */
export interface ExternalActions {
  write: (path: string, contents: string | Uint8Array) => Promise<void>;
  remove: (path: string) => Promise<void>;
  /** Move a file; a host may report it as `fileRenamed` or as a removal and an add (§4.2). */
  rename: (from: string, to: string) => Promise<void>;
  /**
   * Save by writing a temporary file and renaming it over `path`, observed as a removal and an add
   * at `path`, `inside` or `outside` the host's pairing bound (§2.4).
   */
  atomicSave: (
    path: string,
    contents: string | Uint8Array,
    timing: "inside" | "outside",
  ) => Promise<void>;
  /**
   * Make `path` a symbolic link to `target`, a project-relative path that may lead outside the root
   * (`../outside.json`); the driver creates a target outside the root first. A host whose storage
   * has no links (the cloud, §10.3) omits it.
   */
  symlink?: (path: string, target: string) => Promise<void>;
}

/** One running host over one fixture project. */
export interface ProjectStateHost {
  subscribe: (request: SubscribeRequest) => Promise<ProjectStateSubscription>;
  write: (request: WriteRequest) => Promise<WriteResult>;
  delete: (request: DeleteRequest) => Promise<DeleteResult>;
  /** Create a directory through the contract; its `fileAdded` carries `writeId` (§5). */
  createDirectory: (path: string, writeId: string) => Promise<{ rev: number }>;
  /** The bytes on disk at `path`, `null` when nothing is there. */
  read: (path: string) => Promise<Uint8Array | null>;
  external: ExternalActions;
  /**
   * Resolve once the host has processed every change made so far, including its watcher's reports
   * of its own writes and its git monitor's debounce, and delivered the resulting events.
   */
  settle: () => Promise<void>;
  /** Let a host created with `hold` advance to `ready`. */
  release: () => Promise<void>;
  /** Restart the host process over the same files (§2.3). */
  restart: () => Promise<void>;
  /** Run an install of the project's dependencies, as the host does (§7). */
  install: () => Promise<void>;
  /** Commit every change outside Studio (§4.5). */
  commit: (message: string) => Promise<void>;
  /** Make the watcher fail and recover (§4.8), for a host that has one. */
  watcher?: {
    degrade: (reason: string) => Promise<void>;
    recover: () => Promise<void>;
  };
  close: () => Promise<void>;
}

/**
 * The hook a host that serves the dependency graph (§8) supplies, which runs the §8 cases. Every
 * case drives the host through {@link ProjectStateHost}, so the hook only declares how complete the
 * host's graph is over the fixture.
 */
export interface ProjectStateGraphHooks {
  /** Whether the host extracts references from every document in the fixture (§8.2). */
  complete: boolean;
}

/** The hook a host that serves the rename cascade (§9) supplies; its cases join with §9. */
export interface ProjectStateRenameHooks {
  rename: (host: ProjectStateHost, operation: RenameOperation) => Promise<{ ok: boolean }>;
  /** Make the operation's `step`-th step fail, so the suite can watch it roll back. */
  failStep: (host: ProjectStateHost, step: number) => void;
}

/** What a host hands the suite. */
export interface ProjectStateDriver {
  /** Names the host in the suite's `describe` block. */
  name: string;
  /** Whether the host's replay log survives a restart (the cloud's, §10.3) rather than resetting. */
  persistentLog?: boolean;
  create: (files: FixtureFiles, options: ProjectStateHostOptions) => Promise<ProjectStateHost>;
  graph?: ProjectStateGraphHooks;
  rename?: ProjectStateRenameHooks;
}

// ─── The fixture ──────────────────────────────────────────────────────────────────────────────

/** The project configuration, in its JSON spelling so the fixture is plain JSON throughout. */
const [, CONFIG_FILE] = PROJECT_FILE_NAMES;

const json = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`;

/** A PNG signature and a byte that is not UTF-8, so the media file is hashed as bytes. */
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00]);

const MANIFEST = { dependencies: {}, name: "conformance-fixture", private: true, scripts: {} };

/**
 * The project configuration. It names a build output other than `dist/`, which the index scope
 * excludes as well (§2.2); every case that rewrites the configuration keeps that member.
 */
const CONFIG = {
  build: { outDir: "./site" },
  defaults: { layout: "./layouts/base.json" },
  name: "Fixture",
};

/** The fixture every case starts from: one document of each kind, and the paths §2.2 excludes. */
export const CONFORMANCE_FIXTURE: Readonly<FixtureFiles> = Object.freeze({
  ".cache/build.json": json({}),
  ".devenv/state": "devenv",
  ".direnv/state": "direnv",
  ".jx/state.json": json({}),
  "bun.lock": "{}\n",
  "components/my-card.json": json({ children: [{ tagName: "slot" }], tagName: "my-card" }),
  "content/posts/hello.md": "# Hello\n",
  "data/items.json": json([{ id: 1 }]),
  "dist/index.html": "<!doctype html>\n",
  "extensions/noop.js": "export default {};\n",
  "layouts/base.json": json({ children: [{ tagName: "slot" }], tagName: "div" }),
  "media/logo.png": LOGO,
  "node_modules/dep/index.js": "export {};\n",
  "package.json": json(MANIFEST),
  "pages/about.json": json({
    children: [{ tagName: "my-card" }, { src: "../media/logo.png", tagName: "img" }],
    tagName: "main",
  }),
  "pages/index.json": json({ tagName: "main", textContent: "Home" }),
  "pages/node_modules/stray.js": "export {};\n",
  "site/index.html": "<!doctype html>\n",
  [CONFIG_FILE]: json(CONFIG),
  "styles/site.css": "body { margin: 0; }\n",
  "vendor/noop/index.js": "export {};\n",
  "vendor/noop/package.json": json({ name: "noop", version: "1.0.0" }),
});

/** Every fixture path outside the index scope (§2.2). */
const OUT_OF_SCOPE = new Set([
  ".cache/build.json",
  ".devenv/state",
  ".direnv/state",
  ".jx/state.json",
  "bun.lock",
  "dist/index.html",
  "node_modules/dep/index.js",
  "pages/node_modules/stray.js",
  "site/index.html",
]);

/** Fixture paths inside the index scope. */
const IN_SCOPE = Object.keys(CONFORMANCE_FIXTURE).filter((path) => !OUT_OF_SCOPE.has(path));

/** Directories the in-scope fixture files imply. */
const IN_SCOPE_DIRS = [
  ...new Set(
    IN_SCOPE.flatMap((path) =>
      path
        .split("/")
        .slice(0, -1)
        .map((_, at, parts) => parts.slice(0, at + 1).join("/")),
    ),
  ),
];

/** The kinds §2.2 fixes for the fixture's conventional locations. */
const EXPECTED_KINDS = {
  "components/my-card.json": "component",
  "layouts/base.json": "layout",
  "media/logo.png": "media",
  "pages/index.json": "page",
  [CONFIG_FILE]: "project-config",
  "styles/site.css": "style",
} as const satisfies Record<string, DocKind>;

const DOC_KINDS = new Set<DocKind>([
  "page",
  "layout",
  "component",
  "content",
  "data",
  "media",
  "style",
  "project-config",
  "other",
]);

/**
 * The lockfiles an install may run against or write (§7): the fixture's own, and the one an npm
 * installer writes in its place.
 */
const LOCKFILES = ["bun.lock", "package-lock.json"] as const;

/** A member a frame may have left out, as a host's types cannot promise it was sent. */
const BOOLEANS: ReadonlySet<boolean | undefined> = new Set([true, false]);

const FILE_EVENTS = new Set<ProjectEventType>([
  "fileAdded",
  "fileChanged",
  "fileRemoved",
  "fileRenamed",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

const bytesOf = (contents: string | Uint8Array): Uint8Array =>
  contents instanceof Uint8Array ? contents : encoder.encode(contents);

const hashOf = (contents: string | Uint8Array): Promise<ContentHash> =>
  contentHash(bytesOf(contents));

let writeSerial = 0;

/** A write id unique within this process. */
const nextWriteId = (): string => {
  writeSerial += 1;
  return `conformance-${writeSerial}`;
};

const ofType = <T extends ProjectEventType>(
  events: readonly ProjectEvent[],
  type: T,
): Extract<ProjectEvent, { type: T }>[] =>
  events.filter((event): event is Extract<ProjectEvent, { type: T }> => event.type === type);

/** Events that change the index or what the host derived from it; not git or readiness. */
/** The four file events of §4.2. */
type FileEvent = Extract<
  ProjectEvent,
  { type: "fileAdded" | "fileChanged" | "fileRemoved" | "fileRenamed" }
>;

const fileEvents = (events: readonly ProjectEvent[]): FileEvent[] =>
  events.filter((event): event is FileEvent => FILE_EVENTS.has(event.type));

/** The writer a write origin names, `null` for an external one. */
const writeIdOf = (origin: EventOrigin | undefined): string | null =>
  origin === undefined || origin === "external" ? null : origin.writeId;

const changes = (events: readonly ProjectEvent[]): ProjectEvent[] =>
  events.filter((event) => event.type !== "gitChanged" && event.type !== "readiness");

const stepOf = (state: ReadinessState): number => READINESS_ORDER.indexOf(state);

/**
 * Whether a value survives its binding's codec: the decoders validate every member a frame must
 * carry, so a host that emits a malformed event or answer fails here (§3.2, §4.1).
 */
function crossesWire(roundTrip: () => object | null): boolean {
  try {
    return roundTrip() !== null;
  } catch {
    return false;
  }
}

/** What a failed expectation leaves a helper to return; never read, because the case has failed. */
const NO_SNAPSHOT: ProjectSnapshot = {
  components: [],
  files: [],
  formats: "",
  readiness: "scaffolded",
};

/** The suite's whole body, closed over one driver and one test API. */
function registerCases(driver: ProjectStateDriver, api: ConformanceTestApi): void {
  const { describe, expect } = api;

  /** Register a case that runs against a fresh host and always closes it. */
  const hostCase = (
    name: string,
    run: (host: ProjectStateHost) => Promise<void>,
    options: ProjectStateHostOptions = {},
  ): void => {
    api.test(name, async () => {
      const host = await driver.create({ ...CONFORMANCE_FIXTURE }, options);
      try {
        await host.settle();
        await run(host);
      } finally {
        await host.close();
      }
    });
  };

  /**
   * What every subscription must show, checked after each case that streams: every event is
   * well-formed, and revisions continue from the answer's `rev` one at a time (§2.3, §3.1, §4.1).
   */
  const expectStream = (sub: ProjectStateSubscription): void => {
    expect(
      crossesWire(() => decodeCloudHostMessage(encodeCloudSubscribeAnswer(sub.response))),
      "a well-formed answer",
    ).toBe(true);
    for (const event of sub.events) {
      expect(
        crossesWire(() => decodeDesktopPush(encodeDesktopEvents(sub.response.epoch, [event]))),
        `a well-formed event: ${JSON.stringify(event)}`,
      ).toBe(true);
    }
    const continuity = checkContinuity(sub.response.rev, sub.events);
    expect(continuity, "revisions are strictly increasing and gap-free").toEqual({
      ok: true,
      rev: sub.response.rev + sub.events.length,
    });
  };

  const snapshotOf = (response: SubscribeResponse): ProjectSnapshot => {
    expect(response.kind, "a snapshot answer").toBe("snapshot");
    return response.kind === "snapshot" ? response.snapshot : NO_SNAPSHOT;
  };

  /** The events of an `events` answer, failing the case for a snapshot. */
  const eventsOf = (response: SubscribeResponse): ProjectEvent[] => {
    expect(response.kind, "an events answer").toBe("events");
    return response.kind === "events" ? response.events : [];
  };

  /** The event, which must be of `type`, narrowed to it. */
  const one = <T extends ProjectEventType>(
    event: ProjectEvent | undefined,
    type: T,
    what: string,
  ): Extract<ProjectEvent, { type: T }> => {
    expect(event?.type, what).toBe(type);
    return ofType(event === undefined ? [] : [event], type)[0]!;
  };

  const fileIn = (snapshot: ProjectSnapshot, path: string): IndexedFile => {
    const file = snapshot.files.find((entry) => entry.path === path);
    expect(file === undefined, `${path} is in the snapshot`).toBe(false);
    return file!;
  };

  const currentSnapshot = async (host: ProjectStateHost): Promise<ProjectSnapshot> => {
    const sub = await host.subscribe({});
    sub.close();
    return snapshotOf(sub.response);
  };

  /** A fresh subscription, before the case's action. */
  const watch = async (host: ProjectStateHost): Promise<ProjectStateSubscription> =>
    host.subscribe({});

  /**
   * The file event at `at` is followed by its `docChanged`, naming the same document, path and hash
   * and carrying the same origin (§4.3, §5 step 4).
   */
  const expectDocChangedAfter = (events: readonly ProjectEvent[], at: number): void => {
    const file = events[at];
    const { docId, hash, origin, path } =
      file?.type === "fileAdded" || file?.type === "fileChanged"
        ? file
        : { docId: undefined, hash: undefined, origin: undefined, path: undefined };
    expect(path === undefined, "a fileAdded or fileChanged").toBe(false);
    const changed = one(events[at + 1], "docChanged", `docChanged follows ${path}`);
    expect(
      { docId: changed.docId, hash: changed.hash, origin: changed.origin, path: changed.path },
      "docChanged names the file event's document, hash and origin",
    ).toEqual({ docId, hash, origin, path });
    expect(DOC_KINDS.has(changed.kind), `${changed.kind} is a DocKind`).toBe(true);
  };

  /**
   * A file of the fixture, once the host is ready, has had its references extracted (§3.1, §7):
   * `indexed` is `true`. A host that declares its graph partial (§8.2) may leave a document it
   * cannot parse unindexed, so for it the member need only be present.
   */
  const expectIndexed = (path: string, indexed: boolean | undefined): void => {
    if (driver.graph?.complete === false) {
      expect(indexed === undefined, `${path} says whether it is indexed`).toBe(false);
    } else {
      expect(indexed, `${path} is indexed once the host is ready`).toBe(true);
    }
  };

  /** The lockfiles on disk, in {@link LOCKFILES} order. */
  const presentLockfiles = async (host: ProjectStateHost): Promise<string[]> => {
    const present: string[] = [];
    for (const path of LOCKFILES) {
      if ((await host.read(path)) !== null) {
        present.push(path);
      }
    }
    return present;
  };

  /** Every lockfile's hash, as one string to compare before and after an install. */
  const lockfilesOf = async (host: ProjectStateHost): Promise<string> => {
    const hashes: (ContentHash | null)[] = [];
    for (const path of LOCKFILES) {
      const bytes = await host.read(path);
      hashes.push(bytes === null ? null : await contentHash(bytes));
    }
    return JSON.stringify(hashes);
  };

  /** Write `contents` at `path` over whatever is there, reading the base from the disk. */
  const writeOver = async (
    host: ProjectStateHost,
    path: string,
    contents: string | Uint8Array,
  ): Promise<{ hash: ContentHash; rev: number; writeId: string }> => {
    const current = await host.read(path);
    const writeId = nextWriteId();
    const result = await host.write({
      baseHash: current === null ? null : await contentHash(current),
      contents,
      path,
      writeId,
    });
    expect(result.ok, `the write to ${path} is accepted`).toBe(true);
    return result.ok
      ? { hash: result.hash, rev: result.rev, writeId }
      : { hash: await contentHash(""), rev: -1, writeId };
  };

  describe(`project state conformance: ${driver.name}`, () => {
    // ─── §2 Identity, hashes and revisions ──────────────────────────────────────────────────
    describe("§2 identity, hashes and revisions", () => {
      hostCase("every file and directory in the index scope is in the snapshot", async (host) => {
        const snapshot = await currentSnapshot(host);
        for (const path of IN_SCOPE) {
          const file = fileIn(snapshot, path);
          expect(file.isDir, `${path} is a file`).toBe(false);
          expect(file.hash, `${path} is hashed over its bytes`).toBe(
            await hashOf(CONFORMANCE_FIXTURE[path]!),
          );
        }
        for (const path of IN_SCOPE_DIRS) {
          const dir = fileIn(snapshot, path);
          expect(dir.isDir, `${path} is a directory`).toBe(true);
          expect(dir.hash, `the directory ${path} has no hash`).toBeUndefined();
        }
        const ids = snapshot.files.map((file) => file.docId);
        expect(new Set(ids).size, "document ids are unique").toBe(ids.length);
        for (const path of IN_SCOPE) {
          expectIndexed(path, fileIn(snapshot, path).indexed);
        }
        for (const file of snapshot.files) {
          expect(BOOLEANS.has(file.indexed), `${file.path} says whether it is indexed`).toBe(true);
          expect(DOC_KINDS.has(file.kind), `${file.path} has a DocKind`).toBe(true);
          expect(/^(?:\/|\.\/)|\\/.test(file.path), `${file.path} is project-relative`).toBe(false);
        }
      });

      hostCase("paths outside the index scope are never indexed and emit nothing", async (host) => {
        const snapshot = await currentSnapshot(host);
        const indexed = new Set(snapshot.files.map((file) => file.path));
        for (const path of [...OUT_OF_SCOPE, "node_modules", "dist", "site", ".jx", ".cache"]) {
          expect(indexed.has(path), `${path} is outside the index scope`).toBe(false);
        }
        expect(
          [...indexed].some((path) => path.split("/").includes(".git")),
          ".git is outside the index scope",
        ).toBe(false);
        const sub = await watch(host);
        await host.external.write("node_modules/dep/index.js", "export const x = 1;\n");
        await host.external.write("pages/node_modules/stray.js", "export const y = 2;\n");
        await host.external.write("dist/index.html", "<!doctype html><p>rebuilt</p>\n");
        await host.external.write("site/index.html", "<!doctype html><p>rebuilt</p>\n");
        await host.settle();
        expect(changes(sub.events), "no event for an ignored path").toEqual([]);
        expectStream(sub);
      });

      hostCase("a symlink is followed only when it resolves inside the root", async (host) => {
        const { symlink } = host.external;
        if (symlink === undefined) {
          // Storage without links has nothing to follow.
          return;
        }
        const sub = await watch(host);
        await symlink("pages/linked.json", "pages/index.json");
        await symlink("pages/escape.json", "../outside.json");
        await host.settle();
        const snapshot = await currentSnapshot(host);
        expect(fileIn(snapshot, "pages/linked.json").hash, "a link inside reads its target").toBe(
          await hashOf(CONFORMANCE_FIXTURE["pages/index.json"]!),
        );
        expect(
          snapshot.files.some((file) => file.path === "pages/escape.json"),
          "a link leaving the root is not indexed",
        ).toBe(false);
        expect(
          fileEvents(sub.events).map((event) => ("path" in event ? event.path : event.to)),
          "only the link inside is added",
        ).toEqual(["pages/linked.json"]);
        expectStream(sub);
      });

      hostCase("the fixture's conventional locations are classified", async (host) => {
        const snapshot = await currentSnapshot(host);
        for (const [path, kind] of Object.entries(EXPECTED_KINDS)) {
          expect(fileIn(snapshot, path).kind, `${path} is a ${kind}`).toBe(kind);
        }
      });

      hostCase(
        "revisions start at 1 in an epoch and replay from there",
        async (host) => {
          await writeOver(host, "styles/site.css", "p { color: green; }\n");
          await host.settle();
          const first = await host.subscribe({});
          first.close();
          /* The window is larger than everything a fresh host has emitted, so the whole epoch
             replays: a snapshot here would mean revision 1 was never in the log. */
          const replay = await host.subscribe({ epoch: first.response.epoch, sinceRev: 0 });
          replay.close();
          const events = eventsOf(replay.response);
          expect(events[0]?.rev, "the first revision is 1").toBe(1);
          expect(checkContinuity(0, events), "the replay is gap-free from 1").toEqual({
            ok: true,
            rev: first.response.rev,
          });
        },
        { logCapacity: 1024 },
      );

      hostCase("a document keeps its id when its bytes change", async (host) => {
        const before = fileIn(await currentSnapshot(host), "pages/index.json");
        const sub = await watch(host);
        await host.external.write("pages/index.json", json({ tagName: "main", textContent: "Hi" }));
        await host.settle();
        const [changed] = ofType(sub.events, "fileChanged");
        expect(changed?.docId, "the change keeps the document id").toBe(before.docId);
        expectStream(sub);
      });

      hostCase("a path removed and added again names a new document", async (host) => {
        const before = fileIn(await currentSnapshot(host), "data/items.json");
        const sub = await watch(host);
        const removed = await host.delete({
          base: { hash: before.hash! },
          path: "data/items.json",
          writeId: nextWriteId(),
        });
        expect(removed.ok, "the delete is accepted").toBe(true);
        await host.write({
          baseHash: null,
          contents: json([]),
          path: "data/items.json",
          writeId: nextWriteId(),
        });
        await host.settle();
        const [added] = ofType(sub.events, "fileAdded");
        expect(added?.path, "the path is added again").toBe("data/items.json");
        expect(added?.docId === before.docId, "the new file has a new id").toBe(false);
        expectStream(sub);
      });

      hostCase("every subscriber sees the same origin for the same write", async (host) => {
        const a = await watch(host);
        const b = await host.subscribe({ clientId: "conformance-b" });
        const { writeId, hash } = await writeOver(host, "styles/site.css", "body{}\n");
        await host.settle();
        expect(a.events, "both subscribers receive the same events").toEqual(b.events);
        const [changed] = ofType(a.events, "fileChanged");
        expect(changed?.origin, "the event carries the write's origin").toEqual({
          writeHash: hash,
          writeId,
        });
        expect(isOwnOrigin(changed!.origin, new Set([writeId])), "the writer recognises it").toBe(
          true,
        );
        expect(isOwnOrigin(changed!.origin, new Set(["other"])), "no one else does").toBe(false);
        expectStream(a);
        expectStream(b);
      });

      hostCase("a coalesced burst of writes emits one event per write", async (host) => {
        const sub = await watch(host);
        const writes = [];
        for (const text of ["a", "b", "c"]) {
          writes.push(await writeOver(host, "pages/index.json", json({ tagName: "main", text })));
        }
        await host.settle();
        const changed = ofType(sub.events, "fileChanged");
        expect(
          changed.map((event) => event.rev),
          "one fileChanged per write, at the revision each write answered",
        ).toEqual(writes.map((write) => write.rev));
        expect(
          changed.map((event) => event.origin),
          "each carries its own write's origin",
        ).toEqual(writes.map((write) => ({ writeHash: write.hash, writeId: write.writeId })));
        expect(changes(sub.events).length, "nothing for the watcher's observations").toBe(6);
        expectStream(sub);
      });

      hostCase(
        "an external change that restores an own write's bytes is external",
        async (host) => {
          const sub = await watch(host);
          const a = json({ tagName: "main", textContent: "A" });
          const b = json({ tagName: "main", textContent: "B" });
          await writeOver(host, "pages/index.json", a);
          await writeOver(host, "pages/index.json", b);
          await host.settle();
          // A's bytes were an own write's; once its echo is consumed, the same bytes are external.
          await host.external.write("pages/index.json", a);
          await host.settle();
          const changed = ofType(sub.events, "fileChanged");
          expect(changed.length, "the two own writes and the external restore").toBe(3);
          expect(changed[2]?.origin, "the restore is external").toBe("external");
          expect(changed[2]?.hash, "it names the restored bytes").toBe(await hashOf(a));
          const after = await currentSnapshot(host);
          expect(fileIn(after, "pages/index.json").hash, "the index holds A again").toBe(
            await hashOf(a),
          );
          expectStream(sub);
        },
      );

      hostCase("an external write of the indexed bytes emits nothing", async (host) => {
        const sub = await watch(host);
        await host.external.write("styles/site.css", CONFORMANCE_FIXTURE["styles/site.css"]!);
        await host.settle();
        expect(sub.events, "a touch is not a change").toEqual([]);
        expectStream(sub);
      });

      hostCase("an atomic-rename save inside the pairing bound keeps its id", async (host) => {
        const before = fileIn(await currentSnapshot(host), "pages/about.json");
        const sub = await watch(host);
        const next = json({ tagName: "main", textContent: "About" });
        await host.external.atomicSave("pages/about.json", next, "inside");
        await host.settle();
        const events = changes(sub.events);
        expect(
          fileEvents(events).map((event) => event.type),
          "one change, not a removal and an add",
        ).toEqual(["fileChanged"]);
        const changed = one(events[0], "fileChanged", "a fileChanged");
        expect(changed.docId, "the document keeps its id").toBe(before.docId);
        expect(changed.origin, "the save is external").toBe("external");
        expect(changed.hash, "it names the saved bytes").toBe(await hashOf(next));
        expectDocChangedAfter(events, 0);
        expectStream(sub);
      });

      hostCase("an atomic-rename save of identical bytes emits nothing", async (host) => {
        const sub = await watch(host);
        await host.external.atomicSave(
          "pages/about.json",
          CONFORMANCE_FIXTURE["pages/about.json"]!,
          "inside",
        );
        await host.settle();
        expect(sub.events, "the bytes did not change").toEqual([]);
        expectStream(sub);
      });

      hostCase(
        "an atomic-rename save slower than the bound is a removal and an add",
        async (host) => {
          const before = fileIn(await currentSnapshot(host), "pages/about.json");
          const sub = await watch(host);
          await host.external.atomicSave("pages/about.json", json({ tagName: "main" }), "outside");
          await host.settle();
          const files = fileEvents(sub.events);
          expect(
            files.map((event) => event.type),
            "a removal, then an add",
          ).toEqual(["fileRemoved", "fileAdded"]);
          expect(files[0]!.docId, "the removal names the old id").toBe(before.docId);
          expect(files[1]!.docId === before.docId, "the add mints a new id").toBe(false);
          expect(
            files.map((event) => event.origin),
            "both are attributed by hash, so external",
          ).toEqual(["external", "external"]);
          expectStream(sub);
        },
      );

      hostCase(
        "an external move is a rename keeping its id, or a removal and an add",
        async (host) => {
          const before = fileIn(await currentSnapshot(host), "data/items.json");
          const sub = await watch(host);
          await host.external.rename("data/items.json", "data/moved.json");
          await host.settle();
          const files = fileEvents(sub.events);
          for (const event of files) {
            expect(event.origin, "a move outside the host is external").toBe("external");
          }
          if (files.length === 1) {
            expect(files[0], "a paired move keeps the id").toEqual({
              docId: before.docId,
              from: "data/items.json",
              isDir: false,
              origin: "external",
              rev: files[0]!.rev,
              to: "data/moved.json",
              type: "fileRenamed",
            });
          } else {
            // The two may arrive in either order: a watcher reports the add and the removal apart.
            expect(files.map((event) => event.type).toSorted(), "an unpaired move").toEqual([
              "fileAdded",
              "fileRemoved",
            ]);
          }
          const after = await currentSnapshot(host);
          expect(fileIn(after, "data/moved.json").hash, "the moved bytes").toBe(before.hash);
          expectStream(sub);
        },
      );
    });

    // ─── §3 Subscription ───────────────────────────────────────────────────────────────────
    describe("§3 subscription", () => {
      hostCase("a first subscribe gets a snapshot, with or without a client id", async (host) => {
        const plain = await host.subscribe({});
        const named = await host.subscribe({ clientId: "conformance-window" });
        for (const sub of [plain, named]) {
          const snapshot = snapshotOf(sub.response);
          expect(sub.response.epoch === "", "the answer names its epoch").toBe(false);
          expect(Array.isArray(snapshot.components), "the snapshot carries components").toBe(true);
          sub.close();
        }
        expect(named.response.rev, "both answers are at the same revision").toBe(
          plain.response.rev,
        );
      });

      hostCase("the first streamed event follows the snapshot's revision", async (host) => {
        const sub = await watch(host);
        await writeOver(host, "styles/site.css", "html { color: black; }\n");
        await host.settle();
        expect(sub.events[0]?.rev, "the first event is rev + 1").toBe(sub.response.rev + 1);
        expectStream(sub);
      });

      hostCase("a resubscribe inside the window gets exactly the missed events", async (host) => {
        const live = await watch(host);
        const away = await host.subscribe({});
        away.close();
        await writeOver(host, "pages/index.json", json({ tagName: "main", textContent: "1" }));
        await host.external.write("styles/site.css", "p { margin: 0; }\n");
        await host.settle();
        const back = await host.subscribe({
          epoch: away.response.epoch,
          sinceRev: away.response.rev,
        });
        const answer = back.response;
        expect(eventsOf(answer), "exactly the events a live subscriber received").toEqual(
          live.events,
        );
        expect(answer.rev, "the answer names the newest revision").toBe(
          live.events.at(-1)?.rev ?? live.response.rev,
        );
        const current = await host.subscribe({ epoch: answer.epoch, sinceRev: answer.rev });
        expect(current.response, "an up-to-date client gets no events").toEqual({
          epoch: answer.epoch,
          events: [],
          kind: "events",
          rev: answer.rev,
        });
        back.close();
        current.close();
        expectStream(live);
      });

      hostCase("an unknown epoch or a revision ahead of the host gets a snapshot", async (host) => {
        const first = await host.subscribe({});
        first.close();
        const stranger = await host.subscribe({ epoch: "not-this-epoch", sinceRev: 0 });
        const ahead = await host.subscribe({
          epoch: first.response.epoch,
          sinceRev: first.response.rev + 1000,
        });
        for (const sub of [stranger, ahead]) {
          snapshotOf(sub.response);
          expect(sub.response.epoch, "the host's own epoch").toBe(first.response.epoch);
          sub.close();
        }
      });

      hostCase(
        "a resubscribe outside the window gets a snapshot",
        async (host) => {
          const away = await host.subscribe({});
          away.close();
          for (let at = 0; at < 6; at += 1) {
            await writeOver(host, "styles/site.css", `p { order: ${at}; }\n`);
          }
          await host.settle();
          const back = await host.subscribe({
            epoch: away.response.epoch,
            sinceRev: away.response.rev,
          });
          const snapshot = snapshotOf(back.response);
          expect(fileIn(snapshot, "styles/site.css").hash, "the snapshot is current").toBe(
            await hashOf("p { order: 5; }\n"),
          );
          back.close();
        },
        { logCapacity: 4 },
      );

      hostCase(
        "a resubscribe after a restart gets a snapshot or exactly the missed events",
        async (host) => {
          const before = await host.subscribe({});
          await writeOver(host, "pages/index.json", json({ tagName: "main", textContent: "kept" }));
          await host.settle();
          const missed = [...before.events];
          await host.restart();
          await host.settle();
          const after = await host.subscribe({
            epoch: before.response.epoch,
            sinceRev: before.response.rev,
          });
          if (driver.persistentLog) {
            expect(after.response.epoch, "a persisted log keeps its epoch").toBe(
              before.response.epoch,
            );
            const replayed = eventsOf(after.response);
            expect(replayed.slice(0, missed.length), "the events before the restart").toEqual(
              missed,
            );
          } else {
            expect(before.ended, "a restart ends the subscription").toBe(true);
            expect(after.response.epoch === before.response.epoch, "a new epoch").toBe(false);
            const snapshot = snapshotOf(after.response);
            expect(fileIn(snapshot, "pages/index.json").hash, "the snapshot holds the write").toBe(
              await hashOf(json({ tagName: "main", textContent: "kept" })),
            );
          }
          after.close();
        },
      );

      hostCase("a snapshot replaces the state rather than adding to it", async (host) => {
        const before = fileIn(await currentSnapshot(host), "data/items.json");
        await host.delete({
          base: { hash: before.hash! },
          path: "data/items.json",
          writeId: nextWriteId(),
        });
        await host.settle();
        const after = await currentSnapshot(host);
        expect(
          after.files.some((file) => file.path === "data/items.json"),
          "a removed file is gone from the snapshot",
        ).toBe(false);
      });

      hostCase(
        "a host below indexed answers a snapshot, and docChanged fills it in",
        async (host) => {
          const sub = await watch(host);
          const snapshot = snapshotOf(sub.response);
          expect(
            stepOf(snapshot.readiness) < stepOf("indexed"),
            `a held host is below indexed (${snapshot.readiness})`,
          ).toBe(true);
          await host.release();
          await host.settle();
          const view = new Map<string, Partial<IndexedFile>>(
            snapshot.files.map((file) => [file.path, { ...file }]),
          );
          for (const [at, event] of sub.events.entries()) {
            if (event.type === "fileAdded") {
              view.set(event.path, { docId: event.docId });
            } else if (event.type === "docChanged") {
              const entry = view.get(event.path);
              expect(entry?.docId, `docChanged names ${event.path}'s document`).toBe(event.docId);
              Object.assign(entry!, { hash: event.hash, indexed: event.indexed, kind: event.kind });
              const cause = sub.events[at - 1];
              const followsItsFileEvent =
                (cause?.type === "fileAdded" || cause?.type === "fileChanged") &&
                cause.docId === event.docId;
              if (!followsItsFileEvent) {
                expect(event.origin, `indexing ${event.path} is external, not a write`).toBe(
                  "external",
                );
              }
            }
          }
          for (const path of IN_SCOPE) {
            const entry = view.get(path);
            expect(entry?.hash, `${path} is hashed once indexed`).toBe(
              await hashOf(CONFORMANCE_FIXTURE[path]!),
            );
            expectIndexed(path, entry?.indexed);
          }
          for (const [path, kind] of Object.entries(EXPECTED_KINDS)) {
            expect(view.get(path)?.kind, `${path} is classified once indexed`).toBe(kind);
          }
          const states = ofType(sub.events, "readiness").map((event) => event.state);
          expect(states.at(-1), "the host reaches ready").toBe("ready");
          expectStream(sub);
        },
        { hold: true },
      );
    });

    // ─── §4 Events ─────────────────────────────────────────────────────────────────────────
    describe("§4 events", () => {
      hostCase("an external change is a fileChanged and its docChanged", async (host) => {
        const sub = await watch(host);
        const next = "body { margin: 1px; }\n";
        await host.external.write("styles/site.css", next);
        await host.settle();
        const events = changes(sub.events);
        const changed = one(events[0], "fileChanged", "the file event comes first");
        expect(changed.origin, "an external change").toBe("external");
        const onDisk = await host.read("styles/site.css");
        expect(changed.hash, "the hash of the bytes on disk").toBe(await contentHash(onDisk!));
        expectDocChangedAfter(events, 0);
        expectStream(sub);
      });

      hostCase("an external add and removal name the file and its id", async (host) => {
        const sub = await watch(host);
        await host.external.write("pages/new.json", json({ tagName: "main" }));
        await host.settle();
        const [added] = ofType(sub.events, "fileAdded");
        expect(added?.isDir, "a file").toBe(false);
        expect(added?.hash, "hashed").toBe(await hashOf(json({ tagName: "main" })));
        expectDocChangedAfter(changes(sub.events), 0);
        await host.external.remove("pages/new.json");
        await host.settle();
        const [removed] = ofType(sub.events, "fileRemoved");
        expect(removed, "its removal").toEqual({
          docId: added!.docId,
          isDir: false,
          origin: "external",
          path: "pages/new.json",
          rev: removed!.rev,
          type: "fileRemoved",
        });
        expectStream(sub);
      });

      hostCase("a directory removal is one event", async (host) => {
        const snapshot = await currentSnapshot(host);
        const dir = fileIn(snapshot, "content");
        const files = Object.fromEntries(
          snapshot.files
            .filter((file) => !file.isDir && file.path.startsWith("content/"))
            .map((file) => [file.path.slice("content/".length), file.hash!]),
        );
        const sub = await watch(host);
        const writeId = nextWriteId();
        const result = await host.delete({ base: { files }, path: "content", writeId });
        await host.settle();
        expect(changes(sub.events), "one fileRemoved for the directory").toEqual([
          {
            docId: dir.docId,
            isDir: true,
            origin: { writeHash: null, writeId },
            path: "content",
            rev: result.ok ? result.rev : -1,
            type: "fileRemoved",
          },
        ]);
        expect(await host.read("content/posts/hello.md"), "its files are gone").toBe(null);
        expectStream(sub);
      });

      hostCase("creating a directory carries the writer's origin", async (host) => {
        const sub = await watch(host);
        const writeId = nextWriteId();
        const { rev } = await host.createDirectory("drafts", writeId);
        await host.settle();
        const events = changes(sub.events);
        expect(events.length, "one fileAdded, and no docChanged for a directory").toBe(1);
        const added = one(events[0], "fileAdded", "a fileAdded");
        expect(
          { hash: added.hash, isDir: added.isDir, path: added.path, rev: added.rev },
          "a directory has no hash",
        ).toEqual({ hash: undefined, isDir: true, path: "drafts", rev });
        expect(writeIdOf(added.origin), "the writer's id").toBe(writeId);
        expectStream(sub);
      });

      hostCase("componentsChanged carries the whole set when it changes", async (host) => {
        const snapshot = await currentSnapshot(host);
        expect(snapshot.components.includes("my-card"), "the snapshot's components").toBe(true);
        const sub = await watch(host);
        await writeOver(host, "components/my-card.json", json({ tagName: "my-card", id: "x" }));
        await host.settle();
        expect(ofType(sub.events, "componentsChanged"), "the set did not change").toEqual([]);
        await host.write({
          baseHash: null,
          contents: json({ tagName: "my-badge" }),
          path: "components/my-badge.json",
          writeId: nextWriteId(),
        });
        await host.settle();
        const [grown] = ofType(sub.events, "componentsChanged");
        expect(grown!.tags.toSorted(), "the whole set after the add").toEqual(
          [...new Set([...snapshot.components, "my-badge"])].toSorted(),
        );
        const badge = await host.read("components/my-badge.json");
        await host.delete({
          base: { hash: await contentHash(badge!) },
          path: "components/my-badge.json",
          writeId: nextWriteId(),
        });
        await host.settle();
        const [, shrunk] = ofType(sub.events, "componentsChanged");
        expect(shrunk!.tags.toSorted(), "the whole set after the removal").toEqual(
          snapshot.components.toSorted(),
        );
        const after = await currentSnapshot(host);
        expect(after.components.toSorted(), "the snapshot agrees").toEqual(
          snapshot.components.toSorted(),
        );
        expectStream(sub);
      });

      hostCase("a configuration change is a projectConfigChanged", async (host) => {
        const sub = await watch(host);
        const next = json({ ...CONFIG, name: "Renamed" });
        const write = await writeOver(host, CONFIG_FILE, next);
        await host.settle();
        const [config] = ofType(sub.events, "projectConfigChanged");
        expect(config, "it names the configuration and its new hash").toEqual({
          hash: await hashOf(next),
          origin: config!.origin,
          path: CONFIG_FILE,
          rev: config!.rev,
          type: "projectConfigChanged",
        });
        expect(config!.rev > write.rev, "after the file event").toBe(true);
        expect(ofType(sub.events, "formatsChanged"), "the format set did not change").toEqual([]);
        expectStream(sub);
      });

      hostCase("a formatsChanged token is the one the next snapshot carries", async (host) => {
        const sub = await watch(host);
        await writeOver(
          host,
          CONFIG_FILE,
          json({ ...CONFIG, extensions: ["./extensions/noop.js"] }),
        );
        await host.settle();
        const tokens = ofType(sub.events, "formatsChanged").map((event) => event.formats);
        const snapshot = await currentSnapshot(host);
        expect(snapshot.formats, "the snapshot carries the newest token").toBe(
          tokens.at(-1) ?? snapshotOf(sub.response).formats,
        );
        expectStream(sub);
      });

      if (driver.graph === undefined) {
        // Without §8 a host has no dependents to report, so it reports none.
        hostCase("a host without a graph emits no dependentsInvalidated", async (host) => {
          const sub = await watch(host);
          await host.external.write("layouts/base.json", json({ tagName: "section" }));
          await host.settle();
          expect(ofType(sub.events, "dependentsInvalidated"), "no graph, no dependents").toEqual(
            [],
          );
          expectStream(sub);
        });
      }

      if (driver.rename === undefined) {
        hostCase("a host without the rename cascade emits no operationApplied", async (host) => {
          const sub = await watch(host);
          await writeOver(host, "data/items.json", json([]));
          await host.settle();
          expect(ofType(sub.events, "operationApplied"), "no operations").toEqual([]);
          expectStream(sub);
        });
      }

      /*
       * A hook replaces the negative case above with the cases of its section. Until §9's cases
       * are written, declaring its hook registers one that fails, so a hook can never switch a
       * check off without switching another on.
       */
      if (driver.rename !== undefined) {
        hostCase("the §9 cases a declared hook asks for exist", async () => {
          expect(false, "the suite has no §9 cases yet, so a driver may not declare its hook").toBe(
            true,
          );
        });
      }

      hostCase("a degraded watcher is reported, and recovery starts a new epoch", async (host) => {
        if (host.watcher === undefined) {
          // A host with no watcher (the cloud, §10.3) cannot degrade; nothing to check.
          return;
        }
        const sub = await watch(host);
        await host.watcher.degrade("watch limit reached");
        await host.settle();
        expect(ofType(sub.events, "watcherDegraded").length, "watcherDegraded").toBe(1);
        expectStream(sub);
        await host.watcher.recover();
        await host.settle();
        expect(sub.ended, "recovery ends every subscription").toBe(true);
        const back = await host.subscribe({
          epoch: sub.response.epoch,
          sinceRev: sub.events.at(-1)!.rev,
        });
        expect(back.response.epoch === sub.response.epoch, "a new epoch").toBe(false);
        snapshotOf(back.response);
        back.close();
      });
    });

    // ─── §8 Dependency graph ───────────────────────────────────────────────────────────────
    const { graph } = driver;
    if (graph !== undefined) {
      /**
       * The `dependentsInvalidated` events `cause` produced through `kind`, each well-formed: its
       * dependents listed once, never the cause, complete when the host's graph is (§8, §8.2).
       */
      const invalidatedBy = (
        events: readonly ProjectEvent[],
        cause: string,
        kind: DependencyKind,
      ): Extract<ProjectEvent, { type: "dependentsInvalidated" }>[] => {
        const found = ofType(events, "dependentsInvalidated").filter(
          (event) => event.cause.docId === cause && event.cause.kind === kind,
        );
        for (const event of found) {
          expect(new Set(event.docIds).size, "each dependent at most once").toBe(
            event.docIds.length,
          );
          expect(event.docIds.includes(cause), "the cause is not its own dependent").toBe(false);
          if (graph.complete) {
            expect(event.complete, "a complete graph's invalidation is complete").toBe(true);
          } else {
            expect(BOOLEANS.has(event.complete), "it says whether it is complete").toBe(true);
          }
        }
        return found;
      };

      describe("§8 dependency graph", () => {
        hostCase("deleting a component invalidates its instances", async (host) => {
          const snapshot = await currentSnapshot(host);
          const card = fileIn(snapshot, "components/my-card.json");
          const about = fileIn(snapshot, "pages/about.json");
          const home = fileIn(snapshot, "pages/index.json");
          const sub = await watch(host);
          const result = await host.delete({
            base: { hash: card.hash! },
            path: "components/my-card.json",
            writeId: nextWriteId(),
          });
          await host.settle();
          expect(result.ok, "the delete is accepted").toBe(true);
          const [removed] = ofType(sub.events, "fileRemoved");
          const found = invalidatedBy(sub.events, card.docId, "component-instance");
          expect(found.length, "one event for the kind").toBe(1);
          expect(found[0]!.docIds.includes(about.docId), "the page using the tag").toBe(true);
          expect(found[0]!.docIds.includes(home.docId), "not a page without the tag").toBe(false);
          expect(found[0]!.tags.includes("my-card"), "the definition's tag").toBe(true);
          expect(found[0]!.rev > removed!.rev, "after the file event").toBe(true);
          expectStream(sub);
        });

        hostCase(
          "renaming a media file outside Studio invalidates the documents that reference it",
          async (host) => {
            const snapshot = await currentSnapshot(host);
            const logo = fileIn(snapshot, "media/logo.png");
            const about = fileIn(snapshot, "pages/about.json");
            const home = fileIn(snapshot, "pages/index.json");
            const sub = await watch(host);
            await host.external.rename("media/logo.png", "media/brand.png");
            await host.settle();
            // A paired move is a fileRenamed, an unpaired one a removal; either names the logo.
            const moved = fileEvents(sub.events).find(
              (event) => event.docId === logo.docId && event.type !== "fileAdded",
            );
            expect(moved === undefined, "the move names the logo").toBe(false);
            const found = invalidatedBy(sub.events, logo.docId, "media-referrer");
            expect(found.length, "one event for the kind").toBe(1);
            expect(found[0]!.docIds.includes(about.docId), "the page that shows it").toBe(true);
            expect(found[0]!.docIds.includes(home.docId), "not a page that does not").toBe(false);
            expect(found[0]!.rev > moved!.rev, "after the file event").toBe(true);
            expectStream(sub);
          },
        );

        hostCase(
          "editing the default layout invalidates the pages that name no layout",
          async (host) => {
            await writeOver(host, "pages/bare.json", json({ $layout: false, tagName: "main" }));
            await host.settle();
            const snapshot = await currentSnapshot(host);
            const layout = fileIn(snapshot, "layouts/base.json");
            const sub = await watch(host);
            await host.external.write(
              "layouts/base.json",
              json({ children: [{ tagName: "slot" }], tagName: "section" }),
            );
            await host.settle();
            const changed = ofType(sub.events, "docChanged").find(
              (event) => event.docId === layout.docId,
            );
            const found = invalidatedBy(sub.events, layout.docId, "layout-page");
            expect(found.length, "one event for the kind").toBe(1);
            const pages = ["pages/index.json", "pages/about.json"].map(
              (path) => fileIn(snapshot, path).docId,
            );
            expect(
              pages.every((docId) => found[0]!.docIds.includes(docId)),
              "every page that falls back to the default",
            ).toBe(true);
            expect(
              found[0]!.docIds.includes(fileIn(snapshot, "pages/bare.json").docId),
              "not a page whose $layout is false",
            ).toBe(false);
            expect(found[0]!.rev > changed!.rev, "after the layout's docChanged").toBe(true);
            expectStream(sub);
          },
        );
      });
    }

    // ─── §5 Writes and preconditions ───────────────────────────────────────────────────────
    describe("§5 writes and preconditions", () => {
      hostCase("a write answers the revision of its own file event, once", async (host) => {
        const sub = await watch(host);
        const next = json({ tagName: "main", textContent: "Written" });
        const write = await writeOver(host, "pages/index.json", next);
        await host.settle();
        const events = changes(sub.events);
        expect(
          events.map((event) => event.type),
          "the file event and its docChanged, and nothing for the watcher's echo",
        ).toEqual(["fileChanged", "docChanged"]);
        expect(events[0]!.rev, "the reply's revision is the file event's").toBe(write.rev);
        expect(write.hash, "the reply's hash").toBe(await hashOf(next));
        expect(events[0]!.origin, "the write's origin").toEqual({
          writeHash: await hashOf(next),
          writeId: write.writeId,
        });
        expectDocChangedAfter(events, 0);
        expect(await host.read("pages/index.json"), "the bytes are on disk").toEqual(bytesOf(next));
        expectStream(sub);
      });

      hostCase("a create with a null base adds the file", async (host) => {
        const sub = await watch(host);
        const writeId = nextWriteId();
        const result = await host.write({
          baseHash: null,
          contents: json({ tagName: "main" }),
          path: "pages/created.json",
          writeId,
        });
        await host.settle();
        const events = changes(sub.events);
        expect(events[0]?.type, "a fileAdded").toBe("fileAdded");
        expect(events[0]?.rev, "at the reply's revision").toBe(result.ok ? result.rev : -1);
        expect(writeIdOf(events[0]?.origin), "with its origin").toBe(writeId);
        expectDocChangedAfter(events, 0);
        expectStream(sub);
      });

      hostCase("binary contents are hashed and stored as bytes", async (host) => {
        const bytes = new Uint8Array([0, 1, 2, 0xff, 0xfe]);
        const result = await host.write({
          baseHash: null,
          contents: bytes,
          path: "media/blob.bin",
          writeId: nextWriteId(),
        });
        expect(result.ok ? result.hash : null, "the hash of the bytes").toBe(
          await contentHash(bytes),
        );
        expect(await host.read("media/blob.bin"), "the bytes round-trip").toEqual(bytes);
      });

      hostCase(
        "a write with a stale base is refused and leaves the disk untouched",
        async (host) => {
          const before = fileIn(await currentSnapshot(host), "pages/index.json");
          const sub = await watch(host);
          const writeId = nextWriteId();
          const stale = await hashOf("not what is on disk");
          const result = await host.write({
            baseHash: stale,
            bufferRev: 7,
            contents: "lost",
            path: "pages/index.json",
            writeId,
          });
          await host.settle();
          expect(result, "the conflict names what is there").toEqual({
            conflict: { diskHash: before.hash, docId: before.docId, path: "pages/index.json" },
            ok: false,
          });
          expect(await host.read("pages/index.json"), "the disk is untouched").toEqual(
            bytesOf(CONFORMANCE_FIXTURE["pages/index.json"]!),
          );
          expect(changes(sub.events), "only the conflict event").toEqual([
            {
              bufferRev: 7,
              diskHash: before.hash,
              docId: before.docId,
              origin: "external",
              path: "pages/index.json",
              rev: sub.response.rev + 1,
              type: "conflict",
              writeId,
            },
          ]);
          expectStream(sub);
        },
      );

      hostCase("a create over an existing file is refused", async (host) => {
        const before = fileIn(await currentSnapshot(host), "styles/site.css");
        const sub = await watch(host);
        const writeId = nextWriteId();
        const result = await host.write({
          baseHash: null,
          contents: "overwrite",
          path: "styles/site.css",
          writeId,
        });
        await host.settle();
        expect(result.ok, "refused").toBe(false);
        const [conflict] = ofType(sub.events, "conflict");
        expect(conflict?.writeId, "the conflict names the request").toBe(writeId);
        expect(conflict?.diskHash, "and what is on disk").toBe(before.hash);
        expect(conflict?.bufferRev, "no buffer revision was sent").toBeUndefined();
        expectStream(sub);
      });

      hostCase("a write of the bytes already on disk emits nothing", async (host) => {
        const sub = await watch(host);
        const contents = CONFORMANCE_FIXTURE["pages/index.json"]!;
        const hash = await hashOf(contents);
        const result = await host.write({
          baseHash: hash,
          contents,
          path: "pages/index.json",
          writeId: nextWriteId(),
        });
        await host.settle();
        expect(result, "the current revision and the hash").toEqual({
          hash,
          ok: true,
          rev: sub.response.rev,
        });
        expect(sub.events, "no event").toEqual([]);
        expectStream(sub);
      });

      hostCase("two writes on the same base: exactly one is accepted", async (host) => {
        const base = await hashOf(CONFORMANCE_FIXTURE["data/items.json"]!);
        const results = await Promise.all(
          ["[1]\n", "[2]\n"].map((contents) =>
            host.write({
              baseHash: base,
              contents,
              path: "data/items.json",
              writeId: nextWriteId(),
            }),
          ),
        );
        expect(
          results.map((result) => result.ok).toSorted(),
          "the precondition and the write are atomic",
        ).toEqual([false, true]);
      });

      hostCase("an own delete removes the file and carries its origin", async (host) => {
        const before = fileIn(await currentSnapshot(host), "data/items.json");
        const sub = await watch(host);
        const writeId = nextWriteId();
        const result = await host.delete({
          base: { hash: before.hash! },
          path: "data/items.json",
          writeId,
        });
        await host.settle();
        expect(result, "the revision of its fileRemoved").toEqual({
          ok: true,
          rev: sub.response.rev + 1,
        });
        expect(changes(sub.events), "one fileRemoved, nothing for the watcher").toEqual([
          {
            docId: before.docId,
            isDir: false,
            origin: { writeHash: null, writeId },
            path: "data/items.json",
            rev: sub.response.rev + 1,
            type: "fileRemoved",
          },
        ]);
        expect(await host.read("data/items.json"), "gone from disk").toBe(null);
        expectStream(sub);
      });

      hostCase("a delete with a stale base is refused and leaves the file", async (host) => {
        const before = fileIn(await currentSnapshot(host), "data/items.json");
        const sub = await watch(host);
        const writeId = nextWriteId();
        const result = await host.delete({
          base: { hash: await hashOf("stale") },
          path: "data/items.json",
          writeId,
        });
        await host.settle();
        expect(result, "refused with what is there").toEqual({
          conflict: { diskHash: before.hash, docId: before.docId, path: "data/items.json" },
          ok: false,
        });
        expect(await host.read("data/items.json"), "the file is untouched").toEqual(
          bytesOf(CONFORMANCE_FIXTURE["data/items.json"]!),
        );
        expect(ofType(sub.events, "conflict")[0]?.writeId, "the conflict event").toBe(writeId);
        const missing = await host.delete({
          base: { hash: before.hash! },
          path: "data/none.json",
          writeId: nextWriteId(),
        });
        expect(missing, "deleting nothing is a conflict naming nothing").toEqual({
          conflict: { diskHash: null, docId: null, path: "data/none.json" },
          ok: false,
        });
        await host.settle();
        expectStream(sub);
      });

      for (const [what, change] of [
        ["added", (host) => host.external.write("content/posts/second.md", "# Second\n")],
        ["changed", (host) => host.external.write("content/posts/hello.md", "# Changed\n")],
        ["removed", (host) => host.external.remove("content/posts/hello.md")],
      ] as const satisfies readonly [string, (host: ProjectStateHost) => Promise<void>][]) {
        hostCase(
          `a directory delete is refused when a file beneath it was ${what}`,
          async (host) => {
            const snapshot = await currentSnapshot(host);
            const files = Object.fromEntries(
              snapshot.files
                .filter((file) => !file.isDir && file.path.startsWith("content/"))
                .map((file) => [file.path.slice("content/".length), file.hash!]),
            );
            await change(host);
            await host.settle();
            const remaining = await host.read("content/posts/hello.md");
            const result = await host.delete({
              base: { files },
              path: "content",
              writeId: nextWriteId(),
            });
            expect(result.ok, `a file ${what} since the base is a conflict`).toBe(false);
            expect(await host.read("content/posts/hello.md"), "nothing was removed").toEqual(
              remaining,
            );
            fileIn(await currentSnapshot(host), "content");
          },
        );
      }
    });

    // ─── §7 Readiness and §4.5 git ─────────────────────────────────────────────────────────
    describe("§7 readiness", () => {
      hostCase(
        "readiness advances one state at a time, in order, to ready",
        async (host) => {
          const sub = await watch(host);
          await host.release();
          await host.settle();
          let at = stepOf(snapshotOf(sub.response).readiness);
          for (const event of ofType(sub.events, "readiness")) {
            expect(stepOf(event.state), `${event.state} is the next state`).toBe(at + 1);
            at = stepOf(event.state);
          }
          expect(READINESS_ORDER[at], "the host reaches ready").toBe("ready");
          const after = await currentSnapshot(host);
          expect(after.readiness, "the snapshot carries it").toBe("ready");
          expectStream(sub);
        },
        { hold: true },
      );

      hostCase("an install's own lockfile write does not move readiness back", async (host) => {
        const sub = await watch(host);
        // A dependency change first, so the install has to write a lockfile it did not have.
        await writeOver(
          host,
          "package.json",
          json({ ...MANIFEST, dependencies: { noop: "file:./vendor/noop" } }),
        );
        await host.settle();
        const before = await lockfilesOf(host);
        const from = sub.events.length;
        await host.install();
        await host.settle();
        await host.settle();
        expect((await lockfilesOf(host)) === before, "the install wrote a lockfile").toBe(false);
        const after = sub.events.slice(from);
        const states = ofType(after, "readiness").map((event) => event.state);
        const prior = ofType(sub.events.slice(0, from), "readiness").at(-1)?.state;
        let at = stepOf(prior ?? snapshotOf(sub.response).readiness);
        for (const state of states) {
          expect(stepOf(state), `${state} is the next state, never an earlier one`).toBe(at + 1);
          at = stepOf(state);
        }
        expect(READINESS_ORDER[at], "the install brings the host to ready").toBe("ready");
        for (const event of fileEvents(after)) {
          expect(event.origin === "external", "an install's writes carry its write id").toBe(false);
        }
        expectStream(sub);
      });

      hostCase("an external lockfile change moves readiness back to scaffolded", async (host) => {
        const [lockfile] = await presentLockfiles(host);
        expect(lockfile === undefined, "the fixture has a lockfile").toBe(false);
        const sub = await watch(host);
        await host.external.write(lockfile!, '{"lockfileVersion":1,"changed":true}\n');
        await host.settle();
        const states = ofType(sub.events, "readiness").map((event) => event.state);
        expect(states[0], "back to scaffolded").toBe("scaffolded");
        expectStream(sub);
      });

      hostCase("a manifest edit that leaves the dependencies alone moves nothing", async (host) => {
        const sub = await watch(host);
        await writeOver(
          host,
          "package.json",
          json({ ...MANIFEST, scripts: { build: "jx build" } }),
        );
        await host.settle();
        expect(ofType(sub.events, "readiness"), "readiness stays").toEqual([]);
        expectStream(sub);
      });

      hostCase("a dependency change moves back to scaffolded until an install", async (host) => {
        const sub = await watch(host);
        await writeOver(
          host,
          "package.json",
          json({ ...MANIFEST, dependencies: { noop: "file:./vendor/noop" } }),
        );
        await host.settle();
        const dropped = ofType(sub.events, "readiness").map((event) => event.state);
        expect(dropped[0], "back to scaffolded").toBe("scaffolded");
        await host.install();
        await host.settle();
        const states = ofType(sub.events, "readiness").map((event) => event.state);
        for (let at = 1; at < states.length; at += 1) {
          expect(stepOf(states[at]!), `${states[at]} follows ${states[at - 1]}`).toBe(
            stepOf(states[at - 1]!) + 1,
          );
        }
        expect(states.at(-1), "an install brings it back to ready").toBe("ready");
        expectStream(sub);
      });

      hostCase("only a change to the extension set moves back to installed", async (host) => {
        const sub = await watch(host);
        await writeOver(host, CONFIG_FILE, json({ ...CONFIG, name: "Still the same set" }));
        await host.settle();
        expect(ofType(sub.events, "readiness"), "another configuration change").toEqual([]);
        await writeOver(
          host,
          CONFIG_FILE,
          json({ ...CONFIG, extensions: ["./extensions/noop.js"] }),
        );
        await host.settle();
        const states = ofType(sub.events, "readiness").map((event) => event.state);
        expect(states[0], "back to installed").toBe("installed");
        expect(states.at(-1), "and on to ready").toBe("ready");
        expectStream(sub);
      });
    });

    describe("§4.5 git", () => {
      hostCase("the snapshot carries the repository's summary", async (host) => {
        const { git } = await currentSnapshot(host);
        expect(git === undefined, "the fixture is a repository").toBe(false);
        expect(git?.branch === null, "a branch is checked out").toBe(false);
        expect(git?.head === null, "a head commit").toBe(false);
        expect(git?.changed, "a clean fixture").toEqual({});
      });

      hostCase("gitChanged reports working-tree changes once each", async (host) => {
        const sub = await watch(host);
        await writeOver(host, "styles/site.css", "a { color: red; }\n");
        await host.external.write("pages/untracked.json", json({ tagName: "main" }));
        await host.settle();
        await host.settle();
        const reports = ofType(sub.events, "gitChanged");
        expect(reports.length > 0, "the change is reported").toBe(true);
        expect(reports.at(-1)!.status.changed, "each path's working state").toEqual({
          "pages/untracked.json": "untracked",
          "styles/site.css": "modified",
        });
        const summaries = reports.map((report) => JSON.stringify(report.status));
        expect(new Set(summaries).size, "never the same summary twice").toBe(summaries.length);
        expectStream(sub);
      });

      hostCase("gitChanged follows a commit made outside Studio", async (host) => {
        const { git: before } = await currentSnapshot(host);
        await writeOver(host, "styles/site.css", "a { color: blue; }\n");
        await host.settle();
        const sub = await watch(host);
        await host.commit("outside");
        await host.settle();
        const [report] = ofType(sub.events, "gitChanged");
        expect(report === undefined, "the commit is reported").toBe(false);
        expect(report!.status.head === before?.head, "a new head").toBe(false);
        expect(report!.status.changed, "nothing left to commit").toEqual({});
        expect(changes(sub.events), "a commit changes no file").toEqual([]);
        expectStream(sub);
      });
    });
  });
}

/**
 * Register the conformance suite for one host (§10.4). Call it at a test file's top level with the
 * host's driver and the runner's `describe`, `test` and `expect`.
 */
export function runProjectStateConformance(
  driver: ProjectStateDriver,
  api: ConformanceTestApi,
): void {
  registerCases(driver, api);
}
