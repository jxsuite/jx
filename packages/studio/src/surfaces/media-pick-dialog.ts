/// <reference lib="dom" />
/**
 * The full-size media picker's dialog, as a mounted document.
 *
 * A `jx-dialog` in the dialog layer whose body is an island: `media-pick-dialog.json` draws the
 * slot, and the flow (`media/media-library.ts`) mounts the Media workspace's own library into it in
 * pick mode, through the `onNodeCreated` seam (`studio-ui-guidelines.md` §9.4). So the picker and
 * the workspace are one surface at two sizes, and the dialog is only the frame and the answer:
 * Cancel, or Use <file>.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the document rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open. `whenReady` is shared with `surfaces/dialog.ts`.
 *
 * @docs studio/projects/media
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import pickDoc from "./media-pick-dialog.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { DialogLayerHandle, SurfaceHandle } from "../ui/surface";
import { isString } from "@jxsuite/schema/guards";

registerSurface("media-pick-dialog", pickDoc);

/** The slot id, and so the dialog's region: `overlay.dialog:media-picker`. */
export const MEDIA_PICK_SLOT = "media-picker";

/** What the dialog's own chrome says. */
export interface MediaPickDialogView {
  headline: string;
  /** "Use hero.jpg", or "Use file" while nothing is chosen. */
  confirmLabel: string;
  /** No file is chosen, so there is nothing to use yet. */
  blocked: boolean;
}

export interface MediaPickDialogOptions {
  layer: HTMLElement;
  view: MediaPickDialogView;
  /** The body slot was created: where the flow mounts the library. */
  body: (host: HTMLElement) => void;
  confirm: () => void;
  /** The dialog closed, for any reason, once. */
  closed: () => void;
}

export interface MediaPickDialogHandle extends DialogLayerHandle {
  update: (view: MediaPickDialogView) => void;
}

interface MediaPickScope extends MediaPickDialogView {
  confirm: () => void;
  closed: () => void;
}

function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** Open the dialog. The handle's `ready` resolves once it is showing. */
export function openMediaPickDialogSurface(options: MediaPickDialogOptions): MediaPickDialogHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none`; every slot turns them back on for its own content, or a
     modal `<dialog>` in it is painted above everything and hit-tests to nothing (surfaces/add-new). */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", MEDIA_PICK_SLOT));
  options.layer.append(slot);

  let closed = false;
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.closed();
  };
  /** Read through a call, so a check after an `await` is not narrowed to the value before it. */
  const isClosed = (): boolean => closed;

  const scope = reactive<MediaPickScope>({
    ...options.view,
    closed: finish,
    confirm: options.confirm,
  });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("media-pick-dialog", scope, slot, {
    onNodeCreated: (element, _path, def) => {
      if (!isClosed() && element instanceof HTMLElement && partOf(def) === "library-slot") {
        options.body(element);
      }
    },
  }).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `media-pick-dialog.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement. */
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (!isClosed()) {
      showModal(element);
    }
    return element;
  });

  return {
    close() {
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        close(element);
      }
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      Object.assign(scope, view);
    },
  };
}
