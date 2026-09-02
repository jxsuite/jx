/**
 * The Command Bar (region ①) — a rendering of the registry, and nothing else.
 *
 * The assertions are grouped by the claim each one defends:
 *
 * - **One definition site.** Every button's label, icon, tooltip, chord and disabled state is read
 *   off a record; there is no second template for the no-project case, so the tests that used to
 *   assert `minimalToolbarTemplate`'s hardcoded `disabled` attributes are gone with it.
 * - **The pill is the address.** `◈ project › document › selection`, each segment opening the palette
 *   pre-scoped — the one place Studio now states which project is open.
 * - **`openInBrowserTarget` is a pure function** and is tested as one, route by route.
 */
import { flush, installMockPlatform, mountOverlayLayers, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { Tab } from "../src/tabs/tab";
import type { SiteBuildResult, SitePreviewResult } from "../src/types";
import type { PaletteMode } from "../src/commands/defaults";

// ─── Module mocks (must precede the toolbar import) ───────────────────────────

const openQuickSearch = mock((_mode?: PaletteMode) => {});
void mock.module("../src/panels/quick-search.js", () => ({ openQuickSearch }));

const notified = mock((_message: string) => {});
void mock.module("../src/services/notify.js", () => notifyModule((call) => notified(call.message)));

const toolbar = await import("../src/surfaces/commandbar");
const { shell, resetProjectShell } = await import("../src/shell");
// The assistant's toggle reports a TAB selection, so the bar reads it where the Inspector keeps it.
const { setInspectorTab } = await import("../src/panels/right-panel");
const { setProjectState } = await import("../src/state");
const { setPreviewNavigateHandler } = await import("../src/canvas/preview-navigate");
const { closeAllTabs, openTab } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { defaultCommands, noopCommandDeps } = await import("../src/commands/defaults");
const { shellViewCommands } = await import("../src/shell");
const { makeContext } = await import("../src/commands/context");
const { collabState } = await import("../src/collab/collab-state");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { initLayers } = await import("../src/ui/layers");

type CommandRegistry = ReturnType<typeof createCommandRegistry>;
type CommandContext = ReturnType<typeof makeContext>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_MODES = ["edit", "design", "preview", "source", "stylebook"];

/** The context the registry's predicates read. Mutated per test, read on every evaluation. */
let ctx: CommandContext = makeContext();

/** Verbs the records reach, recorded so a click is observable. */
let ran: string[] = [];

/**
 * Publish a registry over the real default records.
 *
 * The point of using the REAL records rather than fixtures: the bar's job is to render whatever the
 * registry holds, so a test that invented its own commands would prove nothing about Save's icon or
 * ⌘B's tooltip.
 */
function installRegistry(): CommandRegistry {
  const registry = createCommandRegistry({ getContext: () => ctx, mac: true });
  registry.registerAll(
    defaultCommands({
      ...noopCommandDeps(),
      panelRoster: [{ id: "files", title: "Files" }],
      saveDocument: () => {
        ran.push("save");
      },
      undo: () => {
        ran.push("undo");
      },
      redo: () => {
        ran.push("redo");
      },
      openInBrowser: () => {
        ran.push("openInBrowser");
      },
      openProject: () => {
        ran.push("openProject");
      },
      toggleDock: (dock) => {
        ran.push(`toggleDock:${dock}`);
      },
      focusPanel: (id) => {
        ran.push(`focusPanel:${id}`);
      },
    }),
  );
  // The bar's third dock toggle is `shell.ts`'s record now — ⌘J flips `shell.docks.bottom`, which
  // Is a dock the shell owns, so the verb is declared beside the state rather than injected.
  registry.registerAll(
    shellViewCommands({ inspectorTab: () => "properties", setInspectorTab: () => {} }),
  );
  // A gated overflow record, so the ⬢ menu's hide-vs-disable behaviour has something to show: every
  // Default overflow command is ungated, which is a fact about the defaults, not about the menu.
  registry.register({
    id: "test.overflowGated",
    title: "Gated Overflow",
    category: "View",
    level: "application",
    menus: ["commandbar/overflow", "palette"],
    group: "9_test",
    when: (candidate) => candidate.project.open,
    enablement: (candidate) => candidate.document.open,
    requires: "an open document",
    run: () => {
      ran.push("gated");
    },
  });
  setActiveRegistry(registry);
  return registry;
}

function openTestTab(documentPath = "/project/index.json"): Tab {
  closeAllTabs();
  return openTab({
    capabilities: { modes: ALL_MODES },
    document: { children: [{ tagName: "p", textContent: "Hi" }], tagName: "div" },
    documentPath,
    id: "toolbar-tab",
  });
}

/** Find the first sp-action-button whose accessible name is exactly `label`. */
/** The native control inside a kit button — what carries the name, the tooltip and the state. */
function control(el: Element): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('[part="control"]')!;
}

/** A kit button of the band by its accessible name; the HOST element, whose control names it. */
function btn(label: string): HTMLElement {
  const match = [...root.querySelectorAll("jx-button, jx-action-button")].find(
    (b) => control(b)?.getAttribute("aria-label") === label,
  );
  if (!match) {
    throw new Error(`no button labelled ${label}`);
  }
  return match as HTMLElement;
}

function click(el: Element): void {
  pointer(el, "click");
}

function segments(): string[] {
  return [...root.querySelectorAll('[part="segment"]')].map((el) => el.textContent?.trim() ?? "");
}

/** Mount the band and let the document mount and paint. */
async function mountBar(): Promise<void> {
  toolbar.mount(root);
  await flush();
  await flush();
}

function stageProject() {
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "acme",
    projectConfig: null,
    projectRoot: "/acme",
    searchQuery: "",
    selectedPath: null,
  });
}

let root: HTMLElement;

beforeEach(() => {
  closeAllTabs();
  localStorage.clear();
  shell.docks.left.collapsed = false;
  shell.docks.right.collapsed = false;
  setInspectorTab("properties");
  resetProjectShell();
  ctx = makeContext();
  ran = [];
  openQuickSearch.mockClear();
  notified.mockClear();
  setProjectState(null);
  setPreviewNavigateHandler(null);
  installMockPlatform();
  installRegistry();
  mountOverlayLayers();
  initLayers();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  toolbar.unmount();
  root.remove();
  setActiveRegistry(null);
  setPreviewNavigateHandler(null);
  setProjectState(null);
  delete (globalThis as Record<string, unknown>).__jxPlatform;
});

// ─── The record IS the control ───────────────────────────────────────────────

describe("the primary cluster", () => {
  test("with no project open the same bar renders, gated by `when`", async () => {
    await mountBar();
    // No second template: Save simply is not projected, because `file.save` needs a document.
    expect(root.querySelector('[data-command-id="file.save"]')).toBeNull();
    expect(segments()).toEqual(["No project", "No document"]);
  });

  test("a live record renders its title, its glyph and its chord in the tooltip", async () => {
    ctx = makeContext({ document: { open: true, canUndo: true } });
    await mountBar();

    const save = btn("Save");
    expect(save.getAttribute("title")).toBe("Save (⌘S)");
    const icon = save.querySelector("jx-icon") as (HTMLElement & { name: string }) | null;
    expect(icon?.name).toBe("floppy-disk");
    expect(save.textContent).toContain("Save");
    click(control(save));
    expect(ran).toEqual(["save"]);
  });

  test("a disabled record states WHY in the tooltip instead of vanishing", async () => {
    ctx = makeContext({ document: { open: true, canUndo: false } });
    await mountBar();
    const undo = btn("Undo");
    expect(control(undo).disabled).toBe(true);
    expect(undo.getAttribute("title")).toBe("Undo — requires a change to undo");
  });

  test("commandTooltip is empty for an id no registry declares", () => {
    const registry = installRegistry();
    expect(toolbar.commandTooltip(registry, "nope.missing")).toBe("");
  });

  test("a record with no chord prints just its name", () => {
    const registry = installRegistry();
    expect(toolbar.commandTooltip(registry, "palette.openNodes")).toBe(
      "Go to Symbol in Document… — requires an open document",
    );
    ctx = makeContext({ document: { open: true } });
    expect(toolbar.commandTooltip(registry, "palette.openNodes")).toBe("Go to Symbol in Document…");
  });

  test("the primary cluster is exactly what declares commandbar/primary", async () => {
    ctx = makeContext({
      project: { open: true, isSite: true },
      document: { open: true, canUndo: true, canRedo: true },
    });
    await mountBar();
    const labels = [...root.querySelectorAll('[part="primary"] jx-button')].map((b) =>
      control(b).getAttribute("aria-label"),
    );
    // Sorted by `group` then title, which is the registry's ordering, not the document's.
    expect(labels).toEqual(["Save", "Redo", "Undo", "Open in Browser"]);
  });

  test("a gate flipped from outside the bar reaches the buttons in place", async () => {
    ctx = makeContext({ document: { open: true, canUndo: false } });
    await mountBar();
    const undo = btn("Undo");
    ctx = makeContext({ document: { open: true, canUndo: true } });
    toolbar.render();
    await flush();
    // The keyed row reconciles: the same element, now enabled.
    expect(btn("Undo") === undo).toBe(true);
    expect(control(undo).disabled).toBe(false);
    expect(undo.getAttribute("title")).toBe("Undo (⌘Z)");
  });
});

// ─── ①a The Command Center pill ──────────────────────────────────────────────

describe("the Command Center pill", () => {
  test("names the project, the document and the selection, and prints ⌘K", async () => {
    stageProject();
    const tab = openTestTab("/acme/pages/blog/index.md");
    tab.session.selection = [["children", 0]];
    await mountBar();

    // The selection segment is the Outline's own `nodeLabel`, so the two cannot disagree.
    expect(segments()).toEqual(["acme", "pages/blog/index.md", "p — Hi"]);
    expect(root.querySelector('[part="chord"]')?.textContent).toBe("⌘K");
    // Two separators for three segments: the first has none.
    expect(root.querySelectorAll('[part="sep"]')).toHaveLength(2);
  });

  test("each segment opens the palette pre-scoped, and the gap opens the mode picker", async () => {
    stageProject();
    const tab = openTestTab("/acme/pages/index.md");
    tab.session.selection = [["children", 0]];
    await mountBar();

    const [project, document_, selection] = [...root.querySelectorAll('[part="segment"]')];
    click(project!);
    click(document_!);
    click(selection!);
    await flush();
    expect(openQuickSearch.mock.calls.map(([mode]) => mode)).toEqual([
      "projects",
      "files",
      "nodes",
    ]);

    // The segment click stops there — the pill's own handler must not also fire.
    openQuickSearch.mockClear();
    click(root.querySelector('[part="center"]')!);
    await flush();
    expect(openQuickSearch.mock.calls.map(([mode]) => mode)).toEqual(["picker"]);
  });

  test("the selection segment is absent with nothing selected, and reads layout for chrome", async () => {
    openTestTab();
    await mountBar();
    expect(segments()).toHaveLength(2);

    shell.layoutSelection = { path: [], tagName: "header" } as never;
    await flush();
    expect(segments().at(-1)).toBe("layout");
    shell.layoutSelection = null;
  });

  test("the document label drops the project root, and says so when there is none", () => {
    expect(toolbar.documentSegmentLabel(null)).toBe("No document");
    stageProject();
    const tab = openTestTab("./pages/index.md");
    expect(toolbar.documentSegmentLabel(tab)).toBe("pages/index.md");
  });

  test("the selection label is empty with no tab and no selection", () => {
    expect(toolbar.selectionSegmentLabel(null)).toBe("");
    const tab = openTestTab();
    expect(toolbar.selectionSegmentLabel(tab)).toBe("");
  });

  test("one selected element is named by its node label, exactly as it always was", () => {
    const tab = openTestTab();
    tab.session.selection = [["children", 0]];
    expect(toolbar.selectionSegmentLabel(tab)).toBe("p — Hi");
  });

  test("a batch is not a place, so the address bar names its size (§6.5)", () => {
    const tab = openTestTab();
    tab.session.selection = [["children", 0], []];
    expect(toolbar.selectionSegmentLabel(tab)).toBe("2 elements");
  });
});

// ─── The ⬢ Studio menu ────────────────────────────────────────────────────────

type MenuEl = HTMLElement & { open: boolean };

const studioMenu = () =>
  document.querySelector<MenuEl>('#layer-popover jx-menu[aria-label="Studio menu"]');
const menuRows = () => [
  ...(studioMenu()?.querySelectorAll<HTMLElement>("jx-menu-item[data-command-id]") ?? []),
];
const rowFor = (id: string) => menuRows().find((el) => el.dataset["commandId"] === id);

async function openStudioMenu(): Promise<HTMLElement> {
  const button = root.querySelector<HTMLElement>('[data-menu="studio"]')!;
  click(control(button));
  await flush();
  await flush();
  return button;
}

describe("the ⬢ Studio menu", () => {
  test("is the `menu` surface over what declared commandbar/overflow, with chords, and runs the picked one", async () => {
    ctx = makeContext({ project: { open: true } });
    await mountBar();
    const button = await openStudioMenu();

    const menu = studioMenu()!;
    expect(menu.parentElement!.dataset["jxRegion"]).toBe("overlay.menu:studio");
    expect(control(button).getAttribute("aria-expanded")).toBe("true");
    const ids = menuRows().map((el) => el.dataset["commandId"]);
    expect(ids).toContain("project.open");
    expect(ids).toContain("view.toggleNavigator");
    expect(rowFor("view.zen")!.querySelector('[slot="value"]')?.textContent?.trim()).toBe("⌘.");

    pointer(rowFor("project.open")!, "click");
    await flush();
    expect(ran).toEqual(["openProject"]);
    // Running a row closes the menu, and the button says so.
    expect(studioMenu()).toBeNull();
    expect(control(button).getAttribute("aria-expanded")).toBe("false");
  });

  test("the button is a toggle: a second click closes the menu it opened", async () => {
    ctx = makeContext({ project: { open: true } });
    await mountBar();
    const button = await openStudioMenu();
    expect(studioMenu()).not.toBeNull();
    click(control(button));
    await flush();
    await flush();
    expect(studioMenu()).toBeNull();
  });

  test("a gated row is listed disabled, then vanishes in place when `when` turns false", async () => {
    ctx = makeContext({ project: { open: true } });
    await mountBar();
    await openStudioMenu();
    const gated = rowFor("test.overflowGated")!;
    // Visible but disabled, with the `requires` sentence in the tooltip — never a silent absence.
    expect(gated.getAttribute("aria-disabled")).toBe("true");
    expect(gated.getAttribute("title")).toBe("an open document");

    pointer(gated, "click");
    await flush();
    expect(ran).toEqual([]);
    expect(studioMenu()).not.toBeNull();

    // The menu stays up while its rows reconcile: the gated row leaves, the rest stay.
    ctx = makeContext();
    toolbar.render();
    await flush();
    await flush();
    expect(studioMenu()).not.toBeNull();
    expect(rowFor("test.overflowGated")).toBeUndefined();
    expect(rowFor("project.open")).toBeDefined();
  });
});

// ─── Dock toggles ─────────────────────────────────────────────────────────────

describe("dock toggles", () => {
  /*
   * `querySelector` PROVES NOTHING ABOUT AN ICON.
   *
   * Three earlier assertions read `sp-icon-rail-left-open` / `-close` and passed for as long as the
   * Navigator's toggle rendered nothing at all: an unregistered custom element is still an element,
   * so the tag was in the DOM and the query found it, upgraded or not. So these assert WHICH glyph
   * the bar names, and whether it is mirrored — a question the projection answers by name. Whether
   * that name is a shipped glyph is a static question: `scripts/check-icons.ts` asks it of every
   * `jx-icon` name in the surfaces, and `tests/icons.test.ts` pins it.
   */
  function glyph(el: Element): string {
    const icon = el.querySelector("jx-icon") as
      | (HTMLElement & { name: string; mirror: boolean })
      | null;
    if (!icon) {
      return "none";
    }
    return icon.mirror ? `${icon.name} mirrored` : icon.name;
  }
  const pressed = (el: Element) => control(el).getAttribute("aria-pressed") === "true";

  test("each dock's glyph and pressed state follow the record it renders", async () => {
    await mountBar();
    const navigatorToggle = btn("Toggle Navigator Dock");
    expect(pressed(navigatorToggle)).toBe(true);
    // Three regions, one shipped shape for the two sides and a third for the Bottom dock, which
    // Used to carry `align-bottom` and so named no region at all.
    expect(glyph(navigatorToggle)).toBe("sidebar-simple");
    expect(glyph(btn("Toggle Inspector Dock"))).toBe("sidebar-simple mirrored");
    expect(glyph(btn("Toggle Bottom Dock"))).toBe("rows");
    // …and no two of them read the same, which is the property the mirrored pair lacked.
    const shapes = [
      glyph(navigatorToggle),
      glyph(btn("Toggle Inspector Dock")),
      glyph(btn("Toggle Bottom Dock")),
    ];
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(control(navigatorToggle).getAttribute("title")).toBe("Toggle Navigator Dock (⌘B)");

    click(control(navigatorToggle));
    await flush();
    expect(ran).toEqual(["toggleDock:navigator"]);
  });

  test("a flip made from outside the bar reaches its buttons", async () => {
    await mountBar();
    expect(pressed(btn("Toggle Bottom Dock"))).toBe(false);

    // A bare state write, with no repaint call beside it: the band's effect tracks all three dock
    // Records, so a flip made by the automation runner, a layout preset or the boot-time restore
    // Reaches the buttons the same way a click does. The third toggle reports the BOTTOM dock —
    // Naming ⌘J while drawing a chat glyph and reporting the Assistant's tab selection was a
    // Control that announced one surface and answered for another.
    shell.docks.bottom.collapsed = false;
    await flush();
    expect(pressed(btn("Toggle Bottom Dock"))).toBe(true);
    expect(glyph(btn("Toggle Bottom Dock"))).toBe("rows");

    // The Assistant is an Inspector tab now, and the Bottom dock does not answer for it.
    setInspectorTab("assistant");
    await flush();
    expect(pressed(btn("Toggle Bottom Dock"))).toBe(true);

    shell.docks.right.collapsed = true;
    shell.docks.bottom.collapsed = true;
    await flush();
    expect(pressed(btn("Toggle Bottom Dock"))).toBe(false);
    // Three docks in three different states at once: the glyph names the region, `aria-pressed`
    // The state, and the two must not be confused for one another.
    expect(glyph(btn("Toggle Inspector Dock"))).toBe("sidebar-simple mirrored");
    expect(pressed(btn("Toggle Inspector Dock"))).toBe(false);
    expect(glyph(btn("Toggle Navigator Dock"))).toBe("sidebar-simple");
    expect(pressed(btn("Toggle Navigator Dock"))).toBe(true);
  });

  test("the navigator button reports a closed dock without changing what it names", async () => {
    shell.docks.left.collapsed = true;
    await mountBar();
    expect(pressed(btn("Toggle Navigator Dock"))).toBe(false);
    expect(glyph(btn("Toggle Navigator Dock"))).toBe("sidebar-simple");
  });
});

// ─── Presence ─────────────────────────────────────────────────────────────────

describe("presence", () => {
  test("is absent while the platform offers no collaboration, and draws the peers when it does", async () => {
    const tab = openTestTab();
    await mountBar();
    expect(root.querySelector('[part="presence"]')).toBeNull();

    const state = collabState(tab);
    state.status = "synced";
    state.active = true;
    state.peers = [
      {
        clientId: 1,
        state: {
          focusedPath: tab.documentPath,
          structuralSelection: null,
          user: { color: "#e5484d", login: "octocat", name: "Octo Cat" },
        },
      },
      {
        clientId: 2,
        state: {
          focusedPath: "pages/other.json",
          structuralSelection: null,
          user: { avatarUrl: "https://example.test/v.png", color: "#30a46c", login: "viewer" },
        },
      },
    ];
    await flush();
    const status = root.querySelector<HTMLElement>('[part="status"]')!;
    expect(status.textContent).toBe("Live");
    expect(status.dataset["status"]).toBe("synced");
    const chips = [...root.querySelectorAll<HTMLElement>('[part="chip"]')];
    expect(chips).toHaveLength(2);
    expect(chips[0]!.getAttribute("title")).toContain("Octo Cat");
    expect(chips[0]!.textContent?.trim()).toBe("O");
    expect(chips[0]!.getAttribute("style")).toContain("#e5484d");
    // A peer with an avatar draws it, with the initial as its alt text.
    expect(chips[1]!.querySelector("img")?.getAttribute("alt")).toBe("V");

    state.readOnly = true;
    state.sourceCanonical = true;
    await flush();
    expect(root.querySelector('[part="flag"][data-flag="read-only"]')?.textContent).toBe(
      "Read-only",
    );
    const frozen = root.querySelector('[part="flag"][data-flag="frozen"]')!;
    expect(frozen.textContent).toBe("Code view held");
    expect(frozen.getAttribute("title")).toContain("This is not an error");
  });
});

// ─── Window controls ──────────────────────────────────────────────────────────

describe("window controls", () => {
  const titles = (group: Element) =>
    [...group.querySelectorAll("jx-action-button")].map((b) => control(b).getAttribute("title"));

  test("non-mac order is minimize, maximize, close — and they sit at the end", async () => {
    const controls = { close: mock(() => {}), maximize: mock(() => {}), minimize: mock(() => {}) };
    (globalThis as Record<string, unknown>).__jxPlatform = { windowControls: controls };
    await mountBar();

    expect(root.classList.contains("electrobun-webkit-app-region-drag")).toBe(true);
    const group = root.querySelector<HTMLElement>('[part="window-controls"]')!;
    expect(group.dataset["mac"] !== undefined).toBe(false);
    expect(titles(group)).toEqual(["Minimize", "Maximize", "Close"]);
    const buttons = [...group.querySelectorAll("jx-action-button")];
    click(control(buttons[0]!));
    click(control(buttons[1]!));
    click(control(buttons[2]!));
    await flush();
    expect(controls.minimize).toHaveBeenCalledTimes(1);
    expect(controls.maximize).toHaveBeenCalledTimes(1);
    expect(controls.close).toHaveBeenCalledTimes(1);
    const bar = root.querySelector('[part="bar"]')!;
    expect(bar.lastElementChild?.contains(group)).toBe(true);
  });

  test("mac puts them first, close leading", async () => {
    toolbar.setMacPlatformForTests(true);
    try {
      const controls = {
        close: mock(() => {}),
        maximize: mock(() => {}),
        minimize: mock(() => {}),
      };
      (globalThis as Record<string, unknown>).__jxPlatform = { windowControls: controls };
      await mountBar();
      const group = root.querySelector<HTMLElement>('[part="window-controls"]')!;
      expect(group.dataset["mac"] !== undefined).toBe(true);
      expect(titles(group)).toEqual(["Close", "Minimize", "Maximize"]);
      const bar = root.querySelector('[part="bar"]')!;
      expect(bar.firstElementChild?.contains(group)).toBe(true);
    } finally {
      toolbar.setMacPlatformForTests(null);
    }
  });

  test("a browser has no window controls, and the band does not claim a drag region", async () => {
    await mountBar();
    expect(root.querySelector('[part="window-controls"]')).toBeNull();
    expect(root.classList.contains("electrobun-webkit-app-region-drag")).toBe(false);
  });
});

// ─── View: Open in Browser ────────────────────────────────────────────────────

/** The origin a backend reports the built site at — its own port, never the editor's. */
const SITE_ORIGIN = "http://127.0.0.1:4321";

function openSiteProject(trailingSlash?: "always" | "never") {
  (globalThis as Record<string, unknown>).__jxPlatform = {
    canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
  };
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "acme",
    projectConfig: (trailingSlash ? { build: { trailingSlash } } : {}) as never,
    projectRoot: "/acme",
    searchQuery: "",
    selectedPath: null,
  });
}

function pageTab(documentPath: string): Tab {
  closeAllTabs();
  return openTab({
    capabilities: { modes: ALL_MODES },
    document: { children: [], tagName: "div" },
    documentPath,
    id: "page-tab",
  });
}

describe("openInBrowserTarget", () => {
  /* These asserted the compiler's OUTPUT PATH — `/dist/blog/hello/index.html` — and passed against
     a URL no reader could use. A built page's own markup is root-absolute (`/components/demo.css`,
     a link to `/basics/counter`), so from a `/dist/…` URL the assets 404 against the server root
     and the first link leaves the site: measured on the running dev server as page 200, CSS 404,
     link 404. The answer is the page's ROUTE now — the one it will have when published, and the
     one its own links already point at. The ORIGIN is the backend's to report, because the built
     site is served on a port of its own. */
  test("a page resolves to the route it will be published at", () => {
    openSiteProject();
    expect(toolbar.openInBrowserTarget(pageTab("pages/blog/hello.md"))).toEqual({
      path: "/blog/hello/",
    });
  });

  test("the root page is the site root", () => {
    openSiteProject();
    expect(toolbar.openInBrowserTarget(pageTab("./pages/index.md"))).toEqual({ path: "/" });
  });

  test("trailingSlash: never drops the slash, as the published URL does", () => {
    openSiteProject("never");
    expect(toolbar.openInBrowserTarget(pageTab("pages/about.json"))).toEqual({ path: "/about" });
  });

  test("a dynamic route waits for its params, then resolves the chosen page", () => {
    openSiteProject();
    const tab = pageTab("pages/blog/[slug].json");
    expect(toolbar.openInBrowserTarget(tab)).toEqual({
      reason: "Pick a value for :slug to open one of this route's pages.",
    });
    tab.session.ui.previewParams = { slug: "getting started" };
    expect(toolbar.openInBrowserTarget(tab)).toEqual({ path: "/blog/getting%20started/" });
  });

  test("every refusal is a sentence, not an absence", () => {
    expect(toolbar.openInBrowserTarget(null)).toEqual({
      reason: "Open a page to view it in a browser.",
    });
    const tab = pageTab("pages/index.md");
    expect(toolbar.openInBrowserTarget(tab)).toEqual({
      reason: "This project does not build a site.",
    });
    openSiteProject();
    expect(toolbar.openInBrowserTarget(pageTab("components/Card.json"))).toEqual({
      reason: "Only pages have a route — components/Card.json is not under pages/.",
    });
    expect(toolbar.openInBrowserTarget(pageTab("pages/docs/[...rest].json"))).toEqual({
      reason: "Catch-all routes match many pages — open a generated one instead.",
    });
  });
});

describe("runOpenInBrowser — the live path", () => {
  /** A backend that previews the working tree, which is what the action reaches first. */
  function installPreviewingPlatform(result: Partial<SitePreviewResult> = {}) {
    const routes: string[] = [];
    installMockPlatform({
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
      clearPreviewOverlay: () => Promise.resolve(),
      previewSite: async (opts: { route: string }) => {
        routes.push(opts.route);
        return {
          errors: [],
          files: 0,
          mode: "live" as const,
          reused: false,
          routes: 4,
          url: SITE_ORIGIN,
          ...result,
        };
      },
      setPreviewOverlay: () => Promise.resolve(),
    });
    return routes;
  }

  test("previews rather than builds, and opens the route it asked for", async () => {
    openSiteProject();
    pageTab("pages/blog/hello.md");
    const routes = installPreviewingPlatform();
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(routes).toEqual(["/blog/hello/"]);
      expect(opened).toEqual([`${SITE_ORIGIN}/blog/hello/`]);
      expect(notified.mock.calls.at(-1)![0]).toContain("not a build");
    } finally {
      setPreviewNavigateHandler(null);
    }
  });

  test("`reused` opens NOTHING — that is what stops a second tab on one project", async () => {
    /* No page can raise a background tab and handing the URL to the OS again would duplicate it,
       so the notification says where to look instead of opening anything. */
    openSiteProject();
    pageTab("pages/index.md");
    installPreviewingPlatform({ reused: true });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(opened).toEqual([]);
      expect(notified.mock.calls.at(-1)![0]).toContain("switch to your browser");
      expect(notified.mock.calls.at(-1)![0]).toContain("/");
    } finally {
      setPreviewNavigateHandler(null);
    }
  });

  test("problems the preview reports are named, and the page still opens", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installPreviewingPlatform({ errors: ["pages/huge.json is too large to preview unsaved."] });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(notified.mock.calls.at(-1)![0]).toContain("too large");
      expect(opened).toEqual([`${SITE_ORIGIN}/`]);
    } finally {
      setPreviewNavigateHandler(null);
    }
  });

  test("a backend that serves no origin says so rather than guessing one", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
      previewSite: async () => ({
        errors: [],
        files: 0,
        mode: "live" as const,
        reused: false,
        routes: 0,
      }),
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(opened).toEqual([]);
      expect(notified.mock.calls.at(-1)![0]).toContain("serves no preview");
    } finally {
      setPreviewNavigateHandler(null);
    }
  });

  test("a preview that throws is reported, and nothing opens", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
      previewSite: () => Promise.reject(new Error("port exhausted")),
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(opened).toEqual([]);
      expect(notified.mock.calls.at(-1)![0]).toContain("port exhausted");
    } finally {
      setPreviewNavigateHandler(null);
    }
  });

  test("a backend with only buildSite still works — nothing regresses on day one", async () => {
    /* The cloud adapter answers `buildSite` with `mode: "live"` of its own, and `jx dev` answers
       it with a real build. Neither declares `previewSite`, and both must keep working. */
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({
      buildSite: async () => ({
        errors: [],
        files: 3,
        mode: "live" as const,
        routes: 2,
        url: SITE_ORIGIN,
      }),
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    try {
      await toolbar.runOpenInBrowser();
      expect(opened).toEqual([`${SITE_ORIGIN}/`]);
      expect(notified.mock.calls.at(-1)![0]).toContain("not a build");
    } finally {
      setPreviewNavigateHandler(null);
    }
  });
});

describe("runBuildSite", () => {
  test("reports what the compiler produced", async () => {
    openSiteProject();
    installMockPlatform({ buildSite: async () => ({ errors: [], files: 12, routes: 4 }) });
    await toolbar.runBuildSite();
    expect(notified.mock.calls.at(-1)![0]).toContain("Built 4 page(s), 12 file(s).");
  });

  test("a build with errors is named, and does not read as a success", async () => {
    openSiteProject();
    installMockPlatform({
      buildSite: async () => ({ errors: ["pages/x.json: bad ref"], files: 0, routes: 0 }),
    });
    await toolbar.runBuildSite();
    expect(notified.mock.calls.at(-1)![0]).toContain("bad ref");
  });

  test("a build that throws is reported", async () => {
    openSiteProject();
    installMockPlatform({ buildSite: () => Promise.reject(new Error("sharp missing")) });
    await toolbar.runBuildSite();
    expect(notified.mock.calls.at(-1)![0]).toContain("sharp missing");
  });

  test("a backend that cannot build says so", async () => {
    openSiteProject();
    installMockPlatform({});
    await toolbar.runBuildSite();
    expect(notified.mock.calls.at(-1)![0]).toContain("cannot build the site");
  });
});

describe("runOpenInBrowser", () => {
  /** A backend that builds and reports where the result is browsable. */
  function installBuildingPlatform(result: Partial<SiteBuildResult> = {}) {
    installMockPlatform({
      buildSite: async () => ({ errors: [], files: 3, routes: 2, url: SITE_ORIGIN, ...result }),
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
    });
  }

  test("hands the URL to the preview-navigate seam, and falls back to a new tab", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installBuildingPlatform();
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([`${SITE_ORIGIN}/`]);

    setPreviewNavigateHandler(null);
    const calls: unknown[][] = [];
    const originalOpen = window.open;
    (window as unknown as { open: unknown }).open = (...args: unknown[]) => {
      calls.push(args);
      return null;
    };
    try {
      await toolbar.runOpenInBrowser();
      expect(calls).toEqual([[`${SITE_ORIGIN}/`, "_blank", "noopener,noreferrer"]]);
    } finally {
      window.open = originalOpen;
    }
  });

  test("reports the blocking reason instead of opening nothing", () => {
    closeAllTabs();
    void toolbar.runOpenInBrowser();
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified.mock.calls[0]![0]).toContain("Open a page to view it");
  });

  /* The other half of "as if published": what a reader opens is what the AUTHOR is looking at.
     Nothing in Studio had ever written the site's output, so before this the reader saw whatever
     the last `jx build` left on disk — for most projects nothing at all, which is a 404 dressed up
     as a feature. */
  test("builds before opening, and opens the origin the BUILD reports", async () => {
    /* Not the editor's origin. The two URL spaces collide: `/components/demo.js` is the formula
       module in the project's sources and the custom element in its output, and a reader handed
       the editor's origin gets whichever the editor resolves — measured as a page that rendered
       with `customElements.get(…)` null and nothing on it working. */
    openSiteProject();
    pageTab("pages/index.md");
    const built: string[] = [];
    installMockPlatform({
      buildSite: async () => {
        built.push("built");
        return { errors: [], files: 3, routes: 2, url: "http://127.0.0.1:5555" };
      },
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(built).toEqual(["built"]);
    expect(opened).toEqual(["http://127.0.0.1:5555/"]);
    setPreviewNavigateHandler(null);
  });

  test("a build error is named, and the page still opens", async () => {
    // A partial build produced pages. Refusing to show the one the author asked for would trade a
    // Readable page plus a sentence for a sentence.
    openSiteProject();
    pageTab("pages/index.md");
    installBuildingPlatform({ errors: ["pages/broken.json: unknown tag"], files: 1, routes: 1 });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([`${SITE_ORIGIN}/`]);
    expect(notified.mock.calls.at(-1)![0]).toContain("unknown tag");
    setPreviewNavigateHandler(null);
  });

  test("a build that THROWS does not open a page that would be a lie", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({
      buildSite: async () => {
        throw new Error("no disk space");
      },
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([]);
    expect(notified.mock.calls.at(-1)![0]).toContain("no disk space");
    setPreviewNavigateHandler(null);
  });

  test("a backend that can neither preview nor build says so rather than opening the editor's origin", async () => {
    /* It used to open the canvas origin and call that graceful. It is not: that origin serves the
       project's SOURCES, so the reader would get a page whose scripts and styles are whichever
       source file shares the URL. A sentence beats a site that looks published and is not. */
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({ canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html` });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([]);
    expect(notified.mock.calls.at(-1)![0]).toContain("cannot preview the site");
    setPreviewNavigateHandler(null);
  });

  test("a build that reports no origin does not send the reader anywhere", async () => {
    // The build succeeded and the backend serves no preview of it — a real answer for a hosted
    // Backend, and one the reader must be told rather than shown a broken address for.
    openSiteProject();
    pageTab("pages/index.md");
    installMockPlatform({
      buildSite: async () => ({ errors: [], files: 3, routes: 2 }),
      canvasUrl: `${SITE_ORIGIN}/__studio__/canvas.html`,
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([]);
    expect(notified.mock.calls.at(-1)![0]).toContain("serves no preview");
    setPreviewNavigateHandler(null);
  });

  /* A hosted backend cannot run a build at all — no project JS, no bundler, no sharp, no disk — so
     it renders the working tree as a site instead. That is a different thing from build output in
     ways the reader can see, and the report has to say which one they are looking at. */
  test("a LIVE preview is reported as one rather than as a build", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installBuildingPlatform({ mode: "live" });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    expect(opened).toEqual([`${SITE_ORIGIN}/`]);
    const message = notified.mock.calls.at(-1)![0] as string;
    expect(message).toContain("live preview");
    expect(message).toContain("working tree");
    expect(message).not.toContain("Built");
    setPreviewNavigateHandler(null);
  });

  test("a live preview's errors are 'previewed with', not 'built with'", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installBuildingPlatform({
      errors: ["$paths for pages/[slug].json needs a module"],
      mode: "live",
    });
    const opened: string[] = [];
    setPreviewNavigateHandler((url) => opened.push(url));
    await toolbar.runOpenInBrowser();
    // The page still opens: what did resolve is worth looking at beside what did not.
    expect(opened).toEqual([`${SITE_ORIGIN}/`]);
    const message = notified.mock.calls.at(-1)![0] as string;
    expect(message).toContain("previewed with 1 error");
    expect(message).toContain("needs a module");
    setPreviewNavigateHandler(null);
  });

  test("an absent mode still reads as a build, so an older backend keeps its meaning", async () => {
    openSiteProject();
    pageTab("pages/index.md");
    installBuildingPlatform();
    setPreviewNavigateHandler(() => {});
    await toolbar.runOpenInBrowser();
    expect(notified.mock.calls.at(-1)![0]).toContain("Built 2 page(s).");
    setPreviewNavigateHandler(null);
  });
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe("lifecycle", () => {
  test("render is a no-op before mount and after unmount", () => {
    toolbar.unmount();
    expect(() => {
      toolbar.render();
    }).not.toThrow();
  });

  test("the band paints a skeleton before the bootstrap composes the registry", async () => {
    setActiveRegistry(null);
    await mountBar();
    // The pill is still there — "where am I" does not depend on the registry — but no verbs are.
    expect(root.querySelector('[part="center"]')).not.toBeNull();
    expect(root.querySelector("jx-button")).toBeNull();
    expect(root.querySelector('[data-menu="studio"]')).toBeNull();

    // Publishing the registry repaints, with no render() call beside it.
    ctx = makeContext({ document: { open: true } });
    installRegistry();
    await flush();
    expect(btn("Save")).toBeTruthy();
    expect(root.querySelector('[data-menu="studio"]')).not.toBeNull();
  });

  test("unmount disposes the document and stops the reactive effect", async () => {
    ctx = makeContext({ document: { open: true, canUndo: false } });
    await mountBar();
    expect(control(btn("Undo")).disabled).toBe(true);

    toolbar.unmount();
    expect(root.querySelector('[part="bar"]')).toBeNull();
    ctx = makeContext({ document: { open: true, canUndo: true } });
    openTestTab();
    await flush();
    expect(root.childElementCount).toBe(0);
  });

  test("a projection that throws is logged, not thrown out of the bootstrap", async () => {
    const registry = installRegistry();
    setActiveRegistry({
      ...registry,
      forPlacement: () => {
        throw new Error("boom");
      },
    } as unknown as CommandRegistry);
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      expect(() => {
        toolbar.mount(root);
      }).not.toThrow();
      await flush();
      expect(errors.some(([first]) => first === "command bar projection error:")).toBe(true);
    } finally {
      console.error = originalError;
    }
  });
});
