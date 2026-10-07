/**
 * What a static host and a crawler are told about each page, decided in one place.
 *
 * Four facts, each of which the build used to leave to the author or get wrong:
 *
 * - The path a host serves a route at, which `build.trailingSlash` decides, so the canonical link,
 *   `og:url`, the sitemap `<loc>` and the `hreflang` alternates name the URL that answers with the
 *   page and not one that redirects to it ({@link servedRoute});
 * - Which route is the site's not-found page ({@link isNotFoundRoute}), which hosts expect at
 *   `/404.html` and which is never a page to index;
 * - Whether a built page asks crawlers not to index it ({@link htmlDeclaresNoindex}), because a
 *   sitemap that lists a page the page itself disowns sends two answers to the same question;
 * - Where a page's machine-readable twin lives, and the `<link rel="alternate">` that tells a reader
 *   of the HTML about it ({@link withAlternateLink}), because a file nothing points to is a file
 *   nobody finds.
 *
 * @docs framework/site/deployment
 * @docs framework/agents/machine-readable
 */

import { relative, sep } from "node:path";
import { escapeHtml } from "../shared.ts";

/**
 * The route of the site's not-found page, written to `404.html` (specs/site-architecture.md
 * §8.4.2).
 */
export const NOT_FOUND_ROUTE = "/404";

/** Whether `urlPattern` is the site's not-found page. */
export function isNotFoundRoute(urlPattern: string): boolean {
  return urlPattern === NOT_FOUND_ROUTE;
}

/**
 * The path a host serves `urlPattern` at, given `build.trailingSlash`.
 *
 * `"always"` writes `/about` as `about/index.html`, which hosts serve at `/about/` and answer
 * `/about` with a redirect to it; `"never"` writes `about.html`, served at `/about`. The root is
 * `/` either way, and any other setting leaves the route as written.
 *
 * @param {string} urlPattern - A concrete route (`/about`, `/kb/a/b`)
 * @param {string} [trailingSlash] - `build.trailingSlash`
 * @returns {string} The route as the host serves it
 */
export function servedRoute(urlPattern: string, trailingSlash?: string): string {
  if (urlPattern === "/") {
    return "/";
  }
  if (trailingSlash === "always") {
    return urlPattern.endsWith("/") ? urlPattern : `${urlPattern}/`;
  }
  if (trailingSlash === "never") {
    return urlPattern.replace(/\/+$/, "") || "/";
  }
  return urlPattern;
}

/** The value of one attribute in a start tag, quoted either way or bare; `null` when absent. */
function attributeOf(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(
    tag,
  );
  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? "");
}

/**
 * Whether the `<head>` of a built page carries `<meta name="robots">` with `noindex` (or `none`,
 * which means `noindex, nofollow`). Reads the finished HTML, like the CSP scan: a page can set the
 * tag from a layout, a state entry or `$head`, and only the output says what it ended up with.
 *
 * @param {string} html - A built page
 * @returns {boolean} True when crawlers are asked to leave the page out of their index
 */
export function htmlDeclaresNoindex(html: string): boolean {
  const end = html.search(/<\/head\s*>/i);
  const head = end === -1 ? html : html.slice(0, end);
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    if (attributeOf(tag, "name")?.trim().toLowerCase() !== "robots") {
      continue;
    }
    const directives = new Set(
      (attributeOf(tag, "content") ?? "")
        .toLowerCase()
        .split(",")
        .map((part) => part.trim()),
    );
    if (directives.has("noindex") || directives.has("none")) {
      return true;
    }
  }
  return false;
}

/** The `<head>` of a built page, or the whole string when it has no closing tag. */
function headOf(html: string): { head: string; end: number } {
  const end = html.search(/<\/head\s*>/i);
  return { end, head: end === -1 ? html : html.slice(0, end) };
}

/**
 * Whether a page's `<head>` already has a `<link rel="alternate">` of this media type, one the
 * author wrote or an earlier step added. `type` is compared by essence and without regard to case.
 *
 * @param {string} html - A built page
 * @param {string} type - A media type essence, `text/markdown`
 * @returns {boolean} True when the page already advertises an alternate of that type
 */
export function hasAlternateLink(html: string, type: string): boolean {
  const wanted = type.trim().toLowerCase();
  for (const [tag] of headOf(html).head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attributeOf(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const linked = (attributeOf(tag, "type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (rel.includes("alternate") && linked === wanted) {
      return true;
    }
  }
  return false;
}

/**
 * Adds `<link rel="alternate" type="…" href="…">` to the end of a built page's `<head>`, unless the
 * page already has an alternate of that type (an author's own wins, like every auto-injected entry,
 * specs/site-architecture.md §8.4) or has no `<head>` to put it in.
 *
 * This is the discovery mechanism the llms.txt proposal recommends for a Markdown twin
 * (`rel="alternate" type="text/markdown"`): the twin's URL is not one a reader can guess, and
 * `/templates/` is not `/templates/index.md` to anyone who has not been told.
 *
 * @param {string} html - A built page
 * @param {{ href: string; type: string }} link - Site-absolute `href`, and the media type essence
 * @returns {string} The page, with the link when it was needed
 */
export function withAlternateLink(html: string, link: { href: string; type: string }): string {
  const { end } = headOf(html);
  if (end === -1 || hasAlternateLink(html, link.type)) {
    return html;
  }
  const tag = `<link href="${escapeHtml(link.href)}" rel="alternate" type="${escapeHtml(link.type)}">`;
  return `${html.slice(0, end)}${tag}\n${html.slice(end)}`;
}

/**
 * The site-absolute URL path a file in the build output is served at, percent-encoded the way a
 * `<link href>` and a canonical URL are (`/kb/a b/index.md` is `/kb/a%20b/index.md`).
 *
 * @param {string} outDir - The build output directory
 * @param {string} file - A file inside it
 * @returns {string} `/templates/index.md`
 */
export function outputUrlPath(outDir: string, file: string): string {
  return new URL(`/${relative(outDir, file).split(sep).join("/")}`, "http://localhost").pathname;
}
