---
status: stub
disposition: implement
claims:
  - compiler.md#6.3
  - site-architecture.md#14.1.1
size: M
workspaces:
  - packages/compiler
---

# The site worker serves every `timing: "server"` entry a page, its layout or a component declares

## Context

Two census stubs merged here, one from each spec, because they describe one code change: the step-5b collector in `buildSite` (`packages/compiler/src/site/site-build.ts`) walks `componentDefs` only, and step 6c keeps the first of two sources that claim one export name without a word. The `compiler.md`, `site-architecture.md` and `spec.md` censuses each found it and forwarded the merge.

`specs/compiler.md` §6.3, line 422. The section's only marker was a trailing `Implemented` one, which also claimed server sources are copied into `dist/components/`; the census corrected that sentence (the worker is bundled self-contained, §12) and led the section with:

> **Status: Partial.** Entries are collected from components only: step 5b of `packages/compiler/src/site/site-build.ts` walks `componentDefs` and never a page, and with an adapter set the per-page `_server.js` is skipped as well, so a page's own `timing: "server"` entry gets no route at all. The worker, the Pages `_worker.js` and `_routes.json`, ordered mounts and the no-adapter build error ship as described (`packages/compiler/tests/connector-mounts.test.ts`, `site-build.test.ts`); the parameter table omits the `i18n` and `base` options `compileSiteServer` also takes.

The retired `compiler.md` §10 ledger row "Site-wide server bundling" (**Implemented**) was the same claim and is tracked here now.

`specs/site-architecture.md` §14.1.1, line 1911:

> **Status: Partial.** The keys, their defaults and adapter-gated worker generation ship (`packages/compiler/src/site/site-loader.ts`, `compileSiteServer` in `packages/compiler/src/targets/compile-server.ts`). Step 3's known gap is unbuilt: the step-5b collector in `packages/compiler/src/site/site-build.ts` walks `componentDefs` only, so once `adapter` is set a `timing: "server"` entry declared on a page is dropped with no warning. Step 5 also understates `_routes.json`: for a site declaring more than one locale its `include` list is `/` and `/_jx/*`, so the worker can negotiate the root (§13.6).

That section was unmarked, although its step 3 already said "**This is a known gap, not a design intent**" in prose, which no parser reads. The census moved the §14 marker's open status here: §14's own stated gap, `vercel.json`, is declined rather than missing. Step 5's `_routes.json` sentence was first left as a ride-along on the locale-negotiation plan; a review moved it here, because this plan owns the anchor and would otherwise flip it to `Implemented` with step 5 still wrong.

**Disposition.** `implement`, as both stubs had it. Every spec that describes the worker already says pages are collected (`compiler.md` §6.3's body, `site-architecture.md` §14.1.1 step 3, which calls the gap "not a design intent", and `spec.md` §11.4's Site-Wide Bundling paragraph), and the code is one collector short of that. Size `M`: one collector and one dedupe decision, plus the spec ride-alongs below across two specs.

**Who requires it.** `plan:_shared/compiled-server-call` needs a worker route for every entry a compiled page can call. `plan:_shared/no-adapter-server-tier` needs this same collector, run with or without an adapter, to find the entries a no-adapter build has to refuse.

**What exists**

- Step 5b in `buildSite`: `collectServerEntries(doc)` over `componentDefs`, run only when `projectConfig.build.adapter` is set, each `src` rewritten to `./components/<src>`. `componentDefs` is filled only by step 5's loop over the files directly in `components/` (a non-recursive `readdirSync`), so that rewrite is right for them alone, and a component compiled from elsewhere as another component's `$elements` dependency contributes no entry.
- The per-page fallback in `compilePage` (same file): `compileServer(route.sourcePath)` only when `build.adapter` is unset, written beside the page as `_server.js`. That path does not load from `dist/` (`compiler.md` §6.2), and `plan:_shared/no-adapter-server-tier` owns it.
- Step 6c's deduplication in `buildSite`: a first-wins `Map` keyed by export name, which silently keeps the first source when two claim one name. Inside one document, `collectServerEntries` (`packages/compiler/src/shared.ts`) keys by `$export` too but with `Map#set`, so there the last wins; it walks only `state` and `children`.
- `compileSiteServer` in `packages/compiler/src/targets/compile-server.ts`: its options are `adapter`, `base`, `baseUrl`, `connectors`, `i18n` and `mounts`; it emits one import and one route (under `withBase(base, …)`) per entry it is handed and registers the mounts. Tests in `packages/compiler/tests/compile-server.test.ts`, `site-build.test.ts` and `connector-mounts.test.ts`.
- The `_routes.json` writer in step 6c, whose `include` is `["/", "/_jx/*"]` when `i18n` declares more than one locale and `["/_jx/*"]` otherwise.
- `build.deploy` in `packages/schema/defs/project-config.schema.ts` (the hosting project Studio publishes to): a schema key no spec defines. In `buildSite` it also gates §14.3's `public/CNAME` warning, which only a build with neither `adapter` nor `deploy` reaches.

**What is missing**

- The collector walking every page document too, after layout resolution so a layout's entries count, and every component the build compiles, resolving each `src` against the declaring document's directory rather than `./components/`, deduplicated by export name as both sections say.
- One decision for two sources claiming one export name, at both levels (across documents in step 6c, within one document in `collectServerEntries`). The `site-architecture.md` stub proposed a build error, raised in step 6c's loop, where the first-wins choice is made today; at minimum, if detailing stops short of that, a build warning naming the document whose entry is dropped, replacing the silent drop.
- Site-build tests under an adapter: a page-level and a layout-level entry, each asserting the worker serves it; and the clash.
- Ride-alongs (spec text in the claimed sections and the passages that restate them):
  - `compiler.md` §6.3: the parameter table gains `i18n` and `base`, its `entries` row stops saying "from all components", and the `compileSiteServer(...)` call line matches the options that ship.
  - `site-architecture.md` §14.1.1: step 1 ("from the project's components") and step 3's gap prose rewritten; step 5 rewritten to the `_routes.json` that ships (`/_jx/*`, plus `/` for a site with more than one locale); the table gains `build.deploy`, with the §14.3 `CNAME` warning it gates.
  - `site-architecture.md` §12.1's pipeline line "Collect server entries → from componentDefs (if adapter set)" (line 1559), an unmarked section no plan claims.
  - `site-architecture.md` §15.1's table cell ("on a component") and second scoping rule (line 2126), and §1.1 principle 3 (line 45), updated once page entries reach the worker. Their no-adapter clauses are `plan:_shared/no-adapter-server-tier`'s, which lands after this plan.
  - `spec.md` §11.4's Site-Wide Bundling paragraph (line 1301) becomes true; the section itself is `plan:_shared/compiled-server-call`'s.

**Related**

- `compiler.md` §1 (whose overview promises "every `timing: "server"` entry"), §6.2, and §12 (the worker bundle: `workerBundleOptions` and `bundleWorkerSource` in `packages/compiler/src/site/bundler.ts`).
- `site-architecture.md` §14.1 (adapter outputs), §14.3 (the `CNAME` warning), §13.6 (the negotiation the `/` include exists for), §15.1 and §15.4 (the application tier's view of server functions); `spec.md` §11.4 (`timing: "server"`).
- Which components a build compiles at all is open elsewhere: `site-architecture.md` §2.2 and §10.3 and `imports.md` §1.3 and §1.4 are marked for a build that compiles only the files directly in `components/`, so a component a page names by `{ "$ref" }` from anywhere else ships as an empty tag with no module. Whatever set that item settles is the set this collector walks; until it lands, a server entry on such a component is dropped along with the component.
- `plan:_shared/compiled-server-call` (the client that calls these routes) and `plan:_shared/no-adapter-server-tier` (the no-adapter half) both require this plan.
