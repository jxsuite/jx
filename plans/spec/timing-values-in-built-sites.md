---
status: drafted
disposition: implement
claims:
  - spec.md#11.3
requires:
  - _shared/compiled-server-call
  - compiler/client-external-class-hydration
  - spec/timing-values-in-built-sites-default
workspaces:
  - packages/compiler
  - packages/studio
size: M
---

# Every row of the timing table holds in a built site: a `timing: "compiler"` `Request` is fetched during the build, and an entry the build cannot resolve fails it

## Context

`specs/spec.md` §11.3, line 1228, with the `"client"` cell at line 1232, the `"server"` cell at line 1233 and the `"compiler"` cell at line 1234:

> **Status: Partial.** The compiler row ships only for an external class that names an `$implementation`: a self-contained class is refused with a console warning (§12.4), and a `$prototype: "Request"` is never fetched at build time, because `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) finds no class mapping for it and skips it, yet the site build strips both as resolved compiler entries, so nothing is baked and the page gets no fetch either. The client row holds in the interpreter, but in compiled output only for the built-ins a target lowers (§11.2) and for a registry class with a `lower` capability: an external class with `timing: "client"` reaches a built page as its literal definition object (compiler.md §3), and one with no `timing` is resolved at build time (`resolvePrototypes`), so the two tiers disagree about the default. The server row does not hold in a built site: the route is generated, but no compiled page calls it (§11.4), and in an interpreting host the function can run in the browser.

The trailing `> **Status: Implemented.**` note (line 1236) describes the external class with an `$implementation` and is folded into the new marker when this lands.

**Who closes what.** This plan owns the section and does the one piece no other plan claims, the compiler-timed `Request`:

- The `"server"` row closes with `plan:_shared/compiled-server-call` (the compiled call), which requires `plan:_shared/compiled-server-call-proxy-first` (the interpreting host's browser `import()`).
- The `"client"` row, and the `"compiler"` row's self-contained half, close with `plan:compiler/client-external-class-hydration`. It also routes component documents through `resolvePrototypes` and turns every unresolvable entry into one build error; this plan extends that error list.
- The unset-`timing` question is settled on paper by `plan:spec/timing-values-in-built-sites-default`, split from this stub because it is a `reconcile` that needs neither prerequisite.
- The `"compiler"` row's `Request` half is this plan's. It is also `compiler.md` §10's ledger row "`timing: "compiler"`: bake fetch responses into HTML at build time", which `plan:compiler/superseded-ledger-rows` retires by pointing at this section.

**What ships** (verified 2026-09-27; the census was right about the page path, and every bullet after the first is new):

- `resolvePrototypes` skips `SKIP_PROTOTYPES` (`Function`, `LocalStorage`, `SessionStorage`, `Array`) first. Any other built-in reaches `imports[def.$prototype] ?? registryClassPath(...)`, finds no class and `continue`s with no warning. `compilePage` (`packages/compiler/src/site/site-build.ts`) then deletes every state object still marked `timing: "compiler"`. `buildInitialScope` (`packages/compiler/src/shared.ts`) marks a `Request` runtime-only, so a template reading one is left unresolved, and nothing ever fills it.
- **Every built-in, not only `Request`.** A `LocalStorage`, `Cookie`, `URLSearchParams` or `Set` marked `"compiler"` is stripped the same way, so its runtime behaviour is lost with no error. Nothing in the tree writes one; nothing refuses one either.
- **Components fetch in the browser.** A component never reaches the resolver, and both targets lower a `Request` whatever its `timing` (`requestEntries` in `compile-element.ts`, the `Request` branch of `compileClient`). A component's `"compiler"` `Request` is therefore a client fetch today. Once the hydration prerequisite routes components through the resolver, it reaches the branch this plan adds.
- **The interpreter ignores `timing` on every `$prototype` entry.** `buildScope`'s fourth pass (`packages/runtime/src/runtime.ts`) resolves each one, so Studio's preview fetches a `"compiler"` `Request` in the browser like a `"client"` one. That is the interpreting-host rule the reconcile states; this plan changes nothing in the runtime.
- **Studio offers a timing that does nothing.** The `Request` editor's **Timing** select (`dataFields` in `packages/studio/src/panels/signals-panel.ts`) offers `client` and `server`, and `docs/studio/logic/data-sources.md` says "`server` runs the request on the server instead". No tier reads `timing: "server"` on a `$prototype` entry (`isServerFnDef` in `packages/schema/src/guards.ts` requires no `$prototype`), so a `Request` marked `server` is fetched in the browser in both tiers.
- An unset-`timing` external class that names no class (no `$src`, no `imports` entry, no enabled manifest class) also `continue`s, and reaches the page as its literal definition. The prerequisite fails only the `"compiler"` case.

**Found while detailing, not this plan's.** compiler.md §8.1 says an entry marked `timing: "compiler"` "is exempt and is always stripped". A resolved class value that is an array carries no marker (only an object gets `timing` back), so the strip treats it as an ordinary array and keeps it while something reads it. A `Request` value that is an array will behave the same way. §11.3's new text does not restate stripping, and leaves that to §8.1.

**Tests today:** `packages/compiler/tests/prototype-resolver.test.ts` ("skips builtin prototypes", "skips entries with no $src and no matching import"), `connector-mounts.test.ts` (swaps `globalThis.fetch` in a `try`/`finally`, the precedent for a stubbed fetch), `site-build.test.ts` ("strips compiler-timing state entries after resolution"), `compile-client.test.ts`, `compile-element.test.ts`, and `packages/studio/tests/signals-panel-template.test.ts` ("Request: url, method and timing commit", which picks `server`).

**Related, no edge.** `plan:extensions/local-imports-precedence` edits the lowering branch of the same loop; this plan adds a branch above it and sends no unset entry into it (the reconcile keeps unset classes on the build-time path). `plan:spec/compiled-request-fetch` and `plan:spec/request-url-params` rewrite `emitRequestFetch`, which this plan does not touch. `plan:spec/web-api-prototype-parity` owns each built-in's compiled support, which §11.3 cites rather than restates.

## Outcome

- `spec.md` §11.3 → Implemented: one leading `Implemented` marker, the three cells `**Implemented**`, the trailing note folded in.
- A site build fetches a `"compiler"` `Request` once, bakes its JSON response and ships no fetch; fails the build for any other built-in marked `"compiler"` and for an unset-`timing` external class it cannot locate; and `compile()` refuses a `"compiler"` `Request` outside a site build.
- Studio's `Request` editor offers `client` and `compiler` (per the Open below).
- spec.md does not graduate.

## Decisions

- **Decided:** the build-time fetch mirrors the interpreter's `Request` case field for field, in a new module, and `emitRequestFetch` is not touched. The interpreter is the reference: a `${…}` `url` evaluated against state, `method` defaulting to `GET`, `headers` verbatim, an object `body` sent as `JSON.stringify(body)`, and `r.ok ? r.json() : reject`. Three open plans already rewrite the emitter, and the build path shares no emitted text with it.
- **Decided:** the `url` must resolve to an absolute `http:` or `https:` URL. A build has no page origin, and resolving a relative path against `project.json`'s `url` would fetch the previous deployment of the site being built.
- **Decided:** requests are fetched after every class in the document has resolved, concurrently, against one `buildInitialScope` over the state as resolved so far. So a `url` may read `$site`, `$page` (a dynamic route's `params`), constants and resolved class values. A `url` reading another `Request` is runtime-only in that scope (`readsRuntimeOnlyState`) and fails as unresolvable, which is simpler than ordering fetches by dependency.
- **Decided:** one build fetches each distinct request once. The key is `JSON.stringify([method, url, headers ?? null, body ?? null])`, and the cache holds the promise, rejections included. A layout's entry is resolved once per page, and a hundred pages must not mean a hundred identical calls to a rate-limited API; one build should also bake one snapshot. `jx dev` makes a new cache per rebuild.
- **Decided:** a request with no answer in 30 seconds fails (`AbortSignal.timeout`), because a hung endpoint would otherwise hang `jx build` with no output. The limit is a module constant rather than a `project.json` key; nothing asks for one.
- **Decided:** every refusal joins the prerequisite's one failure list, so each fails the build naming the entry. That covers a `manual` or unresolvable `Request`, a non-2xx answer, a body that is not JSON, a timeout, any other built-in marked `"compiler"` ("has no build-time value; remove `timing` or use `"client"`"), and an unset-`timing` external class that names no class. Each ships today as a page bound to nothing while the build reports success. This follows the prerequisite's third Open: if that is signed toward warnings, these are warnings in the same list.
- **Decided:** a `"compiler"` `Request` that reaches `compileClient` or `compileElement` throws `"<key>": a timing "compiler" Request resolves only in a site build`, mirroring the prerequisite's refusal of a client class with no resolver. Inside a site build it never reaches a target; outside one (`compile()` alone), a silent browser fetch would contradict the row.
- **Decided:** the `"client"` cell cites §11.2 for each built-in's compiled support instead of waiting for `plan:spec/web-api-prototype-parity`. The spec-wide rule is that a gap is marked where the behaviour is specified, and §11.2's cells mark each built-in's compiled gap. §11.3 specifies the timing value.
- **Open:** what does Studio's `Request` **Timing** select offer? Recommendation: `client` and `compiler`, plus the entry's current value when it is neither, so an old `server` stays visible rather than silently shown as `client`. `server` has never done anything for a `Request`, and the docs promise that it runs the request on the server. `compiler` is the timing this plan makes real. If signed no: drop `packages/studio` from `workspaces`, drop the Studio step and test, and still rewrite the docs sentence, because it is false either way.

## Implementation

All steps assume `plan:compiler/client-external-class-hydration` has landed: `resolvePrototypes` collects failures and throws once after its loop, takes `asInitialValues`, and runs for component documents through `prepareComponent`; `shared.ts` exports `isExternalClassDef`.

1. **New `packages/compiler/src/site/build-time-request.ts`** (header `@docs framework/concepts/timing`):
   - `export const BUILD_REQUEST_TIMEOUT_MS = 30_000;` and `export type BuildRequestCache = Map<string, Promise<JsonValue>>;`
   - `export function buildRequest(def: JxPrototypeDef, scope: Record<string, unknown>): { url: string; init: RequestInit; key: string }`. It throws when `def.manual` ("a manual Request has no build-time value"); when `url` is not a string; when a template `url` evaluates (`evaluateStaticTemplate` from `shared.ts`) to anything but a non-empty string free of `"undefined"`, the interpreter's own guard ("url … does not resolve at build time"); and when `new URL(url)` fails or its protocol is not `http:`/`https:` ("a build-time Request needs an absolute http(s) URL, got …"). `init` is `{ method: def.method ?? "GET", headers?, body? }`, with an object `body` stringified; `key` is the cache key above.
   - `export async function fetchAtBuildTime(def, scope, opts: { cache?: BuildRequestCache; timeoutMs?: number } = {}): Promise<JsonValue>`. It calls `buildRequest`, then returns the cached promise for `key` or stores a new one: `fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })`, throwing `HTTP <status> <statusText>` unless `r.ok`, and `response is not JSON` when `r.json()` rejects. A `TimeoutError` is rethrown as `no response within <n> s`.
2. **`packages/compiler/src/site/prototype-resolver.ts`, `resolvePrototypes`:**
   - `projectContext` gains `requestCache?: BuildRequestCache`.
   - Directly after the `isPrototypeDef` check and before `SKIP_PROTOTYPES`: when `def.timing === "compiler"` and `BUILT_IN_PROTOTYPES` (`@jxsuite/schema/defs`) includes `def.$prototype`, push a `Request` onto a local `requests` list, record any other built-in as a failure, and `continue`.
   - Where the prerequisite records `names no class` for a `"compiler"` external class, widen the condition to `def.timing === "compiler" || def.timing === undefined`.
   - After the class loop, and before the failures are thrown: when `requests` is non-empty, take `scope = buildInitialScope(state)` once and `await Promise.all(...)` over them. Each calls `fetchAtBuildTime(def, scope, { cache: projectContext.requestCache })` and hands the value to the same assignment the class path uses (the raw value with the `timing` marker on an object, or `{ default: value }` under `asInitialValues`), or records `"<key>" ($prototype "Request"): <message>`.
   - Update the module and function JSDoc to name the `Request` branch.
3. **`packages/compiler/src/site/site-build.ts`:** `buildSite` creates `const requestCache: BuildRequestCache = new Map()` beside `componentDefs`. It passes it to `compilePage` as a new trailing parameter, which forwards it in `resolvePrototypes`' `projectContext`, and to the prerequisite's `prepareComponent`. The strip is unchanged: a fetched object carries the marker, as a resolved class value does.
4. **Targets:** in `compileClient`'s `Request` branch (`packages/compiler/src/targets/compile-client.ts`) and before `requestEntries` in `emitElementModule` (`compile-element.ts`), throw the Decided error for `def.timing === "compiler"`. The emitted text for every other `Request` is unchanged.
5. **`packages/studio/src/panels/signals-panel.ts`, `dataFields`:** the `Request` timing select's values become `["client", "compiler"]`, with `def.timing` appended when it is set and not one of them. The fallback stays `"client"`.
6. Spec and docs edits, as listed below.

**Integration contract.** Once this lands:

- `build-time-request.ts` exports `buildRequest`, `fetchAtBuildTime`, `BUILD_REQUEST_TIMEOUT_MS` and `BuildRequestCache`. `buildRequest` is the one place a build reads a `Request` definition. `plan:spec/request-url-params` appends `urlParams` to the URL there, and to the interpreter and `emitRequestFetch`, so the three tiers agree.
- `resolvePrototypes` resolves every `"compiler"` entry or fails the build: an external class (the prerequisite's), a `Request` (this plan's), anything else refused. An unset-`timing` external class it cannot locate fails too.
- No compile target emits a fetch for a `"compiler"` `Request`.
- spec.md §11.3 is Implemented, and its **A `Request` at `"compiler"` timing** paragraph is the contract `compiler.md` §10's retirement text points to.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` and from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/compiler` and `… packages/studio`. The new `src/site/build-time-request.ts` ships with its own test file, or the manifest check fails. Per-file thresholds are `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`) and `lines = 0.958, functions = 0.941` (`packages/studio/bunfig.toml`); ratchet either if its worst file rises. Every fetch is a stub swapped into `globalThis.fetch` and restored in `finally`, as `connector-mounts.test.ts` does, so no test touches the network.

`packages/compiler`:

- New `tests/build-time-request.test.ts`:
  - "sends the interpreter's method, headers and body": default `GET`, an object body stringified, headers verbatim.
  - "resolves a url template against the build-time scope, $page included".
  - "refuses a url that reads a runtime-only entry": the scope holds a `Request`.
  - "refuses a relative url and a non-http scheme".
  - "refuses a manual Request".
  - "fails on a non-2xx answer, naming the status".
  - "fails on a body that is not JSON".
  - "fails after the timeout, naming it": `timeoutMs: 10`, with a stub that waits on the signal.
  - "one cache shares a fetch between identical requests, and not between different bodies".
- `tests/prototype-resolver.test.ts`:
  - "a compiler-timed Request becomes its fetched value, marked for the strip".
  - "a Request url reads a compiler-timed class value resolved in the same document".
  - "asInitialValues writes a fetched Request as its default".
  - "a compiler-timed LocalStorage or Cookie fails, naming the entry".
  - "a failed build-time fetch joins the one error listing every entry".
  - "client-timed and unset Requests are left for the targets".
  - "skips entries with no $src and no matching import" becomes "an unset-timing class naming no class fails".
  - The prerequisite's "a compiler-timed entry naming no class fails, a compiler-timed built-in does not" loses its built-in half, which the LocalStorage case now covers.
- `tests/compile-client.test.ts` and `tests/compile-element.test.ts`: "a compiler-timed Request outside a site build is a compile error".
- New `tests/site-build-compiler-request.test.ts`, a temp project with a stubbed fetch:
  - "a layout's compiler-timed Request is fetched once and baked into every page": two pages, one stub call, both HTML files carry the value, no `app.js`.
  - "a failed fetch fails its routes, naming the entry": `errors` names the route and the key.
  - "a component's compiler-timed Request becomes its initial state": the prerender and the component module carry the value, and the module has no `fetch(`.

`packages/studio`, `tests/signals-panel-template.test.ts`:

- "Request: url, method and timing commit" picks `compiler` instead of `server`.
- New "a Request's Timing offers client and compiler, and keeps a stored value it does not offer": `timing: "server"` lists `server` as a third option.

## Specs & docs

**`specs/spec.md` §11.3**, in place, over the text `plan:spec/timing-values-in-built-sites-default` leaves:

- Replace the leading Partial marker with: "> **Status: Implemented.** A site build resolves a `"compiler"` external class during the build, with or without an `$implementation` (§12.4), fetches a `"compiler"` `Request` (`resolvePrototypes` in `packages/compiler/src/site/prototype-resolver.ts`, `fetchAtBuildTime` in `packages/compiler/src/site/build-time-request.ts`), bakes both into the page, and fails on an entry it cannot resolve. A compiled page or element constructs a `"client"` external class (compiler.md §3) and calls a `"server"` entry's route (§11.4); each built-in's compiled support is §11.2's."
- The cells: `"client"`: "**Implemented** — external classes hydrate (compiler.md §3); each built-in's compiled support is §11.2's". `"server"`: "**Implemented** — a built page calls the route (§11.4)". `"compiler"`: "**Implemented** — an external class (§12.4) and a `Request`; any other built-in is a build error".
- The **An unset `timing`.** paragraph gains a closing sentence: "A site build fails on an external class with no `timing` that it cannot locate, as it does on a `"compiler"` one."
- After that paragraph, add: "**A `Request` at `"compiler"` timing** is fetched once per build with the `url`, `method`, `headers` and `body` the interpreter sends (§11.2), its `url` template evaluated against the build-time scope, and its parsed JSON response becomes the entry's value; identical requests from several pages share one fetch. The `url` must resolve to an absolute `http:` or `https:` URL, since a build has no page origin. A `manual` entry, a `url` that does not resolve, a non-2xx answer, a body that is not JSON, or no answer within 30 seconds fails the build naming the entry. No other built-in prototype has a build-time value, so one marked `"compiler"` is a build error, and a compile target outside a site build refuses a `"compiler"` `Request`. An interpreting host fetches it in the browser (see above)."
- Delete the trailing `> **Status: Implemented.**` note; its content is in the new marker, and stripping is compiler.md §8.1's.

**`specs/spec.md` §21.2**, in place: "(resolving `timing: "compiler"` prototypes, importing `$src` modules)" becomes "(resolving `timing: "compiler"` prototypes, including a `Request`'s network fetch, and importing `$src` modules)".

**Fragment:** `bun run spec:change spec.md minor -m "§11.3: a timing compiler Request is fetched once per build and its JSON response baked into the page, any other built-in prototype at compiler timing and an external class the build cannot locate fail the build, and every row of the timing table is Implemented; §21.2 names the build-time fetch."`

**Docs** (no em dashes). `bun run docs:sync` names `timing.md` (`spec.md#11.3`), `data-prototypes.md` (`spec.md#11`), `build.md` (`code:` `site-build.ts`, `shared.ts`, `compile-client.ts`) and `data-sources.md` (`code:` `signals-panel.ts`):

- `docs/framework/concepts/timing.md`, "## Compiler": after the `MarkdownCollection` example, "A `Request` can be build-time data too. With `timing: "compiler"`, the build fetches it once, bakes the response into the page and ships no fetch:" and an example `{ "releases": { "$prototype": "Request", "url": "https://api.example.com/releases", "timing": "compiler" } }`. Then: "The URL must be absolute, because there is no page address during a build, and it may use `${…}` over build-time values such as `$page.params`. If the request fails, answers with an error status, returns something other than JSON or takes longer than 30 seconds, the build stops and names the entry. No other Web-API prototype has a build-time value, so the build refuses one marked `"compiler"`. Studio's preview fetches the same entry live, in the browser." "## Rules" gains "`timing: "compiler"` works for external classes and `Request`; the build refuses it on any other Web-API prototype." Add `code:` with `packages/compiler/src/site/prototype-resolver.ts` and `packages/compiler/src/site/build-time-request.ts`.
- `docs/framework/concepts/data-prototypes.md`: the `Request` bullet ends "…and manual mode, or one fetch during the build with `timing: "compiler"`."
- `docs/framework/build.md`, "What compiles away": "The same applies to `timing: "compiler"` data" becomes "The same applies to `timing: "compiler"` data, a `Request` the build fetched included,". The "Fully static" bullet "…a `$src` value, or a `Request`" becomes "…a `$src` value, or a client-timed `Request`".
- `docs/studio/logic/data-sources.md`, the **Timing** bullet (with the Open signed yes): "**Timing**: `client` fetches in the visitor's browser; `compiler` fetches once while the site builds and bakes the response into the page, which suits data that changes only when you publish. Studio's preview fetches it live either way." The `data-source-request` screenshot is re-captured by the screenshots lane; its manifest steps do not change.
- `docs/extending/reference/implementation-status.md` and `spec-changelog.md` are generated; no edit.

spec.md does not graduate: other sections stay open.

## Acceptance

- From `packages/compiler` and `packages/studio`, `bun test --isolate --coverage` passes at the thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` and `packages/studio` pass.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec spec` no longer lists §11.3.
- Observable, on a scratch site whose page holds `"r": { "$prototype": "Request", "url": "https://<a JSON endpoint>", "timing": "compiler" }` and binds `${state.r.name}`: `jx build` exits 0, `dist/index.html` contains the value, and the page ships no `app.js`. With the `url` changed to `/api/x`, `jx build` fails naming `r`. With `"$prototype": "Cookie"` and `"timing": "compiler"`, it fails naming the entry.
- In Studio, a `Request`'s **Timing** select lists `client` and `compiler`.
