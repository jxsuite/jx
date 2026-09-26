---
status: stub
disposition: implement
claims:
  - extensions.md#8
size: M
workspaces:
  - extensions/connector
  - packages/compiler
  - packages/server
  - packages/studio
---

# A connector table drives dynamic page paths through its own resolvePaths discriminator, in the build and the studio preview

## Context

`specs/extensions.md` §8, line 291:

> **Status: Partial.** Every role below is declared in `EXTENSION_CAPABILITIES` (`packages/schema/src/format-registry.ts`) and by a first-party descriptor under `extensions/*/src/`. `resolvePaths` dispatches by discriminator in the site build only (`packages/compiler/src/site/pages-discovery.ts`); the studio preview's parameter picker hard-codes `contentType` and offers nothing for any other discriminator (`resolveParamValues`, `packages/studio/src/page-params.ts`). The connector `table` discriminator is not built: no connector descriptor declares `resolvePaths`, so `contentType` is the only registered discriminator. Two Consumers cells name callers that do not exist: only `jx db push` calls `bindings`, and only the studio's data grid reaches `testConnection`.

The section was unmarked, but its own prose already said the `table` discriminator "is **planned**; no connector descriptor declares one today", and §5.3's paths row says the same of the connector's `$paths` source shape. Disposition `implement`: nothing in the tree argues for deferring it, and the dispatch it needs is generic already. The detail phase may still choose `defer` if build-time reads from a live connection prove the wrong trade.

**What exists**

- Discriminator dispatch in the build: `byPathsDiscriminator` (`packages/schema/src/extension-registry.ts`) and its only caller, `packages/compiler/src/site/pages-discovery.ts`, which strips `_meta` before URL substitution.
- The studio preview's parameter picker, `resolveParamValues` in `packages/studio/src/page-params.ts`: the legacy array, `values` and a data-file `$ref` are handled inline, `contentType` goes through the backend's `ContentCollection` pipeline, and any other discriminator returns `{}`, so a canvas previewing a `[param]` page driven by a third-party or connector source offers no values.
- The reference implementation: `resolvePaths` with `"discriminator": "contentType"` in `extensions/parser/src/Content.class.json`, and its `ContentPathsSource` shape in `extensions/parser/schemas/document.fragment.schema.json`, which the entry document unions into `PathsValue`.
- The connector's `Data` section class (`extensions/connector/src/Data.class.json`), its table query classes (`TableQuery`, `TableEntry`), and the `local` stand-ins the dev server uses (`resolveConnectorStandins`, `packages/server/src/jx-mounts.ts`). The connector ships no document fragment today (`extensions/connector/jx-extension.json`).

**What is missing**

- A `resolvePaths` capability on the connector's `Data` class with a `table` discriminator, returning one parameter object per row and `_meta` where a row has a modification time.
- A document fragment contributing the table source shape to the `$paths` union (§5.3), and the §5.3 parenthetical updated when it lands.
- The studio's parameter picker dispatching by discriminator through the host (a round trip, since `resolvePaths` is not client-timed) instead of hard-coding `contentType`, so the "studio preview" consumer the role table names is true for every registered discriminator.
- A decision on where build-time rows come from: the build has no Worker bindings, so a D1 or Supabase table needs either a local stand-in, a credentialed read, or an explicit refusal for a static build.
- Rides along, spec-only: the §8 role table has lost a row to the paragraph at line 323 (the `testConnection` row is appended to it), and it has no `head` row although §8.6 and `EXTENSION_CAPABILITIES` define that role. When the row is restored, its Consumers cell becomes "studio data grid (connection test)" (the only caller is the route in `packages/server/src/data-api.ts`, reached from `packages/studio/src/services/data-service.ts` and `packages/studio/src/panels/data-grid.ts`; no command in `packages/compiler/src/cli.ts` calls it), and the `bindings` row's cell drops "scaffolding" (the only caller is `packages/compiler/src/site/db-push.ts`; `packages/create` writes `wrangler.jsonc` without the capability), unless the detail phase builds either consumer.

**Related**

- extensions.md §5.3 (the paths union resource), extensions.md §12 (the connector block).
- site-architecture.md §4.3 (the `$paths` shapes the compiler expands) and site-architecture.md §8.4.1 (sitemap dating by `_meta.mtime`).
- relationships.md §1 (row references into a `data` section).
