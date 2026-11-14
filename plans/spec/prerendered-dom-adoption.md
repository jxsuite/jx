---
status: drafted
disposition: implement
claims:
  - spec.md#16.10
requires:
  - spec/compiled-keyed-lists
workspaces:
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: L
---

# An upgrading element keeps the nodes the build wrote and attaches its bindings to them

## Context

`specs/spec.md` §16.10, the leading marker:

> **Status: Pending.** A prerendered instance is replaced when its element upgrades, in every tier; nothing adopts the nodes the build wrote. The compiled element clears its children and renders its own tree (`emitElementModule` in `packages/compiler/src/targets/compile-element.ts`), and the interpreter treats every existing child as slot content and clears the host (`packages/runtime/src/runtime.ts`).

The section was added by the change that made a live component prerender its initial state (compiler.md §8.1): rows of a repeater, the initial value of state a handler writes, the selected `$switch` case. That change decided to keep replacement and to make it invisible (one synchronous pass, the same markup on both sides) and to leave adoption for a change of its own. This is that change.

**What the code does** (verified against the working tree on 2026-11-14):

- **Compiled element.** `emitElementModule` writes a `connectedCallback` that reads the props, captures slotted children from the brackets (`__jxCaptureSlotted`, spec.md §8.5), removes `data-jx-prerendered`, calls `replaceChildren()` on the first connection and registers one render effect, `effect(() => render(this.template(), this))`. lit's `render` creates every node. Shadow mode clears the declarative root and keeps only its stylesheet link.
- **A static instance never upgrades.** `data-jx-static` hosts get no module (`computeLiveTags`, `injectComponentScripts` in `packages/compiler/src/site/site-build.ts`), so there is nothing to adopt.
- **Interpreter.** The custom element's `connectedCallback` captures the host's children as slot content after an `await` and clears the host; `mount` has no adopt path. Built sites never load the interpreter (site-architecture.md §12.4), so this tier matters only to a host that mounts a prerendered tree.
- **Page tier.** `compile-client.ts` is the one place with an adopt mechanism: the prerender writes `data-bind` and `<!--jx-text:key-->` markers and the module's `hydrate(root)` attaches an effect per marker to the node already there. It emits a repeater and a `$switch` container empty (compiler.md §9.2), because lit's `render` appends.
- **What replacement loses**, stated in compiler.md §4.4 and spec.md §16.10: focus, a typed value, an inner scroll offset, a toggled `<details>`, media playback, a running transition, and third-party observers on the replaced nodes, in the window before the module loads.
- **The harness exists.** `packages/compiler/tests/prerender-hydration.test.ts` builds a site, upgrades every instance in happy-dom and compares each host's markup before and after. Adoption replaces its string comparison with node identity.

**What is missing:** markers the prerender writes only once something reads them (a row key and a list anchor, a case key, a text marker in the element tier), a claim pass in each renderer, and a decision on which renderer the compiled element adopts with.

## Outcome

- spec.md §16.10 → Implemented: a prerendered live instance keeps its nodes when its element upgrades, in the compiled element and in the interpreter, and falls back to replacement for any instance whose markup does not match.
- compiler.md §4.4 and §9.2 are rewritten to adoption (a `reconcile`-shaped edit inside this plan: compiler.md is Implemented and stays so, because the new behaviour lands with the text).

## Decisions

- **Decided:** replacement stays the fallback. A host whose prerender does not match what the element would render (a hand-edited page, a minifier that stripped the markers, a prop that changed between build and upgrade) is cleared and rendered as today. Because a wrong adoption shows stale content with live bindings attached to the wrong nodes, which is worse than a repaint.
- **Decided:** markers are written only by the change that reads them. The prerender does not carry `data-jx-key`, `data-jx-case` or text markers until a renderer claims them, so no page pays for bookkeeping nothing uses.
- **Decided:** the row key is the rule `plan:spec/compiled-keyed-lists` exports (`mappedRowKeys` in `@jxsuite/runtime`, its emitted copy `__jxRowKeys`). The build computes a row's key with the export and the element with the copy, so a key the two sides compute differently cannot claim the wrong row. This is why that plan is required: without one key rule in both tiers there is nothing safe to claim by.
- **Decided:** a static instance is out of scope. It has no module, and nothing to attach.
- **Open:** which renderer the compiled element adopts with. Three options:
  1. **A Jx bind table beside lit's `template()`.** The module keeps its lit template for the create path and gains a table of bindings (marker id to effect) that a shared walker attaches to existing nodes, as the page tier's `hydrate(root)` does today. No new dependency. Cost: two renderers per module, and a parity rule of its own (the table and the template must name the same bindings), which the hydration test already has the shape to enforce.
  2. **One renderer: a `<template>` skeleton hydrated by the shared walker, with lit removed from the element target.** No new dependency, and one fewer in built output. Cost: it rewrites the element target's emitter and every test that reads lit source, and changes built output for every component on every site, for a gain (one renderer) that option 1 can grow into later.
  3. **lit-ssr.** `@lit-labs/ssr` renders at build time and `@lit-labs/ssr-client` hydrates. The least code in the element tier. Cost: two dependencies (`bun.nix` moves, and the build gains a second HTML emitter beside `renderStaticNode`), and it reverses the decision spec.md §16.6 records ("Jx does not use lit-ssr's `hydrate`").

  Recommendation: option 1. It adds no dependency, leaves the create path and every existing module's rendering untouched, reuses the page tier's marker scheme and walker, and keeps option 2 open as a later simplification once the table has proven itself. Option 3 is declined unless the owner chooses to reverse §16.6.

- **Open:** does the interpreter adopt in the same change? Recommendation: yes, as the last slice, because `mount({ adopt })` is what a host embedding the runtime over server-rendered markup needs and the claim passes are the same three (text, rows, case); but it ships after the compiled tier, since no built site loads the interpreter.

## Implementation

1. **Markers (`packages/compiler/src/shared.ts`)**, written by `renderStaticNode` and `renderMappedRows` only for an instance in the live set:
   - `<!--jx-t:n-->` before each bound text node and at each bound `textContent`, because an empty prerendered value has no node to claim. Reuse the page tier's `jx-text` spelling if the walker is shared.
   - `data-jx-key` on each row root, from `mappedRowKeys`, and a `<!--jx-array-->` anchor after the run of rows (the interpreter's own anchor position in `renderMappedArrayInto`).
   - `data-jx-case` on a `$switch` container, holding the rendered case's key.
2. **Compiled element (`packages/compiler/src/targets/compile-element.ts`)**, under the first Open as recommended: `emitElementModule` emits a bind table beside `template()` and a first-connection branch: when the host is stamped `data-jx-prerendered` and the walker claims every binding, attach the table's effects and skip `replaceChildren()` and the lit render; otherwise clear and render as today. A later state change that needs structure the table cannot patch (a different `$switch` case, a list that grows) hands that subtree to lit, cleared first.
3. **Page tier (`packages/compiler/src/targets/compile-client.ts`)**: the repeater and `$switch` containers are prerendered with their rows and case (compiler.md §9.2 stops emitting them empty) and claimed by the same passes, which is the replace-once trick the element tier uses. The page walker becomes the shared emitter, with row scopes.
4. **Interpreter (`packages/runtime/src/runtime.ts`)**, under the second Open as recommended: `hydrateNode` beside `renderNode`; a claim pass seeding `rows` in `renderMappedArrayInto` before its first `update()`; an adopt path in `renderSwitch` that keeps a container whose `data-jx-case` equals the selected key; a prerendered branch in the custom element's `connectedCallback`; `mount({ adopt })`.

**Integration contract.** Once this lands: a live instance's prerender carries the three markers; `data-jx-key`, `data-jx-case` and the `jx-t`/`jx-array` comments are hydration state, never selectors (spec.md §16.6); an emitter that adds a binding form to the element target adds its row to the bind table; and replacement is still reachable, so nothing may assume a host was adopted.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` and `packages/runtime`, then the manifest check for each if a source file is added. Ratchet a workspace's threshold only if its worst file rises.

- **`packages/compiler/tests/prerender-hydration.test.ts`**: the invariant becomes node identity. For each fixture host, record the prerendered descendants before the module loads and assert `toBe` on the same nodes afterwards (`identities()` for lists of nodes, never deep equality on a node). New cases: "a focused input keeps focus across the upgrade", "a typed value survives the upgrade", "a toggled details stays as the visitor left it", "a row keeps its node and a new row is created beside it", "a different `$switch` case clears only its container", "a host whose markup does not match is replaced", "a page stripped of its comments is replaced, not adopted wrongly".
- **`packages/compiler/tests/prerender-initial-state.test.ts`**: the markers appear only on live instances.
- **`packages/compiler/tests/compile-element.test.ts`**: the bind table is emitted beside `template()` and names every binding the template names (the parity rule).
- **`packages/runtime/tests/`**: `hydrateNode`, the row claim pass, the switch adopt path and `mount({ adopt })`, each with a mismatch case that falls back.
- **Once, in a browser** (`jx preview` over the fixture site): focus and scroll survive an upgrade on a throttled connection. happy-dom cannot see a paint.

## Specs & docs

- `specs/spec.md` §16.10, in place: replace the Pending marker with `> **Status: Implemented.**` naming the compiled element and the interpreter; rewrite the section to say an upgrade adopts and what makes it fall back; §16.6 adds the new markers to "never used as selectors" and drops "replace, not hydrate" for the light path (the shadow path follows the first Open). **Fragment:** `bun run spec:change spec.md minor -m "§16.10 an upgrading element adopts the nodes the build wrote and falls back to replacement on a mismatch."`
- `specs/compiler.md` §4.4 ("The prerender is replaced, not adopted") and §9.2 (containers emitted empty), in place, to what ships; §8.1 names the markers. **Fragment:** `bun run spec:change compiler.md major -m "§4.4 and §9.2 an upgrading element and a dynamic page adopt their prerendered nodes."` Major, because built output and the upgrade contract both change.
- Docs: `docs/framework/build.md` ("What prerendering will and won't bake") and `docs/framework/concepts/components.md` (the paragraph on what an upgrade loses) are rewritten; `docs/framework/concepts/lists.md` and `switching.md` say a prerendered row and case are kept. `bun run docs:sync` names the rest. No em dashes.

Landing the last slice deletes this file. No other plan requires it.

## Acceptance

- `packages/compiler/tests/prerender-hydration.test.ts` asserts node identity for every fixture and passes; with the adopt branch disabled it fails on identity and still passes on markup.
- `bun run plans:status --spec spec` no longer lists `spec.md#16.10`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
- `bun run --cwd sites/jxsuite.com build` and `bun scripts/check-site-perf-budget.ts` pass, with any ceiling the markers move raised by measurement.

## Slices

| Slice  | Scope                                                                                                                         | Claims        | State |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | ----- |
| PDA1.1 | Markers in the component prerender for live instances; the hydration test asserts their shape                                 | —             | open  |
| PDA1.2 | Compiled element: bind table, claim walker, adopt branch with replacement as the fallback; compiler.md §4.4                   | —             | open  |
| PDA1.3 | Page tier: repeater and `$switch` containers prerendered and claimed; compiler.md §9.2                                        | —             | open  |
| PDA1.4 | Interpreter: `hydrateNode`, row and case claim passes, `mount({ adopt })`; spec.md §16.10 → Implemented, docs pages rewritten | spec.md#16.10 | open  |
