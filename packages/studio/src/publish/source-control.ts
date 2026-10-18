/// <reference lib="dom" />
/**
 * Source control: what git is asked, in what order, and what each verb does before it runs.
 *
 * This is the flow the Publish workspace owns (studio.md §5.5, §22.8). It used to be the Source
 * Control Navigator panel's own module, and the panel's buttons were the only door to most of it;
 * the panel is gone, and its verbs live here so that Review changes, Branches, the quick publish
 * dialog, the palette and the deploy checklist all run ONE list of them (`studio-ui-guidelines.md`
 * §12.5). Nothing here draws: `publish/publish-workspace.ts` projects `shell.git` into its surface,
 * and every write lands on that one hoisted record.
 *
 * Three rules worth knowing before editing it.
 *
 * **Every verb ends in a refresh.** {@link gitAction} runs the platform call under one loading and
 * error contract and re-reads the status after it, because a commit, a discard or a checkout moves
 * the working tree and the count on the Publish tab is read from the status.
 *
 * **A comparison follows the working tree.** A comparison is two texts read once, so a save or a
 * commit does not reach it on its own; {@link refreshGitStatus} and {@link noteFileSaved} bump
 * `shell.git.rev` (which re-issues a Diff lens's read) and re-read the one comparison
 * {@link openFileComparison} opened (§21.5).
 *
 * **The platform's git semantics decide the copy, not an assumption.** On a host whose commits land
 * on the remote and whose branches are sessions (`StudioPlatform.gitHosted`, the cloud), a checkout
 * reloads the window, so {@link checkoutBranch} asks first.
 *
 * @docs studio/publish/source-control
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { isFunction } from "@jxsuite/schema/guards";
import type { GitDiffState, GitFileStatus, StudioPlatform } from "../types";
import { getPlatform, hasPlatform } from "../platform";
import { now } from "../services/clock";
import {
  PAGES_COLLECTION,
  collectionKeyOfPath,
  contentCollections,
} from "../content/content-collections";
import { MEDIA_EXTENSIONS, extensionOf } from "../files/media-types";
import { projectState } from "../store";
import { comparisonRefusal, openComparisonTab } from "../panels/git-diff-open";
import type { Tab } from "../tabs/tab";
import { shell } from "../shell";
import type { GitLogEntry } from "../shell";
import { showConfirmDialog, showPromptDialog } from "../ui/layers";
import { POLL_GIT } from "../ui/timing";
import { notify } from "../services/notify";
import { authenticateGithub } from "../github/github-auth";
import { createGithubRepository } from "../github/github-publish";
import { pullWithPackageSync } from "../packages/pull-package-sync";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

// ─── Reading the repository ───────────────────────────────────────────────────

/**
 * Read the status, then the branch list when the status says there is a repository.
 *
 * In that order, not in parallel. Outside a repository of its own the branch route refuses (`409
 * conflict`, studio.md §22.8), and asked alongside the status it did so on every refresh: a failed
 * request in the console each time for a project that cannot have branches. A failure of either
 * read is the workspace's error line; a failed status still leaves the refresh to bump the
 * revision, because nothing about the tree is known to be unchanged.
 */
async function readStatusAndBranches(): Promise<void> {
  const plat = getPlatform();
  const { git } = shell;
  let status;
  try {
    status = await plat.gitStatus();
  } catch (error) {
    git.error = errorMessage(error);
    return;
  }
  git.status = status;
  if (!status.isRepo) {
    git.branches = null;
    return;
  }
  try {
    git.branches = await plat.gitBranches();
  } catch (error) {
    git.error = errorMessage(error);
  }
}

/** Re-read the status and the branch list, then every comparison that depends on them. */
export async function refreshGitStatus(): Promise<void> {
  if (!projectState) {
    return;
  }
  const { git } = shell;
  git.loading = true;
  git.error = null;
  try {
    await readStatusAndBranches();
    git.lastUpdated = now();
    /* THE COMPARISON FOLLOWS THE TREE. Every git verb that can move the working tree ends here —
       commit, discard, checkout, pull, fetch — and so does the 30s poll that notices a change made
       outside Studio. Bumping the revision is what re-issues a Diff lens's read; the comparison
       this module opened is re-read below, because nothing else owns it. */
    git.rev += 1;
    await rereadOpenComparison();
    // The log moves with a commit, a pull or a checkout too; once it has been shown, keep it current.
    if (git.logEntries !== null) {
      await fetchGitLog();
    }
  } catch (error) {
    git.error = errorMessage(error);
  } finally {
    git.loading = false;
  }
}

/**
 * Re-read the comparison {@link openFileComparison} has open, against the status just fetched.
 *
 * A file that is no longer changed loses its comparison rather than keeping a stale one: the stage
 * then draws "Nothing to compare", which is the truth and is what the author's own commit just made
 * true. A read that fails leaves the previous comparison up: a momentary git error is not a reason
 * to blank a review someone is in the middle of.
 */
async function rereadOpenComparison(): Promise<void> {
  const state = shell.git.diffState;
  if (!state) {
    return;
  }
  const change = shell.git.status?.files.find((file) => file.path === state.filePath);
  if (!change || !isDiffableStatus(change.status)) {
    shell.git.diffState = null;
    return;
  }
  try {
    shell.git.diffState = await readGitDiff(state.filePath, change.status);
  } catch {
    // Intentionally ignored: the comparison on screen is still the last one that read cleanly.
  }
}

/**
 * Re-read an open comparison because THIS file was just saved.
 *
 * Separate from the git-status path, and deliberately: the status the comparison was opened with is
 * the right one to re-read against, because the file has not changed its relationship to HEAD by
 * being written, only its contents.
 *
 * @param {string | null} path - The project-relative path just written.
 */
export async function noteFileSaved(path: string | null): Promise<void> {
  shell.git.rev += 1;
  /* The count of unpublished changes is drawn on the Publish workspace tab in every workspace, and
     the poll only runs while Publish is showing, so a save re-reads the status itself. Not
     awaited: the comparison below does not depend on it. */
  if (!shell.git.loading) {
    void refreshGitStatus();
  }
  const state = shell.git.diffState;
  if (!path || state?.filePath !== path) {
    return;
  }
  try {
    shell.git.diffState = await readGitDiff(path, state.fileStatus);
  } catch {
    // Intentionally ignored: see rereadOpenComparison.
  }
}

/** Fetch the recent commits. A failure is the workspace's one error line, like any verb's. */
export async function fetchGitLog(): Promise<void> {
  try {
    shell.git.logEntries = await getPlatform().gitLog(30);
  } catch (error) {
    shell.git.error = errorMessage(error);
  }
}

// ─── Cloning ─────────────────────────────────────────────────────────────────

/**
 * Show a dialog to clone a git repository, then open what it cloned.
 *
 * @param {{ openRecentProject: (root: string) => Promise<void> }} ctx
 */
export async function cloneRepository(ctx: {
  openRecentProject: (root: string) => Promise<void>;
}): Promise<void> {
  const platform = getPlatform();
  if (!platform.gitClone) {
    notify.warn("Cloning is not supported on this platform.", { source: "Source Control" });
    return;
  }
  const url = await showPromptDialog("Clone Git Repository", {
    confirmLabel: "Clone",
    message: "Repository URL",
    placeholder: "https://github.com/user/repo.git",
    validate: (v) => (v.trim() ? "" : "Enter a repository URL."),
  });
  if (!url) {
    return;
  }
  try {
    notify.info("Cloning repository…", { key: "git.clone", source: "Source Control" });
    const result = await platform.gitClone(url);
    if (result.root) {
      notify.success("Clone complete.", { key: "git.clone" });
      await ctx.openRecentProject(result.root);
    }
  } catch (error) {
    notify.error("Could not clone the repository.", {
      detail: errorMessage(error),
      key: "git.clone",
      source: "Source Control",
    });
  }
}

/**
 * Whether this platform can clone at all.
 *
 * `hasPlatform()` first, because the question is asked by the Start pane before a platform may be
 * registered and `getPlatform()` THROWS when nothing has registered one. "There is no platform" is
 * an answer to this question (no, it cannot clone) rather than a failure.
 */
export function platformSupportsClone(): boolean {
  return hasPlatform() && Boolean(getPlatform().gitClone);
}

/**
 * Whether commits on this host land on the remote and a branch is a session of its own (the cloud).
 * Asked by every verb whose consequence differs: a checkout there reloads the window.
 */
export function platformHostsGit(): boolean {
  return hasPlatform() && getPlatform().gitHosted === true;
}

/** Whether this host can open a pull request (`StudioPlatform.createPullRequest`). */
export function platformOpensPullRequests(): boolean {
  return hasPlatform() && isFunction(getPlatform().createPullRequest);
}

// ─── Comparisons ─────────────────────────────────────────────────────────────

/** How each status reads aloud. The badge is one letter and a colour, which a label cannot be. */
const STATUS_WORDS = new Map([
  ["A", "added"],
  ["D", "deleted"],
  ["M", "modified"],
  ["R", "renamed"],
  ["U", "untracked"],
]);

/** A status letter, said aloud: "modified". An unknown letter still says the file changed. */
export function statusWord(status: string): string {
  return STATUS_WORDS.get(status) ?? "changed";
}

/** A status letter as the short tag a compact list prints (the quick publish dialog's). */
const STATUS_TAGS = new Map([
  ["A", "NEW"],
  ["D", "DELETED"],
  ["M", "EDIT"],
  ["R", "RENAMED"],
  ["U", "NEW"],
]);

/** A status letter as a tag: "EDIT". An unknown letter still says the file changed. */
export function statusTag(status: string): string {
  return STATUS_TAGS.get(status) ?? "EDIT";
}

/** The statuses a comparison can be built for. `R` is absent: see {@link isDiffableStatus}. */
export const DIFFABLE_STATUSES = new Set(["M", "A", "U", "D"]);

/**
 * Whether this file's change can be opened as a comparison at all.
 *
 * `R` (renamed) is the one that cannot: `GitFileStatus` carries a single `path`, so the old name is
 * not in hand and there is nothing to compare the new one against. Better refused by name than
 * shown as a whole-file rewrite.
 */
export function isDiffableStatus(fileStatus: string): boolean {
  return DIFFABLE_STATUSES.has(fileStatus);
}

/**
 * One file's comparison against HEAD: the committed text and the working copy.
 *
 * One definition site, because there are two callers: a changed file's **Before / after** in Review
 * changes, and `workspace/pane-derive.ts`'s Diff lens, which must not reach `shell.git.diffState`
 * (that slot holds whatever Review changes last opened, a different file, §18.4).
 *
 * Each side is read only where it exists: `M` reads both; `A` and `U` have no `HEAD` copy, so the
 * original is the empty string; `D` is the mirror, with no working copy.
 *
 * @param {string} path
 * @param {string} fileStatus
 * @returns {Promise<GitDiffState>}
 */
export async function readGitDiff(path: string, fileStatus: string): Promise<GitDiffState> {
  const plat = getPlatform();
  const inHead = fileStatus !== "A" && fileStatus !== "U";
  const onDisk = fileStatus !== "D";
  const [originalContent, currentContent] = await Promise.all([
    inHead ? plat.gitShow({ path, ref: "HEAD" }) : Promise.resolve(""),
    onDisk ? plat.readFile(path) : Promise.resolve(""),
  ]);
  return { currentContent, filePath: path, fileStatus, originalContent };
}

/**
 * The Diff lens's reader: {@link readGitDiff}, with a failure the PANE can state.
 *
 * @param {string} path
 * @param {string} fileStatus
 * @returns {Promise<GitDiffState | null>}
 */
export async function loadDiffForLens(
  path: string,
  fileStatus: string,
): Promise<GitDiffState | null> {
  try {
    return await readGitDiff(path, fileStatus);
  } catch (error) {
    // Reported where it can be acted on (the pane says so) rather than as a toast over a document
    // The author did not ask about.
    console.warn("loadDiffForLens:", errorMessage(error));
    return null;
  }
}

/**
 * What the bootstrap injects: the two writes a comparison makes outside `shell.git`, and the clone
 * flow that needs `openRecentProject`.
 */
export interface SourceControlDeps {
  setCanvasMode?: (tab: Tab | null, mode: string) => void;
  setGitDiffState?: (state: GitDiffState | null) => void;
  cloneRepository?: () => void;
}

let _deps: SourceControlDeps = {};

/** Hand the flow what the bootstrap owns. Replaces whatever was injected before. */
export function setSourceControlDeps(deps: SourceControlDeps): void {
  _deps = deps;
}

/** Run the injected clone flow. A no-op before the bootstrap has injected one. */
export function runCloneRepository(): void {
  _deps.cloneRepository?.();
}

/** The changed file at this path, as the last status read saw it. */
export function changedFileAt(path: string): GitFileStatus | undefined {
  return shell.git.status?.files.find((file: GitFileStatus) => file.path === path);
}

/**
 * Open one changed file's comparison, on that file's OWN tab.
 *
 * Every changed row opens something, and it opens the file it names: renderability decides which
 * VIEW opens (§21.3), never whether the row responds. Only `R` is refused, and out loud. The tab is
 * keyed by the clicked path, so the strip and the stage agree (§14.1); a comparison tab belongs to
 * Publish (§22.1), and it is active only once it is in `git-diff` (`openComparisonTab`), so opening
 * one never leaves the workspace. The one tab per path also means a document already open in Design
 * moves to Publish while it shows its comparison, and back when its editor is chosen again.
 */
export async function openFileComparison(path: string): Promise<void> {
  const file = changedFileAt(path);
  if (!file) {
    return;
  }
  const refusal = isDiffableStatus(file.status)
    ? comparisonRefusal(file.path, file.status)
    : `"${file.path}" has no change this view can open.`;
  if (refusal) {
    shell.git.error = refusal;
    return;
  }
  try {
    shell.git.loading = true;
    const diffState = await readGitDiff(file.path, file.status);
    shell.git.diffState = diffState;
    // Handed to the canvas before the tab opens, because it opens already in `git-diff`.
    _deps.setGitDiffState?.(diffState);
    const tab = await openComparisonTab(file.path);
    if (tab) {
      _deps.setCanvasMode?.(tab, "git-diff");
    }
  } catch (error) {
    shell.git.error = `Failed to load diff: ${errorMessage(error)}`;
  } finally {
    shell.git.loading = false;
  }
}

// ─── Verbs ───────────────────────────────────────────────────────────────────

/**
 * Run one platform git verb under the one loading/error contract, then re-read the status.
 *
 * @param run Calls the verb on the platform it is handed.
 * @returns Whether the action succeeded; its failure is already on screen.
 */
export async function gitAction(run: (plat: StudioPlatform) => Promise<void>): Promise<boolean> {
  const plat = getPlatform();
  shell.git.loading = true;
  shell.git.error = null;
  try {
    await run(plat);
    await refreshGitStatus();
    return true;
  } catch (error) {
    shell.git.error = errorMessage(error);
    shell.git.loading = false;
    return false;
  }
}

/**
 * Start tracking this project with git.
 *
 * A function rather than an inline click handler because it is a command ({@link
 * sourceControlCommands}), the first step of the deploy checklist and a button in Review changes,
 * and three copies of the same three lines is how they come to disagree about what the verb does.
 */
export async function initRepository(): Promise<void> {
  try {
    notify.info("Initializing repository…", { key: "git.init" });
    await getPlatform().gitInit();
    notify.success("Repository initialized.", { key: "git.init" });
  } catch (error) {
    notify.error("Could not initialize the repository.", {
      action: "git.init",
      detail: errorMessage(error),
      key: "git.init",
      source: "Source Control",
    });
    return;
  }
  await refreshGitStatus();
}

/** Push the current branch. Same loading/error contract as every other verb. */
export async function pushCurrentBranch(): Promise<void> {
  await gitAction((plat) => plat.gitPush());
}

/** Fetch from the remote. */
export async function fetchRemote(): Promise<void> {
  await gitAction((plat) => plat.gitFetch());
}

/** Pull through the package-aware orchestrator, under the same contract as {@link gitAction}. */
export async function pullRemote(): Promise<void> {
  shell.git.loading = true;
  shell.git.error = null;
  try {
    await pullWithPackageSync();
    await refreshGitStatus();
  } catch (error) {
    shell.git.error = errorMessage(error);
    shell.git.loading = false;
  }
}

/** Create the GitHub repository for this project, named after it. */
export async function createRepository(): Promise<void> {
  await createGithubRepository({ projectName: projectState?.name || "my-project" });
}

/**
 * Sign in to GitHub, or report why it could not.
 *
 * The report belongs to `github/github-auth.ts`: this only says what a SUCCESS was, which that
 * module cannot, because it is also called mid-flow by "Create GitHub Repository".
 */
export async function signInToGithub(): Promise<void> {
  const token = await authenticateGithub();
  if (token) {
    notify.success("Signed in to GitHub.", { key: "github.auth" });
  }
}

/**
 * Include a file in the next publish, or leave it out: the Review changes checkbox.
 *
 * Including is staging. A file is included exactly when the index holds it, so the checkbox reads
 * the status and never a second record of the choice.
 */
export async function setIncluded(path: string, included: boolean): Promise<void> {
  await gitAction((plat) => (included ? plat.gitStage([path]) : plat.gitUnstage([path])));
}

/** Include every changed file, or leave every one out. */
export async function setAllIncluded(included: boolean): Promise<void> {
  const paths = (shell.git.status?.files ?? [])
    .filter((file: GitFileStatus) => Boolean(file.staged) !== included)
    .map((file: GitFileStatus) => file.path);
  if (paths.length === 0) {
    return;
  }
  await gitAction((plat) => (included ? plat.gitStage(paths) : plat.gitUnstage(paths)));
}

/**
 * The changed paths Review changes has already shown, for the project it showed them in.
 *
 * Module state rather than a field of `shell.git`: it is read and written from inside an effect,
 * and it says nothing anybody draws. A path leaves it when it leaves the status (committed or
 * discarded), so its next change is new again.
 */
interface ShownChanges {
  /** The project the paths belong to (`projectState.projectRoot`). */
  root: string;
  paths: Set<string>;
}

let _shown: ShownChanges = { paths: new Set(), root: "" };

/**
 * The changes Review changes has not shown before and git does not have staged: what an untouched
 * change set includes by default. Marks every listed path as shown, so a file the author then
 * leaves out stays out.
 */
export function unshownUnstagedChanges(): string[] {
  const root = projectState?.projectRoot ?? "";
  if (_shown.root !== root) {
    _shown = { paths: new Set(), root };
  }
  const files = shell.git.status?.files ?? [];
  const listed = new Set(files.map((file) => file.path));
  for (const path of _shown.paths) {
    if (!listed.has(path)) {
      _shown.paths.delete(path);
    }
  }
  const fresh = files.filter((file) => !_shown.paths.has(file.path));
  for (const file of fresh) {
    _shown.paths.add(file.path);
  }
  return fresh.filter((file) => !file.staged).map((file) => file.path);
}

/**
 * Include the changes Review changes is showing for the first time.
 *
 * Included means staged, so a change set nobody has curated opens with every change included, as
 * the quick dialog publishes it, rather than "0 of 5 included" with the primary button refused. A
 * read in flight is waited out (the effect calling this re-runs when it settles), so a path is
 * never marked shown against a status that is about to change.
 */
export async function includeNewChanges(): Promise<void> {
  if (shell.git.loading || !shell.git.status?.isRepo) {
    return;
  }
  const paths = unshownUnstagedChanges();
  if (paths.length > 0) {
    await gitAction((plat) => plat.gitStage(paths));
  }
}

/**
 * Discard one file's changes, once the reader has said so. An untracked file has nothing to go back
 * to.
 */
export async function discardFile(path: string): Promise<void> {
  if (changedFileAt(path)?.status === "U") {
    return;
  }
  const confirmed = await showConfirmDialog("Discard Changes", `Discard changes to ${path}?`, {
    confirmLabel: "Discard",
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  await gitAction((plat) => plat.gitDiscard([path]));
}

/** Ask for a name and create (and check out) a branch from the current one. */
export async function createBranch(): Promise<void> {
  const { branches, status } = shell.git;
  const name = await showPromptDialog("New Branch", {
    confirmLabel: "Create",
    message: `Branching from ${branches?.current || status?.branch || "the current branch"}.`,
    placeholder: "feature/my-change",
    validate: (v) => (v.trim() ? "" : "Enter a branch name."),
  });
  if (name) {
    await gitAction((plat) => plat.gitCreateBranch(name.trim()));
  }
}

/**
 * Check a branch out.
 *
 * On a host where a branch is a session (the cloud), a checkout is a page load into that branch's
 * session, so the author is asked first: nothing about the word "Switch" says the window will
 * reload.
 */
export async function checkoutBranch(name: string): Promise<void> {
  if (name === shell.git.branches?.current) {
    return;
  }
  if (platformHostsGit()) {
    const confirmed = await showConfirmDialog(
      "Switch Branch",
      `Each branch opens in its own session, so switching to ${name} reloads Studio on that branch.`,
      { confirmLabel: "Switch and reload" },
    );
    if (!confirmed) {
      return;
    }
  }
  await gitAction((plat) => plat.gitCheckout(name));
}

// ─── Change rows, grouped ────────────────────────────────────────────────────

/** One changed file, as every list of changes draws it. Values only. */
export interface ChangeRow {
  /** The project-relative path: the row's key and what every control hands back. */
  key: string;
  path: string;
  /** The last segment, which is what the row reads as. */
  name: string;
  /** Everything before it, drawn small beside the name. */
  dir: string;
  hasDir: boolean;
  /** The one-letter badge: `M`, `A`, `D`, `R`, `U`. */
  status: string;
  /** The status said aloud. */
  statusWord: string;
  /** The path and the status in words: what the row's controls are named after. */
  label: string;
  /** Whether the next publish includes it: the index holds it. */
  included: boolean;
  /** An untracked file has no committed version to go back to. */
  cannotDiscard: boolean;
}

/** One component's changed files, under the heading {@link groupFilesByComponent} spelled. */
export interface ChangeGroup {
  key: string;
  name: string;
  files: ChangeRow[];
}

/** One changed file as a row. The path is split here: "the name and its folder" is a path rule. */
export function changeRow(file: GitFileStatus): ChangeRow {
  const parts = file.path.split("/");
  const name = parts.pop() ?? file.path;
  const dir = parts.join("/");
  const word = statusWord(file.status);
  return {
    cannotDiscard: file.status === "U",
    dir,
    hasDir: dir !== "",
    included: Boolean(file.staged),
    key: file.path,
    label: `${file.path}, ${word}`,
    name,
    path: file.path,
    status: file.status,
    statusWord: word,
  };
}

/** The project folders a change is filed under by name, after the content collections. */
const FOLDER_GROUPS: readonly (readonly [folder: string, name: string])[] = [
  ["components", "Components"],
  ["layouts", "Layouts"],
  ["styles", "Styles"],
];

/** The group key of a change: a collection's key, `folder:<name>`, `media` or `other`. */
function changeGroupKey(path: string): string {
  const collection = collectionKeyOfPath(path);
  if (collection !== null) {
    return collection;
  }
  const [top] = path.split("/");
  // A page directory's private part (`pages/_partials/…`) is no route, but it is still the pages.
  if (top === "pages") {
    return PAGES_COLLECTION;
  }
  if (FOLDER_GROUPS.some(([folder]) => folder === top)) {
    return `folder:${top}`;
  }
  return MEDIA_EXTENSIONS.has(extensionOf(path)) ? "media" : "other";
}

/**
 * Group the changed files the way the site is organised: Pages, then each content collection the
 * project declares (by its title), then Components, Layouts, Styles, Media and Other, in that order
 * and only when non-empty. Within a group the files keep the order git listed them.
 *
 * Not by folder name. The last folder of a path is no unit of a site: `content/events/en` and
 * `content/exhibitions/en` both ended in `/en` and were filed together, and every file at the root
 * got a heading of its own (studio.md §22.8).
 */
export function groupFilesByComponent(files: readonly GitFileStatus[]): ChangeGroup[] {
  const order: [key: string, name: string][] = [
    ...contentCollections().map((collection): [string, string] => [
      collection.key,
      collection.title,
    ]),
    ...FOLDER_GROUPS.map(([folder, name]): [string, string] => [`folder:${folder}`, name]),
    ["media", "Media"],
    ["other", "Other"],
  ];
  const grouped = new Map<string, GitFileStatus[]>();
  for (const file of files) {
    const key = changeGroupKey(file.path);
    grouped.set(key, [...(grouped.get(key) ?? []), file]);
  }
  return order.flatMap(([key, name]) => {
    const entries = grouped.get(key);
    return entries ? [{ files: entries.map((entry) => changeRow(entry)), key, name }] : [];
  });
}

/** One commit, as the log draws it. */
export interface CommitRow {
  key: string;
  /** The short hash, already sliced. */
  hash: string;
  message: string;
  /** "ada · 5m ago": the author and the age, joined by the flow that knows the clock. */
  meta: string;
}

/** One log entry as a row. The clock is read here, which is why {@link relativeDate} is. */
export function commitRow(entry: GitLogEntry): CommitRow {
  return {
    hash: entry.hash.slice(0, 7),
    key: entry.hash,
    message: entry.message,
    meta: `${entry.author} · ${relativeDate(entry.date)}`,
  };
}

/**
 * An age, relative to {@link now}.
 *
 * Exported so it is testable at all: reading the wall clock inline meant "yesterday" and the
 * locale-date fallback could only be asserted against an offset from the real present.
 *
 * @param {string} iso
 */
export function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return d.toLocaleDateString();
}

/** The moment of the last successful refresh, as the workspace prints it. */
export function lastUpdatedLabel(stamp: number | null): string {
  return stamp
    ? `Last updated ${new Date(stamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";
}

// ─── The poll ────────────────────────────────────────────────────────────────

/**
 * The background refresh handle. The interval is infrastructure, not state: what it refreshes is on
 * `shell.git`, so opening a second project inherits nothing from the first.
 */
let _pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Arm the background refresh, once. Idempotent.
 *
 * It refreshes only while the Publish workspace is showing and no read is in flight: the count on
 * the Publish tab is kept current by saves ({@link noteFileSaved}) everywhere else, and a poll that
 * ran in every workspace would spend a request every 30 seconds on a list nobody is looking at.
 */
export function armGitPoll(): void {
  if (_pollTimer) {
    return;
  }
  _pollTimer = setInterval(() => {
    if (shell.workspace === "publish" && !shell.git.loading) {
      void refreshGitStatus();
    }
  }, POLL_GIT);
}

/**
 * Stop the background refresh, and forget which changes Review changes has shown. Called whenever a
 * different project is opened: everything the poll refreshes belongs to ONE repository, and so does
 * every path that has been shown.
 */
export function cleanupSourceControl(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _shown = { paths: new Set(), root: "" };
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * The `Source Control:` family.
 *
 * Every one of them was once reachable from exactly one place, and the fourth (signing in to
 * GitHub) from nowhere at all. Naming them gives the palette, `__jxAutomation`, the deploy
 * checklist, the Publish workspace's Hosting and every `notify` Retry the same four ids, which is
 * why they are kept as they are (§5.5).
 *
 * `git.signInToGithub` is `application`-level and the other three are `project`-level, and the
 * split is the credential's: a GitHub token is one per machine, while a branch, a remote and a push
 * belong to one repository.
 */
export function sourceControlCommands(): AnyCommand[] {
  return [
    {
      category: "Source Control",
      id: "git.init",
      level: "project",
      menus: ["commandbar/overflow", "palette"],
      group: "7_scm",
      requires: "an open project that git is not already tracking",
      when: (ctx) => ctx.project.open,
      // `when` already asked about the project; an `enablement` that re-asks is the same rule
      // Written twice, and the two places drift.
      enablement: (ctx) => !ctx.project.isRepo,
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's third deletion rule: outside the tree,
         irreversible, and the model has no read to judge by. */
      run: async () => {
        await initRepository();
      },
      title: "Initialize Repository",
    },
    {
      category: "Source Control",
      id: "git.createGithubRepository",
      level: "project",
      menus: ["commandbar/overflow", "palette"],
      group: "7_scm",
      /* THE STRICTEST OF THE THREE, because it is the one that leaves something behind on a
         server: its flow creates the repository on GitHub BEFORE it touches the local one, so on an
         untracked project it would leave an empty repository on the author's account. */
      requires: "a project tracked by git",
      when: (ctx) => ctx.project.open,
      enablement: (ctx) => ctx.project.isRepo,
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's third deletion rule: it creates a
         repository on the person's account. */
      run: async () => {
        await createRepository();
      },
      title: "Create GitHub Repository",
    },
    {
      category: "Source Control",
      id: "git.push",
      level: "project",
      menus: ["commandbar/overflow", "palette"],
      group: "7_scm",
      requires: "a project tracked by git",
      when: (ctx) => ctx.project.open,
      enablement: (ctx) => ctx.project.isRepo,
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's third deletion rule. */
      run: async () => {
        await pushCurrentBranch();
      },
      title: "Push",
    },
    {
      category: "Source Control",
      id: "git.signInToGithub",
      level: "application",
      menus: ["palette"],
      group: "7_scm",
      run: async () => {
        await signInToGithub();
      },
      title: "Sign In to GitHub",
    },
  ];
}

/** Register the `Source Control:` family. */
export function registerSourceControlCommands(registry: CommandRegistry): void {
  registry.registerAll(sourceControlCommands());
}
