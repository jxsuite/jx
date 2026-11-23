/// <reference lib="dom" />
/**
 * The Site panel — the Design workspace's default Navigator panel (`specs/studio.md` §5.7).
 *
 * The project as an author thinks of it: pages by address, then the templates, components and media
 * pages are made of. This module is the FLOW. It gathers the facts (the files under `pages/` and
 * `layouts/`, the collection each dynamic page expands over and how many entries it has, how many
 * pages use each template, the component registry, the media cache), hands them to
 * `panels/site-model.ts` for ordering and labels, and owns what every control does. The markup is
 * `surfaces/site-panel.json`, mounted by `surfaces/site-panel.ts`.
 *
 * **A drag from this panel is an insert the canvas already understands.** A component card drags `{
 * type: "block", fragment: buildComponentInstance(component) }` and a media thumbnail drags `{
 * type: "block", fragment: elementForAsset(file) }`; the canvas drop handler (`panels/dnd.ts`'s
 * `applyDropInstruction`) inserts both and imports the component on drop exactly as the Insert
 * panel's drag does. The sources are registered on nodes the document announced through
 * `onNodeCreated`, and released when their node leaves the document or the panel is remounted.
 *
 * **It stays current by being told, not by polling.** The project index is one cache, dropped by
 * {@link invalidateSiteIndex} — wired into the filesystem subscription's derived-cache list and the
 * media-changed handler in `studio.ts` — and re-read the next time the panel paints. While the
 * project state subscription is live it is keyed by the store (`project-state.md` §11.1): a change
 * to file contents alone keeps the file set and re-reads only the dynamic pages whose bytes moved,
 * and the component registry re-derives only the entries whose definition moved or changed. The
 * component registry and the media cache are their owners' caches, read as they stand; the media
 * cache repaints the Navigator itself when its listing lands. The page list is judged by the
 * extensions the format registry claims, so a change of formats ({@link onFormatsChanged}: a
 * dependency install landing a Markdown format) re-reads it too, and a page whose format is missing
 * is listed as needing its extension rather than hidden (`panels/site-model.ts`).
 *
 * **A card's preview is retried, not announced once.** Every preview box is tracked with the
 * registry entry it was rendered for. A box whose entry has since been replaced (a save, a re-scan)
 * is rendered again, and a render that failed is tried again on a later paint, a bounded number of
 * times, so a preview that failed while the project's packages were still installing does not stay
 * empty for the life of the panel.
 *
 * @docs studio/interface
 */

import { isNativeDocumentPath } from "@jxsuite/schema/jxn";
import { nothing } from "lit-html";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import { isString } from "@jxsuite/schema/guards";
import { projectState, renderOnly } from "../store";
import { projectStateLive } from "../project-state/subscription";
import { getPlatform, hasPlatform } from "../platform";
import { activeTab } from "../workspace/workspace";
import { scanLibrary } from "../browse/library-model";
import {
  onFormatsChanged,
  readableDocumentExtensions,
  routedPageExtensions,
} from "../format/format-host";
import { resolveI18n } from "@jxsuite/schema/locale";
import {
  createPreviewCache,
  createPreviewObserver,
  previewComponentSetMoved,
  previewFor,
} from "../browse/library-preview";
import { mountPreview, shownPreview } from "../browse/preview-root";
import {
  _componentRegistryLoaded,
  buildComponentInstance,
  componentRegistry,
  loadComponentRegistry,
  refreshStaleComponents,
} from "../files/components";
import { contentStore } from "../project-state/store";
import type { DerivationKey } from "../project-state/store";
import { mediaKind } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { elementForAsset } from "../editor/file-drop-action";
import { loadMediaRecord } from "../files/media-record";
import { readPageFacts } from "../content/collection-pages";
import { listCollectionEntryIds } from "../grid/sources/content-source";
import { projectMediaFiles } from "../ui/media-picker";
import { runActiveReported } from "../commands/run-reported";
import { emptySitePanelValues, mountSitePanelSurface } from "../surfaces/site-panel";
import { registerPanel } from "./panel-registry";
import {
  filterNeedle,
  humanize,
  filterPageRows,
  matchesFilter,
  pageRows,
  selectedFlag,
  templateRows,
} from "./site-model";

import type { JxMutableNode } from "@jxsuite/schema/types";
import type { ComponentEntry } from "../files/components";
import type { ProjectMediaFile } from "../ui/media-picker";
import type {
  SitePanelSurfaceHandle,
  SitePanelValues,
  SiteSectionState,
} from "../surfaces/site-panel";
import type { SiteComponentRow, SiteMediaRow, SitePageFact } from "./site-model";
import { isProjectConfigPath } from "@jxsuite/schema/project-file";

// ─── The project index ───────────────────────────────────────────────────────

/** What the panel knows about the project's files, read once per invalidation. */
interface SiteIndex {
  pages: SitePageFact[];
  /** The extensions the build routes under `pages/`, read with the formats. */
  pageExtensions: string[];
  /** Every file under `layouts/`. The model keeps the JSON ones. */
  layouts: string[];
  /** Declared collections → entry counts; a count is `null` until its listing lands. */
  collections: Map<string, number | null>;
}

let _index: SiteIndex | null = null;
/**
 * Each dynamic page's collection, by path, with the store key of the bytes it was read from
 * (`project-state.md` §11.1): a re-read of the index reads again only the pages whose key moved. A
 * fact read with no key (no live subscription) is never reused.
 */
const _facts = new Map<string, { key: DerivationKey; contentType: string | null }>();
/** Whether the next read must walk `pages/` and `layouts/` again, rather than reuse the file set. */
let _walk = true;
/**
 * Whether `_index` predates the last invalidation. A stale index stays on screen while its re-read
 * runs (stale-while-revalidate), so a save does not flash every section back to "Reading…" and tear
 * its rows down. Only a project with no index yet shows the loading state.
 */
let _indexStale = false;
let _loading: Promise<void> | null = null;
/** Bumped by every invalidation, so a read that started before one cannot land after it. */
let _epoch = 0;

/** The collections `project.json` declares, in declaration order. */
function declaredCollections(): string[] {
  return Object.keys(projectState?.projectConfig?.content ?? {});
}

/** The collection a dynamic page's `$paths` expands over, read from the file itself. */
async function contentTypeOf(path: string): Promise<string | null> {
  const facts = await readPageFacts(path);
  return facts.contentType;
}

/** A dynamic page's collection: the fact the store key it was read under still holds, or a read. */
async function pageFact(path: string): Promise<SitePageFact> {
  if (!path.includes("[")) {
    return { contentType: null, path };
  }
  const key = projectStateLive() ? contentStore.keyAt(path) : undefined;
  const held = _facts.get(path);
  if (key !== undefined && held?.key === key) {
    return { contentType: held.contentType, path };
  }
  const contentType = await contentTypeOf(path);
  if (key === undefined) {
    _facts.delete(path);
  } else {
    _facts.set(path, { contentType, key });
  }
  return { contentType, path };
}

/**
 * Read the index: one walk of `pages/` and `layouts/`, then each dynamic page's `$paths`. A read
 * that follows a change to file contents alone, while the subscription is live, keeps the file set
 * it has and re-reads only the pages whose bytes moved ({@link pageFact}).
 */
async function readIndex(epoch: number): Promise<void> {
  const walk = _walk || !_index || !projectStateLive();
  const [files, pageExtensions] = walk
    ? await Promise.all([
        scanLibrary(["pages", "layouts"], getPlatform()).then((scan) =>
          scan.files.map((file) => file.path),
        ),
        routedPageExtensions(),
      ])
    : [[..._index!.pages.map((page) => page.path), ..._index!.layouts], _index!.pageExtensions];
  const pages = await Promise.all(
    files.filter((path) => path.startsWith("pages/")).map((path) => pageFact(path)),
  );
  if (epoch !== _epoch) {
    return;
  }
  // Only a read that landed settles the file set; one an invalidation overtook walks again.
  _walk = false;
  // A re-read keeps the counts it already had until their own re-listing lands.
  const previous = _index?.collections;
  const collections = new Map<string, number | null>(
    declaredCollections().map((name) => [name, previous?.get(name) ?? null]),
  );
  _indexStale = false;
  _index = {
    collections,
    layouts: files.filter((path) => path.startsWith("layouts/")),
    pageExtensions,
    pages,
  };
  repaint();
  /* The counts are a second pass, only for the collections a page actually nests under. A count is
     a function of the collection's file set, so a read that kept the file set keeps the counts it
     has and lists only the collections it has none for. */
  const nested = new Set(
    pages.flatMap((page) =>
      page.contentType &&
      collections.has(page.contentType) &&
      (walk || collections.get(page.contentType) === null)
        ? [page.contentType]
        : [],
    ),
  );
  await Promise.all(
    [...nested].map(async (name) => {
      const ids = await listCollectionEntryIds(name).catch(() => null);
      if (epoch === _epoch && ids) {
        collections.set(name, ids.length);
      }
    }),
  );
  if (epoch === _epoch) {
    repaint();
  }
}

/**
 * The index as it stands, starting the read when there is none.
 *
 * The read never rejects, so there is no failure branch here: `scanLibrary` records an unreadable
 * directory rather than throwing (an unreadable project lists as an empty one, and the Files tree
 * reports why), each page's `$paths` read answers "no collection" on any failure, and a count that
 * cannot be listed stays unknown.
 */
function siteIndex(): SiteIndex | null {
  if ((!_index || _indexStale) && !_loading && hasPlatform() && projectState) {
    const epoch = _epoch;
    _loading = readIndex(epoch).finally(() => {
      if (epoch === _epoch) {
        _loading = null;
      }
    });
  }
  return _index;
}

/**
 * Forget what the panel knows about the project's files. The next paint re-reads them.
 *
 * Wired where the other file-listing caches are dropped (`studio.ts`'s `invalidateDerivedCaches`
 * and the media-changed handler), because a page, layout or component appearing or disappearing is
 * the same event for all of them. The index it has stays on screen until the re-read lands.
 *
 * Without a live project state subscription the component registry is re-scanned too, once, because
 * a component file created outside Studio is otherwise invisible until the project is reopened. A
 * scan reads every JSON file in the project, so it runs only for a batch that could hold a
 * component definition: Studio's own save of a component already updates the registry
 * (`noteComponentSaved`), and a page or an entry is not one.
 *
 * While the subscription is live nothing is re-scanned here. The host reports a change to the
 * component set itself (`componentsChanged`, {@link invalidateComponentRegistry}), and the registry
 * is keyed by the store, so a change that could touch a definition re-derives exactly the entries
 * whose document moved, went or changed (`refreshStaleComponents`). A change to file contents alone
 * keeps the index's file set and re-reads only the dynamic pages whose bytes moved.
 *
 * @param paths - The project-relative paths the change touched; `undefined` (an upload) means
 *   anything may have changed.
 * @param structural - Whether the batch added, removed or renamed anything, rather than only
 *   rewriting files that exist.
 */
export function invalidateSiteIndex(paths?: readonly string[], structural = true): void {
  _epoch += 1;
  _indexStale = true;
  _loading = null;
  const live = projectStateLive();
  if (structural || !live) {
    _walk = true;
  }
  if (live && paths !== undefined) {
    /* The registry is keyed by the store: the entries whose definition moved, went or changed are
       re-derived, and a new tag is the host's `componentsChanged`. */
    if (paths.some((path) => mayDefineComponent(path))) {
      void refreshStaleComponents().then((changed) => {
        if (changed) {
          repaint();
        }
      });
    }
  } else if (
    paths === undefined ||
    ((structural || !live) && paths.some((path) => mayDefineComponent(path)))
  ) {
    _registryStale = true;
  }
  if (_standing) {
    repaint();
  }
}

/**
 * The host says the project's set of components changed (`componentsChanged`, `project-state.md`
 * §4.3): re-read the registry now, whether or not the panel is standing, since the Stylebook, the
 * Component Settings and the Library read it too, and replace a preview realm that defines a
 * project tag (§11.2).
 */
export function invalidateComponentRegistry(): void {
  previewComponentSetMoved();
  _registryStale = true;
  ensureRegistry();
}

/**
 * The host's readiness moved (`project-state.md` §7): the pages and templates the panel lists are
 * read again, because a host below `ready` may not have answered for every file. The index on
 * screen stays until the re-read lands, so a readiness change never blanks the panel.
 */
export function noteReadiness(): void {
  invalidateSiteIndex([]);
}

/** The trees whose JSON files are documents of their own kind, never component definitions. */
const NON_COMPONENT_DIRS = ["pages/", "layouts/", "content/", "public/"];

/** Whether a changed path could add, change or remove a component definition. */
export function mayDefineComponent(path: string): boolean {
  if (path.startsWith("components/")) {
    return true;
  }
  return (
    isNativeDocumentPath(path) &&
    !isProjectConfigPath(path) &&
    !NON_COMPONENT_DIRS.some((dir) => path.startsWith(dir))
  );
}

// ─── Components and media ────────────────────────────────────────────────────

let _registryStale = false;
let _registryLoading = false;

/** Make sure the registry has been read (or re-read after an invalidation) once. */
function ensureRegistry(): void {
  if (_registryLoading || (_componentRegistryLoaded && !_registryStale) || !hasPlatform()) {
    return;
  }
  _registryLoading = true;
  _registryStale = false;
  void loadComponentRegistry().finally(() => {
    _registryLoading = false;
    repaint();
  });
}

/**
 * The component cards the filter admits: the project's own components, then the ones its installed
 * packages provide, by tag (§5.7). A package card has no definition to open and no live preview; it
 * drags an instance like any other card, and the drop imports its package (`enableElement`).
 */
function componentRows(needle: string, activePath: string | null): SiteComponentRow[] {
  return componentRegistry.flatMap((comp) => {
    // Named in words, as the board names them ("Post card"); the tag is in the hint and the filter.
    const label = humanize(comp.tagName);
    const tag = `<${comp.tagName}>`;
    const path = definitionPath(comp);
    if (!matchesFilter(needle, comp.tagName, path ?? "", comp.package ?? "")) {
      return [];
    }
    const hint = path
      ? `Open ${tag}, or drag it onto the canvas`
      : `${tag} from ${comp.package ?? "a package"}: open Packages, or drag it onto the canvas`;
    return [
      {
        hint,
        key: comp.tagName,
        label,
        path: path ?? "",
        selected: selectedFlag(path !== null && path === activePath),
        tagName: comp.tagName,
      },
    ];
  });
}

/** A project component's definition file; `null` for a package component, which has none here. */
function definitionPath(comp: ComponentEntry | undefined): string | null {
  return comp?.path !== undefined && comp.source !== "npm" ? comp.path : null;
}

/**
 * How many thumbnails the Media section draws. It is a strip, not the library: a project with
 * hundreds of images made the panel thousands of pixels tall and gave every reader as many extra
 * buttons, and the Media workspace is where all of them are browsed (§5.7).
 */
export const SITE_MEDIA_LIMIT = 8;

/** "Show all 766 in Media" under a strip that holds fewer than the filter admits, else `""`. */
export function mediaMoreLabel(admitted: number, shown: number): string {
  return admitted > shown ? `Show all ${admitted} in Media` : "";
}

/** The media thumbnails the filter admits. */
function mediaRows(
  files: readonly ProjectMediaFile[],
  needle: string,
  activePath: string | null,
): SiteMediaRow[] {
  return files.flatMap((file) =>
    matchesFilter(needle, file.name, file.file)
      ? [
          {
            key: file.file,
            name: file.name,
            path: file.file,
            selected: selectedFlag(file.file === activePath),
            src: file.isImage ? previewFileSrc(file.file) : "",
            thumb: file.isImage ? ("image" as const) : ("file" as const),
          },
        ]
      : [],
  );
}

/** The project's default layout as a project path (`./layouts/base.json` → `layouts/base.json`). */
function defaultLayoutPath(): string | null {
  const layout = projectState?.projectConfig?.defaults?.layout;
  return isString(layout) ? layout.replace(/^\.\//, "") : null;
}

// ─── The view ────────────────────────────────────────────────────────────────

/** The filter, as typed. One per window: the panel is project-level and there is one project. */
let _filter = "";

/** A section's state from what it has and whether it is still being read. */
function sectionState(loading: boolean, all: number, shown: number): SiteSectionState {
  if (loading) {
    return "loading";
  }
  if (all === 0) {
    return "empty";
  }
  return shown === 0 ? "nomatch" : "listed";
}

/** A count for the section heading: what is shown, out of what exists while a filter narrows. */
function countLabel(all: number, shown: number, loading: boolean): string {
  if (loading || all === 0) {
    return "";
  }
  return shown === all ? String(all) : `${shown} of ${all}`;
}

/** Everything the document draws, as one value. */
export function sitePanelValues(): SitePanelValues {
  if (!projectState) {
    // A project-level panel with no project: one sentence, and nothing read on its behalf.
    return { ...emptySitePanelValues(), filter: _filter };
  }
  const needle = filterNeedle(_filter);
  const activePath = activeTab.value?.documentPath ?? null;
  const index = siteIndex();
  ensureRegistry();
  const media = projectMediaFiles();

  const allPages = index
    ? pageRows(index.pages, index.collections, activePath, {
        extensions: index.pageExtensions,
        i18n: resolveI18n(projectState.projectConfig ?? {}).i18n,
      })
    : [];
  const pages = filterPageRows(allPages, needle);
  const defaultLayout = defaultLayoutPath();
  const allTemplates = index ? templateRows(index.layouts, activePath, "", defaultLayout) : [];
  const templates = index ? templateRows(index.layouts, activePath, needle, defaultLayout) : [];
  const registryLoading = !_componentRegistryLoaded;
  const allComponents = componentRows("", activePath);
  const components = componentRows(needle, activePath);
  const allMedia = media ? mediaRows(media, "", activePath) : [];
  const shownMedia = media ? mediaRows(media, needle, activePath) : [];

  const countable = (rows: readonly { kind: string }[]) =>
    rows.filter((row) => row.kind !== "collection").length;
  return {
    body: "project",
    components,
    componentsCount: countLabel(allComponents.length, components.length, registryLoading),
    componentsState: sectionState(registryLoading, allComponents.length, components.length),
    filter: _filter,
    media: shownMedia.slice(0, SITE_MEDIA_LIMIT),
    mediaCount: countLabel(allMedia.length, shownMedia.length, media === null),
    mediaMore: mediaMoreLabel(shownMedia.length, Math.min(shownMedia.length, SITE_MEDIA_LIMIT)),
    mediaState: sectionState(media === null, allMedia.length, shownMedia.length),
    pages,
    pagesCount: countLabel(countable(allPages), countable(pages), index === null),
    pagesState: sectionState(index === null, allPages.length, pages.length),
    templates,
    templatesCount: countLabel(allTemplates.length, templates.length, index === null),
    templatesState: sectionState(index === null, allTemplates.length, templates.length),
  };
}

// ─── The actions ─────────────────────────────────────────────────────────────

/** Open a project file in its editor. Lazily, because `files.ts` sits above this module. */
function openPath(path: string): void {
  void import("../files/files").then(({ openFileInTab }) => openFileInTab(path));
}

const ACTIONS = {
  /* Add new (§9.1.1), through its command, so the `+`, the palette and ⌘N are one door. */
  add: () => {
    void runActiveReported("file.new", {}, "Site panel");
  },
  open: openPath,
  openComponent: (tagName: string) => {
    const comp = componentRegistry.find((entry) => entry.tagName === tagName);
    if (!comp) {
      return;
    }
    const path = definitionPath(comp);
    if (path) {
      openPath(path);
      return;
    }
    // A package component has no definition in the project: its package is what there is to see.
    void runActiveReported("view.setActivity", { tab: "packages" }, "Site panel");
  },
  openMedia: () => {
    void runActiveReported("view.setWorkspace", { workspace: "media" }, "Site panel");
  },
  setFilter: (value: string) => {
    _filter = value;
    repaint();
  },
};

// ─── Previews and drags ──────────────────────────────────────────────────────

/** What a drag source's preview hook is handed — the one field this panel uses. */
interface DragPreviewArgs {
  nativeSetDragImage: ((image: Element, x: number, y: number) => void) | null;
}

/**
 * The payload every drag from this panel carries: the `"block"` kind the canvas drop handler and
 * the drag bridge already accept, and the node it inserts. A type alias rather than an interface,
 * because the drag adapter's data is an index-signature record and only an object type literal is
 * assignable to one.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- see above
export type BlockDragData = { type: "block"; fragment: JxMutableNode };

/**
 * How many times a card's preview is tried for one registry entry before the box is left empty: the
 * first render and two retries, each on a later paint. Bounded, because a definition that cannot
 * render fails the same way on every paint, and the Navigator paints often.
 */
export const PREVIEW_ATTEMPT_LIMIT = 3;

/** One component card's preview box, and what was last asked of it. */
interface PreviewSlot {
  tagName: string;
  /** The registry entry the box was last asked to render; a different one means it is stale. */
  entry: ComponentEntry | undefined;
  /** `waiting` for visibility, `loading` a render, `shown` one, or `failed` to get one. */
  status: "waiting" | "loading" | "shown" | "failed";
  /** Renders tried for {@link PreviewSlot.entry}. */
  attempts: number;
  /** Bumped by every request, so a render that a newer request superseded is dropped on arrival. */
  request: number;
}

/** A preview box waiting to scroll into view: the path it renders, and the slot it reports to. */
interface PendingPreview {
  path: string;
  state: PreviewSlot;
}

/** The mounted surface, the box it is in, and everything registered against its nodes. */
interface StandingPanel {
  /** `null` only inside {@link mountInto}, between building the record and mounting into it. */
  handle: SitePanelSurfaceHandle | null;
  host: HTMLElement;
  /** Drag registrations, by the node they were made on — released when the node is gone. */
  sources: Map<HTMLElement, () => void>;
  /** Replaced, not cleared, when a preview goes stale: a cleared cache would empty the boxes. */
  cache: ReturnType<typeof createPreviewCache>;
  observer: ReturnType<typeof createPreviewObserver>;
  /** Preview boxes waiting to scroll into view, the component path each one shows, and its slot. */
  pending: Map<HTMLElement, PendingPreview>;
  /** Every preview box the document announced, until its node leaves the document. */
  slots: Map<HTMLElement, PreviewSlot>;
}

let _standing: StandingPanel | null = null;

/** Fill one preview box from the cache, now or when it has rendered. */
async function fillPreview(
  panel: StandingPanel,
  slot: HTMLElement,
  { path, state }: PendingPreview,
): Promise<void> {
  state.status = "loading";
  state.attempts += 1;
  const { request } = state;
  const rendered = await previewFor(path, panel.cache);
  if (_standing !== panel || !slot.isConnected || state.request !== request) {
    // The panel went, the card went, or a newer request for this box owns it now.
    return;
  }
  if (!rendered) {
    state.status = "failed";
    return;
  }
  state.status = "shown";
  if (shownPreview(slot) !== rendered) {
    /* The island: the document drew this box EMPTY so the live render can be moved into it
       (studio-ui-guidelines.md §9.4), exactly as the Library's cards are filled, inside a shadow
       root of its own so the component's ids and Studio's never meet. */
    mountPreview(slot, rendered);
  }
}

/** Ask for a box's preview: it renders when the box scrolls into view. */
function requestPreview(panel: StandingPanel, slot: HTMLElement, state: PreviewSlot): void {
  // Only a project component has a definition to render; a package card keeps its box empty.
  const path = definitionPath(state.entry);
  if (!path) {
    return;
  }
  state.request += 1;
  state.status = "waiting";
  panel.pending.set(slot, { path, state });
  panel.observer.observe(slot);
}

/** Track a preview box the document just created, and ask for its first render. */
function adoptPreview(panel: StandingPanel, slot: HTMLElement, tagName: string): void {
  const state: PreviewSlot = {
    attempts: 0,
    entry: componentRegistry.find((comp) => comp.tagName === tagName),
    request: 0,
    status: "waiting",
    tagName,
  };
  panel.slots.set(slot, state);
  requestPreview(panel, slot, state);
}

/**
 * Re-ask for every preview that is out of date: one whose registry entry has been replaced since it
 * was rendered (a save rebuilds the entry, a re-scan rebuilds them all), and one whose render
 * failed and has attempts left. A stale entry gets a fresh cache, because the old one would answer
 * with the render of the definition that changed; the boxes that are current keep what they show.
 */
function revisitPreviews(panel: StandingPanel): void {
  const stale: [HTMLElement, PreviewSlot][] = [];
  const retry: [HTMLElement, PreviewSlot][] = [];
  for (const [slot, state] of panel.slots) {
    const entry = componentRegistry.find((comp) => comp.tagName === state.tagName);
    if (entry !== state.entry) {
      state.entry = entry;
      state.attempts = 0;
      stale.push([slot, state]);
    } else if (state.status === "failed" && state.attempts < PREVIEW_ATTEMPT_LIMIT) {
      retry.push([slot, state]);
    }
  }
  if (stale.length > 0) {
    panel.cache = createPreviewCache();
  }
  for (const [slot, state] of [...stale, ...retry]) {
    requestPreview(panel, slot, state);
  }
}

/** Register one drag source. A node is announced once, when it is created, so once per node. */
function adoptSource(
  panel: StandingPanel,
  element: HTMLElement,
  data: () => BlockDragData | null,
): void {
  const cleanup = draggable({
    element,
    getInitialData: () => data() ?? {},
    onGenerateDragPreview: ({ nativeSetDragImage }: DragPreviewArgs) => {
      disableNativeDragPreview({ nativeSetDragImage });
    },
  });
  panel.sources.set(element, cleanup);
}

/** Release every drag source whose node the document has dropped. */
function releaseDetached(panel: StandingPanel): void {
  for (const [element, cleanup] of panel.sources) {
    if (!element.isConnected) {
      cleanup();
      panel.sources.delete(element);
    }
  }
  for (const slot of panel.slots.keys()) {
    if (!slot.isConnected) {
      panel.slots.delete(slot);
      panel.pending.delete(slot);
    }
  }
  panel.observer.releaseDetached();
}

/** Take a standing panel down, with everything registered against it. */
function dispose(panel: StandingPanel): void {
  panel.handle?.dispose();
  for (const cleanup of panel.sources.values()) {
    cleanup();
  }
  panel.sources.clear();
  panel.slots.clear();
  panel.pending.clear();
  panel.observer.destroy();
  panel.cache.clear();
}

/** The `{ type: "block" }` payload a component card drags, or null for a tag no longer registered. */
export function componentDragData(tagName: string): BlockDragData | null {
  const comp = componentRegistry.find((entry) => entry.tagName === tagName);
  return comp ? { fragment: buildComponentInstance(comp), type: "block" } : null;
}

/** The `{ type: "block" }` payload a media thumbnail drags: the element that references the file. */
export function mediaDragData(path: string): BlockDragData | null {
  const file = projectMediaFiles()?.find((entry) => entry.file === path);
  if (!file) {
    return null;
  }
  const fragment = elementForAsset({
    kind: mediaKind({ name: file.name }),
    name: file.name,
    path: file.file,
    ref: file.ref,
  });
  return { fragment, type: "block" };
}

/** Mount the surface into `host`, or bring the one already there up to date. */
function mountInto(host: HTMLElement): void {
  if (_standing && (_standing.host !== host || _standing.handle?.connected() === false)) {
    dispose(_standing);
    _standing = null;
  }
  if (_standing) {
    _standing.handle?.update(sitePanelValues());
    releaseDetached(_standing);
    revisitPreviews(_standing);
    return;
  }
  /* The record first, then the mount: the islands are announced while the document is built, and
     each one is handed straight to the record it belongs to. */
  const pending = new Map<HTMLElement, PendingPreview>();
  const panel: StandingPanel = {
    cache: createPreviewCache(),
    handle: null,
    host,
    observer: createPreviewObserver((element) => {
      const waiting = element instanceof HTMLElement ? pending.get(element) : undefined;
      if (waiting !== undefined && element instanceof HTMLElement) {
        pending.delete(element);
        void fillPreview(panel, element, waiting);
      }
    }),
    pending,
    slots: new Map(),
    sources: new Map(),
  };
  _standing = panel;
  panel.handle = mountSitePanelSurface(host, sitePanelValues(), ACTIONS, {
    componentSource: (element, tagName) => {
      adoptSource(panel, element, () => componentDragData(tagName));
    },
    mediaSource: (element, path) => {
      /* Read the file's record now, so the element a drag builds already carries its alt text. A
         read that fails, or a file that cannot hold one, simply places the image without it. */
      void loadMediaRecord(path);
      adoptSource(panel, element, () => mediaDragData(path));
    },
    preview: (element, tagName) => {
      adoptPreview(panel, element, tagName);
    },
  });
}

/** Repaint the Navigator, which repaints this panel when it is the one showing. */
function repaint(): void {
  renderOnly("leftPanel");
}

/**
 * The Navigator's content area inside a panel body, where a mounted document goes (the reason is
 * `panels/elements-panel.ts`'s: the body is lit's part, and its child is the box a panel owns).
 */
function contentArea(body: HTMLElement): HTMLElement {
  return body.querySelector<HTMLElement>(".panel-content") ?? body;
}

/**
 * Contribute the Site panel: project level (it lists and opens the project's files), the Project
 * rail group's one button, and the Navigator's default (`shell.ts`'s `DEFAULT_PANEL_ID`).
 */
export function registerSitePanel(): void {
  _formatsSubscription ??= onFormatsChanged(formatsChanged);
  registerPanel({
    id: "site",
    title: "Site",
    level: "project",
    dock: "navigator",
    icon: "browser",
    render: () => nothing,
    afterRender: (_ctx, host) => {
      mountInto(contentArea(host));
    },
  });
}

/** The format-registry subscription, made once, by the first registration. */
let _formatsSubscription: (() => void) | null = null;

/** Whether two extension lists name the same set. */
function sameExtensions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ext) => b.includes(ext));
}

/**
 * The format registry changed: re-read the page list if it was judged by a different set of page
 * extensions. A page a missing format had marked as needing its extension becomes an ordinary page
 * once the format lands, and the reverse when a format goes away.
 */
function formatsChanged(): void {
  if (_index && sameExtensions(_index.pageExtensions, readableDocumentExtensions("page"))) {
    return;
  }
  invalidateSiteIndex([]);
}

/** Forget the mounted panel and the index — tests, and a project switch. */
export function resetSitePanel(): void {
  if (_standing) {
    dispose(_standing);
  }
  _standing = null;
  _filter = "";
  _epoch += 1;
  _index = null;
  _indexStale = false;
  _loading = null;
  _facts.clear();
  _walk = true;
  // A new project's components are not the last one's, whatever the registry says it has loaded.
  _registryStale = true;
  _registryLoading = false;
}
