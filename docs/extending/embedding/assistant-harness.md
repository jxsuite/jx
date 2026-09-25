---
title: "Writing assistant tools"
description: "How an assistant tool receives its call context (signal, call id, write ledger, session facts) and how a host builds one and passes it through registries."
spec:
  - ai.md#3.7 # a tool call carries its context
code:
  - packages/ai/src/tools.ts
  - packages/ai/src/core-types.ts
  - packages/studio/src/services/tool-executor.ts
---

# Writing assistant tools

An assistant tool is a `ToolDefinition` from `@jxsuite/ai/tools`: a name, a description, a JSON Schema for its arguments, and an `execute` function. The Jx harness calls `execute` with the arguments the model sent and a second argument, the call's `ToolContext`. Everything a tool needs to know about the call it serves comes from that context rather than from module state, which is what lets the same tool run in a Studio window, a Worker or an MCP server.

## The context

| Field      | What it is                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `signal`   | The call's own `AbortSignal`. It aborts when the turn is stopped, and is unlinked once the call has settled. |
| `callId`   | The provider's id for this call. It is also the id of the chip the transcript draws for it.                  |
| `actor`    | Who the call acts for: the assistant, in a given session and turn.                                           |
| `ledger`   | Where the call records what it changed. Every call in a turn shares the turn's ledger.                       |
| `session`  | JSON facts the conversation keeps across its turns, such as an import having already run.                    |
| `progress` | A sink for progress on a long call, such as an import's log lines. It does nothing when nobody is listening. |

A tool that writes records each change on the ledger, with whether it went to disk, because that is what the transcript's "Changed N files" summary and **Restore to here** are built from:

```ts
import { createToolDefinition } from "@jxsuite/ai/tools";

const renamePage = createToolDefinition({
  name: "rename_page",
  description: "Rename a page file.",
  parameters: {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" } },
    required: ["from", "to"],
  },
  async execute(args, ctx) {
    const { from, to } = args as { from: string; to: string };
    await files.rename(from, to, { signal: ctx.signal });
    ctx.ledger.record({ disk: true, ok: true, path: to, tool: "rename_page" });
    return { success: true, summary: `Renamed ${from} to ${to}.` };
  },
});
```

Anything else the tool depends on, such as a file store, the function that opens a project, or the brief a form filled in, is bound when you build the tool, as in `files` above. The context carries only per-call facts.

A tool that suspends the turn on a person rather than doing work, such as `ask_user`, sets `interactive: true` on its definition. A round whose calls were all interactive does not count against the turn's work budget.

## Hosting the loop

A host gives each call its own context. `createToolContext` fills in whatever you leave out with a detached default: a signal that never aborts, an empty call id, a fresh ledger and empty session facts. That is also what a tool gets when you call `registry.execute(name, args)` with no context, so a tool run from a command or a test records into nobody's turn.

To make a call stoppable, link its signal to the turn's with `linkCallSignal` and release the link once the call settles, so a Stop later in the turn reaches nothing that has already finished:

```ts
import { createToolContext, linkCallSignal } from "@jxsuite/ai/tools";

const link = linkCallSignal(turnSignal);
try {
  const ctx = createToolContext({ callId, ledger, session, signal: link.signal });
  result = await registry.execute(name, args, ctx);
} finally {
  link.release();
}
```

Create one ledger per turn with `createLedger`, and one set of session facts per conversation with `createSessionFacts`. Studio files the turn's ledger under the message the turn drew when the turn ends.

:::doc-note
If you write a registry that wraps another, for example to gate tools on application state, forward the context unchanged: `execute(name, args, ctx)` must call `inner.execute(name, args, ctx)`. A wrapper that drops it hands the tool a detached context, and the tool's writes and its Stop go nowhere.
:::
