---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#4.1
  - studio-ui-guidelines.md#4.2
size: S
workspaces:
  - packages/studio
---

# The form row and its provenance chip are specified in the part vocabulary the surfaces emit

## Context

`specs/studio-ui-guidelines.md` §4.1, line 156:

> **Status: Partial.** The row geometry ships, but surfaces key it on `part="row"` and `part="row-label"`, with `data-child="true"` for a nested row (`packages/studio/src/surfaces/style-panel.json`, `properties-panel.json`, `panel-page.json`). Nothing emits `style-row` or `style-row-label`, and the `.style-row` rules left in `styles/inspector.css` have no emitter.

§4.2, line 207:

> **Status: Partial.** The chip's behaviour ships (`packages/studio/src/panels/provenance.ts`: set, inherited naming its donor, bound, mixed, and the section tally from `countProvenance`). Its markup does not match: the chip is `[part="chip"][data-state]` in a `[part="chip-slot"]` and the heading indicator is `[part="dots"] > [part="dot"]`; no surface emits `part="set-dot"`, and the `.set-dot` rules in `styles/inspector.css` are dead.

One stub for both because they are one piece of work: §4.2's example is a child of §4.1's `style-row-label`, and the dead rules both sections reproduce sit in one block of `styles/inspector.css` (`.style-row`, `.set-dot`, `.provenance-dots .set-dot`, `.set-dot.provenance-chip--*`).

Disposition `reconcile`: the part vocabulary is the rule (§9.4's document conventions, `ui.md` §3.1: a document styles through `part`, not a class), and §10's checklist already records that `.style-row` went with `ui/field-row.ts` and the chip is each document's `[part="chip"]`.

**What exists**

- Row markup: `part="row"` / `part="row-label"` in `packages/studio/src/surfaces/style-panel.json`, `properties-panel.json`, `panel-page.json`, `doc-header.json` and more; `data-child="true"` for a nested row; `schema-form` rows take their label from `jx-field`.
- Geometry as specified: column, stretch, 2px gap, `2px 0` padding, label at `--jx-text-xs` in `--fg-dim`, a 16px child indent (`--jx-space-5`), `size="sm"` on kit inputs.
- Chip: `[part="chip-slot"] > [part="chip"][data-state=…]`, a button when it acts; heading `[part="dots"] > [part="dot"]` at 7px (`style-panel.json`); words from `panels/provenance.ts` (`countProvenance`, `provenanceSummaryText`), tested in `tests/provenance.test.ts`.
- Dead rules: `packages/studio/styles/inspector.css`, from the `.set-dot.provenance-chip--inherited` rule through `.style-section-body--grid .style-row`.

**What is missing**

- §4.1's JSON example, CSS block and "Rules" rewritten to `row` / `row-label` / `data-child`, and §4.2's example and CSS to `chip-slot` / `chip` / `data-state` and `dots` / `dot`.
- The dead `inspector.css` rules deleted in the same pull request, so the spec's old names have no survivor to point at.
- §4.6's "`.style-row` (§4.1) is `flex-direction: column`" and §7's `.style-row` usage note renamed with it (both sections are otherwise built or owned elsewhere).

**Related**

- `studio.md` §6.7 (provenance and multiple selection), the chip's normative home.
- `studio-ui-guidelines.md` §4.6, §7 and §10, which name the old classes.
