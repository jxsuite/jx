---
status: drafted
disposition: implement
claims:
  - compiler.md#4.4
  - spec.md#13.2
  - spec.md#16.2
requires: []
workspaces:
  - packages/runtime
  - packages/compiler
size: M
---

# A compiled element takes every prop its instance supplies, before and after connection, as the interpreter does

## Context

All three items are open for one mechanism, the compiled element's property bridge, so one plan claims them. The census stubbed `compiler.md` §4.4 and `spec.md` §13.2 and §16.2 separately, and the cross-spec review merged them.

`specs/compiler.md` §4.4, line 200 (unmarked before the census):

> **Status: Partial.** The third source is narrower than the snippet: the emitted merge takes a property only when `this.hasOwnProperty(key)` (`packages/compiler/src/targets/compile-element.ts`), not `key in this`, so a value set before connection through a reflected `HTMLElement` property (`title`, `lang`, `hidden` and the rest), which creates no own property, is dropped and the component renders its default, where the interpreter takes it (`instanceSupplies` in `packages/runtime/src/runtime.ts`, `spec.md` §13.2).

`specs/spec.md` §13.2, line 1526:

> **Status: Partial.** The interpreter implements the rule below (`instanceSupplies` in `packages/runtime/src/runtime.ts`). The compiled element does not: the `connectedCallback` that `compile-element.ts` emits merges a property only when `this.hasOwnProperty(key)`, so a compiled parent's `.title=` binding, which goes through the reflected accessor and creates no own property, is dropped and the component renders its default.

`specs/spec.md` §16.2, line 1653:

> **Status: Partial.** The interpreter defines a property accessor forwarding into state for every non-private state key that is not already an `HTMLElement` property (`packages/runtime/src/runtime.ts`). The compiled element module (`compile-element.ts`) defines none: it reads a property only in `connectedCallback`, so `el.key = v` after connection, including the `.key=` binding a compiled parent re-commits when its own state changes, writes an inert own property and the element never re-renders.

§4.4's snippet (`key in this && this[key] !== undefined`) is wrong as well as unbuilt: `title in this` is always true on an `HTMLElement`, so it would overwrite every reflected state key with the empty native value. The emitter narrowed it to own properties, which drops the reflected case instead. Restating the snippet is part of closing §4.4.

**What exists** (re-verified by emitting `{ "tagName": "my-card", "state": { "count": 0, "title": "Default", "label": { "type": "string" }, "state": 1, "#cache": {} } }` through `emitElementModule`)

- The emitted `connectedCallback` (`emitElementModule` in `packages/compiler/src/targets/compile-element.ts`, about line 696): the `data-jx-props` payload (`if (k in this.state)`), the `props.*` loop (`if (_k in this.state)`), then `for (const key of Object.keys(this.state))` with `this.hasOwnProperty(key) && this[key] !== undefined`. All three skip a `#` key (`spec.md` §5.6). The class has no getter, setter or `defineProperty`; `connectedCallback` runs in full on every connection.
- `instanceSupplies(el, key)` in `packages/runtime/src/runtime.ts` (not exported): an own property, else an attribute of that name, else its kebab ARIA spelling. The interpreter's element class (`defineElement`) merges `key in this && this[key] !== undefined && instanceSupplies(this, key)` for every key of `def.state`, once (it returns early on `_jxInitialized`), then installs `Object.defineProperty(this, key, { configurable, get, set })` on the instance for each non-private key not `in HTMLElement.prototype`. Tests: `packages/runtime/tests/custom-elements.test.ts` ("a reflected property name does not clobber the declared default").
- Compiled parents pass `$props` as lit `.key=` bindings: `compile-element.ts` (instance and `$map` row paths) and `emitLitMapTemplate` in `compile-client.ts`. Mapped rows are emitted as an unkeyed `.map()`, so lit reuses a row element by index and re-commits its `.key=` bindings when the list changes. An instance written on a page or layout gets no binding at all: `expandComponents` in `packages/compiler/src/site/site-build.ts` writes its `$props` into `data-jx-props` with every `$ref` unresolved.
- The inlining precedent: `ATTR_HELPER` and `attrHelperSource()` in `packages/compiler/src/shared.ts`, with a drift test in `compile-element.test.ts`. Behavioural element tests load the compiled module in happy-dom in `packages/compiler/tests/compile-element-render.test.ts` (its "$props delivery" block).

**Corrections to the census reading**

1. A pure type definition is dropped by every compiled path, not just the property one. `extractInitialValue` skips Shape 2b (`isSchemaOnly`), so `label: { "type": "string" }` never enters `this.state`, and all three paths test membership against `this.state`. The interpreter tests `key in def.state`, so it accepts the prop. Typed prop declarations are the common shape, so the key set must come from the definition.
2. A state key named `state` is merged into itself today (`this.hasOwnProperty("state")` is the element's own field, so `this.state.state = this.state`), and an accessor named `state`, `template` or a lifecycle callback would shadow the class's own member and break the element. Those names need excluding from the property merge and the accessors. The attribute paths are unaffected: they write `this.state[k]`, never a member, and the interpreter accepts such a key there.
3. The interpreter does not re-deliver a reflected name after connection. It installs no accessor for a name `in HTMLElement.prototype`, so a later write, including `renderCustomElementWithProps`'s effect re-writing a `$ref` prop, lands on the attribute and reaches state only when the name is observed (§16.5, `attributeChangedCallback`). This matters: 50 starter and site components declare `title` or `role` as state (for example `packages/starters/sites/museum/components/mu-exhibition-card.json`), and a reused compiled row would keep the old value. The contract question is Open below.
4. `packages/compiler/src/site/site-build.ts` (about line 2139) cites "compiler.md §5.2" for connectedCallback's three prop sources. That section is `.class.json`'s document format; it should say §4.4.

**Related, no edge**

- `plan:_shared/compiled-element-lifecycle` edits the same `connectedCallback`. Its integration contract puts the observed-attribute read first, with the property merge after `data-jx-props` and `props.*`, and a first-connection flag of its own. Whichever lands second merges the two flags into one.
- `plan:spec/static-dom-property-emission`'s property table is not needed here. Whether a key is "already an `HTMLElement` property" is decided at run time with `key in HTMLElement.prototype`, as the interpreter decides it, because the set differs between browsers (`role`, `popover`) and a build-time list would disagree with the interpreter on some of them.
- `plan:spec/one-way-prop-forwarding` requires this plan and does the paper half of §13.3.
- `plan:spec/one-way-prop-forwarding-page-bindings` gives a page-level instance its `.key=` binding. Without it, a page-level instance still gets its accessors from this plan, but nothing on the page writes them. That is why the browser check under Acceptance puts the bound child inside a component, not on the page.
- `compiler.md` §4.2's example output repeats the stale merge. It rides with `plan:compiler/element-binding-table`.

## Outcome

- `compiler.md` §4.4 → marker removed (unmarked, as before the census). The snippet and prose state the emitted bridge, and §11 gains the inlined helper's entry.
- `spec.md` §13.2 → Implemented in both tiers from one rule. The section also states that a prop is accepted for any declared key, pure type definitions included.
- `spec.md` §16.2 → Implemented. The section states the accessor contract both tiers ship, including what happens to a reflected name after connection.
- `spec.md` §13.3 is not claimed (`plan:spec/one-way-prop-forwarding` owns it). It stays Partial, with its marker narrowed to what is still missing once this lands.

## Decisions

- **Decided:** accessors go on the instance, after the merge, on the first connection only, as in the interpreter. A write before connection creates an own property that the merge reads; the accessor then replaces it. Prototype accessors would put a pre-connection write straight into state, where the `data-jx-props` and `props.*` reads that follow would overwrite it. That breaks the "property wins" order that §4.4 and `spec.md` §16.5 state.
- **Decided:** the connect-time test is `instanceSupplies`'s rule, inlined from one runtime export. `@jxsuite/runtime` exports `instanceSupplies` unchanged. `propSupplyHelperSource()` in `shared.ts` emits a hand-written copy (`__jxSupplies`), because generated modules load without the runtime. The rule is logic, so the drift test is behavioural: both functions run over one input matrix. This follows `plan:_shared/compiled-element-lifecycle`'s treatment of `absorbAttribute`.
- **Decided:** the key set is the definition's, emitted at build time as two literals. `const __jxProps = [...]` holds every key of `doc.state` that is not private (`isPrivateStateKey`). Both attribute paths read it, so a pure type definition is accepted as it is by the interpreter (correction 1). `const __jxBridged = [...]` is `__jxProps` minus `ELEMENT_MEMBERS`, and the property merge and the accessor loop read it.
- **Decided:** `ELEMENT_MEMBERS` in `compile-element.ts` lists the names the emitted class defines: `state`, `template`, `constructor`, `connectedCallback`, `disconnectedCallback`, `adoptedCallback` and `attributeChangedCallback`. A key with one of those names still arrives through `data-jx-props` and `props.*`, but is neither merged from a property nor given an accessor, and the component can still use it internally (correction 2). The interpreter's class has no such members, so this is a compiled-only exception, and §4.4 states it. Failing the build instead would reject documents the interpreter renders.
- **Decided:** "already an `HTMLElement` property" is `key in HTMLElement.prototype`, tested in the generated module at run time, exactly as the interpreter tests it.
- **Decided:** new code is emitted only when needed. `__jxProps` is always emitted, because both attribute paths read it. `__jxBridged`, the helper, the `#jxConnected` flag and the merge-and-accessor block are emitted only when `__jxBridged` is non-empty. That is the precedent the `Request` effects set.
- **Open:** after connection, does a write to a reflected name (`title`, `role`, `hidden`) reach a component's state? Recommendation: no, in either tier, and §16.2 says so. Such a name keeps its native accessor, its value is taken at connection by §13.2's rule, and a later write reaches state only when the definition lists it in `observedAttributes` (`spec.md` §16.5). This changes no interpreter behaviour, and the fix is one line of authoring that uses the platform's own mechanism for hearing attribute changes. The alternatives change both tiers. Shadowing the native accessor would stop a parent's `.hidden=` from hiding the host. Implicitly observing reflected keys cannot round-trip camelCase reflections (`tabIndex`, `ariaLabel`) through `absorbAttribute`. The cost is that a reused compiled row whose component declares `title` or `role` shows a stale value until those components observe the name (correction 3). In a built site that remedy works only once `plan:_shared/compiled-element-lifecycle` lands, because the compiled element ignores `observedAttributes` until then (§16.5's own marker says so). Until then the compiled tier's only remedy is a name the platform does not use. The rule this plan states ("reaches state only when observed") holds either way, so there is no edge. This plan does not add `observedAttributes` to the starters; that belongs in a follow-up on `@jxsuite/starters`.

## Implementation

1. **`packages/runtime/src/runtime.ts`**: export `instanceSupplies` with its signature unchanged. Its JSDoc gains: "Exported for the compiler, which inlines the rule into generated modules; a compiler test proves the copy agrees." No behaviour change.
2. **`packages/compiler/src/shared.ts`**, beside `ATTR_HELPER`:
   - add `export const PROP_SUPPLY_HELPER = "__jxSupplies";`.
   - add `export function propSupplyHelperSource(): string`. It returns one declaration that restates `instanceSupplies` line for line: `Object.hasOwn(el, k)`, then `el.hasAttribute(k)`, then the kebab spelling (`k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())`) when it differs.
   - its JSDoc names `spec.md` §13.2 as the rule's home and the drift test as its guard, mirroring `attrHelperSource()`'s.
3. **`packages/compiler/src/targets/compile-element.ts`**:
   - Import `isPrivateStateKey` from `@jxsuite/schema/guards`, and `propSupplyHelperSource` from `../shared.ts`.
   - Add `ELEMENT_MEMBERS` beside `LIFECYCLE_KEYS`. If `plan:spec/callable-classifier` has landed first, `LIFECYCLE_KEYS` has moved to `@jxsuite/schema/function-role`, and `ELEMENT_MEMBERS` goes where the local constant stood, as that plan says; it stays local to `compile-element.ts` either way, because it names the emitted class's members and nothing outside the element target reads it.
   - In `emitElementModule`, compute `propKeys = Object.keys(defs).filter((k) => !isPrivateStateKey(k))` and `bridgedKeys = propKeys.filter((k) => !ELEMENT_MEMBERS.has(k))`. Push `const __jxProps = ${JSON.stringify(propKeys)};` after `attrHelperSource()`. When `bridgedKeys` is non-empty, follow it with `const __jxBridged = ${JSON.stringify(bridgedKeys)};` and `propSupplyHelperSource()`.
   - In the class, add `#jxConnected = false;`, only when `bridgedKeys` is non-empty.
   - In `connectedCallback`:
     - open with `const _first = !this.#jxConnected; this.#jxConnected = true;` (again only when `bridgedKeys` is non-empty).
     - change the `data-jx-props` test to `if (__jxProps.includes(k))`, and the `props.*` test to `if (__jxProps.includes(_k))`. The `#` guards stay as they are.
     - replace the `Object.keys(this.state)` loop and its "Only check own properties" comment with the block §4.4's new snippet shows (again only when `bridgedKeys` is non-empty). Under `if (_first)`, it has two loops over `__jxBridged`:
       - a merge loop: `_k in this && this[_k] !== undefined && __jxSupplies(this, _k)`.
       - then an accessor loop: `if (!(_k in HTMLElement.prototype)) Object.defineProperty(this, _k, { configurable: true, get: () => this.state[_k], set: (v) => { this.state[_k] = v; } })`.
     - add a comment citing `spec.md` §13.2 and §16.2.
     - the `Request` effects, render and `onMount` stay after the block.
4. **`packages/compiler/src/site/site-build.ts`**: in the `data-jx-props` comment, change "compiler.md §5.2" to "compiler.md §4.4" (correction 4).
5. Spec and docs edits (below).

**Integration contract.** Once this lands, other plans may rely on the following.

- `@jxsuite/runtime` exports `instanceSupplies(el, key): boolean`, the one §13.2 rule. `shared.ts` exports `PROP_SUPPLY_HELPER` and `propSupplyHelperSource()`.
- Every compiled element accepts a prop from `data-jx-props` and `props.*` attributes for each key in `__jxProps`: the definition's state keys, minus private keys. On the first connection only, it then merges the properties the instance carries by the supply rule for each key in `__jxBridged` (`__jxProps` minus `ELEMENT_MEMBERS`), and installs instance accessors for those keys that are not `HTMLElement` properties.
- After that, for such a key, `el.key = v` and a compiled parent's re-committed `.key=` binding update state and re-render, including in a reused `$map` row.
- A reflected name is taken at connection and afterwards reaches state only through `observedAttributes`. That sentence changes if the Open resolves the other way.
- A plan that adds a public member to the emitted class adds its name to `ELEMENT_MEMBERS`.
- `plan:spec/one-way-prop-forwarding` may therefore state that a `$ref` prop re-delivers the parent's value in both tiers wherever a compiled parent binds it, with the reflected-name exception pointing at §16.2 and §16.5. A page-level instance additionally needs `plan:spec/one-way-prop-forwarding-page-bindings`, which that plan also requires.
- `plan:_shared/compiled-element-lifecycle`'s observed-attribute read goes ahead of the `data-jx-props` read, and the two first-connection flags become one.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`. There is no new source file, so the manifest check sees nothing new. Both workspaces keep their per-file `coverageThreshold`: runtime `lines = 0.963, functions = 0.98`, compiler `lines = 0.982, functions = 0.98`. Ratchet if the worst file rises.

`packages/runtime/tests/custom-elements.test.ts`, in the reflected-name `describe`:

- "instanceSupplies is exported and reads an own property, the attribute, then the kebab ARIA attribute": real happy-dom elements, one assertion per branch, plus a key nothing supplies.

`packages/compiler/tests/compile-element.test.ts`, a new `describe("compileElement — the property bridge (spec.md §13.2, §16.2)")`:

- "props are accepted for every declared key, pure type definitions included": `state: { label: { type: "string" }, count: 0, "#cache": 1 }` emits `const __jxProps = ["label","count"];`, and both attribute paths test `__jxProps.includes(`.
- "the property merge uses the supply rule, not an own-property test": the output has no `hasOwnProperty` and contains `__jxSupplies(this, _k)`; `propSupplyHelperSource()`'s text appears once.
- "accessors are installed once, after the merge, and never for an HTMLElement property": the merge's index is below `Object.defineProperty`'s, both follow `if (_first)`, and the accessor loop tests `!(_k in HTMLElement.prototype)`.
- "a key naming a member of the emitted class arrives by attribute but is not bridged": `state: { state: 1, template: "t", n: 0 }` emits `__jxProps` as `["state","template","n"]` and `__jxBridged` as `["n"]`.
- "a document with nothing to bridge emits no bridge": `state: { "#x": 1 }` and `state: { template: "t" }` each emit no `__jxBridged`, no `__jxSupplies`, no `defineProperty` and no `#jxConnected`.
- the existing "connectedCallback reads literal props.* attributes" expects `if (__jxProps.includes(_k)) {` instead of `if (_k in this.state) {`.

`packages/compiler/tests/compile-element-render.test.ts`, a new `describe("compiled element — the property bridge")`. It uses a child `ls-bridge` with `state: { count: 0, title: "DEFAULT TITLE", label: { type: "string" }, "#secret": "s" }` rendering all three into `p` elements, and a parent `ls-bridge-host` with `state: { n: 1, heading: "H1", rows: [{ n: 1 }, { n: 2 }] }` that renders one `ls-bridge` bound to `count: { $ref: "#/state/n" }` and `title: { $ref: "#/state/heading" }`, plus a `$map` of `ls-bridge` over `rows` with `count: "${$map.item.n}"`. Both modules are written under the file's `TMP` directory.

- "a property written after connection re-renders": `el.count = 3` renders `3`, and `el.count` reads `3`.
- "a pure type definition accepts a prop from a property, data-jx-props and props.*": three instances, one per path.
- "a reflected name set before connection renders": `el.title = "T"` before `append` renders `T`.
- "a reflected name nobody set keeps the declared default": renders `DEFAULT TITLE`. This is the regression the own-property test guarded against.
- "an empty reflected value is honoured": `el.title = ""` renders the empty string.
- "a private key gets no accessor": after connection, `Object.getOwnPropertyDescriptor(el, "#secret")` is `undefined`, and a write to it leaves the state value `s`.
- "a compiled parent's bindings reach the child, at connection and after": the child first renders `1` and `H1`; the `H1` is §13.2's `.title=` case, dropped today. `host.state.n = 2` then renders `2` in the child.
- "a reused $map row re-renders with its new item's props": after reversing `rows`, the rows read `2`, `1`.
- "a reflected name written after connection sets the host attribute and leaves state alone": `host.state.heading = "H2"` leaves the child's text at `H1`, and the child's `title` attribute is `H2`. This pins the Open; invert it if the Open goes the other way.
- "re-insertion neither re-merges nor loses the accessors": remove, set `el.count = 9`, re-append, and the element renders `9`.
- "a property set before the definition loads is absorbed, then forwards": a third tag is created, given `count = 7` and inserted before its module is imported (happy-dom upgrades an inserted element on definition). It renders `7`, and a later write re-renders.
- "the inlined supply rule agrees with instanceSupplies" (drift guard):
  - write `propSupplyHelperSource()` plus `export { __jxSupplies };` to a module under `TMP` and import it once.
  - build stub elements (`Object.create({ hasAttribute })` over a set of names).
  - compare the two functions for every row of: key in `count`/`title`/`ariaLabel`/`tabIndex` × own property absent/present/`undefined` × attribute none/exact/kebab.

The default-title, private-key and re-insertion cases pass today as well. They are guards on the new code, against the `title in this` regression, an accessor for a private key, and a flag that loses the accessors. Every other render case fails today.

## Specs & docs

- **`compiler.md` §4.4**:
  - Delete the Partial marker.
  - Replace the opening sentence with: "`connectedCallback` takes props from three sources, in order: a `data-jx-props` payload, literal `props.*` attributes, then, on the first connection, JS properties the instance carries. Each is accepted only for a key the definition's `state` declares, a pure type definition included, and refused for a private one (spec.md §5.6). It then installs the property-first interface (spec.md §16.2) and registers the render effect."
  - Replace the snippet with the emitted block: the `__jxProps` and `__jxBridged` literals, the `__jxSupplies` helper elided to a comment, the `_first` flag, the two attribute paths testing `__jxProps.includes`, and the guarded merge and accessor loops over `__jxBridged`.
  - Add a paragraph after the snippet: "The third source takes what the instance genuinely carries (spec.md §13.2): an own property, or the attribute a reflected property writes. `key in this` alone would let `title` answer with its empty native value and beat the declared default, and an own-property test alone drops a parent's `.title=`, which creates no own property. The rule is `instanceSupplies` in `@jxsuite/runtime`, inlined by `propSupplyHelperSource()` (§11). Every declared key that is not already an `HTMLElement` property then gets an accessor forwarding into `this.state`, so a later `el.key = v`, a compiled parent's re-committed `.key=` binding included, re-renders the element; a key that is one keeps the native accessor (spec.md §16.2). A key that names a member of the emitted class (`state`, `template`, a lifecycle callback) is the one compiled-only exception: it arrives through the two attribute sources, but is neither merged from a property nor given an accessor, because either would replace the member."
- **`compiler.md` §11**: add `### propSupplyHelperSource() — the prop-supply rule, inlined for a generated module`. It is one paragraph mirroring the `attrHelperSource()` entry: the rule is `instanceSupplies`', and a test runs both over one input matrix. §11's marker is not touched; `plan:compiler/shared-utilities-signatures` owns it.
- **`compiler.md` §4.2**: no edit. `plan:compiler/element-binding-table` elides §4.2's props intake to a comment citing §4.4, so the example never restates this block. If that plan has not landed, §4.2 keeps its stale loop until it does.
- **`spec.md` §13.2**:
  - Rewrite the marker as "> **Status: Implemented.** Both tiers apply the rule below: the interpreter calls `instanceSupplies` (`packages/runtime/src/runtime.ts`), and the compiled element carries an inlined copy that a test proves agrees with it (compiler.md §4.4)."
  - After the example, add one sentence: "A prop is accepted for any key the definition's `state` declares, including a pure type definition such as `{ "type": "string" }`, which has no value of its own until one is supplied."
- **`spec.md` §16.2**: set the marker to `> **Status: Implemented.**`. Append: "Each non-private state key that is not already an `HTMLElement` property gets an accessor on the element, forwarding into its state. The accessor is installed when the element first connects, after the props it arrived with are merged, so a property set before connection is merged and one set afterwards re-renders the element, in both tiers. A key that is already an `HTMLElement` property (`title`, `role`, `lang`, `hidden`) keeps the native accessor. Its value is taken at connection by §13.2's rule, and a later write, which lands on the attribute, reaches state only when the definition lists the name in `observedAttributes` (§16.5). A private key gets no accessor (§5.6), and compiled output also skips a key that names a member of its element class (compiler.md §4.4)." Adjust the reflected-name sentences if the Open goes the other way.
- **`spec.md` §13.3**: not claimed here, and its marker stays Partial, but its compiled-tier sentence stops being true. The marker becomes: "> **Status: Partial.** Forwarding is one way, parent to child. The interpreter writes the resolved value onto the child as a property and re-writes it from an effect when the parent changes (`renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`). Compiled output binds `.prop=`, which lit re-commits, only inside a component definition and a client `$map` row (`compile-element.ts`, `compile-client.ts`). Where a parent writes the property, the child's accessor (§16.2) carries each change into its scope, except for a name that is already an `HTMLElement` property, which reaches it only when observed (§16.5). An instance written on a built page receives its `$props` once, in `data-jx-props`, with each `$ref` unresolved (`expandComponents` in `packages/compiler/src/site/site-build.ts`). In both tiers a child's write to a primitive prop updates only the child, and only a shared object or array proxy is seen by both scopes."
- **Fragments**:
  - `bun run spec:change compiler.md minor -m "The compiled element accepts a prop for every declared state key, takes a reflected-name prop by the runtime's supply rule, and forwards later property writes into state through accessors"`
  - `bun run spec:change spec.md minor -m "Compiled elements take every prop an instance supplies, pure type definitions and reflected names included, and forward later property writes into state; a reflected name reaches state after connection only when observed"`
- **Docs**: `docs/framework/concepts/props-and-scope.md` (its `spec:` cites `spec.md#13`) gets a new `## Setting props from script` section after "Static and bound props". Its text: "A component's props are also its JavaScript properties. Setting `card.count = 5` on an instance sets the component's `count`, before or after the element is on the page, and re-renders it once it is there, in Studio and in a built site alike. When one component renders another, the props it binds arrive the same way, so a change in the parent reaches the child. One exception comes from the platform: a prop named after a property every HTML element already has (`title`, `role`, `lang`, `hidden`) is read when the element connects, but a later write sets the element's own attribute instead. Choose a name the platform does not use, or list the name in `observedAttributes` (see [Attribute props](#attribute-props)) so the change reaches the component as well." The page's "Attribute props" section already presents `observedAttributes` without a tier caveat; a built site honours it once `plan:_shared/compiled-element-lifecycle` lands, whose docs step says so. Add `spec.md#16.2` to its `spec:` list and `packages/compiler/src/targets/compile-element.ts` to its `code:`. Its "Signal forwarding" paragraph and "live in both directions" rule belong to `plan:spec/one-way-prop-forwarding` and are not touched. No em dashes.
- `docs/framework/concepts/components.md` lists `compile-element.ts` and `runtime.ts` in `code:`, so `docs:sync` names it. It describes neither props delivery nor accessors, so it does not change. `docs/framework/build.md` cites `compiler.md#4.1`, not §4.4, and does not change either.
- `docs:sync` also names every page whose `code:` lists a touched file: `runtime.ts` (`runtime-host`, `contributing/docs`, `overlays`, `reactivity`, `styling`, `color-schemes`, `elements`), `shared.ts` (`build`, `elements`, `styling`, `color-schemes`), `site-build.ts` (`build`, `color-schemes`, `redirects`, `deployment`, `seo`) and `compile-element.ts` (`functions`, `lists`). What changes in those files is an export, an inlined helper and a comment citation, so none of those pages changes; the pull request says so.

Neither spec graduates: `spec.md` and `compiler.md` both keep other open items.

## Acceptance

- `cd packages/runtime && bun test --isolate --coverage` and `cd packages/compiler && bun test --isolate --coverage` pass at their thresholds. `bun scripts/check-coverage-manifest.ts packages/runtime` and `bun scripts/check-coverage-manifest.ts packages/compiler` both pass.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass. `bun run plans:status --spec spec` lists neither §13.2 nor §16.2, and `bun run plans:status --spec compiler` does not list §4.4.
- `grep -n hasOwnProperty packages/compiler/src/targets/compile-element.ts` finds nothing.
- Observable, in a browser: `jx build` a scratch site whose page renders `<my-host>`, a component whose own definition holds `n`, a button that increments it, and a `<my-card>` bound to `$props: { "count": { "$ref": "#/state/n" }, "title": { "$ref": "#/state/heading" } }`. The card first shows the host's `heading`, not its own default. Clicking the button updates the card, and `document.querySelector("my-card").count = 9` in the console re-renders it. The bound child sits inside a component because a card written on the page itself gets no binding until `plan:spec/one-way-prop-forwarding-page-bindings` lands.
