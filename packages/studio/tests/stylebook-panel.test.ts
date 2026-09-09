/**
 * Stylebook panel (src/panels/stylebook-panel.ts) — the iframe-era orchestrator: builds one
 * specimen doc, one panel per breakpoint, and mounts each through the (mocked) iframe host.
 * Selection is session-state only; overlay drawing/measurement lives in the host.
 */
import {
  flush,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
  standUpPaneGrid,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html } from "lit-html";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { CanvasPanel } from "../src/types";
import { resetProjectShell, shell } from "../src/shell";
import { PROJECT_STYLES_TITLE, PROJECT_STYLES_VIEW } from "../src/style/project-styles";
import { surfaceForPane } from "../src/canvas/surface-registry";

// ─── iframe-host mock (captures stylebook mounts + pans) ────────────────────────

interface MountCall {
  gen: number;
  generated: {
    doc: JxMutableNode;
    pathToTag: ReadonlyMap<string, string>;
    tagToCardPath: ReadonlyMap<string, (string | number)[]>;
  };
  canvasEl: HTMLElement;
  widthPx: number | null;
}
const mounts: MountCall[] = [];
const pans: string[] = [];

void mock.module("../src/canvas/iframe-host", () => ({
  mountStylebookCanvas: (
    gen: number,
    generated: MountCall["generated"],
    canvasEl: HTMLElement,
    widthPx: number | null,
  ) => {
    mounts.push({ canvasEl, gen, generated, widthPx });
  },
  panToStylebookTag: (tag: string) => {
    pans.push(tag);
  },
}));

const { renderStylebookMode, selectStylebookTag } = await import("../src/panels/stylebook-panel");
const { initShellRefs } = await import("../src/store");
const { activeCanvasSurface } = await import("../src/canvas/canvas-surface");
/* Panels belong to a pane's stage now (`src/canvas/canvas-surface.ts`), not to the app. */
const canvasPanels = activeCanvasSurface().panels;
const { componentRegistry } = await import("../src/files/components");
const { closeAllTabs } = await import("../src/workspace/workspace");

// ─── Shell + panel scaffolding ────────────────────────────────────────────────

function setupShell() {
  document.body.innerHTML = "";
  for (const id of ["activity-bar", "left-panel", "right-panel", "toolbar", "statusbar"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  initShellRefs();
  registerPrimaryStage();
  stage = standUpPaneGrid();
}

/** The primary pane's stage, stood up by {@link setupShell}. */
let stage = surfaceForPane("primary");

const panelTemplateCalls: unknown[][] = [];
const ctx = {
  applyTransform: mock(() => {}),
  canvasPanelTemplate: (
    mediaName: string | null,
    label: string | null,
    fullWidth: boolean,
    width?: number | null,
  ) => {
    panelTemplateCalls.push([mediaName, label, fullWidth, width]);
    const element = document.createElement("div");
    const canvas = document.createElement("div");
    element.append(canvas);
    const panel = {
      _width: width ?? null,
      canvas,
      element,
      mediaName,
    } as unknown as CanvasPanel;
    return { panel, tpl: html`${element}` };
  },
  observeCenterUntilStable: mock(() => {}),
  updateActivePanelHeaders: mock(() => {}),
} as Parameters<typeof renderStylebookMode>[1];

const ctxMocks = ctx as unknown as Record<string, ReturnType<typeof mock>>;

function makeTab(doc: Record<string, unknown> = {}) {
  return resetWorkspaceWithTab({ children: [], tagName: "div", ...doc } as JxMutableNode);
}

// ─── The chrome bar, which is a document ──────────────────────────────────────

/** The bar itself — addressed by `part`, because it carries no class of its own. */
function chromeBar(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[part="chrome"]');
  if (!el) {
    throw new Error("the Project Styles chrome bar is not mounted");
  }
  return el;
}

/** The filter field's own control, a native input drawn by `jx-textfield`. */
function filterControl(): HTMLInputElement {
  const el = chromeBar().querySelector('[part="filter"] [part="input"]');
  if (!el) {
    throw new Error("no control in the chrome bar's filter field");
  }
  return el as HTMLInputElement;
}

/** The Customized toggle's own control, drawn by `jx-action-button`. */
function customizedControl(): HTMLButtonElement {
  const el = chromeBar().querySelector('[part="customized"] [part="control"]');
  if (!el) {
    throw new Error("no control in the chrome bar's Customized toggle");
  }
  return el as HTMLButtonElement;
}

beforeEach(() => {
  setupShell();
  resetStudioState();
  /* The chrome bar is a standing DOCUMENT keyed on the pane's surface, and the surface record
     outlives a test — so the shell it projects has to be put back too, or one test's Customized
     leaks into the next as a control that says pressed while the shell says otherwise. */
  resetProjectShell();
  canvasPanels.length = 0;
  componentRegistry.length = 0;
  panelTemplateCalls.length = 0;
  mounts.length = 0;
  pans.length = 0;
  stage.renderGeneration = 7;
  for (const key of ["applyTransform", "observeCenterUntilStable", "updateActivePanelHeaders"]) {
    ctxMocks[key]!.mockClear();
  }
});

afterEach(() => {
  closeAllTabs();
  document.body.innerHTML = "";
});

// ─── renderStylebookMode ──────────────────────────────────────────────────────

describe("renderStylebookMode", () => {
  test("no $media → one full-width panel mounting the generated doc", () => {
    makeTab();
    renderStylebookMode(stage, ctx);
    expect(panelTemplateCalls).toEqual([[null, null, true, undefined]]);
    expect(canvasPanels).toHaveLength(1);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.gen).toBe(7);
    expect(mounts[0]!.widthPx).toBeNull();
    expect(mounts[0]!.canvasEl).toBe(canvasPanels[0]!.canvas as HTMLElement);
    // The generated specimen doc reached the mount intact (sb-root + path maps).
    expect((mounts[0]!.generated.doc.attributes as Record<string, string>).class).toBe("sb-root");
    expect(mounts[0]!.generated.tagToCardPath.has("h1")).toBe(true);
    expect(ctxMocks.applyTransform).toHaveBeenCalled();
    expect(ctxMocks.observeCenterUntilStable).toHaveBeenCalled();
  });

  test("$media breakpoints → base + one panel per breakpoint, SAME generated doc for all", () => {
    makeTab({ $media: { "--": "320px", md: "(min-width: 768px)" } });
    renderStylebookMode(stage, ctx);
    expect(canvasPanels.map((panel) => panel.mediaName)).toEqual(["base", "md"]);
    expect(mounts).toHaveLength(2);
    expect(mounts[0]!.generated).toBe(mounts[1]!.generated);
    expect(mounts[1]!.widthPx).toBe(768);
    expect(ctxMocks.updateActivePanelHeaders).toHaveBeenCalled();
  });

  test("the chrome bar filter narrows the generated doc; Customized toggles the session flag", async () => {
    makeTab();
    shell.stylebook.filter = "h1";
    renderStylebookMode(stage, ctx);
    await flush();
    expect(mounts[0]!.generated.tagToCardPath.has("h1")).toBe(true);
    expect(mounts[0]!.generated.tagToCardPath.has("ul")).toBe(false);

    customizedControl().click();
    await flush();
    expect(shell.stylebook.customizedOnly).toBe(true);
    /* The click is what the READER does; the render is what the app does next — `studio.ts`
       subscribes the canvas to this flag. Recording it here is what keeps the element's own
       pressed state and the scope that projects it from parting. */
    renderStylebookMode(stage, ctx);
    await flush();

    const input = filterControl();
    input.value = "table";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(shell.stylebook.filter).toBe("table");
  });

  test("the chrome bar's two controls name themselves, and the toggle states which way it is", async () => {
    /* §2 principle 6: no unlabelled control. Both names are spelled from PROJECT_STYLES_TITLE, so
       the surface has one name and not one per control. The wire value must never surface here. */
    makeTab();
    shell.stylebook.customizedOnly = false;
    renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar().getAttribute("role")).toBe("toolbar");
    expect(chromeBar().getAttribute("aria-label")).toBe(PROJECT_STYLES_TITLE);

    const input = filterControl();
    expect(input.getAttribute("aria-label")).toBe(`Filter the ${PROJECT_STYLES_TITLE} catalogue`);
    expect(input.getAttribute("aria-label")).not.toContain(PROJECT_STYLES_VIEW);

    const toggle = customizedControl();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Customized");
    expect(toggle.getAttribute("title")).toBeTruthy();
    toggle.click();
    await flush();
    renderStylebookMode(stage, ctx);
    await flush();
    expect(customizedControl().getAttribute("aria-pressed")).toBe("true");
  });

  test("the bar is a document: it emits no class, and one node survives every rebuild", async () => {
    /* The stage is rebuilt on every filter keystroke — that is what narrows the catalogue — so the
       bar must be the same element afterwards or the field loses the caret that caused it. */
    makeTab();
    renderStylebookMode(stage, ctx);
    await flush();
    const bar = chromeBar();
    expect([...bar.querySelectorAll("[class]")]).toEqual([]);
    expect(bar.getAttribute("class")).toBeNull();

    shell.stylebook.filter = "table";
    renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar()).toBe(bar);
    expect(filterControl().value).toBe("table");
  });

  test("a bar taken out of its own host is mounted again on the next render", async () => {
    /* The one case an assignment cannot answer. The host belongs to this module and lit only ever
       moves it, so this is the belt-and-braces path — and the surface that stops answering is one
       nothing else in the app would ever report. */
    makeTab();
    renderStylebookMode(stage, ctx);
    await flush();
    chromeBar().remove();
    renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar().getAttribute("role")).toBe("toolbar");
    expect(document.querySelectorAll('[part="chrome"]')).toHaveLength(1);
  });
});

// ─── selectStylebookTag ───────────────────────────────────────────────────────

describe("selectStylebookTag", () => {
  test("writes the stylebook selection session state (selection stays a path-empty [])", () => {
    const tab = makeTab();
    selectStylebookTag("table th", "md");
    expect(shell.stylebook.selection).toBe("table th");
    expect(tab.session.ui.activeSelector).toBe("table th");
    expect(tab.session.ui.rightTab).toBe("style");
    expect(tab.session.ui.activeMedia).toBe("md");
    expect(tab.session.selection).toEqual([[]]);
  });

  test("omitting media leaves the current breakpoint context untouched", () => {
    const tab = makeTab();
    tab.session.ui.activeMedia = "md";
    selectStylebookTag("p");
    expect(tab.session.ui.activeMedia).toBe("md");
  });

  test("panCanvas routes to the host's pan-to-card (measured over the bridge)", () => {
    makeTab();
    selectStylebookTag("h1", null, { panCanvas: true });
    expect(pans).toEqual(["h1"]);
    selectStylebookTag("p");
    expect(pans).toEqual(["h1"]); // No pan without the flag.
  });
});
