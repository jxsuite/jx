---
status: stub
disposition: implement
claims: []
size: M
workspaces:
  - extensions/connector
---

# A to-one table reference is typed like its target's id, so it resolves on include and carries a real foreign key

## Context

An enabling plan for `plan:relationships/cross-domain-references`, which owns `specs/relationships.md` §2. It claims nothing: it closes the table → table half of that section's marker, and the owner closes the marker. `specs/relationships.md` §2, line 39, the parts this plan answers:

> **Status: Partial.** … the connector's `/_jx/data` mount stores `<field>_id` text columns and expands `?include=` for junction to-manys and for to-one refs into uuid-id tables (`expandIncludes` in `extensions/connector/src/worker.ts`, by a second `SELECT … WHERE id IN` rather than a join). Not built: a to-one `?include=` onto an `integer`-id table resolves to `null`, because the text column's `"1"` misses the numeric key the target rows come back with; … `buildCreateTable` and the additive `ADD COLUMN` path (`extensions/connector/src/ddl.ts`) emit no foreign-key constraint on any dialect; …

It was split from the owner because it is one decision in one workspace (how a to-one column is typed, and what that means for rows and databases that already exist), while the owner's content view spans the dev server, the site build and the parser and shares none of it. `plan:relationships/reference-validation` leans on the constraints this adds for table → table existence where the dialect enforces them.

**What exists**

- `planTable` in `extensions/connector/src/columns.ts` gives every to-one `<field>_id` column `dataType: "text"` whatever the target's `id` (`"uuid"` or `"integer"`), while junction columns are typed by `idDataType` from each side's id kind. Covered by `extensions/connector/tests/columns.test.ts`.
- `validateRow` in `extensions/connector/src/validate.ts` accepts only a non-empty string for a to-one value, so a row can store `"1"` and never `1`.
- `expandIncludes` in `extensions/connector/src/worker.ts` keys its target map by `t.id` as the driver returns it (a number from an integer primary key) and looks it up with the stored column value (a string), so the to-one lookup misses and the field becomes `null`. Junction to-manys resolve, because the junction column is typed integer and the stored id comes back numeric. Covered by `extensions/connector/tests/worker.test.ts`, whose include cases use uuid ids.
- `buildCreateTable`, the `ADD COLUMN` path and drift reporting in `extensions/connector/src/ddl.ts`, covered by `extensions/connector/tests/ddl.test.ts`: plain columns, no `REFERENCES`, never a retype.

**What is missing**

- The id-typing decision: type a new to-one column to match its target's id, and normalise the include lookup (and anything else that joins on the column) so an existing `text` column still resolves against an integer key, since additive sync never retypes a column that already exists. One decision covers the include bug and the constraint below.
- Foreign keys: `REFERENCES` on `<field>_id` in `CREATE TABLE`, and on `ADD COLUMN` where the dialect allows it (SQLite allows it only with a null default and enforces it only under `PRAGMA foreign_keys = ON`; D1 enforces by default; Postgres takes it on either path). Only a `#/data/...` target gets one; the table → content row stays `text` with no database-level key.
- Creation order that respects the targets, and a self-reference that needs its table to exist first.
- An existing column without its constraint, or typed `text` onto an integer-id target, reported as drift rather than altered.

**Related**

- relationships.md §3 (junction columns already typed to each table's id type), relationships.md §4 (write-time existence).
- extensions.md §12 (the `connector` block and dialects).
