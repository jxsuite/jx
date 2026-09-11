import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxColorField = HTMLElement & {
  value: string;
  format: string;
  alpha: boolean;
  hue: number;
  saturation: number;
  brightness: number;
  opacity: number;
  text: string;
  invalid: boolean;
  expanded: boolean;
  ink: string;
  solid: string;
  disabled: boolean;
  tabindex: string;
};

interface Dropper {
  EyeDropper?: unknown;
}

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as Dropper).EyeDropper;
});

async function field(attrs: Record<string, string> = {}): Promise<JxColorField> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-color-field") as JxColorField;
  el.setAttribute("label", "Background");
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  await tick();
  return el;
}

const part = (el: Element, name: string) => el.querySelector<HTMLElement>(`[part="${name}"]`)!;
/** The swatch button: the field's OWN `part="control"`, which the eyedropper's button also wears. */
const swatch = (el: Element) =>
  el.querySelector<HTMLButtonElement>(':scope > [part="row"] > [part="control"]')!;
const textInput = (el: Element) =>
  el.querySelector<HTMLInputElement>('jx-textfield input[part="input"]')!;
const above = (el: Element) => el.parentElement!;

/**
 * Stand a screen picker in for the engine's, answering with whatever `read` returns.
 *
 * A function rather than a class, and one rather than four: `new` on a function that returns an
 * object hands back that object, which is all `onEyeDropper` ever asks of the API.
 */
function stubDropper(read: () => Promise<{ sRGBHex: string }>): void {
  (globalThis as Dropper).EyeDropper = function EyeDropper() {
    return { open: read };
  };
}

/** What the ANCESTOR heard, as `target=value`. */
function record(el: HTMLElement): { input: string[]; change: string[] } {
  const heard = { change: [] as string[], input: [] as string[] };
  const seen = (event: Event) => {
    const t = event.target as JxColorField;
    return `${t.localName}=${t.value}`;
  };
  above(el).addEventListener("input", (e) => {
    heard.input.push(seen(e));
  });
  above(el).addEventListener("change", (e) => {
    heard.change.push(seen(e));
  });
  return heard;
}

/** Move an inner colour control and let it say so the way it does in a browser. */
function move(control: HTMLElement & Record<string, unknown>, prop: string, value: number): void {
  control[prop] = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("jx-color-field", () => {
  test("is a swatch, a text field and the two doors, each with a name of its own", async () => {
    stubDropper(() => Promise.resolve({ sRGBHex: "#000000" }));
    const el = await field({ value: "#3b82f6" });
    expect(swatch(el).getAttribute("aria-label")).toBe("Pick Background");
    expect(swatch(el).getAttribute("aria-haspopup")).toBe("dialog");
    expect(swatch(el).getAttribute("aria-expanded")).toBe("false");
    /* The panel's id is minted, so nothing a consumer writes has to be unique — and the button
       names the one it minted. */
    expect(swatch(el).getAttribute("aria-controls")).toBe(part(el, "picker").id);
    expect(part(el, "picker").id).toStartWith("jx-color-field-");
    expect(textInput(el).getAttribute("aria-label")).toBe("Background");
    expect(part(el, "system").getAttribute("aria-label")).toBe(
      "Choose Background in the system picker",
    );
    expect(el.querySelector('[part="dropper"]')).not.toBeNull();
  });

  test("takes the value apart into the picker's channels at mount", async () => {
    const el = await field({ value: "#3b82f6" });
    expect(Math.round(el.hue)).toBe(217);
    expect(Math.round(el.saturation)).toBe(76);
    expect(Math.round(el.brightness)).toBe(96);
    expect(el.text).toBe("#3b82f6");
    expect(el.solid).toBe("#3b82f6");
    /* SC 1.4.11 for the preview chip's own boundary, which is drawn on the colour it shows. A
       luminance threshold gets this one wrong: #3b82f6 sits at 0.236, well under a half, and the
       ink it actually needs is black. */
    expect(el.ink).toBe("black");
    expect(el.style.getPropertyValue("--jx-color-field-ink")).toBe("black");
    expect(el.style.getPropertyValue("--jx-color-field-preview")).toBe("#3b82f6");
  });

  test("a host write of value moves the whole picker, through data-value", async () => {
    const el = await field({ value: "#3b82f6" });
    el.value = "#f5d90a";
    await tick();
    expect(Math.round(el.hue)).toBe(53);
    expect(el.text).toBe("#f5d90a");
    expect(el.ink).toBe("black");
    const area = part(el, "area") as HTMLElement & { hue: number };
    expect(Math.round(area.hue)).toBe(53);
  });

  test("moving the square recomposes the value and says so once, from the element", async () => {
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    const area = part(el, "area") as HTMLElement & Record<string, unknown>;
    area["saturation"] = 100;
    area["brightness"] = 100;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("#0061ff");
    /* One event, and `e.target` is the FIELD: five controls' worth of events would otherwise
       leave a host reading a different node depending on which one the reader touched. */
    expect(heard.input).toEqual(["jx-color-field=#0061ff"]);
    expect(heard.change).toEqual([]);
    /* And the square's own input never leaks past the field. */
    expect(heard.input.length).toBe(1);
  });

  test("moving the hue track recomposes, and the square follows it", async () => {
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    move(part(el, "hue") as HTMLElement & Record<string, unknown>, "value", 120);
    expect(el.hue).toBe(120);
    expect(el.value).toBe("#3bf63b");
    expect(heard.change).toEqual(["jx-color-field=#3bf63b"]);
    expect((part(el, "area") as HTMLElement & { hue: number }).hue).toBe(120);
  });

  test("with alpha off there is no opacity track and every value is opaque", async () => {
    const el = await field({ value: "#3b82f680" });
    expect(el.querySelector('[part="opacity"]')).toBeNull();
    move(part(el, "hue") as HTMLElement & Record<string, unknown>, "value", 200);
    expect(el.value).toBe("#3bb8f6");
    expect(el.value.length).toBe(7);
  });

  test("with alpha on the opacity track is there and rides in the value", async () => {
    const el = await field({ alpha: "", value: "#3b82f680" });
    expect(Math.round(el.opacity)).toBe(50);
    const opacity = part(el, "opacity") as HTMLElement & Record<string, unknown>;
    /* The routing attribute is the kit's own, because jx-color-slider writes `data-channel` from
       its own `channel` prop and an element's root attributes win over the ones its instance is
       given: the track this field calls `opacity` calls itself `alpha`. */
    expect(opacity.dataset["channel"]).toBe("alpha");
    expect(opacity.dataset["jxChannel"]).toBe("opacity");
    move(opacity, "value", 100);
    expect(el.value).toBe("#3b82f6");
    move(opacity, "value", 20);
    expect(el.value).toBe("#3b82f633");
  });

  test("format decides what is written, never what may be read", async () => {
    const el = await field({ format: "oklch", value: "#ff0000" });
    move(part(el, "hue") as HTMLElement & Record<string, unknown>, "value", 29);
    expect(el.value).toStartWith("oklch(");
    /* And a reader may still type any of the three the module can read. */
    const input = textInput(el);
    input.value = "rgb(34 197 94)";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.invalid).toBe(false);
    expect(el.value).toStartWith("oklch(");
    expect(Math.round(el.hue)).toBe(142);
  });

  test("typing is not committing: a half-typed colour is neither taken nor refused", async () => {
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    const input = textInput(el);
    input.value = "#22c5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.text).toBe("#22c5");
    expect(el.value).toBe("#3b82f6");
    expect(el.invalid).toBe(false);
    /* Nothing leaves the element while the caret is mid-word. */
    expect(heard.input).toEqual([]);

    input.value = "#22c55e";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.value).toBe("#22c55e");
    expect(heard.change).toEqual(["jx-color-field=#22c55e"]);
  });

  test("a commit that is not a colour is refused and changes nothing", async () => {
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    const input = textInput(el);
    input.value = "rebeccapurple";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.invalid).toBe(true);
    expect(el.value).toBe("#3b82f6");
    expect(heard.change).toEqual([]);
    /* An emptied field is not a refusal. */
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.invalid).toBe(false);
  });

  test("the hue survives a colour going grey, which a round trip through the string would not", async () => {
    const el = await field({ value: "#3b82f6" });
    const before = el.hue;
    const area = part(el, "area") as HTMLElement & Record<string, unknown>;
    area["saturation"] = 0;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("#f6f6f6");
    expect(el.hue).toBe(before);
    expect((part(el, "hue") as HTMLElement & { value: number }).value).toBe(before);

    /* A colourless value arriving whole is the same question and needs the same answer: a typed
       grey, and a grey a host wrote, both leave the hue track where the reader put it. */
    const input = textInput(el);
    input.value = "#808080";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.value).toBe("#808080");
    expect(el.hue).toBe(before);

    el.value = "#000000";
    await tick();
    expect(el.brightness).toBe(0);
    expect(el.hue).toBe(before);
  });

  test("the system well is a door: what comes back is taken, and the alpha is kept", async () => {
    const el = await field({ alpha: "", value: "#3b82f680" });
    const heard = record(el);
    const well = part(el, "system") as HTMLInputElement;
    /* A native colour well is opaque by construction, so the reader's own alpha must survive it. */
    well.value = "#22c55e";
    well.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("#22c55e80");
    expect(heard.input).toEqual(["jx-color-field=#22c55e80"]);
  });

  test("a palette slotted into the picker is a second way to the same value", async () => {
    const outer = document.createElement("div");
    const el = document.createElement("jx-color-field") as JxColorField;
    el.setAttribute("label", "Background");
    el.setAttribute("value", "#3b82f6");
    const group = document.createElement("jx-swatch-group") as HTMLElement & { value: string };
    group.setAttribute("slot", "tokens");
    group.setAttribute("label", "Project palette");
    el.append(group);
    outer.append(el);
    document.body.append(outer);
    await tick();
    await tick();
    const heard = record(el);
    /* Slotted content lands inside [part="tokens"], which is what the field named a channel: the
       group is a consumer's element and the field may not write an attribute on it. */
    expect(group.closest('[part="tokens"]')).not.toBeNull();
    group.value = "#f5d90a";
    group.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.value).toBe("#f5d90a");
    expect(heard.change).toEqual(["jx-color-field=#f5d90a"]);

    group.value = "brand.warm";
    group.dispatchEvent(new Event("change", { bubbles: true }));
    /* A palette entry standing for a token the page has not resolved is not a colour here, so it
       is left alone rather than turned into black. */
    expect(el.value).toBe("#f5d90a");
    expect(heard.change.length).toBe(1);
  });

  test("the system well can be turned off, and so can the screen picker", async () => {
    stubDropper(() => Promise.resolve({ sRGBHex: "#000000" }));
    const el = await field({ eyedropper: "false", system: "false", value: "#3b82f6" });
    expect(el.querySelector('[part="system"]')).toBeNull();
    expect(el.querySelector('[part="dropper"]')).toBeNull();
  });

  test("no screen picker is offered on an engine that has none", async () => {
    const el = await field({ value: "#3b82f6" });
    /* A button that does nothing when pressed is worse than no button. */
    expect(el.querySelector('[part="dropper"]')).toBeNull();
  });

  test("the screen picker takes what it is handed, and a dismissal is not a failure", async () => {
    let answer: Promise<{ sRGBHex: string }> = Promise.resolve({ sRGBHex: "#22c55e" });
    stubDropper(() => answer);
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    part(el, "dropper").querySelector<HTMLElement>('[part="control"]')!.click();
    await tick();
    expect(el.value).toBe("#22c55e");
    expect(heard.input).toEqual(["jx-color-field=#22c55e"]);
    expect(heard.change).toEqual(["jx-color-field=#22c55e"]);

    answer = Promise.resolve({ sRGBHex: "not a colour" });
    part(el, "dropper").querySelector<HTMLElement>('[part="control"]')!.click();
    await tick();
    /* An engine that hands back something unreadable is not an occasion to write black. */
    expect(el.value).toBe("#22c55e");
    expect(heard.change.length).toBe(1);

    answer = Promise.reject(new Error("AbortError"));
    part(el, "dropper").querySelector<HTMLElement>('[part="control"]')!.click();
    await tick();
    /* The reader pressed Escape. The colour is left where it was and nothing is said. */
    expect(el.value).toBe("#22c55e");
    expect(heard.change.length).toBe(1);
  });

  test("the swatch opens the picker, positions it, and closes it again", async () => {
    const el = await field({ value: "#3b82f6" });
    const panel = part(el, "picker") as HTMLElement & { x: number; y: number };
    el.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 24,
        left: 12,
        right: 100,
        toJSON: () => ({}),
        top: 16,
        width: 88,
        x: 12,
        y: 16,
      }) as DOMRect;
    swatch(el).click();
    await tick();
    /* The coordinates are written BEFORE the panel is shown, which is what jx-popover asks of
       whoever opens it: its own toggle handler clamps a real position rather than the origin. */
    expect(panel.x).toBe(12);
    expect(panel.y).toBe(40);
    expect(el.expanded).toBe(true);
    expect(swatch(el).getAttribute("aria-expanded")).toBe("true");
    expect(el.dataset["expanded"]).toBe("");

    swatch(el).click();
    await tick();
    expect(el.expanded).toBe(false);
    expect(swatch(el).getAttribute("aria-expanded")).toBe("false");
  });

  test("disabled refuses every door", async () => {
    stubDropper(() => Promise.resolve({ sRGBHex: "#22c55e" }));
    const el = await field({ disabled: "", value: "#3b82f6" });
    /* The platform's own refusal first: a disabled button dispatches no click at all. */
    expect((swatch(el) as HTMLButtonElement).disabled).toBe(true);
    expect((part(el, "system") as HTMLInputElement).disabled).toBe(true);
    expect(part(el, "dropper").querySelector<HTMLButtonElement>('[part="control"]')!.disabled).toBe(
      true,
    );
    /* And the handlers refuse a click delivered anyway, because a pointer on a disabled control
       is not the only way one arrives: a host may dispatch one, and a picker opened from a field
       that cannot be edited is a picker whose every move is thrown away. */
    swatch(el).dispatchEvent(new Event("click", { bubbles: true }));
    await tick();
    expect(el.expanded).toBe(false);
    part(el, "dropper").dispatchEvent(new Event("click", { bubbles: true }));
    await tick();
    expect(el.value).toBe("#3b82f6");
  });

  test("tabindex lands on the swatch, parks the three controls beside it, and never reaches the host", async () => {
    /* The property a roving container writes (ui.md §5.1), and the colour family's answer to which
       of this element's four controls it lands on: the swatch, because it is the opener, so Enter
       from it reaches the whole picker; because it is the one control the element always draws;
       and because it is first in the row. In a FORM the prop is unset and every control keeps its
       own tab stop, each with a name of its own. Written, the text field, the eyedropper and the
       system door step out of the tab order — a container told this element is one stop must find
       exactly one — and clearing the prop hands each its own stop back. */
    stubDropper(() => Promise.resolve({ sRGBHex: "#000000" }));
    const el = await field({ value: "#3b82f6" });
    const dropper = () => part(el, "dropper").querySelector<HTMLElement>('[part="control"]')!;
    const parked = () =>
      [swatch(el), textInput(el), dropper(), part(el, "system")].map((node) =>
        node.getAttribute("tabindex"),
      );
    expect(parked()).toEqual([null, null, null, null]);
    el.tabindex = "-1";
    await tick();
    expect(parked()).toEqual(["-1", "-1", "-1", "-1"]);
    el.tabindex = "0";
    await tick();
    expect(parked()).toEqual(["0", "-1", "-1", "-1"]);
    /* A host carrying tabindex is itself focusable, so one control would become two tab stops. */
    expect(el.hasAttribute("tabindex")).toBe(false);
    el.tabindex = "";
    await tick();
    expect(parked()).toEqual([null, null, null, null]);
  });

  test("an unset field is the no-colour chip rather than black", async () => {
    const el = await field();
    expect(el.value).toBe("");
    expect(el.invalid).toBe(false);
    expect(el.style.getPropertyValue("--jx-color-field-preview")).toBe("transparent");
  });

  test("a value only the browser can resolve is kept and drawn, not refused", async () => {
    /* `var(--brand-accent)` is what a project's own palette actually puts in a style. The element
       cannot take it apart, which is not the same thing as the reader having typed nonsense. */
    const el = await field({ value: "var(--jx-accent-solid)" });
    expect(el.invalid).toBe(false);
    expect(el.value).toBe("var(--jx-accent-solid)");
    expect(el.text).toBe("var(--jx-accent-solid)");
    /* The chip still draws it, because its background is that string handed to CSS. */
    expect(el.style.getPropertyValue("--jx-color-field-preview")).toBe("var(--jx-accent-solid)");
  });

  test("a host write clears a refusal the reader earned", async () => {
    const el = await field({ value: "#3b82f6" });
    const input = textInput(el);
    input.value = "not a colour";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el.invalid).toBe(true);
    el.value = "var(--jx-accent-solid)";
    await tick();
    expect(el.invalid).toBe(false);
  });

  test("an event from something the field does not own passes through as itself", async () => {
    const el = await field({ value: "#3b82f6" });
    const heard = record(el);
    const stray = document.createElement("input");
    stray.value = "#22c55e";
    part(el, "row").append(stray);
    stray.dispatchEvent(new Event("input", { bubbles: true }));
    /* Not taken as a colour, and not re-said as the field's either: an element may re-say what it
       routes and nothing else, so `e.target` is still the control that fired. */
    expect(el.value).toBe("#3b82f6");
    expect(heard.input).toEqual(["input=#22c55e"]);

    /* And a channel the routing does not know is refused rather than guessed at. */
    const named = document.createElement("input");
    named.value = "#22c55e";
    named.dataset["jxChannel"] = "nonsense";
    part(el, "row").append(named);
    named.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("#3b82f6");
    expect(heard.input.length).toBe(1);
  });
});
