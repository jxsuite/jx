/**
 * The AI proxy runs `@jxsuite/ai/gateway` (specs/ai.md §2.4), and this suite holds the one place
 * where the two packages carry the same table twice.
 *
 * The frames themselves are proven by `ai-upstream-fixtures.test.ts`, whose goldens were recorded
 * from this server before the extraction and pass unchanged after it. What a fixture cannot cover
 * is every status: the gateway maps an upstream's non-2xx status onto a problem type with its own
 * copy of `problemTypeForStatus` (it cannot import this package), and a status no fixture uses
 * could drift between the two unseen. So every status outside 2xx is driven through the gateway's
 * normalizer here and compared with this server's table.
 *
 * @module @jxsuite/server/tests
 */

import { describe, expect, it } from "bun:test";
import { normalizeOpenAIStream } from "@jxsuite/ai/gateway";
import { problemDetails } from "@jxsuite/protocol";
import { problemTypeForStatus } from "../src/problem.ts";

/** The problem `type` the gateway's normalizer attaches to an upstream answering `status`. */
async function gatewayTypeFor(status: number): Promise<unknown> {
  const upstream = {
    ok: false,
    status,
    statusText: "",
    text: () => Promise.resolve("upstream refused"),
  } as unknown as Response;
  for await (const frame of normalizeOpenAIStream(upstream)) {
    return (frame as { problem?: { type?: unknown } }).problem?.type;
  }
  return undefined;
}

describe("the gateway's status table agrees with this server's", () => {
  it("for every status outside 2xx", async () => {
    const disagreements: string[] = [];
    for (let status = 100; status < 600; status += 1) {
      if (status >= 200 && status < 300) {
        continue;
      }
      const expected = problemDetails(problemTypeForStatus(status)).type;
      const actual = await gatewayTypeFor(status);
      if (actual !== expected) {
        disagreements.push(`${String(status)}: gateway ${String(actual)}, server ${expected}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
