---
status: drafted
disposition: defer
claims:
  - site-architecture.md#12.3
requires: []
workspaces:
  - specs
  - docs
size: S
---

# Every build is a full build, and the spec says so until an incremental design can pay for itself

## Context

`specs/site-architecture.md` §12.3, line 1634:

> **Status: Pending.** No dependency graph exists. `jx build` and the dev server's pre-reload rebuild are both FULL builds, so the paragraph below describes an intended design rather than shipped behaviour. It is fast enough that nothing has forced the issue yet; the cost is that it scales with the project rather than with the edit.

The paragraph under it states the intended rule: a changed content entry recompiles only the pages that reference its collection, a changed layout the pages that use it, a changed `project.json` everything. The marker is accurate. Verified at 84735a9f:

- **Every caller runs a full build.** `buildSite` (`packages/compiler/src/site/site-build.ts`, ~148) re-reads `project.json`, rebuilds the extension registry, rediscovers `pages/`, reloads every project section (`loadProjectSections`), recompiles every component and every route, and regenerates every site-wide output (worker, bundles, extension `emit`, redirects, sitemap, `_headers`, `sw.js`). Its callers are `jx build` (`packages/compiler/src/cli.ts`), `startDev` in `packages/server/src/dev.ts` (before each live-reload broadcast, with the default `clean: true`), Studio's Build Site (`packages/server/src/studio-api.ts`, `packages/desktop/src/project-session.ts`, both `clean: false`) and `packages/import/src/verify.ts`. The only state reused across builds is the image cache (`packages/compiler/src/site/image-cache.ts`), keyed on the source's content hash and the image config: asset reuse, not page-level incremental compilation.
- **The measurement the census asked for.** `sites/jxsuite.com` is the largest project in the repository: 155 routes, 145 of them expansions of `pages/docs/[...slug].json` over the `docs` collection (`source: "../../docs"`). The `deploy-site.yml` build on `main` of 2026-09-26 (run 36210255240, a GitHub-hosted runner, warm image cache) logged `Building site from …` at 02:00:45.71 and `Done: 155 routes → 578 files` at 02:00:53.94: **8.2 s** for the whole `jx build`. The first `Content validation:` warning, printed when the `docs` collection finishes loading in `loadProjectSections`, came at 02:00:49.76, so **4.0 s** passed before any component or route compiled. The same step took 10 s in the 2026-09-25 build too (run 36188682635).
- **The spec's own rule would reach nearly every route.** `ContentEntry.resolve` (`extensions/parser/src/content.ts`, ~224) reads `_project.content.get(contentType)` and then finds its entry, so every page expanded from a collection reads the whole collection, and `layouts/docs.json` reads `docsNav` the same way. Under collection-level invalidation one edit to a docs page recompiles at least 145 of 155 routes, and the 4.0 s before the first route (registry, discovery, the whole content section reloaded through `projectData`) is paid regardless.
- **The stub's evidence, corrected.** A page does not reach data files "through `$ref`": at build time a `$ref` resolves against state (`resolveRefValue`, `packages/compiler/src/shared.ts`). A page reads files through its layout chain (`nodeLayoutLoader`, `packages/compiler/src/site/layout-resolver.ts`), through `_project` sections, and through `$prototype` classes that read `src` relative to the page (`resolveClassPrototype`, `packages/compiler/src/site/prototype-resolver.ts`), which a third-party class may do in any way it likes.
- **Two dev-loop facts an incremental design would have to fix first.** `createWatcher` (`packages/server/src/watch.ts`) watches only the project root, so `jx dev` on `sites/jxsuite.com` does not rebuild at all when a file under `../../docs` changes (documented: "The server watches `root`", `docs/framework/build/dev-server.md`). And its debounce timer hands `preReload` only the last event's `filename`, so a burst that touches two files reports one; harmless while every rebuild is full.
- Studio's canvas and live preview (`packages/server/src/live-preview.ts`) render from sources and never build, so the authoring path the docs name as the end-user one does not pay this cost at all.

## Outcome

- site-architecture.md §12.3 → Implemented for what ships (every build is a full build, measured), with a `> **Status: Future.**` remainder for dependency-driven dev rebuilds that names what a design needs. The collection-level rule is withdrawn.
- site-architecture.md stays Partial; the other open items keep their plans. Nothing graduates, and `plans/site-architecture/` stays.

## Decisions

- **Open:** build the dependency graph now, or defer it? Recommendation: defer, because the measurement does not justify the risk. A full build of the largest project takes 8.2 s, half of it before any route compiles, and the rule §12.3 states would still recompile at least 145 of its 155 routes on the most common edit, so implementing the section as written buys almost nothing. What would pay (entry-level read records, a per-file content reload, a long-lived build session) is a larger design than the section describes, and its failure mode is a stale page served with no error, the class of bug this repository gates hardest against. If the call goes the other way, re-draft this plan as L in four slices: a build session split out of `buildSite` with per-phase timings and no behaviour change; per-route read records (a recording view of `sections` handed to `resolvePrototypes` and `expandDynamicRoutes`, a recording `nodeLayoutLoader`, component tags scanned from the finished HTML) plus per-route contributions (CSP sources, runtime assets, asset refs, bundle registrations, sitemap entry) so site-wide outputs regenerate from cache, with a full build for any changed path no record names; dev wiring (`createWatcher` reports every path in a burst, `startDev` watches out-of-root section sources and rebuilds with `clean: false`); and a per-file reload capability for `projectData` owners, an extensions.md §8 change.
- **Decided:** the collection-level rule is withdrawn rather than kept as the Future design, because a Future marker is a promise, and this rule would recompile nearly every route of the project that motivated it. The Future text names the pieces a design needs instead of one.
- **Decided:** `jx build` stays a full build in any future design, and the Future text says so, because a production build's output must be a function of the tree alone. The image cache keeps that property by being content-addressed; a persisted dependency graph would make the output a function of the previous build too, and a 10 s CI step does not need it.
- **Decided:** the measurement goes into the Implemented marker with its source (the `deploy-site.yml` build's own log timestamps) rather than into a new benchmark script, because that step already measures a full build on every push to `main`, and a script for a deferred feature is code with no consumer.
- **Decided:** one sentence in the CLI docs, because the only user-visible consequence of full builds is that a `jx dev` save takes longer to appear as the site grows, and the docs describe `jx dev` without saying so.

## Implementation

A paper plan: the change set is the spec rewrite, one docs sentence, the fragment, and this file's deletion.

1. **`specs/site-architecture.md` §12.3**, in place. Keep the heading `### 12.3 Incremental Builds`. Replace the Pending marker and the paragraph under it with these two blockquotes:

   > **Status: Implemented.** Every build is a full build. `jx build`, the dev server's rebuild before each live-reload broadcast (§12.2) and Studio's Build Site all call `buildSite`, which re-reads `project.json`, rediscovers `pages/`, reloads every project section and recompiles every component and every route. The one thing a build reuses from an earlier one is the image cache (§9.2.5), whose entries are keyed on a source's bytes and the image options, so reusing one never depends on knowing what changed. On `sites/jxsuite.com`, the largest project in this repository (155 routes, 578 files), a full build took 8.2 s in the `deploy-site.yml` build of 2026-09-26 with a warm image cache, and 4.0 s of that passed before the content section had finished loading, so before any component or route compiled.

   > **Status: Future.** Dependency-driven rebuilds in the dev server. This section used to state the rule: a changed content entry recompiles only the pages that reference its collection, a changed layout only the pages that use it, a changed `project.json` everything. As written that would save little: every page generated from a collection reads the collection, a site's layout is usually on every page, and the work before the first route (the extension registry, route discovery, reloading the content section) would still run in full. A design worth its risk needs a build session the dev server keeps between rebuilds; a capability that reloads one changed content file rather than a whole section, since `projectData` loads a section whole (extensions.md §8); per-route records of what each page read, taken where a section reaches a page (`_project`), so that they name entries rather than collections; a watcher that reports every changed path, including content sources outside the project root, which `jx dev` does not watch today; and a full build for any changed path no record names, so a missing record costs time rather than serving a stale page. `jx build` stays a full build either way: its output must be a function of the tree alone, which a content-addressed cache preserves and a persisted dependency graph would not.

2. **`docs/framework/build/cli.md`**, section `jx dev`: after the paragraph ending "`jx dev` prints an install hint when either is missing.", add "Every rebuild is a full build of the site, so how long a save takes to reach the browser grows with the size of the site rather than the size of the edit." In the frontmatter `spec:` list add `  - site-architecture.md#12.3 # every build is a full build`, so a later change to the section flags this page.

3. **Land it**: delete `plans/site-architecture/incremental-builds.md`. No plan requires it, so no `requires` edge moves.

No code, test or schema file changes.

**Integration contract.** Nothing requires this plan. Once it lands, site-architecture.md §12.3 leads with `Implemented` and states that every build is full, with a Future remainder; `buildSite`'s signature and behaviour are unchanged, so no other plan's integration contract moves. A later plan that builds incremental dev rebuilds claims nothing open until it re-marks §12.3's remainder, and must leave `jx build` full.

## Tests

No workspace suite runs: no source file changes, so no coverage threshold or manifest moves. The gates that prove the change:

- `bun run docs:status`: §12.3's leading marker is `Implemented` and the `Future` remainder is not an open item.
- `bun run plans:check`: `site-architecture.md#12.3` is no longer open and has no plan claiming it, and no dependent names this plan.
- `bun run docs:spec-release`: the body change carries the fragment below.
- `bun run docs:check` and `bun run docs:links`: the new `spec:` anchor in `cli.md` resolves.
- `bun run docs:prose` and `bun run docs:markdown`: the added docs sentence has no em dash and no visual-editor escape.

## Specs & docs

- **Spec:** the §12.3 rewrite in Implementation step 1. The Pending marker becomes the Implemented marker plus the Future remainder; the heading and its number stay.
- **Fragment:** `bun run spec:change site-architecture.md patch -m "§12.3 states that every build is a full build, with its measured cost on the largest project, withdraws the collection-level rebuild rule, and defers dependency-driven dev rebuilds to a Future remainder naming what a design needs."`
- **Docs:** no page's `spec:` cites `site-architecture.md#12.3` (`docs/framework/site/search.md` cites the parent `#12` and needs nothing), and no code changes, so `bun run docs:sync` names nothing. `docs/framework/build/cli.md` gains the sentence and the anchor in step 2. `docs/framework/build/dev-server.md` and `docs/framework/build.md` are unchanged: neither mentions incremental builds, and the former already says the server watches `root`. The generated `implementation-status.md` drops §12.3 from its open list on its next `bun run docs:generate`.
- **Graduation:** none. site-architecture.md keeps other open items.

## Acceptance

- `sed -n '/^### 12\.3 /,/^### 12\.4 /p' specs/site-architecture.md` shows `> **Status: Implemented.**` first, then `> **Status: Future.**`, and neither "No dependency graph exists" nor the collection-level rule paragraph.
- `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#12.3`, and `bun run plans:status --who-claims site-architecture.md#12.3` names no plan.
- `ls specs/changes/` holds the patch fragment for `site-architecture.md`, and `bun run spec:release --dry` shows it minting a patch version.
- `grep -n "site-architecture.md#12.3" docs/framework/build/cli.md` matches, and the `jx dev` section carries the new sentence.
- `test ! -e plans/site-architecture/incremental-builds.md` after landing.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
