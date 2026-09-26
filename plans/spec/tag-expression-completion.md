---
status: stub
disposition: implement
claims:
  - spec.md#19.6
size: M
workspaces:
  - packages/compiler
---

# A tag chosen at creation works on a dynamic page, and `jx validate` warns when its discriminant is also written

## Context

`specs/spec.md` §19.6, line 2174:

> **Status: Partial.** All three positions ship in the interpreter, the element target and the static target. Two parts do not: `jx validate` has no lint for a tag discriminant that is also an assignment target (`packages/compiler/src/site/validate-command.ts` runs only the popover, dialog and accessibility lints), and `compile-client.ts` refuses a tag expression on a dynamic page ("A tag chosen at creation is not supported on a dynamic page yet").

Two items under one anchor; they are independent and may split during detailing.

**What exists**

- `resolveTagName` in `packages/runtime/src/runtime.ts` (resolved once); `packages/compiler/src/targets/compile-element.ts` (one template per candidate); `packages/schema/defs/tag-expression.schema.ts`; `packages/runtime/tests/tag-expression.test.ts`, `packages/compiler/tests/tagname-expression-targets.test.ts`.
- `packages/compiler/src/targets/compile-client.ts` throws on a tag expression in the client target.
- The lint is named only in comments (`tag-expression.schema.ts`, `runtime.ts`).

**What is missing**

1. Client-target support: one lit template per candidate, chosen once at creation, matching the element target.
2. A `jx validate` lint (and a Studio problem) that warns when a `TagExpression`'s discriminant pointer is the `target` of any assignment or array-mutation node, or is written by a string body, in the same document.

**Related**

- §19.3 (mutating nodes), §3.1 (the root `tagName` stays literal), `compiler.md` §4.8 (one template per branch, shared subtrees hoisted).
