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
  - packages/server
size: L
---

# A built page calls its `timing: "server"` entries at the site worker's route, and `jx dev` answers that route

## Context

Two census stubs merged here, one from each spec, because both specify the same `POST <base>/_jx/server/<export>` call from `compile-client.ts` and `compile-element.ts`. The stub also carried the proxy-first change to interpreting hosts. Detailing split that half out as `plan:_shared/compiled-server-call-proxy-first`, an enabling plan this one requires: it touches the runtime alone, needs neither compiler prerequisite, and closes a source-delivery gap that should not wait for them. It rewrites §11.4's dev-boundary passages in place; the section stays Partial and stays this plan's.

`specs/compiler.md` §6.1, line 389 (unmarked before the census; §3's "Server function" row, line 71, points here):

> **Status: Partial.** The server-side artifact is emitted (§6.2, §6.3). The client side is not: no target emits the `POST /_jx/server/$export` fetch, the signal holding its response or the effect around reactive `arguments`, because `compile-client.ts` and `compile-element.ts` serialise the entry into reactive state as a literal object. Only the interpreted runtime calls a server function, in process or through the dev-server proxy (`/__jx_server__`; `resolveServerFunction` in `packages/runtime/src/runtime.ts`), and nothing requests `/_jx/server/*`.

`specs/spec.md` §11.4, line 1240, the leading marker, which opens "**Status: Partial.** The server half ships for a component's entries" and names three gaps: a page's own entry reaches no route that loads (with or without an adapter); "The browser half does not ship in a built site … That includes `jx dev` on a site project, which serves the compiled pages (§16.7)"; and interpreting hosts try a browser `import()` first. The same section carries `> **Status: Partial (dev boundary).**` (line 1297) and a trailing `> **Status: Implemented.**` note (line 1303) that still says the compiler "emits per-route Hono handlers (`compileServer`)".

**What exists** (verified 2026-09-27)

- No client call. `compileClient` sends a server entry to its "Plain object" fallthrough (`stateEntries.push([key, def])`), and `extractInitialValue` in `compile-element.ts` returns `JSON.stringify(def)`. `_jx/server` appears in no source file but `compile-server.ts`.
- Prerender reads the definition object. `buildInitialScope` (`packages/compiler/src/shared.ts`) stores any object with no `$prototype`, no `default` and no schema-only shape as a plain value (line 561), so a template reading a server entry is evaluated against `{ $src, $export, timing }`. A `Request` entry is marked runtime-only instead.
- The shape to mirror: `emitRequestFetch` in `shared.ts` (an `effect()`, `statePrefix`, and `collect` so the element target's `disconnectedCallback` can `stop()` it). The element target emits it in `connectedCallback` after the three prop merges.
- `$ref` lowering: `compileRef` in `packages/runtime/src/expression.ts` (not exported) is the canonical table for `#/state/`, `parent#/`, `window#/`, `document#/`, `$map/`, `event#/`, `$args/` and `$reduce/`. `compileOperandSource({ $ref }, { statePrefix })`, exported from `@jxsuite/runtime/expression` and already re-exported by `shared.ts`, returns exactly its lowering. `refToExpr` in `compile-element.ts` restates part of it.
- The route (`buildRoute` in `packages/compiler/src/targets/compile-server.ts`): `POST <baseUrl>/<export>`, body parsed with `.catch(() => ({}))`, `c.json(await fn(args, c.env))`, a throw answered `{ ok: false, error }` with status 500. An unknown export is Hono's 404, and `c.json(undefined)` sends an empty body. `compileSiteServer` registers under `withBase(base, baseUrl ?? "/_jx/server")`.
- The base never reaches a module. `rewriteHtmlBase` (`packages/compiler/src/site/base-path.ts`) re-roots finished HTML only, so an absolute path inside emitted JS is not rewritten. `site-architecture.md` §14.7 makes that the rule on purpose and tables every other output that carries the base; `sw.js`, the one JS output there, is handed `basePath` when it is built. `siteBasePath(projectConfig.url)` is computed in `compilePage` and in `buildSite`, after step 5 compiles the components.
- The emitters: `compile()` (`packages/compiler/src/compiler.ts`) routes to `compileClient`, and to `emitElementModule` for a hyphenated root (line 127); `compileElement` calls `emitElementModule` at line 162. Route 1, `compileStaticPage`, never sees a server entry: `isDynamic` (`shared.ts`) is true for any object state entry that is not schema-only or `timing: "compiler"` and recurses into children, so a document declaring one takes route 2 or 3.
- `jx dev` on a site project: `startDev` (`packages/server/src/dev.ts`) builds with `buildSite` and serves `dist/` through `createDistMiddleware`. `server.ts` strips the deployment base, applies the loopback Origin/Host gate to `/_jx/*`, and sends it to `handleJxMounts`, which returns `null` for a path no mount owns, so the request falls through to `middleware`. Nothing answers `/_jx/server/<export>`, and `buildSite` returns only `{ errors, files, routes }`.
- The other hosts that serve `dist/` answer no `/_jx/*` route, mounts included: Studio's Build opens it on a second origin (`startSitePreview` in `packages/server/src/site-preview.ts`, from `studio-api.ts` and the desktop's `project-session.ts`), which by design "carries none of the editor's privileged routes", and `jx preview` (`packages/compiler/src/site/preview-server.ts`) is a static server.
- `handleServerFunction` (`packages/server/src/resolve.ts`): resolves `$src` as a path under the root (with `$base`), `isImportable` containment (403), `import()` (plain-text 500), the export lookup (plain-text 500), `fn(args, process.env)`, `Response.json(result ?? null)`, and a throw as `problem("internalError", …)`. A bare specifier resolves only in `handleResolve`, through `createRequire` from the project's `package.json`.
- Tests: `compile-client.test.ts` ("compileClient — prototypes"), `compile-element.test.ts` ("compileElement — Request auto-fetch", line 1403), `compile-element-render.test.ts` (loads an emitted module in happy-dom), `shared.test.ts`, `compile-server.test.ts`, `site-build.test.ts` ("buildSite — server worker", whose portability case imports the bundled worker and POSTs to it), `packages/server/tests/dev.test.ts` ("startDev").

**Prerequisites** (each checked against its current text)

- `plan:_shared/page-server-entries`: until it lands, a page's or layout's entry has no worker route (step 5b walks `componentDefs` only), so a compiled page's call would 404. Its step 6c `serverEntries` (from `dedupeServerEntries`, each `src` `./`-project-relative or a bare specifier as written) is the list the `jx dev` route answers from; its integration contract leaves returning it from `buildSite` to this plan.
- `plan:_shared/no-adapter-server-tier`: makes an adapter mandatory for any server entry and retires the per-page `_server.js`, so the compiled call has one target, the site worker. It rewrites §6.1's item 2, §11.4's no-adapter sentence (line 1295) and the trailing note's `compileServer` clause.
- `plan:_shared/compiled-server-call-proxy-first`: §11.4 cannot say Implemented while an interpreting host imports a server module in the browser. If its Open is accepted it also exports `projectDevEnv`, which CSC1.2 reuses.

**Related, no edge.** `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` rewrite the same `connectedCallback`. The server calls go last, after the `Request` fetches, and read `this.state` inside an effect, so props those plans deliver later reach a reactive argument without further change. `plan:spec/compiled-request-fetch` adds abort to the `Request` fetch; this plan uses no abort. `plan:compiler/client-external-class-hydration` rewrites the §3 marker sentence this plan deletes (see Specs & docs). `plan:compiler/superseded-ledger-rows` deletes `compileStaticPage`'s island branch, which this plan does not touch. `plan:spec/timing-values-in-built-sites` requires this plan for §11.3's `"server"` cell.

## Outcome

- `compiler.md` §6.1 → Implemented (CSC1.1). §3's "Server function" row then holds; §3 stays Partial for its external-class rows.
- `spec.md` §11.4 → Implemented (CSC1.2), with one leading marker, both Partial markers gone and the trailing note folded in.
- Ride-alongs made true: `compiler.md` §4.1's `connectedCallback` paragraph, `site-architecture.md` §14.7's table (CSC1.1), `server.md` §2 and §3, and `site-architecture.md` §15 and §15.4 (CSC1.2).

## Decisions

- **Decided:** one emitter, `emitServerCall` in `shared.ts` beside `emitRequestFetch`, serves both targets, and a module-level helper is emitted once per module (`serverCallHelperSource()`, the `attrHelperSource()` pattern). The targets once diverged over `Request` (`emitRequestFetch`'s own comment says so), and one helper keeps the response rule in one place.
- **Decided:** the route prefix is baked in at compile time through a `serverBaseUrl` option (default `"/_jx/server"`). The site build computes it once with a new `serverRoutePrefix(base)` export of `compile-server.ts`, which `compileSiteServer` also uses, so the route and its caller cannot disagree. No pass rewrites a module, and a module-relative URL would need each page's route depth, which is also compile-time knowledge. `site-architecture.md` §14.7's table gains the row, as `sw.js` has one.
- **Decided:** a `$ref` argument lowers through the runtime's own table, as `compileOperandSource({ $ref: ref }, { statePrefix })`, with no new runtime export. `#/state/`, `parent#/`, `window#/`, `document#/` and a bare pointer are accepted. `$map/`, `event#/`, `$args/` and `$reduce/` fail the compile, naming the entry and the ref, because a state entry has no loop, event or formula scope and the lowering would name an undeclared identifier. Only top-level `arguments` values are refs, as in the interpreter (`resolveArgs` inside `resolveServerFunctionViaProxy`).
- **Decided:** an entry with a `$ref` argument calls from an `effect()`; one with none calls once, at module evaluation for a page and in `connectedCallback` for an element, which §6.1 item 1 will state. A superseded call's answer is dropped by a per-entry sequence number rather than an `AbortController`: aborting a POST does not stop the function on the server, and the guard sets no `@vue/reactivity` version floor. The enabling plan gives the proxy path the same guard.
- **Open:** what a failed call leaves in state. Recommendation: the entry keeps its last value (`null` before the first success), a non-2xx answer is never stored, and the error goes to `console.error` naming the export. That is what the interpreter's proxy path does today (`resolveServerFunctionViaProxy`), which after the enabling plan is the only path an interpreting host takes for a module it did not register, so the tiers agree. Storing `{ error }`, as the compiled `Request` does, would make a failure indistinguishable from a function that returns an `error` field.
- **Decided:** `jx dev` answers the route from a middleware in `dev.ts` fed by the entries the last build collected, not by loading `dist/worker.js`. The bundle targets the adapter's runtime (a Cloudflare worker expects `ASSETS` and workerd), and loading it would run the production mounts beside `handleJxMounts`' dev stand-ins. `env` is built as the mounts build it (`process.env` under `.dev.vars`, plus `JX_PROJECT_ROOT`), because the route stands in for the worker exactly as they do (`site-architecture.md` §15.4).
- **Decided:** the middleware resolves each entry as the worker bundle does, from the project root: a `./` path against the root, any other specifier through `createRequire` from the project's `package.json` (the resolution `handleResolve` gives a bare `$src`). It applies no containment check, because the module path comes from the build, never from the request; containment stays in `handleServerFunction`, where the request names the module. A bare specifier resolved into a hoisted `node_modules` above the root would otherwise be refused.
- **Decided, out of scope:** an edited server module takes effect after a restart, as through the proxy today (Bun caches the import). `jx preview` and Studio's Build preview (`site-preview.ts`) stay static servers of `dist/` that answer no `/_jx/*` route, mounts included; a built page there leaves each entry `null` and logs the failed call.

## Implementation

### CSC1.1: the compiled call (`packages/compiler`)

1. `packages/compiler/src/shared.ts`:
   - `export const SERVER_CALL_HELPER = "__jxServerCall"` and `serverCallHelperSource()`. The helper posts `JSON.stringify(args)` with `Content-Type: application/json`, reads the body as text, parses it when non-empty (an empty body is `null`), and on a non-2xx rejects with the parsed body's `error`, else the text, else `statusText`.
   - `emitServerCall(key, def, { statePrefix = "state", indent = "", collect, serverBaseUrl = "/_jx/server" })`. The URL is the JSON-quoted `` `${serverBaseUrl}/${def.$export}` ``. The arguments literal writes each key with `objectKey` (`@jxsuite/runtime/pointer`) and each value with `JSON.stringify`, or, for a `{ $ref }`, with `compileOperandSource({ $ref }, { statePrefix })` after the scheme check. With no ref it emits one call. With a ref it emits a block holding `let _jxSeqN = 0` (N counts entries in the module) around an `effect()`, pushed onto `collect` when given. `.then` writes `refAccessor(statePrefix, escapeToken(key))` only when its sequence is current, and `.catch` calls `console.error("Jx server function <export>:", e)` under the same guard.
   - `buildInitialScope`: in the first loop's object branch, before the plain-object fallthrough (line 561), `isServerFnDef(d)` adds the key to `runtimeOnly` and stores no value.
2. `packages/compiler/src/targets/compile-client.ts`:
   - `compileClient` takes `serverBaseUrl` and gets an `isServerFnDef(def)` branch before "Plain object", which pushes `[key, null]` onto `stateEntries` and `emitServerCall(key, def, { serverBaseUrl })` onto a new `serverCalls` list.
   - `emitClientModule` takes that list and emits `serverCallHelperSource()` and the blocks after the computed block and before `bind`, so a ref to a computed reads its value on the first run.
3. `packages/compiler/src/targets/compile-element.ts`:
   - `extractInitialValue` returns `"null"` for a server entry.
   - `emitElementModule` gains a trailing `serverBaseUrl = "/_jx/server"` parameter. When any entry is a server entry, it emits the helper once after `attrHelperSource()`, and each call in `connectedCallback` after the `Request` fetches with `{ collect: "this.#effects", indent: "    ", statePrefix: "this.state" }`, so the existing `stop()` loop in `disconnectedCallback` ends it.
   - `CompileElementOptions.serverBaseUrl` reaches `emitElementModule` from `processElement`, so `$elements` dependencies get it too.
4. `packages/compiler/src/compiler.ts`: `CompileOptions.serverBaseUrl`, handed to `compileClient` (route 3) and to route 2's `emitElementModule`.
5. `packages/compiler/src/targets/compile-server.ts`:
   - `export function serverRoutePrefix(base: string, baseUrl = "/_jx/server")` returns `withBase(base, baseUrl)`, and `compileSiteServer` calls it.
   - `buildRoute` emits `c.json((await <export>(args, c.env)) ?? null)`, so the route, the dev proxy and the `jx dev` route all answer `null` for `undefined`.
6. `packages/compiler/src/site/site-build.ts`: `buildSite` computes `serverRoutePrefix(siteBasePath(projectConfig.url))` before step 5 and passes it to `compileElement`. `compilePage` derives the same value beside its `basePath` and passes it to `compile()`, leaving its parameter list unchanged.

### CSC1.2: the `jx dev` route and the §11.4 flip (`packages/compiler`, `packages/server`)

1. `buildSite` returns `serverEntries: { exportName: string; src: string }[]`: step 6c's deduplicated `serverEntries` as `plan:_shared/page-server-entries` leaves them (the list handed to `compileSiteServer`, each `src` as the worker imports it), or `[]` when there is no adapter. Declare it before step 6c so the no-adapter return carries `[]`.
2. `packages/server/src/resolve.ts`: extract `callServerExport(modulePath, exportName, args, env)` from `handleServerFunction`: `import()`, the export lookup (`mod[x] ?? mod.default?.[x]`) and the call. It returns `{ ok: true, value }` or `{ ok: false, stage: "import" | "export" | "call", message }`. `handleServerFunction` keeps its resolution and `isImportable` check in front, and maps each stage exactly as today (plain-text 500 for `import` and `export`, `problem("internalError", …)` for `call`).
3. `packages/server/src/dev.ts`:
   - `export function createServerFunctionMiddleware(root, entries: () => readonly { exportName: string; src: string }[])` answers `POST /_jx/server/<name>` and returns `null` for anything else.
   - The module path is `resolve(root, src)` for a `./` or `../` src, else `createRequire(resolve(root, "package.json")).resolve(src)`; a resolution failure answers 500 `{ ok: false, error }`.
   - An unknown name is a 404. The body is read with `req.json().catch(() => ({}))`, and `env` comes from `projectDevEnv(root)` in `dev-vars.ts` (extract it from `buildRuntime` in `jx-mounts.ts` if the enabling plan did not).
   - It answers `Response.json(value ?? null)`, or `Response.json({ ok: false, error: message }, { status: 500 })` for any failed stage, as `buildRoute` does.
   - `startDev` keeps the last `result.serverEntries` from `rebuild()` and passes `createDevServer` one `middleware` that tries this middleware, then `createDistMiddleware`. The request has already passed `server.ts`'s base strip and Origin/Host gate.

**Integration contract.** Once this lands:

- A compiled page or element module holds `null` for each `timing: "server"` entry and replaces it with the parsed JSON answer of `POST <base>/_jx/server/<export>`, whose body is the resolved `arguments`. It re-calls from an effect when a top-level argument is a `$ref`, drops superseded answers, and on failure keeps the last value and logs.
- Exports: `emitServerCall`, `serverCallHelperSource` and `SERVER_CALL_HELPER` (`shared.ts`); `serverRoutePrefix` (`compile-server.ts`); `CompileOptions.serverBaseUrl` and `CompileElementOptions.serverBaseUrl`; `serverEntries` on `buildSite`'s result; `callServerExport` (`@jxsuite/server/resolve`); `createServerFunctionMiddleware` (`@jxsuite/server/dev`).
- `jx dev` on a site project with an adapter answers every collected export at the bare and the based path.
- `plan:spec/timing-values-in-built-sites` may flip §11.3's `"server"` cell.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` (`lines = 0.982, functions = 0.98`) and `packages/server` (`0.96`, `0.95`), with `bun scripts/check-coverage-manifest.ts` for each. No source file is added, so the manifest has nothing new. Ratchet any workspace whose worst file rises.

CSC1.1:

- `compile-client.test.ts`, new `describe("compileClient — timing server entries")`:
  - "posts literal arguments once": `arguments: { filter: "active" }` emits one `__jxServerCall("/_jx/server/fetchMetrics", { filter: "active" })` outside any `effect(`, and state holds `metrics: null`.
  - "a $ref argument calls from an effect emitted after the computed block".
  - "serverBaseUrl prefixes the route".
  - "a $map ref in arguments fails naming the entry".
  - "a non-identifier argument key is quoted".
  - "the helper is emitted once for two entries, and not at all without one".
- `compile-element.test.ts`, new `describe("compileElement — timing server entries")`:
  - "calls in connectedCallback after the props merge and the Request fetches, collecting the effect".
  - "extractInitialValue initialises the entry to null".
  - "a parent#/ argument reads this.state, and a window#/ argument reads window".
- `compile-element-render.test.ts`, the element loaded in happy-dom with a stubbed `fetch`:
  - "posts the arguments and renders the answer".
  - "a 500 with { ok: false, error } keeps the rendered value and calls console.error".
  - "a changed $ref prop re-posts, and a late answer to the first call is dropped": the second fetch resolves before the first.
  - "disconnect stops the effect".
- `shared.test.ts`: "buildInitialScope leaves a server entry runtime-only", where a template reading it is not baked.
- `compile-server.test.ts`: "buildRoute answers null for an undefined return"; "serverRoutePrefix re-roots under the base, and compileSiteServer registers there".
- `site-build.test.ts`, in "buildSite — server worker", on a fixture with `url: "https://x.dev/m/site/"`, a page entry and a component entry:
  - both the page's `app.js` and `dist/components/<tag>.js` name `/m/site/_jx/server/<export>`.
  - the bundled worker, imported by the portability case's pattern, answers a POST to that path with the function's value.
  - the component module loaded in happy-dom, with `fetch` routed to the worker's `fetch`, renders that value.

CSC1.2:

- `packages/server/tests/dev.test.ts`, new `describe("createServerFunctionMiddleware")`:
  - "answers a collected export with its value, env carrying a .dev.vars key".
  - "resolves a bare-specifier entry from the project's node_modules" (a fixture package under the temp project's `node_modules`).
  - "404 for an unknown export".
  - "a throw answers { ok: false, error } with status 500".
  - "ignores GET and paths outside /_jx/server/".
- In `describe("startDev")`: "an adapter site answers POST /_jx/server/<export> at the bare and the based path".
- The existing `handleServerFunction` cases in `resolve.test.ts` and `resolve-gaps.test.ts` pin the refactor unchanged, including the 403 for an escaping `$src`.

## Specs & docs

**CSC1.1**

- `compiler.md` §6.1:
  - Replace the marker with:

    > **Status: Implemented.** Both targets emit the call (`emitServerCall` in `packages/compiler/src/shared.ts`), and the site worker serves it (§6.3).

  - Item 1 becomes: "**Client-side:** a `POST` to `<base>/_jx/server/$export`, `<base>` being the deployment base (site-architecture.md §14.7), whose JSON body is the entry's `arguments` with each top-level `$ref` resolved (`#/state/`, `parent#/`, `window#/`, `document#/`; any other scheme fails the compile). The entry is `null` until a call answers and then holds the parsed response. When an argument is a `$ref` the call runs in an effect, so a change calls again and the answer to a superseded call is dropped. A non-2xx answer is not stored: the entry keeps its last value and the error is logged to the console. A page calls when its module loads, and an element calls in `connectedCallback`, after its props are merged, and stops on disconnect."
  - Item 2, as `plan:_shared/no-adapter-server-tier` leaves it, becomes: "**Server-side:** a route in the site worker (§6.3) that imports `$export` from `$src`, registered at `<base>/_jx/server/$export`, and answers the function's return value as JSON (`null` for `undefined`), or `{ ok: false, error }` with status 500 when it throws."
- `compiler.md` §4.1: the `Request` paragraph gains "A `timing: "server"` entry is initialised the same way and calls its route from `connectedCallback` after the `Request` fetches, its effect joining the same registry (§6.1)."
- `compiler.md` §3's marker: delete the §6.1 sentence in whichever form stands ("The server-function row's missing client fetch is marked on §6.1.", or `plan:compiler/client-external-class-hydration`'s "The server-function row's client half is specified, and marked, on §6.1."). The section stays that plan's.
- `site-architecture.md` §14.7's table gains, after `manifest.webmanifest`: "Page and component modules" | "A `timing: "server"` entry's call is a request path (compiler.md §6.1), and no pass rewrites a module, so the build gives the call its base when it compiles the module".
- Fragments:
  - `bun run spec:change compiler.md minor -m "§6.1 and §4.1: both compile targets emit the server-function call, a POST to the based /_jx/server route carrying the resolved arguments, re-run from an effect when an argument is a reference"`
  - `bun run spec:change site-architecture.md minor -m "§14.7: a compiled page or component module carries the deployment base in its server-function URL, set when the module is compiled"`
- Docs, from `docs:sync`:
  - `docs/framework/build.md` (`code:` `compile-client.ts`, `shared.ts`, `site-build.ts`): the "Dynamic pages" paragraph gains "and one `POST` to the site's worker for each `timing: "server"` entry". Its line 133 belongs to `plan:_shared/no-adapter-server-tier`.
  - `docs/framework/site/deployment.md` (`spec:` `site-architecture.md#14.7`): the "Serving from a subfolder" list, after the "`_routes.json` and the worker's own routes" `plan:_shared/page-server-entries` adds, gains "the calls a page makes to its server functions".
  - `docs/framework/concepts/timing.md` (`spec:` `compiler.md#6`): "How it works" states the call as item 1 above, in docs prose with no em dash.
  - The concept pages whose `code:` lists `compile-element.ts` or `compile-client.ts` (`functions.md`, `components.md`, `lists.md`) describe no server entry and do not change. `functions.md`'s line 167 and `docs/framework/agents/authoring-rules.md`'s line 365 become true as written.

**CSC1.2**

- `spec.md` §11.4:
  - Replace the leading marker with:

    > **Status: Implemented.** A built page's module calls each entry at `<base>/_jx/server/<export>` (compiler.md §6.1); the site worker serves every entry a page, its layouts, `project.json` or a component declares (compiler.md §6.3); `jx dev` answers the same route on a site project (server.md §2); and an interpreting host calls only the `/__jx_server__` proxy (server.md §3.3), unless the host registered the module itself (embedding.md §6).

  - Delete the trailing note at line 1303.
  - Append to "Arguments": "The entry is `null` until a call answers. A call that fails leaves the entry's last value and is reported to the console, and the answer to a call whose arguments have since changed is dropped. The compiled call and the interpreter's proxy call both behave this way."
- `server.md`:
  - §2's `jx dev` list gains step 4: "Answers `POST /_jx/server/<export>` for every entry the last build collected, calling the export as `fn(args, env)` with `env` built as for the extension mounts (§3), and answering as the site worker does: the return value as JSON, `{ ok: false, error }` with status 500 when it throws, 404 for an export the build did not collect (compiler.md §6.3)." The sentence after the list names `createServerFunctionMiddleware` among the exports.
  - §3's item 4 notes that a `/_jx/server/*` path no mount owns falls through to that middleware (item 6).
- `site-architecture.md`:
  - §15.4's last paragraph: "it dispatches to the same mount handlers directly" gains "and answers the server-function routes for the entries the build collected (server.md §2)".
  - §15's marker clause "and are proxied in development by `server.md` §3.3" becomes "and are answered in development by `jx dev` on a site project (server.md §2) or through the proxy in an interpreting host (server.md §3.3)". Its per-route clause is `plan:_shared/no-adapter-server-tier`'s.
- Fragments:
  - `bun run spec:change spec.md minor -m "§11.4: a built page calls its server entries over HTTP at the site worker route, and jx dev on a site project answers the same route"`
  - `bun run spec:change server.md minor -m "§2: jx dev on a site project answers the server-function routes the build collected, as the site worker does"`
  - `bun run spec:change site-architecture.md minor -m "§15 and §15.4: jx dev stands in for the worker's server-function routes as it does for its mounts"`
- Docs:
  - `docs/framework/concepts/timing.md` (`spec:` `spec.md#11.4`): "How it works" adds that `jx dev` answers the route on a site project, with `.dev.vars` in `env`.
  - `docs/framework/build/dev-server.md` (`spec:` `server.md#2`, `code:` `resolve.ts`): the "Server functions" subsection gains a paragraph: on a site project the built pages call `/_jx/server/<export>` as the deployed site does, and the dev server answers from the entries the last build collected.
  - `docs/extending/embedding/dev-server.md` (`code:` `resolve.ts`): one sentence after the route list says that `jx dev` passes a middleware (step 6) answering those routes.

Neither spec graduates: `compiler.md` and `spec.md` keep other open items.

## Acceptance

- The `packages/compiler` and `packages/server` suites pass at their thresholds, and `bun scripts/check-coverage-manifest.ts` passes for both.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass. After CSC1.1, `bun run plans:status --spec compiler` no longer lists §6.1; after CSC1.2, `--spec spec` no longer lists §11.4.
- Observable: take a scratch site with `build.adapter: "bun"`, `url: "https://x.dev/m/site/"` and a page entry `loadData` whose function returns `{ n: 1 }`, rendered through `${state.loadData?.n}`.
  - `bunx jx build`, then `grep -rl "/m/site/_jx/server/loadData" dist` finds the page's `app.js` and `dist/worker.js`, and `dist/index.html` holds no baked value for it.
  - Under `jx dev`, the page at `/m/site/` shows `1` and the network panel shows the POST answered 200.
  - Make the function throw: the page keeps its value and the console names `loadData`.

## Slices

CSC1.2 lands in the same pull request as CSC1.1 or directly after it: in between, a compiled page under `jx dev` posts to a route nothing answers, and the entry stays `null` where it used to show its definition object.

| Slice  | Scope                                                                                                                            | Claims          | State |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----- |
| CSC1.1 | `emitServerCall` and its helper, both targets, runtime-only prerender, `serverBaseUrl` threading, `buildRoute` `null`, §14.7 row | compiler.md#6.1 | open  |
| CSC1.2 | `serverEntries` on the build result, `callServerExport`, the `jx dev` middleware, the §11.4 rewrite                              | spec.md#11.4    | open  |
