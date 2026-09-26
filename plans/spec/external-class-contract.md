---
status: stub
disposition: implement
claims:
  - spec.md#12.3
  - spec.md#12.4
requires:
  - compiler/client-external-class-hydration
size: M
workspaces:
  - packages/runtime
  - packages/studio
  - packages/server
  - packages/compiler
  - extensions/parser
---

# External classes are unsubscribed on teardown, their `returnType` reaches tooling, and self-contained classes resolve at build time

## Context

`returnType` is specified in both sections and read by nothing, so one stub claims both; the other items ride with it because each shares an anchor with it. They touch disjoint workspaces (runtime teardown; Studio, server and parser tooling; the compiler's build-time resolver) and may split into enabling plans during detailing.

§12.3's compiled half, a built page instantiating an external class at all, is `compiler.md` §3's gap and `plan:compiler/client-external-class-hydration`'s work. This plan requires it rather than building it twice, and adds only the `unsubscribe` teardown to what it emits.

§12.4's build-time half is the same prerequisite's too. The `compiler.md` census marked the refusal of a self-contained class Partial on `compiler.md` §3 (its `timing: "compiler"` row) and §5.4, and `plan:compiler/client-external-class-hydration` claims both, so item 4 below is that plan's work seen from this spec. Detailing either trims item 4 to relying on the prerequisite and flipping this marker, or merges the two plans into one `_shared` plan; either way the resolver is changed once. Confirmed by a reviewer's scratch `buildSite` with `Greeter.class.json` (no `$implementation`) at `timing: "compiler"`: the warning printed, the build returned `errors: []`, and `${state.g}` was left bound to nothing.

`specs/spec.md` §12.3, line 1373:

> **Status: Partial.** The constructor config, the `resolve()`/`.value`/instance order and `subscribe(callback)` ship in the interpreter (`importAndInstantiate` and `resolveClassJson` in `packages/runtime/src/runtime.ts`). A built page never instantiates an external class: a `timing: "client"` class reaches it as its literal definition (compiler.md §3), and the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) skips `.value`, going from `resolve()` straight to the instance. `unsubscribe()` is never called, so a subscription outlives its component, and no tool reads `returnType`: the Studio repeater check (`packages/studio/src/editor/convert-to-repeater.ts`) reads a `returns` key that `packages/server/src/studio-api.ts` copies from `methods.resolve.returns`, which only `ContentCollection.class.json` declares.

`specs/spec.md` §12.4, line 1404 (its trailing `Implemented` marker, which describes the entrypoint, stays):

> **Status: Partial.** The `.class.json` entrypoint, `$implementation` and runtime self-contained mode (`classFromSchema`) ship. "Tooling uses this metadata" does not hold: nothing reads `returnType` except `packages/compiler/src/targets/compile-class.ts`, which only sniffs it for an async prefix (§12.3). And the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) refuses a class with no `$implementation` with a console warning, after which the site build strips the entry and reports no error, so self-contained mode is runtime-only (compiler.md §5.4).

**What exists**

- `importAndInstantiate`, `resolveClassJson` and `classFromSchema` in `packages/runtime/src/runtime.ts`; `packages/runtime/tests/class-json.test.ts`.
- `packages/server/src/studio-api.ts` returns `returns: resolveMethod.returns`; `convert-to-repeater.ts` tests `schema.returns.type === "array"`.
- `extensions/parser/src/ContentCollection.class.json` declares `returns`; `MarkdownCollection.class.json` and `extensions/auth/src/*.class.json` declare `returnType`, per the spec.
- `prototype-resolver.ts` throws `has no $implementation field`, and after `new ExportedClass(config)` returns `await instance.resolve()` if it exists, else the instance, never reading `.value`.

**What is missing**

1. The runtime calls `instance.unsubscribe()` when the owning scope is torn down (component disconnect, `$switch` case change, `mount()` dispose), and so does the compiled instantiation `plan:compiler/client-external-class-hydration` adds.
2. One field name: tooling reads `returnType` (resolving a local `$ref` into `$defs/returnTypes`), `ContentCollection.class.json` is migrated, and the Studio repeater check offers any class whose `resolve()` `returnType` is an array.
3. The build-time resolver reads `.value` between `resolve()` and the instance, as §12.3 orders them.
4. The build-time resolver instantiates a self-contained class through the same `classFromSchema` construction, or the section states that self-contained mode is runtime-only. A detail-phase decision; `implement` is the default. The construction itself, and the build error that replaces the warning-then-strip, are `plan:compiler/client-external-class-hydration`'s (above); what stays here is the §12.4 marker flip, and the §11.3 `"compiler"` cell, which names the same refusal, flips with `plan:spec/timing-values-in-built-sites`.
5. Minor: `EXTERNAL_RESERVED` also strips `body`, `parameters`, `arguments` and `name`; the §12.3 list of reserved keys says six. Reconcile the list when this lands.

**Related**

- §10 (mapped iteration sources), §11.3 (the `"client"` row, `plan:spec/timing-values-in-built-sites`), §12.2, §14.1 (case teardown), `compiler.md` §3 and §5.3 (`returnTypes`), `studio.md` (convert to repeater).
