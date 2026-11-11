import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { buildStyleRules } from "@jxsuite/runtime/css";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import { onSliderChange, onSliderInput, onSliderKeydown } from "../src/behaviors/slider.ts";
import type { SliderState } from "../src/behaviors/slider.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSlider = HTMLElement & {
  value: number;
  min: number;
  max: number;
  step: number;
  valuetext: string;
  disabled: boolean;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** A slider inside a plain ancestor, so every event assertion listens from outside the element. */
async function slider(attrs: Record<string, string> = {}): Promise<JxSlider> {
  const outer = document.createElement("div");
  /* SAFETY: registerUi() in beforeAll defined jx-slider, so createElement returns the upgraded
     element, which carries every reactive property `JxSlider` lists. */
  const el = document.createElement("jx-slider") as JxSlider;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLInputElement>('input[part="input"]')!;
const above = (el: Element) => el.parentElement!;

/** What the ANCESTOR heard, in order, so a doubled or a leaked event is a visible failure. */
function record(el: HTMLElement) {
  const input: string[] = [];
  const change: string[] = [];
  const seen = (event: Event) => {
    /* SAFETY: the listeners sit on the slider's wrapper, so every input or change they hear was
       dispatched by the jx-slider (numeric `value`) or its inner range (string `value`). */
    const from = event.target as HTMLElement & { value?: number | string };
    return `${from.localName}=${from.value}`;
  };
  above(el).addEventListener("input", (e) => {
    input.push(seen(e));
  });
  above(el).addEventListener("change", (e) => {
    change.push(seen(e));
  });
  return { change, input };
}

function key(name: string, shift = false): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey: shift,
  });
}

describe("jx-slider", () => {
  test("is one named native range the platform draws, not an authored slider", async () => {
    const el = await slider({ label: "Zoom", max: "200", min: "10", step: "5", value: "50" });
    const input = control(el);
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("type")).toBe("range");
    expect(input.getAttribute("aria-label")).toBe("Zoom");
    expect(input.getAttribute("min")).toBe("10");
    expect(input.getAttribute("max")).toBe("200");
    expect(input.getAttribute("step")).toBe("5");
    expect(input.value).toBe("50");
    for (const node of el.querySelectorAll("*")) {
      expect(node.hasAttribute("aria-valuenow"), node.localName).toBe(false);
      expect(node.hasAttribute("aria-valuemin"), node.localName).toBe(false);
    }
  });

  test("labelledby and valuetext are forwarded; unset ones write nothing", async () => {
    const named = await slider({ labelledby: "caption", valuetext: "125%", value: "10" });
    expect(control(named).getAttribute("aria-labelledby")).toBe("caption");
    expect(control(named).getAttribute("aria-valuetext")).toBe("125%");
    expect(control(named).hasAttribute("aria-label")).toBe(false);
    const bare = await slider({ label: "Plain" });
    expect(control(bare).hasAttribute("aria-valuetext")).toBe(false);
    expect(control(bare).hasAttribute("aria-labelledby")).toBe(false);
  });

  test("the filled share of the track follows value, min and max", async () => {
    const el = await slider({ label: "Zoom", max: "200", min: "0", value: "50" });
    expect(el.style.getPropertyValue("--jx-slider-fill")).toBe("25%");
    el.value = 200;
    await tick();
    expect(el.style.getPropertyValue("--jx-slider-fill")).toBe("100%");
    el.value = -40;
    await tick();
    expect(el.style.getPropertyValue("--jx-slider-fill")).toBe("0%");
  });

  test("a degenerate range fills nothing", async () => {
    const el = await slider({ label: "Zoom", max: "5", min: "5", value: "5" });
    expect(el.style.getPropertyValue("--jx-slider-fill")).toBe("0%");
  });

  test("a host write of value moves the control, after the reader's own edit as well", async () => {
    const el = await slider({ label: "Zoom", value: "10" });
    const input = control(el);
    input.value = "44";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    el.value = 80;
    await tick();
    expect(input.value).toBe("80");
  });

  test("the inner range's own events are stopped and re-said from the element, once each", async () => {
    const el = await slider({ label: "Zoom", value: "10" });
    const heard = record(el);
    const input = control(el);
    input.value = "66";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(heard.input).toEqual(["jx-slider=66"]);
    expect(heard.change).toEqual(["jx-slider=66"]);
    expect(el.value).toBe(66);
  });

  test("Shift+Arrow moves ten steps, cancels the platform's own, and writes the control now", async () => {
    const el = await slider({ label: "Zoom", step: "2", value: "40" });
    const heard = record(el);
    const event = key("ArrowRight", true);
    control(el).dispatchEvent(event);
    expect(el.value).toBe(60);
    expect(event.defaultPrevented).toBe(true);
    expect(control(el).value).toBe("60");
    expect(heard.input).toEqual(["jx-slider=60"]);
    expect(heard.change).toEqual(["jx-slider=60"]);
    control(el).dispatchEvent(key("ArrowDown", true));
    expect(el.value).toBe(40);
  });

  test("a plain arrow is left entirely to the platform", async () => {
    const el = await slider({ label: "Zoom", value: "40" });
    const heard = record(el);
    const event = key("ArrowRight");
    control(el).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(el.value).toBe(40);
    expect(heard.input).toEqual([]);
  });

  test("ten steps stop at the ends, and a key that changes nothing says nothing", async () => {
    const el = await slider({ label: "Zoom", value: "97" });
    const heard = record(el);
    control(el).dispatchEvent(key("ArrowRight", true));
    expect(el.value).toBe(100);
    expect(heard.change).toEqual(["jx-slider=100"]);
    control(el).dispatchEvent(key("ArrowUp", true));
    expect(el.value).toBe(100);
    expect(heard.change.length).toBe(1);
  });

  test("disabled refuses the platform and the kit's key alike", async () => {
    const el = await slider({ disabled: "", label: "Zoom", value: "40" });
    expect(control(el).disabled).toBe(true);
    expect(el.dataset["disabled"]).toBe("");
    const heard = record(el);
    const event = key("ArrowRight", true);
    control(el).dispatchEvent(event);
    expect(el.value).toBe(40);
    expect(event.defaultPrevented).toBe(false);
    expect(heard.input).toEqual([]);
  });

  test("a native dblclick bubbles from the range untouched, for the host to answer", async () => {
    const el = await slider({ label: "Zoom", value: "40" });
    const heard: EventTarget[] = [];
    above(el).addEventListener("dblclick", (e) => {
      if (e.target) {
        heard.push(e.target);
      }
    });
    control(el).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toBe(control(el));
  });

  test("the control box is the kit's control height, the whole pointer target (SC 2.5.8)", () => {
    const rules = buildStyleRules(documents["jx-slider"].style ?? {}, { scope: "S" }).map(
      (emitted) => emitted.text,
    );
    const input = rules.find((text) => text.startsWith('S [part="input"] {'));
    expect(input).toBeDefined();
    expect(input).toContain("var(--jx-control-h)");
  });

  test("a key on something that is not a slider is not this element's", async () => {
    const el = await slider({ label: "Zoom", value: "40" });
    const heard = record(el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(heard.input).toEqual(["jx-slider=40"]);
    expect(el.value).toBe(40);
  });
});

describe("the sidecar's handlers, called directly", () => {
  const state = (over: Partial<SliderState> = {}): SliderState => ({
    disabled: false,
    max: 100,
    min: 0,
    step: 1,
    value: 10,
    ...over,
  });

  function eventOn(name: string, currentTarget: EventTarget | null): Event {
    const event = new Event(name, { bubbles: true });
    Object.defineProperty(event, "currentTarget", { value: currentTarget });
    return event;
  }

  test("an event whose currentTarget is not a jx-slider is ignored", () => {
    const s = state();
    onSliderInput(s, eventOn("input", document.createElement("div")));
    onSliderChange(s, eventOn("change", null));
    expect(s.value).toBe(10);
  });

  test("a malformed range falls back to a sane grid", async () => {
    const el = await slider({ label: "Zoom", value: "5" });
    const s = state({ max: Number.NaN, min: Number.NaN, step: 0, value: 5 });
    const event = key("ArrowRight", true);
    Object.defineProperty(event, "currentTarget", { value: el });
    onSliderKeydown(s, event);
    expect(s.value).toBe(15);
  });
});

describe("jx-slider as a form control", () => {
  test("name and describedby reach the control, and unset ones write nothing", async () => {
    const bare = await slider({ label: "Opacity" });
    expect(control(bare).hasAttribute("name")).toBe(false);
    expect(control(bare).hasAttribute("aria-describedby")).toBe(false);

    const el = await slider({ describedby: "opacity-help", label: "Opacity", name: "opacity" });
    expect(control(el).getAttribute("name")).toBe("opacity");
    expect(control(el).getAttribute("aria-describedby")).toBe("opacity-help");
  });

  test("a row names and describes a slider slotted into it", async () => {
    const row = document.createElement("jx-field");
    row.setAttribute("label", "Opacity");
    row.setAttribute("description", "How much of the layer shows.");
    row.innerHTML = "<jx-slider></jx-slider>";
    document.body.append(row);
    await tick();
    await tick();
    const input = control(row);
    expect(input.getAttribute("aria-labelledby")).toBe(row.querySelector('[part="label"]')!.id);
    expect(input.getAttribute("aria-describedby")).toBe(row.querySelector('[part="help"]')!.id);
  });
});
