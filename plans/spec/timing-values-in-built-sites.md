---
status: stub
disposition: implement
claims:
  - spec.md#11.3
requires:
  - _shared/compiled-server-call
  - compiler/client-external-class-hydration
size: M
workspaces:
  - packages/compiler
---

# Every row of the timing table holds in a built site, and an unset `timing` means the same thing in both tiers

## Context

`specs/spec.md` §11.3, line 1228, with the `"client"` cell at line 1232, the `"server"` cell at line 1233 and the `"compiler"` cell at line 1234, all three corrected from `**Implemented**` by the census (the compiler cell on a forward from the `compiler.md` census):

> **Status: Partial.** The compiler row ships only for an external class that names an `$implementation`: a self-contained class is refused with a console warning (§12.4), and a `$prototype: "Request"` is never fetched at build time, because `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) finds no class mapping for it and skips it, yet the site build strips both as resolved compiler entries, so nothing is baked and the page gets no fetch either. The client row holds in the interpreter, but in compiled output only for the built-ins a target lowers (§11.2) and for a registry class with a `lower` capability: an external class with `timing: "client"` reaches a built page as its literal definition object (compiler.md §3), and one with no `timing` is resolved at build time (`resolvePrototypes`), so the two tiers disagree about the default. The server row does not hold in a built site: the route is generated, but no compiled page calls it (§11.4), and in an interpreting host the function can run in the browser.

The trailing `Implemented` marker (line 1236) is now scoped to what it verifies, an external class that names an `$implementation`, and stays.

Two rows' gaps are mostly other plans' work, so this plan is the owner that waits for both, settles the one question neither answers, and does the one piece nobody else claims, the compiler-timed `Request`:

- The `"server"` row closes with `plan:_shared/compiled-server-call` (the compiled call and proxy-first interpreting hosts).
- The `"client"` row for external classes closes with `plan:compiler/client-external-class-hydration`, which claims `compiler.md` §3 for the same missing instantiation.
- The `"compiler"` row's self-contained half closes with the same prerequisite: its build-time construction of a class with no `$implementation` is what `compiler.md` §3 and §5.4 mark, and `spec.md` §12.4 marks from the spec side.
- The `"compiler"` row's `Request` half is this plan's own. It is the `compiler.md` §10 ledger row "`timing: "compiler"`, bake fetch responses into HTML at build time" (**Pending**), which `plan:compiler/superseded-ledger-rows` keeps open in that spec only until this section marks it. It now does, so that plan can delete the row.

**What exists**

- `resolvePrototypes` in `packages/compiler/src/site/prototype-resolver.ts`: `if (def.timing && def.timing !== "compiler")` skips a `"client"` or `"server"` entry (lowering it only when the registry class has a `lower` capability, `extensions.md` §8.3); an entry with no `timing` falls through to `resolveClassPrototype` and is baked in at build time.
- The interpreter resolves an entry with no `timing` in the browser (`importAndInstantiate` in `packages/runtime/src/runtime.ts`), as the table's "(default)" says.
- A `Request` at `timing: "compiler"`: `SKIP_PROTOTYPES` in `prototype-resolver.ts` does not list `Request`, so the entry reaches `imports[def.$prototype] ?? registryClassPath(...)`, finds no mapping and `continue`s without a warning. The strip in `packages/compiler/src/site/site-build.ts` then deletes every state entry still marked `timing: "compiler"`, resolved or not. `isDynamic` in `packages/compiler/src/shared.ts` skips compiler-timed entries. The compiled fetch (`emitRequestFetch` in `shared.ts`) is browser code for an entry that survives the build; nothing fetches at build time.
- No spec states that a build resolves an unset `timing` at build time (`compiler.md` §3's table names only explicit `"compiler"` and `"client"`).

**What is missing**

1. One meaning for an unset `timing`. Either the resolver leaves an unset entry for the client (so a built page hydrates it once `plan:compiler/client-external-class-hydration` lands), or the table says that a build resolves an unset entry at build time when it can and the interpreter in the browser. The second is a `reconcile` of the "(default)" wording; detailing decides, and splits this plan if the answer is the reconcile.
2. A `$prototype: "Request"` with `timing: "compiler"` is fetched at build time and its parsed response baked into the page as the entry's value (the same `url`, `method`, `headers` and `body` the interpreter reads, with `${…}` templates resolved against build-time scope), or refused with a build error. The other disposition is a sentence in §11.3 excluding `Request` from compiler timing, which would split this item off as a `reconcile`. Either way a compiler-timed entry the build cannot resolve stops being stripped silently; `plan:compiler/client-external-class-hydration` makes that a build error for external classes, and this item extends it to built-ins.
3. All three cells flip, and the section's leading marker is removed, once the prerequisites land and items 1 and 2 are settled.

**Related**

- §11.2 (the `Request` prototype), §11.4, §12.3 (the external class contract, `plan:spec/external-class-contract`), §12.4.
- `compiler.md` §3 (output tiers), §5.4, §6.1, §10 (the ledger row this plan's item 2 retires, `plan:compiler/superseded-ledger-rows`); `extensions.md` §8.3 (`lower`).
