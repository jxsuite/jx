---
status: stub
disposition: implement
claims:
  - spec.md#4b
requires:
  - spec/callable-classifier
size: S
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/schema
---

# An inline Function body is classified as computed or callable by one rule, in every tier

## Context

`specs/spec.md` §5.3 4b, line 396:

> **Status: Partial.** The bare-`return;` rule ships in every tier through `bodyReturnsValue` (`packages/schema/src/guards.ts`). The "no `arguments`" condition holds only in the interpreter (`resolveFunction` in `packages/runtime/src/runtime.ts`): `compile-element.ts`, `compile-client.ts` and the build-time scope in `packages/compiler/src/shared.ts` classify a string body by `bodyReturnsValue` alone, so a body with declared `parameters` that returns a value compiles to a `computed()` with its parameter unbound. No tier classifies by reactive use, as the first paragraph below describes; classification reads the declaration and the body text.

**What exists**

- `bodyReturnsValue` in `packages/schema/src/guards.ts`, shared by every tier, implements the bare-`return;` and ASI rules.
- `resolveFunction` in `packages/runtime/src/runtime.ts` computes `hasParams` from `parameters ?? arguments` and never makes a parameterised entry computed.
- `packages/compiler/src/targets/compile-element.ts` (the `typeof d.body === "string" && bodyReturnsValue(d.body)` branch), `packages/compiler/src/targets/compile-client.ts` (the "Body contains return → computed" branch) and the build-time scope in `packages/compiler/src/shared.ts` test the body only.

**What is missing**

- The compiled tiers ignore `parameters`/`arguments`: a helper such as `{ "parameters": ["x"], "body": "return x * 2" }` is callable in Studio and becomes a value on the built site, with `x` unbound.
- The spec's "detects it is referenced reactively" and "no event binding" conditions are not implemented anywhere; classification is by body text. Either the rule is implemented (usage-based, as `collectCallableRefs` in `compile-element.ts` already does for `$src` entries, §5.3 4d) or the sentence is reconciled to the body-text rule. The detail phase decides; the parameter half is a bug in any case.

**Enabled by `plan:spec/callable-classifier`**, which this plan requires. That plan builds the one document-level classifier every tier calls, with the "no `arguments`" condition in it, so the parameter half above is closed there. What stays here is the usage-half decision and the §5.3 4b text. If detail chooses the usage-based rule, it changes that classifier's inline-body branch, one place rather than four tiers. The size is `S` for that reason.

**Related**

- §5.3 4d (the external-Function classification rule, same machinery: `plan:spec/function-entry-tier-parity`), §19.4c (a parameterised entry is callable), §20.3 (the structured-body equivalent).
- `compiler.md` §4 (custom element compilation).
