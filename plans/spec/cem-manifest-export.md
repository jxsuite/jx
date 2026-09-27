---
status: drafted
disposition: implement
claims:
  - spec.md#16.8
requires: []
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - packages/studio
  - specs
  - docs
size: M
---

# `jx build` writes one Custom Elements Manifest for every custom element it compiles, from one generator in `@jxsuite/schema`, and Studio's uncalled per-document generator is gone

## Context

`specs/spec.md` §16.8, marker at line 1763 (the census kept Partial and corrected the sentence; a forward from the `studio.md` census narrowed "Studio's CEM editors" to the ones that exist):

> **Status: Partial.** The schema fields ship, and Studio edits `parameters`, `emits` and a typed entry's `attribute` and `reflects` (`packages/studio/src/panels/signals-panel.ts`), but nothing in `packages/studio/src` reads or writes the root `observedAttributes` array (studio.md §6.5). A per-document CEM 2.1.0 generator exists (`exportCemManifest` in `packages/studio/src/services/cem-export.ts`), but nothing calls it (`studio.ts` imports it as `_exportCemManifest`), no build emits a project `custom-elements.json`, and the generator maps only typed state entries carrying `attribute` into CEM `attributes`, not `observedAttributes`.

Every clause holds at 84735a9f. §16.8's body only lists the four annotations; it says nothing about a manifest, so the export has to be specified as well as built. The Studio half of the marker is studio.md §6.5's item (`plan:studio/cem-contract-editors`), not §16.8's.

**What exists**

- The annotations: `attribute`, `reflects`, `deprecated` on typed entries (`packages/schema/defs/typed-state-def.schema.ts`), `parameters`, `arguments`, `type`, `emits` on Function entries (`function-def.schema.ts`, `cem.schema.ts`), root `observedAttributes` (`packages/schema/src/schema.ts`). The Data panel edits the per-entry ones (`signals-panel.ts`, the `attribute` text field near line 689); `grep -rn observedAttributes packages/studio/src` is empty.
- What the runtime does with them (`packages/runtime/src/runtime.ts`): `defineElement` freezes the root `observedAttributes` as the class's `static get observedAttributes()`, and `absorbAttribute` writes an observed attribute into `state[camelCase(name)]`. Per-entry `attribute` and `reflects` are read by no tier: nothing reflects state back to an attribute, and an `attribute` the root array does not list is never read.
- `exportCemManifest` (`packages/studio/src/services/cem-export.ts`): takes the deleted flat `{ document }` state plus three injected helpers (`defCategory`, `normParam`, `collectCssParts` from `signals-panel.ts`) and downloads `<tag>.cem.json` through a Blob link. `packages/studio/tests/reachability.test.ts` lists it as unreachable ("Port it onto a command or delete the module"). Its tests in `cem-export.test.ts` mostly assert only that it does not throw. The same file holds `collectSlots` and `validateComponentSlots`; the latter is live (`editor/convert-to-component.ts`, `files/file-ops.ts`).
- `collectSlotDefs` in `packages/schema/src/component-meta.ts` already walks slots with the same rules as `collectSlots` (trimmed names, whitespace counts as unnamed, static `children` only), and is tested in `packages/schema/tests/component-meta.test.ts`.
- `buildSite` step 5 (`packages/compiler/src/site/site-build.ts`) compiles each component with `compileElement`, writes `dist/components/<tag>.js`, and records each parsed definition in `componentDefs` (tag → document). The module defines `class <tagNameToClassName(tag)> extends HTMLElement` and calls `customElements.define`, exporting nothing (`emitElementModule` in `targets/compile-element.ts`, `tagNameToClassName` in `shared.ts`). `resolveShadowMode(doc, projectConfig.defaults)` (`packages/compiler/src/shadow.ts`) is the shadow verdict the prerender uses.
- Jx's own manifest reader, the `/__studio/components` scan in `packages/server/src/studio-api.ts`, lists a declaration only when `decl.customElement && decl.tagName`, takes props from `attributes` (`name`, `type.text`, `default`) and `modulePath` from `mod.path`; `npmSpecifier` (`packages/studio/src/files/elements.ts`) imports `<package>/<modulePath>`, so module paths are read relative to the package root.

**What the existing generator gets wrong**, beyond being uncalled: its declaration has no `customElement: true`, so Jx's own reader would skip it; `path` is `""` and `name` is the tag rather than the class; `default` is `String(value)` (so `"Guest"` becomes `Guest` and an object `[object Object]`) where CEM wants source text; an object `type` becomes `{ text: <object> }`; a Shape 3 template string counts as a writable field and the lifecycle hooks as public methods; `cssParts` are listed for light-DOM components, where spec.md §16.6 says `::part` does not apply, and `part="a b"` is one part; `attributes` come from per-entry `attribute`, which the element does not observe.

**What is missing:** one generator both the build and any other host can import, the build calling it, §16.8 saying what the manifest contains and where it is written, and the Studio remnant removed.

**Related, no edge** (see Decisions): `plan:studio/cem-contract-editors` (the `observedAttributes` editor and the custom-property and part declaration forms), `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` (the compiled module's §16.2 properties and §16.5 attributes, which the manifest describes), `plan:_shared/component-discovery` (widens `componentDefs`), `plan:spec/callable-classifier` (the computed-or-callable verdict for Function entries), `plan:imports/cem-discovery-on-every-backend` (the reader side, and CEM reader types in `component-meta.ts`), `plan:site-architecture/build-output-prose` (§14.2's marker).

## Outcome

- spec.md §16.8 → Implemented: the section specifies the manifest (location, module frame, the annotation-to-CEM mapping, what is left out) and `jx build` writes it. The Studio clause leaves the marker; it remains studio.md §6.5's Pending "Observed attributes" cell.
- Ride-alongs, not claims: spec.md §5.6's Implemented marker names the new generator; studio.md §6.5's two CSS cells stop citing the deleted file (both stay Partial); site-architecture.md §12.1's and §14.2's output trees list the file (§14.2 stays Partial).

## Decisions

- **Open:** which annotations does the manifest trust? Recommendation: the manifest says what the element does. `attributes` are exactly the root `observedAttributes` (spec.md §16.5), each linked by `fieldName` to the state entry its camel-cased name writes when that entry is a public field. A field carries `attribute` (and `reflects`, when declared) only when an observed attribute writes it, since CEM requires a field's `attribute` to appear in `attributes`. An entry whose `attribute` no observed attribute writes into it is left out of `attributes` and reported as a build warning naming the fix. `reflects` is carried as authored, and §16.8 says in one sentence that no tier reflects state itself, so `reflects: true` is the author's statement that the component's own code does. Because a manifest that promises an attribute the element never reads misleads every consumer, and the alternative (making per-entry `attribute` observed, or making the tiers reflect) is a §16.5 behaviour change nobody has asked for.
- **Open:** where does the build write the manifest, and in what frame? Recommendation: always `<outDir>/custom-elements.json` when at least one definition compiled, never elsewhere; module paths relative to the project root (`dist/components/user-card.js`); the build never reads or edits `package.json`, and the docs tell a publishing project to set `"customElements": "dist/custom-elements.json"` itself. Because the build then writes only inside `outDir`, the paths are in the frame npm tooling and Jx's own reader resolve (package root), and a Jx project that publishes `dist/` is discoverable by another Jx project's imports.md §2 scan with no extra step. The cost is that the copy a deployed site serves at `/custom-elements.json` names `dist/…` paths, which is harmless. Alternative: honour `package.json`'s `customElements` path when present, which writes into the source tree.
- **Open:** does Studio get its own export command? Recommendation: no. `Build Site` (dev server and desktop, through `platform.buildSite`) and the cloud's CI build already produce the manifest, and it describes compiled modules only a build writes. A Studio-written `custom-elements.json` in the project tree would go stale on the next edit, the failure CLAUDE.md's "Stale schemas fix themselves" exists to prevent. If a maintainer wants one, it is a `project.exportCustomElementsManifest` record in `packages/studio/src/commands/defaults.ts` that reads the documents `platform.discoverComponents` returns and writes through `platform.writeFile`, calling the same `cemManifest`.
- **Decided:** the generator is `packages/schema/src/cem-manifest.ts`, exported as `@jxsuite/schema/cem-manifest`, pure and browser-safe. Because the compiler and the studio both depend on `@jxsuite/schema`, `component-meta.ts` is the precedent for a shared extractor (its `collectSlotDefs` is reused), and the reader side lives in the same package. The caller supplies what only it knows: the tag, the compiled class name, the module path and the shadow verdict.
- **Decided:** the §16.5 key rule moves to `attributeStateKey(name)` in `@jxsuite/schema/guards`, beside `isPrivateStateKey`, and `absorbAttribute` calls it. Because the manifest's `fieldName` must be the key the runtime writes, and `isPrivateStateKey` is the precedent for a rule that has to hold identically wherever it is applied. The compiled module's inlined copy is `plan:_shared/compiled-element-lifecycle`'s drift test to keep.
- **Decided:** members follow the shapes of spec.md §5.7. A public Shape 1 value (a string that is not a template, a number, a boolean, `null`, an array, or a plain object with no `$`-prefixed key that is not a Shape 2b type definition per `isSchemaOnlyDef`) or Shape 2 typed entry is a `field`. A public Function entry is a `method` unless it is one of §16.4's hooks (`onMount`, `onUnmount`, `onAdopted`) or is computed by the rule `bodyReturnsValue` (`@jxsuite/schema/guards`) already shares between the interpreter and the compiler: a string `body` returning a value, with no `parameters` or `arguments`. Template strings, `$expression`, prototype, `$ref`-only and schema-only entries are not members. Because a consumer drives an element through what it can set and call; derived entries are outputs. `plan:spec/callable-classifier` replaces the computed test with its verdict when it lands.
- **Decided:** values are encoded as CEM expects. `default` is `JSON.stringify(value)` (CEM `default` is source text). `type.text` is the entry's `type` string, a JSON Schema object's `type` (an array of names joined as `string | null`), a `$ref`'s last segment, or else the JSON type name of the default (`string`, `number`, `boolean`, `array`, `object`, `null`), since a typed entry's `type` is a JSON Schema type or a `$ref` to one (`typed-state-def.schema.ts`). Parameters and events get the same `type` treatment.
- **Decided:** `cssParts` only for a definition whose `resolveShadowMode` is not `null`, one entry per whitespace-separated name, deduplicated, because spec.md §16.6 says light DOM has no `::part`. `slots` and `cssProperties` are listed in both modes.
- **Decided:** the output is deterministic: modules sorted by tag name, `JSON.stringify(manifest, null, 2)` plus a trailing newline, member order as the document's `state` keys. Because a diffable artifact is the point of writing one.
- **Decided:** no `requires`. The manifest states the contract §16.2 and §16.5 specify; where the compiled module does not yet provide it, those sections' markers say so, and `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` close that without touching the generator. The first Open above holds whatever `plan:studio/cem-contract-editors` decides the editor writes, since only the root array is read. `plan:_shared/component-discovery` widens `componentDefs`, which this plan reads as is. The critic's CEM coupling with `plan:imports/cem-discovery-on-every-backend` is one of names only: the producer types here end in `Out` so they cannot collide with the reader subset that plan adds to `component-meta.ts`.

## Implementation

1. `packages/schema/src/guards.ts`: add `attributeStateKey(name: string): string`, the kebab-to-camel rule `name.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase())`, with a JSDoc citing spec.md §16.5.
2. `packages/runtime/src/runtime.ts`, `absorbAttribute`: replace the inline `replaceAll` with `attributeStateKey(name)` (import beside `isPrivateStateKey`). No behaviour change.
3. `packages/schema/src/cem-manifest.ts` (new; header cites spec.md §16.8 and carries `@docs framework/build`):
   - Types: `CemTypeOut { text: string }`, `CemAttributeOut`, `CemFieldOut`, `CemMethodOut`, `CemParameterOut`, `CemEventOut`, `CemSlotOut`, `CemCssPropertyOut`, `CemCssPartOut`, `CemElementDeclarationOut` (`kind: "class"`, `customElement: true`, `name`, `tagName`, `description?`, `members`, and the five optional arrays, each present only when non-empty), `CemModuleOut` (`kind: "javascript-module"`, `path`, `declarations`, `exports: [{ kind: "custom-element-definition", name: tag, declaration: { name: className } }]`), `CemPackageOut` (`schemaVersion: "2.1.0"`, `modules`).
   - `export interface CemDefinition { doc: unknown; tagName: string; className: string; modulePath: string; shadow: boolean }`.
   - `export function cemModule(def: CemDefinition): { module: CemModuleOut; warnings: string[] }`, in this order: `description` from the root `description`, else `$description`, when a string; for each `state` entry, skipping `isPrivateStateKey`, a field (`isExpandedSignal`; a non-object value or array that is not `isTemplateString`; or a plain object with no `$`-prefixed key for which `isSchemaOnlyDef` is false) or a method (`isFunctionDef`, minus the hooks and the computed test, with `parameters` or else `arguments` without a leading `"state"`, each bare name becoming `{ name }` and each object keeping `name`, `description`, `optional`, a `type` and a JSON `default`; `return: { type }` from the entry's `type`); `attributes` from the root `observedAttributes` strings, deduplicated in order, each linked through `attributeStateKey` and copying the field's `type`, `default`, `description` and `deprecated`; then the linked fields gain `attribute` and, when declared, `reflects: true`; every typed entry whose `attribute` is not linked to it yields the warning `<tag>: state entry "<key>" declares attribute "<name>", but the element does not observe it into that entry (spec.md §16.5); add it to observedAttributes or remove it`; `events` from the root `emits`, then each method's `emits`, first name wins; `slots` from `collectSlotDefs(doc)` as `{ name }`; `cssProperties` from the root `style`'s `--*` keys as `{ name, default: String(value) }`; `cssParts` from `cssPartNames(doc)` when `shadow`.
   - `export function cssPartNames(node: unknown): string[]`: the static `children` walk `collectSlotDefs` uses, splitting each string `attributes.part` on whitespace, deduplicated in first-seen order.
   - `export function cemManifest(defs: readonly CemDefinition[]): { manifest: CemPackageOut; warnings: string[] }`: `cemModule` per definition, sorted by `tagName`, warnings concatenated in that order.
   - `packages/schema/package.json` `exports`: `"./cem-manifest": "./src/cem-manifest.ts"`.
4. `packages/compiler/src/site/site-build.ts`, a new step after 5b, "5c. Custom Elements Manifest (spec.md §16.8)": when `componentDefs.size > 0`, build `CemDefinition`s from it (`modulePath` is the path of `<outDir>/components/<tag>.js` relative to `projectRoot`, `/`-separated through `.split(sep).join("/")`; `className` is `tagNameToClassName(tag)` imported from `../shared.ts`, `shadow` is `resolveShadowMode(doc, projectConfig.defaults) !== null`), call `cemManifest`, `console.warn` each warning, write `resolve(outDir, "custom-elements.json")` as decided, `fileCount += 1`, and `log` "Wrote custom-elements.json (N element(s))". Update the file header's step list.
5. `packages/studio`:
   - Delete `exportCemManifest` and `collectSlots`; rename `src/services/cem-export.ts` to `src/services/component-slots.ts` (`git mv`), keeping `validateComponentSlots`, which now reads `collectSlotDefs(doc).map((s) => s.name)` from `@jxsuite/schema/component-meta`; drop the `/// <reference lib="dom" />` line and the now-unused imports.
   - `src/editor/convert-to-component.ts` and `src/files/file-ops.ts`: import from `../services/component-slots`.
   - `src/studio.ts`: delete the `_exportCemManifest` import (line 140).
   - `tests/reachability.test.ts`: delete the `"services/cem-export.ts"` entry.
   - `signals-panel.ts`'s `collectCssParts` and the Logic tab's lists are untouched; they are `plan:studio/cem-contract-editors`'s surface.
6. On landing, update the references to `services/cem-export.ts` in `plan:studio/cem-contract-editors` and `plan:spec/callable-classifier` to the new module.

**Integration contract.** Once this lands:

- `@jxsuite/schema/cem-manifest` exports `cemManifest(defs)`, `cemModule(def)`, `cssPartNames(node)`, `CemDefinition` and the `*Out` types; no Node import. `@jxsuite/schema/guards` exports `attributeStateKey(name)`, which the interpreter uses.
- `buildSite` writes `<outDir>/custom-elements.json` over every entry of `componentDefs` whenever there is one, module paths relative to the project root, and prints each generator warning. Every declaration carries `customElement: true` and `tagName`, so Jx's own reader (`/__studio/components`, or the shared scan `plan:imports/cem-discovery-on-every-backend` introduces) lists a published Jx build's elements.
- A plan that adds an annotation (the custom-property declaration form of `plan:studio/cem-contract-editors`) extends `cemModule` and adds its row to §16.8's table; an editor that writes the root `observedAttributes` is reflected with no generator change. `plan:spec/callable-classifier` swaps the method/computed test for its verdict.

## Tests

Run `bun test --isolate --coverage` from each workspace, then `bun scripts/check-coverage-manifest.ts <workspace>`. Per-file thresholds: `packages/schema` 0.99/0.99, `packages/runtime` 0.963/0.98, `packages/compiler` 0.982/0.98, `packages/studio` 0.958/0.941. `cem-manifest.ts` is a new source file, imported statically by its test, so it ships with `cem-manifest.test.ts` and must reach the schema bar on its own. Ratchet any workspace whose worst file rises.

New `packages/schema/tests/cem-manifest.test.ts`:

- "a definition becomes one custom-element declaration and its define export": full `toEqual` of the module for a minimal definition (`kind`, `path`, `customElement: true`, class `name`, `tagName`, the `custom-element-definition` export), with no empty arrays present.
- "attributes are the observed names, linked to the entry each one writes": `observedAttributes: ["user-name", "count", "orphan"]` over `userName` (typed, with description) and `count: 1` gives three attributes, the first two with `fieldName`, `type` and JSON `default`, `orphan` with its name only; `userName`'s field carries `attribute: "user-name"`.
- "an attribute the element does not observe into the entry is left out and warned": an unobserved `attribute`, and an observed one whose camel-cased key is a different entry; neither field carries `attribute`, and each warning names the tag, the key and the attribute.
- "reflects rides only on a linked field".
- "fields are Shape 1 and Shape 2 entries only": a template string, `$expression`, a `Request` prototype, a `$ref`-only entry, a schema-only `{ "type": "string" }` and `#cache` are absent; a number, a string, an array, `null` and a plain `{ "a": 1 }` are fields with their JSON type names and JSON defaults.
- "a type renders as text": a string, `{ "type": ["string", "null"] }`, `{ "$ref": "#/$defs/User" }`, and a typed entry without `type` falling back to its default's type.
- "Function entries are methods, except hooks and computed bodies": parameters from bare names and objects (object `type` and `default` normalised), `arguments` without a leading `state`, return type, `deprecated` string and `true`; `onMount` and a parameterless `return state.a + state.b` absent.
- "events come from the root and from methods, first name winning".
- "slots, custom properties and the root description are listed".
- "css parts are listed only for a shadow definition, split and deduplicated" (and `cssPartNames` over a nested tree with `part="a b"` and a repeated `a`).
- "cemManifest sorts modules by tag, stamps 2.1.0 and concatenates warnings".
- "a document without state, children or style gives a bare declaration".

`packages/schema/tests/guards.test.ts`: "attributeStateKey camel-cases each hyphenated segment" (`user-name`, `a-b-c`, `plain`, a trailing hyphen unchanged).

`packages/runtime`: no new case; `connect-attributes.test.ts` pins `absorbAttribute` through the refactor.

New `packages/compiler/tests/site-build-cem-manifest.test.ts` (the `writeJSON` fixture pattern of `site-build-nested-components.test.ts`, removed in `afterAll`):

- "writes dist/custom-elements.json describing every compiled component": two components; module paths `dist/components/<tag>.js` in tag order, class names from `tagNameToClassName`, an observed attribute present, and `files` counting the manifest.
- "lists css parts for a shadow component, by its own $shadow or the project default, and not for a light one".
- "writes no manifest when no component compiles".
- "prints the generator's warnings" (`spyOn(console, "warn")`, restored in `finally`).
- "module paths stay relative to the project root under a nested outDir" (`build.outDir: "./build/site"` gives `build/site/components/<tag>.js`).

`packages/studio`: `tests/cem-export.test.ts` becomes `tests/component-slots.test.ts` holding the eight `validateComponentSlots` cases unchanged; the `collectSlots` and `exportCemManifest` blocks are deleted (slot walking is `collectSlotDefs`'s, covered in schema). `reachability.test.ts` passes without the entry.

Both typechecks: `bun run typecheck`, and `bun run --cwd packages/desktop typecheck` after `bun scripts/check-electrobun-vendor.ts --init`.

## Specs & docs

**spec.md §16.8.** Keep the heading and the annotation list. After the list, add:

> **A build exports them as one manifest.** A site build writes a Custom Elements Manifest, schema version 2.1.0, to `<outDir>/custom-elements.json`, describing every definition it compiles; a build that compiles none writes none. Each compiled module (`<outDir>/components/<tag>.js`) is one `javascript-module` whose `path` is relative to the project root, the package root that a manifest's paths are resolved from (imports.md §2). It holds one declaration, with `kind: "class"`, `customElement: true`, the definition's `tagName` and the class name the module defines, and one `custom-element-definition` export. The build does not edit `package.json`; a project that publishes its components names the file in its own `customElements` field.

Then a two-column table (definition → manifest) with the rows of the Decisions: root `description`; each `observedAttributes` name → `attributes`, linked by `fieldName` to the entry its camel-cased name writes (§16.5); a public Shape 1 or Shape 2 entry → `field` (`type`, `default` as JSON text, `description`, `deprecated`, and `attribute`/`reflects` only when an observed attribute writes it); a public, callable Function entry other than the §16.4 hooks → `method` (`parameters`, return `type`, `description`, `deprecated`); root and method `emits` → `events`, first name winning; `<slot>`s in `children` → `slots`; the root `style`'s `--*` keys → `cssProperties`; `part` names in `children`, for a definition rendered into a shadow root (§16.6) → `cssParts`. Then:

> Private entries (§5.6) never appear. Computed entries, data sources and references are not members, since a consumer cannot set them. An entry's `attribute` that no observed attribute writes into it is left out and reported as a build warning, because the element never reads it (§16.5). No tier writes state back to an attribute, so `reflects` is the author's statement that the component's own code does.

Replace the marker with:

> **Status: Implemented.** `cemManifest` in `packages/schema/src/cem-manifest.ts` is the one generator, and `buildSite` (`packages/compiler/src/site/site-build.ts`) writes its result. The manifest states the interface §16.2 and §16.5 specify; where the compiled element module does not yet provide it, those sections' markers say so. Studio's editors for these annotations are studio.md §6.5's.

**spec.md §5.6** (marker only, stays Implemented): "and from CEM extraction (`cem-export`)" becomes "and the build's Custom Elements Manifest leaves them out (`cemManifest` in `packages/schema/src/cem-manifest.ts`, §16.8)".

**studio.md §6.5** (cells only, both stay `**Partial**`): the CSS custom properties cell's "and the uncalled generator in `services/cem-export.ts` would include them (`spec.md` §16.8)" becomes "and a site build's Custom Elements Manifest exports them (`spec.md` §16.8)"; the CSS parts cell's "and the uncalled generator would include them" becomes "and the build's manifest exports them for a shadow-root component (`spec.md` §16.8)".

**site-architecture.md** §12.1 (`Emit dist/` tree) and §14.2 (artifact tree): a `custom-elements.json` line, commented "Custom Elements Manifest of the compiled components (spec.md §16.8)". §14.2's marker is untouched.

**Fragments** (no graduation: spec.md keeps other open items):

- `bun run spec:change spec.md minor -m "A site build writes one Custom Elements Manifest describing every compiled custom element, mapped from its observed attributes, public state, functions, events, slots, custom properties and shadow parts."`
- `bun run spec:change studio.md patch -m "The CSS custom property and CSS part cells of the annotations editor cite the build's manifest export instead of an uncalled Studio generator."`
- `bun run spec:change site-architecture.md minor -m "The build output lists the Custom Elements Manifest a site build writes."`

**Docs** (no em dashes):

- `docs/framework/build.md`: `spec:` gains `spec.md#16.8`, `code:` gains `packages/schema/src/cem-manifest.ts`. Step 5 of "What `jx build` does" gains "`custom-elements.json` (when at least one component compiled)". A new section "The Custom Elements Manifest" before "Related": what the file describes; that module paths are relative to the project root; the `package.json` snippet `{ "customElements": "dist/custom-elements.json", "files": ["dist"] }` for publishing; that private state never appears and that an `attribute` the component does not observe is left out with a warning.
- `docs/framework/site/deployment.md`, "The dist/ contract" tree: `├── custom-elements.json      # When the site has components`.
- `docs/framework/concepts/props-and-scope.md`, "Attribute props": after the example, "`observedAttributes` is what makes the element read an attribute. The `attribute` and `reflects` fields on an entry describe the prop for tooling, in the [Custom Elements Manifest](/docs/framework/build#the-custom-elements-manifest) the build writes."
- No change: `docs/studio/logic/data.md` and `docs/studio/logic/events.md` describe the Attribute field and the Observed Attributes list, which are `plan:studio/cem-contract-editors`'s surface; the other pages whose `code:` lists `site-build.ts` (`color-schemes`, `redirects`, `seo`) do not describe build outputs.

## Acceptance

- `bun run plans:check --audit spec` reports nothing for `spec.md#16.8`, and this file is gone.
- `git grep -n "exportCemManifest\|services/cem-export" -- packages specs docs` finds nothing.
- `bun packages/compiler/src/cli.ts build examples`, then `jq '[.schemaVersion, [.modules[].declarations[0].tagName], (all(.modules[].declarations[0]; .customElement))]' examples/dist/custom-elements.json` prints `"2.1.0"`, the sorted tags of the component documents in `examples/components/` (`contact-form` through `user-card`), and `true`; every `path` starts with `dist/components/`, and `user-card`'s declaration has no `attributes` (it observes none) while its members include `addScore` as a method and `firstName` as a field, and not `fullName`, whose body returns a value.
- The suites above green in `packages/schema`, `packages/runtime`, `packages/compiler` and `packages/studio`, each followed by its coverage-manifest check; both typechecks green.
- `bun run docs:check`, `docs:links`, `docs:prose`, `docs:status`, `docs:spec-release`, `docs:section-refs` and `plans:check` are green.
