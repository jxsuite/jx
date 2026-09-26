---
status: stub
disposition: implement
claims:
  - spec.md#11.2a
size: S
workspaces:
  - packages/compiler
  - packages/runtime
---

# A compiled page reads and writes a `Cookie` by the same attribute rules as the runtime

## Context

`specs/spec.md` §11.2a, line 1211:

> **Status: Partial.** The runtime conforms (`serializeCookie` and `readCookie` in `packages/runtime/src/cookie.ts`). The compiled client target does not: `emitCookieInit` in `compile-client.ts` reads the cookie with a regular expression built from the author's name, and never writes the cookie back, so a compiled page neither persists a change nor applies any of the derived attributes.

The marker was a bare `Implemented` before the census; the runtime half is what it described.

**What exists**

- `packages/runtime/src/cookie.ts`: `serializeCookie` (the `__Host-`, `__Secure-` and `SameSite=None` derivations; no `HttpOnly`, no `Expires`) and `readCookie` (splits the header). `packages/runtime/tests/cookie.test.ts`.
- `emitCookieInit` in `packages/compiler/src/targets/compile-client.ts` emits `document.cookie.match(new RegExp("(?:^|; )<name>=([^;]*)"))` and no write.

**What is missing**

- The compiled client reads by splitting the header and writes through an effect that serializes with the §11.2a rules. The generated module loads without `@jxsuite/runtime`, so the rule is inlined from one source, the way `attrHelperSource()` serializes `booleanAttrValue` (§8.3), with a drift test.
- The element target has no `Cookie` lowering at all; that is §11.2's (`plan:spec/web-api-prototype-parity`).

**Related**

- §11.2, §8.3 (the inlined-helper precedent).
