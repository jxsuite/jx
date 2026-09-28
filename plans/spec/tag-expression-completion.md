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

The lint half is `plan:spec/tag-expression-completion-lint`, an enabling plan this one requires; this plan owns the compiled half and flips the marker. Verified against the tree on 2026-09-27. The interpreter creates the element right: `resolveTagName` (`packages/runtime/src/runtime.ts:2670`) runs once when `renderNode` creates the element, untracked, and `packages/runtime/tests/tag-expression.test.ts` ("DECIDED ONCE") pins it. The census's "ships in the element target and the static target" does not hold:

1. **Client target refuses.** `buildClientNode` (`compile-client.ts:359`) throws for any chosen tag and `emitLitMapTemplate` (`:645`) throws for one in a repeater row, `$switch` case or mixed-children region. `packages/compiler/tests/tagname-expression-targets.test.ts` pins both refusals.
2. **Element target re-reads the tag.** `emitLitNode` (`compile-element.ts:986`) emits `${<discriminant> ? html… : html…}` inside `template()`, which `effect(() => render(this.template(), this))` (`:813`) re-runs, so a write to the discriminant makes lit swap the element: the replacement §19.6's "Why once and not live" rules out. `branch-subtree-hoisting.test.ts` asserts that swap as intended ("switching the discriminant swaps the tag and keeps the subtree").
3. **Element target, repeater root.** `emitMappedArray` (`:1248`) reads `mapDef.tagName ?? "div"` as a string. Probe: a row template `{ tagName: <?: on $map/item/href>, textContent: "row" }` compiles to `<[object Object]>row</[object Object]>`.
4. **Element target, `$map/` discriminant.** `compileOperandSource` compiles `$map/item/href` to `_item.href` (`compileRef`'s aggregate-callback names, `packages/runtime/src/expression.ts:937`), while the row callback binds `item` and `index`. Probe: a chosen tag inside a row emits `${_item.href ? …}`, a `ReferenceError` at render. Every compiled expression and statement handler in a row, in both targets, reads the same unbound `_item`.
5. **Static target, nested and row-scoped discriminants.** `resolveStaticTagName` (`packages/compiler/src/shared.ts:1468`) reads `target` with `resolveStaticValue`, which resolves a pointer but returns a nested node as itself. Probe: `?:` over `{ ">": #/state/n, 3 }` with `n = 1` gives `a` where the interpreter gives `div`; `switch` over `#/state/n + 1` gives `p` where it gives `h2`. And `expandMapTemplate` (`packages/compiler/src/site/site-build.ts:1785`) copies a row's `tagName` verbatim: the row's `$map` lives only in `childScope`, so the later prerender resolves `$map/item/…` against the page scope and always emits the fallback.
6. **`switch` reads inherited keys.** `resolveTagName`, `resolveStaticTagName` and the element target's emitted lookup all read `cases[String(key)]`, so a discriminant of `"constructor"` returns `Object`, which is not a tag, and `createElement` throws. The general `switch` operator is already right in both tiers: `evaluateExpression` matches with `Object.hasOwn(cases, key)` (`expression.ts:641`) and `compileExpression` chains strict-equality tests over the declared keys (`:1097`).

No committed document (sites, starters, examples, Studio surfaces, `packages/ui`) declares a chosen tag, so no shipped page changes output.

**Related.** §10.4 (a kept row keeps its node), §19.2 (operands), §3.1 (the root `tagName` stays literal), `compiler.md` §4.8 (one template per branch, shared subtrees hoisted) and §9.2 (the `$switch` precedent on a dynamic page).

## Outcome

- spec.md §19.6 → Implemented, together with the lint that `plan:spec/tag-expression-completion-lint` lands first. Every tier resolves a chosen tag by the interpreter's rule, once per created element: the static build at build time (a build-time row against its own item), a dynamic page at prerender and once more at hydration, and lit-rendered output on the element's first render, kept while lit keeps the element.
- compiler.md: §4.8 says a chosen tag is kept (and cites §19.6, not §8.6), §11 gains `tagChoiceDirectiveSource()`, and a new §9.3 (a chosen tag on a dynamic page, Implemented).

## Decisions

- **Open:** when is "creation" on a prerendered dynamic page? Recommendation: the prerender commits to the candidate the build's state selects, and hydration evaluates the discriminant once against the page's state. When that selects another candidate, a new element of that tag takes the prerendered element's attributes and children and replaces it, before any binding attaches, and hydration binds the new element; the choice is never revisited. This keeps the prerendered content, reuses every existing binding path (nothing is re-emitted through a second emitter), and agrees with the interpreter (and so with Studio's canvas) when the discriminant reads state only the browser has: a stored preference, a cookie, a `$src` function. Two consequences: the subtree under a chosen tag with a preformatted candidate is prerendered without separator whitespace, so it reads the same under either tag; and a chosen tag whose candidates disagree about being void, on an element with content, is a build error on a dynamic page, because the void candidate's markup cannot carry that content. Alternatives: render the element client-side from an empty placeholder, as `compiler.md` §9.2 does for `$switch`, which ships no content for the whole subtree until the module runs; or commit to the build's choice and refuse a discriminant that reads browser-only state, a restriction §19.6 does not state.
- **Decided:** in lit output, "once" means once per lit part, through a real lit `Directive` (`__jxTag`) imported from `lit-html/directive.js`. lit keeps a directive instance exactly as long as the part that holds it, so a row or `$switch` case rendered anew chooses anew, as the interpreter's does, and under `plan:spec/compiled-keyed-lists`'s `repeat()` a row's part moves with its key (§10.4). That plan is required because it is what makes a `lit-html/` subpath resolve on every page a build writes (its integration contract). The import aliases both names (`__JxDirective`, `__jxDirective`), because that plan's keyed-list import already binds `directive` from `lit-html/async-directive.js`, and a module with both a keyed list and a chosen tag would otherwise declare it twice. Inlining lit's mangled directive protocol (`_$AT`/`_$AS` in the production build, `_$initialize`/`_$resolve` in development) was rejected as a private API in shipped output.
- **Decided:** one rule decides the tag, and it is the general conditional of §19. `resolveTagName` returns `evaluateExpression` of the tag expression (a `?:` or `switch` node whose results are literals); `resolveStaticTagName` calls `resolveTagName`; emitted code picks with `compileExpression` of the same node. Both already match `switch` against own keys only (Context 6), so no new emitter or lookup is written, and a table test holds the compiled pick to `resolveTagName`.
- **Decided:** a build-time expanded row binds its chosen tag's `$map` reads at expansion. Each `$map/` operand in the discriminant is replaced by its value in the row's scope. When no `$ref` remains, or a replaced value is an object or array (which an operand cannot carry as a literal), the tag is resolved there; otherwise the rewritten chosen tag stays on the row, so the page's prerender commits it and hydration re-judges it exactly as for any other element. This needs no change to `plan:spec/compiled-keyed-lists`'s `listSettled`, keeps such a list prerendered, and covers storage-backed state, which that plan's runtime-only marks do not.
- **Decided:** a row callback that references `_item` or `_index` binds them (`const _item = item, _index = index;`, first in the callback), rather than teaching `compileRef` a second naming. JavaScript scoping makes it right, including an aggregate inside the row, whose own `_item` parameter shadows it, and it repairs every compiled expression and statement handler in a row (Context 4). In the client target the callback is built inside `plan:spec/compiled-keyed-lists`'s `emitClientList`; that plan asks row-template plans to leave it alone, meaning no second list emitter, and this plan changes only how it builds the callback.
- **Decided:** candidate templates are keyed by distinct tag (`tagNameCandidates`), and their shared inner subtree is emitted once: the element target's existing hoisting, and in a client lit region an immediately invoked arrow that passes the inner template to each candidate. Candidates that disagree about being preformatted each emit their own inner, as `compiler.md` §4.8 already does, and a void candidate emits none.
- **Decided:** the directive and the retag helper are emitted only when used, detected on the emitted text as `emitMappedArray` detects its `$map` prelude, so a module without a chosen tag is byte-identical to today's.
- **Decided:** no edge to `plan:spec/expression-build-checks` (the critic's suggestion). Its walker serves the lint, and the lint lives in the sibling plan, which records why it does not need it either.

## Implementation

**TEC1.1: the rule, the static build and the element target.**

1. `packages/runtime/src/runtime.ts`, `resolveTagName`: after the string and `isTagExpression` guards, `return evaluateExpression(tagName.$expression as ExpressionNode, scope, null) as string;` (already imported from `./expression.ts`), replacing both branches.
2. `packages/compiler/src/shared.ts`:
   - `resolveStaticTagName(tagName, scope)`: a string is itself; anything `isTagExpression` refuses is `"div"`; otherwise `try { return resolveTagName(tagName, (scope ?? {}) as JxScope); } catch { return <initial for ?:, default for switch>; }`, importing `resolveTagName` from `@jxsuite/runtime` (the module already imports from it). A throwing discriminant (a `call` into a build-time placeholder) commits to the fallback, and hydration corrects it where the page is dynamic.
   - Beside `attrHelperSource()`: `export const TAG_CHOICE_IMPORTS = "import { Directive as __JxDirective, directive as __jxDirective } from 'lit-html/directive.js';"` and `export function tagChoiceDirectiveSource(): string`, returning `class __JxTagChoice extends __JxDirective { render(pick, templates) { if (this.tag === undefined) this.tag = pick(); return templates[this.tag](); } }` and `const __jxTag = __jxDirective(__JxTagChoice);`.
3. `packages/compiler/src/site/site-build.ts`, `expandMapTemplate`: a `k === "tagName" && isTagExpression(v)` branch sets `node.tagName = bindRowTag(v, scope)`. The private `bindRowTag` copies the `$expression`, replacing every `{ $ref }` whose `canonicalMapRef(ref)` starts with `$map/` by `resolveRefValue(ref, scope)`, and returns `resolveStaticTagName(v, scope)` when a replaced value is an object or array or no `$ref` remains, else `{ $expression: <the copy> }`.
4. `packages/compiler/src/targets/compile-element.ts`:
   - `emitLitNode`'s chosen-tag branch keeps its hoisting (`innerRef`) and renders one template per `tagNameCandidates(def.tagName)` entry through `emitLitNode({ ...def, tagName: t }, …, innerRef)`, then emits ``${__jxTag(() => <pick>, { "<t>": () => html`…`, … })}``, where `<pick>` is `compileExpression(expression as ExpressionNode, { eventParam: "e", statePrefix: "s" })`. Both current output shapes (the ternary and the keyed lookup with `??`) go.
   - `emitMappedArray`: when `isTagExpression(mapDef.tagName)`, the callback returns ``__jxTag(() => <pick>, { "<t>": () => html`<t …attrs>…inner</t>`, … })``. The inner is hoisted into `mapScope` with `hoistSubtree` when it is non-empty and every candidate agrees about being preformatted. The prelude opens with `const _item = item, _index = index; ` when the row body contains `_item` or `_index`, before the `$map` binding and the hoisted declarations that may read it.
   - `emitElementModule`: remember the import block's position, and after the template is emitted, splice in `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource()` (after `attrHelperSource()`) when the module text contains `__jxTag(`.

**TEC1.2: the client target.**

5. `packages/compiler/src/targets/compile-client.ts`:
   - `emitLitMapTemplate(def, preformatted)`: its attribute and content assembly moves into a private `emitLitParts(def, inPre): { attrs: string; inner: string }`. The refusal goes; a chosen tag returns ``${((_c) => __jxTag(() => <pick>, { "<t>": () => html`<t${attrs}>${_c}</t>`, … }))(html`<inner>`)}``, with the pick compiled under `statePrefix: "state"`, a void candidate rendered as `<t${attrs}>`, and each candidate given its own inner when they disagree about being preformatted.
   - `emitClientList` builds its row callback through a private `clientRowCallback(tpl)`, which opens the body with `const _item = item, _index = index;` when `tpl` references either. That is its only change.
   - `buildClientNode`: the refusal and its comment go. For a chosen tag it first throws when the candidates disagree about membership of the target's void set (`selfClosing`) and the node declares `children`, `textContent`, `innerHTML` or `$switch`, naming the candidates and the way out (make every candidate hold content, or move the element into a component). Then `tag = resolveStaticTagName(def.tagName, nextContext.scope)`; `nextContext.preformatted` is also true when any candidate is in `PREFORMATTED_TAGS`; it takes `key = "_tg" + counter.tg++`, sets `bindings.set(key, "() => " + <pick>)`, appends ` data-jx-tag="<key>"` to `staticAttrs` and forces `needsBind`. Every early return (`$switch`, mapped array, mixed children) already carries `staticAttrs` and `data-bind`. The counter type gains `tg` in its three inline declarations.
   - `emitClientModule`, when `counter.tg > 0`: emit `function __jxRetag(el, pick) { const tag = pick(); if (tag.toLowerCase() === el.localName.toLowerCase()) return el; const next = document.createElementNS(el.namespaceURI, tag); for (const a of el.attributes) next.setAttributeNode(a.cloneNode()); next.append(...el.childNodes); el.replaceWith(next); return next; }`, and open the hydration loop's callback with `const _tk = el.getAttribute('data-jx-tag'); if (_tk !== null) el = __jxRetag(el, bind[_tk]);`. `setAttributeNode` carries the `:`/`@` binding attributes, which `setAttribute` would refuse as names; the moved descendants stay connected and in the static `querySelectorAll` list, so each is hydrated once. Add `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource()` after the `lit-html` import when a binding contains `__jxTag(`.

**Integration contract.** `shared.ts` exports `TAG_CHOICE_IMPORTS` and `tagChoiceDirectiveSource`. `resolveStaticTagName` returns what `resolveTagName` returns, except that a throw becomes the fallback, and a compiled pick is `compileExpression` of the tag expression. A construct that renders an element into lit output reaches a chosen tag only through `emitLitNode` (element target) or `emitLitMapTemplate` (client target), never by reading `tagName` as a string; `emitLitParts(def, inPre)` is the client target's attribute and content assembly, where `plan:spec/compiled-external-switch-cases` puts its `$switch` branch. Every compiled row callback that references `_item` or `_index` binds them. On a dynamic page an element carrying `data-jx-tag` is judged before any of its bindings, and its replacement carries its attributes and children.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`.

**`packages/runtime/tests/tag-expression.test.ts`:** `a switch discriminant naming an Object.prototype member takes the default` (`"constructor"`, `"__proto__"`, `"toString"` each give `p`).

**`packages/compiler/tests/tagname-expression-targets.test.ts`**

- `resolveStaticTagName`: `a nested node discriminant is evaluated, as the interpreter evaluates it` (the two Context 5 probes give `div` and `h2`); `it agrees with resolveTagName over a table of discriminants` (`undefined`, `null`, `0`, `""`, `"0"`, `1`, `"1"`, `"constructor"`, `{}`, `[]`, under both operators); `a discriminant that throws commits to the fallback`.
- `the compiled pick agrees with resolveTagName` over the same table, with the pick from `compileExpression(…, { statePrefix: "state" })` run through `new Function("state", "return " + pick)`.
- The refusal describe becomes `compileClient — a chosen tag on a dynamic page`:
  - `the prerender commits to the build's candidate and marks it`: with `href: "/docs"`, html has `<a ` with `data-bind` and `data-jx-tag="_tg0"`, and its `href` binding; the module's `_tg0` is the pick.
  - `a module without a chosen tag carries no retag, directive or aliases`: no `__jxRetag`, `data-jx-tag`, `__jxTag` or `_item`.
  - `a repeater row, a $switch case and a mixed-children region each compile to the directive`: the module holds `__jxTag(` and the directive source exactly once, and the row callback binds `_item`.
  - `a choice between a void and a non-void tag on an element with content is refused, naming both`, and the same choice on an element without content compiles.
  - `a subtree under a chosen tag with a preformatted candidate is prerendered without separators`.

**New `packages/compiler/tests/client-tag-choice.test.ts`.** It executes the module under happy-dom, as `compile-element-render.test.ts` does for elements: write the compiled module to a temporary directory under `tests/`, set `document.body` from the compiled html, import the module. Cases:

- `hydration keeps the prerendered element when the page's state agrees`: the node read before the import is the node after, connected.
- `hydration replaces the element once when the page's state disagrees`: the discriminant is a `LocalStorage` entry whose stored value selects `a` while the build chose `div`. After the import there is one `a` carrying the `div`'s class and children, its text binding updates on a state write, and a later write to the discriminant (a button's `=` handler) leaves the same `a` node in place.
- `nothing inside a replaced element is bound twice`: a click on the replacement's button runs its handler once.
- `a replaced element inside svg keeps the SVG namespace`.
- `a repeater row keeps its tag when its item's discriminant is written`: a row handler `=` on `$map/item/href` runs (no `ReferenceError`) and the row's node and tag stay.

**`packages/compiler/tests/compile-element.test.ts`:** the two-way case asserts `__jxTag(() => (s.href ? "a" : "div")` in place of `${s.href`; the multiway case asserts `__jxTag(`, one `"h1": () => html` template per distinct tag and `_d === "1"` in the pick, in place of `'"1": html'` and `?? html`. New cases: `a chosen tag at a repeater row's root compiles to the directive, not [object Object]`, `a $map/ discriminant reads the row's item` (the callback binds `_item` before any hoisted declaration), and `a module with a keyed list and a chosen tag declares each import binding once`.

**`packages/compiler/tests/branch-subtree-hoisting.test.ts`:** the static assertions stay (one `<span`, two `${_c0}`), and it gains `cases that share a tag share one template`. The runtime case `switching the discriminant swaps the tag and keeps the subtree` asserts the opposite and is rewritten as `writing the discriminant keeps the element and its tag`: after `state.on = true` the same `div` node is in place, there is no `a`, and the span still tracks `label`.

**`packages/compiler/tests/compile-element-render.test.ts`,** new `describe("compiled element — a chosen tag is kept")`: after mount, writing `href` leaves the same element and tag; rows choose `a`/`div` from their items, writing one row's `href` keeps that row's node, and a row rendered anew after the list shrinks and regrows chooses from its new item.

**`packages/compiler/tests/site-build.test.ts`:** `a build-time repeater row chooses its tag from its own item` (literal `items`; `dist/index.html` has one `<a` row and one `<div` row and no `data-jx-tag`); `a build-time row whose tag also reads page state is judged again at hydration` (the row carries `data-jx-tag`, and the module's pick holds the row's item value as a literal); `a row whose discriminant reads an object from its item commits at build`.

Coverage: no new source file, so the manifest check is unaffected. Touched files are held per file to `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`) and `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`). Every new branch is exercised above. Raise a threshold to just below the new minimum if the worst file rises.

## Specs & docs

**TEC1.1**

- `specs/compiler.md` §4.8: in the hoisting paragraph, `(spec.md §8.6)` becomes `(spec.md §19.6)`, and after it add: "A chosen `tagName` is kept, not re-read. Its branches become one template per distinct candidate, passed with the discriminant (compiled by `compileExpression`) to `__jxTag`, a lit directive emitted from `tagChoiceDirectiveSource()` that picks on the element's first render and returns the same candidate for as long as lit keeps that part. A repeater row's root may carry one too, and a row callback whose body reads `$map` through a compiled expression binds `_item` and `_index`." §11 gains ``### `tagChoiceDirectiveSource()` — the kept-tag directive, inlined for a generated module`` with that sentence's substance. Fragment: `bun run spec:change compiler.md minor -m '§4.8: a chosen tagName compiles to one template per distinct candidate behind a lit directive that keeps its first choice, and a row callback binds the names compiled expressions read.'`
- `specs/spec.md` §19.6: the marker (as the lint plan leaves it) drops its element-target, static-target and inherited-keys sentences, leaving the client-target gap. Fragment: `bun run spec:change spec.md patch -m '§19.6: the marker names only the client-target gap; the element target keeps a chosen tag, and the static build resolves one as the interpreter does.'`

**TEC1.2**

- `specs/spec.md` §19.6, in place. The marker becomes:

  > **Status: Implemented.** All three positions ship in the interpreter and in every compiled target, and `jx validate` and Studio warn when a tag discriminant is also written (`findTagExpressionDefects` in `packages/schema/src/tag-expressions.ts`). One rule resolves a chosen tag: `resolveTagName` in `packages/runtime/src/runtime.ts`, the general `?:`/`switch` evaluation, which the static prerender calls and emitted code compiles with `compileExpression`. Lit output keeps the tag for the element's lifetime (`tagChoiceDirectiveSource()` in `packages/compiler/src/shared.ts`), and a dynamic page checks it once at hydration (`compile-client.ts`).

  ("and Studio" goes if the lint plan's Studio Open was declined.) After the **The warning.** paragraph the lint plan adds, add:

  > **When creation is, per tier.** The interpreter resolves the tag when it creates the element, and a mapped-array row it keeps keeps its tag (§10.4). A static build resolves it against the state the prerender reads, and a row the build expands against that row's own `$map` context. A dynamic page prerenders that choice and resolves the discriminant once more against the page's state when it hydrates. When that selects another candidate, an element of that tag takes the prerendered element's attributes and content before any binding attaches, and the choice is not revisited. In lit-rendered output (a component, a repeater row, a `$switch` case) the tag is resolved when the element is first rendered and kept for as long as the renderer keeps that element, so a row or case rendered anew chooses anew, as the interpreter's does. Every tier evaluates the discriminant as an operand (§19.2), nested nodes included, and `switch` matches its string form against the case object's own keys only.

- `specs/compiler.md`: new §9.3 "A Chosen Tag on a Dynamic Page", after §9.2, with `> **Status: Implemented.**`: "The prerender commits to the candidate `resolveStaticTagName` selects and emits that element with its bindings, plus `data-jx-tag="_tgN"`; `bind._tgN` is the discriminant compiled over `state`. Hydration judges the element before any of its bindings: when the pick names the prerendered tag it does nothing, and otherwise a new element of the picked tag takes the prerendered element's attributes and children, replaces it, and is bound in its place. The subtree under a chosen tag with a preformatted candidate is prerendered without separator whitespace, so it reads the same under either tag. A chosen tag whose candidates disagree about being void, on an element with content, is a build error, because the void candidate's markup cannot carry the content. Inside a lit-rendered region (a mapped array, mixed children, a `$switch` case), a chosen tag compiles as in the element target (§4.8)."
- **Fragments** (single quotes, so the shell leaves `$` alone): `bun run spec:change spec.md minor -m '§19.6: a tag chosen at creation compiles on a dynamic page, prerendered and chosen once more at hydration; compiled output keeps the tag for as long as the element lives; and a row the build expands resolves it against its own item.'` and `bun run spec:change compiler.md minor -m '§9.3: a dynamic page prerenders a chosen tag and, when the page state selects another at hydration, moves the element into one of that tag before binding it.'`
- **Docs** (no em dashes in either page):
  - `docs/framework/concepts/expressions.md` (`spec: spec.md#19`), "Choosing an element's tag", after the two rules: "This works wherever an element can appear. In a list, each row chooses its tag when the row is first drawn and keeps it while the row stays. On a page with live state, the built HTML already carries the tag the page's starting state selects. If the state the page loads with selects another (a saved preference, say), that element switches to the other tag once, keeping its content, before anything on it responds. One combination can't be built on such a page: a choice between a tag that can't hold content, like `img`, and one that can, on an element that has content."
  - `docs/framework/build.md` (its `code:` lists `compile-client.ts` and `shared.ts`): `spec:` gains `compiler.md#9.3 # a chosen tag on a dynamic page`, and in "Dynamic pages", after "There is no client-side re-render of the initial view; the JS only maintains what changes." add "The one exception is an element whose tag is chosen by a formula: the HTML carries the tag the build's state selects, and if the state the page loads with selects another, the module moves the element's attributes and content into one with that tag before binding it."
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

| Slice  | Scope                                                                                                                                                                                                                          | Claims       | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----- |
| TEC1.1 | The one rule (`resolveTagName` through `evaluateExpression`, `resolveStaticTagName`), the directive source, build-time rows, the element target (kept tag, row root, `_item`); compiler.md §4.8 and §11, the §19.6 marker trim | —            | open  |
| TEC1.2 | The client target (prerender and hydration retag, lit regions, row aliases), compiler.md §9.3, the §19.6 flip and the docs                                                                                                     | spec.md#19.6 | open  |
