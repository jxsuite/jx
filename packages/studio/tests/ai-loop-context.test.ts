/**
 * The context `runAgentLoop` gives each tool call (specs/ai.md §3.7): its own signal, its id, the
 * turn's ledger and the conversation's facts, carried to the tool through every registry that wraps
 * it.
 */
import "./with-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { createChatState } from "@jxsuite/ai";
import {
  createSessionFacts,
  createToolContext,
  createToolDefinition,
  createToolRegistry,
} from "@jxsuite/ai/tools";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { ToolContext, ToolRegistry } from "@jxsuite/ai/tools";
import { runAgentLoop } from "../src/services/tool-executor";
import { createGatedToolRegistry } from "../src/services/gated-registry";
import { composeToolRegistries, createCommandToolRegistry } from "../src/services/ai-command-tools";
import { resetAiWrites, writesForTurn } from "../src/services/ai-writes";
import { beginImportRun, importRun, resetImportRuns } from "../src/services/import-run";

function fakeClient(rounds: StreamEvent[][]): StreamingClient {
  let call = 0;
  return {
    async *streamChat() {
      const events = rounds[call] ?? [{ type: "done", stopReason: "stop" }];
      call += 1;
      yield* events;
    },
  };
}

function calls(...ids: string[]): StreamEvent[] {
  return [
    ...ids.flatMap((id): StreamEvent[] => [
      { type: "tool_call_start", id, name: "probe" },
      { type: "tool_call_end", id },
    ]),
    { type: "done", stopReason: "tool_calls" },
  ];
}

/** A registry with one tool that keeps every context it is handed and records one write each. */
function probeRegistry(onCall?: (ctx: ToolContext) => void | Promise<void>) {
  const seen: ToolContext[] = [];
  const registry = createToolRegistry();
  registry.register(
    createToolDefinition({
      name: "probe",
      description: "keeps its context",
      parameters: { type: "object", properties: {} },
      async execute(_args, ctx) {
        seen.push(ctx);
        ctx.ledger.record({ disk: false, ok: true, path: `/${ctx.callId}.json`, tool: "Probe" });
        await onCall?.(ctx);
        return { success: true, summary: "Probed." };
      },
    }),
  );
  return { registry: registry as ToolRegistry, seen };
}

afterEach(() => {
  resetAiWrites();
  resetImportRuns();
});

describe("the context a call runs with", () => {
  test("each call has its own id, and every call records into the turn's one ledger", async () => {
    const { registry, seen } = probeRegistry();
    const chatState = createChatState({ model: "test" });
    const session = createSessionFacts("s1");
    chatState.sendMessage("probe twice");
    await runAgentLoop({
      chatState,
      session,
      streamingClient: fakeClient([calls("a", "b"), [{ type: "done", stopReason: "stop" }]]),
      systemPrompt: "",
      toolRegistry: registry,
    });

    expect(seen.map((ctx) => ctx.callId)).toEqual(["a", "b"]);
    expect(seen[0]!.ledger).toBe(seen[1]!.ledger);
    expect(seen[0]!.session).toBe(session);
    expect(seen[0]!.actor).toMatchObject({ kind: "assistant", sessionId: "s1", model: "test" });
    expect(seen[0]!.actor.id).toBe(`assistant:s1:${seen[0]!.actor.turnId}`);
    // The turn's ledger is what the transcript's summary shows.
    const request = chatState.messages.find((m) => m.toolCalls?.length)!;
    expect(writesForTurn(request.id).map((w) => w.path)).toEqual(["/a.json", "/b.json"]);
  });

  /* T1: the call's signal aborts with the turn while the call runs, and is unlinked once it has
     settled, so a Stop later in the turn reaches nothing that already finished. */
  test("a call's signal aborts with the turn while it runs, and not after it settles", async () => {
    const turn = new AbortController();
    let during: AbortSignal | undefined;
    const { registry, seen } = probeRegistry(async (ctx) => {
      if (ctx.callId === "b") {
        during = ctx.signal;
        turn.abort();
      }
    });
    const chatState = createChatState({ model: "test" });
    chatState.sendMessage("probe");
    await runAgentLoop({
      chatState,
      signal: turn.signal,
      streamingClient: fakeClient([calls("a"), calls("b")]),
      systemPrompt: "",
      toolRegistry: registry,
    });

    const [first, second] = seen;
    expect(during).toBe(second!.signal);
    expect(second!.signal.aborted).toBe(true);
    // The first call had settled before the Stop; its signal was unlinked.
    expect(first!.signal.aborted).toBe(false);
    expect(first!.signal).not.toBe(turn.signal);
  });

  /* An import reports a line at a time; the chip draws the run keyed by the call's id. */
  test("a call's progress reaches the run the host keys by its id", async () => {
    const { registry } = probeRegistry((ctx) => {
      beginImportRun(ctx.callId, { directory: "/sites/x", url: "https://example.com" });
      ctx.progress({ message: "Crawling…", phase: "crawl" });
    });
    const chatState = createChatState({ model: "test" });
    chatState.sendMessage("import");
    await runAgentLoop({
      chatState,
      streamingClient: fakeClient([calls("imp")]),
      systemPrompt: "",
      toolRegistry: registry,
    });
    expect(importRun("imp")?.message).toBe("Crawling…");
  });

  test("without a turn signal a call's signal never aborts", async () => {
    const { registry, seen } = probeRegistry();
    const chatState = createChatState({ model: "test" });
    chatState.sendMessage("probe");
    await runAgentLoop({
      chatState,
      streamingClient: fakeClient([calls("a")]),
      systemPrompt: "",
      toolRegistry: registry,
    });
    expect(seen[0]!.signal.aborted).toBe(false);
  });
});

/* T3: a registry that wraps another forwards the call's context unchanged, so the leaf tool gets
   the loop's signal, id, ledger and session rather than a detached context of its own. */
describe("the context reaches the leaf through the composite", () => {
  test("gated, then composed with the command tools", async () => {
    const { registry, seen } = probeRegistry();
    const gated = createGatedToolRegistry(registry, new Map());
    const composite = composeToolRegistries(
      gated,
      createCommandToolRegistry({ getTab: () => null, validate: async () => [] }),
    );
    const ctx = createToolContext({ callId: "call_9" });
    const result = await composite.execute("probe", {}, ctx);
    expect(result.success).toBe(true);
    expect(seen[0]).toBe(ctx);
    expect(ctx.ledger.writes.map((w) => w.path)).toEqual(["/call_9.json"]);
  });
});
