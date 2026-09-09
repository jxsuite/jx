/**
 * The destination half of the New Project wizard's second step — where the project is written.
 *
 * Two shapes, chosen by the platform's `createDestination` (specs/desktop.md §4.5):
 *
 * - `"path"` (desktop, dev server): a required **Location** (absolute parent directory) plus the
 *   folder name. Desktop backs the Browse… button with the native dialog via `pickDirectory`; the
 *   dev server has no dialog, so the path is typed. Nothing is ever written to a directory the user
 *   did not name.
 * - `"repo"` (cloud): the repository location — owner (personal account or organization), the
 *   repository name, and its visibility.
 *
 * This module owns the destination state AND the name-derived slug's label, so the field order
 * reads naturally in both shapes (Location → Directory, versus Owner → Repository → Visibility).
 *
 * **It draws nothing.** `surfaces/new-project.json` renders both shapes and branches on
 * {@link LocationView.destination}; what is left here is the state, the validation, and one
 * projection of both. The four `sp-*` controls it used to build — and the five property bindings
 * that had to be `live()` to survive a repaint — went with the template.
 *
 * @docs studio/projects/create
 */

import { getPlatform } from "../platform";
import type { CreateProjectDestination, RepoInfo } from "../types";

/** Absolute POSIX (`/…`) or Windows (`C:\…` / `C:/…`) path. */
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[/\\]|\/)/;

let _parent = "";
let _owner = "";
let _private = true;
/** Owner logins offered in the repo-mode picker (empty until loaded / when unavailable). */
let _owners: string[] = [];
/** Repositories already owned, for the name-collision hint. Null until loaded. */
let _repos: RepoInfo[] | null = null;
/** Inline validation error shown under the destination fields. */
let _error = "";
let _browsing = false;

/** Reset the section for a fresh modal pass. */
export function resetLocationFields() {
  _parent = "";
  _owner = "";
  _private = true;
  _owners = [];
  _repos = null;
  _error = "";
  _browsing = false;
}

/**
 * Load the repo-mode owner candidates (and the repo list behind the collision hint) in the
 * background. No-op on `"path"` platforms. Failures are non-fatal — the owner field falls back to
 * free text, exactly as it behaves before the lists arrive.
 */
export function loadLocationOptions(rerender: () => void) {
  const platform = getPlatform();
  if (platform.createDestination !== "repo") {
    return;
  }
  const owners = new Set<string>();
  void Promise.allSettled([
    platform.getAccountStatus?.().then((status) => {
      for (const install of status?.installations ?? []) {
        if (install.account) {
          owners.add(install.account);
        }
      }
    }),
    platform.listRepos?.().then((repos) => {
      _repos = repos;
      for (const repo of repos) {
        owners.add(repo.owner);
      }
    }),
  ]).then(() => {
    _owners = [...owners].toSorted((a, b) => a.localeCompare(b));
    _owner ||= _owners[0] ?? "";
    rerender();
  });
}

/** The label for the shared slug field — it names a folder on disk, or a repository. */
export function slugFieldLabel(): string {
  return getPlatform().createDestination === "repo" ? "Repository" : "Directory";
}

/**
 * The destination to send with createProject, or null when the fields are incomplete/invalid (the
 * reason is then in `locationError()` and rendered inline).
 */
export function collectDestination(slug: string): CreateProjectDestination | null {
  _error = "";
  if (getPlatform().createDestination === "repo") {
    if (!_owner.trim()) {
      _error = "Choose an owner for the repository";
      return null;
    }
    if (!slug.trim()) {
      _error = "Repository name is required";
      return null;
    }
    return { kind: "repo", owner: _owner.trim(), private: _private, repo: slug.trim() };
  }
  const parent = _parent.trim();
  if (!parent) {
    _error = "Choose a location for the project folder";
    return null;
  }
  if (!ABSOLUTE_PATH.test(parent)) {
    _error = "Location must be an absolute path";
    return null;
  }
  if (!slug.trim()) {
    _error = "Directory name is required";
    return null;
  }
  return { kind: "path", parent: trimTrailingSep(parent) };
}

/** The inline validation message from the last `collectDestination`, if any. */
export function locationError(): string {
  return _error;
}

/** Drop trailing separators, but never reduce a filesystem root (`/`, `C:\`) to nothing. */
function trimTrailingSep(parent: string): string {
  const trimmed = parent.replace(/[/\\]+$/, "");
  return trimmed || parent;
}

/**
 * Join a parent directory and a folder name with the parent's own separator, so a Windows path
 * stays a Windows path. Shared by the preview and the resolved destination — the string the user
 * reads must be the string that gets created.
 */
function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith("/") || parent.endsWith("\\")
    ? `${parent}${name}`
    : `${parent}${sep}${name}`;
}

/**
 * The destination as the import pipeline names it: `importSite` takes a plain `directory` string
 * rather than a destination object, so the modal flattens one here.
 *
 * Both shapes, because both platforms import now. A `"path"` destination flattens to the absolute
 * folder it writes; a `"repo"` one to `owner/repo`, which is what a backend that commits the
 * emitted project into a git tree can act on — there is no directory for it to name.
 */
export function destinationPath(destination: CreateProjectDestination, slug: string): string {
  if (destination.kind === "repo") {
    return `${destination.owner}/${destination.repo || slug.trim()}`;
  }
  return joinPath(destination.parent, slug.trim());
}

/** The destination the user has chosen so far, rendered for the preview line. */
function previewOf(slug: string): string {
  const name = slug.trim() || "…";
  if (getPlatform().createDestination === "repo") {
    return `${_owner.trim() || "…"}/${name}`;
  }
  const parent = trimTrailingSep(_parent.trim());
  return parent ? joinPath(parent, name) : `…/${name}`;
}

/** True when a repo of this name already exists under the chosen owner. */
function repoExists(slug: string): boolean {
  const full = `${_owner.trim()}/${slug.trim()}`.toLowerCase();
  return (_repos ?? []).some((r) => r.fullName.toLowerCase() === full);
}

/** The destination fields as the wizard's document draws them: strings, flags and rows. */
export interface LocationView {
  /** Which shape this platform writes. The document's one discriminant here. */
  destination: "path" | "repo";
  slugLabel: string;
  parent: string;
  parentPlaceholder: string;
  canBrowse: boolean;
  browsing: boolean;
  browseLabel: string;
  owner: string;
  owners: { value: string; label: string }[];
  /** `"private"` or `"public"`: a select holds a value, not a flag. */
  visibility: string;
  /** The collision hint, already a sentence. Empty says nothing. */
  repoTaken: string;
  previewLabel: string;
  preview: string;
  error: string;
}

/**
 * Everything the destination block draws, as one record.
 *
 * The error is read from module state rather than through {@link locationError}: the message is a
 * fact about the last `collectDestination`, and this is the projection of it, so there is exactly
 * one reader of the variable and one accessor for anyone outside.
 *
 * @param slug The shared directory/repository name, which the collision hint and the preview read.
 * @returns The destination half of the wizard's view.
 */
export function locationView(slug: string): LocationView {
  const platform = getPlatform();
  const isRepo = platform.createDestination === "repo";
  return {
    browseLabel: _browsing ? "Choosing…" : "Browse…",
    browsing: _browsing,
    canBrowse: typeof platform.pickDirectory === "function",
    destination: isRepo ? "repo" : "path",
    error: _error,
    owner: _owner,
    owners: _owners.map((owner) => ({ label: owner, value: owner })),
    parent: _parent,
    parentPlaceholder: platform.pickDirectory
      ? "Choose a folder to create the project in"
      : "/absolute/path/to/your/projects",
    preview: previewOf(slug),
    previewLabel: isRepo ? "Repository" : "Creates",
    repoTaken:
      isRepo && repoExists(slug)
        ? `${_owner}/${slug.trim()} already exists — choose another name.`
        : "",
    slugLabel: slugFieldLabel(),
    visibility: _private ? "private" : "public",
  };
}

/** The Location field moved. A typed path is a fix, so the standing refusal goes with it. */
export function setLocationParent(value: string): void {
  _parent = value;
  _error = "";
}

/** The Owner field moved, from either shape of the control. */
export function setLocationOwner(value: string): void {
  _owner = value;
  _error = "";
}

/** The Visibility picker moved. Anything that is not `"public"` is private. */
export function setLocationVisibility(value: string): void {
  _private = value !== "public";
}

/**
 * Open the platform's own directory dialog and take the answer as the Location.
 *
 * Re-entrant by refusal rather than by disabling alone: the button is drawn disabled while the
 * native dialog is up, and a synthetic click does not consult that.
 *
 * @param rerender Repaint the wizard — once for the busy label, once for the answer.
 */
export async function browseLocation(rerender: () => void): Promise<void> {
  const platform = getPlatform();
  if (!platform.pickDirectory || _browsing) {
    return;
  }
  _browsing = true;
  rerender();
  try {
    const picked = await platform.pickDirectory();
    if (picked) {
      _parent = picked;
      _error = "";
    }
  } finally {
    _browsing = false;
    rerender();
  }
}
