/// <reference lib="dom" />
/**
 * The contributed settings section: `$studio.settings` (specs/extensions.md §9.1), as a Jx document
 * over the kit.
 *
 * The adapter owns the MOUNT and the scope; `settings/contributed-section.ts` owns the decisions —
 * what an entry may be named, what reaches `project.json`, and what the validator said about it.
 * The split is the one `surfaces/settings-defs.ts` draws, and the two documents are deliberately
 * the same shape: a contributed "map" section IS the master-detail editor Data Shapes is, so a
 * section that looked different from its siblings would be a defect rather than a variation.
 *
 * **Two islands, and both are somebody else's surface.** A form built from a JSON Schema is
 * `ui/schema-form.ts`'s, and the actions row (Test Connection, Push Schema, Open Data Grid) is
 * `panels/data-grid.ts`'s. This document renders `form-host` and `actions` and nothing inside
 * either, and the section fills them through `onNodeCreated` — the one seam for an island
 * (specs/studio-ui-guidelines.md §9.4). That seam is why the two could convert independently: the
 * schema form became a document of its own mid-conversion, and all that changed on this side was
 * the line that fills the node.
 *
 * **A refused rename snaps back because the scope moves, not because a handler writes to an
 * input.** The lit version assigned `target.value = selected` from inside the change handler. A
 * document's binding writes only when the scope value CHANGES, and after a refusal the scope still
 * holds the key on disk — so the section says what the control now holds first, and the correction
 * that follows is a real move. See `settings/contributed-section.ts`'s `say`.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import contributedDoc from "./settings-contributed.json";

import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-contributed", contributedDoc as unknown as JxDocument);

/** One entry key in a map-layout section's left column. */
export interface ContributedEntryView {
  /** The key in the section's map on disk — the row's identity and its `data-entry`. */
  key: string;
  selected: boolean;
  /** `pane.primary/entry:<key>`, so a shot can name the row without a selector. */
  region: string;
}

/** Everything the document draws, as one value. */
export interface ContributedView {
  /** The section heading — the contribution's title, or its `project.json` key. */
  title: string;
  /** Which of the two layouts an extension declared. The document's outermost `$switch`. */
  layout: "form" | "map";
  /** Whether the host contributed an actions row at all. */
  actionsState: "none" | "slot";
  entries: ContributedEntryView[];
  /** Whether the left column is offering the new-entry button or the form. */
  newState: "closed" | "open";
  newName: string;
  /** Whether the right column is editing an entry or saying that none is chosen. */
  editorState: "empty" | "editing";
  /** What the rename field holds — the key on disk, or what the reader has just typed. */
  entryName: string;
  /** `pane.primary/editor`. */
  editorRegion: string;
}

/** What the reader may do here. Each one is a decision the section makes. */
export interface ContributedActions {
  select: (key: string) => void;
  openNew: () => void;
  editNew: (value: string) => void;
  createNew: () => void;
  cancelNew: () => void;
  renameEntry: (value: string) => void;
  /** Escape in the rename field — the value it holds comes with it, so the scope can move off it. */
  cancelRename: (held: string) => void;
  removeEntry: () => void;
}

/**
 * The two nodes the document renders empty for somebody else to fill.
 *
 * Announced through `onNodeCreated` rather than found by selector, so the section holds the node it
 * was given rather than re-finding one that a `$switch` may already have replaced.
 */
export interface ContributedIslands {
  /** The schema form's host, whenever the document has just created one. */
  formSlot: (host: HTMLElement) => void;
  /** The host-contributed actions row's host. */
  actionsSlot: (host: HTMLElement) => void;
}

export interface ContributedSurfaceHandle {
  /** The container the document was mounted into. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host — see `surfaces/settings-defs.ts`. */
  attached: () => boolean;
  update: (view: ContributedView) => void;
  dispose: () => void;
}

interface ContributedScope extends Record<string, unknown>, ContributedView, ContributedActions {}

/** The view a freshly mounted surface starts on: a form layout with nothing in it. */
function emptyView(): ContributedView {
  return {
    actionsState: "none",
    editorRegion: "",
    editorState: "empty",
    entries: [],
    entryName: "",
    layout: "form",
    newName: "",
    newState: "closed",
    title: "",
  };
}

/** The `part` a node was authored with, or `""` — the only thing this adapter asks about a node. */
function partOf(def: unknown): string {
  const attributes = (def as { attributes?: Record<string, unknown> } | null)?.attributes;
  const part = attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the contributed-section document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The settings pane's section body
 * @param {ContributedActions} actions - What each control does
 * @param {ContributedIslands} islands - Where the two foreign surfaces land
 * @returns {ContributedSurfaceHandle}
 */
export function mountContributedSurface(
  host: HTMLElement,
  actions: ContributedActions,
  islands: ContributedIslands,
): ContributedSurfaceHandle {
  host.textContent = "";
  const scope = reactive<ContributedScope>({ ...emptyView(), ...actions }) as ContributedScope;

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the islands
     announce themselves through `onNodeCreated` as they are created, which is one
     `connectedCallback` earlier than awaiting the element would be (§1.1, "await the element"). */
  const ready = mountSurface("settings-contributed", scope, host, {
    onNodeCreated: (element, _path, def) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "form-host") {
        islands.formSlot(element);
      } else if (part === "actions") {
        islands.actionsSlot(element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      /* A mount still in flight has nothing in the host yet, and answering "no" to that would make
         a second synchronous render tear down the mount it is waiting for and start another. */
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    host,
    ready,
    update(view) {
      scope.actionsState = view.actionsState;
      scope.editorRegion = view.editorRegion;
      scope.editorState = view.editorState;
      scope.entries = view.entries;
      scope.entryName = view.entryName;
      scope.layout = view.layout;
      scope.newName = view.newName;
      scope.newState = view.newState;
      scope.title = view.title;
    },
  };
}
