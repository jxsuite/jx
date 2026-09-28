---
status: drafted
disposition: implement
claims:
  - spec.md#20.3
requires: []
workspaces:
  - packages/compiler
size: S
---

# Every tier lowers a parameterised structured body to one positional callable, the element target included

## Context

`specs/spec.md` §20.3, line 2369:

> **Status: Partial.** The interpreter and `compile-client.ts` lower both forms. The element target does not: a structured body with `parameters` always lowers to a `(s, e)` handler in `packages/compiler/src/targets/compile-element.ts`, not a positional callable, and its `$args/` refs compile to `_args.x` with no `_args` in scope.

**What exists** (verified against `84735a9f`)

- Interpreter: the third pass of `buildScope` (`packages/runtime/src/runtime.ts`, around line 904) turns a structured body whose `parameters` is a non-empty array into `(...argValues) => runStatements(body, state, null, { args, target: dispatchRoot })`, mapping each argument onto its parameter name and applying CEM `default`s. `dispatchRoot` is the mount root: the rendered root element for `mount()`, and the element itself for a custom element (`buildScope(def, {}, defBase, { …, root: this })`, around line 4259). With no `parameters`, or an empty list, the body is a `(s, event)` handler. `runtime.test.ts`, "parameterized structured body is callable with positional args", covers it.
- Element target: in `emitElementModule` (`compile-element.ts`, lines 533 to 546), the `hasStructuredBody(def)` branch always writes `this.state.key = (s, e) => { … }`, compiled with `dispatchTarget: "this"`, `eventParam: "e"`, `statePrefix: "this.state"`. `compileRef` in `packages/runtime/src/expression.ts` compiles `$args/x` to `_args.x`, and nothing declares `_args`, so `state.addToCart(item)` or a `call` node passes `item` as `s` and the first `$args/` read throws `ReferenceError`. The same function builds every site component (`site-build.ts` calls `compileElement`) and every static-page island (`compile-static.ts` calls `emitElementModule`). `expression.test.ts`, "structured bodies — compileElement", covers only the handler form.
- `emitFormulaFn` (`packages/compiler/src/shared.ts`, line 83) already emits the positional callable a named formula needs: `(..._a) => { const _args = { "price": _a[0], "qty": _a[1] === undefined ? 1 : _a[1] }; return <body>; }`.

**Corrections to the census reading**

1. The client target binds `$args/` but cannot run §20.1's own example. `compile-client.ts` (lines 165 to 172) emits `emitFormulaFn(def, "(() => {\n<statements>\n})()")`, with the statements compiled under `eventParam: "e"`. The client module declares no `e`, so a `dispatchEvent`, `stopPropagation` or `preventDefault` statement inside the callable throws `ReferenceError` (ES modules are strict). `compile-client-coverage.test.ts`, "…with parameters becomes a scope callable", passes because its body is one `+=`.
2. The build-time scope is a fourth tier the marker omits. `buildInitialScope` (`shared.ts`, lines 611 to 615) lowers every structured body to `(s, event) => void runStatements(body, s ?? scope, event ?? null)`, so a call made during prerender passes its first argument as the scope.
3. No document in the repository declares a structured body with `parameters` or `arguments` (a scan of every JSON file under `examples/`, `sites/`, `packages/starters/`, `packages/ui/`, `packages/studio/src/`, `extensions/` and the workspaces' `tests/`; the only hits are `.class.json` constructors, which are not state entries), so no shipped output changes.

**Dependent.** `plan:spec/compiled-statement-await` (§20.2) requires this plan: it makes the compiled callable `async` by changing `emitStatementsFn` alone, and relies on the integration contract below (the `_args` declaration and `const e = null;`).

**Related, no edge**

- `plan:spec/named-formula-recursion` (§19.4c) may add a compiled call-depth bound; after this plan both compiled callables build `_args` through one helper.
- `plan:spec/callable-classifier` classifies every structured body as `callable` and leaves its lowering to each tier, naming this plan as the owner of the element target's.
- `plan:spec/expression-build-checks` (§19.5) owns the build error for an `event#/` read outside a handler; whether a callable counts as outside is its Open (recommended: yes).
- For `plan:_shared/compiled-element-lifecycle`: the interpreter calls `onMount(state, this)`, so a structured-body `onMount` receives the host as its `event`, and a `{ "stopPropagation": true }` statement in it calls a method an element does not have. That is a §16.4 hook question, not this item.

## Outcome

- `spec.md` §20.3 → Implemented: the interpreter, the build-time scope, the client target and the element target lower a structured body with a non-empty `parameters` list to one positional callable, and §20.3 states how that callable behaves without an event.

## Decisions

- **Decided:** a non-empty `parameters` array is the only thing that makes a structured body a callable, in every tier. `arguments`, an empty list, and any body written inline on an `on*` property stay handlers. That is the interpreter's test (`Array.isArray(def.parameters) && def.parameters.length > 0`) and the one §19.4c uses for named formulas; `compile-client.ts`'s truthiness check becomes the same expression.
- **Decided:** one emitter for both compiled targets. `shared.ts` gains `emitStatementsFn`, and `emitFormulaFn`'s `_args` literal moves into a private `formulaArgsSource` that both call, so the two callables cannot drift and a later depth bound or `async` lands once. `emitFormulaFn`'s output stays byte-identical, which the named-formula tests in `expression.test.ts` pin.
- **Decided:** the callable declares its event parameter as `null` (`const e = null;`) rather than compiling the statements against a literal `null`, so the body reads like a handler's and the `e?.stopPropagation()`, `e?.preventDefault()` and `(e && e.currentTarget)` forms `compileStatements` already emits stay valid no-ops, as §20.2 requires. An `event#/` read inside a callable is not made null-safe here: it reads `undefined` in the interpreter and throws `TypeError` compiled (`e.key` on `null`). `plan:spec/expression-build-checks` has an Open recommending that §19.5 refuse it at build in every tier, which removes the divergence; no committed document has such a read (Context 3), so this plan does not wait on it.
- **Decided:** in the element target a callable dispatches from the component instance (`dispatchTarget: "this"`, as the handler form does), which is the interpreter's mount root for a custom element.
- **Decided:** the compiled callable stays synchronous and returns `undefined`. The interpreter's returns the `Promise` from `runStatements`; aligning the two is `async`, which is §20.2's work.
- **Decided:** the build-time positional mapping is one private `positionalArgs(params, argValues)` in `shared.ts`, shared by the named-formula callable and the new one. The runtime keeps its own two copies: `plan:spec/named-formula-recursion` rewrites both to carry `callDepth`, and that is the place to fold them into one export.
- **Open:** which element does a callable on a compiled page (the client target) dispatch from, having no event? Recommendation: the page's root element, read at dispatch time as `document.body.firstElementChild` (`compileClient` writes the root node as the body's only content), because that is the interpreter's mount root for a page, so a listener on the root, on `document` or on `window` hears the same events in both tiers. The alternative, `document`, is simpler but a listener on the root element would hear the interpreted page and not the compiled one.

## Implementation

1. `packages/compiler/src/shared.ts`
   - Extract `formulaArgsSource(parameters: unknown[] | undefined): string` (not exported) from `emitFormulaFn`: the `{ "name": _a[i] … }` literal, skipping nameless entries and keeping their index. `emitFormulaFn` becomes `` `(..._a) => { const _args = ${formulaArgsSource(def.parameters)}; return ${compiledBody}; }` ``.
   - Add, beside it, `export function emitStatementsFn(def: { parameters?: unknown[] }, compiledStatements: string, eventParam = "e"): string` returning a block-bodied arrow: `(..._a) => {`, then `const _args = <formulaArgsSource>;`, `const <eventParam> = null;`, the compiled statements, and `}`. JSDoc: "The positional callable a structured body with `parameters` lowers to (spec.md §20.3): arguments bind to `$args/` names, and the body runs without an event."
   - Add `positionalArgs(params, argValues): Record<string, unknown>` (not exported), the loop the named-formula branch of `buildInitialScope` inlines today (lines 586 to 597), and use it there.
   - `buildInitialScope`, `hasStructuredBody` branch (line 611): when `def.parameters` is a non-empty array, `setOwnScopeValue(scope, key, (...argValues: unknown[]) => runStatements(body, scope, null, { args: positionalArgs(params, argValues) }))`; otherwise the existing handler. No dispatch target: the build has no DOM.
2. `packages/compiler/src/targets/compile-element.ts`, `emitElementModule`, the `hasStructuredBody(def)` branch of the function-entry loop: compile the statements with the options it uses now; when `parameters` is non-empty, push `` `    ${refAccessor("this.state", escapeToken(key))} = ${emitStatementsFn(def, compiled)};` ``, else the existing `(s, e) => { … }`. Import `emitStatementsFn` beside `emitFormulaFn`, and update the branch comment to cite spec.md §20.3.
3. `packages/compiler/src/targets/compile-client.ts`, the `hasStructuredBody(def)` branch (line 165): for a callable, compile with `{ dispatchTarget: "document.body.firstElementChild", eventParam: "e", statePrefix: "state" }` (per the Open) and push `` `state[${JSON.stringify(key)}] = ${emitStatementsFn(def, compiled)};` `` to `initBlocks`, replacing the IIFE; the handler path is unchanged.

**Integration contract.** Once this lands, `shared.ts` exports `emitStatementsFn(def, compiledStatements, eventParam?)`, the only emitter of a structured-body callable, used by both compiled targets; it is a synchronous arrow that declares `_args` and a `null` event, so a plan making compiled bodies `async` changes it and nothing else. In all four tiers `state.key(…)` and a `call` node reach the same positional callable, `$args/` names read its arguments with CEM defaults applied, and only a non-empty `parameters` list selects it. A callable dispatches from the component instance in a compiled element and from the page's root element on a compiled page (subject to the Open).

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`. No source file is added, so the manifest check sees nothing new; `emitStatementsFn` and the changed branches are covered by the cases below, and the workspace keeps its per-file `coverageThreshold` (`lines = 0.982, functions = 0.98`), raised to just below the new minimum if the worst file rises.

- `tests/shared.test.ts`, new `describe("emitStatementsFn")`, turning the emitted source into a function with `new Function` (parameters `state` and `target`, body `return <source>`) and calling it against a plain object and an `EventTarget`:
  - "maps positional arguments onto parameter names and applies defaults": `parameters: ["item", { name: "qty", default: 2 }]`, a body pushing `$args/item` and assigning `$args/qty`; one call with one argument leaves `["apple"]` and `2`.
  - "runs without an event: the event verbs are no-ops and dispatch uses the given target": a body of `stopPropagation`, `preventDefault` and `dispatchEvent` with a `detail`, compiled with `dispatchTarget: "target"`; the call does not throw and the listener receives the `CustomEvent` with its detail.
- `tests/expression.test.ts`, `describe("structured bodies — compileElement")`:
  - "a parameterised statement body compiles to a positional callable", on §20.1's `addToCart` with `parameters: ["item"]`: the text contains `this.state.addToCart = (..._a) => {`, `const _args = { "item": _a[0] };`, `const e = null;`, `this.state.cart.push(_args.item);` and `this?.dispatchEvent(`, and not `this.state.addToCart = (s, e) =>`.
  - "an empty parameters list or arguments alone leaves a handler": both compile to `(s, e) => {`.
- `tests/expression.test.ts`, `describe("structured bodies — buildInitialScope")`: "a parameterised statement body lowers to a positional callable": `await scope.addToCart("apple")` leaves `scope.cart` equal to `["apple"]`, and an omitted defaulted argument takes its default.
- `tests/compile-client-coverage.test.ts`, "Function def with a statement-array body and parameters becomes a scope callable": the body gains `{ stopPropagation: true }` and `{ dispatchEvent: "added" }`; assert `const e = null;`, `document.body.firstElementChild?.dispatchEvent(new CustomEvent("added"))`, and that the IIFE `(() => {` is gone.
- `tests/compile-element-render.test.ts`, new `describe("compiled element — parameterised structured body")` with its own `beforeAll`, as the `$props` delivery block has: it compiles a second document, writes it as `cart.js` in `TMP`, awaits one `import()`, and appends an `<ls-cart>` instance (`cart` below) to `win.document.body`. The document: `tagName: "ls-cart"`, state `cart: []`, `next: "pear"`, and §20.1's `addToCart` shape with `parameters: [{ name: "item" }, { name: "qty", default: 1 }]` and a body that pushes `$args/item`, stops propagation, and dispatches `cart-changed` with `detail: { $ref: "$args/qty" }`; one child button whose `onclick` is an `$expression` `call` of `#/state/addToCart` with `[{ $ref: "#/state/next" }]`. Cases:
  - "state.key(…) binds positional arguments to parameter names": `cart.state.addToCart("apple")` puts `"apple"` in `cart.state.cart`.
  - "a call node invokes it positionally": clicking the button puts `"pear"` in the cart.
  - "run without an event it dispatches from the instance, and its event verbs are no-ops": a `cart-changed` listener on `cart` receives `detail` `1`, and the call does not throw.

## Specs & docs

- `spec.md` §20.3: replace the marker with

  ```markdown
  > **Status: Implemented.** The interpreter (`buildScope`), the build-time scope (`buildInitialScope`) and both compiled targets lower both forms; the compiled targets share one emitter (`emitStatementsFn` in `packages/compiler/src/shared.ts`).
  ```

  and, after the paragraph's first sentence, add: "Only a non-empty `parameters` array makes the callable: `arguments`, an empty list and a body written inline on an `on*` property stay handlers. A callable runs without an event, so `stopPropagation` and `preventDefault` do nothing in it, and `dispatchEvent` dispatches from the mount root: the component instance in a custom element, compiled or interpreted, and the page's rendered root element on a page." (Name `document` instead if the Open goes the other way.) Nothing else in §20 changes; §20.2's marker belongs to `plan:spec/compiled-statement-await`.

- Fragment: `bun run spec:change spec.md minor -m "The element target and the build-time scope lower a parameterised structured body to a positional callable, and a callable run without an event dispatches from its mount root in every tier"`.
- Docs (no em dashes):
  - `docs/framework/concepts/statements.md` (`spec: spec.md#20`). Under "Parameters", after the example: "Call it with a `call` node, or as `state.addToCart(item)` from another body. Only a non-empty `parameters` list makes a callable; a body written on an `on*` property is always a handler. A callable runs without an event, so `stopPropagation` and `preventDefault` do nothing inside it, and `dispatchEvent` fires from the component itself: the custom element in a component, the page's root element on a page." In "Rules", replace the `dispatchEvent` bullet with: "`dispatchEvent` needs a dispatch target; outside a handler (no `event`), such as in a callable, it dispatches from the component instance in a component and from the page's root element on a page." (Not "a compiled custom element always dispatches from the instance": an inline structured body on a child dispatches from `e.currentTarget` there too.) Add `code:` frontmatter listing `packages/runtime/src/statements.ts`, so a later change to the engine names this page.
  - `docs/framework/concepts/functions.md` (its `code:` lists both targets). Under "Structured bodies", add: "With `parameters`, a structured body is a callable invoked positionally, its arguments bound to `$args/` names, rather than a handler whose parameters bind by name."
  - No change to the other pages `bun run docs:sync` names for these files (`components.md`, `lists.md`, `elements.md`, `styling.md`, `color-schemes.md`, `build.md`): none describes structured-body lowering. `docs/extending/reference/standards.md` is generated.
- This does not graduate `spec.md`, which keeps other open items.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at the workspace's thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec spec` no longer lists §20.3.
- Observable: `compileElement` on §20.1's `addToCart` document emits `this.state.addToCart = (..._a) => {` with a `const _args` declaration, and in the render test calling `el.state.addToCart("apple")` on the upgraded element adds `"apple"` to its cart and fires `cart-changed` on the element.
