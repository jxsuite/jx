---
status: stub
disposition: implement
claims:
  - spec.md#4e
  - spec.md#11.1
requires:
  - spec/compiled-request-fetch
size: S
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/schema
---

# A `Request`'s `urlParams` becomes its query string and re-fetches when a bound value changes

## Context

Two sections carry the same `Request` example with the same unread field, so one stub claims both.

`specs/spec.md` §5.3 4e, line 454:

> **Status: Partial.** The `Request` example's `urlParams` field is read by nothing (§11.1): the runtime's `Request` case, `ExternalClassDef` and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) all ignore it, so the entry fetches `/api/users/` once and never re-fetches when `userId` changes.

`specs/spec.md` §11.1, line 1173:

> **Status: Partial.** `$prototype` dispatch ships (`resolvePrototype` in `packages/runtime/src/runtime.ts`). The example's `urlParams` field is read by nothing: the runtime's `Request` case reads only `url`, `method`, `headers`, `body`, `debounce` and `manual`, `ExternalClassDef` does not declare it, and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) ignores it, so a `Request` re-fetches reactively only through a `${…}` template in `url`.

**What exists**

- The `Request` case of `resolvePrototype` in `packages/runtime/src/runtime.ts`: a template `url` inside an effect, `debounce`, `manual`, an `AbortController` on cleanup.
- `emitRequestFetch` in `packages/compiler/src/shared.ts`, used by the client and element targets. It has no `debounce` and no abort: it never reads `def.debounce` and passes no `signal` (§11.2's `Request` cell). Those arrive with `plan:spec/compiled-request-fetch`, which this plan requires, so the compiled `urlParams` re-fetch below runs inside an effect that already debounces and cancels the fetch it replaces.
- `packages/schema/defs/external-class-def.schema.ts` (`BUILT_IN_PROTOTYPES`), which does not declare `urlParams`.
- The field is advertised in five places that nothing implements: §11.1's example, §5.3 4e's example, §12.1's `Request` row ("HTTP fetch with reactive URL params"), `docs/framework/concepts/data-prototypes.md`, and `specs/schema.md` §3 ("Built-in Prototypes").

**What is missing**

- `urlParams` as an object of static values, `$ref`s and templates, serialized with `URLSearchParams` and appended to `url`, tracked so a change re-fetches (with `debounce` applied), in the runtime and in `emitRequestFetch`; declared on the schema.
- Disposition is `implement` because five places promise it; the alternative, reconciling every example to a `${…}` template in `url`, is the fallback if detailing finds the field adds nothing a template does not.
- This plan owns the §12.1 `Request` row's phrase "HTTP fetch with reactive URL params", so the decision above is made once, here.
  - `implement` keeps the phrase; the fallback rewords it to a reactive `url`.
  - Either way, the pull request that lands this plan removes "except `Request`'s URL params (§11.1)" from §12.1's marker. That marker stays Partial for its other rows.
  - §12.1 itself is `plan:spec/reconcile-built-in-prototypes`'s claim. That plan requires this one and leaves the row's wording alone.
  - `plan:schema/generator-inventory` (`schema.md` §3.1's `Request` line) also requires this plan and follows the same answer.

**Related**

- §11.2 (`URLSearchParams`, `plan:spec/web-api-prototype-parity`; the compiled `Request`'s `debounce` and abort, `plan:spec/compiled-request-fetch`), §12.1 (the `Request` row, whose phrase this plan owns; the section, `plan:spec/reconcile-built-in-prototypes`).
- `schema.md` §3.
