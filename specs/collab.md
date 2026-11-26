# `@jxsuite/collab` Specification

## Real-Time Co-Editing for Jx Projects

**Version:** 0.2.15-draft\
**Status:** Partial\
**Updated:** 2026-11-23\
**License:** MIT

---

## 1. Overview

`@jxsuite/collab` provides multi-participant, real-time co-editing of a Jx project. Documents are modeled as [Yjs](https://github.com/yjs/yjs) shared types; edits converge via CRDT merge, so concurrent editors do not clobber each other.

The transport is one WebSocket route, `collab`, and a plain GET on the same URL is its capability probe (§2.1). The dev server serves it at `/__studio/collab`; a gateway serves it under its own prefix with the same sub-path (desktop.md §5.1). Two backends serve it, and both host their rooms with the same module, `createCollabHost` (`@jxsuite/collab/room`):

- **The dev server** (`packages/server/src/collab.ts`, routed in `server.ts`) whenever it serves the Studio API, which is its default (`studio: true`). Every connection gets a local identity, `local-1`, `local-2` and so on, with write access.
- **The cloud gateway**, deployed separately from this repository, which Studio reaches through its cloud adapter (`packages/studio/src/platforms/cloud.ts`) at `collab` under the session's base path, with real identities and per-person write or read access.

**The desktop app offers no co-editing.** Neither launcher routes `collab` (the project server each starts, `packages/server/src/project-server.ts`, has no such route), and the platform adapter (`packages/desktop/src/webview/platform.ts`) has no `collab` member, so every document there is `unavailable` (§4) and edits solo with file-level saves (desktop.md §3, §10.3). What a backend without collaboration answers to the probe, and what the editor shows, is §4's rule.

### 1.1 The Room Host

> **Status: Implemented.** `packages/collab/src/ws-room.ts`, `packages/collab/tests/ws-room-host.test.ts`, `ws-wire.test.ts`.

Every backend hosts its rooms with one module, `createCollabHost` (`@jxsuite/collab/room`, `packages/collab/src/ws-room.ts`). The host owns the wire; the embedder owns everything else: the sockets, an identity and permission per connection, the file text a room starts from (`loadSource`), the paths it refuses (`rejectPath`) and what a flush writes (`onFlush`, §1.2). The host never parses a Jx document: it seeds and reads `source` and never reads `structure` or `meta`.

- **Connecting.** The host greets each connection with `hello`, carrying its identity and permission (§2.3), then sends the current presence roster (§2.4).
- **Opening.** The first `open` for a path creates its room: one `Y.Doc` whose `source` the host seeds from the file. A path the embedder refuses, or whose text cannot be loaded, is answered with `error` before `opened`, so no document state moves (§4 says what the author sees). Otherwise the host subscribes the connection and sends `opened` with the room's epoch, `doc-dirty` with the room's unsaved state (§1.2) and sync step 1; the client answers with step 2 and its own step 1, and the attach completes on the host's step 2.
- **Editing.** Every update the host applies is relayed to the room's other subscribers. A read-only connection's sync step 1 is answered and nothing else it sends to a document is applied; the first refusal is reported with `error` `read-only`, once per connection, and its `flush` and `revert` change nothing (§1.2).
- **Epochs.** A room carries an epoch. A `doc-sync` at another epoch, for a path the connection has not opened, or for a room that no longer exists is answered with `doc-reset` at the path's current epoch, and `resetDoc` is how an embedder replaces a room's history. When the host issues a new epoch is §3's first bullet.
- **Presence** is one channel per project, not per room: the host relays every awareness update to every other connection and, when a socket closes, withdraws the states it published and tells the rest (§2.4).
- **Leaving.** `doc-close` unsubscribes a connection from one room, and a closed socket from all of them. When a room's last subscriber leaves, the host tells the embedder (`onEmpty`), which decides when to discard it (`destroyRoomIfEmpty`).
- **Unknown input.** A frame the host cannot decode is answered with `error` `unknown-frame`, which carries no path, and dropped; a control message of a type it does not know is ignored (§2.2).

### 1.2 Persistence

> **Status: Implemented.** `packages/collab/src/ws-room.ts`, `ws-client.ts`, `packages/server/src/collab.ts`, `packages/studio/src/collab/collab-session.ts`, `packages/studio/src/publish/publish-changes.ts`, `packages/collab/tests/ws-wire.test.ts`, `packages/server/tests/collab-api.test.ts`, `collab-rooms.test.ts`.

Syncing is not saving. Edits reach every peer as they are made, but a room's text reaches storage only when a client **flushes** it, and a flush is what an author's Save sends. Only saved edits reach disk.

- **What is saved** is the room's `source`. Studio's Save mirrors the structure into it first while the structure is canonical, and flushes the text as it stands while a Code view holds the lock (§3.2), so what is written is what the saver sees.
- **Unsaved state belongs to the room.** A room is unsaved while its `source` differs from the text last written or seeded. The host sends `doc-dirty` to every subscriber when that changes and to each joiner during `open`, so one author's edit marks the document unsaved for everyone and one author's save clears it for everyone. The embedder reports each durable write with the text it wrote (`markPersisted`), so an edit made while that text was being written leaves the room unsaved.
- **A flush answers once.** Every `flush` gets one `flush-ack`: without `error` the text is durable; with `error` nothing was written, and `error` says why in a sentence an author can read. A flush from a read-only connection, or for a document the connection has not opened, is refused that way, and so is a save the embedder refused (a stale base, §2). The host handles a path's flushes one at a time, in the order they arrive, whichever connection sent them, so each answer follows its own write. Studio's Save fails with that reason, and fails too when the socket closes, the document resets or the connection ends before the answer arrives. Committing saves every co-edited document first and stops, naming each file it could not save.

**The dev server** (`packages/server/src/collab.ts`) writes a flushed room's `source` to the file it was seeded from, skipping a write of the text it last wrote; a failed write answers the flush with the reason and leaves the room unsaved. It keeps a room nobody holds for 30 seconds and then discards it with any unsaved edits. A change to the file that is not its own write, whether the project state host saw it or the Studio API renamed the file, resets the room (§3) or, where the room holds unsaved edits inside the project, conflicts it (§2), so no peer can save the old text back over it. Stopping the dev server writes nothing: its rooms are dropped with any unsaved edits. A tab still open keeps those edits in its own document, and its author's next Save writes them once the server is back; how the tab rejoins is §3's. The one write the registry makes without a Save is when another project is activated: the rooms of the project being closed are saved through its host first, so switching projects loses nothing.

**The gateway** keeps its rooms in its own storage, outside this repository, under the same contract.

## 2. Wire Protocol

- **Transport:** a single WebSocket per project session. Sync and awareness frames use the standard `y-protocols` encodings (sync step 1/2, update, awareness).
- **Reconnect:** a dropped socket retries on **equal-jitter** exponential backoff (`packages/collab/src/reconnect.ts`): the window doubles from 1 s to a 30 s ceiling, and each delay is drawn from the upper half of its window. Every client on a server loses its socket at the same restart, and plain doubling brings them back in lockstep, one spike per wave; the jitter spreads each wave while the half-window floor keeps a retry from firing straight back at a server that is still down. A retry that is **pending** runs immediately on the browser's wake signals — `online`, a `pageshow` restored from the back/forward cache, and the document becoming visible — and restarts the backoff, because a laptop that wakes onto a network should not sit out a timer measured against the network it lost. A socket that is open or mid-handshake ignores them. A successful open resets the backoff, re-opens every live doc and re-publishes the local awareness state.
- **Envelope:** frames are wrapped with an **epoch** tag. The epoch is the load-bearing invariant — see §3; the frame layout is §2.2 and the control messages §2.3.
- **Awareness:** cursor/selection presence is carried out-of-band from document state via `y-protocols/awareness`, so presence churn never mutates the CRDT; the state each client publishes is §2.4.
- **Subprotocol:** `jx.collab.v1` names the frame layout, negotiated on the handshake — see §2.1.
- **Rooms by document:** a room is addressed by path in every frame, and a host may key it by something else: `createCollabHost` takes a `keyOf` from its embedder and answers each peer under the path that peer opened, so two paths naming one document share its room. The dev server keys a room inside the active project by its document, and the cloud session keys every room by its document, or by its path while the host has not indexed it (`project-state.md` §11.3), so a peer that opened a document before it moved keeps its room at the old path while a peer opening the new path joins it. Nothing on the wire changed for it.
- **Refused saves:** a host that saves a room with a base (`project-state.md` §5), as the dev server does inside the active project and the cloud session does for every room (`project-state.md` §11.3), answers a refused save with the `doc-conflict` control message, `{ type: "doc-conflict", path, diskHash, docId }`, sent to every subscriber of the room under its own path, before the requester's `flush-ack` (which carries `error`, §1.2); `diskHash` and `docId` name what is on disk now, both `null` when nothing is, and the room stays dirty. The same message reports a file that another writer changed while the room held unsaved edits: the host keeps the room and its edits rather than resetting it, and its next save is refused until a participant chooses (`project-state.md` §6.1, §11.3). It is additive: a client that does not know the type skips it, as every control message, so it moves no token (§2.1). The browser client reports it through `CollabHandle.onConflict`.
- **Resolving a conflict:** `flush` takes an optional `baseHash`, the bytes the save replaces in place of the room's own base (`null`: nothing is there), which is how a participant keeps the room's edits over what is on disk now; the host ignores one that names no content hash, and a host that saves without a base ignores it altogether. `{ type: "revert", path }` discards the room's unsaved edits: a writer's revert resets the room, so every subscriber receives `doc-reset` and reopens it seeded from the file, and the requester then receives `{ type: "revert-ack", path }`; a read-only connection, or a path the connection never opened, reverts nothing and is acknowledged all the same. Both are additive in the same way. The browser client exposes them as `CollabHandle.flush({ baseHash })` and `CollabHandle.revert()`, whose promise settles on the acknowledgement or on the reset it caused. A client whose room was reset re-reads the file before it reopens the room, so the first participant back seeds the room's structure from the file rather than from the edits the old room held. A Code view bound to the old room's shared text is mounted again for the fresh room (or for no room), since the text it was bound to is gone (`onCollabSessionChange` in `packages/studio/src/collab/collab-session.ts`, `packages/studio/src/canvas/canvas-render.ts`). Neither joining a room nor taking its source lock replaces text that already says what the tab holds: the Code view seeds the shared text from its serialization of the structure only when the text does not parse to the tab's document and frontmatter, and the structure mirror (a save's included) writes nothing over such a text and nothing at all while the source lock is held. So a room seeded from the file's bytes keeps them, byte for byte, until someone edits.
- **No compression.** `permessage-deflate` (RFC 7692) is never negotiated. A browser's WebSocket offers it on every handshake and gives a page no way to withhold the offer, so the rule binds the server: a backend declines the extension, answering the upgrade with no `Sec-WebSocket-Extensions` header. The dev server declines it by leaving Bun's `perMessageDeflate` at its default, off, and a test pins the declined offer. The reasons are structural rather than a deferral: lib0-encoded Yjs updates are near-incompressible, the dominant frame volume is awareness cursors whose payload is smaller than a deflate block header, both transports are loopback or already compressed at the edge, and Bun allocates a zlib context per socket — a real per-connection cost on a server whose whole purpose is many concurrent sockets. Adopting it would cost memory to make the wire slightly larger.

### 2.1 Subprotocol Negotiation

The socket carries a **WebSocket subprotocol** (RFC 6455 §1.9, §4.2.2), and it names the **wire envelope**, not the package version: `jx.collab.v1` means "I speak the frame layout §2 describes".

**One token per envelope major.** The token is bumped when a peer's frame would be _mis-parsed_ — a field reordered, a type widened, a length prefix changed. It is **not** bumped for a new frame type, because both halves already skip a type they do not know: bumping there would refuse a room that would have worked.

**The capability probe is where the two sides agree.** `GET /__studio/collab` answers `{collab, protocols, version}`, and `protocols` is the negotiation input:

| The server advertises               | The client offers            | Because                                                                                 |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| a token the client speaks           | that token                   | the handshake then echoes it, and both know the envelope matches                        |
| **no `protocols` at all**           | **nothing**                  | it predates negotiation and would echo nothing — see below                              |
| only tokens the client cannot parse | nothing; no socket is opened | a divergent-history merge is worse than no session, and here the reason can be reported |

**Why an unconditional offer would be a regression.** RFC 6455 §4.1 requires a client that offered subprotocols and received no echo to _fail the connection_, and browsers enforce it. A new Studio that always offered `jx.collab.v1` would therefore lose co-editing entirely against a server built before this shipped. The probe already existed, already returned a version the client discarded, and runs before the socket — it is the one place the client can learn what the server speaks without risking the handshake.

**A version in the `hello` control message is not an alternative.** `hello` arrives after the socket is up and after frames may already have been exchanged, which is too late to prevent the divergent-history merge §3 exists to prevent. Negotiation concludes before a byte of document state moves.

**An unanswered probe is not a refusal.** The cloud gateway ships separately from the Studio bundle, so a 404 or a network error on its probe means _older gateway_, and treating that as no-collab would take working co-editing away from every session pointed at one. It connects offering nothing, which is also the only handshake-safe answer to a server that would echo nothing.

### 2.2 Frames

> **Status: Implemented.** `packages/collab/src/envelope.ts`, `packages/collab/tests/envelope.test.ts`.

Every message is one binary WebSocket frame; a text frame is ignored. A frame is a lib0 `varUint` type followed by its body, and `jx.collab.v1` names exactly this layout (§2.1):

| Type | Frame       | Body                                                                        | Sent by    |
| ---- | ----------- | --------------------------------------------------------------------------- | ---------- |
| 0    | `doc-sync`  | `varString` path, `varUint` epoch, `varUint8Array` y-protocols sync message | both       |
| 1    | `awareness` | `varUint8Array` y-protocols awareness update, for the whole project         | both       |
| 2    | `doc-close` | `varString` path                                                            | the client |
| 3    | `control`   | `varString` JSON control message (§2.3)                                     | both       |

Paths are project-relative with `/` separators, and one socket carries every open document. A `doc-sync` at an epoch other than its room's is never applied (§1.1, §3). A frame of an unknown type is dropped by both halves (the host also answers `unknown-frame`), and a control message is read for the fields its receiver knows, so a new frame type, control message or field does not move the token.

### 2.3 Control Messages

> **Status: Implemented.** `packages/collab/src/envelope.ts`, `ws-room.ts`, `ws-client.ts`, `packages/collab/tests/envelope.test.ts`, `ws-wire.test.ts`.

| Message        | Sent by    | Fields                                                                             | Means                                                                                                         |
| -------------- | ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `hello`        | the host   | `login`, `name?`, `avatarUrl?`, `color`, `permission` (`admin`, `write` or `read`) | Once per connection: who it is and what it may do. `read` makes every document read-only (§4).                |
| `open`         | the client | `path`                                                                             | Join the path's room with an empty local `Y.Doc`. Re-sent for every document held when the socket reconnects. |
| `opened`       | the host   | `path`, `epoch`                                                                    | The room is ready at this epoch; sync follows (§1.1).                                                         |
| `doc-reset`    | the host   | `path`, `epoch`                                                                    | The room's history was replaced: discard the local `Y.Doc` and open the document again (§3).                  |
| `flush`        | the client | `path`, `baseHash?`                                                                | Save the room's text now (§1.2); `baseHash` is the base the save replaces (§2).                               |
| `flush-ack`    | the host   | `path`, `error?`                                                                   | The flush was handled: durable without `error`, not written with it (§1.2).                                   |
| `revert`       | the client | `path`                                                                             | Discard the room's unsaved edits and reseed it from storage (§2).                                             |
| `revert-ack`   | the host   | `path`                                                                             | The revert was handled, whether or not it changed anything (§2).                                              |
| `doc-dirty`    | the host   | `path`, `dirty`                                                                    | The room's unsaved state changed, or, during `open`, what it is (§1.2).                                       |
| `doc-conflict` | the host   | `path`, `diskHash`, `docId`                                                        | A save was refused because the file changed under the room (§2).                                              |
| `error`        | the host   | `path?`, `code`, `message`                                                         | A request was refused, with one of the codes below.                                                           |

| Code                        | Sent when                                                                               | The client                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `binary-file`               | the embedder refuses a path it cannot co-edit (the dev server: media and archive files) | ends the attach before `opened` (§4)                                                                                                     |
| `content-not-loaded`        | the path is outside the project or its text could not be loaded                         | reads the file over HTTP and asks once more when its adapter supplies that hook (the cloud adapter does); otherwise ends the attach (§4) |
| `too-large`, `rate-limited` | the gateway declines the room                                                           | ends the attach before `opened` (§4)                                                                                                     |
| `read-only`                 | a read-only connection sent a document write (once per connection)                      | nothing: the read-only banner already says so (§4)                                                                                       |
| `unknown-frame`             | the host could not decode a frame                                                       | nothing (it carries no path)                                                                                                             |

### 2.4 Awareness State

> **Status: Implemented.** `packages/collab/src/awareness-types.ts`, `source-lock.ts`, `packages/studio/src/collab/collab-session.ts`, `packages/collab/tests/source-lock.test.ts`, `packages/studio/tests/collab-presence.test.ts`.

Presence travels in y-protocols awareness (§2), one channel per project: each client publishes one state for the whole project (`CollabAwarenessState`, `packages/collab/src/awareness-types.ts`) and peers filter it by document. A client that holds no document publishes no state, so a person who has left every shared document leaves every roster.

| Field                 | Holds                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `user`                | `login`, `name?`, `avatarUrl?` and `color`, from `hello`                                                               |
| `rooms`               | every document the client holds a session on, in the order it joined them                                              |
| `focusedPath`         | the document the client is working in (below)                                                                          |
| `mode`                | `"source"` while the client's Code view on `focusedPath` is open, otherwise `"structure"` (§3.2)                       |
| `structuralSelection` | the JSON paths selected on `focusedPath`'s canvas, or `null`                                                           |
| `selection`           | the Code view's text cursor as y-monaco relative positions, written only while a Code view is bound, `null` after (§4) |
| `canWrite`            | whether `hello` granted write access: advisory, since the host enforces it (§1.1), and what §3.2's elections count     |

**Focus.** Joining a document focuses it, unless a Code view holds focus. Opening a Code view focuses its document. Leaving the focused document focuses the most recently joined one still held. Only the focused document's session publishes `structuralSelection`, so a selection is never drawn on a document it does not belong to.

**Colour.** The backend assigns `color` in `hello`. The dev server, which has no accounts, derives it from the login with `colorForKey`, which maps the same login to the same one of eight hues (`PRESENCE_PALETTE`).

Fields are additive and a peer ignores one it does not know. A state with no `rooms`, from a Studio built before the field, counts as present in every room.

> **Status: Future.** Presence per document. A client with several documents open, in split panes or background tabs, is shown and counted as a source editor only in its focused document (§3.2), and focus does not follow the active tab. Following it would drop a Code view's holder from its document's count while that view is still bound in another pane, so the lock could be released under it; the answer is a state per document.

## 3. Invariants (load-bearing)

> **Status: Partial.** Convergent seeding and origin-scoped undo ship (`packages/collab/src/ws-room.ts`, `schema.ts`, `packages/collab/tests/convergence.fuzz.test.ts`, `packages/studio/tests/collab-undo.test.ts`). The epoch invariant does not. `packages/collab/src/ws-client.ts` compares an `opened` epoch only while `entry.opened` is set, which its `onclose` clears for every doc, so a client that reconnects after its room was reset adopts the new epoch and merges its old history into the fresh one; `destroyRoomIfEmpty` (`ws-room.ts`, called by `packages/server/src/collab.ts` after its 30-second empty-room grace) destroys a room's `Y.Doc` without bumping its epoch; and epochs live in memory, so a restarted dev server numbers every room from 0 again.

- **Y history is never deleted or replaced without an epoch bump.** A frame carrying a stale epoch forces the receiving client to rebuild its `Y.Doc` from the current epoch rather than merge across a history discontinuity. This is what keeps a re-seeded or reset room from silently diverging.
- **Seeding is convergence-safe under concurrent seeders:** whole-key last-writer-wins on the seed `Y.Map`; the server seeds only `source`, clients derive `structure`. Two clients seeding the same empty room converge on one state.
- **CRDT granularity is finer than op granularity, and the bridge is what reconciles them.** Studio's mutators record whole-value ops (an inline commit replaces a whole `textContent`; a style edit replaces the whole `style` object). Storing those as whole values made concurrent edits last-writer-wins. The shared document therefore stores prose as `Y.Text` and `style`/`attributes`/`$props` as nested `Y.Map`s, and the op bridge diffs a whole-value op down onto that structure — never replacing a live container when the type is unchanged, because replacement orphans a peer's concurrent edit (§3.1 states the one case the bridge cannot avoid, an element that moves or cannot be paired). Inbound, granular events collapse back to one whole-value op for the owning key. So the op log, the canvas patcher and the undo ring are unaffected while concurrent edits merge.
- **Undo is origin-scoped.** The `Y.UndoManager` delegate tracks only local-origin transactions, so undoing your own edit cannot revert a peer's concurrent edit to a sibling property.

These invariants are implemented in `packages/collab/src` (`envelope.ts`, `schema.ts`, `provider.ts`); this section records them so a future change cannot quietly break them.

### 3.1 Merge Granularity

> **Status: Implemented.** `toYNodeValue`, `writeNodeKey`, `mergeYNode` and `mergeYChildren` in `packages/collab/src/schema.ts`, used by `seedStructure`, the op bridge (`packages/collab/src/op-bridge.ts`) and `replaceYStructure` (`packages/collab/src/diff.ts`); `packages/collab/src/style-order.ts` (canonical order), `packages/collab/tests/granular-merge.test.ts`, `packages/collab/tests/style-order.test.ts`, `packages/studio/tests/collab-transact.test.ts`.

| Document position                                                                | Stored as             | Concurrent-edit outcome                                                    |
| -------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `textContent` (string), bare-string child                                        | `Y.Text`              | Per character — both authors' insertions survive                           |
| `style`, `attributes`, `$props` (and nested blocks)                              | `Y.Map`, values plain | Per property — different properties both survive                           |
| `state` (each entry), an `on*` handler                                           | `Y.Map`, values plain | Per entry and per key; a function's `body` is the `Y.Text` row below       |
| `children`                                                                       | `Y.Array`             | Per element                                                                |
| `$script.client`, `$script.server` (`spec.md` §23.2), a function's string `body` | `Y.Text`              | Per character — two authors typing in one script both keep what they typed |
| `tagName`, `$ref`, `$switch`, `cases`, everything else                           | Whole-JSON value      | Last writer wins (these are replaced wholesale by design)                  |
| `source`                                                                         | `Y.Text`              | Per character (source-mode co-editing)                                     |

The table holds for the root as for every node below it, and for every write that reaches the shared document: the first client's seed, each op the bridge replays, and the whole-document write that stands in when a local edit or the source reconciler's parse cannot be replayed op by op (its diff is too large, or its replay fails). A whole value written onto a key whose stored type is unchanged is diffed onto the container already there: text by a minimal character edit, a granular object property by property, and `children` element by element, aligned as the structural differ aligns children, so an unchanged element is kept, an element with the same `tagName` and the same `attributes.id` or `$props.key` is merged in place, and a bare string is edited per character. A whole-JSON value equal to the one stored is not rewritten, so a whole-document write never restores a key a peer changed at the same moment. An element that moves (reordered, moved to another parent, wrapped or unwrapped) and an element the alignment cannot pair are removed and inserted, because `Y.Array` has no move: an edit a peer makes inside that element at the same moment is lost. Inbound, events confined to one node's `children` collapse back to one `children` write for that node, as §3 describes for the other granular keys.

A `Y.Map` has no key order, and the shared document stores none: no order array, no reserved key, nothing about order at all. Readers return a canonical order that is a function of the keys alone, so two peers that wrote the same declarations in different orders read the same block. A `style` block, and each nested block in it, reads its declarations first, with a shorthand before every longhand it sets (directly or through another shorthand, so `border` precedes `border-color` precedes `border-bottom-color`) and property name ascending as the tiebreak; the shorthand and longhand relation is the `longhands` lists of `@webref/css`, committed as a generated table (`packages/collab/src/css-shorthands.ts`, regenerated by `bun run generate:css-shorthands`, checked against `@webref/css` by `packages/collab/tests/css-shorthands.test.ts`). Nested blocks (`& a`, `&:hover`, `@--sm`) read after the declarations. The one exception to name order is a breakpoint block, a nested key named `@--...` (`@--sm`, `@--md`, `@--lg`, `@--dark`): two breakpoints can set the same property, so name order would reverse a pair such as `@--sm` and `@--md` and change the rendered style. A breakpoint reads in the position of its key in the document's `$media` map (the `$media` key `--sm` is the at-rule key `@--sm`), and one that `$media` does not list reads after those, by name; with no `$media`, breakpoints read by name. Every other nested block is ordered by key name, because the repository has no selector-specificity helper: the intended rule is specificity ascending, so that a more specific rule follows a more generic one, and until a helper exists two nested rules of equal specificity are ordered by name rather than by their source order, which CSS cascade treats as significant. A `state` block's entries and a function entry's keys read in ascending name order, since order is significant only for `style` and `$media` (`spec.md`, Jx Notation). `$media` is a whole-value entry, so its source order survives. A function's string `body` is a `Y.Text` inside its entry's `Y.Map`, written like every other key. A reorder of a `style` or `state` block is not a change, so the structural differ does not compare key order and a reorder never reaches peers.

**Consequence for authored order.** The canonical order is applied when a document is shared, so a document read back from a room can order its declarations differently from the file it was seeded from. That is harmless when two declarations name unrelated properties, and it changes meaning when a longhand was written before the shorthand that covers it: `margin-left: 0` followed by `margin: 1em` leaves the left margin at `0` in the file, but reads back as `margin: 1em` followed by `margin-left: 0`, because the shorthand now applies first and the longhand wins. Collab warns of nothing; the author who relied on a shorthand overriding an earlier longhand must write the longhand after it, which is the order the canonical form gives it. At-rule breakpoints are not affected: they follow `$media` order, which is the author's order, so a later breakpoint still overrides an earlier one (`examples/components/responsive-card.json` reads back with `@--sm` before `@--md`, as written).

A **type change** — text becoming a `$ref`, an object becoming a scalar — replaces the container, since no shared structure remains to preserve.

`$script` is a `Y.Map` holding one `Y.Text` per side, so one author editing the client script and another the server script never meet, and adding or removing a side is one key. A room written before scripts were stored this way holds `$script` as a whole value; it reads the same, and the first write to it replaces it with the tabled form. Nothing a peer on either side of that change writes is misread by the other, so it moves no schema version (§5).

The `source` text is the file. A client that mirrors structure into it writes a format file (`.jxn`, Markdown) through its serializer over the room's current `source`, not over the text that client last read, so the merge keeps what a peer typed into the text since: a `.jxn` comment survives a peer's canvas edit. The write is a minimal character edit in one transaction.

### 3.2 The Source-Canonical Lock

> **Status: Implemented.** `packages/collab/src/source-lock.ts`, `packages/studio/src/collab/collab-session.ts`, `packages/collab/tests/source-lock.test.ts`, `packages/studio/tests/collab-source.test.ts`.

A room stores its document twice, as the `structure` tree the canvas edits and as the `source` text the Code view edits and a flush saves (§1.2), and exactly one is authoritative at a time. `meta.canonical` names it, `"structure"` (the default) or `"source"`, and every flip adds one to `meta.canonicalRev` (`packages/collab/src/source-lock.ts`).

- **Structure canonical.** Edits reach `structure` through the op bridge (§3), and one writer keeps `source` in step by serializing its own copy: the **structure mirror**, the lowest write-capable client among those holding the room (§2.4). It mirrors 800 ms after the last edit, and never lets the text fall more than 2.5 s behind while edits continue. Every Save mirrors first, whoever saves.
- **Taking the lock.** A writer opening Code view writes its own serialization of the structure into `source`, unless the text already says what the tab holds (§3.1), and sets `canonical` to `"source"` in one transaction. While the room is source-canonical every client refuses structural edits, the holder's own included, and says so (§4's freeze).
- **Source canonical.** Writers co-edit `source` character by character. The **source reconciler**, the lowest write-capable client among those whose Code view is open on the document (as their focused document, §2.4), parses the text back into `structure` 600 ms after the last keystroke, so every canvas previews it. A parse is discarded when `canonicalRev` moved while it ran (a whole-document write to the structure moves it too), and text that does not parse leaves the last good structure. A Save flushes the text as it stands.
- **Releasing it.** When the last writer with a Code view open on the document (again, as their focused document) leaves, it parses once more and sets `canonical` back to `"structure"`. A read-only client neither takes nor releases the lock and never counts as a source editor.

Both elections read awareness, so while a joiner's state is still arriving two writers can briefly write the same text; the next mirror or parse restores it.

## 4. Enablement & Degradation

> **Status: Implemented.** packages/studio/src/collab/collab-session.ts, collab-state.ts, collab-commands.ts, presence-chips.ts, monaco-binding.ts; packages/collab/src/ws-client.ts, negotiate.ts; packages/studio/src/platforms/devserver.ts, cloud.ts.

Collab is a capability the platform may or may not expose. A backend with collaboration switched off answers the probe `{collab: false}`, and against it the editor runs single-player; so it does against a dev server whose probe answers 404, which has no collaboration endpoint (a gateway's unanswered probe is not that, §2.1). The lifecycle below is the whole state machine.

A negative probe **may explain itself**: `{collab: false, detail}`. `negotiateCollab` (`packages/collab/src/negotiate.ts`) reports a non-blank `detail` as its `refused` reason, which the author sees as a failed attach, while a bare `{collab: false}` is `disabled` and silent, because a server knows which kind of no it is giving — a flag that is off, or a room an action would open (`desktop.md` §10.4) — and only one of those is true of "disabled".

A session is in exactly one of four states, and **only one of them is silent**:

| State         | Means                                      | Shown as                           |
| ------------- | ------------------------------------------ | ---------------------------------- |
| `unavailable` | no collaboration here for this document    | nothing — there is nothing to say  |
| `detached`    | available, and the author left the session | **Solo**                           |
| `attached`    | joined                                     | the peer chips                     |
| `failed`      | tried to join and could not                | **Not connected**, with the reason |

Collapsing `failed` into `detached` is the defect this table exists to prevent: a connection that died and a session nobody started look identical, so the author has no way to know whether to retry. An attach failure records its reason and reports it once.

**What the platform answers decides the state.** The `collab` member (desktop.md §10.3) has three answers, and each is one state. A handle joins. `null` means no room serves this document here and nothing went wrong: a backend that answers `{collab: false}`, a dev server without the endpoint, a runtime that cannot open a WebSocket, and a path the room host refuses by nature (`binary-file`, or `content-not-loaded` for a file it cannot read) are all `unavailable`, because media, comparison and grid tabs carry a path too, and a fault reported for every image opened would teach the author to ignore the one that matters. A rejection means the attach was tried and could not complete, and its message is the reason: a probe the dev server could not answer (an unanswered gateway probe is not a failure, §2.1), a probe advertising only envelopes this client cannot parse (§2.1), any other refusal before `opened`, an `open` that no `opened` answers within ten seconds (named as an unreachable server when the socket is not connected at that moment, and as a silent one when it is), and a first sync that does not finish within eight seconds. The notification is keyed by the document's path, so a retry replaces it rather than adding another.

**The lifecycle.**

1. **Enablement**: a tab attaches when it opens if the platform has a `collab` member, the tab has a document path and the path is not `project.json` (below); otherwise it is `unavailable` and never attaches; a tab whose author left does not attach until shared again.
2. **Attach**: the tab shows **Connecting…** while the platform probes and the client sends `open`; the host creates the room on the first `open`, seeding `source` from the file, and answers `opened` with the room's epoch (§2); the client sends sync step 1 and the attach completes on sync step 2; the first client able to write that finds the structure unseeded seeds it from the copy of the document it brought, and every later client adopts the shared structure (§3); the host reports the room's unsaved state in the same handshake; the tab is then `attached`, read-only when `hello` granted read permission. An attach asked for while an earlier one for the same tab or the same path is still ending waits for it, so no two attempts for one document overlap.
3. **Reconnect**: a dropped socket shows **Offline — changes sync on reconnect** and edits keep applying locally; the client reconnects with a backoff starting at one second and doubling to thirty, re-offers its negotiated subprotocol, re-sends `open` for every document it holds and re-publishes its presence; the tab shows Live again once the socket is up; whether a room whose history moved meanwhile is merged or rebuilt is §3's epoch invariant.
4. **Reset**: when a handle reports that its room's history was replaced (§3), the tab drops the session and attaches again from step 2; which copy of the document it brings into the new room is §3's rule.
5. **Leaving and retrying**: `Collaborate: Stop sharing` makes the tab `detached` and `Collaborate: Share this document` attaches it again; on a `failed` tab Share is the retry, and it probes again when the last probe could not be answered; nothing retries a failed attach on its own.
6. **Rename and close**: renaming a document detaches it and attaches under the new path; closing the tab destroys its session.

Two further states must be _visible_ rather than inferred, because in both of them the editor stops responding the way it normally does:

- **A freeze** — a peer holding the document while editing source — carries a persistent indicator saying so, and saying explicitly that it is not an error. A three-second grey line is how a freeze became indistinguishable from a bug.
- **Read-only** carries a banner, not a silent refusal of every edit.

**Presence that has ended must stop being published.** A client's in-buffer text cursor lives in the awareness `selection` field, written only while a code view is bound; unbinding clears it. Left set, the field describes a person who is no longer there — every peer still in the code view keeps drawing that caret and name flag at the position it was abandoned at, for the rest of the session, and no event ever arrives to correct it. A stale cursor is worse than an absent one: it is a claim about where a collaborator is working, and it is false.

**Undo is scoped to your own edits and says so.** The scoping was always correct and entirely unstated, which is worse than not scoping it: an author who does not know it cannot predict what :kbd[⌘Z] will do, and the guess that it might take back a collaborator's work is the one that stops people using undo at all.

`project.json` is **excluded from replication.** No session is attached to a tab whose `documentPath` is `project.json`, and therefore no history delegate is registered over it. Its edits arrive from surfaces that are not the canvas, and its value configures the local editor's formats, extensions, schemas and style cascade — so a shared configuration document would let a peer's edit reconfigure another author's editor mid-keystroke, and would let the source-canonical freeze pause configuration edits that contain no text at all. A collaborator therefore does not see configuration changes live; they arrive with the file.

## 5. Version Skew

> **Status: Partial.** Frame-layout skew is handled: `negotiateCollab` and `selectSubprotocol` (`packages/collab/src/negotiate.ts`) keep a peer that speaks another `jx.collab` token out of the room. Merge-granularity skew is not: the §3.1 layout is versioned by `COLLAB_SCHEMA_VERSION` (`packages/collab/src/schema.ts`), which is written to the room's `meta` at seed and never validated or negotiated, so two clients that store §3.1 differently still share a room. Document-format skew is handled nowhere, spec.md §3.2 included.

Two different things can be out of step, and conflating them hid the tractable one.

**Document-format skew** — a breaking change to the Jx document schema across a room's lifetime — is out of scope for this draft and tracked separately (see spec §3.2 on `$schema`).

**Wire-envelope skew is closed.** Two clients running different envelope versions disagree about merge granularity (§3.1), and the subprotocol negotiation in §2.1 is what keeps them out of the same room: an incompatible peer is turned away on the handshake, or — when the client can tell from the probe — never opens a socket at all, so the author is told why instead of watching a session fail silently. The failure mode this replaces was the worst kind: everything appeared to work, and the document diverged.

## 6. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). Yjs and `y-protocols` are libraries rather than published standards, so the encodings they define are described in §2 rather than cited here.

| Standard                                              | Class         | Binds    | Evidence                                                                                                                                           | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455)    | **Adopted**   | §2, §2.1 | packages/collab/src/negotiate.ts, packages/server/src/collab.ts, packages/collab/tests/negotiate.test.ts, packages/server/tests/collab-api.test.ts | The transport is used as specified, and subprotocol negotiation (§1.9, §4.2.2) now runs: the client offers `jx.collab.v1`, the server echoes it, and an offer the server cannot satisfy is refused rather than upgraded unversioned. A server advertising no protocols is offered none, because §4.1 fails a connection whose offer went unechoed.                                                                                                                                                                                                       |
| [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493)    | **Divergent** | §3.1     | packages/collab/src/schema.ts, packages/collab/src/style-order.ts, packages/collab/tests/granular-merge.test.ts                                    | §2.3: the order of members does not change the meaning of an I-JSON message, so the shared document stores no key order and a `state` block, a function entry and an `attributes` block read in no significant order. Two deviations: `$media` is stored whole and its source order is kept, and a `style` block is read in the canonical order of §3.1, which is a normalization rather than the authored order.                                                                                                                                        |
| [CSS Cascade 4](https://www.w3.org/TR/css-cascade-4/) | **Divergent** | §3.1     | packages/collab/src/style-order.ts, packages/collab/tests/style-order.test.ts, packages/collab/tests/css-shorthands.test.ts                        | Order of appearance decides between declarations of equal origin, importance and specificity, so the order of a style block is meaningful. One deviation: a style block read from a room is in canonical order (a shorthand before its longhands, then name ascending), which changes meaning where a longhand was written before its shorthand, and nested blocks of equal specificity are ordered by key name rather than by source order until a selector-specificity helper exists (`@--` breakpoints follow the document's `$media` order instead). |
| [RFC 7692](https://www.rfc-editor.org/rfc/rfc7692)    | **Rejected**  | §2       | —                                                                                                                                                  | because: lib0-encoded Yjs updates are near-incompressible, the dominant frame volume is awareness cursors whose payload is smaller than a deflate block header, both transports are loopback or already compressed at the edge, and Bun allocates a zlib context per socket — a real cost for a server whose purpose is many concurrent sockets.                                                                                                                                                                                                         |

## Changelog

- **0.2.15-draft** (2026-11-23) — §2 names the cloud session as a host that keys every room by its document (by its path while the host has not indexed it) and answers a refused save with doc-conflict.
- **0.2.14-draft** (2026-11-23) — A room whose file changes under unsaved edits keeps them and reports doc-conflict; flush takes a baseHash and revert discards the room.
- **0.2.13-draft** (2026-11-23) — A room is keyed by whatever its host's keyOf names while peers keep addressing it by path, and a refused save reaches every participant as the additive doc-conflict control message (§2).
- **0.2.12-draft** (2026-11-13) — §3.1: a document's own scripts are stored as one Y.Text per side inside a Y.Map, so two authors typing in one script both keep what they typed; the table also names a function's string body as text, which the marker records as not built yet.
- **0.2.11-draft** (2026-11-08) — §3.1: a format file is mirrored into the shared text over the room's current text, so a peer's comment survives.
- **0.2.10-draft** (2026-10-29) — The desktop adapter's path follows its move to src/webview/, and the removed Chromium launcher is no longer named.
- **0.2.9-draft** (2026-10-21) — The desktop launchers section names the one desktop adapter, chromium/platform.ts, in place of the retired ElectroBun adapter.
- **0.2.8-draft** (2026-10-04) — §2 the collab socket reconnects on equal-jitter backoff, and a pending retry runs immediately on the online, back/forward-cache pageshow and visibilitychange wake signals.
- **0.2.7-draft** (2026-10-04) — §4 a negative capability probe may carry a detail, which the client reports as its refusal instead of calling the room disabled.
- **0.2.6-draft** (2026-09-29) — Census against the code: §1, §2, §3, §3.1 and §4 marked Partial, the §5 marker corrected to say that merge-granularity skew is unguarded, and the whole-spec marker updated to name the shipped modules the stub does not yet specify.
- **0.2.5-draft** (2026-08-20) — Presence that has ended must stop being published: a client leaving the code view clears its in-buffer text cursor, so peers stop drawing a caret for someone who is no longer there.
- **0.2.4-draft** (2026-08-16) — §2.1 subprotocol negotiation: jx.collab.v1 offered from the capability probe and echoed on the handshake; §5 wire-envelope skew closed; RFC 7692 non-adoption stated in §2.
- **0.2.3-draft** (2026-08-15) — Add §6 Standards Alignment; §5 separates wire-envelope skew from document-format skew and is marked Pending.
- **0.2.2-draft** (2026-08-05) — §4 project.json is excluded from replication, and why.
- **0.2.1-draft** (2026-08-04) — §4 the four session states, with failed distinguished from detached; freeze and read-only made visible; undo scoping stated in the UI.
- **0.2.0-draft** (2026-07-28) — Store prose as Y.Text and style/attributes/$props as nested Y.Maps so concurrent edits merge per character and per property; the op bridge diffs whole-value ops onto that structure.
- **0.1.1-draft** (2026-07-22) — Proper spec versioning (`05c12d47`).
- **0.1.0-draft** (2026-07-22) — Reconcile spec with shipped behavior; document the eval surface (`7a581de7`).

---

_Jx `@jxsuite/collab` Specification v0.2.15-draft_
