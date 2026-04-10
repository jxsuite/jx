/**
 * context-injection.js — $page and $site context injection
 *
 * Injects site-level and page-level context variables into a page's
 * state before compilation. These are available as $site.* and $page.*
 * in template expressions.
 *
 * Per site-architecture spec §10:
 *   $site.name      — from site.json name
 *   $site.url       — from site.json url
 *   $site.state.*   — site-wide reactive state
 *   $page.url       — current page URL path
 *   $page.title     — page title
 *   $page.params    — dynamic route parameters (if any)
 */

/**
 * Inject $site and $page context into a page document's state.
 *
 * @param {object} doc        - The page document (mutated)
 * @param {object} siteConfig - Loaded site configuration
 * @param {object} route      - The resolved route for this page
 * @returns {object} The mutated document
 */
export function injectContext(doc, siteConfig, route) {
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

  return doc;
}
