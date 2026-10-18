/**
 * The `$site` and `$page` a page or a collection entry is drawn with on the canvas.
 *
 * A built page reads `${$page.locale}`, `${$page.url}` and `${$site.name}` from the state the build
 * injects (site-architecture.md §10, §13.4). The canvas injected none of it, so every one of those
 * bindings was undefined there: a component handed `$page.locale` as its locale threw a
 * `RangeError` and was not rendered, and Preview of a multilingual page drew no list at all. The
 * injection is `@jxsuite/site/context`'s, the one the build calls, because a host that improvised
 * its own subset would differ from the build in whichever field it forgot.
 *
 * The route is the document's own: a page's URL pattern from its file, with the route parameters
 * chosen for the preview; an entry's URL from its collection's template page in the entry's own
 * language (studio.md §22.5), with the entry filling the page's parameter.
 *
 * @docs studio/interface/canvas
 */

import { injectContext } from "@jxsuite/site/context";
import { documentUrlPattern } from "@jxsuite/site/routes";
import { isString } from "@jxsuite/schema/guards";
import { resolveI18n } from "@jxsuite/schema/locale";
import { collectionForFile } from "../content/collection-match";
import { collectionPage, entryLocale, entryUrl } from "../content/collection-pages";
import type { SiteRoute } from "@jxsuite/site/context";
import type {
  JxDocument,
  JxDocumentValue,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";

/** The two injected state entries. */
export interface PageContext {
  $site: JxStateDefinition;
  $page: JxStateDefinition;
}

/** What {@link pageContextFor} reads off the document being drawn. */
export interface PageContextSource {
  /** The project-relative path of the page or entry. */
  documentPath: string;
  /** Whether it is a collection entry rather than a page. */
  isEntry: boolean;
  /** The document's own `title` and `$lang`, which win over the route's. */
  title?: JxDocumentValue | undefined;
  lang?: JxDocumentValue | undefined;
  /** An entry's fields (Markdown frontmatter), which may fill its URL and title. */
  fields?: Readonly<Record<string, JxDocumentValue | undefined>> | null;
  /** The route parameters chosen for a dynamic page's preview. */
  params?: Readonly<Record<string, string>>;
}

/** The parameters `url` fills in `pattern`, by position: `/blog/:slug` and `/blog/a` → `{slug: a}`. */
export function routeParams(pattern: string, url: string): NonNullable<SiteRoute["_pathParams"]> {
  const values = url.split("/");
  const out: NonNullable<SiteRoute["_pathParams"]> = {};
  for (const [i, name] of pattern.split("/").entries()) {
    const value = values[i];
    if (name.startsWith(":") && value !== undefined) {
      out[name.slice(1)] = value;
    }
  }
  return out;
}

/** The route a document is served at, as the build would serve it. */
async function routeOf(source: PageContextSource): Promise<SiteRoute> {
  const { documentPath, fields, isEntry, params } = source;
  if (!isEntry) {
    return {
      _pathParams: { ...params },
      sourcePath: documentPath,
      urlPattern: documentUrlPattern(documentPath),
    };
  }
  const match = collectionForFile(documentPath);
  const page = match ? await collectionPage(match.name, entryLocale(documentPath)) : null;
  const url = entryUrl(page, documentPath, fields);
  if (!page || url === null) {
    return { _pathParams: {}, sourcePath: documentPath, urlPattern: page?.pattern ?? "/" };
  }
  return { _pathParams: routeParams(page.pattern, url), sourcePath: page.path, urlPattern: url };
}

/**
 * The `$site` and `$page` for one document, injected exactly as the build injects them, or `null`
 * when there is no project configuration to inject from.
 */
export async function pageContextFor(
  source: PageContextSource,
  projectConfig: ProjectConfig | null | undefined,
): Promise<PageContext | null> {
  if (!projectConfig) {
    return null;
  }
  const route = await routeOf(source);
  const fieldTitle = source.fields?.title;
  const title = isString(source.title) ? source.title : isString(fieldTitle) ? fieldTitle : null;
  // A scratch document: the injection writes project state, `$media`, imports and `$elements` onto
  // The document it is handed, and the canvas composes those its own way. Only the two context
  // Entries are taken from it.
  const doc: JxDocument = { state: {} };
  if (title !== null) {
    doc.title = title;
  }
  if (isString(source.lang)) {
    doc.$lang = source.lang;
  }
  const scratch = injectContext(doc, projectConfig, route, null, resolveI18n(projectConfig).i18n);
  const { $page, $site } = scratch.state ?? {};
  return $page === undefined || $site === undefined ? null : { $page, $site };
}
