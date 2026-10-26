/**
 * Tool catalogs (specs/ai.md §3.10): membership, the view a host takes over it, and the MCP
 * projection of a member and of a result.
 */
import { describe, expect, test } from "bun:test";
import {
  catalogRegistry,
  CatalogError,
  createCatalog,
  toCallToolResult,
  TOOL_NAME_PATTERN,
  toMcpTool,
} from "../src/catalog/index.ts";
import type { CatalogEntry } from "../src/catalog/index.ts";
import { JX_TOOL_FACTS, toolFacts } from "../src/jx-tools/index.ts";
import { createToolDefinition } from "../src/tools.ts";
import type { ToolAnnotations, ToolDefinition } from "../src/tools.ts";

const HINTS: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

function tool(name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    ...createToolDefinition({
      annotations: HINTS,
      description: `${name} does it`,
      execute: () => ({ success: true, summary: `${name} ran` }),
      name,
      parameters: { properties: { n: { type: "number" } }, required: [], type: "object" },
      title: name.toUpperCase(),
    }),
    ...extra,
  };
}

function refusal(build: () => void): CatalogError {
  try {
    build();
  } catch (error) {
    if (error instanceof CatalogError) {
      return error;
    }
  }
  throw new Error("expected a CatalogError");
}

describe("createCatalog", () => {
  test("keeps every group's members in the order given", () => {
    const catalog = createCatalog([tool("b"), tool("a")], [], [tool("c")]);
    expect(catalog.entries.map((entry) => entry.name)).toEqual(["b", "a", "c"]);
    expect(catalog.get("a")?.title).toBe("A");
    expect(catalog.get("z")).toBeUndefined();
  });

  test("refuses a duplicate, a bad name, a non-object schema, and a missing title or hints", () => {
    const duplicate = refusal(() => createCatalog([tool("a")], [tool("a")]));
    expect([duplicate.code, duplicate.message, duplicate.name]).toEqual([
      "duplicate",
      'Tool "a" is in the catalog twice.',
      "CatalogError",
    ]);
    for (const name of ["", "has space", "x".repeat(65), "dotted.name"]) {
      expect(refusal(() => createCatalog([tool(name)])).code).toBe("name");
    }
    expect(TOOL_NAME_PATTERN.test("x".repeat(64))).toBe(true);
    expect(refusal(() => createCatalog([tool("a", { parameters: { type: "array" } })])).code).toBe(
      "schema",
    );
    const { title: _title, ...untitled } = tool("a");
    const { annotations: _hints, ...unhinted } = tool("b");
    expect(refusal(() => createCatalog([untitled])).code).toBe("annotations");
    expect(refusal(() => createCatalog([unhinted])).code).toBe("annotations");
  });
});

describe("catalogRegistry", () => {
  test("with no view, offers and runs every member", async () => {
    const registry = catalogRegistry(createCatalog([tool("a"), tool("b")]));
    expect(registry.list().map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(registry.listForLLM()).toEqual([
      {
        function: { description: "a does it", name: "a", parameters: tool("a").parameters },
        type: "function",
      },
      {
        function: { description: "b does it", name: "b", parameters: tool("b").parameters },
        type: "function",
      },
    ]);
    expect(await registry.execute("a", {})).toEqual({ success: true, summary: "a ran" });
    expect(registry.getDefinition("b")?.name).toBe("b");
    expect(registry.validate("a", { n: "x" })).toEqual({
      errors: ['Argument "n" should be a number, got non-numeric string "x"'],
      valid: false,
    });
    expect(await registry.execute("nope", {})).toEqual({
      error: 'Unknown tool: "nope"',
      success: false,
    });
  });

  test("the gate withholds a member and refuses its call, naming what it requires", async () => {
    const seen: (object | null)[] = [];
    const registry = catalogRegistry(createCatalog([tool("open"), tool("shut")]), {
      gate(entry, args) {
        seen.push(args);
        return entry.name === "shut" ? "an open project" : null;
      },
    });
    expect(registry.listForLLM()).toHaveLength(1);
    expect(registry.list()).toHaveLength(2);
    expect(await registry.execute("shut", { n: 1 })).toEqual({
      error: 'Tool "shut" is not available right now — it requires an open project.',
      success: false,
    });
    expect(await registry.execute("open", {})).toEqual({ success: true, summary: "open ran" });
    expect(seen).toContainEqual({ n: 1 });
    expect(seen).toContain(null);
  });

  test("advertise narrows the listing without refusing the call", async () => {
    const registry = catalogRegistry(createCatalog([tool("a"), tool("quiet")]), {
      advertise: (entry: CatalogEntry) => entry.name !== "quiet",
    });
    expect(JSON.stringify(registry.listForLLM())).not.toContain("quiet");
    expect(await registry.execute("quiet", {})).toEqual({ success: true, summary: "quiet ran" });
  });

  test("a catalog given as a function is read on every call", () => {
    let members = [tool("a")];
    const registry = catalogRegistry(() => createCatalog(members));
    expect(registry.list().map((entry) => entry.name)).toEqual(["a"]);
    members = [tool("a"), tool("b")];
    expect(registry.listForLLM()).toHaveLength(2);
  });

  test("a catalog is not registered into", () => {
    expect(() => catalogRegistry(createCatalog()).register(tool("a"))).toThrow(TypeError);
  });
});

describe("the MCP projection", () => {
  const entry = createCatalog([tool("read_it")]).entries[0]!;

  test("names a member with every hint stated and the host's undo", () => {
    expect(toMcpTool(entry, { undoable: "none" })).toEqual({
      _meta: { "com.jxsuite/undoable": "none" },
      annotations: HINTS,
      description: "read_it does it",
      inputSchema: entry.parameters,
      name: "read_it",
      title: "READ_IT",
    });
  });

  test("returns a summary, then the data as JSON, each as its own text", () => {
    expect(toCallToolResult({ data: { a: 1 }, success: true, summary: "Did it." })).toEqual({
      content: [
        { text: "Did it.", type: "text" },
        { text: '{"a":1}', type: "text" },
      ],
    });
    expect(toCallToolResult({ success: true })).toEqual({
      content: [{ text: '{"success":true}', type: "text" }],
    });
  });

  test("flags a failure with its error", () => {
    expect(toCallToolResult({ error: "No.", success: false })).toEqual({
      content: [{ text: "No.", type: "text" }],
      isError: true,
    });
    expect(toCallToolResult({ success: false }).content[0]?.text).toBe("The tool failed.");
  });
});

describe("the Jx tool facts", () => {
  test("states all four hints for every tool, and are found by name", () => {
    for (const [name, facts] of Object.entries(JX_TOOL_FACTS)) {
      expect([name, Object.keys(facts.annotations).toSorted()]).toEqual([
        name,
        ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"],
      ]);
      expect(toolFacts(name)).toBe(facts);
    }
    expect(toolFacts("toString")).toBeUndefined();
  });

  test("a read-only tool is neither destructive nor writing", () => {
    for (const [name, { annotations, effect }] of Object.entries(JX_TOOL_FACTS)) {
      if (annotations.readOnlyHint) {
        expect([name, annotations.destructiveHint, effect]).toEqual([name, false, "none"]);
      }
    }
  });
});
