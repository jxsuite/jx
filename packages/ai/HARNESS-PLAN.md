# Jx harness core: the Phase 1 plan

The working design for Phase 1 of the Jx harness program: turning `@jxsuite/ai` into a runtime-neutral harness core that the Studio page, Bun, a Cloudflare Worker or Durable Object, and a headless host all run. It is a plan document, not a spec. The contracts it describes become normative only as each slice lands them in `specs/ai.md` (and the other specs named per slice), and a slice that departs from this document says so in its pull request.

It was produced by mapping the current code with five independent readers, drafting three competing designs (migration-first, host-portability-first, contract-first), scoring them with three judges, and synthesising the majority winner with the others' strongest ideas and every blocker the judges raised. Citations are to the tree at the time it was written; statements such as "in flight" or "uncommitted" describe that moment.

## Status

| Slice                                     | State                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phase 0 (hardening and drift)             | Merged: jxsuite/jx#370, jxsuite/platform#69                                                                        |
| J1.1 Doc-op foundation                    | Merged: jxsuite/jx#371 (`applyDocOpsAsUser` deferred to J1.16, its first caller, under Studio's reachability rule) |
| J1.2 Freeze v1 and the Worker gate        | Merged: jxsuite/jx#372                                                                                             |
| J1.3 Persisted tool outcomes              | Merged: jxsuite/jx#374                                                                                             |
| J1.4 Loop honesty in the old loop         | Merged: jxsuite/jx#376                                                                                             |
| J1.5 Stop is armed before the first await | Merged: jxsuite/jx#377                                                                                             |
| J1.6 One turn per window                  | Merged: jxsuite/jx#378                                                                                             |
| J1.7 Honest turn outcomes                 | jxsuite/jx#380 (its live eval needed the eval harness fixes of jxsuite/jx#379)                                     |
| J1.8 ToolContext                          | This pull request (stacked on jxsuite/jx#380; `refusal` moves to J1.11, its first caller)                          |
| J1.17 `./gateway` extraction              | Merged: jxsuite/jx#375 (`upstreamErrorCode`, `wire`, `providers` and the quirks arrive with J1.18 and J1.19)       |

Update this table as slices land, and delete the document when Phase 1 is finished, as the standards adoption plan was.

---

**Base.** This design starts from Design A, the majority winner (judges 1 and 3). It keeps A's method:

- A refactor PR and a behaviour PR are never the same PR.
- Defects are fixed in the old code first.
- Extractions are proven against goldens recorded from the old code.
- `runAgentLoop` and `registerAiTools` stay as wrappers.
- The live chat store keeps the v1 shape, and the neutral model is a projection of it.

**Grafts.** From B:

- Interactions and approvals are invoker steps (`needs_input`) instead of `ctx.ask` inside `execute`.
- An atomic `DocumentHost.edit(ref, produce)`.
- Per-family `ProviderCapabilities`: the `append` or `rebuild` prompt layout and the `stable` or `per-round` tool listing.
- Pair repair with adjacency moves.
- The `JX_TOOL_FACTS` table.
- Checkpoint digests and `checkResume`.
- Parity flags in policy.
- The eval-runner golden.
- `OpenAICompatQuirks`.

From C:

- A freeze-v1 golden corpus first.
- `TurnRun`, armed synchronously, with a synchronous `onEvent` sink.
- `TurnLock`.
- The gateway conformance kit.
- The `stream_start` frame, the `X-Jx-AI-Wire` header, `wire-unsupported` with a one-shot downgrade, and probe `limits`.
- The binding digest on reasoning blocks.
- A small MCP `InvocationState`.
- `SessionFacts`.
- Explicit actor attribution on transactions.
- `SaveResult`.
- Generated wire schemas.

**Blockers fixed.** Every blocker the judges raised is closed. The table in §0.2 names where.

Root legend used below:

- `ai/` = `packages/ai/src`
- `st/` = `packages/studio/src`
- `P/` = the platform repo

Loop-host map citations (TE, DA, CM, CS, SC, PANEL, VIEW) use that map's legend.

---

## 0. Decisions and blocker resolutions

### 0.1 Rules every slice follows

1. **Refactor and behaviour never share a PR.**
   - An extraction must change nothing. It is proven against the J1.2 golden corpus in the same PR.
   - A defect is fixed in the old code first, in a PR that carries its spec sentence.
2. **The parity-gate entry points keep their signatures.**
   - `runAgentLoop({chatState, streamingClient, toolRegistry, systemPrompt, signal?, getTab?})` gains only optional fields.
   - `registerAiTools(registry, deps)`, `createChatState`, `createToolRegistry` and `createOpenAIStreamingClient` stay importable from where the evals import them (`evals/runner.ts:12-20`, `tests/harness/real-llm.ts:22-27`).
3. **Extend before adding.**
   - `ToolDefinition` gains optional fields, and there is no second entry type.
   - The neutral `ChatMessage` is a projection of the live v1 `Message`, not a second store.
4. **Exports follow consumers.** A subpath is exported in the PR that gives it its first consumer. Nothing new is re-exported from the root barrel, which pulls in `@vue/reactivity` through `chat-state` (P-2).
5. **Services are bound at construction; per-call facts travel in `ToolContext`.** There is no `host` bag in the context.
6. **v1 is the default until the other side proves more.**
   - A v2 body is sent only after the probe advertises `wire` containing 2.
   - The v1 body is accepted forever.
   - Persisted payloads stay loadable by today's build.
7. **Model-visible text moves verbatim.** This covers tool descriptions, refusal sentences, the cap text, and the `Failed to parse arguments:`, `Unknown tool:` and `execution error:` prefixes.
   - Snapshot tests pin them (C2).
   - Changing any of them is an eval experiment in its own PR.
   - F3 and F6 are kept, on purpose, until the Phase 2 rebaseline.
8. **The Worker is a first-class target.** Every Worker-reachable subpath:
   - compiles under the platform's flags (P-3);
   - imports none of `node:*`, `bun`, `@vue/reactivity`, `ajv`, `yjs`, `@modelcontextprotocol/*`, `zod`, or DOM globals.

   This is enforced inside `packages/ai`, because platform CI cannot see a jx PR.

9. **No tool body awaits a person.** Questions and confirmations are resolved by the invoker before `execute` or `settle`. Side effects therefore happen only after approval, and a resumed call never re-runs a half-executed body (M-12).

### 0.2 Blockers and where each is resolved

| Blocker (judge)                                                                                                     | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                | Where              |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `TurnSuspended` is swallowed by the registry catch (`tools.ts:273-277`); `ctx.ask` runs mid-body (J1-1, J1-2, J3-5) | `ctx.ask` is removed. Interaction tools declare `interaction(args)` and `settle(args, response)`, and `invokeTool` returns `needs_input` before any body runs. Suspension is an invoke outcome, not an exception.                                                                                                                                                                                                                                         | §3.1, §3.4, J1.21  |
| `inverseOf` hardening contradicts the in-flight clamp-and-record contract (J1-3, J2-4)                              | Clamp-and-record and the into-self refusal (J1.1) are kept exactly. `inverseOf` adds only a non-integer index rejection and a plain-object check on the `set-key` target. Refusal and coercion live in the producers. J1.1 is described honestly: a move into its own subtree now throws and rolls back, and a clamped slot is recorded.                                                                                                                  | §3.12, J1.1, J1.15 |
| Nested `transactDoc` in `applyAndValidate(() => applyDocOpsAsUser())` (J1-4)                                        | `DocumentHost.edit(ref, produce, meta)` **is** the transaction (it calls `applyDocOpsAsUser`). `applyAndValidate` no longer calls `transactDoc`. There is no version counter: the edit is atomic by construction.                                                                                                                                                                                                                                         | §3.6, J1.16        |
| PR 1 bundles behaviour flips, and "no new API" is false (J1-5, J3-2)                                                | Split into J1.3 (persisted results), J1.4 (loop honesty), J1.5 (Stop armed first), J1.6 (turn per window) and J1.7 (honest outcomes: the empty turn and applied-means-wrote, with a live eval). The policy carries `emptyTurn` and `appliedSignal`.                                                                                                                                                                                                       | §5                 |
| ai-ask pending slot and S7 to S10 survive as module state (J1-6)                                                    | Pending interactions move into an `InteractionStore` created per assistant and passed to `runAgentLoop`. S7 becomes `ctx.session`. S8 is a Studio run store keyed by `ctx.callId`, fed by `ctx.progress`. S9 and S10 become constructor-bound services of the Studio-only entries. No tool reads module state.                                                                                                                                            | §3.13, J1.8, J1.21 |
| An `executing`-window attribution heuristic is wrong for async tools (J2-1)                                         | Every transaction carries an explicit `actor`. Hand tools pass it through the `DocumentHost` or `applyAndValidate`. Command projections run in `runAsActor(actor, fn)`, a **synchronous-only** scope, with a test that `duplicate_node` and `delete_node` are attributed.                                                                                                                                                                                 | §3.13, J1.13       |
| Tier gating breaks argument-addressed MCP calls (J2-2)                                                              | The catalog `Gate` takes `(entry, args)`. Availability for document tools comes from `DocumentHost.resolve(ctx, args.document)` at call time.                                                                                                                                                                                                                                                                                                             | §3.5, §3.6         |
| `ToolResult.data: unknown` breaks JSON events (J2-3)                                                                | `invokeTool` normalises every result by a JSON round trip (the bytes are unchanged, because the tool message was always `JSON.stringify(result)`). Events and checkpoints carry only normalised results.                                                                                                                                                                                                                                                  | §3.1               |
| TIER_REQUIREMENTS carries Studio-only wording (J2-6)                                                                | Requirement sentences are host-supplied (`catalogRegistry(..., {requires})`). Studio passes today's table as its default.                                                                                                                                                                                                                                                                                                                                 | §3.5               |
| The checkpoint omits the appended messages (J2-7)                                                                   | `TurnCheckpoint.appended` holds everything the turn added. A host writes the checkpoint and the conversation in one store write.                                                                                                                                                                                                                                                                                                                          | §3.4, J1.22        |
| Rule 1 broken in A's PR 3, PR 7 and PR 9 (J3-1)                                                                     | Split each one:<br>- ToolContext refactor (J1.8) and F5/F7/F8 (J1.9).<br>- Doc-op strictness in the old tools (J1.15) and producer extraction (J1.16).<br>- Gateway extraction with server parity (J1.17) and normaliser convergence (J1.18).                                                                                                                                                                                                             | §5                 |
| Anthropic replay wrong under Studio's per-turn rebuild (J3-3)                                                       | Each reasoning block records `binding = digest(system, tools, prefix without reasoning)`. The projection sends only the **trailing run** of signed blocks whose binding still matches, removing the stale leading run itself, which is valid per the chain rule. `block_binding` is set explicitly where the beta exists, with strip-and-retry once elsewhere. The append layout and stable listing for the Anthropic family land in the same PR (J1.24). | §3.8, J1.24        |
| Checkpoint too big for MCP `requestState` (J3-4)                                                                    | A separate small `InvocationState` (callId, tool, argsDigest, stage, request, issuedAt, principal), HMAC-bound by the MCP adapter. `TurnCheckpoint` never travels through a client.                                                                                                                                                                                                                                                                       | §3.5               |
| Async `DocumentHost.apply` with an optimistic stale check (J3-6)                                                    | `edit(ref, produce)` reads, produces and mutates synchronously. A returned promise settles only for persistence.                                                                                                                                                                                                                                                                                                                                          | §3.6               |
| `tsc` spawned from a test (J3-7)                                                                                    | A `typecheck:ai-worker` step in `checks`; `@cloudflare/workers-types` becomes a devDependency of `packages/ai`.                                                                                                                                                                                                                                                                                                                                           | J1.2               |
| Factual fixes (J3-8)                                                                                                | ai.md §1's "no Jx dependencies" is corrected in J1.2 (`@jxsuite/protocol` already depends on `@jxsuite/schema`). Every `feat` moves `@jxsuite/ai` 0.37 to 0.38+, which is outside the platform's `^0.37.2`, so each platform adoption is an explicit range bump and `./streaming-client` stays byte-compatible.                                                                                                                                           | §7                 |
| A's PR 12a was too large (J3-9)                                                                                     | Split into catalog membership (J1.20), interactions and approvals (J1.21), and checkpoints and resume (J1.22).                                                                                                                                                                                                                                                                                                                                            | §5                 |
| B's `ToolEntry.kind` broke the interactive budget for bridged tools (J1 on B)                                       | The `interactive` flag stays separate from `interaction()`. The budget reads `interactive`.                                                                                                                                                                                                                                                                                                                                                               | §3.1               |
| Required annotation metadata breaks ad-hoc test tools (J1 on C)                                                     | Adapters over a plain registry never throw. A missing annotation reads as MCP's conservative default. `createCatalog` (production composition) and a test over the 29 production tools are the forcing function.                                                                                                                                                                                                                                          | §3.5, J1.20        |

---

## 1. Ground truth this design integrates with (verified in the working tree)

- **`@jxsuite/schema/doc-ops`** (J1.1, uncommitted, `packages/schema/src/doc-ops.ts`). It exports `JxDocOp`, `JxDocOpPair`, `cloneValue`, `getNodeAtPath`, `childArray`, `applyDocOpToDoc`, `inverseOf` and `applyDocOpsWithInverse`.
  - `inverseOf` records `insertionSlot(index, length)`, the slot the node actually lands in (clamped, and counted from the end for a negative index).
  - It refuses `doc-op-move-into-self` and `doc-op-mapped-children`.
  - It keeps the `children: []` residue deliberately.
  - `applyDocOpsWithInverse` attaches `applied` pairs to the thrown error.
- **`st/tabs/doc-op-apply.ts`** re-exports doc-ops. `mutateMoveNode` computes its inverse through `inverseOf`.
- **`transact.ts:433`** still records `inverse: op` in `applyDocOp`. `_batchTab` is a global (`:480`), and history is skipped whenever any batch is open (`:265`). `applyDocOpsAsUser` **is not in the tree yet** (J1.1 in parallel).
- **`ai/tools.ts:261-277`**: `execute(name, args)` takes two arguments and catches every throw as `Tool "x" execution error:`.
- **`st/services/ai-tools.ts:71-102`**: `applyAndValidate` awaits `snapshotBeforeWrite`, then calls `transactDoc(tab, fn)` itself.
- **`tool-executor.ts:49`**: `INTERACTIVE_TOOLS = new Set(["ask_user"])`. LOOPT registers the real `registerAskTool` plus ad-hoc `first`/`second` definitions.
- **`STREAM_EVENT_TYPES`** is a keyed `as const` object (`streaming-client.ts:265-274`).
- **`packages/ai/package.json`** depends on `@jxsuite/protocol`, which depends on `@jxsuite/schema`. It exports `.`, `./streaming-client`, `./tools` and `./chat-state`. Its bunfig is 0.99/0.99. Release-please gives `packages/ai` no `bump-minor-pre-major`.
- **`scripts/check-schema-freshness.ts`** exports `GENERATORS` and `SchemaKind = "core" | "entry" | "fragment"`.
- **Anthropic** (claude-api skill, `shared/model-migration.md` "Breaking change 3" and `shared/prompt-caching.md` "Mid-conversation system messages"):
  - Rebuilding `system` or `tools` invalidates every later thinking block.
  - Removing a leading run of thinking blocks is valid.
  - `drop_block` drops the first mismatch **and every later block**.
  - `thinking.block_binding.prefix_mismatch_behavior` requires `anthropic-beta: thinking-binding-controls-2026-08-01`.
  - Mid-conversation `{"role":"system"}` messages are GA on Opus 5, Opus 4.8, Fable 5/5.1 and Mythos 5/5.1, but not on Sonnet 5.

---

## 2. Subpath map and import lattice

| Subpath              | Status               | Worker-safe                  | Imports (runtime)                                                                                  | First slice | Consumers                                         |
| -------------------- | -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------- |
| `.`                  | unchanged            | no                           | `@vue/reactivity` via chat-state                                                                   | —           | evals, legacy                                     |
| `./streaming-client` | additive             | yes                          | `@jxsuite/protocol` (types, problems)                                                              | J1.18       | platform (pinned), Studio, evals                  |
| `./tools`            | evolved              | yes                          | none                                                                                               | J1.8        | every host                                        |
| `./chat-state`       | additive             | no                           | `@vue/reactivity`                                                                                  | J1.4        | Studio, evals                                     |
| `./messages`         | new                  | yes                          | none                                                                                               | J1.10       | chat-state, harness, gateway, providers, sessions |
| `./harness`          | new                  | yes                          | tools, messages (types from streaming-client)                                                      | J1.11       | Studio adapter, headless, DO                      |
| `./jx-tools`         | new                  | yes                          | `@jxsuite/schema/{doc-ops,types}`; later `/a11y`, `/overlays`, `/dialogs`, `/locale`, `/redirects` | J1.16       | Studio, headless, DO, MCP                         |
| `./gateway`          | new                  | yes                          | messages, `@jxsuite/protocol/problems`                                                             | J1.17       | `packages/server`, platform                       |
| `./providers`        | new                  | yes                          | messages, gateway normaliser                                                                       | J1.19       | gateway, headless evals                           |
| `./catalog`          | new                  | yes                          | tools                                                                                              | J1.20       | Studio, MCP, DO                                   |
| `./sessions`         | new                  | yes                          | messages                                                                                           | J1.23       | Studio (its stores live in Studio)                |
| `./testing`          | new                  | yes, no test runner imported | harness, gateway, providers                                                                        | J1.18       | tests in ai, server, studio, platform             |
| `./schemas/*`        | new (generated JSON) | n/a                          | —                                                                                                  | J1.19       | third-party backends, gateway tests               |

Shared type-only files `ai/core-types.ts` (JsonValue) and `ai/*/types.ts` go on the allowlist in `scripts/check-coverage-manifest.ts` in the PR that adds them.

**Enforcement** (introduced in J1.2, extended in each subpath's first slice):

- `packages/ai/tests/worker-safety.test.ts`
  - For each Worker-safe entry, `Bun.build({entrypoints:[entry], target:"browser", conditions:["workerd","worker"], metafile:true})`.
  - Fails on any input matching `node:`, `bun`, `@vue/reactivity`, `ajv`, `yjs`, `@modelcontextprotocol`, `zod`, `packages/studio`, `packages/runtime`, `packages/ui`, the `@jxsuite/schema` root, `validate-project` or `project-schemas`.
  - Non-vacuity: it asserts one known edge exists (`./harness` depends on `./tools`).
- `packages/ai/tsconfig.worker.json`
  - Flags: `lib:["ES2023"]`, `types:["@cloudflare/workers-types"]`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `skipLibCheck:false`, including only Worker-safe entries.
  - It runs as the root script `typecheck:ai-worker`, added to `checks` in `.github/workflows/test.yml`.
  - This gate is what catches `Promise.withResolvers`, `Object.groupBy`, `Array.fromAsync` and DOM types.
- `packages/studio/tests/ai-import-rules.test.ts`
  - `st/**` never imports `@jxsuite/ai/{gateway,providers,testing}`.
  - It records a minified-size ratchet for the AI modules that `services/document-assistant.ts` reaches. J1.17 lands the import rule alone; the ratchet lands with J1.11, when Studio first reaches `./harness` and the graph it measures starts to grow.
- Static imports only inside `packages/ai`, with no lazy `import()`. This keeps away the Bun 1.4.0 overlapping-dynamic-import coverage drop.

---

## 3. Exact API by subpath

### 3.1 `@jxsuite/ai/tools` (evolved in J1.8, J1.20 and J1.21)

Unchanged exports: `JSONSchema`, `ToolResult`, `toolSuccess`, `toolError`, `createToolRegistry` (its validator, `listForLLM` and texts), `createToolDefinition`.

```ts
// ai/core-types.ts (type-only; re-exported by ./tools and ./messages)
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  summary?: string;
} // unchanged

/** One change the assistant made. Moved from st/services/ai-writes.ts (which re-exports it). */
export interface AiWrite {
  path: string;
  tool: string;
  disk: boolean;
  ok: boolean;
  error?: string;
  /** DocumentRef.id the write landed in; Restore uses it (J1.14). */
  target?: string;
}
export interface WriteLedger {
  record(write: AiWrite): void;
  readonly writes: readonly AiWrite[];
}
export function createLedger(onRecord?: (write: AiWrite) => void): WriteLedger;

export interface Actor {
  readonly kind: "assistant";
  /** `assistant:<sessionId|local>:<turnId>`; the key history entries and lanes use. */
  readonly id: string;
  readonly turnId: string;
  readonly sessionId: string | null;
  readonly model?: string;
  /** The human the run acts for, when the host knows (platform: H-8, R-1). */
  readonly onBehalfOf?: {
    readonly id: string;
    readonly login?: string;
    readonly permission?: "read" | "write";
    readonly verifiedAt?: number;
  };
}

/** Durable per-session JSON facts (replaces the `imported` guard, S7). Reset by New Chat. */
export interface SessionFacts {
  readonly sessionId: string | null;
  get(key: string): JsonValue | undefined;
  set(key: string, value: JsonValue): void;
}
export function createSessionFacts(
  sessionId?: string | null,
  initial?: Readonly<Record<string, JsonValue>>,
): SessionFacts & { toJSON(): Record<string, JsonValue> };

/** Per-call facts only. Host services are bound when a tool is built (rule 5). */
export interface ToolContext {
  /** Per-CALL child of the turn signal: aborts with the turn; its link is removed when the call settles (F1, D10). */
  readonly signal: AbortSignal;
  /** The provider's call id in a turn; minted by the MCP adapter. Equals the chip id and the import-run key. */
  readonly callId: string;
  readonly actor: Actor;
  readonly ledger: WriteLedger;
  readonly session: SessionFacts;
  /** Becomes a `tool_progress` event; MCP notifications/progress. No-op when unobserved. */
  progress(event: JsonValue): void;
}
/** Detached: never-aborting signal, callId "", a fresh ledger, empty session facts, no-op progress. */
export function createToolContext(init?: Partial<ToolContext>): ToolContext;
/** Links a child to the turn with a `{once:true}` listener and returns `release()`, which removes it.
 *  Hand-wired rather than AbortSignal.any so page webviews and ES2023 typing agree. */
export function linkCallSignal(turn: AbortSignal): {
  readonly signal: AbortSignal;
  release(): void;
};

// J1.21: interactions (a person answers; no tool body awaits them)
export type ApprovalReason = "destructive" | "not-undoable" | "open-world";
export type InteractionRequest =
  | {
      readonly kind: "question";
      readonly question: string;
      readonly options: readonly string[];
      readonly context: string;
    }
  | {
      readonly kind: "approval";
      readonly tool: string;
      readonly title: string;
      readonly summary: string;
      readonly reason: ApprovalReason;
    };
export type InteractionResponse =
  | { readonly kind: "question"; readonly answer: string | null; readonly skipped: boolean } // ai-ask.ts data shape (I7)
  | { readonly kind: "approval"; readonly approved: boolean; readonly remember?: "session" };

// J1.20: facts
export interface ToolAnnotations {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly openWorld: boolean;
}
export type Undoability = "document" | "project" | "none";
/** MCP's conservative defaults: what an un-annotated definition is taken to be (never a throw). */
export const UNKNOWN_ANNOTATIONS: ToolAnnotations; // {readOnly:false, destructive:true, idempotent:false, openWorld:true}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  strict: boolean;
  llmStrict: boolean;
  /** J1.8: its round does not spend the work budget (replaces INTERACTIVE_TOOLS, TE:49). */
  interactive?: boolean;
  /** J1.21: the person-facing request. When present, the invoker resolves it and calls `settle`, never `execute`. */
  interaction?: (args: Readonly<Record<string, unknown>>) => InteractionRequest;
  settle?: (args: Readonly<Record<string, unknown>>, response: InteractionResponse) => ToolResult;
  title?: string; // J1.20
  annotations?: ToolAnnotations; // J1.20
  undoable?: Undoability; // J1.20: set by the host that builds it; default "none"
  capabilities?: readonly string[]; // J1.20: static host capabilities (§3.5 "tier AND capability")
  tier?: string; // J1.20: "always" | "no-project" | "project" | "document" | "document-tree"
  execute: (args: object, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register: (tool: ToolDefinition) => void; // still warns on a duplicate (compat); createCatalog throws
  list: () => ToolDefinition[];
  listForLLM: () => object[];
  validate: (toolName: string, args: object) => { valid: boolean; errors?: string[] };
  /** ctx omitted → createToolContext(). Wrapping registries MUST forward ctx (T3's test enforces it; the type leaves `ctx` optional). */
  execute: (toolName: string, args: object, ctx?: ToolContext) => Promise<ToolResult>;
  getDefinition: (toolName: string) => ToolDefinition | undefined;
  /** J1.8: the refusal sentence `execute` would answer right now, or null. Wrappers forward it. */
  refusal?: (toolName: string) => string | null;
}
export function createToolDefinition(
  opts: Omit<ToolDefinition, "strict" | "llmStrict"> & { strict?: boolean; llmStrict?: boolean },
): ToolDefinition;

// J1.11: the one invocation pipeline (runTurn and MCP both call it, M-11). Extended in J1.21.
export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly argumentsText?: string; // model calls (raw, may be invalid)
  readonly args?: Readonly<Record<string, unknown>>; // MCP calls
}
export type ApprovalDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "confirm"; readonly reason: ApprovalReason; readonly summary: string };
export interface InvokeOptions {
  /** J1.21. Default: always proceed (today's behaviour). */
  readonly approval?: (
    definition: ToolDefinition,
    args: Readonly<Record<string, unknown>>,
  ) => ApprovalDecision;
  /** Present when re-invoking after `needs_input`. */
  readonly response?: InteractionResponse;
}
export type InvokeOutcome =
  | { readonly status: "done"; readonly result: ToolResult; readonly executed: boolean }
  | { readonly status: "needs_input"; readonly request: InteractionRequest };
export function invokeTool(
  registry: ToolRegistry,
  call: ToolCall,
  ctx: ToolContext,
  options?: InvokeOptions,
): Promise<InvokeOutcome>;
/** JSON round trip. The bytes of JSON.stringify(result) are unchanged; data becomes a JsonValue. */
export function normalizeToolResult(result: ToolResult): ToolResult;
```

`invokeTool` runs these steps in order, and the first one that answers wins. The texts are verbatim from today's code:

1. **Unknown name.** `getDefinition(name)` is undefined, giving `Unknown tool: "<name>"` (tools.ts:264).
2. **Refusal.** `registry.refusal?.(name)` returns a sentence, which becomes the error. It is the gate text of `gated-registry.ts:61-68` and the command record's `requires` text.
3. **Parse.** `args` is used as given.
   - `""` becomes `{}` (I5).
   - A `JSON.parse` throw becomes `Failed to parse arguments: <message>` (TE:216-221).
   - A non-object becomes `Failed to parse arguments: arguments must be a JSON object, got <type>` (D9; the prefix is kept).
4. **Interaction definitions.**
   - `registry.validate` failing gives `Validation failed: <errors>`.
   - With no `response`, the outcome is `needs_input` with `interaction(args)`.
   - With a question response, the result is `settle(args, response)`.
5. **Approval.**
   - `deny` gives `{success:false, error: message}`.
   - `confirm` with no response gives `needs_input` with an approval request.
   - An approval response with `approved:false` gives `The author declined this call.`
6. **Execute.** `registry.execute(name, args, ctx)` keeps its own validation, gate and catch texts.
7. **Normalise.** `normalizeToolResult`. `executed` is true only for step 6.

### 3.2 `@jxsuite/ai/messages` (J1.10; extended in J1.12, J1.23 and J1.24)

```ts
export type { JsonValue } from "./core-types";
export type ProviderFamily = "openai-compat" | "anthropic";
export interface Provenance {
  readonly family: ProviderFamily;
  readonly model: string | null; // null only for data migrated from v1
  /** J1.24: bindingOf(...) of the request that produced the block (Anthropic replay). */
  readonly binding?: string;
}

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}
export interface ReasoningBlock {
  readonly type: "reasoning";
  readonly text: string; // "" when only a redacted payload was sent
  readonly signature?: string; // opaque
  readonly redacted?: string; // opaque string, never merged into text (§6.4 rule)
  readonly provenance?: Provenance; // absent ⇒ message meta, else legacy openai-compat (H8)
}
export interface ToolCallBlock {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string; // raw; the only source of truth (I5)
  readonly signature?: string; // opaque per-call signature, round-tripped
}
export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly callId: string;
  readonly isError: boolean; // = parsed.success === false; unparseable ⇒ false
  readonly content: string; // exactly JSON.stringify(ToolResult) for Jx tools (I8)
}
export interface OpaqueBlock {
  readonly type: "opaque";
  readonly family: ProviderFamily;
  readonly data: JsonValue;
}
export type Block = TextBlock | ReasoningBlock | ToolCallBlock | ToolResultBlock | OpaqueBlock;

/** "system" is (a) v1 passthrough, (b) harness context messages in the append layout (J1.24). */
export type Role = "user" | "assistant" | "tool" | "system";
export type MessageKind =
  "ctx_summary" | "sealed" | "round_cap" | "seeded" | "restored" | "context" | "compaction";
export interface MessageMeta {
  readonly origin?: "model" | "harness" | "user";
  readonly kind?: MessageKind;
  readonly model?: string;
  readonly family?: ProviderFamily;
  readonly incomplete?: "error" | "truncated" | "length";
  readonly turnId?: string;
  /** Never sent to a provider. Reverse-DNS keys, e.g. "com.jxsuite.studio/ledger". */
  readonly host?: { readonly [ns: string]: JsonValue };
}
export interface ChatMessage {
  readonly id: string;
  readonly role: Role;
  readonly blocks: readonly Block[];
  readonly timestamp: number;
  readonly meta?: MessageMeta;
}
/** What travels in a v2 request: no id, timestamp or meta (C2). */
export interface WireMessage {
  readonly role: Role;
  readonly blocks: readonly Block[];
}

/** The v1 live and persisted shape (chat-state Message, ai-session-store PersistedMessage), plus two optional fields. */
export interface LiveToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: import("./tools").ToolResult | null;
}
export interface LiveMessage {
  id: string;
  role: Role;
  content: string;
  reasoningContent?: string;
  toolCalls?: LiveToolCall[];
  toolCallId?: string;
  timestamp: number;
  /** Present ONLY when blocks cannot be derived from the v1 fields (signed, redacted, bound, opaque, interleaved). */
  blocks?: Block[];
  meta?: MessageMeta;
}

export function toChatMessages(live: readonly LiveMessage[]): ChatMessage[];
/** Rebuilds v1 fields; backfills toolCalls[].result from the matching tool message (H5). */
export function toLiveMessages(messages: readonly ChatMessage[]): LiveMessage[];
export function toWireMessages(messages: readonly ChatMessage[]): WireMessage[];
export function isEmptyAssistant(message: ChatMessage | LiveMessage): boolean; // I1 in one place

export interface ToolSpec {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}
export type OpenAIMessage =
  | { role: "user" | "system"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };
export interface OpenAIWireOptions {
  /** Default: replay text of blocks whose effective family is openai-compat and that are not redacted (§2.2). */
  readonly replayReasoning?: (block: ReasoningBlock, message: ChatMessage) => boolean;
  readonly reasoningField?: "reasoning_content" | "reasoning";
}
export function toOpenAIMessages(
  messages: readonly ChatMessage[],
  options?: OpenAIWireOptions,
): OpenAIMessage[];
export function toOpenAITools(tools: readonly ToolSpec[]): object[]; // `listForLLM` shape, byte-identical
export function fromOpenAITools(tools: readonly object[]): ToolSpec[];

// J1.12
export const SEAL_RELOADED: string; // CM:279 sentence, verbatim
export const SEAL_CUT_OFF: string; // "This tool call was never completed — the response was cut off before it finished."
export interface RepairReport {
  messages: ChatMessage[];
  sealed: string[];
  dropped: string[];
  moved: string[];
}
export function repairToolPairs(
  messages: readonly ChatMessage[],
  options: { newId: () => string; now: () => number },
): RepairReport;

// J1.23
export function migrateTranscript(
  raw: unknown,
  options: { newId: () => string; now: () => number },
): LiveMessage[] | null;
export function persistWindow(messages: readonly LiveMessage[], max: number): LiveMessage[];
export function sessionTitle(firstUserText: string, maxChars?: number): string; // 60 by default (H13)

// J1.24
export function canonicalJson(value: unknown): string; // sorted keys, no whitespace, undefined dropped
export function digest(value: unknown): string; // "f1:" + FNV-1a-64 hex; identity, not security
/** digest of {system, tools, prefix} where prefix is the wire messages before `index` with reasoning blocks removed. */
export function bindingOf(
  request: { readonly system: readonly SystemBlock[]; readonly tools: readonly ToolSpec[] },
  messages: readonly WireMessage[],
  index: number,
): string;
/** Keeps signatures/redacted payloads only on the latest assistant turn; earlier ones keep text (front-only removal). */
export function stripOlderSignatures(messages: readonly LiveMessage[]): LiveMessage[];
export interface SystemBlock {
  readonly text: string;
  readonly cache?: true;
}
```

**Projection rules.** These are exactly `toMessagesArray` (CS:483-530), stated once:

1. An assistant message with no text and no calls is skipped (I1).
2. Assistant `content` is `null` when there are calls and no text (I4).
3. `reasoning_content` is the concatenated text of the replayable blocks, by default every non-anthropic, unredacted block, so every v1 message replays exactly as today (I2).
4. `tool_calls` come from the `tool_call` blocks.
5. Tool messages become `{role:"tool", tool_call_id, content}`.
6. User text is byte-identical, including the attached-context block (H15).
7. A `system` message becomes `{role:"system", content}`, the v1 passthrough.

**Repair** (J1.12). It extends CM:276-360:

- Pairing is **per assistant message**, not over one transcript-wide id set (H10).
- A reply found later than its request is **moved** to directly after it, fixing the D2 interleave.
- A reply with no request is dropped.
- An unanswered call is sealed with `SEAL_CUT_OFF` when its arguments do not parse (a cut-off), otherwise with `SEAL_RELOADED`.
- The function is idempotent.

**Migration** (J1.23). It reads the legacy array, the v1 array, and v1.5 (v1 plus `blocks`/`meta`):

- A message with no id gets one **once**; the caller persists it (H9).
- Id prefixes `ctx_summary_`, `sealed_`, `restored_` and `seeded_` map to `meta.kind` (H7).
- A tool call whose arguments do not parse and that has no reply gets `meta.incomplete:"error"` (H6).
- Results are backfilled (H5).
- It returns `null` when the input is not a transcript.

`persistWindow` takes the last `max` messages, then moves the start forward to the first `user` message in that window (H4).

### 3.3 `@jxsuite/ai/streaming-client` (additive only)

```ts
// v1 members gain optional fields; a v1 reader ignores them (map §6.4).
export interface StreamDeltaEvent {
  type: "delta";
  content: string;
  block?: number;
}
export interface StreamReasoningEvent {
  type: "reasoning";
  content: string;
  block?: number;
}
export interface StreamToolCallStartEvent {
  type: "tool_call_start";
  id: string;
  name: string;
  block?: number;
}
export interface StreamToolCallDeltaEvent {
  type: "tool_call_delta";
  id: string;
  args: string;
}
export interface StreamToolCallEndEvent {
  type: "tool_call_end";
  id: string;
  signature?: string;
}
export interface StreamUsageEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  cacheWriteInputTokens?: number;
}
export interface StreamDoneEvent {
  type: "done";
  stopReason: string;
  /** J1.18: the body ended with no terminal marker (D11). stopReason stays "stop" for v1 readers. */
  truncated?: true;
  providerStopReason?: string;
}
export interface StreamErrorEvent {
  type: "error";
  message: string;
  code?: string;
  problem?: ProblemDetails;
  retryAfterMs?: number;
}
export type StreamEvent =
  | StreamDeltaEvent
  | StreamReasoningEvent
  | StreamToolCallStartEvent
  | StreamToolCallDeltaEvent
  | StreamToolCallEndEvent
  | StreamUsageEvent
  | StreamDoneEvent
  | StreamErrorEvent; // the existing name, still 8 members

// J1.19: v2-only frames, sent only to a v2 request
export interface StreamStartEvent {
  type: "stream_start";
  wire: 2;
  family: ProviderFamily;
  model: string;
  requestId?: string;
  droppedThinking?: number;
}
export interface StreamReasoningSignatureEvent {
  type: "reasoning_signature";
  block: number;
  signature: string;
}
export interface StreamReasoningRedactedEvent {
  type: "reasoning_redacted";
  block: number;
  data: string;
}
export type WireEvent =
  StreamEvent | StreamStartEvent | StreamReasoningSignatureEvent | StreamReasoningRedactedEvent;
export const STREAM_EVENT_TYPES: { readonly DELTA: "delta" /* …unchanged 8 keys… */ };
export const WIRE_EVENT_TYPES: typeof STREAM_EVENT_TYPES & {
  readonly STREAM_START: "stream_start";
  readonly REASONING_SIGNATURE: "reasoning_signature";
  readonly REASONING_REDACTED: "reasoning_redacted";
};

export interface ChatRequestV1 {
  messages: object[];
  tools: object[];
  systemPrompt: string;
  model?: string;
} // frozen
export interface ChatRequestV2 {
  wire: 2;
  model?: string;
  system: SystemBlock[]; // v1 projection: blocks.map(b => b.text).join("")
  messages: WireMessage[]; // pair-complete (the gateway never repairs)
  tools: ToolSpec[]; // catalog order (M-6)
  maxTokens?: number;
  temperature?: number;
  toolChoice?: "auto" | "none" | "required" | { name: string };
  reasoning?: { effort?: "low" | "medium" | "high" };
  metadata?: { sessionId?: string; turnId?: string; round?: number }; // audit/rate limit only, never forwarded
}
export function negotiateWire(probe: { wire?: readonly number[] } | null): 1 | 2; // 2 iff probe.wire includes 2
export const WIRE_HEADER = "X-Jx-AI-Wire";

export interface StreamingClient {
  streamChat: (
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ) => AsyncGenerator<StreamEvent>;
  /** J1.19: present only on a client built for wire 2. fromStreamingClient prefers it. */
  streamTurn?: (
    request: Omit<ChatRequestV2, "wire" | "model">,
    signal: AbortSignal,
  ) => AsyncGenerator<WireEvent>;
}
export interface ProxyStreamingClientOptions {
  /** J1.5: may be lazy, resolved inside the first stream call, so Stop is armed before this await (D4). */
  chatUrl: string | (() => string | Promise<string>);
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  wire?: 1 | 2; // J1.19
  family?: ProviderFamily; // J1.24: "X-Api-Provider"
  fetch?: typeof fetch;
}
```

The v1 wrappers (`createOpenAIStreamingClient`, `createProxyStreamingClient`, `createAnthropicStreamingClient`) keep their options and behaviour. From J1.18 the OpenAI client uses the gateway's normaliser (§3.7). The platform's `^0.37` import keeps compiling at every release.

### 3.4 `@jxsuite/ai/harness` (J1.11; extended in J1.21, J1.22, J1.24, J1.27 and J1.28)

```ts
import type {
  ChatMessage,
  ProviderFamily,
  ReasoningBlock,
  SystemBlock,
  ToolSpec,
  JsonValue,
} from "./messages";
import type {
  AiWrite,
  InteractionRequest,
  InteractionResponse,
  ToolRegistry,
  ToolResult,
  SessionFacts,
  ApprovalDecision,
  ToolDefinition,
} from "./tools";
import type { StreamingClient, WireEvent, StreamUsageEvent } from "./streaming-client";
import type { ProblemDetails } from "@jxsuite/protocol";

export interface ModelRequest {
  readonly system: readonly SystemBlock[];
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens?: number;
}
export type ModelFn = (request: ModelRequest, signal: AbortSignal) => AsyncIterable<WireEvent>;
/** Exactly ONE client.streamChat (or streamTurn) per round, read from `client` at call time (RUNEVAL:300-309 patches it).
 *  Synthesises stream_start from `family`/`model()` when the stream carries none. */
export function fromStreamingClient(
  client: StreamingClient,
  options?: {
    readonly wire?: import("./messages").OpenAIWireOptions;
    readonly family?: ProviderFamily;
    readonly model?: () => string;
  },
): ModelFn;

export interface ProviderCapabilities {
  // J1.24 (B graft)
  readonly family: ProviderFamily;
  readonly promptLayout: "rebuild" | "append"; // openai-compat rebuild (parity); anthropic append
  readonly toolListing: "per-round" | "stable"; // openai-compat per-round; anthropic stable
  readonly requiresMaxTokens: boolean;
  readonly maxCacheBreakpoints: number; // 0 / 4
  readonly midConversationSystem: boolean; // per model (not Sonnet 5)
}

export type Usage = Omit<StreamUsageEvent, "type">;
export interface TurnError {
  readonly message: string;
  readonly code?: string;
  readonly problem?: ProblemDetails;
}
export type TurnOutcomeKind =
  "complete" | "cap_partial" | "cap_failed" | "error" | "cancelled" | "empty" | "suspended";
export type SuspendReason = "interaction" | "credentials" | "permission" | "rate_limit";

export interface TurnPolicy {
  readonly maxWorkRounds: number; // 5 (TE:35)
  readonly maxRounds: number; // 25 (TE:46)
  readonly estimateTokens: (text: string) => number; // CM:29
  readonly capText: (cap: {
    readonly maxWorkRounds: number;
    readonly applied: readonly string[];
    readonly errors: readonly string[];
  }) => string; // TE:249-260 verbatim
  readonly emptyText: string; // J1.7 wording
  readonly emptyTurn: "silent" | "error"; // "error" from J1.7 (B graft)
  readonly appliedSignal: "summary" | "write"; // "write" from J1.7 (D7)
  readonly approval: (
    definition: ToolDefinition,
    args: Readonly<Record<string, unknown>>,
  ) => ApprovalDecision; // J1.21
  readonly parallelReadOnly: boolean; // J1.27; default false
  readonly toolListing: "per-round" | "stable" | "auto"; // auto = capabilities (J1.24)
  readonly promptLayout: "rebuild" | "append" | "auto";
  readonly suspendOn: readonly string[]; // J1.22: error codes that suspend (DO: cf_reconnect_required, rate_limited, daily_limit)
}
export const DEFAULT_TURN_POLICY: TurnPolicy;
export function policyDigest(policy: TurnPolicy): string;

export interface RoundPlan {
  readonly tools?: readonly ToolSpec[];
  /** append layout only: the volatile context; appended once as a harness `context` message when it changed. */
  readonly context?: string;
}
export interface TurnHooks {
  /** Default tools: fromOpenAITools(tools.listForLLM()) (per-round) or the stable member list. No system override (H9). */
  beforeRound?(round: { readonly index: number; readonly workRounds: number }): RoundPlan | void;
  beforeTool?(call: { readonly callId: string; readonly name: string }): void;
  afterTool?(call: {
    readonly callId: string;
    readonly name: string;
    readonly result: ToolResult;
  }): void;
  /** Before round_end{error}. Studio: cf_reconnect_required → resetModelCache + ensureProxyProbe (L14). */
  onStreamError?(error: TurnError): void;
}

export type InteractionStrategy =
  | {
      readonly mode: "inline";
      resolve(
        request: InteractionRequest,
        at: { readonly callId: string; readonly signal: AbortSignal },
      ): Promise<InteractionResponse>;
    }
  | { readonly mode: "suspend" } // J1.22: checkpoint and end the turn "suspended"
  | { readonly mode: "none" }; // interaction definitions refuse: "<name> needs a person, and none is available here."

export interface TurnLock {
  acquire(turnId: string): (() => void) | null;
  readonly active: string | null;
}
export function createTurnLock(): TurnLock;
export class LaneBusyError extends Error {}

export interface TurnInput {
  readonly history: readonly ChatMessage[]; // pair-complete; ends with this turn's user message; no empty placeholder
  readonly system: readonly SystemBlock[]; // fixed for the turn
  readonly model: ModelFn;
  readonly modelInfo?: {
    readonly family: ProviderFamily;
    readonly model: string;
    readonly capabilities?: ProviderCapabilities;
  };
  readonly tools: ToolRegistry;
  readonly signal?: AbortSignal; // linked into run.signal
  readonly turnId?: string;
  readonly sessionId?: string | null;
  readonly firstMessageId?: string; // adopt Studio's on-screen placeholder
  readonly newId?: () => string; // default msg_<ms>_<n> (chat-state uid scheme)
  readonly now?: () => number;
  readonly policy?: Partial<TurnPolicy>;
  readonly hooks?: TurnHooks;
  readonly interactions?: InteractionStrategy; // default { mode: "none" }
  readonly session?: SessionFacts;
  readonly lock?: TurnLock;
  readonly resume?: {
    readonly checkpoint: TurnCheckpoint;
    readonly response: InteractionResponse | null;
  }; // J1.22
  /** SYNCHRONOUS sink, called in seq order before the harness takes its next step (ordering invariant 3). */
  readonly onEvent?: (event: HarnessEvent) => void;
}
export interface TurnRun extends AsyncIterable<HarnessEvent> {
  readonly turnId: string;
  readonly signal: AbortSignal; // armed before runTurn returns (T1, fixes D4 structurally)
  cancel(reason?: "user" | "superseded" | "shutdown"): void;
  readonly outcome: Promise<TurnOutcome>;
}
/** Throws LaneBusyError synchronously when `lock` is held (D2). */
export function runTurn(input: TurnInput): TurnRun;

interface EventBase {
  readonly v: 1;
  readonly seq: number;
  readonly turnId: string;
}
export type HarnessEvent = EventBase &
  (
    | { readonly type: "turn_start"; readonly resumed: boolean }
    | {
        readonly type: "transcript_repaired";
        readonly sealed: readonly string[];
        readonly dropped: readonly string[];
        readonly moved: readonly string[];
      }
    | {
        readonly type: "round_start";
        readonly round: number;
        readonly workRounds: number;
        readonly messageId: string;
        readonly tools: readonly string[];
      }
    | {
        readonly type: "text";
        readonly messageId: string;
        readonly text: string;
        readonly block?: number;
      }
    | {
        readonly type: "reasoning";
        readonly messageId: string;
        readonly text: string;
        readonly block?: number;
      }
    | {
        readonly type: "reasoning_block";
        readonly messageId: string;
        readonly block: ReasoningBlock;
      } // J1.24: closed, with provenance+binding
    | {
        readonly type: "tool_call_start";
        readonly messageId: string;
        readonly callId: string;
        readonly name: string;
      }
    | {
        readonly type: "tool_call_delta";
        readonly messageId: string;
        readonly callId: string;
        readonly args: string;
      }
    | {
        readonly type: "usage";
        readonly messageId: string;
        readonly usage: Usage;
        readonly systemTokens: number;
      }
    | {
        readonly type: "round_end";
        readonly messageId: string;
        readonly stopReason: string;
        readonly truncated: boolean;
        readonly dropped: boolean;
        readonly error?: TurnError;
      }
    | {
        readonly type: "tool_start";
        readonly callId: string;
        readonly name: string;
        readonly interactive: boolean;
        readonly readOnly: boolean;
      }
    | {
        readonly type: "interaction_request";
        readonly callId: string;
        readonly request: InteractionRequest;
      }
    | {
        readonly type: "interaction_settled";
        readonly callId: string;
        readonly response: InteractionResponse | null;
      } // null = cancelled
    | { readonly type: "tool_progress"; readonly callId: string; readonly progress: JsonValue }
    | { readonly type: "write"; readonly callId: string; readonly write: AiWrite }
    | {
        readonly type: "tool_result";
        readonly callId: string;
        readonly messageId: string;
        readonly toolMessageId: string;
        readonly result: ToolResult;
      }
    | { readonly type: "checkpoint"; readonly checkpoint: TurnCheckpoint } // J1.22
    | { readonly type: "turn_end"; readonly outcome: TurnOutcome }
  );

export interface TurnOutcome {
  readonly kind: TurnOutcomeKind;
  readonly turnId: string;
  readonly anchorMessageId: string | null; // last DRAWN assistant message of the turn (the cap message counts) (D6)
  readonly rounds: number;
  readonly workRounds: number;
  readonly writes: readonly AiWrite[];
  readonly usage: { readonly last: Usage | null; readonly total: Usage | null };
  readonly appended: readonly ChatMessage[]; // final form of everything this turn added
  readonly cap?: { readonly messageId: string; readonly text: string };
  readonly removedMessageId?: string; // error/cancel: the failed round's partial (D5, I11)
  readonly error?: TurnError; // message unchanged, so VIEW:105-120 advice still matches
  readonly checkpoint?: TurnCheckpoint;
}

// J1.22: plain JSON; stored by the host in the SAME write as the conversation
export interface TurnCheckpoint {
  readonly v: 1;
  readonly turnId: string;
  readonly sessionId: string | null;
  readonly createdAt: number;
  readonly model: { readonly family: ProviderFamily; readonly model: string };
  readonly catalogDigest: string;
  readonly policyDigest: string;
  readonly systemDigest: string;
  readonly round: number;
  readonly workRounds: number;
  readonly appended: readonly ChatMessage[];
  readonly pending: {
    readonly messageId: string;
    readonly calls: readonly { callId: string; name: string; argumentsText: string }[];
    readonly next: number;
  } | null;
  readonly awaiting: { readonly callId: string; readonly request: InteractionRequest } | null;
  readonly writes: readonly AiWrite[];
  readonly applied: readonly string[];
  readonly errors: readonly string[];
  readonly reason: SuspendReason;
}
export function checkResume(
  checkpoint: TurnCheckpoint,
  input: TurnInput,
): { ok: true } | { ok: false; reason: string };

// J1.28
export interface CompactionPolicy {
  readonly mode: "off" | "keep-tail" | "summarize";
  readonly thresholdRatio: number;
  readonly keepRecent: number;
}
export function summarizeForCompaction(
  model: ModelFn,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<string>;
```

**The core algorithm.** This is `tool-executor.ts:64-273` with the fixes of J1.4, J1.5 and J1.7 already applied, so J1.11 changes nothing.

1. **Setup.**
   - `run.signal` is armed synchronously and linked to `input.signal`.
   - The lock is acquired, or `LaneBusyError`.
   - Emit `turn_start`.
   - If the signal is already aborted, emit `turn_end{cancelled}` with no model call.
2. **Rounds.** For round 1 up to `maxRounds`, while `workRounds < maxWorkRounds`:
   1. Abort check, then `round_start` (with `firstMessageId` for round 1).
   2. `plan = beforeRound()`. The tools are `plan.tools`, or else the per-round list (`fromOpenAITools(tools.listForLLM())`) or the stable list (`tools.list()` projected to specs).
   3. In the append layout, `plan.context` is appended once when it changed.
   4. Stream `model({system, messages, tools}, signal)`. Map the frames to events.
      - `usage` carries `systemTokens = estimateTokens(joinSystem(system))`.
      - Unknown frame types are ignored.
      - With no `done`, the round is truncated (the message gets `meta.incomplete:"truncated"`).
   5. **Error frame.** Call `onStreamError`.
      - If its code is in `suspendOn`, checkpoint and suspend (J1.22).
      - Otherwise emit `round_end{error, dropped:true}` and `turn_end{error, removedMessageId}`.
   6. Otherwise emit `round_end`. The message is kept only if it is drawn (I1).
   7. **End of turn.** If there were no calls, or `stopReason === "cancelled"`, or the signal is aborted, end:
      - `cancelled` if aborted or cancelled;
      - `complete` if any round drew something;
      - otherwise `empty` (an error row with `emptyText` under `emptyTurn:"error"`).
   8. **Each call, in stream order.** With `parallelReadOnly`, a maximal run of `readOnly && !interactive && !interaction` calls executes concurrently, and results are emitted in call order.
      - Abort check.
      - `tool_start`, then `beforeTool`.
      - `linkCallSignal`.
      - `invokeTool`.
      - On `needs_input`, per strategy:
        - **inline:** emit `interaction_request`, race `resolve()` against the signal (an abort gives `interaction_settled{null}` and `turn_end{cancelled}`), emit `interaction_settled`, then re-invoke with the response.
        - **suspend:** checkpoint, then `turn_end{suspended}`.
        - **none:** refuse.
      - `release()`, then `afterTool`.
      - Emit a `write` for each ledger entry, append the tool message, and emit `tool_result`.
      - A call is **applied** (`appliedSignal:"write"`) when it succeeded, has a summary, and recorded at least one `ok` write.
   9. `workRounds` increments if any non-interactive call ran. Abort check (D3).
3. **Cap.**
   - If anything was applied, append the harness cap message (`meta.origin:"harness", kind:"round_cap"`) and emit `turn_end{cap_partial}`.
   - Otherwise emit `turn_end{cap_failed, error:{message: capText}}`.
4. **Finally.** Release the lock. Nothing is emitted after `turn_end`.

### 3.5 `@jxsuite/ai/catalog` (J1.20; extended in J1.21 and J1.22)

```ts
import type {
  ToolDefinition,
  ToolRegistry,
  ApprovalDecision,
  ToolAnnotations,
  Undoability,
  InteractionRequest,
} from "./tools";

export const TOOL_NAME_PATTERN: RegExp; // /^[a-zA-Z0-9_-]{1,64}$/ (M-1)
export interface Catalog {
  readonly entries: readonly ToolDefinition[]; // stable insertion order (M-6)
  get(name: string): ToolDefinition | undefined;
  digest(): string; // names plus schemas plus annotations (checkpoints, replay keys)
}
/** Throws CatalogError on: an invalid or duplicate name (F9), a non-object inputSchema root (M-2), missing annotations or title. */
export function createCatalog(...groups: readonly (readonly ToolDefinition[])[]): Catalog;
export class CatalogError extends Error {
  readonly code: "name" | "duplicate" | "schema" | "annotations";
}

/** Per-call refusal. `args` is null at listing time; argument-addressed hosts resolve the document from args (J2-2). */
export type Gate = (
  entry: ToolDefinition,
  args: Readonly<Record<string, unknown>> | null,
) => string | null;
export interface CatalogView {
  readonly gate?: Gate;
  /** Host-supplied requirement sentences, keyed by tier (Studio passes TIER_REQUIREMENTS, DA:154-165). */
  readonly requires?: Readonly<Record<string, string>>;
  /** Per-round advertisement refinement (Studio: tier gate, empty-required-enum withholding, §3.6). Never membership. */
  readonly advertise?: (entry: ToolDefinition) => boolean;
  /** Static host capabilities; entries needing others are not members (M-9, §3.5 "tier AND capability"). */
  readonly capabilities?: ReadonlySet<string>;
}
/** The view the loop consumes. listForLLM = advertised; list = members; refusal/execute = the gate at call time. */
export function catalogRegistry(catalog: Catalog, view?: CatalogView): ToolRegistry;
/** Members as neutral specs with static schemas (derived enums become plain strings, M-9). */
export function stableSpecs(catalog: Catalog, view?: CatalogView): import("./messages").ToolSpec[];

export interface ApprovalFacts {
  readonly documentUndo: boolean;
  readonly trusted: ReadonlySet<string>;
}
export type ApprovalPolicy = (
  entry: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
) => ApprovalDecision;
export const proceedAlways: ApprovalPolicy;
/** readOnly or trusted → proceed; interaction → proceed; destructive && undoable !== "document" → confirm;
 *  undoable === "none" && !readOnly → confirm; openWorld → confirm; otherwise proceed. No name lists, no LLM classifier. */
export function confirmIrreversible(facts: () => ApprovalFacts): ApprovalPolicy;

/** MCP's jsonSchemaValidator shape (M-18). */
export interface Validator {
  getValidator<T>(
    schema: object,
  ): (
    input: unknown,
  ) =>
    | { valid: true; data: T; errorMessage?: undefined }
    | { valid: false; data?: undefined; errorMessage: string };
}
export function cachedValidator(
  compile: (
    schema: object,
  ) => (input: unknown) => ReturnType<ReturnType<Validator["getValidator"]>>,
): Validator; // WeakMap by schema identity

// Pure MCP projection (no SDK import, M-19)
export interface McpToolJson {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  outputSchema?: object;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  }; // all explicit (M-4)
  _meta?: {
    "com.jxsuite/undoable"?: Undoability;
    "com.jxsuite/tier"?: string;
    "com.jxsuite/capabilities"?: string[];
  };
}
export function toMcpTool(
  entry: ToolDefinition,
  facts: { readonly undoable: Undoability },
): McpToolJson;
export function toCallToolResult(result: import("./tools").ToolResult): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}; // text = summary, then JSON (M-7)
export function toElicitation(request: InteractionRequest): {
  message: string;
  requestedSchema: object;
}; // flat enums only (M-15)
export function fromElicitation(
  request: InteractionRequest,
  reply: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> },
): import("./tools").InteractionResponse | null;

// J1.22: small, per-invocation, travels in MCP requestState (HMAC-bound by the adapter, M-13)
export interface InvocationState {
  readonly v: 1;
  readonly callId: string;
  readonly tool: string;
  readonly argsDigest: string;
  readonly stage: "approval" | "question";
  readonly request: InteractionRequest;
  readonly issuedAt: number;
  readonly principal?: string;
}
```

### 3.6 `@jxsuite/ai/jx-tools` (J1.16; file tools and twins in J1.25)

```ts
import type { JxDocOp } from "@jxsuite/schema/doc-ops";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import type {
  JSONSchema,
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolResult,
  Undoability,
  Actor,
} from "./tools";

export type SelectionEffect =
  | { readonly kind: "keep" } // set_*, add_state, update_state
  | { readonly kind: "prune"; readonly under: readonly JxPath[] } // delete; set_text/children replacement (decision 6)
  | { readonly kind: "select"; readonly paths: readonly JxPath[] } // duplicate: the clones in document order
  | { readonly kind: "follow"; readonly from: JxPath; readonly to: JxPath }; // move: POST-move path (bug 5)
export type DocEdit =
  | {
      readonly ok: true;
      readonly ops: readonly JxDocOp[];
      readonly summary: string;
      readonly selection: SelectionEffect;
    }
  | { readonly ok: false; readonly error: string };
export type DocToolName =
  | "set_property"
  | "set_style"
  | "set_text"
  | "add_child"
  | "move_node"
  | "add_state"
  | "update_state"
  | "duplicate_node"
  | "delete_node";
export interface DocTool {
  readonly name: DocToolName;
  readonly description: string; // verbatim from ai-tools.ts (rule 7)
  readonly parameters: JSONSchema; // verbatim
  readonly annotations: ToolAnnotations;
  /** Pure. Returns exactly the ops today's mutator records (doc-ops map §2), with J1.15's refusals. */
  readonly edit: (doc: Readonly<JxMutableNode>, args: Readonly<Record<string, unknown>>) => DocEdit;
}
export const DOC_TOOLS: readonly DocTool[];
/** Canonical /^(0|[1-9]\d*)$/ strings → integers; integers pass; anything else → null (F4, bug 7). */
export function coerceIndex(value: unknown): number | null;

export interface DocumentRef {
  readonly id: string;
  readonly path: string | null;
}
export interface EditMeta {
  readonly actor: Actor;
  readonly callId: string;
  readonly tool: string;
  readonly coalesceKey?: string | null;
}
export type EditReceipt =
  | { readonly applied: true; readonly changed: boolean }
  | {
      readonly applied: false;
      readonly reason: "frozen" | "refused" | "invalid" | "not-open";
      readonly message: string;
    };
export interface DocumentHost {
  readonly undoable: Undoability; // Studio/DO "document"; headless "none" → validate BEFORE commit (§3.1)
  /** Current document (Studio) or the `document` argument (MCP). A string is the refusal sentence. */
  resolve(ctx: ToolContext, path?: string): DocumentRef | string;
  snapshot(ref: DocumentRef): Readonly<JxMutableNode> | null; // raw, never a reactive proxy
  /** MUST read, call `produce`, and mutate synchronously, with no await between them (H-6).
   *  A returned promise may settle later for persistence only. */
  edit(
    ref: DocumentRef,
    produce: (doc: Readonly<JxMutableNode>) => DocEdit,
    meta: EditMeta,
  ): EditReceipt | Promise<EditReceipt>;
}
export interface WriteReporter {
  before(ref: DocumentRef): Promise<unknown>; // Studio: snapshotBeforeWrite
  after(ref: DocumentRef, before: unknown, summary: string): Promise<ToolResult>; // Studio: reportDocumentWrite
}
export const FROZEN_SENTENCE: string; // ai-tools.ts:88-95 verbatim
export function docToolEntries(
  host: DocumentHost,
  options: {
    readonly reporter: WriteReporter;
    readonly names?: readonly (DocToolName | "read_document")[];
    /** "argument" adds a required static `document` property (MCP carries state in arguments). Studio keeps "current". */
    readonly addressing?: "current" | "argument";
  },
): ToolDefinition[];

// J1.25
export type HostFailureReason =
  | "not_found"
  | "outside_root"
  | "binary"
  | "too_large"
  | "needs_credential"
  | "read_only"
  | "co_edited"
  | "conflict";
export interface ProjectHost {
  readonly capabilities: ReadonlySet<
    "write" | "contentSearch" | "refactorReferences" | "listStarters"
  >;
  list(
    dir: string,
    o?: { signal?: AbortSignal },
  ): Promise<
    | { ok: true; entries: readonly { name: string; path: string; type: "file" | "directory" }[] }
    | { ok: false; reason: HostFailureReason; message: string }
  >;
  read(
    path: string,
    o?: { signal?: AbortSignal; maxBytes?: number },
  ): Promise<
    | { ok: true; text: string; truncated: boolean }
    | { ok: false; reason: HostFailureReason; message: string }
  >;
  write(
    path: string,
    text: string,
    o?: { signal?: AbortSignal; ifAbsent?: boolean },
  ): Promise<
    { ok: true; created: boolean } | { ok: false; reason: HostFailureReason; message: string }
  >;
  search(
    query: string,
    o?: { signal?: AbortSignal; limit?: number },
  ): Promise<
    | { ok: true; paths: readonly string[]; mode: "path" | "content" }
    | { ok: false; reason: HostFailureReason; message: string }
  >;
  schemas(): Promise<{ readonly document: object; readonly project: object } | null>;
}
/** Moved from ai-project-tools.ts:46-61. EVERY file tool calls it (F5); hosts still enforce containment. */
export function normalizeProjectPath(
  rel: string,
): { ok: true; path: string } | { ok: false; error: string };
export interface DocumentValidator {
  document(doc: unknown, path?: string | null): Promise<string[]>;
  project(config: unknown): Promise<string[]>;
}
export function createDocumentValidator(
  validator: import("./catalog").Validator,
  schemas: () => Promise<{ document: object; project: object }>,
): DocumentValidator;
/** Pure verdict: new errors only (the half of ai-write-report.ts with no DOM and no Vue), golden-tested against Studio's text. */
export function reportWrite(input: {
  before: unknown;
  after: unknown;
  summary: string;
  validator: DocumentValidator;
}): Promise<ToolResult>;
export function projectToolEntries(
  host: ProjectHost,
  options: { readonly validator: DocumentValidator; readonly documentHost?: DocumentHost },
): ToolDefinition[];
export function portableTwins(host: {
  readonly documents: DocumentHost;
  readonly project?: ProjectHost;
  readonly overlayTags?: () => { popover: readonly string[]; dialog: readonly string[] };
  readonly pageRoutes?: () => Promise<string[]>;
}): ToolDefinition[];
// delete_node, duplicate_node, check_accessibility, check_popovers, validate_redirects, add_project_locale
export const JX_TOOL_FACTS: Readonly<
  Record<
    string,
    {
      readonly annotations: ToolAnnotations;
      readonly tier: string;
      readonly effect: "none" | "ui" | "document" | "project" | "disk";
    }
  >
>; // all 29 names
```

**The tree tool `execute`.** Studio's order is kept, so a refused call costs no validation:

1. `ref = host.resolve(ctx, args.document)`. A string is returned as `toolError`.
2. `pre = tool.edit(host.snapshot(ref), args)`. A failure is returned as `toolError(pre.error)`, with no ledger entry. This is today's pre-check order (AT:241-244, then `applyAndValidate`).
3. `before = await reporter.before(ref)`.
4. `receipt = await host.edit(ref, doc => tool.edit(doc, args), meta)`. `produce` runs again atomically.
   - `frozen` returns `FROZEN_SENTENCE`.
   - `invalid` returns its message.
5. `ctx.ledger.record({path: ref.path ?? "(untitled)", tool, disk: host.undoable === "none", ok: true, target: ref.id})`.
6. `return reporter.after(ref, before, summary)`.

Studio never registers `duplicate_node` or `delete_node` from `DOC_TOOLS` on the hand side. The hand-first lookup (`ai-command-tools.ts:508-513`) would shadow the command projections, which remain Studio's twins.

**`JX_TOOL_FACTS`**. Columns are readOnly/destructive/idempotent/openWorld, then effect.

| Group                | Tools                                                                       | Facts             |
| -------------------- | --------------------------------------------------------------------------- | ----------------- |
| Interaction          | `ask_user`                                                                  | T/F/F/F, none     |
| Reads                | `list_files`, `read_file`, `search_files`, `list_starters`, `read_document` | T/F/T/F, none     |
| Checks               | `check_accessibility`, `check_popovers`, `validate_redirects`               | T/F/T/F, none     |
| Disk overwrites      | `write_file`, `create_component`, `create_page`                             | F/T/T/F, disk     |
| Bootstrap            | `create_project`, `import_site`                                             | F/F/F/T, disk     |
| Tree, idempotent     | `set_property`, `set_style`, `set_text`, `add_state`, `update_state`        | F/F/T/F, document |
| Tree, not idempotent | `add_child`, `move_node`, `duplicate_node`                                  | F/F/F/F, document |
| Delete               | `delete_node`                                                               | F/T/F/F, document |
| UI                   | `select_node`, `set_canvas_mode`, `open_document`                           | F/F/T/F, ui       |
| Project config       | `add_project_locale`, `disable_extension`                                   | F/F/T/F, project  |
| Install              | `enable_extension`                                                          | F/T/T/T, disk     |

### 3.7 `@jxsuite/ai/gateway` (J1.17 extraction; J1.18 behaviour; v2 in J1.19)

```ts
import type { ProblemDetails, AiModelsResponse } from "@jxsuite/protocol";
export const WIRE_VERSIONS: readonly number[]; // [1] until J1.19, then [1, 2]
export interface OpenAICompatQuirks {
  // B graft; J1.18 fixtures
  readonly reasoningField?: "reasoning_content" | "reasoning";
  readonly cachedTokensPaths?: readonly string[]; // default ["prompt_tokens_details.cached_tokens"]; DeepSeek "prompt_cache_hit_tokens"
  readonly callKey?: "index" | "index-then-position";
  readonly newCallOn?: "id" | "id-change"; // J1.18 default "id-change": an id repeated on every chunk no longer restarts the call
  readonly contextWindow?: (model: Record<string, unknown>) => number | undefined; // Workers AI string property (G-11)
  readonly toolSupport?: (model: Record<string, unknown>) => boolean | undefined;
}
export interface Upstream {
  readonly family: "openai-compat" | "anthropic"; // anthropic from J1.24
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly managed: boolean;
  readonly quirks?: OpenAICompatQuirks;
  readonly headers?: Readonly<Record<string, string>>;
}
export interface GatewayRefusal {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly code?: string;
}
export interface ChatAdmission {
  readonly wire: 1 | 2;
  readonly model: string;
  readonly messageCount: number;
  readonly bytes: number;
}
export interface ChatGatewayOptions<C> {
  admit?(request: Request, context: C): Promise<GatewayRefusal | null> | GatewayRefusal | null; // rate limit, before the body is read
  resolveUpstream(request: Request, context: C): Promise<Upstream | GatewayRefusal>; // SSRF / key provenance are the server's policy here (G-2)
  readonly maxBodyBytes?: number; // measured on bytes actually read (platform 1 MB)
  readonly maxMessages?: number; // counted on the neutral model (H17; platform 200)
  onAccepted?(admission: ChatAdmission, upstream: Upstream, context: C): void; // audit
  upstreamErrorCode?(status: number, upstream: Upstream): string | undefined; // managed 401/403 → cf_reconnect_required (G-5)
  readonly wire?: readonly number[];
  readonly providers?: {
    readonly anthropic?: (upstream: Upstream, f: typeof fetch) => import("./providers").Provider;
  };
  readonly fetch?: typeof fetch; // resolved per call (P-6)
}
/** Order: admit → resolveUpstream → read (400 problem on invalid JSON) → messages array → limits → onAccepted → stream.
 *  v1 body → openai-compat forwarded verbatim (G-8). `wire:2` accepted iff `wire` includes 2, else 400 wire-unsupported. */
export function createChatHandler<C extends { readonly signal: AbortSignal }>(
  options: ChatGatewayOptions<C>,
): (request: Request, context: C) => Promise<Response>;
/** Always 200 (§2.1). Sets `wire` and `limits`. Omits non-positive contextWindow (G-6). */
export function modelsResponse(
  body: Omit<AiModelsResponse, "wire" | "limits">,
  options: { wire: readonly number[]; limits?: AiModelsResponse["limits"] },
): Response;
/** THE normaliser (G-1): the server's, moved verbatim in J1.17; the client adopts it in J1.18. */
export function normalizeOpenAIStream(
  response: Response,
  options: {
    readonly wire: 1 | 2;
    readonly signal: AbortSignal;
    readonly quirks?: OpenAICompatQuirks;
    readonly model?: string;
  },
): AsyncGenerator<WireEvent>;
export function encodeSse(events: AsyncIterable<WireEvent>): ReadableStream<Uint8Array>; // `data: <json>\n\n`
/** application/problem+json with `error` and `code` aliases; one body satisfies both client parsers (G-4). */
export function problemResponse(refusal: GatewayRefusal): Response;
/** Hand validator for v2 bodies; tested against the generated schema (ajv is a devDependency only). Returns the first failing pointer. */
export function checkChatRequestV2(body: unknown): string | null;
```

### 3.8 `@jxsuite/ai/providers` (openai-compat in J1.19, anthropic in J1.24)

```ts
export interface ProviderRequest {
  readonly model: string;
  readonly system: readonly SystemBlock[];
  readonly messages: readonly WireMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens?: number;
  readonly temperature?: number;
}
export interface Provider {
  readonly family: ProviderFamily;
  capabilities(model: string): ProviderCapabilities;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<WireEvent>;
}
/** Same body builder and normaliser as createOpenAIStreamingClient (one module). */
export function createOpenAICompatProvider(options: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly quirks?: OpenAICompatQuirks;
  readonly fetch?: typeof fetch;
}): Provider;
export function createAnthropicProvider(options: {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly version?: string;
  readonly defaultMaxTokens: number; // max_tokens is required (A5)
  readonly thinking?: Record<string, unknown>; // passthrough, e.g. {type:"adaptive"}
  /** Sent only where the platform offers thinking-binding-controls-2026-08-01. Explicit, never the default. */
  readonly bindingControls?: { readonly prefixMismatch: "drop_block" | "error" };
  readonly fetch?: typeof fetch;
}): Provider;
export function toAnthropicRequest(
  request: ProviderRequest,
  options: { readonly defaultMaxTokens: number },
): Record<string, unknown>;
export function anthropicToolId(id: string, messageIndex: number): string; // deterministic remap onto ^[a-zA-Z0-9_-]+$ (H10)
/** A ModelFn over a provider (headless and evals). */
export function providerModel(provider: Provider, model: string): import("./harness").ModelFn;
```

**Anthropic projection rules.** Each rule has a recorded fixture.

1. Assistant blocks are projected **in order**: `thinking{thinking, signature}`, `redacted_thinking{data}`, `text` and `tool_use{id, name, input}`. `input` is `parseToolInput(argumentsText)`, or `{}` when that fails; a call that failed to parse already has an error result.
2. **Replay rule** (fixes J3-3):
   - Compute `bindingOf(request, wire, i)` for each assistant message.
   - Signed anthropic-family blocks are sent **unchanged whatever their model**, because the API drops blocks another model cannot read.
   - Only the **trailing run** whose recorded binding equals the current binding is kept. The stale leading run is removed, which the chain rule allows.
   - Unsigned or openai-compat reasoning is never sent.
   - With `bindingControls`, set `thinking.block_binding.prefix_mismatch_behavior` explicitly, and report `input_transformations` as `stream_start.droppedThinking`.
   - Without it, a 400 matching "bound to a different conversation" is retried **once** with every thinking and redacted block stripped.
3. Contiguous `tool` messages become **one** `user` message of `tool_result{tool_use_id, content, is_error}` blocks, placed first.
4. Leading non-user messages are dropped pair-safely (H4). A trailing assistant message is never sent (no prefill).
5. `cache_control` goes on the last `SystemBlock` with `cache`, the last tool and the last user message, at most 4 (A6). Tools render in catalog order.
6. Harness `context` messages become `{role:"system"}` when `midConversationSystem`, otherwise a text block after the `tool_result` blocks of the next user message.
7. Usage: `inputTokens = input + cache_read + cache_creation`, `cachedInputTokens = cache_read`, `cacheWriteInputTokens = cache_creation`.
8. Stop reasons: `end_turn` and `stop_sequence` become `stop`, `max_tokens` becomes `length`, `tool_use` becomes `tool_calls`, and `pause_turn` and `refusal` pass through. A stream with no `message_stop` gives `done{stop, truncated}`.
9. "Prompt is too long" becomes `problem.type = contextOverflow`. This is the only text match in the codebase (G-12).
10. Capabilities: `{family:"anthropic", promptLayout:"append", toolListing:"stable", requiresMaxTokens:true, maxCacheBreakpoints:4, midConversationSystem: per model}`.

### 3.9 `@jxsuite/ai/sessions` (J1.23)

```ts
export const SESSION_LIMITS: {
  readonly sessions: 20;
  readonly messages: 50;
  readonly titleChars: 60;
};
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
export type SaveResult =
  | { readonly ok: true; readonly meta: SessionMeta }
  | {
      readonly ok: false;
      readonly reason: "not_in_index" | "quota" | "unavailable";
      readonly message: string;
    }; // never swallowed (H11)
export interface SessionStore {
  readonly durable: boolean; // false in evals (ephemeral)
  list(root: string): Promise<SessionMeta[]>; // updatedAt descending; enumerated through the index (H3)
  load(root: string, id: string): Promise<LiveMessage[] | null>; // always through migrateTranscript (idempotent, every read: H12)
  save(root: string, id: string, messages: readonly LiveMessage[]): Promise<SaveResult>; // persistWindow + title + count
  create(root: string, firstText: string): Promise<SessionMeta>; // evicts past SESSION_LIMITS.sessions
  remove(root: string, id: string): Promise<void>;
  move(fromRoot: string, toRoot: string, id: string): Promise<void>; // bootstrap re-key; delete-first so a re-run is safe
  getActive(root: string): Promise<string | null>;
  setActive(root: string, id: string | null): Promise<void>;
}
export function createMemorySessionStore(): SessionStore;
```

The localStorage store, and later the IndexedDB and desktop-RPC stores, live in `st/services/`, so no DOM type reaches `@jxsuite/ai` (P-3). The payload remains a **bare array** that today's build loads (S1).

### 3.10 `@jxsuite/ai/testing` (J1.18; extended in J1.19 and J1.22)

```ts
export function scriptedModel(
  rounds: readonly (readonly WireEvent[])[],
): ModelFn & { readonly requests: ModelRequest[] };
export interface Cassette {
  readonly v: 1;
  readonly entries: readonly { key: string; request: unknown; events: WireEvent[] }[];
}
export function requestKey(request: ModelRequest): string; // digest(canonicalJson(...)) without ids/timestamps/meta
export function recordingModel(
  inner: ModelFn,
  sink: (entry: Cassette["entries"][number]) => void,
): ModelFn;
/** A miss yields an error frame {code:"replay_miss"} (onMiss "error") or fails the test (onMiss "throw"). */
export function replayModel(cassette: Cassette, options?: { onMiss?: "error" | "throw" }): ModelFn;
export interface UpstreamFixture {
  readonly status: number;
  readonly sse?: string;
  readonly body?: string;
  readonly abortAfterBytes?: number;
}
export function fakeUpstream(fixtures: readonly UpstreamFixture[]): typeof fetch;
export interface ConformanceCase {
  readonly id: string;
  run(gateway: {
    chat(r: Request): Promise<Response>;
    models(r: Request): Promise<Response>;
    installUpstream(f: typeof fetch): void;
  }): Promise<void>;
}
/** Shared by packages/ai, packages/server/tests/ai-api.test.ts and P/tests/ai-routes.test.ts. Throws AssertionError; imports no runner. */
export function gatewayConformanceCases(options?: {
  wire?: readonly number[];
  managed?: boolean;
}): ConformanceCase[];
export function createMemoryHarnessHost(): {
  documents: import("./jx-tools").DocumentHost;
  project: import("./jx-tools").ProjectHost;
  checkpoints: Map<string, unknown>;
}; // J1.22
```

### 3.11 `@jxsuite/ai/chat-state` (additive)

| Change                                                                                                                                                           | Slice |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `appendToolResult(id, result)` finds the record on the request directly before the trailing tool replies (D1); `setError` clears `pendingToolCalls`              | J1.4  |
| `Message` becomes `LiveMessage` (structurally identical plus optional `blocks`/`meta`); `toMessagesArray()` becomes `toOpenAIMessages(toChatMessages(messages))` | J1.10 |
| `beginAssistantTurn(id?: string)`, `pushToolResultMessage(toolCallId, content, id?: string)`                                                                     | J1.11 |
| `setError(message, code?: string)`, `ChatStore.errorCode: string \| null`                                                                                        | J1.18 |
| `appendReasoningBlock(block: ReasoningBlock)`                                                                                                                    | J1.24 |

### 3.12 `@jxsuite/schema/doc-ops` (J1.1, extended in J1.15)

J1.1 as it stands, with no signature changes. In J1.15, `inverseOf` also throws:

- `doc-op-index:<path>` for any non-integer index (defence in depth, since producers coerce first);
- `doc-op-not-a-node:<path>` for a `set-key` whose target is an array, a string or null.

J1.15 also moves in, next to it: `structuralBatch`, `isSpliceablePath`, `isAncestor` and `shiftPrefixedIndex` (from `st/tabs/selection.ts:233-257` and `transact.ts:65-84`), which Studio then re-imports.

**Clamp-and-record stays, and so do the into-self refusal and the `children: []` residue.**

### 3.13 Studio seams (outside `@jxsuite/ai`)

```ts
// st/tabs/transact.ts
/** J1.1 contract this design integrates with (doc-ops map §4). If J1.1 lands returning boolean, J1.16 widens it additively. */
export type ApplyDocOpsResult = "applied" | "unchanged" | "refused";
export function applyDocOpsAsUser(
  tab: Tab,
  ops: readonly JxDocOp[],
  options?: {
    readonly actor?: ActorRef | null; // J1.13
    readonly selection?: SelectionEffect; // J1.16: applied inside the same mutation (rollback restores it)
    readonly coalesceKey?: string | null;
  },
): ApplyDocOpsResult;
// internal (J1.1 acceptance): applyDocOp(tab, op, inverse) records the REAL inverse; `inverse: op` (:433) is gone.

export interface ActorRef {
  readonly kind: "user" | "assistant" | "remote";
  readonly id: string;
  readonly turnId?: string;
}
export interface TransactOptions {
  skipHistory?: boolean;
  origin?: "user" | "history" | "remote";
  coalesceKey?: string | null;
  actor?: ActorRef | null;
}
/** Synchronous-only attribution scope for command projections; reset in finally before any await resumes (J1.13). */
export function runAsActor<T>(actor: ActorRef, fn: () => T): T;

export interface BatchLane {
  // J1.13, replaces _batchTab/beginBatch/endBatch/batchTab/reanchorBatch
  readonly owner: ActorRef;
  /** Close every open segment now (one ops-based entry per tab that RECORDED something); lane stays usable. */
  flush(): void;
  /** Flush and retire; returns where each entry landed, for Restore (D8). */
  close(): readonly { readonly tab: Tab; readonly entryIndex: number; readonly turnId: string }[];
}
export function openBatchLane(owner: ActorRef): BatchLane;
export function isBatched(tab: Tab, actor?: ActorRef | null): boolean; // replaces isBatching() at TX:265 and COLLAB:285
export function flushOpenBatches(): void; // project-adoption.ts:87-99
```

**Lane rules (J1.13).**

- A transaction whose `actor` owns an open lane opens or extends that lane's segment **on that tab**. It skips its own history entry, and its forward and inverse ops accumulate.
- A transaction by **any other actor** on a laned tab first closes the segment:
  - the segment is pushed as one ops-based entry tagged `{actor, turnId}`;
  - collab flushes that tab's buffered owner ops **before** publishing the foreign ops, so the Y document sees them in local order.

  Then the transaction pushes its own entry. The next owner write reopens a segment.

- An untouched tab pushes nothing, which removes the probe's empty snapshot.
- A history-delegate (collab) tab keeps delegating grouping.
- Evals pass no `getTab`, so they get no lane, and each tool is its own entry (SCORE:198-234).

```ts
// st/services/ai-writes.ts (J1.8; batches in J1.14). Removed: beginTurn, recordWrite, endTurn, the `open` slot.
export type { AiWrite } from "@jxsuite/ai/tools";
export interface AiTurn {
  id: string;
  writes: AiWrite[];
  batches?: readonly { tabId: string; entryIndex: number; turnId: string }[];
}
export function fileTurn(
  anchor: string | null,
  writes: readonly AiWrite[],
  batches?: AiTurn["batches"],
): void;
// writesForTurn, summarizeWrites, MAX_TURNS unchanged; resetAiWrites now called by New Chat and close project (F8).

// st/services/harness/interaction-store.ts (J1.21; replaces the ai-ask.ts pending slot, S3)
export interface PendingInteraction {
  readonly callId: string;
  readonly request: InteractionRequest;
}
export interface InteractionStore {
  readonly pending: PendingInteraction | null; // reactive; chip id = callId
  readonly strategy: InteractionStrategy; // { mode: "inline", resolve }
  answer(text: string): boolean;
  skip(): boolean;
  approve(approved: boolean, remember?: "session"): boolean;
  cancel(): void;
  reset(): void;
}
export function createInteractionStore(): InteractionStore;
// st/services/ai-ask.ts keeps only askUserTool(): ToolDefinition (interactive: true, interaction, settle) and registerAskTool(registry).

// st/services/harness/chat-reducer.ts (J1.11)
export function applyHarnessEvent(
  chat: ReturnType<typeof createChatState>,
  event: HarnessEvent,
  file: (anchor: string | null, writes: readonly AiWrite[]) => void,
): void;
// st/services/harness/turn-hooks.ts (J1.11)
export function studioTurnHooks(deps: {
  registry: ToolRegistry;
  reprobe: boolean;
  layout?: "rebuild" | "append";
  context?: () => string;
}): TurnHooks;
// st/services/harness/studio-documents.ts (J1.16)
export function studioDocumentHost(deps: { getTab: () => Tab | null }): DocumentHost; // edit → applyDocOpsAsUser(tab, ops, {actor, selection})
// st/services/tool-executor.ts: runAgentLoop(options) SIGNATURE UNCHANGED; gains optional
//   interactions?: InteractionStore (J1.21), lock?: TurnLock (J1.11), modelInfo?: {family, model} (J1.24).
// st/services/document-assistant.ts: isTurnActive(): boolean (J1.6, backed by TurnLock from J1.11); interactions: InteractionStore (J1.21).
// DELETED: st/services/ai-turn-signal.ts (J1.8).
```

**Reducer mapping.** It reproduces today's call order, proven by the J1.2 traces.

| Event                                       | Chat-state call                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `round_start` (round 1, id = placeholder)   | nothing                                                                                                              |
| `round_start` (otherwise)                   | `beginAssistantTurn(id)`; status goes to streaming before the push (CS:183-186)                                      |
| `text`                                      | `appendDelta`                                                                                                        |
| `reasoning`                                 | `appendReasoning`                                                                                                    |
| `reasoning_block`                           | `appendReasoningBlock`                                                                                               |
| `tool_call_start` / `tool_call_delta`       | `appendToolCallStart` / `appendToolCallDelta`                                                                        |
| `usage`                                     | `recordUsage(usage, {systemTokens})`, before `round_end` (CS:429)                                                    |
| `round_end` with an error                   | `setError(message, code)` (the partial is removed because `finishStream` did not run)                                |
| `round_end` otherwise                       | `finishStream(stopReason)`                                                                                           |
| `tool_result`                               | `appendToolResult(callId, result)`, then `pushToolResultMessage(callId, JSON.stringify(result), toolMessageId)` (I8) |
| `turn_end` `cap_partial`                    | `beginAssistantTurn(cap.messageId)`, `appendDelta`, `finishStream("length")`                                         |
| `turn_end` `cap_failed` / `empty` / `error` | `setError(error.message, error.code)`                                                                                |
| `turn_end` `cancelled`                      | `cancelStream()` (idempotent)                                                                                        |
| every `turn_end`                            | `file(anchor, writes)` in the **same synchronous call** (PANEL:136-154)                                              |
| `interaction_*`                             | the interaction store (keyed by callId)                                                                              |
| `tool_progress`                             | `recordImportProgress(callId, …)`                                                                                    |
| `write`, `tool_start`                       | nothing (relay hosts only)                                                                                           |

### 3.14 `@jxsuite/protocol` (J1.18)

- `AiModelInfo` gains `description?`, `ownedBy?` (fixing the drift), `family?: "openai-compat" | "anthropic"` and `reasoning?: boolean`.
- `AiModelsResponse` gains `wire?: number[]` (absent means `[1]`) and `limits?: {maxMessages?: number; maxBodyBytes?: number}`.
- `PROBLEM_TYPES` gains `contextOverflow` (400), `rateLimited` (429, with `retryAfter` and `scope`) and `wireUnsupported` (400, with `supported`).
- `STUDIO_PROTOCOL_VERSION` stays 1, because the change is additive.

---

## 4. Invariants and the test that enforces each

| #   | Invariant                                                                                                                                                                                                                                      | Enforced by                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| W1  | Worker-safe subpaths import nothing forbidden (§2)                                                                                                                                                                                             | `worker-safety.test.ts` + `typecheck:ai-worker`                              |
| W2  | Root, `./streaming-client`, `./tools` and `./chat-state` keep every export                                                                                                                                                                     | export-snapshot test                                                         |
| W3  | Studio `src` never imports gateway, providers or testing                                                                                                                                                                                       | `ai-import-rules.test.ts`                                                    |
| G0  | Every J1.2 golden (agent traces, v1 transcripts, server frames, sessions, eval TrialResult) changes only in a slice whose spec fragment names the change                                                                                       | `agent-trace.test.ts`, `parity.golden.test.ts`, frame goldens                |
| H1  | Exactly one `streamChat`/`streamTurn` per round, read from `client` at call time                                                                                                                                                               | harness test + RUNEVAL counter                                               |
| H2  | `toOpenAIMessages(toChatMessages(x))` deep-equals the old `toMessagesArray` over the corpus; `toOpenAITools(fromOpenAITools(listForLLM()))` is byte-identical for all 29 tools                                                                 | `messages.test.ts`, studio tool round-trip test                              |
| H3  | Event grammar: `turn_start · (round_start · deltas · usage? · round_end · (tool_start · interaction_*? · write* · tool_result)*)* · turn_end`. `seq` strictly increases, `onEvent` is synchronous and in order, and nothing follows `turn_end` | seeded property test                                                         |
| H4  | No `tool_start` after a cancelled round; no `round_start` or `tool_start` after an abort                                                                                                                                                       | LOOPT:111, 145, 169, plus the D3 test                                        |
| H5  | Results commit in call order under `parallelReadOnly`                                                                                                                                                                                          | reversed-resolution test                                                     |
| H6  | Every executed call has exactly one `tool_result`; an unexecuted one has none                                                                                                                                                                  | harness test                                                                 |
| H7  | Any write implies `anchorMessageId !== null`, and the anchor is a drawn assistant message of this turn                                                                                                                                         | per-outcome test                                                             |
| H8  | Every event survives `JSON.parse(JSON.stringify(e))`                                                                                                                                                                                           | harness test                                                                 |
| H9  | `system` is constant within a turn                                                                                                                                                                                                             | type-level (RoundPlan has no system)                                         |
| H10 | `run.signal` is armed before `runTurn` returns; a second run on a held lock throws synchronously                                                                                                                                               | harness test                                                                 |
| T1  | `ctx.signal` aborts with the turn, and its link is removed when the call settles                                                                                                                                                               | `tools.test.ts` + the F1 repro                                               |
| T2  | `ctx.callId` equals the chip id, the pending-interaction id and the import-run key                                                                                                                                                             | Studio join test                                                             |
| T3  | Studio wrapping registries declare `ctx` **required** and forward `refusal`                                                                                                                                                                    | type-level + an end-to-end ctx probe                                         |
| T4  | No tool body awaits a person: interaction definitions never reach `execute`; approval precedes execution                                                                                                                                       | `invokeTool` tests + a grep test on `st/**` (no `askUser(` inside `execute`) |
| C1  | Catalog names are unique, pattern-valid and stably ordered; hand and command name sets are disjoint                                                                                                                                            | `catalog.test.ts`                                                            |
| C2  | Refusal, cap, parse, unknown and execution-error texts are byte-identical                                                                                                                                                                      | snapshot tests                                                               |
| C3  | For every availability state, Studio's advertised names equal today's `listForLLM()` names                                                                                                                                                     | J1.20 matrix test                                                            |
| D1  | `DocTool.edit` is pure; for an ok edit, `applyDocOpsWithInverse` on a clone never throws, and undo restores a deep-equal document                                                                                                              | seeded property test                                                         |
| D2  | Empty ops mean no transaction (no root swap, snapshot or `publishDiff`)                                                                                                                                                                        | transact test                                                                |
| D3  | Producers emit op-for-op what J1.15's tools recorded                                                                                                                                                                                           | J1.16 op golden                                                              |
| L1  | History skips only for owner ops on that tab; a foreign write closes the segment first; collab flushes owner ops before publishing foreign ones                                                                                                | `ai-lanes.test.ts` + collab-session suites                                   |
| L2  | No history entry for a lane segment that recorded nothing                                                                                                                                                                                      | transact test                                                                |
| X1  | Only a trailing run of signed anthropic blocks whose binding matches is sent                                                                                                                                                                   | provider fixture tests                                                       |
| G1  | The v1 body is accepted verbatim; v2-only frames never go to a v1 request; the upstream body for v1 and v2 of one transcript is byte-identical (openai-compat)                                                                                 | `gateway.test.ts`, fetch spy                                                 |
| G2  | Every error frame carries `problem`; pre-stream failures are problem+json with `code` and `error`                                                                                                                                              | conformance kit                                                              |
| S1  | A payload saved by the new build loads in today's `loadSession`                                                                                                                                                                                | cross-version fixture test                                                   |
| S2  | `migrateTranscript` is idempotent and runs on every read; `repairToolPairs` is idempotent                                                                                                                                                      | property tests                                                               |

---

## 5. Behaviour-preservation table

Columns are: current behaviour, where it lives after Phase 1, spec rule, and slice. Spec rules are `specs/ai.md` unless noted.

### 5.1 The loop (L1 to L24)

| ID       | Today                                                              | Lives now                                                                                                   | Rule        | Slice        |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| L1       | Global ledger `open`                                               | per-turn `WriteLedger` in `ctx.ledger`; `fileTurn` at `turn_end`                                            | §3.2        | J1.8         |
| L2       | Filed under `messages.at(-1)`                                      | `TurnOutcome.anchorMessageId`, the last drawn message (D6)                                                  | §3.2        | J1.4 → J1.11 |
| L3, L4   | `_signal`, `_toolCallId` singletons                                | `ctx.signal` (per-call child), `ctx.callId`                                                                 | §3.4, §3.7  | J1.8         |
| L5-L7    | One global batch, re-anchored after each tool, closed in `finally` | a per-actor `BatchLane`; a segment per tab opened on the owner's first write; ops-based; closed at turn end | §3.3        | J1.13        |
| L8       | `listForLLM()` every round                                         | `beforeRound` default (Studio openai-compat); stable member list for the anthropic family and MCP           | §3.6, §3.10 | J1.11, J1.24 |
| L9       | Prompt fixed per turn                                              | kept (rebuild layout, H9); the append layout freezes it per session and appends context (anthropic)         | §3.8, §2.6  | J1.24        |
| L10      | Direct chat-state calls                                            | `HarnessEvent` plus the Studio reducer through synchronous `onEvent`                                        | §3.8        | J1.11        |
| L11      | `recordUsage` with `systemTokens`                                  | `usage` event; `turn_end.usage.total` added                                                                 | §2          | J1.11        |
| L12      | Status idle while tools run                                        | kept for `status`; "turn active" is a separate fact                                                         | §3.0, §3.4  | J1.6         |
| L13      | A stream error is terminal                                         | kept; the partial message is removed (D5)                                                                   | §3.2        | J1.4         |
| L14      | `cf_reconnect_required` triggers a re-probe                        | `hooks.onStreamError`                                                                                       | §2.1        | J1.11        |
| L15, L16 | Calls decide; Stop between calls                                   | core steps (Phase 0 text)                                                                                   | §2          | unchanged    |
| L17      | Parse failure text                                                 | kept; a non-object gets its own suffix (D9)                                                                 | §3.1        | J1.4         |
| L18      | Serial                                                             | default; `parallelReadOnly` in J1.27                                                                        | §3.4        | J1.27        |
| L19      | `INTERACTIVE_TOOLS`                                                | `ToolDefinition.interactive`                                                                                | §3.4        | J1.8         |
| L20      | 5 work, 25 total; interactive-only rounds free                     | `DEFAULT_TURN_POLICY`                                                                                       | §3.4        | J1.11        |
| L21      | `appendToolResult` dead                                            | it finds the record (D1)                                                                                    | §3.2        | J1.4         |
| L22      | Placeholder pushed after Stop                                      | abort check first (D3)                                                                                      | §2          | J1.4         |
| L23      | Applied means it has a summary                                     | applied means an ok write (`appliedSignal:"write"`, D7)                                                     | §3.2        | J1.7         |
| L24      | Error accumulation                                                 | kept                                                                                                        | —           | —            |

### 5.2 The send path and the panel (S1 to S12)

| ID    | Today                                                               | Lives now                                                                                                         | Rule        | Slice        |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| S1    | Guard only while streaming                                          | `isTurnActive()` / `TurnLock`; Send becomes Stop for the whole turn; Answer wins while an interaction is pending  | §3.0        | J1.6, J1.11  |
| S2    | Lazy session                                                        | kept                                                                                                              | —           | —            |
| S3    | `sendMessage` pushes user plus placeholder                          | kept; the placeholder id is `firstMessageId`                                                                      | §3.8        | J1.11        |
| S4    | Keep-tail `trimContext` at send time                                | kept for openai-compat; summarising compaction for the anthropic family; honours the probe's `limits.maxMessages` | §2.2        | J1.18, J1.28 |
| S5    | Orphan repair after the trim                                        | `repairToolPairs` (adjacency, per message)                                                                        | §3.4        | J1.12        |
| S6    | Persist before and after                                            | kept; `result` stripped on save and backfilled on load                                                            | §3.2, §3.13 | J1.3, J1.23  |
| S7    | Controller after `await aiChatUrl()`                                | controller first, abort checked after each await; later the lazy `chatUrl` plus `TurnRun`                         | §2          | J1.5, J1.11  |
| S8    | Model re-read per send                                              | kept; `meta.model` and `family` stamped on assistant messages                                                     | §2.6        | J1.24        |
| S9    | Synchronous failure calls `setError`                                | kept                                                                                                              | —           | —            |
| S10   | Stop fan-out (abort, `cancelAsk`, `abortImportRun`, `cancelStream`) | abort; the interaction store and per-call signals settle; `cancelStream` stays for immediate feedback             | §3.4        | J1.21        |
| S11   | New Chat resets                                                     | plus `resetAiWrites` (F8) and the session facts                                                                   | §3.2        | J1.8, J1.9   |
| S12   | Hydrate by pushing                                                  | kept; `migrateTranscript` first                                                                                   | §3.13       | J1.23        |
| Panel | Answer keystroke, Retry, `ctx.ai.streaming`/`waiting`               | reads `interactions.pending` and `isTurnActive()`; Retry unchanged                                                | §3.0, §3.4  | J1.6, J1.21  |
| Panel | Restore is `undo(activeTab)` once                                   | undoes each lane entry of the turn while it is the top entry of its tab (D8)                                      | §3.2        | J1.14        |

### 5.3 Module singletons (S1 to S14 of the tools map)

| Singleton                                         | Replacement                                                                          | Slice        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| S1 `_signal`, S2 `_toolCallId`                    | `ctx.signal`, `ctx.callId`; `ai-turn-signal.ts` deleted                              | J1.8         |
| S3 ask pending, settle and the one-question guard | per-assistant `InteractionStore`; serial interaction resolution in the harness       | J1.21        |
| S4 ledger `open`                                  | `ctx.ledger`; `turns[]` stays a Studio UI store, filed at `turn_end`                 | J1.8         |
| S5 `_batchTab`, notifier                          | `BatchLane` per actor, segments per tab                                              | J1.13        |
| S6 transact gate and observer                     | Studio host state, reached only through `transactDoc`/`DocumentHost`                 | unchanged    |
| S7 `imported`                                     | `ctx.session.get/set("import.done")`                                                 | J1.8         |
| S8 import runs                                    | a Studio run store keyed by `ctx.callId`, fed by `ctx.progress`                      | J1.8         |
| S9 brief, S10 adopter                             | constructor-bound services of the Studio-only `import_site`/`create_project` entries | J1.8         |
| S11 active registry                               | Studio host, used by command projections only                                        | unchanged    |
| S12 validator                                     | `DocumentValidator` bound to the tool (ajv in page/Bun, cfworker in Worker)          | J1.16, J1.25 |
| S13 command latches                               | unchanged (Studio-only records)                                                      | —            |

### 5.4 Defects D1 to D16 and findings F1 to F9

| ID       | Decision                                                                                                        | Slice       |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------- |
| D1       | fixed: `appendToolResult` finds the record; restored results are backfilled                                     | J1.3, J1.4  |
| D2       | fixed: one turn per window                                                                                      | J1.6        |
| D3       | fixed: abort check before the next round                                                                        | J1.4        |
| D4       | fixed: Stop armed before the first await; structural with `TurnRun` and the lazy `chatUrl`                      | J1.5, J1.11 |
| D5       | fixed: an error round's partial message is removed (§3.2 already says so)                                       | J1.4        |
| D6       | fixed: anchor on the last drawn message                                                                         | J1.4        |
| D7       | fixed: applied means it wrote                                                                                   | J1.7        |
| D8       | fixed: Restore by turn, across documents, refusing when a foreign entry is on top                               | J1.14       |
| D9       | fixed: distinct non-object sentence                                                                             | J1.4        |
| D10 / F1 | fixed: `{once:true}` plus removal; then structural with per-call signals                                        | J1.5, J1.8  |
| D11      | fixed: `done.truncated`, `meta.incomplete`, calls still run (I9)                                                | J1.18       |
| D12 / F2 | fixed: per-actor lanes with per-tab segments and explicit actors; collab per-tab buffering                      | J1.13       |
| D13      | not fixed, on purpose: the fixed system prompt protects A1 (H9); the append layout makes it moot for Anthropic  | —           |
| D14      | eliminated: D4 plus the harness owns the transcript                                                             | J1.5        |
| D15      | fixed: the panel effect reads `tc.result` and `tokenCount`                                                      | J1.4        |
| D16      | not fixed: `round_end.stopReason` carries it for relay hosts                                                    | —           |
| F3       | kept for parity; Phase 2 rebaseline                                                                             | P2.5        |
| F4       | producers coerce canonical numeric strings; the legacy validator is unchanged; strict 2020-12 at the rebaseline | J1.15, P2.5 |
| F5       | `create_component`/`create_page` call `normalizeProjectPath`; every portable file tool does                     | J1.9, J1.25 |
| F6       | kept for parity; Phase 2 rebaseline                                                                             | P2.5        |
| F7       | `create_project`/`import_site` record `{path: root, disk: true}` (moved forward: applied-means-wrote needs it)  | J1.7        |
| F8       | `resetAiWrites` on New Chat and close project                                                                   | J1.9        |
| F9       | `./tools` still warns; `createCatalog` throws                                                                   | J1.20       |

### 5.5 Conversation invariants (I1 to I17) and persistence hazards (H1 to H17)

| Item    | Where it lives                                                                                                                   | Slice              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| I1-I4   | `toOpenAIMessages`, one function                                                                                                 | J1.10              |
| I5      | raw `argumentsText`; parsed only by the Anthropic adapter                                                                        | J1.10              |
| I6, I10 | `repairToolPairs`                                                                                                                | J1.12              |
| I7      | the answer is `settle(args, response)`, a tool result                                                                            | J1.21              |
| I8      | tool content is `JSON.stringify(normalized ToolResult)`                                                                          | J1.11              |
| I9      | core step                                                                                                                        | —                  |
| I11     | a cancelled round is dropped                                                                                                     | J1.11              |
| I12     | at most one `usage`, before `round_end`                                                                                          | J1.11              |
| I13     | `system` travels separately                                                                                                      | —                  |
| I14     | ids minted by the harness with the chat-state scheme and passed to the reducer; migration assigns once                           | J1.11, J1.23       |
| I15     | the cap message is `meta.origin:"harness"`                                                                                       | J1.11              |
| I16     | D1                                                                                                                               | —                  |
| I17     | inline: one outstanding interaction, in memory, inert after a reload; suspend hosts persist the checkpoint (host clause in §3.4) | J1.21, J1.22       |
| H1, H12 | the bare array stays, with additive fields; shape detection and migration on every read; the index version is untouched          | J1.23              |
| H2      | three generations read                                                                                                           | J1.23              |
| H3      | index-driven enumeration                                                                                                         | —                  |
| H4      | `persistWindow` starts at a user message; the Anthropic adapter enforces user-first                                              | J1.23, J1.24       |
| H5      | backfill                                                                                                                         | J1.3               |
| H6      | `meta.incomplete`                                                                                                                | J1.23              |
| H7      | kinds from id prefixes; new synthetic messages carry `meta.kind`                                                                 | J1.23              |
| H8      | legacy reasoning is openai-compat, never sent to Anthropic                                                                       | J1.10, J1.24       |
| H9      | ids assigned once                                                                                                                | J1.23              |
| H10     | per-message pairing plus the stable id remap                                                                                     | J1.12, J1.24       |
| H11     | strip `result` on save; strip older signatures; `SaveResult` quota                                                               | J1.3, J1.24, J1.23 |
| H13     | `sessionTitle`, count as today                                                                                                   | J1.23              |
| H14     | the ledger, import logs and pending interaction stay in memory (open decision 1)                                                 | —                  |
| H15     | bytes kept                                                                                                                       | —                  |
| H16     | page-run migrations                                                                                                              | J1.23, P2.4        |
| H17     | `maxMessages` counts neutral messages                                                                                            | J1.18              |

### 5.6 Anthropic hazards (A1 to A6)

| Hazard | Resolution                                                                                                                                            | Slice        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A1, A2 | append layout (frozen system plus appended context) and stable listing for the anthropic family; the binding digest strips only the stale leading run | J1.24        |
| A3     | keep-tail trim and seals change prefixes; the trailing-run rule plus summarising compaction for anthropic                                             | J1.24, J1.28 |
| A4     | blocks are passed back unchanged across model switches (the API drops unreadable ones); provenance is stamped                                         | J1.24        |
| A5     | `maxTokens` / `defaultMaxTokens`                                                                                                                      | J1.24        |
| A6     | `SystemBlock.cache`, at most 4 breakpoints                                                                                                            | J1.24        |

### 5.7 Doc-op bugs and decisions (doc-ops map §7)

| Item                                                         | Decision                                                                                                                                                                                         | Slice       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Bug 1: `add_child` index                                     | Negative or non-canonical: refused. Past the end: clamped; the recorded forward carries the clamped value (the Y applier no longer throws, so no diff fallback). The undo slot is exact already. | J1.1, J1.15 |
| Bug 2: `move_node` past the end                              | clamped to the valid maximum; inverse exact                                                                                                                                                      | J1.1, J1.15 |
| Bug 3: move into own subtree                                 | refused (a clean pre-check sentence replacing J1.1's `doc-op-move-into-self` execution error)                                                                                                    | J1.1, J1.15 |
| Bug 4: string index or `$switch` path                        | canonical strings coerced; unspliceable paths refused (no phantom success)                                                                                                                       | J1.15       |
| Bug 5: nested-move selection                                 | post-move coordinates                                                                                                                                                                            | J1.15       |
| Bug 6: `set_property` target                                 | must be a plain-object node                                                                                                                                                                      | J1.15       |
| Bug 7: numeric strings                                       | coerced by producers; `inverseOf` rejects non-integers                                                                                                                                           | J1.15       |
| Decision 1: batches                                          | per-tab, ops-based, no empty entry                                                                                                                                                               | J1.13       |
| Decision 2: residue                                          | keep `children: []` (J1.1 contract)                                                                                                                                                              | —           |
| Decision 3: `set_style` on a nested key (`@`, `:`, `&`, `[`) | refused, pointing to `set_property` with `key:"style"`                                                                                                                                           | J1.15       |
| Decision 4: `update_state`                                   | replaces (parity)                                                                                                                                                                                | —           |
| Decision 5: `set_text ""`                                    | keeps `[""]`; description rewording at P2.5                                                                                                                                                      | —           |
| Decision 6: selection when children are replaced             | pruned under the replaced children                                                                                                                                                               | J1.15       |

### 5.8 External conflicts (external map §5)

| Conflict                                  | Resolution                                                                                                  | Slice        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| 1. Per-round vs stable lists              | per-round advertisement is a Studio refinement; membership is stable; call-time refusal is always available | J1.20        |
| 2. In-memory ask vs survivable suspension | invoker-level interactions; inline or suspend by host                                                       | J1.21, J1.22 |
| 3. Validate-after vs validate-before      | follows `DocumentHost.undoable` (§3.1 edited in place)                                                      | J1.16        |
| 4. Duplicate names                        | the catalog throws                                                                                          | J1.20        |
| 5. Tier vs capability                     | capability is static membership; tier is a call-time `Gate`                                                 | J1.20        |
| 6. Room edits                             | the `DocumentHost` seam; platform `Rooms.applyServerEdit`                                                   | P2.3         |

---

## 6. Phase 1 PR slices, in order

Every slice lands code, tests, a fragment written by `bun run spec:change <spec> <level> -m "…"`, and the docs pages `bun run docs:sync` names.

- Fragment sentences and commit subjects contain **no angle-bracket generic types** (`changelog-safe-angle-brackets`).
- Docs prose has no em dashes (`docs:prose`).
- Each touched workspace passes `bun test --isolate --coverage` plus the manifest check, with the ratchet raised when the worst file improves.
- `packages/studio/evals/tests/runner.test.ts` and the J1.2 goldens stay green, changing only as named.
- "Live eval" means the PR attaches `bun run eval --k 3` and `eval:headless` deltas with `regressed: []`.

**J1.1: Doc-op foundation** (in flight in parallel)

- Files:
  - `packages/schema/src/{doc-ops,json-layout}.ts` plus tests;
  - `packages/collab/src/ops.ts` (a re-export);
  - `st/tabs/doc-op-apply.ts`;
  - `st/files/json-layout.ts` deleted;
  - `transact.ts` (`mutateMoveNode` via `inverseOf`, and the new `applyDocOpsAsUser`).
- Integration contract for later slices:
  - `applyDocOpsAsUser(tab, ops)`, per the doc-ops map §4: empty ops mean no transaction; a gate refusal means refused; `inverseOf(toRaw)` then apply then `recordDocOp` after the apply, with rollback on a throw.
  - The internal `applyDocOp(tab, op, inverse)` records the real inverse.
  - It returns `"applied" | "unchanged" | "refused"`. If it lands as a boolean, J1.16 widens it.
- Correction to its description: not pure parity. A move into its own subtree now throws and rolls back, where it used to lose the node. A clamped insert or move records the slot the node landed in, so undo is exact for a past-the-end or negative index. Context-menu moves share this.
- Spec: the existing `studio-fa8f87c0.md` (patch), **plus** `schema.md` minor ("§2 exports doc-ops and json-layout; an op that cannot apply has no inverse and a move into its own subtree is refused").
- Acceptance:
  - schema, collab and studio suites green;
  - `transact.ts` no longer contains `inverse: op`;
  - a move into its own subtree leaves the document unchanged with no history entry.

**J1.2: Freeze v1 and the Worker gate** (no behaviour change)

- Files:
  - `st/../tests/harness/trace-recorder.ts`: a chat-state Proxy logging method calls, a client spy, and ledger or `fileTurn` spies normalised to `file(anchor, writes)`.
  - `st/../tests/fixtures/agent-traces/*.json` for every LOOPT, RECON and DAT scenario, plus `agent-trace.test.ts`.
  - `packages/ai/tests/fixtures/v1/{transcripts,sessions}/*.json` (a `toMessagesArray` corpus, and legacy and v1 persisted sessions).
  - `packages/server/tests/fixtures/ai-upstream/*.sse` with the expected server frames, and the client normaliser's frames for the same inputs (documenting the divergence).
  - `packages/studio/evals/tests/parity.golden.test.ts` (scripted `TrialResult`: rounds, toolCalls, finalDoc, transcript, loopError).
  - `packages/ai/tests/worker-safety.test.ts` (current leaves `./streaming-client` and `./tools`).
  - `packages/ai/tsconfig.worker.json`, the root script `typecheck:ai-worker` and a `checks` step in `test.yml`.
  - `@cloudflare/workers-types` as a devDependency of `packages/ai`.
- Spec: `ai.md` patch ("§1 depends on @jxsuite/protocol and through it on @jxsuite/schema; the leaves are Worker-safe").
- Acceptance: all suites green; no `src/` change; the goldens re-record to identical bytes on a second run.

**J1.3: Persisted tool outcomes** (behaviour, small)

- Files: `document-assistant.ts` persist (strip `toolCalls[].result`) and restore (backfill from the matching tool message).
- Tests:
  - a payload saved by the new build loads in today's `loadSession` (S1);
  - a restored chip shows its outcome;
  - a restored answered `ask_user` shows its answer;
  - an unanswered one stays inert.
- Spec: `ai.md` minor ("§3.4 a restored question that was answered shows its answer; only an unanswered one renders inert"). Docs: `docs/studio/ai/chat.md`.
- Acceptance: the session goldens change only by the absence of `result: null`.

**J1.4: Loop honesty in the old loop** (behaviour)

- Files:
  - `chat-state.ts`: `appendToolResult` searches `messages`; `setError` clears pending calls.
  - `tool-executor.ts`: D3 abort check; D5 `setError` without a preceding `finishStream`; D6 anchor scan from this turn's user message; D9 sentence.
  - `ai-panel.ts`: the effect reads `tc.result` and `tokenCount` (D15).
- Tests:
  - the loop-to-view join (a live `ask_user` chip shows its answer);
  - Stop during the last call;
  - the partial message is removed after a stream error;
  - the anchor for each outcome;
  - `null` arguments.
- Spec: `ai.md` minor ("§3.2 a chip shows the result the loop recorded, a stream error removes its round's partial message, and a turn's changes are filed under the last message it drew"). Docs: `chat.md`.
- Acceptance: agent-trace deltas are limited to the D1, D3, D5, D6 and D9 scenarios and are listed in the PR.

**J1.5: Stop is armed before the first await** (behaviour)

- Files:
  - `document-assistant.ts`: the controller is created before `await plat.aiChatUrl()`, with an abort check after each await.
  - `ai-import-tools.ts`: a `{once:true}` listener removed on settle (F1/D10).
  - `streaming-client.ts`: `chatUrl` may be a function.
- Tests:
  - Stop before the controller exists (the D4 probe): no mutation, no stream, no orphan;
  - Stop after a finished import leaves it `done`;
  - DAT:607 extended with tool calls.
- Spec: `ai.md` patch ("§2 Stop is armed before the send path's first await"). Docs: none.
- Acceptance: D4 and D14 probes green; RECON unchanged.

**J1.6: One turn per window** (behaviour; screenshot lane)

- Files:
  - `document-assistant.ts`: reactive `isTurnActive()`, true from `sendMessage` to loop end.
  - `composer.ts`: `sendState` is answer, else stop, else send.
  - `ai-panel.ts`: `isAssistantStreaming` returns `isTurnActive()`; `assistant.stop` is enabled on turn-active.
- Tests: the D2 probe refused; Stop enabled during a long tool; answering still works; `commands-defaults` and `live-context` updated.
- Spec: `ai.md` minor ("§3.0 ai.streaming is true for the whole turn, tools included; §3.4's idle status belongs to the token stream, not the turn"). Docs: `chat.md`.
- Acceptance: the composer screenshot delta is reviewed.

**J1.7: Honest turn outcomes** (behaviour; live eval)

- Files: `tool-executor.ts`:
  - a turn that drew nothing ends with an error row using the new empty text;
  - a call is _applied_ when the ledger grew by an ok write during it (a length snapshot before and after).
- Tests: a read-only cap gives `cap_failed`; an empty first round gives the error row; an empty final round after work is `complete`.
- Spec: `ai.md` minor ("§3.2 partial success means a change was applied, and a turn that drew nothing says so"). Docs: `chat.md`.
- Acceptance: the eval `loopError` delta is explained in the PR.

**J1.8: ToolContext** (pure refactor)

- Files:
  - `ai/tools.ts`: `ToolContext`, `createToolContext`, `createLedger`, `createSessionFacts`, `linkCallSignal`, `interactive`, `refusal?`, `execute(args, ctx?)`.
  - `ai/core-types.ts` (allowlisted).
  - `gated-registry.ts` and `ai-command-tools.ts` forward ctx. (`refusal` moves to J1.11: `invokeTool` is its first caller, and Studio's reachability rule refuses a function nothing calls.)
  - `tool-executor.ts` builds ctx per call (child signal, callId, actor, a turn ledger, session facts from the assistant, progress to `recordImportProgress(callId, …)`) and uses `def.interactive`.
  - Ten `recordWrite` sites become `ctx.ledger.record` (eight, plus the two F7 bootstrap records J1.7 added).
  - `ai-writes.ts` becomes `fileTurn`.
  - `ai-ask.ts` takes the signal and callId from ctx.
  - `ai-import-tools.ts` uses ctx; brief and adopter are bound at registration.
  - `imported` becomes session facts.
  - `ai-turn-signal.ts` and its test are deleted.
  - `tests/harness/recording-context.ts` helper.
- Tests: T1, T3 (ctx reaches the leaf through the composite), a per-call ledger.
- Spec: `ai.md` minor, new "§3.7 A tool call carries its context". Docs: new `docs/extending/embedding/assistant-harness.md` with a `nav.json` entry and `code:` `packages/ai/src/tools.ts`.
- Acceptance: agent traces, LOOPT, RECON and DAT unchanged.

**J1.9: Ledger reset and path containment** (behaviour, small; the bootstrap writes, F7, landed with J1.7)

- Files:
  - `document-assistant.ts` calls `resetAiWrites` on New Chat and close project (F8);
  - `ai-tools.ts` `create_component`/`create_page` call `normalizeProjectPath` (F5).
- Tests: the escape paths `..`, absolute and `C:\` are refused.
- Spec: `ai.md` patch (§3.2, §4). Docs: `chat.md`.

**J1.10: `./messages`** (pure refactor)

- Files: `ai/messages/*.ts` (split for coverage), export `./messages`, `chat-state` `Message = LiveMessage`, `toMessagesArray` delegates.
- Tests: H2 against the J1.2 corpus; `toLiveMessages(toChatMessages(x))` equals `x`; a Studio test round-trips all 29 tools; `./messages` added to the worker gate.
- Spec: `ai.md` minor, new "§2.3 The neutral conversation model" and a §2.2 patch naming the projection. Docs: harness page §messages.

**J1.11: `./harness` behind `runAgentLoop`** (pure refactor; live eval)

- Files:
  - `ai/harness/*.ts`: `runTurn`, `TurnRun`, `createTurnLock`, `fromStreamingClient`, `DEFAULT_TURN_POLICY` (defaults equal to post-J1.7 behaviour).
  - `invokeTool` in `ai/tools.ts`: parse, refusal, execute, normalise.
  - `refusal?` on `ToolRegistry`, answered by `gated-registry.ts` and `ai-command-tools.ts` and forwarded by `composeToolRegistries` (moved from J1.8).
  - `st/services/harness/{chat-reducer,turn-hooks}.ts` with tests.
  - `runAgentLoop` becomes an adapter using `onEvent`.
  - `chat-state` `beginAssistantTurn(id?)` and `pushToolResultMessage(…, id?)`.
  - `isTurnActive` backed by the assistant's `TurnLock`.
  - `ai-import-rules.test.ts` gains the minified-size ratchet (§2), deferred from J1.17.
- Commits: (1) core plus tests; (2) the adapter switch with goldens unchanged; (3) the old loop body deleted.
- Tests: H1, H3, H6-H8, H10.
- Spec: `ai.md` minor, new "§3.8 The turn engine" (outcomes, event order, anchor, fixed system prompt). Docs: harness page §harness.
- Acceptance: every J1.2 golden identical; the eval delta is flat.

**J1.12: Pair repair** (behaviour)

- Files: `repairToolPairs` in `./messages` (`context-manager.ts` delegates); the harness emits `transcript_repaired` for hosts that repair at turn start.
- Tests: the D2 interleave is repaired by a move; `call_0` reused across rounds pairs correctly; `SEAL_CUT_OFF` on unparseable arguments; idempotence.
- Spec: `ai.md` minor ("§3.4 repair moves a separated reply back to its request, pairs per message, and says when a call was cut off").

**J1.13: Per-actor lanes** (behaviour)

- Files:
  - `transact.ts`: `BatchLane`, `openBatchLane`, `isBatched`, `flushOpenBatches`, `runAsActor`, `TransactOptions.actor`, entries tagged `{actor, turnId}`, and ops-based segments.
  - `collab-session.ts`: per-tab owner-only buffering, flushed before foreign ops.
  - `project-adoption.ts`: `flushOpenBatches`.
  - The loop: a lane when `getTab` is given.
  - `applyAndValidate` passes `ctx.actor`; the command bridge wraps `registry.run` in `runAsActor`.
- Tests:
  - the F2/D12 probe (tab B keeps its own history);
  - a human edit on the same tab during an awaited tool splits the segment in the right order;
  - an empty lane adds no entry;
  - A then B then A gives one entry per document;
  - `duplicate_node` and `delete_node` are attributed;
  - collab-session suites.
- Spec: `ai.md` minor ("§3.3 the batch belongs to the assistant, one segment per document it writes, and a person's edit is never folded into it"); `studio.md` §3.3 minor. Docs: `document-assistant.md`.

**J1.14: Restore undoes the turn** (behaviour; screenshot lane)

- Files: `AiTurn.batches`; `ai-panel.ts` Restore undoes each receipt while it is the top entry of its tab, and refuses otherwise with a sentence.
- Tests: Restore across two documents; refusal after a later human edit.
- Spec: `ai.md` minor (§3.2 Restore). Docs: `chat.md`.

**J1.15: Doc-op strictness in the old tools** (behaviour; live eval)

- Files:
  - `ai-tools.ts` handlers and `transact.ts` mutators: `coerceIndex`, and the §5.7 refusals and selection fixes;
  - `@jxsuite/schema/doc-ops`: the non-integer and not-a-node checks in `inverseOf`, plus the moved selection helpers.
- Tests: the full probe table of the doc-ops map as a producer or mutator table; `ai-tools.test.ts:125-143` unchanged (`set_text` is still two ops).
- Spec: `ai.md` minor ("§3.1 a document tool refuses an edit that would corrupt the tree or succeed without effect, and coerces an index written as a numeric string"); `schema.md` patch. Docs: `document-assistant.md`.

**J1.16: `./jx-tools` producers** (pure refactor; live eval)

- Files:
  - `ai/jx-tools/*.ts`: `DOC_TOOLS` moved verbatim, `docToolEntries`, `coerceIndex`, `FROZEN_SENTENCE`.
  - `@jxsuite/ai` gains `@jxsuite/schema: workspace:^` (only `doc-ops` and `types` are imported).
  - `st/services/harness/studio-documents.ts`.
  - The seven tree writers and `read_document` are built by `docToolEntries` with a reporter over `snapshotBeforeWrite`/`reportDocumentWrite`.
  - `applyAndValidate` is deleted, so `transactDoc` is no longer nested.
- Commit 1 captures the ops J1.15's tools record for the probe table; commit 2 switches.
- Tests: D1 property test, D2, D3 op golden, description snapshot; `ai-hand-writers.test.ts` green.
- Spec: `ai.md` minor, new "§3.9 Portable document tools", with §3.1 edited in place ("a host that cannot undo validates before commit"); `studio-ui-guidelines.md` §12.4 patch. Docs: harness page.

**J1.17: `./gateway` extraction** (server parity)

- Files:
  - `ai/gateway/*.ts`: `createChatHandler`, `modelsResponse`, `normalizeOpenAIStream` (the server's normaliser moved verbatim), `encodeSse`, `problemResponse`.
  - `packages/server/src/ai-api.ts` adopts them; its resolver keeps SSRF and key provenance as server-local functions.
- Tests: the server frame goldens are byte-identical; `ai-api.test.ts` unchanged; `./gateway` added to the worker gate and the Studio import rule.
- Spec: `ai.md` minor, new "§2.4 One gateway implementation"; `server.md` §4 patch.
- Deferred, each to the slice that brings its behaviour: `upstreamErrorCode`, `wire`, `providers` and the quirks (J1.18, J1.19); the size ratchet (J1.11).

**J1.18: One normaliser** (behaviour)

- Files:
  - `createOpenAIStreamingClient` uses `normalizeOpenAIStream`, so its frames equal the server's: clean message plus `code` plus `problem`.
  - `OpenAICompatQuirks` hardening.
  - `done.truncated` (D11).
  - `chat-state` `setError(message, code)`; `formatErrorAdvice` keyed on the code first.
  - Protocol additions (§3.14); the probe sends `wire:[1]` and `limits`.
  - `./testing` `gatewayConformanceCases` and `fakeUpstream`, run by the server tests.
  - Studio's trim honours `limits.maxMessages`.
- Tests: fixtures for an id repeated per chunk, a missing index and a truncated body; advice per code.
- Spec: `ai.md` minor ("§2 every error frame carries a problem, a body that ends without done finishes truncated, and the probe advertises wire and limits"); `server.md` §4 minor; the §5 RFC 9457 row note. Docs: `backend-protocol.md`.
- Acceptance: client frame goldens change exactly to the server shape.

**P1.1: Platform adopts the gateway** (platform repo, after `@jxsuite/ai` 0.38.x is published)

- Delivered as, or right after, the Dependabot range bump off `^0.37.2`.
- `src/routes/ai.ts` uses `createChatHandler`:
  - `admit`: rate limit and Content-Length;
  - `resolveUpstream`: BYOK or Workers AI;
  - `maxMessages: 200`, `maxBodyBytes: 1_000_000`;
  - `onAccepted`: audit;
  - `upstreamErrorCode`: managed 401/403 to `cf_reconnect_required`.
- The models route uses `modelsResponse`.
- The kit runs in `tests/ai-routes.test.ts`. The coupling test allows only `/gateway` and `/streaming-client`.

**J1.19: Wire v2 with the OpenAI-compatible provider** (live eval)

- Files:
  - `ai/providers/openai-compat.ts` (a shared body builder);
  - `ChatRequestV2`, the v2 frames, `negotiateWire`, the `X-Jx-AI-Wire` header;
  - the gateway accepts v2 through `checkChatRequestV2`; `wire-unsupported` with a one-shot downgrade retry in the proxy client;
  - `streamTurn`; `ai-models.ts` reads `wire`;
  - `packages/ai/schemas/{wire-v2.request,wire-v2.frame}.schema.json`, generated by `bun run --cwd packages/ai generate:wire-schemas`, appended to `GENERATORS` with a new `SchemaKind` `"contract"` and `classifySchema` updated;
  - export `./providers` and `./schemas/*`.
- Tests:
  - the upstream body is byte-identical v1 vs v2 (fetch spy);
  - a gateway with no `wire` still receives v1;
  - an old Studio works against a new gateway;
  - the downgrade retry.
- Spec: `ai.md` minor, new "§2.5 Wire version 2". Docs: `backend-protocol.md`.

**J1.20: `./catalog` membership and facts** (no behaviour change)

- Files:
  - `ai/catalog/*.ts`;
  - `JX_TOOL_FACTS` in `./jx-tools`;
  - annotations, title and tier on all 29 Studio definitions;
  - the Studio composite becomes `catalogRegistry(createCatalog(hand, commands), {gate, requires: TIER_REQUIREMENTS, advertise})`;
  - `toMcpTool` and friends.
- Tests: C1, C3 (the availability matrix equals today's `listForLLM` names and bytes), a test that every production tool has explicit facts, and M-1 to M-6 over `toMcpTool`.
- Spec:
  - `ai.md` minor, new "§3.10 Catalog membership", and §3.6 edited in place (membership vs advertisement; duplicates throw);
  - a §5 JSON Schema 2020-12 row marked `Pending`;
  - `specs/standards.md` §11 backlog: MCP 2026-07-28 until its section exists.
- Docs: harness page.

**J1.21: Interactions and approvals run before the tool body** (Studio behaviour unchanged)

- Files:
  - `invokeTool` gains the approval and interaction phases;
  - the harness adds inline and none strategies;
  - `askUserTool()` becomes `interaction`/`settle`;
  - `st/services/harness/interaction-store.ts`, owned by the assistant and passed to `runAgentLoop`;
  - `ai-panel.ts` reads `assistant.interactions`;
  - the approval plumbing uses `proceedAlways` for Studio and evals;
  - LOOPT's ask harness passes a store.
- Tests: the LOOPT ask-budget tests (498-570) unchanged in outcome; Stop settles a pending question; T2; T4.
- Spec:
  - `ai.md` minor, new "§3.11 Interactions and approvals run before the tool body";
  - §3.4 edited in place: the mechanism is the invoker, not a pending promise inside the tool; the answer is still a tool result; a host-dependent clause on persistence;
  - §4 edited (approvals).
- Docs: harness page.

**J1.22: Checkpoints and resume**

- Files:
  - `TurnCheckpoint` (with `appended`), `checkResume` (digests), the `resume` input, the suspend strategy, `suspendOn`;
  - `InvocationState`;
  - `./testing` `createMemoryHarnessHost`;
  - a generated `turn-checkpoint.v1.schema.json`.
- Tests:
  - JSON round trip;
  - resuming after each tool index gives the same final document as an inline run;
  - a changed catalog, policy or system digest refuses the resume;
  - a suspended turn executed no side effect for the awaiting call.
- Spec: `ai.md` minor, new "§3.12 A suspended turn resumes from a checkpoint". Docs: harness page.

**J1.23: Sessions**

- Files:
  - `ai/sessions.ts`;
  - `migrateTranscript`, `persistWindow` and `sessionTitle` in `./messages`;
  - `st/services/ai-session-store.ts` behind the async `SessionStore`, with a serialised write queue, `SaveResult` shown as a non-blocking notice on quota, the legacy key deleted only after the migrated write succeeds, and v1.5 additive fields;
  - `document-assistant.ts` awaits the store.
- Tests: S1, S2, three generations, two simulated windows, eviction, DAT:607, quota.
- Spec: `ai.md` minor, new "§3.13 A persisted conversation". Docs: `chat.md` ("up to 50 messages, starting at one of yours").

**J1.24: Native Anthropic** (live eval against a Claude model)

- Files:
  - `ai/providers/anthropic.ts` (§3.8), capabilities, binding stamping at `round_end`;
  - `reasoning_block`, `chat-state.appendReasoningBlock`, `stripOlderSignatures` on persist;
  - the gateway's `Upstream.family` (server: an `X-Api-Provider` header or setting);
  - Studio's provider setting;
  - for the anthropic family, Studio's prompt is split into a stable part and a turn context whose concatenation equals today's prompt, giving the append layout and stable listing via `stableSpecs`.
- Tests: recorded SSE fixtures (interleaved thinking, `signature_delta`, redacted, `input_json_delta`, missing `message_stop`, `input_transformations`), the trailing-run rule across a rebuilt system, strip-and-retry, user-first, the id remap, cache points, usage.
- Spec: `ai.md` minor, new "§2.6 Native Anthropic Messages", with §2.2's Partial note edited in place. Docs: `docs/studio/ai.md` (connecting Anthropic), `backend-protocol.md`.

**J1.25: Project tools over a ProjectHost, and the six twins** (pure refactor for Studio)

- Files:
  - `ai/jx-tools/project.ts` (texts moved verbatim from `ai-project-tools.ts`), `reportWrite`, `createDocumentValidator`;
  - `st/services/harness/studio-project.ts` (over `getPlatform()`);
  - `portableTwins`: the redirects core and `pageRoute` move to `@jxsuite/schema/redirects`; popover tags are host-supplied;
  - `packages/studio/tests/ai-twins.test.ts` asserts each portable twin's name, input schema, annotations, undoability and `requires` equal its Studio record's, after canonicalisation;
  - Studio keeps the twins as command projections.
- Spec: `ai.md` minor, new "§3.14 Project tools over a ProjectHost", §4 containment; `schema.md` patch (redirects). Docs: harness page.

**J1.26: Studio approvals on** (behaviour; screenshot lane)

- Studio's policy becomes `confirmIrreversible`:
  - confirm a disk write that overwrites an existing file (`write_file`, `create_component`, `create_page`) and `enable_extension`;
  - tree edits proceed, because the document history is the backstop;
  - "trust for this session" is kept in the session facts.
- The approval card renders in the call's chip. Evals keep `proceedAlways`.
- Spec: `ai.md` minor (§3.11 Studio defaults). Docs: `chat.md`.

**J1.27: Parallel read-only calls** (live eval)

- `parallelReadOnly: true` in Studio.
- Tests: H5; interaction and write calls are never grouped.
- Spec: `ai.md` minor (§3.8).

**J1.28: Summarising compaction** (live eval)

- `CompactionPolicy`:
  - `keep-tail` stays for openai-compat (parity);
  - `summarize` is the default for the anthropic family: one harness summary message plus the new user turn, never inside a tool round, bounded by the probe's `limits` (G-13).
- Spec: `ai.md` minor (§2.2 display vs wire, §3.8). Docs: `chat.md`.

**Dependencies.**

- J1.1 is needed by J1.15, then J1.16.
- J1.2 is needed by every later slice.
- J1.3 is needed by J1.4.
- J1.4 and J1.5 are needed by J1.6, then J1.7.
- J1.7, J1.8 and J1.10 are needed by J1.11, which is needed by J1.12 and J1.27.
- J1.8 is needed by J1.9 and J1.13; J1.13 by J1.14.
- J1.11 and J1.15 are needed by J1.16.
- J1.17 is needed by J1.18, which is needed by P1.1 and J1.19.
- J1.11 and J1.16 are needed by J1.20, then J1.21, then J1.22.
- J1.10 is needed by J1.23.
- J1.19, J1.20 and J1.23 are needed by J1.24, which is needed by J1.28.
- J1.16 and J1.20 are needed by J1.25.
- J1.21 is needed by J1.26.
- J1.17 to J1.19 can proceed in parallel with J1.3 to J1.16.

**Phase 2 (outline, not sliced here):**

- **P2.1** `packages/mcp` (its own `bunfig.toml` threshold): `jx mcp` stdio over `FsProjectHost` and a `FileDocumentHost` (`parseJsonDocument`, apply, `serializeJson` for byte parity), the stable list, approvals through elicitation only, the HMAC `requestState` codec over `InvocationState`.
- **P2.2** Desktop: keychain BYOK gateway, a session file store over RPC, a loopback MCP into the focused window.
- **P2.3** Platform: remote MCP (bearer verification, per-request server, secret key), the HarnessRun DO with `Rooms.applyServerEdit` (seed structure, `applyDocOpsToY` with a diff fallback, `updateSourceText`, respecting `canonical:"source"`), checkpoints in DO SQLite, an `alarm:harness` task.
- **P2.4** IndexedDB session store with a copy that leaves localStorage readable.
- **P2.5** Eval rebaseline: F3, F6, strict 2020-12 validation (F4), the `set_text` and `update_state` descriptions.

---

## 7. Test strategy (summary)

- **Goldens.** J1.2's corpus is the single parity reference, and every later delta is explicit in the PR. The replay model (`./testing`) fails on any request mismatch, which makes wire parity byte-level. From J1.19, one cassette of the eval task set runs in CI with no key.
- **Property tests.**
  - producers and `inverseOf` (D1);
  - event grammar (H3);
  - `repairToolPairs` and `migrateTranscript` idempotence;
  - `persistWindow` starts at a user message.
- **Conformance.** `gatewayConformanceCases` runs in `packages/ai`, `packages/server` and the platform, over shared upstream fixtures. `createMemoryHarnessHost` gives an inline-versus-suspend equivalence check.
- **Worker and bundle.** The W1 to W3 gates run on every PR touching `packages/ai` or `packages/schema`.
- **Coverage.** Each new `packages/ai` file is small, table-driven and held at 0.99. Type-only files are allowlisted. Deleted singletons leave the manifest cleanly. Command-invoking tests use `mock.module()` doubles (CLAUDE.md Bun 1.4.0 rule), and harness tests never overlap dynamic imports.
- **Evals.** `runner.test.ts` and `parity.golden.test.ts` run in CI. The live evals on the flagged slices use `regressed: []`.

---

## 8. Risks, most serious first

1. **Model-visible text drift during moves.** Mitigation: rule 7, the C2 and description snapshots, and live evals on J1.7, J1.11, J1.15, J1.16, J1.19, J1.24, J1.27 and J1.28.
2. **Anthropic binding 400s from Studio's non-append history** (trim, seal, `slice(-50)`). Mitigation:
   - the trailing-run rule, removing only stale leading blocks;
   - the append layout and stable listing in the same PR;
   - summarising compaction;
   - strip-and-retry once where the binding-controls beta is absent.

   Accepted cost: cross-turn thinking is lost on the openai-compat-shaped history until the append layout applies.

3. **Lane and collab ordering.** A foreign write must flush the owner's buffered ops first, or the Y indices diverge. Mitigation: invariant L1, with tests over two tabs and one collab session before J1.13 merges.
4. **Command-projection attribution** relies on a synchronous scope. A record that awaits before transacting would be unattributed and would split the segment, degrading Restore. Mitigation: attribution tests for `duplicate_node` and `delete_node`, and the rule that records transact synchronously.
5. **Version skew.** `feat` releases move `@jxsuite/ai` outside the platform's caret. Old gateways must keep working. Mitigation:
   - v2 only after the probe advertises it;
   - v1 accepted forever;
   - the one-shot downgrade;
   - the `X-Jx-AI-Wire` assertion;
   - `./streaming-client` byte-compatible;
   - old and new Studio/gateway pairs tested in J1.19.
6. **Error-text convergence in J1.18 changes which Studio recovery fires** (a Workers AI 401 becomes `cf_reconnect_required`). Mitigation: advice keyed on the code in the same PR, and RECON tests.
7. **Stricter producers refuse calls models make today.** Mitigation: coerce canonical strings and clamp past-the-end, refusing only corrupting cases; watch the eval `rounds`.
8. **Async sessions reorder persistence against New Chat and Delete.** Mitigation: a serialised write queue and DAT:607.
9. **Multi-window last-write-wins with an older build.** Mitigation: additive fields, shape detection, migration on every read, v1 keys never deleted by eviction.
10. **Worker regressions through transitive imports** (the `@jxsuite/schema` root pulls in ajv and `node:fs`). Mitigation: the W1 graph test on every PR touching `packages/ai` or `packages/schema`, and leaf-only imports.
11. **Test churn from the ledger and interaction moves weakening assertions.** Mitigation: `recordingContext()` and a line-by-line review of changed assertions.
12. **Spec churn** (about 18 `ai.md` releases). Mitigation: `spec:change` fragments, and new sections appended in landing order (§2.3 to §2.6, §3.7 to §3.14), never renumbered.

## 9. Open decisions (with recommended defaults)

1. **Persist the ledger and import logs** as `meta.host` annotations so Restore survives a reload (H14)? Recommendation: after J1.23. The field is reserved.
2. **T13, answering Stop-unrun calls at turn end** with "Not run: the turn was stopped" instead of sealing them on the next send. Recommendation: defer. It is model-visible and the current seal works.
3. **Anthropic `prefixMismatch` in production.** Recommendation: `drop_block` with `input_transformations` monitoring, and `error` in CI and evals, per the skill's three-step check.
4. **Headless approvals.** Treat a git-backed project as project-undoable so `CONFIRM` does not elicit on every tree edit? Recommendation: tree edits proceed on a git-backed root; overwrites confirm.
5. **Undoability of DO edits**: a reviewable run branch (`document`) or `none`. This drives validation timing on the platform. Recommendation: `document`, with the op-pair journal as undo.
6. **Headless JSON layout**: keep Studio's positional-layout quirk (parity), or remap pointers through structural ops. Recommendation: parity first.
7. **Whether OpenAI proper accepts an unknown `reasoning_content`** after a model switch (H8). Keep sending it, and add a dialect switch if a 400 is observed.
8. **`set_style` media and selector arguments** (`mutateUpdateMediaStyle` exists). Recommendation: a scaffolding PR after P2.5.
9. **Where the anthropic context message goes on models without mid-conversation system support** (Sonnet 5). Recommendation: a user text block after the `tool_result` blocks, with a 400 fallback detected once per session.
