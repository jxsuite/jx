---
status: drafted
disposition: implement
claims:
  - spec.md#4b
requires:
  - spec/callable-classifier
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: M
---

# An inline Function body is a computed value only when nothing calls it, and every tier agrees

## Context

`specs/spec.md` §5.3 4b, line 396:

> **Status: Partial.** The bare-`return;` rule ships in every tier through `bodyReturnsValue` (`packages/schema/src/guards.ts`). The "no `arguments`" condition holds only in the interpreter (`resolveFunction` in `packages/runtime/src/runtime.ts`): `compile-element.ts`, `compile-client.ts` and the build-time scope in `packages/compiler/src/shared.ts` classify a string body by `bodyReturnsValue` alone, so a body with declared `parameters` that returns a value compiles to a `computed()` with its parameter unbound. No tier classifies by reactive use, as the first paragraph below describes; classification reads the declaration and the body text.

The paragraph it refers to (line 405): "A function with only `body` (no `arguments`) and no event binding acts as a computed value — the framework automatically wraps it in `computed()` when it detects it is referenced reactively." §5.3 4d's "Classifying an external Function" defines a callable use (an `on*` binding, a `call` node's target, `state.key(…)` in a template or body, a lifecycle key) and ends "matching the inline-body rule in 4b".

**The marker has two halves, and the prerequisite closes the first.** `plan:spec/callable-classifier` builds one document-level classifier, `classifyFunctionEntries(doc)` in a new `packages/schema/src/function-role.ts` (`@jxsuite/schema/function-role`), that every tier reads (`buildScope`/`resolveFunction`, `emitElementModule`, `compileClient`, `buildInitialScope`), with declared `parameters`/`arguments` making an entry callable. Its per-entry rule, `functionEntryRole`, has a string-body arm that reads "computed exactly when `bodyReturnsValue` holds" until this plan decides the usage half. It also computes the use set this plan needs, lazily and at most once per document: `collectCallableRefs` (`compile-element.ts:285`) lifted as `collectCallableKeys`, walking the root's own `on*` keys too, plus each `LIFECYCLE_KEYS` member (line 270) present in `state`. After it lands, `bodyReturnsValue` is defined in `guards.ts` and called only from `function-role.ts`, and the 4b marker this plan flips is the narrowed one it writes, which keeps only the usage half open ("No tier classifies an inline body by reactive use, as the first paragraph below describes; classification reads the declaration and the body text.").

**One tier does not see the document.** The prerequisite leaves `buildInitialScope(defs, parentScope)` classifying `{ state: defs }` alone, because no build-time verdict depended on usage. Under a usage rule one does: an `on*` binding or a `${state.fmt(…)}` in `children` is invisible to it. Its integration contract names the callers that hold the document (`createCompileContext`, `shared.ts:447`; `buildInstanceScope`, `shared.ts:1598`; `site-build.ts:1308`, `layoutDoc`) and the one that does not (`site-build.ts:784`, the `buildScope(state)` a format extension's `serialize` receives, which `extensions/parser/src/serialize.ts` calls with a page's state and with each component instance's).

Verified at the working tree on 2026-09-26:

- **The body-text rule kills bound handlers.** Compiling a page and an element whose button binds `onclick` to `toggle` (`"state.open = !state.open; return state.open"`) or `prune` (`"state.items = state.items.filter(i => { return !i.done })"`) emits `state.toggle = computed(…)` and `state.prune = computed(…)` in both targets. `bodyReturnsValue` is textual (`/\breturn\b[^\S\n]*(?![;}\s]|$)/`), so a `return` inside a callback counts. The consequence differs per tier and is never a working handler:
  - the interpreter's `bindHandler` (`runtime.ts:1521`) resolves the `$ref` to the computed's value, finds no function and attaches nothing;
  - `compile-element.ts` emits `@click="${(e) => s.toggle(s, e)}"`, which throws `TypeError` on each click;
  - `compile-client.ts` wires `on.toggle`, which does not exist, so `addEventListener` gets `undefined`;
  - `buildInitialScope` stores a lazy getter (`defineLazyScopeValue`), never a callable.

  The same happens to an `onMount` whose body returns a value: `mount()` (`runtime.ts:248`) and the element's connect path (line 4445) test `typeof onMount === "function"` and skip it.

- **`compile-client.ts` never puts a string-body handler on `state`.** `emitClientModule` (line 859) writes each one into `const on = {…}` (line 946) only. So `state.key(…)` from a template or from another body fails on a client-compiled page even for a plain handler. Probe: `go` with body `state.bump(state)` compiles to `go: (e) => { … state.bump(state) … }` with no `state.bump` anywhere in the module. The interpreter (`state[key]`), the element target (`this.state[key]`) and the build-time scope (`setOwnScopeValue`) all expose it. After `plan:spec/callable-classifier`, a parameterised body there becomes an `on` entry, which is still unreachable from its `state.dbl(…)` call site.
- **The corpus does not move.** The tracked JSON documents hold 40 string-body Function entries in 13 files: `examples/components/*` (9), `packages/starters/sites/{real-estate,shop}/components/*` (2) and `sites/jxsuite.com/components/{site-search,theme-toggle}.json`. Taking the use set with root `on*` keys and lifecycle keys, 18 return a value and none is used as a callable, and 22 do not return a value and every one is used as a callable. The body-text rule and the usage rule give all 40 the same verdict.
- Tests that pin today's inline verdicts: `runtime.test.ts` "Shape 4: Function with return in body → computed" (line 392) and the two parameter cases after it; `compile-element.test.ts` "signal functions become computed" (line 205); `compile-client.test.ts` "includes computed import when computed entries present" (line 597); `custom-elements.test.ts` line 548 (`onPick` read as `${state.onPick}`, never bound). None binds or calls a value-returning body, so none changes.

**Related.** §5.3 4d (`plan:spec/function-entry-tier-parity`, the external half of the same rule), §16.4 (lifecycle keys), §19.4c (`call` nodes; `parameters` make an entry callable), §20.3 (the structured-body equivalent, `plan:spec/compiled-element-parameterised-bodies`), `compiler.md` §4.

## Outcome

- spec.md §5.3 4b → Implemented. A string-body Function entry is a computed value exactly when it declares no parameters, the document never uses it as a callable, and its body returns a value. Every tier applies that one rule through the classifier.
- A callable string-body entry is reachable as `state.key(…)` on a client-compiled page, as it already is in the other three tiers.
- spec.md stays draft (it has other open items), so no graduation.

## Decisions

- **Open:** does use decide an inline body's role, as §5.3 4b's first paragraph and 4d's "matching the inline-body rule in 4b" say, or is 4b rewritten to the body-text rule? Recommendation: use decides (implement). Reasons:
  - It fixes a silent class of dead handlers in every tier (a `return fetch(…)`, a `return` after an assignment, a `return` inside a `filter` callback).
  - It gives inline and external entries one rule.
  - It is one branch of a classifier that already computes the use set.
  - It changes none of the 40 shipped entries.

  The cost a maintainer signs: an entry's role is no longer readable from the entry alone. Binding a computed to an event elsewhere in the document turns it into a function, and its `${}` reads then render function text, exactly as a `$src` entry does today. If rejected:
  - Implementation steps 1 and 2 and their tests drop out, and `packages/schema` and `packages/runtime` leave `workspaces`.
  - 4b's paragraph at line 405 becomes "A Function entry with a string `body` is a computed value when it declares no `parameters` or `arguments` and its body returns a value; otherwise it is a function. Use does not enter into it: binding such an entry to an event attaches no handler."
  - 4d's "matching the inline-body rule in 4b" is struck, coordinated with `plan:spec/function-entry-tier-parity`, which owns 4d.
  - Step 3 (the client target's `state.key(…)` reachability) stays here, because a string-body function is unreachable from a template or a `call` node in that target under either rule. The disposition therefore stays `implement`, and the fragment stays `minor`.

- **Decided:** the order is declared parameters, then callable use, then body text. A string-body entry is callable when it declares a non-empty `parameters` or `arguments`; otherwise it is callable when the document uses it as one; otherwise it is computed when `bodyReturnsValue(body)` holds; otherwise it is a handler. The reason is that a callable use wins over a value read for `$src` entries (4d) and `collectCallableRefs` already defaults that way ("Defaulting the other way round would turn a called helper into a value and break its call site"), so one precedence serves both kinds of entry. There is no diagnostic for an entry that is both called and read as a value, as for `$src` today.
- **Decided:** the use set is the classifier's own, unchanged, including its answer on root `on*` keys and on project-state entries (§19.4c's merge). The reason is that a second walker for inline bodies would be exactly the drift this program removes.
- **Decided:** the walk stays lazy but is reached more often. The string-body arm tests `bodyReturnsValue` first and asks for the use set only when the body returns a value, so a document of handlers still never walks. A document with a value-returning, parameterless body now walks once per `buildScope`, which is once per interpreted custom-element instance. That is the same linear walk the element target already runs per compile, and no cache is added.
- **Decided:** `buildInitialScope` gains an optional third parameter, `roles`, defaulting to today's `classifyFunctionEntries({ state: defs })`, and the three callers that hold the document pass that document's roles. Without it the build-time scope would still compute a bound, value-returning handler as a lazy value, and 4b's "every tier" would be false there. The `serialize` helper at `site-build.ts:784` keeps the default: its caller passes a page's state and each component instance's through the same function, so no single document is right. There, only a use inside `state` (another body, a lifecycle key) counts, which never gives a worse verdict than the body-text rule does today.
- **Decided:** `bodyReturnsValue` stays textual. There is no parse to skip nested functions, because the usage rule makes its known false positive (a `return` in a callback) harmless for every bound or called handler. An entry nothing calls is exactly where the body text should decide, and a JavaScript parser in `@jxsuite/schema` would be a new dependency for an edge case.
- **Decided:** `compile-client.ts` assigns every callable string-body state entry to `state`, and `on[key]` delegates to it. The reason is that the rewritten 4b counts `state.key(…)` as a callable use, and a verdict whose function is unreachable from that call site is not implemented in that tier. The emitted shape copies the element target's (`(state, e)`, declared names bound by name), so the two compiled targets call a string body alike. `$src` entries are left to the classifier and 4d.
- **Decided:** the corpus agreement is an acceptance check, not a committed test. A committed test would need `EXTRA_EDGES` entries for `examples/`, `sites/` and `packages/starters/`, and a future document may legitimately get a different verdict than the body-text rule, which is the point of the change. The committed tests pin the rule.

## Implementation

1. **The classifier's string-body arm** (`functionEntryRole` in `packages/schema/src/function-role.ts`, as `plan:spec/callable-classifier` lands it). Declared parameters are already decided by the arm before it, so the arm becomes `bodyReturnsValue(body) && !callableKeys().has(key) ? "computed" : "callable"`, where `callableKeys` is the memoized use set the `$src` arm already reads. Testing the body first keeps the walk off for a document of handlers. The JSDoc of `functionEntryRole` and `classifyFunctionEntries` states the order (structured body, declared parameters, callable use, body text) and cites spec.md §5.3 4b and 4d; the prerequisite's "only when a bodyless `$src` entry needs it" wording on the walk becomes "only when an entry's verdict needs it". `bodyReturnsValue` in `guards.ts` is untouched; its comment gains one sentence: the test is textual, and a callable use decides first.
2. **`buildInitialScope` receives the document's roles** (`packages/compiler/src/shared.ts`, `packages/compiler/src/site/site-build.ts`). `buildInitialScope(defs, parentScope, roles = classifyFunctionEntries({ state: defs }))`, typed `ReadonlyMap<string, FunctionRole>`, replacing the prerequisite's local `roles` constant. `createCompileContext` passes `classifyFunctionEntries(raw)`; `buildInstanceScope` passes `classifyFunctionEntries({ ...doc, state: stateDefs })`, so a prop never changes which entries are functions; `site-build.ts:1308` passes `classifyFunctionEntries(layoutDoc)`. The `serialize` helper at `site-build.ts:784` is unchanged (Decisions). `resolveFunction`, `emitElementModule` and `compileClient` need no edit: each already classifies the whole document it builds. Confirm in review that `bodyReturnsValue(` is called only from `function-role.ts`.
3. **`packages/compiler/src/targets/compile-client.ts`, callable reachability.**
   - `compileClient`: in the `isFunctionDef` branch, where a string body the verdict calls callable is pushed to `onEntries`, also add its key to a new `stateCallables: Set<string>`, and pass the set to `emitClientModule` as a new parameter (after `onEntries`). Synthetic `_h*` keys from inline `on*` definitions, mutating `$expression` entries and structured bodies are not added. Those are §19 and §20 lowerings with their own shapes.
   - `emitClientModule`: for each key in `stateCallables`, emit `` `${refAccessor("state", escapeToken(key))} = (state, e) => { const fn = (${argNames.join(", ")}) => { ${body} }; return fn(${callArgs}); };` `` directly after the `reactive({…})` block and before the init blocks, so a `Request` URL, a computed or a template that calls it finds it whatever the key order. Here `argNames` is the entry's `args ?? ["state"]` and `callArgs` maps `state` to `state` and any other name to `e`, which is today's `on` construction plus `return`. The `on` entry for that key becomes `` `${objectKey(key)}: (e) => ${refAccessor("state", escapeToken(key))}(state, e),` ``. Every other `on` entry is emitted as today.
   - The JSDoc of `emitClientModule` gains the parameter, and the module header's "Functions whose body contains `return` become computed() on state" becomes "Function entries the classifier calls computed become computed() on state". No `new Function` or `eval` is introduced (spec.md §21.1; `no-eval.test.ts` stays green unchanged).
4. Spec and docs edits, as listed below.
5. In the landing PR, delete this file. No plan requires it, so no dependent's `requires` changes.

**Integration contract.** Once this lands:

- For a string-body Function entry, the classifier's verdict follows the four-step order above: declared parameters, callable use (the classifier's own root-aware use set), `bodyReturnsValue`, handler. Every tier reads it.
- `buildInitialScope(defs, parentScope, roles?)` takes the document's roles; a caller that has the document passes `classifyFunctionEntries(doc)`, and one that does not gets the state-only default.
- On a client-compiled page, every callable string-body state entry is `state[key]` with signature `(state, e)`, assigned before the init blocks, and `on[key]` calls it.
- spec.md §5.3 4b states the rule, defines "used as a callable" by pointing at §5.3 4d's list, and carries `Implemented`. 4d's "matching the inline-body rule in 4b" is true as written, so `plan:spec/function-entry-tier-parity` may rely on it without editing 4b.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`). In `tests/function-role.test.ts` (added by `plan:spec/callable-classifier`), two of its cases change: "a lifecycle key whose string body returns a value is still computed" is replaced by the lifecycle case below, and "the walk runs once, and only when a bodyless $src entry needs it" becomes "the walk runs once, and only when an entry's verdict needs it" (the counting `children` getter is read zero times for a document of handlers, and once for a document with a value-returning string body). Add an inline-body block:

- "a value-returning body bound to an `on*` event is callable": `toggle` bound from a child button.
- "a handler whose only `return` sits in a callback is callable when bound": `prune`.
- "a value-returning body bound on the document root is callable": the root's own `onclick`.
- "a value-returning body named as a lifecycle hook is callable": `onMount` with `"state.ran = true; return state.ran"`.
- "a value-returning body called as `state.key(…)` from a template is callable": `fmt` read as `${state.fmt(state)}`.
- "a value-returning body that is a `call` node's target is callable".
- "a value-returning body that is only read stays computed": `label` read as `${state.label}`.
- "callable use wins over a value read": `fmt` both called and read.
- "a body with no value-returning `return` is a handler whether or not anything binds it".

**`packages/runtime`** (`bun test --isolate --coverage` from `packages/runtime`):

- `tests/runtime.test.ts`, beside "Shape 4: Function with return in body → computed":
  - "Shape 4: a value-returning body bound to an event stays a handler". `buildScope` of a document whose child button binds `onclick` to `toggle`; `renderNode` the child; `click()`. Assert `typeof state.toggle === "function"` and `state.open === true`.
  - "Shape 4: a value-returning body called from a template stays a function". `${state.fmt(state)}` renders the returned text, not an error.
- `tests/mount.test.ts`, "mount — render, dispose, lifecycle": "an onMount whose body returns a value still runs". Mount a document whose `state.onMount` is `{ "$prototype": "Function", "body": "state.ran = true; return state.ran" }` and assert `m.scope.ran === true`.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/compile-client.test.ts`:
  - "a value-returning body bound to an event compiles to a handler". The module has no `state.toggle = computed(`, has `state.toggle = (state, e) =>` and `toggle: (e) => state.toggle(state, e)`.
  - "a string-body handler is reachable as state.key(…)". The `bump`/`go` page, plus a `Request` entry declared before `bump`: the module assigns `state.bump` before the fetch `effect(`, and `go`'s body is unchanged.
  - "an inline on* handler is not put on state". No `state._h0`.
- `tests/compile-element-render.test.ts`, new `describe("compiled element — a value-returning handler")` with its own document compiled into the same `TMP` dir. It binds `toggle` to a button and renders `${state.open}`. Clicking flips the text, and no error is thrown.
- `tests/compile-element.test.ts`, "a value-returning onMount compiles to a function": the content contains `this.state.onMount = (state) => {` and not `this.state.onMount = computed(`.
- `tests/prerender-runtime-state.test.ts`, with the scope built by `createCompileContext(doc).scope` for a document whose child reads `${state.fmt(state)}`, so the roles reach `buildInitialScope` the way the build hands them:
  - "a value-returning body the document calls is a scope function": the property descriptor of `fmt` has `value`, not `get`.
  - "a template calling it prerenders the result": `evaluateStaticTemplate("${state.fmt(state)}", scope)` is the returned text.
  - "without the document, only uses inside state count": `buildInitialScope(doc.state)` still defines `fmt` as a lazy getter, and an entry another body calls as `state.fmt(…)` is a function.

**Coverage.** No source file is added, so no manifest check moves. `function-role.ts` gains one condition, and each outcome has a case. `compile-client.ts` gains one parameter and one branch, covered by the three client cases. `shared.ts` gains a defaulted parameter and three call-site arguments, covered by the prerender cases and the existing `buildInstanceScope` suites; `site-build.ts:1308` runs in every site-build test. Thresholds are `lines = 0.99, functions = 0.99` (`packages/schema`), `lines = 0.963, functions = 0.98` (`packages/runtime`) and `lines = 0.982, functions = 0.98` (`packages/compiler`). Ratchet only if the run shows a workspace's worst file rose.

## Specs & docs

**`specs/spec.md` §5.3 4b**, in place:

- The marker (line 396, as `plan:spec/callable-classifier` narrows it) becomes:

  > **Status: Implemented.** The interpreter's `buildScope`, both compiled targets and the build-time scope read one verdict per entry from `classifyFunctionEntries` (`packages/schema/src/function-role.ts`), which applies the rule below to the whole document the tier builds.

- The paragraph at line 405 is replaced by: "A Function entry with a string `body` is a **computed value** when all three hold: it declares no `parameters` or `arguments`; the document never uses it as a callable (bound to an `on*` event, the target of a `call` node, called as `state.key(…)`, or named as a lifecycle hook, as §5.3 4d lists); and its body returns a value. The framework wraps it in `computed()`, so it is read like any other state entry and re-evaluates when the state it reads changes. Otherwise the entry is a function. A callable use decides before the body does, so a handler whose body returns a value still handles its event, and an entry that is both called and read is a function in both places."
- The bare-`return;` paragraph (line 407) gains a closing sentence: "The test is textual, so a `return` inside a nested callback also counts; that matters only for an entry nothing calls or binds."
- §5.3 4d: no edit. Its "matching the inline-body rule in 4b" becomes true.

**Fragment:** `bun run spec:change spec.md minor -m "§5.3 4b: an inline Function body is a computed value only when it declares no parameters, nothing uses it as a callable, and it returns a value, in every tier; a bound handler whose body returns a value now handles its event."` It is minor because this is an implement, and the only behaviour it changes was broken in every tier.

**Docs** (no em dashes). `bun run docs:sync` names `docs/framework/concepts/functions.md` (`code:` lists `compile-client.ts`; `spec:` cites `spec.md#5.3`) and `docs/framework/build.md` (`code:` lists `compile-client.ts`).

- `functions.md`, "Inline computed values":
  - The first paragraph becomes "A function with only a `body` that returns a value, declares no `arguments` or `parameters`, and is never called or bound is a computed value: the framework wraps it in `computed()`, and you read it like any other state entry:".
  - After the guard-clause example, add "Use decides first. An entry you bind to an event, call as `state.helper(state)`, invoke through a `call` expression, or name as a lifecycle hook stays a function even when its body returns a value, so a handler ending in `return state.open` or with a `return` inside a callback still runs when clicked. Sidecar entries follow the same rule, below."
- `functions.md`, "How it works": "A body-only function referenced from a reactive position is wrapped in `computed()` instead" becomes "A body that returns a value, declares no parameters and is never called or bound is wrapped in `computed()` instead".
- `build.md`, line 155: the prerequisite's "A computed `$prototype: "Function"` (a body that returns a value and declares no parameters) is evaluated at build time" becomes "A computed `$prototype: "Function"` (a body that returns a value, declares no parameters, and that nothing calls or binds) is evaluated at build time". The rest of the bullet is unchanged.
- `bun run docs:sync` also names the pages whose `code:` lists `shared.ts` or `site-build.ts` (`styling.md`, `color-schemes.md`, `elements.md`, `redirects.md`, `deployment.md`, `seo.md`). None describes how a Function entry is classified, so none changes. No other page cites §5.3 4b. `docs/extending/reference/implementation-status.md` is generated and picks up the marker.

## Acceptance

- From `packages/schema`, `packages/runtime` and `packages/compiler`, `bun test --isolate --coverage` is green with the new cases. `bun scripts/check-coverage-manifest.ts packages/schema` (and the same for `packages/runtime` and `packages/compiler`) passes from the root.
- `rg -n 'bodyReturnsValue\(' packages/*/src` lists only its definition in `packages/schema/src/guards.ts` and its call in `packages/schema/src/function-role.ts`.
- Compiling the `toggle`/`prune` page from Context with `compileClient`, and the same document as an element with `compileElement`, emits no `computed(` for either key. The client module assigns `state.toggle` and `state.prune`.
- Run the classifier over every tracked JSON document with a `state` object (`git ls-files '*.json'`). Each of the 40 string-body Function entries in 13 files gets the verdict `hasParams || !bodyReturnsValue(body) ? "callable" : "computed"` gives it: zero differences, 18 computed and 22 callable.
- `bun run docs:status` shows spec.md §5.3 4b `Implemented`. `bun run plans:status --who-claims spec.md#4b` names no plan.
- `bun run docs:spec-release` finds the fragment. `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` are green.
