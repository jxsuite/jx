import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";
import document_ from "../components/jx-number-field.json";
import { registerUi } from "../src/index.ts";
import {
  onNumberChange,
  onNumberKeydown,
  onStepDown,
  onStepUp,
  stepBy,
} from "../src/behaviors/number-field.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxNumberField = HTMLElement & {
  value: string;
  min: string;
  max: string;
  step: string;
  stepper: boolean;
  badInput: boolean;
  disabled: boolean;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A field inside a plain ancestor, because every event assertion here listens from that ancestor
 * rather than from the element: a listener on the dispatch target hears an event whether or not it
 * bubbles, and "the platform's own names" is only a promise a delegated listener can rely on.
 *
 * @param attrs Attributes to set before the element is connected.
 * @returns The element.
 */
async function field(attrs: Record<string, string> = {}): Promise<JxNumberField> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-number-field") as JxNumberField;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLInputElement>('[part="input"]')!;

/** The ancestor a delegated host listener would sit on. */
const above = (el: Element) => el.parentElement!;

/** One event, as the host's own handler sees it. */
interface Heard {
  /** What `e.target` is: the live control on the reader's paths, the element on the element's. */
  from: string;
  /** `e.target.value`, which both of those answer with the same string. */
  value: string;
  /** The sanitization case, read off the element the way a host reads it. */
  badInput: boolean;
}

/** What the ANCESTOR heard, in order, so a doubled commit is a visible failure rather than a pass. */
function record(el: HTMLElement): { input: Heard[]; change: Heard[] } {
  const heard = { input: [] as Heard[], change: [] as Heard[] };
  const seen = (event: Event): Heard => {
    const target = event.target as HTMLElement & { value: string };
    const host = target.closest<JxNumberField>("jx-number-field");
    return { badInput: host?.badInput === true, from: target.localName, value: target.value };
  };
  above(el).addEventListener("input", (e) => {
    heard.input.push(seen(e));
  });
  above(el).addEventListener("change", (e) => {
    heard.change.push(seen(e));
  });
  return heard;
}

/** A keydown the platform would deliver to the inner control. */
function key(name: string, shift: boolean): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    shiftKey: shift,
  });
}

describe("jx-number-field", () => {
  test("is a named native spinbutton the platform draws, not an authored one", async () => {
    const el = await field({ label: "Opacity", placeholder: "auto", value: "0.5" });
    const input = control(el);
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("type")).toBe("number");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.getAttribute("aria-label")).toBe("Opacity");
    expect(input.getAttribute("placeholder")).toBe("auto");
    expect(input.value).toBe("0.5");
    /* The native spinbutton derives its announced value from value/min/max. An authored one would
       lag a Shift-step, so the element writes none of the three anywhere in its tree. */
    for (const node of el.querySelectorAll("*")) {
      expect(node.hasAttribute("aria-valuenow"), node.localName).toBe(false);
      expect(node.hasAttribute("aria-valuemin"), node.localName).toBe(false);
      expect(node.hasAttribute("aria-valuemax"), node.localName).toBe(false);
    }
    expect(el.hasAttribute("aria-valuenow")).toBe(false);
  });

  test("value is a string, so a removed attribute is empty and never zero", async () => {
    const el = await field({ label: "Opacity" });
    el.setAttribute("value", "3");
    await tick();
    expect(el.value).toBe("3");
    el.removeAttribute("value");
    await tick();
    /* A removed attribute is absorbed back to the entry's DECLARED DEFAULT, which for this entry is
       the empty string. Asserted exactly, with no `?? ""` around it: a regression to null or
       undefined is the failure this clause exists for, because `Number(null)` is 0 and a host
       deleting a numeric key would write 0 into the document instead of removing it. */
    expect(el.value).toBe("");
    expect(typeof el.value).toBe("string");
    expect(control(el).value).toBe("");
  });

  test("an unset min, max or step is an absent attribute rather than an empty one", async () => {
    const el = await field({ label: "Opacity" });
    const input = control(el);
    for (const name of ["min", "max", "step"]) {
      expect(input.hasAttribute(name), name).toBe(false);
    }
    el.setAttribute("min", "0");
    el.setAttribute("max", "1");
    el.setAttribute("step", "0.1");
    await tick();
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("1");
    expect(input.getAttribute("step")).toBe("0.1");
    el.removeAttribute("max");
    await tick();
    expect(input.hasAttribute("max")).toBe(false);
  });

  test("the value is bound as a property AND mirrored to the attribute, and both are load-bearing", async () => {
    const el = await field({ label: "Opacity", value: "3" });
    const input = control(el);
    expect(input.getAttribute("value")).toBe("3");
    expect(input.defaultValue).toBe("3");

    /* The dirty-flag case. Typing sets the control's dirty value flag, after which the `value`
       CONTENT attribute no longer moves the live value — so a document binding written only into
       `attributes` would look correct up to here and stop tracking from here on. */
    input.value = "9";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(el.value).toBe("9");
    expect(input.getAttribute("value")).toBe("9");

    el.value = "5";
    await tick();
    expect(input.value).toBe("5");
    // And the attribute mirror keeps up, which is what the next test's reset depends on.
    expect(input.getAttribute("value")).toBe("5");
    expect(input.defaultValue).toBe("5");
  });

  test("a form reset is a no-op, which is the price of the value attribute mirror", async () => {
    const form = document.createElement("form");
    const el = document.createElement("jx-number-field") as JxNumberField;
    el.setAttribute("label", "Opacity");
    el.setAttribute("value", "3");
    form.append(el);
    document.body.append(form);
    await tick();
    const input = control(el);

    input.value = "9";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(el.value).toBe("9");

    form.reset();
    await tick();
    /* The element is not form-associated (specs/ui.md §3.2), so it never hears the reset. Mirroring
       `value` into the content attribute makes the control's default track its current value, which
       makes a reset do nothing; NOT mirroring it would move the control back to "3" and leave this
       state at "9" — the element and its own control disagreeing, silently. The no-op is the
       deliberate half of that trade, and it changes the day the element is form-associated. */
    expect(input.value).toBe("9");
    expect(el.value).toBe("9");
  });

  test("Shift+ArrowUp moves ten steps, clamps at max, and says so once from the host", async () => {
    const el = await field({ label: "Size", max: "25", step: "1", value: "20" });
    const heard = record(el);
    const event = key("ArrowUp", true);
    control(el).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(control(el).value).toBe("25");
    expect(el.value).toBe("25");
    /* The element wrote this value, so the platform said nothing and the element says it — from the
       HOST, in the platform's own two names, and reaching an ancestor because they bubble. */
    expect(heard.input).toEqual([{ badInput: false, from: "jx-number-field", value: "25" }]);
    expect(heard.change).toEqual([{ badInput: false, from: "jx-number-field", value: "25" }]);
  });

  test("Shift+ArrowDown moves ten steps down and clamps at min", async () => {
    const el = await field({ label: "Size", min: "5", step: "1", value: "9" });
    const heard = record(el);
    control(el).dispatchEvent(key("ArrowDown", true));
    expect(control(el).value).toBe("5");
    expect(el.value).toBe("5");
    expect(heard.input.length).toBe(1);
    expect(heard.change).toEqual([{ badInput: false, from: "jx-number-field", value: "5" }]);
  });

  test("a Shift-step is the control's own stepUp, never arithmetic of ours", async () => {
    /* Min 0, step 0.3, value 0.5 is off the step grid. The HTML step-up algorithm snaps an off-grid
       value to the next grid point measured from `min` and ignores the multiplier entirely, so the
       answer is "0.6"; `value + step * 10` is "3.5" and stays off the grid forever.

       WHAT THIS ENVIRONMENT CAN WITNESS. happy-dom's own `stepUp` IS the naive arithmetic this
       element exists to replace — measured 2026-09: it honours an integer step, drops a fractional
       one (`parseInt("0.3")` is 0, so it falls back to 1) and never snaps to a grid. So a reference
       input would be the arithmetic under test, and the grid literal is asserted only where the
       engine implements the algorithm at all. What is pinned in EVERY engine is the delegation: the
       multiplier reaches the control's own API, and a stepping API that moves nothing leaves the
       value where it was, so no arithmetic can be hiding behind the call. */
    const probe = document.createElement("input");
    probe.type = "number";
    probe.min = "0";
    probe.step = "0.3";
    probe.value = "0.5";
    probe.stepUp(10);
    const snapsToGrid = probe.value === "0.6";

    const el = await field({ label: "Ratio", min: "0", step: "0.3", value: "0.5" });
    const input = control(el);
    const multipliers: number[] = [];
    const native = input.stepUp.bind(input);
    input.stepUp = (n = 1) => {
      multipliers.push(n);
      native(n);
    };

    input.dispatchEvent(key("ArrowUp", true));
    expect(multipliers).toEqual([10]);
    expect(el.value).toBe(input.value);
    expect(el.value).not.toBe("3.5");
    if (snapsToGrid) {
      expect(el.value).toBe("0.6");
    } else {
      // This engine's arithmetic, `0.5 + 10 * 1`, recorded so the day it grows the algorithm shows.
      expect(el.value).toBe("10.5");
    }

    const stalled = el.value;
    input.stepUp = () => {
      /* A stepping API that moves nothing. */
    };
    input.dispatchEvent(key("ArrowUp", true));
    expect(el.value).toBe(stalled);
  });

  test("a plain Arrow is the platform's own single step, uncancelled", async () => {
    const el = await field({ label: "Size", step: "1", value: "3" });
    const heard = record(el);
    const event = key("ArrowUp", false);
    control(el).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(heard.input).toEqual([]);
    expect(heard.change).toEqual([]);
  });

  test("the stepper is a sibling of the input, so toggling it never rebuilds the control", async () => {
    /* A `$switch` that wrapped the input would rebuild its subtree, and a debounced commit that
       closed over the old node would then commit blank 400ms later. */
    const el = await field({ label: "Size", value: "7" });
    const input = control(el);
    expect(el.querySelector('[part="stepper-slot"]')?.contains(input)).toBe(false);
    expect(input.parentElement).toBe(
      el.querySelector<HTMLElement>('[part="stepper-slot"]')!.parentElement,
    );

    el.stepper = true;
    await tick();
    expect(control(el)).toBe(input);
    expect(el.querySelector('[part="step-up"]')).not.toBeNull();
    el.stepper = false;
    await tick();
    expect(control(el)).toBe(input);
    expect(el.querySelector('[part="step-up"]')).toBeNull();
    expect(input.value).toBe("7");
  });

  test("the stepper buttons step one, are named, and keep focus in the field", async () => {
    const el = await field({
      label: "Size",
      "step-down-label": "Fewer",
      "step-up-label": "More",
      step: "1",
      stepper: "",
      value: "4",
    });
    const up = el.querySelector<HTMLButtonElement>('[part="step-up"]')!;
    const down = el.querySelector<HTMLButtonElement>('[part="step-down"]')!;
    for (const button of [up, down]) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("tabindex")).toBe("-1");
      // A button with no name is reported unnamed even when hidden, so these carry real names.
      expect(button.hasAttribute("aria-hidden")).toBe(false);
    }
    expect(up.getAttribute("aria-label")).toBe("More");
    expect(down.getAttribute("aria-label")).toBe("Fewer");

    const press = new Event("pointerdown", { bubbles: true, cancelable: true });
    up.dispatchEvent(press);
    // Without this the press blurs the field and the blur commits the same edit a second time.
    expect(press.defaultPrevented).toBe(true);

    const heard = record(el);
    up.click();
    expect(el.value).toBe("5");
    expect(heard.input).toEqual([{ badInput: false, from: "jx-number-field", value: "5" }]);
    expect(heard.change).toEqual([{ badInput: false, from: "jx-number-field", value: "5" }]);
    down.click();
    expect(el.value).toBe("4");
    expect(heard.change.length).toBe(2);
    expect(heard.change[1]).toEqual({ badInput: false, from: "jx-number-field", value: "4" });
  });

  test("empty AND badInput is one state: the value reads empty, the element says it is a half-typed number", async () => {
    /* The pairing is the entire reason the mechanism exists — a host that deletes a key on an empty
       value must not delete on this one. It cannot be typed here: happy-dom runs no value
       sanitization at all (measured: `input.value = "1e"` reads back "1e"), so what a browser's own
       sanitization produces — an empty value with `validity.badInput` true — is staged on the
       control instead of typed into it. */
    const el = await field({ label: "Opacity", value: "1" });
    const input = control(el);
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: () => {
        /* A sanitized control keeps nothing the reader typed. */
      },
    });
    Object.defineProperty(input, "validity", {
      configurable: true,
      get: () => ({ badInput: true }) as ValidityState,
    });

    const heard = record(el);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(el.value).toBe("");
    expect(el.badInput).toBe(true);
    // The mirror a selector and a delegated handler read, on the HOST rather than in a detail.
    expect(el.dataset["badInput"]).toBe("");
    expect(heard.input).toEqual([{ badInput: true, from: "input", value: "" }]);

    input.dispatchEvent(new Event("change", { bubbles: true }));
    // One change per commit, from the live control, with the case readable off the element.
    expect(heard.change).toEqual([{ badInput: true, from: "input", value: "" }]);
    // The commit mirrors the sanitized value as it stands: empty, and not coerced to a number.
    expect(el.value).toBe("");
    expect(el.badInput).toBe(true);

    Reflect.deleteProperty(input, "value");
    Reflect.deleteProperty(input, "validity");
    input.value = "2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(el.value).toBe("2");
    expect(el.badInput).toBe(false);
    expect(el.dataset["badInput"]).toBeUndefined();
  });

  test("a committed edit bubbles from the live control, so a host still reads valueAsNumber", async () => {
    const el = await field({ label: "Opacity", value: "1" });
    const heard = record(el);
    const numbers: number[] = [];
    above(el).addEventListener("change", (e) => {
      numbers.push((e.target as HTMLInputElement).valueAsNumber);
    });
    const input = control(el);
    input.value = "8";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.value).toBe("8");
    /* The reader wrote this one, so the platform's own change is what a host hears: not stopped, not
       re-sent from the host. That is the one call-site edit the plan names — a numeric widget reads
       `e.target.valueAsNumber` — and it is only writable while `e.target` is the control. */
    expect(heard.change).toEqual([{ badInput: false, from: "input", value: "8" }]);
    expect(numbers).toEqual([8]);

    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // NaN and not 0, which is the whole reason the value is a string: clearing deletes a key.
    expect(numbers[1]).toBeNaN();
    expect(el.value).toBe("");
    expect(heard.change.length).toBe(2);
  });

  test("disabled reaches the control and both stepping buttons", async () => {
    const el = await field({ disabled: "", label: "Size", stepper: "" });
    expect(control(el).disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[part="step-up"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[part="step-down"]')!.disabled).toBe(true);
    expect(el.dataset["disabled"]).toBeDefined();
  });

  test("size, name and the forwarded description reach where they are read", async () => {
    const el = await field({
      describedby: "outside-hint",
      label: "Size",
      labelledby: "outside-label",
      name: "width",
      size: "sm",
    });
    expect(el.dataset["size"]).toBe("sm");
    expect(control(el).name).toBe("width");
    expect(control(el).getAttribute("aria-labelledby")).toBe("outside-label");
    expect(control(el).getAttribute("aria-describedby")).toBe("outside-hint");
  });
});

describe("jx-number-field style", () => {
  test("removes the UA spinner explicitly, because appearance alone does not", async () => {
    /* `appearance: none` on the input leaves WebKit's own stepping buttons drawn; the two
       pseudo-elements are the only thing that takes them away, and the element draws its own. */
    await field({ label: "Size" });
    const sheet = documentStyleText();
    for (const pseudo of ["::-webkit-inner-spin-button", "::-webkit-outer-spin-button"]) {
      const rule = new RegExp(`\\[part="input"\\]${pseudo}\\s*\\{[^}]*appearance:\\s*none`);
      expect(rule.test(sheet), pseudo).toBe(true);
    }
  });

  test("does not style :invalid, so a value only the host can refuse is never drawn as refused", () => {
    /* A min or a max makes the platform match `:invalid` on an out-of-range value, and a value the
       host has not refused must not be drawn in the danger colour. There is no `invalid` prop
       either: no surveyed call site has one. */
    expect(JSON.stringify(document_.style)).not.toContain(":invalid");
  });
});

describe("the number-field sidecar", () => {
  test("stepBy calls the control's own stepping API with the multiplier it was given", async () => {
    const el = await field({ label: "Size", step: "1", value: "2" });
    const input = control(el);
    const calls: [string, number][] = [];
    input.stepUp = (n = 1) => {
      calls.push(["up", n]);
    };
    input.stepDown = (n = 1) => {
      calls.push(["down", n]);
    };
    const state = { badInput: false, value: "2" };
    stepBy(state, { currentTarget: input } as unknown as Event, 3);
    stepBy(state, { currentTarget: input } as unknown as Event, -7);
    expect(calls).toEqual([
      ["up", 3],
      ["down", 7],
    ]);
  });

  test("onStepUp and onStepDown are one step each, in the right direction", async () => {
    const el = await field({ label: "Size", step: "2", value: "10" });
    const input = control(el);
    const state = { badInput: false, value: "10" };
    onStepUp(state, { currentTarget: input } as unknown as Event);
    expect(state.value).toBe("12");
    onStepDown(state, { currentTarget: input } as unknown as Event);
    expect(state.value).toBe("10");
  });

  test("onNumberChange reads the control back without touching the platform's own event", async () => {
    const el = await field({ label: "Size", value: "1" });
    const input = control(el);
    input.value = "6";
    const event = new Event("change", { bubbles: true, cancelable: true });
    const reached: string[] = [];
    above(el).addEventListener("change", (e) => {
      reached.push((e.target as Element).localName);
    });
    Object.defineProperty(event, "currentTarget", { value: input });
    const state = { badInput: false, value: "1" };
    onNumberChange(state, event);
    expect(state.value).toBe("6");
    // Nothing was stopped and nothing was re-sent: the handler dispatches no event of its own, so
    // The ancestor hears exactly the one this test sends, from the control.
    input.dispatchEvent(event);
    expect(reached).toEqual(["input"]);
  });

  test("onNumberKeydown ignores every key it does not own", async () => {
    const el = await field({ label: "Size", step: "1", value: "5" });
    const input = control(el);
    const state = { badInput: false, value: "5" };
    for (const [name, shift] of [
      ["ArrowUp", false],
      ["ArrowDown", false],
      ["Enter", true],
      ["PageUp", true],
    ] as [string, boolean][]) {
      const event = key(name, shift);
      Object.defineProperty(event, "currentTarget", { value: input });
      onNumberKeydown(state, event);
      expect(event.defaultPrevented, name).toBe(false);
    }
    expect(state.value).toBe("5");
  });

  test("a control that refuses to step commits nothing", async () => {
    const el = await field({ label: "Size", step: "1", value: "5" });
    const input = control(el);
    input.stepUp = () => {
      throw new Error("InvalidStateError");
    };
    const heard = record(el);
    const state = { badInput: false, value: "5" };
    stepBy(state, { currentTarget: input } as unknown as Event, 1);
    expect(state.value).toBe("5");
    expect(heard.input).toEqual([]);
    expect(heard.change).toEqual([]);
  });

  test("an event from outside a field is a no-op rather than a throw", () => {
    const loose = document.createElement("div");
    const state = { badInput: false, value: "1" };
    stepBy(state, { currentTarget: loose } as unknown as Event, 1);
    onNumberChange(state, { currentTarget: loose } as unknown as Event);
    stepBy(state, { currentTarget: null } as unknown as Event, 1);
    expect(state.value).toBe("1");
  });
});
