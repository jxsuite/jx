/**
 * Recording-context.ts — a tool call's context, wired the way Studio's agent loop wires one.
 *
 * `runAgentLoop` gives every call its own `ToolContext`: the call id, a signal linked to the turn,
 * the turn's ledger, the conversation's session facts, and progress routed to the import-run store
 * under the call id (`src/services/tool-executor.ts`). A test that runs a tool without the loop
 * builds the same thing here, then reads what the call recorded off `ctx.ledger.writes`.
 */
import { createLedger, createSessionFacts, createToolContext } from "@jxsuite/ai/tools";
import type { SessionFacts, ToolContext } from "@jxsuite/ai/tools";
import { recordImportProgress } from "../../src/services/import-run";
import type { ImportProgressEvent } from "../../src/types";

/**
 * A call's context: `callId` defaults to `call_1`, the id the import and ask tests key on.
 *
 * @param {{ callId?: string; signal?: AbortSignal; session?: SessionFacts }} [init]
 * @returns {ToolContext}
 */
export function recordingContext(
  init: { callId?: string; signal?: AbortSignal; session?: SessionFacts } = {},
): ToolContext {
  const callId = init.callId ?? "call_1";
  return createToolContext({
    callId,
    ledger: createLedger(),
    progress: (event) => {
      recordImportProgress(callId, event as unknown as ImportProgressEvent);
    },
    session: init.session ?? createSessionFacts(),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}
