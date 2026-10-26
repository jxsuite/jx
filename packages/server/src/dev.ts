/**
 * Dev-server CLI entry — what `jx dev` spawns under Bun in a standalone project.
 *
 * Usage: bun @jxsuite/server/dev [--root <dir>] [--port <n>]
 *
 * For a site project (a project.json at the root), the entry builds the site up front, serves the
 * built pages from dist/ ahead of the static-source fallback, and rebuilds before each live-reload
 * broadcast so the browser always reloads into fresh output. Argument parsing and the middleware
 * factory are exported for tests; the server boot runs only when executed directly
 * (import.meta.main).
 *
 * @module @jxsuite/server/dev
 */

import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, normalize, resolve, sep } from "node:path";
import { errorMessage } from "@jxsuite/schema/parse";
import type { JsonObject } from "@jxsuite/schema/types";
import { projectDevEnv } from "./dev-vars.ts";
import { problem } from "./problem.ts";
import { callServerExport } from "./resolve.ts";
import { createDevServer } from "./server.ts";
import { injectSSE } from "./watch.ts";

export interface DevArgs {
  port: number;
  root: string;
}

/**
 * Parse `--root`/`--port` (plus an optional positional root) into dev-server options.
 *
 * @param {string[]} argv - Raw arguments (process.argv.slice(2))
 * @returns {DevArgs} Resolved root and port (default 3000)
 */
export function parseDevArgs(argv: string[]): DevArgs {
  let root = ".";
  let port = 3000;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--root") {
      index += 1;
      root = argv[index] ?? root;
    } else if (arg === "--port") {
      index += 1;
      const parsed = Math.trunc(Number(argv[index] ?? ""));
      if (Number.isFinite(parsed) && parsed >= 0) {
        port = parsed;
      }
    } else if (!arg.startsWith("--")) {
      root = arg;
    }
  }
  return { port, root: resolve(root) };
}

/**
 * Middleware serving built pages from `<root>/dist` for page-like GET requests. Directory URLs
 * (with or without a trailing slash) map to their index.html; anything not present in dist falls
 * through to the dev server's static-source handling.
 *
 * @param {string} root - Absolute project root
 * @returns {(req: Request, url: URL) => Response | null}
 */
export function createDistMiddleware(
  root: string,
): (req: Request, url: URL) => Promise<Response | null> {
  const distDir = join(root, "dist");
  return async (req, url) => {
    if (req.method !== "GET") {
      return null;
    }
    const safe = normalize(decodeURIComponent(url.pathname)).replaceAll("\\", "/");
    const candidate = resolve(distDir, `.${safe.startsWith("/") ? safe : `/${safe}`}`);
    if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
      return null;
    }
    let filePath: string | null = null;
    if (existsSync(candidate)) {
      filePath = statSync(candidate).isDirectory() ? join(candidate, "index.html") : candidate;
    } else {
      filePath = join(candidate, "index.html");
    }
    if (!filePath || !existsSync(filePath)) {
      return null;
    }
    // Built pages get the live-reload client, like the server's own .html responses
    if (filePath.endsWith(".html")) {
      const html = await Bun.file(filePath).text();
      return new Response(injectSSE(html), {
        headers: { "Cache-Control": "no-cache", "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(Bun.file(filePath), { headers: { "Cache-Control": "no-cache" } });
  };
}

/** One server entry the last build collected: the export, and where the site worker imports it from. */
export interface ServerEntry {
  exportName: string;
  /** A `./` path from the project root, or a bare specifier, exactly as the worker bundle reads it. */
  src: string;
}

/** The route every server function is served at, before the deployment base `server.ts` strips. */
const SERVER_FUNCTION_ROUTE = "/_jx/server/";

/**
 * The arguments object a call posted. The worker reads its body the same way: anything that is not
 * JSON is an empty argument object, so a function never sees the failure of a malformed request.
 */
async function readArguments(req: Request): Promise<JsonObject> {
  try {
    /* SAFETY: trust boundary. The body is whatever JSON the caller posted, and a compiled page posts
       the entry's `arguments` object. The function receives it exactly as the worker passes it. */
    return (await req.json()) as JsonObject;
  } catch {
    return {};
  }
}

/**
 * Middleware that stands in for the site worker's server-function routes (server.md §2): answers
 * `POST /_jx/server/<export>` for each entry the last build collected, and `null` for anything
 * else, so the request falls through to the next middleware.
 *
 * It answers as the worker does, because a built page calls both the same way: the function's
 * return value as JSON, `null` for `undefined`, and `{ ok: false, error }` with status 500 when it
 * cannot be called. The function receives `env` as the extension mounts do (`projectDevEnv`:
 * `process.env` under the project's `.dev.vars`), so it reads the same secrets in development.
 *
 * Each module is resolved as the worker bundle resolves it, from the project root: a `./` path
 * against the root, any other specifier through the project's own `package.json`. It applies no
 * containment check, because the module path comes from the build and never from the request;
 * containment stays in the `/__jx_server__` proxy, where the request names the module.
 *
 * @param {string} root - Absolute project root
 * @param {() => readonly ServerEntry[]} entries - The last build's collected entries, read per
 *   request
 * @returns {(req: Request, url: URL) => Promise<Response | null>}
 */
export function createServerFunctionMiddleware(
  root: string,
  entries: () => readonly ServerEntry[],
): (req: Request, url: URL) => Promise<Response | null> {
  const requireFromProject = createRequire(resolve(root, "package.json"));
  return async (req, url) => {
    if (req.method !== "POST" || !url.pathname.startsWith(SERVER_FUNCTION_ROUTE)) {
      return null;
    }
    const name = url.pathname.slice(SERVER_FUNCTION_ROUTE.length);
    const entry = entries().find((candidate) => candidate.exportName === name);
    if (!entry) {
      return problem("notFound", `The last build collected no server function "${name}"`);
    }

    let modulePath: string;
    try {
      modulePath =
        entry.src.startsWith("./") || entry.src.startsWith("../")
          ? resolve(root, entry.src)
          : requireFromProject.resolve(entry.src);
    } catch (error) {
      return Response.json({ error: errorMessage(error), ok: false }, { status: 500 });
    }

    const args = await readArguments(req);
    const result = await callServerExport(modulePath, entry.exportName, args, projectDevEnv(root));
    if (result.ok) {
      return Response.json(result.value ?? null);
    }
    return Response.json({ error: result.message, ok: false }, { status: 500 });
  };
}

export interface DevServerHandle {
  port: number;
  stop: () => void;
}

/**
 * Boot the dev server for a root. Site projects (a project.json at the root) are built up front and
 * rebuilt before every live-reload broadcast, with built pages served from dist/.
 *
 * @param {DevArgs} args - Resolved root and port
 * @returns {Promise<DevServerHandle>} The listening server
 */
export async function startDev({ port, root }: DevArgs): Promise<DevServerHandle> {
  const isSite = existsSync(join(root, "project.json"));

  let building = Promise.resolve();
  // What the last build collected, which the server-function route answers from.
  let serverEntries: readonly ServerEntry[] = [];
  const rebuild = () => {
    building = building.then(async () => {
      const { buildSite } = await import("@jxsuite/compiler/site");
      const result = await buildSite(root, { verbose: false });
      ({ serverEntries } = result);
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error(`  build error: ${err}`);
        }
      }
    });
    return building;
  };

  if (isSite) {
    console.log(`Building ${root}...`);
    await rebuild();
  }

  // The built pages call the site worker's routes, and `jx dev` has no worker, so it answers them
  // From the entries the last build collected, ahead of the built pages.
  const serverFunctions = createServerFunctionMiddleware(root, () => serverEntries);
  const distPages = createDistMiddleware(root);
  const siteMiddleware = async (req: Request, url: URL) =>
    (await serverFunctions(req, url)) ?? (await distPages(req, url));

  /* SAFETY: createDevServer always calls Bun.serve with a hostname and TCP port, never a unix
     socket, so the returned Server's `port` (typed `number | undefined` for the socket case) is a
     number; its promise-returning `stop()` satisfies `() => void`. */
  return (await createDevServer({
    port,
    root,
    ...(isSite && {
      middleware: siteMiddleware,
      watch: { preReload: () => rebuild(), reloadOnAnyChange: true },
    }),
  })) as DevServerHandle;
}

if (import.meta.main) {
  const { port, root } = parseDevArgs(process.argv.slice(2));
  const server = await startDev({ port, root });
  console.log(`Jx dev server running at http://localhost:${server.port} (root: ${root})`);
}
