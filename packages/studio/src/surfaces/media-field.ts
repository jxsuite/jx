/// <reference lib="dom" />
/**
 * The media field, as a mounted document.
 *
 * This is the adapter. `ui/media-picker.ts` is the flow — what the project's media are, what a
 * thumbnail's URL is in a canvas realm, how long a keystroke waits before it becomes a document
 * write, and what Upload and Browse actually do — and this is the control it draws into. Nothing
 * here knows what a media file is: the scope is a string, a thumbnail URL, and four callbacks.
 *
 * **It is mounted into a host the CALLER owns**, which is the seam a leaf gets when the module
 * interpolating it is still lit (specs/studio-ui-guidelines.md §9.4). Three callers draw an empty
 * box and hand it over — `panels/properties-panel.ts` through the Content tab's
 * `[part="control-host"]`, `panels/signals-panel.ts` through its island map, and
 * `grid/cell-popovers.ts` through `grid-cell.json`'s `[part="picker-host"]` — and each of them used
 * to `litRender` a template returned from here instead. A document cannot be handed back as a
 * value, so the leaf is mounted rather than returned, and {@link MediaFieldHandle.update} is what a
 * repaint calls in place of rendering the template again.
 *
 * @docs studio/projects/media
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import mediaFieldDoc from "./media-field.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("media-field", mediaFieldDoc as unknown as JxDocument);

/** Everything the control draws, as one value. */
export interface MediaFieldView {
  /** The field's accessible name — the attribute or prop it edits. */
  label: string;
  /** What the field holds: the authored value, never the preview URL. */
  value: string;
  /** Whether a preview stands beside the field. Only an image value has one. */
  thumbState: "hidden" | "shown";
  /** The preview's URL, which is a realm-resolved projection of the value rather than the value. */
  thumbSrc: string;
}

/** What a control asks the flow to do. */
export interface MediaFieldActions {
  /** A keystroke in the field. The flow debounces; the document reports every one. */
  edit: (value: string) => void;
  /** The field took focus: list the project's media, if that has not happened yet. */
  warm: () => void;
  /** Upload was pressed: open the OS file picker. */
  upload: () => void;
  /** Browse was pressed, from that control: open the project's media under it. */
  browse: (anchor: HTMLElement) => void;
}

export interface MediaFieldHandle {
  /** Bring the mounted control up to date; the document reconciles in place. */
  update: (view: MediaFieldView) => void;
  dispose: () => void;
}

/** The scope the document reads. */
interface MediaFieldScope extends Record<string, unknown>, MediaFieldView, MediaFieldActions {}

/** Write a projection into the scope. */
function project(scope: MediaFieldScope, view: MediaFieldView): void {
  scope.label = view.label;
  scope.value = view.value;
  scope.thumbState = view.thumbState;
  scope.thumbSrc = view.thumbSrc;
}

/**
 * Mount the media field into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The empty box the caller drew for it
 * @param {MediaFieldView} view - What to draw right now
 * @param {MediaFieldActions} actions - What each control does
 * @returns {MediaFieldHandle}
 */
export function mountMediaFieldSurface(
  host: HTMLElement,
  view: MediaFieldView,
  actions: MediaFieldActions,
): MediaFieldHandle {
  const scope = reactive<MediaFieldScope>({
    browse: actions.browse,
    edit: actions.edit,
    label: view.label,
    thumbSrc: view.thumbSrc,
    thumbState: view.thumbState,
    upload: actions.upload,
    value: view.value,
    warm: actions.warm,
  }) as MediaFieldScope;

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* The mount is async and the host may be gone before it lands — a projection can replace the row
     that owns the box in the same turn it was announced — so the `.then` has to notice, exactly as
     every other island adapter's does. */
  void mountSurface("media-field", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => project(scope, next),
  };
}
