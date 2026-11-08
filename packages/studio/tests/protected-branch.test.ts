/**
 * A push the remote's branch rules refused, `src/publish/protected-branch.ts` (studio.md §22.8):
 * the refusal is recognised from git's own words, the commit is offered a branch of its own, and
 * the pull request is opened by the host where it can, else on GitHub's compare page.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { NotifyCall } from "./notify-mock";
import type { PromptDialogOptions } from "../src/ui/layers";
import type { StudioPlatform } from "../src/types";

let promptAnswer: string | null = null;
const prompts: { headline: string; opts: PromptDialogOptions }[] = [];
const realLayers = await import("../src/ui/layers.js");
void mock.module("../src/ui/layers.js", () => ({
  ...realLayers,
  showPromptDialog: async (headline: string, opts: PromptDialogOptions) => {
    prompts.push({ headline, opts });
    return promptAnswer;
  },
}));

const notes: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () => notifyModule((call) => notes.push(call)));

const { installMockPlatform, resetStudioState } = await import("./harness");
const { resetProjectShell, shell } = await import("../src/shell.js");
const pb = await import("../src/publish/protected-branch.js");

/** What GitHub answers a push to a branch a ruleset guards, as both local hosts relay it. */
const RULESET = [
  "git push failed: remote: error: GH013: Repository rule violations found for refs/heads/main.",
  "remote: - Changes must be made through a pull request.",
  "To https://x-access-token:secret@github.com/acme/site.git",
  " ! [remote rejected] main -> main (push declined due to repository rule violations)",
  "error: failed to push some refs to 'https://github.com/acme/site.git'",
].join("\n");

let calls: unknown[][] = [];
let refreshes = 0;
const refresh = async (): Promise<void> => {
  refreshes += 1;
};
const opened: string[] = [];

function install(overrides: Partial<StudioPlatform> = {}) {
  const installed = installMockPlatform(overrides);
  ({ calls } = installed.state);
  return installed;
}

const asked = () => calls.map(([name]) => name);

beforeEach(() => {
  resetProjectShell();
  resetStudioState({ name: "Demo", projectConfig: { name: "Demo" }, projectRoot: "/p" });
  install();
  shell.git.branches = { branches: ["main"], current: "main" };
  notes.length = 0;
  prompts.length = 0;
  promptAnswer = null;
  refreshes = 0;
  opened.length = 0;
  window.open = (url?: string | URL): null => {
    opened.push(String(url));
    return null;
  };
});

describe("reading the refusal", () => {
  test("the GitHub repository comes from the refusal's To line, without credentials", () => {
    expect(pb.githubRepoOf(RULESET)).toBe("https://github.com/acme/site");
    expect(pb.githubRepoOf("To git@github.com:acme/site.git")).toBe("https://github.com/acme/site");
    expect(pb.githubRepoOf("To https://github.com/acme/site")).toBe("https://github.com/acme/site");
    expect(pb.githubRepoOf("To https://gitlab.com/acme/site.git")).toBeNull();
    expect(pb.githubRepoOf("nothing here")).toBeNull();
  });

  test("the compare page names both branches, encoded", () => {
    expect(pb.compareUrl("https://github.com/acme/site", "main", "studio/a b")).toBe(
      "https://github.com/acme/site/compare/main...studio%2Fa%20b?expand=1",
    );
  });

  test("the review branch name is the summary as a slug", () => {
    expect(pb.reviewBranchName("Add a pricing page!")).toBe("studio/add-a-pricing-page");
    expect(pb.reviewBranchName("")).toBe("studio/changes");
  });
});

describe("offerBranchForRefusedPush", () => {
  test("any other failure is the caller's to report", async () => {
    expect(
      await pb.offerBranchForRefusedPush("rejected: non-fast-forward", { refresh }),
    ).toBeNull();
    expect(prompts).toEqual([]);
  });

  test("a host whose git is the remote's is never offered a branch", async () => {
    install({ gitHosted: true });
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh })).toBeNull();
    expect(prompts).toEqual([]);
  });

  test("declining keeps the commit and says what happened in words", async () => {
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh, summary: "Fix typo" })).toBe(
      false,
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.headline).toBe("Push to a New Branch");
    expect(prompts[0]?.opts.value).toBe("studio/fix-typo");
    expect(prompts[0]?.opts.message).toMatch(/^main is protected on GitHub/);
    expect(prompts[0]?.opts.validate?.(" ", "")).toBe("Enter a branch name.");
    expect(prompts[0]?.opts.validate?.("x", "")).toBe("");
    expect(shell.git.error).toBe(pb.refusalSentence("main"));
    expect(asked()).not.toContain("gitPush");
  });

  test("with no summary the last commit names the branch", async () => {
    install({
      gitLog: async () => [{ author: "a", date: "d", hash: "h", message: "Tidy footer" }],
    });
    await pb.offerBranchForRefusedPush(RULESET, { refresh });
    expect(prompts[0]?.opts.value).toBe("studio/tidy-footer");
  });

  test("a log that cannot be read still proposes a branch", async () => {
    install({ gitLog: () => Promise.reject(new Error("no log")) });
    await pb.offerBranchForRefusedPush(RULESET, { refresh });
    expect(prompts[0]?.opts.value).toBe("studio/changes");
  });

  test("confirming on a host that opens pull requests pushes the branch and opens one", async () => {
    const requests: unknown[] = [];
    install({
      createPullRequest: async (opts) => {
        requests.push(opts);
        return { number: 7, url: "https://github.com/acme/site/pull/7" };
      },
    });
    promptAnswer = " studio/fix ";
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh, summary: "Fix" })).toBe(true);
    expect(asked()).toEqual(["gitCreateBranch", "gitPush"]);
    expect(calls[0]).toEqual(["gitCreateBranch", "studio/fix"]);
    expect(calls[1]).toEqual(["gitPush", { setUpstream: true }]);
    expect(requests).toEqual([{ base: "main", head: "studio/fix", title: "Fix" }]);
    expect(shell.publish.review.number).toBe(7);
    expect(notes.at(-1)?.message).toBe(
      "Pushed to studio/fix. Pull request #7 brings it into main.",
    );
    expect(refreshes).toBe(1);
    expect(opened).toEqual([]);
  });

  test("a pull request the host could not open leaves the branch pushed, and says so", async () => {
    install({ createPullRequest: () => Promise.reject(new Error("422")) });
    promptAnswer = "studio/fix";
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh, summary: "Fix" })).toBe(true);
    expect(notes.at(-1)).toMatchObject({
      message: "Pushed to studio/fix, but the pull request could not be opened.",
      severity: "warn",
    });
  });

  test("elsewhere GitHub's compare page is opened to finish the pull request", async () => {
    promptAnswer = "studio/fix";
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh, summary: "Fix" })).toBe(true);
    const url = "https://github.com/acme/site/compare/main...studio%2Ffix?expand=1";
    expect(opened).toEqual([url]);
    expect(notes.at(-1)).toMatchObject({
      message: "Pushed to studio/fix. Finish the pull request into main on GitHub.",
      options: { detail: url },
    });
  });

  test("a remote that is not GitHub's is pushed and pointed at its host", async () => {
    promptAnswer = "studio/fix";
    const output = "remote: GitLab: You are not allowed to push code to protected branches";
    expect(await pb.offerBranchForRefusedPush(output, { refresh, summary: "Fix" })).toBe(true);
    expect(opened).toEqual([]);
    expect(notes.at(-1)?.message).toBe(
      "Pushed to studio/fix. Open a pull request from it on your Git host.",
    );
  });

  test("the branch's own push failing is reported after the status is re-read", async () => {
    install({ gitPush: () => Promise.reject(new Error("auth failed")) });
    promptAnswer = "studio/fix";
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh, summary: "Fix" })).toBe(false);
    expect(refreshes).toBe(1);
    expect(shell.git.error).toBe("auth failed");
    expect(notes).toEqual([]);
  });

  test("the status's branch is used when no branch list has been read", async () => {
    shell.git.branches = null;
    shell.git.status = {
      ahead: 1,
      behind: 0,
      branch: "trunk",
      files: [],
      isRepo: true,
      remotes: ["origin"],
    };
    await pb.offerBranchForRefusedPush(RULESET, { refresh });
    expect(prompts[0]?.opts.message).toMatch(/^trunk is protected/);
  });

  test("no branch read at all still asks, naming none", async () => {
    shell.git.branches = null;
    shell.git.status = null;
    expect(await pb.offerBranchForRefusedPush(RULESET, { refresh })).toBe(false);
    expect(prompts[0]?.opts.message).toMatch(/^This branch is protected/);
    expect(prompts[0]?.opts.message).toMatch(/into the protected branch\.$/);
  });
});
