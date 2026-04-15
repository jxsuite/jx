/**
 * context-injection.js — $page and $site context injection
 *
 * Injects site-level and page-level context variables into a page's
 * state before compilation. These are available as $site.* and $page.*
 * in template expressions.
 *
 * Also resolves ContentCollection and ContentEntry $prototype entries
 * against loaded content collections (Phase 2, spec §6.4).
 *
 * Per site-architecture spec §10:
 *   $site.name      — from site.json name
 *   $site.url       — from site.json url
 *   $site.state.*   — site-wide reactive state
 *   $page.url       — current page URL path
 *   $page.title     — page title
 *   $page.params    — dynamic route parameters (if any)
 */

import { queryCollection, findEntry } from "./content-loader.js";
import { resolve, dirname, relative } from "node:path";

/**
 * Inject $site and $page context into a page document's state.
 *
 * @param {any} doc        - The page document (mutated)
 * @param {any} siteConfig - Loaded site configuration
 * @param {any} route      - The resolved route for this page
 * @param {Map<string, any[]>} [collections] - Loaded content collections
 * @param {string | null} [projectRoot] - Absolute path to the project root (for import rebasing)
 * @returns {any} The mutated document
 */
export function injectContext(doc, siteConfig, route, collections = new Map(), projectRoot = null) {
  if (!doc.state) doc.state = {};

  // $site context — read-only site-level data
  doc.state.$site = {
    name: siteConfig.name ?? "JSONsx Site",
    url: siteConfig.url ?? "",
    ...(siteConfig.state ?? {}),
  };

  // $page context — read-only page-level data
  doc.state.$page = {
    url: route.urlPattern,
    title: doc.title ?? doc._pageTitle ?? siteConfig.name ?? "",
    params: route._pathParams ?? {},
  };

  // Resolve ContentCollection and ContentEntry $prototype entries
  if (collections.size > 0) {
    resolveContentPrototypes(doc.state, collections, route._pathParams ?? {});
  }

  // Merge site-level state into page state (page wins on conflicts)
  if (siteConfig.state) {
    for (const [key, value] of Object.entries(siteConfig.state)) {
      if (key !== "$site" && key !== "$page" && !(key in doc.state)) {
        doc.state[key] = value;
      }
    }
  }

  // Merge site-level $media into page $media
  if (siteConfig.$media) {
    doc.$media = { ...siteConfig.$media, ...(doc.$media ?? {}) };
  }

  // Merge site-level imports into page imports (page wins on collision)
  if (siteConfig.imports && Object.keys(siteConfig.imports).length > 0) {
    if (!doc.imports) doc.imports = {};
    for (const [name, srcPath] of Object.entries(siteConfig.imports)) {
      if (!(name in doc.imports)) {
        if (projectRoot && route.sourcePath) {
          // Rebase from site-root-relative to page-relative
          const abs = resolve(projectRoot, /** @type {string} */ (srcPath));
          doc.imports[name] = "./" + relative(dirname(route.sourcePath), abs);
        } else {
          doc.imports[name] = srcPath;
        }
      }
    }
  }

  return doc;
}

/**
 * Resolve ContentCollection and ContentEntry $prototype state entries.
 *
 * Replaces state entries like:
 *   { "$prototype": "ContentCollection", "collection": "blog", ... }
 * with the actual resolved collection data.
 *
 * @param {Record<string, any>} state - Page state (mutated)
 * @param {Map<string, any[]>} collections - Loaded collections
 * @param {Record<string, any>} params - Route parameters for $ref resolution
 */
function resolveContentPrototypes(state, collections, params) {
  for (const [key, value] of Object.entries(state)) {
    if (!value || typeof value !== "object" || !value.$prototype) continue;

    if (value.$prototype === "ContentCollection") {
      const entries = collections.get(value.collection);
      if (!entries) {
        console.warn(`ContentCollection: collection "${value.collection}" not found`);
        state[key] = [];
        continue;
      }
      state[key] = queryCollection(entries, {
        filter: value.filter,
        sort: value.sort,
        limit: value.limit,
      });
    } else if (value.$prototype === "ContentEntry") {
      const entries = collections.get(value.collection);
      if (!entries) {
        console.warn(`ContentEntry: collection "${value.collection}" not found`);
        state[key] = null;
        continue;
      }
      // Resolve the ID — may reference $params
      let id = value.id;
      if (id && typeof id === "object" && id.$ref?.startsWith("#/$params/")) {
        const paramName = id.$ref.replace("#/$params/", "");
        id = params[paramName];
      }
      state[key] = findEntry(entries, id);
    }
  }
}
