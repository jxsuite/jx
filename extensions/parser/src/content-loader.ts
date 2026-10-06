/**
 * Content-loader — format-agnostic loader for the `content` project section
 *
 * Implements the parser extension's `project` capabilities (specs/extensions.md §9): `Content` owns
 * the project.json `content` section. JSON sources are handled natively (Jx IS JSON); every other
 * format dispatches through the format registry view of the extension registry — the format class's
 * `discover` capability lists entry files and its `load` capability parses each into
 * ContentLoaderEntry[].
 *
 * There are no implicit format defaults: a content type either names a format class provided by an
 * enabled extension via its `format` key, or its source extension must match a registered format.
 * Remote http(s) sources require an explicit `format` whose class declares `format.remote: true`.
 *
 * Runs with `timing: ["compiler", "server"]` only (node `fs` on the code path, like
 * Markdown.discover).
 *
 * @module @jxsuite/parser/content-loader
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { assetUrlFor } from "@jxsuite/schema/asset-paths";
import { localeUrlPrefix, resolveI18n } from "@jxsuite/schema/locale";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { FormatEntry, FormatHostIO, FormatRegistry } from "@jxsuite/schema/format-registry";
import type {
  ContentTypeSchema,
  JxElement,
  JxMutableNode,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { normalizeAlerts } from "./alerts.ts";
import { rewriteLinks } from "./content-links.ts";
import type { FileOutcome, LinkIndex } from "./content-links.ts";
import {
  directoryOf,
  isDirectoryIndex,
  parseRouteConfig,
  renderRoute,
  routeHref,
  routeParams,
} from "./content-routes.ts";
import type { RouteSpec } from "./content-routes.ts";
import { compileExclude, compileWhere } from "./content-rules.ts";
import type { ExcludeMatcher, WherePredicate } from "./content-rules.ts";
import { coerceEntryDates, isCoercedDate, isDateFormat } from "./dates.ts";
import type { ContentLoaderEntry, ContentTypeDef } from "./types.ts";
import { walkFiles } from "./walk.ts";

export type { ContentEntry, ContentLoaderEntry, TocEntry } from "./types.ts";

// ─── Context and section shapes ──────────────────────────────────────────────

/** The value of the project.json `content` section: content type name → definition. */
export type ContentSection = Record<string, ContentTypeDef>;

/** Host context passed to `Content.projectData` (specs/extensions.md §8). */
export interface ProjectDataContext {
  projectConfig?: ProjectConfig;
  /** Absolute project root directory. */
  root: string;
  /** The project's extension registry; format dispatch goes through its `formats` view. */
  registry: ExtensionRegistry;
  /** Injected host I/O (unused here — this loader is node-only by its declared timing). */
  io?: FormatHostIO;
}

/** Host context passed to `Content.resolvePaths` (specs/extensions.md §8). */
export interface ResolvePathsContext {
  /** The loaded section data, as returned by `Content.projectData`. */
  data: Map<string, ContentLoaderEntry[]>;
  projectConfig?: ProjectConfig;
  /** Absolute project root directory. */
  root: string;
  /**
   * The locale of the route being expanded, when the project has any. Only a localized collection
   * reads it — it is the discriminator between two translations sharing an id.
   */
  locale?: string | null;
  /**
   * The URL pattern of the dynamic page being expanded (`/kb/:category/:slug`, `/kb/*`) and its
   * parameter names in order. A content type with a `route` reads them to turn each entry's route
   * into the parameters THIS page needs, so `$paths` never has to name a parameter.
   */
  urlPattern?: string;
  params?: readonly string[];
}

/** The `$paths` value shape routed to this extension by its `contentType` discriminator. */
export interface ContentPathsSource {
  contentType: string;
  param?: string;
  field?: string;
}

// ─── JSON loader (the single native built-in format) ─────────────────────────

/**
 * Load a JSON file into ContentEntry(s). If the file is an array, each element is an entry. If it's
 * an object with an `id` field, it's a single entry.
 *
 * @param {string} filePath - Absolute path to .json file
 * @returns {ContentLoaderEntry[]} Array of ContentEntry shapes
 */
function loadJSONEntries(filePath: string): ContentLoaderEntry[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[]).map((item: Record<string, unknown>, i: number) => ({
      body: null,
      data: item,
      id: (item.id as string) ?? `${basename(filePath, ".json")}-${i}`,
    }));
  }
  // Single object file — filename is the id
  const rawObj = raw as Record<string, unknown>;
  return [
    {
      body: null,
      data: rawObj,
      id: (rawObj.id as string) ?? basename(filePath, ".json"),
    },
  ];
}

/** Discover .json entry files for a source (single file or directory), in sorted order. */
function discoverJSONFiles(resolvedSource: string, exclude: ExcludeMatcher): string[] {
  if (extname(resolvedSource)) {
    return existsSync(resolvedSource) ? [resolvedSource] : [];
  }
  return walkFiles(resolvedSource, (name) => name.endsWith(".json"), exclude);
}

// ─── Asset mounts and content-relative references ────────────────────────────

/**
 * The placeholder a content type's `source` may carry to say "one directory per locale".
 *
 * `./blog/{locale}/` is one content type spread over N directories, not N content types. That
 * distinction is what keeps a translated post the same post: it keeps one schema, one set of
 * relationship targets, and one name in `$paths`, and differs only in which directory it was read
 * from — which is exactly the model `site-architecture.md` §13 uses for routes.
 */
export const LOCALE_PLACEHOLDER = "{locale}";

/**
 * The locales a `{locale}` source expands over, or `[]` when the project declares none.
 *
 * The **canonical** tags, from the same resolver the compiler and Studio run — it lives in
 * `@jxsuite/schema/locale` precisely so that three hosts cannot disagree about what `EN-us` means.
 * This module used to read the raw list, on the reasoning that canonicalization was the compiler's
 * job; that was true when the function was the compiler's, and it left this the one place where a
 * locale's spelling came from the config rather than from the parser.
 *
 * @param {ProjectConfig | undefined} projectConfig
 * @returns {string[]}
 */
export function localesForExpansion(projectConfig: ProjectConfig | undefined): string[] {
  return resolveI18n(projectConfig ?? {}).i18n?.locales ?? [];
}

/**
 * The directory a locale's entries live in, out of the spellings that can legitimately be on disk.
 *
 * A locale directory is matched **case-insensitively**, because two writers name it and they
 * differ: a project that declared `fr-CA` most likely typed `fr-CA/`, while Studio creates
 * `content/<type>/fr-ca/` — lowercase, because a page directory becomes a URL and the site's own
 * URLs are lowercase (`site-architecture.md` §13.2). Reading only one of the two spellings makes a
 * translation somebody just created invisible to the build, with no error: the directory is there,
 * the entries are there, and the collection loads none of them.
 *
 * The canonical spelling is preferred so an existing tree keeps its own answer, and a scan of the
 * parent runs only when neither exact spelling exists.
 *
 * @param {string} root
 * @param {string} source - The `{locale}`-bearing source
 * @param {string} locale - Canonical tag
 * @returns {string} The source with `{locale}` replaced by the spelling that is on disk
 */
export function localeSource(root: string, source: string, locale: string): string {
  const candidates = [locale, locale.toLowerCase()];
  for (const spelling of candidates) {
    const path = source.split(LOCALE_PLACEHOLDER).join(spelling);
    if (existsSync(resolve(root, path))) {
      return path;
    }
  }
  const parent = resolve(root, source.slice(0, source.indexOf(LOCALE_PLACEHOLDER)));
  if (existsSync(parent) && statSync(parent).isDirectory()) {
    const match = readdirSync(parent).find((name) => name.toLowerCase() === locale.toLowerCase());
    if (match !== undefined) {
      return source.split(LOCALE_PLACEHOLDER).join(match);
    }
  }
  /* Nothing on disk: the canonical spelling, so the miss is reported against the name that was
     declared rather than against a spelling nobody wrote. */
  return source.split(LOCALE_PLACEHOLDER).join(locale);
}

/** The project.json section key this class owns; also the URL namespace for its asset mounts. */
const SECTION_KEY = "content";

/** Content type names safe to place in a URL path segment unescaped. */
const SAFE_TYPE_NAME = /^[\w.~-]+$/;

/** Node keys whose value is a media reference the rewrite may remap. */
const ASSET_KEYS = ["src", "poster"] as const;

/** A value that is already a URL, a template, or a fragment — never a content-relative file. */
function isNonRelativeRef(value: string): boolean {
  return (
    value === "" ||
    value.startsWith("/") ||
    value.startsWith("#") ||
    value.includes("${") ||
    /^[a-z][\w+.-]*:/i.test(value)
  );
}

/**
 * Asset mounts for a `content` section: every content type whose source is a local **directory**
 * publishes that directory at `/content/<type>`, so files sitting beside the entries (images,
 * downloads) have a stable site URL even when the source lives outside the project root.
 * Single-file and remote sources get no mount — a lone file's siblings are not its collection.
 *
 * @param {ContentSection} section - The project.json `content` section value
 * @param {string} root - Absolute project root directory
 * @returns {AssetMount[]} One mount per eligible content type, in declaration order
 */
export function contentAssetMounts(
  section: ContentSection,
  root: string,
  projectConfig?: ProjectConfig,
): AssetMount[] {
  const mounts: AssetMount[] = [];
  const locales = localesForExpansion(projectConfig);
  for (const [name, contentTypeDef] of Object.entries(section ?? {})) {
    const source = contentTypeDef?.source;
    if (!source || source.startsWith("http://") || source.startsWith("https://")) {
      continue;
    }
    /*
     * A localized source is N directories, so it is N mounts — published under
     * `/content/<type>/<locale>` so a French post's `./hero.png` and its English translation's
     * cannot collide at one URL.
     */
    if (source.includes(LOCALE_PLACEHOLDER)) {
      for (const locale of locales) {
        if (!SAFE_TYPE_NAME.test(locale)) {
          continue;
        }
        const dir = resolve(root, localeSource(root, source, locale))
          .split("\\")
          .join("/");
        if (SAFE_TYPE_NAME.test(name) && existsSync(dir) && statSync(dir).isDirectory()) {
          mounts.push({ dir, urlPrefix: `/${SECTION_KEY}/${name}/${locale}` });
        }
      }
      continue;
    }
    if (!SAFE_TYPE_NAME.test(name)) {
      console.warn(
        `Content type "${name}": name is not URL-safe — its source directory is not published ` +
          `at /${SECTION_KEY}/${name}, so content-relative asset references stay unresolved.`,
      );
      continue;
    }
    const resolvedSource = resolve(root, source).split("\\").join("/");
    if (extname(source) || !existsSync(resolvedSource) || !statSync(resolvedSource).isDirectory()) {
      continue;
    }
    mounts.push({ dir: resolvedSource, urlPrefix: `/${SECTION_KEY}/${name}` });
  }
  return mounts;
}

/**
 * Rewrite one content-relative reference to its mounted URL, or null to leave the value untouched.
 * A value is rewritten only when it is relative, resolves against the entry's own directory to a
 * file that exists, and lands inside the mount — so nothing an existing project authored (a
 * project-root-relative path, an absolute URL, a bound template) changes meaning.
 */
function rewriteRef(
  value: string,
  entryDir: string,
  mount: AssetMount,
  onMissing: (value: string) => void,
): string | null {
  if (isNonRelativeRef(value)) {
    return null;
  }
  const bare = value.split("#")[0]!.split("?")[0]!;
  let target: string;
  try {
    target = resolve(entryDir, decodeURIComponent(bare));
  } catch {
    return null;
  }
  const url = assetUrlFor([mount], target);
  if (!url) {
    return null; // Resolves outside the collection — not ours to publish
  }
  if (!existsSync(target)) {
    onMissing(value);
    return null;
  }
  const suffix = value.slice(bare.length);
  return `${url}${suffix}`;
}

/** Rewrite media references on one node and its children, in place. */
function rewriteNodeAssets(
  node: JxElement | string | undefined,
  entryDir: string,
  mount: AssetMount,
  onMissing: (value: string) => void,
) {
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as unknown as Record<string, unknown>;
  const attributes = record.attributes as Record<string, unknown> | undefined;
  for (const key of ASSET_KEYS) {
    for (const holder of [record, attributes]) {
      const value = holder?.[key];
      if (typeof value === "string") {
        const rewritten = rewriteRef(value, entryDir, mount, onMissing);
        if (rewritten) {
          holder![key] = rewritten;
        }
      }
    }
  }
  const { children } = record;
  if (Array.isArray(children)) {
    for (const child of children) {
      rewriteNodeAssets(child as JxElement | string, entryDir, mount, onMissing);
    }
  }
}

/**
 * Remap an entry's content-relative asset references onto the content type's mount.
 *
 * Markdown that says `![…](../images/hero.png)` reads correctly in any editor and, after this pass,
 * renders as `/content/<type>/images/hero.png` everywhere the entry is used. Frontmatter is
 * remapped only for fields the content-type schema declares `"format": "uri-reference"` — the
 * schema is what distinguishes a media path from an ordinary string. The raw `body` is never
 * touched: it is the round-trip source Studio writes back to disk.
 *
 * @param {ContentLoaderEntry[]} entries - Entries loaded from one source file (mutated in place)
 * @param {string} filePath - Absolute path of that source file
 * @param {AssetMount} mount - The content type's asset mount
 * @param {string} typeName - Content type name, for warnings
 * @param {ContentTypeSchema} [schema] - Content type schema, for `uri-reference` fields
 */
export function rewriteEntryAssets(
  entries: ContentLoaderEntry[],
  filePath: string,
  mount: AssetMount,
  typeName: string,
  schema?: ContentTypeSchema,
) {
  const entryDir = dirname(filePath);
  const uriFields = Object.entries(schema?.properties ?? {})
    .filter(([, def]) => def?.format === "uri-reference" || def?.items?.format === "uri-reference")
    .map(([field]) => field);

  for (const entry of entries) {
    const onMissing = (value: string) =>
      console.warn(
        `Content type "${typeName}": entry "${entry.id}" references missing asset "${value}"`,
      );

    for (const child of entry.$children ?? []) {
      rewriteNodeAssets(child, entryDir, mount, onMissing);
    }

    for (const field of uriFields) {
      const value = entry.data[field];
      if (typeof value === "string") {
        entry.data[field] = rewriteRef(value, entryDir, mount, onMissing) ?? value;
      } else if (Array.isArray(value)) {
        entry.data[field] = value.map((item) =>
          typeof item === "string" ? (rewriteRef(item, entryDir, mount, onMissing) ?? item) : item,
        );
      }
    }
  }
}

// ─── Content Config ───────────────────────────────────────────────────────────

/**
 * Read the `content` section out of an already-loaded project config.
 *
 * @param {string} projectRoot - Project root directory
 * @param {ProjectConfig} [projectConfig] - Already-loaded project config with a `content` key
 * @returns {{ config: { content: ContentSection }; contentDir: string }} Parsed section and the
 *   conventional content directory
 */
export function loadContentConfig(projectRoot: string, projectConfig?: ProjectConfig) {
  const contentDir = resolve(projectRoot, "content");

  const config = { content: (projectConfig?.content as ContentSection | undefined) ?? {} };

  return { config, contentDir };
}

// ─── Content Type Loading ────────────────────────────────────────────────────

/**
 * Load every content type in a `content` section value.
 *
 * @param {ContentSection} section - The project.json `content` section value
 * @param {string} root - Project root directory
 * @param {FormatRegistry} formats - Format-dispatch view of the extension registry
 * @returns {Promise<Map<string, ContentLoaderEntry[]>>} Map of content type name → entries
 */
export async function loadContentSection(
  section: ContentSection,
  root: string,
  formats: FormatRegistry,
  projectConfig?: ProjectConfig,
): Promise<Map<string, ContentLoaderEntry[]>> {
  const contentTypes = new Map<string, ContentLoaderEntry[]>();
  const mounts = new Map(
    contentAssetMounts(section, root, projectConfig).map((mount) => [
      /*
       * The path below `/content/` — `<type>` for a plain source, `<type>/<locale>` for a
       * localized one — which is exactly the key each lookup below builds. Keying by the LAST
       * segment made every localized mount unreachable (`posts/fr` never matching `fr`), so a
       * translated entry's `./hero.png` was left unrewritten; and it collided any two types that
       * shared a locale.
       */
      mount.urlPrefix.slice(`/${SECTION_KEY}/`.length),
      mount,
    ]),
  );
  const locales = localesForExpansion(projectConfig);
  for (const [name, contentTypeDef] of Object.entries(section)) {
    const source = contentTypeDef?.source;
    if (typeof source !== "string" || !source.includes(LOCALE_PLACEHOLDER)) {
      const entries = await loadContentType(name, contentTypeDef, root, formats, {
        mount: mounts.get(name),
        projectConfig,
      });
      contentTypes.set(name, entries);
      continue;
    }
    /*
     * One content type, N directories. Each pass loads a real path and stamps the locale it came
     * from onto every entry, which is the only thing distinguishing two translations that share an
     * id — `resolvePaths` reads it back to expand the right ones under a locale-prefixed route.
     */
    if (locales.length === 0) {
      console.warn(
        `Content type "${name}": source "${source}" uses ${LOCALE_PLACEHOLDER}, but the project ` +
          `declares no i18n locales — nothing to expand it over, so no entries were loaded.`,
      );
      contentTypes.set(name, []);
      continue;
    }
    const all: ContentLoaderEntry[] = [];
    for (const locale of locales) {
      const localized = { ...contentTypeDef, source: localeSource(root, source, locale) };
      const entries = await loadContentType(name, localized, root, formats, {
        locale,
        mount: mounts.get(`${name}/${locale}`),
        projectConfig,
      });
      for (const entry of entries) {
        entry._meta = { ...entry._meta, locale };
      }
      all.push(...entries);
    }
    contentTypes.set(name, all);
  }
  return contentTypes;
}

/**
 * Get the $elements array for a specific content type, if defined in the project's `content`
 * section.
 *
 * @param {string} projectRoot - Project root directory
 * @param {string} contentTypeName - Name of the content type
 * @param {ProjectConfig} [projectConfig] - Already-loaded project config
 * @returns {(string | { $ref: string })[] | undefined}
 */
export function getContentTypeElements(
  projectRoot: string,
  contentTypeName: string,
  projectConfig?: ProjectConfig,
) {
  const { config } = loadContentConfig(projectRoot, projectConfig);
  const def = config.content[contentTypeName];
  return def?.$elements;
}

// ─── Per-type rules ──────────────────────────────────────────────────────────

/** How a link that has no page is reported (`links`). */
type LinkMode = "warn" | "error" | "ignore";

/** A content type's declarative options, validated once per load. */
interface TypeRules {
  exclude: ExcludeMatcher;
  where: WherePredicate | null;
  idField: string | undefined;
  route: RouteSpec | null;
  links: LinkMode;
  alerts: unknown;
}

/**
 * Validate and compile a content type's `exclude`, `where`, `idField`, `route`, `links` and
 * `alerts`. A malformed option is a build failure that names the content type, never a silently
 * ignored key: `where: { publish: "yes" }` that quietly matched nothing would publish an empty site
 * and say nothing.
 */
function compileTypeRules(name: string, def: ContentTypeDef): TypeRules {
  const at = `Content type "${name}"`;
  try {
    if (def.idField !== undefined && (typeof def.idField !== "string" || def.idField === "")) {
      throw new TypeError(`"idField" must be a field name`);
    }
    const links = def.links ?? "warn";
    if (links !== "warn" && links !== "error" && links !== "ignore") {
      throw new TypeError(
        `"links" must be "warn", "error" or "ignore", got ${JSON.stringify(links)}`,
      );
    }
    normalizeAlerts(def.alerts, `"alerts"`);
    return {
      alerts: def.alerts,
      exclude: compileExclude(def.exclude),
      idField: def.idField,
      links,
      route: parseRouteConfig(def.route, def.indexRoute, name),
      where: def.where === undefined ? null : compileWhere(def.where),
    };
  } catch (error) {
    const message = errorMessage(error);
    throw new Error(message.startsWith(at) ? message : `${at}: ${message}`, { cause: error });
  }
}

/** The path of a file relative to a source directory, `/`-separated, or null when it is outside. */
function relativeTo(root: string, file: string): string | null {
  const rel = relative(root, file).split("\\").join("/");
  return rel === "" || rel === ".." || rel.startsWith("../") ? null : rel;
}

/** One source file and the entries it yielded, before the collection-wide rules run. */
interface LoadedFile {
  filePath: string;
  /** Relative to the source directory; null for a single-file or remote source. */
  rel: string | null;
  entries: ContentLoaderEntry[];
}

/** Everything {@link finishEntries} needs that is not the entries themselves. */
interface FinishContext {
  name: string;
  schema: ContentTypeSchema | undefined;
  rules: TypeRules;
  mount: AssetMount | undefined;
  projectConfig: ProjectConfig | undefined;
  locale: string | undefined;
  /** Whether the format branch's date-coercion pass applies (it does not for JSON and remote). */
  coerceDates: boolean;
  /** Extensions of the collection's entry files, for link resolution. */
  entryExtensions: Set<string>;
  /** The source directory, when there is one. */
  sourceRoot: string | undefined;
}

/**
 * The collection-wide pass every source kind goes through once its files are loaded.
 *
 * Order matters and is the whole design. `where` runs first, so an entry that is not published is
 * never validated, coerced, given a route or counted as a duplicate. Ids are settled before
 * anything keyed by id (relationships, duplicate checks, routes that read `{id}`). Routes are
 * computed before links, because a link can only be resolved once the page it points at has a URL.
 *
 * @returns {ContentLoaderEntry[]} The kept entries, in load order
 */
function finishEntries(files: LoadedFile[], ctx: FinishContext): ContentLoaderEntry[] {
  const { name, rules } = ctx;

  // 1. where: split every file's entries into kept and left out.
  const kept: LoadedFile[] = [];
  const unpublished = new Map<string, string>();
  for (const file of files) {
    const keep: ContentLoaderEntry[] = [];
    for (const entry of file.entries) {
      if (rules.where && !rules.where(entry.data)) {
        if (file.rel !== null && file.entries.length === 1) {
          unpublished.set(file.rel, `left out by where.${rules.where.why(entry.data) ?? "filter"}`);
        }
      } else {
        keep.push(entry);
      }
    }
    if (keep.length > 0) {
      kept.push({ ...file, entries: keep });
    }
  }

  // 2. Per kept entry: where it came from, and content-relative assets onto the mount.
  for (const file of kept) {
    for (const entry of file.entries) {
      if (file.rel !== null) {
        entry._meta = { ...entry._meta, path: file.rel };
      }
    }
    if (ctx.mount) {
      rewriteEntryAssets(file.entries, file.filePath, ctx.mount, name, ctx.schema);
    }
  }
  const entries = kept.flatMap((file) => file.entries);

  // 3. Ids: the frontmatter field the type names, then a duplicate report.
  if (rules.idField) {
    for (const entry of entries) {
      const value = entry.data[rules.idField];
      if ((typeof value === "string" && value !== "") || typeof value === "number") {
        entry.id = String(value);
      } else {
        console.warn(
          `Content ids: "${name}/${entry.id}" has no usable "${rules.idField}" field, ` +
            `so it keeps its path id`,
        );
      }
    }
  }
  const byId = new Map<string, ContentLoaderEntry>();
  for (const entry of entries) {
    const prior = byId.get(entry.id);
    if (prior) {
      console.warn(
        `Content ids: "${name}" has two entries with the id "${entry.id}" ` +
          `(${prior._meta?.path ?? "an earlier entry"} and ${entry._meta?.path ?? "a later entry"}). ` +
          `A lookup finds only the first; give one of them a distinct ${rules.idField ? `"${rules.idField}"` : "name"}.`,
      );
    } else {
      byId.set(entry.id, entry);
    }
  }

  // 4. Dates, then validation: kept entries only.
  if (ctx.schema) {
    if (ctx.coerceDates) {
      for (const warning of coerceEntryDates(entries, ctx.schema, name)) {
        console.warn(warning.message);
      }
    }
    validateEntries(entries, ctx.schema, name);
  }

  // 5. Routes, and links over the finished routes.
  if (rules.route) {
    assignRoutes(entries, unpublished, ctx, rules.route);
    if (ctx.sourceRoot) {
      resolveEntryLinks(kept, unpublished, ctx);
    }
  }
  return entries;
}

/** The site's `build.trailingSlash`, defaulting to `"always"` exactly as the build does. */
function trailingSlashOf(projectConfig: ProjectConfig | undefined): string {
  const value = projectConfig?.build?.trailingSlash;
  return typeof value === "string" ? value : "always";
}

/** The URL prefix a collection's locale puts in front of its routes (`/fr`), or `""`. */
function localePrefixOf(ctx: FinishContext): string {
  const { i18n } = resolveI18n(ctx.projectConfig ?? {});
  return localeUrlPrefix(ctx.locale, i18n);
}

/**
 * Stamp `_meta.route` and `_meta.url` on every entry whose route template renders.
 *
 * An entry the template cannot render (a missing `category`) and an entry whose route another
 * already holds are both left without a route and reported with the file names involved: the second
 * would otherwise overwrite the first's page, or hand a link to the wrong document. Both are
 * recorded as unpublished so a link to one says why it has no page.
 */
function assignRoutes(
  entries: ContentLoaderEntry[],
  unpublished: Map<string, string>,
  ctx: FinishContext,
  spec: RouteSpec,
): void {
  const trailingSlash = trailingSlashOf(ctx.projectConfig);
  const prefix = localePrefixOf(ctx);
  const owner = new Map<string, string>();
  for (const entry of entries) {
    const path = entry._meta?.path ?? entry.id;
    const rendered = renderRoute(spec, { data: entry.data, id: entry.id, path });
    if ("error" in rendered) {
      console.warn(
        `Content routes: "${ctx.name}/${entry.id}" (${path}) has no route: ${rendered.error}`,
      );
      unpublished.set(path, "it has no route");
      continue;
    }
    const prior = owner.get(rendered.route);
    if (prior !== undefined) {
      console.warn(
        `Content routes: "${ctx.name}" has two entries at ${rendered.route} (${prior} and ${path}). ` +
          `Only ${prior} is routed; make the route unique, for example by adding a field to the template.`,
      );
      unpublished.set(path, `its route ${rendered.route} is already used by ${prior}`);
      continue;
    }
    owner.set(rendered.route, path);
    entry._meta = {
      ...entry._meta,
      route: rendered.route,
      url: routeHref(rendered.route, trailingSlash, prefix),
    };
  }
}

/** One broken link, for the error-mode summary. */
interface BrokenLink {
  from: string;
  href: string;
  reason: string;
}

/**
 * Rewrite the relative links of every kept entry to the routes of the entries they name.
 *
 * Builds the {@link LinkIndex} the resolver needs from what the loader knows (every file it loaded,
 * which of them are published, which directory each README or index stands for), then reports each
 * link that has no page at the severity `links` asks for. In `error` mode all of them are gathered
 * and thrown together, so one build names every broken link instead of one per run.
 */
function resolveEntryLinks(
  kept: LoadedFile[],
  unpublished: Map<string, string>,
  ctx: FinishContext,
): void {
  const { name, rules, sourceRoot } = ctx;
  const files = new Map<string, FileOutcome>();
  const indexes = new Map<string, string>();
  const isReadme = (rel: string) => /^readme\./i.test(rel.slice(rel.lastIndexOf("/") + 1));
  const noteIndex = (rel: string) => {
    const dir = directoryOf(rel);
    const prior = indexes.get(dir);
    // `index` beats `README` when a directory has both, matching how ids are derived.
    if (prior === undefined || (isReadme(prior) && !isReadme(rel))) {
      indexes.set(dir, rel);
    }
  };
  for (const file of kept) {
    const [entry] = file.entries;
    if (file.rel === null || file.entries.length !== 1 || !entry) {
      continue;
    }
    const route = entry._meta?.route;
    files.set(
      file.rel,
      route === undefined
        ? { unpublished: unpublished.get(file.rel) ?? "it has no route" }
        : { route },
    );
    if (isDirectoryIndex(file.rel)) {
      noteIndex(file.rel);
    }
  }
  for (const [rel, reason] of unpublished) {
    if (!files.has(rel)) {
      files.set(rel, { unpublished: reason });
      if (isDirectoryIndex(rel)) {
        noteIndex(rel);
      }
    }
  }

  const index: LinkIndex = {
    entryExtensions: ctx.entryExtensions,
    excludedBy: (path) => rules.exclude.excludedBy(path),
    exists: (path) => existsSync(resolve(sourceRoot!, path)),
    files,
    indexes,
    localePrefix: localePrefixOf(ctx),
    trailingSlash: trailingSlashOf(ctx.projectConfig),
  };

  const broken: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const file of kept) {
    for (const entry of file.entries) {
      if (!entry.$children || file.rel === null) {
        continue;
      }
      rewriteLinks(entry.$children, file.rel, index, (problem) => {
        const key = `${file.rel}\0${problem.href}`;
        if (!seen.has(key)) {
          seen.add(key);
          broken.push({ from: file.rel!, href: problem.href, reason: problem.reason });
        }
      });
    }
  }
  if (rules.links === "ignore" || broken.length === 0) {
    return;
  }
  const lines = broken.map(
    ({ from, href, reason }) => `"${from}" links to "${href}", which ${reason}`,
  );
  if (rules.links === "error") {
    const plural = broken.length === 1 ? "" : "s";
    const list = lines.map((line) => `  - ${line}`).join("\n");
    throw new Error(`Content links: "${name}" has ${broken.length} broken link${plural}:\n${list}`);
  }
  for (const line of lines) {
    console.warn(`Content links: "${name}": ${line}; it renders as plain text.`);
  }
}

// ─── Content Type Loading ────────────────────────────────────────────────────

/** Per-load context a caller threads into {@link loadContentType}. */
interface LoadOptions {
  /** The type's asset mount; content-relative references remap onto it. */
  mount?: AssetMount | undefined;
  /** The project config: `build.trailingSlash` and the i18n routing rules. */
  projectConfig?: ProjectConfig | undefined;
  /** The locale this load is for, when the source carried `{locale}`. */
  locale?: string | undefined;
}

/**
 * Load a single content type by its definition, dispatching through the format registry.
 *
 * @param {string} name - Content type name
 * @param {ContentTypeDef} contentTypeDef - Content type definition from the `content` section
 * @param {string} projectRoot - Absolute path to project root directory
 * @param {FormatRegistry} registry - Format-dispatch view of the extension registry
 * @param {LoadOptions} [options] - Asset mount, project config and locale for this load
 * @returns {Promise<ContentLoaderEntry[]>} Array of ContentEntry
 */
async function loadContentType(
  name: string,
  contentTypeDef: ContentTypeDef,
  projectRoot: string,
  registry: FormatRegistry,
  options: LoadOptions = {},
) {
  const { source } = contentTypeDef;
  if (!source) {
    return [];
  }
  const { mount, projectConfig, locale } = options;
  const schema = contentTypeDef.schema as ContentTypeSchema | undefined;
  const rules = compileTypeRules(name, contentTypeDef);
  const finishContext = (extra: Partial<FinishContext>): FinishContext => ({
    coerceDates: false,
    entryExtensions: new Set<string>(),
    locale,
    mount,
    name,
    projectConfig,
    rules,
    schema,
    sourceRoot: undefined,
    ...extra,
  });

  // Derive directive allowedNames from content type $elements (tag names from npm packages)
  const directiveOptions = contentTypeDef.$elements?.length
    ? {
        allowedNames: contentTypeDef.$elements
          .filter(
            (e) => typeof e === "string" || (typeof e === "object" && (e as JxMutableNode)?.$ref),
          )
          .map((e) => (typeof e === "string" ? e : (e as JxMutableNode).$ref)),
      }
    : undefined;

  // Resolve the format class: explicit `format` (an extension class name) wins; "json" is native
  const formatName = contentTypeDef.format;
  let entry: FormatEntry | undefined;
  if (formatName && formatName !== "json") {
    entry = registry.byName(formatName);
    if (!entry) {
      throw new Error(
        `Content type "${name}": format "${formatName}" is not a registered format class. ` +
          `Enable an extension providing it in project.json "extensions", e.g. "@jxsuite/parser".`,
      );
    }
  }

  // Remote URL source — requires an explicit remote-capable format (no implicit fallback)
  if (source.startsWith("http://") || source.startsWith("https://")) {
    if (!entry) {
      throw new Error(
        `Content type "${name}": remote sources require an explicit "format" naming a ` +
          `format class with "remote": true (e.g. "Csv").`,
      );
    }
    if (!entry.remote) {
      throw new Error(
        `Content type "${name}": format "${entry.name}" does not support remote sources ` +
          `(its format block lacks "remote": true).`,
      );
    }
    let remote: ContentLoaderEntry[];
    try {
      remote = (await entry.call("load", source, {
        directiveOptions,
        schema,
        ...(rules.idField !== undefined && { idField: rules.idField }),
      })) as ContentLoaderEntry[];
    } catch (error) {
      console.warn(`Content type "${name}": ${errorMessage(error)}`);
      return [];
    }
    return finishEntries([{ entries: remote, filePath: source, rel: null }], finishContext({}));
  }

  const resolvedSource = resolve(projectRoot, source).split("\\").join("/");
  const ext = extname(source).toLowerCase();
  // Directory sources pass their resolved root so formats can derive path-based ids for nested files
  const sourceRoot = extname(source) ? undefined : resolvedSource;
  /** Whether a discovered file is left out by `exclude` (a format class may not honor the option). */
  const isExcluded = (file: string) => {
    const rel = sourceRoot === undefined ? null : relativeTo(sourceRoot, file);
    return rel !== null && rules.exclude.excludedBy(rel) !== undefined;
  };
  const relOf = (file: string) => (sourceRoot === undefined ? null : relativeTo(sourceRoot, file));

  // JSON — the native built-in
  if (formatName === "json" || (!entry && ext === ".json")) {
    const loaded: LoadedFile[] = [];
    for (const filePath of discoverJSONFiles(resolvedSource, rules.exclude)) {
      loaded.push({ entries: loadJSONEntries(filePath), filePath, rel: relOf(filePath) });
    }
    return finishEntries(
      loaded,
      finishContext({ entryExtensions: new Set([".json"]), sourceRoot }),
    );
  }

  // Derive the format from the source extension when no explicit format is named
  if (!entry && ext) {
    entry = registry.byExtension(ext, "load");
  }
  if (!entry) {
    throw unknownFormatError(
      source,
      ext || `content type "${name}" (directory sources need an explicit "format")`,
    );
  }

  // Discover entry files via the class, then load each
  const discovered = entry.capabilities.discover
    ? ((await entry.call("discover", source, {
        baseDir: projectRoot,
        ...(rules.exclude.empty ? {} : { exclude: contentTypeDef.exclude }),
      })) as string[])
    : [resolvedSource];
  const files = discovered.filter((file) => !isExcluded(file));

  const fileExtensions = files.map((file) => extname(file).toLowerCase());
  const loaded: LoadedFile[] = [];
  for (const filePath of files) {
    const fileEntries = (await entry.call("load", filePath, {
      directiveOptions,
      schema,
      ...(sourceRoot !== undefined && { sourceRoot }),
      ...(rules.alerts !== undefined && { alerts: rules.alerts }),
      ...(rules.idField !== undefined && { idField: rules.idField }),
    })) as ContentLoaderEntry[];
    loaded.push({ entries: fileEntries, filePath, rel: relOf(filePath) });
  }

  /*
   * Coerce declared date fields before validating. This is the one point in the pipeline that holds
   * both the entries and the schema: `Csv.load` receives a schema and `Markdown.load` does not, so
   * doing it per-format would mean doing it twice and missing every third-party format class.
   */
  return finishEntries(
    loaded,
    finishContext({
      coerceDates: true,
      entryExtensions: new Set([...entry.extensions, ...fileExtensions]),
      sourceRoot,
    }),
  );
}

/** Error message for an unregistered non-JSON extension, naming the fix. */
function unknownFormatError(path: string, ext: string): Error {
  return new Error(
    `No format class registered for "${ext}" (${path}). ` +
      `Enable an extension providing this format in project.json "extensions", ` +
      `e.g. "@jxsuite/parser".`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Schema Validation ────────────────────────────────────────────────────────

/**
 * Validate content entries against their content type schema. Logs warnings for missing required
 * fields and type mismatches.
 *
 * @param {ContentLoaderEntry[]} entries - Array of ContentEntry
 * @param {ContentTypeSchema} schema - JSON Schema for the content type
 * @param {string} contentTypeName - For error messages
 */
function validateEntries(
  entries: ContentLoaderEntry[],
  schema: ContentTypeSchema,
  contentTypeName: string,
) {
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};

  for (const entry of entries) {
    // Check required fields
    for (const field of required) {
      if (!(field in entry.data) || entry.data[field] == null) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" missing required field "${field}"`,
        );
      }
    }

    // Check types
    for (const [field, def] of Object.entries(properties)) {
      const value = entry.data[field];
      if (value == null) {
        continue;
      }

      if (isDateFormat(def.format) && typeof value === "string" && !isCoercedDate(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" is declared ` +
            `${def.format} but "${value}" was not coerced — it will sort and filter as plain text.`,
        );
      } else if (def.type === "string" && typeof value !== "string") {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected string, got ${typeof value}`,
        );
      } else if (def.type === "number" && typeof value !== "number") {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected number, got ${typeof value}`,
        );
      } else if (def.type === "boolean" && typeof value !== "boolean") {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected boolean, got ${typeof value}`,
        );
      } else if (def.type === "array" && !Array.isArray(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected array, got ${typeof value}`,
        );
      }
    }
  }
}

// ─── Content Type Reference Resolution ──────────────────────────────────────

/** Relationship pointers into the `content` section read `#/content/<name>`. */
const CONTENT_REF_PREFIX = "#/content/";

/** Extract the target content type name from a `#/content/<name>` relationship pointer. */
function refTargetName(ref: string | undefined): string | undefined {
  if (!ref?.startsWith(CONTENT_REF_PREFIX)) {
    return undefined;
  }
  return ref.slice(CONTENT_REF_PREFIX.length);
}

/**
 * Resolve cross-content-type relationship references in entry data (specs/relationships.md). A bare
 * field `$ref` is to-one: a blog post's `author: "jane-doe"` with a schema `$ref` of
 * `#/content/authors` gets replaced by the full author entry. An array field whose `items` carry
 * the `$ref` is to-many: each id in the stored array is replaced by its entry. Unresolvable ids are
 * left untouched, with a warning naming the entry and the missing target.
 *
 * @param {Map<string, ContentLoaderEntry[]>} contentTypes - All loaded content types
 * @param {ContentSection} section - The `content` section value the types were loaded from
 */
export function resolveContentTypeRefs(
  contentTypes: Map<string, ContentLoaderEntry[]>,
  section: ContentSection,
) {
  for (const [name, contentTypeDef] of Object.entries(section)) {
    const schema = contentTypeDef.schema as ContentTypeSchema | undefined;
    if (!schema?.properties) {
      continue;
    }

    const entries = contentTypes.get(name);
    if (!entries) {
      continue;
    }

    for (const [field, def] of Object.entries(schema.properties)) {
      const toOne = refTargetName(def.$ref);
      const toMany = toOne ? undefined : refTargetName(def.items?.$ref);
      const target = toOne ?? toMany;
      if (!target) {
        continue;
      }
      const refEntries = contentTypes.get(target);
      if (!refEntries) {
        console.warn(
          `Content relationships: "${name}" field "${field}" references unknown content type "${target}"`,
        );
        continue;
      }

      for (const entry of entries) {
        const value = entry.data[field];
        if (toOne && typeof value === "string") {
          const resolved = refEntries.find((e) => e.id === value);
          if (resolved) {
            entry.data[field] = resolved;
          } else {
            console.warn(
              `Content relationships: "${name}/${entry.id}" field "${field}" references missing "${target}" entry "${value}"`,
            );
          }
        } else if (toMany && Array.isArray(value)) {
          entry.data[field] = value.map((id) => {
            if (typeof id !== "string") {
              return id;
            }
            const resolved = refEntries.find((e) => e.id === id);
            if (!resolved) {
              console.warn(
                `Content relationships: "${name}/${entry.id}" field "${field}" references missing "${target}" entry "${id}"`,
              );
            }
            return resolved ?? id;
          });
        }
      }
    }
  }
}

/**
 * `$paths` for a content type with a `route`: one parameter map per entry the page can serve.
 *
 * The page pattern arrives with the locale prefix still on it (`/fr/kb/*`) while an entry's route
 * is locale-free, so the prefix is taken off first. An entry the pattern cannot produce is skipped,
 * and a page that serves none of them is reported once with an example route, because the usual
 * cause is a template and a page that were never meant for each other.
 */
function routedPaths(
  contentType: string,
  entries: ContentLoaderEntry[],
  ctx: ResolvePathsContext,
  urlPattern: string,
): Record<string, unknown>[] {
  const { i18n } = resolveI18n(ctx.projectConfig ?? {});
  const prefix = localeUrlPrefix(ctx.locale, i18n);
  const pattern =
    prefix !== "" && (urlPattern === prefix || urlPattern.startsWith(`${prefix}/`))
      ? urlPattern.slice(prefix.length) || "/"
      : urlPattern;
  const paths: Record<string, unknown>[] = [];
  let example: string | undefined;
  for (const entry of entries) {
    const route = entry._meta?.route;
    if (route === undefined) {
      continue;
    }
    example ??= route;
    const params = routeParams(route, pattern, ctx.params ?? []);
    if (params) {
      paths.push({ ...params, ...(entry._meta === undefined ? {} : { _meta: entry._meta }) });
    }
  }
  if (paths.length === 0 && example !== undefined) {
    console.warn(
      `Warning: $paths for content type "${contentType}": no entry route fits the page pattern ` +
        `"${urlPattern}" (for example ${example}), so this page generates nothing`,
    );
  }
  return paths;
}

// ─── The Content project-section class ───────────────────────────────────────

/**
 * `Content` — the parser extension's project-section class (Content.class.json). Owns the
 * project.json `content` section: `projectData` loads it into `_project.content`, `resolvePaths`
 * expands `$paths` values carrying the `contentType` discriminator.
 */
// oxlint-disable-next-line typescript/no-extraneous-class, unicorn/no-static-only-class -- the extension capability contract dispatches static methods on the class export named by the descriptor title (specs/extensions.md §6.1)
export class Content {
  /**
   * Load the `content` section: every content type's entries, with relationship references already
   * resolved.
   *
   * @param {unknown} sectionValue - The project.json `content` section value
   * @param {ProjectDataContext} ctx - Host context ({ projectConfig, root, registry, io })
   * @returns {Promise<Map<string, ContentLoaderEntry[]>>} Content type name → entries
   */
  static async projectData(
    sectionValue: unknown,
    ctx: ProjectDataContext,
  ): Promise<Map<string, ContentLoaderEntry[]>> {
    const section = (sectionValue ?? {}) as ContentSection;
    const data = await loadContentSection(
      section,
      ctx.root,
      ctx.registry.formats,
      ctx.projectConfig,
    );
    resolveContentTypeRefs(data, section);
    return data;
  }

  /**
   * Publish each content type's source directory at `/content/<type>` (specs/extensions.md §8.5).
   * Hosts serve, resolve, and copy files through the returned mounts, which is what lets an entry
   * reference `../images/hero.png` and still resolve in a built site, the dev server, and Studio.
   *
   * @param {unknown} sectionValue - The project.json `content` section value
   * @param {{ projectConfig?: ProjectConfig; root: string }} ctx - Host context
   * @returns {AssetMount[]} One mount per content type with a local directory source
   */
  static assets(
    sectionValue: unknown,
    ctx: { root: string; projectConfig?: ProjectConfig },
  ): AssetMount[] {
    return contentAssetMounts((sectionValue ?? {}) as ContentSection, ctx.root, ctx.projectConfig);
  }

  /**
   * Expand a content-type `$paths` source into route-param maps.
   *
   * **With `param` or `field`** (or on a type with no `route`): one `{ [param]: value }` per entry,
   * `param` defaulting to "slug" and `field` to "id" (the entry id). Unchanged since before routes
   * existed, and still the right shape for a flat `[slug]` collection.
   *
   * **With neither, on a type that declares a `route`:** the page's own URL pattern decides. Each
   * entry's route is matched against the pattern the host passes (`/kb/:category/:slug`, `/kb/*`)
   * and the parameters that pattern needs are derived from it, so the same `$paths: {
   * "contentType": "kb" }` serves `[category]/[slug].json`, `[...path].json` or a `[category].json`
   * section page, and the page generated for an entry is always at the URL its links point to. An
   * entry whose route the pattern cannot produce belongs to another page and is skipped here.
   *
   * Each map also carries the entry's own `_meta`, under that reserved name. `_meta` is not a route
   * parameter and the host strips it before substitution — it is how a fact about the _entry_
   * reaches a route that would otherwise know only about the template that generated it. The one
   * that matters today is `mtime`: without it every post in a collection reports the template's
   * timestamp in `<lastmod>`, so the whole archive looks edited whenever the template is.
   *
   * @param {ContentPathsSource} pathsDef - The `$paths` value ({ contentType, param?, field? })
   * @param {ResolvePathsContext} ctx - Host context ({ data, projectConfig, root, urlPattern })
   * @returns {Promise<Record<string, unknown>[]>} Array of route-param objects
   */
  static async resolvePaths(
    pathsDef: ContentPathsSource,
    ctx: ResolvePathsContext,
  ): Promise<Record<string, unknown>[]> {
    const entries = ctx.data.get(pathsDef.contentType);
    if (!entries || entries.length === 0) {
      console.warn(
        `Warning: $paths references content type "${pathsDef.contentType}" but it has no entries`,
      );
      return [];
    }
    const param = pathsDef.param ?? "slug";
    const field = pathsDef.field ?? "id";
    /*
     * A localized collection holds every language at once, and two translations of one post share
     * an id — so expanding all of them under `/fr/[slug]` would emit each route twice and let the
     * second overwrite the first. The route's own locale is the discriminator, and it is applied
     * only when the entries actually carry one: an unlocalized collection is untouched.
     */
    const localized = entries.some((entry) => entry._meta?.locale !== undefined);
    const wanted = ctx.locale;
    const scoped =
      localized && typeof wanted === "string"
        ? entries.filter((entry) => entry._meta?.locale === wanted)
        : entries;
    if (
      pathsDef.param === undefined &&
      pathsDef.field === undefined &&
      ctx.urlPattern !== undefined &&
      scoped.some((entry) => entry._meta?.route !== undefined)
    ) {
      return routedPaths(pathsDef.contentType, scoped, ctx, ctx.urlPattern);
    }
    const paths: Record<string, unknown>[] = [];
    for (const entry of scoped) {
      const value = field === "id" ? entry.id : (entry.data[field] ?? entry.id);
      if (!value) {
        continue;
      }
      const pathEntry: Record<string, unknown> = { [param]: value };
      if (entry._meta !== undefined) {
        pathEntry._meta = entry._meta;
      }
      paths.push(pathEntry);
    }
    return paths;
  }
}
