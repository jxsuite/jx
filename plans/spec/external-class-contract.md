---
status: drafted
disposition: implement
claims:
  - spec.md#12.3
  - spec.md#12.4
requires:
  - compiler/client-external-class-hydration
  - spec/external-class-contract-return-type
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/studio
  - extensions/auth
size: M
---

# An external class instance is unsubscribed when the mount, `$switch` case or component holding it goes away, in both tiers, so §12.3 and §12.4 hold in full

## Context

`specs/spec.md` §12.3, line 1373:

> **Status: Partial.** The constructor config, the `resolve()`/`.value`/instance order and `subscribe(callback)` ship in the interpreter (`importAndInstantiate` and `resolveClassJson` in `packages/runtime/src/runtime.ts`). A built page never instantiates an external class: a `timing: "client"` class reaches it as its literal definition (compiler.md §3), and the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) skips `.value`, going from `resolve()` straight to the instance. `unsubscribe()` is never called, so a subscription outlives its component, and no tool reads `returnType`: the Studio repeater check (`packages/studio/src/editor/convert-to-repeater.ts`) reads a `returns` key that `packages/server/src/studio-api.ts` copies from `methods.resolve.returns`, which only `ContentCollection.class.json` declares.

`specs/spec.md` §12.4, line 1404 (a trailing `> **Status: Implemented.**` at line 1451 describes the entrypoint):

> **Status: Partial.** The `.class.json` entrypoint, `$implementation` and runtime self-contained mode (`classFromSchema`) ship. "Tooling uses this metadata" does not hold: nothing reads `returnType` except `packages/compiler/src/targets/compile-class.ts`, which only sniffs it for an async prefix (§12.3). And the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) refuses a class with no `$implementation` with a console warning, after which the site build strips the entry and reports no error, so self-contained mode is runtime-only (compiler.md §5.4).

Re-verified on 2026-09-27. The two markers name five gaps; three are owned elsewhere and this plan relies on them:

- **Compiled instantiation, `.value` at build time, self-contained classes at build time**: `plan:compiler/client-external-class-hydration` (drafted, claims `compiler.md` §3 and §5.4). Its CEC1.1 makes `resolvePrototypes` read `.value` and construct a self-contained class through `loadClass`; its CEC1.2 delivers a `timing: "client"` class to a built page, holding instances in the page module's `_jxInstances` object and the element's `#jxInstances` map, resolved through `emitExternalClassResolution` in `packages/compiler/src/shared.ts` behind `this.#jxReady ??= …`. Its integration contract names the element map as "where a teardown adds `unsubscribe()`". The census's items 3 and 4 are therefore that plan's, and what stays here for them is the marker flip.
- **`returnType` tooling**: `plan:spec/external-class-contract-return-type` (split from this stub while detailing; claims nothing). It turned out wider than the marker says, see correction 6.

What remains is `unsubscribe()`, which nothing calls in either tier:

- `importAndInstantiate` and the self-contained branch of `resolveClassJson` (`packages/runtime/src/runtime.ts`) each end with the same block: resolve in §12.3's order, wrap the value in a `ref`, call `instance.subscribe(v => s.value = v)`, return the ref. The instance is dropped, so nothing can reach it again.
- The compiled element (`emitElementModule` in `packages/compiler/src/targets/compile-element.ts`) stops its `#effects` and calls `onUnmount` in `disconnectedCallback`; after CEC1.2 it holds instances it never releases. A compiled page's module lives as long as its document.

**Corrections to the census reading**

1. The interpreter has no handle to attach teardown to. `buildScope` runs outside every effect scope (`mount()` awaits it before `runScoped`; `renderSwitch` builds an external case's scope in a `.then` outside the case's `effectScope`; the element class builds its own), and resolution is async, so `onScopeDispose` would register nothing. Release needs a registry keyed by the scope.
2. Components have no teardown to hook. The interpreted element's `disconnectedCallback` only calls `onUnmount`, and `connectedCallback` returns early once `_jxInitialized`, so a removed and re-inserted element keeps its state and live bindings. An unsubscribe on every disconnect would cut the subscription of every component a keyed list merely moves (`insertBefore` of a connected node disconnects and reconnects it in one task; lit's `repeat` does the same to compiled elements).
3. The only shipped class with `subscribe` cannot be unsubscribed. `Session` (`extensions/auth/src/session.ts`) subscribes through `subscribeSession`, which returns a disposer the method discards, and has no `unsubscribe()`; `Session.class.json` declares `subscribe` only. Every mount, case or component holding a `Session` leaves a listener in the module-level store for the life of the page.
4. Studio builds scopes itself in three places, and none can release one: the canvas full render (`renderResolvedDocument` in `packages/studio/src/canvas/iframe-render.ts`, whose `dispose` is the render's `stop`), Library previews (`renderDocPreview` in `packages/studio/src/browse/library-preview.ts`, an LRU of 150 whose eviction is `element.remove()`), and `renderCheck` in `packages/studio/src/services/render-critic.ts` (its comment calls escaped effects GC-eligible, which a callback held by a module-level store is not). The canvas re-renders on edits, so a `Session` on the page gains a listener per full render.
5. The reserved-key drift is the interpreter's. `EXTERNAL_RESERVED` in `runtime.ts` strips ten keys, §12.3's six plus `body`, `parameters`, `arguments` and `name`, and `resolveViaDevProxy` sends the dev server the same stripped config. `RESERVED_KEYS` in `prototype-resolver.ts` strips the six, and CEC1.1 keeps six in `EXTERNAL_CONFIG_RESERVED`. No document under `sites/`, `examples/`, `packages/starters`, `packages/create`, `packages/studio`, `docs/` or `extensions/` gives an external entry any of the four extra keys (scanned).
6. The `returnType` item is not only a key rename: the desktop app's copy of the class-schema extractor (`packages/desktop/src/project-session.ts`) surfaces no return type at all, and Studio's `fetchPluginSchema` never asks about a manifest class added without `$src`, which is how every shipped array-returning class is added. That work touches five other workspaces with no decision in common with teardown, so it is the separate enabling plan.

Found, not claimed: effects `buildScope` itself creates (a `Request`'s auto-fetch, a dev-proxy entry's template effect) escape every effect scope for the reason in correction 1. They are not §12.3's contract and are not closed here.

**Related, no edge.** `plan:_shared/compiled-element-lifecycle` edits the interpreted element's `_jxInitialized` early return (its Open on running `onMount` at every insertion) and the compiled `disconnectedCallback`; `plan:spec/compiled-host-handlers` and `plan:_shared/compiled-prop-bridge` edit the same two compiled callbacks; `plan:spec/compiled-external-switch-cases` edits the same `.then` in `renderSwitch` (registering a case's `$elements` and running its hooks) and compiles an external case to an element, which inherits the element rule below. `plan:spec/timing-values-in-built-sites` flips §11.3's `"compiler"` and `"client"` cells, which name the same refusals.

## Outcome

- `spec.md` §12.3 → Implemented: construction, value order, `subscribe` and `unsubscribe` hold in the interpreter and in a site build, and a **Lifetime** paragraph says when `unsubscribe()` runs.
- `spec.md` §12.4 → Implemented, the trailing Implemented marker folded into the leading one.
- `embedding.md` §2.2 states that `dispose()` unsubscribes the document's instances.
- `spec.md` does not graduate; other open items remain.

## Decisions

- **Open:** when does a component's instance end? Recommendation: at removal, deferred to the next microtask and skipped if the component is back in the document by then; a component inserted again after that constructs and resolves its classes afresh, as its first connection did. In both tiers. Because a keyed reorder removes and re-inserts in one task (correction 2), so an immediate release would churn every moved row's subscription and refetch its `resolve()`, while a deferred one costs nothing on a move; and because re-constructing on a later re-insertion gives the value a fresh component would show, where re-subscribing the old instance would miss every change made while it was out (a `Session` pushes on change and not on subscribe). The alternatives are an immediate release with re-subscribe on every connection (churn on moves, stale values), or releasing only mounts and cases (leaves the leak §12.3 names for components).
- **Open:** which keys are reserved? Recommendation: the six §12.3 lists; the interpreter stops stripping `body`, `parameters`, `arguments` and `name`. Because those are `Function`-entry keys with no meaning on an external class and ordinary constructor parameter names (a `Greeter`'s `name`, an HTTP class's `body`), a site build already passes them, and no shipped document uses them (correction 5). If declined, §12.3's list grows to ten and `EXTERNAL_CONFIG_RESERVED` gains the four.
- **Decided:** the interpreter keeps a registry, a module-level `WeakMap` from a scope to the instances adopted into it, released through one exported `releaseScope(scope)`, because the scope is the one object every owner already holds (correction 1), and Studio's three direct `buildScope` callers need the same call (correction 4). The registry and `buildScope` are one module instance, so a caller must import both from the same `@jxsuite/runtime`, as `runScoped` already requires.
- **Decided:** once released, an instance's callback is inert: the host drops any value it still delivers. `unsubscribe()` is optional in the contract, so this is the only way a class without it stops writing into a discarded scope.
- **Decided:** `mount()`'s `dispose()` releases after `onUnmount`, so the hook still reads live values, matching the element, whose `onUnmount` runs at disconnect and whose release follows at the microtask.
- **Decided:** a compiled page never unsubscribes. Its module lives as long as the document, and releasing on `pagehide` would break a back/forward-cache restore for no gain.
- **Decided:** a Library preview releases its scope when the LRU evicts it or is cleared, not right after rendering, because the page promises live previews and the LRU already bounds how many are alive.
- **Decided:** `Session` keeps at most one subscription per instance: `subscribe` replaces a previous one and `unsubscribe` removes it, because the runtime subscribes once per instance and the store is a `Set` that would otherwise hold a listener per call.

## Implementation

1. **`packages/runtime/src/runtime.ts`**
   - `ExternalClassInstance` gains `unsubscribe?: () => void`. `EXTERNAL_RESERVED` becomes the six §12.3 keys (per the second Open); its JSDoc cites `spec.md` §12.3.
   - `interface Holding { key: string; def: JxPrototypeDef; base: string | undefined; instance: ExternalClassInstance; live: boolean }` and `const _holdings = new WeakMap<JxScope, Holding[]>()`.
   - `async function adoptInstance(instance, def, state, key, base): Promise<Ref<unknown>>`: the value order and `ref` moved from the two duplicated tails; then a `Holding` with `live: true` is pushed onto `_holdings` for `state`, and, when `subscribe` is a function, `instance.subscribe((v) => { if (holding.live) s.value = v; })`. A rejected `resolve()` records nothing. `importAndInstantiate` gains `state` and `key` parameters (its one caller is `resolveClassJson`) and ends `return adoptInstance(...)`; so does the self-contained branch.
   - `function releaseHoldings(state): Holding[]`: sets each `live = false`, calls `unsubscribe()` when it is a function inside `try`/`catch` (`console.error("Jx: unsubscribe failed for", key, error)`, so one class cannot stop the rest), deletes the entry and returns the holdings.
   - `export function releaseScope(scope: JxScope): void`, which calls `releaseHoldings`. JSDoc: the teardown counterpart of `buildScope` for a host that builds a scope itself; `mount()`, `$switch` and custom elements call it for you; idempotent.
   - `async function reacquireHoldings(state, held: Holding[])`: for each, `state[key] = await resolveExternalPrototype(def, state, key, base)`, a throw logged per entry.
   - `mount()`: in `dispose`, `releaseScope(scope)` after the `onUnmount` call and before `root.remove()`.
   - `renderSwitch`, external case: after `buildScope`, a stale load (`gen !== generation`) calls `releaseScope(childScope)` before returning; the render becomes `scope.run(() => { onScopeDispose(() => releaseScope(childScope)); container.append(renderNode(doc, childScope, childOpts)); })`, so `retire()` releases the case.
   - `defineElement`'s element class: field `_jxReleased: Holding[] | null = null` and method `_jxReleaseSoon()`, which queues a microtask that, if `!this.isConnected && this._state`, appends `releaseHoldings(this._state)` to `_jxReleased`. `disconnectedCallback` calls it after `onUnmount`. In `connectedCallback`, the `_jxInitialized` early return first takes `_jxReleased` (setting it to `null`) and, when non-empty, runs `reacquireHoldings(this._state, held)` and then calls `_jxReleaseSoon()` if the element was removed again meanwhile. After `this._state = state` on the first connection, `if (!this.isConnected) this._jxReleaseSoon();`, for a removal that happened while the scope was still building.
2. **`extensions/auth/src/session.ts`**: `Session` gains a private `#stop: (() => void) | null`; `subscribe(callback)` calls `this.#stop?.()` then stores `subscribeSession(callback)`'s disposer (the fetch-on-first-subscribe logic unchanged); `unsubscribe()` calls and clears it. **`Session.class.json`**: `$defs.methods.unsubscribe` (`role: "method"`, `scope: "instance"`, `identifier: "unsubscribe"`, `parameters: []`, a description).
3. **`packages/studio`**, importing `releaseScope` beside `buildScope` from `@jxsuite/runtime` in each file:
   - `src/canvas/iframe-render.ts` `renderResolvedDocument`: `dispose: () => { stop(); releaseScope($defs); }`.
   - `src/services/render-critic.ts` `renderCheck`: hoist `let state: JxScope | null = null`; the `finally` also calls `releaseScope(state)` when set; the comment says a subscription is held by the class's own store and is released explicitly.
   - `src/browse/library-preview.ts`: a module-level `WeakMap<HTMLElement, JxScope>` filled by `renderDocPreview` for the element it returns (and a scope whose render is not an element is released at once); `createPreviewCache`'s `evict` and `clear` release the scope of each element they remove.
4. **`packages/compiler`**, on top of CEC1.2:
   - `shared.ts` `emitExternalClassResolution(entries, opts)`: option `live?: string`, a boolean JS expression. When given, the emitted code evaluates it once each entry's resolution settles, and when false assigns nothing, records no instance and does not subscribe; the subscribe callback evaluates it too and drops a value when false.
   - `compile-element.ts` `emitElementModule`, only for a document with a client class: field `#jxLife = {}`; the connection's `this.#jxReady ??= …` wraps the resolution as `((_life) => <resolution with live "_life === this.#jxLife">)(this.#jxLife)`; method `#jxRelease()` calls each `#jxInstances` value's `unsubscribe()` when it is a function (in `try`/`catch`, logging `Jx: unsubscribe failed`), then sets `#jxInstances = new Map()`, `#jxReady = null` and `#jxLife = {}`; `disconnectedCallback` ends with `queueMicrotask(() => { if (!this.isConnected) this.#jxRelease(); });`. A document without a client class compiles to the same module as before.
   - `compile-client.ts` is unchanged (Decided).

**Integration contract.** `@jxsuite/runtime` exports `releaseScope(scope)`, idempotent; a host that builds a scope with `buildScope` and discards it calls it, and `mount()`'s `dispose()`, `$switch` external cases and interpreted custom elements do so themselves. An interpreted component releases at removal once the microtask passes with it still out, and reconstructs on a later insertion. A compiled element releases through `#jxRelease()`, and `emitExternalClassResolution` accepts `live`; a plan that adds a new owner of a scope (a compiled external case is an element, so it inherits the rule) releases it the same way. `Session` implements `unsubscribe()`. `spec.md` §12.3's Lifetime paragraph is the rule another spec cites.

## Tests

Each workspace runs `bun test --isolate --coverage` from its directory against its per-file `coverageThreshold` (runtime `lines = 0.963, functions = 0.98`; compiler `0.982 / 0.98`; studio `0.958 / 0.941`; auth `0.99 / 1.0`). No new source file, so the manifest check changes nothing. Ratchet any workspace whose worst file rises.

- **runtime**: new `tests/external-class-lifetime.test.ts`, classes served through `preloadModule` and a `fetch` stub for the `.class.json`, as the `mount.test.ts` loader case does, each counting `subscribe`/`unsubscribe` calls:
  - "dispose unsubscribes once, after onUnmount";
  - "a value pushed after dispose does not reach the scope" (a class with `subscribe` and no `unsubscribe`);
  - "releaseScope is idempotent, and a throwing unsubscribe does not stop the others";
  - "a $switch external case unsubscribes when the key moves on";
  - "a stale external case load releases the scope it built";
  - "a component removed from the document unsubscribes after a microtask";
  - "a component moved within the document keeps its instance" (removed and re-appended synchronously: no `unsubscribe`, pushes still land);
  - "a component re-inserted after release constructs its class afresh" (a second constructor call, the new value rendered);
  - "a component removed while its scope was building releases once built";
  - "config keys name, body, parameters and arguments reach the constructor".
  - `runtime-gaps-resolve.test.ts`'s `Resolvable` fixture keeps passing unchanged (it has no `unsubscribe`).
- **compiler**: `tests/external-class-hydration.test.ts` (CEC1.2's happy-dom suite) gains "an element removed from the document unsubscribes its classes after a microtask", "a moved element keeps its instances", "a re-inserted element resolves afresh", "a resolution that settles after release is dropped" and "a class without unsubscribe cannot write after release". `shared.test.ts`: "emitExternalClassResolution with live checks it after resolve and in the subscribe callback". `compile-element.test.ts`: "a document with no client class emits no release".
- **studio**: `iframe-render.test.ts` "dispose() unsubscribes the document's external classes"; `render-critic.test.ts` "renderCheck releases the scope it built"; `library-preview.test.ts` "evicting a preview releases its scope" and "clear releases every scope".
- **auth**: `client-session.test.ts` "unsubscribe removes the listener" and "a second subscribe replaces the first" (one listener notified once by `clearSession()`); `extension-manifest.test.ts` "Session declares subscribe and unsubscribe".

## Specs & docs

In place, in `specs/spec.md`:

- §12.3 marker → "> **Status: Implemented.** The interpreter (`adoptInstance` and `releaseScope` in `packages/runtime/src/runtime.ts`) and a site build (compiler.md §3) construct with the config below, resolve in the order below, follow `subscribe`, and call `unsubscribe()` when the instance's owner goes away. Studio reads `returnType` as the paragraph under the example says."
- §12.3, after the Reactivity code block, a new paragraph: "**Lifetime.** An instance belongs to the scope that declared it, and the host calls `unsubscribe()`, when the instance has one, as that scope ends: a document mounted with `mount()` is disposed (embedding.md §2.2), a `$switch` leaves an external case or discards a load it no longer needs (§14.1), or a component is removed from the document (§16.4). A component's removal takes effect at the next microtask, so a component moved within the document, removed and re-inserted in one task as a keyed list reorder does, keeps its instances; one inserted again later constructs and resolves them afresh, as its first connection did. From then on the host ignores any value an old instance still delivers, so a class without `unsubscribe()` cannot write into a scope that has gone. A compiled page's own instances live as long as the page."
- §12.3's Constructor sentence: unchanged if the second Open goes as recommended; otherwise it lists the ten keys.
- §12.4: the leading marker → "> **Status: Implemented.** Every non-Function external prototype enters through its `.class.json`; `$implementation` redirects to a JS module, and a class without one is built from the schema by the interpreter (`classFromSchema`) and by a site build at either timing (compiler.md §5.4). Tooling reads `returnType` (§12.3)." The trailing `> **Status: Implemented.**` (line 1451) is deleted.

In place, in `specs/embedding.md` §2.2: "`dispose()` stops every effect the render created, calls `onUnmount` if the document declares one and the root was ever attached, calls `unsubscribe()` on each external class instance the document holds (spec.md §12.3), and removes the root from its parent."

Fragments:

- `bun run spec:change spec.md minor -m "External class instances are unsubscribed when their mount, switch case or component goes away, in the interpreter and in compiled elements, and the interpreter passes every key but the six reserved ones to the constructor"`
- `bun run spec:change embedding.md minor -m "dispose() also unsubscribes the external class instances the mounted document holds"`

Docs (no em dashes):

- `docs/extending/extensions/classes.md` (`spec:` cites `spec.md#12.3` and `#12.4`): the **Reactivity is optional** bullet becomes "implement `subscribe(callback)` and the runtime updates the state entry each time you call back. Implement `unsubscribe()` as well, and the runtime calls it when the page, component or `$switch` case holding the instance goes away, so a class listening to something shared can stop." `code:` gains `packages/runtime/src/runtime.ts` and `extensions/auth/src/session.ts`.
- `docs/framework/concepts/data-prototypes.md` (`spec: spec.md#12`): "A class may also expose `subscribe`/`unsubscribe` for push updates" gains ", and the runtime unsubscribes when the component or page holding the value goes away".
- `docs/extending/embedding/runtime-host.md` (`code:` lists `runtime.ts`): the Dispose paragraph's list gains "unsubscribes the external classes the document holds" after `onUnmount`.
- No change, stated: `docs/studio/data/auth-and-secrets.md` (lists `session.ts`; nothing a user sees changes), `docs/studio/projects/browse.md` (previews stay live), and the pages `docs:sync` names for `compile-element.ts` and `runtime.ts` (`components.md`, `lists.md`, `functions.md`, `reactivity.md` and the rest), which describe no class lifetime.

If `bun run plans:check` reports `graduation-ready` for `spec`, graduate it in the same pull request (header to Implemented, `bun run spec:bump spec.md patch` in place, delete `plans/spec/`); it is not expected to.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/runtime`, `packages/compiler`, `packages/studio` and `extensions/auth` at their thresholds.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec spec` lists neither §12.3 nor §12.4.
- Observable, with a class whose `unsubscribe()` logs: a document holding it, mounted with `mount()`, logs once on `dispose()`; a component holding it logs once after `el.remove()`, and nothing after `parent.append(el)` of an element already in the document; in a built site (`jx build`, `timing: "client"`) the compiled element does the same.
- `rg -n "EXTERNAL_RESERVED" -A12 packages/runtime/src/runtime.ts` shows six keys.
