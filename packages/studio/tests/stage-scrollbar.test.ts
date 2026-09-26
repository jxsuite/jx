/**
 * The stage's scrollbar width, published on the pane's cell for the zoom pod to clear.
 *
 * The pod floats in a chrome layer that spans the whole cell, scrollbar gutter included, and sat a
 * fixed 12px from an edge a 15px scrollbar was flush against. These pin the half of the fix that
 * happy-dom can see: what the measurement is, WHERE it is written (the cell, never `:root`, never
 * the stage), that it follows the scroller, and that the pod's own rule names the variable this
 * module writes. Happy-dom has no layout, so every width here is stubbed.
 */
import { installResizeObserver } from "./harness";
import type { FakeResizeObservers } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  STAGE_SCROLLBAR_VAR,
  releaseStageScrollbar,
  scrollbarWidthOf,
  trackStageScrollbar,
} from "../src/canvas/stage-scrollbar";
import { surfaceForPane } from "../src/canvas/surface-registry";
import { PANE_PART } from "../src/surfaces/pane-grid";
import type { CanvasSurface } from "../src/canvas/surface-registry";

const SRC = resolve(import.meta.dir, "..", "src");

/** Give an element the two widths layout would have given it. */
function stubWidths(el: HTMLElement, offsetWidth: number, clientWidth: number): void {
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: offsetWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

/** What the variable reads on an element's own inline style. */
function published(el: HTMLElement): string {
  return el.style.getPropertyValue(STAGE_SCROLLBAR_VAR);
}

let observers: FakeResizeObservers;
let cell: HTMLElement;
let stage: HTMLElement;
let surface: CanvasSurface;
let nextPane = 0;

beforeEach(() => {
  observers = installResizeObserver();
  document.body.textContent = "";
  document.documentElement.style.removeProperty(STAGE_SCROLLBAR_VAR);
  cell = document.createElement("div");
  cell.setAttribute("part", PANE_PART);
  stage = document.createElement("div");
  cell.append(stage);
  document.body.append(cell);
  // A pane of its own per test, so no record carries an observer over from the one before.
  nextPane += 1;
  surface = surfaceForPane(`scrollbar-${nextPane}`);
  surface.wrap = stage;
});

afterEach(() => {
  releaseStageScrollbar(surface);
  observers.restore();
});

/** A scroller inside the stage, as the stage document draws Edit's. */
function scroller(offsetWidth = 1144, clientWidth = 1129): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("part", "edit-canvas");
  stubWidths(el, offsetWidth, clientWidth);
  stage.append(el);
  return el;
}

describe("scrollbarWidthOf", () => {
  test("is the border box minus the client box: exactly the scrollbar on a borderless box", () => {
    const el = document.createElement("div");
    stubWidths(el, 1144, 1129);
    expect(scrollbarWidthOf(el)).toBe(15);
  });

  test("never goes negative", () => {
    const el = document.createElement("div");
    stubWidths(el, 100, 104);
    expect(scrollbarWidthOf(el)).toBe(0);
  });

  test("is 0 where nothing is laid out, which is also what an overlay scrollbar answers", () => {
    expect(scrollbarWidthOf(document.createElement("div"))).toBe(0);
  });
});

describe("trackStageScrollbar", () => {
  test("writes the width on the CELL, not on the stage or the root, and observes the scroller", () => {
    const el = scroller();
    trackStageScrollbar(surface, el);

    expect(published(cell)).toBe("15px");
    // The stage and the root stay clean: two panes would otherwise share one pane's scrollbar.
    expect(published(stage)).toBe("");
    expect(published(document.documentElement)).toBe("");
    expect(observers.observes(el)).toBe(true);
    expect(surface.stageScrollbar?.scroller).toBe(el);
  });

  test("follows the scrollbar as it goes and comes back", () => {
    const el = scroller();
    trackStageScrollbar(surface, el);

    // The page shrank to fit the pane: the scrollbar left and the client box grew into its track.
    stubWidths(el, 1144, 1144);
    observers.resize(el);
    expect(published(cell)).toBe("0px");

    stubWidths(el, 1144, 1129);
    observers.resize(el);
    expect(published(cell)).toBe("15px");
  });

  test("the same scroller again is a no-op; a different one replaces it", () => {
    const first = scroller();
    trackStageScrollbar(surface, first);
    const record = surface.stageScrollbar;

    // A content-only repaint hands back the scroller the stage kept: nothing is re-observed.
    trackStageScrollbar(surface, first);
    expect(surface.stageScrollbar).toBe(record);

    const second = scroller(1144, 1132);
    trackStageScrollbar(surface, second);
    expect(observers.observes(first)).toBe(false);
    expect(observers.observes(second)).toBe(true);
    expect(surface.stageScrollbar?.scroller).toBe(second);
    expect(published(cell)).toBe("12px");
  });

  test("no scroller releases the one it held and writes 0", () => {
    const el = scroller();
    trackStageScrollbar(surface, el);

    trackStageScrollbar(surface, null);
    expect(surface.stageScrollbar).toBeNull();
    expect(observers.observes(el)).toBe(false);
    expect(published(cell)).toBe("0px");
  });

  test("a stage outside every cell writes the root, which is only ever a fixture", () => {
    const loose = document.createElement("div");
    document.body.append(loose);
    surface.wrap = loose;
    const el = document.createElement("div");
    stubWidths(el, 300, 283);
    loose.append(el);

    trackStageScrollbar(surface, el);
    expect(published(document.documentElement)).toBe("17px");
  });
});

describe("releaseStageScrollbar", () => {
  test("disconnects, forgets the scroller and writes 0; twice is the same as once", () => {
    const el = scroller();
    trackStageScrollbar(surface, el);

    releaseStageScrollbar(surface);
    expect(surface.stageScrollbar).toBeNull();
    expect(observers.observes(el)).toBe(false);
    expect(published(cell)).toBe("0px");

    releaseStageScrollbar(surface);
    expect(published(cell)).toBe("0px");
  });

  test("does not throw for a surface whose stage has not been built yet", () => {
    const bare = surfaceForPane(`scrollbar-bare-${nextPane}`);
    expect(bare.wrap).toBeNull();
    expect(() => releaseStageScrollbar(bare)).not.toThrow();
    expect(bare.stageScrollbar).toBeNull();
    expect(published(document.documentElement)).toBe("0px");
  });
});

describe("the pod reads what this writes", () => {
  test("the pod's inset names the variable, so renaming either side goes red", () => {
    /* JSON cannot import a constant, so `pane-context.json` and this module are two writers of one
       name — the join `pane-grid-surface.test.ts` makes for the cell's own part. */
    const doc = JSON.parse(readFileSync(join(SRC, "surfaces", "pane-context.json"), "utf8")) as {
      style: Record<string, Record<string, string>>;
    };
    const pod = doc.style['& [part="pod"]'];
    expect(pod?.margin).toContain(`var(${STAGE_SCROLLBAR_VAR}, 0px)`);
    // Added to the plain inset, not in place of it: with no scrollbar the pod sits where it was.
    expect(pod?.margin).toContain("calc(var(--jx-space-4) + ");
  });
});
