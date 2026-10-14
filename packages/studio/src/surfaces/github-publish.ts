/// <reference lib="dom" />
/**
 * The Create GitHub Repository surface: the name, description and visibility the flow needs before
 * it can create anything, as a `jx-dialog` mounted into the dialog layer.
 *
 * This is the adapter. `github/github-publish.ts` keeps the flow — the token, the three requests,
 * the activity and every failure they can raise — and this module owns nothing but what the reader
 * has typed so far and the three answers the dialog can give. That split is the conversion: the
 * template it replaced held its three controls in `ref()` callbacks and read `.value` off them at
 * the moment confirm fired, which is a surface whose state exists only in the DOM. The scope holds
 * it now, so the flow is handed a record rather than a snapshot of three elements.
 *
 * **Each setter writes what the control now holds, first.** Nothing here refuses a value today, but
 * a binding only writes when the scope CHANGES: an adapter that decided a value without announcing
 * the raw one first would leave the field showing text the scope does not have, silently
 * (studio-ui-guidelines.md §9.3, "a controlled input is authoritative only while the scope value
 * moves"). The echo is one line per setter and it is what makes a later refusal possible at all.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import githubPublishDoc from "./github-publish.json";
import type { DialogLayerHandle, SurfaceHandle } from "../ui/surface";

registerSurface("github-publish", githubPublishDoc);

/**
 * What the dialog collects.
 *
 * It lives beside the dialog rather than beside the flow, because the dialog is what decides the
 * shape: `github/github-publish.ts` re-exports the name it has always exported.
 */
export interface RepoOptions {
  name: string;
  description: string;
  isPrivate: boolean;
}

export interface GithubPublishSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer. */
  layer: HTMLElement;
  /** What the name field starts with: the project's own name. */
  name: string;
  /** The reader answered. The flow decides what an empty name falls back to. */
  onConfirm: (values: RepoOptions) => void;
  /** The reader declined — the Cancel button, or Escape. */
  onCancel: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

interface GithubPublishScope {
  name: string;
  description: string;
  isPrivate: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setPrivate: (value: boolean) => void;
  confirm: () => void;
  cancel: () => void;
  closed: () => void;
}

/** Open the dialog. The handle's `ready` resolves once it is showing. */
export function openGithubPublishSurface(options: GithubPublishSurfaceOptions): DialogLayerHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "github-publish"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close` event, and `close()`
   * on a dialog that never got as far as being shown.
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

  const scope: GithubPublishScope = reactive<GithubPublishScope>({
    cancel: () => {
      options.onCancel();
    },
    closed: finish,
    confirm: () => {
      options.onConfirm({
        description: scope.description,
        isPrivate: scope.isPrivate,
        name: scope.name,
      });
    },
    description: "",
    isPrivate: true,
    name: options.name,
    setDescription: (value) => {
      scope.description = value;
    },
    setName: (value) => {
      scope.name = value;
    },
    setPrivate: (value) => {
      scope.isPrivate = value;
    },
  });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("github-publish", scope, slot).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `github-publish.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    /* `whenReady` before `showModal`: the mount resolving means the DOCUMENT rendered, while the
       element's own template is one `connectedCallback` later, and `showModal` in between finds no
       `<dialog>` to open — the body is all there, correctly styled, and never shows. Shared with
       `openDialogSurface` and `openAboutSurface` rather than reimplemented. */
    await whenReady(element);
    if (isClosed()) {
      return element;
    }
    showModal(element);
    return element;
  });

  const handle: DialogLayerHandle = {
    close() {
      if (closed) {
        return;
      }
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
  return handle;
}
