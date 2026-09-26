---
status: stub
disposition: implement
claims:
  - studio.md#6.5
size: M
workspaces:
  - packages/studio
---

# A component's observed attributes, custom properties and parts are declared from the Inspector

## Context

`specs/studio.md` §6.5, line 667 (before the census the section had no marker, and its table said Observed attributes was Implemented and the two CSS rows Pending):

> **Status: Partial.** The Parameters and Emits editors ship in the Data panel (`packages/studio/src/panels/signals-panel.ts`). Nothing in `packages/studio/src` reads or writes the root `observedAttributes` array the runtime observes, and CSS custom properties and CSS parts are listed read-only in the Logic tab (`panels/events-panel.ts`) with no form to declare either.

The census corrected three cells (lines 675 to 677): Observed attributes to `**Pending**`, CSS custom properties and CSS parts to `**Partial**`, each resting on the read-only list in the Logic tab (the generator that would export them is uncalled). This plan also owns the two rows of the retired §12 ledger ("CSS custom properties panel", "CSS parts panel"), which described the same read-only lists.

**What exists**

- Parameters and Emits editors in `packages/studio/src/panels/signals-panel.ts` and `panels/events-panel.ts`.
- The Logic tab's contract sections (`packages/studio/src/panels/events-panel.ts`, `src/surfaces/logic-panel.json`): Observed Attributes lists state entries carrying `attribute`; CSS Properties lists the root style's `--*` keys; CSS Parts lists `collectCssParts(doc)`. All three are read-only.
- The Data panel edits per-entry `attribute` and `reflects`, CEM fields the runtime does not observe.
- The runtime reads only the root `observedAttributes` (`packages/runtime/src/runtime.ts`, `static get observedAttributes()` in `defineElement`).
- `exportCemManifest` in `packages/studio/src/services/cem-export.ts` would include `cssProperties` and `cssParts`, but nothing calls it: `packages/studio/src/studio.ts` imports it as the unused `_exportCemManifest`. Wiring the export is `spec.md` §16.8's gap, not this plan's.

**What is missing**

- An editor for the root `observedAttributes` array, and a decision on its relation to per-entry `attribute`: whether declaring `attribute` on an entry should add it to `observedAttributes`, so the Observed Attributes list names what the element actually observes.
- A declaration form for a custom-property interface (name, description, syntax, default), written where CEM export reads it.
- A decision on CSS parts: spec.md §16.6 renders definitions into the light DOM, where `::part` does not apply, while `$shadow` opts a component into a shadow root, where it does. Either the form is offered only to a `$shadow` component, or the row is removed.

**Related**

- spec.md §16.5 (observed attributes), spec.md §16.6 (light DOM and `$shadow`), spec.md §16.8 (CEM annotations and the manifest export, which reads these declarations).
- `plan:spec/cem-manifest-export` consumes this plan's `observedAttributes`↔`attribute` decision: it maps `observedAttributes` into CEM `attributes` beside typed entries carrying `attribute`, and lists "Studio's CEM editors" as existing, which holds for Parameters and Emits only. The detail phase draws the edge between the two.
