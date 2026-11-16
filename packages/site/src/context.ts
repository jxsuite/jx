/**
 * $page and $site context injection
 *
 * Injects project-level and page-level context variables into a page's state before compilation.
 * These are available as $site.* and $page.* in template expressions.
 *
 * Per site-architecture spec §10:
 *
 * - `$site.name`, `$site.url`: from the project file's `name` and `url`.
 * - `$site.<key>`: each project `state` entry as written, read-only, never replacing the four names
 *   in {@link SITE_CONTEXT_KEYS} (§10.4).
 * - `$page.url`, `$page.params`: the current page's URL path and dynamic route parameters.
 * - `$page.title`, `$page.description`: the page's own title (else `$site.name`) and the content of
 *   its own description meta, absent when it declares none (§5.5).
 * - `$page.locale`, `$page.dir`: the page's own `$lang`, else the route's, and its writing direction
 *   (§13.4).
 * - `$page.alternates`: this page in every language it exists in (§13.5).
 * - `$page.pagination`: where a paged route's page sits in its list (§4.3).
 *
 * The page's own facts come from the caller ({@link PageFacts}), read from the page before a layout
 * wrapped it, because the document injected into is the layout's clone and its `title` and `$lang`
 * are the layout's (§5.5). Called with none, the document is read as the page, which is right for a
 * page no layout wrapped.
 *
 * Each project `state` entry is also copied into the page's own `state` unless the page or its
 * layout declares the key.
 *
 * The site build is not the only thing that has to produce this state. A page rendered live — on
 * the studio's canvas, or by the cloud's preview origin — binds `${$site.name}` and `${$page.url}`
 * exactly as a built page does, and a host that improvised its own subset would differ from the
 * build in whichever field it forgot. So the injection lives here, with no platform imports; the
 * one thing that genuinely needed a filesystem, rebasing relative `imports` onto the page's own
 * directory, is injected as {@link ImportRebaser} and simply absent where there are no
 * directories.
 *
 * @docs framework/site/i18n
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type {
  JxDocument,
  JxElement,
  JxHeadEntry,
  JxStateObject,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { localeDirection, localeLabel, localeOfRoute } from "@jxsuite/schema/locale";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import { readPageFacts } from "./layout.ts";
import type { PageFacts } from "./layout.ts";
import type { PagePagination } from "./pagination.ts";

/**
 * One route in a translation set: the locale it serves, and where it lives. The shape `<head>` and
 * `$page.alternates` share.
 */
export interface TranslationMember {
  /** Canonical BCP 47 tag. */
  locale: string;
  /** Site-absolute route pattern, e.g. `/fr-ca/about/`. */
  urlPattern: string;
}

/** The route a page is being injected for. */
export interface SiteRoute {
  urlPattern: string;
  sourcePath?: string;
  _pathParams?: Record<string, string>;
  /** Set on a page of a paged list (§4.3); becomes `$page.pagination`. */
  pagination?: PagePagination;
}

/**
 * Rewrite one project-level relative `imports` entry so it resolves from the PAGE's directory.
 *
 * Only a host with real directories can answer this — and only one needs to. A live renderer serves
 * the project at a root where the authored path already means what it says, so it passes nothing
 * and the entry is used as written.
 */
export type ImportRebaser = (src: string, route: SiteRoute) => string;

/**
 * The names `$site` defines itself (site-architecture.md §5.5). A project `state` entry with one of
 * these names reaches the page as bare state only (§10.4).
 */
export const SITE_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "defaultLocale",
  "locales",
  "name",
  "url",
]);

/**
 * The `content` of the last `<meta name="description">` in a page's head: the entry `mergeHead`
 * keeps when a head states the description twice.
 *
 * @param {readonly JxHeadEntry[]} head - The page's own head
 * @returns {string | undefined} The description, or undefined when the head states none
 */
export function pageDescription(head: readonly JxHeadEntry[]): string | undefined {
  let description: string | undefined;
  for (const entry of head) {
    if (
      isNonNullObject(entry) &&
      entry.tagName === "meta" &&
      entry.attributes?.name === "description" &&
      isString(entry.attributes.content)
    ) {
      description = entry.attributes.content;
    }
  }
  return description;
}

/**
 * Inject $site and $page context into a page document's state.
 *
 * @param {JxDocument} doc - The page document (mutated)
 * @param {ProjectConfig} projectConfig - Loaded project configuration
 * @param {SiteRoute} route - The resolved route for this page
 * @param {ImportRebaser | null} [rebaseImport] - Rebases relative `imports` onto the page directory
 * @param {ResolvedI18n | null} [i18n] - Validated locale config, when the project declares one
 * @param {readonly TranslationMember[]} [translations] - This route's translation set, itself
 *   included
 * @param {PageFacts} [page] - What the page says about itself; read from `doc` when absent
 * @returns {JxDocument} The mutated document
 */
export function injectContext(
  doc: JxDocument,
  projectConfig: ProjectConfig,
  route: SiteRoute,
  rebaseImport: ImportRebaser | null = null,
  i18n: ResolvedI18n | null = null,
  translations: readonly TranslationMember[] = [],
  page: PageFacts = readPageFacts(doc),
) {
  if (!doc.state) {
    doc.state = {};
  }

  // $site context — read-only project-level data
  const localeFields: JxStateObject = {};
  if (i18n !== null) {
    localeFields.defaultLocale = i18n.defaultLocale;
    localeFields.locales = i18n.locales;
  }
  /* Project state goes first and the context's own names last, so a state entry called `name` can
     never stand in for the project's name; it is left out altogether so that a project without
     `i18n` does not grow a `$site.locales` from its state. `Object.fromEntries` and a spread, not
     `Object.assign`: an authored `__proto__` key stays an own data property. */
  const siteName = projectConfig.name ?? "Jx Site";
  doc.state.$site = {
    ...Object.fromEntries(
      Object.entries(projectConfig.state ?? {}).filter(([key]) => !SITE_CONTEXT_KEYS.has(key)),
    ),
    name: siteName,
    url: projectConfig.url ?? "",
    ...localeFields,
  };

  /*
   * $page context — read-only page-level data.
   *
   * The locale lives here rather than as a top-level `$locale` because that is what it is: a
   * property of the route, not a third ambient namespace beside $site and $page. A document's own
   * `$lang` still wins over the route's locale, so this is the resolved answer, not the prefix.
   */
  const pageLang =
    page.lang ?? localeOfRoute(route.urlPattern, i18n) ?? projectConfig.defaults?.lang;
  /*
   * The same translation set `<head>` advertises, in the shape a template can render: a language
   * switcher is the one part of a multilingual site the framework cannot write for the author, and
   * without this it could only be hand-maintained — a hardcoded list of URLs that goes stale the
   * moment a page gains or loses a translation, silently, in the one place a reader would use it.
   *
   * Site-absolute URLs, not the absolute hrefs `<head>` needs: a switcher is an internal link, and
   * it has to work before `url` is configured. `current` marks the member this route *is*, taken
   * from the route rather than from `$page.locale`, because a document whose `$lang` disagrees with
   * its directory is still served from that directory.
   */
  const alternates = translations.map((member) => ({
    code: member.locale,
    current: member.urlPattern === route.urlPattern,
    dir: localeDirection(member.locale),
    label: localeLabel(member.locale),
    url: member.urlPattern,
  }));
  const pageState: JxStateObject = {
    params: route._pathParams ?? {},
    title: page.title ?? siteName,
    url: route.urlPattern,
  };
  const description = pageDescription(page.head ?? []);
  if (description !== undefined) {
    pageState.description = description;
  }
  if (alternates.length > 0) {
    pageState.alternates = alternates;
  }
  if (route.pagination) {
    const { first, itemCount, last, next, number, pageCount, pageSize, pages, prev } =
      route.pagination;
    pageState.pagination = {
      first,
      itemCount,
      last,
      next,
      number,
      pageCount,
      pageSize,
      pages: pages.map(({ current, number: n, url }) => ({ current, number: n, url })),
      prev,
    };
  }
  if (pageLang !== undefined) {
    pageState.dir = localeDirection(pageLang);
    pageState.locale = pageLang;
  }
  doc.state.$page = pageState;

  // Merge project-level state into page state: the page, then its layout, wins
  // (site-architecture.md §10.4)
  if (projectConfig.state) {
    for (const [key, value] of Object.entries(projectConfig.state)) {
      if (key !== "$site" && key !== "$page" && !(key in doc.state)) {
        doc.state[key] = value;
      }
    }
  }

  // Merge project-level $media into page $media
  if (projectConfig.$media) {
    doc.$media = { ...projectConfig.$media, ...doc.$media };
  }

  // Merge project-level imports into page imports (page wins on collision)
  if (projectConfig.imports && Object.keys(projectConfig.imports).length > 0) {
    if (!doc.imports) {
      doc.imports = {};
    }
    for (const [name, srcPath] of Object.entries(projectConfig.imports)) {
      if (!(name in doc.imports)) {
        // Only rebase relative paths — bare/npm specifiers pass through unmodified
        doc.imports[name] =
          rebaseImport && (srcPath.startsWith("./") || srcPath.startsWith("../"))
            ? rebaseImport(srcPath, route)
            : srcPath;
      }
    }
  }

  // Merge project-level $elements into page $elements (union, dedup)
  if (projectConfig.$elements?.length) {
    if (!doc.$elements?.length) {
      doc.$elements = [...projectConfig.$elements];
    } else {
      const seen = new Set<string>();
      const merged: (string | JxElement)[] = [];
      for (const entry of [...projectConfig.$elements, ...doc.$elements]) {
        /* `$elements` is authored JSON, so an entry typed as an element can still be `null`; the
           object check keeps such an entry keyless (and dropped) instead of throwing. */
        const key = isString(entry) ? entry : isNonNullObject(entry) ? entry.$ref : undefined;
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(entry);
        }
      }
      doc.$elements = merged;
    }
  }

  return doc;
}
