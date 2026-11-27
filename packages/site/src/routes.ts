/**
 * File-based routing — the one definition of what URL a page file has.
 *
 * The rules in this file (spec `site-architecture.md` §4) had been written down three times: the
 * compiler's `fileToRoute` inside `pages-discovery.ts`, a mirror in the studio's `page-params.ts`
 * whose own docblock admitted it was a mirror, and — the moment a Worker needed to answer the same
 * question — very nearly a third. Nothing kept the copies in agreement, and a route is exactly the
 * kind of rule where a silent disagreement is a page that 404s in one surface and renders in
 * another.
 *
 * It lives HERE rather than in `@jxsuite/compiler` for the reason `resolveI18n` does (`i18n.ts`):
 * the compiler's dependency graph carries a native addon and `esbuild`, so neither a browser bundle
 * nor a Cloudflare Worker can import it. This module is pure string math with no imports at all, so
 * every host that has to know what `/blog/:slug` means can share one answer.
 */

/** Bracket route segments: `[param]` (named) and `[...param]` (catch-all). */
const PARAM_SEGMENT = /\[\.\.\.(\w+)\]|\[(\w+)\]/g;

/** What a page file's path says about its route, before anything is read from the file. */
export interface FileRoute {
  /** URL pattern with parameters, e.g. `/blog/:slug` or `/docs/*`. */
  urlPattern: string;
  /** Parameter names in declaration order, e.g. `["slug"]`. */
  params: string[];
  /** True when the pattern carries any parameter. */
  isDynamic: boolean;
  /** True when the pattern ends in a `[...rest]` spread. */
  isCatchAll: boolean;
}

/**
 * A page path with any addressing prefix removed, ready for {@link fileToRoute}.
 *
 * Callers hold these paths in two spaces — the compiler walks `pages/` and holds paths relative to
 * it, while the studio holds a document path relative to the PROJECT (`pages/blog/[slug].json`).
 * Normalising here means neither has to remember which space it is in.
 */
export function pageRelativePath(documentPath: string): string {
  return documentPath
    .split("\\")
    .join("/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/^pages\//, "");
}

/**
 * The route a page file's path describes.
 *
 * `blog/[slug].json` → `/blog/:slug`, `docs/[...rest].json` → `/docs/*`, `index.json` → `/`,
 * `about/index.md` → `/about`. The extension is dropped whatever it is: a page may be any format an
 * enabled extension claims, and its route is a property of the NAME, not of the parser.
 */
export function fileToRoute(relativePath: string): FileRoute {
  let urlPath = pageRelativePath(relativePath);

  /* Drop the extension, but only a real one. `.` is legal inside a route segment, and slicing at
     the last dot regardless would turn `pages/v1.2/index.json` into `/v1`. */
  const lastSegment = urlPath.slice(urlPath.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot > 0) {
    urlPath = urlPath.slice(0, urlPath.length - (lastSegment.length - dot));
  }

  // Index files map to their parent directory.
  if (urlPath.endsWith("/index")) {
    urlPath = urlPath.slice(0, -6) || "/";
  } else if (urlPath === "index") {
    urlPath = "/";
  }

  if (!urlPath.startsWith("/")) {
    urlPath = `/${urlPath}`;
  }

  const params: string[] = [];
  let isDynamic = false;
  let isCatchAll = false;
  const urlPattern = urlPath.replaceAll(
    PARAM_SEGMENT,
    (_match: string, spread: string | undefined, named: string | undefined) => {
      isDynamic = true;
      if (spread) {
        isCatchAll = true;
        params.push(spread);
        return "*";
      }
      params.push(named!);
      return `:${named}`;
    },
  );

  return { isCatchAll, isDynamic, params, urlPattern };
}

/**
 * URL pattern for a page document path — {@link fileToRoute} when only the pattern is wanted.
 *
 * A null or empty path answers `/` rather than throwing: the studio asks this of whatever document
 * happens to be open, including none.
 */
export function documentUrlPattern(documentPath?: string | null): string {
  if (!documentPath) {
    return "/";
  }
  return fileToRoute(documentPath).urlPattern;
}

/** Param names declared by a document path's bracket segments, e.g. `["sku"]`. */
export function dynamicRouteParams(documentPath?: string | null): string[] {
  if (!documentPath) {
    return [];
  }
  return fileToRoute(documentPath).params;
}

/**
 * Whether a path under `pages/` becomes a route at all.
 *
 * An underscore prefix opts a file OUT — that is how a page directory holds a local component
 * beside the pages that use it — and it opts out a whole directory the same way, so
 * `_partials/card.json` is not a route even though `card.json` alone would be.
 *
 * The build routes only the files it can read as a page: `.json`, and each extension a page format
 * claims (`discoverPages` in `@jxsuite/compiler`). A caller that knows the claimed extensions
 * passes them, so `index.json.bak` or a stray `notes.txt` beside the pages is not listed as one. A
 * caller that does not know them (no format registry) gets the name rule alone.
 *
 * @param relativePath A page path, `pages/…` or relative to `pages/`.
 * @param pageExtensions The extensions the build routes, lower-case with their dot (`.json`,
 *   `.md`). Omitted, the extension is not judged.
 */
export function isRoutedPageFile(relativePath: string, pageExtensions?: Iterable<string>): boolean {
  const segments = pageRelativePath(relativePath).split("/");
  if (!segments.every((segment) => segment !== "" && segment[0] !== "_")) {
    return false;
  }
  if (pageExtensions === undefined) {
    return true;
  }
  const name = segments.at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return ext !== "" && new Set(pageExtensions).has(ext);
}

/**
 * How specific one pattern segment is, read exactly as `matchPattern` reads it: `2` for a catch-all
 * (exactly `*`), `1` for a parameter (starts with `:`), `0` for a literal. Lower ranks first.
 */
function segmentRank(segment: string): 0 | 1 | 2 {
  if (segment === "*") {
    return 2;
  }
  return segment.startsWith(":") ? 1 : 0;
}

/**
 * Which of two routes outranks the other (spec `site-architecture.md` §4.4): negative when `a`
 * does, positive when `b` does, zero when neither does.
 *
 * Routes are compared segment by segment from the left and the first segment where they differ
 * decides: a literal outranks a parameter, a parameter outranks a catch-all, and a route that ends
 * where another continues ranks first. Zero means the two have the same length and the same segment
 * kind at every position, so they are one shape and the rule cannot choose between them.
 */
export function routePriority(a: FileRoute, b: FileRoute): number {
  const ranksA = splitPath(a.urlPattern).map((segment) => segmentRank(segment));
  const ranksB = splitPath(b.urlPattern).map((segment) => segmentRank(segment));
  const shared = Math.min(ranksA.length, ranksB.length);
  for (let index = 0; index < shared; index += 1) {
    if (ranksA[index] !== ranksB[index]) {
      return ranksA[index]! - ranksB[index]!;
    }
  }
  return ranksA.length - ranksB.length;
}

/**
 * Route table order (spec `site-architecture.md` §4.4): {@link routePriority}, then pattern text so
 * routes of one shape sort the same everywhere.
 *
 * Sorting a route table with this is what makes `matchRoute` a first-match scan, whatever order the
 * directory walk produced.
 */
export function compareRoutes(a: FileRoute, b: FileRoute): number {
  return routePriority(a, b) || a.urlPattern.localeCompare(b.urlPattern);
}

/** One route matched against a URL, with the parameter values that matched it. */
export interface RouteMatch<T extends FileRoute> {
  route: T;
  params: Record<string, string>;
}

/**
 * The first route in `routes` that matches `pathname`, or null.
 *
 * `routes` is expected to be in {@link compareRoutes} order; the scan takes the first hit rather
 * than the best one, because specificity is a property of the TABLE and re-deciding it per request
 * is how two surfaces end up disagreeing about which page a URL is.
 *
 * A trailing slash is not significant — `build.trailingSlash` decides how a route is WRITTEN, and a
 * reader who types the other form is asking for the same page.
 */
export function matchRoute<T extends FileRoute>(
  routes: readonly T[],
  pathname: string,
): RouteMatch<T> | null {
  const parts = splitPath(pathname);
  for (const route of routes) {
    const params = matchPattern(route.urlPattern, parts);
    if (params) {
      return { params, route };
    }
  }
  return null;
}

/** Path segments, with the empty leading/trailing entries a slash produces removed. */
function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

/** Parameter values if `pattern` matches `parts`, else null. */
function matchPattern(pattern: string, parts: string[]): Record<string, string> | null {
  const patternParts = splitPath(pattern);
  const params: Record<string, string> = {};

  for (const [index, expected] of patternParts.entries()) {
    if (expected === "*") {
      /* A catch-all consumes the rest, including nothing at all: `/docs/*` serves `/docs`. Its
         parameter is the remainder as one path, which is what the page's `$params` receives. */
      params["*"] = parts.slice(index).join("/");
      return params;
    }
    const actual = parts[index];
    if (actual === undefined) {
      return null;
    }
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }

  return patternParts.length === parts.length ? params : null;
}

/** How a site writes its URLs — `project.json`'s `build.trailingSlash`. */
export type TrailingSlash = "always" | "never";

/**
 * The address a route's page will have when it is published.
 *
 * This is the URL the page's OWN markup already points at, which is why Open in Browser opens it
 * rather than the compiler's output path: a built page links to `/blog/hello/` and pulls
 * `/components/demo.css`, both root-absolute, and handed its output path instead a browser resolves
 * those against the server root and every one of them misses.
 */
export function routeHref(
  urlPattern: string,
  params: Record<string, string> = {},
  trailingSlash: TrailingSlash = "always",
): string {
  const filled = urlPattern
    .replaceAll(/:(\w+)/g, (match, name: string) => {
      const value = params[name];
      return value === undefined ? match : encodeURIComponent(value);
    })
    .replace(/\*$/, (match) => {
      const rest = params["*"];
      return rest === undefined
        ? match
        : rest
            .split("/")
            .map((segment) => encodeURIComponent(segment))
            .join("/");
    });
  if (filled === "/" || filled === "") {
    return "/";
  }
  const bare = filled.endsWith("/") ? filled.slice(0, -1) : filled;
  return trailingSlash === "always" ? `${bare}/` : bare;
}

/**
 * A route pattern with its parameters filled in as the build writes them: each `:name` takes
 * `params[name]` and a trailing `*` takes `params["*"]`, raw, and a parameter with no value stays
 * as written.
 *
 * This is the concrete `$page.url` a built dynamic page has (`expandDynamicRoutes` in
 * `@jxsuite/compiler`). {@link routeHref} is not it: that one is a LINK, so it percent-encodes each
 * segment and applies `build.trailingSlash`, neither of which is part of a page's own URL.
 */
export function fillRoutePattern(
  urlPattern: string,
  params: Readonly<Record<string, string>>,
): string {
  return urlPattern
    .replaceAll(/:(\w+)/g, (match, name: string) => params[name] ?? match)
    .replace(/\*$/, (match) => params["*"] ?? match);
}
