import { Electroview } from "electrobun/view";
import type { StudioRPC } from "./rpc-schema";

export function createDesktopPlatform() {
  const rpc = Electroview.defineRPC<StudioRPC>({
    maxRequestTime: 30000,
    handlers: {
      requests: {},
      messages: {
        fileChanged: (payload) => {
          console.log("[desktop] File changed:", payload.path);
        },
      },
    },
  });

  new Electroview({ rpc });

  return {
    id: "desktop" as const,

    async openProject() {
      return rpc.request.openProject();
    },

    async probeRootProject() {
      try {
        const content = await rpc.request.readFile({ path: "project.json" });
        const config = JSON.parse(content as string);
        return {
          meta: { root: ".", name: config.name || "project" },
          info: {
            isSiteProject: true,
            projectConfig: config,
            directories: [],
          },
        };
      } catch {
        return {
          meta: { root: ".", name: "project" },
          info: { isSiteProject: false, projectConfig: null, directories: [] },
        };
      }
    },

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

    async discoverComponents(dir?: string) {
      return rpc.request.discoverComponents({ dir });
    },

    async codeService(action: string, payload: unknown) {
      return rpc.request.codeService({ action, payload });
    },

    async locateFile(name: string) {
      return rpc.request.locateFile({ name });
    },

    async fetchPluginSchema(src: string, prototype?: string, base?: string) {
      return rpc.request.fetchPluginSchema({ src, prototype, base });
    },
  };
}
