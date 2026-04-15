# Plan: Custom Elements Spec for Jx

## Summary

Add a comprehensive Custom Elements section to the main Jx spec (`spec/spec.md`) and create a dedicated spec amendment (`spec/jx-custom-elements-spec.md`) that defines:

1. How custom elements are **declared** in Jx JSON
2. How the **compiler** emits them as raw `HTMLElement` controllers using `@vue/reactivity` + `lit-html`
3. How the **runtime** registers and manages them in dev mode
4. Full lifecycle, slot support, attribute observation, and scope isolation

## Context

- DDOM had full custom element support via `define(elements)` in `lib/src/dom/custom-elements.ts` — shadow/light DOM, AbortController cleanup, ComponentSignalWatcher, slot distribution, all lifecycle callbacks
- Jx spec currently has only a passing mention in §19.4 ("tagName values containing a hyphen are registered as autonomous custom elements") and §13.3 (scope isolation at custom element level) — but no actual definition mechanism, no registration API, no compiler output, no lifecycle mapping
- The runtime creates elements with `document.createElement()` and has no `customElements.define()` path
- The compiler has no awareness of custom element definitions

## Changes

### 1. `spec/spec.md` — Main Spec Updates

**A. Update Table of Contents** — Add new section 20 "Custom Element Definitions"

**B. Add §20 "Custom Element Definitions"** with subsections:

- **§20.1 Definition Syntax** — A Jx component file whose root `tagName` contains a hyphen is a custom element definition. The file's `$defs` declare reactive state, its `children` tree is the template, and its event bindings are the behavior. No new keywords needed — the existing Jx vocabulary suffices.

- **§20.2 Registration** — Two paths:
  - **Compiler**: emits a `class extends HTMLElement` + `customElements.define()` call per element
  - **Runtime**: `defineElement(source)` API registers a custom element from a Jx document or URL

- **§20.3 Lifecycle Mapping** — How Jx maps to the Custom Elements spec:
  - `constructor` → `$defs` initialization (reactive state setup)
  - `connectedCallback` → render template into light DOM via `effect()`; call `$defs.onMount` if declared
  - `disconnectedCallback` → dispose effects, call `$defs.onUnmount` if declared
  - `adoptedCallback` → call `$defs.onAdopted` if declared
  - `attributeChangedCallback` → sync attribute values into `$defs` signals

- **§20.4 Observed Attributes** — A new optional top-level `observedAttributes` array on the component definition. Entries are attribute names (kebab-case). When an observed attribute changes, the runtime writes the new value to the matching `$defs` signal (kebab→camelCase conversion).

- **§20.5 Light DOM Rendering** — Jx custom elements render to light DOM by default (no Shadow DOM). The `children` tree is rendered directly into `this` (the host element). This matches the compilation target pattern shown by the user.

- **§20.6 Slot Support** — Default and named slots using `<slot>` elements in the template tree. Light DOM slot distribution follows the same algorithm as DDOM: capture children before clearing, match by `slot` attribute, distribute or keep fallback content.

- **§20.7 Scope Isolation** — Reaffirm §13.3: signal scope is bounded at the custom element level. Each custom element instance gets its own `reactive()` state. Parent signals do not propagate into children; use `$props` for cross-boundary data flow.

- **§20.8 Cleanup** — Each instance maintains an AbortController. `disconnectedCallback` aborts all effects and cleans up subscriptions.

**C. Update §16.2 "Output Tiers"** — Add a row for custom element definitions:
  - Custom element definition → `class extends HTMLElement` + `customElements.define()` + lit-html template

**D. Update §17 "Runtime Pipeline"** — Add a note about `defineElement()` as a public API alongside `Jx()`.

**E. Update §18 "Reserved Keywords"** — Add `observedAttributes` and any new lifecycle hook names (`onMount`, `onUnmount`, `onAdopted`).

**F. Update §19.4 "Web Components"** — Replace the single sentence with a proper cross-reference to §20.

### 2. `spec/jx-custom-elements-spec.md` — Dedicated Spec Amendment

A detailed spec amendment (following the pattern of `jx-external-class-spec.md`) covering:

- **Motivation** — Why custom elements need first-class support; comparison to DDOM's approach
- **JSON Declaration Format** — Full annotated example of a custom element definition file
- **Compiler Output** — Detailed description of the emitted class structure:
  - `constructor()` → `super()` + `this.state = reactive({...})` from `$defs`
  - `template()` → lit-html `html` tagged template built from `children` tree
  - `connectedCallback()` → `effect(() => render(this.template(), this))`
  - `disconnectedCallback()` → effect cleanup
  - `observedAttributes` static getter
  - `attributeChangedCallback` → sync to `this.state`
  - `customElements.define(tagName, Class)`
- **Runtime Registration** — `defineElement(source, target?)` API
- **Props and Attributes** — How `$props` maps to observed attributes on the host element
- **Slot Distribution Algorithm** — Step-by-step (ported from DDOM)
- **Nested Custom Elements** — How custom elements compose with each other
- **Complete Examples** — Counter, card with slots, form component
- **Compilation Dependencies** — `lit-html` for template rendering, `@vue/reactivity` for state (both already in the stack)

### 3. Files Modified

| File | Change |
|------|--------|
| `spec/spec.md` | Add §20, update §16.2, §17, §18, §19.4, ToC |
| `spec/jx-custom-elements-spec.md` | New file — detailed amendment |

No code changes — this is spec-only as requested.
