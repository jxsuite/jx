---
status: stub
disposition: implement
claims:
  - spec.md#8.1
size: M
workspaces:
  - packages/compiler
---

# The static emitter writes every DOM property an element definition sets, not seven of them

## Context

`specs/spec.md` §8.1, line 679:

> **Status: Partial.** The runtime writes any non-reserved key as a DOM property, and the lit element target binds it. The static emitter does not: `buildAttrs` (`packages/compiler/src/shared.ts`), which `compile-static`, the client prerender and the component prerender share, writes only `id`, `className`, `hidden`, `tabIndex`, `title`, `lang` and `dir`, so `href`, `src`, `alt`, `value`, `placeholder`, `type`, `checked`, `disabled`, `name` and `selected`, all declared on `ElementDef`, are dropped from prerendered HTML.

**What exists**

- `applyProperties` and `bindProperty` in `packages/runtime/src/runtime.ts` write any key outside `RESERVED_KEYS` as a property.
- `buildAttrs` in `packages/compiler/src/shared.ts` resolves exactly seven node-level keys, then `style`, then `attributes`.
- `packages/compiler/src/site/image-transform.ts` works around the gap for one key: it lifts a node-level `src` into `attributes` before emitting, and says why in a comment. It does not lift `alt`.
- Verified: `compile({ tagName: "a", href: "/x" })` emits `<a>`, and `{ tagName: "input", value, placeholder, type, disabled }` emits a bare `<input>`.

**What is missing**

- A property-to-attribute mapping for the static emitter: the reflected IDL attributes (`href`, `src`, `alt`, `type`, `name`, `placeholder`, and the rest `ElementDef` declares), boolean reflections through `booleanAttrValue` (`checked`, `disabled`, `selected`), and a rule for properties with no content attribute (`value` on a text control reflects to `value`, `textContent` is already content). One table, shared with the runtime so a prerendered page cannot change meaning as it hydrates (§8.3's rule).
- Removing the `image-transform.ts` workaround once `src` is emitted.

**Related**

- §8.3 (the same four-writer agreement for attributes), §8.2 (`id` and `tagName`).
- `compiler.md` §8.1 (fully static output).
