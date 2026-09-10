/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { Electroview } from "electrobun/view";
import { html, render as litRender } from "lit-html";
import { streamImport } from "@jxsuite/studio/import-client";
import { toBase64 } from "@jxsuite/studio/base64";
import type { RecentProjectEntry, StudioRPC } from "./rpc-schema";
import type {
  DataRowDelete,
  DataRowInsert,
  DataRowUpdate,
  DataRowsQuery,
  SecretsSetRequest,
  SettingsPatch,
} from "@jxsuite/protocol";
import type {
  CreateProjectDestination,
  ImportProgressEvent,
  ImportReadyEvent,
  ImportSiteOptions,
  StudioPlatform,
} from "@jxsuite/studio/types";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { FsEventPayload } from "@jxsuite/server/refactor";
import { setPreviewNavigateHandler } from "@jxsuite/studio/preview-navigate";

/* Returns an INFERRED type, not `StudioPlatform`, with `satisfies` doing the conformance check. The
   desktop adds `updater` and `windowControls`, which the PAL interface deliberately does not declare
   — the studio reaches them through `globalThis.__jxPlatform` with its own local shapes (see
   resize-edges.ts, toolbar.ts) so it stays launcher-agnostic. Annotating the return as
   `StudioPlatform` erased them from every caller, including this package's own tests. */
export function createDesktopPlatform() {
  // The studio sidebar's live-sync subscriber, if any. Set via subscribeFileEvents below.
  let fileEventHandler: ((events: FsEventPayload[]) => void) | null = null;
  /** The settings kernel's subscriber, so another window's change reaches this one. */
  let settingsHandler: ((settings: Record<string, string>) => void) | null = null;
  const rpc = Electroview.defineRPC<StudioRPC>({
    handlers: {
      messages: {
        fileChanged: (payload) => {
          console.log("[desktop] File changed:", payload.path);
        },
        onFileEvents: (payload) => {
          fileEventHandler?.(payload.events);
        },
        settingsChanged: (payload) => {
          settingsHandler?.(payload.settings);
        },
        updateReady: (payload) => {
          showUpdateToast(payload.version, rpc);
        },
      },
      requests: {},
    },
    maxRequestTime: 300_000,
  });

  /*
   * Preview link clicks go to the user's REAL browser, not this webview.
   *
   * Following a link in Preview exists to see the page behave like the deployed thing — routing,
   * history, devtools. A webview with no address bar is not that, and navigating THIS one would
   * replace the editor. The Bun side hands the URL to the OS (`Utils.openExternal`); on failure the
   * studio's own `window.open` default still applies.
   */
  setPreviewNavigateHandler((url) => {
    const fallback = () => {
      window.open(url, "_blank", "noopener,noreferrer");
    };
    /* `{ ok: false }` is a REFUSAL, not a rejection — the backend answers the request either way,
       and branching only on a thrown error left the click doing nothing at all when the OS had no
       opener for it. */
    void rpc.request
      .openExternal({ url })
      .then((result) => {
        if (!result?.ok) {
          fallback();
        }
      })
      .catch(fallback);
  });

  const electroview = new Electroview({ rpc });
  void electroview;

  const originalFetch = window.fetch.bind(window);
  (window as unknown as Record<string, unknown>).fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // Route the runtime's dev-proxy endpoints through RPC. The runtime POSTs to relative
    // "/__jx_resolve__" (class resolution) and "/__jx_server__" (server functions); under the
    // views:// protocol these would otherwise resolve to a missing view resource.
    let pathname = url;
    try {
      ({ pathname } = new URL(url, location.href));
    } catch {}
    if (pathname === "/__jx_resolve__" || pathname === "/__jx_server__") {
      const body = init?.body != null ? String(init.body) : "{}";
      const handler =
        pathname === "/__jx_server__" ? rpc.request.jxServerFunction : rpc.request.jxResolve;
      try {
        const { status, body: resBody } = await handler({ body });
        return new Response(resBody, {
          headers: { "content-type": "application/json" },
          status,
        });
      } catch (error) {
        return Response.json(
          { error: String(error) },
          {
            headers: { "content-type": "application/json" },
            status: 500,
          },
        );
      }
    }

    return originalFetch(input, init);
  };

  // ─── Global MutationObserver: resolve relative asset URLs everywhere ────────
  // Catches <img src>, <video src>, <source src>, <video poster> in any part of
  // The DOM (canvas, panels, dropdowns, etc.) so we don't need per-component fixes.
  //
  // The shell document lives on views://; a relative PANEL asset src there does not resolve to a
  // Servable URL, so the observer rewrites it to ${loopbackOrigin()}/<path> — an absolute URL on the
  // Per-window loopback server (a cross-origin <img> load, which needs NO CORS). loopbackOrigin() is
  // The canvas origin from platform.canvasUrl (always set once activate() resolves); if it is not yet
  // Resolved at boot, the observer no-ops that one mutation rather than rewriting it.
  function loopbackOrigin(): string | null {
    const { canvasUrl } = platform;
    if (!canvasUrl) {
      return null;
    }
    try {
      const { protocol, origin } = new URL(canvasUrl, location.href);
      return protocol === "http:" || protocol === "https:" ? origin : null;
    } catch {
      return null;
    }
  }

  function resolveElementAssets(el: Element) {
    const tag = el.tagName;
    if (tag !== "IMG" && tag !== "VIDEO" && tag !== "SOURCE") {
      return;
    }

    for (const attr of ["src", "poster"]) {
      const val = el.getAttribute(attr);
      if (
        val &&
        !val.startsWith("data:") &&
        !val.startsWith("blob:") &&
        !val.startsWith("http") &&
        !val.startsWith("views://")
      ) {
        const origin = loopbackOrigin();
        if (!origin) {
          // The canvas origin isn't resolved yet (pre-activate) — leave this mutation untouched.
          continue;
        }
        // Point the panel <img> straight at the loopback server (a cross-origin image load,
        // Allowed without CORS).
        const path = val.replace(/^\.?\//, "");
        el.setAttribute(attr, `${origin}/${path}`);
      }
    }
  }

  function resolveBackgroundImage(el: Element) {
    const htmlEl = el as HTMLElement;
    if (!htmlEl.style) {
      return;
    }
    const bg = htmlEl.style.backgroundImage;
    if (!bg) {
      return;
    }
    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (!match) {
      return;
    }
    const [, val] = match;
    if (val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("http")) {
      return;
    }
    const origin = loopbackOrigin();
    if (!origin) {
      // The canvas origin isn't resolved yet (pre-activate) — leave this mutation untouched.
      return;
    }
    // Rewrite the background-image url() to the loopback origin (a cross-origin image load).
    const path = val.replace(/^\.?\//, "");
    htmlEl.style.backgroundImage = `url(${origin}/${path})`;
  }

  function resolveAllAssets(el: Element) {
    resolveElementAssets(el);
    resolveBackgroundImage(el);
    for (const child of el.querySelectorAll("img[src], video[src], source[src], video[poster]")) {
      resolveElementAssets(child);
    }
    for (const child of el.querySelectorAll("[style]")) {
      resolveBackgroundImage(child);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) {
            continue;
          }
          resolveAllAssets(node as Element);
        }
      } else if (mutation.type === "attributes") {
        const el = mutation.target as Element;
        if (mutation.attributeName === "style") {
          resolveBackgroundImage(el);
        } else {
          resolveElementAssets(el);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    attributeFilter: ["src", "poster", "style"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  const platform = {
    id: "desktop" as const,

    /* New projects go where the user says: the modal's Location field, with Browse… backed by the
       native dialog below. The backend refuses a create without one. */
    createDestination: "path" as const,

    projectRoot: "",

    /**
     * The cross-origin loopback canvas URL for this window, fetched in {@link activate} (awaited at
     * studio boot, before the first canvas mount). The iframe-host resolves the iframe `src`
     * against it, and the asset observer rewrites relative panel asset srcs to this origin.
     */
    canvasUrl: undefined as string | undefined,
    /* This window's loopback port, so the url is not known until activate() has asked for it over
       RPC. Declared so the iframe host waits rather than mounting the bundle-relative fallback —
       which under views:// now RESOLVES, to a canvas.html this app really stages, and would boot
       the canvas inside the shell's app-privileged origin in a CEF instance running
       disable-site-isolation-trials. The cross-origin loopback canvas exists so that cannot
       happen. Chromium sets canvasUrl synchronously and needs none of this. */
    canvasUrlDeferred: true,

    async activate() {
      // Request this window's loopback canvas URL over RPC (kills the preload/executeJavascript
      // Race), so it's set before the first canvas mount and the asset observer's first rewrite.
      try {
        const { canvasUrl } = await rpc.request.getCanvasUrl();
        platform.canvasUrl = canvasUrl ?? undefined;
      } catch (error) {
        console.warn("getCanvasUrl RPC failed; canvas falls back to the default URL:", error);
      }
      // Synchronous initial sweep AFTER canvasUrl resolves: imgs mounted before activate() awaited
      // Carry relative srcs (a stray views:// request). Rewrite them to the loopback origin now
      // Instead of waiting for the next mutation, then drain any records the observer already
      // Batched pre-activate so they aren't reprocessed. Wrapped so a sweep failure can't break
      // Activate.
      try {
        if (loopbackOrigin()) {
          resolveAllAssets(document.documentElement);
          observer.takeRecords();
        }
      } catch (error) {
        console.warn("initial asset sweep failed:", error);
      }
    },

    async openProject() {
      const res = await rpc.request.openProject();
      return res;
    },

    async pickProject() {
      return rpc.request.pickProject();
    },

    // ─── Multi-window ──────────────────────────────────────────────────────────

    async openProjectInNewWindow(root: string) {
      return rpc.request.openProjectInNewWindow({ root });
    },

    async newWindow() {
      await rpc.request.newWindow();
    },

    async setWindowProject(root: string) {
      return rpc.request.setWindowProject({ root });
    },

    async getProjectRoot() {
      return rpc.request.getProjectRoot();
    },

    // ─── Recent projects (process-shared, user-level store) ─────────────────────

    async getRecentProjects() {
      return rpc.request.getRecentProjects();
    },

    async saveRecentProjects(projects: RecentProjectEntry[]) {
      await rpc.request.saveRecentProjects({ projects });
    },

    // ─── User settings (process-shared, user-level store) ───────────────────────

    async getSettings() {
      return rpc.request.getSettings();
    },

    async patchSettings(patch: SettingsPatch) {
      return rpc.request.patchSettings({ patch });
    },

    subscribeSettings(handler: (settings: Record<string, string>) => void) {
      settingsHandler = handler;
      return () => {
        settingsHandler = null;
      };
    },

    async probeRootProject() {
      // A fresh welcome window owns a session with no project root. Report "no project" (null) so the
      // Studio shows the welcome screen — returning a phantom non-site project instead would suppress
      // The welcome screen and trigger a spurious "No project open" error from listFormats.
      let root: string | null = null;
      try {
        ({ root } = await rpc.request.getProjectRoot());
      } catch {
        root = null;
      }
      if (!root) {
        return null;
      }
      try {
        const content = await rpc.request.readFile({ path: "project.json" });
        const config = JSON.parse(content as string) as ProjectConfig;
        // `root` (the absolute backend root) is already resolved above and is the re-openable key.
        return {
          info: {
            directories: [] as string[],
            isSiteProject: true as const,
            projectConfig: config,
          },
          meta: { name: config.name || "project", root },
        };
      } catch {
        return {
          info: {
            directories: [] as string[],
            isSiteProject: false as const,
            projectConfig: null,
          },
          meta: { name: "project", root: "." },
        };
      }
    },

    async resolveSiteContext(filePath: string) {
      return rpc.request.resolveSiteContext({ filePath });
    },

    async listDirectory(dir: string) {
      return rpc.request.listDirectory({ dir });
    },

    async readFile(path: string) {
      return rpc.request.readFile({ path });
    },

    async writeFile(path: string, content: string) {
      return rpc.request.writeFile({ content, path });
    },

    // The RPC transport JSON-serializes params, so binary must be base64 before it goes on the wire
    // (a File/Blob would serialize to `{}`); the backend base64-decodes. A string passes through.
    async uploadFile(path: string, data: string | File | Blob | ArrayBuffer) {
      return await rpc.request.uploadFile({ data: await toBase64(data), path });
    },

    async deleteFile(path: string) {
      return rpc.request.deleteFile({ path });
    },

    async renameFile(from: string, to: string) {
      return rpc.request.renameFile({ from, to });
    },

    async findReferences(target: { path?: string; tagName?: string }) {
      return rpc.request.findReferences(target);
    },

    subscribeFileEvents(handler: (events: FsEventPayload[]) => void) {
      fileEventHandler = handler;
      return () => {
        if (fileEventHandler === handler) {
          fileEventHandler = null;
        }
      };
    },

    async createDirectory(path: string) {
      return rpc.request.createDirectory({ path });
    },

    async discoverComponents(dir?: string) {
      return rpc.request.discoverComponents({ ...(dir != null && { dir }) });
    },

    async codeService(action: string, payload: unknown) {
      return rpc.request.codeService({ action, payload });
    },

    async locateFile(name: string) {
      return rpc.request.locateFile({ name });
    },

    async fetchPluginSchema(src: string, prototype?: string, base?: string) {
      return rpc.request.fetchPluginSchema({
        src,
        ...(prototype != null && { prototype }),
        ...(base != null && { base }),
      });
    },

    async gitStatus() {
      return rpc.request.gitStatus();
    },

    async gitBranches() {
      return rpc.request.gitBranches();
    },

    async gitLog(limit?: number) {
      return rpc.request.gitLog({ ...(limit != null && { limit }) });
    },

    async gitStage(files: string[]) {
      return rpc.request.gitStage({ files });
    },

    async gitUnstage(files: string[]) {
      return rpc.request.gitUnstage({ files });
    },

    async gitCommit(message: string) {
      return rpc.request.gitCommit({ message });
    },

    async gitPush(opts?: { setUpstream?: boolean }) {
      return rpc.request.gitPush(opts || {});
    },

    async gitPull() {
      return rpc.request.gitPull();
    },

    async gitFetch() {
      return rpc.request.gitFetch();
    },

    async gitCheckout(branch: string) {
      return rpc.request.gitCheckout({ branch });
    },

    async gitCreateBranch(name: string) {
      return rpc.request.gitCreateBranch({ name });
    },

    async gitDiff(path?: string) {
      return rpc.request.gitDiff({ ...(path != null && { path }) });
    },

    async gitDiscard(files: string[]) {
      return rpc.request.gitDiscard({ files });
    },

    async gitShow(opts: { path: string; ref?: string }) {
      return rpc.request.gitShow(opts);
    },

    async gitInit() {
      await rpc.request.gitInit();
    },

    async buildSite() {
      return rpc.request.buildSite();
    },

    async previewSite(opts: { route: string }) {
      return rpc.request.previewSite(opts);
    },

    async setPreviewOverlay(path: string, contents: string) {
      await rpc.request.setPreviewOverlay({ contents, path });
    },

    async clearPreviewOverlay(path?: string) {
      await rpc.request.clearPreviewOverlay(path === undefined ? {} : { path });
    },

    async gitAddRemote(name: string, url: string) {
      await rpc.request.gitAddRemote({ name, url });
    },

    async searchFiles(query: string, extensions?: string[]) {
      return rpc.request.searchFiles({ query, ...(extensions != null && { extensions }) });
    },

    async listFormats() {
      return rpc.request.listFormats();
    },

    /** The extensions payload behind descriptor-contributed settings sections. */
    async listExtensions() {
      return rpc.request.listExtensions();
    },
    async listExtensionCatalog() {
      return rpc.request.listExtensionCatalog();
    },

    /** Pre-bundled per-project entry schemas for Monaco registration. */
    async fetchProjectSchemas() {
      return rpc.request.fetchProjectSchemas();
    },

    // ─── Data surface + secrets (owner console; names-only secrets) ────────────

    async dataConnections() {
      return rpc.request.dataConnections();
    },

    async dataConnectionTest(connection: string) {
      return rpc.request.dataConnectionTest({ connection });
    },

    async dataPush(opts?: { connection?: string; dryRun?: boolean }) {
      return rpc.request.dataPush(opts ?? {});
    },

    async dataRows(query: DataRowsQuery) {
      return rpc.request.dataRows(query);
    },

    async dataInsertRow(req: DataRowInsert) {
      return rpc.request.dataInsertRow(req);
    },

    async dataUpdateRow(req: DataRowUpdate) {
      return rpc.request.dataUpdateRow(req);
    },

    async dataDeleteRow(req: DataRowDelete) {
      return rpc.request.dataDeleteRow(req);
    },

    async listSecrets() {
      const res = await rpc.request.listSecrets();
      return res.names;
    },

    async setSecrets(req: SecretsSetRequest) {
      return rpc.request.setSecrets(req);
    },

    /**
     * Class resolution via the shared dev-proxy pipeline (the same handler the canvas runtime
     * reaches through the fetch patch above), called directly over RPC.
     *
     * @param {Record<string, unknown>} body
     */
    async resolveClass(body: Record<string, unknown>) {
      const { status, body: resBody } = await rpc.request.jxResolve({
        body: JSON.stringify(body),
      });
      if (status >= 400) {
        throw new Error(`Class resolution failed: ${status}`);
      }
      return JSON.parse(resBody) as unknown;
    },

    /** @param {Record<string, unknown>} payload */
    async formatAction(payload: Record<string, unknown>) {
      return rpc.request.formatAction(
        payload as { format: string; action: string; source?: string },
      );
    },

    async addPackage(name: string) {
      return rpc.request.addPackage({ name });
    },

    async removePackage(name: string) {
      return rpc.request.removePackage({ name });
    },

    async listPackages() {
      return rpc.request.listPackages();
    },

    async installDependencies() {
      return rpc.request.installDependencies();
    },

    async dependenciesNeedInstall() {
      return rpc.request.dependenciesNeedInstall();
    },

    async packageVersions() {
      return rpc.request.packageVersions();
    },

    async setPackageVersions(updates: { name: string; version: string; dev?: boolean }[]) {
      return rpc.request.setPackageVersions({ updates });
    },

    /* One request, composed on the Bun side. It used to be assembled here from two updater calls,
       which made the About screen's contents a property of THIS launcher's webview rather than of
       the build it describes — so the chromium launcher, which has no updater to call, could not
       answer the question at all. */
    async getAppInfo() {
      return rpc.request.appInfo();
    },

    async createProject(opts: {
      name: string;
      description?: string;
      url?: string;
      adapter?: string;
      directory: string;
      /* The full PAL union, not just the `path` variant: the parameter is contravariant, so
         narrowing it here makes the whole platform object unassignable to StudioPlatform. What
         actually keeps Studio from sending a repo destination is `createDestination: "path"`. */
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
        throw new Error(
          "The desktop app creates projects on disk; repo destinations are cloud-only",
        );
      }
      return rpc.request.createProject({ ...opts, destination }) as Promise<{
        root: string;
        config: ProjectConfig;
      }>;
    },

    async listStarters() {
      return rpc.request.listStarters();
    },

    async pickDirectory() {
      const result = await rpc.request.pickDirectory();
      return result.path;
    },

    // AI-guided site import: streams NDJSON progress from the token-gated shared local server. The
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
      const endpoint = (await rpc.request.importSiteUrl()) as string;
      return streamImport(endpoint, opts, onProgress, signal, onReady);
    },

    /*
     * GitHub sign-in, launcher-only like `updater` and `windowControls`: the browser Studio has no
     * loopback server to redirect to and keeps the device flow, so this is not a PAL member.
     */
    githubAuth: {
      signIn: (force = false) => rpc.request.githubSignIn({ force }),
      signOut: () => rpc.request.githubSignOut(),
      status: () => rpc.request.githubToken(),
    },

    updater: {
      applyUpdate: () => rpc.request.updaterApplyUpdate(),
      checkForUpdate: () => rpc.request.updaterCheckForUpdate(),
      downloadUpdate: () => rpc.request.updaterDownloadUpdate(),
      getLocalInfo: () => rpc.request.updaterGetLocalInfo(),
      getStatus: () => rpc.request.updaterGetStatus(),
    },

    windowControls: {
      close: () => rpc.request.windowClose(),
      getFrame: () => rpc.request.windowGetFrame(),
      maximize: () => rpc.request.windowMaximize(),
      minimize: () => rpc.request.windowMinimize(),
      setFrame: (x: number, y: number, w: number, h: number) =>
        rpc.request.windowSetFrame({ height: h, width: w, x, y }),
    },

    // AI Assistant (Stack B: absolute SSE proxy URL from the shared local server, via RPC)
    async aiChatUrl() {
      return rpc.request.aiChatUrl() as Promise<string>;
    },
  };

  /* `satisfies` on the identifier, not on the literal above: a fresh object literal gets excess
     property checks, which would reject the two launcher-only extras this function exists to expose.
     A reference is not fresh, so this checks conformance and keeps the inferred type. */
  return platform satisfies StudioPlatform;
}

/**
 * The "an update is ready" notice, in the kit rather than in Spectrum.
 *
 * `jx-toast-host`, `jx-toast` and `jx-button` are `@jxsuite/ui` elements, and this webview has them
 * because it hosts the studio bundle, whose `registerKit()` defines the kit into this document.
 * Nothing here imports the kit and nothing needs to: an un-upgraded custom element is an ordinary
 * unknown element that upgrades the moment its definition arrives, so a notice raised before the
 * studio bundle has finished loading still draws itself when it does.
 *
 * That is the same relationship the `<sp-toast>` this replaces had with Spectrum's registry — and
 * it is why `platform.test.ts` holds these three tag names to the kit's own `KIT_TAGS`. The
 * Spectrum version was written against a registry no manifest in this package declared, so a rename
 * on the other side would have drawn nothing here with nothing going red.
 *
 * **The notice is sticky and it does not claim the stack's key.** `timeout="0"` because an update
 * the reader has not answered is not an outcome that may retire itself, and `hotkey=""` because
 * Studio's own toast stack lives in this same document and owns `F8`: two hosts listening for one
 * key on one document would each move focus to their own first control, and the reader's press
 * would land wherever the last listener ran. Nothing is lost by declining it, because a sticky
 * toast cannot expire before a reader reaches it. `live="polite"` is kept, unlike Studio's stack —
 * that one is silent because `services/notify.ts` announces every record through its own announcer,
 * and this notice is not one of those records, so this host is the only thing that can speak it.
 *
 * @param version The version that has been downloaded and is waiting for a restart.
 * @param rpc The webview's RPC handle, for the restart itself.
 */
function showUpdateToast(version: string, rpc: { request: { updaterApplyUpdate: () => unknown } }) {
  const container = document.createElement("div");
  container.className = "update-toast-container";
  /* A toast that retires itself takes its wrapper with it. The element writes its own `open` back
     to false when the reader dismisses it or uses the recovery control, and the wrapper would
     otherwise sit in the body for the rest of the session — one more per update message. `close` is
     dispatched only when the ELEMENT decided (ui.md §5.2), so this can never answer a removal this
     code performed itself. */
  const onClose = () => container.remove();
  litRender(
    html`
      <jx-toast-host label="Software updates" live="polite" hotkey="" @close=${onClose}>
        <jx-toast open variant="info" timeout="0" dismiss-label="Dismiss update notice">
          Version ${version} is ready
          <jx-button
            slot="action"
            variant="accent"
            size="sm"
            @click=${() => rpc.request.updaterApplyUpdate()}
          >
            Restart to update
          </jx-button>
        </jx-toast>
      </jx-toast-host>
    `,
    container,
  );
  document.body.append(container);
}
