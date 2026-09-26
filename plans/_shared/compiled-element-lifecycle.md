---
status: stub
disposition: implement
claims:
  - compiler.md#4.1
  - spec.md#16.4
  - spec.md#16.5
size: M
workspaces:
  - packages/compiler
---

# A compiled element runs every lifecycle hook and honours `observedAttributes` as the interpreter does

## Context

One change to one emitted module closes three items in two specs, so one plan claims all three. The census stubbed `compiler.md` §4.1 and `spec.md` §16.4 and §16.5 separately; the §4.1 work (the host argument and `onAdopted`) was a strict subset of the other, and the cross-spec review merged them. The `attributeChangedCallback` row of §16.4 is §16.5's mechanism, which is why §16.4 and §16.5 travel together.

`specs/compiler.md` §4.1, line 81 (unmarked before the census, and listed as verified in its first pass):

> **Status: Partial.** The lifecycle paragraph below does not hold as "the same contract as the runtime's interpreted elements" (`spec.md` §16.4): the emitted `connectedCallback` calls `this.state.onMount(this.state)` without the host the interpreter passes as the second argument, and the module has no `adoptedCallback`, so `onAdopted` never runs (`packages/compiler/src/targets/compile-element.ts`).

The paragraph it qualifies says `connectedCallback` "invokes `state.onMount(state)` on a microtask after the first render ... the same contract as the runtime's interpreted elements". The first half is what ships; the contract it names is `spec.md` §16.4.

`specs/spec.md` §16.4, line 1672 (a bare `> **Status: Implemented.**` before the census):

> **Status: Partial.** The interpreter implements all four rows and `mount()`'s two hooks. The compiled element (`packages/compiler/src/targets/compile-element.ts`) calls `onMount(this.state)` without the host, and emits no `adoptedCallback` and no `attributeChangedCallback`, so `onAdopted` never runs in a built site.

`specs/spec.md` §16.5, line 1687 (a bare `> **Status: Implemented.**` before the census):

> **Status: Partial.** The interpreter implements the section (`absorbAttribute` and `declaredDefaults` in `packages/runtime/src/runtime.ts`). The compiled element module ignores `observedAttributes`: it emits no `static get observedAttributes`, no connect-time attribute read and no `attributeChangedCallback`, so in a built site `<user-card username="Ada">` renders the default, and later changes and removals do nothing.

Disposition `implement`, as both census stubs had it. The interpreter conforms to all three sections and the spec text was written from it (§16.4's paragraph on the host argument records why `onMount` gained it), so nothing points at the spec being wrong: the compiled tier is behind. `compiler.md` §4.1's lifecycle paragraph becomes true once it is restated to the full contract.

**What exists**

- The compiled element, `packages/compiler/src/targets/compile-element.ts`: `LIFECYCLE_KEYS` holds `onMount`, `onUnmount` and `onAdopted`, which keeps all three out of the callable and handler paths, but only two are ever called. The emitted `connectedCallback` ends with `queueMicrotask(() => this.state.onMount(this.state))`, and `disconnectedCallback` stops the effect registry and calls `onUnmount(this.state)`. There is no `adoptedCallback`, no `static get observedAttributes()` and no `attributeChangedCallback`; `observedAttributes` is read only to skip it as a non-handler key. The only attributes read at connection are `data-jx-props` and `props.*`.
- Re-verified by emitting `{ tagName: "my-card", observedAttributes: ["count"], state: { count: 0, title: "Default", onAdopted: … } }` through `emitElementModule`: the module assigns `onAdopted` into state and calls `onMount(this.state)`, and contains no `adoptedCallback`, `attributeChangedCallback` or `observedAttributes`.
- The compiled element builds `this.state` in its constructor, where the interpreter builds its scope inside an async `connectedCallback`. That difference matters to the design: the interpreter needs its connect-time attribute read only because an `attributeChangedCallback` delivered at upgrade finds no state to write into, while the platform delivers that callback for every observed attribute already present before it calls `connectedCallback`.
- The interpreter, `packages/runtime/src/runtime.ts`: `static get observedAttributes()` returns the definition's list, frozen when the class is defined because the platform freezes it; `connectedCallback` reads each observed attribute already present through `absorbAttribute`, before the `data-jx-props`, `props.*` and property merges, so a property a parent set still wins; `onMount(state, this)` runs on a microtask; `disconnectedCallback` calls `onUnmount(state)`; `adoptedCallback` calls `onAdopted(state)`; `attributeChangedCallback` returns early with no state or an unchanged value, and otherwise calls `absorbAttribute(state, name, newVal, declaredDefaults(current definition))`, so a redefinition's defaults reach a connected instance.
- `absorbAttribute` is §16.5's coercion: a `boolean` entry is presence, with `"false"` counting as absent; a `number` entry parses with `Number()`; anything else is the string; a removal (`null`) restores the declared default, falling back to `0` for a number and `""` otherwise. `declaredDefaults` reads `default`, takes a shorthand entry's literal as its default, and gives a computed entry (`$expression`, `$prototype`, `$ref`, `$src`) none. Neither function is exported.
- Tests: `packages/runtime/tests/runtime-gaps-elements.test.ts`, `mount.test.ts`, `connect-attributes.test.ts` for the interpreter. On the compiled side, `packages/compiler/tests/compile-element.test.ts` asserts on emitted text, and `packages/compiler/tests/compile-element-render.test.ts` loads a compiled module in happy-dom and drives it, which is where behavioural cases for these callbacks belong.

**What is missing**

- The emitted call becomes `onMount(this.state, this)`.
- An emitted `adoptedCallback` calling `onAdopted(this.state)` when the state defines it.
- `static get observedAttributes()` returning the definition's list; the attribute read before the `$props` merge (an explicit connect-time read as the interpreter does, or the platform's upgrade-time `attributeChangedCallback` into constructor-built state, whichever detailing picks, provided the merge order of §16.5's third paragraph holds); and `attributeChangedCallback` with §16.5's coercion and default restoration on removal. The rule is shared with the runtime through one inlined source and a drift test, the spec audit's spec-wide decision and the `attrHelperSource()` precedent (`packages/compiler/src/shared.ts`, which serializes `enumeratedAttrNames()` exported by `@jxsuite/runtime`, asserted in `compile-element.test.ts`). That needs a runtime export for `absorbAttribute`'s rule, so `packages/runtime` is touched too; the declared defaults can be emitted as a literal, since the compiler sees the state definitions.
- Tests in `compile-element.test.ts` and `compile-element-render.test.ts`: `onMount` receives the host; `onAdopted` runs on `document.adoptNode`; `<user-card username="Ada">` renders `Ada`; a later change coerces; a removal restores the default; a parent's property still beats an observed attribute.
- `compiler.md` §4.1's lifecycle paragraph restated to the full contract, and the three markers flipped.

**Related**

- `spec.md` §13.2 and §16.2 and `compiler.md` §4.4 (`plan:_shared/compiled-prop-bridge`): the other half of the same emitted `connectedCallback`. The interpreter reads its sources in the order observed attributes, `data-jx-props`, `props.*`, then properties, and both plans place code in that sequence, so whichever lands second re-checks the order. Both inline a runtime rule with a drift test, so one inlined helper can carry `absorbAttribute`'s rule and `instanceSupplies`'s.
- `spec.md` §16.1 (`plan:spec/compiled-host-handlers`), which adds host listeners to the same emitted `connectedCallback` and `disconnectedCallback`.
- `compiler.md` §4.2, whose example output shows the `onMount` call this plan changes; it rides along editorially with `plan:compiler/element-binding-table`.
- `spec.md` §16.8 (CEM `attributes`, `plan:spec/cem-manifest-export`), which projects the same `observedAttributes` list.
- `embedding.md` §2: `mount()` in `packages/runtime/src/runtime.ts` calls `onMount(scope)` synchronously once the root is appended, with no host argument. §16.4 says an element's `onMount` receives `(state, host)` and that a mounted document "runs the same two hooks at its own boundary" without naming the arguments; the §16.4 restatement should say which a mounted document gets.
