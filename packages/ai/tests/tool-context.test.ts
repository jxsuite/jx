/**
 * Tests for the tool-call context in @jxsuite/ai/tools: `createLedger`, `createSessionFacts`,
 * `createToolContext`, `linkCallSignal`, and the registry handing each call its context
 * (specs/ai.md §3.7).
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import {
  createLedger,
  createSessionFacts,
  createToolContext,
  createToolDefinition,
  createToolRegistry,
  linkCallSignal,
} from "../src/tools.ts";
import type { AiWrite, ToolContext } from "../src/tools.ts";

const write = (path: string): AiWrite => ({ disk: false, ok: true, path, tool: "edit" });

describe("createLedger", () => {
  it("keeps every write in order and tells its observer of each", () => {
    const seen: string[] = [];
    const ledger = createLedger((w) => seen.push(w.path));
    ledger.record(write("a.json"));
    ledger.record(write("b.json"));
    expect(ledger.writes.map((w) => w.path)).toEqual(["a.json", "b.json"]);
    expect(seen).toEqual(["a.json", "b.json"]);
  });

  it("needs no observer", () => {
    const ledger = createLedger();
    ledger.record(write("a.json"));
    expect(ledger.writes).toHaveLength(1);
  });
});

describe("createSessionFacts", () => {
  it("starts empty and unnamed, and keeps what is set", () => {
    const facts = createSessionFacts();
    expect(facts.sessionId).toBeNull();
    expect(facts.get("import.done")).toBeUndefined();
    facts.set("import.done", true);
    expect(facts.get("import.done")).toBe(true);
    expect(facts.toJSON()).toEqual({ "import.done": true });
  });

  it("starts from a named session's facts, without sharing the object it was given", () => {
    const initial = { count: 2 };
    const facts = createSessionFacts("s1", initial);
    expect(facts.sessionId).toBe("s1");
    expect(facts.get("count")).toBe(2);
    facts.set("count", 3);
    expect(initial.count).toBe(2);
  });
});

describe("createToolContext", () => {
  it("is detached by default: never stopped, no id, a fresh ledger, empty facts", () => {
    const ctx = createToolContext();
    expect(ctx.signal.aborted).toBe(false);
    expect(ctx.callId).toBe("");
    expect(ctx.ledger.writes).toEqual([]);
    expect(ctx.session.sessionId).toBeNull();
    expect(ctx.actor).toEqual({
      id: "assistant:local:",
      kind: "assistant",
      sessionId: null,
      turnId: "",
    });
    expect(() => ctx.progress({ phase: "x" })).not.toThrow();
  });

  it("names its actor after the session it was given", () => {
    const ctx = createToolContext({ session: createSessionFacts("s9") });
    expect(ctx.actor.id).toBe("assistant:s9:");
    expect(ctx.actor.sessionId).toBe("s9");
  });

  it("keeps every field it was given", () => {
    const controller = new AbortController();
    const ledger = createLedger();
    const events: unknown[] = [];
    const actor = { id: "a", kind: "assistant" as const, sessionId: null, turnId: "t" };
    const ctx = createToolContext({
      actor,
      callId: "call_7",
      ledger,
      progress: (e) => events.push(e),
      signal: controller.signal,
    });
    expect(ctx.signal).toBe(controller.signal);
    expect(ctx.callId).toBe("call_7");
    expect(ctx.ledger).toBe(ledger);
    expect(ctx.actor).toBe(actor);
    ctx.progress("tick");
    expect(events).toEqual(["tick"]);
  });

  it("gives every detached call its own ledger", () => {
    const a = createToolContext();
    const b = createToolContext();
    a.ledger.record(write("a.json"));
    expect(b.ledger.writes).toEqual([]);
  });
});

describe("linkCallSignal", () => {
  it("aborts the call when its turn aborts, with the turn's reason", () => {
    const turn = new AbortController();
    const { signal } = linkCallSignal(turn.signal);
    expect(signal.aborted).toBe(false);
    turn.abort("stopped");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("stopped");
  });

  /* A call that has settled must not hear a Stop meant for whatever the turn does next (F1, D10). */
  it("reaches the call no more once it is released", () => {
    const turn = new AbortController();
    const link = linkCallSignal(turn.signal);
    link.release();
    turn.abort();
    expect(link.signal.aborted).toBe(false);
  });

  it("a turn already stopped gives a call already stopped", () => {
    const turn = new AbortController();
    turn.abort("gone");
    const link = linkCallSignal(turn.signal);
    expect(link.signal.aborted).toBe(true);
    expect(link.signal.reason).toBe("gone");
    expect(() => link.release()).not.toThrow();
  });
});

describe("the registry hands each call its context", () => {
  function recordingRegistry() {
    const seen: ToolContext[] = [];
    const registry = createToolRegistry();
    registry.register(
      createToolDefinition({
        description: "records its context",
        execute: (_args, ctx) => {
          seen.push(ctx);
          ctx.ledger.record(write("x.json"));
          return { success: true };
        },
        name: "probe",
        parameters: { properties: {}, type: "object" },
      }),
    );
    return { registry, seen };
  }

  it("passes the call's own context to the tool", async () => {
    const { registry, seen } = recordingRegistry();
    const ctx = createToolContext({ callId: "call_1" });
    await registry.execute("probe", {}, ctx);
    expect(seen[0]).toBe(ctx);
    expect(ctx.ledger.writes.map((w) => w.path)).toEqual(["x.json"]);
  });

  it("gives a call made without one a detached context", async () => {
    const { registry, seen } = recordingRegistry();
    await registry.execute("probe", {});
    expect(seen[0]!.callId).toBe("");
    expect(seen[0]!.signal.aborted).toBe(false);
  });
});

describe("createToolDefinition", () => {
  it("carries interactive only when it was given", () => {
    const base = {
      description: "d",
      execute: () => ({ success: true }),
      name: "t",
      parameters: { type: "object" },
    };
    expect(createToolDefinition({ ...base, interactive: true }).interactive).toBe(true);
    expect("interactive" in createToolDefinition(base)).toBe(false);
  });
});
