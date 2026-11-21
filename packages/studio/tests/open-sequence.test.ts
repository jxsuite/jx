/**
 * Tests for src/files/open-sequence.ts: the sequence every door into a project runs.
 *
 * Driven through the real modules over the mock platform, because what the sequence promises is an
 * ORDER across them: the format registry a fresh project answers with is empty until its
 * dependencies are installed, and the project must be read with the registry the install made.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import {
  enterProject,
  leaveProject,
  loadOpenedProject,
  resetProjectRegistries,
} from "../src/files/open-sequence";
import type { OpenPhase } from "../src/files/open-sequence";
import { getFormats, onFormatsChanged, setFormats } from "../src/format/format-host";
import type { StudioFormat } from "../src/format/format-host";
import { componentRegistry } from "../src/files/components";
import { projectState } from "../src/store";
import { workspace } from "../src/workspace/workspace";
import { markSessionRestored, persistProjectShell, shell } from "../src/shell";
import { resetNotifications } from "../src/services/notify";
import { resetActivities } from "../src/panels/activity-panel";
import { projectConfigPath } from "../src/tabs/tab";
import type { ProjectState } from "../src/types";

beforeAll(() => {
  // The install reports through the progress modal, which mounts into the modal layer.
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    if (!document.querySelector(`#${id}`)) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
  }
  initLayers();
});

afterEach(() => {
  setFormats([]);
  resetNotifications();
  resetActivities();
});

const MARKDOWN: StudioFormat = {
  capabilities: {},
  documentKinds: ["page"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "markdown",
  remote: false,
  studio: null,
};

function siteState(root: string): ProjectState {
  return {
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "Starter",
    projectConfig: { name: "Starter" },
    projectDirs: [],
    projectRoot: root,
    searchQuery: "",
    selectedPath: null,
  };
}

/**
 * A project created from a starter: no `node_modules`, so the registry is empty until the install
 * has run, and the install is needed exactly once.
 */
function freshStarter(opts: { needsInstall: boolean }) {
  let installed = !opts.needsInstall;
  const order: string[] = [];
  const installMock = installMockPlatform(
    {
      dependenciesNeedInstall: async () => !installed,
      discoverComponents: async () => {
        order.push(`components:${getFormats().length}`);
        return [{ path: "components/card.json", props: [], tagName: "x-card" }];
      },
      installDependencies: async () => {
        order.push("install");
        installed = true;
        return { ok: true };
      },
      listFormats: async () => (installed ? [MARKDOWN] : []),
    },
    { "pages/index.md": "# Home\n", "project.json": JSON.stringify({ name: "Starter" }) },
  );
  return { order, ...installMock };
}

describe("loadOpenedProject", () => {
  test("a fresh starter is read with the registry its install made, not the empty one", async () => {
    resetStudioState();
    const { order, platform } = freshStarter({ needsInstall: true });
    const phases: OpenPhase[] = [];
    const heard = mock(() => {});
    const stop = onFormatsChanged(heard);
    try {
      // What every door does first: the previous root's registry goes, and this root's starts.
      resetProjectRegistries(platform);
      const result = await loadOpenedProject({
        loadDirectories: async () => {
          order.push(`directories:${getFormats().length}`);
        },
        onPhase: (phase) => phases.push(phase),
        platform,
      });
      expect(result).toEqual({ installed: true });
    } finally {
      stop();
    }
    expect(phases).toEqual(["Sync with the remote", "Install dependencies", "Read the project"]);
    expect(getFormats().map((format) => format.name)).toEqual(["markdown"]);
    // The tree and the component scan were read after the install, with markdown already known.
    expect(order).toEqual(["install", "directories:1", "components:1"]);
    expect(componentRegistry.map((entry) => entry.tagName)).toEqual(["x-card"]);
    // The Site panel subscribes here to drop the index it built from the empty registry.
    expect(heard).toHaveBeenCalled();
  });

  test("a project with its dependencies in place installs nothing and still resolves the registry", async () => {
    resetStudioState();
    const { order, platform } = freshStarter({ needsInstall: false });
    resetProjectRegistries(platform);
    const loadDirectories = mock(async () => {});
    expect(await loadOpenedProject({ loadDirectories, platform })).toEqual({ installed: false });
    expect(loadDirectories).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["components:1"]);
    expect(getFormats().map((format) => format.name)).toEqual(["markdown"]);
  });
});

describe("enterProject", () => {
  test("adopts the state, learns the project file and binds the workspace", async () => {
    resetStudioState();
    const { platform } = installMockPlatform({}, { "project.jxn": "{ name: 'Starter' }\n" });
    shell.stylebook.filter = "from the project being left";
    const resetProjectCaches = mock(() => {});
    await enterProject({
      platform,
      resetProjectCaches,
      site: { config: { name: "Starter" }, root: "/projects/starter" },
      state: siteState("/projects/starter"),
    });
    expect(projectState?.name).toBe("Starter");
    expect(workspace.projectRoot).toBe("/projects/starter");
    expect(projectConfigPath()).toBe("project.jxn");
    // The previous project's shell slots went with it.
    expect(shell.stylebook.filter).toBe("");
    expect(resetProjectCaches).toHaveBeenCalledTimes(1);
  });

  test("a door that already left the previous project does not leave it twice", async () => {
    resetStudioState();
    const { platform } = installMockPlatform();
    const resetProjectCaches = mock(() => {});
    leaveProject({ resetProjectCaches });
    await enterProject({
      left: true,
      platform,
      resetProjectCaches,
      site: null,
      state: siteState("/projects/left"),
    });
    // The state was still adopted; only the leaving half was not run again.
    expect(projectState?.projectRoot).toBe("/projects/left");
    expect(resetProjectCaches).toHaveBeenCalledTimes(1);
  });

  test("a door that already learned the file name does not list the root again", async () => {
    resetStudioState();
    const { platform, state } = installMockPlatform();
    await enterProject({
      fileNameLearned: true,
      platform,
      site: { config: null, root: "/projects/other" },
      state: siteState("/projects/other"),
    });
    expect(state.calls.some((call) => call[0] === "listDirectory")).toBe(false);
    expect(workspace.projectRoot).toBe("/projects/other");
  });

  test("a root that is not a site project binds no workspace", async () => {
    resetStudioState();
    const { platform, state } = installMockPlatform();
    const before = workspace.projectRoot;
    await enterProject({
      platform,
      site: null,
      state: { ...siteState("."), isSiteProject: false, name: "monorepo" },
    });
    expect(projectState?.name).toBe("monorepo");
    expect(workspace.projectRoot).toBe(before);
    expect(state.calls.some((call) => call[0] === "listDirectory")).toBe(false);
  });
});

describe("leaveProject", () => {
  test("lets go of the project being left, so its session is no longer this window's to write", () => {
    resetStudioState();
    const root = workspace.projectRoot ?? "";
    expect(root).not.toBe("");
    const key = `jx-studio-project::${root}`;
    const kept = { session: { focusedPane: "p", panes: [{ files: ["pages/a.json"] }] } };
    localStorage.setItem(key, JSON.stringify(kept));
    markSessionRestored(root);
    shell.stylebook.filter = "from the project being left";
    const resetProjectCaches = mock(() => {});
    leaveProject({ resetProjectCaches });
    // What closing the tabs next does: a shape change persists the session of the current root.
    persistProjectShell();
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    expect(stored).toMatchObject(kept);
    expect(shell.stylebook.filter).toBe("");
    expect(resetProjectCaches).toHaveBeenCalledTimes(1);
    localStorage.removeItem(key);
  });

  test("a door with no panel caches of its own leaves with no options", () => {
    resetStudioState();
    shell.stylebook.filter = "from the project being left";
    expect(() => leaveProject()).not.toThrow();
    expect(shell.stylebook.filter).toBe("");
  });
});
