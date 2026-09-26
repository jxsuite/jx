---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#12.1
size: M
workspaces:
  - packages/studio
---

# Every placement in the matrix has a renderer that reads it: the outline's menu, the pane menu and the status bar's three fields

## Context

`specs/studio-ui-guidelines.md` §12.1, line 744:

> **Status: Partial.** The matrix ships as `PLACEMENT_MATRIX` and `PANEL_PLACEMENT_MATRIX` (`packages/studio/src/commands/levels.ts`), checked by `scripts/check-command-levels.ts` and by `registerPanel()`. Five rows reach no renderer that reads them: the outline's right-click (`src/panels/layers-panel.ts`) draws `context/element` rather than `context/layer`; the pane context bar's preset menu (`src/panels/pane-context.ts`), the one renderer of `context/pane`, builds its rows by id for `pane.derive`, `pane.pin` and `pane.unsplit`, so `pane.splitRight` and `pane.compareWith` declare the placement and are never drawn there; and the status bar picks its items by command id (`src/surfaces/statusbar.ts`) rather than projecting its three placements, of which no record declares `statusbar/selection`.

**What exists**

- `packages/studio/src/commands/levels.ts`: `PLACEMENT_MATRIX` (row for row with the table), `PANEL_PLACEMENT_MATRIX`, `checkPlacements`; `scripts/check-command-levels.ts` in the `checks` job.
- `context/layer`: declared by two records in `packages/studio/src/commands/defaults.ts` (both also declare `context/element`). The outline's `contextMenu` host callable in `src/panels/layers-panel.ts` calls `showContextMenu(event, path, …)` with no placement, and `src/editor/context-menu.ts` asks `forPlacement("context/element")`. The records reach the outline only because they declare both.
- `context/pane`: five records declare it, `pane.splitRight`, `pane.compareWith` and `pane.unsplit` in `packages/studio/src/workspace/workspace.ts` and `pane.derive` and `pane.pin` in `src/workspace/pane-derive.ts`. Its one renderer is the preset menu in `src/panels/pane-context.ts` ("the first renderer of `context/pane`"), whose `presetRows()` builds rows by literal id for `pane.derive`, `pane.pin` and `pane.unsplit` and never calls `forPlacement`. No pane right-click exists. `pane.splitRight` and `pane.compareWith` are drawn only through `context/tab` and the palette.
- Status bar: `packages/studio/src/surfaces/statusbar.ts` builds its items as `{ command, label }` pairs by id (`project.openRecent`, `project.open`, `panel.focus.git`, `view.setBottomTab`, `collab.showStatus`, `file.save`, `palette.openFiles`) and renders a button when the registry has the command. Its header cites the three `statusbar/*` placements as what makes the bar's mixed levels structural, but it never calls `forPlacement`. Four records declare `statusbar/project` or `statusbar/document`; none declares `statusbar/selection`.

**What is missing**

- The outline's right-click draws `forPlacement("context/layer")` (the Outline-specific rows) through the same menu surface, with `context/element` records the outline should show also declaring `context/layer`.
- `context/pane` read as a placement: either the preset menu (or a pane context menu) projects `forPlacement("context/pane")` beside its preset rows, or `pane.splitRight` and `pane.compareWith` drop the placement they are never drawn in. `pane-derive.ts` already records why a declared-and-never-drawn placement is a defect.
- The status bar's command-bearing items drawn from `forPlacement("statusbar/project" | "statusbar/document" | "statusbar/selection")`, so the level check actually gates what the bar shows; the items that are state readouts rather than commands stay as they are. Which of the bar's items are placements and which are ambient state is the design decision detailing records.
- If detailing decides a placement should not have a renderer after all, its row leaves the table and `PLACEMENT_MATRIX` together (the §12.1 rule that the table is normative and `levels.ts` mirrors it), and that part becomes a reconcile.

**Related**

- `studio.md` §13 (command registry), §13.2 (levels), §16.2 (the status bar carries ambient state only).
- `studio-ui-guidelines.md` §12.5 (a second list of actions), which the status bar's hand-picked ids come close to.
