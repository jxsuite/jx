/**
 * The Command Bar's workspace tabs and its ⚙ gear.
 *
 * A separate file from `commandbar.test.ts` because the tabs need the shell's own `view.*` records
 * (that suite's registry is built from `defaults.ts` alone), and the gear needs the overlay layers
 * its menu renders into.
 *
 * What the cases defend: the tabs are a RENDERING of the five declared workspaces with
 * `shell.workspace` selected (not a hand-kept list), choosing one goes through `view.setWorkspace`,
 * the Publish tab counts the working tree's changes and draws nothing at zero, and the settings
 * menu the rail used to hold is here, just before the dock toggles.
 */
import { flush, installMockPlatform, mountOverlayLayers } from "./harness";
import { hintOf } from "./kit-readers";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitStatusResult } from "../src/types";
import type { WorkspaceId } from "../src/workspace/workspace-ids";

const toolbar = await import("../src/surfaces/commandbar");
const { registerShellViewCommands, resetProjectShell, shell, syncProjectWorkspace } =
  await import("../src/shell");
const { setWorkspaceProject } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { initLayers } = await import("../src/ui/layers");
const { dismissSettingsMenu, isSettingsMenuOpen } = await import("../src/panels/settings-menu");

let projectOpen = true;
const shown: WorkspaceId[] = [];
const ranPreferences = mock(() => {});

function installRegistry(withGear = true) {
  const registry = createCommandRegistry({
    getContext: () => makeContext({ document: { open: true }, project: { open: projectOpen } }),
    mac: true,
  });
  registerShellViewCommands(registry, {
    inspectorTab: () => "properties",
    setInspectorTab: () => {},
    showWorkspace: (id) => {
      shown.push(id);
      shell.workspace = id;
    },
  });
  if (withGear) {
    registry.register({
      category: "View",
      group: "7_settings",
      id: "app.preferences",
      level: "application",
      menus: ["settings/menu", "palette"],
      run: ranPreferences,
      title: "Preferences…",
    });
  }
  setActiveRegistry(registry);
  return registry;
}

function gitStatusWith(changed: number): GitStatusResult {
  return {
    ahead: 0,
    behind: 0,
    branch: "main",
    files: Array.from({ length: changed }, (_, index) => ({ path: `f${index}.json`, status: "M" })),
    isRepo: true,
    remotes: [],
  };
}

type TabEl = HTMLElement & { selected: boolean };

const strip = () => root.querySelector<HTMLElement>('[part="workspaces"]');
const tabs = () => [...root.querySelectorAll<TabEl>('jx-tab[part="workspace"]')];
const tabFor = (id: string) => root.querySelector<TabEl>(`jx-tab[data-workspace="${id}"]`);
const badge = () => tabFor("publish")?.querySelector('[part="workspace-badge"]') ?? null;
const gear = () => root.querySelector<HTMLElement>('jx-action-button[data-menu="settings"]');

let root: HTMLElement;

async function mounted(): Promise<void> {
  toolbar.mount(root);
  await flush();
  await flush();
  await flush();
}

beforeAll(() => {
  const overlays = document.createElement("div");
  document.body.append(overlays);
  mountOverlayLayers(overlays);
  initLayers();
});

beforeEach(() => {
  localStorage.clear();
  projectOpen = true;
  shown.length = 0;
  ranPreferences.mockClear();
  setWorkspaceProject(null);
  resetProjectShell();
  syncProjectWorkspace(null);
  shell.workspace = "design";
  shell.git.status = null;
  installMockPlatform();
  installRegistry();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  dismissSettingsMenu();
  toolbar.unmount();
  root.remove();
  setActiveRegistry(null);
  globalThis.__jxPlatform = undefined;
});

describe("the workspace tabs", () => {
  test("are a kit tablist of the five workspaces, each with its glyph and its title", async () => {
    await mounted();
    expect(strip()?.localName).toBe("jx-tabs");
    expect(strip()?.getAttribute("role")).toBe("tablist");
    expect(tabs().map((el) => el.getAttribute("label"))).toEqual([
      "Design",
      "Content",
      "Media",
      "Styles",
      "Publish",
    ]);
    for (const el of tabs()) {
      expect(el.getAttribute("role")).toBe("tab");
      expect(el.querySelector("jx-icon")).not.toBeNull();
    }
  });

  test("the selected tab is shell.workspace, and follows it from anywhere", async () => {
    await mounted();
    expect(strip()?.getAttribute("selected")).toBe("design");
    expect(tabFor("design")?.getAttribute("aria-selected")).toBe("true");
    expect(tabFor("media")?.getAttribute("aria-selected")).toBe("false");
    shell.workspace = "styles";
    await flush();
    await flush();
    expect(strip()?.getAttribute("selected")).toBe("styles");
    expect(tabFor("styles")?.getAttribute("aria-selected")).toBe("true");
  });

  test("choosing one runs view.setWorkspace with its id", async () => {
    await mounted();
    tabFor("media")!.click();
    await flush();
    expect(shown).toEqual(["media"]);
    tabFor("publish")!.click();
    await flush();
    expect(shown.at(-1)).toBe("publish");
    // The strip's own change is not a second door: one click is one run.
    expect(shown).toHaveLength(2);
  });

  test("activating the selected tab runs it again, which is how a closed home comes back", async () => {
    await mounted();
    expect(strip()?.getAttribute("selected")).toBe("design");
    tabFor("design")!.click();
    await flush();
    expect(shown).toEqual(["design"]);
  });

  test("each tab's tooltip names its chord", async () => {
    await mounted();
    expect(tabFor("design")?.getAttribute("title")).toBe("Design (⌘1)");
    expect(tabFor("publish")?.getAttribute("title")).toBe("Publish (⌘5)");
  });

  test("the whole tablist is absent with no project open — a workspace is a project's", async () => {
    projectOpen = false;
    await mounted();
    expect(strip()).toBeNull();
  });

  test("and absent with a registry that has no shell records yet", async () => {
    setActiveRegistry(createCommandRegistry({ getContext: () => makeContext() }));
    await mounted();
    expect(strip()).toBeNull();
  });
});

describe("the Publish badge", () => {
  test("counts the working tree's changes, and says what it counts", async () => {
    shell.git.status = gitStatusWith(3);
    await mounted();
    expect(badge()?.textContent).toBe("3");
    expect(badge()?.getAttribute("aria-hidden")).toBe("true");
    expect(tabFor("publish")?.getAttribute("title")).toBe("Publish (⌘5), 3 unpublished changes");
    // The badge is decorative, so the count reaches a screen reader as the tab's description; the
    // Tab's NAME stays its title.
    expect(tabFor("publish")?.getAttribute("aria-description")).toBe("3 unpublished changes");
    expect(tabFor("publish")?.getAttribute("label")).toBe("Publish");
    expect(tabFor("design")?.hasAttribute("aria-description")).toBe(false);
    // No other tab carries one.
    expect(root.querySelectorAll('[part="workspace-badge"]')).toHaveLength(1);
  });

  test("is singular for one change, and drawn not at all for none", async () => {
    shell.git.status = gitStatusWith(1);
    await mounted();
    expect(tabFor("publish")?.getAttribute("title")).toBe("Publish (⌘5), 1 unpublished change");
    shell.git.status = gitStatusWith(0);
    await flush();
    await flush();
    expect(badge()).toBeNull();
    expect(tabFor("publish")?.getAttribute("title")).toBe("Publish (⌘5)");
    expect(tabFor("publish")?.hasAttribute("aria-description")).toBe(false);
  });
});

describe("the quick-publish chevron", () => {
  const chevron = () => root.querySelector<HTMLElement>('jx-action-button[part="quick-publish"]');
  let quickRuns = 0;
  let repoOpen = false;

  function withQuick() {
    const registry = installRegistry();
    registry.register({
      category: "Publish",
      enablement: () => repoOpen,
      id: "publish.quick",
      level: "project",
      menus: ["commandbar/overflow", "palette"],
      requires: "a project tracked by git",
      run: () => {
        quickRuns += 1;
      },
      title: "Quick Publish",
    });
    return registry;
  }

  beforeEach(() => {
    quickRuns = 0;
    repoOpen = false;
  });

  test("is not drawn while the registry has no publish.quick", async () => {
    await mounted();
    expect(chevron()).toBeNull();
  });

  test("sits after the tablist, its own control, named and announcing a dialog", async () => {
    withQuick();
    await mounted();
    const button = chevron()!;
    expect(button).not.toBeNull();
    // Beside the strip, never inside it: a tab that sometimes opened a dialog would mean two things.
    expect(strip()?.contains(button)).toBe(false);
    expect(button.previousElementSibling).toBe(strip());
    const control = button.querySelector('[part="control"]');
    expect(control?.getAttribute("aria-label")).toBe("Quick publish");
    expect(control?.getAttribute("aria-haspopup")).toBe("dialog");
  });

  test("is refused with its reason until the project is a repository, then runs the record", async () => {
    withQuick();
    await mounted();
    expect(hintOf(chevron())).toBe("Quick Publish — requires a project tracked by git");
    chevron()!.click();
    expect(quickRuns).toBe(0);
    repoOpen = true;
    shell.git.status = gitStatusWith(1);
    await flush(3);
    chevron()!.click();
    expect(quickRuns).toBe(1);
  });
});

describe("the gear", () => {
  test("sits in the top bar, just before the dock toggles", async () => {
    await mounted();
    const button = gear()!;
    expect(button).not.toBeNull();
    const parts = [...root.querySelector('[part="bar"]')!.children].map((el) =>
      el.getAttribute("part"),
    );
    expect(parts.indexOf("settings-slot")).toBe(parts.indexOf("docks") - 1);
  });

  test("is a menu trigger: it opens the settings/menu placement and runs nothing itself", async () => {
    await mounted();
    const control = gear()!.querySelector<HTMLButtonElement>('[part="control"]')!;
    expect(control.getAttribute("aria-haspopup")).toBe("menu");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    control.click();
    await flush();
    expect(isSettingsMenuOpen()).toBe(true);
    expect(ranPreferences).not.toHaveBeenCalled();
    expect(
      document.querySelector('#layer-popover jx-menu-item[data-command-id="app.preferences"]'),
    ).not.toBeNull();
    expect(control.getAttribute("aria-expanded")).toBe("true");
    control.click();
    await flush();
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("ArrowDown opens it from the keyboard; other keys fall through", async () => {
    await mounted();
    const control = gear()!.querySelector<HTMLButtonElement>('[part="control"]')!;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
      control.dispatchEvent(event);
      return event;
    };
    expect(press("a").defaultPrevented).toBe(false);
    expect(isSettingsMenuOpen()).toBe(false);
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("a registry that declares nothing for the gear draws no gear", async () => {
    installRegistry(false);
    await mounted();
    expect(gear()).toBeNull();
  });
});
