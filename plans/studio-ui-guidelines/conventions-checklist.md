---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#10
requires:
  - _shared/studio-state-contract
  - studio-ui-guidelines/debounce-draft-layer
  - studio-ui-guidelines/name-and-chord-gaps
  - studio-ui-guidelines/git-panel-action-list
  - studio-ui-guidelines/empty-state-copy
size: S
---

# The conventions checklist holds item for item, once each section it summarises does

## Context

`specs/studio-ui-guidelines.md` §10, line 669:

> **Status: Partial.** Most items hold, many behind a gate (`check-surface-purity.ts`, `check-styles.ts`, `check-lit-conventions.ts`). Five inherit a section's open item. "State mutations are immutable (produce new objects)" inherits §9.1's divergence: `transactDoc` and the `mutate*` helpers mutate in place and replace only the root reference. "Text inputs are debounced (400ms standard)" inherits §4.4's. The two command-rendering items, a surface's actions arriving as a projection that prints title, chord and `requires`, and a control rendered from its command record rather than a hand-maintained list, inherit §12.3's and §12.5's: the rail prints no chord, the tab-strip and Files-tree menus carry none, and the Source Control panel draws from its own `ACTIONS`. The empty-region item inherits §11's: some empty regions still print a noun phrase.

§10 is a summary: every item restates a rule a numbered section owns, so it can only be true when those sections are. Five items inherit an open item from elsewhere, and the plans that close those sections are the prerequisites. This stub owns §10 so that none of them can flip it alone: a plan that fixed one item would otherwise remove the marker while the other four were still false.

Disposition `reconcile`: the checklist's own edits are wording. Two items are rewritten to say what the reconciled sections will say, and the other three become true when the code lands under their owning plans, at which point this plan re-reads them and removes the marker.

**What exists**

- The checklist, twenty-five items, many behind a gate: `packages/studio/scripts/check-surface-purity.ts`, `check-styles.ts` and `check-lit-conventions.ts`.
- "State mutations are immutable (produce new objects)": contradicted by `transactDoc` in `packages/studio/src/tabs/transact.ts` and the `mutate*` helpers, which mutate in place and replace the root reference. §9.1 and §9.2 are reconciled by `plan:_shared/studio-state-contract`.
- "Text inputs are debounced (400ms standard)": contradicted by the provisional preview at `LIVE_PREVIEW` (350ms) in `src/ui/field-input.ts`, `src/panels/head-panel.ts` and `frontmatter-panel.ts`, and by the local 300ms `EDIT_DEBOUNCE_MS` in `src/panels/seo-modal.ts` and `src/surfaces/settings-head.ts`. §4.4 is owned by `plan:studio-ui-guidelines/debounce-draft-layer`.
- "A surface's actions arrive as a projection of command records … and the document prints title, chord and `requires` exactly as given" and "A control that invokes an action renders it from its command record (§12)": contradicted by `src/surfaces/rail.ts` (title only, no chord), the `context/tab` and `context/file` rows in `src/panels/tab-strip.ts` and `src/files/files.ts` (no chord), the Bottom dock's close button (`src/surfaces/bottom-dock.json`), and `ACTIONS` in `src/panels/git-panel.ts`. §12.3 and §12.5 are owned by `plan:studio-ui-guidelines/name-and-chord-gaps` and `plan:studio-ui-guidelines/git-panel-action-list`.
- "An empty region says its piece through `EmptyStateSpec` (§11) … never a noun phrase": contradicted by "No project loaded" in `src/surfaces/files-panel.json`'s `[part="empty"]` block. §11 is owned by `plan:studio-ui-guidelines/empty-state-copy`.

**What is missing**

- The immutability item reworded to the transaction rule §9.1 will state (a document is written only inside a transaction, which records the inverse and replaces the root reference).
- The debounce item reworded to the intents §4.4 will name, with their constants from `src/ui/timing.ts`.
- The command-rendering and empty-region items re-read against the code once their plans land, and the marker removed when all five hold.
- A last pass over the items no gate checks ("Inputs use `size="sm"`", "A control carries ONE accessible name", "A control that cannot act renders disabled with the reason in its tooltip"), since the census verified the gated items and these five, not every row.

**Related**

- `studio-ui-guidelines.md` §4.4, §9.1, §11, §12.3, §12.5: the sections the five items summarise.
