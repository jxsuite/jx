import { join, resolve } from "node:path";
import { createDevServer } from "@jxsuite/server";
import { getProjectRoot } from "./handlers";

export async function startStudioServer(
  viewsDir: string,
  projectRoot: string,
): Promise<{ port: number }> {
  const server = await createDevServer({
    root: projectRoot,
    port: 0,
    watch: false,
    builds: [],

    middleware: async (req: Request, url: URL) => {
      const path = url.pathname;

      if (path.startsWith("/studio/")) {
        const assetPath = join(viewsDir, path);
        const file = Bun.file(assetPath);
        if (await file.exists()) {
          return new Response(file);
        }
      }

      // Serve files from the active project's public/ directory at root level
      const root = getProjectRoot();
      if (root) {
        const publicFile = Bun.file(resolve(root, "public", "." + path));
        if (await publicFile.exists()) {
          return new Response(publicFile);
        }
      }

      return null;
    },
  });

  return server as { port: number };
}
