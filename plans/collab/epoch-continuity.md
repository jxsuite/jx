---
status: drafted
disposition: implement
claims:
  - collab.md#3
requires:
  - collab/granular-writes
workspaces:
  - packages/collab
  - packages/server
size: M
---

# A room's Y history never changes under a client without an epoch the client acts on, across reconnects, teardowns and restarts

## Context

`specs/collab.md` §3, line 52:

> **Status: Partial.** Convergent seeding and origin-scoped undo ship (`packages/collab/src/ws-room.ts`, `schema.ts`, `packages/collab/tests/convergence.fuzz.test.ts`, `packages/studio/tests/collab-undo.test.ts`). The epoch invariant does not. `packages/collab/src/ws-client.ts` compares an `opened` epoch only while `entry.opened` is set, which its `onclose` clears for every doc, so a client that reconnects after its room was reset adopts the new epoch and merges its old history into the fresh one; `destroyRoomIfEmpty` (`ws-room.ts`, called by `packages/server/src/collab.ts` after its 30-second empty-room grace) destroys a room's `Y.Doc` without bumping its epoch; and epochs live in memory, so a restarted dev server numbers every room from 0 again. The op-bridge bullet holds only as far as §3.1's marker records.

The first bullet ("Y history is never deleted or replaced without an epoch bump") is the invariant `envelope.ts`'s header says exists to prevent duplicate-content merges, and it fails in the one case it was written for: a client that was away while the room's history moved. A census reviewer reproduced both paths with the real `createCollabHost` and `createWsCollabConnection` over a socket that closes both ends: after a `resetDoc` the rejoined room's source read `ORIGINALCHANGED` with no reset fired, after a teardown `ORIGINALORIGINAL`. Re-read against the tree on 2026-09-27; the mechanism below confirms both.

**What ships**

- The client (`ws-client.ts`). `handleControl`'s `opened` case (line 159) fires `fireReset` only when `entry.opened && entry.epoch !== message.epoch`. `ws.onclose` (line 330) sets `opened = false` on every entry; `ws.onopen` (line 282) re-sends `open` for every entry; so the `opened` that answers a reconnect always meets `opened === false`, adopts the epoch, and the step1/step2 exchange that follows pushes the old history into the new room. Local updates are gated on `entry.opened`, so nothing leaks before that `opened`.
- The host (`ws-room.ts`). `epochs` (line 83) is an in-memory `Map` whose comment promises "re-opened docs never reuse a dead history's epoch"; `ensureRoom` (line 132) opens at `epochs.get(path) ?? 0`; `resetDoc` (line 438) bumps, broadcasts `doc-reset` to current subscribers and discards the room; `destroyRoomIfEmpty` (line 415) discards the room without a bump; the stale-frame reply in `handleDocSync` (line 221) sends `epochs.get(path) ?? 0`. Every `ensureRoom` builds a fresh `Y.Doc` seeded from `loadSource`, so no host instance ever resumes a history it did not create.
- The dev server (`packages/server/src/collab.ts`) calls `destroyRoomIfEmpty` from `onEmpty`'s `EMPTY_ROOM_GRACE_MS` timer and `resetDoc` from `handleExternalChange`, which returns early for a path with no room (line 183). The platform's Durable Object runs the same host outside this repository and loses its memory on eviction, which is the restart case again.
- Epochs are compared only for equality: the host's `handleDocSync`, the client's `handleDocSync` and the `opened` case. Nothing orders them.
- Studio (`packages/studio/src/collab/collab-session.ts`) re-attaches a tab only from `handle.onReset` (line 1103). Re-attaching seeds the structure from the tab when the room has none (`seedStructure` in `createSession`) and otherwise adopts the room's tree; `collab-session.test.ts` "a server doc-reset re-attaches against the fresh room" pins the first half.
- Tests. `packages/collab/tests/ws-wire.test.ts` "an 'opened' control at a different epoch resets the live handle" (line 371) injects `opened` on a live socket with no close; "a dropped connection reconnects, re-opens, and resyncs offline edits" (line 536) drops through `LoopbackSocket.dropFromServer`, which never closes the host side, so the room never empties. `packages/collab/tests/ws-room-host.test.ts` lines 84, 94 and 107 assert the literal epochs `0` and `1`. `packages/server/tests/collab-api.test.ts` "an empty room is torn down after the grace period elapses" already captures the 30-second timer.

**What is missing**

- A client check that survives a reconnect, and a `doc-close` when that check resets: the host subscribed the connection before answering `opened`, and nothing else unsubscribes it.
- A new epoch whenever the host discards a history (teardown as well as reset), and epochs a restarted host does not reissue.
- Regression tests that close both ends, reset, tear down or restart while the client is away, reconnect, and assert one reset and no doubled content, through the bare host and through the dev server's registry.
- §3's third bullet is §3.1's work (audit record, spec-wide decisions): §3 flips only after `plan:collab/granular-writes` lands.

**Related.** collab.md §2 (the epoch tag), collab.md §2.1 (the token's bump rule), collab.md §3.1. `plan:collab/spec-coverage` writes a room host section; whichever of the two lands second writes its epoch sentences to match this rule. `plan:collab/attach-failure-state` writes §4's state machine with its reconnect and reset steps deferring the epoch rule to §3, so neither plan edits the other's section; it also changes `openDoc` in `ws-client.ts`, a textual rebase rather than an edge.

## Outcome

- collab.md §3 → Implemented. The marker is removed and the first bullet is rewritten to the epoch rule that ships, in the pull request that lands after §3.1 is Implemented. No Future remainder.

## Decisions

- **Decided:** the client compares against the epoch it last opened the document at, held in a new `DocEntry.joined` flag that `opened` sets and `onclose` never clears, because the `opened` answering a reconnect is the only moment a returning client can see a discontinuity, and the live `opened` flag is exactly what hides it.
- **Decided:** a reset triggered by `opened` sends `doc-close` for the path before `fireReset`, and a host-sent `doc-reset` does not, because `handleOpen` subscribed the connection before answering while `resetDoc` already unsubscribed it; a `doc-close` there could fire a spurious `onEmpty` against the path's next room, and without one here a tab that never re-attaches keeps the room from ever emptying.
- **Decided:** the host issues a path's next epoch whenever it discards the path's `Y.Doc` (`resetDoc`, `destroyRoomIfEmpty`), and `doc-reset` carries the epoch the next room opens at, because the invariant is "a new history is a new epoch" and teardown is the discard that forgot it. The seed-failure branch of `handleOpen` keeps its epoch: it never sent `opened`, so no client holds it.
- **Open:** how a restarted host avoids reissuing an epoch a client still holds. Recommendation: a host-wide counter that starts at a random 32-bit value per host instance (`uint32` from `lib0/random`, the source Yjs draws client ids from), not persisted, because every host instance builds fresh histories from `loadSource`, so a persisted counter would buy continuity with a history that no longer exists; it needs no storage hook, and the platform's Durable Object is fixed by a package upgrade rather than new code outside this repository. The costs to sign: an epoch grows from 1 varUint byte to about 5 on every doc-sync frame, and a restart collides with a held epoch only with probability about n / 2^32 for n epochs issued.
- **Decided:** no subprotocol token bump and no frame-layout change, because both sides compare epochs only for equality and lib0's varUint carries any safe integer, so no peer mis-parses a frame (collab.md §2.1's bump rule). An older client against a newer host behaves as today; a newer client against an older host gains the reconnect check.
- **Open:** what a client keeps of edits it made while away when it returns to a new history. Recommendation: the existing re-attach rule, stated in §3 and the docs and not extended here: the first client into the new room seeds its structure from its own document, offline edits included, and every later one adopts that tree over its own, because a rebase needs the last-synced base the client does not keep, and today's alternative is doubled content, which is strictly worse. A notification when a re-attach overwrites local edits is a separate change.
- **Decided:** one plan with a `requires` edge on `plan:collab/granular-writes` rather than an enabling split, because §3 cannot be marked Implemented while its op-bridge bullet is false, and a split would add a plan whose only content is a marker flip for a gain of one pull request's ordering in the same spec's queue.

## Implementation

1. **`packages/collab/src/ws-client.ts`**
   - `DocEntry` gains `joined: boolean` (set by the first `opened`, never cleared); `openDoc` initialises it `false`.
   - `handleControl`, `opened` case: the guard becomes `entry.joined && entry.epoch !== message.epoch`; inside it, `sendFrame({ path: message.path, type: "doc-close" })` then `fireReset(message.path, entry)`. The adopt branch also sets `entry.joined = true`. `fireReset`, `onclose` and `onopen` are unchanged.
2. **`packages/collab/src/ws-room.ts`** (`createCollabHost`)
   - `let nextEpoch = uint32()` (import `uint32` from `lib0/random`, already a dependency). `issueEpoch(path)` records `nextEpoch` for the path, increments, and returns it; `epochOf(path)` is `epochs.get(path) ?? issueEpoch(path)`; `discardRoom(path, room)` clears `path` from every subscriber's `subscribed`, destroys the doc and deletes the room (the tail `resetDoc` has today).
   - `ensureRoom` opens at `epochOf(path)` and drops its own `epochs.set`. `handleDocSync`'s stale reply sends `epochOf(path)`.
   - `resetDoc`: `issueEpoch(path)`; with no room, return; otherwise broadcast `doc-reset` at that epoch and `discardRoom`.
   - `destroyRoomIfEmpty`: when the room is empty, `discardRoom` then `issueEpoch(path)`.
   - Rewrite the `epochs` comment and the `destroyRoomIfEmpty` doc on `CollabHost` to say a discarded room's epoch is retired and each instance starts at a random point.
3. **Comments that state the contract**: `envelope.ts`'s header (`docEpoch` names one incarnation of a document's history, is compared only for equality, is reissued for no path while a host runs, and starts at a random point per host instance; a client re-opened at another epoch resets as on `doc-reset`); `provider.ts`'s `onReset` doc gains "or a reconnect that found the room's history replaced".
4. **`packages/server`**: no source change. The registry already calls both host entry points; its tests prove the rule end to end.

**Integration contract.** Once this lands: a host never opens two histories of one path at the same epoch within an instance, and a new instance starts at a random point; `doc-reset.epoch` is the epoch the path's next room opens at; a client re-opened at an epoch other than the one it last held fires `onReset` exactly once and sends `doc-close`, while a reconnect to the same room merges offline edits with no reset; `CollabHandle`, `CollabHostOptions`, `CollabHost`, the frame layout and `COLLAB_SUBPROTOCOL` are unchanged. §3's first bullet reads as below; §4's reconnect and reset steps and the room host section cite it. `LoopbackSocket.dropBoth` in `ws-wire.test.ts` and the registry socket bridge in `collab-api.test.ts` are there for later collab tests to reuse.

## Tests

`bun test --isolate --coverage` from `packages/collab` and from `packages/server`.

- **`packages/collab/tests/ws-wire.test.ts`**. `LoopbackSocket.dropBoth()` closes the host connection and fires the client's `onclose` (a cut both ends see); `socketImplFor` also accepts `() => CollabHost`, so a test can point reconnects at a second host; `fx.connect` takes an optional `reconnectDelayMs`. New `describe("epoch continuity")`:
  - `a client away across a resetDoc resets once and never merges its old history`: open, sync, `dropBoth`, change the file, `resetDoc`, settle; `resets === 1`, `host.sourceOf` is exactly the new text, `subscriberCount` is 0 (the `doc-close` landed), and a fresh `openDoc` reads the new text.
  - `a client away across a teardown resets once, and the room holds the file once`: `dropBoth`, `destroyRoomIfEmpty`, settle; `resets === 1`, `host.sourceOf` is exactly `{"tagName":"div"}`.
  - `a client away across a host restart resets once`: host A, open, `dropBoth`, `A.destroy()`, retarget to host B over the same files, settle; `resets === 1`, `B.sourceOf` holds the file once. Its comment states the false-failure chance (two random starts about 2^-32 apart).
  - `a client back in the room it left keeps its offline edits and does not reset`: `dropBoth`, edit offline, settle; `resets === 0`, a second client reads the edit.
  - The existing `an 'opened' control at a different epoch resets the live handle` also asserts `subscriberCount` falls to 0 after settle.
- **`packages/collab/tests/ws-room-host.test.ts`**. The three literal-epoch tests become relational: `doc-sync for a never-opened path answers doc-reset at the epoch the path will open at` (the reply's epoch equals the next `opened`); `doc-sync at a stale epoch answers doc-reset at the room's epoch` (captured from `opened`); `resetDoc on a never-opened path still bumps the epoch` (differs from the earlier reply, equals the next `opened`). New: `destroyRoomIfEmpty retires the torn-down room's epoch`; `a host never reissues an epoch for a path` (three open, close, teardown rounds and two resets, all `opened` epochs distinct, each `doc-reset` epoch equal to the following `opened`); `two host instances open the same path at different epochs`. The seed is not stubbed: lib0 binds `getRandomValues` at import and Yjs client ids draw from it, so a stub would break sync, and an option that exists only for tests is not worth its API.
- **`packages/server/tests/collab-api.test.ts`**. A `WsLike` bridge that drives `registry.websocket.open/message/close` with a fake server socket, a `dropBoth()`, and a switchable registry; the 30-second capture from the grace test factored into a helper. New `describe("epoch continuity through the registry")`:
  - `a client away past the empty-room grace rejoins with one reset and the file once`.
  - `a client away across a registry restart rejoins with one reset` (`await stop()`, a second registry on the same directory).
  - `a client away across an external change rejoins with one reset and the new content` (`handleExternalChange` while the room is in its grace).

Coverage: `packages/collab/bunfig.toml` gates every file at lines 0.98, functions 0.96, and `packages/server/bunfig.toml` at 0.96 and 0.95. No source file is added, so the manifest check is unaffected; every new branch (`joined`, both `issueEpoch` callers, the no-room `resetDoc`) has a case. Raise a threshold only if that workspace's worst-file minimum rises.

## Specs & docs

**collab.md §3**, in place:

- Delete the line-52 marker (§3.1 is Implemented by then, so the op-bridge bullet holds; §3 then reads like the unmarked §2.1).
- The first bullet becomes:

  ```markdown
  - **Y history is never deleted or replaced without an epoch bump.** An epoch names one incarnation of a room's history, and peers compare epochs only for equality. The host gives a path a new epoch whenever it discards the path's `Y.Doc`, by a reset (content replaced out of band) or by tearing down an empty room; it never issues an epoch twice for a path while it runs; and each host instance starts its epochs at a random 32-bit point, so a restarted host reissues an epoch a client still holds only by chance. A client keeps the epoch it last opened a document at across reconnects: an `opened` at any other epoch, or a `doc-reset`, makes it discard its `Y.Doc` and open the document afresh rather than merge across the discontinuity, and the host answers a frame carrying any epoch but the room's with `doc-reset`. What crosses a discontinuity is the editor's document, never its Y history: the first client into the new room seeds the structure from its own document, as the next bullet describes, and every later client adopts that tree. This is what keeps a reset, torn-down or restarted room from silently diverging.
  ```

  (If the offline-edits decision is signed differently, the last two sentences change with it.)

- The paragraph under the bullets names `envelope.ts`, `ws-room.ts`, `ws-client.ts`, `schema.ts` and `provider.ts`.
- If `plan:collab/spec-coverage` has landed a room host section, its epoch sentences are rewritten to match. §4's state machine defers the epoch rule to §3 and needs no edit.
- Fragment: `bun run spec:change collab.md minor -m "§3: the epoch invariant holds across reconnects, empty-room teardown and host restarts: a client resets when it is reopened at any epoch but the one it held, the host issues a new epoch whenever it discards a room's history and starts each instance at a random point, and §3 is Implemented."`
- Graduation: if §3 is collab.md's last open item when this lands (`bun run plans:status --spec collab`), this pull request graduates the spec instead of writing the fragment: `**Status:** Implemented`, then `bun run spec:bump collab.md minor -m "…"` in place (a graduation riding on the last execution, per the release table in plans/README.md) with the sentence above, and `plans/collab/` deleted.

**Docs** (no em dashes). No page anchors `collab.md#3`, and `bun run docs:sync` names none for these files; two pages describe the behaviour and change anyway:

- `docs/studio/publish/collaboration.md`: add `packages/collab/src/ws-client.ts` and `packages/collab/src/ws-room.ts` to `code:`. Under "Falling back to solo", the offline bullet ends "…and your changes merge when you reconnect to the same session." A new bullet follows it: "If the session ended while you were away (the file was replaced, everyone had left it for about half a minute, or the server restarted), your tab joins a fresh session instead of merging into the old one, so nothing is doubled. The first person back brings their copy of the document into it, and anyone who rejoins after them takes that copy, including over edits they made while offline."
- `docs/extending/embedding/backend-protocol.md`: add `collab.md#3` to `spec:` and `packages/collab/src/ws-room.ts` to `code:`. The `collab` bullet gains a paragraph: "Studio discards its copy of a document when the backend opens it at an epoch other than the one Studio last held, and merges into it when the epoch matches. A backend that hosts rooms itself, rather than through `createCollabHost` in `@jxsuite/collab/room`, must therefore never open two different histories of one path at the same epoch: it issues a new epoch whenever it resets or tears down a room, and starts at an unpredictable point each time it starts, so a restart cannot reissue an epoch a client still holds."

## Acceptance

- `bun test --isolate --coverage` passes in `packages/collab` and `packages/server`, with the cases above listed; `bun scripts/check-coverage-manifest.ts packages/collab` and `… packages/server` pass.
- Each new wire and registry case fails against today's code: restoring `entry.opened &&` in the `opened` guard doubles the source in the resetDoc and teardown cases; dropping `issueEpoch` from `destroyRoomIfEmpty` fails the teardown cases; replacing `uint32()` with `0` fails both restart cases.
- `grep -n "Status: Partial" specs/collab.md` no longer lists §3; `bun run plans:status --who-claims collab.md#3` names no plan, and this file is deleted.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass.
