---
status: stub
disposition: implement
claims:
  - spec.md#20.2
size: S
workspaces:
  - packages/runtime
  - packages/compiler
---

# A compiled structured body awaits a thenable statement before the next, as the interpreter does

## Context

`specs/spec.md` §20.2, line 2348:

> **Status: Partial.** All six kinds ship in both halves (`packages/runtime/src/statements.ts`). Awaiting a thenable holds only in the interpreter's `runStatements`: `compileStatements` emits plain statements with no `await`, and the compiled handlers are synchronous arrows, so a compiled body runs its next statement before an async call settles.

**What exists**

- `runStatements` in `packages/runtime/src/statements.ts` awaits a thenable result (`packages/runtime/tests/statements.test.ts`: "a thenable statement result is awaited before the next statement").
- `compileStatements` in the same module emits `expr;` per statement; `packages/compiler/src/targets/compile-client.ts` and `compile-element.ts` wrap it in a synchronous `(s, e) => { … }`.

**What is missing**

- `compileStatements` emits `await` before any statement that may yield a thenable (a `call`, or every expression statement), and the compiled handler and callable become `async`. The interpreter's purely synchronous fast path (no awaits when nothing is thenable) has a compiled analogue only if detailing wants one.
- The ordering question for `stopPropagation`/`preventDefault` after an `await`: an event's propagation decision is synchronous, so a verb after the first `await` is too late. Detailing states the rule (hoist the two verbs, or document it).

**Related**

- §20.3 (`plan:spec/compiled-element-parameterised-bodies`), §19.8, §16.4 (a lifecycle hook is a body without an event).
