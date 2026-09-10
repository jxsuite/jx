/// <reference lib="dom" />
/**
 * The Entry editor surface: one content entry's fields, in a pane, as a Jx document over the kit.
 *
 * This is the adapter. `content/entry-editor.ts` keeps the editor — which pane holds which tab,
 * which collection a path belongs to, which record the fields live in, which required keys the
 * entry does not HAVE, and what the draft switch commits into — and hands this module one
 * projection whose every field is already a string or a flag. The document draws it and decides
 * nothing.
 *
 * **The form is an ISLAND, and that is the whole shape of this conversion.** A form built from a
 * JSON Schema is `ui/schema-form.ts`'s surface rather than this one's, and that engine hands back a
 * host ELEMENT rather than a template. So the document renders an empty `fields` node, announces it
 * through `onNodeCreated` — the one seam for an island (specs/studio-ui-guidelines.md §9.4) — and
 * the flow puts the engine's element in it. Nothing here knows what a schema is.
 *
 * **Announced, never queried.** The `fields` node lives inside a `$switch` case, so a document that
 * moves from "this file is in no collection" to "this file is an entry" builds a NEW one; a handle
 * found once by selector would be detached DOM the moment the discriminant moved. `onNodeCreated`
 * fires on every creation, including the reconciler's, which is what makes the handle keep up.
 *
 * **The card is mounted once per PANE.** `entry` is one of the kinds the side pane may host, so two
 * stages can each be drawing one: this module hands back a handle and the flow holds one per pane.
 * A repaint only ASSIGNS to the standing scope — rebuilding the mount would take a field out from
 * under a reader mid-edit.
 *
 * @docs studio/projects/content-types
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import entryEditorDoc from "./entry-editor.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("entry-editor", entryEditorDoc as unknown as JxDocument);

/** Everything the document draws, as one value. */
export interface EntryEditorView {
  /** The region id stamped on the root — `pane.<id>/entry`. */
  region: string;
  /** The region id on the field list — `pane.<id>/entry/fields`. */
  fieldsRegion: string;
  /**
   * Which of the two stages to draw.
   *
   * `empty` is not an error state: the mode is reachable from the palette and from `__jxAutomation`
   * on any tab, so a document that belongs to no collection has to say the reason and the fix.
   */
  stage: "entry" | "empty";
  /** The entry's file name — the heading. */
  name: string;
  /** The collection's name, in the chip beside it. */
  collection: string;
  /** Whether this collection has a draft workflow at all; with none, neither state is drawn. */
  draftAxis: "hidden" | "shown";
  /** Whether the entry is marked a draft. */
  draft: boolean;
  /** The switch's tooltip: what a draft IS, in `content/draft-state.ts`'s one sentence. */
  draftHint: string;
  /** Whether the sentence under the header is drawn — only while the entry IS a draft. */
  noteState: "hidden" | "shown";
  note: string;
  /** The `empty` stage's first sentence, naming the document it is about. */
  emptyLine: string;
}

/** What the reader can do here. Both are decisions the editor owns. */
export interface EntryEditorActions {
  /** The draft switch moved. A setter, never a toggle. */
  setDraft: (draft: boolean) => void;
  /** Open Project Settings › Content types — the door out of the `empty` stage. */
  openContentTypes: () => void;
}

/** The node the document renders empty for somebody else to fill. */
export interface EntryEditorIslands {
  /** The schema form's host, whenever the document has just created one. */
  fieldsSlot: (host: HTMLElement) => void;
}

export interface EntryEditorSurfaceHandle {
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host. */
  attached: () => boolean;
  update: (view: EntryEditorView) => void;
  dispose: () => void;
}

/** The scope the document reads: the view plus the actions, flat. */
interface EntryEditorScope extends Record<string, unknown>, EntryEditorView, EntryEditorActions {}

/** Write a whole view into the scope. Assignment only — the mount is never rebuilt for a repaint. */
function project(scope: EntryEditorScope, view: EntryEditorView): void {
  scope.region = view.region;
  scope.fieldsRegion = view.fieldsRegion;
  scope.stage = view.stage;
  scope.name = view.name;
  scope.collection = view.collection;
  scope.draftAxis = view.draftAxis;
  scope.draft = view.draft;
  scope.draftHint = view.draftHint;
  scope.noteState = view.noteState;
  scope.note = view.note;
  scope.emptyLine = view.emptyLine;
}

/** The `part` a node was authored with, or `""` — the only thing this adapter asks about a node. */
function partOf(def: unknown): string {
  const attributes = (def as { attributes?: Record<string, unknown> } | null)?.attributes;
  const part = attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the Entry editor document into `host` — the pane's canvas stage.
 *
 * The host is CLEARED first, for the reason `surfaces/media-pane.ts` gives: the stage is handed to
 * whichever mode owns it whole, and emptying it is what stops two editors stacking when a second
 * file opens into the same pane before the first mount has settled.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {EntryEditorView} view - What to draw right now
 * @param {EntryEditorActions} actions - What each control does
 * @param {EntryEditorIslands} islands - Where the schema form lands
 * @returns {EntryEditorSurfaceHandle}
 */
export function mountEntryEditorSurface(
  host: HTMLElement,
  view: EntryEditorView,
  actions: EntryEditorActions,
  islands: EntryEditorIslands,
): EntryEditorSurfaceHandle {
  host.replaceChildren();
  const scope = reactive<EntryEditorScope>({
    collection: "",
    draft: false,
    draftAxis: "hidden",
    draftHint: "",
    emptyLine: "",
    fieldsRegion: "",
    name: "",
    note: "",
    noteState: "hidden",
    openContentTypes: actions.openContentTypes,
    region: "",
    setDraft: actions.setDraft,
    stage: "empty",
  }) as EntryEditorScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the island
     announces itself through `onNodeCreated` as it is created, which is one `connectedCallback`
     earlier than awaiting the element would be (§1.1, "await the element"). */
  const ready = mountSurface("entry-editor", scope, host, {
    onNodeCreated: (element, _path, def) => {
      if (element instanceof HTMLElement && partOf(def) === "fields") {
        islands.fieldsSlot(element);
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
         the next canvas repaint tear down the mount it is waiting for and start another. */
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
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
