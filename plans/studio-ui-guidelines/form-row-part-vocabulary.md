---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#4.1
  - studio-ui-guidelines.md#4.2
requires: []
workspaces:
  - packages/studio
  - docs
size: M
---

# The form row and its provenance chip are specified in the one part vocabulary every surface draws

## Context

`specs/studio-ui-guidelines.md` §4.1, line 156:

> **Status: Partial.** The row geometry ships, but surfaces key it on `part="row"` and `part="row-label"`, with `data-child="true"` for a nested row (`packages/studio/src/surfaces/style-panel.json`, `properties-panel.json`, `panel-page.json`). Nothing emits `style-row` or `style-row-label`, and the `.style-row` rules left in `styles/inspector.css` have no emitter.

§4.2, line 207:

> **Status: Partial.** The chip's behaviour ships (`packages/studio/src/panels/provenance.ts`: set, inherited naming its donor, bound, mixed, and the section tally from `countProvenance`). Its markup does not match: the chip is `[part="chip"][data-state]` in a `[part="chip-slot"]` and the heading indicator is `[part="dots"] > [part="dot"]`; no surface emits `part="set-dot"`, and the `.set-dot` rules in `styles/inspector.css` are dead.

Both markers are accurate about the spec. The spec's `style-row`, `style-row-label`, `set-dot` and `.set-dot--section` are names nothing emits, and the rules that still carry them are dead: `packages/studio/styles/inspector.css` lines 79 to 134, from the "Provenance dots on a section heading" comment through `.style-section-body--grid .style-row`. The stub filed this as a pure `reconcile`. Verifying it against the four surfaces that draw the stacked row (Style tab `style-panel.json`, Content tab `properties-panel.json`, Page panel `panel-page.json`, Document Header card `doc-header.json`) found that the code is not uniformly right either. So the disposition is `implement`: the spec is rewritten to the part vocabulary, and the code defects below are fixed so the rewritten text does not overclaim.

**What exists** (verified 2026-09-27)

- Row markup: `div[part="row"]` > `div[part="row-label"]` + a kit field, `data-prop` on the row. `data-child="true"` (16px indent, `--jx-space-5`), `data-warning` and `data-span="2"` are the Style tab's alone. Every kit field in a row carries its own `label`, and every one that takes a `size` carries `size="sm"` (`jx-action-group` and `jx-swatch-group` take none). The field sits in a `display: contents` slot (`[part="control"]` in the Style tab, `[part="widget-slot"]` in the Content tab), so it is a flex item of the row. Only `jx-color-field` among the kit's elements draws a `[part="row"]` of its own, and only the Style and Content tabs host it, which is why they alone scope their row rule; the Page panel and Document Header card key a bare `& [part="row"]`.
- Row geometry as the spec gives it: column, `align-items: stretch`, 2px gap, `2px 0` padding, `min-width: 0`; the label is flex, centred, `--jx-text-xs`, `--jx-fg-dim` (the Content tab, Page panel and Document Header card write the aliases `4px` and `var(--fg-dim)`, which resolve to the same values through `styles/tokens.json`).
- Chip: `[part="chip-slot"]` (`display: contents`, `role="none"`) > `[part="chip"][data-state]`, a `button` when it acts and a `span` when it does not (the SEO dialog, `seo.json`, draws its inert set chip as the kit's `jx-dot`). In the Style tab, the Content tab and the SEO dialog the words come from `provenanceText` and `provenanceTitle` in `panels/provenance.ts` (`panels/style-panel.ts`, `panels/properties-panel.ts`, `panels/seo-modal.ts`), tested in `tests/provenance.test.ts`. The Page panel and Document Header card draw only the `set` state, titled `Clear <field>` by `panels/head-panel.ts` and `panels/frontmatter-panel.ts`.
- Style tab heading tally: `span[part="dots"][slot="heading"]` with one inert `span[part="dot"][data-state]` per informative state and the `provenanceSummaryText` sentence as its title, plus a `button[part="dot"][data-state="set"]` in the `actions` slot that clears the section (`sectionShell` in `panels/style-panel.ts`).

**What the census missed**

- **The Content tab's row rule reaches none of its main rows.** Its selector is `& [part="section-body"] > [part="row"], & [part="layout-class-slot"] > [part="row"]` (since c7427a65, which scoped it for `jx-color-field`). But every section row is drawn inside a `$switch` wrapper, `div[part="row-slot"]` (`display: contents`), and `renderSwitch` in `packages/runtime/src/runtime.ts` always renders that container. So the row is `section-body > row-slot > row` and matches neither half. The rows draw as plain blocks without the 2px gap and padding. The rule's own `$description` explains the `layout-class-slot` half with exactly this reasoning; `row-slot` was simply left out.
- **The Content tab's heading carries one state, not a tally.** `sectionView` in `panels/properties-panel.ts` draws one aria-hidden `[part="section-dot"]` titled "N values set in this section", counted as `attrs[a.name] !== undefined`, so a bound attribute counts as set. The Element and Component Settings sections pass a count of `0` and never mark at all. `studio.md` §6.7 ("Collapsed section headers carry the same states as a tally") and §4.2's third rule are unqualified, and `provenance.ts` exists so "the two surfaces cannot drift into two vocabularies for one idea".
- **The Content tab's Mixed chip reads an undefined token.** `& [part="chip-slot"] > [part="chip"][data-state="mixed"]` sets `color: var(--text-secondary)`, which neither `styles/tokens.json` nor `packages/ui/project.json` declares. The Style tab's rule is `var(--jx-fg-muted)`. The Content tab's chip rules have drifted from the Style tab's elsewhere too (14ch against 16ch, `0 5px` against `0 var(--jx-space-2)`, a hover wash the Style tab does not draw).
- **The chip lost its forced-colours border.** `styles/forced-colors.json` redraws `.status-dot, .severity-dot, .provenance-chip` with `border: 1px solid CanvasText` ("a dot whose whole meaning is its fill"), and no surface emits `.provenance-chip`. No surface that draws the chip or the heading dots has a `@(forced-colors: active)` block, and the kit's `jx-dot` (the SEO dialog's set chip) has none either, so in forced colours the 6px set disc and the heading dots lose their fill and disappear. The `$description` of the same file's `.notification-row--problem` entry records the pattern the fix follows: `.problem-row` left the list, and its rule moved into the document (`panel-problems.json`).
- **Two smaller vocabulary splits.** The Style tab names the row's text `[part="label"]` under an unscoped `& [part="label"]` rule, which also matches the kit's own `[part="label"]` inside every field and option the panel hosts. The other three surfaces call it `[part="row-name"]`. The Page panel's and Document Header card's chips carry no `data-state`.
- **Stale commentary.** `panels/provenance.ts` says twice that each cascade draws `[part="provenance-chip"]` (lines 35 and 126). The root `$description` of `style-panel.json` calls the replaced rules "DEAD in the stylesheets now"; that of `properties-panel.json` says "The Style and Logic tabs still draw `.style-row`, so the stylesheet keeps those rules", and those of `panel-page.json` and `doc-header.json` say the lit panels "that still draw a `.style-row` go on owning those rules until they convert". `expression-editor.json`'s `[part="row"]` rule cites "studio-ui-guidelines.md §4.1's standard form row, stacked" for a row that wraps (`flexWrap: wrap`, a leading cell beside the field), which the rewritten §4.1 would make plainly false.

**Out of scope, recorded for the plans that own them**

- `studio-ui-guidelines.md` §10's item "An inspector row is a `jx-field` inside the tab's own document" is false for the Style and Content tabs, whose rows are `[part="row"]` around a kit field. §10 belongs to `plan:studio-ui-guidelines/conventions-checklist`, which already requires this plan and rewords the item to §4.1's vocabulary.
- Every chip `button` and the Style tab's clear dot carry `title` and `aria-label` with the same string, and `[part="dots"]` puts an `aria-label` on a role-less `span`. Both are §10's "one accessible name" item, which `plan:studio-ui-guidelines/conventions-checklist-controls#CCO2.1` fixes. Neither plan requires the other; step 5 below says how the copied `[part="dots"]` follows whichever lands first.
- The kit's `jx-dot` draws a fill-only disc with no forced-colours rule, so every `jx-dot` in Studio (the Logic tab's three, including the binding dot inside its clear button, and the stylebook layer list's) has the defect this plan fixes for the chip. That is the kit's contract (`ui.md` §4), not §4.2's; this plan redraws only the SEO dialog's set chip, in its own document.
- §2.2's type-scale row still names `.style-row-label`; `plan:studio-ui-guidelines/chrome-type-scale` rewrites that table to `[part="row-label"]`.
- `.status-dot` and `.severity-dot` in `forced-colors.json` also have no emitter; they are not the chip's and stay for whoever next touches that sheet, as the audit left `.empty-state*`.

## Outcome

- studio-ui-guidelines.md §4.1 → built, with no marker (like §4.5 and §4.6): the section gives the row as `[part="row"]` / `[part="row-label"]` / `[part="row-name"]` with `data-child`, and every one of the four surfaces' rule reaches its rows.
- studio-ui-guidelines.md §4.2 → built, with no marker, retitled "Provenance Chip": the chip as `[part="chip-slot"] > [part="chip"][data-state]`, the tally as `[part="dots"] > [part="dot"][data-state]` on the Style and Content tabs alike, and the forced-colours border on every surface that draws the chip (the four above and the SEO dialog).
- `styles/inspector.css` keeps no `.style-row`, `.set-dot` or `.provenance-chip*` rule, and `styles/forced-colors.json` names no `.provenance-chip`.
- §4.6 and §7 name `[part="row"]` where they named `.style-row`.

## Decisions

- **Open:** does the Content tab's section heading draw the full tally, or does §4.2 scope that rule to the Style tab? Recommendation: draw the tally. `studio.md` §6.7 states it for every collapsed header, and the alternative needs a new marker on a verified section there. It also fixes two wrong answers the current dot gives: a bound attribute reads as set, and the Element and Component Settings headings never mark. Every mark stays inert, `set` included, because the Content tab has no clear-section verb and `sectionView`'s comment records why a dot that looks clickable and does nothing was removed. If declined instead: §4.2 names `[part="section-dot"]` as the Content tab's set count, and the landing pull request marks `studio.md` §6.7 Partial with a plan of its own.
- **Decided:** one vocabulary for the stacked row and the chip: `row`, `row-label`, `row-name`, `chip-slot`, `chip` with `data-state`, `dots`, `dot`. The outliers conform: the Style tab's `[part="label"]` becomes `[part="row-name"]`, and the Page panel's and Document Header card's chips gain `data-state="set"`. The spec states one shape, and a part name that also matches kit internals is the cross-match hazard the Style tab's own `$description` records for `row`.
- **Decided:** the Content tab transcribes the Style tab's chip and dot rules verbatim. §4.2 gives one CSS block, and the drift already produced an undefined token. The visible change is 2ch of pill width and 1px of padding, which the screenshot lane re-captures.
- **Decided:** the forced-colours border moves into each document's `@(forced-colors: active)` block (the four row surfaces and `seo.json`), and `.provenance-chip` leaves the global sheet's selector. That is how `panel-problems.json`, `panel-signals.json` and `panel-stylebook-layers.json` already redraw their fill-only marks, each as the style object's last key, and a global rule keyed on `[part="chip"]` would also match the unrelated chips in `commandbar.json`, `ai-chat.json` and `palette.json`. The block goes last here too: its `& [part="dot"]` and the Page panel's `& [part="chip"]` tie the base rules' `border: none` on specificity.
- **Decided:** §4.2's heading becomes "Provenance Chip", with its number kept. "Set Dot (Clear Indicator)" names one state of the chip, the section specifies all of them, and no link or docs anchor uses the heading's text (docs anchor on `#4.2`).
- **Decided:** no new gate for dead stylesheet rules. `check-styles.ts`'s orphan rule runs from emitted classes to sheets, and the reverse direction needs every class the documents, Tabulator and Monaco put in the DOM as input. That is its own change; the acceptance greps cover this plan's names.

## Implementation

1. `packages/studio/src/panels/provenance.ts`
   - Add `export function provenanceMarks(counts: ProvenanceCounts, opts: { set: boolean }): { state: ProvenanceState }[]`. It returns one mark per state with a non-zero count, in the chip table's order (`set` only when `opts.set`, then `inherited`, `bound`, `mixed`).
   - Correct the two doc comments that name `[part="provenance-chip"]` (the module header, "This module is the vocabulary", and the note where `renderProvenanceChip` was) to "a `[part="chip"]` in a `[part="chip-slot"]` (studio-ui-guidelines.md §4.2)". The citation is qualified, because a bare `§` in `packages/studio` means `studio.md`.
2. `packages/studio/src/panels/style-panel.ts`, `sectionShell`: replace the three `marks.push` branches with `provenanceMarks(counts, { set: false })`. No behaviour change: the Style tab's `set` mark is the clear button.
3. `packages/studio/src/panels/properties-panel.ts` (under the Open recommendation)
   - `sectionView(key, label, open, rows)` drops its `setCount` parameter. It tallies `rows` with `countProvenance`, reading a row's state as `row.chipState` when it has one and as `set` for a `kv` row: a custom attribute present on the element is set here, and `customRows` draws no chip. Rows without a chip (notes, actions, files, the tag row) count as `default`. `ContentRowView.chipState` is a `string` (only `applyChip` writes a non-empty one, from `FieldProvenance.state`), so the tally narrows it: `row.shape === "kv" ? "set" : ((row.chipState || "default") as ProvenanceState)`. It returns `marks: provenanceMarks(counts, { set: true })`, `hasMarks` and `tally: provenanceSummaryText(counts)`, and its docblock keeps the "an indicator and not a control" reasoning.
   - Callers: the Element section builds `elementRows(...)` before `sectionView` rather than assigning `sections[0]!.rows` afterwards; the attribute loop drops `setCount`; the Component Settings, Custom and Usage calls drop their count argument.
4. `packages/studio/src/surfaces/properties-panel.ts`, `ContentSectionView`: replace `hasDot` and `dotTitle` with `marks: { state: string }[]`, `hasMarks: boolean` and `tally: string`, documented as `StyleSectionView`'s fields are.
5. `packages/studio/src/surfaces/properties-panel.json`
   - Heading slot: replace the `$switch` on `hasDot` that draws `[part="section-dot"]` with the Style tab's `span[part="dots"]` (`slot="heading"`, `hidden` when `!hasMarks`, named from `tally`, a keyed `$map` over `marks` drawing `span[part="dot"][data-state]`). Copy the node as the Style tab draws it when this lands: `title` and `aria-label` from `tally` today, or `role="img"` and `title` only once `plan:studio-ui-guidelines/conventions-checklist-controls#CCO2.1` has landed (if this lands first, that slice's sweep finds the copy and fixes it with the rest). The node's `$description` keeps "an indicator and not a control".
   - Style: delete `& [part="section-dot"]`. Replace every `& [part="chip-slot"] > …[part="chip"]…` rule with the Style tab's (this removes `var(--text-secondary)`). Add the Style tab's `& [part="dots"]`, `& [part="dot"]` and `& [part="dot"][data-state=…]` rules, not the two `button[part="dot"]` rules.
   - Row rule: the selector becomes `& [part="section-body"] > [part="row"], & [part="row-slot"] > [part="row"], & [part="layout-class-slot"] > [part="row"]`, and its `$description` names `row-slot` beside `layout-class-slot` ("both slots are `display: contents`, so the row is a grandchild in the DOM").
   - Add `"@(forced-colors: active)"` as the style object's last key, with `& [part="chip-slot"] > [part="chip"][data-state="set"], & [part="dot"]` at `border: 1px solid CanvasText`, and a `$description` in the words of `forced-colors.json`'s dot rule.
   - Root `$description`: replace "The Style and Logic tabs still draw `.style-row`, so the stylesheet keeps those rules until they convert too." with "Nothing draws those classes any more, and their rules have left the stylesheets."
6. `packages/studio/src/surfaces/style-panel.json`
   - The row label's text span: `"part": "label"` → `"part": "row-name"`; the style key `& [part="label"]` → `& [part="row-name"]`, the key the other three surfaces already use (no kit element draws a `row-name`).
   - Add the same `@(forced-colors: active)` block as step 5, as the last key.
   - Root `$description`: "The rules those parts replace are DEAD in the stylesheets now rather than shared" → "The rules those parts replace were deleted from the stylesheets rather than shared".
7. `packages/studio/src/surfaces/panel-page.json` and `doc-header.json`: the chip `button` gains `"data-state": "set"`, and each style gains, as its last key, `"@(forced-colors: active)": { "& [part=\"chip\"]": { "border": "1px solid CanvasText" } }` with a one-line `$description`. In each root `$description`, the clause saying the lit panels "that still draw a `.style-row` go on owning those rules until they convert" becomes "and the rules it borrowed have since left `styles/inspector.css`, because nothing draws those classes any more".
8. `packages/studio/src/surfaces/seo.json`: the style gains, as its last key, `"@(forced-colors: active)": { "& jx-dot[part=\"chip\"][data-state=\"set\"]": { "border": "1px solid CanvasText" } }` with the same one-line `$description`. The inherited pill already draws a `currentcolor` border, which the mode keeps.
9. `packages/studio/src/surfaces/expression-editor.json`, the `& [part="row"]` rule's `$description`: "studio-ui-guidelines.md §4.1's standard form row, stacked, with its own indent." → "studio-ui-guidelines.md §4.6's wrapping row, with its own indent." The rest stands.
10. `packages/studio/styles/inspector.css`: delete lines 79 to 134, from `/* ─── Provenance dots on a section heading (§6.7)` through the closing brace of the `.style-section-body--grid .style-row` rule. The blank line 78 stays and now separates `.kv-add:hover` from `@keyframes pulse`.
11. `packages/studio/styles/forced-colors.json`: the selector `.status-dot, .severity-dot, .provenance-chip` becomes `.status-dot, .severity-dot`. Append to its `$description`: "The provenance chip left this list when the Inspector became documents: each document that draws it redraws it in its own forced-colours block." Keep the class name out of that sentence: the `$description` is emitted as a comment into `forced-colors.css`, and the new `build-styles.test.ts` assertion below reads the whole sheet. Regenerate `styles/forced-colors.css` with `bun run --cwd packages/studio styles:sync`.
12. The spec edits in **Specs & docs**, in the same pull request.

**Integration contract.** Once this lands:

- `studio-ui-guidelines.md` §4.1 and §4.2 carry no marker and name the stacked row `[part="row"]` > `[part="row-label"]` (chip slot, then `[part="row-name"]`) + a kit field with its own `label`, and the chip `[part="chip-slot"] > [part="chip"][data-state]` with the tally `[part="dots"] > [part="dot"][data-state]`. A plan rewording §10, §2.2 or §7 may cite those parts.
- `provenanceMarks(counts, { set })` is exported from `packages/studio/src/panels/provenance.ts`. The Content tab's `ContentSectionView` carries `marks`, `hasMarks` and `tally` as `StyleSectionView` does.
- No stylesheet in `packages/studio/styles/` defines `.style-row*`, `.set-dot*` or `.provenance-chip*`, and every document that draws the chip or the heading dots redraws them in its own `@(forced-colors: active)` block.
- `plan:studio-ui-guidelines/conventions-checklist` requires this plan (already in its `requires`): §10's inspector-row item restates §4.1 and can only be reworded against its new text. `plan:studio-ui-guidelines/spacing-scale` may rely on §7 naming `[part="row"]` rather than `.style-row`, whichever of the two lands first (see **Specs & docs**).

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `tests/provenance.test.ts`
  - "provenanceMarks lists the present states in the chip table's order": counts `{ set: 2, inherited: 0, bound: 1, mixed: 3 }` give `set, bound, mixed` with `{ set: true }` and `bound, mixed` with `{ set: false }`; all-zero counts give `[]`.
  - "every surface that draws the chip redraws it in forced colours": for `style-panel.json`, `properties-panel.json`, `panel-page.json`, `doc-header.json` and `seo.json`, read the file with `readFileSync`, take `style["@(forced-colors: active)"]`, and assert that a key containing `[part="chip"]` declares `border: "1px solid CanvasText"` and that the block is the style's last key. For the first two, assert the same of a key containing `[part="dot"]`.
  - "the Content tab draws the chip and the dots with the Style tab's rules": for every key of `properties-panel.json`'s `style` that contains `[part="chip"]`, `[part="dots"]` or `[part="dot"]` (outside the forced-colours block), the same key exists in `style-panel.json`'s `style` with equal declarations once `$description` is dropped. This is the assertion that would have caught `--text-secondary`.
- `tests/properties-panel.test.ts`
  - Rewrite "a set attribute auto-opens its section and marks it with a dot" (line 1060) to find `[part="dots"] [part="dot"][data-state="set"]`.
  - Rewrite "the section dot states a count and no longer pretends to be a control" (line 1072) as "the section tally names its states and is not a control": with `href` and `target` set, `[part="dots"]` has title `2 set here`, and every `[part="dot"]` is a `span`.
  - Rewrite "a section with nothing set draws no dot" (line 1088): `[part="dots"]` carries `hidden` and no `[part="dot"]`.
  - Line 1425 ("unknown attributes land in the auto-opened Custom section"): the Custom heading has `[part="dot"][data-state="set"]`.
  - New, "a bound attribute tallies as bound, not set": a bound `href` gives a `data-state="bound"` mark and the title `1 bound`.
  - New, "the Element section tallies its own rows": a node with `$id` set marks the Element heading `set`, which it never did.
  - New, "every field row is reached by the tab's row rule": parse the row rule's key from `properties-panel.json`, split it on commas, strip the leading `& `, render a node with attributes in several sections, and assert every `[part="row"]` outside a `[part="color-field"]` matches one of the selectors.
- `tests/style-panel.test.ts`, under "base style rows": a row's name is `[part="row-label"] > [part="row-name"]`, and the same row-rule reach assertion against `style-panel.json`'s `& [part="rows"] > [part="row"]`. The existing tally case ("a section heading tallies what is set, inherited and bound inside it", line 718) and clear-dot case ("an open section's clear dot clears every set prop…", line 842) stand unchanged and prove `sectionShell` kept its behaviour.
- `tests/head-panel.test.ts` (the Page panel, `panel-page.json`) and `tests/frontmatter-panel.test.ts` (the Document Header card, `doc-header.json`): each file's `clearRow` helper throws unless the chip it is about to press carries `data-state="set"`, so every existing clear case fails before step 7 and passes after.
- `tests/build-styles.test.ts`: in "every affordance the mode deletes is redrawn, with a system colour", add `expect(forced).not.toContain(".provenance-chip")`.
- Coverage: `panels/provenance.ts`, `panels/style-panel.ts`, `panels/properties-panel.ts` and `surfaces/properties-panel.ts` change and no source file is added, so the manifest check is unaffected. The per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold with `provenanceMarks` covered by its own cases; if the rewritten `sectionView` raises the worst file, ratchet the threshold to just below the new minimum.
- The change touches `packages/studio/src/**`, so the screenshot lane re-captures every shot showing the Content tab (row spacing and heading dots move) and comments with the before/after table. Review the pictures, not a red X.

## Specs & docs

All edits are to `specs/studio-ui-guidelines.md`, in place; no heading is renumbered or removed.

- **§4.1** (lines 154 to 203): delete the Partial marker; the section carries no marker afterwards, like §4.5 and §4.6. Replace the body with:

  ````markdown
  The canonical form layout. Labels sit above full-width inputs.

  A row is a document's markup, not a template's. The Style tab, the Content tab, the Page panel and the Document Header card each draw it and key their own `style` block on its parts, because a document emits no class (`ui.md` §3.1).

  ```json
  {
    "tagName": "div",
    "attributes": {
      "part": "row",
      "data-prop": "${$map.item.prop}",
      "data-child": "${$map.item.child ? 'true' : null}"
    },
    "children": [
      {
        "tagName": "div",
        "attributes": { "part": "row-label" },
        "children": [
          {
            "tagName": "span",
            "attributes": { "part": "row-name" },
            "textContent": "${$map.item.label}"
          }
        ]
      },
      {
        "tagName": "jx-textfield",
        "$props": {
          "size": "sm",
          "label": { "$ref": "$map/item/label" },
          "value": { "$ref": "$map/item/value" }
        }
      }
    ]
  }
  ```

  **CSS** (each rule is a `& [part="…"]` key in the surface's own `style` object):

  ```css
  [part="row"] {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 2px 0;
    min-width: 0;
  }
  [part="row"][data-child="true"] {
    padding-left: var(--jx-space-5);
  }
  [part="row-label"] {
    display: flex;
    align-items: center;
    gap: var(--jx-space-2);
    font-size: var(--jx-text-xs);
    color: var(--jx-fg-dim);
  }
  [part="row-name"] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ```

  **Rules:**

  - Always use `size="sm"` on a kit input that takes a size.
  - The row's visible name is its `[part="row-name"]`, inside `[part="row-label"]` after the provenance chip (§4.2). The control's accessible name is the kit field's own `label`. Never a bare `<label>` element.
  - Inputs take the full width of the row through its `align-items: stretch`; a child needs no width of its own. A field wrapped in a `display: contents` slot is still the row's flex item.
  - A nested row carries `data-child="true"` and indents 16px (`--jx-space-5`).
  - A surface that hosts `jx-color-field` scopes the row rule to its own rows, because the kit is light DOM and that element draws a `[part="row"]` of its own that a bare descendant selector would restyle. The Style tab keys it on `[part="rows"] > [part="row"]`. A row drawn inside a `display: contents` slot is a grandchild in the DOM, so the selector names the slot, as the Content tab's `[part="row-slot"] > [part="row"]` does.
  - The Style tab adds two row states of its own: `data-warning="true"` colours the label `--jx-warning` when a set value's `$show` condition fails, and `data-span="2"` spans both columns of the Size section's grid.
  ````

- **§4.2** (lines 205 to 247): retitle the heading `### 4.2 Provenance Chip` and delete the Partial marker (no marker afterwards). Replace everything from "When a property has an explicit value" through "absent means inherited/default" with:

  ````markdown
  Every field label carries one provenance chip (`studio.md` §6.7), drawn in the row's `[part="row-label"]` before its name. `packages/studio/src/panels/provenance.ts` owns the words: which state a value is in, what the chip reads (`provenanceText`), what its tooltip says (`provenanceTitle`), and how a section tallies its rows (`countProvenance`, `provenanceSummaryText`, `provenanceMarks`). The Style tab, the Content tab and the SEO dialog draw the chip from those words, each in its own document. The Page panel and the Document Header card draw only its `set` state, titled "Clear" and the field's name.

  ```json
  {
    "tagName": "span",
    "attributes": { "part": "chip-slot", "role": "none" },
    "style": { "display": "contents" },
    "$switch": { "$ref": "$map/item/chip" },
    "cases": {
      "button": {
        "tagName": "button",
        "attributes": {
          "part": "chip",
          "type": "button",
          "data-state": "${$map.item.chipState}",
          "title": "${$map.item.chipTitle}"
        },
        "textContent": "${$map.item.chipText}"
      },
      "text": {
        "tagName": "span",
        "attributes": {
          "part": "chip",
          "data-state": "${$map.item.chipState}",
          "title": "${$map.item.chipTitle}"
        },
        "textContent": "${$map.item.chipText}"
      }
    }
  }
  ```

  **CSS:**

  ```css
  [part="chip-slot"] > [part="chip"] {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    font-size: var(--jx-text-xs);
    /* and a button reset: margin, padding, border and background none; colour and font inherit */
  }
  [part="chip-slot"] > button[part="chip"] {
    cursor: pointer;
  }
  [part="chip-slot"] > button[part="chip"]:focus-visible {
    outline: var(--jx-focus-ring);
    outline-offset: 1px;
  }
  [part="chip-slot"] > [part="chip"][data-state="set"] {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--jx-accent);
  }
  [part="chip-slot"] > button[part="chip"][data-state="set"]:hover {
    background: var(--jx-danger);
  }
  [part="chip-slot"] > [part="chip"][data-state="inherited"],
  [part="chip-slot"] > [part="chip"][data-state="bound"],
  [part="chip-slot"] > [part="chip"][data-state="mixed"] {
    max-width: 16ch;
    overflow: hidden;
    padding: 0 var(--jx-space-2);
    border: 1px solid currentcolor;
    border-radius: var(--jx-radius-sm);
    line-height: 14px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  [part="chip-slot"] > [part="chip"][data-state="inherited"] {
    color: var(--jx-warning);
  }
  [part="chip-slot"] > [part="chip"][data-state="bound"] {
    color: var(--jx-handler);
  }
  [part="chip-slot"] > [part="chip"][data-state="mixed"] {
    color: var(--jx-fg-muted);
  }
  [part="dots"] {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  [part="dot"] {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--jx-fg-muted);
    /* and the same button reset as the chip, border none included */
  }
  [part="dot"][data-state="set"] {
    background: var(--jx-accent);
  }
  [part="dot"][data-state="inherited"] {
    background: var(--jx-warning);
  }
  [part="dot"][data-state="bound"] {
    background: var(--jx-handler);
  }
  @media (forced-colors: active) {
    [part="chip-slot"] > [part="chip"][data-state="set"],
    [part="dot"] {
      border: 1px solid CanvasText;
    }
  }
  ```

  - The chip is `[part="chip"]` in a `[part="chip-slot"]`, and carries its state in `data-state`: `set`, `inherited`, `bound` or `mixed`. `default` draws no chip: the document never makes the node, so absence is the ghost state.
  - It is a `button` when it acts (clear, jump to the donor, open the source), and the surface's `onclick` calls its host function with the row's key. Otherwise it is inert: a `span`, or the kit's `jx-dot` for a bare disc, as the SEO dialog draws its set chip.
  - A collapsible section's heading (the Style and Content tabs') draws the tally as `[part="dots"]` in the accordion item's `heading` slot: one inert 7px `[part="dot"]` per state present in the section, titled with `provenanceSummaryText`'s sentence ("3 set here · 2 inherited"), and hidden when nothing is. The Style tab draws its `set` mark instead as a `button[part="dot"]` in the `actions` slot, which clears the section. The Content tab's stays inert with the rest, because a click on the heading already toggles it.
  - In forced colours the set disc and every heading dot keep a 1px `CanvasText` border, because their whole meaning is their fill.
  ````

  In the paragraph that follows, "**The dot is the "set here" state of the provenance chip, not a separate affordance.**" becomes "**The accent disc is the chip's "set here" state, not a separate affordance.**"; "exactly one chip, in four states" becomes "exactly one chip, in five states"; and the list gains the fifth after "violet for bound, naming the signal;": "neutral for mixed, counting the selected elements that disagree;". The three rules after it are unchanged.

- **§4.6** (line 308): "`.style-row` (§4.1) is `flex-direction: column`" → "`[part="row"]` (§4.1) is `flex-direction: column`", and "Widen a child of a `.style-row` with `width: 100%`" → "A child of a `[part="row"]` is already full width through the row's `align-items: stretch`". The rest of the bullet stands.
- **§7** (line 409): the "Form row gap" cell's "(`.style-row`)" → "(`[part="row"]`)". If `plan:studio-ui-guidelines/spacing-scale` has already rewritten §7, apply the rename to whatever row it kept, or skip it when none names the row.
- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§4.1 and §4.2 name the form row and the provenance chip by the parts the surfaces draw (row, row-label, row-name, chip-slot, chip with its data-state, dots and dot); the Content tab's section headings tally every chip state as the Style tab's do, and the chip keeps a border in forced colours."`
- **Docs:** no page's `spec:` cites `studio-ui-guidelines.md#4.1` or `#4.2`. Pages whose `code:` lists a changed file:
  - `docs/studio/design/properties.md` (`panels/properties-panel.ts`, `panels/provenance.ts`): line 37 becomes "A collapsed section's heading carries the same states as a tally: one dot for each state present inside it, and hovering reads them out, as in **2 set here · 1 bound**. The dots only report; click the heading to open the section." Under the declined option, it stays.
  - `docs/studio/design/style-inspector.md`, `docs/studio/design/components.md`, `docs/studio/editing/frontmatter.md` and `docs/studio/logic/events.md` list `panels/provenance.ts` (and `components.md` lists `panels/properties-panel.ts`); `style-inspector.md`, `docs/studio/design/states-and-selectors.md` and `docs/studio/design/stylebook.md` list `panels/style-panel.ts`, whose change is a refactor. Their prose describes the chip and the Style tab's tally by colour and behaviour, which do not change, so none changes. Re-read `properties.md` and `components.md` against the images the screenshot lane re-captures: a component instance's Component Settings heading now shows an amber mark whenever a prop is left to its component default.
- **Graduation:** no. The spec keeps open items owned by other plans (§2.1, §2.2, §4.3, §4.4 and more). The landing pull request deletes this file and removes it from any dependent's `requires`.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green, including the new cases, and no file falls below its threshold.
- `bun run --cwd packages/studio lint:styles` and `bun run --cwd packages/studio styles:check` pass.
- `grep -nE '\.(style-row|set-dot|provenance-chip)' packages/studio/styles/*.css packages/studio/styles/*.json` prints nothing.
- `grep -rnE 'part="provenance-chip"|"section-dot"|--text-secondary|still draw a .\.style-row|DEAD in the stylesheets|§4\.1.s standard form row, stacked, with' packages/studio/src` prints nothing.
- `grep -nE 'style-row|set-dot' specs/studio-ui-guidelines.md` prints only §10's "`.style-row` and `.field-row` are gone" item, the changelog, and §2.2's cell if `plan:studio-ui-guidelines/chrome-type-scale` has not landed.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists §4.1 or §4.2.
- These gates pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:section-refs`, `bun run docs:prose` and `bun run docs:markdown`.
- By hand, with `bun run dev` from the repository root (the `packages/studio:verify` recipe):
  - Select a link whose `href` is bound and whose `target` is set. The Content tab's collapsed Link heading shows a violet and an accent dot, and its tooltip reads "1 set here · 1 bound".
  - Adjacent Content tab rows compute a 2px gap between label and field and `2px 0` padding.
  - With DevTools' Rendering panel emulating `forced-colors: active`, a set chip and every heading dot on the Style and Content tabs, and the SEO dialog's set chip, draw a ring.
