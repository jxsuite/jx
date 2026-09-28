---
status: drafted
disposition: reconcile
claims:
  - compiler.md#4.3
requires: []
workspaces:
  - packages/compiler
size: S
---

# The element-compilation example, binding table and WHATWG HTML note show what the emitter writes

## Context

`specs/compiler.md` §4.3, line 179 (unmarked before the census; its first pass called the drift editorial, which the Partial marker on §11's signature drift contradicted):

> **Status: Partial.** Two rows do not match what `packages/compiler/src/targets/compile-element.ts` emits: a template-valued `hidden` is bound as the property `.hidden=${…}`, and the element target emits no `?attr` binding at all (a bound entry under `attributes` goes through the inlined boolean-attribute helper, §11); and an event reference is bound as `@click=${(e) => s.fn(s, e)}`, passing the event. The ref lowering described below ships as written.

Verified by a scratch compile of the §4.2 input and of one element per table row, against `emitLitNode` in `compile-element.ts`:

- `"onclick": { "$ref": "#/state/fn" }` emits `@click="${(e) => s.fn(s, e)}"` (quoted; the marker drops the quotes), and inside a map body `@click="${(e) => { s.$map = $map; s.fn(s, e); }}"`. The table says `@click="${() => s.fn(s)}"`.
- A top-level `"hidden": "${state.loading}"` goes through the top-level key loop and emits `.hidden="${s.loading}"`. The table says `?hidden=`. No `?name=` binding exists anywhere in `packages/compiler/src/targets/`.
- Under `attributes`, a whole `${…}` or a `$ref` emits `name="${__jxAttrText('name', …) ?? nothing}"` (`ATTR_HELPER` and `attrHelperSource()` in `packages/compiler/src/shared.ts`); a template with surrounding text binds bare; a literal boolean is decided at build time by `booleanAttrValue` (`open`, `aria-hidden="false"`, or no attribute). The table has no `attributes` row.
- The other four rows (`${s.name}`, `.items="${s.items}"`, `class="${s.cls}"`, `style="color: ${s.c}"` from `emitStyleString`) match.

The emitted forms are deliberate, so the disposition is `reconcile`: a handler receives the event because `spec.md` §4.3 and §5.3 4d bind handler parameters by name over `(state, event)`; a top-level key is a DOM property (`spec.md` §8.1), which the runtime writes as `el[key]` (`bindProperty` in `packages/runtime/src/runtime.ts`); and a bound attribute goes through the helper so that the static, element and client targets and the runtime decide boolean attributes one way (`spec.md` §8.3).

**Ride-alongs, editorial** (the audit record's rule: a worked example and an informative note travel with the owner of the section they illustrate):

- §4.2's example output predates the emitter in more ways than the stub listed. The emitter imports `nothing` and inlines `__jxEnumAttrs`/`__jxAttrText`; it assigns functions before computeds and wraps a template-string computed in a template literal; the handler call passes `e`; `connectedCallback` reads `data-jx-props`, then `props.*`, then own properties (`hasOwnProperty`, not the `key in this` the example shows), removes `data-jx-prerendered`, calls `replaceChildren()`, registers the render effect and queues a guarded `onMount`; `disconnectedCallback` calls a guarded `onUnmount`. The static `style` never appears in the module: it goes to the component stylesheet (§8.2).
- §13's WHATWG HTML Note says "no shadow root is ever attached" and that Declarative Shadow DOM and `ElementInternals` are unavailable. Opt-in `$shadow` attaches or adopts one: `resolveShadowMode` in `packages/compiler/src/shadow.ts`, `#renderRoot` in `compile-element.ts` (`this.shadowRoot` for open, `this.attachInternals().shadowRoot` for closed), `<template shadowrootmode>` from `shared.ts` and `site-build.ts`, pinned by `packages/compiler/tests/shadow-dom.test.ts`. `spec.md` §18's WHATWG HTML row already states this.
- §4.8's trailing marker names `compile-element.js`; the file is `compile-element.ts`.

**Tests that already pin the forms, one each**: `packages/compiler/tests/compile-element.test.ts` ("declared handler parameters", "$map context for map handlers", "boolean attributes (spec.md §8.3)", `.items`, inline `style`), and `element-idl-props.test.ts` (literal and bound IDL properties). Nothing ties them to §4.3, which is how the table drifted while every emitter change updated its test.

**Found while detailing, not this plan's** (reported for routing, no edit here):

- `inlineHandlerBody` in `compile-element.ts` wraps an inline `on*` Function with declared parameters as `((…declared) => { body })(…)`, and when `state` is not declared (`"arguments": ["event"]`) the body's `state.` is left unbound inside `template()`, where only `s` exists: `((event) => { state.n = event.detail })(e)` throws `ReferenceError` on the first event. `spec.md` §5.3 4d says a body may read `state` whether or not it declared it. `plan:spec/function-entry-tier-parity` now carries it (its `inlineHandlerBody` row and Implementation step 5).
- `compiler.md` §4.1's list item 5 ("Static CSS extracted to a `<style>` block") does not hold: the module carries no CSS, and the sheet is `dist/components/<tag>.css`, inlined by each page (§8.2, `site-architecture.md` §12.4). §4.1 belongs to `plan:_shared/compiled-element-lifecycle`.
- `compiler.md` §2.2 names the targets `compile-element.js`, `compile-static.js` and `compile-client.js`; all three are `.ts`. §2.2 belongs to `plan:compiler/client-template-text-children`.

## Outcome

- `compiler.md` §4.3 → marker removed (unmarked, as §4.5 to §4.7 are). The table and the prose after it state the emitted forms and where a boolean attribute is decided.
- Editorial, no status change: §4.2's output is the emitter's, abridged: the code §4.1 and §4.4 own is elided to comments inside the callbacks and left out elsewhere; §13's WHATWG HTML Note states the light default and the `$shadow` opt-in; §4.8's marker names `compile-element.ts`.
- `compiler.md` stays `Partial` (§2, §2.2, §3, §4.1, §4.4 and others remain open), so nothing graduates.

## Decisions

- **Decided:** `reconcile`, not `implement`, because each emitted form is the one the rest of the contract requires. `() => s.fn(s)` would break `spec.md` §5.3 4d's by-name binding of `event`; `?hidden=` would bind an attribute where the interpreter writes the `hidden` property; and lit's `?name=` applies the presence family to every name, so `?aria-expanded=${true}` writes the empty value `spec.md` §8.3 reads as unset.
- **Decided:** §4.2 shows the emitter's constructor, template and render registration verbatim (formatted) and elides the props intake and the lifecycle-hook calls to comments citing §4.4 and §4.1, because three other plans rewrite exactly those lines (`plan:_shared/compiled-prop-bridge` the merge, `plan:_shared/compiled-element-lifecycle` the `onMount` call and `adoptedCallback`, `plan:spec/compiled-host-handlers` host listeners). A verbatim copy would make each of them a §4.2 editor or give this plan three `requires` edges; the sections that own the code state it once. The lead-in calls the example abridged because those plans also add code outside the callbacks, which no comment marks: the prop bridge an always-emitted `__jxProps` list at module level and a first-connection class field, the lifecycle plan its observed-attribute helper and flag. Verified against both plans' Implementation: neither changes a line §4.2 shows, so the edge the cross-spec review proposed from this plan to them is not drawn. The two comments stay true after the lifecycle plan: the `onMount` one says "after rendering", which holds under either answer to its insertion Open (§4.1 then reads "after each render" or "after the first render"), and the props one names no observed-attribute read because that read is emitted only when `observedAttributes` is declared, which §4.2's input does not.
- **Decided:** `requires: []`. The connectedCallback plans are unordered with this one by the elision above, and `plan:_shared/compiled-prop-bridge`'s conditional §4.2 step becomes a no-op. `plan:spec/shadow-dom-parity` is not a prerequisite either: compiler.md §13 binds compiled output, which ships `$shadow` today, and its counterpart, `spec.md` §18's WHATWG HTML row, is already correct. The edge runs the other way: that plan requires this one, because it adds `defaults.shadow` to the §13 Note this plan rewrites.
- **Decided:** §13's Note describes compiled output and leaves `defaults.shadow` out, because `site-build.ts` does not pass `defaults` to `compileElement` (`spec.md` §16.6's marker), so a project default reaches the prerender but not the module, and a Standards Alignment note is a present-tense claim. `plan:spec/shadow-dom-parity` may add it when it fixes that call.
- **Decided:** add one `describe` named for compiler.md §4.3 that compiles every table row and the §4.2 input, because the forms are already tested one by one and the drift came from nothing naming the section; the next change to an emitted form then fails a test that says which spec text to update.
- **Open:** does this plan also correct `spec.md` §18's WHATWG DOM Note ("Shadow trees are not used at all (§16.6)"), which `plan:spec/shadow-dom-parity` owns through an editorial paragraph in its Context? Recommendation: yes, move it here, because that owner is an `L` plan behind `plan:spec/compiled-slot-distribution`, so the stale sentence would outlive this correction by several pull requests while the two counterpart notes disagree, and the fix is one cell that needs none of that plan's code (compiled output uses shadow trees today, and the interpreter ignoring `$shadow` does not make "only on opt-in" false). The cost is a `spec.md` patch fragment here and three small edits to `plan:spec/shadow-dom-parity` in the same pull request (Implementation step 4).

## Implementation

1. **`specs/compiler.md` §4.3.** Delete the marker line. Replace the table with the one in Specs & docs, keep "The `.property` syntax is the key enabler…", and insert the two paragraphs given there after it. The three ref-lowering paragraphs stay as they are (the audit verified them).
2. **`specs/compiler.md` §4.2.** Keep the input. Replace the output block and its lead-in, and add the closing sentences, as given in Specs & docs.
3. **`specs/compiler.md` §4.8 and §13.** The marker filename and the WHATWG HTML row, as given.
4. **If the Open is accepted:** `specs/spec.md` §18's WHATWG DOM Note, as given. In `plans/spec/shadow-dom-parity.md`, as that plan's Context asks: delete its "Editorial, owned here unless it moves" paragraph, the WHATWG DOM sentence at the end of its `spec.md` §18 Specs & docs bullet, and the "otherwise in slice SDP1.4" clause of its first Decided item. Its numbered items 1 to 7 are unrelated and stay.
5. **`packages/compiler/tests/compile-element.test.ts`.** Add the `describe` in Tests after "boolean attributes (spec.md §8.3)". It uses `compileElement` from `../src/compiler`, already imported; no helper or fixture file is needed.
6. Run `bunx oxfmt specs/compiler.md` (and `specs/spec.md` if touched): the table and code block are formatter-owned.
7. **Plan housekeeping in the landing pull request.** Delete this file, then reword every hit of `grep -rn 'plan:compiler/element-binding-table' plans/` or `plans:check` reports `citation-unknown` and a dangling edge. At detailing time those are: `plans/spec/shadow-dom-parity.md` (drop the `requires` entry; its §13 Note bullet now edits the Note as this plan left it in compiler.md, and its Context and first Decided item stop naming this plan); `plans/_shared/compiled-prop-bridge.md` (drop the Related bullet on §4.2 and the "`compiler.md` §4.2" Specs & docs bullet, since §4.2 no longer restates the merge); `plans/spec/static-style-rules-only.md` (its Related bullet and its §4.3 style-row step name the section, not this plan); `plans/spec/compiled-host-handlers.md` (its `requires: []` reasoning names §4.2's elision and §4.3's paragraph order as facts of the spec); `plans/spec/function-entry-tier-parity.md` (its note on the §4.3 handler sentence names the sentence as it now reads in compiler.md); and `plans/compiler/README.md` (the two §13 bullets under "Dispositioned without a plan" say the Note was corrected with §4.3's reconcile).

**Integration contract.** `plan:spec/shadow-dom-parity` requires this plan: it adds `defaults.shadow` to the §13 WHATWG HTML Note as written here ("A component may opt into a shadow root with `$shadow` (spec.md §16.6)" is the phrase it extends). Once this lands: §4.2 restates no props intake and no lifecycle call, and its lead-in covers any module-level constant, helper or class field that code adds, so a plan changing those edits §4.1 or §4.4 alone, unless it changes a line §4.2 shows (the render registration, `replaceChildren()`, the `data-jx-prerendered` removal, the effect teardown, or a binding in `template()`), which the §4.2 test pins. §4.3 is the one table of the element target's binding forms, and a plan that changes a form updates its row and the "binding table" test together: `plan:spec/static-style-rules-only` does so for the style row. The new "A handler receives the event" paragraph's "a handler's declared parameters bind by name" is the sentence `plan:spec/function-entry-tier-parity` narrows for a `$src` handler, whichever lands second; `plan:spec/compiled-host-handlers` appends its paragraph after the ref-lowering paragraphs, which this plan leaves last. §13's WHATWG HTML Note claims the light default and the `$shadow` opt-in for compiled output only.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`. No source file changes and none is added, so per-file coverage is unchanged (`coverageThreshold = { lines = 0.982, functions = 0.98 }` in `packages/compiler/bunfig.toml`); no ratchet is expected.

New `describe("compileElement — the binding table (compiler.md §4.3)")` in `packages/compiler/tests/compile-element.test.ts`. One fixture, `test-binding-table`, with `state: { name: "n", fn: { $prototype: "Function", body: "state.n++" }, items: [], loading: false, cls: "c", c: "red", open: false, n: 0 }` and one child per row: a `p` with `textContent: "${state.name}"`; a `button` with `onclick: { $ref: "#/state/fn" }`; an `x-list` with `$props: { items: { $ref: "#/state/items" } }`; a `div` with `hidden: "${state.loading}"`; a `div` with `className: "${state.cls}"`; a `div` with `style: { color: "${state.c}" }`; a `details` with `attributes: { "aria-expanded": "${state.open}", hidden: "${state.loading}" }`.

- "every row compiles to the lit-html form the table shows": the module contains `>${s.name}</p>`, `@click="${(e) => s.fn(s, e)}"`, `.items="${s.items}"`, `.hidden="${s.loading}"`, `class="${s.cls}"`, `style="color: ${s.c}"` and `aria-expanded="${__jxAttrText('aria-expanded', s.open) ?? nothing}"`.
- "a boolean is decided by the property or by the helper, never by a lit boolean binding": the module contains both `.hidden="${s.loading}"` and `hidden="${__jxAttrText('hidden', s.loading) ?? nothing}"`, and does not match `/\s\?[a-z][\w-]*=/` (which `?? nothing` cannot match).
- "the worked example (compiler.md §4.2) emits what the section shows": compile §4.2's `user-card` input verbatim. The module contains `import { render, html, nothing } from 'lit-html';`, `this.state.setAway = (state) => {`, ``this.state.displayStatus = computed(() => `${this.state.status === 'online' ? 'Available' : 'Away'}`);``, `>${s.username}</h3>`, `@click="${(e) => s.setAway(s, e)}"`, `this.removeAttribute('data-jx-prerendered');`, `this.replaceChildren();`, `this.#effects.push(effect(() => render(this.template(), this)));`, `for (const _e of this.#effects) { stop(_e); }` and `customElements.define('user-card', UserCard);`; `setAway`'s index is below `displayStatus`'s; and it contains neither `padding` nor `display: block`.

## Specs & docs

**`compiler.md` §4.3**: delete the Partial marker; the table becomes:

```markdown
| Jx                                                   | lit-html                                                              | What it does                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `"textContent": "${state.name}"`                     | `${s.name}`                                                           | Reactive text                                                             |
| `"onclick": { "$ref": "#/state/fn" }`                | `@click="${(e) => s.fn(s, e)}"`                                       | Event listener, called with `(state, event)` (spec.md §5.3 4d)            |
| `"$props": { "items": { "$ref": "..." } }`           | `.items="${s.items}"`                                                 | JS property (by reference)                                                |
| `"hidden": "${state.loading}"`                       | `.hidden="${s.loading}"`                                              | DOM property (spec.md §8.1), which the element reflects                   |
| `"className": "${state.cls}"`                        | `class="${s.cls}"`                                                    | Attribute binding                                                         |
| `"style": { "color": "${state.c}" }`                 | `style="color: ${s.c}"`                                               | Inline style                                                              |
| `"attributes": { "aria-expanded": "${state.open}" }` | `aria-expanded="${__jxAttrText('aria-expanded', s.open) ?? nothing}"` | Attribute; a boolean takes spec.md §8.3's spelling, and `null` removes it |
```

After "The `.property` syntax is the key enabler for the property-first interface.", insert:

> **No `?name=` binding is emitted; a boolean is decided in one of three places.** A top-level key is a DOM property (spec.md §8.1), so `.hidden=` hands the value to the element's own setter, which adds or removes the reflected attribute exactly as the runtime's property write does. A whole `${…}` or a `$ref` under `attributes` goes through `__jxAttrText`, the boolean-attribute rule every generated module carries (`attrHelperSource()`, §11): it spells a boolean by the family spec.md §8.3 assigns the name and returns `null` for absence, which `?? nothing` turns into removal. A literal boolean under `attributes` is decided at build time by the same rule, so `"open": true` emits a bare `open`, `"aria-hidden": false` emits `aria-hidden="false"`, and `"hidden": false` emits nothing. A template with text around its expression (`"page ${state.n}"`) is a string by construction and binds without the helper. lit's `?name=` would apply the presence family to every name and write an empty `aria-expanded` for `true`, which spec.md §8.3 reads as unset.
>
> **A handler receives the event.** Every `on*` call site passes `(state, event)`, and a handler's declared parameters bind by name (spec.md §5.3 4d), so a `$ref` handler is called as `s.fn(s, e)`; inside a map body the call is preceded by `s.$map = $map;` (§4.7). An inline Function body or an `$expression` on `on*` is compiled into the arrow's body rather than called.

**`compiler.md` §4.2**: the lead-in becomes "**Output** (`user-card.js`, formatted and abridged: the comments stand for code §4.1, §4.4 and §11 specify, and constants, helpers and class fields that code adds outside the callbacks are left out):", the block becomes the following, and one paragraph follows it: "The static `style` is not in the module: it goes to the component's stylesheet, which every page using the component inlines (§8.2). `setAway` declares no parameters and is still called with the event (§4.3)."

```js
import { reactive, computed, effect, stop } from "@vue/reactivity";
import { render, html, nothing } from "lit-html";
// __jxEnumAttrs and __jxAttrText: the boolean-attribute rule (§11)

class UserCard extends HTMLElement {
  #effects = [];

  constructor() {
    super();
    this.state = reactive({
      username: "Guest",
      status: "online",
    });

    this.state.setAway = (state) => {
      state.status = "away";
    };

    this.state.displayStatus = computed(
      () => `${this.state.status === "online" ? "Available" : "Away"}`,
    );
  }

  template() {
    const s = this.state;
    return html`
      <h3>${s.username}</h3>
      <button @click="${(e) => s.setAway(s, e)}">Set Away</button>
    `;
  }

  connectedCallback() {
    // Props: data-jx-props, then props.* attributes, then properties (§4.4)
    if (this.hasAttribute("data-jx-prerendered")) {
      this.removeAttribute("data-jx-prerendered");
    }
    this.replaceChildren();
    this.#effects.push(effect(() => render(this.template(), this)));
    // onMount, on a microtask after rendering (§4.1)
  }

  disconnectedCallback() {
    for (const _e of this.#effects) {
      stop(_e);
    }
    this.#effects.length = 0;
    // onUnmount (§4.1)
  }
}

customElements.define("user-card", UserCard);
```

**`compiler.md` §4.8**: in the trailing marker, `compile-element.js` becomes `compile-element.ts`.

**`compiler.md` §13**, WHATWG HTML row. Evidence becomes `packages/compiler/src/targets/compile-element.ts, packages/compiler/src/shadow.ts, packages/compiler/tests/shadow-dom.test.ts` (all exist; `docs:standards` checks). Note becomes: "Custom elements are defined and rendered into the **light** DOM by default, where `<slot>` is emulated by splicing saved children. A component may opt into a shadow root with `$shadow` (spec.md §16.6): the prerender emits a declarative `<template shadowrootmode>` and the element module adopts it, an `open` root through `element.shadowRoot` and a `closed` one through `ElementInternals`. Not offered: `ElementInternals` for form association, and `::part` addressed from outside a component." Class stays **Subset**; Binds stays §3, §4.

**`spec.md` §18, only if the Open is accepted**, WHATWG DOM row Note: "Custom elements are defined and `dispatchEvent` emits a real `CustomEvent`. Shadow trees are used only by a component that opts in with `$shadow` (§16.6); light DOM is the default."

**Fragments** (no `$` in a sentence: the shell would expand it):

- `bun run spec:change compiler.md minor -m "The element binding table shows the emitted forms: an event handler receives the event, a top-level key such as hidden binds as a DOM property, and a bound attribute goes through the inlined boolean-attribute rule rather than a lit boolean binding; the worked example and the WHATWG HTML note match compiled output"`
- only if the Open is accepted: `bun run spec:change spec.md patch -m "The WHATWG DOM standards note says a component uses a shadow tree only when it opts in, not never"`

**Docs**: none changes. No page's `spec:` cites `compiler.md#4.2`, `#4.3` or `#13` (`docs/framework/build.md` cites `#4.1`), and the plan changes no file any page's `code:` lists (`functions.md`, `lists.md` and `components.md` list `compile-element.ts`, which is untouched). The generated `docs/extending/reference/standards.md` picks up the §13 row on its next generation; it is gitignored.

No spec graduates.

## Acceptance

- `grep -nE '\?hidden|\(\) => s\.(fn|setAway)\(s\)|no shadow root is ever attached|Implemented\.\*\* .compile-element\.js' specs/compiler.md` prints nothing (§2.2's own `compile-element.js` mention belongs to that section's owner).
- `bun run plans:status --who-claims compiler.md#4.3` finds no open item; `bun run plans:check` reports no `citation-unknown` for this plan's id.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:standards`, `bun run docs:check` and `bun run docs:links` pass.
- `cd packages/compiler && bun test --isolate --coverage` passes with the three new cases, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- A reviewer compiling §4.2's input (`compileElement` on the object) sees every non-comment line of the new example in the module, modulo formatting.
