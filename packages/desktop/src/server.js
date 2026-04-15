/**
 * server.js — Embedded HTTP server for the JSONsx Studio desktop app.
 *
 * Wraps @jsonsx/server's createDevServer with:
 *   - watch disabled (no SSE live-reload in production)
 *   - a middleware that intercepts /studio/* requests and serves them
 *     directly from the bundled app views directory (PATHS.VIEWS_FOLDER)
 *     rather than the user's project root
 *
 * The @jsonsx/server default handlers still take care of:
 *   - /__studio/*        studio filesystem API (read/write project files)
 *   - /__jsonsx_resolve__  $src / $prototype module proxy
 *   - /__jsonsx_server__   timing:"server" function proxy
 */

import { join } from "node:path";
import { createDevServer } from "@jsonsx/server";

/**
 * @param {string} viewsDir   PATHS.VIEWS_FOLDER from the main process — where bundled
 *                             studio assets live inside the app bundle.
 * @param {string} projectRoot  The user's JSONsx project directory to serve and edit.
 */
export async function startStudioServer(viewsDir, projectRoot) {
  const server = await createDevServer({
    root: projectRoot,
    port: 0,       // let the OS assign a free port
    watch: false,  // no SSE live-reload in the packaged app
    builds: [],

    middleware: async (/** @type {Request} */ req, /** @type {URL} */ url) => {
      const path = url.pathname;

      // Serve bundled studio assets (HTML + compiled JS/CSS) from the app bundle.
      // All other paths fall through to the standard @jsonsx/server handlers.
      if (path.startsWith("/studio/")) {
        const assetPath = join(viewsDir, path);
        const file = Bun.file(assetPath);
        if (await file.exists()) {
          return new Response(file);
        }
      }

      return null; // fall through to default handlers
    },
  });

  return server;
}
