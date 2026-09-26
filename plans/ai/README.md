# ai.md audit

Audited against b900b326 on 2026-09-26.

## Verified

- §1 (the package, its Worker-safe leaves): packages/ai/package.json, packages/ai/tests/worker-safety.test.ts, the root `typecheck:ai-worker` script (run by .github/workflows/test.yml)
- §2, the parts its Partial marker names as shipping (the wire, the `usage` frame, calls rather than the finish deciding, Stop armed before the first wait): packages/ai/src/gateway/normalize.ts, packages/ai/src/streaming-client.ts, packages/studio/src/services/tool-executor.ts, packages/studio/src/services/document-assistant.ts, packages/ai/tests/streaming-client.test.ts. The proxy half of model listing (`200` with a default catalogue and `upstreamError`) ships in packages/server/src/ai-api.ts; the client half is the open item.
- §2.1 (managed providers, the capability probe, probe invalidation, per-model `toolSupport` and `contextWindow`; marked Implemented): packages/studio/src/ui/ai-managed-connect.ts, packages/studio/src/services/ai-models.ts, packages/studio/src/services/context-manager.ts
- §2.2, its shipped history rule (no empty assistant turn, reasoning replayed): `toMessagesArray` in packages/ai/src/chat-state.ts, the `reasoning` frame in packages/ai/src/gateway/normalize.ts, packages/ai/tests/chat-state.test.ts. Its leading marker now reads Partial, keeping this evidence, because the section's later marker (the native Anthropic provider) is open.
- §2.4 (one gateway implementation; marked Implemented): packages/ai/src/gateway/chat.ts, packages/server/src/ai-api.ts, packages/server/tests/ai-upstream-fixtures.test.ts, packages/ai/tests/gateway-*.test.ts
- §3.0–§3.3 (commands by name, the schema gate, the accountable turn, the batch following the document): packages/studio/src/panels/ai-panel.ts, packages/studio/src/commands/live-context.ts, packages/studio/src/services/jx-validate.ts, packages/studio/src/services/ai-write-report.ts, packages/studio/src/services/ai-writes.ts, packages/studio/src/services/tool-executor.ts, packages/studio/tests/ai-tools.test.ts
- §3.4–§3.6 (`ask_user` and pair repair, `import_site` adoption, command tools and the composite registry): packages/studio/src/services/ai-ask.ts, packages/studio/src/services/context-manager.ts, packages/studio/src/services/ai-import-tools.ts, packages/studio/src/services/project-adoption.ts, packages/studio/src/services/ai-command-tools.ts, packages/studio/src/services/ai-system-prompt.ts, packages/studio/tests/ai-ask.test.ts, packages/studio/tests/ai-import-tools.test.ts, packages/studio/tests/ai-command-tools.test.ts
- §3.7 (`ToolContext`; marked Implemented): packages/ai/src/tools.ts, packages/ai/src/core-types.ts, packages/ai/tests/tool-context.test.ts
- §4, the parts its Partial marker names as holding (the file/RPC surfaces, the Origin/Host gate, path containment): packages/server/src/net-guard.ts
- Informative: §5 (Standards Alignment). Its four `**Subset**` cells are conformance classes. The WHATWG HTML and RFC 9457 rows hold per their evidence column; the two IANA rows bind §4 and describe the guard as §4's marker says it should be, so their tier follows that marker.

## Dispositioned without a plan

- No roadmap, status ledger or stale status cell.

## Spec-wide decisions

- The whole-spec marker (line 12) and §2.2's later Partial (line 67) are left as they are: both are accurate and both belong to the active harness plan. The line-67 marker is about §2's provider set rather than §2.2's history rule (it closed §2 before §2.2 was inserted above it), and the `createAnthropicStreamingClient` docblock in packages/ai/src/streaming-client.ts still says "throws on use" although it yields. The slice that closes the Anthropic marker flips §2.2's leading marker too.
- §2 and §4 each carry one open item with its own owner, split by workspace: §2 is the Studio client's reading of a failed model listing, §4 is the server's host guard. §2's "blocks cloud-metadata/link-local hosts" clause is the same defect as §4's and is recorded only in §4's marker, so closing §2 never depends on the guard.
