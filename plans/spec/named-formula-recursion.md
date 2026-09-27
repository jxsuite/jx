---
status: drafted
disposition: implement
claims:
  - spec.md#19.4c
requires: []
workspaces:
  - packages/runtime
  - packages/compiler
size: M
---

# A named formula that reaches itself fails the build and `jx validate`, and every tier stops runaway recursion at `MAX_CALL_DEPTH`

## Context

`specs/spec.md` §19.4c, line 2050:

> **Status: Partial.** Named formulas, `$args/`, `call`, `BLESSED_GLOBALS` and `BLESSED_HELPERS` ship (`packages/runtime/src/expression.ts`). Recursion is not bounded as stated: no compiler check rejects a call cycle, the callable `buildScope` builds does not carry `callDepth`, so `MAX_CALL_DEPTH` bounds only the raw-definition path, and compiled formulas (`emitFormulaFn` in `packages/compiler/src/shared.ts`) have no bound. The helper table is stale: eight helpers ship (`packages/schema/src/intl.ts`, site-architecture.md §13.7), not three.

The section's contract (line 2112): "`call` chains are bounded by `MAX_CALL_DEPTH` (64) against unbounded recursion; the compiler must additionally reject statically detectable call cycles."

**Verified against the code.** The marker is right, and understates the gap in four places:

- The depth lives in `IterCtx.callDepth` (`packages/runtime/src/expression.ts`, the `call` branch of `evaluateNode`, lines 553 to 615) and only the raw-definition path (a formula def reached as a plain object, as in editor preview) passes it on. Three callables start again at zero: `buildScope`'s pass 2.5 (`packages/runtime/src/runtime.ts`, lines 877 to 891), its parameterised structured body (lines 908 to 922), and the build-time copy in `buildInitialScope` (`packages/compiler/src/shared.ts`, lines 584 to 599). A self-calling formula in a mounted document or a build ends in the engine's `RangeError`. The existing test `unbounded formula recursion hits the call depth cap` (`packages/runtime/tests/expression.test.ts`) passes only because it evaluates a raw def.
- `reduce` evaluates its per-item expression with a fresh `{ acc, index, item }` (lines 831 to 841), where `map` and `filter` spread `...iterCtx`. That drops any depth and also `$args`: inside a formula, `$args/x` in a `reduce` body reads `undefined` in the interpreter, while the compiled `.reduce((_acc, _item, _index) => …)` closes over `_args` and reads it.
- `emitFormulaFn` emits `(..._a) => { const _args = {…}; return <body>; }` with no bound, for named formulas in `compile-element.ts` (`emitElementModule`) and in `compile-client.ts`, and for `compile-client.ts`'s parameterised structured bodies.
- `CompileOpts.formulaParams` and `formulaFnName` compile a call to `_fx_<key>(state, { … })`. No target passes `formulaParams` and no target declares an `_fx_` function; only two tests reach the branch. It is a second, unguarded lowering of a formula call.

No shipped document is affected by a cycle rule: none of the 312 committed JSON documents with `state` (packages, sites, examples, extensions) declares a named formula or a parameterised structured body, and the 15 catalog formulas in `packages/formulas/formulas/` reference no `#/state/` entry.

**The helper table.** §19.4c lists three helpers with their signatures. `INTL_HELPERS` in `packages/schema/src/intl.ts` holds eight (`formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`, `plural`, `compare`, `displayName`, `segment`), and `BLESSED_HELPERS` / `compileHelperCall` implement defaults the table omits: `$page.locale`, then `en-US`, for a missing locale (`withPageLocale`), `UTC` for `formatDate`, `"language"` for `displayName`'s `type`, `"grapheme"` for `segment`'s `granularity`. site-architecture.md §13.7 is the contract for what each helper wraps and for the defaults.

## Outcome

spec.md §19.4c → Implemented. A static call cycle among a scope's callable entries fails `jx build` and `jx validate` with its path. Every tier (the interpreter, build-time evaluation, and compiled output, subject to the Open below) throws `$expression: call depth exceeded (64)` on the 65th nested invocation. `$args/` resolves inside an aggregate body in the interpreter as it does compiled. The helper table lists the eight helpers' signatures and defers their contract to site-architecture.md §13.7.

## Decisions

- **Open:** does compiled output carry the run-time bound too, or rely on the static check alone? Recommendation: carry it. `emitFormulaFn` wraps its callable in an inlined guard serialized from `MAX_CALL_DEPTH` and the interpreter's message, following the `attrHelperSource()` precedent the spec audit adopted for rules both tiers apply. The static check cannot see a callee passed in through `$args/`, or a Function entry's JavaScript calling back into a formula. Without the guard a compiled page fails with a `RangeError` after thousands of frames where the interpreter throws at 64. The cost is one closure and one `try`/`finally` per call, in modules that declare a callable. The alternative is a reconcile: §19.4c says compiled output relies on the static check, and the guard steps below are dropped.
- **Decided:** the interpreter's bound is a module-scope count of in-flight callable invocations in `expression.ts` (`withCallDepth`), entered by the callable itself; `IterCtx.callDepth` is removed. A positional callable has no channel for a depth argument, and a JavaScript body calling `state.f()` would reset any depth threaded through arguments. Formula evaluation is synchronous, so the count is exactly the nesting on the stack, and `finally` restores it after a throw. It bounds synchronous nesting. A structured body that re-enters itself after an `await` is not stack recursion, and the static check still sees it when it names itself.
- **Decided:** every static cycle is rejected, a base case notwithstanding. §19.4c says so, and a recursive formula with a base case would still throw at depth 64 on large enough data, so its correctness would depend on its input. Nothing that ships declares a formula, so nothing that ships is rejected.
- **Decided:** the graph's nodes are a scope's callable entries: named formulas (`isNamedFormulaDef`) and structured bodies with a non-empty `parameters` list (§20.3's callables). An edge runs from a node to every node its body names by a `#/state/<key>` pointer (first segment, unescaped), whether as a `call` target or as an argument, and to every `state.<key>(` in a template string (the pattern `collectCallableRefs` in `compile-element.ts` uses). Naming a callable is the only way a pure body can invoke it, and a false positive needs a body that names a formula without calling it, which a pure formula has no use for. `$args/`, `$map/`, `parent#/` and `window#/` callees are not edges: they are dynamic or not formulas, and the run-time bound covers them.
- **Decided:** the compiler checks where every compiled tier starts from a document's state: the top of `buildInitialScope` (the static target, the client target's prerender, and the site build's page scope, before any title or `$head` template is evaluated) and the top of `emitElementModule` (the element target, including the modules `compile()` and `compile-static.ts` emit). A thrown `Error` fails the route through `buildSite`'s existing `Error compiling <route>` reporting. In a site build the checked state is the page's after `resolveLayout` and `injectContext`: layout, page and project state, page winning. The interpreter's `buildScope` does not check: §19.4c gives the static check to the compiler, and the interpreter's guarantee is the bound.
- **Decided:** `jx validate` reports a cycle as an issue, so the project is invalid, not as an advisory lint. The build refuses it, and the documented loop is "`jx build` only once validate is clean" (`docs/framework/agents/authoring-rules.md`). A page is judged merged with `project.json`'s `state`, page winning. A cycle made only of project entries is reported once, on `project.json`. Components and layouts are judged on their own state. A cycle that needs a layout's state is left to the build, because validate does not resolve layouts.
- **Decided:** the four interpreter copies of the positional-to-named argument loop become one export, `bindFormulaArgs`. `plan:spec/compiled-element-parameterised-bodies` deferred exactly this fold to this plan. The `formulaParams` / `formulaFnName` lowering is deleted, so the guarded callable is the only compiled path to a formula. `reduce` spreads the enclosing context like `map` and `filter`.
- **Decided:** no `requires`. The critic's edge to `plan:spec/expression-build-checks` is soft. This check needs only pointer collection over callable bodies, not that plan's position-aware walker, and it reports through validate's existing `issues` channel. Whichever lands second may move `findCallCycles`'s traversal onto a shared walker. `plan:spec/compiled-element-parameterised-bodies` and `plan:spec/compiled-statement-await` add or reshape structured-callable emitters in `shared.ts`, and step 3 below covers either landing order.
- **Decided:** §19.4c keeps a signature table, since a `call` site needs positional order and §13.7 has none, and it cites site-architecture.md §13.7 for what each helper wraps and for the defaults instead of restating them.

## Implementation

1. **`packages/runtime/src/expression.ts`**
   - Export `CALL_DEPTH_EXCEEDED`, the message `$expression: call depth exceeded (64)` built from `MAX_CALL_DEPTH`: the one spelling of it.
   - `let activeCalls = 0` (module scope) and `export function withCallDepth<T>(run: () => T): T`: throw `new Error(CALL_DEPTH_EXCEEDED)` when `activeCalls >= MAX_CALL_DEPTH`, else increment, `try { return run(); } finally { activeCalls--; }`.
   - `export function bindFormulaArgs(parameters: readonly unknown[], argValues: readonly unknown[]): Record<string, unknown>`: the loop now inlined in the raw-def path (bare names or CEM objects, nameless entries skipped with their index kept, `default` when the argument is `undefined`).
   - `export function formulaCallable(node: ExpressionNode, parameters: readonly unknown[], state: JxScope)`: returns `(...argValues) => withCallDepth(() => evaluateExpression(node, state, null, { args: bindFormulaArgs(parameters, argValues) }))`.
   - `evaluateNode`, `call` branch: delete the `callDepth` computation and check (lines 558 to 561). The raw-def path becomes `return withCallDepth(() => evaluateExpression(def.$expression, state, event, { args: bindFormulaArgs(def.parameters ?? [], argValues) }))`. The scope-callable path is unchanged, because the callable guards itself. Blessed globals and helpers are not counted, since they cannot recurse.
   - Remove `callDepth` from `IterCtx`. In the `reduce` loop pass `{ ...iterCtx, acc, index, item }`.
   - Delete `CompileOpts.formulaParams`, the `#/state/` branch that reads it in `compileExpression`'s `call` case, and `formulaFnName`. A `#/state/` callee falls through to the existing `${compileRef(calleeRef, opts)}(${args})`.
   - `export function isCallableEntry(def: unknown): boolean`: `isNamedFormulaDef(def) || (hasStructuredBody(def) && Array.isArray(def.parameters) && def.parameters.length > 0)`, importing both guards from `@jxsuite/schema/guards`.
   - `export function findCallCycles(defs: Record<string, unknown>): string[][]`, with `@docs framework/concepts/expressions` in its JSDoc. Nodes are the keys whose def passes `isCallableEntry`, in object order. Edges come from a recursive walk of the def's `$expression` or `body` per the Decided rule, where the first segment of a `#/state/` ref is `refSegments(ref.slice("#/state/".length))[0]` (`./pointer.ts`) and a string containing `${` is matched with `/\bstate\.([A-Za-z_$][\w$]*)\s*\(/g`. Take Tarjan's strongly connected components. For each component of size above one, or with a self-edge, return one path from its first key in object order along in-component edges back to that key (breadth-first, so the shortest), for example `["b", "a", "b"]`. The result is ordered by each path's first key, so messages are stable.
2. **`packages/runtime/src/runtime.ts`**, `buildScope`: pass 2.5's named-formula branch becomes `state[key] = formulaCallable(node, def.parameters, state)`. The third pass's parameterised structured body becomes `(...argValues) => withCallDepth(() => runStatements(body, state, null, { args: bindFormulaArgs(params, argValues), target: dispatchRoot }))`. Both inline loops go.
3. **`packages/compiler/src/shared.ts`**
   - `export function callCycleMessage(cycle: string[]): string`, which gives `$expression: call cycle a → b → a: a named formula may not reach itself (spec.md §19.4c)` for `["a", "b", "a"]`, and `export function assertNoCallCycles(defs: Record<string, unknown>): void`, which throws one `Error` whose message is the `callCycleMessage` of each cycle `findCallCycles(defs)` returns, joined by newlines.
   - `export function hasCallableEntries(defs: Record<string, unknown>): boolean`, which is `Object.values(defs).some(isCallableEntry)`.
   - `buildInitialScope`: call `assertNoCallCycles(defs)` first. The named-formula branch becomes `setOwnScopeValue(scope, key, formulaCallable(node, def.parameters, scope))`. If `plan:spec/compiled-element-parameterised-bodies` has landed, its private `positionalArgs` is replaced by `bindFormulaArgs` and its build-time structured callable is wrapped in `withCallDepth`.
   - Per the Open: `export const FORMULA_GUARD = "__jxFormula"` and `export function formulaGuardSource(): string`, beside `attrHelperSource()`. It returns `let __jxFormulaDepth = 0;` and `function __jxFormula(run) { if (__jxFormulaDepth >= <MAX_CALL_DEPTH>) throw new Error(<JSON.stringify(CALL_DEPTH_EXCEEDED)>); __jxFormulaDepth++; try { return run(); } finally { __jxFormulaDepth--; } }`, with both values serialized from the imports, never retyped. `emitFormulaFn` returns `` `(..._a) => ${FORMULA_GUARD}(() => { const _args = { … }; return ${compiledBody}; })` ``, whose `(..._a) =>` prefix and `_args` entries stay byte-identical, so the pinned assertions hold. Any other positional-callable emitter in this file when this lands (`emitStatementsFn` or `emitStatementsCallable`) wraps its body the same way.
4. **`packages/compiler/src/targets/compile-element.ts`**, `emitElementModule`: call `assertNoCallCycles(defs)` before classifying entries, and push `formulaGuardSource()` after `attrHelperSource()` when `hasCallableEntries(defs)`. A module without a callable is byte-identical to today's.
5. **`packages/compiler/src/targets/compile-client.ts`**: `compileClient` sets `counter.needsFormulaGuard = hasCallableEntries(defs)`, a new flag beside `needsLit`, and `emitClientModule` pushes `formulaGuardSource()` after `attrHelperSource()` when it is set. The cycle check already ran in `createCompileContext` → `buildInitialScope`.
6. **`packages/compiler/src/site/validate-command.ts`**, `validateProjectTree`:
   - Before step 3, read `project.json`'s `state` with a guarded `JSON.parse` (an unreadable file is step 2's report). Push one issue on `project.json` for each cycle in it alone.
   - In step 3, for each well-formed document, compute `findCallCycles` over `{ ...projectState, ...doc.state }` without `$site` and `$page` for a file under `pages/`, and over `doc.state` otherwise. For a page, keep only the cycles containing a key the page itself declares. Push `{ file, errors }` with one `{ instancePath: "/state/" + cycle[0], message: callCycleMessage(cycle) }` per cycle, so `formatProjectTreeIssues` prints `- /state/b: $expression: call cycle b → a → b: …`.

**Integration contract.** Once this lands, `@jxsuite/runtime/expression` exports `MAX_CALL_DEPTH`, `CALL_DEPTH_EXCEEDED`, `withCallDepth`, `bindFormulaArgs`, `formulaCallable`, `isCallableEntry` and `findCallCycles`, and no longer exports `formulaFnName`. The compiler's `shared.ts` exports `assertNoCallCycles`, `callCycleMessage`, `hasCallableEntries`, `FORMULA_GUARD` and `formulaGuardSource`, and `emitFormulaFn(def, compiledBody)` keeps its signature. Any later positional callable, in any tier, builds its arguments with `bindFormulaArgs` and runs inside `withCallDepth` (the interpreter and the build) or `__jxFormula` (emitted code), and a module that declares one emits `formulaGuardSource()`. `hasCallableEntries` already counts parameterised structured bodies, so a target that starts emitting them needs no new condition. `buildInitialScope` and `emitElementModule` throw on a cycle, and `jx validate` reports one as an issue with `instancePath` `/state/<first key>`. `plan:spec/expression-build-checks` may call `findCallCycles` from its walker, or replace its traversal, without changing its result.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`. The runtime change also reaches `packages/ui` and `packages/studio`, which evaluate formulas, and CI's affected matrix runs them. Only recursion changes behaviour there.

**`packages/runtime/tests/expression.test.ts`**

- `call operator — named formulas and blessed globals`: `unbounded formula recursion hits the call depth cap` asserts `toThrow(CALL_DEPTH_EXCEEDED)`. New cases:
  - `withCallDepth admits 64 nested invocations and refuses the 65th`.
  - `withCallDepth restores the count when its callee throws`: after a capped throw, 64 nested invocations succeed again.
  - `a callee passed in through $args/ is bounded`: `omega(f) = call $args/f [$args/f]`, invoked as `call #/state/omega [#/state/omega]` on raw defs, throws `CALL_DEPTH_EXCEEDED`.
  - `$args/ resolves inside a reduce body, and compiled === interpreted`: a formula summing `$args/k * item` over a list. It fails today in the interpreter.
- The two `formulaParams` cases (`compiles named-formula call sites against formulaParams`, `emitted formula fn + call site round-trips to the interpreted result`) go with the branch; the round trip moves to the compiler suite below. `callee without formulaParams compiles to a direct scope call` becomes `a state callee compiles to a direct scope call`.
- New `describe("findCallCycles (spec §19.4c)")`:
  - `a self-call is a cycle`: `[["loop", "loop"]]`.
  - `mutual recursion reports the shortest path from the first key`: `a → b → c → a` beside a `b → a` shortcut gives `["a", "b", "a"]`.
  - `a callable named as an argument is an edge`.
  - `a template string's state.key( call is an edge`.
  - `a parameterised structured body is a node, and a handler body or a computed is not`.
  - `$args/, $map/, parent#/ and window#/ callees are not edges`.
  - `an escaped pointer segment names its entry`: `#/state/a~1b` reaches key `a/b`.
  - `two disjoint cycles are both reported, and an acyclic graph reports nothing`.

**`packages/runtime/tests/runtime.test.ts`**

- `buildScope — named formulas`: `a self-recursive formula stops at MAX_CALL_DEPTH instead of overflowing the stack` (a `RangeError` today); `recursion through a Function entry calling back is bounded` (a string-body Function `return state.f(1)` called by formula `f`).
- `buildScope — structured function bodies`: `a parameterised body that calls itself rejects at MAX_CALL_DEPTH`, with `await expect(state.f(1)).rejects.toThrow(CALL_DEPTH_EXCEEDED)`.

**`packages/compiler/tests/`**

- `expression.test.ts`, `named formulas — compiler integration`:
  - `buildInitialScope rejects a call cycle with its path`.
  - `compileElement rejects a call cycle`, and `compile() of a client-target document rejects a call cycle`.
  - `a module with a callable entry carries the guard once, and one without carries none`, for the element and client targets.
  - `the inlined guard agrees with the interpreter`: the function that `new Function` builds from `formulaGuardSource()` plus a `return` of `FORMULA_GUARD` admits 64 nested runs and throws exactly `CALL_DEPTH_EXCEEDED` on the 65th.
  - `emitFormulaFn's callable round-trips to the interpreted result`: `lineTotal` built with `new Function` from `formulaGuardSource()` and `emitFormulaFn(def, compileExpression(body))`, called as `(3)` and `(3, 4)`, equals `evaluateExpression` of the same `call`.
  - `compileElement emits a scope callable for a named formula` also asserts `__jxFormula(() => {`.
- `compile-client-coverage.test.ts`: the two `(..._a) =>` cases also assert `__jxFormula(`.
- `compile-element-render.test.ts`, new `describe("compiled element — named-formula depth bound")`: an element declaring `lineTotal` and `omega`. After mount, the instance's `state.omega(state.omega)` throws `CALL_DEPTH_EXCEEDED`, not a `RangeError`, and `state.lineTotal(3, 4)` then returns `12`.
- `site-build-reporting.test.ts`: `a call cycle through project.json state fails that route and names the path`. `scaffold` with project formula `a` calling `#/state/b` and a page formula `b` calling `#/state/a`. `result.errors` has one entry for `/`, naming `b → a → b` (the page's own keys precede the merged project keys), and other routes still build.
- `validate-command.test.ts`: `a page formula cycling through project.json state is an issue on the page`; `a cycle inside project.json state is one issue on project.json, not one per page`; `a component's own cycle is an issue on the component`; `an acyclic formula chain stays valid`.

Coverage: no new source file, so the manifest check is unaffected. The touched files are held to `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`) and `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`) per file. Every new export is exercised above. Raise a threshold to just below the new minimum if the worst file rises.

## Specs & docs

**`specs/spec.md` §19.4c, edited in place:**

- The marker becomes:

  ```markdown
  > **Status: Implemented.** Named formulas, `$args/`, `call`, `BLESSED_GLOBALS` and `BLESSED_HELPERS` ship in the interpreter and every compiled target (`packages/runtime/src/expression.ts`, `emitFormulaFn` in `packages/compiler/src/shared.ts`). The build and `jx validate` reject a call cycle (`findCallCycles`), and `MAX_CALL_DEPTH` bounds every invocation in both tiers (`packages/runtime/tests/expression.test.ts`, `packages/compiler/tests/expression.test.ts`, `packages/compiler/tests/compile-element-render.test.ts`).
  ```

  If the Open resolves against the compiled guard, the last clause reads "bounds every invocation in the interpreter and at build time; compiled output relies on the build's cycle check".

- The `$args/` paragraph gains a final sentence: "The binding holds throughout the body, including an aggregate's per-item expression (§19.4a)."
- **Intl helpers** (the paragraph and its three-row table) becomes: "The `Intl` formatters are constructors, not plain functions, so they cannot join the allowlist directly. Eight **synthetic helpers** wrap construct-then-format as pure calls. site-architecture.md §13.7 is their contract: what each wraps, and the defaults a call may omit (the page's locale, then `en-US`; `UTC` for `Intl/formatDate`). `packages/schema/src/intl.ts` is the one list the interpreter, the compiler and the schema read. Their positional signatures:" It is followed by a `Helper | Signature` table with eight rows: `Intl/formatNumber` `(value, locale?, options?)`, `Intl/formatDate` `(value, locale?, options?)`, `Intl/formatRelativeTime` `(value, unit, locale?, options?)`, `Intl/formatList` `(values, locale?, options?)`, `Intl/plural` `(value, locale?, options?)`, `Intl/compare` `(a, b, locale?, options?)`, `Intl/displayName` `(code, type?, locale?, options?)` (`type` defaults to `"language"`), and `Intl/segment` `(value, granularity?, locale?)` (`granularity` defaults to `"grapheme"`, and the result is an array of strings). The `BLESSED_HELPERS` sentence and the `formatNumber` example stay.
- **Semantics and lowering**: the sentence "`call` chains are bounded by `MAX_CALL_DEPTH` (64) against unbounded recursion; the compiler must additionally reject statically detectable call cycles." is deleted, and a **Recursion.** paragraph follows the section's last paragraph:

  > **Recursion.** A named formula may not reach itself. The build forms a call graph over each compiled scope's callable entries (named formulas and parameterised structured bodies, §20.3), where the scope is a page's state after the layout and project-state merge, or a component's own state. An entry has an edge to every callable entry its body names by a `#/state/` pointer, as a `call` target or as an argument, or calls as `state.key(…)` in a template string. A cycle in that graph, a self-call included, fails the build with its path (`a → b → a`), and `jx validate` reports it as an error. Recursion the graph cannot see, such as a callee passed in through `$args/` or a Function entry's JavaScript calling back, is bounded at run time: the interpreter, build-time evaluation and every compiled target count nested invocations of callable entries, and the 65th throws `$expression: call depth exceeded (64)` (`MAX_CALL_DEPTH`) instead of exhausting the stack.

**Fragment:** `bun run spec:change spec.md minor -m '§19.4c: a call cycle among named formulas fails the build and jx validate with its path, MAX_CALL_DEPTH bounds nested formula invocations in the interpreter and in compiled output, $args/ resolves inside an aggregate body, and the Intl helper table lists the eight shipped helpers with their signatures.'` Single quotes, so the shell leaves `$args` alone. If the Open resolves against the compiled guard, the sentence says "in the interpreter and at build time" instead.

**Docs.** Em dashes are banned in every page below.

- `docs/framework/concepts/expressions.md` (`spec: spec.md#19`):
  - The frontmatter gains `code: [packages/runtime/src/expression.ts]`, matching `findCallCycles`'s `@docs` tag.
  - In **Named formulas and `call`**, after the project-state paragraph, add: "A formula may not call itself, directly or through other formulas. The build fails and names the chain (`subtotal → lineTotal → subtotal`), and `jx validate` reports the same chain. A chain the build cannot see, such as a formula handed to another as an argument and called there, stops with an error after 64 nested calls. Inside a formula, `$args/` also resolves within `reduce`, `map` and `filter`."
  - The **Rules** bullet becomes: "`call` targets a named formula or a blessed global. A formula that reaches itself is a build error, and any chain deeper than 64 calls stops with an error."
- `docs/framework/concepts/statements.md` (`spec: spec.md#20`): after the paragraph introducing the parameterised form (line 120), add: "Like a named formula, a callable body may not reach itself through `call`; see [Expressions](/docs/framework/concepts/expressions)."
- `docs/framework/build/cli.md` (its `code:` lists `validate-command.ts`): in `jx validate`'s "Checks, in order" sentence, after the bundled-document-schema clause, add "that no named formula reaches itself through `call` (a page together with `project.json`'s formulas, as the build merges them);".
- No other page changes. `bun run docs:sync` will also name the pages whose `code:` lists `runtime.ts`, `shared.ts`, `compile-client.ts` or `compile-element.ts` (`functions.md`, `elements.md`, `components.md`, `build.md` and others), and `docs/framework/agents.md` and `authoring-rules.md` for `validate-command.ts`. None describes formula lowering or what validate checks item by item. `docs/studio/logic/formulas.md` already lists the eight helpers.

This plan does not graduate `spec.md`, whose other open items remain.

## Acceptance

- From `packages/runtime` and `packages/compiler`: `bun test --isolate --coverage` is green with no file below its `bunfig.toml` threshold, and `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler` pass.
- This prints `$expression: call cycle a → b → a: a named formula may not reach itself (spec.md §19.4c)`:

  ```sh
  bun -e 'import { buildInitialScope } from "./packages/compiler/src/shared.ts"; const f = (to) => ({ parameters: ["x"], $expression: { operator: "call", target: { $ref: "#/state/" + to }, value: [{ $ref: "$args/x" }] } }); try { buildInitialScope({ a: f("b"), b: f("a") }); } catch (e) { console.log(e.message); }'
  ```

- This prints `$expression: call depth exceeded (64)` where it printed a `RangeError` before:

  ```sh
  bun -e 'import { buildScope } from "./packages/runtime/src/runtime.ts"; const s = await buildScope({ state: { loop: { parameters: ["x"], $expression: { operator: "call", target: { $ref: "#/state/loop" }, value: [1] } } } }, {}, "http://localhost/"); try { s.loop(1); } catch (e) { console.log(e.message); }'
  ```

- `rg -n "formulaParams|formulaFnName|callDepth" packages` finds nothing.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` are green, and `bun run plans:status --spec spec` no longer lists §19.4c.
