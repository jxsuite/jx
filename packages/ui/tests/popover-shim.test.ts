import "./with-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";

/**
 * The shim stands in for the top layer, which happy-dom does not implement. It is published as
 * `@jxsuite/ui/testing/popover-shim`, so a consumer's suite inherits whatever it models — and a
 * shim that models the platform wrongly makes correct code look broken. These cases are the ones
 * measured in a real engine (Chrome 152) rather than reasoned about.
 */
const panel = (mode: string): HTMLElement => {
  const el = document.createElement("div");
  el.setAttribute("popover", mode);
  document.body.append(el);
  return el;
};
const isOpen = (el: HTMLElement) => el.matches("[data-popover-open]");

afterEach(() => {
  document.body.replaceChildren();
});

describe("the popover shim's surface", () => {
  test("refuses an element that is not a popover, the way the platform does", () => {
    const plain = document.createElement("div");
    document.body.append(plain);
    expect(() => plain.showPopover()).toThrow(DOMException);
    expect(() => plain.hidePopover()).toThrow(DOMException);
  });

  test("showing an already-open popover is a no-op, not a second toggle", () => {
    const el = panel("auto");
    const seen: string[] = [];
    el.addEventListener("beforetoggle", (e) => seen.push((e as ToggleEvent).newState));
    el.showPopover();
    el.showPopover();
    expect(seen).toEqual(["open"]);
    expect(isOpen(el)).toBe(true);
  });

  test("togglePopover flips, and honours a forced value", () => {
    const el = panel("auto");
    expect(el.togglePopover()).toBe(true);
    expect(isOpen(el)).toBe(true);
    expect(el.togglePopover()).toBe(false);
    expect(isOpen(el)).toBe(false);
    expect(el.togglePopover(true)).toBe(true);
    expect(el.togglePopover(true)).toBe(true);
    expect(isOpen(el)).toBe(true);
    expect(el.togglePopover(false)).toBe(false);
    expect(isOpen(el)).toBe(false);
  });

  test("hiding a closed popover changes nothing", () => {
    const el = panel("auto");
    el.hidePopover();
    expect(isOpen(el)).toBe(false);
  });

  test("installing twice leaves the first implementation in place", async () => {
    // The shim stands down where the host has a real one, and must not stack on itself.
    const { installPopoverShim } = await import("../src/testing/popover-shim.ts");
    const before = HTMLElement.prototype.showPopover;
    installPopoverShim();
    expect(HTMLElement.prototype.showPopover).toBe(before);
  });
});

describe("the popover shim's dismissal model", () => {
  test("a hint shows over an open auto, and does not close it", () => {
    // The whole reason `hint` exists: a tip can sit over an open menu explaining one of its rows.
    const menu = panel("auto");
    const tip = panel("hint");
    menu.showPopover();
    tip.showPopover();
    expect(isOpen(menu)).toBe(true);
    expect(isOpen(tip)).toBe(true);
  });

  test("an auto closes both other autos and any hint", () => {
    const menu = panel("auto");
    const tip = panel("hint");
    const other = panel("auto");
    menu.showPopover();
    tip.showPopover();
    other.showPopover();
    expect(isOpen(menu)).toBe(false);
    expect(isOpen(tip)).toBe(false);
    expect(isOpen(other)).toBe(true);
  });

  test("a hint closes another hint", () => {
    const first = panel("hint");
    const second = panel("hint");
    first.showPopover();
    second.showPopover();
    expect(isOpen(first)).toBe(false);
    expect(isOpen(second)).toBe(true);
  });

  test("a manual closes nothing and is closed by nothing", () => {
    const kept = panel("manual");
    const menu = panel("auto");
    kept.showPopover();
    menu.showPopover();
    expect(isOpen(kept)).toBe(true);
    expect(isOpen(menu)).toBe(true);
  });

  test("an invalid mode is manual, the way HTML's invalid-value default is", () => {
    const odd = panel("sometimes");
    const menu = panel("auto");
    odd.showPopover();
    menu.showPopover();
    expect(isOpen(odd)).toBe(true);
  });

  test("a nested popover does not close the one it sits inside", () => {
    const outer = panel("auto");
    const inner = document.createElement("div");
    inner.setAttribute("popover", "auto");
    outer.append(inner);
    outer.showPopover();
    inner.showPopover();
    expect(isOpen(outer)).toBe(true);
    expect(isOpen(inner)).toBe(true);
  });
});
