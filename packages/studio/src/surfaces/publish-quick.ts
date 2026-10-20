/// <reference lib="dom" />
/**
 * Quick publish, as a mounted dialog (studio.md §22.8).
 *
 * This is the adapter: the reactive scope `publish-quick.json` reads, and the mount that lives in
 * the dialog layer until the flow (`publish/publish-quick.ts`) takes it down. The dialog is a
 * `jx-dialog` opened with `showModal()`, so the platform owns modality, Escape and focus
 * restoration (`studio-ui-guidelines.md` §8.7); nothing here draws a backdrop.
 *
 * **Await the ELEMENT, not just the mount**, for the reason `surfaces/add-new.ts` gives: the
 * dialog's own template is one `connectedCallback` after the document renders.
 *
 * @docs studio/publish
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import publishQuickDoc from "./publish-quick.json";
import type { SurfaceHandle } from "../ui/surface";
import type { DestinationChoice } from "../publish/publish-changes";
import type { PublishDestination } from "../publish/publish-ids";

registerSurface("publish-quick", publishQuickDoc);

/** One changed file in the short list. */
export interface QuickChangeRow {
  key: string;
  path: string;
  /** NEW, EDIT, DELETED, RENAMED: a word, not git's letter. */
  tag: string;
  name: string;
  dir: string;
  status: string;
}

/** Everything the dialog draws. */
export interface PublishQuickView {
  /** "5 changes ready". */
  countLine: string;
  listState: "listed" | "empty";
  rows: QuickChangeRow[];
  hasMore: boolean;
  /** "+ 2 more". */
  more: string;
  destination: PublishDestination;
  destinations: DestinationChoice[];
  summary: string;
  /** `done` when every check passed, `open` while any is not. */
  checksState: "done" | "open";
  /**
   * The kit icon beside the checks line: `check` when every check passed, `warning-circle` while
   * any is open.
   */
  checksIcon: string;
  checksLine: string;
  blocked: boolean;
  hasBlocker: boolean;
  blocker: string;
}

/** What a control asks the flow to do. */
export interface PublishQuickActions {
  confirm: () => void;
  reviewAll: () => void;
  pickDestination: (value: string) => void;
  editSummary: (value: string) => void;
  /** The dialog closed, for any reason the platform owns as well as the flow's own `close`. */
  closed: () => void;
}

export interface PublishQuickSurfaceOptions {
  /** Where the dialog is mounted: the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  view: PublishQuickView;
  actions: PublishQuickActions;
}

export interface PublishQuickSurfaceHandle {
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  update: (view: PublishQuickView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

type PublishQuickScope = PublishQuickView & PublishQuickActions;

/** Open the dialog. The handle's `ready` resolves once it is showing. */
export function openPublishQuickSurface(
  options: PublishQuickSurfaceOptions,
): PublishQuickSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content (`surfaces/add-new.ts` says why a modal
     dialog in a slot that skipped this hit-tests to nothing). */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "publish-quick"));
  options.layer.append(slot);

  let closed = false;
  /** Say it is over, once: the platform's own `close` and `close()` may each be first. */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.actions.closed();
  };
  /* A function, not the flag: TypeScript narrows a `let` across the awaits below as if nothing
     could have closed the dialog while the mount was in flight. */
  const isClosed = (): boolean => closed;
  const { actions } = options;
  const scope = reactive<PublishQuickScope>({
    ...options.view,
    closed: finish,
    confirm: actions.confirm,
    editSummary: (value: string) => {
      /* What the control holds, first and unconditionally: a binding only writes when the scope
         CHANGES (`studio-ui-guidelines.md` §9.3). */
      scope.summary = value;
      actions.editSummary(value);
    },
    pickDestination: actions.pickDestination,
    reviewAll: actions.reviewAll,
  });

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("publish-quick", scope, slot).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `publish-quick.json`'s root definition is a `jx-dialog` element, so the runtime
       mounts an HTMLElement; a `Text` root only comes from a document whose root is a string. */
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
