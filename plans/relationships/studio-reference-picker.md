---
status: stub
disposition: implement
claims:
  - relationships.md#5
size: M
workspaces:
  - packages/studio
---

# Studio authors to-one and to-many references into any referenceable section, and picks their values from that section's entries

## Context

`specs/relationships.md` §5, line 76:

> **Status: Partial.** `reference` is one of `FIELD_TYPES` (`packages/studio/src/settings/schema-field-ui.ts`), and a to-one `#/content/<type>` field gets an entry picker in the schema form (`referenceTarget` in `packages/studio/src/ui/schema-form.ts`) and in the grid (`kindForProp` in `packages/studio/src/grid/schema-columns.ts`, `referenceTargetType` in `packages/studio/src/grid/cell-popovers.ts`), both fed by `listCollectionEntryIds` rather than a `#/$context/<sectionKey>` enumeration. Not built: the target pickers (`targetsFor` in `packages/studio/src/ui/form-controls.ts`, and `packages/studio/src/settings/defs-editor.ts`) list content types only, ungrouped, and always write `#/content/<name>`; there is no single/multiple toggle, so an array-of-refs field reads as a plain `array`; and no value editor handles a to-many field or a data-table target.

The section was unmarked before the census. Disposition `implement`: every bullet describes an authoring capability Studio lacks, and the code's content-only shape is where it stopped, not a different design.

**Ownership against extensions.md §9.** Settled, with no overlap. `plan:extensions/referenceable-sections` (claims extensions.md#9) covers only the registry view of the referenceable sections and the validation that refuses a pointer into a non-referenceable section. It changes no payload, because the flag already reaches Studio: `buildExtensionsPayload` (`packages/compiler/src/site/format-host.ts`) puts each contribution's whole `project` block on the wire as `contributions[].project`, typed `ExtensionProjectBlock` with `referenceable?` (`packages/protocol/src/types.ts`), and Studio caches it through `loadExtensions` / `getExtensions` (`packages/studio/src/format/format-host.ts`), where no reader looks at `referenceable` yet. This plan owns every Studio control change, including the target pickers reading that flag instead of the `#/content/` pattern, and lists `plan:extensions/referenceable-sections` in `requires` at detail, so the picker's section list and the validation agree on which sections a pointer may target.

**What exists**

- `FIELD_TYPES`, `detectFieldType` (any `$ref` is `reference`) and `schemaForType` (`reference` writes `{ "$ref": "#/content/" }`) in `packages/studio/src/settings/schema-field-ui.ts`.
- Target pickers, both content-only: `targetsFor` and the field-builder control in `packages/studio/src/ui/form-controls.ts`, reading `#/$context/content` keys and writing `#/content/<name>`; and the defs editor, `packages/studio/src/settings/defs-editor.ts` (the same list read off the live config, the same pointer written) drawn by `packages/studio/src/surfaces/settings-defs.ts`, whose `refTarget` is the content type without its `#/content/` prefix.
- Three separate `$ref` readers on the value side:
  - `referenceTarget` and `CONTENT_REF` in `packages/studio/src/ui/schema-form.ts`, the relationship test for the form engine, `packages/studio/src/ui/form-controls.ts`'s reference control, and the frontmatter renderer (`packages/studio/src/panels/frontmatter-fields.ts`). Covered by `packages/studio/tests/reference-control.test.ts`.
  - `kindForProp` in `packages/studio/src/grid/schema-columns.ts`, which gives any bare `$ref` the grid kind `reference`.
  - `referenceTargetType` in `packages/studio/src/grid/cell-popovers.ts`, the grid's own `#/content/` prefix reader, called by `openCellValuePopover` instead of `referenceTarget`; `packages/studio/tests/grid-cell-popovers.test.ts` asserts it returns `null` for `#/data/users`.
  - Both entry pickers, the form's and the grid cell's, populate from `listCollectionEntryIds` (`packages/studio/src/grid/sources/content-source.ts`).
- Connector rows reach Studio through `packages/studio/src/services/data-service.ts` (`fetchRows`), used by `packages/studio/src/grid/sources/connector-source.ts`.

**What is missing**

- Target picker: every referenceable contribution's entries, grouped by the owning extension's section label, writing `#/<sectionKey>/<name>`, in both `targetsFor` (`ui/form-controls.ts`) and the defs editor (`settings/defs-editor.ts`, `surfaces/settings-defs.ts`). Nothing in Studio reads `referenceable` today, though `getExtensions()` already carries it on every contribution; which sections count as referenceable is defined once by the registry view `plan:extensions/referenceable-sections` adds, and the picker must agree with it.
- Cardinality toggle: `detectFieldType` and `kindForProp` recognising `{ "type": "array", "items": { "$ref" } }` as a to-many reference, and the toggle wrapping or unwrapping the `items` form without losing the target.
- Value editors: `referenceTarget` (`ui/schema-form.ts`) and `referenceTargetType` (`grid/cell-popovers.ts`) generalised past `#/content/` and past a bare `$ref`, or folded into one reader so the form and the grid cannot drift again; a multi-select for to-many in the schema form and the grid cell; and data-table targets populated from their rows (paged, since a table is not a small file list). The decision is whether the spec's `#/$context/<sectionKey>` enumeration is the route, or whether per-domain sources (`listCollectionEntryIds`, `fetchRows`) stay and the spec's wording follows them.

**Related**

- extensions.md §9 (the `referenceable` flag, read by no host today), extensions.md §9.1 (the settings forms that host the field builder).
- site-architecture.md §7.4 (the content entry editor's entry picker row).
- relationships.md §1 (the pointer and cardinality forms the picker writes).
