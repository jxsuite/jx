---
status: stub
disposition: implement
claims:
  - extensions.md#9
size: S
workspaces:
  - packages/schema
  - packages/compiler
  - extensions/connector
---

# A section's referenceable flag decides whether relationship pointers may target it

## Context

`specs/extensions.md` §9, line 424:

> **Status: Partial.** Section ownership, key exclusivity, `projectData` into `_project[<key>]`, discriminator dispatch and the fragment-read entry shape ship (`packages/schema/src/extension-registry.ts`, `packages/compiler/src/site/project-sections.ts`). `referenceable` is validated and declared by `Content` and `Data` but read by no host: `parseRefPointer` (`extensions/connector/src/columns.ts`) accepts a pointer into any section, and the studio's reference control hard-codes `#/content/<type>` (`packages/studio/src/ui/schema-form.ts`).

The section was unmarked before the census. The table says `referenceable` "opts the section's named entries into the relationships vocabulary"; in the code the opt-in changes nothing, because every reader either accepts any section or knows only `content`.

**What exists**

- The flag: typed on `ProjectBlock` (`packages/schema/src/format-registry.ts`) and the protocol's section info (`packages/protocol/src/types.ts`), schema-validated (`packages/schema/defs/class-def.schema.ts`), and declared `true` on `extensions/parser/src/Content.class.json` and `extensions/connector/src/Data.class.json`, asserted in `extensions/parser/tests/content-loader.test.ts` and `extensions/connector/tests/extension-manifest.test.ts`. No source reads it.
- Pointer readers, none of which consults the flag:
  - `parseRefPointer` (`extensions/connector/src/columns.ts`), any `#/<section>/<name>`.
  - `CONTENT_REF_PREFIX` (`extensions/parser/src/content-loader.ts`), `content` only.
  - `referenceTarget` (`packages/studio/src/ui/schema-form.ts`), `content` only, shared by the form engine, the reference control in `packages/studio/src/ui/form-controls.ts` and the frontmatter renderer (`packages/studio/src/panels/frontmatter-fields.ts`).
  - The grid's relationship cell does not share `referenceTarget`: `kindForProp` (`packages/studio/src/grid/schema-columns.ts`) classifies any bare `$ref` column as `reference`, and `openCellValuePopover` then reads the target through its own `referenceTargetType` (`packages/studio/src/grid/cell-popovers.ts`, which imports nothing from `ui/schema-form`), also `#/content/` only; `packages/studio/tests/grid-cell-popovers.test.ts` asserts it returns `null` for `#/data/users`.
- `RelationshipRef` in the core fragment (`packages/schema/schemas/project.core.schema.json`), whose `$ref` pattern `^#/[A-Za-z][A-Za-z0-9_-]*/[A-Za-z0-9._-]+$` accepts any `#/<sectionKey>/<name>` string.
- The flag already reaches the studio: the extensions payload carries each contribution's whole `project` block (`contributions[].project`, built in `packages/compiler/src/site/format-host.ts` and typed as `ExtensionProjectBlock` with `referenceable?` in `packages/protocol/src/types.ts`).

**What is missing**

- A registry view of the referenceable contributions (for example `referenceableSections()` beside `projectContributions()` in `packages/schema/src/extension-registry.ts`): the one place a host, the studio's picker included, asks which sections a pointer may target.
- Validation that refuses a pointer into a section whose owner is not referenceable, with a message naming the section: narrowing `RelationshipRef` in the composed entry document to the referenceable section keys (`packages/schema/src/project-schemas.ts`), `parseRefPointer` in the connector, or `jx validate`; the detail phase picks the layer.
- The studio side of the boundary: this plan owns the registry view and the extensions payload that carries it to the studio (`contributions[].project` already carries each flag, so the payload changes only if the detail phase puts the view itself on the wire). The Studio reference controls that read the referenceable view (the target pickers, `referenceTarget` and the grid's `referenceTargetType`) are owned by `plan:relationships/studio-reference-picker` (relationships.md §5), which names this plan as its prerequisite.

**Related**

- relationships.md §1: its scoping sentence (the pointer form "over any section whose owning class declares `project.referenceable: true`", `specs/relationships.md` line 18) is unenforced today, since `RelationshipRef`'s pattern and `parseRefPointer` accept any section key, and becomes true when this plan lands. The relationships audit records it as a qualification under Verified rather than marking a second open item, so this plan is the gap's only owner.
- relationships.md §5 (the studio picker, `plan:relationships/studio-reference-picker`).
- extensions.md §3.1 (section keys), extensions.md §9.1 (the settings forms that host the picker).
