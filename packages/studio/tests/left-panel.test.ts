/**
 * Left panel orchestrator — mount/unmount lifecycle, per-tab routing (files/git/blocks/layers/
 * imports/state/data/head), the content-mode head applyMutation bridge, and error recovery.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html } from "lit-html";
import { mount, render, unmount } from "../src/panels/left-panel";
import { initShellRefs, leftPanel } from "../src/store";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { mountSignalsPanel } from "../src/panels/signals-panel";
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
  document.body.innerHTML = "";
});

describe("left panel — project-level tabs", () => {
  /* `afterRender` no longer wires the keyboard: the tree's keydown is a `@keydown` binding in
     files.ts's own template, so there is nothing for the panel host to hand it. Drag-and-drop still
     needs the pass, because pragmatic-dnd registers against real row elements. */
  test("files tab renders the file tree and wires DnD", async () => {
    shell.leftTab = "files";
    await mountWith();
    expect(leftPanel.querySelector("#files-rendered")).not.toBeNull();
    expect(ctx.registerFileTreeDnD).toHaveBeenCalled();
  });

  /* Source Control is a Jx document (`surfaces/git-panel.json`) mounted by the record's own
     `afterRender`, so the panel is no longer drawn through `deps.renderGitPanel` and there is no
     `#git-rendered` to find. What the Navigator still owes it is the HOST: the `.panel-body` with
     its region and the `.panel-content` the document goes into. */
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
    expect(leftPanel.querySelector(".layers-tree")).not.toBeNull();
    expect(leftPanel.querySelectorAll(".layer-row").length).toBeGreaterThan(0);
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
      expect(scrolled.some((el) => el.classList.contains("layer-row"))).toBe(true);
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
    expect(leftPanel.querySelector(".layers-tree")).toBeNull();
    expect(leftPanel.querySelectorAll(".layer-row")).toHaveLength(0);
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
    const body = leftPanel.querySelector(".panel-body") as HTMLElement;
    expect(body.querySelector(".empty-state-message")?.textContent).toBe(
      'No Navigator panel is registered as "state".',
    );
  });

  test("an id the registry does not declare says so instead of painting a blank body", async () => {
    shell.leftTab = "bogus";
    await mountWith();
    const body = leftPanel.querySelector(".panel-body") as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.querySelector(".empty-state-message")?.textContent).toBe(
      'No Navigator panel is registered as "bogus".',
    );
  });

  test("no active tab teaches what each document tab is for instead of painting a blank body", async () => {
    closeAllTabs();
    shell.leftTab = "layers";
    await mountWith();
    const body = leftPanel.querySelector(".panel-body") as HTMLElement;
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
    expect(leftPanel.querySelector(".layer-row.selected")).toBeNull();
    activeTab.value!.session.selection = [["children", 0]];
    await flush(3);
    expect(leftPanel.querySelector(".layer-row.selected")).not.toBeNull();
  });

  test("render after unmount is a no-op", async () => {
    await mountWith();
    unmount();
    leftPanel.textContent = "";
    render();
    await flush(3);
    expect(leftPanel.querySelector(".panel-body")).toBeNull();
  });

  /* Files is the throwing fixture, because it is the project-level panel still drawn through
     `deps`: Source Control's body is a document its own `afterRender` mounts, so a `deps` renderer
     that throws is no longer on the Navigator's render path at all. */
  test("a render error is recovered by clearing lit state and retrying", async () => {
    let calls = 0;
    shell.leftTab = "files";
    await mountWith({
      renderFilesTemplate: mock(() => {
        calls += 1;
        if (calls === 1) {
          throw new Error("boom");
        }
        return html`<div id="files-recovered"></div>`;
      }),
    });
    expect(calls).toBe(2);
    expect(leftPanel.querySelector("#files-recovered")).not.toBeNull();
  });

  test("a persistent render error is swallowed without crashing", async () => {
    shell.leftTab = "files";
    await mountWith({
      renderFilesTemplate: mock(() => {
        throw new Error("always");
      }),
    });
    expect(leftPanel.querySelector("#files-rendered")).toBeNull();
  });
});
