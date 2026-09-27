---
status: drafted
disposition: implement
claims:
  - studio.md#13
requires:
  - studio-ui-guidelines/git-panel-action-list
  - studio-ui-guidelines/name-and-chord-gaps
workspaces:
  - packages/studio
  - scripts
  - specs
  - docs
size: M
---

# The Files tree, its toolbar and the Library's per-file menu run one set of file records, and §13 closes naming what is still not a record

## Context

`specs/studio.md` §13, line 1324:

> **Status: Partial.** The registry, the keymap, the CI checks and nearly every surface ship as renderings of the records (`packages/studio/src/commands/registry.ts`, `surfaces/commandbar.ts`, `surfaces/statusbar.ts`, `editor/context-menu.ts`, `panels/quick-search.ts`, `services/ai-command-tools.ts`). Panel-local verbs remain that are not records, each with its own `run`: the Files tree's row menu (New File, Upload Files, Edit Pages in Grid, Open, Rename and Delete; `fileMenuRows` in `files/files.ts`) and its toolbar (New File, Refresh and Show ignored files; `FILE_ACTIONS` in the same module); the Library's per-file menu (Open, Rename…, Duplicate and Delete; `showLibraryContextMenu` in `browse/library-pane.ts`); and the Source Control panel's commit, fetch, pull, stage, unstage, discard and branch verbs, which run the git operations themselves (`ACTIONS` in `panels/git-panel.ts`, `studio-ui-guidelines.md` §12.5's gap). `media.browse` is still a registry gap in `AUTOMATION_COMMANDS` (`services/automation.ts`).

A verb that is not a record is not in the palette, has no chord, cannot be scripted by `__jxAutomation` and is not an assistant tool. Paths below are under `packages/studio/src/`.

**Verified**

- `fileMenuRows` (`files/files.ts`) builds six hand rows through `treeMenuRow` (`files.newFile`, `files.upload`, `files.pagesGrid`, `files.open`, `files.rename`, `files.delete`) around `placedFileRows(entry)`, which already renders the declared `context/file` records (`document.openToSide`, `library.open`, `content.openEntry`, `file.convertFormat`, `collection.editInGrid`) from `fileRowFacts`, a bag keyed by argument name: `file` on every file row, `path` only on a collection entry, `source` on a convertible file, `name` on a collection's source root.
- `FILE_ACTIONS.newFile`, `.refresh` and `.toggleIgnored` are closures; `.openProject` already runs `project.open` through `runActiveReported`.
- `showLibraryContextMenu` (`browse/library-pane.ts`) builds literal `open`, `rename`, `duplicate`, `delete` rows over `openFileInTab`, `renameLibraryFile`, `duplicateLibraryFile` and `deleteLibraryFile`. The row menu is reachable from the keyboard (the row's `oncontextmenu`), but no palette row, chord, script or tool reaches Rename, Duplicate or Delete.
- `media.browse` is `{ disposition: "command" }` in `AUTOMATION_COMMANDS`, and `media-picker-shot` in `scripts/screenshots/manifest.json` clicks `inspector/field:image/browse` under an `unstable` hatch naming it. That region is derived now (`ui/regions.ts`; `scripts/check-shot-contract.ts` records the 12 → 11 drop).
- The hand-registered assistant tools are not residue: `studio.md` §13.5's closed writer table (`tests/ai-hand-writers.test.ts`) sanctions them.

**Found by this pass**

- **The two copies disagree, and the Library's is the broken one.** `renameLibraryFile` calls `platform.renameFile` with no `markLocalMutation`, no `renameTab` for an open tab, no `settleRename` (so tabs whose references moved are not reloaded) and no `notifyMoveOutcome` (so unwritten references read as a plain success, which `studio.md` §9.1.1 forbids). `duplicateLibraryFile` reads through `readFile`, which decodes UTF-8 and turns a PNG into replacement characters (`types.ts`, `readFileBytes`), and writes with `writeFile` over an existing `<stem>-copy<ext>`. The tree's rename and delete never call `invalidateLibrary`, whose doc says every surface that changes the file set does.
- **Edit Pages in Grid** is offered on any folder named `pages` at any depth, and always opens the root `pages/` grid (`createPagesSource`, `grid/sources/content-source.ts`).
- **The palette cannot draw a path-taking record.** `paletteArgs` (`panels/quick-search.ts`) prompts only for one enum or boolean property, so `file.convertFormat` declares `context/file` alone, and `content.openEntry` and `library.setSearch` declare `palette` and are silently dropped from it.
- **The show-ignored toggle renames itself**: `ignoredLabel` flips between "Show ignored files" and "Hide ignored files" while `selected` also flips, which `studio.md` §9.1.4 specifies and `studio-ui-guidelines.md` §12.3 ("No surface renames a command") and a toggle button's fixed name both refuse once it is a record.
- **§13's marker lists less than §13 covers.** The census named Navigator-panel verbs only. These capabilities are not records either, and two of them call past a record's refusal:
  - the Grid editor's toolbar: Save, Refresh, Add Row, Delete Rows, Fill Down and Replace (`grid/grid-panel.ts`);
  - Project Settings: a connection's Test and Push (`panels/data-grid.ts`), the Packages rows' Add, Update, Update All, Remove and Reinstall (`settings/dependencies-editor.ts`, whose Remove calls `platform.removePackage` where `packages.remove` refuses a package still enabled as an extension), and the Extensions rows' switch and Remove (`settings/extensions-section.ts`, calling the functions `project.enableExtension`, `project.disableExtension` and `packages.remove` run);
  - the Cloudflare connection's Connect, Reconnect, Choose Account and Disconnect (`settings/preferences-accounts.ts`), with Connect written a second time in the publish panel (`publish/publish-panel.ts`), and the assistant's managed connect (`ui/ai-managed-connect.ts`);
  - the Media viewer's Copy Reference (`media/media-pane.ts`).

  The two that bypass a refusal are `studio-ui-guidelines.md` §12.5's failure class; its owner, `plan:studio-ui-guidelines/git-panel-action-list`, does not list them.

**Related**

- `plan:studio-ui-guidelines/git-panel-action-list#GPA1.2` removes the Source Control clause from this marker, and `plan:studio-ui-guidelines/git-panel-action-list#GPA1.3` adds `addRepository` to §13.4's `capability` row.
- `plan:studio-ui-guidelines/name-and-chord-gaps` replaces `placedFileRows` with `placementRows` (`commands/projection.ts`), which prints chord, `destructive` and group dividers from the record.
- `plan:studio-ui-guidelines/moves-without-dragging` adds `file.cut` and `file.paste`, states `entry` and `into` in `fileRowFacts`, and hooks `forgetCut` into `renameFile` and `deleteFile`. It asks this plan to key its path-taking records on `entry`.
- Editorial ride-along: §13.4's `capability` row omits `readFileBytes`, which `CAPABILITIES` (`commands/context.ts`) declares.

## Outcome

- `studio.md` §13 → Implemented, with a `> **Status: Future.**` paragraph naming the verbs in "§13's marker lists less than §13 covers" (Open decision below).
- §13.4's `capability` row names `readFileBytes`.
- §9.1.1, §9.1.2 and §9.1.4 describe the shared records, the Library's menu and the renamed toggle; they stay Implemented.
- `studio-ui-guidelines.md` §12.4 rule 2's closed set gains the four file records that wait on a person; §12.4 stays Partial.
- studio.md keeps other open items and does not graduate.

## Decisions

- **Open:** Whether the file menus keep an Open row. Recommendation: no; both menus drop it. A click or Enter on a Files row or a Library item already opens the file (`activateFileRow`, the Library's `openFile`), and Open to the Side stays as the menus' open verb. The record that opens a file, `document.open`, takes `path`, which `fileRowFacts` reserves for "an entry of a collection". Drawing it would mean renaming `content.openEntry`'s argument, or minting `file.open { file }` as a second record for one capability.
- **Open:** What `media.browse` becomes. Recommendation: not a record. Browse is a control of a media field, and `studio-ui-guidelines.md` §12.4 makes the Inspector no command surface. The field is mounted by five hosts (properties, frontmatter, state default, Document Header, grid cell), and a record could address only the Inspector's. The shot already clicks a derived region, so the `unstable` hatch goes, the `AUTOMATION_COMMANDS` entry goes, and the `command` disposition goes with its last member. The alternative is a selection-level `media.browse { prop }` whose `prop` is a derived enum over the selected element's mounted media fields, placed in the palette, with the shot re-authored to name it.
- **Open:** What §13 says about the verbs its marker never named. Recommendation: a `> **Status: Future.**` paragraph naming them by module, with the two §12.5 bypasses called out as such. Each is its own design: a grid row verb needs a row argument, and the Cloudflare flow needs a capability key and one error contract. None blocks the file verbs, and a Future remainder keeps the gap visible and lets studio.md graduate. The alternative keeps §13 Partial behind a new plan the census opens for them.
- **Open:** Whether a focused Files row answers F2 and Delete. Recommendation: yes. F2 runs `file.rename`, and Delete (or ⌘⌫ / Ctrl+Backspace) runs `file.delete`, answered by the row's own `onkeydown` as ⌘X and ⌘V will be. `docs/studio/interface.md` already promises delete "on the row you are standing on", and each key is one line once the records exist.
- **Decided:** the records live in a new `files/file-commands.ts`, beside `files.ts`, as `library-commands.ts` sits beside `library-pane.ts`. The module imports both `files.ts` and `library-pane.ts`, and `library-pane.ts` already imports `files.ts`, so the records could not live in `files.ts` without a cycle. `pages.editInGrid` joins `gridCommands()` in `grid/grid-open.ts`, beside `collection.editInGrid`.
- **Decided:** `file.*` names operations on a file, as `file.save`, `file.convertFormat` and the coming `file.cut` do. `files.*` names the Files panel's own view, as `library.*` names the Library's. The records:

  | id                     | title              | args (required unless marked) | menus          | group      | level       |
  | ---------------------- | ------------------ | ----------------------------- | -------------- | ---------- | ----------- |
  | `file.new`             | New File…          | `dir`                         | `context/file` | `0_new`    | project     |
  | `file.upload`          | Upload Files…      | `dir`                         | `context/file` | `0_new`    | project     |
  | `file.duplicate`       | Duplicate          | `file`                        | `context/file` | `7_edit`   | project     |
  | `file.rename`          | Rename…            | `entry`, `newName` (optional) | `context/file` | `7_edit`   | project     |
  | `file.delete`          | Delete             | `entry`                       | `context/file` | `9_danger` | project     |
  | `files.refresh`        | Refresh Files      | none                          | `palette`      | —          | project     |
  | `files.setShowIgnored` | Show Ignored Files | `show` (boolean)              | `palette`      | —          | application |
  | `pages.editInGrid`     | Edit Pages in Grid | `pages`                       | `context/file` | `5_data`   | project     |

  Every project-level record has `when: (ctx) => ctx.project.open` and `requires: "an open project"`, the precondition `file.convertFormat` already declares for the same family (`studio-ui-guidelines.md` §12.4). `file.delete` is `destructive: true`. Every writer has `undo: "none"`. No record binds a chord. Category is "File", except `files.setShowIgnored` ("View") and `pages.editInGrid` ("Project").

- **Decided:** a row answers a record through `fileRowFacts`, keyed by argument name. `entry` is every row's own path, as `plan:studio-ui-guidelines/moves-without-dragging` states it, and whichever plan lands first adds it. `dir` is a folder row's own path. `pages` is `"pages"` on the root `pages` folder only, so the grid row stops appearing on a nested `pages` that it does not open. Rename's optional name is `newName`, never `name`: `name` is already the collection fact on a source-root folder, and `placementRows` fills every property the facts can answer, so a `name` argument would rename a collection's folder to the collection's name without asking.
- **Decided:** the path-taking records are not in the palette. `paletteArgs` cannot prompt for a free-text path, and declaring `palette` would be the declared-and-never-drawn state `content.openEntry` is in today. The palette gains `files.refresh` and `files.setShowIgnored`, which it can draw.
- **Decided:** no record carries `aiTool`. `file.new`, `file.upload`, `file.rename` and `file.delete` wait on a person (`studio-ui-guidelines.md` §12.4 rule 2: a prompt, the OS picker, a prompt when `newName` is absent, a confirmation), so they join rule 2's set and `WAITS_ON_A_PERSON`. `file.duplicate` is redundant with `read_file` and `write_file` (rule 4). The other three are chrome (rule 1).
- **Decided:** one implementation per verb, in `files.ts`, and the Library's three helpers are deleted. The records call `createNewFile`, `pickAndUploadTo`, `renameFile`, `deleteFile`, a new `duplicateFile`, `refreshFileTree` and `setShowIgnoredFiles`. That fixes every divergence under "Found by this pass". After a rename, a delete or a duplicate, the record's `run` calls `invalidateLibrary()` and `invalidateMediaCache()` (`ui/media-picker.ts`). The tree, the Library and the media picker are the three lists of project files that `studio.ts`'s upload handler already invalidates together.
- **Decided:** `duplicateFile(path)` names the copy with `uniqueName(`${stem}-copy${ext}`, taken)` (`files/media-upload.ts`) over a fresh `listDirectory` of the parent, so `a-copy.json` then `a-copy-1.json`. It copies through `readFileBytes` when the platform has it and `uploadFile(copyPath, data)` either way, using the path `uploadFile` reports. Without `readFileBytes`, a file `isMediaFile` names is refused with a `RangeError` ("… cannot be copied on this backend, which reads files as text"), and anything else is copied as text.
- **Decided:** `file.rename` with `newName` opens no dialog and reports through `notifyMoveOutcome`, as a drag-move does (`studio.md` §9.1.1). `file.delete` always confirms, because the confirmation is where §9.1.1 states the consequence, and no caller needs to skip it. Both refuse, with a `RangeError` before any dialog, an `entry` that is empty, is `.`, starts with `/`, or has a `..` segment.
- **Decided:** `file.upload`'s `run` reaches `input.click()` synchronously. `runReported` and `registry.run` call through without awaiting, so the OS picker opens inside the click's user activation, as today's row does.
- **Decided:** show-ignored becomes a setter, drawn as a toggle button whose name stays "Show Ignored Files" and whose pressed state is `showIgnoredFiles()`. A `toggle*` id is refused (`studio.md` §13.5), no surface renames a record, and a toggle button's name does not change with its state. `canvas.setLayoutVisible` on the pane context bar is the precedent.
- **Decided:** the Library draws `placementRows(registry, "context/file", { facts, source: "Library", omit: ["library.open"] })`. Opening the Library from inside it means nothing, and `studio.md` §13 lets a rendering choose whether to show a record. `placementRows` gains `omit`, applied before dividers are placed so a dropped first-of-group row takes no divider with it. The Library's New menu rows run `library.newEntry { type }` through `runActiveReported` instead of calling `createLibraryEntry`, which is that record's `run`.
- **Decided:** the edges. `studio-ui-guidelines/git-panel-action-list` is required because §13 cannot read Implemented while `ACTIONS` runs git itself. `studio-ui-guidelines/name-and-chord-gaps` is required because `placementRows` is what draws `file.delete` destructive and prints chords in both menus. Without it this plan would repair `placedFileRows` and write a sixth projector for the Library, which that plan's contract exists to prevent. `studio-ui-guidelines/moves-without-dragging` is neither: its records and this plan's share the `entry` fact and the `renameFile` and `deleteFile` names, and land in either order.

## Implementation

Paths under `packages/studio/`. New comments cite spec sections qualified; a bare `§` in this package means `studio.md`.

1. **`src/files/files.ts`**
   - `fileRowFacts` is exported. It states `entry` for every row if absent, `dir` on a folder row, and `pages: "pages"` when `entry.path === "pages"`. Its doc comment names all the facts.
   - `renameFile(path, newName?)` and `deleteFile(path)` take a path, derive the display name from its last segment, and are exported. They keep their bodies, `markLocalMutation`, `settleRename`, `notifyMoveOutcome` and the `forgetCut` hook the moves plan adds. The prompt is skipped when `newName` is given.
   - New `duplicateFile(path): Promise<string | null>`, per the decision. It calls `markLocalMutation(copy)`, `loadDirectory(parent)`, `repaintFiles()` and `notify.success(`Duplicated as ${name}`)`, and reports a failure with `notify.error("Could not duplicate …", { path, source: "Files" })`.
   - Export `newFileIn(dir)` (`createNewFile(dir, repaintFiles)`), `uploadInto(dir)` (`pickAndUploadTo(dir, repaintFiles)`, synchronous), `refreshFileTree()` and `applyShowIgnored(show)` (`setShowIgnoredFiles(show)` then `repaintFiles()`).
   - `fileMenuRows(entry)` becomes `placementRows(registry, "context/file", { facts: fileRowFacts(entry), source: "Files" })` behind the no-registry guard. `placedFileRows` and `treeMenuRow` are deleted.
   - `FILE_ACTIONS`:
     - `newFile` runs `file.new { dir: "." }`, `refresh` runs `files.refresh`, and `toggleIgnored` runs `files.setShowIgnored { show: !showIgnoredFiles() }`, each through `runActiveReported(…, "Files")`.
     - If the F2/Delete decision holds, `rename(path)` and `remove(path)` run `file.rename { entry }` and `file.delete { entry }` the same way.
   - `filesPanelValues()` builds `controls: { newFile, refresh, showIgnored }` with `commandControl(activeRegistry(), id)` (`src/commands/command-control.ts`), and keeps `ignoredSelected` as the pressed state. `ignoredLabel` and `ignoredIcon` go.
2. **`src/files/file-commands.ts`** (new; header cites §13 and §9.1.1, `@docs studio/interface`):
   - `fileCommands(): AnyCommand[]` returns the seven `file.*` and `files.*` records in the table, and `registerFileCommands(registry)` registers them.
   - A private `entryArg(id, args, key)` wraps `stringArg` with the refusal in the decision. A private `afterWrite()` calls `invalidateLibrary()` and `invalidateMediaCache()`.
   - `run` for each record:
     - `file.new`: `newFileIn(dir)`, with `dir` allowed to be `.`.
     - `file.upload`: `uploadInto(dir)`, synchronous.
     - `file.rename`: `await renameFile(entry, newName)` then `afterWrite()`.
     - `file.delete`: `await deleteFile(entry)` then `afterWrite()`.
     - `file.duplicate`: `await duplicateFile(file)` then `afterWrite()`.
     - `files.refresh`: `refreshFileTree()`.
     - `files.setShowIgnored`: `applyShowIgnored(booleanArg(…))`.
   - Each record's comment gives its §12.4 rule for having no `aiTool`.
3. **`src/grid/grid-open.ts`**: `pages.editInGrid` in `gridCommands()`. Its `run` refuses any `pages` other than `"pages"` with a `RangeError`, then calls `openPagesGrid()`. The comment on the deleted hand row ("no command declares 'open the pages grid'") goes with it.
4. **`src/commands/projection.ts`**: `PlacementRowOptions` gains `omit?: readonly string[]`. `placementRows` skips those ids before it computes `dividerAbove`.
5. **`src/browse/library-pane.ts`**:
   - `showLibraryContextMenu(path, x, y)` keeps `fileAt` and the one-menu handle. Its rows become `placementRows(registry, "context/file", { facts: fileRowFacts({ path: file.path, type: "file" }), omit: ["library.open"], source: "Library" })`. With no registry it opens no menu.
   - `renameLibraryFile`, `duplicateLibraryFile` and `deleteLibraryFile` are deleted, with the now-unused imports (`confirmFileDelete`, `renamePromptMessage`, `showPromptDialog` if nothing else reads it).
   - `showLibraryNewMenu`'s `run` becomes `void runActiveReported("library.newEntry", { type: id }, "Library")`.
6. **`src/surfaces/files-panel.ts` and `files-panel.json`**:
   - `FilesPanelValues` gains `controls`; `emptyFilesPanelValues()` seeds three skeleton views.
   - The toolbar's three buttons bind `label`, `hint` and `disabled` from `#/state/controls/<name>/…`. The literals go; show-ignored keeps `selected` and takes the icon `eye`.
   - If the F2/Delete decision holds, the row gains an `onkeydown`:
     - F2 maps to `rename`, and Delete, or Backspace with `metaKey || ctrlKey`, maps to `remove`, each with `$map/item/path`.
     - It merges with the moves plan's handler if that plan landed first.
     - `FilesPanelActions` and the tree's `$description` name the keys.
7. **`src/commands/app-commands.ts`** spreads `...fileCommands()`, and **`src/studio.ts`** calls `registerFileCommands(commandRegistry)` beside `registerLibraryCommands`.
8. **`media.browse`** (as recommended):
   - `src/services/automation.ts`:
     - Delete the `"media.browse"` entry, the `command` member of `GapDisposition` and `unknownCommandMessage`'s "has no command record yet" branch.
     - Rewrite the map's doc: the countdown is over, and five `refused` entries remain.
   - `scripts/screenshots/manifest.json`: drop the `unstable` object from `media-picker-shot`'s input step. The step stays a click on the derived region.
   - `scripts/check-shot-contract.ts`:
     - `CONTRACT_BUDGET.unstable` 2 → 1.
     - Rewrite its doc bullet and the `inputSteps` paragraph's "`media.browse`" clause: the step clicks a field control, which is an input the app accepts, not a registry gap.

**Integration contract.** Once this lands:

- `fileCommands()` and `registerFileCommands(registry)` exist, and the eight ids in the table are records with those arguments.
- `fileRowFacts` is exported and states `entry`, `dir`, `file`, `path`, `source`, `name` and `pages` under the rules above.
- Any `context/file` record appears in the Files tree and the Library's per-file menu with no surface edit. A record that means nothing in one of them is left out there through `placementRows`' `omit`.
- `renameFile(path, newName?)`, `deleteFile(path)` and `duplicateFile(path)` are the only implementations of those verbs. `studio.md` §13 reads Implemented, and its Future paragraph is the list of capabilities still waiting for a record.

## Tests

The suite is `packages/studio`, run as `bun test --isolate --coverage` from that directory. Its thresholds are `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`, per file. `src/files/file-commands.ts` is new and ships with `tests/file-commands.test.ts` in the same pull request, or `bun scripts/check-coverage-manifest.ts packages/studio` fails. `files.ts`, `library-pane.ts` and `automation.ts` lose code, so re-read their rows in the coverage table, and ratchet the thresholds if the worst file rises. DOM tests import `./harness` first.

- **New `tests/file-commands.test.ts`** (registry from `createCommandRegistry` over `fileCommands()` plus `gridCommands()`, published with `setActiveRegistry`; the in-memory platform from the harness):
  - "the file family: ids, titles, one precondition, placements, groups, and no aiTool"
  - "no path-taking record declares the palette, and the palette draws Refresh Files and Show Ignored Files" (`paletteArgs` is not `unsupported` for either)
  - "New File… runs the creation flow in the folder it is given"
  - "Upload Files… opens the picker before registry.run returns" (spy on `HTMLInputElement.prototype.click`)
  - "Rename… asks with the consequence sentence; with newName it renames at once and warns about references it could not rewrite"
  - "rename and delete refuse the project root and a path that leaves the project, before any dialog"
  - "renaming a file open in a tab re-keys the tab and reloads the tabs whose references moved"
  - "Delete confirms with the reference count, and a cancel deletes nothing"
  - "Duplicate names the copy -copy, then -copy-1, and never writes over a file"
  - "Duplicate copies bytes through readFileBytes" (the `uploadFile` payload equals the source buffer)
  - "without readFileBytes a media file is refused and a document is copied as text"
  - "rename, delete and duplicate invalidate the Library and the media picker's cache"
  - "Show Ignored Files is idempotent and repaints the tree"
  - "Refresh Files re-reads the listings and the ignore rules"
- **`tests/project-gap-commands.test.ts`**: "Edit Pages in Grid opens the pages grid, and refuses any other directory".
- **`tests/files-tree.test.ts`**:
  - "file context menu": the hand-row id assertions become record ids. A file row offers `file.duplicate`, `file.rename` and `file.delete` and no Open; a folder row offers `file.new` and `file.upload`; each menu is otherwise the `context/file` records its facts answer, in group order.
  - New: "Delete is drawn destructive, from the record".
  - New: "only the root pages folder offers Edit Pages in Grid" (replaces "the pages directory keeps its hand-built grid row").
  - New: "a row's refusal is filed in Problems under Files".
  - "rename flow" and "delete flow" click `file.rename` and `file.delete`; their platform assertions stand.
  - Toolbar: "New File… on the toolbar runs file.new at the project root", and "the toolbar prints each record's title, and draws disabled with no registry".
  - "the toolbar toggle draws the ignored rows…" asserts the fixed name "Show Ignored Files" and `selected` following the state.
  - If the F2/Delete decision holds: "F2 on a focused row runs Rename…, and Delete runs Delete".
- **`tests/library-pane.test.ts`**, "the per-file context menu":
  - "offers the file's context/file records, without Open Library"
  - "renaming from the Library moves an open tab with the file" (new; the old copy failed it)
  - "duplicates beside the original, never over an existing copy"
  - "a confirmed delete removes the file, re-scans, and reloads the tree's folder"
  - "a failing rename and a failing duplicate report the same way", with the source now "Files"
  - New: "the New menu runs library.newEntry"
- **`tests/command-projection.test.ts`**: "omit drops a record before dividers are placed".
- **`tests/ai-command-tools.test.ts`**: `WAITS_ON_A_PERSON` gains `file.new`, `file.upload`, `file.rename`, `file.delete`.
- **`tests/app-commands.test.ts`**: "covers every contribution point the bootstrap composes" gains the `files` and `pages` namespaces (`file` is there already). `tests/app-commands-composition.test.ts` needs no edit and fails if the spread or the registration is missing.
- `media.browse`:
  - `tests/automation.test.ts`: delete "an id with a registry gap says which phase lands it".
  - `tests/studio-shell-automation.test.ts`: "an id nothing declares…" asserts `unknown command "media.browse"`.
  - `tests/shot-contract-check.test.ts`: `loaded.has("media.browse")` is false.
  - `tests/automation-commands.test.ts`: the countdown bound becomes 5, and the `command` loop goes.

## Specs & docs

**`specs/studio.md`**, in place:

- §13's marker is replaced by two paragraphs:
  - `> **Status: Implemented.** The registry, the keymap, the CI checks and the panels ship as renderings of the records (packages/studio/src/commands/registry.ts, surfaces/commandbar.ts, surfaces/statusbar.ts, editor/context-menu.ts, panels/quick-search.ts, services/ai-command-tools.ts): the Files tree's row menu and the Library's per-file menu both render context/file, the Files toolbar runs file.new, files.refresh and files.setShowIgnored (files/file-commands.ts), and the Source Control panel draws the git.* records.`
  - `> **Status: Future.**` followed by the list in Context's "§13's marker lists less than §13 covers", by module, stating that the Packages row's Remove and the Extensions rows call past `packages.remove` and `project.enableExtension` / `project.disableExtension` (`studio-ui-guidelines.md` §12.5).
  - Paths go in backticks, as the other markers write them. Re-run the Acceptance scan first and correct the list to what it finds.
- §13.4: the `capability` row gains `readFileBytes`, after whatever `plan:studio-ui-guidelines/git-panel-action-list` left there.
- §9.1.1:
  - The table's "Files / Browse" becomes "Files / Library" twice, and "Browse **New ›**" becomes "Library **New ›**".
  - After "Blank input is rejected in place…", add a paragraph. "**One set of verbs, two menus.** The Files tree's row menu and the Library's per-file menu both render the `context/file` placement. New File…, Upload Files…, Duplicate, Rename… and Delete are `file.new`, `file.upload`, `file.duplicate`, `file.rename` and `file.delete` wherever they appear. A row offers exactly the records whose required arguments it can answer: a folder's `dir`, a file's `file`, any row's `entry`. The toolbar's New File… runs `file.new` at the project root. A rename given its `newName` argument opens no dialog and reports as a drag-move does. Duplicate writes the original's name with `-copy` before the extension, suffixed `-1`, `-2`, … when that is taken, copies the bytes, and never overwrites." If the F2/Delete decision holds, add: "A focused row answers F2 with Rename… and Delete with Delete."
- §9.1.2: append "Its per-file menu is the Files tree's (§9.1.1), less Open Library."
- §9.1.4, line 1053:
  - "The Files toolbar carries the toggle, beside New File and Refresh: **Show ignored files** / **Hide ignored files**, labelled for what it will do." becomes "The Files toolbar carries the toggle, beside New File… and Refresh Files: **Show Ignored Files** (`files.setShowIgnored`), a toggle button pressed while ignored entries are drawn, whose name does not change with its state."
  - "**Refresh** re-reads them too" becomes "**Refresh Files** (`files.refresh`) re-reads them too".
- Fragment: `bun run spec:change studio.md minor -m "The Files tree, its toolbar and the Library's per-file menu run one set of file command records, and §13 names the capabilities that are still not records as future work"`.

**`specs/studio-ui-guidelines.md`** §12.4 rule 2's set gains `file.new`, `file.upload`, `file.rename` and `file.delete`. Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "The set of records that wait on a person gains New File, Upload Files, Rename and Delete"`.

**Docs** (no em dashes; `bun run docs:sync` names the first three through `code:`):

- `docs/studio/interface.md`:
  - The Files bullet gains "Right-click a file or folder for **Duplicate**, **Rename…** and **Delete**, the same commands the [Library](/docs/studio/projects/browse) offers on a file."
  - "Files the tree hides": "click **Show ignored files** … the button becomes **Hide ignored files**" becomes "click **Show Ignored Files** in the Files toolbar, beside **New File…** and **Refresh Files**. The tree redraws with everything in it, and the button stays pressed until you click it again. Both are also in the command palette." "**Refresh**" becomes "**Refresh Files**".
  - If the F2/Delete decision holds, "so cut, paste and delete still work on the row you are standing on" names :kbd[F2] and :kbd[Delete].
  - `code:` gains `packages/studio/src/files/file-commands.ts`.
- `docs/studio/projects/browse.md`, "Open, rename, duplicate, delete":
  - "Right-click for **Open**, **Rename…**, **Duplicate** and **Delete**. A duplicate lands beside the original with `-copy` on its name." becomes "Right-click for the menu the Files tree shows on a file: **Open to the Side**, **Duplicate**, **Rename…** and **Delete**, with **Open Entry Form** and **Convert Format…** where they apply. A duplicate lands beside the original with `-copy` on its name, or `-copy-1` when that is taken, and never replaces a file."
  - In "Rescan", "after anything it creates, renames, duplicates or deletes here" becomes "… here or in the Files tree".
  - `code:` gains `file-commands.ts`.
- `docs/studio/projects/pages-layouts-components.md`: "from the Library's right-click menu" becomes "from the right-click menu in the Library or the Files tree".
- Checked, no change: `docs/studio/editing/grid.md` (right-click the `pages` folder stays true), `docs/studio/projects.md`, `docs/studio/projects/content-types.md`, `docs/studio/projects/media.md`, `docs/studio/interface/tabs.md` and `docs/studio/data/grid.md`. The generated `docs/studio/interface/commands.md` picks the records up.
- The screenshots lane re-captures any shot that shows either menu or the Files toolbar. Review the images and the pages it lists.

studio.md keeps other open items, so it does not graduate. The pull request deletes this file and removes `studio/file-tree-command-records` from any dependent's `requires`.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage`: green, and no file under its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun scripts/check-command-levels.ts`, `bun scripts/check-chrome-budget.ts`, `bun run typecheck` and `bun run lint` pass. `bun scripts/check-shot-contract.ts` prints `unstable 1/1`.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:section-refs` and `bun run plans:check` pass. `bun run plans:status --spec studio` no longer lists `studio.md#13`.
- `rg -n "treeMenuRow|renameLibraryFile|duplicateLibraryFile|deleteLibraryFile|files\.pagesGrid" packages/studio/src` prints nothing. Under the `media.browse` recommendation, so does `rg -n "media\.browse" packages/studio/src scripts`.
- The Future paragraph's scan: for every `export interface …Actions` in `packages/studio/src/surfaces/*.ts`, read the implementing module's handlers. Each either runs a record, is an input handler or field edit, or is named in the Future paragraph.
- By hand, in Studio:
  - Right-click a file in the tree and the same file in the Library: the rows match, less Open Library, and Delete is red.
  - Rename a file open in a tab from the Library: the tab follows.
  - Duplicate a PNG twice: `-copy` and `-copy-1` both open as the same picture.
  - Run "Show Ignored Files" from the palette: the toolbar button is pressed, and its name has not changed.
