/**
 * The one way this server says a request failed: RFC 9457 `application/problem+json`.
 *
 * There were four ways before — `Response.json({error}, {status})`, a bare-text body, a 200 with an
 * `upstreamError` field, and a thrown string that became a 500 with no body — and the Studio client
 * carried a separate reader for each. A failure could therefore surface with no detail at all,
 * because the reader that ran was not the one for the shape that arrived.
 *
 * `packages/server/scripts/check-error-shapes.ts` keeps the old shapes from regrowing.
 *
 * @docs extending/embedding/backend-protocol
 */

import { PROBLEM_MEDIA_TYPE, problemDetails } from "@jxsuite/protocol";
import type { ProblemTypeName } from "@jxsuite/protocol";

/**
 * A failure response for one occurrence of a declared problem type.
 *
 * The status comes from the type rather than from the call site: a type that could be answered with
 * two different statuses is two types, and letting a caller choose is how a registry stops being
 * one. Pass `extensions` for the members the type documents.
 *
 * @param {ProblemTypeName} name - A declared type from `PROBLEM_TYPES`
 * @param {string} [detail] - What happened this time; the line a human reads
 * @param {Record<string, unknown>} [extensions] - Extension members this type documents
 * @returns {Response}
 */
export function problem(
  name: ProblemTypeName,
  detail?: string,
  extensions?: Record<string, unknown>,
): Response {
  const body = problemDetails(name, detail, extensions);
  // The explicit Content-Type is the point: `Response.json` would send `application/json`, and
  // RFC 9457 §3 is what tells a client this body is a problem rather than a result.
  return Response.json(body, {
    headers: { "Content-Type": PROBLEM_MEDIA_TYPE },
    status: body.status,
  });
}

/**
 * The declared type for a status a caller already computed.
 *
 * Two files need this and no more should: `data-api.ts`, whose `ApiError` predates the registry and
 * carries only a status, and `ai-api.ts`, whose key and base-URL refusals are written as statuses.
 * Everywhere else the type is named at the call site, which is what keeps the registry meaningful —
 * a status is not a failure kind. The AI proxy's other use, forwarding an upstream provider's
 * status because collapsing it would discard information, moved with the stream normalizer into
 * `@jxsuite/ai/gateway`, which carries its own copy of this table; `tests/ai-api-gateway.test.ts`
 * holds the two to agreement for every status.
 *
 * @param {number} status
 * @returns {ProblemTypeName}
 */
export function problemTypeForStatus(status: number): ProblemTypeName {
  switch (status) {
    case 400: {
      return "invalidRequest";
    }
    case 401: {
      return "unauthorized";
    }
    case 403: {
      return "forbidden";
    }
    case 404: {
      return "notFound";
    }
    case 405: {
      return "methodNotAllowed";
    }
    case 409: {
      return "conflict";
    }
    case 413: {
      return "payloadTooLarge";
    }
    case 501: {
      return "capabilityUnavailable";
    }
    case 502:
    case 503:
    case 504: {
      return "upstreamFailure";
    }
    default: {
      return status >= 500 ? "internalError" : "invalidRequest";
    }
  }
}
