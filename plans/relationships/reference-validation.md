---
status: stub
disposition: implement
claims:
  - relationships.md#4
size: M
workspaces:
  - extensions/parser
  - extensions/connector
---

# A malformed reference value is reported on both sides, and a table write naming a row or entry that does not exist is refused

## Context

`specs/relationships.md` §4, line 65:

> **Status: Partial.** The connector enforces the value shape on every `/_jx/data` write (`validateRow` in `extensions/connector/src/validate.ts`, called from `insertRow` and `updateRow` in `extensions/connector/src/worker.ts`), and the parser checks content existence at load time (`resolveContentTypeRefs`), but it reports a dangling id as a warning naming the entry, field and target and leaves the id in place, which is what site-architecture.md §6.4 specifies rather than the validation error the second bullet names. Not built: the parser's `validateEntries` never judges a reference field's value, so a non-string to-one value or a non-string to-many element passes silently, and those writes check the shape only, never that the referenced row or content entry exists.

The section was unmarked before the census. Disposition `implement`, because two of the three bullets need code. The second bullet is the exception and runs the other way: the parser's whole validation channel is `console.warn` (`validateEntries` warns for every mismatch it finds), `site-architecture.md` §6.4 already says a dangling id "is left as the bare string, with a build warning", and the user docs page `docs/framework/site/relationships.md` says the same, so that bullet's wording is reconciled to the warning rather than the parser being made to fail a build.

**What exists**

- `validateRow` and its reference branch in `extensions/connector/src/validate.ts` (a to-one value must be a non-empty string, a to-many value an array of them), covered by `extensions/connector/tests/validate.test.ts`, and called from `insertRow` and `updateRow` in `extensions/connector/src/worker.ts`, the `/_jx/data` write routes.
- The Studio owner console's writes, `insertDataRow` and `updateDataRow` in `packages/server/src/data-api.ts` (`POST` and `PUT /__studio/data/rows`, reached from the grid through `packages/studio/src/grid/sources/connector-source.ts` and `packages/studio/src/services/data-service.ts`), run only `coerceValues`, a storage coercion keyed on the introspected column types, and never `validateRow`.
- `validateEntries` in `extensions/parser/src/content-loader.ts`: required fields, dates, and `type` mismatches; a to-one `{ "$ref" }` field has no `type`, so it is never judged, and a to-many field is checked only for being an array.
- `resolveContentTypeRefs` in the same file warns on an unknown target type and on each missing id, and silently passes a non-string value or element.

**What is missing**

- Parser: a reference field whose value is not a string (to-one), or an array holding a non-string (to-many), is reported by `validateEntries` naming the entry and field, in the same channel as every other content validation finding.
- Connector: on `/_jx/data` insert and update, each to-one `<field>_id` and each to-many id is checked against its target, and a missing target is a 400 naming the field and id. A table target is a row: the foreign keys `plan:relationships/table-foreign-keys` adds enforce it where the dialect does, the check covers the rest, and it compares ids under the same typing that plan decides, so `"1"` finds an integer-id row. A content target is an entry, found through the content view `plan:relationships/cross-domain-references` decides. Junction writes are checked the same way.
- Scope of the owner console: §4 assigns write-time existence to the connector, and the console is a raw admin surface over introspected columns (extensions.md §13), so it is outside the bullet's letter and stays exempt unless the detail phase decides otherwise. The database-level keys still bind it wherever the dialect enforces them. The decision is recorded either way, because today the grid can store any value in a reference column.
- The second bullet reworded to the warning the code and site-architecture.md §6.4 give, and `docs/framework/site/relationships.md`'s "fails the field's validation" sentence made true on the content side by the parser change above.

**Related**

- relationships.md §2 (the content view, the id typing and the foreign keys this check builds on).
- site-architecture.md §6.4 (the dangling-id warning), site-architecture.md §6.3 (build warnings).
- extensions.md §11 (the data mount's write routes), extensions.md §13 (the owner console).
