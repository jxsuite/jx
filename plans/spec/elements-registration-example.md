---
status: drafted
disposition: reconcile
claims:
  - spec.md#13.1
size: S
---

# The component-instance example registers its dependency in the `$elements` array form that code accepts

## Context

`specs/spec.md` §13.1, line 1499:

> **Status: Partial.** Registration and instantiation by tag ship. The example below is wrong: `$elements` is an ARRAY of `{ "$ref" }` objects or package names (the schema's `type: "array"`, `registerElements` in `packages/runtime/src/runtime.ts`, `compileElement`), and the tag comes from the referenced document's own `tagName`, not a key; the keyed map shown throws at runtime and fails validation.

The prose under it says to register the document "in the top-level `$elements` map (§16)", and the example writes `"$elements": { "my-card": { "$ref": "./components/card.json" } }`. The section's second marker (line 1520, `> **Status: Removed.**`, about a node-level `$ref` child) is accurate and stays. Before the census that `Removed` marker led the section, so every derived page read §13.1 as removed although instantiation by tag works. Re-verified against the working tree on 2026-09-27.

**What ships, and agrees with itself**

- Schema: `$elements` in `generateSchema` (`packages/schema/src/schema.ts`, line 334) is `type: "array"`, each item a `{ "$ref" }` object (`additionalProperties: false`) or an npm specifier string. Measured with `validateDocument`: the §13.1 document with `[{ "$ref": "./components/card.json" }]` is valid, and the same document with the keyed map is not.
- Interpreter: `registerElements` (`packages/runtime/src/runtime.ts`, line 3871) runs `for (const entry of elements)`, so the keyed map throws `TypeError` (not iterable) before anything renders. For a `{ "$ref" }` entry it resolves the document, skips one whose `tagName` has no hyphen or is already defined, registers the document's own `$elements` first, and calls `defineElement` under that document's `tagName`. `packages/runtime/tests/runtime-gaps-elements.test.ts` ("registers ref'd elements, skips invalid entries, warns on bad packages") holds all of that.
- Compiler: `compileElement` (`packages/compiler/src/targets/compile-element.ts`, line 138) reads `$elements` only under `Array.isArray`, so it silently ignores the map. The site build's npm-element pass (`packages/compiler/src/site/site-build.ts`, line 1516) spreads `pageDoc.$elements` into an array literal, so a page carrying the map throws there. The static emitter expands an instance by looking its tag up in `componentDefs`, which is keyed by each definition's own `tagName` (`renderComponentInstance` via `componentDefs.get(tag)` in `packages/compiler/src/shared.ts`).
- Spec and docs elsewhere: §16.3 shows the array form and the census verified it; `docs/framework/agents/authoring-rules.md` ("`$elements` is an **array** … The registered tag is the referenced document's own `tagName`"), `docs/framework/site/layouts.md`, `docs/framework/site/project-json.md`, `.claude/commands/jx.md` and `examples/pages/advanced/custom-elements.json` all use it.
- `renderNode` warns once per target on a node-level `$ref` child (`warnedRefChildren`), as the `Removed` marker says.

**What is wrong.** `git grep -n '"\$elements": *{' -- ':!*schema.json'` finds the keyed map in exactly three authored places: spec.md §13.1 (line 1505), `docs/framework/concepts/components.md` (line 228) and `docs/framework/concepts/props-and-scope.md` (line 34, which also says "register the component document under a custom-element tag in the top-level `$elements` map"). Everything else agrees with the code.

**Outside this claim.** Which components a site build compiles for a page's `{ "$ref" }` entries is imports.md §1.3's rule (`plan:_shared/component-discovery` claims it): `buildSite` compiles the files directly in `components/` and never reads a page's entries. §13.1 specifies the document format, not the build's discovery, so it points there rather than waiting for it.

## Outcome

- spec.md §13.1 → Implemented: the Partial marker becomes a leading `Implemented` marker naming the evidence, the prose says "array" and states where the tag comes from, and the example uses the array form. The `Removed` marker and the fragment paragraph below it are untouched.
- The two docs pages teach the array form.
- No code, test or schema change.

## Decisions

- **Decided:** reconcile the spec to the array, and do not accept the keyed map as an alias, because the schema, the interpreter, both compiled paths, §16.3, imports.md §1.3 and every other docs page already agree on the array, and a key would restate the definition's `tagName` with room to disagree with it (one document could then register under two names). The audit record's spec-wide decisions list this reconcile by name.
- **Decided:** no new diagnostic for the map form, because `jx validate` (each project's `document.schema.json`) and every editor reading that schema already refuse it (`$elements` is `type: "array"`), and the three places that taught it are the ones this plan fixes. A friendlier runtime error would make this an `implement` on `packages/runtime` for a shape no correct source produces.
- **Decided:** §13.1 leads with `> **Status: Implemented.**` rather than losing its marker, because the section's first marker is what the implementation-status page reads, and without a leading one the later `Removed` marker becomes first again, which is the misreading the census fixed.
- **Decided:** no requires edge on `plan:_shared/component-discovery`, because the new marker cites imports.md §1.3 for the site build's discovery, a pointer that stays true whether that plan has landed or not.
- **Decided:** no fence validator for spec and docs examples, because no gate validates JSON fences today, many fences are deliberately partial documents, and the acceptance grep below proves this change. A general example gate would be its own plan.
- **Decided:** fragment level `minor`, the program's level for a `reconcile`, and not `major`, because no author could rely on the map form: it never validated, and every tier that read it threw or ignored it.

## Implementation

A paper plan. One pull request makes the edits under Specs & docs, adds the fragment and deletes this file.

1. `specs/spec.md` §13.1, in place, as quoted under Specs & docs. No heading moves.
2. `docs/framework/concepts/components.md` and `docs/framework/concepts/props-and-scope.md`, as quoted under Specs & docs.
3. `bun run spec:change spec.md minor -m "…"` with the sentence under Specs & docs.
4. Delete `plans/spec/elements-registration-example.md`.

**Integration contract.** No plan requires this one. Once it lands, §13.1 states that `$elements` is an array whose `{ "$ref" }` entries name documents and that the instance tag is the referenced definition's own `tagName`; §16.3 stays the section that specifies registration order. `plan:spec/one-way-prop-forwarding` and `plan:_shared/compiled-prop-bridge` also edit `props-and-scope.md`: the first its frontmatter, "Static and bound props", "Signal forwarding", "Resolution order", "How it works" and "Rules", the second its frontmatter and a new section after "Static and bound props". This plan edits only "Component instances", so whichever lands second rebases an adjacent hunk at most.

## Tests

No workspace suite changes and none needs to run: no source, test or fixture is touched, so no `coverageThreshold` moves and the manifest check is unaffected. The behaviour the new text states is already held by `packages/runtime/tests/runtime-gaps-elements.test.ts` (array registration, depth-first dependencies, the hyphen skip) and `packages/compiler/tests/compile-element.test.ts` ("custom resolveElementPath callback", an array entry becoming an import).

The gates that prove it, all in the `checks` job:

- `bun run docs:status`: §13.1's first marker is `Implemented`; the spec header stays `Partial`.
- `bun run plans:check`: no `claim-not-open` (this file is deleted with the marker) and no `unclaimed-open` for spec.md.
- `bun run docs:spec-release`: the body change is covered by the fragment.
- `bun run docs:check` and `bun run docs:links`: no heading or anchor moves.
- `bun run docs:prose`: the two docs edits carry no em dash and no banned phrase.
- `bun run docs:markdown`: no escaped heading.

## Specs & docs

**`specs/spec.md` §13.1**, in place:

1. Replace the Partial marker (line 1499) with:

   > **Status: Implemented.** `registerElements` (`packages/runtime/src/runtime.ts`) resolves each `{ "$ref" }` entry, registers the referenced document's own `$elements` first and defines the element under that document's `tagName`; an element node with the tag instantiates it. `compileElement` (`packages/compiler/src/targets/compile-element.ts`) imports a definition's `{ "$ref" }` entries as modules, and the static emitter expands an instance from the definition its tag names (`renderComponentInstance` in `packages/compiler/src/shared.ts`). Which components a site build compiles for a page's entries is imports.md §1.3's rule. Verified in `packages/runtime/tests/runtime-gaps-elements.test.ts`.

2. Replace the paragraph under it with: "A component instance is created by **registering** the component document in the top-level `$elements` array (§16.3) and then placing an element node with its **custom-element `tagName`**, passing data through `$props`. An entry names a document, not a tag: the tag is the one the referenced definition declares as its root `tagName` (§16.1), so `card.json` below is a definition whose `tagName` is `my-card`, and a document registers under the same name wherever it is listed:"

3. In the example, replace the three `$elements` lines with `"$elements": [{ "$ref": "./components/card.json" }],`. The `children` array is unchanged.

The `Removed` marker, its "as above", and the "no document-local element fragment" paragraph stay as written.

**Fragment** (single quotes, so the shell keeps the `$`): `bun run spec:change spec.md minor -m '§13.1: the component-instance example registers its dependency as an $elements array entry, the form the schema, the runtime and the compiler accept, and the section says the instance tag is the tagName the referenced definition declares; the section is Implemented.'`

**Docs** (neither page may contain an em dash):

- `docs/framework/concepts/props-and-scope.md` (its `spec:` cites `spec.md#13`), "Component instances": the lead sentence becomes "A component instance is created in two steps: list the component document in the top-level `$elements` array, then place an element node with the tag that document declares as its `tagName`. `$props` is optional, and an instance without it renders the component with its own defaults:". The example's `$elements` becomes `[{ "$ref": "./components/my-counter.json" }, { "$ref": "./components/card.json" }]`, one entry per line, and a sentence after the fence reads "Here `my-counter.json` declares the tag `my-counter` and `card.json` declares `my-card`." The `:::doc-note` and the rest of the page are unchanged.
- `docs/framework/concepts/components.md` (its `code:` lists `runtime.ts` and `compile-element.ts`), "Props and encapsulation": "Register the component in `$elements` and instantiate it by its custom-element tag:" becomes "List the component's file in `$elements` and instantiate it by the `tagName` that file declares (`my-card` here):", and the example's first line becomes `"$elements": [{ "$ref": "./card.json" }],`. Its `spec:` list is unchanged.
- No other page changes: `authoring-rules.md`, `layouts.md`, `project-json.md` and `runtime-host.md` already show the array, and `references.md` and `documents.md` describe `$elements` without an example.

**Graduation:** not here. spec.md keeps many open items after this lands, so the header stays `Partial` and `plans/spec/` stays.

## Acceptance

- `git grep -n '"\$elements": *{' -- specs docs` prints nothing.
- `sed -n '/^### 13.1 /,/^### 13.2 /p' specs/spec.md | grep -m1 "Status:"` prints the `Implemented` marker, and `… | grep -c "Status: Partial"` prints 0.
- `sed -n '/^### 13.1 /,/^### 13.2 /p' specs/spec.md | grep -c '\$elements. map'` prints 0.
- The new example validates: `bun -e 'import { validateDocument } from "./packages/schema/src/schema.ts"; console.log((await validateDocument({ $elements: [{ $ref: "./components/card.json" }], children: [{ tagName: "my-card", $props: { title: "Hello", count: { $ref: "#/state/count" } } }] })).valid)'` prints `true` (the keyed map prints `false`).
- `bun run plans:status --who-claims spec.md#13.1` names no plan, and `ls specs/changes/spec-*.md` includes the new fragment.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
