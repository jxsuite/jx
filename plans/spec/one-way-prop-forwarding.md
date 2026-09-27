---
status: drafted
disposition: reconcile
claims:
  - spec.md#13.3
requires:
  - _shared/compiled-prop-bridge
  - spec/one-way-prop-forwarding-page-bindings
workspaces:
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: S
---

# Signal forwarding is specified as it ships: a bound prop flows parent to child in every tier, and a child answers with an event

## Context

`specs/spec.md` §13.3, line 1545:

> **Status: Partial.** Forwarding is one way, parent to child, and fully so only in the interpreter, which writes the resolved value onto the child as a property and re-writes it from an effect when the parent changes (`renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`). A compiled parent binds `.prop=`, but the compiled element defines no property accessors and reads a property once, in `connectedCallback` (§16.2), so it takes the parent's value at connection and loses every later change. In both tiers a child's write to a primitive prop updates only the child, and only a shared object or array proxy is seen by both scopes.

The body (line 1547) promises the opposite: "the child receives the same reactive reference — writes in either scope trigger effects in both." The audit record's spec-wide decisions list one-way forwarding as a `reconcile`. Re-verified against the working tree on 2026-09-27.

**What holds**

- Interpreter, parent to child: `renderCustomElementWithProps` writes each `$ref` or template prop onto the element and re-writes it from an effect; after connection the instance accessor (`defineElement`, the loop after `extendInstancePath`) forwards the write into the child's state. Pinned by `packages/runtime/tests/runtime-gaps-elements.test.ts` ("$ref, template, and literal props; reactive forwarding; children; onNodeCreated").
- One way, by construction. Nothing in either tier writes a child's state back to its parent. The effect re-runs only when the parent's source changes, so a child's local write survives until then. No test pins this.
- Shared objects, by construction. Both tiers use one `@vue/reactivity` instance (the site build externalises it, `CLIENT_EXTERNALS` in `packages/compiler/src/site/bundler.ts`). Assigning a parent's reactive array into the child's state stores the raw target, and reading it back returns the same proxy, so a mutation of its contents triggers effects in both scopes. Assigning a new array in the child does not reach the parent. No test pins this either.
- Events reach the parent in its own scope. The interpreter binds an instance's `on*` keys through `applyProperties` inside `renderCustomElementWithProps`, with the parent's state. `compile-client.ts` (`buildClientNode`'s handler loop) and `compile-element.ts` (`@${eventName}=`) bind them on the instance node as on any element. A child dispatches from its host with a root-level handler (§16.1, interpreter) or from the component instance (compiled element, §20.2).

**Corrections to the census reading**

1. **"A compiled parent binds `.prop=`" holds only inside a component definition and in a client `$map` row.** An instance written on a page or a layout gets nothing live in a built site. `expandComponents` (`packages/compiler/src/site/site-build.ts`) serialises its `$props` raw into `data-jx-props`, `$ref`s included, and `buildClientNode` has no `$props` branch. A scratch build of a page with `n` (written by a button's handler) and `<my-count $props: { count: { $ref: "#/state/n" } }>` emitted `<my-count data-jx-static><p>[object Object]|undefined</p></my-count>` and no module. So §13.3 needs `plan:spec/one-way-prop-forwarding-page-bindings` as well as the bridge. That enabling plan also owns the other defects found in that path.
2. **A function prop is not an upward channel in any tier.** The stub proposed that "a child that needs to change parent state calls a function prop (`onAction` in §13.2's example)". It cannot:
   - `bindHandler` (`runtime.ts`) calls a `$ref` handler as `handlerFn(scope, e)` with the scope of the element it is bound on, which in a child is the child's.
   - `resolveFunction` stores a handler entry unbound.
   - The element target emits `this.state[key] = (state, e) => …`, the same shape.
   - `compile-client.ts` keeps handler entries in its `on` table only, so `state.<handler>` is `undefined` and a `$map` row's `.onAction="${state.handleAction}"` delivers nothing. The enabling plan makes it deliver the element target's shape.
   - The contract is Open below.
3. **`docs/framework/concepts/props-and-scope.md` is wrong in five places:**
   - "Signal forwarding" (two-way).
   - "How it works" ("live references into the parent's reactive state").
   - Rules ("live in both directions").
   - "Resolution order", which lists `$props` after `state` and `window`/`document` as fallbacks, where §15.4 merges props into the component scope and excludes globals.
   - "Static and bound props", which says a function prop lets "a child trigger behavior the parent owns".

**Related**

- `plan:_shared/compiled-prop-bridge` (required) rewrites this section's marker to a narrower Partial when it lands. This plan replaces that marker. Its integration contract says this plan "may state that a `$ref` prop re-delivers the parent's value in both tiers". That holds only once the enabling plan has landed too (correction 1).
- `plan:_shared/compiled-prop-bridge` and `plan:spec/elements-registration-example` also edit `props-and-scope.md`: a new "Setting props from script" section and the "Component instances" section. The hunks here are "Static and bound props", "Signal forwarding", "Resolution order", "How it works" and "Rules", so whichever lands second rebases adjacent hunks at most.

## Outcome

- spec.md §13.3 → Implemented. The Partial marker becomes a leading `Implemented` marker, and the body states the one-way contract, the shared-object consequence, events as the upward channel and what a function prop is.
- `props-and-scope.md` teaches the same contract, and its resolution order matches §15.4.
- spec.md stays Partial overall and does not graduate.

## Decisions

- **Decided:** reconcile to one-way flow. The audit record's spec-wide decisions name this reconcile, and §2.4 ("explicit over implicit") and §15.3 ("signals do not cross component boundaries implicitly") already imply it. No tier has a write-back channel, and adding one would make every primitive prop a two-writer value with no rule for which write wins.
- **Decided:** `requires` both `plan:_shared/compiled-prop-bridge` and `plan:spec/one-way-prop-forwarding-page-bindings`, because the new text says a bound prop is re-delivered in every tier:
  - without the bridge a compiled child ignores every write after connection.
  - without the enabling plan an instance on a built page receives an unresolved `$ref`.
- **Decided:** state the object and array case as a consequence of passing a reference, including the detachment: a child that assigns a new object keeps it until the parent assigns one. That is what both tiers do, and a spec that names only mutation would read as a promise that reassignment is shared too.
- **Decided:** name template props beside `$ref` props. Both tiers re-deliver them by the same mechanism (the interpreter's template effect, a template binding in compiled output).
- **Decided:** fix the docs page's "Resolution order" list in the same edit. The "How it works" paragraph being rewritten states the §15.4 merge that the list contradicts, and leaving the list would keep the page disagreeing with itself.
- **Decided:** fragment level `minor`, the program's level for a `reconcile`, not `major`. No tier ever wrote a child's primitive back to its parent, so no working document relies on the removed promise.
- **Open:** is a function passed through `$props` bound to the scope that declared it? Recommendation: no. It stays a value, called with the scope of whoever calls it, and §13.3 names events as the one upward channel.
  - This is what the interpreter and the element target do today, and what the enabling plan gives the page target.
  - Binding it would let a child write its parent's state through a function, the implicit cross-boundary write §15.3 rules out.
  - An event keeps the parent's code in the parent's document, is declared in `emits` (§16.8, the manifest a non-Jx host reads), and already works in every tier.
  - The cost: §13.2's `onAction` example is a behaviour hook the child runs against its own state, not a callback into the parent. The new §13.3 text says so.
  - The alternative: wrap a function prop at delivery as `(_, ...rest) => fn(parentScope, ...rest)` in `renderCustomElementWithProps`, in the element target's `.prop=` binding and in the enabling plan's page binding. That is new work in three emitters and would make this plan an `implement`.

## Implementation

A paper plan with tests that pin what the new text states. One pull request, after both prerequisites have landed:

1. `specs/spec.md` §13.3, in place, as quoted under Specs & docs. No heading moves.
2. `docs/framework/concepts/props-and-scope.md`, as described under Specs & docs.
3. The tests under Tests.
4. `bun run spec:change spec.md minor -m "…"` with the sentence under Specs & docs.
5. Delete this file. No plan requires it.

**Integration contract.** No plan requires this one. Once it lands, spec.md §13.3 is the normative statement that:

- a bound prop flows parent to child in every tier and is re-delivered on change;
- a child's write stays in the child;
- an object or array prop is one shared object;
- a child reaches its parent by an event handled on the instance in the parent's scope;
- a function prop is called with its caller's scope (unless the Open resolves otherwise).

Later specs and plans cite §13.3 for these rules rather than restating them.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`. No source file changes, so no per-file figure moves and the manifest check sees nothing new. The thresholds stay: runtime `lines = 0.963, functions = 0.98`, compiler `lines = 0.982, functions = 0.98`.

**`packages/runtime/tests/prop-forwarding.test.ts`** (new). It registers happy-dom and renders instances with `renderNode` against a `reactive` parent state, as `runtime-gaps-elements.test.ts` does. Each case names the §13.3 sentence it pins.

- "a child's write to a primitive prop stays in the child until the parent's value changes": child state `{ count: 0 }` rendering `${state.count}`, parent `{ n: 1 }`, instance `count: { $ref: "#/state/n" }`. `el.count = 5` renders `5` and leaves `parent.n === 1`. `parent.n = 2` then renders `2`.
- "an object prop is one object in both scopes": child state `{ items: [] }` rendering `${state.items.length}`, with an inner button whose handler runs `state.items.push(2)`; parent `{ items: [1] }`. The click makes a parent `effect` reading `parent.items.length` re-run and see `2`. `parent.items.push(3)` re-renders the child as `3`.
- "assigning a new object in the child leaves the parent's in place": the same fixture with a handler running `state.items = []`. `parent.items` keeps its length.
- "a function prop runs against the scope of the element that calls it": child state `{ n: 0, onBump: null }` with an inner button `onclick: { $ref: "#/state/onBump" }`; parent `{ n: 1, bump: (state) => { state.n++; } }`; instance `onBump: { $ref: "#/state/bump" }`. A click leaves `parent.n === 1` and renders the child's `n` as `1`. This pins the Open; invert it if the Open goes the other way.
- "an event dispatched at the host runs the parent's instance handler in the parent's scope": child state `{ count: 0 }` and a root-level `onclick` with body `[{ dispatchEvent: "picked", detail: { $ref: "#/state/count" } }]`. The instance carries `onpicked: { $prototype: "Function", body: [{ operator: "=", target: { $ref: "#/state/n" }, value: { $ref: "event#/detail" } }] }`. Setting `el.count = 7` and calling `el.click()` sets `parent.n === 7`.

**`packages/compiler/tests/client-page-props.test.ts`**, the harness `plan:spec/one-way-prop-forwarding-page-bindings` creates. It is extended with the child's compiled module (`compileElement`) written beside the page module, imported in document order (page module first, as `injectComponentScripts` places them):

- "a page-level instance re-renders when the page state it binds changes": a click on the page's button renders the child's new `count`.
- "a write to the instance's prop stays in the instance": `el.count = 9` renders `9` in the child and leaves the button's `${state.n}` text alone. The next click renders the page's value in the child.
- "an event dispatched at a page-level instance runs the page's handler": `el.dispatchEvent(new CustomEvent("picked", { detail: 4 }))` sets the button's text to `4`.

**`packages/compiler/tests/compile-element-render.test.ts`**, in the bridge's "the property bridge" block, over its `ls-bridge-host` fixture:

- "a compiled child's write to a bound prop stays in the child": `child.count = 9` re-renders the child and leaves `host.state.n` at `1`.

The gates, all in the `checks` job: `bun run docs:status` (§13.3's first marker is `Implemented`), `bun run plans:check` (no `claim-not-open`, since this file is deleted with the marker), `bun run docs:spec-release` (the fragment covers the body), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown`.

## Specs & docs

**`specs/spec.md` §13.3**, in place:

1. Replace the marker (the census's line 1545, or the narrower Partial the bridge leaves) with:

   > **Status: Implemented.** The interpreter writes each bound prop onto the child as a property and re-writes it from an effect (`renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`). Compiled output binds it as a property: through lit inside a component or a mapped row (`compile-element.ts`, `compile-client.ts`), and through the page module's hydration for an instance written on a page (`compile-client.ts`, fed by `expandComponents` in `packages/compiler/src/site/site-build.ts`). In both tiers the child's accessor (§16.2) carries each write into its scope, and nothing is written back. Verified in `packages/runtime/tests/prop-forwarding.test.ts` and `packages/compiler/tests/client-page-props.test.ts`.

2. Replace the body sentence (line 1547) with three paragraphs:

   "Props flow one way, parent to child. When a `$props` value is a `$ref` or a template (§6), the child receives the value it resolves to, and receives it again whenever that value changes. The parent writes it onto the child as a property, and the child's accessor (§16.2) carries it into the child's scope. A prop named after a property every element already has (`title`, `role`, `hidden`) is the exception §16.2 states: after connection a change reaches the child only when the child observes it (§16.5)."

   "Nothing flows back. A child that writes a prop changes its own value and leaves the parent's state untouched, and the parent's next change replaces what the child wrote. An object or array prop is shared by reference, not forwarded. Both scopes hold the same reactive object, so a mutation of its contents (`state.items.push(x)`, `state.filter.q = "a"`) triggers effects in both, while assigning a new object to the prop in the child replaces only the child's value."

   "A child changes its parent's state by dispatching an event (§20.2) that reaches its host: one dispatched at the host, or one dispatched inside the child with `bubbles: true` (and `composed: true` to leave a shadow root, §16.6). The parent handles it with an `on*` handler written on the instance, which runs in the parent's scope. The dispatching function declares the event in its `emits` (§16.8) for editors and the manifest. A function passed through `$props` (§13.2's `onAction`) is a value like any other: an `on*` binding in the child calls it with the child's scope as `state`, so it cannot write the parent's."

   Adjust the third paragraph's last sentence if the Open resolves the other way. Adjust the first paragraph's reflected-name sentence if the bridge's Open on reflected names does. The third paragraph does not name a root-level handler (§16.1) as the way to dispatch at the host: the compiled element binds none until `plan:spec/compiled-host-handlers` lands, and §20.2 already says where a dispatch starts in each tier (a compiled `state` handler dispatches from the instance), so the sentence holds without that edge.

**Fragment:** `bun run spec:change spec.md minor -m "Signal forwarding is one way in every tier: a bound prop is re-delivered from parent to child, a child's write stays in the child except through a shared object, and a child reaches its parent by dispatching an event"`

**`docs/framework/concepts/props-and-scope.md`** (its `spec:` cites `spec.md#13`). No em dashes.

- Frontmatter:
  - `description` becomes "How state crosses component boundaries in Jx: explicit $props, one-way forwarding, events back to the parent, scope isolation, and the resolution order."
  - `spec:` gains `spec.md#20.2`.
  - `code:` gains `packages/compiler/src/targets/compile-client.ts`, the page target this plan's prerequisite changes.
- "Static and bound props":
  - "Functions pass the same way, so a child can trigger behavior the parent owns:" becomes "Functions pass the same way, as values:".
  - After the example, add: "A function prop runs with the scope of whoever calls it, so a handler the child binds to one works on the child's state. To change the parent's state, dispatch an event, as the next section shows."
- "Signal forwarding": replace its paragraph with four.
  1. A `$ref` prop is live from parent to child. When the parent's value changes, the child receives the new value and re-renders, in Studio and in a built site alike, and a template prop behaves the same way.
  2. Nothing flows back. A child's write to a prop changes only the child's copy, and the parent's next change replaces it. Objects and arrays are shared by reference, so pushing to an array prop or setting a field of an object prop is seen by both, while assigning a whole new array in the child is not.
  3. To change the parent's state, the child dispatches an event and the parent handles it on the instance. Give a JSON example: the instance above with `"onpicked": { "$prototype": "Function", "body": [{ "operator": "=", "target": { "$ref": "#/state/count" }, "value": { "$ref": "event#/detail" } }] }`, and one sentence saying the child's handler dispatches it with `{ "dispatchEvent": "picked", "detail": { "$ref": "#/state/count" }, "bubbles": true }`, linking [Statements](/docs/framework/concepts/statements). The parent's handler runs in the parent's scope.
  4. Keep the closing sentence about plain values.
- "Resolution order": the five-item list becomes two items, `$map/` context, then the component's own scope (its `state` entries and its `$props`, merged into one scope, a prop overwriting the same-named entry). Add a sentence saying `window` and `document` are not part of the lookup and are reached with the `window#/` and `document#/` schemes.
- "How it works": "plain values as initial settings, `$ref` values as live references into the parent's reactive state" becomes "plain values as initial settings, `$ref` and template values delivered again whenever the parent's value changes".
- "Rules":
  - "A `$ref` prop is live in both directions; a plain value is per-instance and static." becomes "A `$ref` prop is live from parent to child only. A child's write stays in the child, except inside a shared object or array. A plain value is per-instance and static."
  - Add a rule: "A child reaches its parent with an event, handled on the instance in the parent's scope."

`docs/framework/concepts/components.md` shows a `$props` example with no forwarding claim and does not change. `docs/framework/build.md` is the enabling plan's. No other page cites `spec.md#13` or `#13.3` (`grep -rn "spec.md#13" docs/`).

spec.md does not graduate: it keeps other open items.

## Acceptance

- `cd packages/runtime && bun test --isolate --coverage` and `cd packages/compiler && bun test --isolate --coverage` pass at their thresholds.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `bun run plans:status --spec spec` no longer lists §13.3.
- `grep -n "writes in either scope" specs/spec.md` and `grep -n "both directions" docs/framework/concepts/props-and-scope.md` find nothing.
- Observable, in a browser: `jx build` the scratch site from Context (a page with `n`, a button that increments it, and `<my-count>` bound to `count: { "$ref": "#/state/n" }`).
  - Clicking the button updates the child.
  - `document.querySelector("my-count").count = 9` in the console changes the child and not the button.
  - `document.querySelector("my-count").dispatchEvent(new CustomEvent("picked", { detail: 4 }))` sets the button to `4` once the page declares `onpicked` on the instance.
