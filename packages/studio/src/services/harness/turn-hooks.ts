/**
 * Turn-hooks.ts — what Studio does between the turn engine's steps.
 *
 * @license MIT
 */

import type { TurnHooks } from "@jxsuite/ai/harness";
import { ensureProxyProbe, resetModelCache } from "../ai-models";

/** What Studio's hooks act on, injected so the hooks hold no state of their own. */
export interface StudioTurnHookDeps {
  /** Whether the conversation the turn answers has left the transcript (another chat was opened). */
  superseded: () => boolean;
  /** Called once a call settles into a transcript that replaced the turn's own. */
  onSuperseded: () => void;
  /** Re-anchor the undo batch on the document the tools now edit (specs/ai.md §3.3). */
  reanchor: () => void;
}

/**
 * Studio's turn hooks.
 *
 * - **After each call**, a turn whose conversation has been replaced stops there: its reply belongs
 *   to a request that is no longer on screen, and writing it would land a stray `tool` message in
 *   the other conversation. Otherwise the undo batch follows the document the tools moved to, which
 *   a tool, project adoption or the author clicking another tab can each change.
 * - **On a stream error**, a lapsed hosted grant (`cf_reconnect_required`) drops the model reading
 *   and re-probes (specs/ai.md §2.1): the probe settles once at boot, so without this every gate
 *   keeps offering an assistant that cannot answer, and the failed send is the only evidence.
 *
 * @param {StudioTurnHookDeps} deps
 * @returns {TurnHooks}
 */
export function studioTurnHooks(deps: StudioTurnHookDeps): TurnHooks {
  return {
    afterTool() {
      if (deps.superseded()) {
        deps.onSuperseded();
        return;
      }
      deps.reanchor();
    },
    onStreamError(error) {
      if (error.code === "cf_reconnect_required") {
        resetModelCache();
        ensureProxyProbe();
      }
    },
  };
}
