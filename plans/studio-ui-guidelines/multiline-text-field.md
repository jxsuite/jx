---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#4.3
requires: []
workspaces:
  - specs
  - packages/studio
size: S
---

# The input table answers multi-line text with the kit's multiline text field, and says which fields are not kit elements and why

## Context

`specs/studio-ui-guidelines.md` §4.3, line 251:

> **Status: Partial.** Every kit row ships and is drawn by the surfaces, the colour field and the field-plus-menu hybrid included (`packages/studio/src/surfaces/style-panel.json`, `properties-panel.json`). The multi-line row does not: multi-line text is `jx-textfield multiline`, and no surface emits a `textarea` with `[part="field-input"]`.

The table's last row (line 265) is `` `textarea` with `[part="field-input"]` `` for "Multi-line text (code, JSON, expressions)". It is a mechanical rename of the Spectrum-era row `textarea.field-input`, made by e24e0e8b ("Adobe Spectrum is removed"). The same commit wrote the intro sentence "two of the old rows had no kit counterpart and were answered by composition instead". The two were that row and the hybrid. The multi-line row does have a kit counterpart now: `jx-textfield`'s `multiline` branch (`ui.md` §5.1), which is what every multi-line form field draws.

**Verified at the audited commit**

- `jx-textfield` with `multiline` in `packages/studio/src/surfaces/properties-panel.json` (`rows: 3`, `mono` per row), `logic-panel.json` (handler body: `grows`, `mono`), `panel-signals.json` (code and multiline kinds: `grows`, `mono`), `schema-form.json` (JSON text: `grows`, `mono`), `settings-head.json` (script and style bodies: `mono`, `rows`), `dialog.json` (the prompt's paste box), `git-panel.json` (commit message), `settings-overview.json` (site description), `panel-page.json`, `new-project.json` and `seo.json`. So prose uses the plain field, and code, JSON and expressions add `mono`.
- `[part="field-input"]` appears nowhere under `packages/studio/src/`. The only `"tagName": "textarea"` in `src/surfaces/` is the Assistant's composer (`ai-chat.json`, `part="composer-input"`). Its style `$description` gives the reason: it needs a 120px ceiling, and the kit field declares no token for one. `packages/ui/components/jx-textfield.json` declares only `--jx-textfield-h`, `-pad` and `-pad-end`, which confirms it.

**What the census missed.** The marker says every other row is drawn. The colour row is not, in one form. Project Settings › CSS Variables draws a native `<input type="color">` well beside a free-text `jx-textfield` (`src/surfaces/settings-css-vars.json`, `part="swatch-input"`, in both the token row and the override row). `src/surfaces/settings-css-vars.ts`'s header gives the reason as "because the kit has no colour control". That was true when 4e747a83 wrote it on 2026-09-09, and stopped being true the next day, when c7427a65 landed the kit's colour family. A reason still stands, though. A token's value is typed CSS (`var()`, `hsl()`, `color-mix()`, a keyword), and `jx-color-field` refuses any typed value `parseColor` (`packages/ui/src/color.ts`) cannot decompose. `parseColor` reads only hex, `rgb()` and `oklch()` (`route()` in `packages/ui/src/behaviors/color-field.ts` sets `invalid` and dispatches nothing). Porting the well as it stands would take away an author's ability to type an alias.

Other native text controls exist in `src/surfaces/`: the listbox-overlay filters in `palette.json`, `slash-menu.json` and `formula-palette.json`, the outline's inline rename (`panel-outline.json`) and the Library's file picker (`library-pane.json`). `src/grid/cell-editors.ts` renders the data grid's cell editors as `<input>`/`<select>` in lit templates. None of these is a form row, and the table as written does not say which it covers.

**Not this plan's.** §4.1's CSS example (`.style-row > textarea`) is rewritten by `plan:studio-ui-guidelines/form-row-part-vocabulary`. §4.4's "(500ms for code/expression textareas)" is rewritten by `plan:studio-ui-guidelines/debounce-draft-layer`, which also re-reads §4.5's table.

## Outcome

- `studio-ui-guidelines.md` §4.3 → Implemented. The multi-line row is `jx-textfield` with `multiline`. The intro says how the table maps from the Spectrum one. The CSS Variables well is named as the one form row that reaches past the kit, with its real reason, and the table's scope is stated as form rows. Fields that belong to other controls, the composer among them, are named as outside it.
- §4.5's one clause, "For `jx-textfield` and `textarea`", names the kit field only.
- `settings-css-vars.ts`'s header gives the reason that holds.
- The spec stays Partial. Nothing graduates.

## Decisions

- **Decided:** `reconcile`, because every multi-line form field already is the kit's `multiline` text field, and the row's `[part="field-input"]` was a rename that never had an emitter.
- **Open:** does the CSS Variables colour well stay a native well beside a free-text field, recorded in §4.3 as the one form-row exception? The alternative is for the kit's colour field to learn to commit a typed colour expression verbatim, after which the well is ported to `jx-color-field`. Recommendation: record the exception. The port needs `ui.md` §5.6's commit-time refusal changed first. That change also reaches the Style and Content tabs, where a mistyped colour would become a written declaration instead of a refusal, so it is a kit design question for its own plan. It is not a row of this table. If maintainers choose the port, this plan becomes `implement`, and it requires a new enabling plan in `plans/ui/` for the kit change.
- **Decided:** state that the table covers form rows, and name the non-form native controls by kind in one sentence, without an allow-list gate. Deciding whether a field is "a combobox filter" or "a form field" is a judgement, not a tag test, and an allow-list of six controls would restate an enumeration that goes stale. The composer is named, with the reason its own document gives. Adding a height ceiling to `jx-textfield` would be a `ui.md` §5.1 addition, and that is for whoever wants the port.
- **Decided:** rename §4.5's clause here and leave the rest of §4.5 to `plan:studio-ui-guidelines/debounce-draft-layer`. The clause states the same fact this plan corrects. That plan rewrites all of §4.5, and its new paragraph already names the kit field "single-line or `multiline`", so if it lands first this step is skipped; if this lands first, it overwrites the clause.
- **Decided:** fix the stale reason in `settings-css-vars.ts`, although a comment edit under `packages/studio/src/` runs the studio and desktop legs and `lens-mutants`. The spec sentence this plan writes gives the opposite reason. A contributor who read the source first would port the well into the regression the spec warns against.

## Implementation

1. **`specs/studio-ui-guidelines.md` §4.3 and §4.5**, in place, exactly as given in Specs & docs.
2. **`packages/studio/src/surfaces/settings-css-vars.ts`**, header comment only. Replace the paragraph "**The colour well is a native `<input type="color">`,** because the kit has no colour control … rather than a Spectrum one." with:

   ```text
    * **The colour well is a native `<input type="color">` beside a free-text `jx-textfield`,** not a
    * `jx-color-field`. A token's value is typed CSS (an alias `var()`, an `hsl()`, a `color-mix()`, a
    * keyword), and the kit's colour field commits only a typed hex, `rgb()` or `oklch()` it can
    * decompose (`ui.md` §5.6). It is the one form row that reaches past the kit
    * (`studio-ui-guidelines.md` §4.3); the text field is the value and the well is a quick pick.
   ```

   Keep the citations qualified: in `packages/studio` a bare `§` means `studio.md`, and `bun run docs:section-refs` checks both.

3. **Fragment**, as given in Specs & docs.
4. **Plan housekeeping in the landing pull request.** Delete this file. No plan requires it, but `plan:studio-ui-guidelines/debounce-draft-layer` cites it (its paragraph on this plan's §4.5 clause); if that plan is still open, reword the sentence to cite §4.3 and §4.5 instead, or `plans:check` fails with `citation-unknown`.

**Integration contract.** No plan requires this one. Once it lands, §4.3 names `jx-textfield` with `multiline` as the multi-line form control, and the CSS Variables well as the only native control in a form row. The two plans that also remove a `textarea` from this spec do not wait for it: `plan:studio-ui-guidelines/form-row-part-vocabulary` replaces §4.1's body (and its `.style-row > textarea` selector) whole, and `plan:studio-ui-guidelines/debounce-draft-layer` replaces §4.4's body and §4.5 whole, with no `textarea` in either.

A future change that lets `jx-color-field` commit a typed colour expression, or that ports any control §4.3 names as outside the kit, deletes that control's sentence in the same pull request.

## Tests

- No new test and no changed test. The only code edit is a comment, so `bun test --isolate --coverage` from `packages/studio` (and the `packages/desktop` leg that `affected.ts` derives from it) runs unchanged. No per-file threshold in `packages/studio/bunfig.toml` moves, so nothing ratchets.
- The screenshots lane fires on a `packages/studio/src/**` change. It should capture byte-identical images and push nothing.
- The spec half is proven by the `checks` gates: `bun run docs:status` (the marker form), `bun run plans:check` (no `claim-not-open`, no dangling citation), `bun run docs:spec-release` (the body change carries its fragment), `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:section-refs` (the comment's two qualified citations resolve).

## Specs & docs

**§4.3 marker** (line 251) becomes:

> **Status: Implemented.** Every row is drawn by the surfaces: the colour field and the field-plus-menu hybrid in `packages/studio/src/surfaces/style-panel.json` and `properties-panel.json`, and the multiline text field in `properties-panel.json`, `logic-panel.json`, `panel-signals.json`, `schema-form.json`, `settings-head.json`, `git-panel.json` and `dialog.json`, among others.

**The intro paragraph** ("The catalogue is `ui.md` §5; … answered by composition instead.") becomes:

> The catalogue is `ui.md` §5; this is which of it answers which question in a form row. Every row is a kit element or a composition of kit elements. The mapping from the Spectrum-era table was not a rename: its hybrid row had no kit counterpart and is composed instead, and its multi-line row, a styled native `textarea`, is the kit text field's `multiline` branch.

**The table's last row** becomes the following. Re-pad the table columns afterwards.

| Component                       | When to Use                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `jx-textfield` with `multiline` | Multi-line text. Code, JSON and expressions add `mono`; `rows` sets the height, and with `grows` the text sets it, never below `rows` |

**After the hybrid paragraph**, append two paragraphs:

> **One form row reaches past the kit.** A design token's value in Project Settings › CSS Variables is a `jx-textfield` with a native colour well beside it (`surfaces/settings-css-vars.json`), not a `jx-color-field`. A token's value is typed CSS and may be any colour the cascade accepts: an alias `var()`, an `hsl()`, a `color-mix()` or a keyword. `jx-color-field` commits only a typed hex, `rgb()` or `oklch()` it can decompose (`ui.md` §5.6). The text field holds the value, and the well is a quick pick that writes an opaque hex.
>
> **The table is for form rows.** A field that is part of another control belongs to its surface: a listbox overlay's filter (the command palette, the slash menu, the formula palette), a tree row's inline rename, a data grid's cell editor and a file picker are native controls. So is the Assistant's composer (`surfaces/ai-chat.json`), a `textarea` because it needs a height ceiling the kit field has no token for.

**§4.5**, line 300: "For `jx-textfield` and `textarea`, always debounce `@input`." becomes "For `jx-textfield`, single-line or `multiline`, always debounce `@input`." Skip this when `plan:studio-ui-guidelines/debounce-draft-layer` has landed: its §4.5 already says it.

**Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§4.3 answers multi-line text with the kit's multiline text field, scopes the input table to form rows, and records the CSS Variables colour well as the one form row that reaches past the kit and why; §4.5 names the kit field only"`. The level is minor: a reconcile that changes a contributor guideline and nothing an author builds on. If the Open decision goes to the port, this fragment moves to that plan's landing pull request, without the colour-well clause.

**Docs.** No page's `spec:` cites `studio-ui-guidelines.md#4`. `bun run docs:sync` names `docs/studio/projects/settings.md`, because its `code:` lists `settings-css-vars.ts`. The edit is a comment, and the page's "each with a color swatch you can click to pick" still holds, so it does not change. State that in the pull request. `docs/studio/design/tokens.md` ("click it for a native picker") is not named, because `css-vars-editor.ts` is untouched, and it stays true.

No spec graduates. `studio-ui-guidelines.md` keeps its other open items.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#4.3`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `sed -n '/^### 4.3/,/^### 4.4/p' specs/studio-ui-guidelines.md | grep -n 'field-input'` prints nothing. `sed -n '/^### 4.5/,/^### 4.6/p' specs/studio-ui-guidelines.md | grep -n 'textarea'` prints nothing.
- The section's exceptions match the tree. `grep -rl '"tagName": "textarea"' packages/studio/src/surfaces` prints only `ai-chat.json`. `grep -rl '"type": "color"' packages/studio/src/surfaces` prints only `settings-css-vars.json`. `grep -rnE 'part="field-input"|"part": "field-input"' packages/studio/src` prints nothing (a bare `field-input` also matches the draft-layer module `src/ui/field-input.ts`).
- `grep -n 'kit has no colour control' packages/studio/src/surfaces/settings-css-vars.ts` prints nothing.
- The `packages/studio` and `packages/desktop` legs and `lens-mutants` are green with unchanged coverage. The screenshots lane pushes no commit.
