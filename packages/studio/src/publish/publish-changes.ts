/// <reference lib="dom" />
/**
 * Publishing a change set: the destination, the checks, and the one operation both Review changes
 * and the quick publish dialog run (studio.md §22.8).
 *
 * **Two destinations, decided by the host rather than assumed.** **Publish live** commits what is
 * included to the current branch and ships it: through `runDeploy` when a deploy provider is
 * connected (which pushes and asks Cloudflare what it built), otherwise by pushing to the remote,
 * otherwise by committing alone and saying that nothing left the machine. **Send for review** needs
 * a host that opens pull requests (`createPullRequest`); on one that does not (the dev server and
 * the desktop app today) it is drawn disabled with that sentence rather than falling back to a
 * branch push that opens nothing. On a host whose branches are sessions (`gitHosted`, the cloud) a
 * branch cannot be made and committed to mid-flow, so review there commits to the session's own
 * branch and opens the pull request from it, and the destination's note says so.
 *
 * **Every word a control shows is decided here**, so the workspace and the dialog cannot disagree
 * about what a button does: {@link destinationChoices}, {@link publishLabel} and
 * {@link publishBlocker} are read by both, and {@link publishChanges} is the verb behind both
 * primary buttons.
 *
 * @docs studio/publish
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { flushAllCollab } from "../collab/collab-session";
import { getPlatform, hasPlatform } from "../platform";
import { notify } from "../services/notify";
import { shell } from "../shell";
import { projectState } from "../store";
import { slugify } from "../files/new-file-name";
import { currentDeploy, nextDeployStep } from "./deploy-checklist";
import { platformSupportsPublish } from "./pages-service";
import { runDeploy } from "./publish-commands";
import { platformHostsGit, platformOpensPullRequests, refreshGitStatus } from "./source-control";
import type { GitFileStatus } from "../types";
import type { PublishDestination } from "./publish-ids";

// ─── Where a change set can go ───────────────────────────────────────────────

/** The remote the status names first, or `""` (a host may omit the array). */
function firstRemote(): string {
  const remotes = shell.git.status?.remotes;
  return Array.isArray(remotes) && remotes.length > 0 ? (remotes[0] ?? "") : "";
}

/** The branch a commit lands on now. */
export function currentBranch(): string {
  return shell.git.branches?.current || shell.git.status?.branch || "";
}

/**
 * Whether Publish live deploys: a provider is connected, the host can reach it, and there is a
 * remote for it to build from.
 */
export function deployReady(): boolean {
  return currentDeploy() !== undefined && platformSupportsPublish() && firstRemote() !== "";
}

/** Where a live publish ends up, in words: the site's address, else the Pages project's name. */
function liveTarget(): string {
  const deploy = currentDeploy();
  return deploy?.productionUrl ?? deploy?.projectName ?? "";
}

/**
 * The branch a review is sent from: `studio/` and the summary as a slug, cut short enough to read
 * in a branch picker. A summary with nothing sluggable in it still names a branch.
 */
export function reviewBranchName(summary: string): string {
  const slug = slugify(summary).replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 48);
  return `studio/${slug.replace(/-$/, "") || "changes"}`;
}

/** One destination, as a radio card draws it. */
export interface DestinationChoice {
  value: PublishDestination;
  label: string;
  /** What choosing it does, in one sentence: where the commit lands and what happens next. */
  note: string;
  /**
   * `"true"` for the chosen one. A string, because `jx-action-button`'s `checked` is the radio
   * segment's `"true"`/`"false"`: a boolean draws neither the selection nor the radio role.
   */
  checked: "true" | "false";
  disabled: boolean;
  /** Why it is disabled, or `""`. Drawn as the card's hint. */
  reason: string;
}

/** The repository's default branch, when the host reported it, or `""`. */
export function defaultBranch(): string {
  return shell.git.branches?.defaultBranch ?? "";
}

/** Why Send for review cannot run on this host, or `""` when it can. */
export function reviewRefusal(): string {
  if (!platformOpensPullRequests()) {
    return (
      "This host cannot open a pull request yet. Publish live, or create a branch under " +
      "Branches and push it."
    );
  }
  if (platformHostsGit()) {
    /* A commit here lands on GitHub as it is made, and the pull request is opened from the session's
       own branch. On the default branch that is a live publish followed by a pull request into
       itself, so review is refused until the session is on a branch of its own. A host that has
       not said which branch is the default is refused too: the safe answer is the one that cannot
       publish by accident. */
    const base = defaultBranch();
    const branch = currentBranch();
    if (!base || !branch || branch === base) {
      return (
        `Every commit to ${base || "the default branch"} on this host is live. Create a branch ` +
        "under Branches and send it for review from there."
      );
    }
    return "";
  }
  if (firstRemote() === "") {
    return "A pull request needs a remote. Create the GitHub repository under Hosting first.";
  }
  return "";
}

/** What Publish live does, said before it runs. */
function liveNote(): string {
  const branch = currentBranch() || "the current branch";
  if (deployReady()) {
    return `Commits to ${branch} and deploys to ${liveTarget()}.`;
  }
  if (platformHostsGit()) {
    return `Commits to ${branch} on GitHub.`;
  }
  const remote = firstRemote();
  return remote
    ? `Commits to ${branch} and pushes it to ${remote}.`
    : `Commits to ${branch}. This repository has no remote, so nothing leaves this machine.`;
}

/** What Send for review does, said before it runs. */
function reviewNote(): string {
  const branch = currentBranch() || "the current branch";
  if (platformHostsGit()) {
    return (
      `Commits to ${branch} and opens a pull request from it into ` +
      `${defaultBranch() || "the default branch"}.`
    );
  }
  const summary = shell.git.commitMessage.trim();
  const head = summary ? reviewBranchName(summary) : "a new studio/ branch";
  return `Saves to ${head}, pushes it and opens a pull request into ${branch}.`;
}

/** The two destinations, with the chosen one checked and a refused one disabled. */
export function destinationChoices(chosen: PublishDestination): DestinationChoice[] {
  const refusal = reviewRefusal();
  return [
    {
      checked: chosen === "live" ? "true" : "false",
      disabled: false,
      label: "Publish live",
      note: liveNote(),
      reason: "",
      value: "live",
    },
    {
      checked: chosen === "review" ? "true" : "false",
      disabled: refusal !== "",
      label: "Send for review",
      note: reviewNote(),
      reason: refusal,
      value: "review",
    },
  ];
}

/**
 * The destination actually in effect: the chosen one, unless it is refused here, in which case the
 * one that is not. A host that cannot open a pull request never leaves the primary button naming
 * one.
 */
export function effectiveDestination(chosen: PublishDestination): PublishDestination {
  return chosen === "review" && reviewRefusal() !== "" ? "live" : chosen;
}

/** The primary button's words for a destination. */
export function publishLabel(destination: PublishDestination): string {
  if (destination === "review") {
    return "Send for review";
  }
  if (deployReady()) {
    return "Publish live";
  }
  return platformHostsGit() || firstRemote() !== "" ? "Commit and push" : "Commit";
}

/** The files a publish would take: the included ones, or every change when `includeAll`. */
function filesToPublish(includeAll: boolean): GitFileStatus[] {
  const files = shell.git.status?.files ?? [];
  return includeAll ? files : files.filter((file) => Boolean(file.staged));
}

/**
 * Why the primary button is disabled, or `""` when it may run. One sentence, drawn beside it.
 *
 * @param destination Where the change set would go.
 * @param includeAll Whether the caller publishes every change (the quick dialog) or only the
 *   included ones (Review changes).
 */
export function publishBlocker(destination: PublishDestination, includeAll = false): string {
  const { status } = shell.git;
  if (!projectState || !status?.isRepo) {
    return "Track this project with git first.";
  }
  if (shell.git.loading) {
    return "Source control is busy.";
  }
  if (status.files.length === 0) {
    return "There is nothing to publish.";
  }
  if (filesToPublish(includeAll).length === 0) {
    return "Include at least one change.";
  }
  if (!shell.git.commitMessage.trim()) {
    return "Write a summary of the change first.";
  }
  return destination === "review" ? reviewRefusal() : "";
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/** One check, as a row draws it. */
export interface PublishCheck {
  key: "deploy" | "build";
  /** `done`, `todo`, `unknown` (not asked), `running` or `failed`. */
  state: "done" | "todo" | "unknown" | "running" | "failed";
  text: string;
  /** The command that resolves a deploy step, or `""`. */
  command: string;
}

/** The change set a build check is about: the changed paths and their letters. */
function changeSignature(): string {
  return (shell.git.status?.files ?? []).map((file) => `${file.status}:${file.path}`).join("|");
}

/** Whether this host can build the site at all (`StudioPlatform.buildSite`). */
export function canCheckBuild(): boolean {
  return hasPlatform() && getPlatform().buildSite !== undefined;
}

/**
 * Build the site and record what it said, for the change set as it stands.
 *
 * A live preview is not a build and the check says so: a host that renders the working tree in the
 * browser (the cloud) has prerendered nothing, so "the site builds" would be a claim it cannot
 * make.
 */
export async function runBuildCheck(): Promise<void> {
  if (!canCheckBuild() || shell.publish.build.state === "running") {
    return;
  }
  const build = getPlatform().buildSite;
  if (!build) {
    return;
  }
  shell.publish.build.state = "running";
  shell.publish.build.text = "Building the site…";
  shell.publish.build.for = changeSignature();
  try {
    const result = await build();
    if (result.errors.length > 0) {
      shell.publish.build.state = "failed";
      shell.publish.build.text = `Built with ${result.errors.length} error(s): ${result.errors[0]}`;
    } else {
      shell.publish.build.state = "passed";
      shell.publish.build.text =
        result.mode === "live"
          ? `${result.routes} page(s) render. This host previews the working tree; it does not build.`
          : `Site builds: ${result.routes} page(s).`;
    }
  } catch (error) {
    shell.publish.build.state = "failed";
    shell.publish.build.text = `The site could not be built: ${errorMessage(error)}`;
  }
}

/**
 * The checks a change set is published under: the deploy checklist's next step, and a build check
 * where the host can build. A build check about a different set of changes is not shown as passed.
 */
export function publishChecks(): PublishCheck[] {
  const checks: PublishCheck[] = [];
  const next = nextDeployStep();
  checks.push(
    next
      ? {
          command: next.command,
          key: "deploy",
          state: next.state === "unknown" ? "unknown" : "todo",
          text: `${next.label}: ${next.detail}`,
        }
      : {
          command: "",
          key: "deploy",
          state: "done",
          text: "Everything this project needs to ship is in place.",
        },
  );
  if (canCheckBuild()) {
    const current =
      shell.publish.build.for === changeSignature() || shell.publish.build.state === "running";
    checks.push(
      current && shell.publish.build.state !== "idle"
        ? {
            command: "",
            key: "build",
            state:
              shell.publish.build.state === "passed"
                ? "done"
                : shell.publish.build.state === "failed"
                  ? "failed"
                  : "running",
            text: shell.publish.build.text,
          }
        : {
            command: "",
            key: "build",
            state: "unknown",
            text: "The site has not been built with these changes.",
          },
    );
  }
  return checks;
}

/** The checks as one line, for the quick publish dialog: what is not done, or that all is. */
export function checksLine(checks: readonly PublishCheck[]): string {
  const open = checks.filter((check) => check.state !== "done");
  if (open.length === 0) {
    return "Checks passed: ready to publish.";
  }
  return open.map((check) => check.text).join(" · ");
}

// ─── The operation ───────────────────────────────────────────────────────────

/** The last pull request this session opened, or null. */
export function lastPullRequest(): { number: number; url: string } | null {
  return shell.publish.review.number > 0
    ? { number: shell.publish.review.number, url: shell.publish.review.url }
    : null;
}

/**
 * Put the summary back after a publish that failed before its commit landed, unless the author has
 * already typed another.
 */
function restoreSummary(message: string): void {
  if (!shell.git.commitMessage) {
    shell.git.commitMessage = message;
  }
}

/**
 * Publish the change set to a destination.
 *
 * @param destination `live` or `review`; a refused review is never run.
 * @param options `includeAll` stages every change first (the quick dialog); otherwise only the
 *   included files are committed.
 * @returns Whether the change set reached its destination. A failure is already on screen.
 */
export async function publishChanges(
  destination: PublishDestination,
  options: { includeAll?: boolean } = {},
): Promise<boolean> {
  const includeAll = options.includeAll ?? false;
  const blocker = publishBlocker(destination, includeAll);
  if (blocker) {
    shell.git.error = blocker;
    return false;
  }
  const message = shell.git.commitMessage.trim();
  const plat = getPlatform();
  shell.git.commitMessage = "";
  shell.git.loading = true;
  shell.git.error = null;
  // Fold co-editing sessions into the backend's tree first so the commit never misses trailing
  // Keystrokes (the mirror is debounced).
  await flushAllCollab();
  let committed = false;
  // Whether the commit left for its destination. Only a deploy can say no without throwing.
  let shipped = true;
  try {
    if (includeAll) {
      const unstaged = filesToPublish(true)
        .filter((file) => !file.staged)
        .map((file) => file.path);
      if (unstaged.length > 0) {
        await plat.gitStage(unstaged);
      }
    }
    if (destination === "review") {
      await sendForReview(plat, message, () => {
        committed = true;
      });
    } else {
      await plat.gitCommit(message);
      committed = true;
      if (deployReady()) {
        /* The deploy is an Activity with its own steps, log and failure report (§16.4), and it
           pushes with an upstream itself, so it runs after the loading flag is down: a running
           deploy is not source control being busy. */
        shell.git.loading = false;
        /* `false` is a push that failed, a Cloudflare that did not answer, or a cancel; the
           Activity has already said which. The commit landed either way, so the summary stays
           cleared, but the change set did not reach the live site and the caller must not say it
           did. */
        shipped = await runDeploy();
      } else if (!platformHostsGit() && firstRemote() !== "") {
        await plat.gitPush();
      }
    }
    await refreshGitStatus();
    return shipped;
  } catch (error) {
    shell.git.error = errorMessage(error);
    shell.git.loading = false;
    // A push that failed after the commit landed must not offer the same summary again.
    if (!committed) {
      restoreSummary(message);
    }
    return false;
  }
}

/** What a pull request is opened with: its title, and the branches when the flow chose them. */
interface PullRequestRequest {
  title: string;
  head?: string;
  base?: string;
}

/**
 * Commit for review and say what the pull request is opened from.
 *
 * On a host whose branches are sessions, the commit lands on the session's branch, which already is
 * the branch the pull request is opened from. Elsewhere the change set gets a `studio/` branch of
 * its own, pushed with an upstream, and the pull request goes from it into the branch the author
 * was on.
 */
async function commitForReview(
  plat: ReturnType<typeof getPlatform>,
  message: string,
  onCommitted: () => void,
): Promise<PullRequestRequest> {
  if (platformHostsGit()) {
    // `reviewRefusal` has already refused the default branch, so this commit is not a live one.
    await plat.gitCommit(message);
    onCommitted();
    const base = defaultBranch();
    return base ? { base, title: message } : { title: message };
  }
  const base = currentBranch();
  const head = reviewBranchName(message);
  await plat.gitCreateBranch(head);
  await plat.gitCommit(message);
  onCommitted();
  await plat.gitPush({ setUpstream: true });
  return base ? { base, head, title: message } : { head, title: message };
}

/** Send a change set for review: the commit, then the pull request, then where it went. */
async function sendForReview(
  plat: ReturnType<typeof getPlatform>,
  message: string,
  onCommitted: () => void,
): Promise<void> {
  const open = plat.createPullRequest;
  if (!open) {
    throw new Error(reviewRefusal());
  }
  const pr = await open(await commitForReview(plat, message, onCommitted));
  shell.publish.review.number = pr.number;
  shell.publish.review.url = pr.url;
  notify.success(`Pull request #${pr.number} opened for review.`, {
    detail: pr.url,
    key: "publish.review",
    source: "Publish",
  });
}
