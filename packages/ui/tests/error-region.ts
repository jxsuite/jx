/**
 * The empty error region's contract, which `jx-textfield`, `jx-select` and `jx-combobox` share and
 * all three test files hold against their own emitted `[part="error"]:empty` rule.
 *
 * The region is permanent: it is in the tree, empty, from the first render, because a live region
 * announces nothing unless it was there before its text arrived (ui.md §5.1). So while it is empty
 * it must be INERT, and inert by construction rather than by every consumer's good manners. The kit
 * is light DOM, so any ancestor's descendant rule on `[part="error"]` reaches this paragraph, and a
 * 0×0 border-box floors at padding plus border. Studio's Source Control banner rule measured 16×13
 * in Chrome over the branch picker's corner and took the click meant for the control. Pinning the
 * size was therefore never enough; the rule also resets the box model and removes paint and hit
 * area outright.
 *
 * Happy-dom computes no cascade, so this holds the RULE, not the pixel. The pixel was measured in
 * Chrome: with a rule of this shape placed FIRST in the adopted sheets, all six live regions went
 * to 0×0, transparent and missing from `elementFromPoint`, which is the specificity claim too.
 */
import { expect } from "bun:test";

/** Every declaration the empty region needs to draw nothing and take no click. */
export const INERT_WHILE_EMPTY = [
  "position: absolute",
  "top: 0",
  "left: 0",
  "width: 0",
  "height: 0",
  "overflow: hidden",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "background: none",
  "clip-path: inset(50%)",
  "pointer-events: none",
] as const;

/**
 * Hold one element's emitted `[part="error"]:empty` rule to the contract: every inert declaration,
 * and nothing that would take the live region out of the accessibility tree.
 */
export function expectInertWhileEmpty(rule: string): void {
  expect(rule).toContain('[part="error"]:empty');
  for (const declaration of INERT_WHILE_EMPTY) {
    expect(rule).toContain(declaration);
  }
  // A live region the accessibility tree cannot see does not announce its first text.
  expect(rule).not.toContain("display: none");
  expect(rule).not.toContain("visibility");
}
