# @jxsuite/ai

The provider-agnostic substrate Jx Studio's assistant is built on: a streaming LLM client abstraction that normalizes provider SSE into eight event shapes, a tool registry that speaks OpenAI function-calling, and a reactive chat store. It has no Jx-domain dependencies beyond `@jxsuite/protocol`, for the wire's problem documents (the gateway builds them at runtime; everything else imports only the `ProblemDetails` type), plus `@vue/reactivity` for the chat store. Its platform APIs are the web-standard ones (`fetch`, `Request` and `Response`, streams, `TextEncoder` and `TextDecoder`, `AbortSignal`), so the same modules run in the browser, in Bun/Node and, for the Worker-safe subpaths, in a Cloudflare Worker.

Governing spec: [`specs/ai.md`](../../specs/ai.md) §1-§2 (Status: Partial). User-facing documentation for the Studio feature lives at [`docs/studio/ai.md`](../../docs/studio/ai.md).

| Entrypoint                     | Exports                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jxsuite/ai`                  | Barrel: the three factories, `createToolDefinition`, `createToolRegistry`, `createChatState`, the `ChatUsage` type, `STREAM_EVENT_TYPES`, and the streaming types                                                   |
| `@jxsuite/ai/streaming-client` | `StreamingClient`, `StreamEvent` and its eight members, the three factories and their option types, `STREAM_EVENT_TYPES`, `usageEventFromOpenAI` and its `OpenAIUsage` input type                                   |
| `@jxsuite/ai/tools`            | `createToolDefinition`, `createToolRegistry`, `toolSuccess`, `toolError`, the call context (`createToolContext`, `createLedger`, `createSessionFacts`, `linkCallSignal`), and their types                           |
| `@jxsuite/ai/chat-state`       | `createChatState`, `ChatStore`, `ChatUsage`, `Message`, `ToolCallRecord`, `ChatState`, `MessageRole`                                                                                                                |
| `@jxsuite/ai/gateway`          | `createChatHandler`, `modelsResponse`, `normalizeOpenAIStream`, `encodeSse`, `problemResponse`, `extractUpstreamErrorMessage`, and the `Upstream`, `GatewayRefusal`, `ChatAdmission` and `ChatGatewayOptions` types |

`toolSuccess` / `toolError` are **not** re-exported by the barrel. Import them from `@jxsuite/ai/tools`. Importing the subpaths instead of the root is also what makes the package tree-shakeable.

## The streaming client

`StreamingClient` is one method:

```ts
streamChat(messages: object[], tools: object[], systemPrompt: string, signal: AbortSignal)
  : AsyncGenerator<StreamEvent>;
```

Every implementation yields the same discriminated union, whose type strings are also published as `STREAM_EVENT_TYPES`: `delta {content}`, `reasoning {content}`, `tool_call_start {id, name}`, `tool_call_delta {id, args}`, `tool_call_end {id}`, `usage {inputTokens, outputTokens, cachedInputTokens?, reasoningTokens?}`, `done {stopReason}`, `error {message, code?, problem?}`. This union is the contract a third-party Studio backend must satisfy for the `ai/chat` route (see [`packages/protocol/README.md`](../protocol/README.md)); `@jxsuite/server` emits the same format through [the gateway](#the-gateway). `StreamEvent` and each member are exported, so an implementer can import the type instead of reconstructing it.

```ts
import { createProxyStreamingClient } from "@jxsuite/ai";

const client = createProxyStreamingClient({
  chatUrl: "/__studio/ai/chat",
  model: "gpt-4o",
});
for await (const event of client.streamChat(messages, tools, systemPrompt, signal)) {
  switch (event.type) {
    /* … */
  }
}
```

- **`createOpenAIStreamingClient({ baseUrl, apiKey, model = "gpt-4o", temperature })`** POSTs to `${baseUrl}/chat/completions` with `Authorization: Bearer`, `stream: true`, `stream_options: { include_usage: true }`, and `{ role: "system", content: systemPrompt }` prepended to your messages. A non-empty `tools` array also sets `tool_choice: "auto"` and `parallel_tool_calls: true`; an empty one sends no `tools` key. `temperature` is forwarded **only when defined**, because reasoning models (GPT-5.x, o-series) reject a custom temperature. That is a provider behaviour recorded in the source comment, not covered by a test here. It does its own SSE framing and reassembles fragmented tool-call argument JSON keyed by the provider's `delta.tool_calls[].index`.
- **`createAnthropicStreamingClient({ baseUrl, apiKey })`** is a stub. It makes no network call and yields exactly one `error` event with `code: "NOT_IMPLEMENTED"`. Only the OpenAI-compatible path ships (`specs/ai.md` §2).
- **`createProxyStreamingClient({ chatUrl, model = "gpt-4o", apiKey, baseUrl })`** POSTs `{ messages, tools, systemPrompt, model }` to an endpoint that already speaks the normalized format (the dev/desktop server's `/__studio/ai/chat`). `chatUrl` may also be a function returning the URL (or a promise of it): it is called once, inside the first stream, so a caller can arm its turn's signal before waiting on a lookup, and a stream stopped by the time it answers ends `cancelled` without sending anything; a lookup that rejects rejects the stream. It handles no credentials of its own; `apiKey` and `baseUrl` are passed through as the `X-Api-Key` and `X-Api-Base-URL` headers only when truthy, and the proxy owns the provider key. It is a pass-through, **not** a translator: it re-yields whatever parses out of each `data:` line and returns at the first `done` or `error`, so frames after `done` are dropped.

Three behaviours are easy to get wrong when consuming the stream:

1. **Cancellation is a `done`, not an `error`.** An `AbortError` from `fetch` or mid-read becomes `{ type: "done", stopReason: "cancelled" }`. Treating abort as failure paints a user's Stop button as a crash. The OpenAI client's other stop reasons are `"stop"`, `"tool_calls"` and `"length"`.
2. **A finish is remembered, not acted on.** A `finish_reason` of `stop`, `length` or `tool_calls` emits `tool_call_end` for every call still open and records the reason (any other value is ignored), but the stream keeps reading, because with `include_usage` the count arrives in a chunk of its own after the finish. The stream ends at `[DONE]` or when the body closes, and ends the same way every time: `tool_call_end` for anything still open, one `usage` frame when the provider reported a count, then exactly one `done` carrying the recorded reason (`stop` when there was none). `usage` precedes `done` because a reader stops at `done`. The proxy client tracks nothing of its own, so a body that closes without a `done` frame ends its generator with no `done` at all.
3. **`error` frames may carry an RFC 9457 `problem` beside the human `message`,** because the response has already begun with a 200 and the status can no longer change (a committed standards row in `specs/ai.md` §5). The field is optional and no client in this package sets it. The gateway (which `@jxsuite/server`'s proxy runs) is what populates it, and `createProxyStreamingClient` passes it through. Read `problem.type` for machine dispatch when it is present; keep showing `message`.

## The gateway

`@jxsuite/ai/gateway` is the other side of the wire: the server half of the `ai/chat` and `ai/models` routes, which `@jxsuite/server` runs and any other backend can. The host supplies its policy and the gateway does the rest:

```ts
import { createChatHandler, modelsResponse } from "@jxsuite/ai/gateway";

const chat = createChatHandler<{ signal: AbortSignal }>({
  // Whose key, which base URL: the host's rules. Return a refusal to answer with a problem instead.
  resolveUpstream: () => ({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    family: "openai-compat",
    managed: false,
  }),
  maxBodyBytes: 1_000_000,
  maxMessages: 200,
});

const response = await chat(request, { signal: request.signal });
const models = modelsResponse({ configured: true, models: [{ id: "gpt-4o" }] });
```

- **The order is fixed.** `admit` (before the body is read), `resolveUpstream`, the body (`413` once it passes `maxBodyBytes`, counted on the bytes actually read, and `400` when it is not JSON), `messages` (`400` when it is present and not an array), `maxMessages` (`413`), `onAccepted`, then the stream. The first step that refuses answers the request as `application/problem+json`, and the provider is never contacted. `problemResponse` writes `error` beside `detail` and a refusal's `code` beside both, so a problem reader and an older `{error, code}` reader both understand it.
- **The stream is always a `200`.** The upstream request is on the wire before the response is returned, and anything that goes wrong after that (a network failure, a provider's non-2xx, a reset mid-stream) is an `error` frame, while an abort is `done: cancelled`. `normalizeOpenAIStream` is the server's normalizer, moved here unchanged, so its frames are the ones `packages/server/tests/fixtures/ai-upstream/*.server.json` records.
- **`fetch` is looked up per request** unless you pass one, so a host (or a test) can swap it.
- **`modelsResponse(body)` is always a `200`,** because the models route is a capability probe. What the catalogue says is the host's business.

`./gateway` is Worker-safe. Studio never imports it (`packages/studio/tests/ai-import-rules.test.ts`).

## The tool registry

`createToolRegistry()` returns `{ register, list, listForLLM, validate, execute, getDefinition }`. `listForLLM()` emits `{ type: "function", function: { name, description, parameters } }`, ready to hand straight to `streamChat`'s `tools` argument.

```ts
import { createToolDefinition, createToolRegistry, toolSuccess } from "@jxsuite/ai/tools";

const registry = createToolRegistry();
registry.register(
  createToolDefinition({
    name: "set_property",
    description: "Set a property on a node",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: (args) => toolSuccess(args, "set"),
  }),
);
```

- **`strict` and `llmStrict` are unrelated despite the names.** `strict` (default `true`) drives the registry's own argument validation. `llmStrict` (default `false`) is the only one that reaches the wire, adding OpenAI's `strict: true` to the emitted function schema. OpenAI strict mode demands `additionalProperties: false` and every property in `required`, which Jx's own tools deliberately violate, so GPT-5.x rejects such a request outright (again, committed rationale and no test).
- **`validate()` is a lightweight structural check, not a JSON Schema validator.** It reads only `type`, `properties` and `required`: nested schemas, `enum`, `pattern`, `minimum` and every other keyword are ignored. Unknown properties are ignored too (the model may send extra); a required key that is present but `null`/`undefined` counts as missing; numeric strings coerce, so `"42"` validates against `number`. `strict: false`, or a schema without `properties`, skips it entirely.
- **`execute()` never throws.** An unknown tool, a validation failure, and an exception inside the tool all return `{ success: false, error }`, which is what lets an agent loop feed the failure back to the model and self-correct. It calls `this.validate(...)`, so it is `this`-bound: do not destructure it off the registry.
- Re-registering a name `console.warn`s and overwrites.
- **Every call carries a `ToolContext`** as `execute`'s second argument: the call's own signal, its id, the actor, the turn's write ledger, the conversation's session facts and a progress sink (specs/ai.md §3.7). `registry.execute(name, args, ctx)` passes it on; without a `ctx` the call gets `createToolContext()`, a detached one whose signal never aborts and whose ledger nothing files. `linkCallSignal(turnSignal)` gives a call a signal that aborts with the turn and is unlinked by `release()` once the call settles. A definition marks `interactive: true` when its call suspends the turn on a person (`ask_user`). A wrapping registry must forward `ctx`. See `docs/extending/embedding/assistant-harness.md`.

To vary the tool set per turn, wrap rather than mutate. Studio's `createGatedToolRegistry` returns a `ToolRegistry` that filters `list()`/`listForLLM()` through per-tool predicates (`packages/studio/src/services/gated-registry.ts`).

## The reactive chat store

`createChatState(options?: { model?: string })` returns a `@vue/reactivity` `reactive()` store with its mutators `Object.assign`ed onto the same proxy, so the returned value is both the state and the API. The store holds `messages`, `status`, `streamingContent`, `pendingToolCalls`, `error`, `model`, `tokenCount`, `contextWarning` and `usage`. `recordUsage(event, { systemTokens? })` stores a `usage` frame as a `ChatUsage`: the counts, the context it leaves for the next request (input plus output, less reasoning the provider billed but never streamed), and the id and position of the last message it covers, so a budget can reuse it only while that message is still in place. It also sets `tokenCount` to that context figure. `clearUsage()` forgets it, and `clearChat()` does too. The model falls back to `"gpt-4o"` via `||`, so an empty string takes the default too. `status` is `"idle" | "streaming" | "error"`; `toMessagesArray()` serializes back to OpenAI wire shape (assistant `tool_calls`, `tool` messages with `tool_call_id`, everything else `{ role, content }`).

Two ordering rules inside `beginAssistantTurn` are load-bearing, and any reimplementation must keep them: `status` is set to `"streaming"` **before** the placeholder message is pushed (the push itself triggers effects, and a reader seeing `"idle"` renders the empty placeholder as a finished message), and the pushed object is immediately re-read back through the proxy (`store.messages.at(-1)`), because mutating the raw object would notify nothing. A regression test asserts that an `effect()` reading `messages.at(-1).content` re-runs on every `appendDelta`.

Further surprises:

- **`sendMessage(text)` produces two messages**, not one: the user message plus an empty assistant placeholder, and status flips to `"streaming"`. There is no way to append a bare user message with it. `beginAssistantTurn()` exists separately so an agent loop can open the next round after pushing tool results, with no new user message.
- **`sendMessage` / `beginAssistantTurn` are no-ops while streaming**; `appendDelta` / `appendToolCallStart` are no-ops while not streaming.
- **`setError` and `cancelStream` delete the partial streaming message**, because it may hold incomplete `tool_calls` that would poison history on the next send. That deletion is why `specs/ai.md` §3.2 forbids reporting an exhausted tool-call budget as an error: the error path destroys the only account of the edits that did land.
- **`appendToolCallEnd(id)` is an intentional no-op.** Arguments are already fully accumulated; the caller parses the JSON and executes the tool.
- Message ids come from a module-level counter (`msg_${Date.now()}_${n}`), not a UUID.

## Versioning

Published to npm as `@jxsuite/ai`, following the monorepo's release train. Like every published `@jxsuite` library, it ships TypeScript source: every `exports` subpath resolves to `./src/*.ts`, so a consumer must be able to compile TypeScript out of `node_modules`. Within the monorepo, `@jxsuite/studio` (the client subpaths) and `@jxsuite/server` (`./gateway`) depend on it via `workspace:^`. `@vue/reactivity` is pinned to an **exact** version, matching `@jxsuite/studio`, `@jxsuite/runtime` and `@jxsuite/compiler`: reactive proxies from one copy do not track in effects from another, and the failure is silent.
