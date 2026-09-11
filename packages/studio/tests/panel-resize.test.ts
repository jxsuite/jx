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
 */
import { stubRect } from "./harness";
import { describe, expect, test } from "bun:test";
import type { ResizeTarget, SplitElement } from "../src/ui/panel-resize";

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
const { DOCK_LEAD, bindSplit, setupHandle, syncSplits } = await import("../src/ui/panel-resize");
// The grid is projected by the shell's own effect, not by the resize module.
mountShell();

const left = document.querySelector("#resize-left") as SplitElement;
const right = document.querySelector("#resize-right") as SplitElement;
const bottom = document.querySelector("#resize-bottom") as SplitElement;

/** The element reporting a gesture: `input` on every move, `change` on the commit. */
function report(handle: SplitElement, value: number, type: "input" | "change" = "input"): void {
  handle.value = value;
  handle.dispatchEvent(new Event(type, { bubbles: true }));
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

describe("setupHandle — the pointer-only path the Edit column still uses", () => {
  /* Kept for exactly one caller (`canvas/edit-width-drag.ts`), whose handle SNAPS to breakpoints
     with Alt as the bypass — a hook `jx-split` does not have. Until it does, this is live code with
     a real reader behind it, and it keeps the assertions it had when it drove the docks. */
  function harness() {
    const handle = document.createElement("div");
    document.body.append(handle);
    let size = 200;
    const written: number[] = [];
    let settled = 0;
    const t: ResizeTarget = {
      axis: "x",
      max: () => 500,
      min: () => 100,
      read: () => size,
      reset: () => 250,
      scale: () => 1,
      settle: () => {
        settled += 1;
      },
      write: (v) => {
        size = v;
        written.push(v);
      },
    };
    setupHandle(handle, t);
    const at = (type: string, clientX: number) =>
      handle.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
    return {
      at,
      handle,
      get settled() {
        return settled;
      },
      get size() {
        return size;
      },
      written,
    };
  }

  test("pointermove without an active drag is a no-op", () => {
    const h = harness();
    h.at("pointermove", 300);
    expect(h.written).toEqual([]);
  });

  test("a drag writes the delta, and release settles once and clears the drag state", () => {
    const h = harness();
    h.at("pointerdown", 100);
    expect(h.handle.classList.contains("dragging")).toBe(true);
    expect(document.body.style.userSelect).toBe("none");
    h.at("pointermove", 160);
    expect(h.size).toBe(260);
    h.at("pointerup", 160);
    expect(h.handle.classList.contains("dragging")).toBe(false);
    expect(document.body.style.userSelect).toBe("");
    expect(h.settled).toBe(1);
    // A second release with no drag live is ignored rather than settling again.
    h.at("pointerup", 160);
    expect(h.settled).toBe(1);
  });

  test("double-click writes the reset value and settles", () => {
    const h = harness();
    h.at("dblclick", 0);
    expect(h.size).toBe(250);
    expect(h.settled).toBe(1);
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
