/**
 * Ai-ask.ts — the assistant's one way to stop and put a question to the author.
 *
 * `ask_user` declares what it asks (`interaction`) and what its answer means (`settle`), and has no
 * body that waits: the invoker answers `needs_input` before any tool code runs, the turn engine
 * puts the question to the assistant's interaction store (`harness/interaction-store.ts`), and the
 * person's answer comes back through `settle` as the call's result (specs/ai.md §3.4 and §3.11).
 *
 * Two decisions are load-bearing and easy to get wrong on a rewrite:
 *
 * - **A skip is a SUCCESS.** "You decide" is a real answer to a question; only a stopped turn is a
 *   failure. Reporting a skip as an error would make the model apologise for having asked.
 * - **The answer never becomes a user message.** `toMessagesArray` serialises the array verbatim and
 *   a provider requires a `tool` reply to follow its `tool_calls` request; a user turn spliced
 *   between them is a 400. The answer travels as the tool result, and the chat view renders it into
 *   the question's own chip.
 *
 * @license MIT
 */

import { JX_TOOL_FACTS } from "@jxsuite/ai/jx-tools";
import { createToolDefinition, toolError, toolSuccess } from "@jxsuite/ai/tools";
import { isString } from "@jxsuite/schema/guards";

import type { InteractionResponse, ToolRegistry } from "@jxsuite/ai/tools";

/** What a settled question's result carries: the answer, or `null` with `skipped` for "you decide". */
export interface AskAnswer {
  answer: string | null;
  skipped: boolean;
}

/** Max choices rendered as buttons; beyond this the question wants free text, not a menu. */
const MAX_OPTIONS = 6;

/**
 * Register `ask_user` into a tool registry.
 *
 * The description carries the discipline the tool needs to be worth having: a question the model
 * could have answered itself is noise, and a question about a setting the pipeline never receives
 * is worse than noise, because the answer cannot be honoured.
 *
 * @param {Pick<ToolRegistry, "register">} registry
 */
export function registerAskTool(registry: Pick<ToolRegistry, "register">): void {
  registry.register(
    createToolDefinition({
      name: "ask_user",
      title: "Ask the user",
      annotations: JX_TOOL_FACTS.ask_user.annotations,
      // It suspends the turn on the author, so a round that only asked spends no work budget.
      interactive: true,
      description:
        "Pause and put a question to the user; the turn waits for their reply and resumes with " +
        "it. Use it ONLY for a judgement that is genuinely theirs — which pages matter, whether to " +
        "keep the original design, whether a low-fidelity page is acceptable. Never ask something " +
        "you can decide yourself or discover with another tool, and never ask about an option you " +
        "cannot act on. One question at a time; offer options when the sensible answers are a " +
        "short list, and the user may always reply in their own words instead.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, in one sentence, addressed to the user.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description:
              `Up to ${MAX_OPTIONS} short answers, rendered as buttons. Omit when the answer is ` +
              "open-ended.",
          },
          context: {
            type: "string",
            description:
              "One line of why you are asking — what you found that made this a judgement call.",
          },
        },
        required: ["question"],
      },
      interaction(args) {
        /* Every field is any JSON value, narrowed by a guard rather than by `?.`. The registry's
           `validate()` is "a lightweight structural check, not a JSON Schema validator", and this
           tool may be registered into someone else's registry, so an argument that is a number is
           a case, not an impossibility. Optional chaining guards null, not type: `context?.trim()`
           threw on one. */
        const { question, options, context } = args;
        if (!isString(question) || !question.trim()) {
          return { refusal: 'Pass "question" — the question to put to the user.' };
        }
        const choices = Array.isArray(options)
          ? options
              .filter((o): o is string => isString(o) && o.trim().length > 0)
              .slice(0, MAX_OPTIONS)
          : [];
        return {
          context: isString(context) ? context.trim() : "",
          kind: "question",
          options: choices,
          question: question.trim(),
        };
      },
      settle(_args, response) {
        /* SAFETY: `ask_user` only ever asks a question, so the response the invoker hands back is
           the answer to one. */
        const { answer, skipped } = response as Extract<InteractionResponse, { kind: "question" }>;
        if (skipped) {
          /* A success: the model asked, and "you decide" is an answer. Rendering it as a failure
             would have the model apologise for having asked a fair question. */
          return toolSuccess(
            { answer: null, skipped: true },
            "The user declined to answer; proceed with your best judgment.",
          );
        }
        if (answer === null) {
          return toolError("The user did not answer — the turn was stopped.");
        }
        return toolSuccess({ answer, skipped: false }, `The user answered: "${answer}"`);
      },
      // Never reached through the invoker, which settles an interaction instead of executing it.
      execute: () => toolError("ask_user needs a person, and none is available here."),
    }),
  );
}
