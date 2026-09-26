---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#8.1
size: S
---

# Selection states the highlights the canvas draws

## Context

`specs/studio-ui-guidelines.md` §8.1, line 424:

> **Status: Partial.** Selection as a list, the anchor and the primary, Shift-range and Ctrl/Cmd toggle, and one transaction per batch ship (`packages/studio/src/tabs/selection.ts`, `src/canvas/iframe-host.ts`). The highlight bullets do not match what the canvas draws: the overlay boxes are borders rather than outlines (`packages/studio/styles/canvas.css`, `src/canvas/iframe-overlay.ts`), the hover box is a 1px solid `--accent-50` border rather than a dashed one, and the dashed boxes are a multi-selection's co-selected members, which the bullets do not mention.

The census first filed these bullets as editorial drift. They are statements of what the canvas draws, which is the class of divergence that gave §5.2 a marker, so they are an open item under the rule the audit record now states.

Disposition `reconcile`: the overlay is a deliberate design. Borders on positioned overlay boxes are how the canvas draws any highlight without touching the author's element, and the dashed style marks a multi-selection's other members, a distinction the bullets predate.

**What exists**

- `packages/studio/styles/canvas.css`: `.overlay-selection { border: 2px solid var(--accent) }`, `.overlay-hover { border: 1px solid var(--accent-50) }`, and `.overlay-coselection` at 1px dashed for the members of a multi-selection that are not the primary.
- `packages/studio/src/canvas/iframe-overlay.ts`, which positions the boxes.

**What is missing**

- The two highlight bullets rewritten: the primary selection is a 2px solid accent border on an overlay box, hover a 1px solid border at `--accent-50`, and each co-selected member a 1px dashed border.

**Related**

- `studio-ui-guidelines.md` §1.1 (`--accent-50` and its `oklab` mix).
- `studio.md` §6.7 (provenance, and multiple selection), which `canvas.css` cites for the co-selection boxes.
