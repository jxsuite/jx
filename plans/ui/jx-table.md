---
status: stub
disposition: implement
claims:
  - ui.md#5.4
size: M
workspaces:
  - packages/ui
  - packages/studio
---

# jx-table ships in the shape §3.5 decides, and Studio's tables draw on it

## Context

`specs/ui.md` §5.4, line 255:

> **Status: Partial.** `jx-tabs`, `jx-tab`, `jx-tab-panel`, `jx-accordion-item` and `jx-action-group` are built, … `jx-accordion` is an element too (below). `jx-table` is not built, and §3.5 records the shape it must take, along with the shape it must never take. Three Studio surfaces draw a table of their own in its absence: `packages/studio/src/surfaces/panel-i18n.json` and `surfaces/settings-packages.json` as a native `<table>` and `surfaces/library-pane.json` as a `role="table"` grid of divs.

Disposition `implement`. The marker used to say `jx-table` "has no consumer", and the census found that is no longer true. §3.1 decides the kind of a box by how many definitions draw it, and three surfaces now draw a table.

**What exists**

- The contract is §3.5's first shape. `jx-table` declares `display: table` and `role="table"`. `jx-tr` declares `display: table-row` and `role="row"`. `jx-th` and `jx-td` declare `display: table-cell` with `role="columnheader"` and `role="cell"`.
- The Studio tables:
  - `panel-i18n.json`, line 378: a native `table part="parity"` whose header cells are `th scope="col"`.
  - `settings-packages.json`, line 317: a native `table part="table"`.
  - `library-pane.json`, around line 1103: a windowed `div part="table" role="table"` of `role="row"` and `role="cell"` divs. Its style `$description` explains why it is not a table component: "the rows have to be sliceable, and every table widget wants the whole set".
- Nothing named `jx-table`, `jx-tr`, `jx-th` or `jx-td` exists in `packages/ui` or `packages/studio`.

**What is missing**

- Four component documents under `packages/ui/components/`, with stylebook pages, conformance coverage, and a `jx-table` row in §5.4's catalogue table.
- A decision for each consumer. The two native tables are legal as they stand (§3.5 forbids only wrapping a native table), so adopting there is about sharing one look. The windowed library table is the case the element fits best, because its rows are children and can be sliced.
- If the detail phase finds that none of the three should adopt it, the disposition becomes `defer`, and the §5.4 marker gets a Future remainder that says why.

**Related**

- ui.md §3.1 (element versus part), ui.md §3.5 (host position and the table shapes), ui.md §11 (the WAI-ARIA row, which claims no table role yet).
