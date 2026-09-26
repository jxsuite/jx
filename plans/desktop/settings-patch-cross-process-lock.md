---
status: stub
disposition: implement
claims:
  - desktop.md#3.1
size: S
workspaces:
  - packages/desktop
---

# Two launcher processes patching one settings store compose rather than lose an update

## Context

`specs/desktop.md` §3.1, line 79:

> **Status: Partial.** The interface, its families and the path, byte, patch, `documentBaseUrl` and `assetSpace` rules ship (`packages/studio/src/types.ts`, `packages/desktop/src/settings-store.ts`). A settings patch composes only within one launcher process: the lock in `packages/desktop/src/user-store.ts` is a per-process promise chain around the read and the write, so two chromium windows, each its own process (§9.4), patching `settings.json` at the same moment can still lose one update.

The section was unmarked before the census, and the first pass recorded it as verified. Review found the lock's limit, which `user-store.ts` states in its own header ("The mutex is per PROCESS, which is the honest limit"). The rule is the last sentence of the patch paragraph: "A backend applies the patch under a lock that spans the read and the write, so two concurrent patches compose rather than one overwriting the other." That paragraph's motivating case is the chromium launcher, where every window is its own process. Disposition `implement`, because the rule is the paragraph's point. The detail phase should weigh `reconcile` (restating the rule with the per-process limit) against what a cross-process lock costs.

**What exists**

- `updateStore` and `withStoreLock` in `packages/desktop/src/user-store.ts`: a per-path promise chain, held within one process, around a read, a mutate and an atomic write (temp file, `chmod`, `rename`). The rename stops a second process from tearing the file. It does not stop a lost update.
- `patchSettings` in `packages/desktop/src/settings-store.ts`, built on `updateStore`. Every chromium launcher registers it in its own handler map (`packages/desktop/src/chromium/index.ts`). The ElectroBun window manager (`packages/desktop/src/window-manager.ts`) is one process for all its windows, so it composes.
- `writeCredential` in `packages/desktop/src/credential-store.ts`, which uses the same `updateStore` and has the same limit on `credentials.json`.
- `watchSettings`, which pushes a change on disk to every window, and `packages/desktop/tests/user-store.test.ts` and `settings-store.test.ts`, which cover the in-process behavior.
- The pid liveness test in `packages/desktop/src/chromium/window-registry.ts` (`isAlive`), which a stale-lock check can reuse.

**What is missing**

- A lock that spans processes around `updateStore`'s read-modify-write. For example, an exclusive lockfile beside the store (created with `wx`), retried within a bound, and broken when its holder's pid no longer resolves.
- A test that starts two processes patching disjoint keys of one store at the same time and asserts that both keys survive.
- Otherwise, if the detail phase reconciles: the sentence restated with the per-process limit, naming the chromium case.

**Related**

- desktop.md §9.4 (windows are processes), desktop.md §3.6 (`credentials.json` shares the store primitive).
- The §3.1 editorial drift (a nonexistent `panels/toolbar.ts`, and a count of launcher-only extras that leaves out `githubAuth`) rides on `plan:desktop/app-structure-tree`.
