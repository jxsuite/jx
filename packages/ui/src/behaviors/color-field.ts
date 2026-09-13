/**
 * `jx-color-field`'s behaviour sidecar: the one place a colour is taken apart and put back
 * together, and the one listener the whole composed control speaks through.
 *
 * The element is five controls around one value — a swatch that opens the picker, a text field, a
 * saturation/brightness square, a hue track, an alpha track, and the two doors to the system's own
 * picker — and every one of them is a real control that fires real events. Two things follow, and
 * they are the whole design.
 *
 * ONE VALUE, TWO REPRESENTATIONS, AND A GUARD BETWEEN THEM. What the element HOLDS is a string a
 * stylesheet can read; what its picker MOVES is four numbers. Neither can be derived from the other
 * for free: a grey has no hue, so a round trip through the string would send the hue slider back to
 * red every time the reader dragged the saturation to zero. So `value` is the truth, the channels
 * are a working copy, and {@link syncFromValue} rewrites the copy only when the two genuinely
 * disagree — compared as hex, which is the one spelling both sides can be reduced to. That guard is
 * also what stops the loop: composing writes `value`, the write moves `data-value`, the observer
 * calls the sync, and the sync finds nothing to do.
 *
 * ONE LISTENER, AT THE ROOT. Five controls' worth of `input` and `change` would otherwise leave
 * this element with `e.target` being an inner range, a text input or a native colour well depending
 * on which one the reader touched — a host would have to know the element's insides to read its
 * value. Instead the root listens once, works out which channel fired from the `data-channel` the
 * document writes beside each `part`, stops the original, and re-dispatches the platform's own two
 * names FROM THE HOST. `e.target` is always the `jx-color-field`; `e.target.value` is always the
 * colour. The re-dispatch does not re-enter, because an event whose target is the host is this
 * element's own and returns immediately.
 *
 * THE SYSTEM PICKER IS A DOOR, NEVER THE CONTROL. `<input type="color">` and `EyeDropper` are here
 * to reach what the page cannot draw — the operating system's picker, and the pixels outside the
 * document — and both are optional: an engine without `EyeDropper` simply has no such button, and
 * the element is fully operable by keyboard with neither.
 *
 * @docs extending/ui-kit
 */

import {
  formatHex,
  formatOklch,
  hsvToRgb,
  parseColor,
  preferredInk,
  rgbToHsv,
  srgbToOklch,
} from "../color.ts";
import type { Rgb } from "../color.ts";
import { close, openAt } from "./popover.ts";

/** The tag this sidecar belongs to. */
const HOST = "jx-color-field";

/** The reactive scope a `jx-color-field` document hands its handlers. */
export interface ColorFieldState {
  /** The colour, spelled as `format` says. */
  value: string;
  /**
   * The colour behind `value` when `value` is a reference this page cannot resolve; empty when the
   * value stands for itself. Drawn by the chip and opened on by the picker, never written.
   */
  resolved: string;
  /** `hex` or `oklch`: which spelling {@link compose} writes. */
  format: string;
  /** Whether the alpha channel is offered at all. */
  alpha: boolean;
  /** Hue, 0-360. Kept across a colour going grey, which is why it is state and not a derivation. */
  hue: number;
  /** Saturation, 0-100. */
  saturation: number;
  /** Brightness, 0-100. */
  brightness: number;
  /** Opacity, 0-100, so it shares the sliders' units. */
  opacity: number;
  /** What the text field is showing, which is not `value` while the reader is mid-word. */
  text: string;
  /** Whether the text field is holding something that is not a colour. */
  invalid: boolean;
  /** Whether the picker is showing. */
  expanded: boolean;
  /** `black` or `white`: the ink a mark drawn on the current colour can be seen in. */
  ink: string;
  /** The current colour at full opacity, as hex: the alpha track's gradient and the system well. */
  solid: string;
  /** This element's own id stem, minted at mount. */
  uid: string;
  /** Whether the element refuses to move. */
  disabled: boolean;
  [key: string]: unknown;
}

/** The system's screen-colour picker, where the engine has one. */
interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>;
}

/** How many stems have been minted, so no two instances share one. */
let minted = 0;

/** The element each scope belongs to, learned once at mount. */
const hosts = new WeakMap<object, HTMLElement>();

/**
 * The `jx-color-field` an event is being handled ON, for a listener bound to the ROOT.
 *
 * Deliberately exact rather than a `closest`: the root's own listener must be able to tell its own
 * re-dispatch from a control's event, and `currentTarget === host` is what that test is made of.
 */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === HOST ? target : null;
}

/**
 * The `jx-color-field` a listener bound to an INNER control belongs to.
 *
 * The swatch button and the screen-picker button are handlers on nodes inside the element, so their
 * `currentTarget` is that node — and for the screen picker it is a `jx-action-button`, one custom
 * element inside another. Asking the element tree is the only answer that holds for both.
 */
function ownerOf(event: Event): HTMLElement | null {
  const target = event.currentTarget ?? event.target;
  return target instanceof Element ? target.closest<HTMLElement>(HOST) : null;
}

/** The picker panel. */
function panelOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[part="picker"]');
}

/** The colour the channels currently describe. */
function currentRgb(state: ColorFieldState): Rgb {
  return hsvToRgb({
    a: state.alpha === true ? Number(state.opacity) / 100 : 1,
    h: Number(state.hue),
    s: Number(state.saturation),
    v: Number(state.brightness),
  });
}

/** Say the value moved, from the HOST, in the platform's own names. */
function announce(host: HTMLElement, ...names: string[]): void {
  for (const name of names) {
    host.dispatchEvent(new Event(name, { bubbles: true }));
  }
}

/**
 * The two things every path needs whatever else it did: the opaque form of the colour, and the ink
 * that can be seen on it.
 *
 * @param state The element's reactive scope.
 * @param rgb The colour now in force.
 */
function paint(state: ColorFieldState, rgb: Rgb): void {
  const opaque: Rgb = { ...rgb, a: 1 };
  state.solid = formatHex(opaque);
  state.ink = preferredInk(opaque);
}

/**
 * Write the channels out into `value`, the text field and the drawing.
 *
 * @param state The element's reactive scope.
 */
function compose(state: ColorFieldState): void {
  const rgb = currentRgb(state);
  state.value = state.format === "oklch" ? formatOklch(srgbToOklch(rgb)) : formatHex(rgb);
  state.text = state.value;
  state.invalid = false;
  paint(state, rgb);
}

/**
 * Bring the working channels back into agreement with `value`, and only when they disagree.
 *
 * The hue is kept when the parsed colour has none of its own — a grey, or black — because the hue
 * slider is where the reader left it and a colour with no chroma says nothing about where that
 * was.
 *
 * @param state The element's reactive scope.
 */
export function syncFromValue(state: ColorFieldState): void {
  /*
   * A VALUE THE ELEMENT CANNOT DECOMPOSE IS NOT A REFUSAL.
   *
   * `invalid` means "what you typed is not a colour", and this path is not the reader typing: it
   * is the value the host holds. `var(--brand-accent)`, a named colour, a `color-mix()` — each is
   * a perfectly good value that only the browser can resolve, and each is what a project's own
   * palette actually puts in a style. The element keeps it verbatim, the text field shows it, and
   * the preview chip still DRAWS it, because the chip's background is that string handed to CSS
   * rather than anything computed here.
   *
   * Unless the host has said what the reference stands for. `resolved` is the colour behind a
   * token the page cannot see — Studio edits a document whose `--color-*` live in ANOTHER page,
   * so `var(--color-accent)` handed to this page's CSS is nothing — and when it parses, the
   * channels are seeded from it: the chip draws it through `preview`, and the picker opens on the
   * token's own colour, so the first drag starts from there rather than from wherever the
   * sliders last were. The text field still shows the reference, because that is the value.
   *
   * With neither, only the picker's channels are stale, and the first thing the reader moves
   * replaces the token with a literal, which is what moving a picker means. Either way the
   * refusal is cleared, because a host write is an answer to whatever the reader last got wrong,
   * and the text field is moved onto the value: it is the truth even when it is a truth this
   * module cannot read.
   */
  const parsed = parseColor(String(state.value ?? "")) ?? parseColor(String(state.resolved ?? ""));
  state.invalid = false;
  state.text = String(state.value ?? "");
  if (!parsed) {
    return;
  }
  /* The drawing is refreshed even when the channels are already right, because this is also the
     first thing that ever runs: a field mounted with a value has no `solid` and no `ink` yet, and
     an early return before this left the alpha track fading from nothing. */
  paint(state, parsed);
  if (formatHex(parsed) === formatHex(currentRgb(state))) {
    return;
  }
  const hsv = rgbToHsv(parsed);
  state.saturation = Number(hsv.s.toFixed(2));
  state.brightness = Number(hsv.v.toFixed(2));
  state.opacity = Number((hsv.a * 100).toFixed(2));
  if (hsv.s > 0 && hsv.v > 0) {
    state.hue = Number(hsv.h.toFixed(2));
  }
}

/**
 * The routing attribute, and it is NOT `data-channel`.
 *
 * `jx-color-slider` writes `data-channel` on its own root from its own `channel` prop, and an
 * element's own root attributes win over the ones an instance is given — so the alpha track the
 * field labelled `opacity` arrived here calling itself `alpha`. A name in the kit's own space
 * cannot be taken by a child element that knows nothing about being composed.
 */
const CHANNEL = "[data-jx-channel]";

/**
 * The node the field is routing for: the nearest thing between the event's target and the field
 * that the DOCUMENT has named a channel.
 *
 * A `data-` attribute rather than a `part`: the text field's event target is the `<input
 * part="input">` INSIDE `jx-textfield`, so the nearest part is not the channel, and asking for the
 * channel by name is what makes the answer the same for a control the element owns, a control one
 * of its children owns, and a palette a consumer slotted in.
 */
function sourceOf(event: Event): (HTMLElement & Record<string, unknown>) | null {
  const { target } = event;
  return target instanceof Element
    ? target.closest<HTMLElement & Record<string, unknown>>(CHANNEL)
    : null;
}

/**
 * The root's `input` and `change`, for every control inside the element.
 *
 * @param state The element's reactive scope.
 * @param event The event from whichever control the reader touched.
 * @param name Which of the platform's two names this is.
 */
function route(state: ColorFieldState, event: Event, name: "input" | "change"): void {
  const host = hostOf(event);
  if (!host || event.target === host) {
    /* Our own re-dispatch, arriving at the listener that made it. */
    return;
  }
  const source = sourceOf(event);
  const channel = source?.dataset["jxChannel"];
  if (!source || !channel) {
    /* Something inside the element that the element does not own — anything a consumer slotted in
       that is not a palette. It is left to bubble as itself rather than re-said as a colour: an
       element may re-say what it routes and nothing else. */
    return;
  }
  event.stopPropagation();
  if (channel === "text") {
    const typed = String((event.target as HTMLInputElement).value ?? "");
    state.text = typed;
    const parsed = parseColor(typed);
    if (name === "input") {
      /* Half a hex is not a colour and not an error either: the refusal waits for the commit. */
      state.invalid = false;
      return;
    }
    if (!parsed) {
      state.invalid = typed !== "";
      return;
    }
    applyRgb(state, parsed);
    compose(state);
    announce(host, "input", "change");
    return;
  }
  if (channel === "system" || channel === "palette") {
    /* The two channels that hand over a whole colour rather than one of its numbers: the system's
       own well, and a palette a consumer slotted into the picker. Both are read straight off
       whatever announced them, and both are opaque by construction — a colour well cannot express
       an alpha and a palette entry need not — so the alpha the reader already chose is carried
       across rather than reset to full by a control that has nothing to say about it. */
    const parsed = parseColor(String((event.target as HTMLInputElement).value ?? ""));
    if (!parsed) {
      return;
    }
    applyRgb(state, { ...parsed, a: state.alpha === true ? Number(state.opacity) / 100 : 1 });
  } else if (channel === "area") {
    state.saturation = Number(source["saturation"]);
    state.brightness = Number(source["brightness"]);
  } else if (channel === "hue") {
    state.hue = Number(source["value"]);
  } else if (channel === "opacity") {
    state.opacity = Number(source["value"]);
  } else {
    return;
  }
  compose(state);
  announce(host, name);
}

/**
 * Take a parsed colour into the working channels, keeping the hue a colourless value cannot supply.
 *
 * @param state The element's reactive scope.
 * @param rgb The colour.
 */
function applyRgb(state: ColorFieldState, rgb: Rgb): void {
  const hsv = rgbToHsv(rgb);
  state.saturation = Number(hsv.s.toFixed(2));
  state.brightness = Number(hsv.v.toFixed(2));
  if (state.alpha === true) {
    state.opacity = Number((hsv.a * 100).toFixed(2));
  }
  if (hsv.s > 0 && hsv.v > 0) {
    state.hue = Number(hsv.h.toFixed(2));
  }
}

/**
 * The root's `input`: a value moving under the reader's hand.
 *
 * @param state The element's reactive scope.
 * @param event The event.
 */
export function onFieldInput(state: ColorFieldState, event: Event): void {
  route(state, event, "input");
}

/**
 * The root's `change`: a value the reader has committed.
 *
 * @param state The element's reactive scope.
 * @param event The event.
 */
export function onFieldChange(state: ColorFieldState, event: Event): void {
  route(state, event, "change");
}

/**
 * The swatch button: show the picker under the field, or hide it if it is already showing.
 *
 * The panel is positioned from here rather than by CSS anchor positioning, which is what
 * `jx-popover` asks of whoever opens it: the coordinates are written before the panel is shown, so
 * the panel's own toggle handler clamps a real position into the viewport rather than the origin.
 *
 * @param state The element's reactive scope.
 * @param event The click.
 */
export function onOpenPicker(state: ColorFieldState, event: Event): void {
  const host = ownerOf(event);
  const panel = host ? panelOf(host) : null;
  if (!host || !panel || state.disabled === true) {
    return;
  }
  if (state.expanded === true) {
    close(panel);
    return;
  }
  const box = host.getBoundingClientRect();
  (panel as HTMLElement & { x: number; y: number }).x = Math.round(box.left);
  (panel as HTMLElement & { x: number; y: number }).y = Math.round(box.bottom);
  openAt(panel, event.currentTarget instanceof Element ? event.currentTarget : host);
}

/**
 * Whether the screen picker is both offered by the author and present in the engine.
 *
 * A capability the DOCUMENT asks about rather than assumes: the button is drawn only where the
 * answer is yes, so an engine without an `EyeDropper` shows no dead control rather than one that
 * does nothing when pressed. It takes the author's own opt-in as its argument rather than reading
 * it off a scope, because a `$src` callable is handed its declared positional arguments and nothing
 * else — and a DECLARED one is what makes it callable at all: a `Function` entry with no
 * `parameters` is an event handler, and calling one from a template throws in the middle of the
 * render, which takes the element's whole child tree with it and says nothing.
 *
 * @param offered The element's own `eyedropper` prop.
 * @returns Whether to draw the button.
 */
export function eyeDropperAvailable(offered: unknown): boolean {
  return (
    offered === true && typeof (globalThis as { EyeDropper?: unknown }).EyeDropper === "function"
  );
}

/**
 * The system's screen picker, where the engine has one.
 *
 * Nothing happens where it does not, and a reader who dismisses the picker has cancelled rather
 * than failed: the rejection is swallowed and the colour is left where it was.
 *
 * @param state The element's reactive scope.
 * @param event The click.
 * @returns The promise, so a test can wait for it.
 */
export function onEyeDropper(state: ColorFieldState, event: Event): Promise<void> {
  const host = ownerOf(event);
  const Api = (globalThis as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;
  if (!host || !Api || state.disabled === true) {
    return Promise.resolve();
  }
  return new Api()
    .open()
    .then((result) => {
      const parsed = parseColor(String(result?.sRGBHex ?? ""));
      if (!parsed) {
        return;
      }
      applyRgb(state, parsed);
      compose(state);
      announce(host, "input", "change");
    })
    .catch(() => {
      /* The reader pressed Escape. That is an answer, not a fault. */
    });
}

/**
 * Learn the element, mint its id stem, and keep the working channels in step with `value` for as
 * long as it lives.
 *
 * The observer watches `data-value` and `data-resolved` — the attributes the document binds to
 * `state.value` and `state.resolved` — because a HOST write of `el.value` mutates nothing else the
 * element could hear. It is the same seam `jx-select`'s sidecar uses, and for the same reason: the
 * alternative is a reactive effect, which would make the kit depend on the runtime's reactivity
 * library to learn something the document can simply say out loud.
 *
 * @param state The element's reactive scope.
 * @param event The element's own `jx-ready`.
 */
export function onFieldMount(state: ColorFieldState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  hosts.set(state, host);
  minted += 1;
  state.uid = `jx-color-field-${minted}`;
  syncFromValue(state);
  const observer = new MutationObserver(() => {
    syncFromValue(state);
  });
  observer.observe(host, { attributeFilter: ["data-resolved", "data-value"], attributes: true });
  const panel = panelOf(host);
  if (panel) {
    panel.addEventListener("toggle", (toggle: Event) => {
      state.expanded = (toggle as Event & { newState?: string }).newState === "open";
    });
  }
}
