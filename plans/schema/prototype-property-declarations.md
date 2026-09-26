---
status: stub
disposition: implement
claims: []
size: S
workspaces:
  - packages/schema
---

# ExternalClassDef declares the FormData and Blob properties the runtime reads

## Context

This plan claims nothing: it enables `plan:schema/generator-inventory`, which owns §3.1 and requires it. It was split out of that plan because it is code, where the rest of §3.1's closure is a `reconcile` of the text.

`specs/schema.md` §3.1, line 47, names the gap in its marker:

> `ExternalClassDef` declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`, and a computed `state` entry is admitted by `StateEntry`'s plain string branch, not a pattern match.

§3.1's "Built-in Prototypes" list promises `FormData` "default fields" and `Blob` "parts, type", and the runtime reads exactly those. Request `urlParams` is not part of this plan: `plan:spec/request-url-params` owns it (the runtime, `emitRequestFetch` and the schema declaration together), because nothing reads it yet.

**What exists**

- `packages/schema/defs/external-class-def.schema.ts`: `BUILT_IN_PROTOTYPES` and the one flat property set shared by every state `$prototype` (`autoIncrement`, `body`, `database`, `debounce`, `default`, `filter`, `headers`, `indexes`, `items`, `key`, `keyPath`, `manual`, `map`, `maxAge`, `method`, `name`, `path`, `responseType`, `sameSite`, `secure`, `sort`, `src`, `store`, `timing`, `url`, `version` and the `$` keys). None of `fields`, `parts` or `type` is declared; a document using them validates only because the def is open.
- `packages/runtime/src/runtime.ts`, `resolvePrototype`: the `FormData` case (line 2994) appends every entry of `def.fields`; the `Blob` case (line 3002) builds from `def.parts` with `def.type`, defaulting to `text/plain`.

**What is missing**

- `fields` (an object of string values), `parts` (an array) and `type` (a string) declared on `ExternalClassDef`, with validation tests in `packages/schema/tests/schema.test.ts`, and the committed schemas regenerated (`bun run schema:sync`).
- Two checks the detail phase owns. The property set is shared by every `$prototype`, so a new name constrains every extension class that declares the same one (§3.1's `filter` and `sort` bullet is the precedent): list the shipped extension classes that declare `fields`, `parts` or `type` and keep their shapes admissible. And `type` also names `TypedStateDef`'s type keyword, so confirm `StateEntry`'s `oneOf` still picks exactly one branch for a typed entry and for a `Blob`.

**Related**

- spec.md §11.2 (the `FormData` and `Blob` rows).
- schema.md §3.1 ("Built-in Prototypes" and the `ExternalClassDef` bullet under "Element Properties").
