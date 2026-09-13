/**
 * `jx-tooltip`'s behaviour sidecar — deliberately the SMALL half of a split contract.
 *
 * HTML now has a declarative answer to "show this thing when the reader takes an interest in that
 * control": `interestfor` on the invoker, `popover="hint"` on the target, and
 * `interest-delay-start` / `interest-delay-end` in CSS. Chrome 152 ships all of it — measured, not
 * assumed: `interestForElement` is on `HTMLButtonElement.prototype` and resolves the attribute to
 * its target, `InterestEvent` is a constructor, and all three delay properties pass `CSS.supports`.
 * Firefox and Safari have not shipped it, and `@jxsuite/ui` publishes to site authors rather than
 * to one browser. So the DECLARATIVE PATH IS THE PRIMARY ONE and this module is what stands in
 * where it is missing.
 *
 * The split is decided per PAIR rather than per engine. {@link bindTooltip} binds nothing when the
 * engine knows interest invokers AND the trigger actually declares `interestfor` at this tip —
 * there the timers, the hover grace and Escape are all the platform's. Anything else (an older
 * engine, or a consumer who wired the tip up with `for` instead) gets them from here. So
 * {@link onTooltipReady} resolves EITHER wiring: an `interestfor` control is the shape the kit tells
 * authors to prefer, and on Firefox and Safari it is the shape that shows nothing at all without
 * this module.
 *
 * "AN OLDER ENGINE" INCLUDES THE DESKTOP APP. Studio ships inside Electrobun's CEF, and the pinned
 * release is Chromium 147 (`vendor/electrobun/package/src/shared/cef-version.ts`) — five releases
 * short of the attribute. So until that bump reaches 152 the ONLY end-user path to Studio runs the
 * fallback for every hinted button in its chrome, several hundred of them, and this module is not a
 * corner for other people's browsers but the behaviour a user sees. Three consequences are designed
 * for rather than tolerated: focus opens the tip only when it is KEYBOARD focus, the way the
 * platform's interest-on-focus does, so a click does not pin a tip open; Escape is ONE listener per
 * root shared by every bound tip, not one per tip on the document, so a keystroke in Studio walks
 * one handler rather than one per button; and a tip that is MOVED — a keyed `$map` reordering its
 * rows, a button re-parented into a toolbar — keeps its binding, because the runtime fires
 * `disconnectedCallback` for a move and never re-runs `onMount`, so an unmount that disposed at
 * once would strip a reordered row of its tooltip for good.
 *
 * IT ADDS LISTENERS TO AN ELEMENT THE KIT DOES NOT OWN, and that is said out loud rather than left
 * to be discovered in review. specs/ui.md §2 principle 5 forbids WRITING ATTRIBUTES or styles on
 * another element; `behaviors/menu.ts` already sets `row.tabIndex` on a slotted row, so a listener
 * — which changes nothing about the element and is taken off again by the disposer
 * {@link bindTooltip} returns — is inside the rule as written. Nothing here writes an attribute, a
 * property or a style on a trigger.
 *
 * The explicit hide is not belt and braces either. On an engine that does not know `popover="hint"`
 * the value is INVALID, and `popover`'s invalid-value default is `manual`: no light dismiss, no
 * Escape, and a tip that sticks until reload.
 *
 * The one thing here that is not about `jx-tooltip`'s own element is {@link mintHintId}: the id stem
 * a CONTROL that renders a tip for its `hint` needs, and cannot mint for itself. It lives with the
 * tip rather than with the buttons because it is the pair's contract — the tip's id, the control's
 * id, and the three attributes that name one from the other — and one module is what keeps the two
 * elements that use it from ever minting the same stem.
 *
 * @docs extending/ui-kit
 */

import { close, openAt, supportsAnchorPositioning } from "./popover.ts";
import type { PopoverElement } from "./popover.ts";

/** The reactive scope a `jx-tooltip` document hands its handlers. */
export interface TooltipState {
  open?: boolean;
  x?: number;
  y?: number;
  delay?: number;
  arrow?: boolean;
  flipped?: boolean;
  /** A `position-area` value the anchored rule reads. */
  placement?: string;
  /** Whether the platform is placing the tip against the control it was shown from. */
  anchored?: boolean;
  [key: string]: unknown;
}

/**
 * How long a tip stays up after the pointer leaves the control, in milliseconds.
 *
 * SC 1.4.13's "hoverable" is the reason there is a grace at all: a reader with a pointer-driven
 * magnifier has to be able to travel from the control onto the tip without it vanishing on the way,
 * and the two are separated by the arrow's own offset. Entering the tip cancels the pending hide,
 * so once the pointer is on it the tip is persistent.
 */
export const TOOLTIP_HIDE_GRACE_MS = 150;

/** How far below the control the tip sits, in pixels — the gap the arrow fills. */
const TOOLTIP_OFFSET = 6;

/** How close to the viewport edge the tip may come, in pixels. */
const MARGIN = 4;

/**
 * What each bound instance is holding, keyed by its own reactive scope: the tip, so that
 * {@link onTooltipUnmount} can tell a move from a removal, and the disposer.
 */
const bindings = new WeakMap<object, { tip: HTMLElement; dispose: () => void }>();

/**
 * The one Escape listener each root carries, and the dismissers of every tip bound within it.
 *
 * Per ROOT rather than per tip, because the listener has to be on an ancestor that sees the
 * keystroke wherever focus is — a tip hides on Escape whether or not its control is focused — and a
 * capture listener on the document per tip is one handler per hinted button on every keystroke. The
 * set is what Escape walks instead, and only a dismisser whose tip is showing does anything.
 */
const escapes = new WeakMap<Node, { listener: EventListener; dismiss: Set<() => void> }>();

/**
 * Watch `root` for Escape on behalf of one binding, sharing the listener with every other binding
 * in that root, and hand back the un-watch.
 *
 * The listener goes on with the first dismisser and comes off with the last, so a document with no
 * bound tip carries nothing.
 */
function watchEscape(root: Node, dismiss: () => void): () => void {
  let entry = escapes.get(root);
  if (!entry) {
    const set = new Set<() => void>();
    const listener = (event: Event): void => {
      if ((event as KeyboardEvent).key !== "Escape") {
        return;
      }
      for (const fn of set) {
        fn();
      }
    };
    root.addEventListener("keydown", listener, true);
    entry = { dismiss: set, listener };
    escapes.set(root, entry);
  }
  const { dismiss: set, listener } = entry;
  set.add(dismiss);
  return () => {
    set.delete(dismiss);
    if (set.size === 0 && escapes.get(root)?.listener === listener) {
      root.removeEventListener("keydown", listener, true);
      escapes.delete(root);
    }
  };
}

/**
 * Whether the platform is showing this tip, for an engine whose selector knows the answer.
 *
 * The binding's own `visible` flag covers what the binding showed; this covers a tip a host showed
 * in code, so that Escape still dismisses it. Guarded, because `:popover-open` is a parse error on
 * an engine without the popover API and a selector that throws would take Escape down with it.
 */
function popoverOpen(tip: HTMLElement): boolean {
  try {
    return tip.matches(":popover-open");
  } catch {
    return false;
  }
}

/**
 * Whether the trigger's focus is the kind a tip should answer at once: keyboard focus.
 *
 * The platform's interest-on-focus is keyboard-only — a click gives a control focus too, and a tip
 * that opened on every click and stayed until focus left would be pinned open under the pointer on
 * the fallback path while the declarative path showed nothing. `:focus-visible` is the platform's
 * own verdict on that and is asked first, of the element that actually took the focus (the event's
 * target, which for a kit button is the trigger itself and for a consumer's wrapper is a
 * descendant); `pointerHeld` — a pointer is down on the trigger, so whatever focus arrives now is
 * the click's — is the answer where the selector is not known, and the tie-break on an engine whose
 * `:focus-visible` is merely `:focus`.
 */
function keyboardFocus(focused: EventTarget | null, pointerHeld: boolean): boolean {
  if (pointerHeld) {
    return false;
  }
  if (!(focused instanceof Element)) {
    return true;
  }
  try {
    return focused.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * The re-measure each ANCHORED, SHOWING tip is running, keyed by its own reactive scope.
 *
 * Separate from {@link disposers} because the two have different lifetimes: a binding lives from
 * mount to unmount, and a watch lives from one toggle to the next. {@link onTooltipToggle} starts it
 * on an anchored open and stops it on close; {@link onTooltipUnmount} stops it for a tip removed
 * while it was showing, which is the one close the platform never announces.
 */
const watchers = new WeakMap<object, () => void>();

/**
 * Whether this engine implements interest invokers.
 *
 * Probed on `HTMLButtonElement.prototype` rather than by `CSS.supports`, because the CSS delay
 * properties and the HTML attribute have shipped separately before and it is the ATTRIBUTE that
 * decides whether anything shows at all.
 *
 * @returns True when `interestfor` resolves to an element on this engine.
 */
export function supportsInterestInvokers(): boolean {
  return (
    typeof HTMLButtonElement === "function" && "interestForElement" in HTMLButtonElement.prototype
  );
}

/**
 * Whether the platform will show this tip from this trigger without any help.
 *
 * Both halves are required: an engine with interest invokers still shows nothing for a trigger that
 * never declared `interestfor`, which is exactly the shape a consumer writes when they wire the tip
 * up through the element's own `for` instead.
 */
function platformOwns(tip: HTMLElement, trigger: Element): boolean {
  return (
    supportsInterestInvokers() && tip.id !== "" && trigger.getAttribute("interestfor") === tip.id
  );
}

/** Show the tip from its control, so the platform knows what the hint belongs to. */
function showTip(tip: HTMLElement, source: Element | null): void {
  openAt(tip as PopoverElement, source);
}

/** Hide the tip. `open` and `data-open` follow from the platform's own toggle. */
function hideTip(tip: HTMLElement): void {
  close(tip as PopoverElement);
}

/**
 * Bind a tip to the control it describes, and hand back the disposer that unbinds it.
 *
 * The two events `title=` never handled are the point of this function. `focusin` shows the tip
 * IMMEDIATELY — a keyboard reader who tabbed to the control has already committed, and a delay
 * there is only a stutter. `pointerenter` shows it after the element's own `delay`, because a
 * pointer crossing a toolbar passes over every control in it. Focus that a CLICK gave the control
 * counts for neither: the hover already scheduled the tip, and the focus is not one the reader is
 * reading — {@link keyboardFocus} is what tells the two apart.
 *
 * @param tip The `jx-tooltip` element.
 * @param trigger The control it describes. Nothing is written on it.
 * @returns A disposer that removes every listener this added.
 */
export function bindTooltip(tip: HTMLElement, trigger: Element): () => void {
  if (platformOwns(tip, trigger)) {
    return () => {
      /* The platform owns this pair; nothing was bound, so there is nothing to unbind. */
    };
  }
  const root = tip.getRootNode();
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  /*
   * SC 1.4.13 "persistent": the content stays until the hover OR focus trigger is removed, so the
   * two are counted separately rather than treated as one channel. A pointer that merely crosses a
   * control the reader has TABBED to removes the hover trigger and no more, and a blur while the
   * pointer rests on the tip removes the focus trigger and no more — either one alone hiding the
   * tip is the criterion failing.
   */
  let onTrigger = false;
  let onTip = false;
  let focused = false;
  /** A pointer is down on the trigger, so a focus that arrives now is the click's. */
  let pointerHeld = false;
  /** Whether this binding showed the tip and has not hidden it since. */
  let visible = false;

  const cancel = (): void => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const show = (): void => {
    cancel();
    visible = true;
    showTip(tip, trigger);
  };
  const hide = (): void => {
    visible = false;
    hideTip(tip);
  };
  /** Hide, unless a trigger the reader has not removed is still holding the tip up. */
  const hideIfIdle = (): void => {
    cancel();
    if (onTrigger || onTip || focused) {
      return;
    }
    hide();
  };
  const showLater = (): void => {
    cancel();
    const delay = Number((tip as { delay?: unknown }).delay) || 0;
    showTimer = setTimeout(show, delay);
  };
  const hideLater = (): void => {
    cancel();
    hideTimer = setTimeout(hideIfIdle, TOOLTIP_HIDE_GRACE_MS);
  };
  const onPointerEnter = (): void => {
    onTrigger = true;
    showLater();
  };
  const onPointerLeave = (): void => {
    onTrigger = false;
    // A pointer dragged off the control releases nowhere the trigger can hear; this is the release.
    pointerHeld = false;
    hideLater();
  };
  const onPointerDown = (): void => {
    pointerHeld = true;
  };
  const onPointerUp = (): void => {
    pointerHeld = false;
  };
  const onFocusIn = (event: Event): void => {
    /*
     * Only KEYBOARD focus is a trigger, matching the platform's interest-on-focus. A click's focus
     * neither shows the tip nor holds it up: the hover is what shows it, after `delay`, and the
     * hover leaving is what hides it — so a clicked button is not left with a tip pinned to it for
     * as long as it keeps the focus.
     */
    const keyboard = keyboardFocus(event.target, pointerHeld);
    pointerHeld = false;
    if (!keyboard) {
      return;
    }
    focused = true;
    show();
  };
  const onFocusOut = (): void => {
    focused = false;
    hideIfIdle();
  };
  const onTipEnter = (): void => {
    onTip = true;
    cancel();
  };
  const onTipLeave = (): void => {
    onTip = false;
    hideLater();
  };
  /**
   * Escape is DISMISSAL, which outranks every live trigger — SC 1.4.13 asks for both. Reached
   * through the root's one shared listener, and a no-op for a tip that is not showing, so an Escape
   * in a chrome of several hundred hinted buttons hides the one tip that is up.
   */
  const onEscape = (): void => {
    if (!visible && !popoverOpen(tip)) {
      return;
    }
    cancel();
    hide();
  };

  const listeners: [EventTarget, string, EventListener][] = [
    [trigger, "pointerenter", onPointerEnter],
    [trigger, "pointerleave", onPointerLeave],
    [trigger, "pointerdown", onPointerDown],
    [trigger, "pointerup", onPointerUp],
    [trigger, "focusin", onFocusIn],
    [trigger, "focusout", onFocusOut],
    // SC 1.4.13 hoverable: the pointer may rest on the tip itself, and the tip stays.
    [tip, "pointerenter", onTipEnter],
    [tip, "pointerleave", onTipLeave],
  ];
  for (const [target, type, listener] of listeners) {
    target.addEventListener(type, listener, true);
  }
  const unwatch = watchEscape(root, onEscape);
  return () => {
    cancel();
    unwatch();
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener, true);
    }
  };
}

/**
 * The control this tip is WIRED to, whichever of the two wirings the consumer used.
 *
 * The element's own `for` first, then a trigger that declares `interestfor` at it. Both are a
 * wiring rather than a mention, which is why the fallback binds either of them: on an engine
 * without interest invokers `interestfor` shows nothing by itself, and that engine is the whole
 * reason this module exists. A tip whose id is not a plain identifier takes only the first route —
 * the second is an attribute selector, and an id carrying a quote would make it throw rather than
 * miss.
 */
function triggerOf(state: TooltipState, tip: HTMLElement): HTMLElement | null {
  const root = tip.getRootNode() as Document | ShadowRoot;
  const named = typeof state["for"] === "string" ? state["for"] : "";
  const byFor = named === "" ? null : (root.getElementById?.(named) ?? null);
  if (byFor) {
    return byFor;
  }
  const own = tip.id;
  if (!/^[\w-]+$/.test(own)) {
    return null;
  }
  return root.querySelector<HTMLElement>(`[interestfor="${own}"]`);
}

/**
 * The control this tip is placed against, which is a wider question than which control wired it.
 *
 * {@link triggerOf}'s two routes first, then a control that merely describes itself with the tip —
 * the naming the element cannot write for itself, and the one shape where the tip is placed against
 * a control that never asked for it (a host showing the tip in code). Same identifier guard.
 */
function anchorOf(state: TooltipState, tip: HTMLElement): HTMLElement | null {
  const wired = triggerOf(state, tip);
  if (wired) {
    return wired;
  }
  const root = tip.getRootNode() as Document | ShadowRoot;
  const own = tip.id;
  if (!/^[\w-]+$/.test(own)) {
    return null;
  }
  return root.querySelector<HTMLElement>(`[aria-describedby~="${own}"]`);
}

/**
 * Put the tip under the control it describes, flipping above it when there is no room below.
 *
 * This is NOT `clampIntoViewport`, and the difference is the whole reason it is written out: a
 * panel that would run off the bottom slides up until it fits, which for a tip means parking over
 * the control the reader is pointing at. A tip flips to the other side of its control instead.
 *
 * Measured after a frame, because an unlaid-out tip is zero high and would never appear to overflow
 * anything; a zero-size control (a test DOM with no layout) is left alone entirely.
 *
 * The flip is written back as `flipped`, because the arrow has to follow it. The part is pinned to
 * one edge in CSS and cannot know which side of the control the tip landed on; a tip above its
 * control with an arrow still on its block-start edge points at the ceiling.
 *
 * @param state The tip's reactive state, whose `x`, `y` and `flipped` this writes.
 * @param tip The `jx-tooltip` element.
 */
export function placeTooltip(state: TooltipState, tip: HTMLElement): void {
  const anchor = anchorOf(state, tip);
  if (!anchor) {
    return;
  }
  const box = anchor.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) {
    return;
  }
  state.x = Math.round(box.left);
  state.y = Math.round(box.bottom + TOOLTIP_OFFSET);
  state.flipped = false;
  const measure = (): void => {
    const own = tip.getBoundingClientRect();
    if (own.width === 0 && own.height === 0) {
      return;
    }
    if (own.right > window.innerWidth - MARGIN) {
      state.x = Math.max(MARGIN, Math.round(window.innerWidth - own.width - MARGIN));
    }
    if (own.bottom > window.innerHeight - MARGIN) {
      state.y = Math.max(MARGIN, Math.round(box.top - own.height - TOOLTIP_OFFSET));
      state.flipped = true;
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(measure);
  } else {
    measure();
  }
}

/**
 * Which side of its control an ANCHORED tip is on, kept current for as long as it is showing, so
 * the arrow can follow a flip the element did not make — including one the platform makes LATER.
 *
 * `flipped` is the platform's answer read back — a tip whose box sits above its control's — and
 * nothing here moves the tip. It is measured a frame after the tip shows, because an unlaid-out tip
 * is zero high and has no side yet, and then again on every event that can move an anchored box
 * while it is open: the platform re-places the tip against its control through scroll and resize
 * and re-runs the try options when room runs out, and the arrow pinned in CSS cannot hear any of
 * that. One measurement was right for the frame the tip appeared in and wrong for every flip after
 * it (#310).
 *
 * **The causes, and why each is listened to where it is.** `scroll` is taken at the window in the
 * CAPTURE phase because scroll events do not bubble, and the tip's control may sit in a nested
 * scroller — an inspector panel, a menu — whose scrolling the window would otherwise never hear.
 * `resize` is the window's own. A `ResizeObserver` on the tip and its control covers the rest — the
 * tip's text arriving late, or the control growing — and is cheap at two elements, so it is taken
 * where the engine has one and simply not taken elsewhere. Every cause SCHEDULES rather than
 * measures: a scroll fires per pixel and a measurement forces layout, so they are coalesced to one
 * `getBoundingClientRect` pair per animation frame.
 *
 * The watch is torn down on close, and the disposer is returned as well as kept, so a host that
 * called this itself can stop it. Calling it again for the same state replaces the watch rather
 * than doubling it. A tip with no control has no side to be on and is not watched; an engine with
 * no animation frames (a DOM with no layout) measures once, synchronously, and watches nothing: it
 * has no frames to coalesce to and nothing that scrolls.
 *
 * @param state The tip's reactive state, whose `flipped` this writes.
 * @param tip The `jx-tooltip` element.
 * @returns A disposer that stops the watch and cancels a measurement it had scheduled.
 */
export function measureAnchoredFlip(state: TooltipState, tip: HTMLElement): () => void {
  watchers.get(state)?.();
  const anchor = anchorOf(state, tip);
  const measure = (): void => {
    if (!anchor || state.anchored !== true) {
      return;
    }
    const own = tip.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    if (own.width === 0 && own.height === 0) {
      return;
    }
    state.flipped = own.bottom <= box.top;
  };
  if (!anchor || typeof requestAnimationFrame !== "function") {
    /* No control to be on a side of, or no frames to coalesce to: one synchronous reading, which
       is nothing at all in the first case, and no watch. */
    measure();
    return () => {
      /* Measured once and watched nothing, so there is nothing to stop. */
    };
  }
  let frame: number | null = null;
  const run = (): void => {
    frame = null;
    measure();
  };
  /** Ask for one measurement in the next frame, however many causes ask before it arrives. */
  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(run);
    }
  };
  /* Passive, because nothing here ever prevents a scroll, so the engine need not wait for the
     listener before it scrolls. Removal keys on `capture` alone, which is why it is spelled twice. */
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  if (observer) {
    observer.observe(tip);
    observer.observe(anchor);
  }
  const stop = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    window.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    observer?.disconnect();
    if (watchers.get(state) === stop) {
      watchers.delete(state);
    }
  };
  watchers.set(state, stop);
  schedule();
  return stop;
}

/**
 * The platform's `beforetoggle`: where `anchored` is decided, before the tip is laid out.
 *
 * An opening from a control the platform names (`source` on the event, which an `interestfor`
 * trigger and `showPopover({ source })` both set) or that the binding knows is anchored; a closing
 * clears it. A tip shown from nothing — a host that placed it itself — keeps its coordinates.
 *
 * @param state The tip's reactive state.
 * @param event The platform's ToggleEvent.
 */
export function onTooltipBeforeToggle(state: TooltipState, event: Event): void {
  const tip = event.currentTarget;
  if (!(tip instanceof HTMLElement)) {
    return;
  }
  const opening = (event as { newState?: string }).newState === "open";
  const { source } = event as Event & { source?: unknown };
  const from = source instanceof Element ? source : anchorOf(state, tip);
  state.anchored = opening && from !== null;
  if (!opening) {
    state.flipped = false;
  }
}

/**
 * The platform's toggle: the one source of truth for `open`, and where a shown tip is placed.
 *
 * Placing on toggle rather than on the gesture is what makes the declarative path work at all — an
 * `interestfor` trigger shows the tip without telling the element anything, and this is the first
 * moment the element hears about it. An anchored tip on an engine that positions by anchor is not
 * placed here at all: the platform has it, and the element only reads back which side it chose, for
 * as long as it is showing. The closing toggle is where that reading stops.
 *
 * @param state The tip's reactive state.
 * @param event The platform's ToggleEvent.
 */
export function onTooltipToggle(state: TooltipState, event: Event): void {
  const tip = event.currentTarget;
  if (!(tip instanceof HTMLElement)) {
    return;
  }
  const opening = (event as { newState?: string }).newState === "open";
  state.open = opening;
  if (!opening) {
    // A closed tip has no side, and the watch that was following it has nothing left to follow.
    watchers.get(state)?.();
    return;
  }
  if (state.anchored === true && supportsAnchorPositioning()) {
    measureAnchoredFlip(state, tip);
  } else {
    placeTooltip(state, tip);
  }
}

/**
 * Bind the tip to the control it is wired to, once the element has rendered.
 *
 * EITHER WIRING, because the split is per pair rather than per spelling: the control `for` names,
 * or the control that declares `interestfor` at this tip. The second is the shape the element tells
 * authors to prefer, and on an engine without interest invokers it is the shape that shows nothing
 * at all unless it is bound here — {@link bindTooltip} is what decides, and it binds nothing when
 * the platform already owns the pair.
 *
 * The wiring is read at mount and not watched: an element cannot hear its own attribute change from
 * a sidecar, and a host that wires a tip up later calls {@link bindTooltip} itself.
 *
 * @param state The tip's reactive state.
 * @param event The `jx-ready` the element dispatches on itself when it has rendered.
 */
export function onTooltipReady(state: TooltipState, event: Event): void {
  const tip = event.currentTarget;
  if (!(tip instanceof HTMLElement)) {
    return;
  }
  const trigger = triggerOf(state, tip);
  if (!trigger) {
    return;
  }
  bindings.get(state)?.dispose();
  bindings.set(state, { dispose: bindTooltip(tip, trigger), tip });
}

/**
 * Take the listeners off the control when the tip leaves the document — and only then.
 *
 * They are on an element the kit does not own and that outlives the tip, so without this a removed
 * tip keeps a control alive and keeps answering its pointer.
 *
 * A MOVE is not a removal, and the runtime cannot tell the element which one it is having: a keyed
 * `$map` reorders its kept rows with `before()`, which fires `disconnectedCallback` and then
 * `connectedCallback` on every element in the row, and the second is a no-op for an element that
 * has already initialised — `onMount` and the `jx-ready` that binds the control never run again. So
 * the disposal waits a microtask and is skipped when the tip is back in a document by then, which a
 * synchronous move always is. A tip taken out for good is disposed as before, one tick later; a tip
 * that was rebound in the meantime (a re-mount, which changes the entry) is not touched.
 *
 * @param state The tip's reactive state.
 */
export function onTooltipUnmount(state: TooltipState): void {
  /* A tip removed while showing gets no toggle from the platform, so its flip watch is stopped
     here or not at all — a watch is a window listener, which would hold the removed tip forever.
     Stopped at once rather than a tick later: a MOVED tip that was open loses nothing but its
     re-measure until its next open re-arms it, and the binding below is the thing a move must keep. */
  watchers.get(state)?.();
  const bound = bindings.get(state);
  if (!bound) {
    return;
  }
  queueMicrotask(() => {
    if (bindings.get(state) !== bound) {
      return;
    }
    if (bound.tip.isConnected) {
      return;
    }
    bound.dispose();
    bindings.delete(state);
  });
}

/** How many hint stems have been minted, so no two hinted controls share one. */
let mintedHints = 0;

/**
 * Mint the id stem a control that draws its `hint` as a `jx-tooltip` needs, and write it into
 * `uid`.
 *
 * `jx-action-button` and `jx-button` render their tip as a child of their own element, and the pair
 * is wired by id in both directions: `interestfor` on the control naming the tip, which is what
 * shows it with nothing bound on an engine that has interest invokers (Chrome 152 — and NOT the
 * desktop app's Chromium 147, which is on the fallback path until the CEF bump reaches it); `for`
 * on the tip naming the control, which is what {@link onTooltipReady} resolves by id rather than by
 * an attribute scan of the document; and `aria-describedby` on the control naming the tip again,
 * which is what makes the hint a DESCRIPTION beside the name rather than the name itself. So a
 * consumer writes none of the three, and two hinted buttons in one toolbar cannot collide. A
 * document cannot mint the stem: the closed operator set has no counter and no identity, which is
 * the sidecar case specs/ui.md §3.2 sanctions. The stem carries the host's own tag, so an id read
 * off the inspector says what it belongs to.
 *
 * The write lands after the first render, because `onMount` runs a microtask after it — so the tip
 * and the three attributes appear on the second pass, and every binding that reads the stem guards
 * on it being there. A control disabled at mount never gets a tip at all; its `hint` is the native
 * `title` until it is enabled.
 *
 * @param state The control's reactive scope, whose `uid` this writes.
 * @param host The `jx-action-button` or `jx-button` element.
 */
export function mintHintId(state: Record<string, unknown>, host: HTMLElement): void {
  mintedHints += 1;
  state["uid"] = `${host.localName}-${mintedHints}`;
}
