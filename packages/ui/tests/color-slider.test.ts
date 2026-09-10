import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxColorSlider = HTMLElement & {
  value: number;
  min: number;
  max: number;
  step: number;
  channel: string;
  color: string;
  disabled: boolean;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A slider inside a plain ancestor, because every event assertion here listens from that ancestor
 * rather than from the element: a listener on the dispatch target hears an event whether or not it
 * bubbles, and "one event, from the element" is only a promise a delegated listener can rely on.
 */
async function slider(attrs: Record<string, string> = {}): Promise<JxColorSlider> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-color-slider") as JxColorSlider;
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
function record(el: HTMLElement): { input: string[]; change: string[] } {
  const heard = { change: [] as string[], input: [] as string[] };
  const seen = (event: Event) =>
    `${(event.target as HTMLElement).localName}=${
      (event.target as HTMLElement & { value?: unknown }).value
    }`;
  above(el).addEventListener("input", (e) => {
    heard.input.push(seen(e));
  });
  above(el).addEventListener("change", (e) => {
    heard.change.push(seen(e));
  });
  return heard;
}

/** A keydown the platform would deliver to the focused control. */
function key(name: string, shift = false): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey: shift,
  });
}

describe("jx-color-slider", () => {
  test("is one named native range the platform draws, not an authored slider", async () => {
    const el = await slider({ channel: "hue", label: "Hue", value: "120" });
    const input = control(el);
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("type")).toBe("range");
    expect(input.getAttribute("aria-label")).toBe("Hue");
    expect(input.getAttribute("aria-valuetext")).toBe("120 degrees");
    expect(input.value).toBe("120");
    /* The native slider derives its announced range from min/max/value. An authored one would lag
       a keystroke, so the element writes none of the three anywhere in its tree. */
    for (const node of el.querySelectorAll("*")) {
      expect(node.hasAttribute("aria-valuenow"), node.localName).toBe(false);
      expect(node.hasAttribute("aria-valuemin"), node.localName).toBe(false);
    }
  });

  test("the channel resolves the top of the range, and max overrides it", async () => {
    const hue = await slider({ channel: "hue", label: "Hue" });
    expect(control(hue).getAttribute("max")).toBe("360");
    const alpha = await slider({ channel: "alpha", label: "Opacity" });
    expect(control(alpha).getAttribute("max")).toBe("100");
    /* Nothing else in the element knows the number: the same computed is what the sidecar's own
       clamp reads, so a band cuts both the platform's arrows and the kit's ten-step key. */
    const band = await slider({ channel: "hue", label: "Warm", max: "60" });
    expect(control(band).getAttribute("max")).toBe("60");
  });

  test("the track is a gradient the channel chooses, and an alpha track names its colour", async () => {
    const hue = await slider({ channel: "hue", label: "Hue" });
    expect(hue.style.getPropertyValue("--jx-color-track-image")).toContain("hsl(240 100% 50%)");
    const alpha = await slider({ channel: "alpha", color: "#3b82f6", label: "Opacity" });
    expect(alpha.style.getPropertyValue("--jx-color-track-image")).toBe(
      "linear-gradient(to right, transparent, #3b82f6)",
    );
    const bare = await slider({ channel: "alpha", label: "Opacity" });
    expect(bare.style.getPropertyValue("--jx-color-track-image")).toContain("currentColor");
  });

  test("a host write of value moves the control, after the reader's own edit as well", async () => {
    const el = await slider({ channel: "hue", label: "Hue", value: "10" });
    const input = control(el);
    /* Typing sets the control's dirty value flag, after which the `value` CONTENT attribute no
       longer moves the live value — so a binding written only into `attributes` would look correct
       up to here and stop tracking from here on. */
    input.value = "44";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    el.value = 300;
    await tick();
    expect(input.value).toBe("300");
    expect(control(el).getAttribute("aria-valuetext")).toBe("300 degrees");
  });

  test("the inner range's own events are stopped and re-said from the element, once each", async () => {
    const el = await slider({ channel: "hue", label: "Hue", value: "10" });
    const heard = record(el);
    const input = control(el);
    input.value = "200";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    /* One of each, and `e.target` is the ELEMENT rather than the range: a host reading a colour
       must never have to know which node inside fired. */
    expect(heard.input).toEqual(["jx-color-slider=200"]);
    expect(heard.change).toEqual(["jx-color-slider=200"]);
    expect(el.value).toBe(200);
  });

  test("Shift+Arrow moves ten steps, cancels the platform's own, and writes the control now", async () => {
    const el = await slider({ channel: "hue", label: "Hue", step: "2", value: "100" });
    const heard = record(el);
    const event = key("ArrowRight", true);
    control(el).dispatchEvent(event);
    expect(el.value).toBe(120);
    expect(event.defaultPrevented).toBe(true);
    /* Written synchronously rather than left to the render: a host reading `e.target` during the
       handler must not see the value the control had before the key. */
    expect(control(el).value).toBe("120");
    expect(heard.input).toEqual(["jx-color-slider=120"]);
    expect(heard.change).toEqual(["jx-color-slider=120"]);

    const down = key("ArrowDown", true);
    control(el).dispatchEvent(down);
    expect(el.value).toBe(100);
  });

  test("a plain arrow is left entirely to the platform", async () => {
    const el = await slider({ channel: "hue", label: "Hue", value: "100" });
    const heard = record(el);
    const event = key("ArrowRight");
    control(el).dispatchEvent(event);
    /* Not cancelled, nothing written, nothing said: the platform's own step, clamp and
       announcement are what run, and two implementations of one key is two answers. */
    expect(event.defaultPrevented).toBe(false);
    expect(el.value).toBe(100);
    expect(heard.input).toEqual([]);
  });

  test("ten steps stop at the ends, and a key that changes nothing says nothing", async () => {
    const el = await slider({ channel: "alpha", label: "Opacity", value: "97" });
    const heard = record(el);
    control(el).dispatchEvent(key("ArrowRight", true));
    expect(el.value).toBe(100);
    expect(heard.change).toEqual(["jx-color-slider=100"]);
    control(el).dispatchEvent(key("ArrowUp", true));
    expect(el.value).toBe(100);
    expect(heard.change.length).toBe(1);
  });

  test("disabled refuses the platform and the kit's key alike", async () => {
    const el = await slider({ channel: "hue", disabled: "", label: "Hue", value: "100" });
    expect(control(el).disabled).toBe(true);
    expect(el.dataset["disabled"]).toBe("");
    const heard = record(el);
    const event = key("ArrowRight", true);
    control(el).dispatchEvent(event);
    expect(el.value).toBe(100);
    expect(event.defaultPrevented).toBe(false);
    expect(heard.input).toEqual([]);
  });

  test("a key on something that is not a slider is not this element's", async () => {
    const el = await slider({ channel: "hue", label: "Hue", value: "100" });
    const heard = record(el);
    /* The element's own re-dispatch arrives at the root listener too, and must not be re-read. */
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(heard.input).toEqual(["jx-color-slider=100"]);
    expect(el.value).toBe(100);
  });
});
