---
status: drafted
disposition: implement
claims:
  - spec.md#16.1
requires: []
workspaces:
  - packages/compiler
size: S
---

# A compiled element binds its definition's root-level event handlers on the host, as the interpreter does

## Context

`specs/spec.md` §16.1, line 1633 (the section was unmarked before the census):

> **Status: Partial.** The interpreter binds root-level `on*` handlers on the host (`bindDefinitionHandlers` in `packages/runtime/src/runtime.ts`). The compiled element module every site build ships (`compileElement`) does not: its `template()` renders only the definition's children and no host listener is emitted, so a root `onclick`, `onkeydown` or `ontoggle` is dropped in production.

**What exists** (re-verified against the tree)

- Interpreter: `bindDefinitionHandlers(host, def, state)` in `packages/runtime/src/runtime.ts` calls `bindHandler` for every root key that starts with `on` and is not in `RESERVED_KEYS` (which holds `observedAttributes`). `bindHandler` attaches the four spellings of spec.md §4.3 with `addEventListener(type, fn)`, `type = key.slice(2)`, and ignores any other value. It runs once per instance: the element class's `connectedCallback` returns early on `_jxInitialized`, so a moved element keeps one listener and nothing removes it. Tests: `packages/runtime/tests/host-handlers.test.ts`.
- Element target, `packages/compiler/src/targets/compile-element.ts`: nothing reads the root's own `on*` keys. `emitElementModule`'s `template()` renders `doc.children` (or root `textContent`), and neither the constructor nor `connectedCallback` adds a listener to `this`. Child keys are lowered in `emitLitNode` (four spellings, prefixed `s.$map = $map;` inside a map). `emitMappedArray` has a second loop for the map root that lowers only `$ref` and `$expression`, so an inline Function or structured body on a map root is dropped too, although `docs/framework/concepts/lists.md` says handlers work there.
- Every compiled path goes through `emitElementModule` (`compileElement`, called by `site-build.ts` and `compileElementPage`). The rest of the build is already right: `_isStaticNode` (`isComponentFullyStatic` in `packages/compiler/src/shared.ts`) counts any root `on*` key as runtime behaviour, so the module ships, and `renderComponentInstance` stamps the instance's own keys, never the definition's root, so no handler leaks into prerendered HTML.
- Exposure: no component under `sites/` or `packages/starters` has a root handler today. The 24 kit definitions in `packages/ui/components` bind 67, all `$ref`s, and run through the interpreter, so the first kit component a site compiles meets the drop.

**Corrections to the census reading**

1. Emitting the listener is not enough. `collectCallableRefs` walks only `doc.children` and `doc.state`, so a bodyless `$src` entry that only a root handler references is classified as a computed. Compiling `packages/ui/components/jx-menu.json` today emits `this.state.onKeydown = computed(() => onKeydown(this.state));`, and a `$lazy` one fails the build with the computed-use error.
2. Nor is fixing the walker. A bodyless `$src` entry that declares no `parameters` or `arguments` is emitted as `this.state.key = (state) => key(state);`, so the event every call site passes (`s.fn(s, e)`) never reaches the imported function, which spec.md §4.3 says is called as `(state, event)` and which the interpreter assigns unwrapped (`resolveFunction` returns `fn`). This drops the event for child bindings today; for root handlers it is most of the case: 58 of the kit's 67 are `$ref`s to such entries, each taking `(state, event)` (`onMenuKeydown(_state, event)` in `packages/ui/src/behaviors/menu.ts`).

Not in scope: the compiled element also ignores a definition's root `attributes` (the interpreter applies them with `applyAttributes(this, def.attributes, state)`; `jx-button` writes `data-variant` that way). No spec section states that rule, so it is not an open item here.

## Outcome

- `spec.md` §16.1 → marker removed (unmarked, as before the census); the section states the once-per-instance binding both tiers share.
- No status change: `compiler.md` §4.3 gains a closing paragraph on host listeners, and the element target's map root binds all four handler spellings.

## Decisions

- **Decided:** the listeners are attached at the end of the emitted constructor, inside a block `{ const s = this.state; … }`, because the constructor runs exactly once per instance (the once-only the interpreter gets from `_jxInitialized`), every state entry exists by then, a custom element constructor may add listeners (it must not add attributes or children), and the block keeps `s` out of the constructor's scope where a `$src` import could share the name. It also leaves `connectedCallback` and `disconnectedCallback`, which `plan:_shared/compiled-element-lifecycle` and `plan:_shared/compiled-prop-bridge` rewrite, untouched. Two differences from the interpreter are accepted as unspecified: the listener exists before the first connection, and on one element it precedes a listener the usage site binds (the interpreter's follows it); order on one target is visible only as side-effect order, since no statement stops immediate propagation (§20.2).
- **Decided:** one lowering. `handlerSource(val, mapCtx)` is extracted from `emitLitNode` and serves child bindings, the map root and host listeners, because §16.1 says a root handler attaches "exactly as they would to an element inside a document", and a separate loop is how the map root came to drop two spellings. Child output stays byte-identical.
- **Decided:** a root key binds when it passes the interpreter's test (`key.startsWith("on") && !RESERVED_KEYS.has(key)`) and `handlerSource` accepts its value; anything else binds nothing and is never written onto the instance. The event type is the element target's `key.slice(2).toLowerCase()`, emitted through `JSON.stringify` because a key is author data. The interpreter keeps the key's case; that difference spans every `on*` key in every compiled target, no shipped root key is mixed-case (the kit's custom types are `jx-ready`, `jx-toast-pause` and the like), and it is not §16.1's item.
- **Decided:** `collectCallableRefs` counts the root's handler keys in this plan rather than behind `plan:spec/callable-classifier`, because without it the new listener calls a computed and a `$lazy` handler fails the build, and the fix is the walker's existing record loop applied to the root. That plan's stub names this exact fix as the alternative, and lifts the walker with it included.
- **Open:** does this plan also emit a bodyless `$src` entry that declares no parameters as the imported function itself (`this.state.key = key;`), so it receives every argument its call site passes (correction 2)? Recommendation: yes, because it is what spec.md §4.3 already states and what the interpreter does, and without it §16.1 would close with a listener that calls 58 of the kit's 67 root handlers without their event. It changes child bindings too (an imported handler starts receiving the event it was always documented to get), and it makes `plan:_shared/compiled-element-lifecycle`'s `(state, host) => onMount(state, host)` special case unnecessary: passing the host at the call site is enough. Declared parameters keep today's by-name mapping.
- **Decided:** `requires: []`. `plan:compiler/element-binding-table` elides host listeners from its §4.2 output, its input has no root handler, and its §4.3 rewrite ends before the paragraph this plan appends. `plan:_shared/compiled-element-lifecycle` and `plan:_shared/compiled-prop-bridge` edit other methods; the one shared line is the `$src` wrapper branch under the Open, which whichever lands second adapts. `plan:spec/compiled-statement-await` and `plan:spec/compiled-element-parameterised-bodies` change the lowering host listeners inherit through `handlerSource`, in either order.

## Implementation

All in `packages/compiler/src/targets/compile-element.ts`; no other source file changes.

1. **`handlerSource(val: unknown, mapCtx: string): string | null`**, new, beside `inlineHandlerBody`. The three branches of `emitLitNode`'s `on*` loop, moved verbatim: a value with a truthy `$ref` gives `(e) => ${refToExpr(ref)}(s, e)`, or `(e) => { ${mapCtx}${refToExpr(ref)}(s, e); }` when `mapCtx` is set; a value carrying `$expression` gives `(e) => { ${mapCtx}${compileExpression(node, { eventParam: "e", statePrefix: "s" })}; }`; `isFunctionDef(val)` gives `(e) => { ${mapCtx}${inlineHandlerBody(val)} }`; anything else gives `null`.
2. **`emitLitNode`**: the loop keeps its key filter and becomes `const fn = handlerSource(val, mapCtx); if (fn !== null) parts.push(`@${eventName}="\${${fn}}"`);`.
3. **`emitMappedArray`**: its map-root `on*` loop calls `handlerSource(val, "s.$map = $map; ")`, which emits the same text for `$ref` and `$expression` as today and adds the inline Function and structured-body spellings.
4. **`hostHandlers(doc: JxDocument): { type: string; source: string }[]`**, new: the root entries with `key.startsWith("on") && !RESERVED_KEYS.has(key)` (`RESERVED_KEYS` is already imported from `@jxsuite/runtime`) and a non-null `handlerSource(val, "")`, in document order, `type = key.slice(2).toLowerCase()`. JSDoc cites spec.md §16.1 and names `bindDefinitionHandlers` as the interpreter's counterpart.
5. **`emitElementModule`**: immediately before `lines.push("  }", "")` that closes the constructor (after the computed entries), when `hostHandlers(doc)` is non-empty, push `""`, `"    {"`, `"      const s = this.state;"`, one `      this.addEventListener(${JSON.stringify(type)}, ${source});` per entry, and `"    }"`, under a comment citing spec.md §16.1 and §4.3 (no options, lifetime the element's, never removed). A definition without root handlers compiles to the same module as today.
6. **`collectCallableRefs`**: after `visit(doc.state)`, `for (const [key, val] of Object.entries(doc)) { if (key.startsWith("on") && !RESERVED_KEYS.has(key)) { if (isRef(val)) { addStateRef(val.$ref); } visit(val); } }`. Its JSDoc's "bound to an `on*` event" gains "on a child or on the root (spec.md §16.1)".
7. **If the Open is accepted**, the function-entry branch of `emitElementModule`: when `def.$src` is set and neither `def.parameters` nor `def.arguments` is declared, emit `${refAccessor("this.state", escapeToken(key))} = ${key};` (the local binding `srcImportBinding` or the `$lazy` loader already names `key`). The existing comment block above that branch gains one sentence: an undeclared `$src` function is the imported function itself, as in the interpreter, so it receives `(state, event)` from an event and the host from `onMount`. Declared names keep the `args[0] === "state"` and by-name paths unchanged.

**Integration contract.** Once this lands: every `on*` value the element target lowers, on a child, a map root or the host, goes through `handlerSource`, so a plan that changes handler lowering (async arrows, positional callables) changes one function and gets all three. Host listeners are the last statement block of the constructor, emitted only when a root handler exists; `connectedCallback` and `disconnectedCallback` are unchanged, and the class gains no member, so `ELEMENT_MEMBERS` in `plan:_shared/compiled-prop-bridge` needs no entry. `collectCallableRefs` treats a root handler's `$ref`, `call` targets and `state.x(` calls as callable uses, which `plan:spec/callable-classifier` inherits when it lifts the walker. Under the Open, a bodyless `$src` entry with no declared parameters is emitted as the imported binding, so `plan:_shared/compiled-element-lifecycle` passes the host at the `onMount` call site and needs no wrapper case, and its updated "a bodyless $src lifecycle hook stays callable" expects `this.state.onMount = onMount;`. `spec.md` §16.1 carries no marker and states the once-per-instance rule.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`. No new source file. `compile-element.ts` must stay at or above `coverageThreshold = { lines = 0.982, functions = 0.98 }` (`packages/compiler/bunfig.toml`); both new functions are reached by the cases below, and the threshold is ratcheted if the workspace's worst file rises.

`packages/compiler/tests/compile-element.test.ts`, new `describe("compileElement — root-level handlers on the host (spec.md §16.1)")`:

- "each root handler spelling becomes one host listener in the constructor": a `test-host-spellings` definition with root `onclick: { $ref: "#/state/pick" }`, `onkeydown: { $prototype: "Function", body: "state.n++" }`, `"onjx-ready": { $prototype: "Function", body: [{ operator: "+=", target: { $ref: "#/state/n" }, value: 1 }] }` and `ontoggle: { $expression: { operator: "+=", target: { $ref: "#/state/n" }, value: 1 } }`. The module contains `const s = this.state;`, `this.addEventListener("click", (e) => s.pick(s, e));`, `this.addEventListener("keydown", (e) => { s.n++ });`, `this.addEventListener("jx-ready", (e) => {` and `this.addEventListener("toggle", (e) => {`, each at an index between `constructor() {` and `template() {`.
- "a definition with no root handler emits no host listener": compiler.md §4.2's `user-card` input; the module has no `addEventListener`.
- "observedAttributes and a root on* value that is no handler bind nothing": `observedAttributes: ["label"]` and root `onlabel: "text"`; no `addEventListener`, no `@label`.
- "a map root binds an inline Function handler": `map: { tagName: "li", onclick: { $prototype: "Function", body: "state.n++" } }` with no descendant handler; the module contains `@click="${(e) => { s.$map = $map; s.n++ }}"`.

Same file, in `describe("compileElement — bodyless $src classification")`:

- "a bodyless $src bound only by a root handler stays callable": `onclick: { $ref: "#/state/rows" }`at the root,`children: []`; the module does not contain `computed(() => rows(`.
- "a $lazy $src bound only by a root handler compiles": the same with `$lazy: true`; `compileElement` resolves and the module contains `const rows = (...args) =>`.
- Under the Open: the existing expectations of `this.state.rows = (state) => rows(state);` (three `toContain`, one `not.toContain`) and `this.state.onMount = (state) => onMount(state);` become `this.state.rows = rows;` and `this.state.onMount = onMount;`, the `$src`-plus-`body` case in "compileElement — $src imports" becomes `this.state.handler = handler`, and a new "a $src entry declaring parameters keeps its by-name mapping" asserts `parameters: ["state", "event"]` still emits `(state, event) => rows(state, event)`.

`packages/compiler/tests/compile-element-render.test.ts`, new `describe("compiled element — root-level handlers (spec.md §16.1)")`, mirroring `host-handlers.test.ts`. A `ch-row` definition: `state: { value: "copy", disabled: false, onKeydown: { $prototype: "Function", parameters: ["event"], body: "globalThis.__chSeen.push({ current: event.currentTarget, value: state.value })" }, onClick: { $prototype: "Function", body: [{ stopPropagation: true }, { if: { operator: "!", target: { $ref: "#/state/disabled" } }, then: [{ dispatchEvent: "select", detail: { $ref: "#/state/value" }, bubbles: true }] }] } }`, root `onclick` and `onkeydown` `$ref`s, one `span` child. Compiled, written under `TMP` and imported as the `$props` block does, then placed inside an outer `div`.

- "a click on a rendered child reaches the host handler and stops there": the outer `div` records `select` details `["copy"]` and zero clicks.
- "the handler reads the state at event time": `el.state.disabled = true` (not a property write, which is `plan:_shared/compiled-prop-bridge`'s), `el.click()`; no second `select`.
- "the host is event.currentTarget": a bubbling `keydown` dispatched at the element records `current === el` and `value === "copy"`.
- "every spelling listens, once per instance": a `ch-spellings` definition with root `onping` (string body `state.n++`), `onpong` (structured `+=`) and `onpang` (`$expression` `+=`) and `textContent: "${state.n}"`; dispatching the three events gives `el.state.n === 3`; after `el.remove()` and re-append, one `ping` gives `4`.
- Under the Open, "a bodyless $src root handler receives the state and the event": `lib.js` in `TMP` gains `export function onPing(state, event) { state.last = event.type; }`; a `ch-src` definition binds root `onping: { $ref: "#/state/onPing" }`to`{ $prototype: "Function", $src: "./lib.js" }`; dispatching `ping`sets`el.state.last`to`"ping"`.

The temp modules stay under `tests/`, which `coveragePathIgnorePatterns` excludes.

## Specs & docs

- `spec.md` §16.1: delete the marker line and the blank line after it. In the paragraph "A definition's root-level event handlers listen on the host element.", after "…with the definition's own scope as `state` and the host as `event.currentTarget`.", insert: "Each is attached once per instance, with `addEventListener` and no options (§4.3), and lives as long as the element: moving the element neither adds a second listener nor removes the first."
- `compiler.md` §4.3: append after its last paragraph ("…must produce source that parses for every ref the schema admits."): "**A definition's root-level handlers listen on the host** (spec.md §16.1). They have no node in the template, so the constructor attaches each to the element with `this.addEventListener(type, handler)`, where `handler` is the arrow a child's binding would carry, from the same lowering. A listener is attached once per instance and never removed, and a definition with no root handler emits none. A bodyless `$src` entry that a root handler references is a callable, as one a child binds is (spec.md §5.3 4d)." Under the Open, add: "One that declares no parameters is the imported function itself, so it is called with `(state, event)` (spec.md §4.3)." The §4.3 marker is `plan:compiler/element-binding-table`'s and is not touched.
- Fragments: `bun run spec:change spec.md minor -m "A compiled custom element binds its definition's root-level event handlers on the host, once per instance, as the interpreter does"` and `bun run spec:change compiler.md minor -m "The element target attaches a definition's root-level handlers to the host from the constructor, lowered as a child's binding is"` (append "and an undeclared sidecar handler receives the event" to the second under the Open).
- Docs, from `bun run docs:sync` (`compile-element.ts` is in the `code:` of three pages; no page's `spec:` cites `spec.md#16.1`):
  - `docs/framework/concepts/components.md`: add `spec.md#16.1` to its `spec:` list. Its "Handlers written at the root listen on the element itself" paragraph already states the behaviour with no tier caveat, and becomes true of built sites; no text change.
  - `docs/framework/concepts/functions.md`: no change. "Bind it to an event … and it stays a function" and "event bindings pass the DOM event second, as `(state, event)`" become true of a root binding and, under the Open, of an undeclared sidecar.
  - `docs/framework/concepts/lists.md`: no change. "event handlers all work there" becomes true of a map root in the element target.
- No graduation: `spec.md` keeps other open items (§16.2, §16.4, §16.5 and more).

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec spec` no longer lists §16.1.
- Observable: `bun -e 'import { compileElement } from "./packages/compiler/src/targets/compile-element.ts"; const { files } = await compileElement("packages/ui/components/jx-menu.json"); console.log(files.at(-1).content)'` prints a constructor ending in a block with `this.addEventListener("keydown", (e) => s.onKeydown(s, e));` and three more listeners, and no `computed(() => onKeydown(`; under the Open it also prints `this.state.onKeydown = onKeydown;`.
