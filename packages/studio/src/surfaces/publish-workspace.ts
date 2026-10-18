/// <reference lib="dom" />
/**
 * The Publish workspace, as a mounted document (studio.md §22.8).
 *
 * This is the adapter. `publish/publish-workspace.ts` is the flow: which sub-tab is showing, what
 * the change list, the checks, the destinations, the deployments, the branches and the hosting rows
 * say, and what every control does. It hands this module one projection, and this module hands the
 * document a scope and reports the one node the flow needs to hold.
 *
 * **One island, through `onNodeCreated`.** Hosting's build adapter is the Deploy section that moved
 * here from Project Settings (§17.1), mounted by `settings/project-sections.ts` into a box this
 * document draws and never fills (`adapter-island`). The node is announced as it is created, which
 * is the one seam for a node a document made (`studio-ui-guidelines.md` §9.4); a node found by
 * selector once would be detached DOM the moment the Hosting case was switched away and back.
 *
 * **The host is cleared**, for the reason `surfaces/media-library.ts` gives: the pane's stage is
 * handed to whichever mode owns it whole.
 *
 * @docs studio/publish
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import publishWorkspaceDoc from "./publish-workspace.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";
import type { ChangeRow, CommitRow } from "../publish/source-control";
import type { DestinationChoice } from "../publish/publish-changes";
import type { PublishDestination, PublishTab } from "../publish/publish-ids";
import type { DeployStepRowView } from "./panel-deploy-checklist";
import type { ActivityRowView } from "./panel-activity";

registerSurface("publish-workspace", publishWorkspaceDoc);

/** One sub-tab in the strip. */
export interface PublishTabRow {
  value: PublishTab;
  label: string;
}

/** One changed file in Review changes: the shared row, plus what its three controls are called. */
export interface ReviewFileRow extends ChangeRow {
  includeLabel: string;
  compareLabel: string;
  discardLabel: string;
  discardHint: string;
}

/** One component's changed files. */
export interface ReviewGroupRow {
  key: string;
  name: string;
  files: ReviewFileRow[];
}

/** One check, with its glyph and the one button that resolves it. */
export interface PublishCheckRow {
  key: string;
  state: string;
  /** A kit icon name (`check`, `x`, `spinner`, `warning-circle`, `question`). */
  icon: string;
  /** The state in words, the icon's accessible name: "Passed", "To do", "Not checked yet". */
  iconLabel: string;
  text: string;
  hasAction: boolean;
  actionLabel: string;
  actionTitle: string;
  actionDisabled: boolean;
}

/** A command, drawn as a button: its id, its own title, and whether it may run now. */
export interface CommandButtonRow {
  id: string;
  label: string;
  /** The tooltip: the title, or the title and the reason it is refused. */
  title: string;
  disabled: boolean;
}

/** One deployment, in History or under Branch previews. */
export interface DeploymentRow {
  key: string;
  /** "2h ago". */
  when: string;
  /** "Production", or the preview's branch. */
  label: string;
  environment: string;
  /** The state in words: "Live", "Replaced", "Ready", "Building…", "Failed" or "Canceled". */
  status: string;
  /** What the host reported, as its stage and status ("deploy: success"): the status's tooltip. */
  statusDetail: string;
  /** The stage's status alone, for its colour: `success`, `failure`, `active`… */
  statusKey: string;
  url: string;
  openLabel: string;
}

/** One local branch. */
export interface BranchRow {
  key: string;
  name: string;
  current: boolean;
  /** For the current branch: "2 ahead, 1 behind" or "Up to date". */
  note: string;
  /** For any other: "Switch", or "Switch and reload" where a branch is a session. */
  switchLabel: string;
  /** The switch button's accessible name, which names the branch: "Switch to feature". */
  switchName: string;
}

/** Everything the document draws, as one value. */
export interface PublishWorkspaceView {
  region: string;
  titleId: string;
  panelId: string;
  /** The region of the destination card, which is the part a screenshot crops to. */
  commitRegion: string;
  destinationId: string;
  tab: PublishTab;
  tabTitle: string;
  tabs: PublishTabRow[];
  headline: string;
  mood: "no-project" | "loading" | "no-repo" | "repo";
  busy: boolean;
  hasError: boolean;
  error: string;
  canClone: boolean;
  // Review changes
  syncLabel: string;
  lastUpdated: string;
  hasLastUpdated: boolean;
  remoteState: "remote" | "local";
  pullLabel: string;
  pushLabel: string;
  filesState: "listed" | "empty";
  includedLabel: string;
  allIncluded: boolean;
  someIncluded: boolean;
  groups: ReviewGroupRow[];
  commitsState: "listed" | "empty";
  commits: CommitRow[];
  checks: PublishCheckRow[];
  destination: PublishDestination;
  destinations: DestinationChoice[];
  hasRefusal: boolean;
  refusal: string;
  summary: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  hasBlocker: boolean;
  blocker: string;
  reviewState: "none" | "opened";
  reviewLine: string;
  reviewUrl: string;
  // Deploys
  hasLiveUrl: boolean;
  liveUrl: string;
  liveNone: string;
  liveSummary: string;
  deployCommands: CommandButtonRow[];
  runningState: "none" | "running";
  /** Each deploy in progress: the Activity record (§16.4), as the Activity feed draws it. */
  running: ActivityRowView[];
  deploysState: "listed" | "loading" | "note";
  deploysNote: string;
  deploysBusy: boolean;
  historyState: "listed" | "empty";
  history: DeploymentRow[];
  previewsState: "listed" | "empty";
  previews: DeploymentRow[];
  // Branches
  branchSummary: string;
  newBranchDisabled: boolean;
  hasBranchNote: boolean;
  branchNote: string;
  branchesState: "listed" | "empty";
  branchesEmpty: string;
  branches: BranchRow[];
  // Hosting
  sourceSummary: string;
  sourceCommands: CommandButtonRow[];
  hostTitle: string;
  hostSummary: string;
  hostCommands: CommandButtonRow[];
  domainState: "set" | "none";
  domain: string;
  domainNote: string;
  checklistSummary: string;
  checklistSteps: DeployStepRowView[];
}

/** What a control asks the flow to do. */
export interface PublishWorkspaceActions {
  selectTab: (tab: string) => void;
  refresh: () => void;
  fetch: () => void;
  pull: () => void;
  push: () => void;
  clone: () => void;
  initRepository: () => void;
  createRepository: () => void;
  include: (path: string, included: boolean) => void;
  includeAll: (included: boolean) => void;
  compare: (path: string) => void;
  discard: (path: string) => void;
  runCheck: (key: string) => void;
  pickDestination: (value: string) => void;
  editSummary: (value: string) => void;
  publish: () => void;
  openUrl: (url: string) => void;
  run: (commandId: string) => void;
  reloadDeployments: () => void;
  checkout: (name: string) => void;
  newBranch: () => void;
  /** The build adapter's mount box was created. */
  adapterHost: (element: HTMLElement) => void;
}

export interface PublishWorkspaceSurfaceHandle {
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host (a mount still in flight counts). */
  attached: () => boolean;
  update: (view: PublishWorkspaceView) => void;
  dispose: () => void;
}

/** The scope the document reads: the view, and every action but the node callback. */
type PublishWorkspaceScope = PublishWorkspaceView & Omit<PublishWorkspaceActions, "adapterHost">;

/** An empty view: what a scope holds before the first projection. */
export function emptyPublishWorkspaceView(): PublishWorkspaceView {
  return {
    allIncluded: false,
    blocker: "",
    branchNote: "",
    branchSummary: "",
    branches: [],
    branchesEmpty: "",
    branchesState: "empty",
    busy: false,
    canClone: false,
    checklistSteps: [],
    checklistSummary: "",
    checks: [],
    commitRegion: "",
    commits: [],
    commitsState: "empty",
    deployCommands: [],
    deploysBusy: false,
    deploysNote: "",
    deploysState: "note",
    destination: "live",
    destinationId: "",
    destinations: [],
    domain: "",
    domainNote: "",
    domainState: "none",
    error: "",
    filesState: "empty",
    groups: [],
    hasBlocker: false,
    hasBranchNote: false,
    hasError: false,
    hasLastUpdated: false,
    hasLiveUrl: false,
    hasRefusal: false,
    headline: "",
    history: [],
    historyState: "empty",
    hostCommands: [],
    hostSummary: "",
    hostTitle: "",
    includedLabel: "",
    lastUpdated: "",
    liveNone: "",
    liveSummary: "",
    liveUrl: "",
    mood: "loading",
    newBranchDisabled: false,
    panelId: "",
    previews: [],
    previewsState: "empty",
    primaryDisabled: true,
    primaryLabel: "",
    pullLabel: "Pull",
    pushLabel: "Push",
    refusal: "",
    region: "",
    remoteState: "local",
    reviewLine: "",
    reviewState: "none",
    reviewUrl: "",
    running: [],
    runningState: "none",
    someIncluded: false,
    sourceCommands: [],
    sourceSummary: "",
    summary: "",
    syncLabel: "",
    tab: "review",
    tabTitle: "",
    tabs: [],
    titleId: "",
  };
}

/** The `part` a definition declares, or `""`. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/**
 * Mount the Publish workspace into a pane's stage.
 *
 * @param {HTMLElement} host - The pane's stage, emptied first
 * @param {PublishWorkspaceView} view - What to draw right now
 * @param {PublishWorkspaceActions} actions - What each control does
 * @returns {PublishWorkspaceSurfaceHandle}
 */
export function mountPublishWorkspaceSurface(
  host: HTMLElement,
  view: PublishWorkspaceView,
  actions: PublishWorkspaceActions,
): PublishWorkspaceSurfaceHandle {
  host.replaceChildren();
  const { adapterHost, ...controls } = actions;
  const scope = reactive<PublishWorkspaceScope>({ ...emptyPublishWorkspaceView(), ...controls });
  Object.assign(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("publish-workspace", scope, host, {
    onNodeCreated: (element, _path, def) => {
      // `disposed` first: nodes are still created while a mount that was taken down runs out.
      if (!disposed && element instanceof HTMLElement && partOf(def) === "adapter-island") {
        adapterHost(element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    /* SAFETY: `publish-workspace.json`'s root definition is a `div` element, so the runtime mounts
       an HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => {
      Object.assign(scope, next);
    },
  };
}
