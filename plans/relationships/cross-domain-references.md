---
status: drafted
disposition: implement
claims:
  - relationships.md#2
requires:
  - relationships/table-foreign-keys
workspaces:
  - packages/schema
  - extensions/connector
  - extensions/parser
  - packages/server
  - packages/compiler
size: M
---

# Every path that reads a table expands its content and table references alike, and a content schema pointing outside content is warned about

## Context

`specs/relationships.md` §2, line 39:

> **Status: Partial.** content → content ships as `resolveContentTypeRefs` (`extensions/parser/src/content-loader.ts`) inside `Content.projectData`, and the connector's `/_jx/data` mount stores `<field>_id` text columns and expands `?include=` for junction to-manys and for to-one refs into uuid-id tables (`expandIncludes` in `extensions/connector/src/worker.ts`, by a second `SELECT … WHERE id IN` rather than a join). Not built: a to-one `?include=` onto an `integer`-id table resolves to `null`, because the text column's `"1"` misses the numeric key the target rows come back with; `TableQuery` and `TableEntry` resolved under node (`queryTable` and `getEntry` in `extensions/connector/src/table-node.ts`) ignore `include` altogether; `expandIncludes` skips content refs, so table → content `?include=` resolves nothing; `buildCreateTable` and the additive `ADD COLUMN` path (`extensions/connector/src/ddl.ts`) emit no foreign-key constraint on any dialect; and `refTargetName` reads only `#/content/` pointers, so a `#/data/...` ref in a content schema is ignored without a warning.

This plan owns the anchor. The table → table half (to-one column typing, the integer-id include miss, the foreign keys) is the enabling `plan:relationships/table-foreign-keys`, which lands first. What stays here is which side of the build/request boundary each domain lives on. Re-verified on 2026-09-26:

- **include is honoured in one place.** `expandIncludes` and `includeFields` (private, `worker.ts`) expand a to-one ref only when `spec.ref.section === "data"`, plus junction to-manys; `worker.test.ts` covers them with uuid ids. `queryTable` and `getEntry` never read `config.include`, although `TableQuery.class.json` documents `include` and the browser path sends it (`buildDataUrl`, `table-shared.ts`). A `timing: "compiler"` bake and a browser fetch of the same query return different rows.
- **table → content is the reference Studio writes.** A data table's reference **Target** picker lists content types only (`docs/studio/data/tables.md`), so the common table reference is exactly the one that resolves nothing. `planTable` (`columns.ts`) stores it as a text `<field>_id`, and a to-many content ref as a JSON id-array column.
- **The mount never sees content.** `DataMountOptions.sections` is the raw `project.json` values, filled by `buildRuntime` (`packages/server/src/jx-mounts.ts`) and by `buildMountSpecs` (`packages/compiler/src/site/site-build.ts`, inlined as JSON into the generated worker by `buildMountBlock` in `packages/compiler/src/targets/compile-server.ts`). The node path has `_project.content` (the `Map<string, ContentLoaderEntry[]>` from `Content.projectData`), injected by `packages/server/src/resolve.ts` and `packages/compiler/src/site/prototype-resolver.ts`.
- **What the stub missed.** `_project.content` cannot be inlined as it stands: each entry carries `body` and its rendered `$children` tree, and `resolveContentTypeRefs` substitutes references in place, so two types that reference each other load as a cyclic graph `JSON.stringify` throws on. The dev server's `_project` (`loadProjectEntry`, `resolve.ts`) is cached by `project.json` mtime only, so it reflects content as of the last `project.json` change; a mount reading it inherits that, not a new staleness. And `plan:extensions/server-module-required` moves `buildMountSpecs` to step 1c, before the sections load at step 3b.
- **The parser.** `refTargetName` and `CONTENT_REF_PREFIX` (`content-loader.ts`) match `#/content/` only; any other pointer, `#/data/users` or a stale `#/contentTypes/authors`, is skipped silently (`content-loader.test.ts`, "does not resolve legacy #/contentTypes/ pointers").

## Outcome

- relationships.md §2 → `Implemented`: `include` expands the same fields on the `/_jx/data` routes and when `TableQuery`/`TableEntry` resolve under node; a to-one table → content `include` returns the referenced entry from a reference view each host hands the data mount; a content schema pointer outside `content` is warned about; the table → table row reads what ships.
- extensions.md §11 names the new host-provided `references` mount option.
- relationships.md does not graduate: §4 and §5 stay open under their own plans.

## Decisions

- **Open:** what a table → content `include` puts in the row. Recommendation: `{ id, data }`, the entry's id and frontmatter with the entry's own references collapsed to ids, rather than the whole entry a content → content reference substitutes (`body`, `$children`, `_meta`). The generated worker carries the view inline, and a rendered tree per entry would grow the bundle by the size of the collection; templates reach a referenced entry through `.data` either way. The cost: `${row.author.body}` works from content and not from a table, and a page that needs the body reads it with `ContentEntry`.
- **Decided:** the view is plain JSON built by one pure module, `packages/schema/src/reference-view.ts`, because both hosts are core packages that may not import an extension (extensions.md §2), the connector runs on Workers and depends only on `@jxsuite/schema`, and the node path must project exactly as the mount does.
- **Decided:** the host hands the view over as a `references` mount option, because a deployed worker has no content directory and its options are its only per-deployment data (extensions.md §11). The site build inlines a snapshot beside `sections`; the dev server passes a function that builds it from the context `resolve.ts` already loads for the resolve proxy, so one load serves both `include` and a resolved `TableQuery`, refreshed when that context is. The mount calls the function only when an `include` names a content field.
- **Decided:** the view holds what the mount's own section points at (to-one and to-many targets, since `plan:relationships/reference-validation` checks both on write), one entry per id, and for a localized collection the default locale's translation, else the first loaded, because the data routes carry no locale and a row stores one id for every translation. A target qualifies by shape: the loaded section (a `Map` or a record) holds, under the entry name, an array of `ContentLoaderEntry`-shaped items (string `id`, object `data`). Hosts name no section (extensions.md §11.1), and `_project.data`'s table definitions drop out by shape. The `referenceable` flag is not consulted: refusing such a pointer is `plan:extensions/referenceable-sections`' validation, so it is not a prerequisite.
- **Decided:** one expansion. `expandIncludes` moves from `worker.ts` to a new `extensions/connector/src/include.ts` and serves both the routes and `queryTable`/`getEntry`, because a copy is how a baked page and a live fetch would drift again. A to-many content field is not expanded (the row's "v1 supports `include` for to-one only") and keeps its id array.
- **Decided:** the parser warns in `resolveContentTypeRefs`, once per content type and field, for any pointer outside `#/content/`, and leaves the value as stored. That function is the one reader of content schema pointers, it can resolve nothing but content, and the mistake is in the schema, so it warns whether or not the type loaded entries.
- **Decided:** edges. Only `plan:relationships/table-foreign-keys` is required: §2 cannot read `Implemented` before the integer-id miss and the foreign keys are fixed, and `include.ts` should move that plan's lookup normalisation rather than race it. `plan:extensions/server-module-required` may move `buildMountSpecs` ahead of section loading, so the view is attached at step 6c whichever lands first. `plan:extensions/connector-table-paths` changes `openTable`'s signature and `loadProjectEntry`'s cache entry; this plan calls neither signature it changes.

## Implementation

**`packages/schema`**

1. New `src/reference-view.ts`, exported as `./reference-view` in `package.json`, header citing relationships.md §2 and `@docs framework/site/relationships`:
   - `RefTarget { section: string; name: string }`, `ReferencedEntry { id: string; data: Record<string, unknown> }`, `ReferenceView = Record<string, Record<string, ReferencedEntry[]>>`.
   - `parseRelationshipPointer(pointer: unknown): RefTarget | null`: tests the string against `new RegExp(relationshipRefSchema.properties.$ref.pattern)` (`defs/field-schema.schema.ts`, one grammar with the core schema) and splits `pointer.slice(2)` at its one `/`.
   - `relationshipTargets(sectionValue: unknown): RefTarget[]`: a walk of plain objects and arrays collecting every string `$ref` that parses, deduplicated by `section/name` in first-seen order.
   - `buildReferenceView(targets, loaded: Record<string, unknown>, projectConfig?: ProjectConfig): ReferenceView`: per target, `loaded[section]` read as a `Map` (`get(name)`) or a record (`[name]`); skipped unless an array whose every item has a string `id` and a plain-object `data`. Items are grouped by `id`; the kept one has `_meta.locale === resolveI18n(projectConfig).i18n?.defaultLocale` (`./locale.ts`), else is the first. Output `{ id, data }`, where each top-level `data` value that is itself such an item, or an array element that is one, becomes its `id`.
   - `findReferencedEntry(view, target, id): ReferencedEntry | undefined`.

**`extensions/connector`**

2. New `src/include.ts`: `ReferenceSource = ReferenceView | (() => ReferenceView | Promise<ReferenceView>)`; `includeFields(raw: unknown): string[]` (a comma-separated string or an array of strings, trimmed, empties dropped; else `[]`); `expandIncludes(db, plan, tables, kind, fields, rows, references?: ReferenceSource)`, the `worker.ts` body moved as the prerequisite left it, plus one branch: a to-one spec (`!spec.manyRef`) whose `ref.section !== "data"` resolves the source once per call (`typeof references === "function" ? await references() : (references ?? {})`), maps `view[section]?.[name]` by `id`, and sets `row[field]` to the match for `String(row[spec.column])`, or `null`.
3. `src/worker.ts`: imports both from `./include.ts`; `DataMountOptions.references?: ReferenceSource` ("the entries of file-based sections this section references, handed over by the host; relationships.md §2"); `listRows` and `getRow` pass `options.references` and `includeFields(params.get("include"))`; the header's `include=` line names content refs.
4. `src/table-node.ts`: `queryTable` and `getEntry`, inside the `try` before `db.destroy()`, run `expandIncludes(db, plan, tables, kind, includeFields(config.include), rows, () => buildReferenceView(relationshipTargets(tables), config._project ?? {}, config._project?.config))`; `getEntry` wraps its one row. Header: `include` expands as the data routes do.
5. `src/columns.ts`: `parseRefPointer` returns `parseRelationshipPointer(pointer)`, and `RefTarget` is re-exported from `@jxsuite/schema/reference-view`, so the connector, hosts and parser read one grammar.
6. `TableQuery.class.json` and `TableEntry.class.json`: `include`'s description becomes "Reference fields to expand: to-one table refs (the row), to-one content refs (the entry's id and data), and junction to-many fields".

**`extensions/parser`**

7. `src/content-loader.ts`, `resolveContentTypeRefs`: per content type with `schema.properties`, and before the `entries` guard, each field whose `parseRelationshipPointer(def.$ref) ?? parseRelationshipPointer(def.items?.$ref)` names a section other than `SECTION_KEY` warns `Content relationships: "${name}" field "${field}" references "${pointer}", which is not a content type. Content loads at build time and can reference only content entries, so the stored value is left as is; put the reference on the table, or query the table with TableQuery.` and is skipped. Content targets come from the same parse (`target.name`), replacing `refTargetName` and `CONTENT_REF_PREFIX`.

**`packages/server`**

8. `src/resolve.ts`: export `projectContext(projectRoot)`, the current `loadProjectContext` renamed (internal callers follow).
9. `src/jx-mounts.ts`, `buildRuntime`: per mount entry, `targets = entry.project ? relationshipTargets(config[entry.project.key]) : []`; when non-empty the options gain `references`, a function that awaits `projectContext(projectRoot)` and returns `buildReferenceView(targets, context, config)` (`{}` without a context), memoized in a `WeakMap` keyed by the context object, which `resolve.ts` replaces exactly when it reloads. Header bullet: the data mount reads referenced entries from the resolve proxy's project context.

**`packages/compiler`**

10. `src/site/site-build.ts`, step 6c, after `buildMountSpecs` returns: a private `attachReferenceViews(mounts, activeMounts, projectConfig, sections)` matches each spec to its entry by `className` (`classDef.title ?? name`), builds `buildReferenceView(relationshipTargets(projectConfig[entry.project.key]), sections, projectConfig)` from the step-3b `sections`, and when non-empty returns the spec with `options: { ...options, references: view }`; it logs `  Inlined referenced entries: <section>/<name> (<count>), …`. A mount with no pointer keeps its options byte-identical, so existing worker assertions hold.

**Integration contract.** Once this lands: `@jxsuite/schema/reference-view` exports `RefTarget`, `ReferencedEntry`, `ReferenceView`, `parseRelationshipPointer`, `relationshipTargets`, `buildReferenceView` and `findReferencedEntry`, with the projection above. The data mount's `options.references` is present in the dev server and the generated worker whenever the `data` section holds any pointer, to-one or to-many, into a loaded file-based section, and contains every targeted entry. `expandIncludes` (`include.ts`) is the only include expansion, and the node path builds its view from `_project`. `plan:relationships/reference-validation` checks table → content existence on write with the same source and `findReferencedEntry`, and decides whether the owner console (`packages/server/src/data-api.ts`, which receives no view) joins it.

## Tests

`bun test --isolate --coverage` from each workspace, then `bun scripts/check-coverage-manifest.ts <workspace>`. Floors (`bunfig.toml`): schema 0.99/0.99, connector 0.99/0.99, parser 0.987/0.975, server 0.96/0.95, compiler 0.982/0.98. Both new source files ship with tests; ratchet a floor only if that workspace's worst file rises.

- `packages/schema`, new `tests/reference-view.test.ts`:
  - `parseRelationshipPointer accepts the RelationshipRef grammar and nothing else`: `#/content/authors` parses; `#/$defs/X`, `#/content`, `content/x`, `42` are `null`; each sample agrees with the schema pattern.
  - `relationshipTargets collects to-one and to-many pointers from a section, once each`.
  - `buildReferenceView keeps id and data and drops body, $children and _meta`.
  - `nested references collapse to ids, so a cyclic graph serializes` (two entries referencing each other; `JSON.stringify` succeeds).
  - `a localized collection keeps one entry per id, the default locale's, else the first`.
  - `an unloaded section, an unknown name, or a value that is not entries is skipped` (a `data` record of table definitions among them).
  - `a Map and a plain record load alike`; `findReferencedEntry finds by id and misses with undefined`.
- `extensions/connector`:
  - `tests/worker.test.ts`, a `writer: { $ref: "#/content/authors" }` field and a to-many `topics` content field on `comments`: `a to-one content include resolves from options.references`; `the references function is called only when an include names a content field` (a counting function: 0 for `include=author`, 1 for `include=writer`); `a missing content id resolves to null and a to-many content field keeps its ids`.
  - `tests/table-state.test.ts`, "node-side resolution": `queryTable and getEntry return the rows the data route returns for the same include`. One sqlite file seeded through `handleDataRequest` (as the compiler bake test seeds), `_project.content` a `Map` literal; `queryTable({ include: ["author", "tags", "writer"] })` deep-equals `GET /_jx/data/comments?include=author,tags,writer`. Import `table-node.ts` sequentially, never two in-flight dynamic imports of it (CLAUDE.md).
  - `tests/columns.test.ts` passes unchanged: `parseRefPointer` keeps its contract.
- `extensions/parser`, `tests/content-loader.test.ts`: `warns once per field on a pointer outside the content section, with or without entries` (`#/data/users` to-one, `#/data/tags` to-many, a type with no entries; values untouched); the legacy `#/contentTypes/` case also asserts its warning.
- `packages/server`, `tests/jx-mounts.test.ts`: a second temp project (the shared fixture's section-key assertion stays as is) enabling `@jxsuite/parser` and `@jxsuite/connector`, with `content/authors/jane.md` and a `comments` table carrying `writer`: `a to-one content include resolves through the resolve proxy's project context` (POST `writer: "jane"`, then `GET ?include=writer` answers `{ id: "jane", data: { name: "Jane" } }`).
- `packages/compiler`, `tests/connector-mounts.test.ts`: `the worker inlines the referenced content entries' id and data, and nothing else`: `buildSite` over parser content (`authors/jane.md` with a distinctive frontmatter name and body sentence, plus an unreferenced `posts` type) and a table referencing `authors`; `dist/worker.js` contains the name, not the body sentence, and no `posts` entry. Timeout `30_000`, like its neighbours.

## Specs & docs

relationships.md §2, in place (replace whatever of the marker the prerequisite left):

- The marker becomes `> **Status: Implemented.**` followed by its evidence, one sentence per path: content → content is `resolveContentTypeRefs` (`extensions/parser/src/content-loader.ts`) inside `Content.projectData`, which also warns on a content schema pointer into any other section; `?include=` is expanded by one function, `expandIncludes` (`extensions/connector/src/include.ts`), for the `/_jx/data` routes and for `TableQuery` and `TableEntry` resolved under node (`extensions/connector/src/table-node.ts`); its content lookups read the reference view (`packages/schema/src/reference-view.ts`) that the dev server (`packages/server/src/jx-mounts.ts`) and the site build (`packages/compiler/src/site/site-build.ts`) hand the data mount, and that the node path builds from `_project`; column typing and foreign keys cite what the prerequisite shipped (`planTable` in `extensions/connector/src/columns.ts`, `extensions/connector/src/ddl.ts`).
- table → content, Resolution: "Request-time: data routes accept `?include=<field,...>`; the mount resolves the entry from the reference view its host builds from `_project.content`. v1 supports `include` for to-one only; a to-many content field keeps its id array."
- table → table, Resolution: "Request-time: `?include=` expands to-one by a second query on the referenced ids. To-many uses a junction table (§3)." The Storage cells stay as the prerequisite left them.
- content → table: "Parser validation warns on `#/data/...` refs in content schemas." becomes "The parser warns on a content schema field whose pointer names any section other than `content`, naming the content type, field and pointer, and leaves the stored value as is."
- A paragraph after the matrix: "`include` reads the same on every path: the data routes and a `TableQuery` or `TableEntry` resolved under node (a compiler-timing bake, the dev server's resolve proxy) return the same rows. A table → content target is `{ id, data }`: the entry's frontmatter without its body, its own references left as ids, and for a localized collection the default locale's translation. The host hands the data mount the entries of every content type its section points at, as the `references` mount option (extensions.md §11): the site build inlines them into the generated worker, and the dev server builds them from the project context its resolve proxy loads." (Adjusted if the Open decision chooses whole entries.)
- Fragment: `bun run spec:change relationships.md minor -m "§2: include resolves a table's content references from a reference view the host hands the data mount, TableQuery and TableEntry expand include under node as the data routes do, and the parser warns on a content schema pointer outside the content section."`

extensions.md §11, the `options` bullet (its marker is `plan:extensions/server-module-required`'s and is untouched): "plus host-provided values (the section manifest, resolved class constructors)" becomes "plus host-provided values: the section manifest, resolved class constructors, and `references`, the entries of every file-based section the mount's own section points into ([relationships.md](./relationships.md) §2), a snapshot in the generated worker and a function over the loaded project context in the dev server. `references` is `projectData` output and never carries a secret." Fragment: `bun run spec:change extensions.md minor -m "§11: a mount whose section references file-based entries receives them as the references option, inlined by the site build and read from the loaded project context by the dev server."`

Docs (no em dashes):

- `docs/framework/site/relationships.md` (`spec:` `relationships.md#2`): "Beyond content" says a table field pointing at a content type comes back, when a query or entry names it in `include`, as the entry's `id` and `data` (frontmatter, its own references as ids), identically in a baked page and a live fetch, and that loading warns about a content schema field pointing at a table, naming the type and field. `code:` gains `extensions/connector/src/include.ts`.
- `docs/studio/data/tables.md` (`code:` `worker.ts`, `TableQuery.class.json`): the reference paragraph says the row stores the id and `include` brings the entry back; the **include** bullet says a table target returns the whole row, a content target its `id` and frontmatter, a to-many content reference stays a list of ids, and a baked page and a live fetch agree. `code:` gains `include.ts` and `table-node.ts`.
- `docs/extending/extensions/server.md` (`spec:` `extensions.md#11`): the `options` bullet names `references`, and "identifiers only" becomes "identifiers and `projectData` output only, never secret values".
- `docs/extending/extensions/security.md` (`spec:` `extensions.md#11`): the line-30 sentence says mount `options` carry identifiers plus the content a mount references, `projectData` output that holds no secret.
- `docs/extending/embedding/dev-server.md` (`code:` `jx-mounts.ts`, `resolve.ts`): the mounts paragraph adds that the data mount reads referenced content from the resolve proxy's project context.
- Unchanged: `docs/studio/logic/data-sources.md` (its `include` sentence stays true), `docs/framework/build.md`, `docs/extending/extensions/connectors.md`, `docs/extending/extensions/capabilities.md`, `docs/framework/site/content-collections.md`.

## Acceptance

- `bun test --isolate --coverage` and `bun scripts/check-coverage-manifest.ts <dir>` pass in `packages/schema`, `extensions/connector`, `extensions/parser`, `packages/server` and `packages/compiler`; `bun run typecheck` and `bun run lint` are green.
- In a scratch project enabling `@jxsuite/parser` and `@jxsuite/connector` (a `sqlite` connection, `content/authors/jane.md` with `name: Jane`, a public `comments` table with `writer: { "$ref": "#/content/authors" }`): under `jx dev`, a comment posted with `writer: "jane"` reads back from `GET /_jx/data/comments?include=writer` with `writer` `{ "id": "jane", "data": { "name": "Jane" } }`, and a page whose `TableQuery` has `timing: "compiler"` and `include: "writer"` bakes the same object. With `build.adapter: "cloudflare-workers"`, `jx build` writes a `dist/worker.js` holding `Jane` and not the entry's body text.
- Adding `"owner": { "$ref": "#/data/users" }` to the `authors` schema makes `jx build` print the warning naming `authors` and `owner`.
- `bun run plans:status --spec relationships` no longer lists `relationships.md#2`.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:spec-release` are green.
