/// <reference lib="dom" />
/**
 * The About surface: the app's version, its links, and the `@jxsuite/*` versions it resolved.
 *
 * The adapter owns the state machine — what is loaded, what failed — and the document renders it.
 * That is the whole shape of the conversion this replaced: `about-modal.ts` held module-level
 * `_packages` and `_appInfo` and re-rendered the entire template whenever either landed. They are a
 * reactive record now, so the list appears when it arrives and nothing else is touched.
 *
 * The platform is asked for both, and NEITHER is required. `listPackages` failing means the app
 * still knows its own version, and `getAppInfo` is optional in the interface — only the desktop
 * implements it — so a missing method is an absent row rather than a caught error.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import aboutDoc from "./about.json";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("about", aboutDoc);

/** One external link in the dialog's link row. */
export interface AboutLink {
  href: string;
  label: string;
}

export interface AboutSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer. */
  layer: HTMLElement;
  headline: string;
  rows: SurfaceOption[];
  links: AboutLink[];
  /** The dialog closed, for any reason the platform owns as well as the Close button. */
  onClosed: () => void;
}

/** What the flow may change once the dialog is up: the package list, when it arrives. */
export interface AboutSurfacePatch {
  rows?: SurfaceOption[];
  packages?: { name: string; version: string }[];
}

export interface AboutSurfaceHandle {
  host: HTMLElement;
  ready: Promise<HTMLElement>;
  update: (patch: AboutSurfacePatch) => void;
  close: () => void;
}

interface AboutScope {
  headline: string;
  rows: SurfaceOption[];
  links: AboutLink[];
  packages: { name: string; version: string }[];
  /**
   * Which of the three package states to draw, as a `$switch` discriminant.
   *
   * Three, not a boolean: "still loading" and "the platform reported none" are different things to
   * say, and a list that renders empty for both tells a reader the app has no packages when it may
   * simply not have asked yet.
   */
  packagesState: "loading" | "empty" | "listed";
  close: () => void;
  closed: () => void;
}

/** Open the About dialog. The handle's `ready` resolves once it is showing. */
export function openAboutSurface(options: AboutSurfaceOptions): AboutSurfaceHandle {
  const slot = document.createElement("div");
  // The layer is `pointer-events: none` so a click passes through it when nothing is up.
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "about"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close` event, and `close()`
   * on a dialog that never got as far as being shown. Without one guard a caller that opens, closes
   * and reopens gets its `onClosed` after the SECOND open — clearing a handle that is now live.
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
  const scope: AboutScope = reactive<AboutScope>({
    close: () => handle.close(),
    closed: finish,
    headline: options.headline,
    links: options.links,
    packages: [],
    packagesState: "loading",
    rows: options.rows,
  });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("about", scope, slot).then(async (surface) => {
    mounted = surface;
    // SAFETY: `about.json`'s root definition carries `tagName: "jx-dialog"`, so the runtime mounts an
    // HTMLElement; a `Text` root only comes from a document whose root is a bare string.
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    /* `whenReady` before `showModal`, and it is not belt and braces. The mount resolving means the
       DOCUMENT rendered — the element exists and carries this surface's children — while the
       element's OWN template is one `connectedCallback` later. Calling `showModal` in between finds
       no `<dialog>` to open: the body is all there, correctly styled, and never shows. Shared with
       `openDialogSurface` rather than reimplemented, because both surfaces are `jx-dialog`s and
       there is one answer to when one of those is ready. */
    await whenReady(element);
    if (isClosed()) {
      return element;
    }
    showModal(element);
    return element;
  });

  const handle: AboutSurfaceHandle = {
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
    update(patch) {
      if (patch.rows !== undefined) {
        scope.rows = patch.rows;
      }
      if (patch.packages !== undefined) {
        scope.packages = patch.packages;
        scope.packagesState = patch.packages.length === 0 ? "empty" : "listed";
      }
    },
  };
  return handle;
}
