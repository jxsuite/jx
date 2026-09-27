---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/compiler
size: M
---

# A component instance on a built page receives the props it binds, and receives them again when page state changes

## Context

An enabling plan. It claims nothing: `plan:spec/one-way-prop-forwarding` owns spec.md §13.3, whose new text ("a bound prop is re-delivered in every tier") is true only once this lands. It is split from that plan because the two have different dispositions. This half is code in `packages/compiler`, and that one is the spec rewrite.

The census read §13.3's compiled gap as the child's alone ("A compiled parent binds `.prop=`, but the compiled element defines no property accessors…"), which `plan:_shared/compiled-prop-bridge` builds. The parent half holds only inside a component definition (`compile-element.ts`) and in a client `$map` row (`emitLitMapTemplate` in `packages/compiler/src/targets/compile-client.ts`). An instance written on a page or a layout, the common case, gets no live binding and not even its initial value.

**Evidence.** A scratch site was built with `buildSite` on 2026-09-27. Its page has `state: { n: 1, k: 5, rows: [{ v: 7 }], inc: handler "state.n++" }`, a button bound to `inc`, a `my-count` instance with `$props: { count: { $ref: "#/state/n" }, tpl: "${state.n}" }`, and a `$map` of `my-count` over `rows`.

| Case                                                      | Emitted                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `my-count` fully static (templates only)                  | `<my-count data-jx-static><p>[object Object]\|undefined</p></my-count>`, and no module script                                                                                                                             |
| `my-count` with a handler                                 | `<my-count data-jx-prerendered data-bind :attr.data-jx-props="_t1">`, where `_t1` is a template literal over the whole payload `{"count":{"$ref":"#/state/n"},"tpl":"${state.n}"}`: the payload became a template binding |
| `$ref` to `k`, which nothing writes                       | `data-jx-props="{"count":{"$ref":"#/state/k"},"tpl":5}"`: the template baked, the `$ref` did not                                                                                                                          |
| Statically unrolled row, `count: { $ref: "$map/item/v" }` | `data-jx-props="{"count":{"$ref":"$map/item/v"},"tpl":7}"`                                                                                                                                                                |

The child upgrades with `state.count` set to the object `{ "$ref": … }`.

**Why**

- `resolveDocTemplates` (`packages/compiler/src/site/site-build.ts`, about line 1909) resolves a page's `$props` only when the value is a template string. `expandMapTemplate` (about line 1815) does the same for a row.
- `expandComponents` (about line 2035) passes `node.$props` unresolved to `preRenderComponentHtml` and `buildInstanceScope`. It then writes them verbatim into `data-jx-props` and deletes them.
- A nested instance is right: `renderComponentInstance` in `packages/compiler/src/shared.ts` runs every prop through `resolveStaticValue(value, scope)`.
- `buildClientNode` (`compile-client.ts`, line 319) has no `$props` branch. Only `emitLitMapTemplate` (line 664) binds props.
- The payload is emitted as an attribute string, and a runtime-only template inside it survives `resolveDocTemplates`. `buildClientNode`'s attribute pass (and `buildAttrs` in the static emitter) then reads the whole payload as a template.
- `staticTags` (the per-route loop in `buildSite`, about line 711) is decided per definition, so a static component bound to changing state ships no module.
- `mapRefToClientExpr` (`compile-client.ts`, line 1072) lowers only `$map/` and `#/state/`. The element target's `refToExpr` (`compile-element.ts`, line 1375) also lowers `parent#/`, `window#/` and `document#/`, mirroring the runtime.
- `compile-client.ts` keeps a handler entry only in its `on` table, so `state.<handler>` is `undefined`. A `$map` row's `.onAction="${state.handleAction}"` delivers nothing, where the interpreter and the element target deliver the function.

The interpreter needs nothing: `renderCustomElementWithProps` in `packages/runtime/src/runtime.ts` resolves and re-writes every bound prop.

**Outside this plan.** A page binding inside the slot content of a page-level instance is dead in built output. `expandComponents` serialises slot children with `renderStaticNode(c, {}, null)` before the page compile runs, so the same scratch site's `<my-box><span>${state.n}</span></my-box>` emitted `<span id="s"></span>` with no `data-bind`. A live prop on an instance inside that slot content is lost the same way: after this plan the payload leaves it out and the serialised slot content carries no directive for it. That is the slot path's gap (spec.md §8.5, `plan:spec/compiled-slot-distribution` rewrites that serialisation), not this plan's.

**Related, no edge**

- `plan:_shared/compiled-prop-bridge` gives a compiled child the accessors that turn a later property write into a re-render; this plan gives a page-level instance the writes. Neither needs the other to land: the bridge's browser check binds its child inside a component for exactly that reason, and this plan's tests read `el.count` rather than the child's text. `plan:spec/one-way-prop-forwarding` requires both.
- `plan:_shared/compiled-element-lifecycle` builds its `data-jx-props` merge from `node.$props`; once this plan lands the payload comes from `settled`.
- `plan:_shared/compiled-element-lifecycle` also edits `expandComponents` (an observed-attribute merge) and `isComponentFullyStatic`. `plan:spec/compiled-slot-distribution` threads a slot-id counter through `expandComponents`. `plan:spec/style-handle-assignment` touches its `resolvedStyle` merge. Whichever lands second merges.
- `plan:spec/function-entry-tier-parity` changes how `compile-client.ts` classifies `$src` entries. This plan delivers only body-declared handler entries (below).

## Outcome

No claim closes here. Once it lands:

- A page-level (and layout-level) instance in a built site is prerendered and upgraded with every prop the build can settle. A settled prop is a literal, a `$ref` or template over state nothing changes at run time, or a row's `$map/` value.
- Every prop that reads runtime-only state is written onto the element by the page module at hydration and on every change.
- Such an instance loads its module even when its component is static.
- compiler.md §8.1 and §9.1 state this. Both stay Implemented, and the edit is a `minor` fragment.

## Decisions

- **Decided:** a prop is **live** exactly when the build cannot settle it, by compiler.md §8.1's existing runtime-only rule. That means a template that `resolveDocTemplates` left unresolved, or a `$ref` whose head entry the scope builder marks runtime-only. A `window#/` or `document#/` pointer is live too, since it has no build-time value. Every other prop is **settled**: resolved at build time into the prerender and the payload, with no module cost. The rule already decides which templates bake. Settling constants keeps static components static: starter pages pass constant props (`"${state.entry.data.title}"`), and they keep shipping no script.
- **Decided:** the page module delivers a live prop through a new hydration directive, `:prop.<bindKey>="<name>"`, written as a property by an effect. The existing `:<kebab-name>` form cannot carry a name containing `-` or `.`, and `:render` is taken. HTML lowercases attribute names, so the case-sensitive prop name goes in the value and a counter key (`_pN`) in the name.
- **Decided:** on the non-site route (`compile()` route 3, no expansion), every `$props` entry of a hyphenated tag is delivered by the same directive, literals as constant thunks. There is no payload there, and one mechanism is simpler to hold than two. A non-hyphenated tag's `$props` keeps its current (ignored) handling; the interpreter merges those into scope instead, and that is not a component instance. The same branch serves a hyphenated tag the site build did not expand (an npm element, which `renderCustomElementWithProps` also feeds in the interpreter), so on a dynamic page its `$props` arrive too.
- **Decided:** the prerender and the `data-jx-props` payload carry settled props only. A live prop renders the definition's default until hydration. For a runtime-only entry the build scope holds either a placeholder (a bodyless `$src` function, nothing for a `Request`) or an initial value, and does not say which, which is why §8.1 declines to bake them. The page module runs before the component module (`injectComponentScripts` appends component scripts after it), so the first upgrade already sees the live value.
- **Decided:** an instance with a live prop is stamped `data-jx-prerendered` whatever its definition, and its tag's module ships on that route. Only the module can re-render it. Every other instance keeps the per-definition rule, so this is the one per-instance exception to "static-ness is decided per definition".
- **Decided:** `isDynamic` (`shared.ts`) counts a `$props` value that is a `$ref` or a template string. compiler.md §2.1 already lists both as dynamic ("`$ref` bindings on element properties", "`${}` template strings in any property value"), but the walk skips `$props` as a reserved key. After expansion only live props remain, so a site page takes the client route exactly when one of its instances needs the page module. Without it, a page with no state whose only live prop reads `window#/` or `document#/` takes the static route and ships no module to deliver it. A literal prop still leaves a page static.
- **Decided:** the payload writes `${` as `\u0024{`. It is still valid JSON that parses back to `${`, and neither emitter can read it as a template.
- **Decided:** a `$map/` pointer in a statically unrolled row resolves against its row in `expandMapTemplate`, like the row's templates. The row exists only at build time.
- **Decided:** `mapRefToClientExpr` gains `parent#/` (read from `state`, as a prop reaches the scope), `window#/` and `document#/`, copied from `refToExpr`. A page binding and a row binding then lower every scheme as the element target does.
- **Decided:** a `$ref` prop naming a body-declared handler entry delivers that entry as a function on `state`, so `state.<handler>` is defined wherever a `$props` value names it (today it is `undefined`). It is emitted only for handler entries some `$props` names, so no other page's output changes. Its call shape is the Open on function props in `plan:spec/one-way-prop-forwarding`: under that plan's recommendation it is the element target's unbound `(state, event)` shape, which the interpreter matches; if the Open resolves to "bound", it becomes a wrapper over the `on` entry and the other two tiers change in that plan. Review resolves that Open before this plan moves to `ready`, so the two land one contract.
- **Decided:** a `#`-prefixed key is not bound (spec.md §5.6), as `refusePrivateProp` refuses it in the interpreter.

## Implementation

1. **`packages/compiler/src/shared.ts`**
   - Extract the per-key test in `readsRuntimeOnlyState` into `isRuntimeOnlyKey(scope, key)`: the `RUNTIME_ONLY_KEYS` set, then the guarded read that treats a function as runtime-only. `readsRuntimeOnlyState` calls it, with no behaviour change.
   - Add `export function refReadsRuntimeOnlyState(ref: string, scope: Record<string, unknown> | null): boolean`:
     - `window#/` and `document#/` return true.
     - `$map/` returns false.
     - `#/state/`, `parent#/` and a bare path test their first segment (`refSegments` from `@jxsuite/runtime/pointer`) with `isRuntimeOnlyKey`.
     - Anything else returns false.
     - Its JSDoc cites compiler.md §8.1.
   - `isDynamic`: return true when `def.$props` is an object with a non-`#` key whose value is a `$ref` object (`isRefObject`) or a template string (`isTemplateString`).
2. **`packages/compiler/src/site/site-build.ts`**
   - `expandMapTemplate`, `$props` branch: a `$ref` object whose pointer starts with `$map/` becomes `cloneValue(resolveRefValue(pv.$ref, scope))`, or `null` when that is `undefined`, beside the existing template case.
   - `expandComponents` gains a `scope: Record<string, unknown>` parameter and a `liveTags: Set<string>` parameter, threaded through its recursion. After `liftPropsAttributes`, it partitions `node.$props`:
     - `live`: a template string (`isTemplateString`), or a `$ref` for which `refReadsRuntimeOnlyState` is true.
     - `settled`: every other entry. A `$ref` becomes `cloneValue(resolveStaticValue(v, scope))`, dropped when `undefined`. A literal is kept as written.
     - `#` keys are dropped from both.
   - `settled` replaces `props` everywhere `expandComponents` uses it: the context's first path frame, `preRenderComponentHtml`, `buildInstanceScope` for `resolveHostStyle`, and the payload. The payload becomes `JSON.stringify(settled).replaceAll("${", "\\u0024{")`, written only when `settled` is non-empty and the instance is stamped `$prerendered` (below). That includes an instance of a fully static definition that has a live prop: its module re-renders it on upgrade, so its settled props must survive as data.
   - When `live` is non-empty: set `node.$props = live`, stamp `$prerendered` (never `$static`), and `liveTags.add(tag)`. Otherwise delete `$props` as today.
   - `compilePage` passes its `scope` (the `buildInitialScope` result above `resolveDocTemplates`) and a new `liveTags` set to `expandComponents`, and returns `liveInstanceTags: [...liveTags]` beside `unregisteredRelations`.
   - `buildSite`'s per-route loop adds a tag to `staticTags` only when `isComponentFullyStatic(def)` and it is not in `result.liveInstanceTags`.
3. **`packages/compiler/src/targets/compile-client.ts`**
   - Add `p: 0` to `compileClient`'s `counter` and the `p: number` field to the two counter parameter types (`buildClientNode`'s and `emitClientModule`'s) and their JSDoc.
   - `mapRefToClientExpr`: add `parent#/` → `refAccessor("state", …)`, `window#/` → `refAccessor("window", …)` and `document#/` → `refAccessor("document", …)`, ahead of the bare-path fallback. The comment names `refToExpr` in `compile-element.ts` as the twin.
   - `buildClientNode`: when the tag contains `-` and `def.$props` is a non-empty object, take each non-`#` entry in order, with `key = _p${counter.p++}`:
     - `$ref`: the binding returns `mapRefToClientExpr(ref)`, so `#/state/n` binds `() => state.n`.
     - template string: the binding returns the template as a template literal, a string, as `renderCustomElementWithProps` delivers one (the same form the `_tN` text bindings use).
     - anything else: the binding returns the value's JSON, so `3` binds `() => (3)`.
     - then push `:prop.${key}="${escapeHtml(name)}"` and set `needsBind`.
   - The hydrate emitted by `emitClientModule`: ahead of the generic property branch, add `else if (parts[0] === 'prop' && parts.length > 1) { const name = key; const k = parts[1]; effect(() => { el[name] = bind[k](); }); }`.
   - Function delivery: a new `collectPropRefKeys(raw)` walks the document (`children`, a mapped array's `map`, `$switch` `cases`). It returns the head key of every `#/state/`, `parent#/` or bare `$ref` found in a `$props` value. After the inline handlers are merged, each `onEntries` entry whose key is in that set adds an init block of the element target's shape: `state["<key>"] = (state, e) => { const fn = (<args>) => { <body> }; return fn(<callArgs>); };`. That makes `state.<key>` a function for the page binding and for a `$map` row's `.onAction=` alike.
4. Spec and docs edits under Specs & docs.

**Integration contract.** Once this lands, other plans may rely on the following:

- `shared.ts` exports `refReadsRuntimeOnlyState`.
- `expandComponents` leaves on a page-level instance's `$props` only the entries the page module must deliver, and stamps that instance `$prerendered`. `compilePage` reports those tags as `liveInstanceTags`.
- The page module writes each such entry onto the element as a property when it hydrates and again on every change of what it reads.
- `data-jx-props` holds only settled, JSON-safe values with `${` escaped.
- `mapRefToClientExpr` lowers `#/state/`, `$map/`, `parent#/`, `window#/`, `document#/` and bare paths.
- A `$ref` prop naming a handler entry is a `(state, event)` function in every target.

`plan:spec/one-way-prop-forwarding` relies on the post-connection writes: with `plan:_shared/compiled-prop-bridge`'s accessors they re-render the child, and its tests extend `client-page-props.test.ts` below.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`. No new source file, so the manifest check sees nothing new. Every touched file stays at or above `coverageThreshold = { lines = 0.982, functions = 0.98 }` in `packages/compiler/bunfig.toml`. Raise it to just below the new minimum if the worst file rises. The fixtures contain no image, so sharp is never imported (as in `site-build-component-loading.test.ts`).

`packages/compiler/tests/shared.test.ts`, `describe("refReadsRuntimeOnlyState")`:

- "a written entry is runtime-only and a constant is not": a scope from `buildInitialScope` over `{ n: 1, k: 5, inc: { $prototype: "Function", body: "state.n++" } }` gives true for `#/state/n` and `n`, and false for `#/state/k`.
- "a nested pointer is judged by its head": `#/state/n/x` is true.
- "window and document pointers are runtime-only, a row pointer is not": `window#/innerWidth` and `document#/title` are true; `$map/item/v` is false.
- "readsRuntimeOnlyState is unchanged": a template reading `state.n` is still marked and one reading `state.k` is not.

`packages/compiler/tests/compiler.test.ts`, beside the existing `isDynamic` cases:

- "a $ref or template in $props makes a node dynamic, a literal does not": `isDynamic` is true for `{ tagName: "my-card", $props: { w: { $ref: "window#/innerWidth" } } }` and for `$props: { label: "${state.n}" }`, and false for `$props: { size: 3 }` and for `$props: { "#x": { $ref: "#/state/n" } }`.

`packages/compiler/tests/compile-client.test.ts`, `describe("compileClient — a page-level instance's $props (spec.md §13.3)")`:

- "a $ref prop becomes a property directive": `<my-card>` with `count: { $ref: "#/state/n" }`emits`data-bind`and`:prop._p0="count"`, and the module has `_p0: () => state.n`.
- "a template prop binds its string, a literal a constant": `label: "${state.n} items"` and `size: 3` emit a template thunk and `() => (3)`.
- "the prop name keeps its case and its punctuation": `ariaNote` and `data-x` appear verbatim as directive values.
- "a private prop is not bound": `"#cache"` emits no directive.
- "a non-hyphenated tag's $props emits no directive".
- "hydrate writes a prop directive as a property": the module contains the `parts[0] === 'prop'` branch.
- "every ref scheme lowers in a prop and in a row": `parent#/a`, `window#/x/y` and `document#/title` lower to `state.a`, `window.x.y` and `document.title`. The existing "lowers every $ref form to a real expression" gains the same three rows for the `$map` path.
- "a handler named by a prop is on state as a (state, event) function": `pick` (body `"state.n++"`) with `onPick: { $ref: "#/state/pick" }` emits `state["pick"] = (state, e) =>`. The same document without the prop does not.

`packages/compiler/tests/site-build-instance-props.test.ts` (new, the `writeJSON` and `TMP` pattern of `site-build-component-loading.test.ts`). The fixture is the Context's site: `my-count` is fully static; `my-live` has a handler.

- "a $ref to a constant is settled into the prerender and the payload": `fixed: { $ref: "#/state/k" }`puts`"fixed":5`in`data-jx-props`, and the prerendered text shows `5`.
- "a row's $map ref is settled against its row": the unrolled row's payload has `"count":7`.
- "no payload carries an unresolved $ref": no `data-jx-props` value in `dist/index.html` decodes to an object with a `$ref` key.
- "a prop bound to written state is delivered by the page module": the page-level `my-count` carries `:prop._p0="count"`, and `app.js` has `() => state.n`.
- "an instance with a live prop loads its module though its component is static": `<my-count data-jx-prerendered` and `/components/my-count.js` are both in the HTML.
- "a static component with constant props still ships no module": a second route whose `my-count` passes only `fixed` keeps `data-jx-static` and has no `my-count.js` script.
- "a stateless page whose only live prop reads window still gets a page module": a third route with no `state` and `my-count` bound to `count: { $ref: "window#/innerWidth" }` carries `:prop._p0="count"`, and its HTML loads a page module with `() => window.innerWidth`.
- "a payload is never read as a template": `note: { $ref: "#/state/doc/text" }` over `doc: { default: { text: "use ${x}" } }` emits no `:attr.data-jx-props`, and the decoded payload parses to `"use ${x}"`.

`packages/compiler/tests/client-page-props.test.ts` (new). It executes `compileClient` output in happy-dom, installing globals before any import as `compile-element-render.test.ts` does, with the module written under a `TMP` directory beside it so `@vue/reactivity` resolves. The page is a button bound to `inc` plus `<my-count>` with `count: { $ref: "#/state/n" }`, and no child module is loaded.

- "the page module sets the prop before the element upgrades": after import, `el.count === 1`.
- "and sets it again when the state changes": after `button.click()`, `el.count === 2`.

## Specs & docs

**`specs/compiler.md` §8.1**, the "A component instance is expanded wherever it is written" paragraph (line 642), in place:

- "A `$props` value that is a template resolves against the parent's scope;" becomes: "A `$props` value that is a template or a `$ref` resolves against the parent's scope (a `$map/` pointer in an expanded row, against its row), unless it reads runtime-only state as defined above. Such a prop is kept out of the prerender and the payload, which render the definition's default for it, and the page's module delivers it (§9.1);"
- "a stamp — `data-jx-static` when the definition is fully static, `data-jx-prerendered` with a `data-jx-props` payload (§4.4) when it is not" gains after it: "The payload carries the settled props only, with `${` written as `\u0024{` so that no emitter reads it as a template."
- The closing sentence gains: "One exception is per instance: a page-level instance with a prop the page's module delivers is stamped `data-jx-prerendered` and its module ships, whatever its definition, since only the module can re-render it."

**`specs/compiler.md` §2.1**: after the list, add "A component instance's `$props` values are property values: a `$ref` or a template among them makes the node dynamic, a literal does not." The marker stays `Implemented`.

**`specs/compiler.md` §9.1**: add a fourth bullet, "Property bindings for a component instance's `$props`", and after the list the paragraph: "Each prop the site build could not settle (§8.1), or every prop when no site build expanded the page, is written onto the element as a property, when the module hydrates and again on every change, through a `:prop.<key>` directive whose value is the property name. A `$ref` lowers as in the element target (`#/state/`, `parent#/`, `window#/`, `document#/`), a template to its string, and a `$ref` naming a handler entry to that entry as a `(state, event)` function. A private key is never bound (spec.md §5.6)." The marker stays `Implemented`.

**Fragment:** `bun run spec:change compiler.md minor -m "A component instance on a built page resolves its bound props at build time, and a prop that reads changing state is written onto the element by the page module on every change"`

**`docs/framework/build.md`** (its `code:` lists `site-build.ts`, `compile-client.ts` and `shared.ts`, and its `spec:` cites `compiler.md#8.1` and `#9.1`), "Components inside components". No em dashes.

- "**Props flow down at build time.** A `$props` value written as a template (`"icon": "${state.icon}"`) resolves against the parent component's state" becomes "…written as a template (`"icon": "${state.icon}"`) or a `$ref` resolves against the parent's state".
- New third bullet: "**A prop bound to changing state stays bound.** A `$props` value reading an entry a handler writes is not baked. The page's script writes it onto the component whenever the entry changes, so that instance loads its component's script even when the component is otherwise static. A prop reading a constant bakes, as a template does."
- "Why is my page shipping JavaScript?", the "Interactive components" bullet gains: "So does a component whose prop is bound to changing state, on the page that binds it."

`docs/framework/concepts/functions.md` and `docs/framework/concepts/elements.md` list `compile-client.ts` or `shared.ts` in `code:` but describe neither prop delivery nor runtime-only marks, so they do not change. `props-and-scope.md` is `plan:spec/one-way-prop-forwarding`'s. No spec.md edit and no marker change: this plan claims nothing.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at its thresholds. `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
- Building the Context's scratch site, `grep -c '&quot;\$ref&quot;' dist/index.html` is `0`. The page-level `<my-count>` carries `data-jx-prerendered` and a `:prop.` directive, and `/components/my-count.js` is loaded.
- Observable, in a browser, on that build: `document.querySelector("my-count").count` reads the page's `n`, and reads the new value after the button is clicked. (The child's rendered text follows once `plan:_shared/compiled-prop-bridge` has landed.)
