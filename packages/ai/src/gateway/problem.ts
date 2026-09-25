/**
 * How the gateway says no: an RFC 9457 problem response, and the problem type an upstream's status
 * maps onto.
 *
 * @module @jxsuite/ai/gateway
 */

import { PROBLEM_MEDIA_TYPE } from "@jxsuite/protocol/problem";
import { problemDetails } from "@jxsuite/protocol/problems";
import type { ProblemTypeName } from "@jxsuite/protocol/problems";
import type { GatewayRefusal } from "./types.ts";

/**
 * A refusal of one declared problem type, answered with that type's own status.
 *
 * @param {ProblemTypeName} name - A declared type from `PROBLEM_TYPES`
 * @param {string} detail - What happened this time; the line a human reads
 * @returns {GatewayRefusal}
 */
export function refusal(name: ProblemTypeName, detail: string): GatewayRefusal {
  const problem = problemDetails(name, detail);
  return { problem, status: problem.status };
}

/**
 * The response a refusal is answered with: `application/problem+json` at the refusal's status.
 *
 * One body satisfies both kinds of client. A problem reader keys on `type` and shows `detail`; an
 * older reader shows `error` and acts on `code`. So `error` is present whenever `detail` is (it
 * already is on a problem built by `problemDetails`, and is added here to one built by hand), and
 * the refusal's `code`, when it has one, rides beside them.
 *
 * @param {GatewayRefusal} refused - What was refused, and why
 * @returns {Response}
 */
export function problemResponse(refused: GatewayRefusal): Response {
  const { code, problem, status } = refused;
  const body = {
    ...problem,
    ...(problem.error === undefined && problem.detail !== undefined
      ? { error: problem.detail }
      : {}),
    ...(code === undefined ? {} : { code }),
  };
  // Response.json would send `application/json`; RFC 9457 §3 is what says this body is a problem.
  return Response.json(body, { headers: { "Content-Type": PROBLEM_MEDIA_TYPE }, status });
}

/**
 * The declared type for an upstream provider's status.
 *
 * The normalizer needs it for the one failure that arrives with a status of its own: an upstream
 * that answered non-2xx. The status itself is kept (as the frame's `code`), and the problem names
 * the KIND of failure, which is the part a client can act on. `@jxsuite/server`'s `problem.ts`
 * carries the same table for its own routes; `packages/server/tests/ai-api-gateway.test.ts` holds
 * the two to agreement.
 *
 * @param {number} status - The upstream's HTTP status
 * @returns {ProblemTypeName}
 */
export function problemTypeForStatus(status: number): ProblemTypeName {
  /* Any other status still becomes SOME type, and which side of 500 it falls on is what decides
     whether the caller is being told it made a mistake or that the upstream did. */
  return STATUS_TYPES[status] ?? (status >= 500 ? "internalError" : "invalidRequest");
}

/** The statuses the table distinguishes, each onto a type answered with that same status. */
const STATUS_TYPES: Readonly<Record<number, ProblemTypeName>> = {
  400: "invalidRequest",
  401: "unauthorized",
  403: "forbidden",
  404: "notFound",
  405: "methodNotAllowed",
  409: "conflict",
  413: "payloadTooLarge",
  501: "capabilityUnavailable",
  502: "upstreamFailure",
  503: "upstreamFailure",
  504: "upstreamFailure",
};
