/**
 * The project state host (`specs/project-state.md` §10.1, §10.2): the in-memory model of one
 * project that the desktop backend and the dev server serve, over a real directory, a filesystem
 * watcher and the git CLI.
 *
 * It keeps a file index with a {@link DocId} and a content hash per file (§2.1, §2.2), a revision
 * counter with a replay log (§2.3), an echo ledger that attributes every observation by the bytes
 * it saw (§2.4), the dependency graph (§8), the readiness machine (§7) and a git monitor (§4.5),
 * and it answers a subscribe (§3.1) and the conditional writes and deletes of §5.
 *
 * Everything that changes the index happens in one queue, so a write's precondition, its disk
 * change and its events are atomic with respect to every other write and to the processing of every
 * watcher observation (§5). Within a queued step, the index is changed and the step's events
 * appended without an `await` between them, so a subscribe, which is answered synchronously, always
 * takes the snapshot and its revision together (§3.1).
 *
 * Runs on Node (the desktop backend's utility process) and on Bun: it uses `node:fs/promises`,
 * `node:crypto`'s random ids, WebCrypto through `contentHash`, chokidar and the git CLI, and no
 * Bun-only API.
 *
 * @module
 */

import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { watch } from "chokidar";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  answerSubscribe,
  checkDeletePrecondition,
  checkWritePrecondition,
  conflictEvent,
  contentHash,
  createEchoLedger,
  createMemoryEventLog,
  EVENT_LOG_CAPACITY,
  readinessAtLeast,
} from "@jxsuite/protocol/project-state";
import type {
  ContentHash,
  DeleteBase,
  DeleteRequest,
  DeleteResult,
  DocKind,
  EchoLedger,
  EventOrigin,
  IndexedFile,
  ProjectEvent,
  ProjectEventInit,
  ProjectEventLog,
  ProjectSnapshot,
  ReadinessState,
  RenameOperation,
  RenameOperationResult,
  SubscribeRequest,
  SubscribeResponse,
  WriteOrigin,
  WriteRequest,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import type { GitRunner } from "@jxsuite/protocol/git-scope";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { parseJxn } from "@jxsuite/schema/jxn";
import { toError } from "@jxsuite/schema/parse";
import { PROJECT_FILE_NAMES, parseProjectFile } from "@jxsuite/schema/project-file";
import type { JsonObject, JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { createWatchIgnore } from "../watch-policy.ts";
import { createGitMonitor } from "./git-monitor.ts";
import { invalidateReferenceCache } from "../refactor/find-refs.ts";
import { runRenameCascade } from "./rename.ts";
import type { GitMonitor, GitMonitorOptions, GitWatchFactory } from "./git-monitor.ts";
import { createDependencyGraph, extractRefs, invalidationEvents, NO_REFS } from "./graph.ts";
import type {
  DependencyGraph,
  DependencyGraphConfig,
  DocumentRefs,
  GraphDocument,
  Invalidation,
} from "./graph.ts";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import {
  DEPENDENCY_FIELDS,
  dependenciesInstalled,
  installPackages,
  loadInstalledFormats,
  NO_FORMATS,
  sourceCollections,
} from "./host-deps.ts";
import type {
  CollectionResolver,
  ExtensionLoader,
  InstalledCheck,
  Installer,
  ProjectFormats,
} from "./host-deps.ts";

/* What a host embedder passes or falls back to: the default collection resolver, and the shapes
   of the resolvers it may pass instead. */
export { sourceCollections } from "./host-deps.ts";
export type { CollectionInput, CollectionResolver } from "./host-deps.ts";

// ─── Options ───────────────────────────────────────────────────────────────────────────────────

/** The filesystem calls the host makes; `node:fs/promises` satisfies it and is the default. */
export interface ProjectStateFs {
  chmod: (path: string, mode: number) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  /** Opened to hash a file without holding it whole (§2.1). */
  open: (path: string) => Promise<FileHandle>;
  readFile: (path: string) => Promise<Uint8Array>;
  readdir: (path: string) => Promise<string[]>;
  realpath: (path: string) => Promise<string>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string, options: { force?: boolean; recursive?: boolean }) => Promise<void>;
  stat: (path: string) => Promise<Stats>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
}

/** A change a watcher reports, by chokidar's names. */
export type ProjectWatchEvent = "add" | "addDir" | "change" | "unlink" | "unlinkDir";

/** Where a watcher delivers what it sees. Paths are absolute. */
export interface ProjectWatchSink {
  event: (type: ProjectWatchEvent, path: string) => void;
  /** Anything moved, before the watcher has decided what (chokidar's `raw`). */
  activity: () => void;
  /** The watcher can no longer promise it sees every change (§4.8). */
  error: (error: Error) => void;
}

/** How the host asks for a watcher. */
export interface ProjectWatchOptions {
  /** Paths the watcher must not report (outside the index scope, and the host's own temp files). */
  ignored: (path: string, stats?: Stats) => boolean;
  /** The pairing bound for an atomic-rename save (§2.4). */
  atomicSaveMs: number;
  /** How long a file's size must hold still before its change is reported. */
  stabilityMs: number;
}

export interface ProjectWatchHandle {
  /** Settles once the watcher has scanned the root. */
  ready: Promise<void>;
  close: () => Promise<void>;
}

/** Start watching `root`. */
export type ProjectWatcherFactory = (
  root: string,
  sink: ProjectWatchSink,
  options: ProjectWatchOptions,
) => ProjectWatchHandle;

const WATCH_EVENTS = new Set<string>(["add", "addDir", "change", "unlink", "unlinkDir"]);

/**
 * The default {@link ProjectWatcherFactory}: chokidar, reporting a write once it is whole
 * (`awaitWriteFinish`), pairing an atomic-rename save itself (`atomic`), and following a symlink
 * that stays inside the root.
 */
export const chokidarProjectWatcher: ProjectWatcherFactory = (root, sink, options) => {
  const watcher = watch(root, {
    atomic: options.atomicSaveMs,
    awaitWriteFinish: { pollInterval: 10, stabilityThreshold: options.stabilityMs },
    followSymlinks: true,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ignored: options.ignored,
  });
  watcher.on("raw", () => sink.activity());
  watcher.on("all", (type, path) => {
    if (WATCH_EVENTS.has(type)) {
      // SAFETY: narrowed by the set of the five names just checked.
      sink.event(type as ProjectWatchEvent, path);
    }
  });
  watcher.on("error", (cause) =>
    sink.error(cause instanceof Error ? cause : new Error(String(cause))),
  );
  const ready = new Promise<void>((resolve) => {
    watcher.once("ready", () => resolve());
  });
  return { close: () => watcher.close(), ready };
};

export interface ProjectStateHostOptions {
  /** The absolute project root. */
  root: string;
  fs?: ProjectStateFs;
  /** Defaults to {@link chokidarProjectWatcher}. */
  watcher?: ProjectWatcherFactory;
  /** Runs git in the root; `false` turns the git monitor off. Defaults to the git CLI. */
  git?: GitRunner | false;
  /** Watches the repository's `HEAD`, `index` and `refs`; defaults to chokidar. */
  gitWatch?: GitWatchFactory;
  /** The git monitor's debounce, in ms (§4.5). */
  gitDebounceMs?: number;
  /** Loads the configuration's extensions; defaults to {@link loadInstalledFormats}. */
  extensions?: ExtensionLoader;
  /** Runs an install; defaults to {@link installPackages}. */
  installer?: Installer;
  /** Whether the manifest's dependencies are installed; defaults to {@link dependenciesInstalled}. */
  installed?: InstalledCheck;
  /** Each content type's entry files; defaults to {@link sourceCollections}. */
  collections?: CollectionResolver;
  /** The pairing bound for an atomic-rename save, in ms (§2.4). Defaults to 100. */
  atomicSaveMs?: number;
  /** How long a file must hold still before the watcher reports it, in ms. Defaults to 50. */
  stabilityMs?: number;
  /**
   * The largest file the host reads whole to classify it, in bytes; a larger one, and every media
   * file or stylesheet, is hashed as a stream and never parsed (§2.2). Defaults to 64 MiB.
   */
  readLimitBytes?: number;
  /**
   * The waits between attempts to rename a write's temporary file over its target when the rename
   * fails as a file held open fails it on Windows (`EPERM`, `EACCES`, `EBUSY`), in ms. Defaults to
   * a short backoff on Windows and to none elsewhere, where those failures are not transient.
   */
  renameRetryMs?: readonly number[];
  /** The replay window, in events (§2.3). */
  logCapacity?: number;
  /** Stay at `scaffolded` until {@link ProjectStateHost.release} (§3.1, §7). */
  hold?: boolean;
  /** Told of every failure the host survives: a watch error, a failed git run, a bad extension. */
  onError?: (error: Error) => void;
  /**
   * Called before each step of a rename cascade runs (§9.1), counted from 0 in the order the host
   * applies them, with the path the step changes; a throw fails that step and rolls back the ones
   * before it. The conformance suite injects its failures here (§10.4).
   */
  onRenameStep?: (step: number, path: string) => void | Promise<void>;
}

/** Where a subscription's events go. */
export interface ProjectStateSink {
  /** Later events, in revision order, as the host appends them. */
  events: (events: ProjectEvent[]) => void;
  /** The host ended the subscription: a restart, a watcher recovery or close (§4.8). */
  end?: () => void;
}

/**
 * What the host's graph knows about every document's references, for the usage query (§8, §12):
 * each document's path and extracted references, and the asset mounts a rooted reference resolves
 * through.
 */
export interface ProjectReferences {
  documents: GraphDocument[];
  mounts: readonly AssetMount[];
  /** The file extensions the project's loaded formats parse, beside JSON and Jx Notation. */
  extensions: readonly string[];
}

/** One open subscription. */
export interface ProjectStateSubscription {
  response: SubscribeResponse;
  close: () => void;
}

export interface ProjectStateHost {
  readonly root: string;
  /** The current epoch (§2.3). */
  readonly epoch: string;
  /** The newest revision. */
  readonly rev: number;
  readonly readiness: ReadinessState;
  /** Answer a subscribe (§3.1) and stream every later event to `sink`. */
  subscribe: (request: SubscribeRequest, sink: ProjectStateSink) => ProjectStateSubscription;
  /** A conditional write (§5). */
  write: (request: WriteRequest) => Promise<WriteResult>;
  /** A conditional delete of a file or a directory (§5). */
  delete: (request: DeleteRequest) => Promise<DeleteResult>;
  /** Create a directory; its `fileAdded` carries `writeId` (§5). */
  createDirectory: (path: string, writeId: string) => Promise<{ rev: number }>;
  /**
   * The rename cascade (§9): plan the move and every reference rewrite, then apply them from an
   * outbox that rolls back on failure, answering what was done or why nothing was. Rejects only for
   * a path that is not project-relative or leads outside the project.
   */
  rename: (operation: RenameOperation) => Promise<RenameOperationResult>;
  /** The whole state at the current revision (§3.1). */
  snapshot: () => ProjectSnapshot;
  /** The document id at `path` now, `null` when nothing indexed is there (§2.2). */
  docIdAt: (path: string) => string | null;
  /**
   * The graph's documents and their references once the host is `indexed` (§7, §8), `null` before
   * and while its watcher is degraded (§4.8): below `indexed` the graph is still being built, and a
   * degraded watcher no longer follows the disk, so the usage query walks the tree instead.
   */
  references: () => ProjectReferences | null;
  /** Run an install; its writes carry its own write id and leave readiness where it was (§7). */
  install: () => Promise<void>;
  /** Let a host created with `hold` advance (§7). */
  release: () => Promise<void>;
  /** Start again over the same root: a new epoch, every subscription ended (§2.3, §4.8). */
  restart: () => Promise<void>;
  /**
   * Resolve once the host has processed every change it has been told of and nothing has moved for
   * `quietMs`: the watcher's reports, held removals, the git monitor's debounce.
   */
  idle: (quietMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

// ─── Scope and classification (§2.2) ───────────────────────────────────────────────────────────

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
/** The temporary file a write goes through (§5); never indexed, never reported. */
const TEMP_FILE = /\.jx-write-[\da-f-]{36}$/;
/** The lockfiles a fingerprint covers (§7); Bun's are outside the index scope. */
const LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
const MANIFEST = "package.json";
const FINGERPRINT_PATHS = new Set([MANIFEST, ...LOCKFILES]);
const MEDIA =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|ogg|mov|mp3|wav|flac|m4a|woff2?|ttf|otf|eot|pdf)$/i;
const KIND_BY_DIR = new Map<string, DocKind>([
  ["components", "component"],
  ["content", "content"],
  ["data", "data"],
  ["layouts", "layout"],
  ["pages", "page"],
]);
const UNRESOLVED_FORMATS = "unresolved";
/**
 * The coarsest modification-time tick a project may sit on (FAT and exFAT keep two seconds). A size
 * and time recorded within it of now can hold through a later edit, so they are not recorded
 * (§2.4).
 */
const MTIME_TICK_MS = 2000;
const HASH_CHUNK_BYTES = 1024 * 1024;
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const WINDOWS_RENAME_RETRY_MS = [10, 50, 100, 250, 500];

/** A node error's `code`, when it has one. */
const errorCode = (error: Error): string | undefined =>
  "code" in error && isString(error.code) ? error.code : undefined;

/** Whether a failed read or open means the path is gone, rather than that it cannot be read. */
const isMissing = (error: Error): boolean => {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
};

const CONFIG_PATHS: ReadonlySet<string> = new Set(PROJECT_FILE_NAMES);
const isConfigPath = (path: string): boolean => CONFIG_PATHS.has(path);

/** The ancestors of a project path, shallowest first. */
const parents = (path: string): string[] =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, at, parts) => parts.slice(0, at + 1).join("/"));

/** The build output a configuration names, project-relative, `dist` when it names none (§2.2). */
function outDirOf(config: ProjectConfig | undefined): string {
  const named = config?.build?.outDir;
  if (!isString(named)) {
    return "dist";
  }
  const out = named.replace(/^\.\//, "").replaceAll(/\/+$/g, "");
  return out === "" || out === "." || out.startsWith("../") || out.startsWith("/") ? "dist" : out;
}

/** The extension set a configuration names, as one comparable string (§7). */
function extensionSetOf(config: ProjectConfig | undefined): string {
  const names = config?.extensions;
  return JSON.stringify(names === undefined ? [] : [...new Set(names)].toSorted());
}

/** A root `tagName` naming a custom element: the tag a component definition declares. */
function componentTag(doc: JsonValue | undefined): string | null {
  const tag = isJsonObject(doc) ? doc.tagName : undefined;
  return isString(tag) && tag.includes("-") ? tag : null;
}

/** A path's kind from its location alone (§2.2). */
function kindByLocation(path: string): DocKind {
  const [top = ""] = path.split("/");
  return path.includes("/") ? (KIND_BY_DIR.get(top) ?? "other") : "other";
}

/** What a document is and what it references, as far as the host can read it. */
interface Described {
  kind: DocKind;
  /** `null` when the host could not extract its references (§8.2). */
  refs: DocumentRefs | null;
}

/** A project path, checked: relative, forward slashes, no `.` or `..` segment. */
function checkPath(path: string): string {
  const segments = path.split("/");
  if (
    path === "" ||
    path.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`Not a project-relative path: "${path}"`);
  }
  return path;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBytes = (contents: string | Uint8Array): Uint8Array =>
  contents instanceof Uint8Array ? contents : encoder.encode(contents);

// ─── The host ──────────────────────────────────────────────────────────────────────────────────

interface Entry {
  docId: string;
  isDir: boolean;
  kind: DocKind;
  hash?: ContentHash;
  size?: number | undefined;
  mtimeMs?: number | undefined;
  indexed: boolean;
  /** What the graph was given for this document; `undefined` before it was read. */
  refs?: DocumentRefs | null;
  /** The tag a component definition declares. */
  defines: string | null;
  /** Re-read at the next indexing: the format set changed under it. */
  stale?: boolean;
  /** An observed removal held for the pairing bound (§2.4). */
  held?: ReturnType<typeof setTimeout> | undefined;
}

interface Subscriber {
  sink: ProjectStateSink;
}

/**
 * Create a project state host over `options.root` and start it: the watcher is armed, the index
 * scanned and the git summary read before this resolves, and the host then advances to `ready` on
 * its own unless it was created with `hold`.
 */
export async function createProjectStateHost(
  options: ProjectStateHostOptions,
): Promise<ProjectStateHost> {
  const { root } = options;
  const fs: ProjectStateFs = options.fs ?? nodeFs;
  const watcherFactory = options.watcher ?? chokidarProjectWatcher;
  const loadExtensions = options.extensions ?? loadInstalledFormats;
  const installer = options.installer ?? installPackages;
  const installedCheck = options.installed ?? dependenciesInstalled;
  const resolveCollections = options.collections ?? sourceCollections;
  const atomicSaveMs = options.atomicSaveMs ?? 100;
  const stabilityMs = options.stabilityMs ?? 50;
  const readLimit = options.readLimitBytes ?? 64 * 1024 * 1024;
  const renameRetryMs =
    options.renameRetryMs ?? (process.platform === "win32" ? WINDOWS_RENAME_RETRY_MS : []);
  /* A removal is held from when the watcher reports it, and the add that pairs it is reported only
     once the file holds still, so the bound is extended by that wait (§2.4). */
  const holdMs = atomicSaveMs + stabilityMs + 50;
  const report = (error: Error): void => {
    if (options.onError) {
      options.onError(error);
    } else {
      console.error(`[project-state] ${error.message}`);
    }
  };

  /** A queued step's failure, which nothing awaits: reported, never thrown. */
  const reportRejection = (error: Error): void => {
    report(toError(error));
  };

  let log: ProjectEventLog = createMemoryEventLog({ epoch: randomUUID() });
  let ledger: EchoLedger = createEchoLedger();
  const index = new Map<string, Entry>();
  const subscribers = new Set<Subscriber>();
  const holds = new Set<string>();
  let graph: DependencyGraph = createDependencyGraph();
  let graphBuilt = false;
  /** Each path's content types, as last given to the graph (`setEntryTypes`). */
  let entryTypes = new Map<string, string>();
  let readiness: ReadinessState = "scaffolded";
  let held = options.hold === true;
  let fingerprint: string | null = null;
  let extensionSet: string | null = null;
  let formats: ProjectFormats | null = null;
  let formatsToken = UNRESOLVED_FORMATS;
  let components: string[] = [];
  let config: ProjectConfig | undefined;
  let outDir = "dist";
  let realRoot = root;
  let watcher: ProjectWatchHandle | null = null;
  let git: GitMonitor | null = null;
  let degraded = false;
  let installing: string | null = null;
  let deferred: [ProjectWatchEvent, string][] = [];
  let lastActivity = 0;
  let closed = false;
  let generation = 0;

  // ── The queue ──
  let chain: Promise<unknown> = Promise.resolve();
  let queued = 0;

  /** Run `task` after every earlier one, so each is atomic with respect to the rest (§5). */
  const exclusive = <T>(task: () => Promise<T> | T): Promise<T> => {
    queued += 1;
    const run = chain.then(task);
    chain = run.then(
      () => {
        queued -= 1;
      },
      () => {
        queued -= 1;
      },
    );
    return run;
  };

  // ── Paths ──
  const toAbs = (path: string): string => join(root, ...path.split("/"));
  const toRel = (path: string): string => relative(root, path).split(sep).join("/");

  const inScope = (path: string): boolean => {
    const segments = path.split("/");
    const name = segments.at(-1)!;
    return (
      path !== "" &&
      !segments.some((segment) => IGNORED_SEGMENTS.has(segment)) &&
      !IGNORED_NAMES.has(name) &&
      !TEMP_FILE.test(name) &&
      path !== outDir &&
      !path.startsWith(`${outDir}/`)
    );
  };

  /** What the watcher skips: the index scope's exclusions, except the lockfiles (§7). */
  const watchIgnored = (path: string): boolean => {
    const rel = toRel(path);
    if (rel === "" || rel.startsWith("..")) {
      return false;
    }
    const segments = rel.split("/");
    return (
      segments.some((segment) => IGNORED_SEGMENTS.has(segment)) ||
      TEMP_FILE.test(segments.at(-1)!) ||
      rel === outDir ||
      rel.startsWith(`${outDir}/`)
    );
  };

  const statOrNull = async (path: string): Promise<Stats | null> => {
    try {
      return await fs.stat(toAbs(path));
    } catch {
      return null;
    }
  };

  /**
   * A request's path, checked to be project-relative and to stay inside the root through any link
   * on the way: its nearest existing ancestor must resolve inside the root.
   */
  const contained = async (requested: string): Promise<string> => {
    const path = checkPath(requested);
    for (const at of [path, ...parents(path).toReversed(), ""]) {
      let real: string;
      try {
        real = await fs.realpath(at === "" ? root : toAbs(at));
      } catch {
        continue;
      }
      if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
        throw new TypeError(`"${path}" leads outside the project`);
      }
      break;
    }
    return path;
  };

  /** A path's stats, following a link only when it resolves inside the root (§2.2). */
  const statInside = async (path: string): Promise<Stats | null> => {
    try {
      const real = await fs.realpath(toAbs(path));
      if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
        return null;
      }
      return await fs.stat(toAbs(path));
    } catch {
      return null;
    }
  };

  /** A file's bytes, `null` when it is gone; any other failure is the caller's (§5). */
  const readOrNull = async (path: string): Promise<Uint8Array | null> => {
    try {
      return await fs.readFile(toAbs(path));
    } catch (error) {
      if (isMissing(toError(error))) {
        return null;
      }
      throw error;
    }
  };

  /**
   * A file the host reads for itself (the configuration, readiness's inputs); a failure is
   * reported.
   */
  const readReported = async (path: string): Promise<Uint8Array | null> => {
    try {
      return await readOrNull(path);
    } catch (error) {
      report(toError(error));
      return null;
    }
  };

  /**
   * A file's hash, read as a stream so no file is held whole whatever its size (§2.1); `null` when
   * it is gone, and any other failure is the caller's.
   */
  const hashOf = async (path: string): Promise<ContentHash | null> => {
    let handle: FileHandle;
    try {
      handle = await fs.open(toAbs(path));
    } catch (error) {
      if (isMissing(toError(error))) {
        return null;
      }
      throw error;
    }
    try {
      const digest = createHash("sha256");
      const chunk = new Uint8Array(HASH_CHUNK_BYTES);
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, HASH_CHUNK_BYTES, null);
        if (bytesRead === 0) {
          return `sha256-${digest.digest("base64")}`;
        }
        digest.update(chunk.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  };

  /**
   * A file's hash, with its bytes when classifying it reads them: a media file, a stylesheet and a
   * file over the read limit are classified by name and only hashed (§2.2). `null` when it is
   * gone.
   */
  const load = async (
    path: string,
    size: number,
  ): Promise<{ bytes: Uint8Array | null; hash: ContentHash } | null> => {
    if (MEDIA.test(path) || extname(path).toLowerCase() === ".css" || size > readLimit) {
      const hash = await hashOf(path);
      return hash === null ? null : { bytes: null, hash };
    }
    const bytes = await readOrNull(path);
    return bytes === null ? null : { bytes, hash: await contentHash(bytes) };
  };

  /**
   * The size and time to record with a hash, taken before the bytes were read: none when the time
   * is within a tick of now, since an edit in the same tick could leave both unchanged (§2.4).
   */
  const statFields = (stats: Stats | null): Pick<Entry, "mtimeMs" | "size"> =>
    stats === null || stats.mtimeMs > Date.now() - MTIME_TICK_MS
      ? { mtimeMs: undefined, size: undefined }
      : { mtimeMs: stats.mtimeMs, size: stats.size };

  // ── Events ──
  const emit = (init: ProjectEventInit): ProjectEvent => {
    const event = log.append(init);
    for (const sub of subscribers) {
      try {
        sub.sink.events([event]);
      } catch (error) {
        report(toError(error));
      }
    }
    return event;
  };

  const setReadiness = (state: ReadinessState): void => {
    if (state !== readiness) {
      readiness = state;
      emit({ origin: "external", state, type: "readiness" });
    }
  };

  const emitInvalidations = (
    cause: string,
    invalidations: readonly Invalidation[],
    origin: EventOrigin,
  ): void => {
    for (const event of invalidationEvents(cause, invalidations, origin)) {
      emit(event);
    }
  };

  const updateComponents = (origin: EventOrigin): void => {
    const tags = [
      ...new Set([...index.values()].flatMap((entry) => entry.defines ?? [])),
    ].toSorted();
    if (JSON.stringify(tags) !== JSON.stringify(components)) {
      components = tags;
      emit({ origin, tags, type: "componentsChanged" });
    }
  };

  // ── Reading documents ──
  const readConfig = (path: string, bytes: Uint8Array | null): ProjectConfig | undefined => {
    if (bytes === null) {
      return undefined;
    }
    const read = parseProjectFile(path, decoder.decode(bytes));
    return "config" in read ? read.config : undefined;
  };

  /** Classify a document and extract its references (§2.2, §8). */
  const describe = async (path: string, bytes: Uint8Array | null): Promise<Described> => {
    if (isConfigPath(path)) {
      const read = readConfig(path, bytes);
      /* Its references are extracted like any document's, so the usage query sees the layout and
         the files it names; the graph takes the configuration's own edges through `configure`. */
      return {
        kind: "project-config",
        // SAFETY: a parsed project file is a JSON object; `ProjectConfig` only names its members.
        refs: read === undefined ? null : extractRefs(read as JsonValue, "project-config"),
      };
    }
    const extension = extname(path).toLowerCase();
    if (extension === ".css") {
      return { kind: "style", refs: NO_REFS };
    }
    if (MEDIA.test(path)) {
      return { kind: "media", refs: NO_REFS };
    }
    if (bytes === null) {
      // Too large to read whole: listed and hashed, its references unread (§8.2).
      return { kind: kindByLocation(path), refs: null };
    }
    const text = decoder.decode(bytes);
    let doc: JsonValue;
    try {
      if (extension === ".json") {
        // SAFETY: JSON.parse without a reviver yields a JSON value; its `any` says no more.
        doc = JSON.parse(text) as JsonValue;
      } else if (extension === ".jxn") {
        const document = parseJxn(text);
        doc = isJsonObject(document) ? document : null;
      } else if (formats === null) {
        // A format an extension may register is classified only once they are loaded (§2.2).
        return { kind: "other", refs: null };
      } else if (formats.extensions.includes(extension)) {
        doc = await formats.parse(extension, text);
      } else {
        return { kind: kindByLocation(path), refs: NO_REFS };
      }
    } catch {
      return { kind: kindByLocation(path), refs: null };
    }
    const kind = componentTag(doc) === null ? kindByLocation(path) : "component";
    return { kind, refs: extractRefs(doc, kind) };
  };

  /** What the graph reads from the configuration and the collection loader (§8). */
  const graphConfig = (
    collections: Readonly<Record<string, readonly string[]>>,
  ): DependencyGraphConfig => {
    const layout = config?.defaults?.layout;
    return {
      collections,
      defaultLayout: isString(layout) ? layout : null,
      imports: config?.imports ?? {},
      mounts: formats?.mounts ?? [],
    };
  };

  const indexedFiles = (): string[] =>
    [...index].flatMap(([path, entry]) => (entry.isDir ? [] : [path]));

  const collectionsFor = async (
    files: readonly string[],
    with_: ProjectConfig | undefined,
  ): Promise<Readonly<Record<string, readonly string[]>>> => {
    try {
      return await resolveCollections({ config: with_, files, root });
    } catch (error) {
      report(toError(error));
      return {};
    }
  };

  /** Each path's content types, from the loader's lists. */
  const typesByPath = (
    collections: Readonly<Record<string, readonly string[]>>,
  ): Map<string, string> => {
    const byPath = new Map<string, string[]>();
    for (const [type, paths] of Object.entries(collections)) {
      for (const path of paths) {
        byPath.set(path, [...(byPath.get(path) ?? []), type]);
      }
    }
    return new Map([...byPath].map(([path, types]) => [path, JSON.stringify(types.toSorted())]));
  };

  /**
   * Tell the graph every path whose collection membership moved, before the change's `update`,
   * `remove` or `relabel` (§8).
   */
  const applyEntryTypes = (collections: Readonly<Record<string, readonly string[]>>): void => {
    const next = typesByPath(collections);
    for (const path of new Set([...entryTypes.keys(), ...next.keys()])) {
      const types = next.get(path) ?? "[]";
      if (types !== (entryTypes.get(path) ?? "[]")) {
        // SAFETY: written by typesByPath as a JSON array of strings.
        graph.setEntryTypes(path, JSON.parse(types) as string[]);
      }
    }
    entryTypes = next;
  };

  // ── Changing the index (each step's mutations and events share one synchronous segment) ──
  const mintDir = (path: string, origin: EventOrigin): void => {
    const docId = randomUUID();
    index.set(path, { defines: null, docId, indexed: true, isDir: true, kind: "other" });
    emit({ docId, isDir: true, origin, path, type: "fileAdded" });
  };

  /** Add `path` and every ancestor the index does not hold yet. */
  const ensureDirs = (path: string, origin: EventOrigin): void => {
    for (const dir of [...parents(path), path]) {
      if (inScope(dir) && !index.has(dir)) {
        mintDir(dir, origin);
      }
    }
  };

  const cancelHold = (path: string, entry: Entry): void => {
    if (entry.held !== undefined) {
      clearTimeout(entry.held);
      entry.held = undefined;
      holds.delete(path);
    }
  };

  /**
   * Put a file's new bytes into the index and append its events: the file event, its `docChanged`,
   * the configuration's event, the invalidations, and the component set (§4).
   */
  const applyFile = async (
    path: string,
    bytes: Uint8Array | null,
    hash: ContentHash,
    stats: Stats | null,
    origin: EventOrigin,
  ): Promise<ProjectEvent> => {
    const described = await describe(path, bytes);
    const isConfig = isConfigPath(path);
    const nextConfig = isConfig ? readConfig(path, bytes) : config;
    const collections = graphBuilt
      ? await collectionsFor([...new Set([...indexedFiles(), path])], nextConfig)
      : null;
    // ── one synchronous segment from here ──
    const existing = index.get(path);
    let entry: Entry;
    let event: ProjectEvent;
    const fields = {
      ...statFields(stats),
      defines: described.refs?.defines ?? null,
      hash,
      indexed: described.refs !== null,
      kind: described.kind,
      refs: described.refs,
      stale: false,
    };
    if (existing !== undefined && !existing.isDir) {
      entry = existing;
      cancelHold(path, entry);
      Object.assign(entry, fields);
      event = emit({ docId: entry.docId, hash, origin, path, type: "fileChanged" });
    } else {
      ensureDirs(parents(path).at(-1) ?? "", origin);
      entry = { ...fields, docId: randomUUID(), isDir: false };
      index.set(path, entry);
      event = emit({ docId: entry.docId, hash, isDir: false, origin, path, type: "fileAdded" });
    }
    const { docId } = entry;
    emit({
      docId,
      hash,
      indexed: entry.indexed,
      kind: entry.kind,
      origin,
      path,
      type: "docChanged",
    });
    if (isConfig) {
      config = nextConfig;
      emit({ hash, origin, path, type: "projectConfigChanged" });
    }
    if (graphBuilt && collections !== null) {
      if (isConfig) {
        graph.configure(graphConfig(collections));
        entryTypes = typesByPath(collections);
      } else {
        applyEntryTypes(collections);
      }
      emitInvalidations(docId, graph.update(docId, path, described.refs), origin);
    }
    updateComponents(origin);
    git?.schedule();
    return event;
  };

  /** Drop the echo ledger's pending writes at `path` and beneath it: nothing there to echo. */
  const forgetBeneath = (path: string): void => {
    for (const key of ledger.pending()) {
      if (key === path || key.startsWith(`${path}/`)) {
        ledger.forget(key);
      }
    }
  };

  /** Remove `path`, and everything beneath it, as one `fileRemoved` (§4.2). */
  const removePath = async (path: string, origin: EventOrigin): Promise<ProjectEvent | null> => {
    const entry = index.get(path);
    if (entry === undefined) {
      return null;
    }
    const gone = [...index].filter(([key]) => key === path || key.startsWith(`${path}/`));
    const goneSet = new Set(gone.map(([key]) => key));
    const configGone = gone.some(([key]) => isConfigPath(key));
    const collections = graphBuilt
      ? await collectionsFor(
          indexedFiles().filter((file) => !goneSet.has(file)),
          configGone ? undefined : config,
        )
      : null;
    // ── one synchronous segment from here ──
    for (const [key, removed] of gone) {
      cancelHold(key, removed);
      index.delete(key);
    }
    forgetBeneath(path);
    const event = emit({
      docId: entry.docId,
      isDir: entry.isDir,
      origin,
      path,
      type: "fileRemoved",
    });
    if (configGone) {
      config = undefined;
    }
    if (graphBuilt && collections !== null) {
      if (configGone) {
        // The default layout and the import map went with it (§8).
        graph.configure(graphConfig(collections));
        entryTypes = typesByPath(collections);
      } else {
        applyEntryTypes(collections);
      }
      for (const [, removed] of gone) {
        if (!removed.isDir) {
          emitInvalidations(removed.docId, graph.remove(removed.docId), origin);
        }
      }
    }
    updateComponents(origin);
    git?.schedule();
    return event;
  };

  /** A held removal at `from` and an add at `to` with its bytes: one move (§4.2). */
  const applyMove = async (
    from: string,
    to: string,
    bytes: Uint8Array | null,
    stats: Stats,
  ): Promise<void> => {
    const entry = index.get(from)!;
    const described = await describe(to, bytes);
    const collections = graphBuilt
      ? await collectionsFor([...indexedFiles().filter((file) => file !== from), to], config)
      : null;
    // ── one synchronous segment from here ──
    cancelHold(from, entry);
    index.delete(from);
    ensureDirs(parents(to).at(-1) ?? "", "external");
    index.set(to, entry);
    Object.assign(entry, statFields(stats));
    const { docId } = entry;
    emit({ docId, from, isDir: false, origin: "external", to, type: "fileRenamed" });
    const reclassified = described.kind !== entry.kind;
    if (reclassified) {
      Object.assign(entry, {
        defines: described.refs?.defines ?? null,
        indexed: described.refs !== null,
        kind: described.kind,
        refs: described.refs,
      });
      emit({
        docId,
        hash: entry.hash!,
        indexed: entry.indexed,
        kind: entry.kind,
        origin: "external",
        path: to,
        type: "docChanged",
      });
    }
    if (graphBuilt && collections !== null) {
      applyEntryTypes(collections);
      emitInvalidations(
        docId,
        reclassified ? graph.update(docId, to, described.refs) : graph.relabel(docId, to),
        "external",
      );
    }
    updateComponents("external");
    git?.schedule();
  };

  // ── Readiness (§7) ──
  const readManifest = async (): Promise<JsonObject | null> => {
    const bytes = await readReported(MANIFEST);
    if (bytes === null) {
      return null;
    }
    try {
      // SAFETY: JSON.parse without a reviver yields a JSON value; its `any` says no more.
      const value = JSON.parse(decoder.decode(bytes)) as JsonValue;
      return isJsonObject(value) ? value : null;
    } catch {
      return null;
    }
  };

  /** The lockfiles' hashes and the manifest's dependency fields, as one string (§7). */
  const currentFingerprint = async (): Promise<string> => {
    const manifest = await readManifest();
    const locks: (ContentHash | null)[] = [];
    for (const path of LOCKFILES) {
      const bytes = await readReported(path);
      locks.push(bytes === null ? null : await contentHash(bytes));
    }
    return JSON.stringify({
      deps: DEPENDENCY_FIELDS.map((field) => manifest?.[field] ?? null),
      locks,
    });
  };

  const schedulePrepare = (): void => {
    void exclusive(() => prepare()).catch(reportRejection);
  };

  /** Move back to `scaffolded` when a dependency input's fingerprint changed (§7). */
  const checkFingerprint = async (path: string, origin: EventOrigin): Promise<void> => {
    if (!FINGERPRINT_PATHS.has(path) || (origin !== "external" && origin.writeId === installing)) {
      return;
    }
    const current = await currentFingerprint();
    if (fingerprint === null) {
      schedulePrepare();
    } else if (current !== fingerprint) {
      setReadiness("scaffolded");
      schedulePrepare();
    }
  };

  /** What a configuration change can move beyond its own events: readiness and the scope. */
  const checkConfig = async (): Promise<void> => {
    const set = extensionSetOf(config);
    if (extensionSet !== null && set !== extensionSet) {
      extensionSet = set;
      if (readinessAtLeast(readiness, "extensions-resolved")) {
        setReadiness("installed");
      }
      schedulePrepare();
    }
    const nextOut = outDirOf(config);
    if (nextOut !== outDir) {
      outDir = nextOut;
      await reconcile();
    }
  };

  /** Follow-up checks after a change at `path`, outside its synchronous segment. */
  const afterChange = async (path: string, origin: EventOrigin): Promise<void> => {
    if (isConfigPath(path)) {
      await checkConfig();
    }
    await checkFingerprint(path, origin);
  };

  const formatsTokenOf = async (set: string, loaded: ProjectFormats): Promise<string> =>
    contentHash(JSON.stringify({ extensions: set, formats: [...loaded.extensions].toSorted() }));

  /** Hash, classify and extract every file not yet indexed, then build the graph (§3.1, §8). */
  const indexAll = async (): Promise<void> => {
    // No file's bytes outlive its own iteration: only what was read from them is kept.
    const read: [string, Entry, Stats, ContentHash, Described][] = [];
    for (const [path, entry] of index) {
      if (entry.isDir || (entry.hash !== undefined && entry.indexed && entry.stale !== true)) {
        continue;
      }
      const stats = await statOrNull(path);
      let loaded: Awaited<ReturnType<typeof load>> = null;
      try {
        loaded = stats === null ? null : await load(path, stats.size);
      } catch (error) {
        // Listed but unreadable: it stays unhashed, and a write over it is refused (§5).
        report(toError(error));
      }
      if (stats === null || loaded === null) {
        // Gone since it was listed (the watcher's removal follows), or unreadable.
        entry.stale = false;
        continue;
      }
      read.push([path, entry, stats, loaded.hash, await describe(path, loaded.bytes)]);
    }
    const collections = await collectionsFor(indexedFiles(), config);
    // ── one synchronous segment from here ──
    for (const [path, entry, stats, hash, described] of read) {
      const indexed = described.refs !== null;
      const changed =
        entry.hash !== hash || entry.kind !== described.kind || entry.indexed !== indexed;
      Object.assign(entry, {
        ...statFields(stats),
        defines: described.refs?.defines ?? null,
        hash,
        indexed,
        kind: described.kind,
        refs: described.refs,
        stale: false,
      });
      if (changed) {
        emit({
          docId: entry.docId,
          hash,
          indexed,
          kind: entry.kind,
          origin: "external",
          path,
          type: "docChanged",
        });
      }
    }
    graph = createDependencyGraph();
    graph.configure(graphConfig(collections));
    entryTypes = typesByPath(collections);
    for (const [path, entry] of index) {
      if (!entry.isDir && entry.refs !== undefined) {
        graph.update(entry.docId, path, entry.refs);
      }
    }
    graphBuilt = true;
    updateComponents("external");
  };

  /** Advance from wherever the host is towards `ready`, one state at a time (§7). */
  const prepare = async (): Promise<void> => {
    if (held || closed) {
      return;
    }
    if (readiness === "scaffolded") {
      if (installing !== null || !(await installedCheck(root, await readManifest()))) {
        return;
      }
      fingerprint = await currentFingerprint();
      setReadiness("installed");
    }
    if (readiness === "installed") {
      let loaded: ProjectFormats;
      try {
        loaded = await loadExtensions(root, config);
      } catch (error) {
        report(toError(error));
        loaded = NO_FORMATS;
      }
      extensionSet = extensionSetOf(config);
      formats = loaded;
      for (const entry of index.values()) {
        entry.stale = !entry.isDir;
      }
      const token = await formatsTokenOf(extensionSet, loaded);
      if (token !== formatsToken) {
        formatsToken = token;
        emit({ formats: token, origin: "external", type: "formatsChanged" });
      }
      setReadiness("extensions-resolved");
    }
    if (readiness === "extensions-resolved") {
      await indexAll();
      setReadiness("indexed");
    }
    setReadiness("ready");
  };

  // ── Observations (§2.4) ──
  /** A directory seen at `path`; a file indexed there, held or not, was replaced by it. */
  const observeDir = async (path: string): Promise<void> => {
    if (index.get(path)?.isDir === false) {
      await removePath(path, "external");
      await afterChange(path, "external");
    }
    if (!index.has(path)) {
      ensureDirs(path, "external");
    }
  };

  /**
   * Whether a move to or from `path` may be paired into a `fileRenamed`: never the configuration or
   * a dependency input, whose arrival and departure move the configuration and readiness (§4.2,
   * §7).
   */
  const pairable = (path: string): boolean => !isConfigPath(path) && !FINGERPRINT_PATHS.has(path);

  /** Hold an observed removal for the pairing bound (§2.4). */
  const observeRemoval = async (path: string): Promise<void> => {
    ledger.attribute(path, null);
    const entry = index.get(path);
    if (entry === undefined || entry.held !== undefined) {
      return;
    }
    if (entry.isDir) {
      await removePath(path, "external");
      return;
    }
    holds.add(path);
    // A stop clears every hold's timer (`cancelHold`), so one that fires is this generation's.
    entry.held = setTimeout(() => {
      void exclusive(() => flushHold(path)).catch(reportRejection);
    }, holdMs);
  };

  const observeFile = async (path: string): Promise<void> => {
    const stats = await statInside(path);
    if (stats === null) {
      return;
    }
    if (stats.isDirectory()) {
      await observeDir(path);
      return;
    }
    if (!stats.isFile()) {
      return;
    }
    const entry = index.get(path);
    if (
      entry !== undefined &&
      !entry.isDir &&
      entry.held === undefined &&
      entry.hash !== undefined &&
      entry.size === stats.size &&
      entry.mtimeMs === stats.mtimeMs
    ) {
      // The bytes the index holds: no read, but the ledger still sees the observation (§2.4).
      ledger.attribute(path, entry.hash);
      return;
    }
    const loaded = await load(path, stats.size);
    if (loaded === null) {
      return;
    }
    const { bytes, hash } = loaded;
    const origin = ledger.attribute(path, hash);
    if (origin !== "external" && entry !== undefined && !entry.isDir) {
      /* The echo of an own write, whose event is already in the log. A path the index does not
         hold has no such event, so a match there is indexed like any add. */
      if (entry.hash === hash) {
        Object.assign(entry, statFields(stats));
      }
      return;
    }
    if (entry !== undefined && !entry.isDir) {
      cancelHold(path, entry);
      if (entry.hash === hash) {
        Object.assign(entry, statFields(stats));
        return;
      }
      await applyFile(path, bytes, hash, stats, "external");
      await afterChange(path, "external");
      return;
    }
    if (entry?.isDir) {
      await removePath(path, "external");
    }
    const moved = pairable(path) ? await movedFrom(hash) : null;
    if (moved !== null) {
      await applyMove(moved, path, bytes, stats);
      return;
    }
    await applyFile(path, bytes, hash, stats, "external");
    await afterChange(path, "external");
  };

  /**
   * The indexed file an add with `hash` moved from, if one is gone: a held removal, or one whose
   * removal the watcher has not reported yet, since it may report the add of a move first (§4.2).
   */
  const movedFrom = async (hash: ContentHash): Promise<string | null> => {
    const candidates = [...index].filter(
      ([path, other]) => !other.isDir && other.hash === hash && pairable(path),
    );
    const pending = candidates.find(([, other]) => other.held !== undefined);
    if (pending !== undefined) {
      return pending[0];
    }
    for (const [path] of candidates) {
      if ((await statInside(path)) === null) {
        return path;
      }
    }
    return null;
  };

  /** A held removal outlived the bound: report it, as its directory's when that went too. */
  const flushHold = async (path: string): Promise<void> => {
    const entry = index.get(path);
    if (entry?.held === undefined) {
      return;
    }
    cancelHold(path, entry);
    const back = await statInside(path);
    if (back?.isFile() === true) {
      // Back on disk with no add reported: compare it as a change.
      await observeFile(path);
      return;
    }
    let top = path;
    for (const dir of parents(path)) {
      if (index.get(dir)?.isDir === true && (await statOrNull(dir)) === null) {
        top = dir;
        break;
      }
    }
    await removePath(top, "external");
    await afterChange(path, "external");
  };

  const processObservation = async (type: ProjectWatchEvent, path: string): Promise<void> => {
    if (closed) {
      return;
    }
    if (installing !== null && FINGERPRINT_PATHS.has(path)) {
      deferred.push([type, path]);
      return;
    }
    if (!inScope(path)) {
      if (FINGERPRINT_PATHS.has(path)) {
        // A lockfile outside the scope emits nothing, but still feeds readiness (§2.2, §7).
        const bytes = await readOrNull(path);
        const hash = bytes === null ? null : await contentHash(bytes);
        if (ledger.attribute(path, hash) === "external") {
          await checkFingerprint(path, "external");
        }
      }
      return;
    }
    if (type === "unlink" || type === "unlinkDir") {
      await observeRemoval(path);
    } else if (type === "addDir") {
      const stats = await statInside(path);
      if (stats?.isDirectory() === true) {
        await observeDir(path);
      }
    } else {
      await observeFile(path);
    }
  };

  /** Bring the index in line with the disk after the scope moved (`build.outDir`, §2.2). */
  const reconcile = async (): Promise<void> => {
    for (const path of index.keys()) {
      if (index.has(path) && !inScope(path)) {
        await removePath(path, "external");
      }
    }
    const disk = await scan();
    for (const [path, isDir] of disk) {
      if (index.has(path)) {
        continue;
      }
      if (isDir) {
        ensureDirs(path, "external");
      } else {
        await observeFile(path);
      }
    }
  };

  /** Every path in the index scope on disk, with whether it is a directory. */
  const scan = async (): Promise<Map<string, boolean>> => {
    const out = new Map<string, boolean>();
    const seen = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      let real: string;
      let names: string[];
      try {
        real = await fs.realpath(dir === "" ? root : toAbs(dir));
        names = await fs.readdir(dir === "" ? root : toAbs(dir));
      } catch {
        return;
      }
      if (seen.has(real)) {
        return;
      }
      seen.add(real);
      for (const name of names.toSorted()) {
        const path = dir === "" ? name : `${dir}/${name}`;
        if (!inScope(path)) {
          continue;
        }
        const stats = await statInside(path);
        if (stats?.isDirectory() === true) {
          out.set(path, true);
          await walk(path);
        } else if (stats?.isFile() === true) {
          out.set(path, false);
        }
      }
    };
    await walk("");
    return out;
  };

  // ── Lifecycle ──
  /**
   * End every open subscription. The set is emptied first, so a sink whose `end` subscribes again
   * keeps its new subscription, answered from the state that is current by then.
   */
  const endSubscriptions = (): void => {
    const ending = [...subscribers];
    subscribers.clear();
    for (const sub of ending) {
      try {
        sub.sink.end?.();
      } catch (error) {
        report(toError(error));
      }
    }
  };

  /**
   * Stop observing: nothing the old watcher or a held removal reports is processed after this. The
   * old state stays served, and its subscriptions open, until a start replaces it or close ends
   * them.
   */
  const stop = async (): Promise<void> => {
    generation += 1;
    for (const [path, entry] of index) {
      cancelHold(path, entry);
    }
    const [closingWatcher, closingGit] = [watcher, git];
    watcher = null;
    await Promise.all([closingWatcher?.close(), closingGit?.close()]);
  };

  const readConfigFromDisk = async (): Promise<ProjectConfig | undefined> => {
    for (const name of PROJECT_FILE_NAMES) {
      const bytes = await readReported(name);
      if (bytes !== null) {
        return readConfig(name, bytes);
      }
    }
    return undefined;
  };

  /**
   * Start, or start again: a new epoch, a scan, readiness from `scaffolded` (§2.3, §7). The new
   * state is built aside and replaces the old one in one synchronous step, which also ends every
   * subscription to the old one, so a subscribe at any point is answered from one whole state: the
   * old epoch's, and then ended, or the new one's, already scanned (§3.1).
   */
  const start = async (): Promise<void> => {
    const at = generation;
    let live = false;
    /** A failure the new watcher reported before the swap, reported in the new epoch. */
    const degradedBy: string[] = [];
    try {
      realRoot = await fs.realpath(root);
    } catch {
      realRoot = root;
    }
    config = await readConfigFromDisk();
    outDir = outDirOf(config);
    const degrade = (reason: string): void => {
      degraded = true;
      emit({ origin: "external", reason, type: "watcherDegraded" });
    };
    const handle = watcherFactory(
      root,
      {
        activity: () => {
          lastActivity = Date.now();
        },
        error: (error) => {
          report(error);
          if (at !== generation || closed) {
            return;
          }
          if (!live) {
            degradedBy.push(error.message);
          } else if (!degraded) {
            degrade(error.message);
          }
        },
        event: (type, path) => {
          lastActivity = Date.now();
          const rel = toRel(path);
          if (rel !== "" && !rel.startsWith("..")) {
            // Queued behind this start, so it is processed against the state it builds.
            void exclusive(() =>
              at === generation ? processObservation(type, rel) : undefined,
            ).catch(reportRejection);
          }
        },
      },
      { atomicSaveMs, ignored: createWatchIgnore(root, watchIgnored), stabilityMs },
    );
    watcher = handle;
    await handle.ready;
    const scanned = await scan();
    let monitor: GitMonitor | null = null;
    if (options.git !== false) {
      const monitorOptions: GitMonitorOptions = {
        onActivity: () => {
          lastActivity = Date.now();
        },
        onChange: (status) => {
          // Before the swap the monitor's summary is read by the new state's snapshot instead.
          if (live && at === generation && !closed) {
            emit({ origin: "external", status, type: "gitChanged" });
          }
        },
        onError: report,
        root,
      };
      if (options.git !== undefined) {
        monitorOptions.run = options.git;
      }
      if (options.gitWatch !== undefined) {
        monitorOptions.watch = options.gitWatch;
      }
      if (options.gitDebounceMs !== undefined) {
        monitorOptions.debounceMs = options.gitDebounceMs;
      }
      monitor = await createGitMonitor(monitorOptions);
    }
    // ── one synchronous segment from here: the old state is replaced whole ──
    log = createMemoryEventLog({
      capacity: options.logCapacity ?? EVENT_LOG_CAPACITY,
      epoch: randomUUID(),
    });
    ledger = createEchoLedger();
    index.clear();
    for (const [path, isDir] of scanned) {
      index.set(path, {
        defines: null,
        docId: randomUUID(),
        indexed: isDir,
        isDir,
        // Provisional until indexed: the locations that need no read (§3.1).
        kind: isDir ? "other" : isConfigPath(path) ? "project-config" : "other",
      });
    }
    graph = createDependencyGraph();
    graphBuilt = false;
    entryTypes = new Map();
    readiness = "scaffolded";
    fingerprint = null;
    extensionSet = null;
    formats = null;
    formatsToken = UNRESOLVED_FORMATS;
    components = [];
    degraded = false;
    deferred = [];
    git = monitor;
    live = true;
    endSubscriptions();
    const [firstFailure] = degradedBy;
    if (firstFailure !== undefined) {
      degrade(firstFailure);
    }
    schedulePrepare();
  };

  await exclusive(() => start());

  const snapshot = (): ProjectSnapshot => {
    const files: IndexedFile[] = [...index]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
    const out: ProjectSnapshot = {
      components: [...components],
      files,
      formats: formatsToken,
      readiness,
    };
    const summary = git?.summary;
    if (summary !== undefined) {
      out.git = summary;
    }
    return out;
  };

  const writeOrigin = (writeId: string, writeHash: ContentHash | null): WriteOrigin => ({
    writeHash,
    writeId,
  });

  /** Every file beneath a directory in the index scope, relative to it, with its hash (§5). */
  const filesBeneath = async (dir: string): Promise<Record<string, ContentHash>> => {
    const out: Record<string, ContentHash> = {};
    for (const [path, isDir] of await scan()) {
      if (!isDir && path.startsWith(`${dir}/`)) {
        const hash = await hashOf(path);
        if (hash !== null) {
          out[path.slice(dir.length + 1)] = hash;
        }
      }
    }
    return out;
  };

  /**
   * Rename a write's temporary file over its target, again after each of `renameRetryMs` when the
   * failure is one a reader holding the target open causes on Windows.
   */
  const renameOver = async (temp: string, target: string): Promise<void> => {
    for (const wait of renameRetryMs) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (error) {
        if (!RENAME_RETRY_CODES.has(errorCode(toError(error)) ?? "")) {
          throw error;
        }
      }
      await new Promise((resolve) => {
        setTimeout(resolve, wait);
      });
    }
    await fs.rename(temp, target);
  };

  /** A conditional write (§5), run by a caller that holds the queue. */
  const writeNow = async (request: WriteRequest): Promise<WriteResult> => {
    const path = await contained(request.path);
    const stats = await statOrNull(path);
    if (stats?.isDirectory() === true) {
      throw new TypeError(`"${path}" is a directory`);
    }
    // A file that exists but cannot be read rejects here: it is never taken for an absent one.
    const diskHash = stats === null ? null : await hashOf(path);
    const entry = index.get(path);
    const docId = entry !== undefined && !entry.isDir ? entry.docId : null;
    const refused = checkWritePrecondition(request, { docId, hash: diskHash });
    if (refused !== null && !refused.ok) {
      emit(conflictEvent(request, refused.conflict));
      return refused;
    }
    const bytes = toBytes(request.contents);
    const hash = await contentHash(bytes);
    if (hash === diskHash) {
      return { hash, ok: true, rev: log.rev };
    }
    /* Through a link that stays inside the root (`contained`), the link's target is written and
         the link kept, and an existing file keeps its permissions. */
    const target = stats === null ? toAbs(path) : await fs.realpath(toAbs(path));
    await fs.mkdir(dirname(target), { recursive: true });
    // Through a temporary file and a re-hash of the target, so the window is one rename (§5).
    const temp = join(dirname(target), `.${basename(target)}.jx-write-${randomUUID()}`);
    try {
      await fs.writeFile(temp, bytes);
      if (stats !== null) {
        // The permission bits alone: the mode's higher bits are the file's type.
        await fs.chmod(temp, stats.mode % 4096);
      }
      const nowHash = await hashOf(path);
      if (nowHash !== diskHash) {
        await fs.rm(temp, { force: true });
        const conflict = { diskHash: nowHash, docId, path };
        emit(conflictEvent(request, conflict));
        return { conflict, ok: false };
      }
      await renameOver(temp, target);
    } catch (error) {
      // Nothing was written: the temporary file goes, and nothing waits for an echo.
      await fs.rm(temp, { force: true });
      throw error;
    }
    /* Noted once the rename has landed and before any observation is compared, since those are
         processed in the queue this write holds (§2.4). An out-of-scope path is noted only when it
         is a dependency input, the one kind whose observations are still attributed (§7). */
    const origin = writeOrigin(request.writeId, hash);
    if (!inScope(path)) {
      if (FINGERPRINT_PATHS.has(path)) {
        ledger.note(path, hash, request.writeId);
      }
      await checkFingerprint(path, origin);
      return { hash, ok: true, rev: log.rev };
    }
    ledger.note(path, hash, request.writeId);
    // No size or time is recorded, so the first observation of the path reads it (§2.4, §5).
    const event = await applyFile(path, bytes, hash, null, origin);
    await afterChange(path, origin);
    return { hash, ok: true, rev: event.rev };
  };

  const write = (request: WriteRequest): Promise<WriteResult> => exclusive(() => writeNow(request));

  /**
   * Move `from`, a file or a directory, to `to` as the write `writeId`, run by a caller that holds
   * the queue (§9.1): the disk first, then in one synchronous segment the index re-keyed with every
   * document keeping its id, one `fileRenamed`, a `docChanged` for each file the move reclassified,
   * and the invalidations of both paths (§4.2, §8). Each moved file is noted in the echo ledger at
   * its new path, so the watcher's report of the move is recognised as this write. Answers the
   * directories it created for `to`, outermost first, for an undo to remove.
   */
  const moveNow = async (from: string, to: string, writeId: string): Promise<string[]> => {
    if (await takenBy(from, to)) {
      throw new Error(`"${to}" already exists`);
    }
    const created: string[] = [];
    for (const dir of parents(to)) {
      if ((await statOrNull(dir)) === null) {
        created.push(dir);
      }
    }
    await fs.mkdir(dirname(toAbs(to)), { recursive: true });
    await fs.rename(toAbs(from), toAbs(to));
    const moved = [...index].filter(([key]) => key === from || key.startsWith(`${from}/`));
    const nextOf = (key: string): string => to + key.slice(from.length);
    const described = new Map<string, Described>();
    for (const [key, entry] of moved) {
      if (!entry.isDir) {
        const next = nextOf(key);
        const stats = await statOrNull(next);
        let loaded: Awaited<ReturnType<typeof load>> = null;
        try {
          loaded = stats === null ? null : await load(next, stats.size);
        } catch (error) {
          report(toError(error));
        }
        described.set(key, await describe(next, loaded?.bytes ?? null));
      }
    }
    const movedFiles = new Set(moved.flatMap(([key, entry]) => (entry.isDir ? [] : [key])));
    const collections = graphBuilt
      ? await collectionsFor(
          [
            ...indexedFiles().filter((file) => !movedFiles.has(file)),
            ...[...movedFiles].map((file) => nextOf(file)),
          ],
          config,
        )
      : null;
    // ── one synchronous segment from here ──
    const top = index.get(from)!;
    for (const [key, entry] of moved) {
      cancelHold(key, entry);
      index.delete(key);
    }
    forgetBeneath(from);
    const origin = writeOrigin(writeId, top.isDir ? null : (top.hash ?? null));
    ensureDirs(parents(to).at(-1) ?? "", origin);
    for (const [key, entry] of moved) {
      const next = nextOf(key);
      index.set(next, entry);
      Object.assign(entry, { mtimeMs: undefined, size: undefined });
      if (!entry.isDir && entry.hash !== undefined) {
        ledger.note(next, entry.hash, writeId);
      }
    }
    emit({ docId: top.docId, from, isDir: top.isDir, origin, to, type: "fileRenamed" });
    if (graphBuilt && collections !== null) {
      applyEntryTypes(collections);
    }
    for (const [key, entry] of moved) {
      const fresh = described.get(key);
      if (fresh === undefined) {
        continue;
      }
      const next = nextOf(key);
      const reclassified = fresh.kind !== entry.kind;
      if (reclassified) {
        Object.assign(entry, {
          defines: fresh.refs?.defines ?? null,
          indexed: fresh.refs !== null,
          kind: fresh.kind,
          refs: fresh.refs,
        });
        emit({
          docId: entry.docId,
          hash: entry.hash!,
          indexed: entry.indexed,
          kind: entry.kind,
          origin,
          path: next,
          type: "docChanged",
        });
      }
      if (graphBuilt && collections !== null) {
        emitInvalidations(
          entry.docId,
          reclassified
            ? graph.update(entry.docId, next, fresh.refs)
            : graph.relabel(entry.docId, next),
          origin,
        );
      }
    }
    updateComponents(origin);
    git?.schedule();
    return created;
  };

  /**
   * Whether something other than `from` is at `to` on disk. On a case-insensitive filesystem (the
   * desktop's macOS and Windows), `from` in another case stats as `from` itself, and a rename to it
   * changes only its case (`studio.md` §9.1.1).
   */
  const takenBy = async (from: string, to: string): Promise<boolean> => {
    const there = await statOrNull(to);
    if (there === null) {
      return false;
    }
    if (from.toLowerCase() !== to.toLowerCase()) {
      return true;
    }
    const self = await statOrNull(from);
    return self === null || self.ino !== there.ino || self.dev !== there.dev;
  };

  /** Remove each of `dirs` still empty, innermost first, as the write `writeId` (§9.1). */
  const removeDirs = async (dirs: readonly string[], writeId: string): Promise<void> => {
    for (const dir of dirs.toReversed()) {
      const inside = await fs.readdir(toAbs(dir));
      if (inside.length > 0) {
        return;
      }
      await fs.rm(toAbs(dir), { recursive: true });
      await removePath(dir, writeOrigin(writeId, null));
    }
  };

  /** The rename cascade (§9), with this host's index, graph and writes lent for one operation. */
  const rename = (operation: RenameOperation): Promise<RenameOperationResult> =>
    exclusive(async () => {
      const from = await contained(operation.from);
      const to = await contained(operation.to);
      for (const path of [from, to]) {
        if (!inScope(path)) {
          throw new TypeError(`"${path}" is outside the index scope`);
        }
      }
      // Plan with the project's parsers: load them first if the host has not yet (§7, §9.1).
      if (formats === null) {
        await prepare();
      }
      try {
        return await runRenameCascade(
          {
            applied: (opId, files) =>
              emit({ files, opId, origin: writeOrigin(opId, null), type: "operationApplied" }).rev,
            entries: () =>
              [...index].map(([path, entry]) => ({
                indexed: entry.indexed,
                isDir: entry.isDir,
                path,
              })),
            exists: (path) => takenBy(from, path),
            /* Held, the host will load the parsers once released, so the graph is partial until
               then. Otherwise its dependencies are not installed, and no format is registered: a
               file in none is not a document (§2.2). */
            formats: () => formats ?? (held ? null : NO_FORMATS),
            move: moveNow,
            read: readOrNull,
            removeDirs,
            referrersOf: (paths) => {
              if (!graphBuilt || degraded) {
                return null;
              }
              const byId = new Map([...index].map(([path, entry]) => [entry.docId, path]));
              const out = new Set<string>();
              for (const path of paths) {
                const entry = index.get(path);
                const dependents =
                  entry === undefined ? graph.dependentsAt(path) : graph.dependentsOf(entry.docId);
                for (const ids of dependents.values()) {
                  for (const id of ids) {
                    const at = byId.get(id);
                    if (at !== undefined) {
                      out.add(at);
                    }
                  }
                }
              }
              return [...out];
            },
            root,
            write: writeNow,
            ...(options.onRenameStep !== undefined && { beforeStep: options.onRenameStep }),
          },
          { ...operation, from, to },
          (path) => !pairable(path),
        );
      } finally {
        /* The usage query's cache (`findReferences`) is otherwise dropped by a watcher that reports
           the move after this answer, and never under a path it ignores; the caller's next
           question is who uses the new name (§12). */
        invalidateReferenceCache(root);
      }
    });

  const remove = (request: DeleteRequest): Promise<DeleteResult> =>
    exclusive(async () => {
      const path = await contained(request.path);
      const stats = await statOrNull(path);
      let current: DeleteBase | null = null;
      if (stats?.isFile() === true) {
        // A file that cannot be read rejects here, and one gone since its stat is absent.
        const hash = await hashOf(path);
        current = hash === null ? null : { hash };
      } else if (stats?.isDirectory() === true) {
        current = { files: await filesBeneath(path) };
      }
      const entry = index.get(path);
      const refused = checkDeletePrecondition(request, current, entry?.docId ?? null);
      if (refused !== null && !refused.ok) {
        emit(conflictEvent(request, refused.conflict));
        return refused;
      }
      await fs.rm(toAbs(path), { force: true, recursive: true });
      forgetBeneath(path);
      const origin = writeOrigin(request.writeId, null);
      const event = inScope(path) ? await removePath(path, origin) : null;
      await afterChange(path, origin);
      return { ok: true, rev: event?.rev ?? log.rev };
    });

  const install = async (): Promise<void> => {
    const writeId = `install-${randomUUID()}`;
    await exclusive(() => {
      installing = writeId;
      deferred = [];
    });
    let failure: Error | null = null;
    try {
      await installer(root);
    } catch (error) {
      failure = toError(error);
    }
    await exclusive(async () => {
      // The install's own writes, recorded with its write id before the watcher reports them (§7).
      for (const path of FINGERPRINT_PATHS) {
        if (!inScope(path)) {
          continue;
        }
        const bytes = await readReported(path);
        const entry = index.get(path);
        if (bytes === null) {
          if (entry !== undefined) {
            await removePath(path, failure === null ? writeOrigin(writeId, null) : "external");
          }
          continue;
        }
        const hash = await contentHash(bytes);
        if (entry?.hash !== hash) {
          await applyFile(
            path,
            bytes,
            hash,
            await statOrNull(path),
            failure === null ? writeOrigin(writeId, hash) : "external",
          );
        }
      }
      if (failure === null) {
        fingerprint = await currentFingerprint();
      }
      const pending = deferred;
      deferred = [];
      for (const [type, path] of pending) {
        await processObservation(type, path);
      }
      if (failure === null && readiness === "scaffolded" && !held) {
        setReadiness("installed");
      }
      installing = null;
      await (failure === null ? prepare() : checkFingerprint(MANIFEST, "external"));
    });
    if (failure !== null) {
      throw failure;
    }
  };

  const idle = async (quietMs = 300): Promise<void> => {
    const started = Date.now();
    for (;;) {
      await chain;
      const quiet = Date.now() - Math.max(started, lastActivity) >= quietMs;
      if (
        quiet &&
        queued === 0 &&
        holds.size === 0 &&
        installing === null &&
        (git?.idle() ?? true)
      ) {
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  };

  return {
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await exclusive(async () => {
        await stop();
        endSubscriptions();
      });
    },
    createDirectory: (path, writeId) =>
      exclusive(async () => {
        const dir = await contained(path);
        await fs.mkdir(toAbs(dir), { recursive: true });
        ensureDirs(dir, writeOrigin(writeId, null));
        return { rev: log.rev };
      }),
    delete: remove,
    docIdAt: (path) => {
      const entry = index.get(path);
      return entry === undefined ? null : entry.docId;
    },
    get epoch() {
      return log.epoch;
    },
    idle,
    install,
    get readiness() {
      return readiness;
    },
    release: () =>
      exclusive(async () => {
        held = false;
        await prepare();
      }),
    rename,
    restart: () =>
      exclusive(async () => {
        await stop();
        await start();
      }),
    get rev() {
      return log.rev;
    },
    references: () =>
      readinessAtLeast(readiness, "indexed") && !degraded
        ? {
            documents: graph.documents(),
            extensions: formats?.extensions ?? [],
            mounts: formats?.mounts ?? [],
          }
        : null,
    root,
    snapshot,
    subscribe(request, sink) {
      const response = answerSubscribe(log, request, snapshot);
      const sub: Subscriber = { sink };
      if (!closed) {
        subscribers.add(sub);
      }
      return {
        close() {
          subscribers.delete(sub);
        },
        response,
      };
    },
    write,
  };
}
