/**
 * platform.js — Desktop Platform Adapter (runs in webview)
 *
 * Implements the StudioPlatform interface by forwarding every call over
 * ElectroBun's RPC bridge to the Bun process handlers.
 *
 * See spec/desktop.md §7.2 for the design.
 */

import { Electroview } from "electrobun/view";

/**
 * Create the DesktopPlatform adapter and connect to the Bun process via RPC.
 *
 * Must be called early in the webview lifecycle, before Studio initializes.
 * Returns the platform object that should be passed to `registerPlatform()`.
 */
export function createDesktopPlatform() {
  // Set up webview-side RPC — handles incoming messages from Bun
  const rpc = Electroview.defineRPC({
    handlers: {
      requests: {},
      messages: {
        /** @param {{ path: string }} payload */
        fileChanged: (payload) => {
          // Future: trigger file tree refresh or document reload
          console.log("[desktop] File changed:", payload.path);
        },
      },
    },
  });

  // Connect to the Bun process WebSocket
  new Electroview({ rpc });

  return {
    id: /** @type {"desktop"} */ ("desktop"),

    // ─── Project opening ────────────────────────────────────────────────

    async openProject() {
      const result = await rpc.request.openProject();
      return result;
    },

    /**
     * Probe the current project root for site-project characteristics.
     * In desktop mode, the project is always opened via openProject(), so
     * this returns the already-loaded state. Kept for API compatibility
     * with the devserver adapter.
     */
    async probeRootProject() {
      try {
        const content = await rpc.request.readFile({ path: "site.json" });
        const config = JSON.parse(content);
        return {
          meta: { root: ".", name: config.name || "project" },
          info: {
            isSiteProject: true,
            siteConfig: config,
            directories: [],
          },
        };
      } catch {
        return {
          meta: { root: ".", name: "project" },
          info: { isSiteProject: false, siteConfig: null, directories: [] },
        };
      }
    },

    // ─── File operations ────────────────────────────────────────────────

    /** @param {string} dir */
    async listDirectory(dir) {
      return rpc.request.listDirectory({ dir });
    },

    /** @param {string} path */
    async readFile(path) {
      return rpc.request.readFile({ path });
    },

    /**
     * @param {string} path
     * @param {string} content
     */
    async writeFile(path, content) {
      return rpc.request.writeFile({ path, content });
    },

    /** @param {string} path */
    async deleteFile(path) {
      return rpc.request.deleteFile({ path });
    },

    /**
     * @param {string} from
     * @param {string} to
     */
    async renameFile(from, to) {
      return rpc.request.renameFile({ from, to });
    },

    /** @param {string} path */
    async createDirectory(path) {
      return rpc.request.createDirectory({ path });
    },

    // ─── Component discovery ────────────────────────────────────────────

    /** @param {string} [dir] */
    async discoverComponents(dir) {
      return rpc.request.discoverComponents({ dir });
    },

    // ─── Code services ──────────────────────────────────────────────────

    /**
     * @param {string} action
     * @param {unknown} payload
     */
    async codeService(action, payload) {
      return rpc.request.codeService({ action, payload });
    },

    // ─── File location ──────────────────────────────────────────────────

    /** @param {string} name */
    async locateFile(name) {
      return rpc.request.locateFile({ name });
    },

    // ─── Plugin schema ──────────────────────────────────────────────────

    /**
     * @param {string} src
     * @param {string} [prototype]
     * @param {string} [base]
     */
    async fetchPluginSchema(src, prototype, base) {
      return rpc.request.fetchPluginSchema({ src, prototype, base });
    },
  };
}
