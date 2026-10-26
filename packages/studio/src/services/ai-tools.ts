/**
 * Ai-tools.js — Jx document manipulation tools for the AI assistant
 *
 * Concrete `.jx` AST tools registered into a `@jxsuite/ai` ToolRegistry. The tree tools are the
 * portable producers of `@jxsuite/ai/jx-tools` over the active tab, so AI edits get the same
 * undo/redo history as manual edits (specs/ai.md §3.1 and §3.2 — optimistic apply, undo as the
 * backstop); `create_page` and `create_component` write new files.
 *
 * @license MIT
 */

import { createToolDefinition } from "@jxsuite/ai/tools";
import type { ToolRegistry, ToolResult } from "@jxsuite/ai/tools";
import { docToolEntries } from "@jxsuite/ai/jx-tools";
import type { JsonObject } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import { validateDoc } from "./jx-validate";
import { invalidPathResult, normalizeRelPath } from "./project-path";
import { serializeJson } from "@jxsuite/schema/json-layout";
import { translateValidationError } from "./ai-write-report";
import type { CandidateDocument } from "./ai-write-report";
import { studioDocumentHost, studioWriteReporter } from "./harness/studio-documents";

/* Re-exported from its new home so `ai-project-tools.ts` and the tests keep their import: the
   translation moved with the verdict it belongs to (`ai-write-report.ts`), where every document
   write — hand-registered or projected from a command record — now reads it. */
export { translateValidationError } from "./ai-write-report";

/**
 * Register the document-manipulation tools into a tool registry.
 *
 * @param {import("@jxsuite/ai/tools").ToolRegistry} registry
 * @param {{
 *   getTab: () => import("../tabs/tab").Tab | null;
 *   validate?: (doc: CandidateDocument) => Promise<string[]>;
 *   saveFile?: (relPath: string, content: string) => Promise<void>;
 *   renderCheck?: (doc: CandidateDocument) => Promise<{ ok: true } | { ok: false; error: string }>;
 *   projectStyle?: Record<string, string>;
 *   getProjectStyle?: () => Record<string, string> | undefined;
 *   findOpenTab?: (path: string) => import("../tabs/tab").Tab | null;
 *   reloadTab?: (path: string) => Promise<void>;
 * }} ctx
 */
export function registerAiTools(
  registry: Pick<ToolRegistry, "register">,
  {
    getTab,
    validate = validateDoc,
    saveFile,
    renderCheck,
    projectStyle,
    getProjectStyle,
    findOpenTab,
    reloadTab,
  }: {
    getTab: () => Tab | null;
    validate?: (doc: CandidateDocument) => Promise<string[]>;
    saveFile?: (relPath: string, content: string) => Promise<void>;
    renderCheck?: (doc: CandidateDocument) => Promise<{ ok: true } | { ok: false; error: string }>;
    projectStyle?: Record<string, string> | undefined;
    /**
     * Live variant of `projectStyle` — takes precedence; re-read per tool call so a project
     * bootstrapped mid-session contributes its design tokens.
     */
    getProjectStyle?: () => Record<string, string> | undefined;
    /** The open tab whose documentPath equals a project-relative path (write reconciliation). */
    findOpenTab?: (path: string) => Tab | null;
    /** Reload an open tab's document from disk after a file write. */
    reloadTab?: (path: string) => Promise<void>;
  },
) {
  const styleOf = getProjectStyle ?? (() => projectStyle);

  /**
   * Guard a disk write against an open tab: refuse while the tab has unsaved changes (the write
   * would silently diverge from the editor). Returns null when the write may proceed.
   */
  function dirtyTabError(relPath: string): ToolResult | null {
    const tab = findOpenTab?.(relPath);
    if (tab?.doc.dirty) {
      return {
        success: false,
        error:
          `"${relPath}" is open in the editor with unsaved changes. Use open_document plus the ` +
          `document tools to edit it, or ask the user to save or discard their changes first.`,
      };
    }
    return null;
  }

  /** Refresh an open (clean) tab from disk after a write; annotate the summary accordingly. */
  async function reconcileAfterWrite(relPath: string, summary: string): Promise<string> {
    if (findOpenTab?.(relPath)) {
      await reloadTab?.(relPath);
      return `${summary} The file's open editor tab was refreshed. (Saved to disk; not undoable.)`;
    }
    return `${summary} (Saved to disk; not undoable.)`;
  }
  /* `read_document` and the seven tree tools are the portable producers of `@jxsuite/ai/jx-tools`,
     run over the active tab: each plans its edit as doc ops, and the tab applies them as one
     transaction the turn's batch lane, history and collaborators all see (specs/ai.md §3.9). */
  const host = studioDocumentHost({ getTab });
  const reporter = studioWriteReporter(host, {
    getProjectStyle: styleOf,
    renderCheck,
    validate,
  });
  for (const entry of docToolEntries(host, { reporter })) {
    registry.register(entry);
  }

  // ── create_component ───────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_component",
      description:
        "Create a new Jx component file on disk. Writes the component JSON to the given " +
        "relative path within the project. The content must be a valid Jx component document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'File path relative to the project root, e.g. "components/newsletter-form.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx component JSON (must include tagName, optionally state, style, children, $elements).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args, ctx) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present string and `content` a present JSON object (not an array, not null). Whether that
           object is a Jx document is what `validate` and `renderCheck` below decide. */
        const { path, content } = args as { path: string; content: JsonObject };
        // Inside the project or not at all (ai.md §4): the platform write is given this path.
        const relPath = normalizeRelPath(path);
        if (relPath === null) {
          return invalidPathResult(path);
        }
        const dirtyError = dirtyTabError(relPath);
        if (dirtyError) {
          return dirtyError;
        }
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Component content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (renderCheck) {
          const renderResult = await renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Component is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          // The save serializer, layout-less (`@jxsuite/schema/json-layout`): the assistant supplied a
          // Value, not a text, so the formatter's layout for fresh output is the right one.
          await saveFile(relPath, serializeJson(content, null));
          ctx.ledger.record({ disk: true, ok: true, path: relPath, tool: "create_component" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created component at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ledger.record({
            disk: true,
            error: message,
            ok: false,
            path: relPath,
            tool: "create_component",
          });
          return {
            success: false,
            error: `Failed to write file: ${message}`,
          };
        }
      },
    }),
  );

  // ── create_page ────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_page",
      description:
        "Create a new Jx page file on disk. A page typically includes a layout component and " +
        "section children. The content must be a valid Jx page document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'File path relative to the project root, e.g. "pages/about.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx page JSON (typically includes $elements to import a layout, children for sections).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args, ctx) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present string and `content` a present JSON object (not an array, not null). Whether that
           object is a Jx document is what `validate` and `renderCheck` below decide. */
        const { path, content } = args as { path: string; content: JsonObject };
        const relPath = normalizeRelPath(path);
        if (relPath === null) {
          return invalidPathResult(path);
        }
        const dirtyError = dirtyTabError(relPath);
        if (dirtyError) {
          return dirtyError;
        }
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Page content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (renderCheck) {
          const renderResult = await renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Page is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          // As `create_component`: a value the assistant supplied, written in the formatter's layout.
          await saveFile(relPath, serializeJson(content, null));
          ctx.ledger.record({ disk: true, ok: true, path: relPath, tool: "create_page" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created page at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ledger.record({
            disk: true,
            error: message,
            ok: false,
            path: relPath,
            tool: "create_page",
          });
          return {
            success: false,
            error: `Failed to write file: ${message}`,
          };
        }
      },
    }),
  );

  /*
   * `open_document` is NOT here any more. It is the projection of the `document.open` record
   * (`workspace/workspace.ts`'s `tabCommands`), so the person's palette row and the model's tool
   * are one `run` and one gate (`studio-ui-guidelines.md` §12.4). The hand tool read `getTab()`
   * after the open and called whatever it found a success — a missing file left the previous
   * document active and reported "Switched to" — and it re-anchored the undo batch itself, which
   * `tool-executor.ts` has done after EVERY tool since project adoption started replacing tabs
   * mid-loop.
   */
}
