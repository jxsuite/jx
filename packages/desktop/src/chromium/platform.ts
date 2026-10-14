/// <reference lib="dom" />
import { streamImport } from "@jxsuite/studio/import-client";
import { base64ToBytes, toBase64 } from "@jxsuite/studio/base64";
import { setPreviewNavigateHandler } from "@jxsuite/studio/preview-navigate";
import type {
  CreateProjectDestination,
  FsEvent,
  FsResyncReason,
  ImportProgressEvent,
  ImportReadyEvent,
  ImportSiteOptions,
  RecentProjectEntry,
  FormatActionRequest,
  StudioPlatform,
} from "@jxsuite/studio/types";
import type { JsonObject, JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import type {
  DataRowDelete,
  DataRowInsert,
  DataRowsQuery,
  DataRowUpdate,
  KeyValuePatch,
} from "@jxsuite/protocol";
import type { StudioRPC } from "../rpc-schema";

/* Inferred return type with a `satisfies` conformance check at the bottom, so callers see which of
   the PAL's OPTIONAL members this launcher actually implements — annotating `StudioPlatform` made
   every one of them `| undefined` at the call site, including in this package's own tests. */
/**
 * What a caller is told when the socket is not there.
 *
 * One sentence, and it says both halves: what failed, and that it is being dealt with. The studio
 * surfaces it through the ordinary error path every PAL call already has — `files.ts`'s open flow
 * catches it and shows a notification — so the button that "did nothing" now reports.
 */
const DISCONNECTED = "Lost connection to the Jx backend — reconnecting…";

/** Backoff bounds for reconnecting the RPC socket, matching `@jxsuite/collab`'s wire client. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 30_000;

/**
 * How long a request may wait for its reply before it is abandoned.
 *
 * Matches the electrobun launcher's `maxRequestTime`. Some handlers are genuinely slow — a build, a
 * dependency install, the XDG folder picker sitting open while somebody decides — so it is minutes
 * rather than seconds. What it rules out is the state this launcher used to reach: a request that
 * waits forever, pinning `platformInFlight()` and the idle probe with it.
 */
const REQUEST_TIMEOUT_MS = 300_000;

/**
 * How often the shell pokes the socket while it has nothing to say.
 *
 * The project server's idle timeout is 120s and the shell can easily be quiet for longer than that
 * — an import runs for minutes over a SEPARATE HTTP stream, so the RPC socket sees no traffic at
 * all while it happens. Comfortably inside the window, so one dropped ping is not a disconnection.
 */
const PING_INTERVAL_MS = 30_000;

/** Every request the launcher answers, keyed by method: what it takes and what it resolves. */
type StudioRequests = StudioRPC["bun"]["requests"];

/**
 * A server push's `params`: the object the launcher handed `projectServer.push` — `{ events }` for
 * `onFileEvents`, `{ settings }` for `settingsChanged` — and nothing at all for `focusWindow`.
 */
interface PushParams {
  events?: FsEvent[];
  settings?: Record<string, string>;
}

/** One frame off the RPC socket: a reply (`id`, then `result` or `error`) or a push (`method`). */
interface ServerFrame {
  id?: number;
  method?: string;
  params?: PushParams;
  error?: string;
  result?: JsonValue;
}

/** An in-flight request's settlement, keyed in `pending` by the id its reply will echo. */
interface PendingReply {
  resolve: (result: JsonValue | undefined) => void;
  reject: (error: Error) => void;
}

export function createDesktopPlatform() {
  // The project server gates the WS upgrade on the token. The launcher passes it in the shell URL
  // (?token=…); read it here before the shell strips it from the address bar after boot.
  const token = new URLSearchParams(location.search).get("token") ?? "";
  // The canvas iframe runs the in-iframe runtime, which authenticates its dev-proxy loopback
  // Resolve/server fetches with this same per-process rpcToken (?rpcToken=…). Thread it onto the
  // Canvas URL when present so createProjectServer does not 403 those fetches; keep the bare path
  // Otherwise so a token-less/dev context stays byte-identical. Mirrors electrobun's getCanvasUrl.
  const canvasUrl = token
    ? `/__studio__/canvas.html?rpcToken=${encodeURIComponent(token)}`
    : "/__studio__/canvas.html";
  let nextId = 1;
  const pending = new Map<number, PendingReply>();

  /* Server-initiated frames (`method`, no `id`) — the twin of electrobun's `handlers.messages`.
     A launcher speaks first for the things the shell cannot ask about: a file changed under the
     project root, or another window asked this one to come forward. */
  const messages = new Map<string, (params: PushParams) => void>([
    [
      /* Raise this window. The launcher relays it when a second window is asked to open a project
         this one already holds; nothing else in the shell can bring an OS window forward. */
      "focusWindow",
      () => {
        try {
          window.focus();
        } catch {
          // A window manager that refuses the raise simply leaves the window where it is.
        }
      },
    ],
    [
      /* Batched filesystem changes from the backend watcher — the sidebar's live sync. */
      "onFileEvents",
      (params) => {
        const { events } = params;
        if (events && events.length > 0) {
          fileEventHandler?.(events);
        }
      },
    ],
    [
      /* Another window's settings change. Every chromium window is its own process, so this is the
         only way one hears about another. */
      "settingsChanged",
      (params) => {
        if (params.settings) {
          settingsHandler?.(params.settings);
        }
      },
    ],
  ]);

  // The studio sidebar's live-sync subscriber, if any. Set via subscribeFileEvents below.
  let fileEventHandler: ((events: FsEvent[]) => void) | null = null;
  /*
   * The same subscriber's resync hook. The launcher's `push` sends to the sockets open at that
   * moment and replays nothing to one that comes back, so every `onFileEvents` frame sent while
   * this socket was down is gone — and events are deltas, which no later delta repairs. A
   * reconnect is therefore reported, and Studio re-reads what it has cached (`studio.md` §9.2).
   */
  let resyncHandler: ((reason: FsResyncReason) => void) | null = null;
  /** Whether the socket has opened before: only a RE-open follows a gap in the event stream. */
  let everOpened = false;
  /** The settings kernel's subscriber, so another window's change reaches this one. */
  let settingsHandler: ((settings: Record<string, string>) => void) | null = null;

  /*
   * ─── The RPC transport ──────────────────────────────────────────────────────
   *
   * This used to be four lines: one socket, a `message` listener, an `open` listener resolving a
   * `ready` promise, and a `request` that awaited `ready` and called `ws.send`. It had no failure
   * path at all, and the failure is silent by construction:
   *
   * - `ready` resolves once and is never reset, so it goes on resolving after the socket dies;
   * - `WebSocket.send()` on a CLOSING or CLOSED socket does not throw — per WHATWG it discards the
   *   data and the browser may log "WebSocket is already in CLOSING or CLOSED state" to the console,
   *   which is the ENTIRE observable evidence;
   * - the pending entry can then only be settled by the `message` listener, which will never fire
   *   again.
   *
   * So every call after a disconnection returned a promise that never settled. `openProject()`'s
   * caller has a `try/catch` and a notification ready for a rejection, and never saw one: the button
   * did nothing, no toast, no log, and `platformInFlight()` reported `openProject` for the rest of
   * the session so the idle probe never went idle again. The only recovery was relaunching Studio.
   *
   * The socket can die for several ordinary reasons — the server closes it on an unknown window, a
   * long import occupies the same Bun process for minutes, the OS suspends a backgrounded window —
   * and none of them needs to be identified to fix this. What the transport owes its callers is that
   * every request SETTLES: with a reply, with a rejection, or with a timeout. The reconnect and the
   * keepalive are what make the rejection recoverable rather than terminal.
   */
  let ws: WebSocket;
  let ready: Promise<void>;
  let reconnectMs = RECONNECT_MIN_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  /** Notified once per disconnection, and again on recovery. Wired by the studio at boot. */
  let connectionHandler: ((state: { online: boolean; reason?: string }) => void) | null = null;

  /** Fail every in-flight request. A request that cannot be answered must not be left waiting. */
  function rejectAllPending(reason: string): void {
    const waiting = [...pending.values()];
    pending.clear();
    for (const entry of waiting) {
      entry.reject(new Error(reason));
    }
  }

  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/?token=${encodeURIComponent(token)}`);
    ready = new Promise<void>((resolve) => {
      ws.addEventListener("open", () => {
        reconnectMs = RECONNECT_MIN_MS;
        connectionHandler?.({ online: true });
        if (everOpened) {
          resyncHandler?.("reconnect");
        }
        everOpened = true;
        resolve();
      });
    });

    ws.addEventListener("message", (event) => {
      /* SAFETY: trust boundary. The only peer on this token-gated socket is the launcher's project
         server, which sends nothing but text frames it built with `JSON.stringify`: replies as
         `{ id, result }` / `{ id, error }` and pushes as `{ method, params }`. */
      const msg = JSON.parse(event.data as string) as ServerFrame;
      if (msg.method) {
        // Unsolicited: dispatch by name. An unknown method is a newer launcher talking to an older
        // Shell, which is not an error — it is a message this build has no use for.
        /* SAFETY: a push carries the params its sender passed (see PushParams); `focusWindow` is
           the one push sent without any, and its handler reads none. */
        messages.get(msg.method)?.(msg.params as PushParams);
        return;
      }
      if (msg.id === undefined) {
        return;
      }
      const p = pending.get(msg.id);
      if (!p) {
        return;
      }
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    });

    /* `close` fires for an error too (the error event is always followed by a close), so one
       handler covers both and there is no way to end up half-disconnected. */
    ws.addEventListener("close", () => {
      rejectAllPending(DISCONNECTED);
      if (closed) {
        return;
      }
      connectionHandler?.({ online: false, reason: DISCONNECTED });
      reconnectTimer = setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
    });
  }

  connect();

  /* A keepalive, because the server's idle timeout is the disconnection this shell is least able to
     predict: the studio can be quiet for minutes at a stretch (an import runs over a separate HTTP
     stream and touches this socket not at all). `__ping` is answered ahead of the session lookup on
     the server, so it survives states an ordinary method would not. */
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: 0, method: "__ping" }));
    }
  }, PING_INTERVAL_MS);
  /* The window is going away; stop trying to reconnect to a server that is going with it. */
  window.addEventListener("pagehide", () => {
    closed = true;
    clearInterval(pingTimer);
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
  });

  /**
   * Send `method` and resolve with its reply. A method whose schema params are `void` may still be
   * sent an empty object, which is what several PAL calls have always put on the wire.
   */
  async function request<M extends keyof StudioRequests>(
    method: M,
    params?: StudioRequests[M]["params"] | Record<string, never>,
  ): Promise<StudioRequests[M]["response"]> {
    await ready;
    /* The guard the old transport did not have. `send` on a dead socket is a no-op, so without
       this the frame vanishes and the caller waits forever for a reply nobody will write. */
    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error(DISCONNECTED);
    }
    return new Promise((resolve, reject) => {
      nextId += 1;
      const id = nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The backend did not answer "${method}" in time.`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (result) => {
          clearTimeout(timer);
          /* SAFETY: the reply echoing this id carries the value the backend's handler for `method`
             resolved, which rpc-schema.ts declares as this method's response (a `void` response
             arrives as `null`, which no caller of one reads). */
          resolve(result as StudioRequests[M]["response"]);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /*
   * Preview link clicks go to the user's REAL browser, not this app window.
   *
   * Following a link in Preview exists to see the page behave like the deployed thing — routing,
   * history, devtools. A Chromium `--app` window has no address bar and no tab strip, so it is not
   * that, and navigating THIS one would replace the editor. The Bun side hands the URL to the OS
   * (`Utils.openExternal`); on failure the studio's own `window.open` default still applies.
   *
   * `View: Open in Browser` reuses the same seam, which is why it belongs here and not only on
   * electrobun: without it the built page opened in a second frameless app window.
   */
  setPreviewNavigateHandler((url: string) => {
    const fallback = () => {
      window.open(url, "_blank", "noopener,noreferrer");
    };
    /* `{ ok: false }` is a REFUSAL, not a rejection — the backend answers the request either way.
       Branching only on a thrown error left the click doing nothing at all whenever the desktop had
       no opener to hand it to. */
    void request("openExternal", { url })
      .then((result) => {
        if (!result.ok) {
          fallback();
        }
      })
      .catch(fallback);
  });

  const platform = {
    id: "desktop" as const,

    /* New projects go where the user says: the modal's Location field, with Browse… backed by the
       XDG portal dialog below. The backend refuses a create without one. */
    createDestination: "path" as const,

    projectRoot: "",

    // The chromium project server serves the canvas iframe doc under /__studio__/. Only chromium
    // Sets this; electrobun and the dev server leave it unset and keep their default canvas path.
    // The ?rpcToken (computed above) authenticates the in-iframe runtime's loopback resolve/server
    // Fetches, mirroring electrobun's getCanvasUrl RPC.
    canvasUrl,

    async activate() {
      // No-op: the chromium platform needs no activation step
    },

    async openProject() {
      return request("openProject");
    },

    async probeRootProject() {
      try {
        const content = await request("readFile", { path: "project.json" });
        /* SAFETY: `content` is project.json's text. The PAL hands Studio the parsed document as the
           project's config without validating it, as every launcher does; text that is not JSON
           throws into the catch below and reads as "no project". */
        const config = JSON.parse(content) as ProjectConfig;
        // Resolve the absolute backend root so the recent-projects list gets a re-openable key.
        const { root } = await request("getProjectRoot");
        const directories: string[] = [];
        return {
          info: {
            directories,
            isSiteProject: true as const,
            projectConfig: config,
          },
          meta: { name: config.name || "project", root: root || "." },
        };
      } catch {
        // The launcher's root defaults to the launch cwd, which usually holds no project.json.
        // Report "no project" (null) so the studio shows the welcome screen — returning a phantom
        // Non-site project instead sets projectState and suppresses the welcome screen for the
        // Whole session (mirrors the electrobun platform's probeRootProject contract).
        return null;
      }
    },

    async getProjectRoot() {
      return request("getProjectRoot");
    },

    async setWindowProject(root: string) {
      return request("setWindowProject", { root });
    },

    // ─── Recent projects (user-level store, shared across per-project profiles) ──

    async getRecentProjects() {
      return request("getRecentProjects");
    },

    async saveRecentProjects(projects: RecentProjectEntry[]) {
      await request("saveRecentProjects", { projects });
    },

    /*
     * GitHub sign-in, launcher-only like the electrobun launcher's: the browser Studio has no
     * loopback server to redirect to and keeps the device flow, so this is not a PAL member.
     */
    githubAuth: {
      signIn: (force = false) => request("githubSignIn", { force }),
      signOut: () => request("githubSignOut"),
      status: () => request("githubToken"),
    },

    // ─── User settings (user-level store, shared across per-project profiles) ──

    async getSettings() {
      return request("getSettings");
    },

    async patchSettings(patch: KeyValuePatch) {
      return request("patchSettings", { patch });
    },

    subscribeSettings(handler: (settings: Record<string, string>) => void) {
      settingsHandler = handler;
      return () => {
        settingsHandler = null;
      };
    },

    /**
     * Report the RPC socket going away and coming back.
     *
     * The studio turns this into a notification. Without it a disconnection was invisible: every
     * call after it returned a promise that never settled, so nothing failed and nothing succeeded,
     * and the only symptom was a UI that stopped responding to a button.
     */
    subscribeConnection(handler: (state: { online: boolean; reason?: string }) => void) {
      connectionHandler = handler;
      return () => {
        connectionHandler = null;
      };
    },

    async resolveSiteContext(filePath: string) {
      return request("resolveSiteContext", { filePath });
    },

    async listDirectory(dir: string) {
      return request("listDirectory", { dir });
    },

    async readFile(path: string) {
      return request("readFile", { path });
    },

    /* Bytes, base64 across the socket. Chromium serves the shell same-origin, so this could have
       been a fetch — but two decode paths is two behaviours, and the one CI never exercises is the
       one that breaks. Both launchers take the same route. */
    async readFileBytes(path: string) {
      const { data } = await request("readFileBytes", { path });
      /* SAFETY: base64ToBytes is `Uint8Array.from(…)`, which always allocates a fresh, unshared
         ArrayBuffer. */
      return base64ToBytes(data).buffer as ArrayBuffer;
    },

    async writeFile(path: string, content: string) {
      return request("writeFile", { content, path });
    },

    // The WS transport JSON-serializes params, so binary must be base64 before it goes on the wire
    // (a File/Blob would serialize to `{}`); the backend base64-decodes. A string passes through.
    async uploadFile(path: string, data: string | File | Blob | ArrayBuffer) {
      return await request("uploadFile", { data: await toBase64(data), path });
    },

    async deleteFile(path: string) {
      return request("deleteFile", { path });
    },

    async renameFile(from: string, to: string) {
      return request("renameFile", { from, to });
    },

    async findReferences(target: { path?: string; tagName?: string }) {
      return request("findReferences", target);
    },

    /**
     * Live filesystem sync for the sidebar.
     *
     * The launcher watches the project root for the whole life of the window (it re-arms itself
     * whenever the root changes) and pushes batched events as `onFileEvents` frames, so this only
     * has to say where they go. Without it the chromium sidebar refreshed only when asked, and a
     * file written by a terminal — or by the AI assistant — stayed invisible until then.
     *
     * The socket can drop and come back (see the transport above), and frames pushed in between are
     * lost, so every re-open is reported as `onResync("reconnect")`.
     */
    subscribeFileEvents(
      handler: (events: FsEvent[]) => void,
      options?: { onResync?: (reason: FsResyncReason) => void },
    ) {
      fileEventHandler = handler;
      const onResync = options?.onResync ?? null;
      resyncHandler = onResync;
      return () => {
        if (fileEventHandler === handler) {
          fileEventHandler = null;
        }
        if (resyncHandler === onResync) {
          resyncHandler = null;
        }
      };
    },

    async createDirectory(path: string) {
      return request("createDirectory", { path });
    },

    async discoverComponents(dir?: string) {
      return request("discoverComponents", { dir });
    },

    async codeService(action: string, payload: JsonValue | undefined) {
      return request("codeService", {
        action,
        payload,
      });
    },

    async locateFile(name: string) {
      return request("locateFile", { name });
    },

    async fetchPluginSchema(src: string, prototype?: string, base?: string) {
      return request("fetchPluginSchema", {
        base,
        prototype,
        src,
      });
    },

    async gitStatus() {
      return request("gitStatus");
    },

    async gitBranches() {
      return request("gitBranches");
    },

    async gitLog(limit?: number) {
      return request("gitLog", { limit });
    },

    async gitStage(files: string[]) {
      return request("gitStage", { files });
    },

    async gitUnstage(files: string[]) {
      return request("gitUnstage", { files });
    },

    async gitCommit(message: string) {
      return request("gitCommit", { message });
    },

    async gitPush(opts?: { setUpstream?: boolean }) {
      return request("gitPush", opts || {});
    },

    async gitPull() {
      return request("gitPull");
    },

    async gitFetch() {
      return request("gitFetch");
    },

    async gitCheckout(branch: string) {
      return request("gitCheckout", { branch });
    },

    async gitCreateBranch(name: string) {
      return request("gitCreateBranch", { name });
    },

    async gitDiff(path?: string) {
      return request("gitDiff", { path });
    },

    async gitDiscard(files: string[]) {
      return request("gitDiscard", { files });
    },

    async gitShow(opts: { path: string; ref?: string }) {
      return request("gitShow", opts);
    },

    async gitInit() {
      await request("gitInit");
    },

    /**
     * Build the site to its output directory and name the origin it is browsable at.
     *
     * `View: Open in Browser` runs this before it opens anything, so the reader sees the OUTPUT the
     * author's document produces rather than whatever the last build happened to leave on disk. The
     * origin is the backend's to name: the built site is served on a port of its own, because this
     * launcher's own paths mean the project's SOURCES and a built page means its output by those
     * very same paths.
     */
    async buildSite() {
      return request("buildSite");
    },

    /**
     * The live preview, and the origin is the backend's to name for the same reason the built
     * site's is: it is served on a port of its own, per project rather than per window, so a tab
     * outlives the window that opened it.
     */
    async previewSite(opts: { route: string }) {
      return request("previewSite", opts);
    },

    async setPreviewOverlay(path: string, contents: string) {
      await request("setPreviewOverlay", { contents, path });
    },

    async clearPreviewOverlay(path?: string) {
      await request("clearPreviewOverlay", path === undefined ? {} : { path });
    },

    async gitAddRemote(name: string, url: string) {
      await request("gitAddRemote", { name, url });
    },

    async searchFiles(query: string, extensions?: string[]) {
      return request("searchFiles", { extensions, query });
    },

    async listFormats() {
      return request("listFormats", {});
    },

    /** The extensions payload behind descriptor-contributed settings sections. */
    async listExtensions() {
      return request("listExtensions", {});
    },
    async listExtensionCatalog() {
      return request("listExtensionCatalog", {});
    },

    /** Pre-bundled per-project entry schemas for Monaco registration. */
    async fetchProjectSchemas() {
      return request("fetchProjectSchemas", {});
    },

    // ─── Data surface + secrets (owner console; names-only secrets) ────────────

    async dataConnections() {
      return request("dataConnections", {});
    },

    async dataConnectionTest(connection: string) {
      return request("dataConnectionTest", { connection });
    },

    async dataPush(opts?: { connection?: string; dryRun?: boolean }) {
      return request("dataPush", opts ?? {});
    },

    async dataRows(query: DataRowsQuery) {
      return request("dataRows", { ...query });
    },

    async dataInsertRow(req: DataRowInsert) {
      return request("dataInsertRow", { ...req });
    },

    async dataUpdateRow(req: DataRowUpdate) {
      return request("dataUpdateRow", { ...req });
    },

    async dataDeleteRow(req: DataRowDelete) {
      return request("dataDeleteRow", { ...req });
    },

    async listSecrets() {
      const res = await request("listSecrets", {});
      return res.names;
    },

    async setSecrets(req: KeyValuePatch) {
      return request("setSecrets", { ...req });
    },

    /**
     * Class resolution over HTTP: the project server gates `/__jx_resolve__` on the RPC token (a
     * token-less fetch 403s), so pass the token captured from the shell URL.
     */
    async resolveClass(body: JsonObject) {
      const res = await fetch(`/__jx_resolve__?token=${encodeURIComponent(token)}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Class resolution failed: ${res.status}`);
      }
      /* SAFETY: `res.json()` resolves only after parsing the body as JSON, so its result is a JSON
         value. */
      return (await res.json()) as JsonValue;
    },

    async formatAction(payload: FormatActionRequest) {
      return request("formatAction", payload);
    },

    async addPackage(name: string) {
      return request("addPackage", { name });
    },

    async removePackage(name: string) {
      return request("removePackage", { name });
    },

    async listPackages() {
      return request("listPackages");
    },

    async installDependencies() {
      return request("installDependencies");
    },

    async dependenciesNeedInstall() {
      return request("dependenciesNeedInstall");
    },

    async packageVersions() {
      return request("packageVersions");
    },

    async setPackageVersions(updates: { name: string; version: string; dev?: boolean }[]) {
      return request("setPackageVersions", { updates });
    },

    /**
     * Build info for the About screen.
     *
     * The channel is the honest difference between the two desktop builds: this one is installed
     * and updated by the system package manager, so it reports no `updateStatus` — an in-app
     * updater it does not have could only ever answer "unknown".
     */
    async getAppInfo() {
      return request("appInfo");
    },

    // ─── Multi-window ───────────────────────────────────────────────────────────
    /* A window is a launcher process here, where on electrobun it is a BrowserWindow inside one.
       Studio cannot tell the difference: it asks which project, then asks for it elsewhere, and
       both launchers answer whether a window was opened or an existing one raised. */

    /**
     * Pick a project WITHOUT binding this window to it — the New Window branch of Open Project.
     * `openProject()` re-roots the asking window as a side effect of picking, which is the one
     * thing this branch must not do.
     */
    async pickProject() {
      return request("pickProject");
    },

    /** Open a project in another window, focusing the window that already holds it if there is one. */
    async openProjectInNewWindow(root: string) {
      return request("openProjectInNewWindow", { root });
    },

    /** Open a fresh welcome window. */
    async newWindow() {
      await request("newWindow");
    },

    async createProject(opts: {
      name: string;
      description?: string;
      url?: string;
      adapter?: string;
      directory: string;
      /* The full PAL union, not just the `path` variant this launcher can act on: the parameter is
         contravariant, so narrowing it here makes the whole platform object unassignable to
         StudioPlatform. `createDestination: "path"` is what actually stops Studio sending a repo. */
      destination: CreateProjectDestination;
      starter?: string;
      template?: string;
      design?: {
        accent?: string;
        background?: string;
        text?: string;
        bodyFont?: string;
        headingFont?: string;
        media?: Record<string, string>;
        logo?: { name: string; base64: string };
      };
    }) {
      const { destination } = opts;
      if (destination.kind !== "path") {
        throw new Error("This launcher creates projects on disk; repo destinations are cloud-only");
      }
      return request("createProject", { ...opts, destination });
    },

    async listStarters() {
      return request("listStarters");
    },

    /**
     * Folder chooser for the New Project modal. This build has a real native dialog — the XDG
     * desktop portal, driven from the Bun side — which returns a filesystem path directly. It is
     * deliberately used in preference to Chrome's `showDirectoryPicker()`, whose handle carries no
     * path and would have to be placed by writing a marker file and scanning for it (§8.2.1). That
     * fallback exists only for the plain dev-server browser session, which has no native option at
     * all.
     */
    async pickDirectory() {
      const result = await request("pickDirectory");
      return result.path;
    },

    // AI-guided site import: streams NDJSON progress from the token-gated loopback endpoint. The
    // Modal resolves the destination before calling (specs/desktop.md §4.5), so `directory` is
    // Already absolute — a relative one means a caller skipped the Location field.
    async importSite(
      opts: ImportSiteOptions,
      onProgress: (evt: ImportProgressEvent) => void,
      signal?: AbortSignal,
      onReady?: (evt: ImportReadyEvent) => void,
    ) {
      const { directory } = opts;
      if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(directory)) {
        throw new Error("A destination folder is required.");
      }
      return streamImport(
        `/__studio__/import-site?token=${encodeURIComponent(token)}`,
        { ...opts, directory },
        onProgress,
        signal,
        onReady,
      );
    },

    /*
     * AI Assistant (Stack B: OpenAI-compatible SSE proxy on the local chromium server).
     *
     * Tokened, like every other surface that spends something. The route forwards to a provider on
     * the user's own key, so an ungated one is an open relay for any process on the machine — and
     * the project server dispatched it ahead of every gate until it was closed (server.md §4.2).
     */
    aiChatUrl() {
      return `/__studio__/ai/chat?token=${encodeURIComponent(token)}`;
    },
  };

  // On the identifier, not the literal: a fresh literal would get excess property checks.
  return platform satisfies StudioPlatform;
}
