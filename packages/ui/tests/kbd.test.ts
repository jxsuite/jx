import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function kbd(text = "Ctrl"): Promise<HTMLElement> {
  const el = document.createElement("jx-kbd");
  el.textContent = text;
  document.body.append(el);
  await tick();
  return el;
}

/**
 * The emitted rules that mention ONE element's scope handle, keyed by selector with that handle
 * folded to `&`. Scoped to one handle because every kit element writes an `&[hidden]` rule, so an
 * unscoped map answers with whichever element rendered last.
 *
 * READ THIS AS DECLARATION TEXT, NOT AS BEHAVIOUR. It answers "the rule was written", never "the
 * rule wins". Where the cascade is the claim, assert {@link computed} instead; a token-valued
 * declaration has no choice, because happy-dom leaves any value containing `var()` empty in
 * `getComputedStyle`, and every test that settles for text says so.
 *
 * @param {HTMLElement} el - The element whose handle to read
 * @returns {Map<string, string>}
 */
function rulesOf(el: HTMLElement): Map<string, string> {
  const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (match && match[1]!.includes(handle)) {
      out.set(match[1]!.replaceAll(handle, "&"), match[2]!);
    }
  }
  return out;
}

/**
 * One property as the CASCADE resolves it — what the box actually gets. happy-dom applies the
 * emitted sheet, so this fails when a declaration is deleted AND when a later rule of equal
 * specificity overrides it, which is the failure `rulesOf` cannot see.
 *
 * @param {HTMLElement} el - The element to read
 * @param {string} prop - A camelCase CSS property name
 * @returns {string}
 */
const computed = (el: HTMLElement, prop: string) =>
  (getComputedStyle(el) as unknown as Record<string, string>)[prop] ?? "";

describe("jx-kbd", () => {
  test("is an ATOMIC INLINE box, which is the whole reason it is not the runtime's default", async () => {
    /* A key cap sits in running text, and the runtime gives a custom element `display: block` when
       its base block declares none (spec.md §9.6) — a block cap would take a line to itself and
       break the sentence around it. Asserted through the CASCADE, so deleting the declaration
       reddens this test (the runtime's own `block` is what would take its place).

       Measured in Chrome 152, DPR 1.5, both forms on one page with the deleted `& .jx-kbd` recipe
       hand-restored as the control, three caps in one 240px paragraph:

                              control kbd.jx-kbd            element jx-kbd
           paragraph          240 x 42.67                   240 x 42.67
           cap x              62.70 / 139.14 / 16.00        62.70 / 139.14 / 16.00
           cap w x h          33.96x17.33, 40.10x17.33 (x2) identical

       The third cap wraps to the second line at x 16.00 in both. Narrowed to 120px the paragraph
       is 120 x 64 in both and the caps break at 62.70 / 16.00 / 16.00 — line breaking survives the
       swap, which a block box would not have. */
    const el = await kbd();
    expect(rulesOf(el).get("&")).toContain("display: inline-block");
    expect(computed(el, "display")).toBe("inline-block");
  });

  test("hidden hides it — which the recipe declared a display and then never did", async () => {
    /* `& .jx-kbd` declared `display: inline-block` at (0,1,0), and an AUTHOR declaration beats the
       UA's `[hidden] { display: none }` whatever its specificity, so `<kbd class="jx-kbd" hidden>`
       was still drawn. Measured in Chrome 152 with both forms on one page:

                                computed display   client rects   paragraph height
           control kbd.jx-kbd   inline-block       1              21.33
           element jx-kbd       none               0              19.33

       So the element fixes this rather than preserving it, and it is why `conformance.test.ts`
       requires an `&[hidden]` rule of every host that declares a display. Asserted through the
       cascade, so deleting the rule reddens this test. */
    const el = await kbd();
    expect(rulesOf(el).get("&[hidden]")).toBe("display: none");
    el.hidden = true;
    await tick();
    expect(computed(el, "display")).toBe("none");
  });

  test("carries every declaration the recipe painted the cap with", async () => {
    /* This is the class `.jx-kbd` moved onto the element, declaration for declaration. Each one is
       the cap: drop the border and it is plain text, drop the panel background and it disappears
       into a menu row, drop the mono face and a chord no longer lines up column with column.

       DECLARATION TEXT ONLY, and it has to be: every value below is token-valued, and happy-dom
       leaves any `var()` unresolved in `getComputedStyle`, so this proves the declarations are
       written and not that they win. What they resolve to was measured instead — Chrome 152, the
       control cap and the element cap side by side, field for field IDENTICAL:

           padding            0px 4px
           border             0.666667px solid rgb(47, 47, 54)
           border-radius      2px
           background-color   rgb(23, 23, 27)
           color              rgb(162, 162, 175)
           font               10px / 16px "JetBrains Mono", "SF Mono", "Fira Code", monospace
           box-sizing         content-box
           vertical-align     baseline
           margin             0px

       Nothing in that list is the browser default, so a deleted declaration is visible in the
       measurement as well as here. */
    const base = rulesOf(await kbd()).get("&") ?? "";
    for (const decl of [
      "padding: 0 var(--jx-space-2)",
      "border: 1px solid var(--jx-border)",
      "border-radius: var(--jx-radius-xs)",
      "background: var(--jx-bg-panel)",
      "color: var(--jx-fg-dim)",
      "font-family: var(--jx-font-mono)",
      "font-size: var(--jx-text-xs)",
      "line-height: var(--jx-leading-sm)",
    ]) {
      expect(base, decl).toContain(decl);
    }
  });

  test("the cap IS the host: the slot leaves no node, so the text is the host's own child", async () => {
    /* `<slot>` unwraps (spec.md §16.6). So the box tree under a `<jx-kbd>Ctrl</jx-kbd>` is exactly
       the box tree under a `<kbd class="jx-kbd">Ctrl</kbd>` — one box with one text node — which
       is what makes the two measure the same rather than merely look alike. A wrapper element here
       would be a second box the recipe never had; Chrome confirms `innerHTML === "Ctrl"` and zero
       element children on the rendered element. */
    const el = await kbd("Shift");
    expect(el.textContent).toBe("Shift");
    expect(el.children).toHaveLength(0);
    expect(el.firstChild?.nodeType).toBe(3);
  });

  test("takes no role and no name of its own, because <kbd> has none to preserve", async () => {
    /* Measured in Chrome 152's accessibility tree: `<kbd class="jx-kbd">Ctrl</kbd>` and
       `<jx-kbd>Ctrl</jx-kbd>` are both a `generic` holding the StaticText "Ctrl". There is no role
       to carry over, so writing one would ADD something the recipe never announced. */
    const el = await kbd();
    expect(el.getAttributeNames().filter((n) => n === "role" || n.startsWith("aria-"))).toEqual([]);
    const doc = documents["jx-kbd"]!;
    expect(doc.attributes).toBeUndefined();
    expect(doc.state).toBeUndefined();
    expect(doc.observedAttributes).toBeUndefined();
  });
});
