---
status: drafted
disposition: implement
claims:
  - spec.md#5.7
requires: []
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: S
---

# One predicate decides that a state object is a pure type definition, in the interpreter and in built output

## Context

`specs/spec.md` §5.7, the leading marker:

> **Status: Partial.** The interpreter follows the steps below (`buildScope` in `packages/runtime/src/runtime.ts`), but an object with no `default`, `$prototype` or `$expression` is sorted by two different predicates, and the algorithm names neither. The interpreter treats it as a pure type definition, holding no value, when any key is one of its own schema keywords (`hasSchemaKeywords`); the compiled targets do so only when every key is one of a different set (`isSchemaOnlyDef` in `packages/schema/src/guards.ts`). So `{}` and `{ "description": "x" }` hold a value in the interpreter and none in built output, and `{ "type": "string", "label": "x" }` the reverse.

The marker was added in the closing pass of the detailing program. `plan:compiler/shared-utilities-signatures` found the split while detailing compiler.md §11 and recorded it in its Context; `plan:spec/cem-manifest-export`, `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` each work around it without owning it.

**What the code does** (verified against the working tree on 2026-09-27):

- **Interpreter.** `buildScope` (`packages/runtime/src/runtime.ts`, the object branch near line 840): `$prototype`, `$expression` and server-function entries are left to later passes; `default` present gives the value; otherwise `hasSchemaKeywords(def)` true skips the entry ("Shape 2b: pure type def"), and anything else is a Shape 1 value. `hasSchemaKeywords` (line 968) is true when ANY key is in the runtime's private `SCHEMA_KEYWORDS` (line 326): `type`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `examples`. The function is exported from `runtime.ts`, and nothing outside it imports it.
- **Compiled targets.** `isSchemaOnlyDef` (`packages/schema/src/guards.ts`, line 119, re-exported by `packages/compiler/src/shared.ts` as `isSchemaOnly`) is true when EVERY key is in `@jxsuite/schema`'s `SCHEMA_KEYWORDS` (line 101): the runtime's set minus `examples`, plus `format`, `description`, `title` and `$comment`. Callers: `shared.ts` line 298 (the fully-static check) and line 561 (`buildInitialScope`, which feeds the prerender), `compile-client.ts` line 195 (the page's `state` object) and `compile-element.ts` line 255 (`extractInitialValue`). `isSchemaOnlyDef({})` is `true`.
- `@jxsuite/schema/guards` also exports `hasSchemaKeywords` (line 132, ANY key in its own set), used only by `packages/schema/tests/guards.test.ts`.
- **The spec.** §5.7's steps have no pure-type step at all: step 6 makes every remaining plain object a Shape 1 value. §5.3's Shape 1 rule says "A plain object with no `$prototype`, no `type`, no `default`, and no `properties` is an object state property", a sufficient condition that says nothing about `{ "type": … }` without a `default`. The term "Shape 2b" lives only in code comments.
- **Blast radius.** A scan of every tracked `*.json` document's `state` for an object with no `default`, `$prototype` or `$expression` finds one entry: `examples/components/task-item.json`'s `task: {}`, the prop a row is handed. It is `{}` in the interpreter and absent in the compiled element, which is the case `plan:_shared/compiled-prop-bridge` records as correction 1 from the other side. No tracked document carries a `{ "type": … }` object without a `default` in `state`.

## Outcome

- spec.md §5.7 → Implemented. Its algorithm gains a step for a pure type definition, stated as one predicate, and both tiers call that predicate.
- spec.md §5.3's Shape 1 rule names the same predicate instead of the partial `type`/`properties` list.

## Decisions

- **Open:** which predicate. Recommendation: a state object with no `default`, `$prototype` or `$expression` is a pure type definition when **every key is a JSON Schema keyword and at least one of them is not an annotation**. The keyword set is the 2020-12 validation and applicator vocabulary Jx meets (the two sets today plus `const`, `$ref`, `minItems`, `maxItems`, `uniqueItems`, `additionalProperties`, `anyOf`, `oneOf`, `allOf`, `not`, `multipleOf`, `exclusiveMinimum`, `exclusiveMaximum`, `prefixItems`, `deprecated`, `readOnly`, `writeOnly`); the annotations are `description`, `title`, `$comment`, `examples`, `format`, `deprecated`, `readOnly` and `writeOnly`. Because the every-key half keeps a data object that happens to carry a `type` field (`{ "type": "admin", "name": "x" }`) a value, which the interpreter's any-key rule silently drops, and the not-only-annotations half keeps `{}` and `{ "title": "Hello" }` values, which the compiler's every-key rule silently drops. The two alternatives each keep one of today's defects: the interpreter's rule loses data objects with a keyword-named field, and the compiler's rule loses the empty object `task-item.json` relies on.
- **Decided:** the predicate lives in `@jxsuite/schema/guards` as `isPureTypeDef(value)`, beside `isExpandedSignal` and `isPrivateStateKey`, and both tiers import it. The runtime already depends on `@jxsuite/schema`, and a rule both tiers must apply has one home (the audit record's spec-wide decision). No generated module inlines it: the compiled targets decide at build time, so nothing ships the rule to a browser.
- **Decided:** `isSchemaOnlyDef`, `@jxsuite/schema`'s `hasSchemaKeywords` and the runtime's private `SCHEMA_KEYWORDS` and `hasSchemaKeywords` are deleted, and `SCHEMA_KEYWORDS` is redefined as the full keyword set with `SCHEMA_ANNOTATIONS` beside it. Two names for one question is how the split happened.
- **Decided:** no `requires`, and none of the three plans that work around the split requires this one. `plan:spec/cem-manifest-export` (its field rule reads `hasSchemaKeywords` as the interpreter does) and `plan:_shared/compiled-element-lifecycle` (`declaredDefaults` gains a `hasSchemaKeywords` branch) each name the runtime's predicate; whichever of each pair lands second calls `isPureTypeDef` instead, and the landing plan's tests (`cemModule`'s field cases, `declaredDefaults mirrors buildScope's shapes`) move with it. `plan:_shared/compiled-prop-bridge` takes its prop key set from the definition's keys, which no shape rule changes.

## Implementation

1. **`packages/schema/src/guards.ts`**
   - `SCHEMA_KEYWORDS` becomes the full keyword set named in the Open, with a JSDoc saying it is the vocabulary §5.7's pure-type step reads. Add `export const SCHEMA_ANNOTATIONS: ReadonlySet<string>` with the annotation keywords.
   - Add `export function isPureTypeDef(value: unknown): value is JxStateObject`: `isJsonObject(value)`, no `default`, `$prototype` or `$expression` key, at least one key, every key in `SCHEMA_KEYWORDS`, and some key not in `SCHEMA_ANNOTATIONS`. JSDoc cites spec.md §5.7 and gives the three examples from the Context.
   - Delete `isSchemaOnlyDef` and `hasSchemaKeywords`.
2. **`packages/runtime/src/runtime.ts`**: `buildScope`'s object branch replaces `if (hasSchemaKeywords(def)) { continue; }` with `if (isPureTypeDef(def)) { continue; }`, imported from `@jxsuite/schema/guards` in the existing import from that module. Delete the private `SCHEMA_KEYWORDS`, `hasSchemaKeywords` and its `export { hasSchemaKeywords }`. If `plan:_shared/compiled-element-lifecycle` has landed, its `declaredDefaults` branch calls `isPureTypeDef` too.
3. **`packages/compiler/src/shared.ts`**: re-export `isPureTypeDef` in place of `isSchemaOnlyDef as isSchemaOnly` (both re-export sites, lines 34 and 249), drop `SCHEMA_KEYWORDS` from the re-export if nothing in the compiler reads it, and call `isPureTypeDef` at lines 298 and 561. `compile-client.ts` line 195 and `compile-element.ts` line 255 import and call `isPureTypeDef`.
4. If `plan:spec/cem-manifest-export` has landed, `cemModule`'s field test in `packages/schema/src/cem-manifest.ts` reads `!isPureTypeDef(value)` where it read `hasSchemaKeywords(value)` is false.

**Integration contract.** Once this lands, `@jxsuite/schema/guards` exports `isPureTypeDef`, `SCHEMA_KEYWORDS` (the full set) and `SCHEMA_ANNOTATIONS`, and it is the only shape predicate for a pure type definition in the repository: every tier and every tool that sorts a state entry calls it. `isSchemaOnlyDef` and both `hasSchemaKeywords` are gone, so a plan that still names one rewrites the call when it lands.

## Tests

Run `bun test --isolate --coverage` from `packages/schema`, `packages/runtime` and `packages/compiler`, then `bun scripts/check-coverage-manifest.ts` for each. No source file is added. The per-file bars are `lines = 0.99, functions = 0.99` (`packages/schema`), `lines = 0.963, functions = 0.98` (`packages/runtime`) and `lines = 0.982, functions = 0.98` (`packages/compiler`); ratchet a workspace only if its worst file rises.

- **`packages/schema/tests/guards.test.ts`**: `describe("isSchemaOnlyDef")` and `describe("hasSchemaKeywords")` become `describe("isPureTypeDef (spec.md §5.7)")` with "a schema with an assertion is a pure type definition" (`{ type: "string" }`, `{ description: "n", maximum: 10, minimum: 0, type: "number" }`, `{ enum: ["a"] }`, `{ $ref: "#/$defs/Count" }`), "an object with a non-keyword key is a value" (`{ type: "admin", name: "x" }`, `{ type: "string", label: "x" }`), "annotations alone are a value" (`{}`, `{ description: "x" }`, `{ title: "Hello" }`, `{ examples: [1] }`), and "a default, a prototype or an expression is never a pure type definition". `describe("SCHEMA_KEYWORDS")` adds `const` and `anyOf`, and a new case checks every `SCHEMA_ANNOTATIONS` member is in `SCHEMA_KEYWORDS`.
- **`packages/compiler/tests/shared.test.ts`**: `describe("isSchemaOnly")` becomes a re-export pin for `isPureTypeDef`, with `isPureTypeDef({})` now `false`.
- **Agreement**, new `packages/compiler/tests/shape-agreement.test.ts`: a table of state objects (the examples above) built both ways, `buildScope` from `@jxsuite/runtime` and `buildInitialScope` from `../src/shared.ts`, asserting `key in scope` agrees for every row. The runtime is already a compiler dev dependency through its other agreement tests (`ref-build-time-agreement.test.ts`).
- **`packages/runtime/tests/runtime.test.ts`**: "a data object with a type field is a value" (`{ type: "admin", name: "x" }` gives that object) beside the existing Shape 2b case.

## Specs & docs

`specs/spec.md`, in place, no heading renumbered:

- **§5.7**: add a step between steps 5 and 6: "Value is an object whose every key is a JSON Schema keyword, at least one of them not an annotation (`description`, `title`, `$comment`, `examples`, `format`, `deprecated`, `readOnly`, `writeOnly`)? → a pure type definition: it declares the entry and holds no value until one is supplied (a prop, an attribute)." Renumber the old step 6 inside the code block to 7 (a list item in a fence, not a heading). Delete the leading Partial marker, and the trailing marker becomes "> **Status: Implemented.** `isPureTypeDef` in `@jxsuite/schema/guards` is the pure-type step in both tiers: the interpreter's `buildScope` and the compiler's `buildInitialScope`, page `state` and element initial values call it."
- **§5.3, Shape 1 rules**: "A plain object with no `$prototype`, no `type`, no `default`, and no `properties` is an object state property" becomes "A plain object with no `$prototype`, `$expression` or `default` is an object state property unless it is a pure type definition (§5.7): so `{}`, `{ "title": "Hello" }` and `{ "type": "admin", "name": "x" }` are values."
- **Fragment:** `bun run spec:change spec.md minor -m "§5.7 names the pure type definition step both tiers apply: an object whose every key is a JSON Schema keyword and not only annotations holds no value, so an empty object or a data object with a type field is a value in the interpreter and in built output alike."` Level minor: it redefines which entries hold a value in both tiers, an additive rule where the spec had none.

`specs/compiler.md` §11, in place: the H3 entry for `isSchemaOnly(def)` ("Shape 2b detection (pure type definitions)") is renamed to `isPureTypeDef(value)` with the summary "pure type definition detection (spec.md §5.7), re-exported from `@jxsuite/schema/guards`". If `plan:compiler/shared-utilities-signatures` has landed, its heading reads `isSchemaOnly(value)` and its Implemented marker says "`isSchemaOnly` is re-exported from `@jxsuite/schema/guards`"; rename both. **Fragment:** `bun run spec:change compiler.md patch -m "§11 names isPureTypeDef, the one pure type definition predicate both tiers share, in place of isSchemaOnly."`

Docs: `docs/framework/concepts/state.md` (`spec: spec.md#5`):

- "Shape 2: typed values", after the example: "An entry written as a schema alone, such as `{ "type": "number", "minimum": 0 }`, declares the name without a value until a prop or an attribute supplies one. An object with any other key, or with only descriptions and titles, is an ordinary value."
- "How it works": "a plain object with no reserved keys is a naked object value" becomes "an object made only of JSON Schema keywords, not only annotations, is a declaration with no value; any other plain object is a naked object value".
- Add `packages/schema/src/guards.ts` to the page's `code:` list (it has none today, so the list is new). No em dashes.

Landing deletes this file. If `plan:compiler/shared-utilities-signatures` has not landed, its "Noticed, not claimed" paragraph cites this plan: reword it to cite spec.md §5.7, or `plans:check` reports `citation-unknown`.

## Acceptance

- `git grep -n "isSchemaOnlyDef\|hasSchemaKeywords" -- packages` prints nothing.
- `bun -e 'import { isPureTypeDef } from "./packages/schema/src/guards.ts"; console.log([{}, { type: "string" }, { type: "admin", name: "x" }, { description: "x" }].map(isPureTypeDef).join())'` prints `false,true,false,false`.
- The agreement test passes, and fails if either tier's call is reverted.
- `bun run plans:status --spec spec` no longer lists `spec.md#5.7`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
