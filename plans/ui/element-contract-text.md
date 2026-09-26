---
status: stub
disposition: reconcile
claims:
  - ui.md#3.2
size: S
---

# §3.2 states the element contract the kit actually holds

## Context

`specs/ui.md` §3.2, line 63:

> **Status: Partial.** Most clauses ship and are gated by `packages/ui/tests/conformance.test.ts` (typed, documented `state`; `part` on every internal node; a base `display`, with the `base-display` lint in `@jxsuite/schema/overlays`; no raw colour). Three differ from the code: no control observes an `aria-*` attribute, since controls observe `label`, `labelledby` and `describedby` and forward those (the §5 entries document that form); most custom events are dispatched with `bubbles` alone, not `composed` (`src/behaviors/dialog.ts`, `tabs.ts`, `tree.ts`, `toast.ts`, `swatch-group.ts`; only `split.ts` and `jx-option` set both); and the slot list names `prefix` and `suffix`, which no element has, while omitting `actions`, `status`, `heading`, `help`, `action` and `tokens`, which elements use. A fourth disagrees with the spec rather than the code: the ARIA-forwarding clause says forwarding names a control "until form association exists", as though form association were pending, where §11's WHATWG HTML row records it as a decision rather than a gap.

Disposition `reconcile`. For the naming and slot clauses the code is uniform and every §5 entry documents it, so the text is what is stale. The form-association clause is the spec disagreeing with itself. The events clause could go the other way, and the detail phase must decide it (see below).

**What exists**

- Forwarded names: 29 component documents declare a `label` state entry, 12 declare `labelledby` and 8 declare `describedby`. `jx-color-field`, `jx-color-slider`, `jx-listbox` and `jx-tab-panel` take `labelledby` without `describedby`. No component document declares an attribute starting `aria-`. §11's Accessible Name row describes the unprefixed form.
- Custom-event dispatch:
  - Sidecars dispatch with `bubbles: true` only: `packages/ui/src/behaviors/dialog.ts:31`, `tabs.ts:236`, `tree.ts:430`, `toast.ts:156` and `swatch-group.ts:241`.
  - Only `split.ts:165` and `packages/ui/components/jx-option.json` also set `composed`.
  - The declarative dispatches in the component documents carry `bubbles` 20 times and `composed` once.
- Slot names in use: `icon`, `value`, `description`, `submenu`, `end`, `actions`, `status`, `heading`, `help`, `action`, `tokens`.

**What is missing**

- The ARIA-forwarding clause rewritten to the props the code and §5 use: `label` becomes `aria-label`, and `labelledby` and `describedby` are forwarded.
- The slot list made the set of names elements actually declare, or turned into a pointer to each §5 entry.
- The events clause decided. Inside a light-DOM kit with no `$shadow`, `composed` changes nothing. It matters only to a consumer that places a kit element inside a shadow root of its own. If the detail phase keeps `composed: true` as the contract, the dispatch sites gain it and this plan becomes `implement`.
- The form-association wording ("which is what names it until form association exists") squared with §11's WHATWG HTML row, which says §3.2 records form association as a decision rather than a gap. The §5.1 and §5.3 markers lean on the same sentence.

**Related**

- ui.md §5 (every catalogue entry's props and slots), ui.md §11 (the Accessible Name and WHATWG HTML rows).
- spec.md §16.6 (light-DOM slot distribution).
