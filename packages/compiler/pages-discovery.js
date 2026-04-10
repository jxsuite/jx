/**
 * pages-discovery.js — File-based route discovery
 *
 * Scans the pages/ directory and builds a route table mapping
 * URL paths to their source JSON files, layouts, and metadata.
 *
 * Conventions (per site-architecture spec §4):
 *   pages/index.json          → /
 *   pages/about.json          → /about
 *   pages/about/index.json    → /about
 *   pages/blog/[slug].json    → /blog/:slug  (dynamic)
 *   pages/docs/[...path].json → /docs/*      (catch-all)
 *   pages/_component.json     → NOT routed   (underscore prefix)
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, relative, basename, extname, join } from "node:path";

/**
 * @typedef {object} Route
 * @property {string} urlPattern   - URL pattern (e.g. "/blog/:slug")
 * @property {string} sourcePath   - Absolute path to the .json source file
 * @property {string} relativePath - Path relative to pages/ dir
 * @property {boolean} isDynamic   - Whether route has parameters
 * @property {boolean} isCatchAll  - Whether route uses [...param] spread
 * @property {string[]} params     - Parameter names (e.g. ["slug"])
 * @property {string|null} $layout - Layout override from page frontmatter, if any
 */

/**
 * Discover all routable pages in a pages/ directory.
 *
 * @param {string} pagesDir - Absolute path to the pages/ directory
 * @returns {Route[]} Sorted route table (static routes first, then dynamic)
 */
export function discoverPages(pagesDir) {
  const routes = [];
  walkDir(pagesDir, pagesDir, routes);

  // Sort: static routes first, then by specificity (more segments = more specific)
  routes.sort((a, b) => {
    if (a.isDynamic !== b.isDynamic) return a.isDynamic ? 1 : -1;
    if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1;
    return a.urlPattern.localeCompare(b.urlPattern);
  });

  return routes;
}

/**
 * Recursively walk the pages directory tree.
 */
function walkDir(dir, pagesRoot, routes) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip underscore-prefixed directories
      if (entry.name.startsWith("_")) continue;
      walkDir(fullPath, pagesRoot, routes);
      continue;
    }

    // Only process .json files
    if (extname(entry.name) !== ".json") continue;

    // Skip underscore-prefixed files (local components, not routes)
    if (entry.name.startsWith("_")) continue;

    const relativePath = relative(pagesRoot, fullPath);
    const route = fileToRoute(relativePath, fullPath);
    if (route) routes.push(route);
  }
}

/**
 * Convert a file path relative to pages/ into a Route object.
 *
 * @param {string} relativePath - e.g. "blog/[slug].json"
 * @param {string} absolutePath - Full filesystem path
 * @returns {Route}
 */
function fileToRoute(relativePath, absolutePath) {
  // Remove .json extension
  let urlPath = relativePath.replace(/\.json$/, "");

  // Normalize path separators
  urlPath = urlPath.split("\\").join("/");

  // index files map to their parent directory
  if (urlPath.endsWith("/index")) {
    urlPath = urlPath.slice(0, -6) || "/";
  } else if (urlPath === "index") {
    urlPath = "/";
  }

  // Ensure leading slash
  if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;

  // Extract parameters from bracket syntax
  const params = [];
  let isDynamic = false;
  let isCatchAll = false;

  // Convert [param] → :param and [...param] → *
  const urlPattern = urlPath.replace(/\[\.\.\.(\w+)\]|\[(\w+)\]/g, (match, spread, named) => {
    if (spread) {
      isCatchAll = true;
      isDynamic = true;
      params.push(spread);
      return "*";
    }
    isDynamic = true;
    params.push(named);
    return `:${named}`;
  });

  // Peek at the page JSON to extract $layout if present
  let $layout = null;
  try {
    const raw = JSON.parse(readFileSync(absolutePath, "utf8"));
    if (typeof raw.$layout === "string") {
      $layout = raw.$layout;
    }
  } catch {
    // Skip unreadable files — will error during compilation
  }

  return {
    urlPattern,
    sourcePath: absolutePath,
    relativePath,
    isDynamic,
    isCatchAll,
    params,
    $layout,
  };
}

/**
 * Expand dynamic routes by resolving $paths from each dynamic page.
 *
 * @param {Route[]} routes - Discovered route table
 * @param {string} projectRoot - Project root for resolving $ref paths
 * @returns {Promise<Route[]>} Expanded routes with concrete paths
 */
export async function expandDynamicRoutes(routes, projectRoot) {
  const expanded = [];

  for (const route of routes) {
    if (!route.isDynamic) {
      expanded.push(route);
      continue;
    }

    // Read the page to look for $paths
    let raw;
    try {
      raw = JSON.parse(readFileSync(route.sourcePath, "utf8"));
    } catch {
      expanded.push(route);
      continue;
    }

    if (!raw.$paths || !Array.isArray(raw.$paths)) {
      // No $paths — skip this dynamic route (will be logged as warning)
      console.warn(
        `Warning: dynamic route ${route.urlPattern} has no $paths — skipping`
      );
      continue;
    }

    // Each $paths entry is an object mapping param names to values
    for (const pathEntry of raw.$paths) {
      let concreteUrl = route.urlPattern;
      for (const [param, value] of Object.entries(pathEntry)) {
        concreteUrl = concreteUrl.replace(`:${param}`, value);
        concreteUrl = concreteUrl.replace("*", value);
      }

      expanded.push({
        ...route,
        urlPattern: concreteUrl,
        isDynamic: false,
        isCatchAll: false,
        params: [],
        _pathParams: pathEntry, // Preserve original params for context injection
      });
    }
  }

  return expanded;
}
