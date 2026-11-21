/**
 * The project state contract: one model of a project that every Studio backend serves and every
 * Studio client derives its caches from (`specs/project-state.md`).
 *
 * A backend (the desktop utility process, the dev server, the cloud's project Durable Object) owns
 * the file index, content hashes, a revision counter with a replay log, the dependency graph,
 * readiness and the git monitor. A client subscribes with the last revision it saw and receives
 * either the events since then or a snapshot. Writes name the bytes they replace, so two writers
 * can never silently overwrite each other.
 *
 * This module holds the wire types and the small pure pieces every host and client must agree on
 * exactly: the hash spelling (§2.1), the replay log and the subscribe answer (§2.3, §3.1), echo
 * attribution by content hash (§2.4), the unsaved-buffer derivation (§6.1) and the readiness order
 * (§7). No host serves it yet (§10).
 *
 * @module
 */

/** One SHA-256 digest of a file's bytes, spelled `sha256-<base64>` (§2.1). */
export type ContentHash = `sha256-${string}`;

/**
 * A stable identity for one project document, minted by the host and kept across renames (§2.2).
 * Opaque to clients: compare for equality only.
 */
export type DocId = string;

/** What a document is to the project, as far as the host's index can tell (§2.2). */
export type DocKind =
  | "page"
  | "layout"
  | "component"
  | "content"
  | "data"
  | "media"
  | "style"
  | "project-config"
  | "other";

const HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

/** Whether `value` is a well-formed {@link ContentHash}. */
export function isContentHash(value: unknown): value is ContentHash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

/**
 * The {@link ContentHash} of a file's bytes. A string is hashed as its UTF-8 encoding, so a host
 * that reads text and one that reads bytes agree on the same file.
 */
export async function contentHash(contents: Uint8Array | string): Promise<ContentHash> {
  // Copying into a fresh view makes the bytes `ArrayBuffer`-backed whatever backed them before (a
  // Node `Buffer` from a pool, a `SharedArrayBuffer`), which is what `digest` accepts.
  const bytes =
    contents instanceof Uint8Array ? new Uint8Array(contents) : new TextEncoder().encode(contents);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) {
    binary += String.fromCodePoint(byte);
  }
  return `sha256-${btoa(binary)}`;
}

// ─── Origin (§2.4) ─────────────────────────────────────────────────────────────────────────────

/**
 * A change a write through the contract caused (§5): the write's id and the hash it wrote. Origins
 * are host-global: every subscriber sees the same origin for the same event, whichever client
 * issued the write, and a client recognises its own with {@link isOwnOrigin}.
 */
export interface WriteOrigin {
  writeId: string;
  /** The hash the write left on disk; `null` for a delete (§5). */
  writeHash: ContentHash | null;
}

/**
 * Who caused an event: one write or delete through the contract, or anything the host did not
 * perform (§2.4).
 */
export type EventOrigin = WriteOrigin | "external";

/** Whether `origin` is one of `writeIds`, the writes this client issued. */
export function isOwnOrigin(origin: EventOrigin, writeIds: ReadonlySet<string>): boolean {
  return origin !== "external" && writeIds.has(origin.writeId);
}

/**
 * The host's record of its own writes whose watcher observations have not arrived yet (§2.4). A
 * host records a write's event when it writes (§5), so the ledger only has to recognise an
 * observation that is stale by the time the host compares it: one whose hash is a pending write's
 * is that write's echo and is dropped; any other hash is external. Attribution is by the bytes
 * observed, never by how recently a write happened.
 */
export interface EchoLedger {
  /** Record a write the host is about to perform. */
  note: (path: string, writeHash: ContentHash, writeId: string) => void;
  /**
   * Attribute an observed change. A match consumes that entry and every older entry for the path,
   * because a watcher may coalesce several writes into one event that shows only the last. An
   * external hash, or a removal (`null`), clears the path's pending entries, so a later change that
   * happens to restore an own write's bytes is not attributed to that stale write.
   */
  attribute: (path: string, observedHash: ContentHash | null) => EventOrigin;
  /** Drop every pending entry for a path (a failed write, a removed file). */
  forget: (path: string) => void;
  /** Paths with pending entries, for tests and diagnostics. */
  pending: () => string[];
}

/** Pending writes kept per path; an older entry past this is dropped as never observed. */
export const ECHO_LEDGER_DEPTH = 8;

/** An in-memory {@link EchoLedger}. */
export function createEchoLedger(depth: number = ECHO_LEDGER_DEPTH): EchoLedger {
  const entries = new Map<string, WriteOrigin[]>();
  return {
    note(path, writeHash, writeId) {
      const list = entries.get(path) ?? [];
      list.push({ writeHash, writeId });
      if (list.length > depth) {
        list.splice(0, list.length - depth);
      }
      entries.set(path, list);
    },
    attribute(path, observedHash) {
      const list = entries.get(path);
      const at = list?.findLastIndex((entry) => entry.writeHash === observedHash) ?? -1;
      if (!list || at === -1) {
        entries.delete(path);
        return "external";
      }
      const match = list[at]!;
      list.splice(0, at + 1);
      if (list.length === 0) {
        entries.delete(path);
      }
      return match;
    },
    forget(path) {
      entries.delete(path);
    },
    pending() {
      return [...entries.keys()];
    },
  };
}

// ─── Readiness (§7) ────────────────────────────────────────────────────────────────────────────

/** How far the host has prepared the project, in order (§7). */
export const READINESS_ORDER = [
  "scaffolded",
  "installed",
  "extensions-resolved",
  "indexed",
  "ready",
] as const;

export type ReadinessState = (typeof READINESS_ORDER)[number];

/** Whether `state` has reached `min` (every state reaches itself). */
export function readinessAtLeast(state: ReadinessState, min: ReadinessState): boolean {
  return READINESS_ORDER.indexOf(state) >= READINESS_ORDER.indexOf(min);
}

// ─── Git (§4.5) ────────────────────────────────────────────────────────────────────────────────

/** The working-tree state of one saved file relative to `HEAD` (§6.2). */
export type WorkingState =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

/** What the git monitor reports about the project's repository (§4.5). */
export interface GitSummary {
  /** The checked-out branch, `null` when `HEAD` is detached or there is no repository. */
  branch: string | null;
  /** The commit `HEAD` names, `null` before the first commit or without a repository. */
  head: string | null;
  /** Every path whose working state is not `unmodified`, project-relative. */
  changed: Record<string, WorkingState>;
}

// ─── Dependency graph (§8) ─────────────────────────────────────────────────────────────────────

/** The kinds of edge the host's dependency graph records (§8.1). */
export type DependencyKind =
  | "component-instance"
  | "layout-page"
  | "content-collection"
  | "media-referrer"
  | "data-consumer"
  | "project-config";

// ─── Events (§4) ───────────────────────────────────────────────────────────────────────────────

/** Fields every event carries (§4.1). */
export interface EventBase {
  /** The revision this event produced; strictly increasing within one epoch. */
  rev: number;
  origin: EventOrigin;
}

export interface FileAddedEvent extends EventBase {
  type: "fileAdded";
  path: string;
  docId: DocId;
  isDir: boolean;
  /** Absent for a directory, and for a file the host has not hashed yet (§3.1). */
  hash?: ContentHash;
}

export interface FileChangedEvent extends EventBase {
  type: "fileChanged";
  path: string;
  docId: DocId;
  hash: ContentHash;
}

export interface FileRemovedEvent extends EventBase {
  type: "fileRemoved";
  path: string;
  docId: DocId;
  isDir: boolean;
}

export interface FileRenamedEvent extends EventBase {
  type: "fileRenamed";
  from: string;
  to: string;
  /** Unchanged across the rename: that is what makes it a rename rather than a remove and an add. */
  docId: DocId;
  isDir: boolean;
}

export interface DocChangedEvent extends EventBase {
  type: "docChanged";
  docId: DocId;
  path: string;
  kind: DocKind;
  hash: ContentHash;
  /** Whether the host has extracted this document's outgoing references (§3.1, §8.2). */
  indexed: boolean;
}

export interface DependentsInvalidatedEvent extends EventBase {
  type: "dependentsInvalidated";
  /** The document whose change invalidated the others, and the edge kind that carried it. */
  cause: { docId: DocId; kind: DependencyKind };
  docIds: DocId[];
  /** Custom-element tags whose definitions changed, for component caches keyed by tag. */
  tags: string[];
  /** `false` when the host's graph is partial for this cause (§8.2). */
  complete: boolean;
}

export interface ComponentsChangedEvent extends EventBase {
  type: "componentsChanged";
  /** The whole set of discoverable component tags after the change, not a delta. */
  tags: string[];
}

export interface FormatsChangedEvent extends EventBase {
  type: "formatsChanged";
  /** The new format-set token (`ProjectSnapshot.formats`). */
  formats: string;
}

export interface ProjectConfigChangedEvent extends EventBase {
  type: "projectConfigChanged";
  path: string;
  hash: ContentHash;
}

export interface GitChangedEvent extends EventBase {
  type: "gitChanged";
  status: GitSummary;
}

export interface ReadinessEvent extends EventBase {
  type: "readiness";
  state: ReadinessState;
}

export interface ConflictEvent extends EventBase {
  type: "conflict";
  path: string;
  /** The document at `path` now; `null` when nothing is there. */
  docId: DocId | null;
  /** What is on disk now; `null` when nothing is there. */
  diskHash: ContentHash | null;
  /** The refused write or delete, so its issuer can match the event to its request. */
  writeId: string;
  /** Echoed from the refused request when it carried one; meaningful only to its issuer (§6.1). */
  bufferRev?: number;
}

export interface OperationAppliedEvent extends EventBase {
  type: "operationApplied";
  opId: string;
  /** Every path the operation wrote, renamed or removed, in the order it applied them. */
  files: string[];
}

export interface WatcherDegradedEvent extends EventBase {
  type: "watcherDegraded";
  /** A short, human-readable reason; clients must not parse it. */
  reason: string;
}

/** Every event a subscription carries (§4). */
export type ProjectEvent =
  | FileAddedEvent
  | FileChangedEvent
  | FileRemovedEvent
  | FileRenamedEvent
  | DocChangedEvent
  | DependentsInvalidatedEvent
  | ComponentsChangedEvent
  | FormatsChangedEvent
  | ProjectConfigChangedEvent
  | GitChangedEvent
  | ReadinessEvent
  | ConflictEvent
  | OperationAppliedEvent
  | WatcherDegradedEvent;

export type ProjectEventType = ProjectEvent["type"];

/** An event before the log assigns its revision. */
export type ProjectEventInit = ProjectEvent extends infer E
  ? E extends ProjectEvent
    ? Omit<E, "rev">
    : never
  : never;

// ─── Snapshot and subscription (§3) ────────────────────────────────────────────────────────────

/** One file in a snapshot (§3.1). */
export interface IndexedFile {
  path: string;
  docId: DocId;
  /** Provisional (`other` at worst) until the host reaches `extensions-resolved` (§7). */
  kind: DocKind;
  isDir: boolean;
  /** Absent for a directory, and for a file the host has not hashed yet. */
  hash?: ContentHash;
  /**
   * Whether the host has extracted this document's outgoing references. Stays `false` for a
   * document the host cannot parse, which is what makes its graph partial (§8.2).
   */
  indexed: boolean;
}

/** The whole state at one revision (§3.1). */
export interface ProjectSnapshot {
  files: IndexedFile[];
  readiness: ReadinessState;
  /** Absent when the project is not in a repository or the host has no git monitor. */
  git?: GitSummary;
  /** Every discoverable component tag, the set `componentsChanged` replaces (§4.3). */
  components: string[];
  /** An opaque token naming the project's format set; it changes whenever the set does (§4.4). */
  formats: string;
}

/** What a client sends on every connect (§3.1). */
export interface SubscribeRequest {
  /**
   * Names the client across reconnects (one Studio window or tab), so state the host keeps per
   * client, such as a preview overlay, survives a resubscribe (§11.3).
   */
  clientId?: string;
  /** The epoch the client's state belongs to; absent on a first connect. */
  epoch?: string;
  /** The last revision the client applied; absent on a first connect. */
  sinceRev?: number;
}

/** What a host answers to {@link SubscribeRequest} (§3.1). */
export type SubscribeResponse =
  | { kind: "snapshot"; epoch: string; rev: number; snapshot: ProjectSnapshot }
  | { kind: "events"; epoch: string; rev: number; events: ProjectEvent[] };

// ─── Writes (§5) ───────────────────────────────────────────────────────────────────────────────

/**
 * A file's bytes as a JSON binding carries them (§3.2): text as a string, anything else as base64.
 * The in-process API takes `string | Uint8Array` directly.
 */
export type WireContents = string | { encoding: "base64"; data: string };

/** A write through the contract (§5). */
export interface WriteRequest {
  path: string;
  contents: string | Uint8Array;
  /** The hash the writer last read; `null` asserts the file does not exist. */
  baseHash: ContentHash | null;
  /** Chosen by the writer, unique per write; echoed in the resulting events' origin. */
  writeId: string;
  /** The writer's buffer revision (§6.1), echoed in a refusal; the host never interprets it. */
  bufferRev?: number;
}

/** What is at a path when a write or delete is checked (§5). */
export interface DiskState {
  hash: ContentHash | null;
  docId: DocId | null;
}

/** Why a write or delete was refused: what is at the path now (§5). */
export interface WriteConflict {
  path: string;
  docId: DocId | null;
  diskHash: ContentHash | null;
}

/**
 * A write's answer: the revision and hash it produced, or the conflict that refused it (§5). A
 * write whose bytes equal the disk's produces no event and answers the host's current revision.
 */
export type WriteResult =
  | { ok: true; rev: number; hash: ContentHash }
  | { ok: false; conflict: WriteConflict };

/** The precondition check every host runs before a write touches the disk (§5). */
export function checkWritePrecondition(
  request: Pick<WriteRequest, "path" | "baseHash">,
  disk: DiskState,
): WriteResult | null {
  return request.baseHash === disk.hash
    ? null
    : { ok: false, conflict: { path: request.path, docId: disk.docId, diskHash: disk.hash } };
}

/**
 * A conditional delete (§5). A file's base is `{ hash }`, the hash the writer last read. A
 * directory's base is `{ files }`: every file beneath it, by path relative to the directory, with
 * the hash the writer last read, so any file added, removed or changed since is a conflict.
 */
export interface DeleteRequest {
  path: string;
  base: DeleteBase;
  writeId: string;
}

/** What a delete removes, as its writer last saw it (§5). */
export type DeleteBase = { hash: ContentHash } | { files: Record<string, ContentHash> };

/** A delete's answer: the revision of its `fileRemoved`, or the conflict that refused it (§5). */
export type DeleteResult = { ok: true; rev: number } | { ok: false; conflict: WriteConflict };

/** Whether two delete bases name the same file bytes or the same directory contents. */
function sameDeleteBase(want: DeleteBase, have: DeleteBase): boolean {
  if ("hash" in want || "hash" in have) {
    return "hash" in want && "hash" in have && want.hash === have.hash;
  }
  const entries = Object.entries(want.files);
  return (
    entries.length === Object.keys(have.files).length &&
    entries.every(([path, hash]) => have.files[path] === hash)
  );
}

/**
 * The precondition check for a delete (§5). `current` is what is at the path now, in the same shape
 * as the request's base, or `null` when nothing is there.
 */
export function checkDeletePrecondition(
  request: Pick<DeleteRequest, "path" | "base">,
  current: DeleteBase | null,
  docId: DocId | null,
): DeleteResult | null {
  if (current !== null && sameDeleteBase(request.base, current)) {
    return null;
  }
  const diskHash = current !== null && "hash" in current ? current.hash : null;
  return { ok: false, conflict: { path: request.path, docId, diskHash } };
}

/**
 * The `conflict` event a host emits for a refused write or delete (§4.7), built from the request
 * and the refusal so the two shapes cannot drift apart. Its origin is `"external"` because it
 * records no change; `writeId` names the refused request.
 */
export function conflictEvent(
  request: Pick<WriteRequest, "writeId" | "bufferRev">,
  conflict: WriteConflict,
): Extract<ProjectEventInit, { type: "conflict" }> {
  const event: Extract<ProjectEventInit, { type: "conflict" }> = {
    type: "conflict",
    origin: "external",
    ...conflict,
    writeId: request.writeId,
  };
  if (request.bufferRev !== undefined) {
    event.bufferRev = request.bufferRev;
  }
  return event;
}

// ─── Rename cascade (§9) ───────────────────────────────────────────────────────────────────────

/** What a rename does to a referrer the client holds unsaved (§9.2). */
export type DirtyReferrerPolicy = "refuse" | "rewrite-buffer";

/** One rename as a single operation (§9.1). */
export interface RenameOperation {
  opId: string;
  from: string;
  to: string;
  policy: DirtyReferrerPolicy;
  /** Referrers the client holds unsaved, with the buffer revision each is at. */
  dirtyReferrers: { path: string; bufferRev: number }[];
  /**
   * Rewrites the client computed for documents the host cannot parse (§9.1): each names the bytes
   * it replaces, and the host applies them as steps of the same outbox.
   */
  rewrites?: { path: string; baseHash: ContentHash; contents: string | Uint8Array }[];
}

// ─── The unsaved buffer (§6.1) ─────────────────────────────────────────────────────────────────

/** A client's open copy of one file (§6.1). */
export interface BufferState {
  /** What the host last reported on disk; `null` when the file does not exist. */
  diskHash: ContentHash | null;
  /** The disk hash the buffer was loaded from or last saved as. */
  baseHash: ContentHash | null;
  /** Bumped on every edit to the buffer. */
  bufferRev: number;
  /** The buffer revision that matches `baseHash`'s bytes. */
  savedRev: number;
}

export type BufferStatus = "clean" | "dirty" | "conflicted";

/**
 * Derive a buffer's status (§6.1). An unedited buffer is `clean` even when the disk moved under it:
 * the client adopts the new bytes, which {@link isBehindDisk} reports. An edited buffer whose base
 * is no longer on disk is `conflicted`.
 */
export function bufferStatus(state: BufferState): BufferStatus {
  if (state.bufferRev === state.savedRev) {
    return "clean";
  }
  return state.baseHash === state.diskHash ? "dirty" : "conflicted";
}

/** Whether a clean buffer holds bytes the disk no longer has, and should be re-read (§6.1). */
export function isBehindDisk(state: BufferState): boolean {
  return bufferStatus(state) === "clean" && state.baseHash !== state.diskHash;
}

// ─── The replay log (§2.3) ─────────────────────────────────────────────────────────────────────

/** A host's revision counter and its window of recent events (§2.3). */
export interface ProjectEventLog {
  /** Names this log's revision sequence; a new one starts whenever revisions restart. */
  readonly epoch: string;
  /** The newest revision; `0` before the first event. */
  readonly rev: number;
  /** Assign the next revision to an event and keep it in the window. */
  append: (event: ProjectEventInit) => ProjectEvent;
  /**
   * The events after `sinceRev`, oldest first, or `null` when the window no longer holds all of
   * them (or `sinceRev` is ahead of this log).
   */
  since: (sinceRev: number) => ProjectEvent[] | null;
}

/** Events an in-memory log keeps by default. */
export const EVENT_LOG_CAPACITY = 1024;

/** An in-memory {@link ProjectEventLog} over a ring buffer of `capacity` events. */
export function createMemoryEventLog(options: {
  epoch: string;
  capacity?: number;
}): ProjectEventLog {
  const capacity = options.capacity ?? EVENT_LOG_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }
  const ring: (ProjectEvent | undefined)[] = Array.from({ length: capacity });
  let rev = 0;
  return {
    epoch: options.epoch,
    get rev() {
      return rev;
    },
    append(init) {
      rev += 1;
      // SAFETY: `init` is one member of the ProjectEvent union minus `rev`, and spreading it with
      // `rev` restores exactly that member; TypeScript cannot follow a spread through a union.
      const event = { ...init, rev } as ProjectEvent;
      ring[rev % capacity] = event;
      return event;
    },
    since(sinceRev) {
      if (!Number.isInteger(sinceRev) || sinceRev < 0 || sinceRev > rev) {
        return null;
      }
      if (rev - sinceRev > capacity) {
        return null;
      }
      const out: ProjectEvent[] = [];
      for (let r = sinceRev + 1; r <= rev; r += 1) {
        out.push(ring[r % capacity]!);
      }
      return out;
    },
  };
}

/**
 * Answer a subscribe (§3.1): the events since the client's revision when the log still holds them
 * all and the epochs match, otherwise a snapshot at the log's current revision.
 */
export function answerSubscribe(
  log: ProjectEventLog,
  request: SubscribeRequest,
  snapshot: () => ProjectSnapshot,
): SubscribeResponse {
  const { epoch, rev } = log;
  if (request.epoch === epoch && request.sinceRev !== undefined) {
    const events = log.since(request.sinceRev);
    if (events) {
      return { kind: "events", epoch, rev, events };
    }
  }
  return { kind: "snapshot", epoch, rev, snapshot: snapshot() };
}
