---
status: stub
disposition: implement
claims:
  - relationships.md#2
requires:
  - relationships/table-foreign-keys
size: M
workspaces:
  - extensions/connector
  - extensions/parser
  - packages/server
  - packages/compiler
---

# Every path that reads a table resolves its content and table references, and a content schema pointing at a table is warned about

## Context

`specs/relationships.md` §2, line 39:

> **Status: Partial.** content → content ships as `resolveContentTypeRefs` (`extensions/parser/src/content-loader.ts`) inside `Content.projectData`, and the connector's `/_jx/data` mount stores `<field>_id` text columns and expands `?include=` for junction to-manys and for to-one refs into uuid-id tables (`expandIncludes` in `extensions/connector/src/worker.ts`, by a second `SELECT … WHERE id IN` rather than a join). Not built: a to-one `?include=` onto an `integer`-id table resolves to `null`, because the text column's `"1"` misses the numeric key the target rows come back with; `TableQuery` and `TableEntry` resolved under node (`queryTable` and `getEntry` in `extensions/connector/src/table-node.ts`) ignore `include` altogether; `expandIncludes` skips content refs, so table → content `?include=` resolves nothing; `buildCreateTable` and the additive `ADD COLUMN` path (`extensions/connector/src/ddl.ts`) emit no foreign-key constraint on any dialect; and `refTargetName` reads only `#/content/` pointers, so a `#/data/...` ref in a content schema is ignored without a warning.

The section was unmarked before the census. This plan owns the whole anchor. The table → table half (to-one column typing, the integer-id include miss, and the foreign-key constraints) is one connector decision with nothing in common with the rest, so it is split out as the enabling `plan:relationships/table-foreign-keys`, which this plan requires. What stays here shares one question, which side of the build/request boundary each domain lives on: the content view the table side reads at request time, `include` on every path that resolves a table, and the parser's warning for the direction the matrix forbids. Disposition `implement`: the matrix is the contract and every row is still wanted. The "via a join" wording in the table → table row is editorial (the second `SELECT` is observably the same) and is reconciled alongside.

**What exists**

- `resolveContentTypeRefs` and `Content.projectData` in `extensions/parser/src/content-loader.ts`, covered by `extensions/parser/tests/content-loader.test.ts`; `refTargetName` and `CONTENT_REF_PREFIX` match `#/content/` only.
- `planTable` and `parseRefPointer` in `extensions/connector/src/columns.ts`: a to-one ref into any section becomes a text `<field>_id` column, a to-many into `data` a junction, a to-many into any other section a JSON text column of ids.
- `expandIncludes` and `includeFields` in `extensions/connector/src/worker.ts` (to-one only when `spec.ref.section === "data"`; junction to-manys), covered by `extensions/connector/tests/worker.test.ts`. This is the only place `include` is honoured.
- `TableQuery` and `TableEntry` (`extensions/connector/src/table-state.ts`) send `include` on the URL in a browser (`buildDataUrl` in `extensions/connector/src/table-shared.ts`), but under node, at server and compiler timing, they call `queryTable` and `getEntry` in `extensions/connector/src/table-node.ts`, which never read `config.include`. `TableQuery.class.json` documents `include` as expanding to-one table refs and junction to-manys, so the same query returns expanded rows in the browser and unexpanded rows in an SSG bake.
- The data mount's `DataMountOptions.sections` (worker.ts) is the raw `project.json` section values, filled by `buildRuntime` in `packages/server/src/jx-mounts.ts` for the dev server and by `buildMountSpecs` in `packages/compiler/src/site/site-build.ts` for the generated worker (identifiers only, inlined into the mount options). The mount never sees the loaded `_project.content`.
- The node path already has it: `config._project` carries the loaded sections, `content` included, injected by `packages/server/src/resolve.ts` and `packages/compiler/src/site/prototype-resolver.ts`.

**What is missing**

- table → content `?include=`: a content-entry view the data mount can read at request time, in the dev server (`buildRuntime`) and on a deployed worker (`buildMountSpecs`), where no filesystem holds the content. The decision is how that view reaches the mount (entries loaded through the parser's `projectData` and handed over as a section, or a build-time snapshot bundled with the worker), and it is the view relationships.md §4's write-time content-existence check reuses. The node path is the easy case, since `_project.content` is already there. The row limits `include` to to-one; to-many content ids stay as stored.
- `include` on the node path: `queryTable` and `getEntry` expanding the same fields `expandIncludes` does (shared rather than copied), plus table → content from `_project.content`, so a baked page and a browser fetch agree.
- table → table: the to-one typing, the integer-id include fix and the foreign-key constraints, delivered by `plan:relationships/table-foreign-keys`.
- content → table: `resolveContentTypeRefs` (or `validateEntries`) warns on a `#/data/...` ref in a content schema, naming the content type and field, instead of skipping it.

**Related**

- relationships.md §4 (write-time existence builds on the content view decided here).
- extensions.md §11 (the `server` block and the data mount's routes), extensions.md §9 (`referenceable`, which decides what a pointer may target), extensions.md §12 (the `connector` block and dialects).
- site-architecture.md §6.4 (collection references at build time).
