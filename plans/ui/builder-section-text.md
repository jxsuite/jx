---
status: stub
disposition: reconcile
claims:
  - ui.md#5.5
size: S
---

# §5.5's prose about Studio says what Studio does now

## Context

`specs/ui.md` §5.5, line 284 (excerpt):

> **Status: Partial.** … none is built: two are folded onto elements that exist and three are dropped, each for the reason its row gives. Two sentences of the prose below say something the code does not: the audit paragraph says `panels/style-panel.ts` parses `var()` with a private regex beside `style/token-ref.ts`, where it imports `resolveTokenValue`, `toTokenRef` and `tokenRefName` from that module (`packages/studio/src/panels/style-panel.ts`), as the `jx-token-field` row already says; and the `jx-breakpoint-bar` row names `jx-split`'s side of the Edit column's snapping a "snap hook", where the paragraph on handles says the element's answer is not a snap hook but a modifier report, which is what `src/behaviors/split.ts` ships.

Disposition `reconcile`. Every element §5.5 specifies ships and is adopted, and the five builder rows are folded or dropped rather than pending. What is stale is two present-tense sentences about Studio, and in each case another sentence in the same section already says what ships.

**What exists**

- The elements:
  - `packages/ui/components/jx-tree.json`, `jx-tree-item.json`, `jx-toolbar.json` and `jx-split.json`
  - `packages/ui/src/behaviors/tree.ts`, `toolbar.ts` and `split.ts`
  - `packages/ui/tests/jx-tree.test.ts`, `toolbar.test.ts` and `split.test.ts`
- Studio's side: `packages/studio/src/ui/panel-resize.ts` (the dock edges) and `packages/studio/src/canvas/edit-width-drag.ts` (the Edit column).
- The `var()` grammar: `packages/studio/src/panels/style-panel.ts:115` imports `resolveTokenValue`, `toTokenRef` and `tokenRefName` from `../style/token-ref`. The only regex left in the panel is `UNIT_RE`, from `ui/unit-selector.ts`, which parses a length rather than a `var()`.
- The modifier report: `announce(host, modifiersOf(event), "input", "change")` in `packages/ui/src/behaviors/split.ts`. §5.5's paragraph on handles (line 316) states it, and the `jx-breakpoint-bar` row (line 328) still says "snap hook".

**What is missing**

- The audit paragraph's (line 320) closing clause rewritten so that it records the grammar duplication as closed by `style/token-ref.ts`. It currently reports that duplication as still open.
- The `jx-breakpoint-bar` row's "`jx-split`'s snap hook and modifier state" rewritten to the modifier report the handles paragraph describes.
- The marker reduced to its evidence and flipped to Implemented.

**Related**

- ui.md §5 (the catalogue marker points here), ui.md §3.3 (the behaviour list, `plan:ui/behaviour-list-text`, which cites §5.5's decisions).
- studio.md, for the Edit column's snapping and the style panel's token rows.
