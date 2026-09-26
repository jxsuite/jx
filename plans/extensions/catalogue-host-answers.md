---
status: stub
disposition: reconcile
claims:
  - extensions.md#9.2
size: S
---

# The catalogue section states what each host can actually answer, including the cloud's declared install state

## Context

`specs/extensions.md` §9.2, line 483:

> **Status: Partial.** The dev server and desktop answer the full contract (`packages/server/src/extension-catalog.ts`, `probeExtension` in `packages/compiler/src/site/format-host.ts`). No host populates `specifier`, and the cloud host declares rather than probes: `listExtensionCatalog` in `packages/studio/src/platforms/cloud.ts` sets `bundled: true` on every gateway entry and derives `installed` from `package.json` declarations.

The section was unmarked before the census. Disposition `reconcile`: the code's reasoning is sound and written down beside it. A Worker resolves no modules, so `listExtensionCatalog` cannot probe; the gateway returns only what the Worker bundles, which makes `bundled: true` a fact rather than a claim; and `installed` there "means DECLARED" because `addPackage` is a manifest edit resolved later in Pages CI. The protocol type already documents that as a degradation; the spec's "probed, never declared" does not admit it. `specifier` is the second half: a linked package enables under its package name through `node_modules`, so no host has needed it, and the detail phase either names the case that does or drops the row.

**What exists**

- `buildExtensionCatalog` in `packages/server/src/extension-catalog.ts` (first-party entries from `@jxsuite/catalog` plus dependency-discovered ones, `bundled` and `installed` from `probeExtension`, a `problem` row for a package that declares `"jx"` without the export), tested in `packages/server/tests/extension-catalog.test.ts`.
- `ExtensionCatalogEntry.specifier` (`packages/protocol/src/types.ts`), typed and never set; `enableExtension` in `packages/studio/src/settings/extension-commands.ts` matches a row by `specifier` or `name`.
- `listExtensionCatalog` in `packages/studio/src/platforms/cloud.ts`, with the rationale in its doc comment.

**What is missing**

- The "probed, never declared" rule restated so that a host which cannot resolve modules says which of the two facts it declares and why, with the cloud named.
- The `specifier` row either justified by a case a host populates, and that host populating it, or removed from the table and the protocol type.

**Related**

- extensions.md §5.5 (a Worker ships a fixed set of extensions), extensions.md §6.1 (how a host resolves a manifest).
- desktop.md §3.1 (the platform interface, `listExtensionCatalog?` among its members).
