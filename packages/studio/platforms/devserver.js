/**
 * devserver.js — Dev Server Platform Adapter
 *
 * Implements the StudioPlatform interface for the @jsonsx/server development
 * workflow. All file I/O goes through /__studio/* REST endpoints. Project
 * opening uses the Chrome File System Access API (showDirectoryPicker).
 *
 * See spec/desktop.md §8 for the full specification.
 */

/**
 * Create a DevServerPlatform instance.
 *
 * The adapter is stateless apart from `_projectRoot`, which tracks the
 * server-relative project directory (e.g. "examples/site-demo"). All
 * paths passed INTO PAL methods are project-relative; the adapter
 * prefixes them with `_projectRoot` before hitting the server, and
 * strips the prefix from responses.
 */
export function createDevServerPlatform() {
  let _projectRoot = ".";

  /** Prefix a project-relative path with the active project root for server API calls. */
  function serverPath(rel) {
    if (!_projectRoot || _projectRoot === ".") return rel;
    return rel === "." ? _projectRoot : `${_projectRoot}/${rel}`;
  }

  /** Strip the project root prefix from a server-root-relative path. */
  function stripRoot(path) {
    if (!_projectRoot || _projectRoot === ".") return path;
    return path.startsWith(_projectRoot + "/") ? path.slice(_projectRoot.length + 1) : path;
  }

  return {
    id: "devserver",

    /** Get or set the current project root (server-relative path). */
    get projectRoot() { return _projectRoot; },
    set projectRoot(v) { _projectRoot = v || "."; },

    // ─── Project opening ──────────────────────────────────────────────────

    async openProject() {
      // Use Chrome's showDirectoryPicker API
      if (!("showDirectoryPicker" in window)) {
        throw new Error("showDirectoryPicker not available — use a Chromium-based browser");
      }

      let dirHandle;
      try {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (e) {
        // User cancelled the picker
        if (e.name === "AbortError") return null;
        throw e;
      }

      // Read site.json from the chosen directory
      let siteHandle;
      try {
        siteHandle = await dirHandle.getFileHandle("site.json");
      } catch {
        throw new Error("No site.json found in selected folder");
      }

      const file = await siteHandle.getFile();
      const config = JSON.parse(await file.text());

      // Resolve server-relative path by matching against known sites
      const sitesRes = await fetch("/__studio/sites");
      if (!sitesRes.ok) throw new Error("Failed to fetch site list from server");
      const sites = await sitesRes.json();
      const match = sites.find(s => JSON.stringify(s.config) === JSON.stringify(config));

      if (!match) {
        throw new Error("Selected project is not under the dev server root");
      }

      _projectRoot = match.path;

      return {
        config,
        handle: {
          root: match.path,
          name: config.name || match.path.split("/").pop(),
          siteConfig: config,
        },
      };
    },

    /**
     * Probe the server root to see if it is itself a site project.
     * Used at startup to auto-detect projects.
     */
    async probeRootProject() {
      try {
        const [projectRes, infoRes] = await Promise.all([
          fetch("/__studio/project"),
          fetch("/__studio/project-info?dir=."),
        ]);
        const meta = projectRes.ok ? await projectRes.json() : { root: ".", name: "project" };
        const info = infoRes.ok ? await infoRes.json() : { isSiteProject: false };
        return { meta, info };
      } catch {
        return null;
      }
    },

    // ─── File operations ──────────────────────────────────────────────────

    async listDirectory(dir) {
      const res = await fetch(`/__studio/files?dir=${encodeURIComponent(serverPath(dir))}`);
      if (!res.ok) throw new Error(`Failed to list directory: ${dir}`);
      const entries = await res.json();
      for (const e of entries) e.path = stripRoot(e.path);
      return entries;
    },

    async readFile(path) {
      const res = await fetch(`/__studio/file?path=${encodeURIComponent(serverPath(path))}`);
      if (!res.ok) throw new Error(`Failed to read file: ${path}`);
      const data = await res.json();
      return data.content;
    },

    async writeFile(path, content) {
      const res = await fetch(`/__studio/file?path=${encodeURIComponent(serverPath(path))}`, {
        method: "PUT",
        body: content,
      });
      if (!res.ok) throw new Error(`Failed to write file: ${path}`);
    },

    async deleteFile(path) {
      const res = await fetch(`/__studio/file?path=${encodeURIComponent(serverPath(path))}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) throw new Error(`Failed to delete file: ${path}`);
    },

    async renameFile(from, to) {
      const res = await fetch("/__studio/file/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: serverPath(from), to: serverPath(to) }),
      });
      if (!res.ok) throw new Error(`Failed to rename: ${from} → ${to}`);
    },

    async createDirectory(path) {
      // The server creates directories implicitly when writing files.
      // Write a placeholder and delete it, or rely on mkdir behavior.
      // For now, use the writeFile + delete approach if directory creation
      // is explicitly needed. The server's writeFile already calls mkdir().
    },

    // ─── Component discovery ──────────────────────────────────────────────

    async discoverComponents(dir) {
      const scanDir = dir || _projectRoot;
      const url = scanDir === "." ? "/__studio/components" : `/__studio/components?dir=${encodeURIComponent(scanDir)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      return await res.json();
    },

    // ─── Code services (optional) ─────────────────────────────────────────

    async codeService(action, payload) {
      try {
        const res = await fetch(`/__studio/code/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },

    // ─── File location ────────────────────────────────────────────────────

    async locateFile(name) {
      try {
        const res = await fetch("/__studio/locate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (res.ok) return (await res.json()).path || null;
      } catch {}
      return null;
    },

    // ─── Plugin schema ────────────────────────────────────────────────────

    async fetchPluginSchema(src, prototype, base) {
      const params = new URLSearchParams({ src });
      if (prototype) params.set("prototype", prototype);
      if (base) params.set("base", base);
      const res = await fetch(`/__studio/plugin-schema?${params}`);
      if (!res.ok) return null;
      const { schema } = await res.json();
      return schema;
    },
  };
}
