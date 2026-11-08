/// <reference lib="dom" />
/**
 * A push the remote's branch rules refused, turned into a branch and a pull request (studio.md
 * §22.8).
 *
 * GitHub refuses a direct push to a branch a ruleset or a branch protection rule guards (`GH013`,
 * `GH006`), and git reports it as one more failed push: `! [remote rejected] main -> main (push
 * declined due to repository rule violations)`. Relayed as it stands, that is a wall of `remote:`
 * lines that says what went wrong and nothing about what to do. What to do is always the same, and
 * the rules say it themselves: put the commit on a branch of its own and send it through a pull
 * request.
 *
 * **Asked, never assumed**, as {@link publishAsBranch} asks. The commit has already landed on the
 * protected branch locally, so the dialog says that the work is safe, names the branch that refused
 * it, and proposes the branch name Send for review would use, editable. Confirming creates that
 * branch at the commit (`gitCreateBranch` checks it out with the commit on it), pushes it with an
 * upstream, and opens the pull request: through the host's `createPullRequest` where it has one,
 * otherwise by opening GitHub's compare page for the two branches, whose address the refusal itself
 * carries in its `To <url>` line.
 *
 * Only an ordinary working tree reaches this: on a host whose git is the remote's (`gitHosted`) a
 * commit lands on GitHub as it is made and a push is only a check, so its refusals arrive as that
 * host's own problems.
 *
 * @docs studio/publish
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform, hasPlatform } from "../platform";
import { pushRefusedByRule } from "../platform-errors";
import { notify } from "../services/notify";
import { shell } from "../shell";
import { showPromptDialog } from "../ui/layers";
import { slugify } from "../files/new-file-name";

/**
 * The GitHub repository a push went to, from the `To <url>` line git prints above its refusal, as
 * `https://github.com/<owner>/<repo>`; null when the output names no github.com remote.
 *
 * Read from the refusal rather than asked of the host because it is the one address that is
 * certainly the right one: it is where the push that was refused went. Any credentials in an HTTPS
 * remote sit before `github.com` and are never part of the result.
 */
export function githubRepoOf(output: string): string | null {
  for (const line of output.split("\n")) {
    const match = /^\s*To\s+\S*?github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/.exec(line);
    const owner = match?.[1] ?? "";
    const repo = match?.[2] ?? "";
    if (owner !== "" && repo !== "") {
      return `https://github.com/${owner}/${repo}`;
    }
  }
  return null;
}

/**
 * The branch a review is sent from: `studio/` and the summary as a slug, cut short enough to read
 * in a branch picker. A summary with nothing sluggable in it still names a branch.
 */
export function reviewBranchName(summary: string): string {
  const slug = slugify(summary).replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 48);
  return `studio/${slug.replace(/-$/, "") || "changes"}`;
}

/** GitHub's page for opening a pull request from `head` into `base`, with the form expanded. */
export function compareUrl(repo: string, base: string, head: string): string {
  return `${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}

/** The branch whose push was refused: the one checked out, or `""` when no read has said. */
function refusedBranch(): string {
  const { branches, status } = shell.git;
  const current = branches?.current ?? "";
  return current === "" ? (status?.branch ?? "") : current;
}

/** The summary of the commit the refused push carried: the caller's, else the last commit's. */
async function refusedSummary(summary: string): Promise<string> {
  if (summary.trim()) {
    return summary.trim();
  }
  try {
    const [last] = await getPlatform().gitLog(1);
    return last?.message ?? "";
  } catch {
    return "";
  }
}

/**
 * The sentence a refused push leaves on screen when the author declines the branch: what happened,
 * in words, rather than git's.
 */
export function refusalSentence(branch: string): string {
  return (
    `${branch} is protected on GitHub, so it does not accept a direct push. Your commit is saved ` +
    "here. Push it to a new branch and open a pull request instead."
  );
}

/** What {@link offerBranchForRefusedPush} needs from the flow that pushed. */
export interface RefusedPushOptions {
  refresh: () => Promise<void>;
  summary?: string;
}

/**
 * When a push failed because the remote's branch rules refuse it, offer to push the commit to a new
 * branch and open a pull request from it into the branch that refused it, and do it.
 *
 * @param output What the push threw, as its message: git's own output on both local hosts.
 * @param options `refresh` re-reads git's status once the branch exists (the caller's, so this
 *   module imports none of source control); `summary` is the commit's, when the caller has it,
 *   otherwise the last commit's is used, for the branch name and the pull request's title.
 * @returns `null` when the failure was not such a refusal, which the caller reports as it would any
 *   other. Otherwise whether the commit reached the new branch: `true` once it is pushed (the pull
 *   request is on screen), `false` when the offer was declined or the branch's own push failed,
 *   whose sentence is already in `shell.git.error`.
 */
export async function offerBranchForRefusedPush(
  output: string,
  options: Readonly<RefusedPushOptions>,
): Promise<boolean | null> {
  // A host whose git is the remote's has no push of its own to refuse (see the module comment).
  if (!hasPlatform() || getPlatform().gitHosted === true || !pushRefusedByRule(output)) {
    return null;
  }
  const { refresh, summary = "" } = options;
  const plat = getPlatform();
  const base = refusedBranch();
  const where = base === "" ? "This branch" : base;
  const title = await refusedSummary(summary);
  const name = await showPromptDialog("Push to a New Branch", {
    confirmLabel: "Push and open pull request",
    message:
      `${where} is protected on GitHub, and its rules refuse a direct push. Your commit is saved ` +
      `here. Push it to a branch of its own instead, and a pull request will bring it into ` +
      `${base === "" ? "the protected branch" : base}.`,
    validate: (value) => (value.trim() ? "" : "Enter a branch name."),
    value: reviewBranchName(title),
  });
  if (!name) {
    shell.git.error = refusalSentence(where);
    return false;
  }
  const head = name.trim();
  shell.git.loading = true;
  shell.git.error = null;
  try {
    await plat.gitCreateBranch(head);
    await plat.gitPush({ setUpstream: true });
  } catch (pushError) {
    // Re-read first: the branch may exist now, and a status read clears the error it would show.
    await refresh();
    shell.git.error = errorMessage(pushError);
    return false;
  }
  await openPullRequest({
    base,
    head,
    repo: githubRepoOf(output),
    title: title === "" ? head : title,
  });
  await refresh();
  return true;
}

/** What a pull request for a pushed branch is opened from. */
interface PullRequestTarget {
  base: string;
  head: string;
  repo: string | null;
  title: string;
}

/**
 * Open the pull request for a branch that was just pushed, and say where it is.
 *
 * Through the host where it opens pull requests itself; otherwise GitHub's compare page is opened
 * for the author to finish, and the notification carries its address either way. A host that could
 * not open one leaves the branch pushed, which is still the outcome the refusal asked for, and says
 * so.
 */
async function openPullRequest(target: Readonly<PullRequestTarget>): Promise<void> {
  const { base, head, repo, title } = target;
  const open = getPlatform().createPullRequest;
  if (open && base !== "") {
    try {
      const pr = await open({ base, head, title });
      shell.publish.review.number = pr.number;
      shell.publish.review.url = pr.url;
      notify.success(`Pushed to ${head}. Pull request #${pr.number} brings it into ${base}.`, {
        detail: pr.url,
        key: "publish.branch",
        source: "Publish",
      });
      return;
    } catch (error) {
      notify.warn(`Pushed to ${head}, but the pull request could not be opened.`, {
        detail: errorMessage(error),
        key: "publish.branch",
        source: "Publish",
      });
      return;
    }
  }
  if (repo !== null && base !== "") {
    const url = compareUrl(repo, base, head);
    window.open(url, "_blank", "noopener,noreferrer");
    notify.success(`Pushed to ${head}. Finish the pull request into ${base} on GitHub.`, {
      detail: url,
      key: "publish.branch",
      source: "Publish",
    });
    return;
  }
  notify.success(`Pushed to ${head}. Open a pull request from it on your Git host.`, {
    key: "publish.branch",
    source: "Publish",
  });
}
