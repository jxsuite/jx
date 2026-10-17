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
import {
  assetUrlFor,
  CONTENT_SECTION_KEY,
  LOCALE_PLACEHOLDER,
  SAFE_CONTENT_TYPE_NAME,
} from "@jxsuite/schema/asset-paths";
import { localeUrlPrefix, resolveI18n } from "@jxsuite/schema/locale";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type {
  FormatDiscoverOptions,
  FormatEntry,
  FormatRegistry,
  ProjectDataContext,
} from "@jxsuite/schema/format-registry";
import { isBoolean, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import type {
  ContentFieldValue,
  ContentTypeSchema,
  JsonObject,
  JsonValue,
  JxElement,
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
  traversalReason,
} from "./content-routes.ts";
import type { RouteSpec } from "./content-routes.ts";
import { compileExclude, compileWhere } from "./content-rules.ts";
import type { ExcludeMatcher, WherePredicate } from "./content-rules.ts";
import { coerceEntryDates, isCoercedDate, isDateFormat } from "./dates.ts";
import type { ContentNodes } from "./inert.ts";
import type { ContentLoaderEntry, ContentTypeDef } from "./types.ts";
import { walkFiles } from "./walk.ts";
import { entriesOf } from "./content-data.ts";
import type { ContentSectionData } from "./content-data.ts";

export type { ContentEntry, ContentLoaderEntry, TocEntry } from "./types.ts";
export type { ContentSectionData } from "./content-data.ts";

// ─── Context and section shapes ──────────────────────────────────────────────

/** The value of the project.json `content` section: content type name → definition. */
export type ContentSection = Record<string, ContentTypeDef>;

/* The host context passed to `Content.projectData` is the capability contract's own
   (specs/extensions.md §8); its injected `io` goes unused here, as this loader is node-only by its
   declared timing. */
export type { ProjectDataContext } from "@jxsuite/schema/format-registry";

/** Host context passed to `Content.resolvePaths` (specs/extensions.md §8). */
export interface ResolvePathsContext {
  /** The loaded section data, as returned by `Content.projectData`. */
  data: ContentSectionData;
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
  /**
   * The URL patterns of every dynamic page in the project, so a routed content type can report the
   * entries no page at all would generate (a route no page shape produces is a dead link).
   */
  patterns?: readonly string[];
}

/** An entry's `_meta`: where it came from, and the route and URL the loader gave it. */
type ContentEntryMeta = NonNullable<ContentLoaderEntry["_meta"]>;

/**
 * One `$paths` result: route parameter → value, plus the entry's own `_meta` under that reserved
 * name, which the host strips before substitution.
 */
export interface ContentPathParams {
  _meta?: ContentEntryMeta;
  [param: string]: ContentFieldValue | ContentEntryMeta | undefined;
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
  // SAFETY: JSON.parse only ever yields JSON values; its `any` return type says nothing more.
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as JsonValue;
  if (Array.isArray(raw)) {
    return raw.map((item, i) => jsonEntry(item, `${basename(filePath, ".json")}-${i}`));
  }
  // Single object file — filename is the id
  return [jsonEntry(raw, basename(filePath, ".json"))];
}

/** One entry of a JSON source: the object is its data, and its own `id` wins over `fallbackId`. */
function jsonEntry(item: JsonValue, fallbackId: string): ContentLoaderEntry {
  /* SAFETY: a JSON content file is documented (content-collections docs, "JSON files") as one
     entry object or an array of entry objects, each optionally naming its `id`; the loader takes
     the file at its word for that shape, as it always has, rather than checking each item. */
  const data = item as JsonObject;
  // SAFETY: by the same documented shape, an entry's own `id` is its text id; absent, the path names it.
  const id = (data.id ?? fallbackId) as string;
  return { body: null, data, id };
}

/** Discover .json entry files for a source (single file or directory), in sorted order. */
function discoverJSONFiles(resolvedSource: string, exclude: ExcludeMatcher): string[] {
  if (extname(resolvedSource)) {
    return existsSync(resolvedSource) ? [resolvedSource] : [];
  }
  return walkFiles(resolvedSource, (name) => name.toLowerCase().endsWith(".json"), exclude);
}

// ─── Asset mounts and content-relative references ────────────────────────────

/* `LOCALE_PLACEHOLDER` lives in `@jxsuite/schema/asset-paths`, beside the mount math, so Studio's
   browser-side canvas reads the same token; this module's public name for it stays available. */
export { LOCALE_PLACEHOLDER } from "@jxsuite/schema/asset-paths";

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

/** Document extensions: an entry of a collection is never an asset of it. */
const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

/**
 * What a content type's asset mount may serve, or `undefined` for "everything under the directory"
 * (today's behavior, which every type that declares none of the vault options keeps).
 *
 * A type that declares `exclude`, `where` or `route` is publishing a folder of notes, and there the
 * mount is the collection's front door, so it must not be a way around the collection's own rules:
 * a file `exclude` names is not served however a page refers to it, nothing whose path has a dot
 * segment is (`.git`, `.env` and `.obsidian` are what a source set to the repository root also
 * contains), and a document is not (a note `where` left out would otherwise leave as a raw
 * download, frontmatter and all). The paths it is asked about are relative to the mount directory,
 * which is the source directory.
 */
function mountFilterFor(def: ContentTypeDef | undefined): ((path: string) => boolean) | undefined {
  if (!def || (def.exclude === undefined && def.where === undefined && def.route === undefined)) {
    return undefined;
  }
  let exclude: ExcludeMatcher;
  try {
    exclude = compileExclude(def.exclude);
  } catch {
    // The same list fails the build when the type loads; until then, serve nothing.
    return () => false;
  }
  return (path) => {
    const segments = path.split("/");
    if (segments.some((segment) => segment.startsWith("."))) {
      return false;
    }
    if (DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase())) {
      return false;
    }
    return exclude.excludedBy(path) === undefined;
  };
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
  section: ContentSection | undefined,
  root: string,
  projectConfig?: ProjectConfig,
): AssetMount[] {
  const mounts: AssetMount[] = [];
  const locales = localesForExpansion(projectConfig);
  const filterOf = (def: ContentTypeDef | undefined): { filter?: (path: string) => boolean } => {
    const filter = mountFilterFor(def);
    return filter === undefined ? {} : { filter };
  };
  for (const [name, contentTypeDef] of Object.entries(section ?? {})) {
    // A definition is project.json data, and one still being written may not be an object yet.
    if (!isNonNullObject(contentTypeDef)) {
      continue;
    }
    const { source } = contentTypeDef;
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
        if (!SAFE_CONTENT_TYPE_NAME.test(locale)) {
          continue;
        }
        const dir = resolve(root, localeSource(root, source, locale))
          .split("\\")
          .join("/");
        if (SAFE_CONTENT_TYPE_NAME.test(name) && existsSync(dir) && statSync(dir).isDirectory()) {
          mounts.push({
            dir,
            urlPrefix: `/${CONTENT_SECTION_KEY}/${name}/${locale}`,
            ...filterOf(contentTypeDef),
          });
        }
      }
      continue;
    }
    if (!SAFE_CONTENT_TYPE_NAME.test(name)) {
      console.warn(
        `Content type "${name}": name is not URL-safe — its source directory is not published ` +
          `at /${CONTENT_SECTION_KEY}/${name}, so content-relative asset references stay unresolved.`,
      );
      continue;
    }
    const resolvedSource = resolve(root, source).split("\\").join("/");
    if (extname(source) || !existsSync(resolvedSource) || !statSync(resolvedSource).isDirectory()) {
      continue;
    }
    mounts.push({
      dir: resolvedSource,
      urlPrefix: `/${CONTENT_SECTION_KEY}/${name}`,
      ...filterOf(contentTypeDef),
    });
  }
  return mounts;
}

/** Why a content-relative reference was left as written. */
type RefProblem = "missing" | "refused";

/**
 * Rewrite one content-relative reference to its mounted URL, or null to leave the value untouched.
 * A value is rewritten only when it is relative, resolves against the entry's own directory to a
 * file that exists, and lands inside the mount and where the mount serves — so nothing an existing
 * project authored (a project-root-relative path, an absolute URL, a bound template) changes
 * meaning. A file inside the collection that its mount refuses to serve (excluded, hidden or a
 * document) is reported and left as written, so a published note cannot pull it into the site.
 */
function rewriteRef(
  value: string,
  entryDir: string,
  mount: AssetMount,
  onProblem: (value: string, problem: RefProblem) => void,
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
    if (relativeTo(mount.dir, target) !== null && existsSync(target)) {
      onProblem(value, "refused");
    }
    return null; // Resolves outside the collection, or is not served — not ours to publish
  }
  if (!existsSync(target)) {
    onProblem(value, "missing");
    return null;
  }
  const suffix = value.slice(bare.length);
  return `${url}${suffix}`;
}

/** Rewrite media references on one node and its children, in place. */
function rewriteNodeAssets(
  node: JxElement | string | ContentNodes | undefined,
  entryDir: string,
  mount: AssetMount,
  onProblem: (value: string, problem: RefProblem) => void,
) {
  if (Array.isArray(node)) {
    for (const child of node) {
      rewriteNodeAssets(child, entryDir, mount, onProblem);
    }
    return;
  }
  if (!isNonNullObject(node)) {
    return;
  }
  const { attributes } = node;
  for (const key of ASSET_KEYS) {
    // The node's own property first, then its attribute of the same name.
    for (const holder of [node, attributes]) {
      const value = holder?.[key];
      if (holder && isString(value)) {
        const rewritten = rewriteRef(value, entryDir, mount, onProblem);
        if (rewritten) {
          holder[key] = rewritten;
        }
      }
    }
  }
  const { children } = node;
  if (Array.isArray(children)) {
    for (const child of children) {
      rewriteNodeAssets(child, entryDir, mount, onProblem);
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
  /* A field's schema is project.json data, so one that is not an object (a `null` left by an edit)
     declares nothing rather than failing the load. */
  const uriFields = Object.entries(schema?.properties ?? {}).flatMap(([field, def]) =>
    isNonNullObject(def) &&
    (def.format === "uri-reference" || def.items?.format === "uri-reference")
      ? [field]
      : [],
  );

  for (const entry of entries) {
    const onProblem = assetProblemReporter(typeName, entry);
    rewriteBodyAssets(entry, filePath, mount, typeName);

    for (const field of uriFields) {
      const value = entry.data[field];
      if (isString(value)) {
        entry.data[field] = rewriteRef(value, entryDir, mount, onProblem) ?? value;
      } else if (Array.isArray(value)) {
        entry.data[field] = value.map((item) =>
          isString(item) ? (rewriteRef(item, entryDir, mount, onProblem) ?? item) : item,
        );
      }
    }
  }
}

/** The warning for one asset reference an entry makes that its collection will not publish. */
function assetProblemReporter(typeName: string, entry: ContentLoaderEntry) {
  return (value: string, problem: RefProblem) =>
    console.warn(
      problem === "missing"
        ? `Content type "${typeName}": entry "${entry.id}" references missing asset "${value}"`
        : `Content type "${typeName}": entry "${entry.id}" references "${value}", which the ` +
            `collection does not publish (it is excluded, hidden or a document), so the ` +
            `reference is left as written`,
    );
}

/**
 * The body half of {@link rewriteEntryAssets}: remap the media references in an entry's `$children`
 * onto the mount. Separate because a body loaded later (a lazily loaded collection's deferred
 * entry) gets this pass on its own, after its frontmatter had the other half at load.
 */
function rewriteBodyAssets(
  entry: ContentLoaderEntry,
  filePath: string,
  mount: AssetMount,
  typeName: string,
) {
  const entryDir = dirname(filePath);
  const onProblem = assetProblemReporter(typeName, entry);
  for (const child of entry.$children ?? []) {
    rewriteNodeAssets(child, entryDir, mount, onProblem);
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

  /* SAFETY: `content` is the section this extension owns, and its project fragment schema defines
     it as content type name → definition, which is what ContentSection spells; the options of a
     definition are validated again by compileTypeRules when that type loads. */
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
  const mounts = sectionMounts(section, root, projectConfig);
  for (const name of Object.keys(section)) {
    contentTypes.set(
      name,
      await loadSectionType(name, { formats, mounts, projectConfig, root, section }),
    );
  }
  return contentTypes;
}

/** A section's asset mounts, keyed by the path below `/content/` a lookup builds. */
export function sectionMounts(
  section: ContentSection,
  root: string,
  projectConfig: ProjectConfig | undefined,
): Map<string, AssetMount> {
  return new Map(
    contentAssetMounts(section, root, projectConfig).map((mount) => [
      /*
       * The path below `/content/` — `<type>` for a plain source, `<type>/<locale>` for a
       * localized one — which is exactly the key each lookup below builds. Keying by the LAST
       * segment made every localized mount unreachable (`posts/fr` never matching `fr`), so a
       * translated entry's `./hero.png` was left unrewritten; and it collided any two types that
       * shared a locale.
       */
      mount.urlPrefix.slice(`/${CONTENT_SECTION_KEY}/`.length),
      mount,
    ]),
  );
}

/** What {@link loadSectionType} loads one content type of a section with. */
export interface SectionTypeSource {
  section: ContentSection;
  root: string;
  formats: FormatRegistry;
  projectConfig: ProjectConfig | undefined;
  /** The section's mounts, from {@link sectionMounts}. */
  mounts: Map<string, AssetMount>;
  /** Leave entry bodies for later, reporting each deferred entry here. */
  onDeferred?: DeferredBodyHandler | undefined;
}

/**
 * Load one content type of a section, expanding a `{locale}` source over the project's locales.
 *
 * @param {string} name - The content type's name in the section
 * @param {SectionTypeSource} source - The section and what it is loaded with
 * @returns {Promise<ContentLoaderEntry[]>} The type's entries
 */
export async function loadSectionType(
  name: string,
  source: SectionTypeSource,
): Promise<ContentLoaderEntry[]> {
  const { section, root, formats, projectConfig, mounts, onDeferred } = source;
  const contentTypeDef = section[name];
  if (!contentTypeDef) {
    return [];
  }
  const deferral = onDeferred ? { deferBody: true, onDeferred } : {};
  const typeSource = contentTypeDef.source;
  if (!isString(typeSource) || !typeSource.includes(LOCALE_PLACEHOLDER)) {
    return await loadContentType(name, contentTypeDef, root, formats, {
      mount: mounts.get(name),
      projectConfig,
      ...deferral,
    });
  }
  /*
   * One content type, N directories. Each pass loads a real path and stamps the locale it came
   * from onto every entry, which is the only thing distinguishing two translations that share an
   * id — `resolvePaths` reads it back to expand the right ones under a locale-prefixed route.
   */
  const locales = localesForExpansion(projectConfig);
  if (locales.length === 0) {
    console.warn(
      `Content type "${name}": source "${typeSource}" uses ${LOCALE_PLACEHOLDER}, but the project ` +
        `declares no i18n locales — nothing to expand it over, so no entries were loaded.`,
    );
    return [];
  }
  const all: ContentLoaderEntry[] = [];
  for (const locale of locales) {
    const localized = { ...contentTypeDef, source: localeSource(root, typeSource, locale) };
    const entries = await loadContentType(name, localized, root, formats, {
      locale,
      mount: mounts.get(`${name}/${locale}`),
      projectConfig,
      ...deferral,
    });
    for (const entry of entries) {
      entry._meta = { ...entry._meta, locale };
    }
    all.push(...entries);
  }
  return all;
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
  alerts: ContentTypeDef["alerts"];
}

/** The values `links` accepts. */
const LINK_MODES = ["warn", "error", "ignore"] as const;

/** Whether a `links` option names one of the {@link LINK_MODES}; it is project.json data. */
function isLinkMode(value: JsonValue): value is LinkMode {
  return LINK_MODES.some((mode) => mode === value);
}

/** Every key a content type's definition means something by. */
const KNOWN_TYPE_KEYS = [
  "$elements",
  "alerts",
  "exclude",
  "format",
  "idField",
  "indexRoute",
  "links",
  "route",
  "schema",
  "source",
  "where",
] as const;

/** Edit distance between two short strings, for the "did you mean" of a misspelled option. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        row[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The option a misspelled key most plausibly meant, or undefined when none is close.
 *
 * The options exist to keep things OUT of a published site, so a typo in one fails open: `excludes`
 * would be ignored and the private folder it was meant to hide would be published. That is why a
 * near miss is a build error and not a note.
 */
function nearestOption(key: string): string | undefined {
  const lower = key.toLowerCase();
  let best: string | undefined;
  let bestDistance = 3;
  for (const known of KNOWN_TYPE_KEYS) {
    const distance = editDistance(lower, known.toLowerCase());
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Validate and compile a content type's `exclude`, `where`, `idField`, `route`, `links` and
 * `alerts`. A malformed option is a build failure that names the content type, never a silently
 * ignored key: `where: { publish: "yes" }` that quietly matched nothing would publish an empty site
 * and say nothing, and neither would `excludes` (for `exclude`) say it was being ignored.
 */
function compileTypeRules(name: string, def: ContentTypeDef): TypeRules {
  const at = `Content type "${name}"`;
  try {
    for (const key of Object.keys(def)) {
      if (KNOWN_TYPE_KEYS.some((known) => known === key) || key === "$comment") {
        continue;
      }
      const suggestion = nearestOption(key);
      if (suggestion !== undefined) {
        throw new TypeError(`unknown option "${key}", did you mean "${suggestion}"?`);
      }
      console.warn(
        `${at}: ignores the unknown option "${key}" (the options are ${KNOWN_TYPE_KEYS.join(", ")})`,
      );
    }
    // `idField` and `links` are project.json data: checked here, whatever their declared types say.
    if (def.idField !== undefined && (!isString(def.idField) || def.idField === "")) {
      throw new TypeError(`"idField" must be a field name`);
    }
    const links = def.links ?? "warn";
    if (!isLinkMode(links)) {
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
  /** Set when the files were loaded without their bodies: loads one file again, body and all. */
  reload?: ((filePath: string) => Promise<ContentLoaderEntry[]>) | undefined;
  /** Told of each entry whose body was deferred, with what completes it. */
  onDeferred?: DeferredBodyHandler | undefined;
}

/**
 * Told of one entry loaded without its body, and handed what completes it: load the body, then give
 * it the asset and link passes the rest of the collection's bodies got at load.
 */
export type DeferredBodyHandler = (
  entry: ContentLoaderEntry,
  completeBody: () => Promise<void>,
) => void;

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
  let loadedCount = 0;
  for (const file of files) {
    const keep: ContentLoaderEntry[] = [];
    for (const entry of file.entries) {
      loadedCount += 1;
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
  /* A filter that removes every document is nearly always a mistake in the filter (`publish: "true"`
     against a YAML boolean), and the result is an empty site that builds without complaint. */
  if (rules.where && loadedCount > 0 && kept.length === 0) {
    const [first] = files.flatMap((file) => file.entries);
    console.warn(
      `Content type "${name}": "where" left out all ${loadedCount} entries, so the collection is ` +
        `empty (it failed on "${first ? (rules.where.why(first.data) ?? "?") : "?"}" for the first one). ` +
        `Check the field names and the value types: YAML \`true\` is a boolean, "true" is text.`,
    );
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

  // 3. Ids: a README beside an index, then the frontmatter field the type names, then duplicates.
  settleIndexIds(name, entries);
  if (rules.idField) {
    for (const entry of entries) {
      const value = entry.data[rules.idField];
      if ((isString(value) && value !== "") || isNumber(value)) {
        /* An id becomes a directory name under the output (`$paths` hands it to a page), and a
           frontmatter value is not trusted to stay inside it. */
        const unsafe = traversalReason(String(value));
        if (unsafe === null) {
          entry.id = String(value);
        } else {
          console.warn(
            `Content ids: "${name}/${entry.id}" has a "${rules.idField}" that ${unsafe}, ` +
              `so it keeps its path id`,
          );
        }
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
    const links = ctx.sourceRoot ? resolveEntryLinks(kept, unpublished, ctx) : undefined;
    deferBodies(kept, ctx, links);
    /* An entry the template could not route, or whose route another entry holds, has no page, and
       a collection is what every consumer (a listing, the search index, a feed) publishes from. Left
       in, each of them would invent a URL for it from its own idea of one and point readers at a
       404, and the document the build calls unpublished would be in the public search index. The
       link index above already knows why it has no page; the collection does not carry it. */
    return entries.filter((entry) => entry._meta?.route !== undefined);
  }
  deferBodies(kept, ctx);
  return entries;
}

/**
 * Hand each entry that was loaded without its body to `onDeferred`, with what completes it.
 *
 * Completing one does for that entry exactly what {@link finishEntries} did for every body it was
 * given: the full load supplies `$children` and the `_meta` fields read from the body, then the
 * body's assets move onto the mount and its links resolve against the collection's own index. The
 * frontmatter half is untouched; it was finished with the rest of the collection. Only a file that
 * yielded one entry is deferred, since a reload answers per file.
 */
function deferBodies(kept: LoadedFile[], ctx: FinishContext, links?: LinkIndex): void {
  const { reload, onDeferred } = ctx;
  if (!reload || !onDeferred) {
    return;
  }
  for (const file of kept) {
    const [entry] = file.entries;
    if (file.entries.length !== 1 || !entry || entry.$children !== undefined) {
      continue;
    }
    onDeferred(entry, async () => {
      const [full] = await reload(file.filePath);
      if (!full) {
        return;
      }
      /* Rebuilt in place, in the full load's key order: the entry is already referenced (by the
         collection, and by any entry relating to it), and an entry whose body arrived late should
         serialize exactly as one loaded whole. Everything the collection pass decided about it
         (its id, data, route) is kept; the full load contributes only what came from the body. */
      const completed: ContentLoaderEntry = {
        ...full,
        ...entry,
        _meta: { ...full._meta, ...entry._meta },
      };
      for (const key of Object.keys(entry)) {
        Reflect.deleteProperty(entry, key);
      }
      Object.assign(entry, completed);
      if (ctx.mount) {
        rewriteBodyAssets(entry, file.filePath, ctx.mount, ctx.name);
      }
      if (links && file.rel !== null) {
        const broken: BrokenLink[] = [];
        collectBrokenLinks(entry, file.rel, links, broken, new Set());
        reportBrokenLinks(broken, ctx.name, ctx.rules.links);
      }
    });
  }
}

/**
 * Keep a folder's id for its `index` file when its `README` would also claim it.
 *
 * A README maps to its folder (`Frappe/README.md` is `Frappe`), and so has `index.md` since before
 * READMEs did. A folder holding both used to give them two ids and now would give them one, with
 * whichever sorted first (README, by case) silently winning an `index.md` that is older and means
 * the same thing. The index keeps the folder's id, as links and routes already assume, and the
 * README keeps the id it had before the mapping existed.
 */
function settleIndexIds(name: string, entries: ContentLoaderEntry[]): void {
  const indexFolders = new Set<string>();
  for (const entry of entries) {
    const path = entry._meta?.path;
    if (path !== undefined && isDirectoryIndex(path) && !/^readme\./i.test(basename(path))) {
      indexFolders.add(directoryOf(path));
    }
  }
  for (const entry of entries) {
    const path = entry._meta?.path;
    if (path === undefined || !/^readme\./i.test(basename(path))) {
      continue;
    }
    const folder = directoryOf(path);
    if (folder !== "" && entry.id === folder && indexFolders.has(folder)) {
      entry.id = path.slice(0, path.length - extname(path).length);
      console.warn(
        `Content ids: "${name}" has both "${path}" and an index file in "${folder}"; the index ` +
          `keeps the id "${folder}" and the README is "${entry.id}".`,
      );
    }
  }
}

/** The site's `build.trailingSlash`, defaulting to `"always"` exactly as the build does. */
function trailingSlashOf(projectConfig: ProjectConfig | undefined): string {
  const value = projectConfig?.build?.trailingSlash;
  return isString(value) ? value : "always";
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
  /* One line per entry says what is wrong with it, until there are enough that one line per entry
     is a wall: a template naming a field no document has (`{slugg}`) fails for every entry with the
     same reason, and naming the reason once with a count and a few examples is the useful report. */
  const unrouted = new Map<string, { id: string; path: string }[]>();
  for (const entry of entries) {
    const path = entry._meta?.path ?? entry.id;
    const rendered = renderRoute(spec, { data: entry.data, id: entry.id, path });
    if ("error" in rendered) {
      unrouted.set(rendered.error, [
        ...(unrouted.get(rendered.error) ?? []),
        { id: entry.id, path },
      ]);
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
  for (const [reason, list] of unrouted) {
    if (list.length <= UNROUTED_LISTED) {
      for (const { id, path } of list) {
        console.warn(`Content routes: "${ctx.name}/${id}" (${path}) has no route: ${reason}`);
      }
    } else {
      const shown = list.slice(0, UNROUTED_LISTED).map(({ path }) => path);
      console.warn(
        `Content routes: "${ctx.name}": ${list.length} entries have no route: ${reason} ` +
          `(for example ${shown.join(", ")})`,
      );
    }
  }
}

/** How many entries a "has no route" report lists by name before it summarizes. */
const UNROUTED_LISTED = 3;

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
 *
 * An entry whose body has not been loaded yet (a lazily loaded collection) has no links to rewrite
 * here; the index is returned so its body is resolved against the same one when it loads.
 *
 * @returns {LinkIndex} The collection's link index
 */
function resolveEntryLinks(
  kept: LoadedFile[],
  unpublished: Map<string, string>,
  ctx: FinishContext,
): LinkIndex {
  const index = buildLinkIndex(kept, unpublished, ctx);
  const broken: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const file of kept) {
    for (const entry of file.entries) {
      if (entry.$children && file.rel !== null) {
        collectBrokenLinks(entry, file.rel, index, broken, seen);
      }
    }
  }
  reportBrokenLinks(broken, ctx.name, ctx.rules.links);
  return index;
}

/** The {@link LinkIndex} for one collection: every file it loaded and what became of each. */
function buildLinkIndex(
  kept: LoadedFile[],
  unpublished: Map<string, string>,
  ctx: FinishContext,
): LinkIndex {
  const { rules, sourceRoot } = ctx;
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

  const onDisk = (path: string) => resolve(sourceRoot!, path);
  return {
    asset: (path) => {
      const absolute = onDisk(path);
      if (!ctx.mount || !existsSync(absolute) || statSync(absolute).isDirectory()) {
        return;
      }
      const pattern = rules.exclude.excludedBy(path);
      if (pattern !== undefined) {
        return { unpublished: `excluded by "${pattern}"` };
      }
      const url = assetUrlFor([ctx.mount], absolute);
      return url === null ? { unpublished: "the collection does not serve a file there" } : { url };
    },
    entryExtensions: ctx.entryExtensions,
    excludedBy: (path) => rules.exclude.excludedBy(path),
    excludesDir: (path) => rules.exclude.excludesDir(path),
    exists: (path) => existsSync(onDisk(path)),
    files,
    indexes,
    isDirectory: (path) => {
      try {
        return statSync(onDisk(path)).isDirectory();
      } catch {
        return false;
      }
    },
    localePrefix: localePrefixOf(ctx),
    trailingSlash: trailingSlashOf(ctx.projectConfig),
  };
}

/** Rewrite one entry's links against the index, adding each link with no page to `broken`. */
function collectBrokenLinks(
  entry: ContentLoaderEntry,
  rel: string,
  index: LinkIndex,
  broken: BrokenLink[],
  seen: Set<string>,
): void {
  rewriteLinks(entry.$children ?? [], rel, index, (problem) => {
    const key = `${rel}\0${problem.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      broken.push({ from: rel, href: problem.href, reason: problem.reason });
    }
  });
}

/** Report broken links at the severity the collection's `links` option asks for. */
function reportBrokenLinks(broken: BrokenLink[], name: string, mode: LinkMode): void {
  if (mode === "ignore" || broken.length === 0) {
    return;
  }
  const lines = broken.map(
    ({ from, href, reason }) => `"${from}" links to "${href}", which ${reason}`,
  );
  if (mode === "error") {
    const plural = broken.length === 1 ? "" : "s";
    const list = lines.map((line) => `  - ${line}`).join("\n");
    throw new Error(`Content links: "${name}" has ${broken.length} broken link${plural}:\n${list}`);
  }
  /* A cause that is not in the links themselves (a template naming a field nobody has leaves every
     entry unrouted) turns into a line per link, which buries the cause. Past a screenful the rest is
     counted, and `links: "error"` still lists every one. */
  for (const line of lines.slice(0, LINK_WARNINGS_LISTED)) {
    console.warn(`Content links: "${name}": ${line}; it renders as plain text.`);
  }
  if (lines.length > LINK_WARNINGS_LISTED) {
    console.warn(
      `Content links: "${name}": and ${lines.length - LINK_WARNINGS_LISTED} more broken links ` +
        `(set "links": "error" to fail the build with every one listed).`,
    );
  }
}

/** How many broken links a `links: "warn"` build names before it counts the rest. */
const LINK_WARNINGS_LISTED = 25;

// ─── Content Type Loading ────────────────────────────────────────────────────

/** Per-load context a caller threads into {@link loadContentType}. */
interface LoadOptions {
  /** The type's asset mount; content-relative references remap onto it. */
  mount?: AssetMount | undefined;
  /** The project config: `build.trailingSlash` and the i18n routing rules. */
  projectConfig?: ProjectConfig | undefined;
  /** The locale this load is for, when the source carried `{locale}`. */
  locale?: string | undefined;
  /**
   * Ask the format to leave entry bodies unparsed (`deferBody`), and report each deferred entry to
   * `onDeferred`. A format that does not honor the option returns whole entries, and nothing is
   * deferred.
   */
  deferBody?: boolean | undefined;
  onDeferred?: DeferredBodyHandler | undefined;
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
  const { mount, projectConfig, locale, deferBody, onDeferred } = options;
  const { schema } = contentTypeDef;
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
        // A tag name as written, or the `$ref` of an element reference; anything else names nothing.
        allowedNames: contentTypeDef.$elements.flatMap((e) =>
          isString(e) ? [e] : isNonNullObject(e) && e.$ref ? [e.$ref] : [],
        ),
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
      remote = await entry.call("load", source, {
        directiveOptions,
        schema,
        ...(rules.idField !== undefined && { idField: rules.idField }),
      });
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
      const rel = relOf(filePath);
      try {
        loaded.push({ entries: loadJSONEntries(filePath), filePath, rel });
      } catch (error) {
        throw unreadableFile(name, rel ?? filePath, error);
      }
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
  const discoverOptions: FormatDiscoverOptions = { baseDir: projectRoot };
  if (!rules.exclude.empty) {
    discoverOptions.exclude = contentTypeDef.exclude;
  }
  const discovered = entry.capabilities.discover
    ? await entry.call("discover", source, discoverOptions)
    : [resolvedSource];
  const files = discovered.filter((file) => !isExcluded(file));

  const fileExtensions = files.map((file) => extname(file).toLowerCase());
  const format = entry;
  /** One file's load, with or without its body. */
  const loadFile = (filePath: string, withoutBody: boolean) => {
    const rel = relOf(filePath);
    return format.call("load", filePath, {
      directiveOptions,
      schema,
      ...(sourceRoot !== undefined && { sourceRoot }),
      ...(rules.alerts !== undefined && { alerts: rules.alerts }),
      ...(rules.idField !== undefined && { idField: rules.idField }),
      ...(withoutBody && { deferBody: true }),
      onUnknownAlert: (type: string) =>
        console.warn(
          `Content callouts: "${name}": "${rel ?? filePath}" has a [!${type}] callout, but ` +
            `"${type.toLowerCase()}" is not an enabled type, so it stays a blockquote with the ` +
            `marker showing. Add "alerts": { "${type.toUpperCase()}": true } to render it.`,
        ),
    });
  };
  const loaded: LoadedFile[] = [];
  for (const filePath of files) {
    const rel = relOf(filePath);
    let fileEntries: ContentLoaderEntry[];
    try {
      fileEntries = await loadFile(filePath, deferBody === true);
    } catch (error) {
      throw unreadableFile(name, rel ?? filePath, error);
    }
    loaded.push({ entries: fileEntries, filePath, rel });
  }
  if (loaded.length === 0 && !rules.exclude.empty) {
    console.warn(
      `Content type "${name}": no file was loaded from "${source}" with "exclude" set; if the ` +
        `folder is not empty, an exclude pattern is hiding all of it.`,
    );
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
      ...(deferBody === true && {
        onDeferred,
        reload: async (filePath: string) => await loadFile(filePath, false),
      }),
    }),
  );
}

/**
 * The error for one file that would not load, with its path: a parse failure names a line and a
 * reason but never the file, and a vault is hundreds of them.
 */
function unreadableFile(type: string, path: string, cause: unknown): Error {
  return new Error(
    `Content type "${type}": cannot read "${path}": ${errorMessage(cause)}. Fix the file, or add it ` +
      `to "exclude" if it is not a document (a templates folder, for example).`,
    { cause },
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The JavaScript type name of a field value, as `typeof` spells it, for a validation message. A
 * date, a list, a nested object, a resolved entry and `null` are all `"object"`, as they are
 * there.
 */
function jsTypeName(value: ContentFieldValue): string {
  if (isString(value)) {
    return "string";
  }
  if (isNumber(value)) {
    return "number";
  }
  return isBoolean(value) ? "boolean" : "object";
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

      if (isDateFormat(def.format) && isString(value) && !isCoercedDate(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" is declared ` +
            `${def.format} but "${value}" was not coerced — it will sort and filter as plain text.`,
        );
      } else if (def.type === "string" && !isString(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected string, got ${jsTypeName(value)}`,
        );
      } else if (def.type === "number" && !isNumber(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected number, got ${jsTypeName(value)}`,
        );
      } else if (def.type === "boolean" && !isBoolean(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected boolean, got ${jsTypeName(value)}`,
        );
      } else if (def.type === "array" && !Array.isArray(value)) {
        console.warn(
          `Content validation: "${contentTypeName}/${entry.id}" field "${field}" expected array, got ${jsTypeName(value)}`,
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
 * The content types a content type's schema points into: each field whose `$ref` (to-one) or
 * `items.$ref` (to-many) is a `#/content/<name>` pointer. What {@link resolveContentTypeRefs} will
 * look up for this type, so a type can be loaded together with exactly what it relates to.
 *
 * @param {ContentTypeDef | undefined} def - The content type's definition
 * @returns {string[]} The referenced type names, each once
 */
export function referencedContentTypes(def: ContentTypeDef | undefined): string[] {
  const targets = new Set<string>();
  for (const field of Object.values(def?.schema?.properties ?? {})) {
    const target = refTargetName(field.$ref) ?? refTargetName(field.items?.$ref);
    if (target !== undefined) {
      targets.add(target);
    }
  }
  return [...targets];
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
    const { schema } = contentTypeDef;
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
        if (toOne && isString(value)) {
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
            if (!isString(id)) {
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

/** The page patterns of a project with their locale prefix taken off (`/fr/kb/*` → `/kb/*`). */
function withoutLocalePrefix(urlPattern: string, prefix: string): string {
  return prefix !== "" && (urlPattern === prefix || urlPattern.startsWith(`${prefix}/`))
    ? urlPattern.slice(prefix.length) || "/"
    : urlPattern;
}

/** Content types whose unserved routes were already reported, per loaded section (once per build). */
const REPORTED_UNSERVED = new WeakMap<object, Set<string>>();

/**
 * Report the routed entries that no dynamic page of the project produces.
 *
 * Each page expands the routes its own pattern fits, so a project with a `[category]/[slug]` page
 * and a `[category]` page serves different entries from each, and one page skipping an entry is
 * normal. An entry NO page serves is different: it has a route, links to it were rewritten to that
 * route, and nothing generates it. It is reported once per content type, with a few of the routes.
 */
function reportUnservedRoutes(
  contentType: string,
  entries: ContentLoaderEntry[],
  ctx: ResolvePathsContext,
  prefix: string,
): void {
  if (ctx.patterns === undefined) {
    return;
  }
  const reported = REPORTED_UNSERVED.get(ctx.data) ?? new Set<string>();
  if (reported.has(contentType)) {
    return;
  }
  const patterns = ctx.patterns.map((pattern) => withoutLocalePrefix(pattern, prefix));
  const unserved = entries.flatMap((entry) => {
    const route = entry._meta?.route;
    return route !== undefined &&
      !patterns.some((pattern) => routeParams(route, pattern, []) !== null)
      ? [route]
      : [];
  });
  if (unserved.length === 0) {
    return;
  }
  reported.add(contentType);
  REPORTED_UNSERVED.set(ctx.data, reported);
  const shown = unserved.slice(0, 3).join(", ");
  console.warn(
    `Warning: $paths for content type "${contentType}": ${unserved.length} routed ` +
      `${unserved.length === 1 ? "entry has" : "entries have"} a route that no dynamic page ` +
      `produces (${shown}${unserved.length > 3 ? ", ..." : ""}), so ` +
      `${unserved.length === 1 ? "it is" : "they are"} not generated and links to ` +
      `${unserved.length === 1 ? "it" : "them"} lead nowhere. Add a page whose URL pattern fits ` +
      `them, or change the "route" template.`,
  );
}

/**
 * `$paths` for a content type with a `route`: one parameter map per entry the page can serve.
 *
 * The page pattern arrives with the locale prefix still on it (`/fr/kb/*`) while an entry's route
 * is locale-free, so the prefix is taken off first. An entry the pattern cannot produce is skipped,
 * and a page that serves none of them is reported once with an example route, because the usual
 * cause is a template and a page that were never meant for each other. Entries that NO page of the
 * project serves are reported too (see {@link reportUnservedRoutes}).
 */
function routedPaths(
  contentType: string,
  entries: ContentLoaderEntry[],
  ctx: ResolvePathsContext,
  urlPattern: string,
): ContentPathParams[] {
  const { i18n } = resolveI18n(ctx.projectConfig ?? {});
  const prefix = localeUrlPrefix(ctx.locale, i18n);
  const pattern = withoutLocalePrefix(urlPattern, prefix);
  const paths: ContentPathParams[] = [];
  let example: string | undefined;
  for (const entry of entries) {
    const route = entry._meta?.route;
    if (route === undefined) {
      continue;
    }
    example ??= route;
    const params = routeParams(route, pattern, ctx.params ?? []);
    if (params) {
      const pathEntry: ContentPathParams = { ...params };
      if (entry._meta !== undefined) {
        pathEntry._meta = entry._meta;
      }
      paths.push(pathEntry);
    }
  }
  if (paths.length === 0 && example !== undefined) {
    console.warn(
      `Warning: $paths for content type "${contentType}": no entry route fits the page pattern ` +
        `"${urlPattern}" (for example ${example}), so this page generates nothing`,
    );
  }
  reportUnservedRoutes(contentType, entries, ctx, prefix);
  return paths;
}

// ─── The section's loaded data ───────────────────────────────────────────────

/*
 * What `Content.projectData` answers, and what classes read as `_project.content`: a map of content
 * type name → entries. A build reads every entry of every type, so it gets them all at once, as it
 * always has. A host that serves one page at a time (the dev server, Studio) asks for the section
 * lazily (`ProjectDataContext.lazy`, specs/extensions.md §8), and then a type loads the first
 * time a class asks for it, with only its frontmatter, and an entry's body is parsed only once that
 * entry is actually returned.
 *
 * Both are the same class, so a consumer reads either through `load` and `materialize`, which are
 * no-ops on a store that is already whole; a consumer that reads the map directly (`get`) is a
 * build-time one and sees exactly what it always did.
 */

/** What a store loads its section with. */
export interface ContentStoreSource {
  section: ContentSection;
  root: string;
  formats: FormatRegistry;
  projectConfig: ProjectConfig | undefined;
}

export class ContentStore extends Map<string, ContentLoaderEntry[]> implements ContentSectionData {
  readonly #source: ContentStoreSource;
  readonly #mounts: Map<string, AssetMount>;
  /** Each type's load in flight or done, so concurrent asks share one. */
  readonly #loads = new Map<string, Promise<void>>();
  /** Types whose relationship fields have been resolved (it mutates entries, so exactly once). */
  readonly #linked = new Set<string>();
  /** Every entry this store loaded, to tell a related entry inside `data` from ordinary data. */
  readonly #entries = new WeakSet<object>();
  /** Entries loaded without their body, and what completes each. */
  readonly #deferred = new WeakMap<ContentLoaderEntry, () => Promise<void>>();
  /** Bodies being completed, so two requests for one entry share the work. */
  readonly #completing = new WeakMap<ContentLoaderEntry, Promise<void>>();

  private constructor(source: ContentStoreSource) {
    super();
    this.#source = source;
    this.#mounts = sectionMounts(source.section, source.root, source.projectConfig);
  }

  /** A store holding every type, bodies and relationships included: what a build reads. */
  static async whole(source: ContentStoreSource): Promise<ContentStore> {
    const store = new ContentStore(source);
    const loaded = await loadContentSection(
      source.section,
      source.root,
      source.formats,
      source.projectConfig,
    );
    for (const [name, entries] of loaded) {
      store.#adopt(name, entries);
      store.#loads.set(name, Promise.resolve());
    }
    resolveContentTypeRefs(store, source.section);
    for (const name of loaded.keys()) {
      store.#linked.add(name);
    }
    return store;
  }

  /** An empty store that loads each type when it is first asked for. */
  static lazy(source: ContentStoreSource): ContentStore {
    return new ContentStore(source);
  }

  /**
   * One type's entries, loading it (and every type its schema relates it to) on first use.
   *
   * @param {string} name - Content type name
   * @returns {Promise<ContentLoaderEntry[] | undefined>} The entries, or undefined when the section
   *   declares no such type
   */
  async load(name: string): Promise<ContentLoaderEntry[] | undefined> {
    if (!Object.hasOwn(this.#source.section, name)) {
      return undefined;
    }
    const related = this.#relatedTypes(name);
    await Promise.all(related.map(async (type) => await this.#loadType(type)));
    /* Resolved only once everything a type points into is loaded, and synchronously, so two loads
       finishing together cannot both resolve one type: its fields would be looked up twice, the
       second time with entries where the ids were. */
    const unlinked = related.filter((type) => !this.#linked.has(type));
    for (const type of unlinked) {
      this.#linked.add(type);
    }
    if (unlinked.length > 0) {
      const { section } = this.#source;
      resolveContentTypeRefs(
        this,
        Object.fromEntries(
          unlinked.flatMap((type) => (section[type] ? [[type, section[type]]] : [])),
        ),
      );
    }
    return this.get(name);
  }

  /**
   * Give every entry in `entries` its body, and every entry they relate to through a relationship
   * field, before they are handed out. An entry that already has one is left as it is.
   *
   * @param {readonly (ContentLoaderEntry | null | undefined)[]} entries - Entries about to be
   *   returned
   */
  async materialize(entries: readonly (ContentLoaderEntry | null | undefined)[]): Promise<void> {
    const seen = new Set<ContentLoaderEntry>();
    const pending: Promise<void>[] = [];
    const visit = (entry: ContentLoaderEntry) => {
      if (seen.has(entry)) {
        return;
      }
      seen.add(entry);
      pending.push(this.#complete(entry));
      for (const value of Object.values(entry.data)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (this.#isEntry(item)) {
            visit(item);
          }
        }
      }
    };
    for (const entry of entries) {
      if (entry) {
        visit(entry);
      }
    }
    await Promise.all(pending);
  }

  /**
   * Load every type and give every entry its body: the store becomes exactly what
   * {@link ContentStore.whole} builds. A host does this before handing `_project` to a class that
   * reads it synchronously (one that does not declare `projectOnDemand`, specs/extensions.md §8).
   */
  async complete(): Promise<void> {
    const lists = await Promise.all(
      Object.keys(this.#source.section).map(async (name) => (await this.load(name)) ?? []),
    );
    await this.materialize(lists.flat());
  }

  /** The type and every type reachable through its schema's relationship fields. */
  #relatedTypes(name: string): string[] {
    const { section } = this.#source;
    const found = new Set<string>([name]);
    const queue = [name];
    for (let type = queue.shift(); type !== undefined; type = queue.shift()) {
      for (const target of referencedContentTypes(section[type])) {
        if (Object.hasOwn(section, target) && !found.has(target)) {
          found.add(target);
          queue.push(target);
        }
      }
    }
    return [...found];
  }

  #loadType(name: string): Promise<void> {
    let load = this.#loads.get(name);
    if (!load) {
      const { section, root, formats, projectConfig } = this.#source;
      load = loadSectionType(name, {
        formats,
        mounts: this.#mounts,
        onDeferred: (entry, completeBody) => {
          this.#deferred.set(entry, completeBody);
        },
        projectConfig,
        root,
        section,
      }).then((entries) => {
        this.#adopt(name, entries);
      });
      /* A failed load is not kept: the error reaches this ask, and the next one tries again (the
         file may have been fixed in between). */
      load.catch(() => {
        this.#loads.delete(name);
      });
      this.#loads.set(name, load);
    }
    return load;
  }

  #adopt(name: string, entries: ContentLoaderEntry[]): void {
    for (const entry of entries) {
      this.#entries.add(entry);
    }
    this.set(name, entries);
  }

  /* A related entry is placed into `data` by `resolveContentTypeRefs`, so membership in the set of
     entries this store loaded is exactly the test, and it never mistakes an object field for one. */
  #isEntry(value: ContentLoaderEntry["data"][string]): value is ContentLoaderEntry {
    return isNonNullObject(value) && this.#entries.has(value);
  }

  #complete(entry: ContentLoaderEntry): Promise<void> {
    let completing = this.#completing.get(entry);
    if (!completing) {
      const completeBody = this.#deferred.get(entry);
      if (!completeBody) {
        return Promise.resolve();
      }
      completing = completeBody().then(() => {
        this.#deferred.delete(entry);
      });
      // A failed body is retried by the next ask, as a failed type load is.
      completing.catch(() => {
        this.#completing.delete(entry);
      });
      this.#completing.set(entry, completing);
    }
    return completing;
  }
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
   * resolved. A host that asks for it `lazy` gets a {@link ContentStore} that loads each type the
   * first time a class asks for it and each entry's body only once that entry is returned
   * (specs/extensions.md §8); either way the answer is a map of type name to entries.
   *
   * @param {ContentSection | undefined} sectionValue - The project.json `content` section value
   * @param {ProjectDataContext} ctx - Host context ({ projectConfig, root, registry, io, lazy })
   * @returns {Promise<ContentStore>} Content type name → entries
   */
  static async projectData(
    sectionValue: ContentSection | undefined,
    ctx: ProjectDataContext,
  ): Promise<ContentStore> {
    const source = {
      formats: ctx.registry.formats,
      projectConfig: ctx.projectConfig,
      root: ctx.root,
      section: sectionValue ?? {},
    };
    return ctx.lazy === true ? ContentStore.lazy(source) : await ContentStore.whole(source);
  }

  /**
   * Publish each content type's source directory at `/content/<type>` (specs/extensions.md §8.5).
   * Hosts serve, resolve, and copy files through the returned mounts, which is what lets an entry
   * reference `../images/hero.png` and still resolve in a built site, the dev server, and Studio.
   *
   * @param {ContentSection | undefined} sectionValue - The project.json `content` section value
   * @param {{ projectConfig?: ProjectConfig; root: string }} ctx - Host context
   * @returns {AssetMount[]} One mount per content type with a local directory source
   */
  static assets(
    sectionValue: ContentSection | undefined,
    ctx: { root: string; projectConfig?: ProjectConfig },
  ): AssetMount[] {
    return contentAssetMounts(sectionValue ?? {}, ctx.root, ctx.projectConfig);
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
   * @returns {Promise<ContentPathParams[]>} Array of route-param objects
   */
  static async resolvePaths(
    pathsDef: ContentPathsSource,
    ctx: ResolvePathsContext,
  ): Promise<ContentPathParams[]> {
    const entries = await entriesOf(ctx.data, pathsDef.contentType);
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
      localized && isString(wanted)
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
    const paths: ContentPathParams[] = [];
    for (const entry of scoped) {
      const value = field === "id" ? entry.id : (entry.data[field] ?? entry.id);
      if (!value) {
        continue;
      }
      /* The value becomes a directory under the output. It may be frontmatter (`field`, or an id
         taken from `idField`), so a value that would climb out of the output directory does not
         get a page. */
      const unsafe = traversalReason(String(value));
      if (unsafe !== null) {
        console.warn(
          `Warning: $paths for content type "${pathsDef.contentType}": the ${field === "id" ? "id" : `"${field}"`} ` +
            `of "${entry.id}" ${unsafe}, so no page is generated for it`,
        );
        continue;
      }
      const pathEntry: ContentPathParams = { [param]: value };
      if (entry._meta !== undefined) {
        pathEntry._meta = entry._meta;
      }
      paths.push(pathEntry);
    }
    return paths;
  }
}
