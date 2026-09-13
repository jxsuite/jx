/// <reference lib="dom" />
/**
 * The repository picker as a mounted document.
 *
 * `new-project/add-repo-modal.ts` is the flow — it asks the platform which repositories the account
 * link reaches, decides which of them Open Project may offer, adopts the one that was chosen and
 * resolves the promise its two entry points return — and this is the surface it draws into: the
 * reactive scope the document reads, the one discriminant it branches on, and the mount that lives
 * in the dialog layer until the flow takes it down.
 *
 * **The flow states facts; the surface derives what the document branches on.** Which repositories
 * are visible, what each row says and whether the listing has landed are the flow's; whether that
 * adds up to a list, a spinner or one of four different absences is {@link derive}'s, so neither
 * the flow nor the document has to know that "nothing matched your filter" and "the App cannot see
 * anything" are two sentences with two different remedies.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` and `surfaces/cf-account-picker.ts` rather than reimplemented.
 *
 * @docs studio/projects/create
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import addRepoDoc from "./add-repo.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("add-repo", addRepoDoc as unknown as JxDocument);

/** One repository, as the list draws it. Every field is already a string or a flag. */
export interface AddRepoRow {
  /** `owner/name`, which is the row's key, its title and the text it leads with. */
  fullName: string;
  /** The branch and permission line beside the name. */
  meta: string;
  /** The repository already carries the Jx topic, so it gets the badge. */
  isJx: boolean;
  isPrivate: boolean;
  /** This row is the one being adopted, so it says so. */
  importing: boolean;
  /** Any adoption is in flight, so no row may start another. */
  disabled: boolean;
}

/** One way to widen what the GitHub App can reach. */
export interface AddRepoAccessLink {
  label: string;
  url: string;
  title: string;
}

/**
 * Why the list is empty, when it is.
 *
 * Four, not one, because only two of them are the reader's to fix and each is fixed differently: a
 * filter is cleared, write access is asked for, and an App that was never installed is installed.
 */
export type AddRepoEmptyState = "filter" | "write" | "install" | "none";

/** What the flow knows. Every one of these may change while the dialog is up. */
export interface AddRepoView {
  /** The headline, which is also the dialog's accessible name: the two flows name themselves. */
  title: string;
  /** The filter text, held by the flow so a repaint cannot lose what the reader typed. */
  filter: string;
  /** The listing is in flight. Its own state, because "not yet asked" is not "reaches nothing". */
  loading: boolean;
  /** The repositories to draw, already filtered and ordered. */
  rows: AddRepoRow[];
  /** Which absence to say, read only when `rows` is empty and the listing has landed. */
  emptyState: AddRepoEmptyState;
  /** Where the GitHub App is installed from, for the sentence that offers to install it. */
  installUrl: string;
  /** The last refusal — a listing that failed, or a repository the backend would not adopt. */
  failure: string;
  /** The access footer's links; empty for a platform with no account status to widen. */
  access: AddRepoAccessLink[];
}

export interface AddRepoSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything has landed: the flow's own view, so there is one builder of it. */
  view: AddRepoView;
  /** The reader typed in the filter field. The flow decides what it hides. */
  onFilter: (value: string) => void;
  /** A row was pressed: this repository, please. */
  onChoose: (fullName: string) => void;
  /** Read the listing again, after access was granted in another tab. */
  onRefresh: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface AddRepoSurfaceHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: AddRepoView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on, and the flags it reads. Derived, never handed in. */
interface AddRepoFlags {
  /**
   * Which body to draw.
   *
   * Six, because a spinner, a list and four absences are six different things to say and only one
   * of them is fixed by looking again.
   */
  listState: "loading" | "listed" | "empty-filter" | "empty-write" | "empty-install" | "empty-none";
  /** Whether a refusal sits above the list that survived it. */
  hasFailure: boolean;
  /** Whether there is anything to offer in the access footer. */
  hasAccess: boolean;
  /** Refresh cannot re-ask while the answer is still coming, or while a row is being adopted. */
  refreshDisabled: boolean;
}

interface AddRepoScope extends Record<string, unknown>, AddRepoView, AddRepoFlags {
  setFilter: (value: string) => void;
  choose: (fullName: string) => void;
  refresh: () => void;
  closed: () => void;
}

/** The view plus the flags the document renders from. */
function derive(view: AddRepoView): AddRepoView & AddRepoFlags {
  const importing = view.rows.some((row) => row.importing);
  return {
    ...view,
    hasAccess: view.access.length > 0,
    hasFailure: view.failure !== "",
    listState: view.loading
      ? "loading"
      : view.rows.length > 0
        ? "listed"
        : (`empty-${view.emptyState}` as AddRepoFlags["listState"]),
    refreshDisabled: view.loading || importing,
  };
}

/** Open the picker. The handle's `ready` resolves once the dialog is showing. */
export function openAddRepoSurface(options: AddRepoSurfaceOptions): AddRepoSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "add-repo"));
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
    ...derive(options.view),
    choose: (fullName: string) => {
      options.onChoose(fullName);
    },
    closed: finish,
    refresh: () => {
      options.onRefresh();
    },
    setFilter: (value: string) => {
      /* What the control holds, first and unconditionally. A binding only writes when the scope
         CHANGES, so a surface that decided a value without announcing the raw one would leave the
         field showing text the scope does not have (§9.3). Nothing refuses a filter today; the echo
         is what makes a refusal possible at all. */
      scope.filter = value;
      options.onFilter(value);
    },
  }) as AddRepoScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("add-repo", scope, slot).then(async (surface) => {
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
    update(view) {
      Object.assign(scope, derive(view));
    },
  };
}
