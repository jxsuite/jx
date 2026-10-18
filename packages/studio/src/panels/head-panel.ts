/// <reference lib="dom" />
/**
 * The Page panel — the Inspector's first tab (§6) — everything the open document says about itself
 * before anybody reads its body: its frontmatter, the layout it is poured into, its title,
 * description, viewport and icon, its OpenGraph card, and the raw `$head` tags no structured
 * control owns.
 *
 * This is the FLOW. The markup is `surfaces/panel-page.json` and the scope that feeds it is
 * `surfaces/panel-page.ts`; what stays here is every decision — what a `$head` entry means, which
 * of them a structured control already owns, which realm a title lives in, what the layout cascade
 * resolves to, and what each row commits into.
 *
 * **The drafts live here, not in the DOM.** The add-a-tag form used to be three `ref()` handles
 * read at submit time, which is a spelling a document does not have: a binding writes only when the
 * SCOPE moves, so every field's setter states what the control now holds before anything is decided
 * about it, and clearing one after a successful add is then a real change the runtime carries back.
 * `sync()` — not a dock repaint — is what an echo calls: it assigns into the standing scope in the
 * same turn, where a dock repaint is a frame away and would rebuild far more than one field.
 *
 * **What a frontmatter row looks like is `panels/frontmatter-fields.ts`'s answer.** The Document
 * Header card draws the same field set from the same schemas; the two surfaces deciding
 * independently that a `$ref` is a picker or that an array is a comma-separated line is how they
 * came to disagree about `title` in the first place.
 *
 * The other half of this module has no surface at all: the merged-`$head` preview model that
 * `panels/seo-modal.ts` and the Document Header card both read. It is pure, and pinned against
 * `packages/compiler/src/site/head-merger.ts` by `tests/head-panel.test.ts`.
 */

import { isString } from "@jxsuite/schema/guards";
import { withPageDescription } from "@jxsuite/site/head-merger";
import { projectState, renderOnly, updateSession } from "../store";
import type { DirEntry, JsonValue } from "../types";
import { activeTab } from "../workspace/workspace";
import { activeRegistry } from "../commands/active-registry";
import { clearProblems, notify } from "../services/notify";
import type { NotifyOptions } from "../services/notify";
import { mutateUpdateFrontmatter, transact, transactDoc } from "../tabs/transact";
import { collectFmFields, projectFmField } from "./frontmatter-fields";
import { isGoogleFontEntry, isGoogleFontPreconnect } from "../utils/google-fonts";
import { getEffectiveLayoutPath, invalidateLayoutCache, resolveLayoutDoc } from "../site-context";
import { getPlatform } from "../platform";
import { pageRoute } from "./tab-strip";
import { LIVE_PREVIEW } from "../ui/timing";
import { previewAssetSrc } from "../canvas/asset-refs";
import { IMAGE_EXTENSIONS, extensionOf } from "../files/media-upload";
import { renderPagePanelSurface, unmountPagePanelSurface } from "../surfaces/panel-page";
import { emptyState } from "../surfaces/empty-state";
import type { EmptyStateSpec } from "./empty-state";
import { collectionForFile } from "../content/collection-match";
import {
  isEntryTab,
  renderEntryInspector,
  unmountEntryInspector,
} from "../content/entry-inspector";

import type { JxHeadEntry, JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import type * as MediaPickerModule from "../ui/media-picker";
import type {
  PagePanelActions,
  PagePanelView,
  PageRow,
  PageSection,
  PageTagRow,
} from "../surfaces/panel-page";
import type { SurfaceOption } from "../ui/surface";
import type { SeoWarningView } from "../surfaces/seo";

interface MetaField {
  label: string;
  attr: "name" | "property";
  key: string;
  multiline?: boolean;
  media?: boolean;
}

// ─── Layout picker ──────────────────────────────────────────────────────────

/** @type {{ name: string; path: string }[] | null} */
let layoutEntries: { name: string; path: string }[] | null = null;

/**
 * List `layouts/` now and keep the answer as the picker's cache.
 *
 * The one reading of which files are layouts and what each is called: the Page panel's picker and
 * Add new (`create/add-new-flow.ts`) both read it, so they cannot name different templates. JSON
 * only, because a layout is resolved as JSON.
 */
export async function listLayoutEntries(): Promise<{ name: string; path: string }[]> {
  try {
    const platform = getPlatform();
    const listing = await platform.listDirectory("layouts");
    layoutEntries = listing
      .filter((f: DirEntry) => f.type === "file" && f.name.endsWith(".json"))
      .map((f: DirEntry) => ({
        name: f.name
          .replace(/\.json$/, "")
          .replaceAll(/[-_]+/g, " ")
          .replaceAll(/\b\w/g, (c) => c.toUpperCase()),
        path: `./layouts/${f.name}`,
      }));
  } catch {
    layoutEntries = [];
  }
  return layoutEntries;
}

async function loadLayoutEntries() {
  await listLayoutEntries();
  renderOnly("rightPanel", "frontmatterPanel", "seoModal");
}

/**
 * Forget every cached fact about layouts this module holds — the picker's listing AND the effective
 * layout's `$head`, because "the layouts changed" is one event and answering it in two halves is
 * how a preview ends up attributing a deleted layout's description to the open page.
 */
export function invalidateLayoutPickerCache() {
  layoutEntries = null;
  invalidateLayoutHeadCache();
}

/**
 * The layouts the picker offers, or `null` while the directory is still being listed.
 *
 * The listing BOTH surfaces draw their Layout picker from, handed over as DATA. The Page panel
 * (`src/surfaces/panel-page.json`) and the Document Header card (`src/surfaces/doc-header.json`)
 * are documents and neither can interpolate the other's markup — but a second LISTING would be a
 * second cache with a second lifetime, and {@link invalidateLayoutPickerCache} would then forget
 * only one of them. Asking starts the read; it repaints both surfaces when it lands.
 *
 * @returns {{ name: string; path: string }[] | null}
 */
export function layoutPickerEntries(): { name: string; path: string }[] | null {
  if (layoutEntries === null) {
    void loadLayoutEntries();
  }
  return layoutEntries;
}

// ─── Field definitions ───────────────────────────────────────────────────

export const PAGE_FIELDS: MetaField[] = [
  { attr: "name", key: "description", label: "Description" },
  { attr: "name", key: "viewport", label: "Viewport" },
];

export const OG_FIELDS: MetaField[] = [
  { attr: "property", key: "og:title", label: "Title" },
  {
    attr: "property",
    key: "og:description",
    label: "Description",
    multiline: true,
  },
  { attr: "property", key: "og:image", label: "Image", media: true },
  { attr: "property", key: "og:type", label: "Type" },
];

/** Set of `name`/`property` values managed by the structured forms. */
const MANAGED_META_KEYS = new Set([...PAGE_FIELDS, ...OG_FIELDS].map((f) => f.key));

/**
 * Frontmatter keys the Document Header card owns with a dedicated control, so the generic field
 * list must not print them a second time.
 *
 * **The one policy.** `frontmatter-panel.ts` used to pass an EMPTY reserved set while this module
 * passed `{title}`, so the same key rendered as a bare Obsidian-style property above the canvas and
 * as the Page panel's Title field at the same time, with two different commit paths. Merging the
 * two field sets was only safe once one of the two policies won, and it is this one: a document has
 * ONE title, and the surface that gives it a named row is the one that owns the key.
 */
export const RESERVED_FM_KEYS = new Set(["title"]);

/**
 * The frontmatter keys a document's head controls own, so its generic field list leaves them out:
 * {@link RESERVED_FM_KEYS}, plus `description` on a PAGE, whose description the build writes as its
 * description meta (`withPageDescription` in `@jxsuite/site/head-merger`). Listed as a frontmatter
 * field as well, a Markdown page showed two Description rows with two values (the frontmatter's and
 * the head's empty one), and only one of them reaches the browser. A layout's or component's
 * `description` is data the build does not read, so it stays an ordinary field.
 *
 * @param tab The document whose fields are listed.
 */
export function reservedFmKeys(tab: Tab | null): ReadonlySet<string> {
  return isPageDocument(tab) ? new Set([...RESERVED_FM_KEYS, "description"]) : RESERVED_FM_KEYS;
}

/**
 * A page's description, from wherever the build reads it: a `<meta name="description">` in its own
 * `$head` when it has one (stated last, it wins), else its `description` property.
 *
 * @param doc The head-bearing view of the document (`buildHeadDoc` for a Markdown page).
 */
export function pageDescription(doc: JxMutableNode): string {
  const meta = findMetaEntry(doc.$head ?? [], "name", "description");
  if (meta) {
    return String(meta.attributes?.content ?? "");
  }
  return isString(doc.description) ? doc.description : "";
}

/**
 * Write a page's description where {@link pageDescription} reads it, so the one field never edits a
 * value the build then overrules: the `description` property when that is where the page keeps it
 * and its `$head` states none, else the head's meta (a page with neither gets the meta, as before).
 * An empty value removes it.
 *
 * @param doc The head-bearing view of the document.
 * @param value The new description, already trimmed.
 */
export function setPageDescription(doc: JxMutableNode, value: string): void {
  if (!findMetaEntry(doc.$head ?? [], "name", "description") && isString(doc.description)) {
    if (value) {
      doc.description = value;
    } else {
      delete doc.description;
    }
    return;
  }
  upsertMeta(doc, "name", "description", value);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * One slot of a `$head` array as it is read off a document.
 *
 * Wider than `JxHeadEntry` on purpose: a Markdown page's `$head` is its frontmatter, which reaches
 * these helpers through {@link buildHeadDoc} without being validated, so an empty YAML list item
 * arrives as `null`. Every reader here steps over such a slot rather than throwing on it.
 */
type HeadSlot = JxHeadEntry | null | undefined;

/**
 * Find a `$head` meta entry by attribute match.
 *
 * @param {JxHeadEntry[]} head
 * @param {"name" | "property"} attr
 * @param {string} key
 * @returns {JxHeadEntry | undefined}
 */
export function findMetaEntry(head: readonly HeadSlot[], attr: "name" | "property", key: string) {
  return head.find((e): e is JxHeadEntry => e?.tagName === "meta" && e.attributes?.[attr] === key);
}

/**
 * Find a `$head` link entry by `rel` attribute.
 *
 * @param {JxHeadEntry[]} head
 * @param {string} rel
 * @returns {JxHeadEntry | undefined}
 */
export function findLinkEntry(head: readonly HeadSlot[], rel: string) {
  return head.find((e): e is JxHeadEntry => e?.tagName === "link" && e.attributes?.rel === rel);
}

/**
 * Check if a `$head` entry is managed by the structured forms.
 *
 * @param {JxHeadEntry} entry
 * @returns {boolean}
 */
export function isManagedEntry(entry: HeadSlot) {
  if (!entry?.tagName) {
    return false;
  }
  // Managed meta tags
  if (entry.tagName === "meta") {
    const name = String(entry.attributes?.name ?? "");
    const prop = String(entry.attributes?.property ?? "");
    return (
      Boolean(name && MANAGED_META_KEYS.has(name)) || Boolean(prop && MANAGED_META_KEYS.has(prop))
    );
  }
  // Managed link: favicon
  if (entry.tagName === "link" && entry.attributes?.rel === "icon") {
    return true;
  }
  return false;
}

/**
 * Upsert or remove a meta entry in `doc.$head`.
 *
 * @param {JxMutableNode} doc
 * @param {"name" | "property"} attr
 * @param {string} key
 * @param {string} content
 */
export function upsertMeta(
  doc: JxMutableNode,
  attr: "name" | "property",
  key: string,
  content: string,
) {
  if (!doc.$head) {
    doc.$head = [];
  }
  const idx = doc.$head.findIndex(
    (e: HeadSlot) => e?.tagName === "meta" && e.attributes?.[attr] === key,
  );
  if (content) {
    const entry = { attributes: { [attr]: key, content }, tagName: "meta" };
    if (idx !== -1) {
      doc.$head[idx] = entry;
    } else {
      doc.$head.push(entry);
    }
  } else if (idx !== -1) {
    doc.$head.splice(idx, 1);
  }
}

/**
 * Upsert or remove a link entry in `doc.$head`.
 *
 * @param {JxMutableNode} doc
 * @param {string} rel
 * @param {string} href
 */
export function upsertLink(doc: JxMutableNode, rel: string, href: string) {
  if (!doc.$head) {
    doc.$head = [];
  }
  const idx = doc.$head.findIndex(
    (e: HeadSlot) => e?.tagName === "link" && e.attributes?.rel === rel,
  );
  if (href) {
    const entry = { attributes: { href, rel }, tagName: "link" };
    if (idx !== -1) {
      doc.$head[idx] = entry;
    } else {
      doc.$head.push(entry);
    }
  } else if (idx !== -1) {
    doc.$head.splice(idx, 1);
  }
}

/**
 * Get a display label for an arbitrary $head entry.
 *
 * @param {JxHeadEntry} entry
 * @returns {string}
 */
export function entryLabel(entry: HeadSlot) {
  if (!entry?.tagName) {
    return "unknown";
  }
  const a = entry.attributes ?? {};
  if (a.name) {
    return `<meta name="${String(a.name)}">`;
  }
  if (a.property) {
    return `<meta property="${String(a.property)}">`;
  }
  if (a.rel && a.href) {
    return `<link rel="${String(a.rel)}">`;
  }
  if (a.src) {
    return `<script src="${String(a.src)}">`;
  }
  if (a.charset) {
    return `<meta charset="${String(a.charset)}">`;
  }
  return `<${entry.tagName}>`;
}

/**
 * Get a display value for an arbitrary $head entry.
 *
 * @param {JxHeadEntry} entry
 * @returns {string}
 */
export function entryValue(entry: HeadSlot) {
  const a = entry?.attributes ?? {};
  return String(a.content ?? a.href ?? a.src ?? entry?.textContent ?? "");
}

// ─── The merged `$head`, as a preview model ──────────────────────────────

/*
 * Everything below answers ONE question — what actually reaches the browser? — and it is a
 * different question from what this panel's fields edit. A page that inherits its description from
 * the site is not a page missing a description, and the old SEO gap was that no surface could tell
 * the two apart. The contract mirrored here is `packages/compiler/src/site/head-merger.ts`:
 * site → layout → page, later wins, keyed by `name` / `property` / `rel`. Studio does not depend
 * on `@jxsuite/compiler`, so the merge is restated for the handful of keys the previews read
 * rather than copied wholesale; `tests/head-panel.test.ts` pins each rule against that file.
 */

/**
 * Which layer of the cascade supplied a previewed value.
 *
 * `build` is the compiler's own contribution — the `"Jx Site"` title fallback, the canonical link
 * and `og:url` it derives from the site URL and the route. It is a donor like any other, and saying
 * so is what stops the preview from claiming the author wrote something they did not.
 */
export type HeadSource = "page" | "layout" | "site" | "build" | "none";

/** One value that reaches the browser, and where it came from. */
export interface ResolvedHeadField {
  /** The emitted value, or `""` when the merged head carries none. */
  value: string;
  source: HeadSource;
  /**
   * The donor's name in the words a reader would use — `"Base"`, `"Site head"`, `"Site name"`,
   * `"the build"`. `null` for `page` (nothing to name; the author is looking at it) and `none`.
   */
  donor: string | null;
}

/** The three `$head` arrays the build merges, plus the name of the layout supplying the middle one. */
export interface HeadLayers {
  site: JxHeadEntry[];
  layout: JxHeadEntry[];
  page: JxHeadEntry[];
  layoutName: string | null;
}

/** The title the build emits when neither the page nor the site names one (`head-merger.ts`). */
export const BUILD_FALLBACK_TITLE = "Jx Site";

const NOT_SUPPLIED: ResolvedHeadField = { donor: null, source: "none", value: "" };

/**
 * The `content` of the LAST matching meta entry in one layer, or `null` when the layer is silent.
 *
 * Last rather than first, because the merger folds a layer into a keyed map in array order: a layer
 * that lists `description` twice emits the second one.
 */
function metaContentIn(
  head: readonly HeadSlot[],
  attr: "name" | "property",
  key: string,
): string | null {
  let found: string | null = null;
  for (const entry of head) {
    if (entry?.tagName === "meta" && entry.attributes?.[attr] === key) {
      found = String(entry.attributes.content ?? "");
    }
  }
  return found;
}

/**
 * Resolve one meta key through site → layout → page.
 *
 * A page entry whose `content` is empty still counts as the page speaking: the merged map is keyed
 * by `meta:<key>`, so an empty page entry SHADOWS the site's. The preview reports the empty result,
 * which is what the browser gets.
 *
 * @param {HeadLayers} layers
 * @param {"name" | "property"} attr
 * @param {string} key
 * @returns {ResolvedHeadField}
 */
export function resolveMetaField(
  layers: HeadLayers,
  attr: "name" | "property",
  key: string,
): ResolvedHeadField {
  const page = metaContentIn(layers.page, attr, key);
  if (page !== null) {
    return { donor: null, source: "page", value: page };
  }
  const layout = metaContentIn(layers.layout, attr, key);
  if (layout !== null) {
    return { donor: layers.layoutName ?? "the layout", source: "layout", value: layout };
  }
  const site = metaContentIn(layers.site, attr, key);
  if (site !== null) {
    return { donor: "Site head", source: "site", value: site };
  }
  return NOT_SUPPLIED;
}

/**
 * Resolve `<title>`: the page's `title` property, then the site's `name`, then `"Jx Site"`.
 *
 * A layout never supplies one. `site/site-build.ts` reads `pageDoc.title ?? layoutDoc._pageTitle`,
 * and `_pageTitle` is a carrier for the PAGE's title through layout distribution, not a layout
 * value of its own. A `<title>` entry inside any `$head` does not supply one either — the merger
 * overwrites the `title` key from its context after the layers are folded in, which is what
 * {@link seoWarnings}' `head-title-ignored` exists to say out loud.
 *
 * @param {string} pageTitle
 * @param {string} [siteName]
 * @returns {ResolvedHeadField}
 */
export function resolveTitleField(pageTitle: string, siteName?: string): ResolvedHeadField {
  const own = pageTitle.trim();
  if (own) {
    return { donor: null, source: "page", value: own };
  }
  const site = siteName?.trim();
  if (site) {
    return { donor: "Site name", source: "site", value: site };
  }
  return { donor: "the build", source: "build", value: BUILD_FALLBACK_TITLE };
}

/** The URL a result row prints, and the canonical the build derives — or the honest absence of one. */
export interface SeoUrl {
  /** `<link rel="canonical">` / `og:url`, or `null` when Project Settings names no site URL. */
  href: string | null;
  /** `example.com › blog › hello` — the breadcrumb a search result prints. */
  crumb: string;
  /** The bare host a social card prints, or `""` when unknown. */
  host: string;
}

/**
 * The canonical URL and its two printed forms.
 *
 * `head-merger.ts` emits a canonical link and `og:url` only when BOTH a site URL and a route exist,
 * so this returns `href: null` in every case where the build would emit neither.
 *
 * @param {string | null} route
 * @param {string} [siteUrl]
 * @returns {SeoUrl}
 */
export function resolveSeoUrl(route: string | null, siteUrl?: string): SeoUrl {
  const path = route ?? "";
  const segments = path.split("/").filter((s) => s !== "");
  if (!siteUrl || route === null) {
    return { crumb: path || "/", host: "", href: null };
  }
  let absolute: URL;
  try {
    absolute = new URL(path, siteUrl);
  } catch {
    // A malformed `url` in project.json is a settings problem, not a preview crash — fall back to
    // The route, exactly as a build with no site URL would.
    return { crumb: path || "/", host: "", href: null };
  }
  const { host } = absolute;
  return {
    crumb: [host, ...segments].join(" › "),
    host,
    href: absolute.href,
  };
}

/** One row of the resolved-field list: the value, its provenance, and its character budget. */
export interface SeoField extends ResolvedHeadField {
  /** The head key — `title`, `description`, `og:image`, … */
  key: string;
  label: string;
  /** The width at which the surface that shows it truncates, or `null` when nobody counts it. */
  limit: number | null;
}

/**
 * Character budgets, in the only role a number is allowed here: a counter's reference line.
 *
 * There is deliberately no score. A single figure out of a hundred aggregates unrelated facts into
 * a verdict, and the verdict is what gets optimised (§16.6). A count beside a limit says the same
 * thing without pretending to rank it.
 */
export const SEO_LIMITS: ReadonlyMap<string, number> = new Map([
  ["description", 160],
  ["og:description", 200],
  ["og:title", 60],
  ["title", 60],
]);

/** Counts what a reader sees as one character. See {@link visibleLength}. */
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en-US", { granularity: "grapheme" });

/**
 * How long a value looks, in the units the person reading the counter has in mind.
 *
 * `String.length` counts UTF-16 code units, which is not a count of anything a person can see: an
 * emoji is 2, a flag is 4, and "👩‍🚀" is 5 — so a title with three emoji reported eleven
 * characters of budget spent on three glyphs, and the warning beside it was wrong by the same
 * margin. Counting **grapheme clusters** (UAX #29) counts what renders.
 *
 * **What this deliberately does not do is model pixel width.** "iiiii" and "WWWWW" are both five,
 * and a search result truncates on width — but width depends on the font the search engine chooses,
 * at a size it chooses, and any table of per-character widths here would be a fabricated number
 * presented as a measurement. A character count next to a documented limit is an honest
 * approximation; a pixel count would not be.
 *
 * @param {string} value
 * @returns {number}
 */
export function visibleLength(value: string): number {
  let count = 0;
  for (const _ of GRAPHEME_SEGMENTER.segment(value)) {
    count += 1;
  }
  return count;
}

/** The Problems `source` the SEO warnings carry, so a re-run replaces rather than stacks. */
export const SEO_PROBLEM_SOURCE = "Search appearance";

/**
 * File the SEO warnings as Problems as well as rendering them in the modal.
 *
 * The modal is a window someone has to open. A page shipped with no description is a fact worth
 * knowing whether or not you thought to look, and Problems is where this app already keeps facts
 * that outlive the frame you were not watching — which is the same argument the accessibility
 * report makes, and the redirects checks before it.
 *
 * Cleared first, so a fixed page stops being listed; keyed by warning id, so the two surfaces name
 * the same thing.
 *
 * @param {SeoPreview} preview
 * @param {string} [path] The document's path, so a row can open the file it is about.
 * @returns {number} How many Problems were filed.
 */
export function reportSeoProblems(preview: SeoPreview, path?: string): number {
  clearProblems((record) => record.source === SEO_PROBLEM_SOURCE);
  for (const warning of preview.warnings) {
    const opts: NotifyOptions = {
      action: "document.openSeo",
      key: `seo.${warning.id}`,
      source: SEO_PROBLEM_SOURCE,
      tier: "problem",
    };
    if (path !== undefined) {
      opts.path = path;
    }
    notify.warn(warning.message, opts);
  }
  return preview.warnings.length;
}

/** Everything the two preview cards, the field list and the warning list render. */
export interface SeoPreview {
  url: SeoUrl;
  /** In render order: `title`, `description`, then the four OpenGraph keys. */
  fields: SeoField[];
  warnings: SeoWarningView[];
}

/** Look one field up by key — the previews read four of the six by name. */
export function seoField(preview: SeoPreview, key: string): SeoField {
  return (
    preview.fields.find((f) => f.key === key) ?? {
      ...NOT_SUPPLIED,
      key,
      label: key,
      limit: SEO_LIMITS.get(key) ?? null,
    }
  );
}

/** Whether any layer declares a `<title>` element, which the merger discards. */
function hasTitleEntry(layers: HeadLayers): boolean {
  return [...layers.site, ...layers.layout, ...layers.page].some(
    (e: HeadSlot) => e?.tagName === "title",
  );
}

/**
 * The named warnings, in the order they are rendered.
 *
 * Every one of them states a consequence rather than a grade, and every one is checkable against
 * `head-merger.ts`. "Missing" is decided on the MERGED value, so a page that inherits a description
 * from the site is never told it has none — the defect site-architecture.md §8.6 names by name.
 *
 * @param {SeoPreview} preview — `warnings` is ignored; this computes it.
 * @param {HeadLayers} layers
 * @returns {SeoWarningView[]}
 */
export function seoWarnings(
  preview: Omit<SeoPreview, "warnings">,
  layers: HeadLayers,
): SeoWarningView[] {
  const warnings: SeoWarningView[] = [];
  const get = (key: string) => preview.fields.find((f) => f.key === key);

  const title = get("title");
  if (title?.source === "build") {
    warnings.push({
      field: "title",
      id: "title-missing",
      message: `Neither this page nor the project names a title, so the build ships “${BUILD_FALLBACK_TITLE}”.`,
    });
  }
  if (get("description")?.value.trim() === "") {
    warnings.push({
      field: "description",
      id: "description-missing",
      message:
        "No description reaches this page from the site, its layout or the page itself — a " +
        "result row shows whatever text the engine picks instead.",
    });
  }
  if (get("og:title")?.value.trim() === "") {
    warnings.push({
      field: "og:title",
      id: "og-title-missing",
      message: "No og:title — a shared link carries no headline of its own.",
    });
  }
  if (get("og:description")?.value.trim() === "") {
    warnings.push({
      field: "og:description",
      id: "og-description-missing",
      message: "No og:description — a shared link carries no summary of its own.",
    });
  }
  if (get("og:image")?.value.trim() === "") {
    warnings.push({
      field: "og:image",
      id: "og-image-missing",
      message: "No og:image — a shared link renders as a text-only card.",
    });
  }
  for (const field of preview.fields) {
    const length = visibleLength(field.value);
    if (field.limit !== null && length > field.limit) {
      const kind = field.key.endsWith("description") ? "summaries" : "headlines";
      warnings.push({
        field: field.key,
        id: `${field.key}-long`,
        message: `${field.label} is ${length} characters; ${kind} are cut near ${field.limit}.`,
      });
    }
  }
  if (preview.url.href === null) {
    warnings.push({
      field: "url",
      id: "site-url-missing",
      message:
        "Project Settings names no site URL, so the build emits no canonical link and no og:url.",
    });
  }
  if (hasTitleEntry(layers)) {
    warnings.push({
      field: "title",
      id: "head-title-ignored",
      message:
        "A <title> element in $head is discarded — the build writes the title from the " +
        "document's own title property.",
    });
  }
  return warnings;
}

/** What {@link buildSeoPreview} needs besides the layers: the page's own title, route and site. */
export interface SeoPreviewContext {
  pageTitle: string;
  route: string | null;
  siteName?: string;
  siteUrl?: string;
}

/**
 * Build the whole preview from the three layers, the page title, the route and the site config.
 *
 * Pure, and the reason the previews are testable without a stage: everything asynchronous
 * (resolving the layout document) happens in {@link layoutHeadEntries} before this is called.
 *
 * @param {HeadLayers} layers
 * @param {SeoPreviewContext} ctx
 * @returns {SeoPreview}
 */
export function buildSeoPreview(layers: HeadLayers, ctx: SeoPreviewContext): SeoPreview {
  const field = (key: string, label: string, resolved: ResolvedHeadField): SeoField => ({
    ...resolved,
    key,
    label,
    limit: SEO_LIMITS.get(key) ?? null,
  });

  const fields: SeoField[] = [
    field("title", "Title", resolveTitleField(ctx.pageTitle, ctx.siteName)),
    field("description", "Description", resolveMetaField(layers, "name", "description")),
    field("og:title", "Social title", resolveMetaField(layers, "property", "og:title")),
    field(
      "og:description",
      "Social description",
      resolveMetaField(layers, "property", "og:description"),
    ),
    field("og:image", "Social image", resolveMetaField(layers, "property", "og:image")),
    field("og:type", "Social type", resolveMetaField(layers, "property", "og:type")),
  ];
  const url = resolveSeoUrl(ctx.route, ctx.siteUrl);
  const withoutWarnings = { fields, url };
  return { ...withoutWarnings, warnings: seoWarnings(withoutWarnings, layers) };
}

// ─── The layout's `$head` ────────────────────────────────────────────────

/*
 * The middle layer is the only one the studio does not already hold in memory: it lives in a file.
 * It is fetched once per layout path and cached here, and the fetch rides `platform.readFile`, so
 * `probe.idle()`'s platform source already accounts for it — no new in-flight declaration.
 */

let _layoutHeadPath: string | null = null;
let _layoutHead: JxHeadEntry[] = [];
let _layoutHeadPending: string | null = null;

/** Drop the cached layout head, so the next preview re-reads the file. */
export function invalidateLayoutHeadCache(): void {
  _layoutHeadPath = null;
  _layoutHead = [];
  _layoutHeadPending = null;
}

async function loadLayoutHead(path: string): Promise<void> {
  if (_layoutHeadPending === path) {
    return;
  }
  _layoutHeadPending = path;
  const doc = await resolveLayoutDoc(path);
  if (_layoutHeadPending !== path) {
    // A different layout was asked for while this one was in flight; that request owns the cache.
    return;
  }
  _layoutHeadPending = null;
  _layoutHeadPath = path;
  _layoutHead = doc?.$head ?? [];
  // THREE surfaces show the merged head now, and the layout layer arrives asynchronously: the
  // Document Header card, and Search appearance, which is where the previews went. A modal left
  // Off this list renders the page's own head with the layout layer missing — which reads as
  // "you have no description" on a page that inherits one.
  renderOnly("frontmatterPanel", "seoModal");
}

/**
 * A layout path as a reader would name it — `./layouts/blog-post.json` → `Blog Post`.
 *
 * @param {string} path
 * @returns {string}
 */
export function layoutDisplayName(path: string): string {
  return (
    path
      .replace(/^\.\//, "")
      .replace(/^layouts\//, "")
      .replace(/\.json$/, "")
      .replaceAll(/[-_/]+/g, " ")
      .replaceAll(/\b\w/g, (c) => c.toUpperCase()) || path
  );
}

/** A layout's `$head` entries, and the name to print for the layout. */
export interface LayoutHead {
  entries: JxHeadEntry[];
  name: string | null;
}

/**
 * The effective layout's `$head`, and the name to print for it.
 *
 * Returns empty on the first call for a layout and schedules the read; the card repaints when it
 * lands. Showing nothing briefly is the honest state — the alternative is attributing the layout's
 * entries to the page.
 *
 * @param {Tab | null} tab — the tab whose document the entries are being resolved FOR.
 * @param {string | false} [docLayout]
 * @returns {LayoutHead}
 */
export function layoutHeadEntries(tab: Tab | null, docLayout?: string | false): LayoutHead {
  const path = isPageDocument(tab) ? getEffectiveLayoutPath(docLayout) : null;
  if (path === null) {
    return { entries: [], name: null };
  }
  const name = layoutDisplayName(path);
  if (path === _layoutHeadPath) {
    return { entries: _layoutHead, name };
  }
  void loadLayoutHead(path);
  return { entries: [], name };
}

/**
 * The preview for the document the card is showing.
 *
 * @param {Tab | null} tab — the tab the card was drawn for; its route and its layout, not the
 *   focused pane's.
 * @param {JxMutableNode} doc — the head-bearing view of the document (`buildHeadDoc` for content).
 * @returns {SeoPreview}
 */
export function seoPreviewFor(tab: Tab | null, doc: JxMutableNode): SeoPreview {
  const config = projectState?.projectConfig;
  const layout = layoutHeadEntries(tab, doc.$layout);
  const path = tab?.documentPath;
  // A content document's head doc may carry a non-string title (see buildHeadDoc).
  const ctx: SeoPreviewContext = {
    pageTitle: isString(doc.title) ? doc.title : "",
    route: path ? pageRoute(path) : null,
  };
  if (config?.name !== undefined) {
    ctx.siteName = config.name;
  }
  if (config?.url !== undefined) {
    ctx.siteUrl = config.url;
  }
  return buildSeoPreview(
    {
      layout: layout.entries,
      layoutName: layout.name,
      // The page level as the build merges it: its `description` property leads its own head.
      page: withPageDescription(doc.$head ?? [], doc.description),
      site: config?.$head ?? [],
    },
    ctx,
  );
}

// ─── Layout picker ───────────────────────────────────────────────────────

/**
 * Whether `tab`'s document is a page of a site project — the only documents a layout applies to.
 *
 * **It takes the tab, and that is the whole of finding 3.** It was zero-argument and read
 * `activeTab.value?.documentPath`, while both of its important callers had already been handed a
 * tab: `hasDocumentHeader(tab)` inspects THAT tab's frontmatter, title and `$head` and then fell
 * through to here for the "a page always has one" rule, and `documentHeaderTemplate(tab, paneId)`
 * gates the Layout picker on it. Both directions were visible with two panes — a page in the
 * unfocused pane lost its Title and Route because the focused tab was a component, and a bare
 * component GAINED a header card because the focused tab was a page — and the Layout picker
 * appeared or vanished in the pane you were editing according to the document in the other one.
 *
 * A caller whose subject genuinely IS the focused document (the Inspector's Page tab) passes
 * `activeTab.value`, where a reviewer can see it. The same bargain `setCanvasMode` made.
 *
 * @param {Tab | null} tab
 * @returns {boolean}
 */
export function isPageDocument(tab: Tab | null): boolean {
  const path = tab?.documentPath;
  return Boolean(
    path &&
    projectState?.isSiteProject &&
    (path.startsWith("pages/") || path.startsWith("./pages/")),
  );
}

/** Overlay content-mode frontmatter title/`$head` onto the document the panel edits. */
export function buildHeadDoc(
  doc: JxMutableNode,
  fm: Tab["doc"]["content"]["frontmatter"],
): JxMutableNode {
  const headDoc: JxMutableNode = { ...doc };
  if (fm.title !== undefined) {
    /* SAFETY: deliberately not narrowed — a YAML title can be a number, and it is overlaid as
       written. Every reader of a head doc's `title` (titleRow here and in frontmatter-panel.ts,
       seoPreviewFor) tests it with isString before using it as text. */
    headDoc.title = fm.title as string;
  }
  if (isString(fm.description)) {
    // The page's description property, which the build writes as its description meta.
    headDoc.description = fm.description;
  }
  if (fm.$head !== undefined) {
    /* SAFETY: Studio's one writer of the frontmatter `$head` key is applyContentMutation below,
       which stores a JxHeadEntry[] or deletes the key. A hand-written one is trusted exactly as
       far as a JSON page's `doc.$head` is, and the readers step over null slots (HeadSlot). */
    headDoc.$head = fm.$head as JxHeadEntry[];
  }
  return headDoc;
}

/**
 * The mutation path for a content-mode document, where title and `$head` live in frontmatter.
 *
 * The panel edits a `JxMutableNode`; a markdown page's head fields are frontmatter keys. This
 * adapts one to the other in the module that owns both, instead of in the Navigator orchestrator
 * that owns neither.
 *
 * **`tab` is a parameter for the same reason every other frontmatter helper's is.** It resolved
 * `activeTab.value` itself, and the Document Header card calls it for the CONTENT branch of every
 * mutation it makes — Title, Clear title, the Layout picker — as does Search appearance, which is
 * where the head fields went and which takes its tab the same way. The card is drawn per pane, so
 * on a markdown page the card in one pane retitled the document in the other. The comment beside
 * the card's JSON branch has claimed since the pane grid landed that this was fixed; the fix
 * reached the JSON branch only, and this is the half that was left.
 *
 * @param {Tab | null} tab The document to commit into.
 * @param {() => void} rerender
 * @param {(doc: JxMutableNode) => void} fn
 */
export function applyContentMutation(
  tab: Tab | null,
  rerender: () => void,
  fn: (doc: JxMutableNode) => void,
): void {
  if (!tab) {
    return;
  }
  const fmNow = tab.doc.content.frontmatter;
  // The frontmatter `$head`, read through the one place that types it.
  const fmHead = buildHeadDoc({}, fmNow).$head;
  const tmp: JxMutableNode = {};
  if (isString(fmNow.title)) {
    tmp.title = fmNow.title;
  }
  if (isString(fmNow.description)) {
    tmp.description = fmNow.description;
  }
  if (fmHead) {
    tmp.$head = [...fmHead];
  }
  fn(tmp);
  if (tmp.title !== fmNow.title) {
    mutateUpdateFrontmatter(tab, "title", tmp.title);
  }
  if (isString(fmNow.description) && tmp.description !== fmNow.description) {
    mutateUpdateFrontmatter(
      tab,
      "description",
      isString(tmp.description) ? tmp.description : undefined,
    );
  }
  const newHead = tmp.$head && tmp.$head.length > 0 ? tmp.$head : undefined;
  /* SAFETY: every entry here either came from the frontmatter (JSON, from the format's split) or
     was built by a head editor out of string attributes; JxHeadEntry is wider than JsonValue only
     through its open index signature, which no head editor writes. */
  mutateUpdateFrontmatter(tab, "$head", newHead as JsonValue | undefined);
  rerender();
}

// ─── The Page panel's flow ───────────────────────────────────────────────

/** What one row of the panel writes. The document knows the control; this knows the document. */
interface RowCommit {
  /** Remove the value this row shows. */
  clear: () => void;
  /** Commit what the control settled on — a string from every kind but the checkbox. */
  commit: (raw: string | boolean) => void;
}

/** What the panel is drawn against: the focused document, reduced to what this reads. */
export interface PagePanelContext {
  /** The head-bearing view of the open document — `buildHeadDoc` for a content page. */
  document: JxMutableNode;
  /** How a change to that view is written back into whichever realm it belongs to. */
  applyMutation: (fn: (doc: JxMutableNode) => void) => void;
  /** Repaint the host the panel is drawn in — the Inspector's Page tab. */
  rerender: () => void;
}

/** Where the surface is mounted, and the context it was last drawn against. */
let _host: HTMLElement | null = null;
let _ctx: PagePanelContext | null = null;

/**
 * The add-a-tag draft — three parts of one entry, so none of them is submitted alone.
 *
 * State rather than `ref()` handles read at submit time: a document binding writes only when the
 * scope moves, so emptying a field after a successful add has to BE a scope change or the added
 * text is left sitting in the control.
 */
let _addTag = "meta";
let _addAttr = "";
let _addValue = "";

/** This projection's rows, by key. Rebuilt with each projection. */
const _commits = new Map<string, RowCommit>();

/** This projection's row buttons ({@link PageRow.action}), by row key. Rebuilt with each projection. */
const _rowActions = new Map<string, () => void>();

/**
 * The page's URL, derived from where its file sits under `pages/` (`pages/about.md` → `/about`), as
 * a readout: changing a URL is moving the file, which the file tree owns. `null` for anything that
 * is not a page.
 */
function urlRow(tab: Tab | null): PageRow | null {
  const route = tab?.documentPath ? pageRoute(tab.documentPath) : null;
  if (route === null) {
    return null;
  }
  return { ...blankRow("__url", "url", "URL"), kind: "readout", value: route };
}

/**
 * This projection's custom `$head` entries, by the key they were drawn with.
 *
 * A Remove hands back a key and nothing else, because the rows are a NESTED map and a row inside
 * the inner one cannot reach the section it is under. This is where that key is spent — on the
 * ENTRY OBJECT, so the splice is still an `indexOf` against the document's own array rather than a
 * position that a concurrent edit could have moved.
 */
const _entries = new Map<string, JxHeadEntry>();

/** Text edits waiting out {@link LIVE_PREVIEW}, one per row key. */
const _pending = new Map<string, { commit: () => void; timer: ReturnType<typeof setTimeout> }>();

/** The elements the add form offers, in the order a reader meets them. */
const TAG_OPTIONS: SurfaceOption[] = [
  { label: "meta", value: "meta" },
  { label: "link", value: "link" },
  { label: "script", value: "script" },
];

/** A blank row, so every kind carries every field the document's bindings read. */
function blankRow(key: string, prop: string, label: string): PageRow {
  return {
    action: "",
    checked: false,
    clearLabel: `Clear ${prop}`,
    hasAction: false,
    hasNote: false,
    hasThumb: false,
    isSet: false,
    key,
    kind: "text",
    label,
    note: "",
    options: [],
    placeholder: "",
    prop,
    thumb: "",
    value: "",
  };
}

/** A media row's thumbnail, or the honest absence of one. */
function thumbFor(row: PageRow, value: string): void {
  row.hasThumb = value !== "" && IMAGE_EXTENSIONS.has(extensionOf(value));
  row.thumb = row.hasThumb ? previewAssetSrc(value) : "";
}

/** The one head value you type while writing, in both realms. */
function titleRow(doc: JxMutableNode, apply: PagePanelContext["applyMutation"]): PageRow {
  const title = isString(doc.title) ? doc.title : "";
  _commits.set("title", {
    clear: () =>
      apply((d) => {
        delete d.title;
      }),
    commit: (raw) =>
      apply((d) => {
        const val = String(raw).trim();
        if (val) {
          d.title = val;
        } else {
          delete d.title;
        }
      }),
  });
  return {
    ...blankRow("title", "title", "Title"),
    clearLabel: "Clear title",
    isSet: Boolean(title),
    placeholder: "Page title…",
    value: title,
  };
}

/** One structured `<meta>` field — the four OpenGraph keys, plus description and viewport. */
function metaRow(
  field: MetaField,
  head: JxHeadEntry[],
  apply: PagePanelContext["applyMutation"],
): PageRow {
  const value = String(findMetaEntry(head, field.attr, field.key)?.attributes?.content ?? "");
  const key = `meta:${field.attr}:${field.key}`;
  _commits.set(key, {
    clear: () => apply((d) => upsertMeta(d, field.attr, field.key, "")),
    /* A media field is not trimmed: a path is committed exactly as it was chosen, and the browser
       and the upload both hand one back already clean. */
    commit: (raw) =>
      apply((d) =>
        upsertMeta(d, field.attr, field.key, field.media ? String(raw) : String(raw).trim()),
      ),
  });
  const row = blankRow(key, field.key, field.label);
  row.isSet = Boolean(value);
  row.value = value;
  if (field.media) {
    row.kind = "media";
    thumbFor(row, value);
    return row;
  }
  row.kind = field.multiline ? "textarea" : "text";
  row.placeholder =
    field.key === "viewport" ? "width=device-width, initial-scale=1" : `${field.label}…`;
  return row;
}

/**
 * The page's one Description: the value the build writes as its description meta, read and written
 * where it lives ({@link pageDescription}, {@link setPageDescription}).
 */
function descriptionRow(doc: JxMutableNode, apply: PagePanelContext["applyMutation"]): PageRow {
  const value = pageDescription(doc);
  const key = "meta:name:description";
  _commits.set(key, {
    clear: () => apply((d) => setPageDescription(d, "")),
    commit: (raw) => apply((d) => setPageDescription(d, String(raw).trim())),
  });
  const row = blankRow(key, "description", "Description");
  row.isSet = Boolean(value);
  row.value = value;
  row.kind = "text";
  row.placeholder = "Description…";
  return row;
}

/** The favicon, which is a `<link rel="icon">` rather than a `<meta>`. */
function iconRow(head: JxHeadEntry[], apply: PagePanelContext["applyMutation"]): PageRow {
  const value = String(findLinkEntry(head, "icon")?.attributes?.href ?? "");
  _commits.set("link:icon", {
    clear: () => apply((d) => upsertLink(d, "icon", "")),
    commit: (raw) => apply((d) => upsertLink(d, "icon", String(raw))),
  });
  const row = blankRow("link:icon", "icon", "Icon");
  row.isSet = Boolean(value);
  row.kind = "media";
  row.value = value;
  thumbFor(row, value);
  return row;
}

/**
 * The Layout picker, or `null` when this document takes none — a component has no layout, and a
 * page whose layouts directory is still being listed has nothing to offer yet.
 *
 * The listing is {@link layoutPickerEntries}', which the Document Header card reads too: creating a
 * layout invalidates one cache rather than two.
 */
function layoutSection(
  tab: Tab | null,
  doc: JxMutableNode,
  apply: PagePanelContext["applyMutation"],
): PageSection | null {
  if (!isPageDocument(tab)) {
    return null;
  }
  const entries = layoutPickerEntries();
  if (entries === null) {
    return null;
  }
  const current = doc.$layout;
  const defaultPath = projectState?.projectConfig?.defaults?.layout;
  const defaultLabel = defaultPath ? layoutDisplayName(defaultPath) : "";
  _commits.set("__layout", {
    clear: () =>
      apply((d) => {
        delete d.$layout;
      }),
    commit: (raw) => {
      const val = String(raw);
      apply((d) => {
        if (val === "__default__") {
          delete d.$layout;
        } else if (val === "__none__") {
          d.$layout = false;
        } else {
          d.$layout = val;
        }
      });
      invalidateLayoutCache();
    },
  });
  const row = blankRow("__layout", "layout", "Layout");
  row.kind = "select";
  row.isSet = current !== undefined;
  row.options = [
    { label: defaultLabel ? `Default (${defaultLabel})` : "Default", value: "__default__" },
    { label: "None", value: "__none__" },
    ...entries.map((l) => ({ label: l.name, value: l.path })),
  ];
  row.value = current === false ? "__none__" : current || "__default__";
  // The template the page is drawn in, opened in Design: its own `$layout`, else the default.
  const effective = getEffectiveLayoutPath(current);
  if (effective) {
    row.action = "Edit template";
    row.hasAction = true;
    _rowActions.set("__layout", () => {
      void import("../files/files").then(({ openFileInTab }) =>
        openFileInTab(effective.replace(/^\.\//, "")),
      );
    });
  }
  return { hasSeo: false, key: "layout", rows: [row], title: "Layout" };
}

/**
 * The schema-and-frontmatter field list, or `null` when this document has none to show.
 *
 * Content documents only: a JSON page's head material lives on the root node, and the section that
 * would draw it is Page.
 */
function frontmatterSection(tab: Tab | null): PageSection | null {
  if (!tab || tab.doc.mode !== "content") {
    return null;
  }
  const { collection, fields, hasSchema, requiredFields } = collectFmFields(
    tab,
    projectState?.projectConfig,
    reservedFmKeys(tab),
  );
  if (fields.length === 0 && !hasSchema) {
    return null;
  }
  const rows = fields.map((f) => {
    const key = `fm:${f.field}`;
    const { parse, row } = projectFmField(f.field, f.entry, f.value, requiredFields, {
      rerender: sync,
    });
    _commits.set(key, {
      clear: () => transactDoc(tab, (t) => mutateUpdateFrontmatter(t, f.field)),
      commit: (raw) => transactDoc(tab, (t) => mutateUpdateFrontmatter(t, f.field, parse(raw))),
    });
    return Object.assign(blankRow(key, f.field, row.label), row, {
      clearLabel: `Clear ${f.field}`,
    });
  });
  return {
    hasSeo: false,
    key: "frontmatter",
    rows,
    title: collection ? `Frontmatter (${collection.name})` : "Frontmatter",
  };
}

/** The `$head` entries no structured control owns, and the keys a Remove hands back. */
function customEntries(head: JxHeadEntry[]): PageTagRow[] {
  _entries.clear();
  const rows: PageTagRow[] = [];
  for (const entry of head) {
    if (isManagedEntry(entry) || isGoogleFontEntry(entry) || isGoogleFontPreconnect(entry)) {
      continue;
    }
    // The key counts the LISTED entries, as the index of the filtered list it replaces did.
    const key = `tag:${rows.length}`;
    _entries.set(key, entry);
    const label = entryLabel(entry);
    rows.push({ key, label, removeLabel: `Remove ${label}`, value: entryValue(entry) });
  }
  return rows;
}

/**
 * Everything the panel says about one document, and the commit table behind it.
 *
 * `activeTab.value` is read HERE and nowhere below it: the Inspector's Page tab is an app-level
 * surface that shows the focused document by definition, and spelling that out once at the top is
 * what lets every helper under it take a tab instead of asking for one.
 */
function view(ctx: PagePanelContext): PagePanelView {
  _commits.clear();
  _rowActions.clear();
  const tab = activeTab.value;
  const doc = ctx.document;
  const head = doc.$head ?? [];
  const sections: PageSection[] = [];

  const frontmatter = frontmatterSection(tab);
  if (frontmatter) {
    sections.push(frontmatter);
  }
  const layout = layoutSection(tab, doc, ctx.applyMutation);
  if (layout) {
    sections.push(layout);
  }
  const url = urlRow(tab);
  sections.push(
    {
      hasSeo: true,
      key: "page",
      rows: [
        titleRow(doc, ctx.applyMutation),
        ...(url ? [url] : []),
        ...PAGE_FIELDS.map((field) =>
          field.key === "description"
            ? descriptionRow(doc, ctx.applyMutation)
            : metaRow(field, head, ctx.applyMutation),
        ),
        iconRow(head, ctx.applyMutation),
      ],
      title: "Page",
    },
    {
      hasSeo: false,
      key: "opengraph",
      rows: OG_FIELDS.map((field) => metaRow(field, head, ctx.applyMutation)),
      title: "OpenGraph",
    },
  );

  const entries = customEntries(head);
  return {
    addAttr: _addAttr,
    addTag: _addTag,
    addValue: _addValue,
    customCount: String(entries.length),
    customEntries: entries,
    customState: entries.length === 0 ? "empty" : "listed",
    sections,
    tagOptions: TAG_OPTIONS,
  };
}

/** Push the current projection into the standing surface, in this turn. */
function sync(): void {
  if (!_host || !_ctx) {
    return;
  }
  renderPagePanelSurface(_host, view(_ctx), ACTIONS);
}

// ─── The verbs ───────────────────────────────────────────────────────────

/** Cancel every waiting text edit, without committing any of them. */
function dropPending(): void {
  for (const { timer } of _pending.values()) {
    clearTimeout(timer);
  }
  _pending.clear();
}

/** Drop a text edit that was still waiting out its debounce. */
function flushPending(key: string): void {
  const waiting = _pending.get(key);
  if (waiting) {
    clearTimeout(waiting.timer);
    _pending.delete(key);
  }
}

/** Commit now, cancelling whatever was waiting for the same row. */
function commitNow(key: string, raw: string | boolean): void {
  flushPending(key);
  _commits.get(key)?.commit(raw);
}

/**
 * Add the drafted tag to `$head`.
 *
 * The three parts are validated together and the two typed ones are cleared BEFORE the write, so a
 * repaint caused by the mutation finds an empty form rather than the text that has just been
 * committed. The tag picker keeps its choice: adding two `<link>`s in a row is the common case.
 */
function addEntry(): void {
  const ctx = _ctx;
  const attrKey = _addAttr.trim();
  const attrVal = _addValue.trim();
  if (!ctx || !attrKey || !attrVal) {
    return;
  }
  const tagName = _addTag || "meta";
  _addAttr = "";
  _addValue = "";
  sync();

  const entry: JxHeadEntry = { attributes: {}, tagName };
  if (tagName === "meta") {
    entry.attributes = { content: attrVal, name: attrKey };
  } else if (tagName === "link") {
    entry.attributes = { href: attrVal, rel: attrKey };
  } else if (tagName === "script") {
    entry.attributes = { [attrKey]: attrVal };
  }
  ctx.applyMutation((d: JxMutableNode) => {
    if (!d.$head) {
      d.$head = [];
    }
    d.$head.push(entry);
  });
  ctx.rerender();
}

/** Take one custom `$head` entry away, by the entry the key was drawn for. */
function removeEntry(key: string): void {
  const ctx = _ctx;
  const entry = _entries.get(key);
  if (!ctx || !entry) {
    return;
  }
  ctx.applyMutation((d: JxMutableNode) => {
    if (!d.$head) {
      return;
    }
    const idx = d.$head.indexOf(entry);
    if (idx !== -1) {
      d.$head.splice(idx, 1);
    }
  });
  ctx.rerender();
}

/**
 * The media picker's two behaviours, imported on the first press.
 *
 * ONE cached promise, deliberately: two dynamic imports of a module in flight at once is the shape
 * that loses its coverage record (see the note in the repository's agent guide), and the file also
 * pulls in the upload pipeline and the media metadata cache — neither of which a panel nobody has
 * pressed Browse in should ever load.
 */
let _mediaPicker: Promise<typeof MediaPickerModule> | null = null;

function mediaPicker(): Promise<typeof MediaPickerModule> {
  _mediaPicker ??= import("../ui/media-picker");
  return _mediaPicker;
}

/**
 * What the reader may do. One set for the module, because the panel's whole state is the module's —
 * one focused document, and one draft of each field across every section.
 *
 * The three `edit*` entries are ECHOES: the scope has to be told what a field now holds even though
 * nothing else about the panel changes, because emptying it afterwards is otherwise a write of `""`
 * over a scope that already said `""` — no change, no binding, and the submitted text left sitting
 * in the field.
 */
const ACTIONS: PagePanelActions = {
  addEntry,
  browse: (key, anchor) => {
    flushPending(key);
    void mediaPicker().then((m) => {
      if (anchor instanceof HTMLElement) {
        // Both of the panel's media rows (the social image and the icon) hold a picture.
        m.showMediaPickerPopover(
          anchor,
          (val: string) => {
            _commits.get(key)?.commit(val);
          },
          { images: true },
        );
      }
    });
  },
  clear: (key) => {
    flushPending(key);
    _commits.get(key)?.clear();
  },
  commitText: (key, value) => commitNow(key, value),
  editAttr: (value) => {
    _addAttr = value;
    sync();
  },
  /* Debounced, so the canvas follows the typing without a document write per keystroke. The control
     is NOT reset in the meantime: the projection this commit causes resolves to the text already in
     the field, and a document binding skips a write equal to what the element holds. */
  editText: (key, value) => {
    flushPending(key);
    const commit = () => {
      _pending.delete(key);
      _commits.get(key)?.commit(value);
    };
    _pending.set(key, { commit, timer: setTimeout(commit, LIVE_PREVIEW) });
  },
  editTag: (value) => {
    _addTag = value;
    sync();
  },
  editValue: (value) => {
    _addValue = value;
    sync();
  },
  openSeo: () => {
    /* The COMMAND, not a local open() — the Document Header card offers the same door and neither
       of them owns it, so the palette has it by name. */
    void activeRegistry()?.run("document.openSeo");
  },
  removeEntry,
  runRowAction: (key) => {
    _rowActions.get(key)?.();
  },
  setBoolean: (key, checked) => commitNow(key, checked),
  setChoice: (key, value) => commitNow(key, value),
  setNumber: (key, value) => commitNow(key, value),
  upload: (key) => {
    flushPending(key);
    void mediaPicker().then((m) => {
      m.pickAndUpload((val: string) => {
        _commits.get(key)?.commit(val);
      });
    });
  },
};

/**
 * Draw the panel into `host`, or bring the one already there up to date.
 *
 * @param {HTMLElement} host The panel's content area.
 * @param {PagePanelContext} ctx What the panel is drawn against.
 */
export function renderPagePanel(host: HTMLElement, ctx: PagePanelContext): void {
  if (host !== _host) {
    /* A new content area is a new panel, and a half-typed tag belongs to the surface that was
       showing it. Switching panels and back is NOT this — lit reuses the same `.panel-content`, so
       the draft survives exactly as the `ref()` handles it replaced used to. */
    _addTag = "meta";
    _addAttr = "";
    _addValue = "";
    dropPending();
  }
  if (ctx.document !== _ctx?.document) {
    /* A debounced edit belongs to the DOCUMENT it was typed into, and the host does not change when
       the reader switches tabs — so cancelling only on a new host let a queued commit outlive its
       subject and land, `LIVE_PREVIEW` later, on whatever document was open by then. It surfaced as
       a test that received another test's half-typed `content`, which is the same event with the
       tabs replaced by test cases. */
    dropPending();
  }
  _host = host;
  _ctx = ctx;
  sync();
}

// ─── The Inspector's Page tab ────────────────────────────────────────────

/**
 * What the Page tab is called for a document (§6): Page under `pages/`, Template under `layouts/`,
 * Component under `components/`, Entry for a file a collection owns, Document for anything else.
 *
 * Path-based, like the rest of the site model: a file's role in a project is where it lives, and
 * `collectionForFile` is the one matcher that answers "is this an entry" (§22.1 uses it too).
 */
export function pageTabTitle(path: string | null | undefined): string {
  if (!path) {
    return "Document";
  }
  if (path.startsWith("pages/")) {
    return "Page";
  }
  if (path.startsWith("layouts/")) {
    return "Template";
  }
  if (path.startsWith("components/")) {
    return "Component";
  }
  const collection = collectionForFile(path);
  return collection && !collection.fileBacked ? "Entry" : "Document";
}

/** What the Component tab says: why there is no page form, and the one verb that reaches its own. */
export const COMPONENT_TAB_MESSAGE =
  "A component has no page settings: its title, search and social details come from the page that uses it.";

/** The Component tab's empty state, for a component document's tab. */
export function componentTabSpec(tab: Tab): EmptyStateSpec {
  return {
    actions: [
      {
        label: "Edit tag and props",
        run: () => {
          // The root is the component's definition; selecting it opens Element › Content on its
          // Tag name and "Component Defaults" (`panels/properties-panel.ts`).
          updateSession(tab, { selection: [[]], ui: { rightTab: "properties" } });
        },
      },
    ],
    detail: "Its tag name and the props it takes are set on its root element.",
    message: COMPONENT_TAB_MESSAGE,
  };
}

/** The sentence the Page tab shows with no document open. */
export const PAGE_TAB_EMPTY = "Open a page to edit its title, description and social preview.";

/** The Inspector's Page body host, handed over once by the dock. */
let _tabHost: HTMLElement | null = null;

/**
 * Take the Inspector's Page body host, or let it go (`null`, when the dock is taken down).
 *
 * The Page panel moved here from the Navigator (§6): the same surface, re-hosted unchanged, drawn
 * against the focused document. `panels/right-panel.ts` hands the host over and calls
 * {@link renderPageTab} whenever the dock repaints.
 */
export function bindPageHost(host: HTMLElement | null): void {
  if (_tabHost && _tabHost !== host) {
    unmountEntryInspector(_tabHost);
    unmountPagePanelSurface(_tabHost);
    if (_host === _tabHost) {
      _host = null;
      _ctx = null;
    }
  }
  _tabHost = host;
  renderPageTab();
}

/**
 * Draw the Page tab against the focused document, or empty it when nothing is open.
 *
 * Idempotent and cheap: a standing surface is only assigned to (`renderPagePanelSurface`), so the
 * dock can call this on every repaint without taking the caret out of a field.
 */
export function renderPageTab(): void {
  const host = _tabHost;
  if (!host) {
    return;
  }
  const tab = activeTab.value;
  if (!tab || isEntryTab(tab)) {
    unmountPagePanelSurface(host);
    if (_host === host) {
      _host = null;
      _ctx = null;
    }
    /* A collection entry's tab is titled Entry and draws the entry's own settings — status,
       fields, page URL, file (§22.5) — rather than a page's title, head and SEO preview: the
       entry's page is its collection's template, and its head is that page's. */
    if (tab) {
      renderEntryInspector(host, tab);
    } else {
      unmountEntryInspector(host);
    }
    return;
  }
  unmountEntryInspector(host);
  /* A component is not a page: it has no title, no head and no social card of its own — the pages
     that use it do. Its own settings (its tag, the props it takes and their defaults) are its ROOT
     element's, edited in Element › Content, so the tab says that and goes there. */
  if (pageTabTitle(tab.documentPath) === "Component") {
    unmountPagePanelSurface(host);
    if (_host === host) {
      _host = null;
      _ctx = null;
    }
    // Assigned on every repaint; placed only when it is not already the tab's one child.
    const state = emptyState(host, componentTabSpec(tab));
    if (host.firstChild !== state || host.childNodes.length !== 1) {
      host.replaceChildren(state);
    }
    return;
  }
  const isContent = tab.doc.mode === "content";
  renderPagePanel(host, {
    /* The Page tab IS an app-level surface: it shows the focused document by definition, so it
       spells that out at the call site instead of leaving it to a helper two other surfaces share. */
    applyMutation: isContent
      ? (fn) => applyContentMutation(activeTab.value, renderPageTab, fn)
      : (fn) => {
          transact(activeTab.value, fn);
        },
    document: isContent
      ? buildHeadDoc(tab.doc.document, tab.doc.content.frontmatter)
      : tab.doc.document,
    rerender: renderPageTab,
  });
}
