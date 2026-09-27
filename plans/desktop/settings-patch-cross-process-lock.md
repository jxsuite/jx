---
status: drafted
disposition: implement
claims:
  - desktop.md#3.1
requires: []
workspaces:
  - packages/desktop
  - specs
  - docs
size: S
---

# Two launcher processes patching one settings store compose rather than lose an update

## Context

`specs/desktop.md` §3.1, line 79:

> **Status: Partial.** The interface, its families and the path, byte, patch, `documentBaseUrl` and `assetSpace` rules ship (`packages/studio/src/types.ts`, `packages/desktop/src/settings-store.ts`). A settings patch composes only within one launcher process: the lock in `packages/desktop/src/user-store.ts` is a per-process promise chain around the read and the write, so two chromium windows, each its own process (§9.4), patching `settings.json` at the same moment can still lose one update.

The rule is the last sentence of the patch paragraph (line 114): "A backend applies the patch under a lock that spans the read and the write, so two concurrent patches compose rather than one overwriting the other." That paragraph's motivating case is the chromium launcher, where every window is its own process. `user-store.ts` states its own limit in its header: "The mutex is per PROCESS, which is the honest limit". `docs/studio/desktop.md` (line 61) already promises users that "two windows open at once cannot overwrite each other's".

**What exists** (verified against the tree)

- `packages/desktop/src/user-store.ts`: `withStoreLock` (private) is a per-path promise chain in a module `Map`; `updateStore(file, read, mutate)` runs read, mutate and `writeAtomically` inside it; `writeStore` runs a blind `writeAtomically` inside it. `writeAtomically` does `mkdir`, writes `<file>.<pid>.<seq>.tmp` with mode `0o600`, `chmod`s it off Windows, and `rename`s it into place. The rename stops a torn file; it does not stop a lost update.
- Writers: `patchSettings` (`settings-store.ts`), registered by every chromium launcher (`src/chromium/index.ts` line 344) and by the ElectroBun window manager (`src/window-manager.ts` line 385), which is one process for all its windows; `writeCredential` (`credential-store.ts`, `credentials.json`, same limit); `writeRecents` (`recent-store.ts`, `writeStore`, whole list by design).
- `migrateLegacyStore` (`src/user-config.ts`) checks `existsSync(file)` and then `copyFile`s the legacy `~/.jx` store over the destination, outside any lock. A copy landing after another launcher's first patch overwrites that patch.
- `watchSettings` watches the config directory and ignores every filename but `settings.json`, so a sibling lockfile raises no settings event.
- `isAlive(pid)` in `src/chromium/window-registry.ts` (not exported): `process.kill(pid, 0)`, own pid is alive, `EPERM` is alive.
- Studio sends a patch through the write queue in `packages/studio/src/services/settings/kernel.ts` (`createWriteQueue`, from `write-queue.ts`), whose `onError` reports a rejected send as "Your settings could not be saved." with the error's message as its detail. Both launchers allow a request 300 s (`REQUEST_TIMEOUT_MS`, `maxRequestTime`). No other backend implements `patchSettings` (the dev-server and browser adapters omit it), so the two desktop launchers are every host this reaches.
- Tests: `packages/desktop/tests/user-store.test.ts` ("the per-path lock", in-process only), `settings-store.test.ts`, `github-signin.test.ts` (credential store), `window-registry.test.ts` (`deadPid()` via `Bun.spawnSync(["true"]).pid`). Three suites mock `node:os` with only `homedir` and `tmpdir`.

**Not this plan's.** `recent-projects.json` stays a whole-list replace sent from the webview; the lock serializes its writes but two windows can still each send a list the other has not seen. §3.1 makes no patch rule for it. The §3.1 editorial drift (member count, `panels/toolbar.ts`, the extras count) is a rider on `plan:desktop/app-structure-tree`.

## Outcome

- `desktop.md` §3.1 → Implemented. Every user-level store write through `updateStore` or `writeStore` in `packages/desktop` holds an exclusive lockfile beside the store for the length of its read and write, across processes, so two chromium windows patching disjoint keys at the same moment both land. §3.1 says the lock spans processes, how an abandoned lock is broken, and what a patch does when it cannot take one.
- `credentials.json` (§3.6) gets the same guarantee through `updateStore` with no change to `credential-store.ts`.
- `desktop.md` stays Partial (§3.3, §3.6, §4.3, §5.3, §6.1 to §6.5, §7.4, §9.3 and §10.2 remain open), so nothing graduates.

## Decisions

- **Open:** implement or reconcile. Recommendation: implement, because the lock is about 80 lines in one module with no new dependency, while reconciling would write "except across chromium windows" into a rule whose motivating case is chromium windows, and would make `docs/studio/desktop.md`'s promise false on the NixOS build.
- **Decided:** an exclusive lockfile `<store>.lock`, created with `writeFile(..., { flag: "wx", mode: 0o600 })`, held inside the existing per-path promise chain, not a kernel lock, because `node:fs` exposes no `flock`/`LockFileEx` and a `bun:ffi` binding would be a native dependency per platform (the cost §3.6 declines for the keychain). The chain stays in front so one process never contends with itself on its own lockfile and keeps FIFO order for its writers.
- **Decided:** a lock is abandoned when its holder's pid no longer resolves, or its mtime is more than 10 s old; a waiter retries every 5 to 25 ms (jittered) and gives up after 15 s with a `StoreLockTimeoutError`, never writing unlocked, because the work under the lock is one small read and one rename (milliseconds), the age bound covers a pid recycled after a crash or a reboot, the wait exceeds the bound so a stuck holder is always broken before a waiter gives up, and failing reaches the user through the kernel's existing "could not be saved" notice where writing unlocked would lose an update silently. No heartbeat: nothing under the lock can run for seconds.
- **Decided:** breaking and releasing share one compare-and-remove: `rename` the lock to a unique aside name (the only atomic take a filesystem offers), compare its content to the token expected, and `link` it back if it is someone else's. A breaker that judged a lock stale after it was re-taken therefore restores it, and a holder that was broken while stalled does not delete its successor's lock. What remains is a third writer creating the lock inside that restore window, which needs a dead or stalled holder and two contenders within microseconds; the code comment states it.
- **Decided:** `isAlive` moves to a new `src/process-liveness.ts` as `isProcessAlive`, imported by both `user-store.ts` and `window-registry.ts`, because the shared store primitive (loaded by the ElectroBun build too) should not import from `src/chromium/`. The token is `<pid> <uuid>` with no hostname: the config directory is per host, as the window registry already assumes, and `node:os` is mocked without `hostname` in three suites.
- **Decided:** `migrateLegacyStore` copies with `COPYFILE_EXCL`, because its existence check and its copy are two steps, and a legacy copy landing after another launcher's first patch is the one other path by which a concurrent launcher overwrites a patch. The existing `catch` already treats a refused copy as "start from what is there".

## Implementation

1. **`packages/desktop/src/process-liveness.ts`** (new): `export function isProcessAlive(pid: number): boolean`, the body of `isAlive` moved verbatim with its JSDoc. `src/chromium/window-registry.ts` deletes `isAlive`, imports `isProcessAlive` from `../process-liveness`, and calls it in `listWindows`.
2. **`packages/desktop/src/user-store.ts`**:
   - Imports gain `link`, `rm`, `stat` from `node:fs/promises`, `basename` from `node:path`, and `isProcessAlive`.
   - `export interface LockTiming { staleMs: number; waitMs: number }` and `const LOCK_TIMING: LockTiming = { staleMs: 10_000, waitMs: 15_000 }`.
   - `export class StoreLockTimeoutError extends Error` with `readonly file: string` and `readonly holder: number | null`; message `"<basename> is held by another Jx Studio window (pid N); the change was not saved."` (the pid clause only when known); `name = "StoreLockTimeoutError"`.
   - `readHolder(lock)`: `readFile` and `stat` together; returns `{ raw, pid, ageMs }` (`pid` from `Number.parseInt(raw, 10)`, `null` unless a positive safe integer, so an empty file mid-creation has no pid) or `null` on any error.
   - `removeLockIfHeldBy(lock, expected): Promise<boolean>`: rename to `<lock>.<pid>.<seq>.stale` (a failed rename answers `true` on `ENOENT`, already gone, and `false` otherwise), read it, `link` it back when the content differs from `expected` or cannot be read (ignore `EEXIST`) and answer `false`, else answer `true`; `rm` the aside name with `force` either way. Never throws. Every ignored error is a `try`/`catch` block, not a `.catch(() => …)` arrow (see Coverage).
   - `export async function withFileLock<T>(file, work, timing = LOCK_TIMING): Promise<T>`: `mkdir(dirname(file), { recursive: true })`; token `` `${process.pid} ${crypto.randomUUID()}` ``; deadline `Date.now() + waitMs`. Each pass: try the `wx` write and stop on success, rethrow any code but `EEXIST`, then `readHolder`; if the holder is abandoned (`ageMs > staleMs`, or a pid that `isProcessAlive` denies) and `removeLockIfHeldBy(lock, holder.raw)` answers `true`, start the next pass at once; otherwise, past the deadline throw `StoreLockTimeoutError(file, holder?.pid ?? null)`, else sleep 5 to 25 ms. The deadline is checked on every pass that does not free the path, so an abandoned lock that cannot be removed (a rename the directory refuses) times out instead of spinning without a sleep, and a vanished or unreadable holder (a lock path that is a directory) times out too. Then `try { return await work(); } finally { await removeLockIfHeldBy(lock, token); }`. Counters use `+= 1` (`eslint/no-plusplus`).
   - `withStoreLock` wraps `work` as `() => withFileLock(file, work)` before chaining it, so `updateStore` and `writeStore` both take the file lock with unchanged signatures. `writeAtomically` drops its `mkdir` (the lock's `mkdir` precedes it).
   - The header's "The mutex is per PROCESS, which is the honest limit" paragraph becomes two layers: a promise chain orders this process's writers, and a lockfile beside the store excludes every other process; the atomic rename still keeps a reader from seeing a torn file. It names the abandoned rule, the timeout, and the restore-window residual.
3. **`packages/desktop/src/settings-store.ts`**: `patchSettings`'s JSDoc says the lock spans processes. No code change.
4. **`packages/desktop/src/user-config.ts`**: `copyFile(legacy, file, constants.COPYFILE_EXCL)` with `constants` from `node:fs`; the doc comment gains one sentence on why.
5. **Docs tags**: `@docs studio/desktop` in the headers of `user-store.ts` and `settings-store.ts` (see Specs & docs).

**Integration contract.** No plan requires this one. Once it lands: `updateStore` and `writeStore` in `packages/desktop/src/user-store.ts` exclude other processes as well as this one's other writers, with unchanged signatures, so any user-level store written through them (including `writeCredential`, which `plan:desktop/github-token-stays-in-launcher` keeps using) composes across launchers; a write may reject with `StoreLockTimeoutError` after 15 s. `withFileLock(file, work, timing?)` is exported for a store that needs the lock around other work. `isProcessAlive` lives in `src/process-liveness.ts`. A store directory may briefly hold `<store>.lock` and `<store>.lock.<pid>.<n>.stale`; a directory watch must filter by the store's own name, as `watchSettings` does.

## Tests

**`packages/desktop`** (`cd packages/desktop && bun test --isolate --coverage`):

- `tests/user-store.test.ts`, new `describe("the cross-process lock")` (`deadPid()` as in `window-registry.test.ts`; `utimesSync` to age a lock):
  - "holds a lockfile beside the store for the length of the work": inside `withFileLock`'s work, `<store>.lock` reads `${process.pid} …`; afterwards neither a `.lock` nor a `.stale` name remains.
  - "waits while another live process holds the lock": a lock reading `${process.pid} someone-else`; an `updateStore` started, 60 ms later the store does not exist; the lock is removed and the update resolves with its key.
  - "breaks a lock whose holder has exited": a lock naming `deadPid()`; `updateStore` resolves promptly and no lock remains.
  - "breaks a lock older than the stale bound although its pid is alive": a lock naming `process.pid`, mtime 60 s ago; resolves.
  - The cases that pass a `timing` call `withFileLock(store, work, timing)` directly, since `updateStore`'s signature does not change.
  - "an empty lock counts as held until it is stale": an empty lock and `{ staleMs: 60_000, waitMs: 80 }` reject with `StoreLockTimeoutError` (`holder` null) and `work` never runs; aged 120 s (clear of the bound, so mtime granularity cannot make it borderline), the same call resolves.
  - "gives up rather than writing without the lock": a live foreign lock (`${process.pid} someone-else`) and `{ staleMs: 60_000, waitMs: 80 }` reject with `StoreLockTimeoutError`, `holder === process.pid`, `work` never runs, and the foreign lock's content is unchanged.
  - "a lock path it cannot read times out": `<store>.lock` is a directory (so the `wx` write answers `EEXIST` and the read fails); `{ staleMs: 60_000, waitMs: 80 }` rejects with `StoreLockTimeoutError`, `holder` null. This is the case that reaches `readHolder`'s `null`.
  - "release leaves a lock it no longer holds": work overwrites the lock with `${process.pid} successor`; afterwards the lock still reads `successor`.
  - "release tolerates a lock that is already gone": work deletes the lock; the call resolves with work's value and no `.lock` or `.stale` name remains.
  - "a lockfile error other than contention rejects at once": a store basename of 251 characters makes `<store>.lock` exceed `NAME_MAX`, and `updateStore` rejects with `ENAMETOOLONG`.
  - New `describe("across processes")`, "two processes patching disjoint keys of one store keep every key" (timeout 30 s): spawns two `Bun.spawn([process.execPath, join(import.meta.dir, "_store-writer.ts"), store, prefix, "40", barrierDir])`; each child writes `ready-<prefix>`, waits for a `go` file the parent writes once both are ready, then runs 40 sequential `updateStore(store, readStringStore, (c) => ({ ...c, [key]: key }))`. Both exit 0 and the store holds all 80 keys.
- `tests/_store-writer.ts` (new fixture; not a `*.test.ts`, and `tests/**` is outside coverage).
- `tests/process-liveness.test.ts` (new): "this process is alive"; "a reaped child is not" (`deadPid()`); "EPERM counts as alive" (`spyOn(process, "kill")` throwing `{ code: "EPERM" }`, asked about a pid other than `process.pid` so the own-pid shortcut does not answer first, restored in `finally`). Nothing covers that branch today.
- `tests/settings-store.test.ts`: "leaves no temp file behind" also asserts no name ends in `.lock` or `.stale`.
- `tests/user-config-migrate-race.test.ts` (new; mocks `node:os` as `settings-store.test.ts` does and `node:fs` as `window-registry-watch-gap.test.ts` does, with `existsSync` answering `false` for the new-location store only): "a store that appears between the check and the copy is not overwritten": the store holds `{ "patched": "yes" }`, the legacy file `{ "legacy": "yes" }`, and after `migrateLegacyStore("settings.json")` the store still reads `{ patched: "yes" }`.

**Coverage.** `packages/desktop/bunfig.toml` gates every file at `lines = 0.96, functions = 0.90`; the cases above reach every new function in `user-store.ts` and all of `process-liveness.ts` in-process (the child processes' coverage is not collected). The one arm no case can force deterministically is `link`'s `EEXIST` during a restore; it is a `catch` block, so it costs a line, whereas a `.catch` arrow would be an uncalled function against a per-file function bar of 0.90. `src/process-liveness.ts` is a new source file and ships with its test, so `bun scripts/check-coverage-manifest.ts packages/desktop` passes. Ratchet the threshold only if the workspace's worst file rises.

## Specs & docs

**`specs/desktop.md` §3.1, in place:**

- Line 79: the Partial marker becomes `> **Status: Implemented.**`.
- Line 114 is unchanged. After it, a new paragraph: "**The lock spans processes, because a window can be one.** On the chromium launcher every window is its own launcher process (§9.4), so a lock held in memory serializes nothing that matters. `updateStore` in `packages/desktop/src/user-store.ts`, which writes `settings.json` and `credentials.json` (§3.6), takes an exclusive lockfile beside the store, created only if absent, before the read and removes it after the atomic rename; within one process a promise chain orders its own writers first. A lockfile whose holder's process is gone, or which is older than any write takes (ten seconds), is broken rather than waited on, so a launcher that dies holding it delays the next patch by that bound at most. A patch that still cannot take the lock within fifteen seconds fails, and says so, rather than writing without it. What the lock cannot prevent is a holder that stalls past that bound and then finishes its write."
- §12 has no row for §3.1, so no gap closes.

**Fragment:** `bun run spec:change desktop.md minor -m "§3.1: the settings lock spans processes. A patch holds an exclusive lockfile beside the store from the read to the write, a lockfile whose holder is gone or which has outlived any write is broken, a patch that cannot take the lock fails rather than writing without it, and §3.1 is Implemented."`

**Docs** (no page cites `desktop.md#3.1`, and today no page's `code:` lists a file this plan changes; once the tags and `code:` entries below exist, `bun run docs:sync` names `docs/studio/desktop.md`, which this pull request edits):

- `docs/studio/desktop.md`: the text stays; line 61's "two windows open at once cannot overwrite each other's" becomes true on both builds. Add `packages/desktop/src/settings-store.ts` and `packages/desktop/src/user-store.ts` to its `code:` list (matching the `@docs studio/desktop` tags), so a later change to the patch or the lock prompts the page that promises it.
- `docs/extending/embedding/platform-adapter.md` (cites `desktop.md#3`): append to the "**Settings are written as patches.**" paragraph (line 198): "Apply each patch under a lock held from the read to the write, so two patches that arrive together both land. If more than one process can write your store, the lock has to span processes: the desktop app's NixOS build runs every window as a process of its own, and holds a lockfile beside the store for that reason." No em dashes.

The landing pull request deletes this plan. It does not graduate `desktop.md`.

## Acceptance

- `cd packages/desktop && bun test --isolate --coverage` passes with its per-file thresholds, and `bun scripts/check-coverage-manifest.ts packages/desktop` passes.
- The cross-process case is sensitive: with `withStoreLock` reverted to the bare promise chain locally, "two processes patching disjoint keys of one store keep every key" fails with keys missing.
- `bun run --cwd packages/desktop typecheck`, `bun run lint` and `bun run lint:typecheck` pass.
- `rg -n "function isAlive" packages/desktop/src` finds nothing; `rg -n "COPYFILE_EXCL" packages/desktop/src/user-config.ts` finds the copy.
- On the NixOS build, with two windows open, change a Preferences setting in each within the same second; `settings.json` holds both, and no `settings.json.lock` remains afterwards.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:sync` pass; `bun run plans:status --spec desktop` no longer lists §3.1.
