# Jx Project State Specification

## One Backend-Owned Model of a Project, Served by Every Studio Host

**Version:** 0.1.0-draft\
**Status:** Partial\
**Updated:** 2026-11-21\
**License:** MIT

---

## 1. Overview

Studio has three backends: the desktop backend (an Electron utility process on Node, `desktop.md` §7.1), the dev server (`server.md`, Bun) and the cloud (a per-project Durable Object in the hosted platform, `desktop.md` §10). Today none of them owns a model of the project. Each forwards filesystem events (`FsEvent`, `server.md` §3.1), Studio folds them into its listings (`studio.md` §9.2), and every cache Studio keeps (the version map, component discovery, the usage index, the format registry, the open tabs) decides for itself what an event means. A gap in the stream is repaired by re-listing (`"open"`, `"reconnect"`, `"commit"`), Studio's own writes are told apart from foreign ones by a 1.5 second window (`packages/studio/src/files/fs-events.ts`), and a write overwrites whatever is on disk.

This specification defines **one contract**, the project state service, that every host implements and one conformance suite tests:

- the host owns a file index with a stable document identity and a content hash per file, a revision counter with a replay log, a dependency graph, a readiness state and a git monitor;
- a client subscribes with the last revision it applied and receives either exactly the events it missed or a snapshot, on every connect;
- every event names its revision and its origin, so a client recognises its own writes by the bytes they wrote rather than by when they happened;
- a write or delete names the bytes it replaces, so a stale writer gets a conflict instead of silently overwriting (§5 states the one window a filesystem host cannot close);
- a client keeps one content store keyed by document and hash, and every cache it holds derives from it.

The contract is written in TypeScript first (`packages/protocol/src/project-state.ts`). A native core and durable persistence on the desktop are deferred until measurements ask for them (§13).

### 1.1 Scope

In scope: the wire types, the meaning of each event, revision and replay semantics, write preconditions, the two dirty notions, the readiness machine, the dependency graph's edge kinds, the rename cascade as one operation, what each host must implement, and what a client must derive from the stream.

Out of scope: the collaboration protocol (`collab.md`), which this contract hosts but does not redefine (§11.3); the Studio Backend Protocol's request routes (`server.md` §4.1), which remain the way a client reads a file's bytes; and the layout of any persisted store beyond the dialect rule in §13.1.

### 1.2 Terms

- **Host**: the process that implements this contract for one project (a desktop window's project session, the dev server's active project, a cloud project's Durable Object).
- **Client**: one Studio window or tab subscribed to a host.
- **Document**: any file in the project's index, whatever its format.
- **Revision**: a positive integer the host assigns to each event, strictly increasing within an epoch.
- **Epoch**: an opaque string naming one revision sequence. A host starts a new epoch whenever its revisions restart.

The key words MUST, MUST NOT, SHOULD and MAY are to be read as in `standards.md` §12.

## 2. Identity, Hashes and Revisions

> **Status: Implemented.** The types and the pure helpers ship in `packages/protocol/src/project-state.ts` (`contentHash`, `createEchoLedger`, `createMemoryEventLog`, tested by `packages/protocol/tests/project-state.test.ts`), and the conformance suite (§10.4), which an in-memory reference host passes, has a case for every rule below with three exceptions. The ledger clearing a path's entries on an external removal is pinned by `createEchoLedger`'s own tests, because no driver action can make a watcher lose an own write's observation, which is the only time the clearing shows. An identity kept across a rename through §9 joins the suite with the §9 cases. The classification of an extension-registered format is §2.2's open item. Which hosts mint document ids, hash their files, keep a log and attribute events by hash is each host's own item (§10.1 to §10.3).

### 2.1 Content hashes

A content hash is the SHA-256 digest of a file's bytes, spelled `sha256-` followed by the standard base64 encoding of the 32-byte digest, padding included (`ContentHash`). A host computes it over the exact bytes on disk; a client computes it over the exact bytes it would write. Text is hashed as its UTF-8 encoding, so a host that reads a file as text and one that reads it as bytes agree. Equal hashes mean identical bytes for every purpose in this contract. A directory has no hash.

The hash is not the listing `version` of `studio.md` §3.4: a version is a token a host MAY issue for immutable caching, while a hash is computed by every host for every file and is never used as a cache lifetime.

### 2.2 Document identity

The host assigns every indexed file a `DocId`: an opaque string, unique within the project, that survives a rename performed through §9, a rename the watcher reports as one move, and an atomic-rename save (§2.4). A file removed and a file later added at the same path get different ids. Clients compare ids for equality only. The host also classifies each document into a `DocKind` (`page`, `layout`, `component`, `content`, `data`, `media`, `style`, `project-config`, `other`) from the project configuration and the file's location; a document whose kind the host cannot decide is `other`. A document in a format an extension registers is classified only once the host reaches `extensions-resolved` (§7), and is `other` until then.

> **Status: Partial.** The conformance suite asserts the conventional locations' kinds, the index scope (a `build.outDir` other than `dist/` included) and that a symlink is followed only inside the root. No case asserts that an extension-registered format is `other` until `extensions-resolved`: the fixture's extension registers no format, and showing it needs a host that loads one.

**Index scope.** The index holds every file and directory under the project root except `.git/`, `node_modules/`, `dist/` (and the directory `build.outDir` names when it is another, `site-architecture.md` §3.1), `.jx/`, `.cache/`, `.devenv/`, `.direnv/`, and Bun's lockfiles (`bun.lock`, `bun.lockb`), at any depth. A symlink is followed only when it resolves inside the root. This is the ignore set the existing watchers apply (`packages/server/src/watch.ts`, `packages/server/src/watch-policy.ts`), and every host applies the same one, so two hosts serving the same tree produce the same snapshot. Paths outside the scope that a host still reads (the lockfile and installed packages for readiness, §7; `.git/` for the git monitor, §4.5) produce no file events.

### 2.3 Revisions, epochs and the replay log

Every change the host observes or performs produces one event, and every event gets the next revision. Revisions start at 1 within an epoch and never repeat or go backwards in it. The host keeps a **replay log**: a window of its most recent events, so that a client that missed some can receive exactly those. The window's size is the host's choice; the in-memory log (`createMemoryEventLog`) keeps 1024 by default. A log answers "the events after revision N" with all of them, oldest first, or with nothing at all: it MUST NOT answer with a subset, because a client cannot tell a partial replay from a complete one.

A host starts a new epoch whenever it cannot continue the old sequence: on process start for an in-memory log, and whenever a persisted log is discarded. An epoch SHOULD be unguessable enough not to collide across restarts (a random UUID suffices).

### 2.4 Origin and echo suppression

Every event carries `origin`: `{ writeId, writeHash }` when the change was caused by a write or delete through §5, whichever client issued it, or `"external"` for any change the host did not perform (another program, a `git checkout`). `writeHash` is `null` for a delete. Origin is **host-global**: the log and the snapshot are shared by every subscriber (§2.3, §3.1), so every subscriber sees the same origin for the same event, and each client decides which writes are its own with `isOwnOrigin` against the write ids it issued.

**A host records its own writes when it performs them.** A write or delete through §5 appends its file event, with its `WriteOrigin`, and updates the index's hash in the same step that changes the disk, before the host replies (§5). The watcher's later report of those bytes then carries the hash the index already holds, and the host emits nothing for an observation whose hash equals the indexed one (§4.2). That rule, not a time window, is what suppresses an echo, and it replaces the 1.5 second window of `studio.md` §9.2, which misattributes a foreign write landing inside it and an echo arriving after it.

**The echo ledger covers the one case the equal-hash rule cannot: an observation that is stale by the time the host compares it.** Before it writes, the host notes `(path, writeHash, writeId)` in an echo ledger (`createEchoLedger`), and it passes every observation at that path to the ledger before comparing it with the index. When the watcher read the file after write A and the host compares after write B, the bytes are A's: they differ from the index, and without the ledger they would be reported as an external change back to A. A hash matching a pending write is that write's echo, whose event is already in the log, so the host drops it; the match consumes that entry and every older one for the path, because a watcher may coalesce several writes into one observation that shows only the last. A hash the ledger does not hold is external: it clears every pending entry for the path, so a later external change that restores an own write's bytes (a `git checkout` of an earlier version) is never attributed to that stale write, and when it differs from the index the host emits it with origin `"external"`. A removal the host did not perform is external and clears the path's entries too. A host processes the observations of one path in the order the watcher reported them.

A watcher event that names a file costs a read and a hash; a host MAY skip it when the file's size and modification time equal the ones it recorded with its last hash.

**Atomic-rename saves.** An editor that saves by writing a temporary file and renaming it over the target is observed as a change at the target path, or as a removal followed by an add. A host holds an observed removal at a path for a pairing bound (`atomicSaveMs`, configurable per host, default 100 ms, the bound chokidar's `atomic` option applies); when a file reappears at the same path within it, the host reports one `fileChanged` for the existing `DocId`, or nothing when the bytes equal the indexed ones, attributed by hash like any other change. The bound decides identity only, never origin: a save slower than the bound is reported as a `fileRemoved` and a `fileAdded` with a new `DocId`, both still attributed by hash.

## 3. Subscription

> **Status: Implemented.** The exchange's types and the host's answer (`SubscribeRequest`, `SubscribeResponse`, `answerSubscribe`) ship in `packages/protocol/src/project-state.ts`, the wire codecs and the client's cursor (`createSubscriptionCursor`) in `packages/protocol/src/project-state-frames.ts`, and the conformance suite asserts §3.1 (§10.4). Which hosts accept a subscription is each host's own item (§10.1 to §10.3); §3.3 is open.

### 3.1 The subscribe exchange

A client sends a `SubscribeRequest` on **every** connect, the first one included: `{}` when it holds no state, otherwise `{ epoch, sinceRev }` naming the epoch and the last revision it applied. Every request MAY also carry `clientId`, a string naming the client (one Studio window or tab) that it keeps across reconnects, which scopes per-client state on the host (§11.3). The host answers with one `SubscribeResponse` and then streams every later event in revision order:

- `{ kind: "events", epoch, rev, events }` when the epochs match and the log holds every event after `sinceRev`. `events` is exactly those events, oldest first, and may be empty.
- `{ kind: "snapshot", epoch, rev, snapshot }` otherwise: a first connect, an epoch the host no longer serves, a revision outside the window or ahead of the host. The snapshot is the whole state at `rev`: every file in the index scope (`IndexedFile`: path, id, kind, whether it is a directory, hash, and `indexed`, whether the host has extracted its references, §8.2), the readiness state, the git summary when there is a repository, the set of discoverable component tags (`components`, §4.3), and the format-set token (`formats`, §4.4).

The host MUST take the snapshot and read `rev` without an event intervening, so that the first streamed event is `rev + 1`. A client applies a snapshot by replacing its state, not by merging: everything not in it is gone. The snapshot carries the component set and the format token so that a client never has to rediscover either after applying one.

**A host answers a subscribe in every readiness state**, so a client opening a project is never left without state. Below `indexed` (§7) a snapshot may list a file without a hash, with a provisional kind (§2.2), and with `indexed: false`. As the host hashes, classifies and extracts each file it emits `docChanged` with the filled-in fields (§4.3), and a client draws what it has and refines it on those events.

### 3.2 Transport bindings

> **Status: Implemented.** The three bindings' codecs, the `Last-Event-ID` parser and the gap detector (`checkContinuity`) ship in `packages/protocol/src/project-state-frames.ts`, tested by `packages/protocol/tests/project-state-frames.test.ts`. A host's use of its binding is that host's §10 item.

The exchange rides each host's existing push channel, with one frame per message:

- **Desktop**: the window's RPC WebSocket (`desktop.md` §7.2). The client sends the request `projectSubscribe` (`{ id, method, params }`) with a `SubscribeRequest` as its `params`; its reply (`{ id, result }`) is the `SubscribeResponse`, and later events arrive as unprompted `projectEvents` frames whose `params` is `{ epoch, events }`. A reconnect is a new `projectSubscribe`.
- **Dev server**: a dedicated Server-Sent Events stream at `GET /__studio/project/events`, separate from the reload stream of `server.md` §3.1. Every frame carries `id: <epoch>:<rev>`, naming the last revision the frame carries, so a browser's automatic reconnection sends `Last-Event-ID` and the server reads it as `{ epoch, sinceRev }`. The epoch and the revision travel in the one header because an `EventSource` cannot change its URL after construction, so a query parameter could not follow a reconnect. The epoch is everything before the last colon, and an absent or malformed `Last-Event-ID` reads as `{}`, a first connect. The first frame on every connection is the `SubscribeResponse` as an `event: subscribe` frame; each later frame is an `event: project` frame whose data is `{ epoch, events }`. Unlike the reload stream, this one replays.
- **Cloud**: the session's `/events` WebSocket (`desktop.md` §10.1). The client's first message after open is `{ kind: "subscribe", clientId?, epoch?, sinceRev? }`; the host's first message is `{ kind: "project-subscribe", response }`, with the `SubscribeResponse` nested because it has a `kind` of its own, and later events arrive as `{ kind: "project", epoch, events }`. Messages of any other `kind` on the socket (`fs` batches, git notices) are not part of the exchange.

Every frame is JSON. File bytes inside a frame are a `WireContents`: a JSON string for text (hashed as its UTF-8 encoding, §2.1), or `{ encoding: "base64", data }` for anything else. On the dev server, writes and deletes are HTTP requests rather than stream frames (§5), and their body is the raw bytes. A host MAY batch several events into one frame on every binding, the desktop socket included, since a client already applies a multi-event `events` answer; a client MUST apply them in revision order and MUST treat a frame from another epoch, or one whose first revision is not its last revision plus one, as a gap, which it repairs by subscribing again.

### 3.3 Retiring the resync reasons

> **Status: Pending.** Studio still repairs gaps with the `"open"`, `"reconnect"` and `"commit"` resync reasons of `studio.md` §9.2.

Once a host serves §3.1, its adapter stops reporting resync reasons: a reconnect becomes a subscribe with `sinceRev`, a first open becomes a snapshot, and a commit becomes `gitChanged` plus whatever file events the checkout produced. Until every host serves it, both paths coexist: an adapter whose host answers `projectSubscribe` (or whichever binding §3.2 gives it) uses the subscription and reports no resync reasons, and any other adapter keeps reporting them exactly as `studio.md` §9.2 describes. A client MUST NOT run a resync pass in response to a subscription answer.

## 4. Events

> **Status: Implemented.** Every event type below is declared in `packages/protocol/src/project-state.ts` (`ProjectEvent`), and the conformance suite asserts what each means (§10.4); the events §8 and §9 produce join it with those sections. Which hosts emit them is each host's own item (§10.1 to §10.3).

### 4.1 Common fields and ordering

Every event carries `type`, `rev` and `origin` (§2.4). Events are delivered in revision order and a host MUST NOT reorder or drop one within an epoch. An event that names a file carries its project-relative path, spelled as the Studio Backend Protocol spells paths (`server.md` §4.1), and its `DocId`. Where an event carries `hash`, it is the hash of the bytes the event left on disk.

### 4.2 File events

- `fileAdded { path, docId, isDir, hash? }`: a file or directory appeared. `hash` is absent for a directory, and for a file the host has not hashed yet (§3.1).
- `fileChanged { path, docId, hash }`: a file's bytes changed. A host MUST NOT emit it when the new hash equals the indexed one (a touch that rewrote identical bytes, or the watcher's echo of a write the host already recorded, §2.4).
- `fileRemoved { path, docId, isDir }`: a file or directory disappeared. A directory removal is one event; the host does not also emit one per contained file.
- `fileRenamed { from, to, docId, isDir }`: a file or directory moved, keeping its id. A host emits it for a rename performed through §9 and MAY emit it for a watcher-observed move it can pair by hash; an unpaired move is a removal and an add.

### 4.3 Document and dependency events

- `docChanged { docId, path, kind, hash, indexed }`: what the host knows about a document changed: its bytes, its kind, or whether its references are extracted (`indexed`, §8.2). Emitted after the file event that caused it for every `fileAdded` or `fileChanged` of a file, carrying that event's origin, and on its own, with origin `"external"`, when indexing fills a document in (§3.1) or a configuration change reclassifies it. A client re-reads or re-parses on `docChanged`, never on a bare file event.
- `dependentsInvalidated { cause, docIds, tags, complete }`: documents whose rendering depends on `cause.docId` along an edge of kind `cause.kind` (§8.1), emitted for the file events §8 lists. `tags` names custom-element tags whose definition changed, for caches keyed by tag. `complete` is `false` when the host's graph is partial for this cause (§8.2), in which case the list is a lower bound.
- `componentsChanged { tags }`: the set of discoverable components changed (a definition added, removed or retagged). `tags` is the whole set after the change, not a delta, and replaces the snapshot's `components`. It replaces a client's own re-discovery.

### 4.4 Project-level events

- `projectConfigChanged { path, hash }`: the project configuration document changed.
- `formatsChanged { formats }`: the set of document formats the project can open changed, because the configuration's extensions or the installed packages changed (`extensions.md` §7). `formats` is the new token, replacing the snapshot's. A client rebuilds its format registry.

### 4.5 Git

`gitChanged { status }` reports the repository's state (`GitSummary`: `branch`, `head`, and `changed`, a map from every path whose working state is not `unmodified` to its `WorkingState`). The host's git monitor watches `.git/HEAD`, `.git/index` and `.git/refs`, runs the git CLI after a debounce, and emits the event only when the summary differs from the last one it emitted. A commit, checkout, stage or pull is observed this way whoever ran it.

### 4.6 Readiness

`readiness { state }` reports a transition of the readiness machine (§7).

### 4.7 Conflicts and operations

- `conflict { path, docId, diskHash, writeId, bufferRev? }`: a write or delete through §5 was refused because its base was not what is on disk. `docId` and `diskHash` name what is at the path now, both `null` when nothing is. `writeId` names the refused request, and `bufferRev` echoes the request's own when it carried one; only the request's issuer can interpret it. Its origin is `"external"`, because it records no change. The refused writer already has the conflict in its reply; the event is in the log, and so reaches every subscriber, because any other client holding the same document learns from it that its own base is stale before it tries to save.
- `operationApplied { opId, files }`: a multi-file operation (§9) finished; `files` lists every path it wrote, renamed or removed, in the order it applied them. The individual file events precede it and carry the operation's writes as their origin.

### 4.8 Watcher degradation

`watcherDegraded { reason }`: the host can no longer guarantee that it observes every change (a watch limit reached, a watch error, a network filesystem without events). Clients SHOULD tell the author that changes made outside Studio may not appear until reload. A host that recovers starts a new epoch and ends every open subscription, so each client subscribes again and receives a snapshot.

## 5. Writes and Preconditions

> **Status: Implemented.** `WriteRequest`, `WriteResult`, `DeleteRequest`, the precondition checks (`checkWritePrecondition`, `checkDeletePrecondition`) and the refusal's event (`conflictEvent`) ship in `packages/protocol/src/project-state.ts`, the HTTP binding's headers and refusal (`writePreconditionHeaders`, `parseWritePrecondition`, `parseDeletePrecondition`, `preconditionFailedProblem`) in `packages/protocol/src/project-state-frames.ts`, and the conformance suite asserts every rule below that a driver can reach (§10.4). Two are pinned elsewhere: refusing a request with no base, or with a base this contract does not read, is the binding's, asserted by the frame tests (`packages/protocol/tests/project-state-frames.test.ts`), since a driver's `WriteRequest` always carries one; and a collaboration room writing with a base is the desktop host's §11.3. Which hosts take a base hash is each host's own item (§10.1 to §10.3).

A write names the bytes it replaces. A `WriteRequest` carries `path`, `contents`, `baseHash` (the hash the writer last read, or `null` to assert the file does not exist), `writeId` (chosen by the writer, unique per write) and optionally `bufferRev` (the writer's buffer revision, §6.1, echoed in a refusal and otherwise ignored). The host:

1. reads the current hash of `path` and the `DocId` there (`null` for both when absent);
2. refuses the write when the hash differs from `baseHash`, answering `{ ok: false, conflict: { path, docId, diskHash } }` and emitting `conflict` (§4.7); the disk is untouched;
3. answers `{ ok: true, rev, hash }` with the host's current revision, writing nothing and emitting nothing, when the new bytes hash to what is on disk (an unchanged buffer saved, or a format that round-trips to identical bytes);
4. otherwise notes the write in its echo ledger (§2.4), writes the bytes, and in the same step updates the index to the new hash and appends the `fileAdded` or `fileChanged` event with origin `{ writeId, writeHash }`, followed by its `docChanged` and any `dependentsInvalidated` (§8). It answers `{ ok: true, rev, hash }`, where `rev` is the revision of that file event. The reply never waits for the watcher.

Steps 1 to 4 MUST be atomic with respect to every other write through the host and to the host's processing of watcher observations at the same path.

Against a program outside the host the steps cannot be atomic: it can change the file between the check and the write. A watcher-backed host narrows that window by writing the bytes to a temporary file in the target's directory, re-hashing the target, and renaming the temporary file over it only when the re-hash still equals the base, refusing as in step 2 otherwise. That also means the watcher never observes a half-written file. The temporary file is the host's own and never enters the index or the event stream. What remains is the interval between the re-hash and the rename: a change landing there and replaced before the watcher reads it is lost without an event. It is the one silent overwrite this contract admits, bounded by one rename, and a host that observes a hash matching neither its index nor a pending ledger entry reports it as an external change (§2.4) rather than dropping it. The cloud host, which has no writer outside it, has no such window.

**Deletes.** A delete names what it removes. A `DeleteRequest` carries `path`, `base` and `writeId`. A file's base is `{ hash }`, the hash the writer last read; a directory's base is `{ files }`, every file beneath it by path relative to the directory with the hash the writer last read, and any file added, removed or changed since is a conflict (`checkDeletePrecondition`). The host refuses a stale base exactly as step 2 refuses a write, and otherwise removes the path and, in the same step, drops it from the index and appends `fileRemoved` with origin `{ writeId, writeHash: null }`, answering `{ ok: true, rev }`. So a client's own delete carries its origin, and a delete never discards a change made just before it. Creating a directory can overwrite nothing and takes no base, but carries a `writeId` so its `fileAdded` carries the writer's origin. Moving a file or a directory is a rename (§9).

**Collaboration rooms.** A room's persistence (`collab.md`; `packages/server/src/collab.ts` writes on an explicit save and as a flush on shutdown) goes through this section like any other writer: the room holds the hash it hydrated from or last saved, every save is a write with that base and its own `writeId`, and a refusal is delivered to the room, whose participants resolve it as §6.1 describes. A shutdown flush that is refused leaves the disk untouched and keeps the room's bytes for the next session to offer.

A write or delete MUST NOT be accepted without a base once a host serves this contract; a host that also serves the Studio Backend Protocol's unconditional `writeFile` keeps it only for clients that have not subscribed, and documents it as last-writer-wins. On an HTTP binding the base hash travels as `If-Match: "<hash>"` (or `If-None-Match: *` for `null`), a file's delete is `DELETE` with the same `If-Match`, a directory's carries its `{ files }` base in the body, and a refusal is `412 Precondition Failed` with the conflict as a problem document of type `precondition-failed` whose extension members are `path`, `docId` and `diskHash` (`server.md` §4.3). The content hash is a strong entity tag, quoted; a request whose precondition is absent, weak, a list, `If-Match: *`, or both headers at once is refused before the disk is read, because each of those either names no bytes or names more than one.

## 6. Two Dirty Notions

> **Status: Partial.** The unsaved-buffer derivation (`bufferStatus`, `isBehindDisk`) and `WorkingState` ship in `packages/protocol/src/project-state.ts`. Studio still holds one `dirty` flag per tab and does not track a base hash.

Studio has used one word for two different facts. This contract names them separately, and a client MUST NOT conflate them in state or in the interface.

### 6.1 The unsaved buffer

A client's open copy of a file is a `BufferState`: `diskHash` (what the host last reported on disk), `baseHash` (the disk hash the buffer was loaded from or last saved as), `bufferRev` (bumped on every edit) and `savedRev` (the buffer revision that equals `baseHash`'s bytes). Its status is derived, never stored:

| Condition                                        | Status       | The client                                                  |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------- |
| `bufferRev = savedRev`                           | `clean`      | re-reads silently when `baseHash ≠ diskHash` (behind disk)  |
| `bufferRev ≠ savedRev` and `baseHash = diskHash` | `dirty`      | saves with `baseHash` as the write's base                   |
| `bufferRev ≠ savedRev` and `baseHash ≠ diskHash` | `conflicted` | asks the author to keep theirs, take the disk's, or compare |

A conflicted buffer is never saved without the author's choice. Keeping theirs is a write whose base is the current `diskHash`; taking the disk's discards the buffer.

A co-edited document (`collab.md`) has one buffer, the room's, shared by its participants. The host keeps that buffer's `BufferState` (§11.3): `bufferRev` is the room's document revision, and `baseHash` the hash the room hydrated from or last saved (§5). The table applies to the room as a whole, and a participant's client keeps no buffer state of its own for that document while the room is open.

### 6.2 Saved but uncommitted

A saved file whose bytes differ from the repository's `HEAD` has a `WorkingState` other than `unmodified`, reported by §4.5. This is the source-control notion (`studio.md` §5.5), and it says nothing about buffers. On the cloud a save writes to the project's Durable Object, which is the working tree there; a commit is a separate action.

## 7. Readiness

> **Status: Implemented.** The states and their order (`READINESS_ORDER`, `readinessAtLeast`) ship in `packages/protocol/src/project-state.ts`, and the conformance suite asserts the machine: a host held below `indexed` still answers, readiness advances one state at a time, an install's own lockfile write moves nothing, and only a dependency or extension-set change moves it back (§10.4). Which hosts track readiness is each host's own item (§10.1 to §10.3).

A host reports how far it has prepared the project, as one of five ordered states:

| State                 | Means                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scaffolded`          | the project's files exist; its dependencies may not be installed                                                        |
| `installed`           | the dependencies the manifest declares are installed (or, on a host with no `node_modules`, the lockfile is consistent) |
| `extensions-resolved` | every extension the configuration names is loaded and the format registry is known                                      |
| `indexed`             | every file is hashed and classified and the dependency graph is built                                                   |
| `ready`               | the host serves every part of this contract for the project                                                             |

The host advances one state at a time and emits `readiness` for each. A change to an input moves it back to the first state that input invalidates, and only a change that alters what the state was computed from does:

- **Dependencies.** The host records, with each completed install, a fingerprint of what it installed: the hash of the lockfile it ran against, together with the manifest's dependency fields (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`). It moves back to `scaffolded` only when the current fingerprint differs from the recorded one. A manifest edit that leaves the dependency fields alone (a script, a version bump of the project itself) moves nothing, and neither does the lockfile an install rewrites: the install records its fingerprint after it writes, and its writes carry the install operation's `writeId` (§2.4).
- **Extensions.** A configuration change moves the host back to `installed` only when the set of extensions it names changes; any other configuration change is a `projectConfigChanged` (§4.4) and leaves readiness where it was.

A snapshot carries the current state. A client MUST NOT draw a view that needs a later state as empty or failed while the host is below it. A view that has never had the state it needs shows that the project is still being prepared; a view that had it keeps showing what it last derived while readiness moves back and forward again, and refreshes on the events that follow, so a dependency change never blanks the interface.

## 8. Dependency Graph

> **Status: Implemented.** `createDependencyGraph` in `packages/server/src/project-state/graph.ts`, exported as `@jxsuite/server/project-state/graph`, keeps the graph from `extractRefs` (built on `walkDocRefs` and the walk behind `countTagUses`, §12) and answers each change's invalidations, transitive and deduplicated, with `invalidationEvents` turning them into `dependentsInvalidated` events; its module graph has no I/O import, so every host bundles the same graph (`packages/server/tests/refs-export.test.ts`), and `packages/server/tests/project-state-graph.test.ts` covers each edge kind. The §10.4 cases for a host that serves this section are in the published suite, and the reference host passes them. Each host's own use of the graph is its §10 item: the desktop and dev-server hosts still walk every file per request (`packages/server/src/refactor/`), and Studio still invalidates its caches by path.

The host keeps a directed graph from each document to the documents whose rendering depends on it, built from the references §12 extracts. It recomputes a document's outgoing edges whenever its bytes change, and recomputes the edges that depend on the configuration on every `projectConfigChanged`. An edge whose target path does not exist yet is kept, so a file arriving there reaches the documents that already name it.

The trigger is a file event, not `docChanged`: the host emits dependents for every `fileChanged`, `fileRemoved` and `fileRenamed` of a document that has any, media included, and for every `fileAdded` at a path some document references. For each such event it emits one `dependentsInvalidated` per edge kind that reaches at least one dependent, after the file event and after its `docChanged` when there is one. A removed or renamed document's dependents are invalidated because their references now dangle (unless a rename cascade rewrote them, §9, whose own writes invalidate in turn).

### 8.1 Edge kinds

| Kind                 | From → to                                                                      | Built from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component-instance` | a component definition → each document that instantiates its tag               | tag uses (`countTagUses`) against the component's declared tag, and `$ref` and `$elements` paths to the definition                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `layout-page`        | a layout → each page it wraps                                                  | the page's resolved layout (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `content-collection` | a content entry → each collection that includes it, and each page listing it   | the collection loader's resolved entry list (`site-architecture.md` §6.1), not the `source` alone, since a `{locale}` source is not a glob and `exclude` and `where` leave files out; a document lists a collection through `ContentCollection` and `ContentEntry` state in any scope (`site-architecture.md` §6.4, `spec.md` §23.3) and through each `contentType` its `$paths` names, `each` included (`site-architecture.md` §4.3); between configuration changes the host re-resolves the loader for every file event under a collection's source |
| `media-referrer`     | a media file → each document that references it                                | every other file reference `walkDocRefs` offers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `data-consumer`      | a data or class document → each document whose `$src` or `$prototype` reads it | `$src` references, the document's own `imports`, and the configuration's `imports` for each `$prototype` name the document uses and does not map itself (`imports.md` §1.1)                                                                                                                                                                                                                                                                                                                                                                           |
| `project-config`     | the project configuration or the installed packages → every document           | always; it also emits `formatsChanged` when the format set changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The configuration's own references (`defaults.layout`, `imports`, `copy`, a collection's `source`) are not edges: the host reads them on `projectConfigChanged`, resolving each against the project root as authored, and an edge from the configuration would make every layout it names invalidate every document through it.

Edges are transitive for invalidation: a document invalidated through one edge invalidates its own dependents, and each document appears at most once per emitted event.

A page's **resolved layout** is its `$layout` when it has one, otherwise the configuration's `defaults.layout` (`site-architecture.md` §3.1, §5.2); a page whose `$layout` is `false` has no `layout-page` edge. Most pages name no layout, so the implicit edges are the common case: they are recomputed on every `projectConfigChanged`, and editing the default layout invalidates every page that falls back to it.

A component's **samples** (the definition's own `examples`, drawn by the Site panel's component cards and by Project Styles, `studio.md` §5.7 and §7.2) are not graph dependents: they derive from the definition alone. A client keys its sample and stylebook caches by the component's tag and the definition's hash, and redraws them on that definition's `docChanged`, not when its component registry is replaced (§11.1).

### 8.2 Partial graphs

> **Status: Pending.** No host reports graph completeness.

A host that cannot extract a document's references leaves it `indexed: false`, in its snapshot entry (`IndexedFile`) and in every `docChanged` for it; the host's graph is partial while any document is. Every `dependentsInvalidated` whose dependents could include an unindexed document carries `complete: false`. The cloud host is the expected case: extracting references from a document in a registered format other than JSON (Markdown, CSV, a parser extension's format) runs the project's parser code, which a Durable Object cannot execute.

Because `indexed` travels on the snapshot's files and on `docChanged`, and a removed file leaves with its `fileRemoved`, a client keeps its set of unindexed documents current from the stream alone: a page added after the snapshot arrives as `fileAdded` followed by `docChanged { indexed: false }`. On `complete: false` a client MUST treat every document it holds as unindexed as invalidated too, in addition to `docIds`. A host whose graph is partial still reports every edge it can extract; partial means a lower bound, never a guess.

## 9. Rename Cascade

> **Status: Pending.** A rename and its reference rewrites are separate writes with no rollback (`applyRename` in `packages/server/src/refactor/`), and a referrer open with unsaved edits is rewritten on disk under the buffer.

### 9.1 One operation

A rename is one `RenameOperation { opId, from, to, policy, dirtyReferrers, rewrites? }`. The host plans it before touching the disk: the move, and for every referrer it can parse (found through §8) the rewritten bytes and the hash they replace. It then applies the plan from an **outbox**: each step is recorded before it runs, and a failure undoes the completed steps in reverse, restoring each file's prior bytes, so the project ends either fully renamed or exactly as it was. Every write in the plan carries the operation's write ids, so its events are attributed to it (§2.4), and `operationApplied` follows the last of them. A referrer whose hash changed between planning and applying fails the operation and rolls it back.

**Documents the host cannot parse.** Where the graph is partial (§8.2) the host can neither find nor rewrite references in its unindexed documents, and on the cloud no full walk can either, since it needs the same parser code. A client that can parse them computes those rewrites and sends them as the operation's `rewrites`, each naming the base hash it read; the host applies them as steps of the same outbox, checked and rolled back like every other step. A host whose graph is partial refuses a rename that does not carry `rewrites` (an empty list asserts that the client searched every unindexed document and found no reference), so a rename never quietly leaves references unrewritten. A desktop or dev-server host that can run the project's parsers leaves no document unindexed for this reason, and plans every rewrite itself.

### 9.2 Dirty referrers

A referrer the client holds unsaved is listed in `dirtyReferrers` with its buffer revision. With policy `refuse` the operation is refused before any step runs, naming those referrers. With `rewrite-buffer` the host leaves those files on disk untouched and the client applies the same rewrite to each buffer, which stays dirty for the author to save; the operation's report names them. A client MUST NOT send a rename that omits a dirty referrer it holds.

## 10. Hosts and Conformance

Every host implements §2 to §9 for the project it serves. What differs is where it runs, what it can execute, and where its log lives.

### 10.1 Desktop backend

> **Status: Pending.** The window's `ProjectSession` (`packages/desktop/src/backend/project-session.ts`) forwards watcher batches as `onFileEvents` and pushes `onFileResync`; it keeps no index, hash, log, graph, readiness or git monitor.

The desktop host is the window's project session in the backend utility process, on Node (`desktop.md` §7.1, §7.3). It keeps its index, graph and replay log in memory and starts a new epoch whenever the backend restarts or the window re-roots. Its watcher is the session's (`desktop.md` §10.1), and its git monitor runs the git CLI the backend already uses. It serves §3.2's desktop binding over the window's RPC socket.

### 10.2 Dev server

> **Status: Pending.** The dev server forwards watcher events as `fs` frames on `/__reload` (`server.md` §3.1) and keeps no project model.

The dev-server host serves the active project (`server.md` §4.1) on Bun, with the same in-memory index, graph and log as the desktop host, and serves §3.2's Server-Sent Events binding. Activating another project starts a new epoch. The implementation is the desktop host's, run under Bun: the contract's host code runs on both runtimes, as the modules of `server.md` §1 do.

### 10.3 Cloud

> **Status: Pending.** The cloud session's `/events` socket carries `fs` batches and git notices and replays nothing (`desktop.md` §10.1); the platform is a separate repository.

The cloud host is the project's Durable Object. Hibernation drops memory, so its revision counter and replay log are persisted in the object's SQLite storage (§13.1), and an epoch survives hibernation; a new epoch starts only when the log is discarded. Its index and hashes come from the object's own file store, and every write goes through it, so it has no watcher and no echo ledger: every event's origin is known at the moment of the write. Its dependency graph is partial (§8.2), so its renames rely on the client's rewrites for the documents it cannot parse (§9.1). It serves §3.2's cloud binding.

### 10.4 Conformance suite

> **Status: Implemented.** `runProjectStateConformance` and the `ProjectStateDriver` interface ship in `packages/protocol/src/project-state-conformance.ts`, exported as `@jxsuite/protocol/project-state-conformance`. The suite takes `describe`, `test` and `expect` as a parameter rather than importing a runner, so it runs under `bun:test` here and under Vitest in a Worker. An in-memory reference host (`packages/protocol/tests/reference-host.ts`) passes every case below that applies to all hosts, and `packages/protocol/tests/project-state-conformance.test.ts` turns the suite on deliberately broken variants of it to show each rule fails a host that breaks it. The suite has the §8 cases below and no §9 cases yet. A host that serves neither section runs a negative case for each (it emits no `dependentsInvalidated`, no `operationApplied`); a driver that declares the `graph` hook runs the §8 cases in its place, and one that declares the `rename` hook gets a failing case naming the missing section, so declaring a hook can never switch a check off; the §9 case listed below joins the suite with that section. Once a host is ready every fixture file must be `indexed: true`, unless its driver declares the graph partial (`graph: { complete: false }`, §8.2).

One suite tests every host through the same driver interface: create a project from fixture files, write through the contract, change a file behind the host's back, restart the host, and observe the subscription. The suite covers at least:

- a first subscribe gets a snapshot, also while the host is below `indexed`, and the `docChanged` events that fill it in follow;
- a resubscribe within the window gets exactly the missed events, and one after a restart that started a new epoch, or outside the window, gets a snapshot (a host whose log survives a restart, §10.3, replays instead);
- revisions are strictly increasing and gap-free;
- a write's reply carries the revision of its own file event, and no second event follows when the watcher reports the same bytes;
- a write of the bytes already on disk answers the current revision and emits nothing;
- a write or delete with a stale base is refused and leaves the disk untouched, and an own delete's `fileRemoved` carries its origin;
- an external change carries `"external"`, including one that restores the bytes of an earlier own write;
- an atomic-rename save inside the pairing bound keeps its `DocId`, and one slower than the bound is a removal and an add;
- a coalesced burst of writes emits one event per write and nothing for the watcher's observation;
- readiness advances in order, and an install's own lockfile write does not move it back;
- `gitChanged` follows a commit made outside Studio.

A host that serves §8 also passes: deleting a component invalidates its instances; renaming a media file outside Studio invalidates the documents that reference it; editing the default layout invalidates the pages that name no layout. A host that serves §9 also passes: a rename either completes or leaves every file as it was. The suite is published with the protocol package, so the cloud repository runs it against its own host.

## 11. Clients

### 11.1 One content store

> **Status: Pending.** Studio keeps separate caches (`files/asset-versions.ts`, `services/references`, component discovery, the format registry, the open tabs' documents), each invalidated by its own reading of file events.

A client keeps one store of file contents keyed by `(docId, hash)`, filled by reads and by its own writes, with the path of each document as a relabelable attribute. Every cache it keeps (parsed documents, the version map of `studio.md` §3.4, component metadata and samples, usage counts, previews) is a function of entries in that store and of the graph events, keyed by the document and hash it was derived from. A `fileChanged` or `docChanged` invalidates exactly the derivations keyed by the old hash; a `fileRenamed` relabels the document's path and invalidates nothing by itself, since the bytes are the same; `dependentsInvalidated` invalidates the derivations of the listed documents; a snapshot invalidates every derivation whose key it does not contain. No cache subscribes to file events on its own.

### 11.2 The preview realm

> **Status: Pending.** The Library's and the Site panel's document previews render in Studio's own realm, sharing its custom-element registry and globals.

Previews of project documents outside the canvas (the Library, the Site panel, component cards) render in one isolated realm: a same-origin `<iframe>` with its own custom-element registry, fed from the content store (§11.1) by message. A project component's definition, a stylesheet or a script in a previewed document never reaches Studio's own realm, and a changed definition is redefined there by replacing the realm rather than by the registry, which cannot redefine a tag.

### 11.3 Collaboration rooms and the preview overlay

> **Status: Pending.** Collaboration rooms are created per path on demand (`collab.md` §2) and save with no base (`packages/server/src/collab.ts`), and the live preview overlay is set and cleared by each client (`studio.md` §10.1); neither follows the index.

The host owns both by `DocId`. A room follows its document across a rename and is closed when the document is removed; it holds the document's shared buffer state (§6.1) and saves through §5. An overlay is keyed by the document and the `clientId` of the client that set it (§3.1), not by a connection: the socket drops for ordinary reasons (an idle timeout, a suspended window, `desktop.md` §10.1) and a host ends every subscription when its watcher recovers (§4.8), and none of those may unpublish an author's preview. The host drops a client's overlays once no subscription with that `clientId` has been open for a grace period (`overlayGraceMs`, configurable per host, default 30 seconds), so a closed window never leaves unsaved bytes published for longer than that. A client that sent no `clientId` has its overlays dropped when its subscription ends.

## 12. Reference Extraction

> **Status: Implemented.** `@jxsuite/server/refactor/refs` exports `walkDocRefs`, `countTagUses` and `rewriteDocRefs` from `packages/server/src/refactor/refs.ts`, whose module graph (it and `paths.ts`, plus `@jxsuite/schema`'s guards and asset paths) has no filesystem, process or watcher import; `packages/server/tests/refs-export.test.ts` imports the entry under Bun, bundles it for the browser, and fails on any `node:`, builtin or `chokidar` import in its graph and on any `process` or `Bun` global in the bundled code. Node does not load the TypeScript sources directly (extensionless relative imports, and no type stripping under `node_modules`), so a Node host reaches the walk through a bundle, as the desktop backend already does (`desktop.md` §7.1).

What counts as a reference in a Jx document has one definition: `walkDocRefs`, which takes a parsed document and a visitor and performs no I/O. It is published as a subpath export whose module graph contains no filesystem, process or watcher import, so Bun imports it as source and every other host bundles it unchanged (a Durable Object's Worker, a browser, the desktop backend's Node bundle), and the dependency graph (§8) of every host is built from the same walk as the rename refactor and the usage query.

## 13. Persistence and the Native Core

### 13.1 Persistence dialect

> **Status: Pending.** Nothing is persisted.

Any persisted form of this contract's state (the cloud's replay log first; the desktop's, if measurement ever asks for one) uses the common subset of SQLite: plain tables, `INTEGER`, `TEXT` and `BLOB` columns, no extension functions, no dialect-specific pragmas in the schema. That keeps one schema valid in a Durable Object's SQLite storage and in an embedded SQLite-compatible engine (Turso) on the desktop. A persisted log stores events as JSON text keyed by `(epoch, rev)`, and trims from the oldest revision.

### 13.2 Native core

> **Status: Pending.** The contract's host logic is TypeScript only, and no measurement has been taken.

The host logic (index, hashing, graph, log) may later move into one Rust core, compiled natively for the desktop backend and to WebAssembly for the Durable Object, with storage behind a trait so the same core runs on either persistence. That is deferred until the TypeScript hosts are measured on large projects; the contract does not change if it happens.

## 14. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md).

| Standard                                            | Class        | Binds | Evidence                                                                                            | Note                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------ | ----- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Subresource Integrity](https://www.w3.org/TR/SRI/) | **Borrowed** | §2.1  | packages/protocol/src/project-state.ts, packages/protocol/tests/project-state.test.ts               | Shape only: a content hash is spelled as SRI's hash expression for SHA-256 (`sha256-` and base64). Nothing fetches by it or verifies a response against it, and the other algorithms and options of the grammar are not accepted.                                                                                                                     |
| [WHATWG HTML](https://html.spec.whatwg.org/)        | **Subset**   | §3.2  | packages/protocol/src/project-state-frames.ts, packages/protocol/tests/project-state-frames.test.ts | The Server-Sent Events section: the dev server's project stream writes `id`, `event` and `data` fields, `Last-Event-ID` is read as a replay cursor (`<epoch>:<rev>`), and `parseSseBlock` reads one block as the event-stream parser does. The stream never sends `retry`, and the reload stream of `server.md` §3.1 keeps its deliberate non-replay. |
| [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455)  | **Subset**   | §3.2  | packages/protocol/src/project-state-frames.ts, packages/protocol/tests/project-state-frames.test.ts | The desktop RPC socket and the cloud `/events` socket carry the subscribe exchange as JSON text frames, one message per frame. No binary frame, subprotocol or extension is used.                                                                                                                                                                     |
| [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)  | **Subset**   | §5    | packages/protocol/src/project-state-frames.ts, packages/protocol/tests/project-state-frames.test.ts | The content hash is a strong entity tag: a write's base travels as `If-Match` (`If-None-Match: *` for a create), and a refused write is `412 Precondition Failed`. Only one strong tag is accepted: `If-Match: *`, weak tags and tag lists are refused, because each names no bytes or more than one.                                                 |
| [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)  | **Rejected** | §4    | —                                                                                                   | because: an event names what changed and the hash of the result, and a client reads the bytes by path when it needs them. Shipping JSON Patch deltas would make every non-JSON format unrepresentable and duplicate the structural merge collaboration already performs (`collab.md`), for no gain the hash does not give.                            |

## Changelog

- **0.1.0-draft** (2026-11-21) — Initial specification: the project state contract (identity and hashes, revisions and replay, subscription, events, write preconditions, the two dirty notions, readiness, the dependency graph, the rename cascade, hosts and conformance, clients, reference extraction, persistence).

---

_Jx Project State Specification v0.1.0-draft_
