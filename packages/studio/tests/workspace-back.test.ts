/**
 * Back to the workspace home — `src/workspace/workspace-back.ts`.
 *
 * Media, Styles and Publish draw no tab strip, so what they open beside their home is left through
 * the pane context bar's Back control and Escape. The cases open stub tabs the way the workspace
 * suites do, put the shell in a workspace, and read what the rule says and what going back does.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { DEFAULT_STYLES_HOME_VIEW, resetProjectShell, shell } from "../src/shell";
import { activeTab, closeAllTabs, closeTab, workspace } from "../src/workspace/workspace";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import {
  backTargetOf,
  backTargetOfPane,
  goBack,
  workspaceBackCommands,
} from "../src/workspace/workspace-back";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { openStubTab, openVirtualTab } from "./workspace-fixture";
import type { CommandContext, CommandContextPatch } from "../src/commands/context";
import type { Tab } from "../src/tabs/tab";

const closed: string[] = [];
const switched: { tab: string; mode: string }[] = [];
const focused: { pane: string; workspace: string }[] = [];
/** Whether the close is refused, as the strip's guarded close refuses one over unsaved work. */
let refuseClose = false;
const deps = {
  closeTab: mock((id: string) => {
    closed.push(id);
    if (!refuseClose) {
      closeTab(id);
    }
  }),
  focusHome: mock((pane: string, id: string) => {
    focused.push({ pane, workspace: id });
  }),
  setCanvasMode: mock((tab: Tab, mode: string) => {
    switched.push({ mode, tab: tab.id });
    tab.session.ui.canvasMode = mode;
  }),
};

beforeEach(() => {
  resetStudioState();
  closeAllTabs();
  resetProjectShell();
  shell.workspace = "design";
  closed.length = 0;
  switched.length = 0;
  focused.length = 0;
  refuseClose = false;
  deps.closeTab.mockClear();
  deps.setCanvasMode.mockClear();
});

afterEach(() => {
  closeAllTabs();
});

/** The media home and a viewer beside it, in Media. */
function mediaWithViewer(): Tab {
  openVirtualTab(workspaceHomeTabId("media"), "media-home");
  const viewer = openStubTab("public/logo.png", { mode: "media" });
  shell.workspace = "media";
  return viewer;
}

describe("where Back leads", () => {
  test("a media viewer leads back to Media, by closing it", () => {
    const viewer = mediaWithViewer();
    expect(backTargetOf(viewer)).toEqual({
      hint: "Close this view and return to Media",
      kind: "close",
      label: "Back to Media",
    });
    expect(backTargetOfPane("primary")?.label).toBe("Back to Media");
  });

  test("a comparison leads back to Publish", () => {
    openVirtualTab(workspaceHomeTabId("publish"), "publish-home");
    const diff = openStubTab("pages/index.json", { mode: "git-diff" });
    shell.workspace = "publish";
    expect(backTargetOf(diff)?.label).toBe("Back to Publish");
  });

  test("Code leads back to the Styles home view, which it names", () => {
    const config = openStubTab("project.json", { mode: "source" });
    shell.workspace = "styles";
    expect(shell.stylebook.view).toBe(DEFAULT_STYLES_HOME_VIEW);
    expect(backTargetOf(config)).toEqual({
      hint: "Leave the Code view for the Variables view of your styles",
      kind: "view",
      label: "Back to Variables",
      mode: "tokens",
    });
    shell.stylebook.view = "stylebook";
    expect(backTargetOf(config)?.label).toBe("Back to Elements");
  });

  test("a home, a home view and a workspace with a strip have nowhere to go back to", () => {
    const home = openVirtualTab(workspaceHomeTabId("media"), "media-home");
    shell.workspace = "media";
    expect(backTargetOf(home)).toBeNull();
    const config = openStubTab("project.json", { mode: "tokens" });
    shell.workspace = "styles";
    expect(backTargetOf(config)).toBeNull();
    const page = openStubTab("pages/index.json", { mode: "edit" });
    shell.workspace = "design";
    expect(backTargetOf(page)).toBeNull();
    expect(backTargetOf(null)).toBeNull();
  });

  test("a tab of another workspace than the one on screen has no Back", () => {
    const viewer = mediaWithViewer();
    shell.workspace = "publish";
    expect(backTargetOf(viewer)).toBeNull();
  });
});

describe("going back", () => {
  test("a viewer is closed, so the home beside it is what is left", async () => {
    mediaWithViewer();
    expect(await goBack("primary", deps)).toBe(true);
    expect(closed).toEqual(["public/logo.png"]);
    expect(workspace.tabs.has("public/logo.png")).toBe(false);
    // …and the keyboard is handed to the home, not left on the page body.
    expect(focused).toEqual([{ pane: "primary", workspace: "media" }]);
  });

  test("a close that is refused leaves the view, and the focus, where they are", async () => {
    mediaWithViewer();
    refuseClose = true;
    expect(await goBack("primary", deps)).toBe(true);
    expect(workspace.tabs.has("public/logo.png")).toBe(true);
    expect(focused).toEqual([]);
  });

  test("Code switches the tab to the home view and closes nothing", async () => {
    const config = openStubTab("project.json", { mode: "source" });
    config.session.ui.preview = true;
    shell.workspace = "styles";
    shell.stylebook.view = "stylebook";
    expect(await goBack("primary", deps)).toBe(true);
    expect(switched).toEqual([{ mode: "stylebook", tab: "project.json" }]);
    expect(config.session.ui.preview).toBe(false);
    expect(closed).toEqual([]);
  });

  test("nothing to go back from answers false and touches nothing", async () => {
    openStubTab("pages/index.json", { mode: "edit" });
    expect(await goBack("primary", deps)).toBe(false);
    expect(await goBack("nowhere", deps)).toBe(false);
    expect(closed).toEqual([]);
    expect(switched).toEqual([]);
  });
});

describe("pane.backToHome", () => {
  /** A registry holding the record, over a context this case controls. */
  function registryWith(patch: CommandContextPatch = {}) {
    const registry = createCommandRegistry({
      getContext: (): CommandContext => makeContext({ editor: { kind: "media" }, ...patch }),
    });
    registry.registerAll(workspaceBackCommands(deps));
    return registry;
  }

  test("is Escape, in the palette, and takes an optional pane", () => {
    const [record] = workspaceBackCommands(deps);
    expect(record?.id).toBe("pane.backToHome");
    expect(record?.keybinding).toBe("escape");
    expect(record?.menus).toEqual(["palette"]);
    expect(record?.args?.required).toEqual([]);
    expect(Object.keys(record?.args?.properties ?? {})).toEqual(["pane"]);
  });

  test("is there only over a view with a Back, and never steals Escape from a field or Code", () => {
    expect(registryWith().isVisible("pane.backToHome")).toBe(false);
    mediaWithViewer();
    expect(registryWith().isVisible("pane.backToHome")).toBe(true);
    expect(
      registryWith({ caret: { active: true, inCanvas: false } }).isVisible("pane.backToHome"),
    ).toBe(false);
    expect(registryWith({ editor: { kind: "code" } }).isVisible("pane.backToHome")).toBe(false);
  });

  test("leaves Escape to an open popover, which the platform closes with it", () => {
    mediaWithViewer();
    const panel = document.createElement("div");
    /* `bind` resolves to the deprecated-tag-name overload; the call below only passes selectors. */
    // oxlint-disable-next-line typescript/no-deprecated
    const query = document.querySelector.bind(document);
    /* Happy-dom matches nothing for `:popover-open`, so the top layer is stood in for here: the
       question asked is the selector, and the answer is a popover showing. */
    const spy = spyOn(document, "querySelector").mockImplementation((selector: string) =>
      selector === ":popover-open" ? panel : query(selector),
    );
    try {
      expect(registryWith().isVisible("pane.backToHome")).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(registryWith().isVisible("pane.backToHome")).toBe(true);
  });

  test("goes back in the focused pane, or in the one named", async () => {
    mediaWithViewer();
    await registryWith().run("pane.backToHome");
    expect(closed).toEqual(["public/logo.png"]);
    expect(activeTab.value?.id).toBe(workspaceHomeTabId("media"));
  });

  test("a named pane with nothing to go back from is refused by name", async () => {
    mediaWithViewer();
    const registry = registryWith();
    let message = "";
    try {
      await registry.run("pane.backToHome", { pane: "secondary" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('pane "secondary" shows no view opened beside a workspace home');
  });
});
