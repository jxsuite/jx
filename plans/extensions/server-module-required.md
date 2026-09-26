---
status: stub
disposition: reconcile
claims:
  - extensions.md#11
size: S
---

# The server block states that a deployable worker requires module, with no fallback

## Context

`specs/extensions.md` §11, line 527:

> **Status: Partial.** The block ships as specified except `module`'s fallback: the site build throws when `server.module` is absent (`buildMountSpecs`, `packages/compiler/src/site/site-build.ts`) rather than falling back to `$implementation`, which only the dev server dispatches through.

The census auditors read the row as divergent, and the code is the side to keep: `$implementation` is a path relative to the `.class.json`, and §12's `module` row already gives the reason a Worker cannot use one ("Workers cannot import filesystem paths"). Everything else in the section was verified: `basePath` under `/_jx/` with conflicts as registry errors (`packages/schema/src/extension-registry.ts`), ascending `order` defaulting to 100, one shared `ctx`, the generated `app.all('<basePath>/*')` wrappers (`packages/compiler/src/targets/compile-server.ts`), static `mount` with `timing: ["server"]` on `Auth` and `Data`, fail-closed without `ctx.auth` (`extensions/connector/src/worker.ts`), and the `/_jx/data` wire contract (`packages/server/src/jx-mounts.ts`).

**What exists**

- `buildMountSpecs` in `packages/compiler/src/site/site-build.ts`, which throws "server.module (a bare import specifier) is required to generate a deployable worker" when the key is absent.
- The dev server's mount dispatch in `packages/server/src/jx-mounts.ts`, which imports `$implementation` through `FormatEntry.call`.

**What is missing**

- The `module` row rewritten: required for a deployable build, with the dev server's use of `$implementation` stated as the local path. The class schema (`serverBlockDefSchema` in `packages/schema/defs/class-def.schema.ts`) is checked for the same claim in its description, and the detail phase decides whether the registry should report a missing `module` at registry build rather than at worker generation.

**Related**

- extensions.md §12 (the connector block's `module` row, which already states the Worker constraint).
- site-architecture.md §14.1 (output targets and the generated worker) and site-architecture.md §15.2 (the application tier's configuration surface).
