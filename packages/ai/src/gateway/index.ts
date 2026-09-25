/**
 * `@jxsuite/ai/gateway`: the server half of the `ai/chat` and `ai/models` routes, written once.
 *
 * Every Jx backend that proxies the assistant to a provider does the same wire work: read the
 * client's body, forward it as an OpenAI-compatible request, normalize the provider's stream into
 * the route's frames, and frame those as SSE. Before this module each backend carried its own copy,
 * and the copies drifted. Now `@jxsuite/server` runs this one, and any other backend can.
 *
 * What stays with the host is policy: whose key a request may use, which base URLs are safe to
 * reach, how requests are admitted, and what the model catalogue says. The host supplies those as
 * `ChatGatewayOptions`, and the gateway never second-guesses them.
 *
 * Worker-safe: it imports `@jxsuite/protocol`'s problem modules and nothing host-bound
 * (`tests/worker-safety.test.ts`, `tsconfig.worker.json`).
 *
 * @module @jxsuite/ai/gateway
 * @docs extending/embedding/backend-protocol
 */

export { createChatHandler } from "./chat.ts";
export { modelsResponse } from "./models.ts";
export { normalizeOpenAIStream } from "./normalize.ts";
export { problemResponse } from "./problem.ts";
export { encodeSse } from "./sse.ts";
export { extractUpstreamErrorMessage } from "./upstream-error.ts";
export type { ChatAdmission, ChatGatewayOptions, GatewayRefusal, Upstream } from "./types.ts";
