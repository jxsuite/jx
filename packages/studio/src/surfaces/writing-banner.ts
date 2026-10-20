/// <reference lib="dom" />
/**
 * The writing-mode banner surface: one line over the canvas while a collection entry is written
 * inside its template's layout (`specs/studio.md` §22.5).
 *
 * This is the adapter. `content/writing-banner.ts` decides what the line says and where its button
 * goes; this module writes the projection into a scope and mounts `writing-banner.json`.
 *
 * @docs studio/projects/content-types
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import writingBannerDoc from "./writing-banner.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("writing-banner", writingBannerDoc);

/** What the banner draws. */
export interface WritingBannerView {
  /** The region id stamped on the root: `pane.<id>/writing-banner`. */
  region: string;
  text: string;
  /** "Design the post page", or "Edit the Base template in Design" when the entry has no page. */
  actionLabel: string;
  /** Whether there is a template to open at all. */
  actionState: "hidden" | "shown";
}

export interface WritingBannerActions {
  /** Open the entry's template in Design. */
  openTemplate: () => void;
}

export interface WritingBannerHandle {
  readonly ready: Promise<unknown>;
  update: (view: WritingBannerView) => void;
  dispose: () => void;
}

interface WritingBannerScope extends WritingBannerView, WritingBannerActions {}

/**
 * Mount the banner into `host`, the empty node the canvas stage drew for it.
 *
 * @param host The stage's `writing-banner` host.
 * @param view What it says.
 * @param actions What its button does.
 */
export function mountWritingBannerSurface(
  host: HTMLElement,
  view: WritingBannerView,
  actions: WritingBannerActions,
): WritingBannerHandle {
  const scope: WritingBannerScope = reactive<WritingBannerScope>({ ...view, ...actions });
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("writing-banner", scope, host).then((surface) => {
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
      scope.text = next.text;
      scope.actionLabel = next.actionLabel;
      scope.actionState = next.actionState;
    },
  };
}
