---
status: stub
disposition: implement
claims:
  - ui.md#5.1
size: S
workspaces:
  - packages/ui
  - packages/studio
---

# A one-of-N menu announces its rows as menuitemradio, and jx-menu-group waits for a menu that needs a heading

## Context

`specs/ui.md` §5.1, line 150 (the marker is long; the open clause is):

> **Status: Partial.** … — and `jx-menu-group` is pending, as is the `menuitemradio` row the table below gives `jx-menu-item`, whose `role` maps `checked` to `menuitemcheckbox` and everything else to `menuitem` (`components/jx-menu-item.json`); three of Studio's menus are one-of-N choices announced as checkboxes for want of it, the tab strip's hidden-tabs menu (`packages/studio/src/panels/tab-strip.ts`) and the two Value source menus (`panels/properties-panel.ts`, `ui/schema-form.ts`). …

The catalogue rows at lines 177 and 178 promise a `menuitemradio` row and `jx-menu-group` ("`role="group"` labelled by its heading").

The two halves have different dispositions. This stub owns both because each anchor has one owner (see the audit record's spec-wide decisions).

- **The radio row is `implement`.** Three menus in two surfaces already project an exclusive choice through `checked`. `jx-menu-item` announces each of those rows as a `menuitemcheckbox`, which is the wrong role for an exclusive choice, because a checkbox tells the reader the other rows are independent. That clears the bar §5.5 sets for kit work, "the same contract is written in two surfaces". Each of the three menus is a single radio set, so none of them needs a group to scope its rows.
- **`jx-menu-group` is `defer`.** No surface has a group that needs a heading. Studio's menus mark a boundary with `dividerAbove`, a divider with no heading. The same pull request writes a `> **Status: Future.**` remainder for it on §5.1. If the detail phase finds the two halves landing in different pull requests, it splits them by `plans/README.md`'s rule.

**What exists**

- `packages/ui/components/jx-menu.json`, `packages/ui/src/behaviors/menu.ts` and `packages/ui/tests/menu.test.ts`.
- `packages/ui/components/jx-menu-item.json`:
  - line 95 is `"role": "${state.checked ? 'menuitemcheckbox' : 'menuitem'}"`.
  - `aria-checked` is `${state.checked || null}`.
- Studio's menu surface, `packages/studio/src/surfaces/menu.ts` and `menu.json`: a row's `checked` is `"true" | "false" | ""`, and there is no row kind.
- The one-of-N consumers, each passing `checked` for "this row is the current one":
  - `packages/studio/src/panels/tab-strip.ts:893`, the hidden-tabs overflow menu: `checked: id === pane.activeTabId`.
  - `packages/studio/src/panels/properties-panel.ts:901`, the "Value source" menu: `checked: rung === mode`.
  - `packages/studio/src/ui/schema-form.ts:689`, the same "Value source" menu in the schema form.
- The independent-toggle consumers, which stay checkboxes: `statedChecked` in `packages/studio/src/panels/tab-strip.ts`, which reads a command's stated value back out of its arguments.
- Nothing in `packages/ui` or `packages/studio/src` names `jx-menu-group` or `menuitemradio`.

**What is missing**

- The radio row:
  - A way for a row to say it is one of a set, for example a `checkable` or `kind` prop on `jx-menu-item`. Its `role` then maps to `menuitemradio` with `aria-checked`, while a stated independent value stays `menuitemcheckbox`.
  - The same field on Studio's menu row type in `surfaces/menu.ts`, passed through `surfaces/menu.json`.
  - The three menus above opting into it.
  - Menu tests covering the role and `aria-checked` for both kinds, and keyboard activation of a radio row.
- `jx-menu-group`: a `> **Status: Future.**` remainder on §5.1 naming it. Its catalogue row is kept as the entry that element will take when a menu needs a labelled group.

**Related**

- ui.md §5 (the catalogue marker names both), ui.md §5.5 (the bar for kit work), ui.md §7 (the menu keyboard), ui.md §11 (the WAI-ARIA row's menu pattern).
- studio-ui-guidelines.md §8.4 (menus), studio-ui-guidelines.md §12 (command and menu rendering).
