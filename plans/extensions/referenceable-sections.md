---
status: drafted
disposition: implement
claims:
  - extensions.md#9
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts/screenshots/fixtures
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: S
---

# The registry names the referenceable sections, and every generated project schema refuses a relationship pointer into any other

## Context

`specs/extensions.md` §9, line 424:

> **Status: Partial.** Section ownership, key exclusivity, `projectData` into `_project[<key>]`, discriminator dispatch and the fragment-read entry shape ship (`packages/schema/src/extension-registry.ts`, `packages/compiler/src/site/project-sections.ts`). `referenceable` is validated and declared by `Content` and `Data` but read by no host: `parseRefPointer` (`extensions/connector/src/columns.ts`) accepts a pointer into any section, and the studio's reference control hard-codes `#/content/<type>` (`packages/studio/src/ui/schema-form.ts`).

The table says `referenceable` "opts the section's named entries into the relationships vocabulary", and relationships.md §1 (line 18) scopes the pointer to "any section whose owning class declares `project.referenceable: true`". Nothing enforces either sentence. Verified at the census commit:

- **The flag is typed and declared, never read.** `ProjectBlock` (`packages/schema/src/format-registry.ts`), `ExtensionProjectBlock` (`packages/protocol/src/types.ts`) and `projectBlockDefSchema` (`packages/schema/defs/class-def.schema.ts`, whose description, "Whether section entries can be referenced from documents", misstates it) carry it. `extensions/parser/src/Content.class.json` and `extensions/connector/src/Data.class.json` declare it `true`; `auth`, `connections`, `feed` and `search` do not. Tests only read it back (`packages/schema/tests/extension-registry.test.ts`, `extensions/parser/tests/content-loader.test.ts`, `extensions/connector/tests/extension-manifest.test.ts`).
- **The schema accepts any section.** `relationshipRefSchema` (`packages/schema/defs/field-schema.schema.ts`, published as `$defs.RelationshipRef` in `packages/schema/schemas/project.core.schema.json`) matches `^#/[A-Za-z][A-Za-z0-9_-]*/[A-Za-z0-9._-]+$`, and `emitProjectSchema` (`packages/schema/src/project-schemas.ts`) puts it unchanged into every entry document's `$defs.Fields` union (for example `scripts/screenshots/fixtures/data/project.schema.json`). `composeProjectSchemas` receives only fragment refs per extension (`ExtensionFragmentRefs`), so today it cannot know the flags.
- **Composition has one in-repo entry point.** `composeEntryDocuments` (`packages/compiler/src/site/schema-command.ts`) builds the registry and calls `composeProjectSchemas`; `jx schema`, `jx validate` (through `readBundledProjectSchemas`), the dev server's `GET /__studio/project-schemas` (`packages/server/src/studio-api.ts`) and the desktop's RPC (`packages/desktop/src/project-session.ts`) all reach it. The cloud session composes outside this repository.
- **project.json is validated only against the entry document.** `validateProjectFile` (`packages/schema/src/validate-project.ts`) runs under `jx validate`, and editors bind the same file (extensions.md §5.4). No build or server path validates project.json.
- **Load- and request-time readers are shape parsers.** `parseRefPointer` accepts any section; the connector's mount receives the raw `sections` config and no registry. `CONTENT_REF_PREFIX` and `refTargetName` (`extensions/parser/src/content-loader.ts`) read `#/content/` only. Studio's `referenceTarget` (`ui/schema-form.ts`) and the grid's `referenceTargetType` (`grid/cell-popovers.ts`) read `#/content/` only.
- **The flag already reaches Studio.** `buildExtensionsPayload` (`packages/compiler/src/site/format-host.ts`) puts each class's whole `project` block on `contributions[].project`.
- **Nothing committed uses a pointer.** `git grep -n '#/content/\|#/data/' -- '*project.json'` prints nothing, so narrowing refuses nothing that ships.

Corrections to the stub: `extensions/connector` does not change (Decisions), and the Studio readers are `plan:relationships/studio-reference-picker`'s, which reads the flag from the payload this plan leaves as it is.

## Outcome

- extensions.md §9 → Implemented. `ExtensionRegistry.referenceableSections()` and `isReferenceableSection()` answer which sections a pointer may target; every generated `project.schema.json` narrows the field union's relationship member to those section keys, so `jx validate` and every editor bound to the entry document refuse a pointer into any other section.
- relationships.md §1's scoping sentence holds. §1 carries no marker; it gains one sentence naming the narrowing.
- relationships.md §5 (Studio's pickers) stays Partial, owned by `plan:relationships/studio-reference-picker`.
- extensions.md stays Partial (§3, §5.4, §6.1, §7, §8, §8.1, §8.4, §8.6, §9.1, §9.2, §10, §11, §11.1 and §12 remain open), so nothing graduates.

## Decisions

- **Decided:** the rule is enforced in the generated entry document's field union, and nowhere else, because extensions.md §5.3 makes the generator "the single aggregation party" for cross-extension unions and enums, because project.json is validated only against that document (so `jx validate`, VS Code and Studio's Monaco get the refusal with no new code path), and because the load- and request-time readers run without a registry: the connector's mount gets raw `sections`, so a check in `parseRefPointer` would need a new mount input to restate a rule the entry document already states. `parseRefPointer`, `CONTENT_REF_PREFIX` and `refTargetName` stay shape parsers, and `jx build` does not start validating project.json.
- **Decided:** the narrowed member is `{ "allOf": [{ "$ref": <core RelationshipRef> }], "description": …, "properties": { "$ref": { "pattern": "^#/(?:content|data)/" } } }`, because `allOf` keeps a `$ref` off a node with siblings (the VS Code shallow-merge hazard extensions.md §5.2 names), the core def stays the one statement of the pointer grammar, and the pattern names the permitted sections in the error an author sees. With no referenceable section enabled, `"$ref"` becomes `false` under `properties`, with a description saying so. Keys outside the pointer's key grammar (`[A-Za-z][A-Za-z0-9_-]*`) are left out, since no pointer can address them, so nothing needs regex escaping.
- **Decided:** a section is referenceable only when `project.referenceable === true`, through one exported predicate, `isReferenceableSection`, which the registry method uses and Studio's picker applies to `contributions[].project`. The table's default is `false`; a third-party class file is not schema-validated when the registry loads it; and Studio holds the payload rather than a registry, so a shared predicate is the one definition both sides can call. No payload change.
- **Decided:** a pointer into a section whose extension the project does not enable (`#/data/users` in a parser-only project) is refused like any other non-referenceable key, because the entry document knows the enabled extensions and validates exactly, the stance §5.3 already takes for `$paths` sources.
- **Decided:** the narrowing is by section key only. Whether `<name>` names an existing content type or table is not checked in the schema, because entry names live in project.json values rather than in `extensions`, and an enum of them would go stale on every new content type; `resolveContentTypeRefs` already warns on an unknown target type at load time.
- **Open:** is the section-key input required or optional on `composeProjectSchemas`? Recommendation: optional, and omitted means today's member (the core `RelationshipRef`, any section), because `@jxsuite/schema` is at 2.2.0 and a required field breaks the cloud session's composer, which lives outside this repository, at compile time, forcing a major release; the omission degrades to the under-validation §5.3 and §5.4 already accept, and every in-repo host passes the keys through `composeEntryDocuments`. The cost is that a cloud composer nobody updates keeps accepting a pointer into any section, and §5.5 says so.

## Implementation

1. **`packages/schema/src/extension-registry.ts`**:
   - `export function isReferenceableSection(project: { referenceable?: unknown } | null | undefined): boolean`, returning `project?.referenceable === true`. Doc comment: extensions.md §9 (default `false`), relationships.md §1, "the one definition the registry and Studio's reference picker share", and `@docs extending/extensions/project-sections`.
   - `ExtensionRegistry.referenceableSections(): FormatEntry[]`, returning `this.projectContributions().filter((entry) => isReferenceableSection(entry.project))`, beside `projectContributions()`. Doc: the sections a relationship pointer may target, in declaration order.
2. **`packages/schema/src/project-schemas.ts`**:
   - `ProjectSchemaInputs` and `ComposeProjectSchemasInputs` gain `referenceableSections?: readonly string[]`, documented as the keys of `ExtensionRegistry.referenceableSections()`; omitted, the union keeps the core `RelationshipRef`.
   - A private `relationshipFieldMember(keys?: readonly string[])`: `undefined` returns `{ $ref: `${PROJECT_CORE_SCHEMA_ID}#/$defs/RelationshipRef` }` (today's member); otherwise it filters `keys` by `/^[A-Za-z][A-Za-z0-9_-]*$/` and returns the `allOf` member from Decisions, with `description` "A relationship reference into one of this project's referenceable sections: content, data (specs/extensions.md §9)." and `properties.$ref.pattern` `^#/(?:${keys.join("|")})/`, or, for an empty list, `properties: { $ref: false }` and "No enabled extension declares a referenceable section, so this project has no relationship targets (specs/extensions.md §9)." Keys sorted alphabetically inside each object, as the emitter's are.
   - `emitProjectSchema` uses it as the second `Fields.anyOf` member; `composeProjectSchemas` passes `referenceableSections` through. Add one bullet to the module header naming the narrowing. The flattener needs no change: the member's `allOf` ref is canonical and rewrites to `#/$defs/project-core-v2/$defs/RelationshipRef`, and `properties.$ref` is a subschema position, as in the core def.
3. **`packages/compiler/src/site/schema-command.ts`**, `composeEntryDocuments`: pass `referenceableSections: registry.referenceableSections().flatMap((entry) => (entry.project ? [entry.project.key] : []))`, with a comment citing extensions.md §9. Every in-repo host inherits it.
4. **`packages/schema/defs/class-def.schema.ts`**: `projectBlockDefSchema.properties.referenceable.description` becomes "Whether relationship pointers (#/<key>/<name>, specs/relationships.md §1) may target this section's entries. Default false."
5. **Regenerate**: `bun run schema:sync` rewrites the core artifacts that embed the class definition (`packages/schema/schema.json`, `class-schema.json`) and every root's `project.schema.json` and `document.schema.json`; commit them with the change (never by hand). The data fixture gets `^#/(?:content|data)/`, jxsuite.com `^#/(?:content)/` (search is not referenceable), and the extension-less roots (`packages/studio`, `packages/ui`, `sites/test-blank`, the counter and statements fixtures) `"$ref": false`.
6. Tests, specs and docs as below. Delete this file in the landing pull request, and remove it from `plan:relationships/studio-reference-picker`'s `requires` if that plan has drawn the edge by then, re-reading its integration assumptions.

**Integration contract.** Once this lands, `@jxsuite/schema/extension-registry` exports `isReferenceableSection(project)` (true only for a literal `true`) and `ExtensionRegistry.referenceableSections()` (declaration order). Studio code deciding which sections a reference picker offers filters `getExtensions()` contributions with `isReferenceableSection(contribution.project)` and needs no payload change, which is what `plan:relationships/studio-reference-picker` relies on. Every entry document composed in this repository refuses a relationship pointer whose section key is not a referenceable section of an enabled extension, so a picker writing only offered sections always writes a valid pointer. The shipped default union and `parseRefPointer` still accept any section, so `plan:relationships/cross-domain-references` still owns the parser's warning for a `#/data/...` pointer in a content schema: with the connector enabled, `data` is referenceable and the schema accepts it.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`):

- `tests/extension-registry.test.ts`, in `ExtensionRegistry accessors`:
  - `referenceableSections lists only sections declaring referenceable: true`: its own registry over a manifest with three project classes, `Tables` (`referenceable: true`), `Conns` (no flag) and `Odd` (`referenceable: "yes"`); `referenceableSections()` maps to `["data"]` while `projectContributions()` holds all three. `standardFiles()` stays as it is, so the existing `["Tables"]` assertion is untouched.
  - `isReferenceableSection is true only for a literal true`: `true` for `{ key: "k", referenceable: true }`; `false` for `{ key: "k" }`, `{ key: "k", referenceable: false }`, `{ key: "k", referenceable: "true" }`, `null` and `undefined`.
- `tests/project-schemas.test.ts`, new describe `emitProjectSchema narrows relationship refs to referenceable sections`, compiling with `makeAjv()` as the existing describe does:
  - `without keys the union keeps the core RelationshipRef`: `$defs.Fields.anyOf[1]` equals `{ $ref: "…core/v2#/$defs/RelationshipRef" }`.
  - `a pointer into a listed section validates and into any other fails`: `referenceableSections: ["content"]`; `author: { $ref: "#/content/authors" }` is valid; `{ $ref: "#/auth/users" }` is invalid with an error whose `keyword` is `pattern` and whose `instancePath` ends `/author/$ref`; to-many `items: { $ref: "#/connections/main" }` is invalid too.
  - `an empty list refuses every pointer and keeps plain fields`: `referenceableSections: []`; `#/content/authors` is invalid, `{ type: "string" }` valid.
  - `keys outside the pointer grammar are left out`: `["content", "not a key"]` yields the pattern `^#/(?:content)/`.
  - `the shipped default still accepts any section`: `{ $ref: "#/auth/users" }` validates against `generateProjectFieldsSchema()` registered beside `generateProjectCoreSchema()`.
- `tests/project-schemas.test.ts`, in `composeProjectSchemas`: `referenceable keys reach the flattened union`: compose with `referenceableSections: ["content", "data"]`; the flattened `project.$defs.Fields.anyOf[1].allOf[0].$ref` is `#/$defs/project-core-v2/$defs/RelationshipRef`, its pattern is `^#/(?:content|data)/`, and the document compiles under ajv and rejects `#/auth/users`.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/schema-command.test.ts`, new describe `the relationship member follows the registry`, in its own temp root: `extensions: ["@jxsuite/parser", "./owners"]`, where `./owners` ships `Owned.class.json` (`project: { key: "owned" }`) and `Picks.class.json` (`project: { key: "picks", referenceable: true }`). After `writeProjectSchemas`, `$defs.Fields.anyOf[1].properties.$ref.pattern` is `^#/(?:content|picks)/`.
- `tests/validate-command.test.ts`, `reports a relationship pointer into a section that is not referenceable`: rewrite the fixture's `project.json` with `content: { posts: { source: "./content/posts/", schema: { properties: { owner: { $ref: "#/connections/main" } } } } }`; `validateProjectTree` is invalid, and the `project.json` issue holds an error with `instancePath` `/content/posts/schema/properties/owner/$ref` and `keyword` `pattern`. With `#/content/posts` the tree is valid. Restore the fixture in `finally`, as the neighbouring project.json case does. The committed entry document it reads comes from `writeProjectSchemas` in `beforeAll`, so it already carries the narrowing.

**Coverage.** No source file is added, so the manifest check is unaffected. The new predicate, method and member builder are measured under `packages/schema` (`lines = 0.99, functions = 0.99` per file in its `bunfig.toml`) and every branch has a case above; `schema-command.ts` gains one expression under `packages/compiler` (`lines = 0.982, functions = 0.98`). No worst file is expected to rise, so no ratchet unless the run shows one.

## Specs & docs

**`specs/extensions.md`**, in place:

- §9: the marker becomes `> **Status: Implemented.**`, the bare form §8.5 uses. The table's `referenceable` cell ends "…relationships vocabulary ([relationships.md](./relationships.md)): a relationship pointer may target the section only when this is `true`." After the table, before "The section's **value schema is not duplicated here**", add: "**`referenceable` is enforced where the project is composed.** A relationship pointer `#/<key>/<name>` ([relationships.md](./relationships.md) §1) may target a section only when its owning class declares `referenceable: true`; an absent or non-boolean value is `false`. The registry reports those sections (`referenceableSections()`), and the generated entry document (§5.2) narrows the field union's relationship member to exactly their keys, so `jx validate` and every editor bound to the entry document report a pointer into any other section, including one whose extension the project does not enable. Hosts that read a pointer at load or request time (the parser's content references, the connector's columns) parse its shape and do not check the section again. The flag reaches Studio unchanged on each contribution's `project` block."
- §5.2: in the `project.schema.json` example, the second `Fields.anyOf` member becomes `{ "allOf": [{ "$ref": "#/$defs/project-core-v2/$defs/RelationshipRef" }], "properties": { "$ref": { "pattern": "^#/(?:content)/" } } }` (description omitted, as the embeds are).
- §5.3: the fields row's last cell becomes "Default: core `JxFieldSchema` + `RelationshipRef`. Entry narrows `RelationshipRef` to the referenceable sections of the enabled extensions (§9) and adds extension field extras (e.g. connector column shapes)." If `plan:extensions/publish-canonical-schema-urls` has already rewritten the extras example, keep its wording and add only the narrowing clause. In the paragraph after the table, "— extension extras are the only entry-exclusive shapes, and the entry is where they are checked exactly." becomes ". The entry differs from the defaults in two places, and checks both exactly: it adds extension extras, and it narrows `RelationshipRef` to the project's referenceable sections (§9), which a default cannot know, so against the defaults a pointer into any section passes."
- §5.5: "Every host supplies only the loader and the refs; none supplies the algorithm." becomes "Every host supplies only the loader, the refs and the section keys its registry reports as referenceable (§9); none supplies the algorithm." If the open decision lands as recommended, append: "A host that passes no keys gets the shipped default's `RelationshipRef`, which under-validates (§5.3) rather than refusing a valid pointer."

**`specs/relationships.md`** §1, in place: after the paragraph ending "(extensions.md §5.3).", add "In that entry schema the relationship member accepts only the keys of the referenceable sections the project enables (extensions.md §9), so `jx validate` and editors report a pointer into any other section." No marker change.

**Fragments:**

- `bun run spec:change extensions.md minor -m "§9: the registry reports which project sections are referenceable, and the generated entry document narrows the field union's relationship member to their keys, so jx validate and editors refuse a relationship pointer into any other section."`
- `bun run spec:change relationships.md minor -m "§1: the generated entry schema accepts a relationship pointer only into a referenceable section the project enables."`

**Docs** (no em dashes). `bun run docs:sync` names `docs/extending/extensions/project-sections.md` and `docs/extending/extensions/search.md` (`spec:` cites `extensions.md#9`), `docs/framework/site/relationships.md` (`relationships.md#1`), `docs/extending/extensions/schema-composition.md` (`code:` lists `project-schemas.ts`, `schema-command.ts` and `sites/jxsuite.com/project.schema.json`), `docs/extending/extensions/anatomy.md` and `classes.md` (`extension-registry.ts`), `docs/framework/build/cli.md` and `docs/framework/agents.md` (`schema-command.ts`, `schema.json`), and `docs/framework/agents/machine-readable.md` and `authoring-rules.md` (the regenerated core artifacts).

- `docs/extending/extensions/project-sections.md`: the `referenceable` row's meaning ends "…relationships vocabulary ([Relationships](/docs/framework/site/relationships)): a relationship pointer may target the section only when this is `true`." After the table add: "The generated `project.schema.json` enforces it. Its field union accepts a relationship pointer only into a referenceable section of an extension the project enables, so `jx validate` and your editor report `{ "$ref": "#/auth/users" }` as an error. Run `jx schema` after changing `extensions` so the list is current." Add `packages/schema/src/extension-registry.ts` to `code:`, matching the new `@docs` tag.
- `docs/extending/extensions/schema-composition.md`: the example's second `Fields` member as in extensions.md §5.2; the fields row's last cell becomes "Core `JxFieldSchema` + `RelationshipRef`; the entry narrows `RelationshipRef` to the project's referenceable sections and adds extension field extras."; and after the paragraph beginning "An entry embed **shadows** the shipped default", add "The field union is narrowed as well: its relationship member accepts only the section keys whose owning class declares `referenceable` (see [Project sections](/docs/extending/extensions/project-sections)). A default cannot know those, so it accepts a pointer into any section."
- `docs/framework/site/relationships.md`, "Beyond content": after its first sentence add "A pointer into any other section, or into a section whose extension the project does not enable, fails validation, and `jx validate` and your editor report it."
- `search.md`, `anatomy.md`, `classes.md`, `cli.md`, `agents.md`, `machine-readable.md` and `authoring-rules.md`: no change. None states which sections a pointer may target, and the regenerated artifacts they list change only a description.

No spec graduates.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#9`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `bun run schema:verify` and `bun run schema:validate-all` pass after `bun run schema:sync`.
- `grep -n '"pattern": "^#/(?:' scripts/screenshots/fixtures/data/project.schema.json sites/jxsuite.com/project.schema.json` prints `^#/(?:content|data)/` and `^#/(?:content)/`; `grep -n '"\$ref": false' packages/ui/project.schema.json` prints one line.
- `git grep -n 'referenceableSections\|isReferenceableSection' -- packages` lists the definitions in `extension-registry.ts`, the input in `project-schemas.ts`, the call in `schema-command.ts`, and the tests.
- `sed -n '/^## 9\. /,/^### 9\.1 /p' specs/extensions.md` shows `> **Status: Implemented.**` as the first blockquote.
- By hand: in `packages/starters/sites/blog/project.json`, add `"owner": { "$ref": "#/search/x" }` to a content type's `schema.properties`; `bun packages/compiler/bin/jx.js validate packages/starters/sites/blog` fails naming `/content/<type>/schema/properties/owner/$ref` and the pattern, and passes with `#/content/<type>`. Open the same file in Studio's code editor and see the diagnostic on `$ref`. Revert.
- `bun test --isolate --coverage` passes from `packages/schema` and `packages/compiler` with the cases above and no per-file threshold failure.
