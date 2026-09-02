/**
 * The Navigator rail — `src/surfaces/rail.ts` over `src/surfaces/rail.json`.
 *
 * A rendering of the panel registry: every rail-able record, grouped by level, each a stacked
 * `jx-action-button` with a visible label and a real `aria-pressed`, the foot a menu button for the
 * `settings/menu` placement. The surface is reactive, so the cases write `shell` and read the DOM.
 */
import { flush, mountOverlayLayers, resetWorkspaceWithTab } from "./harness";
import { nothing } from "lit-html";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const { listPanels, registerPanel } = await import("../src/panels/panel-registry");

const refreshGitStatus = mock(async () => {});
// The rail is a rendering of the panel registry, so a mocked git-panel still has to contribute its
// Record — otherwise the Source Control button (and its badge) simply is not there to assert on.
void mock.module("../src/panels/git-panel.js", () => ({
  refreshGitStatus,
  cleanupGitPanel: () => {},
  cloneRepository: () => {},
  renderGitPanel: () => nothing,
  registerGitPanel: () => {
    registerPanel({
      id: "git",
      title: "Source Control",
      level: "project",
      dock: "navigator",
      icon: "git-branch",
      badge: (ctx) => ctx.git.dirtyCount || null,
      render: () => nothing,
    });
  },
}));

const openSettingsModal = mock(() => {});
void mock.module("../src/settings/settings-modal.js", () => ({
  openSettingsModal,
}));

const openAboutModal = mock(() => {});
void mock.module("../src/about/about-modal.js", () => ({
  openAboutModal,
}));

const store = await import("../src/store");
const { initShellRefs } = store;
const bar = () => store.activityBar;

type RailButton = HTMLElement & { selected: boolean; badge: string };

/** The rail's panel buttons, in rendered order. */
const railButtons = () => [...bar().querySelectorAll<RailButton>("jx-action-button[data-panel]")];
const railIds = () => railButtons().map((el) => el.dataset.panel);
const railButton = (id: string) =>
  bar().querySelector<RailButton>(`jx-action-button[data-panel="${id}"]`);
/** The native control inside a rail button — what carries the name and the pressed state. */
const controlOf = (el: Element | null | undefined) =>
  el?.querySelector<HTMLButtonElement>('[part="control"]') ?? null;
/** A foot button, addressed by its visible label. */
const footerButton = (label: string) =>
  [...bar().querySelectorAll<HTMLElement>('[part="foot"] jx-action-button')].find(
    (el) => el.querySelector('[part="label"]')?.textContent?.trim() === label,
  );
const labelsOf = () =>
  [...bar().querySelectorAll('jx-action-button [part="label"]')].map((el) =>
    el.textContent?.trim(),
  );
const badgeOf = (id: string) => railButton(id)?.querySelector('[part="badge"]') ?? null;

const { mountShell, resetProjectShell, shell, unmountShell } = await import("../src/shell");
const { closeAllTabs } = await import("../src/workspace/workspace");
const { activeRegistry, setActiveRegistry } = await import("../src/commands/active-registry");
const { initLayers } = await import("../src/ui/layers");
const { dismissSettingsMenu, isSettingsMenuOpen } = await import("../src/panels/settings-menu");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { ICON_NAMES } = await import("@jxsuite/ui/icons");

/**
 * The rail foot renders FROM the `settings/menu` PLACEMENT, so a rail whose registry declares
 * nothing for it has no foot. Only these records: this file is about the rail.
 */
function installPreferencesRegistry() {
  const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
  registry.register({
    id: "app.preferences",
    title: "Preferences…",
    category: "View",
    level: "application",
    keybinding: "mod+,",
    menus: ["commandbar/overflow", "settings/menu", "palette"],
    group: "7_settings",
    run: () => {},
  });
  setActiveRegistry(registry);
  return registry;
}
const { registerNavigatorPanels } = await import("../src/panels/navigator-panels");
const { mount, renderActivityBar, unmount } = await import("../src/surfaces/rail");

/** Recompute the projection and let the surface follow: mount, reconcile, connect. */
async function render(): Promise<void> {
  renderActivityBar();
  await flush();
  await flush();
}

beforeAll(() => {
  const app = document.createElement("div");
  app.id = "app";
  const barEl = document.createElement("div");
  barEl.id = "activity-bar";
  app.append(barEl);
  document.body.append(app);
  /* A SIBLING host, never `document.body`: `mountOverlayLayers` clears the host it is handed, and
     handing it the body would take `#app` — and the rail — with it. The gear's menu renders into
     `#layer-popover`, so the layers have to exist before any case clicks it. */
  const overlays = document.createElement("div");
  document.body.append(overlays);
  mountOverlayLayers(overlays);
  initLayers();
  initShellRefs();
  registerNavigatorPanels();
});

beforeEach(() => {
  setActiveRegistry(null);
  closeAllTabs();
  shell.leftTab = "layers";
  shell.docks.left.collapsed = false;
  shell.bottomTab = "problems";
  shell.docks.bottom.collapsed = true;
  resetProjectShell();
  refreshGitStatus.mockClear();
  openSettingsModal.mockClear();
  openAboutModal.mockClear();
  document.querySelector("#app")?.classList.remove("left-collapsed", "right-collapsed");
});

afterEach(async () => {
  dismissSettingsMenu();
  unmount();
  await flush();
});

// ─── The records' icons ───────────────────────────────────────────────────────

describe("panel icons", () => {
  /*
   * DERIVED FROM THE REGISTRY, not from a list. Three rail buttons once shipped pointing at keys
   * nothing handled, drawing a 20px hole apiece, while a list-based test stayed green. Every
   * record's `icon` — `rail: false` ones included, because the day a panel gains its button is not
   * the day to discover its icon was never in the manifest — resolves in the kit's manifest.
   */
  test("every registered panel's icon is a glyph the kit ships", () => {
    const panels = listPanels();
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect({ icon: panel.icon, id: panel.id, shipped: ICON_NAMES.includes(panel.icon) }).toEqual({
        icon: panel.icon,
        id: panel.id,
        shipped: true,
      });
    }
  });
});

// ─── renderActivityBar ────────────────────────────────────────────────────────

describe("renderActivityBar", () => {
  test("renders every rail-able panel, grouped by level", async () => {
    await render();
    expect(railIds()).toEqual(["files", "git", "layers", "page", "data", "packages"]);
    // The Bottom dock's FOUR rail-less tabs stay off it.
    for (const id of ["problems", "diff", "logic", "activity"]) {
      expect(railIds()).not.toContain(id);
    }
    expect(railIds()).not.toContain("insert");
    expect(railIds()).not.toContain("state");
    // Search is still declared-but-unbuilt, hidden by its own `when`.
    expect(railIds()).not.toContain("search");
  });

  test("every rail button draws a glyph above its label", async () => {
    installPreferencesRegistry();
    await render();
    const empty = railButtons()
      .filter((item) => item.querySelector('[part="icon"] jx-icon path')?.getAttribute("d") === "")
      .map((item) => item.dataset.panel);
    expect(empty).toEqual([]);
  });

  test("the two groups are named and separated by exactly one divider", async () => {
    await render();
    const groups = [...bar().querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Project", "Document"]);
    expect(bar().querySelectorAll("hr")).toHaveLength(1);
  });

  test("every rail button carries a visible text label, which is also its accessible name", async () => {
    installPreferencesRegistry();
    await render();
    expect(labelsOf()).toEqual([
      "Files",
      "Source Control",
      "Outline",
      "Page",
      "Data",
      "Packages",
      "Settings",
    ]);
    expect(controlOf(railButton("git"))?.getAttribute("aria-label")).toBe("Source Control");
    // The label ellipses at 56px, so the full string survives as a tooltip too.
    expect(controlOf(railButton("git"))?.getAttribute("title")).toBe("Source Control");
  });

  test("marks the current left tab pressed when the dock is open", async () => {
    shell.leftTab = "files";
    await render();
    expect(controlOf(railButton("files"))?.getAttribute("aria-pressed")).toBe("true");
    expect(controlOf(railButton("layers"))?.getAttribute("aria-pressed")).toBe("false");
    expect(railButton("files")?.dataset.selected !== undefined).toBe(true);
  });

  test("marks nothing pressed when the Navigator dock is collapsed", async () => {
    shell.leftTab = "files";
    shell.docks.left.collapsed = true;
    await render();
    expect(
      railButtons().filter((el) => controlOf(el)?.getAttribute("aria-pressed") === "true"),
    ).toEqual([]);
  });

  test("shows git badge with changed file count", async () => {
    shell.git.status = { files: [{}, {}, {}] } as never;
    await render();
    expect(badgeOf("git")?.textContent).toBe("3");
  });

  test("omits git badge when there are no changed files", async () => {
    shell.git.status = { files: [] } as never;
    await render();
    expect(badgeOf("git")).toBeNull();
  });

  test("the badge survives closing the last tab", async () => {
    resetWorkspaceWithTab();
    shell.git.status = { files: [{}, {}] } as never;
    await render();
    expect(badgeOf("git")?.textContent).toBe("2");
    closeAllTabs();
    await render();
    expect(badgeOf("git")?.textContent).toBe("2");
  });

  test("clicking a different panel opens it", async () => {
    mountShell();
    shell.leftTab = "layers";
    await render();
    controlOf(railButton("files"))!.click();
    await flush();
    expect(shell.leftTab).toBe("files");
    expect(shell.docks.left.collapsed).toBe(false);
    expect(document.querySelector("#app")?.classList.contains("left-collapsed")).toBe(false);
    unmountShell();
  });

  test("clicking the already-open panel collapses the dock", async () => {
    mountShell();
    shell.leftTab = "files";
    shell.docks.left.collapsed = false;
    await render();
    controlOf(railButton("files"))!.click();
    await flush();
    expect(shell.docks.left.collapsed).toBe(true);
    expect(document.querySelector("#app")?.classList.contains("left-collapsed")).toBe(true);
    unmountShell();
  });

  test("clicking the current panel while collapsed re-opens it", async () => {
    shell.leftTab = "files";
    shell.docks.left.collapsed = true;
    await render();
    controlOf(railButton("files"))!.click();
    await flush();
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.leftTab).toBe("files");
  });

  test("the pressed state follows the shell, not the click", async () => {
    // A toggling action button flips itself on activation, but the rail's buttons are HELD by the
    // Shell: the mounted rail's effect recomputes the projection from `shell` and the property wins,
    // So the button that WAS pressed lets go without ever having been clicked.
    mountShell();
    shell.git.status = { files: [] } as never;
    shell.leftTab = "layers";
    mount();
    await flush();
    await flush();
    expect(controlOf(railButton("layers"))?.getAttribute("aria-pressed")).toBe("true");
    controlOf(railButton("files"))!.click();
    await flush();
    await flush();
    expect(controlOf(railButton("files"))?.getAttribute("aria-pressed")).toBe("true");
    expect(controlOf(railButton("layers"))?.getAttribute("aria-pressed")).toBe("false");
    unmountShell();
  });

  test("Problems has no rail button, and the rail no longer reaches a second dock", async () => {
    shell.docks.bottom.collapsed = true;
    shell.bottomTab = "activity";
    await render();
    expect(railButton("problems")).toBeNull();
    expect(railIds()).not.toContain("problems");
    for (const id of railIds()) {
      if (id) {
        controlOf(railButton(id))!.click();
      }
    }
    await flush();
    expect(shell.docks.bottom.collapsed).toBe(true);
    expect(shell.bottomTab).toBe("activity");
  });

  test("its record is still registered, and still counts — it is the BUTTON that is gone", async () => {
    const { notify, resetNotifications } = await import("../src/services/notify");
    resetNotifications();
    const problems = listPanels().find((panel) => panel.id === "problems");
    expect(problems).toBeDefined();
    expect(problems!.dock).toBe("bottom");
    expect(problems!.rail).toBe(false);
    expect(problems!.badge?.(emptyContext())).toBeNull();
    notify.error("could not save");
    expect(problems!.badge?.(emptyContext())).toBe(1);
    resetNotifications();
  });

  test("the foot is a menu trigger, not a command button", async () => {
    installPreferencesRegistry();
    await render();
    const gear = footerButton("Settings")!;
    expect(gear).toBeDefined();
    const control = controlOf(gear)!;
    expect(control.getAttribute("aria-haspopup")).toBe("menu");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(gear.dataset.command).toBeUndefined();

    const ran: string[] = [];
    const registry = activeRegistry()!;
    const original = registry.run.bind(registry);
    registry.run = ((id: string) => {
      ran.push(id);
      return Promise.resolve();
    }) as typeof registry.run;
    control.click();
    registry.run = original;
    await flush();

    expect(ran).toEqual([]);
    expect(controlOf(footerButton("Settings"))?.getAttribute("aria-expanded")).toBe("true");
    expect(footerButton("Settings")?.dataset.expanded !== undefined).toBe(true);
    expect(
      document.querySelector('#layer-popover jx-menu-item[data-command-id="app.preferences"]'),
    ).not.toBeNull();
  });

  test("the gear's first row is Preferences, and it runs the record", async () => {
    installPreferencesRegistry();
    await render();
    controlOf(footerButton("Settings"))!.click();
    await flush();

    const ran: string[] = [];
    const registry = activeRegistry()!;
    const original = registry.run.bind(registry);
    registry.run = ((id: string) => {
      ran.push(id);
      return Promise.resolve();
    }) as typeof registry.run;
    const row = document.querySelector<HTMLElement>(
      '#layer-popover jx-menu-item[data-command-id="app.preferences"]',
    )!;
    expect(row.textContent).toContain("Preferences…");
    expect(row.querySelector("kbd")?.textContent).toBe("⌘,");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    registry.run = original;
    await flush();

    expect(ran).toEqual(["app.preferences"]);
    expect(document.querySelector("#layer-popover jx-menu-item")).toBeNull();
    expect(controlOf(footerButton("Settings"))?.getAttribute("aria-expanded")).toBe("false");
  });

  test("About still holds no rail slot, and Preferences is no longer one", async () => {
    installPreferencesRegistry();
    await render();
    expect(footerButton("About")).toBeUndefined();
    expect(footerButton("Preferences")).toBeUndefined();
  });

  test("either arrow opens the menu from the gear, and other keys fall through", async () => {
    installPreferencesRegistry();
    await render();
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
      controlOf(footerButton("Settings"))!.dispatchEvent(event);
      return event;
    };
    expect(press("a").defaultPrevented).toBe(false);
    expect(isSettingsMenuOpen()).toBe(false);
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(isSettingsMenuOpen()).toBe(true);
    dismissSettingsMenu();
    expect(press("ArrowUp").defaultPrevented).toBe(true);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("a registry that declares nothing for the gear renders no foot", async () => {
    const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
    registry.register({
      id: "app.preferences",
      title: "Preferences…",
      category: "View",
      level: "application",
      menus: ["palette"],
      run: () => {},
    });
    setActiveRegistry(registry);
    await render();
    expect(bar().querySelector('[part="foot"] jx-action-button')).toBeNull();
  });
});

// ─── mount / unmount ──────────────────────────────────────────────────────────

describe("mount", () => {
  test("renders immediately and requests git status once", async () => {
    resetWorkspaceWithTab();
    expect(shell.git.status).toBeNull();
    mount();
    await flush();
    await flush();
    expect(refreshGitStatus).toHaveBeenCalled();
    expect(bar().querySelector('[part="groups"]')).not.toBeNull();
  });

  test("does not refresh git status while loading or already loaded", async () => {
    shell.git.loading = true;
    mount();
    await flush();
    expect(refreshGitStatus).not.toHaveBeenCalled();
    shell.git.status = { files: [] } as never;
    shell.git.loading = false;
    await flush();
    expect(refreshGitStatus).not.toHaveBeenCalled();
  });

  test("re-renders the badge when git status changes", async () => {
    shell.git.status = { files: [] } as never;
    mount();
    await flush();
    await flush();
    expect(badgeOf("git")).toBeNull();
    shell.git.status = { files: [{}] } as never;
    await flush();
    await flush();
    expect(badgeOf("git")?.textContent).toBe("1");
  });

  test("probes for status with no tab open — the panel level is project, not document", async () => {
    closeAllTabs();
    mount();
    await flush();
    await flush();
    expect(refreshGitStatus).toHaveBeenCalled();
    expect(bar().querySelector('[part="groups"]')).not.toBeNull();
  });

  test("unmount stops reactive updates and empties the host", async () => {
    shell.git.status = { files: [] } as never;
    mount();
    await flush();
    await flush();
    unmount();
    await flush();
    expect(bar().querySelector("jx-action-button")).toBeNull();
    shell.git.status = { files: [{}, {}] } as never;
    await flush();
    expect(badgeOf("git")).toBeNull();
  });
});
