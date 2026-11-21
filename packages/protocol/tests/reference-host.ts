/**
 * An in-memory reference host for the project state contract (`specs/project-state.md`), built only
 * to prove the conformance suite (§10.4) can be passed: it is not a production host.
 *
 * It models a watcher-backed host over a `Map` of files. Every change to the disk, its own writes
 * included, queues a watcher observation carrying the bytes the watcher read at that moment, and
 * `settle()` processes the queue in order, so an observation compared after later writes is stale
 * exactly as §2.4 describes. Removals are held for the pairing bound on a virtual clock, which the
 * driver advances for a save slower than the bound.
 *
 * The `bugs` option breaks one rule at a time, so the suite's own tests can prove each case fails a
 * host that breaks it.
 */

import {
  answerSubscribe,
  checkDeletePrecondition,
  checkWritePrecondition,
  conflictEvent,
  contentHash,
  createEchoLedger,
  createMemoryEventLog,
  READINESS_ORDER,
  readinessAtLeast,
} from "../src/project-state";
import { decodeCloudHostMessage, encodeCloudEvents } from "../src/project-state-frames";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type {
  ContentHash,
  DeleteBase,
  DocKind,
  EchoLedger,
  EventOrigin,
  GitSummary,
  IndexedFile,
  ProjectEvent,
  ProjectEventInit,
  ProjectEventLog,
  ProjectSnapshot,
  ReadinessState,
  WorkingState,
} from "../src/project-state";
import type {
  FixtureFiles,
  ProjectStateDriver,
  ProjectStateHost,
  ProjectStateHostOptions,
  ProjectStateSubscription,
} from "../src/project-state-conformance";

/** A rule the reference host can be told to break. */
export type ReferenceBug =
  /** Report the watcher's echo of an own write as an external change (no ledger, no index check). */
  | "echo"
  /** Write without checking the base. */
  | "no-precondition"
  /** Answer a resubscribe outside the window with the events the window still holds. */
  | "subset-replay"
  /** Mint a new document id for an atomic-rename save inside the bound. */
  | "atomic-new-id"
  /**
   * Run an install as an outside process would: its lockfile write is neither recorded as its own
   * nor followed by a fresh fingerprint, so the watcher's report of it moves readiness back.
   */
  | "install-moves-readiness"
  /** Attribute an observation to any write ever made at the path, not only a pending one (§2.4). */
  | "ledger-never-clears"
  /** Give the `docChanged` events that fill in a held host's index a write origin (§4.3). */
  | "index-fill-write-origin"
  /** Leave every file `indexed: false` after indexing (§3.1). */
  | "unindexed"
  /** Skip a revision now and then. */
  | "revision-gap"
  /** Deliver every event with an origin the contract does not have. */
  | "malformed-event";

export interface ReferenceHostOptions extends ProjectStateHostOptions {
  /** The pairing bound for an atomic-rename save (§2.4). */
  atomicSaveMs?: number;
  /** Keep the log and its epoch across a restart, as the cloud host does (§10.3). */
  persistentLog?: boolean;
  /** Offer the watcher hook (§4.8). */
  watcher?: boolean;
  /** Offer `external.symlink`; storage without links (the cloud's) does not. */
  symlinks?: boolean;
  /** Pair a watcher-observed move by hash into one `fileRenamed` (§4.2 allows either). */
  pairMoves?: boolean;
  bugs?: readonly ReferenceBug[];
}

interface Entry {
  docId: string;
  isDir: boolean;
  hash?: ContentHash;
  kind: DocKind;
  indexed: boolean;
}

interface Observation {
  path: string;
  /** What the watcher read; `null` for a removal. */
  bytes: Uint8Array | null;
  at: number;
}

interface Subscriber {
  events: ProjectEvent[];
  ended: boolean;
}

const IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".jx",
  ".cache",
  ".devenv",
  ".direnv",
]);
const IGNORED_NAMES = new Set(["bun.lock", "bun.lockb"]);
/** The lockfiles a fingerprint covers (§7): Bun's, outside the index scope, and npm's, inside it. */
const LOCKFILES = ["bun.lock", "package-lock.json"];
const CONFIG_PATH = "project.json";
const MEDIA = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mp3|woff2?)$/i;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** An event whose origin names nobody, as a broken host might send it. */
function misattribute(event: ProjectEvent): ProjectEvent {
  const text = JSON.stringify({ ...event, origin: "nobody" });
  /* SAFETY: deliberately not a ProjectEvent; the suite must refuse it, which is the point. */
  return JSON.parse(text) as ProjectEvent;
}

/**
 * Whether a path is inside the index scope (§2.2), given the build output directory the
 * configuration names (`build.outDir`), project-relative without a leading `./`.
 */
export function inScope(path: string, outDir = "dist"): boolean {
  const segments = path.split("/");
  return (
    !segments.some((segment) => IGNORED_SEGMENTS.has(segment)) &&
    !IGNORED_NAMES.has(segments.at(-1)!) &&
    path !== outDir &&
    !path.startsWith(`${outDir}/`)
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBytes = (contents: string | Uint8Array): Uint8Array =>
  contents instanceof Uint8Array ? new Uint8Array(contents) : encoder.encode(contents);

/** A JSON document's top-level object, or `null` for anything else. */
function parseJson(bytes: Uint8Array | undefined): JsonObject | null {
  if (bytes === undefined) {
    return null;
  }
  try {
    /* SAFETY: JSON.parse answers a JSON value or throws, and the guard below narrows it. */
    const value = JSON.parse(decoder.decode(bytes)) as JsonValue;
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

function componentTag(bytes: Uint8Array | undefined): string | null {
  const tag = parseJson(bytes)?.tagName;
  return isString(tag) && tag.includes("-") ? tag : null;
}

/** The kind a conventional top-level directory gives a document (§2.2). */
const KIND_BY_DIR = new Map<string, DocKind>([
  ["components", "component"],
  ["content", "content"],
  ["data", "data"],
  ["layouts", "layout"],
  ["pages", "page"],
]);

function classify(path: string, bytes: Uint8Array | undefined): DocKind {
  if (path === CONFIG_PATH) {
    return "project-config";
  }
  if (path.endsWith(".css")) {
    return "style";
  }
  if (MEDIA.test(path)) {
    return "media";
  }
  if (/\.(?:json|jxn)$/.test(path) && componentTag(bytes) !== null) {
    return "component";
  }
  const [top = ""] = path.split("/");
  return KIND_BY_DIR.get(top) ?? "other";
}

const parents = (path: string): string[] =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, at, parts) => parts.slice(0, at + 1).join("/"));

/** A running reference host. */
export interface ReferenceHost extends ProjectStateHost {
  /** Advance the virtual clock (the pairing bound is measured on it). */
  advance: (ms: number) => void;
  /** Number of subscribers still open, for tests. */
  openSubscribers: () => number;
}

/** Create a reference host over `files`. */
export async function createReferenceHost(
  files: FixtureFiles,
  options: ReferenceHostOptions = {},
): Promise<ReferenceHost> {
  const bugs = new Set(options.bugs);
  const atomicSaveMs = options.atomicSaveMs ?? 100;
  const disk = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const index = new Map<string, Entry>();
  const subscribers = new Set<Subscriber>();
  let queue: Observation[] = [];
  const held = new Map<string, { entry: Entry; at: number }>();
  let clock = 0;
  let docSerial = 0;
  let epochSerial = 0;
  let log: ProjectEventLog;
  let ledger: EchoLedger = createEchoLedger();
  let readiness: ReadinessState = "scaffolded";
  let fingerprint: string | null = null;
  let extensions = "[]";
  let components: string[] = [];
  let installing: string | null = null;
  let installSerial = 0;
  let committed = new Map<string, ContentHash>();
  let head = 1;
  let lastGit: GitSummary = { branch: "main", changed: {}, head: "c1" };
  let chain: Promise<unknown> = Promise.resolve();

  /** Run `task` after every earlier operation, so each one is atomic with respect to the rest. */
  const exclusive = <T>(task: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(task);
    chain = run.catch(() => null);
    return run;
  };

  const newLog = (): ProjectEventLog => {
    epochSerial += 1;
    const epoch = `${crypto.randomUUID()}-${epochSerial}`;
    return createMemoryEventLog(
      options.logCapacity === undefined ? { epoch } : { capacity: options.logCapacity, epoch },
    );
  };
  log = newLog();

  /** The build output the configuration names, which the index scope excludes (§2.2). */
  const outDir = (): string => {
    const build = parseJson(disk.get(CONFIG_PATH))?.build;
    const named = isJsonObject(build) && isString(build.outDir) ? build.outDir : "dist";
    return named.replace(/^\.\//, "").replace(/\/+$/, "");
  };

  const scoped = (path: string): boolean => inScope(path, outDir());

  /** Every write ever noted per path, for the `ledger-never-clears` bug. */
  const everNoted = new Map<string, Map<ContentHash, EventOrigin>>();

  /** Attribute an observation through the echo ledger (§2.4). */
  const attribute = (path: string, hash: ContentHash | null): EventOrigin => {
    const origin = ledger.attribute(path, hash);
    const stale = hash === null ? undefined : everNoted.get(path)?.get(hash);
    return origin === "external" && bugs.has("ledger-never-clears") && stale !== undefined
      ? stale
      : origin;
  };

  /** Note an own write in the echo ledger before performing it (§2.4, §5). */
  const note = (path: string, hash: ContentHash, writeId: string): void => {
    ledger.note(path, hash, writeId);
    const noted = everNoted.get(path) ?? new Map<ContentHash, EventOrigin>();
    noted.set(hash, { writeHash: hash, writeId });
    everNoted.set(path, noted);
  };

  const mintDocId = (): string => {
    docSerial += 1;
    return `doc-${docSerial}`;
  };

  const emit = (init: ProjectEventInit): ProjectEvent => {
    if (bugs.has("revision-gap") && log.rev % 5 === 4) {
      log.append({ origin: "external", reason: "skipped", type: "watcherDegraded" });
    }
    const event = log.append(init);
    for (const sub of subscribers) {
      if (!sub.ended) {
        // Every event crosses the cloud binding's codec, as it would on a wire (§3.2).
        const decoded = decodeCloudHostMessage(encodeCloudEvents(log.epoch, [event]));
        if (decoded?.kind === "events") {
          sub.events.push(
            ...(bugs.has("malformed-event") ? decoded.events.map(misattribute) : decoded.events),
          );
        }
      }
    }
    return event;
  };

  const setReadiness = (state: ReadinessState, origin: EventOrigin = "external"): void => {
    if (state !== readiness) {
      readiness = state;
      emit({ origin, state, type: "readiness" });
    }
  };

  const advanceTo = (target: ReadinessState): void => {
    while (!readinessAtLeast(readiness, target)) {
      setReadiness(READINESS_ORDER[READINESS_ORDER.indexOf(readiness) + 1]!);
    }
  };

  const currentFingerprint = async (): Promise<string> => {
    const manifest = parseJson(disk.get("package.json")) ?? {};
    const locks: (ContentHash | null)[] = [];
    for (const path of LOCKFILES) {
      const lock = disk.get(path);
      locks.push(lock === undefined ? null : await contentHash(lock));
    }
    return JSON.stringify({
      deps: DEPENDENCY_FIELDS.map((field) => manifest[field] ?? null),
      locks,
    });
  };

  const currentExtensions = (): string => {
    const list = parseJson(disk.get(CONFIG_PATH))?.extensions;
    const names = Array.isArray(list) ? list.filter((item) => isString(item)) : [];
    return JSON.stringify([...new Set(names)].toSorted());
  };

  const currentComponents = (): string[] =>
    [...disk.entries()]
      .flatMap(([path, bytes]) => {
        const tag = scoped(path) && /\.(?:json|jxn)$/.test(path) ? componentTag(bytes) : null;
        return tag === null ? [] : [tag];
      })
      .toSorted();

  const formatsToken = (): string => `formats:${extensions}`;

  /** Derived events after a file at `path` changed (§4.3, §4.4, §7). */
  const afterChange = async (path: string, origin: EventOrigin): Promise<void> => {
    const tags = currentComponents();
    if (JSON.stringify(tags) !== JSON.stringify(components)) {
      components = tags;
      emit({ origin, tags, type: "componentsChanged" });
    }
    if (path === CONFIG_PATH && disk.has(path)) {
      emit({
        hash: await contentHash(disk.get(path)!),
        origin,
        path,
        type: "projectConfigChanged",
      });
      const next = currentExtensions();
      if (next !== extensions) {
        extensions = next;
        emit({ formats: formatsToken(), origin, type: "formatsChanged" });
        if (readinessAtLeast(readiness, "extensions-resolved")) {
          setReadiness("installed", origin);
          advanceTo("ready");
        }
      }
    }
    await checkFingerprint(path, origin);
  };

  /** Move back to `scaffolded` when a manifest or lockfile change alters the fingerprint (§7). */
  const checkFingerprint = async (path: string, origin: EventOrigin): Promise<void> => {
    const byInstall = origin !== "external" && origin.writeId === installing;
    const manifest = path === "package.json" || LOCKFILES.includes(path);
    if (manifest && !byInstall && (await currentFingerprint()) !== fingerprint) {
      setReadiness("scaffolded", origin);
    }
  };

  const entryFor = async (path: string, bytes: Uint8Array): Promise<Entry> => ({
    docId: mintDocId(),
    hash: await contentHash(bytes),
    indexed: true,
    isDir: false,
    kind: classify(path, bytes),
  });

  /** Put a file's new bytes into the index and emit its events (§4.2, §4.3). */
  const applyFile = async (
    path: string,
    bytes: Uint8Array,
    hash: ContentHash,
    origin: EventOrigin,
    keep?: Entry,
  ): Promise<ProjectEvent | null> => {
    const existing = keep ?? index.get(path);
    let event: ProjectEvent;
    if (existing !== undefined && !existing.isDir) {
      index.set(path, existing);
      if (existing.hash === hash) {
        return null;
      }
      existing.hash = hash;
      existing.kind = classify(path, bytes);
      existing.indexed = true;
      event = emit({ docId: existing.docId, hash, origin, path, type: "fileChanged" });
    } else {
      for (const dir of parents(path)) {
        if (!index.has(dir)) {
          const docId = mintDocId();
          index.set(dir, { docId, indexed: true, isDir: true, kind: "other" });
          emit({ docId, isDir: true, origin, path: dir, type: "fileAdded" });
        }
      }
      const entry = await entryFor(path, bytes);
      index.set(path, entry);
      event = emit({ docId: entry.docId, hash, isDir: false, origin, path, type: "fileAdded" });
    }
    const entry = index.get(path)!;
    emit({
      docId: entry.docId,
      hash,
      indexed: entry.indexed,
      kind: entry.kind,
      origin,
      path,
      type: "docChanged",
    });
    await afterChange(path, origin);
    return event;
  };

  const observe = (path: string, bytes: Uint8Array | null): void => {
    queue.push({ at: clock, bytes: bytes === null ? null : new Uint8Array(bytes), path });
  };

  const writeDisk = (path: string, bytes: Uint8Array): void => {
    for (const dir of parents(path)) {
      dirs.add(dir);
    }
    disk.set(path, bytes);
    observe(path, bytes);
  };

  /** Every file at or beneath `path`. */
  const beneath = (path: string): string[] =>
    [...disk.keys()].filter((file) => file === path || file.startsWith(`${path}/`));

  const removeDisk = (path: string): void => {
    for (const file of beneath(path)) {
      disk.delete(file);
      observe(file, null);
    }
    for (const dir of dirs) {
      if (dir === path || dir.startsWith(`${path}/`)) {
        dirs.delete(dir);
      }
    }
  };

  const dropFromIndex = (path: string): void => {
    for (const key of index.keys()) {
      if (key === path || key.startsWith(`${path}/`)) {
        index.delete(key);
      }
    }
  };

  const flushHeld = async (): Promise<void> => {
    for (const [path, { entry }] of held) {
      held.delete(path);
      emit({ docId: entry.docId, isDir: false, origin: "external", path, type: "fileRemoved" });
      await afterChange(path, "external");
    }
  };

  /** Process the watcher's observations in the order it reported them (§2.4). */
  const processQueue = async (): Promise<void> => {
    const batch = queue;
    queue = [];
    for (const { path, bytes, at } of batch) {
      if (!scoped(path)) {
        // A lockfile outside the scope emits no event, but still feeds readiness (§2.2, §7).
        if (LOCKFILES.includes(path)) {
          const origin = attribute(path, bytes === null ? null : await contentHash(bytes));
          if (origin === "external") {
            await checkFingerprint(path, origin);
          }
        }
        continue;
      }
      if (bytes === null) {
        attribute(path, null);
        const entry = index.get(path);
        if (entry !== undefined) {
          index.delete(path);
          held.set(path, { at, entry });
        }
        continue;
      }
      const hash = await contentHash(bytes);
      // The "echo" bug skips the ledger, so a stale observation of an own write reads as external.
      const origin = bugs.has("echo") ? "external" : attribute(path, hash);
      if (origin !== "external") {
        continue;
      }
      const pairing = held.get(path);
      if (pairing !== undefined && at - pairing.at <= atomicSaveMs) {
        held.delete(path);
        const keep = bugs.has("atomic-new-id")
          ? { ...pairing.entry, docId: mintDocId() }
          : pairing.entry;
        await applyFile(path, bytes, hash, "external", keep);
        continue;
      }
      if (pairing !== undefined) {
        held.delete(path);
        emit({
          docId: pairing.entry.docId,
          isDir: false,
          origin: "external",
          path,
          type: "fileRemoved",
        });
        await afterChange(path, "external");
      }
      const moved = [...held].find(([, { entry }]) => entry.hash === hash);
      if (moved !== undefined && options.pairMoves !== false && !index.has(path)) {
        const [from, { entry }] = moved;
        held.delete(from);
        index.set(path, entry);
        emit({
          docId: entry.docId,
          from,
          isDir: false,
          origin: "external",
          to: path,
          type: "fileRenamed",
        });
        continue;
      }
      await applyFile(path, bytes, hash, "external");
    }
  };

  const gitSummary = async (): Promise<GitSummary> => {
    const changed: Record<string, WorkingState> = {};
    for (const [path, bytes] of [...disk].toSorted(([a], [b]) => a.localeCompare(b))) {
      if (!scoped(path)) {
        continue;
      }
      const was = committed.get(path);
      const hash = await contentHash(bytes);
      if (was === undefined) {
        changed[path] = "untracked";
      } else if (was !== hash) {
        changed[path] = "modified";
      }
    }
    for (const path of committed.keys()) {
      if (!disk.has(path)) {
        changed[path] = "deleted";
      }
    }
    return { branch: "main", changed, head: `c${head}` };
  };

  /** The git monitor's debounce ends at every settle (§4.5). */
  const runGitMonitor = async (): Promise<void> => {
    const summary = await gitSummary();
    if (JSON.stringify(summary) !== JSON.stringify(lastGit)) {
      lastGit = summary;
      emit({ origin: "external", status: summary, type: "gitChanged" });
    }
  };

  const snapshot = (): ProjectSnapshot => {
    const list: IndexedFile[] = [...index]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([path, entry]) => {
        const file: IndexedFile = {
          docId: entry.docId,
          indexed: entry.indexed,
          isDir: entry.isDir,
          kind: entry.kind,
          path,
        };
        if (entry.hash !== undefined) {
          file.hash = entry.hash;
        }
        return file;
      });
    return {
      components: [...components],
      files: list,
      formats: formatsToken(),
      git: structuredClone(lastGit),
      readiness,
    };
  };

  /** Build the index unhashed, as a host does before it reaches `indexed` (§3.1). */
  const scan = (): void => {
    const previous = new Map(index);
    index.clear();
    for (const dir of [...dirs].filter((name) => scoped(name)).toSorted()) {
      index.set(
        dir,
        previous.get(dir) ?? { docId: mintDocId(), indexed: true, isDir: true, kind: "other" },
      );
    }
    for (const path of [...disk.keys()].filter((name) => scoped(name)).toSorted()) {
      const kept = previous.get(path);
      index.set(path, {
        docId: kept?.docId ?? mintDocId(),
        indexed: false,
        isDir: false,
        kind: "other",
      });
    }
  };

  /** Hash, classify and index every file, emitting `docChanged` for each (§3.1). */
  const indexAll = async (): Promise<void> => {
    for (const [path, entry] of index) {
      if (entry.isDir) {
        continue;
      }
      const bytes = disk.get(path)!;
      entry.hash = await contentHash(bytes);
      entry.kind = classify(path, bytes);
      entry.indexed = !bugs.has("unindexed");
      emit({
        docId: entry.docId,
        hash: entry.hash,
        indexed: entry.indexed,
        kind: entry.kind,
        origin: bugs.has("index-fill-write-origin")
          ? { writeHash: entry.hash, writeId: "indexer" }
          : "external",
        path,
        type: "docChanged",
      });
    }
  };

  const install = async (): Promise<void> => {
    installSerial += 1;
    const writeId = `install-${installSerial}`;
    installing = writeId;
    const manifest = parseJson(disk.get("package.json")) ?? {};
    const lock = toBytes(
      `${JSON.stringify({ lockfileVersion: 3, packages: manifest.dependencies ?? {} }, null, 2)}\n`,
    );
    const hash = await contentHash(lock);
    const current = disk.get("package-lock.json");
    const outside = bugs.has("install-moves-readiness");
    if (current === undefined || (await contentHash(current)) !== hash) {
      if (outside) {
        writeDisk("package-lock.json", lock);
      } else {
        note("package-lock.json", hash, writeId);
        writeDisk("package-lock.json", lock);
        await applyFile("package-lock.json", lock, hash, { writeHash: hash, writeId });
      }
    }
    installing = null;
    if (!outside) {
      fingerprint = await currentFingerprint();
    }
  };

  /** Advance from wherever the host is to `ready`, indexing on the way (§7). */
  const prepare = async (): Promise<void> => {
    if (readiness === "scaffolded") {
      if (fingerprint !== (await currentFingerprint())) {
        await install();
      }
      setReadiness("installed");
    }
    advanceTo("extensions-resolved");
    if (!readinessAtLeast(readiness, "indexed")) {
      await indexAll();
    }
    advanceTo("ready");
  };

  /** Start, or start again: a scan, then readiness from `scaffolded` (§2.3, §7). */
  const start = async (hold: boolean): Promise<void> => {
    readiness = "scaffolded";
    scan();
    extensions = currentExtensions();
    components = currentComponents();
    emit({ origin: "external", state: "scaffolded", type: "readiness" });
    if (!hold) {
      await prepare();
    }
  };

  const endSubscriptions = (): void => {
    for (const sub of subscribers) {
      sub.ended = true;
    }
    subscribers.clear();
  };

  // ── Build the disk and start ──
  for (const [path, contents] of Object.entries(files)) {
    for (const dir of parents(path)) {
      dirs.add(dir);
    }
    disk.set(path, toBytes(contents));
  }
  for (const path of disk.keys()) {
    if (scoped(path)) {
      committed.set(path, await contentHash(disk.get(path)!));
    }
  }
  lastGit = await gitSummary();
  // A held host starts as if nothing were installed, so its release runs an install (§7).
  fingerprint = options.hold === true ? null : await currentFingerprint();
  await start(options.hold === true);

  const restartWith = async (keepLog: boolean): Promise<void> => {
    await processQueue();
    held.clear();
    endSubscriptions();
    ledger = createEchoLedger();
    if (!keepLog) {
      log = newLog();
    }
    await start(false);
  };

  const host: ReferenceHost = {
    advance(ms) {
      clock += ms;
    },
    commit: (_message) =>
      exclusive(async () => {
        committed = new Map();
        for (const [path, bytes] of disk) {
          if (scoped(path)) {
            committed.set(path, await contentHash(bytes));
          }
        }
        head += 1;
      }),
    close: () => exclusive(() => endSubscriptions()),
    createDirectory: (path, writeId) =>
      exclusive(() => {
        if (!index.has(path)) {
          dirs.add(path);
          const docId = mintDocId();
          index.set(path, { docId, indexed: true, isDir: true, kind: "other" });
          emit({
            docId,
            isDir: true,
            origin: { writeHash: null, writeId },
            path,
            type: "fileAdded",
          });
        }
        return { rev: log.rev };
      }),
    delete: (request) =>
      exclusive(async () => {
        const { path } = request;
        const entry = index.get(path);
        let current: DeleteBase | null = null;
        if (disk.has(path)) {
          current = { hash: await contentHash(disk.get(path)!) };
        } else if (dirs.has(path)) {
          const below: Record<string, ContentHash> = {};
          for (const file of beneath(path)) {
            below[file.slice(path.length + 1)] = await contentHash(disk.get(file)!);
          }
          current = { files: below };
        }
        const refused = checkDeletePrecondition(request, current, entry?.docId ?? null);
        if (refused !== null && !refused.ok) {
          emit(conflictEvent(request, refused.conflict));
          return refused;
        }
        const isDir = !disk.has(path);
        removeDisk(path);
        dropFromIndex(path);
        const event = emit({
          docId: entry!.docId,
          isDir,
          origin: { writeHash: null, writeId: request.writeId },
          path,
          type: "fileRemoved",
        });
        await afterChange(path, event.origin);
        return { ok: true as const, rev: event.rev };
      }),
    external: {
      atomicSave: async (path, contents, timing) => {
        await exclusive(() => {
          disk.delete(path);
          observe(path, null);
        });
        if (timing === "outside") {
          host.advance(atomicSaveMs + 1);
        }
        await exclusive(() => writeDisk(path, toBytes(contents)));
      },
      remove: (path) => exclusive(() => removeDisk(path)),
      // A link inside the root reads as its target's bytes; one leaving it is never seen.
      symlink: (path, target) =>
        exclusive(() => {
          const bytes = target.startsWith("../") ? undefined : disk.get(target);
          if (bytes !== undefined) {
            writeDisk(path, new Uint8Array(bytes));
          }
        }),
      rename: (from, to) =>
        exclusive(() => {
          const bytes = disk.get(from)!;
          disk.delete(from);
          observe(from, null);
          writeDisk(to, bytes);
        }),
      write: (path, contents) => exclusive(() => writeDisk(path, toBytes(contents))),
    },
    install: () =>
      exclusive(async () => {
        await install();
        if (!readinessAtLeast(readiness, "installed")) {
          setReadiness("installed");
          advanceTo("ready");
        }
      }),
    openSubscribers: () => subscribers.size,
    read: (path) => exclusive(() => (disk.has(path) ? new Uint8Array(disk.get(path)!) : null)),
    release: () => exclusive(() => prepare()),
    restart: () => exclusive(() => restartWith(options.persistentLog === true)),
    settle: () =>
      exclusive(async () => {
        await processQueue();
        await flushHeld();
        await runGitMonitor();
      }),
    subscribe: (request) =>
      exclusive(() => {
        let response = answerSubscribe(log, request, snapshot);
        if (
          bugs.has("subset-replay") &&
          response.kind === "snapshot" &&
          request.epoch === log.epoch &&
          request.sinceRev !== undefined &&
          request.sinceRev < log.rev
        ) {
          const window = (options.logCapacity ?? 1024) - 1;
          response = {
            epoch: log.epoch,
            events: log.since(log.rev - window) ?? [],
            kind: "events",
            rev: log.rev,
          };
        }
        const sub: Subscriber = { ended: false, events: [] };
        subscribers.add(sub);
        const subscription: ProjectStateSubscription = {
          get ended() {
            return sub.ended;
          },
          events: sub.events,
          response,
          close() {
            sub.ended = true;
            subscribers.delete(sub);
          },
        };
        return subscription;
      }),
    write: (request) =>
      exclusive(async () => {
        const { path, writeId } = request;
        const current = disk.get(path);
        const diskHash = current === undefined ? null : await contentHash(current);
        const docId = index.get(path)?.docId ?? null;
        const refused = bugs.has("no-precondition")
          ? null
          : checkWritePrecondition(request, { docId, hash: diskHash });
        if (refused !== null && !refused.ok) {
          emit(conflictEvent(request, refused.conflict));
          return refused;
        }
        const bytes = toBytes(request.contents);
        const hash = await contentHash(bytes);
        if (hash === diskHash) {
          return { hash, ok: true as const, rev: log.rev };
        }
        note(path, hash, writeId);
        writeDisk(path, bytes);
        const event = scoped(path)
          ? await applyFile(path, bytes, hash, { writeHash: hash, writeId })
          : null;
        return { hash, ok: true as const, rev: event?.rev ?? log.rev };
      }),
  };

  if (options.symlinks === false) {
    delete host.external.symlink;
  }
  if (options.watcher === true) {
    host.watcher = {
      degrade: (reason) =>
        exclusive(() => {
          emit({ origin: "external", reason, type: "watcherDegraded" });
        }),
      recover: () => exclusive(() => restartWith(false)),
    };
  }
  return host;
}

/** A conformance driver over the reference host. */
export function referenceDriver(
  name: string,
  options: Omit<ReferenceHostOptions, keyof ProjectStateHostOptions> = {},
): ProjectStateDriver {
  const driver: ProjectStateDriver = {
    create: (files, hostOptions) => createReferenceHost(files, { ...options, ...hostOptions }),
    name,
  };
  if (options.persistentLog === true) {
    driver.persistentLog = true;
  }
  return driver;
}
