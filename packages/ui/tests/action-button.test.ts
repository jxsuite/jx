import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxActionButton = HTMLElement & {
  label: string;
  icon: string;
  toggles: boolean;
  selected: boolean;
  disabled: boolean;
  emphasized: boolean;
  quiet: boolean;
};

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function action(attrs: Record<string, string> = {}): Promise<JxActionButton> {
  const el = document.createElement("jx-action-button") as JxActionButton;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLButtonElement>('[part="control"]')!;

describe("jx-action-button", () => {
  test("is a named, icon-first native button, quiet by default", async () => {
    const el = await action({ icon: "plus", label: "Add" });
    const inner = control(el);
    expect(inner.getAttribute("aria-label")).toBe("Add");
    expect(inner.getAttribute("title")).toBe("Add");
    expect(inner.getAttribute("type")).toBe("button");
    expect(inner.hasAttribute("aria-pressed")).toBe(false);
    expect(el.dataset.quiet !== undefined).toBe(true);
    const icon = el.querySelector<HTMLElement & { name: string }>('[part="icon"] jx-icon')!;
    expect(icon.name).toBe("plus");
    expect(el.querySelector('[part="icon"]')!.hasAttribute("hidden")).toBe(false);
  });

  test("a text-only action button hides its icon part and warns about nothing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => null);
    try {
      const el = await action({ label: "Save" });
      expect(el.querySelector('[part="icon"]')!.hasAttribute("hidden")).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("a toggling button carries aria-pressed, flips on activation and says so", async () => {
    const el = await action({ icon: "text-b", label: "Bold", toggles: "" });
    const inner = control(el);
    expect(inner.getAttribute("aria-pressed")).toBe("false");
    expect(el.dataset.selected !== undefined).toBe(false);
    const changes: unknown[] = [];
    el.addEventListener("change", (e) => {
      changes.push((e as CustomEvent).detail);
    });
    inner.click();
    await tick();
    expect(el.selected).toBe(true);
    expect(inner.getAttribute("aria-pressed")).toBe("true");
    expect(el.dataset.selected !== undefined).toBe(true);
    inner.click();
    await tick();
    expect(el.selected).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test("a host may hold the state: setting selected wins, and a plain button never toggles", async () => {
    const el = await action({ icon: "eye", label: "Show", toggles: "" });
    el.selected = true;
    await tick();
    expect(control(el).getAttribute("aria-pressed")).toBe("true");
    const plain = await action({ icon: "eye", label: "Look" });
    control(plain).click();
    await tick();
    expect(plain.selected).toBe(false);
    expect(control(plain).hasAttribute("aria-pressed")).toBe(false);
  });

  test("disabled disables the control and stops a toggle", async () => {
    const el = await action({ disabled: "", icon: "eye", label: "Show", toggles: "" });
    expect(control(el).disabled).toBe(true);
    el.disabled = false;
    await tick();
    el.disabled = true;
    await tick();
    // A programmatic click on a disabled button never fires in a browser; the handler's own
    // Guard covers a host that dispatches one.
    control(el).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(el.selected).toBe(false);
  });

  test("emphasized and quiet are the host's data attributes; the invoker attributes forward", async () => {
    const el = await action({
      command: "toggle-popover",
      commandfor: "menu",
      emphasized: "",
      icon: "gear",
      label: "Settings",
      quiet: "false",
      selected: "",
      toggles: "",
    });
    expect(el.dataset.emphasized !== undefined).toBe(true);
    expect(el.dataset.selected !== undefined).toBe(true);
    expect(el.dataset.quiet !== undefined).toBe(false);
    expect(control(el).getAttribute("command")).toBe("toggle-popover");
    expect(control(el).getAttribute("commandfor")).toBe("menu");
  });

  test("stacked puts the icon above a visible label; haspopup and expanded reach the control", async () => {
    const el = await action({
      expanded: "",
      haspopup: "menu",
      icon: "gear",
      label: "Settings",
      stacked: "",
    });
    expect(el.dataset.stacked !== undefined).toBe(true);
    const inner = control(el);
    expect(inner.getAttribute("aria-haspopup")).toBe("menu");
    expect(inner.getAttribute("aria-expanded")).toBe("true");
    const plain = await action({ icon: "gear", label: "Settings" });
    expect(control(plain).hasAttribute("aria-haspopup")).toBe(false);
    expect(control(plain).hasAttribute("aria-expanded")).toBe(false);
  });

  test("hint is the tooltip when it says more than the name; mirror flips the glyph", async () => {
    const el = await action({ label: "Toggle Inspector Dock", icon: "sidebar-simple" });
    expect(control(el).title).toBe("Toggle Inspector Dock");
    el.setAttribute("hint", "Toggle Inspector Dock (⌘I)");
    el.setAttribute("mirror", "");
    await tick();
    // The name stays the name; only the tooltip carries the chord.
    expect(control(el).getAttribute("aria-label")).toBe("Toggle Inspector Dock");
    expect(control(el).title).toBe("Toggle Inspector Dock (⌘I)");
    const icon = el.querySelector("jx-icon") as (HTMLElement & { mirror: boolean }) | null;
    expect(icon?.mirror).toBe(true);
    el.setAttribute("hint", "");
    await tick();
    expect(control(el).title).toBe("Toggle Inspector Dock");
  });

  test("a badge is drawn only while it has something to say", async () => {
    const el = (await action({ icon: "git-branch", label: "Source Control" })) as JxActionButton & {
      badge: string;
    };
    expect(el.querySelector('[part="badge"]')).toBeNull();
    el.badge = "3";
    await tick();
    expect(el.querySelector('[part="badge"]')!.textContent).toBe("3");
    el.badge = "";
    await tick();
    expect(el.querySelector('[part="badge"]')).toBeNull();
  });
});
