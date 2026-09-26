---
status: stub
disposition: reconcile
claims:
  - spec.md#13.1
size: S
---

# The component-instance example registers its dependency in the `$elements` array form that code accepts

## Context

`specs/spec.md` §13.1, line 1499 (the section's `Removed` marker at line 1520, about node-level `$ref` children, is accurate and stays):

> **Status: Partial.** Registration and instantiation by tag ship. The example below is wrong: `$elements` is an ARRAY of `{ "$ref" }` objects or package names (the schema's `type: "array"`, `registerElements` in `packages/runtime/src/runtime.ts`, `compileElement`), and the tag comes from the referenced document's own `tagName`, not a key; the keyed map shown throws at runtime and fails validation.

Before the census the section led with that `Removed` marker, so it read as removed on every derived page although instantiation by tag works.

**What exists**

- `packages/schema/schema.json`: `$elements` is `type: "array"`, items a `{ $ref }` object or a package-name string.
- `registerElements` in `packages/runtime/src/runtime.ts` and `compileElement` in `packages/compiler/src/targets/compile-element.ts` iterate it as an array and take the tag from each referenced document.
- `renderNode` warns once per target on a node-level `$ref` child (`warnedRefChildren`).

**What is missing**

- The example rewritten to `"$elements": [{ "$ref": "./components/card.json" }]`, with a sentence that the tag comes from `card.json`'s `tagName`. Disposition `reconcile`: §16.3 already shows the array form, so the code and the rest of the spec agree.
- The same stale map form in `docs/framework/concepts/components.md` and `docs/framework/concepts/props-and-scope.md`.

**Related**

- §16.3 (`$elements`), §7.2 (external-file refs), §14.1.
