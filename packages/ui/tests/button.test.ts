import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

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
    // The click stops at the host, its default cancelled.
    let reached = 0;
    document.body.addEventListener("click", () => {
      reached += 1;
    });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(reached).toBe(0);
    el.loading = false;
    await tick();
    expect(el.querySelector('[part="spinner"]')!.hasAttribute("hidden")).toBe(true);
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    expect(reached).toBe(1);
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
});
