/**
 * Site-build.js — Multi-page build orchestrator
 *
 * Coordinates the full site build pipeline: 1. Load project.json 2. Discover pages/ routes 3.
 * Expand dynamic routes ($paths) 4. For each route: resolve layout, merge $head, inject context,
 * compile 5. Emit compiled files to dist/ 6. Generate redirects
 *
 * This is the Phase 1 implementation of site-architecture spec §12.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { loadProjectConfig } from "./site-loader.js";
import { discoverPages, expandDynamicRoutes } from "./pages-discovery.js";
import { resolveLayout } from "./layout-resolver.js";
import { mergeHead, renderHead } from "./head-merger.js";
import { injectContext } from "./context-injection.js";
import { compile, compileServer } from "../compiler.js";
import { compileElement } from "../targets/compile-element.js";
import {
  buildInitialScope,
  isTemplateString,
  evaluateStaticTemplate,
  DEFAULT_REACTIVITY_SRC,
  DEFAULT_LIT_HTML_SRC,
} from "../shared.js";
import { loadCollections, loadContentConfig, resolveCollectionRefs } from "./content-loader.js";
import { resolvePrototypes } from "./prototype-resolver.js";

/**
 * Build an entire Jx site from a project directory.
 *
 * @param {string} projectRoot - Absolute path to the project root (contains project.json)
 * @param {object} [options]
 * @param {boolean} [options.clean] - Remove outDir before building
 * @param {boolean} [options.verbose] - Log progress
 * @returns {Promise<{ routes: number; files: number; errors: string[] }>}
 */
export async function buildSite(projectRoot, options = {}) {
  const { clean = true, verbose = false } = options;
  /** @type {string[]} */
  const errors = [];
  const log = verbose ? console.log.bind(console) : () => {};

  // ── 1. Load project configuration ──────────────────────────────────────────
  log("Loading project.json...");
  const { config: projectConfig } = loadProjectConfig(projectRoot);

  const outDir = resolve(projectRoot, projectConfig.build.outDir);
  const pagesDir = resolve(projectRoot, "pages");
  const publicDir = resolve(projectRoot, "public");
  const trailingSlash = projectConfig.build.trailingSlash ?? "always";

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
  const collections = await loadCollections(projectRoot, projectConfig);
  if (collections.size > 0) {
    log(`  Loaded ${collections.size} collection(s): ${[...collections.keys()].join(", ")}`);
    // Resolve cross-collection $ref references
    const contentConfig = loadContentConfig(projectRoot, projectConfig);
    if (contentConfig) {
      resolveCollectionRefs(collections, contentConfig.config);
    }
  }

  // ── 4. Expand dynamic routes ────────────────────────────────────────────
  const routes = await expandDynamicRoutes(staticRoutes, projectRoot, collections);
  log(`  ${routes.length} route(s) after expansion`);

  let fileCount = 0;

  // ── 5. Compile site components ──────────────────────────────────────────
  const componentsDir = resolve(projectRoot, "components");
  /** @type {string[]} */
  const compiledComponentTags = [];
  if (existsSync(componentsDir)) {
    log("Compiling components...");
    const componentFiles = readdirSync(componentsDir).filter((/** @type {string} */ f) =>
      f.endsWith(".json"),
    );
    const componentOutDir = resolve(outDir, "components");
    mkdirSync(componentOutDir, { recursive: true });

    for (const file of componentFiles) {
      try {
        const componentPath = resolve(componentsDir, file);
        const result = await compileElement(componentPath);
        for (const f of result.files) {
          const outName = f.path.includes("/")
            ? /** @type {string} */ (f.path.split("/").pop())
            : f.path;
          writeFileSync(resolve(componentOutDir, outName), f.content, "utf8");
          if (f.tagName) compiledComponentTags.push(f.tagName);
          fileCount++;
        }
      } catch (e) {
        const err = /** @type {any} */ (e);
        errors.push(`Error compiling component ${file}: ${err.message}`);
        console.error(`Error compiling component ${file}: ${err.message}`);
      }
    }
    log(
      `  Compiled ${compiledComponentTags.length} component(s): ${compiledComponentTags.join(", ")}`,
    );
  }

  // ── 6. Compile each route ───────────────────────────────────────────────

  for (const route of routes) {
    try {
      log(`  Compiling ${route.urlPattern} ...`);
      const result = await compilePage(route, projectConfig, projectRoot, collections);

      // Inject component scripts if the page references any compiled components
      if (compiledComponentTags.length > 0) {
        result.html = injectComponentScripts(result.html, compiledComponentTags);
      }

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

  // ── 7. Generate redirects ───────────────────────────────────────────────
  if (projectConfig.redirects && Object.keys(projectConfig.redirects).length > 0) {
    log("Generating redirects...");
    const redirectFiles = generateRedirects(projectConfig.redirects, outDir);
    fileCount += redirectFiles;
  }

  // ── 7. Copy public/ assets ──────────────────────────────────────────────
  if (existsSync(publicDir)) {
    log("Copying public/ assets...");
    cpSync(publicDir, outDir, { recursive: true });
  }

  // ── 8. Copy declarative file mappings ──────────────────────────────────
  if (projectConfig.copy) {
    log("Copying mapped files...");
    for (const [src, dest] of Object.entries(projectConfig.copy)) {
      const srcPath = resolve(projectRoot, /** @type {string} */ (src));
      const destPath = resolve(outDir, /** @type {string} */ (dest));
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }
  }

  // ── 9. Summary ──────────────────────────────────────────────────────────
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
 * @param {any} projectConfig
 * @param {string} projectRoot
 * @param {Map<string, any[]>} [collections]
 * @returns {Promise<{ html: string; files: any[]; serverHandler: string | null }>}
 */
async function compilePage(route, projectConfig, projectRoot, collections = new Map()) {
  // Load the raw page document
  let pageDoc = JSON.parse(readFileSync(route.sourcePath, "utf8"));

  // Resolve layout (wraps page in layout with slot distribution)
  const layoutDoc = resolveLayout(pageDoc, projectConfig, projectRoot);

  // Extract head arrays before they get lost in the merge
  const pageHead = pageDoc.$head ?? layoutDoc._pageHead ?? [];
  const layoutHead = layoutDoc.$head ?? [];
  const pageTitle = pageDoc.title ?? layoutDoc._pageTitle ?? null;

  // Clean up internal properties
  delete layoutDoc._pageHead;
  delete layoutDoc._pageTitle;

  // Inject $site and $page context, resolve ContentCollection/ContentEntry
  injectContext(layoutDoc, projectConfig, route, collections, projectRoot);

  // Resolve generic $prototype entries via .class.json imports
  await resolvePrototypes(layoutDoc, route, projectRoot);

  // Build scope from resolved state so template strings in title/$head can be evaluated
  const scope = buildInitialScope(layoutDoc.state ?? {});

  // Determine the page title — resolve template strings against the scope
  let title = pageTitle ?? projectConfig.name ?? "Jx Site";
  if (typeof title === "string" && isTemplateString(title)) {
    title = evaluateStaticTemplate(title, scope) ?? title;
  }

  // Resolve template strings in $head entries
  const resolvedPageHead = resolveHeadTemplates(pageHead, scope);
  const resolvedLayoutHead = resolveHeadTemplates(layoutHead, scope);

  // Resolve template strings in the document tree (innerHTML, textContent, style, attributes)
  // so that timing: "compiler" data is baked into the static HTML
  resolveDocTemplates(layoutDoc, scope);

  // Strip resolved timing: "compiler" state entries — they're now baked into the tree
  // and keeping them would cause isDynamic() to misclassify the page as dynamic
  if (layoutDoc.state) {
    for (const [key, def] of Object.entries(layoutDoc.state)) {
      if (key === "$site" || key === "$page") continue;
      if (
        def &&
        typeof def === "object" &&
        !Array.isArray(def) &&
        /** @type {any} */ (def).timing === "compiler"
      ) {
        delete layoutDoc.state[key];
      }
    }
  }

  // Resolve bare npm specifiers in $head (e.g. "@pkg/name/file.css" → "/node_modules/@pkg/name/file.css")
  const resolvedSiteHead = resolveHeadBareSpecifiers(projectConfig.$head ?? []);

  // Merge $head from site + layout + page
  const mergedHead = mergeHead(resolvedSiteHead, resolvedLayoutHead, resolvedPageHead, {
    title,
    charset: projectConfig.defaults?.charset ?? "utf-8",
    siteName: projectConfig.name,
    siteUrl: projectConfig.url,
    pageUrl: route.urlPattern,
  });

  // Merge project-level $media into the layout document so responsive queries are available
  if (projectConfig.$media) {
    layoutDoc.$media = { ...projectConfig.$media, ...layoutDoc.$media };
  }

  // Compile the document using the existing compiler
  const result = await compile(layoutDoc, {
    title,
    lang: projectConfig.defaults?.lang ?? "en",
    projectStyle: projectConfig.style ?? null,
  });

  // Post-process: inject merged <head> content into the compiled HTML
  result.html = injectHead(result.html, mergedHead, projectConfig.defaults?.lang ?? "en");

  // Inject <script type="module"> for npm $elements (cherry-picked component imports)
  const npmElements = (layoutDoc.$elements ?? []).filter(
    (/** @type {any} */ e) => typeof e === "string" && !e.startsWith("./") && !e.startsWith("../"),
  );
  if (npmElements.length > 0) {
    result.html = injectNpmElementScripts(result.html, npmElements);
  }

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
 * Resolve template strings in $head entries against the compiled scope.
 *
 * @param {any[]} headEntries
 * @param {any} scope
 * @returns {any[]}
 */
function resolveHeadTemplates(headEntries, scope) {
  return headEntries.map((/** @type {any} */ entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const resolved = { ...entry };
    if (resolved.attributes) {
      resolved.attributes = { ...resolved.attributes };
      for (const [k, v] of Object.entries(resolved.attributes)) {
        if (typeof v === "string" && isTemplateString(v)) {
          resolved.attributes[k] = evaluateStaticTemplate(v, scope) ?? v;
        }
      }
    }
    if (typeof resolved.textContent === "string" && isTemplateString(resolved.textContent)) {
      resolved.textContent =
        evaluateStaticTemplate(resolved.textContent, scope) ?? resolved.textContent;
    }
    return resolved;
  });
}

/**
 * Resolve bare npm specifiers in $head entry attributes (href, src). e.g.
 * "@shoelace-style/shoelace/dist/themes/light.css" →
 * "/node_modules/@shoelace-style/shoelace/dist/themes/light.css"
 *
 * @param {any[]} headEntries
 * @returns {any[]}
 */
function resolveHeadBareSpecifiers(headEntries) {
  return headEntries.map((/** @type {any} */ entry) => {
    if (!entry || typeof entry !== "object" || !entry.attributes) return entry;
    const resolved = { ...entry, attributes: { ...entry.attributes } };
    for (const key of ["href", "src"]) {
      const val = resolved.attributes[key];
      if (typeof val === "string" && isBareSpecifier(val)) {
        resolved.attributes[key] = `/node_modules/${val}`;
      }
    }
    return resolved;
  });
}

/**
 * Check if a string is a bare npm specifier (not a relative/absolute path or URL).
 *
 * @param {string} s
 * @returns {boolean}
 */
function isBareSpecifier(s) {
  return (
    !s.startsWith("/") &&
    !s.startsWith("./") &&
    !s.startsWith("../") &&
    !s.startsWith("http") &&
    !s.startsWith("data:")
  );
}

/**
 * Recursively resolve template strings in a document tree against a scope. Mutates the document in
 * place — evaluates ${...} in innerHTML, textContent, style values, and attribute values.
 *
 * @param {any} node
 * @param {any} scope
 */
function resolveDocTemplates(node, scope) {
  if (!node || typeof node !== "object") return;

  if (typeof node.innerHTML === "string" && isTemplateString(node.innerHTML)) {
    const resolved = evaluateStaticTemplate(node.innerHTML, scope);
    if (resolved != null) {
      // Encode any remaining `${` as HTML entities so the compile phase won't
      // re-interpret them as template expressions. After resolution, any `${` in the
      // result is literal content (e.g., code examples), not an intentional template.
      node.innerHTML = resolved.replaceAll("${", "&#36;{");
    }
  }
  if (typeof node.textContent === "string" && isTemplateString(node.textContent)) {
    node.textContent = evaluateStaticTemplate(node.textContent, scope) ?? node.textContent;
  }
  if (node.style && typeof node.style === "object") {
    for (const [k, v] of Object.entries(node.style)) {
      if (typeof v === "string" && isTemplateString(v)) {
        node.style[k] = evaluateStaticTemplate(v, scope) ?? v;
      }
    }
  }
  if (node.attributes && typeof node.attributes === "object") {
    for (const [k, v] of Object.entries(node.attributes)) {
      if (typeof v === "string" && isTemplateString(v)) {
        node.attributes[k] = evaluateStaticTemplate(v, scope) ?? v;
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      resolveDocTemplates(child, scope);
    }
  }
}

/**
 * Inject component script tags into compiled HTML for any referenced custom elements. Adds an
 * import map and module scripts before </body>.
 *
 * @param {string} html
 * @param {string[]} allComponentTags - All compiled component tag names
 * @returns {string}
 */
function injectComponentScripts(html, allComponentTags) {
  // Find which components are actually referenced in this page
  const usedTags = allComponentTags.filter(
    (/** @type {string} */ tag) => html.includes(`<${tag}`), // matches <tag> and <tag ...>
  );
  if (usedTags.length === 0) return html;

  // Build import map (needed for @vue/reactivity and lit-html)
  const importMap = `<script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "${DEFAULT_REACTIVITY_SRC}",
      "lit-html": "${DEFAULT_LIT_HTML_SRC}"
    }
  }
  </script>`;

  const moduleScripts = usedTags
    .map(
      (/** @type {string} */ tag) => `<script type="module" src="/components/${tag}.js"></script>`,
    )
    .join("\n  ");

  // Check if an import map already exists (from islands etc.)
  const hasImportMap = html.includes('<script type="importmap">');
  const injection = (hasImportMap ? "" : `${importMap}\n  `) + moduleScripts;

  return html.replace("</body>", `  ${injection}\n</body>`);
}

/**
 * Inject <script type="module"> tags for npm package $elements (cherry-picked component imports).
 * Bare specifiers are resolved to /node_modules/ paths.
 *
 * @param {string} html
 * @param {string[]} npmElements - Bare specifier strings, e.g.
 *   "@shoelace-style/shoelace/components/button/button.js"
 * @returns {string}
 */
function injectNpmElementScripts(html, npmElements) {
  const scripts = npmElements
    .map(
      (/** @type {string} */ spec) => `<script type="module" src="/node_modules/${spec}"></script>`,
    )
    .join("\n  ");

  return html.replace("</body>", `  ${scripts}\n</body>`);
}

/**
 * Replaces the compiler's default <head> section with our merged version.
 *
 * @param {string} html
 * @param {any[]} headEntries
 * @param {string} lang
 * @returns {string}
 */
function injectHead(html, headEntries, lang) {
  const headHtml = renderHead(headEntries);

  // Replace the existing <head>...</head> block, preserving compiler-generated <style> and <script> blocks
  const headPattern = /<head>([\s\S]*?)<\/head>/i;
  const existingMatch = html.match(headPattern);
  let preservedBlocks = "";
  if (existingMatch) {
    const styles = existingMatch[1].match(/<style>[\s\S]*?<\/style>/gi);
    if (styles) preservedBlocks += "\n  " + styles.join("\n  ");
    const scripts = existingMatch[1].match(/<script[\s\S]*?<\/script>/gi);
    if (scripts) preservedBlocks += "\n  " + scripts.join("\n  ");
  }
  if (headPattern.test(html)) {
    html = html.replace(headPattern, `<head>\n  ${headHtml}${preservedBlocks}\n</head>`);
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
 * "/" → dist/index.html "/about" → dist/about/index.html (with trailingSlash: "always")
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
