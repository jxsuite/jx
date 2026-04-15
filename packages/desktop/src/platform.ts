/**
 * platform.ts — Desktop Platform Adapter (runs in webview)
 *
 * Implements the StudioPlatform interface by forwarding every call over
 * ElectroBun's RPC bridge to the Bun process handlers.
 *
 * See spec/desktop.md §7.2 for the design.
 */

import { Electroview } from "electrobun/view";
import { BrowserView } from "electrobun/bun";
import type { StudioRPCSchema } from "./rpc-schema.ts";

/**
 * Create the DesktopPlatform adapter and connect to the Bun process via RPC.
 *
 * Must be called early in the webview lifecycle, before Studio initializes.
 * Returns the platform object that should be passed to `registerPlatform()`.
 */
export function createDesktopPlatform() {
  // Set up webview-side RPC — handles incoming messages from Bun
  const rpc = Electroview.defineRPC<StudioRPCSchema>({
    handlers: {
      requests: {},
      messages: {
        fileChanged: (payload) => {
          // Future: trigger file tree refresh or document reload
          console.log("[desktop] File changed:", payload.path);
        },
      },
    },
  });

  // Connect to the Bun process WebSocket
  const view = new Electroview({ rpc });

  return {
    id: "desktop" as const,

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
      // The desktop app always has a project root set at startup.
      // Try to read site.json to detect if it's a site project.
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

    async listDirectory(dir: string) {
      return rpc.request.listDirectory({ dir });
    },

    async readFile(path: string) {
      return rpc.request.readFile({ path });
    },

    async writeFile(path: string, content: string) {
      return rpc.request.writeFile({ path, content });
    },

    async deleteFile(path: string) {
      return rpc.request.deleteFile({ path });
    },

    async renameFile(from: string, to: string) {
      return rpc.request.renameFile({ from, to });
    },

    async createDirectory(path: string) {
      return rpc.request.createDirectory({ path });
    },

    // ─── Component discovery ────────────────────────────────────────────

    async discoverComponents(dir?: string) {
      return rpc.request.discoverComponents({ dir });
    },

    // ─── Code services ──────────────────────────────────────────────────

    async codeService(action: string, payload: unknown) {
      return rpc.request.codeService({ action, payload });
    },

    // ─── File location ──────────────────────────────────────────────────

    async locateFile(name: string) {
      return rpc.request.locateFile({ name });
    },

    // ─── Plugin schema ──────────────────────────────────────────────────

    async fetchPluginSchema(src: string, prototype?: string, base?: string) {
      return rpc.request.fetchPluginSchema({ src, prototype, base });
    },
  };
}
