---
status: drafted
disposition: implement
claims:
  - compiler.md#6.2
  - site-architecture.md#15.4
requires:
  - _shared/page-server-entries
workspaces:
  - packages/compiler
size: M
---

# A server function needs a server-capable adapter as a mount does, and the per-page `_server.js` is retired

## Context

Two census stubs merged here, one from each spec, because one decision settles both: a build with no adapter either makes the per-page `_server.js` a handler that loads, or refuses any `timing: "server"` entry as it already refuses an active extension mount, and the per-page path goes.

`specs/compiler.md` §6.2, line 398 (unmarked before the census):

> **Status: Partial.** The handler is emitted but cannot load where the site build puts it. `compileServer` (`packages/compiler/src/targets/compile-server.ts`) copies each `$src` into its import as written, relative to the source page; the site build writes the result to `_server.js` beside the page's HTML in `dist/` (`packages/compiler/src/site/site-build.ts`) and neither copies nor bundles the modules it names, unlike the §6.3 worker, which is bundled self-contained (§12). So the import names a file `dist/` does not contain, and the per-page handler is not the standalone app this section and §1 describe.

`specs/site-architecture.md` §15.4, line 2146 (unmarked before the census):

> **Status: Partial.** The build error for an active mount with no adapter, worker emission gated on `build.adapter` alone and the `"cloudflare-pages"` skip ship (`buildSite` in `packages/compiler/src/site/site-build.ts`). A server tier of `timing: "server"` state alone does build with no adapter, but nothing serves its entries: the `_server.js` written beside a page's HTML imports each `$src` exactly as the page wrote it, a path `dist/` does not contain (`compileServer` in `packages/compiler/src/targets/compile-server.ts`, `compiler.md` §6.2), and a component's entries are collected only when an adapter is set, so without one they reach no handler at all.

§15.4's body still promises the opposite: "a project whose only server tier is `timing: "server"` state builds fine with no adapter, its entries compiling to per-route `_server.js` files".

**Why the per-page path cannot be repaired into a server tier** (verified 2026-09-26):

- The handlers cannot coexist. Each registers absolute `/_jx/server/<export>` routes (`buildRoute` at `compileServer`'s default `baseUrl`, with no deployment base), and the `compiler.md` §6.1 client calls that one URL space. Two pages with entries emit two apps claiming the same paths; only a router between them could serve both, and that is the site worker.
- Nothing runs one. `startDev` (`packages/server/src/dev.ts`) serves `dist/` through `createDistMiddleware` and never loads a `_server.js`; no adapter, host or docs page deploys one. On a static host the file is merely uploaded and served publicly, naming the server modules and exports.
- There is no bundle target. `workerBundleOptions(adapter)` (`packages/compiler/src/site/bundler.ts`) keys the self-contained bundle on the adapter's runtime, and a build with no adapter names none.
- The rule exists for the other mechanism. An active mount with no adapter throws at step 1c of `buildSite` ("Dynamic tables need a server-capable adapter"), `site-architecture.md` §1.1 principle 3 says a project that leaves `build.adapter` unset "deploys as plain static files", and `docs/framework/site.md` already says server functions "need somewhere to run for the same reason".
- Nothing in the repository relies on it. No committed page, starter or site declares a `timing: "server"` entry; only tests do, and `site-build.test.ts` ("generates _server.js alongside page HTML when no adapter") asserts only that `dist/index.html` exists.

**What exists**

- `compileServer` (`compile-server.ts`): dereferences the raw source document, runs `collectServerEntries` (`packages/compiler/src/shared.ts`, which walks `state` and `children` only), and emits `import { <export> } from '<src>'` verbatim, a bare `import { Hono } from 'hono'`, and one `buildRoute` per entry. `compileSiteServer` builds the same app from a list of entries, plus `withBase`, mounts, locale negotiation and the Cloudflare fallback.
- `compilePage` (`site-build.ts`, line 1526) calls `compileServer(route.sourcePath)` only when `build.adapter` is unset and swallows any failure as "No server entries — that's fine"; `buildSite` (line 814) writes `result.serverHandler` to `_server.js` beside the page.
- Step 5b of `buildSite`, the only reader of component entries, runs only under an adapter. `plan:_shared/page-server-entries` replaces it with one collector over pages (after layout resolution), layouts and compiled components.
- `runCli` (`packages/compiler/src/compiler.ts`, line 177), exported from the package root and run by `src/compile-cli.ts`, a script outside the `jx` bin: it writes `compileServer`'s output as `<out>-server.js`, with the same verbatim imports, so it loads only when the output sits beside the source. `compileServer` is also re-exported from the package root and listed in `packages/compiler/README.md`.
- Tests: `compile-server.test.ts` (`describe("compileServer")`, seven text checks), `compiler.test.ts` ("writes server handler file when server entries exist"), `site-build.test.ts` (above), and `connector-mounts.test.ts` ("static adapter + data tables is a clear build error").

## Outcome

- `site-architecture.md` §15.4 → Implemented: a `timing: "server"` entry wherever the site worker would collect it (a page, a layout in its chain, a compiled component or `project.json`'s `state`), with no `build.adapter`, fails the build with an error naming each entry and its document.
- `compiler.md` §6.2 → Removed, heading kept, with the sentence saying why. If the second decision below goes the other way, §6.2 is instead reconciled to the single-document handler and ends Implemented.
- Disposition `implement`: the error is new code, and the retirement lands in the same change.

## Decisions

- **Open:** does a server entry with no adapter fail the build, or build with a warning? Recommendation: fail, as a mount does. An entry is declared for its value, and a page built with nothing to answer its call ships without that value, which nobody sees until production. An author who sees the function work in Studio's canvas (which calls it through the dev server whatever the adapter) learns at build time, with a one-line fix. This reverses what `publish.md`, `settings.md` and `other-hosts.md` document ("Server functions still build there"), so the change is breaking and ships as `feat(compiler)!`.
- **Open:** does `compileServer` survive the site build's per-page path? Recommendation: retire it, with its root export, `runCli`'s `-server.js` write and `compiler.md` §2's route 4. `compileSiteServer(entries)` already emits the same app and is the one that applies the deployment base, so `compileServer` is a second, drifting emitter of one route family. Its only other caller is `runCli`, whose `-server.js` has the same relative-import defect whenever the output is not beside the source. The export's removal rides the major the first decision already requires. The alternative keeps it as the single-document handler, which requires `runCli` to rewrite each relative `$src` against the output directory (`compileServer(src, { outDir })`) and §6.2 to be reconciled (a `minor`), with route 4's row left standing.
- **Decided:** the check reads `plan:_shared/page-server-entries`'s collector, run whether or not an adapter is set, and names each distinct `exportName (declaredIn)` pair once, in first-seen order. It reads the records before deduplication by export name, so two documents declaring one export are both named, but not raw: the route loop pushes each layout's records once per page using it (and a `$paths` page's once per route), so an unfiltered list would repeat a shared layout's entry four hundred times. A second walk of pages and layouts is the duplicate that plan exists to prevent, and the path is what the author edits. An entry on a component no page uses counts, and so does one in `project.json`'s `state`, because under an adapter the worker serves both.
- **Decided:** the error goes into `buildSite`'s `errors` after the route loop (step 6c), rather than being thrown at step 1c beside the mount error. Entries are known only once each page's layout is resolved, after `dist/` is cleaned. An `errors` entry makes `jx build` exit 1, which is the failure a host acts on, while `jx dev` and Studio's Build still serve the pages written. A throw would reject `startDev`'s first `rebuild()`, so `jx dev` would not start.
- **Decided:** one error names every entry, as the mount error names every section, and both messages take the adapter list from one constant, because they give the same remedy.

## Implementation

1. `packages/compiler/src/site/site-build.ts`:
   - `compilePage`: delete the "Compile server handler if applicable" block, the `serverHandler` field of its return value and that field's JSDoc line.
   - `buildSite`'s route loop: delete "Write server handler if present" (the `_server.js` write); drop `compileServer` from the `../compiler.ts` import.
   - Step 1c: hoist the remedy into a module constant, `const ADAPTER_REMEDY = 'set build.adapter to "cloudflare-workers", "cloudflare-pages", "node", or "bun".'`, and end the mount error with `— ${ADAPTER_REMEDY}`, so its text is unchanged.
   - Step 6c, before `if (projectConfig.build.adapter)`: when there is no adapter and `siteServerEntries` is non-empty, push one error, `console.error` it, and emit nothing. `siteServerEntries` is `plan:_shared/page-server-entries`'s pre-deduplication list, collected whatever the adapter, each record carrying `declaredIn`; read it, never a second walk. Build the list from each distinct `` `${exportName} (${declaredIn})` `` string in first-seen order (a `Set`), e.g. `timing: "server" entries loadData (pages/index.json), trackVisit (layouts/base.json), sendForm (components/contact.json) need a server-capable adapter, but build.adapter is "static": a static deployment has nothing to serve /_jx/server — set build.adapter to "cloudflare-workers", "cloudflare-pages", "node", or "bun".` (the list, then `ADAPTER_REMEDY`).
2. `packages/compiler/src/targets/compile-server.ts`: delete `compileServer` and the `dereference` and `collectServerEntries` imports it alone uses; the module header says it emits the site worker (`compiler.md` §6.3). `buildRoute` stays, reached through `compileSiteServer`.
   - `packages/compiler/package.json`: drop `@apidevtools/json-schema-ref-parser`, whose only importer was `compileServer`, and run `bun install` so `bun.lock` loses it (still `lockfileVersion: 1`). `bun.lock` is in `affected.ts`'s global list, so the pull request runs the full matrix; `bun.nix` is left to the release pull request, as `.github/AGENTS.md` requires.
3. `packages/compiler/src/compiler.ts`:
   - Drop the import and the root re-export of `compileServer`, and the header's "Server → compile-server.js" line.
   - `runCli` becomes `const result = await compile(src)` and loses the `-server.js` write.
4. `packages/compiler/README.md`: delete the "4: Server" route row and the `compileServer(src, opts)` export row.
5. Commit subject `feat(compiler)!: …` with no plan id and no angle brackets; the `BREAKING CHANGE:` note: "A site with a timing server entry and no build.adapter now fails to build, and compileServer is no longer exported: set build.adapter, and build a handler from collected entries with compileSiteServer."

**Integration contract.** Once this lands:

- No build writes a per-page `_server.js`, and `compileSiteServer` is the only emitter of `/_jx/server/*` routes (`compileServer` is gone from `@jxsuite/compiler`).
- `buildSite` with any `timing: "server"` entry and no adapter resolves, writes the pages and emits no worker, and exactly one of its `errors` names each distinct `exportName (declaredIn)` once. With an adapter nothing changes.
- Spec text: `compiler.md` §6.1 item 2 names the site worker; `spec.md` §11.4's leading marker, Security Boundary and trailing note name only the worker; `site-architecture.md` §15's marker names only `compileSiteServer()`. `plan:_shared/compiled-server-call` builds its client call, its `jx dev` route and its §11.4 rewrite on these.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` (`coverageThreshold = { lines = 0.982, functions = 0.98 }`) and `bun scripts/check-coverage-manifest.ts packages/compiler`. No source file is added. `compile-server.ts` only shrinks, and the new branch in `site-build.ts` is covered below. Ratchet the threshold if the worst file rises.

- `site-build.test.ts`: replace `describe("buildSite — server handler without adapter")` with `describe("buildSite — server entries need an adapter")`. Its fixture has no adapter and `project.json` `state.siteStats` from `./lib/stats.server.js`; `pages/index.json` declares `loadData`, sets `$layout: "./layouts/base.json"`, which declares `trackVisit`, and renders `components/test-contact.json`, which declares `sendForm`; `pages/about.json` uses the same layout and declares nothing.
  - "one error names every entry and the document declaring it": `buildSite` resolves and `errors` has length 1. That error contains `siteStats (project.json)`, `loadData (pages/index.json)`, `sendForm (components/test-contact.json)` and `build.adapter`, and contains `trackVisit (layouts/base.json)` exactly once although two pages use the layout.
  - "the pages still build and no server output is written": `dist/index.html` exists, and neither `dist/_server.js` nor `dist/worker.js` does.
- `compile-server.test.ts`: delete `describe("compileServer")`, including the last-declared case `plan:_shared/page-server-entries` adds to it. Move its two assertions that `compileSiteServer` does not already pin into `describe("compileSiteServer")`, as "parses the body with a {} fallback" (`c.req.json()`, `.catch(() => ({}))`) and "stamps the generated-file header".
- `compiler.test.ts`: replace "writes server handler file when server entries exist" with "writes no -server.js for a document with server entries" (the HTML is written, and `index-server.js` is absent).
- `connector-mounts.test.ts` stays as it is: the mount error still throws before any output, and the shared remedy constant keeps its message.

## Specs & docs

**`compiler.md`**

- §1 (line 16): replace from "With no adapter, no site worker is emitted at all" to the paragraph's end with "With no adapter no server output is emitted at all, so a project with a `timing: "server"` entry, or with a non-empty `data` or `auth` section, fails the build until an adapter is chosen (§6.3)."
- §2: delete the `4 — Server` row (line 34). The leading marker and the section stay `plan:compiler/class-document-format`'s. That plan, unordered with this one, appends a §2 sentence ending "; route 4's server output is compiled beside whichever of them the document takes (§6)."; whichever of the two lands second drops that clause, leaving "Routes 0 to 3 are tried in that order and the first match wins."
- §6.1 (`plan:_shared/compiled-server-call`'s): in the marker, "(§6.2, §6.3)" becomes "(§6.3)". Item 2 becomes "**Server-side:** a route in the site worker (§6.3) that imports the `$export` from `$src` and exposes it at `/_jx/server/$export`."
- §6.2: replace the marker, the sentence and the example with the marker below. The heading stays.

  > **Status: Removed.** The site build no longer writes a per-page handler, and `compileServer` is no longer exported. Every such handler registered the same absolute `/_jx/server/` routes, so two pages with server entries emitted two apps claiming one URL space; nothing in the toolchain ran one, and a build with no adapter names no runtime to bundle it for. A site's server entries are served by the site worker (§6.3), which a `timing: "server"` entry requires as an active mount does.

- §6.3 (Implemented by then): delete "Per-route `_server.js` files are not generated in this mode." The paragraph "Dynamic sections require a server-capable adapter." becomes "**Dynamic sections and server functions require a server-capable adapter.** A project with active extension mounts and no `build.adapter` fails the build with an error naming the offending sections: a static-only output cannot serve `/_jx/data` or `/_jx/auth`. A project with a `timing: "server"` entry anywhere the worker would collect one (a page, a layout in its chain, a compiled component or `project.json`'s `state`) fails too, with one error naming each entry and the document declaring it, reported once the pages are compiled. Set `build.adapter` to …" (the adapter list, unchanged). In the trailing note, delete the "`compileServer` (per-route)" clause.
- Fragment: `bun run spec:change compiler.md major -m "§6.2 removed: the site build writes no per-page server handler and compileServer is no longer exported; §1 and §6.3 require build.adapter for a server-timed entry, as for an active mount"`.

**`site-architecture.md`**

- §1.1 principle 3 (line 45): the last sentence becomes "With no adapter nothing server-side is produced, so a project that declares a server function or an active extension mount fails to build until it sets one (§15.4)."
- §12.1's pipeline (line 1572): "(if adapter set, else per-route _server.js)." becomes "(if adapter set; with none, any server entry fails the build)."
- §14.1.1 step 3, as `plan:_shared/page-server-entries` leaves it ("Skips per-route `_server.js` generation: the worker serves every entry step 1 collects, a page's own included"), becomes "Serves every entry step 1 collects, a page's own included, from that one worker; no build writes a per-page handler (§15.4)".
- §15's marker (line 2114): "Server functions compile to worker routes (`compileSiteServer()`) or, with no adapter, per-route handlers (`compileServer()`), and are proxied" becomes "Server functions compile to worker routes (`compileSiteServer()`) and are proxied".
- §15.1's second scoping rule (line 2126), as `plan:_shared/page-server-entries` leaves it: keep its first sentence ("Second, the generated worker serves a server function wherever it is declared (…), one route per export name (§14.1.1).") and replace "With no adapter there is no worker, and only a page's own entries compile, to a per-route `_server.js` (§15.4)." with "So like a mount it needs an adapter: with none there is no worker, and the build fails, naming each entry (§15.4)."
- §15.4:
  - Marker:

    > **Status: Implemented.** Both adapter errors, worker emission gated on `build.adapter` alone and the `"cloudflare-pages"` skip ship (`buildSite` in `packages/compiler/src/site/site-build.ts`; `packages/compiler/tests/connector-mounts.test.ts`, `site-build.test.ts`).

  - First paragraph: "A project with an **active extension mount** (a non-empty `auth` or `data` section) or any **`timing: "server"` entry**, wherever it is declared (a page, a layout, a component or `project.json`'s `state`), **requires a server-capable adapter**. `build.adapter` must be `"cloudflare-workers"`, `"cloudflare-pages"`, `"node"`, or `"bun"`; with no adapter (a purely static build) the build **fails**, because a static deployment cannot serve either. A mount fails it before anything is written, naming the offending sections. A server entry is found as its page compiles, so its error names each entry and the document declaring it, arrives with the build's other errors once the pages are written, and `jx build` exits non-zero."
  - Second paragraph: "Nothing else forces that error. Server functions do not: … (§14.1). Neither does a `connections` section on its own, since" becomes "Nothing else forces either error: a `connections` section on its own does not, since"; the rest of the paragraph stays.
- Fragment: `bun run spec:change site-architecture.md major -m "§15.4: a server function with no build.adapter fails the build as an active mount does, and no build writes a per-route server handler"`.

**`spec.md`** (restated sentences only; no status changes, and §11.4 stays `plan:_shared/compiled-server-call`'s)

- §5.3 4d (line 450): "Server-timing functions are imported by the generated server output — the site worker when `build.adapter` is set, a per-page `_server.js` handler otherwise (compiler.md §6)." becomes "Server-timing functions are imported only by the generated site worker, so a document declaring one needs `build.adapter` (compiler.md §6.3)."
- §11.4's leading marker (line 1240), as `plan:_shared/page-server-entries` leaves it: "`compileServer` and `compileSiteServer` (`packages/compiler/src/targets/compile-server.ts`) emit the route and call" becomes "`compileSiteServer` (`packages/compiler/src/targets/compile-server.ts`) emits the route and calls", and the sentence "A page's own entry gets no route that loads with no adapter: … (compiler.md §6.2)." becomes "With no adapter the build fails instead (compiler.md §6.3)."
- §11.4 Security Boundary (line 1295): replace "Where that route lands depends on `build.adapter`: … instead (compiler.md §6.2)." with "That route is in the generated site worker (`dist/worker.js`, or `dist/_worker.js` under the Cloudflare Pages adapter), so a server entry requires `build.adapter`, and a build without one fails (compiler.md §6.3)."
- §11.4's trailing note (line 1303): "Compiler emits per-route Hono handlers (`compileServer`) or a site-wide bundled worker (`compileSiteServer`) when `build.adapter` is set." becomes "Compiler emits a site-wide bundled worker (`compileSiteServer`), which requires `build.adapter`."
- Fragment (major because the per-page handler was documented here as working): `bun run spec:change spec.md major -m "§5.3 and §11.4: a server-timed entry is served only by the site worker and so requires build.adapter; the per-page handler is gone"`.

**Docs** (no page cites `compiler.md#6.2` or `site-architecture.md#15.4`; these are the pages whose text the change falsifies, and none may gain an em dash)

- `docs/framework/concepts/timing.md` (`spec:` `compiler.md#6`), line 98: "Without an adapter, a standalone per-document handler is generated instead. During development the dev server stands in for both." becomes "Without an adapter the build stops with an error naming each server entry and the file declaring it, because a static deployment has nothing to run them on. During development the [dev server](/docs/framework/build/dev-server) stands in for the worker."
- `docs/framework/build.md` (`spec:` `compiler.md#2`, `code:` `site-build.ts`), line 133: "`timing: "server"` entries generate server handlers, either a per-route `_server.js` or a single site-wide worker when `build.adapter` is set" becomes "`timing: "server"` entries compile into the site-wide worker, which needs `build.adapter`: without one the build stops with an error naming each entry".
- `docs/framework/site/deployment.md` (`code:` `site-build.ts`), under "What the worker serves":
  - The first bullet, as `plan:_shared/page-server-entries` leaves it: ", so there are no per-route server files when an adapter is set." becomes " into the worker; no build writes per-route server files."
  - The dynamic-sections bullet becomes "A project with a non-empty `data` or `auth` section (served by extension mounts) or any `timing: "server"` entry **must** set a server-capable adapter. On static the build stops with an error naming the offending sections or entries, since a static site has nothing to serve them with." This also drops the bullet's `connections`, which on its own activates no mount.
- `docs/studio/publish.md` line 27: "A database or sign-ins make an adapter mandatory: … Server functions still build there, but nothing serves them without an adapter." becomes "A database, sign-ins or server functions make an adapter mandatory: the build stops with an error on **Static**."
- `docs/studio/projects/settings.md` line 132: "…once the project has a database or sign-ins, … Server functions still build on **Static**, but only these four actually serve them." becomes "…once the project has a database, sign-ins or server functions, because the build stops with an error on **Static**."
- `docs/studio/publish/other-hosts.md` line 14: replace the last two sentences before the settings link with "Any of the three makes that mandatory, because the build stops with an error on **Static**."
- `docs/framework/site.md` line 82: "The connection-backed sections require a server-capable `build.adapter`, and the build stops without one; server functions need somewhere to run for the same reason." becomes "The connection-backed sections and server functions require a server-capable `build.adapter`, and the build stops without one."
- `docs/framework/agents.md` line 87: "Server functions want one too, since that is what packages them into a worker a host will actually run." becomes "Server functions need one too, and the build fails on static for them the same way."
- `docs/framework/agents/authoring-rules.md` line 369: "with connection-backed data tables it is not optional" becomes "with connection-backed data tables or a server function it is not optional".

Neither `compiler.md` nor `site-architecture.md` graduates: both keep other open items.

## Acceptance

- `packages/compiler`'s suite passes at its thresholds, and the manifest check passes.
- `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose` and `docs:markdown` pass. `bun run plans:status --spec compiler` no longer lists §6.2, and `--spec site-architecture` no longer lists §15.4.
- `git grep -n "compileServer\|_server\.js" -- packages specs docs ':!**/CHANGELOG.md'` finds only spec changelog entries, the new fragments, `compiler.md` §6.2's heading and Removed marker, and the `site-build.test.ts` case asserting `dist/_server.js` is absent (a tracked-file search, so no installed `node_modules`, `dist/` or generated docs page is read).
- Scratch site with no `build.adapter` and `pages/index.json` declaring `loadData`:
  - `bunx jx build` exits 1, printing one error with `loadData (pages/index.json)`; `dist/index.html` exists and `dist/_server.js` does not.
  - `bunx jx dev` starts, logs that error as a build error, and serves the page.
  - With `build.adapter: "bun"` the build exits 0 and `dist/worker.js` holds the `loadData` route.
