---
status: stub
disposition: reconcile
claims:
  - spec.md#13.3
requires:
  - _shared/compiled-prop-bridge
size: S
---

# Signal forwarding is specified as it ships: one way, parent to child

## Context

`specs/spec.md` §13.3, line 1545:

> **Status: Partial.** Forwarding is one way, parent to child, and fully so only in the interpreter, which writes the resolved value onto the child as a property and re-writes it from an effect when the parent changes (`renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`). A compiled parent binds `.prop=`, but the compiled element defines no property accessors and reads a property once, in `connectedCallback` (§16.2), so it takes the parent's value at connection and loses every later change. In both tiers a child's write to a primitive prop updates only the child, and only a shared object or array proxy is seen by both scopes.

The section says "the child receives the same reactive reference — writes in either scope trigger effects in both".

Two gaps sit under this anchor with different dispositions. The direction of flow is a `reconcile`: the spec promises two-way, both tiers are one-way by design. Re-delivery in compiled output is an `implement`, and it is the compiled property bridge `plan:_shared/compiled-prop-bridge` builds for §16.2, so this plan requires that one and does only the paper half.

**What exists**

- `renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`: the resolved `$ref` value is written as a property, re-written from an effect; the child's `connectedCallback`, and after connection its accessor, carries it into the child's own scope.
- Compiled parents bind `.prop=` (`packages/compiler/src/targets/compile-element.ts`, `compile-client.ts`). The compiled child absorbs the property only in `connectedCallback`, so a re-committed binding is lost until `plan:_shared/compiled-prop-bridge` lands.

**What is missing**

- The section rewritten to the one-way contract both tiers ship once the prerequisite lands: a `$ref` prop re-delivers the parent's value when it changes; a child that needs to change parent state calls a function prop (`onAction` in §13.2's example) or dispatches an event (§20.2); an object or array prop is shared by reference, so its mutations are visible to both.
- Disposition `reconcile`: one-way flow is what §2.4 ("explicit over implicit") and §15.3 imply, and making primitive props two-way would need a write-back channel no tier has. Detailing confirms that decision before rewriting.
- `docs/framework/concepts/props-and-scope.md` repeats the bidirectional claim twice.

**Related**

- §2.4, §13.2, §15.3, §16.2, §20.2 (`dispatchEvent`).
