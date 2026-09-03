import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";
import { buildStyleRules } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";
import checkboxDoc from "../components/jx-checkbox.json";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxCheckbox = HTMLElement & {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A mounted `jx-checkbox`, with attributes written before it connects and any markup slotted the
 * way a consumer writes it.
 *
 * @param {Record<string, string>} [attrs] Attributes to set before connecting
 * @param {string} [markup] Light-DOM children, slotted as the visible label
 * @returns {Promise<JxCheckbox>} The connected element, after its first render
 */
async function box(attrs: Record<string, string> = {}, markup = ""): Promise<JxCheckbox> {
  const el = document.createElement("jx-checkbox") as JxCheckbox;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (markup !== "") {
    el.innerHTML = markup;
  }
  document.body.append(el);
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLInputElement>('[part="input"]')!;

/** The whole collapse rule, as the sheet spells it under the test scope. */
const COLLAPSE = 'S [part="label"]:empty { display: none }';

describe("jx-checkbox", () => {
  test("is a real native checkbox inside the label that is the click target", async () => {
    const el = await box({}, "Include in the build");
    const input = control(el);
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("checkbox");
    // The one address a consumer or a test uses, and the label wrapping it is what a click hits.
    const wrapper = input.parentElement!;
    expect(wrapper.tagName).toBe("LABEL");
    expect(wrapper.getAttribute("part")).toBe("control");
    /* The slotted text stands in the SLOT'S OWN PLACE: `distributeSlots` calls
       `slot.replaceWith(...matches)`, so `[part="label"]` holds the consumer's nodes directly and
       `[part="label-slot"]` names nothing once anything has been slotted. */
    expect(el.querySelector('[part="label"]')?.textContent).toBe("Include in the build");
    expect(el.querySelector('[part="label-slot"]')).toBeNull();
  });

  test("checked is a property the host writes, before and after the reader touches it", async () => {
    const el = await box({}, "Ticked");
    const input = control(el);
    expect(input.checked).toBe(false);

    el.checked = true;
    await tick();
    expect(input.checked).toBe(true);
    el.checked = false;
    await tick();
    expect(input.checked).toBe(false);

    /* The dirty-flag case. A click sets the control's checkedness dirty flag, after which the
       `checked` CONTENT attribute no longer controls the live state — so a binding written into
       `attributes` would look correct up to here and stop tracking from here on. */
    input.click();
    expect(input.checked).toBe(true);
    expect(el.checked).toBe(true);
    expect(el.checked).toBe(input.checked);
    /* The content attribute is mirrored too, as jx-textfield mirrors `value`: the element never
       hears a form reset, so the control's DEFAULT checkedness must track its current one or a
       reset would move the control and leave the element's state where it was. */
    expect(input.hasAttribute("checked")).toBe(true);
    expect(input.defaultChecked).toBe(true);

    el.checked = false;
    await tick();
    expect(input.checked).toBe(false);
    el.checked = true;
    await tick();
    expect(input.checked).toBe(true);
  });

  test("a form reset is a no-op, which is the price of the checked attribute mirror", async () => {
    const form = document.createElement("form");
    const el = document.createElement("jx-checkbox") as JxCheckbox;
    el.setAttribute("name", "included");
    el.textContent = "Include in the build";
    // The control the element is measured against: same starting state, no element around it.
    const native = document.createElement("input");
    native.type = "checkbox";
    native.name = "plain";
    form.append(el, native);
    document.body.append(form);
    await tick();

    const input = control(el);
    input.click();
    native.click();
    await tick();
    expect(input.checked).toBe(true);
    expect(native.checked).toBe(true);

    form.reset();
    /* The native box snaps back to its authored default; the kit's does not. That is the trade-off
       the `checked` mirror buys, and it is deliberate: the element is not form-associated yet
       (specs/ui.md 3.2), so it never hears the reset. WITHOUT the mirror the control would snap
       back here and `el.checked` would stay true — the element and its own control disagreeing,
       silently, with no event to reconcile them. A reset that does nothing is a missing feature; a
       reset that desyncs them is a lie. Delete the mirror and this assertion is what changes. */
    expect(native.checked).toBe(false);
    expect(input.checked).toBe(true);
    expect(el.checked).toBe(true);
    expect(el.checked).toBe(input.checked);
  });

  test("indeterminate reaches the live property and survives a re-render", async () => {
    const el = await box({}, "Mixed");
    const input = control(el);
    el.indeterminate = true;
    await tick();
    expect(input.indeterminate).toBe(true);
    // HTML has no `indeterminate` content attribute, which is the whole reason this is an element.
    expect(input.hasAttribute("indeterminate")).toBe(false);
    expect(el.dataset["indeterminate"]).toBeDefined();

    // A write to something else re-runs the bindings; the mixed state is not disturbed by that.
    el.label = "Mixed rows";
    await tick();
    expect(control(el)).toBe(input);
    expect(input.indeterminate).toBe(true);

    el.indeterminate = false;
    await tick();
    expect(input.indeterminate).toBe(false);
    expect(el.dataset["indeterminate"]).toBeUndefined();
  });

  test("a click on a mixed box clears indeterminate and ticks it, and both land back in state", async () => {
    const el = await box({}, "Mixed");
    const input = control(el);
    el.indeterminate = true;
    await tick();
    expect(input.indeterminate).toBe(true);

    input.click();
    expect(input.checked).toBe(true);
    expect(input.indeterminate).toBe(false);
    expect(el.checked).toBe(true);
    expect(el.indeterminate).toBe(false);

    /* Mirroring only `checked` would leave state saying mixed, and the next flush would re-assert
       it over the reader's own tick. */
    await tick();
    expect(input.indeterminate).toBe(false);
    expect(input.checked).toBe(true);
    expect(el.dataset["indeterminate"]).toBeUndefined();
    expect(el.dataset["checked"]).toBeDefined();
  });

  test("a label names the box, and an empty one leaves the naming to the slotted text", async () => {
    const el = await box({ label: "Reflects" }, "Reflects");
    expect(control(el).getAttribute("aria-label")).toBe("Reflects");

    el.label = "";
    await tick();
    // Removed, not emptied: an empty aria-label would name the box nothing and hide its own text.
    expect(control(el).hasAttribute("aria-label")).toBe(false);
    expect(el.querySelector('[part="label"]')?.textContent).toBe("Reflects");
  });

  test("labelledby and describedby forward to the control, and are absent when unset", async () => {
    const el = await box({ describedby: "row-help", labelledby: "row-label" });
    expect(control(el).getAttribute("aria-labelledby")).toBe("row-label");
    expect(control(el).getAttribute("aria-describedby")).toBe("row-help");
    // A bare box slots nothing, so its label has nothing to show and the CSS collapses it.
    expect(el.querySelector('[part="label"]')?.textContent).toBe("");

    /* The `|| null` half, which the write-and-read-back above cannot see. Dropped, every box that
       names nothing ships a live empty `aria-labelledby` — a reference to no element at all, which
       is worse than no reference, and the same one edit would do it on all three forms elements. */
    const bare = await box({}, "Include in the build");
    expect(control(bare).hasAttribute("aria-labelledby")).toBe(false);
    expect(control(bare).hasAttribute("aria-describedby")).toBe(false);
    // And they go away again when the host clears them, rather than staying behind as empties.
    el.setAttribute("labelledby", "");
    el.setAttribute("describedby", "");
    await tick();
    expect(control(el).hasAttribute("aria-labelledby")).toBe(false);
    expect(control(el).hasAttribute("aria-describedby")).toBe(false);
  });

  test("size scales the row and the box, and the host carries the size it was given", async () => {
    const sm = await box({ size: "sm" }, "Small");
    const md = await box({}, "Medium");
    const lg = await box({ size: "lg" }, "Large");
    // The mirror is the half the rules select on; the rules are the half a reader sees.
    expect(sm.dataset["size"]).toBe("sm");
    expect(md.dataset["size"]).toBe("md");
    expect(lg.dataset["size"]).toBe("lg");

    /* Scoped to THIS document's handle: jx-switch and jx-textfield spell `[data-size]` too, so an
       unscoped search would report their rules as this element's. */
    const scope = `[data-jx="${sm.dataset["jx"]}"]`;
    const lines = documentStyleText()
      .split("\n")
      .filter((line) => line.startsWith(scope));
    const rule = (size: string, part: string) =>
      lines.find((line) => line.includes(`[data-size="${size}"]`) && line.includes(part)) ?? "";

    // A row of controls lines up because the height moves with the size, and the two ends differ.
    expect(rule("sm", '[part="control"]')).toContain("min-height: calc(var(--jx-control-h) - 4px)");
    expect(rule("lg", '[part="control"]')).toContain("min-height: calc(var(--jx-control-h) + 8px)");
    expect(rule("sm", '[part="control"]')).toContain("font-size: var(--jx-text-sm)");
    expect(rule("lg", '[part="control"]')).toContain("font-size: var(--jx-text-lg)");
    expect(rule("sm", '[part="input"]')).toContain("width: calc(var(--jx-icon-size) - 2px)");
    expect(rule("lg", '[part="input"]')).toContain("width: calc(var(--jx-icon-size) + 2px)");
    // `md` is the base rule, so it must NOT have a bracketed override of its own.
    expect(rule("md", '[part="control"]')).toBe("");
  });

  test("slotted markup survives into the label slot rather than being stringified", async () => {
    const el = await box({}, "Register <code>&lt;my-element&gt;</code>");
    const label = el.querySelector<HTMLElement>('[part="label"]')!;
    const code = label.querySelector("code")!;
    expect(code).not.toBeNull();
    expect(code.textContent).toBe("<my-element>");
    expect(label.textContent).toBe("Register <my-element>");
    // The `<code>` is a CHILD of the label, not a grandchild behind a slot that no longer exists.
    expect(code.parentElement).toBe(label);
  });

  test("disabled reaches the control and takes it out of the tab order", async () => {
    const el = await box({ disabled: "" }, "Cannot tick");
    const input = control(el);
    expect(input.disabled).toBe(true);
    expect(el.dataset["disabled"]).toBeDefined();
    input.focus();
    expect(document.activeElement === input).toBe(false);

    el.disabled = false;
    await tick();
    expect(control(el).disabled).toBe(false);
    control(el).focus();
    expect(document.activeElement === control(el)).toBe(true);
  });

  test("change bubbles from the native input, so a host handler reads e.target.checked", async () => {
    const el = await box({ name: "included" }, "Include");
    const input = control(el);
    expect(input.name).toBe("included");

    const heard: [EventTarget | null, boolean][] = [];
    el.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      heard.push([target, target.checked]);
    });
    input.click();
    input.click();
    // In light DOM the target IS the native input, so every ported `e.target.checked` read works.
    expect(heard).toEqual([
      [input, true],
      [input, false],
    ]);
    expect(el.checked).toBe(false);
  });

  test("the shipped prop docs describe the binding the document actually writes", () => {
    /* Prose is under test here for one reason: `state.checked.description` shipped saying the value
       is bound as a property "not as the checked content attribute" while the input's `attributes`
       block bound exactly that, and `conformance.test.ts` only asks that a description be a string.
       A reader who trusts it reasons wrongly about a form reset, and no other gate can see it. */
    const state = checkboxDoc.state as Record<string, { description?: string }>;
    // Both bindings exist, so both have to be accounted for — including what a reset then does.
    expect(state["checked"]?.description).toMatch(/reset/i);
    expect(state["checked"]?.description).toMatch(/default/i);
    // And the mixed state has no attribute to mirror, which is why the element exists at all.
    expect(state["indeterminate"]?.description).toMatch(/reset/i);
  });

  test("the box is the platform's own, and an empty label collapses", () => {
    const rules = buildStyleRules(checkboxDoc.style as JxStyle, { scope: "S" }).map(
      (rule) => rule.text,
    );
    /* `accent-color` recolours the platform's tick and its mixed dash. Reaching for `appearance`
       would mean hand-drawing both, and a forced-colors block to put them back. */
    const input = rules.find((text) => text.startsWith('S [part="input"] '))!;
    expect(input).toContain("accent-color: var(--jx-accent-solid)");
    expect(rules.join("\n")).not.toContain("appearance");
    expect(rules).toContain(COLLAPSE);
  });

  test("an empty label collapses, because a slot leaves no node to fill it", async () => {
    /* Simplified, not patched. The rule used to be `:has([part="label-slot"]:empty)` because the
       slot survived distribution and made `:empty` false on the span — so `:empty` was dead code
       and the `:has()` form was the working one. Slots now unwrap whether or not they matched
       anything, so a label span with nothing slotted into it is simply empty, and `:empty` is both
       correct and the only rule needed. */
    const rules = buildStyleRules(checkboxDoc.style as JxStyle, { scope: "S" }).map((r) => r.text);
    expect(rules).toContain(COLLAPSE);
    expect(rules.join("\n")).not.toContain("label-slot");

    // Nothing slotted at all: the slot unwrapped to its absent fallback and left the span empty.
    const bare = await box({ label: "Select every row" });
    expect(bare.querySelector("slot")).toBeNull();
    expect(bare.querySelector('[part="label"]')!.matches(":empty")).toBe(true);

    // Slotted somewhere else: the unnamed slot matched nothing, same outcome.
    const elsewhere = await box({ label: "Select every row" }, '<span slot="nowhere">x</span>');
    expect(elsewhere.querySelector('[part="label"]')!.matches(":empty")).toBe(true);

    /* And a box that was given text keeps its label box. Asserted through the content rather than
       through `:empty`, because happy-dom counts ELEMENT children only and calls a label holding
       one text node empty where CSS does not. Measured in Chrome 152 instead: this box computes
       `display: block` on the label at 127.26px wide, against the bare box's 16px. */
    const labelled = await box({}, "Include in the build");
    const label = labelled.querySelector('[part="label"]')!;
    expect(label.textContent).toBe("Include in the build");
    expect(label.childNodes.length).toBeGreaterThan(0);
  });
});
