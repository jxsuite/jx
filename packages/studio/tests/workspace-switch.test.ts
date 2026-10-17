/**
 * Switching workspaces — `src/workspace/workspace-switch.ts`.
 *
 * The two invariants: activating a tab enters its workspace (the follow), and showing a workspace
 * shows its tabs — its most recent one, or its home (the switch). The homes that belong to other
 * modules are injected, so these cases hand in openers that open a stand-in tab and record that
 * they ran.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setFormats } from "../src/format/format-host";
import { MARKDOWN_FORMAT } from "./format-fixture";
import { resetProjectShell, shell, syncProjectWorkspace } from "../src/shell";
import {
  activateTab,
  activeTab,
  closeAllTabs,
  closeTab,
  cycleTab,
  endTabCycle,
  openTab,
  paneById,
  splitRight,
  workspace,
} from "../src/workspace/workspace";
import {
  installWorkspaceFollow,
  revealInPane,
  switchWorkspace,
} from "../src/workspace/workspace-switch";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import { libraryTabId } from "../src/browse/library-source";
import type { InspectorTabId } from "../src/shell";
import { openStubTab } from "./workspace-fixture";

const tab = openStubTab;

const inspectorWrites: { tab: string | null; value: InspectorTabId }[] = [];
const deps = {
  openHome: mock((id: "media" | "publish") => {
    tab(workspaceHomeTabId(id), { mode: `${id}-home`, path: null });
  }),
  openLibrary: mock(() => {
    tab(libraryTabId(), { mode: "manage", path: null });
  }),
  openStyles: mock(() => {
    const existing = workspace.tabs.get("project.json");
    if (existing) {
      existing.session.ui.canvasMode = "stylebook";
      activateTab("project.json");
      return;
    }
    tab("project.json", { mode: "stylebook" });
  }),
  setInspectorTab: (value: InspectorTabId) => {
    inspectorWrites.push({ tab: activeTab.value?.id ?? null, value });
  },
};

/** Stops the follow this file's `beforeEach` started. */
let stopFollow: () => void = () => {};

beforeEach(() => {
  setFormats([MARKDOWN_FORMAT]);
  resetStudioState({
    projectConfig: {
      content: { posts: { format: "Markdown", source: "./content/posts/" } },
    },
  });
  stopFollow();
  closeAllTabs();
  resetProjectShell();
  syncProjectWorkspace(null);
  shell.workspace = "design";
  shell.docks.left.collapsed = false;
  shell.docks.right.collapsed = false;
  inspectorWrites.length = 0;
  deps.openHome.mockClear();
  deps.openLibrary.mockClear();
  deps.openStyles.mockClear();
  stopFollow = installWorkspaceFollow(deps);
});

afterEach(() => {
  stopFollow();
  closeAllTabs();
});

describe("the follow: activating a tab enters its workspace", () => {
  test("opening an entry enters Content, and opening a page enters Design again", () => {
    tab("pages/index.json");
    expect(shell.workspace).toBe("design");
    tab("content/posts/hello.md");
    expect(shell.workspace).toBe("content");
    tab("pages/about.json");
    expect(shell.workspace).toBe("design");
  });

  test("entering by activation lays the frame out too", () => {
    tab("public/logo.png", { mode: "media" });
    expect(shell.workspace).toBe("media");
    expect(shell.docks.left.collapsed).toBe(true);
    expect(shell.docks.right.collapsed).toBe(true);
  });

  test("a tab's editor moving it to another workspace moves the workspace with it", () => {
    const config = tab("project.json", { mode: "settings" });
    expect(shell.workspace).toBe("design");
    config.session.ui.canvasMode = "stylebook";
    expect(shell.workspace).toBe("styles");
  });

  test("the preset's Inspector tab lands on the tab being entered, not the one being left", () => {
    tab("pages/index.json");
    tab("project.json", { mode: "stylebook" });
    expect(inspectorWrites).toEqual([{ tab: "project.json", value: "style" }]);
  });

  test("install is idempotent, and the stop it returns ends the follow", () => {
    const again = installWorkspaceFollow(deps);
    expect(again).toBe(stopFollow);
    again();
    tab("content/posts/hello.md");
    expect(shell.workspace).toBe("design");
  });
});

describe("the switch: showing a workspace shows its tabs", () => {
  test("it activates the workspace's most recent tab", () => {
    tab("content/posts/one.md");
    tab("content/posts/two.md");
    tab("pages/index.json");
    activateTab("content/posts/one.md");
    activateTab("pages/index.json");
    switchWorkspace("content", deps);
    expect(shell.workspace).toBe("content");
    expect(activeTab.value?.id).toBe("content/posts/one.md");
    expect(deps.openLibrary).not.toHaveBeenCalled();
  });

  test("with none open it opens the workspace's home", () => {
    tab("pages/index.json");
    switchWorkspace("content", deps);
    expect(deps.openLibrary).toHaveBeenCalledTimes(1);
    expect(activeTab.value?.id).toBe(libraryTabId());

    switchWorkspace("media", deps);
    expect(deps.openHome).toHaveBeenCalledWith("media");
    expect(activeTab.value?.id).toBe(workspaceHomeTabId("media"));

    switchWorkspace("publish", deps);
    expect(deps.openHome).toHaveBeenCalledWith("publish");
    expect(shell.workspace).toBe("publish");

    switchWorkspace("styles", deps);
    expect(deps.openStyles).toHaveBeenCalledTimes(1);
    expect(activeTab.value?.id).toBe("project.json");
    expect(shell.workspace).toBe("styles");
  });

  test("Styles' Inspector tab is written on project.json, never on the page being left", () => {
    tab("pages/index.json");
    switchWorkspace("styles", deps);
    expect(inspectorWrites.map((write) => write.tab)).toEqual(["project.json"]);
  });

  test("Design with nothing open shows nothing: the pane keeps its tabs and shows none", () => {
    tab("content/posts/one.md");
    expect(shell.workspace).toBe("content");
    switchWorkspace("design", deps);
    expect(shell.workspace).toBe("design");
    expect(activeTab.value).toBeNull();
    expect(workspace.panes[0]!.tabOrder).toEqual(["content/posts/one.md"]);
    // …and the tab comes back when its workspace does.
    switchWorkspace("content", deps);
    expect(activeTab.value?.id).toBe("content/posts/one.md");
  });

  test("showing the workspace already on screen changes nothing", () => {
    tab("pages/index.json");
    switchWorkspace("design", deps);
    expect(activeTab.value?.id).toBe("pages/index.json");
    expect(shell.workspace).toBe("design");
  });

  test("a side pane follows the switch with its own tabs", () => {
    tab("pages/index.json");
    tab("content/posts/one.md");
    activateTab("pages/index.json");
    const side = splitRight("pages/index.json")!;
    expect(side.activeTabId).toBe("pages/index.json");
    // The primary still holds the entry; the side pane holds the page.
    switchWorkspace("content", deps);
    expect(activeTab.value?.id).toBe("content/posts/one.md");
    expect(paneById(side.id)?.activeTabId).toBeNull();
    switchWorkspace("design", deps);
    expect(activeTab.value?.id).toBe("pages/index.json");
  });
});

describe("the panes the author is not in hold to the workspace too", () => {
  /** Two panes, the side one focused away from, the window in Styles. */
  function stylesWithSide() {
    tab("pages/a.json");
    tab("pages/b.json");
    const side = splitRight("pages/b.json")!;
    activateTab("pages/a.json");
    tab("project.json", { mode: "stylebook" });
    expect(shell.workspace).toBe("styles");
    expect(paneById(side.id)?.activeTabId).toBeNull();
    return side;
  }

  test("a read into an unfocused pane cannot put another workspace's tab on its stage", async () => {
    const side = stylesWithSide();
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/c.json",
      focus: false,
      id: "pages/c.json",
      paneId: side.id,
    });
    // The open itself lands the tab, as a read does…
    expect(paneById(side.id)?.activeTabId).toBe("pages/c.json");
    await Promise.resolve();
    // …and the pane is pointed back at the workspace: it holds no Styles tab, so it shows none.
    expect(paneById(side.id)?.activeTabId).toBeNull();
    expect(paneById(side.id)?.tabOrder).toContain("pages/c.json");
    expect(shell.workspace).toBe("styles");
    // The tab is still open, and comes back with Design.
    switchWorkspace("design", deps);
    await Promise.resolve();
    expect(paneById(side.id)?.activeTabId).not.toBeNull();
  });

  test("an unfocused pane is re-pointed at its own tab of the workspace when it has one", async () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    const side = splitRight("content/posts/one.md")!;
    activateTab("pages/a.json");
    expect(shell.workspace).toBe("design");
    // The side pane holds a Content entry, and is aligned: it shows nothing of Design's.
    expect(paneById(side.id)?.activeTabId).toBeNull();
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/d.json",
      focus: false,
      id: "pages/d.json",
      paneId: side.id,
    });
    activateTab("content/posts/one.md", { focus: false });
    expect(paneById(side.id)?.activeTabId).toBe("content/posts/one.md");
    await Promise.resolve();
    expect(paneById(side.id)?.activeTabId).toBe("pages/d.json");
  });

  test("revealing a compared document of another workspace enters that workspace", () => {
    const side = stylesWithSide();
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/c.json",
      focus: false,
      id: "pages/c.json",
      paneId: side.id,
    });
    revealInPane(side.id, "pages/c.json");
    expect(shell.workspace).toBe("design");
    expect(activeTab.value?.id).toBe("pages/c.json");
    expect(workspace.activePaneId).toBe(side.id);
  });

  test("revealing a document of the workspace on screen leaves the keyboard where it was", () => {
    tab("pages/a.json");
    tab("pages/b.json");
    const side = splitRight("pages/b.json")!;
    activateTab("pages/a.json");
    revealInPane(side.id, "pages/b.json");
    revealInPane(side.id, "pages/nowhere.json");
    revealInPane("no-such-pane", "pages/b.json");
    expect(workspace.activePaneId).not.toBe(side.id);
    expect(activeTab.value?.id).toBe("pages/a.json");
  });

  test("a stopped follow no longer aligns", async () => {
    const side = stylesWithSide();
    stopFollow();
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/c.json",
      focus: false,
      id: "pages/c.json",
      paneId: side.id,
    });
    await Promise.resolve();
    expect(paneById(side.id)?.activeTabId).toBe("pages/c.json");
  });
});

describe("Content's Inspector follows what is being written", () => {
  test("entering Content on an entry being written draws the Inspector", () => {
    tab("pages/index.json");
    tab("content/posts/one.md", { mode: "edit" });
    expect(shell.workspace).toBe("content");
    expect(shell.docks.right.collapsed).toBe(false);
  });

  test("moving between the Library and an entry inside Content opens and closes it", () => {
    tab("pages/index.json");
    switchWorkspace("content", deps);
    expect(activeTab.value?.id).toBe(libraryTabId());
    expect(shell.docks.right.collapsed).toBe(true);
    tab("content/posts/one.md", { mode: "edit" });
    expect(shell.workspace).toBe("content");
    expect(shell.docks.right.collapsed).toBe(false);
    activateTab(libraryTabId());
    expect(shell.docks.right.collapsed).toBe(true);
  });

  test("an author's own toggle on the same tab is left alone", () => {
    tab("content/posts/one.md", { mode: "edit" });
    shell.docks.right.collapsed = true;
    // Re-running the follow over the same tab changes nothing about the dock.
    activateTab("content/posts/one.md");
    expect(shell.docks.right.collapsed).toBe(true);
  });

  test("Design's Inspector does not follow the writing rule", () => {
    tab("pages/index.json", { mode: "edit" });
    shell.docks.right.collapsed = true;
    tab("pages/about.json", { mode: "source" });
    expect(shell.docks.right.collapsed).toBe(true);
  });
});

describe("the fallback is scoped to the workspace", () => {
  test("closing a workspace's last tab stays in the workspace and shows nothing", () => {
    tab("pages/index.json");
    tab("content/posts/one.md");
    expect(shell.workspace).toBe("content");
    closeTab("content/posts/one.md");
    expect(shell.workspace).toBe("content");
    expect(activeTab.value).toBeNull();
  });

  test("closing a tab lands on the workspace's previous tab, not the other workspace's", () => {
    tab("content/posts/one.md");
    tab("pages/index.json");
    tab("content/posts/two.md");
    closeTab("content/posts/two.md");
    expect(activeTab.value?.id).toBe("content/posts/one.md");
    expect(shell.workspace).toBe("content");
  });

  test("⌃Tab walks the workspace's tabs only", () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    tab("pages/b.json");
    cycleTab(1);
    endTabCycle();
    expect(activeTab.value?.id).toBe("pages/a.json");
    expect(shell.workspace).toBe("design");
  });
});
