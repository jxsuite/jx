/// <reference lib="dom" />
/**
 * Panel-resize — the three dock splitters, driven as `jx-split` elements, and the adapter that
 * drives any other pixel-sized thing from one.
 *
 * Self-initializing module. Import it and the frame's three `jx-split`s become the docks' handles.
 *
 * The handles are the only thing here: dock sizes, their persistence and their projection onto the
 * grid's CSS custom properties all belong to the reactive `shell` record (`../shell`). A gesture
 * writes `setDockSize()` and the shell's own effect moves the track; a commit persists once.
 *
 * **What this module does is TRANSLATE, in one place.** A dock is sized in PIXELS — a 240px
 * Navigator stays 240px when the window grows, which is what every dock a reader has met does — and
 * `jx-split` speaks in the leading side's SHARE of the box it divides, because a pane split is a
 * proportion that should survive a resize as one. Both models are right for their case, so the
 * element keeps its contract and this adapter carries the arithmetic: the share the element shows
 * is derived from the target's pixels and the track, an `input` is converted back, and the numbers
 * are re-derived at the START of every gesture and on every window resize, so the element never
 * drags against a stale track. Those listeners are the one thing `jx-split`'s own `gap` was
 * designed to spare a host, and they are owed here for a different reason — a dock's bounds are a
 * pixel floor and a viewport ceiling, and neither is a constant share.
 *
 * The docks also sit behind FIXED tracks the shell does not size — the rail's 56px column, the
 * command bar's 36px row, the status bar's 24px — so a handle's "leading side" is the dock PLUS an
 * offset. {@link ResizeTarget.lead} is that offset, and it is why `value` is not simply `size /
 * track`.
 *
 * **The Edit column's two handles are the fourth and fifth thing this drives**, through the same
 * {@link bindSplit} (`canvas/edit-width-drag.ts`), and they are why a snap is here at all: that
 * column pulls its width onto the document's breakpoints with Alt as the way through, and the
 * element reports the modifiers each `input` was made with precisely so a host's own snap can
 * decide. The last handle that was driven by pointer events alone — `setupHandle`, kept for that
 * one caller while the element had no such hook — is gone with the gap it survived for, and with it
 * the SC 2.1.1 debt `specs/ui.md` §5.5 recorded.
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
import { splitModifiersOf } from "@jxsuite/ui/behaviors/split";
import type { SplitModifiers } from "@jxsuite/ui/behaviors/split";

/**
 * What a handle drives: a pixel-sized thing, described so {@link bindSplit} can speak to a
 * `jx-split` about it in shares.
 *
 * Generalised out of the three dock rows so the Edit column's own handles can be the fourth and
 * fifth. Each is sized in px against a different reference, which is the whole of the difference:
 * `scale` says how many of the target's units one pixel of the HANDLE's travel is worth, and which
 * way — and everything else, the element owns: capture, the drag state, the keyboard, the collapse
 * toggle, and the `input`/`change` pair this adapter turns into `write` and `settle`.
 *
 * **There is no pointer path left in this module**, and it is worth recording why rather than
 * quietly dropping it: a handle driven by pointer events alone is unreachable from a keyboard,
 * which is an SC 2.1.1 failure however it is drawn. The pane split moved to `jx-split` first (ui.md
 * §5.5), the three docks followed, and the Edit column was last because its handle SNAPS — and the
 * element had no way to tell a host which modifiers a step carried. It has now: every `input`
 * carries them, so a snap lives in {@link bindSplit} rather than in a pointer handler of this
 * module's own.
 */
export interface ResizeTarget {
  /** Which coordinate the drag reads. */
  axis: "x" | "y";
  /** The current value. */
  read: () => number;
  /** Set it. Called on every `input`, so it must be cheap and idempotent. */
  write: (value: number) => void;
  /** The value the collapse toggle — Enter, or a double click — goes to. */
  reset: () => number;
  /** Lower and upper bounds, read fresh because both can depend on the viewport. */
  min: () => number;
  max: () => number;
  /**
   * Target units per pixel of the handle's travel, signed.
   *
   * The magnitude is a ratio: a dock's edge moves as far as the dock grows, so it is `1`; the Edit
   * column is centred, so an edge that moves `dx` widens the column by `2·dx`, and it is `2`. The
   * sign is which side of the handle the target is on: positive when the target IS the leading side
   * and grows as the share grows, negative when it is the trailing side. One statement of both,
   * because a pointer delta no longer reads it separately from the share arithmetic.
   */
  scale: () => number;
  /** Persist. Called once per commit — never during the drag. */
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
   * The modifiers are the ones the element reported on this step — a pointer move and a keyboard
   * step alike — because a snap has to be escapable: the Edit canvas offers Alt as the bypass.
   * Omitted by the three docks, which snap to nothing.
   */
  snap?: (value: number, modifiers: SplitModifiers) => number;
  /**
   * The FIXED length of the leading side, in px — the part the target's own size does not account
   * for. For a dock it is the tracks the shell does not size on the dock's side of the handle: the
   * Navigator's handle has the 56px rail before it, the Inspector's has nothing after it, the
   * Bottom dock's has the 24px status bar below it. For the centred Edit column it is the centre
   * line itself, since each edge sits half the width away from it. Read fresh, and given the track
   * because a centre is a fact about the track: a collapsed rail, a hidden status bar or a
   * scrollbar would move any of these.
   */
  lead?: (track: number) => number;
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
 * Three rows, and the third resizes on the other axis: `grow` is the sign a handle moving in the
 * positive direction of `axis` contributes, so the Navigator grows rightward, and the Inspector and
 * the Bottom dock grow back toward the origin. It becomes the sign of the target's `scale`. The
 * assistant is not here and never will be — it is an Inspector TAB, resized by resizing the
 * Inspector.
 */
const HANDLES: { selector: string; dock: DockId; axis: "x" | "y"; grow: 1 | -1 }[] = [
  { axis: "x", dock: "left", grow: 1, selector: "#resize-left" },
  { axis: "x", dock: "right", grow: -1, selector: "#resize-right" },
  { axis: "y", dock: "bottom", grow: -1, selector: "#resize-bottom" },
];

/** Bound, snap, bound again — see {@link ResizeTarget.snap} for why the second one is not spare. */
function resolveValue(target: ResizeTarget, wanted: number, modifiers: SplitModifiers): number {
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
 * A target's pixel size as the leading side's share of the track, and back.
 *
 * The handle sits `lead + size / |scale|` px into the leading side. With the target ON the leading
 * side (`scale > 0`) the share is that over the track; on the trailing side it is one minus that.
 * Both directions are one pair so the two cannot drift: converting a share back to pixels is the
 * same line solved for `size`.
 */
function shareOf(target: ResizeTarget, size: number, track: number): number {
  const scale = target.scale();
  const lead = target.lead?.(track) ?? 0;
  const leading = (lead + size / Math.abs(scale)) / track;
  return scale > 0 ? leading : 1 - leading;
}
function sizeOf(target: ResizeTarget, share: number, track: number): number {
  const scale = target.scale();
  const lead = target.lead?.(track) ?? 0;
  const leading = scale > 0 ? share : 1 - share;
  return (leading * track - lead) * Math.abs(scale);
}

/**
 * Drive a `jx-split` from a {@link ResizeTarget}.
 *
 * The element owns the gesture, the keyboard, the role and the announcement; this owns the units.
 * Four writes go INTO the element — `value`, `min`, `max`, `collapse`, every one a share — and two
 * events come OUT: `input` on every move, which becomes `target.write` in pixels, and `change` on a
 * commit, which becomes `target.settle`.
 *
 * **The four writes are re-derived at the start of every gesture**, on `pointerdown` and `keydown`
 * in the capture phase so they land before the element records where the gesture started. A share
 * that was right against one track is wrong against another while the pixels it stands for are
 * unchanged, and the track moves for more reasons than a window resize: the Edit column's is the
 * canvas, which a dock opening, a pane split or a scrollbar all change with no event this adapter
 * could have heard. Measuring at the gesture is the same rule the element itself keeps for its
 * track, and it is what stops the first pixel of a drag being a jump. A window resize re-derives
 * them too, so the ANNOUNCED share is honest between gestures and not only during one.
 *
 * **The snap runs here**, on the pixels the element asked for and before they are written, with the
 * modifiers the element reported for this step — see {@link ResizeTarget.snap}. The corrected
 * pixels go BACK to the element as a share, or its announced value and the drawn track would
 * disagree until the next step; a pointer gesture recomputes from its origin on every move, so the
 * correction never compounds.
 *
 * The shell's own record can also move a dock without a gesture — a command toggling it, a restored
 * session — so {@link syncSplits} is exported for the caller that knows when that happened; the
 * docks subscribe through the shell surface's lifecycle.
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
  const onInput = (event: Event): void => {
    const track = trackOf(handle, target.axis);
    if (track <= 0) {
      return;
    }
    const wanted = sizeOf(target, handle.value, track);
    const value = resolveValue(target, wanted, splitModifiersOf(event));
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
  handle.addEventListener("pointerdown", sync, true);
  handle.addEventListener("keydown", sync, true);
  globalThis.addEventListener("resize", sync);
  sync();
  bound.set(handle, sync);
  return () => {
    handle.removeEventListener("input", onInput);
    handle.removeEventListener("change", onChange);
    handle.removeEventListener("pointerdown", sync, true);
    handle.removeEventListener("keydown", sync, true);
    globalThis.removeEventListener("resize", sync);
    bound.delete(handle);
  };
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
