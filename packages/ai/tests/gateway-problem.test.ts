/**
 * Tests for the gateway's refusals: `problemResponse`, `refusal` and the upstream status table.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPES, problemDetails } from "@jxsuite/protocol";
import type { ProblemTypeName } from "@jxsuite/protocol";
import { problemResponse, problemTypeForStatus, refusal } from "../src/gateway/problem.ts";
import type { GatewayRefusal } from "../src/gateway/types.ts";

describe("refusal", () => {
  it("answers with the declared type's own status", () => {
    for (const name of Object.keys(PROBLEM_TYPES) as ProblemTypeName[]) {
      const refused = refusal(name, "because");
      expect({ name, status: refused.status }).toEqual({
        name,
        status: PROBLEM_TYPES[name].status,
      });
      expect(refused.problem).toEqual(problemDetails(name, "because"));
    }
  });
});

describe("problemResponse", () => {
  it("is application/problem+json at the refusal's status, with the problem as its body", async () => {
    const response = problemResponse(refusal("unauthorized", "No key"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe(PROBLEM_MEDIA_TYPE);
    expect(await response.text()).toBe(JSON.stringify(problemDetails("unauthorized", "No key")));
  });

  it("uses the refusal's status even where it differs from the problem's", () => {
    const refused: GatewayRefusal = { problem: problemDetails("forbidden", "no"), status: 451 };
    expect(problemResponse(refused).status).toBe(451);
  });

  /* One body for two kinds of reader: a problem reader shows `detail`, an older one shows `error`
     and acts on `code`. */
  it.each<[string, GatewayRefusal, Record<string, unknown>]>([
    [
      "a code rides beside the problem",
      { code: "cf_reconnect_required", ...refusal("unauthorized", "Reconnect") },
      { ...problemDetails("unauthorized", "Reconnect"), code: "cf_reconnect_required" },
    ],
    [
      "a hand-built problem with a detail gains the error alias",
      {
        problem: { detail: "Slow down", status: 429, title: "Too many", type: "urn:x" },
        status: 429,
      },
      { detail: "Slow down", status: 429, title: "Too many", type: "urn:x", error: "Slow down" },
    ],
    [
      "an existing error alias is kept as it is",
      {
        problem: { detail: "d", error: "e", status: 400, title: "t", type: "urn:x" },
        status: 400,
      },
      { detail: "d", error: "e", status: 400, title: "t", type: "urn:x" },
    ],
    [
      "a problem with no detail gains no error",
      { problem: { status: 500, title: "t", type: "urn:x" }, status: 500 },
      { status: 500, title: "t", type: "urn:x" },
    ],
  ])("%s", async (_label, refused, body) => {
    const text = await problemResponse(refused).text();
    expect(text).toBe(JSON.stringify(body));
  });
});

describe("problemTypeForStatus", () => {
  it.each<[number, ProblemTypeName]>([
    [400, "invalidRequest"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notFound"],
    [405, "methodNotAllowed"],
    [409, "conflict"],
    [413, "payloadTooLarge"],
    [501, "capabilityUnavailable"],
    [502, "upstreamFailure"],
    [503, "upstreamFailure"],
    [504, "upstreamFailure"],
    // Unlisted: which side of 500 it falls on decides whose mistake it was.
    [418, "invalidRequest"],
    [429, "invalidRequest"],
    [500, "internalError"],
    [507, "internalError"],
  ])("%d is %s", (status, name) => {
    expect(problemTypeForStatus(status)).toBe(name);
  });

  it("maps every listed status to a type answered with that same status", () => {
    for (const status of [400, 401, 403, 404, 405, 409, 413, 500, 501, 502]) {
      expect(PROBLEM_TYPES[problemTypeForStatus(status)].status).toBe(status);
    }
  });
});
