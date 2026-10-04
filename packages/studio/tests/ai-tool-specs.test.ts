/**
 * Every tool the assistant offers survives the neutral `ToolSpec` form byte for byte (specs/ai.md
 * §2.3).
 *
 * A harness that is not OpenAI-compatible describes its tools as `ToolSpec`s and projects them back
 * with `toOpenAITools`, so the OpenAI-compatible request must not move by one byte for doing so:
 * not the member order, not a description, and not a command record's live enum, which
 * `listForLLM()` hands over by reference so it serializes as it stands that round.
 */
import "./with-dom.ts";
import { expect, test } from "bun:test";
import { fromOpenAITools, toOpenAITools } from "@jxsuite/ai/messages";
import { withEveryTool } from "./harness/every-tool";

test("all 29 tools round-trip through ToolSpec byte for byte", async () => {
  await withEveryTool(({ composite }) => {
    const listed = composite.listForLLM();
    expect(listed).toHaveLength(29);

    const specs = fromOpenAITools(listed);
    expect(specs.map((spec) => spec.name)).toEqual(composite.list().map((t) => t.name));
    expect(JSON.stringify(toOpenAITools(specs))).toBe(JSON.stringify(listed));
  });
});
