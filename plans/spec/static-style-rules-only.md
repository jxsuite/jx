---
status: stub
disposition: implement
claims:
  - spec.md#9.1
requires:
  - spec/style-handle-assignment
size: M
workspaces:
  - packages/compiler
---

# A static build writes every style declaration as a rule, so nested blocks can override a resolved base value

## Context

`specs/spec.md` §9.1, line 875:

> **Status: Partial.** The runtime conforms (§9.6). The static compiler does not: a `${…}` base declaration it can resolve against a build-time scope, and a component definition's resolved host style, are written into an inline `style` attribute (`inlineStyleDeclarations` and the `hostStyle` argument of `buildAttrs` in `packages/compiler/src/shared.ts`), so in prerendered HTML a `:hover` or `@media` block cannot override those declarations.

**What exists**

- The runtime delivers every declaration as a rule (`applyStyleInto` in `packages/runtime/src/runtime.ts`, `packages/runtime/tests/stylesheet-engine.test.ts`).
- `inlineStyleDeclarations` in `packages/compiler/src/shared.ts` resolves `${…}` base declarations against the build-time scope and `buildAttrs` writes them, plus a component instance's resolved host style (`renderComponentInstance`), into one `style="…"` attribute.
- A page-level instance's resolved host style is already a rule: `expandComponents` in `packages/compiler/src/site/site-build.ts` merges it into `node.style` and the page's style pass keys it on the handle `collectStyles` picks. That path shows why this plan needs the handle fixed first. A scratch build with two page-level instances sharing `className: "icon"` and different `maskImage` values emitted two `.icon` rules, and both instances render the second value (recorded in `plan:spec/style-handle-assignment`).
- `expandComponents` already collects rules from a path that serializes before the page's style pass: slotted children go into a `slotCss` sink (`jxs-N` handles) injected as a page style block. `renderComponentInstance` has no such sink, which is why a nested instance's host style is inline today.

**What is missing**

- Emitting those resolved declarations as rules on the element's handle instead of inline, so the precedence §9.1 promises holds in prerendered HTML. Per-instance values need either a per-instance handle or the static equivalent of §9.6's per-element indirection (the shared rule reads a custom property the element sets inline), which interacts with the handle choice in §9.2.
- A rule sink on the prerender path, so `renderComponentInstance` can write a nested instance's rules to the page's style block the way `slotCss` does for slotted children.

**Shared mechanism.** This plan and `plan:_shared/static-style-handle-and-descriptions` both need the handle `collectStyles` in `packages/compiler/src/shared.ts` assigns to change: here a handle a per-instance rule can be keyed on, there the end of the author's-first-class handle. The handle assignment is `plan:spec/style-handle-assignment`, an enabling plan that claims nothing, and both require it, so the handle is decided once. It gives this plan a handle that selects only the element it was assigned to, and one function to ask for it from the page style pass and from the prerender path. Whether a definition rendered more than once gets a per-instance handle, or this plan uses §9.6's custom-property indirection so the definition's handle suffices, is decided when the two are detailed together.

**Related**

- §9.2 (the compiler's style handle, `plan:_shared/static-style-handle-and-descriptions`, built by `plan:spec/style-handle-assignment`), §9.3 (what a static emitter drops or reports, `plan:spec/report-dropped-reactive-styles`), §9.6.
- `compiler.md` §8.2 (CSS extraction).
