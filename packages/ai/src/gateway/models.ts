/**
 * The models route's answer.
 *
 * @module @jxsuite/ai/gateway
 */

import type { AiModelsResponse } from "@jxsuite/protocol/types";

/**
 * Answer the models route with `body`, always at `200`.
 *
 * The models route is a capability probe (ai.md §2.1), so every credential state is a 200: "no
 * credentials", "credentials lapsed" and "the upstream could not list" are all answers the client
 * reads, and a non-2xx makes the probe throw. Which catalogue to answer with is the host's business
 * (its defaults, the upstream's listing, a brokered one); this only fixes the envelope.
 *
 * @param {AiModelsResponse} body - The catalogue and the credential state
 * @returns {Response}
 */
export function modelsResponse(body: AiModelsResponse): Response {
  return Response.json(body, { headers: { "Content-Type": "application/json" }, status: 200 });
}
