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
 * @docs extending/ui-kit
 */

import { close, openAt } from "./popover.ts";
import type { PopoverElement } from "./popover.ts";

/** The reactive scope a `jx-tooltip` document hands its handlers. */
export interface TooltipState {
  open?: boolean;
  x?: number;
  y?: number;
  delay?: number;
  arrow?: boolean;
  flipped?: boolean;
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

/** The disposer each bound instance is holding, keyed by its own reactive scope. */
const disposers = new WeakMap<object, () => void>();

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
 * pointer crossing a toolbar passes over every control in it.
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
    showTip(tip, trigger);
  };
  /** Hide, unless a trigger the reader has not removed is still holding the tip up. */
  const hideIfIdle = (): void => {
    cancel();
    if (onTrigger || onTip || focused) {
      return;
    }
    hideTip(tip);
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
    hideLater();
  };
  const onFocusIn = (): void => {
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
  /** Escape is DISMISSAL, which outranks every live trigger — SC 1.4.13 asks for both. */
  const onEscape = (event: Event): void => {
    if ((event as KeyboardEvent).key === "Escape") {
      cancel();
      hideTip(tip);
    }
  };

  const bindings: [EventTarget, string, EventListener][] = [
    [trigger, "pointerenter", onPointerEnter],
    [trigger, "pointerleave", onPointerLeave],
    [trigger, "focusin", onFocusIn],
    [trigger, "focusout", onFocusOut],
    // SC 1.4.13 hoverable: the pointer may rest on the tip itself, and the tip stays.
    [tip, "pointerenter", onTipEnter],
    [tip, "pointerleave", onTipLeave],
    [root, "keydown", onEscape],
  ];
  for (const [target, type, listener] of bindings) {
    target.addEventListener(type, listener, true);
  }
  return () => {
    cancel();
    for (const [target, type, listener] of bindings) {
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
 * The platform's toggle: the one source of truth for `open`, and where a shown tip is placed.
 *
 * Placing on toggle rather than on the gesture is what makes the declarative path work at all — an
 * `interestfor` trigger shows the tip without telling the element anything, and this is the first
 * moment the element hears about it.
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
  if (opening) {
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
  disposers.get(state)?.();
  disposers.set(state, bindTooltip(tip, trigger));
}

/**
 * Take the listeners off the control when the tip leaves the document.
 *
 * They are on an element the kit does not own and that outlives the tip, so without this a removed
 * tip keeps a control alive and keeps answering its pointer.
 *
 * @param state The tip's reactive state.
 */
export function onTooltipUnmount(state: TooltipState): void {
  disposers.get(state)?.();
  disposers.delete(state);
}
