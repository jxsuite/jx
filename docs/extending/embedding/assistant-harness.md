---
title: "Writing assistant tools"
description: "How an assistant tool receives its call context, how a host passes it through registries, and the neutral conversation a host keeps and sends."
spec:
  - ai.md#3.7 # a tool call carries its context
  - ai.md#2.3 # the neutral conversation model
code:
  - packages/ai/src/tools.ts
  - packages/ai/src/core-types.ts
  - packages/ai/src/messages/index.ts
  - packages/ai/src/messages/convert.ts
  - packages/ai/src/messages/openai.ts
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

## The conversation

A host keeps the conversation in `@jxsuite/ai/messages`' neutral shape rather than in one provider's words. A `ChatMessage` is a role and a list of blocks: `text`, `reasoning` (a thinking model's chain of thought, with any signature the provider needs back), `tool_call` (with its arguments exactly as streamed), `tool_result`, and `opaque` provider data. Its `meta` records facts about the message, such as which model wrote it, and is never sent to a provider.

Chat-state and Studio's saved sessions hold the older single-shape message, `LiveMessage`, with `content`, `reasoningContent` and `toolCalls` fields. Convert between the two with `toChatMessages` and `toLiveMessages`. The conversion keeps every field a message's role uses except a tool call's `result`, which is a copy of what the call's `tool` reply already says, so rebuild it from the reply if you render it. A field holding the wrong type, as a damaged saved session can, is read as absent rather than sent.

To send the conversation to an OpenAI-compatible provider, project it with `toOpenAIMessages`. It is the function Studio's own requests are built with, so it already leaves out the empty assistant turn a reply starts as, and sends a thinking model's reasoning back only when an OpenAI-compatible provider produced it:

```ts
import {
  toChatMessages,
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAITools,
} from "@jxsuite/ai/messages";

const body = {
  messages: toOpenAIMessages(toChatMessages(chatState.messages)),
  tools: toOpenAITools(fromOpenAITools(registry.listForLLM())),
};
```

`fromOpenAITools` reads a registry's tool list into neutral `ToolSpec`s, and `toOpenAITools` writes them back byte for byte, so a host can keep its tools in the neutral form without changing what an OpenAI-compatible provider receives. Like the rest of the module, both run in a Worker as well as in a page.
