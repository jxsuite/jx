---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#5.3
size: S
---

# Section open state is specified as the explicit setter the kit's toggle feeds

## Context

`specs/studio-ui-guidelines.md` §5.3, line 345:

> **Status: Partial.** Neither pattern ships as written. Every section is driven by an explicit setter fed from the kit's toggle detail, `(key, open)`: `toggleSection` in `packages/studio/src/panels/style-panel.ts`, `setSectionOpen` in `panels/elements-panel.ts` (over `view.elementsCollapsed`), `toggleCategory` in `panels/signals-panel.ts`, and `setInspectorSection` behind `inspector.setSection`, which retired the flip-style toggle. The Inspector's state lives per tab in two maps, `session.ui.styleSections` for the Style tab and `session.ui.inspectorSections` for the Properties tab (`src/panels/properties-panel.ts`), not in the document.

Disposition `reconcile`: the setter shape is a recorded correction, not drift. `properties-panel.ts` says `inspector.setSection` retires `inspector.toggleSection` because a delta toggle was nondeterministic, which is the same reason the shot contract refuses `toggle*` command ids (`scripts/screenshots/README.md`, rule 1). The section's two patterns both flip state, so they describe exactly what was removed.

**What exists**

- `packages/studio/src/panels/style-panel.ts`: `toggleSection: (key, open)`; state in `tab.session.ui.styleSections`, auto-opened by `autoOpenSections`.
- `packages/studio/src/panels/elements-panel.ts` and `src/surfaces/panel-elements.ts`: `setSectionOpen(name, open)` over `view.elementsCollapsed` (`src/view.ts`), shared across panes.
- `packages/studio/src/panels/signals-panel.ts`: `toggleCategory: (key, open)`.
- `packages/studio/src/panels/properties-panel.ts`: `setInspectorSection(section, open)` and the `inspector.setSection` command; state in `tab.session.ui.inspectorSections`, a second per-tab map beside the Style tab's `styleSections`.

**What is missing**

- §5.3 rewritten to one pattern: the document hands the kit's `toggle` detail to a host setter taking `(key, open)`; where the state lives is per tab for the Inspector (`session.ui.styleSections` and `session.ui.inspectorSections`, one map per tab of the dock) and per shell view for the Navigator, never the document and never a module-local Set.
- The JavaScript examples replaced by the document binding they now are.

**Related**

- `ui.md` §5.4 (`jx-accordion-item` re-announces `toggle`).
- `studio.md` §3.3 (state model: session versus document).
