---
status: stub
disposition: reconcile
claims:
  - schema.md#3.1
  - schema.md#4
requires:
  - schema/prototype-property-declarations
  - spec/request-url-params
size: M
---

# schema.md describes the component schema, its generator and its artifacts as they ship

## Context

`specs/schema.md` §3.1, line 47:

> **Status: Partial.** The shapes below validate, but four statements outrun `generateSchema` (`packages/schema/src/schema.ts`). `computeWebData` takes only the `EventHandler` names from `@webref/idl`, so no DOM property set is derived (`ElementDef` hand-declares its common properties and admits the rest through `additionalProperties`), and the `@webref/elements` names are `examples` on the pattern-typed `TagName`, not an enumeration. `ExternalClassDef` declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`, and a computed `state` entry is admitted by `StateEntry`'s plain string branch, not a pattern match.

`specs/schema.md` §4, line 189:

> **Status: Partial.** `computeWebData` (`packages/schema/src/schema.ts`) extracts the non-obsolete tag names, the CSSOM camelCase names and the `EventHandler` names, but no per-element property set, so step 2 is half done. `runSchemaCli` composes and writes seven artifacts, not the three steps 5 and 6 name: `extension-manifest.schema.json` and `schemas/project.core.schema.json`, `project.fields.schema.json` and `document.paths.schema.json` as well.

Both sections were unmarked before the census. One stub owns both because they are one piece of work: the webref-derivation claim is made in each (§3.1 "All standard HTML DOM properties derived from `@webref/idl`", §4 step 2 "their valid properties") and again in §7's WHATWG HTML note, so a single decision closes it everywhere, and the rest of each section is the same inventory pass over the same generator.

Disposition `reconcile`, because the code's choices look deliberate. An open `ElementDef` with a hand-declared common subset is what custom elements and extension-contributed properties need. `TagName`'s pattern, which §3.1 itself specifies further down ("`TagName` is a name, never an expression"), admits custom-element names an enumeration would reject, so "enumeration" contradicts the section's own later bullet. A `${` pattern branch beside `StateEntry`'s plain-string branch would match twice under `oneOf`. The seven artifacts are exactly what `schema:verify` regenerates.

The marker's prototype-property sentence is the one part that closes by code rather than by text, and this plan owns none of that code. It requires two plans for it:

- `plan:schema/prototype-property-declarations` declares FormData `fields` and Blob `parts` and `type` on `ExternalClassDef`, which the runtime already reads.
- `plan:spec/request-url-params` owns Request `urlParams` across the runtime, `emitRequestFetch` and the schema declaration. If it lands as `implement`, the schema declares the field; if detailing falls back to reconciling spec.md's examples, §3.1's `Request` line drops it. Either way this plan's §3.1 edit follows that plan's answer.

**What exists**

- `packages/schema/src/schema.ts`: `computeWebData` (tag names become `tagExamples`, CSS `styleDeclaration` names, `EventHandler` names), `buildEventHandlerProperties`, `buildCssProperties`, `generateSchema`, and `runSchemaCli`, which writes the seven files.
- `packages/schema/defs/element-def.schema.ts` (the hand-declared properties and `additionalProperties: ElementPropertyValue`), `tag-name.schema.ts`, `state-entry.schema.ts`, `external-class-def.schema.ts` (`BUILT_IN_PROTOTYPES` and the one flat property set).
- `packages/schema/tests/schema.test.ts`, `real-site-gaps.test.ts`, `schema-cli.test.ts`, and `scripts/check-schema-freshness.ts`.

**What is missing**

- §3.1: the "tagName enumeration" bullet (it is `examples` on a pattern), the DOM-property bullet (say the set is hand-declared, or derive per-element IDL attribute sets, which is the one decision here that could turn into real code and would change this plan's disposition if taken), the Computed row's "String pattern match" cell, and the root-field list, which omits the declared `$shadow` and `$translationKey`. The `$switch` discriminant admits `MapRef` as well as `StateRef`. The marker's prototype-property sentence goes once the two required plans land.
- §4: step 2 as decided above, and steps 5 and 6 naming the seven artifacts. The same inventory also lags in unmarked text that moves with it: §1's "three Jx meta-schemas", §5's "Three JSON Schema 2020-12 documents", and §6's table (which omits `ajv` and `ajv-formats`).
- §3.3's role list, which omits `rewrite`, `head` and `assets` although `CLASS_METHOD_ROLES` and the drift test carry them. It is editorial, with the same `reconcile` direction, and rides here so it has an owner.
- §7's WHATWG HTML note ("the `tagName` enumeration, the DOM property set") corrected to what the generator derives.

**Related**

- spec.md §5.3 (the `state` entry shapes, and the Request example that uses `urlParams`).
- spec.md §11.1 and §11.2 (the built-in prototypes and what each reads).
- schema.md §7 (the WHATWG HTML and CSSOM rows).
- extensions.md §8 (the capability roles §3.3 lists).
