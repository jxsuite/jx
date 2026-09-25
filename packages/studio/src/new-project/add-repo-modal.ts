/// <reference lib="dom" />
/**
 * Repository picker flow — a filterable picker over `platform.listRepos` (every repo the platform's
 * account link can reach, personal and organization). Two modes share the dialog:
 *
 * - "add" (Add Existing Repository): the unfiltered adoption path.
 * - "open" (Open Project on `openProjectPicker: "repo-list"` platforms): only write-access
 *   repositories, Jx-tagged ones first.
 *
 * Choosing a repo runs `platform.importProject`, which adopts it as a Jx project (probes
 * project.json, tags + catalogues it) and resolves with the catalogue root key; the caller opens it
 * through the same path as a recent project. Repos without a project.json fail with the backend's
 * structured message, shown inline.
 *
 * The list only ever shows what the Jx Suite GitHub App can reach, so the dialog also carries an
 * access footer: per-installation links to widen the App's repository selection, a link to install
 * it on another account, and Refresh — the user grants access in a GitHub tab, comes back, and
 * reloads the list without losing the dialog.
 *
 * **The dialog is a document.** `surfaces/add-repo.json` draws it and `surfaces/add-repo.ts` mounts
 * it; this module keeps the listing, the ordering, the adoption and the promise. What it used to be
 * is worth recording, because it is the shape every converted surface starts from: a whole template
 * re-rendered from module state on every keystroke, inside a fixed card that painted its own panel
 * beside an `<sp-underlay>` and needed `z-index: 1000` to climb back out from under its own scrim.
 * A modal `<dialog>` is in the top layer by construction, so none of that stacking is left to get
 * wrong, and a filter keystroke now moves one binding rather than rebuilding every row.
 *
 * **`closeAddRepoModal` went with it.** It existed because the lit card had to answer its own
 * Escape key, its own underlay click and its own close button, and all three of those belong to the
 * platform now: every way out raises the dialog's `cancel`, which arrives here as `onClosed`. A
 * closer nothing in the app called was left over from drawing the box by hand.
 */

import { errorMessage } from "@jxsuite/schema/parse";
import {
  getAccountStatus,
  getRepoAccessLinks,
  hydrateAccountStatus,
  needsAppInstall,
} from "../account-status";
import { getPlatform } from "../platform";
import { layerHost } from "../ui/layers";
import { openAddRepoSurface } from "../surfaces/add-repo";
import type { AddRepoRow, AddRepoSurfaceHandle, AddRepoView } from "../surfaces/add-repo";
import type { RepoInfo } from "../types";

type PickerMode = "add" | "open";

let _handle: AddRepoSurfaceHandle | null = null;
let _mode: PickerMode = "add";
let _repos: RepoInfo[] | null = null;
let _filter = "";
let _error = "";
/** FullName of the repo currently importing ("" = idle). */
let _importing = "";
let _resolve: ((result: { root: string } | null) => void) | null = null;

/** True when the active platform can browse + adopt existing repositories. */
export function platformSupportsAddRepo(): boolean {
  const platform = getPlatform();
  return typeof platform.listRepos === "function" && typeof platform.importProject === "function";
}

/** True when the active platform routes Open Project through this repo picker. */
export function platformUsesRepoPicker(): boolean {
  return getPlatform().openProjectPicker === "repo-list" && platformSupportsAddRepo();
}

/**
 * Open the adoption picker. Resolves with the imported project's catalogue root key, or null when
 * cancelled.
 */
export function openAddRepoModal(): Promise<{ root: string } | null> {
  return openPicker("add");
}

/** Open Project as a repo picker (write-access repositories only). Null when cancelled. */
export function openProjectPickerModal(): Promise<{ root: string } | null> {
  return openPicker("open");
}

function openPicker(mode: PickerMode): Promise<{ root: string } | null> {
  if (_handle) {
    return Promise.resolve(null);
  }
  _mode = mode;
  _repos = null;
  _filter = "";
  _error = "";
  _importing = "";

  return new Promise((resolve) => {
    _resolve = resolve;
    _handle = openAddRepoSurface({
      layer: layerHost("dialog"),
      onChoose: (fullName) => {
        void chooseRepo(fullName);
      },
      /* Escape, the Cancel button and a programmatic close all arrive here, and all of them mean
         the same thing: nothing was adopted. A native `<dialog>` has already closed by the time it
         says so, which is why this settles rather than deciding whether to allow it — an adoption
         still in flight is dropped on the way out (`chooseRepo` finds the picker gone), exactly as
         a listing that lands after a dismissal is. */
      onClosed: () => {
        settle(null);
      },
      onFilter: (value) => {
        _filter = value;
        redraw();
      },
      onRefresh: () => {
        loadRepos();
      },
      view: viewOf(),
    });
    loadRepos();
  });
}

/**
 * (Re)load the repository list and the App's installation coverage. Both feed the same question —
 * "which repositories can Jx see?" — so a refresh after a permission change re-reads both.
 */
function loadRepos(): void {
  _repos = null;
  _error = "";
  // Paints the loading state on a refresh; a no-op on open, where the surface opens on this view.
  redraw();

  void hydrateAccountStatus().then(redraw);

  void getPlatform()
    .listRepos?.()
    .then((repos) => {
      _repos = repos;
    })
    .catch((error: unknown) => {
      _repos = [];
      _error = errorMessage(error);
    })
    .finally(() => {
      redraw();
    });
}

/** Push the current state at the surface — a no-op once the dialog is gone. */
function redraw(): void {
  _handle?.update(viewOf());
}

/**
 * Resolve the promise once, and take the dialog down with it.
 *
 * The promise is resolved BEFORE the dialog is closed, and the order is load-bearing rather than
 * tidy: closing raises the platform's own `close`, which arrives back here as a dismissal, so a
 * `settle` that closed first would resolve an adopted project's promise with `null` a frame after
 * the adoption succeeded. Clearing `_handle` and `_resolve` first is what makes that second pass a
 * no-op.
 */
function settle(result: { root: string } | null): void {
  const handle = _handle;
  const resolve = _resolve;
  _handle = null;
  _resolve = null;
  _importing = "";
  resolve?.(result);
  handle?.close();
}

async function chooseRepo(fullName: string) {
  if (_importing) {
    return;
  }
  const repo = (_repos ?? []).find((candidate) => candidate.fullName === fullName);
  if (!repo) {
    return;
  }
  _importing = repo.fullName;
  _error = "";
  redraw();
  try {
    const imported = await getPlatform().importProject?.({ name: repo.name, owner: repo.owner });
    if (imported) {
      settle(imported);
      return;
    }
    _error = "This platform cannot import repositories.";
  } catch (error) {
    _error = errorMessage(error);
  }
  _importing = "";
  redraw();
}

function visibleRepos(): RepoInfo[] {
  const query = _filter.trim().toLowerCase();
  let repos = _repos ?? [];
  if (_mode === "open") {
    // Open Project offers only repos the user can write to; Jx-tagged repos surface first.
    // The topic is an accelerator, not ground truth — untagged repos still open via importProject.
    const writable = repos.filter((r) => r.permission === "admin" || r.permission === "write");
    repos = [...writable.filter((r) => r.isJxProject), ...writable.filter((r) => !r.isJxProject)];
  }
  return query ? repos.filter((r) => r.fullName.toLowerCase().includes(query)) : repos;
}

/** One repository as the list draws it: strings and flags, nothing the document has to interpret. */
function rowOf(repo: RepoInfo): AddRepoRow {
  return {
    disabled: _importing !== "",
    fullName: repo.fullName,
    importing: _importing === repo.fullName,
    isJx: repo.isJxProject,
    isPrivate: repo.private,
    meta: `${repo.defaultBranch} · ${repo.permission}`,
  };
}

/**
 * Why the list is empty, when it is.
 *
 * Read only once the listing has landed and filtering has taken everything out, and the order is
 * the order the remedies come in: a filter the reader typed, a permission only an admin can widen,
 * an App that was never installed, and an App that is installed and reaches nothing.
 */
function emptyStateOf(): AddRepoView["emptyState"] {
  if (_filter) {
    return "filter";
  }
  if (_mode === "open" && (_repos ?? []).length > 0) {
    return "write";
  }
  return needsAppInstall() ? "install" : "none";
}

/**
 * Repository-access footer: the list is bounded by what the Jx Suite App was granted, so every mode
 * offers a way out of that boundary — widen an existing installation, install on another account,
 * then Refresh to pick up the newly reachable repositories.
 */
function accessOf(): AddRepoView["access"] {
  const links = getRepoAccessLinks();
  if (!links) {
    return [];
  }
  return [
    ...links.manage.map((entry) => ({
      label: entry.account,
      title: `Manage repository access for ${entry.account}`,
      url: entry.url,
    })),
    ...(links.installUrl
      ? [
          {
            label: "Another account…",
            title: "Install the Jx Suite GitHub App on another account",
            url: links.installUrl,
          },
        ]
      : []),
  ];
}

/** Everything the dialog draws, as one record. The only place this module's state becomes a view. */
function viewOf(): AddRepoView {
  return {
    access: accessOf(),
    emptyState: emptyStateOf(),
    failure: _error,
    filter: _filter,
    installUrl: getAccountStatus()?.appInstallUrl ?? "",
    loading: _repos === null,
    rows: visibleRepos().map((repo) => rowOf(repo)),
    title: _mode === "open" ? "Open Project" : "Add existing repository",
  };
}
