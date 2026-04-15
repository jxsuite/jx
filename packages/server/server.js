/**
 * @jxplatform/server — Jx development server
 *
 * Provides builds, live reload, $src module proxying, timing: "server" function
 * proxying, and studio filesystem integration as a single createDevServer() call.
 *
 * @example
 * import { createDevServer } from '@jxplatform/server';
 *
 * await createDevServer({
 *   root: import.meta.dir,
 *   builds: [
 *     { entrypoints: ['./src/app.js'], outdir: './dist', match: /src/, label: 'app' },
 *   ],
 * });
 */

import { resolve } from "node:path";
import { buildAll } from "./build.js";
import { createWatcher, injectSSE } from "./watch.js";
import { handleResolve, handleServerFunction } from "./resolve.js";
import { handleStudioApi } from "./studio-api.js";
import { handleCodeApi } from "./code-api.js";

/**
 * Create and start a Jx development server.
 *
 * @param {object} options
 * @param {string}   options.root           - Project root (absolute or relative)
 * @param {number}   [options.port=3000]    - Server port
 * @param {Array<{ entrypoints: string[], outdir: string, match?: Function|RegExp, label?: string }>}    [options.builds=[]]    - Bun.build entries with optional match regex
 * @param {boolean|object} [options.watch=true]  - Watch config or false to disable
 * @param {boolean}  [options.studio=true]  - Enable /__studio/* endpoints
 * @param {Function} [options.middleware]    - Custom route handler (req, url) => Response|null
 * @returns {Promise<object>} The Bun.serve server object
 */
export async function createDevServer(options) {
  const {
    root,
    port = 3000,
    builds = [],
    watch = true,
    studio: enableStudio = true,
    middleware,
  } = options;

  if (!root) throw new Error("@jxplatform/server: root is required");
  const absRoot = resolve(root);

  // ─── Build pipeline ─────────────────────────────────────────────────────────

  if (builds.length > 0) {
    await buildAll(builds);
  }

  // ─── File watcher + SSE ─────────────────────────────────────────────────────

  let handleSSE = null;
  if (watch !== false) {
    const watchOpts = typeof watch === "object" ? watch : {};
    const watcher = createWatcher(absRoot, builds, watchOpts);
    handleSSE = watcher.handleSSE;
  }

  // ─── HTTP server ────────────────────────────────────────────────────────────

  const server = Bun.serve({
    port,

    async fetch(req) {
      const url = new URL(req.url);
      let path = url.pathname;
      if (path.endsWith("/")) path += "index.html";
      else if (path === "") path = "/index.html";

      // SSE live reload
      if (handleSSE && path === "/__reload") {
        return handleSSE();
      }

      // $prototype + $src proxy
      if (path === "/__jx_resolve__" && req.method === "POST") {
        return handleResolve(req, absRoot);
      }

      // timing: "server" function proxy
      if (path === "/__jx_server__" && req.method === "POST") {
        return handleServerFunction(req, absRoot);
      }

      // Studio filesystem API
      if (enableStudio && path.startsWith("/__studio/")) {
        const codeRes = await handleCodeApi(req, url);
        if (codeRes) return codeRes;

        const res = await handleStudioApi(req, url, absRoot);
        if (res) return res;
      }

      // Custom middleware
      if (middleware) {
        const res = await middleware(req, url);
        if (res) return res;
      }

      // Static files
      const file = Bun.file(resolve(absRoot, "." + path));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });

      if (handleSSE && path.endsWith(".html")) {
        const html = await file.text();
        return new Response(injectSSE(html), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response(file);
    },
  });

  console.log(`\n@jxplatform/server listening on http://localhost:${server.port}`);

  return server;
}
