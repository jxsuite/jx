---
status: stub
disposition: implement
claims:
  - compiler.md#4.4
  - spec.md#13.2
  - spec.md#16.2
size: M
workspaces:
  - packages/compiler
---

# A compiled element takes every prop its instance supplies, before and after connection, as the interpreter does

## Context

All three items are open for one mechanism, the compiled element's property bridge, so one plan claims them. The census stubbed `compiler.md` §4.4 and `spec.md` §13.2 and §16.2 separately; the §4.4 work (the reflected-name case at connection) was item 2 of the other, and the cross-spec review merged them.

`specs/compiler.md` §4.4, line 200 (unmarked before the census, and listed as verified in its first pass):

> **Status: Partial.** The third source is narrower than the snippet: the emitted merge takes a property only when `this.hasOwnProperty(key)` (`packages/compiler/src/targets/compile-element.ts`), not `key in this`, so a value set before connection through a reflected `HTMLElement` property (`title`, `lang`, `hidden` and the rest), which creates no own property, is dropped and the component renders its default, where the interpreter takes it (`instanceSupplies` in `packages/runtime/src/runtime.ts`, `spec.md` §13.2).

The section lists three sources, "a `data-jx-props` payload, literal `props.*` attributes, then JS properties set before connection". The snippet's `key in this` is not what ships and would be wrong if it did: `title in this` is always true on an `HTMLElement`, so it would overwrite every such state key with the empty reflected value. The emitter narrowed it to own properties, which drops the reflected case instead.

`specs/spec.md` §13.2, line 1526:

> **Status: Partial.** The interpreter implements the rule below (`instanceSupplies` in `packages/runtime/src/runtime.ts`). The compiled element does not: the `connectedCallback` that `compile-element.ts` emits merges a property only when `this.hasOwnProperty(key)`, so a compiled parent's `.title=` binding, which goes through the reflected accessor and creates no own property, is dropped and the component renders its default.

`specs/spec.md` §16.2, line 1653:

> **Status: Partial.** The interpreter defines a property accessor forwarding into state for every non-private state key that is not already an `HTMLElement` property (`packages/runtime/src/runtime.ts`). The compiled element module (`compile-element.ts`) defines none: it reads a property only in `connectedCallback`, so `el.key = v` after connection, including the `.key=` binding a compiled parent re-commits when its own state changes, writes an inert own property and the element never re-renders.

Disposition `implement`, as both census stubs had it. The interpreter conforms to §13.2 and §16.2 and the compiled tier is behind. `compiler.md` §4.4's snippet is the one piece of text that is wrong rather than unbuilt, and it is restated to the merge this plan emits, which is part of closing §4.4 rather than a separate reconcile.

**What exists**

- The emitted `connectedCallback` in `packages/compiler/src/targets/compile-element.ts`: the `data-jx-props` payload (a key `in this.state`), the `props.*` attribute loop, then, per state key, `if (this.hasOwnProperty(key) && this[key] !== undefined)`, under the comment "Only check own properties to avoid inherited DOM properties like `title`". All three skip a `#` key (§5.6). The `$prototype: "Request"` auto-fetch effects are emitted after this merge so a templated `url` reads what the parent passed.
- No accessor of any kind. Confirmed by compiling `{ "tagName": "my-card", "state": { "count": 0, "title": "Default" } }` (census) and re-verified through `emitElementModule`: the emitted class has no getter, setter or `defineProperty` for either key, and the connect-time `hasOwnProperty` loop is the only property read.
- A compiled parent passes `$props` as lit `.key=` bindings (`compile-element.ts`, in both the instance and the `$map` row paths; `compile-client.ts`), which lit re-commits whenever the bound value changes. For a reflected name that write goes through the `HTMLElement` accessor and becomes an attribute.
- `instanceSupplies` in `packages/runtime/src/runtime.ts`: an own property, then the attribute of that name, then its kebab ARIA spelling (`ariaLabel` to `aria-label`). The interpreter's merge is `key in this && this[key] !== undefined && instanceSupplies(this, key)`, after the observed-attribute read, the `data-jx-props` payload and the `props.*` attributes. `packages/runtime/tests/custom-elements.test.ts` covers it. It is not exported.
- The interpreter's accessors: after the merges, one `Object.defineProperty(this, key, { configurable, get, set })` per non-private key that is not `in HTMLElement.prototype`, installed on the instance before the first render.
- The inlining precedent: `attrHelperSource()` in `packages/compiler/src/shared.ts` inlines `spec.md` §8.3's rule into generated modules, serializing `enumeratedAttrNames()` exported by `@jxsuite/runtime`, and `packages/compiler/tests/compile-element.test.ts` asserts the emitted literal equals that export.

**Correction to the census reading.** The `spec.md` stub asked that "a later write through the reflected accessor reaches state as the interpreter's re-delivery does". The interpreter does not do that. It installs no accessor for a name `in HTMLElement.prototype` and observes no mutations, so after connection a reflected-name write, including the effect in `renderCustomElementWithProps` that re-writes a `$ref` prop when the parent changes, lands on the attribute and reaches state only when that name is in the definition's `observedAttributes` (`attributeChangedCallback`, §16.5, owned by `plan:_shared/compiled-element-lifecycle`). Parity for that case is therefore the observed-attribute path, not something this plan builds. Whether a reflected name should reach state after connection without being observed is a §16.2 contract question for both tiers, and `plan:spec/one-way-prop-forwarding`'s "re-delivers the parent's value" wording depends on the answer, so detailing decides it here.

**What is missing**

1. Accessors in the emitted element: a getter and setter per non-private state key that is not a reflected `HTMLElement` property, forwarding into `this.state`, while a value set before connection is still absorbed by the connect-time merge. Where they are installed is a design point: a property written before the class is defined is an own data property, which shadows an accessor on the class prototype, so either they go on the instance after the merge, as the interpreter does, or the constructor captures and deletes such own properties first.
2. For reflected names (`title`, `role`, `lang`, `hidden` and the rest), the connect-time merge applies the same three-way test as `instanceSupplies`, inlined into the generated module from one source with a drift test the way `attrHelperSource()` inlines §8.3's rule (`compiler.md` §11). That needs a runtime export for the rule, so `packages/runtime` is touched too. The interpreter decides "reflected" at run time with `key in HTMLElement.prototype`; if the compiler decides it at build time instead, the list is the same set `plan:spec/static-dom-property-emission`'s shared property table names.
3. Compiled-target tests, behavioural ones in `packages/compiler/tests/compile-element-render.test.ts` (which loads the module in happy-dom) and text ones in `compile-element.test.ts`: a property written after connection re-renders; a reflected name passed from a compiled parent renders; a parent state change reaches the child; a private key gets no accessor.
4. `compiler.md` §4.4's snippet restated to the emitted merge, its connect-time-only description extended to the accessors, and the three markers flipped.

**Related**

- `spec.md` §13.3 (forwarding, `plan:spec/one-way-prop-forwarding`, which requires this plan and does only the paper half).
- `spec.md` §16.5 and `compiler.md` §4.1 (`plan:_shared/compiled-element-lifecycle`): the other half of the same emitted `connectedCallback`. The interpreter reads observed attributes, then `data-jx-props`, then `props.*`, then properties, and both plans place code in that sequence, so whichever lands second re-checks the order. Both inline a runtime rule with a drift test, so one inlined helper can carry both.
- `spec.md` §5.6 (private keys get no accessor, and none is settable through `$props`).
- `compiler.md` §4.2, whose example output shows the same stale merge; it rides along editorially with `plan:compiler/element-binding-table`.
