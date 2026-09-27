---
status: drafted
disposition: reconcile
claims:
  - schema.md#3.1
  - schema.md#4
requires:
  - schema/prototype-property-declarations
  - spec/request-url-params
size: S
---

# schema.md describes the component schema, its generator and its seven artifacts as they ship

## Context

`specs/schema.md` §3.1, line 47:

> **Status: Partial.** The shapes below validate, but four statements outrun `generateSchema` (`packages/schema/src/schema.ts`). `computeWebData` takes only the `EventHandler` names from `@webref/idl`, so no DOM property set is derived (`ElementDef` hand-declares its common properties and admits the rest through `additionalProperties`), and the `@webref/elements` names are `examples` on the pattern-typed `TagName`, not an enumeration. `ExternalClassDef` declares none of Request `urlParams`, FormData `fields` or Blob `parts` and `type`, and a computed `state` entry is admitted by `StateEntry`'s plain string branch, not a pattern match.

`specs/schema.md` §4, line 189:

> **Status: Partial.** `computeWebData` (`packages/schema/src/schema.ts`) extracts the non-obsolete tag names, the CSSOM camelCase names and the `EventHandler` names, but no per-element property set, so step 2 is half done. `runSchemaCli` composes and writes seven artifacts, not the three steps 5 and 6 name: `extension-manifest.schema.json` and `schemas/project.core.schema.json`, `project.fields.schema.json` and `document.paths.schema.json` as well.

Both sections were unmarked before the census. One plan owns both because one decision (is a DOM property set derived from `@webref/idl`?) is written in three places: §3.1 ("All standard HTML DOM properties derived from `@webref/idl`"), §4 step 2 ("their valid properties") and §7's WHATWG HTML note ("the `tagName` enumeration, the DOM property set"). The rest of each section is the same inventory pass over the same generator. Re-verified against `84735a9f` on 2026-09-27.

**What ships** (all in `packages/schema/`)

- `src/schema.ts`: `loadWebData` memoizes `computeWebData`, which returns `tagExamples` (every non-obsolete name `@webref/elements` lists: 212 names across HTML, SVG 1.1 and 2, MathML Core and others), `cssProps` (every `styleDeclaration` name in `@webref/css`, which is the camel-cased attribute plus the dashed and webkit-cased forms: `background-color` and `backgroundColor`) and `eventHandlers` (301 `on*` attributes typed `EventHandler` on any IDL interface or mixin, including non-element ones such as `onupgradeneeded`). `generateSchema` puts the tag names in `TagName.examples` beside three custom-element samples, the CSS names in `StyleObject.properties` (`buildCssProperties`), and the handlers in `ElementDef.properties` (`buildEventHandlerProperties`). `runSchemaCli` writes seven files (`git ls-files 'packages/schema/*.json'` lists them beside `package.json`), or only the component schema when given an output path.
- `defs/tag-name.schema.ts`: the pattern `^[a-zA-Z][a-zA-Z0-9._-]*$`, no `enum`. `defs/element-def.schema.ts`: 30 hand-declared properties and `additionalProperties: ElementPropertyValue` (a scalar, `null` or a `RefObject`); `switchDefSchema` admits a `StateRef` or a `MapRef`. `defs/state-entry.schema.ts`: `StateEntry.oneOf` has one bare `{ type: "string" }` branch, and an `ExpressionEntry` branch (spec.md §5.7's Shape 5) that §3.1's shape table omits.
- The root document declares `$shadow` and `$translationKey`, which §3.1's root-field list omits, and admits any other key as an `ElementPropertyValue`.
- `defs/external-class-def.schema.ts`: `BUILT_IN_PROTOTYPES` (13 names, `Function` and `Array` among them; exported, read by nothing) and the flat property set. It is open, so `fields`, `parts`, `type` and `urlParams` validate today without being declared.
- The runtime (`resolvePrototype`, `packages/runtime/src/runtime.ts`) reads `URLSearchParams`'s own keys as its params, not a `default`; `FormData` reads `fields`; `Blob` `parts` and `type`; `Cookie` also `default`; `IndexedDB` also `autoIncrement`; and it has no `Array` case, so `$prototype: "Array"` in `state` hits the unknown-prototype warning. `Array` is the children-level `ArrayNamespace` (spec.md §10), as spec.md §11.2's marker already says.
- Measured with `validateDocument`: `{ "$prototype": "URLSearchParams", "sort": "date" }` fails (`sort` is the flat set's `$ref`/object/array union), while `{ …, "q": "shoes", "page": 2 }` passes. No shipped document uses `URLSearchParams`.
- `package.json` depends on `ajv` and `ajv-formats` (imported lazily by `validateWithSchema`); §6 names only the three `@webref/*` packages.
- `defs/class-def.schema.ts` `CLASS_METHOD_ROLES` carries `rewrite`, `head` and `assets`, which §3.3's prose role list omits (the audit record assigns that editorial fix here).

**What closes by code, elsewhere.** The marker's `ExternalClassDef` sentence is not text. `plan:schema/prototype-property-declarations` declares `fields`, `parts` and `type`; `plan:spec/request-url-params` owns `urlParams` in the runtime, `emitRequestFetch` and the schema, and its `implement` default keeps the field while its fallback drops it from every example. Both decide (as Decided, not Open) to declare their names under one shared `allOf` of `if`/`then` entries keyed on `$prototype`, not in the flat set, so there is no flat variant for this plan to allow for. Each pull request narrows §3.1's marker and appends its exception to the flat-set bullet (under `plan:spec/request-url-params`'s reconcile fallback there is no `urlParams` exception: that plan strikes the field from §3.1's `Request` line instead), so this plan inherits a shorter marker and a bullet that already names the exceptions. The cross-spec critic flagged `plan:spec/reconcile-built-in-prototypes` rewording spec.md §12.1's `Request` row around that answer; that plan now requires `plan:spec/request-url-params` and leaves the row alone, so the phrase has one owner and this plan follows the same answer for §3.1's `Request` line.

## Outcome

- schema.md §3.1 → Implemented: the marker is deleted and the section describes `TagName`'s pattern and examples, the hand-declared open `ElementDef`, the webref-derived `StyleObject` and handler names, the root fields and shapes the schema declares, and the configuration each built-in prototype reads.
- schema.md §4 → Implemented: the marker is deleted and the steps name what `computeWebData` extracts and the seven artifacts `runSchemaCli` writes.
- Riding along, unmarked: §1 and §5 (seven documents, three of them author-facing), §3.3's role list, §6's dependency table, and §7's WHATWG HTML and CSSOM notes.
- No code, test or docs page changes.

## Decisions

- **Open:** derive a per-element DOM property set from `@webref/idl`, or say that `ElementDef` hand-declares its common properties. Recommendation: say it (this plan stays `reconcile`), because a derived set could not reject anything. `ElementDef` has to stay open for custom-element and extension properties, a tag chosen by `ElementTagName`'s expression is not known statically, and a per-tag `if`/`then` over 212 names would grow a 626 KB `schema.json` to buy editor completion only. Taking the derivation instead turns this into an `implement` on `packages/schema` with new `schema.test.ts` cases, and §4 step 2 stays as written.
- **Open:** a `URLSearchParams` param whose name the flat property set declares (`sort`, `filter`, `method`, `version`, `key`, …) must take that declared shape. Recommendation: document it in §3.1's flat-set bullet and change no code, because the flat set is the documented design (the `filter`/`sort` precedent), nothing shipped hits it, and a `$ref` value clears the union-typed names. The prerequisites' `allOf` is the mechanism that would fix it: moving the names only `Request`, `Cookie` or `IndexedDB` reads out of the flat set into entries of their own would be a separate `implement` on `packages/schema`, regenerating every committed entry document.
- **Decided:** `tagName` is described as a pattern with webref `examples`, never an enumeration, because an `enum` would reject every custom element and §3.1's own `TagName` bullet (0.3.0) already fixes the pattern as the contract.
- **Decided:** the Computed row names `StateEntry`'s `string` branch and leaves `${` detection to the reader (spec.md §5.7), because a pattern branch beside the plain-string branch matches every template twice under `oneOf`, and splitting the branch with `not: { pattern }` would still admit every string.
- **Decided:** §3.1 points at `element-def.schema.ts` for the hand-declared list and does not copy the 30 names, and the Built-in Prototypes list names what each `resolvePrototype` case reads (plus `Request`'s `timing`, which the compiler's `prototype-resolver.ts` reads), not everything the flat set declares (`responseType` is declared and read by nothing, so it stays off). A copy would be a second list that no test holds to the first.
- **Decided:** both markers are deleted, not rewritten as `Implemented`, because both sections were unmarked before the census, like their unmarked siblings §3.3 and §5.
- **Decided:** one pull request after both prerequisites land, with no §4-first split, because the chain is short (`plan:spec/compiled-request-fetch`, S, then `plan:spec/request-url-params`, M; `plan:schema/prototype-property-declarations` is S with no prerequisite) and the webref decision is written into §3.1, §4 and §7 together.
- **Decided:** fragment level `minor`, the program's level for a `reconcile`, because nothing an author relies on is redefined: every statement moves to what validates today.

## Implementation

A paper plan. Once both prerequisites have landed and review has signed off the two Open decisions, one pull request makes the spec edits under Specs & docs, adds the fragment, and deletes this file. No other plan's `requires` names it.

1. Confirm the prerequisites' landed state: `packages/schema/defs/external-class-def.schema.ts` declares `fields`, `parts` and `type`, and `urlParams` if `plan:spec/request-url-params` landed as `implement`, each as an entry of `ExternalClassDef.allOf`. §3.1's `Request` line is as that plan left it: it lists `urlParams` under the `implement`, and its reconcile fallback has already struck the field, so this plan never adds or removes it. Read the flat-set bullet as they left it: the edits below keep its exception sentence verbatim.
2. `specs/schema.md` §1, §3.1, §3.3, §4, §5, §6 and §7, in place, as quoted under Specs & docs. No heading is renumbered or retitled.
3. `bun run spec:change schema.md minor -m "…"` with the sentence under Specs & docs. If this pull request closes schema.md's last open item, graduate instead (Specs & docs, last paragraph).
4. Delete `plans/schema/generator-inventory.md`.

Each prerequisite narrows §3.1's marker in its own pull request; this plan deletes whatever is left of it.

**Integration contract.** No plan requires this one. Once it lands, §4's step-6 table is the inventory of generated artifacts, and a change that adds one to `runSchemaCli` adds its row there in the same pull request. §3.1 states that `TagName` validates by pattern and that `ElementDef` is hand-declared and open, so a later plan that derives a property set or closes `ElementDef` edits §3.1's Element Properties bullets, §4 step 2 and §7's WHATWG HTML note together. `plan:spec/web-api-prototype-parity-readable-stream` (no edge either way) deletes the `ReadableStream` line of §3.1's Built-in Prototypes list under its recommended `remove`; if it lands first there is no line for this plan to keep, and if it lands second it deletes the line from this plan's list (its "All 12 built-in prototypes" edit is moot, since this plan replaces that lead). `plan:extensions/connector-serve-key` edits §3.3's admission-block bullet, the line after the role list this plan edits; whichever lands second rebases a one-line adjacency.

## Tests

No workspace suite changes and none needs to run: no source, test or fixture is touched, so no per-file coverage figure or `coverageThreshold` in `packages/schema/bunfig.toml` moves, and the manifest check is unaffected. The facts the new text states are already held by `packages/schema/tests/schema.test.ts` ("includes tag name examples from webref", "includes CSS properties from webref", "includes event handler properties", "StateEntry includes ExpressionEntry (Shape 5)", "$ref types include all reference patterns"), `class-schema-drift.test.ts` (the role enum) and `schema-cli-format.test.ts` (the default branch writes the fragments and the component schema).

The gates that prove it, all in the `checks` job:

- `bun run docs:status`: §3.1 and §4 carry no marker; the header stays `Partial` unless this graduates the spec.
- `bun run plans:check`: no `claim-not-open`, since this file is deleted with the markers, and no `unclaimed-open` for schema.md.
- `bun run docs:spec-release`: the body change is covered by the fragment (or by the in-place `spec:bump` when graduating).
- `bun run docs:standards`: the two rewritten §7 notes contain no `|` and keep their `Subset` class, and the added evidence paths exist.
- `bun run docs:check`, `bun run docs:links`: no heading or anchor moves; the new cross-references resolve.
- `bun run docs:markdown`: one paragraph per line, no escaped heading.
- `bun run schema:verify`: still green, which confirms the pull request touched no artifact.

## Specs & docs

All edits are to `specs/schema.md`, in place.

**§1.** After the three-item list, add: "It also generates the extension manifest schema and three resources that per-project schema composition embeds (§4, extensions.md §5)." In the paragraph after it, "The project and class schemas are static." becomes "The other six documents read no web data."

**§3.1.**

- Delete the Partial marker and its blank line.
- Root-level fields: add `$shadow` and `$translationKey` after `$dir`, and end the sentence with "; any other root key is admitted as an `ElementPropertyValue` (a scalar, `null` or a `$ref`)". Add a bullet: "`$shadow` renders the component into a shadow root (spec.md §16.6), and `$translationKey` names a page's identity across languages (site-architecture.md §13.5)".
- `tagName` optional bullet: append "; the schema requires it only on an element (`ElementDef`)".
- Replace "`tagName` enumeration: all standard HTML elements derived from `@webref/elements`" with "`tagName` validates by `TagName`'s pattern (below), not by a list. Every non-obsolete element name in `@webref/elements` (HTML, SVG and MathML among them) is one of its `examples`, for editor completion, so a custom element validates exactly as a standard one does".
- State shapes table: the Computed row's Schema Definition cell becomes "`StateEntry`'s `string` branch; the reader detects `${` (spec.md §5.7)". Add a row after Function: "Expression (`$expression`) | `ExpressionEntry` | **Implemented**".
- Built-in Prototypes: the lead sentence becomes "The built-in prototypes (`BUILT_IN_PROTOTYPES`) and the configuration each reads. `Function` is `FunctionDef`'s; every other one is an `ExternalClassDef`, whose property set is shared except for the names one built-in alone reads (the flat-set bullet under Element Properties, below):". The exception always exists once `plan:schema/prototype-property-declarations` has landed, whichever way `plan:spec/request-url-params` is signed. Lines change as follows: `URLSearchParams` becomes "its own keys, each one param (a value, a `$ref` or a `${}` template)"; `FormData` becomes "`fields`, appended in key order"; `Cookie` gains "default"; `IndexedDB` gains "autoIncrement"; `Array` becomes "a children-level node, `ArrayNamespace` (spec.md §10), not a `state` entry: items, map, filter, sort, key (a `$map/item` pointer; spec.md §10.4)"; `Request` is left exactly as `plan:spec/request-url-params` left it (step 1 of Implementation); `ReadableStream` stays "(stub)" unless `plan:spec/web-api-prototype-parity-readable-stream` has removed it; the rest are unchanged.
- Element Properties, first three bullets, replaced by:
  - "`ElementDef` declares a hand-written set of common properties (`packages/schema/defs/element-def.schema.ts`), each a scalar or a `$ref` of its type, and admits any other key as an `ElementPropertyValue`. That is how a DOM property the set omits, a custom element's own property or an extension's reaches the element. No per-element property set is derived from `@webref/idl`."
  - "`StyleObject` declares every CSS property's `styleDeclaration` names from `@webref/css`: the CSSOM camel-cased attribute and its dashed and webkit-cased forms."
  - "Every `EventHandler` attribute in `@webref/idl` (`onclick`, `oninput`, …) is an `ElementDef` property, from element and non-element interfaces alike."
- `$switch` bullet: "the discriminant is a `StateRef` (`#/state/…`)" becomes "the discriminant is a `StateRef` (`#/state/…`) or, inside a mapped row, a `MapRef` (`$map/item` or `$map/index`, optionally with a path)".
- Flat-set bullet (per the second Open decision): keep the exception sentence the prerequisites appended, and append after it "A `URLSearchParams` entry is the sharpest case: its keys are its params, so a param named after a property the flat set declares (`sort`, `method`, `version`, …) must take that property's shape, and a `$ref` value is the escape where the shape admits one."

**§3.3.** In the `$defs.methods` bullet, the format roles become `parse`, `serialize`, `rewrite`, `discover`, `load` and the admission-block roles `projectData`, `resolvePaths`, `lower`, `emit`, `head`, `assets`, `mount`, `dialect`, `deploySchema`, `bindings`, `testConnection` (the order of `CLASS_METHOD_ROLES`).

**§4.** Delete the marker. Replace the six steps and the trailing paragraph with:

> 1. Load `@webref/elements`, `@webref/css` and `@webref/idl`, once per process (`loadWebData`).
> 2. Collect every non-obsolete element name as `TagName`'s `examples` (§3.1). No per-element property set is derived.
> 3. Collect every CSS property's `styleDeclaration` names as `StyleObject`'s properties, each admitting a string, a number or a `$ref`.
> 4. Collect every `on*` attribute typed `EventHandler`, on any interface or mixin, as `ElementDef`'s handler properties, each admitting a `$ref`, an `$expression` or a `FunctionDef`.
> 5. Compose the component schema (`generateSchema`) from the `packages/schema/defs/` definitions and steps 2 to 4, and the six other documents from the definitions alone.
> 6. Write the seven artifacts (`runSchemaCli`, run by `bun run generate:schema`):
>
> | File                                 | `$id`                                              | Generator                         | Validates or serves                                                                                     |
> | ------------------------------------ | -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
> | `schema.json`                        | `https://jxsuite.com/schema/v1`                    | `generateSchema`                  | components, pages and layouts (§3.1)                                                                    |
> | `project-schema.json`                | `https://jxsuite.com/schema/project/v1`            | `generateProjectSchema`           | `project.json` (§3.2)                                                                                   |
> | `class-schema.json`                  | `https://jxsuite.com/schema/class/v1`              | `generateClassSchema`             | `.class.json` (§3.3)                                                                                    |
> | `extension-manifest.schema.json`     | `https://jxsuite.com/schema/extension-manifest/v1` | `generateExtensionManifestSchema` | `jx-extension.json` (extensions.md §4)                                                                  |
> | `schemas/project.core.schema.json`   | `https://jxsuite.com/schema/project/core/v2`       | `generateProjectCoreSchema`       | the core fragment of a project's `project.schema.json` (extensions.md §5.1)                             |
> | `schemas/project.fields.schema.json` | `https://jxsuite.com/schema/project/fields/v2`     | `generateProjectFieldsSchema`     | the shipped field-union default (extensions.md §5.3)                                                    |
> | `schemas/document.paths.schema.json` | `https://jxsuite.com/schema/document/paths/v2`     | `generateDocumentPathsSchema`     | the shipped `$paths` default, also embedded in `schema.json` as `$defs.PathsValue` (extensions.md §5.3) |
>
> Given an output path, the script writes the component schema alone, there. It formats the three `schemas/` files with oxfmt, and a formatter failure is a warning, because the JSON is already written.
>
> Only the component schema reads web data, so it changes when a `@webref/*` package does. Every artifact is committed; `bun run schema:verify` fails when one differs from its generator, and `bun run schema:sync` rewrites it.

**§5.** "Three JSON Schema 2020-12 documents:" becomes "Seven JSON Schema 2020-12 documents (§4), each with its own `$id`. A Jx source file that names a hosted schema as its `$schema` names one of these three:". The three code blocks stay. After them add: "The extension manifest schema validates `jx-extension.json`, and the other three are composition resources for a project's generated entry documents (extensions.md §5)."

**§6.** Add two rows: `ajv` | "the 2020-12 validator behind `validateWithSchema` (`ajv/dist/2020`, imported on first use)" and `ajv-formats` | "the `format` keyword for that validator".

**§7.** WHATWG HTML note becomes: "Two inventories are used, extracted via `@webref/elements` and `@webref/idl`: element names, which become `TagName`'s `examples` (its pattern, not a list, is what validates), and `EventHandler` attribute names, which become `ElementDef`'s handler properties. No DOM property set is derived. Both extracts reach past this standard (SVG and MathML element names, handlers on non-element interfaces), which widens the examples and admitted names without adding a rule. Nothing else of the standard is implemented here." CSSOM note becomes: "Only the IDL attribute names for CSS properties are used (each property's camel-cased, webkit-cased and dashed attribute), to type the `style` object. Neither the object model nor its serialization rules are implemented." Both rows' Evidence cells gain `packages/schema/tests/schema.test.ts`.

**Fragment:** `bun run spec:change schema.md minor -m "§3.1 and §4 describe the generator as it ships: tagName validates by pattern with webref names as examples, ElementDef hand-declares its common properties and admits the rest, a computed entry is StateEntry's string branch, and the pipeline writes seven artifacts; §1, §3.3, §5, §6 and §7 follow."`

**Docs:** none changes. No docs page's `spec:` cites a schema.md anchor, and the plan changes no file any page's `code:` lists. `docs/framework/agents/machine-readable.md` (four hosted `$id`s) and `docs/framework/agents/authoring-rules.md`'s "the three schemas" stay true. That page's "five state shapes" is not made false here either, but it is not this table: it splits spec.md §5's Prototype shape into Function and Data source and omits the `$expression` entry (spec.md §5.7's Shape 5), a drift from spec.md that predates this plan and is not a schema.md statement, so this plan leaves it alone. The generated `docs/extending/reference/standards.md` picks up the two §7 notes on its next generation.

**Graduation.** schema.md graduates here only if this is the last of its plans to land (§3.2's `plan:schema/project-schema-keys` and §3.4 and §3.5's `plan:schema/parse-boundary-readers` already landed). Then the header becomes `**Status:** Implemented`, the fragment above is replaced by `bun run spec:bump schema.md minor -m "…"` in place (the program's level for a graduation that rides on the last execution) with the same sentence plus "schema.md graduates to Implemented", and `plans/schema/` is deleted with the audit record. Otherwise no `spec:bump` and `plans/schema/` stays.

## Acceptance

- `grep -n "enumeration\|All standard HTML DOM\|String pattern match\|All 1[23] built-in\|Three JSON Schema" specs/schema.md` prints nothing.
- `sed -n '/^### 3.1 /,/^### 3.2 /p;/^## 4\. /,/^## 5\. /p' specs/schema.md | grep -c "Status: Partial"` prints 0.
- `bun run plans:status --spec schema` lists neither §3.1 nor §4; `bun run plans:status --who-claims schema.md#4` names no plan.
- `ls specs/changes/schema-*.md` includes the new fragment, and `bun run spec:release --dry` mints a schema.md minor (or the header reads Implemented after an in-place `spec:bump`).
- The facts still hold: `git ls-files 'packages/schema/*.json' | grep -vc package.json` prints 7, `grep -c "enum" packages/schema/defs/tag-name.schema.ts` prints 0, and `grep -n "additionalProperties" packages/schema/defs/element-def.schema.ts` shows `ElementDef` open.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:standards`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run schema:verify` pass.
