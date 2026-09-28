---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/compiler
size: S
---

# The compiled `Request` fetch debounces and aborts the way the interpreter's does

## Context

This plan claims nothing. It was item 4 of `plan:spec/web-api-prototype-parity`. It was split out because `plan:spec/request-url-params` needs the same emitted effect before that plan's larger items land, and both of those plans require this one:

- `plan:spec/request-url-params` owns spec.md §5.3 4e and §11.1. Its compiled half adds `urlParams` reads to the effect `emitRequestFetch` emits, "so a change re-fetches (with `debounce` applied)". Without this plan that would mean one fetch per keystroke, each racing the one before.
- `plan:spec/web-api-prototype-parity` owns spec.md §11.2. The `Request` row's compiled gap is this plan's work. The §11.2 flip stays with that plan.

The text this plan serves is `specs/spec.md` §11.2. The last clause of the marker, at line 1192:

> … and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort. Each cell below that reads Partial names its compiled gap.

And the `Request` cell, at line 1196:

> `**Partial** — reactive URL, debounce, manual mode, abort controller; compiled: no debounce or abort`

**The interpreter (the reference).** The reference is the `Request` case of `resolvePrototype` in `packages/runtime/src/runtime.ts` (line 2823):

- `debounce` defaults to 0. When it is above 0, every fetch goes through `setTimeout` (line 2868), the first fetch included.
- Each run of the effect creates an `AbortController` and passes its `signal`. Its `onEffectCleanup` (line 2841) aborts the controller and clears a pending timer.
- An `AbortError` is not written to the entry (line 2862).

`packages/runtime/tests/runtime-gaps.test.ts` exercises it. The line-496 test is named "cleanup aborts on re-run", but it asserts the new URL and value, not the abort. The line-532 test ("debounce delays fetch and clears timer on re-trigger") does assert the single delayed call.

**A correction to the census.** The census says the cleanup runs "before a re-run and when the effect stops". That is true of `@vue/reactivity`, but the interpreter never stops this effect:

- `buildScope` creates the effect. In `mount()`, `buildScope` runs outside `runScoped` (line 210 against line 223), so `dispose()` does not stop it.
- The interpreted element's `disconnectedCallback` (line 4450) only calls `onUnmount`.

So in practice the interpreter aborts on a re-run only. The Decisions section takes this up.

**The compiled side today.**

- `emitRequestFetch` (`shared.ts:155`) emits one `effect()` per auto-fetching entry. It never reads `def.debounce`. It calls `fetch(url, { method, headers, body })` (line 200) with no `signal`. Its `.catch` (line 203) writes `{ error: String(e) }` for every rejection.
- The client target calls it with no `collect` (`packages/compiler/src/targets/compile-client.ts:219`). A changed template `url` therefore starts a second fetch while the first is in flight, and the last response to land wins.
- The element target collects the runner into `this.#effects` (`compile-element.ts:743`). `disconnectedCallback` calls `stop(_e)` on it (line 856). That ends future runs but not a fetch already in flight, which still writes `this.state.<key>` after the element is removed.
- **Module imports.** The client module imports `reactive`, `effect` and, when needed, `computed` (`compile-client.ts:885`–`889`). The element module imports `reactive, computed, effect, stop` unconditionally (`compile-element.ts:410`). Neither imports `onEffectCleanup`.
- **`@vue/reactivity` versions.**
  - `onEffectCleanup` shipped in 3.5.0.
  - `ReactiveEffect.stop()` runs the registered cleanup (`cleanupEffect`, verified in the installed 3.5.43). The element's existing `stop(_e)` would therefore abort through it.
  - spec.md Appendix B declares `@vue/reactivity` `^3.5`.
  - Every URL a build can name is 3.5.x. The CDN default is 3.5.40 (`DEFAULT_REACTIVITY_SRC`, `shared.ts:241`). `compileElementPage`'s own default is 3.5.13 (`compile-element.ts:199`). A site build self-hosts the compiler's pinned 3.5.43 (`packages/compiler/src/site/client-runtime.ts`).
- `debounce` is already declared, as `debounce?: number` on `JxPrototypeDef` (`packages/schema/types.ts`) and as an integer ≥ 0 in `packages/schema/defs/external-class-def.schema.ts:56`. No schema work is needed.
- **Tests that pin the emitted text.**
  - `packages/compiler/tests/prerender-runtime-state.test.ts`, the `emitRequestFetch` block at line 154. The census missed this one.
  - `compile-client.test.ts`, lines 306–366.
  - `compile-element.test.ts`, the "Request auto-fetch" block at lines 1401–1498. It asserts the literal `fetch(url)` and the exact import line.
- **Spec text.** compiler.md §4.1 (line 94) describes the element's `Request` effect and its teardown, and says nothing about debounce or abort.

## Outcome

- **Claims:** none; this is an enabling plan.
- **spec.md §11.2:**
  - It stays Partial and stays `plan:spec/web-api-prototype-parity`'s to flip.
  - Its marker no longer names the compiled `Request`, and the `Request` cell reads `**Implemented**`.
  - The section gains one paragraph stating what `debounce` and the abort mean. Both tiers satisfy it.
- **compiler.md §4.1:** it says that the element's fetch debounces, and that a disconnect aborts a fetch in flight. Its Partial marker, which belongs to `plan:_shared/compiled-element-lifecycle`, is untouched.
- **In a built site:**
  - Both compiled targets delay every fetch by `debounce`.
  - Both abort the fetch a change replaces and never write an `AbortError` to the entry.
  - The element target also aborts a fetch in flight on disconnect.
  - A document without `debounce` emits no timer. A document without an auto-fetching `Request` compiles to exactly the module it compiles to today.

## Decisions

- **Decided:** cleanup uses `onEffectCleanup`, which is imported only by a module that emits an auto-fetching `Request`, because:
  - it is the interpreter's mechanism;
  - `stop()` runs it, so the element needs no teardown code of its own;
  - Appendix B's `^3.5` and every default URL already guarantee 3.5.0 or later.

  The census's closure alternative does not need its own teardown hook either, since `effect(fn, { onStop })` works on every version and `stop()` calls it. But it would be a second cancellation design beside the runtime's, and it would guard only an author-supplied `reactivitySrc` older than the declared range.

- **Decided:** the timer is emitted only when `debounce` is a finite number above 0, and the value is serialized as that number. Any other value emits the fetch synchronously in the effect, as today. The schema already rejects a non-integer, and this means document text never reaches the module except through `JSON.stringify` or a number.
- **Decided:** the emitted `.catch` skips a rejection whose `name` is `"AbortError"` (`e?.name !== "AbortError"`), and adds no guard beyond the interpreter's.
  - For every rejection `fetch` produces, this has the same outcome as the runtime's `instanceof Error` test, without depending on the realm the error came from.
  - A response that fully resolved before the abort can still be assigned. That window is one microtask checkpoint, the interpreter has it too, and the newer fetch overwrites it.
- **Decided:** the pull request that lands this plan does four things to the spec text:
  - removes the marker clause;
  - flips the `Request` cell;
  - adds §11.2's paragraph;
  - extends compiler.md §4.1.

  The pull request that makes the text false is the one whose reviewer can confirm it; `plan:schema/prototype-property-declarations` sets the same precedent. The paragraph describes re-run behaviour only, because that is what both tiers do.

- **Decided:** the behaviour is tested by an agreement test. It drives `resolvePrototype` and the emitted block through the same scenarios and compares what each does, following the `ref-build-time-agreement.test.ts` precedent. Asserting on emitted text alone is what let the two tiers diverge. The spec-wide rule in `plans/spec/README.md` ("inlined into generated modules from one runtime export, with a drift test") is met by its drift-test half only, on purpose: its precedent, `attrHelperSource()`, serializes a data table (`enumeratedAttrNames()`) and retypes the logic, and a `Request` has no table to serialize. The logic is written in each tier's idiom (a `ref` and `evaluateTemplate` in the runtime, a state write and a template literal in the module), so the agreement test is the drift test.
- **Open:** does `debounce` delay the first fetch as well as re-fetches? Recommendation: yes. The interpreter does, and Studio's preview is the interpreter, so a leading-edge compiled fetch would make a built page load its data at a different time than its preview. A leading edge in both tiers would be a runtime change outside this plan. If signed the other way, `packages/runtime` joins `workspaces`, and the §11.2 paragraph says "every re-fetch".
- **Open:** the interpreter's `Request` effect is never stopped (see the Context correction). An interpreted element that is removed, or a disposed `mount()`, keeps fetching whenever its URL's state changes. Recommendation: this plan leaves it alone, and it becomes an issue against embedding.md §2.2, whose disposer "stops every effect the render created". Reasons:
  - It is interpreter teardown in `packages/runtime`.
  - embedding.md has graduated, so this is a defect fix, not a program item.
  - This plan's compiled behaviour and the §11.2 paragraph are right either way.

## Implementation

1. **`packages/compiler/src/shared.ts`, `emitRequestFetch`.** The signature and the string return stay the same.
   - Compute `const debounceMs = typeof def.debounce === "number" && Number.isFinite(def.debounce) && def.debounce > 0 ? def.debounce : 0;`.
   - After the `url` lines (and after the `undefined` guard for a template), emit `  const _ac = new AbortController();`.
   - Append `signal: _ac.signal` as the last entry of `fetchOpts`, so the call is always `fetch(url, { …, signal: _ac.signal })`.
   - Build the fetch chain once. Its `.catch` becomes `.catch(e => { if (e?.name !== "AbortError") <prefix>.<key> = { error: String(e) }; });`.
   - Without a delay, emit `  onEffectCleanup(() => _ac.abort());` and then the chain.
   - With a delay, emit the following, with the chain indented two more spaces inside the timer:

     ```js
     const _t = setTimeout(() => {
       /* the chain */
     }, <debounceMs>);
     onEffectCleanup(() => { _ac.abort(); clearTimeout(_t); });
     ```

   - The manual branch is unchanged.
   - Extend the JSDoc:
     - it covers debounce and abort;
     - a caller that emits a non-`manual` entry must import `onEffectCleanup`;
     - every tracked read has to happen synchronously before the timer.
2. **`packages/compiler/src/targets/compile-client.ts`.**
   - In the `Request` branch of `compileClient`, set a local `autoFetch = true` when `!def.manual`.
   - Pass it to `emitClientModule` as a new trailing parameter. `emitClientModule` appends `"onEffectCleanup"` to `reactivityImports`, last, when it is set.
   - `plan:spec/compiled-cookie-attributes` adds a trailing `needsCookie` flag to the same function. Whichever lands second folds both flags into one trailing options object (`{ needsCookie, needsEffectCleanup }`) rather than stacking positional parameters.
3. **`packages/compiler/src/targets/compile-element.ts`.**
   - Build the `@vue/reactivity` import at line 410 from a list (`reactive, computed, effect, stop`) and append `onEffectCleanup` when `requestEntries.some(([, d]) => !(d as JxPrototypeDef).manual)`.
   - Update the comment above `requestEntries` to say the import follows the same rule: emitted only when a `Request` needs it.
   - `disconnectedCallback` is unchanged, because `stop(_e)` now aborts through the cleanup.

**Integration contract.** A plan that requires this one may rely on the following once it lands:

- `emitRequestFetch(key, def, { statePrefix, indent, collect })` keeps its signature and its string return.
- The emitted effect body, for a non-`manual` entry, runs in this order:
  1. `const url` (with the `undefined` guard for a template);
  2. `const _ac`;
  3. either an immediate `fetch(url, { …, signal: _ac.signal })`, or `const _t = setTimeout(…, debounce)`;
  4. exactly one `onEffectCleanup` that aborts `_ac`, and clears `_t` when a delay exists.
- A read that must re-trigger the fetch (`plan:spec/request-url-params`'s `urlParams`) is emitted between `const url` and `const _ac`, never inside the timer, where it would not be tracked.
- Anything else a later plan must undo on a re-run or on `stop()` joins that single cleanup. `@vue/reactivity` 3.5 keeps one cleanup per effect, so a second `onEffectCleanup` call replaces the first.
- Both targets import `onEffectCleanup` whenever a module emits a non-`manual` `Request`.
- `packages/runtime` is unchanged.
- In spec.md §11.2:
  - the marker no longer mentions the compiled `Request`;
  - the `Request` cell reads `**Implemented**`;
  - a paragraph under the table defines `debounce` and abort. `plan:spec/request-url-params` extends it to say that a `urlParams` change re-fetches in the same way.
- No shared reader of a `Request` definition is extracted. `plan:spec/timing-values-in-built-sites` fetches at build time and has no edge to this plan. If it wants one, it extracts `requestInit(def)` beside `emitRequestFetch`, and this emitter calls it.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`.

**`packages/compiler/tests/request-fetch-agreement.test.ts`** is new.

Setup:

- It imports `reactive`, `effect`, `onEffectCleanup` and `stop` from `@vue/reactivity`, `resolvePrototype` from `@jxsuite/runtime`, and `emitRequestFetch` from `../src/shared.ts`. The workspace resolves one hoisted copy of `@vue/reactivity`, so both tiers track the same proxies.
- **The two tiers.**
  - The runtime tier awaits `resolvePrototype(def, state, "r")` on a `reactive` state.
  - The compiled tier runs `new Function("state", "effect", "onEffectCleanup", "_runners", emitRequestFetch("r", def, opts))` against a `reactive` state that carries `r: null`. It uses the oxlint `no-new-func` disable comment that `locale-negotiation.test.ts` uses.
- **The fetch stub.** A per-test stub replaces `globalThis.fetch` and is restored in `afterEach`. It records the URL, method (`?? "GET"`), headers, body and signal of each call. It returns a promise the test settles, which rejects with `signal.reason` on abort, as a real fetch does.
- **The trace.** Each tier yields the list of calls as `{ url, aborted }` and every value the entry took, recorded by an `effect`.
- Timers are real: each delay is 20 ms and each wait is 60 ms, the margins `runtime-gaps.test.ts` uses.

Cases that assert `compiled` deep-equals `runtime`, plus an absolute expectation:

- "a static url fetches once and assigns the body";
- "a change aborts the fetch it replaces and only the newer body lands" (values `[null, {v:"b"}]`, the first call aborted);
- "an aborted fetch writes no error";
- "a url that interpolates undefined is not fetched, and changing to one aborts the fetch in flight";
- "a failed response and a network error are written as { error }" (`Not Found`, `TypeError: Failed to fetch`);
- "debounce delays the first fetch" (no call before 20 ms);
- "a change inside the delay restarts it" (one call, with the latest URL);
- "method, headers and body reach fetch beside the signal".

Compiled-only cases, using `collect: "_runners"`:

- "stop() aborts the fetch in flight";
- "stop() cancels a pending delay" (no call after 60 ms).

**`prerender-runtime-state.test.ts`**, in the `emitRequestFetch` block:

- New cases:
  - "passes an abort signal the effect's cleanup aborts": the output contains `new AbortController()`, `onEffectCleanup(() => _ac.abort());` and `fetch(url, { signal: _ac.signal })`.
  - "emits no timer without a positive finite debounce": for `undefined`, `0`, `-5`, `Infinity` and `"300"`, the output has no `setTimeout`, and the string never appears.
  - "schedules the fetch when debounce is set": for `250`, the output contains `const _t = setTimeout(() => {` and `}, 250);`, and the cleanup clears `_t`.
  - "skips an AbortError when writing the error".
- Extended cases:
  - The manual case also asserts no `AbortController`.
  - The indent case also runs with `debounce`.

**`compile-client.test.ts`**:

- "imports onEffectCleanup when a Request auto-fetches";
- "a page without an auto-fetching Request keeps its import line", for no `Request` and for `manual` only (`import { reactive, effect } from '@vue/reactivity';`).

**`compile-element.test.ts`**:

- Update "emits a fetch effect on connect" for the new `fetch(url, { signal: _ac.signal })` and the guarded error write. It uses `indexOf("fetch(url,")`.
- Update "stops the fetch effects on disconnect" for `import { reactive, computed, effect, stop, onEffectCleanup } from '@vue/reactivity'`.
- Extend "adds no Request machinery" to assert the four-name import line and no `AbortController`.
- Add "a manual-only Request imports no onEffectCleanup".

**`compile-element-render.test.ts`**, a new `describe("compiled element: Request fetch")`:

- Setup: compile `{ tagName: "ls-req", state: { q: "a", d: { $prototype: "Request", url: "/api/${state.q}" } }, children: [] }` into `TMP`, import it, and stub `globalThis.fetch` as above (restored in `afterAll`).
- "the module links its onEffectCleanup import and fetches on connect";
- "a state change aborts the fetch it replaces";
- "disconnect aborts a fetch still in flight and writes no error" (`el.state.d` is unchanged after a tick).

This is the only case that executes the real import line.

**Coverage.** The per-file bar is `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`).

- The cases above take every new branch in `shared.ts`, `compile-client.ts` and `compile-element.ts`.
- No source file is added, so the manifest check sees nothing new.
- The temp module lives under `tests/`, which `coveragePathIgnorePatterns` already excludes.
- Raise the threshold only if one of the three files was the workspace's worst and rises.

## Specs & docs

- **spec.md §11.2 marker.** Delete ", and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort". The sentence then ends "…as the literal definition object in both targets." The marker stays `Partial`.
- **spec.md §11.2 `Request` cell.** It becomes `**Implemented** — reactive URL, debounce, manual mode, abort controller`. Re-pad the table with the formatter.
- **spec.md §11.2, new paragraph** between the table and §11.2a:

  > A `Request` entry that is not `manual` fetches inside an effect, so a `${…}` template in its `url` re-fetches when the state it reads changes, and a `url` that still interpolates to `undefined` is not fetched. `debounce` (milliseconds, default `0`) delays every fetch, the first included, and a change inside the delay restarts it. A change also aborts the fetch the previous value started, whether it is still waiting out its delay or in flight; an aborted fetch leaves the entry as it was, and any other failure sets the entry to an object whose `error` is the failure's reason as a string.

- **compiler.md §4.1.** After "…is stopped on `disconnectedCallback` (§4.4).", insert:

  > The effect applies the entry's `debounce` and passes `fetch` the signal of an `AbortController`; the effect's cleanup aborts it and clears a pending delay, and `@vue/reactivity` runs that cleanup before every re-run and on `stop()`, so a changed URL cancels the fetch it replaces and a disconnect cancels one still in flight (spec.md §11.2). The client target (§9.1) emits the same effect from the same emitter, `emitRequestFetch`, without the registry.

- **Fragments:**
  - `bun run spec:change spec.md minor -m "The compiled Request applies debounce and aborts the fetch a change replaces, as the interpreter does, and the section now states both rules."`
  - `bun run spec:change compiler.md minor -m "An element's Request fetch applies debounce and is aborted when its effect re-runs or is stopped on disconnect."`
- **Docs pages.** None change.
  - `docs/framework/concepts/reactivity.md` (line 114, "Reactive URL, debounce, abort") becomes true of built sites.
  - `docs/framework/concepts/data-prototypes.md` (`spec: spec.md#11`, "debouncing") likewise.
  - `docs/framework/build.md` cites `compiler.md#4.1`, but only for the module's structure.
  - `bun run docs:sync` also names the pages whose `code:` lists `shared.ts`, `compile-client.ts` or `compile-element.ts`: `functions.md`, `lists.md`, `styling.md`, `components.md`, `color-schemes.md`, `elements.md` and `build.md`. None of them describes when a `Request` fetches or cancels, so the pull request states that no update is needed.
- **No graduation.** spec.md does not graduate. The landing pull request also:
  - deletes this file;
  - removes `spec/compiled-request-fetch` from the `requires` of `plans/spec/request-url-params.md` and `plans/spec/web-api-prototype-parity.md`;
  - rewrites every other `plan:spec/compiled-request-fetch` citation to cite spec.md §11.2 instead, since a citation of a deleted plan fails the gate (`citation-unknown`). Take the list from `grep -rln "plan:spec/compiled-request-fetch" plans/` at landing time; today it is those two files plus `plans/spec/web-api-prototype-parity-readable-stream.md`, `plans/spec/timing-values-in-built-sites.md`, `plans/schema/generator-inventory.md`, `plans/schema/prototype-property-declarations.md` and `plans/_shared/compiled-server-call.md`;
  - re-reads `plan:spec/request-url-params`'s design against the integration contract above.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- `grep -n "no debounce or abort" specs/spec.md` prints nothing. `bun run plans:status --who-claims spec.md#11.2` still names `spec/web-api-prototype-parity`.
- These all pass: `bun run plans:check --audit spec`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`.
- Compiling a document with no `Request` entry produces a byte-identical module in both targets. `compile-element.test.ts`'s "adds no Request machinery" case is the proof.
- **By hand.** Build a site page whose input writes `state.q`, with `{ "results": { "$prototype": "Request", "url": "/api/search?q=${state.q}", "debounce": 300 } }`. Typing quickly issues one request per pause. A request superseded mid-flight shows as cancelled in the network panel, and the page never shows an error. Removing a component instance with such an entry cancels its pending request.
