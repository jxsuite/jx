---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#7
requires: []
workspaces:
  - specs
size: S
---

# Spacing is specified as the kit's space scale, with 6px named as the one off-scale step Studio draws as rhythm

## Context

`specs/studio-ui-guidelines.md` §7, line 403:

> **Status: Partial.** The premise is stale: the kit ships `--jx-space-1` to `--jx-space-7` (2/4/8/12/16/24/32px, `ui.md` §4), and surfaces spell most gaps and padding through it. The 6px horizontal gap is off that scale and written as a literal, and section padding in `packages/studio/src/surfaces/properties-panel.json` is `0 var(--jx-space-2) var(--jx-space-2)`, not `4px 8px`.

Under it (lines 405 to 416): "No formal spacing scale — use these established values consistently:" and an eight-row table of loose pixel values (form row gap `2px` "(`.style-row`)", form row padding `2px 0`, section padding `4px 8px`, panel padding `8px`, child indent `16px`, component gap `4px`, horizontal gap `6px` "(signal rows, toolbar)", canvas gap `24px`).

Verified at the working tree on 2026-09-27:

- **The scale.** `packages/ui/project.json` lines 110 to 116 declare `--jx-space-1` to `--jx-space-7` as 2/4/8/12/16/24/32px. `ui.md` §4.3 is the contract, and it records that no `data-density` re-declares the space scale.
- **The surfaces use it.** Across `packages/studio/src/surfaces/*.json`, `var(--jx-space-2)` appears 180 times and `var(--jx-space-3)` 172 (all seven steps: 64/180/172/63/25/16/2). Of 958 gap, padding and margin declarations, 610 carry no pixel literal and 348 carry at least one. About 210 of those literals equal a step (`2px` 59, `4px` 52, `8px` 52, `16px` 22, `12px` 19, `24px` 5, `32px` 1).
- **6px is broader than the marker says.** It is the most common literal (94 declarations), not only a gap: 29 `"gap": "6px"` in inline runs (section bands in `panel-page.json` and `panel-imports.json`, add forms in `settings-defs.json`, `settings-contributed.json` and `settings-locales.json`, steps in `panel-activity.json` and `panel-deploy-checklist.json`, six rules in `ai-chat.json`); the block padding of the dock headers (`6px var(--jx-space-3)` in `navigator-dock.json` and `inspector-dock.json`) and the grid toolbar; and the shell toolbar's gap (`#toolbar` in `packages/studio/styles/shell-frame.json`). 10px (14 declarations) and 1px, 3px and 5px (border compensations and pill centring) are the other off-scale values.
- **The table's other rows.** The stacked row's 2px gap and `2px 0` padding hold (`style-panel.json` `[part="rows"] > [part="row"]`; §4.1 states the same geometry). The child indent is `var(--jx-space-5)` (`style-panel.json` `[data-child="true"]`). The row label's gap is `var(--jx-space-2)` in the Style tab and `4px` in the Content tab. A section's body is padded by the kit (`packages/ui/components/jx-accordion-item.json`, `[part="body"]` `var(--jx-space-2)`), and the Content tab adds `0 var(--jx-space-2) var(--jx-space-2)` inside it. Strips above a list pad `var(--jx-space-2) var(--jx-space-3)` (the Files and Signals toolbars, the Style tab's filter). A panel body that pads splits between two steps: `var(--jx-space-2)` in `panel-page.json` and `panel-imports.json`, `8px` in `panel-activity.json` and `panel-i18n.json`; the Files, Outline and Signals bodies pad nothing and their rows pad themselves. The old table's single `8px` is true of half of them. The canvas artboards' gap is `24px` (`canvas-stage.json` `[part="panzoom"]`). The signal rows the table cites now gap `var(--jx-space-2)` (`panel-signals.json`), not 6px.
- **The policy already exists, outside the spec.** `packages/studio/STYLING.md` ("Spacing, structure, elevation — pragmatic") says to prefer `--jx-space-*` where a step fits and that off-grid spacing (6px, 10px) may stay a literal. The header of `packages/studio/scripts/check-styles.ts` says spacing is "intentionally not policed — the kit's scale is coarse and a dense editor UI legitimately uses off-grid structural px"; its nudge covers font sizes and radii only (16 nudges today). The census missed both; §7 is the one statement of the policy that contradicts them.
- **No docs page** cites `studio-ui-guidelines.md#7` in `spec:`, and nothing outside `specs/` cites §7 (the generated `docs/extending/reference/implementation-status.md` lists it from the marker).

## Outcome

- studio-ui-guidelines.md §7 → no marker (built, like §4.5 and §4.6): Studio's spacing is the kit's space scale by pointer to `ui.md` §4.3, a step is written as its token, a between-step value stays a literal, 6px is named as the one off-scale step used as rhythm, and a short table gives the step each recurring context draws.
- No code, stylesheet or `STYLING.md` change: the rule §7 states is the one `STYLING.md` and `check-styles.ts` already hold.

## Decisions

- **Open:** what becomes of 6px? Recommendation: §7 names it as a permitted off-scale literal and nothing moves, because `STYLING.md` and `check-styles.ts` already say so, and each alternative costs more than it buys. A Studio alias (say `--space-inline: 6px` in `packages/studio/styles/tokens.json`) is a second scale beside the kit's, which is what §1.1 says belongs in the kit's `project.json`, and its 94 uses would each have to be judged, since 6px is a gap, a dock header's padding and a margin by turns. Moving them to 4px or 8px redraws every dense panel and has the screenshot lane re-capture most docs images, with no defect behind it; a surface may still bring its own values onto the scale when it is converted, as `ai-managed-connect.json` did with its 10px and 6px. A kit step has no slot: `ui.md` §4.3's numbered scale has nothing between `--jx-space-2` and `--jx-space-3`, so it would be a rename every site's tokens feel. If the alias or the move is chosen, this plan becomes an S `implement` in `packages/studio` (surfaces, `styles/shell-frame.json`, `STYLING.md`), and the Inline run and Dock header rows below name the result.
- **Decided:** §7 points at `ui.md` §4.3 for the values and keeps a table of the contexts, because the audit's spec-wide decision asks this spec to stop restating the kit's contract, and the contexts (row rhythm, child indent, dock header, canvas gap) are Studio facts `ui.md` does not hold. The table gives no counts and no file inventory: §6.1 records that a list of what is in use is true only on the day it is written.
- **Decided:** no spacing rule in `check-styles.ts`, because its header excludes spacing on purpose and about 210 on-scale literals in surface documents alone would bury today's 16 font-size and radius nudges. §7 states the exclusion, so the spec and the gate say the same thing.
- **Decided:** §7 names the form row by section (§4.1), not by class or part, so the row vocabulary stays §4.1's alone. No ordering with `plan:studio-ui-guidelines/form-row-part-vocabulary` is needed: its §7 step ("apply the rename to whatever row it kept, or skip it when none names the row") skips when this lands first, and this text is right whichever lands first.
- **Decided:** the marker is deleted rather than rewritten as `Implemented`, because §7 carried no marker before the census and no §14 row binds it. `plan:studio-ui-guidelines/chrome-type-scale` deletes §2.2's for the same reason.

## Implementation

A paper plan: the whole change is the §7 rewrite quoted under **Specs & docs**, and its fragment.

1. `specs/studio-ui-guidelines.md` §7 (lines 401 to 416): keep the heading; replace the marker, the "No formal spacing scale" line and the table with the text under **Specs & docs**. The `---` rule after it stays.
2. `bun run spec:change studio-ui-guidelines.md minor -m "…"` with the sentence under **Specs & docs**.
3. In the landing pull request: delete this file. No plan requires it, but `plan:studio-ui-guidelines/form-row-part-vocabulary` cites it twice (its integration contract and its §7 step); if that plan is still open, reword both to cite §7 instead, or `plans:check` fails with `citation-unknown`.

**Integration contract.** Once this lands, §7 is the spacing policy: the kit's scale by pointer, a step as its token, a between-step value as a literal, 6px named. A plan that converts or restyles a surface may bring its literals onto the scale without a spec edit, and may cite §7 for doing so. `plan:studio-ui-guidelines/form-row-part-vocabulary` finds no `.style-row` in §7 to rename. `plan:studio-ui-guidelines/conventions-checklist` may cite §7 if §10 grows a spacing item. A plan that adds a spacing rule to `check-styles.ts` edits §7's "Spacing is not policed" sentence in the same pull request.

## Tests

None: no source file changes, and `specs/**` is in `scripts/ci/affected.ts`'s `NO_TESTS`, so the pull request reaches no test workspace and no coverage threshold or manifest check moves. The gates that prove it: `bun run docs:status` (the marker is gone and the header still `Partial`), `bun run docs:spec-release` (the body change carries a fragment), `bun run plans:check` (no claim left on `studio-ui-guidelines.md#7` once this file is deleted), `bun run docs:markdown`, `bun run docs:check` and `bun run docs:links`.

## Specs & docs

**`specs/studio-ui-guidelines.md` §7**, in place. Delete the Partial marker (line 403); the section carries no marker afterwards. Replace lines 405 to 416 with:

```markdown
Studio's spacing is the kit's space scale: `--jx-space-1` to `--jx-space-7`, 2, 4, 8, 12, 16, 24 and 32px (`ui.md` §4.3). Studio declares no spacing token of its own, and no density re-declares the scale, so every value below holds at every density.

**A step is written as its token.** A new gap, padding or margin that lands on a step spells it `var(--jx-space-3)`, not `8px`; an existing literal equal to a step draws the same value and is not an error. **A value between two steps stays a literal, and the scale does not grow to meet it.** 6px is the one such value Studio uses as rhythm: the gap between the items of an inline run and the block padding of a dock header. 10px pads a few cards and pills, and 1px, 3px and 5px correct for a border or centre a glyph inside a chip; each belongs to the element it corrects. Spacing is not policed: `packages/studio/scripts/check-styles.ts` nudges a font size or a radius toward its token and leaves gaps, padding and margins alone on purpose, because the scale is coarse and a dense editor draws structural pixels.

**A kit element's own spacing is the kit's.** A toolbar's gap, an action group's gap and an accordion item's body padding are drawn by the element (`ui.md` §5). A surface adds to them in its own `style` block and does not restate them.

| Context      | Step                                                  | Where                                                                                                      |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Form row     | `--jx-space-1` (2px)                                  | Between a row's label and its control, and above and below each row (§4.1)                                 |
| Row label    | `--jx-space-2` (4px)                                  | Between the provenance chip and the row's name (§4.1, §4.2)                                                |
| Child indent | `--jx-space-5` (16px)                                 | A nested row's inline start (§4.1)                                                                         |
| Section body | `--jx-space-2` (4px)                                  | Inside a section, which `jx-accordion-item` pads itself (§5.1)                                             |
| Strip        | `--jx-space-2` block, `--jx-space-3` inline (4px 8px) | A toolbar or filter bar above a panel's list                                                               |
| Panel body   | `--jx-space-2` or `--jx-space-3` (4px or 8px)         | A panel body that pads at all; a list whose rows pad themselves does not                                   |
| Dock header  | 6px block, `--jx-space-3` inline                      | The Navigator's and the Inspector's header rows                                                            |
| Inline run   | 6px                                                   | Between the items of a run: the shell toolbar, a section band's icon and title, a field and its Add button |
| Canvas       | `--jx-space-6` (24px)                                 | Between the canvas's artboards                                                                             |
```

If the Open decision goes to an alias, the second paragraph names the alias and the Dock header and Inline run rows give it; if it goes to the scale, the "6px is the one such value" sentence is deleted and both rows give the step chosen.

**Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§7 states Studio's spacing as the kit's space scale: a step is written as its token, a value between steps stays a literal and is not policed, 6px is named as the one off-scale step drawn as rhythm, and the table gives the step each recurring context draws."` Minor, per the release table for a `reconcile`: no value an author relies on changes.

**Docs.** No page's `spec:` cites `studio-ui-guidelines.md#7`, and this plan changes no file any page lists in `code:`, so `bun run docs:sync` names none and no docs page changes. `packages/studio/STYLING.md` already says what §7 will say and does not change under the recommendation.

**Graduation:** no. studio-ui-guidelines.md keeps open items owned by other plans (§1.1, §2.1, §2.2, §4.1 and more).

## Acceptance

- `bun run docs:status` shows no marker on studio-ui-guidelines.md §7; `bun run plans:status --spec studio-ui-guidelines` no longer lists §7; `bun run plans:check` is green with this file deleted.
- `git grep -n "No formal spacing scale" specs/` finds nothing, and `git grep -n "style-row" specs/studio-ui-guidelines.md` finds no hit inside §7.
- Each row holds against the tree: `grep -n '"paddingLeft": "var(--jx-space-5)"' packages/studio/src/surfaces/style-panel.json`, `grep -n '"padding": "6px var(--jx-space-3)"' packages/studio/src/surfaces/navigator-dock.json packages/studio/src/surfaces/inspector-dock.json`, `grep -n '"gap": "6px"' packages/studio/styles/shell-frame.json packages/studio/src/surfaces/panel-page.json`, `grep -n '"gap": "24px"' packages/studio/src/surfaces/canvas-stage.json`, and `grep -n '"padding": "var(--jx-space-2)"' packages/ui/components/jx-accordion-item.json` each find the rule.
- `bun run lint:styles` (from `packages/studio`) prints the same nudge count as before: nothing about spacing is policed.
- `bun run docs:spec-release` finds the fragment; `bun run docs:markdown`, `bun run docs:check` and `bun run docs:links` are green.
