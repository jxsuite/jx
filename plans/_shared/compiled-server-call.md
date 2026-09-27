---
status: drafted
disposition: implement
claims:
  - compiler.md#6.1
  - spec.md#11.4
requires:
  - _shared/page-server-entries
  - _shared/no-adapter-server-tier
  - _shared/compiled-server-call-proxy-first
workspaces:
  - packages/compiler
  - packages/runtime
  - packages/server
size: L
---

# A built page calls its `timing: "server"` entries at the site worker's route, and `jx dev` answers that route

## Context

Two census stubs merged here, one from each spec, because both specify the same `POST <base>/_jx/server/<export>` call from `compile-client.ts` and `compile-element.ts`. The stub also carried the proxy-first change to interpreting hosts. Detailing split that half out as `plan:_shared/compiled-server-call-proxy-first`, an enabling plan this one requires: it touches the runtime alone, needs neither compiler prerequisite, and closes a source-delivery gap that should not wait for them. It rewrites §11.4's dev-boundary passages in place; the section stays Partial and stays this plan's.

`specs/compiler.md` §6.1, line 389 (unmarked before the census; §3's "Server function" row, line 71, points here):

> **Status: Partial.** The server-side artifact is emitted (§6.2, §6.3). The client side is not: no target emits the `POST /_jx/server/$export` fetch, the signal holding its response or the effect around reactive `arguments`, because `compile-client.ts` and `compile-element.ts` serialise the entry into reactive state as a literal object. Only the interpreted runtime calls a server function, in process or through the dev-server proxy (`/__jx_server__`; `resolveServerFunction` in `packages/runtime/src/runtime.ts`), and nothing requests `/_jx/server/*`.

`specs/spec.md` §11.4, line 1240, the leading marker, which opens "**Status: Partial.** The server half ships for a component's entries" and names three gaps: a page's own entry reaches no route that loads (with or without an adapter); "The browser half does not ship in a built site … That includes `jx dev` on a site project, which serves the compiled pages (§16.7)"; and interpreting hosts try a browser `import()` first. The same section carries `> **Status: Partial (dev boundary).**` (line 1297) and a trailing `> **Status: Implemented.**` note (line 1303) that still says the compiler "emits per-route Hono handlers (`compileServer`)".

**What exists** (verified 2026-09-26)

- No client call. `compileClient` sends a server entry to its "Plain object" fallthrough (`stateEntries.push([key, def])`), and `extractInitialValue` in `compile-element.ts` returns `JSON.stringify(def)`. `_jx/server` appears only in `compile-server.ts` and its tests.
- Prerender reads the definition object. `buildInitialScope` (`packages/compiler/src/shared.ts`) stores any object with no `$prototype` and no `default` as a plain value, so a template reading a server entry is evaluated against `{ $src, $export, timing }`. A `Request` entry is marked runtime-only instead.
- The shape to mirror: `emitRequestFetch` in `shared.ts` (an `effect()`, `statePrefix`, and `collect` so the element target's `disconnectedCallback` can `stop()` it). The element target emits it in `connectedCallback` after the three prop merges.
- `$ref` lowering: `compileRef` in `packages/runtime/src/expression.ts` (not exported) is the canonical table for `#/state/`, `parent#/`, `window#/`, `document#/`, `$map/`, `event#/`, `$args/` and `$reduce/`. `refToExpr` in `compile-element.ts` restates part of it.
- The route (`buildRoute` in `packages/compiler/src/targets/compile-server.ts`): `POST <baseUrl>/<export>`, body parsed with `.catch(() => ({}))`, `c.json(await fn(args, c.env))`, a throw answered `{ ok: false, error }` with status 500. An unknown export is Hono's 404, and `c.json(undefined)` sends an empty body. `compileSiteServer` registers under `withBase(base, baseUrl ?? "/_jx/server")`.
- The base never reaches a module. `rewriteHtmlBase` (`packages/compiler/src/site/base-path.ts`) re-roots finished HTML only, so an absolute path inside emitted JS is not rewritten. `siteBasePath(projectConfig.url)` is computed in `compilePage` and in `buildSite`, after step 5 compiles the components.
- The emitters: `compile()` (`packages/compiler/src/compiler.ts`) routes to `compileClient`, to `emitElementModule` for a hyphenated root (line 127), and to `compileStaticPage`, whose islands call `emitElementModule` (`compile-static.ts`, line 60). `compileElement` calls it at line 162.
- `jx dev` on a site project: `startDev` (`packages/server/src/dev.ts`) builds with `buildSite` and serves `dist/` through `createDistMiddleware`. `server.ts` strips the deployment base, applies the loopback Origin/Host gate to `/_jx/*`, and sends it to `handleJxMounts`, which returns `null` for a path no mount owns, so the request falls through to `middleware`. Nothing answers `/_jx/server/<export>`, and `buildSite` returns only `{ errors, files, routes }`.
- `handleServerFunction` (`packages/server/src/resolve.ts`): `isImportable` containment, `import()`, `fn(args, process.env)`, `Response.json(result ?? null)`, errors as `problem(...)`.
- Tests: `compile-client.test.ts` ("compileClient — prototypes"), `compile-element.test.ts` ("Request auto-fetch", line 1401), `compile-element-render.test.ts` (loads an emitted module in happy-dom), `shared.test.ts`, `compile-server.test.ts`, `site-build.test.ts` ("buildSite — server worker", whose portability case imports the bundled worker and POSTs to it), `packages/server/tests/dev.test.ts`.

**Prerequisites** (each checked against its stub)

- `plan:_shared/page-server-entries`: until it lands, a page's or layout's entry has no worker route (step 5b walks `componentDefs` only), so a compiled page's call would 404. Its collector also produces the list the `jx dev` route answers from.
- `plan:_shared/no-adapter-server-tier`: makes an adapter mandatory for any server entry and retires the per-page `_server.js`, so the compiled call has one target, the site worker. It also rewrites §11.4's no-adapter sentence (line 1295) and the trailing note's `compileServer` clause.
- `plan:_shared/compiled-server-call-proxy-first`: §11.4 cannot say Implemented while an interpreting host imports a server module in the browser.

**Related, no edge.** `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` rewrite the same `connectedCallback`. The server calls go last, after the `Request` fetches, and read `this.state` inside an effect, so props those plans deliver later reach a reactive argument without further change. `plan:spec/compiled-request-fetch` adds abort to the `Request` fetch; this plan uses no abort. `plan:spec/timing-values-in-built-sites` requires this plan for §11.3's `"server"` cell.

## Outcome

- `compiler.md` §6.1 → Implemented (CSC1.1). §3's "Server function" row then holds; §3 stays Partial for its external-class rows.
- `spec.md` §11.4 → Implemented (CSC1.2), with one leading marker, both Partial markers gone and the trailing note folded in.

## Decisions

- **Decided:** one emitter, `emitServerCall` in `shared.ts` beside `emitRequestFetch`, serves both targets, and a module-level helper is emitted once per module (`serverCallHelperSource()`, the `attrHelperSource()` pattern). The targets once diverged over `Request` (`emitRequestFetch`'s own comment says so), and one helper keeps the response rule in one place.
- **Decided:** the route prefix is baked in at compile time through a `serverBaseUrl` option (default `"/_jx/server"`). The site build computes it once with a new `serverRoutePrefix(base)` export of `compile-server.ts`, which `compileSiteServer` also uses. `rewriteHtmlBase` never sees inside a module, and one function computing the prefix for the route and its caller means they cannot disagree (`site-architecture.md` §14.7, the worker row).
- **Decided:** a `$ref` argument lowers through the runtime's own `compileRef`, exported unchanged. `#/state/`, `parent#/`, `window#/`, `document#/` and a bare pointer are accepted. `$map/`, `event#/`, `$args/` and `$reduce/` fail the compile, naming the entry and the ref, because a state entry has no loop, event or formula scope and the lowering would name an undeclared identifier. Only top-level `arguments` values are refs, as in the interpreter (`resolveArgs` in `runtime.ts`).
- **Decided:** an entry with a `$ref` argument calls from an `effect()`; one with none calls once, at module evaluation for a page and in `connectedCallback` for an element, as §6.1 item 1 already says. A superseded call's answer is dropped by a per-entry sequence number rather than an `AbortController`: aborting a POST does not stop the function on the server, and the guard sets no `@vue/reactivity` version floor. The enabling plan gives the proxy path the same guard.
- **Open:** what a failed call leaves in state. Recommendation: the entry keeps its last value (`null` before the first success), a non-2xx answer is never stored, and the error goes to `console.error` naming the export. That is what the interpreter's proxy path does today (`resolveServerFunctionViaProxy`), which after the enabling plan is the only interpreting path, so the tiers agree. Storing `{ error }`, as the compiled `Request` does, would make a failure indistinguishable from a function that returns an `error` field.
- **Decided:** `jx dev` answers the route from a middleware in `dev.ts` fed by the entries the last build collected, not by loading `dist/worker.js`. The bundle targets the adapter's runtime (a Cloudflare worker expects `ASSETS` and workerd), and loading it would run the production mounts beside `handleJxMounts`' dev stand-ins. `env` is built as the mounts build it (`process.env` under `.dev.vars`, plus `JX_PROJECT_ROOT`), because the route stands in for the worker exactly as they do (`site-architecture.md` §15.4). Out of scope: an edited server module takes effect after a restart, as through the proxy today, and `jx preview` stays a static server that answers no `/_jx/*` route, mounts included.

## Implementation

### CSC1.1: the compiled call (`packages/runtime`, `packages/compiler`)

1. `packages/runtime/src/expression.ts`: export `compileRef`, with no change in behaviour, and add a JSDoc line naming the compiler as its second caller.
2. `packages/compiler/src/shared.ts`:
   - `export const SERVER_CALL_HELPER = "__jxServerCall"` and `serverCallHelperSource()`. The helper posts `JSON.stringify(args)` with `Content-Type: application/json`, reads the body as text, parses it when non-empty (an empty body is `null`), and on a non-2xx rejects with the parsed body's `error`, else the text, else `statusText`.
   - `emitServerCall(key, def, { statePrefix = "state", indent = "", collect, serverBaseUrl = "/_jx/server" })`. The URL is the JSON-quoted `` `${serverBaseUrl}/${def.$export}` ``. The arguments literal inlines each value with `JSON.stringify`, or with `compileRef(ref, { statePrefix })` after the scheme check. With no ref it emits one call; with a ref it emits a block holding `let _jxSeqN = 0` around an `effect()`, pushed onto `collect` when given. `.then` writes `refAccessor(statePrefix, escapeToken(key))` only when its sequence is current, and `.catch` calls `console.error("Jx server function <export>:", e)` under the same guard.
   - `buildInitialScope`: in the first loop's object branch, before the plain-object fallthrough (line 561), `isServerFnDef(def)` adds the key to `runtimeOnly` and stores no value.
3. `packages/compiler/src/targets/compile-client.ts`:
   - `compileClient` gets an `isServerFnDef(def)` branch before "Plain object", which pushes `[key, null]` onto `stateEntries` and `emitServerCall(key, def, { serverBaseUrl })` onto a new `serverCalls` list.
   - `emitClientModule` emits `serverCallHelperSource()` and those blocks after the computed block and before `bind`, so a ref to a computed reads its value on the first run.
4. `packages/compiler/src/targets/compile-element.ts`:
   - `extractInitialValue` returns `"null"` for a server entry.
   - `emitElementModule` gains a trailing `serverBaseUrl = "/_jx/server"` parameter. When any entry is a server entry, it emits the helper once after `attrHelperSource()`, and each call in `connectedCallback` after the `Request` fetches with `{ collect: "this.#effects", indent: "    ", statePrefix: "this.state" }`, so the existing `stop()` loop in `disconnectedCallback` ends it.
   - `CompileElementOptions.serverBaseUrl` is passed through `processElement`.
5. `packages/compiler/src/compiler.ts`: `CompileOptions.serverBaseUrl`, handed to `compileClient`, to route 2's `emitElementModule`, and to `compileStaticPage`, which passes it on to its islands.
6. `packages/compiler/src/targets/compile-server.ts`:
   - `export function serverRoutePrefix(base: string, baseUrl = "/_jx/server")` returns `withBase(base, baseUrl)`, and `compileSiteServer` calls it.
   - `buildRoute` emits `c.json((await <export>(args, c.env)) ?? null)`, so the route, the dev proxy and the `jx dev` route all answer `null` for `undefined`.
7. `packages/compiler/src/site/site-build.ts`: `buildSite` computes `serverRoutePrefix(siteBasePath(projectConfig.url))` before step 5 and passes it to `compileElement`. `compilePage` derives the same value beside its `basePath` and passes it to `compile()`, leaving its parameter list unchanged.

### CSC1.2: the `jx dev` route and the §11.4 flip (`packages/compiler`, `packages/server`)

1. `buildSite` returns `serverEntries: { exportName: string; src: string }[]`: the deduplicated list step 6c hands `compileSiteServer`, each `src` an absolute path, or `[]` when no worker is written. If `plan:_shared/page-server-entries` already exposes that list, reuse its field.
2. `packages/server/src/resolve.ts`: extract `callServerExport(moduleAbsPath, exportName, args, env, root)` from `handleServerFunction`. It covers containment (`isImportable`), `import()`, the export lookup and the call, and returns `{ ok: true, value }` or `{ ok: false, status, message }`. `handleServerFunction` maps a failure exactly as it does today.
3. `packages/server/src/dev.ts`:
   - `export function createServerFunctionMiddleware(root, entries: () => readonly { exportName: string; src: string }[])` answers `POST /_jx/server/<name>`.
   - An unknown name is a 404. The body is read with `req.json().catch(() => ({}))`, and `env` comes from `projectDevEnv(root)` in `dev-vars.ts` (extract it from `buildRuntime` in `jx-mounts.ts` if the enabling plan did not).
   - It answers `Response.json(value ?? null)`, or `Response.json({ ok: false, error: message }, { status: 500 })` as `buildRoute` does.
   - `startDev` keeps the last `result.serverEntries` from `rebuild()` and composes this middleware ahead of `createDistMiddleware`. The request has already passed `server.ts`'s base strip and Origin/Host gate.

**Integration contract.** Once this lands:

- A compiled page or element module holds `null` for each `timing: "server"` entry and replaces it with the parsed JSON answer of `POST <base>/_jx/server/<export>`, whose body is the resolved `arguments`. It re-calls from an effect when a top-level argument is a `$ref`, drops superseded answers, and on failure keeps the last value and logs.
- Exports: `emitServerCall`, `serverCallHelperSource` and `SERVER_CALL_HELPER` (`shared.ts`); `serverRoutePrefix` (`compile-server.ts`); `compileRef` (`@jxsuite/runtime/expression`); `CompileOptions.serverBaseUrl`; `serverEntries` on `buildSite`'s result; `createServerFunctionMiddleware` (`@jxsuite/server/dev`).
- `jx dev` on a site project answers every collected export at the bare and the based path.
- `plan:spec/timing-values-in-built-sites` may flip §11.3's `"server"` cell.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` (`lines = 0.982, functions = 0.98`), `packages/runtime` (`0.963`, `0.98`) and `packages/server` (`0.96`, `0.95`), with the manifest check for each. No source file is added, so the manifest has nothing new. Ratchet any workspace whose worst file rises.

CSC1.1:

- `compile-client.test.ts`, new `describe("compileClient — timing server entries")`:
  - "posts literal arguments once": `arguments: { filter: "active" }` emits one `__jxServerCall("/_jx/server/fetchMetrics", { filter: "active" })` outside any `effect(`, and state holds `metrics: null`.
  - "a $ref argument calls from an effect emitted after the computed block".
  - "serverBaseUrl prefixes the route".
  - "a $map ref in arguments fails naming the entry".
  - "the helper is emitted once for two entries, and not at all without one".
- `compile-element.test.ts`, new `describe("compileElement — timing server entries")`:
  - "calls in connectedCallback after the props merge and the Request fetches, collecting the effect".
  - "extractInitialValue initialises the entry to null".
  - "a parent#/ argument reads this.state".
- `compile-element-render.test.ts`, the element loaded in happy-dom with a stubbed `fetch`:
  - "posts the arguments and renders the answer".
  - "a 500 with { ok: false, error } keeps the rendered value and calls console.error".
  - "a changed $ref prop re-posts, and a late answer to the first call is dropped": the second fetch resolves before the first.
  - "disconnect stops the effect".
- `shared.test.ts`: "buildInitialScope leaves a server entry runtime-only", where a template reading it is not baked.
- `compile-server.test.ts`: "buildRoute answers null for an undefined return"; "serverRoutePrefix re-roots under the base, and compileSiteServer registers there".
- `site-build.test.ts`, in "buildSite — server worker", on a fixture with `url: "https://x.dev/m/site/"`, a page entry and a component entry:
  - both `dist/**/app.js` and `dist/components/<tag>.js` name `/m/site/_jx/server/<export>`.
  - the bundled worker, imported by the portability case's pattern, answers a POST to that path with the function's value.
  - the component module loaded in happy-dom, with `fetch` routed to the worker's `fetch`, renders that value.
- `packages/runtime/tests/expression.test.ts`: "compileRef is exported and lowers each scheme".

CSC1.2:

- `packages/server/tests/dev.test.ts`, new `describe("createServerFunctionMiddleware")`:
  - "answers a collected export with its value, env carrying a .dev.vars key".
  - "404 for an unknown export".
  - "a throw answers { ok: false, error } with status 500".
  - "ignores GET and paths outside /_jx/server/".
  - "403 for a src outside the root".
- In `startDev`: "an adapter site answers POST /_jx/server/<export> at the bare and the based path".
- The existing `handleServerFunction` cases in `resolve.test.ts` and `resolve-gaps.test.ts` pin the refactor unchanged.

## Specs & docs

**CSC1.1**

- `compiler.md` §6.1:
  - Replace the marker with `> **Status: Implemented.** Both targets emit the call (`emitServerCall`in`packages/compiler/src/shared.ts`), and the site worker serves it (§6.3).`
  - Item 1 becomes: "**Client-side:** a `POST` to `<base>/_jx/server/$export`, `<base>` being the deployment base (site-architecture.md §14.7), whose JSON body is the entry's `arguments` with each top-level `$ref` resolved (`#/state/`, `parent#/`, `window#/`, `document#/`; any other scheme fails the compile). The entry is `null` until a call answers and then holds the parsed response. When an argument is a `$ref` the call runs in an effect, so a change calls again and the answer to a superseded call is dropped. A non-2xx answer is not stored: the entry keeps its last value and the error is logged to the console. A page calls when its module loads, and an element calls in `connectedCallback`, after its props are merged, and stops on disconnect."
  - Item 2 becomes: "**Server-side:** a route in the site worker (§6.3) that imports `$export` from `$src` and answers the function's return value as JSON (`null` for `undefined`), or `{ ok: false, error }` with status 500 when it throws." Keep `plan:_shared/no-adapter-server-tier`'s wording if it has already rewritten this item.
- `compiler.md` §3's marker: delete "The server-function row's missing client fetch is marked on §6.1." The section stays `plan:compiler/client-external-class-hydration`'s.
- Fragment: `bun run spec:change compiler.md minor -m "§6.1: both compile targets emit the server-function call, a POST to the based /_jx/server route carrying the resolved arguments, re-run from an effect when an argument is a reference"`.
- Docs, from `docs:sync`:
  - `docs/framework/build.md` (`code:` `compile-client.ts`, `shared.ts`, `site-build.ts`): the "Dynamic pages" paragraph gains "and one `POST` to the site's worker for each `timing: "server"` entry". Its line 133 belongs to `plan:_shared/no-adapter-server-tier`.
  - `docs/framework/site/deployment.md` (`code:` `site-build.ts`): the "Serving from a subfolder" list gains "the calls a page makes to its server functions".
  - `docs/framework/concepts/timing.md` (`spec:` `compiler.md#6`): "How it works" states the call as item 1 above, in docs prose with no em dash.
  - The concept pages whose `code:` lists `compile-element.ts` or `compile-client.ts` (`functions.md`, `components.md`, `reactivity.md` and the rest) describe no server entry and do not change. `functions.md`'s line 167 is already true.

**CSC1.2**

- `spec.md` §11.4:
  - Replace the leading marker with `> **Status: Implemented.** A built page's module calls each entry at `<base>/_jx/server/<export>`(compiler.md §6.1); the site worker serves every entry a page, its layout or a component declares (compiler.md §6.3);`jx dev`answers the same route on a site project (server.md §2); and an interpreting host calls only the`/**jx_server**` proxy (server.md §3.3).`
  - Delete the trailing note at line 1303.
  - Append to "Arguments": "The entry is `null` until a call answers. A call that fails leaves the entry's last value and is reported to the console, and the answer to a call whose arguments have since changed is dropped. Both tiers behave this way."
- `server.md`:
  - §2's `jx dev` list gains step 4: "Answers `POST /_jx/server/<export>` for every entry the last build collected, calling the export as `fn(args, env)` with `env` built as for the extension mounts (§3), and answering as the site worker does: the return value as JSON, `{ ok: false, error }` with status 500 when it throws, 404 for an export the build did not collect (compiler.md §6.3)."
  - §3's item 4 notes that a `/_jx/server/*` path no mount owns falls through to that middleware.
- `site-architecture.md`:
  - §15.4's last paragraph: "it dispatches to the same mount handlers directly" gains "and answers the server-function routes for the entries the build collected (server.md §2)".
  - §15's marker clause "and are proxied in development by `server.md` §3.3" becomes "and are answered in development by `jx dev` on a site project (server.md §2) or through the proxy in an interpreting host (server.md §3.3)". Its per-route clause is `plan:_shared/no-adapter-server-tier`'s.
- Fragments:
  - `bun run spec:change spec.md minor -m "§11.4: a built page calls its server entries over HTTP at the site worker route, and jx dev on a site project answers the same route"`
  - `bun run spec:change server.md minor -m "§2: jx dev on a site project answers the server-function routes the build collected, as the site worker does"`
  - `bun run spec:change site-architecture.md minor -m "§15 and §15.4: jx dev stands in for the worker's server-function routes as it does for its mounts"`
- Docs:
  - `docs/framework/concepts/timing.md` (`spec:` `spec.md#11.4`): "How it works" adds that `jx dev` answers the route on a site project, with `.dev.vars` in `env`.
  - `docs/framework/build/dev-server.md` (`code:` `resolve.ts`): the "Server functions" subsection gains a paragraph: on a site project the built pages call `/_jx/server/<export>` as the deployed site does, and the dev server answers from the entries the last build collected.
  - `docs/extending/embedding/dev-server.md` (`code:` `resolve.ts`): one sentence after the route list says that `jx dev` passes a middleware (step 6) answering those routes.

Neither spec graduates: `compiler.md` and `spec.md` keep other open items.

## Acceptance

- The three workspace suites pass at their thresholds, and `bun scripts/check-coverage-manifest.ts` passes for `packages/compiler`, `packages/runtime` and `packages/server`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass. After CSC1.1, `bun run plans:status --spec compiler` no longer lists §6.1; after CSC1.2, `--spec spec` no longer lists §11.4.
- Observable: take a scratch site with `build.adapter: "bun"`, `url: "https://x.dev/m/site/"` and a page entry `loadData` whose function returns `{ n: 1 }`, rendered through `${state.loadData?.n}`.
  - `bunx jx build`, then `grep -r "/m/site/_jx/server/loadData" dist` finds the page module and `dist/worker.js`.
  - Under `jx dev`, the page shows `1` and the network panel shows the POST answered 200.
  - Make the function throw: the page keeps its value and the console names `loadData`.

## Slices

| Slice  | Scope                                                                                                                                      | Claims          | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ----- |
| CSC1.1 | `emitServerCall` and its helper, both targets, runtime-only prerender, `serverBaseUrl` threading, `compileRef` export, `buildRoute` `null` | compiler.md#6.1 | open  |
| CSC1.2 | `serverEntries` on the build result, `callServerExport`, the `jx dev` middleware, the §11.4 rewrite                                        | spec.md#11.4    | open  |
