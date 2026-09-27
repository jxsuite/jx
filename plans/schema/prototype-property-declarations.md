---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/schema
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: S
---

# ExternalClassDef declares the FormData and Blob properties the runtime reads

## Context

This plan claims nothing. It enables `plan:schema/generator-inventory`, which owns schema.md §3.1 and requires it. It was split out of that plan because it is code, where the rest of §3.1's closure is a `reconcile` of the text.

`specs/schema.md` §3.1, line 47, names the gap in its marker:

> `ExternalClassDef` declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`, and a computed `state` entry is admitted by `StateEntry`'s plain string branch, not a pattern match.

§3.1's Built-in Prototypes list (lines 80 and 86) promises `FormData` "default fields" and `Blob` "parts, type", and the runtime reads exactly those. Request `urlParams` is not part of this plan: `plan:spec/request-url-params` owns it (the runtime, `emitRequestFetch` and the schema declaration together), because nothing reads it yet. Re-verified against `84735a9f` on 2026-09-27.

**What exists**

- `packages/schema/defs/external-class-def.schema.ts`: `BUILT_IN_PROTOTYPES` and `externalClassDefSchema`, one open property set shared by every state `$prototype`: `$export`, `$prototype`, `$src`, `autoIncrement`, `body`, `database`, `debounce`, `default`, `description`, `domain`, `filter`, `headers`, `indexes`, `items`, `key`, `keyPath`, `manual`, `map`, `maxAge`, `method`, `name`, `path`, `responseType`, `sameSite`, `secure`, `sort`, `src`, `store`, `timing`, `url`, `version`. None of `fields`, `parts` or `type` is declared, so any value validates: `fields: [1, 2]`, `fields: { a: { $ref: "#/state/x" } }` and `parts: "hello"` all pass today.
- `packages/runtime/src/runtime.ts`, `resolvePrototype`: the `FormData` case (line 2994) calls `fd.append(k, v as string)` for every entry of `def.fields ?? {}`, with no `$ref` or template resolution, so a number or boolean is sent as its text and an object as `[object Object]`. The `Blob` case (line 3002) builds `new Blob(def.parts ?? [], { type })`, taking `def.type` when it is a string and `text/plain` otherwise. `packages/runtime/tests/runtime.test.ts` ("FormData: returns FormData", "Blob: returns Blob") covers both.
- Studio's FormData editor (`dataFields` in `packages/studio/src/panels/signals-panel.ts`, line 831) writes whatever JSON the author types into `fields`, so an array or a nested object reaches the document unchecked. Studio has no Blob editor.
- `JxPrototypeDef` (`packages/schema/types.ts`, line 407) already carries `fields?: Record<string, JsonValue>`; `parts` and `type` fall under its `[key: string]: unknown`.

**The two checks the census left to detailing**

- **Extension classes.** None of the 22 shipped classes (`extensions/*/src/*.class.json`) or the 16 server test fixtures declares a `$defs.parameters` entry named `fields`, `parts` or `type`, and no tracked JSON document carries any of the three on a `$prototype` entry. Declaring them refuses nothing that ships. The exposure is third-party classes and `URLSearchParams`, whose own keys are its params (`?fields=title,date` and `?type=2` are ordinary query strings), which is what the first decision below is about.
- **`StateEntry.oneOf`.** `TypedStateDef` carries `not: { required: ["$prototype"] }` and `ExternalClassDef` requires `$prototype`, so the two are disjoint on `$prototype` whatever either declares; `FunctionDef` requires `$prototype: "Function"`, `ExpressionEntry` requires `$expression`, and the plain-object branch refuses `$prototype` and `type`. A `Blob` entry with `type` matches `ExternalClassDef` alone, and `{ type, default }` matches `TypedStateDef` alone, before and after this change. New properties can only make `ExternalClassDef` refuse more, never match a second branch.

## Outcome

- No claim changes state. schema.md §3.1 stays Partial and stays `plan:schema/generator-inventory`'s.
- `ExternalClassDef` validates FormData `fields` and Blob `parts` and `type` in the shapes the runtime reads, in `packages/schema/schema.json` and every committed `document.schema.json`.
- §3.1's marker no longer names FormData or Blob, and its flat-set bullet says how these three are declared.

## Decisions

- **Open:** declare the three names in the flat property set, or only for their own prototype? Recommendation: only for their own prototype, with an `if`/`then` on `$prototype` inside `ExternalClassDef`. The flat set is why `filter` and `sort` had to be widened after they silently overrode two extension classes (§3.1's flat-set bullet), and `type` and `fields` are the most generic names yet: a flat `fields: object` would refuse a `URLSearchParams` entry's `fields: "title,date"`, and a flat `type: string` any class parameter called `type` that is not a string. Each of the three is read by exactly one built-in, so the conditional costs two `allOf` entries and constrains nobody else. The existing flat names stay as they are; discriminating them is the separate question `plan:schema/generator-inventory` records. Flat declarations are the fallback, one line each, if review prefers one uniform set.
- **Open:** may a `fields` value be a number or a boolean, or only a string? Recommendation: string, number or boolean, refusing `null`, objects and arrays. `FormData.append` converts its value to a string, so `3` and `true` arrive as `"3"` and `"true"` exactly as an author means them, and Studio's JSON editor produces them naturally; `null`, an object (a `$ref` included) and an array arrive as `"null"`, `"[object Object]"` and `"1,2"`, which is never what was meant and is what the declaration exists to catch.
- **Decided:** no `$ref` or `${}` template in `fields` or `parts`, because the runtime resolves neither (the FormData entry is not reactive), and admitting a binding would validate a document that sends `[object Object]`. Reactive fields would be a runtime feature with its own spec text, not a schema declaration.
- **Decided:** `parts` is an array of strings and `type` any string, with no media-type pattern. JSON carries no binary, so text is the only `BlobPart` a document can hold, and the File API takes any `type` string (lower-casing it, and blanking one outside printable ASCII) where `parseMediaType` guards header values, which a `Blob` type is not.
- **Decided:** `packages/schema/types.ts` is unchanged. `JxPrototypeDef` is one interface for every `$prototype`, so a `type?: string` there would reimpose in TypeScript the constraint the conditional keeps out of the schema, and the runtime's reads already guard (`typeof def.type === "string"`) or cast.
- **Decided:** this pull request narrows §3.1's marker and extends its flat-set bullet, with a `minor` fragment (the program's level for an `implement`), because the pull request that makes a marker sentence false is the one whose reviewer can confirm it. The marker stays Partial, and `plan:schema/generator-inventory` still deletes it. `plan:spec/compiled-request-fetch` and `plan:schema/build-schema-agreement` do the same to the markers they serve.
- **Decided:** no `requires` edge with `plan:spec/request-url-params` in either direction. The names are disjoint, and the marker edit below is written for either landing order.

## Implementation

1. **`packages/schema/defs/external-class-def.schema.ts`**, `externalClassDefSchema` (Open decisions taken as recommended):
   - Add, keys in the file's alphabetical order, an `allOf` of two literal entries (literal, not built with `.map`, so the `as const` object stays a tuple for `FromSchema`):
     - `{ if: { properties: { $prototype: { const: "FormData" } }, required: ["$prototype"] }, then: { properties: { fields: { additionalProperties: { type: ["boolean", "number", "string"] }, description: "Initial fields, appended in key order. A number or boolean is sent as its text.", type: "object" } } } }`
     - `{ if: { properties: { $prototype: { const: "Blob" } }, required: ["$prototype"] }, then: { properties: { parts: { description: "The Blob's text parts, concatenated in order.", items: { type: "string" }, type: "array" }, type: { description: 'The MIME type. Defaults to "text/plain".', type: "string" } } } }`
   - Each `if` carries `required: ["$prototype"]`, because a `properties` test passes vacuously on an object without the key: without it, `oneOf` evaluating a `TypedStateDef` entry `{ type: 3, default: 0 }` against `ExternalClassDef` would also report a spurious Blob `type` error beside the real one.
   - Above the `allOf`, a comment in the style of the `filter` comment: the flat `properties` bind every `$prototype`, so a name only one built-in reads is declared here, bound to that prototype, and leaves a `URLSearchParams` param or an extension class parameter of the same name its own shape (schema.md §3.1).
   - Append to the schema's `description`: " Properties that one built-in alone reads are declared for that prototype only (allOf)."
   - `json-schema-to-ts` ignores `if`/`then` unless `parseIfThenElseKeywords` is set, so the derived `ExternalClassDef` type (exported from `types.ts`, consumed nowhere) is unchanged. `bun run typecheck` confirms it.
   - Fallback if review takes flat declarations: the same three subschemas go into `properties` instead, and the `allOf` and its comment are dropped.
2. **Regenerate**: `bun run schema:sync`. Its report should name only `/$defs/ExternalClassDef/allOf/…` and `/$defs/ExternalClassDef/description` pointers in `packages/schema/schema.json` and their embedded counterparts in the 28 committed `document.schema.json` files (`examples/`, 13 under `packages/starters/sites/`, `packages/studio/`, `packages/ui/`, 10 under `scripts/screenshots/fixtures/`, `sites/jxsuite.com/`, `sites/test-blank/`). Anything else in the report is unrelated drift and belongs to another change. Commit the regenerated files; never hand-edit them.
3. **Tests**: the new file under Tests.
4. **Spec and docs**: under Specs & docs.
5. Delete this file and remove `schema/prototype-property-declarations` from `plans/schema/generator-inventory.md`'s `requires`, re-reading that plan's §3.1 text against the landed shape (the integration contract below).

**Integration contract.** Once this lands:

- `ExternalClassDef` refuses a `FormData` entry whose `fields` is not an object of strings, numbers and booleans, and a `Blob` entry whose `parts` is not an array of strings or whose `type` is not a string. It constrains no other `$prototype`'s `fields`, `parts` or `type`.
- The committed schemas carry it, and `bun run schema:verify` holds them to the generator.
- schema.md §3.1's marker names only what is left: the webref derivation, the enumeration, the computed-entry branch and, until `plan:spec/request-url-params` lands, Request `urlParams`. The flat-set bullet documents the exception.
- `plan:schema/generator-inventory` may rely on all of this. Its Built-in Prototypes lead ("whose one property set is shared") and its flat-set addition must keep the exception sentence this plan adds, and its `FormData` line ("`fields`, appended in key order") and `Blob` line stand as it wrote them.
- `plan:spec/request-url-params` may declare `urlParams` as a third `allOf` entry keyed on `Request` (recommended, since only `Request` reads it) or flat (no name clash today). It does not need this plan.
- `plan:spec/web-api-prototype-parity`'s compiled `FormData` and `Blob` lowering may assume a document that passes `jx validate` has scalar `fields` values, string `parts` and a string `type`.

## Tests

`packages/schema`: `bun test --isolate --coverage` from `packages/schema`, then `bun scripts/check-coverage-manifest.ts packages/schema` from the root.

New file `packages/schema/tests/prototype-config.test.ts`. It compiles `await generateSchema()` once at module scope with `new Ajv2020({ allErrors: true, strict: false, validateFormats: false })`, as `real-site-gaps.test.ts` does for the committed file (a per-call compile is what timed that suite out), so the cases prove the definition and `schema:verify` proves the artifact. Each case validates a document `{ tagName: "div", state: { … } }` and reads `instancePath`s from the errors.

- "FormData fields: text, number and boolean values validate": `fields: { name: "Alice", age: 3, subscribed: true }` passes with no errors.
- "FormData fields: a null, object, reference or list value is refused at its own path": `null`, `{ first: "A" }`, `{ $ref: "#/state/name" }` and `["a", "b"]` each fail with an error at `/state/fd/fields/<key>`.
- "FormData fields must be an object": `fields: ["name"]` and `fields: "name"` each fail at `/state/fd/fields`.
- "Blob: text parts and a string type validate": `parts: ["hello", " world"], type: "text/markdown"` passes, and so does a Blob with neither.
- "Blob: non-text parts or a non-string type is refused": `parts: "hello"` fails at `/state/b/parts`, `parts: [1]` at `/state/b/parts/0`, `type: 3` at `/state/b/type`.
- "the declarations bind only their own prototype": `{ $prototype: "URLSearchParams", fields: "title,date", type: 2, parts: 1 }` and `{ $prototype: "Gallery", $src: "./gallery.js", fields: ["title"], parts: 3, type: { kind: "grid" } }` both pass. Under the flat fallback this case inverts and asserts the refusal, naming the trade in its comment.
- "a typed entry still matches TypedStateDef alone": `{ type: "string", default: "" }` and `{ type: { $ref: "#/$defs/Point" }, default: {} }` pass, and so does `{ $prototype: "Blob", type: "text/plain", default: "" }`, each through exactly one `StateEntry` branch (no `oneOf` error).

Fixtures are inline. No existing case changes: `schema.test.ts` asserts `ExternalClassDef.properties.$prototype` only, and nothing snapshots the property list.

Coverage: the definition is a `const` literal, covered as soon as `src/schema.ts` imports it, and no `src/` file is added, so the manifest check and the per-file thresholds in `packages/schema/bunfig.toml` (`lines = 0.99, functions = 0.99`) are unaffected and nothing ratchets. The workspaces whose committed `document.schema.json` is regenerated (`examples`, `packages/starters`, `packages/studio`, `packages/ui`, `sites/*`) run in CI through `affected.ts` and must stay green; no tracked document uses the three properties. `bun run schema:validate-all` shows every tracked document still validates.

## Specs & docs

**`specs/schema.md` §3.1**, in place:

- The marker (line 47): "`ExternalClassDef` declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`, and a computed `state` entry" becomes "`ExternalClassDef` does not declare Request `urlParams`, and a computed `state` entry". If `plan:spec/request-url-params` landed first and the clause no longer names `urlParams`, delete the clause instead: the sentence becomes "A computed `state` entry is admitted by `StateEntry`'s plain string branch, not a pattern match.", and "four statements outrun" becomes "three statements outrun". The marker stays `> **Status: Partial.**`.
- The flat-set bullet (line 101): append "The exceptions are names one built-in alone reads: `FormData`'s `fields` (an object of strings, numbers and booleans) and `Blob`'s `parts` (an array of strings) and `type` (a string) are declared under an `if`/`then` on `$prototype`, so they bind only that prototype's entries, and a `URLSearchParams` param or an extension class parameter of the same name keeps its own shape."
- The Built-in Prototypes lines are left to `plan:schema/generator-inventory`, whose text already names `fields` and `parts, type`.

Under the flat fallback, the bullet instead gains "`FormData`'s `fields`, `Blob`'s `parts` and `type` are flat like the rest, so every `$prototype` that uses one of those names takes that shape.", and the marker edit is unchanged.

**Fragment** (single quotes, so the shell leaves `$prototype` alone): `bun run spec:change schema.md minor -m '§3.1: ExternalClassDef declares FormData fields and Blob parts and type, each bound to its own prototype by an if/then on $prototype.'`

**Docs.** No page's `spec:` cites a schema.md anchor, and no page's `code:` lists a file this plan changes. One page describes the field it now validates:

- `docs/studio/logic/data-sources.md`, FormData section: the bullet "**Fields**: a JSON object naming the fields and their starting values." gains "Each value is text, a number or true/false. The code view and `jx validate` flag a nested object or a list, which a form could only send as meaningless text." Add `packages/schema/defs/external-class-def.schema.ts` to the page's `code:` list, since the page documents every built-in source's fields and that file declares them.
- `docs/framework/concepts/data-prototypes.md` ("form fields assembled for submission", "binary data from parts and a MIME type") stays true and does not change.

This plan claims nothing, so it graduates nothing.

## Acceptance

- `cd packages/schema && bun test --isolate --coverage tests/prototype-config.test.ts` passes, and the full `bun test --isolate --coverage` in `packages/schema` passes with no file under its threshold; `bun scripts/check-coverage-manifest.ts packages/schema` passes.
- `bun run schema:verify` is green, and `bun -e 'console.log(JSON.stringify((await Bun.file("packages/schema/schema.json").json()).$defs.ExternalClassDef.allOf))'` prints the two `if`/`then` entries.
- `bun run schema:validate-all`, `bun run typecheck` and `bun run lint` pass.
- `sed -n 47p specs/schema.md | grep -c 'FormData'` prints 0, and the line still opens with `> **Status: Partial.**`.
- `bun run plans:status --who-claims schema.md#3.1` still names `plan:schema/generator-inventory`, whose `requires` no longer lists this plan; `bun run plans:check` passes.
- `bun run docs:spec-release`, `bun run docs:status`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass.
