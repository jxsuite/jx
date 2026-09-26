---
status: stub
disposition: implement
claims:
  - extensions.md#11.1
  - site-architecture.md#15.2
size: S
workspaces:
  - packages/compiler
  - packages/server
---

# `jx db push` runs every section owner's `deploySchema` after the connector plan, so the auth extension's tables arrive through the CLI as they do through the studio push

## Context

`specs/extensions.md` §11.1, line 571:

> **Status: Partial.** The studio push composes section-owner steps after the connector plan (`pushDataSchema`, `packages/server/src/data-api.ts`). `jx db push` (`packages/compiler/src/site/db-push.ts`) runs only each connection's connector `deploySchema`, so it never pushes a section owner's steps, the auth extension's Better Auth tables included.

`specs/site-architecture.md` §15.2, line 2130:

> **Status: Partial.** Schema composition, env-var-name-only configuration and the additive connector sync ship (`packages/compiler/src/site/db-push.ts`). `jx db push` never runs a section owner's `deploySchema` (extensions.md §11.1): only the studio push composes those steps (`pushDataSchema` in `packages/server/src/data-api.ts`), so the auth extension's Better Auth tables never arrive through the CLI.

Both sections were unmarked before the census; §15.2 read as inheriting §15's `Implemented`. Its closing sentence, "the auth extension's Better Auth system tables arrive that way", is true of the studio push button and false of the CLI command the paragraph names. The two census passes found this one gap from either side, each re-verified the other's finding, and agreed that it is one code change; each could write only its own spec's directory, so the two stubs stood separately until this merge.

**Disposition: implement.** Every text that names the CLI promises the section-owner steps: extensions.md §11.1 lists `jx db push` beside the studio push button, extensions.md §15's worked example runs `jx schema && jx db push` for its table, site-architecture.md §15.2 says the auth tables "arrive that way", and the data-push route's fallback text in `packages/protocol/src/routes.ts` sends a host without the route to `jx db push`. A reconcile would also leave auth with no path to a production database. The studio push resolves providers through `resolveConnectorStandins` (`packages/server/src/jx-mounts.ts`), which substitutes a connector's `local:` stand-in, so for D1 (`"local": "sqlite"` in `extensions/connector/src/D1.class.json`) it writes the local SQLite file, and the only automatic sync is the dev server's mounts (`autoSync: true`, also in `jx-mounts.ts`); the generated worker never syncs. `jx db push` is the one command that reaches the real provider.

**What exists**

- `dbPush` in `packages/compiler/src/site/db-push.ts`, wired from `packages/compiler/src/cli.ts` (`jx db push [root] [--dry-run] [--connection <name>]`). It resolves each connection's connector by provider through `registry.connectors()` and runs its `deploySchema`, then applies each connector's `bindings` fragment to `wrangler.jsonc`. Tests: `packages/compiler/tests/cli-units-db-push-ok.test.ts` and `cli-units-db-push-fail.test.ts`.
- `pushDataSchema` in `packages/server/src/data-api.ts`, the studio push behind both the dev server's `/__studio/data/push` route and the desktop session (`dataPush` in `packages/desktop/src/project-session.ts`). After the connector plan it filters `registry.projectContributions()` to non-connector entries declaring `deploySchema`, skips an absent or `null` section, calls each with the section value, the project config and `{ connection?, connectors, dryRun, env }` (the `local:` stand-ins from `resolveConnectorStandins`), and defaults each step's `kind` to the section key. It is the only caller of a section owner's `deploySchema` in any `src/` tree. Tests: the "push with the auth extension (section-owner deploySchema)" block in `packages/server/tests/data-api.test.ts` (dry run, apply then a clean second push, and a push filtered to a foreign connection).
- `Auth.deploySchema` (`extensions/auth/src/worker.ts`), declared as a section-owner capability in `extensions/auth/src/Auth.class.json`. It compiles Better Auth's additive migration into push steps and returns none when `options.connection` names a different connection. Given no `connectors`, the auth extension resolves its database through `resolveDialect` in `extensions/connector/src/connectors.ts`, whose provider map holds only the first-party `d1`, `sqlite` and `supabase` (`resolveAuthDatabase` in `extensions/auth/src/server.ts`).

**What is missing**

- The section-owner loop in `jx db push`, ideally lifted out of `pushDataSchema` into one function both paths call, so the CLI and the studio produce the same plan by construction. The server already imports the compiler; the reverse would break the dependency direction, so the shared function lives in `@jxsuite/compiler` or `@jxsuite/schema`. `DataPushStep` is declared in `@jxsuite/protocol` (`packages/protocol/src/types.ts`), which the compiler does not depend on, so the shared function either types its steps structurally or the step type moves.
- What the CLI hands as `connectors`. The studio passes the `local:` stand-ins; a production push needs the real providers, either the registry's connector classes without the `local` substitution or nothing, which falls back to the first-party map and so fails for a third-party provider.
- How the CLI reports the steps: `DbPushResult` carries per-connection `statements` only, and `cli.ts` prints those, so section-owner steps need a place in the result and in the output, with `--connection` passed through as the studio push does.
- A test that `jx db push` on a project with an `auth` section plans the Better Auth steps, dry-run and applied.

**Related**

- extensions.md §13 (secrets and `.dev.vars`, which `readDevVars` in `db-push.ts` reads for the CLI's env).
- extensions.md §15 (the guestbook example's `jx db push` step, which this makes true, and its open design note on materialising a `data` table, which this does not address).
- site-architecture.md §12.2 (`jx db push`, the CLI surface) and site-architecture.md §15.4 (the local SQLite stand-in).
