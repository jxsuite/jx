---
title: "Writing assistant tools"
description: "How an assistant tool receives its call context, how a host runs a turn with the Jx harness, and the neutral conversation it keeps and sends."
spec:
  - ai.md#3.7 # a tool call carries its context
  - ai.md#2.3 # the neutral conversation model
  - ai.md#3.8 # the turn engine
  - ai.md#3.9 # portable document tools
  - ai.md#3.10 # catalog membership
code:
  - packages/ai/src/tools.ts
  - packages/ai/src/core-types.ts
  - packages/ai/src/messages/index.ts
  - packages/ai/src/messages/convert.ts
  - packages/ai/src/messages/openai.ts
  - packages/ai/src/messages/repair.ts
  - packages/ai/src/harness/index.ts
  - packages/ai/src/harness/run.ts
  - packages/ai/src/harness/lock.ts
  - packages/ai/src/harness/model.ts
  - packages/ai/src/harness/policy.ts
  - packages/ai/src/jx-tools/index.ts
  - packages/ai/src/jx-tools/doc-tools.ts
  - packages/ai/src/jx-tools/entries.ts
  - packages/ai/src/jx-tools/facts.ts
  - packages/ai/src/catalog/index.ts
  - packages/ai/src/catalog/catalog.ts
  - packages/ai/src/catalog/mcp.ts
  - packages/studio/src/services/tool-executor.ts
  - packages/studio/src/services/harness/studio-documents.ts
  - packages/studio/src/services/harness/assistant-tools.ts
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

## Running a turn

`runTurn` from `@jxsuite/ai/harness` runs one user turn to its end: it streams a round from the model, runs the tool calls the model made, feeds their results back, and repeats until the model stops calling tools or the turn runs out of work rounds. It is the loop Studio's own assistant runs, so a turn you run is held to the same rules: a stopped round runs nothing, a turn that changed something before running out of rounds ends on a message saying what it changed, and a reply with neither text nor a tool call is reported rather than left blank.

Give it the conversation so far, the system prompt, a model function and your tool registry. For an OpenAI-compatible backend, `fromStreamingClient` makes the model function from a streaming client:

```ts
import { createProxyStreamingClient } from "@jxsuite/ai";
import { fromStreamingClient, runTurn } from "@jxsuite/ai/harness";

const turn = runTurn({
  history, // ChatMessage[], ending with the user's message
  system: [{ text: systemPrompt }],
  model: fromStreamingClient(createProxyStreamingClient({ chatUrl })),
  tools: registry,
  signal, // abort it to stop the turn
  onEvent: (event) => render(event),
});
const outcome = await turn.outcome;
```

Every step of the turn reaches `onEvent` as it happens, in order: the round starting, each piece of text, each tool call and its result, and finally `turn_end`. Apply them to your own transcript there, or iterate the run (`for await (const event of turn)`) to read them later; every reader sees the whole turn. The outcome says how the turn ended (`complete`, `cap_partial`, `cap_failed`, `error`, `cancelled` or `empty`), which message to show the turn's changes under, and every message the turn added.

To keep two turns from running at once, pass the same `createTurnLock()` to each: a turn started while another holds the lock throws `LaneBusyError` straight away, before it sends anything.

A host that keys something on the turn's actor before the turn starts, as Studio keys each turn's undo batch, builds the id with `assistantActorId(sessionId, turnId)`. It is the `id` every call's `ctx.actor` will carry, so the key the host opened and the actor its tools name cannot drift apart.

:::doc-note
A turn stopped between two tool calls never runs the second one, so the messages it appended end with a call that has no reply, and providers refuse a request like that. You do not have to fix it yourself: the next turn answers each such call with a failed result before it sends anything, and reports a `transcript_repaired` event when it does. If you keep your own transcript, call `repairToolPairs` from `@jxsuite/ai/messages` on it to apply the same repair, as Studio does before every send.
:::

## Which tools the model sees

A host's tools are one catalog. `createCatalog` from `@jxsuite/ai/catalog` takes your tools in groups and keeps them in order, and it refuses to build when two tools share a name, a name is not 1 to 64 letters, digits, `_` or `-`, a tool's parameters are not an object schema, or a tool has no `title` or no `annotations`. The annotations are MCP's four behaviour hints, and every one is stated:

```ts
import { catalogRegistry, createCatalog } from "@jxsuite/ai/catalog";

const renamePage = createToolDefinition({
  name: "rename_page",
  title: "Rename a page",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  // description, parameters and execute as before
});

const tools = catalogRegistry(createCatalog([renamePage, ...fileTools]), {
  gate: (entry) => (entry.name === "rename_page" && !projectOpen() ? "an open project" : null),
});
```

`catalogRegistry` is the registry you hand to `runTurn`. Every member is listed by `list()`, but the model is offered only those your view admits. Return what a tool requires from `gate` and the tool is left out of the listing, and a call to it anyway is answered `Tool "rename_page" is not available right now — it requires an open project.` Use `advertise` instead to leave a tool out of the listing while still letting a call to it run. Both are asked every round, so a tool can become available in the middle of a turn. When your set of tools itself changes with your host's state, pass a function that builds the catalog, and it is read on every call.

The Jx assistant's own tools take their hints from `JX_TOOL_FACTS` in `@jxsuite/ai/jx-tools`, which also says where each tool's change lands: nowhere, in the view, in the open document, in the project's configuration, or on disk.

To serve a catalog over the Model Context Protocol, `toMcpTool(entry, { undoable })` gives a member in the shape MCP lists tools in, and `toCallToolResult(result)` gives a result in the shape MCP returns one.

## Document tools on your own host

The tools that edit a page's element tree (`read_document`, `set_property`, `add_child`, `set_style`, `set_text`, `add_state`, `update_state` and `move_node`) come from `@jxsuite/ai/jx-tools`, so a host outside Studio offers the model the same tools Studio does. Each one plans its edit as a list of document ops and writes nothing itself; your host applies the ops, which is how the same tool edits a Studio tab, a file on disk or a shared document.

Give `docToolEntries` a `DocumentHost` and a write reporter, then register what it returns:

```ts
import { applyDocOpsWithInverse } from "@jxsuite/schema/doc-ops";
import { docToolEntries } from "@jxsuite/ai/jx-tools";
import type { DocumentHost } from "@jxsuite/ai/jx-tools";

const ref = { id: "home", path: "pages/index.json" };
const host: DocumentHost = {
  undoable: "document",
  resolve: () => ref,
  snapshot: () => page,
  edit(_ref, produce) {
    const edit = produce(page);
    if (!edit.ok) {
      return { applied: false, reason: "refused", message: edit.error };
    }
    undoStack.push(applyDocOpsWithInverse(page, edit.ops));
    return { applied: true, changed: edit.ops.length > 0 };
  },
};

for (const tool of docToolEntries(host, { reporter })) {
  registry.register(tool);
}
```

`resolve` names the document a call edits, or returns a sentence for the model when there is none. `edit` must call `produce` and apply its ops in one synchronous step, so nothing can change the page between the plan and the write. The reporter's `before` and `after` bracket each write: `after` is where you validate the result and tell the model what the edit broke.

A call the tool refuses (a path that names no element, an index that is not a whole number, a node moved inside itself) is answered before your host is asked for anything, so a refusal never reaches your reporter, your undo stack or the ledger.

:::doc-note
Set `undoable` to `"none"` when your host cannot take an edit back, such as one writing straight to a file. Its writes are then recorded as disk writes, which the transcript reports as not undoable, and your `edit` should validate before it applies the ops, answering `{ applied: false, reason: "invalid", message }` for an edit it will not commit.
:::
