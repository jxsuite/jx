---
status: stub
disposition: implement
claims:
  - studio.md#13
size: M
workspaces:
  - packages/studio
---

# The Files and Library verbs and media browsing are command records like every other capability

## Context

`specs/studio.md` §13, line 1316 (the census kept the section Partial and replaced "the surfaces are being ported onto them" with the residue):

> **Status: Partial.** The registry, the keymap, the CI checks and nearly every surface ship as renderings of the records (`packages/studio/src/commands/registry.ts`, `surfaces/commandbar.ts`, `surfaces/statusbar.ts`, `editor/context-menu.ts`, `panels/quick-search.ts`, `services/ai-command-tools.ts`). Panel-local verbs remain that are not records, each with its own `run`: the Files tree's row menu (New File, Upload Files, Edit Pages in Grid, Open, Rename and Delete; `fileMenuRows` in `files/files.ts`) and its toolbar (New File, Refresh and Show ignored files; `FILE_ACTIONS` in the same module); the Library's per-file menu (Open, Rename…, Duplicate and Delete; `showLibraryContextMenu` in `browse/library-pane.ts`); and the Source Control panel's commit, fetch, pull, stage, unstage, discard and branch verbs, which run the git operations themselves (`ACTIONS` in `panels/git-panel.ts`, `studio-ui-guidelines.md` §12.5's gap). `media.browse` is still a registry gap in `AUTOMATION_COMMANDS` (`services/automation.ts`).

Disposition `implement`. The consequence is the one §13 names: a verb that is not a record is not in the palette, has no chord to rebind, cannot be scripted by `__jxAutomation`, and is not an assistant tool. Rename and Delete are the two most consequential file operations Studio has, they are implemented twice (once per surface), and neither copy can be reached any way but the mouse; Duplicate exists only in the Library's menu.

**What exists**

- `fileMenuRows` in `packages/studio/src/files/files.ts`: `treeMenuRow("files.newFile" | "files.upload" | "files.pagesGrid" | "files.open" | "files.rename" | "files.delete", …)` with inline closures, followed by `placedFileRows(entry)`, which already renders the declared `context/file` records. The comment on the pages-grid row calls it "the one hand-built row left", which the other five contradict.
- `FILE_ACTIONS` in the same module: `newFile` (`createNewFile(".")`), `refresh` (`refreshFileTree()`) and `toggleIgnored` (`setShowIgnoredFiles`) as closures; `openProject` already runs `project.open` through the registry, which is the shape the other three should take.
- `showLibraryContextMenu` in `packages/studio/src/browse/library-pane.ts`: literal `open`, `rename`, `duplicate` and `delete` rows with closures over `openFileInTab`, `renameLibraryFile`, `duplicateLibraryFile` and `deleteLibraryFile`, which re-implement the tree's rename and delete with the shared prompt copy. `packages/studio/src/browse/library-commands.ts` declares the Library's view verbs (`library.open`, `library.setCategory`, `library.refresh`, `library.newEntry` and others) and no file verb.
- `renameFile`, `deleteFile`, `createNewFile`, `pickAndUploadTo`, `openPagesGrid` in `files/files.ts`; the consequence dialogs of §9.1.1.
- `AUTOMATION_COMMANDS` in `packages/studio/src/services/automation.ts` (`"media.browse": { disposition: "command" }`), the matching `unstable` hatch in `scripts/screenshots/manifest.json`, and the media browser (`packages/studio/src/ui/media-picker.ts`, `src/surfaces/media-browser.json`).
- Hand-registered assistant tools (`AI_TOOL_TIERS` in `services/ai-system-prompt.ts`) are not part of this item: §13.5's closed writer table (`tests/ai-hand-writers.test.ts`) sanctions them.

**What is missing**

- Project-level records for the file verbs, each taking a `path` argument (the row supplies it): new file, upload, edit pages in grid, open, rename, duplicate and delete, plus refresh and show-ignored for the toolbar. They are placed on `context/file`, on the Library's per-file menu and in the palette, with `requires` sentences and `undo` scopes; rename and delete keep their consequence dialogs, and a scripted or assistant call needs an answer for them.
- Both surfaces rendering the one set: `fileMenuRows` reduced to `placedFileRows`, the Library menu drawn from the same placement, `FILE_ACTIONS` running the records, and the Library's own rename, duplicate and delete helpers folded into the records' `run`.
- A `media.browse` record, the `AUTOMATION_COMMANDS` entry and its manifest hatch removed, and the shot re-authored to name the command.
- The Source Control verbs are not this plan's work but gate its claim: §13 flips only once `plan:studio-ui-guidelines/git-panel-action-list` has given `ACTIONS`' capabilities records or recorded them as input handlers. That plan's list of twin-less entries is the full one (commit, commitAndSync, fetch, pull, stage, stageAll, unstage, unstageAll, discard, chooseBranch and the others), and its commit menu's `git.commitWithoutSync` row id names no record. The detail phase draws that edge.
- Editorial ride-along, since this change edits §13: §13.4's `capability` row lists six PAL-derived keys, and `CAPABILITIES` in `packages/studio/src/commands/context.ts` declares a seventh, `readFileBytes` (the image editor's gate).

**Related**

- studio.md §13.1 and studio.md §13.2 (the record and its level), studio.md §13.4 (context keys), studio.md §13.5 (the automation rules and the chrome budget), studio.md §9.1.1 (create, rename, delete and their consequences), studio.md §9.1.2 (the Library), site-architecture.md §9.4 (the media browser).
- `plan:studio-ui-guidelines/name-and-chord-gaps` rewrites the same Files-tree projection so its rows take `chord` and `destructive` from the record (it names `treeMenuRow` and the hard-coded `destructive: false`). The intended order is records first, then one row projector for every `forPlacement` menu that sets chord and destructive; the detail phase draws that edge.
- `plan:studio-ui-guidelines/git-panel-action-list` (above).
