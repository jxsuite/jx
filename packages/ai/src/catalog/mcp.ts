/**
 * A catalog member as the Model Context Protocol names a tool, and a tool result as MCP returns one
 * (specs/ai.md §3.10). Pure data: no MCP SDK is imported, so any host can serve them.
 *
 * @module @jxsuite/ai/catalog
 * @license MIT
 */

import type { Undoability } from "../jx-tools/types.ts";
import type { JSONSchema, ToolResult } from "../tools.ts";
import type { CatalogEntry } from "./catalog.ts";

/** A tool as an MCP `tools/list` result names it. */
export interface McpToolJson {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  /** All four, always stated: MCP's defaults are the opposite of a safe guess for some. */
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  _meta: { "com.jxsuite/undoable": Undoability };
}

/**
 * `entry` as an MCP tool. `undoable` is the serving host's: whether it can take the tool's writes
 * back.
 *
 * @param {CatalogEntry} entry
 * @param {{ undoable: Undoability }} facts
 * @returns {McpToolJson}
 */
export function toMcpTool(
  entry: CatalogEntry,
  { undoable }: { undoable: Undoability },
): McpToolJson {
  const { destructiveHint, idempotentHint, openWorldHint, readOnlyHint } = entry.annotations;
  return {
    _meta: { "com.jxsuite/undoable": undoable },
    annotations: { destructiveHint, idempotentHint, openWorldHint, readOnlyHint },
    description: entry.description,
    inputSchema: entry.parameters,
    name: entry.name,
    title: entry.title,
  };
}

/** An MCP `tools/call` result. */
export interface McpCallToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
}

/**
 * A tool result as MCP returns it: the summary, then the data as JSON, each its own text block; a
 * failure is its error, flagged. A success with neither is the result itself, as JSON.
 *
 * @param {ToolResult} result
 * @returns {McpCallToolResult}
 */
export function toCallToolResult(result: ToolResult): McpCallToolResult {
  if (!result.success) {
    return { content: [{ text: result.error ?? "The tool failed.", type: "text" }], isError: true };
  }
  const texts: string[] = [];
  if (result.summary !== undefined) {
    texts.push(result.summary);
  }
  if (result.data !== undefined) {
    texts.push(JSON.stringify(result.data));
  }
  if (texts.length === 0) {
    texts.push(JSON.stringify(result));
  }
  return { content: texts.map((text) => ({ text, type: "text" })) };
}
