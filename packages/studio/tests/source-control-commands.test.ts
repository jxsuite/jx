/**
 * `Source Control:` family tests — the four verbs that were only ever buttons.
 *
 * Two of them were reachable from an empty state that disappears the moment the repository exists;
 * one from a 20px icon with a `title`; and `signInToGithub` from nowhere at all, which is why a
 * failed sign-in had no Retry to name. These assertions are about the RECORDS — that they exist,
 * that they gate on the right fact, and that running one does the thing the panel button did.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { NotifyCall } from "./notify-mock";
import type { ProjectState, StudioPlatform } from "../src/types";
import type { createGithubRepository } from "../src/github/github-publish";

/** What the panel hands `createGithubRepository`. */
type CreateRepoOptions = Parameters<typeof createGithubRepository>[0];

let mockPlatform: Partial<StudioPlatform>;
let authToken: string | null = "ghp_token";
const repoCalls: CreateRepoOptions[] = [];

void mock.module("../src/platform.js", () => ({
  getPlatform: () => mockPlatform,
  // Reached transitively: the settings kernel asks whether a platform is registered before writing.
  hasPlatform: () => true,
  registerPlatform: () => {},
}));

void mock.module("../src/ui/layers.js", () => ({
  /* Converted surfaces mount themselves into a layer, so they import `layerHost` from
     here — a mock without it fails the whole file at import time. */
  layerHost: () => document.body,
  getLayerSlot: (_kind: string, id: string) => {
    const el = document.createElement("div");
    el.id = id;
    return el;
  },
  showConfirmDialog: async () => true,
  showDialog: async () => null,
  showPromptDialog: async () => null,
}));

void mock.module("../src/packages/pull-package-sync.js", () => ({
  autoSyncProjectOnOpen: async () => {},
  isAutomatedPackageDiff: () => false,
  planPackageDiscard: async () => ({ automated: true, discard: [], removeUntracked: [] }),
  pullWithPackageSync: async () => {},
}));

void mock.module("../src/github/github-auth.js", () => ({
  authenticateGithub: async () => authToken,
  clearGithubToken: () => {},
  getGithubToken: () => authToken,
}));

void mock.module("../src/github/github-publish.js", () => ({
  createGithubRepository: async (opts: CreateRepoOptions) => {
    repoCalls.push(opts);
    return true;
  },
}));

const notifications: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () =>
  notifyModule((call) => notifications.push(call)),
);

const { setProjectState } = await import("../src/state.js");
const { emptyContext, makeContext } = await import("../src/commands/context.js");
const { registerSourceControlCommands, sourceControlCommands } =
  await import("../src/publish/source-control.js");
const { createCommandRegistry } = await import("../src/commands/registry.js");

function command(id: string) {
  return sourceControlCommands().find((candidate) => candidate.id === id)!;
}

/** Run a Source Control record the way the palette does: an empty context and no arguments. */
function runCommand(id: string): void | Promise<void> {
  /* SAFETY: a stored record is `AnyCommand`, whose args are erased to `never`. None of the four
     Source Control records declares `args`, so the registry hands each `run` undefined as well. */
  return command(id).run(emptyContext(), undefined as never);
}

/** An open, empty project named `name`. */
function project(name: string): ProjectState {
  return {
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: false,
    name,
    projectConfig: null,
    projectRoot: "",
    searchQuery: "",
    selectedPath: null,
  };
}

beforeEach(() => {
  notifications.length = 0;
  repoCalls.length = 0;
  authToken = "ghp_token";
  setProjectState(project("proj"));
  mockPlatform = {
    gitBranches: async () => ({ branches: ["main"], current: "main" }),
    gitInit: async () => {},
    gitPush: async () => {},
    gitStatus: async () => ({
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: ["origin"],
    }),
  };
});

describe("the records", () => {
  test("four verbs, one category, ids in the lowercase git namespace", () => {
    const records = sourceControlCommands();
    expect(records.map((record) => record.id)).toEqual([
      "git.init",
      "git.createGithubRepository",
      "git.push",
      "git.signInToGithub",
    ]);
    expect(records.every((record) => record.category === "Source Control")).toBe(true);
    expect(records.every((record) => (record.menus ?? []).includes("palette"))).toBe(true);
  });

  test("signing in is application-level; the other three belong to one repository", () => {
    // The split is the credential's: a device-flow token is one per machine and is revoked in
    // Preferences › Accounts, while a branch, a remote and a push belong to a repository.
    expect(command("git.signInToGithub").level).toBe("application");
    for (const id of ["git.init", "git.createGithubRepository", "git.push"]) {
      expect(command(id).level).toBe("project");
    }
  });

  test("Initialize is refused on a project git already tracks", () => {
    const untracked = makeContext({ project: { open: true } });
    const tracked = makeContext({ project: { isRepo: true, open: true } });
    expect(command("git.init").enablement!(untracked)).toBe(true);
    expect(command("git.init").enablement!(tracked)).toBe(false);
    expect(command("git.init").requires).toContain("not already tracking");
  });

  test("Push is refused without a repository", () => {
    expect(command("git.push").enablement!(makeContext({ project: { open: true } }))).toBe(false);
    expect(
      command("git.push").enablement!(makeContext({ project: { isRepo: true, open: true } })),
    ).toBe(true);
  });

  test("every project-level record is hidden with no project open", () => {
    for (const id of ["git.init", "git.createGithubRepository", "git.push"]) {
      expect(command(id).when!(emptyContext())).toBe(false);
    }
  });

  test("registering them passes the registry's own placement and id checks", () => {
    const registry = createCommandRegistry({ getContext: emptyContext });
    registerSourceControlCommands(registry);
    expect([...registry.list()].map((record) => record.id).toSorted()).toEqual([
      "git.createGithubRepository",
      "git.init",
      "git.push",
      "git.signInToGithub",
    ]);
  });
});

describe("running them", () => {
  test("Initialize reports the outcome and refreshes source control", async () => {
    let inits = 0;
    mockPlatform.gitInit = async () => {
      inits += 1;
    };
    await runCommand("git.init");
    expect(inits).toBe(1);
    expect(notifications.map((call) => call.message)).toContain("Repository initialized.");
  });

  test("an init that fails is a Problem naming itself as the Retry", async () => {
    mockPlatform.gitInit = () => Promise.reject(new Error("permission denied"));
    await runCommand("git.init");
    const failure = notifications.find((call) => call.severity === "error")!;
    expect(failure.message).toBe("Could not initialize the repository.");
    expect(failure.options.detail).toContain("permission denied");
    expect(failure.options.action).toBe("git.init");
  });

  test("Create GitHub Repository passes the project's own name", async () => {
    await runCommand("git.createGithubRepository");
    expect(repoCalls).toEqual([{ projectName: "proj" }]);
  });

  test("with no project name it still has a name to offer", async () => {
    // An empty name is no name: the panel falls back the same way it does for a missing one.
    setProjectState(project(""));
    await runCommand("git.createGithubRepository");
    expect(repoCalls).toEqual([{ projectName: "my-project" }]);
  });

  test("Push goes through the platform", async () => {
    let pushes = 0;
    mockPlatform.gitPush = async () => {
      pushes += 1;
    };
    await runCommand("git.push");
    expect(pushes).toBe(1);
  });

  test("Sign In confirms a success, and stays silent when the module already reported", async () => {
    await runCommand("git.signInToGithub");
    expect(notifications.map((call) => call.message)).toEqual(["Signed in to GitHub."]);

    // A null token means `github-auth.ts` has ALREADY reported why; a second sentence here would
    // Be the double-reporting the tier system exists to prevent.
    notifications.length = 0;
    authToken = null;
    await runCommand("git.signInToGithub");
    expect(notifications).toHaveLength(0);
  });
});
