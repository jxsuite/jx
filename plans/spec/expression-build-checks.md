---
status: stub
disposition: implement
claims:
  - spec.md#19.3
  - spec.md#19.4
  - spec.md#19.5
size: M
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/schema
---

# The build refuses what §19 calls a compile-time error: an unknown operator, a mutating operand, and `event#/` outside a handler

## Context

Three sections each state a compile-time error that no build raises. They are one piece of work: a single structural check over every expression tree, run by `jx build` and `jx validate`, so one stub claims all three.

`specs/spec.md` §19.3, line 1907:

> **Status: Partial.** Arity and mode routing ship (`isMutating` in `packages/runtime/src/expression.ts`; `buildScope` and the compiled targets route a mutating node to a handler and a pure node to a computed). Nothing enforces that a mutating node never appears as an operand: the schema's `ExpressionOperand` (`packages/schema/defs/expression-node.schema.ts`) admits the assignment and array-mutation branches, and the interpreter performs such a mutation as a side effect of evaluating the operand.

`specs/spec.md` §19.4, line 1936:

> **Status: Partial.** The set is closed in the schema, so `jx validate` rejects an unknown operator, and in the interpreter, which throws on one. The compiler does not refuse it: `compileExpression` (`packages/runtime/src/expression.ts`) falls through to `"undefined"`, a test pins that, and `jx build` runs no schema validation, so a document with an unknown operator builds. The table also omits `call` (§19.4c) and the §19.4d methods, which the closed set includes.

`specs/spec.md` §19.5, line 2135:

> **Status: Partial.** The scheme resolves in the interpreter and compiles to the handler's event parameter (`packages/runtime/src/expression.ts`). The compile-time error is not implemented: no compiler, schema or `jx validate` check restricts `event#/` to handler position, so a pure computed that reads it resolves against a null event.

**What exists**

- `packages/runtime/src/expression.ts`: `BLESSED_OPERATORS`, `MUTATING`, `isMutating`, `evaluateExpression` (throws on an unknown operator), `compileExpression` (returns `"undefined"`; `packages/runtime/tests/expression.test.ts` asserts "unhandled operator compiles to undefined"), `resolveExprRef` (`event#/`).
- `packages/schema/defs/expression-node.schema.ts`: the operator enums in a `oneOf`, the `ExpressionOperand` union, the pointer pattern admitting `event#/` anywhere.
- `packages/compiler/src/site/validate-command.ts`: schema validation plus the popover, dialog and accessibility lints.

**What is missing**

- One walker (beside `compileExpression`, so both tiers share it) that reports, with the node's path: an operator outside the closed set; a mutating node in operand position; an `event#/` pointer in a node that is not in handler position (a pure `state` entry, a template position, a `tagName`).
- `compileExpression` throws instead of emitting `undefined`, and the pinning test changes with it; `jx build` fails the route with the walker's diagnostic; `jx validate` reports the same findings; the schema's `ExpressionOperand` excludes the mutating branches.
- §19.4's table gains `call` and a pointer to §19.4d (editorial, same anchor).

**Related**

- §19.4c (`call`), §19.4d, §19.6 (handler position), §19.8 (compilation), §20.2 (statements are handler position).
- `compiler.md` §2 (compilation routes).
