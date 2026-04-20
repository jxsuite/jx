/**
 * @example
 *   import { createDevServer } from "@jxplatform/server";
 *
 *   await createDevServer({
 *   root: import.meta.dir,
 *   builds: [{ entrypoints: ["./src/app.js"], outdir: "./dist", match: /src/, label: "app" }],
 *   });
 *
 *   jxplatform/server — Jx development server
 *
 *   Provides builds, live reload, $src module proxying, timing: "server" function
 *   proxying, and studio filesystem integration as a single createDevServer() call.
 */

import { resolve, join } from "node:path";
import { buildAll } from "./build.js";
import { createWatcher, injectSSE } from "./watch.js";
import { handleResolve, handleServerFunction } from "./resolve.js";
import { handleStudioApi } from "./studio-api.js";
import { handleCodeApi } from "./code-api.js";
import { existsSync, readFileSync } from "node:fs";

/**
 * Resolve an npm-style bare specifier from a URL path via node_modules. Handles scoped packages
 * (@scope/pkg/subpath) and respects package.json exports. Strips leading directory segments (e.g.
 * /pages/@scope/pkg/file → @scope/pkg/file).
 *
 * @param {string} root - Absolute project root
 * @param {string} urlPath - URL pathname (e.g. "/pages/@jxplatform/parser/Foo.class.json")
 * @returns {string | null} Absolute file path or null
 */
function resolveNpmPath(root, urlPath) {
  const segments = urlPath.split("/").filter(Boolean);

  // Find the @scope segment — everything from there is the bare specifier
  let start = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startsWith("@")) {
      start = i;
      break;
    }
  }
  if (start < 0 || start + 1 >= segments.length) return null;

  const scope = segments[start];
  const pkg = segments[start + 1];
  const subpath = segments.slice(start + 2).join("/");
  const pkgDir = join(root, "node_modules", scope, pkg);
  const pkgJsonPath = join(pkgDir, "package.json");

  if (!existsSync(pkgJsonPath)) return null;

  // If there's a subpath, check package.json exports first
  if (subpath) {
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      const exportKey = `./${subpath}`;
      if (pkgJson.exports && pkgJson.exports[exportKey]) {
        const mapped = join(pkgDir, pkgJson.exports[exportKey]);
        if (existsSync(mapped)) return mapped;
      }
    } catch {}
    // Fall back to direct path
    const direct = join(pkgDir, subpath);
    if (existsSync(direct)) return direct;
  }

  return null;
}

/**
 * Create and start a Jx development server.
 *
 * @param {object} options
 * @param {string} options.root - Project root (absolute or relative)
 * @param {number} [options.port] - Server port. Default is `3000`
 * @param {{
 *   entrypoints: string[];
 *   outdir: string;
 *   match?: Function | RegExp;
 *   label?: string;
 * }[]} [options.builds]
 *   - Bun.build entries with optional match regex
 * @param {boolean | object} [options.watch] - Watch config or false to disable. Default is `true`
 * @param {boolean} [options.studio] - Enable /**studio/* endpoints. Default is `true`
 * @param {Function} [options.middleware] - Custom route handler (req, url) => Response|null
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
      if (!(await file.exists())) {
        // Resolve npm-style bare specifiers via node_modules
        // e.g. /pages/@scope/pkg/file.json → node_modules/@scope/pkg (+ exports map)
        const resolved = resolveNpmPath(absRoot, path);
        if (resolved) {
          const nmFile = Bun.file(resolved);
          if (await nmFile.exists()) return new Response(nmFile);
        }
        return new Response("Not found", { status: 404 });
      }

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
