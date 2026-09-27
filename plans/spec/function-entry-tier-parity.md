---
status: drafted
disposition: implement
claims:
  - spec.md#4d
requires:
  - spec/callable-classifier
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: L
---

# Every Function-entry rule in §5.3 4d holds in the interpreter and in every compiled target

## Context

`specs/spec.md` §5.3 4d, line 425:

> **Status: Partial.** The property table, parameter-object normalization and compiled-site bundling (`packages/compiler/src/site/bundler.ts`) ship. Four rules hold in only some tiers: usage-based classification of a `$src` entry is `compile-element.ts`'s alone (the interpreter introspects the imported function, and `compile-client.ts` makes every `$src` entry a computed, so a `$src` handler bound to `on*` attaches no listener); declaring both `body` and `$src` throws at runtime scope build but is never a compile-time error; `compile-client.ts` ignores `$lazy`; and the interpreter's `resolveParamNames` recognizes `state` only in first position rather than binding by name.

The first rule is built by `plan:spec/callable-classifier`, which this plan requires: `classifyFunctionEntries(doc)` in `@jxsuite/schema/function-role`, read by every tier, with `compile-client.ts` lowering a callable `$src` entry to `state[key]` (the import) plus an `on[key]` adapter. That plan narrows this marker to the other three rules. They are this plan's, and so are four lowering defects found while detailing (two routed here by `plan:spec/callable-classifier`, one by `plan:compiler/element-binding-table`). Verified at `84735a9f`.

**`body` plus `$src`.** `resolveFunction` (`packages/runtime/src/runtime.ts:1172`) throws for a state entry, testing truthiness, so `body: ""` slips through. An inline `on*` Function declaring both is bound by its body in `bindHandler` (line 1539) with no error. The compiler never refuses the pair, and each tier keeps a different half: `compile-client.ts` imports `$src` and ignores `body` (line 176), `buildInitialScope` runs `body` (`packages/compiler/src/shared.ts:617`), and `emitElementModule` imports `$src`, classifies by `body`, then calls the import. `FunctionDef` (`packages/schema/defs/function-def.schema.ts`) states the exclusion only in `description`, so `jx validate` accepts it. No tracked document declares both; three fixtures in `compile-element.test.ts` do ("Function with $src generates import and wrapper", "computed Function with $src generates import and computed wrapper", "multiple $src imports from same file are grouped").

**`$lazy`.** `emitElementModule` (`compile-element.ts:358`–`438`) honours it: a memoized `import()` per module, the local binding keeping its name, and a build error when the entry is not callable. `compile-client.ts` has no reference to `$lazy`, so a page gets a static import. The interpreter has none either: `resolveFunction` awaits the import at scope build, so a `$lazy` function returns its own value synchronously in Studio and a promise on a built site, and a `$lazy` entry read as a value renders in Studio and fails `jx build`. The one tracked user is `sites/jxsuite.com/components/site-search.json` (`searchInit`, `runSearch`).

**Parameter lists.** `resolveParamNames` (line 1255) prepends `state` unless it is first, so `["event", "state"]` builds `new Function("state", "event", "state", body)`: the later duplicate wins, `state` is `undefined` and `event` receives the state (checked with Bun). The compiled tiers each build the list their own way:

| Tier                                                       | Declared `["event", "state"]` or `["event"]`                                                                | `$src` callable                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Interpreter (`resolveFunction`, `bindHandler`)             | duplicate parameter, `state` undefined                                                                      | the import, called `(state, event)` from an event                                                                     |
| `compile-element.ts` state entry (`:548`–`587`)            | `(state, e) => { const _fn = (…declared) => { body }; return _fn(…) }`, every name but `state` gets `e`     | `(state) => key(state)` undeclared (drops the event and the host); `(state, e) => key(e, e)` for `["name", "weight"]` |
| `compile-element.ts` inline (`inlineHandlerBody`, `:1470`) | `((event) => { body })(e)`: a body reading `state` throws `ReferenceError`, since `template()` has only `s` | n/a                                                                                                                   |
| `compile-client.ts` (`emitClientModule`, `:945`)           | `(event) => { body }` called `fn(e)`, every name but `state` gets `e`                                       | after the classifier, an `on` adapter that maps declared names the same way                                           |
| Build-time scope (`buildInitialScope`, `:625`)             | `invoke(state, event)` mapping every name but `state` to the event                                          | a runtime-only placeholder                                                                                            |

Two consequences beyond the marker:

- Every `$src` entry in the repository that declares `parameters` is a positional helper or a `state`-first handler. The kit's eight (`jx-icon` `lookup` `["name", "weight"]`, `jx-swatch` `inkOf` `["color"]`, `jx-tabs` `applySelection` `["scope"]` and five more) are called as `state.x(…)` from templates, so in the element target `state.lookup(state.name, state.weight)` would reach `lookup(weight, weight)`. The kit runs through the interpreter today, so this is latent for it and live for any user component shaped the same way.
- A declaration naming two or more parameters besides `state` gets the event in every one of them where a wrapper maps names (`compile-client.ts`, the build-time scope, the element target's non-`state`-first form) and only in the first where the list is positional (the element target's `state`-first form, and the interpreter once `state` moves to the front). No tracked document has one: the 11 string bodies that declare parameters are `["event"]` (4), `["state"]` (3), `["state", "event"]` (2), `["_event"]` and `["state", "e"]`.

`emitMappedArray` (`compile-element.ts:1321`) also binds only `$ref` and `$expression` handlers on a map root, so an inline Function handler there is dropped without a word.

**Related.** `plan:spec/computed-function-classification` (§5.3 4b) puts a callable string body on `state` in `compile-client.ts`. `plan:spec/compiled-host-handlers` (§16.1) has an Open to emit an undeclared `$src` callable as the import itself. `plan:_shared/compiled-element-lifecycle` (§16.4) special-cases a `$src` `onMount` wrapper to forward the host. Each edits code this plan edits, in either order (Implementation says how).

## Outcome

- spec.md §5.3 4d → Implemented. The marker names the shared pieces every tier reads.
- A Function entry declaring both `body` and `$src`, in `state` or inline on an `on*` key, fails `jx validate`, fails the build, and throws in the interpreter.
- One parameter list in every tier: `state`, then the other declared names in declared order. An event binding passes `(state, event)`. A `$src` callable is the import itself, called with what its call site passes.
- `$lazy` loads on first call and returns a promise in both compiled targets and in the interpreter, and a `$lazy` entry used as a value is refused in all three.
- spec.md stays draft (other items are open), so nothing graduates.

## Decisions

- **Open:** one calling convention for every Function entry: `state` first, then the other declared names in order, invoked `(state, event)` by an event binding and positionally everywhere else. Recommendation: adopt it, with two consequences a maintainer signs.
  1. A `$src` entry's `parameters` describe the export and no longer re-map its arguments: an event binding calls the import with `(state, event)`. That is what §4.2 ("The first parameter is always `state`") and §4.3 already say, what `FunctionDef.parameters` says ("after the implicit state parameter"), what the interpreter does for every kit component, and the only reading under which the eight declared kit helpers work from a template. The element target's re-mapping arrived with the by-name fix for bodies and is pinned by one test ("maps a $src handler's declared parameters as well"); no document relies on it.
  2. The first declared name other than `state` receives the event, and a later one is positional (`undefined` from an event, filled by `state.key(state, a, b)`). That replaces §5.3 4d's "any other name receives the event", which no document exercises and which the element target's `state`-first form already breaks.

  One parameter list serves both kinds of call site, so no tier needs a name-mapping wrapper and a template can call a handler positionally. Fallback, if rejected: keep the spec sentence, and add event-site mapping instead (a `WeakMap` from function to declared names read by `bindHandler`, and an argument list threaded to the element target's two `$ref` event sites), which is about twice the code. The fragment stays `minor`: the two behaviours that change are ones no tracked document exercises.

- **Open:** does the interpreter honour `$lazy`? Recommendation: yes. It imports a `$lazy` entry on its first call through a memoized loader, returns that call's promise, and throws at scope build when the classifier calls the entry a computed. The promise is part of the contract (§5.3 4d: "the function now returns a promise"), so a call site that chains `.then` or relies on the call being synchronous behaves differently in Studio and on the built site, and a document Studio renders must not fail `jx build`. Fallback: one spec sentence saying the interpreter imports every `$src` entry at scope build and `$lazy` is a compiled-delivery choice.
- **Decided:** the exclusion is tested by presence (`"body" in def && "$src" in def`), because the schema's `not: { required: ["body", "$src"] }` tests presence and `jx validate` must agree with the tiers. It covers structured bodies and inline `on*` Function defs, because §5.3 4d's table describes every Function def and the schema's `FunctionDef` is used in both positions.
- **Decided:** the compiler refuses the pair at four sites through one `assertFunctionDefShape(where, def)` in `packages/compiler/src/shared.ts`: `buildInitialScope` (every page, layout, prerendered component and static page reaches it through `createCompileContext`), the state loop of `emitElementModule` (element modules and islands), and the `on*` loops of `emitLitNode` and `buildClientNode`. It throws as the `$lazy` computed-use error does, so `jx build` reports it against the page or component.
- **Decided:** `declaresBodyAndSrc` and `handlerParamNames` join `classifyFunctionEntries` in `packages/schema/src/function-role.ts`, because every tier already imports that module after the prerequisite, and it carries the functions page's docs association.
- **Decided:** `$lazy` import emission moves out of `emitElementModule` into `collectSrcImports`/`emitSrcImports` in `packages/compiler/src/shared.ts`, which both targets call, and its computed-use test reads the classifier's role. Two emitters of one feature is how `compile-client.ts` came to ignore it.
- **Decided:** `emitMappedArray` binds an inline Function handler on a map root through `inlineHandlerBody`, with the `$map` context `emitLitNode` already publishes, because §5.3 4d's binding rule covers inline handlers "in every compiled target".
- **Decided:** slices FET1.1 and FET1.2 land in either order and FET1.3 lands last, because FET1.3 writes `Implemented`. Each slice deletes its own clause from the marker in the same pull request.

## Implementation

The prerequisite's contract assumed: `classifyFunctionEntries(doc): Map<string, FunctionRole>` in `packages/schema/src/function-role.ts`; `resolveFunction(def, state, key, base, role)`; `emitElementModule` and `compileClient` holding `roles`; `compile-client.ts` emitting `state[key] = <import>;` and an `on[key]` adapter for a callable `$src` entry.

**FET1.1: `body` and `$src` are refused together.**

1. `packages/schema/src/function-role.ts`: `export function declaresBodyAndSrc(def: JxFunctionDef): boolean`, presence of both keys, JSDoc citing spec.md §5.3 4d.
2. `packages/schema/defs/function-def.schema.ts`: add `not: { required: ["body", "$src"] }` at the top level, and end `description` with "Declaring both is an error." `json-schema-to-ts` ignores `not` without `parseNotKeyword`, so `FunctionDef` in `types.ts` is unchanged; `bun run typecheck` confirms it. `StateEntry.oneOf` stays sound: the pair already matched only `FunctionDef` (`ExternalClassDef` refuses `$prototype: "Function"`, the plain-object branch refuses `$prototype`), so it now matches no branch.
3. `bun run schema:sync`, committing `packages/schema/schema.json` and the 28 `document.schema.json` files that embed `FunctionDef` (`examples/`, 13 under `packages/starters/sites/`, `packages/studio/`, `packages/ui/`, 10 under `scripts/screenshots/fixtures/`, `sites/jxsuite.com/`, `sites/test-blank/`). The report should name only `/$defs/FunctionDef/not` and its `description`.
4. `packages/runtime/src/runtime.ts`: `resolveFunction`'s check becomes `declaresBodyAndSrc(def)` (message unchanged). `bindHandler` gains the same check before its structured-body branch, throwing `` `Jx: inline '${key}' handler declares both body and $src — these are mutually exclusive` ``.
5. `packages/compiler/src/shared.ts`: `export function assertFunctionDefShape(where: string, def: unknown): void`, throwing `` `${where} declares both "body" and "$src"; they are mutually exclusive (spec.md §5.3 4d). Keep one.` `` when `isFunctionDef(def) && declaresBodyAndSrc(def)`. Call it at the top of the Function branch of `buildInitialScope` (`state entry "${key}"`), in `emitElementModule`'s first state loop (`compile-element.ts:362`), in `emitLitNode`'s `on*` loop before the `isFunctionDef(val)` branch (`inline "${key}" handler`), and in the `on*` loop of `buildClientNode` (`compile-client.ts:389`) before the structured-body branch.
6. `compile-element.test.ts`: the three fixtures lose `body`. "Function with $src generates import and wrapper" binds `onclick` to `handler` so it stays callable; the other two keep their expectations under the classifier.
7. Marker: delete the clause "declaring both `body` and `$src` throws at runtime scope build but is never a compile-time error;", adjust the rule count, and add "the `body`/`$src` exclusion (`declaresBodyAndSrc`)" to the list of what ships.

**FET1.2: one parameter list, one call convention.**

1. `function-role.ts`: `export function handlerParamNames(def: JxFunctionDef): string[]` returning `["state", ...names.filter((n) => n !== "state")]`, where `names` is `paramNames(def.parameters)` or `def.arguments ?? []`.
2. `runtime.ts`: delete `resolveParamNames`; its three callers (`resolveFunction` no-op and string body, `bindHandler` inline) use `handlerParamNames`. `bindHandler`'s calls stay `fn(scope, e)`, which now binds `state` by name. `$src` handling is unchanged.
3. `shared.ts`, `buildInitialScope`: the string-body branch builds `new Function(...handlerParamNames(def), body)` and stores it directly; the `invoke` mapper and its comment go. A computed stays `defineLazyScopeValue(scope, key, () => fn(scope))`.
4. `compile-element.ts`, the function-entry emission (`:547`–`588`) collapses to two forms. A string body is `this.state.<key> = (${handlerParamNames(def).join(", ")}) => { <body> };`. A `$src` callable is `this.state.<key> = <key>;`, the local binding `srcImportBinding` or the lazy loader names. The comment above it states the convention and cites spec.md §4.3 and §5.3 4d. Event sites (`s.fn(s, e)`) and lifecycle calls are unchanged.
5. `inlineHandlerBody`: with a declaration, `((${handlerParamNames(def).join(", ")}) => { <body> })(s, e)`; without one, today's `state` rewrite. `emitMappedArray`'s map-root `on*` loop gains the `isFunctionDef(val)` branch emitting `` `@${eventName}="\${(e) => { s.$map = $map; ${inlineHandlerBody(val)} }}"` `` after `assertFunctionDefShape`.
6. `compile-client.ts`: a string-body `onEntries` item and an inline handler (`:413`) take `handlerParamNames(def)` when a declaration exists; an undeclared inline handler keeps its `["state", "event"]` default. `emitClientModule` drops the `callArgs` mapping and emits `` `${key}: (e) => { const fn = (${argNames.join(", ")}) => { ${def.body} }; fn(state, e); },` ``. The classifier's `$src` adapter calls the import with `(state, event)` whatever is declared. If `plan:spec/computed-function-classification` has landed, its `state[key]` assignment for a callable string body takes the same parameter list, and its `on[key]` stays `(e) => state.key(state, e)`.
7. Spec and docs text for the convention (Specs & docs), and the marker clause "and the interpreter's `resolveParamNames` recognizes `state` only in first position rather than binding by name" deleted.

**FET1.3: `$lazy` in every tier.**

1. `shared.ts`: `export interface SrcImports { eager: Map<string, Set<string>>; lazy: Map<string, { binding: string; exportName: string }[]> }`; `export function collectSrcImports(defs, roles): SrcImports`, moving `compile-element.ts:357`–`393` (every `$src` Function entry; a `$lazy: true` one goes to `lazy` and throws the existing message verbatim when `roles.get(key) === "computed"`); and `export function emitSrcImports(imports, rewriteSrc?): { imports: string[]; loaders: string[] }`, moving the static import lines (`:394`–`399`) and the `_jxLazyN` loaders (`:425`–`438`).
2. `compile-element.ts`: calls both and places `imports` and `loaders` where the moved code emitted them, so its module text is unchanged.
3. `compile-client.ts`: `collectSrcImports(defs, roles)` replaces `srcImportMap`; `emitClientModule` takes the result, emits `imports` where the `$src` import loop is (`:898`) and `loaders` after the `lit-html` import. The classifier's `state[key] = <key>;` and adapter need no change, since the binding keeps its name.
4. `runtime.ts` (under the second Open): extract the import half of `resolveFunction` (`:1195`–`1224`: `seededModule`, base-relative `import()`, `_moduleCache`, the export check) into `async function importFunctionExport(def, key, base)`. For `def.$lazy === true && def.$src`: throw at scope build when `role === "computed"`, with the compiler's message prefixed `Jx:`; otherwise return `(...args) => (loaded ??= importFunctionExport(def, key, base)).then((fn) => fn(...args))`, named `def.name ?? key`, never computed.
5. Marker to Implemented, the `$lazy` paragraph, docs (Specs & docs).

**Integration contract.** Once this lands:

- `@jxsuite/schema/function-role` exports `declaresBodyAndSrc(def)` and `handlerParamNames(def)` beside `classifyFunctionEntries`; `packages/compiler/src/shared.ts` exports `assertFunctionDefShape`, `collectSrcImports` and `emitSrcImports`.
- Every tier builds a string body's parameters with `handlerParamNames`, and every event binding passes `(state, event)`. A compiled-element `$src` callable is `this.state.<key> = <key>;`, so `plan:_shared/compiled-element-lifecycle` passes the host at the `onMount` call site and needs no wrapper case, and `plan:spec/compiled-host-handlers`'s Open on undeclared `$src` entries is already met (whichever lands second drops its own copy of the change).
- `plan:compiler/element-binding-table` may keep `@click=${(e) => s.fn(s, e)}` in the §4.3 table; the event-site form does not change.
- spec.md §5.3 4d reads Implemented, with the convention and `$lazy` stated for every tier.

## Tests

`bun test --isolate --coverage` from each of `packages/schema` (thresholds `lines = 0.99, functions = 0.99`), `packages/runtime` (`0.963`/`0.98`) and `packages/compiler` (`0.982`/`0.98`). No source file is added, so the manifest check does not move; ratchet a workspace whose worst file rises. Fixtures are inline unless named.

**FET1.1**

- `packages/schema/tests/function-role.test.ts`: "declaresBodyAndSrc is true when both keys are present, an empty body included"; "declaresBodyAndSrc is false for body alone, $src alone, or neither".
- `packages/schema/tests/real-site-gaps.test.ts` (it validates the committed `schema.json`): "a Function state entry declaring both body and $src is refused"; "an inline on* Function declaring both is refused"; "body alone and $src alone still validate".
- `packages/runtime/tests/runtime.test.ts`, beside "Shape 4: Function with both body and $src → throws": "an empty body with $src is refused too"; "an inline on* Function declaring both body and $src throws when bound" (`renderNode` of a button with that `onclick`).
- `packages/compiler/tests/compile-element.test.ts`: "a state entry declaring both body and $src is a build error"; "an inline on* Function declaring both is a build error". `compile-client.test.ts`: the same two through `compileClient`. `shared.test.ts`, `describe("buildInitialScope")`: "an entry declaring both body and $src is refused".

**FET1.2**

- `function-role.test.ts`: "handlerParamNames puts state first and keeps the other names in order" (`[]`, `["event"]`, `["event", "state"]`, `["a", "state", "b"]`, CEM objects).
- `runtime.test.ts`, new `describe("parameter binding at event call sites (spec.md §5.3 4d)")`: "a state handler declaring [event, state] binds both" (click sets `state.last` to `"click"`); "an inline handler declaring [event, state] binds both"; "a second name after state is undefined from an event and positional from a template" (`["e", "extra"]` bound and also rendered through `${state.h(state, 1, 2)}`).
- `compile-element.test.ts`, `describe("declared handler parameters")`: the pinned `_fn` forms become `this.state.onSearch = (state, event) => {` and `this.state.bump = (state) => {`; new "an inline handler declaring only event can still reach state" (`((state, event) => {` … `})(s, e)`); "maps a $src handler's declared parameters as well" becomes "a $src callable is its import, whatever it declares" (`this.state.save = save;`, event site `s.save(s, e)`). `describe("bodyless $src classification")`: `(state) => rows(state)` becomes `this.state.rows = rows;` (four cases) and `this.state.onMount = onMount;`. New "an inline Function on a map root is bound".
- `compile-element-render.test.ts` (happy-dom, module loaded for real, sidecar written to `TMP`): "a $src helper declaring parameters gets the template's arguments", where an export `pair(a, b)` declared `["a", "b"]` and called from a text template as `state.pair(state.x, state.y)` renders the text 1:2; and "an undeclared $src handler receives the event", where an export `onPing(state, event)` bound to a `ping` event writes the event type to state.
- `compile-client.test.ts`: "a handler declaring [event, state] binds both" (the `on` entry is `(state, event) =>` called `fn(state, e)`); the classifier's "a $src handler's declared names map by name" becomes "a $src handler is called with (state, event) whatever it declares". `shared.test.ts`: "buildInitialScope builds a string body with state first" (`scope.h(scope, ev)` writes state for `["event", "state"]`).

**FET1.3**

- `compile-client.test.ts`, new `describe("compileClient — $lazy $src")`, mirroring the element cases in `sidecar-bundler.test.ts`: "emits a memoized dynamic import instead of a static one"; "the binding keeps its name, so state and the on adapter are unchanged"; "$export selects the export off the namespace"; "two entries from one module share one import"; "rewriteSrc applies to the dynamic import"; "a lazy entry the page reads as a value is a build error".
- `sidecar-bundler.test.ts`'s six `$lazy $src` cases stay green unchanged: the extraction moves no emitted byte.
- `shared.test.ts`: "collectSrcImports splits eager and lazy entries and refuses a lazy computed".
- `runtime.test.ts` (second Open), with a new fixture `tests/_test_lazy_module.ts` whose module body increments `globalThis.__jxLazyLoads` and which exports `lazyBump(state)`: "a $lazy entry is not imported at scope build"; "its first call returns a promise, and two concurrent calls share one import" (loads is 1; the memo is what keeps two `import()`s of one module from overlapping); "a $lazy entry read as a value is refused at scope build".

## Specs & docs

**`specs/spec.md` §5.3 4d**, in place, one fragment per slice:

- FET1.1. After "`body` and `$src` are mutually exclusive. Declaring both is a compile-time error." add: "The rule covers a `state` entry and a Function written inline on an `on*` property alike: both compiled targets refuse the pair at build, the interpreter throws when it builds the scope or binds the handler, and the `FunctionDef` schema refuses it, so `jx validate` reports it first." Marker edit per FET1.1 step 7. Fragment: `bun run spec:change spec.md minor -m '§5.3 4d: declaring both body and $src is refused in every tier and by the schema, for state entries and inline handlers alike.'`
- FET1.2. "Parameter binding at event call sites" becomes: "**Parameter binding at event call sites.** An event binding always invokes a handler with `(state, event)`. A string `body`, whether a `state` entry or a handler written inline on an `on*` property, is built with `state` as its first parameter and its other declared names after it in declared order. So `state` binds **by name, not by position**, and the first other name receives the event: `["event"]`, `["state", "event"]`, `["event", "state"]` and `["state"]` all bind what they read, and a body may reference `state` whether or not it declared it. A later name is positional, so an event binding leaves it `undefined` and `state.key(state, a, b)` from a template fills it. A `$src` entry is the imported function itself: an event binding calls it with `(state, event)` (§4.3), and a template, a `call` node or a lifecycle hook calls it with the arguments that call site passes. Its declared `parameters` describe the export; they do not reorder its arguments. This holds in the interpreter and in every compiled target alike." Marker edit per FET1.2 step 7. Fragment: `bun run spec:change spec.md minor -m '§5.3 4d: every tier builds a string body with state first and its other declared names after it, and calls a $src export with (state, event) from an event binding whatever it declares.'`
- FET1.3. The `$lazy` paragraph gains, after "…a build error rather than a promise rendered into the DOM.": "Both compiled targets emit the same loader. The interpreter does the same: it imports a `$lazy` entry on its first call rather than when it builds the scope, returns that call's promise, and refuses a `$lazy` entry the document uses as a computed when it builds the scope." The marker becomes:

  > **Status: Implemented.** The interpreter (`packages/runtime/src/runtime.ts`), both compiled targets and the build-time scope (`packages/compiler/src/shared.ts`) share each rule below: classification (`classifyFunctionEntries`), parameter lists (`handlerParamNames`) and the `body`/`$src` exclusion (`declaresBodyAndSrc`), all in `packages/schema/src/function-role.ts`, and `$lazy` imports (`collectSrcImports`).

  Fragment: `bun run spec:change spec.md minor -m '§5.3 4d: $lazy loads on first call in every tier, including pages compiled for the client and the interpreter, and a lazy entry used as a value is refused in all three; the section is implemented.'`

Under a rejected first Open, the FET1.2 paragraph keeps "any other name receives the event" and names the event-site mapping; under a rejected second Open, the FET1.3 sentence is "The interpreter imports every `$src` entry when it builds the scope; `$lazy` is a choice about compiled delivery."

**Docs** (no em dashes). No page's `spec:` cites `spec.md#4d`. `docs/framework/concepts/functions.md` cites `spec.md#5.3` and lists both compiled targets in `code:`:

- FET1.1: the first "Rules" bullet becomes "`body` and `$src` are mutually exclusive. Declaring both fails the build, fails in Studio's canvas, and is reported by `jx validate`." Add `packages/schema/defs/function-def.schema.ts` to `code:`.
- FET1.2: in "Inline handlers", "the names you declare bind **by name, not by position**: a parameter called `state` receives the reactive state, and any other name receives the event. So `["event"]`, `["state", "event"]`, and `["state"]` each bind exactly what they read" becomes "the body is built with `state` first and your other declared names after it, so `state` binds **by name, not by position** and the first other name receives the event. So `["event"]`, `["state", "event"]`, `["event", "state"]` and `["state"]` each bind exactly what they read". The second "Rules" bullet becomes "`state` is always reachable from a body, and a declared `state` receives it wherever it sits in the list; the first other declared name receives the event." Under "External sidecars", after the export example: "A sidecar export is called exactly as its call site calls it: an event binding passes `(state, event)`, and `state.helper(a, b)` in a template passes `a` and `b`. Declared `parameters` document the export; they do not reorder its arguments."
- FET1.3: a section "Loading a sidecar on first call" after "External sidecars": "Add `"$lazy": true` to a sidecar entry and its module loads the first time the function is called, not with the page. The entry keeps its name, so call sites do not change, but the function now returns a promise. Use it for a module most visitors never reach, such as a search client, and only on an entry you call from a handler or a lifecycle hook: an entry read as a value would render a promise, so the build and Studio both refuse it." with the `searchInit` entry from `docs/framework/site/search.md` as its example.
- `docs/framework/agents/authoring-rules.md` (its `code:` lists `packages/schema/schema.json`): rule 9's "the compiler rejects the latter" becomes "the build and Studio both reject the latter" (FET1.3, second Open).
- The other pages `bun run docs:sync` names for `runtime.ts`, `shared.ts`, `compile-element.ts` and `compile-client.ts` (components, elements, lists, reactivity, styling, props-and-scope, build and the rest) describe rendering, scope and output tiers, not parameter lists or `$lazy`; none changes. `docs/framework/site/search.md` already describes `$lazy` as it will behave.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/schema`, `packages/runtime` and `packages/compiler` with no file under its threshold; `bun scripts/check-coverage-manifest.ts packages/<pkg>` passes for each.
- `bun run schema:verify` is green, and `bun -e 'console.log(JSON.stringify((await Bun.file("packages/schema/schema.json").json()).$defs.FunctionDef.not))'` prints `{"required":["body","$src"]}`. `bun run schema:validate-all` and `bun run typecheck` pass.
- `rg -n 'resolveParamNames|const _fn =|callArgs' packages/runtime/src packages/compiler/src` finds nothing; `rg -n '\.\$lazy' packages/compiler/src/targets` finds nothing: `collectSrcImports` is the one compiler reader.
- Compiling a client page whose button binds `onclick` to a `$lazy` `$src` entry emits `import('` and no static import of that specifier; compiling `sites/jxsuite.com/components/site-search.json` with `compileElement` emits the same module text as before FET1.3.
- `bun run docs:status` shows spec.md §5.3 4d Implemented; `bun run plans:status --who-claims spec.md#4d` names no plan; `bun run plans:check` passes.
- `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass.

## Slices

| Slice  | Scope                                                                                                                                                                              | Claims     | State |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| FET1.1 | `body` and `$src` refused together: `declaresBodyAndSrc`, the `FunctionDef` `not` and regenerated schemas, the compiler's `assertFunctionDefShape`, the interpreter's inline check | —          | open  |
| FET1.2 | One parameter list and call convention: `handlerParamNames` in every tier, a `$src` callable is its import, the inline `state` and map-root fixes                                  | —          | open  |
| FET1.3 | `$lazy` in every tier: `collectSrcImports`/`emitSrcImports`, `compile-client.ts`, the interpreter's loader; the marker to Implemented                                              | spec.md#4d | open  |
