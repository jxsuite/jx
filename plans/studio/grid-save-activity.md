---
status: drafted
disposition: implement
claims:
  - studio.md#16.4
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# A grid save never blocks the app: a slow one is an Activity entry, the grid being saved is read-only until it ends, and only dependency installation opens the blocking modal

## Context

`specs/studio.md` §16.4, line 1634 (the section was unmarked before the census, and the first audit pass listed it as verified):

> **Status: Partial.** Activity entries, their steps, log and Cancel, `fail()` raising a Problem, the blocking modal's _Run in the background_, and the four dependency-install call sites ship (`packages/studio/src/panels/activity-panel.ts`, `ui/progress-modal.ts`). One non-dependency operation still blocks: a grid save touching more than five rows opens the progress modal titled "Saving grid" (`showProgressModal` in `grid/grid-controller.ts`).

The section's rule is "Blocking is retained for dependency installation only", and studio-ui-guidelines.md §13.3 rules 2 and 3 say the same thing and add that an operation with an Activity entry does not also toast its completion and that a failure raises exactly one Problem, deduped by `key`. `progress-modal.ts`'s header already asserts its call sites are exactly the four dependency installs; the grid controller is the fifth. `docs/studio/interface/problems-and-progress.md` ("What still blocks") already tells users only installing dependencies blocks, so the docs are ahead of the code.

**What exists** (paths under `packages/studio/`)

- `src/grid/grid-controller.ts` `save()`: after required-cell validation and the delete confirmation it counts affected rows (distinct cell rows, inserts, deletes) and, above five, opens `showProgressModal({ title: "Saving grid" })`, closing it with `progress?.done()` in `finally`. Outcomes go through `notify` directly: a full save toasts `Saved N change(s).` (key `grid.save`); a partial commit and a thrown commit each raise an error-tier Problem (`source: "Data"`, `key: "grid.save"`, `action: "file.save"`, `detail` only on the throw). The stub said a failure reports through "the grid's status line"; it does not, it is a Problem.
- `state.saving` guards re-entry and disables Save and Refresh (`projectPanel` in `src/grid/grid-panel.ts`), but cells, Add Row, Delete Rows, Fill Down, Replace and undo/redo stay live.
- `beginActivity` in `src/panels/activity-panel.ts` (`title`, `status`, `source`, `steps`, `cancel`); `ActivityHandle.fail(message, { action?, path? })` raises a `notify.error` with the log as `detail` and the entry's `source`, but takes no `key`. `activityIdleBlockers()` makes a running entry a `probe.idle()` source.
- The precedent for an operation that is usually instant: `loadLibrary` in `src/browse/library-pane.ts` opens its entry only after `SCAN_ACTIVITY_DELAY_MS` (600) and falls back to a direct `notify.error` when it fails before then; `tests/library-pane.test.ts` stubs `setTimeout` for that delay.
- Every `GridSource.commit` (`sources/content-source.ts`, `sources/csv-file-source.ts`, `sources/connector-source.ts` via `services/data-service.ts`, `redirects-grid.ts`) writes through `getPlatform()`, and no source defines `dispose`.
- `tests/grid-controller.test.ts`, "shows a progress modal for larger batches and a save error toast on throw", pins the modal (`progressOpens` is 1). `tests/grid-view.test.ts`, `tests/redirects-grid.test.ts` and `tests/grid-coverage-gaps.test.ts` mock `ui/progress-modal.js` only because the controller imports it.

**What is missing**

- The save opening an Activity entry instead of the modal, with success and failure announced once.
- A reason the grid can stay non-blocking safely. `EditBuffer.applyCommitResult` (`src/grid/edit-buffer.ts`) deletes the pending entry of every cell the result names `ok` and drops every committed insert, so a cell edited after `buildBatch()` and before the commit resolves is silently discarded: the disk keeps the batch value and the baseline moves to it. The modal hid this for batches over five rows; a sub-second window hid it for the rest. Removing the modal without a guard turns a hidden race into a reachable data loss.

**Found, not claimed.** A range paste never reaches the buffer, locked or not. Tabulator 6.5.3's `range` paste action writes through `row.updateData`, which calls `cell.setValueProcessData` and fires no `cellEdited`, so `grid-view.ts` never hears it; `tests/tabulator-mock.ts` fires `cellEdited` from `setValue`, which is why "paste bursts group into one undo entry" passes. A pasted value shows until the next `refreshData` and is never saved. That is a defect in the grid's paste, not an item of §16.4, and this plan neither depends on nor fixes it; range-clear (`Range.clearValues` → `cell.setValue`) does fire `cellEdited`.

**Related.** studio.md §16.1 (tiers), §16.3 (the Activity tab), §13.5 (running activities are not idle), site-architecture.md §7.2 (the collection grid). No `requires` edge: `plan:ui/studio-toast-host` changes how a toast renders, not `notify`'s API this plan calls, and `plan:studio/panel-scheduler-text` rewrites §13.5's source list, which this plan neither adds to nor removes from.

## Outcome

- studio.md §16.4 → Implemented. `showProgressModal` has exactly four callers, all dependency installs, and a test says so.
- A grid save still running after a moment is an Activity entry (source "Data", title `Save <source label>`, steps for writing and reloading); a fast one leaves no entry. Either way success is announced once and a failure is one keyed Problem.
- The grid being saved refuses edits until the save ends; the rest of Studio does not wait.

## Decisions

- **Decided:** the save calls `beginActivity` directly and `grid-controller.ts` stops importing `ui/progress-modal.ts`, because studio.md §16.4 and studio-ui-guidelines.md §13.3 rule 2 reserve blocking for an operation that cannot proceed while the author edits, and a grid save blocks only its own grid.
- **Open:** when does a save earn an entry? Recommendation: when it is still running after `SAVE_ACTIVITY_DELAY_MS` (600 ms, the Library scan's threshold), not by row count, because "long" is a duration: a connector save is one request per row, so three rows over a slow link are long while fifty local frontmatter rewrites are not; and an entry for every save would spend the list's twenty finished slots (`MAX_FINISHED_ACTIVITIES`) on saves nobody waited for, pushing an install's log off the list. `probe.idle()` loses nothing in the first 600 ms, because every source's commit writes through `getPlatform()`, whose in-flight calls the predicate already counts, and the predicate asks for two consecutive quiet animation frames, which the microtask gap between two of a commit's writes does not span (a save of five rows or fewer has relied on exactly that since the modal existed).
- **Open:** is the grid editable while its own save runs? Recommendation: no. The grid being saved is read-only until the save ends (its edit buttons disabled, its cells refusing input, undo and redo off) and everything else in Studio stays usable, because `applyCommitResult` would otherwise discard edits made mid-save (see Context), and the alternative, rebasing those edits onto the committed rows, needs a temp-key-to-row-key transfer the connector source cannot always supply (`newKey` is optional in `CommitResult`).
- **Decided:** the lock lives in the edit buffer, because every edit path that reaches the buffer (the cell editor, the image/reference popover, range-clear, Fill Down, Replace All, Delete Rows, Discard Row, the tab's history delegate) ends in a buffer mutator, so one flag covers the paths that exist and the ones added later. `insertRow` is not gated: a new temp key is outside any in-flight batch, and gating it would change the return type `addRow` and `stageRedirectImport` rely on.
- **Decided:** no Cancel, because `GridSource.commit(batch)` takes no signal, so a button could stop only the waiting, and `ActivityOptions.cancel`'s own contract forbids a Cancel that does not stop the work. Adding a signal is a four-source contract change this section does not ask for.
- **Decided:** nothing is announced twice (studio-ui-guidelines.md §13.3 rule 3). With an entry, success is `done("Saved N change(s).")` and no toast; without one, the toast stays as today. A failure is the same Problem whichever path raises it: `source: "Data"`, `key: "grid.save"`, `action: "file.save"`, the per-change reasons as `detail`. That needs `ActivityHandle.fail` to accept `key`, a one-line additive change.
- **Decided:** the entry's source is "Data", not "Grid" as the stub suggested, because `fail()` files its Problem under the entry's source and every Problem the grid already raises (required cells, stale rows, save failures) is filed under "Data".
- **Decided:** closing the grid tab mid-save needs no guard: no source defines `dispose`, `syncView` is a no-op once `grid-view.ts` unbinds, and the entry is global, so the save finishes and records its outcome.

## Implementation

Paths under `packages/studio/`.

1. `src/panels/activity-panel.ts`: widen `ActivityHandle.fail` to `(message: string, opts?: { action?: string; key?: string; path?: string })` and pass `key` through to `notify.error` beside `action` and `path`. Update the member's doc comment (a repeat of the same failure replaces its Problem, studio.md §16.1 rule 3).
2. `src/grid/edit-buffer.ts`: add `locked: boolean` to `EditBufferState` (initialised `false` in the reactive state, so the view and the panel effect can track it) and `setLocked(locked: boolean): void` and `isLocked(): boolean` to `EditBuffer`. While locked, `setCell`, `deleteRow` and `discardRow` return without effect, `undo`/`redo` return `false`, and `canUndo`/`canRedo` return `false`. `insertRow`, `applyCommitResult`, `markStale`, `reset`, `buildBatch` and every reader are unaffected; the save itself calls the first four. Add a sentence to the header saying a save locks the buffer for its duration and why.
3. `src/grid/grid-controller.ts`:
   - Drop the `showProgressModal` import; import `beginActivity` and `type ActivityHandle` from `../panels/activity-panel`.
   - Export `SAVE_ACTIVITY_DELAY_MS = 600`, documented as the Library scan's threshold and citing studio.md §16.4.
   - In `save()`, replace `affectedRows` and `progress` with: `buffer.setLocked(true)` beside `state.saving = true`; a `write` label, `Write N change(s)` from `changeCount`, and a `phase` variable starting at it; and a `setTimeout` that, after `SAVE_ACTIVITY_DELAY_MS`, opens `beginActivity({ source: "Data", status: write, steps: [write], title })`, where `title` is `Save ` followed by `source.label`, into a `slow.handle` holder (the `loadLibrary` shape) and calls `step(phase)`. When the commit is structural, set `phase = "Reload rows"` and call `slow.handle?.step(phase)` before `reloadRows()`. An entry the timer opens during the reload therefore declares the write step and gets `Reload rows` appended by `step`, which marks the write done.
   - A module-level pure `commitFailureLines(result: CommitResult): string[]`: one line per refused change, `${rowKey} · ${field}: ${error}` for a cell, `New row: ${error}` for an insert, `${rowKey}: ${error}` for a delete (`error ?? "Save failed"`).
   - A local `reportFailure(message, lines)`: with an entry, `log` each line then `fail(message, { action: "file.save", key: "grid.save" })` (log first: `fail` snapshots the log into `detail`); without one, `notify.error(message, { action: "file.save", detail: lines.join("\n"), key: "grid.save", source: "Data" })`. The partial commit reports its existing sentence with `commitFailureLines(result)`; the catch reports `"Could not save the grid."` with `[errorMessage(error)]`.
   - Full success: `slow.handle ? slow.handle.done(sentence) : notify.success(sentence, { key: "grid.save" })`.
   - `finally`: `clearTimeout(timer)`, `state.saving = false`, `buffer.setLocked(false)`, then `syncView()` (which also repaints over anything a paste drew during the save).
   - `replaceAll`: return `0` when `buffer.isLocked()`, so its caller never reports replacements the buffer refused.
   - Update the header's save sentence: validate, confirm deletes, lock and commit (an Activity entry if it runs long), clear or re-baseline, unlock.
4. `src/grid/grid-view.ts`: `cellEditable` adds `&& !buffer.isLocked()` (covers the editor and the popover's dblclick). The `cellEdited` handler, when locked, writes `buffer.effectiveValue(rowKey, field)` back into the cell under `suppress` (the move its coercion branch already makes) and returns, because range-clear (`Range.clearValues` → `cell.setValue`) fires `cellEdited` without consulting `editable`. The popover's `commit` callback (a popover opened before the save can commit during it) and `fillDown` return early when locked. A range paste draws into the table without reaching the buffer (Context), and the `finally`'s `syncView()` repaints it away.
5. `src/grid/grid-panel.ts`: `projectPanel` adds `editDisabled: state.saving`, and `missingView()` adds `editDisabled: true`. `src/surfaces/grid-panel.ts`: add `editDisabled` to `GridPanelView`, to `project()`, and to the default view (`false`). `src/surfaces/grid-panel.json`: bind `"disabled": { "$ref": "#/state/editDisabled" }` in the `$props` of `add-row`, `delete-rows`, `fill-down` and `replace`, the way `save` binds `saveDisabled`. `tests/grid-surfaces.test.ts`'s `GRID_VIEW` fixture gains `editDisabled: false`, or the typecheck fails.
6. Tests: delete the `ui/progress-modal.js` mocks from `tests/grid-view.test.ts`, `tests/redirects-grid.test.ts` and `tests/grid-coverage-gaps.test.ts`. The grid tests use the real activity store (`activities`, `resetActivities()` in `beforeEach`), as `tests/publish-commands.test.ts` does; if a file's partial `ui/layers.js` mock now misses an export the activity-panel graph imports, add the export to the mock rather than doubling `panels/activity-panel.js`.

**Integration contract.** Once this lands: `ActivityHandle.fail` accepts `key`, and any caller may dedupe an Activity failure's Problem with it. `EditBuffer.setLocked`/`isLocked` exist and every buffer mutator except `insertRow` refuses while locked; `GridController.state.saving` and `buffer.isLocked()` are true for exactly the span of a commit. `SAVE_ACTIVITY_DELAY_MS` is exported from `grid/grid-controller.ts`. `showProgressModal`'s callers are exactly `packages/ensure-deps.ts`, `packages/pull-package-sync.ts`, `packages/jxsuite-update.ts` and `settings/dependencies-editor.ts`, and `tests/progress-modal.test.ts` fails on a fifth. studio.md §16.4 reads Implemented and states the delayed-entry rule and the grid's read-only save.

## Tests

`packages/studio`: `bun test --isolate --coverage` from the workspace, then `bun scripts/check-coverage-manifest.ts packages/studio` from the root.

- `tests/grid-controller.test.ts` records whole `NotifyCall`s (`notifyModule((call) => calls.push(call))`, with `statusCalls` read as `calls.map((c) => c.message)`), because the cases below assert a notification's `key`, `source`, `action` and `detail`, and replaces "shows a progress modal for larger batches and a save error toast on throw" with:
  - "a save still running after SAVE_ACTIVITY_DELAY_MS is a Data activity and opens no modal": six inserts, a commit held on a deferred, `setTimeout` stubbed to fire that delay at 0 (the `library-pane.test.ts` shape). One running entry titled `Save <label>` with source "Data" and the write step running; the kept `progressOpens` counter stays 0. Resolving ends it `done` with status `Saved 6 change(s).` and no `Saved` toast recorded.
  - "a fast save opens no entry and toasts as before": the default commit, `activities` empty, `Saved 1 change(s).` recorded.
  - "a slow save that throws fails its entry into one keyed Problem": the entry `failed`; the recorded error has message `Could not save the grid.`, key `grid.save`, source "Data", action `file.save`, and `io` in its detail; a second failing save records the same key (the file mocks `notify`, so the one-row dedupe itself is asserted in `activity-panel.test.ts`).
  - "a fast failure raises the same Problem without an entry": same assertions, `activities` empty.
  - "a slow partial commit logs one line per refused change": the entry's log and the Problem's detail both hold the `a · title: locked` line.
  - "the buffer is locked for exactly the span of the commit": during the held commit `isLocked()` is true, `setCell` changes nothing, `replaceAll` returns 0 and the history delegate's `canUndo` is false; after it resolves, and after a throwing commit, the buffer is unlocked and edits land.
- `tests/grid-edit-buffer.test.ts`, "a locked buffer refuses cell edits, deletes, discards and history, and still takes an insert and a commit result".
- `tests/grid-view.test.ts`, "a locked buffer makes every cell uneditable and repaints an edit back": `titleDef.editable(cell)` is false while locked; a `cellEdited` with a new value (what range-clear fires) leaves the buffer clean and the cell showing the effective value; `fillDown` is a no-op.
- `tests/grid-view.test.ts`, in "popover cells and insert-only columns", "a popover opened before a save cannot commit during it": open the popover on an image cell, lock the buffer, call the captured `popoverCalls[0]!.commit`; the buffer stays clean and the cell keeps its value.
- `tests/grid-panel.test.ts`: extend "a toolbar repaint keeps the engine and its host node" (it already sets `state.saving`) to assert `add-row`, `delete-rows`, `fill-down` and `replace` carry `disabled` while saving and lose it after.
- `tests/activity-panel.test.ts`, "fail passes its key to the Problem, so a repeated failure is one row".
- `tests/progress-modal.test.ts`, "only the four dependency-install modules open the blocking modal": `new Bun.Glob("src/**/*.ts").scan({ cwd: join(import.meta.dir, "..") })`, so the case does not depend on the runner's cwd, files whose text contains `showProgressModal(` other than `src/ui/progress-modal.ts`, equal to the four paths.

Coverage: `packages/studio/bunfig.toml` gates each file at `lines = 0.958, functions = 0.941`. The new functions (`setLocked`, `isLocked`, `commitFailureLines`, `reportFailure`, the timer callback) are each reached by a case above. No source file is added, so the manifest check is unchanged. Ratchet the threshold if the worst file rises.

## Specs & docs

- **studio.md §16.4, marker:** replace the Partial blockquote with `> **Status: Implemented.**`.
- **studio.md §16.4, body, in place:** after the first paragraph's last sentence ("An entry outlives the operation…"), add: "An operation that is usually instant opens its entry only once it has run long enough to be noticed (a Library scan, a grid save), so the finished entries the list keeps are not spent on work nobody waited for; one that ends sooner leaves no entry, and its failure is the same Problem the entry would have raised." After the "Blocking is retained for dependency installation only" paragraph, add: "A grid save shows why the rule holds. It writes the grid's own pending state, so the grid being saved refuses edits until the save ends and nothing else waits; it offers no Cancel, because a source's commit cannot be stopped between writes."
- **Fragment:** `bun run spec:change studio.md minor -m "§16.4 A grid save no longer blocks: a save still running after a moment is an Activity entry whose failure is one keyed Problem, the grid being saved refuses edits until it ends, and dependency installation is the only operation that opens the blocking modal."`
- **Docs pages** (no em dashes):
  - `docs/studio/interface/problems-and-progress.md` (`spec: studio.md#16`; `code:` lists `activity-panel.ts`): in "Activity", the opening list of examples gains "a grid save that takes more than a moment", followed by one sentence: operations that are usually instant, like saving a grid or scanning the Library, only get a row once they've run long enough to notice, so quick ones don't push older records off the list. "What still blocks" is already right and stays.
  - `docs/studio/editing/grid.md` (`code:` lists `grid-controller.ts`, `grid-view.ts`, `grid-panel.ts`, `surfaces/grid-panel.ts`): in "Save, in one batch", after the first paragraph: "While a save runs, the grid you're saving is read-only and its edit buttons are disabled; the rest of Studio stays usable. A save that takes more than a moment shows in the **Activity** tab of the Bottom dock, and if it fails, the reason is a Problem you can open."
  - `docs/studio/data/grid.md` (`code:` lists `grid-panel.ts`): after "each row becomes its own write to the database", add that a large batch against a remote database can take a while, shows in **Activity** while it runs, and the grid is read-only until it finishes.
  - `docs/studio/editing.md` (its `code:` lists `grid-panel.ts`) and `docs/studio/interface.md` (its `spec:` cites `studio.md#16`): no change; neither describes saving or blocking. No page lists `edit-buffer.ts`.
- **Graduation:** none; studio.md keeps other open items.
- **Plan:** the landing pull request deletes this file.

## Acceptance

- `grep -rln "showProgressModal(" packages/studio/src` prints `ui/progress-modal.ts` and the four dependency-install modules, nothing under `grid/`.
- From `packages/studio`: `bun test --isolate --coverage` passes with the thresholds holding; from the root, `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass; `bun run plans:status --spec studio` no longer lists §16.4.
- In Studio: open a collection grid, edit six rows, Save. No dialog appears. Throttle the platform (or use a connector table over a slow link) and save again: the Activity tab shows `Save <collection>` with its write step, the grid's cells and Add Row, Delete Rows, Fill Down and Replace refuse input until it ends, other panes and tabs stay usable, and on completion the entry reads `Saved N change(s).` with no toast. Make a row fail (open its file in a tab with unsaved changes) and save twice: one "Data" Problem, whose detail names the row.
