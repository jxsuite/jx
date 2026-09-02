import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxButton = HTMLElement & {
  variant: string;
  size: string;
  quiet: boolean;
  disabled: boolean;
  loading: boolean;
  label: string;
  command: string;
  commandfor: string;
  popovertarget: string;
};

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function button(attrs: Record<string, string> = {}, text = "Save"): Promise<JxButton> {
  const el = document.createElement("jx-button") as JxButton;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  el.append(text);
  document.body.append(el);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLButtonElement>('[part="control"]')!;

describe("jx-button", () => {
  test("wraps one native button that carries the type, the text and the variant", async () => {
    const el = await button();
    const inner = control(el);
    expect(inner.tagName).toBe("BUTTON");
    expect(inner.getAttribute("type")).toBe("button");
    expect(inner.textContent!.trim()).toBe("Save");
    expect(el.dataset.variant).toBe("secondary");
    expect(el.dataset.size).toBe("md");
    expect(el.dataset.quiet !== undefined).toBe(false);
    expect(inner.hasAttribute("aria-label")).toBe(false);
    expect(inner.hasAttribute("popovertarget")).toBe(false);
    expect(inner.hasAttribute("command")).toBe(false);
  });

  test("variant, size and quiet are the host's data attributes, for the sheet to read", async () => {
    const el = await button({ quiet: "", size: "sm", variant: "accent" });
    expect(el.dataset.variant).toBe("accent");
    expect(el.dataset.size).toBe("sm");
    expect(el.dataset.quiet !== undefined).toBe(true);
    el.quiet = false;
    await tick();
    expect(el.dataset.quiet !== undefined).toBe(false);
  });

  test("the accessible name and descriptions are forwarded to the control", async () => {
    const el = await button({ describedby: "hint", label: "Save the page", labelledby: "t" }, "");
    const inner = control(el);
    expect(inner.getAttribute("aria-label")).toBe("Save the page");
    expect(inner.getAttribute("aria-labelledby")).toBe("t");
    expect(inner.getAttribute("aria-describedby")).toBe("hint");
  });

  test("the invoker attributes are forwarded to the control, where the platform reads them", async () => {
    const el = await button({
      command: "show-modal",
      commandfor: "confirm",
      popovertarget: "menu",
      popovertargetaction: "show",
    });
    const inner = control(el);
    expect(inner.getAttribute("popovertarget")).toBe("menu");
    expect(inner.getAttribute("popovertargetaction")).toBe("show");
    expect(inner.getAttribute("command")).toBe("show-modal");
    expect(inner.getAttribute("commandfor")).toBe("confirm");
    el.popovertarget = "";
    await tick();
    expect(inner.hasAttribute("popovertarget")).toBe(false);
  });

  test("disabled disables the control; loading keeps it, blocks activation and says aria-busy", async () => {
    const el = await button({ disabled: "" });
    expect(control(el).disabled).toBe(true);
    el.disabled = false;
    el.loading = true;
    await tick();
    const inner = control(el);
    expect(inner.disabled).toBe(false);
    expect(inner.getAttribute("aria-busy")).toBe("true");
    expect(inner.getAttribute("aria-disabled")).toBe("true");
    expect(el.dataset.loading !== undefined).toBe(true);
    expect(el.querySelector('[part="spinner"]')!.hasAttribute("hidden")).toBe(false);
    /* The click stops BELOW the host, its default cancelled. Measuring it at an ancestor is the
       one path that would pass even if it did not: `stopPropagation` on the host halts the event
       at the host and after, not the other listeners on that same node — and a listener on the
       element is exactly how the handler's own description says a consumer takes the click. */
    let onHost = 0;
    let onAncestor = 0;
    el.addEventListener("click", () => {
      onHost += 1;
    });
    document.body.addEventListener("click", () => {
      onAncestor += 1;
    });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onHost).toBe(0);
    expect(onAncestor).toBe(0);
    // Busy is also SEEN, not only announced: the pointer says the button is working.
    expect(getComputedStyle(inner).cursor).toBe("progress");
    el.loading = false;
    await tick();
    expect(el.querySelector('[part="spinner"]')!.hasAttribute("hidden")).toBe(true);
    expect(getComputedStyle(inner).cursor).toBe("pointer");
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    expect(onHost).toBe(1);
    expect(onAncestor).toBe(1);
  });

  test("a click dispatched AT the host is swallowed too, where no inner control sees it", async () => {
    /* The control-level swallow cannot see this one, so the host keeps a guard of its own. A host
       calling `el.click()` to re-run the action is the case. */
    const el = await button({ loading: "" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    el.loading = false;
    await tick();
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  test("an icon slots before the label", async () => {
    const el = document.createElement("jx-button") as JxButton;
    const icon = document.createElement("jx-icon");
    icon.setAttribute("slot", "icon");
    icon.setAttribute("name", "plus");
    el.append(icon, "Add");
    document.body.append(el);
    await tick();
    expect(el.querySelector('[part="icon"] jx-icon')).toBe(icon);
    expect(el.querySelector('[part="label"]')!.textContent!.trim()).toBe("Add");
  });

  test("the loading spinner is a jx-spinner, and it actually turns", async () => {
    /* A kit element styles through `part` and cannot wear a class on an internal node, so
       `[part="spinner"]` could never reach a `.jx-spinner` rule in the theme sheet — which is why
       the shipped loading spinner was a STATIONARY glyph: jx-button's style has no `animation`
       declaration anywhere in it, then or now. Adopting the element is what makes it move. */
    const el = await button({ loading: "" });
    const spinner = el.querySelector('[part="spinner"]')!;
    expect(spinner.tagName).toBe("JX-SPINNER");
    expect(spinner.getAttribute("role")).toBe("progressbar");
    expect(spinner.getAttribute("aria-hidden")).toBe("true");

    const style = JSON.stringify(documents["jx-button"]!.style);
    expect(style).not.toContain("animation");

    const handle = `[data-jx="${(spinner as HTMLElement).dataset["jx"] ?? ""}"]`;
    const rule = documentStyleText()
      .split("\n")
      .find((line) => line.startsWith(`${handle} [part="glyph"] {`));
    expect(rule).toContain("animation: jx-spin var(--jx-spin-dur) linear infinite");
    expect(documentStyleText()).toContain("@keyframes jx-spin");
  });

  test("the spinner is visible ON an accent button, because it draws in the button's text", async () => {
    /* The glyph used to declare `color: var(--jx-accent)`, which is the accent variant's own fill:
       measured in Chrome 152 the control background and the glyph were both `rgb(37, 99, 235)`, so
       the primary case `loading` exists for showed an empty gap. A declaration on the glyph always
       beats a colour inherited from the control, so `color: inherit` on `[part="spinner"]` could
       not save it — the spinner's own paint had to become `currentColor`. */
    const el = await button({ loading: "", variant: "accent" });
    const style = documents["jx-button"]!.style as Record<string, Record<string, string>>;
    const accent = style['&[data-variant="accent"] > [part="control"]']!;
    expect(accent["background"]).toBe("var(--jx-accent-solid)");
    expect(accent["color"]).toBe("var(--jx-accent-fg)");
    // The spinner takes THAT, rather than naming a colour of its own.
    const spinnerGlyph = el.querySelector<HTMLElement>('[part="spinner"] [part="glyph"]')!;
    expect(getComputedStyle(spinnerGlyph).color).toBe("currentcolor");
    expect(JSON.stringify(documents["jx-spinner"]!.style)).not.toContain("--jx-accent");
  });

  test("jx-spinner is registered before jx-button, because jx-button renders one", async () => {
    /* `defineElement` is awaited per document, and an element registered before a dependency it
       renders gets an HTMLUnknownElement child instead. */
    const order = Object.keys(documents);
    expect(order.indexOf("jx-spinner")).toBeLessThan(order.indexOf("jx-button"));
    expect(JSON.stringify(documents["jx-button"]!.$elements)).toContain("./jx-spinner.json");
    const el = await button({ loading: "" });
    expect(el.querySelector('[part="spinner"]')!.querySelector('[part="glyph"]')).not.toBeNull();
  });
});
