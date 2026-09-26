---
status: stub
disposition: implement
claims:
  - spec.md#20.3
size: S
workspaces:
  - packages/compiler
---

# The element target lowers a parameterised structured body to a positional callable

## Context

`specs/spec.md` §20.3, line 2369:

> **Status: Partial.** The interpreter and `compile-client.ts` lower both forms. The element target does not: a structured body with `parameters` always lowers to a `(s, e)` handler in `packages/compiler/src/targets/compile-element.ts`, not a positional callable, and its `$args/` refs compile to `_args.x` with no `_args` in scope.

**What exists**

- The interpreter's structured-body lowering in `buildScope` (`packages/runtime/src/runtime.ts`): with `parameters`, a positional callable binding `$args`; without, a `(state, event)` handler.
- `packages/compiler/src/targets/compile-client.ts` wraps the compiled statements in `emitFormulaFn` when `parameters` exist.
- `compile-element.ts`'s `hasStructuredBody` branch always emits `this.state.key = (s, e) => { … }`.

**What is missing**

- The element target uses `emitFormulaFn` for a parameterised structured body, as the client target does, with a test calling it through `call` and through `state.key(…)`.

**Related**

- §19.4c (the named-formula pattern, `plan:spec/named-formula-recursion`), §20.2 (`plan:spec/compiled-statement-await`), §5.3 4b.
