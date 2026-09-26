---
status: stub
disposition: reconcile
claims:
  - extensions.md#12
size: S
workspaces:
  - packages/schema
  - extensions/connector
---

# The connector block names only keys a host reads, so serve is wired or struck

## Context

`specs/extensions.md` §12, line 586:

> **Status: Partial.** `provider`, `kind`, `local` and `module` ship (`packages/server/src/data-api.ts`, `resolveConnectorStandins` in `packages/server/src/jx-mounts.ts`, `buildMountSpecs` in `packages/compiler/src/site/site-build.ts`). `serve` is declared by `D1`, `Sqlite` and `Supabase` and read by no host: the data mount is found through `Data.class.json`'s own `server` block.

The section was unmarked before the census. Disposition `reconcile`: the architecture moved to one data mount (`Data`, order 20) that serves every connection through `options.connectors`, so a per-connector serving module has no reader and no evident use. A third-party connector naming a different `serve` module today is silently ignored, which is the argument for striking the key rather than leaving it documented.

**What exists**

- `"serve": "@jxsuite/connector/worker"` in `extensions/connector/src/D1.class.json`, `Sqlite.class.json` and `Supabase.class.json`, asserted in `extensions/connector/tests/extension-manifest.test.ts`.
- `serve` typed on the connector block in `packages/schema/src/format-registry.ts` and declared in `packages/schema/defs/class-def.schema.ts`.
- The data mount's own `server` block in `extensions/connector/src/Data.class.json`, which is what `buildMountSpecs` and the dev server read.

**What is missing**

- The `serve` row removed from the §12 table and the example, the key dropped from the three descriptors, the manifest test, the `ConnectorBlock` type and the class schema (with the committed schema artifacts regenerated), or, if the detail phase finds a case for per-connector mounts, a host that reads it.

**Related**

- extensions.md §11 (the data mount's `server` block), extensions.md §2 (the connector package's role).
- site-architecture.md §15.2 (the application tier's configuration surface).
