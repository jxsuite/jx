---
status: stub
disposition: reconcile
claims:
  - desktop.md#9.3
size: S
---

# §9.3 describes the Nix build and the workflow that runs it as they are

## Context

`specs/desktop.md` §9.3, line 906:

> **Status: Partial.** The package, its desktop entry, the cache and the release gate ship (`packages/desktop/package.nix`, `packages/desktop/jx-studio.desktop`, `.github/workflows/nix.yml`), but three statements below are stale. The build phase runs `scripts/pre-build-rpc.ts`, not `pre-build.ts`; `src` is `lib.cleanSourceWith` over `lib.cleanSource` with `vendor` filtered out, not a plain `lib.cleanSource ../..`; and `nix.yml` has no pull-request trigger: `test.yml` calls it only on `release-please--` branches, and the path list survives only on its push-to-`main` cache trigger.

The section was unmarked before the census. Disposition `reconcile`: each of the three changes was deliberate and is documented where it was made (the `vendor` filter in `package.nix` after #250; the branch gate in `nix.yml`'s header and in `test.yml`'s `nix` job), so the spec text is what lags.

**What exists**

- `packages/desktop/package.nix`: `src = lib.cleanSourceWith { src = lib.cleanSource root; filter = … != "${root}/vendor"; }`, and a build phase of `bun run build` then `bun run --cwd packages/desktop scripts/pre-build-rpc.ts`.
- `.github/workflows/nix.yml`: `push` to `main` (path-filtered, for the cache), `workflow_call` from `test.yml` and `release-please.yml`, `schedule`, `workflow_dispatch`; no `pull_request`.
- `.github/workflows/test.yml`'s `nix` job, `if: startsWith(github.head_ref, 'release-please--')`, required by the `ci` aggregate.
- `packages/desktop/tests/electrobun-config.test.ts`, which asserts the `vendor` filter.

**What is missing**

- The build-phase bullet naming `pre-build-rpc.ts`, the "Which ref a consumer gets" paragraph stating the `vendor` filter and why a fetched tarball and a checkout must evaluate to one store path, and the paragraph beginning "`release` never advances" saying the pull-request leg runs on the release pull request through `test.yml`, with `push: main` as a cache trigger rather than a check.
- An optional rider: the `bun.nix` auto-refresh bullet is true of a local `bun install` (the root `postinstall` skips it under `CI`), but the invariant CI holds is that `bun.nix` matches `bun.lock` at every release (`scripts/check-bun-nix.ts`, `.github/workflows/release-bun-nix.yml`), which the bullet does not say.

**Related**

- desktop.md §9.2 (the launcher the wrapper runs), desktop.md §7.4 (the ElectroBun build's `pre-build.ts`).
