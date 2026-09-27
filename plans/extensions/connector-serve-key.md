---
status: drafted
disposition: reconcile
claims:
  - extensions.md#12
requires: []
workspaces:
  - extensions/connector
  - packages/schema
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: S
---

# The connector block names only keys a host reads, with the unread serve key struck

## Context

`specs/extensions.md` §12, line 586:

> **Status: Partial.** `provider`, `kind`, `local` and `module` ship (`packages/server/src/data-api.ts`, `resolveConnectorStandins` in `packages/server/src/jx-mounts.ts`, `buildMountSpecs` in `packages/compiler/src/site/site-build.ts`). `serve` is declared by `D1`, `Sqlite` and `Supabase` and read by no host: the data mount is found through `Data.class.json`'s own `server` block.

The section was unmarked before the census. Verified at the audited tree:

- **Nothing reads `serve`.** The key has been in the spec since the v2 framework (3fb8795f) and in the descriptors since the connector landed (3085ab4d). Every host reads the other four: `provider`, `kind` and `local` in `providerEntry`, `withDb` and `listDataConnections` (`packages/server/src/data-api.ts`) and in `resolveConnectorStandins` (`packages/server/src/jx-mounts.ts`); `module` in `buildMountSpecs` (`packages/compiler/src/site/site-build.ts`), which hands it to the worker's `import { <Class> } from '<module>'` line (`packages/compiler/src/targets/compile-server.ts`). `connectorByProvider` in `packages/compiler/src/site/db-push.ts` reads `provider` only.
- **The data mount does not need it.** `Data.class.json` carries its own `server` block (`/_jx/data`, order 20, `module: "@jxsuite/connector/worker"`), which is what `buildMountSpecs` and `buildRuntime` activate. `handleDataRequest` (`extensions/connector/src/worker.ts`) is provider-agnostic: `DataMountOptions.connectors` is `Record<string, DataMountProvider>`, and a provider is only `{ kind, dialect }`.
- **Where the key lives.** `"serve": "@jxsuite/connector/worker"` in `extensions/connector/src/D1.class.json` (line 14), `Sqlite.class.json` (13) and `Supabase.class.json` (13), asserted in `extensions/connector/tests/extension-manifest.test.ts` (line 92). `serve?: string` on `ConnectorBlock` (`packages/schema/src/format-registry.ts`, line 135), which does not type `module` even though `buildMountSpecs` reads it. `serve` in `connectorBlockDefSchema` (`packages/schema/defs/class-def.schema.ts`, line 257, "Module specifier exporting the serve-time worker binding."), whose leading comment still gives "D1's `module`" as an example of an undeclared extra. The generator writes that into `packages/schema/class-schema.json`, `packages/schema/schema.json` and all 28 tracked `document.schema.json` files (pointer `/$defs/v1/$defs/ConnectorBlockDef/properties/serve`).
- **Prose outside §12.** `specs/schema.md` §3.3 (line 152) lists `serve` among the class schema's connector keys. `docs/extending/extensions/connectors.md` repeats the example and the `serve` row (lines 29 and 39), has no `module` row, and mentions `module` only in a parenthetical instead.
- **A stray copy.** `packages/schema/--cwd` is a tracked, 23,204-line, stale copy of `schema.json` that 288fb73a committed, most likely from a mis-parsed `--cwd` flag. It still declares `serve`. Nothing references it, `schema:verify` never sees it (it is not a `*schema.json`), and npm never ships it (`files` takes `*.json`).
- **The `local` row understates the rule.** The row says only what `"sqlite"` does. `resolveConnectorStandins` and `providerEntry` both resolve any `local: "<provider>"` to the registered class for that provider, falling back to the connector's own class, and their doc comments cite §12 for that rule.

## Outcome

- extensions.md §12 → Implemented. The block's documented keys are the four hosts read. The section says that a connector names no serving module, because the `data` owner's mount serves every provider through `options.connectors`. The `local` row states the stand-in rule both resolvers apply.
- extensions.md stays Partial (§3, §5.4, §6.1, §7, §8, §8.1, §8.4, §8.6, §9, §9.1, §9.2, §10, §11 and §11.1 remain open), so nothing graduates.

## Decisions

- **Open:** strike `serve`, or give it a reader? Recommendation: strike it. `/_jx/data` is one `basePath`, a second mount cannot share it (a `basePath` conflict is a registry error, §11), and the one mount already serves any provider that supplies a `dialect`. A per-connector serving module would need a dispatch layer inside the data mount that routes each table to another module, and no first-party or known third-party connector needs one. A backend with no Kysely dialect would be a different extension with its own `server` block, not a connector key. If maintainers want the key wired, the disposition becomes `implement` and this plan is redrafted around that dispatch.
- **Decided:** the block stays open and does not reject `serve`, so a descriptor that still carries it validates like any provider extra. `ConnectorBlock` and the class schema are open by contract (`class-schema-drift.test.ts` asserts `additionalProperties` is not `false`), and refusing the key would break a third-party descriptor over a key that never did anything.
- **Decided:** type `module?: string` on `ConnectorBlock`, because `buildMountSpecs` reads it and the TypeScript interface should declare the same four keys as the schema, as `ServerBlock` already does for its own `module`.
- **Decided:** rewrite the `local` row to state the general rule. The section is about to read Implemented, and the two resolvers already cite §12 for a rule §12 does not state. The row's text holds whether or not `plan:_shared/db-push-section-owners` lands first: it describes only dev-server paths and the generated worker, and never `jx db push`.
- **Decided:** delete `packages/schema/--cwd` in the same change. It is the only other tracked declaration of the key, it lives in a workspace this plan already touches, and no generator will ever correct it.

## Implementation

1. **Descriptors.** In `extensions/connector/src/D1.class.json`, `Sqlite.class.json` and `Supabase.class.json`, delete the `"serve": "@jxsuite/connector/worker",` line from the `connector` block. Nothing else in the three files changes. `Data.class.json`'s `server.module` stays.
2. **`packages/schema/src/format-registry.ts`, `ConnectorBlock`.** Remove `serve?: string;`. Add `/** Bare import specifier the generated site worker imports the provider class from (§12). */ module?: string;`. Keep the index signature. The `typeof module !== "string"` guard in `buildMountSpecs` stays as it is, because descriptors are unvalidated JSON at registry build.
3. **`packages/schema/defs/class-def.schema.ts`, `connectorBlockDefSchema`.** Delete the `serve` property. Replace the two-line leading comment with: "Open by design: the block mirrors format-registry's ConnectorBlock ([key: string]: unknown), so a provider may carry keys of its own. `properties` names only the keys a host reads (specs/extensions.md §12)." Then run `bun run schema:sync`. It removes one pointer per file: `/$defs/ConnectorBlockDef/properties/serve` in `packages/schema/class-schema.json` and `schema.json`, and `/$defs/v1/$defs/ConnectorBlockDef/properties/serve` in the 28 `document.schema.json` files under `examples/`, `packages/starters/sites/*`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures/*`, `sites/jxsuite.com` and `sites/test-blank`. The `schemas.yml` lane would push the same bytes.
4. **`git rm packages/schema/--cwd`.**
5. **Tests**, as in Tests.
6. **`specs/extensions.md` §12, `specs/schema.md` §3.3, `docs/extending/extensions/connectors.md`** and the two fragments, as in Specs & docs.
7. **Plan housekeeping in the landing pull request.** Delete this file. If `plan:_shared/db-push-section-owners` has not landed, cut ", and extensions.md §12's marker (owned by `plan:extensions/connector-serve-key`) cites `resolveConnectorStandins` in `jx-mounts.ts`" from its resolver decision. The rest of that decision still justifies keeping the delegate, and without the cut, `plans:check` reports a dangling citation.

**Integration contract.** No plan requires this one. Once it lands:

- `ConnectorBlock` is `{ provider; kind; local?; module?; [key: string]: unknown }`, and `ConnectorBlockDef` declares exactly `kind`, `local`, `module` and `provider`, stays open, and is guarded by a drift test.
- extensions.md §12 says that a connector names no mount and that the data mount reaches providers only through `options.connectors`. A plan that adds a connector key a host reads has to add it to the table, the interface, the schema and that test together.
- §12 cites no function, so nothing there depends on where `resolveConnectorStandins` lives.
- `plan:extensions/server-module-required` rewrites §11's `module` row. §12's `module` row is untouched here, so either plan can land first.

## Tests

- **`extensions/connector`** (`bun test --isolate --coverage` from `extensions/connector`), `tests/extension-manifest.test.ts`:
  - In `admission blocks: connector providers, section owners, and the data mount`, delete the `serve` expectation.
  - New `each provider's connector block names only keys a host reads, and its module is a package export`. For `D1`, `Object.keys(def.connector).toSorted()` equals `["kind", "local", "module", "provider"]`; for `Supabase` and `Sqlite` it equals `["kind", "module", "provider"]`. For each of the three, `def.connector.module` starts with `@jxsuite/connector/`, and `pkg.exports[module.replace("@jxsuite/connector", ".")]` is defined, which ties `module` to an export the generated worker can import. Load `package.json` as the neighbouring test does.
- **`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`), `tests/class-schema-drift.test.ts`:
  - New `the connector block declares exactly the keys a host reads`. `Object.keys(generateClassSchema().$defs.ConnectorBlockDef.properties).toSorted()` equals `["kind", "local", "module", "provider"]`. Also, `await validateClass({ $prototype: "Class", title: "Acme", connector: { provider: "acme", kind: "sqlite", serve: "@acme/worker" } })` is `valid`, because an undeclared key stays a provider extra.
  - `every shipped extension class validates against the class schema` already covers the three edited descriptors.
- **Coverage.** No source file gains or loses logic: an interface edit, a `const` schema literal and JSON. The per-file thresholds (`lines = 0.99, functions = 0.99` in both `extensions/connector/bunfig.toml` and `packages/schema/bunfig.toml`) do not move, nothing ratchets, and no new source file needs the manifest check. Because `packages/schema` reaches nearly every workspace in `scripts/ci/affected.ts`, the pull request runs the full matrix. The regenerated `document.schema.json` files change one unread `properties` entry and no suite asserts on it.
- **Gates.** `bun run schema:verify` (fresh artifacts after `schema:sync`), plus `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown` and `plans:check` in `checks`.

## Specs & docs

**`specs/extensions.md` §12**, in place:

- The marker becomes `> **Status: Implemented.**`, the bare form §8.5 and §13.1 use.
- The example drops its `"serve": "@jxsuite/connector/worker",` line.
- The table loses its `serve` row. `provider`, `kind` and `module` stay as written. The `local` row becomes: "The provider whose class stands in for this one on the dev server. Its data mount, studio data routes and schema push resolve this connector to the registered class whose `provider` equals `local`, or to its own class when none is registered. `"sqlite"` stands it in with a local SQLite file (`.jx/data/<connection>.sqlite`, auto-synced on first use). The generated site worker always imports the connector's own `module`."
- After the table, a new paragraph: "A connector names no serving module. The `data` section's owner, `Data.class.json`, is the one data mount (§11: `/_jx/data`, order 20). Hosts hand it the provider classes in `options.connectors`, keyed by `provider`, and it opens each connection through that class's `dialect` capability (§8). A provider therefore joins the data mount by declaring this block and the connector capabilities. The block is open: a key a provider adds for its own use validates, and no host reads it."

**`specs/schema.md` §3.3**, the admission-blocks bullet: "`connector` (`provider` + `kind` required; `local`, `serve`, `module`, open for provider extras)" becomes "`connector` (`provider` + `kind` required; `local`, `module`, open for provider extras)". Nothing else in schema.md changes. `plan:schema/generator-inventory` edits the role-list bullet on the line above, and whichever pull request lands second resolves that one-line adjacency.

**Fragments:**

- `bun run spec:change extensions.md minor -m "§12 strikes the connector block's serve key, which no host read: a connector names no serving module, since the data section's owner mounts /_jx/data once and serves every provider through options.connectors; the local row states the dev-server stand-in rule for any provider"`. The level is minor: a reconcile that removes a key nothing honoured, so no author built on it.
- `bun run spec:change schema.md patch -m "§3.3 lists the connector block's declared keys without serve, matching the class schema"`. The level is patch because the change is editorial and follows the generator.

**Docs** (no em dashes). `bun run docs:sync` names two pages: `connectors.md` (its `code:` lists `D1.class.json`, and its `spec:` cites `extensions.md#12`) and `formats.md` (its `code:` lists `format-registry.ts`). `tutorial-guestbook.md` also cites `extensions.md#12`.

- `docs/extending/extensions/connectors.md`:
  - The example drops the `"serve"` line.
  - The table's `serve` row is replaced by a `module` row: "Bare import specifier for the provider implementation. The generated site worker imports the class from it and hands it to the data mount, so a deployable build requires it once any section entry names this provider."
  - The `local` row becomes: "The provider whose class stands in for this one on the dev server. `"sqlite"` serves it from a local SQLite file, auto-synced on first use."
  - The parenthetical paragraph after the table ("(The class also carries a `module` bare specifier…)") is deleted.
  - Under "The data mount", append: "A provider declares no mount of its own. The host hands this mount every provider class in `options.connectors`, and it opens each connection through that class's `dialect`."
- `docs/extending/extensions/formats.md`: no change, because it describes the `format` block only.
- `docs/extending/extensions/tutorial-guestbook.md`: no change, because it never names `serve`.

No spec graduates.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#12`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `git grep -n -e '"serve"' -e 'serve?:' -- . ':!plans'` prints nothing, and `git ls-files 'packages/schema/--cwd'` prints nothing.
- ``sed -n '/^## 12\./,/^## 13\./p' specs/extensions.md | grep -n '`serve`'`` prints nothing, and the section's first blockquote is `> **Status: Implemented.**`.
- `bun run schema:verify` is green.
- `bun test --isolate --coverage` passes from `extensions/connector` and from `packages/schema`, with the two new cases listed and no per-file threshold failure.
