---
status: drafted
disposition: implement
claims:
  - spec.md#15.2
requires:
  - spec/compiled-slot-distribution
  - spec/one-way-prop-forwarding-page-bindings
workspaces:
  - packages/compiler
  - specs
  - docs
size: M
---

# Children written inside a component instance on a page keep the page's scope in built output

## Context

`specs/spec.md` §15.2, the leading marker:

> **Status: Partial.** The interpreter renders the children written inside a component instance in the scope of the document that wrote them, before the instance distributes them. Built output does not for an instance written on a page or a layout: `expandComponents` (`packages/compiler/src/site/site-build.ts`) serialises those children with an empty scope before the page compiles, so a binding among them renders empty and is never hydrated, and a bound `$props` on an instance among them is lost the same way.

The rule it qualifies: "All `state` entries are available to all descendant elements within that component without explicit passing." Children written inside an instance are descendants of the document that wrote them. The marker was added in the closing pass of the detailing program, from `plan:spec/one-way-prop-forwarding-page-bindings`' "Outside this plan" finding.

**What the code does** (verified against the working tree on 2026-09-27):

- **Interpreter.** `renderCustomElementWithProps` (`packages/runtime/src/runtime.ts`, line 4489) appends each child as `renderNode(child, state, …)` with the parent's `state`, so bindings in slot content read and track the page; the element then captures and distributes those same nodes.
- **Built output.** `compilePage` runs `resolveDocTemplates(layoutDoc, scope)` (bakes build-time reads), then `expandComponents(layoutDoc, componentDefs, slotCss, defaults)`, then `compile(layoutDoc, …)`. `expandComponents` (line 2035) builds a page-level instance's slot content as `node.children.map((c) => renderStaticNode(c, {}, null)).join("\n")` (line 2084), writes the definition's prerender with that string substituted for its slots into `node.innerHTML` (light mode) or after the declarative `<template>` (shadow mode), and deletes `node.children`. The page compile then meets an element with `innerHTML` and no children: `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`) writes `innerHTML` through `resolveStaticValue` and binds nothing inside it, and `isDynamic` never sees a template among the deleted children.
- **Evidence** (the page-bindings plan's scratch build, 2026-09-27): `<my-box><span id="s">${state.n}</span></my-box>` on a page with a handler emitted `<span id="s"></span>` with no `data-bind`: the initial value is lost as well as the updates.
- **Instances inside a definition are right.** `renderComponentInstance` (`packages/compiler/src/shared.ts`) renders an instance's children with the definition's `scope`, and the definition's own module (compile-element's lit template) binds them. Only a page-level instance is affected.
- **What the prerequisites give.** `plan:spec/compiled-slot-distribution#CSD1.2` builds the prerender from a `SlotFill` whose groups are rendered by one callback, which `expandComponents` passes as `renderStaticNode(c, {}, null)`, and brackets each placed group so an upgrading element captures the same nodes it was given (`captureSlotted`). `plan:spec/one-way-prop-forwarding-page-bindings` leaves a page-level instance's live `$props` on the node and binds them in `buildClientNode` (`:prop.` directives, `liveInstanceTags`).

## Outcome

- spec.md §15.2 → Implemented. In built output the children written inside a page-level instance are compiled by the page's own target, in the page's scope: bakeable reads are prerendered, the rest are bound by the page's module, and an instance among them receives its bound props, before and after the instance distributes them.

## Decisions

- **Decided:** slotted children are compiled by the page's target, not prerendered by the component expansion. `expandComponents` keeps each light instance's children as nodes and writes a placeholder comment where each group's HTML went; the target that compiles the page (`buildClientNode`, or `compileNode` in `compile-static.ts` for a static page) replaces each placeholder with its own output for that child. Because only the page's target holds the page's binding table and counters, and a second emitter for slot content would be a second copy of every binding form the client target has.
- **Open:** where the nodes wait between the expansion and the compile. Recommendation: on the instance, as an internal `$slotted: (JxElement | string)[]` array, with placeholders `<!--jx-slotted n-->` indexing it, because it survives any clone of the tree, keeps each instance's placeholders local to its own `innerHTML` (so a nested instance among the children resolves its own on the way down), and puts the children back where the tree walks already look: `isDynamic`, `referencesStateKey`'s state-retention haystack (`JSON.stringify(layoutDoc.children)` includes it) and `collectTagNames`. The alternative, a page-level `Map` passed through `compile()`'s options, needs a new option on every target and is invisible to those walks.
- **Decided:** a fully static definition's instance gets the same treatment. `isComponentFullyStatic` describes the definition; the children an instance is given belong to the page, and a static component can place a bound child.
- **Decided:** the shadow path is the same. The children written after `</template>` become the same placeholders, so a shadow component's light children are compiled in the page's scope too.
- **Decided:** styles are unchanged: the callback still runs `collectStyles` into `slotCss` for each child, before the placeholder is written, so the page style block keeps its rules.

## Implementation

1. **`packages/compiler/src/site/site-build.ts`**, `expandComponents` (as `plan:spec/compiled-slot-distribution#CSD1.2` leaves it):
   - The light fill's render callback becomes `(c) => { collectStyles(…); return slotPlaceholder(slotted, c); }`, where `slotted` is a fresh array per instance and `slotPlaceholder` pushes the child and returns `` `<!--jx-slotted ${index}-->` ``. `createSlotFill` still groups, names and drops whitespace exactly as CSD1.2 specifies, so the placeholders land in the right slots inside the brackets.
   - The shadow branch's trailing string is built the same way.
   - When `slotted` is non-empty, set `node.$slotted = slotted`; `delete node.children` stays.
2. **`packages/compiler/src/shared.ts`**
   - `export const SLOTTED_KEY = "$slotted"` and `export function fillSlotted(html: string, slotted: readonly unknown[], render: (child: unknown) => string): string`, replacing each `<!--jx-slotted n-->` with `render(slotted[n])`; a placeholder with no entry is a thrown error naming the instance, because it means a pass rewrote the markup.
   - `isDynamic` walks `$slotted` entries as it walks `children`.
   - `renderStaticNode`'s `innerHTML` path calls `fillSlotted` with itself as the renderer and the scope it was given, for any caller that renders a page tree statically.
3. **`packages/compiler/src/targets/compile-client.ts`**, `buildClientNode`, the `innerHTML` branch: when `source.$slotted` is an array, `inner = fillSlotted(resolvedInnerHTML, source.$slotted, (c) => buildClientNode(c, c, nextContext, bindings, handlers, counter))`, so a slotted child's `textContent`, attribute, `$props` and text-child bindings join the page's table. `$slotted` is skipped by the property and attribute passes as every `$`-key is.
4. **`packages/compiler/src/targets/compile-static.ts`**, `compileNode`: the same substitution with `compileNode` as the renderer.
5. **Upgrade.** Nothing to add: CSD1.2's brackets make an upgrading element capture the page-compiled nodes themselves, and the page's `hydrate(document)` binds them by `data-bind` whichever runs first, since capture moves nodes rather than copying them.

**Integration contract.** Once this lands, a page-level component instance's children are part of the page's compile: they are bound by the page module, counted by `isDynamic`, and read by the state-retention pass. `$slotted` exists only between `expandComponents` and the target, and no emitter writes it. A plan that adds a binding form to `buildClientNode` gets slot content for free; a plan that adds a pass between the expansion and the compile walks `$slotted` beside `children`.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`. No source file is added. The per-file bar is `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`); ratchet only if the worst file rises.

- **`packages/compiler/tests/shared.test.ts`**: `describe("fillSlotted")`: "each placeholder takes its child's render", "a missing entry throws naming the instance", and `isDynamic` "sees a template among an instance's slotted children".
- **`packages/compiler/tests/site-build-nested-components.test.ts`**, new `describe("slot content keeps the page's scope (spec.md §15.2)")` over a scratch site with `state: { n: 1, inc: handler "state.n++" }` and a `my-box` definition with one `<slot>`:
  - "a binding in slot content prerenders the page value and is bound": `<my-box><span id="s">${state.n}</span></my-box>` builds to a `span` holding `1` with `data-bind` and a `:text-content` directive whose key the module binds.
  - "a static definition's slot content is bound too": the same with a fully static `my-box` (`data-jx-static`).
  - "a shadow component's light children are bound": `my-box` with `$shadow: "open"`.
  - "an instance in slot content receives its live prop": a `my-count` child with `$props: { count: { $ref: "#/state/n" } }` emits the `:prop.` directive from `plan:spec/one-way-prop-forwarding-page-bindings` on `my-count`.
  - "state read only in slot content is retained": an array read only by a slotted child's template survives the state-stripping pass.
  - "the upgrade keeps the bound node": under `GlobalRegistrator`, load the built page and the element module, click the handler's button, and read `#s`'s text as `2` after the element has upgraded.
- **`packages/compiler/tests/compile-static.test.ts`**: "a slotted child is rendered in the page's scope".

## Specs & docs

`specs/spec.md` §15.2, in place: delete the leading Partial marker, and after the rule add "Children written inside a component instance are within the document that wrote them, not the component they are given to: a binding among them reads the writer's `state` in every tier, before and after the instance places them in its slots (§8.5)." **Fragment:** `bun run spec:change spec.md minor -m "§15.2 children written inside a component instance keep the scope of the document that wrote them in built output, so a binding or bound prop among them is prerendered and hydrated by the page."`

`specs/compiler.md` §8.1, "A component instance is expanded wherever it is written" (as CSD1.2 leaves it): after the clause on the instance's children and their slots, add "On a page or a layout those children are compiled by the page's target in the page's scope, so a binding among them is prerendered and bound by the page's module (spec.md §15.2)." **Fragment:** `bun run spec:change compiler.md minor -m "§8.1 the children of a page-level component instance are compiled by the page's target in the page's scope."`

Docs: `docs/framework/concepts/elements.md` (`spec: spec.md#8`), "Slots": add "Content you place inside a component stays yours: a binding in it reads your page's state, and on a built site it updates as it does in Studio." `bun run docs:sync` also names `docs/framework/build.md` (its `code:` lists `site-build.ts`); its "Components inside components" section needs no change. No em dashes.

Landing deletes this file. Both prerequisites have landed by then, so no other plan cites it.

## Acceptance

- `git grep -n 'renderStaticNode(c, {}, null)' packages/compiler/src` prints nothing.
- The new `site-build-nested-components.test.ts` cases pass, and "a binding in slot content prerenders the page value and is bound" fails with the old callback restored.
- `bun run plans:status --spec spec` no longer lists `spec.md#15.2`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
