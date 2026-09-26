---
status: stub
disposition: remove
claims:
  - compiler.md#6.2
  - site-architecture.md#15.4
requires:
  - _shared/page-server-entries
size: M
workspaces:
  - packages/compiler
---

# A server function needs a server-capable adapter as a mount does, and the per-page `_server.js` is retired

## Context

Two census stubs merged here, one from each spec, because one decision settles both: either the per-page `_server.js` a build without an adapter writes becomes a handler that loads (bundled self-contained through `workerBundleOptions` in `packages/compiler/src/site/bundler.ts`, with component entries collected into it), or any `timing: "server"` entry requires an adapter, as an active extension mount already does, and the per-page path is retired.

`specs/compiler.md` §6.2, line 398 (unmarked before the census, and listed as verified in that census's first pass):

> **Status: Partial.** The handler is emitted but cannot load where the site build puts it. `compileServer` (`packages/compiler/src/targets/compile-server.ts`) copies each `$src` into its import as written, relative to the source page; the site build writes the result to `_server.js` beside the page's HTML in `dist/` (`packages/compiler/src/site/site-build.ts`) and neither copies nor bundles the modules it names, unlike the §6.3 worker, which is bundled self-contained (§12). So the import names a file `dist/` does not contain, and the per-page handler is not the standalone app this section and §1 describe.

Confirmed by a reviewer's scratch `buildSite` with no adapter and a page holding `loadData: { "$src": "./api.server.js", "$export": "loadData", "timing": "server" }` beside `pages/api.server.js`: `dist/_server.js` contained `import { loadData } from './api.server.js'`, and `dist/` held no `api.server.js`.

`specs/site-architecture.md` §15.4, line 2146:

> **Status: Partial.** The build error for an active mount with no adapter, worker emission gated on `build.adapter` alone and the `"cloudflare-pages"` skip ship (`buildSite` in `packages/compiler/src/site/site-build.ts`). A server tier of `timing: "server"` state alone does build with no adapter, but nothing serves its entries: the `_server.js` written beside a page's HTML imports each `$src` exactly as the page wrote it, a path `dist/` does not contain (`compileServer` in `packages/compiler/src/targets/compile-server.ts`, `compiler.md` §6.2), and a component's entries are collected only when an adapter is set, so without one they reach no handler at all.

That section was unmarked and listed as verified in its census's first pass. The `compiler.md` census forwarded the per-page half; checking the forward found the component half. The build does succeed, which is all "builds fine" promises, but "its entries compiling to per-route `_server.js` files" reads as "its entries are served", and for neither kind of entry is that so.

**Disposition: `remove`**, chosen over the `implement` default both stubs carried, because the evidence says a per-page handler cannot be made into a server tier:

- **The handlers cannot coexist.** Each one registers absolute routes, `/_jx/server/<export>` (`buildRoute` at `compileServer`'s default `baseUrl`), and the client `compiler.md` §6.1 specifies calls that one URL space. Two pages with server entries emit two apps claiming the same paths, and only something routing between them can serve both, which is what the site worker is. Bundling each handler self-contained would make it load, not make the tier deployable.
- **Nothing runs one.** `jx dev` on a site project serves `dist/` and never loads a `_server.js` (`startDev` in `packages/server/src/dev.ts`), and no adapter, host or docs page describes deploying them.
- **There is no target to bundle for.** `workerBundleOptions(adapter)` keys the bundle on the adapter's runtime; a build with no adapter has named none.
- **The rule already exists for the other two mechanisms.** An active mount with no adapter fails the build (`compiler.md` §6.3, this section's first paragraph), `site-architecture.md` §1.1 principle 3 says a project that leaves `build.adapter` unset "deploys as plain static files", and the user docs already say server functions "need somewhere to run for the same reason" (`docs/framework/site.md`).
- **Nobody relies on it.** The handler has never loaded, and no test loads it.

The claims end differently, and the frontmatter names the act that decides both: `compiler.md` §6.2 → `Removed`, heading kept, with a sentence saying why; `site-architecture.md` §15.4 → `Implemented`, its second paragraph reversed so that server functions, like mounts, fail a build with no adapter. That error is the one piece of new code. §6.2 was documented as working, so its removal is a `major` fragment. Two outcomes stay open for detailing. If `compileServer` survives as route 4 of a single-document compile (`runCli` in `packages/compiler/src/compiler.ts` writes it as `<out>-server.js`), §6.2 is rewritten to that scope, a `reconcile`. If detailing keeps the per-page path after all, the disposition returns to `implement`, and it has to answer the shared URL space and name a bundle target first.

**Who requires it.** `plan:_shared/compiled-server-call` requires this plan: once the per-page path is gone, the compiled call always targets the site worker, and this plan's pull request rewrites the no-adapter sentences inside `spec.md` §11.4, which that plan owns.

**What exists**

- `compileServer` in `packages/compiler/src/targets/compile-server.ts`: `import { <export> } from '<src>'` verbatim, a bare `import { Hono } from 'hono'`, and one `buildRoute` per entry at `baseUrl` (default `/_jx/server`, with no deployment base: `compileSiteServer` applies `withBase` and `compileServer` does not). It dereferences the page's raw source document, and `collectServerEntries` (`packages/compiler/src/shared.ts`) walks only `state` and `children`, so neither a layout's entries nor a component used by its tag name reach that handler. The route itself is sound and shared with the worker.
- `compilePage` in `packages/compiler/src/site/site-build.ts` calls `compileServer(route.sourcePath)` only when `build.adapter` is unset, and swallows any failure as "No server entries — that's fine"; `buildSite` writes `result.serverHandler` to `resolve(dirname(outPath), "_server.js")` and copies or bundles nothing.
- The step-5b collector in `buildSite`, the only code that reads `componentDefs` for server entries, runs only when `build.adapter` is set, so without one a component's entries reach no handler at all.
- The worker's self-contained bundle (`workerBundleOptions` and `bundleWorkerSource` in `packages/compiler/src/site/bundler.ts`, §12), which inlines hono and user server modules so `dist/` runs without `node_modules`, verified by importing the bundle from an empty directory.
- The active-mount check near the top of `buildSite` (`activeMounts.length > 0 && !projectConfig.build.adapter`), which fails the build naming the sections: the error this plan extends to server entries.
- `runCli` in `packages/compiler/src/compiler.ts`, the other caller of `compileServer`, which writes the handler as `<out>-server.js` with the same verbatim import.
- Tests: `packages/compiler/tests/site-build.test.ts` ("generates _server.js alongside page HTML when no adapter") asserts only that `dist/index.html` exists, and its comment says the handler "may or may not be generated"; `compile-server.test.ts` checks the handler's source text.

**What is missing**

- The error: a build with any `timing: "server"` entry, on a page, its layout or a component, and no `build.adapter` fails, naming each entry and its document, as the mount check names sections. Finding every entry without an adapter takes `plan:_shared/page-server-entries`'s collector, run whether or not an adapter is set, which is why this plan requires it.
- The per-page path deleted from `compilePage` and `buildSite` (`serverHandler` and the `_server.js` write), and the route-4 question for `compileServer` and `runCli` settled.
- Tests: a no-adapter build with a page entry, and one with a component entry, each asserting the error; the existing no-adapter test replaced.
- Spec and docs text, edited in place in the same pull request:
  - `compiler.md` §6.2 (claimed); §1's "entries compile instead to a standalone per-page `_server.js` handler (§6.2)" (line 16); §2's route-4 row (line 34), if route 4 goes.
  - `site-architecture.md` §15.4's second paragraph (claimed); §12.1's pipeline line "(if adapter set, else per-route _server.js)" (line 1572); the no-adapter clauses of §1.1 principle 3 (line 45) and §15.1's second scoping rule (line 2126), whose adapter halves `plan:_shared/page-server-entries` rewrites first.
  - `spec.md` §11.4's Security Boundary sentence "with no adapter the compiler emits a standalone per-page `_server.js` handler beside the page instead (compiler.md §6.2)" (line 1295), the matching clause of its leading marker, and the trailing note's "per-route Hono handlers (`compileServer`)" (line 1303). That section stays Partial and stays `plan:_shared/compiled-server-call`'s.
  - `docs/framework/build.md` (line 133: "either a per-route `_server.js` or a single site-wide worker when `build.adapter` is set").

**Related**

- `compiler.md` §6.3 ("Dynamic sections require a server-capable adapter") and §12 (the worker bundle); `site-architecture.md` §14.1 and §14.1.1 (adapter outputs); `spec.md` §11.4 (`timing: "server"`).
- `plan:_shared/page-server-entries` (the adapter path for the same entries, and the collector this needs) and `plan:_shared/compiled-server-call` (the client that calls the routes).
