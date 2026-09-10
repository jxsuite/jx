import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxColorArea = HTMLElement & {
  hue: number;
  saturation: number;
  brightness: number;
  step: number;
  disabled: boolean;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** A square inside a plain ancestor, so every event assertion is one a host could actually make. */
async function area(attrs: Record<string, string> = {}): Promise<JxColorArea> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-color-area") as JxColorArea;
  el.setAttribute("label", "Colour");
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  return el;
}

const track = (el: Element) => el.querySelector<HTMLElement>('[part="track"]')!;
const axis = (el: Element, which: "x" | "y") =>
  el.querySelector<HTMLInputElement>(`input[part="${which}"]`)!;
const above = (el: Element) => el.parentElement!;

/** What the ANCESTOR heard, as `target=saturation/brightness`. */
function record(el: HTMLElement): { input: string[]; change: string[] } {
  const heard = { change: [] as string[], input: [] as string[] };
  const seen = (event: Event) => {
    const t = event.target as JxColorArea;
    return `${t.localName}=${t.saturation}/${t.brightness}`;
  };
  above(el).addEventListener("input", (e) => {
    heard.input.push(seen(e));
  });
  above(el).addEventListener("change", (e) => {
    heard.change.push(seen(e));
  });
  return heard;
}

/** Give the track a box, because happy-dom lays nothing out and a coordinate needs one. */
function measure(el: Element, width = 200, height = 100): void {
  track(el).getBoundingClientRect = () =>
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
function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX, clientY, pointerId: 1 });
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

describe("jx-color-area", () => {
  test("is a named group holding two named native sliders, one per axis", async () => {
    const el = await area({ brightness: "80", saturation: "40" });
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("aria-label")).toBe("Colour");
    for (const [which, name, value] of [
      ["x", "Saturation", "40"],
      ["y", "Brightness", "80"],
    ] as const) {
      const input = axis(el, which);
      expect(input.getAttribute("type")).toBe("range");
      expect(input.getAttribute("aria-label")).toBe(name);
      expect(input.getAttribute("min")).toBe("0");
      expect(input.getAttribute("max")).toBe("100");
      expect(input.value).toBe(value);
    }
    expect(axis(el, "x").getAttribute("aria-valuetext")).toBe("40%");
    /* Not one authored slider value anywhere: the platform derives all three from the controls. */
    for (const node of el.querySelectorAll("*")) {
      expect(node.hasAttribute("aria-valuenow"), node.localName).toBe(false);
    }
  });

  test("the two ranges are transparent rather than hidden, which is the whole keyboard", async () => {
    const el = await area();
    const rule = documentStyleText()
      .split("\n")
      .find(
        (line) =>
          line.includes(`[data-jx="${el.dataset["jx"]}"] [part="x"]`) && line.includes("opacity"),
      );
    expect(rule).toBeString();
    /* Hiding them with `display: none` or `visibility: hidden` would take them out of the
       accessibility tree and out of the tab order, leaving a square only a pointer can operate. */
    expect(rule).toContain("opacity: 0");
    expect(rule).toContain("pointer-events: none");
    expect(rule).not.toContain("display: none");
    expect(rule).not.toContain("visibility: hidden");
    expect(axis(el, "x").hasAttribute("hidden")).toBe(false);
    expect(axis(el, "y").hasAttribute("hidden")).toBe(false);
  });

  test("the thumb is placed from the axes, with the vertical one measured upward", async () => {
    const el = await area({ brightness: "75", hue: "265", saturation: "40" });
    expect(el.style.getPropertyValue("--jx-color-area-x")).toBe("40%");
    /* 75 brightness is a quarter of the way DOWN, because a reader's square is bright at the top
       and a stylesheet's origin is not. */
    expect(el.style.getPropertyValue("--jx-color-area-y")).toBe("25%");
    expect(el.style.getPropertyValue("--jx-color-area-hue")).toBe("hsl(265 100% 50%)");
  });

  test("a range's own events are stopped and re-said from the element, once each", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    const heard = record(el);
    const x = axis(el, "x");
    x.value = "64";
    x.dispatchEvent(new Event("input", { bubbles: true }));
    x.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.saturation).toBe(64);
    /* One of each, from the ELEMENT: two controls holding half a coordinate each cannot both be
       `e.target` for one colour. */
    expect(heard.input).toEqual(["jx-color-area=64/50"]);
    expect(heard.change).toEqual(["jx-color-area=64/50"]);
  });

  test("an along-axis arrow with no Shift is left entirely to the platform", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    const heard = record(el);
    const right = key("ArrowRight");
    axis(el, "x").dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    expect(el.saturation).toBe(50);
    const up = key("ArrowUp");
    axis(el, "y").dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(el.brightness).toBe(50);
    expect(heard.input).toEqual([]);
  });

  test("the CROSS-axis arrow is the kit's, because a range knows only one dimension", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    const heard = record(el);
    /* Up on the saturation control is the platform stepping saturation, which to a reader looking
       at one square with one thumb is the thumb moving sideways when they pressed up. */
    const up = key("ArrowUp");
    axis(el, "x").dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(el.brightness).toBe(51);
    expect(el.saturation).toBe(50);

    const left = key("ArrowLeft");
    axis(el, "y").dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(el.saturation).toBe(49);
    expect(heard.input).toEqual(["jx-color-area=50/51", "jx-color-area=49/51"]);
    expect(heard.change.length).toBe(2);
  });

  test("Home, End and the Page keys are the platform's, on the axis that owns them", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    const heard = record(el);
    for (const name of ["Home", "End", "PageUp", "PageDown"]) {
      const event = key(name);
      axis(el, "x").dispatchEvent(event);
      expect(event.defaultPrevented, name).toBe(false);
    }
    expect(el.saturation).toBe(50);
    expect(heard.input).toEqual([]);
  });

  test("Shift takes ten steps, on either axis and on either control", async () => {
    const el = await area({ brightness: "50", saturation: "50", step: "2" });
    axis(el, "x").dispatchEvent(key("ArrowRight", true));
    expect(el.saturation).toBe(70);
    axis(el, "x").dispatchEvent(key("ArrowDown", true));
    expect(el.brightness).toBe(30);
    axis(el, "y").dispatchEvent(key("ArrowUp", true));
    expect(el.brightness).toBe(50);
  });

  test("both axes clamp, and a key that moves nothing says nothing", async () => {
    const el = await area({ brightness: "100", saturation: "3" });
    const heard = record(el);
    axis(el, "x").dispatchEvent(key("ArrowUp", true));
    expect(el.brightness).toBe(100);
    expect(heard.input).toEqual([]);
    axis(el, "y").dispatchEvent(key("ArrowLeft", true));
    expect(el.saturation).toBe(0);
    expect(heard.input).toEqual(["jx-color-area=0/100"]);
  });

  test("a pointer sets both axes, and one press with no movement is a whole gesture", async () => {
    const el = await area({ brightness: "0", saturation: "0" });
    measure(el);
    const heard = record(el);
    const down = pointer("pointerdown", 50, 25);
    track(el).dispatchEvent(down);
    /* A quarter across, three quarters up: the square's y is measured from the bottom. */
    expect(el.saturation).toBe(25);
    expect(el.brightness).toBe(75);
    expect(down.defaultPrevented).toBe(true);
    track(el).dispatchEvent(pointer("pointerup", 50, 25));
    /* The commit is about the gesture ending, so a click that landed on the value already there
       still says the reader chose it. */
    expect(heard.input).toEqual(["jx-color-area=25/75"]);
    expect(heard.change).toEqual(["jx-color-area=25/75"]);
  });

  test("a drag keeps reading, and is clamped where it leaves the square", async () => {
    const el = await area();
    measure(el);
    const heard = record(el);
    track(el).dispatchEvent(pointer("pointerdown", 100, 50));
    track(el).dispatchEvent(pointer("pointermove", 180, 10));
    track(el).dispatchEvent(pointer("pointermove", 600, -40));
    expect(el.saturation).toBe(100);
    expect(el.brightness).toBe(100);
    expect(heard.input.length).toBe(3);
    track(el).dispatchEvent(pointer("pointercancel", 600, -40));
    /* A gesture the system takes away is over: a square left dragging would follow the next
       pointer that crossed it with no button down. */
    expect(heard.change.length).toBe(1);
    track(el).dispatchEvent(pointer("pointermove", 20, 90));
    expect(el.saturation).toBe(100);
  });

  test("a move with no press before it moves nothing", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    measure(el);
    const heard = record(el);
    track(el).dispatchEvent(pointer("pointermove", 20, 20));
    expect(el.saturation).toBe(50);
    expect(heard.input).toEqual([]);
  });

  test("an unlaid-out square says nothing rather than answering at the origin", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    const heard = record(el);
    track(el).dispatchEvent(pointer("pointerdown", 40, 40));
    expect(el.saturation).toBe(50);
    expect(heard.input).toEqual([]);
  });

  test("the hue is read and never written, so dragging into grey keeps it", async () => {
    const el = await area({ hue: "265" });
    measure(el);
    track(el).dispatchEvent(pointer("pointerdown", 0, 0));
    expect(el.saturation).toBe(0);
    expect(el.hue).toBe(265);
    expect(el.style.getPropertyValue("--jx-color-area-hue")).toBe("hsl(265 100% 50%)");
  });

  test("disabled refuses the pointer and the kit's keys, and disables both controls", async () => {
    const el = await area({ brightness: "50", disabled: "", saturation: "50" });
    measure(el);
    expect(axis(el, "x").disabled).toBe(true);
    expect(axis(el, "y").disabled).toBe(true);
    const heard = record(el);
    const down = pointer("pointerdown", 10, 10);
    track(el).dispatchEvent(down);
    expect(el.saturation).toBe(50);
    expect(down.defaultPrevented).toBe(false);
    const up = key("ArrowUp");
    axis(el, "x").dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(heard.input).toEqual([]);
  });

  test("a key on the square that is on neither range is nobody's", async () => {
    const el = await area({ brightness: "50", saturation: "50" });
    el.dispatchEvent(key("ArrowUp"));
    expect(el.brightness).toBe(50);
    el.dispatchEvent(key("Tab", true));
    expect(el.brightness).toBe(50);
  });
});
