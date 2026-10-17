/**
 * The Navigator rail — `src/surfaces/rail.ts` over `src/surfaces/rail.json`.
 *
 * A rendering of the panel registry: every rail-able record, grouped by level, each a stacked
 * `jx-action-button` with a visible label and a real `aria-pressed`. The rail has no foot: the gear
 * is the top bar's (`tests/commandbar-workspaces.test.ts`). The surface is reactive, so the cases
 * write `shell` and read the DOM.
 */
import { flush, mountOverlayLayers, resetWorkspaceWithTab } from "./harness";
import { hintOf } from "./kit-readers";
import { nothing } from "lit-html";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitStatusResult } from "../src/types";

const { listPanels, registerPanel, unregisterPanel } = await import("../src/panels/panel-registry");

const refreshGitStatus = mock(async () => {});
// The rail is a rendering of the panel registry, so a mocked git-panel still contributes its
// Record, as the real one does: off the rail (§5.1), because Source Control belongs to Publish.
void mock.module("../src/panels/git-panel.js", () => ({
  refreshGitStatus,
  cleanupGitPanel: () => {},
  cloneRepository: () => {},
  registerGitPanel: () => {
    registerPanel({
      id: "git",
      title: "Source Control",
      level: "project",
      dock: "navigator",
      icon: "git-branch",
      rail: false,
      render: () => nothing,
    });
  },
}));

/**
 * A project-level panel that badges the changed-file count, registered for one case. No shipped
 * panel badges any more (the count is the Publish workspace tab's, §22.2), so the rail's badge
 * machinery is asserted against a fixture rather than against a record that no longer has one.
 */
async function withBadgedPanel(run: () => Promise<void>): Promise<void> {
  registerPanel({
    id: "badged",
    title: "Badged",
    level: "project",
    dock: "navigator",
    icon: "git-branch",
    badge: (ctx) => ctx.git.dirtyCount || null,
    render: () => nothing,
  });
  try {
    await run();
  } finally {
    unregisterPanel("badged");
  }
}

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
const bar = () => store.requireShellRef(store.activityBar, "activity-bar");

type RailButton = HTMLElement & { selected: boolean; badge: string };

/** The rail's panel buttons, in rendered order. */
const railButtons = () => [...bar().querySelectorAll<RailButton>("jx-action-button[data-panel]")];
const railIds = () => railButtons().map((el) => el.dataset.panel);
const railButton = (id: string) =>
  bar().querySelector<RailButton>(`jx-action-button[data-panel="${id}"]`);
/** The native control inside a rail button — what carries the name and the pressed state. */
const controlOf = (el: Element | null | undefined) =>
  el?.querySelector<HTMLButtonElement>('[part="control"]') ?? null;
const labelsOf = () =>
  [...bar().querySelectorAll('jx-action-button [part="label"]')].map((el) => el.textContent.trim());
const badgeOf = (id: string) => railButton(id)?.querySelector('[part="badge"]') ?? null;

/** A clean `main` status with `changed` dirty files: the file count is all the badge reads. */
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

const { mountShell, resetProjectShell, shell, unmountShell } = await import("../src/shell");
const { closeAllTabs } = await import("../src/workspace/workspace");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { initLayers } = await import("../src/ui/layers");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { ICON_NAMES } = await import("@jxsuite/ui/icons");

/**
 * A registry declaring a `settings/menu` record — which the rail must NOT draw: the gear lives in
 * the top bar. Only these records: this file is about the rail.
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
const { setDeveloperPanelsShown } = await import("../src/settings/developer-panels");
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
  test("renders the Design rail: Site above the divider, Outline and Data below it (§5.1)", async () => {
    await render();
    const ids = railIds();
    expect(ids).toEqual(["site", "layers", "data"]);
    // Off the rail by default: the developer panels, Source Control and Languages.
    for (const id of ["files", "packages", "git", "i18n"]) {
      expect(ids).not.toContain(id);
    }
    // The Bottom dock's FOUR rail-less tabs stay off it.
    for (const id of ["problems", "diff", "logic", "activity"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).not.toContain("insert");
    expect(ids).not.toContain("state");
    // Search is still declared-but-unbuilt, hidden by its own `when`.
    expect(ids).not.toContain("search");
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
    /* The divider is `jx-divider` rather than an `<hr role="separator">` this document writes. The
       rail hand-rolled the one pattern the kit already ships — a hairline that announces itself —
       and the ONLY thing it actually owned was where the line sits, which is what its style rule
       still says. Counting the element rather than the `<hr>` is what makes this an assertion about
       the collapse: the inner rule is the element's, so an `<hr>` count would go on passing if the
       surface went back to writing its own. */
    await render();
    const groups = [...bar().querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Project", "Document"]);
    const dividers = [...bar().querySelectorAll("jx-divider")];
    expect(dividers).toHaveLength(1);
    expect(bar().querySelectorAll("hr")).toHaveLength(1);
    // And the announcement comes from the ELEMENT, which is the whole reason the surface can drop it.
    expect(dividers[0]!.querySelector("hr")?.getAttribute("role")).toBe("separator");
    // Nothing in the rail writes a separator role of its own any more.
    expect(bar().querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  test("Show developer panels puts Files and Packages back on the rail, live", async () => {
    mount();
    await flush();
    await flush();
    expect(railIds()).toEqual(["site", "layers", "data"]);
    setDeveloperPanelsShown(true);
    try {
      await flush();
      await flush();
      expect(railIds()).toEqual(["site", "files", "layers", "data", "packages"]);
    } finally {
      setDeveloperPanelsShown(false);
    }
    await flush();
    await flush();
    expect(railIds()).toEqual(["site", "layers", "data"]);
  });

  test("every rail button carries a visible label; a railLabel shortens it, and the title stays the name and tooltip", async () => {
    installPreferencesRegistry();
    /* "Source Control" was 71px against a 48px label box, so the kit ellipsed it to "Source …"; a
       record that is too long declares the short label instead, and the full title is still what a
       screen reader announces (the visible word leads it, WCAG 2.5.3) and what the tooltip
       restores: the tip an Enabled kit button renders for its hint, never a `title` attribute
       (ui.md §5.1). No shipped rail panel needs one now, so a fixture asserts the rule. */
    registerPanel({
      id: "long",
      title: "Long Panel Title",
      railLabel: "Long",
      level: "document",
      dock: "navigator",
      icon: "stack",
      render: () => nothing,
    });
    try {
      await render();
      expect(labelsOf()).toEqual(["Site", "Outline", "Data", "Long"]);
      const long = railButton("long");
      expect(long?.querySelector('[part="label"]')?.textContent.trim()).toBe("Long");
      expect(controlOf(long)?.getAttribute("aria-label")).toBe("Long Panel Title");
      expect(hintOf(long)).toBe("Long Panel Title");
      expect(controlOf(long)?.hasAttribute("title")).toBe(false);
      // A record with no railLabel prints its title, which is also its name.
      const site = railButton("site");
      expect(site?.querySelector('[part="label"]')?.textContent.trim()).toBe("Site");
      expect(controlOf(site)?.getAttribute("aria-label")).toBe("Site");
    } finally {
      unregisterPanel("long");
    }
  });

  test("marks the current left tab pressed when the dock is open", async () => {
    shell.leftTab = "site";
    await render();
    expect(controlOf(railButton("site"))?.getAttribute("aria-pressed")).toBe("true");
    expect(controlOf(railButton("layers"))?.getAttribute("aria-pressed")).toBe("false");
    expect(railButton("site")?.dataset.selected !== undefined).toBe(true);
  });

  test("marks nothing pressed when the Navigator dock is collapsed", async () => {
    shell.leftTab = "site";
    shell.docks.left.collapsed = true;
    await render();
    expect(
      railButtons().filter((el) => controlOf(el)?.getAttribute("aria-pressed") === "true"),
    ).toEqual([]);
  });

  test("a panel's badge shows its count", async () => {
    await withBadgedPanel(async () => {
      shell.git.status = gitStatusWith(3);
      await render();
      expect(badgeOf("badged")?.textContent).toBe("3");
    });
  });

  test("a badge of zero draws nothing", async () => {
    await withBadgedPanel(async () => {
      shell.git.status = gitStatusWith(0);
      await render();
      expect(badgeOf("badged")).toBeNull();
    });
  });

  test("a project-level badge survives closing the last tab", async () => {
    await withBadgedPanel(async () => {
      resetWorkspaceWithTab();
      shell.git.status = gitStatusWith(2);
      await render();
      expect(badgeOf("badged")?.textContent).toBe("2");
      closeAllTabs();
      await render();
      expect(badgeOf("badged")?.textContent).toBe("2");
    });
  });

  test("clicking a different panel opens it", async () => {
    mountShell();
    shell.leftTab = "layers";
    await render();
    controlOf(railButton("site"))!.click();
    await flush();
    expect(shell.leftTab).toBe("site");
    expect(shell.docks.left.collapsed).toBe(false);
    expect(document.querySelector("#app")?.classList.contains("left-collapsed")).toBe(false);
    unmountShell();
  });

  test("clicking the already-open panel collapses the dock", async () => {
    mountShell();
    shell.leftTab = "site";
    shell.docks.left.collapsed = false;
    await render();
    controlOf(railButton("site"))!.click();
    await flush();
    expect(shell.docks.left.collapsed).toBe(true);
    expect(document.querySelector("#app")?.classList.contains("left-collapsed")).toBe(true);
    unmountShell();
  });

  test("clicking the current panel while collapsed re-opens it", async () => {
    shell.leftTab = "site";
    shell.docks.left.collapsed = true;
    await render();
    controlOf(railButton("site"))!.click();
    await flush();
    expect(shell.docks.left.collapsed).toBe(false);
    expect(shell.leftTab).toBe("site");
  });

  test("the pressed state follows the shell, not the click", async () => {
    // A toggling action button flips itself on activation, but the rail's buttons are HELD by the
    // Shell: the mounted rail's effect recomputes the projection from `shell` and the property wins,
    // So the button that WAS pressed lets go without ever having been clicked.
    mountShell();
    shell.git.status = gitStatusWith(0);
    shell.leftTab = "layers";
    mount();
    await flush();
    await flush();
    expect(controlOf(railButton("layers"))?.getAttribute("aria-pressed")).toBe("true");
    controlOf(railButton("site"))!.click();
    await flush();
    await flush();
    expect(controlOf(railButton("site"))?.getAttribute("aria-pressed")).toBe("true");
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

  test("the rail has no foot: no gear and no Library button, whatever the registry declares", async () => {
    /* The rail is drawn only in the Design workspace, so the settings every workspace needs moved
       to the top bar, and the Library button left with the Library, which the Content workspace
       replaces. A registry that declares a `settings/menu` record still draws no gear here. */
    installPreferencesRegistry();
    await render();
    expect(bar().querySelector('[part="foot"]')).toBeNull();
    expect(bar().querySelector("[data-rail-menu]")).toBeNull();
    expect(bar().querySelector("[data-rail-action]")).toBeNull();
    expect(railIds()).not.toContain("settings");
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
    shell.git.status = gitStatusWith(0);
    shell.git.loading = false;
    await flush();
    expect(refreshGitStatus).not.toHaveBeenCalled();
    // Declining to fetch is not declining to draw: the rail is up.
    expect(bar().querySelector('[part="groups"]')).not.toBeNull();
  });

  test("re-renders a badge when git status changes", async () => {
    await withBadgedPanel(async () => {
      shell.git.status = gitStatusWith(0);
      mount();
      await flush();
      await flush();
      expect(badgeOf("badged")).toBeNull();
      shell.git.status = gitStatusWith(1);
      await flush();
      await flush();
      expect(badgeOf("badged")?.textContent).toBe("1");
    });
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
    shell.git.status = gitStatusWith(0);
    mount();
    await flush();
    await flush();
    unmount();
    await flush();
    expect(bar().querySelector("jx-action-button")).toBeNull();
    shell.git.status = gitStatusWith(2);
    await flush();
    expect(badgeOf("git")).toBeNull();
  });
});
