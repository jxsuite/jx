/**
 * Pages-discovery.js — File-based route discovery
 *
 * Scans the pages/ directory and builds a route table mapping URL paths to their source files,
 * layouts, and metadata. `.json` pages are native; any other extension must be claimed by a format
 * class (with the `parse` capability and a "page" document kind) provided by an enabled extension.
 *
 * Conventions (per site-architecture spec §4): pages/index.json → / pages/about.json → /about
 * pages/about/index.json → /about pages/blog/[slug].json → /blog/:slug (dynamic)
 * pages/docs/[...path].json → /docs/* (catch-all) pages/_component.json → NOT routed (underscore
 * prefix)
 *
 * The conventions themselves live in `@jxsuite/site/routes`, not here. The studio and the cloud
 * preview both have to answer "what URL is this file" and neither can import this package — its
 * dependency graph carries `sharp` and `esbuild` — so what remains in this file is the part that
 * genuinely needs a filesystem: the walk, the `$layout` peek, and `$paths` expansion.
 */

import { erasedDocument } from "../erased.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import { errorMessage } from "@jxsuite/schema/parse";
import { compareRoutes, fileToRoute as routeFromFileName } from "@jxsuite/site/routes";
import { pageCount, pageSlice, pageUrl, pagedSource, pagination } from "@jxsuite/site/pagination";
import type { PagePagination, PagedSource } from "@jxsuite/site/pagination";
import { extname, join, relative, resolve } from "node:path";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  FormatRegistry,
  PathParams,
  ResolvePathsContext,
} from "@jxsuite/schema/format-registry";
import type { JsonValue, JxDocument, JxPathsDef, ProjectConfig } from "@jxsuite/schema/types";
import { localeOfRoute } from "./i18n.ts";
import type { ResolvedI18n } from "./i18n.ts";
import type { ProjectSections } from "./project-sections.ts";
import { nodeImportRebaser } from "./context-injection.ts";
import { resolvePrototypes } from "./prototype-resolver.ts";

interface Route {
  urlPattern: string; // URL pattern (e.g. "/blog/:slug")
  sourcePath: string; // Absolute path to the source file
  relativePath: string; // Path relative to pages/ dir
  isDynamic: boolean; // Whether route has parameters
  isCatchAll: boolean; // Whether route uses [...param] spread
  params: string[]; // Parameter names (e.g. ["slug"])
  $layout: string | null; // Layout override from page frontmatter, if any
  _pathParams?: Record<string, string>; // Resolved path parameters
  /**
   * The timestamp of the thing this concrete route was generated FROM, when that is not the
   * template file. A collection route's source is an entry; `sourcePath` still points at the
   * `[slug].json` that rendered it, so without this every post in an archive reports the template's
   * mtime and the whole collection looks edited whenever the template is.
   */
  sourceMtime?: string;
  /** Set on a page of a paged list (site-architecture.md §4.3); becomes `$page.pagination`. */
  pagination?: PagePagination;
  /**
   * The page's slice of a paged list, seeded into `state` before prototypes resolve, so the list is
   * resolved once while the route is expanded and not again for every page.
   */
  pagedState?: { key: string; items: JsonValue[] };
}

/** Where `expandDynamicRoutes` reports a page it cannot expand. */
export interface ExpandOptions {
  /** Collects one message per misconfigured route; without it the first one throws. */
  errors?: string[];
}

/**
 * Read a page document, dispatching by extension: .json natively, anything else via the format
 * registry's parse capability.
 *
 * @param {string} filePath - Absolute path to the page source
 * @param {FormatRegistry} [registry]
 * @returns {Promise<JxDocument>}
 */
export async function readPageDocument(
  filePath: string,
  registry?: FormatRegistry,
): Promise<JxDocument> {
  const source = readFileSync(filePath, "utf8");
  if (isNativeDocumentPath(filePath)) {
    return erasedDocument(parseNativeDocument(source, filePath), filePath);
  }
  const ext = extname(filePath).toLowerCase();
  const entry = registry?.byExtension(ext, "parse");
  if (!entry) {
    throw new Error(
      `No format class registered for "${ext}" (${filePath}). ` +
        `Enable an extension providing this format in project.json "extensions", ` +
        `e.g. "@jxsuite/parser".`,
    );
  }
  // A format's page holds function bodies too (spec.md §23.1).
  return erasedDocument(await entry.parseDocument(source), filePath);
}

/**
 * The `$translationKey` each route's document declares, for the routes that declare one.
 *
 * A **pre-pass**, because a page's alternates depend on the whole route table (§13.5): the set has
 * to be complete before the first page is compiled, so a document cannot tell the build what its
 * key is while it is being compiled.
 *
 * The file is read and the **parse is skipped** unless the text mentions the key. Most pages of a
 * multilingual site never declare one — their paths are parallel and the derivation is right — so
 * paying a second full parse for every page to find a key that is usually absent would be a cost
 * with nothing behind it. Documents sharing a source (a `$paths` template's expansions) are read
 * once.
 *
 * A document that fails to parse is skipped rather than thrown from here. It will fail again a
 * moment later while being compiled, where the error names the page and the rest of the site still
 * builds; failing in a pre-pass would turn one bad page into no site at all.
 *
 * **A key may name its route's parameters**, as `${slug}`, and that is what makes a collection's
 * localized URLs work: one `[slug]` template expands to one route per entry, so a key that could
 * not vary per entry would claim a single identity for the whole collection and the build would
 * report it as a duplicate. `pages/fr-ca/expositions/[slug].json` declaring `"exhibitions/${slug}"`
 * pairs each French post with the English one it translates, because two translations of an entry
 * share an id (§13.3) and the id is what the parameter carries.
 *
 * @param {readonly {
 *   sourcePath: string;
 *   urlPattern: string;
 *   _pathParams?: Record<string, string>;
 * }[]} routes
 *   - Concrete routes
 * @param {FormatRegistry} [registry]
 * @returns {Promise<Map<string, string>>} Keyed by `urlPattern`
 */
export async function readTranslationKeys(
  routes: readonly {
    sourcePath: string;
    urlPattern: string;
    _pathParams?: Record<string, string> | undefined;
  }[],
  registry?: FormatRegistry,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byFile = new Map<string, string | null>();
  for (const route of routes) {
    if (!byFile.has(route.sourcePath)) {
      byFile.set(route.sourcePath, await declaredTranslationKey(route.sourcePath, registry));
    }
    const key = byFile.get(route.sourcePath);
    if (key !== null && key !== undefined) {
      out.set(route.urlPattern, withRouteParams(key, route._pathParams));
    }
  }
  return out;
}

/**
 * Substitute a route's own parameters into a declared key.
 *
 * A parameter with no value is left as it was written rather than blanked: a key that quietly
 * became `exhibitions/` would pair every entry in the collection with every other, which is a
 * duplicate the build reports — and the report naming `${slug}` says what is actually wrong.
 *
 * @param {string} key
 * @param {Record<string, string> | undefined} params
 * @returns {string}
 */
function withRouteParams(key: string, params: Record<string, string> | undefined): string {
  if (!key.includes("${")) {
    return key;
  }
  return key.replaceAll(/\$\{(\w+)\}/g, (whole, name: string) => params?.[name] ?? whole);
}

/**
 * One document's `$translationKey`, or null when it declares none or cannot be read.
 *
 * @param {string} sourcePath
 * @param {FormatRegistry} [registry]
 * @returns {Promise<string | null>}
 */
async function declaredTranslationKey(
  sourcePath: string,
  registry?: FormatRegistry,
): Promise<string | null> {
  if (!readFileSync(sourcePath, "utf8").includes("$translationKey")) {
    return null;
  }
  let doc: JxDocument;
  try {
    doc = await readPageDocument(sourcePath, registry);
  } catch {
    return null;
  }
  return isString(doc.$translationKey) && doc.$translationKey !== "" ? doc.$translationKey : null;
}

/**
 * Discover all routable pages in a pages/ directory.
 *
 * @param {string} pagesDir - Absolute path to the pages/ directory
 * @param {FormatRegistry} [registry] - Format registry; its "page"-kind extensions are routable
 * @returns {Promise<Route[]>} Sorted route table (static routes first, then dynamic)
 */
export async function discoverPages(pagesDir: string, registry?: FormatRegistry) {
  const routes: Route[] = [];
  const pageExtensions = new Set([
    ".json",
    ".jxn",
    ...(registry?.documentExtensions("page") ?? []),
  ]);
  await walkDir(pagesDir, pagesDir, routes, pageExtensions, registry);

  // Static routes first, then dynamic, then catch-all (spec §4.4) — the shared ordering.
  routes.sort(compareRoutes);

  return routes;
}

/**
 * Recursively walk the pages directory tree.
 *
 * @param {string} dir
 * @param {string} pagesRoot
 * @param {Route[]} routes
 * @param {Set<string>} pageExtensions
 * @param {FormatRegistry} [registry]
 */
async function walkDir(
  dir: string,
  pagesRoot: string,
  routes: Route[],
  pageExtensions: Set<string>,
  registry?: FormatRegistry,
) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip underscore-prefixed directories
      if (entry.name.startsWith("_")) {
        continue;
      }
      await walkDir(fullPath, pagesRoot, routes, pageExtensions, registry);
      continue;
    }

    // Only process .json and registered page-format files
    const ext = extname(entry.name).toLowerCase();
    if (!pageExtensions.has(ext)) {
      continue;
    }

    // Skip underscore-prefixed files (local components, not routes)
    if (entry.name.startsWith("_")) {
      continue;
    }

    const relativePath = relative(pagesRoot, fullPath);
    routes.push(await fileToRoute(relativePath, fullPath, registry));
  }
}

/**
 * Convert a file path relative to pages/ into a Route object.
 *
 * @param {string} relativePath - E.g. "blog/[slug].json"
 * @param {string} absolutePath - Full filesystem path
 * @param {FormatRegistry} [registry]
 * @returns {Promise<Route>}
 */
async function fileToRoute(relativePath: string, absolutePath: string, registry?: FormatRegistry) {
  const { isCatchAll, isDynamic, params, urlPattern } = routeFromFileName(relativePath);

  // Peek at the page to extract $layout if present
  let $layout: string | null = null;
  try {
    const doc = await readPageDocument(absolutePath, registry);
    const layout = doc.$layout;
    if (isString(layout)) {
      $layout = layout;
    }
  } catch {
    // Skip unreadable files — will error during compilation
  }

  return {
    $layout,
    isCatchAll,
    isDynamic,
    params,
    relativePath,
    sourcePath: absolutePath,
    urlPattern,
  };
}

/**
 * The reserved key a `resolvePaths` result may carry alongside its route parameters.
 *
 * A route parameter comes from a `[bracket]` segment in a filename, so this name cannot collide
 * with one by accident, and it matches what the content loader already calls the same data on an
 * entry (`parser.md` §9.3) — so a fact about an entry keeps one name from the file it was read out
 * of all the way to the sitemap.
 */
const PATH_ENTRY_META = "_meta";

/**
 * The entry timestamp carried on a `$paths` result, or null when there is none.
 *
 * Null is ordinary: the core `$paths` shapes (`values`, `$ref`, a literal array) describe route
 * parameters and nothing else, and a route with no entry of its own correctly falls back to its
 * template's own modification time.
 *
 * @param {PathParams} pathEntry
 * @returns {string | null}
 */
function entryMtime(pathEntry: PathParams): string | null {
  const meta = pathEntry[PATH_ENTRY_META];
  if (!isJsonObject(meta)) {
    return null;
  }
  const { mtime } = meta;
  return isString(mtime) && mtime !== "" ? mtime : null;
}

/**
 * Why a concrete page URL would write outside the output directory, or null when it would not: a
 * `.` or `..` segment, a backslash or a NUL.
 *
 * @param {string} url - The route with its parameters substituted
 * @returns {string | null}
 */
function traversalIn(url: string): string | null {
  if (url.includes("\0")) {
    return "has a NUL character";
  }
  for (const segment of url.split("/")) {
    if (segment === "." || segment === "..") {
      return 'has a "." or ".." segment';
    }
    if (segment.includes("\\")) {
      return "has a backslash";
    }
  }
  return null;
}

/**
 * Expand dynamic routes by resolving $paths from each dynamic page.
 *
 * Supports these $paths shapes (per spec §4.3): 1. Explicit values: { values: ["en", "fr"], param:
 * "lang" } 2. Data file ref: { "$ref": "./data/products.json", param: "id", field: "sku" } 3.
 * Legacy array: [{ slug: "hello" }, { slug: "world" }] 4. Extension-discriminated: any object
 * carrying a key an enabled extension registered as its `resolvePaths` discriminator (e.g. the
 * parser's { contentType: "blog", param: "slug" }).
 *
 * @param {Route[]} routes - Discovered route table
 * @param {string} projectRoot - Project root for resolving $ref paths
 * @param {ProjectSections} [sections] - Loaded project sections (projectData results)
 * @param {ExtensionRegistry} [registry] - Extension registry (formats view reads non-JSON pages)
 * @param {ProjectConfig} [projectConfig] - Already-loaded project config
 * @returns {Promise<Route[]>} Expanded routes with concrete paths
 */
export async function expandDynamicRoutes(
  routes: Route[],
  projectRoot: string,
  sections: ProjectSections = {},
  registry?: ExtensionRegistry,
  projectConfig?: ProjectConfig,
  i18n?: ResolvedI18n | null,
  options: ExpandOptions = {},
) {
  const expanded: Route[] = [];
  const report = (route: Route, message: string): void => {
    const text = `Dynamic route ${route.urlPattern}: ${message}`;
    if (options.errors === undefined) {
      throw new Error(text);
    }
    options.errors.push(text);
  };
  /**
   * Every dynamic page's pattern, so an extension can tell a route no page produces from one a
   * different page does.
   */
  const dynamicPatterns = routes.flatMap((r) => (r.isDynamic ? [r.urlPattern] : []));

  for (const route of routes) {
    if (!route.isDynamic) {
      expanded.push(route);
      continue;
    }

    // Read the page to look for $paths
    let raw: JxDocument;
    try {
      raw = await readPageDocument(route.sourcePath, registry?.formats);
    } catch {
      expanded.push(route);
      continue;
    }

    if (!raw.$paths) {
      console.warn(`Warning: dynamic route ${route.urlPattern} has no $paths — skipping`);
      continue;
    }

    let paged: PagedSource | null;
    try {
      paged = pagedSource(raw.$paths);
    } catch (error) {
      report(route, errorMessage(error));
      continue;
    }
    if (paged !== null) {
      const locale = localeOfRoute(route.urlPattern, i18n ?? null);
      const each =
        paged.each === undefined
          ? [{}]
          : await resolvePathEntries(
              // SAFETY: `pagedSource` proved `each` an object or an array, the two `$paths` forms.
              paged.each as JxPathsDef,
              projectRoot,
              sections,
              registry,
              projectConfig,
              locale,
              route,
              dynamicPatterns,
            );
      for (const outer of each) {
        const pages = await expandPagedRoute(route, raw, paged, outer, {
          locale,
          projectConfig,
          projectRoot,
          registry,
          report,
          sections,
        });
        expanded.push(...pages);
      }
      continue;
    }

    const pathEntries = await resolvePathEntries(
      raw.$paths,
      projectRoot,
      sections,
      registry,
      projectConfig,
      // The template's OWN prefix, read before expansion: `/fr/blog/:slug` is a French route
      // Whatever its entries turn out to be called, and that is what scopes a localized collection.
      localeOfRoute(route.urlPattern, i18n ?? null),
      route,
      dynamicPatterns,
    );

    for (const pathEntry of pathEntries) {
      let concreteUrl = route.urlPattern;
      const params: Record<string, string> = {};
      for (const [param, value] of Object.entries(pathEntry)) {
        // `_meta` is the reserved carrier for facts about the source ENTRY (extensions.md §8).
        // It is not a route parameter and must never reach substitution.
        if (param === PATH_ENTRY_META) {
          continue;
        }
        params[param] = String(value);
        concreteUrl = concreteUrl.replace(`:${param}`, params[param]);
        concreteUrl = concreteUrl.replace("*", params[param]);
      }

      /* A parameter value is data (a frontmatter field, a file name) and becomes part of the path the
         page is written to. One that climbs out of the output directory is not a page. */
      const escapes = traversalIn(concreteUrl);
      if (escapes !== null) {
        console.warn(
          `Warning: $paths for ${route.urlPattern} produced "${concreteUrl}", which ${escapes}; ` +
            `skipping it`,
        );
        continue;
      }

      const mtime = entryMtime(pathEntry);
      /* `urlPattern` is already one of `route`'s own keys, so the spread fixes its position and
         adding `sourceMtime` last leaves every key where the expanded route always had it. */
      const concrete: Route = {
        ...route,
        _pathParams: params,
        isCatchAll: false,
        isDynamic: false,
        params: [],
        urlPattern: concreteUrl,
      };
      if (mtime !== null) {
        concrete.sourceMtime = mtime;
      }
      expanded.push(concrete);
    }
  }

  return expanded;
}

/** What {@link expandPagedRoute} needs from the expansion around it. */
interface PagedContext {
  locale: string | null;
  projectConfig: ProjectConfig | undefined;
  projectRoot: string;
  registry: ExtensionRegistry | undefined;
  report: (route: Route, message: string) => void;
  sections: ProjectSections;
}

/**
 * A route pattern with the given parameters substituted: a named one replaces its `:name`, and the
 * one the pattern does not name is the catch-all's `*`.
 */
function substitute(urlPattern: string, params: Record<string, string>): string {
  let url = urlPattern;
  for (const [name, value] of Object.entries(params)) {
    const named = new RegExp(`:${name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(?=/|$)`);
    url = named.test(url) ? url.replace(named, () => value) : url.replace("*", () => value);
  }
  return url;
}

/**
 * The pages of one paged list: the route's other parameters fixed by `outer` (one value of its
 * `each` source, or none), the page number filling the one parameter left.
 *
 * @param {Route} route - The dynamic page
 * @param {JxDocument} raw - Its document
 * @param {PagedSource} paged - Its `$paths`
 * @param {PathParams} outer - The parameters `each` gave this list
 * @param {PagedContext} ctx
 * @returns {Promise<Route[]>} One concrete route per page; none when the source is misconfigured,
 *   which is reported
 */
async function expandPagedRoute(
  route: Route,
  raw: JxDocument,
  paged: PagedSource,
  outer: PathParams,
  ctx: PagedContext,
): Promise<Route[]> {
  const fixed: Record<string, string> = {};
  for (const [name, value] of Object.entries(outer)) {
    if (name !== PATH_ENTRY_META) {
      fixed[name] = String(value);
    }
  }
  const left = route.params.filter((name) => !(name in fixed));
  if (left.length !== 1) {
    ctx.report(
      route,
      `a paged route takes exactly one parameter besides those its each source fills; ` +
        `this one has ${left.length}`,
    );
    return [];
  }
  /* SAFETY: `left` was just proved to hold exactly one name. */
  const pageParam = left[0] as string;
  if (raw.state?.[paged.key] === undefined) {
    ctx.report(
      route,
      `$paths.paginate names state entry "${paged.key}", which this page does not declare`,
    );
    return [];
  }
  const listPattern = substitute(route.urlPattern, fixed);
  const escapes = traversalIn(listPattern);
  if (escapes !== null) {
    console.warn(
      `Warning: $paths for ${route.urlPattern} produced "${listPattern}", which ${escapes}; skipping it`,
    );
    return [];
  }
  const items = await resolvePagedEntry(raw, paged.key, route, fixed, ctx);
  if (!Array.isArray(items)) {
    ctx.report(route, `state entry "${paged.key}" did not resolve to an array at build time`);
    return [];
  }
  const newest = newestItemMtime(items, route.sourcePath);
  const count = pageCount(items.length, paged.pageSize);
  const pages: Route[] = [];
  for (let number = 1; number <= count; number++) {
    const concrete: Route = {
      ...route,
      _pathParams: { ...fixed, [pageParam]: String(number) },
      isCatchAll: false,
      isDynamic: false,
      pagedState: { items: pageSlice(items, number, paged.pageSize), key: paged.key },
      pagination: pagination(listPattern, number, paged.pageSize, items.length),
      params: [],
      urlPattern: pageUrl(listPattern, number),
    };
    if (newest !== null) {
      concrete.sourceMtime = newest;
    }
    pages.push(concrete);
  }
  return pages;
}

/**
 * The newest `_meta.mtime` of the list's items when it is later than the template's own, kept as
 * the item wrote it; null otherwise. One new or edited entry can move every page, so every page is
 * dated by the newest of them (§8.4.1).
 */
function newestItemMtime(items: readonly JsonValue[], sourcePath: string): string | null {
  let newest: string | null = null;
  let newestTime = statSync(sourcePath).mtime.getTime();
  for (const item of items) {
    const meta = isJsonObject(item) ? item[PATH_ENTRY_META] : undefined;
    const mtime = isJsonObject(meta) ? meta.mtime : undefined;
    if (isString(mtime) && Date.parse(mtime) > newestTime) {
      newestTime = Date.parse(mtime);
      newest = mtime;
    }
  }
  return newest;
}

/**
 * The paged entry as the build resolves it for the route `fixed` names: a literal array as it is, a
 * class entry through {@link resolvePrototypes} over a document holding that entry alone and the
 * page's imports merged with the project's (rebased as the page's own would be). Only the entry is
 * resolved, so a filter in it may read the route's parameters but not the page's other state.
 */
async function resolvePagedEntry(
  raw: JxDocument,
  key: string,
  route: Route,
  fixed: Record<string, string>,
  ctx: PagedContext,
): Promise<JsonValue | undefined> {
  const def = raw.state?.[key];
  if (def === undefined || Array.isArray(def)) {
    return def;
  }
  const imports: Record<string, string> = {};
  const rebase = nodeImportRebaser(ctx.projectRoot);
  for (const [name, src] of Object.entries(ctx.projectConfig?.imports ?? {})) {
    imports[name] = src.startsWith("./") || src.startsWith("../") ? rebase(src, route) : src;
  }
  Object.assign(imports, raw.imports);
  const mini: JxDocument = { imports, state: { [key]: structuredClone(def) } };
  const pageRoute = {
    _pathParams: fixed,
    locale: ctx.locale,
    sourcePath: route.sourcePath,
    urlPattern: substitute(route.urlPattern, fixed),
  };
  await resolvePrototypes(mini, pageRoute, ctx.projectRoot, {
    ...(ctx.projectConfig && { config: ctx.projectConfig }),
    ...(ctx.registry && { registry: ctx.registry }),
    sections: ctx.sections,
  });
  /* SAFETY: a resolved class entry is the JSON its `resolve()` answered with, and an unresolved
     one is the definition object, which the caller rejects as not an array. */
  return mini.state?.[key] as JsonValue | undefined;
}

/**
 * Resolve $paths into an array of param objects.
 *
 * Core shapes (array / `values` / `$ref`) are handled inline; any other object dispatches through
 * the extension registry — the first key with a registered `resolvePaths` discriminator routes the
 * whole $paths value to the owning class, with its section's loaded data as context.
 *
 * @param {import("@jxsuite/schema/types").JxPathsDef} $paths - The $paths declaration
 * @param {string} projectRoot
 * @param {ProjectSections} sections - Loaded project sections keyed by section key
 * @param {ExtensionRegistry} [registry]
 * @param {ProjectConfig} [projectConfig]
 * @param {string | null} [locale] - The locale the route being expanded belongs to
 * @param {Route} [route] - The dynamic page being expanded; its pattern and parameter names reach
 *   an extension's `resolvePaths` so it can produce exactly the parameters this page needs
 * @param {readonly string[]} [patterns] - The pattern of every dynamic page in the project
 * @returns {Promise<PathParams[]>} Array of { paramName: value } objects
 */
async function resolvePathEntries(
  $paths: JxPathsDef,
  projectRoot: string,
  sections: ProjectSections,
  registry?: ExtensionRegistry,
  projectConfig?: ProjectConfig,
  locale?: string | null,
  route?: Pick<Route, "urlPattern" | "params">,
  patterns?: readonly string[],
): Promise<PathParams[]> {
  // Legacy: array of param objects
  if (Array.isArray($paths)) {
    return $paths;
  }

  // Explicit values: { values: ["en", "fr"], param: "lang" }
  if ("values" in $paths && Array.isArray($paths.values)) {
    const param = isString($paths.param) ? $paths.param : "value";
    return $paths.values.map((v) => ({ [param]: v }));
  }

  // Data file ref: { "$ref": "./data/products.json", param: "id", field: "sku" }
  if ("$ref" in $paths && isString($paths.$ref) && $paths.$ref) {
    const refPath = $paths.$ref;
    const filePath = resolve(projectRoot, refPath);
    let data: JsonValue;
    try {
      // SAFETY: JSON.parse only ever yields JSON values; its `any` return type says nothing more.
      data = JSON.parse(readFileSync(filePath, "utf8")) as JsonValue;
    } catch (error) {
      console.warn(`Warning: $paths.$ref could not load "${refPath}": ${errorMessage(error)}`);
      return [];
    }
    if (!Array.isArray(data)) {
      console.warn(`Warning: $paths.$ref "${refPath}" must be a JSON array`);
      return [];
    }
    const param = isString($paths.param) ? $paths.param : "id";
    const field = isString($paths.field) ? $paths.field : "id";
    return data.map((item) => {
      /* A null row has no field to read and no meaningful string form: fail the build rather than
         emit a route whose parameter is the literal "null". */
      if (item === null) {
        throw new TypeError(`$paths.$ref "${refPath}" contains a null entry`);
      }
      return {
        [param]: (isJsonObject(item) ? (item[field] ?? item.id) : undefined) ?? String(item),
      };
    });
  }

  // Extension-discriminated: the first key with a registered resolvePaths discriminator routes
  // The whole value to the owning class (specs/extensions.md §8).
  for (const key of Object.keys($paths)) {
    const entry = registry?.byPathsDiscriminator(key);
    if (!entry?.project) {
      continue;
    }
    const context: ResolvePathsContext = {
      data: sections[entry.project.key],
      locale,
      projectConfig,
      root: projectRoot,
    };
    if (route !== undefined) {
      context.params = route.params;
      context.urlPattern = route.urlPattern;
    }
    if (patterns !== undefined) {
      context.patterns = patterns;
    }
    return await entry.call("resolvePaths", $paths, context);
  }

  console.warn(`Warning: unrecognized $paths shape — skipping`);
  return [];
}
