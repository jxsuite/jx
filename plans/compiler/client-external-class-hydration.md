---
status: stub
disposition: implement
claims:
  - compiler.md#3
  - compiler.md#5.4
size: M
workspaces:
  - packages/compiler
---

# Compiled output instantiates an external class at either timing, with or without an `$implementation`

## Context

Two sections describe one mechanism, a state entry naming an external class and what a build turns it into, and both are open for the same two refusals, so one stub claims both.

`specs/compiler.md` §3, line 61 (the marker was Partial before the census for a different reason, the missing Content-Security-Policy, which has since shipped as an opt-in):

> **Status: Partial.** Two rows do not hold. An external class with `timing: "client"` reaches a compiled page as its literal definition object in reactive state (`compile-client.ts`, and `extractInitialValue` in `compile-element.ts`), never instantiated or resolved, and only a registry class with a `lower` capability compiles to a working definition (`packages/compiler/src/site/prototype-resolver.ts`). An external class with `timing: "compiler"` is baked only when its document names an `$implementation`: `resolveClassPrototype` in the same file refuses a self-contained class with a console warning, and the site build then strips the entry, so nothing is baked and the build reports no error (§5.4). The server-function row's missing client fetch is marked on §6.1. With `build.headers.security.csp` set, the site build emits a Content-Security-Policy naming both constant inline blocks by hash (`packages/compiler/src/site/csp.ts`, `site-architecture.md` §14.3.1), and the page loads nothing from a third party (§12, `site-architecture.md` §8.7).

`specs/compiler.md` §5.4, line 351 (unmarked before the census):

> **Status: Partial.** Only a direct compile of the class document (route 0, §5.6) generates a class from the schema. A state entry naming a class with no `$implementation` gets none in a site build: at `timing: "compiler"`, `resolveClassPrototype` in `packages/compiler/src/site/prototype-resolver.ts` refuses it (`has no $implementation field`, logged as a warning) and the entry is then stripped, and at `timing: "client"` it reaches the page as its literal definition (§3). Only the runtime and the dev server construct one (`classFromSchema` in `packages/runtime/src/runtime.ts` and `packages/server/src/resolve.ts`).

The rows §3 names: "External class with `timing: "client"` → HTML + runtime hydration" and "External class with `timing: "compiler"` → HTML with baked response data". Confirmed for the first by compiling a page holding `{ "$prototype": "Widget", "$src": "./w.class.json", "timing": "client" }`: the module's `reactive({...})` carries that object verbatim. Confirmed for the second by a reviewer's scratch `buildSite` with a `Greeter.class.json` holding no `$implementation`: the build printed `prototype-resolver: failed to resolve "g" ... has no $implementation field`, returned `errors: []`, and `app.js` had no `g` in state while still binding `${state.g}`.

**What exists**

- `compile-client.ts`: state classification lowers `LocalStorage`, `SessionStorage`, `Request` and `Cookie`; every other `$prototype` def is pushed as its literal object.
- `extractInitialValue` in `packages/compiler/src/targets/compile-element.ts`: the same fallthrough (`JSON.stringify(def)`).
- `resolvePrototypes` and `resolveClassPrototype` in `packages/compiler/src/site/prototype-resolver.ts`: `timing: "compiler"` and unset timing resolve at build time by importing `$implementation`, and a class without one throws; `timing: "client"` is left alone unless the registry class has a `lower` capability (`extensions.md` §8.3), which rewrites it to a core-shape def.
- The strip in `packages/compiler/src/site/site-build.ts` that deletes every state entry still marked `timing: "compiler"` after resolution, resolved or not.
- `compileClassJson` in `packages/compiler/src/targets/compile-class.ts`: the schema-to-class compiler, reached only through route 0.
- The interpreter's contract, which compiled output does not reproduce: `importAndInstantiate`, `resolveClassJson` and `classFromSchema` in `packages/runtime/src/runtime.ts` (constructor config, `resolve()`, `.value`, `subscribe`, self-contained mode); `classFromSchema` in `packages/server/src/resolve.ts`.
- Sidecar bundling (`packages/compiler/src/site/bundler.ts`, §12) already delivers `$src` modules to the browser under `/assets/`, but excludes non-Function `$src` (`.class.json` descriptors).

**What is missing**

- In the client and element targets, a `timing: "client"` external class emits: the implementation bundled and imported (following `$implementation`, or the class compiled from its schema by `compileClassJson`), construction with the reserved keys stripped, `await resolve()` into the state entry, and a `subscribe` hookup where the class offers one.
- At build time, a self-contained class (no `$implementation`) is constructed from its schema, through `compileClassJson` or the same construction `classFromSchema` performs, and resolved like any other.
- A build error, not a console warning followed by a silent strip, for an entry the build cannot resolve or deliver.
- Tests in `compile-client.test.ts`, `compile-element.test.ts` and a site build, with the output imported and run, for both timings and both class shapes.

**Related**

- `compiler.md` §5 (class compilation), §5.6 (route 0), §12 (sidecar bundling).
- `spec.md` §12.3 and §12.4 are open for the same refusal and `plan:spec/external-class-contract` owns them. That plan already requires this one, and its item 4 (the build-time resolver instantiating a self-contained class) is the second half of this plan's work. Detailing merges the two, or trims item 4 to rely on this plan, so the resolver is changed once.
- `spec.md` §11.3's `"client"` cell, owned by `plan:spec/timing-values-in-built-sites`, which also requires this plan. `extensions.md` §8.3 (`lower`).
