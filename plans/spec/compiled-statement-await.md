---
status: drafted
disposition: implement
claims:
  - spec.md#20.2
requires:
  - spec/compiled-element-parameterised-bodies
workspaces:
  - packages/runtime
  - packages/compiler
size: M
---

# A structured body runs as an async function in every tier, awaiting a thenable `call` result before its next statement

## Context

`specs/spec.md` §20.2, line 2348:

> **Status: Partial.** All six kinds ship in both halves (`packages/runtime/src/statements.ts`). Awaiting a thenable holds only in the interpreter's `runStatements`: `compileStatements` emits plain statements with no `await`, and the compiled handlers are synchronous arrows, so a compiled body runs its next statement before an async call settles.

The marker is accurate. The compiled wrappers are:

- `packages/compiler/src/targets/compile-client.ts`: `compileClient` puts a parameterless body in the `on` table, which `emitClientModule` emits as `(e) => { const fn = (state, e) => { … }; fn(state, e); }`; a parameterised body becomes `emitFormulaFn(def, "(() => {…})()")`; `buildClientNode` adds inline handlers to the same table; `emitLitMapTemplate` emits `(e) => { state.$map = { item, index }; … }`.
- `packages/compiler/src/targets/compile-element.ts`: `emitElementModule` emits `this.state.key = (s, e) => { … }`; `emitLitNode` emits `(e) => { … }` around `inlineHandlerBody`.

None of these is `async`, and `compileStatements` emits `expr;` for every expression statement.

**What detailing found beyond the marker.** Each item was probed against the tree, and each makes a sentence of §20.2 false once bodies really suspend:

1. **The interpreter yields after every branch.** `runStatements` runs `await runStatements(taken, …)` for `if` and `$switch` whether or not the branch suspended. In `[if → a = 1, b = 1]`, `b` is set a microtask after the call returns. The doc comment's claim, "purely synchronous bodies complete synchronously", holds only for flat lists.
2. **Result capture stores the promise.** `evaluateNode`'s assignment branch returns `undefined`, so `{ "=": x, value: call(async) }` assigns the pending promise to `state.x` and is never awaited. The probe printed `Promise { <resolved> }`.
3. **A dispatch after a suspension loses its target.** The platform clears `event.currentTarget` once dispatch ends. The interpreter then falls back to `opts.target`, which `bindHandler`'s inline listener does not pass, so it dispatches nothing (a `$ref`-bound `state` handler falls back to the mount root instead of the element). Compiled `(e && e.currentTarget)?.dispatchEvent(…)` also dispatches nothing. A resumption that runs as a microtask of a user-initiated event can still see `currentTarget`, because the platform runs microtasks between listeners; one after a timer, or after any event dispatched from script (`el.click()`, a `dispatchEvent` statement), cannot.
4. **A compiled client callable throws on a verb or a dispatch.** `emitFormulaFn`'s callable has no `e` in scope, and module scope declares none, so `e?.stopPropagation()` throws `ReferenceError`. §20.2 says the verb is a no-op there. The prerequisite fixes this (below).
5. **A structured `onMount` receives the host as its event.** The interpreter's element calls `onMount(state, this)`, and the handler lowering passes the host through as `event`, so `event?.stopPropagation()` throws `TypeError`. §20.2 says verbs are no-ops in a lifecycle hook. `plan:_shared/compiled-element-lifecycle` will make the compiled element pass the host too.
6. **A handler-form body called through `call` has no scope.** `buildScope` lowers it to `(s, event) => { void runStatements(body, s, …) }`, and `call` passes no arguments, so `s` is `undefined`. The body rejects, unhandled. §20.1's own example calls `refreshTotals` this way. `buildInitialScope` in `packages/compiler/src/shared.ts` already falls back with `s ?? scope`.

**The corpus** (every tracked `*.json`, schemas excluded) has 734 structured bodies with 725 expression statements: 676 `call`, 48 `=`, 1 `+=`. No assignment captures a `call`. No `dispatchEvent` follows a `call`. Of 95 `stopPropagation`/`preventDefault` statements, 7 follow a `call` in the same list: Studio's `block-action-bar.json`, `commandbar.json` and `rail.json` keydown bodies. All 7 call synchronous host actions (`leaveBar`, `applyLink`, `closeLink`, `openStudioMenu`, `openSettings`), inside a `$switch` case, so they run synchronously today. No body calls a structured entry of its own document.

**Requires `plan:spec/compiled-element-parameterised-bodies` (§20.3).** That plan adds `emitStatementsFn` to `shared.ts`, the one emitter of a structured callable for both compiled targets, declaring `_args` and `const e = null;` (which closes Context 4), and its integration contract says "a plan making compiled bodies `async` changes it and nothing else". This plan does exactly that, rather than adding a second callable emitter beside it. The prerequisite's own text anticipates this order: its compiled callable "stays synchronous", and "aligning the two is `async`, which is §20.2's work".

**Related, no edge.**

- `plan:spec/compiled-host-handlers` (§16.1) moves `emitLitNode`'s `on*` branches into `handlerSource`. Whichever lands second puts the `async` there; either order works.
- `plan:spec/callable-classifier` moves `LIFECYCLE_KEYS` to `@jxsuite/schema/function-role`. If it has landed, the element step below imports it from there.

Two compiled problems are not §20.2's:

- `compile-client.ts` never puts a handler-form body on `state`, so `call` cannot reach one in an island. `plan:spec/computed-function-classification` records the string-body case.
- A `$map/item` ref in a compiled statement compiles to an unbound `_item`.

## Outcome

- `spec.md` §20.2 → Implemented. The interpreter and every compiled target run a structured body as an async function that is synchronous until a `call` returns a thenable. At that point the body awaits the result, and a capture stores the settled value. The dispatch target is read on entry, the verbs are no-ops wherever there is no event, and the spec states when a verb still acts.

## Decisions

- **Decided:** every structured body lowers to an ECMAScript `async` function in every compiled wrapper, not only a body that contains a `call`. The interpreter's `runStatements` already returns a promise for every body, and so does its parameterised callable, so a caller's `call` sees the same thenable from both tiers. `async` costs nothing while the body runs synchronously. The consequence, which the spec states: a `call` of a structured entry always suspends its caller, even when the callee finished synchronously. A rule keyed on whether the callee contains a `call` would be more precise, but it would change the caller's timing whenever someone edits the callee, which an author of the caller cannot see. No document calls a structured entry today (Context, corpus).
- **Decided:** the node decides where a body may suspend, not the value. Only two shapes suspend: a `call` statement, and an assignment (`=`, `+=`, `-=`, `*=`, `/=`) whose `value` is a `call` node. Each suspends only when the result is a thenable (`typeof r?.then === "function"`), and this holds in both tiers. The emitter must know statically where to put an `await`. An unconditional `await` would yield on every synchronous call, and a following `preventDefault` would then miss any event dispatched from script. The interpreter narrows to the same shapes, which are §20.2's "mutation or `call`" statements. It no longer awaits a thenable that some other expression statement happens to return (a `pop` of an array of promises), which no statement in the corpus can produce.
- **Decided:** a body stays synchronous until its first thenable, and branches do not change that. The interpreter continues without yielding when a branch did not suspend (Context 1). The compiled `if`/`switch` blocks are inline, and the verb rule below is true only if both tiers agree on where the first suspension is.
- **Decided:** the dispatch target is read when the body starts (Context 3). The interpreter captures `event?.currentTarget` on entry. The emitter writes a `const $jxt = <target>;` prologue when a body both may suspend and dispatches. The `$jx` prefix cannot collide with anything the emitter writes for a ref (`_acc`, `_args`, `_item`, `_<key>`, `_d`, `_a`, `_fx_*`).
- **Decided:** the verbs are no-ops in a body run without an event, in both tiers. The interpreter's verbs act only on an argument that has the method (`typeof event?.stopPropagation === "function"`, likewise `preventDefault`), which covers the host `onMount` receives (Context 5). Only the verbs are guarded: `event#/` operands still read the argument as passed, so no existing read changes. The compiled callable declares `const e = null;` (the prerequisite's `emitStatementsFn`, Context 4), and a compiled lifecycle-key body declares the same, so the emitted `e?.stopPropagation()` stays a no-op when `plan:_shared/compiled-element-lifecycle` passes the host.
- **Decided:** a handler-form body in `buildScope` returns its body's promise and runs against its own scope when called without one (`s ?? state`, Context 6), as `buildInitialScope` already does. Returning the promise is what lets a `call` of the handler wait for the body. §20.1's example is the case that needs it.
- **Open:** what a capture of an async call stores. There are two readings: the settled value (the body awaits the call, then assigns), or the thenable itself (ECMAScript's `x = f()`, awaited before the next statement). Recommendation: the settled value. The capture form exists to hold a result, a document has no `await` for an author to write, and no document in the repository captures a `call` today (0 of 49 assignments), so no existing content changes.
- **Open:** how to handle `stopPropagation`/`preventDefault` after the first suspension. The choices are to hoist the verbs to the top of the body, or to state the rule. Recommendation: state it, and hoist nothing. The rule: a verb is guaranteed to act only before the body first suspends; after a suspension the event may have finished dispatching, and then the verb does nothing and `event#/currentTarget` reads `null` (Context 3 gives the one case where it still acts). This is exactly how a hand-written async listener behaves. Hoisting cannot move a verb whose branch test reads state that earlier statements wrote. It would also run the verbs ahead of statements the author put first, which changes the outcome when one of those statements throws. Add no lint either: all 7 verbs in the corpus that follow a `call` follow a synchronous one, so every warning would be a false positive.

## Implementation

**`packages/runtime/src/expression.ts`**

- Export `isAssignmentOperator(op)` beside `isMutating`, reading `ASSIGNMENT_OPS`.
- Extract the switch in `evaluateNode`'s assignment branch (the `=`/`+=`/`-=`/`*=`/`/=` cases after `resolveWritableRef`) into an exported function, `applyAssignment(node, rhs, state, event, iterCtx?)`. `evaluateNode` resolves the right-hand side as it does today, then calls it. No behaviour changes there.

**`packages/runtime/src/statements.ts`**

- Add `suspension(node): "call" | "capture" | null` and `isThenable(v)`: an object or function whose `then` is a function. Add `maySuspend(list)` and `hasDispatch(list)`, which recurse into `then`/`else`/`cases`/`default`. All four stay unexported.
- Split the interpreter into a synchronous driver, `runList(list, state, event, ctx, from = 0): Promise<void> | undefined`. `ctx` holds `opts`, the `iterCtx` and `eventTarget`. The driver runs statements in order and returns `undefined` when the list finished synchronously. At the first statement that returns a pending value, it returns `Promise.resolve(pending).then(() => runList(list, state, event, ctx, i + 1))`; `Promise.resolve` adopts any thenable the way `await` does, since a bare thenable's own `then` need not return a promise. The statement kinds work as follows:
  - **`call`:** evaluate it. Return a promise only when the result is a thenable.
  - **Capture:** evaluate `node.value`. Call `applyAssignment(node, settled, …)` at once when the result is not a thenable, otherwise in `Promise.resolve(result).then(…)`. Never evaluate the call twice.
  - **Any other expression:** evaluate it and return `undefined`.
  - **`if`/`$switch`:** return `runList(taken, …)`.
  - **Dispatch:** use `ctx.eventTarget ?? fallback`, where the thunk is still read at dispatch time, as today.
  - **`stopPropagation`/`preventDefault`:** call the method only when `typeof event?.<verb> === "function"`.
- Make `runStatements` the entry point, keeping its signature. It captures `eventTarget = event?.currentTarget ?? null` and returns `await runList(…)`, passing `event` through unchanged for operands. It stays `async`, so a synchronous throw still rejects and a synchronous body still completes before the promise settles.
- Split the emitter the same way. The public `compileStatements(statements, opts)` keeps its signature. When `maySuspend && hasDispatch`, it emits `${indent}const $jxt = ${opts.dispatchTarget ?? "(e && e.currentTarget)"};` first, using the `eventParam` name, and compiles with `dispatchTarget: "$jxt"`. The recursive work moves to an internal `compileList`, so nested lists never repeat the prologue. Each suspending shape compiles to one line:
  - `call`: `{ const $jxr = <call>; if (typeof $jxr?.then === "function") await $jxr; }`
  - capture: `{ let $jxr = <call>; if (typeof $jxr?.then === "function") $jxr = await $jxr; <lhs> <op> $jxr; }`, where `<lhs>` is `compileOperandSource(node.target, opts)` and `<call>` is `compileExpression(node.value, opts)`.
  - Every other statement compiles exactly as today, so a body with no `call` produces byte-identical output.
- Update the module and function doc comments to state the async rule.

**`packages/runtime/src/runtime.ts`** (`buildScope`, third pass): the handler form becomes `(s, event) => runStatements(body, s ?? state, event ?? null, { target: dispatchRoot })`, returning the promise. The parameterised callable is unchanged. `bindHandler`'s inline listener keeps `void`.

**`packages/compiler/src/shared.ts`**

- In `buildInitialScope`, the structured handler returns `runStatements(…)` instead of discarding it (the prerequisite already returns it from the callable branch).
- `emitStatementsFn` (the prerequisite's) returns `async (..._a) => { … }` instead of `(..._a) => { … }`. Its `const _args` and `const e = null;` lines stay first, so a `$jxt` prologue follows them. Nothing else in the file changes, and `emitFormulaFn` stays byte-identical.

**`packages/compiler/src/targets/compile-client.ts`**

- `HandlerDef` gains `async?: boolean`, and `emitClientModule` emits `const fn = ${def.async ? "async " : ""}(${argNames}) => { … }`.
- In `compileClient`, the parameterless structured branch pushes `{ args: ["state", "e"], async: true, body }`. The parameterised branch already goes through `emitStatementsFn`.
- In `buildClientNode`, the structured inline handler sets `async: true`.
- In `emitLitMapTemplate`, the structured handler is emitted as `async (e) => { state.$map = { item, index }; … }`.

**`packages/compiler/src/targets/compile-element.ts`**

- In `emitElementModule`, the structured handler branch (no `parameters`; the callable branch goes through `emitStatementsFn`) emits `= async (s, e) => {`. For a key in `LIFECYCLE_KEYS`, it emits `= async (s) => {` followed by `const e = null;`.
- In `emitLitNode` (in `handlerSource`, if `plan:spec/compiled-host-handlers` has landed), the Function-def handler is emitted as `async (e) => { … }` when `hasStructuredBody(val)`, and stays unchanged for a string body.

**Integration contract.** Once this lands:

- `compileStatements` output may contain `await` and a leading `const $jxt = …;`. Every emitter must place it directly inside an `async` function, and the identifiers `$jxr` and `$jxt` are reserved.
- `emitStatementsFn` emits an `async` callable; it stays the one emitter for a parameterised structured body. A host listener from `plan:spec/compiled-host-handlers` is `async (e) => { … }` around `compileStatements` output, through `handlerSource`.
- A compiled lifecycle-key body takes no event, so `plan:_shared/compiled-element-lifecycle` may pass the host as the second argument.
- `runStatements` keeps its signature and returns `Promise<void>`. It is synchronous up to the first thenable, and its verbs ignore a second argument that lacks the method.
- Every structured entry a `call` can reach returns a promise, in the interpreter, the build-time scope and the element target (and in an island, for a callable), so a `call` of one suspends its caller.
- `@jxsuite/runtime/expression` exports `applyAssignment` and `isAssignmentOperator`.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`. The runtime change also reaches `packages/ui` and `packages/studio`, which interpret structured bodies, and CI's affected matrix runs them. Statements after a branch now run earlier, so an existing test can only see its state sooner. The one statement that now runs later is one after a `call` of a structured handler-form entry, which no document does (Context, corpus); the existing runtime cases call their structured entries directly and assert synchronously on bodies with no `call`, which stays true.

**`packages/runtime/tests/statements.test.ts`**, new `describe("runStatements — suspension (spec §20.2)")`:

- `a statement after a synchronous branch runs before runStatements returns`: `void runStatements([if true → a = 1, b = 1])`, then `b === 1` synchronously.
- `a thenable call inside a branch holds the statements after the branch`: an order log shows `async` before `after`.
- `an assignment whose value is a call stores the settled result`: an async `load` gives `x === 42` after the await. A synchronous `load` assigns before the call returns, and the call runs once.
- `an operand is never awaited`: a `push` of a call returning a promise pushes the promise, and the next statement runs synchronously.
- `dispatchEvent after a suspension dispatches from the target the body started on`: an inline-style run with no `target` option still reaches the element's listener after the await.
- `a verb before the first suspension acts; after it, the event has already propagated`: `[stopPropagation, call later]` stops the event. `[call later, stopPropagation]` reaches the parent's listener.
- `a verb ignores a second argument that is not an event`: an element passed as `event` makes both verbs no-ops, with no throw, while an `event#/tagName` operand in the same body still reads the element's tag.

**`packages/runtime/tests/statements.test.ts`**, new `describe("compileStatements — suspension")`:

- `a call statement compiles to a conditional await`: an exact one-line string.
- `a capture compiles to await-then-assign`: an exact string, for `=` and for `+=`.
- `a body without a call compiles with no await and no prologue`: `not.toContain("await")` on the existing branching body.
- `a body that may suspend and dispatches reads its target once, on entry`: the prologue is the first line, and the dispatch reads `$jxt?.dispatchEvent(`.
- `compiled === interpreted for a suspending body`: build the source with `Object.getPrototypeOf(async () => {}).constructor`. The body mixes a timer-backed `call`, a branch, a capture, a dispatch and a `push`. Compare the order log, the final state and the received events with `runStatements`.

**`packages/runtime/tests/runtime.test.ts`** (`buildScope — structured function bodies`):

- `a handler-form body returns its promise, and a call of it waits for it`: the caller's statement after the `call` sees the handler's async work done.
- `called without a scope, a handler-form body runs against its own`.

**`packages/compiler/tests/`**

- `compile-client-coverage.test.ts` (`compileClient — structured statement bodies (spec §20)`):
  - Extend the parameterless case with `const fn = async (state, e) =>`. The parameterised case's existing `state["applyStep"] = (..._a) =>` becomes `state["applyStep"] = async (..._a) =>`; the named-formula case's `state["double"] = (..._a) =>` stays.
  - New `a string-body handler stays synchronous`.
  - New `a structured handler in a mapped row is async`.
- `expression.test.ts` (`structured bodies — compileElement`): update the pinned line to `this.state.addToCart = async (s, e) => {`, and the prerequisite's `this.state.addToCart = (..._a) => {` to `this.state.addToCart = async (..._a) => {`. New `a lifecycle hook's structured body takes no event` asserts `this.state.onMount = async (s) => {` and `const e = null;`.
- `shared.test.ts` (the prerequisite's `describe("emitStatementsFn")`): its cases await the call, so "does not throw" becomes `resolves`, and a new `returns a promise` asserts the result is a `Promise`.
- `compile-element.test.ts`: the inline structured case also asserts `async (e) =>`.
- `compile-element-render.test.ts`, new `describe("compiled element — a suspending structured body")`. A button's `onclick` body is `[preventDefault, call later, = status "done", dispatchEvent "loaded" (bubbles)]`, where `later` is a `$src` export written beside `lib.js` that resolves after a timer (the `call` makes it callable, so the element puts a function on `this.state.later`: a `(state) => later(state)` wrapper today, the import itself once `plan:spec/function-entry-tier-parity#FET1.2` or `plan:spec/compiled-host-handlers`' Open has landed; assert the behaviour, not that line). Right after `button.click()`, `defaultPrevented` is true and the status is unchanged. After the timer, `#status` renders `done` and a host listener received `loaded`.
- New `compile-client-render.test.ts`, following `compile-element-render.test.ts`: happy-dom globals, the island written under a `tests/` temp directory so `@vue/reactivity` resolves, and `document.body` set from the compiled HTML before import (hydration binds the `@click` attributes, which happy-dom parses). The same button body, but `later` is a parameterised structured entry whose body is `[stopPropagation, = tick $args/n]`, so the case does not depend on how the island lowers a `$src` entry (a `computed` today, a callable once `plan:spec/callable-classifier` lands). Right after the click, `defaultPrevented` is true, `#status` is unchanged and nothing threw. After a timer tick, `tick` is set, `#status` renders `done`, and a `document` listener received `loaded`. Before this plan the click runs the whole body synchronously, so the "unchanged" assertion fails.

**Coverage.** This plan adds no source file, so the manifest check is unaffected. The per-file thresholds apply: `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`) and `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`). The new cases must cover every arm of `runList` and `compileList`. If the worst file in either workspace rises, ratchet that threshold to just below the new minimum.

## Specs & docs

**`specs/spec.md` §20.2, edited in place:**

- The marker becomes:

  ```markdown
  > **Status: Implemented.** Both halves run a body as an async function that suspends only on a thenable `call` result: `runStatements` and the `async` functions every compiled target wraps `compileStatements` in (`packages/runtime/src/statements.ts`; `packages/runtime/tests/statements.test.ts`, `packages/compiler/tests/compile-element-render.test.ts`, `packages/compiler/tests/compile-client-render.test.ts`).
  ```

- The verbs bullet gains, after "(a parameterised callable, a lifecycle hook).": "They are guaranteed to act only before the body first suspends (below): once the body waits, its event may finish dispatching, after which its propagation and default action are settled and a verb does nothing, so a body that must stop or cancel its event states the verb before its first `call`."
- The **Result capture** bullet gains: "When the call returns a thenable, the assignment stores its settled value."
- The dispatch bullet: "from the handler's `event.currentTarget` (interpreter and client islands) or the component instance (compiled custom elements)" becomes "from the `event.currentTarget` the handler started with, read on entry because the platform clears it once dispatch ends (interpreter, client islands, and handlers written inline in a compiled custom element), or from the component instance (a `state` entry of a compiled custom element)". The old wording was already wrong for inline handlers, which `inlineHandlerBody` compiles against `e.currentTarget`.
- The last bullet becomes: "Statements execute sequentially, and a body is an ECMAScript async function: it runs synchronously until a statement suspends, and returns a promise that settles when the body completes. Two shapes suspend, and only when the call's result is a thenable: a `call` statement, and an assignment whose `value` is a `call`; the next statement runs once it settles. A structured function is itself such a body, so a `call` of one always suspends its caller. No operand is awaited, so an `if` test, a `$switch` discriminant, a `detail` or an array-method argument that evaluates to a thenable is used as the thenable itself. After a suspension `event#/currentTarget` may read `null`, as in any async listener."
- §20.3 is the prerequisite's, and its edit has landed by then. Its "the two event verbs emit `event?.stopPropagation()`" stays true.

**Fragment:** `bun run spec:change spec.md minor -m "§20.2: a structured body runs as an async function in the interpreter and every compiled target, suspending only on a call that returns a thenable; a captured call stores the settled value, a call of a structured function suspends its caller, the dispatch target is read when the body starts, and stopPropagation and preventDefault are guaranteed to act only before the first suspension."`

**Docs.** `docs/framework/concepts/statements.md` (`spec: spec.md#20`; the prerequisite adds `code:` naming `statements.ts`, so `docs:sync` names it too) changes. Em dashes are banned there.

- **Expression statements:** after the capture example, add "If the function returns a promise, the step waits for it and stores the settled value."
- **Dispatching events:** "The event dispatches from the handler's `event.currentTarget`" becomes "The event dispatches from the element the handler started on, its `event.currentTarget` when the body began, even after a step that waited".
- **Stopping and cancelling events:** add "Put these steps before any step that calls a function returning a promise. The event may finish dispatching while the body waits, and a stop or a cancel after that does nothing. The example above puts them first for that reason."
- **Parameters:** add "Calling a structured function always waits for it, because it returns a promise even when it has nothing to wait for."
- **How it works:** the emitted function becomes "an `async` function, identical in shape to a hand-written async handler". The last paragraph becomes "Statements execute sequentially. A `call` step, or an assignment that captures one, waits for a returned promise before the next step runs. A body with nothing to wait for runs to completion synchronously."
- **Rules:** "thenable results are awaited before the next step" becomes "a `call` step that returns a promise, captured or not, is awaited before the next step; nothing else is awaited". Add a rule: "`stopPropagation` and `preventDefault` are only certain to take effect before the first awaited step."
- **The ladder table:** the string row drops "`await` chains", because a sequence of awaited calls is now expressible as statements.

`bun run docs:sync` will also name the pages whose `code:` lists `compile-client.ts`, `compile-element.ts`, `runtime.ts`, `expression.ts` or `shared.ts` (`functions.md`, `elements.md`, `components.md` and others; `docs/extending/reference/standards.md` is generated). None of them describes handler timing, so none changes. `docs/studio/logic/statements.md` lists only Studio files and does not change.

This plan does not graduate `spec.md`, whose other open items remain.

## Acceptance

- From `packages/runtime` and `packages/compiler`: `bun test --isolate --coverage` is green, with no file below its `bunfig.toml` threshold. `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler` pass.
- This command prints the `const $jxt = (e && e.currentTarget);` prologue, the one-line conditional await, and `$jxt?.dispatchEvent(new CustomEvent("done"));`:

  ```sh
  bun -e 'import { compileStatements } from "./packages/runtime/src/statements.ts"; console.log(compileStatements([{ operator: "call", target: { $ref: "#/state/load" }, value: [] }, { dispatchEvent: "done" }], { eventParam: "e", statePrefix: "state" }))'
  ```

- `rg -n "compileStatements\(" packages/compiler/src` shows every call site inside an `async` wrapper or `emitStatementsFn`.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` are green. `bun run plans:status --spec spec` no longer lists §20.2.
