---
status: drafted
disposition: implement
claims:
  - ui.md#5.1
requires: []
workspaces:
  - packages/ui
  - packages/studio
  - specs
  - docs
size: M
---

# Every one-of-N menu announces its rows as menuitemradio and ticks the choice in force, and jx-menu-group waits for a menu that needs a heading

## Context

`specs/ui.md` §5.1, line 150 (the marker is long; the open clause is):

> **Status: Partial.** … — and `jx-menu-group` is pending, as is the `menuitemradio` row the table below gives `jx-menu-item`, whose `role` maps `checked` to `menuitemcheckbox` and everything else to `menuitem` (`components/jx-menu-item.json`); three of Studio's menus are one-of-N choices announced as checkboxes for want of it, the tab strip's hidden-tabs menu (`packages/studio/src/panels/tab-strip.ts`) and the two Value source menus (`panels/properties-panel.ts`, `ui/schema-form.ts`). …

The catalogue rows at lines 177 and 178 promise `menuitemradio` on `jx-menu-item` and a `jx-menu-group` ("`role="group"` labelled by its heading"). §5's marker (line 144) names both as what remains of §5.1. The audit record's spec-wide decisions give this plan both halves: the radio row is `implement`, `jx-menu-group` is `defer`.

Verified while detailing (2026-09-27):

- **The kit.** `packages/ui/components/jx-menu-item.json` writes `"role": "${state.checked ? 'menuitemcheckbox' : 'menuitem'}"` and `"aria-checked": "${state.checked || null}"`. `checked` is `""`, `"true"` or `"false"`. The behaviour (`src/behaviors/menu.ts`) finds rows by tag (`rowsOf`), and Enter and Space call `click()`, so it is role-agnostic. `tests/menu.test.ts` ("rows carry the menuitem contract from their props") pins the checkbox row.
- **A checked row draws nothing.** No rule in `jx-menu-item.json`, in Studio's `surfaces/menu.json` or in `packages/studio/styles` keys on `checked` or `aria-checked`. In `stylebook/jx-menu-item.json` the "Checked" and "Unchecked" rows look the same. So the current Value source, the tab showing and a Set Draft row's state reach a screen reader and nobody else. The docs say otherwise: `docs/studio/interface.md` line 179 says the jump bar's ⌄ lists siblings "with the one you're on marked", and the comments in `panels/jump-bar.ts` and `panels/tab-strip.ts` say the same.
- **Ten one-of-N menus, not three.** Each passes `checked` meaning "this is the current answer" through `openMenu` (`surfaces/menu.ts`):
  - `panels/tab-strip.ts` `openOverflowMenu` (hidden tabs).
  - `panels/properties-panel.ts` `openSourceMenu` and `ui/schema-form.ts` (Value source).
  - `panels/events-panel.ts` `openSourceMenu` and `openHandlerMenu` (Value source), and `openEventNameMenu`. The last is a set of suggestions plus a plain "Other…" row under a divider.
  - `panels/jump-bar.ts` `openChoices`, a segment's siblings.
  - `panels/style-panel.ts` `openRowMenu`, which serves three menus: the keyword "Values" list (`keywordChoices`), the number-unit list, and Value source.
- **The unit list checks two rows.** For a keyword value such as `width: auto`, `currentUnit` falls back to `units[0]`, so both `px` and `auto` come out `checked: true`. That is harmless for a checkbox and a contradiction for a radio set.
- **Rows that stay checkboxes.** In the tab context menu, `statedChecked` reads a setter's stated boolean (Set Draft). In `surfaces/target-line.ts` a row is checked when "this element already DECLARES this rule", and several rows can hold that at once.
- **Stale comments.** The one-of-N comments in `tab-strip.ts` (above `openOverflowMenu`) and `tests/tab-strip-labels.test.ts` cite "`panels/pane-context.ts`'s scheme, media and locale menus". Those are `jx-action-button` radio segments now (`surfaces/pane-context.json`), not menus.
- **The kit has the glyph.** `check` is in `packages/ui/icons/manifest.json` (104 icons), and `jx-swatch` already draws it. There is no `dot` or `circle`.
- Nothing in `packages/ui` or `packages/studio/src` names `jx-menu-group`.

## Outcome

- `ui.md` §5.1 → Implemented, plus a `> **Status: Future.**` remainder for `jx-menu-group`.
- `jx-menu-item` gets a `radio` prop. A checked row of either kind draws a tick. All ten one-of-N menus are radio sets, and the two stated-fact menus stay checkboxes.
- `ui.md` §5's marker no longer lists §5.1. `studio-ui-guidelines.md` §8.4 states which Studio menus are radio sets. ui.md stays Partial overall, so nothing graduates.

## Decisions

- **Open:** should a checked row draw a mark? Recommendation: yes. A `[part="check"]` after the label and before the chord holds the `check` glyph while `checked` is `"true"`, the same for both kinds. Today the state is announced and never seen, and a sighted author opening Value source cannot tell which rung is in force, though the docs promise it is marked. One glyph for both kinds matches the Spectrum menu this replaced and macOS menus, and needs no new icon (§8's manifest has `check` and no dot). Putting the mark at the trailing edge reserves no column in menus that have no checkable row. The cost is that every screenshot of an open checkable menu changes once.
- **Open:** build `jx-menu-group` now or leave it Future? Recommendation: leave it Future, and state the rule that makes that safe: a menu holds at most one radio set. WAI-ARIA 1.2 asks for a `group` around a radio set only when a menu has several sets, or one set beside unrelated rows. With one set per menu, the menu scopes the set, and no Studio menu has a run of rows that needs a heading (a boundary is `dividerAbove`). The one shortfall is the Event name menu: its suggestions sit beside an unrelated "Other…" row, which a separator delimits but no group wraps, and that is a SHOULD. Building the element means turning `menu.json`'s flat keyed `$map` into runs, which is a larger change than the gap it closes.
- **Decided:** a boolean `radio` prop beside `checked`, not a `kind` enum and not a new meaning for `checked`. The checkbox reading of `checked` is a shipped contract that the tab menu, the selector list and `docs/extending/ui-kit.md` rely on. `jx-action-button` can read `checked` as a radio only because a button has no checkbox meaning. A radio row always writes `aria-checked` (`"true"` only for `checked === "true"`, otherwise `"false"`), because the state is required on `menuitemradio`.
- **Decided:** the host owns `checked`. The row never flips it, and Enter and Space keep activating through `click()`. Every adopting menu commits the choice and closes, and the APG's optional "Space checks without closing" would leave a Studio menu open on a value it has already committed. This mirrors `jx-swatch-group`, which is the single writer of its swatches.
- **Decided:** Studio carries `radio?: boolean` per row on `MenuRowProjection`, passed through at both levels of `menu.json`, not as a menu-wide option. It mirrors the kit prop one to one, keeps `project()` a pass-through, and leaves the `checked` hook of `placementRows` in `plan:studio-ui-guidelines/name-and-chord-gaps` untouched.
- **Decided:** in the unit list, a keyword value checks its keyword and no unit (`!isKeyword && u === currentUnit`). The set is one value, and that value is the keyword. The chooser's printed unit is a different fact: the unit that typing a number would attach.
- **Decided:** no `requires`. `plan:studio-ui-guidelines/name-and-chord-gaps` also edits `surfaces/menu.ts`, but its edit is a separate module plus call-site rewrites. The two conflict at most textually, and neither needs the other's code. `plan:studio-ui-guidelines/inline-error-role` recommends leaving the kit's error region polite, so it does not rewrite §5.1's `jx-textfield` text. If review flips that decision, whichever plan lands second rebases its §5.1 sentence.

## Implementation

**Kit** (`packages/ui/`):

1. `components/jx-menu-item.json`:
   - Add `"radio"` to `observedAttributes`, and a state entry `radio` (`boolean`, default `false`, `attribute: "radio"`). Its description: the row is one of the menu's single set of exclusive choices, so it is a `menuitemradio` whose `aria-checked` is always written, and the host checks one row, since the row never writes `checked`.
   - Reword the `checked` description: "Empty for a plain item; true or false for a checkable one, which then carries aria-checked: a menuitemcheckbox, or with radio a menuitemradio. A true row draws its tick in the check part."
   - Add a computed `unchecked`, shaped like `noPopup`: `{ "$expression": { "operator": "!==", "target": { "$ref": "#/state/checked" }, "value": "true" } }`.
   - `attributes.role` becomes `${state.radio ? 'menuitemradio' : state.checked ? 'menuitemcheckbox' : 'menuitem'}`. `attributes["aria-checked"]` becomes `${state.radio ? (state.checked === 'true' ? 'true' : 'false') : (state.checked || null)}`.
   - Insert a child between `[part="text"]` and `[part="value"]`: `span[part="check"]` with `hidden: { "$ref": "#/state/unchecked" }`, holding `jx-icon` `$props: { name: "check", weight: "bold" }` with `part="check-icon"`. The icon has no label, so it stays hidden from the accessibility tree, and the state lives in `aria-checked`.
   - Styles: `& > [part="check"]` gets `display: inline-flex` and `color: var(--jx-fg)`. `& > [part="check"][hidden]` gets `display: none`, which the conformance gate requires of a hidden-bound part with a display.
2. `stylebook/jx-menu-item.json`:
   - Add `"radio": false` to the seven rows.
   - Add two rows, "Radio, chosen" (`radio: true`, `checked: "true"`) and "Radio" (`radio: true`, `checked: "false"`).
   - Bind `radio` in the row's `$props`.
3. `src/behaviors/menu.ts`: no change. `rowsOf`, typeahead and activation are role-agnostic.

**Studio** (`packages/studio/src/`):

4. `surfaces/menu.ts`:
   - `MenuRowProjection` gains `radio?: boolean`. Its doc: "With `checked`, the row is one of the menu's exclusive choices, a `menuitemradio` ticked while checked. A menu holds one such set (ui.md §5.1)."
   - `ProjectedRow` adds `"radio"` to its `Omit` list and declares `radio: boolean`. `project()` sets `radio: row.radio === true`.
   - The `checked` doc names the checkbox case only.
5. `surfaces/menu.json`: `"radio": { "$ref": "$map/item/radio" }` in the `$props` of both `jx-menu-item`s, the root row and the submenu row. The `$description` sentence about what a row prints gains "and whether it is one of the menu's exclusive choices".
6. The adopters each add `radio: true` beside `checked`:
   - `panels/tab-strip.ts` `openOverflowMenu`. Rewrite its doc paragraph: "A row states whether it is the tab the pane is already showing, as a radio row (ui.md §5.1): the tabs are one set, and the one showing is checked and ticked." Drop the `pane-context.ts` citation.
   - `panels/properties-panel.ts` `openSourceMenu`, and the Value source menu in `ui/schema-form.ts`.
   - `panels/events-panel.ts` `openSourceMenu` and `openHandlerMenu`, plus the suggestion rows of `openEventNameMenu`. The "Other…" row stays plain.
   - `panels/jump-bar.ts` `openChoices`. Its comment says "a radio row" where it says "`checked` is the element's own spelling of that".
   - `panels/style-panel.ts` `openRowMenu`: the checked spread becomes `{ checked: …, radio: true }`, because all three callers pass `checked` on every choice. In the `number-unit` case, the unit choices become `checked: !isKeyword && u === currentUnit`.
7. No change to `statedChecked` in `tab-strip.ts`, to `surfaces/target-line.ts`, or to `pane-context.ts`.

**Integration contract.** Once this lands:

- `jx-menu-item` takes `radio` (property and attribute). With `checked` it is a `menuitemradio` that always states `aria-checked`, and every row whose `checked` is `"true"` draws `[part="check"]`.
- `MenuRowProjection.radio` makes an `openMenu` row a radio row.
- ui.md §5.1 states the one-radio-set-per-menu rule, and `jx-menu-group` is Future. A plan that needs a labelled group or a second radio set in one menu builds `jx-menu-group` and flips that Future marker.

## Tests

`bun test --isolate --coverage`, from `packages/ui` and from `packages/studio`.

**`packages/ui/tests/menu.test.ts`**:

- `RowSpec` gains `radio?: boolean`, and `row()` passes `radio: spec.radio ?? false`. `open()` takes the document as a parameter, defaulting to `DOC`.
- A new `RADIO_DOC` holds three radio rows (`checked` `"true"`, `"false"`, `""`), an `hr`, one checkbox row and one plain row.
- New cases:
  - "a radio row is a menuitemradio that always states aria-checked": roles and `aria-checked` `["true", "false", "false"]`. The checkbox row stays `menuitemcheckbox`, and the plain row has no `aria-checked`.
  - "a checked row draws its tick and every other row hides it": `[part="check"]` is not `hidden` on the two `"true"` rows and is `hidden` on the rest.
  - "Enter and Space select a radio row, and the row leaves checked to the host": `select` details arrive, and `aria-checked` is unchanged afterwards.
- Extend "rows carry the menuitem contract from their props": Copy's `[part="check"]` is hidden and Show grid's is not.
- `conformance.test.ts` needs no edit. Its part-naming, `[hidden]`-rule, shipped-glyph and documented-prop gates cover the new part, and it walks the stylebook page.

**`packages/studio/tests/`**:

- `surfaces-menu.test.ts`, new: "a radio row is a menuitemradio at either level, and a checked row without radio stays a checkbox". It opens a menu with a radio row, a checkbox row and a row whose `children` hold a radio row.
- `tab-strip-labels.test.ts`: "the row for the tab already showing…" expects `menuitemradio`, and its doc comment drops the `pane-context.ts` claim.
- `tab-strip.test.ts`: the Set Draft test is unchanged. It now pins that a stated fact stays `menuitemcheckbox`.
- `jump-bar.test.ts`: "the menu lists the siblings and marks the one you are on" also asserts `menuitemradio` and that the tick shows on the current row only.
- `properties-panel.test.ts`, new: "the Value source rows are radio rows, the rung in force checked", using `openSourceMenu`. Extend `schema-form.test.ts` "a plain string field offers the whole ladder…" with the same roles and `aria-checked`.
- `events-panel.test.ts`: extend "the name menu suggests this element's own keys…". The suggestions are `menuitemradio` with the current name checked, and "Other…" is a plain `menuitem`.
- `style-panel.test.ts`, new: "a keyword value ticks its keyword in the unit list and no unit", with `width: auto`, the `px` row `aria-checked="false"` and `auto` `"true"`.
- `target-line.test.ts` stays as it is. Add `role === "menuitemcheckbox"` beside its `aria-checked` assertions to pin the boundary.

**Coverage.** No new source file, so the manifest check is unaffected. `packages/ui`'s per-file bar (`lines = 0.99, functions = 1.0`) sees no TypeScript change, since the element is JSON. The touched Studio functions (`project`, `openRowMenu`, the adopters) are already executed by their suites, and `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`) needs no ratchet unless the worst file moves.

## Specs & docs

**`specs/ui.md`**, in place:

- **§5.1 marker** (line 150):
  - `> **Status: Partial.**` becomes `> **Status: Implemented.**`.
  - Replace "— and `jx-menu-group` is pending, as is the `menuitemradio` row … `ui/schema-form.ts`)." with "— and `jx-menu-group` is Future (below)."
  - "`jx-menu-item` reads `value`, `disabled`, `destructive`, `requires`, `checked` and `haspopup`" gains `radio`.
  - After "Studio's context and settings menus are built on them." insert: "**A checkable row is a checkbox or a radio, and `radio` tells them apart.** `checked`, `"true"` or `"false"`, makes a row a `menuitemcheckbox` stating a fact of its own; with `radio` it is a `menuitemradio`, one of a set of exclusive choices, and always states `aria-checked` (an empty `checked` reads as `"false"`). A row whose `checked` is `"true"` draws the `check` glyph in `[part="check"]`, after its label and before its chord, whichever kind it is. The row never writes `checked`: the host that owns the choice checks one row. A menu holds at most one radio set, so the set is the menu's radio rows and needs no group to scope it."
- **New paragraph** directly after the §5.1 marker: "> **Status: Future.** `jx-menu-group`, a `role="group"` labelled by a visible heading, which the table keeps a row for. No menu needs one yet: Studio marks a boundary between runs of rows with a divider, and a menu holds one radio set, which the menu itself scopes. It is built when a menu needs a named run of rows or a second radio set."
- **§5.1 table, `jx-menu-item` row:** "`menuitem`/`menuitemcheckbox`/`menuitemradio`;" becomes "`menuitem`; `checked` → `menuitemcheckbox`, or with `radio` → `menuitemradio`, a checked row ticked in `[part="check"]`;". Run the formatter so the table re-pads. The `jx-menu-group` row stays as written.
- **§5 marker** (line 144): drop "`jx-menu-group` and the radio row (§5.1)," from "What remains…", and add a clause that §5.1 records `jx-menu-group` as Future.
- **§11 WAI-ARIA note:** "**menu** (roving `tabindex`, typeahead, submenus as child popovers)" gains ", checkbox and radio rows".
- **Fragment:** `bun run spec:change ui.md minor -m "§5.1 jx-menu-item takes radio, so a one-of-N row is a menuitemradio, and a checked row draws its tick; jx-menu-group is Future until a menu needs a heading."`

**`specs/studio-ui-guidelines.md`** §8.4 (Implemented, stays so). After the paragraph "**A menu's rows come from a placement** …", add: "**A menu that picks one of several draws radio rows.** Where the rows are exclusive answers to one question (the tab strip's hidden tabs, a Value source or Event name picker, a jump bar segment's siblings, a Style row's keyword or unit list), each row is `radio` as well as `checked`, so it is a `menuitemradio` and the answer in force is ticked (`ui.md` §5.1). A row that states a fact of its own stays a checkbox: the tab menu's Set Draft, the selector list's declared rules." **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§8.4 a menu that picks one of several draws radio rows, and a row stating a fact of its own stays a checkbox."`

**Docs.**

- `docs/extending/ui-kit.md` (`spec: ui.md#5.1`), "Show a menu":
  - "and `checked` to `"true"` or `"false"` on one that toggles." becomes "and `checked` to `"true"` or `"false"` on one that states something on or off. Add `radio` as well when the row is one of several choices of which only one holds, such as a list of modes: the row is announced as a radio item rather than a checkbox, and you keep `checked` on exactly one row, because the row never changes it itself. A menu holds one such set. A row whose `checked` is `"true"` draws a tick after its label."
  - The parts list gains `check` and `check-icon`.
- `docs/studio/logic/formulas.md`, the value source section (only if the tick decision holds): "The picker lists them all at once, so" becomes "The picker lists them all at once, with a tick beside the one the row uses now, so".
- `bun run docs:sync` will also name these pages through their `code:` lists: `studio/interface/tabs.md`, `studio/interface.md`, `start/studio-tour.md`, `studio/design/properties.md`, `studio/design/components.md`, `studio/logic.md`, `studio/logic/events.md`, `studio/design/repeaters.md`, `studio/design/style-inspector.md`, `studio/design/states-and-selectors.md`, `studio/design/stylebook.md`, `README.md` and `studio/interface/canvas.md`. None says how a menu row announces or draws its state, and `studio/interface.md`'s "with the one you're on marked" becomes true. No change there.
- No page gains an em dash.

Nothing graduates: ui.md keeps open items on §2, §3.1 to §3.3, §4.1, §5.2, §5.4, §5.5, §6 and §7. The pull request deletes this plan file.

## Acceptance

- `bun test --isolate --coverage` is green in `packages/ui` and `packages/studio`. `bun scripts/check-coverage-manifest.ts packages/ui` and `bun scripts/check-coverage-manifest.ts packages/studio` pass.
- `bun run plans:check` and `bun run plans:status --spec ui` show `ui.md#5.1` closed with no claimant.
- `bun run docs:status`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:standards` and `bun run docs:spec-release` pass. `specs/changes/` holds the two fragments.
- `git grep -n "radio: true" packages/studio/src` lists the six adopter files. `git grep -n "menuitemradio" packages/ui/components/jx-menu-item.json` matches the role binding.
- In the kit stylebook's `jx-menu-item` page, only "Checked" and "Radio, chosen" draw a tick. In Studio, the Value source picker on a Content row ticks the rung the chip names, and `width: auto`'s unit list ticks `auto` alone.
- The screenshots lane's bot comment lists every changed image. Re-read the pages it names for prose about menus.

## Slices

| Slice  | Scope                                                                                     | Claims    | State |
| ------ | ----------------------------------------------------------------------------------------- | --------- | ----- |
| MRR1.1 | The kit's `radio` and tick, Studio's projection and ten adopters, the spec and docs edits | ui.md#5.1 | open  |
