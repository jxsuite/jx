---
status: stub
disposition: reconcile
claims:
  - collab.md
  - collab.md#1
  - collab.md#2
size: M
---

# The collab spec specifies the subsystem that ships, starting with the backends that serve it

## Context

Three items, one piece of work. All three are the spec lagging code that is right, all three are paper, and §1's and §2's corrections open the backend and wire description the coverage pass has to write anyway, so they land together.

The whole-spec marker, `specs/collab.md` line 12:

> **Status: Partial.** This is a stub spec for a shipped subsystem that grew ahead of its specification. It records the wire contract and the load-bearing invariants as implemented today; the room host (`packages/collab/src/ws-room.ts`), the dev server's explicit-save persistence (`packages/server/src/collab.ts`), the source-canonical lock (`packages/collab/src/source-lock.ts`), the envelope's frame types and control messages (`packages/collab/src/envelope.ts`) and the awareness state shape (`packages/collab/src/awareness-types.ts`) ship but are not yet specified here.

§1, line 16:

> **Status: Partial.** `/__studio/collab` is served by the dev server (`packages/server/src/collab.ts`, wired in `server.ts`) and, under its session prefix, by the cloud gateway Studio reaches through `packages/studio/src/platforms/cloud.ts`, which this section does not name. Neither desktop launcher serves it: the Electrobun app's adapter (`packages/desktop/src/platform.ts`), the Chromium launcher's (`packages/desktop/src/chromium/platform.ts`) and the project server both start (`packages/server/src/project-server.ts`) implement no `collab`, so collaboration is `unavailable` on desktop.

§2, line 22:

> **Status: Partial.** The transport, the epoch-tagged envelope, out-of-band awareness and the `jx.collab.v1` subprotocol ship (`packages/collab/src/envelope.ts`, `ws-client.ts`, `packages/collab/tests/envelope.test.ts`, `ws-wire.test.ts`). The compression bullet does not hold as written: the client opens its socket through the platform `WebSocket` (`ws-client.ts`), which offers `permessage-deflate` on every handshake and has no way to suppress the offer, so the extension is declined rather than not offered. The dev server declines it only because Bun's `perMessageDeflate` is off by default and `packages/server/src/server.ts` does not set it, no test pins that, and the cloud gateway is outside this repository.

Disposition `reconcile`: the code is right. `collab?` is an optional PAL member (`packages/studio/src/types.ts`), and desktop.md §3 and §10.3 already say a platform without it edits solo with file-level saves; nothing in desktop.md promises co-editing on the desktop app. A browser client cannot decline to offer `permessage-deflate`, so §2's reasons for rejecting RFC 7692 stand and only the sentence describing the handshake is wrong.

**What exists**

- Two backends. The dev server: `createCollabRegistry` in `packages/server/src/collab.ts`, routed at `/__studio/collab` in `packages/server/src/server.ts`, probe answer `{collab: true, protocols, version}`. The cloud gateway: `collab()` in `packages/studio/src/platforms/cloud.ts`, probing `api("/collab")` and connecting to `${base}/collab` under `sessionBase`, with a `hydratePath` hook the dev server does not need. The protocol route is `collab` in `packages/protocol/src/routes.ts`, and desktop.md §5.1 says gateway prefixes preserve its sub-path.
- Neither desktop adapter defines `collab`: `createDesktopPlatform` in `packages/desktop/src/platform.ts` (the Electrobun app, bootstrapped by `init.ts`) and `packages/desktop/src/chromium/platform.ts`. Both launchers start `createProjectServer` (`window-manager.ts`, `chromium/index.ts`), which routes no `collab`.
- The room host, `createCollabHost` in `packages/collab/src/ws-room.ts`, shared by the dev server and the platform's Durable Object: one `Y.Doc` per path, server-seeded `source`, the y-protocols sync handshake, project-level awareness relay, read-only enforcement, and the `docEpoch`/`doc-reset` lifecycle.
- The envelope in `packages/collab/src/envelope.ts`: four frame types (`FRAME_DOC_SYNC`, `FRAME_AWARENESS`, `FRAME_DOC_CLOSE`, `FRAME_CONTROL`) and eight control messages in the `ControlMessage` union (`hello`, `open`, `opened`, `doc-reset`, `flush`, `flush-ack`, `doc-dirty`, `error`, the last with its refusal codes). §2 names the envelope only as "an epoch tag" and §2.1 names only `hello`.
- Persistence in `packages/server/src/collab.ts`: explicit flush on save and on graceful shutdown, the room-level dirty signal (`markPersisted`, `doc-dirty`), the 30-second empty-room grace before teardown, and an epoch bump on a genuinely external change (`handleExternalChange`).
- The source-canonical lock in `packages/collab/src/source-lock.ts` (`meta.canonical`, `meta.canonicalRev`, stale-mirror discard), which §4 mentions only as a freeze the UI shows.
- The awareness state shape in `packages/collab/src/awareness-types.ts`.
- `permessage-deflate`: `createWsCollabConnection` in `packages/collab/src/ws-client.ts` constructs `globalThis.WebSocket` with only a URL and subprotocols, and `Bun.serve` in `packages/server/src/server.ts` passes `collabRegistry.websocket` without `perMessageDeflate`.

**What is missing**

- §1 rewritten to name the dev server and the cloud gateway, and to say the desktop app offers no co-editing.
- §2's compression bullet rewritten to say the extension is never negotiated because the servers decline the browser's offer, and a server test that pins the declined extension.
- Additive sections for the room host, the envelope's frame types and control messages, persistence, the source-canonical lock and the awareness state shape.
- The whole-spec marker removed once those sections exist, which is a `minor` release (new sections).

**Related**

- desktop.md §3 (the `collab?` PAL member), desktop.md §5.1 (gateway prefixes), desktop.md §10.3 (collaboration as shipped).
- studio.md §14 (read-only collaborators and the save prompt), studio.md §17 (the `project.json` exclusion, stated in both specs).
- collab.md §4's state machine is not in scope here: `plan:collab/attach-failure-state` changes that lifecycle and writes it down.
- The room host section describes the epoch lifecycle that `plan:collab/epoch-continuity` changes; whichever lands second writes it to match.
