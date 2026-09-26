---
status: stub
disposition: implement
claims:
  - spec.md#19.4c
size: M
workspaces:
  - packages/runtime
  - packages/compiler
---

# Named-formula recursion is bounded in every tier and a static cycle is a build error

## Context

`specs/spec.md` §19.4c, line 2050:

> **Status: Partial.** Named formulas, `$args/`, `call`, `BLESSED_GLOBALS` and `BLESSED_HELPERS` ship (`packages/runtime/src/expression.ts`). Recursion is not bounded as stated: no compiler check rejects a call cycle, the callable `buildScope` builds does not carry `callDepth`, so `MAX_CALL_DEPTH` bounds only the raw-definition path, and compiled formulas (`emitFormulaFn` in `packages/compiler/src/shared.ts`) have no bound. The helper table is stale: eight helpers ship (`packages/schema/src/intl.ts`, site-architecture.md §13.7), not three.

The implementation half and the stale-text half share the anchor; the text half is a reconcile inside an `implement` plan.

**What exists**

- `packages/runtime/src/expression.ts`: `BLESSED_GLOBALS`, `BLESSED_HELPERS`, the `call` case with `MAX_CALL_DEPTH` on the raw-definition path, `compileHelperCall`.
- `buildScope` in `packages/runtime/src/runtime.ts` lowers a named formula to a positional callable that calls `evaluateExpression(node, state, null, { args })` without a depth.
- `emitFormulaFn` in `packages/compiler/src/shared.ts`; `packages/site/src/context.ts` merges project state (project-global formulas) into page state.
- `packages/schema/src/intl.ts`: `formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`, `plural`, `compare`, `displayName`, `segment`. Helpers default the locale to `$page.locale`, then `en-US`, and `formatDate` to UTC.

**What is missing**

1. A build-time call graph over each page's merged formulas (page plus project state) that rejects a cycle with its path.
2. `callDepth` carried through the `buildScope` callable, so recursion through a mounted document's formulas stops at `MAX_CALL_DEPTH` instead of overflowing the stack.
3. A bound in compiled formulas, or a statement that compiled formulas rely on (1) alone. Detail decides.
4. The helper table rewritten to the eight helpers and their real defaults, citing `site-architecture.md` §13.7 rather than restating it.

**Related**

- §5.3 4d (parameters), §7.4 (`$args/`), §19.4 (`call` in the closed set, `plan:spec/expression-build-checks`), §20.3 (the same callable lowering), `site-architecture.md` §13.7.
