/**
 * Project Settings as a workspace: `src/settings/settings-workspace.ts`, the flow that draws the
 * settings editor as the Settings workspace's home (§17.1, §22.9).
 *
 * What is pinned: the home mounts once per pane and visit, carrying `pane.<id>/settings`; it is
 * torn down with the pane's stage; the keyboard lands on the current section's row whether the home
 * was drawn before or after it was asked for; Back names and returns to the workspace Settings was
 * entered from (Design when there was none); and the Moved buttons leave for the named workspace
 * through the command, in the order a preset cannot undo.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  detachSettingsWorkspace,
  focusSettingsHome,
  leaveSettings,
  renderSettingsWorkspace,
  returnWorkspace,
  settingsRegion,
  settingsWorkspaceMounted,
} from "../src/settings/settings-workspace";
import { resetSettingsDocumentState, setSettingsSection } from "../src/settings/section-registry";
import { enterWorkspace, syncProjectWorkspace } from "../src/shell";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { mountsOf } from "../src/services/surface-registry";
import { isString } from "@jxsuite/schema/guards";
import { openWorkspaceHome } from "../src/workspace/workspace-home";
import { closeAllTabs } from "../src/workspace/workspace";
import "../src/settings/settings-document";
import type { CommandArgValues } from "../src/commands/command-args";
import type { CommandContext } from "../src/commands/context";
import type { Tab } from "../src/tabs/tab";

/** The stage a pane draws its home into. */
let stage: HTMLElement;

/** The `view.setWorkspace` calls, `styles.open` and `publish.open` the stub registry received. */
let switched: string[];

/** Every command the stub registry ran after a workspace switch, in order, with its argument. */
let followed: string[];

/** Whether the stub's `view.setRightTab` is enabled: it is gated on an open document. */
let documentOpen: boolean;

/** The Settings home in the stage, or null. */
function home(): HTMLElement | null {
  return stage.querySelector<HTMLElement>('[part="settings"]');
}

/** The section the focused row names, or `""` when the focus is not on a row. */
function focusedSection(): string {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.getAttribute("part") === "nav-item"
    ? (active.dataset["section"] ?? "")
    : "";
}

/** Open the Settings home tab and draw it into the stage, as the canvas render does. */
async function draw(paneId = "primary"): Promise<Tab> {
  const tab = openWorkspaceHome("settings");
  renderSettingsWorkspace({ paneId, wrap: stage }, tab);
  await flush(3);
  return tab;
}

/** A Moved row's button. */
function movedLink(workspace: string): HTMLElement {
  return home()!.querySelector<HTMLElement>(
    `[part="moved-row"][data-moved="${workspace}"] [part="moved-link"]`,
  )!;
}

beforeEach(() => {
  installMockPlatform();
  resetSettingsDocumentState();
  resetStudioState({ projectConfig: { name: "Field Notes" } });
  // A fresh project root: no workspace has been left yet this session.
  syncProjectWorkspace(null);
  syncProjectWorkspace("/field-notes");
  stage = document.createElement("div");
  document.body.append(stage);
  switched = [];
  followed = [];
  documentOpen = true;
  const record =
    (prefix: string, key: string) => (_ctx: CommandContext, args?: CommandArgValues) => {
      const value = args?.[key];
      switched.push(`${prefix}${isString(value) ? value : ""}`);
    };
  const registry = createCommandRegistry({ getContext: emptyContext });
  registry.registerAll([
    {
      args: {
        additionalProperties: false,
        properties: { workspace: { type: "string" } },
        required: ["workspace"],
        type: "object",
      },
      category: "View",
      id: "view.setWorkspace",
      level: "application",
      menus: ["never"],
      run: record("", "workspace"),
      title: "Switch Workspace",
    },
    {
      args: {
        additionalProperties: false,
        properties: { view: { type: "string" } },
        required: [],
        type: "object",
      },
      category: "Project",
      id: "styles.open",
      level: "project",
      menus: ["never"],
      run: record("styles:", "view"),
      title: "Open Project Styles",
    },
    {
      args: {
        additionalProperties: false,
        properties: { tab: { type: "string" } },
        required: [],
        type: "object",
      },
      category: "Publish",
      id: "publish.open",
      level: "project",
      menus: ["never"],
      run: record("publish:", "tab"),
      title: "Show Publish",
    },
    {
      args: {
        additionalProperties: false,
        properties: { open: { type: "boolean" } },
        required: ["open"],
        type: "object",
      },
      category: "View",
      id: "view.setRightPanel",
      level: "application",
      menus: ["palette"],
      run: (_ctx, args?: CommandArgValues) => {
        followed.push(`dock:${String(args?.open)}`);
      },
      title: "Show Inspector Dock",
    },
    {
      args: {
        additionalProperties: false,
        properties: { tab: { type: "string" } },
        required: ["tab"],
        type: "object",
      },
      category: "View",
      id: "view.setRightTab",
      level: "document",
      menus: ["palette"],
      requires: "an open document",
      run: (_ctx, args?: CommandArgValues) => {
        followed.push(`tab:${String(args?.tab)}`);
      },
      title: "Show Inspector Tab",
      when: () => documentOpen,
    },
  ]);
  setActiveRegistry(registry);
});

afterEach(async () => {
  detachSettingsWorkspace("primary");
  detachSettingsWorkspace("secondary");
  setActiveRegistry(null);
  closeAllTabs();
  stage.remove();
  await flush();
});

describe("the home", () => {
  test("is the settings editor in the pane's stage, named by the pane's region", async () => {
    const tab = await draw();
    expect(settingsRegion("primary")).toBe("pane.primary/settings");
    expect(home()?.dataset["jxRegion"]).toBe("pane.primary/settings");
    expect(home()?.querySelector('[part="heading"]')?.textContent).toBe("Project settings");
    expect(home()?.querySelectorAll('[part="nav-item"]').length).toBeGreaterThan(0);
    expect(settingsWorkspaceMounted("primary", tab)).toBe(true);
  });

  test("drawing it again for the same tab keeps the mount it has", async () => {
    const tab = await draw();
    const first = home();
    renderSettingsWorkspace({ paneId: "primary", wrap: stage }, tab);
    await flush(2);
    expect(home()).toBe(first);
    expect(mountsOf("settings-pane")).toHaveLength(1);
  });

  test("a stage something else took over is drawn into afresh", async () => {
    const tab = await draw();
    stage.replaceChildren();
    expect(settingsWorkspaceMounted("primary", tab)).toBe(false);
    renderSettingsWorkspace({ paneId: "primary", wrap: stage }, tab);
    await flush(3);
    expect(home()).not.toBeNull();
    expect(mountsOf("settings-pane")).toHaveLength(1);
  });

  test("detaching takes it down, and is idempotent", async () => {
    const tab = await draw();
    detachSettingsWorkspace("primary");
    expect(settingsWorkspaceMounted("primary", tab)).toBe(false);
    expect(mountsOf("settings-pane")).toHaveLength(0);
    expect(() => detachSettingsWorkspace("primary")).not.toThrow();
  });

  test("a second pane names its own region", async () => {
    await draw("secondary");
    expect(home()?.dataset["jxRegion"]).toBe("pane.secondary/settings");
  });
});

describe("the keyboard", () => {
  test("asked for before the home is drawn, it lands on the current section's row once it is", async () => {
    setSettingsSection("locales");
    await focusSettingsHome("primary");
    await draw();
    await flush(3);
    expect(focusedSection()).toBe("locales");
  });

  test("asked for while the home stands, it moves there at once", async () => {
    setSettingsSection("contexts");
    await draw();
    await focusSettingsHome("primary");
    expect(focusedSection()).toBe("contexts");
  });

  test("a home taken down before it drew does not take the keyboard", async () => {
    await focusSettingsHome("primary");
    const tab = openWorkspaceHome("settings");
    renderSettingsWorkspace({ paneId: "primary", wrap: stage }, tab);
    detachSettingsWorkspace("primary");
    await flush(3);
    expect(focusedSection()).toBe("");
  });
});

describe("Back", () => {
  test("names and returns to the workspace Settings was entered from", async () => {
    enterWorkspace("styles");
    enterWorkspace("settings");
    expect(returnWorkspace()).toBe("styles");
    await draw();
    const back = home()!.querySelector<HTMLElement>('[part="back"]')!;
    expect(back.textContent.trim()).toBe("Back to Styles");
    pointer(back, "click");
    await flush(2);
    expect(switched).toEqual(["styles"]);
  });

  test("with nothing entered before it this session, it goes to Design", async () => {
    expect(returnWorkspace()).toBe("design");
    enterWorkspace("settings");
    // The project woke up in Design, so Design is what was left.
    expect(returnWorkspace()).toBe("design");
    await leaveSettings();
    expect(switched).toEqual(["design"]);
  });

  test("a refused switch is filed rather than thrown", async () => {
    setActiveRegistry(null);
    await leaveSettings();
    expect(switched).toEqual([]);
  });
});

describe("the Moved footnote", () => {
  test("the Colors and fonts row opens the Styles workspace's Variables view", async () => {
    await draw();
    const link = movedLink("styles");
    expect(link.textContent).toContain("Styles › Variables");
    pointer(link, "click");
    await flush(2);
    // `styles.open { view }` is the workspace switch followed by the view, in one record.
    expect(switched).toEqual(["styles:variables"]);
    expect(followed).toEqual([]);
  });

  test("the Page tab row switches to Design, then shows the Inspector on its Page tab", async () => {
    await draw();
    pointer(movedLink("design"), "click");
    await flush(3);
    expect(switched).toEqual(["design"]);
    // AFTER the switch: entering a workspace applies its preset, which would undo an earlier ask.
    expect(followed).toEqual(["dock:true", "tab:page"]);
  });

  test("with no document open the Page tab row opens the dock and asks for no tab", async () => {
    documentOpen = false;
    await draw();
    pointer(movedLink("design"), "click");
    await flush(3);
    expect(switched).toEqual(["design"]);
    expect(followed).toEqual(["dock:true"]);
  });

  test("the Hosting row opens Publish on Hosting, in one record", async () => {
    await draw();
    const link = movedLink("publish");
    expect(link.textContent).toContain("Publish › Hosting");
    pointer(link, "click");
    await flush(3);
    expect(switched).toEqual(["publish:hosting"]);
    expect(followed).toEqual([]);
  });

  test("with no registry nothing throws", async () => {
    await draw();
    setActiveRegistry(null);
    pointer(movedLink("publish"), "click");
    await flush(2);
    expect(switched).toEqual([]);
  });
});
