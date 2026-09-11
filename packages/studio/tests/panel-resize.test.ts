/**
 * `ui/panel-resize.ts` — the three dock handles, as `jx-split` elements driven from a pixel model.
 *
 * What this file asserts is the TRANSLATION, because the gesture is no longer Studio's to test:
 * pointer capture, the arrow keys, Home/End, Enter and the double click are `jx-split`'s, and
 * `packages/ui/tests/split.test.ts` drives every one of them through real events. What is Studio's
 * is that a dock stored in pixels reaches the element as the right SHARE of the app box, that a
 * share the element reports comes back as the right pixels, that the pixel floor and the viewport
 * ceiling survive the round trip, and that a window resize re-derives all of it — the one listener
 * the element's own `gap` was designed to spare a host, owed here because a dock is not a
 * proportion.
 *
 * Happy-dom performs no layout, so the app box is stubbed to a known size and every expected share
 * is arithmetic over that number. That is the honest scope: the numbers, not the pixels on screen.
 *
 * There is no pointer path left to test. `setupHandle` — the pre-`jx-split` machinery that drove a
 * bare div by pointer events — survived one release for the Edit column's snapping handle, and went
 * with the element's gap: every `input` now carries the modifiers its step was made with, so the
 * snap runs in `bindSplit` and the column's handles are `jx-split`s like the docks'.
 */
import { stubRect } from "./harness";
import { describe, expect, test } from "bun:test";
import type { ResizeTarget, SplitElement } from "../src/ui/panel-resize";
import type { SplitModifiers } from "@jxsuite/ui/behaviors/split";

const STORAGE_KEY = "jx-studio-panel-widths";
const root = document.documentElement;

/** The app box every share below is a fraction of. Stubbed, since nothing here is laid out. */
const APP_W = 1200;
const APP_H = 800;

// Both modules read storage at import time — `shell` builds its dock record, `panel-resize` binds
// The handles — so the fixture must exist before the dynamic imports below.
localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({
    left: 300,
    leftCollapsed: true,
    right: 320,
    rightCollapsed: true,
  }),
);
document.body.innerHTML = `
  <div id="app">
    <jx-split id="resize-left" orientation="vertical"></jx-split>
    <jx-split id="resize-bottom" orientation="horizontal"></jx-split>
    <jx-split id="resize-right" orientation="vertical"></jx-split>
  </div>
`;
stubRect(document.querySelector("#app")!, { height: APP_H, width: APP_W });

const { DOCK_DEFAULT_SIZES, mountShell, setDockSize, shell, unmountShell } =
  await import("../src/shell");
const { DOCK_LEAD, bindSplit, syncSplits } = await import("../src/ui/panel-resize");
// The grid is projected by the shell's own effect, not by the resize module.
mountShell();

const left = document.querySelector("#resize-left") as SplitElement;
const right = document.querySelector("#resize-right") as SplitElement;
const bottom = document.querySelector("#resize-bottom") as SplitElement;

/**
 * The element reporting a gesture: `input` on every move, `change` on the commit. With modifiers,
 * it is the `CustomEvent` `jx-split` dispatches — `detail` is what the hand was holding; without,
 * it is a plain `Event`, which a host may dispatch itself and which reads as no modifiers.
 */
function report(
  handle: SplitElement,
  value: number,
  type: "input" | "change" = "input",
  modifiers?: Partial<SplitModifiers>,
): void {
  handle.value = value;
  handle.dispatchEvent(
    modifiers
      ? new CustomEvent(type, {
          bubbles: true,
          detail: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers },
        })
      : new Event(type, { bubbles: true }),
  );
}

function widthOf(cssVar: string): string {
  return root.style.getPropertyValue(cssVar);
}

/** Shares, to the precision a float round trip through pixels keeps. */
const near = (n: number) => expect.closeTo(n, 6);

describe("import-time restore", () => {
  test("saved widths are applied to the root custom properties", () => {
    expect(widthOf("--panel-w-left")).toBe("300px");
    expect(widthOf("--panel-w-right")).toBe("320px");
  });

  test("saved collapse flags restore shell state and #app classes", () => {
    expect(shell.docks.left.collapsed).toBe(true);
    expect(shell.docks.right.collapsed).toBe(true);
    const app = document.querySelector("#app") as HTMLElement;
    expect(app.classList.contains("left-collapsed")).toBe(true);
    expect(app.classList.contains("right-collapsed")).toBe(true);
  });
});

describe("the share the element is handed", () => {
  /* The Navigator is the LEADING side of its handle, behind the rail's 56px column: its share is
     (56 + size) / width. The Inspector is the TRAILING side: 1 - size / width. The Bottom dock is
     trailing on the other axis, above the 24px status bar: 1 - (24 + size) / height. */
  test("a dock's pixels become the leading side's share of the app box, offset by the fixed tracks", () => {
    expect(left.value).toEqual(near((DOCK_LEAD.left + 300) / APP_W));
    expect(right.value).toEqual(near(1 - (DOCK_LEAD.right + 320) / APP_W));
    expect(bottom.value).toEqual(near(1 - (DOCK_LEAD.bottom + shell.docks.bottom.size) / APP_H));
  });

  test("the pixel floor and the viewport ceiling become the element's bounds, in share", () => {
    // Navigator: 160px floor, half-the-viewport ceiling, both behind the rail.
    expect(left.min).toEqual(near((DOCK_LEAD.left + 160) / APP_W));
    expect(left.max).toEqual(near((DOCK_LEAD.left + window.innerWidth * 0.5) / APP_W));
    // Inspector: the same floor and ceiling, but a TRAILING side, so the bounds swap ends.
    expect(right.min).toEqual(near(1 - (window.innerWidth * 0.5) / APP_W));
    expect(right.max).toEqual(near(1 - 160 / APP_W));
  });

  test("the collapse point is the dock's default size, so Enter and a double click are the reset", () => {
    expect(left.collapse).toEqual(near((DOCK_LEAD.left + DOCK_DEFAULT_SIZES.left) / APP_W));
    expect(right.collapse).toEqual(near(1 - DOCK_DEFAULT_SIZES.right / APP_W));
  });
});

describe("a gesture the element reports", () => {
  test("an input on the Navigator's handle writes the share back as pixels", () => {
    report(left, (DOCK_LEAD.left + 400) / APP_W);
    expect(shell.docks.left.size).toBe(400);
    expect(widthOf("--panel-w-left")).toBe("400px");
  });

  test("an input on the Inspector's handle inverts, because the dock is the trailing side", () => {
    report(right, 1 - 280 / APP_W);
    expect(shell.docks.right.size).toBe(280);
  });

  test("an input on the Bottom dock's handle reads the other axis", () => {
    report(bottom, 1 - (DOCK_LEAD.bottom + 240) / APP_H);
    expect(shell.docks.bottom.size).toBe(240);
  });

  /* The element clamps to `min`/`max` itself, but the pixel bounds are the truth and the adapter
     re-clamps: a share that somehow lands outside them (a stale `max` between a resize and its
     sync) must not write pixels the shell would refuse. And the corrected share goes BACK to the
     element, or its announced value and the drawn track disagree until the next gesture. */
  test("a share past the pixel bounds is clamped, and the element is told the corrected share", () => {
    report(left, (DOCK_LEAD.left + 40) / APP_W);
    expect(shell.docks.left.size).toBe(160);
    expect(left.value).toEqual(near((DOCK_LEAD.left + 160) / APP_W));
  });

  test("a change persists once; an input does not", () => {
    localStorage.removeItem(STORAGE_KEY);
    report(left, (DOCK_LEAD.left + 350) / APP_W);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    report(left, (DOCK_LEAD.left + 350) / APP_W, "change");
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { left?: number };
    expect(saved.left).toBe(350);
  });
});

describe("the shell moving a dock without a gesture", () => {
  test("re-derives the element's share, so the announced value follows a command", () => {
    setDockSize("left", 260);
    expect(left.value).toEqual(near((DOCK_LEAD.left + 260) / APP_W));
  });
});

describe("a window resize", () => {
  /* The pixels are the stored truth and must NOT move; the share must, because the box did. This
     is the listener `jx-split`'s `gap` spares a host whose bounds are shares — and does not spare
     one whose floor is 160px and whose ceiling is half a viewport. */
  test("re-derives every share from the unchanged pixels against the new box", () => {
    setDockSize("left", 300);
    stubRect(document.querySelector("#app")!, { height: APP_H, width: 1600 });
    globalThis.dispatchEvent(new Event("resize"));
    expect(shell.docks.left.size).toBe(300);
    expect(left.value).toEqual(near((DOCK_LEAD.left + 300) / 1600));
    expect(left.min).toEqual(near((DOCK_LEAD.left + 160) / 1600));
    stubRect(document.querySelector("#app")!, { height: APP_H, width: APP_W });
    globalThis.dispatchEvent(new Event("resize"));
  });
});

describe("bindSplit on its own", () => {
  function target(over: Partial<ResizeTarget> = {}): ResizeTarget & { written: number[] } {
    const t = {
      axis: "x" as const,
      max: () => 500,
      min: () => 100,
      read: () => 200,
      reset: () => 250,
      scale: () => 1 as const,
      settle: () => {},
      write: (v: number) => {
        t.written.push(v);
      },
      written: [] as number[],
      ...over,
    };
    return t;
  }

  function fresh(): SplitElement {
    const box = document.createElement("div");
    stubRect(box, { height: 400, width: 1000 });
    const el = document.createElement("jx-split") as SplitElement;
    box.append(el);
    document.body.append(box);
    return el;
  }

  test("with no lead and the dock leading, the share is simply size over track", () => {
    const el = fresh();
    const unbind = bindSplit(el, target());
    expect(el.value).toEqual(near(0.2));
    expect(el.min).toEqual(near(0.1));
    expect(el.max).toEqual(near(0.5));
    expect(el.collapse).toEqual(near(0.25));
    unbind();
  });

  test("a snap is applied to the pixels the element asked for, and the snapped share goes back", () => {
    const el = fresh();
    const t = target({ snap: (v) => Math.round(v / 50) * 50 });
    const unbind = bindSplit(el, t);
    report(el, 0.312);
    expect(t.written).toEqual([300]);
    expect(el.value).toEqual(near(0.3));
    unbind();
  });

  test("a track that cannot be measured writes nothing, rather than a share of zero", () => {
    const el = document.createElement("jx-split") as SplitElement;
    const orphan = document.createElement("div");
    orphan.append(el);
    // Not in the document: every ancestor measures 0×0, exactly as an unlaid-out one would.
    const t = target();
    const unbind = bindSplit(el, t);
    expect(el.value).toBeUndefined();
    report(el, 0.4);
    expect(t.written).toEqual([]);
    unbind();
  });

  test("unbinding stops every listener, including the resize one", () => {
    const el = fresh();
    const t = target();
    const unbind = bindSplit(el, t);
    unbind();
    report(el, 0.4);
    expect(t.written).toEqual([]);
    const before = el.value;
    stubRect(el.parentElement!, { height: 400, width: 2000 });
    globalThis.dispatchEvent(new Event("resize"));
    expect(el.value).toBe(before);
  });

  test("syncSplits reaches only what is still bound", () => {
    const el = fresh();
    const t = target({ read: () => 300 });
    const unbind = bindSplit(el, t);
    (t as { read: () => number }).read = () => 400;
    syncSplits();
    expect(el.value).toEqual(near(0.4));
    unbind();
    (t as { read: () => number }).read = () => 100;
    syncSplits();
    expect(el.value).toEqual(near(0.4));
  });
});

describe("the snap, and the modifiers it is given", () => {
  /* This is what `setupHandle` survived for, and why it no longer has to: the element reports the
     modifiers every `input` was made with, so a host's snap — and its bypass — can run in the same
     place the clamp does. */
  function snapping(): { el: SplitElement; seen: SplitModifiers[]; written: number[] } {
    const box = document.createElement("div");
    stubRect(box, { height: 400, width: 1000 });
    const el = document.createElement("jx-split") as SplitElement;
    box.append(el);
    document.body.append(box);
    const seen: SplitModifiers[] = [];
    const written: number[] = [];
    bindSplit(el, {
      axis: "x",
      max: () => 890,
      min: () => 100,
      read: () => 200,
      reset: () => 250,
      scale: () => 1,
      settle: () => {},
      snap: (v, modifiers) => {
        seen.push(modifiers);
        return modifiers.altKey ? v : Math.round(v / 50) * 50;
      },
      write: (v) => {
        written.push(v);
      },
    });
    return { el, seen, written };
  }

  test("the snap sees the modifiers the element reported for THIS step", () => {
    const { el, seen, written } = snapping();
    report(el, 0.312, "input", {});
    report(el, 0.312, "input", { altKey: true });
    report(el, 0.312, "input", { shiftKey: true });
    expect(written).toEqual([300, 312, 300]);
    expect(seen.map((m) => [m.altKey, m.shiftKey])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  test("a plain input a host dispatched itself reads as no modifiers, so the snap still runs", () => {
    const { el, seen, written } = snapping();
    report(el, 0.312);
    expect(written).toEqual([300]);
    expect(seen[0]).toEqual({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  });

  test("a snap that pulls past the bound is clamped back, and the element is told", () => {
    /* A snap has no way to know the bounds: offered 880 with a ceiling of 890, this one answers
       900. Without the second clamp that would be written, and the stored size, the announced
       share and the drawn track would all disagree. */
    const { el, written } = snapping();
    report(el, 0.88, "input", {});
    expect(written).toEqual([890]);
    expect(el.value).toEqual(near(0.89));
  });

  test("the bypassed value is bounded too, so Alt cannot carry the pixels past the bounds", () => {
    const { el, written } = snapping();
    report(el, 0.95, "input", { altKey: true });
    expect(written).toEqual([890]);
    expect(el.value).toEqual(near(0.89));
  });
});

describe("a gesture START re-derives the shares", () => {
  /* The track moves for more reasons than a window resize — the Edit column's is the canvas, which
     a dock opening or a pane split changes with no event this adapter hears. So the four writes are
     redone on `pointerdown` and `keydown`, in the capture phase, before the element records where
     the gesture started; otherwise the first pixel of a drag is a jump. */
  function bound(before?: (el: SplitElement) => void): { el: SplitElement; box: HTMLElement } {
    const box = document.createElement("div");
    stubRect(box, { height: 400, width: 1000 });
    const el = document.createElement("jx-split") as SplitElement;
    box.append(el);
    document.body.append(box);
    before?.(el);
    bindSplit(el, {
      axis: "x",
      max: () => 500,
      min: () => 100,
      read: () => 200,
      reset: () => 250,
      scale: () => 1,
      settle: () => {},
      write: () => {},
    });
    return { box, el };
  }

  test("a pointerdown against a track that changed silently re-derives value, bounds and collapse", () => {
    const { box, el } = bound();
    expect(el.value).toEqual(near(0.2));
    stubRect(box, { height: 400, width: 2000 });
    // No resize event, no sync: the announced share is still the old track's.
    expect(el.value).toEqual(near(0.2));
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(el.value).toEqual(near(0.1));
    expect(el.min).toEqual(near(0.05));
    expect(el.max).toEqual(near(0.25));
    expect(el.collapse).toEqual(near(0.125));
  });

  test("a keydown does the same, so an arrow step is taken from an honest position", () => {
    const { box, el } = bound();
    stubRect(box, { height: 400, width: 500 });
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(el.value).toEqual(near(0.4));
  });

  test("the listeners run in the CAPTURE phase, ahead of the element's own", () => {
    /* The element records `start` from `value` in its bubble-phase handler, which the runtime
       bound BEFORE this adapter ever saw the element; a re-derivation that ran after it would be a
       jump deferred rather than a jump prevented. So the stand-in for the element's handler is
       registered first, and it must still see the re-derived share. */
    const order: string[] = [];
    const { box, el } = bound((handle) => {
      handle.addEventListener("pointerdown", () => {
        order.push(`element:${handle.value.toFixed(2)}`);
      });
    });
    stubRect(box, { height: 400, width: 2000 });
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(order).toEqual(["element:0.10"]);
  });
});

describe("a target the handle moves twice as fast as", () => {
  /* The Edit column is centred, so an edge that travels `dx` widens it by `2·dx`: `scale` is the
     ratio, and `lead` — given the track — is the centre line, since each edge sits half the width
     away from it. The trailing edge is the mirror: the same distance from the track's END. */
  function centred(scale: number, track = 1000) {
    const box = document.createElement("div");
    stubRect(box, { height: 400, width: track });
    const el = document.createElement("jx-split") as SplitElement;
    box.append(el);
    document.body.append(box);
    let size = 400;
    const written: number[] = [];
    bindSplit(el, {
      axis: "x",
      lead: (t) => t / 2,
      max: () => 900,
      min: () => 200,
      read: () => size,
      reset: () => 600,
      scale: () => scale,
      settle: () => {},
      write: (v) => {
        size = v;
        written.push(v);
      },
    });
    return { el, written };
  }

  test("the leading edge sits at the centre plus half the size, and a move is doubled back", () => {
    const { el, written } = centred(2);
    expect(el.value).toEqual(near(0.7));
    expect(el.min).toEqual(near(0.6));
    expect(el.max).toEqual(near(0.95));
    expect(el.collapse).toEqual(near(0.8));
    // The element reports the edge 30px further along: 30px of travel is 60px of width.
    report(el, 0.73);
    expect(written).toEqual([460]);
  });

  test("the trailing edge is the mirror image, and grows as the share falls", () => {
    const { el, written } = centred(-2);
    expect(el.value).toEqual(near(0.3));
    expect(el.min).toEqual(near(0.05));
    expect(el.max).toEqual(near(0.4));
    report(el, 0.27);
    expect(written).toEqual([460]);
  });

  test("lead is given the track, so a centre that is a fact about the track can be one", () => {
    const leads: number[] = [];
    const box = document.createElement("div");
    stubRect(box, { height: 400, width: 800 });
    const el = document.createElement("jx-split") as SplitElement;
    box.append(el);
    document.body.append(box);
    bindSplit(el, {
      axis: "x",
      lead: (t) => {
        leads.push(t);
        return 0;
      },
      max: () => 500,
      min: () => 100,
      read: () => 200,
      reset: () => 250,
      scale: () => 1,
      settle: () => {},
      write: () => {},
    });
    expect(new Set(leads)).toEqual(new Set([800]));
  });
});

describe("the fixed tracks the docks sit behind", () => {
  /* The offsets are constants here because they are constants in the generated frame sheet, and
     the two must agree or every share is off by a column. Read from the source of the sheet rather
     than the sheet, since the JSON is what a person edits. */
  test("agree with styles/shell-frame.json", async () => {
    const frame = JSON.parse(
      await Bun.file(new URL("../styles/shell-frame.json", import.meta.url)).text(),
    ) as Record<string, unknown>;
    const text = JSON.stringify(frame);
    expect(text).toContain(`[rail] ${DOCK_LEAD.left}px`);
    expect(text).toContain(`${DOCK_LEAD.bottom}px"`);
    expect(DOCK_LEAD.right).toBe(0);
  });
});

describe("the shell taking the handles down", () => {
  /* Runs LAST: it unbinds the three docks' handles through the shell's own lifecycle, which is how
     a remount avoids binding twice. After it, a share the element reports reaches nothing, and a
     dock the shell moves reaches no element. */
  test("unmount unbinds every handle and stops following the shell", () => {
    unmountShell();
    const before = shell.docks.left.size;
    report(left, (DOCK_LEAD.left + 420) / APP_W);
    expect(shell.docks.left.size).toBe(before);
    const shown = left.value;
    setDockSize("left", 199);
    expect(left.value).toBe(shown);
    mountShell();
  });
});
