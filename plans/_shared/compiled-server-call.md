---
status: stub
disposition: implement
claims:
  - compiler.md#6.1
  - spec.md#11.4
requires:
  - _shared/page-server-entries
  - _shared/no-adapter-server-tier
size: L
workspaces:
  - packages/compiler
  - packages/runtime
  - packages/server
---

# A built page calls its `timing: "server"` entries over HTTP, and an interpreting host calls them only through the proxy

## Context

Two census stubs merged here, one from each spec, because both specify the same `POST <base>/_jx/server/<export>` fetch in `compile-client.ts` and `compile-element.ts`. The `spec.md` stub also carried the proxy-first change to interpreting hosts (`packages/runtime`, `packages/server`), which comes along as its own slice.

`specs/compiler.md` §6.1, line 389 (the section was unmarked before the census, and §3's "Server function" row, line 71, points at it):

> **Status: Partial.** The server-side artifact is emitted (§6.2, §6.3). The client side is not: no target emits the `POST /_jx/server/$export` fetch, the signal holding its response or the effect around reactive `arguments`, because `compile-client.ts` and `compile-element.ts` serialise the entry into reactive state as a literal object. Only the interpreted runtime calls a server function, in process or through the dev-server proxy (`/__jx_server__`; `resolveServerFunction` in `packages/runtime/src/runtime.ts`), and nothing requests `/_jx/server/*`.

Confirmed by the auditor compiling a page with a server entry: the module holds `metrics: {"timing":"server",...}` as plain state and contains no fetch.

`specs/spec.md` §11.4, line 1240:

> **Status: Partial.** The server half ships for a component's entries: `compileServer` and `compileSiteServer` (`packages/compiler/src/targets/compile-server.ts`) emit the route and call the function with `(args, env)`, and the dev server's `/__jx_server__` proxy does the same (`packages/server/src/resolve.ts`). A page's own entry gets no route that loads: with no adapter, the per-page `_server.js` is emitted beside the page in `dist/` but imports its `$src` as written, relative to the source page, and the build neither copies nor bundles that module (compiler.md §6.2); with `build.adapter` set, the site build collects entries from components alone and skips the per-page `_server.js`, so a page entry is dropped (`packages/compiler/src/site/site-build.ts`, site-architecture.md §14.1.1), although Site-Wide Bundling below says pages are collected. The browser half does not ship in a built site: `compile-client.ts` treats a `timing: "server"` entry as plain reactive state and emits no fetch, `compile-element.ts` has no server-entry handling, and a built site ships no `@jxsuite/runtime`, so nothing calls the route. That includes `jx dev` on a site project, which serves the compiled pages (§16.7). In an interpreting host (Studio's live preview and canvas, or `jx dev` on a root without a `project.json`) the runtime tries a browser `import()` first (Security Boundary, below).

And the dev-boundary marker in the same section, line 1297:

> **Status: Partial (dev boundary).** In an interpreting host (Studio's live preview and canvas, or `jx dev` on a root without a `project.json`), the interpreting runtime currently attempts a browser-side `import()` of the `$src` module before falling back to the `/__jx_server__` proxy. A `*.server.js` that is browser-loadable therefore has its **source delivered to the client** there — so do not embed secrets in the module body; read them from `env` inside the function, which only the proxy (and the compiled worker) provides. The compiled deployment does not have this gap. Making the interpreting path proxy-first is a tracked follow-up.

The section's trailing `> **Status: Implemented.**` note (line 1303) is not an open item, but it says the compiler "emits per-route Hono handlers (`compileServer`)", the path `plan:_shared/no-adapter-server-tier` retires, so it is rewritten when this section flips. The `"server"` cell of §11.3 (line 1233) belongs to `plan:spec/timing-values-in-built-sites`, which requires this plan.

**Disposition.** `implement`, as both stubs had it. The server half and its wire contract ship, `compiler.md` §6.1 item 1 specifies the client half exactly, nothing in the code contradicts it, and `emitRequestFetch` is a working shape to reuse. Size `L`: two compile targets, the runtime, a dev-server route and three markers across two specs. Detailing splits it into two slices, the compiled call (with its `jx dev` route) and proxy-first interpreting hosts.

**What exists**

- The server half: `buildRoute`, `compileServer` and `compileSiteServer` in `packages/compiler/src/targets/compile-server.ts`, a `POST` at `<base>/_jx/server/<export>` calling `fn(args, c.env)` and answering a throw with `{ ok: false, error }` and status 500. Only `compileSiteServer` applies the deployment base (`withBase`); `compileServer` registers the bare path. `buildSite` (`packages/compiler/src/site/site-build.ts`) dedupes entries by export name; `packages/compiler/tests/compile-server.test.ts` and `site-build.test.ts` cover the worker.
- No client half. `compile-client.ts` serialises the entry into reactive state as a literal object, and `compile-element.ts` has no server-entry handling. Verified: a compiled `app.js` holds `metrics: {"$src":…,"timing":"server"}` as plain state and contains no fetch, and `packages/compiler/src/site/client-runtime.ts` ships only `@vue/reactivity` and `lit-html`. A search for `_jx/server` outside the compiler's server target and its tests finds nothing.
- `emitRequestFetch` in `packages/compiler/src/shared.ts`: the compiled `Request` fetch inside an `effect()`, the nearest existing shape to reuse. `collectServerEntries` in the same file. The deployment base: `packages/compiler/src/site/base-path.ts` (`site-architecture.md` §14.7).
- The interpreter's call: `resolveServerFunction` in `packages/runtime/src/runtime.ts` takes the module cache or a host-seeded loader (`seededModule`) first, then a browser `import()` of `$src` (retried against `base`), and falls back to `resolveServerFunctionViaProxy`, a `POST` to `/__jx_server__` with `$src`, `$export`, `$base` and `arguments`, only when the import fails. Both resolve reactive `$ref` arguments.
- The proxy: `handleServerFunction` in `packages/server/src/resolve.ts` calls `fn(args, process.env)`. It is served by the dev server (`packages/server/src/server.ts`), Studio's live preview (`packages/server/src/live-preview.ts`) and the desktop's project server (`packages/server/src/project-server.ts`).
- `startDev` in `packages/server/src/dev.ts`: a root with `project.json` is built with `buildSite` and served from `dist/`, so `jx dev` on a site project interprets nothing. Its `/_jx/` branch dispatches only extension mounts (`handleJxMounts` in `packages/server/src/jx-mounts.ts`); nothing in `packages/server` answers `/_jx/server/<export>`, so a compiled call served by `jx dev` has no route to reach.
- A page's own entry has no route that loads today, with or without an adapter (the §11.4 marker above). A reviewer's scratch site with adapter `bun` and a page-level `loadData` entry produced a `dist/worker.js` with no `loadData`; with no adapter, `dist/_server.js` imported a `./api.server.js` that `dist/` did not contain. Both are prerequisites, below.

**What is missing**

1. The compiled client call, in the client and element targets: per server entry, a `POST` to `<base>/_jx/server/<export>` with the resolved `arguments` as the JSON body, the response stored on the state entry, re-run from an `effect()` when any `arguments` value is a `$ref`, and the `{ ok: false, error }` shape surfaced rather than stored as data.
2. A route for that call under `jx dev` on a site project, which serves the compiled pages: the dev server's `/_jx/` branch dispatching `/_jx/server/<export>` to the same function, as it already stands in for the worker's mounts (`site-architecture.md` §15.4), or serving the built worker.
3. Proxy-first in interpreting hosts (Studio's live preview and canvas, `jx dev` on a root without `project.json`, `mount()`): the runtime never imports a `timing: "server"` module in the browser, so the function always runs server-side with `env` and its source is never delivered. The dev-boundary marker then closes.
4. A page's own entries reach a route. Under an adapter that is `plan:_shared/page-server-entries`; without one, `plan:_shared/no-adapter-server-tier` decides, and its disposition makes an adapter mandatory for any server entry. Its pull request rewrites, in place, the Security Boundary's "with no adapter" sentence (line 1295), the matching clause of the leading marker, and the trailing note's "per-route Hono handlers", while this section stays Partial and stays this plan's. Both are required here rather than done again.
5. Tests: `compile-client.test.ts` and `compile-element.test.ts` for the emitted call; a site-build test that serves the worker and loads the page; the `jx dev` route; the runtime's proxy-first path.
6. Both §11.4 Partial markers flip together. `compiler.md` §3's "Server function" row then holds, and §11.3's `"server"` cell is handed to its owner.
7. Docs: `docs/framework/concepts/timing.md` says the boundary "is enforced by the **compiled** output" and that "the runtime may execute a server entry client-side" during development; both sentences change with this plan.

**Related**

- `compiler.md` §3 (the "Server function" row), §6.2 (the per-page handler) and §6.3 (the worker); `site-architecture.md` §14.1.1, §14.7 (deployment base path) and §15.4 (`jx dev` standing in for the worker); `server.md` (the dev proxy).
- `spec.md` §11.2 (`Request`), §11.3 (the timing table), §16.7 (what `jx dev` serves), §21.4 (trust model).
- `plan:spec/timing-values-in-built-sites` requires this plan for §11.3's `"server"` cell.
