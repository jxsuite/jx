import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { ICON_NAMES } from "../src/icons.ts";
import { registerUi } from "../src/index.ts";
import { TOAST_PAUSE, TOAST_RESUME, closeToast, staysInside } from "../src/behaviors/toast.ts";

/** Let the runtime's queued `onMount` and its bindings settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** Wait, for the one element in the kit whose behaviour is measured in milliseconds. */
const wait = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

type ToastEl = HTMLElement & { open: boolean; variant: string; timeout: number };

interface Raised {
  el: ToastEl;
  /** Every `close` heard on an ANCESTOR, which is where a stack listens. */
  closes: string[];
}

/** A `jx-toast` in the document, with a listener where a host would put one. */
async function toast(
  attrs: Record<string, string> = {},
  message = "Draft saved.",
  action: HTMLElement | null = null,
): Promise<Raised> {
  const box = document.createElement("div");
  const el = document.createElement("jx-toast") as ToastEl;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  el.append(message);
  if (action) {
    action.setAttribute("slot", "action");
    el.append(action);
  }
  box.append(el);
  document.body.append(box);
  const closes: string[] = [];
  box.addEventListener("close", (event) => {
    closes.push(String((event as CustomEvent<{ reason: string }>).detail.reason));
  });
  await flush();
  return { closes, el };
}

const part = (el: Element, name: string) => el.querySelector<HTMLElement>(`[part="${name}"]`);

/** The dismiss button's own native control, which is what a keyboard actually lands on. */
const dismissButton = (el: Element) =>
  part(el, "dismiss")!.querySelector<HTMLButtonElement>('[part="control"]')!;

/** Send a real event of the type the platform would send. */
function send(target: EventTarget, type: string, init: EventInit = {}): Event {
  const event = new Event(type, init);
  target.dispatchEvent(event);
  return event;
}

/**
 * The emitted rules for ONE element, in source order.
 *
 * Order is the assertion in one test below and cannot be read from a Map keyed by selector, so this
 * keeps the array.
 */
function rules(el: HTMLElement): [string, string][] {
  const scope = el.dataset["jx"];
  const out: [string, string][] = [];
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (!match || !match[1]!.includes(`[data-jx="${scope}"]`)) {
      continue;
    }
    out.push([match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!]);
  }
  return out;
}

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("jx-toast", () => {
  test("is a message, a severity glyph and a dismiss button, and says nothing about itself", async () => {
    const { el } = await toast({ open: "", variant: "positive" }, "Published 14 pages.");
    expect(part(el, "message")!.textContent).toContain("Published 14 pages.");
    expect(part(el, "icon")!.getAttribute("aria-hidden")).toBe("true");
    expect(el.dataset["variant"]).toBe("positive");
    expect(el.dataset["open"]).toBe("");
    expect(dismissButton(el).getAttribute("aria-label")).toBe("Dismiss");

    /* NO live region and no role of its own. `jx-toast-host` owns the region, and a role here
       would announce every toast in a stack twice — the exact defect ui.md §5.2 named when it
       deferred this element. */
    expect(el.hasAttribute("role")).toBe(false);
    expect(el.hasAttribute("aria-live")).toBe(false);
  });

  test("every variant draws a glyph the kit actually ships", async () => {
    /* A name the manifest does not carry renders an empty 16x16 box with every gate green — the
       failure `jx-textfield`'s clear button nearly shipped. Four variants, four literal names
       inside one template, and conformance skips a bound name: this is the only place they are
       checked. */
    const seen: string[] = [];
    for (const variant of ["info", "positive", "negative", "warning"]) {
      const { el } = await toast({ open: "", variant });
      const glyph = part(el, "glyph") as HTMLElement & { name: string };
      expect(ICON_NAMES, `${variant} draws ${glyph.name}`).toContain(glyph.name);
      seen.push(glyph.name);
      document.body.replaceChildren();
    }
    // And they are four DIFFERENT glyphs, or the shape says nothing colour did not already say.
    expect(new Set(seen).size).toBe(4);
  });

  test("a closed toast is not drawn, and hidden outranks open", async () => {
    const { el } = await toast({ variant: "info" });
    expect(el.dataset["open"]).toBeUndefined();
    const emitted = rules(el);
    const base = emitted.find(([selector]) => selector === "&")!;
    expect(base[1]).toContain("display: none");
    const open = emitted.findIndex(([selector]) => selector === "&[data-open]");
    const hidden = emitted.findIndex(([selector]) => selector === "&[hidden]");
    expect(open).toBeGreaterThanOrEqual(0);
    /* Equal specificity, so the later rule wins: a hidden toast that is also open must stay
       hidden, and only source order says so. */
    expect(hidden).toBeGreaterThan(open);
  });

  test("the clock retires it, and says the clock did", async () => {
    const { el, closes } = await toast({ open: "", timeout: "40" });
    expect(el.open).toBe(true);
    await wait(120);
    expect(el.open).toBe(false);
    expect(el.dataset["open"]).toBeUndefined();
    expect(closes).toEqual(["timeout"]);
  });

  test("a toast opened after it was mounted starts its clock then, not at mount", async () => {
    /* The shape a host actually uses: the element is in the document, closed, and `open` is
       written when there is something to say. A clock that only ever started at mount would leave
       every toast after the first one sticky, in silence. */
    const { el, closes } = await toast({ timeout: "40" });
    await wait(120);
    expect(closes).toEqual([]);
    el.open = true;
    await flush();
    expect(el.dataset["open"]).toBe("");
    await wait(120);
    expect(el.open).toBe(false);
    expect(closes).toEqual(["timeout"]);
  });

  test("timeout 0 is sticky, and is the default", async () => {
    const { el, closes } = await toast({ open: "" });
    expect(el.timeout).toBe(0);
    await wait(120);
    expect(el.open).toBe(true);
    expect(closes).toEqual([]);
  });

  test("the dismiss button closes it once, whatever else is racing", async () => {
    const { el, closes } = await toast({ open: "", timeout: "40" });
    dismissButton(el).click();
    expect(el.open).toBe(false);
    expect(closes).toEqual(["dismissed"]);
    // The clock was still running when the reader answered; it must not close a closed toast.
    dismissButton(el).click();
    await wait(120);
    expect(closes).toEqual(["dismissed"]);
  });

  test("using the recovery control closes it, says action, and lets the control's own click through", async () => {
    const retry = document.createElement("button");
    const heard: string[] = [];
    retry.addEventListener("click", () => heard.push("retry"));
    const { el, closes } = await toast({ open: "", variant: "negative" }, "Deploy failed.", retry);
    retry.click();
    expect(heard).toEqual(["retry"]);
    expect(closes).toEqual(["action"]);
    expect(el.open).toBe(false);
  });

  test("a host closing it directly is silent: it already knows", async () => {
    const { el, closes } = await toast({ open: "", timeout: "40" });
    el.open = false;
    await wait(120);
    expect(closes).toEqual([]);
  });

  test("closeToast is the same door the buttons use, and a closed toast cannot close again", async () => {
    const { el, closes } = await toast({ open: "" });
    closeToast(el, "dismissed");
    closeToast(el, "dismissed");
    expect(closes).toEqual(["dismissed"]);
  });

  test("focus inside it suspends the clock, and it resumes with what was LEFT", async () => {
    const { el, closes } = await toast({ open: "", timeout: "200" });
    await wait(100);
    send(dismissButton(el), "focusin", { bubbles: true });
    await wait(300);
    // Held: a reader standing on the recovery control cannot have it expire under their hand.
    expect(el.open).toBe(true);
    send(dismissButton(el), "focusout", { bubbles: true });
    /* 150ms is the discriminating wait: about 100ms was left when the hold went on, so a clock
       that resumed correctly has retired the toast by now and one that started its 200ms over
       again has not. A test that only waited for "eventually" could not tell them apart. */
    await wait(150);
    expect(el.open).toBe(false);
    expect(closes).toEqual(["timeout"]);
  });

  test("the pointer suspends it too, and the two holds do not cancel each other", async () => {
    const { el } = await toast({ open: "", timeout: "40" });
    send(el, "pointerenter");
    send(dismissButton(el), "focusin", { bubbles: true });
    // The pointer leaves while the keyboard is still there: one reason went, one remains.
    send(el, "pointerleave");
    await wait(120);
    expect(el.open).toBe(true);
    send(dismissButton(el), "focusout", { bubbles: true });
    await wait(120);
    expect(el.open).toBe(false);
  });

  test("focus moving between the toast's own controls is not a departure", async () => {
    const retry = document.createElement("button");
    const { el } = await toast({ open: "", timeout: "40" }, "Deploy failed.", retry);
    send(retry, "focusin", { bubbles: true });
    const leaving = new FocusEvent("focusout", { bubbles: true, relatedTarget: dismissButton(el) });
    retry.dispatchEvent(leaving);
    await wait(120);
    expect(el.open).toBe(true);
  });

  test("the stack's own pause and resume reach it", async () => {
    const { el } = await toast({ open: "", timeout: "40" });
    send(el, TOAST_PAUSE);
    await wait(120);
    expect(el.open).toBe(true);
    send(el, TOAST_RESUME);
    await wait(120);
    expect(el.open).toBe(false);
  });

  test("it never takes the keyboard", async () => {
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    const { el } = await toast({ open: "" });
    // Appearing moved nothing, and the toast's own controls are reachable without being taken to.
    expect(document.activeElement).toBe(elsewhere);
    expect(dismissButton(el).tagName).toBe("BUTTON");
  });

  test("a toast taken out of the document stops counting", async () => {
    const { el } = await toast({ open: "", timeout: "40" });
    const heard: string[] = [];
    el.addEventListener("close", () => heard.push("close"));
    el.remove();
    await wait(120);
    /* A detached element still runs its own listeners, so this would hear a `close` the reader
       never saw — a toast the host had already taken away, retiring itself afterwards. */
    expect(heard).toEqual([]);
    expect(el.open).toBe(true);
  });

  test("staysInside answers where the pointer or the focus WENT", () => {
    const box = document.createElement("div");
    const inner = document.createElement("button");
    const outer = document.createElement("button");
    box.append(inner);
    document.body.append(box, outer);
    const at = (relatedTarget: EventTarget | null) => {
      const event = new FocusEvent("focusout", { relatedTarget });
      Object.defineProperty(event, "currentTarget", { value: box });
      return staysInside(event);
    };
    expect(at(inner)).toBe(true);
    expect(at(outer)).toBe(false);
    expect(at(null)).toBe(false);
  });
});
