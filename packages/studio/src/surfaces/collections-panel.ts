/// <reference lib="dom" />
/**
 * The Collections panel surface: the Content workspace's Navigator, as a Jx document over the kit
 * (`specs/studio.md` §22.5).
 *
 * This is the adapter. `panels/collections-panel.ts` keeps every decision — which collections the
 * project has and how many entries each holds, which saved grid views sit under them, whether an
 * entry is being written and which collection it is in, what each entry is called and whether it is
 * a draft — and hands this module one projection whose every field is already a string. The
 * document draws one of three bodies (no project, the collection list, one collection's entries),
 * chosen by one word.
 *
 * @docs studio/projects/browse
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import collectionsPanelDoc from "./collections-panel.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("collections-panel", collectionsPanelDoc);

/** One saved grid view under a collection. */
export interface CollectionViewRow {
  /** The view's identity across repaints: the collection key and the view's name. */
  key: string;
  name: string;
}

/** One collection in the list. */
export interface CollectionRow {
  key: string;
  title: string;
  /** Its entry count, already a string ("12"), or "" while the scan runs. */
  count: string;
  /** `"true"` for the collection the Content home is showing. */
  selected: "true" | "false";
  views: CollectionViewRow[];
}

/** One entry in the entries list. */
export interface CollectionEntryRow {
  path: string;
  title: string;
  /** "Draft", "Published", or "". */
  status: string;
  /** Whether a thumbnail is drawn, or the document glyph. */
  art: "image" | "glyph";
  thumb: string;
  /** `"true"` for the entry being written. */
  selected: "true" | "false";
}

/** Everything the document draws. */
export interface CollectionsPanelValues {
  /** `none` asks for a project; `list` draws the collections; `entries` draws one collection's. */
  body: "none" | "list" | "entries";
  collections: CollectionRow[];
  /** The collection whose entries are listed, for the back row: "Posts". */
  backTitle: string;
  backCount: string;
  entriesState: "loading" | "empty" | "listed";
  entries: CollectionEntryRow[];
  /** The create row under the entries: "New post". */
  newLabel: string;
}

/** What a control can ask the panel to do. Every one is a decision the flow owns. */
export interface CollectionsPanelActions {
  /** Show a collection in the Content home. */
  showCollection: (key: string) => void;
  /** Open a collection's grid on one of its saved views. */
  applyView: (key: string, name: string) => void;
  /** **+ New collection**: Add new › Collection. */
  newCollection: () => void;
  /** **‹ <Collection>**: back to the collection in the Content home. */
  back: () => void;
  /** Open an entry where it is written. */
  openEntry: (path: string) => void;
  /** **+ New <item>**: Add new › Entry in this collection. */
  newEntry: () => void;
}

export interface CollectionsPanelSurfaceHandle {
  readonly ready: Promise<unknown>;
  /** Whether the mounted root is still where it was put. */
  connected: () => boolean;
  update: (values: CollectionsPanelValues) => void;
  dispose: () => void;
}

interface CollectionsPanelScope extends CollectionsPanelValues, CollectionsPanelActions {}

/** The scope's shape before the first projection lands on it. */
export function emptyCollectionsPanelValues(): CollectionsPanelValues {
  return {
    backTitle: "",
    backCount: "",
    body: "none",
    collections: [],
    entries: [],
    entriesState: "loading",
    newLabel: "",
  };
}

/** Write a projection in, field by field, so an unchanged field is inert. */
function project(scope: CollectionsPanelScope, values: CollectionsPanelValues): void {
  scope.body = values.body;
  scope.collections = values.collections;
  scope.backTitle = values.backTitle;
  scope.backCount = values.backCount;
  scope.entriesState = values.entriesState;
  scope.entries = values.entries;
  scope.newLabel = values.newLabel;
}

/**
 * Mount the Collections panel into `container`, the content box the Navigator painted.
 *
 * @param container Where the document goes.
 * @param values What it shows to begin with.
 * @param actions What its controls do.
 */
export function mountCollectionsPanelSurface(
  container: HTMLElement,
  values: CollectionsPanelValues,
  actions: CollectionsPanelActions,
): CollectionsPanelSurfaceHandle {
  const scope: CollectionsPanelScope = reactive<CollectionsPanelScope>({
    ...emptyCollectionsPanelValues(),
    ...actions,
  });
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("collections-panel", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface;
    }
    mounted = surface;
    return surface;
  });

  return {
    connected: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      // A mount still in flight is not yet in the container, and is not a reason to remount.
      return root === undefined ? true : container.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
