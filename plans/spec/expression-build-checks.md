---
status: drafted
disposition: implement
claims:
  - spec.md#19.3
  - spec.md#19.4
  - spec.md#19.5
requires: []
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - packages/studio
  - packages/starters
  - packages/ui
  - examples
  - sites/jxsuite.com
  - sites/test-blank
  - scripts/screenshots
  - specs
  - docs
size: M
---

# `jx build` and `jx validate` refuse what §19 calls a compile-time error: an unknown operator, a mutating node outside a handler, and `event#/` outside handler position

## Context

Three sections each state a compile-time error that nothing raises. They are one piece of work, a single position-aware walk over every expression tree that `jx build` and `jx validate` both run, so one plan claims all three.

`specs/spec.md` §19.3, line 1907:

> **Status: Partial.** Arity and mode routing ship (`isMutating` in `packages/runtime/src/expression.ts`; `buildScope` and the compiled targets route a mutating node to a handler and a pure node to a computed). Nothing enforces that a mutating node never appears as an operand: the schema's `ExpressionOperand` (`packages/schema/defs/expression-node.schema.ts`) admits the assignment and array-mutation branches, and the interpreter performs such a mutation as a side effect of evaluating the operand.

`specs/spec.md` §19.4, line 1936:

> **Status: Partial.** The set is closed in the schema, so `jx validate` rejects an unknown operator, and in the interpreter, which throws on one. The compiler does not refuse it: `compileExpression` (`packages/runtime/src/expression.ts`) falls through to `"undefined"`, a test pins that, and `jx build` runs no schema validation, so a document with an unknown operator builds. The table also omits `call` (§19.4c) and the §19.4d methods, which the closed set includes.

`specs/spec.md` §19.5, line 2135:

> **Status: Partial.** The scheme resolves in the interpreter and compiles to the handler's event parameter (`packages/runtime/src/expression.ts`). The compile-time error is not implemented: no compiler, schema or `jx validate` check restricts `event#/` to handler position, so a pure computed that reads it resolves against a null event.

**Verified at the working tree (2026-09-27).** The markers are right, with three corrections:

- `evaluateNode` throws `$expression: unknown operator "…"`; `compileExpression` has no such guard and ends in `return "undefined"`, reached by an unknown operator and by `!` carrying a `value`. `packages/runtime/tests/expression.test.ts` pins both (`unhandled operator compiles to undefined`, `unary operator with value present compiles to undefined`).
- An `event#/` read in a pure computed resolves against `null` only in the interpreter (`buildScope` pass 2.5, `runtime.ts:897`) and the build-time scope (`buildInitialScope`, `shared.ts:606`). Compiled, it is worse: both targets compile computeds with `eventParam: "e"` (`compile-client.ts:146`, `compile-element.ts:617`), so they emit `computed(() => e.target.value)` over an undeclared `e`, a `ReferenceError` on first read. A parameterised structured body (§20.3) and a named formula also run with `null` for the event (`runtime.ts:891`, `:921`), and so does a lifecycle hook (§16.4): `onMount`, `onUnmount` and `onAdopted` are `state` entries called with `(state, host)` or `(state)` (`runtime.ts:249`, `:4446`), never with an event, and §20.2 names "a lifecycle hook" as a body run without one.
- The build runs no schema validation at all: no `ajv` import exists in `packages/compiler/src` outside `site/validate-command.ts`, whose step 3 validates `components/`, `pages/` and `layouts/` against the ~770 KB project `document.schema.json`.

**What exists.** `BLESSED_OPERATORS`, `MUTATING_OPS` and `isMutating` in `expression.ts`, and a second copy of the same operator vocabulary as enums in `expression-node.schema.ts`, with no drift test between them. The element walker `walk` in `packages/schema/src/overlays.ts` (children, repeater `map` templates, `$switch` cases), which the popover and dialog lints use. The guards `isExpressionDef`, `isNamedFormulaDef`, `hasStructuredBody` in `packages/schema/src/guards.ts`. Studio's expression editor (`packages/studio/src/ui/expression-editor.ts`) already gates `event#/` by position (`allowEventRef`), but its operator select and formula palette offer the assignment and array-mutation operators in every nested operand slot.

**The corpus.** A position-aware scan of every committed JSON document (848 files outside `node_modules`, `dist` and generated schemas: 145 `$expression` entries, 722 structured Function bodies, 415 `event#/` reads, 10 lifecycle hooks) finds no violation of any of the three rules. No shipped document changes behaviour. Two test fixtures do (see Tests).

**Related.** `plan:spec/named-formula-recursion` also adds a build and `jx validate` refusal (call cycles) and also reads `project.json`'s `state` in `validate-command.ts`; `plan:spec/tag-expression-completion-lint` owns the §19.6 lint, a walk over assignment targets. Neither is ordered against this plan (see Decisions).

## Outcome

- spec.md §19.3 → Implemented. A mutating node anywhere but a handler boundary fails `jx build` and `jx validate` with its JSON Pointer, and the schema's operand grammar admits only pure nodes, so an editor validating against it marks the same node.
- spec.md §19.4 → Implemented. An unknown operator fails `jx build` and `jx validate` wherever it sits, `compileExpression` throws on one instead of emitting `undefined`, and the table lists `call` and the §19.4d methods.
- spec.md §19.5 → Implemented. An `event#/` pointer outside handler position fails `jx build` and `jx validate`, and §19.5 defines handler position.

## Decisions

- **Open:** does `jx build` validate documents against the JSON Schema? This plan owns the question; three other plans assumed an answer. Recommendation: no. The build runs structural checks shared with `jx validate` (this plan's walk, `plan:spec/named-formula-recursion`'s cycle check), and full schema validation stays `jx validate`'s. Reasons: §19's rules are positional (`event#/` depends on the entry's kind and its root operator), which JSON Schema can state only by duplicating the node grammar once per position, so the build needs the walk either way; schema validation needs `ajv` and a compile of the ~770 KB entry document on every build; and it would refuse every project that builds today with an unrelated schema defect, a breaking change nobody has measured. `plan:schema/build-schema-agreement` (no build validation of `project.json`), `plan:schema/parse-boundary-readers` (independent of the answer) and `plan:spec/report-dropped-reactive-styles` (its refusal lives in the schema and `jx validate`) are all consistent with this answer. The alternative is a schema pass at the top of `buildSite` that fails the build on any `validateDoc` error, which makes this plan's schema edit sufficient for §19.3 and §19.4 but still leaves §19.5 to the walk.
- **Open:** does §19.5's rule cover a structured body with `parameters` (§20.3's positional callable)? §19.5 names only "a `state`-entry expression that is not invoked as a handler". Recommendation: yes. The interpreter runs that body with a `null` event (`runtime.ts:921`) whatever binds it, so `event#/` there always reads `undefined`, the defect §19.5 forbids; `docs/framework/concepts/statements.md` already says only the parameterless form sees `event#/`. §19.5 is reworded to define handler position positively (below). If review says no, the walker classifies such a body as `handler` and the §19.5 text drops the clause.
- **Open:** refuse at once, or warn for a release first? Recommendation: refuse at once. The spec has called all three a compile-time error since §19 was written, `docs/framework/concepts/expressions.md` says so today, nothing committed is affected, the specs are pre-1.0, and every finding names its pointer. A warning release would ship output the spec calls wrong: a computed that throws `ReferenceError`, or a page containing `undefined` where an expression was.
- **Decided:** the walk lives in `packages/schema/src/expressions.ts` (exported as `@jxsuite/schema/expressions`), beside the popover, dialog and accessibility lints, not beside `compileExpression` as the stub proposed. It needs the document structure (the `walk` in `overlays.ts`, the guards) and the operator vocabulary, `@jxsuite/runtime` depends on `@jxsuite/schema` and not the reverse, and `validate-command.ts`, the compiler and Studio already import the lint family from there. The operator sets are derived from the enums in `defs/expression-node.schema.ts`, and a runtime test asserts `BLESSED_OPERATORS` and `isMutating` agree with them.
- **Decided:** the position model. Every expression tree sits in one of six positions:

  | Position    | Where                                                                                                                                                                | `event#/` | Mutating node                                                 |
  | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
  | `handler`   | a `state` entry whose root is mutating; an `on*` key's `$expression`; a structured body on an `on*` key, or in `state` without `parameters`, except a lifecycle hook | allowed   | as the root, and as any statement                             |
  | `lifecycle` | a `state` entry named `onMount`, `onUnmount` or `onAdopted` (§16.4) that the `handler` row would otherwise take                                                      | refused   | as the root, and as any statement                             |
  | `callable`  | a structured body in `state` with non-empty `parameters`                                                                                                             | refused   | as any statement                                              |
  | `computed`  | a pure `state` entry without `parameters`                                                                                                                            | refused   | never (its root is pure by definition)                        |
  | `formula`   | a named formula (`isNamedFormulaDef`)                                                                                                                                | refused   | never, root included (§19.4c: "a pure, reusable computation") |
  | `tag`       | an element's `tagName.$expression`                                                                                                                                   | refused   | never                                                         |

  Operand slots are a node's `target`, `value`, `initial`, `default` and each `cases` value, recursively, with arrays descended; a statement's `if`, `$switch` and `detail` are operand slots too. A plain-object literal (no `$ref`, no `operator`) is data (§19.2) and is not descended. This follows what the interpreter actually binds (`bindHandler`, `buildScope` passes 2.5 and 3, `resolveTagName`), so no shipped handler is reclassified. The `lifecycle` row is §19.5's own text, not an extension of it: a lifecycle hook is "a `state`-entry expression that is not invoked as a handler", §20.2 lists it among the bodies run without an event, and the compiled element calls `onMount(this.state)`. Only the interpreter's mutating `$expression` hook receives anything in the event slot, and that is the host element `onMount` passes second, so an `event#/` read there reads the host by accident; no committed document does.

- **Decided:** a finding is an error in both commands. The build throws and the route or component fails through `buildSite`'s existing `Error compiling …` reporting; `jx validate` reports it as an issue, so the project is INVALID without `--strict`. §19 says "compile-time error", and the documented loop is "`jx build` only once validate is clean". The walk runs on every parseable document, schema-valid or not (its message is the readable one where the schema's `oneOf` reports a cascade), and on `project.json`, whose `state` every page inherits; its findings join the same file's issue ahead of the schema's.
- **Decided:** the build checks at three points: `compile()` after the class-definition route (every page target, and `compile-cli.ts`'s single-file compile), `compileElement`'s per-document step (every component and each `$elements` dependency), and `compilePage` directly after `injectContext`, before `resolvePrototypes` and `buildInitialScope` evaluate anything, so a refused page is never evaluated at build time and project state (merged by `injectContext`) is judged with it. The second check a site route gets inside `compile()` is one walk and finds nothing new.
- **Decided:** the schema gains a `PureExpressionNode` def (today's node grammar minus the four mutating branches) and every operand position refers to it: `ExpressionOperand`'s node member, `reduce`/`map`/`filter`'s `target` and per-item `value`, and, through `ExpressionOperand`, a statement's `if`/`$switch`/`detail` and a tag expression's `target`. `ExpressionNode` keeps all branches for the two root positions (`ExpressionEntry.$expression`, a statement), and `ExpressionEntry` requires a pure root when it declares non-empty `parameters`. `event#/` stays out of the schema: its legality depends on the entry's kind and root operator, and the walk is its one judge.
- **Decided:** `compileExpression` throws `$expression: unknown operator "…"` (the interpreter's message) on an operator outside the set, and throws instead of returning `"undefined"` for a node it cannot lower (today only `!` carrying `value`). The interpreter is unchanged: §19 states compile-time errors, the interpreter already throws on an unknown operator, and arity stays the schema's to report (`!` with `value` fails the `Unary` branch in `jx validate`).
- **Decided:** Studio's expression editor stops offering the mutating operators in an operand slot: an operand node's select and its formula palette leave out assignment and the array-mutation methods. Otherwise the editor offers exactly the node the build now refuses, and the change is cheap because a `packages/schema` and `packages/runtime` change already runs Studio's suite in CI. The test is the slot, not `depth`: the Logic tab mounts every selection, a handler's own root included, at `depth: 1`. Studio's Problems panel is not one of §19's tiers and does not run the walk; it keeps reporting what the schema reports.
- **Decided:** no `requires`. `plan:spec/named-formula-recursion` shares only a file (its validate issues and this plan's both go through `issues`, and whichever lands second shares one guarded read of `project.json` and appends its clause to `cli.md`'s "Checks, in order" sentence after the other's); either may land first, and its cycle check may later collect edges from `walkExpressions` without changing its result. `plan:spec/tag-expression-completion-lint` may require this plan to use `walkExpressions` for its lint; that edge is written by it (its text still places `walkExpressions` in `@jxsuite/runtime/expression`, which this plan does not).

## Implementation

1. **`packages/schema/defs/expression-node.schema.ts`**
   - Name each of the twelve `oneOf` branches as a module constant (`unaryBranch`, `binaryBranch`, `assignmentBranch`, `noArgMethodBranch`, `oneArgMethodBranch`, `spliceBranch`, `reduceBranch`, `mapFilterBranch`, `conditionalBranch`, `switchBranch`, `pureMethodBranch`, `callBranch`) and the shared frame (`additionalProperties`, `properties`, `required`, `type`) as `nodeFrame`.
   - `expressionNodeSchema = { ...nodeFrame, description, oneOf: [all twelve, in today's order] }`: byte-identical `oneOf` apart from the two `$ref` edits below.
   - New `export const pureExpressionNodeSchema = { ...nodeFrame, description: "An expression node that computes a value and mutates nothing: the only node an operand may hold (spec §19.3).", oneOf: [the eight pure branches] }`.
   - `expressionOperandSchema.anyOf[1]` becomes `{ $ref: "#/$defs/PureExpressionNode" }`. In `reduceBranch` and `mapFilterBranch`, `target.anyOf[1]` and `value` become `#/$defs/PureExpressionNode`.
   - `expressionEntrySchema` gains `if: { properties: { parameters: { minItems: 1, type: "array" } }, required: ["parameters"] }, then: { properties: { $expression: { $ref: "#/$defs/PureExpressionNode" } } }`, and its description a sentence: "A named formula is pure, so its root is a PureExpressionNode."
   - Export `pureExpressionNodeSchema` from `defs/index.ts` and register it as `PureExpressionNode` after `ExpressionNode` in `generateSchema`'s `$defs` (`packages/schema/src/schema.ts`).
2. **`packages/schema/src/expressions.ts`** (new, `@docs framework/concepts/expressions` in its module comment), and `"./expressions": "./src/expressions.ts"` in `packages/schema/package.json` `exports`.
   - `MUTATING_OPERATORS` (assignment enum, `NoArgMethod`, `OneArgMethod`, `splice`), `PURE_OPERATORS` (unary, binary, `?:`, `switch`, `call`, the pure-method enum, `reduce`, `map`, `filter`) and `EXPRESSION_OPERATORS` (their union), each a `ReadonlySet<string>` built from the imported def objects, never retyped.
   - `export type ExpressionPosition = "handler" | "lifecycle" | "callable" | "computed" | "formula" | "tag"` and `export interface ExpressionVisit { kind: "node" | "ref"; value: JsonObject; path: (string | number)[]; position: ExpressionPosition; handlerBoundary: boolean }`, where `handlerBoundary` is true exactly where the Decided table admits a mutating node (a `handler` or `lifecycle` root, and every statement in a `handler`, `lifecycle` or `callable` body). `LIFECYCLE_HOOKS` is a module-private `ReadonlySet` of `onMount`, `onUnmount` and `onAdopted`.
   - `export function* walkExpressions(doc: unknown): Generator<ExpressionVisit>`: for each `{ node, path }` of `walk(doc)` (`./overlays.ts`), when `doc` is a JSON object: each `state` entry per the table (`isExpressionDef`, then `isNamedFormulaDef` or the root operator's membership of `MUTATING_OPERATORS`; `hasStructuredBody`, then `parameters.length`; a would-be `handler` whose key is in `LIFECYCLE_HOOKS` is `lifecycle`); each element key starting `on` whose value `isExpressionDef` or `hasStructuredBody` (always `handler`); `tagName` when it is an object with an object `$expression` (`tag`; not `isTagExpression`, so a malformed choice is still judged). A tree yields its node, then its operand slots in key order (`target`, `value`, `initial`, `cases` in object order, `default`), a `{ $ref }` operand as a `ref` visit. A statement list yields each statement: a node statement as a node visit, `if`/`$switch`/`detail` as operand slots, `then`/`else`/case lists/`default` as nested lists. Anything malformed (a non-object `state`, a node whose `operator` is not a string, a non-array body) is skipped, never thrown on: the schema reports shape.
   - `export type ExpressionRule = "unknown-operator" | "mutating-outside-handler" | "event-outside-handler"`, `export interface ExpressionDefect { rule: ExpressionRule; path: (string | number)[]; pointer: string; message: string }`, and `export function findExpressionDefects(doc: unknown): ExpressionDefect[]` over `walkExpressions`, in document order. `pointer` is RFC 6901 (`~` → `~0`, `/` → `~1`, private `segment` as in `json-layout.ts`). Messages:
     - `unknown-operator`: `unknown operator "typeof": the operator set is closed (spec §19.4), so this logic belongs in a Function body`.
     - `mutating-outside-handler`: `"push" writes to its target, so it may only be a handler's root or a statement (spec §19.3), not ${where}`, with `where` one of `an operand`, `the root of a named formula`, `part of a tagName expression`.
     - `event-outside-handler`: `event#/target/value reads the handler's event, but ${what} runs with no event (spec §19.5)`, with `what` one of `a computed entry`, `a lifecycle hook`, `a named formula`, `a structured body with parameters`, `a tagName expression`.
3. **`packages/runtime/src/expression.ts`**, `compileExpression`: first statement `if (!BLESSED_OPERATORS.has(operator)) throw unknownOperator(operator)`, with `unknownOperator(op)` a private helper that `evaluateNode` also uses, so the two messages cannot drift. The trailing `return "undefined"` becomes a throw whose message is `$expression: "${operator}" cannot take the operands given (spec §19.3)`.
4. **`packages/compiler/src/shared.ts`**: `export function assertExpressionRules(doc: unknown): void` throws one `Error` when `findExpressionDefects(doc)` is non-empty, its message `expression rules (spec.md §19):` followed by one line `  <pointer>: <message>` per defect.
5. **Build call sites.** `packages/compiler/src/compiler.ts` `compile()`: `assertExpressionRules(raw)` after the `isClassDef` route. `packages/compiler/src/targets/compile-element.ts` `processElement`: `assertExpressionRules(doc)` after the hyphen check. `packages/compiler/src/site/site-build.ts` `compilePage`: `assertExpressionRules(layoutDoc)` directly after `injectContext(...)`. Every host that builds reaches these through `buildSite` (`jx build`, `jx dev` via `packages/server/src/dev.ts`, Studio's build in `studio-api.ts`, the desktop session in `project-session.ts`) or `runCli` (`compile-cli.ts`); the interpreting hosts (live preview, canvas) compile nothing and are unchanged.
6. **`packages/compiler/src/site/validate-command.ts`**, `validateProjectTree` (and the module docstring's walk list):
   - After step 2, parse `project.json` (guarded; an unreadable file is step 2's report) and map `findExpressionDefects(project)` to `{ instancePath: pointer, message }` errors, merged into step 2's `project.json` issue or pushed as a new one.
   - In step 3, for every parsed document, compute the same errors before `validateDoc`, and push one issue per file carrying them followed by the schema's errors. `lintDocument` still runs only on a schema-valid document. `formatProjectTreeIssues` needs no change: it prints `  - /state/total/$expression/target: "push" writes …`.
7. **Studio.** The restriction is keyed to the slot a node sits in, never to `depth`: `paintEditor` in `packages/studio/src/panels/formula-workspace.ts` mounts every Logic-tab selection at `depth: 1`, a handler's own root included, so a `depth > 0` rule would take `=` and `push` from that root.
   - `packages/studio/src/ui/expression-editor.ts`: `ExpressionEditorOpts` gains `operand?: boolean` (the mounted node sits in an operand slot, spec §19.3). `walkExpression` gains an `operand: boolean` parameter: `flattenExpression` passes `opts.operand === true`, and its two nested calls (`walkOperand`'s, and the aggregate per-item one) pass `true`. `const OPERAND_OPERATOR_SELECT_GROUPS = restrictGroups([...PURE_OPERATORS])`; the operator row's `groups` becomes `grammar ? restrictGroups(grammar) : operand ? OPERAND_OPERATOR_SELECT_GROUPS : OPERATOR_SELECT_GROUPS`, and when `operand` the palette's `entries` drop the `kind === "operator"` entries whose `name` is in `MUTATING_OPERATORS`. A statement's operand editor (`mountOperandEditor` → `flattenOperand` → `walkOperand`) is covered by `walkOperand`'s call; a statement node (`statement-editor.ts`) and every root mount pass no `operand` and keep the full table.
   - `packages/studio/src/panels/formula-workspace.ts` `paintEditor`: pass `operand: held.selectedPath.length > 0`.
8. **Generated schemas.** `bun run schema:sync` regenerates the core artifacts under `packages/schema/` and the entry documents of the 28 project roots (`examples`, `packages/starters/sites/*`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures/*`, `sites/jxsuite.com`, `sites/test-blank`). Commit them; `schemas.yml` would otherwise backfill them. `bun run schema:validate-all` must stay green: every committed document still validates under the narrower operand.

**Integration contract.** Once this lands: `@jxsuite/schema/expressions` exports `EXPRESSION_OPERATORS`, `PURE_OPERATORS`, `MUTATING_OPERATORS`, `walkExpressions`, `findExpressionDefects` and the `ExpressionPosition`, `ExpressionVisit`, `ExpressionRule` and `ExpressionDefect` types. A later document-level expression check iterates `walkExpressions` rather than writing its own traversal: assignment targets are node visits whose operator is in `MUTATING_OPERATORS`, read at `value.target.$ref`; a tag discriminant is the `target` slot under a `tag` root. `assertExpressionRules(doc)` in `packages/compiler/src/shared.ts` runs in `compile()`, `compileElement` and `compilePage` before any build-time evaluation, and `jx validate` reports each defect as an issue whose `instancePath` is its pointer. The schema's `PureExpressionNode` def is the operand grammar, and `compileExpression` never returns `"undefined"` for a node. A Studio surface that mounts a sub-node of an expression passes `ExpressionEditorOpts.operand` when that node sits in an operand slot.

## Tests

Run `bun test --isolate --coverage` from `packages/schema`, `packages/runtime`, `packages/compiler` and `packages/studio`, and `bun scripts/check-coverage-manifest.ts` for each.

**`packages/schema/tests/expressions.test.ts`** (new):

- `the operator sets are the schema's`: `EXPRESSION_OPERATORS` equals the union of every operator enum and const in `defs/expression-node.schema.ts`, `MUTATING_OPERATORS` is exactly the ten assignment and array-mutation tokens, and `PURE_OPERATORS` is the difference.
- `a document using every position correctly reports nothing`: a mutating entry reading `event#/target/value`, an inline `onclick` `call`, a parameterless structured body with `event#/key` in an `if`, a named formula over `$args/`, a `reduce` computed, a `?:` tag choice.
- `an unknown operator is reported wherever it sits`: an entry root, a nested `target`, a `switch` case, a statement's `if`, a tag choice's `target`, each with its pointer.
- `a mutating node is refused in every operand slot`: `target`, `value`, `initial`, a case, `default`, a `call` argument, an aggregate per-item `value`, a statement's `if`, `$switch` and `detail`, a tag `target`.
- `a mutating node is admitted at every handler boundary`: a `state` entry root, an `on*` root, a statement at any nesting in a handler body and in a callable body.
- `a named formula's mutating root is refused`.
- `event#/ is refused in a computed, a named formula, a callable body and a tag choice, and admitted in a mutating entry, an inline handler and a parameterless body`.
- `a lifecycle hook may mutate but never reads event#/`: an `onMount` mutating entry and an `onUnmount` parameterless body report nothing, and each reports `event-outside-handler` once it reads `event#/`.
- `an on* structured body with parameters is still a handler`.
- `a plain-object literal is not descended` (an `Intl` options bag in a computed, one of whose members is `{ "$ref": "event#/x" }`, reports nothing).
- `nested elements, repeater templates and $switch cases are walked`, asserting the pointers.
- `project.json's state is judged like a document's`.
- `pointers escape ~ and /` (a state key `a/b~c` gives `/state/a~1b~0c/$expression/target`).
- `malformed input is skipped, never thrown on`.
- `walkExpressions yields positions and handler boundaries in document order`.

**`packages/schema/tests/expression-operand-purity.test.ts`** (new, real `validateDocument`, the `style-value-ref.test.ts` pattern): a nested `push` in a computed's `target` is invalid; the same `push` as a mutating entry's root, and as a structured-body statement, is valid; a mutating per-item `map` value is invalid; a named formula with an `=` root is invalid and without `parameters` is valid. `schema.test.ts`, `generateSchema`: `PureExpressionNode` is registered, has eight branches, and `ExpressionOperand` refers to it.

**`packages/runtime/tests/expression.test.ts`**: `compileExpression — fallthrough` becomes `compileExpression refuses what it cannot lower`: `an unknown operator throws the interpreter's message` (`toThrow('$expression: unknown operator "typeof"')`) and `a unary operator carrying a value throws`. New `the operator sets agree with the schema`: `BLESSED_OPERATORS` equals `EXPRESSION_OPERATORS`, and `isMutating(op) === MUTATING_OPERATORS.has(op)` for every operator.

**`packages/compiler/tests/`**:

- `expression.test.ts`, new `describe("expression rules at build time (spec §19.3 to §19.5)")`: `compile() refuses an unknown operator, a mutating operand and a computed reading event#/, naming each pointer`; `compileElement refuses a component that breaks a rule`; `assertExpressionRules is silent on a clean document`.
- `site-build-reporting.test.ts`: `a page breaking an expression rule fails its route with the pointer, and other routes still build`; `a project.json formula breaking a rule fails every route that inherits it`; `a component breaking one fails as a component compile`.
- `validate-command.test.ts`: `reports expression-rule findings as issues, without --strict`; `reports them on a document the schema also refuses, first`; `judges project.json's state`; the fixture's clean tree stays valid.
- `compile-element.test.ts`, `an inline and an $expression handler inside a map publish it as well`: its `$expression` handler uses `operator: "increment"`, which compiles today only because `compileExpression` falls through. It becomes `+=` with `value: 1`; the assertions, which read only the prefix, stay.

**`packages/studio/tests/expression-editor.test.ts`**, `the editor offers only the operators the position admits`: `a nested operand keeps the whole table` becomes `a nested operand keeps every pure operator and the catalog, and no mutating one` (adds `not.toContain("push")` and `not.toContain("=")`); new `the root still offers the mutating operators, at any depth`; `a nested palette leaves out the mutating operator entries`; `a statement's if operand, once a formula, offers pure operators only`; `a mount marked operand offers pure operators only`. In `aggregate value and initial editing`, `editing the per-item expression propagates through value` picks `pop` in the per-item select, which this removes: it picks a pure operator (`toSorted`) and expects that node.

**`packages/studio/tests/formula-workspace.test.ts`**: `event-type target` › `resolves the element event binding's $expression and edits write through` already reoperates a handler root from `+=` to `=` and must pass unchanged; new `a selected operand step offers pure operators only` (select a nested chip, then assert the picker has no `=` and no `push`).

**Coverage.** Per-file thresholds: `packages/schema/bunfig.toml` `lines = 0.99, functions = 0.99` (the new `expressions.ts` must meet it, and the manifest check fails if no test imports it), `packages/runtime` `0.963 / 0.98`, `packages/compiler` `0.982 / 0.98`, `packages/studio` `0.958 / 0.941`. Raise a workspace's threshold to just below the new minimum if its worst file rises.

## Specs & docs

**`specs/spec.md`, edited in place:**

- **§19.3.** The marker becomes:

  ```markdown
  > **Status: Implemented.** Arity and mode routing ship (`isMutating` in `packages/runtime/src/expression.ts`; `buildScope` and the compiled targets route a mutating node to a handler and a pure node to a computed). A mutating node outside a handler boundary fails `jx build` and `jx validate` (`findExpressionDefects`, `packages/schema/src/expressions.ts`), and the schema's `ExpressionOperand` admits only a `PureExpressionNode`.
  ```

  After "a mutating node may only appear at a handler boundary, never as an operand." add:

  ```markdown
  A **handler boundary** is the root of a mutating `state` entry or of an inline event-handler `$expression` (§19.6), and a statement of a structured body (§20.2). Anywhere else a mutating node is a compile-time error that `jx build` and `jx validate` report: in an operand (a `target`, `value`, `initial`, `switch` case or `default`, `call` argument or aggregate per-item expression), in a statement's `if`, `$switch` or `detail`, at the root of a named formula (§19.4c), and in a `tagName` expression.
  ```

- **§19.4.** The marker becomes:

  ```markdown
  > **Status: Implemented.** The set is closed in every tier: `jx validate` rejects an unknown operator through the schema, the interpreter throws on one, `compileExpression` (`packages/runtime/src/expression.ts`) refuses to lower one, and `jx build` fails the page or component that uses one (`findExpressionDefects`, `packages/schema/src/expressions.ts`).
  ```

  "An operator outside this list is a compile-time error; logic requiring it must use a `body` string." becomes "An operator outside this list is a compile-time error (`jx build` fails the page or component that uses it, and `jx validate` reports it); logic requiring it must use a `body` string." The table gains two rows after `Aggregate (pure)`:

  ```markdown
  | Call (pure) | `call` (see §19.4c) |
  | Method (pure) | the `String`, `Array` and `Number` methods of §19.4d |
  ```

  The closing paragraph becomes:

  ```markdown
  All tokens except `call`, the methods and `switch` are genuine ECMAScript operator punctuators (`?:` names the conditional operator's two punctuators as one token; `??` is nullish coalescing). `switch` is the ECMAScript selection keyword, mirroring the element-level `$switch` (§14). The array, aggregate and §19.4d methods are genuine `Array.prototype`, `String.prototype` and `Number.prototype` methods, and `call` is a genuine `Function.prototype` name (§19.4c). No token in this table is invented.
  ```

- **§19.5.** The marker becomes:

  ```markdown
  > **Status: Implemented.** The scheme resolves in the interpreter and compiles to the handler's event parameter (`packages/runtime/src/expression.ts`). An `event#/` pointer outside handler position fails `jx build` and `jx validate` (`findExpressionDefects`, `packages/schema/src/expressions.ts`).
  ```

  The two sentences from "`event#` is resolvable only within an expression node used as an event handler." to "… is a compile-time error." become:

  ```markdown
  `event#` is resolvable only in **handler position**: the tree of an inline event-handler `$expression`, of a structured body (§20) bound inline to an event, and of a mutating `state` entry or a `state` structured body without `parameters` that is not a lifecycle hook. A pure `state` entry, a named formula (§19.4c), a structured body with `parameters` (§20.3), a lifecycle hook (§16.4) and a `tagName` expression are evaluated with no event, so an `event#/` pointer in any of them is a compile-time error that `jx build` and `jx validate` report.
  ```

  If the second Open resolves no, "a structured body with `parameters` (§20.3)" moves from the second sentence to the first, and "without `parameters`" leaves it.

**Fragment:** `bun run spec:change spec.md minor -m '§19.3 to §19.5: jx build and jx validate refuse an unknown operator, a mutating node outside a handler boundary and an event#/ pointer outside handler position, the schema operand admits only pure nodes, and the operator table lists call and the pure method operators.'`

**Docs** (em dashes are banned in every page below):

- `docs/framework/concepts/expressions.md` (`spec: spec.md#19`): frontmatter gains `code: [packages/schema/src/expressions.ts]` (appended to whatever `plan:spec/named-formula-recursion` (`expression.ts`) and `plan:spec/tag-expression-completion-lint` (`tag-expressions.ts`) have added if either lands first). Line 78's "Anything outside it is a compile-time error" becomes "Anything outside it fails `jx build` and `jx validate`". The **Rules** bullets become: "The operator set is **closed**. `jx build` and `jx validate` refuse an unknown operator; escalate to a Function `body` instead." / "A mutating node may only be a handler's top step or a statement in a structured body. Nested as an operand, as a named formula's top step or inside a tag choice, it fails the build." / "`event#/` resolves only in handler position. A computed entry, a named formula, a structured body with `parameters`, a lifecycle hook (`onMount`, `onUnmount`, `onAdopted`) and a tag choice run with no event, so reading `event#/` in one fails the build."
- `docs/framework/concepts/references.md` (`spec: spec.md#19.5`): line 92 becomes "`event#` is resolvable only in handler position: an inline handler, or a mutating entry or structured body without `parameters` that is not a lifecycle hook. Everywhere else nothing passes an event, so `jx build` fails and `jx validate` reports the pointer." Line 117's bullet becomes "`event#/` is valid only in handler position (see above)."
- `docs/framework/concepts/statements.md` (`spec: spec.md#20`): after line 120's paragraph, add "A body with `parameters` runs with no event, and so does a lifecycle hook (`onMount`, `onUnmount`, `onAdopted`), so reading `event#/` in either is a build error."
- `docs/framework/build/cli.md` (`code:` lists `validate-command.ts`): in `jx validate`'s "Checks, in order" sentence, after the document-schema clause, add "every one of those documents and `project.json`'s `state` against the [expression rules](/docs/framework/concepts/expressions) (an unknown operator, a mutating operator nested as an operand, `event#/` outside a handler), which `jx build` enforces too;".
- `docs/framework/agents.md` (`code:` lists `validate-command.ts`), whose "five passes" list names each check: pass 2 becomes "`project.json` against the generated entry schema, and its `state` against the [expression rules](/docs/framework/concepts/expressions)." and pass 3 gains ", and against the same expression rules" before its full stop.
- `docs/framework/build.md` (`code:` lists `site-build.ts`): step 4 gains "check its [expressions](/docs/framework/concepts/expressions) against the rules a build enforces," before "resolve build-time data".
- `docs/studio/logic/formulas.md` (`code:` lists `expression-editor.ts`): after the **Target** and **Value** bullet's "drawn indented beneath its parent.", add "A nested formula computes a value, so its operator list leaves out assignment and the array-mutation operators, which only a handler's top step may use."
- `docs/studio/logic/formula-workspace.md` (`code:` lists `formula-workspace.ts`): the **Editor pane** bullet gains "A step nested inside another offers only the operators that compute a value."
- No other page changes. `bun run docs:sync` also names pages whose `code:` lists `compile-element.ts`, `shared.ts`, `site-build.ts`, `validate-command.ts` or `formula-workspace.ts` (`functions.md`, `lists.md`, `components.md`, `styling.md`, `elements.md`, `color-schemes.md`, `redirects.md`, `deployment.md`, `seo.md`, `accessibility.md`, `authoring-rules.md`, `problems-and-progress.md`, `code.md`, `interface.md`); none describes expression checking, an operator list, or validate's checks item by item. The generated operators page reads the operator sets and needs nothing.

This plan does not graduate `spec.md`: its other open items stay with their plans.

## Acceptance

- From each of `packages/schema`, `packages/runtime`, `packages/compiler` and `packages/studio`: `bun test --isolate --coverage` is green with no file under its `bunfig.toml` threshold, and `bun scripts/check-coverage-manifest.ts packages/<pkg>` passes.
- This prints the pointer `/state/bad/$expression/target` and the `"push"` message:

  ```sh
  bun -e 'import { compile } from "./packages/compiler/src/compiler.ts"; try { await compile({ tagName: "div", state: { list: [], bad: { $expression: { operator: "+", target: { operator: "push", target: { $ref: "#/state/list" }, value: 1 }, value: 0 } } } }); } catch (e) { console.log(e.message); }'
  ```

- This prints one `event-outside-handler` defect at `/state/v/$expression/target`:

  ```sh
  bun -e 'import { findExpressionDefects } from "./packages/schema/src/expressions.ts"; console.log(findExpressionDefects({ tagName: "p", state: { v: { $expression: { operator: "!", target: { $ref: "event#/target/checked" } } } } }))'
  ```

- `bun run schema:verify` and `bun run schema:validate-all` are green (the regenerated schemas are committed, and every committed document still validates).
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` are green, and `bun run plans:status --spec spec` no longer lists §19.3, §19.4 or §19.5.
