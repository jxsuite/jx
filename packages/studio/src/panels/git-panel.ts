/// <reference lib="dom" />
/**
 * Source Control — the Navigator panel: sync status, the branch, Local Changes and History.
 *
 * **The body is a Jx document** (`surfaces/git-panel.json`, mounted by `surfaces/git-panel.ts`), so
 * this module draws no markup: it projects. What stays here is everything that is a DECISION — what
 * git is asked and in what order, what a comparison is and which file has one, how changed files
 * group into components, what a status letter reads aloud, what a commit does before it runs, and
 * which of the four moods the panel is in. The surface reads values.
 *
 * Three consequences worth knowing before editing it.
 *
 * The first is that the panel keeps ITSELF up to date. A lit body was redrawn because the Navigator
 * repainted, and the Navigator repainted on this panel's own badge — a coincidence that happened to
 * cover most changes to `shell.git`. {@link mountGitPanel} owns an `effect()` instead, so a
 * finished fetch, a typed commit message and a poll that noticed a change made outside Studio each
 * reach the document whether or not anything else on screen moved. `renderOnly("leftPanel")` is
 * gone with it.
 *
 * The second is that the split button's dropdown is the KIT MENU. It was a hand-built `<div>` with
 * a module-level `_splitMenuOpen` flag, and the flag existed only because the template declared the
 * menu `hidden` unconditionally and the two were fighting. `openMenu()` already owns roving focus,
 * light dismissal and Escape, so both the markup and the flag go.
 *
 * The third is the empty states. `panels/empty-state.ts` is a lit template a document cannot call,
 * so the three this panel used to render are drawn in the document — under the same §11 copy rules,
 * and, for the two that offer buttons, with the buttons still real. This was the last caller that
 * passed `EmptyStateAction.icon`, which is a `TemplateResult` of `sp-icon-*`.
 *
 * @docs studio/publish/source-control
 */

import { nothing } from "lit-html";
import { errorMessage } from "@jxsuite/schema/parse";
import { effect, effectScope } from "../reactivity";
import { flushAllCollab } from "../collab/collab-session";
import type { GitDiffState, GitFileStatus, StudioPlatform } from "../types";
import { getPlatform, hasPlatform } from "../platform";
import { now } from "../services/clock";
import { formatForPath } from "../format/format-host";
import { projectState } from "../store";
import { comparisonRefusal, openComparisonTab } from "./git-diff-open";
import type { Tab } from "../tabs/tab";
import { shell } from "../shell";
import type { GitLogEntry } from "../shell";
import { showConfirmDialog, showPromptDialog } from "../ui/layers";
import { POLL_GIT } from "../ui/timing";
import { registerPanel } from "./panel-registry";
import { notify } from "../services/notify";
import { authenticateGithub } from "../github/github-auth";
import { createGithubRepository } from "../github/github-publish";
import { pullWithPackageSync } from "../packages/pull-package-sync";
import { mountGitPanelSurface } from "../surfaces/git-panel";
import { rectOf } from "../utils/geometry";
import type {
  GitCommitView,
  GitFileRowView,
  GitGroupView,
  GitPanelActions,
  GitPanelSurfaceHandle,
  GitPanelValues,
} from "../surfaces/git-panel";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type { EffectScope } from "../reactivity";
import type { PanelBody } from "./panel-registry";

type GitFileEntry = GitFileStatus;

export async function refreshGitStatus() {
  if (!projectState) {
    return;
  }
  const plat = getPlatform();
  const { git } = shell;
  git.loading = true;
  git.error = null;
  try {
    // Settled independently, not Promise.all: outside a work tree `git branch` exits non-zero
    // While `git status` answers cleanly with isRepo:false. Letting the branch lookup reject the
    // Pair discarded that status, so the panel re-rendered its "no status yet" branch, refreshed
    // Again, and span — a request per render for as long as the tab stayed open.
    const [status, branches] = await Promise.allSettled([plat.gitStatus(), plat.gitBranches()]);
    if (status.status === "fulfilled") {
      git.status = status.value;
    }
    if (branches.status === "fulfilled") {
      git.branches = branches.value;
    }
    // A branch lookup that fails on a repo-less project is expected, not an error worth showing;
    // Anything else (including a failed status) surfaces.
    const failure: unknown =
      status.status === "rejected"
        ? status.reason
        : branches.status === "rejected" && status.value?.isRepo
          ? branches.reason
          : null;
    if (failure) {
      git.error = errorMessage(failure);
    }
    git.lastUpdated = now();
    /* THE COMPARISON FOLLOWS THE TREE. Every git verb that can move the working tree ends here —
       commit, discard, checkout, pull, fetch — and so does the 30s poll that notices a change made
       outside Studio. Bumping the revision is what re-issues a Diff lens's read; the panel's own
       slot is re-read below, because nothing else owns it. */
    git.rev += 1;
    await rereadOpenComparison();
  } catch (error) {
    git.error = errorMessage(error);
  } finally {
    git.loading = false;
  }
}

/**
 * Re-read the comparison the Source Control panel has open, against the status just fetched.
 *
 * A file that is no longer changed loses its comparison rather than keeping a stale one: the stage
 * then draws "Nothing to compare", which is the truth and is what the author's own commit just made
 * true. A read that fails leaves the previous comparison up — a momentary git error is not a reason
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
 * Separate from the git-status path, and deliberately: a save does not refresh `git.status`, so the
 * entry there may not exist yet for a file whose first edit this is. The status the comparison was
 * opened with is the right one to re-read against — the file has not changed its relationship to
 * HEAD by being written, only its contents.
 *
 * @param {string | null} path - The project-relative path just written.
 */
export async function noteFileSaved(path: string | null): Promise<void> {
  shell.git.rev += 1;
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

/**
 * Show a dialog to clone a git repository. Returns the cloned project root on success, or null.
 *
 * @param {{ openRecentProject: (root: string) => Promise<void> }} ctx
 */
export async function cloneRepository(ctx: { openRecentProject: (root: string) => Promise<void> }) {
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
    if (result?.root) {
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
 * `hasPlatform()` first, because the question is asked on every projection of the panel and
 * `getPlatform()` THROWS when nothing has registered one. "There is no platform" is an answer to
 * this question — no, it cannot clone — rather than a failure, and a projection that threw would
 * take the whole Navigator's render down with it.
 */
export function platformSupportsClone(): boolean {
  return hasPlatform() && Boolean(getPlatform().gitClone);
}

/**
 * One file's comparison against HEAD: the committed text and the working copy.
 *
 * **One definition site, because there are now two callers.** This panel's row click has always
 * made this pair of reads; `workspace/pane-derive.ts`'s Diff lens needs the same answer for the
 * document its source pane is showing, and it must not reach `shell.git.diffState` — that slot
 * holds whatever THIS panel last opened, which is a different file (§18.4, finding 4). A second
 * copy of these five lines is how the panel and the lens would come to disagree about what "the
 * diff of this file" means, which is the rule {@link initRepository} is written under too.
 *
 * **Each side is read only where it exists**, and every status is one of the four combinations:
 *
 * - `M` (modified) — both sides read.
 * - `A` (added) and `U` (untracked) — no `HEAD` copy, so the original is the empty string rather than
 *   a `gitShow` that would throw. The two differ only in whether the new file has been staged,
 *   which is not a fact a comparison cares about.
 * - `D` (deleted) — the mirror, and the one this function used to be unable to express: there is no
 *   working copy, so `readFile` would throw on a path that is gone, and the current side is empty.
 *
 * `gitChangeFor`'s docstring used to give "an untracked or deleted file has no pair of texts to put
 * side by side" as the REASON for narrowing to `M`/`A`. It was never true: one side is the empty
 * string, which is exactly what `A` had always done.
 *
 * @param {string} path
 * @param {string} fileStatus
 * @returns {Promise<GitDiffState>}
 */
/** How each status reads aloud. The badge is one letter and a colour, which a label cannot be. */
const STATUS_WORDS: Record<string, string> = {
  A: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  U: "untracked",
};

/** The statuses a comparison can be built for. `R` is absent — see {@link DIFFABLE_STATUSES}. */
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
 * A rejection here is not an error the shell should raise — the author asked to see a comparison
 * beside their page, and "could not read it" is a sentence the derived pane draws in its own empty
 * state. `applyDerivation` turns the `null` into exactly that.
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
    // Reported where it can be acted on — the pane says so — rather than as a toast over a
    // Document the author did not ask about.
    console.warn("loadDiffForLens:", errorMessage(error));
    return null;
  }
}

/**
 * Start tracking this project with git.
 *
 * A function rather than an inline click handler because it is now also a command ({@link
 * sourceControlCommands}) and the first step of the deploy checklist, and three call sites of the
 * same three lines is how the panel and the palette come to disagree about what a verb does.
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

/** Push the current branch. Same loading/error contract as every other panel verb. */
export async function pushCurrentBranch(): Promise<void> {
  await gitAction("gitPush");
}

/**
 * Sign in to GitHub, or report why it could not.
 *
 * The report belongs to `github/github-auth.ts` — this only says what a SUCCESS was, which that
 * module cannot, because it is also called mid-flow by "Create GitHub Repository" where a toast
 * saying "Signed in" in front of a half-finished operation would be noise.
 */
export async function signInToGithub(): Promise<void> {
  const token = await authenticateGithub();
  if (token) {
    notify.success("Signed in to GitHub.", { key: "github.auth" });
  }
}

/**
 * @param {string} action
 * @param {unknown} [body]
 */
async function gitAction(action: string, body?: unknown) {
  const plat = getPlatform() as Record<string, (...args: unknown[]) => Promise<unknown>> &
    StudioPlatform;
  shell.git.loading = true;
  shell.git.error = null;
  try {
    await plat[action]!(body);
    await refreshGitStatus();
  } catch (error) {
    shell.git.error = errorMessage(error);
    shell.git.loading = false;
  }
}

/** Pull via the package-aware orchestrator; same loading/error contract as gitAction. */
async function doPull() {
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

/**
 * The background refresh handle. The interval itself is infrastructure, not state — the sub-tab and
 * the "last updated" stamp it used to sit beside are on `shell.git`, so opening a second project no
 * longer inherits the first one's History selection and timestamp.
 */
let _pollTimer = null as ReturnType<typeof setInterval> | null;

async function fetchGitLog() {
  const plat = getPlatform();
  try {
    shell.git.logEntries = await plat.gitLog(30);
  } catch (error) {
    shell.git.error = errorMessage(error);
  }
}

/**
 * What the panel is drawn against, and the two writes a row click makes outside `shell.git`.
 *
 * A subset of `NavigatorPanelDeps`, named here so the projection and the actions state what they
 * use rather than taking the Navigator's whole injection list.
 */
export interface GitPanelDeps {
  setCanvasMode?: (tab: Tab | null, mode: string) => void;
  setGitDiffState?: (state: GitDiffState | null) => void;
  cloneRepository?: () => void;
}

/**
 * What the panel was mounted with, held at module scope rather than closed over.
 *
 * The standing surface outlives the repaint that mounted it — a row clicked ten repaints later must
 * reach the CURRENT diff-state setter — so the seat is rewritten on every `afterRender` and the
 * actions read it (`panels/elements-panel.ts` states the rule at its definition site).
 */
let _deps: GitPanelDeps = {};

/**
 * What the branch picker is showing, when that is not the branch that is checked out.
 *
 * A `<select>` always holds one of its options, and picking "New branch…" must put the control back
 * on the current branch when the dialog is dismissed. A document's binding only writes when the
 * SCOPE MOVES (guidelines §9.3), so writing the current branch over a scope that already said it
 * would be a no-op and the control would keep saying "New branch…". Announcing what the reader
 * actually chose first is what makes putting it back a change.
 */
let _branchOverride: string | null = null;

/**
 * One changed file, as the document draws it.
 *
 * The path is split HERE rather than in the surface, because "the name and the folder it is in" is
 * a decision about paths and the document only lays out two spans. The label is the same fact said
 * aloud: the badge beside it is one letter and a colour, which a screen reader cannot read.
 */
function fileRowView(file: GitFileEntry): GitFileRowView {
  const parts = file.path.split("/");
  const name = parts.pop() ?? file.path;
  const dir = parts.join("/");
  return {
    cannotDiscard: file.status === "U",
    dir,
    hasDir: dir !== "",
    key: file.path,
    label: `${file.path}, ${STATUS_WORDS[file.status] ?? "changed"}`,
    name,
    path: file.path,
    staged: Boolean(file.staged),
    status: file.status,
  };
}

/**
 * Group files by component — the parent directory for anything the app can render, "Other" for the
 * rest.
 */
function groupFilesByComponent(files: GitFileEntry[]): GitGroupView[] {
  const groups = new Map<string, GitFileEntry[]>();
  for (const f of files) {
    const parts = f.path.split("/");
    let component;
    if (f.path.endsWith(".json") || f.path.endsWith(".class.json") || formatForPath(f.path)) {
      component = parts.length > 1 ? `/${parts.at(-2)}` : `/${parts[0]}`;
    } else {
      component = "Other";
    }
    if (!groups.has(component)) {
      groups.set(component, []);
    }
    (groups.get(component) as GitFileEntry[]).push(f);
  }
  return [...groups.entries()].map(([name, entries]) => ({
    files: entries.map((entry) => fileRowView(entry)),
    key: name,
    name,
  }));
}

/** One commit, as the log draws it. The clock is read here, which is why {@link relativeDate} is. */
function commitView(entry: GitLogEntry): GitCommitView {
  return {
    hash: entry.hash.slice(0, 7),
    key: entry.hash,
    message: entry.message,
    meta: `${entry.author} · ${relativeDate(entry.date)}`,
  };
}

/** The moment of the last successful refresh, as the sync bar prints it. */
function lastUpdatedLabel(stamp: number | null): string {
  return stamp
    ? `Last updated ${new Date(stamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";
}

/**
 * Which of the four moods the panel is in.
 *
 * Exactly the four branches the lit template took, in the order it took them — and the second is
 * the one with a side effect somewhere else: `loading` means nothing has been read yet, and
 * {@link mountGitPanel} is what starts the read. A refresh that already FAILED must not land here,
 * or the render it triggers becomes the next render's reason to fetch again.
 */
function panelView(): GitPanelValues["view"] {
  if (!projectState) {
    return "no-project";
  }
  const { error, loading, status } = shell.git;
  if (!status && !loading && !error) {
    return "loading";
  }
  return status && !status.isRepo ? "no-repo" : "repo";
}

/**
 * What the surface should be showing right now.
 *
 * Exported because it is the whole of this module that is worth testing on its own: a pure function
 * of `projectState`, the hoisted `shell.git` record and the platform's capabilities. Read inside
 * {@link mountGitPanel}'s effect, so every reactive read it makes is a reason for the document to be
 * brought up to date.
 */
export function gitPanelValues(): GitPanelValues {
  const { branches, commitMessage, error, lastUpdated, loading, logEntries, status, subTab } =
    shell.git;
  const files = status?.files ?? [];
  const staged = files.filter((f: GitFileEntry) => f.staged);
  const unstaged = files.filter((f: GitFileEntry) => !f.staged);
  const all = [...staged, ...unstaged];
  const upToDate = !status?.ahead && !status?.behind;
  const ahead = status?.ahead ? `${status.ahead} ahead` : "";
  const behind = status?.behind ? `${status.behind} behind` : "";
  const commits = logEntries ?? [];
  const current = branches?.current ?? status?.branch ?? "";
  return {
    branchName: current || "—",
    branchOptions: [
      ...(branches?.branches ?? []).map((branch: string) => ({ label: branch, value: branch })),
      { label: "+ New branch…", value: NEW_BRANCH },
    ],
    branchValue: _branchOverride ?? branches?.current ?? "",
    busy: Boolean(loading),
    canClone: platformSupportsClone(),
    changedCount: String(all.length),
    changesLabel: all.length > 0 ? `Local Changes (${all.length})` : "Local Changes",
    commitMessage,
    commits: commits.map((entry: GitLogEntry) => commitView(entry)),
    error: error ?? "",
    filesState: all.length > 0 ? "listed" : "empty",
    groups: groupFilesByComponent(all),
    hasError: Boolean(error),
    hasLastUpdated: Boolean(lastUpdated),
    hasStaged: staged.length > 0,
    hasUnstaged: unstaged.length > 0,
    historyState: commits.length > 0 ? "listed" : "empty",
    lastUpdated: lastUpdatedLabel(lastUpdated),
    pullLabel: behind ? `Pull (${behind})` : "Pull",
    pushLabel: ahead ? `Push (${ahead})` : "Push",
    remoteState: (status?.remotes?.length ?? 0) > 0 ? "remote" : "local",
    stagedCount: String(staged.length),
    stagedFiles: staged.map((file: GitFileEntry) => fileRowView(file)),
    subTab,
    syncLabel: upToDate ? "Up to date" : `${ahead}${ahead && behind ? ", " : ""}${behind}`,
    view: panelView(),
  };
}

/** The picker row that means "make a new branch" rather than "check this one out". */
const NEW_BRANCH = "__new__";

/** The changed file at this path, as the last status read saw it. */
function fileAt(path: string): GitFileEntry | undefined {
  return shell.git.status?.files.find((file: GitFileEntry) => file.path === path);
}

/** Commit the message the field holds, if it holds one. Never a commit of nothing. */
async function doCommit(): Promise<void> {
  const message = shell.git.commitMessage.trim();
  if (!message) {
    return;
  }
  shell.git.commitMessage = "";
  // Fold co-editing sessions into the backend's tree first so the commit never misses trailing
  // Keystrokes (the mirror is debounced).
  await flushAllCollab();
  await gitAction("gitCommit", message);
}

/** Commit and push, as one operation with one loading state and one error. */
async function doCommitAndSync(): Promise<void> {
  const message = shell.git.commitMessage.trim();
  if (!message) {
    return;
  }
  shell.git.commitMessage = "";
  shell.git.loading = true;
  shell.git.error = null;
  await flushAllCollab();
  const plat = getPlatform();
  try {
    await plat.gitCommit(message);
    await plat.gitPush();
    await refreshGitStatus();
  } catch (error) {
    shell.git.error = errorMessage(error);
    shell.git.loading = false;
  }
}

/**
 * Check a branch out, or mint one.
 *
 * The override is what puts the control back: see {@link _branchOverride}.
 */
async function chooseBranch(value: string): Promise<void> {
  const { branches, status } = shell.git;
  if (value === NEW_BRANCH) {
    _branchOverride = NEW_BRANCH;
    syncGitPanel();
    const name = await showPromptDialog("New Branch", {
      confirmLabel: "Create",
      message: `Branching from ${branches?.current || status?.branch || "the current branch"}.`,
      placeholder: "feature/my-change",
      validate: (v) => (v.trim() ? "" : "Enter a branch name."),
    });
    _branchOverride = null;
    syncGitPanel();
    if (name) {
      await gitAction("gitCreateBranch", name);
    }
    return;
  }
  if (value !== branches?.current) {
    await gitAction("gitCheckout", value);
  }
}

/**
 * Open one changed file's comparison.
 *
 * EVERY changed row opens something, and it opens the file it names. Two silent returns used to
 * live here, and between them they made most of this panel inert: a status that was not `M`/`A`
 * returned, and then a path that was not `.json` and had no format class returned again. So a
 * changed `.ts`, `.css` or `.yaml` row did nothing at all when clicked, and neither did any deleted
 * or untracked file. Renderability now decides which VIEW opens, not whether the row responds; only
 * `R` is refused, and it is refused out loud.
 *
 * **And it opens the file's OWN tab.** This used to end in `setCanvasMode(activeTab.value,
 * "git-diff")` — the focused tab, whatever it was. Clicking `components/card.json` while
 * `pages/index.md` was open flipped the index.md TAB into git-diff and drew card.json's comparison
 * on it: the strip named one file and the stage drew another, which is the §14.1 identity defect
 * this repository has paid off three times elsewhere.
 */
async function openFileComparison(path: string): Promise<void> {
  const file = fileAt(path);
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
    /* The tab this comparison belongs to. A renderable document opens (or re-activates) the
       ordinary path-keyed tab it would have had anyway; anything else gets a stub tab keyed by the
       same path, the way a media file does. Either way the id is the path, so the strip and the
       stage agree. */
    const tab = await openComparisonTab(file.path);
    _deps.setGitDiffState?.(diffState);
    if (tab) {
      _deps.setCanvasMode?.(tab, "git-diff");
    }
  } catch (error) {
    shell.git.error = `Failed to load diff: ${errorMessage(error)}`;
  } finally {
    shell.git.loading = false;
  }
}

/**
 * Discard one file's changes, once the reader has said so. An untracked file has nothing to go back
 * to.
 */
async function discardFile(path: string): Promise<void> {
  if (fileAt(path)?.status === "U") {
    return;
  }
  const confirmed = await showConfirmDialog("Discard Changes", `Discard changes to ${path}?`, {
    confirmLabel: "Discard",
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  await gitAction("gitDiscard", [path]);
}

/**
 * The split button's second half.
 *
 * The kit menu, not a `<div>` of this panel's own: `openMenu()` owns the popover, the roving focus,
 * the light dismissal and Escape, and it is the answer this shell already settled on (§8.4). One
 * row, because there is one thing "Commit and sync" can do differently.
 */
function openCommitMenu(anchor: HTMLElement): void {
  /* Lazily imported for the reason `panels/problems-panel.ts` and `panels/empty-state.ts` already
     are: this module is on the static import path of the command registry, the rail and the Start
     pane, and a static edge would drag the whole overlay layer stack into each of them for a
     dropdown that only exists once somebody clicks it. */
  void import("../surfaces/menu.js").then(({ openMenu }) => {
    openMenu({
      label: "Commit options",
      opener: anchor,
      place: (box) => {
        const rect = rectOf(anchor);
        return { x: Math.max(4, rect.right - box.width), y: rect.bottom + 4 };
      },
      region: "git-commit",
      rows: [
        {
          destructive: false,
          disabled: false,
          dividerAbove: false,
          id: "git.commitWithoutSync",
          run: () => {
            void doCommit();
          },
          title: "Commit (don't sync)",
        },
      ],
    });
  });
}

/** Move to the other sub-tab, fetching the log the first time History is asked for. */
function selectTab(tab: string): void {
  shell.git.subTab = tab;
  if (tab === "history" && !shell.git.logEntries) {
    void fetchGitLog();
  }
}

/**
 * Everything a control can ask for, defined once.
 *
 * Every entry is a decision this module owns; the document only names it, and hands back the one
 * value it has — a path, a branch, the field's text.
 */
const ACTIONS: GitPanelActions = {
  chooseBranch: (value) => {
    void chooseBranch(value);
  },
  clone: () => {
    _deps.cloneRepository?.();
  },
  commit: () => {
    void doCommit();
  },
  commitAndSync: () => {
    void doCommitAndSync();
  },
  createRepository: () => {
    void createGithubRepository({ projectName: projectState?.name || "my-project" });
  },
  discard: (path) => {
    void discardFile(path);
  },
  editMessage: (value) => {
    shell.git.commitMessage = value;
  },
  fetch: () => {
    void gitAction("gitFetch");
  },
  initRepository: () => {
    void initRepository();
  },
  openCommitMenu,
  openFile: (path) => {
    void openFileComparison(path);
  },
  pull: () => {
    void doPull();
  },
  push: () => {
    void gitAction("gitPush");
  },
  refresh: () => {
    void refreshGitStatus();
  },
  selectTab,
  stage: (path) => {
    void gitAction("gitStage", [path]);
  },
  stageAll: () => {
    const paths = (shell.git.status?.files ?? [])
      .filter((file: GitFileEntry) => !file.staged)
      .map((file: GitFileEntry) => file.path);
    void gitAction("gitStage", paths);
  },
  unstage: (path) => {
    void gitAction("gitUnstage", [path]);
  },
  unstageAll: () => {
    const paths = (shell.git.status?.files ?? [])
      .filter((file: GitFileEntry) => file.staged)
      .map((file: GitFileEntry) => file.path);
    void gitAction("gitUnstage", paths);
  },
};

/** A mounted document, the node it is standing in, and the effect feeding it. */
interface Standing {
  host: HTMLElement;
  handle: GitPanelSurfaceHandle;
  scope: EffectScope;
}

/**
 * The one surface this panel has out, if any.
 *
 * One slot rather than a per-host map, because there is one Navigator: a mount into a DIFFERENT
 * node is the old one being replaced, and holding both would leave the first one's effect running
 * against a scope nobody reads any more.
 */
let _standing: Standing | null = null;

/** Take the document down and stop the effect feeding it. Safe to call when there is none. */
function unmountStanding(): void {
  if (!_standing) {
    return;
  }
  _standing.scope.stop();
  _standing.handle.dispose();
  _standing = null;
}

/**
 * Push a fresh projection at the standing document, now.
 *
 * The effect covers every reactive input; this covers the one that is not, {@link _branchOverride},
 * which is module state precisely because it is about the CONTROL rather than about the
 * repository.
 */
function syncGitPanel(): void {
  _standing?.handle.update(gitPanelValues());
}

/** Arm the background refresh, once. Idempotent — the effect calls it on every projection. */
function armPoll(): void {
  if (_pollTimer) {
    return;
  }
  _pollTimer = setInterval(() => {
    if (shell.leftTab === "git" && !shell.git.loading) {
      void refreshGitStatus();
    }
  }, POLL_GIT);
}

/**
 * Draw the panel — mounting the document the first time, and letting its own effect keep it current
 * every time after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed, for the
 * reason `panels/elements-panel.ts` states: only one of them is the node lit renders this panel's
 * body into, and appending to the other would leave the panel drawn under whatever the Navigator
 * paints next.
 *
 * The first mount is also what starts the first read. A refresh that already failed must NOT re-arm
 * it — the Refresh button and the poll are the ways back — which is what {@link panelView}'s
 * `loading` branch means.
 *
 * @param {HTMLElement} host - The painted `.panel-body`
 * @param {GitPanelDeps} deps - What `studio.ts` injects through the Navigator
 */
export function mountGitPanel(host: HTMLElement, deps: GitPanelDeps): void {
  _deps = deps;
  const container = host.querySelector<HTMLElement>(".panel-content") ?? host;
  /* `hasPlatform()` first, because the Navigator can paint before the bootstrap registers one and
     `getPlatform()` THROWS: a panel painted that early has nothing to ask, and a rejected read here
     would come back as a render failure of the whole dock. The poll and the Refresh button are the
     ways back, exactly as they are after a read that failed. */
  if (hasPlatform() && panelView() === "loading") {
    void refreshGitStatus();
  }
  if (_standing && (_standing.host !== container || !_standing.handle.connected())) {
    unmountStanding();
  }
  if (_standing) {
    return;
  }
  const handle = mountGitPanelSurface(container, gitPanelValues(), ACTIONS);
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      const values = gitPanelValues();
      /* Armed from inside the projection rather than at mount, because the mount usually happens
         one branch earlier: the first paint has no status yet, and "there is a repository here" is
         something only a finished read can say. */
      if (values.view === "repo") {
        armPoll();
      }
      handle.update(values);
    });
  });
  _standing = { handle, host: container, scope };
}

/**
 * The Navigator no longer draws this panel with lit.
 *
 * The record below returns `nothing` and mounts its document in `afterRender`, so this is a stub:
 * it survives only because `NavigatorPanelDeps` still declares the injection and `studio.ts` still
 * passes it. Both go in the change that deletes this.
 *
 * @deprecated The panel is `surfaces/git-panel.json`; call {@link mountGitPanel}.
 * @returns {typeof nothing}
 */
export function renderGitPanel(_against: GitPanelDeps): typeof nothing {
  return nothing;
}

/**
 * A commit age, relative to {@link now}.
 *
 * Exported so it is testable at all: reading the wall clock inline meant "yesterday" and the
 * locale-date fallback could only be asserted against an offset from the real present, and two
 * captures minutes apart legitimately disagreed.
 *
 * @param {string} iso
 */
export function relativeDate(iso: string) {
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

/**
 * The `Source Control:` family — the four verbs that were only ever buttons.
 *
 * Every one of them was reachable from exactly one place: two from an empty state that disappears
 * the moment the repository exists, one from a 20px icon with a `title` attribute, and the fourth —
 * signing in to GitHub — from nowhere at all, because it only ever happened as a side effect of
 * something else. That is why a failed sign-in had no Retry to name: there was no record to point
 * at. Naming them here gives the palette, `__jxAutomation`, the assistant, the deploy checklist and
 * every `notify` Retry the same four ids.
 *
 * `git.signInToGithub` is `application`-level and the other three are `project`-level, and the
 * split is the credential's: a GitHub token is one per machine and is revoked in Preferences ›
 * Accounts, while a branch, a remote and a push belong to one repository.
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
      aiTool: {
        description:
          "Run git init in the project root so the project has a history and can be pushed.",
        name: "init_repository",
      },
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
         server. It declared no `enablement` at all while `git.push` — which does strictly less —
         required a tracked repository, so on an untracked project Push was correctly disabled and
         this was fully live from the palette, the overflow, the deploy checklist and the
         `create_github_repository` AI tool. Its flow creates the repository on GitHub BEFORE it
         touches the local one, so `gitAddRemote` then throws and it reports "The repository was
         created, but the remote could not be added." The refused verb leaves nothing behind; the
         unrefused one leaves an empty repository on the user's account. */
      requires: "a project tracked by git",
      when: (ctx) => ctx.project.open,
      enablement: (ctx) => ctx.project.isRepo,
      aiTool: {
        description:
          "Create a new GitHub repository for this project, add it as the origin remote, and push. " +
          "This creates a repository; it does not deploy a site — that is publish.setUp.",
        name: "create_github_repository",
      },
      run: async () => {
        await createGithubRepository({ projectName: projectState?.name || "my-project" });
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
      aiTool: {
        description: "Push the current branch to its remote.",
        name: "git_push",
      },
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

/**
 * Stop the background refresh and take the document down. Called on unmount and whenever a
 * different project is opened.
 *
 * The surface goes with the timer, and for the same reason: everything it projects belongs to ONE
 * repository, so a document left standing over a project switch would draw the previous project's
 * branch and changed files until the Navigator next repainted the panel.
 */
export function cleanupGitPanel() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  unmountStanding();
}

/**
 * Contribute the Source Control panel.
 *
 * `level: "project"` — a branch, a working tree and a commit belong to the repository, not to
 * whichever document happens to be focused. That is why the badge below reads `ctx.git.dirtyCount`
 * (sourced from the hoisted `shell.git` record) and why this panel's render ignores `ctx.doc`
 * entirely: the count used to come from `activeTab.session.ui.gitStatus`, so it vanished when the
 * last tab closed and two tabs could disagree about the branch.
 */
export function registerGitPanel(): void {
  registerPanel({
    id: "git",
    title: "Source Control",
    level: "project",
    dock: "navigator",
    // A KEY into the kit's icon manifest, not a tag: this one resolves to
    // `gitBranchIcon`, a hand-drawn inline SVG, because the workflow set has no Git family.
    icon: "git-branch",
    badge: (ctx) => ctx.git.dirtyCount || null,
    // The body is a document, so lit draws nothing and the mount happens against the painted DOM.
    // `afterRender` runs on every repaint; {@link mountGitPanel} is idempotent.
    render: (): PanelBody => nothing,
    // Through `deps`, not a local binding: `studio.ts` owns the wiring (the clone action and the
    // Diff-state setter come from the bootstrap), and the Navigator has injected it all along.
    afterRender: (ctx, host) => {
      mountGitPanel(host, ctx.deps);
    },
  });
}
