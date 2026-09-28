---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#12.2
requires: []
workspaces:
  - packages/studio
  - scripts
  - specs
  - docs
size: M
---

# The Command Bar keeps its labels at every width, and a crowded bar gives up whole commands to the Studio menu instead of hiding text

## Context

`specs/studio-ui-guidelines.md` §12.2, line 783:

> **Status: Partial.** The caps ship in `packages/studio/src/commands/budget.ts`, checked by `scripts/check-chrome-budget.ts` and, for the assistant, by `tests/ai-command-tools.test.ts`. The label stripping this section forbids still ships: `src/surfaces/commandbar.json` hides every primary button's label under `@container toolbar (max-width: 1140px)`.

The section's last paragraph (line 797) is the rule the code breaks: "Stripping labels is **not** a way to stay under the cap. A container query that hides every button's text below a breakpoint converts a crowding problem into an anonymity problem."

Verified at the current tree:

- **The stripping.** `packages/studio/src/surfaces/commandbar.json` lines 226 to 233: under `@container toolbar (max-width: 1140px)`, `[part="primary"] [part="text"]` and `[part="primary"] jx-button > [part="control"] > [part="label"]` are `display: none` and the control's `gap` is zeroed. The container is declared once, on `#toolbar` in `packages/studio/styles/shell-frame.json` (`container-type: inline-size`, `container-name: toolbar`; generated into `styles/shell-frame.css`), and this is the only `@container` rule in Studio.
- **What the cluster holds.** Four records declare `commandbar/primary` (`packages/studio/src/commands/defaults.ts`): `file.save` (group `1_file`), `edit.redo` and `edit.undo` (`1_history`), `view.openInBrowser` (`2_output`, hidden unless the project is a site). All four have icons. `projectPrimary` in `packages/studio/src/surfaces/commandbar.ts` projects them in registry order (group, then title: Save, Redo, Undo, Open in Browser, as `tests/commandbar.test.ts` asserts). Each is a `jx-button` whose `label` prop is the title (so `aria-label` is always the name) and whose slotted `[part="text"]` is the same title.
- **The caps** are as the marker says: `CHROME_BUDGET` (`commandbarPrimary` 5, `dockTabs` 4, `blockbarFormat` 8, `assistantTools` 30) in `budget.ts`, `checkChromeBudget` run by `scripts/check-chrome-budget.ts`, the assistant cap in `tests/ai-command-tools.test.ts`. Both `budget.ts`'s header (lines 9 to 11, "a container query at 1140px strips every `.tb-label`") and `check-chrome-budget.ts`'s header (lines 6 to 10) cite the stripping in the present tense.
- **Why the bar cannot wrap.** `#app`'s first grid row is a fixed `36px` and `#toolbar` is `overflow: hidden` (`styles/shell-frame.json`); in the desktop app the bar is also the window's drag region. `[part="primary"]`, `[part="layouts"]`, `[part="docks"]` and `[part="window-controls"]` are `flexShrink: 0`, and the Studio menu button keeps its min-content width; the Command Center pill is `flex: 0 1 520px; minWidth: 0` and the two spacers (`flex: 1`) only grow. The presence cluster is the exception: `minWidth: 0` with the default shrink, so it gives way beside the pill and its status text and chips then overflow it. So a crowded bar shrinks the pill (and presence) to nothing and then clips at its right edge, where the non-mac window controls sit. Removing the stripping alone would make the bar clip at a window wider by the four labels' width.
- **No minimum window width.** Neither `packages/desktop/src/window-manager.ts` nor the vendored Electrobun SDK sets one, so "the narrowest window the app allows" (§4.6's check) is the platform's own minimum.
- **The residue surface exists.** The ⬢ Studio menu is `forPlacement("commandbar/overflow")` drawn on the `menu` surface (`overflowRows` and `openStudioMenu` in `commandbar.ts`), each row carrying title, chord (`keymap.formatBinding`) and `requires`. The §12.1 matrix admits application, project and document there, a superset of `commandbar/primary`'s application and document.
- **Tests.** `packages/studio/tests/commandbar.test.ts` covers the cluster ("the primary cluster" suite), the Studio menu ("the ⬢ Studio menu": `openStudioMenu()`, `menuRows()`, `rowFor()` helpers) and the drag region. The harness has `installResizeObserver()` and `stubRect()` (`tests/harness.ts`); `src/utils/geometry.ts`'s `rectOf` is the one allowed `getBoundingClientRect` call site (guarded by `tests/geometry.test.ts`).
- **Screenshots.** No shot in `scripts/screenshots/manifest.json` is narrower than 1280px (viewports are 1280, 1440 and 1920), and the 1280px shot captures `pane.primary/tabs`, not the bar, so no committed image shows the stripped state.

## Outcome

- studio-ui-guidelines.md §12.2 → Implemented: no rule hides a primary button's words at any width, and §12.2 states what a crowded bar does instead.
- The spec stays Partial (§12.1, §12.3, §12.4, §12.5 and others remain open). Nothing graduates.

## Decisions

- **Open:** what a crowded bar gives up once labels stay. Recommendation: the Command Center pill shrinks first, to a floor of 200px; past that the primary cluster gives up whole commands a `group` at a time, the last group first (Open in Browser, then Undo and Redo together, then Save), and the ⬢ Studio menu draws each one it gave up at its top, above a divider, with the name, chord and `requires` the button printed; the layout tabs, the presence cluster, the dock toggles and the window controls never yield. Because the bar cannot wrap (a fixed 36px row that clips, and a drag region), a command left only to the palette and its chord loses its one-click route while the Studio menu is already §12.2's residue surface for exactly these records, and half of the Undo/Redo pair on screen is worse than neither. The alternative, palette-and-chord only, saves the menu change and is recorded here as the fallback if review prefers it. Removing the stripping with nothing yielding (the census stub's "crowding is answered by the budget") is not offered: the cap bounds the cluster at five, not its width, and the bar would clip its dock toggles and window controls at a wider window than today, which the Acceptance measurement forbids.
- **Decided:** the presence cluster stops shrinking (`flexShrink: 0`), so the pill is the only cluster that gives way. The fit measures the pill and the spacers; a presence cluster squeezed alongside the pill would overflow its own chips before any command yielded, and the slack could not see it.
- **Decided:** the fit is measured, not a breakpoint, because what else the bar holds varies (user-saved layouts are unbounded, the presence cluster comes and goes, three window-control layouts, the project's name in the pill) and a fixed width is exactly the guess this replaces. happy-dom lays nothing out, so the decision is a pure function over measured widths (`fitPrimary`) tested directly, and the wiring is tested with `installResizeObserver()` and `stubRect()`.
- **Decided:** a yielded unit comes back only when the slack covers its width plus 8px, because without a margin a window resized across the boundary would flicker a button in and out. After a yield the slack is below the unit's width and after a return it is at least the margin, so one measurement after the other writes nothing: the fit is a fixed point, not a loop. For the same reason `fit()` never schedules itself: what re-runs it is a resize of the host or of the cluster (both observed) or a re-projection, so a button that never draws cannot spin a frame loop.
- **Decided:** a host with no box (`clientWidth` 0) keeps every command, because happy-dom, a hidden host and the frame before first layout all read zero, and zero must not read as "no room". Every existing suite therefore sees the bar exactly as today.
- **Decided:** no record's `menus`, no matrix row and no cap changes. A yielded command still declares `commandbar/primary`; the menu is where that placement is drawn while the bar has no room, which §12.3 allows ("a placement chooses whether to show a record"). `scripts/check-command-levels.ts` is untouched and `scripts/check-chrome-budget.ts` changes only its header comment.
- **Decided:** the `jx-button`'s `label` prop stays the title. The visible text now always equals it, so the accessible name matches the label (WCAG SC 2.5.3) and there is still one name, and the suite's `btn()` helper reads the name there.
- **Decided:** the `toolbar` container declaration on `#toolbar` goes with its only query, because the audit's spec-wide rule is that dead rules leave in the pull request that stops the spec naming them. Dropping its containment is safe: the bar's tooltips and menus are top-layer popovers, which containment never held, and `#toolbar`'s `min-width: 0` with `overflow: hidden` already keeps its content out of the grid's track sizing. The real-browser pass confirms the frame is unchanged.

## Implementation

1. **`packages/studio/src/surfaces/commandbar.json`.** Delete the `"@container toolbar (max-width: 1140px)"` block (lines 226 to 233). `[part="primary"]` keeps `flexShrink: 0`: a button never shrinks, it leaves whole. `& [part="presence"]` gains `"flexShrink": "0"` (Decisions). In the root `$description`, `primary` becomes "what declared commandbar/primary and fits; the adapter hands the rest to the Studio menu".
2. **`packages/studio/styles/shell-frame.json`.** Remove `container-type` and `container-name` from `#toolbar`, then `bun run styles:sync` from `packages/studio` to regenerate `styles/shell-frame.css`.
3. **`packages/studio/src/surfaces/commandbar.ts`:**
   - `PrimaryProjection` gains `group: string`; `projectPrimary` fills it from `command.group ?? ""`.
   - Constants, each with a one-line reason: `PILL_FLOOR = 200` (the pill keeps this much before a command leaves), `FIT_HYSTERESIS = 8`, `CLUSTER_GAP = 2` (the `gap` of `[part="primary"]` in the document; say so in the comment).
   - Module state beside `_menu`: `_projected: PrimaryProjection[]` (the full projection), `_kept = Number.POSITIVE_INFINITY` (units kept), `_widths = new Map<string, number>()` (command id to drawn width plus `CLUSTER_GAP`), `_fitFrame = 0`, `_observer: ResizeObserver | null`.
   - `primaryUnits(projected)`: consecutive runs of equal `group`, as id arrays. `shownPrimary()` flattens the first `min(_kept, units)` units back into projections; `yieldedIds()` is the rest.
   - `export function fitPrimary(widths: readonly number[], kept: number, slack: number, hysteresis = FIT_HYSTERESIS): number`, pure: while `slack < 0 && kept > 0`, drop the last kept unit and add its width to `slack`; then while `kept < widths.length && slack >= widths[kept] + hysteresis`, take it back and subtract its width. Return `kept`.
   - `fit()`: return unless `_rootEl` has `clientWidth > 0`. Record the width of every rendered `[part="primary"] jx-button[data-command-id]` through `rectOf`. If any id in the current units has no recorded width (never drawn), set `_kept` to the unit count, write `scope.primary = shownPrimary()` and return: the drawn buttons resize the observed cluster, which runs the fit again against them. Otherwise `slack = Σ rectOf(spacer).width + rectOf([part="center"]).width − PILL_FLOOR − max(0, _rootEl.scrollWidth − _rootEl.clientWidth)`, `next = fitPrimary(unitWidths, min(_kept, units), slack)`, and only when `next` differs write `_kept`, `scope.primary = shownPrimary()` and `_menu?.setRows(studioMenuRows(registry))`. `fit()` never calls `scheduleFit()`.
   - `scheduleFit()`: one pending `requestAnimationFrame(fit)` at a time, the frame hop `src/ui/virtual-window.ts` uses (`measureNextFrame`), so the measurement reads the layout the last write produced and an observer callback never writes inside its own delivery.
   - `project()`: store `_projected = projectPrimary(registry)`, write `scope.primary = shownPrimary()`, set the open menu's rows through `studioMenuRows`, and end with `scheduleFit()` (a new layout tab, the presence cluster or a newly visible command changes the slack without resizing the host).
   - Rows: `overflowRows(registry)` becomes `menuRowsOf(registry, commands: readonly AnyCommand[])`, the same loop over a given list (title, chord, `requires`, `destructive`, `disabled`, a divider at each group change), so there is still one row builder in the module rather than a second. `studioMenuRows(registry)`: `menuRowsOf` over `forPlacement("commandbar/primary")` filtered to the yielded ids, then `menuRowsOf` over `forPlacement("commandbar/overflow")`, the first of which gets `dividerAbove: true` when anything was yielded. `openStudioMenu` and `project()` use it.
   - `mount()`: when `ResizeObserver` exists, one observer calling `scheduleFit` watches `rootEl` at once and the surface's `[part="primary"]` once `_mount` resolves (the element is static in the document). `unmount()`: disconnect it, `cancelAnimationFrame(_fitFrame)`, reset `_kept`, `_widths` and `_projected`.
   - Header comment: the sentence "the ⬢ Studio menu is `forPlacement("commandbar/overflow")`" gains "below whatever the primary cluster had no room for", and a bullet under "What is decided here" describes the fit, citing `studio-ui-guidelines.md` §12.2 qualified (a bare § in `packages/studio` means `studio.md`). `overflowRows`'s doc comment moves to `menuRowsOf`.
4. **`packages/studio/src/commands/budget.ts`**, header paragraph at lines 9 to 11: past tense, and no breakpoint number (the Acceptance grep holds the tree to that). The toolbar once hid every label below a breakpoint rather than concede it was crowded; the cap is what makes retiring a control cheap, and a crowded bar now gives up whole commands to the Studio menu (`studio-ui-guidelines.md` §12.2).
5. **`scripts/check-chrome-budget.ts`**, header lines 6 to 10: the same correction, also without the number.
6. **`plans/spec/README.md`**, if its "§18 and CSS Containment 3" bullet still exists (`plan:standards/citable-community-specifications` deletes it): that note cites `commandbar.json` and `styles/shell-frame.css` as Studio's own named container. Drop that example; the pass-through it illustrates (`resolveAtQuery`, `walkAt`) still holds.

**Integration contract.** Once this lands: no rule in any Command Bar document hides a primary button's text, and the pill is the only cluster that shrinks; `fitPrimary(widths, kept, slack, hysteresis?)` and `PrimaryProjection.group` are exported from `surfaces/commandbar.ts`; the Studio menu's rows are the yielded `commandbar/primary` rows followed by the `commandbar/overflow` rows, both built by `menuRowsOf`, so a plan that changes what a row prints changes it for both. `plan:studio-ui-guidelines/name-and-chord-gaps` turns `overflowRows` into `placementRows(registry, "commandbar/overflow")`; whichever of the two lands second reconciles: if that plan is first, `menuRowsOf` maps its `commandRow` over the list with the group-change divider (the yielded rows are not a placement, so `placementRows` cannot draw them), and if this one is first, that plan's step 4 replaces `menuRowsOf`'s loop with `commandRow` and keeps `studioMenuRows`. A test asserting the menu is exactly `commandbar/overflow` holds only while the bar fits, which an unlaid-out host always does. §12.2 carries the paragraph below.

## Tests

`packages/studio`, `bun test --isolate --coverage` from `packages/studio`. New cases in `tests/commandbar.test.ts`:

- `describe("fitPrimary")`, with widths `[66, 134, 130]` (Save; Redo and Undo; Open in Browser, each plus the gap):
  - `keeps every unit while the slack is not negative`: `fitPrimary(w, 3, 0)` is 3.
  - `gives up the last unit first, and as many as the shortfall needs`: slack −80 gives 2; −250 gives 1; −400 gives 0.
  - `takes a unit back only with room for it and the margin`: `fitPrimary(w, 2, 137)` is 2; `fitPrimary(w, 2, 138)` is 3.
- In "the primary cluster", two structural cases over `src/surfaces/commandbar.json` (§4.6's way: assert the structure, since happy-dom evaluates no container query), both red before the change:
  - `no rule in the document hides a primary button's words`: walk `style` recursively; no key naming `[part="text"]` or `[part="label"]` carries `display: "none"`, and no `@container` key remains.
  - `the pill is the only cluster that shrinks`: `[part="primary"]`, `[part="layouts"]`, `[part="presence"]`, `[part="docks"]` and `[part="window-controls"]` each carry `flexShrink: "0"`.
- `describe("a crowded bar")`, each with a site project and an open document in `ctx`, `installResizeObserver()` restored in `finally`, `stubRect` on the pill, the two spacers (width 0) and each button (Save 64, Redo 64, Undo 66, Open in Browser 128), and `clientWidth`/`scrollWidth` defined on the host, then `resize(root)`, one animation frame and `flush()` awaited:
  - `a narrow bar sends Open in Browser to the top of the Studio menu, and the rest keep their labels`: pill 120, no overflow. The cluster is Save, Redo, Undo, each `printedOf` containing its title; the opened menu's first row is `view.openInBrowser` with `⌘⇧O` in `[slot="value"]` (the suite's registry is `mac: true`), and the row of `forPlacement("commandbar/overflow")[0]` is preceded by the menu's `hr`.
  - `Undo and Redo leave together`: pill 0, `scrollWidth` 50 over `clientWidth`. The cluster is Save alone; the menu opens Redo, Undo, then Open in Browser below an `hr`.
  - `a yielded command that cannot act is listed disabled with its reason`: `canUndo: false`, crowded as above; the Undo row has `aria-disabled="true"` and `title` "a change to undo", as the gated-row case reads them.
  - `widening gives a command back, and not before there is room for it`: from the first case, pill 330 keeps Open in Browser in the menu; pill 340 returns it to the bar and the open menu drops it.
  - `a host with no box keeps every command`: `clientWidth` 0 with pill 0; all four stay.
  - `a command first drawn while crowded is measured, then placed`: mount with no document (Open in Browser alone, disabled) at pill 120, so it yields; set `ctx` with a document and call `toolbar.render()`. After one frame all four are drawn (Save, Redo and Undo had no width); stub the new buttons, `resize()` the `[part="primary"]` element, and after the next frame Open in Browser is in the menu and the other three are in the bar.
  - `unmount stops observing`: `observes(root)` and `observes(primaryEl)` are true after mount and false after `unmount()`.
  - `with no ResizeObserver the bar still fits on projection`: delete the global (restored in `finally`), mount crowded, `toolbar.render()`, one frame: Open in Browser has yielded.
- The existing "the ⬢ Studio menu" and "the primary cluster" suites pass unchanged, which is the assertion that a bar with room is today's bar.

**Coverage.** No new source file, so `bun scripts/check-coverage-manifest.ts packages/studio` is unaffected. `commandbar.ts` must stay at or above `coverageThreshold = { lines = 0.958, functions = 0.941 }` (`packages/studio/bunfig.toml`, per file); every new function and branch is reached by the cases above (the never-drawn branch by the first-drawn case, the no-observer branch by the last). Ratchet only if the run shows the workspace's worst file moved. `tests/geometry.test.ts` stays green because every rect read goes through `rectOf`; `clientWidth` and `scrollWidth` are not on its forbidden list.

## Specs & docs

**`specs/studio-ui-guidelines.md` §12.2**, in place:

- The marker becomes:

  > **Status: Implemented.** The caps ship in `packages/studio/src/commands/budget.ts`, checked by `scripts/check-chrome-budget.ts` and, for the assistant, by `tests/ai-command-tools.test.ts`. The Command Bar keeps every primary label at every width and yields whole commands to the Studio menu (`src/surfaces/commandbar.ts`, `tests/commandbar.test.ts`).

- After the "Stripping labels is **not** a way to stay under the cap" paragraph, add: "**A crowded bar gives up whole commands, never their words.** When the Command Bar is narrower than what it holds, the Command Center pill shrinks first, to a floor (`PILL_FLOOR`); past that, the primary cluster gives up whole commands a `group` at a time, the last group first, and the Studio menu draws each one above its own rows, divided from them, with the name, chord and `requires` the button printed; only once the cluster is empty does the pill go below its floor. The record's `menus` do not change: the menu is where the placement is drawn while the bar has no room, and it admits every level `commandbar/primary` does (§12.1). A command comes back once the bar has room for it and a margin, so the cluster does not flicker at the boundary. The fit is measured (`fitPrimary` in `src/surfaces/commandbar.ts`) rather than a breakpoint, because what else the bar holds (saved layouts, the presence cluster, the window controls) differs by project and platform. The pill is the only cluster that shrinks, and the layout tabs, the presence cluster, the dock toggles and the window controls never yield."

If review takes the palette-only fallback, the paragraph's menu clause becomes "each one stays in the palette and on its chord" and the §12.1 overflow note is untouched either way.

**Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§12.2: the Command Bar keeps every primary label at every width, and a crowded bar gives up whole commands, last group first, to the top of the Studio menu with their names and chords."`

**Docs** (no em dashes). `bun run docs:sync` names the four pages whose `code:` lists `commandbar.json` or `commandbar.ts`; none cites `studio-ui-guidelines.md#12.2`.

- `docs/studio/interface.md`, the verb-cluster bullet (line 48): append "In a narrow window the buttons keep their names, and the cluster makes room by moving whole buttons into the Studio menu: **Open in Browser** first, then **Undo** and **Redo** together, then **Save**. Each one sits at the top of the menu with its shortcut beside it, and returns to the bar once there is room." Line 59, "It is always there." becomes "It is always there: in the bar, or at the top of the Studio menu when the window is too narrow for its button."
- `docs/start/studio-tour.md`: no change; it names the four buttons and defers details to the interface page.
- `docs/studio/interface/modes.md` and `docs/studio/publish/collaboration.md`: no change; they list the bar's files for the mode switcher and the presence cluster, neither of which moves.
- Screenshots: the lane runs because `packages/studio/src/**` changes; no image is expected to move (no shot is narrower than 1280px). Re-read any page it reports.

No spec graduates; `plans/studio-ui-guidelines/` stays.

## Acceptance

- From `packages/studio`: `bun test --isolate --coverage` passes with the cases above and no per-file threshold failure; `bun run styles:check` passes; `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `git grep -n '1140\|@container' -- packages/studio/src packages/studio/styles scripts specs/studio-ui-guidelines.md specs/studio.md` prints nothing. (`spec.md` §18 may legitimately cite `@container` once `plan:standards/citable-community-specifications` lands.)
- In a real browser (the `packages/studio:verify` recipe: dev server plus Chrome DevTools), with a site project and a page open, at 1440, 1140, 1000, 860, 720 and 600 CSS px: every button in the cluster shows its label; the Studio menu's first rows are exactly the commands missing from the bar, with their chords; dragging the width back and forth across a boundary does not flicker a button; the console shows no `ResizeObserver loop` error. Measure the width at which the dock toggles start to clip on the base commit and on the branch: the branch's must not be larger.
- `sed -n '/^### 12\.2 /,/^### 12\.3 /p' specs/studio-ui-guidelines.md` shows the Implemented marker and the new paragraph; `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#12.2`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:section-refs` and `bun run docs:markdown` pass.
