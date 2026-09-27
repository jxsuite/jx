---
status: drafted
disposition: implement
claims:
  - collab.md#5
requires:
  - collab/attach-failure-state
workspaces:
  - packages/collab
  - packages/studio
  - packages/server
size: M
---

# Editors that store the shared document differently never share a room, and a breaking document-format change is kept apart by the same guard

## Context

`specs/collab.md` §5, line 105:

> **Status: Partial.** Frame-layout skew is handled: `negotiateCollab` and `selectSubprotocol` (`packages/collab/src/negotiate.ts`) keep a peer that speaks another `jx.collab` token out of the room. Merge-granularity skew is not: the §3.1 layout is versioned by `COLLAB_SCHEMA_VERSION` (`packages/collab/src/schema.ts`), which is written to the room's `meta` at seed and never validated or negotiated, so two clients that store §3.1 differently still share a room. Document-format skew is handled nowhere, spec.md §3.2 included, and telling the author why holds only as far as §4's marker records.

The prose under the marker is wrong in the way the census found: it says the §2.1 subprotocol keeps granularity-skewed peers apart, and §2.1's bump rule makes that untrue by construction (the token moves only when a frame would be mis-parsed, and a layout change mis-parses no frame). The same false reasoning sits in the `selectSubprotocol` doc comment (`negotiate.ts`) and the upgrade comment in `packages/server/src/collab.ts`. The prose also sends document-format skew to spec.md §3.2, which is about validation and says nothing of it; the only format-version code is the runtime's one-shot `$schema` warning (`checkSchemaVersion` in `packages/runtime/src/runtime.ts`).

Every claim below was re-read against the tree on 2026-09-27.

**What exists**

- `COLLAB_SCHEMA_VERSION = 2` in `packages/collab/src/schema.ts` (bumped to 2 on 2026-07-28 with per-character and per-property merge; written since the package's first commit on 2026-07-07, so every seeded room carries a number). `seedStructure` writes it to `meta.schemaVersion` alongside `structureSeeded`. Its comment says it is "not currently validated on load" and that it "does not attempt to solve" §5.
- The room host `createCollabHost` in `packages/collab/src/ws-room.ts`, shared by the dev server and the platform's Durable Object (its header). Rooms live only in host memory: `ensureRoom` builds a fresh `Y.Doc` seeded with `source` from `loadSource`, `destroyRoomIfEmpty` discards it after the embedder's grace (`EMPTY_ROOM_GRACE_MS`, 30 s, in `packages/server/src/collab.ts`), and `resetDoc` discards it with an epoch bump. No host in this repository persists a Y history, so a live room at some layout means a peer at that layout is, or was seconds ago, in it. The host never reads `structure` or `meta`.
- The `open` control message (`packages/collab/src/envelope.ts`) is `{ type: "open"; path }`, sent by `sendOpen` in `packages/collab/src/ws-client.ts` on every `openDoc` and again for every entry on reconnect. `handleOpen` answers `rejectPath`'s code or `content-not-loaded` with an `error` before `opened`, then subscribes and sends `opened`, and only then does any `doc-sync` move. A host that predates a new field ignores it (`decodeFrame` parses JSON; `handleOpen` reads `path` only).
- The client's first writes to a room come from Studio's `createSession` (`packages/studio/src/collab/collab-session.ts`), which runs after `whenSynced` (sync step 2 received) and either seeds (`seedStructure`) or adopts the shared tree. Before that the client's `Y.Doc` is empty, so nothing it holds has moved.
- A refused re-open is swallowed today: after a reconnect, `ws-client.ts`'s `error` case settles `resolveOpen`, which is already `null` for an entry past its first open, so the handle stays alive, never syncs again and still reports `connected`.
- Tests: `packages/collab/tests/ws-room-host.test.ts` (raw-frame host cases, `recordingSocket`), `ws-wire.test.ts` (real host and client over `LoopbackSocket`), `schema.test.ts`, `envelope.test.ts` ("every control message shape survives"); `packages/studio/tests/collab-session.test.ts` with the `createMockCollabHub` in `collab-mock.ts`.

**What is missing**

- Any comparison of layout versions, on the host or on the client.
- A policy for a newer client meeting an older room, and for the stale-tab case the policy creates: a reloaded editor meeting its own former session during the grace.
- A stated answer for document-format skew.
- The refusal reaching the author: today every refusal before `opened` resolves `null` and shows as Solo. That is collab.md §4's item, closed by `plan:collab/attach-failure-state`, whose integration contract (`CollabOpenError` rejections for any refusal code but `binary-file` and `content-not-loaded`; `attachSession` destroying the handle and reporting `failed` on a rejected `whenSynced` or a throw) this plan builds on. That plan also deletes §5's "telling the author why" clause.

## Outcome

- collab.md §5 → Implemented: frame-layout skew is §2.1's token (unchanged); shared-document skew is a version every `open` declares, which the room host enforces before `opened` and Studio re-checks after the first sync; a breaking document-format change is a bump of that version; every refusal is §4's `failed` with a reason naming both versions and which editor to reload. No Future remainder.
- collab.md §2.1 gains one sentence saying a layout change is not a token bump.

## Decisions

- **Decided:** the version travels in the `open` control message and is judged per room by the host, not folded into the subprotocol token or the probe, because the layout belongs to a room (whichever client created it), one socket multiplexes many rooms, and `open` precedes `opened` and every `doc-sync`, so §2.1's rule that agreement concludes before document state moves still holds. An optional field in a JSON control message mis-parses nothing, so the `jx.collab.v1` token does not move and §2.1's bump rule gains no second trigger.
- **Decided:** the host compares declared integers for equality and nothing else, because the host is layout-agnostic by design (`schema.ts`: providers never parse Jx documents) and a host older or newer than its clients must still judge them. The host's own `COLLAB_SCHEMA_VERSION` plays no part.
- **Decided:** an `open` that declares no version, or a value that is not a non-negative safe integer, counts as `2` (`UNDECLARED_SCHEMA_VERSION`, a constant that never changes), because every client built between layout 2 and this change writes layout 2 and declares nothing; at the next bump the host then turns those clients away instead of admitting them unversioned. Such a client cannot learn the new code: it resolves `null` and sits in Solo. A layout-1 client (built 2026-07-07 to 07-28) is undeclared too and the host counts it as 2; Studio's own check still refuses a room one of them seeded, since it records 1.
- **Decided:** Studio also checks `meta.schemaVersion` after the first sync and before `createSession` writes, throwing so `attachSession` reports `failed`, because the gateway ships separately (§2.1) and may predate the host check. A recorded value that is not a non-negative safe integer counts as `UNDECLARED_SCHEMA_VERSION`, as on the host. It does not observe `meta` afterwards, so it misses a room seeded after it attached: two versions seeding an empty room at the same instant, or a read-only client (which never seeds) attached to an unseeded room that a writer at another version then seeds. Both exist only on a host without the check and end when that host upgrades.
- **Decided:** a `schema-version-mismatch` answering the re-open of a live handle fires that handle's reset, because the handle's room is gone for good; Studio's `onReset` re-attaches, and the fresh `openDoc` is refused and reported as `failed`.
- **Decided:** one helper, `describeSchemaSkew(roomVersion, clientVersion)` in `schema.ts`, writes the reason for both the host refusal and Studio's check, so the author reads the same sentence whichever guard fired. Older room: "This document's live session was started by an older version of Studio (shared-document version 2, this editor 3), and this editor can join once every older editor has reloaded or left." Newer room: "This document's live session was started by a newer version of Studio (shared-document version 3, this editor 2): reload this editor to join it."
- **Decided:** this plan does not bump `COLLAB_SCHEMA_VERSION`; it ships the guard at 2, because nothing here changes how the document is stored.
- **Open:** what a client does with a room at another version. Recommendation: refuse while anyone holds the room (a subscriber, or an `open` still awaiting the seed) and never migrate a live room in place; a room nobody holds is discarded with an epoch bump and re-created at the opener's version. Because a live room at another layout means a live peer at that layout, whom an in-place migration would skew instead; and without the takeover, the remedy the refusal names (reload the older editor) leaves the reloaded editor refused by its own former session for the dev server's 30-second grace, with nothing retrying it. The costs to sign: the held-over room's unsaved edits are dropped up to 30 seconds before the grace would have dropped them; and a client built before this plan whose socket drops while it is the room's only holder, and whose room is re-created meanwhile, meets today's swallowed refusal (Context) on any reconnect rather than only after 30 seconds away.
- **Open:** whether every refusal of a re-open resets the handle, not only `schema-version-mismatch`. Recommendation: yes, the same branch without the code test, and §4's reconnect step gains "An `open` refused on reconnect resets the handle, so the tab attaches again and shows why." Because today any such refusal (a file deleted or unreadable while the socket was down, a gateway's `too-large` or `rate-limited`) leaves a handle that the pill shows as Live and that never syncs again, and `plan:collab/attach-failure-state`, which lands first, does not change it. The cost: this plan then edits §4's text as well as §5's, and the wire suite gains a `content-not-loaded` re-open case. Signed no, step 5 keeps its code test and that silent state stays.
- **Open:** how document-format skew is answered. Recommendation: by the same version. `COLLAB_SCHEMA_VERSION` is redefined as the shared-document version, bumped when a peer at the previous value would misread or lose what a peer at the new value writes, whether through §3.1's layout or a breaking change to the document format an editor reads and writes; a file newer than the editor opening it is declared a document-format question outside collab.md. Because a second guard would be the same equality check over a second integer in the same `open`, and a `Future` remainder would leave §5 promising nothing about a skew this one line of rule closes. The cost to sign: the bump is a judgement made in review, as §2.1's is; nothing detects a breaking format change mechanically (a schema-fingerprint test would fire on every additive webref regeneration).

## Implementation

1. **`packages/collab/src/schema.ts`**
   - Rewrite the `COLLAB_SCHEMA_VERSION` doc comment: the shared-document version (collab.md §5); the bump rule above; declared in every `open`; enforced by the room host and re-checked by Studio after the first sync; not tied to the §2.1 token. Drop "not currently validated on load" and "does not attempt to solve".
   - Add `export const UNDECLARED_SCHEMA_VERSION = 2` with a comment saying it describes clients built before the declaration and never changes.
   - Add `export function describeSchemaSkew(roomVersion: number, clientVersion: number): string` returning the two sentences in Decisions (older room when `roomVersion < clientVersion`).
   - Add `export function roomSchemaSkew(doc: Y.Doc, clientVersion = COLLAB_SCHEMA_VERSION): string | null`: `null` unless `metaMap(doc).get("structureSeeded") === true`; the recorded `meta.schemaVersion`, or `UNDECLARED_SCHEMA_VERSION` when it is not a non-negative safe integer, is compared with `clientVersion`, and a difference returns `describeSchemaSkew(recorded, clientVersion)`. Add `export function declaredVersion(value: unknown): number` for that normalisation; `ws-room.ts` uses it too, so the host and Studio read an odd value alike.
2. **`packages/collab/src/index.ts`**: export `UNDECLARED_SCHEMA_VERSION`, `describeSchemaSkew` and `roomSchemaSkew` beside `COLLAB_SCHEMA_VERSION` (not `declaredVersion`, which `ws-room.ts` reaches through `./schema.ts`).
3. **`packages/collab/src/envelope.ts`**: `open` becomes `{ type: "open"; path: string; schemaVersion?: number }`, its comment naming the field as the shared-document version the client writes (collab.md §5); the `error` comment's code list gains `schema-version-mismatch`. The frame layout is unchanged.
4. **`packages/collab/src/ws-room.ts`**
   - `Room` gains `schemaVersion: number` and `opening: number`; `ensureRoom(path, schemaVersion)` sets both (`opening: 0`).
   - Factor `resetDoc`'s tail into an inner `discardRoom(path, room)` (clear the path from every subscriber's `subscribed`, destroy the doc, delete the room); `resetDoc` bumps the epoch, broadcasts `doc-reset` and calls it. That is the helper and signature `plan:collab/epoch-continuity` introduces, so whichever of the two lands second reuses the other's.
   - `handleMessage` passes `message.schemaVersion` to `handleOpen(conn, path, declared)`. In `handleOpen`, after `rejectPath` and before any `await`: `const version = declaredVersion(declared)`; if a live room's `schemaVersion` differs, send `{ code: "schema-version-mismatch", message: describeSchemaSkew(room.schemaVersion, version), path, type: "error" }` and return when it has subscribers or `opening > 0`; otherwise bump the path's epoch as `resetDoc` does (`issueEpoch(path)` once epoch-continuity has landed) and `discardRoom(path, room)`. Then `ensureRoom(path, version)`, `room.opening += 1` around `await room.ready` (decrement in a `finally`).
   - `destroyRoomIfEmpty` also requires `opening === 0`, because the embedder's grace timer for a discarded room can fire while the room that replaced it is still seeding, and would otherwise abandon that open silently.
   - Header: add `@docs studio/publish/collaboration`.
5. **`packages/collab/src/ws-client.ts`**
   - `sendOpen` sends `{ path, schemaVersion: COLLAB_SCHEMA_VERSION, type: "open" }` (import from `./schema.ts`).
   - `handleControl`, `error` case: for an entry that is not `opened` and whose first open already settled (`resolveOpen === null`; the `joined` flag once collab.md §3's client check has landed), a `schema-version-mismatch` calls `fireReset(path, entry)` and returns. The host never subscribed the refused open, so no `doc-close` is sent.
6. **`packages/collab/src/negotiate.ts`**: in `selectSubprotocol`'s doc comment, replace "two peers whose envelopes disagree about merge granularity (see `collab.md` §3.1)" with peers that would mis-parse each other's frames, and say that peers storing the document differently are collab.md §5's shared-document version. Comment only; the module still imports nothing.
7. **`packages/server/src/collab.ts`**: the upgrade comment's "two peers whose envelopes disagree about merge granularity must not share a room" becomes "two peers that would mis-parse each other's frames must not share a room". Comment only.
8. **`packages/studio/src/collab/collab-session.ts`**, `attachSession`: after `whenSynced` and the generation check, before `createSession`, `const skew = collab.roomSchemaSkew(handle.doc); if (skew !== null) throw new Error(skew);`, with a comment citing `collab.md §5` (qualified, for `docs:section-refs`). The `catch` from `plan:collab/attach-failure-state` destroys the handle and reports `failed`.

Every comment cites spec sections; none names this plan. `plan:collab/epoch-continuity` edits `resetDoc`, `destroyRoomIfEmpty` and the `opened` case in the same two files and factors the same `discardRoom`: a textual rebase, not an edge.

**Integration contract.** Once this lands, a plan may rely on: every `open` from the bundled client carries `schemaVersion`; `createCollabHost` keeps any two values out of one room before `opened` (refusing with `schema-version-mismatch`, or re-creating a room nobody holds), so peers of different `COLLAB_SCHEMA_VERSION` never merge on an upgraded host; Studio refuses a seeded room recorded at another value on any host; and the refusal is §4's `failed` with a reason. So a plan whose change would make a peer at the previous value misread or lose what the new value writes (a §3.1 storage change, a breaking document-format or parse change) bumps `COLLAB_SCHEMA_VERSION` in its own pull request and requires this plan. Under that rule `plan:collab/granular-writes` is not a bump: it writes the same shared types §3.1 names, and a peer at 2 reads them and self-heals per key. `plan:schema/parse-boundary-readers` judges its NFC pass under the same rule and finds it is not one. The host now discards a room's history a third way, re-creating a room nobody holds at another version, always with an epoch bump, so a plan that lists when the host issues an epoch (collab.md §3's first bullet, `plan:collab/epoch-continuity`) lists it; and `plan:collab/spec-coverage`'s room host and control-message sections, whichever lands second, carry `open`'s `schemaVersion`, the `schema-version-mismatch` code and the re-creation (Specs & docs below).

## Tests

Run `bun test --isolate --coverage` from `packages/collab`, `packages/studio` and `packages/server`, then `bun scripts/check-coverage-manifest.ts packages/collab` (and `packages/studio`, `packages/server`) from the root.

`packages/collab`:

- `tests/schema.test.ts`, new `describe("roomSchemaSkew")`: "an unseeded room is not skewed"; "a room seeded at this editor's version is not skewed"; "a room recorded at an older version names both values and says the older editors must reload" (`meta.schemaVersion` set to 1); "a room recorded at a newer version tells this editor to reload" (set to 3); "a recorded value that is not a non-negative integer counts as 2" (`schemaVersion` deleted, then `"3"`: not skewed at 2, skewed at 3).
- `tests/envelope.test.ts`, "every control message shape survives": add an `open` with `schemaVersion: 2`.
- `tests/index.test.ts`, the barrel test: the three new exports.
- `tests/ws-room-host.test.ts`, new `describe("shared-document version")`, raw frames through `recordingSocket` (no literal epochs, which `plan:collab/epoch-continuity` changes):
  - "an open declaring another version than its room's is refused before opened": A opens at 2; B at 3 gets `error` `schema-version-mismatch` for the path, no `opened`, and `subscriberCount` stays 1.
  - "an open that declares nothing counts as version 2": undeclared A; B at 2 is `opened`; C at 3 is refused.
  - "a value that is not a non-negative integer counts as undeclared": `schemaVersion: "3"` then `-1` are admitted beside an undeclared opener.
  - "a room nobody holds is re-created at the opener's version": A at 2 opens and closes; B at 3 gets `opened` at an epoch other than A's; C at 2 is then refused.
  - "a room still seeding is held by its open": a deferred `loadSource`; A at 2 opens; B at 3 is refused; resolving the load sends A `opened`.
  - "destroyRoomIfEmpty spares a room whose open is still seeding": deferred load, `destroyRoomIfEmpty` mid-seed, the open still completes.
- `tests/ws-wire.test.ts`:
  - "a client is refused from a room another version created": a raw socket opens the path at 3; `openDoc` rejects with `CollabOpenError` code `schema-version-mismatch` and the newer-room sentence (proves the client declares 2).
  - "a refusal answering a re-open resets the live handle" (a connection with `reconnectDelayMs: 1`, as the existing reconnect test builds): A syncs; the socket drops; `host.resetDoc` then a raw open at 3 re-create the room; on reconnect A's `onReset` fires once, and a fresh `openDoc` rejects with the same code.

`packages/studio`, `tests/collab-session.test.ts`, `describe("session attach")`: "a room seeded at another shared-document version fails with the reason and writes nothing": `seedStructure(hub.serverDoc(PATH), …)` then `metaMap(…).set("schemaVersion", 3)`; after `openTab`, `status` is `failed`, `attachError` names 3 and 2, `hub.connectionCount(PATH)` is 0, the server doc's state vector is unchanged and the tab keeps its own document (today it adopts the shared tree).

`packages/server`: comment only; its suite and manifest check must stay green.

Coverage: no new source file. Per-file thresholds: `packages/collab/bunfig.toml` (lines 0.98, functions 0.96), `packages/studio/bunfig.toml` (0.958, 0.941), `packages/server/bunfig.toml` (0.96, 0.95); every new branch above has a case. If `ws-room.ts`, `ws-client.ts` or `schema.ts` was the collab workspace's worst file and rises, ratchet its `coverageThreshold` to just below the new minimum.

## Specs & docs

**collab.md §5**, in place (heading unchanged). Replace the marker with `> **Status: Implemented.** packages/collab/src/negotiate.ts, schema.ts, ws-room.ts, ws-client.ts; packages/studio/src/collab/collab-session.ts; packages/collab/tests/ws-room-host.test.ts, ws-wire.test.ts, schema.test.ts.` and the body (from "Two different things can be out of step" to "the document diverged.") with:

```markdown
Three things can be out of step between two editors, and each has one guard. Conflating them is what hid the second.

**Frame layout.** Peers that would mis-parse each other's frames speak different `jx.collab` subprotocol tokens, and §2.1's negotiation keeps them apart: an incompatible peer never opens a socket, or is refused on the handshake.

**Shared-document version.** Peers that parse every frame alike can still disagree about the document the frames carry: where §3.1 stores a position, or what an editor reads and writes there. That agreement is one integer, `COLLAB_SCHEMA_VERSION` (`packages/collab/src/schema.ts`), recorded in the room's `meta.schemaVersion` when the structure is seeded. It is bumped when a peer at the previous value would misread or lose what a peer at the new value writes, and not for a change the previous value reads as it is, such as a finer write onto the shared types §3.1 already names. It is independent of the §2.1 token: neither bump implies the other.

- Every `open` control message declares the client's value as `schemaVersion`. The room host records the value of the `open` that creates a room, counting an `open` that declares none as `2` (the value when the declaration shipped), and answers an `open` declaring another value with an `error` of code `schema-version-mismatch` before `opened`, so no document state moves in either direction. The host compares values and nothing else: it never reads the document, and its own version plays no part.
- An `open` at another value for a room nobody holds (no subscriber, and no `open` awaiting its seed) is not refused: the host discards the room with an epoch bump, as a reset does (§3), and creates it again at the opener's value. Its unsaved edits go with it, as they would have when its teardown grace ran out.
- This refusal, answering the re-open of a live handle after a reconnect, resets that handle, so the editor attaches again and is told why.
- Studio also checks the room it joined: when a seeded structure's `meta.schemaVersion` differs from its own, it leaves after the first sync and before it writes anything. That is the guard against a host that predates the declaration, which the separately deployed gateway can be (§2.1).
- Every refusal reaches the author as §4's `failed` state, with a reason naming both values and which editor to reload.

**Document format.** A breaking change to the Jx document format is a shared-document version bump like any other, so two editors that would read or write the format differently never share a room. What an editor does with a file whose format is newer than it supports is a question for the document format, not for co-editing, and is outside this specification.

The failure each guard replaces was the worst kind: everything appeared to work, and the document diverged.
```

(If the Open decisions are signed differently, the takeover bullet, the re-open bullet and the Document format paragraph change with them; the re-open Open, signed yes, also adds its sentence to §4's reconnect step.)

**collab.md §2.1**, the "One token per envelope major" paragraph gains a last sentence: "Nor is it bumped when peers would store the document differently: their frames still parse, and §5's shared-document version is what keeps them apart."

**Sections another collab plan may have written first.** If collab.md §1.1 and §2.3 exist (the room host and control-message sections): §2.3's `open` row gains `schemaVersion?` ("the shared-document version this client writes, §5"), its code table gains `schema-version-mismatch` ("an `open` declares another shared-document version than the room's, §5" / "ends the attach before `opened`, or resets a handle whose re-open it answers, §4"), and §1.1's **Opening** bullet gains "An `open` declaring another shared-document version than a room someone holds is refused the same way, and a room nobody holds is re-created at the opener's version (§5)." If §3's first bullet lists when the host issues a new epoch, add "or re-creating a room nobody holds at another shared-document version (§5)" to that list.

**Fragment**: `bun run spec:change collab.md minor -m "§5: every open declares the shared-document version, the room host refuses an open at another version before opened and re-creates a room nobody holds, Studio leaves a joined room recorded at another version before writing, a breaking document-format change is a version bump, and every refusal reaches the author as the failed state with its reason."`

**Graduation**: this plan closes §5 only. If §5 is collab.md's last open item when it lands (`bun run plans:status --spec collab`), the pull request graduates the spec instead of writing the fragment: `**Status:** Implemented`, `bun run spec:bump collab.md minor -m "…"` in place with the sentence above, and `plans/collab/` deleted.

**Docs** (no em dashes). No page anchors `collab.md#5`; `bun run docs:sync` names `docs/studio/publish/collaboration.md` through `collab-session.ts` and `packages/server/src/collab.ts`.

- `docs/studio/publish/collaboration.md`: add `packages/collab/src/ws-room.ts` and `packages/collab/src/ws-client.ts` to `code:` where not already listed. Under "Falling back to solo", after the wire-format bullet, add: "- **Editors on different versions of Studio** that store the shared document differently never join one session. Whoever arrives second sees **Not connected**, and the reason on hover says which editor to reload. If the older editor was the only one in the file, reloading it is enough: its old session is replaced by one the updated editor joins with **Collaborate: Share this document**."
- `docs/extending/embedding/backend-protocol.md` (not named by `docs:sync`, but it is where a backend author reads the `collab` contract): after the `protocols` paragraph, add: "Each `open` control message also names the shared-document version the editor writes, as `schemaVersion`. A backend built on `createCollabHost` from `@jxsuite/collab/room` keeps editors on different versions out of one document's session by itself. A backend with its own room host should answer an `open` whose version differs from the one that created the room with an `error` of code `schema-version-mismatch` before `opened`, or, when nobody is in that session, start it again at the new version. Studio also checks the room it joined, but only after the first sync."

## Acceptance

- `bun test --isolate --coverage` is green with no per-file threshold failure in `packages/collab`, `packages/studio` and `packages/server`; the three manifest checks pass.
- `bun run plans:status --spec collab` no longer lists §5, and `bun run plans:check` reports no violation for collab.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` are green.
- `rg -n "not currently validated|does not attempt to solve" packages/collab/src` and `rg -n "merge granularity" packages/collab/src/negotiate.ts packages/server/src/collab.ts` find nothing.
- `rg -n "schemaVersion" packages/collab/src/ws-client.ts packages/collab/src/ws-room.ts` shows the declaration in `sendOpen` and the comparison in `handleOpen`.
- Each new host, wire and Studio case fails against today's code: the host admits every version, the client neither declares nor resets, and Studio adopts a room recorded at 3.
