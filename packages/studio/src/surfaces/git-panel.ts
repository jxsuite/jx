/// <reference lib="dom" />
/**
 * The Source Control panel, as a mounted document.
 *
 * `panels/git-panel.ts` is the flow — what git is asked, what a comparison is, which files group
 * under which component, what a commit does before it runs, and which of the four moods the panel
 * is in — and this is the surface it draws into: the reactive scope the document reads, the flags
 * it discriminates on, and the mount that stays put while the Navigator repaints around it.
 *
 * **The flow tells the surface what a row says, never what it means.** A changed file arrives as a
 * name, a directory, a status letter, that status said aloud, and two booleans; nothing here learns
 * what `U` is or that a `.png` has no comparison to open. That matters more here than in the
 * settings sections, because the file rows are NESTED — inside the per-file map `$map/item` is the
 * file, so a row genuinely cannot reach the group it is under — and a path it can hand straight
 * back is the whole answer.
 *
 * **The container is not cleared**, which is the one line where a panel differs from a settings
 * section. A section is handed the pane's whole content area and starts by emptying it; a panel
 * body is a node lit renders into, and its comment markers are how lit finds its own content again.
 * So the document is APPENDED, and {@link GitPanelSurfaceHandle.connected} is how the panel finds
 * out that the Navigator has since painted another panel over the top of it.
 *
 * @docs studio/publish/source-control
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import gitPanelDoc from "./git-panel.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("git-panel", gitPanelDoc as unknown as JxDocument);

/** One changed file, as the document draws it. Every field is a value: no records, no closures. */
export interface GitFileRowView {
  /** The row's reconcile key AND what every button hands back — the project-relative path. */
  key: string;
  path: string;
  /** The last segment, which is what the row reads as. */
  name: string;
  /** Everything before it, drawn small beside the name. */
  dir: string;
  /** Whether there is a directory to draw; the document has no `length` to ask. */
  hasDir: boolean;
  /** The open button's accessible name: the path and the status in words. */
  label: string;
  /** The one-letter badge — `M`, `A`, `D`, `R`, `U`. */
  status: string;
  /** Which pair of verbs the row offers: Unstage, or Discard and Stage. */
  staged: boolean;
  /**
   * Whether Discard is refused, spelled the way the document reads it. An untracked file has no
   * committed version to come back to, so there is nothing to discard TO.
   */
  cannotDiscard: boolean;
}

/** One component's changed files, under the heading the flow spelled. */
export interface GitGroupView {
  key: string;
  name: string;
  files: GitFileRowView[];
}

/** One commit in the log. */
export interface GitCommitView {
  key: string;
  /** The short hash, already sliced. */
  hash: string;
  message: string;
  /** "ada · 5m ago" — the author and the age, joined by the flow that knows the clock. */
  meta: string;
}

/** One row of the branch picker. `__new__` is a row like any other; the flow knows what it means. */
export interface GitBranchOption {
  value: string;
  label: string;
}

/** What the panel says the surface should be showing right now. */
export interface GitPanelValues {
  /**
   * Which of the four moods the panel is in: no project open, a first read still in flight, a
   * project git is not tracking, or a repository. The flow decides; the document switches.
   */
  view: "no-project" | "loading" | "no-repo" | "repo";
  /** Whether this platform can clone at all — the one action the no-project state offers. */
  canClone: boolean;
  /** A git verb is in flight: every button that would start a second one is off. */
  busy: boolean;
  hasError: boolean;
  error: string;
  /** `remote` or `local`: which sync bar is drawn. */
  remoteState: "remote" | "local";
  /** "Up to date", or "3 ahead, 1 behind". */
  syncLabel: string;
  /** "Last updated 02:04 PM", or empty. */
  lastUpdated: string;
  hasLastUpdated: boolean;
  /** The pull and push buttons' names, which carry their counts: "Pull (2 behind)". */
  pullLabel: string;
  pushLabel: string;
  branchName: string;
  /** What the picker currently holds. Not always {@link branchName} — see the adapter's note. */
  branchValue: string;
  branchOptions: GitBranchOption[];
  /** `changes` or `history` — `shell.git.subTab`, which names the `$switch` case. */
  subTab: string;
  /** "Local Changes (6)" — the count is part of the tab's label, not a badge of its own. */
  changesLabel: string;
  commitMessage: string;
  hasStaged: boolean;
  stagedCount: string;
  stagedFiles: GitFileRowView[];
  changedCount: string;
  /** Whether Stage all has anything to stage. */
  hasUnstaged: boolean;
  filesState: "listed" | "empty";
  groups: GitGroupView[];
  historyState: "listed" | "empty";
  commits: GitCommitView[];
}

/** What a control can ask the panel to do. Every one of them is a decision the flow owns. */
export interface GitPanelActions {
  clone: () => void;
  initRepository: () => void;
  createRepository: () => void;
  refresh: () => void;
  fetch: () => void;
  pull: () => void;
  push: () => void;
  /** A pick from the branch picker — including the row that means "make a new one". */
  chooseBranch: (value: string) => void;
  selectTab: (tab: string) => void;
  /** State what the commit field now holds, before anything is decided about it. */
  editMessage: (value: string) => void;
  /** Commit without pushing — the chord, and the menu row. */
  commit: () => void;
  commitAndSync: () => void;
  /** The split button's second half: the kit menu, hung off the control that was clicked. */
  openCommitMenu: (anchor: HTMLElement) => void;
  openFile: (path: string) => void;
  stage: (path: string) => void;
  unstage: (path: string) => void;
  discard: (path: string) => void;
  stageAll: () => void;
  unstageAll: () => void;
}

export interface GitPanelSurfaceHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: GitPanelValues) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the projection, plus everything a control can ask for. */
interface GitPanelScope extends Record<string, unknown>, GitPanelValues, GitPanelActions {}

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: GitPanelScope, values: GitPanelValues): void {
  scope.view = values.view;
  scope.canClone = values.canClone;
  scope.busy = values.busy;
  scope.hasError = values.hasError;
  scope.error = values.error;
  scope.remoteState = values.remoteState;
  scope.syncLabel = values.syncLabel;
  scope.lastUpdated = values.lastUpdated;
  scope.hasLastUpdated = values.hasLastUpdated;
  scope.pullLabel = values.pullLabel;
  scope.pushLabel = values.pushLabel;
  scope.branchName = values.branchName;
  scope.branchValue = values.branchValue;
  scope.branchOptions = values.branchOptions;
  scope.subTab = values.subTab;
  scope.changesLabel = values.changesLabel;
  scope.commitMessage = values.commitMessage;
  scope.hasStaged = values.hasStaged;
  scope.stagedCount = values.stagedCount;
  scope.stagedFiles = values.stagedFiles;
  scope.changedCount = values.changedCount;
  scope.hasUnstaged = values.hasUnstaged;
  scope.filesState = values.filesState;
  scope.groups = values.groups;
  scope.historyState = values.historyState;
  scope.commits = values.commits;
}

/** The scope's starting shape, before the first projection lands on it. */
function emptyValues(): GitPanelValues {
  return {
    branchName: "",
    branchOptions: [],
    branchValue: "",
    busy: false,
    canClone: false,
    changedCount: "0",
    changesLabel: "Local Changes",
    commitMessage: "",
    commits: [],
    error: "",
    filesState: "empty",
    groups: [],
    hasError: false,
    hasLastUpdated: false,
    hasStaged: false,
    hasUnstaged: false,
    historyState: "empty",
    lastUpdated: "",
    pullLabel: "Pull",
    pushLabel: "Push",
    remoteState: "local",
    stagedCount: "0",
    stagedFiles: [],
    subTab: "changes",
    syncLabel: "",
    view: "loading",
  };
}

/**
 * Mount the Source Control document into `container`, which is the `.panel-content` the Navigator
 * just painted.
 *
 * Nothing is called on the elements, so the mount is all this has to wait for: the DOCUMENT is what
 * this surface renders, and the kit elements inside it settle their own templates one
 * `connectedCallback` later without anybody here asking them to (guidelines §1.1, "await the
 * element").
 */
export function mountGitPanelSurface(
  container: HTMLElement,
  values: GitPanelValues,
  actions: GitPanelActions,
): GitPanelSurfaceHandle {
  const scope = reactive<GitPanelScope>({
    ...emptyValues(),
    ...actions,
  }) as GitPanelScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("git-panel", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight there is nothing in the container to ask about, so the
       answer is simply whether this handle is still wanted — answering no would start a second
       mount racing the first. Once mounted, the question is whether the root is still where it was
       put: a Navigator that painted another panel cleared this document out from under it. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => {
      project(scope, next);
    },
  };
}
