/// <reference lib="dom" />
/**
 * Panel-resize — the three dock splitters, driven as `jx-split` elements.
 *
 * Self-initializing module. Import it and the frame's three `jx-split`s become the docks' handles.
 *
 * The handles are the only thing here: dock sizes, their persistence and their projection onto the
 * grid's CSS custom properties all belong to the reactive `shell` record (`../shell`). A gesture
 * writes `setDockSize()` and the shell's own effect moves the track; a commit persists once.
 *
 * **What this module does now is TRANSLATE, in one place.** A dock is sized in PIXELS — a 240px
 * Navigator stays 240px when the window grows, which is what every dock a reader has met does — and
 * `jx-split` speaks in the leading side's SHARE of the box it divides, because a pane split is a
 * proportion that should survive a resize as one. Both models are right for their case, so the
 * element keeps its contract and this adapter carries the arithmetic: the share the element shows
 * is derived from the dock's pixels and the app box, an `input` is converted back, and a window
 * resize re-derives every number so the element never drags against a stale track. That listener is
 * the one thing `jx-split`'s own `gap` was designed to spare a host, and it is owed here for a
 * different reason — the dock's bounds are a pixel floor and a viewport ceiling, and neither is a
 * constant share.
 *
 * The docks also sit behind FIXED tracks the shell does not size — the rail's 56px column, the
 * command bar's 36px row, the status bar's 24px — so a handle's "leading side" is the dock PLUS an
 * offset. {@link ResizeTarget.lead} is that offset, and it is why `value` is not simply `size /
 * track`.
 */

import {
  DOCK_DEFAULT_SIZES,
  persistDocks,
  registerShellSurface,
  setDockSize,
  shell,
} from "../shell";
import type { DockId } from "../shell";
import { effect } from "../reactivity";
import { rectOf } from "../utils/geometry";

/**
 * What a handle drags.
 *
 * Generalised out of the three dock rows so the Edit column's own handle can be the fourth. Each is
 * sized in px against a different reference, which is the whole of the difference: `scale` converts
 * a pointer delta in px into the target's own units, and everything else — capture, the dragging
 * class, the text-selection suppression, the double-click reset, the one persist on release — is
 * identical and was worth having once.
 *
 * **The pane splitter was the fifth and is not any more**, and the reason is worth recording rather
 * than quietly dropping: this module binds pointer events and nothing else, so anything it drives
 * is unreachable from a keyboard. That is survivable for a dock, which has a command and a chord of
 * its own, and it was not for the pane split, which had neither — so the splitter is `jx-split`
 * (ui.md §5.5), an element with `role="separator"`, a tab stop, `aria-valuenow` and its own arrows.
 * Every remaining caller here still owes that door to somebody; see this module's own backlog note
 * in `specs/ui.md` §5.5.
 */
export interface ResizeTarget {
  /** Which coordinate the drag reads. */
  axis: "x" | "y";
  /** The current value. */
  read: () => number;
  /** Set it. Called on every pointermove, so it must be cheap and idempotent. */
  write: (value: number) => void;
  /** The value a double-click restores. */
  reset: () => number;
  /** Lower and upper bounds, read fresh because both can depend on the viewport. */
  min: () => number;
  max: () => number;
  /** Target units per pixel of pointer movement, signed: negative grows toward the origin. */
  scale: () => number;
  /** Persist. Called once on release and once on reset — never during the drag. */
  settle: () => void;
  /**
   * Pull the value onto a preferred one before it is written — magnetic snapping.
   *
   * Offered a value already inside `min`/`max`, and RE-CLAMPED afterwards, because a snap has no
   * way to know the bounds: `snapEditWidth` returns any target within its tolerance, so a
   * breakpoint declared 4px past the pane's own width would otherwise be reachable and the stored
   * width, the readout and the rendered column would all disagree. Clamping on both sides means a
   * target outside the range simply does not take.
   *
   * The modifier state is passed because a snap has to be escapable: the Edit canvas offers Alt as
   * the bypass. Omitted by the three docks, which snap to nothing.
   */
  snap?: (value: number, modifiers: { altKey: boolean; shiftKey: boolean }) => number;
  /**
   * The fixed tracks that sit on the dock's side of the handle, in px — the part of the leading
   * side the dock does NOT own. The Navigator's handle has the 56px rail before it; the Inspector's
   * has nothing after it; the Bottom dock's has the 24px status bar below it. Read fresh, because a
   * collapsed rail or a hidden status bar would move it.
   */
  lead?: () => number;
  /**
   * Which side of the handle the dock is on: `1` when the dock IS the leading side (it grows as the
   * share grows), `-1` when it is the trailing side. The same sign {@link scale} carries for a
   * pointer delta, stated once for the share arithmetic.
   */
  grow?: 1 | -1;
}

/**
 * The smallest a dock may be dragged to, per axis.
 *
 * The Bottom dock's floor is lower because its content is rows of text: 120px is four problems or
 * two activity rows, which is a useful dock, where 160px of a 24-row list is not meaningfully
 * more.
 */
const MIN_SIZE: Readonly<Record<"x" | "y", number>> = { x: 160, y: 120 };

/** The largest, as a fraction of the viewport along the dragged axis. */
const MAX_RATIO = 0.5;

/**
 * Which handle drives which dock, and which direction grows it.
 *
 * Three rows, and the third resizes on the other axis: `grow` is the sign a pointer moving in the
 * positive direction of `axis` contributes, so the Navigator grows rightward, and the Inspector and
 * the Bottom dock grow back toward the pointer's origin. The assistant is not here and never will
 * be — it is an Inspector TAB, resized by resizing the Inspector.
 */
const HANDLES: { selector: string; dock: DockId; axis: "x" | "y"; grow: 1 | -1 }[] = [
  { axis: "x", dock: "left", grow: 1, selector: "#resize-left" },
  { axis: "x", dock: "right", grow: -1, selector: "#resize-right" },
  { axis: "y", dock: "bottom", grow: -1, selector: "#resize-bottom" },
];

/**
 * Wire one handle to one dock.
 *
 * @param {HTMLElement} handle
 * @param {DockId} dock
 * @param {"x" | "y"} axis — which coordinate the drag reads
 * @param {1 | -1} grow — the sign a positive move along `axis` contributes to the dock's size
 */
/** Bound, snap, bound again — see {@link ResizeTarget.snap} for why the second one is not spare. */
function resolveValue(
  target: ResizeTarget,
  wanted: number,
  modifiers: { altKey: boolean; shiftKey: boolean },
): number {
  const bound = (v: number) => Math.min(target.max(), Math.max(target.min(), v));
  const bounded = bound(wanted);
  if (!target.snap) {
    return bounded;
  }
  return bound(target.snap(bounded, modifiers));
}

/** The `jx-split` element as the adapter writes it: a share, its bounds, and its collapse point. */
export interface SplitElement extends HTMLElement {
  value: number;
  min: number;
  max: number;
  collapse: number;
}

/**
 * The length of the box a handle divides, along its axis — the same box `jx-split` measures at
 * pointerdown, read here so the share this adapter writes and the one the element drags against are
 * two readings of one number.
 */
function trackOf(handle: HTMLElement, axis: "x" | "y"): number {
  for (let node = handle.parentElement; node; node = node.parentElement) {
    if (globalThis.getComputedStyle(node).display === "contents") {
      continue;
    }
    const box = rectOf(node);
    const length = axis === "x" ? box.width : box.height;
    if (length > 0) {
      return length;
    }
  }
  return 0;
}

/**
 * A dock's pixel size as the leading side's share of the track, and back.
 *
 * With the dock on the leading side (`grow: 1`) the share is `(lead + size) / track`; on the
 * trailing side it is `1 - (lead + size) / track`. Both directions are one function so the two
 * cannot drift: converting a share back to pixels is the same line solved for `size`.
 */
function shareOf(target: ResizeTarget, size: number, track: number): number {
  const lead = target.lead?.() ?? 0;
  const leading = (lead + size) / track;
  return (target.grow ?? 1) === 1 ? leading : 1 - leading;
}
function sizeOf(target: ResizeTarget, share: number, track: number): number {
  const lead = target.lead?.() ?? 0;
  const leading = (target.grow ?? 1) === 1 ? share : 1 - share;
  return leading * track - lead;
}

/**
 * Drive a `jx-split` from a {@link ResizeTarget}.
 *
 * The element owns the gesture, the keyboard, the role and the announcement; this owns the units.
 * Four writes go INTO the element — `value`, `min`, `max`, `collapse`, every one a share — and two
 * events come OUT: `input` on every move, which becomes `target.write` in pixels, and `change` on a
 * commit, which becomes `target.settle`. A window resize re-derives all four writes, because a
 * share that was right at 1200px is wrong at 1600px while the pixels it stands for are unchanged.
 *
 * The shell's own record can also move the size without a gesture — a command toggling a dock, a
 * restored session — so `sync` is exported for the caller that knows when that happened; the docks
 * subscribe through the shell surface's lifecycle.
 *
 * @returns A function that unbinds everything, for a handle taken out of the document.
 */
export function bindSplit(handle: SplitElement, target: ResizeTarget): () => void {
  const sync = (): void => {
    const track = trackOf(handle, target.axis);
    if (track <= 0) {
      return;
    }
    const lo = shareOf(target, target.min(), track);
    const hi = shareOf(target, target.max(), track);
    handle.min = Math.min(lo, hi);
    handle.max = Math.max(lo, hi);
    handle.collapse = shareOf(target, target.reset(), track);
    handle.value = shareOf(target, target.read(), track);
  };
  const onInput = (): void => {
    const track = trackOf(handle, target.axis);
    if (track <= 0) {
      return;
    }
    const wanted = sizeOf(target, handle.value, track);
    const value = resolveValue(target, wanted, { altKey: false, shiftKey: false });
    target.write(value);
    /* A snap or a clamp moved the pixels; say so back to the element, or its announced share and
       the drawn track disagree until the next gesture. An equal write is skipped by the runtime. */
    handle.value = shareOf(target, value, track);
  };
  const onChange = (): void => {
    target.settle();
  };
  handle.addEventListener("input", onInput);
  handle.addEventListener("change", onChange);
  globalThis.addEventListener("resize", sync);
  sync();
  bound.set(handle, sync);
  return () => {
    handle.removeEventListener("input", onInput);
    handle.removeEventListener("change", onChange);
    globalThis.removeEventListener("resize", sync);
    bound.delete(handle);
  };
}

/**
 * Drive a bare element by POINTER EVENTS ALONE — the pre-`jx-split` machinery, kept for one caller.
 *
 * The three docks are `jx-split`s now (see {@link bindSplit}); the Edit column's two handles are
 * not, and the reason is a gap in the element rather than in this module: that column SNAPS to the
 * document's breakpoints with Alt as the bypass, and `jx-split` has no snap hook and reports no
 * modifier state on its `input`. Until it does, this stays — and so does the SC 2.1.1 debt it
 * carries, recorded in `specs/ui.md` §5.5: a handle nothing but a pointer can move.
 */
export function setupHandle(handle: HTMLElement, target: ResizeTarget) {
  const { axis } = target;
  let drag: { start: number; startSize: number } | null = null;
  const coord = (e: { clientX: number; clientY: number }) => (axis === "x" ? e.clientX : e.clientY);

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events */
    }
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    drag = { start: coord(e), startSize: target.read() };
  });

  handle.addEventListener("pointermove", (e) => {
    if (!drag) {
      return;
    }
    const delta = (coord(e) - drag.start) * target.scale();
    target.write(resolveValue(target, drag.startSize + delta, e));
  });

  /*
   * Every way a drag can END, not just the happy one.
   *
   * `pointerup` was the only exit, so a capture lost any other way — the OS cancelling the pointer,
   * a touch gesture being stolen, the handle's subtree being replaced under it — left `drag`
   * non-null, `.dragging` on the element and, worst of all, `user-select: none` on the BODY, with
   * no further event able to clear any of it. At the shell's edge that never bit; a handle sitting
   * inside a canvas column over a cross-origin iframe is materially more exposed.
   */
  const end = (e: PointerEvent) => {
    if (!drag) {
      return;
    }
    drag = null;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* Synthetic events, and a capture that was already lost. */
    }
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    target.settle();
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);

  handle.addEventListener("dblclick", () => {
    target.write(target.reset());
    target.settle();
  });
}

/** Each bound handle's re-derivation, so a size the SHELL moved can be pushed to the element. */
const bound = new Map<HTMLElement, () => void>();

/** Re-derive every bound handle from the shell's record — after a command moved a dock. */
export function syncSplits(): void {
  for (const sync of bound.values()) {
    sync();
  }
}

/** The largest a dock may be dragged to along `axis`. */
function maxDockSize(axis: "x" | "y"): number {
  const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
  return viewport * MAX_RATIO;
}

/** A dock, as a {@link ResizeTarget}. The three rows of {@link HANDLES}, given the shared shape. */
function dockTarget(dock: DockId, axis: "x" | "y", grow: 1 | -1): ResizeTarget {
  return {
    axis,
    grow,
    lead: () => DOCK_LEAD[dock],
    max: () => maxDockSize(axis),
    min: () => MIN_SIZE[axis],
    read: () => shell.docks[dock].size,
    reset: () => DOCK_DEFAULT_SIZES[dock],
    scale: () => grow,
    settle: () => persistDocks(),
    write: (value) => setDockSize(dock, Math.round(value)),
  };
}

/**
 * The fixed tracks on each dock's side of its handle, in px of the frame's grid
 * (`styles/shell-frame.json`): the rail's `56px` column before the Navigator, nothing after the
 * Inspector, and the status bar's `24px` row below the Bottom dock. Constants here because they are
 * constants there, and the two must agree — a test holds them to the generated sheet.
 */
export const DOCK_LEAD: Readonly<Record<DockId, number>> = { bottom: 24, left: 56, right: 0 };

/** Attach every handle present in the document. Idempotent per element by construction. */
export function mountPanelResize(): void {
  for (const { axis, dock, grow, selector } of HANDLES) {
    const handle = document.querySelector<SplitElement>(selector);
    if (handle) {
      unbinders.push(bindSplit(handle, dockTarget(dock, axis, grow)));
    }
  }
  /* A dock the SHELL moves — a command opening it, a session restoring it — must reach the element
     too, or its announced share is the old one. One effect over the three sizes; every write the
     shell makes is a reactive write, so this is the same subscription the grid's own projection
     already holds. */
  stopSync = effect(() => {
    for (const { dock } of HANDLES) {
      void shell.docks[dock].size;
    }
    syncSplits();
  });
}

const unbinders: (() => void)[] = [];
let stopSync: (() => void) | null = null;

function unmountPanelResize(): void {
  for (const unbind of unbinders.splice(0)) {
    unbind();
  }
  stopSync?.();
  stopSync = null;
}

/* Mounted through the shell's own lifecycle rather than by a bare `mountPanelResize()` at module
   scope. The import-time call read `document` before anything had said the tree existed, which is
   the one part of `registerShellSurface`'s bargain this module was not keeping. */
registerShellSurface({ mount: mountPanelResize, unmount: unmountPanelResize });
