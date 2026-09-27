---
status: drafted
disposition: implement
claims:
  - compiler.md#4.1
  - spec.md#16.4
  - spec.md#16.5
requires: []
workspaces:
  - packages/runtime
  - packages/compiler
size: L
---

# A compiled element runs every lifecycle hook, and a built site honours `observedAttributes`, as the interpreter does

## Context

One emitted module closes three items in two specs, so one plan claims all three. The census stubbed `compiler.md` §4.1 and `spec.md` §16.4 and §16.5 separately; the §4.1 work was a strict subset of the other, and the cross-spec review merged them. `attributeChangedCallback` is a §16.4 row and §16.5's mechanism, which is why those two travel together.

`specs/compiler.md` §4.1, line 81 (unmarked before the census):

> **Status: Partial.** The lifecycle paragraph below does not hold as "the same contract as the runtime's interpreted elements" (`spec.md` §16.4): the emitted `connectedCallback` calls `this.state.onMount(this.state)` without the host the interpreter passes as the second argument, and the module has no `adoptedCallback`, so `onAdopted` never runs (`packages/compiler/src/targets/compile-element.ts`).

`specs/spec.md` §16.4, line 1672 (a bare `> **Status: Implemented.**` before the census):

> **Status: Partial.** The interpreter implements all four rows and `mount()`'s two hooks. The compiled element (`packages/compiler/src/targets/compile-element.ts`) calls `onMount(this.state)` without the host, and emits no `adoptedCallback` and no `attributeChangedCallback`, so `onAdopted` never runs in a built site.

`specs/spec.md` §16.5, line 1687 (a bare `> **Status: Implemented.**` before the census):

> **Status: Partial.** The interpreter implements the section (`absorbAttribute` and `declaredDefaults` in `packages/runtime/src/runtime.ts`). The compiled element module ignores `observedAttributes`: it emits no `static get observedAttributes`, no connect-time attribute read and no `attributeChangedCallback`, so in a built site `<user-card username="Ada">` renders the default, and later changes and removals do nothing.

**What exists** (re-verified against the tree)

- `emitElementModule` in `packages/compiler/src/targets/compile-element.ts`. `LIFECYCLE_KEYS` (`onMount`, `onUnmount`, `onAdopted`) keeps the three hooks out of the callable and computed classification, but only two are called: `connectedCallback` ends with `queueMicrotask(() => this.state.onMount(this.state))`, and `disconnectedCallback` stops `#effects` and calls `onUnmount(this.state)`. No `adoptedCallback`, no `static get observedAttributes()`, no `attributeChangedCallback`; `observedAttributes` is read only to skip it as a non-handler key. The constructor builds `this.state`; `connectedCallback` runs in full on every connection (merges, render, `onMount`).
- The interpreter's element class in `defineElement` (`packages/runtime/src/runtime.ts`): `static get observedAttributes()` frozen at definition; `connectedCallback` returns early once `_jxInitialized`, otherwise builds the scope, reads each observed attribute present through `absorbAttribute` before the `data-jx-props`, `props.*` and property merges, and queues `onMount(state, this)`; `disconnectedCallback` calls `onUnmount(state)`; `adoptedCallback` calls `onAdopted(state)`; `attributeChangedCallback` returns with no state or an unchanged value, else `absorbAttribute(state, name, newVal, declaredDefaults(current definition))`. Neither helper is exported. Tests: `connect-attributes.test.ts`, `runtime-gaps-elements.test.ts` (calls `el.adoptedCallback()` directly), `runtime-seam.test.ts` S5 (host argument), `custom-elements.test.ts`, `mount.test.ts`.
- The inlining precedent: `attrHelperSource()` in `packages/compiler/src/shared.ts` serializes `enumeratedAttrNames()` from `@jxsuite/runtime`, and `compile-element.test.ts` asserts the literal equals the export. Behavioural element tests live in `compile-element-render.test.ts`, which writes a compiled module under `tests/` and imports it into happy-dom.

**Corrections to the census reading**

1. The host is dropped twice, not once. A bodyless `$src` hook with the default `arguments` is wrapped as `this.state.onMount = (state) => onMount(state);` (asserted verbatim by "a bodyless $src lifecycle hook stays callable" in `compile-element.test.ts`), so fixing the call site alone still loses the host. The interpreter calls the imported function directly.
2. The module fix alone does not close §16.5 in a built site. `isComponentFullyStatic` (`shared.ts`) skips `observedAttributes` in its handler scan, so a definition whose only runtime surface is its observed attributes is "fully static": `expandComponents` in `packages/compiler/src/site/site-build.ts` stamps it `data-jx-static` and `injectComponentScripts` ships no module for it. And neither prerender path (`expandComponents`, `renderComponentInstance` in `shared.ts`) reads an instance's observed attributes, so the first paint shows the default even when the module loads.
3. `declaredDefaults` does not mirror `buildScope`'s shapes: a pure type definition (`{ "type": "number" }`, Shape 2b, which `buildScope` leaves out of state) is recorded as its own default, so removing its attribute writes the schema object into state, where §16.5 says an entry with no declared default falls back by type.
4. The two tiers disagree on when `onMount` runs. The compiled element re-renders and queues `onMount` on every connection; the interpreter queues it on the first connection only, while both run `onUnmount` on every removal, so an interpreted element that is moved gets `onUnmount` with no `onMount` after it.
5. `compiler.md` §4.2's example output contains no `onMount` call (the example has no hook); nothing there changes for this plan.
6. happy-dom 20.14.5 implements no adoption reaction (its `CustomElementRegistry.define` records only the connected, disconnected and attribute-changed callbacks) and upgrades an element defined after insertion without delivering `attributeChangedCallback` for its existing attributes. Tests must call `adoptedCallback()` directly, and only a connect-time read makes the upgrade path observable there.

**Related, no edge**: `plan:_shared/compiled-prop-bridge` (property merge and accessors in the same `connectedCallback`) and `plan:spec/compiled-host-handlers` (host listeners in the same two callbacks) edit other statements of the same methods; `plan:spec/cem-manifest-export` projects the same `observedAttributes` list; `plan:compiler/shared-utilities-signatures` owns `compiler.md` §11's marker, to which this plan only adds an entry.

## Outcome

- `compiler.md` §4.1 → marker removed (unmarked, as before the census); the lifecycle paragraph states the full contract.
- `spec.md` §16.4 → Implemented, with the insertion rule and the `mount()` hook arguments stated.
- `spec.md` §16.5 → Implemented in both tiers and in the built site's prerender and script injection.

## Decisions

- **Decided:** the compiled element gets observed attributes two ways: `attributeChangedCallback` writing into the constructor-built state (so, unlike the interpreter, it needs no state guard and hears changes made before connection), plus a read of each observed attribute present on the first connection only, as the first statement of `connectedCallback`, before the `data-jx-props` merge. The platform already delivers upgrade-time callbacks in browsers, so the read is idempotent there; it is kept because it is the interpreter's shape, it makes the prerendered-upgrade path testable in happy-dom (correction 6), and the first-connection guard stops a re-insertion from resetting state a handler has changed since.
- **Decided:** one rule, two exports, two drift tests. `@jxsuite/runtime` exports `absorbAttribute` and `declaredDefaults` unchanged in signature. The module carries a hand-inlined copy of `absorbAttribute` from a new `observedAttrHelperSource()` beside `attrHelperSource()`, proven equal by a behavioural case matrix run against the export (the rule is logic, so a literal comparison cannot guard it). The declared defaults are not re-derived: the compiler calls the runtime's `declaredDefaults(doc)` at build time, keeps the observed keys, and emits them as a `new Map([...])` literal (a `Map`, because an object literal would give a `__proto__` key meaning).
- **Decided:** everything new is emitted only when declared: the observed-attribute machinery when `observedAttributes` is a non-empty array, `adoptedCallback` when `state` declares `onAdopted`. A document without either compiles to the same module as today, the precedent the `Request` effects set.
- **Decided:** a `$src` `onMount` wrapped with the default arguments forwards the host, `(state, host) => onMount(state, host)`; declared `parameters` already reach the host (`["state", "host"]` is emitted as `(state, host) => …`, and `["host"]` is mapped onto the second argument), as the interpreter's `resolveParamNames` does.
- **Decided:** `declaredDefaults` is fixed here to mirror `buildScope`: `default` present → that value; a computed marker → none; any other object carrying a JSON Schema keyword (`hasSchemaKeywords`) → none; otherwise the entry is its own default. The compiled tier serializes this function's output, so leaving it would ship correction 3 into both tiers.
- **Decided:** the prerender applies the same rule. For each observed attribute an instance writes with a statically resolvable value, the value is converted to the attribute text `buildAttrs` would emit (a boolean through `booleanAttrValue`, where `null` means absent), coerced with the runtime's `absorbAttribute` against the definition's build-time scope, and laid under `$props` (props win, §16.5's order). The result feeds the instance scope and the §16.9 frame key (the interpreter's `supplied` records attributes too) but never `data-jx-props`: the module reads the attribute itself, and a prop there would outrank a later attribute change on the first connection.
- **Open:** does a definition whose only runtime surface is `observedAttributes` ship its module? Recommendation: yes, `isComponentFullyStatic` returns false for a non-empty `observedAttributes`, because §16.5 promises that every later change and removal applies and only the module can hear one; declaring the list is declaring a runtime interface, and the cost falls only on components that did. The alternative (prerender-only, no script) needs a §16.5 carve-out for built sites.
- **Open:** does `onMount` run on every insertion or only the first (correction 4)? Recommendation: every insertion, in both tiers, paired with `onUnmount` on every removal: the compiled element re-renders its children on each connection, so a sidecar that wires up rendered nodes must run again, and an unbalanced pair is what a sidecar cannot clean up after. The interpreter's `_jxInitialized` early return queues `onMount(state, this)` again when `this._state` exists (a re-connection during the first `await` has no state yet and is covered by the first call). §16.4's table says "inserted"; the change is a behaviour change for moved interpreted elements, in Studio's canvas too, which is why it is open.
- **Open:** which arguments does a document mounted through `mount()` pass to `onMount`? §16.4 says "the same two hooks" without naming them. Recommendation: state what ships and change no code: `onMount(state)` alone, synchronously once the root is appended, and `onUnmount(state)` from `dispose()`, because `embedding.md` §2 (Implemented) specifies that sequence and a mounted document has no element of its own that is the component.

## Implementation

**Slice CEL1.1: the runtime export and the element module**

1. `packages/runtime/src/runtime.ts`: export `absorbAttribute` and `declaredDefaults` (JSDoc gains "exported for the compiler, which inlines the rule; `compile-element.test.ts` proves the copy agrees"). In `declaredDefaults`, add the `hasSchemaKeywords` branch after the computed-marker check (the module-level `hasSchemaKeywords` near `buildScope` already exists). If the insertion Open resolves as recommended, the `if (this._jxInitialized)` early return in the element class queues `onMount(this._state, this)` when `this._state` is set.
2. `packages/compiler/src/shared.ts`: add `OBSERVED_ATTR_HELPER = "__jxAbsorbAttr"` and `observedAttrHelperSource()`, returning one function declaration that restates `absorbAttribute` line for line (kebab-to-camel key, boolean presence with `"false"` absent, `null` → `defaults.get(key)` else `0`/`""` by the current value's type, `Number()` for a number, the string otherwise). Import `absorbAttribute` and `declaredDefaults` from `@jxsuite/runtime` beside `enumeratedAttrNames` for the build-time uses below.
3. `emitElementModule` in `compile-element.ts`, when `doc.observedAttributes` is a non-empty array:
   - after `attrHelperSource()`, push `observedAttrHelperSource()`, `const __jxObserved = <JSON list>;` and `const __jxObservedDefaults = new Map(<JSON pairs>);`, the pairs being `declaredDefaults(doc)` filtered to the camel-cased observed names;
   - in the class, `#jxAttrsRead = false;` and `static get observedAttributes() { return __jxObserved; }`;
   - first in `connectedCallback`: `if (!this.#jxAttrsRead) { this.#jxAttrsRead = true; for (const _a of __jxObserved) { if (this.hasAttribute(_a)) __jxAbsorbAttr(this.state, _a, this.getAttribute(_a)); } }`;
   - after `disconnectedCallback`: `attributeChangedCallback(name, oldVal, newVal) { if (oldVal === newVal) return; __jxAbsorbAttr(this.state, name, newVal, __jxObservedDefaults); }`.
4. Same function, lifecycle: the `onMount` call becomes `this.state.onMount(this.state, this)`; when `defs` declares `onAdopted`, emit `adoptedCallback() { if (typeof this.state.onAdopted === 'function') { this.state.onAdopted(this.state); } }`; in the `$src` branch where `args[0] === "state"`, a key of `onMount` with `args.length === 1` emits `(state, host) => onMount(state, host)`.
5. Spec and docs edits for this slice (below), and the §16.5 marker rewritten to the slice-2 remainder.

**Slice CEL1.2: the built site**

1. `isComponentFullyStatic` in `shared.ts`: return false when `doc.observedAttributes` is a non-empty array, ahead of `_isStaticNode` (the recursive walk stays as is: only a root declares the list). Subject to the first Open.
2. `shared.ts`: add `observedAttributeProps(def, attributes, scope): Record<string, JsonValue> | null` per the prerender decision: for each name in `def.observedAttributes`, read `attributes[name]`, `resolveStaticValue` it against `scope`, skip it when unresolved, convert a boolean with `booleanAttrValue` (skip on `null`) and anything else with `String`, run `absorbAttribute` on a scratch `buildInstanceScope(def, null)`, and return the camel-cased results.
3. `renderComponentInstance` (`shared.ts`): after `liftPropsAttributes`, `const scopeProps = { ...observedAttributeProps(def, attributes, scope), ...props }`; the frame key and `buildInstanceScope` read `scopeProps`; `data-jx-props` still writes `props` only.
4. `expandComponents` (`site-build.ts`): the same merge from `node.attributes` (the page walk has already resolved templates, so the scope is `{}`), feeding `preRenderComponentHtml`, `resolveHostStyle`'s scope and the context's first frame, with `data-jx-props` from `node.$props` alone.
5. Spec and docs edits for this slice (below).

**Integration contract.** Once CEL1.1 lands: `@jxsuite/runtime` exports `absorbAttribute(state, name, value, defaults?)` and `declaredDefaults(def)`, the one §16.5 rule; `shared.ts` exports `OBSERVED_ATTR_HELPER` and `observedAttrHelperSource()`, and a plan inlining another runtime rule (the prop bridge's `instanceSupplies`) adds its own `*HelperSource()` beside them with its own drift test. In the emitted `connectedCallback` the observed-attribute read is the first statement; code another plan adds goes after it, and the property merge stays after `data-jx-props` and `props.*`. `onMount` receives `(state, host)` in both tiers; `adoptedCallback` exists exactly when `onAdopted` is declared. Once CEL1.2 lands: `isComponentFullyStatic` is false for any definition declaring observed attributes, and both prerender paths read them beneath `$props`.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime` and from `packages/compiler`. No new source file, so the manifest check sees nothing new; both workspaces keep their per-file `coverageThreshold` (runtime `lines = 0.963, functions = 0.98`; compiler `lines = 0.982, functions = 0.98`), ratcheted if the worst file rises.

CEL1.1, `packages/runtime`:

- `connect-attributes.test.ts`: "absorbAttribute is exported and coerces as the element does" (boolean, number, string, removal with and without a default); "a pure type definition declares no default, so removing its attribute falls back by type" (`{ "type": "number" }`: state is `""` after removal, never the schema object); "declaredDefaults mirrors buildScope's shapes" (default, computed, pure type, plain object, shorthand).
- `custom-elements.test.ts` (if the insertion Open is taken): "a moved element runs onUnmount then onMount again, with the host".

CEL1.1, `packages/compiler`:

- `compile-element.test.ts`: "onMount receives the host" (`this.state.onMount(this.state, this)`); the existing "a bodyless $src lifecycle hook stays callable" updated to `(state, host) => onMount(state, host)`; "adoptedCallback is emitted only when onAdopted is declared"; "a document without observedAttributes compiles to no observed machinery" (no `__jxAbsorbAttr`, `observedAttributes` or `attributeChangedCallback` in the text); "the static getter lists the declared names"; "the defaults literal equals declaredDefaults for the observed keys" (drift guard, data half); "the inlined attribute rule agrees with absorbAttribute" (drift guard, logic half: write `observedAttrHelperSource()` plus an `export` to a temp module under `tests/`, import it once, and compare the resulting state for every row of a matrix of current type × value `""`/`"false"`/`"3"`/`"x"`/`null` × default present/absent, plus a key the state lacks).
- `compile-element-render.test.ts`, a new `describe("compiled element — lifecycle and observed attributes")` on a definition with `observedAttributes: ["username", "count", "active"]`, `state: { username: "Guest", count: { type: "number", default: 1 }, active: false, onMount: { $prototype: "Function", parameters: ["state", "host"], body: … }, onAdopted: { $prototype: "Function", body: … } }`: "onMount receives the element as its second argument"; "onAdopted runs from adoptedCallback" (called directly, correction 6); "an observed attribute present at insertion renders" (`username="Ada"`); "an element upgraded after insertion reads its attributes" (a second tag, written into the body before its module is imported); "a later change coerces" (`count` to the number `4`, `active="false"` to `false`); "a removal restores the declared default" (`count` back to `1`); "a property set before connection beats the attribute"; "re-insertion does not re-read an attribute over a state change". Temp modules stay under `tests/`, which `coveragePathIgnorePatterns` excludes.

CEL1.2, `packages/compiler`:

- `shared.test.ts`, `describe("isComponentFullyStatic")`: "a definition declaring observedAttributes is not static".
- `prerender-nested-components.test.ts`: "a nested instance's observed attribute prerenders coerced"; "$props beats an observed attribute"; "an observed attribute stays out of data-jx-props"; "an instance distinguished only by an observed attribute is not refused as a self-render".
- `site-build-nested-components.test.ts`: "a page instance's observed attribute is in the prerender and its module loads" (a definition with only `observedAttributes` and a text binding: the HTML carries `Ada`, `data-jx-prerendered`, and the component's module script).

## Specs & docs

CEL1.1:

- `compiler.md` §4.1: delete the Partial marker. Replace the "Lifecycle conformance" paragraph with: "Lifecycle conformance (spec.md §16.4, §16.5): `connectedCallback` reads each observed attribute already present on the first connection, before the `$props`/property merge, and invokes `state.onMount(state, host)` on a microtask after each render; `disconnectedCallback` invokes `state.onUnmount(state)`; `adoptedCallback`, emitted when `state` declares `onAdopted`, invokes `state.onAdopted(state)`; and a definition with `observedAttributes` gets `static get observedAttributes()` and an `attributeChangedCallback` that applies spec.md §16.5's coercion and default restoration through an inlined copy of the runtime's rule (§11). The same contract as the runtime's interpreted elements." (Drop "after each render" to "after the first render" if the insertion Open goes the other way.)
- `compiler.md` §11: add `### observedAttrHelperSource() — the observed-attribute rule, inlined for a generated module`, one paragraph mirroring the `attrHelperSource()` entry (the rule is `absorbAttribute`'s, the defaults are `declaredDefaults`' output, and two tests prove the copy agrees). The §11 marker is not touched.
- `spec.md` §16.4: marker → `> **Status: Implemented.**`. Table cells, if the insertion Open is taken: `onMount` "Each time the element is inserted into the DOM, after it renders", `onUnmount` "Each time the element is removed from the DOM". "The other three hooks take `(state)`" → "`onUnmount` and `onAdopted` take `(state)`." The `mount()` paragraph names the arguments: "`onMount(state)` once its root is attached, with no host argument, and `onUnmount(state)` from `dispose()`" (per the third Open).
- `spec.md` §16.5: the sentence on entries with no declared default gains the pure type definition: "An entry with no declared default, a pure type definition such as `{ "type": "number" }` or a key the definition does not declare, falls back by the type of the value it holds: `0` for a number, the empty string otherwise, never null." The marker is rewritten to the remainder: "> **Status: Partial.** The interpreter and the compiled element module implement the section, from one rule (`absorbAttribute` and `declaredDefaults` in `packages/runtime/src/runtime.ts`). A built site does not: `isComponentFullyStatic` (`packages/compiler/src/shared.ts`) treats a definition whose only runtime surface is `observedAttributes` as static, so its module never loads, and the prerender ignores observed attributes, so the first paint shows the default."
- Fragments: `bun run spec:change compiler.md minor -m "A compiled element passes the host to onMount, runs onAdopted from adoptedCallback, and observes its declared attributes through an inlined copy of the runtime's rule"` and `bun run spec:change spec.md minor -m "Compiled elements run every lifecycle hook, onMount runs on each insertion, a mounted document's onMount takes the scope alone, and a pure type definition has no declared default"` (trim the clauses of an Open that went the other way).
- Docs: `docs/framework/concepts/components.md` (its `code:` lists `compile-element.ts` and `runtime.ts`) gains a short "Lifecycle hooks" paragraph under "Custom elements": `onMount` receives the scope and the element, `onUnmount` and `onAdopted` the scope, when each runs, and that a built site behaves the same; `spec.md#16.4` is added to its `spec:` list. No other page changes: `props-and-scope.md` already states §16.5 without a tier, and `runtime-host.md` does not describe `mount()`'s `onMount` arguments.

CEL1.2:

- `spec.md` §16.5: marker → `> **Status: Implemented.**`, and one paragraph after the removal paragraph: "A built site applies the same rule twice. The prerender reads each observed attribute an instance writes, beneath its `$props`, so the first paint already shows it; and a definition that declares `observedAttributes` is never compiled as fully static, so its module ships and hears every later change."
- Fragment: `bun run spec:change spec.md minor -m "A built site honours observed attributes: the prerender reads them beneath the instance's props, and a definition that declares any ships its module"`.
- Docs: `docs/framework/concepts/props-and-scope.md` ("Attribute props") gains: "A built site does the same: the prerendered page already shows the attribute's value, and a component that declares `observedAttributes` ships its script so a later change is heard." Add `packages/compiler/src/shared.ts` to its `code:`. `docs/framework/build.md`, "Why is my page shipping JavaScript?", gains a bullet: "**A component that declares `observedAttributes`** ships its module, because an attribute can change after the page loads." No em dashes in either.

Neither slice graduates a spec: `spec.md` and `compiler.md` keep other open items.

## Acceptance

- `cd packages/runtime && bun test --isolate --coverage` and `cd packages/compiler && bun test --isolate --coverage` pass at their thresholds; `bun scripts/check-coverage-manifest.ts packages/runtime` and `… packages/compiler` pass.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` pass; after CEL1.2, `bun run plans:status --spec spec` lists neither §16.4 nor §16.5 and `bun run plans:status --spec compiler` does not list §4.1.
- Observable: `jx build` on a scratch site whose page writes `{ "tagName": "user-card", "attributes": { "username": "Ada" } }` for a definition with `observedAttributes: ["username"]` and no handlers produces HTML containing `Ada` inside `user-card` and a module script for it; in a browser, `setAttribute("username", "Grace")` re-renders and `removeAttribute("username")` restores the default.

## Slices

| Slice  | Scope                                                                                                              | Claims                        | State |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----- |
| CEL1.1 | Runtime exports and `declaredDefaults` fix; emitted `onMount(state, host)`, `adoptedCallback`, observed attributes | compiler.md#4.1, spec.md#16.4 | open  |
| CEL1.2 | Static classification and prerender absorption of observed attributes                                              | spec.md#16.5                  | open  |
