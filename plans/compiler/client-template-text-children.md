---
status: stub
disposition: implement
claims:
  - compiler.md#2.2
size: S
workspaces:
  - packages/compiler
---

# A template string written as a text child is prerendered wherever it can be, and bound on a dynamic page

## Context

`specs/compiler.md` §2.2, line 53 (the section was unmarked before the census):

> **Status: Partial.** All three targets emit bare strings and numbers as text nodes, and the element target binds a template text child reactively (`toLitTextContent` in `compile-element.ts`). The other two do not. The client target's `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`) escapes a child such as `"Hello ${state.name}"` and writes it out verbatim, neither prerendered nor bound, so template text is reactive in that tier only inside a lit-rendered region (a mapped array, or mixed children rendered through `emitChildLit`). The static target does the same (`compileNode` in `compile-static.ts`), and the site build's prerender does not resolve such a child first: `resolveDocTemplates` in `packages/compiler/src/site/site-build.ts` substitutes a template child only when it evaluates to an array. `isDynamic` does not count a template child, so a page whose only template is a text child routes static and ships the literal `${…}`, while a `textContent` template beside it resolves.

Confirmed twice. Compiling a page whose children are `["Hello ${state.name}", <a button whose handler writes state.name>]` emits `<div>Hello ${state.name}` as literal text, and the module binds nothing to it. A reviewer's scratch `buildSite` of a stateless page with the children `["Site: ${state.$site.name} / ${state.$page.title}", { "tagName": "p", "textContent": "T: ${state.$page.title}" }]` wrote `Site: ${state.$site.name} / ${state.$page.title}` verbatim next to `<p>T: Home</p>`, and no `app.js`.

**What exists**

- `buildClientNode` in `packages/compiler/src/targets/compile-client.ts`: the `typeof def === "string"` branch returns `escapeHtml(def)`. A `textContent` template on an element is bound (`:text-content`), and a children array holding a mapped array goes through one lit binding (`emitChildLit`).
- `compileNode` in `packages/compiler/src/targets/compile-static.ts`: the same `escapeHtml(def)` for a string child, while `textContent` is resolved through `resolveStaticValue`.
- `toLitTextContent` in `packages/compiler/src/targets/compile-element.ts`: the element target's reactive text, the one tier that already works.
- `resolveDocTemplates` in `packages/compiler/src/site/site-build.ts`: it resolves `textContent`, `innerHTML`, style, attribute and `$props` templates, but a template string child only when the result is an array (the child-array form of spec.md §8.4).
- `isDynamic` in `packages/compiler/src/shared.ts` returns `false` for any string, so a template child never makes a page dynamic.

**What is missing**

- `resolveDocTemplates` substitutes a scalar result for a template child, under the same runtime-only rules as every other template it resolves (§8.1 decides which reads are baked), so a site build prerenders it in every tier.
- `compileNode` in the static target resolves a template child against the build-time scope, as it already does for `textContent`, for a caller that goes through `compile()` without the site build.
- In the client target, a template child that cannot be baked emits a text binding with an `effect()` keeping it current, without disturbing the sibling elements the container also holds.
- Whether `isDynamic` should count a template child that reads runtime state is a detail-phase question; today such a page is dynamic through its `state` anyway.
- Tests in `packages/compiler/tests/compile-client.test.ts` (a template child among element siblings) and `compile-static.test.ts`, and a site-build test with a `$site`/`$page` template child on a stateless page.

**Related**

- `compiler.md` §8.1 (which reads are baked at build time), §9.1 (the client target's output shape), §4.3 (the element target's binding form).
- `spec.md` §6 (universal reactivity) and §8.4 (child arrays).
