---
status: stub
disposition: implement
claims:
  - spec.md#14.1
size: M
workspaces:
  - packages/compiler
---

# A built site renders an external `$ref` `$switch` case instead of an empty container

## Context

`specs/spec.md` §14.1, line 1561 (the trailing `Implemented` marker describes the interpreter and stays):

> **Status: Partial.** The interpreter implements the section (below). No compiled target renders an external `$ref` case: `compile-client.ts`, `compile-element.ts` and the static prerender in `packages/compiler/src/shared.ts` filter them out, so a built page renders an empty container for the example that follows, with no diagnostic.

**What exists**

- `renderSwitch` in `packages/runtime/src/runtime.ts`: external cases load into an isolated scope, stale loads are discarded, an unchanged key keeps its case. `packages/runtime/tests/switch-scope.test.ts`.
- `packages/compiler/src/targets/compile-client.ts` and `compile-element.ts` drop `$ref` cases ("cannot be fetched at compile time"); the static prerender in `shared.ts` renders the empty container.

**What is missing**

- Compiling each external case document at build time (the site build already knows every referenced file) into a module or template the switch can render, with an isolated scope, so the section's own example works in a built site. The route-level decision (static prerender of the initial case, lazy module for the rest) is the detail phase's.
- At minimum, until that lands, a build diagnostic naming each dropped case.
- `no-eval.test.ts` gains the external-case compile its old marker claimed (§21.1).

**Related**

- §13.4 (scope isolation), §15.3, §21.1.
- `compiler.md` §4.8 (`$switch` compilation), §9.2 (`$switch` on a dynamic page).
