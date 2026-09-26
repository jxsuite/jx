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
