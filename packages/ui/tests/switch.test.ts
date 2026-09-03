import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";
import type { JxElement } from "@jxsuite/schema/types";
import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSwitch = HTMLElement & {
  checked: boolean;
  disabled: boolean;
  hint: string;
  label: string;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

async function toggle(attrs: Record<string, string> = {}, text = "Wrap"): Promise<JxSwitch> {
  const el = document.createElement("jx-switch") as JxSwitch;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (text) {
    const span = document.createElement("span");
    span.textContent = text;
    el.append(span);
  }
  document.body.append(el);
  await tick();
  return el;
}

const input = (el: Element) => el.querySelector<HTMLInputElement>('[part="input"]')!;
const control = (el: Element) => el.querySelector<HTMLLabelElement>('[part="control"]')!;

/** The selector half that answers "the slot is still here, holding nothing". */

/** Flip the control the way a reader does, so the checkedness dirty flag is set. */
function flip(el: Element) {
  const box = input(el);
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Every top-level rule in the emitted sheet, keyed by its selector with the per-instance scope id
 * replaced by `&`. Asserting a declaration BLOCK is the difference between reading the sheet and
 * reading a selector that happens to be present.
 *
 * @param {string} css
 * @returns {Map<string, string>}
 */
function rules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of css.split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (match) {
      out.set(match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!);
    }
  }
  return out;
}

/** The px number a declaration block gives one property. */
function px(block: string | undefined, prop: string): number {
  const match = new RegExp(`(?:^|; )${prop}: (-?[\\d.]+)px(?:;|$)`).exec(block ?? "");
  expect(match, `${prop} in ${String(block)}`).not.toBeNull();
  return Number(match![1]);
}

/** The `checked` state entry of the shipped document, and the input node it is bound to. */
function checkedBinding() {
  const doc = documents["jx-switch"]!;
  const { state } = doc as unknown as { state: Record<string, { description?: string }> };
  const label = (doc.children as JxElement[])[0]!;
  const box = (label.children as JxElement[])[0]!;
  return { box, description: state["checked"]?.description ?? "" };
}

describe("jx-switch", () => {
  test("is a native checkbox wearing role=switch, inside the label that is its click target", async () => {
    const el = await toggle();
    expect(input(el).tagName).toBe("INPUT");
    expect(input(el).getAttribute("type")).toBe("checkbox");
    expect(input(el).getAttribute("role")).toBe("switch");
    expect(control(el).tagName).toBe("LABEL");
    expect(control(el).contains(input(el))).toBe(true);
    /* The slotted span stands in the SLOT'S place — `distributeSlots` calls
       `slot.replaceWith(...matches)` — so `[part="label"]` holds it directly and the slot itself
       names no node once anything has been slotted at all. */
    expect(el.querySelector('[part="label"]')?.textContent).toBe("Wrap");
    expect(el.querySelector('[part="label-slot"]')).toBeNull();
  });

  test("the on/off state is the platform's own checkedness, and no aria-checked is ever written", async () => {
    /* ARIA in HTML maps a checkbox's checkedness onto role=switch, so a hand-written aria-checked
       is a second source of truth that desyncs on the first flip. Assert its absence at every
       point the state moves, not only at rest. */
    const el = await toggle();
    const box = input(el);
    expect(box.hasAttribute("aria-checked")).toBe(false);
    expect(box.checked).toBe(false);

    flip(el);
    await tick();
    expect(el.checked).toBe(true);
    expect(box.checked).toBe(true);
    expect(el.dataset["checked"]).toBeDefined();
    expect(box.hasAttribute("aria-checked")).toBe(false);

    flip(el);
    await tick();
    expect(el.checked).toBe(false);
    expect(el.dataset["checked"]).toBeUndefined();
    expect(box.hasAttribute("aria-checked")).toBe(false);
  });

  test("a host write after a reader's flip still moves the control", async () => {
    /* The dirty-flag case: once the reader has touched the box the `checked` CONTENT attribute
       stops controlling the live state, so only the property binding keeps tracking. */
    const el = await toggle();
    flip(el);
    await tick();
    expect(el.checked).toBe(true);

    el.checked = false;
    await tick();
    expect(input(el).checked).toBe(false);

    el.checked = true;
    await tick();
    expect(input(el).checked).toBe(true);
    expect(input(el).hasAttribute("aria-checked")).toBe(false);
  });

  test("checked as an attribute reaches the control, and the host reflects it", async () => {
    const el = await toggle({ checked: "" });
    expect(input(el).checked).toBe(true);
    expect(el.dataset["checked"]).toBeDefined();
    el.removeAttribute("checked");
    await tick();
    expect(input(el).checked).toBe(false);
  });

  test("a form reset moves this switch nowhere, and that is the price of the mirror", async () => {
    /* The `checked` CONTENT attribute is `defaultChecked`, so mirroring live state onto it — which
       the document does, alongside the property binding — makes `form.reset()` a no-op here. The
       trade is deliberate and is recorded in the document's own `checked` description: until the
       element is form-associated (specs/ui.md §3.2) it never HEARS the reset, so a working reset
       would move the inner control to the authored default and leave the element's `checked` state
       behind it. A control that silently disagrees with its own element is worse than a reset that
       does nothing. Pinned so the next reader finds the decision instead of rediscovering the
       symptom. */
    const form = document.createElement("form");
    document.body.append(form);
    const el = document.createElement("jx-switch") as JxSwitch;
    form.append(el);
    await tick();
    const box = input(el);
    expect(box.defaultChecked).toBe(false);

    flip(el);
    await tick();
    expect(box.checked).toBe(true);
    // The mirror carried the DEFAULT along with the state. That is the whole mechanism.
    expect(box.defaultChecked).toBe(true);
    expect(box.hasAttribute("checked")).toBe(true);

    form.reset();
    await tick();
    expect(box.checked).toBe(true);
    expect(el.checked).toBe(true);
  });

  test("the checked description records the mirror rather than denying it", () => {
    /* The description used to say the state was bound "as a property rather than as an attribute"
       while the document did both — a reader who trusted it would have gone looking for the reset
       bug in the runtime. Assert the two halves are still both bound AND that the prose names the
       cost, so deleting either one without editing the other is a red test. */
    const { box, description } = checkedBinding();
    expect(box.attributes?.["checked"]).toEqual({ $ref: "#/state/checked" });
    expect((box as unknown as Record<string, unknown>)["checked"]).toEqual({
      $ref: "#/state/checked",
    });
    expect(description).not.toContain("rather than as an attribute");
    expect(description).toContain("BOTH");
    expect(description).toContain("form.reset()");
    expect(description).toContain("§3.2");
  });

  test("hint becomes the row's title, and no hint removes the attribute", async () => {
    const el = await toggle();
    expect(control(el).hasAttribute("title")).toBe(false);
    el.hint = "Sign in to publish from here.";
    await tick();
    expect(control(el).getAttribute("title")).toBe("Sign in to publish from here.");
    el.hint = "";
    await tick();
    expect(control(el).hasAttribute("title")).toBe(false);
  });

  test("disabled reaches the control, and the host says so", async () => {
    const el = await toggle({ disabled: "" });
    expect(input(el).disabled).toBe(true);
    expect(el.dataset["disabled"]).toBeDefined();
    el.disabled = false;
    await tick();
    expect(input(el).disabled).toBe(false);
    expect(el.dataset["disabled"]).toBeUndefined();
  });

  test("label names the control, and an empty label leaves the slotted text to name it", async () => {
    const el = await toggle({ label: "Wrap long lines" });
    expect(input(el).getAttribute("aria-label")).toBe("Wrap long lines");
    el.label = "";
    await tick();
    expect(input(el).hasAttribute("aria-label")).toBe(false);
  });

  test("labelledby, describedby and name are forwarded to the control", async () => {
    const el = await toggle({
      describedby: "row-help",
      labelledby: "row-label",
      name: "minify",
    });
    expect(input(el).getAttribute("aria-labelledby")).toBe("row-label");
    expect(input(el).getAttribute("aria-describedby")).toBe("row-help");
    expect(input(el).name).toBe("minify");
  });

  test("slotted markup survives into the label slot rather than being stringified", async () => {
    /* A label is not always a plain string: the Imports panel slots a span holding an escaped tag
       name, which a `label` attribute could not express. */
    const el = document.createElement("jx-switch") as JxSwitch;
    const span = document.createElement("span");
    span.textContent = "<my-element>";
    el.append(span);
    document.body.append(el);
    await tick();
    const slotted = el.querySelector('[part="label"] span');
    expect(slotted).toBe(span);
    expect(slotted?.textContent).toBe("<my-element>");
  });

  test("an empty label collapses, because a slot leaves no node to fill it", async () => {
    /* Simplified. The rule was `:has([part="label-slot"]:empty)` ALONE, because the slot survived
       distribution and made `:empty` on the span permanently false. Slots now unwrap whether or
       not they matched anything — including when the host has no light children at all, which is
       exactly the unlabelled switch this rule exists for — so `:empty` is correct and sufficient.
       Each of the three cases below cost the row's 4px gap for a zero-width label before. */
    const bare = await toggle({ label: "Unlabelled switch" }, "");
    expect(bare.querySelector("slot")).toBeNull();
    expect(bare.querySelector('[part="label"]')!.matches(":empty")).toBe(true);

    // Light children that match no slot: the slot unwrapped to its absent fallback.
    const elsewhere = document.createElement("jx-switch") as JxSwitch;
    elsewhere.innerHTML = '<span slot="nowhere">x</span>';
    document.body.append(elsewhere);
    await tick();
    expect(elsewhere.querySelector('[part="label"]')!.matches(":empty")).toBe(true);

    // A labelled switch keeps its label box and its gap.
    const labelled = await toggle();
    expect(labelled.querySelector('[part="label"]')!.childNodes.length).toBeGreaterThan(0);

    // And the sheet spells the one rule, so deleting it is a red test here.
    expect(rules(documentStyleText()).get('& [part="label"]:empty')).toBe("display: none");
    expect(documentStyleText()).not.toContain("label-slot");
  });

  test("size scales the track and the thumb, and re-derives the travel for each size", async () => {
    /* Three tracks, three thumbs and three travels, all hand-derived: travel is the padding box
       (width less the two 1px borders) less the thumb, less the two 1px insets it rests in. Assert
       the DECLARATIONS, not that the selector exists — a `sm` rule that scales nothing, or a travel
       that no longer lands the thumb at the far edge, is exactly what a selector match cannot see. */
    const el = await toggle({ size: "lg" });
    expect(el.dataset["size"]).toBe("lg");
    const r = rules(documentStyleText());

    const box = r.get('& [part="input"]');
    expect(box).toContain("box-sizing: border-box");
    expect(box).toContain("border: 1px solid var(--jx-switch-track)");
    expect(r.get('& [part="input"]::before')).toContain("inset-inline-start: 1px");

    const sizes = [
      { thumb: '& [part="input"]::before', track: '& [part="input"]', travel: 12, width: 28 },
      {
        thumb: '&[data-size="sm"] [part="input"]::before',
        track: '&[data-size="sm"] [part="input"]',
        travel: 10,
        width: 22,
      },
      {
        thumb: '&[data-size="lg"] [part="input"]::before',
        track: '&[data-size="lg"] [part="input"]',
        travel: 14,
        width: 34,
      },
    ];
    for (const size of sizes) {
      const track = r.get(size.track);
      const thumb = r.get(size.thumb);
      expect(px(track, "width")).toBe(size.width);
      expect(px(track, "--jx-switch-travel")).toBe(size.travel);
      // The derivation itself: padding box − thumb − the 1px inset at each end.
      expect(size.travel).toBe(size.width - 2 - px(thumb, "width") - 2);
      // The thumb is round, and it has to fit the track's inside.
      expect(px(thumb, "height")).toBe(px(thumb, "width"));
      expect(px(track, "height")).toBe(px(thumb, "width") + 4);
    }
  });

  test("the thumb travels toward the track's own end, in either writing direction", async () => {
    /* The thumb RESTS at `inset-inline-start`, so a physical `translate: 12px 0` sends it the wrong
       way under `dir="rtl"`: it starts at the right inner edge and moves 12px further right, ending
       outside a track that then looks empty. One travel custom property and a `:dir(rtl)` negation
       keeps the two halves logical together. */
    await toggle();
    const css = documentStyleText();
    const r = rules(css);
    expect(r.get('& [part="input"]:checked::before')).toBe("translate: var(--jx-switch-travel) 0");
    expect(r.get('&:dir(rtl) [part="input"]:checked::before')).toBe(
      "translate: calc(-1 * var(--jx-switch-travel)) 0",
    );
    // No physical travel survives anywhere in the sheet: a px translate IS the RTL defect.
    expect(css).not.toMatch(/translate:\s*-?[\d.]/);
  });

  test("the emitted sheet answers forced colors, which appearance:none discards", async () => {
    /* `appearance: none` opts the track out of the UA's forced-colors rendering, so the element
       has to draw the on/off distinction itself in system colours or it disappears entirely. */
    await toggle();
    const css = documentStyleText();
    expect(css).toContain("@media (forced-colors: active)");
    const block = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(block).toContain('[part="input"]');
    expect(block).toContain("forced-color-adjust: none");
    expect(block).toContain("ButtonFace");
    expect(block).toContain("ButtonText");
    expect(block).toContain("Highlight");
  });

  test("nothing in the sheet is a colour literal, functional notation included", async () => {
    /* The kit's raw-colour gate is a HEX regex, so `rgb(0 0 0 / 0.35)` — which the thumb shadow
       used to be — passed it on a technicality while shipping one fixed shadow weight into both
       themes. Every colour here is a token or a system colour. */
    await toggle();
    const css = documentStyleText();
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  });

  test("the sheet times everything on the motion token, never on a literal duration", async () => {
    /* `@(prefers-reduced-motion: reduce)` zeroes --jx-dur-1 at the token layer, so a hard-coded
       duration is the one way to keep animating for a reader who asked not to. The check is
       SHEET-WIDE rather than a `transition:` shorthand match, because the longhand pair, an
       `animation` shorthand and `transition-duration` are each a way past a narrower one. */
    await toggle();
    const css = documentStyleText();
    expect(rules(css).get('& [part="input"]::before')).toContain(
      "transition: translate var(--jx-dur-1) var(--jx-ease-out)",
    );
    expect(css).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
  });
});
