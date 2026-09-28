---
status: drafted
disposition: reconcile
claims:
  - ui.md#5.5
requires: []
size: S
---

# §5.5's prose about Studio says what Studio does now, and the section is Implemented

## Context

`specs/ui.md` §5.5, line 284 (excerpt):

> **Status: Partial.** … none is built: two are folded onto elements that exist and three are dropped, each for the reason its row gives. Two sentences of the prose below say something the code does not: the audit paragraph says `panels/style-panel.ts` parses `var()` with a private regex beside `style/token-ref.ts`, where it imports `resolveTokenValue`, `toTokenRef` and `tokenRefName` from that module (`packages/studio/src/panels/style-panel.ts`), as the `jx-token-field` row already says; and the `jx-breakpoint-bar` row names `jx-split`'s side of the Edit column's snapping a "snap hook", where the paragraph on handles says the element's answer is not a snap hook but a modifier report, which is what `src/behaviors/split.ts` ships.

Every element §5.5 specifies ships and is adopted, and the five builder rows are folded or dropped rather than pending. What is stale is present-tense prose about Studio, and in each case another sentence of the same section already says what ships. The code is right, so the disposition is `reconcile`.

**Verified at the audited tree**

- The elements: `packages/ui/components/jx-tree.json`, `jx-tree-item.json`, `jx-toolbar.json`, `jx-split.json`; `packages/ui/src/behaviors/tree.ts`, `toolbar.ts`, `split.ts`; `packages/ui/tests/jx-tree.test.ts`, `toolbar.test.ts`, `split.test.ts`. Their declared props match the table rows (`jx-split`: `value`, `min`, `max`, `gap`, `step`, `largeStep`, `collapse`, `disabled`, `label`, `orientation`; `jx-tree`: `label`, `multiple`, `current`, `anchor`, `padtop`, `padbottom`).
- Adoption: `jx-toolbar` in `packages/studio/src/surfaces/grid-panel.json` and `stylebook-chrome.json`; `jx-split` in `surfaces/pane-grid.json`, `shell.json` (the three docks, driven by `src/ui/panel-resize.ts`) and `canvas-stage.json` (the Edit column, bound by `src/canvas/edit-width-drag.ts`).
- The `var()` grammar. `packages/studio/src/panels/style-panel.ts:115` imports `resolveTokenValue`, `toTokenRef` and `tokenRefName` from `../style/token-ref`, and uses them at `:866`, `:892`, `:930` and `:1193`. The only regular expression over `var(` in `packages/studio/src` and `packages/ui/src` is `TOKEN_REF_RE` in `src/style/token-ref.ts:19`. The panel's other patterns parse a length (`UNIT_RE` from `ui/unit-selector.ts`, three reads, as the `jx-dimension-field` row says), a template expression (`:531`) or a number (`:771`). `settings/css-vars-editor.ts` and `ui/color-selector.ts` import the same module.
- The modifier report. `announce(host, modifiersOf(event), …)` at `packages/ui/src/behaviors/split.ts:411`, `:444`, `:483` and `:503`, read back by the exported `splitModifiersOf` (`:125`). `bindSplit` in `packages/studio/src/ui/panel-resize.ts` passes `splitModifiersOf(event)` to `resolveValue`, which bounds, calls `ResizeTarget.snap` and bounds again. The Edit column's target (`edit-width-drag.ts:127`) returns the value unsnapped when `modifiers.altKey` is set. `setupHandle` survives only in history comments (`panel-resize.ts:32`, `panels/pane-grid.ts:45`, and three test comments: `tests/pane-grid.test.ts:403`, `tests/panel-resize.test.ts:16` and `:281`).

**Stale text, by line**

1. The audit paragraph (line 320): "The duplication the audit did find is on Studio's side and is a grammar, not a widget — `panels/style-panel.ts` parses `var()` with a private regex beside `style/token-ref.ts`, the module written for it — and a kit element is not how that is closed." It is closed, on Studio's side.
2. The `jx-breakpoint-bar` row (line 328): "The only element-side work in the set is the one the paragraph above names: `jx-split`'s snap hook and modifier state, which retires `setupHandle`". It has three faults. The work is done. The paragraph "above" the table is the audit paragraph, which names no `jx-split` work; the handles paragraph (line 316) is the one that does. And "snap hook and modifier state" is the design line 316 rejects: "not a snap hook … On the event rather than in the state".
3. Found in this detail pass, not by the census: the `jx-box-editor` row (line 326) says `panels/style-utils.ts` works "for 13 shorthands and 9 border sides", which reads as 22. `packages/studio/data/css-meta.json` has 13 `$shorthand: true` entries in all. Nine of them are `$shorthandType: "border-side"` (`border` and its eight physical and logical sides, through `expandBorderSide`/`compressBorderSide`), and four are box-sided (`padding`, `margin`, `borderWidth`, `borderRadius`, through `expandShorthand`/`compressShorthand`).
4. The §5 marker (line 144) lists "two sentences of §5.5's prose about Studio that the code has moved past" among what remains.

## Outcome

- ui.md §5.5 → Implemented. The marker keeps its evidence and loses its last sentence. The three rewritten passages say what `style-panel.ts`, `split.ts` and `style-utils.ts` do.
- ui.md §5's marker no longer names §5.5 as open. §5 is already Implemented, so it carries no claim.
- ui.md stays Partial (§2, §3.1, §3.2, §3.3, §4.1, §5.1, §5.2, §5.4, §6 and §7 are owned by other plans), so nothing graduates.

## Decisions

- **Decided:** `reconcile`, with no code change. Both behaviours the stale text describes as open (the panel's own `var()` parsing, a snap hook on the element) were closed in code in the direction the section's other paragraphs already specify. The section's own marker names both.
- **Decided:** the audit paragraph keeps its history in the past tense and points to the `jx-token-field` row, rather than listing the imports a third time. The row becomes the one place that names them and gains `resolveTokenValue`, which the panel also imports. The paragraph argues for the bar an element must clear, and the grammar duplication is its one counter-example, so the example stays and only its tense and outcome change.
- **Decided:** the new text makes no claim about Studio beyond the panel. `ui/color-selector.ts:80` builds `` `var(${name})` `` itself instead of calling `toTokenRef`, and `services/token-lint.ts:46` tests `includes("var(--")`. Neither parses a bare reference, which is the grammar the paragraph is about. A sentence such as "the only `var()` pattern in Studio" would be a standing claim with no gate behind it. Converting `color-selector.ts` would be a code change this section does not ask for.
- **Decided:** the `jx-breakpoint-bar` row names the handles paragraph by its bold lead, not by position. "The paragraph above" is what pointed at the wrong paragraph, and a quoted lead survives a reordering.
- **Decided:** the `jx-box-editor` count is fixed in the same pull request. It is one clause in the claimed section, and graduating §5.5 to Implemented while a count in it misreads would leave the same kind of drift this plan exists to close.
- **Decided:** §5's marker drops only this plan's clause. The three items it keeps (§5.1, §5.2, §5.4) are still open, and that list is how a reader of the catalogue overview finds them. Each owning plan drops its own clause when it lands.
- **Decided:** "the plan of record" in the marker and in the `jx-toolbar` overflow paragraph stays. It is history about how the section was planned, not a claim about code, and `plans:check` does not refuse it. Rewording it would add a diff this plan does not need.
- **Decided:** no new test. No code changes, and a test that parses spec prose would be a gate for three clauses. The facts the new text states are already under test (see Tests).

## Implementation

All edits are to `specs/ui.md`, in place. No numbered heading moves. Every paragraph and table row stays one source line. The executor may tighten the wording but must keep every fact and every symbol name. After editing, run `bunx oxfmt specs/ui.md` to realign the §5.5 table's padding (the nano-staged hook does the same on commit).

1. **§5 marker (line 144).** Replace "`jx-menu-group` and the radio row (§5.1), Studio's adoption of the toast stack (§5.2), `jx-table` (§5.4), and two sentences of §5.5's prose about Studio that the code has moved past." with "`jx-menu-group` and the radio row (§5.1), Studio's adoption of the toast stack (§5.2), and `jx-table` (§5.4)." The rest of the marker, including its sentence on the five builder entries, stays. If another plan has already removed its own clause, drop this one from whatever list remains and keep the grammar.
2. **§5.5 marker (line 284).** Change `Partial` to `Implemented`. Keep every sentence up to and including "…each for the reason its row gives." Replace the final sentence ("Two sentences of the prose below say something the code does not: …") with:

   > The elements are held by `packages/ui/tests/jx-tree.test.ts`, `toolbar.test.ts` and `split.test.ts`. Studio's handles, including the Edit column's snap over the modifiers `jx-split` reports, are held by `packages/studio/tests/pane-grid.test.ts`, `panel-resize.test.ts` and `edit-width.test.ts`. `packages/studio/src/panels/style-panel.ts` reads token references through `style/token-ref.ts`, as the `jx-token-field` row says.

3. **The audit paragraph (line 320).** Replace "The duplication the audit did find is on Studio's side and is a grammar, not a widget — `panels/style-panel.ts` parses `var()` with a private regex beside `style/token-ref.ts`, the module written for it — and a kit element is not how that is closed." with:

   > The duplication the audit did find was on Studio's side and was a grammar, not a widget — `panels/style-panel.ts` parsed `var()` with a private regex beside `style/token-ref.ts`, the module written for it — and it was closed there rather than by a kit element: the panel now reads references through that module, as the `jx-token-field` row records.

   The paragraph's other sentences stay.

4. **The `jx-box-editor` row (line 326).** Replace "for 13 shorthands and 9 border sides" with "for 13 shorthands, nine of them `border` and its eight sides".
5. **The `jx-token-field` row (line 327).** Replace "and `panels/style-panel.ts` now does (`tokenRefName`, `toTokenRef`)" with "and `panels/style-panel.ts` now does (`tokenRefName`, `toTokenRef`, `resolveTokenValue`)".
6. **The `jx-breakpoint-bar` row (line 328).** Replace "The only element-side work in the set is the one the paragraph above names: `jx-split`'s snap hook and modifier state, which retires `setupHandle`" with:

   > The only element-side work in the set was the one "Every handle in Studio is `jx-split`" names, and it is done: `jx-split` reports each step's modifiers on its `input` and `change` rather than taking a snap hook, `bindSplit` hands them to the Edit column's snap, and `setupHandle` is gone

   The cell contains no `|`.

7. **Fragment**, as in Specs & docs.
8. **Plan housekeeping.** Delete this file in the landing pull request. No plan requires it.

**Integration contract.** No plan requires this one. Once it lands, ui.md §5.5 is Implemented, and its prose names no open work on either side of the kit/Studio line. A plan that changes a §5.5 element or the Studio code its rows cite (`style-panel.ts`'s token reads, `bindSplit`'s snap, `style-utils.ts`'s shorthand expansion) edits the matching row in the same pull request and reopens the marker if the row stops holding. `plan:ui/behaviour-list-text` cites the `jx-dimension-field` row and the "Overflow is the host's" and "Drag and drop is an island" paragraphs. None of these changes here, so the two plans can land in either order.

## Tests

No code changes, so no workspace suite runs for this plan, and no `coverageThreshold` or manifest entry moves. The facts the new text states are already held by existing cases (`bun test --isolate --coverage` from `packages/ui` and `packages/studio`, thresholds in each `bunfig.toml`, untouched):

- `packages/ui/tests/split.test.ts`, describe "the modifiers a step carried": "a pointer move reports the modifiers of THAT move, and the release reports its own", "a key reports Shift even though the element spent it on the large step", and "splitModifiersOf reads no modifiers off anything that is not this element's detail".
- `packages/studio/tests/panel-resize.test.ts`, describe "the snap, and the modifiers it is given": "the snap sees the modifiers the element reported for THIS step" and "a plain input a host dispatched itself reads as no modifiers, so the snap still runs".
- `packages/studio/tests/pane-grid.test.ts`: "the splitter drags the ratio, clamps at a usable pane, and double-click restores 50/50" (the pane grid's `jx-split`).
- `packages/studio/tests/edit-width.test.ts`: "snap pulls onto a declared width, and Alt passes straight through", "a drag near a declared width snaps onto it, and the snapped share goes back to the element", and "Alt on the step drags through the magnet".
- `packages/studio/tests/project-styles.test.ts` covers `tokenRefName`, `toTokenRef` and `resolveTokenValue`.

The proof is the paper gates in `checks`: `docs:status` (marker form), `docs:spec-release` (the fragment), `plans:check` (claim closed, plan deleted), `docs:check`, `docs:links` (every `§` and quoted anchor resolves), `docs:standards` (no §11 row binds §5.5, and the WAI-ARIA and WCAG 2.2 rows bind §5, whose marker is unchanged) and `docs:markdown`.

## Specs & docs

- **Spec edits:** steps 1 to 6 above, all in `specs/ui.md`. The §5.5 marker changes from `Partial` to `Implemented` with the evidence quoted in step 2. The whole-spec header stays `**Status:** Partial`.
- **Fragment:** `bun run spec:change ui.md minor -m "§5.5 is Implemented: its audit paragraph records Studio's var() parsing as closed by the style panel reading style/token-ref.ts, the jx-breakpoint-bar row calls jx-split's side of the Edit column's snapping the modifier report the handles paragraph specifies rather than a snap hook, and the jx-box-editor row counts 13 shorthands, nine of them border and its eight sides"`. The level is minor: a reconcile that redefines no behaviour an author relies on.
- **Docs:** none change. The only page citing the anchor is `docs/extending/ui-kit.md` (`spec: ui.md#5.5`). It already documents the modifier report as the element's contract: "Every `input` and `change` carries the modifier keys that step was made with as its `detail`… a host that snaps the value onto positions of its own reads them with `splitModifiersOf(event)`". It says nothing about the style panel, token references or shorthand counts. No page's `code:` lists a file this plan changes, because it changes none. `bun run docs:sync` should report nothing, and the pull request says so.
- **Graduation:** none. ui.md keeps ten open sections owned by other plans.

## Acceptance

- `bun run plans:status --spec ui` does not list `ui.md#5.5`, and `plans/ui/builder-section-text.md` is gone.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:standards` and `bun run docs:markdown` pass.
- `awk '/^### 5.5/,/^### 5.6/' specs/ui.md | grep -m1 Status` prints a line starting `> **Status: Implemented.**`.
- Each of `grep -c "snap hook and modifier state" specs/ui.md`, `grep -c "a kit element is not how that is closed" specs/ui.md`, `grep -c "13 shorthands and 9 border sides" specs/ui.md` and `grep -c "two sentences of §5.5" specs/ui.md` prints `0`.
- `awk '/^### 5.5/,/^### 5.6/' specs/ui.md | grep -c "snap hook"` prints `2`: the handles paragraph's "not a snap hook" and the new `jx-breakpoint-bar` row's "rather than taking a snap hook".
- `ls specs/changes/` shows one new `ui` fragment at level minor.
- Review by reading: `grep -rn 'var\\(' packages/studio/src --include=*.ts` finds only `src/style/token-ref.ts`, and `panels/style-panel.ts:115` imports the three functions the `jx-token-field` row names.
