/**
 * Content routes — the one place that says what URL a content entry has.
 *
 * A content type's `route` is a template over the entry's own facts, for example
 * `/kb/{category:slug}/{slug}/`. The loader renders it once per entry and stamps the result at
 * `_meta.route`; from then on **everything that needs a URL reads that stamp**: link rewriting
 * (`content-links.ts`), `$paths` expansion (`Content.resolvePaths`), `ContentEntry`'s binding to
 * its page, the search index and the feed. A route that was recomputed in each of those places
 * would be a route that could disagree in one of them, and the symptom of that — a page that exists
 * and a link to it that 404s — is exactly what this module exists to rule out.
 *
 * Pure string logic with no `node:` imports.
 *
 * @module @jxsuite/parser/content-routes
 * @license MIT
 * @docs framework/site/content-collections
 */

import { readField } from "./content-rules.ts";

// ─── slugs ──────────────────────────────────────────────────────────────────

/**
 * Turn text into one URL path segment: Latin diacritics folded away, `&` read as "and", apostrophes
 * dropped, everything that is not a letter or digit collapsed to single hyphens.
 *
 * Letters and digits of every script are kept, so a Japanese or Cyrillic title still yields a slug
 * made of its own words. Diacritics are folded only on a Latin base letter, because in Devanagari
 * or Thai the same Unicode category carries vowels, and folding those would spell a different word.
 * `&` becoming `and` is deliberate: `Git & Dev Tools` should read `git-and-dev-tools`, which is
 * what a person writes by hand, instead of the `git-dev-tools` a plain strip would produce.
 *
 * @param {string} text
 * @returns {string} The slug, or `""` when the text holds no letter or digit
 */
export function slugifySegment(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .normalize("NFC")
    .replaceAll("&", " and ")
    .replaceAll(/['’]/g, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/** {@link slugifySegment} applied to each `/`-separated part, so a path-shaped id keeps its depth. */
export function slugifyPath(text: string): string {
  return text
    .split("/")
    .map((part) => slugifySegment(part))
    .filter((part) => part !== "")
    .join("/");
}

// ─── templates ──────────────────────────────────────────────────────────────

const TRANSFORMS: Record<string, (value: string) => string> = {
  lower: (value) => value.toLowerCase(),
  raw: (value) => value,
  slug: slugifyPath,
  upper: (value) => value.toUpperCase(),
};

/** One piece of a parsed template: literal text, or a placeholder with its transforms. */
type Token = { literal: string } | { name: string; transforms: string[]; source: string };

/** A parsed route template. */
export interface RouteTemplate {
  source: string;
  tokens: Token[];
}

/** The `route` and `indexRoute` options as the loader uses them. */
export interface RouteSpec {
  /** Used for ordinary entries, and for directory indexes when `index` is absent. */
  entry: RouteTemplate;
  /** Used for the README / index file of a directory. */
  index: RouteTemplate | null;
}

/**
 * Parse one template. Throws a readable error for anything that could not render, so a typo in
 * `project.json` fails the build on the first entry rather than producing routes with the
 * placeholder text in them.
 */
export function parseRouteTemplate(source: unknown, where: string): RouteTemplate {
  if (typeof source !== "string" || !source.startsWith("/")) {
    throw new TypeError(
      `${where}: a route template is a site-absolute path starting with "/", got ${JSON.stringify(source)}`,
    );
  }
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(/\{([^{}]*)\}/g)) {
    const index = match.index ?? 0;
    if (index > last) {
      tokens.push({ literal: source.slice(last, index) });
    }
    const [name, ...transforms] = match[1]!.split(":").map((part) => part.trim());
    if (!name) {
      throw new TypeError(`${where}: empty placeholder "{}" in "${source}"`);
    }
    for (const transform of transforms) {
      if (!(transform in TRANSFORMS)) {
        throw new TypeError(
          `${where}: unknown transform "${transform}" in "{${match[1]}}" (use ${Object.keys(TRANSFORMS).join(", ")})`,
        );
      }
    }
    tokens.push({ name, source: match[0], transforms });
    last = index + match[0].length;
  }
  if (last < source.length) {
    tokens.push({ literal: source.slice(last) });
  }
  if (/[{}]/.test(tokens.map((t) => ("literal" in t ? t.literal : "")).join(""))) {
    throw new TypeError(`${where}: unbalanced brace in "${source}"`);
  }
  return { source, tokens };
}

/**
 * Parse the `route` option (every entry) and `indexRoute` (a directory's README / index file).
 *
 * `indexRoute` without a `route` is an error rather than a silent no-op: an index template with no
 * entry template would route the READMEs and leave every other document without a URL.
 */
export function parseRouteConfig(
  route: unknown,
  indexRoute: unknown,
  typeName: string,
): RouteSpec | null {
  const where = `Content type "${typeName}"`;
  if (route === undefined) {
    if (indexRoute !== undefined) {
      throw new TypeError(`${where}: "indexRoute" needs a "route" for every other entry`);
    }
    return null;
  }
  return {
    entry: parseRouteTemplate(route, `${where}: route`),
    index: indexRoute === undefined ? null : parseRouteTemplate(indexRoute, `${where}: indexRoute`),
  };
}

// ─── rendering ──────────────────────────────────────────────────────────────

/** What a template can read about one entry. */
export interface RouteSubject {
  /** The entry id (after `idField`). */
  id: string;
  /** Frontmatter / entry data. */
  data: Record<string, unknown>;
  /** The source file, relative to the source root, `/`-separated, with its extension. */
  path: string;
}

/** `README` and `index` are the file names that stand for their directory. */
const INDEX_NAME = /^(?:index|readme)\.[^./]+$/i;

/**
 * Whether a source file is the index of its directory (`README.md`, `index.md`).
 *
 * Matches the rule entry ids use: `studio/index.md` has always been the id `studio`, and
 * `README.md` now is too, because that is the file a repository, GitHub and Obsidian all show for a
 * folder.
 */
export function isDirectoryIndex(path: string): boolean {
  return INDEX_NAME.test(path.slice(path.lastIndexOf("/") + 1));
}

/** The directory of a relative path (`""` for a file at the root). */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** A field value as route text, or null when it cannot name a path segment. */
function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() === "" ? null : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/** The value of a placeholder name for one entry, or null when it has none. */
function resolveName(name: string, subject: RouteSubject): string | null {
  switch (name) {
    case "id": {
      return textOf(subject.id);
    }
    case "dir": {
      // The one placeholder that may be legitimately empty: a file at the root has no directory.
      return directoryOf(subject.path);
    }
    case "file": {
      const base = subject.path.slice(subject.path.lastIndexOf("/") + 1);
      const dot = base.lastIndexOf(".");
      return textOf(dot > 0 ? base.slice(0, dot) : base);
    }
    default: {
      return textOf(readField(subject.data, name.startsWith("data.") ? name.slice(5) : name));
    }
  }
}

/**
 * Why a path value could climb out of the output directory, or `null` when it cannot.
 *
 * A page is written to disk at a path under `dist/`, built from a route or from a value a `$paths`
 * source hands to a page, and either can come from frontmatter. A segment that is `.` or `..` would
 * climb out of the output directory, and a backslash or a NUL is a separator or a terminator on
 * some platform. Every value that becomes a path goes through here.
 *
 * @param {string} path - A `/`-separated path
 * @returns {string | null} A reason, or null when the path stays where it is put
 */
export function traversalReason(path: string): string | null {
  if (path.includes("\0")) {
    return "contains a NUL character";
  }
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "..") {
      return 'contains a "." or ".." segment';
    }
    if (segment.includes("\\")) {
      return "contains a backslash";
    }
  }
  return null;
}

/**
 * Why a path cannot be a route, or `null` when it can: {@link traversalReason}, plus an unencoded
 * `?`, `#` or `%`, which everything downstream (the sitemap writer among them) would read as a
 * query, a fragment or an escape rather than as part of a name.
 *
 * @param {string} path - A `/`-separated path
 * @returns {string | null}
 */
export function unsafePathReason(path: string): string | null {
  const traversal = traversalReason(path);
  if (traversal !== null) {
    return traversal;
  }
  return /[?#%]/.test(path)
    ? 'contains a "?", "#" or "%", which a URL path cannot carry unescaped'
    : null;
}

/**
 * Normalize a rendered route to the one form it is stored in: a leading `/`, no doubled or trailing
 * slash. The trailing slash a template ends with is style; whether the built URL carries one is the
 * site's `build.trailingSlash` setting, applied where the URL is written.
 *
 * Returns null when {@link unsafePathReason} finds a reason the path cannot be a route.
 */
export function normalizeRoute(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment !== "");
  if (unsafePathReason(segments.join("/")) !== null) {
    return null;
  }
  return `/${segments.join("/")}`;
}

/** The result of rendering a route: the path, or why there is none. */
export type RenderedRoute = { route: string } | { error: string };

/**
 * Render a content type's route for one entry.
 *
 * A directory index uses the `index` template when there is one; everything else uses `entry`.
 * Placeholders resolve to `id`, `dir` (the file's directory), `file` (its name without extension)
 * or a frontmatter field (`data.` optional prefix, dotted paths allowed), each passed through its
 * transforms in order. A missing or non-text field is an `error` naming the field, not a route with
 * a hole in it.
 */
export function renderRoute(spec: RouteSpec, subject: RouteSubject): RenderedRoute {
  const template = isDirectoryIndex(subject.path) && spec.index ? spec.index : spec.entry;
  let out = "";
  for (const token of template.tokens) {
    if ("literal" in token) {
      out += token.literal;
      continue;
    }
    let value = resolveName(token.name, subject);
    for (const transform of token.transforms) {
      value = value === null ? null : TRANSFORMS[transform]!(value);
    }
    /* `dir` may legitimately be empty (a file at the root); every other value must name something,
       or two entries would silently share the route with the placeholder blanked out. */
    if (value === null || (value === "" && token.name !== "dir")) {
      return {
        error: `field "${token.name}" (needed by "${token.source}" in ${template.source}) is missing, empty or is not text`,
      };
    }
    out += value;
  }
  const route = normalizeRoute(out);
  if (route === null) {
    return { error: `the route "${out}" ${unsafePathReason(out) ?? "is not a path"}` };
  }
  return { route };
}

// ─── matching a route against a page pattern ────────────────────────────────

/**
 * The route parameters a page pattern needs to produce `route`, or null when it cannot.
 *
 * `pattern` is a file-based route pattern (`/kb/:category/:slug`, `/kb/*`) and `names` its
 * parameter names in order. A static segment must match exactly, a `:name` takes one segment, and a
 * trailing `*` takes one or more and is reported under the page's last parameter name, which is
 * what `[...path].json` called it. This is what lets one `$paths: { contentType }` serve whatever
 * page shape the author chose, with no `param` to keep in step with the template.
 */
export function routeParams(
  route: string,
  pattern: string,
  names: readonly string[],
): Record<string, string> | null {
  const want = route.split("/").filter((segment) => segment !== "");
  const have = pattern.split("/").filter((segment) => segment !== "");
  const params: Record<string, string> = {};
  for (const [i, segment] of have.entries()) {
    if (segment === "*") {
      const rest = want.slice(i);
      if (i !== have.length - 1 || rest.length === 0) {
        return null;
      }
      params[names.at(-1) ?? "path"] = rest.join("/");
      return params;
    }
    if (i >= want.length) {
      return null;
    }
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = want[i]!;
    } else if (segment !== want[i]) {
      return null;
    }
  }
  return want.length === have.length ? params : null;
}

/**
 * The route as an `href` path: each segment percent-encoded, so a route that carries a space or a
 * non-ASCII letter is still a valid URL, joined with the site's trailing-slash setting.
 */
export function routeHref(route: string, trailingSlash: string, localePrefix = ""): string {
  const path = route
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const base = path === "" ? localePrefix : `${localePrefix}/${path}`;
  if (base === "") {
    return "/";
  }
  return trailingSlash === "never" ? base : `${base}/`;
}
