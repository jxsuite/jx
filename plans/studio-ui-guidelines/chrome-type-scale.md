---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#2.2
requires: []
workspaces:
  - packages/studio
size: S
---

# The type scale names the kit's tokens, and the jump bar's breadcrumbs draw at its 11px step again

## Context

`specs/studio-ui-guidelines.md` §2.2, line 92:

> **Status: Partial.** The scale is the kit's `--jx-text-xs`/`sm`/`md`/`lg` (10/11/12/14px, `ui.md` §4), and the 12px base, the 10px row labels and the 1.5 line height hold. `jx-field` labels and `jx-accordion-item` headers draw at `--jx-text-md` (12px), not the 11px this table assigns, because Studio stamps no `data-density="compact"`; the breadcrumbs draw at 10px, because the jump bar sets `--jx-text-xs` on its root and every crumb inherits it (`packages/studio/src/surfaces/jump-bar.json`); and no 1.7 content-mode line height exists.

The table under it (lines 94–101) gives 12px to base text, 11px to "Form labels (`jx-field`), breadcrumbs, accordion headers", 10px to "Hints (`.style-row-label`), badges, data explorer, secondary labels", 9px to micro indicators, and "**Line height:** 1.5 (base), 1.7 (content mode)".

**What exists** (verified 2026-09-27)

- `packages/ui/project.json`: `--jx-text-xs/sm/md/lg` = 10/11/12/14px, `--jx-leading-*` = 14/16/18/20px, and `&[data-density="compact"]` re-declaring `--jx-text-md` 11px and `--jx-leading-md` 16px. The block compounds onto `:root` (`:root[data-density="compact"]`, pinned in `packages/ui/tests/theme.test.ts`), so density applies to the whole document or not at all.
- `packages/studio/styles/tokens.json`: `:root`'s `font-size` is `var(--jx-text-md, 12px)` and its `line-height` is `1.5`. Nothing in Studio writes `data-density`, which `createVirtualWindow`'s docblock in `packages/studio/src/ui/virtual-window.ts` states.
- `packages/ui/components/jx-field.json`: `[part="label"]` draws `--jx-text-md`/`--jx-leading-md`, and `[part="help"]` draws `--jx-text-sm`. The label rule is a measured port of the kit's `.jx-field-label` recipe, pinned as rule text in `packages/ui/tests/field.test.ts` ("the label owns its own 80px box").
- `packages/ui/components/jx-accordion-item.json`: the host draws `--jx-text-md`/`--jx-leading-md`, so the header and the body share it. Two Studio surfaces draw 11px headers in their own style block: `panel-signals.json` re-declares `--jx-text-md: var(--jx-text-sm)` on `[part="category"]` (its root is already `--jx-text-sm`), and `doc-header.json` sets `[part="raw"] [part="summary"]` to `--jx-text-sm`. The Inspector's Style and Properties sections, the Insert panel and the Logic panel draw the kit's 12px.
- `packages/studio/src/surfaces/jump-bar.json`: the root `nav` sets `fontSize: var(--jx-text-xs)`, and `[part="crumb"]` and `[part="alternatives"]` take it through `font: inherit` with `lineHeight: 1` in a fixed 24px bar. It is the only breadcrumb in the shell (the comment above `mountJumpBar` in `packages/studio/src/studio.ts`).

**Found while detailing**

- **Compact density cannot implement the table.** It re-declares the token `:root`'s own `font-size` reads, so it would move the 12px base row to 11px along with the labels. That takes the 19 kit components and 49 Studio surfaces that name `--jx-text-md` down with it. The stub's lever replaces the table's first row rather than satisfying its second.
- **The 10px breadcrumbs are a conversion slip, not a choice.** `.jump-bar` in `styles/shell.css` drew `var(--spectrum-font-size-50, 11px)` until d402e19c. That commit states the mapping `--spectrum-font-size-50` (11px) → `--jx-text-sm` in the `$description`s of `ai-chat.json`, `git-panel.json` and `preferences.json`, but wrote `--jx-text-xs` for the jump bar.
- **The 10px row's "data explorer" is stale too.** `panel-data.json` draws its rows at `--jx-text-sm` (11px), as `.data-leaf, .data-branch` did before the conversion (`--spectrum-font-size-50`).
- **"Form labels" at 11px once meant a different label.** The row was written as `sp-field-label size="s"` inside `.style-row-label` (91f2b29e), which is the stacked row's label. That label is now `[part="row-label"]` at `--jx-text-xs` in `style-panel.json`, `properties-panel.json`, `panel-page.json` and `doc-header.json`. `jx-field` is the kit's two-column row, and its 12px label is a kit design decision.
- The 9px row holds as literals below the scale: the Outline's kind badges (`panel-outline.json`) and the stylebook layer list's component badge (`panel-stylebook-layers.json`). Off-scale 13px and 16px literals survive in several Settings surfaces and `about.json`. The table does not claim to be exhaustive, so they are not an item, and the rewrite below must not claim exclusivity either.

## Outcome

studio-ui-guidelines.md §2.2 → Implemented. The jump bar draws its address at `--jx-text-sm` (11px). The table is rewritten by token to what the chrome draws: `jx-field` labels and accordion headers at the kit's `--jx-text-md` base, the per-surface 11px headers named with the §5.2 mechanism, the data explorer at 11px, row labels by their part, and no content-mode line height.

## Decisions

- **Open:** do field labels and accordion headers move to 11px (the table's figure), or does the table move to the 12px the kit draws? Recommendation: the table moves. The kit owns its elements' look (`ui.md` §5.4, and this spec's own §5.2), and `jx-field`'s 12px label is a measured port pinned by `packages/ui/tests/field.test.ts`. The 11px figure described a stacked-row label Studio no longer draws. Both Studio-side routes to 11px are worse. Compact density shrinks the base with the labels (Context). A Studio rule on `jx-field > [part="label"]` or the accordion summary would be the stylesheet-that-knows-a-component's-internals that §5.2 retired. If the kit route is chosen instead:
  - `packages/ui/components/jx-field.json`'s label goes to `--jx-text-sm`/`--jx-leading-sm`, and `field.test.ts`'s rule text changes with it.
  - `jx-accordion-item.json` gains `fontSize: var(--jx-text-sm)` on the summary's `[part="label"]`, with the host left at `md` so the body does not shrink, and `panel-signals.json`'s override is deleted.
  - `packages/ui` joins `workspaces`, and `ui.md` §5.3 and §5.4 gain the sizes as a minor fragment.
  - `plan:studio-ui-guidelines/accordion-styling-facts` must then require this plan.
- **Decided:** the jump bar's root `fontSize` becomes `var(--jx-text-sm)`, because the spec and the pre-conversion bar agree on 11px and the 10px came from a mis-mapped token (Context). The single root declaration moves the crumbs, separators and chevrons together. The bar's `height: 24px` and the adapter's `JUMP_BAR_HEIGHT` do not change, since each crumb's line box is `lineHeight: 1`.
- **Decided:** the two surfaces that draw 11px section headers keep them, and the table says how rather than listing exceptions. §5.2 makes a section's look the surface's own style block, and both panels set the header to their own body step.
- **Decided:** Studio stays at the default density and writes no `data-density`, because the table's 12px base is the default density's `--jx-text-md`. The spec now says so, which keeps `virtual-window.ts`'s docblock true.
- **Decided:** the data explorer moves to the 11px row and the 9px row stays a literal row, because both describe what ships (Context). A 9px token is `ui.md` §4.3's call and outside this plan.

## Implementation

1. `packages/studio/src/surfaces/jump-bar.json`, the root `style`:
   - Change `"fontSize": "var(--jx-text-xs)"` to `"fontSize": "var(--jx-text-sm)"`.
   - Append one sentence to the block's `$description`: "The address reads at the type scale's breadcrumb step, `--jx-text-sm` (studio-ui-guidelines.md §2.2), which is the 11px `--spectrum-font-size-50` was; every crumb, separator and chevron inherits it through `font: inherit`." The citation is qualified, because a bare `§` in `packages/studio` means `studio.md`, and `bun run docs:section-refs` resolves it.
2. No adapter change. `packages/studio/src/panels/jump-bar.ts` sets `--jump-bar-h` from `JUMP_BAR_HEIGHT` (24), which matches the unchanged box.
3. The spec rewrite in **Specs & docs** lands in the same pull request.

**Integration contract.** Once this lands, `studio-ui-guidelines.md` §2.2 says:

- the chrome draws the kit's four steps at the default density, and Studio writes no `data-density`;
- `jx-field` labels and accordion headers draw `--jx-text-md` (12px), and a panel that wants smaller section headers sets them in its own style block per §5.2;
- the jump bar's breadcrumbs are `--jx-text-sm`, and the stacked row's label is `[part="row-label"]` at `--jx-text-xs`;
- no content-mode line height exists.

`plan:studio-ui-guidelines/accordion-styling-facts` may state the header token as `--jx-text-md` and cite the two surface overrides as §5.2's pattern. `plan:studio-ui-guidelines/font-stacks` may rely on §2.2 no longer mentioning a content mode, so §2 is clean once it drops the Georgia row. `plan:studio-ui-guidelines/form-row-part-vocabulary` may rely on §2.2 already naming `[part="row-label"]`. Under the recommendation, none of them needs to land after this one. Under the kit route, the accordion plan does (see Decisions).

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `packages/studio/tests/jump-bar.test.ts`: add "the address reads at the breadcrumb step of the type scale" under `describe("the rendered bar")`.
  - It reads `src/surfaces/jump-bar.json` with the file's existing `readFileSync`/`join`/`resolve` imports and parses it.
  - It asserts `style.fontSize === "var(--jx-text-sm)"`.
  - It asserts that `style['& [part="crumb"]'].font` and `style['& [part="alternatives"]'].font` are both `"inherit"`, so no crumb can drift off the bar's step.
  - The existing "prints one crumb per segment, separated, and reserves its own height" case keeps asserting `--jump-bar-h` is `24px`, which proves the step change did not move the bar.
- Coverage: no TypeScript source changes and no file is added, so the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) and the manifest check are unaffected, and there is no ratchet.
- The change touches `packages/studio/src/**`, so the screenshot lane re-captures every shot that shows a jump bar and comments with the before/after table. That is expected. Review the pictures, not a red X.

## Specs & docs

- **studio-ui-guidelines.md §2.2** (lines 92–101): delete the Partial marker, the table and the line-height line, and replace them with the text below. The section carries no marker afterwards, like the built §4.5 and §4.6. The heading stays.

  > The scale is the kit's (`ui.md` §4.3): `--jx-text-xs`, `--jx-text-sm`, `--jx-text-md` and `--jx-text-lg`, at 10, 11, 12 and 14px, each with its `--jx-leading-*` step on the 4px line grid. Studio stamps no `data-density`, so the chrome draws the kit's default density and `--jx-text-md` is the 12px base (`ui.md` §4.2).
  >
  > | Size     | Token          | Usage                                                                                                         |
  > | -------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
  > | **14px** | `--jx-text-lg` | Titles and headline values: a dialog's or the welcome screen's title, the palette's input, the current branch |
  > | **12px** | `--jx-text-md` | Base body text (`:root`), the kit controls' own text, form labels (`jx-field`), accordion headers             |
  > | **11px** | `--jx-text-sm` | Breadcrumbs (the jump bar), a field's help line, the data explorer                                            |
  > | **10px** | `--jx-text-xs` | Row labels (`[part="row-label"]`), badges, secondary labels                                                   |
  > | **9px**  | a literal      | Micro indicators below the scale: the Outline's and the stylebook layer list's kind badges                    |
  >
  > Form labels and accordion headers draw at the size their kit element gives them. A panel whose own text runs a step smaller sizes its section headers in its own style block (§5.2), as the Signals panel's categories and the document header's Raw head tags do at 11px.
  >
  > **Line height:** 1.5 on `:root`; a kit element draws its step's `--jx-leading-*`.

  (The quote marks show the replacement text; the spec text itself is not a blockquote.) `bunx oxfmt specs/studio-ui-guidelines.md` pads the table.

- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§2.2 names the kit's type tokens: the jump bar's breadcrumbs draw at 11px again, field labels and accordion headers at the 12px base, and the content-mode line height is gone."`
- **Docs:** no page's `spec:` cites `studio-ui-guidelines.md#2.2`, and no page's `code:` lists `surfaces/jump-bar.json`. `docs/studio/interface.md` ("The jump bar"), `docs/start/studio-tour.md` and `docs/studio/interface/tabs.md` describe the bar without a size, so no prose changes. Re-read those three pages against the images the screenshot lane re-captures. `docs/extending/ui-kit.md`'s density paragraph stays true.
- **Graduation:** no. The spec keeps open items owned by other plans (§2.1, §2.3, §5.2 and more). The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green, including the new jump-bar case, and no file falls below its threshold.
- `bun run --cwd packages/studio lint:styles` passes.
- `grep -n '"fontSize"' packages/studio/src/surfaces/jump-bar.json` prints `var(--jx-text-sm)`.
- `grep -n "content mode\|style-row-label" specs/studio-ui-guidelines.md` finds nothing in §2.2. §2.1 and §4.1 belong to their own plans.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists §2.2.
- These gates pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:section-refs` and `bun run docs:markdown`.
- By hand, start Studio with `bun run dev` from the repository root (the `packages/studio:verify` recipe) and open a document with a selection:
  - The jump bar's crumbs compute `font-size: 11px`, and the bar is still 24px tall.
  - An Inspector field label and a Style section header compute 12px.
  - A Signals category header computes 11px.
