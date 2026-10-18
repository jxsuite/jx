import { ICON_NAMES } from "@jxsuite/ui/icons";
import { flush, installMockPlatform, renderInto, resetStudioState } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { html, nothing } from "lit-html";
import { isSymbol } from "@jxsuite/schema/guards";
import {
  getPanel,
  isPanelVisible,
  listPanels,
  panelContext,
  railDeclarations,
  railGroups,
  railPanelSet,
  registerPanel,
  resetPanels,
  unregisterPanel,
} from "../src/panels/panel-registry";
import type { NavigatorPanelDeps, PanelRecord } from "../src/panels/panel-registry";
import { setProjectState } from "../src/store";
import { closeAllTabs } from "../src/workspace/workspace";
import { cleanupSourceControl } from "../src/publish/source-control";
import {
  navigatorPanelSet,
  registerNavigatorPanels,
  resetNavigatorPanels,
} from "../src/panels/navigator-panels";
import { emptyContext } from "../src/commands/context";
import { setDeveloperPanelsShown } from "../src/settings/developer-panels";
import {
  checkPanelPlacement,
  checkPanelPlacements,
  PANEL_PLACEMENT_MATRIX,
  panelPlacements,
} from "../src/commands/levels";
import type { PlaceablePanel } from "../src/commands/levels";
import {
  DEFAULT_PANEL_ID,
  migratePanelId,
  NAVIGATOR_PANEL_IDS,
  navigatorPanelOutsideWorkspace,
  resetProjectShell,
  shell,
  WORKSPACE_ONLY_PANELS,
  WORKSPACE_PRESETS,
} from "../src/shell";

function record(over: Partial<PanelRecord> = {}): PanelRecord {
  return {
    id: "fixture",
    title: "Fixture",
    level: "project",
    dock: "navigator",
    icon: "folder",
    render: () => html`<p>body</p>`,
    ...over,
  };
}

/** A Navigator panel record as an extension hands it in: its level is whatever string it carries. */
function panelFromData(id: string, level: string): PlaceablePanel {
  /* SAFETY: deliberately off-type. `PlaceablePanel` types `level` as a Level, but
     `checkPanelPlacement` re-checks `isLevel` before anything else, precisely because records
     arrive as data; that runtime check is what a record built here exists to reach. */
  return { dock: "navigator", id, level } as PlaceablePanel;
}

afterEach(() => {
  resetPanels();
});

// ─── registerPanel ────────────────────────────────────────────────────────────

describe("registerPanel", () => {
  test("stores a record and returns it by id", () => {
    registerPanel(record());
    expect(getPanel("fixture")?.title).toBe("Fixture");
    expect(listPanels("navigator").map((p) => p.id)).toEqual(["fixture"]);
  });

  test("rejects a duplicate id — the second definition site is the defect", () => {
    registerPanel(record());
    expect(() => registerPanel(record())).toThrow(/already registered/);
  });

  test("rejects a malformed id, because the id is also the region", () => {
    expect(() => registerPanel(record({ id: "Files Panel" }))).toThrow(/malformed/);
  });

  test("rejects a rail panel whose level has no rail group", () => {
    // `application` and `selection` name no rail group, so a rail button for one is a placement
    // The matrix does not contain — the check that stops the rail re-accreting.
    expect(() => registerPanel(record({ level: "application" }))).toThrow(/not a panel placement/);
    expect(() => registerPanel(record({ level: "selection" }))).toThrow(/not a panel placement/);
  });

  test("accepts those levels off the rail, where they claim no group", () => {
    expect(() => registerPanel(record({ level: "application", rail: false }))).toThrow(
      /admits only project, document/,
    );
  });

  test("rejects a selection-level panel in the Navigator dock", () => {
    expect(() => registerPanel(record({ level: "selection", rail: false }))).toThrow(
      /"navigator" admits only project, document/,
    );
  });

  test("unregisterPanel removes it", () => {
    registerPanel(record());
    unregisterPanel("fixture");
    expect(getPanel("fixture")).toBeUndefined();
  });

  test("accepts a railLabel that leads the title, and keeps both names", () => {
    registerPanel(record({ title: "Source Control", railLabel: "Source" }));
    expect(getPanel("fixture")?.title).toBe("Source Control");
    expect(getPanel("fixture")?.railLabel).toBe("Source");
  });

  test("rejects a railLabel the accessible name does not start with (WCAG 2.5.3)", () => {
    /* The rail button's accessible name stays the title, so the words printed under the glyph must
       be inside it and lead it. A trailing word, a different word and a blank all fail, at
       registration, before a rail can draw a label that says something the name does not. */
    for (const railLabel of ["Control", "Git", "  "]) {
      expect(() => registerPanel(record({ title: "Source Control", railLabel }))).toThrow(
        /Label in Name/,
      );
    }
    expect(getPanel("fixture")).toBeUndefined();
  });
});

// ─── the matrix ───────────────────────────────────────────────────────────────

describe("panel placement matrix", () => {
  test("a rail panel occupies its dock body and its level's rail group", () => {
    expect(panelPlacements({ id: "files", level: "project", dock: "navigator" })).toEqual([
      "navigator",
      "rail/project",
    ]);
  });

  test("rail: false drops the rail-group placement", () => {
    expect(
      panelPlacements({ id: "insert", level: "document", dock: "navigator", rail: false }),
    ).toEqual(["navigator"]);
  });

  test("the bottom dock's placement key is dotted", () => {
    expect(
      panelPlacements({ id: "problems", level: "project", dock: "bottom", rail: false }),
    ).toEqual(["dock.bottom"]);
  });

  test("each rail group admits exactly one level", () => {
    expect(PANEL_PLACEMENT_MATRIX["rail/project"].admits).toEqual(["project"]);
    expect(PANEL_PLACEMENT_MATRIX["rail/document"].admits).toEqual(["document"]);
  });

  test("a whole set is checked at once, and a clean set reports nothing", () => {
    expect(
      checkPanelPlacements([
        { id: "files", level: "project", dock: "navigator" },
        { id: "insert", level: "document", dock: "navigator", rail: false },
      ]),
    ).toEqual([]);
  });

  test("a whole set reports every offender, keyed by panel", () => {
    const violations = checkPanelPlacements([
      { id: "good", level: "document", dock: "navigator" },
      { id: "bad", level: "selection", dock: "navigator", rail: false },
    ]);
    expect(violations.map((v) => v.panelId)).toEqual(["bad"]);
  });

  test("an unknown level is reported before any placement is checked", () => {
    const violations = checkPanelPlacement(panelFromData("bogus", "range"));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/unknown level "range"/);
  });
});

// ─── the composed set ─────────────────────────────────────────────────────────

describe("the Navigator's panel set", () => {
  test("registers nine records, in registration order — and Problems is not one of them", () => {
    expect(navigatorPanelSet().map((p) => p.id)).toEqual([
      // The Site panel leads: the Project group's one button and the Navigator's default (§5.7).
      "site",
      // The Content workspace's Navigator (§22.5): no rail button, opened by that workspace's frame.
      "collections",
      "files",
      "search",
      // No `git`: Source Control is the Publish workspace's Review changes and Branches (§5.5).
      // Languages is registered with the PROJECT group and draws no rail button, so it sits here
      // Rather than beside Insert at the end — registration order is roster order, and this list
      // Is what `view.setActivity` and the shot manifest address the panel by.
      "i18n",
      "layers",
      // No `page`: the Page panel is the Inspector's first tab now (§6).
      "data",
      "packages",
      "insert",
    ]);
  });

  test("agrees with NAVIGATOR_PANEL_IDS — the enum view.setActivity validates against", () => {
    // Two lists, because `shell.ts` must load in a bare Bun process for the CI checks. This is
    // What stops them drifting.
    expect(navigatorPanelSet().map((p) => p.id)).toEqual([...NAVIGATOR_PANEL_IDS]);
  });

  test("WORKSPACE_ONLY_PANELS is exactly the rail-less panels a workspace preset pins", () => {
    // The shell loads in a bare Bun process and cannot read `rail` off the records, so the set is
    // Written down there; this is what stops it drifting from them.
    const pinned = new Set<string>(
      Object.values(WORKSPACE_PRESETS).flatMap((p) =>
        p.navigator.panel ? [p.navigator.panel] : [],
      ),
    );
    const expected = navigatorPanelSet()
      .filter((panel) => panel.rail === false && pinned.has(panel.id))
      .map((panel) => panel.id);
    const only: string[] = [...WORKSPACE_ONLY_PANELS];
    expect(only).toEqual(expected);
  });

  test("outside a workspace frame a workspace-only panel falls back to the default", () => {
    expect(navigatorPanelOutsideWorkspace("collections")).toBe(DEFAULT_PANEL_ID);
    expect(navigatorPanelOutsideWorkspace("layers")).toBe("layers");
    expect(navigatorPanelOutsideWorkspace(null)).toBe(DEFAULT_PANEL_ID);
  });

  test("registerNavigatorPanels is idempotent — the app mounts once, a suite mounts per case", () => {
    registerNavigatorPanels();
    registerNavigatorPanels();
    expect(listPanels("navigator")).toHaveLength(9);
    // …and it composes the Bottom dock's tabs in the same pass, still exactly once each. There is
    // No `diff` among them: it was a reserved id with no record behind it, so it could only ever
    // Select a hidden tab.
    expect(listPanels("bottom").map((p) => p.id)).toEqual(["problems", "logic", "activity"]);
  });

  test("the three renamed ids are gone", () => {
    const ids = navigatorPanelSet().map((p) => p.id);
    expect(ids).not.toContain("blocks");
    expect(ids).not.toContain("head");
    expect(ids).not.toContain("imports");
  });

  test("a declared-but-unbuilt panel refuses to render, rather than drawing a stub", () => {
    // `when` is the guard, so deleting the predicate without building the surface fails loudly
    // Instead of shipping an empty panel with a real header. Search is the one left: Problems was
    // The other, and its predicate went in the same commit that gave it a body.
    const panel = navigatorPanelSet().find((p) => p.id === "search");
    expect(panel?.when?.(emptyContext())).toBe(false);
    expect(() =>
      panel!.render({ deps: projectPanelDeps(), doc: null, rerender: () => {} }),
    ).toThrow(/declared but not built/);
  });

  test("Problems is built, and it is the Bottom dock's — one record, one host (§16.3)", () => {
    registerNavigatorPanels();
    const panel = getPanel("problems");
    expect(panel?.dock).toBe("bottom");
    expect(panel?.level).toBe("project");
    expect(panel?.when).toBeUndefined();
    expect(panel?.badge).toBeDefined();
    expect(() =>
      panel!.render({ deps: projectPanelDeps(), doc: null, rerender: () => {} }),
    ).not.toThrow();
    expect(navigatorPanelSet().map((p) => p.id)).not.toContain("problems");
  });

  test("resetNavigatorPanels empties the registry so a suite can compose it again", () => {
    registerNavigatorPanels();
    resetNavigatorPanels();
    expect(listPanels()).toEqual([]);
  });

  test("every panel declares a level and an icon", () => {
    for (const panel of navigatorPanelSet()) {
      expect(["project", "document"]).toContain(panel.level);
      // A glyph the kit ships: the rail draws it through jx-icon, whose manifest is the kit's.
      expect(ICON_NAMES).toContain(panel.icon);
      expect(panel.title.length).toBeGreaterThan(0);
    }
  });

  test("Source Control is not a Navigator panel: Publish hosts it (§5.5)", () => {
    registerNavigatorPanels();
    expect(getPanel("git")).toBeUndefined();
  });

  test("Files and Packages are developer panels; Search, Languages and Insert have no button", () => {
    registerNavigatorPanels();
    expect(getPanel("files")?.rail).toBe("developer");
    expect(getPanel("packages")?.rail).toBe("developer");
    for (const id of ["search", "i18n", "insert"]) {
      expect(getPanel(id)?.rail).toBe(false);
    }
    expect(getPanel("site")?.rail).toBeUndefined();
  });

  test("every rail label fits under its glyph", () => {
    /* A character count stands in for the 48px stacked label box at `--jx-text-xs`, because
       happy-dom does no layout. "Packages" is eight characters and 46px, the widest that fits;
       "Source Control" was fourteen and 71px, and the kit ellipsed it. A proxy, not a measurement:
       eight very wide glyphs could still clip, so a new long title should declare a railLabel. */
    registerNavigatorPanels();
    for (const panel of railPanelSet()) {
      expect({ id: panel.id, label: panel.railLabel ?? panel.title }).toEqual({
        id: panel.id,
        label: expect.stringMatching(/^.{1,8}$/u),
      });
    }
  });

  test("the default panel is one of them", () => {
    expect(navigatorPanelSet().map((p) => p.id)).toContain(DEFAULT_PANEL_ID);
  });
});

// ─── The level rule's corollary (§13.2) ───────────────────────────────────────

/**
 * The deps a PROJECT-level panel may touch, and a tripwire for everything else.
 *
 * None is real any more. Every member of {@link NavigatorPanelDeps} is a document-level renderer or
 * a document-level gesture registration, so reaching for one IS the violation this suite is looking
 * for — and the error names which. Files and Source Control are documents mounted by their own
 * `afterRender` and reach for NOTHING on a paint (Source Control only holds the deps for a later
 * gesture), which is why their entries are gone rather than stubbed: a regression that made either
 * delegate again lands on the Proxy.
 */
function projectPanelDeps(): NavigatorPanelDeps {
  const provided: Partial<NavigatorPanelDeps> = {};
  /* SAFETY: every member the record does not hold THROWS on read instead of answering undefined,
     so no caller can observe a missing member as a present one; the full type is only the
     signature the panels are handed, and any read past it is the defect the trap reports. */
  return new Proxy(provided, {
    get(target, prop) {
      if (isSymbol(prop) || prop in target) {
        /* SAFETY: a symbol, or a key `in` already found on the record or its prototype chain: the
           read answers exactly what the plain object would, and the keyof claim only types it. */
        return target[prop as keyof NavigatorPanelDeps];
      }
      throw new Error(
        `a level: "project" panel read deps.${prop}, which only exists for a focused document`,
      );
    },
  }) as NavigatorPanelDeps;
}

/**
 * The corollary of filing a panel by the state it writes (§13.2; studio-ui-guidelines.md §12.1),
 * asserted as the loop `panel-registry.ts` says it is.
 *
 * The docstring on {@link import("../src/panels/panel-registry").NavigatorDocument} has long claimed
 * that this file "renders every project-level panel with `doc: null`". It rendered exactly one —
 * Problems — so the claim was a promise rather than a check, and the defect it names (the Source
 * Control badge vanishing when the last tab closed) could have come back through any of the others
 * without a test moving.
 *
 * Three paints, because "renders" is not one body. The first is what kicks off `refreshGitStatus()`
 * and `loadDirectory(".")`; the second is the empty state those resolve into; the third is the full
 * Source Control body a real repository draws, which is the biggest surface any project-level panel
 * has and the one whose badge used to come off the focused tab. A panel that only reaches for the
 * document once it has something to show is still a panel that reaches.
 */
describe("every project-level panel renders with no document open", () => {
  afterEach(() => {
    cleanupSourceControl();
    resetProjectShell();
    setProjectState(null);
    closeAllTabs();
  });

  test("no tab, no throw — cold, empty, and with a working tree to draw", async () => {
    installMockPlatform();
    setProjectState({
      dirs: new Map(),
      expanded: new Set(),
      isSiteProject: true,
      name: "Demo",
      projectConfig: { name: "Demo" },
      projectDirs: [],
      projectRoot: ".",
      searchQuery: "",
      selectedPath: null,
    });
    closeAllTabs();
    registerNavigatorPanels();

    const ctx = panelContext();
    const panels = listPanels().filter((p) => p.level === "project" && isPanelVisible(p, ctx));
    // Search is registered, `when`-hidden and deliberately unbuilt (its render throws), so the
    // Set under test is the five that DRAW — three Navigator panels and two Bottom-dock tabs, since
    // The corollary is about a panel's LEVEL and not about which dock hosts it. Named rather than
    // Counted: a panel that quietly stopped being project-level would otherwise shrink this loop
    // To nothing and still pass.
    expect(panels.map((p) => p.id)).toEqual([
      "site",
      "collections",
      "files",
      "problems",
      "activity",
    ]);

    const deps = projectPanelDeps();
    const paint = async (): Promise<Map<string, HTMLElement>> => {
      const painted = new Map<string, HTMLElement>();
      for (const panel of panels) {
        const paneCtx = { deps, doc: null, rerender: () => {} };
        const body = panel.render(paneCtx);
        // A TemplateResult is committed for real, because a directive that throws does it on
        // Commit rather than on construction.
        if (body !== nothing) {
          painted.set(panel.id, await renderInto(body));
          continue;
        }
        /* `nothing` is a legal body (PanelBody says so) and it is what a CONVERTED panel returns:
           its markup is a Jx document that its `afterRender` mounts into the host the Navigator
           painted. So the loop paints that host and mounts into it, which is what keeps a panel
           inside this corollary after it moves to the kit. */
        if (panel.afterRender) {
          const host = document.createElement("div");
          host.className = "panel-body";
          const content = document.createElement("div");
          content.className = "panel-content";
          host.append(content);
          document.body.append(host);
          panel.afterRender(paneCtx, host);
          painted.set(panel.id, host);
        }
      }
      // A mounted document needs more turns than a lit render: `mountSurface` is asynchronous and
      // Each kit element settles its own template one `connectedCallback` after that.
      await flush(6);
      return painted;
    };

    // Each pass asserts WHICH body it drew, so "renders three times without throwing" cannot
    // Quietly become "renders the same placeholder three times without throwing".
    const settled = await paint();
    // Addressed by role, because Files is a document too (`surfaces/files-panel.json`).
    expect(settled.get("files")?.querySelector('[role="tree"]')).not.toBeNull();

    // And it draws again, with no document, which is the corollary under test.
    const again = await paint();
    expect(again.get("files")?.querySelector('[role="tree"]')).not.toBeNull();
  });
});

// ─── the rail, as data ────────────────────────────────────────────────────────

describe("railGroups", () => {
  test("two groups, PROJECT then DOCUMENT, hiding what does not exist yet", () => {
    registerNavigatorPanels();
    const groups = railGroups(emptyContext());
    expect(groups.map((g) => g.label)).toEqual(["Project", "Document"]);
    // The Design rail (§5.1): Site above the divider, Outline and Data below it. Files and Packages
    // Are developer panels, off until the preference is on.
    expect(groups[0]?.panels.map((p) => p.id)).toEqual(["site"]);
    expect(groups[1]?.panels.map((p) => p.id)).toEqual(["layers", "data"]);
  });

  test("Show developer panels puts Files and Packages back, and is read reactively", () => {
    registerNavigatorPanels();
    setDeveloperPanelsShown(true);
    try {
      const groups = railGroups(emptyContext());
      expect(groups[0]?.panels.map((p) => p.id)).toEqual(["site", "files"]);
      expect(groups[1]?.panels.map((p) => p.id)).toEqual(["layers", "data", "packages"]);
    } finally {
      setDeveloperPanelsShown(false);
    }
    expect(railGroups(emptyContext())[0]?.panels.map((p) => p.id)).toEqual(["site"]);
  });

  test("Insert is off the rail but still a reachable record", () => {
    registerNavigatorPanels();
    const railed = railGroups(emptyContext()).flatMap((g) => g.panels.map((p) => p.id));
    expect(railed).not.toContain("insert");
    expect(getPanel("insert")).toBeDefined();
  });

  test("State is not a record at all — its editor is part of Data", () => {
    // It used to be registered `rail: false` pending its merge into Data (§5.6), which left the
    // ONE way to declare a state variable behind a palette search. Data renders that editor now, so
    // There is no second record to find, and a stored `state` id migrates rather than 404s.
    registerNavigatorPanels();
    expect(getPanel("state")).toBeUndefined();
    expect(getPanel("data")).toBeDefined();
  });

  test("an empty group is dropped so no divider is drawn against nothing", () => {
    registerPanel(record({ id: "only", level: "document" }));
    const groups = railGroups(emptyContext());
    expect(groups.map((g) => g.level)).toEqual(["document"]);
  });

  test("isPanelVisible defaults to true and honours `when`", () => {
    const ctx = emptyContext();
    expect(isPanelVisible(record(), ctx)).toBe(true);
    expect(isPanelVisible(record({ when: () => false }), ctx)).toBe(false);
  });

  test("the rail spans docks: a rail-able bottom panel gets a button, a rail-less one does not", () => {
    registerPanel(record({ id: "shouted", title: "Shouted", dock: "bottom" }));
    registerPanel(record({ id: "silent", title: "Silent", dock: "bottom", rail: false }));
    const project = railGroups(emptyContext())[0]?.panels.map((p) => p.id);
    expect(project).toContain("shouted");
    expect(project).not.toContain("silent");
    // The same basis `panelPlacements()` has always used — the dock is a separate placement.
    expect(panelPlacements({ id: "shouted", level: "project", dock: "bottom" })).toEqual([
      "dock.bottom",
      "rail/project",
    ]);
  });
});

describe("railPanelSet", () => {
  test("is the rail flattened in group order — PROJECT then DOCUMENT, the palette's order", () => {
    registerNavigatorPanels();
    // The developer panels hold their places whether or not the switch is on, so the roster does
    // Not reorder under the reader when it flips.
    expect(railPanelSet().map((p) => p.id)).toEqual([
      "site",
      "files",
      "layers",
      "data",
      "packages",
    ]);
  });

  test("ignores `when` and the developer switch, so a hidden panel does not shuffle the roster", () => {
    registerPanel(record({ id: "hidden-panel", level: "project", when: () => false }));
    expect(railPanelSet().map((p) => p.id)).toContain("hidden-panel");
    expect(railGroups(emptyContext()).flatMap((g) => g.panels.map((p) => p.id))).not.toContain(
      "hidden-panel",
    );
  });

  test("orders by level group, not by registration order", () => {
    /* A SYNTHETIC panel, because the shipped set no longer proves this on its own.
       Problems used to: it registered last, from the Bottom dock's module, and still landed in the
       PROJECT group ahead of every DOCUMENT one. With it off the rail, registration order and rail
       order happen to coincide, and a test that only reads the real set would pass whether or not
       the sort existed. The property is still load-bearing — a panel is filed by its LEVEL, and the
       module that registers it is free to be loaded whenever — so it is asserted deliberately. */
    registerNavigatorPanels();
    registerPanel({
      id: "late-project-panel",
      title: "Late",
      level: "project",
      dock: "navigator",
      icon: "folder",
      render: () => html``,
    });
    const registration = listPanels().map((p) => p.id);
    const rail = railPanelSet().map((p) => p.id);
    // Registered after every DOCUMENT panel…
    expect(registration.indexOf("late-project-panel")).toBeGreaterThan(
      registration.indexOf("packages"),
    );
    // …and drawn before all of them.
    expect(rail.indexOf("late-project-panel")).toBeLessThan(rail.indexOf("layers"));
  });
});

describe("railDeclarations", () => {
  test("names the two rail groups, in shell order", () => {
    // `commands/budget.ts` used to write these rows out by hand and this test asserted the two
    // Agreed. The duplication is gone — `check-chrome-budget.ts` queries this function — so what
    // Is left to assert is the shape the budget check consumes.
    registerNavigatorPanels();
    expect(railDeclarations()).toEqual([
      { dock: "rail/project", tabs: ["Site", "Files"] },
      { dock: "rail/document", tabs: ["Outline", "Data", "Packages"] },
    ]);
  });

  test("counts the developer panels — a slot the switch can fill is a slot spent", () => {
    registerNavigatorPanels();
    const project = railDeclarations().find((d) => d.dock === "rail/project");
    // Files is off the rail by default and still spends its slot, because the preference can put
    // It back; Search, Source Control and Languages have no button to spend one on.
    expect(project?.tabs).toEqual(["Site", "Files"]);
  });

  test("stays inside the four-per-group cap", () => {
    registerNavigatorPanels();
    for (const declaration of railDeclarations()) {
      expect(declaration.tabs.length).toBeLessThanOrEqual(4);
    }
  });
});

// ─── the panel context ────────────────────────────────────────────────────────

describe("panelContext", () => {
  test("sources the Publish count from the project record, not the focused tab", () => {
    shell.git.status = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: ["a.json", "b.json", "c.json"].map((path) => ({ path, status: "M" })),
      isRepo: true,
      remotes: [],
    };
    expect(panelContext().git.dirtyCount).toBe(3);
    shell.git.status = null;
    expect(panelContext().git.dirtyCount).toBe(0);
  });

  test("computes the workspace on screen, which a panel may gate on", () => {
    const before = shell.workspace;
    shell.workspace = "styles";
    expect(panelContext().workspace.id).toBe("styles");
    shell.workspace = before;
    expect(panelContext().workspace.id).toBe(before);
  });

  /*
   * A key a panel gates on has to be computed here, and this one was not: `isMultilingual` was
   * declared, assigned in `live-context.ts`, and left at its `emptyContext()` default in this
   * subset — so the Languages panel's `when` was false on a project declaring three languages and
   * the Navigator answered "No Navigator panel is registered as i18n". Nothing threw; the panel was
   * simply never visible.
   */
  test("computes isMultilingual, which a panel gates on", () => {
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr-CA"] } },
    });
    expect(panelContext().project.isMultilingual).toBe(true);
    // Counted after canonicalization, so a duplicate or a typo declares one language, not two.
    resetStudioState({ projectConfig: { i18n: { locales: ["en", "EN"] } } });
    expect(panelContext().project.isMultilingual).toBe(false);
    resetStudioState({ projectConfig: {} });
    expect(panelContext().project.isMultilingual).toBe(false);
  });
});

// ─── the persisted-id migration ───────────────────────────────────────────────

describe("migratePanelId", () => {
  test("translates the three renamed ids", () => {
    expect(migratePanelId("blocks")).toBe("insert");
    // Page moved to the Inspector (§6), so both of its stored names reopen on the Site panel.
    expect(migratePanelId("head")).toBe("site");
    expect(migratePanelId("page")).toBe("site");
    expect(migratePanelId("imports")).toBe("packages");
  });

  test("passes a current id through", () => {
    expect(migratePanelId("layers")).toBe("layers");
    expect(migratePanelId("packages")).toBe("packages");
  });

  test("returns null for anything else, so the caller chooses the fallback", () => {
    expect(migratePanelId("bogus")).toBeNull();
    expect(migratePanelId(null)).toBeNull();
    expect(migratePanelId(7)).toBeNull();
  });

  test('a persisted leftTab of "problems" lands on the default, not in a wedged shell', () => {
    // Problems moved to the Bottom dock (§16.3), so a build from before it could have persisted an
    // Id the Navigator can no longer show. There is no alias to add — it is not a Navigator panel
    // Under any name — so it migrates to nothing and the boot path's `?? DEFAULT_PANEL_ID` runs.
    expect(migratePanelId("problems")).toBeNull();
    expect(migratePanelId("problems") ?? DEFAULT_PANEL_ID).toBe(DEFAULT_PANEL_ID);
    expect(NAVIGATOR_PANEL_IDS).not.toContain<string>("problems");
  });
});
