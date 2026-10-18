/**
 * The Site panel's derivations — pure, no DOM, no platform (`specs/studio.md` §5.7).
 *
 * The panel lists the project as an author thinks of it: pages by address, then the templates,
 * components and media pages are made of. Everything here turns facts the flow has already gathered
 * (paths, `$paths.contentType`, entry counts, usage counts) into the rows the surface draws, so the
 * ordering, the nesting, the labels and the filter are testable without a project.
 *
 * **Routes come from the router.** Rows are ordered and labelled with `fileToRoute` and
 * `compareRoutes` from `@jxsuite/site/routes` — the functions the build's page discovery sorts with
 * — so the panel's order is the order the site resolves routes in, and a label is the URL a visitor
 * types. `isRoutedPageFile` drops the `_`-prefixed files and directories the router ignores.
 *
 * @docs studio/interface
 */

import { compareRoutes, fileToRoute, isRoutedPageFile } from "@jxsuite/site/routes";
import type { FileRoute } from "@jxsuite/site/routes";

/** One file under `pages/`, with the collection its `$paths.contentType` names, if any. */
export interface SitePageFact {
  /** Project-relative, `pages/…`. */
  path: string;
  /** The collection a dynamic page expands over, or `null` for every other page. */
  contentType: string | null;
}

/**
 * Whether a row is the focused document's, as the `data-selected` string the style block keys on: a
 * boolean renders as a bare attribute, which `[data-selected="true"]` cannot match.
 */
export type SiteSelected = "true" | "false";

/** The {@link SiteSelected} string for a comparison. */
export function selectedFlag(selected: boolean): SiteSelected {
  return selected ? "true" : "false";
}

/** One row of the Pages section. Every field is a value the document draws. */
export interface SitePageRow {
  /** The row's identity: the page's path, or `collection:<name>` for a collection heading row. */
  key: string;
  /** What a click opens; empty for a collection heading, which opens nothing yet (§22.5). */
  path: string;
  /** The name: "Home", "About", "Post page", "Posts". */
  label: string;
  /** The URL pattern, or the entry count for a collection heading. */
  detail: string;
  /** `collection` heads a nested group; `page` is a page; `entry-page` is a page nested under one. */
  kind: "page" | "collection" | "entry-page";
  /** Whether the row is the document showing in the focused pane. */
  selected: SiteSelected;
}

/** One row of the Templates section. */
export interface SiteTemplateRow {
  key: string;
  path: string;
  label: string;
  /** "used by N pages", or empty where the host has no reference index (the count is omitted). */
  detail: string;
  selected: SiteSelected;
}

/** One component card. */
export interface SiteComponentRow {
  /** The tag — unique in a project's registry, so it is the card's key and its drag identity. */
  key: string;
  tagName: string;
  /** The definition file, or empty for a package component with none. */
  path: string;
  label: string;
  /** The card's tooltip: what a click does for this card, and that it drags. */
  hint: string;
  selected: SiteSelected;
}

/** One media thumbnail. */
export interface SiteMediaRow {
  /** The project file — what a thumbnail drags and what Open shows. */
  key: string;
  path: string;
  name: string;
  /** `image` draws a thumbnail; anything else draws the file's name on a plain tile. */
  thumb: "image" | "file";
  /** The URL the parent realm can load — empty for a non-image. */
  src: string;
  selected: SiteSelected;
}

/** The words a filter is matched against: lower-case, trimmed. Empty matches everything. */
export function filterNeedle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Whether any of a row's words contains the needle. */
export function matchesFilter(needle: string, ...words: readonly string[]): boolean {
  return needle === "" || words.some((word) => word.toLowerCase().includes(needle));
}

/** "about-us" → "About us". The first letter is raised; the rest is left as written. */
export function humanize(name: string): string {
  const words = name.replaceAll(/[-_]+/g, " ").trim();
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The singular an author would say for one entry of a collection: "posts" → "Post", "stories" →
 * "Story". A label, not a grammar engine: a collection whose name does not end in a plain plural is
 * used as written.
 */
export function singularLabel(collection: string): string {
  const name = humanize(collection);
  if (/ies$/i.test(name)) {
    return `${name.slice(0, -3)}y`;
  }
  if (/[^s]s$/i.test(name)) {
    return name.slice(0, -1);
  }
  return name;
}

/** The last path segment without its extension: `pages/blog/index.json` → `index`. */
function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * A page's name, from its route rather than its file: `/` is Home, `/about` is About, an index file
 * is named for its directory, and a dynamic page for the last static segment of its URL
 * (`/project_tag/:slug` is Project tag), because that is the name the URL gives it.
 */
export function pageLabel(route: FileRoute, path: string): string {
  if (route.urlPattern === "/") {
    return "Home";
  }
  const segments = route.urlPattern.split("/").filter((segment) => segment !== "");
  const isParam = (segment: string): boolean => segment === "*" || segment.startsWith(":");
  const last = segments.at(-1) ?? stem(path);
  if (!isParam(last)) {
    return humanize(last);
  }
  /* A dynamic page is named for the directory its URL names (`/author/:slug` is Author), and only
     a route with no static segment at all falls back to its file's parameter name. */
  const named = segments.findLast((segment) => !isParam(segment));
  return humanize(named ?? stem(path).replaceAll(/[[\].]/g, ""));
}

interface RoutedPage {
  fact: SitePageFact;
  route: FileRoute;
}

/**
 * The Pages section's rows, in route order, with every page whose `$paths.contentType` names a
 * declared collection nested under that collection's heading row.
 *
 * The heading sits where its FIRST page would have sat, so a collection's group keeps the router's
 * order rather than being hoisted above the static pages. A `contentType` that names no declared
 * collection is listed as an ordinary page: nesting it under a heading for a collection the project
 * does not have would be inventing one.
 *
 * @param pages Every file under `pages/`, routed or not.
 * @param collections Declared collection names, mapped to their entry counts (`null` while
 *   unknown).
 * @param activePath The focused document's path, which marks its row selected.
 */
export function pageRows(
  pages: readonly SitePageFact[],
  collections: ReadonlyMap<string, number | null>,
  activePath: string | null,
): SitePageRow[] {
  const routed: RoutedPage[] = pages
    .flatMap((fact) =>
      isRoutedPageFile(fact.path) ? [{ fact, route: fileToRoute(fact.path) }] : [],
    )
    .toSorted((a, b) => compareRoutes(a.route, b.route) || a.fact.path.localeCompare(b.fact.path));
  const rows: SitePageRow[] = [];
  const pageRow = (
    fact: SitePageFact,
    route: FileRoute,
    kind: "page" | "entry-page",
    label: string,
  ): SitePageRow => ({
    detail: route.urlPattern,
    key: fact.path,
    kind,
    label,
    path: fact.path,
    selected: selectedFlag(fact.path === activePath),
  });
  /* A collection's pages, in route order. Its whole group is emitted at its heading, because the
     surface nests by position: a page left where it sorted would read as the previous group's. */
  const groups = new Map<string, RoutedPage[]>();
  for (const page of routed) {
    const collection = page.fact.contentType;
    if (collection !== null && collections.has(collection)) {
      groups.set(collection, [...(groups.get(collection) ?? []), page]);
    }
  }
  const headed = new Set<string>();
  for (const { fact, route } of routed) {
    const collection = fact.contentType;
    const group = collection === null ? undefined : groups.get(collection);
    if (collection === null || group === undefined) {
      rows.push(pageRow(fact, route, "page", pageLabel(route, fact.path)));
      continue;
    }
    if (headed.has(collection)) {
      continue;
    }
    headed.add(collection);
    rows.push({
      detail: entryCountLabel(collections.get(collection) ?? null),
      key: `collection:${collection}`,
      kind: "collection",
      label: humanize(collection),
      path: "",
      selected: "false",
    });
    for (const member of group) {
      rows.push(
        pageRow(member.fact, member.route, "entry-page", `${singularLabel(collection)} page`),
      );
    }
  }
  return rows;
}

/** "12 entries", "1 entry", or "" while the count is still being read. */
export function entryCountLabel(count: number | null): string {
  if (count === null) {
    return "";
  }
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * Keep the page rows a filter matches. A collection heading stays when it matches or when any page
 * under it does, so a match is never shown without the group it belongs to.
 */
export function filterPageRows(rows: readonly SitePageRow[], needle: string): SitePageRow[] {
  if (needle === "") {
    return [...rows];
  }
  const kept: SitePageRow[] = [];
  let heading: SitePageRow | null = null;
  let headingKept = false;
  for (const row of rows) {
    if (row.kind === "collection") {
      heading = row;
      headingKept = matchesFilter(needle, row.label);
      if (headingKept) {
        kept.push(row);
      }
      continue;
    }
    if (row.kind === "page") {
      heading = null;
    }
    const groupMatched = row.kind === "entry-page" && headingKept;
    if (groupMatched || matchesFilter(needle, row.label, row.detail, row.path)) {
      if (heading && !headingKept) {
        kept.push(heading);
        headingKept = true;
      }
      kept.push(row);
    }
  }
  return kept;
}

/** "used by 3 pages", "used by 1 page", "not used yet", or "" when the count is unknown. */
export function usedByLabel(pages: number | null): string {
  if (pages === null) {
    return "";
  }
  if (pages === 0) {
    return "not used yet";
  }
  return `used by ${pages} ${pages === 1 ? "page" : "pages"}`;
}

/**
 * The Templates section's rows: every JSON layout under `layouts/`, by path. Layouts are JSON only
 * (the layout resolver parses nothing else), so a non-JSON file there is not a template.
 *
 * The project's default layout (`defaults.layout`) says so instead of a count: every page that
 * names no layout uses it without referencing it, so the reference index's count would read "not
 * used yet" for the layout most pages are poured into.
 */
export function templateRows(
  paths: readonly string[],
  usedBy: (path: string) => number | null,
  activePath: string | null,
  needle: string,
  defaultPath: string | null = null,
): SiteTemplateRow[] {
  return paths
    .filter((path) => path.endsWith(".json"))
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((path) => {
      const label = humanize(stem(path));
      if (!matchesFilter(needle, label, path)) {
        return [];
      }
      return [
        {
          detail: path === defaultPath ? "default layout" : usedByLabel(usedBy(path)),
          key: path,
          label,
          path,
          selected: selectedFlag(path === activePath),
        },
      ];
    });
}
