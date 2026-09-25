# `@jxsuite/ai` Specification

## AI Assistant for Jx Studio

**Version:** 0.1.15-draft\
**Status:** Partial\
**Updated:** 2026-09-18\
**License:** MIT

---

> **Status: Partial.** This is a stub spec for a shipped subsystem that grew ahead of its specification. It records the contract as implemented today; sections will be expanded as the subsystem stabilizes. The authoritative user documentation is [`docs/studio/ai.md`](../docs/studio/ai.md).

## 1. Overview

`@jxsuite/ai` is the assistant that edits a Jx project from natural-language instructions inside Studio. It generates and edits pages and components on the canvas while the user watches. It ships **no account and no hosted model**: the user connects their own provider, and Studio talks to it through the dev/desktop server's AI proxy (`/__studio/ai/*`, see `@jxsuite/server` §4). The package itself (`@jxsuite/ai`) is a provider-agnostic streaming tool-call client. It depends on `@jxsuite/protocol`, and through it on `@jxsuite/schema`, for the wire's problem documents; only its reactive chat store uses `@vue/reactivity`. Its leaves — `./streaming-client` and `./tools` — are **Worker-safe**: they import no `node:*`, no `@vue/reactivity` and no DOM, and `packages/ai/tests/worker-safety.test.ts` and the `typecheck:ai-worker` gate hold them to it, because the platform's Worker imports them. The root entry is not Worker-safe, since it re-exports the chat store.

## 2. Provider Contract

- The client speaks the **OpenAI chat-completions** wire format (streaming SSE, tool calls).
- A **user-supplied key and base URL** are required; the server proxy attaches them per request and never persists them. The proxy refuses to forward a server-environment key to a user-supplied base URL, and blocks cloud-metadata/link-local hosts (see `@jxsuite/server` §4.2).
- Local and self-hosted OpenAI-compatible endpoints (e.g. LM Studio, Ollama's OpenAI shim) are supported by pointing the base URL at them.
- **The count travels with the stream.** A backend that holds the provider's token count for the request **SHOULD** send it as one `usage` frame (`inputTokens`, `outputTokens`, optional `cachedInputTokens` and `reasoningTokens`) immediately before `done`, because a reader stops at `done`. It is additive: a backend with no figure sends none and a reader that predates it ignores it. The client uses it as the context's size and estimates only the messages added after it, so the budget stops being a guess at four characters per token wherever a provider reports. With OpenAI's `include_usage` the count arrives in a chunk of its own after the finish, so a backend **MUST** keep reading past `finish_reason` until `[DONE]` or the end of the body.
- **The calls decide whether tools run, not the finish reason.** A round whose stream carried tool calls executes them whichever finish the provider reported (`stop`, `length` or `tool_calls`), because some OpenAI-compatible providers (Workers AI among them) end a tool-calling turn with `stop`, and gating on `tool_calls` left those calls unrun. **Cancellation is the exception, and it is not a finish reason:** a round that ends `cancelled`, or whose signal is aborted, runs nothing it streamed, including calls whose arguments were already complete, and a Stop that lands between two calls stops the ones after it. A Stop that lands during a round's last call opens no further round: nothing is streamed on the stopped signal, and no reply is begun after it. **Stop is armed before the send path's first wait.** The turn's signal exists from the moment the send begins, and the chat URL (an IPC round trip on desktop) is resolved inside the first request, on that signal, so a Stop pressed before anything streams sends nothing and runs nothing. Stop is the one control that must not be outrun.
- A **managed** platform may broker credentials instead, so a user-supplied key is required only where nothing else supplies one (§2.1).
- Model **listing** is best-effort per endpoint: a BYOK provider is not required to serve one (Cloudflare Workers AI's OpenAI-compatible surface, for instance, has no `/models` route at all). The proxy answers `200` with a default catalogue and `upstreamError` set either way, so this failure **MUST** be distinguished from an authentication failure rather than surfaced as a silent success — `upstreamMessage` carries the upstream's own reason (e.g. "No route for that URI") so a client can show it instead of a bare status code, and chat itself is unaffected: it is a separate endpoint from `/models` and a provider that cannot list models may still serve completions.

### 2.1 Managed providers

> **Status: Implemented.** Jx Cloud brokers Cloudflare Workers AI on the user's own Cloudflare account (`packages/studio/src/ui/ai-managed-connect.ts`, jx-platform `/api/v1/ai/*`).

A platform that can obtain credentials on the user's behalf declares it, and Studio offers that path **before** the key form rather than beside it: on such a platform, connecting an account is the recommended route and bring-your-own-key remains available beneath it.

The models endpoint is a **capability probe**, not merely a listing. Studio decides which paths to offer from its answer, so:

- It **MUST** answer `200` for every credential state, including "no credentials" and "credentials lapsed". A non-2xx makes the probe throw, and a client that cannot read the probe falls back to offering the key form alone — which withdraws the connect affordance from precisely the users who need it.
- `managed: true` declares that the backend can obtain credentials itself. `configured` reports whether it currently holds working ones.
- `code` explains a `configured: false`, and distinguishes the two states that need different words on screen: `cf_not_connected` (never connected — invite) and `cf_reconnect_required` (the grant lapsed — explain, and offer reconnection).
- `cf_upstream_error` is reported **with `configured: true`**. A provider that is briefly unreachable is not a credential problem, and prompting for re-authorization would send the user through a flow that cannot fix it.

Brokered credentials are the platform's to hold and refresh; the client never sees them. A backend that cannot refresh a lapsed grant **MUST** report `cf_reconnect_required` rather than continuing to present the expired credential to the provider.

**A row that exists is not a connection that works.** Two of the three managed states are a stored grant, and a client **MUST** distinguish them before calling a connect flow finished. A flow that settles on "is there a connection" is answered yes from the moment it starts, so it closes the provider's authorization window before the user has reached the login screen — the authorization can then never complete, and the lapsed state that needs re-authorization is precisely the state that prevents it. The proof a flow succeeded is the lapsed marker CLEARING, never the row's presence.

**`cf_account_required` is not `cf_not_connected`.** It reports a live grant with no account chosen, because the callback found more than one and could not choose for the user. Re-authorizing cannot fix it — the flow lands back in the same state — so the client owes the user a choice over the accounts endpoint instead of an invitation to connect something that already is.

**A capability probe expires with the grant it described.** A client **MUST** drop a settled probe when a send fails with `cf_reconnect_required`. A probe taken once at start-up otherwise keeps reporting a grant that lapsed mid-session, and every gate reading it keeps offering an assistant that cannot answer.

**Per-model capability facts travel with the listing.** `toolSupport` reports whether a model can make tool calls; `contextWindow` reports its usable budget in tokens. Both are optional — a bring-your-own-key provider need not report either — but a client that drops them on ingest cannot recover them later:

- A client that will send tools **SHOULD** warn when the chosen model reports `toolSupport: false`. Such a model answers and never edits, which reads as an assistant that has silently stopped working rather than one that was never able to act.
- A client **SHOULD** prefer a reported `contextWindow` over any local heuristic. A model-id prefix table only recognizes the families its author knew, so a brokered catalogue of unfamiliar ids is budgeted at the default — an amply-sized model trimmed to a fraction of its real window.

### 2.2 The request is the history the provider will accept

> **Status: Implemented.** `toMessagesArray` in `packages/ai/src/chat-state.ts`; the `reasoning` frame in `packages/ai/src/streaming-client.ts` and `packages/server/src/ai-api.ts`.

The conversation Studio displays and the array it puts on the wire are not the same object, and two of the differences are contractual rather than cosmetic:

- **An assistant turn carrying neither text nor tool calls MUST NOT be sent.** The store appends an empty assistant message the moment a turn begins, so that message is the answer being generated _by the request that would carry it_ — a turn which has not happened yet. Most providers read the trailing `{"role":"assistant","content":""}` as an empty prefill and ignore it; DeepSeek's thinking mode instead answers `400 The reasoning_content in the thinking mode must be passed back to the API`, because a thinking-mode assistant turn owes it one. That failed the FIRST request of every conversation, before any history existed to be malformed.
- **A turn's reasoning MUST be replayed when the provider streamed one.** Thinking models emit a chain-of-thought beside the answer (`reasoning_content`, or `reasoning` at OpenRouter). DeepSeek requires the reasoning of all previous turns back on any request carrying `tools` — which is every request the agent loop makes, including turns that called no tool — and ignores the field on requests carrying none. So a client MUST keep it on the message, persist it with the session, and echo it back; a provider that never sends one is never sent one, which is what makes replaying it safe everywhere.

Both halves are one rule: **what the provider streamed is what it is owed back, and nothing else.** A normalizing proxy is therefore not free to drop the frames it cannot render — `reasoning` is a member of the `StreamEvent` union precisely so a backend that only understands `delta` cannot silently strip the turn's other half and leave the next round unanswerable.

> **Status: Partial.** The **Anthropic provider is not yet implemented** (planned). Its client **yields** a single `error` event carrying `code: "NOT_IMPLEMENTED"` and a "use OpenAI" message — it does not throw, so a caller that wraps `streamChat` in `try`/`catch` never sees it (`packages/ai/src/streaming-client.ts`). That frame carries no `problem`, so a conforming reader must tolerate an `error` event without an RFC 9457 document. Only the OpenAI-compatible path ships.

## 3. Tool Surface

The assistant is given a fixed set of document-editing tools (create/edit page and component, inspect the tree, apply edits the canvas renders live). The tool schemas and the edit-application path live in `packages/ai/src`. This section is a placeholder; the concrete tool list will be enumerated here once it stabilizes.

### 3.0 The assistant is addressable by name

Every capability the chat surface offers is a command record in the `Assistant` category — Focus Composer (`⌘⇧A`), New Chat, Chat History, Retry, Attach Selection and Stop — so each one is in the palette, in the generated keyboard sheet, and rebindable, and the chat header's buttons RUN those records rather than calling module functions beside them. They are `level: "application"`, including Attach Selection: it READS the selection and WRITES a chip into the composer, and a record is filed by the level of the state it writes.

Two context keys gate them and had no readers before: `ai.configured` (a provider is connected) and `ai.streaming` (a turn is in flight, which is the only state in which Stop can act). **A turn is in flight from an accepted send until its loop ends**, its tools, questions and imports included: the chat's own status belongs to the token stream and reads idle while a round's tools run (§3.4), so it cannot answer the question. **One window runs one turn**: a send while one is in flight starts nothing, the composer offers Stop for the whole of it, and Retry is refused until it ends. A question the turn is waiting on outranks Stop in the composer, because a send while it waits is its answer. A turn that Stop, New Chat or Open Session ends still holds the window until its loop has unwound, which is as late as the call it was running allows; a hand-off that starts the next turn (the New Project Import and Agent prompts) waits for it to end rather than being refused. None carries an `aiTool` projection — the assistant does not get to end its own conversation.

### 3.1 Schema gate

Every tool that produces a document or `project.json` is gated on JSON-Schema validation, and failures are returned to the model as tool errors so the agent loop self-corrects. A call whose arguments do not parse to a JSON object never reaches its tool: it is answered as a parse failure that names what it got (`Failed to parse arguments: arguments must be a JSON object, got null`), so the model reads a malformed call and a call of the wrong shape as one kind of mistake. Canvas mutations validate AFTER applying (undo is the backstop, and only NEWLY introduced errors are reported); disk writes validate BEFORE writing, because a disk write has no undo. `project.json` is gated against the project entry document, not the document one.

The gate uses the ACTIVE project's generated entry documents — the same payload and the same single fetch that drives the editor's diagnostics (studio.md §4.2.1), falling back to the bundled core schemas. Validating the loop against core alone under-checks it: the entry documents are what close the composition (`unevaluatedProperties: false`) and union in each enabled extension's shapes, so a model can otherwise ship an extension section its own tool call called clean and the editor flags the moment a human opens the file. The document-path convention the gate covers (`pages|layouts|components|elements`) tracks the editor's fileMatch globs for the same reason.

### 3.2 The turn is accountable

An assistant that edits documents must be able to say what it changed, and the author must be able to take it back. Three properties are normative.

**Every write is recorded, with whether it reached disk.** A tool that mutates the open document goes through the transaction path and is therefore reachable by undo; a tool that writes a file directly is not. That difference is a **fact recorded per write**, not a caveat in the system prompt, and the turn's summary states it: _"Changed 2 files · 1 written to disk — undo cannot reach it."_ **Restore to here** is offered only when every recorded change was transactional, and it re-checks at the moment it is clicked, because the ledger is bounded and may have been trimmed. A turn's writes are filed under the **last assistant message it drew**, the one the transcript renders the summary beneath, which is not always the last message: a turn can end on a tool reply (a Stop during the last call, or a cap reached with nothing applied, which draws no message), on a final round that said nothing, or after a stream error removed its round's partial. A turn capped after applying changes files under its cap message (below), which is drawn. A turn whose user message has left the transcript (another chat was opened while it ran) files under nothing, and writes nothing more into the transcript that replaced it.

**A tool chip states its outcome, not just its name.** A chip that cannot fail looks identical to one that did. The loop attaches each call's result to the call's own record, on the request that made it, as the call finishes, and the chip renders that record while the turn is still running; a restore backfills the same outcome from the `tool` reply (§3.4).

**Partial success is not failure.** Exhausting the tool-call budget after applying changes ends the turn with an ordinary message describing what was applied. Rendering it as an error is wrong twice over: it misreports the turn, and the error path _deletes the streaming message_, destroying the only account of the edits that did land. A stream error is what that path is for: it removes the failed round's partial message, which may carry a tool call cut off mid-arguments and would otherwise go out on the next send, and keeps every round before it with the calls they ran.

### 3.3 The batch follows the document, not the tab

A multi-tool turn may move between documents. The undo batch and the collaboration publish must be re-anchored to the document each tool actually wrote — anchoring once, to whichever tab happened to be active when the turn opened, silently files one document's edits under another's history.

### 3.4 A turn may stop and ask

An assistant that must guess, or apologise for not knowing, is worse than one that can ask. `ask_user` suspends the turn on the author and resumes with their reply. Five properties are normative.

**The mechanism is the tool, not a new state.** The agent loop awaits each tool call, so a tool that returns a pending promise suspends the turn; nothing in the chat state or the streaming protocol changes. `finishStream` has already run by the time tools execute, so a suspended turn is idle by construction — "waiting" is the presence of an outstanding question, not a fourth status. That idle is the token stream's, not the turn's: the turn is still in flight (`ai.streaming`, §3.0), so Stop stays on offer while the question waits.

**A skip is a success, and only a stopped turn is a failure.** "You decide" is a real answer to a fair question. Reporting it as an error would have the model apologise for asking, and would end the turn on the error path — which deletes the streaming message (§3.2).

**The answer is a tool result, never a user message.** The wire format requires a `tool` reply to follow its `tool_calls` request; a user turn spliced between them is rejected. The reply is rendered into the question's own chip, so the exchange has one account in the transcript rather than two that can disagree.

**An interactive round does not spend the tool-call budget.** The round cap bounds AUTONOMOUS work, and a round that ends by blocking on a person cannot advance without them — which is the property the cap was ever a proxy for. A separate hard ceiling keeps the loop terminating regardless.

**A question does not survive a reload, and does not pretend to.** The promise is in memory and the transcript is not. The conversation is saved as a question is put, as well as when a turn starts and ends, so a reload while it waits still finds it, and a restored question that was still open renders inert and says why. **A restored question that was answered shows its answer**, and every restored tool chip shows how its call ended. The outcome is persisted once, as the `tool` message that answered the call (the one the wire carries): a save strips `result` from every record so the payload never holds a second, disagreeing copy, and a restore backfills each call's `result` from the reply among the `tool` messages directly after its own request. Nothing is in flight after a restore, so an ordinary call nothing answered never completed and says so. A synthesized seal (below) is likewise an ordinary call's outcome, but it is not an answer to a question: a sealed or unanswered question restores as still open. The same reload — and ordinary history truncation, and a turn stopped mid-tool — can separate a `tool_calls` request from its reply, so the send path repairs the pairing: a request with no reply is sealed with a synthesised failure, and a reply with no request is dropped.

**What may be asked is bounded.** A question the model could have answered with another tool is waste, and a question about an option the answer cannot reach is worse than waste, because the reply cannot be honoured. Both are stated in the prompt as prohibitions.

### 3.5 Bootstrapping by import

`import_site` is `create_project`'s sibling: it clones a live site into a new project and adopts it into the window. Five properties are normative.

**Availability is a tier AND a capability.** "No project is open" is exactly as true on a backend with no import pipeline as on one with it, so a tier alone cannot express this; the tool declares the PAL member it needs, and one predicate answers for both the prompt's tool list and the execution gate. A tool the model is told about and then refused is a surprise to it; one refused without being told is invisible.

**The destination is the author's, not the model's.** When the run was started from the New Project wizard, the destination has already been chosen in front of the user, with a folder picker and a live preview. The tool takes it from there; a model-supplied path that disagrees is refused by name rather than silently preferred either way.

**Every create path initialises a repository.** The obligation in `specs/desktop.md` §4.5 is the create path's, not the wizard's — it belongs with whatever creates the project, and both bootstrap tools go through the same adoption sequence: version control, then the open flow, then a check that the workspace really moved. The adopter reports its failures rather than raising them, so a resolved promise is not proof.

**The project opens when it EXISTS, not when the run ends.** A crawl takes minutes, and adopting on the terminal line spent all of them with the author on the welcome screen — the only account of what was happening was a log in the sidebar. The pipeline announces the destination as soon as it holds an openable `project.json` (`specs/server.md`'s `ready` line), and adoption happens there, so pages, components and assets arrive in a file tree somebody is watching. Adoption runs at most once: a second one at the end would replace every tab the author opened while the crawl ran. A backend that sends no such signal is not broken — it is older — and the project opens at the end as before.

**The pipeline reports; the agent asks.** The import stream is one-way, so nothing pauses mid-crawl. What the run found — pages skipped by robots or by the node cap, the layout it did not detect, the components it may have split wrongly, per-page render fidelity — travels on the terminal line and becomes the material for §3.4, against real numbers rather than a guess made before the browser launched. The run's own account of itself outlives it: the transcript keeps the whole log under the tool call that produced it, scrollable and collapsed once the run is over, rather than showing a fixed tail of it and discarding the record on success. A Stop ends the run it interrupts and no other: once a run has finished or failed, a Stop later in the same turn leaves its outcome as it was.

### 3.6 Command tools

The assistant's tools are two kinds, and the difference is who wrote the tool.

**Hand tools** are registered in `packages/studio/src/services/ai-*.ts` and gated by tier: `AI_TOOL_TIERS` in `ai-system-prompt.ts` is the one table of them, carrying each tool's tier (`always`, `no-project`, `project`, `document`, `document-tree`) and its prompt blurb, and `document-assistant.ts` derives the gating predicates from the same rows. They exist for a write no person-verb makes: the seven tree writers address a node by path (the Inspector's job, not a command's), the file tools write arbitrary paths wholesale (`studio.md` §13.5's Remote Rule), and `create_project` / `import_site` re-key the conversation as a side effect a command must not know about. `ask_user` is a loop primitive, ungated. `open_document` is not a hand tool: it is the projection of the `document.open` record, whose `run` refuses by throwing when no tab holds the path and whose report names the document that IS active and whether the tree tools reach it.

**Command tools** are the command records that declare `aiTool` (`studio.md` §13.1), projected by `services/ai-command-tools.ts` as a view over the window's registry. Nothing registers them: each record IS its tool, `execute` is `registry.run`, `parameters` is the record's `args`, the gate is the record's own `when` / `enablement`, and `report` is what the model reads afterwards. The bridge's only additions are the two write witnesses, the ledger entry `undo` implies, and the schema verdict every document write already gets (`ai-write-report.ts`: new schema errors with fix hints, the render check, the token hints). The document witness holds an `undo: "document"` record to having written — an unchanged document root after `run` is "changed nothing", never success. The project witness is the same comparison over `project.json` for an `undo: "project"` record: every configuration write is a transaction on the configuration document (`tabs/project-config.ts`), so an unchanged configuration reference after `run` is a run that transacted nothing, and the ledger files nothing — `wrote: []`, mechanically, for every project record, whatever its report named. It is not a refusal: an idempotent verb asked for a state it already had is an ordinary answer, and a report that itself answered `wrote: []` keeps its sentence, because it says WHY nothing changed ("already enabled", "already one of this project's languages"), which the witness cannot; a report that claimed a write over an untouched file has its sentence replaced by "changed nothing". The per-record latches survive for that sentence alone, not for the ledger. A `report` that throws after `run` resolved is answered as a failure that says the run happened, with the ledger filed from the record's defaults, under the project witness too — the write must not vanish behind the sentence about it. A selection-level record takes `paths` and is run as `selection.setPaths` then the verb, both under their own gates.

**A tool with nothing it could be called with is withheld from the round.** A `derivedEnumProperty` on a REQUIRED argument serialises `enum: []` while the list behind it is empty — `enable_extension` with no catalogue, `disable_extension` with nothing enabled — and the record's gate cannot see its own argument list. So the bridge reads it: an enabled record whose required enum is empty is not advertised that round, in the prompt or on the wire, and returns the round the list does. An optional argument's empty enum withholds nothing, because the model can leave it out. The tool stays resolvable, so a call the model makes anyway meets the coercion's own refusal (`is not declared — declared: none`) rather than `Unknown tool`.

**Every projected tool is `strict: false`, deliberately.** `@jxsuite/ai`'s registry validator never checks `enum` and treats a required `null` as missing, which would refuse `select_node { path: null }` — a legal call. The registry's coercion (`coerceArgs`, applied inside `registry.run` for every caller) is the single validator, and its `RangeError` sentence is what the model reads.

**The loop sees one registry**, `composeToolRegistries(hand, commands)`: the hand side gated by tier, the command side gated by the record, listed hand-first, routed by name, with an unknown name answered as `@jxsuite/ai` answers it. The two name sets are disjoint and their sum is the composite's length, asserted with counts, because `ToolRegistry.register` only warns on a duplicate name. The prompt's tool list is the same two filters — `toolActive` for the hand rows and `advertisedCommandTools` for the records — so it advertises exactly what the gate will honour.

## 4. Security & Trust

The assistant executes only through the same file/RPC surfaces a human uses, behind the server's Origin/Host gate and path containment (`@jxsuite/server` §4.2). It has no independent network or filesystem access beyond the connected provider endpoint.

## 5. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). The provider wire format is OpenAI's chat-completions API, which is a vendor de-facto format rather than a published standard, so it is described in §2 rather than cited here.

| Standard                                                                                                  | Class      | Binds | Evidence                                                           | Note                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------- | ----- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WHATWG HTML](https://html.spec.whatwg.org/)                                                              | **Subset** | §2    | packages/server/src/ai-api.ts                                      | Server-Sent Events only. The proxy emits `text/event-stream` frames discriminated by a `type` field in the JSON payload; it sends no `retry:` field and no event ids, so a dropped stream is not resumable.                                                                                                                                                                                                                      |
| [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry) | **Subset** | §4    | packages/server/src/ai-api.ts                                      | Only `169.254.0.0/16` is refused — the link-local range that contains the cloud metadata address. Loopback and private-use ranges are deliberately permitted, because self-hosted models run there.                                                                                                                                                                                                                              |
| [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry) | **Subset** | §4    | packages/server/src/ai-api.ts                                      | Only `fe80::/10` is refused, matching the IPv4 rule.                                                                                                                                                                                                                                                                                                                                                                             |
| [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)                                                        | **Subset** | §2    | packages/server/src/ai-api.ts, packages/ai/src/streaming-client.ts | The non-streaming failures are `application/problem+json`, keeping the upstream's own status rather than collapsing it. The mid-stream `error` frame **carries** a problem beside its existing `message`, because by the time it is written the response has begun with a 200 and no status can change. The model catalogue deliberately stays 200 with `upstreamError`: it is degraded success that still delivers a catalogue. |

## Changelog

- **0.1.15-draft** (2026-09-18) — Document that model-listing is best-effort per BYOK endpoint and upstream failures must be surfaced distinctly from auth failures.
- **0.1.14-draft** (2026-09-14) — §3.6 open_document is the projection of document.open, the bridge holds an undo: project record to a project.json witness as it holds a document record to the document root, and a tool with an empty required enum is withheld from the round.
- **0.1.13-draft** (2026-09-13) — §3.6 Command tools: the two kinds of tool, strict: false and why, the empty-`wrote` no-op and the throwing-report answer, and the composite registry.
- **0.1.12-draft** (2026-08-31) — Provider contract §2.2: never send an empty assistant turn, and replay a thinking model's reasoning_content.
- **0.1.11-draft** (2026-08-30) — 2.1: a lapsed grant is not a completed connect; cf_account_required; probe invalidation; per-model toolSupport and contextWindow.
- **0.1.10-draft** (2026-08-26) — import_site adopts the project when it exists, not when the run ends; the run's log outlives it (§3.5).
- **0.1.9-draft** (2026-08-26) — ask_user suspends a turn on the author (§3.4); import_site bootstraps a project from a live site (§3.5).
- **0.1.8-draft** (2026-08-23) — 2.1 Managed providers: a platform may broker credentials, Studio offers that path before the key form, and the models endpoint is specified as a capability probe that must answer 200 for every credential state — with cf_not_connected, cf_reconnect_required and cf_upstream_error distinguished.
- **0.1.7-draft** (2026-08-20) — The Anthropic client yields an error event with code NOT_IMPLEMENTED; it does not throw (§2).
- **0.1.6-draft** (2026-08-16) — §2 failures are problem documents and the mid-stream frame carries one; gap:ai-problem-details closed.
- **0.1.5-draft** (2026-08-15) — Add §5 Standards Alignment: SSE, the IANA special-purpose address registries the SSRF guard uses, and the problem+json gap.
- **0.1.4-draft** (2026-08-12) — The assistant's six capabilities are command records, gated on ai.configured and ai.streaming.
- **0.1.3-draft** (2026-08-04) — §3.2 the turn is accountable (per-write disk marking, Restore to here, chip outcomes, partial success) and §3.3 the batch follows the document, not the tab.
- **0.1.2-draft** (2026-07-25) — Schema gate (§3.1): tool-level validation against the active project's entry documents, before-write for disk writes and after-apply on canvas, project.json included.
- **0.1.1-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.1.0-draft** (2026-07-22) — Reconcile spec with shipped behavior; document the eval surface (`c8d1d580`).

---

_Jx `@jxsuite/ai` Specification v0.1.15-draft — a stub, subject to expansion._
