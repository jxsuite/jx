/**
 * `openPopoverSurface` waits for the panel's OWN `jx-ready` before it shows it.
 *
 * `jx-ready` bubbles, and a panel that holds a menu, tabs or an action group is told it is ready by
 * a descendant, one microtask before its own `popover` attribute is on. Showing then throws
 * `NotSupportedError`, which `Publish`'s panel hit the moment an unrelated change moved a kit
 * element's `$src` import by one tick. A fake mount stands in for the document, so the order is the
 * test's rather than the runtime's.
 */
import { mountOverlayLayers } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";

/** The panel the fake mount hands back: no `popover` attribute until the test says so. */
const panel = document.createElement("div");
const shown: ({ source?: Element } | undefined)[] = [];
Object.assign(panel, {
  hidePopover: () => {},
  showPopover: (options?: { source?: Element }) => {
    if (!panel.hasAttribute("popover")) {
      throw new DOMException("Not a popover element", "NotSupportedError");
    }
    shown.push(options);
  },
});

void mock.module("../src/ui/surface", () => ({
  mountSurface: (): Promise<{ dispose: () => void; root: HTMLElement }> =>
    Promise.resolve({ dispose: () => {}, root: panel }),
}));

const { openPopoverSurface } = await import("../src/ui/popover-surface");

/** Let the open path run to the point it is waiting on `jx-ready`. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  mountOverlayLayers();
  panel.removeAttribute("popover");
  panel.replaceChildren();
  shown.length = 0;
});

describe("openPopoverSurface", () => {
  test("a descendant's jx-ready does not show the panel, and the panel's own does", async () => {
    const handle = openPopoverSurface({ name: "x", scope: {}, slot: "probe" });
    await settle();
    const child = document.createElement("span");
    panel.append(child);

    child.dispatchEvent(new Event("jx-ready", { bubbles: true }));
    await settle();
    expect(shown).toEqual([]);

    panel.setAttribute("popover", "auto");
    panel.dispatchEvent(new Event("jx-ready", { bubbles: true }));
    await handle.ready;
    expect(shown).toHaveLength(1);
    handle.close();
  });

  test("a descendant's jx-ready counts once the panel already has its attribute", async () => {
    const handle = openPopoverSurface({ name: "x", scope: {}, slot: "probe" });
    await settle();
    const child = document.createElement("span");
    panel.append(child);

    panel.setAttribute("popover", "auto");
    child.dispatchEvent(new Event("jx-ready", { bubbles: true }));
    await handle.ready;
    expect(shown).toHaveLength(1);
    handle.close();
  });

  test("a panel that already carries its attribute is shown without waiting", async () => {
    panel.setAttribute("popover", "auto");
    const handle = openPopoverSurface({ name: "x", scope: {}, slot: "probe" });
    await handle.ready;
    expect(shown).toHaveLength(1);
    handle.close();
  });
});
