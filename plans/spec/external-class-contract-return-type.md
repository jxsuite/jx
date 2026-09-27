---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/server
  - packages/desktop
  - packages/studio
  - extensions/parser
  - packages/schema
size: M
---

# Tooling reads a class's `returnType`: one extractor serves both Studio hosts, and Studio offers any class whose `resolve()` returns an array as a repeater source

## Context

The `returnType` half of `spec.md` §12.3 and §12.4, split from `plan:spec/external-class-contract` while detailing. It claims nothing: that plan owns both markers and requires this one, which removes the `returnType` clause from each marker and leaves the flip to it. It has no prerequisite, so it can land before the compiler work that plan waits for.

`specs/spec.md` §12.3, line 1373, the clause this plan closes:

> … and no tool reads `returnType`: the Studio repeater check (`packages/studio/src/editor/convert-to-repeater.ts`) reads a `returns` key that `packages/server/src/studio-api.ts` copies from `methods.resolve.returns`, which only `ContentCollection.class.json` declares.

`specs/spec.md` §12.4, line 1404, the sentence this plan closes:

> "Tooling uses this metadata" does not hold: nothing reads `returnType` except `packages/compiler/src/targets/compile-class.ts`, which only sniffs it for an async prefix (§12.3).

Re-verified on 2026-09-27, and wider than the markers say:

- **The desktop app, the only end-user Studio, reads nothing.** `packages/desktop/src/project-session.ts` carries its own `extractStudioSchema` (with its own `ClassJsonDef` and `StudioSchema` types) that surfaces no return type at all, so `fetchPluginSchema` there never answers with one. The dev server's copy in `studio-api.ts` differs from it only in that `returns` line and in how it types an absent description.
- **Studio never asks about a manifest class.** `fetchPluginSchema` (`packages/studio/src/services/code-services.ts`) takes its source from `def.$src` or `projectConfig.imports[$prototype]` and returns `null` otherwise. The Data panel adds an extension's classes with no `$src` (`extensionStateClasses` in `signals-panel.ts`: "the registry resolves them"), and every shipped class whose `resolve()` returns an array is one: `TableQuery` and `Search` (`{ "type": "array" }`), `MarkdownCollection` and `Csv` (a `$ref` into `$defs/returnTypes` naming an array), and `ContentCollection` (the `returns` key). The enabled extensions' payload already carries each class's resolved descriptor path (`ext.classes[].path`, read through `loadExtensions()` in `packages/studio/src/format/format-host.ts`; `contentCollectionSrc` in `page-params.ts` uses it the same way).
- **A `$ref` is not followed.** `MarkdownCollection`'s `resolve` declares `{ "$ref": "#/$defs/returnTypes/MarkdownCollection" }`, the form §12.3 recommends; `schema.returns.type === "array"` could never see through it.
- **Inheritance is refused by test.** `studio-api.test.ts` asserts "child does not inherit parent returns (only own resolve matters)", although a subclass inherits `resolve()` itself.
- `returns` is declared by `ContentCollection.class.json` alone, read by `extractStudioSchema` (`studio-api.ts`), typed in `ClassJsonMethod` (`packages/server/src/types.ts`) and `PluginSchema` (`code-services.ts`), and asserted by `studio-api.test.ts` and `convert-to-repeater.test.ts`. No spec or docs page specifies it; `docs/framework/concepts/data-prototypes.md` says methods "may declare `returns` schemas".
- **§12.4's example does not validate** against the class schema (`classDefSchema` in `packages/schema/defs/class-def.schema.ts`): its `$schema` is `https://jxsuite.com/schema/v1/class`, which exists nowhere (the class schema is published as `https://jxsuite.com/schema/class/v1`); it has no `$prototype: "Class"`; and its parameters have no `identifier`, which `ClassParameterDef` requires. §12.3's `returnType` snippet references `#/$defs/ContentLoaderEntry`, against its own `returnTypes` convention. `plan:compiler/class-document-format` left §12.4's example to §12.4's owner, and its example keys are the ones used below.

**Related, no edge.** `plan:schema/parse-boundary-readers` swaps the bare `JSON.parse` of a parent class in both copies of `extractStudioSchema` for `parseClassDef`; after this plan that is one site, in `packages/server/src/class-schema.ts`. Studio reads a project's `imports` but not a document's own (`fetchPluginSchema` and the signals panel both); that is `spec.md` §12.5's resolution order, not this plan's.

## Outcome

No claim closes here. After it lands, the `returnType` clause is gone from the `spec.md` §12.3 and §12.4 markers (both stay Partial for `plan:spec/external-class-contract`), §12.3 states what Studio does with `returnType`, and §12.4's example validates.

## Decisions

- **Decided:** one name, `returnType`, on the class document and on the wire. `returns` gets no alias, because it was never specified, one shipped class declares it, and the plugin-schema response shape is not typed by `@jxsuite/protocol`, so both hosts and Studio change in the one pull request.
- **Decided:** one extractor for both hosts, `extractStudioSchema` in a new `packages/server/src/class-schema.ts` exported as `@jxsuite/server/class-schema`, because the desktop copy is how the field went missing in the only end-user Studio, and `project-session.ts` already imports `@jxsuite/server/resolve`, `/data`, `/refactor`, `/live-preview` and `/site-preview`.
- **Decided:** only `resolve()`'s type is surfaced, and only its top-level `$ref` chain is followed, through local pointers (`#/…`) into the same class document, with a cycle guard; nested references stay as written. §12.3 ties mapped iteration to `resolve()` and allows local references only, and the one consumer reads `type`. A non-local `$ref` is returned as declared; a local one that resolves to nothing yields no `returnType`.
- **Decided:** a class that declares no `resolve()` of its own takes its parent's type through `extends`, because it inherits the method. The existing test that asserts the opposite is inverted.
- **Decided:** an array source is a type of `"array"` or a type list containing it (`["array", "null"]`), because the mapped-array renderer already treats a non-array as no rows.
- **Decided:** `fetchPluginSchema` looks a source up as the runtime does, `$src`, then the project's `imports`, then the enabled extension whose manifest class has that name, because every shipped array class is reached the third way.
- **Decided:** §12.4's example is fixed here and pinned by a validating test that carries a verbatim copy, as `plan:compiler/class-document-format` does for `compiler.md` §5.2, since a suite reading `specs/` would need an `EXTRA_EDGES` entry.

## Implementation

1. **`packages/server/src/class-schema.ts`** (new, header `@docs extending/extensions/classes`):
   - `export interface StudioSchema`: the desktop interface (`type?`, `description?`, `properties`, `required`, `format?`, `$studio?`, `capabilities?`) plus `returnType?: Record<string, unknown>`.
   - `export function resolveReturnType(classDef: ClassJsonDef, method = "resolve"): Record<string, unknown> | undefined`: take `$defs.methods[method].returnType`; while it is an object whose `$ref` is a string starting with `#/`, replace it with `readPath(classDef, ref.slice(2))` (`@jxsuite/runtime/pointer`, which unescapes RFC 6901 tokens), stopping at a repeated reference; return a plain object or `undefined`.
   - `export function extractStudioSchema(classDef, classJsonPath): StudioSchema`: the body of `studio-api.ts`'s copy moved verbatim, with `description` set only when defined (the desktop typing), and `returnType` set from `resolveReturnType(classDef)` when `$defs.methods.resolve` exists, else from the parent schema.
   - `packages/server/package.json` `exports` gains `"./class-schema": "./src/class-schema.ts"`.
2. **`packages/server/src/studio-api.ts`**: delete `extractStudioSchema`, import it from `./class-schema.ts`. **`packages/server/src/types.ts`**: `ClassJsonMethod.returns` becomes `returnType?: Record<string, unknown>`.
3. **`packages/desktop/src/project-session.ts`**: delete its `extractStudioSchema`, `StudioSchema`, `ClassJsonDef`, `ClassFieldDef` and `CtorParam`; import `extractStudioSchema` and `type StudioSchema` from `@jxsuite/server/class-schema` and `type ClassJsonDef` from `@jxsuite/server/types`; `export type { StudioSchema }` so `handlers.ts`'s re-export keeps working.
4. **`packages/studio/src/services/code-services.ts`**: `PluginSchema.returns` becomes `returnType?: { type?: string | string[]; [key: string]: unknown }`. `fetchPluginSchema` resolves `src` as `def.$src`, then the project import, then `(await loadExtensions()).flatMap((e) => e.classes ?? []).find((c) => c.name === def.$prototype)?.path` (`loadExtensions` from `../format/format-host`); `base` is passed only for a `$src`.
5. **`packages/studio/src/editor/convert-to-repeater.ts`**: `arraySourceNames` tests `isArrayType(schema?.returnType)`, a local helper true for `type === "array"` or an array `type` that includes it; the JSDoc's "a plugin definition only says what it returns in its schema" becomes "a class says so in its `resolve()` `returnType`".
6. **`extensions/parser/src/ContentCollection.class.json`**: `"returns": { "type": "array" }` becomes `"returnType": { "type": "array" }`.
7. Spec and docs (below).

**Integration contract.** `@jxsuite/server/class-schema` exports `extractStudioSchema`, `resolveReturnType` and `StudioSchema`; both hosts' plugin-schema answers carry `returnType`, resolved and inherited; Studio's `fetchPluginSchema` finds a manifest class by name; no shipped class declares `returns`. `plan:spec/external-class-contract` relies on this for "tooling reads `returnType`" and on the §12.3 and §12.4 markers carrying no `returnType` clause.

## Tests

Each workspace runs `bun test --isolate --coverage` from its directory against its per-file `coverageThreshold` (server `lines = 0.96, functions = 0.95`; desktop `0.96 / 0.90`; studio `0.958 / 0.941`; schema `0.99 / 0.99`; parser `0.987 / 0.975`), and `bun scripts/check-coverage-manifest.ts packages/server` covers the new file. Ratchet any workspace whose worst file rises.

- **server**: new `tests/class-schema.test.ts`: "resolveReturnType follows a local $ref into returnTypes"; "follows a chain of local refs and stops at a cycle"; "a non-local $ref is returned as declared, an unresolvable local one yields nothing"; "a class with no resolve method has no returnType"; "a child with no resolve inherits its parent's returnType"; "a child's own resolve wins over its parent's"; "a returns key is not read". `studio-api.test.ts`'s "plugin-schema — returns annotation" block becomes "returnType annotation": fixtures declare `returnType`, the child case becomes "child inherits the parent's returnType when it declares no resolve", and a new case "a $ref into returnTypes arrives resolved".
- **desktop**: `content-collection.test.ts` "fetchPluginSchema resolves a bare-specifier .class.json" also asserts `returnType` is `{ type: "array" }` (the real parser descriptor); `handlers.test.ts` gains "fetchPluginSchema surfaces a resolved returnType".
- **studio**: `convert-to-repeater.test.ts` "plugin defs whose schema returns an array become sources" answers `{ returnType: { type: "array" } }`; new "a nullable array returnType is a source" and "a manifest class with no $src is offered through the enabled extensions" (`setExtensions` with one class path; the platform mock asserts it was asked for that path). `code-services.test.ts`: "fetchPluginSchema falls back to an enabled extension's class path" and "a prototype with no source anywhere is null".
- **schema**: `tests/class-schema-drift.test.ts` gains "no shipped class method declares returns" (same walk as the validation case) and "the spec.md §12.4 example validates against the class schema" (a verbatim copy).
- **parser**: no test change; its suite runs because a descriptor changed.

## Specs & docs

In place, in `specs/spec.md`:

- §12.3 marker: the clause from ", and no tool reads `returnType`" to "declares" is deleted; the sentence ends "…so a subscription outlives its component."
- §12.3 snippet: `"#/$defs/ContentLoaderEntry"` becomes `"#/$defs/returnTypes/ContentLoaderEntry"`. After the paragraph that follows it: "Studio reads the `returnType` of `resolve()` through the class document: it follows a local `$ref`, takes the parent's when a class that `extends` another declares no `resolve()` of its own, and offers the class as a repeater's items when the type is `array` or a list that includes it."
- §12.4 marker: the sentence beginning "\"Tooling uses this metadata\" does not hold" is deleted.
- §12.4 example: `$schema` becomes `https://jxsuite.com/schema/class/v1`, `"$prototype": "Class"` is added after `$id`, `location` becomes `{ "identifier": "location", "type": { "type": "string" }, "description": "City and state" }`, `days` becomes `{ "identifier": "days", "type": { "type": "integer", "default": 3 } }`, `forecasts` becomes `{ "role": "field", "identifier": "forecasts", "type": { "type": "array" } }`, and `resolve` gains `"identifier": "resolve"`. The paragraph after it says "a `resolve()` whose `returnType`" where it says "a method whose `returnType`".
- Fragment: `bun run spec:change spec.md minor -m "Studio reads the returnType a class declares on resolve, following a local ref and inheriting it through extends, and offers a class whose result is an array as a repeater source; the class example in 12.4 now validates"`.

Docs (no em dashes):

- `docs/extending/extensions/classes.md` (`spec:` cites `spec.md#12.3` and `#12.4`): after "so Studio offers the class in repeater pickers.", add "Studio follows a `$ref` into `$defs/returnTypes`, accepts a nullable array, and gives a class that extends another its parent's `resolve` type when it declares none." `code:` gains `packages/server/src/class-schema.ts`.
- `docs/framework/concepts/data-prototypes.md` (`spec: spec.md#12`): "its methods may declare `returns` schemas" becomes "its methods may declare a `returnType` schema".
- `docs/studio/design/repeaters.md` (`code:` lists `convert-to-repeater.ts`): the **A data source** bullet becomes "**A data source**: anything that produces a list. The dialog offers a source class whose descriptor says it returns a list, such as a content collection or a table query from an extension, without you declaring a type."
- No change, stated: `docs/studio/logic/code.md` (lists `code-services.ts`; it covers the code editor) and `docs/extending/embedding/dev-server.md` (lists `studio-api.ts`; no route payload is described).

## Acceptance

- `bun test --isolate --coverage` passes in `packages/server`, `packages/desktop`, `packages/studio`, `packages/schema` and `extensions/parser`; `bun scripts/check-coverage-manifest.ts packages/server` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
- `rg -n '"returns"' extensions/*/src/*.class.json` finds nothing, and `rg -n "function extractStudioSchema" packages` finds only `packages/server/src/class-schema.ts`.
- Observable in the desktop app: in a project with `@jxsuite/parser` enabled, a page with `"posts": { "$prototype": "MarkdownCollection", "src": "./content/posts/*.md" }` and no declared type offers `posts` in the **Repeat…** dialog's items source list.
