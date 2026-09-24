/**
 * Ai-write-report.ts — what the model is told after a document write, whoever made it.
 *
 * Extracted from `ai-tools.ts`'s `applyAndValidate`, which used to own both halves of a document
 * tool: the transaction and the verdict on it. The verdict is the half every document write needs
 * — the seven hand-registered tree tools AND every command the assistant runs through
 * `services/ai-command-tools.ts` — so it lives here, in two functions the caller brackets its write
 * with:
 *
 * 1. {@link snapshotBeforeWrite} reads the document's schema errors and render state BEFORE the
 *    write, because the loop's signal (specs/ai.md §3.1) is "what did this edit newly introduce",
 *    not "is the document valid": a page that was already broken must not make every subsequent
 *    edit read as the culprit.
 * 2. {@link reportDocumentWrite} compares AFTER the write, translating each new schema error into a
 *    fix hint the model can act on, running the render check only when rendering worked before,
 *    and appending the soft token-discipline hints to a success.
 *
 * The change stays applied either way (optimistic apply + undo, specs/ai.md §3.1); reporting the errors lets
 * the agent loop self-correct on the next round.
 *
 * @license MIT
 */

import type { ToolResult } from "@jxsuite/ai/tools";
import { toRaw } from "../reactivity";
import type { Tab } from "../tabs/tab";
import { flagHardcodedTokens, formatTokenHints } from "./token-lint";

/** A render probe's answer: rendered, or the message it threw. */
export type RenderVerdict = { ok: true } | { ok: false; error: string };

/** What a write reporter needs. Every member is what `registerAiTools` already takes by injection. */
export interface WriteReportDeps {
  /** Schema errors for a document, as raw ajv sentences. */
  validate: (doc: unknown) => Promise<string[]>;
  /** The detached-DOM render probe, when the host has one. */
  renderCheck?: ((doc: unknown) => Promise<RenderVerdict>) | undefined;
  /** The project's design tokens, read per call so a project opened mid-session contributes. */
  getProjectStyle?: (() => Record<string, string> | undefined) | undefined;
}

/** The document as it stood before a write, in the two respects the verdict compares. */
export interface WriteSnapshot {
  errors: Set<string>;
  renderOk: boolean;
}

/**
 * Translate a raw JSON Schema validation error into a Jx-specific actionable message. The LLM needs
 * concrete guidance on HOW to fix errors, not just what rule was violated. Shared with the
 * project-level file tools (ai-project-tools.ts), which pre-validate Jx documents before writing.
 *
 * @param {string} rawError - Message from ajv (e.g. "/children/0/style: must NOT have additional
 *   property")
 * @returns {string}
 */
export function translateValidationError(rawError: string): string {
  const lower = rawError.toLowerCase();

  // Additional property — extract the offending key from the message if present
  if (
    lower.includes("must not have additional property") ||
    lower.includes("additional properties")
  ) {
    return `${rawError}\n  → Fix: Remove or move the unexpected property. Style properties must be camelCase (e.g. "backgroundColor", not "background-color"). Non-IDL HTML attributes (aria-*, data-*, role, ...) must go inside an "attributes" object: { "attributes": { "aria-label": "..." } }.`;
  }

  // Pattern — usually tagName hyphen rule
  if (lower.includes("must match pattern")) {
    return `${rawError}\n  → Fix: Custom element tag names must contain a hyphen (e.g. "newsletter-form", "feature-card"). Standard HTML elements use their exact name (e.g. "div", "input", "button").`;
  }

  // Type error
  if (lower.includes("must be string")) {
    return `${rawError}\n  → Fix: Wrap the value in quotes — all Jx property values should be strings. For example, use "10px" (string) not 10px (unquoted).`;
  }

  if (lower.includes("must be number") || lower.includes("must be integer")) {
    return `${rawError}\n  → Fix: Remove quotes from the numeric value — it should be a plain number, not a string.`;
  }

  if (lower.includes("must be object") || lower.includes("must be array")) {
    return `${rawError}\n  → Fix: The value must be an object/array (use {} or []), not a string or number.`;
  }

  if (lower.includes("must be boolean")) {
    return `${rawError}\n  → Fix: Use true or false without quotes for boolean values.`;
  }

  // Required property
  if (lower.includes("must have required property")) {
    return `${rawError}\n  → Fix: Add the missing required property. Every Jx element must have at least a "tagName" field.`;
  }

  // Enum / allowed values
  if (lower.includes("must be equal to one of the allowed values")) {
    return `${rawError}\n  → Fix: Change the value to one of the allowed options listed in the error.`;
  }

  return rawError;
}

/**
 * Read the document's standing BEFORE a write: its schema errors and whether it renders.
 *
 * Reads the RAW document, not the reactive proxy, for the same reason `applyAndValidate` always
 * did: the validator walks the whole tree, and walking a proxy subscribes whichever effect is
 * running to every key of it.
 *
 * @param {Tab} tab
 * @param {WriteReportDeps} deps
 * @returns {Promise<WriteSnapshot>}
 */
export async function snapshotBeforeWrite(tab: Tab, deps: WriteReportDeps): Promise<WriteSnapshot> {
  const rawBefore = toRaw(tab.doc.document);
  const errors = new Set(await deps.validate(rawBefore));
  const rendered = deps.renderCheck ? await deps.renderCheck(rawBefore) : { ok: true };
  return { errors, renderOk: rendered.ok };
}

/**
 * The verdict on a write that has been applied: the NEW schema errors with fix hints, the render
 * check (only when rendering worked before — a page that already failed to render is not this
 * edit's fault), or a success carrying `summary` plus any token-discipline hints.
 *
 * The three sentences here are the ones the model has read since the tools were written; every
 * bridged document command now answers with the same ones, which is what lets the prompt's error
 * recovery guidance stay generic.
 *
 * @param {Tab} tab
 * @param {WriteSnapshot} before - What {@link snapshotBeforeWrite} read.
 * @param {string} summary - The sentence to return on success.
 * @param {WriteReportDeps} deps
 * @returns {Promise<ToolResult>}
 */
export async function reportDocumentWrite(
  tab: Tab,
  before: WriteSnapshot,
  summary: string,
  deps: WriteReportDeps,
): Promise<ToolResult> {
  const rawAfter = toRaw(tab.doc.document);
  const after = await deps.validate(rawAfter);
  const newErrors = after.filter((e) => !before.errors.has(e));
  if (newErrors.length > 0) {
    const formatted = newErrors.map((e) => `- ${translateValidationError(e)}`).join("\n");
    return {
      success: false,
      error: `Change applied, but it introduced schema errors. Fix these issues with follow-up edits:\n${formatted}`,
    };
  }

  if (deps.renderCheck && before.renderOk) {
    const renderResult = await deps.renderCheck(rawAfter);
    if (!renderResult.ok) {
      return {
        success: false,
        error: `Change applied and schema-valid, but it broke rendering. Fix with follow-up edits:\n- ${renderResult.error}`,
      };
    }
  }

  // Soft token-discipline hints (never fail the mutation)
  const projectStyle = deps.getProjectStyle?.();
  if (projectStyle) {
    const findings = flagHardcodedTokens(rawAfter, projectStyle);
    const hints = formatTokenHints(findings);
    if (hints) {
      return { success: true, summary: `${summary}\n\n${hints}` };
    }
  }

  return { success: true, summary };
}
