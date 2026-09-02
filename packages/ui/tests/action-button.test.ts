import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { documents } from "../src/documents.ts";
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
    // The name is not AUTOMATICALLY the tooltip. It may still be the right tooltip — see the
    // Hint test below — but that is now a decision at the call site rather than every button's
    // Default, including the ones whose text is already fully on screen.
    expect(inner.hasAttribute("title")).toBe(false);
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

  test("the tooltip is the hint ALONE, and absent when there is no hint; mirror flips the glyph", async () => {
    /* `title` used to fall back to `label`, so EVERY button got a tooltip whether or not its name
       was already visible. The name is `aria-label`; the tooltip is `hint` and nothing else. That
       does not make `hint === label` wrong — on an icon-only button, or one whose visible label
       ellipses, a tooltip carrying the name is the standard affordance and Studio passes exactly
       that. What the removal bought is that each call site now decides. */
    const el = await action({ label: "Toggle Inspector Dock", icon: "sidebar-simple" });
    expect(control(el).hasAttribute("title")).toBe(false);
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
    expect(control(el).hasAttribute("title")).toBe(false);
  });

  test("describedby and labelledby reach the inner control, which is where a name is read", async () => {
    /* An action button is icon-only, so a tooltip named onto it from the outside — a jx-tooltip's
       id — has nowhere to land without these. */
    const el = await action({ describedby: "tip1", icon: "gear", label: "Settings" });
    const inner = control(el);
    expect(inner.getAttribute("aria-describedby")).toBe("tip1");
    expect(inner.hasAttribute("aria-labelledby")).toBe(false);
    el.setAttribute("labelledby", "heading");
    await tick();
    expect(inner.getAttribute("aria-labelledby")).toBe("heading");
    el.setAttribute("describedby", "");
    await tick();
    expect(inner.hasAttribute("aria-describedby")).toBe(false);
  });

  test("loading swaps the glyph for a spinner, says aria-busy and swallows the click", async () => {
    /* An action button draws its icon from a manifest name and has no icon slot, so a host cannot
       put a progress ring where the glyph was — which is what blocked the Refresh affordance
       outright rather than degrading it. */
    const el = (await action({ icon: "arrows-clockwise", label: "Refresh" })) as JxActionButton & {
      loading: boolean;
    };
    const inner = control(el);
    expect(el.querySelector('[part="spinner"]')!.hasAttribute("hidden")).toBe(true);
    expect(el.querySelector('[part="icon"]')!.hasAttribute("hidden")).toBe(false);
    expect(inner.hasAttribute("aria-busy")).toBe(false);

    el.loading = true;
    await tick();
    const spinner = el.querySelector('[part="spinner"]')!;
    expect(spinner.tagName).toBe("JX-SPINNER");
    expect(spinner.hasAttribute("hidden")).toBe(false);
    expect(spinner.getAttribute("role")).toBe("progressbar");
    expect(el.querySelector('[part="icon"]')!.hasAttribute("hidden")).toBe(true);
    expect(inner.getAttribute("aria-busy")).toBe("true");
    expect(inner.getAttribute("aria-disabled")).toBe("true");
    expect(inner.disabled).toBe(false);

    // Busy is SEEN as well as announced, which is the affordance jx-button already had.
    expect(getComputedStyle(inner).cursor).toBe("progress");

    /* Measuring the swallow at an ancestor is the one path that passes even when it fails:
       `stopPropagation` called on the host halts the event at the host and every node after it,
       NOT the other listeners on that same node — and the handler's own description says a plain
       button "leaves the click to the host, which listens for it on the element", so a listener
       there is the documented consumer path and the one that has to see nothing. */
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
    await tick();
    expect(click.defaultPrevented).toBe(true);
    expect(onHost).toBe(0);
    expect(onAncestor).toBe(0);

    el.loading = false;
    await tick();
    expect(el.querySelector('[part="icon"]')!.hasAttribute("hidden")).toBe(false);
    expect(el.querySelector('[part="spinner"]')!.hasAttribute("hidden")).toBe(true);
    expect(getComputedStyle(inner).cursor).toBe("pointer");
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
    expect(onHost).toBe(1);
    expect(onAncestor).toBe(1);
  });

  test("a click dispatched AT the host is swallowed too, where no inner control sees it", async () => {
    /* The control-level swallow never runs for this one, so the host keeps a guard of its own —
       and a toggling button must not flip on it either. */
    const el = (await action({
      icon: "eye",
      label: "Show",
      loading: "",
      toggles: "",
    })) as JxActionButton & { loading: boolean };
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(click);
    await tick();
    expect(click.defaultPrevented).toBe(true);
    expect(el.selected).toBe(false);
    el.loading = false;
    await tick();
    const again = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(again);
    await tick();
    expect(again.defaultPrevented).toBe(false);
    expect(el.selected).toBe(true);
  });

  test("a loading toggle does not flip: the activation was swallowed, not queued", async () => {
    const el = (await action({
      icon: "eye",
      label: "Show",
      loading: "",
      toggles: "",
    })) as JxActionButton & { loading: boolean };
    const changes: unknown[] = [];
    el.addEventListener("change", () => {
      changes.push(1);
    });
    control(el).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();
    expect(el.selected).toBe(false);
    expect(changes).toEqual([]);
    el.loading = false;
    await tick();
    control(el).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();
    expect(el.selected).toBe(true);
    expect(changes).toHaveLength(1);
  });

  test("the prop descriptions say the tooltip is a decision, not the name repeated", async () => {
    /* The `title`-falls-back-to-`label` removal is a DECISION with two halves, and the next reader
       will re-derive it as a defect unless both are written down where the props are. */
    const state = documents["jx-action-button"]!.state as Record<string, { description?: string }>;
    expect(state["label"]!.description).toContain("It is NOT also the tooltip");
    // The half that says `hint === label` is often the RIGHT answer, not a double-naming bug.
    expect(state["hint"]!.description).toContain("icon-only");
    expect(state["hint"]!.description).toContain("hint equal to label is the right answer");
    // And the half that says why it is no longer automatic.
    expect(state["hint"]!.description).toContain("already fully visible");
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
