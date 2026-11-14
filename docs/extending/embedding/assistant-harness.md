---
title: "Writing assistant tools"
description: "How an assistant tool receives its call context, how a host runs a turn with the Jx harness, and the neutral conversation it keeps and sends."
spec:
  - ai.md#3.7 # a tool call carries its context
  - ai.md#2.3 # the neutral conversation model
  - ai.md#3.8 # the turn engine
  - ai.md#3.9 # portable document tools
  - ai.md#3.10 # catalog membership
  - ai.md#3.11 # interactions and approvals run before the tool body
  - ai.md#2.7 # wire version 2 and provider adapters
  - ai.md#3.12 # a suspended turn resumes from a checkpoint
  - ai.md#3.13 # a persisted conversation
  - ai.md#3.14 # project tools over a ProjectHost
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
  - packages/ai/src/harness/checkpoint.ts
  - packages/ai/src/messages/digest.ts
  - packages/ai/src/messages/persist.ts
  - packages/ai/src/sessions.ts
  - packages/ai/src/testing/memory-host.ts
  - packages/ai/src/testing/scripted-model.ts
  - packages/ai/src/jx-tools/index.ts
  - packages/ai/src/jx-tools/doc-tools.ts
  - packages/ai/src/jx-tools/entries.ts
  - packages/ai/src/jx-tools/facts.ts
  - packages/ai/src/providers/index.ts
  - packages/ai/src/providers/openai-compat.ts
  - packages/ai/src/providers/body.ts
  - packages/ai/src/catalog/index.ts
  - packages/ai/src/catalog/catalog.ts
  - packages/ai/src/catalog/mcp.ts
  - packages/ai/src/catalog/validator.ts
  - packages/ai/src/jx-tools/project.ts
  - packages/studio/src/services/tool-executor.ts
  - packages/studio/src/services/harness/studio-documents.ts
  - packages/studio/src/services/harness/assistant-tools.ts
  - packages/studio/src/services/harness/interaction-store.ts
  - packages/studio/src/services/ai-ask.ts
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

`runTurn` from `@jxsuite/ai/harness` runs one user turn to its end: it streams a round from the model, runs the tool calls the model made, feeds their results back, and repeats until the model stops calling tools or the turn runs out of work rounds. It is the loop Studio's own assistant runs, so a turn you run is held to the same rules: a stopped round runs nothing, a turn that runs out of rounds gets one last round to reply, and one that changed something but gave no reply ends on a message saying what it changed, and a reply with neither text nor a tool call is reported rather than left blank.

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

`fromStreamingClient` sends each round as the version 1 chat body. When the backend's models probe lists wire version 2, build the client with `wire: negotiateWire(probe)`: it then offers `streamTurn`, `fromStreamingClient` uses it, and each round carries the neutral conversation itself rather than its OpenAI projection. If the backend refuses version 2 after all, the client sends that round again as version 1 and stays on version 1.

A host with no backend in between, such as a headless run or an eval, reaches a provider directly with an adapter from `@jxsuite/ai/providers`:

```ts
import { createOpenAICompatProvider, providerModel } from "@jxsuite/ai/providers";

const provider = createOpenAICompatProvider({ baseUrl, apiKey });
const turn = runTurn({ history, system, tools, model: providerModel(provider, "gpt-4.1") });
```

`createAnthropicProvider({ apiKey })` is the same for Claude, over the Anthropic Messages API. It replays a signed thinking block only while the request it was produced under still matches, so keep the system prompt and the tool list fixed across a conversation if you want Claude's earlier thinking carried forward. Mark the part of your system prompt that never changes with `cache: true` on its block, and the provider puts a cache breakpoint there.

The OpenAI-compatible adapter sends the same request body the direct OpenAI client sends and reads the answer with the same normalizer a backend runs, so the frames are the same however the provider is reached. `provider.capabilities(model)` says what the family asks of a request: whether the system prompt may change between rounds, whether the tool list may, and whether a token ceiling is required.

Every step of the turn reaches `onEvent` as it happens, in order: the round starting, each piece of text, each tool call and its result, and finally `turn_end`. When a provider signs its thinking, a `reasoning_block` event carries each signed block just before the round ends. If you keep your own transcript, store that block on the round's message (chat-state's `appendReasoningBlock` does), because the reasoning's text alone cannot be replayed. Apply them to your own transcript there, or iterate the run (`for await (const event of turn)`) to read them later; every reader sees the whole turn. The outcome says how the turn ended (`complete`, `cap_partial`, `cap_failed`, `error`, `cancelled` or `empty`), which message to show the turn's changes under, and every message the turn added.

`policy` bounds the turn: `maxWorkRounds` (30), `maxRounds` (60) and `maxIdenticalRounds` (3, the same calls with the same results). At any of them the turn runs one closing round, in which the model is told to reply and any tool call it makes is ignored, so a turn that spent its budget reading still answers. The note that tells it arrives as `request.closing`, and is already the last of `request.messages`. If your model function builds its request from your own transcript rather than from `request.messages`, add it yourself, and do not save it. Set `parallelReadOnly: true` to run neighbouring tools with `readOnlyHint` at once; their results still arrive in call order.

The engine does not watch the size of a request, because only you know your model's window. A host that allows many rounds should shrink old tool results before a request outgrows it, as Studio does.

To keep two turns from running at once, pass the same `createTurnLock()` to each: a turn started while another holds the lock throws `LaneBusyError` straight away, before it sends anything.

A host that keys something on the turn's actor before the turn starts, as Studio keys each turn's undo batch, builds the id with `assistantActorId(sessionId, turnId)`. It is the `id` every call's `ctx.actor` will carry, so the key the host opened and the actor its tools name cannot drift apart.

:::doc-note
A turn stopped between two tool calls never runs the second one, so the messages it appended end with a call that has no reply, and providers refuse a request like that. You do not have to fix it yourself: the next turn answers each such call with a failed result before it sends anything, and reports a `transcript_repaired` event when it does. If you keep your own transcript, call `repairToolPairs` from `@jxsuite/ai/messages` on it to apply the same repair, as Studio does before every send.
:::

## Asking a person

A tool that puts a question to a person never waits on them in its own code. It declares the question it asks, as `interaction`, and what the answer means, as `settle`:

```ts
const pickLayout = createToolDefinition({
  name: "pick_layout",
  description: "Ask which layout the page should use.",
  parameters: { type: "object", properties: {} },
  interactive: true,
  interaction: () => ({
    kind: "question",
    question: "Which layout should the page use?",
    options: ["One column", "Two columns"],
    context: "",
  }),
  settle: (_args, response) =>
    response.kind === "question" && response.answer !== null
      ? { success: true, summary: `The user chose ${response.answer}.` }
      : { success: false, error: "The user did not answer." },
  execute: () => ({ success: false, error: "pick_layout needs a person." }),
});
```

When the model calls it, the turn asks your host through the `interactions` strategy you pass to `runTurn`. With `{ mode: "inline", resolve }`, the turn calls `resolve(request, { callId, signal })` and waits on the answer you return, reporting `interaction_request` before and `interaction_settled` after. Resolve it when `signal` aborts too, because that is the turn being stopped: answer a question as unanswered and not skipped. Without a strategy, a tool that needs a person is answered as one nobody can reach, and the turn goes on.

Set `interactive: true` on such a tool, so a round that only asked does not count against the turn's work budget.

The same strategy carries approvals. Give the turn a policy as `policy.approval`, and every call is put to it before the tool runs: return `{ kind: "proceed" }`, `{ kind: "deny", message }` to refuse it with a sentence the model reads, or `{ kind: "confirm", reason, summary }` to ask the author first. A call the author declines never runs. The default policy, `proceedAlways`, approves everything.

## Suspending and resuming a turn

Waiting inside the turn only works while something keeps the turn alive. A Worker answering one request, or a headless run, cannot hold a turn open until a person replies. Give such a host the `suspend` strategy instead:

```ts
const first = runTurn({ history, system, model, tools, interactions: { mode: "suspend" } });
const outcome = await first.outcome;
if (outcome.kind === "suspended") {
  await store.save(conversationId, { history, checkpoint: outcome.checkpoint });
}
```

A call that needs a person now ends the turn with the outcome `suspended` and a checkpoint. Nothing of that call has run. The checkpoint is plain JSON: the messages the turn added, the calls of the round it stopped in, the request it is waiting on (`awaiting.request`), and what it had written. Store it in the same write as the conversation, and show the person the request.

When they answer, start the turn again with the checkpoint and the answer:

```ts
const resumed = runTurn({
  history, // the same conversation the first run was given
  system,
  model,
  tools,
  interactions: { mode: "suspend" },
  resume: { checkpoint, response: { kind: "approval", approved: true } },
});
```

The resumed turn settles the waiting call with the answer, runs the calls after it, and carries on. No call that already ran is run again, so a turn suspended and resumed leaves the document an uninterrupted turn would. A turn can suspend more than once: each call that needs a person stops it again.

A resume must run with the same tools, policy and system prompt as the turn it continues. If any of them changed, the turn ends at once with an `error` outcome whose code is `resume_refused`, before it runs or sends anything. `checkResume(checkpoint, input)` answers the same question without starting a turn.

A provider failure worth waiting out can suspend a turn too. List its error codes in `policy.suspendOn`, for example a lapsed credential or a rate limit, and a round that fails with one ends the turn `suspended` between rounds. Resume it with `response: null` once the provider will answer.

To test a host of your own, `@jxsuite/ai/testing` has `scriptedModel(rounds)`, a model function that answers each round with the frames you script, and `createMemoryHarnessHost(document)`, an in-memory document the tree tools read and write.

## Keeping conversations

`@jxsuite/ai/sessions` defines `SessionStore`, the contract for wherever a host keeps its conversations: `list`, `load`, `save`, `create`, `remove`, `move`, `getActive` and `setActive`, each per root (a project path, or `""` for none) and each asynchronous. `createMemorySessionStore()` is a store that keeps everything in memory, for a headless run or a test. Studio's own store keeps conversations in the browser's localStorage behind the same contract.

Three helpers from `@jxsuite/ai/messages` do the parts every store shares:

- `migrateTranscript(raw, { newId, now })` reads a stored conversation as the current message shape, whatever version of Studio wrote it, or answers `null` when the value is not a conversation. Run it on every read. It gives an id to a message stored without one, so save what it returns.
- `persistWindow(messages, max)` is the part of a conversation to save: its last `max` messages, starting at the first one a person wrote.
- `sessionTitle(text)` titles a conversation from the first thing a person wrote in it.

`save` answers a `SaveResult` rather than throwing. `{ ok: false, reason }` says why nothing was written: `quota` (the store is full), `unavailable` (there is no store), or `not_in_index` (the conversation was deleted, so it is deliberately not written back). Show the first two to the person. A store whose writes can overlap should run them through `createWriteQueue()`, which keeps them in the order they were asked for, so a save still in flight cannot land after the delete that followed it.

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

### Checking arguments against the whole schema

A registry checks that required arguments are present and that each has the right primitive type. A tool's schema usually says more: an `enum`, a `pattern`, the shape of a nested object. To have those checked too, give the catalog a JSON Schema validator as the view's `validator`:

```ts
import Ajv2020 from "ajv/dist/2020";
import { cachedValidator, catalogRegistry } from "@jxsuite/ai/catalog";

const ajv = new Ajv2020({ coerceTypes: true, strict: false });
const validator = cachedValidator((schema) => {
  const check = ajv.compile(schema);
  return (input) =>
    check(structuredClone(input))
      ? { valid: true, data: input }
      : { valid: false, errorMessage: ajv.errorsText(check.errors) };
});
const registry = catalogRegistry(catalog, { validator });
```

The catalog asks it about a call only after the registry's own check has passed, and answers a call it refuses with `Validation failed:` and your sentence, without running the tool. The validator is yours to supply because `@jxsuite/ai` runs in a Worker, where a schema validator is too much to carry. Its shape is the one the Model Context Protocol SDK asks a host for, so one validator serves both. If you coerce types, as the example does, validate a copy, so the tool still receives what the model sent.

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

## Project file tools on your own host

`projectToolEntries(host)` from `@jxsuite/ai/jx-tools` builds `list_files`, `read_file`, `write_file` and `search_files`, the tools Studio's assistant reads and writes a project's files with. What the model is told about them, the size caps on their answers, and the check that keeps every path inside the project come with them. You supply a `ProjectHost`, which says where the files are:

```ts
import { projectToolEntries } from "@jxsuite/ai/jx-tools";

const host = {
  list: (dir) => readDirectory(dir), // [{ name, path, type, size? }]
  read: (path) => readText(path),
  write: (path, text) => writeText(path, text),
  search: (query, extensions) => findByName(query, extensions), // [{ path }]
};
const tools = projectToolEntries(host);
```

Every path the host is given is project-relative and has already been checked: an absolute path, a `..` segment, a drive letter or a home directory is refused before your host is asked anything. Enforce containment in the host as well. Reject with an `Error` whose message the model can act on when something cannot be read or written.

A disk has no undo, so decide before a file is replaced whether it may be. Add `beforeWrite(path, text)` to the host: answer `{ ok: false, error }` to refuse with a sentence the model reads, or `{ ok: true }` to allow. An allowed write may carry `hints` (advice appended to the tool's answer) and an `afterWrite` function that runs once the file is on disk. Studio's host uses it to validate a Jx document before writing and to reload an open editor afterwards.
