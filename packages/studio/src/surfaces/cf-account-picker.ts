/// <reference lib="dom" />
/**
 * The Cloudflare account picker as a mounted document.
 *
 * `ui/cf-account-picker.ts` is the flow — it asks the PAL which accounts the grant reaches, commits
 * the one that was picked, announces the credential change and decides what the promise resolves to
 * — and this is the surface it draws into: the reactive scope the document reads, the flags it
 * discriminates on, and the mount that lives in the dialog layer until the flow takes it down.
 *
 * **The flow states four facts; the surface derives everything it draws from them.** Whether the
 * listing is still in flight, what came back, the last refusal, and which id is being committed.
 * From those the document gets one discriminant and a row shape, so nothing here or in the document
 * has to know that an empty list with a reason and an empty list without one are two different
 * sentences — {@link derive} is the only place that judgement is spelled.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` and `surfaces/about.ts` rather than reimplemented, because all
 * three are `jx-dialog`s and there is one answer to when one of those is ready.
 *
 * @docs studio/ai
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import pickerDoc from "./cf-account-picker.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("cf-account-picker", pickerDoc as unknown as JxDocument);

/** One account the grant reaches, as the list draws it. */
export interface CfAccountPickerRow {
  id: string;
  name: string;
}

/** What the flow knows. Every one of these may change while the dialog is up. */
export interface CfAccountPickerView {
  /** The listing is in flight. Its own state, because "not yet asked" is not "reaches nothing". */
  loading: boolean;
  accounts: CfAccountPickerRow[];
  /** The last refusal — a listing that failed, or an account the broker would not accept. */
  failure: string;
  /** The id being committed, so its own row can say so rather than the whole list going grey. */
  choosing: string;
}

export interface CfAccountPickerOptions {
  /** Where the dialog is mounted — the dialog layer. */
  layer: HTMLElement;
  /** A row's own button: this account, please. */
  onChoose: (id: string) => void;
  /** The retry the failed-listing state offers. */
  onRetry: () => void;
  /** The dialog closed, for any reason the platform owns as well as the Cancel button. */
  onClosed: () => void;
}

export interface CfAccountPickerHandle {
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  update: (patch: Partial<CfAccountPickerView>) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on, and the rows it maps. Derived, never handed in. */
interface CfAccountPickerFlags {
  /**
   * Which of the four bodies to draw.
   *
   * Four, not a list and a spinner: "still asking", "Cloudflare could not be reached", "this login
   * genuinely reaches nothing" and "here they are" are four different things to say, and only one
   * of them is fixed by asking again — which is why the retry lives in exactly one branch.
   */
  listState: "loading" | "failed" | "empty" | "listed";
  /** The failed-listing sentence, reason and all. */
  failureMessage: string;
  /** Whether a refusal sits above a list that survived it. */
  hasFailure: boolean;
  rows: CfAccountPickerScopeRow[];
}

/** One row, as the document reads it: what it says, and whether it may be pressed. */
interface CfAccountPickerScopeRow extends CfAccountPickerRow {
  /** This row's own button text — "Selecting…" while it is the one being committed. */
  label: string;
  /** Every row is disabled while any commit is in flight: one answer at a time. */
  busy: boolean;
}

interface CfAccountPickerScope
  extends Record<string, unknown>, CfAccountPickerView, CfAccountPickerFlags {
  choose: (id: string) => void;
  retry: () => void;
  closed: () => void;
}

/** The view plus the flags and rows the document renders from. */
function derive(view: CfAccountPickerView): CfAccountPickerView & CfAccountPickerFlags {
  const busy = view.choosing !== "";
  return {
    ...view,
    failureMessage: `Cloudflare could not be reached: ${view.failure}`,
    hasFailure: view.failure !== "",
    listState: view.loading
      ? "loading"
      : view.accounts.length > 0
        ? "listed"
        : view.failure !== ""
          ? "failed"
          : "empty",
    rows: view.accounts.map((account) => ({
      busy,
      id: account.id,
      label: view.choosing === account.id ? "Selecting…" : "Use this account",
      name: account.name,
    })),
  };
}

/** Open the picker. The handle's `ready` resolves once the dialog is showing. */
export function openCfAccountPickerSurface(options: CfAccountPickerOptions): CfAccountPickerHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "cf-accounts"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive({
    ...derive({ accounts: [], choosing: "", failure: "", loading: true }),
    choose: (id: string) => {
      options.onChoose(id);
    },
    closed: finish,
    retry: () => {
      options.onRetry();
    },
  }) as CfAccountPickerScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("cf-account-picker", scope, slot).then(async (surface) => {
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

  const handle: CfAccountPickerHandle = {
    close() {
      if (closed) {
        return;
      }
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      mounted?.dispose();
      mounted = null;
      slot.remove();
      /* Last, and it usually finds the work already done: `closeDialog` raises the platform's own
         `close`, which the document hands straight back as `closed`. Saying so twice is what the
         guard in `finish` is for; saying it never is what a caller closing this itself would get. */
      finish();
    },
    host: slot,
    ready,
    update(patch) {
      Object.assign(
        scope,
        derive({
          accounts: patch.accounts ?? scope.accounts,
          choosing: patch.choosing ?? scope.choosing,
          failure: patch.failure ?? scope.failure,
          loading: patch.loading ?? scope.loading,
        }),
      );
    },
  };
  return handle;
}
