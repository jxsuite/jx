/**
 * `@jxsuite/ai/testing`: what a backend's own test suite runs to prove its chat and models routes
 * are the ones a Jx client expects (specs/ai.md §2.4), and what a host's suite runs a turn against:
 * a scripted model and an in-memory document host (specs/ai.md §3.12).
 *
 * It imports no test runner. A conformance case throws a plain `Error` naming what it expected, so
 * `bun:test`, `node:test` or a Worker's own harness can each run it as one test per case.
 *
 * Worker-safe, like the gateway it exercises (`tests/worker-safety.test.ts`).
 *
 * @module @jxsuite/ai/testing
 * @docs extending/embedding/backend-protocol
 */

export { fakeUpstream } from "./fake-upstream.ts";
export { gatewayConformanceCases } from "./conformance.ts";
export { createMemoryHarnessHost } from "./memory-host.ts";
export { scriptedModel } from "./scripted-model.ts";
export type { MemoryHarnessHost } from "./memory-host.ts";
export type { ScriptedModel } from "./scripted-model.ts";
export type { FakeUpstream, UpstreamFetch, UpstreamFixture } from "./fake-upstream.ts";
export type { ConformanceCase, ConformanceGateway, ConformanceOptions } from "./conformance.ts";
