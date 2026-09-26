---
status: stub
disposition: implement
claims:
  - spec.md#10.3
  - spec.md#10.4
size: M
workspaces:
  - packages/compiler
  - packages/schema
  - packages/runtime
---

# Compiled mapped arrays filter, sort and reconcile rows by key, and a key accepts both spellings of a `$map` pointer

## Context

Both sections are open for the same emitters, `emitMappedArray` in the element target and the mapped-array paths of the client target, so one stub claims both.

`specs/spec.md` §10.3, line 1126:

> **Status: Partial.** The interpreter filters and sorts (`renderMappedArrayInto` in `packages/runtime/src/runtime.ts`). No compiled path reads either key: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts`, both mapped-array emitters in `compile-client.ts` and the site build's build-time `expandMappedArrayStatic` (`packages/compiler/src/site/site-build.ts`) map `items` as given, so a built list shows every item in source order.

The section's trailing `Implemented` marker describes the interpreter and stays.

`specs/spec.md` §10.4, line 1142:

> **Status: Partial.** The interpreter reconciles by key as described below. The compiled targets do not: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts` and the client target lower a mapped array to an unkeyed `.map()` with no lit `repeat()`, so compiled rows are rebuilt rather than moved. And a `key` spelled `#/$map/item/…` is refused by the schema (`ArrayNamespace.key`) and falls back to the index at runtime (`mappedRowKey`).

The marker used to open `Implemented` while naming the compiler lowering as pending; the census moved the pending half to a leading Partial.

**What exists**

- `renderMappedArrayInto` (with its inner `reconcile`) and `mappedRowKey` in `packages/runtime/src/runtime.ts`, with `packages/runtime/tests/keyed-lists.test.ts`.
- `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts` and the mapped-array path in `compile-client.ts`, both a plain `.map()` that ignores `key`.
- The `ArrayNamespace.key` pattern `^\$map/item(/.+)?$` in the generated schema.
- `expandMappedArrayStatic` in `packages/compiler/src/site/site-build.ts`, the build-time expansion of a mapped array over compile-time data, which reads `items` and `map` only.
- The interpreter's filter and sort: `const { items, map, filter: filterRef, sort: sortRef, key } = arrayDef` in `renderMappedArrayInto`.

**What is missing**

- `filter` and `sort` in every compiled path: the element target, both client-target emitters and `expandMappedArrayStatic`, applied before keying, with the interpreter's semantics for a `$ref` to a function state entry.
- An inline `items` array, which the schema admits (`ArrayNamespace.items` is a `RefObject` or an array) though §10.1 shows only the `$ref` form: `emitMappedArray` lowers it to the undeclared identifier `ITEMS` (`const itemsExpr = isRef(arrayDef.items) ? refToExpr(...) : "ITEMS"`), a `ReferenceError` at render. Not a spec.md open item, but the fix lands in the same emitter.
- lit `repeat(items, keyFn, template)` lowering whenever `key` is declared (and index keys otherwise, matching the interpreter's default), in both compiled targets; the duplicate-key warning in compiled output.
- The `#/$map/item/…` spelling for `key`: widen the schema pattern and teach `mappedRowKey` the prefix, as §10.4's second paragraph says of every `$map` pointer.

**Related**

- §10.1, §10.2 (iteration context), §14.1 (a `$switch` on a row).
- `compiler.md` §4.7 (mapped array compilation).
