/// <reference lib="dom" />
/**
 * The blocking progress surface: a `jx-dialog` mounted into the modal layer and opened modally.
 *
 * This is the adapter. `ui/progress-modal.ts` keeps the flow — the Activity entry the operation is
 * recorded in, what a failure does to Problems, which of the two exits hands the app back — and
 * hands this module a projection: a title, a status line, and whether the operation can be stopped.
 * The document renders that; the platform's `<dialog>` owns modality, the backdrop, focus
 * restoration and Escape.
 *
 * Nothing here traps Tab, focuses the first control or paints a scrim, and that is the whole
 * substance of the conversion rather than a tidy-up. The lit version was a card beside an
 * `<sp-underlay>` in a slot that ran a keydown listener; the scrim painted at `z-index: 1` and the
 * card at `auto`, so `Run in the background` — the only way out of a running install — was visible
 * through the scrim and could not be clicked. A modal `<dialog>` is in the top layer by
 * construction, so there is no stacking left to get wrong.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import progressDoc from "./progress-modal.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("progress-modal", progressDoc as unknown as JxDocument);

/** What the flow hands the surface. Everything is a projection; the flow keeps the operation. */
export interface ProgressSurfaceOptions {
  /** Where the dialog is mounted — the modal layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** The operation's name, which the dialog draws as its headline and its accessible name. */
  title: string;
  /** The line under it, which is also the surface's live region. */
  status: string;
  /**
   * The operation handed over a way to stop it, so a Cancel answer is drawn.
   *
   * Absent means it genuinely cannot be stopped and no button claims otherwise — but the confirm
   * answer is offered regardless, because "let me use the app" is a promise this surface can always
   * keep.
   */
  cancellable: boolean;
  /** Stop blocking and keep working. The confirm button and Escape both mean this. */
  onBackground: () => void;
  /** Stop the work. Reachable only when `cancellable`. */
  onCancel: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface ProgressSurfaceHandle {
  /** The slot in the modal layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Rewrite the status line. A no-op once the dialog is gone. */
  setStatus: (text: string) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

interface ProgressScope extends Record<string, unknown> {
  title: string;
  status: string;
  /**
   * The secondary answer's label, empty for none — which is how "this cannot be stopped" is said.
   *
   * It is the SECONDARY answer rather than the cancel one because the platform raises a single
   * `cancel` for Escape, for a light dismissal and for a cancel button alike. A surface that cannot
   * tell those apart would stop a dependency install on a keystroke, and Escape here has always
   * meant stop blocking rather than stop working.
   */
  cancelLabel: string;
  background: () => void;
  cancel: () => void;
  closed: () => void;
}

/** Open the progress dialog. The handle's `ready` resolves once it is showing. */
export function openProgressSurface(options: ProgressSurfaceOptions): ProgressSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("modal", "progress"));
  options.layer.append(slot);

  let closed = false;
  const scope = reactive<ProgressScope>({
    background: () => {
      options.onBackground();
    },
    cancel: () => {
      options.onCancel();
    },
    cancelLabel: options.cancellable ? "Cancel" : "",
    closed: () => {
      options.onClosed();
    },
    status: options.status,
    title: options.title,
  }) as ProgressScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("progress-modal", scope, slot).then(async (surface) => {
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    mounted = surface;
    /* `whenReady` before `showModal`, and it is not belt and braces: the mount resolving means the
       DOCUMENT rendered, while the element's OWN template is one `connectedCallback` later.
       `showModal` in between finds no `<dialog>` to open, and the surface never shows. */
    await whenReady(element);
    if (closed) {
      return element;
    }
    showModal(element);
    return element;
  });

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does.
      mounted?.dispose();
      mounted = null;
      slot.remove();
    },
    host: slot,
    ready,
    setStatus(text: string) {
      scope.status = text;
    },
  };
}
