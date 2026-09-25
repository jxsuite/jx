/// <reference lib="dom" />
/**
 * The "newer @jxsuite packages are available" offer, as a mounted document.
 *
 * `packages/jxsuite-update.ts` is the flow — it asks the registry which packages are behind their
 * own newest publish, remembers a decline against the exact set of versions declined, and runs the
 * install behind a progress modal — and this is the surface it draws into: the rows, the two
 * answers, and a mount that lives in the dialog layer until the flow takes it down.
 *
 * **The range operator is the flow's, not the document's.** A row arrives with `target` already
 * spelled `^1.4.0`, because the same string is what `setPackageVersions` writes into the manifest:
 * a document that composed the caret itself would be a second author of the range, and the two
 * could disagree about what Update was going to do. The arrow between the two versions IS the
 * document's — that is markup around two facts rather than a third fact.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` rather than reimplemented.
 *
 * @docs studio/projects/dependencies
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import jxsuiteUpdateDoc from "./jxsuite-update.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("jxsuite-update", jxsuiteUpdateDoc as unknown as JxDocument);

/** One package the offer would move. Every field is already the string the row prints. */
export interface JxsuiteUpdateRow {
  /** The package name, which is also the row's key and its `data-package`. */
  name: string;
  /** The range the manifest pins today, e.g. `^1.2.0`. */
  current: string;
  /** The range Update would write, caret included — the flow's own spelling of it. */
  target: string;
}

export interface JxsuiteUpdateSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this never reaches back. */
  layer: HTMLElement;
  /** The packages on offer, in the order the flow found them. */
  packages: JxsuiteUpdateRow[];
  /** Update, please. */
  onConfirm: () => void;
  /** Not now — the Cancel button, or Escape. */
  onCancel: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface JxsuiteUpdateSurfaceHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

interface JxsuiteUpdateScope extends Record<string, unknown> {
  packages: JxsuiteUpdateRow[];
  confirm: () => void;
  cancel: () => void;
  closed: () => void;
}

/** Open the offer. The handle's `ready` resolves once the dialog is showing. */
export function openJxsuiteUpdateSurface(
  options: JxsuiteUpdateSurfaceOptions,
): JxsuiteUpdateSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "jxsuite-update"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close` event, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive<JxsuiteUpdateScope>({
    cancel: () => {
      options.onCancel();
    },
    closed: finish,
    confirm: () => {
      options.onConfirm();
    },
    packages: options.packages,
  }) as JxsuiteUpdateScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("jxsuite-update", scope, slot).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    showModal(element);
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the dialog down and
         leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
  };
}
