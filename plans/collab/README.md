# collab.md audit

Audited against b900b326 on 2026-09-26.

## Verified

- §2.1 (subprotocol negotiation, the probe, an unanswered probe connecting unoffered on the gateway): packages/collab/src/negotiate.ts, packages/server/src/collab.ts, packages/studio/src/platforms/devserver.ts, packages/studio/src/platforms/cloud.ts, packages/collab/tests/negotiate.test.ts, packages/server/tests/collab-api.test.ts. The dev server adapter treating its own unanswered probe as no collaboration is §4's open item, not a §2.1 divergence: §2.1's rule is stated for the separately deployed gateway.
- Informative: §6 (Standards Alignment). `**Adopted**` and `**Rejected**` are conformance classes. The RFC 6455 row holds per the §2.1 evidence. The RFC 7692 row holds as a rejection: browsers offer `permessage-deflate` on every handshake and the WebSocket API cannot suppress it, and the dev server declines it because Bun's `perMessageDeflate` defaults off and neither `Bun.serve` in packages/server/src/server.ts nor the collab websocket handler sets it; no test pins it, and the gateway is outside this repository. §2's sentence saying the extension is "not offered" is §2's open item.

## Dispositioned without a plan

- No roadmap, status ledger or stale status cell.

## Spec-wide decisions

- A reason co-editing does not start reaches the author through §4's `failed` state and nothing else. §5's "the author is told why" and §2.1's "the reason can be reported" are closed by the §4 change, so the skew work builds on it rather than adding a channel of its own, and §5 does not flip to Implemented before §4 does.
- §3's third bullet (the op bridge) is judged in §3.1, which tables it. Its shortfalls are §3.1's open item, and §3 does not flip to Implemented before §3.1 does.
- §4's promised state machine belongs to §4's owner, because that plan changes the lifecycle the machine describes. The whole-spec marker lists only modules no section yet claims to specify.
- The drawn edges are the two above and no others: `plan:collab/room-schema-skew` requires `plan:collab/attach-failure-state` (its refusal reaches the author only through `CollabOpenError` and the failed attach that destroys its handle), and `plan:collab/epoch-continuity` requires `plan:collab/granular-writes` (§3's op-bridge bullet). Every other shared file or section is a textual rebase, because each plan cites the rule another owns rather than restating it.
- One owner per rule, cited by the rest. When the host issues an epoch, and which copy of the document a tab brings into a room whose history was replaced, are §3's first bullet (`plan:collab/epoch-continuity`); §4's reset step (`plan:collab/attach-failure-state`) and §1.1, §1.2 and §2.3 (`plan:collab/spec-coverage`) cite it. What a refusal means to the author is §4. The shared-document version is §5 (`plan:collab/room-schema-skew`), which adds its field, code and sentence to §2.3 and §1.1 in whichever order the two land. The host's side of the open handshake is §1.1; §4's lifecycle describes it from the tab.
- The host drops a room's history through one helper, `discardRoom(path, room): number` in `ws-room.ts`, which bumps the path's epoch and returns it. `plan:collab/epoch-continuity` and `plan:collab/room-schema-skew` both introduce it with that signature; whichever lands second keeps the one helper, and every discard (reset, empty-room teardown, re-creation at another shared-document version) goes through it and is listed in §3's first bullet.
- No plan here moves `COLLAB_SCHEMA_VERSION` or the `jx.collab.v1` token: granular-writes changes write paths only, epoch-continuity compares epochs only for equality, spec-coverage's `flush-ack` `error` is an optional field, and room-schema-skew ships its guard at 2. A later plan whose change a peer at the previous version would misread bumps the version and requires `plan:collab/room-schema-skew`.
- Graduation rides on whichever plan closes collab.md's last open item. attach-failure-state and granular-writes can never be last (each has a dependent here); the other four carry the clause.
- Two docs pages take edits from several plans. `docs/studio/publish/collaboration.md` has no `spec:` list: whichever of granular-writes and spec-coverage lands first creates it. In `docs/extending/embedding/backend-protocol.md` each plan's new paragraph goes at the end of the `collab` bullet, in landing order.
