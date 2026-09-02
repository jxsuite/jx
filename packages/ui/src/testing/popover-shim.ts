/**
 * What happy-dom 20 lacks and the kit's overlays are built on: the popover API. A test-only shim,
 * exported as `@jxsuite/ui/testing/popover-shim` so a host's own DOM harness installs the same
 * one.
 *
 * `showPopover()` / `hidePopover()` / `togglePopover()` are defined on `HTMLElement.prototype` only
 * when missing. The shim keeps the parts of the standard's algorithm the kit relies on — a
 * `popover` attribute is required, `beforetoggle` fires synchronously and `toggle` in a microtask
 * with `oldState`/`newState`, showing an `auto` popover light-dismisses unrelated `auto` popovers,
 * hiding one hides the popovers nested inside it, a mousedown outside or an Escape hides the
 * topmost `auto` one — and marks a showing popover with `data-popover-open`, because
 * `:popover-open` never matches here. Test-only: paint, the top layer and real focus restoration
 * are the browser's to verify.
 */

interface PopoverState {
  open: Set<HTMLElement>;
  /** The invoker each showing popover was shown from, when `showPopover({ source })` named one. */
  invokers: WeakMap<HTMLElement, Element>;
}

declare global {
  interface Window {
    __jxPopoverShim?: PopoverState;
  }
}

function toggleEvent(type: "beforetoggle" | "toggle", oldState: string, newState: string): Event {
  const event = new Event(type, { bubbles: false, cancelable: type === "beforetoggle" });
  Object.assign(event, { newState, oldState });
  return event;
}

function isAuto(el: HTMLElement): boolean {
  return el.getAttribute("popover") !== "manual";
}

export function installPopoverShim(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    showPopover?: (options?: { source?: Element }) => void;
    hidePopover?: () => void;
    togglePopover?: (force?: boolean) => boolean;
  };
  if (typeof proto.showPopover === "function") {
    return;
  }
  const state: PopoverState = { invokers: new WeakMap(), open: new Set() };
  window.__jxPopoverShim = state;

  const hide = (el: HTMLElement): void => {
    if (!state.open.has(el)) {
      return;
    }
    for (const other of [...state.open].toReversed()) {
      if (other !== el && el.contains(other)) {
        hide(other);
      }
    }
    el.dispatchEvent(toggleEvent("beforetoggle", "open", "closed"));
    state.open.delete(el);
    delete el.dataset.popoverOpen;
    queueMicrotask(() => el.dispatchEvent(toggleEvent("toggle", "open", "closed")));
  };

  proto.showPopover = function showPopover(
    this: HTMLElement,
    options?: { source?: Element },
  ): void {
    if (!this.hasAttribute("popover")) {
      throw new DOMException("Not a popover element", "NotSupportedError");
    }
    if (state.open.has(this)) {
      return;
    }
    // An invoker is not "outside": a mousedown on the button that opened a popover leaves it to
    // The button's own click, which is what makes a toggle a toggle.
    if (options?.source) {
      state.invokers.set(this, options.source);
    } else {
      state.invokers.delete(this);
    }
    if (isAuto(this)) {
      const showing = [...state.open];
      for (const other of showing) {
        if (isAuto(other) && !other.contains(this)) {
          hide(other);
        }
      }
    }
    this.dispatchEvent(toggleEvent("beforetoggle", "closed", "open"));
    state.open.add(this);
    this.dataset.popoverOpen = "";
    queueMicrotask(() => this.dispatchEvent(toggleEvent("toggle", "closed", "open")));
  };
  proto.hidePopover = function hidePopover(this: HTMLElement): void {
    if (!this.hasAttribute("popover")) {
      throw new DOMException("Not a popover element", "NotSupportedError");
    }
    hide(this);
  };
  proto.togglePopover = function togglePopover(this: HTMLElement, force?: boolean): boolean {
    const show = force ?? !state.open.has(this);
    if (show) {
      this.showPopover!();
    } else {
      this.hidePopover!();
    }
    return show;
  };

  document.addEventListener(
    "mousedown",
    (event) => {
      for (const el of [...state.open].toReversed()) {
        const target = event.target instanceof Node ? event.target : null;
        const inside =
          target !== null &&
          (el.contains(target) || state.invokers.get(el)?.contains(target) === true);
        if (isAuto(el) && !inside) {
          hide(el);
        }
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") {
        return;
      }
      const top = [...state.open].toReversed().find((el) => isAuto(el));
      if (top) {
        hide(top);
      }
    },
    true,
  );
}
