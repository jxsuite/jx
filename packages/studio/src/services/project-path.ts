/**
 * Project-path.ts — the containment check the assistant's file tools run before they touch disk.
 *
 * `ai.md` §4: a file tool refuses a path outside the open project itself, rather than leaving the
 * server to. `list_files`, `read_file` and `write_file` always refused one; `create_component`
 * and `create_page` took the model's path as given and handed it to the platform write. One module,
 * so the two sets of tools cannot disagree about what "inside the project" means, and a leaf,
 * because the document tools and the project tools already import each other's neighbours.
 *
 * @docs studio/ai/chat
 * @license MIT
 */

import type { ToolResult } from "@jxsuite/ai/tools";

/**
 * Normalize a project-relative path, or return null when it escapes the project (absolute paths,
 * `..` segments, drive letters, a home directory). The server re-checks; this keeps the error
 * actionable.
 *
 * @param {unknown} path
 * @returns {string | null}
 */
export function normalizeRelPath(path: unknown): string | null {
  if (typeof path !== "string" || !path.trim()) {
    return null;
  }
  let p = path.trim().replaceAll("\\", "/");
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p)) {
    return null;
  }
  if (p.split("/").includes("..")) {
    return null;
  }
  return p;
}

/**
 * The refusal a tool returns for a path {@link normalizeRelPath} rejected, quoting what the model
 * sent so it can see what to change.
 *
 * @param {unknown} path
 * @returns {ToolResult}
 */
export function invalidPathResult(path: unknown): ToolResult {
  return {
    success: false,
    error: `Invalid path ${JSON.stringify(path)} — use a path relative to the project root (no leading "/", no "..").`,
  };
}
