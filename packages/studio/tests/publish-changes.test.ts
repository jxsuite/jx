/**
 * Publishing a change set, `src/publish/publish-changes.ts`: the destinations a host allows, the
 * words each control shows, the checks, and the one operation both Review changes and the quick
 * publish dialog run (studio.md §22.8).
 *
 * Every host shape is a platform member, never an assumption: `createPullRequest` decides whether
 * Send for review can run, `gitHosted` decides what a commit and a branch mean, `cfApi` and
 * `build.deploy` decide whether Publish live deploys, and `buildSite` decides whether there is a
 * build check at all.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { NotifyCall } from "./notify-mock";
import type { GitStatusResult, SiteBuildResult, StudioPlatform } from "../src/types";

let deploys = 0;
let deployResult = true;
void mock.module("../src/publish/publish-commands.js", () => ({
  runDeploy: async () => {
    deploys += 1;
    return deployResult;
  },
}));

const notes: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () => notifyModule((call) => notes.push(call)));

const { installMockPlatform, resetStudioState } = await import("./harness");
const { resetProjectShell, shell } = await import("../src/shell.js");
const { setProjectState } = await import("../src/state.js");
const pc = await import("../src/publish/publish-changes.js");

const DEPLOY = {
  accountId: "a".repeat(32),
  productionUrl: "https://my-site.pages.dev",
  projectName: "my-site",
  provider: "cloudflare-pages" as const,
};

function status(files: GitStatusResult["files"], extra: Partial<GitStatusResult> = {}) {
  shell.git.status = {
    ahead: 0,
    behind: 0,
    branch: "main",
    files,
    isRepo: true,
    remotes: ["origin"],
    ...extra,
  };
  shell.git.branches = { branches: ["main"], current: "main" };
}

let calls: unknown[][] = [];

/** The platform, with every verb this module calls recorded in order. */
function install(overrides: Partial<StudioPlatform> = {}) {
  const installed = installMockPlatform({
    gitBranches: async () => ({ branches: ["main"], current: "main" }),
    gitStatus: async () => shell.git.status ?? { ...emptyStatus(), isRepo: true },
    ...overrides,
  });
  ({ calls } = installed.state);
  return installed;
}

function emptyStatus(): GitStatusResult {
  return { ahead: 0, behind: 0, branch: "main", files: [], isRepo: false, remotes: [] };
}

const asked = () => calls.map(([name]) => name);

beforeEach(() => {
  resetProjectShell();
  resetStudioState({ name: "Demo", projectConfig: { name: "Demo" }, projectRoot: "/p" });
  install();
  deploys = 0;
  deployResult = true;
  notes.length = 0;
});

describe("the review branch", () => {
  test("is studio/ and the summary as a slug, cut short, never empty", () => {
    expect(pc.reviewBranchName("Add a pricing page!")).toBe("studio/add-a-pricing-page");
    expect(pc.reviewBranchName("  --  ")).toBe("studio/changes");
    expect(pc.reviewBranchName("x".repeat(80)).length).toBeLessThanOrEqual("studio/".length + 48);
    expect(pc.reviewBranchName("a  -  b")).toBe("studio/a-b");
  });
});

describe("destinations", () => {
  test("Publish live says where the commit lands, for every host shape", () => {
    status([]);
    expect(pc.destinationChoices("live")[0]?.note).toBe("Commits to main and pushes it to origin.");
    status([], { remotes: [] });
    expect(pc.destinationChoices("live")[0]?.note).toBe(
      "Commits to main. This repository has no remote, so nothing leaves this machine.",
    );
    install({ gitHosted: true });
    expect(pc.destinationChoices("live")[0]?.note).toBe("Commits to main on GitHub.");
    install({ cfApi: async () => null });
    status([]);
    resetStudioState({ projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    expect(pc.destinationChoices("live")[0]?.note).toBe(
      "Commits to main and deploys to https://my-site.pages.dev.",
    );
    expect(pc.deployReady()).toBe(true);
  });

  test("Send for review is refused, with the reason, on a host that cannot open a pull request", () => {
    status([]);
    const [, review] = pc.destinationChoices("review");
    expect(review?.disabled).toBe(true);
    expect(review?.reason).toMatch(/^This host cannot open a pull request yet\./);
    // The chosen destination falls back to the one that can run, so the button never names it.
    expect(pc.effectiveDestination("review")).toBe("live");
    expect(pc.effectiveDestination("live")).toBe("live");
  });

  test("…needs a remote on an ordinary working tree, and says what it does where it can run", () => {
    install({ createPullRequest: async () => ({ number: 1, url: "u" }) });
    status([], { remotes: [] });
    expect(pc.reviewRefusal()).toMatch(/needs a remote/);
    status([]);
    expect(pc.reviewRefusal()).toBe("");
    expect(pc.destinationChoices("review")[1]).toMatchObject({
      checked: "true",
      disabled: false,
      note: "Saves to a new studio/ branch, pushes it and opens a pull request into main.",
    });
    expect(pc.effectiveDestination("review")).toBe("review");
  });

  test("once a summary is written, the review note names the branch it will create", () => {
    install({ createPullRequest: async () => ({ number: 1, url: "u" }) });
    status([]);
    shell.git.commitMessage = "Pricing page";
    expect(pc.destinationChoices("review")[1]?.note).toBe(
      "Saves to studio/pricing-page, pushes it and opens a pull request into main.",
    );
  });

  /* `jx-action-button`'s `checked` is the radio segment's "true"/"false"; a boolean draws neither
     the selection nor the radio role, so exactly one card carries "true". */
  test("the chosen destination is the one card checked, as the string the kit reads", () => {
    expect(pc.destinationChoices("live").map((choice) => choice.checked)).toEqual([
      "true",
      "false",
    ]);
    expect(pc.destinationChoices("review").map((choice) => choice.checked)).toEqual([
      "false",
      "true",
    ]);
  });

  test("where a branch is a session, review opens the pull request from the current branch", () => {
    install({ createPullRequest: async () => ({ number: 1, url: "u" }), gitHosted: true });
    status([], { remotes: [] });
    shell.git.branches = {
      branches: ["main", "pricing"],
      current: "pricing",
      defaultBranch: "main",
    };
    expect(pc.reviewRefusal()).toBe("");
    expect(pc.destinationChoices("review")[1]?.note).toBe(
      "Commits to pricing and opens a pull request from it into main.",
    );
  });

  /* A commit on that host lands on GitHub as it is made. On the default branch, review would be a
     live publish followed by a pull request into itself, so it is refused, and so is a host that
     never said which branch is the default. */
  test("where a branch is a session, review is refused on the default branch", () => {
    install({ createPullRequest: async () => ({ number: 1, url: "u" }), gitHosted: true });
    status([]);
    shell.git.branches = { branches: ["main"], current: "main", defaultBranch: "main" };
    expect(pc.reviewRefusal()).toBe(
      "Every commit to main on this host is live. Create a branch under Branches and send it " +
        "for review from there.",
    );
    expect(pc.destinationChoices("review")[1]).toMatchObject({ disabled: true });
    expect(pc.effectiveDestination("review")).toBe("live");
    shell.git.branches = { branches: ["main", "pricing"], current: "pricing" };
    expect(pc.reviewRefusal()).toMatch(/^Every commit to the default branch on this host is live/);
    expect(pc.destinationChoices("review")[1]?.note).toBe(
      "Commits to pricing and opens a pull request from it into the default branch.",
    );
  });

  test("the primary button names what it will do", () => {
    status([]);
    expect(pc.publishLabel("review")).toBe("Send for review");
    expect(pc.publishLabel("live")).toBe("Commit and push");
    status([], { remotes: [] });
    expect(pc.publishLabel("live")).toBe("Commit");
    install({ cfApi: async () => null });
    status([]);
    resetStudioState({ projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    expect(pc.publishLabel("live")).toBe("Publish live");
  });

  test("with no branch read, the notes say so in words", () => {
    shell.git.status = { ...emptyStatus(), branch: "", isRepo: true };
    expect(pc.currentBranch()).toBe("");
    expect(pc.destinationChoices("live")[0]?.note).toMatch(/^Commits to the current branch\./);
  });
});

describe("the blocker", () => {
  test("says what stands between the author and publishing, one fact at a time", () => {
    expect(pc.publishBlocker("live")).toBe("Track this project with git first.");
    status([]);
    expect(pc.publishBlocker("live")).toBe("There is nothing to publish.");
    status([{ path: "a.json", staged: false, status: "M" }]);
    expect(pc.publishBlocker("live")).toBe("Include at least one change.");
    // The quick dialog takes every change, so leaving one out is not a blocker there.
    expect(pc.publishBlocker("live", true)).toBe("Write a summary of the change first.");
    shell.git.commitMessage = "Fix the header";
    expect(pc.publishBlocker("live", true)).toBe("");
    expect(pc.publishBlocker("review", true)).toMatch(/cannot open a pull request/);
    shell.git.loading = true;
    expect(pc.publishBlocker("live", true)).toBe("Source control is busy.");
    setProjectState(null);
    expect(pc.publishBlocker("live")).toBe("Track this project with git first.");
  });
});

describe("checks", () => {
  test("the deploy check is the checklist's next step, or done when nothing is missing", () => {
    status([]);
    const [deploy] = pc.publishChecks();
    expect(deploy).toMatchObject({ command: "publish.setUp", key: "deploy", state: "unknown" });
    expect(deploy?.text).toMatch(/^Connect a deploy provider: /);
    install({ cfApi: async () => null });
    expect(pc.publishChecks()[0]).toMatchObject({ state: "todo" });
  });

  test("with no buildSite there is no build check; with one it is unknown until run", async () => {
    status([{ path: "a.json", staged: false, status: "M" }]);
    expect(pc.canCheckBuild()).toBe(false);
    expect(pc.publishChecks().map((check) => check.key)).toEqual(["deploy"]);
    await pc.runBuildCheck();
    let finish: (result: SiteBuildResult) => void = () => {};
    install({
      buildSite: () =>
        new Promise<SiteBuildResult>((resolve) => {
          finish = resolve;
        }),
    });
    expect(pc.publishChecks()[1]).toMatchObject({ key: "build", state: "unknown" });
    const running = pc.runBuildCheck();
    expect(pc.publishChecks()[1]).toMatchObject({ state: "running", text: "Building the site…" });
    // A second click while it runs starts nothing.
    await pc.runBuildCheck();
    finish({ errors: [], files: 3, routes: 2 });
    await running;
    expect(pc.publishChecks()[1]).toMatchObject({ state: "done", text: "Site builds: 2 page(s)." });
    // A different set of changes is not shown as checked.
    status([{ path: "b.json", staged: false, status: "M" }]);
    expect(pc.publishChecks()[1]).toMatchObject({ state: "unknown" });
  });

  test("a build with errors fails the check; a live preview says it is not a build", async () => {
    status([]);
    install({ buildSite: async () => ({ errors: ["pages/a.json: bad"], files: 0, routes: 0 }) });
    await pc.runBuildCheck();
    expect(pc.publishChecks()[1]).toMatchObject({
      state: "failed",
      text: "Built with 1 error(s): pages/a.json: bad",
    });
    install({ buildSite: async () => ({ errors: [], files: 0, mode: "live", routes: 4 }) });
    await pc.runBuildCheck();
    expect(pc.publishChecks()[1]?.text).toMatch(/^4 page\(s\) render\. This host previews/);
    install({
      buildSite: async () => {
        throw new Error("no bun");
      },
    });
    await pc.runBuildCheck();
    expect(pc.publishChecks()[1]?.text).toBe("The site could not be built: no bun");
  });

  test("the one-line summary names what is open, or says all passed", () => {
    expect(pc.checksLine([{ command: "", key: "deploy", state: "done", text: "fine" }])).toBe(
      "Checks passed: ready to publish.",
    );
    expect(
      pc.checksLine([
        { command: "", key: "deploy", state: "todo", text: "Connect" },
        { command: "", key: "build", state: "unknown", text: "Not built" },
      ]),
    ).toBe("Connect · Not built");
  });
});

describe("publishChanges", () => {
  test("refuses with the blocker, and changes nothing", async () => {
    status([{ path: "a.json", staged: true, status: "M" }]);
    expect(await pc.publishChanges("live")).toBe(false);
    expect(shell.git.error).toBe("Write a summary of the change first.");
    expect(asked()).toEqual([]);
  });

  test("Publish live commits what is included, pushes, and re-reads", async () => {
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "  Fix the header ";
    expect(await pc.publishChanges("live")).toBe(true);
    expect(calls.filter(([name]) => name !== "gitStatus" && name !== "gitBranches")).toEqual([
      ["gitCommit", "Fix the header"],
      ["gitPush"],
    ]);
    expect(shell.git.commitMessage).toBe("");
    expect(deploys).toBe(0);
  });

  test("…stages every change first when asked to take them all", async () => {
    status([
      { path: "a.json", staged: true, status: "M" },
      { path: "b.json", staged: false, status: "U" },
    ]);
    shell.git.commitMessage = "All of it";
    expect(await pc.publishChanges("live", { includeAll: true })).toBe(true);
    expect(calls[0]).toEqual(["gitStage", ["b.json"]]);
  });

  test("…commits alone where there is no remote, and only commits where git is the remote's", async () => {
    status([{ path: "a.json", staged: true, status: "M" }], { remotes: [] });
    shell.git.commitMessage = "Local";
    await pc.publishChanges("live");
    expect(asked()).not.toContain("gitPush");
    install({ gitHosted: true });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Hosted";
    await pc.publishChanges("live");
    const hosted = asked();
    expect(hosted).toContain("gitCommit");
    expect(hosted).not.toContain("gitPush");
  });

  test("…deploys through runDeploy when a provider is connected", async () => {
    install({ cfApi: async () => null });
    resetStudioState({ projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Ship";
    expect(await pc.publishChanges("live")).toBe(true);
    expect(deploys).toBe(1);
    expect(asked()).not.toContain("gitPush");
  });

  /* A `runDeploy` answers false for a push that failed, a Cloudflare that did not answer and a cancel,
     and says which in its Activity. The commit has landed, so the summary is not offered again, but
     the change set did not reach the live site and the caller (the quick dialog) must not close as
     though it had. */
  test("…a deploy that did not ship is not a publish that reached its destination", async () => {
    install({ cfApi: async () => null });
    resetStudioState({ projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Ship";
    deployResult = false;
    expect(await pc.publishChanges("live")).toBe(false);
    expect(deploys).toBe(1);
    expect(asked()).toContain("gitCommit");
    expect(shell.git.commitMessage).toBe("");
  });

  test("a commit that fails gives the summary back; a push that fails after it does not", async () => {
    install({
      gitCommit: async () => {
        throw new Error("hook refused");
      },
    });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Try";
    expect(await pc.publishChanges("live")).toBe(false);
    expect(shell.git.error).toBe("hook refused");
    expect(shell.git.commitMessage).toBe("Try");
    expect(shell.git.loading).toBe(false);

    install({
      gitPush: async () => {
        throw new Error("rejected");
      },
    });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Again";
    expect(await pc.publishChanges("live")).toBe(false);
    expect(shell.git.commitMessage).toBe("");
  });

  test("Send for review makes a studio/ branch, commits, pushes and opens the pull request", async () => {
    const requests: unknown[] = [];
    install({
      createPullRequest: async (request) => {
        requests.push(request);
        return { number: 12, url: "https://github.test/pr/12" };
      },
    });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.commitMessage = "Add pricing";
    expect(await pc.publishChanges("review")).toBe(true);
    expect(calls.filter(([name]) => name !== "gitStatus" && name !== "gitBranches")).toEqual([
      ["gitCreateBranch", "studio/add-pricing"],
      ["gitCommit", "Add pricing"],
      ["gitPush", { setUpstream: true }],
    ]);
    expect(requests).toEqual([{ base: "main", head: "studio/add-pricing", title: "Add pricing" }]);
    expect(pc.lastPullRequest()).toEqual({ number: 12, url: "https://github.test/pr/12" });
    expect(notes.at(-1)).toMatchObject({ message: "Pull request #12 opened for review." });
  });

  test("…from a branch with no name read, the pull request names no base", async () => {
    const requests: unknown[] = [];
    install({
      createPullRequest: async (request) => {
        requests.push(request);
        return { number: 3, url: "u" };
      },
    });
    shell.git.status = {
      ...emptyStatus(),
      branch: "",
      files: [{ path: "a.json", staged: true, status: "M" }],
      isRepo: true,
      remotes: ["origin"],
    };
    shell.git.commitMessage = "No base";
    await pc.publishChanges("review");
    expect(requests).toEqual([{ head: "studio/no-base", title: "No base" }]);
  });

  test("…where a branch is a session, commits there and opens the pull request from it", async () => {
    const requests: unknown[] = [];
    install({
      createPullRequest: async (request) => {
        requests.push(request);
        return { number: 7, url: "u" };
      },
      gitHosted: true,
    });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.branches = {
      branches: ["main", "pricing"],
      current: "pricing",
      defaultBranch: "main",
    };
    shell.git.commitMessage = "Cloud review";
    expect(await pc.publishChanges("review")).toBe(true);
    expect(asked()).not.toContain("gitCreateBranch");
    expect(requests).toEqual([{ base: "main", title: "Cloud review" }]);
    expect(pc.lastPullRequest()?.number).toBe(7);
  });

  test("…and from the default branch there, nothing is committed", async () => {
    const requests: unknown[] = [];
    install({
      createPullRequest: async (request) => {
        requests.push(request);
        return { number: 7, url: "u" };
      },
      gitHosted: true,
    });
    status([{ path: "a.json", staged: true, status: "M" }]);
    shell.git.branches = { branches: ["main"], current: "main", defaultBranch: "main" };
    shell.git.commitMessage = "Cloud review";
    expect(await pc.publishChanges("review")).toBe(false);
    expect(asked()).not.toContain("gitCommit");
    expect(requests).toEqual([]);
    expect(shell.git.error).toMatch(/^Every commit to main on this host is live/);
    expect(shell.git.commitMessage).toBe("Cloud review");
  });

  test("no pull request is on record before one is opened", () => {
    expect(pc.lastPullRequest()).toBeNull();
  });
});
