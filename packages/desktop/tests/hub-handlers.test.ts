// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppInfo } from "@jxsuite/protocol";
import type { HubControl, HubWindow } from "../src/backend/handlers";
import type { ProjectSession, pickProjectFile } from "../src/backend/project-session";
import { rpcParity } from "./_rpc-parity";

/*
 * `buildWindowHandlers` takes the window's session as an argument, so a recording stand-in goes
 * where the real one would: what is checked is that every handler reaches the right collaborator
 * with the right params. The modules that would spawn git or bun, open a browser or touch the
 * user's config are replaced for the same reason, before the module under test is imported.
 */

/** One collaborator call: who, and with what. */
interface Call {
  args: unknown[];
  name: string;
}

const calls: Call[] = [];

/** A function that records its call and answers with a marker naming it. */
type Recorded = (...args: unknown[]) => Promise<{ via: string }>;

/** A function that records its call under `name` and answers with a marker naming it. */
function recorder(name: string): Recorded {
  return (...args) => {
    calls.push({ args, name });
    return Promise.resolve({ via: name });
  };
}

/** An object whose every property is a recorder named `<prefix>.<property>`. */
function recording(prefix: string) {
  return new Proxy(
    {},
    {
      get: (_target, property) => recorder(`${prefix}.${String(property)}`),
    },
  );
}

void mock.module("../src/backend/git", () => ({ createGitOps: () => recording("git") }));
void mock.module("../src/backend/packages", () => ({ createPackageOps: () => recording("pkg") }));
void mock.module("../src/backend/github-signin", () => ({
  githubSignIn: recorder("githubSignIn"),
  githubSignOut: recorder("githubSignOut"),
  githubTokenStatus: recorder("githubTokenStatus"),
}));
/** What the stand-in session and picker answer for the calls whose result a handler inspects. */
interface Answers {
  openProject: Awaited<ReturnType<ProjectSession["openProject"]>>;
  pickedProject: Awaited<ReturnType<typeof pickProjectFile>>;
}

const answers: Answers = {
  openProject: null,
  pickedProject: null,
};

void mock.module("../src/backend/project-session", () => ({
  pickProjectFile: () => {
    calls.push({ args: [], name: "pickProjectFile" });
    return Promise.resolve(answers.pickedProject);
  },
}));
void mock.module("../src/backend/recent-store", () => ({
  readRecents: recorder("readRecents"),
  writeRecents: recorder("writeRecents"),
}));
void mock.module("../src/backend/settings-store", () => ({
  patchSettings: recorder("patchSettings"),
  readSettings: recorder("readSettings"),
}));

const { buildWindowHandlers } = await import("../src/backend/handlers");

/** A stand-in session, and a way to read the root it has been pointed at. */
interface FakeSession {
  root: () => string | null;
  session: HubWindow["session"];
}

/**
 * A session whose project root is state, whose `openProject` answers `answers`, and whose every
 * other member records.
 */
function fakeSession(): FakeSession {
  let root: string | null = "/proj";
  const session = new Proxy(
    {},
    {
      get: (_target, property) => {
        switch (property) {
          case "projectRoot": {
            return root;
          }
          case "setProjectRoot": {
            return (next: string | null) => {
              calls.push({ args: [next], name: "session.setProjectRoot" });
              root = next;
            };
          }
          case "openProject": {
            return () => Promise.resolve(answers.openProject);
          }
          // Synchronous and void in the real session; the handler map is where they become promises.
          case "setPreviewOverlay":
          case "clearPreviewOverlay": {
            return (...args: unknown[]) => {
              calls.push({ args, name: `session.${String(property)}` });
            };
          }
          default: {
            return recorder(`session.${String(property)}`);
          }
        }
      },
    },
  );
  // SAFETY: the stand-in answers every member of ProjectSession the handler map reads, by name.
  return { root: () => root, session: session as HubWindow["session"] };
}

/** A hub that records what its windows ask of it. */
interface FakeHub extends HubControl {
  /** The window `findWindowByRoot` answers with. */
  held: HubWindow | null;
  raised: HubWindow[];
  retitled: HubWindow[];
}

function fakeHub(): FakeHub {
  const hub: FakeHub = {
    held: null,
    raised: [],
    retitled: [],
    appInfo: (): AppInfo => ({ channel: "c", hash: "h", version: "v" }),
    findWindowByRoot: (root: string, except?: HubWindow) => {
      calls.push({ args: [root, except], name: "hub.findWindowByRoot" });
      return hub.held;
    },
    focus: (window: HubWindow) => {
      hub.raised.push(window);
    },
    listOpenWindows: () => [{ id: 7, projectRoot: "/x" }],
    openProject: (root: string | null) => {
      calls.push({ args: [root], name: "hub.openProject" });
      return { focused: root === "/held" };
    },
    retitle: (window: HubWindow) => {
      hub.retitled.push(window);
    },
  };
  return hub;
}

/** Build a window's handlers over the stand-ins. */
function build() {
  const hub = fakeHub();
  const { root, session } = fakeSession();
  const window: HubWindow = { id: 3, session };
  return { handlers: buildWindowHandlers(window, hub), hub, root, window };
}

/** The recorded calls to `name`. */
function callsTo(name: string): Call[] {
  return calls.filter((call) => call.name === name);
}

beforeEach(() => {
  calls.length = 0;
  answers.openProject = null;
  answers.pickedProject = null;
});

describe("schema parity", () => {
  test("every declared request is answered here", () => {
    const parity = rpcParity(Object.keys(build().handlers));
    expect(parity.unhandled).toEqual([]);
    expect(parity.undeclared).toEqual([]);
  });
});

/** Handlers that pass their params straight to one collaborator. */
const PASSTHROUGH: [string, string][] = [
  ["addPackage", "pkg.addPackage"],
  ["codeService", "session.codeService"],
  ["createDirectory", "session.handleCreateDirectory"],
  ["dataConnectionTest", "session.dataConnectionTest"],
  ["dataDeleteRow", "session.dataDeleteRow"],
  ["dataInsertRow", "session.dataInsertRow"],
  ["dataPush", "session.dataPush"],
  ["dataRows", "session.dataRows"],
  ["dataUpdateRow", "session.dataUpdateRow"],
  ["deleteFile", "session.handleDeleteFile"],
  ["discoverComponents", "session.discoverComponents"],
  ["fetchPluginSchema", "session.fetchPluginSchema"],
  ["findReferences", "session.findReferences"],
  ["formatAction", "session.formatAction"],
  ["gitAddRemote", "git.gitAddRemote"],
  ["gitCheckout", "git.gitCheckout"],
  ["gitCommit", "git.gitCommit"],
  ["gitCreateBranch", "git.gitCreateBranch"],
  ["gitDiff", "git.gitDiff"],
  ["gitDiscard", "git.gitDiscard"],
  ["gitLog", "git.gitLog"],
  ["gitPush", "git.gitPush"],
  ["gitShow", "git.gitShow"],
  ["gitStage", "git.gitStage"],
  ["gitUnstage", "git.gitUnstage"],
  ["githubSignIn", "githubSignIn"],
  ["jxResolve", "session.jxResolve"],
  ["jxServerFunction", "session.jxServerFunction"],
  ["listDirectory", "session.listDirectory"],
  ["locateFile", "session.locateFile"],
  ["openExternal", "session.openExternal"],
  ["previewSite", "session.previewSite"],
  ["readFile", "session.handleReadFile"],
  ["readFileBytes", "session.handleReadFileBytes"],
  ["removePackage", "pkg.removePackage"],
  ["renameFile", "session.handleRenameFile"],
  ["resolveSiteContext", "session.handleResolveSiteContext"],
  ["searchFiles", "session.searchFiles"],
  ["setPackageVersions", "pkg.setPackageVersions"],
  ["setSecrets", "session.setSecrets"],
  ["uploadFile", "session.handleUploadFile"],
  ["writeFile", "session.handleWriteFile"],
];

/** Handlers that take no params and reach one collaborator. */
const NO_PARAMS: [string, string][] = [
  ["buildSite", "session.buildSite"],
  ["dataConnections", "session.dataConnections"],
  ["dependenciesNeedInstall", "pkg.dependenciesNeedInstall"],
  ["fetchProjectSchemas", "session.fetchProjectSchemas"],
  ["getRecentProjects", "readRecents"],
  ["getSettings", "readSettings"],
  ["gitBranches", "git.gitBranches"],
  ["gitFetch", "git.gitFetch"],
  ["gitInit", "git.gitInit"],
  ["gitPull", "git.gitPull"],
  ["gitStatus", "git.gitStatus"],
  ["githubSignOut", "githubSignOut"],
  ["githubToken", "githubTokenStatus"],
  ["installDependencies", "pkg.installDependencies"],
  ["listExtensionCatalog", "session.listExtensionCatalog"],
  ["listExtensions", "session.listExtensions"],
  ["listFormats", "session.listFormats"],
  ["listPackages", "pkg.listPackages"],
  ["listSecrets", "session.listSecrets"],
  ["packageVersions", "pkg.packageVersions"],
  ["pickDirectory", "session.pickDirectory"],
];

describe("handlers that reach one collaborator", () => {
  test.each(PASSTHROUGH)("%s passes its params to %s", async (name, target) => {
    const { handlers } = build();
    const params = { probe: name };
    // SAFETY: `name` is a key of the map this table was written from.
    await handlers[name as keyof typeof handlers](params);
    expect(callsTo(target)).toEqual([{ args: [params], name: target }]);
  });

  test.each(NO_PARAMS)("%s reaches %s", async (name, target) => {
    const { handlers } = build();
    // SAFETY: `name` is a key of the map this table was written from.
    await handlers[name as keyof typeof handlers]({ ignored: true });
    expect(callsTo(target)).toHaveLength(1);
    expect(callsTo(target)[0]?.args).toEqual([]);
  });

  test("the git and package operations that take no params are not handed the frame's", async () => {
    const { handlers } = build();
    await handlers.gitFetch({ stray: 1 });
    await handlers.githubSignOut({ stray: 1 });
    expect(callsTo("git.gitFetch")[0]?.args).toEqual([]);
    expect(callsTo("githubSignOut")[0]?.args).toEqual([]);
  });
});

describe("the preview overlay", () => {
  test("setPreviewOverlay and clearPreviewOverlay adapt the session's synchronous calls", async () => {
    const { handlers } = build();
    const published = handlers.setPreviewOverlay({ contents: "{}", path: "a.json" });
    const retracted = handlers.clearPreviewOverlay({ path: "a.json" });
    // The map's contract is a promise; the session's calls return nothing.
    expect(published).toBeInstanceOf(Promise);
    expect(retracted).toBeInstanceOf(Promise);
    expect(await published).toBeUndefined();
    expect(await retracted).toBeUndefined();
    expect(callsTo("session.setPreviewOverlay")[0]?.args).toEqual([
      { contents: "{}", path: "a.json" },
    ]);
    expect(callsTo("session.clearPreviewOverlay")[0]?.args).toEqual([{ path: "a.json" }]);
  });
});

describe("user-level stores", () => {
  test("saveRecentProjects writes the list, and patchSettings the patch", async () => {
    const { handlers } = build();
    await handlers.saveRecentProjects({ projects: [{ name: "a", root: "/a" }] });
    await handlers.patchSettings({ patch: { theme: "dark" } });
    expect(callsTo("writeRecents")[0]?.args).toEqual([[{ name: "a", root: "/a" }]]);
    expect(callsTo("patchSettings")[0]?.args).toEqual([{ theme: "dark" }]);
  });

  test("listStarters answers from the starters registry", async () => {
    const { handlers } = build();
    expect(Array.isArray(await handlers.listStarters())).toBe(true);
  });
});

describe("window-level handlers", () => {
  test("getProjectRoot reports the session's root as it changes", async () => {
    const { handlers, window } = build();
    expect(await handlers.getProjectRoot()).toEqual({ root: "/proj" });
    window.session.setProjectRoot("/next");
    expect(await handlers.getProjectRoot()).toEqual({ root: "/next" });
  });

  test("appInfo and listOpenWindows come from the hub", async () => {
    const { handlers } = build();
    expect(await handlers.appInfo()).toEqual({ channel: "c", hash: "h", version: "v" });
    expect(await handlers.listOpenWindows()).toEqual([{ id: 7, projectRoot: "/x" }]);
  });

  test("newWindow opens a welcome window; openProjectInNewWindow says what happened", async () => {
    const { handlers } = build();
    expect(await handlers.newWindow(null)).toBeUndefined();
    expect(callsTo("hub.openProject")[0]?.args).toEqual([null]);
    expect(await handlers.openProjectInNewWindow({ root: "/held" })).toEqual({ focused: true });
    expect(await handlers.openProjectInNewWindow({ root: "/free" })).toEqual({ focused: false });
  });

  test("pickProject picks without binding, answers name and root only, and cancel is null", async () => {
    const { handlers } = build();
    expect(await handlers.pickProject()).toBeNull();
    answers.pickedProject = { config: { name: "p" }, name: "p", root: "/p" };
    expect(await handlers.pickProject()).toEqual({ name: "p", root: "/p" });
    // Binding is `openProject`'s job; the New Window branch must not re-root this window.
    expect(callsTo("session.setProjectRoot")).toEqual([]);
  });

  test("openProject retitles the window only when a project was opened", async () => {
    const { handlers, hub, window } = build();
    expect(await handlers.openProject()).toBeNull();
    expect(hub.retitled).toEqual([]);
    const opened = {
      config: { name: "p" },
      handle: { name: "p", projectConfig: { name: "p" }, root: "/p" },
    };
    answers.openProject = opened;
    expect(await handlers.openProject()).toEqual(opened);
    expect(hub.retitled).toEqual([window]);
  });

  test("createProject retitles the window once the project exists", async () => {
    const { handlers, hub, window } = build();
    const params = { name: "new" };
    expect(await handlers.createProject(params)).toEqual({ via: "session.createProject" });
    expect(callsTo("session.createProject")[0]?.args).toEqual([params]);
    expect(hub.retitled).toEqual([window]);
  });

  test("setWindowProject binds a free project and retitles", async () => {
    const { handlers, hub, root, window } = build();
    expect(await handlers.setWindowProject({ root: "/free" })).toEqual({
      config: null,
      deduped: false,
    });
    expect(root()).toBe("/free");
    expect(hub.retitled).toEqual([window]);
    // The window asks about OTHER windows: it passes itself to be excluded.
    expect(callsTo("hub.findWindowByRoot")[0]?.args).toEqual(["/free", window]);
  });

  test("setWindowProject raises the window that holds the project and binds nothing", async () => {
    const { handlers, hub, root } = build();
    const holder: HubWindow = { id: 9, session: fakeSession().session };
    hub.held = holder;
    expect(await handlers.setWindowProject({ root: "/held" })).toEqual({
      config: null,
      deduped: true,
    });
    expect(hub.raised).toEqual([holder]);
    expect(root()).toBe("/proj");
    expect(hub.retitled).toEqual([]);
  });
});
