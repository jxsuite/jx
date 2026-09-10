import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSwatch = HTMLElement & {
  color: string;
  value: string;
  label: string;
  checked: string;
  selected: boolean;
  disabled: boolean;
  tabindex: string;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

async function swatch(attrs: Record<string, string> = {}): Promise<JxSwatch> {
  const outer = document.createElement("div");
  const el = document.createElement("jx-swatch") as JxSwatch;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  outer.append(el);
  document.body.append(outer);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLButtonElement>('button[part="control"]')!;
const mark = (el: Element) => el.querySelector('[part="mark"]');

describe("jx-swatch", () => {
  test("is a real button whose name is its label, not its colour", async () => {
    const el = await swatch({ color: "#3b82f6", label: "Blue" });
    const button = control(el);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Blue");
  });

  test("falls back through value and colour, and never ends up nameless", async () => {
    /* A hex read one character at a time is a name a reader cannot use, so it is the LAST
       fallback rather than the first, and there is always one after it. */
    const named = await swatch({ color: "#3b82f6", value: "brand.cool" });
    expect(control(named).getAttribute("aria-label")).toBe("brand.cool");
    const bare = await swatch({ color: "#3b82f6" });
    expect(control(bare).getAttribute("aria-label")).toBe("#3b82f6");
    const nothing = await swatch();
    expect(control(nothing).getAttribute("aria-label")).toBe("Colour");
  });

  test("works out its own ink from its own colour, with no host and no group", async () => {
    /* SC 1.4.11: a neutral boundary disappears against a neutral swatch, so the chip's ring and
       its tick are drawn in whichever of black and white can be seen on the colour. */
    const lemon = await swatch({ color: "#f5d90a" });
    expect(lemon.style.getPropertyValue("--jx-swatch-ink")).toBe("black");
    const ink = await swatch({ color: "#1d4ed8" });
    expect(ink.style.getPropertyValue("--jx-swatch-ink")).toBe("white");
    /* A colour only the browser can resolve falls back to the kit's border token rather than
       guessing at black. */
    const token = await swatch({ color: "var(--jx-accent-solid)" });
    expect(token.style.getPropertyValue("--jx-swatch-ink")).toBe("var(--jx-border-strong)");
  });

  test("the chip draws the colour, and an unset one is the slashed no-colour chip", async () => {
    const blue = await swatch({ color: "#3b82f6" });
    expect(blue.style.getPropertyValue("--jx-swatch-color")).toBe("#3b82f6");
    expect(blue.matches("[data-empty]")).toBe(false);
    const none = await swatch({ label: "No colour" });
    /* A blank square in a palette reads as a white swatch, and picking it would be picking white. */
    expect(none.dataset["empty"]).toBe("");
    expect(none.style.getPropertyValue("--jx-swatch-color")).toBe("transparent");
  });

  test("checked makes it a radio, and puts role=none on the host so the group owns it", async () => {
    const el = await swatch({ checked: "true", color: "#22c55e", label: "Green" });
    expect(el.getAttribute("role")).toBe("none");
    expect(control(el).getAttribute("role")).toBe("radio");
    expect(control(el).getAttribute("aria-checked")).toBe("true");
    expect(el.dataset["chosen"]).toBe("");
    expect(mark(el)).not.toBeNull();

    el.checked = "false";
    await tick();
    expect(control(el).getAttribute("aria-checked")).toBe("false");
    expect(el.matches("[data-chosen]")).toBe(false);
    expect(mark(el)).toBeNull();
  });

  test("a plain swatch announces no state at all", async () => {
    const el = await swatch({ color: "#22c55e", label: "Green" });
    expect(el.hasAttribute("role")).toBe(false);
    expect(control(el).hasAttribute("role")).toBe(false);
    expect(control(el).hasAttribute("aria-checked")).toBe(false);
  });

  test("selected is the drawing alone, and never the announcement", async () => {
    const el = await swatch({ color: "#22c55e", label: "Green", selected: "" });
    expect(el.dataset["chosen"]).toBe("");
    expect(mark(el)).not.toBeNull();
    /* A host that owns the selection outside a radio group draws the ring; a reader is TOLD by
       `checked`, and setting one never sets the other. */
    expect(control(el).hasAttribute("aria-checked")).toBe(false);
  });

  test("activation says what it stands for, and writes nothing of its own", async () => {
    const el = await swatch({ color: "#3b82f6", value: "brand.cool" });
    const heard: unknown[] = [];
    el.parentElement!.addEventListener("select", (e) => {
      heard.push((e as CustomEvent<unknown>).detail);
    });
    control(el).click();
    expect(heard).toEqual(["brand.cool"]);
    /* Inside a group the group owns `checked`, outside one the host does, and an element that
       chose itself would disagree with both. */
    expect(el.checked).toBe("");
    expect(el.matches("[data-chosen]")).toBe(false);
  });

  test("a swatch with no value stands for its colour", async () => {
    const el = await swatch({ color: "#3b82f6" });
    const heard: unknown[] = [];
    el.parentElement!.addEventListener("select", (e) => {
      heard.push((e as CustomEvent<unknown>).detail);
    });
    control(el).click();
    expect(heard).toEqual(["#3b82f6"]);
  });

  test("disabled cannot be pressed", async () => {
    const el = await swatch({ color: "#3b82f6", disabled: "", label: "Blue" });
    expect(control(el).disabled).toBe(true);
    expect(el.dataset["disabled"]).toBe("");
  });

  test("tabindex is forwarded to the control and never lands on the host", async () => {
    const el = await swatch({ color: "#3b82f6", label: "Blue" });
    expect(control(el).hasAttribute("tabindex")).toBe(false);
    el.tabindex = "-1";
    await tick();
    expect(control(el).getAttribute("tabindex")).toBe("-1");
    /* A host carrying tabindex is itself focusable, so one control would become two tab stops. */
    expect(el.hasAttribute("tabindex")).toBe(false);
  });
});
