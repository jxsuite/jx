/**
 * `whenOwnReady`: `jx-ready` bubbles, so a panel that holds a tab strip or a menu hears a
 * descendant announce itself before its own `popover` attribute is on. Only the panel's own
 * announcement counts.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { whenOwnReady } from "../src/ui/own-ready";

function ready(target: Element): void {
  target.dispatchEvent(new Event("jx-ready", { bubbles: true }));
}

describe("whenOwnReady", () => {
  test("a descendant's announcement does not settle it, the element's own does", async () => {
    const panel = document.createElement("div");
    const tabs = document.createElement("div");
    panel.append(tabs);
    let settled = false;
    const waiting = whenOwnReady(panel).then(() => {
      settled = true;
    });
    ready(tabs);
    await Promise.resolve();
    expect(settled).toBe(false);
    ready(panel);
    await waiting;
    expect(settled).toBe(true);
  });

  test("it stops listening once settled", async () => {
    const panel = document.createElement("div");
    const waiting = whenOwnReady(panel);
    ready(panel);
    await waiting;
    // A second announcement finds no listener left to resolve again.
    expect(() => {
      ready(panel);
    }).not.toThrow();
  });
});
