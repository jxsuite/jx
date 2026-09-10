import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSplit = HTMLElement & {
  value: number;
  min: number;
  max: number;
  gap: number;
  step: number;
  largeStep: number;
  collapse: number;
  restore: number;
  orientation: string;
  disabled: boolean;
  dragging: boolean;
};

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A splitter inside the shape Studio's pane grid actually gives it: a measurable outer box, two
 * `display: contents` wrappers, and the element between two siblings.
 *
 * The wrappers are not decoration. They are the reason {@link trackOf} walks rather than reading
 * `parentElement`, so every measurement assertion below is one the pane grid makes for real.
 */
async function split(
  attrs: Record<string, string> = {},
  props: Partial<JxSplit> = {},
): Promise<{ el: JxSplit; track: HTMLElement; row: HTMLElement }> {
  const track = document.createElement("div");
  const row = document.createElement("div");
  row.style.display = "contents";
  const slot = document.createElement("div");
  slot.style.display = "contents";
  const el = document.createElement("jx-split") as JxSplit;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  Object.assign(el, props);
  slot.append(el);
  row.append(slot);
  track.append(row);
  document.body.append(track);
  await tick();
  return { el, row, track };
}

/** Give an element a box, because happy-dom lays nothing out and a fraction needs one. */
function measure(el: Element, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      bottom: height,
      height,
      left: 0,
      right: width,
      toJSON: () => ({}),
      top: 0,
      width,
      x: 0,
      y: 0,
    }) as DOMRect;
}

/** A pointer event with a coordinate, built by hand because happy-dom ships no PointerEvent. */
function pointer(type: string, clientX: number, clientY = 0, button = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { button, clientX, clientY, pointerId: 7 });
  return event;
}

function key(name: string, shift = false): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey: shift,
  });
}

/** Record the capture calls, which happy-dom does not implement. */
function captures(el: HTMLElement): { taken: number[]; released: number[] } {
  const log = { released: [] as number[], taken: [] as number[] };
  let held = -1;
  Object.assign(el, {
    hasPointerCapture: (id: number) => held === id,
    releasePointerCapture: (id: number) => {
      log.released.push(id);
      held = -1;
      el.dispatchEvent(pointer("lostpointercapture", 0));
    },
    setPointerCapture: (id: number) => {
      log.taken.push(id);
      held = id;
    },
  });
  return log;
}

/** What an ANCESTOR heard, as the value each event carried. */
function heard(el: HTMLElement): { input: number[]; change: number[] } {
  const out = { change: [] as number[], input: [] as number[] };
  const seen = (event: Event) => (event.target as JxSplit).value;
  const above = el.parentElement!.parentElement!.parentElement!;
  above.addEventListener("input", (e) => {
    out.input.push(seen(e));
  });
  above.addEventListener("change", (e) => {
    out.change.push(seen(e));
  });
  return out;
}

/** The emitted rules that mention ONE element's scope handle, keyed by selector, `&` for the handle. */
function rulesOf(el: HTMLElement): Map<string, string> {
  const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (match && match[1]!.includes(handle)) {
      out.set(match[1]!.replaceAll(handle, "&"), match[2]!);
    }
  }
  return out;
}

/** One property as the CASCADE resolves it. */
const computed = (el: HTMLElement, prop: string) =>
  (getComputedStyle(el) as unknown as Record<string, string>)[prop] ?? "";

describe("jx-split announces itself", () => {
  test("is a separator, a tab stop, and says where it sits", async () => {
    const { el } = await split({ label: "Navigator and editor" });
    expect(el.getAttribute("role")).toBe("separator");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("aria-label")).toBe("Navigator and editor");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe("0.5");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("1");
    /* The percentage is the reader's answer to "where is it": `aria-valuenow` on a separator is a
       bare fraction, and 0.5 of a range nobody announced is not a position anybody can picture. */
    expect(el.getAttribute("aria-valuetext")).toBe("50%");
    expect(el.getAttribute("aria-disabled")).toBeNull();
    // It draws NOTHING inside itself: a splitter is one box, and the box is the element.
    expect(el.children).toHaveLength(0);
  });

  test("the percentage is of the DECLARED range, not of the whole track", async () => {
    /* A pane splitter that may only travel between 0.2 and 0.8 is at one end when it reads 0.2,
       and a reader told "20%" would hear that it is a fifth of the way along a journey it cannot
       start. The travel IS the range, so the range is what the percentage divides. */
    const { el } = await split({ min: "0.2", max: "0.8", value: "0.2" });
    expect(el.getAttribute("aria-valuetext")).toBe("0%");
    el.value = 0.8;
    await tick();
    expect(el.getAttribute("aria-valuetext")).toBe("100%");
    el.value = 0.5;
    await tick();
    expect(el.getAttribute("aria-valuetext")).toBe("50%");
  });

  test("a zero-width range answers rather than dividing by nothing", async () => {
    const { el } = await split({ min: "0.4", max: "0.4", value: "0.4" });
    expect(el.getAttribute("aria-valuetext")).toBe("0%");
  });

  test("disabled drops out of the tab order and says so", async () => {
    const { el } = await split({ disabled: "" });
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(el.getAttribute("aria-disabled")).toBe("true");
  });

  test("orientation REFLECTS, so the styling branch is reachable through the property door", async () => {
    const { el } = await split();
    expect(el.getAttribute("orientation")).toBe("vertical");
    expect(computed(el, "cursor")).toBe("col-resize");
    el.orientation = "horizontal";
    await tick();
    expect(el.getAttribute("orientation")).toBe("horizontal");
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
    expect(computed(el, "cursor")).toBe("row-resize");
  });

  test("hidden hides it, and the base box is a block that will not be flexed away", async () => {
    const { el } = await split();
    const base = rulesOf(el).get("&") ?? "";
    expect(base).toContain("display: block");
    expect(base).toContain("flex: none");
    expect(base).toContain("touch-action: none");
    expect(computed(el, "flexShrink")).toBe("0");
    expect(rulesOf(el).get("&[hidden]")).toBe("display: none");
    el.hidden = true;
    await tick();
    expect(computed(el, "display")).toBe("none");
  });
});

describe("the pointer", () => {
  test("a drag is a pointer delta over the MEASURED track, through two contents wrappers", async () => {
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    const log = captures(el);
    const events = heard(el);

    el.dispatchEvent(pointer("pointerdown", 500));
    expect(log.taken).toEqual([7]);
    expect(el.dataset["dragging"]).toBe("");
    expect(el.dragging).toBe(true);

    el.dispatchEvent(pointer("pointermove", 640));
    expect(el.value).toBeCloseTo(0.64, 5);
    expect(el.getAttribute("aria-valuenow")).toBe(String(el.value));

    el.dispatchEvent(pointer("pointerup", 640));
    expect(el.dataset["dragging"]).toBeUndefined();
    expect(log.released).toEqual([7]);
    /* One `input` per move that changed something and exactly one `change` on release — the
       contract every host in the kit reads: move as it happens, persist once. */
    expect(events.input).toEqual([0.64]);
    expect(events.change).toEqual([0.64]);
  });

  test("a `display: contents` wrapper is walked PAST even when it answers with a box", async () => {
    /* The wrapper generates no box, so whatever a browser reports for it describes its children —
       here the splitter and the cell beside it — rather than the track. Chrome answers the union;
       happy-dom answers zero. Stubbing a box onto the wrapper is what makes the two realms ask the
       same question of this code, and it is the only reason the skip is provable at all: with every
       rect at zero the walk would step over it for the other reason and the branch would read as
       covered while proving nothing.

       The numbers are chosen so the two answers differ: measured against the 200px wrapper the same
       140px of travel is +0.7, and against the 1000px track it is +0.14. */
    const { el, track, row } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    measure(row, 200, 200);
    captures(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", 640));
    expect(el.value).toBeCloseTo(0.64, 5);
  });

  test("the press does NOT jump the value, and a move with no press moves nothing", async () => {
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    el.dispatchEvent(pointer("pointermove", 900));
    expect(el.value).toBe(0.5);
    el.dispatchEvent(pointer("pointerdown", 200));
    expect(el.value).toBe(0.5);
  });

  test("the press takes the focus, so the arrows carry on from where the pointer stopped", async () => {
    /* `preventDefault` is what stops the drag selecting the text on either side of the splitter,
       and a cancelled `pointerdown` never focuses — so the focus is taken explicitly. Without it a
       reader who has just dragged a split and wants one more pixel has to go and find the splitter
       with the Tab key first. */
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    const down = pointer("pointerdown", 500);
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el);
    el.dispatchEvent(pointer("pointerup", 500));
    el.dispatchEvent(key("ArrowRight"));
    expect(el.value).toBeCloseTo(0.52, 5);
  });

  test("a horizontal splitter reads the OTHER coordinate", async () => {
    const { el, track } = await split({ orientation: "horizontal", value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    el.dispatchEvent(pointer("pointerdown", 0, 100));
    el.dispatchEvent(pointer("pointermove", 999, 140));
    expect(el.value).toBeCloseTo(0.7, 5);
  });

  test("an unlaid-out track answers nothing rather than answering at its origin", async () => {
    /* Every rect in happy-dom is zero unless it is stubbed, which is also the state of a real
       splitter rendered into a box that has not been laid out yet. A fraction of nothing is not a
       position, so the gesture never begins — and because it never begins, the capture is never
       taken and no `change` is emitted on the way out. */
    const { el } = await split({ value: "0.5" });
    const log = captures(el);
    const events = heard(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    expect(log.taken).toEqual([]);
    expect(el.dragging).toBe(false);
    el.dispatchEvent(pointer("pointermove", 900));
    el.dispatchEvent(pointer("pointerup", 900));
    expect(el.value).toBe(0.5);
    expect(events.input).toEqual([]);
    expect(events.change).toEqual([]);
  });

  test("a secondary button is not a drag", async () => {
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    const log = captures(el);
    el.dispatchEvent(pointer("pointerdown", 500, 0, 2));
    expect(log.taken).toEqual([]);
    el.dispatchEvent(pointer("pointermove", 900));
    expect(el.value).toBe(0.5);
  });

  test("disabled refuses the pointer outright", async () => {
    const { el, track } = await split({ disabled: "", value: "0.5" });
    measure(track, 1000, 200);
    const log = captures(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", 900));
    expect(log.taken).toEqual([]);
    expect(el.value).toBe(0.5);
  });

  test("a capture lost any other way still ends the gesture, once", async () => {
    /* `pointerup` was never the only exit. A gesture the system takes away, or one whose capture
       goes because something replaced the subtree, would otherwise leave the record in the map and
       the splitter drawn as though a hand were on it — with no further event able to clear either.
       The record is deleted FIRST, which is what stops the release inside the handler re-entering
       through the `lostpointercapture` it fires. */
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    const log = captures(el);
    const events = heard(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", 600));
    el.dispatchEvent(pointer("pointercancel", 600));
    expect(el.dragging).toBe(false);
    expect(log.released).toEqual([7]);
    expect(events.change).toEqual([0.6]);
    // And the drag really is over: a later move is a hover.
    el.dispatchEvent(pointer("pointermove", 900));
    expect(el.value).toBeCloseTo(0.6, 5);
    expect(events.change).toEqual([0.6]);
  });

  test("a gesture that ends where it began still commits", async () => {
    /* The commit is about the gesture ENDING rather than about the final pixel: a reader who takes
       hold of the splitter and puts it back has still chosen where it is, and a host that persists
       on `change` must not be left thinking nothing happened. */
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    const events = heard(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointerup", 500));
    expect(events.input).toEqual([]);
    expect(events.change).toEqual([0.5]);
  });
});

describe("the bounds", () => {
  test("min and max and the pixel gap are INTERSECTED, and the gap is measured fresh", async () => {
    /* The two answer different questions — the host's policy about the split, and the smallest a
       side can usefully be — so a splitter has to respect both. The gap is the half that cannot be
       a fraction: 320px of a 1000px track is 0.32 and of a 640px track is 0.5, and a host that
       computed either into a prop would be wrong the moment the window moved. */
    const { el, track } = await split({ min: "0.2", max: "0.8", gap: "320", value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", -5000));
    expect(el.value).toBeCloseTo(0.32, 5);
    el.dispatchEvent(pointer("pointermove", 5000));
    expect(el.value).toBeCloseTo(0.68, 5);
    el.dispatchEvent(pointer("pointerup", 5000));

    // The SAME element, a narrower box, a different floor — with nothing re-declared anywhere.
    measure(track, 800, 200);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", -5000));
    expect(el.value).toBeCloseTo(0.4, 5);
    el.dispatchEvent(pointer("pointerup", -5000));
  });

  test("min and max still bound a splitter with no gap", async () => {
    const { el, track } = await split({ min: "0.25", max: "0.75", value: "0.5" });
    measure(track, 1000, 200);
    captures(el);
    el.dispatchEvent(pointer("pointerdown", 500));
    el.dispatchEvent(pointer("pointermove", 0));
    expect(el.value).toBeCloseTo(0.25, 5);
    el.dispatchEvent(pointer("pointermove", 1000));
    expect(el.value).toBeCloseTo(0.75, 5);
  });

  test("a track too narrow for two gaps goes to the MIDDLE of its crossed bounds", async () => {
    /* There is no legal position at all, and the two honest answers are "refuse to move" and "treat
       the two sides alike". The middle is the second one, and with a symmetric gap it is the even
       split — the position a reader would draw themselves. Pinning to one end, which a naive clamp
       does, silently gives the whole box to whichever side the clamp happened to visit last. */
    const { el, track } = await split({ gap: "320", value: "0.5" });
    measure(track, 400, 200);
    captures(el);
    el.dispatchEvent(pointer("pointerdown", 200));
    el.dispatchEvent(pointer("pointermove", 0));
    expect(el.value).toBeCloseTo(0.5, 5);
    el.dispatchEvent(pointer("pointermove", 400));
    expect(el.value).toBeCloseTo(0.5, 5);
  });
});

describe("the keyboard", () => {
  test("the arrows of its own axis move it by a step, and Shift by the larger one", async () => {
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    const events = heard(el);
    const press = (name: string, shift = false) => {
      const event = key(name, shift);
      el.dispatchEvent(event);
      return event;
    };

    expect(press("ArrowRight").defaultPrevented).toBe(true);
    expect(el.value).toBeCloseTo(0.52, 5);
    press("ArrowLeft");
    press("ArrowLeft");
    expect(el.value).toBeCloseTo(0.48, 5);
    press("ArrowRight", true);
    expect(el.value).toBeCloseTo(0.58, 5);
    /* A keystroke is a move AND a commit, which is what the platform's own arrow does on a range: a
       host that persists on `change` persists once per key rather than never. */
    expect(events.input).toEqual(events.change);
    expect(events.input).toHaveLength(4);
  });

  test("the CROSS-axis arrows are left entirely alone", async () => {
    /* A splitter is one tab stop inside somebody's application. Cancelling ArrowUp on a column
       splitter would take a scroll away from the reader and give nothing back. */
    const { el, track } = await split({ value: "0.5" });
    measure(track, 1000, 200);
    const up = key("ArrowUp");
    el.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(el.value).toBe(0.5);

    const { el: flat, track: flatTrack } = await split({ orientation: "horizontal", value: "0.5" });
    measure(flatTrack, 1000, 200);
    const right = key("ArrowRight");
    flat.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    expect(flat.value).toBe(0.5);
    const down = key("ArrowDown");
    flat.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(flat.value).toBeCloseTo(0.52, 5);
  });

  test("a key this element does not own reaches the host untouched", async () => {
    /* The other half of what `jx-tree` owes: an application chord pressed with the caret on a
       splitter still runs, and Tab still leaves. */
    const { el, track } = await split();
    measure(track, 1000, 200);
    for (const name of ["Tab", "x", "Escape", " "]) {
      const event = key(name);
      el.dispatchEvent(event);
      expect(event.defaultPrevented, name).toBe(false);
    }
    expect(el.value).toBe(0.5);
  });

  test("Home and End go to the ends of the LEGAL range, gap included", async () => {
    const { el, track } = await split({ min: "0.2", max: "0.8", gap: "320", value: "0.5" });
    measure(track, 1000, 200);
    el.dispatchEvent(key("Home"));
    expect(el.value).toBeCloseTo(0.32, 5);
    el.dispatchEvent(key("End"));
    expect(el.value).toBeCloseTo(0.68, 5);
  });

  test("the keyboard still works when the track cannot be measured", async () => {
    /* A drag is refused with no geometry because a fraction of nothing is not a position. A STEP is
       arithmetic on a number the element already has, so it is not refused: a splitter a sighted
       reader can drag and a keyboard reader cannot move is an SC 2.1.1 failure that a layout timing
       accident would otherwise be allowed to cause. The declared bounds are what it falls back to. */
    const { el } = await split({ min: "0.2", max: "0.8", gap: "320", value: "0.5" });
    el.dispatchEvent(key("Home"));
    expect(el.value).toBeCloseTo(0.2, 5);
    el.dispatchEvent(key("End"));
    expect(el.value).toBeCloseTo(0.8, 5);
    el.dispatchEvent(key("ArrowLeft"));
    expect(el.value).toBeCloseTo(0.78, 5);
  });

  test("disabled refuses every key", async () => {
    const { el, track } = await split({ disabled: "", value: "0.5" });
    measure(track, 1000, 200);
    const event = key("ArrowRight");
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(el.value).toBe(0.5);
  });
});

describe("the collapse toggle — the SC 2.5.7 door", () => {
  test("Enter collapses to the floor and the next one restores where it was", async () => {
    const { el, track } = await split({ min: "0.2", max: "0.8", value: "0.65" });
    measure(track, 1000, 200);
    const events = heard(el);
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.2, 5);
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.65, 5);
    expect(events.input).toEqual(events.change);
  });

  test("collapse points the toggle wherever the host says", async () => {
    /* `min` is what collapsing means for most splitters. A splitter whose two sides are BOTH real
       panes has no collapsed position, so it points the toggle at the one its double click has
       always restored — and gets the return trip for free. */
    const { el, track } = await split({ min: "0.2", max: "0.8", collapse: "0.5", value: "0.65" });
    measure(track, 1000, 200);
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.5, 5);
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.65, 5);
  });

  test("a splitter BORN at its collapse position still opens", async () => {
    /* Nothing has been remembered, so the toggle has nowhere to restore to — and a control that
       visibly does nothing on its first press is one a reader cannot tell from a broken one. The
       middle of the legal range is a defined, reachable, uncollapsed place. */
    const { el, track } = await split({ min: "0.2", max: "0.8", collapse: "0.5", value: "0.5" });
    measure(track, 1000, 200);
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.5, 5);
    expect(el.getAttribute("aria-valuenow")).toBe(String(el.value));
    // It moved off the collapse position, so the next press is an ordinary collapse again.
    el.value = 0.7;
    await tick();
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBeCloseTo(0.5, 5);
  });

  test("a double click is the same gesture through the other door", async () => {
    const { el, track } = await split({ min: "0.2", max: "0.8", value: "0.7" });
    measure(track, 1000, 200);
    const events = heard(el);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(el.value).toBeCloseTo(0.2, 5);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(el.value).toBeCloseTo(0.7, 5);
    expect(events.change).toEqual([0.2, 0.7]);
  });

  test("a disabled splitter does not toggle either", async () => {
    const { el, track } = await split({ disabled: "", value: "0.7" });
    measure(track, 1000, 200);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    el.dispatchEvent(key("Enter"));
    expect(el.value).toBe(0.7);
  });
});
