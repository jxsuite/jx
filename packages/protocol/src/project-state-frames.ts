/**
 * The project state contract on a wire (`specs/project-state.md` §3.2, §5): one codec per transport
 * binding, the gap detector every client runs, and the HTTP precondition headers a write carries.
 *
 * Three bindings carry the same exchange: the desktop window's RPC WebSocket, the dev server's
 * Server-Sent Events stream, and the cloud session's `/events` WebSocket. Every frame is JSON, and
 * a host or adapter puts the exchange on a wire only through these functions, so the three shapes
 * cannot drift apart. Decoders run at a trust boundary: each answers `null` for a frame that is not
 * part of this exchange (the same sockets carry other traffic) and throws a `TypeError` for one
 * that claims to be and is malformed.
 *
 * @module
 */

import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { ProblemDetails } from "./problem.ts";
import { problemDetails, PROBLEM_TYPES } from "./problems.ts";
import { isContentHash, READINESS_ORDER } from "./project-state.ts";
import type {
  ContentHash,
  DeleteBase,
  DependencyKind,
  DocKind,
  ProjectEvent,
  ProjectEventType,
  SubscribeRequest,
  SubscribeResponse,
  WireContents,
  WorkingState,
  WriteConflict,
} from "./project-state.ts";

// ─── Contents (§3.2) ───────────────────────────────────────────────────────────────────────────

/** Base64 of `bytes`, standard alphabet with padding. Chunked so a large file never overflows. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CODE_POINTS_PER_CALL = 0x80_00;
  for (let at = 0; at < bytes.length; at += CODE_POINTS_PER_CALL) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + CODE_POINTS_PER_CALL));
  }
  return btoa(binary);
}

/** The bytes a base64 string names. Throws a `TypeError` when it is not base64. */
function fromBase64(data: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new TypeError("Wire contents are not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.codePointAt(at)!;
  }
  return bytes;
}

/** A file's bytes as a JSON frame carries them: text as itself, anything else as base64 (§3.2). */
export function encodeWireContents(contents: string | Uint8Array): WireContents {
  return isText(contents) ? contents : { data: toBase64(contents), encoding: "base64" };
}

/** The contents a {@link WireContents} names: a string for text, bytes for base64. */
export function decodeWireContents(wire: WireContents): string | Uint8Array {
  return isText(wire) ? wire : fromBase64(wire.data);
}

/** Whether contents are text rather than bytes or a base64 envelope. */
function isText<T extends object>(contents: string | T): contents is string {
  return typeof contents === "string";
}

// ─── Validation ────────────────────────────────────────────────────────────────────────────────

/*
 * Every guard below takes `unknown` and answers with a type predicate: they are the trust boundary
 * a frame crosses, so nothing past them reads an unchecked member.
 */

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

function isRevision(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHashOrNull(value: JsonValue | undefined): value is ContentHash | null {
  return value === null || isContentHash(value);
}

function isStringOrNull(value: JsonValue | undefined): value is string | null {
  return value === null || isString(value);
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => isString(item));
}

function isReadiness(value: JsonValue | undefined): value is (typeof READINESS_ORDER)[number] {
  return READINESS_ORDER.some((state) => state === value);
}

function isOrigin(value: JsonValue | undefined): value is "external" | JsonObject {
  return (
    value === "external" ||
    (isRecord(value) && isString(value.writeId) && isHashOrNull(value.writeHash))
  );
}

/*
 * The closed value sets a frame's enumerated members are checked against. Each is a record keyed
 * by the union it mirrors, so adding a member to the union without adding it here fails the build.
 */
const DOC_KINDS: Record<DocKind, true> = {
  component: true,
  content: true,
  data: true,
  layout: true,
  media: true,
  other: true,
  page: true,
  "project-config": true,
  style: true,
};

const DEPENDENCY_KINDS: Record<DependencyKind, true> = {
  "component-instance": true,
  "content-collection": true,
  "data-consumer": true,
  "layout-page": true,
  "media-referrer": true,
  "project-config": true,
};

const WORKING_STATES: Record<WorkingState, true> = {
  added: true,
  deleted: true,
  modified: true,
  renamed: true,
  unmodified: true,
  untracked: true,
};

function isDocKind(value: JsonValue | undefined): value is DocKind {
  return isString(value) && Object.hasOwn(DOC_KINDS, value);
}

function isDependencyKind(value: JsonValue | undefined): value is DependencyKind {
  return isString(value) && Object.hasOwn(DEPENDENCY_KINDS, value);
}

function isWorkingState(value: JsonValue | undefined): value is WorkingState {
  return isString(value) && Object.hasOwn(WORKING_STATES, value);
}

function isDependencyCause(value: JsonValue | undefined): value is JsonObject {
  return isRecord(value) && isString(value.docId) && isDependencyKind(value.kind);
}

function isGitStatus(value: JsonValue | undefined): value is JsonObject {
  return (
    isRecord(value) &&
    isStringOrNull(value.branch) &&
    isStringOrNull(value.head) &&
    isRecord(value.changed) &&
    Object.values(value.changed).every((state) => isWorkingState(state))
  );
}

/** One member an event type requires: the guard its value must pass, and whether it may be absent. */
interface MemberRule {
  check: (value: JsonValue | undefined) => boolean;
  optional?: true;
}

/** The members each event type must carry, beyond `type`, `rev` and `origin` (§4). */
const EVENT_MEMBERS = {
  componentsChanged: { tags: { check: isStringArray } },
  conflict: {
    bufferRev: { check: isRevision, optional: true },
    diskHash: { check: isHashOrNull },
    docId: { check: isStringOrNull },
    path: { check: isString },
    writeId: { check: isString },
  },
  dependentsInvalidated: {
    cause: { check: isDependencyCause },
    complete: { check: isBoolean },
    docIds: { check: isStringArray },
    tags: { check: isStringArray },
  },
  docChanged: {
    docId: { check: isString },
    hash: { check: isContentHash },
    indexed: { check: isBoolean },
    kind: { check: isDocKind },
    path: { check: isString },
  },
  fileAdded: {
    docId: { check: isString },
    hash: { check: isContentHash, optional: true },
    isDir: { check: isBoolean },
    path: { check: isString },
  },
  fileChanged: {
    docId: { check: isString },
    hash: { check: isContentHash },
    path: { check: isString },
  },
  fileRemoved: {
    docId: { check: isString },
    isDir: { check: isBoolean },
    path: { check: isString },
  },
  fileRenamed: {
    docId: { check: isString },
    from: { check: isString },
    isDir: { check: isBoolean },
    to: { check: isString },
  },
  formatsChanged: { formats: { check: isString } },
  gitChanged: { status: { check: isGitStatus } },
  operationApplied: { files: { check: isStringArray }, opId: { check: isString } },
  projectConfigChanged: { hash: { check: isContentHash }, path: { check: isString } },
  readiness: { state: { check: isReadiness } },
  watcherDegraded: { reason: { check: isString } },
} as const satisfies Record<ProjectEventType, Record<string, MemberRule>>;

function isEventType(value: JsonValue | undefined): value is ProjectEventType {
  return isString(value) && Object.hasOwn(EVENT_MEMBERS, value);
}

/**
 * Whether `value` is a well-formed {@link ProjectEvent}: a known type, a positive revision, an
 * origin, and every member its type requires (§4).
 */
export function isProjectEvent(value: JsonValue | undefined): value is JsonObject & ProjectEvent {
  if (!isRecord(value) || !isEventType(value.type)) {
    return false;
  }
  if (!isRevision(value.rev) || value.rev < 1 || !isOrigin(value.origin)) {
    return false;
  }
  return Object.entries<MemberRule>(EVENT_MEMBERS[value.type]).every(([name, member]) =>
    member.optional && value[name] === undefined ? true : member.check(value[name]),
  );
}

/** Whether `value` is a well-formed {@link SubscribeRequest} (§3.1). */
export function isSubscribeRequest(
  value: JsonValue | undefined,
): value is JsonObject & SubscribeRequest {
  return (
    isRecord(value) &&
    (value.clientId === undefined || isString(value.clientId)) &&
    (value.epoch === undefined || isString(value.epoch)) &&
    (value.sinceRev === undefined || isRevision(value.sinceRev))
  );
}

/**
 * Whether a snapshot entry is a well-formed {@link IndexedFile} (§3.1): a path, a DocId, a known
 * kind, whether it is a directory, whether it is indexed, and a hash only on a file.
 */
function isIndexedFile(value: JsonValue | undefined): value is JsonObject {
  return (
    isRecord(value) &&
    isString(value.path) &&
    isString(value.docId) &&
    isDocKind(value.kind) &&
    isBoolean(value.isDir) &&
    isBoolean(value.indexed) &&
    (value.hash === undefined || (!value.isDir && isContentHash(value.hash)))
  );
}

/**
 * Whether `value` is a well-formed {@link SubscribeResponse} (§3.1). A snapshot's files and git
 * summary are checked member by member; the events of an `events` answer are checked one by one.
 */
export function isSubscribeResponse(
  value: JsonValue | undefined,
): value is JsonObject & SubscribeResponse {
  if (!isRecord(value) || !isString(value.epoch) || !isRevision(value.rev)) {
    return false;
  }
  if (value.kind === "events") {
    const { events } = value;
    return Array.isArray(events) && events.every((event) => isProjectEvent(event));
  }
  const { snapshot } = value;
  return (
    value.kind === "snapshot" &&
    isRecord(snapshot) &&
    Array.isArray(snapshot.files) &&
    snapshot.files.every((file) => isIndexedFile(file)) &&
    isReadiness(snapshot.readiness) &&
    (snapshot.git === undefined || isGitStatus(snapshot.git)) &&
    isStringArray(snapshot.components) &&
    isString(snapshot.formats)
  );
}

function parseJson(text: string): JsonValue {
  try {
    /* SAFETY: JSON.parse answers a JSON value or throws; the `any` it is declared with is exactly
       the JSON value space, which every reader below narrows with the guards above. */
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new TypeError("A project state frame must be JSON.");
  }
}

function requireEvents(
  epoch: JsonValue | undefined,
  events: JsonValue | undefined,
): ProjectEventsParams {
  if (!isString(epoch) || !Array.isArray(events)) {
    throw new TypeError("A project events frame needs an epoch and its events.");
  }
  const checked = events.filter((event) => isProjectEvent(event));
  if (checked.length !== events.length) {
    throw new TypeError("A project events frame carries a malformed event.");
  }
  return { epoch, events: checked };
}

function requireResponse(value: JsonValue | undefined): SubscribeResponse {
  if (!isSubscribeResponse(value)) {
    throw new TypeError("A subscribe answer is malformed.");
  }
  return value;
}

function requireRequest(value: JsonValue | undefined): SubscribeRequest {
  if (!isSubscribeRequest(value)) {
    throw new TypeError("A subscribe request is malformed.");
  }
  const { clientId, epoch, sinceRev } = value;
  const request: SubscribeRequest = {};
  if (isString(clientId)) {
    request.clientId = clientId;
  }
  if (isString(epoch)) {
    request.epoch = epoch;
  }
  if (isRevision(sinceRev)) {
    request.sinceRev = sinceRev;
  }
  return request;
}

function requireBatch(events: readonly ProjectEvent[]): void {
  if (events.length === 0) {
    throw new RangeError("A project events frame carries at least one event.");
  }
}

// ─── Gap detection (§3.2) ──────────────────────────────────────────────────────────────────────

/** Later events, as every binding delivers them: the epoch they belong to and one or more events. */
export interface ProjectEventsParams {
  epoch: string;
  events: ProjectEvent[];
}

/**
 * Whether `events` continue from `lastRev` without a gap: the first is `lastRev + 1` and each next
 * one is one more (§3.2). A client that sees `ok: false` subscribes again.
 */
export type Continuity =
  | { ok: true; rev: number }
  | { ok: false; expected: number; received: number };

/** Check that `events` continue from `lastRev` (§3.2). An empty list continues trivially. */
export function checkContinuity(lastRev: number, events: readonly ProjectEvent[]): Continuity {
  let rev = lastRev;
  for (const event of events) {
    if (event.rev !== rev + 1) {
      return { expected: rev + 1, ok: false, received: event.rev };
    }
    ({ rev } = event);
  }
  return { ok: true, rev };
}

/** What a client applies after a subscribe answer or a later frame. */
export type CursorStep =
  | { kind: "snapshot"; response: Extract<SubscribeResponse, { kind: "snapshot" }> }
  | { kind: "events"; events: ProjectEvent[] }
  | { kind: "gap" };

/**
 * A client's position in a host's revision sequence (§3.1, §3.2): what to send on every connect,
 * and whether each frame continues the sequence. A frame from another epoch, or one whose first
 * revision is not the last applied plus one, is a gap; the client then subscribes again with
 * {@link SubscriptionCursor.request}, which still names the last revision it applied.
 */
export interface SubscriptionCursor {
  /** The epoch of the state the client holds; `undefined` before the first answer. */
  readonly epoch: string | undefined;
  /** The last revision the client applied; `undefined` before the first answer. */
  readonly rev: number | undefined;
  /** The request to send on the next connect. */
  request: () => SubscribeRequest;
  /** Take a subscribe answer. An `events` answer that does not continue the cursor is a gap. */
  answer: (response: SubscribeResponse) => CursorStep;
  /** Take a later frame. */
  frame: (params: ProjectEventsParams) => CursorStep;
}

/** A {@link SubscriptionCursor}, optionally naming the client across reconnects (§3.1). */
export function createSubscriptionCursor(clientId?: string): SubscriptionCursor {
  let epoch: string | undefined;
  let rev: number | undefined;
  const advance = (frameEpoch: string, events: ProjectEvent[]): CursorStep => {
    if (frameEpoch !== epoch || rev === undefined) {
      return { kind: "gap" };
    }
    const continuity = checkContinuity(rev, events);
    if (!continuity.ok) {
      return { kind: "gap" };
    }
    ({ rev } = continuity);
    return { events, kind: "events" };
  };
  return {
    get epoch() {
      return epoch;
    },
    get rev() {
      return rev;
    },
    request() {
      const request: SubscribeRequest = {};
      if (clientId !== undefined) {
        request.clientId = clientId;
      }
      if (epoch !== undefined && rev !== undefined) {
        request.epoch = epoch;
        request.sinceRev = rev;
      }
      return request;
    },
    answer(response) {
      if (response.kind === "snapshot") {
        ({ epoch, rev } = response);
        return { kind: "snapshot", response };
      }
      // An answer of events must end at the revision it names; anything else is a gap too.
      const end = response.events.at(-1)?.rev ?? rev;
      return end === response.rev ? advance(response.epoch, response.events) : { kind: "gap" };
    },
    frame(params) {
      return advance(params.epoch, params.events);
    },
  };
}

// ─── Desktop: the window's RPC WebSocket (§3.2, RFC 6455 text frames) ────────────────────────────

/** The request a desktop client sends on every connect. */
export const PROJECT_SUBSCRIBE_METHOD = "projectSubscribe";

/** The push that carries later events on the desktop socket. */
export const PROJECT_EVENTS_METHOD = "projectEvents";

/** The `projectSubscribe` request frame: `{ id, method, params }`. */
export function encodeDesktopSubscribe(id: number, request: SubscribeRequest): string {
  return JSON.stringify({ id, method: PROJECT_SUBSCRIBE_METHOD, params: request });
}

/**
 * The host's reading of a desktop request frame: the request id and the {@link SubscribeRequest}
 * when the frame is a `projectSubscribe`, `null` for any other method.
 */
export function decodeDesktopRequest(
  text: string,
): { id: number; request: SubscribeRequest } | null {
  const frame = parseJson(text);
  if (!isRecord(frame) || frame.method !== PROJECT_SUBSCRIBE_METHOD) {
    return null;
  }
  const { id, params } = frame;
  if (!isRevision(id)) {
    throw new TypeError("A projectSubscribe request needs a numeric id.");
  }
  return { id, request: requireRequest(params ?? {}) };
}

/** The reply to a `projectSubscribe`: `{ id, result }` with the {@link SubscribeResponse}. */
export function encodeDesktopSubscribeReply(id: number, response: SubscribeResponse): string {
  return JSON.stringify({ id, result: response });
}

/**
 * The client's reading of a `projectSubscribe` reply's `result`, once its RPC layer matched the
 * reply to the request by id.
 */
export function decodeDesktopSubscribeReply(result: JsonValue | undefined): SubscribeResponse {
  return requireResponse(result);
}

/**
 * A `projectEvents` push: `{ method, params: { epoch, events } }`. A host may batch any number of
 * events into one push; the client applies them in revision order (§3.2).
 */
export function encodeDesktopEvents(epoch: string, events: readonly ProjectEvent[]): string {
  requireBatch(events);
  return JSON.stringify({ method: PROJECT_EVENTS_METHOD, params: { epoch, events } });
}

/** The client's reading of a desktop push: its events when it is `projectEvents`, else `null`. */
export function decodeDesktopPush(text: string): ProjectEventsParams | null {
  const frame = parseJson(text);
  if (!isRecord(frame) || frame.method !== PROJECT_EVENTS_METHOD) {
    return null;
  }
  const { params } = frame;
  const record = isRecord(params) ? params : {};
  return requireEvents(record.epoch, record.events);
}

// ─── Dev server: Server-Sent Events (§3.2, WHATWG HTML §9.2) ───────────────────────────────────

/** The dev server's project stream, separate from the reload stream of `server.md` §3.1. */
export const PROJECT_EVENTS_PATH = "/__studio/project/events";

/** The `event:` name of the first frame on every connection. */
export const SSE_SUBSCRIBE_EVENT = "subscribe";

/** The `event:` name of every later frame. */
export const SSE_PROJECT_EVENT = "project";

/**
 * The `id:` of a frame: `<epoch>:<rev>`, the last revision the frame carries. A browser sends it
 * back as `Last-Event-ID` on reconnect, which is how an `EventSource` resumes (§3.2). An epoch may
 * not contain a line break or NUL, which the event-stream format cannot carry in an id.
 */
export function formatEventId(epoch: string, rev: number): string {
  if (epoch === "" || /[\n\r\0]/.test(epoch)) {
    throw new RangeError("An epoch must be non-empty and free of line breaks and NUL.");
  }
  if (!isRevision(rev)) {
    throw new RangeError(`A revision must be a non-negative integer, got ${rev}.`);
  }
  return `${epoch}:${rev}`;
}

/**
 * The {@link SubscribeRequest} a `Last-Event-ID` names: `{ epoch, sinceRev }` for `<epoch>:<rev>`,
 * `{}` for an absent, empty or malformed value, which the host answers with a snapshot (§3.1). The
 * epoch is everything before the last colon, so an epoch that contains colons still round-trips.
 */
export function parseLastEventId(value: string | null | undefined): SubscribeRequest {
  if (!value) {
    return {};
  }
  const at = value.lastIndexOf(":");
  const epoch = value.slice(0, at);
  const digits = value.slice(at + 1);
  if (at <= 0 || !/^\d+$/.test(digits)) {
    return {};
  }
  const sinceRev = Number(digits);
  return Number.isSafeInteger(sinceRev) ? { epoch, sinceRev } : {};
}

function sseFrame(
  id: string,
  event: string,
  data: SubscribeResponse | { epoch: string; events: readonly ProjectEvent[] },
): string {
  // JSON.stringify escapes every line break inside a string, so the data is always one line.
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The first frame on every connection: the {@link SubscribeResponse}, `event: subscribe`. */
export function encodeSseSubscribe(response: SubscribeResponse): string {
  return sseFrame(formatEventId(response.epoch, response.rev), SSE_SUBSCRIBE_EVENT, response);
}

/** A later frame, `event: project`, whose id names the last revision it carries. */
export function encodeSseEvents(epoch: string, events: readonly ProjectEvent[]): string {
  requireBatch(events);
  const last = events.at(-1)!;
  return sseFrame(formatEventId(epoch, last.rev), SSE_PROJECT_EVENT, { epoch, events });
}

/** One parsed event-stream block: the fields a client reads. */
export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

/**
 * Parse one event-stream block (the text between blank lines) as WHATWG HTML §9.2.6 does: a line
 * `field: value` loses one leading space from its value, `data` lines join with a line feed, a line
 * starting with a colon is a comment, and the event name defaults to `message`. For a client that
 * reads the stream without an `EventSource` (a test, a non-browser tool).
 */
export function parseSseBlock(block: string): SseMessage {
  const message: SseMessage = { data: "", event: "message" };
  const data: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "data") {
      data.push(value);
    } else if (field === "event") {
      message.event = value;
    } else if (field === "id" && !value.includes("\0")) {
      message.id = value;
    }
  }
  message.data = data.join("\n");
  return message;
}

/**
 * The client's reading of one message on the project stream, by its `event` name and `data`: the
 * subscribe answer, a batch of later events, or `null` for any other event name.
 */
export function decodeSseMessage(
  event: string,
  data: string,
):
  | { kind: "subscribe"; response: SubscribeResponse }
  | ({ kind: "events" } & ProjectEventsParams)
  | null {
  if (event === SSE_SUBSCRIBE_EVENT) {
    return { kind: "subscribe", response: requireResponse(parseJson(data)) };
  }
  if (event === SSE_PROJECT_EVENT) {
    const params = parseJson(data);
    const record = isRecord(params) ? params : {};
    return { kind: "events", ...requireEvents(record.epoch, record.events) };
  }
  return null;
}

// ─── Cloud: the session's /events WebSocket (§3.2, RFC 6455 text frames) ─────────────────────────

/** The client's first message after the socket opens: `{ kind: "subscribe", … }`. */
export function encodeCloudSubscribe(request: SubscribeRequest): string {
  return JSON.stringify({ kind: "subscribe", ...request });
}

/**
 * The host's reading of a client message on `/events`: the {@link SubscribeRequest} for a
 * `subscribe`, `null` for any other message.
 */
export function decodeCloudClientMessage(text: string): SubscribeRequest | null {
  const message = parseJson(text);
  if (!isRecord(message) || message.kind !== "subscribe") {
    return null;
  }
  const { kind: _kind, ...request } = message;
  return requireRequest(request);
}

/**
 * The host's first message: `{ kind: "project-subscribe", response }`. The answer is nested rather
 * than spread because a {@link SubscribeResponse} has a `kind` of its own.
 */
export function encodeCloudSubscribeAnswer(response: SubscribeResponse): string {
  return JSON.stringify({ kind: "project-subscribe", response });
}

/** A later message: `{ kind: "project", epoch, events }`. */
export function encodeCloudEvents(epoch: string, events: readonly ProjectEvent[]): string {
  requireBatch(events);
  return JSON.stringify({ epoch, events, kind: "project" });
}

/**
 * The client's reading of a host message on `/events`: the subscribe answer, a batch of later
 * events, or `null` for the socket's other traffic (`fs` batches, git notices).
 */
export function decodeCloudHostMessage(
  text: string,
):
  | { kind: "subscribe"; response: SubscribeResponse }
  | ({ kind: "events" } & ProjectEventsParams)
  | null {
  const message = parseJson(text);
  if (!isRecord(message)) {
    return null;
  }
  if (message.kind === "project-subscribe") {
    return { kind: "subscribe", response: requireResponse(message.response) };
  }
  if (message.kind === "project") {
    return { kind: "events", ...requireEvents(message.epoch, message.events) };
  }
  return null;
}

// ─── HTTP preconditions (§5, RFC 9110 §13.1) ───────────────────────────────────────────────────

/**
 * A content hash as a strong entity tag (RFC 9110 §8.8.3): the hash, quoted. Every character of the
 * `sha256-<base64>` spelling is a valid `etagc`, so no escaping is needed.
 */
export function entityTag(hash: ContentHash): string {
  return `"${hash}"`;
}

/** The hash a strong entity tag names, or `null` when it is weak, a list, or not a hash. */
function hashOfEntityTag(value: string): ContentHash | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) {
    return null;
  }
  const opaque = trimmed.slice(1, -1);
  return isContentHash(opaque) ? opaque : null;
}

/** The headers a write's base travels as: `If-Match` for a hash, `If-None-Match: *` for `null`. */
export function writePreconditionHeaders(baseHash: ContentHash | null): Record<string, string> {
  return baseHash === null ? { "If-None-Match": "*" } : { "If-Match": entityTag(baseHash) };
}

/** Anything that reads a header by name, case-insensitively: a `Headers`, or a stand-in. */
export interface HeaderReader {
  get: (name: string) => string | null;
}

/**
 * Why a request's precondition could not be read: it carried none (`missing`), or it carried one
 * this contract does not accept (`malformed`): a weak tag, a list, `If-Match: *`, or both headers.
 * A host refuses either before touching the disk, because a write without a base is not accepted
 * once it serves this contract (§5).
 */
export interface PreconditionFailure {
  ok: false;
  reason: "missing" | "malformed";
}

/** Read a write's base from its headers (§5). */
export function parseWritePrecondition(
  headers: HeaderReader,
): { ok: true; baseHash: ContentHash | null } | PreconditionFailure {
  const ifMatch = headers.get("If-Match");
  const ifNoneMatch = headers.get("If-None-Match");
  if (ifMatch !== null && ifNoneMatch !== null) {
    return { ok: false, reason: "malformed" };
  }
  if (ifNoneMatch !== null) {
    return ifNoneMatch.trim() === "*"
      ? { baseHash: null, ok: true }
      : { ok: false, reason: "malformed" };
  }
  if (ifMatch === null) {
    return { ok: false, reason: "missing" };
  }
  const baseHash = hashOfEntityTag(ifMatch);
  return baseHash === null ? { ok: false, reason: "malformed" } : { baseHash, ok: true };
}

/** A delete's base as an HTTP request carries it. */
export interface DeletePrecondition {
  headers: Record<string, string>;
  /** The JSON body that carries a directory's `{ files }`. */
  body?: string;
}

/**
 * How a delete's base travels (§5): a file's hash as `If-Match`, a directory's `{ files }` as a
 * JSON body.
 */
export function deletePrecondition(base: DeleteBase): DeletePrecondition {
  if ("hash" in base) {
    return { headers: { "If-Match": entityTag(base.hash) } };
  }
  return {
    body: JSON.stringify({ files: base.files }),
    headers: { "Content-Type": "application/json" },
  };
}

/** Read a delete's base from its headers and body (§5). */
export function parseDeletePrecondition(
  headers: HeaderReader,
  body: string | null,
): { ok: true; base: DeleteBase } | PreconditionFailure {
  const ifMatch = headers.get("If-Match");
  /* A delete has no create form, so `If-None-Match` in any spelling, alone or beside `If-Match`,
     is a precondition this contract does not accept. */
  if (headers.get("If-None-Match") !== null) {
    return { ok: false, reason: "malformed" };
  }
  if (ifMatch !== null) {
    const hash = hashOfEntityTag(ifMatch);
    return hash === null || body
      ? { ok: false, reason: "malformed" }
      : { base: { hash }, ok: true };
  }
  if (!body) {
    return { ok: false, reason: "missing" };
  }
  let parsed: JsonValue;
  try {
    parsed = parseJson(body);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const listed = isRecord(parsed) ? parsed.files : undefined;
  if (!isRecord(listed)) {
    return { ok: false, reason: "malformed" };
  }
  const files: Record<string, ContentHash> = {};
  for (const [path, hash] of Object.entries(listed)) {
    if (!isContentHash(hash)) {
      return { ok: false, reason: "malformed" };
    }
    files[path] = hash;
  }
  return { base: { files }, ok: true };
}

/** The status a refused write or delete answers with on an HTTP binding (RFC 9110 §15.5.13). */
export const PRECONDITION_FAILED_STATUS = PROBLEM_TYPES.preconditionFailed.status;

/**
 * The problem document a refused write or delete answers with (§5): `412`, carrying what is at the
 * path now as the extension members `path`, `docId` and `diskHash`.
 */
export function preconditionFailedProblem(conflict: WriteConflict): ProblemDetails {
  return problemDetails(
    "preconditionFailed",
    `${conflict.path} is not what the request's base names.`,
    { diskHash: conflict.diskHash, docId: conflict.docId, path: conflict.path },
  );
}

/** The {@link WriteConflict} a `412` problem document carries, or `null` when it carries none. */
export function conflictFromProblem(body: JsonValue | undefined): WriteConflict | null {
  if (!isRecord(body) || body.type !== PROBLEM_TYPES.preconditionFailed.type) {
    return null;
  }
  const { diskHash, docId, path } = body;
  if (!isString(path) || !isStringOrNull(docId) || !isHashOrNull(diskHash)) {
    return null;
  }
  return { diskHash, docId, path };
}
