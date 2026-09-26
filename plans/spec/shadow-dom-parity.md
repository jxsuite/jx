---
status: stub
disposition: implement
claims:
  - spec.md#16.6
requires:
  - spec/compiled-slot-distribution
size: L
workspaces:
  - packages/runtime
  - packages/compiler
---

# `$shadow` means the same thing in the interpreter, the component module and the prerender, and light-DOM slots leave no node

## Context

`specs/spec.md` §16.6, line 1705 (the trailing `Implemented` marker now speaks for compiled output and a component's own `$shadow`; before the census it spoke for the whole section):

> **Status: Partial.** The compiler ships the light default, `$shadow` and `defaults.shadow`, the declarative-root prerender and its adoption, and `:host` translation (`packages/compiler/src/shadow.ts`). Three parts do not: the interpreter has no shadow support (no `$shadow`, `attachShadow` or `:host` handling in `runtime.ts`); `site-build.ts` calls `compileElement` without `defaults`, so a project-level `defaults.shadow` reaches the prerender but not the component module; and built output does not distribute slots by `name` (§8.5): the component module's light-DOM emulation replaces only the first `<slot>` and leaves the `<slot>` element in place when nothing is slotted, and the static prerender (`renderStaticNode` in `packages/compiler/src/shared.ts`) writes all slotted content into every `<slot>`.

The third part is §8.5's distribution rule, whose own section now leads with the same gap; `plan:spec/compiled-slot-distribution` owns §8.5 and builds it for both emitters, and this plan requires it. The first two parts touch different workspaces and may split during detailing.

**What exists**

- `packages/compiler/src/shadow.ts` (`resolveShadowMode`, `:host` translation), `compile-element.ts` (`#renderRoot` adopting an open root through `shadowRoot` and a closed one through `attachInternals()`), `packages/compiler/tests/shadow-dom.test.ts`.
- `distributeSlots` in `packages/runtime/src/runtime.ts`: named and unnamed matching, fallback unwrap, no `<slot>` left behind.
- `compileElement`'s `defaults` option (`opts.defaults`), which `packages/compiler/src/site/site-build.ts` does not pass; `site-build-reporting.test.ts` checks only the HTML.
- The compiled light-DOM slot emulation in `compile-element.ts` and the prerender's `<slot>` substitution in `renderStaticNode` (`packages/compiler/src/shared.ts`), both described in `plan:spec/compiled-slot-distribution`.

**What is missing**

1. Interpreter shadow support: `$shadow`/`defaults.shadow` resolution, `attachShadow` (or adopting a declarative root), `:host` translation in `applyStyle`, so Studio's canvas, live preview and `mount()` render a shadow component as a built site does.
2. `site-build.ts` passes `defaults` to `compileElement`, with a test on the emitted module.
3. Light-DOM slots leave no node in built output (§16.6's "A `<slot>` leaves no node"), delivered by the prerequisite; this plan re-checks `:empty` and `& > x` against the emitted module once it lands.
4. Editorial, owned here: §18's WHATWG DOM row still says "Shadow trees are not used at all (§16.6)", which the compiler has contradicted since `$shadow` shipped. Its Note cell is corrected with this plan's spec edit.

**Related**

- §8.5 (slot support, `plan:spec/compiled-slot-distribution`), §9.6 (the stylesheet engine), §18 (WHATWG DOM, WHATWG HTML, CSS Scoping rows).
- `compiler.md` §4, `studio.md` (canvas rendering), `site-architecture.md` §14.3.1 (CSP).
