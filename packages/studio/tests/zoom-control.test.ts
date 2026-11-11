/**
 * The zoom field's projection: the slider's logarithmic mapping, what each pane's zoom says, and
 * the commands its gestures name (`panels/zoom-control.ts`).
 *
 * The field's DOM and its gestures are `statusbar-zoom.test.ts`; this file is the arithmetic and
 * the decisions that need no document.
 */
import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";

const {
  FIT_CHOICES,
  ZOOM_POSITION_MAX,
  fitCommandFor,
  hiddenZoomProjection,
  positionToZoom,
  slideCommandFor,
  zoomProjectionFor,
  zoomToPosition,
} = await import("../src/panels/zoom-control");
const { closeAllTabs, PRIMARY_PANE } = await import("../src/workspace/workspace");
const { resetFits, PAN_ZOOM_MAX, PAN_ZOOM_MIN, EDIT_ZOOM_MAX, EDIT_ZOOM_MIN } =
  await import("../src/canvas/canvas-utils");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");

const PAN = { max: PAN_ZOOM_MAX, min: PAN_ZOOM_MIN };
const EDIT = { max: EDIT_ZOOM_MAX, min: EDIT_ZOOM_MIN };

beforeEach(() => {
  closeAllTabs();
  resetStudioState();
  resetFits();
});

describe("the logarithmic mapping", () => {
  test("the ends of the track are the ends of the range", () => {
    expect(zoomToPosition(PAN.min, PAN)).toBeCloseTo(0, 9);
    expect(zoomToPosition(PAN.max, PAN)).toBeCloseTo(ZOOM_POSITION_MAX, 9);
    expect(positionToZoom(0, PAN)).toBe(PAN.min);
    expect(positionToZoom(ZOOM_POSITION_MAX, PAN)).toBe(PAN.max);
    expect(zoomToPosition(EDIT.min, EDIT)).toBeCloseTo(0, 9);
    expect(zoomToPosition(EDIT.max, EDIT)).toBeCloseTo(ZOOM_POSITION_MAX, 9);
  });

  test("100% is not mid-track: a linear track would put it a fifth of the way along", () => {
    expect(Math.round(zoomToPosition(1, PAN))).toBe(65);
    expect(Math.round(zoomToPosition(1, EDIT))).toBe(56);
  });

  test("a position outside the track, or a zoom outside the range, is held inside it", () => {
    expect(positionToZoom(-20, PAN)).toBe(PAN.min);
    expect(positionToZoom(250, PAN)).toBe(PAN.max);
    expect(zoomToPosition(100, PAN)).toBeCloseTo(ZOOM_POSITION_MAX, 9);
    expect(zoomToPosition(0.0001, PAN)).toBeCloseTo(0, 9);
  });

  test("a dragged position survives the round trip, so the thumb does not jump from under the hand", () => {
    for (const range of [PAN, EDIT]) {
      for (let position = 0; position <= ZOOM_POSITION_MAX; position += 1) {
        const back = Math.round(zoomToPosition(positionToZoom(position, range), range));
        expect(back).toBe(position);
      }
    }
  });

  test("the zoom a position gives is rounded to a tenth of a percent", () => {
    expect(positionToZoom(33, PAN)).toBe(Math.round(positionToZoom(33, PAN) * 1000) / 1000);
  });
});

describe("what each pane says", () => {
  test("no tab, no field", () => {
    expect(zoomProjectionFor(PRIMARY_PANE, null).state).toBe("hidden");
  });

  test("the hidden projection is a complete record with no options", () => {
    const hidden = hiddenZoomProjection();
    expect(hidden.state).toBe("hidden");
    expect(hidden.fitOptions).toEqual([]);
    expect(hidden.fitState).toBe("hidden");
  });

  test("Design states zoom, fit and the pan-zoom command; Edit states the content zoom and no fit", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.zoom = 1;
    const design = zoomProjectionFor(PRIMARY_PANE, null);
    expect(design).toMatchObject({
      fitState: "shown",
      fitValue: "page",
      label: "100%",
      slideCommand: "canvas.setZoom",
      state: "shown",
      valuetext: "100%",
    });
    expect(design.position).toBe(65);
    expect(design.fitOptions.map((o) => o.label)).toEqual(FIT_CHOICES.map((c) => c.label));

    tab.session.ui.canvasMode = "edit";
    tab.session.ui.editZoom = 2;
    const edit = zoomProjectionFor(PRIMARY_PANE, null);
    expect(edit).toMatchObject({
      fitOptions: [],
      fitState: "hidden",
      label: "200%",
      slideCommand: "canvas.setEditZoom",
      state: "shown",
    });
  });

  test("Preview, Source, Grid and a home have nothing to zoom", () => {
    const tab = resetWorkspaceWithTab();
    for (const mode of ["source", "content", "settings"]) {
      tab.session.ui.canvasMode = mode;
      expect(zoomProjectionFor(PRIMARY_PANE, null).state).toBe("hidden");
    }
    tab.session.ui.canvasMode = "design";
    tab.session.ui.preview = true;
    expect(zoomProjectionFor(PRIMARY_PANE, null).state).toBe("hidden");
  });

  test("the hints come from the keymap: Reset names no chord it does not have", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "design";
    const registry = createCommandRegistry({ getContext: () => makeContext(), mac: false });
    registry.registerAll([
      {
        category: "View",
        id: "canvas.zoomIn",
        keybinding: "mod+=",
        level: "document",
        run: () => {},
        title: "Zoom In",
      },
      {
        category: "View",
        id: "canvas.zoomOut",
        keybinding: "mod+-",
        level: "document",
        run: () => {},
        title: "Zoom Out",
      },
      {
        category: "View",
        id: "canvas.zoomReset",
        level: "document",
        run: () => {},
        title: "Reset Zoom",
      },
    ]);
    const projection = zoomProjectionFor(PRIMARY_PANE, registry);
    expect(projection.zoomInHint).toBe("Zoom in (Ctrl+=)");
    expect(projection.zoomOutHint).toBe("Zoom out (Ctrl+-)");
    expect(projection.resetHint).toBe("Reset to 100%");
    // With no registry at all the words stand alone.
    expect(zoomProjectionFor(PRIMARY_PANE, null).zoomInHint).toBe("Zoom in");
  });
});

describe("the commands a gesture names", () => {
  test("a slider position becomes a scale on the range the field was drawn for", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "design";
    const design = zoomProjectionFor(PRIMARY_PANE, null);
    expect(slideCommandFor(design, ZOOM_POSITION_MAX)).toEqual({
      args: { zoom: PAN_ZOOM_MAX },
      id: "canvas.setZoom",
    });
    tab.session.ui.canvasMode = "edit";
    const edit = zoomProjectionFor(PRIMARY_PANE, null);
    expect(slideCommandFor(edit, 0)).toEqual({
      args: { zoom: EDIT_ZOOM_MIN },
      id: "canvas.setEditZoom",
    });
  });

  test("Fit page is its own command, so it may magnify; the other choices are canvas.setFit", () => {
    expect(fitCommandFor("page")).toEqual({ args: {}, id: "canvas.fitPage" });
    expect(fitCommandFor("width")).toEqual({ args: { fit: "width" }, id: "canvas.setFit" });
    expect(fitCommandFor("none")).toEqual({ args: { fit: "none" }, id: "canvas.setFit" });
    expect(fitCommandFor("actual")).toEqual({ args: { fit: 1 }, id: "canvas.setFit" });
  });

  test("a value the select does not offer names no command", () => {
    expect(fitCommandFor("")).toBeNull();
    expect(fitCommandFor("zoom")).toBeNull();
  });
});
