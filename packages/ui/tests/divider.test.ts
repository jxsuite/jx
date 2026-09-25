import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxDivider = HTMLElement & { orientation: string };

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function divider(attrs: Record<string, string> = {}): Promise<JxDivider> {
  const el = document.createElement("jx-divider") as JxDivider;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  await tick();
  return el;
}

const rule = (el: Element) => el.querySelector<HTMLElement>('[part="rule"]')!;

/**
 * The emitted rules that mention ONE element's scope handle, keyed by selector with that handle
 * folded to `&`. Scoped to one handle because every kit element writes an `&[hidden]` rule, so an
 * unscoped map answers with whichever element rendered last.
 *
 * READ THIS AS DECLARATION TEXT, NOT AS BEHAVIOUR. It answers "the rule was written", never "the
 * rule wins" — two rules of equal specificity both appear here and only one of them paints. Where
 * the cascade is the claim, assert {@link computed} instead; a token-valued declaration has no
 * choice, because happy-dom leaves any value containing `var()` empty in `getComputedStyle`, and
 * every test that settles for text says so.
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

describe("jx-divider", () => {
  test("draws one hr the platform already announces as a separator", async () => {
    const el = await divider();
    expect(rule(el).tagName).toBe("HR");
    expect(rule(el).getAttribute("role")).toBe("separator");
    expect(rule(el).getAttribute("aria-orientation")).toBe("horizontal");
    expect(el.children).toHaveLength(1);
  });

  test("the hairline is the RULE's border, and the UA's own hr box is zeroed first", async () => {
    /* `<hr>` arrives with a UA `border: 1px inset` and a `0.5em auto` margin. Both have to go, or
       the divider draws a three-sided groove with half a line of space inside the element's own
       margin — the recipe zeroed exactly these, and this is that zeroing moved onto the part.

       DECLARATION TEXT ONLY. Every value here is either `0` (indistinguishable in happy-dom from
       the property's own initial value) or token-valued, and happy-dom resolves no `var()`, so the
       assertion below proves the declaration is written and not that it paints. What it paints was
       measured instead — Chrome 152, DPR 1.5, both forms on one page, the deleted `& .jx-divider`
       recipe hand-restored as the control: in a 200px column stack the control `hr.jx-divider` is
       200 x 0.67 with `border-top-width: 0.666667px` and `margin: 2px 0px`, and the element's
       `[part="rule"]` is 200 x 0.67 with the same border and `margin: 0px` — the 2px moved to the
       host, and the next row sits 2.67px below the divider's top edge in BOTH. */
    const el = await divider();
    const r = rulesOf(el).get('& > [part="rule"]') ?? "";
    expect(r).toContain("margin: 0");
    expect(r).toContain("border: 0");
    expect(r).toContain("border-top: 1px solid var(--jx-border)");
  });

  test("the HOST owns the spacing and refuses to be flexed, as the recipe's hr did", async () => {
    /* `flex: none` and the margin were declarations about the hr's relationship to the container
       it sat in. The host is the thing in that position now, so they belong to the host: without
       `flex: none` a menu tall enough to overflow squeezes the hairline out of existence, and
       without the margin the rule sits flush against the rows on either side of it.

       `flex: none` is asserted through the CASCADE (`flex-shrink` computes 0; the initial value is
       1), so deleting it reddens this test. The margin is token-valued and can only be text —
       measured in Chrome 152 instead: control `hr.jx-divider` and the element host both compute
       `margin: 2px 0px` horizontally and `0px 2px` vertically, and both stacks measure
       200 x 44.67.

       `display: block` is the one declaration in this document that NOTHING can pin, and the
       reason is that it changes nothing: the runtime writes `display: block` into a custom
       element's base rule when the definition declares none, so deleting the key emits a
       byte-identical sheet (verified by diffing `documentStyleText()` either way). It is kept
       because it is what makes `conformance.test.ts`'s "a host that declares its own display"
       gate apply to this document at all, and because a reader of the JSON should not have to know
       the runtime's default to know the host is a block. */
    const el = await divider();
    const base = rulesOf(el).get("&") ?? "";
    expect(base).toContain("display: block");
    expect(base).toContain("flex: none");
    expect(base).toContain("margin: var(--jx-space-1) 0");
    expect(computed(el, "display")).toBe("block");
    expect(computed(el, "flexShrink")).toBe("0");
  });

  test("vertical turns the rule and makes the host a box exactly as wide as it", async () => {
    /* The branch moved from `[aria-orientation="vertical"]` on the hr to `&[orientation]` on the
       host, so the host has to stop being a plain block: a block box does not stretch to a
       toolbar's height, and a hr inside one has no height to inherit. `display: flex` gives the
       host a box whose width is the hairline's own 1px and whose height is the toolbar's, and the
       rule stretches inside it.

       Measured in Chrome 152 at DPR 1.5 (so a 1px hairline reads 0.67), a 28px flex toolbar with
       both forms on one page, the deleted recipe hand-restored as the control:

         control hr.jx-divider[aria-orientation="vertical"]   0.67 x 28 at x 44.67
         element host                                          0.67 x 28 at x 44.67
         element [part="rule"]                                 0.67 x 28 at x 44.67
         the button after it, control / element                x 49.33 / x 49.33

       The host adds nothing: it is coincident with the hairline and the neighbour does not move.

       `display: contents` measures the same and was rejected: it leaves the host with ZERO client
       rects (measured), so the Studio canvas has no box to select or drop onto, and a `contents`
       box has no margin either, which would push the spacing back onto the rule and split one
       contract over two boxes. `display` and `align-self` are asserted through the cascade below,
       so swapping `flex` for `contents` reddens this test rather than passing it. */
    const el = await divider({ orientation: "vertical" });
    const r = rulesOf(el);
    const branch = r.get('&[orientation="vertical"]') ?? "";
    expect(branch).toContain("display: flex");
    expect(branch).toContain("align-self: stretch");
    expect(branch).toContain("margin: 0 var(--jx-space-1)");
    expect(computed(el, "display")).toBe("flex");
    expect(computed(el, "alignSelf")).toBe("stretch");
    /* Token-valued, so text only; the border swap is what turns the hairline through 90 degrees. */
    const ruleBranch = r.get('&[orientation="vertical"] > [part="rule"]') ?? "";
    expect(ruleBranch).toContain("border-top: 0");
    expect(ruleBranch).toContain("border-left: 1px solid var(--jx-border)");
    expect(rule(el).getAttribute("aria-orientation")).toBe("vertical");
  });

  test("orientation REFLECTS, so the branch is reachable through the property door too", async () => {
    /* The styling branch keys on the host's own attribute, and `$props` in a Jx document sets the
       PROPERTY. Without the reflection a `$props: { orientation: "vertical" }` divider would
       announce itself vertical and draw itself horizontal — the aria and the border would
       disagree, with every rule above still passing. */
    const el = await divider();
    expect(el.getAttribute("orientation")).toBe("horizontal");
    el.orientation = "vertical";
    await tick();
    expect(el.getAttribute("orientation")).toBe("vertical");
    expect(rule(el).getAttribute("aria-orientation")).toBe("vertical");
    expect(computed(el, "display")).toBe("flex");
    el.setAttribute("orientation", "horizontal");
    await tick();
    expect(el.orientation).toBe("horizontal");
    expect(computed(el, "display")).toBe("block");
  });

  test("hidden hides it in BOTH orientations, which took a second rule to be true", async () => {
    /* The recipe got this free: `& .jx-divider` declared no `display`, so the UA's
       `[hidden] { display: none }` stood in either orientation. The element declares a display, so
       it has to re-state hiding — and `&[hidden]` alone is not enough. `&[hidden]` and
       `&[orientation="vertical"]` are both `[data-jx="…"][attr]`, specificity (0,2,0), and
       `buildStyleRules` emits nested blocks in key order, so the vertical branch's `display: flex`
       landed after the guard and beat it. `&[orientation="vertical"][hidden]` is (0,3,0) and wins
       wherever it is written, which is why the fix is a second rule rather than a re-ordering: a
       later branch added to this style block cannot silently take the hiding away again. The kit
       re-asserts hiding after a later display rule in the same way in `jx-menu`, `jx-popover` and
       `jx-tooltip` (`&[hidden]:popover-open`).

       Measured in Chrome 152, a 28px flex toolbar, both forms on one page:

                                                    display   client rects   next button
         control hr.jx-divider[…vertical][hidden]   none      0              x 42.67
         element, guard absent                      flex      1              x 49.33  (0.67 x 28 painted)
         element, guard present                     none      0              x 42.67

       Both `getComputedStyle` assertions below resolve through the cascade, so deleting either
       rule — or moving `&[hidden]` back behind a later `display` — reddens this test. */
    const horizontal = await divider();
    expect(rulesOf(horizontal).get("&[hidden]")).toBe("display: none");
    horizontal.hidden = true;
    await tick();
    expect(computed(horizontal, "display")).toBe("none");

    const vertical = await divider({ orientation: "vertical" });
    expect(rulesOf(vertical).get('&[orientation="vertical"][hidden]')).toBe("display: none");
    vertical.hidden = true;
    await tick();
    expect(computed(vertical, "display")).toBe("none");
  });

  test('only "vertical" turns it; every other value is the horizontal hairline', async () => {
    /* The state entry documents a two-value vocabulary and the style branch is the only reader of
       it, so an unknown value has to fall back to the base rule rather than to nothing — the same
       contract `jx-dot` states for `tone`. Parity note, deliberately unchanged from the recipe:
       ARIA enumerated values are ASCII case-INsensitive while a CSS attribute selector on a
       non-HTML attribute is case-SENSITIVE, so `orientation="Vertical"` announces vertical and
       draws horizontal. `.jx-divider[aria-orientation="vertical"]` had the identical split, so
       normalising here would be a behaviour change rather than a fix, and it is recorded rather
       than silently carried. */
    const el = await divider({ orientation: "diagonal" });
    expect(rulesOf(el).get('&[orientation="diagonal"]')).toBeUndefined();
    expect(computed(el, "display")).toBe("block");
    expect(rule(el).getAttribute("aria-orientation")).toBe("diagonal");
  });
});
