---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#2.2
size: S
workspaces:
  - packages/studio
---

# Field labels, breadcrumbs and accordion headers draw at the 11px the type scale gives them

## Context

`specs/studio-ui-guidelines.md` §2.2, line 92:

> **Status: Partial.** The scale is the kit's `--jx-text-xs`/`sm`/`md`/`lg` (10/11/12/14px, `ui.md` §4), and the 12px base, the 10px row labels and the 1.5 line height hold. `jx-field` labels and `jx-accordion-item` headers draw at `--jx-text-md` (12px), not the 11px this table assigns, because Studio stamps no `data-density="compact"`; the breadcrumbs draw at 10px, because the jump bar sets `--jx-text-xs` on its root and every crumb inherits it (`packages/studio/src/surfaces/jump-bar.json`); and no 1.7 content-mode line height exists.

Disposition `implement`, provisionally. The evidence leans toward the table's intent: two sections (§2.2 and §5.2) put form labels and accordion headers at 11px, `panel-signals.json` re-declares `--jx-text-md` to reach it, and the kit already has the lever, a `data-density="compact"` scope that sets `--jx-text-md` to 11px. The alternative is `reconcile` (the table moves to 12px), and detailing chooses between them. Compact re-declares only the body type (`--jx-text-md` 11px, `--jx-leading-md` 16px; the control height stays at its 24px floor, `ui.md` §4.3), but it reaches every control that draws `md` text, so it is a chrome-wide change the screenshot lane will re-capture rather than a label tweak.

**What exists**

- `packages/ui/project.json`: `--jx-text-xs` 10px, `sm` 11px, `md` 12px, `lg` 14px, and the `[data-density="compact"]` block.
- `packages/ui/components/jx-field.json` and `jx-accordion-item.json` draw their label and header at `--jx-text-md`.
- `packages/studio/src/surfaces/jump-bar.json`: the bar's root sets `fontSize: var(--jx-text-xs)` (10px) and `[part="crumb"]` inherits it, so the breadcrumbs sit a step below the table's 11px row. Compact density does not reach them, because it re-declares `--jx-text-md` and not `--jx-text-xs`.
- `packages/studio/src/surfaces/panel-signals.json` sets `--jx-text-md: var(--jx-text-sm)` on its categories; `src/ui/virtual-window.ts` notes that Studio writes no `data-density`.

**What is missing**

- A decision between compact density on the chrome (labels and headers at 11px everywhere, `panel-signals.json`'s override deleted) and a table rewritten to 12px.
- A separate answer for the breadcrumbs, which neither option moves: the jump bar's root goes to `--jx-text-sm` (11px), or the table's 11px row stops naming breadcrumbs and the 10px row gains them.
- Either way, the "Line height: 1.7 (content mode)" line deleted, since no content mode exists, and the `.style-row-label` example in the 10px row renamed with the row vocabulary.

**Related**

- `ui.md` §4.3 (the scales, and what compact density re-declares).
- `studio-ui-guidelines.md` §5.2 (accordion header size), owned by `plan:studio-ui-guidelines/accordion-styling-facts`; §4.1's label vocabulary, owned by `plan:studio-ui-guidelines/form-row-part-vocabulary`.
