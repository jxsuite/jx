/**
 * Devserver.js — Dev Server Platform Adapter
 *
 * Implements the StudioPlatform interface for the @jxsuite/server development workflow. All file
 * I/O goes through /__studio/* REST endpoints. There is no Open Project: a dev-server window opens
 * a project from its `?project=` URL parameter (specs/desktop.md §8.2).
 *
 * See spec/desktop.md §8 for the full specification.
 */

import { streamImport } from "../services/import-client";
import { negotiateCollab } from "@jxsuite/collab/negotiate";
import type { CollabNegotiation } from "@jxsuite/collab/negotiate";
import type { WsCollabConnection } from "@jxsuite/collab/client";
import type { JsonObject, JsonValue, JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";
import type {
  DataConnectionsResponse,
  DataConnectionTestResult,
  DataPushResult,
  DataRowDelete,
  DataRowInsert,
  DataRowsQuery,
  DataRowsResult,
  DataRowUpdate,
  DirEntry,
  ExtensionCatalogEntry,
  ExtensionsInfo,
  FsEvent,
  FsResyncReason,
  ImportProgressEvent,
  ImportReadyEvent,
  ImportSiteOptions,
  ProjectSchemasResponse,
  ReferencesResult,
  RenameResult,
  KeyValuePatch,
  SecretsSetResponse,
  SiteBuildResult,
  SitePreviewResult,
  StarterInfo,
  StudioPlatform,
} from "../types";
import { problemDetail, problemMessage } from "@jxsuite/protocol";
import type { CfProxyEnvelope } from "./cloud";
import type { UploadResult } from "@jxsuite/protocol";

/** Parse a fetch Response body as JSON, asserting the expected shape at the boundary. */
async function readJson<T>(res: Response): Promise<T> {
  /* SAFETY: every route read here is a `/__studio/*` route of @jxsuite/server (specs/server.md §4),
     whose replies have the shapes ../types and the wire interfaces in this file describe, and each
     caller names the type of the route it called. */
  return (await res.json()) as T;
}

interface ErrorBody {
  error?: string;
}

/** One entry of the `/__studio/sites` glob: a site's folder and its parsed project.json. */
interface SiteEntry {
  config: ProjectConfig | null;
  path: string;
}

/**
 * `GET /__studio/project-info`: what the server knows about a folder. The route sends more than
 * Studio reads (`projectRoot` among them), and those members ride along untouched.
 */
interface ProjectInfoReply {
  isSiteProject: boolean;
  projectConfig?: ProjectConfig | null;
  directories?: string[];
  [member: string]: JsonValue | ProjectConfig | undefined;
}

/** The body of an `fs` event on the `/__reload` stream (the server's watcher batches them). */
interface FsEventBatch {
  events?: FsEvent[];
}

/** The options object {@link StudioPlatform.createProject} takes. */
type CreateProjectOptions = Parameters<StudioPlatform["createProject"]>[0];

/** What a row insert or update answers: the row as stored. */
interface DataRowWrite {
  row: JsonObject;
}

/**
 * Create a DevServerPlatform instance.
 *
 * The adapter is stateless apart from `_projectRoot`, which tracks the server-relative project
 * directory (e.g. "examples/site-demo"). All paths passed INTO PAL methods are project-relative;
 * the adapter prefixes them with `_projectRoot` before hitting the server.
 *
 * **Coming back, the space depends on the route, and the routes do not all agree** (the contract is
 * `specs/server.md` §4.1). `/__studio/files` echoes what it was asked — server-root-relative — so
 * its replies are stripped. The refactor routes (`file/rename`, `references`) answer in the ACTIVE
 * PROJECT's space, because that is the space their sweep runs in, so their replies are returned
 * untouched. Stripping one of those is not a harmless no-op: it would eat the first segment of any
 * path that begins with the project root's own name.
 */
export function createDevServerPlatform() {
  let _projectRoot = "";
  /**
   * The in-flight `activate()` for the current root, so a query whose answer depends on the
   * server's project binding can await it.
   *
   * `set projectRoot` fires activation fire-and-forget, and `/__studio/references` is the one route
   * with no `dir` parameter — its sweep root comes solely from the server's activated project. A
   * query landing inside that window would sweep the server's own root instead (issue 239).
   */
  let _activation: Promise<unknown> | null = null;
  /**
   * Lazy /__studio/collab capability probe (null = not asked yet). Its result is the subprotocol
   * negotiation, not a boolean: the probe is the only place the client can learn what envelope the
   * server speaks without risking the handshake (see `@jxsuite/collab/negotiate`).
   */
  let _collabProbe: Promise<CollabNegotiation | null> | null = null;
  /**
   * One multiplexed collab socket per page; per-doc handles come from openDoc. Memoized as a
   * promise so concurrent first opens share the connection instead of racing two sockets.
   */
  let _collabConnection: Promise<WsCollabConnection> | null = null;

  /**
   * Bind the server to `root` — the binding its rootless routes and its static fallback (every
   * media thumbnail, every canvas image) resolve against.
   *
   * **The binding is one per SERVER, not per tab.** So an empty root posts nothing: a Studio tab
   * opened with no project used to post `{ root: "" }` at boot, which unbound the server for every
   * other tab and turned their images into 404s. And a tab re-claims it (see
   * {@link reclaimBinding}) whenever it could have been taken.
   */
  async function postActivate(root: string): Promise<void> {
    if (!root) {
      return;
    }
    const res = await fetch("/__studio/activate", {
      body: JSON.stringify({ root }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) {
      const body = await readJson<ErrorBody>(res).catch((): ErrorBody => ({}));
      throw new Error(
        `Could not open ${root}: ${problemDetail(body) ?? `activation failed (${res.status})`}`,
      );
    }
  }

  /**
   * Re-bind the server to this tab's project. Two events can take the binding away without this tab
   * hearing of it: another Studio tab activating ITS project, and a restarted `bun run dev`, which
   * comes back bound to nothing. So a tab re-claims it when the author comes back to it (focus) and
   * when the reload stream reconnects (a restart). Only a tab with a project claims anything.
   */
  function reclaimBinding(): void {
    if (!_projectRoot) {
      return;
    }
    _activation = postActivate(_projectRoot).catch((error) => {
      console.error("Project re-activation failed:", error);
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", reclaimBinding);
  }

  /**
   * Prefix a project-relative path with the active project root for server API calls.
   *
   * @param {string} rel
   */
  function serverPath(rel: string) {
    const r = rel.replaceAll("\\", "/");
    if (!_projectRoot) {
      return r;
    }
    if (r === ".") {
      return _projectRoot;
    }
    return `${_projectRoot}/${r}`;
  }

  /**
   * A `/__studio/git/*` route that names this session's project with `?dir=`.
   *
   * The server serves every Studio tab pointed at it, and its active project is whichever one was
   * activated last; a git call that named no project ran in that one, so Initialize Repository in
   * one session initialised another's project. With no project open, nothing is named and the
   * server falls back to its own root (a clone from the welcome screen).
   */
  function gitRoute(command: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams(params);
    if (_projectRoot) {
      query.set("dir", serverPath("."));
    }
    const search = query.toString();
    return `/__studio/git/${command}${search ? `?${search}` : ""}`;
  }

  /**
   * Strip the project root prefix from a server-root-relative path.
   *
   * @param {string} path
   */
  function stripRoot(path: string) {
    const p = path.replaceAll("\\", "/");
    if (!_projectRoot) {
      return p;
    }
    return p.startsWith(`${_projectRoot}/`) ? p.slice(_projectRoot.length + 1) : p;
  }

  return {
    id: "devserver",

    /* New projects go where the user says — the server refuses a create without a destination
       rather than defaulting to its own root, which is the jx checkout when serving this
       monorepo. */
    createDestination: "path" as const,

    /** Get or set the current project root (absolute path). */
    get projectRoot() {
      return _projectRoot;
    },
    set projectRoot(v) {
      _projectRoot = v || "";
      if (_projectRoot) {
        // Fire-and-forget: callers that need the binding in place before reading await activate()
        // Themselves. The rejection is reported rather than dropped — an unactivated root leaves
        // Every rootless endpoint (git especially) operating on the server's OWN root.
        _activation = this.activate(_projectRoot).catch((error) => {
          console.error("Project activation failed:", error);
        });
      }
    },

    /**
     * Notify the server which project root to use for resolving static file paths. Returns a
     * promise so callers can await activation before loading assets.
     *
     * Throws when the server refuses the root. Silence here is worse than an error: the endpoints
     * that take no `dir` fall back to the server's own root, so a swallowed refusal turns "sync
     * this project" into git commands against whatever tree the dev server is serving.
     *
     * @param {string} [root]
     */
    async activate(root?: string) {
      await postActivate(root ?? _projectRoot);
    },

    /**
     * Probe the server root to see if it is itself a site project. Used at startup to auto-detect
     * projects.
     */
    async probeRootProject() {
      try {
        const [projectRes, infoRes] = await Promise.all([
          fetch("/__studio/project"),
          fetch("/__studio/project-info?dir=."),
        ]);
        const meta = projectRes.ok
          ? await readJson<{ name: string; root: string }>(projectRes)
          : { name: "project", root: "." };
        const info = infoRes.ok
          ? await readJson<ProjectInfoReply>(infoRes)
          : { isSiteProject: false };
        return { info, meta };
      } catch {
        return null;
      }
    },

    // ─── Project creation ─────────────────────────────────────────────────

    /**
     * Scaffold a project at `destination.parent/directory`. The dev server refuses the request
     * outright when no destination is supplied — it will not fall back to its own root.
     */
    async createProject(opts: CreateProjectOptions) {
      const res = await fetch("/__studio/create-project", {
        body: JSON.stringify(opts),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const data = await readJson<ErrorBody>(res);
        throw new Error(problemDetail(data) ?? "Failed to create project");
      }
      return await res.json();
    },

    /** List starter templates from the dev server. */
    async listStarters(): Promise<StarterInfo[]> {
      const res = await fetch("/__studio/starters");
      if (!res.ok) {
        throw new Error("Failed to load starters");
      }
      return await readJson<StarterInfo[]>(res);
    },

    /** AI-guided site import: NDJSON progress stream from the dev server's import endpoint. */
    async importSite(
      opts: ImportSiteOptions,
      onProgress: (evt: ImportProgressEvent) => void,
      signal?: AbortSignal,
      onReady?: (evt: ImportReadyEvent) => void,
    ) {
      return await streamImport("/__studio/import-site", opts, onProgress, signal, onReady);
    },

    // ─── File operations ──────────────────────────────────────────────────

    /** @param {string} dir */
    async listDirectory(dir: string) {
      const res = await fetch(`/__studio/files?dir=${encodeURIComponent(serverPath(dir))}`);
      if (!res.ok) {
        throw new Error(`Failed to list directory: ${dir}`);
      }
      const entries = await readJson<DirEntry[]>(res);
      for (const e of entries) {
        e.path = stripRoot(e.path);
      }
      return entries;
    },

    /**
     * Read a file as text. A missing file still rejects, as the PAL says; it is only asked for with
     * `optional=1` (`specs/server.md` §4.1), so the absence arrives as a `null` body rather than a 404.
     * Studio probes for files it expects may be missing (a `.gitignore` per listed directory), and
     * a failed request per probe was console noise that read as a fault.
     *
     * @param {string} path
     */
    async readFile(path: string) {
      const res = await fetch(
        `/__studio/file?path=${encodeURIComponent(serverPath(path))}&optional=1`,
      );
      if (!res.ok) {
        throw new Error(`Failed to read file: ${path}`);
      }
      const data = await readJson<{ content: string | null }>(res);
      if (data.content === null) {
        throw new Error(`Failed to read file: ${path} (not found)`);
      }
      return data.content;
    },

    /**
     * Raw bytes, undecoded. Same-origin here, so the response body is simply the file.
     *
     * @param {string} path
     */
    async readFileBytes(path: string) {
      const res = await fetch(`/__studio/file/bytes?path=${encodeURIComponent(serverPath(path))}`);
      if (!res.ok) {
        throw new Error(`Failed to read file bytes: ${path}`);
      }
      return res.arrayBuffer();
    },

    /**
     * @param {string} path
     * @param {string} content
     */
    async writeFile(path: string, content: string) {
      const res = await fetch(`/__studio/file?path=${encodeURIComponent(serverPath(path))}`, {
        body: content,
        method: "PUT",
      });
      if (!res.ok) {
        throw new Error(`Failed to write file: ${path}`);
      }
    },

    /**
     * Upload a binary file (image, video, font, etc.).
     *
     * @param {string} path — project-relative destination path
     * @param {File | Blob | ArrayBuffer} data — file content
     */
    async uploadFile(path: string, data: string | File | Blob | ArrayBuffer) {
      const res = await fetch(
        `/__studio/file/upload?path=${encodeURIComponent(serverPath(path))}`,
        { body: data, method: "POST" },
      );
      if (!res.ok) {
        throw new Error(`Upload failed: ${path}`);
      }
      const body = await readJson<Partial<UploadResult>>(res);
      // The dev server echoes the path today; falling back to the request keeps a backend that says
      // Nothing working rather than writing `undefined` into a document.
      const uploaded: UploadResult = { path: body.path ?? path };
      if (body.size !== undefined) {
        uploaded.size = body.size;
      }
      return uploaded;
    },

    /** @param {string} path */
    async deleteFile(path: string) {
      const res = await fetch(`/__studio/file?path=${encodeURIComponent(serverPath(path))}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete file: ${path}`);
      }
    },

    /**
     * @param {string} from
     * @param {string} to
     */
    async renameFile(from: string, to: string): Promise<RenameResult> {
      const res = await fetch("/__studio/file/rename", {
        body: JSON.stringify({ from: serverPath(from), to: serverPath(to) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to rename: ${from} → ${to}`);
      }
      /* No strip on the way back: the route takes its paths in server space and answers in the
         project's (specs/server.md §4.1). Stripping an already-project-relative path is not merely
         redundant — it corrupts any path whose first segment happens to match the project root's
         own name, which a server-root-relative root makes reachable. */
      return readJson<RenameResult>(res);
    },

    /**
     * Where a file / component tag is used, over the same walker the rename above writes through.
     * The engine caches the sweep server-side and drops it from the dev server's own file watcher,
     * so the three renderings never disagree and never re-scan the project per keystroke.
     *
     * @param {{ path?: string; tagName?: string }} target
     */
    async findReferences(target: { path?: string; tagName?: string }): Promise<ReferencesResult> {
      await _activation;
      const params = new URLSearchParams();
      if (target.path) {
        params.set("path", serverPath(target.path));
      }
      if (target.tagName) {
        params.set("tag", target.tagName);
      }
      const res = await fetch(`/__studio/references?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to find references: ${target.path ?? target.tagName ?? ""}`);
      }
      // Project-relative on the way out, exactly as `renameFile` above receives it.
      return readJson<ReferencesResult>(res);
    },

    /**
     * Subscribe to filesystem change events over the dev server's SSE stream. Listens for the named
     * "fs" event (the preview iframe's default `onmessage` ignores it), strips paths to
     * project-relative, and drops events for sibling projects outside the active root.
     *
     * `EventSource` reconnects by itself, and the dev server does not replay what it sent while the
     * stream was down — a restarted `bun run dev` is the usual cause. So every `open` after the
     * first reports a `"reconnect"` resync: one re-list of the cached tree is cheap next to an
     * author editing a file the sidebar says is not there.
     */
    subscribeFileEvents(
      handler: (events: FsEvent[]) => void,
      options?: { onResync?: (reason: FsResyncReason) => void },
    ) {
      if (typeof EventSource === "undefined") {
        return () => {};
      }
      const es = new EventSource("/__reload");
      let opens = 0;
      es.addEventListener("open", () => {
        opens += 1;
        if (opens > 1) {
          // A reconnect is usually a restarted server, which comes back bound to no project.
          reclaimBinding();
          options?.onResync?.("reconnect");
        }
      });
      es.addEventListener("fs", (ev: MessageEvent<string>) => {
        let payload: FsEventBatch;
        try {
          /* SAFETY: `fs` events on /__reload are sent only by @jxsuite/server's watcher, as
             broadcastEvent("fs", { events }) over its batched FsEvent buffer (server watch.ts). */
          payload = JSON.parse(ev.data) as FsEventBatch;
        } catch {
          return;
        }
        const events: FsEvent[] = [];
        for (const e of payload.events ?? []) {
          const raw = e.path.replaceAll("\\", "/");
          if (_projectRoot && raw !== _projectRoot && !raw.startsWith(`${_projectRoot}/`)) {
            continue;
          }
          const path = stripRoot(raw);
          if (path && !path.startsWith("..")) {
            events.push({ isDir: e.isDir, path, type: e.type });
          }
        }
        if (events.length > 0) {
          handler(events);
        }
      });
      return () => {
        es.close();
      };
    },

    /**
     * Realtime co-editing over the dev server's /__studio/collab endpoint (rooms keyed by
     * server-root-relative path). Probes capability once — older servers without the endpoint
     * degrade to solo editing; the wire client's evaluation defers behind the dynamic import until
     * a doc opens.
     *
     * The same probe carries the subprotocol negotiation. A server that advertises no `protocols`
     * predates it and gets no offer, because an offer it cannot echo would fail the handshake
     * outright (RFC 6455 §4.1); a server that advertises an envelope this build does not speak is
     * refused here, where the reason can be said, rather than in a room where the two would merge
     * divergent histories.
     */
    async collab(docPath: string) {
      if (typeof WebSocket === "undefined" || typeof location === "undefined") {
        return null;
      }
      if (_collabProbe === null) {
        _collabProbe = fetch("/__studio/collab")
          .then(async (res) => (res.ok ? negotiateCollab(await readJson<JsonValue>(res)) : null))
          .catch(() => null);
      }
      const negotiation = await _collabProbe;
      if (negotiation === null) {
        return null;
      }
      if (negotiation.refused !== null) {
        console.warn(`Collaboration unavailable: ${negotiation.refused}`);
        return null;
      }
      const { offer } = negotiation;
      _collabConnection ??= (async () => {
        const { createWsCollabConnection } = await import("@jxsuite/collab/client");
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        return createWsCollabConnection({
          protocols: offer,
          url: `${scheme}://${location.host}/__studio/collab`,
        });
      })();
      const connection = await _collabConnection;
      return connection.openDoc(serverPath(docPath));
    },

    /** @param {string} _path */
    async createDirectory(_path: string) {
      // The server creates directories implicitly when writing files.
      // Write a placeholder and delete it, or rely on mkdir behavior.
      // For now, use the writeFile + delete approach if directory creation
      // Is explicitly needed. The server's writeFile already calls mkdir().
    },

    // ─── Component discovery ──────────────────────────────────────────────

    /** @param {string} dir */
    async discoverComponents(dir?: string) {
      const scanDir = dir || _projectRoot;
      if (!scanDir) {
        return [];
      }
      const url = `/__studio/components?dir=${encodeURIComponent(scanDir)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return [];
      }
      return await res.json();
    },

    // ─── Package management ──────────────────────────────────────────────

    /** @param {string} name */
    async addPackage(name: string) {
      const res = await fetch("/__studio/packages/add", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    /** @param {string} name */
    async removePackage(name: string) {
      const res = await fetch("/__studio/packages/remove", {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    async listPackages() {
      const res = await fetch("/__studio/packages");
      if (!res.ok) {
        return [];
      }
      return await res.json();
    },

    async installDependencies() {
      const res = await fetch("/__studio/packages/install", { method: "POST" });
      if (!res.ok) {
        return { log: await res.text(), ok: false };
      }
      return await res.json();
    },

    async dependenciesNeedInstall() {
      const res = await fetch("/__studio/packages/needs-install");
      if (!res.ok) {
        return false;
      }
      const data = await readJson<{ needsInstall?: boolean }>(res);
      return Boolean(data.needsInstall);
    },

    async packageVersions() {
      const res = await fetch("/__studio/packages/versions");
      if (!res.ok) {
        return [];
      }
      return await res.json();
    },

    /** @param {{ name: string; version: string; dev?: boolean }[]} updates */
    async setPackageVersions(updates: { name: string; version: string; dev?: boolean }[]) {
      const res = await fetch("/__studio/packages/set-versions", {
        body: JSON.stringify({ updates }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        return { log: await res.text(), ok: false };
      }
      return await res.json();
    },

    // ─── Code services (optional) ─────────────────────────────────────────

    /** Run one code-service action on the server; null when the route fails or is absent. */
    async codeService(action: string, payload: Parameters<StudioPlatform["codeService"]>[1]) {
      try {
        const res = await fetch(`/__studio/code/${action}`, {
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!res.ok) {
          return null;
        }
        return await res.json();
      } catch {
        return null;
      }
    },

    // ─── Site context resolution ──────────────────────────────────────

    /**
     * Given an absolute file path, walk up to find the nearest project.json ancestor. Returns {
     * sitePath, projectConfig } or { sitePath: null }.
     *
     * @param {string} filePath — absolute system path
     */
    async resolveSiteContext(filePath: string) {
      const res = await fetch(`/__studio/resolve-site?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        return { sitePath: null };
      }
      return await res.json();
    },

    // ─── File location ────────────────────────────────────────────────────

    /** @param {string} name */
    async locateFile(name: string) {
      try {
        const res = await fetch("/__studio/locate", {
          body: JSON.stringify({ name }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (res.ok) {
          const body = await readJson<{ path?: string }>(res);
          return body.path || null;
        }
      } catch {}
      return null;
    },

    /**
     * @param {string} query
     * @param {string[]} [extensions] — extra extensions beyond .json (from the format registry)
     */
    async searchFiles(query: string, extensions: string[] = []) {
      const exts = ["json", ...extensions.map((e: string) => e.replace(/^\./, ""))];
      const glob = `**/*${query}*.{${exts.join(",")}}`;
      const res = await fetch(
        `/__studio/files?dir=${encodeURIComponent(serverPath("."))}&glob=${encodeURIComponent(glob)}`,
      );
      if (!res.ok) {
        return [];
      }
      const entries = await readJson<DirEntry[]>(res);
      for (const e of entries) {
        e.path = stripRoot(e.path);
      }
      return entries;
    },

    // ─── Format registry ──────────────────────────────────────────────────

    /** List the project's registered format classes (auto-discovered from imports). */
    async listFormats() {
      const res = await fetch(`/__studio/formats?dir=${encodeURIComponent(serverPath("."))}`);
      if (!res.ok) {
        return [];
      }
      const body = await readJson<{ formats?: unknown[] }>(res);
      return body.formats ?? [];
    },

    /** The extensions payload riding beside `formats` on the same route. */
    async listExtensions(): Promise<ExtensionsInfo[]> {
      const res = await fetch(`/__studio/formats?dir=${encodeURIComponent(serverPath("."))}`);
      if (!res.ok) {
        return [];
      }
      const body = await readJson<{ extensions?: ExtensionsInfo[] }>(res);
      return body.extensions ?? [];
    },

    /**
     * What this backend can offer, enabled or not.
     *
     * Its own route rather than a field on `formats`: that one builds the project's registry and
     * fails when a declared extension does not resolve, which is exactly when a reader needs the
     * catalogue to repair it.
     */
    async listExtensionCatalog(): Promise<ExtensionCatalogEntry[]> {
      const res = await fetch(`/__studio/catalog?dir=${encodeURIComponent(serverPath("."))}`);
      return res.ok ? await readJson<ExtensionCatalogEntry[]>(res) : [];
    },

    /** Pre-bundled per-project entry schemas for Monaco registration (empty when unavailable). */
    async fetchProjectSchemas(): Promise<ProjectSchemasResponse> {
      const res = await fetch(
        `/__studio/project-schemas?dir=${encodeURIComponent(serverPath("."))}`,
      );
      if (!res.ok) {
        return {};
      }
      return await readJson<ProjectSchemasResponse>(res);
    },

    // ─── Data surface + secrets (owner console over /__studio/data/* + /__studio/secrets) ──

    /** Connector connections with configured state, table names, and provider metadata. */
    async dataConnections(): Promise<DataConnectionsResponse> {
      const res = await fetch(
        `/__studio/data/connections?dir=${encodeURIComponent(serverPath("."))}`,
      );
      if (!res.ok) {
        const data = await readJson<ErrorBody>(res);
        throw new Error(problemDetail(data) ?? "Failed to list connections");
      }
      return await readJson<DataConnectionsResponse>(res);
    },

    /** Probe one connection through the backend's connector registry. */
    async dataConnectionTest(connection: string): Promise<DataConnectionTestResult> {
      const res = await fetch(
        `/__studio/data/connections/test?dir=${encodeURIComponent(serverPath("."))}`,
        {
          body: JSON.stringify({ connection }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const data = await readJson<DataConnectionTestResult & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Connection test failed");
      }
      return data;
    },

    /** Additive schema push; `dryRun` compiles the plan without applying it. */
    async dataPush(opts?: { connection?: string; dryRun?: boolean }): Promise<DataPushResult> {
      const res = await fetch(`/__studio/data/push?dir=${encodeURIComponent(serverPath("."))}`, {
        body: JSON.stringify(opts ?? {}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await readJson<DataPushResult & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Schema push failed");
      }
      return data;
    },

    /** Page a table's rows with introspected column metadata. */
    async dataRows(query: DataRowsQuery): Promise<DataRowsResult> {
      const params = new URLSearchParams({ dir: serverPath("."), table: query.table });
      if (query.connection) {
        params.set("connection", query.connection);
      }
      if (query.limit !== undefined) {
        params.set("limit", String(query.limit));
      }
      if (query.offset !== undefined) {
        params.set("offset", String(query.offset));
      }
      if (query.orderBy !== undefined) {
        params.set("orderBy", query.orderBy);
      }
      if (query.dir !== undefined) {
        params.set("dir", query.dir);
      }
      const res = await fetch(`/__studio/data/rows?${params}`);
      const data = await readJson<DataRowsResult & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Failed to load rows");
      }
      return data;
    },

    async dataInsertRow(req: DataRowInsert): Promise<DataRowWrite> {
      const res = await fetch(`/__studio/data/rows?dir=${encodeURIComponent(serverPath("."))}`, {
        body: JSON.stringify(req),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await readJson<DataRowWrite & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Insert failed");
      }
      return data;
    },

    async dataUpdateRow(req: DataRowUpdate): Promise<DataRowWrite> {
      const res = await fetch(`/__studio/data/rows?dir=${encodeURIComponent(serverPath("."))}`, {
        body: JSON.stringify(req),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const data = await readJson<DataRowWrite & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Update failed");
      }
      return data;
    },

    async dataDeleteRow(req: DataRowDelete): Promise<{ ok: boolean }> {
      const params = new URLSearchParams({
        dir: serverPath("."),
        pk: String(req.pk),
        table: req.table,
      });
      if (req.connection) {
        params.set("connection", req.connection);
      }
      const res = await fetch(`/__studio/data/rows?${params}`, { method: "DELETE" });
      const data = await readJson<{ ok: boolean } & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Delete failed");
      }
      return data;
    },

    /** Configured secret env-var NAMES — never values. */
    async listSecrets(): Promise<string[]> {
      const res = await fetch(`/__studio/secrets?dir=${encodeURIComponent(serverPath("."))}`);
      if (!res.ok) {
        const data = await readJson<ErrorBody>(res);
        throw new Error(problemDetail(data) ?? "Failed to list secrets");
      }
      const data = await readJson<{ names: string[] }>(res);
      return data.names;
    },

    /** Write/remove secrets in the dev server's .dev.vars; names-only response. */
    async setSecrets(req: KeyValuePatch): Promise<SecretsSetResponse> {
      const res = await fetch(`/__studio/secrets?dir=${encodeURIComponent(serverPath("."))}`, {
        body: JSON.stringify(req),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const data = await readJson<SecretsSetResponse & ErrorBody>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Failed to write secrets");
      }
      return data;
    },

    /**
     * Invoke a format capability (parse/serialize) server-side.
     *
     * @param payload — { format, action, source?, doc?, options? }
     */
    async formatAction(payload: Parameters<NonNullable<StudioPlatform["formatAction"]>>[0]) {
      const res = await fetch("/__studio/format", {
        body: JSON.stringify({ ...payload, dir: serverPath(".") }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      /* The format route answers `{ result }` on success (the document a format class's `parse`
         built, or the text its `serialize` wrote) and a problem document otherwise. */
      const data = await readJson<JsonObject & { result: JxMutableNode | string }>(res);
      if (!res.ok) {
        throw new Error(problemDetail(data) ?? "Format action failed");
      }
      return data.result;
    },

    // ─── Plugin schema ────────────────────────────────────────────────────

    /**
     * @param {string} src
     * @param {string} prototype
     * @param {string} base
     */
    async fetchPluginSchema(src: string, prototype?: string, base?: string) {
      const params = new URLSearchParams({ src });
      if (prototype) {
        params.set("prototype", prototype);
      }
      if (base) {
        params.set("base", base);
      }
      const res = await fetch(`/__studio/plugin-schema?${params}`);
      if (!res.ok) {
        return null;
      }
      const { schema } = await readJson<{ schema: JsonValue }>(res);
      return schema;
    },

    // ─── Class resolution (dev-proxy) ─────────────────────────────────────

    async resolveClass(body: Parameters<NonNullable<StudioPlatform["resolveClass"]>>[0]) {
      const res = await fetch("/__jx_resolve__", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Class resolution failed: ${res.status}`);
      }
      return await readJson<JsonValue>(res);
    },

    // ─── Git operations ──────────────────────────────────────────────────

    async gitStatus() {
      const res = await fetch(gitRoute("status"));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    async gitBranches() {
      const res = await fetch(gitRoute("branches"));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    /** @param {number} [limit] */
    async gitLog(limit?: number) {
      const res = await fetch(gitRoute("log", limit ? { limit: String(limit) } : {}));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    /** @param {string[]} files */
    async gitStage(files: string[]) {
      const res = await fetch(gitRoute("stage"), {
        body: JSON.stringify({ files }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string[]} files */
    async gitUnstage(files: string[]) {
      const res = await fetch(gitRoute("unstage"), {
        body: JSON.stringify({ files }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string} message */
    async gitCommit(message: string) {
      const res = await fetch(gitRoute("commit"), {
        body: JSON.stringify({ message }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {{ setUpstream?: boolean }} [opts] */
    async gitPush(opts?: { setUpstream?: boolean }) {
      const res = await fetch(gitRoute("push"), {
        body: JSON.stringify(opts || {}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    async gitPull() {
      const res = await fetch(gitRoute("pull"), { method: "POST" });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    async gitFetch() {
      const res = await fetch(gitRoute("fetch"), { method: "POST" });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string} branch */
    async gitCheckout(branch: string) {
      const res = await fetch(gitRoute("checkout"), {
        body: JSON.stringify({ branch }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string} name */
    async gitCreateBranch(name: string) {
      const res = await fetch(gitRoute("create-branch"), {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string} [path] */
    async gitDiff(path?: string) {
      const res = await fetch(gitRoute("diff", { path: path ?? "" }));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return await res.json();
    },

    /** @param {{ path: string; ref?: string }} opts */
    async gitShow(opts: { path: string; ref?: string }) {
      const res = await fetch(
        gitRoute("show", opts.ref ? { path: opts.path, ref: opts.ref } : { path: opts.path }),
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await readJson<{ content: string }>(res);
      return data.content;
    },

    /** @param {string[]} files */
    async gitDiscard(files: string[]) {
      const res = await fetch(gitRoute("discard"), {
        body: JSON.stringify({ files }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    /** @param {string} url */
    async gitClone(url: string) {
      const res = await fetch(gitRoute("clone"), {
        body: JSON.stringify({ url }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
      return await res.json();
    },

    async gitInit() {
      const res = await fetch(gitRoute("init"), { method: "POST" });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
    },
    async buildSite() {
      const res = await fetch("/__studio/build", { method: "POST" });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemDetail(body) ?? "The site could not be built.");
      }
      return await readJson<SiteBuildResult>(res);
    },

    /**
     * Preview the working tree live, and point this project's open tab at a route.
     *
     * The dev server holds the same live origin the desktop launchers do, so the browser Studio
     * gets the same preview: composed on demand, unsaved edits included.
     */
    async previewSite(opts: { route: string }) {
      const res = await fetch("/__studio/preview", {
        body: JSON.stringify(opts),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemDetail(body) ?? "The site could not be previewed.");
      }
      return await readJson<SitePreviewResult>(res);
    },

    async setPreviewOverlay(path: string, contents: string) {
      await fetch("/__studio/preview/overlay", {
        body: JSON.stringify({ contents, path }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },

    async clearPreviewOverlay(path?: string) {
      await fetch("/__studio/preview/overlay", {
        body: JSON.stringify(path === undefined ? {} : { path }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
    },

    /**
     * @param {string} name
     * @param {string} url
     */
    async gitAddRemote(name: string, url: string) {
      const res = await fetch(gitRoute("add-remote"), {
        body: JSON.stringify({ name, url }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await readJson<ErrorBody>(res);
        throw new Error(problemMessage(body));
      }
    },

    // ─── Cloudflare publish surface (token-backed; see services/cf-settings) ─

    /**
     * Allowlisted Cloudflare API passthrough. The token comes from the client's cf-settings store
     * and rides in a header to the same-origin proxy (api.cloudflare.com is not CORS-enabled).
     */
    async cfApi(apiPath: string, init?: { method?: string; body?: unknown }) {
      const { getCfToken } = await import("../services/cf-settings");
      const token = getCfToken();
      if (!token) {
        throw new Error("No Cloudflare API token configured");
      }
      const res = await fetch("/__studio/cf/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CF-Token": token },
        body: JSON.stringify({ path: apiPath, method: init?.method ?? "GET", body: init?.body }),
      });
      const envelope = await readJson<CfProxyEnvelope>(res);
      if (!res.ok || envelope.success === false) {
        const message =
          envelope.errors?.map((e) => e.message).join("; ") ?? envelope.error ?? res.statusText;
        throw new Error(`Cloudflare API: ${message}`);
      }
      return envelope.result ?? envelope;
    },

    /** Verify the stored token by listing accounts; null when none/invalid. */
    async cfConnection() {
      const { getCfAccountId, getCfToken, setCfAccountId } =
        await import("../services/cf-settings");
      if (!getCfToken()) {
        return null;
      }
      try {
        const result = await this.cfApi("/accounts");
        if (!Array.isArray(result) || result.length === 0) {
          return { connected: false };
        }
        /* SAFETY: cfApi resolved the v4 envelope's `result`, and Cloudflare documents GET /accounts
           as answering an array of account objects, each with a string `id` and `name`. */
        const accounts = result as { id: string; name: string }[];
        const chosen = accounts.find((a) => a.id === getCfAccountId()) ?? accounts[0]!;
        setCfAccountId(chosen.id);
        return { connected: true, accountId: chosen.id, accountName: chosen.name };
      } catch {
        return { connected: false };
      }
    },

    // ─── Project catalogue ──────────────────────────────────────────────────

    /** Every site under the server root, from the /__studio/sites glob. */
    async listProjects() {
      const res = await fetch("/__studio/sites");
      if (!res.ok) {
        return [];
      }
      const sites = await readJson<SiteEntry[]>(res);
      return sites.map((site) => ({
        name: site.config?.name || site.path.split("/").at(-1) || site.path,
        root: site.path,
        description: site.path,
      }));
    },

    // ─── AI Assistant (Stack B: OpenAI-compatible SSE proxy) ───────────────────

    aiChatUrl() {
      return "/__studio/ai/chat";
    },
  };
}
