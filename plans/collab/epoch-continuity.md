---
status: stub
disposition: implement
claims:
  - collab.md#3
size: M
workspaces:
  - packages/collab
  - packages/server
---

# A room's Y history never changes under a client without an epoch the client acts on

## Context

`specs/collab.md` §3, line 52:

> **Status: Partial.** Convergent seeding and origin-scoped undo ship (`packages/collab/src/ws-room.ts`, `schema.ts`, `packages/collab/tests/convergence.fuzz.test.ts`, `packages/studio/tests/collab-undo.test.ts`). The epoch invariant does not. `packages/collab/src/ws-client.ts` compares an `opened` epoch only while `entry.opened` is set, which its `onclose` clears for every doc, so a client that reconnects after its room was reset adopts the new epoch and merges its old history into the fresh one; `destroyRoomIfEmpty` (`ws-room.ts`, called by `packages/server/src/collab.ts` after its 30-second empty-room grace) destroys a room's `Y.Doc` without bumping its epoch; and epochs live in memory, so a restarted dev server numbers every room from 0 again. The op-bridge bullet holds only as far as §3.1's marker records.

The first bullet is the invariant `envelope.ts`'s header says exists to prevent duplicate-content merges, and it fails in exactly the case it was written for: a client that was away while the room's history moved. A census reviewer reported reproducing both paths with the real `createCollabHost` and `createWsCollabConnection` over an in-memory socket that closes both sides on drop: after a `resetDoc` the reconnected room's source read `ORIGINALCHANGED` with no reset fired, and after a teardown it read `ORIGINALORIGINAL`.

**What exists**

- The client check in `handleControl`'s `opened` case (`packages/collab/src/ws-client.ts`): `if (entry.opened && entry.epoch !== message.epoch)` fires `fireReset`. `ws.onclose` sets `entry.opened = false` for every doc, and `ws.onopen` re-sends `open` for every doc, so the second `opened` for a doc only ever arrives with `entry.opened` false and its epoch is adopted.
- The room host (`packages/collab/src/ws-room.ts`): `epochs` is an in-memory `Map` whose comment says epochs survive teardown "so re-opened docs never reuse a dead history's epoch"; `ensureRoom` reuses `epochs.get(path) ?? 0`; `resetDoc` bumps and broadcasts `doc-reset` to current subscribers only; `destroyRoomIfEmpty` destroys the doc and deletes the room without a bump.
- The dev server (`packages/server/src/collab.ts`) calls `destroyRoomIfEmpty` after `EMPTY_ROOM_GRACE_MS` and `resetDoc` from `handleExternalChange`. The platform's Durable Object runs the same host outside this repository.
- Tests: `packages/collab/tests/ws-wire.test.ts` has "an 'opened' control at a different epoch resets the live handle", which injects `opened` on a live socket with no close first, and "a dropped connection reconnects, re-opens, and resyncs offline edits", whose loopback drop never closes the host side. Neither runs the real sequence.
- `collab-session.ts` re-attaches a tab only from `handle.onReset`, so a reset the client never fires is a merge nobody sees.

**What is missing**

- A client check that survives a reconnect: compare against the epoch the doc was last opened at (or keep an ever-opened flag separate from `opened`).
- An epoch bump when a room is torn down, and an epoch that survives a server restart: persisted, or replaced by a per-incarnation room id the envelope's `varUint` epoch can carry without a frame-layout change (§2.1's bump rule).
- Regression tests that close both sides of the socket, reset or tear down the room while the client is away, reconnect, and assert one reset and no duplicated content, for the dev server's registry as well as the bare host.
- §3's third bullet is §3.1's work. Because §3 states it, this plan closes §3 only after `plan:collab/granular-writes` has landed, so the detail phase adds that `requires` edge.

**Related**

- collab.md §2 (the epoch tag), collab.md §2.1 (the token's bump rule, if the epoch's meaning changes), collab.md §3.1.
- The room host's epoch lifecycle is also on `plan:collab/spec-coverage`'s list of shipped-but-unspecified modules; whichever lands second writes it to match.
