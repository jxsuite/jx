/**
 * `openPopoverSurface` shows its panel on the panel's OWN `jx-ready`. A bubbling `jx-ready` from a
 * descendant (a tab strip, a menu) arrives first and must not trigger `showPopover()`, which throws
 * while the panel's `popover` attribute is not yet on.
 */
import "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";

const shown: string[] = [];
let panel: HTMLElement;

void mock.module("../src/ui/surface", () => ({
  mountSurface: () => {
    panel = document.createElement("div");
    const inner = document.createElement("div");
    inner.id = "inner";
    panel.append(inner);
    Object.assign(panel, {
      hidePopover: () => {},
      showPopover: () => {
        if (!panel.hasAttribute("popover")) {
          throw new Error("showPopover on a panel without the popover attribute");
        }
        shown.push("shown");
      },
    });
    return Promise.resolve({ dispose: () => {}, root: panel });
  },
  registerSurface: () => {},
}));

const { openPopoverSurface } = await import("../src/ui/popover-surface");

afterEach(() => {
  shown.length = 0;
  document.body.replaceChildren();
});

describe("openPopoverSurface", () => {
  test("a descendant's bubbling jx-ready does not show the panel early", async () => {
    const handle = openPopoverSurface({ name: "x", scope: {}, slot: "t" });
    await Promise.resolve();
    await Promise.resolve();
    const inner = panel.querySelector("#inner");
    inner?.dispatchEvent(new Event("jx-ready", { bubbles: true }));
    await Promise.resolve();
    expect(shown).toEqual([]);
    panel.setAttribute("popover", "auto");
    panel.dispatchEvent(new Event("jx-ready", { bubbles: true }));
    await handle.ready;
    expect(shown).toEqual(["shown"]);
    handle.close();
  });
});
