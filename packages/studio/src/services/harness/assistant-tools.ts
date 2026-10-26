/**
 * Assistant-tools.ts — the one registry the assistant's turn reads its tools from.
 *
 * Two kinds of tool reach the model: the hand-registered ones, gated by the tier table
 * (`AI_TOOL_TIERS`), and the projections of every command record that declares `aiTool`, gated by
 * the record (`services/ai-command-tools.ts`). This is where they meet, for the document assistant
 * and for the eval runner alike, so both offer the model the same tools in the same state.
 *
 * @license MIT
 */

import type { ToolRegistry } from "@jxsuite/ai/tools";
import { composeToolRegistries } from "../ai-command-tools";
import { AI_TOOL_TIERS, toolActive } from "../ai-system-prompt";
import type { AiToolState, AiToolTier } from "../ai-system-prompt";
import { createGatedToolRegistry } from "../gated-registry";
import type { ToolAvailability } from "../gated-registry";

/**
 * What each tier requires, as the sentence a refused call ends with. The model reads it, so it is
 * phrased as what to do as much as what is missing.
 */
export const TIER_REQUIREMENTS: Readonly<Record<AiToolTier, string>> = {
  /* Never refused, so the sentence is unreachable — it exists because the map is derived from the
     tier union, and a tier without one would not compile. */
  always: "nothing",
  "no-project": "no project to be open (it bootstraps one)",
  project: "an open project",
  document: "an open document (use open_document first)",
  "document-tree":
    "an open document whose element tree the canvas is editing — Project Settings and the " +
    "grid editors are documents, but not trees to restructure, and a page left in Code view " +
    "returns to the canvas with set_canvas_mode",
};

/**
 * The assistant's tools: `hand` gated on live studio state by the same tier table the system prompt
 * renders, so the model is never shown a tool it cannot execute, then `commands`. The state is read
 * on every listing, and `listForLLM()` runs every agent-loop round, so a mid-loop `create_project`
 * unlocks the higher tiers immediately.
 *
 * @param {ToolRegistry} hand - The hand-registered tools
 * @param {ToolRegistry} commands - The command records' projections
 * @param {() => AiToolState} state - The studio facts a tier is decided by, read live
 * @returns {ToolRegistry}
 */
export function assistantToolRegistry(
  hand: ToolRegistry,
  commands: ToolRegistry,
  state: () => AiToolState,
): ToolRegistry {
  const availability = new Map<string, ToolAvailability>(
    AI_TOOL_TIERS.map((t) => [
      t.name,
      {
        when: () => toolActive(t, state()),
        requires:
          t.capability === "importSite"
            ? "a platform with a site-import backend"
            : TIER_REQUIREMENTS[t.tier],
      },
    ]),
  );
  return composeToolRegistries(createGatedToolRegistry(hand, availability), commands);
}
