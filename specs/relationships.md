# Jx Relationships Specification

## References Between Named Entries Across Extension Sections

**Version:** 0.1.5-draft\
**Status:** Partial\
**Updated:** 2026-09-29\
**License:** MIT

Companion to [extensions.md](./extensions.md) §5/§9. Defines the standard field types for relationships between data — content entries, dynamic table rows, and any future `referenceable` section — so a comment can belong to a product, an author to a post, an order line to a product row.

---

## 1. The reference form

Relationship metadata lives **in the field's JSON Schema inside the section value in `project.json`** — one source of truth read by content validation and resolution, connector DDL, and studio pickers.

A reference names its target with a unified pointer over any section whose owning class declares `project.referenceable: true`:

```
#/<sectionKey>/<entryName>
```

| Cardinality | Field schema                                                        | Example                                                              |
| ----------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| to-one      | `{ "$ref": "#/<sectionKey>/<name>" }`                               | `"author": { "$ref": "#/content/authors" }`                          |
| to-many     | `{ "type": "array", "items": { "$ref": "#/<sectionKey>/<name>" } }` | `"tags": { "type": "array", "items": { "$ref": "#/content/tags" } }` |

Cardinality is expressed JSON-Schema-natively: a bare `$ref` is to-one; an array of refs is to-many. There is no separate relationship DSL.

The core schema publishes the shape as `$defs.RelationshipRef` (`@jxsuite/schema/schemas/project.core.schema.json`) and includes it in the default field-union resource (`https://jxsuite.com/schema/project/fields/v2`); the generated per-project entry schema re-embeds that resource with the effective union — which is how relationship fields become valid everywhere field schemas recurse (content frontmatter schemas, table column schemas) without any fragment knowing the full union (extensions.md §5.3).

**Stored values** are entry identifiers: the target section's entry `id` (string) for to-one, an array of ids for to-many.

---

## 2. Semantics matrix

> **Status: Partial.** content → content ships as `resolveContentTypeRefs` (`extensions/parser/src/content-loader.ts`) inside `Content.projectData`, and the connector's `/_jx/data` mount stores `<field>_id` text columns and expands `?include=` for junction to-manys and for to-one refs into uuid-id tables (`expandIncludes` in `extensions/connector/src/worker.ts`, by a second `SELECT … WHERE id IN` rather than a join). Not built: a to-one `?include=` onto an `integer`-id table resolves to `null`, because the text column's `"1"` misses the numeric key the target rows come back with; `TableQuery` and `TableEntry` resolved under node (`queryTable` and `getEntry` in `extensions/connector/src/table-node.ts`) ignore `include` altogether; `expandIncludes` skips content refs, so table → content `?include=` resolves nothing; `buildCreateTable` and the additive `ADD COLUMN` path (`extensions/connector/src/ddl.ts`) emit no foreign-key constraint on any dialect; and `refTargetName` reads only `#/content/` pointers, so a `#/data/...` ref in a content schema is ignored without a warning.

Resolution behavior depends on the domains on each side. "content" means a file-based section loaded at build/dev time (parser); "table" means a connection-backed section served at request time (connector).

| From → To         | Storage                                                             | Resolution                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| content → content | id string / id array in frontmatter                                 | Load-time substitution inside the parser's `projectData`: the id (or each array element) is replaced with the referenced entry object. Applies identically at build, dev serve, and studio preview.                                        |
| table → content   | FK column stores the content entry id (`text`; no DB-level FK)      | Request-time: data routes accept `?include=<field,...>`; the mount resolves the entry from `_project.content`. v1 supports `include` for to-one only.                                                                                      |
| table → table     | FK column `<field>_id`; real FK constraint where the dialect allows | Request-time: `?include=` expands to-one via a join. To-many uses a junction table (§3).                                                                                                                                                   |
| content → table   | —                                                                   | **Disallowed statically.** Content is loaded at build time; table rows are live. Parser validation warns on `#/data/...` refs in content schemas. Model the association from the table side, or query dynamically with `TableQuery` state. |

---

## 3. Junction tables (table ↔ table to-many)

A to-many reference between tables is materialized by the connector's DDL sync as an auto-managed junction table:

- **Name:** `${sourceTable}_${fieldName}`.
- **Columns:** `${sourceTable}_id`, `${targetTable}_id` (suffix `_2` on the target column for self-references), typed to match each table's id type.
- **Keys:** composite primary key over both columns; index on the target column.
- Managed additively like all connector DDL: created when missing, never dropped. **Renaming a to-many field orphans its junction table** (additive sync cannot see the rename); the old junction is reported as drift, not deleted.

---

## 4. Validation

> **Status: Partial.** The connector enforces the value shape on every `/_jx/data` write (`validateRow` in `extensions/connector/src/validate.ts`, called from `insertRow` and `updateRow` in `extensions/connector/src/worker.ts`), and the parser checks content existence at load time (`resolveContentTypeRefs`), but it reports a dangling id as a warning naming the entry, field and target and leaves the id in place, which is what site-architecture.md §6.4 specifies rather than the validation error the second bullet names. Not built: the parser's `validateEntries` never judges a reference field's value, so a non-string to-one value or a non-string to-many element passes silently, and those writes check the shape only, never that the referenced row or content entry exists.

- Reference fields must hold a string (to-one) or an array of strings (to-many); anything else fails entry validation.
- **Intra-section and content-to-content existence** is checked at load time by the parser (it holds all loaded sections): a dangling id is a validation error naming the field and target.
- **Table-side existence** (a row referencing a content entry or another row) is checked by the connector at write time.
- Cross-extension validation hooks beyond these are deferred.

---

## 5. Studio picker

> **Status: Partial.** `reference` is one of `FIELD_TYPES` (`packages/studio/src/settings/schema-field-ui.ts`), and a to-one `#/content/<type>` field gets an entry picker in the schema form (`referenceTarget` in `packages/studio/src/ui/schema-form.ts`) and in the grid (`kindForProp` in `packages/studio/src/grid/schema-columns.ts`, `referenceTargetType` in `packages/studio/src/grid/cell-popovers.ts`), both fed by `listCollectionEntryIds` rather than a `#/$context/<sectionKey>` enumeration. Not built: the target pickers (`targetsFor` in `packages/studio/src/ui/form-controls.ts`, and `packages/studio/src/settings/defs-editor.ts`) list content types only, ungrouped, and always write `#/content/<name>`; there is no single/multiple toggle, so an array-of-refs field reads as a plain `array`; and no value editor handles a to-many field or a data-table target.

The studio's field editor (`schema-field-ui`) exposes a `reference` field type:

- **Target picker** enumerates the entries of every `referenceable` contribution, grouped by section label (from each extension's `project` block), and writes the chosen `#/<sectionKey>/<name>` pointer.
- **Cardinality toggle** (single / multiple) wraps or unwraps the `array`/`items` form.
- Value editors for reference fields present entry pickers populated from the resolved section data (`#/$context/<sectionKey>` enumeration).

## 6. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md).

| Standard                                                            | Class        | Binds | Evidence                                                                                   | Note                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------ | ----- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema) | **Adopted**  | §1    | packages/schema/defs/field-schema.schema.ts, packages/schema/tests/project-schemas.test.ts | Cardinality is expressed with the standard's own vocabulary — a bare `$ref` is to-one, `{"type":"array","items":{"$ref":…}}` is to-many — so a relationship needs no keyword the standard does not already have.     |
| [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)                  | **Borrowed** | §1    | packages/schema/schemas/project.core.schema.json                                           | `#/<sectionKey>/<entryName>` takes JSON Pointer's shape and points into the resolved project sections rather than into the containing document, so it is not a pointer any conformant implementation could evaluate. |

## Changelog

- **0.1.5-draft** (2026-09-29) — Census against the code: §2, §4 and §5 gained Partial markers for to-one includes onto integer-id tables, includes on the node path, table-to-content includes, foreign-key constraints, the content-to-table warning, reference value and write-time existence checks, and the Studio pickers' content-only, to-one scope.
- **0.1.4-draft** (2026-08-15) — Add §6 Standards Alignment: JSON Schema 2020-12 for cardinality, and the JSON Pointer shape the reference form borrows.
- **0.1.3-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.1.2-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`79daba23`).
- **0.1.1-draft** (2026-07-08) — Shipped schema fragments + per-project schema emitters (`9e4a8936`).
- **0.1.0-draft** (2026-07-08) — Extensions v2 framework + docs (`3fb8795f`).

---

_Jx Relationships Specification v0.1.5-draft_
