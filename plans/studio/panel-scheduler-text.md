---
status: drafted
disposition: reconcile
claims:
  - studio.md#13.5
  - studio.md#16.5
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
  - scripts/screenshots
size: S
---

# The Enforcement and Inline-errors sections describe Studio after the panel scheduler

## Context

Two sections describe one deleted module, `packages/studio/src/panels/panel-scheduler.ts` (removed in d257789a with the last lit docks), so one plan holds both: each rewrite is a statement about the same removal, and they must agree.

`specs/studio.md` §13.5, line 1426 (unmarked before the census):

> **Status: Partial.** The checks, the three tests, `__jxAutomation`'s three rules, the three `?automation=1` exceptions and the modal refusal ship (`packages/studio/src/services/automation.ts`, `scripts/screenshots/lib/shot.ts`). The text names a quiescence source that is gone: `packages/studio/src/services/idle.ts` has six, its seventh having left with the deleted panel scheduler (`panel-scheduler.ts`); and `scripts/check-icons.ts` is `packages/studio/scripts/check-icons.ts`.

`specs/studio.md` §16.5, line 1646 (unmarked before the census):

> **Status: Partial.** Host diagnostics winning over the schema check, an untouched form painting nothing and the two write policies ship (`packages/studio/src/ui/schema-form.ts`). The third paragraph is stale: the focus guard (`panels/panel-scheduler.ts`) was deleted, nothing defers or withholds a panel render, and the Navigator and Inspector skip binding writes that did not change instead (`services/idle.ts`, `panels/right-panel.ts` and `panels/left-panel.ts` record the removal).

Verified on 2026-09-27 (paths under `packages/studio/` unless named):

- **§13.5's quiescence paragraph** (line 1468) says "seven subsystems" and lists "no panel scheduler holding a frame or withholding a render (`panel-scheduler.ts`)". `defaultIdleSources()` in `src/services/idle.ts` returns six: `render` (`store.ts` `rendersInFlight`), `canvas` (`canvas/iframe-host.ts`), `platform` (`platform.ts`, counted by the proxy `getPlatform()` returns), `overlay` (`ui/layers.ts`), `activity` (`panels/activity-panel.ts`) and `grid`. The grid source is `grid/grid-idle.ts` (`gridIdleBlockers`), which `grid/grid-view.ts` registers each table with; the spec cites only `grid-view.ts`. `tests/idle.test.ts` ("names the six subsystems and is quiet in a bare page") pins the six names.
- **§13.5's table**: `scripts/check-icons.ts` does not exist; the check is `packages/studio/scripts/check-icons.ts`, run in `checks` as `bun --cwd packages/studio scripts/check-icons.ts` (`.github/workflows/test.yml`). The other three script rows are at the repository root and hold.
- **§16.5's third paragraph** ("Panels defer a render while one of their own fields has focus … and that deferral is now visible rather than silent") describes nothing that runs. Every Navigator and Inspector field is a control in a mounted document, and the runtime's `bindProperty` (`packages/runtime/src/runtime.ts`) skips a write when `target[key] === resolved`, so a re-projection never rewrites a control that already holds the value. The visible half is dead: `styles/overlays.css` lines 246 to 268 still style `[data-jx-stale]` ("New changes — applied when you finish editing"), and nothing sets that attribute. `docs/studio/interface/problems-and-progress.md` ("Errors at the field") still tells readers about the yellow **New changes** strip.
- **The behavioural question the stub raised** (what holds when a value moves under a focused field) has a code answer. The Content tab projects every text row as `getFieldValue(draftKey, committed)` (`src/panels/properties-panel.ts`, `src/ui/field-input.ts`). A draft lives from the first keystroke until `change` (blur or Enter) commits and clears it through `commitField`; a pause in typing also writes it (`scheduleDraftCommit`, `LIVE_PREVIEW` or `INPUT_DEBOUNCE` per row), and the draft outlives that write. So a collaborator's edit arriving through `applyExternalDocOps` (`src/tabs/transact.ts`) re-projects the tab, the row still resolves to the draft, and the author's text stays; the field's next write (the next pause, or the `change`) puts it over the moved value. A field with no live draft takes the moved value. No test asserts either half; `tests/properties-panel.test.ts` pins only that a draft is keyed to its node ("a draft on one element does not appear on the next").
- **The undo corner.** `edit.undo` is a `global` key scope record, so ⌘Z pressed inside a Content field runs the document undo. With a live draft the field keeps the typed text, and leaving the field writes it back as a new step, which discards the redo entry. Clicking the Command Bar's Undo blurs the field first, so the draft lands and is then undone. See Decisions.
- **Stale present-tense comments** naming the deleted module as live: `src/panels/properties-panel.ts` (header, "It does not go through the panel scheduler"), `src/panels/elements-panel.ts` (header), `src/panels/events-panel.ts` (header, "This tab does not go through the Inspector's scheduler", and `watch()`'s doc, "its focus guard exists"), `src/panels/style-panel.ts` (header and `bindStyleHost`'s doc), `src/surfaces/style-panel.ts` (header), `src/surfaces/panel-page.ts` (`renderPagePanelSurface`'s doc). Two more describe the left dock's scheduler, which went with it: `src/panels/panel-registry.ts` (`NavigatorPanelContext.rerender`, "`left-panel.ts`'s scheduler, not a synchronous re-render", while `left-panel.ts` now passes its synchronous `render`) and `src/panels/layers-panel.ts` (the comment above `_outlineRerender`, "the Navigator's scheduler"). `src/services/idle.ts`'s header says "the five subsystems" and `IdleSource.name`'s doc lists four names. `scripts/screenshots/README.md` line 158 lists "pending panel-scheduler frames" among what `probe.idle()` reports.
- **Editorial ride-along** (assigned here by `plans/studio/README.md`): §16.6 line 1662 names "`jx build`" as the second judge of the popover rules. Only `packages/compiler/src/site/validate-command.ts` imports `findPopoverDefects`, run by `jx validate` (`packages/compiler/src/cli.ts`), as §16.6's own later paragraph says.

## Outcome

- studio.md §13.5 → Implemented. The quiescence paragraph lists the sources `defaultIdleSources()` returns, with no count and no panel scheduler; the table cites `packages/studio/scripts/check-icons.ts`.
- studio.md §16.5 → Implemented. The third paragraph says that nothing withholds a render and why, and states the draft rule for a value that moves under a focused field. Four new cases in `tests/properties-panel.test.ts` pin that rule. The heading keeps its words and the paragraph says what became of the withheld render.
- §16.6 names `jx validate` (unmarked, editorial).
- The dead `[data-jx-stale]` rule, the stale comments, the screenshots README line and the docs tip go. No behaviour changes.

## Decisions

- **Decided:** a live Content-tab draft keeps winning over a value that moves beneath it, and §16.5 says so, because it is the deleted paragraph's own rule ("finishing the author's sentence beats being current"), now held per field instead of per panel, and it is what `field-input.ts` exists for. Replacing the draft would throw away typed text that was never a transaction, so no undo could bring it back. The moved value is not lost either: the canvas shows it, and it is the state the draft's write is undone to.
- **Open:** should a field whose live draft differs from the document be marked, as the retired panel strip was? Recommendation: no. Delete the dead `[data-jx-stale]` rule and the docs tip. The strip existed because a whole panel sat behind; now the only thing behind is the one field the author is typing in, its content is the author's own text, and the moved value is already visible on the canvas. A marker would also have to decide when an echo of the draft's own debounced write counts as "different", which is a heuristic with no user-visible payoff.
- **Decided:** ⌘Z pressed inside a Content field that holds a live draft (the undo corner above) is not fixed here. `plan:studio-ui-guidelines/debounce-draft-layer` already carries it, as its Open decision on a write still pending at ⌘Z, whose recommended registry of pending field writes spans every writer in its site table, not only the Content tab. One fact for that design, from this plan's reading: flushing the draft layer's timers is not enough, because `scheduleDraftCommit` keeps the draft after it writes, so the field would still show the typed text after the undo and leaving it would write it back; the flush must `commitField` (write and clear) each live draft. The §16.5 text below promises nothing about undo and holds either way. Fixing only the Content tab here (committing `field-input.ts`'s drafts in `undoDocument` and `redoDocument`, `src/editor/shortcuts.ts`) would change behaviour and make this plan `implement`, a second owner for one question.
- **Decided:** no `requires` on `plan:studio-ui-guidelines/retire-renderer-registry`. The §13.5 text below is true today, and it names no count: `defaultIdleSources()` is the list, each source is one clause, and `tests/idle.test.ts` pins the names. If RR1.4 deletes the `render` source (its Open decision), that pull request deletes the "no renderer mid-paint (`store.ts`)" clause and the name in `tests/idle.test.ts`. Its Specs & docs should list that §13.5 edit; the retire-renderer-registry plan does not yet say so. If RR1.4 lands first, this plan writes one clause per source `defaultIdleSources()` returns at that time.
- **Decided:** the pinning tests use a collaborator's edit (`applyExternalDocOps`) as the value that moves, not an undo, because the undo interaction is still open in `plan:studio-ui-guidelines/debounce-draft-layer` and a test must not bless either answer before it is signed.
- **Decided:** one plan, `reconcile`. The code steps (four test cases, one dead CSS rule, comments) change no behaviour, so both claims share a disposition and nothing forces a split.

## Implementation

One pull request. Paths under `packages/studio/` unless they start with `specs/`, `docs/` or `scripts/`.

1. **`specs/studio.md`**: the edits under Specs & docs.
2. **`tests/properties-panel.test.ts`**: the new describe (see Tests). Import `applyExternalDocOps` and `undo` from `../src/tabs/transact`. Reuse the file's `openDoc`, `renderPanel`, `control`, `type`, `commit` and `docNow` helpers.
3. **`styles/overlays.css`**: delete the comment and the two `[data-jx-stale]` rules (lines 246 to 268).
4. **Comments, no code**:
   - `src/services/idle.ts`: the header's "asked of the five subsystems that can still be mid-flight" becomes "asked of every subsystem that can still be mid-flight"; `IdleSource.name`'s doc becomes "Stable name, one per entry of {@link defaultIdleSources}."
   - Every present-tense sentence about `panels/panel-scheduler.ts` or the left dock's scheduler listed under Context becomes past tense (`panel-registry.ts`'s `rerender` doc says it repaints the Navigator synchronously), naming the module as deleted and keeping the argument (a lit repaint replaced the focused control; a document binding skips an equal write). For example, `src/panels/style-panel.ts`'s `bindStyleHost` doc: "It must NOT be routed through `panels/panel-scheduler.ts` — that scheduler defers …" becomes "The deleted `panels/panel-scheduler.ts` deferred a repaint while a field in the dock had focus, because a lit render of the whole panel replaced the node the reader was typing into; here that deferral would only have made the canvas lag the keystroke." Where a comment cites the spec for this, it cites §16.5 (bare `§` is `studio.md` in this package).
5. **`scripts/screenshots/README.md`**, line 158: "queued lit renders, pending panel-scheduler frames, unacked canvas generations _per host_, in-flight platform I/O" becomes "renderers mid-paint, unacked canvas generations _per host_, in-flight platform I/O, overlays still settling, running Activity entries and grids still drawing (`defaultIdleSources()` in `packages/studio/src/services/idle.ts` is the list)".
6. **`docs/studio/interface/problems-and-progress.md`**: the edit under Specs & docs.
7. The fragment, and the deletion of this file.

**Integration contract.** Once this lands:

- studio.md §13.5 lists the idle sources one clause each, in `defaultIdleSources()` order, with no count. A plan that adds or removes a source (RR1.4) edits its clause and the name list in `tests/idle.test.ts` in the same pull request.
- studio.md §16.5 states the draft rule quoted under Specs & docs, and `tests/properties-panel.test.ts`'s "a value that moves under a focused field" describe pins it. `plan:studio-ui-guidelines/debounce-draft-layer` and any plan that changes how the Content tab commits keep those cases green, or change §16.5 in the same pull request.
- `[data-jx-stale]` no longer exists; nothing may set it.

## Tests

`bun test --isolate --coverage` from `packages/studio`. The file already imports `./harness` first.

New describe in `tests/properties-panel.test.ts`, "a value that moves under a focused field (§16.5)". Each case opens `{ children: [{ className: "first", tagName: "p" }], tagName: "div" }` with the selection `["children", 0]` and renders:

- "a commit updates the tab in place, leaving the control being typed in standing": hold `control(c, "className")`, `commit(it, "next")`, `renderPanel()`; `control(c, "className")` is the same node (`toBe`), its value is `"next"`, and `docNow()` has `className: "next"`.
- "a collaborator's edit under a live draft leaves the author's text on screen": `type(control(c, "className"), "mine")` without committing, then `applyExternalDocOps(tab, [{ key: "className", op: "set-key", path: ["children", 0], value: "theirs" }])` and `renderPanel()`; the control reads `"mine"` and the document reads `"theirs"`.
- "leaving the field writes the draft over the moved value, as one undoable step": continue the previous setup, then `commit(control(c, "className"), "mine")`; the document reads `"mine"`. After one `undo(tab)` and `renderPanel()`, the document and the control both read `"theirs"`.
- "a field with no live draft shows the moved value": `control(c, "className").focus()` without typing, then the same `applyExternalDocOps`; after `renderPanel()` the control reads `"theirs"`.

The three draft cases assert synchronously, well inside the row's 350 ms `LIVE_PREVIEW` debounce (`flush` is `setTimeout(0)` turns), so the pending pause write never lands mid-case, and the file's `afterEach` (`bindContentHost(null)`, which `clearDraft`s every key it minted) cancels it before the next case.

No source file is added, and no statement is added or removed (comments and CSS only), so no per-file figure moves. `coverageThreshold` in `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`) stays, and the manifest check is unaffected. Also green: `bun --cwd packages/studio run lint:styles` (`scripts/check-styles.ts`: hex literals, orphan classes and the Spectrum ban; an unused rule is none of them, and the deleted rule's only hex was a `var()` fallback), `bun --cwd packages/studio run styles:check` (`overlays.css` is not one of the three generated sheets, so it is unaffected) and `bun --cwd packages/studio scripts/check-icons.ts`.

## Specs & docs

`specs/studio.md`, in place; no heading is renumbered or retitled.

- **§13.5 marker** becomes:

  > **Status: Implemented.** The checks, the three tests, `__jxAutomation`'s three rules, the three `?automation=1` exceptions, the modal refusal and the idle predicate ship (`packages/studio/src/services/automation.ts`, `src/services/idle.ts`, `scripts/screenshots/lib/shot.ts`; `packages/studio/tests/idle.test.ts`).

- **§13.5 table**: the fourth row's check becomes `packages/studio/scripts/check-icons.ts`. Re-pad the table with `bun run format`.
- **§13.5 quiescence paragraph** (line 1468): the sentence from "`probe.idle()` resolves once seven subsystems" to "(`grid-view.ts`)." becomes: "`probe.idle()` resolves once every subsystem that can still be mid-flight has been quiet for two consecutive animation frames. `defaultIdleSources()` is that list, one source per subsystem, each a function its owning module already had to write: no renderer mid-paint (`store.ts`), no unacked canvas generation or patch **per host** and no outstanding font/animation/image-retry reported by the frame itself (`iframe-host.ts`, folding the `{kind: "idle"}` message the canvas posts at its own rAF-quiet), no in-flight platform call (counted once, at `getPlatform()`, so every PAL method and every adapter is covered), no overlay still inside its settling window (`layers.ts`; a resting toast is not a blocker), no operation still RUNNING in the Activity tab (`activity-panel.ts`), and no grid still building or still laying out the selection range `selectableRange: 1` gives it (`grid-idle.ts`, which `grid-view.ts` registers each table with). No panel repaint is on the list: the Navigator and the Inspector are mounted documents that write within the task that changed their state and skip a value that did not move, so there is no queued frame and no withheld render to wait for (§16.5)." The two bold sentences after it are unchanged.
- **§16.5 marker** becomes:

  > **Status: Implemented.** `packages/studio/src/ui/schema-form.ts` (host diagnostics over the schema check, the untouched form, both write policies), `src/ui/field-input.ts` and `src/panels/properties-panel.ts` (the draft), `packages/runtime/src/runtime.ts` (`bindProperty` skips an equal write); `packages/studio/tests/schema-form.test.ts` ("inline errors"), `tests/properties-panel.test.ts`.

- **§16.5 third paragraph** ("Panels defer a render …") is replaced by two:
  - "**The withheld render is gone, and nothing replaced it.** Panels used to defer a repaint while one of their own fields had focus, because a lit repaint rebuilt the control being typed into and took the caret with it, and a strip across the panel said it was behind. Every Navigator and Inspector field is now a control in a mounted document (`studio-ui-guidelines.md` §9.3), bound one property at a time, and a binding skips a write equal to what the control already holds, so the re-projection a field's own commit provokes leaves that field, its caret and its selection standing. There is no deferred render to wait for, nothing for `probe.idle()` to count (§13.5), and nothing stale to announce."
  - "**A value that moves under a focused field is the draft's question, not the panel's.** A collaborator's edit or an assistant write can change the value a field edits while the author is typing into it. The Content tab keeps half-typed text in the per-node draft of §6.1 and projects the draft in place of the committed value, so while a draft is live the field keeps the author's text, and the field's next write (a pause in typing, leaving the field, or Enter) puts that text on top of the change as one step. A field with no live draft, in the Content tab or anywhere else, shows the moved value when it moves. Nothing marks a field whose draft differs from the document: what differs is the text the author is looking at, and the canvas already shows the value that moved."
- **§16.6**, "Its rules live in `@jxsuite/schema/overlays`": "this report, `jx build`, and the starter conformance test" becomes "this report, `jx validate`, and the starter conformance test".

**Fragment:** `bun run spec:change studio.md minor -m "§13.5 probe.idle() waits on the sources defaultIdleSources() lists, with no panel repaint among them, and check-icons.ts is cited under packages/studio/scripts; §16.5 nothing withholds a panel render, since a binding skips a value the control already holds, and a Content field's live draft keeps the author's text over a value that moves under it, writing it on its next pause or when the field is left; §16.6 names jx validate as the command that runs the popover rules."`

**Docs** (`bun run docs:sync` names these; docs pages ban em dashes, and the text below has none):

- `docs/studio/interface/problems-and-progress.md` (`spec: studio.md#16`), "Errors at the field": replace the `:::doc-tip` about the yellow **New changes** strip with ":::doc-tip A field in the Content tab keeps what you are typing even if the same value changes elsewhere in the meantime, for example when someone editing alongside you or the assistant changes it. Your text still wins: it is written when you pause, and again when you leave the field or press :kbd[Enter], each time as a step you can undo. :::" (the markers on their own lines). Add `packages/studio/src/ui/field-input.ts` to `code:`, since the tip now describes it. `plan:studio-ui-guidelines/inline-error-role` edits the bullets above the tip and leaves the tip to this plan; whichever lands second rebases.
- No change, and the pull request says so: `docs/studio/interface.md` (cites `studio.md#16`; says nothing about deferred renders), and the pages whose `code:` lists a file that only gains a comment: `docs/studio/design/properties.md`, `docs/studio/design/components.md`, `docs/studio/design/elements.md`, `docs/studio/editing/frontmatter.md`, `docs/studio/design/style-inspector.md`, `docs/studio/design/states-and-selectors.md`, `docs/studio/design/stylebook.md`, `docs/studio/logic.md`, `docs/studio/logic/events.md`, `docs/studio/design/repeaters.md`, `docs/studio/design/layers.md` and `docs/README.md`.

studio.md does not graduate here: other studio.md items stay open, so `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 13.5 /,/^## 14\. /p' specs/studio.md | grep -ciE "scheduler|seven subsystems|Status: Partial|\| .scripts/check-icons"` prints `0`; `sed -n '/^### 16.5 /,/^### 16.6 /p' specs/studio.md | grep -ciE "Status: Partial|Panels defer a render"` prints `0`; `grep -n "this report, .jx build" specs/studio.md` prints nothing.
- `bun run plans:status --who-claims studio.md#13.5` and `--who-claims studio.md#16.5` name no plan; `bun run plans:check --audit studio` reports nothing for either section.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass; `bun run spec:release --dry` mints a studio.md minor.
- `git grep -n "jx-stale" packages/studio` prints only the past-tense sentence in `src/panels/elements-panel.ts`, and `git grep -n "New changes" docs/studio` prints nothing.
- `git grep -n -A1 panel-scheduler packages/studio/src` (eleven hits today) reads in the past tense throughout; a line saying the module withholds, defers or must not be gone through is a missed site. `git grep -n "scheduler" packages/studio/src/panels/events-panel.ts packages/studio/src/panels/panel-registry.ts packages/studio/src/panels/layers-panel.ts` names no live scheduler.
- From `packages/studio`: `bun test --isolate --coverage tests/properties-panel.test.ts tests/idle.test.ts` passes, and the full `bun test --isolate --coverage` keeps every file above `coverageThreshold`.
- By hand, two Studio windows on one collab room: select a paragraph in both, type into the Content tab's Class field in one without leaving it, change the class from the other. The first field keeps its text; leaving it writes it, and the second window shows it.
