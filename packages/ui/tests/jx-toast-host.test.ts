import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { registerUi } from "../src/index.ts";
import { closeToast } from "../src/behaviors/toast.ts";
import { focusablesIn, focusStack, returnFocus } from "../src/behaviors/toast-host.ts";

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

type HostEl = HTMLElement & { label: string; live: string; placement: string; hotkey: string };
type ToastEl = HTMLElement & { open: boolean };

interface ToastSpec {
  /** Its message, which is also how a test names it. */
  message: string;
  open?: boolean;
  timeout?: string;
  /** A recovery control in the `action` slot. */
  action?: boolean;
}

/** One `jx-toast`, built but not mounted. */
function toast(spec: ToastSpec): ToastEl {
  const el = document.createElement("jx-toast") as ToastEl;
  if (spec.open !== false) {
    el.setAttribute("open", "");
  }
  if (spec.timeout) {
    el.setAttribute("timeout", spec.timeout);
  }
  el.append(spec.message);
  if (spec.action) {
    const button = document.createElement("button");
    button.textContent = "Retry";
    button.setAttribute("slot", "action");
    el.append(button);
  }
  return el;
}

interface Stack {
  host: HostEl;
  toasts: ToastEl[];
  /** A control OUTSIDE the stack, standing in for the reader's own work. */
  elsewhere: HTMLButtonElement;
}

/** A stack in the document, with the keyboard resting on the reader's own work. */
async function stack(attrs: Record<string, string>, specs: ToastSpec[]): Promise<Stack> {
  const elsewhere = document.createElement("button");
  elsewhere.textContent = "Somewhere else";
  const host = document.createElement("jx-toast-host") as HostEl;
  for (const [key, value] of Object.entries(attrs)) {
    host.setAttribute(key, value);
  }
  const toasts = specs.map((spec) => toast(spec));
  host.append(...toasts);
  document.body.append(elsewhere, host);
  elsewhere.focus();
  await flush();
  return { elsewhere, host, toasts };
}

/** The native control a keyboard lands on inside a part. */
const control = (el: Element, name: string) =>
  el
    .querySelector<HTMLElement>(`[part="${name}"]`)!
    .querySelector<HTMLButtonElement>('[part="control"]')!;

/** Press a key where a keyboard press lands: on whatever has focus. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

/** Send a real event of the type the platform would send. */
function send(target: EventTarget, type: string, init: EventInit = {}): void {
  target.dispatchEvent(new Event(type, init));
}

/** The emitted rules for ONE element, by selector. */
function rules(el: HTMLElement): Map<string, string> {
  const scope = el.dataset["jx"];
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (!match || !match[1]!.includes(`[data-jx="${scope}"]`)) {
      continue;
    }
    out.set(match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!);
  }
  return out;
}

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("jx-toast-host", () => {
  test("is the live region, named, and never atomic", async () => {
    const { host } = await stack({}, [{ message: "Published 14 pages." }]);
    expect(host.getAttribute("role")).toBe("status");
    expect(host.getAttribute("aria-live")).toBe("polite");
    expect(host.getAttribute("aria-label")).toBe("Notifications");
    /* `role="status"` supplies `aria-atomic="true"`, which would re-read the WHOLE stack to
       deliver one new message. Written out, so the region announces the arrival alone. */
    expect(host.getAttribute("aria-atomic")).toBe("false");
    expect(host.dataset["placement"]).toBe("bottom-end");
  });

  test("the role and the attribute say the same thing, in all three settings", async () => {
    /* One assistive technology reads the role and another reads the attribute; they must agree,
       which is the same argument `services/announce.ts` makes for its two regions. */
    const loud = await stack({ live: "assertive" }, [{ message: "Disk full." }]);
    expect(loud.host.getAttribute("role")).toBe("alert");
    expect(loud.host.getAttribute("aria-live")).toBe("assertive");
    document.body.replaceChildren();

    const silent = await stack({ live: "off", label: "Background tasks" }, [{ message: "Done." }]);
    // The Studio arrangement: the application announces, so the stack must not say it again.
    expect(silent.host.hasAttribute("role")).toBe(false);
    expect(silent.host.getAttribute("aria-live")).toBe("off");
    expect(silent.host.getAttribute("aria-label")).toBe("Background tasks");
  });

  test("placement moves the box and never the order", async () => {
    const { host, toasts } = await stack({ placement: "top-start" }, [
      { action: true, message: "First" },
      { action: true, message: "Second" },
    ]);
    expect(host.dataset["placement"]).toBe("top-start");
    const emitted = rules(host);
    expect(emitted.get('&[data-placement="top-start"]')).toContain("inset-block-start");
    /* No reversal anywhere: a `column-reverse` would put the newest toast nearest the corner and
       leave the reading order, the focus order and the visual order disagreeing — WCAG 1.3.2 and
       2.4.3 both. The order is the order the host was written in. */
    for (const declarations of emitted.values()) {
      expect(declarations).not.toContain("reverse");
    }
    const reachable = focusablesIn(host);
    expect(toasts[0]!.contains(reachable[0]!)).toBe(true);
    expect(toasts[1]!.contains(reachable[2]!)).toBe(true);
  });

  test("the hotkey brings the keyboard to the first control in the stack, and Escape takes it back", async () => {
    const { host, toasts, elsewhere } = await stack({}, [
      { action: true, message: "Deploy failed." },
      { message: "Published." },
    ]);
    expect(document.activeElement).toBe(elsewhere);

    const arrival = press("F8");
    expect(arrival.defaultPrevented).toBe(true);
    expect(toasts[0]!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.textContent).toBe("Retry");

    const leaving = press("Escape");
    expect(leaving.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(elsewhere);
    // Escape gives focus back; it does not answer the toast for the reader.
    expect(toasts[0]!.open).toBe(true);
    expect(host.contains(document.activeElement)).toBe(false);
  });

  test("a closed toast is not somewhere the keyboard can be sent", async () => {
    const { toasts } = await stack({}, [
      { action: true, message: "Gone", open: false },
      { action: true, message: "Here" },
    ]);
    press("F8");
    expect(toasts[1]!.contains(document.activeElement)).toBe(true);
  });

  test("a press with a modifier, a different key, or no hotkey at all moves nothing", async () => {
    const { elsewhere } = await stack({}, [{ action: true, message: "Deploy failed." }]);
    press("F8", { ctrlKey: true });
    expect(document.activeElement).toBe(elsewhere);
    press("F7");
    expect(document.activeElement).toBe(elsewhere);
    document.body.replaceChildren();

    const off = await stack({ hotkey: "" }, [{ action: true, message: "Deploy failed." }]);
    press("F8");
    expect(document.activeElement).toBe(off.elsewhere);
  });

  test("the hotkey does not swallow the press when there is nothing to reach", async () => {
    const { elsewhere } = await stack({}, [{ message: "Gone", open: false }]);
    const event = press("F8");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  test("attention anywhere in the stack suspends EVERY clock in it", async () => {
    const { toasts } = await stack({}, [
      { message: "Older", timeout: "40" },
      { action: true, message: "Newer", timeout: "40" },
    ]);
    // The pointer lands on the newer toast; the older one must not retire out from under it.
    send(toasts[1]!, "pointerover", { bubbles: true });
    await wait(120);
    expect(toasts[0]!.open).toBe(true);
    expect(toasts[1]!.open).toBe(true);

    send(toasts[1]!, "pointerout", { bubbles: true });
    await wait(120);
    expect(toasts[0]!.open).toBe(false);
    expect(toasts[1]!.open).toBe(false);
  });

  test("crossing between two toasts of one stack is not a departure", async () => {
    const { host, toasts } = await stack({}, [
      { message: "Older", timeout: "40" },
      { message: "Newer", timeout: "40" },
    ]);
    send(toasts[0]!, "pointerover", { bubbles: true });
    const crossing = new PointerEvent("pointerout", { bubbles: true, relatedTarget: toasts[1]! });
    toasts[0]!.dispatchEvent(crossing);
    await wait(120);
    expect(toasts.every((one) => one.open)).toBe(true);
    expect(host.querySelectorAll("jx-toast")).toHaveLength(2);
  });

  test("a toast that closes under the reader hands focus back; one that closes elsewhere does not", async () => {
    const { toasts, elsewhere } = await stack({}, [
      { action: true, message: "Deploy failed." },
      { action: true, message: "Also failed." },
    ]);
    press("F8");
    expect(toasts[0]!.contains(document.activeElement)).toBe(true);

    // Another toast retiring while the reader is answering this one must move nothing.
    const held = document.activeElement;
    closeToast(toasts[1]!, "timeout");
    expect(document.activeElement).toBe(held);

    // The one they are standing IN is different: the platform would drop focus on the floor.
    control(toasts[0]!, "dismiss").focus();
    control(toasts[0]!, "dismiss").click();
    expect(toasts[0]!.open).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  test("with nothing remembered, focus is only let go of, never moved somewhere chosen", async () => {
    const { host, toasts } = await stack({}, [{ action: true, message: "Deploy failed." }]);
    // Focus arrived without the hotkey, so there is no origin: the stack lets go rather than guess.
    control(toasts[0]!, "dismiss").focus();
    expect(returnFocus(host)).toBe(false);
    expect(host.contains(document.activeElement)).toBe(false);
  });

  test("focusStack is the same door the hotkey uses, and answers when there is no door", async () => {
    const { host, toasts, elsewhere } = await stack({}, [{ action: true, message: "Failed." }]);
    expect(focusStack(host)).toBe(true);
    expect(toasts[0]!.contains(document.activeElement)).toBe(true);
    expect(returnFocus(host)).toBe(true);
    expect(document.activeElement).toBe(elsewhere);

    toasts[0]!.open = false;
    await flush();
    expect(focusStack(host)).toBe(false);
  });

  test("a stack taken out of the document takes its key with it", async () => {
    const { host, toasts, elsewhere } = await stack({}, [{ action: true, message: "Failed." }]);
    host.remove();
    const event = press("F8");
    /* The press is UNANSWERED, which is the assertion: a document listener outlives the element
       that registered it, and a detached stack still holds focusable controls, so "focus did not
       move" alone cannot tell a released key from a leaked one calling focus() on a node no
       reader can see. An unclaimed press is what says the key went with the stack. */
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
    expect(toasts[0]!.contains(document.activeElement)).toBe(false);
  });

  test("mounting a stack takes nothing from the reader", async () => {
    const { host, elsewhere } = await stack({}, [{ action: true, message: "Failed." }]);
    expect(document.activeElement).toBe(elsewhere);
    // And Escape while the reader is outside the stack is not the stack's business.
    const outside = press("Escape");
    expect(outside.defaultPrevented).toBe(false);
    expect(host.contains(document.activeElement)).toBe(false);
  });
});
