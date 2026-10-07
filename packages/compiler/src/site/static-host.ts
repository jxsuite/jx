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
 *   sitemap that lists a page the page itself disowns sends two answers to the same question.
 *
 * @docs framework/site/deployment
 */

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
