/**
 * Studio-project.ts — the project the assistant's file tools read and write, as Studio holds it
 * (specs/ai.md §3.14).
 *
 * The four file tools are `@jxsuite/ai/jx-tools`'s. This is their host: the files are the platform
 * adapter's, and a write has to pass what a disk write in Studio must, because nothing can take one
 * back:
 *
 * - A file open in the editor with unsaved changes is not overwritten underneath it.
 * - A Jx document is schema-validated and render-checked before it is written, and a project file is
 *   checked against the project's own entry schema, less the errors it already had.
 * - Afterwards an open editor is reloaded from disk, and a written project file is handed to the
 *   configuration document rather than read back.
 *
 * @license MIT
 * @docs studio/ai/chat
 */

import type { ProjectHost, WriteVerdict } from "@jxsuite/ai/jx-tools";
import { isJsonObject } from "@jxsuite/schema/guards";
import { classifyJxn, isJxnPath, isNativeDocumentPath, parseJxn } from "@jxsuite/schema/jxn";
import { isProjectConfigPath, parseProjectSource } from "@jxsuite/schema/project-file";
import type { JsonValue, JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";
import { getPlatform } from "../../platform";
import { projectState } from "../../store";
import { projectConfigPath } from "../../tabs/tab";
import type { Tab } from "../../tabs/tab";
import { translateValidationError } from "../ai-tools";
import type { CandidateDocument, RenderProbe } from "../ai-write-report";
import { flagHardcodedTokens, formatTokenHints } from "../token-lint";

/**
 * Whether a project-relative path conventionally holds a Jx document. Kept in step with
 * monaco-setup.ts's DOCUMENT_FILE_MATCH so the assistant's gate and the editor's diagnostics cover
 * the same files — `elements/` used to be missing here and validated only by the
 * {@link looksLikeJxDoc} sniff.
 */
function isJxDocPath(path: string): boolean {
  return /^(pages|layouts|components|elements)\//.test(path) && isNativeDocumentPath(path);
}

/** Structural sniff for Jx-document-shaped JSON values. */
function looksLikeJxDoc(value: JsonValue): boolean {
  return isJsonObject(value) && ("tagName" in value || "$id" in value || "$elements" in value);
}

/** What Studio's project host is built from: the gates a write passes, and the editor it tells. */
export interface StudioProjectDeps {
  validate: (doc: CandidateDocument) => Promise<string[]>;
  /** Gate for the project file: the per-project entry document, not the document schema. */
  validateProject: (config: ProjectConfig | JsonValue) => Promise<string[]>;
  renderCheck?: RenderProbe | undefined;
  /** Live getter — the project style appears only after a project is open/bootstrapped. */
  getProjectStyle?: (() => Record<string, string> | undefined) | undefined;
  /** The open tab whose `documentPath` equals the given project-relative path, if any. */
  findOpenTab: (path: string) => Tab | null;
  /** Reload an open tab's document from disk (files.ts `reloadFileInTab`). */
  reloadTab: (path: string) => Promise<void>;
  /** Fired, and awaited, after a successful project-file write (see `ProjectToolsCtx`). */
  onProjectConfigWritten?:
    | ((config: ProjectConfig, text: string) => void | Promise<void>)
    | undefined;
}

/**
 * The open project as the assistant's file tools reach it.
 *
 * @param {StudioProjectDeps} deps
 * @returns {ProjectHost}
 */
export function studioProjectHost({
  validate,
  validateProject,
  renderCheck,
  getProjectStyle,
  findOpenTab,
  reloadTab,
  onProjectConfigWritten,
}: StudioProjectDeps): ProjectHost {
  /** What must hold before `content` replaces `relPath`, and what follows once it has. */
  async function beforeWrite(relPath: string, content: string): Promise<WriteVerdict> {
    // Reconcile with an open tab BEFORE writing: a dirty tab would silently diverge from disk.
    const openTab = findOpenTab(relPath);
    if (openTab?.doc.dirty) {
      return {
        ok: false,
        error:
          `"${relPath}" is open in the editor with unsaved changes. Use open_document plus the ` +
          `document tools to edit it, or ask the user to save or discard their changes first.`,
      };
    }

    // Pre-validate Jx documents — disk writes have no undo to lean on.
    let parsed: JsonValue | undefined;
    const isConfig = isProjectConfigPath(relPath);
    if (isConfig && relPath !== projectConfigPath()) {
      // Writing the other name would leave the folder holding both, which no host reads.
      return {
        ok: false,
        error:
          `This project's file is ${projectConfigPath()}. Write the configuration there; ` +
          `a second project file beside it would stop the project from loading.`,
      };
    }
    if (isJxnPath(relPath) && !isConfig && classifyJxn(content) === "project") {
      return {
        ok: false,
        error:
          `"${relPath}" starts with a project node, which only the project file at the ` +
          `root may: write it there as project.jxn, or start this one with an element.`,
      };
    }
    const isJxn = isJxnPath(relPath) && !isConfig;
    const isJson = relPath.endsWith(".json") && !isConfig;
    if (isJxn) {
      try {
        const document = parseJxn(content);
        parsed = isJsonObject(document) ? document : null;
      } catch (error) {
        return {
          ok: false,
          error: `Content is not valid Jx Notation: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else if (isJson) {
      try {
        // SAFETY: `JSON.parse` without a reviver yields nothing but JSON values.
        parsed = JSON.parse(content) as JsonValue;
      } catch (error) {
        return {
          ok: false,
          error: `Content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    let tokenHints = "";
    // The parse above sets `parsed` exactly when one of those holds: it never yields `undefined`.
    if (parsed !== undefined && (isJxDocPath(relPath) || looksLikeJxDoc(parsed))) {
      const errors = await validate(parsed);
      if (errors.length > 0) {
        const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
        return {
          ok: false,
          error: `Document has schema errors — nothing was written. Fix these and retry:\n${formatted}`,
        };
      }
      if (renderCheck) {
        const renderResult = await renderCheck(parsed, { documentPath: relPath });
        if (!renderResult.ok) {
          return {
            ok: false,
            error: `Document is schema-valid but fails to render — nothing was written. Fix and retry:\n- ${renderResult.error}`,
          };
        }
      }
      const projectStyle = getProjectStyle?.();
      if (projectStyle) {
        tokenHints = formatTokenHints(
          /* SAFETY: `flagHardcodedTokens` re-checks every member it reads — object-ness, each
               `style` value as a string, `children` as an array — so a JSON value that is not
               quite a node is read defensively; its parameter type names the intended input. */
          flagHardcodedTokens(parsed as JxMutableNode, projectStyle),
        );
      }
    }

    /* Parsed as `unknown` because that is what it is until the schema says otherwise — this is
         model-authored text, and the gate below is the whole reason we do not trust its shape. */
    let projectConfig: ProjectConfig | undefined;
    if (isProjectConfigPath(relPath)) {
      let parsedConfig: ProjectConfig;
      try {
        parsedConfig = parseProjectSource(content, relPath);
      } catch (error) {
        return {
          ok: false,
          error: `${relPath} must read as a project file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      /* The per-project entry document closes the composition over every enabled extension
           (extensions.md §5.2), so this is what catches a typo'd section key or a misshapen
           extension section. Without it the model shipped config its own tool call called clean
           and Monaco flagged the moment a human opened the file.

           Errors the file ALREADY had are subtracted, the same way `services/ai-tools.ts`
           subtracts them from a document edit: a project whose config was written by something
           else — an importer, a hand edit, an extension that was removed — would otherwise refuse
           every write the model attempted, blaming it for a violation it did not introduce and
           cannot reach from the edit it was asked to make. */
      const before = new Set(await validateProject(projectState?.projectConfig ?? {}));
      const found = await validateProject(parsedConfig);
      const configErrors = found.filter((error) => !before.has(error));
      if (configErrors.length > 0) {
        const formatted = configErrors.map((e) => `- ${translateValidationError(e)}`).join("\n");
        return {
          ok: false,
          error: `${relPath} has schema errors — nothing was written. Fix these and retry:\n${formatted}`,
        };
      }
      // Announced only now, because the schema gate is what earns it: the per-project entry
      // Schema found no violation this text did not already have on disk.
      projectConfig = parsedConfig;
    }

    const verdict: WriteVerdict = {
      ok: true,
      /* The project file's open tab IS the configuration document, so adopting the write refreshes
         it — re-reading the file here would parse a SECOND configuration object and hand it to
         that tab, which is the split the adoption just closed. Every other path is a plain file
         and its tab has to be told from disk. */
      async afterWrite() {
        if (projectConfig) {
          await onProjectConfigWritten?.(projectConfig, content);
        } else if (openTab) {
          await reloadTab(relPath);
        }
        return openTab ? " and refreshed its open editor tab" : "";
      },
    };
    return tokenHints ? { ...verdict, hints: tokenHints } : verdict;
  }

  return {
    beforeWrite,
    list: (dir) => getPlatform().listDirectory(dir),
    read: (path) => getPlatform().readFile(path),
    search: (query, extensions) =>
      getPlatform().searchFiles(query, extensions ? [...extensions] : undefined),
    write: (path, text) => getPlatform().writeFile(path, text),
  };
}
