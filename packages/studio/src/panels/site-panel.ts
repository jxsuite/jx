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
 * media-changed handler in `studio.ts` — and re-read the next time the panel paints. The component
 * registry and the media cache are their owners' caches, read as they stand; the media cache
 * repaints the Navigator itself when its listing lands.
 *
 * @docs studio/interface
 */

import { nothing } from "lit-html";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import { isString } from "@jxsuite/schema/guards";
import { projectState, renderOnly } from "../store";
import { getPlatform, hasPlatform } from "../platform";
import { activeTab } from "../workspace/workspace";
import { scanLibrary } from "../browse/library-model";
import { createPreviewCache, createPreviewObserver, previewFor } from "../browse/library-preview";
import {
  _componentRegistryLoaded,
  buildComponentInstance,
  componentRegistry,
  loadComponentRegistry,
} from "../files/components";
import { mediaKind } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { elementForAsset } from "../editor/file-drop-action";
import { readPageFacts } from "../content/collection-pages";
import { listCollectionEntryIds } from "../grid/sources/content-source";
import { loadUsages, peekUsages, splitUsages } from "../services/references";
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

// ─── The project index ───────────────────────────────────────────────────────

/** What the panel knows about the project's files, read once per invalidation. */
interface SiteIndex {
  pages: SitePageFact[];
  /** Every file under `layouts/`. The model keeps the JSON ones. */
  layouts: string[];
  /** Declared collections → entry counts; a count is `null` until its listing lands. */
  collections: Map<string, number | null>;
}

let _index: SiteIndex | null = null;
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

/** Read the index: one walk of `pages/` and `layouts/`, then each dynamic page's `$paths`. */
async function readIndex(epoch: number): Promise<void> {
  const scan = await scanLibrary(["pages", "layouts"], getPlatform());
  const pageFiles = scan.files.filter((file) => file.path.startsWith("pages/"));
  const pages = await Promise.all(
    pageFiles.map(async (file): Promise<SitePageFact> => ({
      contentType: file.path.includes("[") ? await contentTypeOf(file.path) : null,
      path: file.path,
    })),
  );
  if (epoch !== _epoch) {
    return;
  }
  // A re-read keeps the counts it already had until their own re-listing lands.
  const previous = _index?.collections;
  const collections = new Map<string, number | null>(
    declaredCollections().map((name) => [name, previous?.get(name) ?? null]),
  );
  _indexStale = false;
  _index = {
    collections,
    layouts: scan.files.flatMap((file) => (file.path.startsWith("layouts/") ? [file.path] : [])),
    pages,
  };
  repaint();
  // The counts are a second pass, only for the collections a page actually nests under.
  const nested = new Set(
    pages.flatMap((page) =>
      page.contentType && collections.has(page.contentType) ? [page.contentType] : [],
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
 * The component registry is re-scanned too, once, because a component file created outside Studio
 * is otherwise invisible until the project is reopened. A scan reads every JSON file in the
 * project, so it runs only for a batch that could hold a component definition: Studio's own save of
 * a component already updates the registry (`noteComponentSaved`), and a page or an entry is not
 * one.
 *
 * @param paths - The project-relative paths the event batch touched; `undefined` (a gap in the
 *   stream, or an upload) means anything may have changed.
 */
export function invalidateSiteIndex(paths?: readonly string[]): void {
  _epoch += 1;
  _indexStale = true;
  _loading = null;
  if (paths === undefined || paths.some((path) => mayDefineComponent(path))) {
    _registryStale = true;
  }
  if (_standing) {
    repaint();
  }
}

/** The trees whose JSON files are documents of their own kind, never component definitions. */
const NON_COMPONENT_DIRS = ["pages/", "layouts/", "content/", "public/"];

/** Whether a changed path could add, change or remove a component definition. */
export function mayDefineComponent(path: string): boolean {
  if (path.startsWith("components/")) {
    return true;
  }
  return (
    path.endsWith(".json") &&
    path !== "project.json" &&
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

/** How many pages use a template, from the reference index — `null` where it cannot say yet. */
function templateUsage(path: string): number | null {
  const state = peekUsages({ path });
  if (state === null) {
    void loadUsages({ path }).then(repaint);
    return null;
  }
  return state.status === "ready" ? splitUsages(state.result).pages : null;
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

  const allPages = index ? pageRows(index.pages, index.collections, activePath) : [];
  const pages = filterPageRows(allPages, needle);
  const defaultLayout = defaultLayoutPath();
  const allTemplates = index
    ? templateRows(index.layouts, templateUsage, activePath, "", defaultLayout)
    : [];
  const templates = index
    ? templateRows(index.layouts, templateUsage, activePath, needle, defaultLayout)
    : [];
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
    media: shownMedia,
    mediaCount: countLabel(allMedia.length, shownMedia.length, media === null),
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

/** The mounted surface, the box it is in, and everything registered against its nodes. */
interface StandingPanel {
  /** `null` only inside {@link mountInto}, between building the record and mounting into it. */
  handle: SitePanelSurfaceHandle | null;
  host: HTMLElement;
  /** Drag registrations, by the node they were made on — released when the node is gone. */
  sources: Map<HTMLElement, () => void>;
  cache: ReturnType<typeof createPreviewCache>;
  observer: ReturnType<typeof createPreviewObserver>;
  /** Preview boxes waiting to scroll into view, and the component path each one shows. */
  pending: Map<Element, string>;
}

let _standing: StandingPanel | null = null;

/** Fill one preview box from the cache, now or when it has rendered. */
async function fillPreview(panel: StandingPanel, slot: Element, path: string): Promise<void> {
  const rendered = await previewFor(path, panel.cache);
  if (rendered && _standing === panel && slot.isConnected && !slot.firstElementChild) {
    /* The island: the document drew this box EMPTY so the live render can be moved into it
       (studio-ui-guidelines.md §9.4), exactly as the Library's cards are filled. */
    slot.append(rendered);
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
  panel.observer.releaseDetached();
}

/** Take a standing panel down, with everything registered against it. */
function dispose(panel: StandingPanel): void {
  panel.handle?.dispose();
  for (const cleanup of panel.sources.values()) {
    cleanup();
  }
  panel.sources.clear();
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
    return;
  }
  /* The record first, then the mount: the islands are announced while the document is built, and
     each one is handed straight to the record it belongs to. */
  const pending = new Map<Element, string>();
  const panel: StandingPanel = {
    cache: createPreviewCache(),
    handle: null,
    host,
    observer: createPreviewObserver((element) => {
      const path = pending.get(element);
      if (path !== undefined) {
        pending.delete(element);
        void fillPreview(panel, element, path);
      }
    }),
    pending,
    sources: new Map(),
  };
  _standing = panel;
  panel.handle = mountSitePanelSurface(host, sitePanelValues(), ACTIONS, {
    componentSource: (element, tagName) => {
      adoptSource(panel, element, () => componentDragData(tagName));
    },
    mediaSource: (element, path) => {
      adoptSource(panel, element, () => mediaDragData(path));
    },
    preview: (element, tagName) => {
      // Only a project component has a definition to render; a package card keeps its box empty.
      const path = definitionPath(componentRegistry.find((comp) => comp.tagName === tagName));
      if (path) {
        pending.set(element, path);
        panel.observer.observe(element);
      }
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
  // A new project's components are not the last one's, whatever the registry says it has loaded.
  _registryStale = true;
  _registryLoading = false;
}
