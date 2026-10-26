/**
 * Every tool the assistant offers survives the neutral `ToolSpec` form byte for byte (specs/ai.md
 * §2.3), and each is a catalog member with its facts (specs/ai.md §3.10).
 *
 * A harness that is not OpenAI-compatible describes its tools as `ToolSpec`s and projects them back
 * with `toOpenAITools`, so the OpenAI-compatible request must not move by one byte for doing so:
 * not the member order, not a description, and not a command record's live enum, which
 * `listForLLM()` hands over by reference so it serializes as it stands that round.
 */
import "./with-dom.ts";
import { expect, test } from "bun:test";
import { createCatalog, TOOL_NAME_PATTERN, toMcpTool } from "@jxsuite/ai/catalog";
import { JX_TOOL_FACTS, toolFacts } from "@jxsuite/ai/jx-tools";
import { fromOpenAITools, toOpenAITools } from "@jxsuite/ai/messages";
import { withEveryTool } from "./harness/every-tool";

test("all 30 tools round-trip through ToolSpec byte for byte", async () => {
  await withEveryTool(({ composite }) => {
    const listed = composite.listForLLM();
    expect(listed).toHaveLength(30);

    const specs = fromOpenAITools(listed);
    expect(specs.map((spec) => spec.name)).toEqual(composite.list().map((t) => t.name));
    expect(JSON.stringify(toOpenAITools(specs))).toBe(JSON.stringify(listed));
  });
});

test("every tool is a catalog member with explicit facts, and the table names no other", async () => {
  await withEveryTool(({ commands, hand }) => {
    // C1: the catalog builds, so every name is valid and unique across the two sides.
    const catalog = createCatalog(hand.list(), commands.members());
    const names = catalog.entries.map((entry) => entry.name);
    expect(names.toSorted()).toEqual(Object.keys(JX_TOOL_FACTS).toSorted());
    for (const entry of catalog.entries) {
      expect(entry.annotations).toBe(toolFacts(entry.name)!.annotations);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});

test("every tool projects to MCP with its title, an object schema and all four hints", async () => {
  await withEveryTool(({ commands, hand }) => {
    for (const entry of createCatalog(hand.list(), commands.members()).entries) {
      const mcp = toMcpTool(entry, { undoable: "document" });
      expect(mcp.name).toMatch(TOOL_NAME_PATTERN);
      expect([mcp.name, mcp.inputSchema.type, Object.keys(mcp.annotations).length]).toEqual([
        entry.name,
        "object",
        4,
      ]);
      expect(mcp.title).toBe(entry.title);
    }
  });
});
