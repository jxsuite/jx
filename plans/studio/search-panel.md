---
status: stub
disposition: implement
claims:
  - studio.md#5.1
size: M
workspaces:
  - packages/studio
---

# The Search panel exists and can be reached, and the rail table names the icons it draws

## Context

`specs/studio.md` §5.1, line 313 (the section was unmarked before the census):

> **Status: Partial.** The level-grouped rail, the rail-less Insert and Languages panels and the bottom-anchored Settings menu ship (`packages/studio/src/panels/navigator-panels.ts`, `panels/settings-menu.ts`). Search does not: its record is registered with `when: NOT_YET_BUILT` and a placeholder render, so there is no Search surface to reach. The Icon column is stale: the records use `stack`, `file`, `database` and `cube` for Outline, Page, Data and Packages.

Two parts under one anchor, so one plan holds both: the Search panel is an `implement`; the Icon column is a reconcile, because the records' glyphs are the kit's names and the table predates them. Disposition `implement` for the plan as a whole.

**What exists**

- `registerNavigatorPanels` in `packages/studio/src/panels/navigator-panels.ts`: a `search` record (project level, `icon: "magnifying-glass"`, `when: NOT_YET_BUILT`, a `nothingYet()` render), and the comment "Surfaces the design has declared and the app has not built. Registered, hidden, budgeted."
- The panel records' icons: `stack` (`panels/layers-panel.ts`), `file` (`panels/head-panel.ts`), `database` (`panels/data-explorer.ts`), `cube` (`panels/imports-panel.ts`).
- The palette's quick search (`packages/studio/src/panels/quick-search.ts`), which finds commands and files by name but not text inside documents.

**What is missing**

- A contract for Search: no section of any spec says what it searches (text across project documents, element and state names, or both), how results address a node (a path and a `JxPath`), or which backend call answers it. The detail phase writes that contract here, or, if Search is not wanted, the disposition becomes `remove` and §5.1 drops it from the rail-less list.
- The panel itself, its region and a live `panel.focus.search`.
- §5.1's Icon column corrected to the four glyph names.

**Related**

- studio.md §13.4 (panel records and `panel.focus.*`), studio-ui-guidelines.md §12.1 (the rail's budget), studio.md §9.1.2 (the Library, the other project-wide browsing surface).
