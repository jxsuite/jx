---
status: stub
disposition: reconcile
claims:
  - studio.md#6.2
size: S
---

# The Style Sidebar says its sections are the ones the CSS metadata declares

## Context

`specs/studio.md` §6.2, line 515 (the section was unmarked before the census, and the first audit pass listed it as verified):

> **Status: Partial.** The Target Line and its element-aware selector axis, `:popover-open` shown on the canvas, the axis and test-data commands, breakpoint sizing and the Edit column's width drag, the resolving-with popover, the input types, the colour picker and the font-family combobox ship (`packages/studio/src/surfaces/target-line.ts`, `canvas/edit-width-drag.ts`, `panels/style-panel.ts`, `ui/color-selector.ts`). The Sections table is stale: the panel draws the sections `packages/studio/data/css-meta.json` declares in `$sections`, which include a Size section the table omits (width, height, their minimums and maximums, `aspectRatio`, `objectFit`, `overflow`, `boxSizing`) and file `opacity` under Background and `overflow` under Size, where the table puts both under Effects.

Disposition `reconcile`. The section already says the sidebar is "metadata-driven" and loaded from `css-meta.json`; the table is a hand copy of that data that has drifted from it, the same drift `plan:studio/insert-palette-categories` corrects for §5.3's categories.

**What exists**

- `packages/studio/data/css-meta.json`: `$sections` is Layout, Size (`$layout: "grid"`), Spacing, Positioning, Typography, Background, Border, Effects, Other; each `$defs` entry carries its `$section` and `$order`.
- `propertySections` in `packages/studio/src/panels/style-panel.ts`: iterates `cssMeta.$sections`, groups every non-shorthand `$defs` entry by `$section`, and sorts by `$order`.

**What is missing**

- The Sections table rewritten from `css-meta.json`, or replaced by a sentence saying the sections and their members are data (`$sections` and each property's `$section`), with the file named as the one list. The second keeps the spec from drifting again and matches how §5.3's plan treats categories.
- Editorial ride-along, since this change edits §6: §6.1's widget table names `renderMediaPicker()` and "the style panel `renderColorSelector`", neither of which exists. The property panel mounts `mountMediaPicker` from `packages/studio/src/ui/media-picker.ts` for `format: "image"` and gives a `format: "color"` prop a `color` row kind (`packages/studio/src/panels/properties-panel.ts`).

**Related**

- studio.md §6.1 (the property panel), studio.md §5.3 (the Elements panel's data-derived categories), ui.md §5.6 (the colour field).
