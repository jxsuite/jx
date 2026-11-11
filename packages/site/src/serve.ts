/**
 * Turning one request into a response, on an origin that serves a project as a site.
 *
 * The decision order mirrors what a published site does with the same URL, which is the whole
 * contract of serving on an origin of its own: a path is a FILE if the tree has one there, and a
 * ROUTE otherwise. Getting that order wrong in either direction is visible — a `pages/` document
 * served as JSON instead of rendered, or a `/favicon.svg` answered with someone's index page.
 *
 * A host's own surfaces — a runtime bundle, a reload stream — are NOT a lane here. They are
 * dispatched before this function is reached, because a namespace only that host knows about is not
 * a fact about the site. What a host may add is a {@link ServeOptions.fallback}, tried after routes
 * and before the 404, which is where a lane like on-demand npm bundling belongs: it answers paths a
 * site legitimately asks for that this package cannot produce.
 */

import { withoutServerScript } from "@jxsuite/schema/document-scripts";
import { isJsonObject } from "@jxsuite/schema/guards";
import { isJxnPath, parseJxn } from "@jxsuite/schema/jxn";
import { errorMessage } from "@jxsuite/schema/parse";
import { candidatePaths, contentTypeFor, normalizeRequestPath } from "./paths.ts";
import { ComposeError, composeRoute, readProjectConfig, routeTable } from "./compose.ts";
import type { PageRoute, SiteIO } from "./compose.ts";
import { pageShell, problemShell } from "./shell.ts";
import type { ShellOptions } from "./shell.ts";
import type { JsonValue, JxDocument, ProjectConfig } from "@jxsuite/schema/types";

/** Reading bytes for a servable file — separate from {@link SiteIO} because assets are binary. */
export interface AssetIO {
  /**
   * The file's bytes, or null when the tree cannot produce them.
   *
   * ArrayBuffer-backed because they become a `Response` body as they are: a view over a
   * `SharedArrayBuffer` is not a `BodyInit`.
   */
  bytes: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>;
}

/** One working tree, seen through both of the readers a site origin is handed. */
export interface SiteTree {
  io: SiteIO;
  assets: AssetIO;
}

/** What this origin knows about a project, computed once per request. */
export interface SiteContext {
  config: ProjectConfig;
  routes: PageRoute[];
}

/** How a host wants pages shelled, and what it can answer that this package cannot. */
export interface ServeOptions {
  shell: ShellOptions;
  /** Tried after routes and before the 404 — a host's own lane for site-legitimate paths. */
  fallback?: (requestPath: string) => Promise<Response | null>;
}

/** Headers every response from this origin carries, whatever it is serving. */
export function siteHeaders(contentType: string) {
  return {
    /* Never cached. A composed page is a function of a working tree that changes under it, and it
       is not revalidatable — there is no version of it to compare against. */
    "Cache-Control": "private, no-store",
    "Content-Type": contentType,
    /* A live render is a working copy, and an indexed one would compete with the site the author
       actually publishes. */
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    /* The origin this was reached from is nobody else's business — and on a desktop machine the
       referring origin is an editor holding a token. */
    "Referrer-Policy": "same-origin",
  };
}

/** Read the project's configuration and route table out of the tree. */
export async function siteContext(io: SiteIO): Promise<SiteContext> {
  return { config: await readProjectConfig(io), routes: routeTable(io.paths()) };
}

/** A plain 404, for when neither the tree nor the project has anything to say. */
function plainNotFound(): Response {
  return new Response("Not found", {
    headers: siteHeaders("text/plain; charset=utf-8"),
    status: 404,
  });
}

/**
 * Serve one path.
 *
 * @param {string} pathname - The request path, still URL-encoded
 * @param {SiteIO} io - Reads the working tree's text
 * @param {AssetIO} assets - Reads a servable file's bytes
 * @param {SiteContext} context - The project's configuration and route table
 * @param {ServeOptions} options - The shell contract, and the host's own fallback lane
 */
export async function serveSite(
  pathname: string,
  io: SiteIO,
  assets: AssetIO,
  context: SiteContext,
  options: ServeOptions,
): Promise<Response> {
  const requestPath = normalizeRequestPath(pathname);
  if (requestPath === null) {
    return plainNotFound();
  }

  // A file the tree really has, at the path the published site would serve it from.
  for (const candidate of candidatePaths(requestPath)) {
    const bytes = await assets.bytes(candidate);
    if (bytes && isJxnPath(candidate)) {
      return jxnAsJson(bytes, candidate);
    }
    if (bytes) {
      return new Response(isJsonPath(candidate) ? jsonForReader(bytes) : bytes, {
        headers: siteHeaders(contentTypeFor(candidate)),
      });
    }
  }

  const page = await composeSafely(io, context, pathname, options.shell);
  if (page) {
    return page;
  }

  const fallback = await options.fallback?.(requestPath);
  if (fallback) {
    return fallback;
  }

  /* The project's own 404, at 404 — the same thing a built site serves, because a reader who
     mistypes a URL should see the site's answer and not ours. */
  const notFound = await composeSafely(io, context, "/404", options.shell);
  if (notFound) {
    return new Response(await notFound.text(), {
      headers: siteHeaders("text/html; charset=utf-8"),
      status: 404,
    });
  }
  return plainNotFound();
}

/** A path naming a JSON file. */
const JSON_PATH = /\.json$/iu;

function isJsonPath(path: string): boolean {
  return JSON_PATH.test(path);
}

/** The key a document's own modules are under, as a JSON file spells it. */
const SCRIPT_KEY = '"$script"';

/**
 * A `.json` file as a reader may have it: a document's server module left out (`spec.md` §23.2),
 * and every other file exactly the bytes it is.
 *
 * A file is parsed only when its text names `$script`, so an ordinary one is never read as
 * anything, and one that does not parse is served as it is: what is wrong with it is the author's
 * to see, and it holds no module this could have found.
 *
 * @param bytes The file.
 */
function jsonForReader(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | string {
  const text = new TextDecoder().decode(bytes);
  if (!text.includes(SCRIPT_KEY)) {
    return bytes;
  }
  let value: JsonValue;
  try {
    /* SAFETY: trust boundary. The file parsed as JSON, which is all the type says; it is used
       below only after it is seen to be an object. */
    value = JSON.parse(text) as JsonValue;
  } catch {
    return bytes;
  }
  if (!isJsonObject(value)) {
    return bytes;
  }
  /* SAFETY: every member of `JxDocument` is optional and `withoutServerScript` reads only
     `$script`, through optional access, so any JSON object is a document as far as it looks. */
  const document = value as JxDocument;
  const stripped = withoutServerScript(document);
  return stripped === document ? bytes : JSON.stringify(stripped);
}

/**
 * Compose a route into a response, turning a compose failure into a page that says so.
 *
 * A render that 500s tells the author nothing they can act on. A page naming the file and the
 * reason is the difference between "the preview is broken" and "this page needs a `.json` layout".
 */
/**
 * A `.jxn` file, as the JSON a reader expects.
 *
 * The runtime fetches a `$ref` and calls `res.json()`, on any origin, so answering JSON here keeps
 * a KDL parser out of every page. A file that does not read answers 422 with the reason, because
 * the runtime reports a failed fetch by its status and this one is the author's to fix. The dev
 * server's canvas origin answers the same way, with its own headers. The document's server module
 * is left out, as it is from a `.json` document (`spec.md` §23.2).
 *
 * @param bytes The file.
 * @param path Its path, which names it in an error.
 * @param headers The headers for a response of a media type.
 */
export function jxnAsJson(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
  headers: (type: string) => HeadersInit = siteHeaders,
): Response {
  try {
    const document = withoutServerScript(parseJxn(new TextDecoder().decode(bytes), path));
    return Response.json(document, { headers: headers("application/json;charset=utf-8") });
  } catch (error) {
    return new Response(errorMessage(error), {
      headers: headers("text/plain;charset=utf-8"),
      status: 422,
    });
  }
}

async function composeSafely(
  io: SiteIO,
  context: SiteContext,
  pathname: string,
  shell: ShellOptions,
): Promise<Response | null> {
  let page;
  try {
    page = await composeRoute(io, context.routes, context.config, pathname);
  } catch (error) {
    if (error instanceof ComposeError) {
      return new Response(problemShell(error.message), {
        headers: siteHeaders("text/html; charset=utf-8"),
        status: 500,
      });
    }
    throw error;
  }
  if (!page) {
    return null;
  }
  return new Response(pageShell(page, shell), {
    headers: siteHeaders("text/html; charset=utf-8"),
  });
}
