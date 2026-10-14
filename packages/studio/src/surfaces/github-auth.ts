/// <reference lib="dom" />
/**
 * The GitHub device-flow waiting room, as a mounted document.
 *
 * `github/github-auth.ts` is the flow — the client id, the device-code request, the poll loop, its
 * failure budget and the three reports the outcomes raise — and this is the surface it draws into:
 * the code GitHub minted, the page to type it into, and the one answer the reader can give.
 *
 * **There is nothing to update.** Both values are minted once by the device-code request and are
 * dead the moment the flow ends, so the handle offers `close` and no `update`: a code that changed
 * under the reader mid-transcription would be a defect rather than a feature, and a handle that
 * could express it would invite one.
 *
 * **The dialog has no confirm.** The answer arrives from GitHub over a poll rather than from
 * anything on screen, so the document sets `confirmLabel` empty and `jx-dialog` draws Cancel alone.
 * A dialog that reports its own dismissal is the whole contract here: `onClosed` fires once, for
 * the platform's `close` and for this module's, and the flow stops polling on it.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` rather than reimplemented.
 *
 * @docs studio/publish/github
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import githubAuthDoc from "./github-auth.json";
import type { DialogLayerHandle, SurfaceHandle } from "../ui/surface";

registerSurface("github-auth", githubAuthDoc);

export interface GithubAuthSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this never reaches back. */
  layer: HTMLElement;
  /** The user code GitHub minted, exactly as it must be typed. */
  userCode: string;
  /** The page the code is typed into. Printed in full, because the reader may retype it. */
  verificationUri: string;
  /** The reader declined — the Cancel button, or Escape. */
  onCancel: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

interface GithubAuthScope {
  userCode: string;
  verificationUri: string;
  cancel: () => void;
  closed: () => void;
}

/** Put the code up. The handle's `ready` resolves once the dialog is showing. */
export function openGithubAuthSurface(options: GithubAuthSurfaceOptions): DialogLayerHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "github-auth"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close` event, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown — which is the
   * ordinary end of this flow, because the token usually arrives while the dialog is still up.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };
  /* Read through a call, not the bare binding: `close()` can run while the mount is awaiting the
     element, and a direct `closed` test after that `await` would be narrowed to the value the test
     before it saw. */
  const isClosed = (): boolean => closed;

  const scope: GithubAuthScope = reactive<GithubAuthScope>({
    cancel: () => {
      options.onCancel();
    },
    closed: finish,
    userCode: options.userCode,
    verificationUri: options.verificationUri,
  });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("github-auth", scope, slot).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `github-auth.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (isClosed()) {
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
        close(element);
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
