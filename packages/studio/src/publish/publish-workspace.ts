/// <reference lib="dom" />
/**
 * The Publish workspace's home: Review changes, Deploys, Branches and Hosting (studio.md §22.8).
 *
 * This is the flow. It projects four records into the surface (`surfaces/publish-workspace.json`):
 * `shell.git` (what source control said), `shell.publish` (which sub-tab and which destination),
 * the project's `build.deploy` with the deployments this module asks Cloudflare for, and the
 * Activity records a running deploy writes. Every verb a control runs is somebody else's: source
 * control's ({@link import("./source-control")}), publishing's
 * ({@link import("./publish-changes")}), or a command record run by id, so the workspace adds no
 * second list of actions (`studio-ui-guidelines.md` §12.5).
 *
 * **Per pane**, for the reason `media/media-library.ts` gives: two panes can each show the home.
 * Each mount owns an `effect()` that re-projects on every reactive input it read, so a finished
 * fetch, a typed summary, a deploy step and a registry that has just composed all reach the
 * document whether or not anything else on screen moved.
 *
 * @docs studio/publish
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { activeRegistry } from "../commands/active-registry";
import { runActiveReported } from "../commands/run-reported";
import { activities, activityRowView, isFinished } from "../panels/activity-panel";
import { openUrlExternally } from "../canvas/preview-navigate";
import { effect, effectScope } from "../reactivity";
import { disposeDeploySection, renderDeploySection } from "../settings/project-sections";
import { shell } from "../shell";
import { projectState } from "../store";
import { paneRegion } from "../ui/regions";
import { getPlatform, hasPlatform } from "../platform";
import { mountPublishWorkspaceSurface } from "../surfaces/publish-workspace";
import { resolveI18n } from "@jxsuite/schema/locale";
import { previewFileSrc } from "../files/media-paths";
import { isViewableMedia } from "../media/media-open";
import { workspace } from "../workspace/workspace";
import { workspaceHomeTabId } from "../workspace/workspace-ids";
import { reviewItems, selectedReviewItem } from "./review-changes";
import type { ReviewItem } from "./review-changes";
import { createTab, disposeTab } from "../tabs/tab";
import {
  currentDeploy,
  deployChecklistView,
  noteDeployment,
  observedDeployment,
} from "./deploy-checklist";
import { listDeployments, platformSupportsPublish } from "./pages-service";
import {
  canCheckBuild,
  destinationChoices,
  effectiveDestination,
  lastPullRequest,
  publishBlocker,
  publishChanges,
  publishChecks,
  publishLabel,
  reviewRefusal,
  runBuildCheck,
} from "./publish-changes";
import {
  PUBLISH_TABS,
  PUBLISH_TAB_TITLES,
  isPublishDestination,
  isPublishTab,
} from "./publish-ids";
import {
  armGitPoll,
  checkoutBranch,
  commitRow,
  createBranch,
  discardFile,
  fetchGitLog,
  fetchRemote,
  includeNewChanges,
  lastUpdatedLabel,
  platformHostsGit,
  readGitDiff,
  pullRemote,
  refreshGitStatus,
  relativeDate,
  runCloneRepository,
  setAllIncluded,
  setIncluded,
  platformSupportsClone,
} from "./source-control";
import type { EffectScope } from "@vue/reactivity";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { ShellPublish } from "../shell";
import type { Tab } from "../tabs/tab";
import type { GitFileStatus } from "../types";
import type { PagesDeploymentInfo } from "./pages-service";
import type { PublishCheck } from "./publish-changes";
import type { PublishTab } from "./publish-ids";
import type {
  BranchRow,
  CommandButtonRow,
  DeploymentRow,
  PublishCheckRow,
  PublishLayout,
  PublishWorkspaceActions,
  PublishWorkspaceSurfaceHandle,
  PublishWorkspaceView,
  ReviewChangeView,
  ReviewItemRow,
  ReviewNoticeView,
  SetupStepState,
} from "../surfaces/publish-workspace";

// ─── Deployments ─────────────────────────────────────────────────────────────

/**
 * Ask the host for every deployment of the connected project.
 *
 * Asked when Deploys is shown and on Refresh, never on a timer: a deployment list is a request to
 * someone else's API. The newest row is also the deploy checklist's observation, so the status bar
 * moves off "not asked" the first time anybody looks.
 */
export async function loadDeployments(): Promise<void> {
  const deploy = currentDeploy();
  if (!deploy || !platformSupportsPublish() || shell.publish.deploys.state === "loading") {
    return;
  }
  /* The record this read writes into, held across the await. A project switch replaces the record
     (`resetProjectShell`), and a config edit can point `build.deploy` at another Pages project; an
     answer that arrives after either is about something no longer on screen, so it is dropped,
     and in particular never becomes the new project's checklist observation. */
  const record = shell.publish.deploys;
  const project = deploy.projectName;
  const stale = (): boolean =>
    shell.publish.deploys !== record || currentDeploy()?.projectName !== project;
  record.state = "loading";
  record.project = project;
  try {
    const rows = await listDeployments(deploy);
    if (stale()) {
      settleStale(record);
      return;
    }
    record.rows = rows;
    record.error = "";
    record.state = "loaded";
    noteDeployment(rows[0] ?? null);
  } catch (error) {
    if (stale()) {
      settleStale(record);
      return;
    }
    record.rows = [];
    record.error = errorMessage(error);
    record.state = "failed";
  }
}

/** A dropped answer must not leave a record still on screen marked `loading` for ever. */
function settleStale(record: ShellPublish["deploys"]): void {
  if (shell.publish.deploys === record) {
    record.state = "idle";
  }
}

/**
 * Whether a deploy has finished since the list was read: the deploy checklist observed a deployment
 * (`runDeploy` records the one it waited for) that the listed rows do not have.
 */
function listIsBehind(): boolean {
  const seen = observedDeployment();
  const { deploys } = shell.publish;
  return (
    deploys.state === "loaded" && seen !== null && !deploys.rows.some((row) => row.id === seen.id)
  );
}

/** Whether Deploys, when shown, has to ask again. */
function deploysNeedReading(): boolean {
  return shell.publish.deploys.state === "idle" || listIsBehind();
}

// ─── Showing a sub-tab ───────────────────────────────────────────────────────

/**
 * Show one sub-tab, and start the read it needs: the log for Review changes, the deployment list
 * for Deploys. Called by the strip, by `publish.open { tab }` and by the quick dialog's Review
 * all.
 */
export function showPublishTab(tab: PublishTab): void {
  shell.publish.tab = tab;
  if (tab === "review" && shell.git.logEntries === null && shell.git.status?.isRepo) {
    void fetchGitLog();
  }
  if (tab === "deploys" && (shell.publish.deploys.state !== "loaded" || listIsBehind())) {
    void loadDeployments();
  }
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * The kit icon a check wears, and the words that say its state to a reader who cannot see the
 * icon's shape or colour. Names from the kit's glyph manifest (`@jxsuite/ui/icons`), not text
 * glyphs: a `·` or a `?` beside a sentence read as punctuation, and said nothing to a screen
 * reader.
 */
const CHECK_STATE: ReadonlyMap<PublishCheck["state"], { icon: string; label: string }> = new Map([
  ["done", { icon: "check", label: "Passed" }],
  ["failed", { icon: "x", label: "Failed" }],
  ["running", { icon: "spinner", label: "Running" }],
  ["todo", { icon: "warning-circle", label: "To do" }],
  ["unknown", { icon: "question", label: "Not checked yet" }],
]);

/** The icon and state words for a check's state; an unknown state reads as not checked. */
export function checkStateMark(state: PublishCheck["state"]): { icon: string; label: string } {
  return CHECK_STATE.get(state) ?? { icon: "question", label: "Not checked yet" };
}

/** "1 change", "3 changes". */
function changes(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

/** The changed files, as the status last listed them. */
function changedFiles(): readonly GitFileStatus[] {
  return shell.git.status?.files ?? [];
}

/** The remote the status names first, or `""`. */
function firstRemote(): string {
  const remotes = shell.git.status?.remotes;
  return Array.isArray(remotes) && remotes.length > 0 ? (remotes[0] ?? "") : "";
}

/** Which of the four moods Review changes is in; the same four the Source Control panel had. */
function moodOf(): PublishWorkspaceView["mood"] {
  if (!projectState) {
    return "no-project";
  }
  const { error, loading, status } = shell.git;
  if (!status && !loading && !error) {
    return "loading";
  }
  return status && !status.isRepo ? "no-repo" : "repo";
}

/** The branch a commit lands on now. */
function branchName(): string {
  return shell.git.branches?.current || shell.git.status?.branch || "";
}

/** "Up to date", or "2 ahead, 1 behind". */
function syncLabel(): string {
  const { status } = shell.git;
  const ahead = status?.ahead ? `${status.ahead} ahead` : "";
  const behind = status?.behind ? `${status.behind} behind` : "";
  return ahead || behind ? [ahead, behind].filter(Boolean).join(", ") : "Up to date";
}

/** The line under the heading: where the author is, and how much there is to publish. */
function headline(mood: PublishWorkspaceView["mood"]): string {
  if (mood === "no-repo") {
    return "Not tracked by git yet";
  }
  if (mood !== "repo") {
    return "";
  }
  const count = changedFiles().length;
  const where = branchName() ? `On ${branchName()}` : "On a branch with no name yet";
  return `${where} · ${count > 0 ? `${changes(count)} to publish` : "nothing to publish"}`;
}

// ─── Review changes ──────────────────────────────────────────────────────────

/** The project's resolved `i18n`, which names a page in a locale folder. */
function projectI18n() {
  return projectState?.projectConfig ? resolveI18n(projectState.projectConfig).i18n : null;
}

/** Every change, as Review changes states it (`publish/review-changes.ts`). */
export function currentReviewItems(): ReviewItem[] {
  return reviewItems(changedFiles(), projectI18n());
}

/** The change Review changes shows in its centre, or null when there is none. */
export function currentReviewItem(): ReviewItem | null {
  return selectedReviewItem(currentReviewItems(), shell.publish.selected);
}

/** One change as the list draws it, every control named after the thing it acts on. */
function reviewItemRow(item: ReviewItem, selected: string | null): ReviewItemRow {
  const file = changedFiles().find((entry) => entry.path === item.path);
  return {
    cannotDiscard: file?.status === "U",
    discardLabel: `Discard changes to ${item.label}`,
    includeLabel: `Include ${item.label} in this publish`,
    included: item.included,
    key: item.path,
    kind: item.kind,
    label: item.label,
    path: item.path,
    selected: item.path === selected ? "true" : "false",
    tag: item.tag,
    tagLabel: item.tagLabel,
  };
}

/** The heading over the centre. */
function reviewChangeView(item: ReviewItem | null): ReviewChangeView {
  return item
    ? {
        label: item.label,
        summary: item.summary,
        tag: item.tag,
        tagLabel: item.tagLabel,
        url: item.url,
      }
    : { label: "", summary: "", tag: "edit", tagLabel: "", url: "" };
}

/**
 * The centre when there is nothing to compare: the image itself for an image that is still on disk,
 * and the reason a comparison cannot be drawn, or that it is being read.
 */
function reviewNoticeView(item: ReviewItem | null): ReviewNoticeView {
  if (!item) {
    return { hasImage: false, image: "", imageAlt: "", text: "" };
  }
  const image =
    item.tag !== "delete" && isViewableMedia(item.path) ? previewFileSrc(item.path) : "";
  const text = !item.refusal
    ? "Reading this change…"
    : image
      ? item.tag === "new"
        ? "A new file. It is published as it is shown here."
        : "This file is replaced by the one shown here."
      : item.refusal;
  return { hasImage: image !== "", image, imageAlt: image ? item.label : "", text };
}

/** The view Review changes draws its comparison as: the compared file's, held while it is shown. */
let _viewTab: { path: string; tab: Tab } | null = null;

/**
 * The tab Review changes' artboards are a view OF, for the file at `path`.
 *
 * The pane's own tab is the Publish home, which has no path, and a page is drawn from its path:
 * which layout wraps it, where its components and its media resolve from (§21). So the comparison
 * is drawn as a view of the file itself, through a tab made for the purpose and never opened: it
 * routes no edits (a comparison's frames route none), and it carries the default view settings a
 * file opened fresh would have. One is kept, for the file on screen, and a new file replaces it.
 *
 * @param {string} path The compared file
 */
export function reviewViewTab(path: string): Tab {
  if (_viewTab?.path === path) {
    return _viewTab.tab;
  }
  if (_viewTab) {
    disposeTab(_viewTab.tab);
  }
  const tab = createTab({
    canvasMode: "git-diff",
    document: { children: [], tagName: "div" },
    documentPath: path,
    id: `publish-review:${path}`,
  });
  _viewTab = { path, tab };
  return tab;
}

/**
 * What the two sides of Review changes' comparison are called: what is on the site now, and what
 * publishing puts there (studio.md §22.8). A side that has no file says so.
 *
 * @param fileStatus The change's git status letter.
 */
export function reviewSideLabels(fileStatus: string) {
  return {
    current: fileStatus === "D" ? "Removed by publishing" : "After publishing",
    original: fileStatus === "A" || fileStatus === "U" ? "Not published yet" : "Last published",
  };
}

/** A command, as a button: drawn only while the registry has it and shows it. */
function commandRows(ids: readonly string[]): CommandButtonRow[] {
  const registry = activeRegistry();
  if (!registry) {
    return [];
  }
  return ids.flatMap((id) => {
    const command = registry.get(id);
    if (!command || !registry.isVisible(id)) {
      return [];
    }
    const reason = registry.disabledReason(id);
    return [
      {
        disabled: reason !== undefined,
        id,
        label: command.title,
        title: reason ? `${command.title}: requires ${reason}` : command.title,
      },
    ];
  });
}

/** One check, with the one button that resolves it, when there is one. */
function checkRow(check: PublishCheck): PublishCheckRow {
  const base = {
    actionDisabled: false,
    actionLabel: "",
    actionTitle: "",
    hasAction: false,
    icon: checkStateMark(check.state).icon,
    iconLabel: checkStateMark(check.state).label,
    key: check.key,
    state: check.state,
    text: check.text,
  };
  if (check.key === "build") {
    if (check.state === "running" || !canCheckBuild()) {
      return base;
    }
    const label = check.state === "unknown" ? "Check build" : "Check again";
    return { ...base, actionLabel: label, actionTitle: label, hasAction: true };
  }
  const [row] = check.command ? commandRows([check.command]) : [];
  return row
    ? {
        ...base,
        actionDisabled: row.disabled,
        actionLabel: row.label,
        actionTitle: row.title,
        hasAction: true,
      }
    : base;
}

/**
 * The production deployment serving the site now: the newest one whose last stage succeeded. The
 * host lists newest first, but the order is not trusted.
 */
function liveDeploymentId(rows: readonly PagesDeploymentInfo[]): string {
  const [live] = rows
    .filter((row) => row.environment === "production" && deploymentSucceeded(row))
    .toSorted((a, b) => Date.parse(b.createdOn) - Date.parse(a.createdOn));
  return live?.id ?? "";
}

/** Whether a deployment finished: its last stage, `deploy`, reported success. */
function deploymentSucceeded(info: PagesDeploymentInfo): boolean {
  return info.status === "success" && info.stage === "deploy";
}

/**
 * A deployment's state in words, as the board draws it. The stage and status Cloudflare reported
 * (`deploy: success`) stay on the row as its tooltip.
 */
function deploymentStatusWord(info: PagesDeploymentInfo, liveId: string): string {
  if (info.status === "failure") {
    return "Failed";
  }
  if (info.status === "canceled") {
    return "Canceled";
  }
  if (!deploymentSucceeded(info)) {
    return "Building…";
  }
  if (info.environment !== "production") {
    return "Ready";
  }
  return info.id === liveId ? "Live" : "Replaced";
}

/** One deployment as a row. */
function deploymentRow(info: PagesDeploymentInfo, liveId: string): DeploymentRow {
  const production = info.environment === "production";
  const label = production
    ? `Production${info.branch ? ` · ${info.branch}` : ""}`
    : info.branch || "Preview";
  return {
    environment: info.environment,
    key: info.id,
    label,
    openLabel: `Open ${label}`,
    status: deploymentStatusWord(info, liveId),
    statusDetail: `${info.stage}: ${info.status}`,
    statusKey: info.status,
    url: info.url,
    when: relativeDate(info.createdOn),
  };
}

/** Deploys' list state: a note when there is nothing to ask, else the listing's state. */
function deploysState(): Pick<PublishWorkspaceView, "deploysNote" | "deploysState"> {
  if (!platformSupportsPublish()) {
    return {
      deploysNote:
        "This host cannot reach the Cloudflare API, so deployments are not listed here. Your " +
        "host runs bunx jx build and serves dist/.",
      deploysState: "note",
    };
  }
  if (!currentDeploy()) {
    return {
      deploysNote: "Connect a host under Hosting, and every deployment it makes is listed here.",
      deploysState: "note",
    };
  }
  if (shell.publish.deploys.state === "failed") {
    return {
      deploysNote: `The host did not answer: ${shell.publish.deploys.error}`,
      deploysState: "note",
    };
  }
  return {
    deploysNote: "",
    deploysState: shell.publish.deploys.state === "loaded" ? "listed" : "loading",
  };
}

/** The rows the host returned, when they are about the project connected now. */
function deploymentRows(): PagesDeploymentInfo[] {
  return shell.publish.deploys.project === currentDeploy()?.projectName
    ? shell.publish.deploys.rows
    : [];
}

/**
 * The site's production address: what the connected host reports, else the Production URL the
 * project configures (`project.json` `url`, Project Settings › Overview), else nothing. One reader,
 * so Deploys, Hosting and Settings never disagree about where the site lives (studio.md §22.8).
 */
function productionAddress(): string {
  return currentDeploy()?.productionUrl || projectState?.projectConfig?.url || "";
}

/** The sentence under Your address: where the address came from, or how the site gets one. */
function domainNote(address: string): string {
  const deploy = currentDeploy();
  if (deploy?.productionUrl) {
    return "Cloudflare Pages serves it. A custom domain is added on the Cloudflare dashboard.";
  }
  if (deploy) {
    return "Cloudflare has not reported an address yet. A custom domain is added on the Cloudflare dashboard.";
  }
  return address
    ? "The Production URL in Project Settings › Overview. No host is connected yet; once one is, point this domain at it on the host's dashboard."
    : "Your site gets an address when a host is connected, or set its Production URL in Project Settings › Overview.";
}

/** The live site's line: its latest production deployment, said in words. */
function liveSummary(rows: readonly PagesDeploymentInfo[]): string {
  if (!currentDeploy()) {
    return productionAddress()
      ? "No host is connected, so Studio cannot say what is deployed there. Connect one under Hosting."
      : "";
  }
  /* The newer of what the list said and what a deploy since then observed: a Publish live that
     deployed is the live site before the list is read again. */
  const listed = rows.find((row) => row.environment === "production");
  const seen = observedDeployment();
  const observed = seen && (seen.environment === "production" || !listed) ? seen : undefined;
  const [latest] = [listed, observed]
    .filter((row): row is PagesDeploymentInfo => row !== undefined)
    .toSorted((a, b) => Date.parse(b.createdOn) - Date.parse(a.createdOn));
  if (!latest) {
    return "No deployment has been observed yet.";
  }
  const from = latest.branch ? ` from ${latest.branch}` : "";
  return `Last deployed ${relativeDate(latest.createdOn)}${from} · ${latest.stage}: ${latest.status}`;
}

/** Where the project is saved, in a sentence. */
function sourceSummary(): string {
  const { status } = shell.git;
  if (!projectState) {
    return "";
  }
  if (!status) {
    return "Source control has not reported on this project yet.";
  }
  if (!status.isRepo) {
    return "Not tracked by git yet. A repository keeps every version you publish.";
  }
  const branch = branchName() || "an unnamed branch";
  const remote = firstRemote();
  if (platformHostsGit()) {
    return `Saved on GitHub${remote ? ` (${remote})` : ""}, on ${branch}. Every commit lands there as it is made.`;
  }
  return remote
    ? `Saved in git and pushed to ${remote}, on ${branch}.`
    : `Saved in git on this machine only, on ${branch}. A host builds from a remote, so create the GitHub repository next.`;
}

/** The source rows' commands, for the state the repository is in. */
function sourceCommandIds(): string[] {
  const { status } = shell.git;
  if (!status) {
    return ["git.signInToGithub"];
  }
  if (!status.isRepo) {
    return ["git.init", "git.signInToGithub"];
  }
  if (firstRemote() === "") {
    return ["git.createGithubRepository", "git.signInToGithub"];
  }
  return platformHostsGit() ? ["git.signInToGithub"] : ["git.push", "git.signInToGithub"];
}

/** A Hosting setup step as its mark draws it. */
function setupStep(done: boolean): SetupStepState {
  return done ? { label: "Done", state: "done" } : { label: "To do", state: "todo" };
}

/** The host block: which host, and what connecting it buys. */
function hostView(): Pick<PublishWorkspaceView, "hostSummary" | "hostTitle"> {
  const deploy = currentDeploy();
  if (deploy) {
    return {
      hostSummary:
        `Every publish is pushed to the remote and built by Cloudflare Pages` +
        `${deploy.productionUrl ? ` at ${deploy.productionUrl}` : ""}.`,
      hostTitle: `Cloudflare Pages: ${deploy.projectName}`,
    };
  }
  if (hasPlatform() && getPlatform().cfConnect) {
    return {
      hostSummary:
        "Runs on Cloudflare with nothing to configure: connect it, and every publish builds and deploys.",
      hostTitle: "Jx Cloud, on Cloudflare",
    };
  }
  if (platformSupportsPublish()) {
    return {
      hostSummary:
        "Connect a Cloudflare API token, and every publish builds and deploys on your own account.",
      hostTitle: "Your Cloudflare account",
    };
  }
  return {
    hostSummary:
      "This host cannot reach Cloudflare. Choose a build adapter below; your host runs bunx jx build and serves dist/.",
    hostTitle: "Another host",
  };
}

/**
 * Everything the document draws, as one value, for the pane `region` names.
 *
 * @param region The pane's region (`pane.primary/publish`), which also seeds the document's ids.
 */
export function publishWorkspaceView(
  region: string,
  layout: PublishLayout = "home",
): PublishWorkspaceView {
  const idBase = region.replaceAll(/[^\w-]/g, "-");
  const mood = moodOf();
  const { git } = shell;
  const files = changedFiles();
  const staged = files.filter((file) => file.staged).length;
  const { destination: chosen, tab } = shell.publish;
  const destination = effectiveDestination(chosen);
  const blocker = mood === "repo" ? publishBlocker(destination) : "";
  const refusal = chosen === "review" ? reviewRefusal() : "";
  const pr = lastPullRequest();
  const commits = git.logEntries ?? [];
  const deploy = currentDeploy();
  const address = productionAddress();
  const rows = deploymentRows();
  const previews = rows.filter((row) => row.environment === "preview");
  const liveId = liveDeploymentId(rows);
  const running = activities.filter((entry) => entry.source === "Publish" && !isFinished(entry));
  const branches = git.branches?.branches ?? [];
  const current = git.branches?.current ?? "";
  const hosted = platformHostsGit();
  const remote = firstRemote();
  const checklist = deployChecklistView();
  const count = files.length;
  const items = layout === "home" ? [] : currentReviewItems();
  const review = { items, selected: selectedReviewItem(items, shell.publish.selected) };
  return {
    ...deploysState(),
    ...hostView(),
    // A host builds from a remote; a host whose git is the remote's has one by construction.
    stepAddress: setupStep(address !== ""),
    stepHosted: setupStep(deploy !== undefined),
    stepSaved: setupStep(hosted || remote !== ""),
    allIncluded: count > 0 && staged === count,
    blocker,
    branchNote: hosted
      ? "Each branch opens in its own session, so switching reloads Studio on that branch."
      : "",
    branchSummary: current ? `On ${current}` : "",
    branches: branches.map((name): BranchRow => ({
      current: name === current,
      key: name,
      name,
      note: remote ? syncLabel() : "Local only",
      switchLabel: hosted ? "Switch and reload" : "Switch",
      switchName: hosted ? `Switch to ${name} and reload` : `Switch to ${name}`,
    })),
    branchesEmpty:
      mood === "no-repo"
        ? "This project is not tracked by git yet."
        : "No branches yet. The first commit makes one.",
    branchesState: branches.length > 0 ? "listed" : "empty",
    busy: git.loading,
    canClone: platformSupportsClone(),
    change: reviewChangeView(review.selected),
    checklistSteps: checklist.steps,
    checklistSummary: checklist.summary,
    checks: mood === "repo" ? publishChecks().map((check) => checkRow(check)) : [],
    commitRegion: `${region}/commit`,
    commits: commits.map((entry) => commitRow(entry)),
    commitsState: commits.length > 0 ? "listed" : "empty",
    deployCommands: commandRows(
      deploy ? ["publish.deploy", "publish.openDashboard"] : ["publish.setUp"],
    ),
    deploysBusy: shell.publish.deploys.state === "loading",
    destination,
    destinationId: `${idBase}-destination`,
    destinations: destinationChoices(chosen),
    domain: address,
    domainNote: domainNote(address),
    domainState: address ? "set" : "none",
    error: git.error ?? "",
    filesState: count > 0 ? "listed" : "empty",
    hasBlocker: blocker !== "",
    hasBranchNote: hosted,
    hasError: Boolean(git.error),
    hasLastUpdated: Boolean(git.lastUpdated),
    hasLiveUrl: address !== "",
    hasRefusal: refusal !== "",
    headline: headline(mood),
    history: rows.map((row) => deploymentRow(row, liveId)),
    historyState: rows.length > 0 ? "listed" : "empty",
    hostCommands: commandRows(
      deploy ? ["publish.setUp", "publish.openDashboard"] : ["publish.setUp"],
    ),
    includedLabel: count > 0 ? `${staged} of ${count} included` : "",
    items: review.items.map((item) => reviewItemRow(item, review.selected?.path ?? null)),
    layout,
    lastUpdated: lastUpdatedLabel(git.lastUpdated),
    liveNone: deploy
      ? "The host has not reported an address for this site yet."
      : "No host is connected. Connect one under Hosting, and every publish ships to it.",
    liveSummary: liveSummary(rows),
    liveUrl: address,
    mood,
    notice: reviewNoticeView(review.selected),
    newBranchDisabled: git.loading || mood !== "repo",
    panelId: `${idBase}-body`,
    previews: previews.map((row) => deploymentRow(row, liveId)),
    previewsState: previews.length > 0 ? "listed" : "empty",
    primaryDisabled: mood !== "repo" || blocker !== "",
    primaryLabel: publishLabel(destination),
    pullLabel: git.status?.behind ? `Pull (${git.status.behind} behind)` : "Pull",
    pushLabel: git.status?.ahead ? `Push (${git.status.ahead} ahead)` : "Push",
    refusal,
    region,
    remoteState: remote ? "remote" : "local",
    reviewLine: pr ? `Pull request #${pr.number} is open for review.` : "",
    reviewState: pr ? "opened" : "none",
    reviewUrl: pr?.url ?? "",
    running: running.map((entry) => activityRowView(entry)),
    runningState: running.length > 0 ? "running" : "none",
    someIncluded: staged > 0 && staged < count,
    sourceCommands: commandRows(sourceCommandIds()),
    sourceSummary: sourceSummary(),
    summary: git.commitMessage,
    syncLabel: remote ? syncLabel() : "Local only (no remote)",
    tab,
    tabTitle: PUBLISH_TAB_TITLES[tab],
    tabs: PUBLISH_TABS.map((value) => ({
      label:
        value === "review" && count > 0
          ? `${PUBLISH_TAB_TITLES[value]} (${count})`
          : PUBLISH_TAB_TITLES[value],
      value,
    })),
    titleId: `${idBase}-title`,
  };
}

// ─── The actions ─────────────────────────────────────────────────────────────

/** Where the build adapter's section is mounted, per pane. */
const _adapterHosts = new Map<string, HTMLElement>();

/** The adapter each mounted section last drew, so a re-projection that changed nothing is free. */
const _adapterShown = new WeakMap<HTMLElement, string>();

/** The adapter `project.json` names now, as the Deploy section reads it. */
function configuredAdapter(): string {
  return projectState?.projectConfig?.build?.adapter || "static";
}

/**
 * Draw (or redraw) a pane's build-adapter section when the adapter on file is not the one it last
 * drew. The picker is someone else's surface, mounted into a node of this document, so it does not
 * follow this document's state: Raw JSON, the Code view or a collaborator can change the adapter
 * while Hosting is open, and this is what brings the picker along.
 */
function syncAdapterSection(paneId: string): void {
  const adapter = configuredAdapter();
  const host = _adapterHosts.get(paneId);
  if (!host?.isConnected || _adapterShown.get(host) === adapter) {
    return;
  }
  _adapterShown.set(host, adapter);
  renderDeploySection(host);
}

/** Run a check's button: the deploy step's command, or the build. */
function runCheck(key: string): void {
  if (key === "build") {
    void runBuildCheck();
    return;
  }
  const check = publishChecks().find((entry) => entry.key === key);
  if (check?.command) {
    void runActiveReported(check.command, undefined, "Publish");
  }
}

/** Every control's verb, bound to the pane it was drawn in. */
function actionsFor(paneId: string): PublishWorkspaceActions {
  return {
    adapterHost: (element) => {
      // Hosting was drawn again (the sub-tab came back): the section in the node it left goes.
      const previous = _adapterHosts.get(paneId);
      if (previous && previous !== element) {
        disposeDeploySection(previous);
      }
      _adapterHosts.set(paneId, element);
      _adapterShown.set(element, configuredAdapter());
      renderDeploySection(element);
    },
    checkout: (name) => {
      void checkoutBranch(name);
    },
    clone: () => {
      runCloneRepository();
    },
    /* The three verbs that are records run AS records, so a refusal (Create GitHub Repository on a
       project git does not track) is the record's, and no button here reaches past it
       (`studio-ui-guidelines.md` §12.5). */
    createRepository: () => {
      void runActiveReported("git.createGithubRepository", undefined, "Publish");
    },
    discard: (path) => {
      void discardFile(path);
    },
    editSummary: (value) => {
      shell.git.commitMessage = value;
    },
    fetch: () => {
      void fetchRemote();
    },
    include: (path, included) => {
      void setIncluded(path, included);
    },
    includeAll: (included) => {
      void setAllIncluded(included);
    },
    initRepository: () => {
      void runActiveReported("git.init", undefined, "Publish");
    },
    newBranch: () => {
      void createBranch();
    },
    openUrl: (url) => {
      if (url) {
        openUrlExternally(url);
      }
    },
    pick: (path) => {
      shell.publish.selected = path;
    },
    pickDestination: (value) => {
      if (isPublishDestination(value)) {
        shell.publish.destination = value;
      }
    },
    publish: () => {
      void publishChanges(effectiveDestination(shell.publish.destination));
    },
    pull: () => {
      void pullRemote();
    },
    push: () => {
      void runActiveReported("git.push", undefined, "Publish");
    },
    refresh: () => {
      void refreshGitStatus();
    },
    reloadDeployments: () => {
      void loadDeployments();
    },
    run: (commandId) => {
      void runActiveReported(commandId, undefined, "Publish");
    },
    runCheck,
    selectTab: (tab) => {
      if (isPublishTab(tab)) {
        showPublishTab(tab);
      }
    },
  };
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface PaneMount {
  tabId: string;
  wrap: HTMLElement;
  handle: PublishWorkspaceSurfaceHandle;
  scope: EffectScope;
}

/** The workspace mounted in each pane, keyed by pane id. */
const _panes = new Map<string, PaneMount>();

/**
 * Give the keyboard back to Publish in `paneId`: what leaving a view with Back does
 * (`workspace/workspace-back.ts`). Review changes' list holds the change the centre shows, so the
 * keyboard lands on it rather than on the page body. A pane with no list standing gives nothing.
 *
 * @param {string} paneId
 */
export function focusPublishHome(paneId: string): void {
  const list = _regions.get(paneId)?.get("changes");
  const current = list?.host.querySelector<HTMLElement>(
    '[part="change-pick"][aria-current="true"]',
  );
  current?.focus();
}

/** Whether this tab's workspace is already mounted in this pane and still in the document. */
export function publishWorkspaceMounted(paneId: string, tab: Tab): boolean {
  const pane = _panes.get(paneId);
  return (
    pane !== undefined && pane.tabId === tab.id && pane.wrap.isConnected && pane.handle.attached()
  );
}

/** Tear one pane's workspace down (mode change, tab switch, project close). Idempotent. */
export function detachPublishWorkspace(paneId: string): void {
  detachReviewRegions(paneId);
  const pane = _panes.get(paneId);
  if (!pane) {
    return;
  }
  pane.scope.stop();
  const host = _adapterHosts.get(paneId);
  if (host) {
    disposeDeploySection(host);
  }
  pane.handle.dispose();
  _panes.delete(paneId);
  _adapterHosts.delete(paneId);
}

/**
 * Draw the Publish home into a pane's stage.
 *
 * The first mount is what starts the first read, and a read that already FAILED must not re-arm it
 * (Refresh and the poll are the ways back), which is what the `loading` mood means. The background
 * poll is armed once a repository has been seen.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderPublishWorkspace(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap } = surface;
  if (publishWorkspaceMounted(paneId, tab)) {
    return;
  }
  detachPublishWorkspace(paneId);
  if (hasPlatform() && moodOf() === "loading") {
    void refreshGitStatus();
  }
  showPublishTab(shell.publish.tab);
  /* The region names the pane; nothing else in the projection is about one. The rows it draws from
     commands are project-level records, so the registry's answer is the same in either pane. */
  const region = paneRegion(paneId, "publish");
  const handle = mountPublishWorkspaceSurface(
    wrap,
    publishWorkspaceView(region),
    actionsFor(paneId),
  );
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      const view = publishWorkspaceView(region);
      if (view.mood === "repo") {
        armGitPoll();
      }
      handle.update(view);
      syncAdapterSection(paneId);
      // Deploys follows a deploy that finished since it was read, wherever that deploy was run.
      if (view.tab === "deploys" && deploysNeedReading()) {
        void loadDeployments();
      }
    });
  });
  _panes.set(paneId, { handle, scope, tabId: tab.id, wrap });
}

// ─── Review changes' stage ───────────────────────────────────────────────────

/**
 * The stage hosts Review changes' comparison draws around itself, and the region of this document
 * each one is given (`surfaces/canvas-stage.json`'s review layout, studio.md §22.8).
 */
const REVIEW_REGIONS: ReadonlyMap<string, PublishLayout> = new Map([
  ["review-head", "head"],
  ["review-changes", "changes"],
  ["review-change", "change"],
  ["review-notice", "notice"],
  ["review-side", "side"],
]);

/** The stage parts `canvas/canvas-render.ts` hands to {@link attachReviewRegion}. */
export const REVIEW_REGION_PARTS: ReadonlySet<string> = new Set(REVIEW_REGIONS.keys());

interface RegionMount {
  host: HTMLElement;
  handle: PublishWorkspaceSurfaceHandle;
  scope: EffectScope;
}

/** Each pane's mounted regions, by region. */
const _regions = new Map<string, Map<PublishLayout, RegionMount>>();

/** Take one region down. */
function disposeRegion(mount: RegionMount): void {
  mount.scope.stop();
  mount.handle.dispose();
}

/**
 * Mount one region of this document into a host the stage just drew.
 *
 * Each region is its own mount with its own effect, projecting the same view the home does through
 * `layout`, so the list, the heading and the publish column cannot disagree with each other or with
 * the home about what is included, what is chosen or what the button will do. A host drawn again
 * (the stage's layout came back) replaces the mount in the one it left.
 *
 * @param {string} paneId
 * @param {string} part The stage part, one of {@link REVIEW_REGION_PARTS}
 * @param {HTMLElement} host
 */
export function attachReviewRegion(paneId: string, part: string, host: HTMLElement): void {
  const layout = REVIEW_REGIONS.get(part);
  if (!layout) {
    return;
  }
  let regions = _regions.get(paneId);
  if (!regions) {
    regions = new Map();
    _regions.set(paneId, regions);
  }
  const previous = regions.get(layout);
  if (previous?.host === host) {
    return;
  }
  if (previous) {
    disposeRegion(previous);
  }
  const region = paneRegion(paneId, "publish");
  const handle = mountPublishWorkspaceSurface(
    host,
    publishWorkspaceView(region, layout),
    actionsFor(paneId),
  );
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      handle.update(publishWorkspaceView(region, layout));
    });
    /* The list is Review changes showing its changes, so it is what the home's own mount does
       while it stands: keep the status current while Publish is showing, and include what it has
       not shown before, so a change set opens with every change included. */
    if (layout === "changes") {
      effect(() => {
        if (moodOf() === "repo") {
          armGitPoll();
          void includeNewChanges();
        }
      });
    }
  });
  regions.set(layout, { handle, host, scope });
}

/** Take every region of a pane's Review changes stage down. Idempotent. */
export function detachReviewRegions(paneId: string): void {
  const regions = _regions.get(paneId);
  if (!regions) {
    return;
  }
  for (const mount of regions.values()) {
    disposeRegion(mount);
  }
  _regions.delete(paneId);
}

// ─── Review changes' selection ───────────────────────────────────────────────

/** What the review controller needs from the bootstrap. */
export interface PublishReviewDeps {
  /** Switch a tab's editor (`studio.ts` `setCanvasMode`). */
  setCanvasMode: (tab: Tab, mode: string) => void;
}

/** The Publish home's own mode, and the one it is put in while Review changes compares. */
const HOME_MODE = "publish-home";
const REVIEW_MODE = "git-diff";

/**
 * Whether Review changes draws its comparison stage: it is the sub-tab showing, the project is a
 * repository, and something has changed. Otherwise the home draws itself (loading, no repository,
 * nothing to publish, and the other three sub-tabs).
 */
export function reviewDrawsStage(): boolean {
  const { status } = shell.git;
  return shell.publish.tab === "review" && Boolean(status?.isRepo) && changedFiles().length > 0;
}

/** Read the comparison of the change the centre shows, unless it is already in hand. */
async function loadReviewComparison(item: ReviewItem): Promise<void> {
  try {
    const state = await readGitDiff(item.path, item.status);
    // Only while it is still the change the centre shows: a second pick may have overtaken it.
    if (reviewDrawsStage() && currentReviewItem()?.path === item.path) {
      shell.git.diffState = state;
    }
  } catch (error) {
    shell.git.error = `Failed to load the comparison: ${errorMessage(error)}`;
  }
}

let _reviewScope: EffectScope | null = null;

/**
 * Keep Review changes' centre on a change, and the Publish home in the mode that draws it.
 *
 * Three facts, one effect each, the last only while Publish is showing. While the stage is wanted
 * the home tab is in `git-diff` (studio.md §22.8), and out of it otherwise, so the other sub-tabs
 * and the empty states are the home's own surface. The centre always shows a change: the one
 * picked, or the first when the pick has published, been discarded or never happened. And the
 * comparison of that change is read when it is not the one in hand; a file that changed again is
 * re-read by source control's own revalidation (§21.5), not here.
 *
 * Started once by the bootstrap; calling it again replaces the previous run.
 */
export function startPublishReview(deps: PublishReviewDeps): void {
  _reviewScope?.stop();
  const scope = effectScope();
  _reviewScope = scope;
  scope.run(() => {
    effect(() => {
      const tab = workspace.tabs.get(workspaceHomeTabId("publish"));
      if (!tab) {
        return;
      }
      const wanted = reviewDrawsStage() ? REVIEW_MODE : HOME_MODE;
      if (tab.session.ui.canvasMode !== wanted) {
        deps.setCanvasMode(tab, wanted);
      }
    });
    effect(() => {
      if (!reviewDrawsStage()) {
        return;
      }
      const item = currentReviewItem();
      if (item && shell.publish.selected !== item.path) {
        shell.publish.selected = item.path;
      }
    });
    effect(() => {
      // Read only while Publish is showing: elsewhere nobody is looking at the comparison.
      if (shell.workspace !== "publish" || !reviewDrawsStage()) {
        return;
      }
      const item = currentReviewItem();
      if (item?.refusal) {
        if (shell.git.diffState) {
          shell.git.diffState = null;
        }
        return;
      }
      if (item && shell.git.diffState?.filePath !== item.path) {
        void loadReviewComparison(item);
      }
    });
  });
}
