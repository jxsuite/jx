---
status: drafted
disposition: reconcile
claims:
  - studio.md#6.2
requires: []
gaps: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# The Style Sidebar section describes the sections and controls the CSS metadata declares, and its filter and Relative Styling do what it says

## Context

`specs/studio.md` §6.2, heading line 517, marker line 519 (the section was unmarked before the census, and the first audit pass listed it as verified):

> **Status: Partial.** The Target Line and its element-aware selector axis, `:popover-open` shown on the canvas, the axis and test-data commands, breakpoint sizing and the Edit column's width drag, the resolving-with popover, the input types, the colour picker and the font-family combobox ship (`packages/studio/src/surfaces/target-line.ts`, `canvas/edit-width-drag.ts`, `panels/style-panel.ts`, `ui/color-selector.ts`). The Sections table is stale: the panel draws the sections `packages/studio/data/css-meta.json` declares in `$sections`, which include a Size section the table omits (width, height, their minimums and maximums, `aspectRatio`, `objectFit`, `overflow`, `boxSizing`) and file `opacity` under Background and `overflow` under Size, where the table puts both under Effects.

Re-verified against the working tree on 2026-09-27. Paths are under `packages/studio/` unless stated.

**What the panel draws** (`buildEditor` in `src/panels/style-panel.ts`: `[...propertySections(ctx), ...nestedSection(ctx), ...customSection(ctx)]`)

- `propertySections` is the only reader of `cssMeta.$sections`. It files every `$defs` entry by `$section`, skips a longhand (`$shorthand` is a string naming its shorthand; `shorthandRows` draws it inside that row), sorts by `$order`, and draws every declared section in declared order except `other`. A `$layout: "grid"` section (Size) lays out two columns and `$span: 2` takes both. `data/css-meta.json` declares Layout, Size, Spacing, Positioning, Typography, Background, Border, Effects, Other. The marker's member list for Size holds.
- `nestedSection` draws **Relative Styling** (key `nested`) only when the current coordinate declares an object-valued key: the nested rules, such as `:hover` or `th`.
- `customSection` draws **Custom** under key `other` with the literal label `"Custom"`. It lists every declaration `$defs` does not describe (a `--*` custom property included) as editable name/value pairs, and ends in an add field. css-meta's own `{ "key": "other", "label": "Other" }` is never drawn by that label, and no `$defs` entry is filed under `other`. One that was would be drawn nowhere: `propertySections` skips `other`, and `customSection` lists only undescribed keys.

**Corrections to the stub**

- **The Input Types table is stale too.** The marker credits "the input types" as shipping, which is true of the controls but not of the table. `inferInputType` (`src/utils/studio-utils.ts`) picks, first match wins: `$shorthand: true`, `$input: "button-group"`, `format: "color"`, `$units`, `type: "number"`, `enum`, `examples`/`presets`, else text. `fieldRow` in `style-panel.ts` draws an `enum` as a `jx-combobox` with `allows-custom-value` (§6.2's own dual-mode prose says so), not the table's "Select dropdown". The table has no row for the eight button groups (`display`, `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignContent`, `alignSelf`, `textAlign`), the plain number field (`opacity`), or the `examples`/`presets` combobox (17 entries, `fontFamily` and `transform` among them).
- **The filter breaks on a camelCase name.** `sectionRows` lower-cases the filter and tests `prop.includes(ctx.filter)` against the camelCase key. So `fontS`, `minwidth` and the CSS spelling `flex-wrap` match nothing, although §6.2's Property Filter says "by name or label (case-insensitive substring)". The test "filter matches against the human-readable label" admits this in a comment.
- **Opening a Relative Styling rule loses the element.** The row's `open` calls `selectStylebookTag(compound, undefined, { panCanvas: true })` in every mode. `selectStylebookTag` (`src/panels/stylebook-panel.ts`) parks the selection on the document root (`[[]]`) and writes `shell.stylebook.selection`. Outside Project Styles, the Style tab then edits the ROOT's rule, not the selected element's. The test "a nested rule opens as a compound selector" mocks `selectStylebookTag` and asserts only the call. `docs/studio/design/style-inspector.md` and `states-and-selectors.md` promise a drill into the element's own rule.
- **Relative Styling's + Add writes an empty rule.** `_nestedAdd` calls `ctx.commit(name, {})`, and "+ Add opens a selector dialog and creates an empty rule; blank or cancel is ignored" asserts `{}`. §6.2's Nested Selector Context rule for naming a selector ("points the tab at that selector without writing anything … an abandoned selector leaves no empty rule behind") holds only for the Target Line's Add Selector (`onAddCustom`).
- Conditional Display does not say that a set property whose `$show` fails is still drawn, flagged (`row.warning`; test "a set value whose $show condition fails is marked"). Property Filter does not say that Relative Styling and Custom are unfiltered.

**Ride-along (studio audit, Spec-wide decisions).** §6.1's widget table (lines 505 to 509) names `renderMediaPicker()` and "the style panel `renderColorSelector`", and neither exists. For a component prop, `src/panels/properties-panel.ts` mounts `mountMediaPicker` (`src/ui/media-picker.ts`) when `isMediaFormat(format)` (`"image"` or `"uri-reference"`). It gives `format: "color"` a `color` row, the kit's `jx-color-field` with the project's colour tokens, and `format: "date"` a text row with the `YYYY-MM-DD` placeholder.

The disposition stays `reconcile`: the tables are rewritten to what ships. The code changes make statements §6.2 and the docs already make come true, or (the Open below) extend §6.2's own rule to a second entry point.

## Outcome

- studio.md §6.2 → Implemented (marker deleted). Sections names `css-meta.json` as the one list, says how the panel draws it, and names Relative Styling and Custom. Input Types follows `inferInputType`. Conditional Display, Nested Selector Context and Property Filter say what ships.
- The filter matches `flexWrap`, `flexwrap`, `flex-wrap` and `Flex Wrap` alike. Outside Project Styles, opening a Relative Styling rule keeps the element selected. With the Open signed as recommended, + Add opens the new rule and writes nothing. css-meta's catch-all is labelled as the panel draws it.
- Ride-along: §6.1's format table names the media field and `jx-color-field`. §6.1 carries no marker and gains none.
- studio.md does not graduate: other items stay open, so `plans/studio/` stays.

## Decisions

- **Decided:** §6.2 names the source and the rule, not the member list: `$sections` for the sections, each entry's `$section` and `$order` for the members, and `propertySections` as the one reader. The table was a hand copy of that file and drifted from it. `plan:studio/insert-palette-categories` gives §5.3's categories the same treatment. Input Types stays a table, keyed on the metadata field that decides each control in `inferInputType`'s order: that mapping is code, not data, and it is what someone adding a css-meta entry needs.
- **Decided:** css-meta's catch-all keeps its key `other` and takes the label the panel draws, `Custom`, and `customSection` reads it from `$sections`. A label in the data that nothing draws is the drift this plan removes. The key stays because `session.ui.styleSections.other` holds Custom's open state, and `plan:studio/cem-contract-editors` opens the section through it.
- **Decided:** fix the filter rather than reword the spec. The name match lower-cases the key and also tests its CSS spelling (`camelToKebab` from `@jxsuite/runtime/css`). §6.2 already promises a case-insensitive name match, and `flex-wrap` is the name a CSS author types. The filter stays on the property sections, as it ships, and the spec says so: Relative Styling and Custom list only what this coordinate declares, and Custom ends in the field that adds a property, which a filter must never hide.
- **Decided:** outside Project Styles, opening a Relative Styling rule calls the function the Target Line's selector menu calls (its `onSelect` body, extracted), and the selection stays where it is. Project Styles keeps `selectStylebookTag`, whose tag-path selection §7.3 describes. This makes the documented drill true, and `:popover-open` and the dialog states get their canvas simulation from either entry point.
- **Open:** should Relative Styling's **+ Add** open the rule it names without writing it, as the Target Line's Add Selector does? Recommendation: yes. After the drill fix it is one call, it removes the only path that leaves `{}` in a saved document, and the author lands on the rule they named rather than on a row they must then click. The rule is listed once its first property is set. If signed the other way, the existing test stays, the Nested Selector Context sentence below is not added, and the Relative Styling bullet says: "**+ Add** names a rule through the prompt dialog and writes it empty, so it is listed and removable at once."
- **Decided:** fragment level `minor`, the program's level for a `reconcile`. Nothing an author writes depends on the tab's layout. The one change to what it writes, the empty rule + Add no longer leaves, removes a residue and breaks no reader.

## Implementation

One pull request. Paths are under `packages/studio/` unless they start with `specs/` or `docs/`.

1. `data/css-meta.json`: the last `$sections` entry becomes `{ "key": "other", "label": "Custom" }`. Nothing else changes.
2. `src/panels/style-panel.ts`:
   - Import `camelToKebab` from `@jxsuite/runtime/css`, as `src/panels/stylebook-doc.ts` imports `isKeyframesAtRule`.
   - `sectionRows`: the filter test becomes `[prop.toLowerCase(), camelToKebab(prop), propLabel(entry, prop).toLowerCase()].some((s) => s.includes(ctx.filter))`. `ctx.filter` is already lower-cased in `buildEditor`.
   - Move the Target Line's `selector.onSelect` body in `buildEditor` into a module function `pointStyleSelector(value: string | null): void`. It writes `activeTab.value.session.ui.activeSelector` and runs `canvas.setPopoverOpen` / `canvas.setDialogOpen` exactly as today. `onSelect` becomes `pointStyleSelector`.
   - `EditorCtx` gains `stylebook: boolean`, set in `buildEditor` as `stylebookSelector !== null`. Only the Project Styles branch of `buildView` passes a selector.
   - New `openNestedRule(ctx: EditorCtx, rule: string): void`. The compound is computed as today: the active selector, a space and the rule, or the rule alone when no selector is active. With `ctx.stylebook` it calls `selectStylebookTag(compound, undefined, { panCanvas: true })`, otherwise `pointStyleSelector(compound)`. `nestedSection`'s row `open` calls it.
   - With the Open signed as recommended, `_nestedAdd`'s `.then` calls `openNestedRule(ctx, name)` in place of `ctx.commit(name, {})`. The dialog ("Add Nested Selector", confirm "Add", non-empty validation) is unchanged.
   - `customSection`: `sectionShell("other", cssMeta.$sections.find((s) => s.key === "other")!.label, …)`. The metadata test below guarantees the entry. The doc comment reads "Custom: css-meta's catch-all `other` section, every declaration `$defs` does not describe, plus the field that adds one (studio.md §6.2)."
3. Tests as below.
4. `specs/studio.md`, the fragment and `docs/studio/design/style-inspector.md`, as under Specs & docs. Then delete this file.

**Integration contract.** No plan requires this one. Once it lands, studio.md §6.2 describes the Style tab as css-meta's `$sections` in declared order, then Relative Styling (key `nested`), then Custom (key `other`, css-meta's catch-all, which files no property). Custom adds, renames and removes any declaration css-meta does not describe, including a `--*` custom property. `session.ui.styleSections.other` stays Custom's open state, which is what `plan:studio/cem-contract-editors` relies on and may cite as "the Style tab's Custom section (§6.2)". Outside Project Styles, `session.ui.activeSelector` is the one nested-rule coordinate, and the Target Line and Relative Styling write it through one function. Inside Project Styles, Relative Styling still selects through `selectStylebookTag`, so `plan:studio/stylebook-layers-tag-keys` and `plan:studio/stylebook-editing-text` keep their premises. Those two also add cases to `tests/style-panel.test.ts`. That is a textual overlap, not an ordering constraint.

## Tests

`bun test --isolate --coverage` from `packages/studio`. Both files already import `./harness` or `./with-dom.js` first.

`tests/style-panel.test.ts` gains `import cssMeta from "../data/css-meta.json";` and:

- `describe("section accordion")`, "the sections are css-meta's in declared order, then Relative Styling, then Custom". Setup `setupTab({ table: { th: { color: "blue" } } })` with `activeSelector` `"table"`. The `data-section` of every `[part="section"]` equals the `$sections` keys without `other`, then `"nested"`, then `"other"`. Each item's `label` property equals its `$sections` label, so `other`'s reads `Custom`.
- `describe("filter bar")`, "a property matches by its name in either spelling, whatever the case". With `setupTab({ display: "flex" })` and `styleFilter` `"flexW"`, the `flexWrap` row is drawn and `flexDirection` is not. After a re-render with `"flex-wrap"`, the same holds.
- `describe("relative styling section")`: "a nested rule opens as a compound selector" is replaced by two cases.
  - "opening a nested rule points this tab at it, and the element stays selected". `nestedTab()`, then click `nested-open` on the `th` row. `activeSelector` is `"table th"`, `selection` equals `[["children", 0]]`, and `selectStylebookTagMock` was not called.
  - "in Project Styles, opening a nested rule selects its tag path". Call `resetWorkspaceWithTab({ tagName: "div", style: { table: { th: { color: "blue" } } } })` with `selection` `[[]]`, and set `shell.stylebook.selection` and `activeSelector` to `"table"`. After `renderPanel("stylebook")` and the click, `selectStylebookTagMock` was called with `("table th", undefined, { panCanvas: true })`.
- With the Open signed as recommended, "+ Add opens a selector dialog and creates an empty rule; blank or cancel is ignored" becomes "+ Add opens the rule it names without writing it; blank or cancel is ignored". After `" td "`, `activeSelector` is `"table td"` and `table.td` is undefined. The closing key check becomes `["textTransform", "th"]`.

`tests/metadata.test.ts`, `describe("css-meta.json")`, "the last section is the catch-all `other`, and no property is filed under it": `cssMeta.$sections.at(-1).key` is `"other"`, and no `$defs` entry has `$section` `"other"`.

No source file is added, so `bun scripts/check-coverage-manifest.ts packages/studio` is unaffected. `pointStyleSelector` and `openNestedRule` are the only new functions, and the Target Line cases and the new Relative Styling cases exercise both. `style-panel.ts` is not the workspace's worst file, so `coverageThreshold` in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) stays.

## Specs & docs

`specs/studio.md`, in place. No numbered heading changes.

- **§6.2 marker (line 519):** delete it.
- **Line 561** ("Organized, metadata-driven style sections. …", which sits under `#### resolving with`): delete it. Its content opens the new Sections text.
- **`#### Sections`:** the table is replaced by:

  > **The sections are data, not a list kept here.** `packages/studio/data/css-meta.json` declares them in `$sections`, each a `key` and a `label`. It describes every property the panel knows in `$defs`, as JSON Schema (`type`, `enum`, `format`, `examples`, `minimum`, `maximum`) plus annotations this section reads, among them the property's `$section` and its `$order` within it. `propertySections` in `packages/studio/src/panels/style-panel.ts` is the one reader. It draws the declared sections in declared order, each holding the properties filed under it in `$order` order. A longhand whose `$shorthand` names its shorthand is drawn inside that shorthand's row rather than on its own. A section declaring `$layout: "grid"` lays its rows out in two columns, where a property with `$span: 2` takes both.
  >
  > The last declared section, `other`, files no property. It is drawn last, labelled as declared, after one section the metadata does not declare:
  >
  > - **Relative Styling** lists the nested rules declared at the current coordinate: a state such as `:hover`, or a rule for elements inside this one such as `th`. Opening one points the tab at it, compounded onto the active selector, as choosing it on the Target Line would, and the element stays selected. In Project Styles it selects that tag path, as a Layers row does (§7.3). **+ Add** names a rule through the prompt dialog (`studio-ui-guidelines.md` §8.7) and opens it without writing anything, by the rule under Nested Selector Context. The section is drawn only when there is a rule to list.
  > - **Custom** (`other`) lists every declaration css-meta does not describe, a `--*` custom property included. Each is a name and a value, both editable, with the CSS initial value as the placeholder. The section ends in a field that adds a property by name. A declaration css-meta describes belongs to its own section and never to Custom.

- **`#### Input Types`:** the table is replaced by a lead sentence and a table:

  > A row's control is decided by its css-meta entry, first match wins (`inferInputType`, `packages/studio/src/utils/studio-utils.ts`):
  >
  > | Entry                           | Control                                                                                                                                                                                                                         |
  > | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  > | `$shorthand: true`              | The combined value, with a chevron that expands its `$longhands` as child rows. A `$shorthandType: "border-side"` shorthand expands into width, style and colour. The sides are written back in the shortest form               |
  > | `$input: "button-group"`        | One button per value (`$buttonValues`, else `enum`), with its `$icons` glyph where the kit has one. The current value is pressed, and pressing it again clears it. The `enum` values without a button are in a menu beside them |
  > | `format: "color"`               | `jx-color-field` (Color Picker below)                                                                                                                                                                                           |
  > | `$units`                        | A number field beside a menu of the units, then the entry's `$keywords` (The dual-mode row below)                                                                                                                               |
  > | `type: "number"`                | A number field bounded by `minimum` and `maximum`                                                                                                                                                                               |
  > | `enum`, `examples` or `presets` | `jx-combobox` with `allows-custom-value` over those values (Font Family and The dual-mode row below)                                                                                                                            |
  > | anything else                   | A text field                                                                                                                                                                                                                    |
  >
  > A row on the Mixed text rung of the value-source ladder (§6.6) is a monospaced text field, whatever its entry says.

  The formatter re-pads the table.

- **Conditional Display (the `$show` heading):** the sentence becomes: "A property whose entry carries `$show` is drawn only while its conditions hold against the same coordinate's values. Each condition names a `prop` and the `values` that satisfy it, and an empty list means any value but `initial`. The flex properties, for example, appear once `display` is `flex` or `inline-flex`. A property that is set is drawn whatever its conditions, flagged when they fail, so a value that no longer applies stays visible and removable."
- **`#### Nested Selector Context`:** append "Relative Styling's **+ Add** (Sections above) follows the same rule." (only with the Open signed as recommended).
- **`#### Property Filter`:** the first sentence becomes: "One control: a search input that matches a property by its name as the document spells it (`flexWrap`), its CSS name (`flex-wrap`) or its label (`Flex Wrap`), as a case-insensitive substring. While it holds text every property section opens, and a section it empties is not drawn. Relative Styling and Custom are drawn as they would be without it." The sentence after it (no second control) is unchanged.
- **§6.1, the `format` table (lines 505 to 509):**

  | `format`                     | Control                                                                                                                          |
  | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | `"image"`, `"uri-reference"` | The media field (`mountMediaPicker`, `packages/studio/src/ui/media-picker.ts`): a thumbnail, the value, Upload and Browse (§9.3) |
  | `"date"`                     | Text field with `placeholder="YYYY-MM-DD"`                                                                                       |
  | `"color"`                    | The kit's `jx-color-field` (`ui.md` §5.6) with the project's named colours, the field the Style tab's colour rows draw (§6.2)    |

**Fragment:** `bun run spec:change studio.md minor -m "§6.2 states the Style tab's sections as the ones css-meta.json declares, followed by Relative Styling and Custom, restates its input types, conditional rows and filter as they ship, and has Relative Styling open and add a nested rule on the selected element, writing nothing until a property is set; §6.1's format table names the media field and the colour field."` If the Open is signed the other way, "open and add a nested rule on the selected element, writing nothing until a property is set" becomes "open a nested rule on the selected element".

**Docs.** `docs/studio/design/style-inspector.md` cites `studio.md#6.2` and lists `style-panel.ts` in `code:`. It is the one page that changes. None of the new text uses an em dash.

- "Sections and the filter": "Type part of a property's name or label" becomes "Type part of a property's name, in either spelling (`flexWrap` or `flex-wrap`), or of its label".
- "The inputs" gains a bullet after **Number + unit**: "**Buttons**: display, flex direction, the alignment properties and text alignment show their common values as a row of buttons. The current value is pressed, and pressing it again clears it; values without a button are in the menu beside them."
- "Custom and relative styling": the two bullets swap, so **Relative Styling** comes first, as the tab draws it. Its sentence "Click a rule to drill into it and edit it with the full inspector" gains "; the element stays selected". With the Open signed as recommended, the **+ Add** sentence becomes "**+ Add** opens a dialog where you type a selector to nest under the current rule (`th`, `:hover`, `.active`); click **Add** to start editing it. Nothing is written until you set a property, so a rule you abandon leaves nothing behind." The heading keeps its text: no link targets its anchor.

`bun run docs:sync` also names these pages; each is already true after the change and is unchanged:

- `docs/studio/design/states-and-selectors.md` (`spec:` §6.2, `code:` `style-panel.ts`). It already says Relative Styling drills into a rule through the selector segment and that Add Selector writes nothing.
- `docs/studio/design/stylebook.md` (`code:` `style-panel.ts`). Project Styles' drill is unchanged.
- `docs/README.md`, whose §6.2 citation is inside a fenced example.
- `docs/studio/design/properties.md` already describes the media picker and the colour control, and `properties-panel.ts` does not change.

No image changes: the drawn labels are the same.

## Acceptance

- `sed -n '/^### 6.2 /,/^### 6.3 /p' specs/studio.md | grep -c "Status: Partial\|Unlisted properties\|Select dropdown\|^Organized, metadata-driven"` prints 0, and `grep -c "renderMediaPicker\|renderColorSelector" specs/studio.md` prints 0.
- `bun run plans:status --who-claims studio.md#6.2` names no plan, and `bun run plans:check --audit studio` reports nothing for studio.md §6.2.
- `ls specs/changes/studio-*.md` includes the new fragment, and `bun run spec:release --dry` mints a studio.md minor.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:prose` pass.
- From `packages/studio`: `bun test --isolate --coverage tests/style-panel.test.ts tests/metadata.test.ts` passes. The full `bun test --isolate --coverage` keeps every file above `coverageThreshold`, and `bun scripts/check-coverage-manifest.ts packages/studio` passes from the repository root.
- In Studio, open a page and select an element whose style has a `:hover` rule. In the Style tab's filter, `flex-wrap` and `fontS` each leave their property's row. Clearing the filter and opening `:hover` under **Relative Styling** leaves the element selected in the Outline, with the Target Line ending in `:hover`. **+ Add** with `.active` makes the Target Line read `.active`, and the saved file gains no `.active` key until a property is set.
