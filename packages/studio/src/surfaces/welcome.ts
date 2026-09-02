/// <reference lib="dom" />
/**
 * Start pane — the pane-grid surface shown when no project is loaded and no document tabs are open.
 *
 * Three regions, in the order a first run needs them: **Start** (the ways to get a project in front
 * of you), **Recent** (projects you have opened, identified by name + the folder that tells two
 * same-named projects apart + when you last opened them), and **Projects** (the catalogue a cloud
 * platform enumerates). A repository-access prompt sits above them when the account has no GitHub
 * App installation yet, because nothing else on the pane can succeed until it does.
 *
 * Recents never render a raw absolute path: `recentLocations()` gives every row the shortest
 * trailing path that distinguishes it from the other rows sharing its name.
 *
 * The pane is the `welcome` surface (`surfaces/welcome.json`): this module is the projection —
 * which start actions the platform offers, the recents with their labels, the catalogue minus the
 * recents — and the four things a click can do. The scope is reactive, so a removed recent
 * reconciles in place.
 *
 * @docs studio/interface/welcome-screen
 */

import { getAccountStatus, needsAppInstall } from "../account-status";
import { platformSupportsAddRepo } from "../new-project/add-repo-modal";
import { getProjectList } from "../project-list";
import { reactive } from "../reactivity";
import { now } from "../services/clock";
import { clearRecentProjects, getRecentProjects, removeRecentProject } from "../recent-projects";
import { platformSupportsClone } from "../panels/git-panel";
import { mountSurface, registerSurface } from "../ui/surface";
import welcomeDoc from "./welcome.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("welcome", welcomeDoc as unknown as JxDocument);

interface WelcomeCtx {
  openProject: () => void;
  openRecentProject: (root: string) => void;
  openNewProject: (options?: { tab?: "starter" }) => void;
  cloneRepository: () => void;
  addExistingRepo: () => void;
}

let _ctx: WelcomeCtx | null = null;

/** @param {WelcomeCtx} ctx */
export function initWelcome(ctx: WelcomeCtx) {
  _ctx = ctx;
}

// ─── Location labels ──────────────────────────────────────────────────────────

/** Home-relative form of an absolute path (`/home/you/x` → `~/x`); other paths are unchanged. */
export function shortenPath(path: string): string {
  const match = /^\/(?:home|Users)\/[^/]+(?=\/|$)/.exec(path);
  return match ? `~${path.slice(match[0].length)}` : path;
}

/** The ancestor segments of a root, home-shortened — everything above the project folder itself. */
function ancestorSegments(root: string): string[] {
  const segments = shortenPath(root).split("/").filter(Boolean);
  return segments.slice(0, -1);
}

/**
 * The last `depth` ancestor folders of a root, as a path. Truncated labels lead with `…/`; a
 * complete absolute one keeps its leading `/`, so the string always says how much it is showing.
 */
function ancestorLabel(root: string, depth: number): string {
  const segments = ancestorSegments(root);
  if (segments.length === 0) {
    return shortenPath(root);
  }
  const tail = segments.slice(Math.max(0, segments.length - depth));
  if (tail.length < segments.length) {
    return `…/${tail.join("/")}`;
  }
  return tail[0] === "~" || !root.startsWith("/") ? tail.join("/") : `/${tail.join("/")}`;
}

/**
 * The location line for each entry: the shortest trailing path that tells apart the entries sharing
 * a display name. One folder deep is enough for almost every list; same-named projects under the
 * same parent fall back to their whole home-shortened root, which is unique because roots are.
 *
 * @param entries Projects to label, in any order.
 * @returns Root → location label, one entry per distinct root.
 */
export function recentLocations(
  entries: readonly { name: string; root: string }[],
): Map<string, string> {
  const groups = new Map<string, { name: string; root: string }[]>();
  for (const entry of entries) {
    const group = groups.get(entry.name);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.name, [entry]);
    }
  }

  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    const maxDepth = Math.max(...group.map((e) => ancestorSegments(e.root).length), 1);
    let chosen = group.map((e) => ancestorLabel(e.root, maxDepth));
    for (let depth = 1; depth <= maxDepth; depth++) {
      const candidate = group.map((e) => ancestorLabel(e.root, depth));
      if (new Set(candidate).size === group.length) {
        chosen = candidate;
        break;
      }
    }
    if (new Set(chosen).size !== group.length) {
      chosen = group.map((e) => shortenPath(e.root));
    }
    for (const [index, entry] of group.entries()) {
      labels.set(entry.root, chosen[index]!);
    }
  }
  return labels;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "When you last opened it", in the coarse units a project list is read in. Deliberately vague past
 * a week — the exact timestamp is in the row's tooltip.
 *
 * @param timestamp Epoch milliseconds.
 * @param at Epoch milliseconds to measure against. Defaults to the {@link now} seam, so a pinned
 *   clock makes "last opened" answer the same on every read.
 */
export function lastOpenedLabel(timestamp: number, at: number = now()): string {
  const elapsed = Math.max(0, at - timestamp);
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 30) {
    return `${days} days ago`;
  }
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : "over a year ago";
}

// ─── The surface ──────────────────────────────────────────────────────────────

/** One Start-list action: a labelled, icon-led button, run through `run`. */
interface StartAction {
  id: "new" | "open" | "clone" | "add";
  title: string;
  icon: string;
}

interface RecentRow {
  root: string;
  name: string;
  location: string;
  when: string;
}

interface CatalogueRow {
  root: string;
  name: string;
  detail: string;
}

interface WelcomeScope extends Record<string, unknown> {
  actions: StartAction[];
  installNeeded: boolean;
  installUrl: string;
  hasRecent: boolean;
  recent: RecentRow[];
  hasCatalogue: boolean;
  catalogue: CatalogueRow[];
  run: (id: string) => void;
  open: (root: string) => void;
  remove: (root: string) => void;
  clear: () => void;
}

let _state: WelcomeScope | null = null;
let _host: HTMLElement | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/** The pane, as the surface reads it, from the platform and the stores as they stand now. */
function project(): Omit<WelcomeScope, "run" | "open" | "remove" | "clear"> {
  const recent = getRecentProjects();
  // Catalogue entries already in Recent stay in that section only.
  const catalogue = getProjectList().filter((p) => !recent.some((r) => r.root === p.root));
  const recentLabels = recentLocations(recent);
  const catalogueLabels = recentLocations(catalogue);
  const actions: StartAction[] = [
    // One entry, not two: the starter gallery IS the first step of New Project now, so the
    // Separate "Start from an Example…" button it used to hide behind is gone.
    { icon: "plus", id: "new", title: "New Project…" },
    { icon: "folder-open", id: "open", title: "Open Project…" },
    ...(platformSupportsClone()
      ? [{ icon: "download-simple", id: "clone", title: "Clone Git Repository…" } as const]
      : []),
    ...(platformSupportsAddRepo()
      ? [{ icon: "cube", id: "add", title: "Add Existing Repository…" } as const]
      : []),
  ];
  return {
    actions,
    catalogue: catalogue.map((entry) => ({
      detail: entry.description ?? catalogueLabels.get(entry.root) ?? entry.root,
      name: entry.name,
      root: entry.root,
    })),
    hasCatalogue: catalogue.length > 0,
    hasRecent: recent.length > 0,
    /* The GitHub-App install prompt, gated on `needsAppInstall()`: the account is connected,
       reports zero installations, and told us where to fix that — the recovery path for the
       structured needs-installation 403 that `platform-errors.ts` decodes. */
    installNeeded: needsAppInstall(),
    installUrl: getAccountStatus()?.appInstallUrl ?? "#",
    recent: recent.map((entry) => ({
      location: recentLabels.get(entry.root) ?? entry.root,
      name: entry.name,
      root: entry.root,
      when: lastOpenedLabel(entry.timestamp),
    })),
  };
}

/** The reactive scope the surface reads, made once. */
function state(): WelcomeScope {
  _state ??= reactive({
    actions: [],
    catalogue: [],
    clear: () => {
      clearRecentProjects();
      refresh();
    },
    hasCatalogue: false,
    hasRecent: false,
    installNeeded: false,
    installUrl: "#",
    open: (root: string) => {
      _ctx?.openRecentProject(root);
    },
    recent: [],
    remove: (root: string) => {
      removeRecentProject(root);
      refresh();
    },
    run: (id: string) => {
      switch (id) {
        case "new": {
          _ctx?.openNewProject();
          break;
        }
        case "open": {
          _ctx?.openProject();
          break;
        }
        case "clone": {
          _ctx?.cloneRepository();
          break;
        }
        case "add": {
          _ctx?.addExistingRepo();
          break;
        }
        default: {
          break;
        }
      }
    },
  }) as WelcomeScope;
  return _state;
}

/** Recompute the projection; the surface follows. */
function refresh(): void {
  Object.assign(state(), project());
}

/**
 * Draw the pane into `host`, or bring the one already there up to date.
 *
 * The canvas calls this on every render while nothing is open, into the same wrap it clears when
 * something opens — so a mount whose root has since left the document is disposed and remade, and
 * one still standing is only refreshed.
 *
 * @param {HTMLElement} host
 */
export function renderWelcome(host: HTMLElement): void {
  refresh();
  const standing = _host === host && _handle !== null && _handle.root.isConnected;
  if (standing) {
    return;
  }
  if (_mount && _host === host && !_handle) {
    // Still mounting into this very host.
    return;
  }
  disposeWelcome();
  _host = host;
  const pending = mountSurface("welcome", state(), host);
  _mount = pending;
  void pending.then((handle) => {
    if (_mount === pending) {
      _handle = handle;
    } else {
      handle.dispose();
    }
  });
}

/** Take the pane down and forget its host. */
export function disposeWelcome(): void {
  const pending = _mount;
  _mount = null;
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    void pending.then((handle) => handle.dispose());
  }
  _host = null;
}
