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

/** A pointer or focus event of the kind the behaviour listens for. */
const fire = (el: EventTarget, type: string) =>
  el.dispatchEvent(new Event(type, { bubbles: false }));

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

  test("the disposer takes the tip's and the document's listeners off as well", async () => {
    // Two of the seven bindings are on the tip and one is on the document; a disposer that walks
    // Only the trigger leaves a keydown listener per tip alive forever, holding both elements.
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

  test("removing the tip takes its listeners off the control again", async () => {
    const { button, tip } = await scene({ delay: 0, for: "trigger" });
    tip.remove();
    fire(button, "focusin");
    expect(shown(tip)).toBe(false);
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

  test("measureAnchoredFlip and onTooltipBeforeToggle do nothing where there is nothing to read", () => {
    const state: Record<string, unknown> = {};
    onTooltipBeforeToggle(state, new Event("beforetoggle"));
    expect(state.anchored).toBeUndefined();
    const tip = document.createElement("jx-tooltip") as TipEl;
    document.body.append(tip);
    measureAnchoredFlip(state, tip);
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
