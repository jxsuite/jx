import { join } from "node:path";
import { createDevServer } from "@jxsuite/server";

export async function startStudioServer(viewsDir: string, projectRoot: string) {
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

      return null;
    },
  });

  return server;
}
