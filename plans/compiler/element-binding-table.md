---
status: stub
disposition: reconcile
claims:
  - compiler.md#4.3
size: S
---

# The element-compilation examples and binding table show what the emitter writes

## Context

`specs/compiler.md` §4.3, line 179 (unmarked before the census; its first pass called the drift editorial, which the §11 signature drift, marked Partial, contradicted):

> **Status: Partial.** Two rows do not match what `packages/compiler/src/targets/compile-element.ts` emits: a template-valued `hidden` is bound as the property `.hidden=${…}`, and the element target emits no `?attr` binding at all (a bound entry under `attributes` goes through the inlined boolean-attribute helper, §11); and an event reference is bound as `@click=${(e) => s.fn(s, e)}`, passing the event. The ref lowering described below ships as written.

Disposition `reconcile`: the emitted forms are deliberate. A handler receives the event because `spec.md` §5.3 binds handler parameters by name; a bound attribute goes through `attrHelperSource()` so the element, client and static targets and the runtime decide boolean attributes one way (`spec.md` §8.3); and a top-level template key is an IDL property, which `.key=` sets.

Confirmed by two independent scratch compiles of `user-card`: `.hidden="${s.loading}"` and `@click="${(e) => s.fn(s, e)}"`, with `nothing` imported and `__jxAttrText` inlined.

**What exists**

- `packages/compiler/src/targets/compile-element.ts`: the `attributes` loop (bound values through `ATTR_HELPER`, `?? nothing`), the top-level key loop (`.${key}=`), the event loop (`(e) => … (s, e)`), `emitStyleString` for inline style.
- `packages/compiler/tests/compile-element.test.ts`, `element-idl-props.test.ts`.

**What is missing**

- §4.3's `hidden` and event rows rewritten to the emitted forms, with a row for a bound entry under `attributes` (the helper form), so the table says where a boolean attribute is decided.
- Riding along, editorial: §4.2's example output (it predates the emitter: no `nothing` import, no inlined helper, `(e) => s.setAway(s, e)`, and the connect-time merge `plan:_shared/compiled-prop-bridge` restates).
- Riding along, editorial: §13's WHATWG HTML Note says no shadow root is ever attached and that Declarative Shadow DOM and `ElementInternals` are unavailable. Opt-in `$shadow` attaches one (`packages/compiler/src/shadow.ts`, `compile-element.ts`, `<template shadowrootmode>` in `site-build.ts` and `shared.ts`, `packages/compiler/tests/shadow-dom.test.ts`). The Note is corrected to match `spec.md` §18's WHATWG HTML row, which already reads "light DOM by default" with `$shadow` as the opt-in.

**Related**

- `spec.md` §5.3 (handler parameters), §8.3 (the boolean-attribute rule), §16.6 and §18 (shadow opt-in). §18's WHATWG DOM Note ("Shadow trees are not used at all") is the same stale claim, corrected editorially by `plan:spec/shadow-dom-parity`; the `spec.md` census forwarded this §13 Note as its counterpart, and neither Standards Alignment section carries a marker, so the two Notes are corrected as ride-alongs and should end up saying the same thing.
- `plan:_shared/compiled-prop-bridge` (§4.4, whose snippet also appears in §4.2's example).
