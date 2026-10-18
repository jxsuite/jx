/// <reference lib="dom" />
/**
 * The Site panel, as a mounted document (`specs/studio.md` §5.7).
 *
 * `panels/site-panel.ts` is the flow — which files are pages and in what order, how a collection
 * nests its pages, what a click opens and what a drag inserts — and this is the surface it draws
 * into: the reactive scope `site-panel.json` reads, and the mount that stays put while the
 * Navigator repaints around it.
 *
 * **Three islands, all through `onNodeCreated`.** A component card's preview box is filled with the
 * component rendered live, a component card is a drag source, and a media thumbnail is a drag
 * source. Each is announced to the flow as its node is CREATED, with the mapped row it was drawn
 * for, which is the compliant seam for registering behaviour on a node a document created
 * (studio-ui-guidelines.md §9.4) — never a query over the mounted DOM. The `disposed` guard comes
 * first for the reason `surfaces/files-panel.ts` gives: a panel taken down inside the same turn
 * still walks this callback for every row, and a registration made then would outlive it.
 *
 * @docs studio/interface
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import sitePanelDoc from "./site-panel.json";
import type { JsonObject, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";
import type {
  SiteComponentRow,
  SiteMediaRow,
  SitePageRow,
  SiteTemplateRow,
} from "../panels/site-model";

registerSurface("site-panel", sitePanelDoc);

/** What a section draws: a sentence while reading, one when empty or filtered out, or its rows. */
export type SiteSectionState = "loading" | "empty" | "nomatch" | "listed";

/** Everything the document reads. Every field is a value. */
export interface SitePanelValues {
  /** `none` draws one sentence asking for a project; `project` draws the four sections. */
  body: "none" | "project";
  filter: string;
  pages: SitePageRow[];
  pagesState: SiteSectionState;
  pagesCount: string;
  templates: SiteTemplateRow[];
  templatesState: SiteSectionState;
  templatesCount: string;
  components: SiteComponentRow[];
  componentsState: SiteSectionState;
  componentsCount: string;
  media: SiteMediaRow[];
  mediaState: SiteSectionState;
  mediaCount: string;
  /**
   * The line under a strip that does not show every thumbnail the filter admits ("Show all 766 in
   * Media"), or `""` when it shows them all.
   */
  mediaMore: string;
}

/** What a control can ask the panel to do. Read once, when the scope is made. */
export interface SitePanelActions {
  /** The filter field now holds `value`. */
  setFilter: (value: string) => void;
  /** Open a page, a template or a media file by its project path. */
  open: (path: string) => void;
  /** Open a component's definition by its tag. */
  openComponent: (tagName: string) => void;
  /** The `+` was pressed: open Add new. */
  add: () => void;
  /** Switch to the Media workspace. */
  openMedia: () => void;
}

/** The islands the flow attaches behaviour to, each announced as it is created. */
export interface SitePanelIslands {
  /** A component card's empty preview box, for the component with this tag. */
  preview: (element: HTMLElement, tagName: string) => void;
  /** A component card, which drags an instance of the component with this tag. */
  componentSource: (element: HTMLElement, tagName: string) => void;
  /** A media thumbnail, which drags an element referencing the file at this path. */
  mediaSource: (element: HTMLElement, path: string) => void;
}

export interface SitePanelSurfaceHandle {
  /** Settles once the document is mounted. */
  readonly ready: Promise<unknown>;
  /** Whether the mounted root is still where it was put. */
  connected: () => boolean;
  update: (values: SitePanelValues) => void;
  dispose: () => void;
}

interface SitePanelScope extends SitePanelValues, SitePanelActions {}

/** The scope's shape before the first projection lands on it. */
export function emptySitePanelValues(): SitePanelValues {
  return {
    body: "none",
    components: [],
    componentsCount: "",
    componentsState: "loading",
    filter: "",
    media: [],
    mediaCount: "",
    mediaMore: "",
    mediaState: "loading",
    pages: [],
    pagesCount: "",
    pagesState: "loading",
    templates: [],
    templatesCount: "",
    templatesState: "loading",
  };
}

/** Write a projection in, field by field, so an unchanged field is inert. */
function project(scope: SitePanelScope, values: SitePanelValues): void {
  scope.body = values.body;
  scope.filter = values.filter;
  scope.pages = values.pages;
  scope.pagesState = values.pagesState;
  scope.pagesCount = values.pagesCount;
  scope.templates = values.templates;
  scope.templatesState = values.templatesState;
  scope.templatesCount = values.templatesCount;
  scope.components = values.components;
  scope.componentsState = values.componentsState;
  scope.componentsCount = values.componentsCount;
  scope.media = values.media;
  scope.mediaState = values.mediaState;
  scope.mediaCount = values.mediaCount;
  scope.mediaMore = values.mediaMore;
}

/** The `part` a node was declared with, or the empty string. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The `$map` item a node was rendered inside, if it was rendered inside one. */
function mapItem(state: JxScope | undefined): JsonObject | null {
  const map = state?.["$map"];
  const item = isJsonObject(map) ? map["item"] : undefined;
  return isJsonObject(item) ? item : null;
}

/** One string field of the mapped row, or the empty string. */
function itemField(state: JxScope | undefined, field: string): string {
  const value = mapItem(state)?.[field];
  return isString(value) ? value : "";
}

/**
 * Mount the Site panel into `container`, the content box the Navigator painted.
 *
 * @param container Where the document goes.
 * @param values What it shows to begin with.
 * @param actions What its controls do.
 * @param islands Where the flow attaches previews and drag sources.
 */
export function mountSitePanelSurface(
  container: HTMLElement,
  values: SitePanelValues,
  actions: SitePanelActions,
  islands: SitePanelIslands,
): SitePanelSurfaceHandle {
  const scope: SitePanelScope = reactive<SitePanelScope>({
    ...emptySitePanelValues(),
    ...actions,
  });
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("site-panel", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      if (disposed || !(element instanceof HTMLElement)) {
        return;
      }
      switch (partOf(def)) {
        case "card-preview": {
          const tag = itemField(state, "tagName");
          if (tag !== "") {
            islands.preview(element, tag);
          }
          break;
        }
        case "component-card": {
          const tag = itemField(state, "tagName");
          if (tag !== "") {
            islands.componentSource(element, tag);
          }
          break;
        }
        case "media-thumb": {
          const path = itemField(state, "path");
          if (path !== "") {
            islands.mediaSource(element, path);
          }
          break;
        }
        default: {
          break;
        }
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface;
    }
    mounted = surface;
    return surface;
  });

  return {
    connected: () => !disposed && (mounted === null || mounted.root.parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => {
      project(scope, next);
    },
  };
}
