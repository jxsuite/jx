import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildStyleRules } from "@jxsuite/runtime/css";
import type { JxDocument, JxElement, JxStyle } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import { themeCSS } from "../src/theme.ts";

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
  tabindex: string;
  checked: string;
  badge: string;
};

/** Every rule the element's own style block emits, under a stand-in scope handle. */
const sheet = (): string[] =>
  buildStyleRules(documents["jx-action-button"]!.style as JxStyle, { scope: "S" }).map(
    (rule) => rule.text,
  );

/** The `.jx-badge` recipe ALONE — up to its own closing brace, never the rest of the sheet. */
const badgeRecipe = (): string => {
  const css = themeCSS();
  const start = css.indexOf(".jx-badge {");
  expect(start, "the theme sheet declares a .jx-badge recipe").toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start) + 1);
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

/** The stylebook page for this element, read off disk the way the conformance suite reads them. */
const stylebookPage = (): JxDocument =>
  JSON.parse(
    readFileSync(resolve(import.meta.dir, "../stylebook/jx-action-button.json"), "utf8"),
  ) as JxDocument;

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

  test("the selection props describe the selection the element actually has", async () => {
    /* `selected` used to read "the pressed state of a TOGGLING button", which is the contract the
       host-owned pressed state overturned — a porter reading it would conclude that host-owned
       selection needs `toggles`, which is exactly the mistake that costs a `change` the call site
       cannot absorb. And `checked` has to say which way the refusal goes, since a document setting
       both gets one answer rather than an error. */
    const state = documents["jx-action-button"]!.state as Record<string, { description?: string }>;
    expect(state["selected"]!.description).toContain("whoever wrote it");
    expect(state["selected"]!.description).not.toContain("The pressed state of a toggling button");
    expect(state["checked"]!.description).toContain("checked wins");
    expect(state["checked"]!.description).toContain("role=none");
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

  test("the roving caret writes a tabindex on the CONTROL, which is the focusable node", async () => {
    /* A group moving focus has to write a tabindex somewhere, and the host is not it: the host is
       an undefined-role wrapper and the thing a browser focuses is the `<button>` inside. Without
       this prop the only way to move the caret would be for the group's sidecar to reach into a
       child's internals, which is the foreign write §2 principle 5 forbids. */
    const el = await action({ icon: "text-b", label: "Bold" });
    const inner = control(el);
    expect(inner.hasAttribute("tabindex")).toBe(false);
    el.tabindex = "0";
    await tick();
    expect(inner.getAttribute("tabindex")).toBe("0");
    // The prop is the door; a property write leaves the HOST alone, so one control is one tab stop.
    expect(el.hasAttribute("tabindex")).toBe(false);
    el.tabindex = "-1";
    await tick();
    expect(inner.getAttribute("tabindex")).toBe("-1");
    el.tabindex = "";
    await tick();
    expect(inner.hasAttribute("tabindex")).toBe(false);
  });

  test("tabindex is a property and NOT an observed attribute, because the attribute is harmful", async () => {
    /* Every other prop here is spelled both ways, so a consumer reaches for the attribute first —
       and that one lands on the HOST as well, which is then focusable itself. Measured in Chrome
       152 while `tabindex` was observed: `<jx-action-button tabindex="0">` gave the host
       `tabIndex === 0` AND the control `tabindex="0"`, so the strip's tab stops read
       `[BUTTON, BUTTON, BUTTON, JX-ACTION-BUTTON, BUTTON]` — the roving caret's one tab stop
       became two on the segment holding it. Not advertising the attribute is what removes the
       trap: writing it now means what the platform means and nothing reaches the control. */
    const doc = documents["jx-action-button"]!;
    expect(doc.observedAttributes).not.toContain("tabindex");
    const state = doc.state as Record<string, { attribute?: string; description?: string }>;
    expect(state["tabindex"]!.attribute).toBeUndefined();
    expect(state["tabindex"]!.description).toContain("PROPERTY ONLY");
    const el = await action({ icon: "text-b", label: "Bold", tabindex: "0" });
    expect(control(el).hasAttribute("tabindex")).toBe(false);
    // And the property still works on the same element, which is what the group writes.
    el.tabindex = "0";
    await tick();
    expect(control(el).getAttribute("tabindex")).toBe("0");
  });

  test("checked makes one segment a radio, on the control and nowhere else", async () => {
    /* A radiogroup owns `radio` children. Reaching into a child from the group's sidecar to stamp
       the role there is the write principle 5 forbids, so the child declares it about itself. */
    const el = await action({ checked: "true", icon: "align-left", label: "Left" });
    const inner = control(el);
    expect(inner.getAttribute("role")).toBe("radio");
    expect(inner.getAttribute("aria-checked")).toBe("true");
    /* And the HOST steps out of the tree. `radiogroup`'s required owned element is `radio`, and the
       role is on the inner button, so an un-roled host between the two makes every segment a
       GRANDCHILD behind a generic — the same shape this kit forbids between a tablist and its tabs.
       `role="none"` promotes the radio to the radiogroup's own child: measured in Chrome 152 with
       `Accessibility.getFullAXTree`, the stylebook's five segments report `parentRole=radiogroup`,
       matching a control group of native `role="radio"` buttons, where before they read `generic`. */
    expect(el.getAttribute("role")).toBe("none");
    el.checked = "false";
    await tick();
    expect(inner.getAttribute("aria-checked")).toBe("false");
    expect(inner.getAttribute("role")).toBe("radio");
    el.checked = "";
    await tick();
    expect(inner.hasAttribute("role")).toBe(false);
    expect(inner.hasAttribute("aria-checked")).toBe(false);
    // A plain button is a plain button: nothing to promote, so the host keeps its own identity.
    expect(el.hasAttribute("role")).toBe(false);
  });

  test("a checked segment is DRAWN checked, with nothing else written", async () => {
    /* The two halves used to disagree: `checked` announced the choice and `selected` drew it, and
       nothing coupled them — so a radiogroup segment written the natural way (`checked` alone) was
       announced selected and painted like its unselected siblings. Measured in Chrome 152 before
       this: `aria-checked="true"` with `background-color: rgba(0, 0, 0, 0)`, pixel-identical to the
       `checked="false"` segments. Both stylebook pages worked around it by writing the state twice. */
    const el = await action({ checked: "true", icon: "align-left", label: "Left" });
    expect(el.dataset.selected !== undefined).toBe(true);
    expect(el.selected).toBe(false);
    el.checked = "false";
    await tick();
    expect(el.dataset.selected !== undefined).toBe(false);
    // `selected` still stands on its own, for a group whose segments are not radios.
    el.selected = true;
    await tick();
    expect(el.dataset.selected !== undefined).toBe(true);
  });

  test("checked REFUSES toggles rather than announcing both", async () => {
    /* `aria-pressed` is not a state of `role="radio"`, so a button that is both would tell a screen
       reader two things at once — measured in Chrome 152 before this fix, one control carried
       `role="radio" aria-checked="true" aria-pressed="true"` together. The prop description says
       the two are alternatives; this is what makes that true rather than advisory. checked wins:
       no `aria-pressed`, and no self-flip either, since a radio in a group whose host owns the
       selection must not answer the host's own click with a second, disagreeing `change`. */
    const el = await action({ checked: "true", icon: "text-b", label: "Bold", toggles: "" });
    const inner = control(el);
    expect(inner.getAttribute("role")).toBe("radio");
    expect(inner.getAttribute("aria-checked")).toBe("true");
    expect(inner.hasAttribute("aria-pressed")).toBe(false);
    const changes: unknown[] = [];
    el.addEventListener("change", () => {
      changes.push(1);
    });
    inner.click();
    await tick();
    expect(el.selected).toBe(false);
    expect(changes).toEqual([]);
    // Clear `checked` and the same button is a toggle again, aria-pressed and all.
    el.checked = "";
    await tick();
    expect(inner.getAttribute("aria-pressed")).toBe("false");
    inner.click();
    await tick();
    expect(el.selected).toBe(true);
    expect(changes).toEqual([1]);
  });

  test("a host may own the pressed state without the button flipping itself", async () => {
    /* `data-selected` used to be gated on `toggles`, so a segment whose host owns the selection —
       clicking the selected one CLEARS the property, and a body-mode switch REPLACES a function
       body — rendered unstyled and unannounced. Turning `toggles` on to get the styling made the
       button flip itself and emit `change` on top of the host's own click, which is the answer
       neither call site can take. The visual now follows `selected` whoever wrote it; only the
       FLIP is still gated. */
    const el = await action({ icon: "align-left", label: "Left", selected: "" });
    expect(el.dataset.selected !== undefined).toBe(true);
    expect(control(el).hasAttribute("aria-pressed")).toBe(false);
    const changes: unknown[] = [];
    el.addEventListener("change", () => {
      changes.push(1);
    });
    control(el).click();
    await tick();
    // The host writes the selection; the button neither flips nor announces one.
    expect(el.selected).toBe(true);
    expect(el.dataset.selected !== undefined).toBe(true);
    expect(changes).toEqual([]);
    // And in a radiogroup that same host-owned segment IS announced, through `checked`.
    el.checked = "true";
    await tick();
    expect(control(el).getAttribute("aria-checked")).toBe("true");
    expect(el.dataset.selected !== undefined).toBe(true);
  });

  test("toggles still owns the flip, once per activation", async () => {
    const el = await action({ icon: "text-b", label: "Bold", toggles: "" });
    const changes: unknown[] = [];
    el.addEventListener("change", (e) => {
      changes.push((e as CustomEvent).detail);
    });
    control(el).click();
    await tick();
    expect(el.selected).toBe(true);
    expect(el.dataset.selected !== undefined).toBe(true);
    expect(control(el).getAttribute("aria-pressed")).toBe("true");
    expect(changes).toEqual([true]);
  });

  test("an icon-only button generates no label box and no badge box, whitespace or not", async () => {
    /* No `:empty` rule can decide this, and neither can a `:has(:empty)` one. The same button
       written across two lines slots a "\n  " text node, which stands in the slot's own place
       inside `[part="label"]` — so the label is not `:empty`, and every emptiness selector there
       is stops matching. `[part="badge-slot"]`, the `$switch` host,
       is in the tree unconditionally and was never covered by such a rule at all. `display:
       contents` is what decides it instead: those wrappers generate no box, so the control's
       `gap: var(--jx-space-2)` counts only what a consumer actually slotted, and a whitespace-only
       run contributes nothing because flex layout does not render one. Measured in Chrome 152
       against `--jx-control-h: 24px`: 25.33px for the icon-only button on one line AND for the
       same button written across two, against 52.31px once a real label is slotted. happy-dom
       computes `display` from the same emitted sheet, which is what this asserts — it cannot lay
       the button out, so the widths above are the browser's word and not this test's. */
    const el = await action({ icon: "plus", label: "Add" });
    const label = el.querySelector('[part="label"]')!;
    expect(getComputedStyle(label).display).toBe("contents");
    // The slot itself leaves no node, so there is nothing between the label and what was slotted.
    expect(el.querySelector("slot")).toBeNull();
    expect(getComputedStyle(el.querySelector('[part="badge-slot"]')!).display).toBe("contents");
    // The two-line spelling, which is the one a hand-written page produces: the whitespace is a
    // Slotted child, so it REPLACES the slot rather than sitting inside it.
    const spaced = document.createElement("jx-action-button") as JxActionButton;
    spaced.setAttribute("icon", "plus");
    spaced.setAttribute("label", "Add");
    spaced.append(document.createTextNode("\n  "));
    document.body.append(spaced);
    await tick();
    const spacedLabel = spaced.querySelector('[part="label"]')!;
    expect(spacedLabel.querySelector("slot")).toBeNull();
    expect(spacedLabel.textContent).toBe("\n  ");
    expect(getComputedStyle(spacedLabel).display).toBe("contents");
    // And the emptiness selectors that CANNOT decide it are confined to `stacked`, which is the
    // One shape that keeps a box at all.
    for (const rule of sheet()) {
      if (rule.includes(":empty")) {
        expect(rule, rule).toContain("[data-stacked]");
      }
    }
  });

  test("stacked is the one shape that keeps a label BOX, because it ellipses", () => {
    /* A rail button puts the label under the glyph and clips it, which needs a box with
       `overflow: hidden` — so `display: contents` is overridden there, and the empty case comes
       back (rail.json's Settings button is stacked with no slotted label). Asserted as rule text:
       the collapse is a selector match happy-dom answers the same way with or without a text node
       in the slot, so only a browser can judge it.

       TWO selectors, because "did the consumer slot a label" now has two shapes and BOTH are
       reachable. `distributeSlots` returns before it unwraps anything when the host was given no
       children at all, so a rail button keeps its `[part="label-slot"]` node and only `:has` sees
       it. Every other route — a slotted label a host later clears, or one that only ever matched a
       named slot — leaves no slot node behind at all, and only `:empty` sees that. Measured in
       Chrome 152 on the stacked Settings button: 25.33px tall with no children (the `:has`
       branch), 41.33px with "Settings" slotted, and back to 25.33px the moment that text is
       removed (the `:empty` branch), where a `:has`-only rule left it at 41.33px with an empty
       label box. */
    const rules = sheet();
    expect(rules).toContain(
      'S[data-stacked] > [part="control"] > [part="label"] { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }',
    );
    expect(rules).toContain(
      'S[data-stacked] > [part="control"] > [part="label"]:empty, S[data-stacked] > [part="control"] > [part="label"]:has([part="label-slot"]:empty) { display: none }',
    );
  });

  test("the stylebook page demonstrates the element, rather than working around it", () => {
    /* Two things the page got wrong while the element was wrong, and both were evidence of it.
       (1) Its `change` handler declared `parameters: ["event"]`; a parameters-declaring inline
       function is handed positional arguments, so the well-known `event` binding is shadowed and
       `event#/detail` resolves to `undefined`. Measured in Chrome 152: clicking Bold flipped
       `aria-pressed` to true while the page's own sentence stayed "Bold is off"; with the line
       gone it reads "Bold is on". (2) Every radiogroup segment carried a `checked` AND a matching
       `selected`, which is how a page hides an element whose announcement and drawing disagree.
       `checked` now draws it, so the state is written once and the page fails if it stops being
       true of the element. */
    const page = stylebookPage();
    const note = (page.state as Record<string, Record<string, unknown>>)["note"]!;
    expect(note["parameters"]).toBeUndefined();
    const segments = (page.children as JxElement[])
      .filter((child) => child.attributes?.["role"] === "radiogroup")
      .flatMap((group) => (group.children ?? []) as JxElement[]);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      const props = segment.$props as Record<string, unknown>;
      expect(typeof props["checked"], String(props["label"])).toBe("string");
      expect(props["selected"], String(props["label"])).toBeUndefined();
    }
  });

  test("the badge wears the recipe rather than a second drawing of it", async () => {
    /* The badge visual belongs to `.jx-badge` in the theme sheet. The element used to redraw it
       inline with its own radius, padding, fill and type, so the two could drift with nothing to
       catch it. It now declares only WHERE the badge sits; the recipe declares what it looks like.
       Both halves are checked here: the element's rule carries none of the drawing, and the
       recipe's OWN rule — sliced at its closing brace, so a sibling recipe cannot satisfy this —
       carries all of it. */
    const el = (await action({ badge: "3", icon: "git-branch", label: "Source Control" }))!;
    const badge = el.querySelector('[part="badge"]')!;
    expect(badge.classList.contains("jx-badge")).toBe(true);
    const rule = sheet().find((text) => text.startsWith('S [part="badge"] '))!;
    expect(rule).toContain("position: absolute");
    for (const forked of [
      "border-radius",
      "background",
      "padding",
      "font-size",
      "color",
      "min-width",
      "line-height",
      "height",
    ]) {
      expect(rule, forked).not.toContain(forked);
    }
    /* `box-sizing` is the one property the element still says, and it is fit rather than drawing:
       the recipe is written for a badge in the flow, where `min-width: 16px` plus `padding: 0 4px`
       is a 24px pill. In a 24px button's corner that pill covers the glyph completely — measured in
       Chrome 152 on both shipped shapes, a 25.6px toolbar button and a 56px rail button, the icon
       disappears behind it. `border-box` makes the recipe's own `min-width` the disc's diameter, so
       "3" is 16×16 and "12" grows to 21×16 rather than the element restating a size. */
    expect(rule).toContain("box-sizing: border-box");
    const recipe = badgeRecipe();
    for (const drawn of [
      "min-width: 16px",
      "padding: 0 var(--jx-space-2)",
      "border-radius: 999px",
      "background: var(--jx-accent-solid)",
      "color: var(--jx-accent-fg)",
      "font-size: var(--jx-text-xs)",
      "line-height: 16px",
    ]) {
      expect(recipe, drawn).toContain(drawn);
    }
  });
});
