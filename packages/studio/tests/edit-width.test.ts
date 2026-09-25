/**
 * Edit-width tests — the store (`src/canvas/edit-width.ts`) and the drag
 * (`src/canvas/edit-width-drag.ts`) that writes through it.
 *
 * Happy-dom lays nothing out, so every geometry branch is driven through `stubRect`. The handles
 * are `jx-split`s driven through `ui/panel-resize.ts`'s `bindSplit`, and the kit is not registered
 * here — so a drag is what the ELEMENT would report: a share of the canvas moved by `dx / track`,
 * dispatched as the `input` and `change` it announces, `detail` carrying the modifiers. What is
 * Studio's, and asserted, is the translation back into a width and the snap that runs on it.
 */
import {
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  standUpPaneGrid,
  stubRect,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initShellRefs } from "../src/store";
import {
  EDIT_CANVAS_GUTTER,
  EDIT_WIDTH_MIN,
  clearEditWidth,
  declaredWidthOfTab,
  editWidthOfPane,
  resetEditWidths,
  resolveEditColumnWidth,
  setEditWidth,
  snapTargetsOfTab,
} from "../src/canvas/edit-width";
import {
  applyEditWidth,
  editWidthTarget,
  mountEditWidthHandle,
} from "../src/canvas/edit-width-drag";
import { unregisterCanvasSurface } from "../src/canvas/canvas-surface";
import { rectOf } from "../src/utils/geometry";
import { activeTab, closeAllTabs, PRIMARY_PANE } from "../src/workspace/workspace";
import type { Tab } from "../src/tabs/tab";
import type { CanvasSurface } from "../src/canvas/canvas-surface";
import type { SplitElement } from "../src/ui/panel-resize";
import type { SplitModifiers } from "@jxsuite/ui/behaviors/split";

const NONE: SplitModifiers = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

/** The desktop-first shape `packages/create/templates.ts` ships and all 12 starters use. */
const DESKTOP_FIRST = {
  "--": "1200px",
  "--lg": "(max-width: 1024px)",
  "--md": "(max-width: 768px)",
  "--sm": "(max-width: 640px)",
};

let surface: CanvasSurface;

function openTabWithMedia(media: Record<string, string> = DESKTOP_FIRST): Tab {
  resetWorkspaceWithTab({
    $media: media,
    children: [{ tagName: "p", textContent: "Hi" }],
    tagName: "div",
  } as never);
  return activeTab.value!;
}

/**
 * A column inside a scroll container, with a rect that FOLLOWS its own CSS.
 *
 * Happy-dom lays nothing out, and a static `stubRect` would be actively misleading here: the whole
 * point of the derived breakpoint is that it is read back from what the column actually rendered
 * at. So the rect is a live getter over `width: 100%` under a `max-width` — exactly the two rules
 * `styles/canvas.css` gives the real column — and `clientWidth`, which is what the drag's ceiling
 * reads, is fixed the way a browser fixes it (padding included).
 */
function standUpColumn(available: number, initialWidth?: number): HTMLElement {
  const canvas = document.createElement("div");
  canvas.setAttribute("part", "edit-canvas");
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: available });
  // The canvas is the TRACK the handles measure; its rect is what a share is a fraction of.
  stubRect(canvas, { height: 800, width: available });
  const column = document.createElement("div");
  column.setAttribute("part", "edit-column");
  if (initialWidth !== undefined) {
    column.style.maxWidth = `${initialWidth}px`;
  }
  canvas.append(column);
  surface.wrap.append(canvas);
  Object.defineProperty(column, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const cap = Number(column.style.maxWidth.replace("px", "") || Number.NaN);
      return { width: Math.min(Number.isNaN(cap) ? available : cap, available) } as DOMRect;
    },
  });
  return column;
}

beforeEach(() => {
  installMockPlatform();
  resetStudioState();
  resetEditWidths();
  document.body.innerHTML = `<div id="app"></div>`;
  initShellRefs();
  // StandUpPaneGrid registers the stage as this pane's surface; nothing else to wire.
  surface = standUpPaneGrid(PRIMARY_PANE);
});

afterEach(() => {
  unregisterCanvasSurface(PRIMARY_PANE);
  resetEditWidths();
  closeAllTabs();
});

// ─── The store ────────────────────────────────────────────────────────────────

describe("declaredWidthOfTab", () => {
  test("is the base width at Base, and the breakpoint's own width otherwise", () => {
    const tab = openTabWithMedia();
    expect(declaredWidthOfTab(tab)).toBe(1200);
    tab.session.ui.activeMedia = "--md";
    expect(declaredWidthOfTab(tab)).toBe(768);
  });

  test("falls back to the base width for a breakpoint the document no longer declares", () => {
    const tab = openTabWithMedia();
    tab.session.ui.activeMedia = "--ghost";
    expect(declaredWidthOfTab(tab)).toBe(1200);
  });

  test("a document with no $media at all uses parseMediaEntries' 320px floor", () => {
    const tab = openTabWithMedia({});
    expect(declaredWidthOfTab(tab)).toBe(320);
  });
});

describe("snapTargetsOfTab", () => {
  test("offers the base width and every declared breakpoint", () => {
    expect(snapTargetsOfTab(openTabWithMedia()).toSorted((a, b) => a - b)).toEqual([
      640, 768, 1024, 1200,
    ]);
  });

  test("a project declaring only feature queries has the base width as its one magnet", () => {
    const tab = openTabWithMedia({ "--": "900px", "--dark": "(prefers-color-scheme: dark)" });
    expect(snapTargetsOfTab(tab)).toEqual([900]);
  });
});

describe("setEditWidth / editWidthOfPane", () => {
  test("records the width and derives the breakpoint the canvas is now in", () => {
    const tab = openTabWithMedia();
    expect(setEditWidth(PRIMARY_PANE, tab, 700)).toBe("--md");
    expect(tab.session.ui.activeMedia).toBe("--md");
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBe(700);
  });

  test("a width past every max-width query is Base", () => {
    const tab = openTabWithMedia();
    expect(setEditWidth(PRIMARY_PANE, tab, 1150)).toBeNull();
    expect(tab.session.ui.activeMedia).toBeNull();
  });

  test("the record self-invalidates when someone ELSE moves the breakpoint axis", () => {
    /* This is what lets `canvas.setBreakpoint` snap the column back to a declared width without
       `canvas-utils.ts` having to import the drag — see the module header. */
    const tab = openTabWithMedia();
    setEditWidth(PRIMARY_PANE, tab, 700);
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBe(700);
    tab.session.ui.activeMedia = "--sm";
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBeNull();
  });

  test("a stale record is DELETED, so returning to the breakpoint cannot revive it", () => {
    const tab = openTabWithMedia();
    setEditWidth(PRIMARY_PANE, tab, 700);
    tab.session.ui.activeMedia = "--sm";
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBeNull();
    tab.session.ui.activeMedia = "--md";
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBeNull();
  });

  test("a record does not follow the pane to another document", () => {
    const first = openTabWithMedia();
    setEditWidth(PRIMARY_PANE, first, 700);
    // `resetWorkspaceWithTab` mints one fixed id, so the other document is named directly.
    const second = { id: "another-tab", session: { ui: { activeMedia: null } } } as unknown as Tab;
    expect(editWidthOfPane(PRIMARY_PANE, second)).toBeNull();
    expect(editWidthOfPane(PRIMARY_PANE, first)).toBeNull();
  });

  test("no tab means no width", () => {
    expect(editWidthOfPane(PRIMARY_PANE, null)).toBeNull();
  });

  test("clearEditWidth and resetEditWidths both forget it", () => {
    const tab = openTabWithMedia();
    setEditWidth(PRIMARY_PANE, tab, 700);
    clearEditWidth(PRIMARY_PANE);
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBeNull();
    setEditWidth(PRIMARY_PANE, tab, 700);
    resetEditWidths();
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBeNull();
  });
});

describe("resolveEditColumnWidth", () => {
  test("prefers the dragged width, and falls back to the switcher's", () => {
    const tab = openTabWithMedia();
    expect(resolveEditColumnWidth(surface, tab)).toBe(1200);
    setEditWidth(PRIMARY_PANE, tab, 700);
    expect(resolveEditColumnWidth(surface, tab)).toBe(700);
  });

  test("an empty pane resolves to zero rather than throwing", () => {
    expect(resolveEditColumnWidth(surface, null)).toBe(0);
  });
});

// ─── The drag ─────────────────────────────────────────────────────────────────

describe("applyEditWidth", () => {
  test("writes the column, the readout and the derived breakpoint together", () => {
    const tab = openTabWithMedia();
    const column = standUpColumn(1400);
    applyEditWidth(surface, column, 700);
    expect(column.style.maxWidth).toBe("700px");
    expect(column.classList.contains("is-resizing")).toBe(true);
    expect(tab.session.ui.activeMedia).toBe("--md");
    expect(column.dataset.editWidth).toBe("700px");
  });

  test("the breakpoint comes from the MEASURED width, not the requested one", () => {
    /* The column is `width: 100%` under a `max-width`, so a pane narrower than the request renders
       narrower than it — and a band computed from the request would name one the page is not in. */
    const tab = openTabWithMedia();
    const column = standUpColumn(600);
    applyEditWidth(surface, column, 1150);
    expect(tab.session.ui.activeMedia).toBe("--sm");
    expect(editWidthOfPane(PRIMARY_PANE, tab)).toBe(600);
  });

  test("an empty pane is a no-op", () => {
    closeAllTabs();
    const column = standUpColumn(1400);
    applyEditWidth(surface, column, 700);
    expect(column.style.maxWidth).toBe("");
  });
});

describe("editWidthTarget", () => {
  test("scale is doubled and mirrored, which is what makes the two handles symmetric", () => {
    openTabWithMedia();
    const column = standUpColumn(1400);
    expect(editWidthTarget(surface, column, 1).scale()).toBe(2);
    expect(editWidthTarget(surface, column, -1).scale()).toBe(-2);
  });

  test("the ceiling is the container's width less both gutters, read fresh", () => {
    openTabWithMedia();
    const column = standUpColumn(1000);
    expect(editWidthTarget(surface, column, 1).max()).toBe(1000 - 2 * EDIT_CANVAS_GUTTER);
  });

  test("before layout there is no honest ceiling, so only the floor bounds the drag", () => {
    openTabWithMedia();
    const column = standUpColumn(0);
    const target = editWidthTarget(surface, column, 1);
    expect(target.max()).toBe(Number.POSITIVE_INFINITY);
    expect(target.min()).toBe(EDIT_WIDTH_MIN);
  });

  test("read is the measured width; reset is the breakpoint the switcher names", () => {
    const tab = openTabWithMedia();
    const column = standUpColumn(1400, 830);
    const target = editWidthTarget(surface, column, 1);
    expect(target.read()).toBe(830);
    expect(target.reset()).toBe(1200);
    tab.session.ui.activeMedia = "--md";
    expect(target.reset()).toBe(768);
  });

  test("read falls back to the declared width when nothing has been laid out", () => {
    // A pane that has not been laid out measures zero; starting a drag from zero would be a jump.
    openTabWithMedia();
    const column = standUpColumn(0);
    expect(editWidthTarget(surface, column, 1).read()).toBe(1200);
  });

  test("an empty pane still answers with the floor rather than throwing", () => {
    closeAllTabs();
    const column = standUpColumn(0);
    const target = editWidthTarget(surface, column, 1);
    expect(target.read()).toBe(EDIT_WIDTH_MIN);
    expect(target.reset()).toBe(EDIT_WIDTH_MIN);
    expect(target.snap?.(742, NONE)).toBe(742);
  });

  test("snap pulls onto a declared width, and Alt passes straight through", () => {
    openTabWithMedia();
    const column = standUpColumn(1400);
    const { snap } = editWidthTarget(surface, column, 1);
    expect(snap?.(765, NONE)).toBe(768);
    expect(snap?.(765, { ...NONE, altKey: true })).toBe(765);
    // Shift is the element's own large step and means nothing to the magnet.
    expect(snap?.(765, { ...NONE, shiftKey: true })).toBe(768);
    expect(snap?.(700, NONE)).toBe(700);
  });

  test("lead is the centre line: the right edge measures from the track's start, the left from its end", () => {
    /* The column is centred in the canvas's CONTENT box, which is what `clientWidth` spans and a
       vertical scrollbar does not — so with a 15px scrollbar the track (the rect) is 15px wider
       than the box the centre is a half of, and the two edges are not the same distance from
       their respective ends. */
    openTabWithMedia();
    const column = standUpColumn(1400);
    stubRect(column.parentElement!, { height: 800, width: 1415 });
    expect(editWidthTarget(surface, column, 1).lead?.(1415)).toBe(700);
    expect(editWidthTarget(surface, column, -1).lead?.(1415)).toBe(715);
  });

  test("settle closes the readout", () => {
    openTabWithMedia();
    const column = standUpColumn(1400);
    applyEditWidth(surface, column, 700);
    expect(column.classList.contains("is-resizing")).toBe(true);
    editWidthTarget(surface, column, 1).settle();
    expect(column.classList.contains("is-resizing")).toBe(false);
  });
});

describe("mountEditWidthHandle", () => {
  /**
   * A handle BESIDE the column, in a `display: contents` slot of the canvas — the shape
   * `surfaces/canvas-stage.json` draws, and the one that makes the canvas the track: the first
   * ancestor of the handle that generates a box.
   */
  function handleBeside(column: HTMLElement, side: "start" | "end" = "end"): SplitElement {
    const canvas = column.parentElement!;
    const slot = document.createElement("div");
    slot.setAttribute("part", `handle-${side}-slot`);
    slot.style.display = "contents";
    const handle = document.createElement("jx-split") as SplitElement;
    handle.setAttribute("part", "edit-handle");
    handle.dataset.side = side;
    slot.append(handle);
    if (side === "start") {
      canvas.prepend(slot);
    } else {
      canvas.append(slot);
    }
    return handle;
  }

  /**
   * What `jx-split` reports for a pointer that travelled `dx` px: the press, then the share moved
   * by `dx / track` as an `input` whose detail is the modifiers, then the `change` of the release.
   */
  function drag(handle: SplitElement, dx: number, modifiers: Partial<SplitModifiers> = {}): void {
    const detail = { ...NONE, ...modifiers };
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    const track = rectOf(handle.parentElement!.parentElement!).width;
    handle.value += dx / track;
    handle.dispatchEvent(new CustomEvent("input", { bubbles: true, detail }));
    handle.dispatchEvent(new CustomEvent("change", { bubbles: true, detail }));
  }

  test("the handle is handed the column's width as its share of the canvas, and its bounds", () => {
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    // Centre 700, half-width 500: the right edge is 1200 of 1400 along the track.
    expect(handle.value).toBeCloseTo(1200 / 1400, 6);
    expect(handle.min).toBeCloseTo((700 + EDIT_WIDTH_MIN / 2) / 1400, 6);
    expect(handle.max).toBeCloseTo((700 + (1400 - 2 * EDIT_CANVAS_GUTTER) / 2) / 1400, 6);
    // Enter and a double click return to the breakpoint's declared width.
    expect(handle.collapse).toBeCloseTo((700 + 1200 / 2) / 1400, 6);
  });

  test("a drag on the end handle resizes symmetrically — 2px of width per px of travel", () => {
    const tab = openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    drag(handle, -60);
    // 1000 − 2×60 = 880, past no magnet, so it lands exactly there.
    expect(column.style.maxWidth).toBe("880px");
    expect(tab.session.ui.activeMedia).toBe("--lg");
    // The readout closed on the commit.
    expect(column.classList.contains("is-resizing")).toBe(false);
  });

  test("the start handle grows the column when it is dragged LEFT", () => {
    openTabWithMedia();
    const column = standUpColumn(1400, 800);
    const handle = handleBeside(column, "start");
    mountEditWidthHandle(surface, handle, column, -1);
    // The left edge is 700 − 400 = 300 along the track: a share that FALLS as the page grows.
    expect(handle.value).toBeCloseTo(300 / 1400, 6);
    drag(handle, -50);
    expect(column.style.maxWidth).toBe("900px");
  });

  test("a drag near a declared width snaps onto it, and the snapped share goes back to the element", () => {
    const tab = openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    // 1000 − 2×117 = 766, within 8px of the 768 the project declares for --md.
    drag(handle, -117);
    expect(column.style.maxWidth).toBe("768px");
    expect(tab.session.ui.activeMedia).toBe("--md");
    expect(handle.value).toBeCloseTo((700 + 768 / 2) / 1400, 6);
  });

  test("Alt on the step drags through the magnet", () => {
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    drag(handle, -117, { altKey: true });
    expect(column.style.maxWidth).toBe("766px");
  });

  test("the drag is clamped by the pane, and a magnet cannot carry it past the wall", () => {
    /* The container is 1052 wide, so the ceiling is 1020 — within 8px of the 1024 the project
       declares for --lg. Without the re-clamp in `bindSplit`, that magnet would win and the stored
       width, the readout and the rendered column would then disagree. */
    openTabWithMedia();
    const column = standUpColumn(1052, 900);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    drag(handle, 400);
    expect(column.style.maxWidth).toBe(`${1052 - 2 * EDIT_CANVAS_GUTTER}px`);
  });

  test("a gesture that starts after the canvas changed does not jump", () => {
    /* A dock opened, a pane split moved: the canvas is narrower and nothing told the adapter. The
       press re-derives the share against the new track first, so the first pixel of travel is one
       pixel of travel and not the difference between two tracks. */
    openTabWithMedia();
    const column = standUpColumn(1400, 800);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    stubRect(column.parentElement!, { height: 800, width: 1000 });
    Object.defineProperty(column.parentElement!, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    drag(handle, -10);
    expect(column.style.maxWidth).toBe("780px");
  });

  test("mounting twice does not bind a second time", () => {
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    let inputs = 0;
    const add = handle.addEventListener.bind(handle);
    handle.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "input") {
        inputs += 1;
      }
      (add as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof handle.addEventListener;
    mountEditWidthHandle(surface, handle, column, 1);
    mountEditWidthHandle(surface, handle, column, 1);
    expect(inputs).toBe(1);
    drag(handle, -60);
    expect(column.style.maxWidth).toBe("880px");
  });

  test("a handle the stage dropped is released on the next mount", () => {
    /* Leaving Edit removes the handles and coming back draws two new ones. The old pair would
       otherwise stay bound — to a window-resize listener each, and to the adapter's registry —
       so the next mount releases whatever is no longer in the document. A detached handle can
       measure no track and so writes nothing, which is why the width is not the witness here: the
       unbind is, seen as the listeners it takes off the old element and off the window. */
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const old = handleBeside(column);
    const removed: string[] = [];
    const off = old.removeEventListener.bind(old);
    old.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      (off as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof old.removeEventListener;
    const offWindow = globalThis.removeEventListener.bind(globalThis);
    let resizeListeners = 0;
    globalThis.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "resize") {
        resizeListeners -= 1;
      }
      (offWindow as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof globalThis.removeEventListener;
    try {
      mountEditWidthHandle(surface, old, column, 1);
      // Still in the document: a repeat mount releases nothing.
      mountEditWidthHandle(surface, old, column, 1);
      expect(removed).toEqual([]);
      old.parentElement!.remove();
      const fresh = handleBeside(column);
      mountEditWidthHandle(surface, fresh, column, 1);
      expect(removed.toSorted()).toEqual(["change", "input", "keydown", "pointerdown"]);
      /* At least the old handle's — the sweep also releases what earlier tests left detached,
         which is the same policy doing the same job. */
      expect(resizeListeners).toBeLessThanOrEqual(-1);
      drag(fresh, -60);
      expect(column.style.maxWidth).toBe("880px");
    } finally {
      globalThis.removeEventListener = offWindow;
    }
  });

  test("a frame with no column to size is skipped rather than half-wired", () => {
    /* The stage draws the handles only where there IS a column, so both halves can be absent: the
       Design and Preview frames draw neither. */
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    expect(() => mountEditWidthHandle(surface, undefined, column, 1)).not.toThrow();
    expect(() =>
      mountEditWidthHandle(surface, document.createElement("jx-split"), undefined, 1),
    ).not.toThrow();
  });

  test("the column is the one it is GIVEN, and the handle's own parent is only a slot", () => {
    /* The stage draws each handle inside a `display: contents` slot beside the column, so
       `handle.parentElement` is that slot: sizing it would move nothing a browser could show. */
    openTabWithMedia();
    const column = standUpColumn(1400, 1000);
    const handle = handleBeside(column);
    mountEditWidthHandle(surface, handle, column, 1);
    drag(handle, -60);
    expect(column.style.maxWidth).toBe("880px");
    expect(handle.parentElement!.style.maxWidth).toBe("");
  });
});
