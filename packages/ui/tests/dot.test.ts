import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxDot = HTMLElement & { tone: string };

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function dot(attrs: Record<string, string> = {}): Promise<JxDot> {
  const el = document.createElement("jx-dot") as JxDot;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
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

describe("jx-dot", () => {
  test("is the disc itself: one box, no node inside it", async () => {
    /* The recipe was a bare `<span class="jx-dot">`, and the element is that span. An inner part
       would be a second box the disc has no use for — there is nothing to slot, nothing to name
       and nothing to position against.

       The four geometric declarations are asserted through the CASCADE, so deleting any one of
       them reddens this test. Measured in Chrome 152, DPR 1.5, both forms on one page with the
       deleted `& .jx-dot` recipe hand-restored as the control: four discs in a row are
       6 x 6 at x 16 / 22 / 28 / 34 in BOTH forms, and every field of
       `display / padding / border / border-radius / background-color / box-sizing /
       vertical-align / margin / width / height` matches except `flex-shrink` — see the next
       test. */
    const el = await dot();
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe("");
    expect(computed(el, "display")).toBe("inline-block");
    expect(computed(el, "width")).toBe("6px");
    expect(computed(el, "height")).toBe("6px");
    expect(computed(el, "borderRadius")).toBe("50%");
    /* Token-valued, so text only. Chrome measures the neutral disc `rgb(124, 124, 139)` in both
       forms, which is `--jx-fg-muted`. */
    expect(rulesOf(el).get("&") ?? "").toContain("background: var(--jx-fg-muted)");
  });

  test("REFUSES to be flexed, which the recipe did not and which cost it the disc", async () => {
    /* The one declaration here that is not the class's. Measured in Chrome 152, a 40px flex row
       holding a nowrap label and a dot, both forms on one page:

                                    computed flex-shrink   drawn box
         control span.jx-dot        1                      0 x 6   — it vanishes entirely
         element jx-dot             0                      6 x 6

       Every place the kit puts a status dot is a crowded flex row (an accordion summary, a tab
       strip, a status bar), so the recipe's box was one long label away from not being drawn at
       all. Asserted through the CASCADE rather than as rule text: `flex-shrink` computes 0 here
       and its initial value is 1, so deleting `flex: none` reddens this test — which is what would
       catch the recipe's behaviour coming back. */
    const el = await dot();
    expect(computed(el, "flexShrink")).toBe("0");
    expect(rulesOf(el).get("&")).toContain("flex: none");
  });

  test("tone recolours the disc and nothing else", async () => {
    /* Text only, and it can be nothing else: all three values are tokens. Chrome, with the control
       beside it, measures `rgb(232, 100, 96)` / `rgb(79, 178, 122)` / `rgb(229, 174, 74)` for
       danger / success / warning in both forms, on discs still 6 x 6 at the same x — the branch
       moves the paint and not the box. */
    const r = rulesOf(await dot({ tone: "danger" }));
    expect(r.get('&[tone="danger"]')).toBe("background: var(--jx-danger)");
    expect(r.get('&[tone="success"]')).toBe("background: var(--jx-success)");
    expect(r.get('&[tone="warning"]')).toBe("background: var(--jx-warning)");
  });

  test("tone REFLECTS, so the branch is reachable through the property door too", async () => {
    /* Every branch keys on the host's own attribute, and `$props` in a Jx document sets the
       PROPERTY. Without the reflection a `$props: { tone: "danger" }` dot would stay grey, with
       every rule above still emitted and every assertion above still passing. */
    const el = await dot();
    expect(el.hasAttribute("tone")).toBe(false);
    el.tone = "success";
    await tick();
    expect(el.getAttribute("tone")).toBe("success");
  });

  test("an unknown tone, and a removed one, are the neutral disc", async () => {
    /* Removing an observed attribute restores the entry's DECLARED DEFAULT rather than writing the
       absence through, so the empty default is what comes back — and the empty default writes no
       attribute at all, which is what leaves the base rule the only one matching. */
    const el = await dot({ tone: "danger" });
    el.setAttribute("tone", "chartreuse");
    await tick();
    expect(el.getAttribute("tone")).toBe("chartreuse");
    expect(rulesOf(el).get('&[tone="chartreuse"]')).toBeUndefined();
    expect(computed(el, "width")).toBe("6px");
    el.removeAttribute("tone");
    await tick();
    expect(el.tone).toBe("");
    expect(el.hasAttribute("tone")).toBe(false);
  });

  test("names nothing, so the row it sits in is what says what it means", async () => {
    /* Measured in Chrome 152's accessibility tree: an empty `<span class="jx-dot">` and an empty
       `<jx-dot>` are both pruned out of it. Writing `aria-hidden` here would be the same silence
       spelled louder, and writing a role would make a 6px disc announce itself with no name — so
       the element writes neither, which also leaves both doors open at the usage site. */
    const el = await dot({ tone: "warning" });
    expect(el.getAttributeNames().filter((n) => n === "role" || n.startsWith("aria-"))).toEqual([]);
  });

  test("hidden hides it — which the recipe declared a display and then never did", async () => {
    /* `& .jx-dot` declared `display: inline-block` at (0,1,0), and an AUTHOR declaration beats the
       UA's `[hidden] { display: none }` whatever its specificity, so `<span class="jx-dot" hidden>`
       was still drawn. Measured in Chrome 152 with both forms on one page:

                                 computed display   client rects
           control span.jx-dot   inline-block       1
           element jx-dot        none               0

       So this is the second thing the element fixes rather than preserves, and it is why
       `conformance.test.ts` requires an `&[hidden]` rule of every host that declares a display.
       Asserted through the cascade, so deleting the rule reddens this test. `tone` touches only
       `background`, so a toned dot hides too — Chrome agrees: `none`, 0 rects. */
    const el = await dot();
    expect(rulesOf(el).get("&[hidden]")).toBe("display: none");
    el.hidden = true;
    await tick();
    expect(computed(el, "display")).toBe("none");

    const toned = await dot({ tone: "danger" });
    toned.hidden = true;
    await tick();
    expect(computed(toned, "display")).toBe("none");
  });
});
