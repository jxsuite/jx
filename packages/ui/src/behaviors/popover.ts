/**
 * The popover behaviour: the family's one clamp, and the small amount a panel needs that the closed
 * operator set cannot express.
 *
 * Everything here measures, calls an element's OWN `showPopover()` / `hidePopover()`, or writes the
 * element's own reactive state — which is exactly the allowed set (specs/ui.md §2). It writes no
 * attribute and no style on any element, its own included. Light dismissal, Escape, the top layer
 * and focus restoration are the platform's.
 *
 * Three things here are corrections rather than features:
 *
 * 1. **A popover restores focus relative to its INVOKER**, and the invoker is established either by a
 *    `popovertarget` button or by `showPopover({ source })`. A bare `showPopover()` leaves the
 *    panel with no source, so closing it returns the caret to wherever the document happened to
 *    leave it. {@link openAt} always passes a source, inside a `try`/`catch` because an engine that
 *    predates the options bag throws on it — and arity detection does not work, since
 *    `HTMLElement.prototype.showPopover.length` is 0 in a browser that accepts it. The catch is
 *    narrowed to a `TypeError`, because "the bag was rejected" and "the call was refused" are two
 *    different failures and retrying the second one bare throws it a second time.
 * 2. **A panel is usually opened by the platform, not by this module.** The two spellings the kit
 *    sanctions — a raw `<button popovertarget>` and `popovertarget` forwarded through a kit button
 *    — never reach {@link openAt}, so a measurement keyed on what `openAt` recorded is a
 *    measurement that almost never happens. {@link onToggle} therefore takes the trigger from the
 *    `ToggleEvent`'s own `source` (Chrome 152 carries it for an invoker click and for
 *    `showPopover({ source })` alike, measured), and falls back to the invoker that names the panel
 *    on an engine that does not.
 * 3. **A 0ms transition fires no `transitionend`.** `@(prefers-reduced-motion: reduce)` zeroes the
 *    `--jx-dur-*` tokens, so on a reader's machine the panel's transition is 0ms and the event that
 *    was to clear `settling` never arrives. So {@link onToggle} also clears it in a frame when the
 *    host is running no animations, and without that second path `data-jx-settling` sticks
 *    forever.
 *
 * **Placement is the platform's whenever it can be, and the clamp is the fallback.** A popover
 * shown from a source — `showPopover({ source })`, or a `popovertarget` invoker — has that source
 * as its IMPLICIT anchor, by the platform's own rule and with no `anchor-name` on anybody's
 * element, so the document's `position-area` rule places it, follows the source through scroll and
 * resize, and flips it when the first placement would overflow. This module's part is one decision,
 * made in {@link onBeforeToggle} before the panel is laid out: `anchored` is true for an opening
 * toggle with a source on a panel with no floor, and the clamp is skipped for an anchored panel on
 * an engine that positions by anchor. Everything else — a panel shown from nothing, a panel with a
 * floor, an engine without anchor positioning — is placed at `x` and `y` and clamped, exactly as
 * before. The measurement stays the fallback rather than going, because the kit publishes to site
 * authors and their readers' engines are not all one engine.
 *
 * @docs extending/ui-kit
 */

/** The reactive scope a popover-shaped document hands its handlers. */
export interface PopoverState {
  open?: boolean;
  settling?: boolean;
  matchWidth?: boolean;
  anchorWidth?: number;
  /** Whether the panel is showing from a source and therefore placed by the platform. */
  anchored?: boolean;
  x?: number;
  y?: number;
  floor?: number;
  [key: string]: unknown;
}

/**
 * Whether this engine positions by anchor at all — the same question the document's `@supports`
 * block asks, so the clamp is skipped exactly where the anchored rule applies and nowhere else. A
 * platform query, not a DOM write, and answered fresh each time because it is cheap and a test may
 * stub it either way.
 */
export function supportsAnchorPositioning(): boolean {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } })
    .CSS;
  return typeof css?.supports === "function" && css.supports("position-area", "block-end");
}

/**
 * The popover API as this module calls it.
 *
 * Declared here rather than reached for through the DOM types because an engine may not have it at
 * all — the kit publishes to site authors, and every call site guards on `typeof`.
 */
interface PopoverApi {
  showPopover?: (options?: { source?: HTMLElement }) => void;
  hidePopover?: () => void;
}

/** An element that may be a popover: every method the behaviour calls is optional. */
export type PopoverElement = HTMLElement;

/** The popover API of an element, whether or not this engine implements it. */
function apiOf(host: HTMLElement): PopoverApi {
  return host as unknown as PopoverApi;
}

/**
 * The element each SHOWING panel was opened from, for an engine whose `ToggleEvent` carries no
 * `source`.
 *
 * Off to the side rather than on the element, because a WeakMap is not a DOM write: `openAt` may
 * not put an attribute or a property on a consumer's trigger.
 *
 * **It is cleared when the panel closes**, and that is not tidiness. A `WeakMap` is weak in its
 * KEY: while a long-lived panel is alive it holds its value — a trigger, its subtree and every
 * listener on it — strongly, so a map that is only ever written pins each removed trigger of a
 * churning surface for as long as the panel exists. Every close path goes through the platform's
 * own toggle, so {@link onToggle} is where the entry goes; {@link close} does not need to repeat it
 * and deliberately does not.
 */
const anchors = new WeakMap<HTMLElement, Element>();

/** The element an event is being handled on, when it is an element at all. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement ? target : null;
}

/** The element `host` was last opened from, if one was named. */
export function anchorOf(host: HTMLElement): Element | null {
  return anchors.get(host) ?? null;
}

/**
 * Show a panel from an anchor, so the platform knows what to restore focus to.
 *
 * The host's door in, together with {@link close}: `open` is mirrored FROM the platform and writing
 * it shows nothing.
 *
 * @param host The panel element.
 * @param anchor The element the panel was opened from, if any.
 */
export function openAt(host: PopoverElement, anchor?: Element | null): void {
  const api = apiOf(host);
  if (typeof api.showPopover !== "function") {
    return;
  }
  if (!anchor) {
    api.showPopover();
    return;
  }
  /* BEFORE the call, because `beforetoggle` fires inside it and {@link onBeforeToggle} reads the
     map on an engine whose event carries no `source`. A refused open is taken back below, so the
     map still answers "what is this panel showing from" with nothing for a panel that did not
     open. */
  anchors.set(host, anchor);
  try {
    show(api, anchor);
  } catch (error) {
    anchors.delete(host);
    throw error;
  }
}

/**
 * The call itself, with the one retry it is allowed.
 *
 * ONLY a `TypeError` means "this engine has no options bag" — that is what a WebIDL overload or
 * dictionary conversion raises. Everything else is the call itself refusing: `showPopover` throws a
 * `DOMException` (`NotSupportedError`) for an element that is not a popover at all, and retrying
 * that one bare throws the same error a second time, out of `openAt` and into whatever bound the
 * handler. So it is re-raised from the FIRST call, unswallowed.
 */
function show(api: PopoverApi, anchor: Element): void {
  try {
    /* `ShowPopoverOptions.source` is typed `HTMLElement`, but any element can be a
       trigger and the platform only reads it as a focus origin. */
    api.showPopover?.({ source: anchor as HTMLElement });
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    api.showPopover?.();
  }
}

/**
 * Hide a panel. `open`, `data-open` and `settling` follow from the platform's own toggle.
 *
 * @param host The panel element.
 */
export function close(host: PopoverElement): void {
  const api = apiOf(host);
  if (typeof api.hidePopover === "function") {
    api.hidePopover();
  }
}

/**
 * The invoker that names `host` as its popover target, if the document holds one.
 *
 * The fallback for an engine whose `ToggleEvent` has no `source`. A read, never a write: the
 * trigger is a consumer's element and this module may not touch it (specs/ui.md §2 principle 5). It
 * answers the same element the platform would — the button carrying the attribute, which for a kit
 * button is the inner `<button part="control">` the prop is forwarded to.
 */
function invokerOf(host: HTMLElement): Element | null {
  const { id } = host;
  if (!id) {
    return null;
  }
  /* The attribute is compared rather than interpolated into a selector: an id is an author's
     string, and `[popovertarget="…"]` would need escaping to be either correct or safe. */
  for (const invoker of host.ownerDocument.querySelectorAll("[popovertarget]")) {
    if (invoker.getAttribute("popovertarget") === id) {
      return invoker;
    }
  }
  return null;
}

/**
 * What a toggle says the panel was opened from: the platform's own answer first, then whatever
 * {@link openAt} recorded, then the invoker that names the panel.
 */
function toggleSourceOf(host: HTMLElement, event: Event): Element | null {
  const { source } = event as Event & { source?: unknown };
  if (source instanceof Element) {
    return source;
  }
  return anchorOf(host) ?? invokerOf(host);
}

/**
 * Measure the anchor's border box into `anchorWidth`, under `matchWidth` only.
 *
 * On toggle only, which is parity with what a Spectrum overlay does at `@sp-opened` rather than a
 * regression: a resize observer on every open panel would measure on every frame of a drag.
 *
 * @param state The panel's reactive state.
 * @param host The panel element.
 * @param anchor The element to measure; defaults to whatever opened the panel.
 */
export function measureAnchor(
  state: PopoverState,
  host: HTMLElement,
  anchor: Element | null = anchorOf(host),
): void {
  if (state.matchWidth !== true || !anchor) {
    return;
  }
  const box = anchor.getBoundingClientRect();
  if (box.width > 0) {
    state.anchorWidth = Math.round(box.width);
  }
}

/**
 * Clear `settling` once the host is genuinely still.
 *
 * A frame later, because an animation started by this toggle does not exist yet when the toggle
 * event is dispatched; and only when nothing is running, so a real transition is left to
 * {@link onTransitionEnd}.
 */
function clearWhenStill(state: PopoverState, host: HTMLElement): void {
  const settle = (): void => {
    if (typeof host.getAnimations === "function" && host.getAnimations().length > 0) {
      return;
    }
    state.settling = false;
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(settle);
  } else {
    settle();
  }
}

/**
 * The platform's `beforetoggle`: where `anchored` is decided, and the only thing decided there.
 *
 * Before the show rather than on the toggle after it, because `toggle` is queued once the panel is
 * already in the top layer: a panel that learned it was anchored a frame late would paint once at
 * its coordinates and then jump to its anchor. A closing `beforetoggle` clears it, so the
 * coordinate rule is back in force for whatever shows the panel next.
 *
 * @param state The panel's reactive state.
 * @param event The platform's ToggleEvent.
 */
export function onBeforeToggle(state: PopoverState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  const opening = (event as { newState?: string }).newState === "open";
  const floor = Number(state.floor ?? 0);
  state.anchored = opening && floor <= 0 && toggleSourceOf(host, event) !== null;
}

/**
 * The platform's toggle: the one source of truth for `open`.
 *
 * An opening toggle measures the element the toggle names as its source and, unless the platform is
 * placing the panel by anchor, clamps it into its area; a closing one drops the recorded anchor.
 *
 * @param state The panel's reactive state.
 * @param event The platform's ToggleEvent.
 */
export function onToggle(state: PopoverState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  const opening = (event as { newState?: string }).newState === "open";
  state.open = opening;
  state.settling = true;
  if (opening) {
    measureAnchor(state, host, toggleSourceOf(host, event));
    if (!(state.anchored === true && supportsAnchorPositioning())) {
      clampIntoViewport(state, host, { floor: Number(state.floor ?? 0) });
    }
  } else {
    /* The panel is showing from nothing now, so the map stops holding the trigger alive. Here
       rather than in `close`, because light dismissal and Escape close a panel without it. */
    anchors.delete(host);
  }
  clearWhenStill(state, host);
}

/**
 * The panel's own transition finishing. A transition on a child is not the panel coming to rest, so
 * an event that merely bubbled through is ignored.
 *
 * @param state The panel's reactive state.
 * @param event The platform's TransitionEvent.
 */
export function onTransitionEnd(state: PopoverState, event: Event): void {
  if (event.target === event.currentTarget) {
    state.settling = false;
  }
}

/** What a caller knows about the area a panel is being clamped into. */
export interface ClampOptions {
  /** The lowest edge the panel may reach, in viewport pixels; 0 or absent means the viewport. */
  floor?: number;
  /**
   * A box to flip to the inline-start of when the panel would leave the viewport on the right.
   *
   * A submenu flips beside its parent panel rather than sliding over it; a standalone panel has
   * nothing to flip against and slides.
   */
  flipAgainst?: HTMLElement | null;
}

/**
 * How far below its own `inset-block-start` a panel's box lands.
 *
 * A panel's gap from its anchor is its own `margin-block-start` — the `--jx-popover-offset` token —
 * and a margin is applied AFTER the inset that `state.y` becomes. So a clamp of `floor - height`
 * puts the rendered bottom edge at `floor + offset`, over the very bar `floor` exists to stay off.
 * Read from the element rather than from the token: it is 0 for a menu, which carries no such
 * margin, and it follows a consumer who has retuned the token. (`getComputedStyle` resolves it to a
 * used pixel length: Chrome 152 answers `4px` for `var(--jx-popover-offset, 4px)`, measured.)
 */
function blockOffsetOf(panel: HTMLElement): number {
  // An intentional partial parse: a computed margin is "4px" and `Number()` answers NaN for it.
  // oxlint-disable-next-line unicorn/prefer-number-coercion
  const offset = Number.parseFloat(getComputedStyle(panel).marginBlockStart);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

/**
 * Keep a shown panel inside its area. The family's ONE clamp: `jx-menu` imports it from here, so a
 * menu and a panel cannot drift into two answers for the same question.
 *
 * Measured after a frame, because an unlaid-out panel is zero wide and would never appear to
 * overflow anything; a zero-size box (a test DOM) is left where it is.
 *
 * @param state The panel's reactive state, whose `x` and `y` are moved.
 * @param panel The element to measure.
 * @param options The floor, and what to flip against.
 */
export function clampIntoViewport(
  state: PopoverState,
  panel: HTMLElement,
  options: ClampOptions = {},
): void {
  const measure = (): void => {
    const box = panel.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      return;
    }
    const margin = 4;
    const floor = options.floor && options.floor > 0 ? options.floor : window.innerHeight;
    if (box.right > window.innerWidth - margin) {
      const parent = options.flipAgainst ?? null;
      const flipped = parent ? Math.round(parent.getBoundingClientRect().left) - box.width + 2 : -1;
      state.x =
        flipped >= margin
          ? flipped
          : Math.max(margin, Math.round(window.innerWidth - box.width - margin));
    }
    if (box.bottom > floor) {
      state.y = Math.max(margin, Math.round(floor - box.height - blockOffsetOf(panel)));
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(measure);
  } else {
    measure();
  }
}
