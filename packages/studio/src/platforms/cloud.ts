/// <reference lib="dom" />
/**
 * Cloud platform adapter (PAL) — implements StudioPlatform against a cloud backend speaking the
 * Studio Backend Protocol behind a session gateway: file/git operations go to
 * `/api/v1/p/:owner/:repo/:branch/studio/*` (cookie auth), AI to the backend's proxy at
 * `/api/v1/ai/chat`. The session is pre-bound to one (repo, branch) — the shell picks the project
 * before Studio boots — while project-less mode (null) powers the /studio welcome screen.
 *
 * Cloud omissions (Studio degrades per @jxsuite/protocol's route table): pickDirectory, package
 * install and the install-on-open check (a cloud session has no `node_modules`; add, remove and
 * set-versions update `package.json` and `package-lock.json` through the session's package
 * service), multi-window, gitClone, resolveClass, component discovery, code services.
 */

import { negotiateCollab } from "@jxsuite/collab/negotiate";
import type { CollabNegotiation } from "@jxsuite/collab/negotiate";
// Static, and free to be: `reconnect.ts` imports nothing, so no Yjs reaches the initial bundle.
import { createReconnectScheduler } from "@jxsuite/collab/reconnect";
import type { WsCollabConnection } from "@jxsuite/collab/client";
import { isBoolean, isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import { streamImport } from "../services/import-client";
import type {
  AccountEntry,
  AccountNotice,
  AccountStatus,
  ActionOutcome,
  CfAccountSummary,
  CfConnection,
  CfConnectOutcome,
  ComponentMeta,
  CreateProjectDestination,
  DirEntry,
  ExtensionCatalogEntry,
  ExtensionsInfo,
  FsEvent,
  FsResyncReason,
  GitBranchesResult,
  GitCommitBranchResult,
  GitLogEntry,
  GitStatusResult,
  ImportProgressEvent,
  ImportReadyEvent,
  ImportSiteOptions,
  OfferedAction,
  PackageInfo,
  PackageOpResult,
  PackageVersionInfo,
  ProjectListEntry,
  SiteBuildResult,
  ProjectSchemasResponse,
  ReferencesResult,
  RenameResult,
  RepoInfo,
  RepoProjects,
  StarterInfo,
  StudioPlatform,
} from "../types";
import { problemDetail, problemSlug } from "@jxsuite/protocol";
import type { ReadFilesRequest, ReadFilesResult, UploadResult } from "@jxsuite/protocol";
import { reportActionRequired } from "../account/action-required";
import type { ActionRequiredReport } from "../account/action-required";
import { offeredActions, retryHint } from "../platform-errors";
import type { PlatformErrorInfo } from "../platform-errors";
import { createReadBatcher } from "./read-batcher";
import { normalizeProjectDir } from "../utils/project-dir";
import type { BatchAnswer } from "./read-batcher";

// Re-exported for the cloud shell and its tests, which spell folders through this entry.
export { normalizeProjectDir } from "../utils/project-dir";

export interface CloudProject {
  owner: string;
  repo: string;
  branch: string;
  /**
   * The folder holding the project's `project.json`, relative to the repository root and already
   * normalized ({@link normalizeProjectDir}); absent or `""` when the project IS the repository.
   */
  dir?: string;
}

interface ProjectInfoWire {
  root: string;
  name: string;
  defaultBranch: string;
  permission: "admin" | "write" | "read" | "none";
  projectConfig: ProjectConfig | null;
}

/** One row of the platform's project catalogue (`GET /api/v1/projects`). */
interface ProjectListWire {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  permission: string;
}

/**
 * True when a `POST /files/read` body is the route answering: a JSON object whose `files` is an
 * array. Only that much is checked here, because the batcher checks every row, and `omitted`,
 * before it trusts any of them (read-batcher.ts `settleAnswer`).
 */
function isReadFilesAnswer(body: JsonValue): body is JsonObject & ReadFilesResult {
  return isJsonObject(body) && Array.isArray(body["files"]);
}

/** The options object {@link StudioPlatform.formatAction} hands through to `POST /format`. */
type FormatActionPayload = Parameters<NonNullable<StudioPlatform["formatAction"]>>[0];

/**
 * A Cloudflare proxy reply (`/api/v1/cf/proxy` here, `/__studio/cf/proxy` on the dev server):
 * Cloudflare's v4 envelope, or the proxy's own `error`.
 */
export interface CfProxyEnvelope extends JsonObject {
  success?: boolean;
  result?: JsonValue;
  errors?: { message: string }[];
  error?: string;
}

/** Where a session file sits in its project, as `resolveSiteContext` reports it. */
interface SiteContext {
  sitePath: string | null;
  projectConfig?: ProjectConfig;
  fileRelPath?: string;
}

/** The signed-in GitHub user, as `getUser` reports them. */
interface SignedInUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

/** Body of `POST /api/v1/projects/import`: the repository, and the project folder when not its root. */
interface ImportProjectRequest {
  owner: string;
  name: string;
  dir?: string;
}

/**
 * A manifest's `dependencies` or `devDependencies` block, `{}` when absent. The object itself, not
 * a copy, so `addPackage` can write into it.
 */
function dependencyBlock(
  pkg: JsonObject,
  key: "dependencies" | "devDependencies",
): Record<string, string> {
  /* SAFETY: npm's package.json format defines both blocks as an object of package name → version
     range string, and every member here that writes one (`addPackage`, `removePackage`) keeps it
     that way. */
  return (pkg[key] ?? {}) as Record<string, string>;
}

interface SessionEventWire {
  kind: "fs" | "git";
  events?: FsEvent[];
  event?: string;
  sha?: string;
}

/**
 * Message-level failure body every platform route uses.
 *
 * `error` is the pre-RFC-9457 name and is read through `problemDetail`, which also reads a problem
 * document's `detail` — so this one reader covers a backend that has migrated and one that has
 * not.
 */
interface ErrorBody {
  error?: string;
  code?: string;
}

/** Parse a fetch Response body as JSON, asserting the expected shape at the boundary. */
async function readJson<T>(res: Response): Promise<T> {
  /* SAFETY: every response read here comes from a Studio Backend Protocol session route or one of
     the platform's own `/api/v1/*` routes, whose bodies have the shapes @jxsuite/protocol, ../types
     and the wire interfaces in this file describe; each caller names the type of the route it
     called, and a JSON parse always yields a JsonValue. */
  return (await res.json()) as T;
}

/** Parse JSON text a session read returned; JSON.parse only ever produces JSON values. */
function parseJson(text: string): JsonValue {
  // SAFETY: JSON.parse returns exactly the JSON value the text encodes, or throws.
  return JSON.parse(text) as JsonValue;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    return problemDetail(await readJson<JsonValue>(res)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * True when a 403 is the "write access required" refusal a read-only session gets — whether the
 * backend still sends the legacy `{code: "read_only"}` body or a problem document whose type slug
 * says the same. Any other 403 (an expired grant, a revoked share) is not that verdict.
 */
async function isReadOnlyRefusal(res: Response): Promise<boolean> {
  let body: StructuredBody | null;
  try {
    body = await readJson<StructuredBody | null>(res);
  } catch {
    return false;
  }
  const code = problemSlug(body?.type) ?? body?.code;
  return code === "read_only" || code === "read-only";
}

/** A failure body's machine-readable members, each one optional and none of them trusted. */
interface StructuredBody extends ErrorBody {
  type?: JsonValue;
  installUrl?: JsonValue;
  actions?: JsonValue;
  heading?: JsonValue;
  retry?: JsonValue;
  conflicts?: JsonValue;
}

/** What {@link platformError} carries on the Error it returns: the HTTP status, plus what it found. */
interface PlatformErrorDetails extends PlatformErrorInfo {
  status: number;
}

/** The refusal's heading, when the body carries a usable one. */
function headingOf(body: StructuredBody | null): string | undefined {
  const heading = body?.heading;
  return isString(heading) && heading ? heading : undefined;
}

/**
 * The error a failed response becomes: the backend's sentence as the message, and every member a
 * surface can act on carried alongside it for `platform-errors.ts` to recover — the install link a
 * missing App installation sends, and the actions, heading and retry hint an `action-required`
 * refusal sends (desktop.md §10.4).
 *
 * This used to be the message alone, everywhere but `createProject`, which had grown its own copy
 * of this function to keep the install link. So a refusal reaching any other member arrived as flat
 * text: the members that say "this is fixable, and here is how" were read and dropped.
 */
async function platformError(res: Response, fallback: string): Promise<Error> {
  let body: StructuredBody | null;
  try {
    body = await readJson<StructuredBody | null>(res);
  } catch {
    body = null;
  }
  const code = problemSlug(body?.type) ?? body?.code;
  const actions = offeredActions(body?.actions);
  const heading = headingOf(body);
  const retry = retryHint(body?.retry);
  const installUrl = body?.installUrl;
  const details: PlatformErrorDetails = { status: res.status };
  if (code) {
    details.code = code;
  }
  if (isString(installUrl)) {
    details.installUrl = installUrl;
  }
  if (actions.length > 0) {
    details.actions = actions;
  }
  if (heading !== undefined) {
    details.heading = heading;
  }
  if (retry !== undefined) {
    details.retry = retry;
  }
  const conflicts = body?.conflicts;
  if (Array.isArray(conflicts)) {
    details.conflicts = conflicts.filter((path) => isString(path));
  }
  return Object.assign(new Error(problemDetail(body) ?? fallback), details);
}

async function okJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    throw await platformError(res, fallback);
  }
  return readJson<T>(res);
}

/** Whether a failure body is an `action-required` refusal, by problem type or legacy code. */
function isActionRequiredBody(body: StructuredBody | null): boolean {
  const code = problemSlug(body?.type) ?? body?.code;
  return code === "action-required" || code === "action_required";
}

/**
 * Raise an `action-required` refusal on the channel, read from a CLONE so the caller still gets the
 * body it is about to parse for its own error. Only a refusal that offers something is raised: with
 * no actions there is nothing to offer, and the caller's own error says the rest. Every other 403 —
 * a read-only collaborator, a missing installation — is the caller's alone.
 */
async function reportRefusal(res: Response): Promise<void> {
  let body: StructuredBody | null;
  try {
    body = await readJson<StructuredBody | null>(res);
  } catch {
    return;
  }
  if (!isActionRequiredBody(body)) {
    return;
  }
  const actions = offeredActions(body?.actions);
  if (actions.length === 0) {
    return;
  }
  const detail = problemDetail(body);
  const heading = headingOf(body);
  const retry = retryHint(body?.retry);
  const report: ActionRequiredReport = { actions };
  if (detail !== null) {
    report.detail = detail;
  }
  if (heading !== undefined) {
    report.heading = heading;
  }
  if (retry !== undefined) {
    report.retry = retry;
  }
  reportActionRequired(report);
}

/**
 * The revision a session reads: the branch, then `:` and the project folder when there is one.
 *
 * Git's own `<rev>:<path>` notation, and unambiguous for the reason git can use it: `:` is one of
 * the characters a ref name may never contain (git-check-ref-format), so the FIRST colon always
 * ends the branch, however many slashes the branch or the folder holds.
 */
export function revisionSpec(project: CloudProject): string {
  return project.dir ? `${project.branch}:${project.dir}` : project.branch;
}

/** Split a {@link revisionSpec} back into its branch and folder; null when either half is unusable. */
function parseRevisionSpec(spec: string): { branch: string; dir?: string } | null {
  const colon = spec.indexOf(":");
  const branch = colon === -1 ? spec : spec.slice(0, colon);
  const dir = colon === -1 ? "" : normalizeProjectDir(spec.slice(colon + 1));
  if (!branch || dir === null) {
    return null;
  }
  return dir ? { branch, dir } : { branch };
}

/**
 * Editor URL for a project session (mirrors the shell's route):
 * `/edit/<owner>/<repo>@<branch>[:<folder>]`. The branch is one encoded component, so its slashes
 * travel as `%2F`; the folder keeps its slashes, so a subfolder project's address reads as the path
 * it is.
 */
export function editUrl(project: CloudProject): string {
  const folder = project.dir
    ? `:${project.dir
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`
    : "";
  return `/edit/${project.owner}/${project.repo}@${encodeURIComponent(project.branch)}${folder}`;
}

/** Parse an /edit/:owner/:repo@:branch[:dir] path (editUrl's inverse); null when it is not one. */
export function parseEditPath(pathname: string): CloudProject | null {
  /* Asset routers may normalize "@" to "%40", so decode the whole path first
     (branch slashes survive: `.+` spans them). */
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = /^\/edit\/([^/]+)\/([^/@]+)@(.+)$/.exec(decoded);
  if (!match) {
    return null;
  }
  const [, owner, repo, spec] = match;
  const revision = spec ? parseRevisionSpec(spec) : null;
  if (!owner || !repo || !revision) {
    return null;
  }
  return { owner, repo, ...revision };
}

/**
 * Gateway base path for a project session. The revision spec — branch and folder — is ONE encoded
 * segment, so the gateway's route shape is the same for a subfolder project as for a repository,
 * and the folder's slashes cannot be mistaken for the session's own sub-path.
 */
export function sessionBase(project: CloudProject): string {
  const { owner, repo } = project;
  return `/api/v1/p/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(revisionSpec(project))}/studio`;
}

/** Catalogue/recents root key for a project: "owner/repo@branch", plus ":dir" for a subfolder. */
export function projectRootKey(project: CloudProject): string {
  return `${project.owner}/${project.repo}@${revisionSpec(project)}`;
}

/** `GET /api/v1/cf/connection`: the broker's row, with every diagnostic it may send. */
interface CfConnectionWire {
  connected: boolean;
  accountId?: string | null;
  accountName?: string | null;
  needsReconnect?: boolean;
  needsAccount?: boolean;
  code?: CfConnection["code"];
  reason?: string;
  hasRefreshToken?: boolean;
  expiresAt?: number;
}

/**
 * A same-origin window relay (`{source, status, reason?}`) that a broker or action window posts
 * back. Only `source` is checked; `status` and `reason` are read as the relay protocol sends them.
 */
interface WindowRelay {
  source?: string;
  status?: string;
  reason?: string | null;
}

/** True when a `message` event carries a relay from `source` (`"jx-cf"`, `"jx-action"`). */
function isRelayEvent(event: MessageEvent, source: string): event is MessageEvent<WindowRelay> {
  return isNonNullObject(event.data) && "source" in event.data && event.data.source === source;
}

/**
 * Current hosted Cloudflare connection; null when none is brokered yet.
 *
 * A LAPSED row is not a healthy one. This reader used to answer `{connected: true}` for any body
 * whose `connected` flag was set and drop `needsReconnect` on the floor, so a row whose grant had
 * expired came back indistinguishable from one that works — which is how `cfConnect`'s poll came to
 * close the popup the moment it opened, over a row from a previous session, while the user was
 * still on Cloudflare's login page. Every diagnostic the broker sends now passes straight through.
 */
async function fetchCfConnection(): Promise<CfConnection | null> {
  const res = await fetch("/api/v1/cf/connection", { credentials: "include" });
  if (!res.ok) {
    return null;
  }
  const body = await readJson<CfConnectionWire>(res);
  /* Cloud never emits {connected: false} to the PAL — no brokered row at all is `null`, and a row
     that cannot be used arrives as connected + needsReconnect. See CfConnection. */
  if (!body.connected) {
    return null;
  }
  const connection: CfConnection = { connected: true };
  if (body.accountId) {
    connection.accountId = body.accountId;
  }
  if (body.accountName) {
    connection.accountName = body.accountName;
  }
  if (body.needsReconnect) {
    connection.needsReconnect = true;
  }
  if (body.needsAccount) {
    connection.needsAccount = true;
  }
  if (body.code) {
    connection.code = body.code;
  }
  if (body.reason) {
    connection.reason = body.reason;
  }
  if (body.hasRefreshToken !== undefined) {
    connection.hasRefreshToken = body.hasRefreshToken;
  }
  if (body.expiresAt !== undefined) {
    connection.expiresAt = body.expiresAt;
  }
  return connection;
}

interface CfConnectFlow {
  popup: Window | null;
  promise: Promise<CfConnectOutcome | null>;
}

/**
 * The connect flow currently running, or null.
 *
 * Module-level rather than per-platform because the popup's TARGET NAME ("cf-connect") is global to
 * the browsing context: a second `window.open` on that name re-uses the first flow's popup, and the
 * first flow's cleanup then closes it out from under the second — the user watches their half-typed
 * Cloudflare login vanish. Joining the in-flight promise is the only answer that leaves both
 * callers correct.
 */
let cfConnectFlow: CfConnectFlow | null = null;

/**
 * Drive one hosted OAuth connect to a {@link CfConnectOutcome}. See `cfConnect` for the semantics;
 * this lives at module scope so the single-flight handle can too.
 */
async function runCfConnect(
  handle: CfConnectFlow,
  connectUrl: string,
): Promise<CfConnectOutcome | null> {
  /* The baseline is read BEFORE the popup opens, and it is what keeps the poll honest: a row that
     was already healthy proves nothing about THIS flow, so the poll must not settle on one. Reading
     it after the popup opened would race the callback and could capture the new row as "old". */
  const baseline = await fetchCfConnection().catch(() => null);
  const healthyBaseline = Boolean(baseline?.connected && !baseline.needsReconnect);
  const popup = window.open(connectUrl, "cf-connect", "width=980,height=780");
  if (!popup) {
    /* Popup blocked: the whole page is now navigating to the broker. Not a failure — the caller
       must render nothing at all rather than an error it will never get to show. */
    location.assign(connectUrl);
    return { status: "redirect" };
  }
  handle.popup = popup;
  const deadline = Date.now() + 180_000;
  return new Promise<CfConnectOutcome>((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      if (!popup.closed) {
        popup.close();
      }
    };
    const settle = (outcome: CfConnectOutcome) => {
      cleanup();
      resolve(outcome);
    };
    const fail = (reason: string) => {
      cleanup();
      reject(new Error(reason));
    };
    /** A usable row: brokered, and its grant has not lapsed. */
    const usable = (connection: CfConnection | null): connection is CfConnection =>
      Boolean(connection?.connected && !connection.needsReconnect);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) {
        return;
      }
      if (!isRelayEvent(event, "jx-cf")) {
        return;
      }
      const { data } = event;
      if (data.status === "error") {
        fail(data.reason ?? "Cloudflare authorization failed");
        return;
      }
      /* Any other status — "connected", "pick-account", or one a shell of another vintage sends —
         is a CLAIM that the callback ran, and the broker row is what adjudicates it. */
      void fetchCfConnection().then(
        (connection) => {
          settle(usable(connection) ? { connection, status: "connected" } : { status: "timeout" });
        },
        /* This promise had no rejection handler, so one network blip left the listener installed,
           the timer armed and the popup open forever. */
        () => {
          fail("Cloudflare connected, but the connection could not be confirmed");
        },
      );
    };
    window.addEventListener("message", onMessage);
    const poll = async () => {
      if (Date.now() > deadline) {
        settle({ status: "timeout" });
        return;
      }
      let connection: CfConnection | null = null;
      let answered = true;
      try {
        connection = await fetchCfConnection();
      } catch {
        answered = false; // A blip is not an answer: re-arm and ask again.
      }
      /* The poll is a FALLBACK for shells whose postMessage never arrives, so it may only settle on
         proof that THIS flow stored a fresh token: a usable row that was NOT already usable at the
         baseline. For a reconnect, `needsReconnect` flipping false is that proof; for a connection
         that was healthy all along nothing the poll can see is, so it must never settle — the relay
         or the popup-closed path answers that case instead. */
      if (answered && usable(connection) && !healthyBaseline) {
        settle({ connection, status: "connected" });
        return;
      }
      if (popup.closed) {
        const final = await fetchCfConnection().catch(() => null);
        settle(usable(final) ? { connection: final, status: "connected" } : { status: "canceled" });
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, 1500);
    };
    timer = window.setTimeout(() => {
      void poll();
    }, 1500);
  });
}

// ─── Backend-directed access (desktop.md §10.4) ──────────────────────────────

/** `GET /api/v1/me`, as far as this adapter reads it. */
interface MeWire {
  installations?: { id: number; account: string | null; manageUrl?: string }[];
  appInstallUrl?: string;
  entries?: JsonValue;
  notices?: JsonValue;
}

/** A wire value as a non-empty string, or undefined. */
function wireText(value: JsonValue | undefined): string | undefined {
  return isString(value) && value ? value : undefined;
}

/**
 * The account rows a `/me` body holds, each one checked. A row needs an id, a label and a detail to
 * be drawn at all; a malformed one is dropped rather than drawn half-empty.
 */
function accountEntries(value: JsonValue | undefined): AccountEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw): AccountEntry[] => {
    // A row that is not an object has no id, label or detail to draw.
    if (!isJsonObject(raw)) {
      return [];
    }
    const id = wireText(raw["id"]);
    const label = wireText(raw["label"]);
    const detail = wireText(raw["detail"]);
    if (!id || !label || !detail) {
      return [];
    }
    const actions = offeredActions(raw["actions"]);
    const { connected } = raw;
    const entry: AccountEntry = { detail, id, label };
    if (isBoolean(connected)) {
      entry.connected = connected;
    }
    if (actions.length > 0) {
      entry.actions = actions;
    }
    return [entry];
  });
}

/** The notices a `/me` body holds, each one checked, on the same terms as the rows. */
function accountNotices(value: JsonValue | undefined): AccountNotice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw): AccountNotice[] => {
    // A notice that is not an object has no id, title or message to show.
    if (!isJsonObject(raw)) {
      return [];
    }
    const id = wireText(raw["id"]);
    const title = wireText(raw["title"]);
    const message = wireText(raw["message"]);
    if (!id || !title || !message) {
      return [];
    }
    const actions = offeredActions(raw["actions"]);
    const { display, level } = raw;
    const notice: AccountNotice = { id, message, title };
    if (level === "info" || level === "warning") {
      notice.level = level;
    }
    if (display === "banner" || display === "toast") {
      notice.display = display;
    }
    if (actions.length > 0) {
      notice.actions = actions;
    }
    return [notice];
  });
}

interface ActionFlow {
  popup: Window | null;
  promise: Promise<ActionOutcome | null>;
}

/**
 * The action window currently open, or null — module-level for `cfConnectFlow`'s reason: the
 * window's target name is global to the browsing context, and two flows would share one window.
 */
let actionFlow: ActionFlow | null = null;

/** How long an open action window is waited on before the flow gives up on hearing back. */
const ACTION_DEADLINE_MS = 15 * 60_000;

/**
 * How long a closed window is given for its relay to land. A page that relays and then closes
 * itself can be seen closed a moment before its message is delivered, and reading that as "closed
 * without saying" would put an offer back in front of someone who just completed it.
 */
const CLOSE_GRACE_MS = 300;

/**
 * Wait on an action window the caller has ALREADY opened (opening it is the caller's, because only
 * code still inside the click may). Settles on the window's own relay — `{source: "jx-action",
 * status}`, same-origin, which is the platform's to send from wherever the action ends — or
 * `unknown` when the window closes, or the deadline passes, without one.
 */
function awaitAction(popup: Window): Promise<ActionOutcome> {
  const deadline = Date.now() + ACTION_DEADLINE_MS;
  return new Promise<ActionOutcome>((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      if (!popup.closed) {
        popup.close();
      }
    };
    const settle = (outcome: ActionOutcome) => {
      cleanup();
      resolve(outcome);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) {
        return;
      }
      if (!isRelayEvent(event, "jx-action")) {
        return;
      }
      const { data } = event;
      if (data.status === "done" || data.status === "canceled") {
        settle({ status: data.status });
      } else if (data.status === "error") {
        cleanup();
        reject(new Error(data.reason ?? "The action could not be completed"));
      }
    };
    window.addEventListener("message", onMessage);
    const watch = () => {
      if (Date.now() > deadline) {
        settle({ status: "unknown" });
        return;
      }
      if (popup.closed) {
        timer = window.setTimeout(() => {
          settle({ status: "unknown" });
        }, CLOSE_GRACE_MS);
        return;
      }
      timer = window.setTimeout(watch, 1000);
    };
    timer = window.setTimeout(watch, 1000);
  });
}

/** Parse an "owner/repo@branch[:dir]" root key; null when malformed. */
export function parseRootKey(root: string): CloudProject | null {
  const match = /^([^/@]+)\/([^/@]+)@(.+)$/.exec(root);
  if (!match) {
    return null;
  }
  const [, owner, repo, spec] = match;
  const revision = spec ? parseRevisionSpec(spec) : null;
  if (!owner || !repo || !revision) {
    return null;
  }
  return { owner, repo, ...revision };
}

/** Every project this account can open, straight off the wire; [] when the catalogue is unreachable. */
async function fetchProjects(): Promise<ProjectListWire[]> {
  const res = await fetch("/api/v1/projects", { credentials: "include" });
  return res.ok ? readJson<ProjectListWire[]>(res) : [];
}

/**
 * The project a root key names, for the two members that navigate by one.
 *
 * Tolerates the branchless "owner/repo" keys older studios wrote into Recent: they cannot say which
 * branch they meant, so the catalogue's default branch answers for them — the same branch that
 * project's Projects row opens. Null when the key is neither form, or names nothing this account
 * can reach.
 */
export async function resolveRootKey(rootKey: string): Promise<CloudProject | null> {
  const parsed = parseRootKey(rootKey);
  if (parsed) {
    return parsed;
  }
  const legacy = /^([^/@]+)\/([^/@]+)$/.exec(rootKey);
  if (!legacy) {
    return null;
  }
  const [, owner, repo] = legacy;
  const catalogue = await fetchProjects().catch(() => []);
  const match = catalogue.find((p) => p.owner === owner && p.name === repo);
  return match ? { owner: match.owner, repo: match.name, branch: match.defaultBranch } : null;
}

/**
 * Bound mode (project non-null) drives one repo+branch session; project-less mode (null, the
 * /studio route) exposes only the catalogue surface — listProjects/listStarters/createProject and
 * the navigation members — so Studio's own welcome screen and New Project modal do the rest.
 */
export function createCloudPlatform(project: CloudProject | null): StudioPlatform {
  const base = project ? sessionBase(project) : "";
  /* The ROOT KEY, branch included — not a bare "owner/repo". This value is the project's identity
     everywhere the shell keeps one: `probeRootProject` hands it to the recent-projects list, and
     `setWindowProject` reopens a project by parsing it back with `parseRootKey`, which answers null
     for a branchless key. So every Recent row a bound session had written was a click that did
     nothing — no navigation, no error, and `deduped: true` telling the caller the open had been
     handled — while the SAME project opened fine from the Projects catalogue, whose entries carry
     the branch (`listProjects` below builds them with `projectRootKey`). Agreeing with the catalogue
     also restores the welcome screen's dedupe (it matches the two lists by root, so the project
     stopped appearing in both) and gives a branch its own Recent row, which is what a root key that
     names a branch is for. */
  const root = project ? projectRootKey(project) : "";
  /**
   * One multiplexed collab socket per session; per-doc handles come from openDoc. Memoized as a
   * promise so concurrent first opens share the connection instead of racing two sockets.
   */
  let collabConnection: Promise<WsCollabConnection> | null = null;
  /** Lazy subprotocol negotiation from the gateway's capability probe (null = not asked yet). */
  let collabNegotiation: Promise<CollabNegotiation> | null = null;

  /**
   * Every session request, and the one place an `action-required` refusal is noticed.
   *
   * A refusal is reported on the channel and then returned like any other failure, so the caller
   * still throws its own error with its own wording. The channel is what tells the user what they
   * can do; the caller's error is what tells it the request failed. Neither has to know about the
   * other, which is what lets a directory listing deep in the file tree stay ignorant of access
   * rules.
   */
  async function api(path: string, init?: RequestInit): Promise<Response> {
    if (!project) {
      throw new Error("No project is open in this session");
    }
    const res = await fetch(`${base}${path}`, { credentials: "include", ...init });
    if (res.status === 403) {
      await reportRefusal(res.clone());
    }
    return res;
  }

  /**
   * The bound project as the hint the platform's unscoped routes read (`owner/repo`), or null in
   * the hub. The AI and Cloudflare routes are not under the session base, so this is the only way
   * they learn which project a call is for — which is what a backend whose access rules depend on
   * the repository needs to know. A hint, not a credential: the platform verifies it against the
   * user's own access before it counts.
   */
  const projectHint = project ? `${project.owner}/${project.repo}` : null;

  function postJson(path: string, body: JsonValue | FormatActionPayload): Promise<Response> {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function projectInfo(): Promise<ProjectInfoWire> {
    return okJson<ProjectInfoWire>(await api("/project-info"), "Failed to load project");
  }

  /* The repository's default branch, asked once per session: it is what Send for review must never
     commit to here, because a commit on this host lands on GitHub as it is made. A failed ask is
     forgotten, so the next branch listing asks again. */
  let defaultBranch: Promise<string> | null = null;
  function repositoryDefaultBranch(): Promise<string> {
    defaultBranch ??= projectInfo().then(
      (info) => info.defaultBranch || "",
      () => {
        defaultBranch = null;
        return "";
      },
    );
    return defaultBranch;
  }

  /** One file the old way: `GET /file`. What a single read, and the batch fallback, goes through. */
  async function readOne(path: string): Promise<string> {
    const data = await okJson<{ content: string }>(
      await api(`/file?path=${encodeURIComponent(path)}`),
      `Failed to read file: ${path}`,
    );
    return data.content;
  }

  /**
   * Every text read in this session goes through here, so the reads issued in one tick become one
   * `POST /files/read` (specs/desktop.md §10.1). The batch call stays a LITERAL `postJson` in this
   * file rather than moving into the batcher: the platform's conformance test finds the routes this
   * adapter calls by scanning cloud.ts for literal `api()`/`postJson()` paths, and a path built
   * elsewhere would be a route that test cannot see.
   *
   * 404/405 is an older platform without the route, so batching stops for the session. So is a 403
   * `read_only`: the route is a declared READ, and an older platform's gateway refuses every
   * non-allowlisted POST from a read-only collaborator before any route lookup, so that refusal is
   * how "no such route" reaches a viewer — and it can never succeed on that backend. Any other
   * failure re-serves just that chunk singly. A 200 that is not a JSON object is not this route
   * answering (a fallback page, a proxy, a stray `null`), which is the same verdict as a 404.
   */
  const reader = createReadBatcher({
    async fetchBatch(paths: string[]): Promise<BatchAnswer> {
      const res = await postJson("/files/read", { paths } satisfies ReadFilesRequest);
      if (res.status === 404 || res.status === 405) {
        return "unsupported";
      }
      if (res.status === 403 && (await isReadOnlyRefusal(res))) {
        return "unsupported";
      }
      if (!res.ok) {
        return "retry-singly";
      }
      let body: JsonValue;
      try {
        body = await readJson<JsonValue>(res);
      } catch {
        return "unsupported";
      }
      if (!isReadFilesAnswer(body)) {
        return "unsupported";
      }
      return body;
    },
    fetchOne: readOne,
  });

  /**
   * The manifest read every package member starts from, shared while it is IN FLIGHT and forgotten
   * the moment it settles. The package panel asks for the list, the catalogue and the dependency
   * check together; one request answers all three. Nothing is kept afterwards, because the next
   * call may follow a write this session just made.
   */
  let packageJsonRead: Promise<string> | null = null;

  async function readPackageJson(): Promise<JsonObject> {
    let text: string;
    try {
      packageJsonRead ??= reader.read("package.json").finally(() => {
        packageJsonRead = null;
      });
      text = await packageJsonRead;
    } catch {
      return {};
    }
    // Parsed per caller: the members mutate what they get, and must not mutate each other's copy.
    try {
      // A manifest that is not a JSON object is as unusable as one that is not JSON at all.
      const pkg = parseJson(text);
      return isJsonObject(pkg) ? pkg : {};
    } catch {
      return {};
    }
  }

  // The bound session's /raw tree; see `documentBaseUrl` below for why both members ride together.
  const repoAssets: Pick<StudioPlatform, "assetSpace" | "documentBaseUrl"> = {};
  if (base) {
    repoAssets.assetSpace = "repo";
    repoAssets.documentBaseUrl = `${base}/raw/`;
  }

  const platform: StudioPlatform = {
    id: "cloud",
    projectRoot: root,
    /* Commits land on GitHub as they are made (`gitCommit`), a push is a sync check, and a branch
       is a sibling session (`gitCheckout`), which is what the Publish workspace says before it
       switches one (studio.md §22.8). */
    gitHosted: true,
    canvasUrl: "/canvas.html",
    /* The projectRoot here is the IDENTIFIER "owner/repo@branch", not a served path, so the canvas's
       default base — <origin>/<projectRoot>/ — addressed nothing. Every component $ref fetch landed
       on the SPA fallback, which answers the marketing page at HTTP 200, so res.ok passed and the
       runtime's res.json() died on "Unexpected token '<'". Images failed the same way, silently.
       The session serves the project tree at /raw.

       Conditional because `base` is "" until a project is bound, and "/raw/" would be a confident
       wrong answer — worse than the default, which at least fails visibly.

       `assetSpace` rides in the SAME spread, and that is the whole of its correctness: studio.jx-
       suite.com is a multi-tenant SPA origin, so `/hero.jpg` misses Workers Static Assets and the
       single-page-app fallback answers index.html at HTTP 200 — the <img> gets HTML, renders
       broken, and logs nothing. Declaring "repo" tells Studio to resolve each reference to the
       project file it names and address it under /raw. Until a project is bound there is no /raw to
       address, so the project-less hub declares neither and stays exactly as it was. */
    ...repoAssets,
    /* Open Project routes through Studio's repo picker (write-access repos via listRepos +
       importProject) — sessions are URL-bound, so openProject() below never opens a dialog. */
    openProjectPicker: "repo-list",

    /* A cloud project IS a GitHub repo, so the New Project modal collects the repository location
       (owner, name, visibility) rather than a folder. */
    createDestination: "repo",

    /* A refusal throws rather than resolving as though the session were live. This used to ignore
       the response entirely, so a project the backend would not open "activated" fine and the first
       visible failure was a generic "Failed to load project" two calls later. */
    async activate() {
      if (!project) {
        return;
      }
      const res = await postJson("/activate", {});
      if (!res.ok) {
        throw await platformError(res, "Failed to open the project session");
      }
    },

    /* The shell binds the session to one repo+branch before Studio boots, so
       "opening" a project just returns the bound one. */
    async openProject() {
      if (!project) {
        return null;
      }
      const info = await projectInfo();
      const config: ProjectConfig = info.projectConfig ?? {};
      return {
        config,
        handle: { root, name: config.name || info.name, projectConfig: config },
      };
    },

    async probeRootProject() {
      if (!project) {
        return null;
      }
      try {
        const info = await projectInfo();
        return {
          meta: { root, name: info.name },
          info: {
            isSiteProject: info.projectConfig !== null,
            projectConfig: info.projectConfig ?? null,
          },
        };
      } catch {
        return null;
      }
    },

    // ─── Files ────────────────────────────────────────────────────────────

    async listDirectory(dir: string) {
      return okJson<DirEntry[]>(
        await api(`/files?dir=${encodeURIComponent(dir)}`),
        `Failed to list directory: ${dir}`,
      );
    },

    /* Coalesced: reads issued together go out as one batch, and a lone read as the plain GET it
       always was. Callers cannot tell, which is the point (specs/desktop.md §3.1). */
    async readFile(path: string) {
      return reader.read(path);
    },

    /* Raw bytes. The session origin serves this route, so no CORS question arises — the shell and
       the API are the same origin on cloud, which is exactly what `assetSpace: "repo"` is about. */
    async readFileBytes(path: string) {
      const res = await api(`/file/bytes?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        throw new Error(await errorMessage(res, `Failed to read file bytes: ${path}`));
      }
      return res.arrayBuffer();
    },

    async writeFile(path: string, content: string) {
      const res = await api("/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, `Failed to write file: ${path}`));
      }
    },

    async uploadFile(path: string, data: string | File | Blob | ArrayBuffer) {
      const res = await api(`/file/upload?path=${encodeURIComponent(path)}`, {
        method: "POST",
        body: data,
      });
      const body = await okJson<Partial<UploadResult>>(res, `Upload failed: ${path}`);
      // The session echoes the path today; falling back to the request keeps a backend that says
      // Nothing working rather than writing `undefined` into a document.
      const uploaded: UploadResult = { path: body.path ?? path };
      if (body.size !== undefined) {
        uploaded.size = body.size;
      }
      return uploaded;
    },

    async deleteFile(path: string) {
      const res = await api(`/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(await errorMessage(res, `Failed to delete file: ${path}`));
      }
    },

    async renameFile(from: string, to: string): Promise<RenameResult> {
      return okJson<RenameResult>(
        await postJson("/file/rename", { from, to }),
        `Failed to rename: ${from} → ${to}`,
      );
    },

    /**
     * Usage counts, computed SERVER-SIDE. The walker lives in `@jxsuite/server`, which the cloud
     * target already runs against the ProjectSession's working tree, so cloud is not a host that
     * degrades to "unknown" — it answers the same query the desktop does, over the same engine.
     */
    async findReferences(target: { path?: string; tagName?: string }): Promise<ReferencesResult> {
      const params = new URLSearchParams();
      if (target.path) {
        params.set("path", target.path);
      }
      if (target.tagName) {
        params.set("tag", target.tagName);
      }
      return okJson<ReferencesResult>(
        await api(`/references?${params.toString()}`),
        `Failed to find references: ${target.path ?? target.tagName ?? ""}`,
      );
    },

    async createDirectory(_path: string) {
      // Directories exist implicitly in the virtual tree (created on write).
    },

    /**
     * Realtime co-editing over the gateway's /collab WebSocket (rooms keyed by project-relative
     * path, per the shared ProjectSession working tree). Backends without the endpoint (or with the
     * flag off) refuse the upgrade and Studio degrades to solo editing. The wire client's
     * evaluation defers behind the dynamic import until a doc opens.
     *
     * A plain GET on the same URL is the subprotocol negotiation, and this adapter did not make one
     * before. **A probe that does not answer is not a refusal here.** The gateway is deployed
     * separately from this bundle, so a 404 or a network error means "older gateway", and treating
     * that as no-collab would take working co-editing away from every session pointed at one. It
     * connects as it always has, offering nothing — which is also the only handshake-safe answer to
     * a server that would echo nothing (RFC 6455 §4.1).
     */
    async collab(docPath: string) {
      if (!project || typeof WebSocket === "undefined" || typeof location === "undefined") {
        return null;
      }
      collabNegotiation ??= api("/collab")
        .then(async (res) =>
          res.ok ? negotiateCollab(await readJson<JsonValue>(res)) : { offer: [], refused: null },
        )
        .catch(() => ({ offer: [], refused: null }));
      const negotiated = await collabNegotiation;
      if (negotiated.refused !== null) {
        console.warn(`Collaboration unavailable: ${negotiated.refused}`);
        return null;
      }
      const { offer } = negotiated;
      collabConnection ??= (async () => {
        const { createWsCollabConnection } = await import("@jxsuite/collab/client");
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        return createWsCollabConnection({
          /* The DO has no GitHub token on a WS message; a read hydrates + caches the row, and the
             batch route keeps that side effect. Only the side effect matters, so the outcome is
             dropped: a failed read leaves the room to refuse the reopen, which is its own answer. */
          hydratePath: async (path) =>
            reader.read(path).then(
              () => {},
              () => {},
            ),
          protocols: offer,
          url: `${scheme}://${location.host}${base}/collab`,
        });
      })();
      const connection = await collabConnection;
      return connection.openDoc(docPath);
    },

    /**
     * Live session events over the gateway WebSocket. The DO pushes {kind:"fs"} batches for file
     * mutations (including those from other tabs) and {kind:"git"} notices.
     *
     * The socket reconnects on jittered backoff, cut short by the browser's wake signals
     * (`@jxsuite/collab/reconnect`): every Studio on a gateway loses it at the same deploy, and a
     * laptop that wakes onto a network should not sit out a 30-second timer first.
     *
     * Two things the event stream cannot say on its own are reported through `onResync`. A socket
     * that came back missed every batch sent while it was gone, and the DO does not replay them —
     * so every open after the first is a `"reconnect"`. The first open is an `"open"`: the
     * session's listings carry content versions, the boot's first listings race the handshake, and
     * a change broadcast before this socket joined (a first connect that fails during a gateway
     * deploy can stretch that to a whole backoff) reached nobody. And a commit lands with a
     * `committed` notice and no per-file events, so it is a `"commit"`.
     */
    subscribeFileEvents(
      handler: (events: FsEvent[]) => void,
      options?: { onResync?: (reason: FsResyncReason) => void },
    ) {
      // No project means an empty base, so the bare `/events` URL hits no gateway route.
      // That fails in a reconnect loop; mirror `collab`'s guard and degrade to no-op on the hub.
      if (!project || typeof WebSocket === "undefined" || typeof location === "undefined") {
        return () => {};
      }
      let socket: WebSocket | null = null;
      let closed = false;
      let everOpened = false;
      const connect = () => {
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${scheme}://${location.host}${base}/events`);
        socket = ws;
        ws.addEventListener("message", (ev: MessageEvent<string>) => {
          let payload: SessionEventWire;
          try {
            /* SAFETY: the session's /events socket sends only text frames, each one a JSON
               SessionEventWire (`kind` "fs" with its events, or "git" with the git event). */
            payload = JSON.parse(ev.data) as SessionEventWire;
          } catch {
            return;
          }
          if (payload.kind === "fs" && payload.events?.length) {
            handler(payload.events);
          } else if (payload.kind === "git" && payload.event === "committed") {
            options?.onResync?.("commit");
          }
        });
        ws.addEventListener("open", () => {
          scheduler.opened();
          options?.onResync?.(everOpened ? "reconnect" : "open");
          everOpened = true;
        });
        ws.addEventListener("close", () => {
          if (!closed) {
            scheduler.scheduleRetry();
          }
        });
      };
      const scheduler = createReconnectScheduler(connect);
      connect();
      return () => {
        closed = true;
        scheduler.dispose();
        socket?.close();
      };
    },

    // ─── Formats (session backend registry, mirroring the dev-server seam) ─

    /**
     * The project's format registry, served by the session gateway (the dev server's `GET
     * /__studio/formats` under this session's base path). Degrades to an empty registry (only .json
     * documents open) against backends that predate the route.
     */
    async listFormats() {
      try {
        const res = await api("/formats");
        if (!res.ok) {
          return [];
        }
        const body = await readJson<{ formats?: JsonObject[] }>(res);
        return body.formats ?? [];
      } catch {
        return [];
      }
    },

    /** The extensions payload riding beside `formats` on the same route. */
    async listExtensions(): Promise<ExtensionsInfo[]> {
      try {
        const res = await api("/formats");
        if (!res.ok) {
          return [];
        }
        const body = await readJson<{ extensions?: ExtensionsInfo[] }>(res);
        return body.extensions ?? [];
      } catch {
        return [];
      }
    },

    /**
     * The extensions THIS WORKER bundles — not the shipped first-party catalogue.
     *
     * A Worker ships a fixed set of extension packages (specs/extensions.md §5.5), decided by the
     * platform build rather than by this repository's `extensions/` tree, so the gateway is the
     * only thing that knows. An extension the Worker does not bundle is dropped from the registry
     * before composition, so advertising it would promise a toggle that silently does nothing.
     *
     * What the Worker bundles is what it can EDIT with, not what the project gets: the site is
     * built in Pages CI from the project's own install, so an entry the project has not declared is
     * install-then-enable here exactly as on every other backend (specs/extensions.md §3).
     *
     * `installed` here means DECLARED. Nothing resolves a module in a Worker: `addPackage` is a
     * manifest edit and resolution happens later in Pages CI, so the manifest is the only fact this
     * adapter has, and it is the one the reader is being asked about.
     *
     * Degrades to an EMPTY list, which is the whole contract: a session whose gateway predates this
     * route must offer nothing rather than five extensions three of which it cannot load.
     */
    async listExtensionCatalog(): Promise<ExtensionCatalogEntry[]> {
      try {
        const res = await api("/catalog");
        if (!res.ok) {
          return [];
        }
        const entries = await readJson<ExtensionCatalogEntry[]>(res);
        const pkg = await readPackageJson();
        const declared = new Set([
          ...Object.keys(dependencyBlock(pkg, "dependencies")),
          ...Object.keys(dependencyBlock(pkg, "devDependencies")),
        ]);
        for (const entry of entries) {
          entry.installed = declared.has(entry.name);
        }
        return entries;
      } catch {
        return [];
      }
    },

    /**
     * The session's generated entry documents, composed server-side from the core schemas and each
     * enabled extension's fragments (extensions.md §5.2) and returned PRE-BUNDLED — Monaco and the
     * AI assistant register them as inline objects and never fetch (studio.md §4.2.1).
     *
     * Degrades to `{}` rather than throwing: a backend too old to serve the route, or a project
     * whose extensions the session cannot compose, keeps the bundled core schemas. That fallback
     * under-suggests extension extras but never reports false errors (extensions.md §5.3).
     */
    async fetchProjectSchemas(): Promise<ProjectSchemasResponse> {
      try {
        const res = await api("/project-schemas");
        if (!res.ok) {
          return {};
        }
        return await readJson<ProjectSchemasResponse>(res);
      } catch {
        return {};
      }
    },

    /**
     * Invoke a format capability (parse/serialize) on the session backend — the dev server's `POST
     * /__studio/format` seam. In-page execution left with the core → @jxsuite/parser dependency, so
     * backends without the route surface the error below instead of silently mangling format
     * documents.
     */
    async formatAction(payload) {
      const res = await postJson("/format", payload);
      if (!res.ok) {
        throw new Error(
          await errorMessage(
            res,
            "This cloud session cannot run format actions yet (the backend serves no format route)",
          ),
        );
      }
      // A successful answer is `{ result }`: the parsed document, or the serialized text.
      const data = await readJson<{ result: JxMutableNode | string }>(res);
      return data.result;
    },

    // ─── Components / code services (cloud: static-only posture) ──────────

    /**
     * Component discovery, by READING rather than executing.
     *
     * This returned `[]` under "no execution of project JS in the cloud", and the cost was not the
     * loss of discovery — it was the canvas. `canvas-live-render` injects the `$elements` a
     * document's tags need only when the registry is non-empty, so an empty registry meant nothing
     * was ever registered, no component was ever fetched, and every component instance rendered as
     * an unregistered custom element: an empty inline box. A page built from components came up as
     * blank space between the layout's chrome.
     *
     * Discovery does not need to execute anything. For a JSON component it is a file read and a
     * property lookup — `componentMetaFrom` is that function, shared with the two Bun backends so
     * "which `state` entries are props" has one answer. Non-JSON component formats DO need a
     * project-supplied parser, and those stay out: the posture is kept where it actually applies
     * rather than across the whole feature.
     *
     * Bounded rather than unbounded: the walk skips the directories a scan has no business in and
     * stops at a depth and a file count, because this runs against a remote session over HTTP and a
     * pathological tree must not turn opening a project into thousands of requests.
     */
    async discoverComponents() {
      const SKIP = new Set(["node_modules", "dist", ".git", ".claude", ".obsidian", "build"]);
      const MAX_FILES = 400;
      const MAX_DEPTH = 6;
      const jsonPaths: string[] = [];

      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH || jsonPaths.length >= MAX_FILES) {
          return;
        }
        let entries: DirEntry[];
        try {
          entries = await platform.listDirectory(dir);
        } catch {
          return; // A directory that vanished mid-walk is not a discovery failure.
        }
        const dirs: string[] = [];
        for (const entry of entries) {
          if (entry.type === "directory") {
            if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) {
              dirs.push(entry.path);
            }
          } else if (entry.name.endsWith(".json") && jsonPaths.length < MAX_FILES) {
            jsonPaths.push(entry.path);
          }
        }
        await Promise.all(dirs.map(async (d) => walk(d, depth + 1)));
      };
      await walk("", 0);

      const metas = await Promise.all(
        jsonPaths.map(async (path) => {
          try {
            return componentMetaFrom(parseJson(await platform.readFile(path)), path);
          } catch {
            return null; // Not JSON, not readable, or not a component — all the same answer here.
          }
        }),
      );
      /* SAFETY: the two Bun backends answer discoverComponents with this same componentMetaFrom
         output, so ComponentMeta's narrower prop typing describes exactly what Studio already
         receives for these documents everywhere else. */
      return metas.filter((m): m is NonNullable<typeof m> => m !== null) as ComponentMeta[];
    },

    async codeService() {
      return null;
    },

    async fetchPluginSchema() {
      return null;
    },

    // ─── Packages (the session's lockfile service; nothing installs) ───

    /* Each mutation runs npm's installer lockfile-only on the platform, which writes
       `package.json` and `package-lock.json` back into the shared tree as one change, so a commit
       carries a lockfile a build can install from frozen (server.md §4.1). A failure changes
       nothing and its message names the cause. */
    async addPackage(name: string) {
      const res = await api("/packages/add", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, `Failed to add ${name}`));
      }
    },

    async removePackage(name: string) {
      const res = await api("/packages/remove", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, `Failed to remove ${name}`));
      }
    },

    async setPackageVersions(updates: { name: string; version: string; dev?: boolean }[]) {
      const res = await api("/packages/set-versions", {
        body: JSON.stringify({ updates }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        return { log: await errorMessage(res, "Failed to update versions"), ok: false };
      }
      return readJson<PackageOpResult>(res);
    },

    async packageVersions() {
      const res = await api("/packages/versions");
      return res.ok ? readJson<PackageVersionInfo[]>(res) : [];
    },

    async listPackages(): Promise<PackageInfo[]> {
      const pkg = await readPackageJson();
      const out: PackageInfo[] = [];
      const deps = dependencyBlock(pkg, "dependencies");
      for (const [name, version] of Object.entries(deps)) {
        out.push({ name, version });
      }
      const devDeps = dependencyBlock(pkg, "devDependencies");
      for (const [name, version] of Object.entries(devDeps)) {
        out.push({ name, version, dev: true });
      }
      return out;
    },

    // ─── Site context & lookup ─────────────────────────────────────────────

    async resolveSiteContext(filePath: string) {
      try {
        const info = await projectInfo();
        const config = info.projectConfig ?? undefined;
        const context: SiteContext = { sitePath: root };
        if (config !== undefined) {
          context.projectConfig = config;
        }
        if (filePath !== root) {
          context.fileRelPath = filePath;
        }
        return context;
      } catch {
        return { sitePath: null };
      }
    },

    async locateFile(name: string) {
      try {
        const res = await api(`/locate?name=${encodeURIComponent(name)}`);
        if (res.ok) {
          const body = await readJson<{ path?: string | null }>(res);
          return body.path ?? null;
        }
      } catch {
        // Fall through to null; the caller treats it as "not found".
      }
      return null;
    },

    async searchFiles(query: string, extensions: string[] = []) {
      const exts = ["json", ...extensions.map((e) => e.replace(/^\./, ""))];
      const res = await api(
        `/search?query=${encodeURIComponent(query)}&extensions=${encodeURIComponent(exts.join(","))}`,
      );
      if (!res.ok) {
        return [];
      }
      return await readJson<DirEntry[]>(res);
    },

    // ─── Git (virtual engine in the ProjectSession DO) ─────────────────────

    async gitStatus() {
      return okJson<GitStatusResult>(await api("/git/status"), "Failed to read git status");
    },

    async gitBranches() {
      const listed = await okJson<GitBranchesResult>(
        await api("/git/branches"),
        "Failed to list branches",
      );
      if (listed.defaultBranch) {
        return listed;
      }
      const name = await repositoryDefaultBranch();
      return name ? { ...listed, defaultBranch: name } : listed;
    },

    async gitLog(limit?: number) {
      const q = limit ? `?limit=${limit}` : "";
      return okJson<GitLogEntry[]>(await api(`/git/log${q}`), "Failed to read git log");
    },

    async gitStage(files: string[]) {
      await okJson(await postJson("/git/stage", { files }), "Failed to stage files");
    },

    async gitUnstage(files: string[]) {
      await okJson(await postJson("/git/unstage", { files }), "Failed to unstage files");
    },

    /** Commits land on GitHub immediately (blobs → tree → commit → ref CAS). */
    async gitCommit(message: string) {
      await okJson(await postJson("/git/commit", { message }), "Commit failed");
    },

    /** Every commit is already on GitHub; push is a sync check. */
    async gitPush() {
      await okJson(await postJson("/git/push", {}), "Push failed");
    },

    async gitPull() {
      await okJson(await postJson("/git/pull", {}), "Pull failed");
    },

    async gitFetch() {
      await okJson(await postJson("/git/fetch", {}), "Fetch failed");
    },

    /** Branches are separate cloud sessions; re-point the page at the sibling. */
    async gitCheckout(branch: string) {
      if (project && typeof location !== "undefined") {
        location.assign(editUrl({ ...project, branch }));
      }
    },

    async gitCreateBranch(name: string) {
      await okJson(await postJson("/git/create-branch", { name }), "Failed to create branch");
    },

    /** One commit, parented on the session's base, onto a branch the backend creates for it. */
    async gitCommitBranch(opts: { branch: string; message: string }) {
      return okJson<GitCommitBranchResult>(
        await postJson("/git/commit-branch", { branch: opts.branch, message: opts.message }),
        `Could not publish to ${opts.branch}`,
      );
    },

    async gitDiff(path?: string) {
      const data = await okJson<{ diff: string }>(
        await api(`/git/diff?path=${encodeURIComponent(path ?? "")}`),
        "Failed to compute diff",
      );
      return data.diff;
    },

    async gitShow(opts: { path: string; ref?: string }) {
      const params = new URLSearchParams({ path: opts.path });
      if (opts.ref) {
        params.set("ref", opts.ref);
      }
      const data = await okJson<{ content: string }>(
        await api(`/git/show?${params}`),
        `Failed to read ${opts.path} at ref`,
      );
      return data.content;
    },

    async gitDiscard(files: string[]) {
      await okJson(await postJson("/git/discard", { files }), "Failed to discard changes");
    },

    async gitInit() {
      // Cloud projects are always GitHub repositories already.
    },

    async gitAddRemote() {
      // The GitHub repo IS the remote; nothing to add.
    },

    /**
     * Open in Browser, cloud edition — a LIVE preview rather than a build.
     *
     * The backend cannot run `jx build`: it never executes project JS, and the compiler needs
     * `sharp`, a bundler and a filesystem, none of which exist in a Worker. What it can do is serve
     * the working tree as a real site on an origin of its own, rendering each page with the same
     * runtime the canvas uses — so the reply names `mode: "live"` and Studio says so, instead of
     * letting a reader assume they are looking at build output.
     *
     * That it is not a build is also the best thing about it: the preview is the tree as it stands,
     * including edits nobody has saved and edits another collaborator is making right now.
     */
    async buildSite() {
      return okJson<SiteBuildResult>(
        await api("/build", { method: "POST" }),
        "The site could not be previewed.",
      );
    },

    // ─── Project catalogue & navigation (Studio welcome / New Project UI) ──

    async listProjects(): Promise<ProjectListEntry[]> {
      const entries = await fetchProjects();
      return entries.map((p) => ({
        name: p.fullName,
        root: projectRootKey({ owner: p.owner, repo: p.name, branch: p.defaultBranch }),
        description: `${p.defaultBranch} · ${p.permission}`,
      }));
    },

    async listStarters(): Promise<StarterInfo[]> {
      const res = await fetch("/api/v1/starters", { credentials: "include" });
      if (!res.ok) {
        return [];
      }
      return await readJson<StarterInfo[]>(res);
    },

    /** Welcome/recents open path: navigate this tab into the project's editor. */
    async setWindowProject(rootKey: string) {
      const target = await resolveRootKey(rootKey);
      /* Throw rather than fall through: `deduped` tells the caller the open was handled, so an
         unresolvable key answered "done" and left the user looking at the screen they clicked on.
         The throw reaches `openRecentProject`'s catch, which reports the failure and drops the
         entry — the right end for a row naming a project this account can no longer open. */
      if (!target) {
        throw new Error(`No project to open at ${rootKey}`);
      }
      if (typeof location !== "undefined") {
        location.assign(editUrl(target));
      }
      // Navigation unloads the page; deduped stops the caller's follow-up work.
      return { deduped: true, config: null };
    },

    async openProjectInNewWindow(rootKey: string) {
      const target = await resolveRootKey(rootKey);
      // Same contract as setWindowProject: the caller reports "Opened in another window" on any
      // Resolved call, so a key that opens nothing has to fail rather than answer.
      if (!target) {
        throw new Error(`No project to open at ${rootKey}`);
      }
      if (typeof window !== "undefined") {
        window.open(editUrl(target), "_blank", "noopener");
      }
      // `_blank` always makes a tab; a browser tab already showing this project is not something
      // The page can see, let alone raise.
      return { focused: false };
    },

    /**
     * Create the GitHub repo (seeded from a starter) via the platform API and return its catalogue
     * root key — Studio's modal flow then opens it via setWindowProject. Server errors (e.g.
     * needs_installation_access) surface as the thrown message inside the modal.
     */
    async createProject(opts: {
      name: string;
      description?: string | undefined;
      directory: string;
      destination: CreateProjectDestination;
      starter?: string | undefined;
      template?: string | undefined;
    }) {
      // The repository location comes from the modal's Owner / Repository / Visibility fields —
      // Never from a server-side default. The API resolves `owner` against the session login to
      // Decide between /user/repos and /orgs/<owner>/repos.
      const { destination } = opts;
      if (destination.kind !== "repo" || !destination.owner || !destination.repo) {
        throw new Error("A destination repository is required.");
      }
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: opts.name,
          description: opts.description,
          starter: opts.starter,
          owner: destination.owner,
          repo: destination.repo,
          private: destination.private,
        }),
      });
      if (!res.ok) {
        /* Structured, so the New Project modal can act on what failed: an install link for a
           missing App installation, the offered actions of an `action-required` refusal. */
        throw await platformError(res, "Failed to create project");
      }
      const created = await readJson<{ owner: string; name: string; defaultBranch: string }>(res);
      return {
        root: projectRootKey({
          owner: created.owner,
          repo: created.name,
          branch: created.defaultBranch,
        }),
        config: { name: opts.name } satisfies ProjectConfig,
      };
    },

    /**
     * AI-guided site import, streamed from the PLATFORM's import route rather than a session one.
     *
     * Deliberately not routed through `api()`: importing is how a cloud project comes into
     * existence, so the one mode it has to work in is the project-less hub, where `api()` rejects
     * before a request is ever made and `base` is "".
     *
     * The path is same-origin and relative, so `streamImport`'s plain `fetch` carries the session
     * cookie under the default `same-origin` credentials mode — the same authority every
     * `/api/v1/*` call here sends `credentials: "include"` for, with no cloud-shaped option added
     * to the shared client. A bring-your-own-key run rides on the headers that client already sets,
     * so the backend sees `X-Api-Key` / `X-Api-Base-URL` exactly as the OSS server does.
     *
     * `onReady` is forwarded and this backend never calls it, which is a difference worth naming:
     * adopting the project mid-run would navigate this page to the editor and abort the request
     * still writing the import, so the stream carries no `ready` line and the caller adopts on
     * `done`. That is the same path a backend older than `ready` has always taken.
     */
    async importSite(
      opts: ImportSiteOptions,
      onProgress: (evt: ImportProgressEvent) => void,
      signal?: AbortSignal,
      onReady?: (evt: ImportReadyEvent) => void,
    ) {
      return await streamImport("/api/v1/import/site", opts, onProgress, signal, onReady);
    },

    // ─── Identity & Cloudflare publish surface ──────────────────────────────

    async getUser() {
      const res = await fetch("/api/v1/me", { credentials: "include" });
      if (!res.ok) {
        return null;
      }
      const me = await readJson<{
        user: { login: string; name: string | null; avatar_url: string | null } | null;
      }>(res);
      if (!me.user) {
        return null;
      }
      const user: SignedInUser = { login: me.user.login };
      if (me.user.name) {
        user.name = me.user.name;
      }
      if (me.user.avatar_url) {
        user.avatarUrl = me.user.avatar_url;
      }
      return user;
    },

    /** Repositories reachable through the user's Jx Suite App installations (user + org). */
    async listRepos(): Promise<RepoInfo[]> {
      const res = await fetch("/api/v1/repos", { credentials: "include" });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to list repositories"));
      }
      const entries = await readJson<(RepoInfo & { repoId: number })[]>(res);
      return entries.map((r) => ({
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        private: r.private,
        defaultBranch: r.defaultBranch,
        permission: r.permission,
        isJxProject: r.isJxProject,
      }));
    },

    /**
     * The folders of a repository that hold a project.json, read from its default branch. The
     * platform drops vendored folders and other tools' `project.json` (Nx's), and says when the
     * repository was too large to list in full.
     */
    async listRepoProjects(repo: { owner: string; name: string }): Promise<RepoProjects> {
      const res = await fetch(
        `/api/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/projects`,
        { credentials: "include" },
      );
      const found = await okJson<RepoProjects>(res, "Failed to look for projects");
      /* Canonical on the way in, so a location the reader picks is spelled the way the root key,
         the editor URL and the session will spell it; anything that climbs out is not offered. */
      const locations: RepoProjects["locations"] = [];
      for (const location of found.locations) {
        const dir = normalizeProjectDir(location.dir);
        if (dir !== null) {
          locations.push(location.name ? { dir, name: location.name } : { dir });
        }
      }
      return { branch: found.branch, locations, truncated: found.truncated === true };
    },

    /** Adopt an existing repo (or one folder of it) as a Jx project; resolves to its root key. */
    async importProject(opts: { owner: string; name: string; dir?: string }) {
      const dir = normalizeProjectDir(opts.dir ?? "");
      if (dir === null) {
        throw new Error("The project folder must stay inside the repository.");
      }
      const importRequest: ImportProjectRequest = { owner: opts.owner, name: opts.name };
      if (dir) {
        importRequest.dir = dir;
      }
      const res = await fetch("/api/v1/projects/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importRequest),
      });
      const imported = await okJson<{ owner: string; name: string; defaultBranch: string }>(
        res,
        "Failed to import repository",
      );
      const importedProject: CloudProject = {
        owner: imported.owner,
        repo: imported.name,
        branch: imported.defaultBranch,
      };
      if (dir) {
        importedProject.dir = dir;
      }
      return { root: projectRootKey(importedProject) };
    },

    /**
     * The account status from /me: GitHub-App installation coverage — which powers the welcome
     * install prompt and the repo picker's "grant access to more repositories" links (`manageUrl`
     * per installation) — and whatever account rows and notices the platform sends (desktop.md
     * §10.4), each checked before it is drawn.
     */
    async getAccountStatus() {
      const res = await fetch("/api/v1/me", { credentials: "include" });
      if (!res.ok) {
        return null;
      }
      const me = await readJson<MeWire>(res);
      const entries = accountEntries(me.entries);
      const notices = accountNotices(me.notices);
      const status: AccountStatus = {
        installations: (me.installations ?? []).map((entry) => {
          const installation: AccountStatus["installations"][number] = {
            id: entry.id,
            account: entry.account,
          };
          if (entry.manageUrl) {
            installation.manageUrl = entry.manageUrl;
          }
          return installation;
        }),
      };
      if (me.appInstallUrl) {
        status.appInstallUrl = me.appInstallUrl;
      }
      if (entries.length > 0) {
        status.entries = entries;
      }
      if (notices.length > 0) {
        status.notices = notices;
      }
      return status;
    },

    /**
     * An offered action, in a window of its own. Synchronous up to `window.open`, which is the
     * whole contract (types.ts): this runs inside a click, and a window opened after an `await` is
     * one the browser blocks. So the target is the action's own `href`, never something that has to
     * be fetched first; an action with no `href` is not one this platform performs.
     *
     * A blocked window navigates the page itself, and whatever the platform has to say about how
     * that ended arrives as a `toast` notice once the page is back. Concurrent calls join the
     * running flow, for `cfConnect`'s reason.
     */
    performAction(action: OfferedAction) {
      if (typeof window === "undefined" || typeof location === "undefined" || !action.href) {
        return Promise.resolve(null);
      }
      const running = actionFlow;
      if (running) {
        try {
          running.popup?.focus();
        } catch {
          // A cross-origin window may refuse focus; joining the flow is what mattered.
        }
        return running.promise;
      }
      const popup = window.open(action.href, "jx-action", "width=980,height=820");
      if (!popup) {
        location.assign(action.href);
        return Promise.resolve({ status: "redirect" } as const);
      }
      const handle: ActionFlow = { popup, promise: Promise.resolve(null) };
      actionFlow = handle;
      handle.promise = awaitAction(popup).finally(() => {
        if (actionFlow === handle) {
          actionFlow = null;
        }
      });
      return handle.promise;
    },

    /** Open a PR from this session's branch (ProjectSession /git/pr). */
    async createPullRequest(opts: { title: string; body?: string; head?: string; base?: string }) {
      return okJson<{ url: string; number: number }>(
        await postJson("/git/pr", opts),
        "Failed to open pull request",
      );
    },

    async cfConnection() {
      return fetchCfConnection();
    },

    /**
     * Hosted OAuth connect: open the broker flow in a popup. The home shell relays the callback's
     * result back via postMessage {source: "jx-cf"} and closes the popup, so success resolves and
     * OAuth errors (denial, invalid_scope misregistration) REJECT with the real reason instead of
     * timing out. A 1.5s poll remains as fallback for older shells / blocked message delivery, and
     * popup-blocked browsers fall back to a full-page redirect.
     *
     * Promise semantics, which are narrower than they look:
     *
     * - **Resolves `null`** only under the SSR guard, where there is no window to open.
     * - **Resolves an outcome** for all four real endings — `connected`, `redirect` (popup blocked,
     *   page navigating away), `canceled` (popup closed with nothing stored), `timeout` (180s).
     * - **Rejects** only on a relayed OAuth error, or on a relayed success this platform could not
     *   confirm against the broker.
     *
     * Concurrent calls JOIN the flow already running rather than starting a second one: both would
     * open the same "cf-connect" target, and the first one's cleanup would then close the popup the
     * second is waiting on.
     */
    cfConnect() {
      if (typeof window === "undefined" || typeof location === "undefined") {
        return Promise.resolve(null);
      }
      const running = cfConnectFlow;
      if (running) {
        try {
          running.popup?.focus();
        } catch {
          // A cross-origin popup may refuse focus; joining the flow is what mattered.
        }
        return running.promise;
      }
      const handle: CfConnectFlow = { popup: null, promise: Promise.resolve(null) };
      cfConnectFlow = handle;
      /* The project rides along so access rules keyed on the repository can apply to the connect,
         which is not under the session base and would otherwise not know which project asked. */
      const connectUrl = projectHint
        ? `/api/v1/cf/connect?project=${encodeURIComponent(projectHint)}`
        : "/api/v1/cf/connect";
      handle.promise = runCfConnect(handle, connectUrl).finally(() => {
        if (cfConnectFlow === handle) {
          cfConnectFlow = null;
        }
      });
      return handle.promise;
    },

    /**
     * Every Cloudflare account this connection can reach (the account picker's rows).
     *
     * A non-OK body is the broker's own unusable-connection payload — `{error, code}` naming a
     * lapsed grant or a connection that never existed — so its sentence is the one worth showing.
     */
    async cfAccounts() {
      const res = await fetch("/api/v1/cf/accounts", { credentials: "include" });
      return okJson<CfAccountSummary[]>(res, "Failed to list Cloudflare accounts");
    },

    /** Store the chosen account on the brokered connection. */
    async cfSelectAccount(account: { id: string; name?: string }) {
      const res = await fetch("/api/v1/cf/select-account", {
        body: JSON.stringify({ accountId: account.id, accountName: account.name }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to select a Cloudflare account"));
      }
    },

    /** Forget the brokered connection (the broker revokes its tokens upstream). */
    async cfDisconnect() {
      const res = await fetch("/api/v1/cf/connection", {
        credentials: "include",
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to disconnect Cloudflare"));
      }
    },

    /** Allowlisted Cloudflare API passthrough (platform injects the OAuth token). */
    async cfApi(apiPath: string, init?: { method?: string; body?: unknown }) {
      /* The project rides in a HEADER, never the query: the platform forwards this path's query
         string to Cloudflare verbatim. */
      const headers: Record<string, string> = {};
      if (projectHint) {
        headers["X-Jx-Project"] = projectHint;
      }
      if (init?.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request: RequestInit = { method: init?.method ?? "GET", credentials: "include" };
      if (Object.keys(headers).length > 0) {
        request.headers = headers;
      }
      if (init?.body !== undefined) {
        request.body = JSON.stringify(init.body);
      }
      const res = await fetch(`/api/v1/cf/proxy${apiPath}`, request);
      /* An `action-required` refusal is the platform's answer, not Cloudflare's, so it is not
         dressed as one: it keeps its own sentence and the actions the publish flow offers. Read
         from a clone, because every other 403 is Cloudflare's own and is parsed below. */
      if (res.status === 403) {
        const refusal = await readJson<StructuredBody | null>(res.clone()).catch(() => null);
        if (isActionRequiredBody(refusal)) {
          throw await platformError(res, "Publishing was refused");
        }
      }
      const envelope = await readJson<CfProxyEnvelope>(res);
      if (!res.ok || envelope.success === false) {
        const message =
          envelope.errors?.map((e) => e.message).join("; ") ?? envelope.error ?? res.statusText;
        throw new Error(`Cloudflare API: ${message}`);
      }
      return envelope.result ?? envelope;
    },

    // ─── AI (platform Workers AI proxy, StreamEvent SSE) ───────────────────

    /* With a project bound, the chat route is told which one — `siblingRoute` keeps the query, so
       the `/models` probe carries it too. */
    aiChatUrl() {
      return projectHint
        ? `/api/v1/ai/chat?project=${encodeURIComponent(projectHint)}`
        : "/api/v1/ai/chat";
    },
  };

  return platform;
}
