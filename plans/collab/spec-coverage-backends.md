---
status: drafted
disposition: reconcile
claims:
  - collab.md#1
  - collab.md#2
requires: []
workspaces:
  - packages/server
size: S
---

# collab.md names the two backends that serve co-editing, says the desktop app has none, and says the server is what declines compression

## Context

Split from `plan:collab/spec-coverage`, which keeps the whole-spec marker and the sections it needs. These two items are paper plus one regression test, share no decision with that work, and can land ahead of it.

`specs/collab.md` §1, line 16:

> **Status: Partial.** `/__studio/collab` is served by the dev server (`packages/server/src/collab.ts`, wired in `server.ts`) and, under its session prefix, by the cloud gateway Studio reaches through `packages/studio/src/platforms/cloud.ts`, which this section does not name. Neither desktop launcher serves it: the Electrobun app's adapter (`packages/desktop/src/platform.ts`), the Chromium launcher's (`packages/desktop/src/chromium/platform.ts`) and the project server both start (`packages/server/src/project-server.ts`) implement no `collab`, so collaboration is `unavailable` on desktop.

`specs/collab.md` §2, line 22:

> **Status: Partial.** The transport, the epoch-tagged envelope, out-of-band awareness and the `jx.collab.v1` subprotocol ship (`packages/collab/src/envelope.ts`, `ws-client.ts`, `packages/collab/tests/envelope.test.ts`, `ws-wire.test.ts`). The compression bullet does not hold as written: the client opens its socket through the platform `WebSocket` (`ws-client.ts`), which offers `permessage-deflate` on every handshake and has no way to suppress the offer, so the extension is declined rather than not offered. The dev server declines it only because Bun's `perMessageDeflate` is off by default and `packages/server/src/server.ts` does not set it, no test pins that, and the cloud gateway is outside this repository.

Both markers re-verified against the tree on 2026-09-27.

- **Dev server.** `createCollabRegistry` (`packages/server/src/collab.ts`) is routed at `/__studio/collab` inside the `enableStudio` branch of `createDevServer`'s `fetch` (`packages/server/src/server.ts`); a server started with `studio: false` routes no `/__studio/*` path at all. The probe answers `{collab: true, protocols: ["jx.collab.v1"], version: 1}`, and every connection is `local-<n>` with write permission (`websocket.open`). §1's last sentence says the route "also answers a capability probe when collab is disabled": no server in this repository answers a negative probe, and what `{collab: false}` means is collab.md §4's rule (`plan:collab/attach-failure-state`).
- **Cloud gateway.** `collab()` in `packages/studio/src/platforms/cloud.ts` probes `api("/collab")` and connects to `${base}/collab` under the session base, with a `hydratePath` hook that reads the file over HTTP. desktop.md §5.1 says gateway prefixes preserve the sub-path; desktop.md §10.1 lists `collab` among the cloud adapter's members. The gateway ships outside this repository.
- **Desktop.** `createDesktopPlatform` (`packages/desktop/src/platform.ts`) and the Chromium adapter (`packages/desktop/src/chromium/platform.ts`) define no `collab`; both launchers start `createProjectServer` (`packages/server/src/project-server.ts`), which routes no `collab`. desktop.md §3 (the optional `collab?` member) and §10.3 already say a platform without it edits solo with file-level saves, and `docs/studio/publish/collaboration.md` already says the desktop app is always solo. Nothing promises co-editing there.
- **Compression.** `createWsCollabConnection` (`packages/collab/src/ws-client.ts`) calls the platform `WebSocket` constructor with a URL and subprotocols only, and the WebSocket API gives a page no way to withhold the `permessage-deflate` offer. `Bun.serve` in `server.ts` passes `websocket: collabRegistry.websocket` and never sets `perMessageDeflate`, which Bun defaults off, so the 101 carries no `Sec-WebSocket-Extensions`. `packages/server/tests/collab-api.test.ts` checks the subprotocol echo and nothing about extensions.
- §6's RFC 7692 row stays `**Rejected**` with evidence `—` (standards.md §3's vocabulary table and §6.2 forbid evidence on a Rejected row); its reasons stand unchanged.

## Outcome

- collab.md §1 → Implemented: it names the dev server and the cloud gateway, and says the desktop app offers no co-editing.
- collab.md §2 → Implemented: the compression bullet says a backend declines the extension, and a dev server test pins the declined offer.

## Decisions

- **Decided:** reconcile rather than build desktop co-editing, because `collab?` is an optional PAL member (desktop.md §3), desktop.md §10.3 and the user docs already state the solo behaviour, and no spec promises co-editing on the desktop app.
- **Decided:** §2's rule binds the server ("declines"), because a browser cannot withhold the offer; the RFC 7692 row's class and reasons are unchanged.
- **Decided:** the pin is a raw HTTP/1.1 upgrade over `node:net` against the real dev server, because whether Bun's own WebSocket client offers the extension is a property of Bun, while a raw request makes the offer explicit and reads the answer header by header.
- **Decided:** §1 does not say what a backend without collaboration answers to the probe; it points at §4, because collab.md §4's owner writes that rule.

## Implementation

1. `packages/server/tests/collab-api.test.ts`: import `connect` from `node:net`. Add a module-level helper `rawUpgrade(port: number, headers: Record<string, string>): Promise<string>` that opens a socket to `127.0.0.1:port`, writes `GET /__studio/collab HTTP/1.1` with `Host: localhost:<port>` (the loopback Host the studio gate accepts), `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==`, `Sec-WebSocket-Version: 13` and the given headers, collects data until the first `\r\n\r\n`, destroys the socket and resolves the head. Use it in the new case under `describe("/__studio/collab")` (see Tests).
2. No source change.

**Integration contract.** Once this lands, collab.md §1 names both backends and the desktop app's absence, and §2's compression bullet says a backend declines `permessage-deflate`; `plan:collab/spec-coverage` adds §1.1, §1.2 and §2.2 to §2.4 as new subsections without touching the text written here, and `plan:collab/attach-failure-state` rewrites §4's first paragraph, which §1 now points at. `rawUpgrade` is there for later server tests of the handshake.

## Tests

`cd packages/server && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/server` from the root.

- `tests/collab-api.test.ts`, new `an upgrade offering permessage-deflate opens without the extension`: `rawUpgrade(server.port, { "Sec-WebSocket-Protocol": "jx.collab.v1", "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits" })`; the head's status line starts `HTTP/1.1 101`, a header line matches `/^sec-websocket-protocol: jx\.collab\.v1\r?$/im`, and no line matches `/^sec-websocket-extensions:/im`. Setting `perMessageDeflate: true` on `Bun.serve` in `server.ts` makes it fail.

Coverage: test-only, so per-file thresholds in `packages/server/bunfig.toml` (lines 0.96, functions 0.95) and the manifest are unaffected; no ratchet.

## Specs & docs

**collab.md §1** (in place): delete the line-16 marker. Replace the body with:

```markdown
`@jxsuite/collab` provides multi-participant, real-time co-editing of a Jx project. Documents are modeled as [Yjs](https://github.com/yjs/yjs) shared types; edits converge via CRDT merge, so concurrent editors do not clobber each other.

The transport is one WebSocket route, `collab`, and a plain GET on the same URL is its capability probe (§2.1). The dev server serves it at `/__studio/collab`; a gateway serves it under its own prefix with the same sub-path (desktop.md §5.1). Two backends serve it, and both host their rooms with the same module, `createCollabHost` (`@jxsuite/collab/room`):

- **The dev server** (`packages/server/src/collab.ts`, routed in `server.ts`) whenever it serves the Studio API, which is its default (`studio: true`). Every connection gets a local identity, `local-1`, `local-2` and so on, with write access.
- **The cloud gateway**, deployed separately from this repository, which Studio reaches through its cloud adapter (`packages/studio/src/platforms/cloud.ts`) at `collab` under the session's base path, with real identities and per-person write or read access.

**The desktop app offers no co-editing.** Neither launcher routes `collab` (the project server both start, `packages/server/src/project-server.ts`, has no such route), and neither platform adapter (`packages/desktop/src/platform.ts`, `packages/desktop/src/chromium/platform.ts`) has a `collab` member, so every document there is `unavailable` (§4) and edits solo with file-level saves (desktop.md §3, §10.3). What a backend without collaboration answers to the probe, and what the editor shows, is §4's rule.
```

**collab.md §2** (in place): delete the line-22 marker. Replace the **No compression.** bullet with:

```markdown
- **No compression.** `permessage-deflate` (RFC 7692) is never negotiated. A browser's WebSocket offers it on every handshake and gives a page no way to withhold the offer, so the rule binds the server: a backend declines the extension, answering the upgrade with no `Sec-WebSocket-Extensions` header. The dev server declines it by leaving Bun's `perMessageDeflate` at its default, off, and a test pins the declined offer. The reasons are structural rather than a deferral: lib0-encoded Yjs updates are near-incompressible, the dominant frame volume is awareness cursors whose payload is smaller than a deflate block header, both transports are loopback or already compressed at the edge, and Bun allocates a zlib context per socket — a real per-connection cost on a server whose whole purpose is many concurrent sockets. Adopting it would cost memory to make the wire slightly larger.
```

§6's RFC 7692 row is unchanged.

**Fragment**: `bun run spec:change collab.md minor -m "§1 names the two backends that serve the collab route, the dev server and the cloud gateway, and says the desktop app offers no co-editing; §2 says a backend declines permessage-deflate rather than the client never offering it, and a dev server test pins the declined offer."`

**Docs** (no em dashes). `bun run docs:sync` names no page: only a test file changes. One page changes anyway, because it is where a backend author reads the `collab` contract:

- `docs/extending/embedding/backend-protocol.md`: add `collab.md#1` and `collab.md#2` to `spec:`. In the `collab` bullet, after the `protocols` paragraph, add: "Decline `permessage-deflate`. Browsers offer it on every handshake, and a backend answers the upgrade without a `Sec-WebSocket-Extensions` header, because the envelope's frames are already compact binary and a compression context per socket costs more than it saves (collab.md §2)."

`docs/studio/publish/collaboration.md` ("Which setups support it" already says the desktop app is always solo), `docs/extending/reference/studio-routes.md` (generated from `routes.ts`) and `docs/framework/build/dev-server.md` need no change.

**Graduation.** Nothing in collab.md requires this plan and it requires nothing, so it can land last. If §1 and §2 are collab.md's last open items when it lands (`bun run plans:status --spec collab`), this pull request graduates the spec instead of writing the fragment: `**Status:** Implemented`, then `bun run spec:bump collab.md minor -m "…"` in place with the sentence above (a graduation riding on the last execution, per the release table in plans/README.md), and `plans/collab/` deleted.

## Acceptance

- `cd packages/server && bun test --isolate --coverage` is green with the new case listed; `bun scripts/check-coverage-manifest.ts packages/server` passes.
- `bun run plans:status --spec collab` no longer lists §1 or §2; `bun run plans:check --audit collab` reports nothing for this file.
- `bun run docs:status`, `bun run docs:spec-release` (the fragment is present), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:standards` are green.
- `grep -n "dev/desktop server\|not offered and not accepted" specs/collab.md` prints nothing.
