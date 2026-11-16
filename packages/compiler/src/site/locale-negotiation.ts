/**
 * Sending a visitor to their own language: RFC 4647 Lookup over `Accept-Language`.
 *
 * Discovery already ships — a translated page advertises its siblings with `hreflang` alternates
 * and `xhtml:link` entries, so a crawler can find every translation. What that does **not** do is
 * route a person. A visitor arriving at the bare `/` gets whatever `/` happens to hold, and their
 * `Accept-Language` header — the one thing that says which language they read — is never
 * consulted.
 *
 * **Not every deployment can fix that, and the honest thing is to say which.** Negotiation needs a
 * request, and adapter-less static output has no runtime that sees one: `dist/` is files, and the
 * preview server is a pure file mapper. That is a permanent property of the output shape, not
 * missing work. A site with `build.adapter` set gets a generated worker, the worker sees the
 * request, and this is where it decides.
 *
 * Two things this deliberately does NOT do:
 *
 * - **It negotiates the bare `/` only.** A visitor who asked for `/fr/about/` has expressed a
 *   preference far stronger than a header, and overriding it would make a shared link mean
 *   different things to different people.
 * - **It never guesses from an IP address.** Where someone is has never been what they read.
 *
 * @docs framework/site/i18n
 */

import { withBase } from "@jxsuite/schema/asset-paths";
import type { ResolvedI18n } from "./i18n.ts";

/** One `Accept-Language` entry: a language range and the quality it was offered at. */
interface WeightedRange {
  range: string;
  quality: number;
}

/**
 * Parse `Accept-Language` into ranges, best first (RFC 9110 §12.5.4).
 *
 * `q=0` means **not acceptable**, so those ranges are dropped rather than ranked last — a visitor
 * who wrote `de;q=0` is saying "not German", and treating that as a weak preference for German
 * would be exactly backwards. Ties keep their header order, which is the conventional reading of an
 * unweighted list.
 *
 * @param {string} header
 * @returns {WeightedRange[]}
 */
export function parseAcceptLanguage(header: string): WeightedRange[] {
  const parsed: { entry: WeightedRange; at: number }[] = [];
  for (const [index, part] of header.split(",").entries()) {
    const [rawRange, ...params] = part.split(";");
    const range = (rawRange ?? "").trim().toLowerCase();
    if (range === "") {
      continue;
    }
    let quality = 1;
    for (const param of params) {
      const [name, value] = param.split("=");
      if ((name ?? "").trim().toLowerCase() === "q") {
        // A malformed qvalue is a malformed header field; NaN falls through to the drop below.
        const parsedQuality = Number((value ?? "").trim());
        quality = Number.isNaN(parsedQuality) ? 0 : parsedQuality;
      }
    }
    if (quality <= 0) {
      continue;
    }
    parsed.push({ at: index, entry: { quality, range } });
  }
  return parsed
    .toSorted((a, b) => b.entry.quality - a.entry.quality || a.at - b.at)
    .map((p) => p.entry);
}

/**
 * The available tag a single language range selects, or null (RFC 4647 §3.4, Lookup).
 *
 * Lookup, not Filtering, and the difference is the whole point: Filtering returns every tag that
 * matches, which is the right answer for a content-negotiation menu and the wrong one for "which
 * page do I send this person to". A visitor gets one page.
 *
 * The algorithm is progressive truncation — `de-CH-1901` tries `de-CH-1901`, then `de-CH`, then
 * `de`. A single-character subtag is removed together with the one before it, because a lone `x` or
 * `u` is an extension singleton and never a tag on its own.
 *
 * @param {string} range - A lower-cased language range
 * @param {readonly string[]} available - Canonical tags, in preference order
 * @returns {string | null}
 */
export function lookupRange(range: string, available: readonly string[]): string | null {
  let candidate = range;
  while (candidate !== "") {
    const wanted = candidate;
    const match = available.find((tag) => tag.toLowerCase() === wanted);
    if (match !== undefined) {
      return match;
    }
    const cut = candidate.lastIndexOf("-");
    if (cut === -1) {
      return null;
    }
    candidate = candidate.slice(0, cut);
    // A trailing single-character subtag is a singleton, never a tag — drop it with its parent.
    const previous = candidate.lastIndexOf("-");
    if (candidate.length - previous === 2) {
      candidate = candidate.slice(0, previous);
    }
  }
  return null;
}

/**
 * The locale to serve a request carrying this `Accept-Language`, always one of `available`.
 *
 * `*` is skipped, because RFC 4647 §3.4 says so: a `*` followed by other ranges defers to them, and
 * a `*` that nothing follows takes the default value, which is `fallback`. The answer therefore
 * never depends on the order of `available`.
 *
 * @param {string | null | undefined} header - The raw `Accept-Language`, if any
 * @param {readonly string[]} available - Canonical tags; the answer does not depend on their order
 * @param {string} fallback - The site's `defaultLocale`: the answer when nothing matches, and to a
 *   trailing `*`
 * @returns {string}
 */
export function negotiateLocale(
  header: string | null | undefined,
  available: readonly string[],
  fallback: string,
): string {
  if (header === null || header === undefined || header.trim() === "") {
    return fallback;
  }
  for (const { range } of parseAcceptLanguage(header)) {
    if (range === "*") {
      // RFC 4647 §3.4 reads: "If the language range `*` is followed by other language ranges, it
      // Is skipped. If it is the only one, or none follows, the default value is computed."
      continue;
    }
    const match = lookupRange(range, available);
    if (match !== null) {
      return match;
    }
  }
  return fallback;
}

/**
 * Whether the site root has something to negotiate, and so whether a worker answers it.
 *
 * The root has a choice to make with two locales, and under `prefix-always` it has no page of its
 * own even with one (site-architecture.md §13.6). The middleware, the Pages worker exemption and
 * the `_routes.json` root entry all read this one definition.
 *
 * @param {ResolvedI18n | null} i18n
 * @returns {boolean}
 */
export function negotiatesRoot(i18n: ResolvedI18n | null): boolean {
  return i18n !== null && (i18n.locales.length > 1 || i18n.routing === "prefix-always");
}

/**
 * The site-absolute path a locale's home page lives at.
 *
 * Under `prefix-except-default` the default locale has no prefix, which is what makes `/` a real
 * page there and a redirect target nowhere else.
 *
 * @param {string} locale - A canonical tag
 * @param {ResolvedI18n} i18n
 * @returns {string}
 */
export function localeHome(locale: string, i18n: ResolvedI18n): string {
  if (i18n.routing === "prefix-except-default" && locale === i18n.defaultLocale) {
    return "/";
  }
  return `/${locale.toLowerCase()}/`;
}

/**
 * The negotiation middleware for the generated worker, or `""` when there is nothing to negotiate.
 *
 * Emitted as source text rather than imported, matching every other generated artefact here — the
 * worker is bundled from the _project_ root, so a compiler-internal import would not resolve. The
 * copy cannot silently drift: a test evaluates this source and runs the same corpus through it as
 * through {@link negotiateLocale}, failing on the first disagreement.
 *
 * **Middleware, not a route.** When negotiation lands on the locale `/` already serves, the request
 * must continue down the ordinary chain — the ASSETS binding on Cloudflare, static serving
 * elsewhere. A route would have to reproduce whichever of those the adapter uses; `await next()`
 * does not have to know.
 *
 * **`Vary: Accept-Language` is not optional.** Without it any cache in front of the site stores the
 * first visitor's answer and serves it to everyone, which turns a helpful default into a site stuck
 * in one language for every later reader. That is worse than not negotiating at all, and it is
 * invisible to the author — whose own browser was the first visitor.
 *
 * **Under the deployment base.** Every other worker route is registered under the base
 * (site-architecture.md §14.7), so the middleware registers at the based root and every home it
 * redirects to carries the base too. An unbased `app.use('/')` matches no request a based site
 * receives.
 *
 * @param {ResolvedI18n | null} i18n
 * @param {string} [base] - The deployment base path (`""` or `/m/site`)
 * @returns {string} JS source, or "" when the root has nothing to negotiate
 *   ({@link negotiatesRoot})
 */
export function localeNegotiationMiddleware(i18n: ResolvedI18n | null, base = ""): string {
  if (i18n === null || !negotiatesRoot(i18n)) {
    return "";
  }
  const locales = JSON.stringify(i18n.locales);
  const fallback = JSON.stringify(i18n.defaultLocale);
  const homes = JSON.stringify(
    Object.fromEntries(
      i18n.locales.map((locale) => [locale, withBase(base, localeHome(locale, i18n))]),
    ),
  );
  const root = JSON.stringify(withBase(base, "/"));

  return `
// ─── Locale negotiation (RFC 4647 Lookup over Accept-Language) ───────────────
const JX_LOCALES = ${locales}
const JX_DEFAULT_LOCALE = ${fallback}
const JX_ROOT = ${root}
const JX_LOCALE_HOMES = ${homes}

function jxParseAcceptLanguage(header) {
  const parsed = []
  header.split(',').forEach((part, index) => {
    const [rawRange, ...params] = part.split(';')
    const range = (rawRange || '').trim().toLowerCase()
    if (range === '') return
    let quality = 1
    for (const param of params) {
      const [name, value] = param.split('=')
      if ((name || '').trim().toLowerCase() === 'q') {
        const q = Number((value || '').trim())
        quality = Number.isNaN(q) ? 0 : q
      }
    }
    if (quality <= 0) return
    parsed.push({ at: index, quality, range })
  })
  return parsed.sort((a, b) => b.quality - a.quality || a.at - b.at).map((p) => p.range)
}

function jxLookupRange(range, available) {
  let candidate = range
  while (candidate !== '') {
    const wanted = candidate
    const match = available.find((tag) => tag.toLowerCase() === wanted)
    if (match !== undefined) return match
    const cut = candidate.lastIndexOf('-')
    if (cut === -1) return null
    candidate = candidate.slice(0, cut)
    const previous = candidate.lastIndexOf('-')
    if (candidate.length - previous === 2) candidate = candidate.slice(0, previous)
  }
  return null
}

function jxNegotiateLocale(header, available, fallback) {
  if (typeof header !== 'string' || header.trim() === '') return fallback
  for (const range of jxParseAcceptLanguage(header)) {
    if (range === '*') continue
    const match = jxLookupRange(range, available)
    if (match !== null) return match
  }
  return fallback
}

app.use(JX_ROOT, async (c, next) => {
  const locale = jxNegotiateLocale(c.req.header('accept-language'), JX_LOCALES, JX_DEFAULT_LOCALE)
  const home = JX_LOCALE_HOMES[locale] || JX_ROOT
  if (home !== JX_ROOT) {
    // 302, never 301: the target depends on the request, so it must never be cached as permanent.
    return new Response(null, {
      headers: { 'Content-Language': locale, Location: home, Vary: 'Accept-Language' },
      status: 302,
    })
  }
  // The root already holds this locale (prefix-except-default). Let the chain serve it, then say the
  // Response depended on the header — a cache that missed this would pin every visitor to it.
  await next()
  const res = new Response(c.res.body, c.res)
  res.headers.set('Vary', 'Accept-Language')
  res.headers.set('Content-Language', locale)
  c.res = res
})
`;
}
