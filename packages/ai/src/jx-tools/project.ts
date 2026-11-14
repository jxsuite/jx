/**
 * Project.ts — the project's file tools, over whatever holds the project (specs/ai.md §3.14).
 *
 * `list_files`, `read_file`, `write_file` and `search_files` are the same four tools wherever the
 * assistant runs: what the model is told about them, the caps on what they answer, and the
 * containment check are here. What differs per host is where the files are and what must hold
 * before one is overwritten, and that is a {@link ProjectHost}: Studio's is over its platform
 * adapter, a headless run's over a directory.
 *
 * The descriptions, the summaries and the refusals are the ones Studio's tools have always given,
 * moved here unchanged: they are what the model reads.
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 */

import type { JsonValue } from "../core-types.ts";
import { createToolDefinition } from "../tools.ts";
import type { ToolDefinition, ToolResult } from "../tools.ts";
import { JX_TOOL_FACTS } from "./facts.ts";

/** Directories the file tools never descend into or report. */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git", ".jx-cache"]);

/** Caps keeping tool results inside a conversation's budget. */
const LIST_CAP = 200;
const SEARCH_CAP = 100;
const READ_CAP_BYTES = 48 * 1024;
const WRITE_CAP_BYTES = 256 * 1024;

const NOT_UNDOABLE = "(saved to disk; not undoable with Cmd+Z)";

/** One entry of a directory, as a host lists it. */
export interface ProjectEntry {
  /** The entry's own name. When empty, the last segment of `path` is used. */
  readonly name: string;
  /** Its project-relative path. When empty, the directory listed and its name are joined. */
  readonly path: string;
  /** `"file"` or `"directory"`; a host's other kinds are reported as it names them. */
  readonly type: string;
  /** Its size in bytes, when the host knows it. */
  readonly size?: number | undefined;
}

/**
 * What a host says about a write before it happens: that it must not (with the sentence the model
 * reads), or that it may, with anything worth telling the model afterwards and anything the host
 * has to do once the bytes are on disk.
 */
export type WriteVerdict =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      /** Advice appended to the tool's answer, after a blank line. */
      readonly hints?: string;
      /**
       * Runs after the file is written: what the host reconciles with it (an open editor, a held
       * configuration). The text it answers goes into the summary straight after the path, as in
       * `Wrote "a.json" and refreshed its open editor tab`; an empty one adds nothing.
       */
      readonly afterWrite?: () => Promise<string> | string;
    };

/** Where the file tools find a project's files. Every path is project-relative. */
export interface ProjectHost {
  /** The entries directly inside `dir`. Rejects when it cannot be listed. */
  readonly list: (dir: string) => Promise<readonly ProjectEntry[]>;
  /** A file's text. Rejects, with a message the model can act on, when it cannot be read. */
  readonly read: (path: string) => Promise<string>;
  /** Write a file, creating or replacing it. Rejects when it cannot be written. */
  readonly write: (path: string, text: string) => Promise<void>;
  /** Files whose NAME matches `query`, optionally narrowed to some extensions. */
  readonly search: (
    query: string,
    extensions?: readonly string[],
  ) => Promise<readonly { readonly path: string }[]>;
  /**
   * What must hold before `text` replaces `path`. A host that can take a write back needs none; one
   * that cannot (a disk has no undo) validates here, because nothing later can. Absent, every write
   * inside the project is allowed.
   */
  readonly beforeWrite?: (path: string, text: string) => Promise<WriteVerdict>;
}

/**
 * True when a tool argument is a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/**
 * True when a size a host reported is a number.
 *
 * @param {number | undefined} value
 * @returns {boolean}
 */
function isNumber(value: number | undefined): value is number {
  return typeof value === "number";
}

/**
 * Normalize a project-relative path, or answer null when it escapes the project: an absolute path,
 * a `..` segment, a drive letter, a home directory. Every file tool runs it before it touches
 * anything (specs/ai.md §4); a host still enforces containment itself, and this keeps the refusal
 * one the model can act on.
 *
 * @param {JsonValue | undefined} path - A tool argument as the model sent it: any JSON value, or
 *   absent
 * @returns {string | null}
 */
export function normalizeProjectPath(path: JsonValue | undefined): string | null {
  if (!isString(path) || !path.trim()) {
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
 * The refusal a tool answers for a path {@link normalizeProjectPath} rejected, quoting what the
 * model sent so it can see what to change.
 *
 * @param {JsonValue | undefined} path - The tool argument as the model sent it
 * @returns {ToolResult}
 */
export function invalidPathResult(path: JsonValue | undefined): ToolResult {
  return {
    success: false,
    error: `Invalid path ${JSON.stringify(path)} — use a path relative to the project root (no leading "/", no "..").`,
  };
}

/**
 * What a failure says: an Error's message, or the value itself as text.
 *
 * @param {unknown} cause - What a host's call rejected with
 * @returns {string}
 */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** One row of `list_files`'s answer. `size` is omitted when the host reports none. */
interface ListedEntry {
  path: string;
  type: string;
  size?: number;
}

function listFiles(host: ProjectHost): ToolDefinition {
  return createToolDefinition({
    name: "list_files",
    title: "List files",
    annotations: JX_TOOL_FACTS.list_files.annotations,
    description:
      "List the project's files recursively (paths relative to the project root, with type and " +
      "size). Use this to discover pages, layouts, components, content, data, and styles before " +
      "reading or writing files. Build folders (node_modules, dist, .git) are excluded.",
    parameters: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: 'Directory to list, relative to the project root. Omit for the root (".").',
        },
      },
      required: [],
    },
    async execute(args) {
      /* SAFETY: a strict tool runs only after the registry's `validate()` passed, which refuses
         a `dir` that is present but not a string. */
      const { dir } = args as { dir?: string };
      const start = dir === undefined || dir === "" ? "." : normalizeProjectPath(dir);
      if (start === null) {
        return invalidPathResult(dir);
      }
      const entries: ListedEntry[] = [];
      const queue = [start];
      let truncated = false;
      while (queue.length > 0 && !truncated) {
        const current = queue.shift()!;
        let children;
        try {
          children = await host.list(current);
        } catch {
          continue;
        }
        for (const e of children) {
          const name = e.name || e.path.split("/").pop() || "";
          if (EXCLUDED_DIRS.has(name) || name.startsWith(".")) {
            continue;
          }
          const path = e.path || (current === "." ? name : `${current}/${name}`);
          if (entries.length >= LIST_CAP) {
            truncated = true;
            break;
          }
          const entry: ListedEntry = { path, type: e.type };
          if (isNumber(e.size)) {
            entry.size = e.size;
          }
          entries.push(entry);
          if (e.type === "directory") {
            queue.push(path);
          }
        }
      }
      return {
        success: true,
        data: { entries, truncated },
        summary: `Listed ${entries.length} entries under "${start}"${truncated ? ` (truncated at ${LIST_CAP})` : ""}.`,
      };
    },
  });
}

function readFile(host: ProjectHost): ToolDefinition {
  return createToolDefinition({
    name: "read_file",
    title: "Read a file",
    annotations: JX_TOOL_FACTS.read_file.annotations,
    description:
      "Read a project file's content by its project-relative path. Works for any text file " +
      "(Jx documents, markdown, CSS, data). Large files are truncated.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Project-relative file path, e.g. "pages/about.json".',
        },
      },
      required: ["path"],
    },
    async execute(args) {
      /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so the
         required `path` is present and a string. */
      const { path } = args as { path: string };
      const relPath = normalizeProjectPath(path);
      if (relPath === null) {
        return invalidPathResult(path);
      }
      try {
        const content = await host.read(relPath);
        if (content.length > READ_CAP_BYTES) {
          return {
            success: true,
            data: {
              content: `${content.slice(0, READ_CAP_BYTES)}\n… [truncated: file is ${content.length} bytes, showing first ${READ_CAP_BYTES}]`,
              truncated: true,
            },
          };
        }
        return { success: true, data: { content, truncated: false } };
      } catch (error) {
        return { success: false, error: `Failed to read "${relPath}": ${messageOf(error)}` };
      }
    },
  });
}

function writeFile(host: ProjectHost): ToolDefinition {
  return createToolDefinition({
    name: "write_file",
    title: "Write a file",
    annotations: JX_TOOL_FACTS.write_file.annotations,
    description:
      "Write a project file (create or overwrite) at a project-relative path. Jx documents " +
      "(.json under pages/, layouts/, components/) are schema-validated and render-checked " +
      "before writing — fix reported errors and retry. Refused while the target file is open " +
      "with unsaved changes. Disk writes are not undoable.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Project-relative file path, e.g. "components/footer.json".',
        },
        content: {
          type: "string",
          description: "The complete new file content (full file, not a diff).",
        },
      },
      required: ["path", "content"],
    },
    async execute(args, ctx) {
      /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so the required
         `path` and `content` are both present and strings. */
      const { path, content } = args as { path: string; content: string };
      const relPath = normalizeProjectPath(path);
      if (relPath === null) {
        return invalidPathResult(path);
      }
      if (content.length > WRITE_CAP_BYTES) {
        return {
          success: false,
          error: `Content is ${content.length} bytes — the write cap is ${WRITE_CAP_BYTES}. Split the content across smaller files.`,
        };
      }

      // The host's say comes before anything is written: a disk write has no undo to lean on.
      const verdict = (await host.beforeWrite?.(relPath, content)) ?? { ok: true };
      if (!verdict.ok) {
        return { success: false, error: verdict.error };
      }

      try {
        await host.write(relPath, content);
        /* Disk, not transaction: there is no undo behind this and there never was. Recorded as
           `disk: true` so a host can say so to the person holding ⌘Z (specs/ai.md §3.2). */
        ctx.ledger.record({ disk: true, ok: true, path: relPath, tool: "write_file" });
      } catch (error) {
        const message = messageOf(error);
        ctx.ledger.record({
          disk: true,
          error: message,
          ok: false,
          path: relPath,
          tool: "write_file",
        });
        return { success: false, error: `Failed to write "${relPath}": ${message}` };
      }

      const reconciled = verdict.afterWrite ? await verdict.afterWrite() : "";
      const summary = `Wrote "${relPath}"${reconciled} ${NOT_UNDOABLE}.`;
      return { success: true, summary: verdict.hints ? `${summary}\n\n${verdict.hints}` : summary };
    },
  });
}

function searchFiles(host: ProjectHost): ToolDefinition {
  return createToolDefinition({
    name: "search_files",
    title: "Search files",
    annotations: JX_TOOL_FACTS.search_files.annotations,
    description:
      "Search project files by file NAME (not content). Returns matching paths. Use list_files " +
      "for a directory overview and read_file to inspect contents.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Substring of the file name, e.g. "hero".' },
        extensions: {
          type: "array",
          description: 'Optional extension filter, e.g. [".json", ".md"].',
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
    async execute(args) {
      /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `query` is a
         present string and `extensions`, when present, an array. Its items are not checked here;
         the host's search receives them as given. */
      const { query, extensions } = args as { query: string; extensions?: string[] };
      try {
        const results = await host.search(query, extensions);
        const paths = results.map((r) => r.path).slice(0, SEARCH_CAP);
        return {
          success: true,
          data: { paths, truncated: results.length > SEARCH_CAP },
          summary: `Found ${paths.length} file(s) matching "${query}".`,
        };
      } catch (error) {
        return { success: false, error: `Search failed: ${messageOf(error)}` };
      }
    },
  });
}

/**
 * `list_files`, `read_file`, `write_file` and `search_files` over `host`, in the order the model
 * has always been offered them.
 *
 * @param {ProjectHost} host
 * @returns {ToolDefinition[]}
 */
export function projectToolEntries(host: ProjectHost): ToolDefinition[] {
  return [listFiles(host), readFile(host), writeFile(host), searchFiles(host)];
}
