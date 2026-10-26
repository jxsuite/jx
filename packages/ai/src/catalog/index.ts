/**
 * `@jxsuite/ai/catalog`: a host's tools as one catalog (specs/ai.md §3.10). Membership is decided
 * once, by `createCatalog`, which refuses a duplicate or malformed tool; what the model is offered
 * each round, and which calls are refused, is the host's view over it. `toMcpTool` and
 * `toCallToolResult` project members and results into MCP's shapes.
 *
 * Worker-safe: the module graph is this directory, `../tools.ts` and `@jxsuite/schema/guards`.
 *
 * @module @jxsuite/ai/catalog
 * @license MIT
 * @docs extending/embedding/assistant-harness
 */

export { catalogRegistry, CatalogError, createCatalog, TOOL_NAME_PATTERN } from "./catalog.ts";
export type { Catalog, CatalogEntry, CatalogView, Gate } from "./catalog.ts";
export { toCallToolResult, toMcpTool } from "./mcp.ts";
export type { McpCallToolResult, McpToolJson } from "./mcp.ts";
