/**
 * The `sm` size and the sub-control targets meet WCAG 2.2 SC 2.5.8 (Target Size, Minimum) by hit
 * area rather than by picture (specs/ui.md §4.3, #324).
 *
 * `--jx-control-h` is the floor and `conformance.test.ts` holds it at 24px per density. An
 * element's own `size="sm"` draws 4px under that token, and Studio declares it some 450 times, so
 * its toolbars were 20px targets at the default density. The criterion measures the REGION THAT
 * ACCEPTS THE POINTER, not the paint, which is what makes jx-tab's close-button technique an
 * answer: an empty `::before`, absolutely positioned and inset past the box, is part of the
 * control's hit area and none of its picture. These tests read the emitted sheet, as
 * `theme.test.ts` reads the theme, and do the arithmetic against the theme's own values, so a
 * density that moved the token or a component that trimmed the inset would fail here with the
 * number that broke.
 */
import { describe, expect, test } from "bun:test";

import { buildStyleRules } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { themeTokens } from "../src/theme.ts";

/** The criterion's number, in CSS pixels. */
const FLOOR = 24;

/** Every rule an element's style block emits, under a stand-in scope handle. */
const sheet = (tag: string): string[] =>
  buildStyleRules(documents[tag]!.style as JxStyle, { scope: "S" }).map((emitted) => emitted.text);

/** The one emitted rule whose selector is exactly `selector` (the handle spelled `S`). */
function rule(tag: string, selector: string): string {
  const found = sheet(tag).find((text) => text.startsWith(`${selector} {`));
  expect(found, `${tag} emits no rule for ${selector}`).toBeDefined();
  return found!;
}

/**
 * The pixel width of the border a control rule draws, 0 when it declares `border: 0` or nothing. An
 * absolutely positioned pseudo-element is offset from its containing block's PADDING edge, so a
 * bordered control's `inset` reaches the drawn box only after it has crossed the border: the reach
 * past the picture is the outset minus this, and the arithmetic below subtracts it. Written after
 * `inset: -2px` on jx-button's 1px-bordered control measured 22px in Chrome while this file said 24
 * (#324 review); jx-tab's close button, the model, is borderless, which is why its -4px was exact
 * and why the number did not carry over.
 */
function borderWidth(ruleText: string): number {
  const m = /\bborder: (\d+)px\b|\bborder: 0\b/.exec(ruleText);
  expect(m, `no border declaration in ${ruleText}`).not.toBeNull();
  return Number(m![1] ?? 0);
}

/** `--jx-control-h` at the root and under every density the theme declares, as numbers. */
function controlHeights(): [string, number][] {
  const densities = Object.entries(themeTokens).filter(([key]) =>
    key.startsWith("&[data-density="),
  ) as [string, Record<string, unknown>][];
  return [[":root", themeTokens] as const, ...densities].map(([label, block]) => {
    const declared = String(block["--jx-control-h"] ?? themeTokens["--jx-control-h"]);
    return [label, Number(/^(\d+(?:\.\d+)?)px$/.exec(declared)![1])];
  });
}

describe("size=sm controls accept the pointer over the kit's control height (SC 2.5.8)", () => {
  /* The three elements whose `sm` branch shrinks the control box itself: the two buttons, and the
     checkbox, whose control is the label the reader clicks. jx-switch and jx-swatch keep their
     control at `--jx-control-h` at every size (asserted below), so they carry no pseudo-element.
     The border is the button's 1px and the label's none, and it is what separates their insets:
     the pseudo-element is offset from the padding edge, so a bordered control owes its border
     width on top of the 2px reach. */
  const SHRUNK = [
    ["jx-button", 1],
    ["jx-action-button", 1],
    ["jx-checkbox", 0],
  ] as const;

  for (const [tag, border] of SHRUNK) {
    test(`${tag}'s sm control draws 4px under the token and hits 4px over the picture`, () => {
      const control = rule(tag, 'S[data-size="sm"] > [part="control"]');
      expect(control).toContain("min-height: calc(var(--jx-control-h) - 4px)");
      const base = rule(tag, 'S > [part="control"]');
      expect(base.includes("border:") ? borderWidth(base) : 0, `${tag}'s control border`).toBe(
        border,
      );
      /* The pseudo-element is the hit area: content so it generates a box, absolute so it takes
         no layout, and an inset that is negative on every side so it lies OUTSIDE the box — by
         the border first, then by half of the 4px the box is under. */
      const hit = rule(tag, 'S[data-size="sm"] > [part="control"]::before');
      expect(hit).toContain('content: ""');
      expect(hit).toContain("position: absolute");
      expect(hit).toContain(`inset: -${border + 2}px`);
      /* Which measures against the control, so the control must be positioned — in the sm branch
         or already in the base rule, as jx-action-button's is for its badge. */
      const positioned = [control, rule(tag, 'S > [part="control"]')].some((text) =>
        text.includes("position: relative"),
      );
      expect(positioned, `${tag}: the sm control is not position: relative`).toBe(true);
      /* And the control keeps that reach to itself: an absolutely positioned box counts toward the
         SCROLLABLE overflow of the nearest ancestor whose `overflow` is not `visible`, painted or
         not, so an uncontained outset on a button touching a scroller's edge draws a 2px phantom
         scrollbar. jx-button shipped the containment and jx-action-button did not, which is how
         Preferences · Keyboard grew one; pinned here for all three so the next gap fails by name. */
      expect(control, `${tag}: the sm hit area is not layout-contained`).toContain(
        "contain: layout",
      );
    });

    test(`${tag}'s sm hit area is at least ${FLOOR}px at every density`, () => {
      /* All three numbers are READ off the emitted rules rather than assumed: the shrink from the
         control's `min-height`, the outset from the pseudo-element's `inset`, and the border from
         the base control rule (the sm rule redeclares none), so a document that trimmed the inset
         or grew the border fails here with the number that broke rather than passing on the
         arithmetic this file would otherwise have written for it. Against every density's token,
         the same values the density gate reads. */
      const control = rule(tag, 'S[data-size="sm"] > [part="control"]');
      expect(control).not.toContain("border");
      const shrink = Number(
        /min-height: calc\(var\(--jx-control-h\) - (\d+)px\)/.exec(control)![1],
      );
      const outset = Number(
        /inset: -(\d+)px/.exec(rule(tag, 'S[data-size="sm"] > [part="control"]::before'))![1],
      );
      const base = rule(tag, 'S > [part="control"]');
      const drawnBorder = base.includes("border:") ? borderWidth(base) : 0;
      /* What the pseudo-element reaches past the DRAWN box: the inset less the border it crosses
         first. 2px for all three today, from a -3px inset over 1px and a -2px inset over none. */
      const reach = outset - drawnBorder;
      expect(reach, `${tag}: -${outset}px past a ${drawnBorder}px border`).toBe(2);
      for (const [label, height] of controlHeights()) {
        const drawn = height - shrink;
        const hit = drawn + 2 * reach;
        expect(hit, `${tag} at ${label}: ${drawn}px drawn, ${hit}px hit`).toBeGreaterThanOrEqual(
          FLOOR,
        );
      }
    });
  }

  test("jx-switch's sm branch scales the track and leaves the label at the control height", () => {
    /* The label is the target and its `minHeight` is the token in the base rule; the `sm` rule
       reaches only the input. Pinned so a later `sm` shrink of the label would land here. */
    expect(rule("jx-switch", 'S > [part="control"]')).toContain("min-height: var(--jx-control-h)");
    expect(
      sheet("jx-switch").some((text) => text.startsWith('S[data-size="sm"] > [part="control"]')),
    ).toBe(false);
  });

  test("jx-swatch's sm branch shrinks the chip and not the button", () => {
    expect(rule("jx-swatch", 'S[data-size="sm"]')).toContain("--jx-swatch-size: 14px");
    const control = rule("jx-swatch", 'S > [part="control"]');
    expect(control).toContain("min-inline-size: var(--jx-control-h)");
    expect(control).toContain("min-block-size: var(--jx-control-h)");
  });

  test("a compact action group zeroes the extension on the axis its members touch", () => {
    /* Two boxes that touch leave an extension nowhere to go but over the neighbour, where the
       later sibling paints above the earlier one and would take its edge's clicks — and the
       criterion gives an overlapped strip to the target on top, so the earlier button would lose
       it for nothing. The cross axis keeps its 2px. */
    const row = rule(
      "jx-action-group",
      'S[data-compact] > jx-action-button[data-size="sm"] > [part="control"]::before',
    );
    expect(row).toBe(
      'S[data-compact] > jx-action-button[data-size="sm"] > [part="control"]::before { inset-inline: 0 }',
    );
    const column = rule(
      "jx-action-group",
      'S[data-compact][data-orientation="vertical"] > jx-action-button[data-size="sm"] > [part="control"]::before',
    );
    /* The vertical variant's inline value is the button's own inset, -3px, so the cross axis
       still reaches 2px past the drawn box once the 1px border is crossed; `0` on the packed axis
       is the padding edge, and the button's own box takes the pointer over the border pixel. */
    expect(column).toContain("inset-inline: -3px");
    expect(column).toContain("inset-block: 0");
    /* And the default group's gap is 2px, so two extended members overlap by 2px; the later one
       keeps the strip under the criterion's overlap rule and every member but the last counts
       22px, under the floor — the non-claim §11 names, so the number is pinned. A 4px gap here
       would make them 24 and move every group in Studio by 2px a member (§4.3). */
    expect(rule("jx-action-group", "S")).toContain("gap: var(--jx-space-1)");
    expect(themeTokens["--jx-space-1"]).toBe("2px");
    /* The 4px gap of jx-toolbar is where two extended neighbours abut with nothing lost. */
    expect(rule("jx-toolbar", "S")).toContain("gap: var(--jx-space-2)");
    expect(themeTokens["--jx-space-2"]).toBe("4px");
  });
});

describe("the sub-control targets inside a field accept the pointer over the control height", () => {
  /* The clear button of jx-textfield and the toggle of jx-combobox each sit inside the field's
     1px border and draw 2px under the field's height: 22px in a 24px field, 18px in a small one.
     The inset is half the difference between that box and `--jx-control-h`, so the hit area is
     the token at every size the field takes — exactly, because both buttons draw `border: 0`
     (asserted below): the inset is measured from the padding edge, and on a borderless box that
     is the drawn edge. */
  const INSIDE = [
    ["jx-textfield", "clear", "--jx-textfield-h", "position: absolute"],
    ["jx-combobox", "toggle", "--jx-combobox-h", "position: relative"],
  ] as const;

  for (const [tag, part, height, positioned] of INSIDE) {
    test(`${tag}'s ${part} button carries a hit area of the control height`, () => {
      const box = rule(tag, `S [part="${part}"]`);
      expect(box).toContain(`width: calc(var(${height}) - 2px)`);
      expect(box).toContain(`height: calc(var(${height}) - 2px)`);
      expect(box).toContain(positioned);
      expect(borderWidth(box), `${tag} ${part}: the calc inset is exact only over no border`).toBe(
        0,
      );
      /* The outset reaches past the field's edge at `sm`, so the button contains its layout for
         the reason the sm controls above do: a scrolling host would count the reach as overflow. */
      expect(box, `${tag} ${part}: the hit area is not layout-contained`).toContain(
        "contain: layout",
      );
      const hit = rule(tag, `S [part="${part}"]::before`);
      expect(hit).toContain('content: ""');
      expect(hit).toContain("position: absolute");
      expect(hit).toContain(`inset: calc((var(${height}) - 2px - var(--jx-control-h)) / 2)`);
    });

    test(`${tag}'s ${part} button is at least ${FLOOR}px at every size and density`, () => {
      /* The field's own sizes, as its sheet declares them relative to the token. */
      const sizes: [string, (token: number) => number][] = [
        ["md", (token) => token],
        ["sm", (token) => token - 4],
        ["lg", (token) => token + 8],
      ];
      expect(rule(tag, 'S[data-size="sm"]')).toContain(
        `${height}: calc(var(--jx-control-h) - 4px)`,
      );
      expect(rule(tag, 'S[data-size="lg"]')).toContain(
        `${height}: calc(var(--jx-control-h) + 8px)`,
      );
      for (const [label, token] of controlHeights()) {
        for (const [size, fieldHeight] of sizes) {
          const drawn = fieldHeight(token) - 2;
          const inset = (drawn - token) / 2;
          /* A positive inset draws the pseudo-element inside a box already over the floor, so the
             hit area is the box; a negative one extends it to the token. */
          const hit = inset < 0 ? drawn - 2 * inset : drawn;
          expect(
            hit,
            `${tag} ${part} at ${label} size ${size}: ${drawn}px drawn, ${hit}px hit`,
          ).toBeGreaterThanOrEqual(FLOOR);
        }
      }
    });
  }

  test("the targets the technique does not reach are the ones §11 still names", () => {
    /* Every native input or select is a replaced element and renders no pseudo-element, so an `sm`
       FIELD's own box stays 20px: these four size the control through a custom property on the
       host and carry no `::before` for it. jx-number-field's steppers stack two 12px buttons in one
       control height, touching, so an extension of either could only cover the other; the input
       beside them takes the same step by arrow key and typed value, which is the criterion's
       Equivalent exception. jx-split's 5px hairline would need a 9.5px strip over each pane's
       edge, which in Studio is the Navigator's scrollbar — a decision the spec records rather
       than a rule this file writes. Pinned so that a change to any of them is a change to §11. */
    for (const [tag, height] of [
      ["jx-textfield", "--jx-textfield-h"],
      ["jx-combobox", "--jx-combobox-h"],
      ["jx-select", "--jx-select-h"],
    ] as const) {
      expect(rule(tag, 'S[data-size="sm"]')).toContain(
        `${height}: calc(var(--jx-control-h) - 4px)`,
      );
      expect(sheet(tag).some((text) => text.startsWith('S[data-size="sm"]::before'))).toBe(false);
    }
    expect(rule("jx-number-field", 'S[data-size="sm"] [part="input"]')).toContain(
      "min-height: calc(var(--jx-control-h) - 4px)",
    );
    const steppers = rule("jx-number-field", 'S [part="step-up"], S [part="step-down"]');
    expect(steppers).toContain("flex: 1 1 0");
    expect(sheet("jx-number-field").some((text) => text.includes("::before"))).toBe(false);
    const split = rule("jx-split", "S");
    expect(split).toContain("inline-size: 5px");
    expect(sheet("jx-split").some((text) => text.includes("::before"))).toBe(false);
  });
});
