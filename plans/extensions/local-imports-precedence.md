---
status: stub
disposition: implement
claims:
  - extensions.md#3
size: S
workspaces:
  - packages/compiler
---

# A project-local imports entry wins over a manifest class on every resolution path, lowering included

## Context

`specs/extensions.md` §3, line 63:

> **Status: Partial.** Declaration, project-first resolution (`createNodeFormatIO`, `packages/compiler/src/site/format-host.ts`), manifest-class visibility and the duplicate-name error ship (`buildExtensionRegistry`, `packages/schema/src/extension-registry.ts`). A project-local `imports` entry wins only where the compiler resolves a def to a `$src` (`packages/compiler/src/site/prototype-resolver.ts`): a state def whose `timing` is not `"compiler"` is lowered through `registry.byName($prototype)` before `imports` is consulted, so a project-local class named like a lowering manifest class (`TableQuery`, `Search`) is shadowed by it.

The section was unmarked, and the census's first pass listed it as verified on the strength of the `$src` branch. The spec states the precedence without exception ("On a name collision, a project-local `imports` entry wins over a manifest class"), and the code has no reason to differ: the lowering branch simply runs first. Disposition `implement`; the detail phase may choose `reconcile` only if it finds a case where lowering a same-named manifest class is the intended outcome.

**What exists**

- The state loop of `resolvePrototypes` in `packages/compiler/src/site/prototype-resolver.ts`: the branch for `def.timing && def.timing !== "compiler"` calls `projectContext.registry?.byName(def.$prototype)` and, when the entry declares `lower`, replaces the def with the lowered one and `continue`s; only the later branch applies `imports[def.$prototype] ?? registryClassPath(...)`.
- The classes that declare `lower` today: `TableQuery`, `TableEntry`, `TableInsert`, `TableUpdate` and `TableDelete` (`extensions/connector/src/`) and `Search` (`extensions/search/src/Search.class.json`).
- Tests: `packages/compiler/tests/prototype-resolver.test.ts` covers resolution through the `imports` map, and lowering is exercised in `packages/compiler/tests/sidecar-bundler.test.ts` and `connector-mounts.test.ts`; none puts a local class and a lowering manifest class under one name.

**What is missing**

- The lowering branch consulting `imports[def.$prototype]` first, and leaving a def whose name a project-local class claims to that class's own pipeline.
- A test that a project with `imports: { "TableQuery": "./local/table-query.class.json" }` and `@jxsuite/connector` enabled keeps its local class for a `timing: "client"` def rather than lowering it.
- A check that the other `$prototype` readers keep the same order: the dev server's resolution and the studio's signals panel, which lists manifest classes by name.

**Related**

- extensions.md §3.1 (class-name conflicts between extensions), extensions.md §8.3 (`lower`).
- imports.md (the `imports` map's reduced job).
