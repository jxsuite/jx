/// <reference lib="dom" />
/**
 * The entry-preview bar surface: one small bar over the canvas while a collection's page is open in
 * Edit (`specs/studio.md` §22.4).
 *
 * This is the adapter. `content/entry-preview.ts` decides what the bar offers and what choosing
 * does; this module writes the projection into a scope and mounts `entry-preview.json`.
 *
 * @docs studio/projects/browse
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import entryPreviewDoc from "./entry-preview.json";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("entry-preview", entryPreviewDoc);

/** What the bar draws. */
export interface EntryPreviewView {
  /** The region id stamped on the root: `pane.<id>/entry-preview`. */
  region: string;
  /** `ready` draws the picker and its stepper; `note` draws {@link note} in their place. */
  status: "ready" | "note";
  /** Why there is nothing to pick yet: the entries are being read, or there are none. */
  note: string;
  /** Every entry, by its route value and the title it is listed by. */
  options: SurfaceOption[];
  /** The entry the page is drawn with: the route parameter's value. */
  value: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

export interface EntryPreviewActions {
  /** Draw the page with the entry whose route value is `value`. */
  choose: (value: string) => void;
  /** Draw the page with the entry `delta` places along the list. */
  step: (delta: number) => void;
}

export interface EntryPreviewHandle {
  readonly ready: Promise<unknown>;
  update: (view: EntryPreviewView) => void;
  dispose: () => void;
}

interface EntryPreviewScope extends EntryPreviewView, EntryPreviewActions {}

/**
 * Mount the bar into `host`, the empty node the canvas stage drew for it.
 *
 * @param host The stage's `entry-preview` host.
 * @param view What it says.
 * @param actions What its controls do.
 */
export function mountEntryPreviewSurface(
  host: HTMLElement,
  view: EntryPreviewView,
  actions: EntryPreviewActions,
): EntryPreviewHandle {
  const scope: EntryPreviewScope = reactive<EntryPreviewScope>({ ...view, ...actions });
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("entry-preview", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    return surface;
  });
  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update(next) {
      scope.region = next.region;
      scope.status = next.status;
      scope.note = next.note;
      scope.options = next.options;
      scope.value = next.value;
      scope.prevDisabled = next.prevDisabled;
      scope.nextDisabled = next.nextDisabled;
    },
  };
}
