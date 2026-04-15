/**
 * site-build.js — Multi-page build orchestrator
 *
 * Coordinates the full site build pipeline:
 *   1. Load site.json
 *   2. Discover pages/ routes
 *   3. Expand dynamic routes ($paths)
 *   4. For each route: resolve layout, merge $head, inject context, compile
 *   5. Emit compiled files to dist/
 *   6. Generate redirects
 *
 * This is the Phase 1 implementation of site-architecture spec §12.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { loadSiteConfig } from "./site-loader.js";
import { discoverPages, expandDynamicRoutes } from "./pages-discovery.js";
import { resolveLayout } from "./layout-resolver.js";
import { mergeHead, renderHead } from "./head-merger.js";
import { injectContext } from "./context-injection.js";
import { compile, compileServer } from "./compiler.js";
import { loadCollections, loadContentConfig, resolveCollectionRefs } from "./content-loader.js";

/**
 * Build an entire Jx site from a project directory.
 *
 * @param {string} projectRoot - Absolute path to the project root (contains site.json)
 * @param {object} [options]
 * @param {boolean} [options.clean]  - Remove outDir before building
 * @param {boolean} [options.verbose] - Log progress
 * @returns {Promise<{ routes: number, files: number, errors: string[] }>}
 */
export async function buildSite(projectRoot, options = {}) {
  const { clean = true, verbose = false } = options;
  /** @type {string[]} */
  const errors = [];
  const log = verbose ? console.log.bind(console) : () => {};

  // ── 1. Load site configuration ──────────────────────────────────────────
  log("Loading site.json...");
  const { config: siteConfig } = loadSiteConfig(projectRoot);

  const outDir = resolve(projectRoot, siteConfig.build.outDir);
  const pagesDir = resolve(projectRoot, "pages");
  const publicDir = resolve(projectRoot, "public");
  const trailingSlash = siteConfig.build.trailingSlash ?? "always";

  // ── 2. Clean output directory ───────────────────────────────────────────
  if (clean && existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  // ── 3. Discover routes ──────────────────────────────────────────────────
  if (!existsSync(pagesDir)) {
    throw new Error(`pages/ directory not found in ${projectRoot}`);
  }

  log("Discovering pages...");
  const staticRoutes = discoverPages(pagesDir);
  log(`  Found ${staticRoutes.length} page(s)`);

  // ── 3b. Load content collections ──────────────────────────────────────
  log("Loading content collections...");
  const collections = await loadCollections(projectRoot);
  if (collections.size > 0) {
    log(`  Loaded ${collections.size} collection(s): ${[...collections.keys()].join(", ")}`);
    // Resolve cross-collection $ref references
    const contentConfig = loadContentConfig(projectRoot);
    if (contentConfig) {
      resolveCollectionRefs(collections, contentConfig.config);
    }
  }

  // ── 4. Expand dynamic routes ────────────────────────────────────────────
  const routes = await expandDynamicRoutes(staticRoutes, projectRoot, collections);
  log(`  ${routes.length} route(s) after expansion`);

  // ── 5. Compile each route ───────────────────────────────────────────────
  let fileCount = 0;

  for (const route of routes) {
    try {
      log(`  Compiling ${route.urlPattern} ...`);
      const result = await compilePage(route, siteConfig, projectRoot, collections);

      // Determine output path
      const outPath = routeToOutputPath(route.urlPattern, outDir, trailingSlash);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, result.html, "utf8");
      fileCount++;

      // Write any additional files (island modules, etc.)
      for (const file of result.files) {
        const filePath = resolve(dirname(outPath), file.path);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, file.content, "utf8");
        fileCount++;
      }

      // Write server handler if present
      if (result.serverHandler) {
        const serverPath = resolve(dirname(outPath), "_server.js");
        writeFileSync(serverPath, result.serverHandler, "utf8");
        fileCount++;
      }
    } catch (e) {
      const err = /** @type {any} */ (e);
      const msg = `Error compiling ${route.urlPattern}: ${err.message}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  // ── 6. Generate redirects ───────────────────────────────────────────────
  if (siteConfig.redirects && Object.keys(siteConfig.redirects).length > 0) {
    log("Generating redirects...");
    const redirectFiles = generateRedirects(siteConfig.redirects, outDir);
    fileCount += redirectFiles;
  }

  // ── 7. Copy public/ assets ──────────────────────────────────────────────
  if (existsSync(publicDir)) {
    log("Copying public/ assets...");
    cpSync(publicDir, outDir, { recursive: true });
  }

  // ── 8. Summary ──────────────────────────────────────────────────────────
  log(`\nBuild complete: ${routes.length} routes, ${fileCount} files`);
  if (errors.length > 0) {
    log(`  ${errors.length} error(s)`);
  }

  return { routes: routes.length, files: fileCount, errors };
}

/**
 * Compile a single page within the site build context.
 *
 * Pipeline: load JSON → resolve layout → inject context → merge head → compile
 *
 * @param {any} route
 * @param {any} siteConfig
 * @param {string} projectRoot
 * @param {Map<string, any[]>} [collections]
 * @returns {Promise<{ html: string, files: any[], serverHandler: string | null }>}
 */
async function compilePage(route, siteConfig, projectRoot, collections = new Map()) {
  // Load the raw page document
  let pageDoc = JSON.parse(readFileSync(route.sourcePath, "utf8"));

  // Resolve layout (wraps page in layout with slot distribution)
  const layoutDoc = resolveLayout(pageDoc, siteConfig, projectRoot);

  // Extract head arrays before they get lost in the merge
  const pageHead = pageDoc.$head ?? layoutDoc._pageHead ?? [];
  const layoutHead = layoutDoc.$head ?? [];
  const pageTitle = pageDoc.title ?? layoutDoc._pageTitle ?? null;

  // Clean up internal properties
  delete layoutDoc._pageHead;
  delete layoutDoc._pageTitle;

  // Inject $site and $page context, resolve ContentCollection/ContentEntry
  injectContext(layoutDoc, siteConfig, route, collections, projectRoot);

  // Determine the page title
  const title = pageTitle ?? siteConfig.name ?? "Jx Site";

  // Merge $head from site + layout + page
  const mergedHead = mergeHead(
    siteConfig.$head ?? [],
    layoutHead,
    pageHead,
    {
      title,
      charset: siteConfig.defaults?.charset ?? "utf-8",
      siteName: siteConfig.name,
      siteUrl: siteConfig.url,
      pageUrl: route.urlPattern,
    }
  );

  // Compile the document using the existing compiler
  const result = await compile(layoutDoc, {
    title,
    lang: siteConfig.defaults?.lang ?? "en",
  });

  // Post-process: inject merged <head> content into the compiled HTML
  result.html = injectHead(result.html, mergedHead, siteConfig.defaults?.lang ?? "en");

  // Compile server handler if applicable
  /** @type {string | null} */
  let serverHandler = null;
  try {
    const serverResult = await compileServer(route.sourcePath);
    if (serverResult) {
      serverHandler = serverResult;
    }
  } catch {
    // No server entries — that's fine
  }

  return { html: result.html, files: result.files, serverHandler };
}

/**
 * Post-process compiled HTML to inject the merged <head> content.
 * Replaces the compiler's default <head> section with our merged version.
 * @param {string} html
 * @param {any[]} headEntries
 * @param {string} lang
 * @returns {string}
 */
function injectHead(html, headEntries, lang) {
  const headHtml = renderHead(headEntries);

  // Replace the existing <head>...</head> block
  const headPattern = /<head>[\s\S]*?<\/head>/i;
  if (headPattern.test(html)) {
    html = html.replace(headPattern, `<head>\n  ${headHtml}\n</head>`);
  }

  // Set the lang attribute on <html>
  html = html.replace(/<html\s[^>]*>/i, (/** @type {string} */ match) => {
    if (/lang=/.test(match)) {
      return match.replace(/lang="[^"]*"/, `lang="${lang}"`);
    }
    return match.replace("<html", `<html lang="${lang}"`);
  });

  return html;
}

/**
 * Convert a URL pattern to an output file path.
 *
 * "/" → dist/index.html
 * "/about" → dist/about/index.html (with trailingSlash: "always")
 * "/blog/hello" → dist/blog/hello/index.html
 *
 * @param {string} urlPattern
 * @param {string} outDir
 * @param {string} trailingSlash
 * @returns {string}
 */
function routeToOutputPath(urlPattern, outDir, trailingSlash) {
  if (urlPattern === "/") {
    return join(outDir, "index.html");
  }

  // Remove leading slash
  const segments = urlPattern.replace(/^\//, "");

  if (trailingSlash === "always") {
    return join(outDir, segments, "index.html");
  }

  // trailingSlash: "never" or default
  return join(outDir, `${segments}.html`);
}

/**
 * Generate redirect files (HTML meta refresh and _redirects).
 *
 * @param {Record<string, any>} redirects
 * @param {string} outDir
 * @returns {number} Number of files written
 */
function generateRedirects(redirects, outDir) {
  let count = 0;
  /** @type {string[]} */
  const redirectLines = [];

  for (const [source, target] of Object.entries(redirects)) {
    const dest = typeof target === "object" ? target.destination : target;
    const status = typeof target === "object" ? (target.status ?? 301) : 301;

    // Skip patterns with :param or * — these need platform-specific handling
    if (source.includes(":") || source.includes("*")) {
      redirectLines.push(`${source} ${dest} ${status}`);
      continue;
    }

    // Static redirect — emit an HTML file with meta refresh
    const htmlPath = routeToOutputPath(source, outDir, "always");
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${escapeAttr(dest)}">
  <link rel="canonical" href="${escapeAttr(dest)}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="${escapeAttr(dest)}">${escapeHtml(dest)}</a>...</p>
</body>
</html>`;
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, html, "utf8");
    count++;
    redirectLines.push(`${source} ${dest} ${status}`);
  }

  // Write _redirects file (Netlify/Cloudflare format)
  if (redirectLines.length > 0) {
    writeFileSync(join(outDir, "_redirects"), redirectLines.join("\n") + "\n", "utf8");
    count++;
  }

  return count;
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
