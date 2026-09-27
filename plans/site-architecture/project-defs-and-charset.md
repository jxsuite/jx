---
status: drafted
disposition: implement
claims:
  - site-architecture.md#3.1
requires: []
workspaces:
  - packages/schema
  - packages/site
  - packages/compiler
  - packages/studio
  - examples
  - packages/starters
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: M
---

# A document's `#/$defs/<Name>` reference resolves against the project's `$defs`, and every page declares `utf-8`

## Context

`specs/site-architecture.md` §3.1, line 216:

> **Status: Partial.** Every key is in the project schema (`packages/schema/defs/project-config.schema.ts`) except `content`, which the parser extension contributes (`extensions/parser/src/Content.class.json`), and all but `$defs` are read by the build or the page context (`packages/site/src/context.ts`, `packages/compiler/src/site/site-build.ts`). No build, runtime or context code reads project `$defs`, which only Studio's Data Shapes editor writes (`packages/studio/src/settings/defs-editor.ts`), and `defaults.charset` defaults to `"utf8"` (the schema source `packages/schema/defs/project-config.schema.ts`, `packages/compiler/src/site/site-loader.ts`, `compilePage` in `packages/compiler/src/site/site-build.ts`, `packages/site/src/head-merger.ts`) rather than `utf-8`.

Two defects share one anchor, so one plan owns both. Verified against the working tree on 2026-09-27; the census holds, with four corrections and additions.

**`$defs`.** The table row promises "Global type definitions available to all pages"; `docs/framework/site/project-json.md` says "any document in the project can reference" them and `docs/studio/projects/settings.md` says Data Shapes are what "other parts of the project can refer to". Nothing does:

- **No tool resolves even a document's own type reference.** spec.md §5.2 makes `$defs` tooling-only and §5.3 Shape 2 references it as `"type": { "$ref": "#/$defs/Count" }`, but no source under `packages/*/src` or `extensions/*/src` reads a `#/$defs/` pointer out of a `state` entry (the runtime lists `$defs` in `RESERVED_KEYS` and ignores it; the runtime's and Studio's `$defs` identifiers name the resolved _scope_, not JSON Schema definitions). `typedStateDefSchema` (`packages/schema/defs/typed-state-def.schema.ts`) accepts any object `type`, so `jx validate` passes a reference to nothing.
- **Studio cannot write one.** The Data panel's Type select (`stateFields` in `packages/studio/src/panels/signals-panel.ts`) offers six primitives, `SignalDef.type` is typed `string`, and an object `type` (spec.md's own `{ "$ref": "#/$defs/Count" }` or an inline `{ "type": "array", "items": … }`) matches none of its options; `defHint` prints it raw.
- **A copy into the page is the wrong mechanism, not merely an unchosen one.** `injectContext` (`packages/site/src/context.ts`) copies `$media` and `imports` into each page, but `pageShell` (`packages/site/src/shell.ts`) serializes the composed document into every live-preview page, so copied definitions would ship to the browser, which spec.md §5.1 rules out ("Tooling only. No runtime artifacts").
- No committed `project.json` declares `$defs`, and no committed document carries a `#/$defs/` type reference, so a new check has nothing in the repository to fail.

**`charset`.** The four `"utf8"` defaults are as the marker says (`project-config.schema.ts:275`, `DEFAULTS` in `site-loader.ts:43`, `compilePage` in `site-build.ts:1426`, `mergeHead` in `head-merger.ts:54`). `utf8` is an Encoding Standard label, but the HTML Standard requires a `charset` attribute to be an ASCII case-insensitive match for `utf-8`, so every page of a project that sets nothing is non-conforming. Three more facts:

- **The live preview ignores the key.** `composePage` (`packages/site/src/compose.ts:336`) calls `mergeHead` without `charset`, so Studio's live preview of the working tree (`packages/server/src/live-preview.ts`, through `@jxsuite/site/serve`) emits `mergeHead`'s own fallback whatever `defaults.charset` says, against site-architecture.md §8.4 ("Always (from `defaults.charset`)").
- **The obvious one-line fix fails lint.** oxlint's `unicorn/text-encoding-identifier-case` is on (the `style` category is `error` in `.oxlintrc.json`) and reports every string literal spelled `utf-8`; `packages/schema/tests/media-type.test.ts:149` already carries a disable comment for exactly this.
- 30 committed generated schemas carry `"default": "utf8"`: the three core artifacts under `packages/schema/` and 27 per-project `project.schema.json` files (`examples`, `packages/starters/sites/*`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures/*`, `sites/jxsuite.com`, `sites/test-blank`). No committed `project.json` sets `defaults.charset`.

**The table is also short.** §3.1 lists 18 properties; `projectConfigSchema` declares `$schema`, `defaults.dir`, `defaults.shadow`, `i18n`, `manifest`, `securityTxt` and `serviceWorker` as well, each specified elsewhere in this spec or in spec.md. `plan:schema/project-schema-keys` found the same gap from schema.md §3.2 and left it to this plan.

**Related.** spec.md §5.1 to §5.3 (the `$defs`/`state` split and Shape 2); spec.md §16's JSON Schema 2020-12 row (`Divergent`, for document-level deviations); site-architecture.md §8.4 (`<meta charset>` from `defaults.charset`), §10.1 and §10.2 (what cascades, which do not list `$defs`); studio.md §17 (Project Settings, whose Data Shapes section writes the key). `plan:schema/project-schema-keys` rewrites schema.md §3.2's `$defs` bullet to cite §3.1 and edits other rows of the same docs table; `plan:schema/parse-boundary-readers` edits the same `validate-command.ts` walks; `plan:site-architecture/nested-layout-head` and `plan:imports/canvas-project-context` edit `compose.ts`. None is a prerequisite: each touches different lines or different rows, so the order is a rebase, not a design dependency.

## Outcome

- site-architecture.md §3.1 → Implemented: `$defs` is read by one shared resolver that `jx validate` and Studio's Data panel both use, `defaults.charset` defaults to `utf-8` in the schema, the build and the live preview, and the table names every core key.
- §10.2 gains a sixth item for type definitions; §16 gains a JSON Schema 2020-12 `Divergent` row binding §3.1 for the name fallback.
- `docs/framework/site/project-json.md` and `docs/studio/projects/settings.md` stop overclaiming; the pages that describe `jx validate`, the Data panel's Type field, `$defs` and the head merge say what ships.

## Decisions

- **Open:** implement project `$defs` resolution now, or defer it? Recommendation: implement, in `jx validate` and in Studio's Data panel Type select, and nowhere else (the canvas and the runtime ignore `$defs` by design), because Studio already ships the Data Shapes editor and two docs pages promise that documents can use its shapes; the resolver is one pure module, and deferring leaves a Settings section that writes definitions nothing reads. If declined (`defer`): steps 5 to 7 and `packages/studio` drop out, the `$defs` row reads "Project-wide JSON Schema type definitions, edited in Studio's Data Shapes section (studio.md §17)", a `> **Status: Future.** A document's #/$defs/Name reference resolving against these definitions is not built.` paragraph follows the table, no §10.2 item or §16 row is added, and both docs pages drop their promise.
- **Open:** do components see project definitions, or only pages and layouts (the row's words)? Recommendation: every document under `pages/`, `layouts/` and `components/`, because a type has no runtime scope for §10.1's component encapsulation to protect, `$media` is the precedent for a project declaration reaching every component (§10.2 item 2), and a shared record shape is most useful on the component that receives it as a prop. The cost a maintainer signs: a component that leans on a project type is not portable to another project until it declares the type itself, and `jx validate` in the receiving project is what says so. If declined, `validateProjectTree` passes no project definitions for a file under `components/`, Studio offers only the document's shapes when the open document is a component, and the §10.2 item names pages and layouts.
- **Open:** does `defaults.charset` stay a free string? Recommendation: yes, change only the default, because the defect the marker names is the default, no committed project sets the key, and a pattern would be a breaking schema change bought for a value nobody authors. The alternative is `pattern: "^[Uu][Tt][Ff]-8$"` on the property, so `jx validate` rejects every value the HTML Standard forbids (the build would still emit what is declared, and `mergeHead`'s library tests with `utf-16` would stand); the §3.1 cell would then read "always `utf-8`" as a rule rather than a default.
- **Decided:** resolve, never copy, because definitions copied into a page would reach every live-preview payload through `pageShell`, which spec.md §5.1 forbids, and a resolver answers tooling without touching output.
- **Decided:** a reference falls back **by definition name**, not through a relative URI such as `../project.json#/$defs/Address`, because the URI form (standard JSON Schema) needs one `../` per folder level and breaks when a page moves (the trap `docs/framework/concepts/documents.md` already warns about for `$schema`), and a name is the unit the Data Shapes editor manages, as `$media` and `imports` cascade by name. The deviation from JSON Schema, which reads `#/…` against the document alone, is recorded in §16 as `Divergent`.
- **Decided:** a reference resolves in the scope of the file that carries it: in a document, the document's `$defs` then the project's; inside `project.json`'s `$defs`, the project's alone. A document that defines `<Name>` shadows the project's whole definition, and a longer pointer (`#/$defs/Address/properties/zip`) is walked inside whichever definition the name chose and never falls through, because a half-shadowed definition would be two schemas answering for one name.
- **Decided:** a type reference that resolves nowhere is a `jx validate` **issue** (the run fails), not an advisory lint, because an unresolvable `$ref` is an error under JSON Schema and walk 1 already treats the same condition in the entry documents as fatal. Only `#/$defs/` pointers are judged; other pointer forms and external references are out of scope.
- **Decided:** the resolver is one module, `packages/schema/src/type-refs.ts`, exported as `@jxsuite/schema/type-refs`, because `jx validate` and Studio must give the same answer, `@jxsuite/schema` is the one package both already import, and pure functions with no platform import can enter the Studio bundle.
- **Decided:** `DEFAULT_CHARSET` is defined once, in `project-config.schema.ts` beside the schema that publishes it, and re-exported from `@jxsuite/schema/defs`, because the lint rule would otherwise need a disable comment at four sites, and four literals are how the value drifted in the first place.
- **Decided:** `composePage` passes `defaults.charset` to `mergeHead`, because §8.4 names the key as the source of `<meta charset>` in every page and the live preview is the second host with the same default bug; `mergeHead` keeps its own fallback so a caller with no context still emits a charset.
- **Decided:** §3.1's table gains rows for the seven declared keys it omits, each pointing at the section that specifies it, because this plan is the section's owner and a table graduating to Implemented while missing a third of the schema would repeat the drift `plan:schema/project-schema-keys` found in schema.md.

## Implementation

**Charset**

1. `packages/schema/defs/project-config.schema.ts`: add, above `projectConfigSchema`,
   ```ts
   /**
    * The only `<meta charset>` value the HTML Standard allows a document to declare
    * (site-architecture.md §3.1). One definition, read by the schema, the build and the head merger.
    */
   // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- an HTML charset label, not a Buffer encoding.
   export const DEFAULT_CHARSET = "utf-8";
   ```
   `defaults.properties.charset` becomes `{ default: DEFAULT_CHARSET, description: "The <meta charset> every page declares. The HTML Standard allows only utf-8, which is the default.", type: "string" }`. The `$defs` description becomes `"JSON Schema type definitions, tooling only. A document's #/$defs/Name reference resolves here when the document does not define Name itself."`. `packages/schema/defs/index.ts` re-exports `DEFAULT_CHARSET` beside `projectConfigSchema` and `REDIRECT_STATUSES`. Then `bun run schema:sync` regenerates the 30 committed schemas (a `default` and two `description` pointers each); never hand-edit them.
2. `packages/compiler/src/site/site-loader.ts`: `DEFAULTS.defaults.charset` is `DEFAULT_CHARSET`, imported from `@jxsuite/schema/defs`.
3. `packages/compiler/src/site/site-build.ts`, `compilePage`: `charset: projectConfig.defaults?.charset ?? DEFAULT_CHARSET`.
4. `packages/site/src/head-merger.ts`, `mergeHead`: the auto-injected entry is `{ attributes: { charset: context.charset ?? DEFAULT_CHARSET }, tagName: "meta" }`; the `HeadMergeContext.charset` doc comment says the default is the HTML Standard's `utf-8`.
5. `packages/site/src/compose.ts`, `composePage`: the `mergeHead` context gains `...(config.defaults?.charset === undefined ? {} : { charset: config.defaults.charset })`, in the style of the existing `siteName` spread.

**Type references**

6. New `packages/schema/src/type-refs.ts` (module doc cites site-architecture.md §3.1 and spec.md §5.2, and carries `@docs framework/site/project-json`), and `"./type-refs": "./src/type-refs.ts"` in `packages/schema/package.json` `exports`. Exports:
   - `DEFS_POINTER_PREFIX = "#/$defs/"`, and `type TypeDefinitions = Readonly<Record<string, unknown>> | undefined`.
   - `typeRefFor(name: string): string`: the prefix plus the name escaped per RFC 6901 (`~` to `~0`, then `/` to `~1`).
   - `typeRefName(type: unknown): string | null`: the decoded name when `type` is a plain object whose `$ref` is a whole-definition pointer (the prefix plus exactly one non-empty segment); other keys on the object are annotations and ignored. `null` for anything else, a longer pointer included.
   - `resolveTypeRef(ref, documentDefs?, projectDefs?): { name: string; scope: "document" | "project"; schema: unknown } | null`: `null` unless `ref` starts with the prefix; split the rest on `/` and decode each segment (`~1` then `~0`); the first segment is the name and must be non-empty; the scope is the document when `Object.hasOwn(documentDefs, name)`, else the project when `Object.hasOwn(projectDefs, name)`, else `null` (`hasOwn`, so `#/$defs/constructor` names nothing); the remaining segments walk plain objects by own key and arrays by a canonical decimal index, and any miss is `null` with no fall-through to the other scope.
   - `collectTypeRefs(value: unknown, at = ""): { ref: string; at: string }[]`: depth-first over plain objects and arrays in key order; an object whose `$ref` is a string starting with the prefix contributes `{ ref, at: at + "/$ref" }`; recursion continues into every member; `at` segments are RFC 6901-escaped.
   - `findDanglingTypeRefs(doc: { state?: unknown; $defs?: unknown }, projectDefs?): { ref: string; at: string }[]`: collects from each own `state` entry whose `type` is a plain object (at `/state/<name>/type`) and from each own `$defs` entry (at `/$defs/<name>`), then keeps those for which `resolveTypeRef(ref, doc.$defs, projectDefs)` is `null`, in document order. A non-object `state` or `$defs` contributes nothing.
   - `typeDefinitionNames(documentDefs?, projectDefs?): { name: string; scope: "document" | "project" }[]`: the document's names sorted, then the project's names the document does not define, sorted.
7. `packages/compiler/src/site/validate-command.ts`, `validateProjectTree`:
   - Hoist `const { config } = loadProjectConfig(root)` from walk 5 to just after walk 2, and reuse it in walk 5. Walk 2 then also runs `findDanglingTypeRefs({ $defs: config.$defs })` (the project's definitions as the document scope, no project fallback) and, when it finds any, pushes one issue on `project.json` with `{ instancePath: at, message: \`type reference "${ref}" names no definition in project.json's $defs\` }` per reference.
   - Walk 3, inside the `if (validateDoc(doc))` branch before linting: `findDanglingTypeRefs(doc, config.$defs)` and one issue on the document's relative path, each error `{ instancePath: at, message: \`type reference "${ref}" names no definition in this document's $defs or in project.json's $defs\` }`. A schema-invalid document keeps being reported for its schema errors alone.
   - The module docstring's walk 2 and walk 3 entries say what the new checks judge, citing site-architecture.md §3.1. `formatProjectTreeIssues` needs no change: it already prints `instancePath` and `message`.
8. `packages/studio/src/panels/signals-panel.ts` (comments cite `site-architecture.md §3.1` qualified, since a bare `§` in `packages/studio` means studio.md):
   - `SignalDef.type` becomes `string | Record<string, unknown>`.
   - `selectField` takes `values: readonly (string | { label: string; value: string })[]`, mapping a bare string to `{ label: v, value: v }` as today.
   - A module-private `typeChoices(S, def)` returns the six primitives, then one `{ label: name, value: typeRefFor(name) }` per `typeDefinitionNames(S.document.$defs, projectState?.projectConfig?.$defs)`; when `def.type` is an object that `typeRefName` does not name, `{ label: "Inline schema", value: "__inline__" }` leads the list.
   - In `stateFields`, the Type select's value is `def.type` when it is a string, `def.type.$ref` when `typeRefName(def.type)` names it, `"__inline__"` for another object, and `"string"` when unset. Its write is a no-op for `"__inline__"`, `patch({ type: { $ref: v } })` for a value starting with `DEFS_POINTER_PREFIX`, and `patch({ type: v })` otherwise.
   - The Default parser coerces by `coercionType(S, def)`: the string `type` itself, else the `type` of `resolveTypeRef(def.type.$ref, S.document.$defs, projectState?.projectConfig?.$defs)?.schema` when that is a string, else none (the raw string, as an untyped entry is parsed today). The Format row keeps its `def.type === "string" || !def.type` condition: a shape carries its own `format`.
   - `defHint` prints `typeRefName(def.type)` for a reference, `"schema"` for another object type, and the string type as today, in both its attribute and plain branches.

**Integration contract.** Once this lands, `@jxsuite/schema/type-refs` exports `DEFS_POINTER_PREFIX`, `typeRefFor`, `typeRefName`, `resolveTypeRef`, `collectTypeRefs`, `findDanglingTypeRefs` and `typeDefinitionNames` with the semantics above, and `@jxsuite/schema/defs` exports `DEFAULT_CHARSET`. A tool that answers "what type does this `#/$defs/` reference name" calls `resolveTypeRef` with the document's and the project's definitions rather than reading `$defs` itself. `jx validate` fails a document or `project.json` with a type reference that resolves nowhere. Built and previewed pages emit `<meta charset="utf-8">` unless `defaults.charset` says otherwise. site-architecture.md §3.1 states the resolution rule, and schema.md §3.2's `$defs` bullet may cite it.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`; `coverageThreshold = { lines = 0.99, functions = 0.99 }`). New `tests/type-refs.test.ts`, which the manifest check requires for the new source file:

- "the document's definition wins, and the project's answers a name the document lacks": `Count` in both resolves with `scope: "document"`; `Address` only in the project resolves with `scope: "project"` and its schema.
- "a longer pointer is walked inside the chosen definition and never falls through": document `Address: { type: "string" }` and project `Address` with `properties.zip` make `#/$defs/Address/properties/zip` `null`; with no document `Address` it resolves to the project's `zip`; an `items/0` segment walks an array.
- "escapes decode, and inherited keys are not definitions": `#/$defs/a~1b~0c` resolves the key `a/b~c`; `#/$defs/constructor` and `#/$defs/toString` are `null` against `{}`.
- "anything but a #/$defs/ pointer resolves to null": `#/state/x`, `other.json#/$defs/X`, `#/$defs/` and `#/$defs`.
- "every #/$defs/ reference under a value is found with its RFC 6901 path": refs under `properties`, `items` and an `anyOf` array, and under a key containing `/`, come back with their escaped `at`; `#/content/x`, a non-string `$ref` and plain data do not.
- "dangling references in state types and definitions are reported in document order": a document with one good and one missing reference in `state` and one missing inside its own `$defs` reports exactly the two missing, `at` `/state/…/type/…/$ref` and `/$defs/…/$ref`; a string `type`, an inline schema with no reference, a naked value and a document with neither key report nothing.
- "the document's names come first, then the project's it does not shadow, each sorted".
- "a name survives typeRefFor and typeRefName, escapes included; a longer pointer, a non-object and a foreign $ref are not a name".

`tests/schema.test.ts`, new case "the project schema's charset default is the HTML Standard's utf-8": `expect(DEFAULT_CHARSET).toBe("utf-8")` under the same disable comment as `media-type.test.ts:149`, and `defaults.properties.charset.default` of `generateProjectSchema()` equals `DEFAULT_CHARSET`.

**`packages/site`** (`coverageThreshold = { lines = 0.99, functions = 1.0 }`):

- `tests/head-merger.test.ts`, "auto-injects charset and viewport defaults": the charset entry equals `DEFAULT_CHARSET`, and `renderHead(mergeHead())` contains `<meta charset="utf-8">`.
- `tests/compose.test.ts`, new "defaults.charset reaches the merged head, and utf-8 when it is unset": composing with `{ defaults: { charset: "iso-8859-1" } }` puts that value on the head's charset entry; composing with no config puts `DEFAULT_CHARSET`.

**`packages/compiler`** (`coverageThreshold = { lines = 0.982, functions = 0.98 }`):

- `tests/site-build.test.ts`: "loads project.json with defaults" expects `DEFAULT_CHARSET`; "generates correct HTML with layout and head merging" also expects `<meta charset="utf-8">` in `dist/about/index.html` (the fixture's `project.json` sets no charset).
- `tests/validate-command.test.ts`, a new `describe("validateProjectTree: type references")` over its own fixture root `__test-validate-typerefs__` (built in its `beforeAll` with `writeProjectSchemas`, removed in `afterAll`): `project.json` declares `$defs` `Address` (an object with `properties.zip`), `Count` and `List` (`items.$ref` `#/$defs/Address`); `pages/index.json` declares its own `Count` and state entries typed `#/$defs/Address`, `#/$defs/Count` and `#/$defs/Address/properties/zip`; `components/x-card.json` types an entry `#/$defs/Address`.
  - "a reference resolves in the document's $defs, then the project's, in pages and components alike": `valid` is true with no issues.
  - "a reference neither defines is an issue at its instance path": a written `pages/broken.json` whose `tags` entry is `{ type: "array", items: { $ref: "#/$defs/Tag" } }` yields one issue on `pages/broken.json` with `instancePath` `/state/tags/type/items/$ref`, and `formatProjectTreeIssues` prints that line with the name.
  - "a document's definition shadows the project's whole definition": a page defining `Address` as a string and typing an entry `#/$defs/Address/properties/zip` is an issue.
  - "project.json's own definitions resolve against the project alone": `List.items.$ref` rewritten to `#/$defs/Nope` is an issue on `project.json` at `/$defs/List/items/$ref`; the file is restored afterwards.

**`packages/studio`** (`coverageThreshold = { lines = 0.958, functions = 0.941 }`). `tests/signals-panel-fixture.ts`: `DrawOptions.defs` puts `$defs` on the drawn document. Project definitions are set through `projectState.projectConfig`, as `signals-panel-schema.test.ts` does with `resetStudioState`.

- `tests/signals-panel.test.ts`, `defHint`: "a data-shape type shows the shape's name, and an inline schema shows schema", including the `[open] Address` attribute form.
- `tests/signals-panel-template.test.ts`:
  - "the type picker offers the document's and the project's data shapes, and a shape writes a $defs reference": with document `Count` and project `Address` and `Count`, the options are the six primitives, `Count`, `Address` (`Count` once); picking `Address` leaves `type` equal to `{ $ref: "#/$defs/Address" }`, and picking `integer` afterwards writes the string back.
  - "a default typed by a data shape parses as the shape's type": an entry typed `#/$defs/Count` (project `Count` is `integer`) commits `"42"` as `42`; one typed by an unresolvable reference keeps the raw string.
  - "an inline schema reads as Inline schema and is kept until another type is picked".

**Coverage.** `type-refs.ts` is the only new source file and ships with its test, so `bun scripts/check-coverage-manifest.ts packages/schema` passes; it must meet the schema workspace's per-file bar on its own. Every touched workspace keeps its thresholds; if a touched workspace's worst file rises meaningfully, ratchet its `coverageThreshold` to just below the new minimum in the same pull request.

## Specs & docs

**`specs/site-architecture.md` §3.1**, in place. The marker becomes:

```markdown
> **Status: Implemented.** Every key below is in the project schema (`packages/schema/defs/project-config.schema.ts`) except `content`, which the parser extension contributes (`extensions/parser/src/Content.class.json`). Each is read by the build or the page context (`packages/site/src/context.ts`, `packages/compiler/src/site/site-build.ts`), except `$defs`, which is tooling-only and is read by the type-reference resolver that `jx validate` and Studio's Data panel share (`packages/schema/src/type-refs.ts`).
```

Table edits: the `defaults.charset` description becomes "`<meta charset>` on every page (§8.4); `utf-8` unless set, the only value the HTML Standard allows"; the `$defs` description becomes "JSON Schema type definitions every page, layout and component can reference as `#/$defs/<Name>` (see below)"; new rows, each after its nearest sibling: `$schema` (`string`, "The editor binding to the generated `project.schema.json` (extensions.md §5.2)"), `defaults.dir` (`string`, "Default `<html dir>`: `ltr`, `rtl` or `auto`; omitted when unset (§13.4)"), `defaults.shadow` (`string` or `false`, "Default shadow-DOM mode for every component (spec.md §16.6)"), `i18n` (`object`, "Locales and locale routing (§13.2)"), `manifest` (`object`, "Web App Manifest; absent means none (§14.5)"), `securityTxt` (`object`, "`.well-known/security.txt` (§14.5)"), `serviceWorker` (`boolean` or `object`, "Optional service worker (§14.6)"). After the table, a new paragraph:

```markdown
**Project type definitions.** A document's type reference (`{ "$ref": "#/$defs/<Name>" }`, spec.md §5.2 and §5.3) resolves against the document's own `$defs` first and then against the project's, by definition name: a document that defines `<Name>` shadows the project's whole definition, and a longer pointer (`#/$defs/<Name>/properties/id`) is walked inside whichever definition the name chose. A reference written in `project.json`'s own `$defs` resolves against the project alone. Nothing is copied into a page, because `$defs` has no runtime artifact (spec.md §5.1): `jx validate` reports a reference that resolves in neither place as an error on the file that carries it, and Studio's Data panel offers the document's and the project's definitions as a value's type. The name fallback departs from JSON Schema, which reads `#/…` against the document alone (§16).
```

**§10.2**, a new item 6: "**Type definitions** — `$defs` from `project.json` resolve any `#/$defs/<Name>` reference a document does not define itself (§3.1). Tooling only: nothing reaches the rendered page." **§16**, a row appended to the table: `[JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema)`, `**Divergent**`, binds `§3.1`, evidence `packages/schema/src/type-refs.ts, packages/schema/tests/type-refs.test.ts, packages/compiler/tests/validate-command.test.ts`, note: "A `#/$defs/` reference resolves against the document that carries it exactly as the standard reads it, with one deviation: a name the document does not define falls back to the project's `$defs`, where the standard would report the reference as unresolvable. The fallback is by definition name, never by longer pointer, and a reference inside the project's own definitions sees the project alone." §3, §8.4 and every other section: no edit.

**Fragment:** `bun run spec:change site-architecture.md minor -m "§3.1: a document's #/$defs/Name type reference resolves against project.json's $defs when the document does not define the name, checked by jx validate and offered by Studio's Data panel; defaults.charset defaults to utf-8 in the schema, the build and the live preview; the property table names every core key; §10.2 lists type definitions and §16 records the JSON Schema divergence."` Minor: an `implement`. No other spec changes; spec.md §5.2 already says `$defs` is referenced "from external documents" and tooling-only.

**Docs** (no em dashes; `bun run docs:sync` names the pages whose `code:` lists `site-build.ts`, `head-merger.ts`, `validate-command.ts`, `signals-panel.ts` or the regenerated `project.core.schema.json`):

- `docs/framework/site/project-json.md`: `code:` gains `packages/schema/src/type-refs.ts`. "Identity and defaults" gains "`defaults.charset` sets `<meta charset>` on every page and defaults to `utf-8`, the only encoding the HTML Standard allows." The `$defs` paragraph under "Site state and shared types" becomes: "`$defs` holds reusable [JSON Schema type definitions](/docs/framework/concepts/documents), such as shapes for API responses, CMS payloads, or shared value types. A document that references `#/$defs/<Name>` without defining `<Name>` itself gets the project's definition, so a shape declared here is available in every page, layout and component, and a document's own definition of the same name wins. Types are for tooling only and never reach the built page: `jx validate` fails a reference that neither the document nor `project.json` defines, and Studio's Data panel offers these shapes as a value's type." The key-reference rows are left to `plan:schema/project-schema-keys`.
- `docs/framework/site/seo.md`: merge-order item 1 reads "**Built-in defaults**: `<meta charset>` (`utf-8` unless `defaults.charset` says otherwise) and a standard viewport tag".
- `docs/framework/build/cli.md`, `jx validate`: after "every document under `components/`, `pages/`, and `layouts/` against the bundled document schema", add "and every `#/$defs/<Name>` type reference in it resolves in the document's own `$defs` or in `project.json`'s (a reference inside `project.json`'s `$defs` must resolve there)".
- `docs/framework/agents/authoring-rules.md`: hard rule 6 gains "A `#/$defs/<Name>` reference the document does not define resolves against `project.json`'s `$defs`; `jx validate` fails one that resolves in neither."
- `docs/framework/concepts/documents.md`: after "State entries reference these types with `$ref` (`{ "$ref": "#/$defs/Count" }`)." add "In a site, a name the document does not define resolves against the `$defs` in [project.json](/docs/framework/site/project-json)."
- `docs/studio/logic/data.md`: the **Type** bullet reads "`string`, `integer`, `number`, `boolean`, `array`, or `object`, or a data shape defined in this file's `$defs` or in **[Project settings](/docs/studio/projects/settings#data-shapes)**. Defaults you type are converted to match. A type written by hand as an inline schema shows as **Inline schema** and is kept until you pick another."
- `docs/studio/projects/settings.md`, "Data Shapes": append "Any value in the **[Data panel](/docs/studio/logic/data)** of any page, layout or component can take a data shape as its **Type**."
- No change: `docs/framework/build.md`, `docs/framework/site/redirects.md`, `docs/framework/site/deployment.md`, `docs/framework/concepts/color-schemes.md`, `docs/framework/agents.md`, `docs/framework/concepts/accessibility.md`, `docs/studio/logic.md`, `docs/studio/logic/data-sources.md` (named by `docs:sync`; none describes the charset default, type references or the Type options).

**Graduation:** none; site-architecture.md keeps other open items. The landing pull request deletes this file.

## Acceptance

- `bun run docs:status` shows site-architecture.md §3.1 as `Implemented`; `bun run plans:status --spec site-architecture` no longer lists §3.1; `bun run plans:check` is green with this file deleted.
- `git grep -n '"utf8"' -- '*schema.json'` finds nothing, `git grep -n 'charset: "utf8"\|?? "utf8"' -- packages` finds nothing, and `bun run schema:verify` is green.
- From each of `packages/schema`, `packages/site`, `packages/compiler` and `packages/studio`, `bun test --isolate --coverage` is green; `bun scripts/check-coverage-manifest.ts packages/schema` passes from the root.
- In a scratch project with no `defaults.charset`, `jx build` writes `<meta charset="utf-8">` into `dist/index.html`, and Studio's live preview of the same page carries the same tag (and carries `iso-8859-1` once `defaults.charset` says so).
- In that project, a page typed `{ "$ref": "#/$defs/Missing" }` makes `jx validate` exit 1 with `pages/<file>:` and `- /state/<name>/type/$ref: type reference "#/$defs/Missing" …`; adding `Missing` to `project.json`'s `$defs` makes it exit 0.
- In Studio (`packages/studio:verify`), a shape added in Project Settings, Data Shapes appears in a page's Data panel Type select, and picking it writes `{ "$ref": "#/$defs/<Name>" }` to the entry.
- `bun run lint` is green (one disable comment, on `DEFAULT_CHARSET`); `bun run docs:spec-release` finds the fragment; `bun run docs:check`, `docs:links`, `docs:prose` and `docs:standards` (the new §16 row) are green.
