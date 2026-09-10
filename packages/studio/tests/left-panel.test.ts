/**
 * Left panel orchestrator — mount/unmount lifecycle, per-tab routing (files/git/blocks/layers/
 * imports/state/data/head), the content-mode head applyMutation bridge, and error recovery.
 *
 * The dock's own box is `src/surfaces/navigator-dock.json` now, so the host is addressed by `part`
 * and by the region grammar rather than by `.panel-body` / `.panel-content`. The panel BODIES are
 * still lit — a `PanelRecord`'s `render` returns a template — so every selector that belongs to a
 * panel rather than to the Navigator is untouched, which is the line this file is drawn along.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html } from "lit-html";
import type { TemplateResult } from "lit-html";
import { mount, render, unmount } from "../src/panels/left-panel";
import { initShellRefs, leftPanel } from "../src/store";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { mountSignalsPanel } from "../src/panels/signals-panel";
import { registerPanel, resetPanels } from "../src/panels/panel-registry";
import { view } from "../src/view";
import { shell } from "../src/shell";

let ctx: Record<string, any>;
let captured: { head: any; imports: any; git: any[] };

function makeCtx(overrides: Record<string, unknown> = {}) {
  captured = { git: [], head: null, imports: null };
  return {
    cloneRepository: mock(() => {}),
    defaultDef: (tag: string) => ({ tagName: tag }),
    defBadgeLabel: () => "badge",
    defCategory: () => "cat",
    getCanvasMode: mock(() => "design"),
    navigateToComponent: mock(() => {}),
    registerComponentsDnD: mock(() => {}),
    registerElementsDnD: mock(() => {}),
    registerFileTreeDnD: mock(() => {}),
    registerLayersDnD: mock(() => {}),
    // The Data panel's one verb that is not a repaint: it re-fires automatic `Request` entries,
    // And its presence is what puts the Refresh button on screen.
    refreshData: mock(() => {}),
    renderCanvas: mock(() => {}),
    renderFilesTemplate: mock(() => html`<div class="file-tree" id="files-rendered"></div>`),
    renderGitPanel: mock((...args: unknown[]) => {
      captured.git = args;
      return html`<div id="git-rendered"></div>`;
    }),
    // The REAL mount: the Data panel is a document, and the assertion below is that what the
    // Navigator hands it reaches the drawn rows.
    mountSignalsPanel,
    renderHeadTemplate: mock((opts: unknown) => {
      captured.head = opts;
      return html`<div id="head-rendered"></div>`;
    }),
    renderImportsTemplate: mock((opts: unknown) => {
      captured.imports = opts;
      return html`<div id="imports-rendered"></div>`;
    }),
    setCanvasMode: mock(() => {}),
    setGitDiffState: mock(() => {}),
    webdata: { elements: { Text: [{ tag: "p" }] } },
    ...overrides,
  };
}

async function mountWith(overrides: Record<string, unknown> = {}) {
  ctx = makeCtx(overrides);
  mount(ctx as never);
  await flush(3);
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="canvas-wrap"></div>
    <div id="activity-bar"></div>
    <div id="left-panel"></div>
    <div id="right-panel"></div>
    <div id="toolbar"></div>
    <div id="statusbar"></div>
  `;
  initShellRefs();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  shell.leftTab = "layers";
  /* Source Control is a Jx document mounted by its own `afterRender` rather than a lit body drawn
     through `deps`, so the real panel runs here and asks the platform what the working tree says.
     Without one registered, `getPlatform()` throws inside the Navigator's render. */
  installMockPlatform();
  view.dndCleanups = [];
  view._layersCollapsed = new Set();
  resetStudioState();
  resetWorkspaceWithTab({
    children: [{ tagName: "p", textContent: "Hello" }],
    tagName: "div",
  });
});

afterEach(() => {
  unmount();
  closeAllTabs();
  // The registry is module state, and two tests register a panel of their own into it.
  resetPanels();
  document.body.innerHTML = "";
});

describe("left panel — project-level tabs", () => {
  /* Files is a Jx document too (`surfaces/files-panel.json`), mounted by the record's own
     `afterRender` — so there is no injected `renderFilesTemplate` left to capture and no DnD pass
     for the host to run. What belongs HERE is that the tab routes to the panel at all, and that the
     panel's document went into the box this dock drew for it. */
  test("files tab mounts the Files document into the Navigator's own box", async () => {
    /* The Files panel reads the project state directly (it is `level: "project"`), so the fixture
       has to be a project rather than the bare shape the other tabs get. */
    resetStudioState({ dirs: new Map([[".", []]]), searchQuery: "" });
    shell.leftTab = "files";
    await mountWith();
    await flush(4);
    const body = leftPanel.querySelector<HTMLElement>('[part="panel-body"]');
    expect(body?.dataset.panel).toBe("files");
    expect(body?.querySelector('[part="content"] [part="files"]')).not.toBeNull();
  });

  /* Source Control is a Jx document (`surfaces/git-panel.json`) mounted by the record's own
     `afterRender`, so the panel is no longer drawn through `deps.renderGitPanel` and there is no
     `#git-rendered` to find. What the Navigator still owes it is the HOST: the `[part="panel-body"]`
     carrying its region, and the `[part="content"]` box the document goes into. */
  function seedRepo() {
    shell.git.branches = { branches: ["main"], current: "main" } as never;
    shell.git.status = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: ["origin"],
    } as never;
  }

  test("git tab mounts the Source Control document, and not the deps renderer", async () => {
    seedRepo();
    shell.leftTab = "git";
    await mountWith();
    await flush(4);
    expect(leftPanel.querySelector('[part="git-panel"]')).not.toBeNull();
    expect(captured.git).toEqual([]);
    /* And the box it went into is the one the Navigator's own document drew, addressable as this
       panel's region — which is the seam, and the thing a stale selector used to photograph. */
    expect(leftPanel.querySelector<HTMLElement>('[part="panel-body"]')?.dataset.jxRegion).toBe(
      "navigator/panel:git",
    );
  });

  test("git tab renders with no active tab — Source Control is project level", async () => {
    seedRepo();
    closeAllTabs();
    shell.leftTab = "git";
    await mountWith();
    await flush(4);
    expect(leftPanel.querySelector('[part="git-panel"]')).not.toBeNull();
  });

  test("project-level source-control changes reach the panel with no tab open", async () => {
    /* The panel used to be repainted by hand from inside git-panel (`renderOnly("leftPanel")` after
       every write), and then by the Navigator's own repaint. Both are gone: the mounted document
       owns an effect over the same `shell.git` fields, so the sub-tab moving is enough. */
    seedRepo();
    closeAllTabs();
    shell.leftTab = "git";
    await mountWith();
    await flush(4);
    expect(leftPanel.querySelector('[part="commit"]')).not.toBeNull();

    shell.git.subTab = "history";
    await flush(4);
    expect(leftPanel.querySelector('[part="commit"]')).toBeNull();
    expect(leftPanel.querySelector('[part="history"]')).not.toBeNull();

    shell.git.logEntries = [
      { author: "a", date: "2024-01-01T00:00:00Z", hash: "abc", message: "m" },
    ];
    await flush(4);
    expect(leftPanel.querySelector('[part="history-entry"]')).not.toBeNull();
    shell.git.subTab = "changes";
  });

  test("insert panel renders the elements palette and registers DnD", async () => {
    shell.leftTab = "insert";
    await mountWith();
    expect(leftPanel.querySelector('[data-block-tag="p"]')).not.toBeNull();
    expect(ctx.registerElementsDnD).toHaveBeenCalled();
    expect(ctx.registerComponentsDnD).toHaveBeenCalled();
  });
});

describe("left panel — document tabs", () => {
  test("layers tab renders the layer tree and registers layers DnD", async () => {
    await mountWith();
    expect(leftPanel.querySelector('[part="outline"] [part="tree"]')).not.toBeNull();
    expect(leftPanel.querySelectorAll('[part="row"]').length).toBeGreaterThan(0);
    expect(ctx.registerLayersDnD).toHaveBeenCalled();
  });

  test("layers tab scrolls the selected row into view", async () => {
    activeTab.value!.session.selection = [["children", 0]];
    const scrolled: Element[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    try {
      await mountWith();
      expect(scrolled.some((el) => el.getAttribute("part") === "row")).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  test("stylebook canvas mode mounts the Project Styles catalogue instead", async () => {
    /* One panel, two bodies, and only the tree is lit's. The catalogue is
       `surfaces/panel-stylebook-layers.json` and is addressed by `part`; what belongs HERE is that
       this canvas mode reaches it at all, and that the tree's own branch stays out of the way.
       What the catalogue contains is `tests/stylebook-layers-panel.test.ts`. */
    await mountWith({ getCanvasMode: () => "stylebook" });
    await flush(4);
    expect(leftPanel.querySelectorAll('[part="row"]').length).toBeGreaterThan(0);
    expect(leftPanel.querySelector('[part="outline"]')).toBeNull();
    expect(ctx.registerLayersDnD).not.toHaveBeenCalled();
  });

  test("the packages tab routes to the Packages panel, which mounts its own document", async () => {
    /* This file is the ORCHESTRATOR's test: which panel a tab routes to. The panel used to be drawn
       through an injected `renderImportsTemplate`, so the injection was also where its context
       could be inspected — the panel is `surfaces/panel-imports.json` now and returns `nothing`,
       so there is no template to capture. What that assertion was really about, the document's
       `$elements` and a transact-backed `applyMutation` reaching the panel, is tested against the
       panel itself in `tests/imports-panel.test.ts`; what belongs here is that this tab reaches
       this panel at all. */
    activeTab.value!.doc.document.$elements = ["@acme/widgets"] as never;
    shell.leftTab = "packages";
    await mountWith();
    await flush(4);
    // Reader-visible, so it stays true whatever the document's internal part names become.
    expect((leftPanel.textContent ?? "").replaceAll(/\s+/g, " ")).toContain(
      "Components you add here can be dropped onto this page",
    );
    expect(leftPanel.querySelector("#imports-rendered")).toBeNull();
  });

  test("the data tab draws ONE panel over the whole tab", async () => {
    /*
     * `state` and `data` were two tabs calling two templates with two slices of the same tab: one
     * got a document snapshot, the other got `document.state` and `canvas.scope` separately. One
     * panel takes the tab record itself, so the definition and the value it resolved to cannot come
     * from different reads — which is what a row carrying BOTH its badge and its resolved type is
     * evidence of.
     *
     * It is drawn as a document (`surfaces/panel-signals.json`), so lit renders nothing here and
     * the assertion is against the mounted DOM rather than against an injected stub.
     */
    activeTab.value!.doc.document.state = { count: { default: 0 } } as never;
    activeTab.value!.session.canvas.scope = { count: 1 };
    shell.leftTab = "data";
    await mountWith();
    await flush(8);
    const row = leftPanel.querySelector('[part="entry"][data-signal="count"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[part="badge"]')?.textContent).toBe("S");
    const summary = row!.querySelector<HTMLElement>('[part="summary"]');
    expect(summary?.dataset["tone"]).toBe("value");
    expect(summary?.textContent).toBe("number");
    // A repaint and a refetch, and the refetch is what the Refresh button spends. `renderCanvas`
    // And `updateSession` were threaded through here until nothing in the panel read either.
    expect(leftPanel.querySelector('[part="refresh"]')).not.toBeNull();
  });

  test("there is no `state` tab left to render", async () => {
    shell.leftTab = "state";
    await mountWith();
    const body = leftPanel.querySelector('[part="panel-body"]') as HTMLElement;
    expect(body.querySelector(".empty-state-message")?.textContent).toBe(
      'No Navigator panel is registered as "state".',
    );
  });

  test("an id the registry does not declare says so instead of painting a blank body", async () => {
    shell.leftTab = "bogus";
    await mountWith();
    const body = leftPanel.querySelector('[part="panel-body"]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.querySelector(".empty-state-message")?.textContent).toBe(
      'No Navigator panel is registered as "bogus".',
    );
  });

  test("no active tab teaches what each document tab is for instead of painting a blank body", async () => {
    closeAllTabs();
    shell.leftTab = "layers";
    await mountWith();
    const body = leftPanel.querySelector('[part="panel-body"]') as HTMLElement;
    expect(body.querySelector(".empty-state-message")?.textContent).toBe(
      "Open a page to see the elements it is built from.",
    );
    expect((body.querySelector(".empty-state-action") as HTMLElement).textContent?.trim()).toBe(
      "Open a page…",
    );
    expect(ctx.registerLayersDnD).not.toHaveBeenCalled();
  });

  test("every document tab has its own no-document sentence", async () => {
    closeAllTabs();
    const seen = new Set<string>();
    for (const tabName of ["layers", "packages", "data", "page"]) {
      shell.leftTab = tabName;
      await mountWith();
      const message = leftPanel.querySelector(".empty-state-message")?.textContent ?? "";
      expect(message.startsWith("Open a page to")).toBe(true);
      seen.add(message);
      unmount();
    }
    expect(seen.size).toBe(4);
  });
});

/*
 * `describe("left panel — page panel")` lived here and read the arguments the Navigator handed a lit
 * renderer. The Page panel is a document now (`src/surfaces/panel-page.json`) and its record mounts
 * in `afterRender`, so there is no injected renderer left to capture. The four assertions moved to
 * `tests/head-panel.test.ts` — "the Page panel record" — where the same contract is read off the
 * mounted document: which document a pane's panel is drawn for, and where each commit lands. What
 * stays here is the Navigator's own routing, which is what this file is about.
 */

describe("left panel — lifecycle and recovery", () => {
  test("reactive effect re-renders on selection change", async () => {
    await mountWith();
    expect(leftPanel.querySelector('[part="row"][aria-selected="true"]')).toBeNull();
    activeTab.value!.session.selection = [["children", 0]];
    await flush(4);
    expect(leftPanel.querySelector('[part="row"][aria-selected="true"]')).not.toBeNull();
  });

  test("unmounting before the mount lands leaves nothing behind", async () => {
    /* The dock is a document and a document mounts asynchronously, so `mount(); unmount()` in one
       turn is a real sequence — a project closing under a Navigator that has only just been asked
       for. The handle that settles afterwards has to throw its own surface away rather than append
       it, or the cell keeps a panel body nobody can reach and the next mount finds two. */
    ctx = makeCtx();
    mount(ctx as never);
    unmount();
    await flush(4);
    expect(leftPanel.childNodes).toHaveLength(0);
  });

  test("render after unmount is a no-op", async () => {
    await mountWith();
    unmount();
    leftPanel.textContent = "";
    render();
    await flush(3);
    expect(leftPanel.querySelector('[part="panel-body"]')).toBeNull();
  });

  /**
   * A panel registered for this test, rather than one of the shipped eight.
   *
   * The throwing fixture used to be Files, through the `deps.renderFilesTemplate` the Navigator
   * injected — which made this test a hostage to whether that panel still takes an injected
   * renderer. What is under test is the HOST's boundary, so the fixture is a record of the test's
   * own: it throws on demand, on the render path every panel shares.
   */
  function registerThrowingPanel(body: () => TemplateResult): void {
    registerPanel({
      dock: "navigator",
      icon: "bug",
      id: "boomtown",
      level: "project",
      rail: false,
      render: body,
      title: "Boomtown",
    });
  }

  /* The recovery is a retry that clears lit's markers first, because a panel appending past lit's
     range inside the content box can take those markers with it — the box the document draws is
     fresh per panel, but nothing stops its tenant from emptying it. */
  test("a render error is recovered by clearing lit state and retrying", async () => {
    let calls = 0;
    registerThrowingPanel(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom");
      }
      return html`<div id="panel-recovered"></div>`;
    });
    shell.leftTab = "boomtown";
    await mountWith();
    expect(calls).toBe(2);
    expect(leftPanel.querySelector("#panel-recovered")).not.toBeNull();
  });

  test("a persistent render error is swallowed without crashing", async () => {
    registerThrowingPanel((): TemplateResult => {
      throw new Error("always");
    });
    shell.leftTab = "boomtown";
    await mountWith();
    // The dock still drew its own chrome: the reader can see which panel failed and leave it.
    expect(leftPanel.querySelector<HTMLElement>('[part="panel-body"]')?.dataset.panel).toBe(
      "boomtown",
    );
    expect(leftPanel.querySelector('[part="content"]')?.childElementCount).toBe(0);
  });
});
