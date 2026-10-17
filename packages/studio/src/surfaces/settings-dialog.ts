/// <reference lib="dom" />
/**
 * The Project Settings dialog, as a mounted document.
 *
 * A `jx-dialog` in the dialog layer whose body is an island: `settings-dialog.json` draws the slot,
 * and the flow (`settings/settings-dialog.ts`) mounts the settings editor's columns into it through
 * the `onNodeCreated` seam (`studio-ui-guidelines.md` §9.4). The dialog is only the frame and the
 * one answer, Close.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the document rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open. `whenReady` is shared with `surfaces/dialog.ts`.
 *
 * @docs studio/projects/settings
 */

import { isString } from "@jxsuite/schema/guards";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { reactive } from "../reactivity";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { mountSurface, registerSurface } from "../ui/surface";
import { whenReady } from "./dialog";
import settingsDialogDoc from "./settings-dialog.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { DialogLayerHandle, SurfaceHandle } from "../ui/surface";

registerSurface("settings-dialog", settingsDialogDoc);

/** The dialog's region: `overlay.dialog:settings`. Section regions are named under it. */
export const SETTINGS_DIALOG_REGION = overlayRegion("dialog", "settings");

export interface SettingsDialogOptions {
  /** The dialog layer host, handed in so this module never reaches back into `layers.ts`. */
  layer: HTMLElement;
  /** The body slot was created: where the flow mounts the settings editor. */
  body: (host: HTMLElement) => void;
  /** The dialog closed, for any reason, once. */
  closed: () => void;
}

interface SettingsDialogScope {
  closed: () => void;
}

/** The `part` a node's definition carries, or `""` for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/**
 * Open the dialog. The handle's `ready` resolves once it is showing.
 *
 * @param {SettingsDialogOptions} options
 * @returns {DialogLayerHandle}
 */
export function openSettingsDialogSurface(options: SettingsDialogOptions): DialogLayerHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  let closed = false;
  /** Say it is over, once: the platform's own `close` and `close()` can each be first. */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.closed();
  };
  /** Read through a call, so a check after an `await` is not narrowed to the value before it. */
  const isClosed = (): boolean => closed;

  const scope = reactive<SettingsDialogScope>({ closed: finish });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("settings-dialog", scope, slot, {
    onNodeCreated: (element, _path, def) => {
      if (!isClosed() && element instanceof HTMLElement && partOf(def) === "pane-slot") {
        options.body(element);
      }
    },
  }).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `settings-dialog.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement. */
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (isClosed()) {
      return element;
    }
    /* The region goes on the platform's own `<dialog>`, the one element here that HAS a box:
       `jx-dialog` is `display: contents`, and the slot wraps a dialog the top layer takes out of
       flow, so both measure 0×0, and a region whose box is empty is refused by the screenshot
       pipeline. The kit's own behaviour sidecar finds that node by exactly this selector. */
    const box = element.querySelector<HTMLElement>('dialog[part="dialog"]') ?? element;
    box.setAttribute(REGION_ATTR, SETTINGS_DIALOG_REGION);
    showModal(element);
    return element;
  });

  return {
    close() {
      /* Every line is idempotent, so the platform's `close` having run `finish()` first changes
         nothing: the document and its slot still come down. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        close(element);
      }
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
  };
}
