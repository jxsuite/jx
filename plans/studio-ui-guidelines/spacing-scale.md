---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#7
size: S
workspaces:
  - packages/studio
---

# Spacing is specified as the kit's space scale, with the one off-scale step decided

## Context

`specs/studio-ui-guidelines.md` §7, line 403:

> **Status: Partial.** The premise is stale: the kit ships `--jx-space-1` to `--jx-space-7` (2/4/8/12/16/24/32px, `ui.md` §4), and surfaces spell most gaps and padding through it. The 6px horizontal gap is off that scale and written as a literal, and section padding in `packages/studio/src/surfaces/properties-panel.json` is `0 var(--jx-space-2) var(--jx-space-2)`, not `4px 8px`.

Disposition `reconcile`: the scale is the kit's contract (`ui.md` §4.3), the surfaces already use it (`var(--jx-space-2)` about 180 times and `--jx-space-3` about 170 times across `src/surfaces/*.json`), and a Studio-side table of loose pixel values is the second list of one fact.

**What exists**

- `packages/ui/project.json`: `--jx-space-1` 2px through `--jx-space-7` 32px.
- Surfaces spelling gaps and padding through the scale, e.g. `packages/studio/src/surfaces/properties-panel.json` (section padding `0 var(--jx-space-2) var(--jx-space-2)`) and `style-panel.json` (the 16px child indent as `--jx-space-5`).
- 29 literal `"gap": "6px"` declarations across `packages/studio/src/surfaces/*.json`.

**What is missing**

- §7's premise and table rewritten as the scale steps each context uses (or reduced to a pointer at `ui.md` §4.3 plus the Studio-specific usages).
- A decision on 6px: adopt it as a named Studio alias, or move those gaps to 4px or 8px on the scale. The second is a visual change the screenshot lane re-captures; the first is a table row.
- The table's `.style-row` usage note renamed with the row vocabulary, which `plan:studio-ui-guidelines/form-row-part-vocabulary` owns.

**Related**

- `ui.md` §4.3 (scales).
- `packages/studio/scripts/check-styles.ts`, whose token nudge is where a spacing rule would be enforced if detailing wants one.
