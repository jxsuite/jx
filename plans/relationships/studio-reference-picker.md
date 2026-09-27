---
status: drafted
disposition: implement
claims:
  - relationships.md#5
requires:
  - extensions/referenceable-sections
workspaces:
  - packages/studio
  - packages/server
  - packages/protocol
  - specs
  - docs
size: L
---

# Studio authors to-one and to-many references into any referenceable section, and every surface that edits a reference value picks it from the target's entries

## Context

`specs/relationships.md` §5, line 76:

> **Status: Partial.** `reference` is one of `FIELD_TYPES` (`packages/studio/src/settings/schema-field-ui.ts`), and a to-one `#/content/<type>` field gets an entry picker in the schema form (`referenceTarget` in `packages/studio/src/ui/schema-form.ts`) and in the grid (`kindForProp` in `packages/studio/src/grid/schema-columns.ts`, `referenceTargetType` in `packages/studio/src/grid/cell-popovers.ts`), both fed by `listCollectionEntryIds` rather than a `#/$context/<sectionKey>` enumeration. Not built: the target pickers (`targetsFor` in `packages/studio/src/ui/form-controls.ts`, and `packages/studio/src/settings/defs-editor.ts`) list content types only, ungrouped, and always write `#/content/<name>`; there is no single/multiple toggle, so an array-of-refs field reads as a plain `array`; and no value editor handles a to-many field or a data-table target.

Verified against the tree; the marker is accurate, and these are the facts the design turns on.

**Authoring (the schema editors).**

- Two builders draw the field card: the `schema-builder` form control (`mountSchemaBuilder` in `ui/form-controls.ts`, markup `surfaces/schema-builder.json`), hosted by both the Content Types and the Data Tables settings sections, and Data Shapes (`settings/defs-editor.ts`, markup `surfaces/settings-defs.json`). Each keeps its own target list (`targetsFor` through `#/$context/content`; `contentTypeNames` off `projectState.projectConfig.content`), draws `refTarget` as the pointer minus its `#/<section>/` prefix, and writes `{ $ref: "#/content/<value>" }` in `setTarget`.
- `detectFieldType` returns `reference` for any bare `$ref` and `array` for `{ type: "array", items: { $ref } }`. `schemaForType("reference")` writes `{ "$ref": "#/content/" }`, which names no entry and fails `RelationshipRef`'s pattern. Nested (object child) cards offer `reference` in their type picker but draw no target picker, so a nested reference can only ever hold that placeholder; neither `resolveContentTypeRefs` (`extensions/parser/src/content-loader.ts`) nor `planTable` (`extensions/connector/src/columns.ts`) reads a reference below a schema's top level.
- Nothing tells a builder which section it is editing: `buildContext` in `settings/contributed-section.ts` sets only `fieldKeyPrefix: "$settings.<key>"`, so a content type's schema is offered the same targets as a table's, although relationships.md §2 disallows content → table.
- Nothing in Studio reads `referenceable`. `getExtensions()` (`format/format-host.ts`) already carries each contribution's `project` block with the flag, and `deriveSettingsSection` (`settings/extension-sections.ts`) already derives each section's label (`$studio.settings.label`, else `project.title`, else the key) and order.

**Values.**

- `#/$context/<pointer>` is resolved over the project config (`resolveContextPointer`, `services/context-resolver.ts`), so `#/$context/content` enumerates content TYPES, not a type's entries. Studio holds no resolved `_project` section data. The spec's value-editor bullet therefore names an enumeration that yields targets, not entry ids; the per-domain readers are the only source Studio has.
- Three value surfaces read `$ref` today: `referenceTarget` (`CONTENT_REF`, `#/content/` only) for the form engine's field and array-of-objects cell dispatch and for `projectFmField` (`panels/frontmatter-fields.ts`, the Document Header card and the Page panel); and the grid's own `referenceTargetType`, which `openCellValuePopover` uses with a direct `listCollectionEntryIds` call, bypassing the form control's cache. The two pickers also disagree on an unlisted value: the form keeps it as a "— not found" row, the grid moves it to a free-text field.
- An array-of-refs field is JSON text in the form (`deriveField`'s array fallback), a comma-separated text row in frontmatter, and kind `array` in the grid.
- The data grid (`grid/sources/connector-source.ts`) takes its columns from introspection (`kindForSqlType`), so a table's to-one `<field>_id` column and its to-many-into-content id-list column (both laid out by `planTable`) are plain string cells. A table → table to-many has no column at all: its links are rows of the junction table (relationships.md §3), whose two id columns are its composite primary key, which the owner console (`packages/server/src/data-api.ts`) reports as `pk` and the grid therefore shows read-only (`editableColumn`). No surface in Studio can link two rows. (Found in passing and not claimed here: `deleteDataRow` keys on the first primary-key column only, `pkColumn`, so deleting one junction row from the grid deletes every link of its source row.)
- Table rows reach Studio through `fetchRows` (`services/data-service.ts`), paged by `limit`/`offset` (capped at 500 by `queryDataRows`) with no search.

**Ownership.** `plan:extensions/referenceable-sections` (drafted) adds `isReferenceableSection(project)` to `@jxsuite/schema/extension-registry` and narrows the generated entry schema's relationship member to referenceable keys; its integration contract names this plan as the Studio consumer of that predicate, with no payload change. Every Studio control change is this plan's.

## Outcome

- relationships.md §5 → Implemented: the target picker offers every referenceable section's entries, grouped by section label and filtered by §2's content → table rule; a Multiple switch toggles cardinality; the schema form, the frontmatter surfaces and both grids (content collections and data tables) edit to-one and to-many values with pickers over content entries and table rows, including a table → table to-many on its source row.
- relationships.md stays Partial (§2 and §4 remain open) unless both have closed first, in which case the last slice graduates it (Specs & docs).

## Decisions

- **Decided:** Studio learns the referenceable sections from `getExtensions()` filtered by `isReferenceableSection(contribution.project)`, labelled and ordered by `deriveSettingsSection`, with no payload change, because the flag is already on the wire and a shared predicate is the one definition the entry-schema narrowing and the picker can both call.
- **Decided:** the target picker enumerates `#/$context/<sectionKey>` (the section's named entries in the project config), and value editors read target entries per domain: a content collection's entry ids from its files (`listCollectionEntryIds`), a table's row ids from the data surface (`fetchRows`). The spec's parenthetical moves from the value-editor bullet to the target-picker bullet, because Studio has no resolved section data and the context pointer walks config.
- **Decided:** a reader is registered per section key (`content` is file-backed, `data` is table-backed), and a referenceable section with no reader is offered as a target but its values are edited as a typed id with a note. Keyed by section key because Studio already addresses both sections that way (`collectionInfo` reads `projectConfig.content`; the data surface serves `data` tables), and extensions.md §9 gives the `project` block no domain field worth adding for two first-party sections.
- **Decided:** a builder hosted by a file-backed section (the Content Types section) is not offered table-backed targets, because relationships.md §2 disallows content → table and the parser warns on it; the host passes its section key on `SchemaFormContext.section`. Data Tables and Data Shapes (reusable anywhere) are offered every group.
- **Decided:** a to-many value is edited as an ordered list of chosen entries, each with a Remove button, plus an Add picker listing the entries not yet chosen, because the kit offers no multi-select (`jx-option.json`: "a multi-select listbox ... is not offered") and a to-many value is an ordered array that a checkbox list would re-sort into listing order.
- **Decided:** one control edits a reference value wherever a host can mount one: the grid's popover mounts the registered `reference` control through its existing island seam (as it does the media picker), retiring the grid's own picker, `referenceTargetType` and grid-cell.json's `reference` case. The frontmatter surfaces, which project rows and have no island seam, project a `references` row from the same entry state. An unlisted current value is kept and marked "not found", which is what the grid's free-text field was for; typing a new unlisted id in the grid goes with it, because the form never offered it and a table's ids are all reachable through paging.
- **Decided:** a table target lists 100 rows per page ordered by its primary key, with a Load more action while rows remain; each row is labelled by the target schema's first declared non-reference `string` field (`"<label> (<id>)"`, the id alone when empty), and ids travel as strings, because `DataRowsQuery` has no search and a uuid alone is unreadable.
- **Decided:** the owner console names each declared reference column (`DataColumnMeta.ref`) rather than Studio re-deriving physical names, because the server already holds the declared tables it applies the uuid and timestamp conveniences from (`project.tables`), the junction case must live there anyway, and the server may not import the connector (`data-api.ts` header), so this is the one other place relationships.md §3's names are derived.
- **Open:** how is a table → table to-many edited? Recommendation: on its source row, where the console reads the field as an id array from the junction table and replaces its links on write (slice SRP1.3), because the connector's own write path already treats the field that way (`splitRow` and `writeJunctions` in `extensions/connector/src/worker.ts`), and the alternative, the junction table's own grid, is read-only by composite key. The alternative is a `> **Status: Future.**` remainder in §5 for this one shape: SRP1.3 then keeps only the column naming, the disposition becomes `defer`, and the owner console stays a physical-table view.

## Implementation

**SRP1.1: target picker and cardinality toggle** (packages/studio).

1. `src/settings/schema-field-ui.ts`:
   - `referenceOf(schema): { pointer: string; section: string; name: string; many: boolean } | null`, matching `^#/([A-Za-z][A-Za-z0-9_-]*)/([A-Za-z0-9._-]+)$` (the `RelationshipRef` grammar) on a bare `$ref` (to-one) or on `items.$ref` of a `type: "array"` (to-many). The one reader every surface below uses.
   - `withCardinality(schema, many)`: `{ $ref }` or `{ type: "array", items: { $ref } }`, keeping `title`, `description` and `$comment`, dropping array-only keywords on unwrap.
   - `detectFieldType`: `reference` also when `referenceOf(schema)?.many` (any bare `$ref` stays `reference`, so a `#/$defs/...` shape reference is unchanged). `schemaForType("reference", format, target?)` writes `{ $ref: target }`; callers pass the first offered target.
2. New `src/services/reference-targets.ts` (`@docs studio/projects/content-types`):
   - `referenceableSections(): { key; label; order; domain: "file" | "table" | null }[]` over `getExtensions()`, filtered by `isReferenceableSection` (`@jxsuite/schema/extension-registry`), label and order from `deriveSettingsSection` (falling back to `project.title ?? key` and the default order when a class declares no settings block).
   - `referenceTargetGroups(read: (key: string) => unknown, from?: string)`: one `{ id: key, label, rows: [{ label: name, value: "#/<key>/<name>" }] }` per section whose `read(key)` is a non-empty object, omitting table-backed groups when `from`'s domain is `file`. Memoised on the joined pointer list so an unchanged list is the same array (the pattern `targetsFor` uses today).
3. `src/ui/schema-form.ts`: `SchemaFormContext.section?: string | undefined`, documented as the section whose value the form edits. `src/settings/contributed-section.ts` `buildContext` sets it to `sectionKey`.
4. `src/ui/form-controls.ts` (schema-builder): replace `targetsFor` with `referenceTargetGroups((key) => ctx.resolvePointer("#/$context/" + key), ctx.section)`; `fieldView` draws `refTarget` as the whole pointer (`referenceOf(schema)?.pointer ?? schema.$ref ?? ""`) and `refMany`; `setTarget(key, pointer)` writes `withCardinality({ $ref: pointer }, current many)`; new `setMany(key, many)` rewraps through `withCardinality`; `setType(key, "reference")` writes the first offered pointer and refuses when there is none. The view gains `targetGroups` (replacing `targets`), `typeOptions` with the `reference` row `disabled` when no group exists, and `nestedTypeOptions` without `reference`.
5. `src/settings/defs-editor.ts`: the same, with `read = (key) => projectState.projectConfig?.[key]` and no `from`; delete `contentTypeNames`, `targets` and the module-level memo.
6. `src/surfaces/schema-builder.{ts,json}` and `src/surfaces/settings-defs.{ts,json}`: the `ref-target-select` binds `groups` (jx-select's `{ id, label, rows }`, which also synthesises the unlisted row for a hand-written pointer) instead of `options`; a `ref-many` `jx-switch` labelled "Multiple" beside it calls `setMany`; nested `field-type` and `nested-add-type` bind `nestedTypeOptions`. Update both documents' `$description`s, which say the target is "the content type".
7. `src/grid/schema-columns.ts` `kindForProp`: `reference` also for `referenceOf(prop)?.many`.

**SRP1.2: value editors over content targets** (packages/studio).

1. Entry source, in `src/services/reference-targets.ts`: `readReferenceEntries(pointer, offset): Promise<{ entries: { id: string; label: string }[]; total: number } | null>` dispatching on `referenceOf`'s section (`null` for a section with no reader). The `content` reader wraps `listCollectionEntryIds`, one page holding everything. Each reader module is imported once and the promise memoised, so two reads never have two `import()`s of one module in flight (CLAUDE.md's Bun 1.4.0 coverage defect) and startup still avoids the static import `entryIdsFor` warns about.
2. `src/ui/form-controls.ts`: `entryIdCache`/`entryIdResult`/`entryIdWaiting` key on the pointer; `referenceEntryState(pointer, onSettled)` answers `{ entries, total } | { error } | { unreadable: true } | null`; new `loadMoreReferenceEntries(pointer)` appends the next page and notifies the waiters; `invalidateReferenceEntries(pointer?)` (update the one caller, `content/entry-commands.ts`, to `#/content/<name>`). `referenceView` uses `referenceOf`: to-one keeps its three states; `unreadable` is the text state with "Studio cannot list <label> entries; type an id."; to-many is a new `many` kind (`chosen: { id; label; missing; removeLabel }[]`, `addOptions`, `canLoadMore`, `moreLabel`), committing appends, removals and `undefined` for an emptied list. Retry invalidates the pointer.
3. `src/surfaces/reference-field.{ts,json}`: the `many` case (a `role="list"` of chosen rows, each with a `jx-action-button` named `Remove <label>`, then a `jx-select` "Add" of `addOptions`) and a `more` `jx-action-button` shown on either picker kind while `canLoadMore`; actions `add`, `remove(index)`, `more`.
4. `src/ui/schema-form.ts`: both dispatch sites (`deriveField`, `deriveCell`) test `referenceOf(ps) !== null` before any array handling; delete `referenceTarget` and `CONTENT_REF`. The to-many branch must stay ahead of any `array`-of-`string` control `plan:site-architecture/entry-editor-widgets` adds, whichever lands second.
5. `src/panels/frontmatter-fields.ts`: `FmSchemaEntry.items`; the to-one branch reads `referenceOf`; a to-many branch before `entry.type === "array"` projects kind `references` (`FmRowView` gains `chosen`), whose two gestures reach `parse` as `"+<id>"` and `"-<index>"` and return the next array, or `undefined` when empty. `src/surfaces/doc-header.json` and `src/surfaces/panel-page.json` gain the `references` case drawn as in step 3.
6. Grid: `src/grid/schema-columns.ts` `coerceCellInput`'s `reference` branch returns a `string[]` (comma split, as `array`) when the column is to-many; `src/grid/cell-popovers.ts` `openCellValuePopover` mounts `referenceControl` (`ui/form-controls.ts`) into the island for a `reference` column with `{ key: column.field, schema: column.schema, value, onChange: (next) => commit(next ?? null), ctx: NULL_FORM_CONTEXT }` and disposes it on `dismissed`; delete `referenceTargetType`, and `src/surfaces/grid-cell.{ts,json}` lose the `reference` kind, `options`, `custom` and `hint`.

**SRP1.3: the owner console names declared references** (packages/protocol, packages/server).

1. `packages/protocol/src/types.ts` `DataColumnMeta`: `ref?: { field: string; pointer: string; many: boolean; junction?: boolean }`, documented against relationships.md §1 and §3; `junction` marks a field that is not a physical column (not orderable).
2. `packages/server/src/data-api.ts`: `declaredReferenceColumns(table, tables)` returns, per declared reference field, its physical column (`<field>_id` for to-one, `<field>` for a to-many into a non-table section) or its junction (`<table>_<field>`, `<table>_id`, `<target>_id` or `<target>_id_2` for a self-reference, only when the target is a declared table), mirroring `planTable`. `queryDataRows` annotates matching columns with `ref`, and for each junction field appends a column `{ name: field, type: "json", ref: { ..., junction: true } }` and fills `row[field]` with the page's links (one `select ... where <source> in (<page ids>)`). `insertDataRow` and `updateDataRow` take junction fields out of `values`/`set` before `coerceValues` (which would refuse the unknown column), write the row, then replace that row's links (delete, then insert each id, coerced like `normalizePk` against the target's id column), and return the field on the row. An update carrying only junction fields skips the empty-`set` refusal.

**SRP1.4: table targets in Studio** (packages/studio), then the spec and docs.

1. `src/services/reference-targets.ts`: the `data` reader pages `fetchRows({ table: name, connection: <declared connection>, limit: 100, offset, orderBy: <pk> })` and labels rows as decided; it returns an error when `dataSurfaceAvailable()` is false, so the control shows its failed state with the reason.
2. `src/grid/sources/connector-source.ts` `columns()`: a column whose meta carries `ref` becomes kind `reference` with `schema: withCardinality({ $ref: ref.pointer }, ref.many)`; `rows()` parses a to-many id-list column's JSON text into `string[]` (a junction field already arrives as an array); `toQuery` drops an `orderBy` naming a junction field. Commits already send arrays, which the console stores.
3. Specs and docs as below; delete this plan in the same pull request.

**Integration contract.** Once landed: `referenceOf` and `withCardinality` (`settings/schema-field-ui.ts`) are the one reader and writer of a relationship field's pointer and cardinality in Studio; `services/reference-targets.ts` exports `referenceableSections`, `referenceTargetGroups` and `readReferenceEntries`, and adding a reader there is how a new referenceable section becomes listable; `referenceEntryState(pointer)` is the one cache, and `invalidateReferenceEntries(pointer)` its one invalidation; the registered `reference` control edits both cardinalities in any host that mounts it; `SchemaFormContext.section` names the section a form edits; the owner console's rows route annotates declared reference columns with `DataColumnMeta.ref` and reads and writes a junction-backed field as an id array on its source row. No plan in the index requires this one.

## Tests

`bun test --isolate --coverage` from each touched workspace. DOM test files import `./harness` first; `content-source`, `data-service` and the platform are doubled with `mock.module()` before the module under test is imported.

**packages/studio** (`coverageThreshold = { lines = 0.958, functions = 0.941 }`).

- `tests/schema-field-ui.test.ts`: `referenceOf reads a to-one and a to-many pointer into any section` (`#/content/authors`, `#/data/users`, `items.$ref`; `null` for `#/$defs/Address`, `#/content/`, and an array of strings); `withCardinality wraps and unwraps, keeping the pointer and annotations`; `detectFieldType reads an array of refs as reference`; `schemaForType writes the target it is given`.
- New `tests/reference-targets.test.ts`: `only referenceable contributions are sections, labelled and ordered by their settings block` (a contribution with `referenceable: "yes"` is left out); `groups name every entry as a full pointer and omit empty sections`; `a file-backed host is not offered table targets`; `an unchanged list is the same array`; `readers import their module once however many reads overlap` (two concurrent reads, one import counted by the double); `content reads list entry ids`; `a table read pages by primary key and labels by the first string field` (SRP1.4); `a table read without a data surface is an error`; `a section with no reader answers null`.
- `tests/form-controls.test.ts` and `tests/defs-editor.test.ts`: `the target picker groups content types and tables`; `choosing a target writes the whole pointer and keeps the cardinality`; `Multiple wraps and unwraps without losing the target`; `the reference type is disabled with no targets, and choosing it writes the first target`; `nested cards do not offer reference`; `a content type's builder offers no table group` (form-controls only, through `ctx.section`).
- `tests/contributed-section.test.ts`: `the form context names its section`.
- `tests/reference-control.test.ts`: the `referenceTarget` describe becomes `referenceOf dispatch` (a `#/data/` field now gets the control); new `a to-many field lists chosen entries and adds and removes them in order`, `an emptied list commits undefined`, `a missing chosen id stays and is marked`, `Load more appends the next page and redraws`, `a section with no reader is a typed id with a note`, `invalidation is by pointer`; the frontmatter cases gain `a to-many frontmatter row adds and removes through parse`.
- `tests/grid-schema-columns.test.ts`: `an array of refs is a reference column` and `coerceCellInput splits a to-many reference`.
- `tests/grid-cell-popovers.test.ts`: the `referenceTargetType` case is deleted; new `a reference cell mounts the reference control in the island and commits through the buffer`, `a to-many cell commits an array, and an emptied one null`, `closing the panel disposes the control`.
- `tests/grid-connector-source.test.ts` (SRP1.4): `a column carrying ref is a reference column with its cardinality`, `an id-list column parses to an array`, `ordering by a junction field is dropped`.

**packages/server** (`lines = 0.96, functions = 0.95`): `tests/data-api.test.ts`, a new describe `declared references` in its own fixture root (posts with to-one `category` into `#/data/tags`, to-many `tags` into `#/data/tags`, to-many `related` into `#/content/pages`, and a self-referential `parents` into `#/data/posts`): `columns carry each declared reference`, `a junction field reads as the page's links`, `insert and update replace a row's links`, `an update carrying only junction fields succeeds`, `a self-reference uses the _2 column`, `an undeclared table carries no ref`.

**packages/protocol**: types only; no test change.

**Coverage.** `services/reference-targets.ts` is the one new source file and ships with its test (the manifest check). Deleting `referenceTargetType` and grid-cell's reference case removes code rather than coverage. Ratchet a workspace's `coverageThreshold` if a slice raises its worst file.

## Specs & docs

**`specs/relationships.md` §5**, in place (SRP1.4): the marker becomes `> **Status: Implemented.**` and the bullets read:

- "**Target picker** enumerates the named entries of every `referenceable` section (extensions.md §9), the keys of `#/$context/<sectionKey>`, grouped by section label (the section's `$studio.settings.label`, else its `project.title`), and writes the chosen `#/<sectionKey>/<name>` pointer. A file-based section's schema is not offered a connection-backed section's entries, since §2 disallows content → table. Only top-level fields take the `reference` type."
- "**Cardinality toggle** (single / multiple) wraps or unwraps the `array`/`items` form, keeping the pointer."
- "**Value editors** for reference fields, in every surface that edits a value (a schema-driven form, a frontmatter field, a grid cell), present entry pickers over the target's entries as Studio reads them per domain: a content collection's entry ids from its files, a table's row ids from the data surface, a page at a time. A to-one value is one choice; a to-many value is an ordered list of chosen entries with an add picker. A value naming no listed entry stays, marked as not found. A referenceable section Studio has no reader for is edited as a typed id."
- "In the data grid a declared table's reference fields are edited on their own row: a to-one through its `<field>_id` column, a to-many into a non-table section through its id-list column, and a table → table to-many as an id array read from and written to its junction table (§3)."

Fragment: `bun run spec:change relationships.md minor -m "§5: Studio's reference field picks its target from every referenceable section, grouped by section, toggles between one and many, and edits values with entry pickers over content collections and data tables, a table's junction-backed links included."`

If §2 and §4 have both closed before SRP1.4 lands, this is the last open item: set the header `**Status:** Implemented`, run `bun run spec:bump relationships.md minor -m "…"` in place instead of the fragment, and delete `plans/relationships/`.

**Docs** (no em dashes; `bun run docs:sync` names these through `code:`):

- `docs/studio/projects/content-types.md`: add `spec: [relationships.md#5]` and `packages/studio/src/services/reference-targets.ts` to `code:`. The reference bullet and paragraph become: a **reference** field gets a **Target** picker listing your content types, and a **Multiple** switch that makes it a list of references. The entry-form bullet adds: a multiple reference lists the entries you chose, in order, each with **Remove**, and an **Add** picker for another.
- `docs/studio/data/tables.md`: add `relationships.md#5` to `spec:` (creating it). The **Target** picker lists your content types and your data tables, grouped by section, and **Multiple** makes a to-many reference; the picker paragraph covers table rows and to-many lists; delete "The visual Target picker currently offers content types, so table targets are written in the JSON directly."
- `docs/studio/data/grid.md`: a paragraph on reference cells: double-click opens a picker over the target's entries, a table target shows 100 rows at a time with **Load more**, and a to-many table reference is a column of its own that saves into its junction table.
- `docs/studio/editing/frontmatter.md`: the entry-picker bullet adds the list form for a field holding several references.
- `docs/studio/projects/settings.md`: Data Shapes' reference field "gets a picker naming a content type or a data table".
- `docs/framework/site/relationships.md`: no change; it documents the format and its "Beyond content" paragraph already states the content → table rule the picker applies.

The `screenshots` lane re-captures `docs/images/data-table-editor.png` and any content-types shot the card change moves; re-read the pages its comment lists.

## Acceptance

- `bun run plans:check --audit relationships` reports nothing for this file; after SRP1.4, `bun run plans:status --spec relationships` no longer lists `relationships.md#5`.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` pass; the studio guards in `checks` pass (`check-surface-purity.ts`, `check-lit-conventions.ts`, `lint:styles`), as does `bun scripts/check-shot-contract.ts`.
- `git grep -n 'referenceTarget\b\|referenceTargetType\|CONTENT_REF\b\|#/content/\${' -- packages/studio/src` prints nothing.
- `bun test --isolate --coverage` passes from `packages/studio` and `packages/server`, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- By hand, in `scripts/screenshots/fixtures/data` with a `pages` content type added: in Data Tables › comments, add a `reservation` reference; the Target picker shows **Content Types** and **Data Tables** groups; choose `reservations`, switch **Multiple** on and off, and `project.json` moves between `{ "$ref": "#/data/reservations" }` and `{ "type": "array", "items": { "$ref": "#/data/reservations" } }`. Leave it single and add a second field, `guests`, as a multiple reference to `reservations`. In Content Types › pages the picker shows no Data Tables group. Push the schema and open the comments grid: `reservation_id` opens a picker of reservation rows labelled by `name`, and `guests` is a column of its own whose picks survive a reload and appear as rows of `comments_guests`.

## Slices

| Slice  | Scope                                                                                                                                        | Claims             | State |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----- |
| SRP1.1 | `referenceOf`, the referenceable-section groups, the grouped target picker and Multiple switch in both builders, `SchemaFormContext.section` | —                  | open  |
| SRP1.2 | The pointer-keyed entry source, the control's to-many kind, the frontmatter `references` row, the grid popover mounting the control          | —                  | open  |
| SRP1.3 | `DataColumnMeta.ref`, and the owner console's declared-reference columns with junction fields read and written on the source row             | —                  | open  |
| SRP1.4 | The `data` reader with paging, the connector grid's reference columns, the §5 rewrite, marker and fragment, the docs pages                   | relationships.md#5 | open  |
