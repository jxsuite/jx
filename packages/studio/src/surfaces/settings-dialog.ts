/// <reference lib="dom" />
/**
 * The Project Settings dialog, as a mounted document.
 *
 * A `jx-dialog` in the dialog layer whose body is an island: `settings-dialog.json` draws the slot,
 * and the flow (`settings/settings-dialog.ts`) mounts the settings editor's columns into it through
 * the `onNodeCreated` seam (`studio-ui-guidelines.md` §9.4). The dialog is only the frame and the
 * one answer, Close.
 *
 * **Mounted once, shown many times.** Every open used to mount this document and the whole editor
 * into it, and every close disposed both while the dialog was still on the top layer, which made
 * each close re-style the subtree it was removing. Now a close is the platform's `close()` and the
 * document stays in the dialog layer, closed (so `display: none`, and inert), until the flow
 * disposes it; the next open is one `showModal()`.
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
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-dialog", settingsDialogDoc);

/** The dialog's region: `overlay.dialog:settings`. Section regions are named under it. */
export const SETTINGS_DIALOG_REGION = overlayRegion("dialog", "settings");

export interface SettingsDialogOptions {
  /** The dialog layer host, handed in so this module never reaches back into `layers.ts`. */
  layer: HTMLElement;
  /** The body slot was created: where the flow mounts the settings editor. Called once. */
  body: (host: HTMLElement) => void;
  /** The dialog closed, for any reason: once per time it was shown. */
  closed: () => void;
}

/**
 * The settings frame, mounted once and shown as often as it is asked for.
 *
 * Closing it closes the platform's `<dialog>` and leaves the document standing in the dialog layer,
 * so the next open is one `showModal()` on a frame whose editor is already built, not a mount of
 * the whole editor. Only {@link SettingsDialogHandle.dispose} takes it down.
 */
export interface SettingsDialogHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered (and been opened, if still asked). */
  ready: Promise<HTMLElement>;
  /** Show it again after a close. Resolves once it is showing. */
  show: () => Promise<HTMLElement>;
  /** Close the dialog (the platform restores focus); the document stays mounted. Idempotent. */
  close: () => void;
  /** Close it and take the document and its slot down for good. Idempotent. */
  dispose: () => void;
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
 * Mount the dialog and open it. The handle's `ready` resolves once it is showing.
 *
 * @param {SettingsDialogOptions} options
 * @returns {SettingsDialogHandle}
 */
export function openSettingsDialogSurface(options: SettingsDialogOptions): SettingsDialogHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  /** Whether the dialog is asked to be showing: true from each open until its close. */
  let wanted = true;
  let disposed = false;
  /** Say this showing is over, once: the platform's own `close` and `close()` can each be first. */
  const finish = (): void => {
    if (!wanted) {
      return;
    }
    wanted = false;
    options.closed();
  };

  const scope = reactive<SettingsDialogScope>({ closed: finish });

  let mounted: SurfaceHandle | null = null;
  /** Open the platform's dialog, if it is still asked for. Read through a call after each await. */
  const open = (element: HTMLElement): HTMLElement => {
    if (!disposed && wanted) {
      showModal(element);
    }
    return element;
  };
  const ready = mountSurface("settings-dialog", scope, slot, {
    onNodeCreated: (element, _path, def) => {
      if (!disposed && element instanceof HTMLElement && partOf(def) === "pane-slot") {
        options.body(element);
      }
    },
  }).then(async (surface) => {
    /* SAFETY: `settings-dialog.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement. */
    const element = surface.root as HTMLElement;
    if (disposed) {
      surface.dispose();
      return element;
    }
    mounted = surface;
    await whenReady(element);
    /* The region goes on the platform's own `<dialog>`, the one element here that HAS a box:
       `jx-dialog` is `display: contents`, and the slot wraps a dialog the top layer takes out of
       flow, so both measure 0×0, and a region whose box is empty is refused by the screenshot
       pipeline. The kit's own behaviour sidecar finds that node by exactly this selector. */
    const box = element.querySelector<HTMLElement>('dialog[part="dialog"]') ?? element;
    box.setAttribute(REGION_ATTR, SETTINGS_DIALOG_REGION);
    return open(element);
  });

  const hide = (): void => {
    const element = mounted?.root;
    if (element instanceof HTMLElement) {
      // The platform's close, so focus goes back where it came from before anything else moves.
      close(element);
    }
    finish();
  };

  return {
    close: hide,
    dispose() {
      if (disposed) {
        return;
      }
      hide();
      disposed = true;
      mounted?.dispose();
      mounted = null;
      slot.remove();
    },
    host: slot,
    ready,
    show() {
      if (!disposed) {
        wanted = true;
      }
      return ready.then(open);
    },
  };
}
