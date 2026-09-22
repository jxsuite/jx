import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";
import type { JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import { withAnchorSupport } from "../src/testing/anchor-support.ts";
import {
  bindTooltip,
  measureAnchoredFlip,
  onTooltipBeforeToggle,
  onTooltipReady,
  onTooltipToggle,
  placeTooltip,
  supportsInterestInvokers,
  TOOLTIP_HIDE_GRACE_MS,
} from "../src/behaviors/tooltip.ts";

const doc = documents["jx-tooltip"]!;

type TipEl = HTMLElement & {
  open: boolean;
  x: number;
  y: number;
  delay: number;
  arrow: boolean;
  placement: string;
  anchored: boolean;
  flipped: boolean;
};

/** Let the runtime's `onMount` microtask and the popover shim's queued `toggle` settle. */
const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });
/** Wait past a timer the behaviour set. */
const after = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });
/** Let the frame `placeTooltip` measures in run. */
const frame = () =>
  new Promise((r) => {
    requestAnimationFrame(() => r(null));
  });

/** The shim marks a showing popover with `data-popover-open`; `:popover-open` never matches here. */
const shown = (el: Element) => (el as HTMLElement).dataset["popoverOpen"] !== undefined;

/** Every emitted CSS rule scoped to this element's own document, in source order. */
function rules(el: Element): string[] {
  const scope = `[data-jx="${(el as HTMLElement).dataset["jx"]}"]`;
  return documentStyleText()
    .split("\n")
    .filter((line) => line.startsWith(scope) || line.includes(`{ ${scope}`));
}
/** The first emitted rule whose selector carries `selector`. */
const ruleFor = (el: Element, selector: string) =>
  rules(el).find((line) => line.slice(0, line.indexOf("{") + 1).includes(selector)) ?? "";
/** The element's own base rule: the one whose selector is the scope and nothing else. */
const baseRule = (el: Element) => {
  const scope = `[data-jx="${(el as HTMLElement).dataset["jx"]}"]`;
  return rules(el).find((line) => line.startsWith(`${scope} {`)) ?? "";
};

/**
 * A pointer or focus event of the kind the behaviour listens for.
 *
 * A `focusin` FOCUSES instead, because the platform never dispatches one without moving focus and
 * the behaviour asks the focused element whether its focus is keyboard focus (`:focus-visible`,
 * which happy-dom answers as `:focus`): a bare event on an unfocused control is the shape of
 * nothing real, and the behaviour rightly ignores it. happy-dom's `focus()` dispatches the
 * `focusin` itself; only a control that already holds the focus gets the event by hand.
 */
const fire = (el: EventTarget, type: string) => {
  if (type === "focusin" && el instanceof HTMLElement && document.activeElement !== el) {
    el.focus();
    return true;
  }
  return el.dispatchEvent(new Event(type, { bubbles: false }));
};

/** An icon-only control and the tip that describes it, wired the way a consumer would. */
async function scene(
  options: { for?: string; delay?: number; interestfor?: boolean } = {},
): Promise<{ button: HTMLButtonElement; tip: TipEl }> {
  const button = document.createElement("button");
  button.id = "trigger";
  button.setAttribute("aria-label", "Save");
  button.setAttribute("aria-describedby", "tip");
  if (options.interestfor) {
    button.setAttribute("interestfor", "tip");
  }
  const tip = document.createElement("jx-tooltip") as TipEl;
  tip.id = "tip";
  tip.textContent = "Save the file";
  if (options.delay !== undefined) {
    tip.setAttribute("delay", String(options.delay));
  }
  if (options.for !== undefined) {
    tip.setAttribute("for", options.for);
  }
  document.body.append(button, tip);
  await tick();
  return { button, tip };
}

/** A rectangle stub, so a happy-dom element can be measured. */
function box(el: Element, rect: Partial<DOMRect>): void {
  const full = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, ...rect };
  el.getBoundingClientRect = () => full as DOMRect;
}

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe("the document", () => {
  test("is a hint popover with the tooltip role", () => {
    expect(doc.attributes?.["popover"]).toBe("hint");
    expect(doc.attributes?.["role"]).toBe("tooltip");
  });

  test("is never focusable — no tabindex anywhere in the document", () => {
    const found: string[] = [];
    const walk = (node: JxElement, path: string): void => {
      for (const key of Object.keys(node.attributes ?? {})) {
        if (key.toLowerCase() === "tabindex") {
          found.push(`${path} <${String(node.tagName)}>`);
        }
      }
      for (const [i, child] of (Array.isArray(node.children) ? node.children : []).entries()) {
        if (child && typeof child === "object") {
          walk(child as JxElement, `${path}.children[${i}]`);
        }
      }
    };
    walk(doc as JxElement, "root");
    expect(found).toEqual([]);
  });

  test("writes no aria-describedby — it cannot, without touching another element", () => {
    expect(JSON.stringify(doc)).not.toContain("aria-describedby");
  });
});

describe("the emitted sheet", () => {
  test("declares display: revert-layer in the base rule and the real one in :popover-open", async () => {
    const { tip } = await scene();
    /* The base block has to declare a display, because `declaresDisplay` reads it and nothing
       else: leave it out and the interpreter writes `display: block` into the tip's own rule,
       which is an author value and therefore beats the UA's
       `[popover]:not(:popover-open) { display: none }` at any specificity — a tip laid out over
       the page at all times. `revert` is the one value that reverts TO that rule instead of
       beating it. Measured in Chrome 152 on the emitted sheet: closed computes `none` at 0x0,
       open computes `block` at 81x21; the same rule carrying `display: block` measures the
       CLOSED tip at 81x21. */
    expect(baseRule(tip)).toContain("display: revert-layer");
    expect(baseRule(tip).match(/display:/g)).toHaveLength(1);
    for (const value of ["block", "flex", "grid", "inline", "contents"]) {
      expect(baseRule(tip), value).not.toContain(`display: ${value}`);
    }
    expect(ruleFor(tip, ":popover-open")).toContain("display: block");
    /* A base rule that declares a display owes a reader an answer for `[hidden]`, and the kit
       contract asks every element that declares one for it. The selector has to be matched
       exactly: `&[hidden]:popover-open` carries the same substring, so a `find` on it is green
       whether or not the rest-state rule exists at all. */
    const scope = `[data-jx="${tip.dataset["jx"]}"]`;
    expect(rules(tip).find((line) => line.startsWith(`${scope}[hidden] {`))).toContain(
      "display: none",
    );
  });

  test("puts nothing between the tip and the text it was given", async () => {
    const { tip } = await scene();
    /* A `<slot>` leaves NO NODE, so the `& > [part="content"] { display: contents }` rule that
       used to flatten it away has nothing left to address and is gone. Distribution now does what
       that declaration was written to undo: the tip's own text is its own child, and the arrow —
       which is `position: absolute` against the tip — is its only element child. */
    expect(tip.querySelectorAll("slot").length).toBe(0);
    expect(tip.querySelector('[part="content"]')).toBeNull();
    expect(tip.firstChild?.nodeType).toBe(3);
    expect(tip.textContent?.trim()).toBe("Save the file");
    expect([...tip.children].map((child) => child.getAttribute("part"))).toEqual(["arrow"]);
    expect(rules(tip).some((rule) => rule.includes('[part="content"]'))).toBe(false);
  });

  test("hides a [hidden] tip that is showing", async () => {
    const { tip } = await scene();
    const scope = `[data-jx="${tip.dataset["jx"]}"]`;
    const rule = ruleFor(tip, "[hidden]:popover-open");
    // The HOST, not a descendant: `& [hidden]` for `&[hidden]` is one space, and it hides the
    // Wrong element while a substring assertion stays green.
    expect(rule.startsWith(`${scope}[hidden]:popover-open {`)).toBe(true);
    expect(rule).toContain("display: none");
    expect(rules(tip).indexOf(rule)).toBeGreaterThan(
      rules(tip).indexOf(ruleFor(tip, ":popover-open")),
    );
  });

  test("moves the arrow to the block-end edge when the tip has flipped", async () => {
    const { tip } = await scene();
    const base = ruleFor(tip, '> [part="arrow"]');
    const flipped = ruleFor(tip, '[data-flipped] > [part="arrow"]');
    // The base arrow hangs above the tip on its top-left borders; the flipped one hangs below it
    // On the opposite pair, so the same 45-degree square points the other way.
    expect(base).toContain("inset-block-end: 100%");
    expect(base).toContain("border-block-start: 1px solid var(--jx-border-strong)");
    expect(flipped).toContain("inset-block-start: 100%");
    expect(flipped).toContain("inset-block-end: auto");
    expect(flipped).toContain("border-block-start: none");
    expect(flipped).toContain("border-block-end: 1px solid var(--jx-border-strong)");
    expect(flipped).toContain("border-inline-end: 1px solid var(--jx-border-strong)");
  });

  test("lets the pointer rest on the tip (SC 1.4.13 hoverable)", async () => {
    const { tip } = await scene();
    expect(baseRule(tip)).toContain("pointer-events: auto");
  });
});

describe("the fallback path", () => {
  test("pointerenter waits the element's own delay, and shows only after it", async () => {
    // Measured against the VALUE, not merely against asynchrony: a tip that ignored `delay` and
    // Fired on a 0ms timer would still be shown "later" than the synchronous assertion.
    const { button, tip } = await scene({ delay: 120 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    expect(shown(tip)).toBe(false);
    await after(40);
    expect(shown(tip)).toBe(false);
    await after(160);
    expect(shown(tip)).toBe(true);
    dispose();
  });

  test("a tip with no delay attribute waits the prop's own default", async () => {
    // 500ms by default, so nothing has appeared after 120 — which is what makes the reader's
    // Pointer crossing a toolbar quiet, and it only holds while the element's prop is what is read.
    const { button, tip } = await scene();
    const dispose = bindTooltip(tip, button);
    expect(tip.delay).toBe(500);
    fire(button, "pointerenter");
    await after(120);
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("pointerleave cancels a pending show", async () => {
    const { button, tip } = await scene({ delay: 40 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    fire(button, "pointerleave");
    await after(80);
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("focusin shows immediately — a keyboard reader has already committed", async () => {
    const { button, tip } = await scene({ delay: 5000 });
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    dispose();
  });

  test("focusout hides at once", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("the tip stays while the pointer is on the tip itself", async () => {
    // Pointer only: nothing else may be holding the tip up, or this says nothing about hovering.
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    await after(0);
    expect(shown(tip)).toBe(true);
    fire(button, "pointerleave");
    fire(tip, "pointerenter");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(true);
    fire(tip, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("Escape hides a tip the engine downgraded to manual", async () => {
    /*
     * `popover="hint"` is INVALID on an engine that does not know it, and popover's invalid-value
     * default is `manual`: no light dismiss and no Escape. So the explicit hide is pinned against a
     * manual popover, which is exactly the element such an engine renders — and it is the only way
     * to see this behaviour at all, since the shim's own Escape would hide an auto or hint one.
     */
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Save");
    const tip = document.createElement("div");
    tip.setAttribute("popover", "manual");
    document.body.append(button, tip);
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    fire(button, "pointerenter");
    expect(shown(tip)).toBe(true);
    // Both triggers are live, and dismissal outranks both: SC 1.4.13 asks for persistent AND
    // Dismissible, so the one may not be bought with the other.
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(shown(tip)).toBe(false);
    fire(button, "focusin");
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    expect(shown(tip)).toBe(true);
    dispose();
  });

  test("the disposer takes the tip's and the root's listeners off as well", async () => {
    // Two of the bindings are on the tip and the Escape dismisser is registered with the root; a
    // Disposer that walks only the trigger leaves a tip answering Escape forever, holding both
    // Elements.
    const button = document.createElement("button");
    const tip = document.createElement("div");
    tip.setAttribute("popover", "manual");
    document.body.append(button, tip);
    const dispose = bindTooltip(tip, button);
    tip.showPopover();
    expect(shown(tip)).toBe(true);
    dispose();
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(shown(tip)).toBe(true);
    fire(tip, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(true);
  });

  test("the disposer removes every listener it added", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    dispose();
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
    fire(button, "pointerenter");
    await after(20);
    expect(shown(tip)).toBe(false);
  });

  test("a pending show is cancelled by the disposer too", async () => {
    const { button, tip } = await scene({ delay: 30 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    dispose();
    await after(80);
    expect(shown(tip)).toBe(false);
  });

  test("`for` binds the control at mount, with no host code at all", async () => {
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
  });

  test("a `for` that names nothing binds nothing", async () => {
    const { button, tip } = await scene({ delay: 0, for: "nobody" });
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
  });

  test("removing the tip takes its listeners off the control again, one tick later", async () => {
    // One tick, because a removal and a move look the same to the element until the microtask
    // Runs — see the move test below — and a tip that is still out by then is gone for good.
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    tip.remove();
    await after(0);
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
  });

  test("a MOVED tip keeps its binding: a move is not a removal", async () => {
    /*
     * The runtime's keyed `$map` reorders kept rows with `before()`, and a host re-parents a
     * button into a toolbar the same way: `disconnectedCallback`, then `connectedCallback`, which
     * is a no-op for an element that has already mounted — `jx-ready` never fires again, so
     * nothing would rebind. An unmount that disposed at once stripped every reordered row of its
     * tooltip for good, on every engine without interest invokers (the desktop app's Chromium 147
     * among them).
     */
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    const wrapper = document.createElement("div");
    document.body.append(wrapper);
    wrapper.append(button, tip);
    await after(0);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
    // And a tip taken out for good after a move is still disposed, not held by the move.
    tip.remove();
    await after(0);
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
  });

  test("a tip REBOUND before the unmount tick settles keeps the new binding, not the stale disposal", async () => {
    /*
     * The disposal waits a microtask so a move can be told from a removal. A re-mount in that
     * window — the host dispatching `jx-ready` again on the same element — replaces the binding
     * entry, and the pending disposal must recognise that the entry it holds is no longer the live
     * one and leave it alone; otherwise the re-bound control would be stripped by a stale tick.
     */
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    tip.remove();
    document.body.append(tip);
    tip.dispatchEvent(new Event("jx-ready"));
    await after(0);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
  });

  test("a focusin whose target is not an element is keyboard focus: nothing can say otherwise", async () => {
    /*
     * `:focus-visible` is a question for an Element. A focus event that reaches the control from a
     * non-element target — a text node inside it, on an engine that lets one — has no element to
     * ask, and the behaviour answers keyboard rather than pointer, because refusing a tip to a
     * reader who tabbed in costs more than showing one to a click.
     */
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    const text = document.createTextNode("Save");
    button.append(text);
    button.focus();
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
    text.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(shown(tip)).toBe(true);
  });
});

describe("SC 1.4.13 persistent", () => {
  test("a pointer crossing a focused control does not take the tip away", async () => {
    // The ordinary keyboard-then-mouse journey: the hover trigger was removed and the focus one
    // Was not, and the criterion says the content stays until BOTH are gone.
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "pointerenter");
    fire(button, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("a blur does not take the tip out from under the pointer resting on it", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    fire(tip, "pointerenter");
    fire(button, "focusout");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(true);
    fire(tip, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(false);
    dispose();
  });

  test("a blur leaves the tip up while the pointer is still on the control", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    fire(button, "focusin");
    fire(button, "focusout");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(true);
    fire(button, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(false);
    dispose();
  });
});

describe("hint mode", () => {
  test("a tip shows over an open auto popover without dismissing it", async () => {
    // The one property that makes `hint` the right mode: a tip may sit over an open menu
    // Explaining a row. Measured in Chrome 152 and modelled by the shim.
    const { button, tip } = await scene({ delay: 0 });
    const menu = document.createElement("div");
    menu.setAttribute("popover", "auto");
    document.body.append(menu);
    menu.showPopover();
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    expect(shown(menu)).toBe(true);
    dispose();
  });
});

describe("the declarative path", () => {
  test("this engine has no interest invokers, and one with them is detected", () => {
    expect(supportsInterestInvokers()).toBe(false);
    const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
    proto["interestForElement"] = null;
    try {
      expect(supportsInterestInvokers()).toBe(true);
    } finally {
      delete proto["interestForElement"];
    }
  });

  test("binds nothing when the platform already owns the pair", async () => {
    // The engine is made to look like Chrome BEFORE the pair mounts, so this covers the mount path
    // As well as the direct call: on that engine the timers, the grace and Escape are the
    // Platform's, and a second set of listeners would double every one of them.
    const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
    proto["interestForElement"] = null;
    try {
      const { button, tip } = await scene({ delay: 0, interestfor: true });
      fire(button, "focusin");
      expect(shown(tip)).toBe(false);
      const dispose = bindTooltip(tip, button);
      fire(button, "focusin");
      expect(shown(tip)).toBe(false);
      dispose();
    } finally {
      delete proto["interestForElement"];
    }
  });

  test("an interestfor control is bound at mount on an engine without interest invokers", async () => {
    // The shape the element tells authors to prefer, on Firefox and Safari. Nothing but the two
    // Documents is involved: no `for`, no host code, no bindTooltip call.
    expect(supportsInterestInvokers()).toBe(false);
    const { button, tip } = await scene({ delay: 0, interestfor: true });
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    expect(shown(tip)).toBe(false);
  });

  test("Escape is one listener per root, shared by every bound tip", async () => {
    /*
     * The listener has to be on an ancestor that sees the keystroke wherever focus is, and one
     * capture listener on the document PER tip is one handler per hinted button on every keystroke
     * in a chrome of several hundred of them. So the root carries one, added with the first
     * binding and removed with the last, and Escape walks the dismissers instead — hiding only the
     * tip that is showing.
     */
    const added: string[] = [];
    const removed: string[] = [];
    const originalAdd = document.addEventListener.bind(document);
    const originalRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      (originalAdd as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      (originalRemove as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof document.removeEventListener;
    try {
      const pairs = [0, 1, 2].map((n) => {
        const button = document.createElement("button");
        const tip = document.createElement("div");
        tip.setAttribute("popover", "manual");
        tip.id = `shared-tip-${n}`;
        document.body.append(button, tip);
        return { button, dispose: bindTooltip(tip, button), tip };
      });
      expect(added.filter((type) => type === "keydown")).toHaveLength(1);
      // Only the showing tip hears the Escape; the other two were never shown and are not touched.
      const hides = pairs.map((pair) => {
        let count = 0;
        const { hidePopover } = pair.tip;
        pair.tip.hidePopover = () => {
          count += 1;
          hidePopover.call(pair.tip);
        };
        return () => count;
      });
      fire(pairs[1]!.button, "focusin");
      expect(shown(pairs[1]!.tip)).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      expect(shown(pairs[1]!.tip)).toBe(false);
      expect(hides.map((count) => count())).toEqual([0, 1, 0]);
      // The listener outlives every binding but the last.
      pairs[0]!.dispose();
      pairs[1]!.dispose();
      expect(removed.filter((type) => type === "keydown")).toHaveLength(0);
      pairs[2]!.dispose();
      expect(removed.filter((type) => type === "keydown")).toHaveLength(1);
    } finally {
      document.addEventListener = originalAdd;
      document.removeEventListener = originalRemove;
    }
  });

  test("a click's focus neither shows the tip nor pins it open", async () => {
    /*
     * The platform's interest-on-focus is keyboard focus only. A click gives the control focus
     * too, and a binding that showed on every `focusin` and then held the tip up while `focused`
     * pinned a tip to every clicked button in Studio's chrome for as long as it kept the focus —
     * on the desktop app, which has no interest invokers. The hover is what shows it, after the
     * delay, and the hover leaving is what hides it.
     */
    const { button, tip } = await scene({ delay: 20 });
    const dispose = bindTooltip(tip, button);
    fire(button, "pointerenter");
    fire(button, "pointerdown");
    fire(button, "focusin");
    fire(button, "pointerup");
    fire(button, "click");
    expect(shown(tip)).toBe(false);
    // The hover still shows it after `delay`, and the hover leaving still hides it, focus or not.
    await after(40);
    expect(shown(tip)).toBe(true);
    fire(button, "pointerleave");
    await after(TOOLTIP_HIDE_GRACE_MS * 2);
    expect(shown(tip)).toBe(false);
    expect(document.activeElement === button).toBe(true);
    // A pointer that went down and was dragged off releases the flag with the hover; the next
    // Focus is the keyboard's again.
    fire(button, "pointerdown");
    fire(button, "pointerleave");
    button.blur();
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    fire(button, "focusout");
    dispose();
  });

  test("an engine whose selectors know neither :focus-visible nor :popover-open still works", async () => {
    // Both probes are guarded: a selector that is a parse error there must not take the focus
    // Path or Escape down with it. Focus is then taken to be the keyboard's, and Escape trusts the
    // Binding's own account of what it showed.
    const { button, tip } = await scene({ delay: 0 });
    // Manual, as such an engine renders `popover="hint"`, so the shim's own Escape stays out of it.
    tip.setAttribute("popover", "manual");
    const refuse = (): never => {
      throw new SyntaxError("unknown pseudo-class");
    };
    (button as unknown as { matches: () => boolean }).matches = refuse;
    (tip as unknown as { matches: () => boolean }).matches = refuse;
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(shown(tip)).toBe(false);
    // A tip a HOST showed is not something the binding can see there, and it is left alone.
    tip.showPopover();
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(shown(tip)).toBe(true);
    tip.hidePopover();
    dispose();
  });

  test("Escape reaches a declaratively wired tip the engine downgraded to manual", async () => {
    // `popover="hint"` is invalid on that engine and falls back to `manual`, so the behaviour's own
    // Escape is the only way the tip ever goes away — and it is bound only if the pair is bound.
    const { button, tip } = await scene({ delay: 0, interestfor: true });
    tip.setAttribute("popover", "manual");
    fire(button, "focusin");
    expect(shown(tip)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(shown(tip)).toBe(false);
  });

  test("a control that merely describes the tip is not wired to it", async () => {
    // `aria-describedby` is a naming, not a wiring: it places the tip but binds no listener, or a
    // Page where two controls cite one tip would answer the wrong one's pointer.
    const { button, tip } = await scene({ delay: 0 });
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
  });

  test("still binds when the engine has interest invokers but the control declares none", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
    proto["interestForElement"] = null;
    try {
      const dispose = bindTooltip(tip, button);
      fire(button, "focusin");
      expect(shown(tip)).toBe(true);
      dispose();
    } finally {
      delete proto["interestForElement"];
    }
  });
});

describe("the platform's toggle", () => {
  test("mirrors open into state and stamps data-open", async () => {
    const { button, tip } = await scene({ delay: 0 });
    const dispose = bindTooltip(tip, button);
    fire(button, "focusin");
    await tick();
    expect(tip.open).toBe(true);
    expect(tip.dataset["open"]).toBe("");
    fire(button, "focusout");
    await tick();
    expect(tip.open).toBe(false);
    expect(tip.dataset["open"]).toBeUndefined();
    dispose();
  });

  test("an event from something that is not an element is ignored", () => {
    // `newState: "closed"` against `open: true`, so the guard returning early and the guard being
    // Absent are distinguishable — the same fixture with "open" is satisfied either way.
    const state: Record<string, unknown> = { open: true };
    const event = new Event("toggle");
    Object.assign(event, { newState: "closed" });
    onTooltipToggle(state, event);
    expect(state["open"]).toBe(true);
  });
});

describe("placement", () => {
  test("puts the tip under the control it describes", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 60, height: 20, left: 100, right: 140, top: 40, width: 40 });
    const state: Record<string, unknown> = { for: "trigger" };
    placeTooltip(state, tip);
    expect(state["x"]).toBe(100);
    expect(state["y"]).toBe(66);
    expect(state["flipped"]).toBe(false);
  });

  test("measures synchronously when the platform has no requestAnimationFrame", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 60, height: 20, left: 100, right: 140, top: 40, width: 40 });
    const raf = globalThis.requestAnimationFrame;
    (globalThis as unknown as Record<string, unknown>)["requestAnimationFrame"] = undefined;
    try {
      const state: Record<string, unknown> = { for: "trigger" };
      placeTooltip(state, tip);
      // No `await frame()`: the measurement already ran, inline, on the call itself.
      expect(state["x"]).toBe(100);
      expect(state["y"]).toBe(66);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  test("flips above the control when there is no room below, and says so", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
    box(tip, { bottom: 786, height: 60, left: 100, right: 300, top: 726, width: 200 });
    const state: Record<string, unknown> = { for: "trigger" };
    placeTooltip(state, tip);
    expect(state["y"]).toBe(726);
    expect(state["flipped"]).toBe(false);
    await frame();
    expect(state["y"]).toBe(634);
    // The arrow is pinned to one edge in CSS, so the flip has to be told to the element or the
    // Pointer ends up on the far side from the control it points at.
    expect(state["flipped"]).toBe(true);
  });

  test("a flipped tip stamps data-flipped on itself, and one with room below does not", async () => {
    /* The FALLBACK placement: an engine without anchor positioning, where the element places and
       flips the tip itself. Through the element rather than through a bare state object: the flip
       has to survive the toggle, the reactive write and the attribute binding to reach the arrow's
       CSS at all. */
    const restore = withAnchorSupport(false);
    try {
      const roomy = await scene({ delay: 0, for: "trigger" });
      box(roomy.button, { bottom: 60, height: 20, left: 100, right: 140, top: 40, width: 40 });
      box(roomy.tip, { bottom: 126, height: 60, left: 100, right: 300, top: 66, width: 200 });
      fire(roomy.button, "focusin");
      await frame();
      await tick();
      expect(roomy.tip.dataset["flipped"]).toBeUndefined();
      /* Anchored in the state all the same: the document's `@supports` block is what does not
         apply on this engine, and the element placed the tip because of that. */
      expect(roomy.tip.anchored).toBe(true);
      expect(roomy.tip.x).toBe(100);

      document.body.replaceChildren();
      const { button, tip } = await scene({ delay: 0, for: "trigger" });
      box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
      box(tip, { bottom: 786, height: 60, left: 100, right: 300, top: 726, width: 200 });
      fire(button, "focusin");
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBe("");
      fire(button, "focusout");
    } finally {
      restore();
    }
  });

  test("an anchored tip is the platform's to place, and the arrow follows the side it chose", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { button, tip } = await scene({ delay: 0, for: "trigger" });
      expect(tip.placement).toBe("block-end span-inline-end");
      box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
      /* The platform put it ABOVE the control; the element reads that back rather than deciding. */
      box(tip, { bottom: 694, height: 60, left: 100, right: 300, top: 634, width: 200 });
      fire(button, "focusin");
      expect(tip.anchored).toBe(true);
      await tick();
      expect(tip.dataset["anchored"]).toBe("");
      /* Not placed by the element: the coordinates stayed at their defaults. */
      expect(tip.x).toBe(0);
      expect(tip.y).toBe(0);
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBe("");
      fire(button, "focusout");
      await tick();
      expect(tip.anchored).toBe(false);
      expect(tip.dataset["anchored"]).toBeUndefined();
      expect(tip.dataset["flipped"]).toBeUndefined();

      /* And below its control, the arrow stays on the block-start edge. */
      box(tip, { bottom: 786, height: 60, left: 100, right: 300, top: 726, width: 200 });
      fire(button, "focusin");
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBeUndefined();
      fire(button, "focusout");
    } finally {
      restore();
    }
  });

  test("declares the anchored rule under @supports, and the try option that keeps the gap", async () => {
    const { tip } = await scene();
    const sheet = documentStyleText();
    expect(sheet).toContain(
      "@position-try --jx-tooltip-above { position-area: block-start span-inline-end; margin-block-start: 0; margin-block-end: 6px }",
    );
    /* Nested under the at-rule, so the selector is not the line's head: found by content. */
    const anchored = rules(tip).find((line) => line.includes("[data-anchored]")) ?? "";
    expect(anchored).toContain("@supports (position-area: block-end)");
    expect(anchored).toContain("inset-inline-start: auto");
    expect(anchored).toContain("margin-block-start: 6px");
    expect(anchored).toContain(
      "position-try-fallbacks: --jx-tooltip-above, flip-inline, --jx-tooltip-above flip-inline",
    );
  });

  test("onTooltipReady off an element does nothing: a handler bound where an event was not", () => {
    const state: Record<string, unknown> = {};
    expect(() => {
      onTooltipReady(state, { currentTarget: null } as unknown as Event);
    }).not.toThrow();
    expect(state["x"]).toBeUndefined();
  });

  test("measureAnchoredFlip and onTooltipBeforeToggle do nothing where there is nothing to read", () => {
    const state: Record<string, unknown> = {};
    onTooltipBeforeToggle(state, new Event("beforetoggle"));
    expect(state.anchored).toBeUndefined();
    const tip = document.createElement("jx-tooltip") as TipEl;
    document.body.append(tip);
    /* A tip with no control is not watched either: the disposer it hands back is the no-op one. */
    const stop = measureAnchoredFlip(state, tip);
    expect(state.flipped).toBeUndefined();
    stop();
    expect(state.flipped).toBeUndefined();
    /* A closing clears the flip, so the next open starts from the block-start edge. */
    Object.defineProperty(
      Object.assign(new Event("beforetoggle"), { newState: "closed" }),
      "currentTarget",
      { value: tip },
    );
  });

  test("slides in from the inline edge when the tip would run off it", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 60, height: 20, left: 990, right: 1020, top: 40, width: 30 });
    box(tip, { bottom: 126, height: 60, left: 990, right: 1190, top: 66, width: 200 });
    const state: Record<string, unknown> = { for: "trigger" };
    placeTooltip(state, tip);
    await frame();
    expect(state["x"]).toBe(820);
  });

  test("finds the control by interestfor when nothing named it", async () => {
    const { button, tip } = await scene({ interestfor: true });
    // Only interestfor may answer: with aria-describedby still on it the next route would too.
    button.removeAttribute("aria-describedby");
    box(button, { bottom: 60, height: 20, left: 12, right: 52, top: 40, width: 40 });
    const state: Record<string, unknown> = {};
    placeTooltip(state, tip);
    expect(state["x"]).toBe(12);
  });

  test("finds the control by aria-describedby when nothing else did", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 60, height: 20, left: 7, right: 47, top: 40, width: 40 });
    const state: Record<string, unknown> = {};
    placeTooltip(state, tip);
    expect(state["x"]).toBe(7);
  });

  test("a tip with no id and no `for` has no control to be placed against", async () => {
    const { tip } = await scene();
    tip.removeAttribute("id");
    const state: Record<string, unknown> = {};
    placeTooltip(state, tip);
    expect(state["x"]).toBeUndefined();
  });

  test("an unmeasured control is left alone rather than placed at the origin", async () => {
    const { tip } = await scene();
    const state: Record<string, unknown> = { for: "trigger" };
    placeTooltip(state, tip);
    expect(state["x"]).toBeUndefined();
  });

  test("an unmeasured tip is not clamped", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 60, height: 20, left: 100, right: 140, top: 40, width: 40 });
    const state: Record<string, unknown> = { for: "trigger" };
    placeTooltip(state, tip);
    await frame();
    expect(state["y"]).toBe(66);
  });
});

describe("the arrow follows a flip the platform makes later (#310)", () => {
  /*
   * An anchored tip is re-placed by the platform through scroll and resize, and its try option
   * flips it when the room below runs out. The arrow is pinned in CSS and hears none of that, so
   * the element reads the side back for as long as the tip is showing rather than once. Under
   * happy-dom nothing is laid out: the rects are stubbed, the causes are dispatched by hand, and
   * the seam asserted through is the measurement itself — how many times the boxes were read, and
   * what `flipped` says after each frame.
   */
  const BELOW = { bottom: 786, height: 60, left: 100, right: 300, top: 726, width: 200 };
  const ABOVE = { bottom: 694, height: 60, left: 100, right: 300, top: 634, width: 200 };

  /** A shown anchored tip below its control, with a counter on how often its box is read. */
  async function anchoredScene(): Promise<{
    button: HTMLButtonElement;
    tip: TipEl;
    reads: () => number;
  }> {
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
    box(tip, BELOW);
    let count = 0;
    const rect = tip.getBoundingClientRect.bind(tip);
    tip.getBoundingClientRect = () => {
      count += 1;
      return rect();
    };
    fire(button, "focusin");
    await frame();
    await tick();
    expect(tip.dataset["flipped"]).toBeUndefined();
    return { button, tip, reads: () => count };
  }
  /** Move the stubbed tip without disturbing the read counter wrapped around it. */
  function moveTo(tip: TipEl, rect: Partial<DOMRect>): void {
    const counted = tip.getBoundingClientRect;
    box(tip, rect);
    const plain = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => {
      counted();
      return plain();
    };
  }

  test("a scroll that flips the tip moves the arrow, and one that flips it back moves it back", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { button, tip, reads } = await anchoredScene();
      const before = reads();
      /* The platform ran out of room below and took the try option: the tip is now ABOVE. */
      moveTo(tip, ABOVE);
      window.dispatchEvent(new Event("scroll"));
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBe("");
      /* And back below it, on a resize this time: the arrow returns to the block-start edge. */
      moveTo(tip, BELOW);
      window.dispatchEvent(new Event("resize"));
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBeUndefined();
      expect(reads()).toBe(before + 2);
      fire(button, "focusout");
    } finally {
      restore();
    }
  });

  test("a nested scroller's scroll counts — it does not bubble, and is taken in the capture phase", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { button, tip } = await anchoredScene();
      const scroller = document.createElement("div");
      document.body.append(scroller);
      moveTo(tip, ABOVE);
      scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBe("");
      fire(button, "focusout");
    } finally {
      restore();
    }
  });

  test("many causes in one frame are one measurement", async () => {
    // A scroll fires per pixel and a measurement forces layout; the causes schedule a frame and
    // The frame measures once, however many of them arrived before it.
    const restore = withAnchorSupport(true);
    try {
      const { button, reads } = await anchoredScene();
      const before = reads();
      for (let i = 0; i < 5; i += 1) {
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      }
      expect(reads()).toBe(before);
      await frame();
      expect(reads()).toBe(before + 1);
      fire(button, "focusout");
    } finally {
      restore();
    }
  });

  test("closing stops the watch: no measurement after hide, and the window listeners come off", async () => {
    const restore = withAnchorSupport(true);
    const added: string[] = [];
    const removed: string[] = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (add as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (remove as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof window.removeEventListener;
    try {
      const { button, tip, reads } = await anchoredScene();
      expect(added.filter((type) => type === "scroll" || type === "resize").toSorted()).toEqual([
        "resize",
        "scroll",
      ]);
      fire(button, "focusout");
      await tick();
      expect(tip.open).toBe(false);
      expect(removed.filter((type) => type === "scroll" || type === "resize").toSorted()).toEqual([
        "resize",
        "scroll",
      ]);
      const settled = reads();
      moveTo(tip, ABOVE);
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      await frame();
      await tick();
      expect(reads()).toBe(settled);
      expect(tip.dataset["flipped"]).toBeUndefined();
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
      restore();
    }
  });

  test("a measurement scheduled before the close is cancelled by it", async () => {
    // Close and scroll can land in one frame; the frame after must read nothing, or a tip the
    // Platform has just hidden gets a `flipped` from a box that no longer means anything.
    const restore = withAnchorSupport(true);
    try {
      const { button, tip, reads } = await anchoredScene();
      window.dispatchEvent(new Event("scroll"));
      const before = reads();
      fire(button, "focusout");
      await frame();
      await tick();
      expect(reads()).toBe(before);
      expect(tip.open).toBe(false);
    } finally {
      restore();
    }
  });

  test("a tip removed while showing stops watching too — the platform sends it no toggle", async () => {
    const restore = withAnchorSupport(true);
    try {
      const { tip, reads } = await anchoredScene();
      tip.remove();
      await tick();
      const settled = reads();
      window.dispatchEvent(new Event("scroll"));
      await frame();
      expect(reads()).toBe(settled);
    } finally {
      restore();
    }
  });

  test("the tip and its control are observed for size where the engine can, and released on close", async () => {
    /* The engine's ResizeObserver (happy-dom's) observes nothing, so the engine's is stood in for by one that
       records what it was given and can be fired by hand. */
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = [];
      callback: () => void;
      observed: Element[] = [];
      disconnected = false;
      constructor(callback: () => void) {
        this.callback = callback;
        FakeResizeObserver.instances.push(this);
      }
      observe(el: Element): void {
        this.observed.push(el);
      }
      disconnect(): void {
        this.disconnected = true;
      }
    }
    const real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    const restore = withAnchorSupport(true);
    try {
      const { button, tip, reads } = await anchoredScene();
      const [observer] = FakeResizeObserver.instances;
      expect(FakeResizeObserver.instances).toHaveLength(1);
      expect(observer!.observed.map((el) => el.localName)).toEqual(["jx-tooltip", "button"]);
      const before = reads();
      moveTo(tip, ABOVE);
      observer!.callback();
      await frame();
      await tick();
      expect(reads()).toBe(before + 1);
      expect(tip.dataset["flipped"]).toBe("");
      fire(button, "focusout");
      await tick();
      expect(observer!.disconnected).toBe(true);
    } finally {
      globalThis.ResizeObserver = real;
      restore();
    }
  });

  test("an engine without a ResizeObserver is watched by scroll and resize alone", async () => {
    const real = globalThis.ResizeObserver;
    (globalThis as unknown as Record<string, unknown>)["ResizeObserver"] = undefined;
    const restore = withAnchorSupport(true);
    try {
      const { button, tip } = await anchoredScene();
      moveTo(tip, ABOVE);
      window.dispatchEvent(new Event("scroll"));
      await frame();
      await tick();
      expect(tip.dataset["flipped"]).toBe("");
      fire(button, "focusout");
    } finally {
      globalThis.ResizeObserver = real;
      restore();
    }
  });

  test("calling measureAnchoredFlip again replaces the watch rather than doubling it", async () => {
    /* Keyed on the reactive scope, the way the toggle handler calls it: a host that measures a tip
       it showed itself calls this with the same state each time, and the second call must stop
       the first watch rather than stand a second one beside it. */
    const restore = withAnchorSupport(true);
    try {
      const { button, tip } = await scene();
      box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
      box(tip, BELOW);
      let count = 0;
      const rect = tip.getBoundingClientRect.bind(tip);
      tip.getBoundingClientRect = () => {
        count += 1;
        return rect();
      };
      const state: Record<string, unknown> = { for: "trigger", anchored: true };
      measureAnchoredFlip(state, tip);
      const stop = measureAnchoredFlip(state, tip);
      await frame();
      expect(count).toBe(1);
      expect(state["flipped"]).toBe(false);
      window.dispatchEvent(new Event("scroll"));
      await frame();
      /* Two live watches would read the box twice here. */
      expect(count).toBe(2);
      /* The disposer is the host's to call; after it nothing measures. */
      stop();
      window.dispatchEvent(new Event("scroll"));
      await frame();
      expect(count).toBe(2);
      /* And calling it a second time is harmless: the watch it names is already gone. */
      stop();
      expect(count).toBe(2);
    } finally {
      restore();
    }
  });

  test("with no animation frames the side is read once, synchronously, and nothing is watched", async () => {
    const { button, tip } = await scene();
    box(button, { bottom: 720, height: 20, left: 100, right: 140, top: 700, width: 40 });
    box(tip, ABOVE);
    const raf = globalThis.requestAnimationFrame;
    const add = window.addEventListener;
    const added: string[] = [];
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (add as (...args: unknown[]) => void).call(window, type, ...rest);
    }) as typeof window.addEventListener;
    (globalThis as unknown as Record<string, unknown>)["requestAnimationFrame"] = undefined;
    try {
      const state: Record<string, unknown> = { for: "trigger", anchored: true };
      const stop = measureAnchoredFlip(state, tip);
      expect(state["flipped"]).toBe(true);
      expect(added).toEqual([]);
      stop();
      expect(state["flipped"]).toBe(true);
    } finally {
      window.addEventListener = add;
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe("the arrow", () => {
  test("is drawn only when `arrow` asks for it", async () => {
    const { tip } = await scene();
    const arrow = tip.querySelector('[part="arrow"]')!;
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.hasAttribute("hidden")).toBe(true);
    tip.setAttribute("arrow", "");
    await tick();
    expect(arrow.hasAttribute("hidden")).toBe(false);
    tip.removeAttribute("arrow");
    await tick();
    expect(arrow.hasAttribute("hidden")).toBe(true);
  });
});

describe("naming", () => {
  test("a control's aria-describedby resolves a CLOSED tip's text", async () => {
    const { button, tip } = await scene();
    expect(shown(tip)).toBe(false);
    const id = button.getAttribute("aria-describedby")!;
    const described = document.querySelector(`#${id}`)!;
    expect(described).toBe(tip);
    expect(described.textContent).toContain("Save the file");
  });
});
