---
status: stub
disposition: implement
claims:
  - ui.md#4.1
size: S
workspaces:
  - packages/ui
---

# Every theme colour is a ramp step or a mix of one, and the theme test holds it

## Context

`specs/ui.md` §4.1, line 102:

> **Status: Partial.** The three layers ship: the ramp and the semantic tokens in `packages/ui/project.json`, and Studio's aliases in `packages/studio/styles/tokens.json`. Two claims do not match the theme: `--jx-bg-panel`, `--jx-bg-input`, `--jx-bg-overlay` and `--jx-switch-thumb` pair a raw `#ffffff`, `--jx-accent-fg` is a bare `#ffffff`, and `--jx-handler` and `--jx-map` are `light-dark()` pairs of hexes outside the ramp (`packages/ui/tests/theme.test.ts` holds every semantic colour but `accent-fg` and `accent-solid` to a `light-dark()`, `var()` or `color-mix()` value and refuses a ramp step copied as a raw hex, but nothing refuses a hex from outside the ramp inside a `light-dark()` pair); and `--jx-spin-color` and `--jx-spin-track-color` are not theme tokens at all but `jx-spinner`'s own override hooks, declared in `components/jx-spinner.json`.

Disposition `implement` for the hexes. The rule "none names a hex outside the ramp" is the design, and the ramp is the one place a colour is supposed to be tuned. The spinner half could be a text fix instead (see below).

**What exists**

- `packages/ui/project.json` has the offending values:
  - `#ffffff` in `--jx-bg-panel`, `--jx-bg-input` and `--jx-bg-overlay` (lines 72 to 74) and in `--jx-switch-thumb` (line 99)
  - a bare `#ffffff` in `--jx-accent-fg` (line 83)
  - `light-dark(#7c3aed, #c8a2e0)` in `--jx-handler` and `light-dark(#4f46b5, #8b83e6)` in `--jx-map` (lines 95 and 96)
- `packages/ui/tests/theme.test.ts` has two tests that bear on this:
  - Lines 114 to 131 hold every semantic colour to a value that starts `light-dark(`, `var(` or `color-mix(`. That test exempts `radius`, `focus-ring`, `font`, `accent-fg` and `accent-solid` (line 120). The exemption is why a bare `#ffffff` in `--jx-accent-fg` passes.
  - Lines 133 to 146 refuse a ramp step copied as a raw hex ("no ramp step is reused as a raw hex outside the ramp"). This test has no exemption.
  - Neither test refuses a hex that is not a ramp step inside a `light-dark()` pair, which is the shape of the other six values.
- `packages/ui/components/jx-spinner.json`, lines 57 to 60, declares `--jx-spin-color: currentColor` and `--jx-spin-track-color: var(--jx-border)` on the element. `--jx-popover-offset` and `--jx-field-label-w`, which sit beside them in §4.1's list, are theme tokens.
- The contrast gates that any value change must keep green: the per-scheme Studio pairs in `packages/studio/scripts/check-styles.ts`, and `packages/ui/tests/theme.test.ts`.

**What is missing**

- Ramp steps for what the hexes name: a white end for the neutral ramp, and violet and indigo steps (or mixes of existing steps) for the two syntax colours. The semantic tokens then reference those steps.
- The theme test tightened so that it refuses any hex in a semantic token, including one inside `light-dark()`, and the `accent-fg` exemption dropped from the shape test once that token names a ramp step.
- The spinner hooks decided. Either the theme declares them and the list is right, or §4.1's list drops them as element override hooks and the list was wrong. The 0.1.12 changelog entry reads "the spinner and popover override tokens join the semantic list". That does not settle it, because `--jx-popover-offset`, added by the same entry, is a theme token (`packages/ui/project.json:120`).

**Related**

- ui.md §4.2 (the declaration), ui.md §5.2 (`jx-spinner`), ui.md §11 (the CSS Color 5 row: "`light-dark()` for every semantic colour").
