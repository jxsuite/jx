---
status: drafted
disposition: implement
claims:
  - spec.md#11.2
requires:
  - spec/compiled-cookie-attributes
  - spec/compiled-request-fetch
  - spec/web-api-prototype-parity-readable-stream
workspaces:
  - packages/compiler
  - packages/runtime
size: M
---

# Every built-in Web API prototype resolves in a built page and a built component as it does in the interpreter

## Context

`specs/spec.md` §11.2, line 1192:

> **Status: Partial.** The interpreter's `resolvePrototype` handles every Web API row but `ReadableStream`, whose case returns `null`; the `Array` row is the §10 children node, not a state prototype. The client target (`compile-client.ts`) lowers `LocalStorage`, `SessionStorage`, `Request` and `Cookie`; the element target (`compile-element.ts`), which compiles every site component, lowers only `Request` and turns a storage or cookie entry into a plain initial value (its `default`), with no read and no persistence. `URLSearchParams`, `FormData`, `IndexedDB`, `Set`, `Map` and `Blob` reach a built page as the literal definition object in both targets, and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort. Each cell below that reads Partial names its compiled gap.

The table (lines 1196–1207): ten `**Partial**` cells naming a compiled gap, `ReadableStream` `**Pending** — stub returns null`, `Array` `**Implemented**`.

The stub held four pieces of work. Two now belong to enabling plans this plan requires, and each narrows the marker when it lands:

- `plan:spec/compiled-request-fetch`: the marker's last clause and the `Request` cell (debounce and abort in `emitRequestFetch`).
- `plan:spec/web-api-prototype-parity-readable-stream`: the `ReadableStream` clause and row, split out because its disposition (recommended: remove) differs from this plan's and it touches `packages/runtime` and `packages/schema` only.

This plan closes the rest: the element target's storage and cookie lowering, and compiled lowering for `URLSearchParams`, `FormData`, `IndexedDB`, `Set`, `Map` and `Blob` in both targets. The final flip of the section stays here.

**The interpreter** (`resolvePrototype`, `packages/runtime/src/runtime.ts:2810`), re-verified:

- **`URLSearchParams`** (2878): `computed(() => new URLSearchParams(p).toString())`. `p` holds every key but `$prototype`, each a `$ref` (`resolveRef`), a `${}` template (`evaluateTemplate`) or the literal.
- **`LocalStorage` / `SessionStorage`** (2896): reads `store.getItem(def.key ?? key)`, then `JSON.parse`, else `def.default ?? null`. A throw falls back to the default. An `effect` then persists: `null` removes the item, anything else is `setItem(JSON.stringify(v))`, and each write is inside its own `try`. The `localStorage`/`sessionStorage` lookup itself (line 2898) is outside every `try`, so storage the browser refuses to open throws out of `buildScope`.
- **`Cookie`** (2924): `plan:spec/compiled-cookie-attributes` moves its read and write into `cookie.ts`, and gives the compiler `emitCookieBinding` and `cookieHelperSource`.
- **`IndexedDB`** (2946):
  - throws `Jx: IndexedDB entry '<key>' requires database and store` when either is missing;
  - otherwise opens `database` at `version` (destructuring defaults `version = 1`, `keyPath = "id"`, `autoIncrement = true`, `indexes = []`);
  - creates the store and its indexes on `upgradeneeded`;
  - on `success` sets `{ database, getStore(mode = "readwrite"), isReady: true, store, version }`, and on `error` sets `{ error }`.
- **`Set`** (2986): `new Set(Array.isArray(def.default) ? def.default : [])`.
- **`Map`** (2990): `new Map(Object.entries(isJsonObject(def.default) ? def.default : {}))`.
- **`FormData`** (2994): `append(k, v)` for each entry of `def.fields ?? {}`.
- **`Blob`** (3002): `new Blob(def.parts ?? [], { type })`, where `type` is `def.type` when it is a string and `"text/plain"` otherwise.
- **Precedence and timing.** An entry with `$src` goes to the external-class path first (line 2816). `buildScope`'s pass 0 turns a bare `$prototype` that the document's `imports` maps into a `$src` (line 805), so a mapped built-in name is an external class too. `timing` is not read.
- **The interpreted element** builds its scope once (`_jxInitialized`) inside `connectedCallback`, before the `data-jx-props`, `props.*` and property merges. So a supplied prop overwrites a storage or cookie value, and the persisting effect writes it back. `disconnectedCallback` stops nothing, so those effects live as long as the instance.

**The compiled side today** (re-verified, with corrections to the marker's wording):

- **Client target** (`packages/compiler/src/targets/compile-client.ts`).
  - Storage goes through `emitStorageInit` (line 1019). It pastes the key raw (`state.${key}`, a SyntaxError for `user.name`) and writes the key and storage key into a `//` comment.
  - `Cookie` goes through `emitCookieInit`, which `plan:spec/compiled-cookie-attributes` replaces.
  - Every other built-in reaches `stateEntries.push([key, def])` (line 232): the literal definition object.
- **Element target** (`packages/compiler/src/targets/compile-element.ts`). `extractInitialValue` (line 246) checks `"default" in def` before any prototype. So:
  - a storage, `Cookie`, `Set` or `Map` entry with a `default` becomes that plain value (a `Set`'s array stays an array);
  - without one, a storage entry is `null`, and every other built-in, `Cookie` included, is its literal definition object.
  - The file contains no `localStorage`, `sessionStorage` or `document.cookie` token.
- **Prerender.** `buildInitialScope` (`shared.ts:513`) seeds an entry that has a `default`, and every storage entry, with its default. A binding over any of these entries is still emitted, so hydration corrects the text. This plan does not change it.
- **Tests that pin today's output.**
  - `compile-client.test.ts` ("compileClient — prototypes", line 272).
  - `compile-element.test.ts` ("compileElement — extractInitialValue prototypes", line 676, which asserts `theme: "dark"` in the state literal).
  - `no-eval.test.ts` compiles no built-in.

**Related, no edge.** These plans edit the same functions:

- `plan:_shared/compiled-prop-bridge`, `plan:_shared/compiled-element-lifecycle` and `plan:compiler/client-external-class-hydration` edit the element's `connectedCallback`. This plan leaves it untouched (see Decisions).
- `plan:compiler/client-external-class-hydration` decides which `$prototype` entries are external classes (`isExternalClassDef`), and `plan:extensions/local-imports-precedence` makes `imports` win on every path. This plan's dispatcher declines exactly the entries those paths own.
- `plan:spec/request-url-params` edits `emitRequestFetch`, which this plan does not touch.
- `plan:spec/timing-values-in-built-sites` owns what `timing` means on a built-in (§11.3).
- `plan:schema/prototype-property-declarations` narrows what `FormData` and `Blob` accept. Nothing here depends on that, because the lowering mirrors the runtime for any value.

## Outcome

- spec.md §11.2 → Implemented.
  - Every row but `Array` resolves in the interpreter and in both compiled targets.
  - An agreement test holds each compiled lowering to `resolvePrototype`.
  - Every cell reads `**Implemented**`, apart from `ReadableStream`'s, which `plan:spec/web-api-prototype-parity-readable-stream` settles (recommended: `**Removed**`).
- A built component reads and persists its `LocalStorage`, `SessionStorage` and `Cookie` entries. A built page and component hold a real `Set`, `Map`, `FormData` and `Blob`, a live `URLSearchParams` string, and an opened `IndexedDB` handle.
- In both tiers, storage the browser refuses leaves an entry at its `default`.
- compiler.md §4.1 and §9.1 describe the lowering. Their markers are untouched.
- spec.md does not graduate.

## Decisions

- **Decided:** one dispatcher, `lowerBuiltInPrototype`, lowers every built-in except `Request` in both targets. It lives in a new `packages/compiler/src/targets/builtin-prototypes.ts`.
  - Two targets with one list of cases cannot drift the way `compile-client.ts` and `extractInitialValue` did.
  - `Request` keeps its own call sites, because `plan:spec/compiled-request-fetch` and `plan:spec/request-url-params` both edit them.
- **Decided:** the dispatcher declines an entry that carries `$src`, or whose `$prototype` the document's `imports` maps, and it ignores `timing`. Both are `resolvePrototype`'s rules. The declined entry is left to the external-class path, and a `timing` on a built-in is §11.3's question, not this section's.
- **Decided:** the element target binds every lowered entry in its constructor, once per instance. The entry starts as `null` in the state literal, and its effect is not added to `#effects`, so `disconnectedCallback` does not stop it. Four reasons:
  - The interpreted element builds its scope once and never stops these effects.
  - The constructor runs before any prop is absorbed, so a supplied prop overwrites and is persisted, as in the interpreter.
  - A read at every connection would overwrite a write made while the element was detached, which becomes possible once `plan:_shared/compiled-prop-bridge`'s accessors exist.
  - It leaves `connectedCallback`, which three other plans restructure, untouched.
- **Open:** in a component, does a prop supplied for a storage or cookie entry override the stored value (and get stored), or does the stored value win? Recommendation: the prop wins in both tiers, and §11.2 says so.
  - That is what the interpreter does today, and Studio's canvas and preview run the interpreter, so a built site must match what the author saw.
  - The other answer is a change to `defineElement` in `packages/runtime` as well as here.
  - The consequence to sign: a parent that passes `theme="dark"` resets a visitor's stored `theme` on every load. An author who wants the stored value to win passes no prop.
- **Decided:** storage that throws on access (a sandboxed frame, blocked site data) leaves the entry at its `default` in both tiers. The runtime's storage case moves its store lookup inside each `try`, where the compiled binding has always had it. The alternative is compiled output copying a throw that stops a whole page module hydrating.
- **Decided:** the lowerings mirror the runtime's calls, with its fallbacks applied at build time.
  - `Set`, `Map`, `FormData` and `Blob` are built from JSON literals, so there is no helper to drift.
  - `URLSearchParams` is a `computed` over every key but `$prototype`, because any name (`name`, `description`) is a legitimate query parameter. This is also schema.md §3.1's wording after `plan:schema/generator-inventory`.
  - `IndexedDB`, the one lowering with logic, calls an inlined helper (`__jxIdbOpen`).
  - Following `plan:spec/compiled-cookie-attributes`, the helper's source is written in the compiler, not serialized from a runtime function. A behavioural agreement test holds it to `resolvePrototype`, per the spec-wide inlining decision in `plans/spec/README.md`.
- **Decided:** an `IndexedDB` entry without `database` or `store` is a compile error carrying the runtime's message. The interpreter already refuses that entry wherever it runs, Studio's canvas included, so no working page depends on it. Emitting the throw instead would stop the page module at load.

## Implementation

1. **`packages/compiler/src/targets/builtin-prototypes.ts`** (new, header `@docs framework/concepts/data-prototypes`):
   - `export interface LoweredBuiltIn { setup?: string; computed?: string; helpers: string[] }`.
     - The entry starts as `null`.
     - `setup` holds statements that give it its value once state exists.
     - `computed` is a `() => …` source that the target assigns as `computed(…)`.
     - `helpers` are module-level sources that `setup` calls.
   - `export function lowerBuiltInPrototype(key: string, def: JxPrototypeDef, opts: { statePrefix?: string; indent?: string; imports?: Record<string, string> } = {}): LoweredBuiltIn | null`.
     - Defaults: `statePrefix` is `"state"` and `indent` is `""`.
     - Returns `null` when `def.$src` is set, when `opts.imports?.[def.$prototype]` exists, and for `Request`, `Array`, `Function` and any other name.
     - `acc` is `refAccessor(statePrefix, escapeToken(key))` (from `@jxsuite/runtime/pointer`). Every document string reaches the output through `JSON.stringify`, and no document text goes into a `//` comment.
     - The cases:
       - `LocalStorage` / `SessionStorage`: `setup` is `emitStorageBinding(key, def, opts)`.
       - `Cookie`: `setup` is `emitCookieBinding(key, def, { statePrefix, indent })` and `helpers` is `[cookieHelperSource()]` (both from `../shared.ts`, per the cookie plan's contract). Pass no `collect`.
       - `URLSearchParams`: `computed` is `() => new URLSearchParams({ <JSON k>: <v>, … }).toString()`, in key order. `<v>` is `compileOperandSource(v, { statePrefix })` for a `$ref` (`isRefObject`), a template literal of `withStatePrefix(v, statePrefix)` for a `${}` string (`isTemplateString`), and `JSON.stringify(v)` otherwise.
       - `IndexedDB`: when `database` or `store` is falsy, throw an `Error` carrying the runtime's message, `Jx: IndexedDB entry '<key>' requires database and store`. Otherwise `setup` is `__jxIdbOpen(<JSON config>, (_v) => { <acc> = _v; });` and `helpers` is `[idbHelperSource()]`. The config holds `database`, `store`, `version`, `keyPath`, `autoIncrement` and `indexes`, each defaulted only when the key is absent (`=== undefined`), as destructuring does.
       - `Set`: `setup` is `<acc> = new Set(<JSON of Array.isArray(def.default) ? def.default : []>);`.
       - `Map`: `setup` is `<acc> = new Map(<JSON of Object.entries(isJsonObject(def.default) ? def.default : {})>);`.
       - `FormData`: `setup` is `<acc> = (() => { const _f = new FormData(); _f.append(<JSON k>, <JSON v>); …; return _f; })();` over `def.fields ?? {}`.
       - `Blob`: `setup` is `<acc> = new Blob(<JSON of def.parts ?? []>, { type: <JSON of the string type or "text/plain"> });`.
     - Each line of `setup` is prefixed with `indent`.
   - `export function emitStorageBinding(key, def, { statePrefix = "state", indent = "" } = {})`: the logic of `emitStorageInit`, moved and hardened. The emitted block is:

     ```js
     // Storage entry
     {
       const _k = <JSON def.key ?? key>;
       try {
         const _s = <store>.getItem(_k);
         <acc> = _s !== null ? JSON.parse(_s) : <JSON default ?? null>;
       } catch {
         <acc> = <JSON default ?? null>;
       }
       effect(() => {
         const _v = <acc>;
         try {
           if (_v === null) <store>.removeItem(_k);
           else <store>.setItem(_k, JSON.stringify(_v));
         } catch {}
       });
     }
     ```

     `<store>` is `localStorage` or `sessionStorage`, chosen from `$prototype`, never from document text.

   - `export const IDB_HELPER = "__jxIdbOpen"` and `export function idbHelperSource(): string`. It returns one plain-ES2020 function `__jxIdbOpen(o, set)` that restates the runtime's case line for line:
     - `indexedDB.open(o.database, o.version)`;
     - the `upgradeneeded` store and index creation, with `unique: i.unique ?? false`;
     - `success` → `set({ database, getStore: (mode = "readwrite") => Promise.resolve(db.transaction(o.store, mode).objectStore(o.store)), isReady: true, store, version })`;
     - `error` → `set({ error: r.error?.message })`.

     Its JSDoc carries the "why inlined" paragraph, pointing at `attrHelperSource()`.
2. **`packages/compiler/src/shared.ts`**: export `withStatePrefix` (today module-private, line 222) unchanged.
3. **`packages/compiler/src/targets/compile-client.ts`**, in `compileClient`'s `isPrototypeDef` block:
   - Call `lowerBuiltInPrototype(key, def, { imports: raw.imports })` first. On a result:
     - push `[key, null]` onto `stateEntries`;
     - push `[key, computed]` onto `computedEntries` when present (so `computed` is imported);
     - push `setup` onto `initBlocks`;
     - add `helpers` to a module-level `Set`;
     - `continue`.
   - The `Request` branch stays. Delete the storage and `Cookie` branches and `emitStorageInit`.
   - `emitClientModule`'s trailing options object (built by the cookie and request plans) replaces `needsCookie` with `helpers: string[]`, emitted in insertion order directly after `attrHelperSource()`.
   - Update the "Prototype init emitters" comment to point at `builtin-prototypes.ts`.
4. **`packages/compiler/src/targets/compile-element.ts`**, `emitElementModule`:
   - Before the import lines, compute `lowered = new Map(key → LoweredBuiltIn)` over `isPrototypeDef` entries, with `{ statePrefix: "this.state", indent: "    ", imports: doc.imports }`. This is the same pre-pass pattern `requestEntries` uses.
   - Push the distinct helpers after `attrHelperSource()` (line 415).
   - In the state loop, a key in `lowered` pushes `[key, "null"]` ahead of the `extractInitialValue` fallback.
   - Before the constructor's closing line (638), emit `<acc> = computed(<computed>);` and then `setup` for each lowered entry, in document order.
   - Delete `extractInitialValue`'s storage branch, which is now dead. Its `Request` branch stays.
   - `connectedCallback` and `disconnectedCallback` are unchanged.
5. **`packages/runtime/src/runtime.ts`**, the `LocalStorage`/`SessionStorage` case: replace `const store = …` with `const store = () => (def.$prototype === "LocalStorage" ? localStorage : sessionStorage);`, and call `store()` inside the read `try` and inside each write `try`. Add a one-line comment: the getter itself throws where the browser refuses storage.

**Integration contract.** No plan requires this one. Once it lands:

- `lowerBuiltInPrototype` is the one place a built-in other than `Request` is lowered, for both targets. A name added to `BUILT_IN_PROTOTYPES` fails a test until it gets a case there.
- The dispatcher declines `$src`-carrying and `imports`-mapped entries, so an external-class predicate may treat them as classes.
- It ignores `timing`. `plan:spec/timing-values-in-built-sites` changes that in this one function if §11.3 decides a built-in's `timing` matters.
- A compiled element binds storage and cookies in its constructor with uncollected effects, so a plan restructuring `connectedCallback` or `#effects` has nothing of these to preserve.
- spec.md §11.2 reads Implemented and states when a component reads and persists storage.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` and from `packages/runtime`, then `bun scripts/check-coverage-manifest.ts packages/compiler` and `… packages/runtime`.

**`packages/compiler/tests/builtin-prototypes.test.ts`** (new, emitted text):

- "declines Request, Array, an unknown name, an entry with $src and an imports-mapped name": each returns `null`.
- "lowers every built-in but Function, Array and Request": loops over `BUILT_IN_PROTOTYPES` from `@jxsuite/schema/defs`, with a minimal config per name. If `plan:spec/web-api-prototype-parity-readable-stream` was signed as `defer`, `ReadableStream` joins the exclusions.
- "a hostile key and storage key are data":
  - for `user.name` with `key: 'a"b c'`, the output contains `state["user.name"]`;
  - the storage key appears only as its `JSON.stringify` form, and no `//` line carries document text;
  - `new Bun.Transpiler({ loader: "js" }).transformSync(helpers + setup)` does not throw.
- "the element options": with `statePrefix: "this.state"` and a four-space indent, every line is indented, reads and writes `this.state.k`, and nothing is pushed to a collector.
- "IndexedDB without database or store is a compile error naming the entry", with the runtime's message.
- "IndexedDB defaults fill only absent keys": `version` omitted gives `1`, and an explicit `keyPath` is kept.
- "URLSearchParams lowers a literal, a $ref and a template, in key order".
- "Set, Map and Blob take the runtime's fallbacks for a missing or mistyped value".

**`packages/compiler/tests/builtin-prototype-agreement.test.ts`** (new). This is the behavioural guard.

Setup:

- `GlobalRegistrator.register()` in `beforeAll` and `unregister()` in `afterAll` (`@happy-dom/global-registrator` is already a compiler devDependency).
- The runtime tier runs `state.k = await resolvePrototype(def, state, "k")` on a `reactive({})`, as `buildScope` does.
- The compiled tier runs `new Function("state", "effect", "computed", helpers + computedAssign + setup)` against `reactive({ k: null })` with `statePrefix: "state"`, using the oxlint `no-new-func` disable comment that `locale-negotiation.test.ts` uses.
- Both tiers get `effect` and `computed` from the workspace's single `@vue/reactivity`.
- Storage is cleared in `afterEach`, and an `indexedDB` stub (the `runtime-gaps.test.ts` shape: a request whose listeners the test fires, recording `open`, `createObjectStore`, `createIndex` and `transaction` calls) is installed per case.

Each case asserts that the compiled result deep-equals the runtime result:

- "storage: a stored JSON value, a missing key, a corrupt value and no default", for both stores.
- "storage: an assignment persists, null removes the item, a nested mutation persists", comparing the store contents after each step.
- "storage: a store that throws on access leaves the default and throws nothing" (a `localStorage` getter that throws a `SecurityError`). This case fails without Implementation step 5.
- "URLSearchParams: literal, $ref and template params, recomputed when referenced state changes".
- "Set and Map: contents for a default, no default and a mistyped default, and a mutation through state triggers an effect".
- "FormData: entries for string, number, boolean, null, object and array fields".
- "Blob: text and type with parts and type present, absent and mistyped".
- "IndexedDB: the same open, upgrade and index calls, the same ready value, getStore opening the same transaction mode, and the same error value".

`Cookie` is not repeated here. The cookie plan's `cookie-helper.test.ts` already covers the helper.

**`packages/compiler/tests/compile-element-render.test.ts`**, a new `describe("compiled element: built-in prototypes")`. The fixture is a component `ls-protos` with:

- `theme` (`LocalStorage`, `key: "ls-theme"`, `default: "light"`);
- `visits` (`SessionStorage`, `default: 0`);
- `sid` (`Cookie`, `default: "anon"`);
- `tags` (`Set`, `default: ["a"]`);
- `qs` (`URLSearchParams`, `q: { $ref: "#/state/theme" }`).

It renders each into a `p`. The cases:

- "reads stored values on construction": seed `ls-theme` with `"dark"`, and the page renders `dark` and `q=dark`.
- "an assignment persists and re-renders".
- "a prop from data-jx-props wins over the stored value and is stored". This pins the Open; invert it if the Open is signed the other way.
- "a Set mutation through state re-renders the size".
- "a Cookie entry renders its cookie and writes a change back". This proves the cookie helper links in an element module.
- "re-insertion does not stack a second persisting effect": after remove and re-append, one assignment calls `setItem` once.

**`packages/compiler/tests/compile-element.test.ts`**, in "compileElement — extractInitialValue prototypes":

- "LocalStorage $prototype uses default value" becomes "a storage entry starts null and binds in the constructor". It asserts `theme: null`, `localStorage.getItem(_k)`, the default in both fallbacks, and that the binding comes before `template()`.
- Add "value prototypes are constructed, not literal" (`new Set(`, `new Map(`, `new Blob(`, `new FormData()`).
- Add "the IndexedDB and cookie helpers are emitted once, only when used".
- Add "connectedCallback is unchanged by a built-in": the substring from `connectedCallback() {` to its end is identical with and without a `Set` entry.

**`packages/compiler/tests/compile-client.test.ts`**:

- The two storage cases stay green unchanged.
- Add "a dotted state key with a storage entry compiles".
- Add "URLSearchParams is a computed".
- Add "IndexedDB emits its helper once for two entries".
- Add "Set, Map, FormData and Blob are constructed".
- Add "an imports-mapped built-in name is not lowered".

**`packages/compiler/tests/no-eval.test.ts`**: the fixture gains `LocalStorage`, `IndexedDB` and a template-param `URLSearchParams` entry, so the inlined helper is under the §21.1 lock.

**`packages/runtime/tests/runtime-gaps.test.ts`**: add "LocalStorage: storage that throws on access keeps the default and does not throw" and its `SessionStorage` twin. The existing storage cases in `runtime.test.ts` stay green, which proves the fix moved nothing else.

**Coverage.**

- The per-file bars are: compiler `lines = 0.982, functions = 0.98`; runtime `lines = 0.963, functions = 0.98`.
- The new `builtin-prototypes.ts` ships with its own test file and the agreement test, so the manifest check finds it. Every branch above is exercised.
- `emitStorageInit`'s deletion takes lines out of `compile-client.ts`.
- Ratchet a threshold only if `compile-client.ts`, `compile-element.ts` or `runtime.ts` was its workspace's worst file and rises.

## Specs & docs

**spec.md §11.2** (after the three prerequisites land, the marker names only this plan's gaps):

- Replace the marker with:

  > **Status: Implemented.** The interpreter resolves each entry in `resolvePrototype` (`packages/runtime/src/runtime.ts`). Both compiled targets lower every row but `Array`, which is the §10 children node rather than a state prototype: `Request` through `emitRequestFetch` (`packages/compiler/src/shared.ts`), the rest through `lowerBuiltInPrototype` (`packages/compiler/src/targets/builtin-prototypes.ts`), and `packages/compiler/tests/builtin-prototype-agreement.test.ts` holds each lowering to the interpreter's result.

- Flip the cells to `**Implemented** — …`, dropping each `; compiled: …` or `; element target: …` tail: `URLSearchParams`, `FormData`, `LocalStorage`, `SessionStorage`, `Cookie`, `IndexedDB`, `Set`, `Map`, `Blob`. Re-pad the table with the formatter.
- After the table (below the `Request` paragraph that `plan:spec/compiled-request-fetch` adds), add:

  > An entry that names a built-in but carries `$src`, or whose name the document's `imports` maps, is an external class (§12.5) in both tiers. A component reads its `LocalStorage`, `SessionStorage` and `Cookie` entries once, when the instance is created and before it takes its props, and persists every later change for as long as the instance exists, so a prop supplied for such an entry replaces the stored value and is stored. Storage the browser refuses to open (a sandboxed frame, blocked site data) leaves the entry at its `default`.

  If the Open is signed the other way, the middle sentence says the stored value wins.

**compiler.md §4.1**, after the `Request` paragraph:

> Every other built-in `$prototype` of spec.md §11.2 is lowered by `lowerBuiltInPrototype` (`packages/compiler/src/targets/builtin-prototypes.ts`), which the client target (§9.1) shares. Each entry starts as `null` in the state literal and gets its value in the constructor: `Set`, `Map`, `FormData` and `Blob` are constructed, `URLSearchParams` is a computed, `IndexedDB` opens through an inlined helper, and `LocalStorage`, `SessionStorage` and `Cookie` read their store and register a persisting effect that lives as long as the instance, so disconnecting does not stop it.

**compiler.md §9.1**: add the bullet "- The built-in `$prototype` entries of spec.md §11.2, lowered by the same `lowerBuiltInPrototype` as the element target (§4.1)".

**Fragments:**

- `bun run spec:change spec.md minor -m "Built pages and components resolve every built-in data prototype the interpreter does; a component reads storage and cookies before it takes its props, and storage the browser refuses leaves an entry at its default."`
- `bun run spec:change compiler.md minor -m "Both compiled targets lower every built-in data prototype through one shared emitter, binding storage and cookies in the element's constructor."`

**Docs.**

- `docs/framework/concepts/data-prototypes.md` (`spec: spec.md#11`):
  - add `code:` with `packages/compiler/src/targets/builtin-prototypes.ts`;
  - after the storage example, add "In a component, a stored value is read when the component is created, and a value its parent passes in for the same entry replaces it and is stored." Drop or invert this sentence with the Open. No em dashes.
  - The list of built-ins is otherwise already true of built sites.
- `bun run docs:sync` also names:
  - the pages whose `code:` lists `runtime.ts`, `shared.ts`, `compile-client.ts` or `compile-element.ts` (`reactivity.md`, `functions.md`, `lists.md`, `styling.md`, `components.md`, `elements.md`, `color-schemes.md`, `build.md`, `runtime-host.md`);
  - `timing.md` (`spec.md#11.3`).

  None describes how a built-in lowers, so the pull request states that no update is needed. The implementation-status and spec-changelog pages are generated.

**Landing.** spec.md does not graduate: other open items remain. The pull request deletes this file.

## Acceptance

- `bun run plans:check --audit spec` reports nothing for this plan, and `bun run plans:status --who-claims spec.md#11.2` names no plan.
- `grep -n "compiled: not lowered\|element target: default only\|emitStorageInit" specs/spec.md packages/compiler/src/targets/compile-client.ts` prints nothing.
- These pass: `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`.
- `cd packages/compiler && bun test --isolate --coverage` and `cd packages/runtime && bun test --isolate --coverage` pass at their thresholds, and both manifest checks pass.
- **By hand.** Build a site whose component holds `{ "theme": { "$prototype": "LocalStorage", "default": "light" }, "tags": { "$prototype": "Set", "default": ["a"] } }`, renders `${state.theme}` and `${state.tags.size}`, and has a button that sets `theme` to `dark`.
  - Clicking and reloading shows `dark`.
  - The page shows `1`, not `undefined`.
  - `localStorage.theme` reads `"dark"`.
