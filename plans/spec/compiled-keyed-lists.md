---
status: drafted
disposition: implement
claims:
  - spec.md#10.3
  - spec.md#10.4
requires: []
workspaces:
  - packages/runtime
  - packages/schema
  - packages/compiler
  - packages/starters
  - packages/studio
  - packages/ui
  - examples
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: L
---

# Built lists filter, sort and keep keyed rows as the interpreter does, and a `$map` pointer resolves in either spelling in every tier

## Context

Both sections are open for the same emitters, so one plan owns both. Verified at `84735a9f`.

`specs/spec.md` §10.3, line 1126:

> **Status: Partial.** The interpreter filters and sorts (`renderMappedArrayInto` in `packages/runtime/src/runtime.ts`). No compiled path reads either key: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts`, both mapped-array emitters in `compile-client.ts` and the site build's build-time `expandMappedArrayStatic` (`packages/compiler/src/site/site-build.ts`) map `items` as given, so a built list shows every item in source order.

`specs/spec.md` §10.4, line 1142:

> **Status: Partial.** The interpreter reconciles by key as described below. The compiled targets do not: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts` and the client target lower a mapped array to an unkeyed `.map()` with no lit `repeat()`, so compiled rows are rebuilt rather than moved. And a `key` spelled `#/$map/item/…` is refused by the schema (`ArrayNamespace.key`) and falls back to the index at runtime (`mappedRowKey`).

Both sections keep a trailing `> **Status: Implemented.**` marker describing the interpreter.

**Confirmed from the stub.** `renderMappedArrayInto` (`runtime.ts:2462`) resolves `filter` and `sort`, applies each only when it is a function (`items.filter(fn)`, then `toSorted(fn)`), computes keys through `mappedRowKey` (`:2635`) with a duplicate pass, and reconciles in a microtask-coalesced effect. `emitMappedArray` (`compile-element.ts:1240`) emits `${items.map((item, index) => …)}` and lowers an inline `items` array to the undeclared `ITEMS`. The client target's two emitters (the whole-children binding in `buildClientNode`, `compile-client.ts:549`, and `emitArrayHole`, `:819`) emit `(items ?? []).map(…)`. `expandMappedArrayStatic` (`site-build.ts:1992`) reads `items` and `map` only. The schema's key pattern is `^\$map/item(/.+)?$` (`packages/schema/defs/children-value.schema.ts:18`).

**Found while detailing.**

1. **`#/$map/…` resolves in one place.** Only the interpreter's `resolveRef` (`runtime.ts:3536`) reads it, pinned by `runtime-seam.test.ts` R4. The schema's `MapRef` (`^\$map/(item|index)(/.*)?$`, `ref-object.schema.ts:39`) refuses it in every `$ref` position, not just `key`. `resolveExprRef`, `resolveWritableRef`, `calleeOwner` and `compileRef` (`packages/runtime/src/expression.ts`) and `resolveRefValue` (`packages/compiler/src/shared.ts:738`) read it as an unknown path (null); `refToExpr` (`compile-element.ts:1375`) and `mapRefToClientExpr` (`compile-client.ts:1072`) emit `s["#"].$map…`, a `TypeError` at render on a document the interpreter renders.
2. **The site build bakes a list a handler changes.** `expandMappedArrayStatic` resolves `items` with `resolveRefValue` and never consults the runtime-only marks `buildInitialScope` keeps (`RUNTIME_ONLY_KEYS`, `shared.ts:238`). Probe: a page whose button runs `state.todos.push(…)` builds to `<ul><li>a</li><li>b</li></ul>` plus an `app.js` holding `state.todos` and the handler but no list binding, so the click changes state and nothing on screen. The same gate is what `filter` and `sort` need, and a list nested in an expanded row that is left unexpanded loses the `$map` it reads.
3. **The client target reads refs by binding key.** Items go through `refToBindingKey`, so `#/state/user/posts` reads `state.user_posts` and a nested list's `$map/item/kids` reads `state.$map_item_kids`; a row's `$ref` `textContent` (`emitLitMapTemplate`, line 770) reads `state.$map_item`, so spec.md §10.1's own example renders empty rows on a dynamic page. The audit verified spec.md §10.1 and §10.2 against `emitArrayHole` without executing it.
4. **lit subpaths do not reach compiled modules.** `repeat` lives in `lit-html/directives/repeat.js`. The four page-template tiers write an import map with exact keys only, the site build hands them two URLs (`site-build.ts:1470`–`1473`), and `injectComponentScripts` declines to add its own map when one exists, so a dynamic page has no `"lit-html/"` prefix key. `writeRuntimeSubpaths` (`client-runtime.ts:269`) scans only `dist/assets/`, while component modules land in `dist/components/` and page modules beside their HTML. A third-party lit directive on a dynamic page fails the same way today.
5. **Compiled renders are synchronous.** Both targets render through `effect(() => render(…))`. `@vue/reactivity` 3.5.43 batches `push`, `pop`, `shift`, `unshift` and `splice` (`noTracking`) but not `reverse` or `sort`, which trigger once per index: a synchronous keyed render mid-`reverse()` sees a transient duplicate and tears down the row whose key exists to keep it.
6. **The calling convention is the interpreter's, and only one form is portable.** The interpreter passes the resolved value straight to `Array.prototype.filter`/`toSorted`. A named formula (spec.md §19.4c) maps positional arguments onto its `parameters` in every tier (`buildScope` pass 2.5, `emitFormulaFn`, `buildInitialScope`). A string-body Function gets the item in its `state` slot (`resolveParamNames` prepends `state`), and the tiers disagree about `$src` callables, which is spec.md §5.3 4d's gap (`plan:spec/function-entry-tier-parity`), not this one. No document in the repository declares `filter` or `sort`; the six that declare `key` (`packages/studio/src/surfaces/*.json`, `packages/ui/stylebook/*.json`) all run through the interpreter.

## Outcome

- spec.md §10.3 → Implemented: the interpreter, both compiled targets and the site build apply `filter` then `sort` by one stated convention, and the build expands at build time only a list whose sources are settled there.
- spec.md §10.4 → Implemented: a compiled keyed list reconciles through lit's `repeat()` with the interpreter's key rule, duplicate handling and microtask coalescing; `#/$map/…` resolves in every tier and validates in every position.
- spec.md stays Partial (other plans own its remaining items); nothing graduates.

## Decisions

- **Open:** does `#/$map/…` resolve everywhere, or only as a `key` (the marker's half)? Recommendation: everywhere, through one `canonicalMapRef` normaliser at the entry of every resolver and a widened `MapRef`, because spec.md §10.4's second paragraph already promises it of every `$map` pointer, the interpreter accepts it today, and the compiled targets crash on it. The alternative narrows that paragraph to the key and keeps the crash. Studio keeps writing the bare form.
- **Open:** does a compiled keyed list coalesce its reconciliation into a microtask, as spec.md §10.4's last paragraph says? Recommendation: yes, through a small lit `AsyncDirective` (`__jxKeyed`) that owns the list's own effect, because an in-place `sort()` or `reverse()` otherwise costs the moved rows their nodes (Context 5), which is the focus loss keys exist to prevent. The directive computes the list and keys in its effect and hands `repeat()` a snapshot the host render reads, so row bindings stay in the host's synchronous render and no compiled timing an existing test pins changes. The alternative is plain `repeat()` in the template and that paragraph scoped to the interpreter, advising authors to replace the array (`state.rows = state.rows.toSorted(…)`).
- **Decided:** spec.md §10.3 states the interpreter's convention (predicate `(item, index, array)`, comparator `(a, b)`, a non-function ignored) and names a named formula as the form every tier calls alike, because it is what ships and the compiled targets now match it; making string-body Functions receive the item differently is spec.md §5.3 4d's to decide.
- **Decided:** a list declaring none of `filter`, `sort`, `key` compiles exactly as today; an unkeyed list with `filter` or `sort` renders `__jxShape(…).map(…)` inside the host render; only a keyed list uses the directive. Because lit's positional array rendering already is index reconciliation, an unkeyed row has no identity to lose to a synchronous render, and every existing compiled list keeps its bytes and its payload.
- **Decided:** the rules are inlined into generated modules as emitted source (`listHelperSource()` and `keyedListDirectiveSource()` in `shared.ts`, beside `attrHelperSource()`), and the key rule is drift-tested against a runtime export (`mappedRowKeys`), per the audit's spec-wide decision. The key pointer is split at compile time (`keyPath`), so the emitted helper walks plain member names; unescaping stays in `refSegments`.
- **Decided:** a compiled list warns once per list instance (a flag on the directive instance), as the interpreter's `warnOnce` does, with the interpreter's `Jx $map:` messages.
- **Decided:** page-template tiers take the build's whole import map (`runtimeImports`), the CDN fallback gains its prefix key, and the subpath scan covers every emitted `.js`, because a compiled module that imports a lit subpath must load on a dynamic page; this also fixes third-party directives there (Context 4).
- **Decided:** the site build expands a list at build time only when `items`, `filter`, `sort` and every list nested in its `map` read no runtime-only state; otherwise the list is left for the client target. Callables join `buildInitialScope`'s runtime-only fixpoint so a filter that reads a handler-written key is marked. The cost is the prerendered rows of such a list, the trade compiler.md §9.2 already makes for a `$switch`; the gain is a list that updates (Context 2).
- **Decided:** the client target reads `items`, `filter`, `sort` and a row's `$ref` `textContent` through `mapRefToClientExpr`, so nested paths and nested lists work; a flat `#/state/x` emits the same `state.x` it does today.

## Implementation

Four slices, landed in order; CKL1.4 needs the other three.

**CKL1.1: both `$map` spellings, everywhere.**

1. `packages/runtime/src/pointer.ts`: `export function canonicalMapRef(ref: string): string`, returning `ref.slice(2)` when `ref` starts with `#/$map/` and `ref` otherwise.
2. `packages/runtime/src/runtime.ts`: `resolveRef` normalises at entry and keeps one `$map/` branch (the dual-prefix branch goes); `mappedRowKey` normalises `pointer` before its checks.
3. `packages/runtime/src/expression.ts`: normalise at the entry of `resolveExprRef`, `resolveWritableRef`, `calleeOwner` and `compileRef`.
4. `packages/compiler`: normalise at the entry of `refToExpr` and `mapRefToExpr` (`compile-element.ts`), `mapRefToClientExpr` (`compile-client.ts`) and `resolveRefValue` (`shared.ts`).
5. `packages/schema/defs/ref-object.schema.ts`: `mapRefSchema.pattern` becomes `^(#/)?\\$map/(item|index)(/.*)?$`, with `#/$map/item/text` added to `examples`. `children-value.schema.ts`: the key pattern becomes `^(#/)?\\$map/item(/.+)?$` and its description says either spelling. `packages/schema/types.ts`: the `key` JSDoc likewise. Then `bun run schema:sync`, which rewrites the 29 committed schemas that carry either pattern.

**CKL1.2: `filter` and `sort` in every compiled path.**

1. `packages/compiler/src/shared.ts`:
   - `export function listHelperSource(): string`, emitting `function __jxShape(items, filter, sort)`: `[]` unless `Array.isArray(items)`; `items.filter(filter)` when `filter` is a function; then `.toSorted(sort)` when `sort` is a function.
   - `export function mappedArrayFeatures(doc): { shaped: boolean; keyed: boolean }`, walking `children` (arrays and the legacy whole-children form), every `map` body and every `$switch` `cases`; `shaped` is any array with a `$ref` `filter` or `sort`, `keyed` any with a `key`.
   - `buildInitialScope`: collect callable sources (a named formula's `JSON.stringify(def.$expression)`, a callable string body) and include them in the runtime-only fixpoint, matched by `readsRuntimeOnlyState` and by a new private `readsRuntimeOnlyRef` that finds `#/state/<key>` refs. Export `isRuntimeOnlyRef(ref, scope): boolean` (a `#/state/` ref whose first segment is marked).
2. `compile-element.ts` `emitMappedArray`: items are `refToExpr(ref)` or `JSON.stringify(arrayDef.items ?? [])` (no `ITEMS`); when `filter` or `sort` is a `$ref`, the list is `__jxShape(<items>, <refToExpr(filter) or undefined>, <refToExpr(sort) or undefined>)`. The callback is unchanged. `emitElementModule` pushes `listHelperSource()` after `attrHelperSource()` when `mappedArrayFeatures(doc).shaped`.
3. `compile-client.ts`: one `emitClientList(arrayDef: JxMappedArray): string` returning the list expression, called by the whole-children binding (`() => <list>`) and by `emitArrayHole` (`${<list>}`). Items, filter and sort go through `mapRefToClientExpr`, a literal array through `JSON.stringify`; a shaped list sets `counter.needsShape`, and `emitClientModule` then pushes `listHelperSource()`. `emitLitMapTemplate`'s `$ref` `textContent` uses `mapRefToClientExpr`.
4. `site-build.ts` `expandMappedArrayStatic`: return `null` (leave the list) when a private `listSettled(arrayDef, scope)` fails, meaning a `$ref` in `items`, `filter` or `sort` satisfies `isRuntimeOnlyRef`, or any mapped array in `map` (through `children` and `cases`, recursively) fails the same test. Otherwise resolve `filter` and `sort` with `resolveRefValue` and apply them as `__jxShape` does before mapping.

**CKL1.3: lit subpaths reach every compiled module.**

1. `shared.ts`: move `renderImportMap` here (re-exported from `client-runtime.ts` for its callers) and add `pageImportMap({ runtimeImports, reactivitySrc, litHtmlSrc })`: `renderImportMap(runtimeImports)` when given; else the two exact keys, plus `"lit-html/": "<DEFAULT_LIT_HTML_SRC>/"` when `litHtmlSrc` is that default.
2. The four page-template tiers render their map with it and accept `runtimeImports?`: `compileElementPage` (`compile-element.ts`), `compileClient`, `compileStaticPage` (islands map, `compile-static.ts`) and `compile()`'s custom-element route (`compiler.ts`), which forwards the option to all three.
3. `site-build.ts`: the page compile passes `runtimeImports` in place of the two `*Src` spreads (lines 1470–1473).
4. `client-runtime.ts`: `resolveClientRuntime`'s fallback branch also writes `imports["<specifier>/"] = "<fallback>/"`. `writeRuntimeSubpaths` scans every `.js` under `outDir` rather than `outDir/assets`, keeping its pass-to-closure loop.

**CKL1.4: keyed reconciliation in both compiled targets.**

1. `runtime.ts`: `export function mappedRowKeys(pointer: string | null, list: unknown[], warnOnce: (message: string) => void): unknown[]`, the key loop and duplicate pass moved out of `renderMappedArrayInto`'s `update` (which now calls it); a duplicate becomes `{ duplicate: index }` as today.
2. `shared.ts`:
   - `export function keyPath(pointer: string): string[] | null`: after `canonicalMapRef`, `[]` for `$map/item`, `refSegments(rest)` for `$map/item/<rest>`, `null` otherwise.
   - `listHelperSource()` gains `function __jxRowKeys(list, path, pointer, warn)`, the port of `mappedRowKeys` over a pre-split path: `path === null` warns "is not a $map/item pointer" and keys by index; `[]` keys by the item; otherwise walks `v = v?.[seg]`, and an empty result warns and keys by index; duplicates become `{ duplicate: index }` with the interpreter's message.
   - `export const KEYED_LIST_IMPORTS`: `import { AsyncDirective, directive } from 'lit-html/async-directive.js';` and `import { repeat } from 'lit-html/directives/repeat.js';`.
   - `export function keyedListDirectiveSource(): string`, emitting `class __JxKeyedList extends AsyncDirective` and `const __jxKeyed = directive(__JxKeyedList);`. Its state is `snap = shallowRef({ list: [], keys: [] })`, the latest arguments, a runner and a `warned` flag. `update(part, [items, filter, sort, path, pointer, row])` stores the arguments; on the first call it starts the list effect, whose first run is synchronous; on a later call it queues a run when `items`, `filter` or `sort` changed identity; it returns `repeat(snap.value.list, (_, i) => snap.value.keys[i], row)`. The list effect computes `__jxShape` then `__jxRowKeys` from the stored arguments and writes `snap.value`; its scheduler queues one microtask, as `renderMappedArrayInto`'s does. `disconnected()` stops the runner and `reconnected()` restarts it; `render()` is unused.
3. `compile-element.ts`: a keyed `emitMappedArray` emits `${__jxKeyed(<items>, <filter>, <sort>, <JSON keyPath>, <JSON pointer>, (item, index) => …)}` with the existing callback. When `mappedArrayFeatures(doc).keyed`, `emitElementModule` adds `KEYED_LIST_IMPORTS`, `shallowRef` to the `@vue/reactivity` import and `keyedListDirectiveSource()`, and pushes `listHelperSource()` once for `shaped || keyed`.
4. `compile-client.ts`: `emitClientList`'s keyed branch emits the same call; `counter.needsKeyed` adds the imports, `stop` and `shallowRef` to the reactivity import and `keyedListDirectiveSource()`, and `listHelperSource()` is pushed once for `needsShape || needsKeyed`.

**Integration contract.** Once this lands: `canonicalMapRef` (`@jxsuite/runtime/pointer`) is the one normaliser any new `$ref` reader calls first; `mappedRowKeys` (`@jxsuite/runtime`) is the key rule; `listHelperSource`, `keyedListDirectiveSource`, `KEYED_LIST_IMPORTS`, `keyPath`, `mappedArrayFeatures`, `isRuntimeOnlyRef`, `renderImportMap` and `pageImportMap` are `shared.ts` exports (named for `plan:compiler/shared-utilities-signatures`); the client target has one list emitter, `emitClientList`, which a plan adding constructs to a row template (`plan:spec/compiled-external-switch-cases`, `plan:spec/tag-expression-completion`) leaves alone; a compiled module may import a `lit-html/` subpath and it resolves on every page a build writes; and `expandMappedArrayStatic` leaves a list for the client when any source it reads is runtime-only.

## Tests

Each workspace runs `bun test --isolate --coverage` from its directory. Thresholds (`bunfig.toml`): `packages/runtime` lines 0.963, functions 0.98; `packages/schema` 0.99/0.99; `packages/compiler` 0.982/0.98. Ratchet any workspace whose worst file rises. No new source file is added; the new files below are tests.

**CKL1.1**

- `packages/runtime/tests/pointer.test.ts`: "canonicalMapRef strips the #/ from a $map pointer and leaves every other ref as it is".
- `packages/runtime/tests/keyed-lists.test.ts`, "keyed $map — identity": "a key spelled #/$map/item/id keys by that field" (nodes kept across a reverse, no warning).
- `packages/runtime/tests/expression.test.ts`: "#/$map/item/x resolves as an operand, a call owner and a write target"; "compileExpression lowers #/$map/item/x as it lowers $map/item/x".
- `packages/compiler/tests/ref-build-time-agreement.test.ts`: rows for `$map/item/name` and `#/$map/item/name` against a `$map` scope.
- `packages/compiler/tests/compile-element.test.ts` and `compile-client.test.ts`: "a #/$map pointer in a row binding reads the loop variable" (no `["#"]` in the module).
- `packages/schema/tests/map-pointer-spellings.test.ts` (new): "a key accepts $map/item, $map/item/id and #/$map/item/id"; "a key refuses $map/index and #/$map/index"; "a $ref binding accepts #/$map/item/x and #/$map/index". `style-value-ref.test.ts`'s spelling list gains `#/$map/item/face`.

**CKL1.2**

- `compile-element.test.ts`: "an inline items array is emitted as a literal"; "filter and sort wrap items in __jxShape"; "a list without filter, sort or key compiles to a plain .map".
- `compile-client.test.ts`: "filter and sort shape both client list emitters"; "items at a nested path read state.user.posts"; "a nested list reads its items off the row"; "a row's $ref textContent reads the loop variable".
- `packages/compiler/tests/list-render.test.ts` (new; happy-dom `Window` globals installed before the module import, as `compile-element-render.test.ts` does; modules written to `__test-list-render__` and imported one at a time): a component and a dynamic page, each with a named-formula filter (`parameters: ["item"]`, `===` on `$args/item/on`) and comparator (`-` on `$args/a/n`, `$args/b/n`). Cases: "renders only the rows the filter keeps, in comparator order"; "re-filters when a field the filter reads changes".
- `packages/compiler/tests/site-build.test.ts`: "applies filter and sort to a list expanded at build time"; "leaves a list over handler-written state for the client" (the Context 2 probe as a fixture: no `<li>` in the HTML, a list binding in the module); "leaves an outer list when a nested list reads runtime-only state". `shared.test.ts`: "a named formula that reads a handler-written key is runtime-only".

**CKL1.3**

- `client-runtime.test.ts`, "resolveClientRuntime": "a CDN fallback carries a prefix key too"; "package subpaths": "writes a subpath imported by a module outside assets/".
- `compile-client.test.ts` and `compile-element.test.ts`: "the page import map is the runtimeImports passed in"; "the default CDN map carries the lit-html/ prefix".
- `site-build-import-map.test.ts`: "a dynamic page's own import map carries the prefix keys".

**CKL1.4**

- `packages/compiler/tests/list-helpers.test.ts` (new), the drift test: evaluate `listHelperSource()` and, for a table of pointers (`$map/item`, `$map/item/id`, `#/$map/item/id`, `$map/item/a~1b`, `$map/item/meta/slug`, `$map/index`, `#/state/x`) over lists with ids, missing ids, duplicate ids and duplicate primitives, assert `__jxRowKeys(list, keyPath(p), p, warn)` equals `mappedRowKeys(p, list, warn)` and both record the same messages.
- `keyed-lists.test.ts`: the existing cases stay green over the extracted `mappedRowKeys`.
- `list-render.test.ts`, keyed cases in both targets: "a keyed row keeps its node across an in-place reverse and a sort" (node identity after one microtask); "an insertion creates only the new row and a removal removes only its row"; "a row's own binding updates synchronously"; "a duplicate key warns once and renders every row"; "an empty key falls back to the index with one warning".
- `compile-element.test.ts` and `compile-client.test.ts`: "a keyed list renders through __jxKeyed with its key path"; "the repeat and async-directive imports appear only in a module with a keyed list".
- `no-eval.test.ts` gains a keyed list in its fixture, so the helper sources are held to the no-`Function` rule.

## Specs & docs

In place in `specs/spec.md`, one fragment per slice that edits it:

- **CKL1.1.** spec.md §10.4's marker loses its last sentence ("And a `key` spelled …"). Its second paragraph becomes: "Both spellings of a `$map` pointer are accepted wherever a `$map` pointer may appear, a `key` included, by the schema, the interpreter, the compiled targets and the build: the bare `$map/item/x`, which Studio writes, and `#/$map/item/x`, the form that matches how every other pointer in the schema is written. Only the bare one used to resolve, and the other returned null, so a mapped array over it rendered no rows and reported nothing." Fragment: `bun run spec:change spec.md minor -m 'A $map pointer spelled with a leading #/ resolves in every tier and validates in every position, a key included.'`
- **CKL1.2.** spec.md §10.1 gains after its example: "`items` may also be a literal array." spec.md §10.3: delete the leading Partial marker; after the example insert "`filter` and `sort` are each a `$ref` to a state entry. The list renders `items` filtered, then sorted, and never mutates the source. The resolved value is called as `Array.prototype.filter` calls a predicate, `(item, index, array)`, and as `Array.prototype.toSorted` calls a comparator, `(a, b)`; a `$ref` that does not resolve to a function is ignored. A named formula (§19.4c) receives those arguments on its declared `parameters`, which makes it the form every tier calls the same way. Whatever the predicate or comparator reads is a dependency of the list, and keys (§10.4) are read from the result. A build that expands a list over build-time data applies both there, and leaves the list for the client when `items`, `filter`, `sort` or a list nested in its `map` reads state that a handler writes or that exists only after hydration." The trailing marker becomes "> **Status: Implemented.** The interpreter (`renderMappedArrayInto`), the element target (`emitMappedArray`), the client target (`emitClientList`) and the site build's `expandMappedArrayStatic` render array members inline and apply `filter` then `sort`; the compiled targets inline the rule as `__jxShape` (`listHelperSource` in `packages/compiler/src/shared.ts`)." Fragment: `bun run spec:change spec.md minor -m 'Compiled targets and the build-time list expansion apply filter then sort as the interpreter does, by a stated calling convention.'` `specs/compiler.md` §4.7 gains a paragraph describing `__jxShape` and the plain `.map()` a list without the three keys keeps: `bun run spec:change compiler.md minor -m 'Mapped-array compilation applies filter and sort through an inlined helper.'`
- **CKL1.3.** `specs/site-architecture.md` §8.7: "the build writes the subpaths it finds referenced in the emitted assets" becomes "the build writes the subpaths it finds referenced in every module it emits: bundles, compiled component modules and page modules", and a sentence says every page-template tier writes the build's map, prefix keys included. `specs/compiler.md` §12: the CDN fallback carries a prefix key beside each exact one. Fragments: `bun run spec:change site-architecture.md patch -m 'Every page import map carries the prefix keys, and the subpath scan covers compiled component and page modules.'` and `bun run spec:change compiler.md patch -m 'The client-runtime CDN fallback carries a prefix key for package subpaths.'`
- **CKL1.4.** spec.md §10.4: delete the leading Partial marker. "Each row's bindings live in an effect scope of their own" becomes "In the interpreter, each row's bindings live …", followed by "A compiled target renders a row's bindings in its host's lit template, so a change to one row's data re-renders the template and lit commits only what changed; the row's node is patched, never rebuilt." "A host may observe a move" becomes "An interpreting host may observe a move". The coalescing paragraph's first sentence becomes "The first render of a list is synchronous; every later reconciliation of a keyed list, and in the interpreter of every list, is coalesced into one microtask." and gains "A compiled unkeyed list re-renders with its template, which ends in the same DOM, because position is its identity." The trailing marker becomes "> **Status: Implemented.** The interpreter's `renderMappedArrayInto()` reconciles by key in one forward pass, moving only the rows that are out of place. The compiled targets lower a keyed list to lit's `repeat()` behind `__jxKeyed`, a directive that computes keys by the interpreter's rule (`mappedRowKeys`, inlined as `__jxRowKeys`) and coalesces reconciliation into one microtask (`keyedListDirectiveSource` in `packages/compiler/src/shared.ts`); an unkeyed list lowers to lit's positional array rendering." Fragment: `bun run spec:change spec.md minor -m 'Compiled targets reconcile a keyed mapped array with lit repeat, the interpreter key rule and microtask coalescing.'` `specs/compiler.md` §4.7 gains the keyed-list paragraph (the directive, its imports, the drift-tested key rule): `bun run spec:change compiler.md minor -m 'Mapped-array compilation lowers a keyed list to lit repeat behind a coalescing directive.'`

If the second Open goes the other way, CKL1.4 drops the directive and `KEYED_LIST_IMPORTS`' `async-directive` line, and its spec.md §10.4 edit scopes the coalescing paragraph to the interpreter and names replacing the array as the way to reorder a built keyed list.

Docs (no em dashes in any of them):

- `docs/framework/concepts/lists.md` (its `spec:` cites `spec.md#10` and `#10.4`; its `code:` lists `compile-element.ts`): add `packages/compiler/src/targets/compile-client.ts` to `code:`. CKL1.1: "Keeping rows across changes" adds that the key may also be written `#/$map/item/id`. CKL1.2: "Filtering and sorting" says the filter is called with each item (then its index) and the sort with two items, and shows a named-formula pair (`isVisible` with `parameters: ["item"]`, `byRank` with `parameters: ["a", "b"]`) as the form that works the same in Studio and in a built site; the Rules bullet reads "`filter` and `sort` must be `$ref`s to callable state entries; a named formula is called the same way everywhere." CKL1.4: "How it works" replaces "the previous generation of item nodes and their bindings is disposed and the list re-renders in place" with the keyed reconciliation and the one-microtask batching, and "Keeping rows across changes" says a built site keeps rows the same way.
- `docs/framework/concepts/references.md` (`code:` lists `pointer.ts`), CKL1.1: after the scheme table, "`#/$map/item` is accepted wherever `$map/item` is."
- `docs/framework/build.md` (`code:` lists `site-build.ts` and `client-runtime.ts`), CKL1.3: the subpaths paragraph says the scan covers component and page modules and that every page's map carries the prefix keys; CKL1.4 adds that a keyed list brings lit's `repeat` and `async-directive` modules, served the same way.
- `docs/framework/concepts/functions.md` and `docs/studio/design/repeaters.md` describe classification and the Repeat dialog, not lowering; neither changes. The other pages `bun run docs:sync` names for `runtime.ts`, `shared.ts` and `expression.ts` describe unrelated behaviour.

This does not graduate spec.md.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/runtime`, `packages/schema` and `packages/compiler`, and `bun scripts/check-coverage-manifest.ts` passes for each.
- `bun run schema:verify` passes after CKL1.1, and `validateDocument` accepts `key: { "$ref": "#/$map/item/id" }`.
- `rg -n 'ITEMS' packages/compiler/src/targets` and `rg -n 'startsWith\("#/\$map/"\)' packages/runtime/src packages/compiler/src` each find only `canonicalMapRef`'s own line or nothing.
- `bunx jx build` on the Context 2 probe with a keyed list and a named-formula filter added: `dist/index.html` has no prerendered `<li>` for the list and an import map with `"lit-html/"`; `dist/assets/lit-html/directives/repeat.js` and `dist/assets/lit-html/async-directive.js` exist; served, clicking the button adds a row and an in-place reverse keeps the focused row's input focused.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links` and `bun run plans:check --audit spec` pass.

## Slices

| Slice  | Scope                                                                                                                                                       | Claims       | State |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| CKL1.1 | `canonicalMapRef` in every resolver, `MapRef` and key patterns widened, schemas regenerated; spec.md §10.4 spelling paragraph and marker sentence           | —            | open  |
| CKL1.2 | `__jxShape` in both compiled targets and the site build, the settled-list gate, inline `items`, client ref reads; spec.md §10.1 and §10.3, compiler.md §4.7 | spec.md#10.3 | open  |
| CKL1.3 | Page-template tiers take `runtimeImports`, CDN fallback prefix, subpath scan over every emitted module; site-architecture.md §8.7, compiler.md §12          | —            | open  |
| CKL1.4 | `mappedRowKeys`, `__jxRowKeys` and the `__jxKeyed` directive in both targets, drift test; spec.md §10.4 → Implemented, compiler.md §4.7                     | spec.md#10.4 | open  |
