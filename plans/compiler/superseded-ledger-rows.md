---
status: stub
disposition: remove
claims:
  - compiler.md#10
size: S
workspaces:
  - packages/compiler
---

# The Pending Features ledger's last rows leave compiler.md, and the section is marked Removed

## Context

`specs/compiler.md` §10, line 690, with the three rows it keeps (lines 694 to 696). The census retired the ledger's other nine rows onto the sections that specify them (see the audit record); these three stay until this plan lands:

> **Status: Partial.** None of the three remaining rows ships. A `$prototype: "Request"` with `timing: "compiler"` is never fetched at build time: `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) has no class mapping for it and skips it, and the site build then strips it as a resolved compiler entry, so nothing is baked and the page gets no fetch either; the row belongs to `spec.md` §11.3's compiler row and stays here until that section marks it. Nothing emits a `<script type="application/Jx+json">` island: a dynamic page compiles to prerendered HTML plus one module holding its state and its `data-bind` hydration (`compile-client.ts`, §9.1), and a prerendered component instance upgrades from its `data-jx-props` payload (§4.4). No dependency-manifest file is written, and nothing in the build collects imports (`collectSrcImports` in `packages/compiler/src/shared.ts` has no caller outside its tests). The ledger's other rows belong to the sections that specify them: §6.3, §7, and `site-architecture.md` §4.3, §5, §6.4, §8.3, §8.4.1, §11.1, §12.1 and §14.

| Feature              | Status                                                           |
| -------------------- | ---------------------------------------------------------------- |
| `timing: "compiler"` | **Pending**                                                      |
| Island serialization | **Pending**                                                      |
| Bundle manifest      | **Pending** (nothing in the build collects imports; no manifest) |

The three rows are one piece of work because they are the ledger's last, all leave this spec, and removing them is what lets §10 itself end `Removed`. Disposition `remove` for each, for different reasons:

- **`timing: "compiler"` (a baked fetch response).** Not superseded: unbuilt, and not compiler.md's to plan. Its contract is `spec.md` §11.3's `"compiler"` row ("Resolved at build time; result baked into emitted HTML"), which the `spec.md` census marked as shipping because it holds for external classes; the `Request` half was forwarded to that spec's owner. The row stays here only so the item is written down somewhere open until then, and leaves once `spec.md` §11.3 marks it (as an open item with an owner, or as a sentence excluding `Request` from compiler timing).
- **Island serialization.** The mechanism the row names, a JSON island a runtime hydrates, was never built and nothing needs it: a dynamic page compiles through `compile-client.ts` to prerendered HTML plus one module (§9.1), a prerendered component instance carries its props in `data-jx-props` (§4.4, §8.1), and a built site ships no Jx runtime to read a JSON island at all (§12 ships only `@vue/reactivity` and `lit-html`).
- **Bundle manifest.** §12 records the decision against an analysis-time manifest: the client-runtime asset set "is read back out of the finished HTML, not recorded where a map is written", because a set recorded at one emitter described the build only when that emitter ran. Sidecar specifiers are registered as they are rewritten (`packages/compiler/src/site/bundler.ts`). `collectSrcImports` is the only remnant, and nothing in the build calls it.

**What exists**

- `packages/compiler/src/targets/compile-client.ts` (the dynamic-page module), `packages/compiler/src/targets/compile-element.ts` (the `data-jx-props` read), `packages/compiler/src/site/bundler.ts`, `packages/compiler/src/site/client-runtime.ts`.
- Dead code: the `_islands/jx-island-N.js` branch of `compileNode` in `packages/compiler/src/targets/compile-static.ts` cannot run through `compile()`. `compileStaticPage` is called only when `isDynamic(raw)` is false, `isNodeDynamic` checks a subset of what `isDynamic` checks, and `isDynamic` recurses into children, so no descendant of a page routed static is node-dynamic. A reviewer's scratch build of a static page with one interactive section emitted `app.js` and no `_islands/`. Only `compile-static.test.ts` reaches the branch, by calling `compileStaticPage` directly.
- `collectSrcImports` in `packages/compiler/src/shared.ts`, exercised only by `packages/compiler/tests/shared.test.ts` and `shared-coverage.test.ts`.
- `docs/framework/build.md` ("Islands in a static shell") documents the unreachable branch as shipped output, with a `<jx-island-0>` example.
- Two more places name the branch's output directory as something the build writes. Both carry the same sentence: GitHub Pages' Jekyll excludes "every `_`-prefixed path — which is `_headers`, `_redirects`, `_worker.js`, `_routes.json` and `_islands/`".
  - `specs/site-architecture.md` §14.4 (`.nojekyll`, line 2040, no marker).
  - The JSDoc of `writeNoJekyll` in `packages/compiler/src/site/headers-emitter.ts` (line 242).

  Neither mention is tested: `headers-emitter.test.ts` and `site-build.test.ts` assert only that `.nojekyll` is written. The list is incomplete today in the other direction too. The build writes `images/_optimized/` (`OPTIMIZED_DIR` in `packages/compiler/src/site/image-optimizer.ts`, and site-architecture §9.2's output path). It also writes a per-page `_server.js` beside a page with server functions (`site-build.ts`, around line 815), and whether that file survives is `plan:_shared/no-adapter-server-tier`'s decision.

**What is missing**

- The `timing: "compiler"` row deleted once `spec.md` §11.3 carries its gap; until then this plan cannot land.
- The other two rows deleted and §10's body replaced by one `> **Status: Removed.**` sentence saying where island delivery, the bundled asset set and compiler timing are specified (§4.4, §8.1, §9.1, §12, `spec.md` §11.3); the heading stays.
- Whether `collectSrcImports` and compile-static's `_islands` branch are deleted as dead code in the same pull request (and their tests with them, with the coverage threshold re-checked) is a detail-phase decision; deletion is the default. Either way `docs/framework/build.md`'s "Islands in a static shell" is rewritten to what a partly dynamic page compiles to. If detailing decides that islands in a static shell should be built after all, that is an `implement` in a plan of its own, not this one.
- The `_islands/` mentions removed in the pull request that deletes the branch, since the deletion makes them plainly stale. That covers two places:
  - site-architecture.md §14.4's sentence, released as a `patch` fragment for `site-architecture.md` (`bun run spec:change specs/site-architecture.md patch -m "…"`).
  - `writeNoJekyll`'s JSDoc in `headers-emitter.ts`, which is already in this plan's workspace.

  Both should list only the `_`-prefixed paths the build writes, and adding `images/_optimized/` in the same edit costs nothing. The removal does not depend on the dead-code decision: even if detailing keeps the branch, `jx build` cannot reach it and never writes `_islands/`, so the mentions are corrected either way.

**Related**

- `compiler.md` §2 (the route table that sends any dynamic page to route 3), §4.4 (property bridge), §8.1 (component expansion), §9.1, §12 (sidecar bundling and the client-runtime set).
- `spec.md` §11.3, owned by `plan:spec/timing-values-in-built-sites`; `site-architecture.md` §1.1 (principle 3's "islands"), §12.4 (which components a page loads) and §14.4 (the `.nojekyll` path list this plan corrects).
