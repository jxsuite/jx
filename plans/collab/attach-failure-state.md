---
status: drafted
disposition: implement
claims:
  - collab.md#4
requires: []
workspaces:
  - packages/collab
  - packages/studio
size: M
---

# An attach that could not open shows as Not connected with its reason, and §4 writes down the state machine it runs

## Context

`specs/collab.md` §4, line 77:

> **Status: Partial.** The four states, the freeze and read-only indicators, clearing the awareness `selection` on unbind, the undo-scope sentence and the `project.json` exclusion ship (`packages/studio/src/collab/collab-state.ts`, `collab-session.ts`, `presence-chips.ts`, `monaco-binding.ts`). An attach that could not open never reaches `failed`: `openDoc` (`packages/collab/src/ws-client.ts`) resolves `null` when the open times out (a relay that is down, a handshake `selectSubprotocol` refused) or the server refuses before `opened`; both adapters (`packages/studio/src/platforms/devserver.ts`, `cloud.ts`) return `null` after logging `negotiateCollab`'s `refused` reason with `console.warn`; and the dev server adapter caches an unanswered probe as `null` for the life of the page. `attachSession` shows every null handle as Solo (`detached`), the collapse the table exists to prevent. The state machine this section promises is not written.

Every clause of the marker was verified against the code on 2026-09-27.

**What exists**

- `attachSession` in `packages/studio/src/collab/collab-session.ts`: no `collab` member or no path is `unavailable`; a `null` handle is `detached` ("this document is simply not shared"); a throw, including `SYNC_TIMEOUT_MS` (8 s) expiring on `whenSynced` as `new Error("collab-sync-timeout")`, is `failed` with `attachError` and one `notify.warn` keyed `collab:<path>` (a second notification with the same key replaces the first, `packages/studio/src/services/notify.ts`).
- `openDoc` in `packages/collab/src/ws-client.ts`: `resolveOpen(false)` becomes `null` on the `openTimeoutMs` timer (default 10 s, neither adapter overrides it), on a failed `hydratePath`, and on any `error` control message before `opened`. The room host (`packages/collab/src/ws-room.ts`, `handleOpen`) sends those as `rejectPath`'s code or `content-not-loaded`; the dev server's `rejectPath` (`packages/server/src/collab.ts`) answers `binary-file` for media extensions and `content-not-loaded` for a path outside the accessible roots, and its `loadSource` answers `null` (so `content-not-loaded`) for a file it cannot read. `too-large` and `rate-limited` are listed in `envelope.ts` and come only from the gateway. `openDoc` also answers `null` on a destroyed connection and on a second open of a live path; Studio reaches neither, because tabs are keyed by path.
- `negotiateCollab` in `packages/collab/src/negotiate.ts` returns `{offer, refused}`, and `{collab: false}` is a `refused` sentence ("This server has collaboration disabled."). No server in this repository answers `{collab: false}`; only the gateway could.
- `collab()` in `devserver.ts` caches `_collabProbe`: a non-OK answer, a network error and a body that is not JSON all become `null` for the page. The real dev server answers an unknown `/__studio/*` path with a 404 problem (`packages/server/src/server.ts`). `collab()` in `cloud.ts` maps an unanswered probe to an empty offer and connects, as collab.md §2.1 requires. Both log `refused` with `console.warn` and return `null`.
- The PAL member: `collab?: (docPath) => Promise<CollabHandle | null>` in `packages/studio/src/types.ts`, whose comment says it "resolves null when the backend refuses a room for this doc (binary, oversized)". desktop.md §10.3 names the member and says nothing about what `null` means.
- The lifecycle §4 promises and does not write: `ensureCollab` (enablement), `attachSession`, `detachSession`, `setCollabEnabled`, `rekeyCollab`; `CollabTabStatus` in `collab-state.ts`, where `connecting` is the attach in progress and `synced`/`offline` refine `attached`; re-attach only from `handle.onReset`; reconnect in `ws-client.ts` (`onopen` re-sends `open` for every doc and re-publishes awareness, backoff from 1 s doubling to 30 s); seeding (the host seeds `source` in `ensureRoom`; `createSession` has the first writable client with `meta.structureSeeded` unset call `seedStructure`, and later clients adopt the shared tree).
- Tests: `collab-session-gaps.test.ts` "a capability that REJECTS reports a failure, not solo editing" asserts status and `attachError` but not the notification; `collab-session.test.ts` "a refused path falls back to solo editing"; `devserver-platform.test.ts` `describe("collab capability")`; `cloud-platform.test.ts` `describe("collab capability")`; `ws-wire.test.ts` "a missing file resolves null", "a rejected path resolves null", "openDoc gives up after openTimeoutMs…", "a failing hydratePath falls back to solo"; `negotiate.test.ts` "refuses a server that says collaboration is off"; `collab-presence.test.ts` `describe("collab honesty")`; `collab-commands.test.ts` `describe("collab.setEnabled")`.

**Found while detailing**

- **A sync timeout leaks its handle.** `handle` is scoped to the `try`, and the `catch` never destroys it, so the wire client's `docs` entry stays live and the next `openDoc` for that path answers `null` (one handle per doc per connection). Any retry after a sync timeout would land in the wrong state.
- **A failure after the author left overwrites Solo.** The `catch` ignores `runtime.generation`, so leaving mid-attach and then failing sets `failed` and notifies.
- **There is no way out of `failed`.** `setCollabEnabled(tab, true)` and the `collab.setEnabled` command both return early on a tab that is already enabled; only Stop then Share, a rename or reopening the tab attaches again.
- **Stub tabs attach.** `openMediaTab`, `openDiffTab` and the CSV grid (`media-open.ts`, `git-diff-open.ts`, `grid-open.ts`) open tabs with a `documentPath`, so `ensureCollab` attaches them: every image tab draws `binary-file` today and sits in `detached` (Solo), and a comparison of a deleted file draws `content-not-loaded`.
- **The reason is composed badly.** `statusTitle` and the notification append their own full stop after `attachError`, and `negotiateCollab`'s sentences already end in one.
- **The dev server test for "a server without the endpoint" exercises a 500**: its fetch stub answers unrouted paths with 500, not the 404 the real server sends.

## Outcome

- collab.md §4 → Implemented: every attach that was tried and could not complete is `failed` with an author-readable reason and one notification per attempt; a backend without collaboration, one with it switched off, and a path no room serves are `unavailable`; `detached` is only the author's own choice; Share retries a `failed` tab; and §4 carries the session lifecycle (enablement, attach, reconnect, reset, leaving and retrying, rename and close, seeding).
- collab.md §5's marker loses its clause deferring "telling the author why" to §4 (§5 stays Partial, owned by `plan:collab/room-schema-skew`).
- desktop.md §10.3 states what the `collab` member's three answers mean.

## Decisions

- **Open:** what each "no session" outcome becomes. Recommendation: `unavailable` (silent) for a probe answered 404, `{collab: false}`, a runtime with no `WebSocket` or no bound project, and the two refusals that say no room serves the path (`binary-file`, and `content-not-loaded` after the cloud's one hydration retry); `failed` for everything else, `too-large` and `rate-limited` included; `detached` only when the author leaves. Because media, comparison and grid tabs carry a path and draw exactly those two refusals, so treating them as failures would post a warning for every image opened, while `too-large` is the refusal a text author cannot predict and must be told about. collab.md §4's first paragraph already says a disabled backend "runs single-player", which is the silent state, not Solo.
- **Open:** how an author leaves `failed`. Recommendation: `Collaborate: Share this document` on a `failed` tab runs the attach again (the setter's post-condition is "joined", which a failed tab is not, so it stays an idempotent setter), the pill's title says so, and nothing retries on its own. Because the table's whole argument is that the author must "know whether to retry", and today they cannot; an automatic re-attach would need a connection-level status subscription that a failed attach has no handle to hold, and would re-notify at every backoff step.
- **Decided:** a rejection is the failure signal and `null` is `unavailable`, with the PAL type unchanged, because `attachSession`'s `catch` already implements `failed` (status, reason, keyed notification) and an adapter that returns `null` for everything keeps working, so desktop.md §3's interface table needs no edit.
- **Decided:** `openDoc` rejects with a new exported `CollabOpenError` (`code`, author-readable `message`) instead of resolving `null`, keeping `null` for `binary-file`, final `content-not-loaded`, a destroyed connection and a duplicate live path, because only the wire client knows why an open ended and both adapters can then return its promise unchanged.
- **Decided:** an open timeout is named by the connection state when it fires: `unreachable` ("Could not reach the collaboration server.") when the socket is not `connected`, `open-timeout` ("The collaboration server did not answer.") when it is, because a relay that is down and a handshake refused by `selectSubprotocol` both leave the socket unopened and the author's next step differs from a live but silent server.
- **Decided:** `negotiateCollab` gains `disabled: boolean`, true only for `{collab: false}`, whose `refused` becomes `null`, because a switched-off backend is not an envelope refusal and both adapters need to tell the two apart without re-reading the probe body. `negotiate.ts` keeps importing nothing.
- **Decided:** the dev server probe caches a 404 (`null`) and any successful answer; a network error or another non-OK status rejects with a sentence and clears the cache so the next attach asks again; a 200 that is not JSON goes to `negotiateCollab(null)` (connect offering nothing), because §2.1's "unanswered probe" rule is stated for the separately deployed gateway, while the dev server served this Studio bundle and a 404 from it means it has no collaboration. The cloud adapter's unanswered-probe rule is unchanged.
- **Decided:** a failed attach destroys any handle it holds and does nothing when `runtime.generation` moved, because a leaked handle blocks every retry and a failure the author walked away from is not theirs to hear about.
- **Decided:** `attachError` is stored without a trailing full stop, because every surface composes it after a dash and closes the sentence itself.
- **Decided:** enablement is unchanged (every tab with a path other than `project.json` attaches, stub tabs included), because grid and SVG media tabs offer a source mode that co-edits, and narrowing which tabs attach is a separate product change.
- **Decided:** §4's lifecycle names a reset only as the handle reporting that its room's history was replaced and defers the epoch rule to collab.md §3, so this plan does not require `plan:collab/epoch-continuity` and that plan changes §3, not §4, whichever lands first.

## Implementation

1. `packages/collab/src/negotiate.ts`: add `disabled: boolean` to `CollabNegotiation` (doc comment: the server answered `collab: false`; connect nothing, report nothing). Every return in `negotiateCollab` sets it; `{collab: false}` returns `{ disabled: true, offer: [], refused: null }`.
2. `packages/collab/src/ws-client.ts`:
   - Export `class CollabOpenError extends Error` with `readonly code: string` and `name = "CollabOpenError"`, and a module-private `REFUSAL_REASONS: Record<string, string>` for the codes the client can phrase: `too-large` ("This file is too large for live collaboration."), `rate-limited` ("The collaboration server is refusing new sessions for now."), `hydrate-failed` ("The file could not be loaded for co-editing."). An unmapped code keeps the server's `message`.
   - `DocEntry.resolveOpen` becomes `((outcome: CollabOpenError | boolean) => void) | null`: `true` opened, `false` resolves `null`, an error rejects.
   - `handleControl`, case `error`: the `hydratePath` rejection settles `new CollabOpenError("hydrate-failed", …)`; before `opened`, `binary-file` and `content-not-loaded` settle `false`, any other code settles `new CollabOpenError(code, REFUSAL_REASONS[code] ?? message.message)`.
   - `openDoc`: the timer settles `new CollabOpenError(status === "connected" ? "open-timeout" : "unreachable", …)`; after the await, clean up the entry as today, then `throw` an error outcome or return `null` for `false`. `fireReset` and `destroy` keep settling `false`.
   - Rewrite the `openTimeoutMs` option comment ("rejects with `CollabOpenError`") and the `openDoc` member's doc (resolves a handle, `null` where no room serves the path, rejects with the reason). Leave `packages/collab/src/index.ts` alone: `CollabOpenError` is reached through `@jxsuite/collab/client`, like the client itself.
3. `packages/collab/src/provider.ts`: `CollabCapability` doc comment states the three answers and cites collab.md §4. Comment only.
4. `packages/studio/src/platforms/devserver.ts`, `collab()`: move the probe into a local `probeCollab(): Promise<CollabNegotiation | null>` (fetch failure rejects with "Could not reach the dev server to start live collaboration."; 404 resolves `null`; other non-OK rejects naming the HTTP status; OK resolves `negotiateCollab(await res.json().catch(() => null))`). In `collab()`: `_collabProbe ??= probeCollab()`; await it in a `try` whose `catch` clears `_collabProbe` only if it still holds the same promise, then rethrows. `null` or `negotiation.disabled` returns `null`; `negotiation.refused` throws `new Error(refused)`. Delete the `console.warn`. Update the `_collabProbe` field comment and the method's doc comment.
5. `packages/studio/src/platforms/cloud.ts`, `collab()`: the unanswered-probe fallback gains `disabled: false`; `negotiated.disabled` returns `null`; `negotiated.refused` throws `new Error(refused)`; delete the `console.warn`; update the doc comment.
6. `packages/studio/src/types.ts`: the `collab?` comment says it resolves `null` where no room serves the document (no endpoint, collaboration switched off, a path such as a binary file) and rejects with an author-readable reason when an attach was tried and could not open (collab.md §4).
7. `packages/studio/src/collab/collab-session.ts`:
   - `attachSession`: declare `let handle: CollabHandle | null = null` above the `try`. After `Promise.all`, check `runtime.generation` first (destroy and return), then `null` sets `state.status = "unavailable"`. The sync timeout rejects with `new Error("The shared document did not finish its first sync.")`. In the `catch`: `handle?.destroy()`; return if `runtime.generation !== generation`; otherwise set `failed`, `active = false`, `attachError = reasonOf(error)` (the message with one trailing full stop removed) and keep the keyed `notify.warn`. Replace the "Solo, not broken" comment with collab.md §4's rule.
   - `setCollabEnabled`: when the value is unchanged, `enabled` is true, the watcher is installed and `collabState(tab).status === "failed"`, call `void attachSession(tab)` before returning. Doc comment: Share is also the retry (collab.md §4).
8. `packages/studio/src/collab/collab-commands.ts`, `collab.setEnabled` `run`: compute `retry = enabled && collabState(active).status === "failed"` and return early only when `isCollabEnabled(active) === enabled && !retry`; the "Connecting…" notice then covers the retry.
9. `packages/studio/src/collab/presence-chips.ts`, `statusTitle`: the `failed` sentence ends "Collaborate: Share this document tries again." Update the module header's "A failed attach" bullet.
10. `packages/studio/src/collab/collab-state.ts`: the `CollabTabStatus` comment says `detached` is the author having left, `unavailable` includes a path no room serves, and `connecting` is the attach in progress.

Every comment in `packages/studio` cites `collab.md §4` qualified (`docs:section-refs`), and none names this plan.

**Integration contract.** Once this lands, a plan that requires it may rely on: `StudioPlatform.collab` and `WsCollabConnection.openDoc` resolve `null` for `unavailable` and reject for `failed`; `attachSession` treats a rejection of `collab()` and a rejection of the handle's `whenSynced` alike, destroying the handle and setting `status: "failed"`, `attachError` (the message, trailing full stop removed) and one `notify.warn` keyed `collab:<path>`; a room host that refuses an `open` with an `error` control message carrying any code but `binary-file` or `content-not-loaded` reaches the author as `failed`, with `CollabOpenError.code` set to that code and the server's `message` as the reason unless `REFUSAL_REASONS` phrases it; `negotiateCollab` reports `disabled` separately from `refused`. So `plan:collab/room-schema-skew` can turn a skewed client away either on the host (a new refusal code before `opened`) or on the client (rejecting `whenSynced` after sync step 1) and needs no channel of its own. collab.md §4's lifecycle defers the epoch rule to §3, so `plan:collab/epoch-continuity` edits §3 only, and `plan:collab/spec-coverage`'s control-message section can cite §4 for what a refusal code means to the author.

## Tests

Run from each workspace directory: `bun test --isolate --coverage` in `packages/collab` and in `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/collab` and `… packages/studio` from the root.

`packages/collab`:

- `tests/negotiate.test.ts`: every `toEqual` gains `disabled: false`; "refuses a server that says collaboration is off" becomes "a server with collaboration switched off is disabled, not refused" (`disabled: true`, `refused: null`, empty offer).
- `tests/ws-wire.test.ts`:
  - "a missing file resolves null (solo fallback)" becomes "a file the server cannot read resolves null: no room serves it".
  - "a rejected path resolves null" becomes "a binary path resolves null: no room serves it".
  - "openDoc gives up after openTimeoutMs when the server never answers" asserts a `CollabOpenError` with `code: "open-timeout"` while `status()` is `connected`.
  - New "an open whose socket never connects rejects as unreachable": a `webSocketImpl` whose socket fires `onclose` without `onopen`, `openTimeoutMs: 20`; asserts `code: "unreachable"` and the entry is gone (a later open is attempted, not refused as a duplicate).
  - New "a refusal before opened rejects with its code and a sentence": a fixture whose `rejectPath` answers `too-large` for one path; asserts `code: "too-large"` and the mapped message; a second path refused with an unmapped code asserts the server's `message`.
  - "a failing hydratePath falls back to solo" becomes "a failing hydratePath rejects as hydrate-failed".
  - "connection status reports and openDoc guards" keeps its `null` for the duplicate and destroyed guards.

`packages/studio`:

- `tests/collab-session.test.ts`: "a refused path falls back to solo editing" becomes "a path no room serves is unavailable and silent": status `unavailable`, no toast.
- `tests/collab-session-gaps.test.ts`, `describe("attach lifecycle races")`:
  - "a capability that REJECTS reports a failure, not solo editing" also asserts exactly one toast, keyed `collab:pages/gaps.json`, whose message carries the reason.
  - New "an initial sync that never finishes fails with a sentence and releases its handle": `createMockCollabHub({ neverSync: true })` under `withFakeTimers`; asserts `failed`, the sentence, and `hub.connectionCount(PATH) === 0`.
  - New "a failure after the author left stays Solo and says nothing": a capability whose promise is rejected after `setCollabEnabled(tab, false)`; asserts `detached` and no toast.
  - New "Share on a failed tab attaches again, and a second failure replaces the first notice": a capability that rejects twice, then resolves from a hub; asserts one toast after two failures, then `synced` with `attachError` empty after the third attempt.
  - New "a reason's trailing full stop is not doubled": reject with "Nope."; asserts `attachError === "Nope"`.
- `tests/collab-commands.test.ts`, `describe("collab.setEnabled")`: new "Share on a failed tab tries again and says so": set `status: "failed"`, run with `enabled: true`, assert the "Connecting" notice and a second capability call.
- `tests/collab-presence.test.ts`: "a failed attach says so, and carries the reason" also asserts the title names `Collaborate: Share this document`.
- `tests/devserver-platform.test.ts`, `describe("collab capability")`:
  - "a server without the endpoint degrades to solo, probing once" routes a 404 and is renamed "a server without the endpoint has no collaboration, probing once".
  - New "a probe the server could not answer rejects and is asked again": a 500, then a network error (a `globalThis.fetch` that rejects), then a capable route; asserts two rejections with sentences, three probe calls, and a recorded socket on the third attach.
  - New "a server with collaboration switched off is unavailable, not refused": `{collab: false}` resolves `null` and nothing reaches `console.warn`.
  - New "a probe answering 200 with something other than JSON connects offering nothing" (covers the `.catch` arrow).
  - "refuses to open a socket to a server speaking an envelope this build cannot parse" asserts a rejection containing `jx.collab.v9` and no socket, instead of `null` plus a warning.
- `tests/cloud-platform.test.ts`, `describe("collab capability")`: the envelope refusal asserts a rejection instead of a warning; new "a gateway with collaboration switched off is unavailable" (`{collab: false}` resolves `null`, no socket).

Coverage: no new source file, so the manifest check has nothing new to find. Per-file thresholds hold at `packages/collab/bunfig.toml` (lines 0.98, functions 0.96) and `packages/studio/bunfig.toml` (lines 0.958, functions 0.941); every new branch above has a case. If `ws-client.ts`, `devserver.ts` or `collab-session.ts` was a workspace's worst file and rises, ratchet that `coverageThreshold` to just below the new minimum.

## Specs & docs

**collab.md §4** (in place; no heading renumbered):

- Marker: replace the Partial blockquote with `> **Status: Implemented.** packages/studio/src/collab/collab-session.ts, collab-state.ts, collab-commands.ts, presence-chips.ts, monaco-binding.ts; packages/collab/src/ws-client.ts, negotiate.ts; packages/studio/src/platforms/devserver.ts, cloud.ts.`
- First paragraph becomes: "Collab is a capability the platform may or may not expose. A backend with collaboration switched off answers the probe `{collab: false}`, a backend without it answers the probe with a 404, and against either the editor runs single-player. The lifecycle below is the whole state machine."
- The table's `Means` cells: `unavailable` "no collaboration here for this document"; `detached` "available, and the author left the session". `attached` and `failed` unchanged. No cell may open with a bold status word.
- After "An attach failure records its reason and reports it once.", add:

  "**What the platform answers decides the state.** The `collab` member (desktop.md §10.3) has three answers, and each is one state. A handle joins. `null` means no room serves this document here and nothing went wrong: a backend without collaboration or with it switched off, a runtime that cannot open a WebSocket, and a path the room host refuses by nature (`binary-file`, or `content-not-loaded` for a file it cannot read) are all `unavailable`, because media, comparison and grid tabs carry a path too, and a fault reported for every image opened would teach the author to ignore the one that matters. A rejection means the attach was tried and could not complete, and its message is the reason: a probe the dev server could not answer (an unanswered gateway probe is not a failure, §2.1), a probe advertising only envelopes this client cannot parse (§2.1), any other refusal before `opened`, an `open` that no `opened` answers within ten seconds (named as an unreachable server when the socket never opened, and as a silent one when it did), and a first sync that does not finish within eight seconds. The notification is keyed by the document's path, so a retry replaces it rather than adding another."

  "**The lifecycle.**" as a numbered list: (1) **Enablement**: a tab attaches when it opens if the platform has a `collab` member, the tab has a document path and the path is not `project.json` (below); otherwise it is `unavailable` and never attaches; a tab whose author left does not attach until shared again. (2) **Attach**: the tab shows **Connecting…** while the platform probes and the client sends `open`; the host creates the room on the first `open`, seeding `source` from the file, and answers `opened` with the room's epoch (§2); the client sends sync step 1 and the attach completes on sync step 2; the first client able to write that finds the structure unseeded derives it from its own parse of the file, and every later client adopts the shared structure (§3); the host reports the room's unsaved state in the same handshake; the tab is then `attached`, read-only when `hello` granted read permission. (3) **Reconnect**: a dropped socket shows **Offline — changes sync on reconnect** and edits keep applying locally; the client reconnects with a backoff starting at one second and doubling to thirty, re-offers its negotiated subprotocol, re-sends `open` for every document it holds and re-publishes its presence; the tab shows Live again once the socket is up; whether a room whose history moved meanwhile is merged or rebuilt is §3's epoch invariant. (4) **Reset**: when a handle reports that its room's history was replaced (§3), the tab drops the session and attaches again from (2). (5) **Leaving and retrying**: `Collaborate: Stop sharing` makes the tab `detached` and `Collaborate: Share this document` attaches it again; on a `failed` tab Share is the retry, and it probes again when the last probe could not be answered; nothing retries a failed attach on its own. (6) **Rename and close**: renaming a document detaches it and attaches under the new path; closing the tab destroys its session.

**collab.md §5**: in the marker, delete ", and telling the author why holds only as far as §4's marker records". The marker stays Partial.

**desktop.md §10.3** (Implemented, no marker change): after the paragraph ending "…against every backend that predates negotiation.", add: "The member answers in one of three ways: a handle, `null` where no room serves the document, or a rejection whose message is the reason an attach could not open. collab.md §4 maps each to what the author sees."

**Fragments**:

- `bun run spec:change collab.md minor -m "§4: an attach that could not open is failed with its reason and one notification, a backend without collaboration or with it switched off and a path no room serves are unavailable, Share retries a failed attach, and the session lifecycle is specified."`
- `bun run spec:change desktop.md minor -m "§10.3: the collab member answers a handle, null where no room serves the document, or a rejection carrying the reason an attach could not open, as collab.md §4 maps them."`

No page cites `collab.md#4` in `spec:`. Pages `docs:sync` names through `code:`, with what changes (no em dashes in any of them):

- `docs/studio/publish/collaboration.md` (`collab-session.ts`, `collab-state.ts`, `presence-chips.ts`): in "What you see", **Solo** means you stopped sharing the document rather than "nobody else is here". In "Commands", Share also tries again when the pill reads **Not connected**. In "Falling back to solo": the first bullet adds a backend with collaboration switched off and files no session covers, such as images; the wire-format bullet says the pill reads **Not connected** with the reason; the sync bullet becomes "If a session can't start (the server can't be reached, it turns the file away, or the first sync takes more than a few seconds)…", adds that the reason is also posted once as a notification and that **Collaborate: Share this document** tries again, and its last sentence reads "**Solo** means you left the session, **Not connected** means something went wrong".
- `docs/extending/embedding/platform-adapter.md` (`devserver.ts`, `types.ts`): the `collab` doc-note says "once per page (the dev server's adapter asks again after a probe it could not complete)" and gains a paragraph: resolve `null` when no session can exist for the document and Studio shows nothing; reject with an `Error` an author can read when you tried and could not open one, and Studio shows **Not connected** with it; the bundled wire client already rejects that way, so an adapter can return `openDoc`'s promise as it is.
- `docs/extending/embedding/backend-protocol.md` (not named by `docs:sync`, but it is where a backend author reads the probe): after the probe sentence, add that `{ collab: false }` means collaboration is switched off and Studio edits solo without a status pill, and that before `opened`, `binary-file` and `content-not-loaded` tell Studio no room serves the path, while any other refusal code shows the author **Not connected** with the reason.

This plan does not graduate collab.md: the whole-spec marker, §1, §2, §3, §3.1 and §5 stay open.

## Acceptance

- `cd packages/collab && bun test --isolate --coverage` and `cd packages/studio && bun test --isolate --coverage` are green with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts packages/collab` and `… packages/studio` pass.
- `bun run plans:status --spec collab` no longer lists §4; `bun run plans:check` reports no violation for collab.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` are green.
- `rg -n "Collaboration unavailable" packages/studio/src` finds nothing: neither adapter logs a refusal any more.
- In a browser (the `packages/studio:verify` recipe): run Studio on the dev server, block `/__studio/collab` WebSocket requests in the network panel and open a page. The pill reads **Connecting…**, then **Not connected** after about ten seconds, its title names an unreachable collaboration server and offers Share, and one warning appears. Unblock, run **Collaborate: Share this document**: the pill reads **Live**. Open an image: no pill.
