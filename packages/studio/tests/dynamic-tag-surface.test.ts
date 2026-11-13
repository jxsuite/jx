/**
 * The tag popover's surface on its own (src/surfaces/dynamic-tag.ts, studio.md §6.9): where the
 * panel is put, what takes the keyboard, and what a close means.
 *
 * `dynamic-tag-popover.test.ts` drives this through the flow. Here the adapter is handed a
 * projection directly, so the placement rules can be asserted against a panel of a known height.
 */
import { flush, stubRect } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { emptyDynamicTagView, mountDynamicTag } from "../src/surfaces/dynamic-tag";

import type {
  DynamicTagActions,
  DynamicTagSurface,
  DynamicTagView,
} from "../src/surfaces/dynamic-tag";

let host: HTMLElement;
let surface: DynamicTagSurface | null = null;
let closed = 0;
const applied: string[] = [];

const actions: DynamicTagActions = {
  applyExpression: (text) => applied.push(text),
  closed: () => {
    closed += 1;
  },
  describeDraft: (text) => `note for ${text}`,
  setFallbackText: () => {},
  setFallbackWhen: () => {},
  setFormat: () => {},
  setParam: () => {},
  setShow: () => {},
  setSource: () => {},
};

/** The panel as the kit's popover holds it. */
function panel(): HTMLElement & { x: number; y: number } {
  const el = host.querySelector('[part="panel"]');
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("the popover is not mounted");
  }
  /* SAFETY: `part="panel"` is the document's `jx-popover`, which declares `x` and `y` (numbers) as
     public state the kit exposes as properties. */
  return el as HTMLElement & { x: number; y: number };
}

/** One animation frame, and the turns after it. */
async function frame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
  await flush(4);
}

function view(overrides: Partial<DynamicTagView> = {}): DynamicTagView {
  return { ...emptyDynamicTagView(), expr: "state.x", title: "X", ...overrides };
}

beforeAll(() => {
  const show = HTMLElement.prototype.showPopover;
  const hide = HTMLElement.prototype.hidePopover;
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement, ...args) {
    show.apply(this, args);
    this.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open" }));
  };
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    hide.apply(this);
    this.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  closed = 0;
  applied.length = 0;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

afterEach(() => {
  surface?.dispose();
  surface = null;
  host.remove();
});

describe("where the panel goes", () => {
  test("an open that arrives before the document is mounted is shown when the mount lands", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view());
    surface.open({ x: 10.4, y: 20.6 });
    expect(host.querySelector('[part="panel"]')).toBeNull();
    await flush(8);
    expect([panel().x, panel().y]).toEqual([10, 21]);
    expect(panel().querySelector('[part="title"]')?.textContent).toBe("X");
  });

  test("under what was pressed where it fits, and above it where it does not", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view());
    await flush(8);
    // Room below: at the point given.
    surface.open({ above: 80, x: 40, y: 110 });
    expect(panel().y).toBe(110);
    // No room below a chip near the window's foot: above its top edge, less the panel and a gap.
    stubRect(panel(), { height: 300, top: 0, width: 320 });
    surface.close();
    surface.open({ above: 700, x: 40, y: 730 });
    await flush(4);
    // The first open measured the panel: 300 tall.
    surface.close();
    surface.open({ above: 700, x: 40, y: 730 });
    expect(panel().y).toBe(700 - 300 - 6);
    // Neither fits: under it, and the platform's own clamp keeps it on screen.
    surface.close();
    surface.open({ above: 120, x: 40, y: 760 });
    expect(panel().y).toBe(760);
    // A door that names no top edge is taken at its word.
    surface.close();
    surface.open({ x: 40, y: 790 });
    expect(panel().y).toBe(790);
  });

  test("a panel that grows past the window's foot is moved up to stand on it", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view());
    await flush(8);
    surface.open({ x: 40, y: 500 });
    await flush(4);
    stubRect(panel(), { height: 420, top: 500, width: 320 });
    surface.update(view({ title: "Grown" }));
    await frame();
    expect(panel().y).toBe(800 - 420 - 6);
    // One that fits is left where it is.
    stubRect(panel(), { height: 100, top: 374, width: 320 });
    surface.update(view({ title: "Small" }));
    await frame();
    expect(panel().y).toBe(374);
  });
});

describe("the keyboard", () => {
  test("goes to the Source control of a structured tag and to the expression of a custom one", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view({ structured: true }));
    await flush(8);
    surface.open({ x: 0, y: 0 });
    await frame();
    expect(document.activeElement?.closest('[part="source"]')).not.toBeNull();
    surface.close();
    surface.update(view({ advancedOpen: true, structured: false }));
    await flush(4);
    surface.open({ x: 0, y: 0 });
    await frame();
    expect(document.activeElement?.closest('[part="expression"]')).not.toBeNull();
  });

  test("a close before the frame that would focus leaves focus where it is", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view({ structured: true }));
    await flush(8);
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    surface.open({ x: 0, y: 0 });
    surface.close();
    await frame();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

describe("what a close means", () => {
  test("the flow's own close is not reported back, and the platform's is, once", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view());
    await flush(8);
    surface.open({ x: 0, y: 0 });
    surface.close();
    surface.close();
    expect(closed).toBe(0);
    surface.open({ x: 0, y: 0 });
    panel().hidePopover();
    expect(closed).toBe(1);
    // A toggle event that is not a popover's (no state on it) is nobody's close.
    surface.open({ x: 0, y: 0 });
    panel().dispatchEvent(new Event("toggle"));
    expect(closed).toBe(1);
  });

  test("the platform reports a close after the fact: one this surface made, shown again before it arrives, is not the platform's", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view());
    await flush(8);
    surface.open({ x: 0, y: 0 });
    const hide = HTMLElement.prototype.hidePopover;
    const late: Event[] = [];
    // The doubles report a close at once; a browser reports it as a task of its own: held here.
    HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
      const send = this.dispatchEvent.bind(this);
      this.dispatchEvent = (event: Event) => {
        if (event.type === "toggle") {
          late.push(event);
          return true;
        }
        return send(event);
      };
      try {
        hide.call(this);
      } finally {
        Reflect.deleteProperty(this, "dispatchEvent");
      }
    };
    try {
      // A press in the canvas closes the panel, and the chip's own click shows it for the next tag.
      surface.close();
      surface.open({ x: 0, y: 0 });
      // The report of the first close arrives now.
      for (const event of late.splice(0)) {
        panel().dispatchEvent(event);
      }
      expect(closed).toBe(0);
      // A close the platform makes of the shown panel is still reported, once.
      panel().hidePopover();
      for (const event of late.splice(0)) {
        panel().dispatchEvent(event);
      }
      expect(closed).toBe(1);
    } finally {
      HTMLElement.prototype.hidePopover = hide;
    }
  });

  test("a surface let go before its mount lands is taken down when it does", async () => {
    surface = mountDynamicTag(host, actions);
    surface.open({ x: 0, y: 0 });
    surface.dispose();
    await flush(8);
    expect(host.querySelector('[part="panel"]')).toBeNull();
    // And letting go twice is nothing.
    surface.dispose();
  });
});

describe("Advanced", () => {
  test("the draft follows the tag until the author types, and Apply hands over what was typed", async () => {
    surface = mountDynamicTag(host, actions);
    surface.update(view({ advancedOpen: true }));
    await flush(8);
    const field = panel().querySelector<HTMLTextAreaElement>('[part="expression"] textarea');
    const apply = panel().querySelector<HTMLElement>('[part="apply"] [part="control"]');
    expect(field?.value).toBe("state.x");
    // Clean: Apply has nothing to apply.
    apply?.click();
    expect(applied).toEqual([]);
    field!.value = "state.y";
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(4);
    expect(panel().querySelector('[part="advanced-note"]')?.textContent).toBe("note for state.y");
    // A repaint with the same tag keeps what is being typed.
    surface.update(view({ advancedOpen: true, nowText: "later" }));
    await flush(4);
    expect(field?.value).toBe("state.y");
    apply?.click();
    expect(applied).toEqual(["state.y"]);
    // The tag moved under the field: the field starts from it again.
    surface.update(view({ advancedOpen: true, expr: "state.z" }));
    await flush(4);
    expect(field?.value).toBe("state.z");
    expect(panel().querySelector('[part="advanced-note"]')?.textContent).toBe("");
  });
});
