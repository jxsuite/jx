---
status: stub
disposition: implement
claims:
  - spec.md#16.1
size: S
workspaces:
  - packages/compiler
---

# A compiled element binds its definition's root-level event handlers on the host

## Context

`specs/spec.md` §16.1, line 1633:

> **Status: Partial.** The interpreter binds root-level `on*` handlers on the host (`bindDefinitionHandlers` in `packages/runtime/src/runtime.ts`). The compiled element module every site build ships (`compileElement`) does not: its `template()` renders only the definition's children and no host listener is emitted, so a root `onclick`, `onkeydown` or `ontoggle` is dropped in production.

**What exists**

- `bindDefinitionHandlers` in `packages/runtime/src/runtime.ts` (the definition's scope as `state`, the host as `currentTarget`); `packages/runtime/tests/host-handlers.test.ts`.
- `packages/compiler/src/targets/compile-element.ts` emits `on*` bindings for child nodes only (the lit `@event=` path); `packages/compiler/src/site/site-build.ts` compiles every component with `compileElement`.

**What is missing**

- The emitted `connectedCallback` adds a listener on `this` for each root-level `on*` key, in every handler spelling (`$ref`, structured body, string body, `$expression`), with the listener's lifetime the element's, and removes it in `disconnectedCallback` or binds it once.
- A compiled-element test mirroring `host-handlers.test.ts`.

**Related**

- §4.3 (listener options are not grammar), §16.4 (lifecycle, `plan:_shared/compiled-element-lifecycle`), §20.2 (`stopPropagation`).
- `compiler.md` §4.
