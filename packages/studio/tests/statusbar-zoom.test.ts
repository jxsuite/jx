/**
 * The status bar's ZOOM field: the floating zoom pod's controls, re-homed at the far right of the
 * bar (studio.md §4.3, §16.2).
 *
 * What changed with the move, and what these cases pin:
 *
 * - **It reports the FOCUSED pane.** The pod was drawn once per pane; the bar is drawn once, so the
 *   field follows `workspace.activePaneId` and re-points when the other pane takes focus.
 * - **Every gesture is a command.** The slider, the stepper, the percentage and the Fit select run
 *   `canvas.setZoom`, `canvas.zoomIn`, `canvas.zoomReset` and `canvas.fitPage` through the
 *   registry, so a refusal lands in Problems and the palette has a name for each.
 * - **A double-click on the slider resets to 100%**, the long-established slider convention.
 * - **It is absent where nothing zooms** (Preview, Code, a comparison's Code half, Review changes)
 *   and Edit draws no Fit, as the pod did.
 * - **It is not read aloud**: `aria-live="off"` inside the bar's polite status region.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initShellRefs, requireShellRef, setProjectState, statusbarEl } from "../src/store";
import type { Tab } from "../src/tabs/tab";

const {
  PRIMARY_PANE,
  SECONDARY_PANE,
  activeTab,
  closeAllTabs,
  focusPane,
  openTab,
  splitRight,
  workspace,
} = await import("../src/workspace/workspace");
const { mountStatusbar, renderStatusbar, unmountStatusbar } =
  await import("../src/surfaces/statusbar");
const { unmountJumpBar } = await import("../src/panels/jump-bar");
const { resetProjectShell, shell } = await import("../src/shell");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { canvasViewCommands, getFit, hasDeclaredFit, resetFits } =
  await import("../src/canvas/canvas-utils");
const { canvasCommands } = await import("../src/editor/shortcuts");
const { canvasModeOfPane, derivationOfPane, surfaceForPane } =
  await import("../src/canvas/canvas-surface");
const { applyDerivation, noopDerivationDeps, setPaneDerivation } =
  await import("../src/workspace/pane-derive");
const { diffViewOf, resetDiffViews, setDiffView } = await import("../src/canvas/diff-view");
const { resetNotifications } = await import("../src/services/notify");
const { positionToZoom } = await import("../src/panels/zoom-control");

const bar = (): HTMLElement => requireShellRef(statusbarEl, "statusbar");
const zoomField = (): HTMLElement | null =>
  bar().querySelector('[data-jx-region="statusbar/zoom"]');
const part = (name: string): HTMLElement | null =>
  zoomField()?.querySelector<HTMLElement>(`[part="${name}"]`) ?? null;
const labelOf = (name: string): string =>
  part(name)?.querySelector('[part="label"]')?.textContent.trim() ?? "";
const slider = (): HTMLElement & { value: number } => {
  const el = part("zoom-slider");
  if (!el) {
    throw new Error("the zoom field drew no slider");
  }
  /* SAFETY: the zoom field's slider is a jx-slider, whose `value` prop is a number. */
  return el as HTMLElement & { value: number };
};
const fit = (): HTMLSelectElement | null =>
  part("zoom-fit")?.querySelector<HTMLSelectElement>("select") ?? null;

function choose(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Move the slider the way a drag does: the inner range's own `input`. */
function drag(to: number): void {
  const input = slider().querySelector<HTMLInputElement>('input[part="input"]')!;
  input.value = String(to);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The mode the tests are in: a composed registry reads it back as the focused pane's. */
function openTestTab(): Tab {
  const tab = resetWorkspaceWithTab(
    { children: [{ tagName: "p", textContent: "Hi" }], tagName: "div" },
    { documentPath: "/project/index.json", id: "zoom-tab" },
  );
  tab.capabilities.modes = ["edit", "design", "preview", "source", "stylebook", "git-diff"];
  return tab;
}

function installRegistry(): void {
  const mode = (): string => canvasModeOfPane(workspace.activePaneId);
  const registry = createCommandRegistry({
    getContext: () =>
      makeContext({
        canvas: { view: mode() === "edit" ? "edit" : "design" },
        document: { open: activeTab.value !== null },
        editor: { kind: "canvas" },
      }),
    mac: false,
  });
  registry.registerAll(
    canvasViewCommands({
      getCanvasMode: mode,
      renderPane: () => {},
      setCanvasMode: () => {},
      setOpenDialog: () => {},
      setOpenPopover: () => {},
      setResolvingOpen: () => {},
    }).filter((c) =>
      ["canvas.setZoom", "canvas.setEditZoom", "canvas.setFit", "canvas.fitPage"].includes(c.id),
    ),
  );
  registry.registerAll(
    canvasCommands(() => ({
      applyTransform: () => {},
      canvasMode: mode(),
      panX: 0,
      panY: 0,
      setPan: () => {},
    })).filter((c) => c.id.startsWith("canvas.zoom")),
  );
  setActiveRegistry(registry);
}

async function render(): Promise<void> {
  renderStatusbar();
  await flush(6);
}

beforeAll(() => {
  const el = document.createElement("div");
  el.id = "statusbar";
  document.body.append(el);
  initShellRefs();
});

beforeEach(() => {
  closeAllTabs();
  setProjectState(null);
  resetProjectShell();
  resetNotifications();
  resetStudioState();
  installMockPlatform();
  resetFits();
  installRegistry();
});

afterEach(async () => {
  unmountStatusbar();
  unmountJumpBar();
  setActiveRegistry(null);
  shell.git.diffState = null;
  resetDiffViews();
  await flush();
});

describe("the zoom field's presence", () => {
  test("sits at the far right of the bar, in its own region, and is not read aloud", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    await render();
    const field = zoomField()!;
    expect(field).not.toBeNull();
    expect(field.getAttribute("part")).toBe("zoom");
    /* `aria-live="off"`: the bar is the app's polite status region, and a percentage that changes
       on every wheel tick would otherwise be announced on every tick. */
    expect(field.getAttribute("aria-live")).toBe("off");
    expect(bar().contains(field)).toBe(true);
    // The last thing the bar draws.
    const regions = [...bar().querySelectorAll<HTMLElement>("[data-jx-region]")].map(
      (e) => e.dataset.jxRegion,
    );
    expect(regions.at(-1)).toBe("statusbar/zoom");
  });

  test("is absent with no document open", async () => {
    closeAllTabs();
    await render();
    expect(zoomField()).toBeNull();
  });

  test("Edit shows the content zoom and no Fit", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "edit";
    tab.session.ui.editZoom = 1.5;
    await render();
    expect(zoomField()).not.toBeNull();
    expect(labelOf("zoom-label")).toBe("150%");
    expect(fit()).toBeNull();
  });

  test("Design and Stylebook show zoom and Fit; Preview and Source show nothing", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    await mountAndRender();
    expect(fit()).not.toBeNull();

    tab.session.ui.canvasMode = "stylebook";
    await flush(6);
    expect(zoomField()).not.toBeNull();
    expect(fit()).not.toBeNull();

    tab.session.ui.canvasMode = "source";
    await flush(6);
    expect(zoomField()).toBeNull();

    tab.session.ui.canvasMode = "design";
    tab.session.ui.preview = true;
    await flush(6);
    expect(zoomField()).toBeNull();
  });
});

describe("the readout follows the document", () => {
  test("the label, the slider and the valuetext track the zoom reactively", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 2;
    await mountAndRender();
    expect(labelOf("zoom-label")).toBe("200%");
    expect(slider().querySelector('input[part="input"]')!.getAttribute("aria-valuetext")).toBe(
      "200%",
    );
    const at200 = slider().value;

    tab.session.ui.zoom = 0.5;
    await flush(6);
    expect(labelOf("zoom-label")).toBe("50%");
    expect(slider().value).toBeLessThan(at200);
  });

  test("100% sits where the logarithmic mapping puts it, not mid-track", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 1;
    await mountAndRender();
    expect(slider().value).toBe(65);
  });
});

/** Mount the effect (so the bar tracks state) and settle. */
async function mountAndRender(): Promise<void> {
  mountStatusbar();
  await flush(8);
}

describe("every gesture is a command", () => {
  test("the slider runs canvas.setZoom with the log-mapped scale", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 1;
    await mountAndRender();

    drag(80);
    await flush(6);
    expect(tab.session.ui.zoom).toBeCloseTo(positionToZoom(80, { max: 5, min: 0.05 }), 5);
    // The thumb the reader dragged to is the thumb that is drawn once the write comes back.
    expect(slider().value).toBe(80);
    // A zoom the author chose is their declared fit.
    expect(hasDeclaredFit()).toBe(true);
  });

  test("in Edit the slider runs canvas.setEditZoom on Edit's own range", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "edit";
    await mountAndRender();
    drag(100);
    await flush(6);
    expect(tab.session.ui.editZoom).toBe(3);
    drag(0);
    await flush(6);
    expect(tab.session.ui.editZoom).toBe(0.25);
  });

  test("a double-click on the slider resets to 100%, declaring it as the fit", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 3;
    await mountAndRender();

    const input = slider().querySelector<HTMLInputElement>('input[part="input"]')!;
    input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush(6);
    expect(getFit()).toBe(1);
    // The select repaints from the declared fit: it is a tracked input, not a first-paint read.
    expect(fit()!.value).toBe("actual");
  });

  test("in Edit a double-click puts the content zoom back to 1", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "edit";
    tab.session.ui.editZoom = 2;
    await mountAndRender();
    slider()
      .querySelector('input[part="input"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush(6);
    expect(tab.session.ui.editZoom).toBe(1);
  });

  test("− and + step by 1.2 and 100% resets, in Edit", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "edit";
    await mountAndRender();

    pointer(part("zoom-in")!, "click");
    await flush(6);
    expect(tab.session.ui.editZoom).toBeCloseTo(1.2);
    expect(labelOf("zoom-label")).toBe("120%");

    pointer(part("zoom-out")!, "click");
    await flush(6);
    expect(tab.session.ui.editZoom).toBeCloseTo(1);

    tab.session.ui.editZoom = 2;
    pointer(part("zoom-label")!, "click");
    await flush(6);
    expect(tab.session.ui.editZoom).toBe(1);
  });

  test("design mode: − and + drive ui.zoom and declare each step as the document's fit", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 2;
    await mountAndRender();
    expect(hasDeclaredFit()).toBe(false);

    pointer(part("zoom-in")!, "click");
    await flush(6);
    expect(tab.session.ui.zoom).toBeCloseTo(2.4);
    expect(tab.session.ui.editZoom).toBe(1);
    expect(getFit()).toBeCloseTo(2.4, 5);

    pointer(part("zoom-out")!, "click");
    await flush(6);
    expect(tab.session.ui.zoom).toBeCloseTo(2);
  });

  test("the Fit select writes the declared fit, and the select repaints from it", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    await mountAndRender();
    expect([...fit()!.querySelectorAll("option")].map((o) => o.textContent.trim())).toEqual([
      "Fit page",
      "Fit width",
      "Actual size",
      "No fit",
    ]);

    choose(fit()!, "width");
    await flush(6);
    expect(getFit()).toBe("width");
    expect(fit()!.value).toBe("width");

    choose(fit()!, "none");
    await flush(6);
    expect(getFit()).toBe("none");
    expect(fit()!.value).toBe("none");

    choose(fit()!, "actual");
    await flush(6);
    expect(getFit()).toBe(1);

    choose(fit()!, "page");
    await flush(6);
    expect(getFit()).toBe("page");

    // A value the select does not offer is ignored rather than clearing the declared fit.
    choose(fit()!, "");
    await flush(6);
    expect(getFit()).toBe("page");
  });

  test("an author-chosen zoom shows no named fit", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 2;
    await mountAndRender();
    pointer(part("zoom-in")!, "click");
    await flush(6);
    expect(fit()!.value).toBe("");
  });

  test("with no registry published a gesture is inert rather than fatal", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 2;
    await mountAndRender();
    setActiveRegistry(null);
    expect(() => pointer(part("zoom-in")!, "click")).not.toThrow();
    drag(10);
    choose(fit()!, "width");
    await flush(4);
    expect(tab.session.ui.zoom).toBe(2);
  });

  test("the hints are read off the keymap, and name no chord Reset does not have", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    await mountAndRender();
    const hint = (name: string): string =>
      part(name)?.querySelector("jx-tooltip")?.textContent.trim() ?? "";
    expect(hint("zoom-out")).toBe("Zoom out (Ctrl+-)");
    expect(hint("zoom-in")).toBe("Zoom in (Ctrl+=)");
    // `canvas.zoomReset` has no chord; `Ctrl+0` is Focus Primary Pane.
    expect(hint("zoom-label")).toBe("Reset to 100%");
  });
});

describe("the field follows the focused pane", () => {
  function twoPanes() {
    const primary = openTestTab();
    primary.session.ui.canvasMode = "design";
    primary.session.ui.zoom = 2;
    const side = openTab({
      capabilities: { modes: ["edit", "design", "preview", "source"] },
      document: { children: [{ tagName: "p", textContent: "Away" }], tagName: "div" },
      documentPath: "/project/away.json",
      id: "zoom-away",
    });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    side.session.ui.canvasMode = "edit";
    side.session.ui.editZoom = 1.5;
    return { primary, side };
  }

  test("clicking into the other pane re-points the readout", async () => {
    const { primary, side } = twoPanes();
    focusPane(PRIMARY_PANE);
    await mountAndRender();
    expect(labelOf("zoom-label")).toBe("200%");
    expect(fit()).not.toBeNull();

    focusPane(SECONDARY_PANE);
    await flush(8);
    expect(labelOf("zoom-label")).toBe("150%");
    // The side pane is in Edit, so the Fit select goes with the artboard.
    expect(fit()).toBeNull();

    // And the buttons write the pane the readout describes.
    pointer(part("zoom-in")!, "click");
    await flush(6);
    expect(side.session.ui.editZoom).toBeCloseTo(1.8);
    expect(primary.session.ui.zoom).toBe(2);
  });

  test("a lens pane reads, and writes, its own scale and not the source tab's", async () => {
    const page = openTestTab();
    page.session.ui.canvasMode = "design";
    page.session.ui.zoom = 2;
    openTab({ document: { tagName: "div" }, documentPath: "scratch.json", id: "scratch.json" });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    focusPane(PRIMARY_PANE);
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "design",
      preset: "breakpoint",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 0.5,
    });
    applyDerivation(SECONDARY_PANE, noopDerivationDeps());
    await mountAndRender();
    expect(labelOf("zoom-label")).toBe("200%");

    focusPane(SECONDARY_PANE);
    await flush(8);
    expect(labelOf("zoom-label")).toBe("50%");

    pointer(part("zoom-in")!, "click");
    await flush(6);
    const derived = derivationOfPane(SECONDARY_PANE)!;
    expect(derived.kind === "lens" && derived.zoom).toBeCloseTo(0.6, 5);
    expect(page.session.ui.zoom).toBe(2);
    expect(surfaceForPane(SECONDARY_PANE)).toBeDefined();
  });

  test("a lens's own mode decides whether the field exists, and the field repaints when it moves", async () => {
    openTestTab();
    openTab({ document: { tagName: "div" }, documentPath: "scratch.json", id: "scratch.json" });
    splitRight();
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "source",
      preset: "code",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });
    applyDerivation(SECONDARY_PANE, noopDerivationDeps());
    focusPane(SECONDARY_PANE);
    await mountAndRender();
    // A Code lens has no panzoom surface.
    expect(zoomField()).toBeNull();

    const derived = derivationOfPane(SECONDARY_PANE)!;
    Object.assign(derived, { mode: "design" });
    await flush(8);
    expect(zoomField()).not.toBeNull();
  });

  /* A DIFF LENS CARRIES ITS OWN COMPARISON, and the field asks about that one, the resolution the
     renderer's git-diff branch makes. Asked of `shell.git.diffState` instead, a lens comparing a
     page beside a Source Control diff of a stylesheet would lose its field over two artboards it can
     zoom. Its Code half has nothing to zoom, exactly as the primary's does. */
  test("a Diff lens follows ITS comparison and ITS half", async () => {
    openTestTab();
    openTab({ document: { tagName: "div" }, documentPath: "scratch.json", id: "scratch.json" });
    splitRight();
    const comparison = (filePath: string) => ({
      currentContent: "{}",
      filePath,
      fileStatus: "M",
      originalContent: "{}",
    });
    // The app-level slot holds a file with no visual half; the lens compares a page.
    shell.git.diffState = comparison("styles/site.css");
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "source",
      preset: "code",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });
    applyDerivation(SECONDARY_PANE, noopDerivationDeps());
    Object.assign(derivationOfPane(SECONDARY_PANE)!, {
      diff: comparison("pages/index.json"),
      mode: "git-diff",
      preset: "diff",
    });
    focusPane(SECONDARY_PANE);
    await mountAndRender();
    expect(zoomField()).not.toBeNull();

    // The lens's own half, keyed by ITS pane.
    setDiffView(SECONDARY_PANE, "code");
    renderStatusbar();
    await flush(6);
    expect(zoomField()).toBeNull();

    // And its own file: back to Visual, but now comparing a stylesheet.
    setDiffView(SECONDARY_PANE, "visual");
    const derived = derivationOfPane(SECONDARY_PANE)!;
    Object.assign(derived, { diff: comparison("styles/other.css") });
    await flush(8);
    expect(zoomField()).toBeNull();
  });
});

describe("over a comparison", () => {
  function compare(filePath: string): void {
    shell.git.diffState = {
      currentContent: "{}",
      filePath,
      fileStatus: "M",
      originalContent: "{}",
    };
  }

  test("the Visual half is on the panzoom surface: the field and its Fit are drawn", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    compare("/project/index.json");
    await mountAndRender();
    expect(zoomField()).not.toBeNull();
    expect(fit()).not.toBeNull();
  });

  test("the Code half has nothing to zoom; the switch back redraws the field", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    compare("/project/index.json");
    setDiffView(PRIMARY_PANE, "code");
    await mountAndRender();
    expect(zoomField()).toBeNull();

    // The half is not reactive: the switch repaints the bar itself (`diff-toolbar.ts`, through
    // `setDiffChromeRepaint`), which is `renderStatusbar`.
    setDiffView(PRIMARY_PANE, "visual");
    renderStatusbar();
    await flush(6);
    expect(zoomField()).not.toBeNull();
  });

  test("a file with no visual half is only ever Code", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    compare("styles/site.css");
    await mountAndRender();
    expect(diffViewOf(PRIMARY_PANE)).toBe("visual");
    expect(zoomField()).toBeNull();
  });

  test("before a comparison has landed there is nothing to zoom", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    await mountAndRender();
    expect(zoomField()).toBeNull();
  });

  test("Review changes draws none: the publish column stands where the field would act", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    const { openWorkspaceHome } = await import("../src/workspace/workspace-home");
    openWorkspaceHome("publish");
    compare("/project/index.json");
    await mountAndRender();
    expect(zoomField()).toBeNull();
  });

  test("the comparison is a tracked input: retargeting it to a stylesheet takes the field away", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "git-diff";
    compare("/project/index.json");
    await mountAndRender();
    expect(zoomField()).not.toBeNull();

    compare("styles/site.css");
    await flush(8);
    expect(zoomField()).toBeNull();
  });
});
