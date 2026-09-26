---
status: stub
disposition: implement
claims:
  - spec.md#8.5
size: M
workspaces:
  - packages/compiler
  - packages/runtime
---

# Built output distributes slotted children by `name`, in the component module and in the prerender, as the interpreter does

## Context

`specs/spec.md` §8.5, line 781:

> **Status: Partial.** The interpreter distributes by `name` as described (`distributeSlots` in `packages/runtime/src/runtime.ts`). Built output does not. The component module's light-DOM emulation (`compile-element.ts`) finds the first `<slot>` and moves every slotted child there whatever its `slot` name, and the static prerender (`renderStaticNode` in `packages/compiler/src/shared.ts`, reached through `expandComponents` in `packages/compiler/src/site/site-build.ts`) substitutes all of the instance's children for every `<slot>`, so the example below prerenders the header and the body into both `<header>` and `<main>`.

The section's trailing `Implemented` marker describes the interpreter and stays. §16.6 specifies the same distribution's other half ("A `<slot>` leaves no node") and its marker names the same two emitters; `plan:spec/shadow-dom-parity` owns §16.6 and requires this plan for that part.

Reproduced by a reviewer: `preRenderComponentHtml` on §8.5's card with `<h1 slot="header">T</h1><p>Body</p>` returned `<header><h1 slot="header">T</h1><p>Body</p></header><main><h1 slot="header">T</h1><p>Body</p></main>`.

**What exists**

- `distributeSlots` in `packages/runtime/src/runtime.ts`: named and unnamed matching, fallback unwrap, no `<slot>` left behind; `packages/runtime/tests/custom-elements.test.ts`.
- The component module's emulation in `packages/compiler/src/targets/compile-element.ts`: `_slotted` collects the host's element and non-blank text children, then `const _slot = this.querySelector('slot'); if (_slot && _slotted.length > 0) { for (const n of _slotted) _slot.before(n); _slot.remove(); }`, so one slot, only when something was slotted.
- The static prerender: `if (tag === "slot" && slotContent != null) return slotContent;` in `renderStaticNode` (`packages/compiler/src/shared.ts`), where `slotContent` is every instance child rendered and joined by `expandComponents` in `packages/compiler/src/site/site-build.ts` (`null` for a shadow component, whose declarative root projects its light children).

**What is missing**

1. One distribution rule for both emitters, matching `distributeSlots`: each `<slot>` takes the children whose `slot` attribute names it (the unnamed slot takes the rest), is replaced by them or by its own fallback children, and never survives into the tree.
2. The prerender receives the instance's children as nodes (or a name-keyed map) rather than one joined string, so it can distribute by name.
3. The rule is inlined into generated modules from one runtime export with a drift test, as `attrHelperSource()` does for §8.3, so the interpreter and the module cannot diverge again.
4. Tests: the §8.5 example through `compileElement` (run in happy-dom) and through `preRenderComponentHtml`, with named, unnamed, unmatched-with-fallback and empty cases.

**Related**

- §16.6 (light-DOM rendering, `plan:spec/shadow-dom-parity`), §9.2 (`jxs` handles on slotted children).
- `compiler.md` §4 (custom element compilation), `site-architecture.md` (component expansion).
