/// <reference lib="dom" />
/**
 * Repository picker flow — a filterable picker over `platform.listRepos` (every repo the platform's
 * account link can reach, personal and organization), with a second step for the folder the project
 * lives in. Two modes share the dialog:
 *
 * - "add" (Add Existing Repository): the unfiltered adoption path.
 * - "open" (Open Project on `openProjectPicker: "repo-list"` platforms): only write-access
 *   repositories, Jx-tagged ones first.
 *
 * Choosing a repository asks `platform.listRepoProjects` which of its folders hold a `project.json`
 * and preselects one — the root when it is a project, else the first — so a monorepo's
 * `sites/marketing` opens as itself rather than failing because the root has no config. The folder
 * field takes any folder too, which is the answer for a repository too large to scan and for a
 * platform that cannot scan at all. Confirming runs `platform.importProject` with that folder,
 * which adopts it as a Jx project (probes its project.json, tags + catalogues the repository) and
 * resolves with the catalogue root key; the caller opens it through the same path as a recent
 * project. A folder without a project.json fails with the backend's structured message, shown
 * inline.
 *
 * Scans are cached per repository for the life of the dialog, and one the CARET asks for (an arrow
 * key in the filter) waits {@link SCAN_DELAY_MS} first: arrowing past twenty repositories must not
 * be twenty tree reads against the reader's GitHub rate limit. A click asks at once.
 *
 * The list only ever shows what the Jx Suite GitHub App can reach, so the dialog also carries an
 * access footer: per-installation links to widen the App's repository selection, a link to install
 * it on another account, and Refresh — the user grants access in a GitHub tab, comes back, and
 * reloads the list without losing the dialog.
 *
 * **The dialog is a document.** `surfaces/add-repo.json` draws it and `surfaces/add-repo.ts` mounts
 * it; this module keeps the listing, the ordering, the scans, the adoption and the promise. Every
 * way out of it — Escape, Cancel, a programmatic close — is the platform's `cancel` on the dialog,
 * which arrives here as `onClosed`.
 */

import { actIfRequired } from "../account/action-flow";
import { errorMessage } from "@jxsuite/schema/parse";
import {
  getAccountStatus,
  getRepoAccessLinks,
  hydrateAccountStatus,
  needsAppInstall,
} from "../account-status";
import { getPlatform } from "../platform";
import { layerHost } from "../ui/layers";
import { normalizeProjectDir } from "../utils/project-dir";
import { openAddRepoSurface } from "../surfaces/add-repo";
import type {
  AddRepoLocation,
  AddRepoRow,
  AddRepoSurfaceHandle,
  AddRepoView,
} from "../surfaces/add-repo";
import type { RepoInfo, RepoProjects } from "../types";

type PickerMode = "add" | "open";

/** How long a scan the caret asked for waits for the caret to move on. */
export const SCAN_DELAY_MS = 250;

/** What the dialog knows about one repository's projects. */
type Scan =
  | { status: "loading" }
  | { status: "done"; projects: RepoProjects }
  | { status: "failed"; message: string };

let _handle: AddRepoSurfaceHandle | null = null;
let _mode: PickerMode = "add";
let _repos: RepoInfo[] | null = null;
let _filter = "";
/** The account the list is narrowed to; "" = every account. */
let _owner = "";
/** FullName of the chosen repository ("" = none). */
let _selected = "";
/** The folder field's text. */
let _folder = "";
/** The reader typed or picked a folder, so a scan landing late must not replace it. */
let _folderTouched = false;
/** A repository double-clicked before its scan landed: open it once the folder is unambiguous. */
let _pendingOpen = "";
let _scans = new Map<string, Scan>();
let _scanTimer: ReturnType<typeof setTimeout> | null = null;
/** The repository whose scan is waiting on `_scanTimer` ("" = none). */
let _scanQueued = "";
let _error = "";
/** An adoption is in flight. */
let _busy = false;
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
  _owner = "";
  _selected = "";
  _folder = "";
  _folderTouched = false;
  _pendingOpen = "";
  _scans = new Map();
  _error = "";
  _busy = false;

  return new Promise((resolve) => {
    _resolve = resolve;
    _handle = openAddRepoSurface({
      layer: layerHost("dialog"),
      onClosed: () => {
        /* Escape, the Cancel button and a programmatic close all arrive here, and all of them mean
           the same thing: nothing was adopted. A native `<dialog>` has already closed by the time
           it says so, which is why this settles rather than deciding whether to allow it — an
           adoption still in flight is dropped on the way out (`adopt` finds the picker gone),
           exactly as a listing or a scan that lands after a dismissal is. */
        settle(null);
      },
      onConfirm: () => {
        confirm();
      },
      onFilter: (value) => {
        _filter = value;
        redraw();
      },
      onFolder: (value) => {
        _folder = value;
        _folderTouched = true;
        _error = "";
        redraw();
      },
      onLocation: (dir) => {
        _folder = dir;
        _folderTouched = true;
        _error = "";
        redraw();
      },
      onMove: (delta) => {
        move(delta);
      },
      onMoveLocation: (delta) => {
        moveLocation(delta);
      },
      onOpenRepo: (fullName) => {
        openRepo(fullName);
      },
      onOwner: (value) => {
        _owner = value;
        redraw();
      },
      onRefresh: () => {
        loadRepos();
      },
      onSelect: (fullName) => {
        select(fullName, "now");
      },
      view: viewOf(),
    });
    loadRepos();
  });
}

/**
 * (Re)load the repository list and the App's installation coverage. Both feed the same question —
 * "which repositories can Jx see?" — so a refresh after a permission change re-reads both. The
 * scans go too: what a refresh is for is usually a change the reader just made on GitHub, and a
 * `project.json` they just pushed is one.
 */
function loadRepos(): void {
  _repos = null;
  _error = "";
  cancelQueuedScan();
  _scans = new Map();
  // Paints the loading state on a refresh; a no-op on open, where the surface opens on this view.
  redraw();

  void hydrateAccountStatus().then(redraw);

  void getPlatform()
    .listRepos?.()
    .then((repos) => {
      _repos = repos;
      if (_selected) {
        requestScan(_selected, "now");
      }
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
  _busy = false;
  cancelQueuedScan();
  resolve?.(result);
  handle?.close();
}

/** The repositories the current mode offers, before the account and the filter narrow them. */
function offeredRepos(): RepoInfo[] {
  const repos = _repos ?? [];
  if (_mode !== "open") {
    return repos;
  }
  // Open Project offers only repos the user can write to; Jx-tagged repos surface first.
  // The topic is an accelerator, not ground truth — untagged repos still open via importProject.
  const writable = repos.filter((r) => r.permission === "admin" || r.permission === "write");
  return [...writable.filter((r) => r.isJxProject), ...writable.filter((r) => !r.isJxProject)];
}

function visibleRepos(): RepoInfo[] {
  const query = _filter.trim().toLowerCase();
  const repos = offeredRepos().filter((r) => !_owner || r.owner === _owner);
  return query ? repos.filter((r) => r.fullName.toLowerCase().includes(query)) : repos;
}

function selectedRepo(): RepoInfo | undefined {
  return _selected ? (_repos ?? []).find((repo) => repo.fullName === _selected) : undefined;
}

/**
 * Choose a repository, and ask what it holds.
 *
 * `"now"` for a pointer, which means it; `"soon"` for the caret, which may only be passing through.
 * The folder goes back to untouched, so the new repository's own default can land in it.
 */
function select(fullName: string, when: "now" | "soon"): void {
  if (fullName === _selected || _busy) {
    return;
  }
  _selected = fullName;
  _folder = "";
  _folderTouched = false;
  _pendingOpen = "";
  _error = "";
  requestScan(fullName, when);
  redraw();
}

/** Move the repository caret by `delta` rows; from nothing, Down lands on the first and Up the last. */
function move(delta: number): void {
  const rows = visibleRepos();
  if (rows.length === 0) {
    return;
  }
  const at = rows.findIndex((repo) => repo.fullName === _selected);
  const next =
    at === -1
      ? delta > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, at + delta));
  const target = rows[next];
  if (target) {
    select(target.fullName, "soon");
  }
}

/** The folders the chosen repository's scan found; [] until one has. */
function scannedLocations(): RepoProjects["locations"] {
  const scanned = _scans.get(_selected);
  return scanned?.status === "done" ? scanned.projects.locations : [];
}

/** Move the folder caret by `delta` rows, writing the row's folder into the field as it goes. */
function moveLocation(delta: number): void {
  const locations = scannedLocations();
  if (locations.length === 0) {
    return;
  }
  const current = normalizeProjectDir(_folder);
  const at = locations.findIndex((location) => location.dir === current);
  const next =
    at === -1
      ? delta > 0
        ? 0
        : locations.length - 1
      : (at + delta + locations.length) % locations.length;
  const target = locations[next];
  if (target) {
    _folder = target.dir;
    _folderTouched = true;
    _error = "";
    redraw();
  }
}

/** Ask the platform which folders of `fullName` hold a project.json, unless it already said. */
function requestScan(fullName: string, when: "now" | "soon"): void {
  const platform = getPlatform();
  const repo = (_repos ?? []).find((candidate) => candidate.fullName === fullName);
  if (!platform.listRepoProjects || !repo) {
    return;
  }
  const known = _scans.get(fullName);
  if (known) {
    if (known.status === "done") {
      applyDefaultFolder(fullName);
    }
    return;
  }
  cancelQueuedScan();
  _scans.set(fullName, { status: "loading" });
  if (when === "now") {
    void scan(repo);
    return;
  }
  _scanQueued = fullName;
  _scanTimer = setTimeout(() => {
    _scanTimer = null;
    _scanQueued = "";
    void scan(repo);
  }, SCAN_DELAY_MS);
}

/**
 * Drop the scan waiting on the timer, if one is. Its "loading" entry goes with it: the caret moved
 * on before the wait was over, and a repository left marked as loading would never be asked again
 * when the caret came back to it.
 */
function cancelQueuedScan(): void {
  if (_scanTimer === null) {
    return;
  }
  clearTimeout(_scanTimer);
  _scanTimer = null;
  if (_scanQueued) {
    _scans.delete(_scanQueued);
    _scanQueued = "";
  }
}

async function scan(repo: RepoInfo): Promise<void> {
  const handle = _handle;
  let outcome: Scan;
  try {
    const projects = await getPlatform().listRepoProjects!({ name: repo.name, owner: repo.owner });
    outcome = { projects, status: "done" };
  } catch (error) {
    outcome = { message: errorMessage(error), status: "failed" };
  }
  // A scan that lands after the dialog closed — or after a refresh dropped it — has nowhere to go.
  if (_handle !== handle || _scans.get(repo.fullName)?.status !== "loading") {
    return;
  }
  _scans.set(repo.fullName, outcome);
  if (repo.fullName === _selected) {
    applyDefaultFolder(repo.fullName);
    if (_pendingOpen === repo.fullName) {
      _pendingOpen = "";
      if (outcome.status === "done" && outcome.projects.locations.length === 1) {
        confirm();
        return;
      }
    }
  }
  redraw();
}

/**
 * The folder a scan suggests, written into the field the reader has not touched: the root when it
 * is a project, since that is what the repository is; otherwise the first, which the scan orders
 * shallowest-first. A scan that found nothing leaves the field empty.
 */
function applyDefaultFolder(fullName: string): void {
  const scanned = _scans.get(fullName);
  if (_folderTouched || fullName !== _selected || scanned?.status !== "done") {
    return;
  }
  const { locations } = scanned.projects;
  _folder = (locations.find((location) => location.dir === "") ?? locations[0])?.dir ?? "";
}

/**
 * A double-click on a repository row: choose it, and open it if the folder is already settled. A
 * scan still running settles it later — and opens only if it finds exactly one project, because a
 * repository with several needs the reader to say which.
 */
function openRepo(fullName: string): void {
  select(fullName, "now");
  const scanned = _scans.get(fullName);
  if (scanned?.status === "loading") {
    _pendingOpen = fullName;
    return;
  }
  if (scanned?.status === "done" && scanned.projects.locations.length > 1 && !_folderTouched) {
    return;
  }
  confirm();
}

/** Why the folder field's text cannot be opened; "" when it can. */
function folderErrorOf(): string {
  return normalizeProjectDir(_folder) === null
    ? "A project folder is a path inside the repository, without . or .. segments."
    : "";
}

/** Whether confirming would adopt something, and the one reason it would not when it cannot. */
function canConfirm(): boolean {
  const repo = selectedRepo();
  if (!repo || _busy || folderErrorOf() !== "") {
    return false;
  }
  const scanned = _scans.get(repo.fullName);
  if (_folderTouched || !scanned) {
    return true;
  }
  // Untouched, the folder is the scan's suggestion: wait for it, and offer nothing when it found none.
  return (
    scanned.status === "failed" ||
    (scanned.status === "done" &&
      (scanned.projects.locations.length > 0 || scanned.projects.truncated))
  );
}

/**
 * The primary answer: the confirm button, Enter in either field, a double-click. With nothing
 * chosen, Enter in the filter chooses the first visible repository instead — the one a reader who
 * typed its name and pressed Enter meant.
 */
function confirm(): void {
  if (!_selected) {
    const [first] = visibleRepos();
    if (first) {
      select(first.fullName, "now");
    }
    return;
  }
  if (!canConfirm()) {
    return;
  }
  void adopt(_selected, normalizeProjectDir(_folder) ?? "");
}

/**
 * Adopt the chosen repository at `dir`. A refusal that offers an action (desktop.md §10.4) is
 * offered, and an action that is done runs the import again, once.
 */
async function adopt(fullName: string, dir: string, retried = false): Promise<void> {
  const repo = (_repos ?? []).find((candidate) => candidate.fullName === fullName);
  if (!repo || (_busy && !retried)) {
    return;
  }
  const handle = _handle;
  _busy = true;
  _error = "";
  redraw();
  try {
    const imported = await getPlatform().importProject?.({
      name: repo.name,
      owner: repo.owner,
      ...(dir ? { dir } : {}),
    });
    if (_handle !== handle) {
      return;
    }
    if (imported) {
      settle(imported);
      return;
    }
    _error = "This platform cannot import repositories.";
  } catch (error) {
    if (_handle !== handle) {
      return;
    }
    _error = errorMessage(error);
    _busy = false;
    redraw();
    if (!retried && (await actIfRequired(error)) && _handle === handle) {
      await adopt(fullName, dir, true);
    }
    return;
  }
  _busy = false;
  redraw();
}

/** One repository as the list draws it: strings and flags, nothing the document has to interpret. */
function rowOf(repo: RepoInfo): AddRepoRow {
  return {
    fullName: repo.fullName,
    isJx: repo.isJxProject,
    isPrivate: repo.private,
    // The branch alone: the permission is the chosen repository's detail, not every row's.
    meta: repo.defaultBranch,
  };
}

/** One scanned folder as the folder list draws it. */
function locationOf(location: RepoProjects["locations"][number], repo: RepoInfo): AddRepoLocation {
  const folderName = location.dir.slice(location.dir.lastIndexOf("/") + 1);
  return {
    dir: location.dir,
    label: location.name ?? (location.dir ? folderName : repo.name),
    path: location.dir ? `${location.dir}/` : "/",
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
  if (_filter || _owner) {
    return "filter";
  }
  if (_mode === "open" && (_repos ?? []).length > 0) {
    return "write";
  }
  return needsAppInstall() ? "install" : "none";
}

/**
 * The account filter: every account the offered repositories belong to, after "All accounts" — or
 * nothing at all when they all belong to one, since there is nothing to narrow by.
 */
function ownersOf(): AddRepoView["owners"] {
  const owners = [...new Set(offeredRepos().map((repo) => repo.owner))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  if (owners.length < 2) {
    return [];
  }
  return [
    { label: "All accounts", value: "" },
    ...owners.map((owner) => ({ label: owner, value: owner })),
  ];
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

/** The chosen repository's pane: its state, its rows, and the sentence under the folder field. */
function detailOf(repo: RepoInfo | undefined): Pick<
  AddRepoView,
  "detailState" | "detailName" | "detailMeta" | "locations" | "folderHelp"
> & {
  branch: string;
} {
  if (!repo) {
    return {
      branch: "",
      detailMeta: "",
      detailName: "",
      detailState: "none",
      folderHelp: "",
      locations: [],
    };
  }
  const scanned = _scans.get(repo.fullName);
  const branch = scanned?.status === "done" ? scanned.projects.branch : repo.defaultBranch;
  const base = {
    branch,
    detailMeta: [branch, repo.permission, ...(repo.private ? ["private"] : [])].join(" · "),
    detailName: repo.fullName,
    folderHelp: "The folder that holds project.json. Leave it empty for the repository root.",
    locations: [] as AddRepoLocation[],
  };
  if (!getPlatform().listRepoProjects) {
    return { ...base, detailState: "unlisted" };
  }
  if (!scanned || scanned.status === "loading") {
    return { ...base, detailState: "loading" };
  }
  if (scanned.status === "failed") {
    return { ...base, detailState: "failed" };
  }
  const { locations, truncated } = scanned.projects;
  return {
    ...base,
    detailState: locations.length > 0 ? "listed" : "empty",
    ...(truncated
      ? {
          folderHelp:
            "This repository is too large to scan in full. Name the folder if its project isn't listed.",
        }
      : {}),
    locations: locations.map((location) => locationOf(location, repo)),
  };
}

/** Everything the dialog draws, as one record. The only place this module's state becomes a view. */
function viewOf(): AddRepoView {
  const repo = selectedRepo();
  const { branch, ...detail } = detailOf(repo);
  const folderError = folderErrorOf();
  const folder = normalizeProjectDir(_folder) ?? "";
  const verb = _mode === "open" ? "Open" : "Add";
  return {
    ...detail,
    access: accessOf(),
    busy: _busy,
    canConfirm: canConfirm(),
    confirmLabel: _busy ? (_mode === "open" ? "Opening…" : "Adding…") : verb,
    emptyState: emptyStateOf(),
    failure: _error,
    chosenFolder: folder,
    filter: _filter,
    folder: _folder,
    folderError,
    installUrl: getAccountStatus()?.appInstallUrl ?? "",
    loading: _repos === null,
    owner: _owner,
    owners: ownersOf(),
    rows: visibleRepos().map((candidate) => rowOf(candidate)),
    selected: _selected,
    summary:
      repo && folderError === ""
        ? `${verb}s ${repo.fullName} ${folder ? `at ${folder}/` : "at the repository root"}${branch ? ` on ${branch}` : ""}.`
        : "",
    title: _mode === "open" ? "Open Project" : "Add existing repository",
  };
}
