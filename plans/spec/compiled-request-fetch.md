---
status: stub
disposition: implement
claims: []
size: S
workspaces:
  - packages/compiler
---

# The compiled `Request` fetch debounces and aborts the way the interpreter's does

## Context

This plan claims nothing. It was item 4 of `plan:spec/web-api-prototype-parity`, split out because a second owner needs it before that plan's other, much larger items land. It gives both owners one compiled fetch, `emitRequestFetch` in `packages/compiler/src/shared.ts`, that honours `debounce` and aborts on re-run and on teardown, and both require it:

- `plan:spec/request-url-params` owns spec.md §5.3 4e and §11.1. Its compiled half tracks `urlParams` inside the same emitted effect "so a change re-fetches (with `debounce` applied)". Without this plan a compiled `urlParams` change would fetch once per keystroke with no debounce, and each fetch would race the one before it.
- `plan:spec/web-api-prototype-parity` owns spec.md §11.2. The `Request` row's compiled gap is this plan's work. What stays with that plan is the §11.2 flip itself, once `ReadableStream`, the element target's storage and cookie lowering, and the six unlowered rows are done.

`plan:spec/timing-values-in-built-sites` is the third plan the cross-spec review found touching the compiled `Request`. This plan draws no edge to or from it (see **Related**).

The text it serves. `specs/spec.md` §11.2, line 1192, the last clause of the marker:

> … and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort. Each cell below that reads Partial names its compiled gap.

And the `Request` cell, line 1196:

> `**Partial** — reactive URL, debounce, manual mode, abort controller; compiled: no debounce or abort`

**What exists**

- The interpreter's reference behaviour, the `Request` case of `resolvePrototype` in `packages/runtime/src/runtime.ts` (line 2823):
  - `debounce` defaults to 0. When it is above 0 the fetch is scheduled with `setTimeout` (line 2868).
  - Each effect run creates an `AbortController` and passes its `signal`. `onEffectCleanup` (line 2841) aborts it and clears a pending timer. That cleanup runs both before a re-run and when the effect stops.
  - An `AbortError` is swallowed rather than written to the entry (line 2862).
  - It is pinned in `packages/runtime/tests/runtime-gaps.test.ts`, at line 496 ("cleanup aborts on re-run") and line 532 ("debounce delays fetch and clears timer on re-trigger").
- `emitRequestFetch` (`shared.ts:155`) emits one `effect()` per auto-fetching entry. It reads a template `url` inside the effect and skips an URL that still interpolates to `undefined`. It then calls `fetch(url, { method, headers, body })` (line 200) with no `signal` and no timer, and its `.catch` (line 203) writes `{ error: String(e) }` for every rejection. It never reads `def.debounce`.
- The two callers:
  - The client target, `packages/compiler/src/targets/compile-client.ts:219`, calls it with no `collect`, so a page's fetch effects are never stopped. A template `url` whose state changes starts a second fetch while the first is still in flight. Whichever response lands last wins, so a slow earlier response can overwrite a newer one.
  - The element target, `packages/compiler/src/targets/compile-element.ts:743`, collects the runners into `this.#effects`. `disconnectedCallback` stops them (line 856). Stopping ends future re-runs but not a fetch already in flight, whose `.then` still writes `this.state.<key>` after the element has been removed.
- Module headers:
  - The client module imports `{ reactive, effect }`, plus `computed` when needed (`compile-client.ts:885`–`889`). The element module imports `{ reactive, computed, effect, stop }` (`compile-element.ts:410`).
  - Neither imports `onEffectCleanup`. It has been exported since `@vue/reactivity` 3.5.0, and `ReactiveEffect.stop()` runs the registered cleanup, so the element target's existing `stop(_e)` would abort through it.
  - The import-mapped defaults are 3.5.40 (`DEFAULT_REACTIVITY_SRC`, `shared.ts:241`) and 3.5.13 (the element target's own default, `compile-element.ts:199`). The workspace pins 3.5.43. A site build passes `runtimeImports["@vue/reactivity"]` (`packages/compiler/src/site/site-build.ts:1472`).
- `debounce` is already declared, on `JxPrototypeDef` (`packages/schema/types.ts`, as `debounce?: number`) and on the schema (`packages/schema/defs/external-class-def.schema.ts:56`, an integer ≥ 0). No schema work is needed.
- The tests pin the emitted text but not debounce or abort: `compile-client.test.ts` (lines 306–366) and `compile-element.test.ts`'s "Request auto-fetch" block (lines 1401–1498, including "stops the fetch effects on disconnect").

**What is missing**

1. `debounce`. When an entry's `debounce` is above 0, the emitted effect schedules the fetch and clears a pending timer when it re-runs or stops. When it is 0 or absent, the emitted code stays as it is.
2. Abort. Each run creates an `AbortController`, passes its `signal` to `fetch`, and aborts it in the effect's cleanup. That removes the client target's last-response-wins race. It also means the element target's disconnect cancels an in-flight fetch instead of letting it write state afterwards.
3. An aborted fetch is not written to the entry as `{ error }`, matching the interpreter.
4. Detailing must decide one question: whether the cleanup uses `onEffectCleanup`, imported only when a `Request` entry is emitted, or a controller and timer held in a closure outside the effect.
   - `onEffectCleanup` matches the runtime line for line and ties cleanup to both re-run and `stop()` for free, but it needs `@vue/reactivity` 3.5.0 or later at whatever URL the import map names. Every default is later than that; an author-supplied `reactivitySrc` might not be.
   - The closure works with any version, but it has to hook the element target's teardown on its own.
5. Tests:
   - Emitted-text cases in both suites: the `signal`, the timer present only when `debounce` is set, the import added only when a `Request` is emitted, and no `{ error }` write for an `AbortError`.
   - A case showing a document without `debounce` compiles the same fetch as today.
   - The `packages/compiler` coverage ratchet.
6. Spec text. The pull request that lands this narrows §11.2 but does not close it:
   - It drops "and the compiled `Request` … has no debounce or abort" from the marker, and flips the `Request` cell to `**Implemented**`.
   - Once this lands the cell is true of both tiers. `manual` mode already agrees, since neither tier fetches, and `urlParams` is §11.1's.
   - It releases this as a fragment. The §11.2 marker stays Partial for its other rows and stays `plan:spec/web-api-prototype-parity`'s to flip.
   - `docs/framework/concepts/reactivity.md` (line 114, "Reactive URL, debounce, abort") becomes true of built sites. `bun run docs:sync` names any other page.

**Related**

- spec.md §11.1 and §5.3 4e (`plan:spec/request-url-params`, `urlParams` in the same effect), §11.2 (`plan:spec/web-api-prototype-parity`), §11.3.
- `plan:spec/timing-values-in-built-sites` (§11.3). Its compiler-timed `Request` is fetched at build time, not by emitted code, so it does not depend on this plan and no edge is drawn. It reads the same `url`, `method`, `headers` and `body`. If detailing gives the two one reader of a `Request` definition, that reader lives beside `emitRequestFetch`.
- `plan:_shared/compiled-server-call` names `emitRequestFetch` as the shape its compiled server call reuses. If it reuses the helper rather than copying the shape, it inherits this abort handling.
