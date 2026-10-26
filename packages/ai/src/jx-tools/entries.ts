/**
 * The tree tools as registry entries over a {@link DocumentHost} (specs/ai.md §3.9).
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 */

import { createToolDefinition, toolError } from "../tools.ts";
import type { ToolDefinition } from "../tools.ts";
import { coercePath, DOC_TOOLS, nodeAt, PATH_DESCRIPTION } from "./doc-tools.ts";
import type { DocEdit, DocTool, DocumentHost, WriteReporter } from "./types.ts";
import { isString } from "@jxsuite/schema/guards";
import type { JxPath } from "@jxsuite/schema/types";

/** What the model reads when the document refuses structural edits for now. */
export const FROZEN_SENTENCE =
  "The document is frozen: a collaborator is editing its source, so structural edits are " +
  "paused. Nothing was changed. Try again once source editing ends.";

/** `read_document`: the document, or the subtree at a path. */
function readDocument(host: DocumentHost): ToolDefinition {
  return createToolDefinition({
    name: "read_document",
    description:
      "Read the current Jx document, or the subtree at a given path. Use this to discover " +
      "node paths before calling set_property, add_child, or delete_node.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "array",
          description: `${PATH_DESCRIPTION} Omit to read the whole document.`,
          items: { type: ["string", "number"] },
        },
      },
      required: [],
    },
    execute(args, ctx) {
      const ref = host.resolve(ctx);
      if (isString(ref)) {
        return toolError(ref);
      }
      /* SAFETY: a strict tool runs only after the registry's `validate()` passed, which refuses a
         `path` that is present but not an array. Its items are not checked; a key that does not
         resolve makes `nodeAt` answer undefined, reported just below. */
      const { path: written } = args as { path?: JxPath };
      const path = written && coercePath(written);
      const doc = host.snapshot(ref);
      const node = path && path.length > 0 ? nodeAt(doc, path) : doc;
      if (node === undefined) {
        return toolError(`No node exists at path ${JSON.stringify(path)}.`);
      }
      return { success: true, data: node };
    },
  });
}

/**
 * One tree tool as a registry entry. A refused call costs no validation: the producer runs once
 * against the document as it stands, and only an edit it accepts is bracketed by the reporter and
 * run again inside the host's transaction, where the document cannot move under it.
 */
function treeTool<Before>(
  host: DocumentHost,
  reporter: WriteReporter<Before>,
  tool: DocTool,
): ToolDefinition {
  return createToolDefinition({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(args, ctx) {
      const ref = host.resolve(ctx);
      if (isString(ref)) {
        return toolError(ref);
      }
      const planned = tool.edit(host.snapshot(ref), args);
      if (!planned.ok) {
        return toolError(planned.error);
      }
      const before = await reporter.before(ref);
      // The summary of the edit that ran, which names where it landed in the document it ran on.
      let { summary } = planned;
      const receipt = await host.edit(
        ref,
        (doc): DocEdit => {
          const edit = tool.edit(doc, args);
          if (edit.ok) {
            ({ summary } = edit);
          }
          return edit;
        },
        { actor: ctx.actor, callId: ctx.callId, tool: tool.name },
      );
      if (!receipt.applied) {
        return toolError(receipt.reason === "frozen" ? FROZEN_SENTENCE : receipt.message);
      }
      /* One ledger entry per write, so "Changed N files" counts documents rather than sentences
         (specs/ai.md §3.2). `disk` is whether undo can reach it, which is the host's to say. */
      ctx.ledger.record({
        disk: host.undoable === "none",
        ok: true,
        path: ref.path ?? "(untitled)",
        tool: summary,
      });
      return reporter.after(ref, before, summary);
    },
  });
}

/**
 * `read_document` and the seven tree tools, in the order the model has always been offered them,
 * over `host`. `reporter` brackets every write that the producer accepts.
 *
 * @param {DocumentHost} host
 * @param {{ reporter: WriteReporter<Before> }} options
 * @returns {ToolDefinition[]}
 */
export function docToolEntries<Before>(
  host: DocumentHost,
  { reporter }: { readonly reporter: WriteReporter<Before> },
): ToolDefinition[] {
  return [readDocument(host), ...DOC_TOOLS.map((tool) => treeTool(host, reporter, tool))];
}
