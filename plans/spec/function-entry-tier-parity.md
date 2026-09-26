---
status: stub
disposition: implement
claims:
  - spec.md#4d
requires:
  - spec/callable-classifier
size: M
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/schema
---

# Every Function-entry rule in §5.3 4d holds in the interpreter and in every compiled target

## Context

`specs/spec.md` §5.3 4d, line 425:

> **Status: Partial.** The property table, parameter-object normalization and compiled-site bundling (`packages/compiler/src/site/bundler.ts`) ship. Four rules hold in only some tiers: usage-based classification of a `$src` entry is `compile-element.ts`'s alone (the interpreter introspects the imported function, and `compile-client.ts` makes every `$src` entry a computed, so a `$src` handler bound to `on*` attaches no listener); declaring both `body` and `$src` throws at runtime scope build but is never a compile-time error; `compile-client.ts` ignores `$lazy`; and the interpreter's `resolveParamNames` recognizes `state` only in first position rather than binding by name.

The four gaps share one anchor, so they share this stub, but they are separate pieces of work. The first is built by `plan:spec/callable-classifier`, which this plan requires; items 2 to 4 are this plan's own.

**What exists**

- `collectCallableRefs` in `packages/compiler/src/targets/compile-element.ts` classifies a `$src` entry by document usage (`on*` binding, `call` node, lifecycle key), as the spec requires, except that it never reads a root-level `on*` handler (§16.1; `plan:spec/callable-classifier` has the evidence). It honours `$lazy`, including its computed-use build error.
- `resolveFunction` in `packages/runtime/src/runtime.ts` throws on `body` plus `$src` at scope build, and classifies an imported function by `fn.length <= 1 && bodyReturnsValue(fn.toString())`.
- `packages/compiler/src/targets/compile-client.ts` pushes every `$src` entry to `computedEntries` ("$src functions always produce computed entries"); `packages/compiler/tests/compile-client.test.ts` pins that emission.
- `resolveParamNames` in `runtime.ts` prepends `state` unless it is the first name; `compile-client.ts`, `compile-element.ts` and `shared.ts` bind by name.
- `packages/schema/defs/function-def.schema.ts` states the mutual exclusion only in a description.

**What is missing**

1. Usage-based classification of `$src` entries in the interpreter and in `compile-client.ts`, so an `on*` `$ref` to a `$src` handler on a dynamic page attaches a listener. `plan:spec/callable-classifier` builds it: the interpreter's `fn.length` introspection and `compile-client.ts`'s always-computed branch both give way to its verdict, and this plan flips the marker once that lands.
2. A compile-time error (and a schema `not`/`oneOf`) for an entry declaring both `body` and `$src`.
3. `$lazy` in `compile-client.ts`: a memoized dynamic `import()` and the computed-use build error, which reads the verdict from `plan:spec/callable-classifier` as `compile-element.ts`'s reads `collectCallableRefs` today.
4. By-name parameter binding in the interpreter: `["event", "state"]` must bind `state` to the reactive state, not produce a duplicate parameter.

**Related**

- §5.3 4b (inline classification, `plan:spec/computed-function-classification`, which requires the same classifier), §16.4 (lifecycle keys are callables), §19.4c (`call` nodes make an entry callable).
- `compiler.md` §12 (sidecar bundling).
