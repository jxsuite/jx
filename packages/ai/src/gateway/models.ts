/**
 * The models route's answer.
 *
 * @module @jxsuite/ai/gateway
 */

import type { AiChatLimits, AiModelsResponse } from "@jxsuite/protocol/types";

/** The chat-route wire versions this gateway accepts. */
export const WIRE_VERSIONS: readonly number[] = [1, 2];

/** What a host declares about its chat route beside the catalogue. */
export interface ModelsResponseOptions {
  /** The wire versions the host's chat route accepts. `WIRE_VERSIONS` when absent. */
  readonly wire?: readonly number[];
  /** The ceilings the host's chat route enforces, when it enforces any. */
  readonly limits?: AiChatLimits;
}

/**
 * Answer the models route with `body`, always at `200`.
 *
 * The models route is a capability probe (ai.md §2.1), so every credential state is a 200: "no
 * credentials", "credentials lapsed" and "the upstream could not list" are all answers the client
 * reads, and a non-2xx makes the probe throw. Which catalogue to answer with is the host's business
 * (its defaults, the upstream's listing, a brokered one); this fixes the envelope, and adds what
 * the probe advertises about the chat route beside it: the wire versions it accepts and the limits
 * it enforces (ai.md §2). A model's `contextWindow` is dropped when it is not a positive number,
 * because zero is how a listing that carried none used to be written, and a client that budgets
 * against zero trims everything.
 *
 * @param {Omit<AiModelsResponse, "wire" | "limits">} body - The catalogue and the credential state
 * @param {ModelsResponseOptions} [options] - What the host declares about its chat route
 * @returns {Response}
 */
export function modelsResponse(
  body: Omit<AiModelsResponse, "wire" | "limits">,
  options: ModelsResponseOptions = {},
): Response {
  const answer: AiModelsResponse = {
    ...body,
    models: body.models.map((model) => {
      if (model.contextWindow === undefined || model.contextWindow > 0) {
        return model;
      }
      const { contextWindow: _dropped, ...rest } = model;
      return rest;
    }),
    wire: [...(options.wire ?? WIRE_VERSIONS)],
  };
  if (options.limits && Object.keys(options.limits).length > 0) {
    answer.limits = options.limits;
  }
  return Response.json(answer, { headers: { "Content-Type": "application/json" }, status: 200 });
}
