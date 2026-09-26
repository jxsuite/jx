---
status: stub
disposition: implement
claims:
  - spec.md#11.2
requires:
  - spec/compiled-cookie-attributes
  - spec/compiled-request-fetch
size: L
workspaces:
  - packages/runtime
  - packages/compiler
---

# Every supported Web API prototype resolves in the interpreter and in compiled output, `ReadableStream` included

## Context

`specs/spec.md` §11.2, line 1192:

> **Status: Partial.** The interpreter's `resolvePrototype` handles every Web API row but `ReadableStream`, whose case returns `null`; the `Array` row is the §10 children node, not a state prototype. The client target (`compile-client.ts`) lowers `LocalStorage`, `SessionStorage`, `Request` and `Cookie`; the element target (`compile-element.ts`), which compiles every site component, lowers only `Request` and turns a storage or cookie entry into a plain initial value (its `default`), with no read and no persistence. `URLSearchParams`, `FormData`, `IndexedDB`, `Set`, `Map` and `Blob` reach a built page as the literal definition object in both targets, and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort. Each cell below that reads Partial names its compiled gap.

And the table's status cells (lines 1196–1207): ten rows read `**Partial**`, each naming its compiled gap (`compiled: not lowered`, `element target: default only`, `compiled: no debounce or abort`), which the census corrected from `**Implemented**` as it did §11.3's `"server"` cell; `ReadableStream` reads `**Pending** — stub returns null`; `Array` stays `**Implemented**`, its compiled gaps being §10.3's and §10.4's.

Two pieces of work share this anchor and therefore this stub: the `ReadableStream` prototype, and compiled-target parity for the rows the interpreter already handles. They may split into enabling plans during detailing, and the element target's storage lowering (item 2) is the one every site component needs first.

The `Request` row's compiled gap, `debounce` and abort in `emitRequestFetch`, was this stub's item 4. It is now the enabling `plan:spec/compiled-request-fetch`, because `plan:spec/request-url-params` needs the same emitted effect before this plan's larger items land. This plan requires it: the marker's last clause and the `Request` cell cannot be removed until it lands, and that plan's pull request narrows both. The §11.2 flip stays here.

**What exists**

- `resolvePrototype` in `packages/runtime/src/runtime.ts`: a case per row; `ReadableStream` returns `null`. `packages/runtime/tests/runtime-gaps.test.ts` (Request debounce), `packages/runtime/tests/cookie.test.ts`.
- `packages/compiler/src/targets/compile-client.ts` lowers `LocalStorage`/`SessionStorage` (`emitStorageInit`), `Request` (`emitRequestFetch`) and `Cookie` (`emitCookieInit`). Every other `$prototype` falls through to "plain object, reactive state".
- `packages/compiler/src/targets/compile-element.ts` lowers only `Request` (`emitRequestFetch` in `connectedCallback`). `extractInitialValue` returns an entry's `default` when it has one (`JSON.stringify(def.default ?? null)` for a storage entry), so a `LocalStorage`, `SessionStorage` or `Cookie` entry is a plain initial value with no storage read and no persistence; the file contains no `localStorage` or `sessionStorage` token.

**What is missing**

1. `ReadableStream`: what the state entry holds (the stream, or its accumulated chunks as a reactive value), its source (`$src`, a `Request` body, `$ref`), and cancellation on teardown. None of this is specified yet beyond the row, so detailing writes the contract first.
2. Storage lowering in the element target: a read on connect and a persisting effect for `LocalStorage` and `SessionStorage`, shared with the client target's `emitStorageInit` rather than written twice, and `Cookie` likewise (sharing `plan:spec/compiled-cookie-attributes`'s reader and writer).
3. Compiled lowering for `URLSearchParams`, `FormData`, `IndexedDB`, `Set`, `Map` and `Blob` in both compiled targets.
4. (Split out.) `debounce` and abort-on-teardown in `emitRequestFetch` are `plan:spec/compiled-request-fetch`'s, including the `Request` cell's flip to `**Implemented**`.
5. The other Partial cells flip with the rows they name, and the section's marker is removed once none is left.

**Related**

- §11.1 (`urlParams`, `plan:spec/request-url-params`), §11.2a (the compiled cookie, `plan:spec/compiled-cookie-attributes`), §12.1 (the built-in table, `plan:spec/reconcile-built-in-prototypes`).
- The compiled `Request` (`plan:spec/compiled-request-fetch`). Item 1's `ReadableStream` may take a `Request` body as its source. If it does, its compiled cancellation on teardown should reuse that plan's abort rather than add a second one.
- `compiler.md` §9.1 (dynamic page compilation).
