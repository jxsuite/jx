---
status: stub
disposition: implement
claims: []
size: M
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
---

# One classifier decides whether each Function entry is a computed or a callable, and every tier calls it

## Context

This plan claims nothing. It enables the two plans that own spec.md §5.3's Function-classification items, and both require it:

- `plan:spec/computed-function-classification` owns §5.3 4b (inline bodies). It gets the "no `arguments`" condition in every tier, which is the parameter half of its marker and a bug under either reading of the usage half. What stays with that plan is the decision whether callable use also decides an inline body, and the §5.3 4b text. If it chooses the usage-based rule, it changes one branch of this classifier rather than four tiers.
- `plan:spec/function-entry-tier-parity` owns §5.3 4d. It gets that plan's item 1, usage-based classification of a bodyless `$src` entry in the interpreter and in `compile-client.ts`, and the verdict that item 3's `$lazy` computed-use build error in `compile-client.ts` reads. Items 2 and 4 stay its own.

Each stub had proposed this same classifier on its own: one function over the document, in the shape of `collectCallableRefs`, called by the interpreter and by both compiled targets. It is built once here, and each owner keeps its own marker flip.

The markers it serves. `specs/spec.md` §5.3 4b, line 396:

> The "no `arguments`" condition holds only in the interpreter (`resolveFunction` in `packages/runtime/src/runtime.ts`): `compile-element.ts`, `compile-client.ts` and the build-time scope in `packages/compiler/src/shared.ts` classify a string body by `bodyReturnsValue` alone, so a body with declared `parameters` that returns a value compiles to a `computed()` with its parameter unbound. No tier classifies by reactive use, as the first paragraph below describes; classification reads the declaration and the body text.

`specs/spec.md` §5.3 4d, line 425:

> usage-based classification of a `$src` entry is `compile-element.ts`'s alone (the interpreter introspects the imported function, and `compile-client.ts` makes every `$src` entry a computed, so a `$src` handler bound to `on*` attaches no listener)

The rule the spec states has two halves. 4b says: "A function with only `body` (no `arguments`) and no event binding acts as a computed value". 4d's "Classifying an external Function" paragraph adds: "An entry referenced as a **callable** — bound to an `on*` event, invoked by an `$expression` `call` node (§19.4c), called as `state.key(…)` from a template or another body, or named as a lifecycle hook (§16.4) — stays a function. Otherwise … the entry is a computed value, matching the inline-body rule in 4b."

**What exists**

Four call sites classify, each by its own rule:

| Tier             | Where                                                                                  | Inline string body                                                          | Bodyless `$src` entry                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Interpreter      | `resolveFunction`, `packages/runtime/src/runtime.ts:1229`                              | declared `parameters`/`arguments` make it callable; else `bodyReturnsValue` | declared parameters make it callable; else introspection, `fn.length <= 1 && bodyReturnsValue(fn.toString())` (line 1235) |
| Element target   | `emitElementModule`, `packages/compiler/src/targets/compile-element.ts:478` and `:483` | `bodyReturnsValue` alone                                                    | by usage: `collectCallableRefs(doc)` or `LIFECYCLE_KEYS` makes it callable, else computed                                 |
| Client target    | `packages/compiler/src/targets/compile-client.ts:182` and `:185`                       | `bodyReturnsValue` alone                                                    | always computed ("$src functions always produce computed entries"), pinned by `compile-client.test.ts:933`                |
| Build-time scope | `buildInitialScope`, `packages/compiler/src/shared.ts:629` and `:636`                  | `bodyReturnsValue` alone, stored as a deferred computed                     | a `() => {}` placeholder marked runtime-only, so it is never a value at build time                                        |

- `bodyReturnsValue` (`packages/schema/src/guards.ts:189`) is the one piece every tier already shares: the bare-`return;` and ASI rules. Every tier imports its guards from `@jxsuite/schema/guards` (`runtime.ts:65`, `compile-element.ts:37`, `compile-client.ts:52`, `shared.ts:40`), so that module is where one classifier can live.
- `collectCallableRefs` (`compile-element.ts:285`) is the usage walker the spec describes. It walks `children` and `state` at any depth and collects `on*` `$ref`s, `call`-node targets and `state.key(` in any string. Its caller adds `LIFECYCLE_KEYS` (`onMount`, `onUnmount`, `onAdopted`, line 270). It is private to that file, and it also gates `$lazy`'s computed-use build error (line 374).
- That walker never reads the document root's own keys (`visit(doc.children); visit(doc.state)`), so it misses a root-level `on*` handler, the kind the interpreter binds on the host (`bindDefinitionHandlers`, `runtime.ts:1563`, §16.1). The element target gets away with this only because it binds no root handler at all (`plan:spec/compiled-host-handlers`).
- The interpreter has the whole document where it classifies: `buildScope(doc, …)` (`runtime.ts:769`) runs the Function pass (line 902) that calls `resolveFunction` (line 931). The build-time scope does not: `buildInitialScope(defs, parentScope)` takes only `state`, from four callers (`shared.ts:447` and `:1598`, `site-build.ts:784` and `:1308`).
- The corpus. There are 88 bodyless `$src` Function entries in 26 `packages/ui/components/*.json`, 10 in `examples/components/` and 2 in `sites/jxsuite.com/components/site-search.json`. The kit's entries run through the interpreter, in Studio and wherever `registerUi()` or `KIT_LOADERS` (`packages/ui/src/loaders.ts`) serves them, so today the interpreter's introspection decides them. Loading each kit sidecar and comparing verdicts gives this:
  - 39 of the 88 get the same verdict from `collectCallableRefs` as from introspection.
  - The other 49 are root-level handlers in 16 components, such as `jx-menu`'s `onkeydown` bound to `onKeydown`. Each takes two parameters (`fn.length` 2), so the interpreter makes it callable, and the walker, blind to the root, makes it computed.
  - With the root's `on*` keys counted, all 88 agree. `fetch-demo.json`'s three agree too. The sidecars of `user-card.json` and `dynamic-list.json` are missing from the repository, so their introspection cannot be run, but each of their entries is bound through a child's `on*`.
- Eight of the 100 declare `parameters`, and every one of those is also used as a callable: `jx-icon` `lookup`, `jx-color-field` `dropperAvailable`, `jx-swatch` `inkOf`, `jx-tabs` and `jx-swatch-group` `applySelection`, and `jx-tree` `applyCurrent` are each called as `state.x(…)` from a template, while site-search's `searchInit` is called from `onMount`'s body and `runSearch` is bound to `oninput`. No document in the repository declares a parameterised inline body that returns a value.

**What is missing**

- One exported function, next to `bodyReturnsValue`, that takes a document and returns a verdict (computed or callable) for each string-body and bodyless `$src` Function entry:
  - declared `parameters` or `arguments` make an entry callable. That is the interpreter's rule today, and §19.4c's for named formulas.
  - A bodyless `$src` entry is callable when the document uses it as one, and is otherwise computed. "Uses it as one" means `collectCallableRefs`, lifted, plus the lifecycle keys, **plus the root's own `on*` keys**. Lifting the walker unchanged into the interpreter would turn 49 kit host handlers into computeds and break every one of those components in Studio.
  - An inline string body is computed exactly when `bodyReturnsValue` holds, which is today's rule, until `plan:spec/computed-function-classification` decides the usage half.
- All four call sites read that verdict:
  - `resolveFunction` drops the `fn.length` and `fn.toString()` introspection, so an imported function's arity and source text no longer decide its role.
  - `compile-element.ts` drops its private walker and its inline-body branch.
  - `compile-client.ts` drops the always-computed `$src` branch, so a callable `$src` entry binds as a function.
  - `buildInitialScope` is handed the verdict (or the document), since its callers pass only `state`.
- Three questions for detail:
  - Declared `parameters` and usage agree on every shipped document, so which of them wins for a `$src` entry changes nothing today. The order still has to be written down.
  - Which document is "the document" for an entry that reaches a page through the project-state merge (§19.4c's project-global formulas), where one page may call it and another read it.
  - Whether structured bodies (§20) join the classifier. Their parameter rule already agrees in the interpreter and `compile-client.ts`. `compile-element.ts` always lowers them to a handler, and that is a lowering, owned by `plan:spec/compiled-element-parameterised-bodies`, not a classification.
- Tests:
  - A verdict table in `packages/schema`'s suite.
  - Per-tier cases for a parameterised body that returns a value, and for a bodyless `$src` handler bound to `on*` on a page compiled by `compile-client.ts`.
  - A corpus case: every kit `$src` entry gets the verdict the interpreter's introspection gives it today, so the switch to usage changes no shipped component.

**Related**

- spec.md §5.3 4b and 4d (the two owners above), §16.4 (lifecycle keys are callables), §19.4c (a `call` node makes an entry callable; `parameters` make a named formula callable), §20.3 (the structured-body equivalent).
- `compiler.md` §4 (custom element compilation).
- spec.md §16.1 (`plan:spec/compiled-host-handlers`). Once the element target binds root handlers, a root `$ref` to a `$src` handler has to be a callable there. That needs this plan's root-aware verdict, or the same fix made to the walker in that plan.
- `exportCemManifest` in `packages/studio/src/services/cem-export.ts` lists every Function entry as a CEM `method`, including the ones every tier treats as a computed value. spec.md §16.8 (`plan:spec/cem-manifest-export`) could read this verdict instead. No edge is drawn.
