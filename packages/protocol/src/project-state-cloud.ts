/**
 * The project state contract's cloud binding (`specs/project-state.md` §3.2, §10.3): the session's
 * `/events` WebSocket carries the subscription, and three HTTP routes under the session base carry
 * the capability answer, the writes and deletes that name their base, and the rename.
 *
 * Both halves live here so they cannot drift apart. A client adapter (Studio's Cloud adapter)
 * builds {@link createCloudProjectStateClient} over its session's `fetch` and socket; a host (the
 * cloud's per-project Durable Object) answers the HTTP routes with {@link answerCloudProjectRequest}
 * and the socket with the cloud codecs of `project-state-frames.ts`. Every route below is relative
 * to the session base, `/api/v1/p/:owner/:repo/:branch/studio` (`desktop.md` §10.1).
 *
 * @module
 */

import { isBoolean, isJsonObject } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { problemMessage } from "./problem.ts";
import type { ProblemDetails } from "./problem.ts";
import { problemDetails } from "./problems.ts";
import {
  conflictFromProblem,
  decodeCloudHostMessage,
  decodeRenameOperation,
  deletePrecondition,
  encodeCloudSubscribe,
  encodeRenameOperation,
  entityTag,
  parseDeletePrecondition,
  parseWriteIdentity,
  parseWritePrecondition,
  PRECONDITION_FAILED_STATUS,
  preconditionFailedProblem,
  writeBody,
  writeIdentityHeaders,
  writePreconditionHeaders,
} from "./project-state-frames.ts";
import type {
  ProjectEventsParams,
  ProjectStateClient,
  ProjectStateListener,
} from "./project-state-frames.ts";
import { isContentHash } from "./project-state.ts";
import type {
  DeleteRequest,
  DeleteResult,
  RenameOperation,
  RenameOperationResult,
  SubscribeRequest,
  SubscribeResponse,
  WriteConflict,
  WriteRequest,
  WriteResult,
} from "./project-state.ts";

// ─── Routes (§3.2) ─────────────────────────────────────────────────────────────────────────────

/** The session's event socket: `fs` batches and git notices, and the subscribe exchange beside them. */
export const CLOUD_EVENTS_PATH = "/events";

/**
 * The capability route: `GET` answers a {@link CloudProjectStateInfo} when the session serves the
 * contract. A session that predates it answers `404`, and its client follows no other writer on
 * that session (`studio.md` §9.2).
 */
export const CLOUD_PROJECT_STATE_PATH = "/project-state";

/**
 * A write (`PUT`) or delete (`DELETE`) naming its base, `?path=` the project-relative path: the
 * base travels as `If-Match` (`If-None-Match: *` for a create), the issuer as `Jx-Write-Id` and
 * `Jx-Buffer-Rev`, a write's body is the file's bytes and a directory delete's body its `{ files }`
 * base (§5). The session's older `PUT /file` and `DELETE /file` stay unconditional,
 * last-writer-wins.
 */
export const CLOUD_PROJECT_FILE_PATH = "/project-state/file";

/** A rename as one operation (§9): `POST` a `WireRenameOperation`, answered its result as `200`. */
export const CLOUD_PROJECT_RENAME_PATH = "/project-state/rename";

/** The revision of the cloud binding this module speaks. */
export const CLOUD_PROJECT_STATE_VERSION = 1;

/**
 * What the capability route answers. A session that answers it serves the whole binding: the
 * subscription, the conditional writes and deletes, and the rename.
 */
export interface CloudProjectStateInfo {
  /** The binding's revision, {@link CLOUD_PROJECT_STATE_VERSION}. */
  version: number;
}

/** The capability a route's answer names, or `null` when it names none this module speaks. */
export function parseCloudProjectStateInfo(
  value: JsonValue | undefined,
): CloudProjectStateInfo | null {
  return isJsonObject(value) && value.version === CLOUD_PROJECT_STATE_VERSION
    ? { version: CLOUD_PROJECT_STATE_VERSION }
    : null;
}

// ─── The host's half ───────────────────────────────────────────────────────────────────────────

/** What a host serves through the HTTP routes: §5's writes and deletes, and §9's rename. */
export interface CloudProjectStateService {
  write: (request: WriteRequest) => Promise<WriteResult>;
  delete: (request: DeleteRequest) => Promise<DeleteResult>;
  rename: (operation: RenameOperation) => Promise<RenameOperationResult>;
}

const JSON_REQUEST_HEADERS = { "Content-Type": "application/json" };

function problemResponse(problem: ProblemDetails, headers: Record<string, string> = {}): Response {
  return Response.json(problem, {
    headers: { "Content-Type": "application/problem+json", ...headers },
    status: problem.status,
  });
}

/** What a route answers on success: a reply object, or a rename's result. */
type Reply = JsonObject | RenameOperationResult;

function json(body: Reply, headers: Record<string, string> = {}): Response {
  return Response.json(body, { headers });
}

function refused(conflict: WriteConflict): Response {
  return problemResponse(preconditionFailedProblem(conflict));
}

function notAllowed(allow: string): Response {
  return problemResponse(problemDetails("methodNotAllowed", `Use ${allow}.`), { Allow: allow });
}

/**
 * Whether `path` is a project-relative path as the Studio Backend Protocol spells one (`server.md`
 * §4.1): non-empty, forward slashes, no leading slash, and no empty, `.` or `..` segment.
 */
export function isProjectRelativePath(path: string): boolean {
  return (
    path !== "" &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

const MISSING_IDENTITY = "The request names no write id, or a buffer revision that is not one.";

async function answerWrite(request: Request, path: string, service: CloudProjectStateService) {
  const precondition = parseWritePrecondition(request.headers);
  if (!precondition.ok) {
    return problemResponse(
      problemDetails("invalidRequest", `The write's base is ${precondition.reason}.`),
    );
  }
  const identity = parseWriteIdentity(request.headers);
  if (identity === null) {
    return problemResponse(problemDetails("invalidRequest", MISSING_IDENTITY));
  }
  const contents = new Uint8Array(await request.arrayBuffer());
  const result = await service.write({
    baseHash: precondition.baseHash,
    contents,
    path,
    ...identity,
  });
  if (!result.ok) {
    return refused(result.conflict);
  }
  return json(
    { hash: result.hash, ok: true, path, rev: result.rev },
    { ETag: entityTag(result.hash) },
  );
}

async function answerDelete(request: Request, path: string, service: CloudProjectStateService) {
  const precondition = parseDeletePrecondition(request.headers, await request.text());
  if (!precondition.ok) {
    return problemResponse(
      problemDetails("invalidRequest", `The delete's base is ${precondition.reason}.`),
    );
  }
  const identity = parseWriteIdentity(request.headers);
  if (identity === null) {
    return problemResponse(problemDetails("invalidRequest", MISSING_IDENTITY));
  }
  const result = await service.delete({
    base: precondition.base,
    path,
    writeId: identity.writeId,
  });
  if (!result.ok) {
    return refused(result.conflict);
  }
  return json({ ok: true, path, rev: result.rev });
}

async function answerRename(request: Request, rename: CloudProjectStateService["rename"]) {
  let operation: RenameOperation;
  try {
    // SAFETY: JSON.parse without a reviver yields a JSON value, which the decoder checks.
    operation = decodeRenameOperation(JSON.parse(await request.text()) as JsonValue);
  } catch (error) {
    return problemResponse(problemDetails("invalidRequest", errorMessage(error)));
  }
  const paths = [operation.from, operation.to, ...(operation.rewrites ?? []).map((r) => r.path)];
  if (!paths.every((path) => isProjectRelativePath(path))) {
    return problemResponse(problemDetails("invalidRequest", "A rename names project paths."));
  }
  return json(await rename(operation));
}

/**
 * Answer one of the binding's HTTP routes (§3.2, §5, §9), or `null` when `route` is none of them,
 * so a host routes everything else as before. `route` is the request's path relative to the session
 * base. A malformed request is a `400` problem document, a stale base a `412` one, and a method a
 * route does not take a `405`. The service's own failures propagate to the caller.
 */
export async function answerCloudProjectRequest(
  request: Request,
  route: string,
  service: CloudProjectStateService,
): Promise<Response | null> {
  if (route === CLOUD_PROJECT_STATE_PATH) {
    if (request.method !== "GET") {
      return notAllowed("GET");
    }
    return json({ version: CLOUD_PROJECT_STATE_VERSION });
  }
  if (route === CLOUD_PROJECT_FILE_PATH) {
    const path = new URL(request.url).searchParams.get("path") ?? "";
    if (!isProjectRelativePath(path)) {
      return problemResponse(problemDetails("invalidRequest", "`path` names a project path."));
    }
    if (request.method === "PUT") {
      return answerWrite(request, path, service);
    }
    if (request.method === "DELETE") {
      return answerDelete(request, path, service);
    }
    return notAllowed("PUT, DELETE");
  }
  if (route === CLOUD_PROJECT_RENAME_PATH) {
    return request.method === "POST" ? answerRename(request, service.rename) : notAllowed("POST");
  }
  return null;
}

// ─── The client's half ─────────────────────────────────────────────────────────────────────────

/** One open `/events` socket, as a client adapter hands it over. */
export interface CloudSocket {
  send: (text: string) => void;
  close: () => void;
}

/** What a client hears from its socket: it opened, a text message arrived, it closed. */
export interface CloudSocketHandlers {
  open: () => void;
  message: (text: string) => void;
  close: () => void;
}

/** How a client reaches its session: a request to a route under the base, and a new socket. */
export interface CloudProjectStateTransport {
  /** Request `route` (relative to the session base, query included). */
  fetch: (route: string, init: RequestInit) => Promise<Response>;
  /** Open a new `/events` socket, reporting to `handlers`. */
  connect: (handlers: CloudSocketHandlers) => CloudSocket;
}

/** The project state service over the cloud binding. */
export interface CloudProjectStateClient extends ProjectStateClient {
  rename: NonNullable<ProjectStateClient["rename"]>;
  /**
   * What the session serves: its capability answer, or `null` when it does not serve the contract
   * (the route answers `404` or `405`). Asked once; a request that fails, or that any other status
   * answers, rejects and is asked again next time.
   */
  info: () => Promise<CloudProjectStateInfo | null>;
  /** End the current subscription from the client's side, reporting nothing. */
  close: () => void;
}

/** Wait for a later task, so a caller's continuation of the answer runs before later frames. */
function afterAnswer(): Promise<void> {
  return new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

/** Parse a reply's text, `null` when it is not JSON. */
function parseText(text: string): JsonValue {
  try {
    // SAFETY: JSON.parse without a reviver yields a JSON value, which each reader narrows.
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

async function readBody(res: Response): Promise<JsonValue> {
  return parseText(await res.text());
}

function isRevision(value: JsonValue | undefined): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** A refusal's conflict, or the failure itself as an error naming `what`. */
async function conflictOrThrow(res: Response, what: string): Promise<WriteConflict> {
  const body = await readBody(res);
  const conflict = res.status === PRECONDITION_FAILED_STATUS ? conflictFromProblem(body) : null;
  if (conflict === null) {
    throw new Error(`${what}: ${problemMessage(body ?? "", res.status)}`);
  }
  return conflict;
}

/** The revision a successful reply names, and the hash it names when it names one. */
async function acceptedReply(
  res: Response,
  what: string,
): Promise<{ rev: number; hash: JsonValue | undefined }> {
  const body = await readBody(res);
  const rev = isJsonObject(body) ? body.rev : undefined;
  if (!isJsonObject(body) || !isRevision(rev)) {
    throw new Error(`${what}: the session answered without a revision.`);
  }
  return { hash: body.hash, rev };
}

/** One subscription's socket and whether it is still the client's. */
interface OpenSubscription {
  socket: CloudSocket | null;
  current: boolean;
}

/**
 * A client of the cloud binding over `transport` (§3.2): one subscription at a time, each on a
 * socket of its own, replaced by the next `subscribe`. The first `subscribe` asks the capability
 * route and rejects when the session does not serve the contract, which a client store reads as
 * "not served" (`studio.md` §3.4).
 */
export function createCloudProjectStateClient(
  transport: CloudProjectStateTransport,
): CloudProjectStateClient {
  let asked: Promise<CloudProjectStateInfo | null> | null = null;
  let open: OpenSubscription | null = null;

  const info = (): Promise<CloudProjectStateInfo | null> => {
    asked ??= (async () => {
      const res = await transport.fetch(CLOUD_PROJECT_STATE_PATH, { method: "GET" });
      /* Only a session that has no such route says it does not serve the contract. Any other
         failure (a 5xx while the session hydrates, an expired sign-in) is no answer, so the next
         subscribe asks again rather than going without live updates for the life of the page. */
      if (res.status === 404 || res.status === 405) {
        return null;
      }
      if (!res.ok) {
        throw new Error(
          `The session could not say whether it serves project state (${res.status}).`,
        );
      }
      return parseCloudProjectStateInfo(await readBody(res));
    })().catch((error: Error) => {
      asked = null;
      throw error;
    });
    return asked;
  };

  const end = () => {
    if (open !== null) {
      open.current = false;
      open.socket?.close();
      open = null;
    }
  };

  const subscribe = async (
    request: SubscribeRequest,
    listener: ProjectStateListener,
  ): Promise<SubscribeResponse> => {
    end();
    const mine: OpenSubscription = { current: true, socket: null };
    open = mine;
    const served = await info();
    if (served === null) {
      throw new Error("The session does not serve the project state subscription.");
    }
    if (!mine.current) {
      throw new Error("A later subscribe replaced this one.");
    }
    return new Promise<SubscribeResponse>((answer, refuse) => {
      let epoch: string | null = null;
      let finished = false;
      /** Later frames wait behind the answer, then run one after another (§3.2). */
      let delivered: Promise<void> = Promise.resolve();
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        if (epoch === null) {
          refuse(new Error("The event socket closed before the subscription was answered."));
          return;
        }
        const ended = epoch;
        delivered = delivered.then(() => {
          if (mine.current) {
            mine.current = false;
            if (open === mine) {
              open = null;
            }
            listener.ended?.(ended);
          }
        });
      };
      const deliver = (params: ProjectEventsParams) => {
        delivered = delivered.then(() => {
          if (mine.current) {
            listener.events(params);
          }
        });
      };
      mine.socket = transport.connect({
        close: finish,
        message(text) {
          if (finished) {
            return;
          }
          let message: ReturnType<typeof decodeCloudHostMessage>;
          try {
            message = decodeCloudHostMessage(text);
          } catch (error) {
            // A frame that claims to be part of the exchange and is malformed ends it.
            console.warn("[project-state] a malformed frame ended the subscription:", error);
            mine.socket?.close();
            finish();
            return;
          }
          if (message === null) {
            return;
          }
          if (message.kind === "subscribe") {
            if (epoch === null) {
              ({ epoch } = message.response);
              answer(message.response);
              delivered = afterAnswer();
            }
            return;
          }
          // Nothing of the exchange precedes its answer (§3.2); a stray frame is no part of it.
          if (epoch === null) {
            return;
          }
          if (message.kind === "events") {
            deliver({ epoch: message.epoch, events: message.events });
            return;
          }
          // The host ended the subscription; the socket stays open for its other traffic.
          mine.socket?.close();
          finish();
        },
        open() {
          mine.socket?.send(encodeCloudSubscribe(request));
        },
      });
    });
  };

  const fileRoute = (path: string) => `${CLOUD_PROJECT_FILE_PATH}?path=${encodeURIComponent(path)}`;

  return {
    close: end,
    async delete(remove) {
      const precondition = deletePrecondition(remove.base);
      const res = await transport.fetch(fileRoute(remove.path), {
        ...(precondition.body !== undefined && { body: precondition.body }),
        headers: { ...precondition.headers, ...writeIdentityHeaders(remove) },
        method: "DELETE",
      });
      if (!res.ok) {
        return {
          conflict: await conflictOrThrow(res, `Failed to delete ${remove.path}`),
          ok: false,
        };
      }
      const { rev } = await acceptedReply(res, `Failed to delete ${remove.path}`);
      return { ok: true, rev };
    },
    info,
    async rename(operation) {
      const res = await transport.fetch(CLOUD_PROJECT_RENAME_PATH, {
        body: JSON.stringify(encodeRenameOperation(operation)),
        headers: JSON_REQUEST_HEADERS,
        method: "POST",
      });
      const text = await res.text();
      const body = parseText(text);
      if (!res.ok || !isJsonObject(body) || !isBoolean(body.ok)) {
        throw new Error(
          `Failed to rename ${operation.from} → ${operation.to}: ${problemMessage(body ?? "", res.status)}`,
        );
      }
      /* SAFETY: the host answers its RenameOperationResult as JSON (`answerCloudProjectRequest`),
         every member of which is JSON, and its discriminant was checked just above. */
      return JSON.parse(text) as RenameOperationResult;
    },
    subscribe,
    async write(write) {
      const res = await transport.fetch(fileRoute(write.path), {
        body: writeBody(write.contents),
        headers: { ...writePreconditionHeaders(write.baseHash), ...writeIdentityHeaders(write) },
        method: "PUT",
      });
      if (!res.ok) {
        return { conflict: await conflictOrThrow(res, `Failed to write ${write.path}`), ok: false };
      }
      const { hash, rev } = await acceptedReply(res, `Failed to write ${write.path}`);
      if (!isContentHash(hash)) {
        throw new Error(`Failed to write ${write.path}: the session answered without a hash.`);
      }
      return { hash, ok: true, rev };
    },
  };
}
