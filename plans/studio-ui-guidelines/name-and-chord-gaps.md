---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#12.3
requires:
  - studio-ui-guidelines/git-panel-action-list
size: M
workspaces:
  - packages/studio
---

# The rail, the Bottom dock's close button and every context menu print each command's chord, and no surface renames or restyles a command

## Context

`specs/studio-ui-guidelines.md` §12.3, line 801:

> **Status: Partial.** The Command Bar, the palette, the element menu and the block bar print title, chord and `requires` through `formatBinding` (`packages/studio/src/surfaces/commandbar.ts`, `src/panels/quick-search.ts`, `src/surfaces/menu.ts`). Rail buttons print no chord although `panel.focus.*` binds one (`src/surfaces/rail.ts`); the tab-strip and Files-tree menus build their rows with no `chord`, and `src/files/files.ts` hard-codes `destructive: false`; the Bottom dock's close button carries its own label, prints no ⌘J, and calls the dock setter rather than `view.setBottomDock` (`src/surfaces/bottom-dock.json`, `src/panels/bottom-dock.ts`); and the Source Control panel's "Create GitHub repository" renames `git.createGithubRepository` (`src/surfaces/git-panel.json`).

**What exists**

- Surfaces that meet the rule: `commandTooltip` in `packages/studio/src/surfaces/commandbar.ts` (title plus `formatBinding`, or `requires`), `src/panels/quick-search.ts` (unavailable rows greyed with `requires`, chord via `formatBinding`), `src/editor/context-menu.ts` with `src/surfaces/menu.ts` (chord, `destructive`, submenu rows), `src/panels/block-action-bar.ts` (tooltip carries `keymap.formatBinding(id)`).
- Rail: `project()` in `packages/studio/src/surfaces/rail.ts` passes each panel's `title` only, and `src/surfaces/rail.json` binds `hint` to that title. `panelFocusCommands` in `src/commands/defaults.ts` gives the first eight `panel.focus.*` records a chord.
- Tab strip: the `context/tab` projection in `packages/studio/src/panels/tab-strip.ts` builds `MenuRowProjection`s with no `chord`, so `pane.splitRight` (⌘\\) prints none.
- Files tree: the `context/file` projection in `packages/studio/src/files/files.ts` (`treeMenuRow`, and the disabled branch with `destructive: false` written out) prints no chord, so `library.open` prints none, and the destructive flag never comes from the record.
- Bottom dock close: `jx-action-button[part="close"]` in `packages/studio/src/surfaces/bottom-dock.json` has a literal `label` and `hint` ("Close the Bottom dock") and calls the host's `closeDock`, which `src/panels/bottom-dock.ts` implements as `setDockCollapsed("bottom", true)`. The records are `view.setBottomDock` ("Show Bottom Dock", taking `{ open }`) and `view.toggleBottomDock` (⌘J) in `src/shell.ts`.
- Source Control: `packages/studio/src/surfaces/git-panel.json` spells "Create GitHub repository" twice as literal `textContent`; the record's title is "Create GitHub Repository".

**What is missing**

- Rail buttons carry the `panel.focus.*` chord in their tooltip (the formatted binding beside the title), through the one formatter.
- The tab-strip and Files-tree menu projections set `chord` from `registry.keymap.formatBinding(id)` and `destructive` from the record, as the element menu's does. A shared row projector for `forPlacement` menus is the obvious shape and a detail-phase decision.
- The Bottom dock's close button runs `view.setBottomDock { open: false }` through `runReported` and names itself from the record, with the ⌘J binding in its tooltip through `formatBinding`. Which record's title and chord it prints (the setter's, or the toggle's, whose chord it is) is a detail-phase decision.
- Not this plan's work: the Source Control panel's "Create GitHub repository" label. `plan:studio-ui-guidelines/git-panel-action-list` draws both copies of that button from the `git.createGithubRepository` record for §12.5, which is also what makes the label the record's title, so this plan requires it and §12.3's git clause closes when it lands.
- Tests: a rail tooltip with its chord, a tab-strip and a file-row menu row with a chord and a destructive row styled from the record, and the dock's close button naming its chord and running the record.

**Related**

- `studio.md` §13.1 (the record) and §13.3 (KeyScope and chords).
- `studio-ui-guidelines.md` §8.4 (menus), §10 (checklist items on command rendering), §12.5.
