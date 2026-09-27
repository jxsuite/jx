---
status: drafted
disposition: implement
claims:
  - spec.md#19.6
requires:
  - spec/compiled-keyed-lists
  - spec/tag-expression-completion-lint
workspaces:
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: L
---

# A tag chosen at creation compiles for every kind of page and is kept for the element's lifetime in every tier

## Context

`specs/spec.md` §19.6, line 2174:

> **Status: Partial.** All three positions ship in the interpreter, the element target and the static target. Two parts do not: `jx validate` has no lint for a tag discriminant that is also an assignment target (`packages/compiler/src/site/validate-command.ts` runs only the popover, dialog and accessibility lints), and `compile-client.ts` refuses a tag expression on a dynamic page ("A tag chosen at creation is not supported on a dynamic page yet").

The lint half is `plan:spec/tag-expression-completion-lint`, an enabling plan this one requires; this plan owns the compiled half and flips the marker. Verified against the tree on 2026-09-27. The interpreter is right: `resolveTagName` (`packages/runtime/src/runtime.ts:2670`) runs once when `renderNode` creates the element, untracked, and `packages/runtime/tests/tag-expression.test.ts` ("DECIDED ONCE") pins it. The census's "ships in the element target and the static target" does not hold:

1. **Client target refuses.** `buildClientNode` (`compile-client.ts:359`) throws for any chosen tag and `emitLitMapTemplate` (`:645`) throws for one in a repeater row, `$switch` case or mixed-children region. `packages/compiler/tests/tagname-expression-targets.test.ts` pins both refusals.
2. **Element target re-reads the tag.** `emitLitNode` (`compile-element.ts:986`) emits `${<discriminant> ? html… : html…}` inside `template()`, which `effect(() => render(this.template(), this))` (`:813`) re-runs, so a write to the discriminant makes lit swap the element: the replacement §19.6's "Why once and not live" rules out. The element tests assert source text only.
3. **Element target, repeater root.** `emitMappedArray` (`:1248`) reads `mapDef.tagName ?? "div"` as a string. Probe: a row template `{ tagName: <?: on $map/item/href>, textContent: "row" }` compiles to `<[object Object]>row</[object Object]>`.
4. **Element target, `$map/` discriminant.** `compileOperandSource` compiles `$map/item/href` to `_item.href` (`compileRef`'s aggregate-callback names, `packages/runtime/src/expression.ts:937`), while the row callback binds `item` and `index`. Probe: a chosen tag inside a row emits `${_item.href ? …}`, a `ReferenceError` at render. Every compiled expression in a row has the same unbound `_item`.
5. **Static target, nested and row-scoped discriminants.** `resolveStaticTagName` (`packages/compiler/src/shared.ts:1468`) reads `target` with `resolveStaticValue`, which resolves a pointer but returns a nested node as itself. Probe: `?:` over `{ ">": #/state/n, 3 }` with `n = 1` gives `a` where the interpreter gives `div`; `switch` over `#/state/n + 1` gives `p` where it gives `h2`. And `expandMapTemplate` (`packages/compiler/src/site/site-build.ts:1785`) copies a row's `tagName` verbatim: the row's `$map` lives only in `childScope`, so the later prerender resolves `$map/item/…` against the page scope and always emits the fallback.
6. **`switch` reads inherited keys.** The interpreter looks cases up as `expression.cases[String(key)]`, as the element target's emitted lookup does, so a discriminant of `"constructor"` returns `Object`, which is not a tag, and `createElement` throws.

No committed document (sites, starters, examples, Studio surfaces, `packages/ui`) declares a chosen tag, so no shipped page changes output.

**Related.** §10.4 (a kept row keeps its node), §19.2 (operands), §3.1 (the root `tagName` stays literal), `compiler.md` §4.8 (one template per branch, shared subtrees hoisted) and §9.2 (the `$switch` precedent on a dynamic page).

## Outcome

- spec.md §19.6 → Implemented, together with the lint that `plan:spec/tag-expression-completion-lint` lands first. Every tier resolves a chosen tag by the interpreter's rule, once per created element: the static build at build time (a build-time row against its own item), a dynamic page at prerender and once more at hydration, and lit-rendered output on the element's first render, kept while lit keeps the element.
- compiler.md gains §9.3 (a chosen tag on a dynamic page, Implemented), and §4.8 says a chosen tag is kept.

## Decisions

- **Open:** when is "creation" on a prerendered dynamic page? Recommendation: the prerender commits to the candidate the build's state selects, and hydration evaluates the discriminant once against the page's state; when that selects another candidate, the element is replaced before any binding attaches, and never again. This keeps the prerendered content and agrees with the interpreter (and so with Studio's canvas) when the discriminant reads state only the browser has: a stored preference, a cookie, a `$src` function. Alternatives: render the element client-side from an empty placeholder, as `compiler.md` §9.2 does for `$switch`, which ships no content for the whole subtree until the module runs; or commit to the build's choice and refuse a discriminant that reads browser-only state, a restriction §19.6 does not state.
- **Decided:** in lit output, "once" means once per lit part, through a real lit `Directive` (`__jxTag`) imported from `lit-html/directive.js`. lit keeps a directive instance exactly as long as the part that holds it, so a row or `$switch` case rendered anew chooses anew, as the interpreter's does, and under `plan:spec/compiled-keyed-lists`'s `repeat()` a row's part moves with its key (§10.4). That plan is required because it is what makes a `lit-html/` subpath resolve on every page a build writes (its integration contract); inlining lit's mangled directive protocol (`_$AT`/`_$AS` in the production build, `_$initialize`/`_$resolve` in development) was rejected as a private API in shipped output.
- **Decided:** one rule decides the tag. `resolveTagName` is the rule; `resolveStaticTagName` calls it, and `tagPickSource` compiles the same decision for emitted code, drift-tested against it. `switch` matches the discriminant's string form against the cases object's own keys only (`Object.hasOwn`) in every tier, since a tag lookup must only ever return a `TagName`.
- **Decided:** a build-time expanded row resolves its chosen tag at expansion, against the row's scope. `listSettled` (added by `plan:spec/compiled-keyed-lists`) also reads the `#/state/` refs of every chosen tag in the row template, so a row whose tag reads runtime-only state leaves the list to the client, where the directive chooses at render. That is the gate that plan applies to `items`.
- **Decided:** a row callback that references `_item` or `_index` binds them (`const _item = item, _index = index;`), rather than teaching `compileRef` a second naming. JavaScript scoping makes it right, including an aggregate inside the row, whose own `_item` parameter shadows it. It also repairs every compiled expression and statement handler in a row, which reads the same unbound `_item` today.
- **Decided:** candidate templates are keyed by distinct tag (`tagNameCandidates`), and their shared inner subtree is emitted once: the element target's existing hoisting, and in a client lit region an immediately invoked arrow that passes the inner template to each candidate. A dynamic page's swap table omits the prerendered candidate, which only a swap to another tag could need. Candidates that disagree about being preformatted each emit their own inner, as `compiler.md` §4.8 already does.
- **Decided:** the directive and the swap machinery are emitted only when used, detected on the emitted text as `emitMappedArray` detects its `$map` prelude, so a module without a chosen tag is byte-identical to today's.
- **Decided:** no edge to `plan:spec/expression-build-checks` (the critic's suggestion). Its walker serves the lint, and the lint lives in the sibling plan, which records why it does not need it either.

## Implementation

**TEC1.1: the rule, the static build and the element target.**

1. `packages/runtime/src/runtime.ts`, `resolveTagName`: the `switch` branch becomes `const key = String(evaluateOperand(expression.target, scope, null)); return Object.hasOwn(expression.cases, key) ? expression.cases[key]! : expression.default;`.
2. `packages/compiler/src/shared.ts`:
   - `resolveStaticTagName(tagName, scope)`: a string is itself; anything `isTagExpression` refuses is `"div"`; otherwise `try { return resolveTagName(tagName, (scope ?? {}) as JxScope); } catch { return <initial for ?:, default for switch>; }`, importing `resolveTagName` from `@jxsuite/runtime`. A throwing discriminant (a `call` into a build-time placeholder) commits to the fallback, and hydration corrects it where the page is dynamic.
   - `export function tagPickSource(expression: JxTagExpression, operand: string): string`: for `?:`, `(<operand>) ? "<value>" : "<initial>"`; for `switch`, `((_k) => Object.hasOwn(<JSON cases>, _k) ? <JSON cases>[_k] : "<default>")(String(<operand>))`. Literals go through `JSON.stringify`.
   - `export const TAG_CHOICE = "__jxTag"`, `export const TAG_CHOICE_IMPORTS = "import { Directive, directive } from 'lit-html/directive.js';"` and `export function tagChoiceDirectiveSource(): string`, beside `attrHelperSource()`, returning `class __JxTagChoice extends Directive { render(pick, templates) { if (this.tag === undefined) this.tag = pick(); return templates[this.tag](); } }` and `const __jxTag = directive(__JxTagChoice);`.
3. `packages/compiler/src/site/site-build.ts`:
   - `expandMapTemplate`: a `k === "tagName" && isTagExpression(v)` branch sets `node.tagName = resolveStaticTagName(v, scope)`.
   - `listSettled`: also fails when a chosen tag anywhere in the row template (through `children` and `cases`) has a `#/state/` ref in its discriminant that `isRuntimeOnlyRef` marks.
4. `packages/compiler/src/targets/compile-element.ts`:
   - `emitLitNode`'s chosen-tag branch keeps its hoisting (`innerRef`) and renders one template per `tagNameCandidates(def.tagName)` entry through `emitLitNode({ ...def, tagName: t }, …, innerRef)`, then emits ``${__jxTag(() => <pick>, { "<t>": () => html`…`, … })}``, where `<pick>` is `tagPickSource(expression, compileOperandSource(expression.target, { eventParam: "e", statePrefix: "s" }))`. Both current output shapes (the ternary and the keyed lookup with `??`) go.
   - `emitMappedArray`: when `isTagExpression(mapDef.tagName)`, the callback returns ``__jxTag(() => <pick>, { "<t>": () => html`<t …attrs>…inner</t>`, … })``. The inner is hoisted into `mapScope` with `hoistSubtree` when it is non-empty and every candidate agrees about being preformatted. The prelude gains `const _item = item, _index = index;` when the row body contains `_item` or `_index`.
   - `emitElementModule`: remember the import block's position, and after the template is emitted, splice in `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource()` (after `attrHelperSource()`) when the module text contains `__jxTag(`.

**TEC1.2: the client target.**

5. `packages/compiler/src/targets/compile-client.ts`:
   - `emitLitMapTemplate(def, preformatted = false, inMap = true)`: its attribute and content assembly moves into a private `emitLitParts(def, inPre, inMap): { attrs: string; inner: string }`. The refusal goes; a chosen tag returns ``${((_c) => __jxTag(() => <pick>, { "<t>": () => html`<t${attrs}>${_c}</t>`, … }))(html`<inner>`)}``, with the pick compiled under `statePrefix: "state"`, or with each candidate's own inner when candidates disagree about being preformatted. With `inMap` false, handlers omit the `state.$map = { item, index };` prefix, which references row parameters. `emitChildLit` passes `inMap` through, and `emitArrayHole` passes `true`.
   - Row callbacks: the whole-children binding and `emitArrayHole` build their callback through one private `clientRowCallback(tpl)`, which adds the `_item`/`_index` binding when `tpl` references either. `emitClientList` is left alone, as `plan:spec/compiled-keyed-lists` asks.
   - `buildClientNode`: the refusal and its comment go. For a chosen tag, `committed = resolveStaticTagName(def.tagName, nextContext.scope)`, and the rest of the function runs on the node with `tagName: committed`. Then it takes `key = "_tg" + counter.tg++`, sets `counter.needsLit = true` and `bindings.set(key, "{ pick: () => <pick>, templates: { … } }")`, where the templates are every other candidate (compared case-insensitively) as ``() => html`${emitLitMapTemplate({ ...source, tagName: t }, context.preformatted === true, false)}` ``. It appends `data-jx-tag="<key>"` to `staticAttrs` and forces `needsBind`. The counter type gains `tg`.
   - `emitClientModule`, when `counter.tg > 0`: emit `function __jxSwapTag(el, choice) { const tag = choice.pick(); if (tag.toLowerCase() === el.localName.toLowerCase()) return false; const mark = document.createComment(''); el.replaceWith(mark); const parent = mark.parentNode; effect(() => { render(choice.templates[tag](), parent, { renderBefore: mark }); }); return true; }`, and open the hydration loop's callback with `if (!el.isConnected) return; const _tk = el.getAttribute('data-jx-tag'); if (_tk !== null && __jxSwapTag(el, bind[_tk])) return;`. So a replaced element's own bindings and its descendants' are never attached, and the anchor comment keeps lit's part bounded. Add `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource()` after the `lit-html` import when the module text contains `__jxTag(`.

**Integration contract.** `shared.ts` exports `tagPickSource`, `TAG_CHOICE`, `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource`. `resolveStaticTagName` returns what `resolveTagName` returns, except that a throw becomes the fallback. A construct that renders an element into lit output reaches a chosen tag only through `emitLitNode` (element target) or `emitLitMapTemplate` (client target), never by reading `tagName` as a string. `emitLitMapTemplate(def, preformatted, false)` emits handlers without the row prefix, which a `$switch` case or mixed-children region outside a row may pass (today they emit the prefix and throw `ReferenceError` on the event: that is `plan:spec/compiled-external-switch-cases`'s to use or leave). Every compiled row callback that references `_item` or `_index` binds them. On a dynamic page an element carrying `data-jx-tag` is judged before any of its bindings, and nothing inside a replaced element is hydrated.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`.

**`packages/runtime/tests/tag-expression.test.ts`:** `a switch discriminant naming an Object.prototype member takes the default` (`"constructor"`, `"__proto__"`, `"toString"` each give `p`).

**`packages/compiler/tests/tagname-expression-targets.test.ts`**

- `resolveStaticTagName`: `a nested node discriminant is evaluated, as the interpreter evaluates it` (the two Context 5 probes give `div` and `h2`); `it agrees with resolveTagName over a table of discriminants` (`undefined`, `null`, `0`, `""`, `"0"`, `1`, `"1"`, `"constructor"`, `{}`, `[]`, under both operators); `a discriminant that throws commits to the fallback`.
- `tagPickSource`: `the emitted pick agrees with resolveTagName` over the same table, built with `new Function("state", "return " + pick)`.
- The refusal describe becomes `compileClient — a chosen tag on a dynamic page`:
  - `the prerender commits to the build's candidate and marks it`: html has `<a ` with `data-bind` and `data-jx-tag="_tg0"`, and its `href` binding; the module's `_tg0` holds a pick and a `div` template only.
  - `a module without a chosen tag carries no swap, directive or aliases`: no `__jxSwapTag`, `isConnected`, `__jxTag` or `_item`.
  - `a repeater row, a $switch case and a mixed-children region each compile to the directive`: the module holds `__jxTag(` and the directive source exactly once, and the row callback binds `_item`.
  - `a swap template outside a row carries no row prefix in its handlers`.

**New `packages/compiler/tests/client-tag-choice.test.ts`.** It executes the module under happy-dom, as `compile-element-render.test.ts` does for elements: write the compiled module to a temporary directory under `tests/`, set `document.body` from the compiled html, import the module. Cases:

- `hydration keeps the prerendered element when the page's state agrees`: the node read before the import is the node after, connected.
- `hydration replaces the element once when the page's state disagrees`: the discriminant is a `LocalStorage` entry whose stored value selects `a` while the build chose `div`. After the import there is one `a`, its text binding updates on a state write, and a later write to the discriminant (a button's `=` handler) leaves the same `a` node in place.
- `nothing inside a replaced element is bound twice`: a click on the replacement's button runs its handler once.
- `a repeater row keeps its tag when its item's discriminant is written`: a row handler `=` on `$map/item/href` runs (no `ReferenceError`) and the row's node and tag stay.

**`packages/compiler/tests/compile-element.test.ts`:** the multiway case asserts `__jxTag(`, one `"h1": () => html` template per distinct tag and `Object.hasOwn` in the pick, in place of `'"1": html'` and `?? html`. New cases: `a chosen tag at a repeater row's root compiles to the directive, not [object Object]` and `a $map/ discriminant reads the row's item` (the callback binds `_item`). `branch-subtree-hoisting.test.ts` keeps its assertions (one `<span`, two `${_c0}`) and gains `cases that share a tag share one template`.

**`packages/compiler/tests/compile-element-render.test.ts`,** new `describe("compiled element — a chosen tag is kept")`: after mount, writing `href` leaves the same element and tag; rows choose `a`/`div` from their items, writing one row's `href` keeps that row's node, and a row rendered anew after the list shrinks and regrows chooses from its new item.

**`packages/compiler/tests/site-build.test.ts`:** `a build-time repeater row chooses its tag from its own item` (literal `items`; `dist/index.html` has one `<a` row and one `<div` row); `a row whose tag reads handler-written state is left to the client` (no prerendered rows, `__jxTag(` in the page module).

Coverage: no new source file, so the manifest check is unaffected. Touched files are held per file to `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`) and `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`). Every new branch is exercised above. Raise a threshold to just below the new minimum if the worst file rises.

## Specs & docs

**`specs/spec.md` §19.6, edited in place (TEC1.2):**

- The marker (as `plan:spec/tag-expression-completion-lint` leaves it) becomes:

  > **Status: Implemented.** All three positions ship in the interpreter and in every compiled target. One rule resolves a chosen tag (`resolveTagName` in `packages/runtime/src/runtime.ts`, which the static prerender calls and `tagPickSource` in `packages/compiler/src/shared.ts` compiles). Lit output keeps it for the element's lifetime (`tagChoiceDirectiveSource()`), and a dynamic page checks it once at hydration (`compile-client.ts`). `jx validate` and Studio warn when the discriminant is also written (`packages/schema/src/tag-expressions.ts`).

- After the **Why once and not live.** paragraph, add:

  > **When creation is, per tier.** The interpreter resolves the tag when it creates the element, and a mapped-array row it keeps keeps its tag (§10.4). A static build resolves it against the state the prerender reads, and a build-time repeater row against its own `$map` context. A dynamic page prerenders that choice, then resolves the discriminant once more against the page's state when it hydrates. When that selects another candidate, the prerendered element is replaced by it before any binding attaches, and the choice is not revisited. In lit-rendered output (a component, a repeater row, a `$switch` case) the tag is resolved when the element is first rendered and kept for as long as the renderer keeps that element, so a row or case rendered anew chooses anew, as the interpreter's does. Every tier evaluates the discriminant as an operand (§19.2), nested nodes included, and `switch` matches its string form against the case object's own keys only.

**`specs/compiler.md`:**

- §4.8, after the hoisting paragraph: "A chosen `tagName` is kept, not re-read (spec.md §19.6). Its branches become one template per distinct candidate, passed to `__jxTag`, a lit directive emitted from `tagChoiceDirectiveSource()` that picks on the element's first render and returns the same candidate for as long as lit keeps that part. A repeater row's root may carry one too."
- New §9.3 "A Chosen Tag on a Dynamic Page", after §9.2, with `> **Status: Implemented.**`: "The prerender commits to the candidate `resolveStaticTagName` selects and emits that element with its bindings, plus `data-jx-tag="_tgN"`. The module's `bind._tgN` holds `pick`, the discriminant compiled over `state`, and a lit template for each other candidate. Hydration judges the element before any of its bindings. When `pick()` names the prerendered tag it does nothing; otherwise it replaces the element with a comment anchor and renders the picked template before it inside an effect, so the content stays live and the choice is not revisited. Elements inside a replaced subtree are not hydrated. Inside a lit-rendered region (a mapped array, mixed children, a `$switch` case), a chosen tag compiles as in the element target (§4.8)."

**Fragments** (single quotes, so the shell leaves `$` alone):

- `bun run spec:change spec.md minor -m '§19.6: a tag chosen at creation compiles on a dynamic page, prerendered and chosen once more at hydration; compiled output keeps the tag for as long as the element lives; a static build evaluates a nested or row-scoped discriminant as the interpreter does; and switch matches only its own case keys.'`
- `bun run spec:change compiler.md minor -m '§4.8 and §9.3: a chosen tagName compiles to one template per distinct candidate behind a lit directive that keeps its first choice, and a dynamic page prerenders the chosen tag and replaces it once at hydration when the page state selects another.'`

**Docs** (no em dashes in either page):

- `docs/framework/concepts/expressions.md` (`spec: spec.md#19`), "Choosing an element's tag", after the two rules: "This works wherever an element can appear. In a list, each row chooses its tag when the row is first drawn and keeps it while the row stays. On a page with live state, the built HTML already carries the tag the page's starting state selects. If the state the page loads with selects another (a saved preference, say), that one element is rebuilt once, before anything on it responds."
- `docs/framework/build.md` (its `code:` lists `compile-client.ts` and `shared.ts`), "Dynamic pages": after "There is no client-side re-render of the initial view; the JS only maintains what changes." add "The one exception is an element whose tag is chosen by a formula: the HTML carries the tag the build's state selects, and if the state the page loads with selects another, the module rebuilds that element once, before binding it."
- No other page changes. `bun run docs:sync` also names the pages whose `code:` lists `compile-element.ts`, `shared.ts`, `site-build.ts` or `runtime.ts` (`components.md`, `elements.md`, `functions.md`, `lists.md`, `styling.md` and others). None describes tag choice or row callbacks.

This plan does not graduate `spec.md`, whose other open items remain. Landing it deletes this file and `plan:spec/tag-expression-completion-lint` is already gone.

## Acceptance

- From `packages/runtime` and `packages/compiler`: `bun test --isolate --coverage` is green with no file below its threshold, and `bun scripts/check-coverage-manifest.ts packages/runtime` and `… packages/compiler` pass.
- This prints `true` where it threw before:

  ```sh
  bun -e 'import { compileClient } from "./packages/compiler/src/targets/compile-client.ts"; const t = { $expression: { operator: "?:", target: { $ref: "#/state/href" }, value: "a", initial: "div" } }; const r = compileClient({ tagName: "div", state: { href: "" }, children: [{ tagName: t, textContent: "x" }] }, {}); console.log(r.html.includes("data-jx-tag=\"_tg0\""))'
  ```

- This prints `div h2` where it printed `a p`:

  ```sh
  bun -e 'import { resolveStaticTagName as r } from "./packages/compiler/src/shared.ts"; const n = { $ref: "#/state/n" }; console.log(r({ $expression: { operator: "?:", target: { operator: ">", target: n, value: 3 }, value: "a", initial: "div" } }, { n: 1 }), r({ $expression: { operator: "switch", target: { operator: "+", target: n, value: 1 }, cases: { "2": "h2" }, default: "p" } }, { n: 1 }))'
  ```

- `rg -n "not supported on a dynamic page|not supported inside a dynamic page" packages` finds nothing.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` are green, and `bun run plans:status --spec spec` no longer lists §19.6.

## Slices

| Slice  | Scope                                                                                                                                                                          | Claims       | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----- |
| TEC1.1 | The one rule (`resolveTagName` own keys, `resolveStaticTagName`, `tagPickSource`), the directive source, build-time rows, and the element target (kept tag, row root, `_item`) | —            | open  |
| TEC1.2 | The client target (prerender and hydration swap, lit regions, row aliases), compiler.md §4.8 and §9.3, the §19.6 flip and the docs                                             | spec.md#19.6 | open  |
