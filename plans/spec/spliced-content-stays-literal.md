---
status: drafted
disposition: implement
claims:
  - spec.md#8.4
requires: []
workspaces:
  - packages/compiler
  - specs
  - docs
size: M
---

# Content a computed-children template splices in is rendered as written, never evaluated as a template

## Context

`specs/spec.md` §8.4, the leading marker:

> **Status: Partial.** Element and text-node children, and computed children resolved at build time, ship. Content a computed-children template splices in is not kept literal: the template pass (`resolveDocTemplates` in `packages/compiler/src/site/site-build.ts`) recurses into the resolved nodes and evaluates every `${…}` in their text and attributes, so a content entry's prose or inline code that contains `${` renders its evaluation (`Clicked ${state.count} times` in `docs/start/first-component.md` renders as "Clicked undefined times"), and one left for the client can make the page's module a syntax error.

The marker was added in the closing pass of the detailing program. `plan:compiler/client-template-text-children` found the defect (its Context, "Found: content is read as templates") and deferred it, in its one Open decision, to a plan of its own against this section.

**What the code does** (verified against the working tree on 2026-09-27):

- **The splice.** `resolveDocTemplates` (`packages/compiler/src/site/site-build.ts`, line 1874) replaces a whole-`children` template that evaluates to an array with that array and calls itself on every resolved node (line 1936), and does the same for a template string child among `children` that evaluates to an array (line 1949). The recursion evaluates each spliced node's `innerHTML`, `textContent`, `style` values, `attributes` and `$props` with `evaluateStaticTemplate` against the page's build scope.
- **What reaches it.** Every content route: `sites/jxsuite.com/pages/docs/[...slug].json` and the blog, portfolio and shop starters (`packages/starters/sites/*/pages/…`) render `"children": "${state.<entry>.$children ?? []}"`, and `docs/framework/site/routing.md` and `content-collections.md` teach that form. `$children` is the parser's Jx tree (`processMarkdown`, `extensions/parser/src/md.ts`), where inline code and prose are `textContent` or string children.
- **Two failure shapes.** A template whose reads resolve at build time is baked: `docs/start/first-component.md`'s inline code `Clicked ${state.count} times` renders "Clicked undefined times". One that does not resolve is kept as a template, the page counts as dynamic, and `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`) binds it as `` () => `…` ``; an unbalanced `${` there made `/docs/framework/concepts/security/`'s `app.js` a syntax error (`_t3: () => `${``), so every binding on that page is dead.
- **The spec states the recursion.** §8.4's "Computed Children (Build Time)" says "The compiler's template pass replaces `children` with the resolved array and recurses into it", while calling the form "the mechanism for injecting parsed content". The interpreter never meets a computed-children string: `renderNode` renders only an array `children` (`packages/runtime/src/runtime.ts`), which §8.4 already states ("not re-evaluated at runtime").
- **Nothing shipped relies on the evaluation.** `plan:compiler/client-template-text-children`'s scan of every authored document and all 301 tracked Markdown files through `processMarkdown` found 139 `${` in text, every one a `textContent`, and every one a code example or prose describing templates.

## Outcome

- spec.md §8.4 → Implemented. Computed children still resolve once at build time, and what they splice in is content: a `${` in its text, attributes, styles or props is literal in every tier and every pass.

## Decisions

- **Decided:** spliced content is literal in every position and every pass that could evaluate or bind it: `resolveDocTemplates`' recursion, `expandComponents`' slot and instance rendering, the client target (`buildClientNode`), the static target (`compileNode` in `compile-static.ts`) and the prerender (`renderStaticNode` in `shared.ts`). Because the defect is one fact (data is not a template) and fixing one pass moves the evaluation to the next.
- **Open:** how a spliced node carries "literal". Recommendation: the splice marks it. Each spliced element node gets the internal key `$literal: true`, which every pass above reads as "no string in this subtree is a template", and which no emitter writes out (it joins the `$`-keys `buildAttrs` and `buildClientNode`'s property loop already skip; add it to the reserved set if either does not). A spliced string cannot carry a key, so one containing `${` is split at each `${` into adjacent string children (`"a ${b}"` becomes `"a $"`, `"{b}"`), which render as one run of text and of which none contains `${`. The alternatives: a module-level `WeakSet` of literal nodes loses the mark to any pass that clones a node, and escaping `${` to an entity works only where the text is written raw, as `innerHTML`'s existing `&#36;{` rewrite is (line 1885), and shows `&#36;{` wherever the emitter escapes text, which is every `textContent`.
- **Decided:** no opt-in. A content entry cannot ask for its prose to be evaluated: a template in content is a template in data, which is the input the §21.4 trust model treats as a document's author, not a content author, and a page that wants a computed value beside its content writes it in the page.
- **Decided:** no `requires`. `plan:compiler/client-template-text-children` binds template text children in the client target; with this plan's split no spliced string contains `${`, so its text-child path never sees one, and a `$literal` subtree's string children are skipped by the same check whichever lands second adds to that path. `plan:spec/slot-content-page-scope` compiles slotted children in the page's scope; a slotted `$literal` node stays literal there by the same check.

## Implementation

1. **`packages/compiler/src/shared.ts`**
   - `export const LITERAL_KEY = "$literal"` and `export function isLiteralNode(node: unknown): boolean` (an object whose `$literal` is `true`).
   - `export function markLiteral(nodes: (JxElement | string)[]): (JxElement | string)[]`: returns the array with each element node given `$literal: true` (a shallow copy, so the entry's cached tree is not mutated) and each string containing `${` split as the Open describes. JSDoc cites spec.md §8.4.
   - `renderStaticNode` and `renderInner`: under a literal node, string values are escaped and written, never passed to `resolveStaticValue`; the literal flag is inherited by descendants through the scope-free path (a `literal` parameter, or the node's own key, read at each level).
2. **`packages/compiler/src/site/site-build.ts`**, `resolveDocTemplates`: at both splice points (lines 1930 and 1943) the resolved array goes through `markLiteral` and the recursion into it is removed. At the top of the function, return when `isLiteralNode(node)`. `expandMapTemplate`'s `evaluateMapTemplate` pass skips a literal node the same way.
3. **`packages/compiler/src/targets/compile-client.ts`**, `buildClientNode`: a literal node, and everything under it, is emitted with no binding (its `textContent`, attributes and style written as static, escaped values), and `isDynamic` (`shared.ts`) does not count a template under a literal node.
4. **`packages/compiler/src/targets/compile-static.ts`**, `compileNode`: the same for the static target.
5. Strip `$literal` wherever a node is serialised for the client (`data-jx-props`, a `$map` template's JSON) if any such path can reach a literal node; the tests below show whether one does.

**Integration contract.** Once this lands, `@jxsuite/compiler`'s `shared.ts` exports `LITERAL_KEY`, `isLiteralNode` and `markLiteral`. Content reached through a computed-children template is literal everywhere the build reads it, so a pass added later that evaluates or binds templates checks `isLiteralNode` first, and a plan that splices data into a tree another way calls `markLiteral`.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`. No source file is added. The per-file bar is `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`); ratchet only if the worst file rises. CI's derived matrix adds `extensions/parser` and the sites that build through the compiler.

- **`packages/compiler/tests/shared.test.ts`**, new `describe("markLiteral (spec.md §8.4)")`: "an element is marked and a copy is returned", "a string with a template is split so no part holds one", "a string without one is unchanged", and `renderStaticNode` "renders a literal node's template text as written".
- **`packages/compiler/tests/site-build.test.ts`**, new cases over a scratch site whose page renders `"children": "${state.entry.$children}"` from an entry whose Markdown holds `` `Clicked ${state.count} times` `` in inline code, `${state.missing}` in prose, and an unbalanced `${` in a code span, on a page that is otherwise dynamic (a handler):
  - "spliced content is rendered as written": the built HTML contains `Clicked ${state.count} times` inside `<code>`, escaped as the emitter escapes text.
  - "spliced content adds no binding": the page's module contains no binding for any of the three, and `new Bun.Transpiler({ loader: "js" }).transformSync(moduleText)` does not throw (the syntax-error shape).
  - "an authored template beside the splice still binds": a `textContent` template the page writes next to the wrapper is bound as before.
- **`packages/compiler/tests/compile-client.test.ts`** and **`compile-static.test.ts`**: "a literal node emits its templates as text" for each target.

## Specs & docs

`specs/spec.md` §8.4, in place:

- Delete the leading Partial marker.
- "Computed Children (Build Time)": "The compiler's template pass replaces `children` with the resolved array and recurses into it." becomes "The compiler's template pass replaces `children` with the resolved array. What it splices in is content, not a template: a `${` in its text, attributes or styles is written as it stands, in every output, so a parsed Markdown entry that quotes a template shows it rather than evaluating it."
- **Fragment:** `bun run spec:change spec.md major -m "§8.4 content spliced in by a computed-children template is literal: its text, attributes and styles are no longer evaluated as templates at build time or bound in the page's module."` Level major: §8.4 documented the recursion, and an entry that relied on evaluating a template in its own text changes output (at 0.x this moves the minor).

Docs:

- `docs/framework/site/content-collections.md`, after the sentence that introduces `"children": "${state.post.$children ?? []}"`: "The entry's content is rendered as written. A `${…}` in a post, such as a code sample about templates, stays text: only the page's own templates are evaluated."
- `docs/framework/concepts/elements.md` (`spec: spec.md#8`): if it describes computed children, the same sentence; otherwise no change. `bun run docs:sync` also names `docs/framework/site/routing.md` (its example uses the form), which needs no change.
- `docs/start/first-component.md` and `docs/framework/concepts/security.md` need no text change: this plan is what makes their inline code render.

Landing deletes this file, and in `plans/compiler/client-template-text-children.md`, if it has not landed, rewords the Open's citation of this plan to cite spec.md §8.4.

## Acceptance

- `bun run build` of `sites/jxsuite.com` (or its CI lane): `grep -c "Clicked undefined times" dist/docs/start/first-component/index.html` prints `0`, and `/docs/framework/concepts/security/`'s `app.js` passes the same `Bun.Transpiler` parse.
- `git grep -n "resolveDocTemplates(spliced\|resolveDocTemplates(child, scope)" packages/compiler/src/site/site-build.ts` prints nothing.
- `bun run plans:status --spec spec` no longer lists `spec.md#8.4`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
