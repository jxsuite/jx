/**
 * Render-critic.js — Detached render probe for the AI agent loop
 *
 * After a mutation passes schema validation, this module attempts a lightweight headless render
 * (buildScope → renderNode into a throwaway div) and reports render-time errors back through the
 * same { ok, error } shape that applyAndValidate consumes. The model can then self-correct within
 * the round budget instead of the user discovering a blank canvas.
 *
 * V1 scope: catches render throws only (missing $ref, malformed Function body, bad template
 * expressions). Does NOT detect empty/zero-node output or deep-render custom element internals
 * (connectedCallback doesn't fire on detached nodes).
 *
 * @license MIT
 */

import {
  buildScope,
  renderNode,
  runScoped,
  setResolveToken,
  setSkipServerFunctions,
  setTemplateErrorHandler,
} from "@jxsuite/runtime";
import type { JxDocument } from "@jxsuite/schema/types";
import { hostResolveToken } from "../canvas/canvas-origin";

/**
 * Translate a render-time error into an actionable message the model can fix.
 *
 * @param {unknown} cause What the render threw — an Error in practice; anything else is printed
 *   as-is.
 * @returns {string}
 */
function translateRenderError(cause: unknown): string {
  const msg = (cause instanceof Error && cause.message) || String(cause);

  if (msg.includes("is not defined") || msg.includes("Cannot read properties of")) {
    return `Render error: ${msg}\n  → Fix: A $ref or template expression references a name that doesn't exist in state. Check that all $ref paths and \${...} expressions match entries in the document's "state" object.`;
  }

  if (msg.includes("is not a function")) {
    return `Render error: ${msg}\n  → Fix: An event handler or computed value references something that isn't a function. Check $prototype: "Function" entries have a valid "body" string, and $ref event handlers point to function-typed state entries.`;
  }

  if (msg.includes("is not a constructor")) {
    return `Render error: ${msg}\n  → Fix: A $prototype entry references a class or constructor that couldn't be resolved. Check the import path and $export name.`;
  }

  return `Render error: ${msg}\n  → Fix: The document is schema-valid but fails to render. Review the last change for typos in $ref paths, template expressions, or event handler definitions.`;
}

/**
 * Attempt a detached render of a Jx document. Returns { ok: true } on success or { ok: false,
 * error: string } with an actionable message on failure.
 *
 * @param {import("@jxsuite/schema/types").JxDocument} doc
 * @returns {Promise<{ ok: true } | { ok: false; error: string }>}
 */
export async function renderCheck(
  doc: JxDocument,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let stopRender: (() => void) | null = null;
  /* A binding that throws no longer unwinds the render (spec.md §6.1) — it renders empty and waits
     for its data — so the throw is collected here instead. The first one is the verdict: a page
     whose template can never evaluate is exactly what this check exists to refuse. */
  const bindingErrors: Error[] = [];
  setTemplateErrorHandler((error) => {
    bindingErrors.push(error);
  });
  try {
    setSkipServerFunctions(true);
    // The desktop dev proxy refuses a class resolve without the token the canvas carries.
    setResolveToken(hostResolveToken());

    const state = await buildScope(doc, {});

    const container = document.createElement("div");
    const { stop } = runScoped(() => {
      container.append(renderNode(doc, state));
    });
    stopRender = stop;

    const [first] = bindingErrors;
    return first ? { ok: false, error: translateRenderError(first) } : { ok: true };
  } catch (error) {
    return { ok: false, error: translateRenderError(error) };
  } finally {
    setTemplateErrorHandler(null);
    // Dispose all effects created synchronously by renderNode via the RUNTIME's runScoped — scope
    // Collection is per @vue/reactivity module instance, so a studio effectScope here would collect
    // Nothing. Effects from the async buildScope (prototype/computed setup) still escape the scope;
    // They're GC-eligible once the throwaway state/container are unreferenced. Bounded, acceptable.
    stopRender?.();
  }
}
