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
import { hintOf } from "./kit-readers";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mountCanvasStage } from "../src/surfaces/canvas-stage";
import type { CanvasStageHandle, CanvasStageView } from "../src/surfaces/canvas-stage";
import type { CanvasSurface } from "../src/canvas/canvas-surface";
import type { CanvasPanelEntry } from "../src/canvas/canvas-utils";
import type { JxMutableNode } from "@jxsuite/schema/types";
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

/* The specimen answers read component files and usages; the panel only needs to hand them on. */
let specimenAnswers = new Map<string, { kind: "none" }>();
let specimenGate: Promise<void> = Promise.resolve();
void mock.module("../src/style/stylebook-specimens", () => ({
  loadStylebookSpecimens: async () => {
    await specimenGate;
    return specimenAnswers;
  },
}));

const { renderStylebookMode, selectStylebookTag, stylebookBoards } =
  await import("../src/panels/stylebook-panel");
const { bindCanvasPanels, canvasPanelEntry } = await import("../src/canvas/canvas-utils");
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

const panelEntryCalls: unknown[][] = [];
/** The singleton hosts the stage announced on the last draw, by part. */
const stageHosts = new Map<string, HTMLElement>();
/** The stage standing in the pane, so a second draw does not leave the first one running. */
let standingStage: CanvasStageHandle | null = null;

/* The two geometry helpers stay mocks — this suite is about the catalogue, not the pan maths — but
   the ARTBOARDS are real now, drawn by `surfaces/canvas-stage.json` through the same seam
   `canvas-render.ts` uses. A hand-rolled `{ element, canvas }` pair would no longer prove anything:
   the whole point of the conversion is that the boards come from the stage document. */
const applyTransform = mock((_surface: CanvasSurface) => {});
const observeCenterUntilStable = mock((_surface: CanvasSurface) => {});
const updateActivePanelHeaders = mock((_surface: CanvasSurface) => {});
const ctx: Parameters<typeof renderStylebookMode>[1] = {
  applyTransform,
  canvasPanelEntry: (
    mediaName: string | null,
    label: string | null,
    fullWidth: boolean,
    width?: number | null,
  ) => {
    panelEntryCalls.push([mediaName, label, fullWidth, width]);
    return canvasPanelEntry(mediaName, label, fullWidth, width ?? null);
  },
  drawStage: async (surface: CanvasSurface, view: CanvasStageView, entries: CanvasPanelEntry[]) => {
    standingStage?.dispose();
    stageHosts.clear();
    const handle = mountCanvasStage(surface.wrap, view, {
      host: (part, element) => stageHosts.set(part, element),
      pickPanel: () => {},
    });
    standingStage = handle;
    await handle.ready;
    bindCanvasPanels(entries, handle);
    return handle;
  },
  observeCenterUntilStable,
  stageHost: (_surface: CanvasSurface, part: string) => stageHosts.get(part) ?? null,
  updateActivePanelHeaders,
};

function makeTab(doc: JxMutableNode = {}) {
  return resetWorkspaceWithTab({ children: [], tagName: "div", ...doc });
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
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("no control in the chrome bar's filter field");
  }
  return el;
}

/** The Customized toggle's own control, drawn by `jx-action-button`. */
function customizedControl(): HTMLButtonElement {
  const el = chromeBar().querySelector('[part="customized"] [part="control"]');
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("no control in the chrome bar's Customized toggle");
  }
  return el;
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
  standingStage?.dispose();
  standingStage = null;
  stageHosts.clear();
  panelEntryCalls.length = 0;
  mounts.length = 0;
  pans.length = 0;
  stage.renderGeneration = 7;
  for (const fn of [applyTransform, observeCenterUntilStable, updateActivePanelHeaders]) {
    fn.mockClear();
  }
});

afterEach(() => {
  closeAllTabs();
  document.body.innerHTML = "";
});

// ─── renderStylebookMode ──────────────────────────────────────────────────────

describe("renderStylebookMode", () => {
  test("no $media → one full-width panel mounting the generated doc", async () => {
    makeTab();
    await renderStylebookMode(stage, ctx);
    expect(panelEntryCalls).toEqual([[null, null, true, undefined]]);
    expect(canvasPanels).toHaveLength(1);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.gen).toBe(7);
    expect(mounts[0]!.widthPx).toBeNull();
    expect(mounts[0]!.canvasEl).toBe(canvasPanels[0]!.canvas);
    // The generated specimen doc reached the mount intact (sb-root + path maps).
    expect(mounts[0]!.generated.doc.attributes?.class).toBe("sb-root");
    expect(mounts[0]!.generated.tagToCardPath.has("h1")).toBe(true);
    expect(applyTransform).toHaveBeenCalled();
    expect(observeCenterUntilStable).toHaveBeenCalled();
  });

  /* Four artboards fitted into one pane put a 1280px sheet at 24%, where no specimen can be read.
     The sheet is ONE board, at the breakpoint the Context bar's size switcher names. */
  test("$media breakpoints → one board, at the active breakpoint, else the base", async () => {
    const tab = makeTab({ $media: { "--": "320px", md: "(min-width: 768px)" } });
    await renderStylebookMode(stage, ctx);
    expect(canvasPanels.map((panel) => panel.mediaName)).toEqual(["base"]);
    expect(mounts).toHaveLength(1);
    expect(updateActivePanelHeaders).toHaveBeenCalled();

    canvasPanels.length = 0;
    mounts.length = 0;
    tab.session.ui.activeMedia = "md";
    await renderStylebookMode(stage, ctx);
    expect(canvasPanels.map((panel) => panel.mediaName)).toEqual(["md"]);
    expect(mounts[0]!.widthPx).toBe(768);
  });

  test("component cards are drawn with the specimens the registry's components answer", async () => {
    makeTab();
    componentRegistry.push({ path: "components/x-card.json", tagName: "x-card" });
    specimenAnswers = new Map([["x-card", { kind: "none" }]]);
    try {
      await renderStylebookMode(stage, ctx);
      const doc = JSON.stringify(mounts[0]!.generated.doc);
      // `none` is the placeholder box, never a live instance that would throw.
      expect(doc).toContain("sb-fallback");
      expect(doc).not.toContain('"tagName":"x-card"');
    } finally {
      specimenAnswers = new Map();
    }
  });

  test("a render superseded while specimens are asked mounts nothing", async () => {
    makeTab();
    let open = (): void => {};
    specimenGate = new Promise((resolve) => {
      open = resolve;
    });
    try {
      const pending = renderStylebookMode(stage, ctx);
      await flush();
      stage.renderGeneration = 8;
      open();
      await pending;
      expect(mounts).toHaveLength(0);
    } finally {
      specimenGate = Promise.resolve();
    }
  });

  test("stylebookBoards keeps the named board, falls back to the first, and never empties", () => {
    const boards = [{ name: "base" }, { name: "md" }, { name: "sm" }];
    expect(stylebookBoards(boards, null)).toEqual([{ name: "base" }]);
    expect(stylebookBoards(boards, "sm")).toEqual([{ name: "sm" }]);
    expect(stylebookBoards(boards, "gone")).toEqual([{ name: "base" }]);
    expect(stylebookBoards([], "md")).toEqual([]);
  });

  test("the chrome bar filter narrows the generated doc; Customized toggles the session flag", async () => {
    makeTab();
    shell.stylebook.filter = "h1";
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(mounts[0]!.generated.tagToCardPath.has("h1")).toBe(true);
    expect(mounts[0]!.generated.tagToCardPath.has("ul")).toBe(false);

    customizedControl().click();
    await flush();
    expect(shell.stylebook.customizedOnly).toBe(true);
    /* The click is what the READER does; the render is what the app does next — `studio.ts`
       subscribes the canvas to this flag. Recording it here is what keeps the element's own
       pressed state and the scope that projects it from parting. */
    await renderStylebookMode(stage, ctx);
    await flush();

    const input = filterControl();
    input.value = "table";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(shell.stylebook.filter).toBe("table");
  });

  test("the chrome bar's two controls name themselves, and the toggle states which way it is", async () => {
    /* No unlabelled control (studio-ui-guidelines.md §12.3). Both names are spelled from
       PROJECT_STYLES_TITLE, so the surface has one name and not one per control. The wire value
       must never surface here. */
    makeTab();
    shell.stylebook.customizedOnly = false;
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar().getAttribute("role")).toBe("toolbar");
    expect(chromeBar().getAttribute("aria-label")).toBe(PROJECT_STYLES_TITLE);

    const inputLabel = filterControl().getAttribute("aria-label");
    expect(inputLabel).toBe(`Filter the ${PROJECT_STYLES_TITLE} catalogue`);
    expect(inputLabel).not.toContain(PROJECT_STYLES_VIEW);

    const toggle = customizedControl();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Customized");
    // Its hint is the tip the enabled kit button renders, not a title (ui.md §5.1).
    expect(hintOf(toggle)).toBeTruthy();
    toggle.click();
    await flush();
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(customizedControl().getAttribute("aria-pressed")).toBe("true");
  });

  test("the bar is a document: it emits no class, and one node survives every rebuild", async () => {
    /* The stage is rebuilt on every filter keystroke — that is what narrows the catalogue — so the
       bar must be the same element afterwards or the field loses the caret that caused it. */
    makeTab();
    await renderStylebookMode(stage, ctx);
    await flush();
    const bar = chromeBar();
    expect([...bar.querySelectorAll("[class]")]).toEqual([]);
    expect(bar.getAttribute("class")).toBeNull();

    shell.stylebook.filter = "table";
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar()).toBe(bar);
    expect(filterControl().value).toBe("table");
  });

  test("a bar taken out of its own host is mounted again on the next render", async () => {
    /* The one case an assignment cannot answer. The host belongs to this module and lit only ever
       moves it, so this is the belt-and-braces path — and the surface that stops answering is one
       nothing else in the app would ever report. */
    makeTab();
    await renderStylebookMode(stage, ctx);
    await flush();
    chromeBar().remove();
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar().getAttribute("role")).toBe("toolbar");
    expect(document.querySelectorAll('[part="chrome"]')).toHaveLength(1);
  });
});

// ─── The chrome bar IS the kit's toolbar ──────────────────────────────────────

describe("the Project Styles chrome bar", () => {
  /** Every control the toolbar roves, paired with the roving `tabindex` a Tab would land on. */
  const stops = () =>
    [...chromeBar().querySelectorAll<HTMLElement>('[part="control"], [part="input"]')].flatMap(
      (el) => (el.closest('[part="clear"]') === null ? [el.getAttribute("tabindex")] : []),
    );

  test("the role and the name are the element's, and two controls are ONE tab stop", async () => {
    /* The bar wrote `role="toolbar"` and its own `aria-label` on a `<div>` — a container role with
       none of the behaviour a reader is promised by it: two controls, two tab stops, no arrow key
       between them. `jx-action-group` was not available as the fix, because the first control in
       this bar is a `jx-textfield` and that element roves `jx-action-button` alone. */
    makeTab();
    await renderStylebookMode(stage, ctx);
    await flush();
    expect(chromeBar().localName).toBe("jx-toolbar");
    expect(chromeBar().getAttribute("role")).toBe("toolbar");
    expect(chromeBar().getAttribute("aria-orientation")).toBe("horizontal");
    /* The name still comes from the surface's own TITLE rather than the canvas view's wire word,
       which is the one thing this document's own description asks of every string in it. It moved
       from a hand-written `aria-label` binding to the element's `label` prop, and a prop that never
       arrived would leave the container announced by its role alone with nothing to say so. */
    const name = chromeBar().getAttribute("aria-label") ?? "";
    expect(name).not.toBe("");
    expect(name).not.toBe("stylebook");
    expect(stops()).toEqual(["0", "-1"]);
  });

  test("the band still positions itself, and the row's flex layout now comes from the element", async () => {
    /* The root's own `position: absolute` is load-bearing — the host it mounts into is
       `display: contents` precisely so the bar can place itself — and a kit element as a document
       ROOT keeps its host's style object, which is what makes that legal. What it no longer
       declares is the flex row: that left with the div and arrives from `jx-toolbar`. */
    makeTab();
    await renderStylebookMode(stage, ctx);
    await flush();
    const computed = getComputedStyle(chromeBar());
    expect(computed.position).toBe("absolute");
    expect(computed.display).toBe("flex");
    expect(computed.alignItems).toBe("center");
  });

  test("an arrow moves between the field and the toggle, and the field keeps it until its caret runs out", async () => {
    makeTab();
    await renderStylebookMode(stage, ctx);
    await flush();
    const input = filterControl();
    input.value = "he";
    input.setSelectionRange(1, 1);
    input.focus();
    const held = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    input.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    input.setSelectionRange(2, 2);
    const out = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    input.dispatchEvent(out);
    expect(out.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(customizedControl());
    // And back again, from the start of the field's own text.
    const back = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowLeft",
    });
    customizedControl().dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});

// ─── selectStylebookTag ───────────────────────────────────────────────────────

describe("selectStylebookTag", () => {
  test("writes the stylebook selection session state and clears the document selection", () => {
    const tab = makeTab();
    tab.session.selection = [["children", 0]];
    selectStylebookTag("table th", "md");
    expect(shell.stylebook.selection).toBe("table th");
    expect(tab.session.ui.activeSelector).toBe("table th");
    expect(tab.session.ui.rightTab).toBe("style");
    expect(tab.session.ui.activeMedia).toBe("md");
    // No document path names a specimen, so none is selected: not the root, which every reader
    // Of the document selection would have named as the catalogue's `div`.
    expect(tab.session.selection).toEqual([]);
  });

  test("the session is written before the stylebook selection moves", async () => {
    // The Style panel rebuilds synchronously when `shell.stylebook.selection` changes, so whatever
    // Watches it must already find the tab's session cleared and its selector in place.
    const { effect, effectScope } = await import("../src/reactivity");
    const tab = makeTab();
    tab.session.selection = [["children", 0]];
    const seen: string[] = [];
    const scope = effectScope();
    scope.run(() => {
      effect(() => {
        if (shell.stylebook.selection === "h1") {
          seen.push(`${JSON.stringify(tab.session.selection)} ${tab.session.ui.activeSelector}`);
        }
      });
    });
    selectStylebookTag("h1");
    scope.stop();
    expect(seen).toEqual(["[] h1"]);
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
