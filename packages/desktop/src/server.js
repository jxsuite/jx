/**
 * Server.js — Embedded HTTP server for the Jx Studio desktop app.
 *
 * Wraps @jxsuite/server's createDevServer with:
 *
 * - Watch disabled (no SSE live-reload in production)
 * - A middleware that intercepts /studio/* requests and serves them directly from the bundled app
 *   views directory (PATHS.VIEWS_FOLDER) rather than the user's project root
 *
 * The @jxsuite/server default handlers still take care of:
 *
 * - /__studio/* studio filesystem API (read/write project files)
 * - /**jx_resolve** $src / $prototype module proxy
 * - /**jx_server** timing:"server" function proxy
 */

import { join } from "node:path";
import { createDevServer } from "@jxsuite/server";

/**
 * @param {string} viewsDir PATHS.VIEWS_FOLDER from the main process — where bundled studio assets
 *   live inside the app bundle.
 * @param {string} projectRoot The user's Jx project directory to serve and edit.
 */
export async function startStudioServer(viewsDir, projectRoot) {
  const server = await createDevServer({
    root: projectRoot,
    port: 0, // let the OS assign a free port
    watch: false, // no SSE live-reload in the packaged app
    builds: [],

    middleware: async (/** @type {Request} */ req, /** @type {URL} */ url) => {
      const path = url.pathname;

      // Serve bundled studio assets (HTML + compiled JS/CSS) from the app bundle.
      // All other paths fall through to the standard @jxsuite/server handlers.
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
