---
status: drafted
disposition: reconcile
claims:
  - spec.md#3.1
requires: []
workspaces:
  - specs
  - docs
  - .claude/commands
  - packages/compiler
  - packages/site
size: S
---

# The root field table says what the code does: a document's root `tagName` is optional, renders as `div` when absent, and is not used on a page a layout wraps

## Context

`specs/spec.md` §3.1, line 107:

> **Status: Partial.** Every field matches the code except `tagName`, which the table marks Required at the root. Neither the generated root schema (`packages/schema/schema.json`) nor any per-project `document.schema.json` requires it, the runtime's `resolveTagName` renders a missing tag as `div`, and page documents omit it (`sites/test-blank/pages/contact.json`); only an element node requires `tagName` (`packages/schema/defs/element-def.schema.ts`).

The table (line 128) reads ``| `tagName` | Required | HTML tag name for the root element |``. The section was unmarked before the census. Re-verified against the working tree on 2026-09-27:

- **Schema.** `generateSchema` (`packages/schema/src/schema.ts`) emits the root with `tagName: { $ref: "#/$defs/TagName" }` and no `required` list. None of the 28 tracked `*document.schema.json` files requires `tagName` anywhere outside `ElementDef` and `HeadEntry`. `ElementDef` has `required: ["tagName"]` (`packages/schema/defs/element-def.schema.ts`, line 112). `bun run schema:validate-all` (in `checks`) validates every page in the repository, so a root `required` would go red on the pages below.
- **Renderers.** A missing root tag becomes `div` in all three tiers: `resolveTagName` (`packages/runtime/src/runtime.ts`), `resolveStaticTagName` (`packages/compiler/src/shared.ts`, used by `compile-static.ts`) and `def.tagName ?? "div"` in `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`). A scratch `compile()` of `{ children: [{ tagName: "p", … }] }` emitted `<body><div><p>…</p></div>` on both the static and the client route. Only the runtime half is pinned (`packages/runtime/tests/tag-expression.test.ts`, `resolveTagName(undefined, {})`).
- **Definitions.** A hyphenated root makes a definition (§16.1). `defineElement` (`runtime.ts`) and `compileElement` (`packages/compiler/src/targets/compile-element.ts`) throw "must contain a hyphen" otherwise, which `packages/runtime/tests/custom-elements.test.ts` and `packages/compiler/tests/compile-element.test.ts` pin. `registerElements` skips an `$elements` entry whose document has no hyphenated `tagName`.
- **Pages under a layout have no root of their own.** `resolveLayout` (`packages/site/src/layout.ts`, shared by `jx build` through `packages/compiler/src/site/layout-resolver.ts` and by `composePage` in `packages/site/src/compose.ts`) returns a clone of the layout with the page's `children` distributed into its slots and the page's `state`, `$media`, `style` and `attributes` merged onto the layout root. It never reads the page's `tagName`. Studio's `distributePageIntoLayout` (`packages/studio/src/site-context.ts`) does the same. With the tab's "show layout elements" toggle off, `resolveCanvasDocument` renders the page alone, so that editing view does show the page's own root. No test asserts that a wrapped page's `tagName` is dropped (`packages/site/tests/layout.test.ts`).
- **What ships.** Every JSON page in `sites/`, `packages/starters/sites/`, `examples/` and `packages/create/` uses a layout. 37 of 42 omit `tagName`. The five that write one (`sites/jxsuite.com/pages/{compare,studio,features}.json`, `sites/test-blank/pages/{about,index}.json`) write `"div"`, which is also their layout's root tag, so dropping it changes nothing. `transpileJxMarkdown` (`extensions/parser/src/transpile.ts`) builds a Markdown page from frontmatter and body, so it has no `tagName` unless the frontmatter writes one.

**What is wrong.** The table says Required, and four authored texts repeat it: `docs/framework/concepts/documents.md` (lines 38, 41, 94), `docs/framework.md` (line 61) and `docs/framework/agents/authoring-rules.md` (line 92). `authoring-rules.md` (lines 256 to 269) and `.claude/commands/jx.md` (lines 205 to 219) show a page example with `"$layout"` and `"tagName": "main"`, and say "`tagName` is optional on a page that uses a layout". The build discards that `main`, so the example teaches a landmark that never renders.

**Outside this claim.** A page's `title` that renders as a tooltip on a root element nobody wraps is site-architecture.md §8.1, owned by `plan:site-architecture/head-and-layout-shape-root-title`. schema.md §3.1's "`tagName` is optional (pages with `$layout` may omit it)" bullet is `plan:schema/generator-inventory`'s section, and that plan already appends "the schema requires it only on an element (`ElementDef`)".

## Outcome

- spec.md §3.1 → Implemented. The table says Optional, and a paragraph under it states the three rules: `div` when absent, a hyphen makes a definition, and a page a layout wraps has no root of its own.
- The four docs texts and the agent command say the same thing, and their page examples drop the `tagName` the build discards.
- Two new tests pin the halves nothing asserts today: the compiled `div` default, and the layout dropping a wrapped page's `tagName`.
- No source file changes.

## Decisions

- **Decided:** reconcile the table to Optional. Requiring the field is ruled out: the schema, all three renderers and every shipped page already treat it as optional, 37 JSON pages and every Markdown page would fail `jx validate`, and a page under a layout has no element to name. The audit record's spec-wide decisions list this reconcile by name.
- **Open:** what does a page's own root `tagName` mean when a layout wraps the page? Recommendation: nothing. The spec should say it is not used, which is what `resolveLayout` and `distributePageIntoLayout` do today. The five shipped pages that write one write the layout's own tag, so no output changes. Both alternatives are worse:
  - Wrapping the page's `children` in that element would add a node to every such page. The wrapper would then be the one child `distributeSlots` distributes, so named-slot children would land in the default slot.
  - Re-tagging the layout's root would let one page silently change shared chrome.

  A `jx validate` warning for a wrapped page that writes a root `tagName` would be cheap, but the only shipped cases are harmless. If review wants the warning, this plan becomes `implement` on `packages/compiler` (`validate-command.ts`).

- **Decided:** pin what the new text promises and no test holds, with one case in `packages/compiler` and one in `packages/site`. A reconcile turns what the code does into what the spec promises, and neither half is asserted today. The runtime default, the hyphen refusal and the schema's optional root are already held by the tests and the `schema:validate-all` gate named in Context, so nothing is added for them.
- **Decided:** §3.1 does not list `title`, `$layout`, `$head` or the other site keys. The table is the core field set every document shares. The site keys are specified in site-architecture.md §5 and §8, and schema.md §3.1 enumerates every root key the schema declares.
- **Decided:** no `requires` edge. `plan:spec/tag-expression-completion` edits §19.6, but it keeps the root `tagName` literal, which is all §3.1 cites §19.6 for. `plan:site-architecture/head-and-layout-shape` and `plan:site-architecture/nested-layout-head` rewrite site-architecture.md §5 and `resolveLayout`, and neither reads or changes a page's root `tagName`. §3.1 cites §5.2 by heading, which none of them moves.
- **Decided:** fragment level `minor`, as for any `reconcile`, and not `major`. Nothing ever enforced Required, so no author or tool could rely on it.

## Implementation

One small pull request: the spec and docs edits, two test cases, the fragment, and deleting this file.

1. **`specs/spec.md` §3.1.** Make the edits under Specs & docs in place, then run `bunx oxfmt specs/spec.md` to re-pad the table.
2. **Docs and the agent command.** Make the five edits under Specs & docs. The nano-staged hook formats them.
3. **`packages/compiler/tests/compiler.test.ts`, `describe("compile — static nodes")`.** Add the case under Tests. It reuses `compile` from `../src/compiler`, which the file already imports.
4. **`packages/site/tests/layout.test.ts`, `describe("resolveLayout")`.** Add the case under Tests. It reuses the file's `loaderFor` helper.
5. **The fragment.** Use the command under Specs & docs.
6. **Landing.** Delete this file. No plan requires it, so no `requires` edge needs editing.

**Integration contract.** No plan requires this one. Once it lands, spec.md §3.1 guarantees four things other plans may cite:

- A document's root `tagName` is optional, and a missing one renders as `div` in every tier.
- The root `tagName` is a literal name (§19.6).
- A hyphenated root `tagName` is what makes a document a custom-element definition (§16.1).
- A page a layout wraps renders inside the layout's root element and its own root `tagName` is not used.

`plan:site-architecture/head-and-layout-shape-root-title` and `plan:site-architecture/nested-layout-head` may cite §3.1 for "the layout's root is the page's root". If a later plan gives a wrapped page's `tagName` a meaning, it must rewrite §3.1's paragraph and delete this plan's layout test.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler` and from `packages/site`. The new cases:

- `packages/compiler/tests/compiler.test.ts`: `"a root with no tagName renders as a div, static and dynamic"`.
  - `compile({ children: [{ tagName: "p", textContent: "static" }] })` has `html` containing `<div><p>static</p></div>`.
  - `compile({ state: { n: 1 }, children: [{ tagName: "p", textContent: "${state.n}" }] })` has `html` matching `/<div><p data-bind[^>]*>1<\/p><\/div>/`.
  - The first call covers `resolveStaticTagName`'s empty-candidates branch. The second covers `buildClientNode`'s `def.tagName ?? "div"` on the client route.
- `packages/site/tests/layout.test.ts`: `"a wrapped page's own root tagName is not used: the page renders inside the layout's root"`.
  - The loader maps `./l.json` to `{ tagName: "body", children: [{ tagName: "slot" }] }`.
  - The page is `{ $layout: "./l.json", tagName: "main", children: [{ tagName: "p" }] }`.
  - The result's `tagName` is `"body"`, and its `children` equal `[{ tagName: "p" }]`, so no `main` node appears anywhere in the tree.

Coverage: both cases exercise existing lines only and add no source file, so the manifest check is unaffected. They cannot lower any file's coverage. The thresholds in `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`) and `packages/site/bunfig.toml` (`lines = 0.99, functions = 1.0`) stay as they are unless the run shows a worst file rising, in which case ratchet as CLAUDE.md says.

Gates for the paper half, all in `checks`:

- `bun run docs:status`: §3.1's marker has a valid form.
- `bun run plans:check`: no `claim-not-open` and no `unclaimed-open` for spec.md.
- `bun run docs:spec-release`: the body change is covered by the fragment.
- `bun run docs:check` and `bun run docs:links`: no heading moves, so the `spec.md#3` frontmatter still resolves.
- `bun run docs:prose`: the docs edits have no em dash.
- `bun run docs:markdown`.
- `bun run schema:validate-all`: unchanged, and still green.

## Specs & docs

**`specs/spec.md` §3.1**, in place:

1. Replace the Partial marker at line 107 with:

   > **Status: Implemented.** The root schema requires no field (`generateSchema` in `packages/schema/src/schema.ts`), and `ElementDef` requires `tagName`. A missing root tag renders as `div` in the interpreter (`resolveTagName` in `packages/runtime/src/runtime.ts`) and in the static and client targets (`resolveStaticTagName` in `packages/compiler/src/shared.ts`, `compile-client.ts`). `defineElement` and `compileElement` refuse a definition whose `tagName` has no hyphen. The build, the live preview and the Studio canvas all compose a wrapped page without reading its root `tagName` (`resolveLayout` in `packages/site/src/layout.ts`, `distributePageIntoLayout` in `packages/studio/src/site-context.ts`).

   Keeping a leading marker, rather than deleting the census's, matches §3.2 below it and records where the three rules live.

2. In the table, the `tagName` row becomes ``| `tagName` | Optional | Tag name of the root element, a literal name (§19.6); `div` when absent. See below. |``. Every other row is unchanged.

3. After the table, before `### 3.2`, add:

   > **The root `tagName` is optional.** A document without one renders its root as a `div`, in the interpreter and in every compiled target. A root `tagName` containing a hyphen makes the document a custom element definition (§16.1), registered under that name. A document whose root `tagName` has no hyphen is not a definition: an `$elements` entry naming it registers nothing, and `defineElement` and `compileElement` refuse it. A page wrapped by a layout (site-architecture.md §5.2) has no root element of its own. Its `children` fill the layout's slots, its `state`, `$media`, `style` and `attributes` extend the layout root's, and a `tagName` at its top is not used, which is why page documents leave it out. Below the root, the schema's `ElementDef` still requires `tagName` on every element definition.

   Write it as a plain paragraph with the bold lead, not a blockquote.

**Fragment:** `bun run spec:change spec.md minor -m "§3.1: a document's root tagName is optional, as the schema and every renderer already treat it; a missing one renders as a div, a hyphenated one makes the document a custom element definition, and a page wrapped by a layout renders inside the layout's root, so its own root tagName is not used. The section is Implemented."`

**Docs.** No em dashes. `docs:sync` names the two pages whose `spec:` cites `spec.md#3`. The other three texts repeat the same claim.

- **`docs/framework/concepts/documents.md`** (`spec:` `spec.md#3`):
  - The table's `tagName` row: Required becomes Optional, and the description becomes "HTML tag name for the root element; a `div` when absent".
  - Line 41: "Only `tagName` is required." becomes "No root field is required."
  - "Component or page fragment" gains a third bullet: "A document with **no root `tagName`** renders its root as a `div`. Pages usually leave it out: a page wrapped by a [layout](/docs/framework/site/layouts) renders inside the layout's root element, so a `tagName` at the top of the page is not used."
  - "Rules", line 94, becomes "No root field is required: `$schema` and `$id` are recommended, and `tagName` is optional."
- **`docs/framework.md`** (`spec:` `spec.md#3`): the table's `tagName` row: Required becomes Optional, and the description becomes "HTML tag name for the root element; `div` when absent".
- **`docs/framework/agents/authoring-rules.md`:**
  - Line 92 becomes "No root field is required. A root `tagName` containing a hyphen makes the document a custom element; without one the root renders as a `div`."
  - In "Page documents", delete the example's `"tagName": "main",` line (261).
  - Replace the bullet at line 269 with "- A page that uses a layout has no root element of its own: it renders inside the layout's root, so leave `tagName` out. Put landmarks such as `main` in the layout."
- **`.claude/commands/jx.md`**, "Page Documents": the same two edits. Delete `"tagName": "main",` (line 211), and replace "`tagName` is optional on pages that use a layout." (line 219) with the bullet above. That file is not a docs page, but `authoring-rules.md` lists it in `code:` and agents author from it.
- **`docs/framework/site/layouts.md`** (`spec:` `site-architecture.md#5`), "Declaring a layout": after "The page's `children` are distributed into the layout's `<slot>` positions when the page compiles." add "The layout's root element is the page's root: the page's `state`, `style` and `attributes` extend it, and a `tagName` at the top of the page is not used." `plan:site-architecture/head-and-layout-shape` edits only this page's "Layout documents" example, so the two hunks do not touch.
- No other page changes. `elements.md`'s "`tagName` is required on every element definition" stays true, and `components.md` describes definitions, which keep their hyphenated tag.

**Graduation:** not here. spec.md keeps many open items after this lands, so its header stays `Partial` and `plans/spec/` stays.

## Acceptance

- `sed -n '/^### 3.1 /,/^### 3.2 /p' specs/spec.md | grep -c 'Status: Partial'` prints `0`. The same range's first `Status:` line is the Implemented marker, and `grep -c '| Required'` over the range prints `0`.
- `git grep -n 'tagName.*| Required\|Only `tagName` is required\|only required root field' -- docs specs` prints nothing.
- `git grep -n '"tagName": "main",' -- docs/framework/agents/authoring-rules.md .claude/commands/jx.md` prints nothing.
- `cd packages/compiler && bun test --isolate --coverage tests/compiler.test.ts` and `cd packages/site && bun test --isolate --coverage tests/layout.test.ts` pass, including the two new cases. The full workspace runs pass their `coverageThreshold`.
- `bun run plans:status --who-claims spec.md#3.1` names no plan, and `ls specs/changes/spec-*.md` includes the new fragment.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run schema:validate-all` pass.
