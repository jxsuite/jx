/// <reference lib="dom" />
/**
 * The repository picker as a mounted document.
 *
 * `new-project/add-repo-modal.ts` is the flow — it asks the platform which repositories the account
 * link reaches, which projects a chosen repository holds, adopts the one that was confirmed and
 * resolves the promise its two entry points return — and this is the surface it draws into: the
 * reactive scope the document reads, the discriminants it branches on, and the mount that lives in
 * the dialog layer until the flow takes it down.
 *
 * **Two fields, each with the list it drives.** The filter drives the repository list and the
 * project-folder field drives the list of folders that repository holds a `project.json` in. A
 * `jx-listbox` never takes focus (ui.md §5.3), so a list a reader can only click is a list a
 * keyboard cannot reach; pairing each list with a field is what makes both of them operable from
 * the keys — the palette's shape, twice. The folder field is also the answer when a list cannot be:
 * a repository too large to scan, or a platform with no way to scan one.
 *
 * **The flow states facts; the surface derives what the document branches on.** Which repositories
 * are visible, which one is chosen and which folders it holds are the flow's; whether that adds up
 * to a list, a spinner or one of four different absences, which row id each listbox is told is
 * active, and whether the dialog can be answered yet are {@link derive}'s.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` and `surfaces/cf-account-picker.ts` rather than reimplemented.
 *
 * @docs studio/interface/welcome-screen
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { focusField } from "@jxsuite/ui/behaviors/textfield";
import { whenReady } from "./dialog";
import addRepoDoc from "./add-repo.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("add-repo", addRepoDoc as unknown as JxDocument);

/** One repository, as the list draws it. Every field is already a string or a flag. */
export interface AddRepoRow {
  /** `owner/name`, which is the row's key, its value, its title and the text it leads with. */
  fullName: string;
  /** The default branch, beside the name. */
  meta: string;
  /** The repository already carries the Jx topic, so it gets the badge. */
  isJx: boolean;
  isPrivate: boolean;
}

/** One folder of the chosen repository that holds a `project.json`. */
export interface AddRepoLocation {
  /** The folder, repository-relative and canonical; `""` is the root. The row's value. */
  dir: string;
  /** What the row says: the project's own name, else the folder's. */
  label: string;
  /** Where it is: `/` for the root, `sites/blog/` for a folder. */
  path: string;
}

/** One way to widen what the GitHub App can reach. */
export interface AddRepoAccessLink {
  label: string;
  url: string;
  title: string;
}

/** One entry of the account filter. `""` is every account. */
export interface AddRepoOwner {
  value: string;
  label: string;
}

/**
 * Why the repository list is empty, when it is.
 *
 * Four, not one, because only two of them are the reader's to fix and each is fixed differently: a
 * filter is cleared, write access is asked for, and an App that was never installed is installed.
 */
export type AddRepoEmptyState = "filter" | "write" | "install" | "none";

/**
 * What the detail pane knows about the chosen repository's projects.
 *
 * - `none`: no repository is chosen yet.
 * - `loading`: the platform is looking.
 * - `listed`: it found at least one folder with a `project.json`.
 * - `empty`: it looked and found none.
 * - `unlisted`: the platform cannot look, so the folder is the reader's to name.
 * - `failed`: the look itself failed; the folder field still works.
 */
export type AddRepoDetailState = "none" | "loading" | "listed" | "empty" | "unlisted" | "failed";

/** What the flow knows. Every one of these may change while the dialog is up. */
export interface AddRepoView {
  /** The headline, which is also the dialog's accessible name: the two flows name themselves. */
  title: string;
  /** The primary answer: Open or Add, and the progressive form while an adoption runs. */
  confirmLabel: string;
  /** The filter text, held by the flow so a repaint cannot lose what the reader typed. */
  filter: string;
  /** The account the list is narrowed to; `""` is every account. */
  owner: string;
  /** The account filter's entries, "All accounts" first; empty hides it (one account, or none). */
  owners: AddRepoOwner[];
  /** The listing is in flight. Its own state, because "not yet asked" is not "reaches nothing". */
  loading: boolean;
  /** The repositories to draw, already filtered and ordered. */
  rows: AddRepoRow[];
  /** The chosen repository's full name; `""` when none is. It may be filtered out of `rows`. */
  selected: string;
  /** Which absence to say, read only when `rows` is empty and the listing has landed. */
  emptyState: AddRepoEmptyState;
  /** Where the GitHub App is installed from, for the sentence that offers to install it. */
  installUrl: string;
  /** The last refusal — a listing that failed, or a repository the backend would not adopt. */
  failure: string;
  /** The access footer's links; empty for a platform with no account status to widen. */
  access: AddRepoAccessLink[];
  /** The chosen repository's projects, as far as the platform has looked. */
  detailState: AddRepoDetailState;
  /** The chosen repository's full name and the line beside it, for the pane's heading. */
  detailName: string;
  detailMeta: string;
  /** The folders the chosen repository holds a `project.json` in. */
  locations: AddRepoLocation[];
  /** The folder field's text: the folder the dialog will open, `""` for the repository root. */
  folder: string;
  /**
   * The same folder in its canonical spelling (`utils/project-dir.ts`), which is what a folder row
   * is matched against: `sites/blog/` typed by hand is the `sites/blog` row.
   */
  chosenFolder: string;
  /** Why the folder field's text cannot be opened; `""` when it can. */
  folderError: string;
  /** The sentence under the folder field. */
  folderHelp: string;
  /** What confirming will do, said in one line; `""` when nothing is chosen. */
  summary: string;
  /** The dialog can be answered: a repository is chosen, its folder is usable, nothing is running. */
  canConfirm: boolean;
  /** An adoption is in flight. */
  busy: boolean;
}

export interface AddRepoSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything has landed: the flow's own view, so there is one builder of it. */
  view: AddRepoView;
  /** The reader typed in the filter field. The flow decides what it hides. */
  onFilter: (value: string) => void;
  /** The reader narrowed the list to one account, or widened it to all of them (`""`). */
  onOwner: (value: string) => void;
  /** A repository row was chosen, by pointer or by the filter's arrows. */
  onSelect: (fullName: string) => void;
  /** The caret moved by `delta` rows through the visible repositories. */
  onMove: (delta: number) => void;
  /** The reader typed in the folder field. */
  onFolder: (value: string) => void;
  /** A folder row was chosen. */
  onLocation: (dir: string) => void;
  /** The caret moved by `delta` rows through the chosen repository's folders. */
  onMoveLocation: (delta: number) => void;
  /** Open what is chosen: the confirm button, Enter in either field, or a double-click on a row. */
  onConfirm: () => void;
  /** A repository row was double-clicked: choose it and open it as soon as that is unambiguous. */
  onOpenRepo: (fullName: string) => void;
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

/** A repository row with the id its listbox addresses it by. */
interface DrawnRow extends AddRepoRow {
  id: string;
}

/** A folder row with the id its listbox addresses it by. */
interface DrawnLocation extends AddRepoLocation {
  id: string;
}

/** What the document discriminates on, and the flags it reads. Derived, never handed in. */
interface AddRepoFlags {
  /**
   * Which body the repository pane draws.
   *
   * Six, because a spinner, a list and four absences are six different things to say and only one
   * of them is fixed by looking again.
   */
  listState: "loading" | "listed" | "empty-filter" | "empty-write" | "empty-install" | "empty-none";
  rows: DrawnRow[];
  locations: DrawnLocation[];
  /** The id each listbox is told is active: one string per list (ui.md §5.3); `""` for none. */
  activeRepoId: string;
  activeLocationId: string;
  /** Whether there is more than one account to narrow by. */
  hasOwners: boolean;
  /** Whether a refusal sits above the panes that survived it. */
  hasFailure: boolean;
  /** Whether there is anything to offer in the access footer. */
  hasAccess: boolean;
  /** Whether a repository is chosen, so the folder field has something to name a folder of. */
  hasDetail: boolean;
  /** Whether the folder field's text is refused. */
  folderInvalid: boolean;
  /** Refresh cannot re-ask while the answer is still coming, or while an adoption runs. */
  refreshDisabled: boolean;
  /** The confirm button's state, the inverse of `canConfirm`. */
  confirmDisabled: boolean;
}

interface AddRepoScope
  extends Record<string, unknown>, Omit<AddRepoView, "rows" | "locations">, AddRepoFlags {
  setFilter: (value: string) => void;
  setOwner: (value: string) => void;
  select: (fullName: string) => void;
  move: (delta: number) => void;
  setFolder: (value: string) => void;
  pickLocation: (dir: string) => void;
  moveLocation: (delta: number) => void;
  confirm: () => void;
  openRepo: (fullName: string) => void;
  refresh: () => void;
  closed: () => void;
}

/** The id the repository list addresses row `index` by. */
export function repoRowId(index: number): string {
  return `add-repo-repo-${index}`;
}

/** The id the folder list addresses row `index` by. */
export function locationRowId(index: number): string {
  return `add-repo-location-${index}`;
}

/** The view plus the flags the document renders from. */
function derive(view: AddRepoView): Omit<AddRepoView, "rows" | "locations"> & AddRepoFlags {
  const rows = view.rows.map((row, index) => ({ ...row, id: repoRowId(index) }));
  const locations = view.locations.map((location, index) => ({
    ...location,
    id: locationRowId(index),
  }));
  const activeRow = rows.find((row) => row.fullName === view.selected);
  const activeLocation =
    view.folderError === ""
      ? locations.find((location) => location.dir === view.chosenFolder)
      : undefined;
  return {
    ...view,
    activeLocationId: activeLocation?.id ?? "",
    activeRepoId: activeRow?.id ?? "",
    confirmDisabled: !view.canConfirm,
    folderInvalid: view.folderError !== "",
    hasAccess: view.access.length > 0,
    hasDetail: view.detailState !== "none",
    hasFailure: view.failure !== "",
    hasOwners: view.owners.length > 0,
    listState: view.loading
      ? "loading"
      : rows.length > 0
        ? "listed"
        : (`empty-${view.emptyState}` as AddRepoFlags["listState"]),
    locations,
    refreshDisabled: view.loading || view.busy,
    rows,
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
    closed: finish,
    confirm: () => {
      options.onConfirm();
    },
    move: (delta: number) => {
      options.onMove(delta);
    },
    moveLocation: (delta: number) => {
      options.onMoveLocation(delta);
    },
    openRepo: (fullName: string) => {
      options.onOpenRepo(fullName);
    },
    pickLocation: (dir: string) => {
      options.onLocation(dir);
    },
    refresh: () => {
      options.onRefresh();
    },
    select: (fullName: string) => {
      options.onSelect(fullName);
    },
    setFilter: (value: string) => {
      /* What the control holds, first and unconditionally. A binding only writes when the scope
         CHANGES, so a surface that decided a value without announcing the raw one would leave the
         field showing text the scope does not have (`studio-ui-guidelines.md` §9.3). */
      scope.filter = value;
      options.onFilter(value);
    },
    setFolder: (value: string) => {
      // The same echo as the filter's, for the same reason.
      scope.folder = value;
      options.onFolder(value);
    },
    setOwner: (value: string) => {
      scope.owner = value;
      options.onOwner(value);
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
    /* The body claims focus (studio-ui-guidelines.md §8.7): the filter is where every way of
       choosing starts, and the confirm button that would otherwise take it is disabled until a
       repository is chosen, which leaves the platform nothing to land on. */
    const filter = element.querySelector<HTMLElement>('[part="filter"]');
    if (filter) {
      focusField(filter);
    }
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
