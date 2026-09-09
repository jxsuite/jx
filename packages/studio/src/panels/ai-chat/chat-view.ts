/// <reference lib="dom" />
/**
 * Chat-view.ts — the transcript's PROJECTION: what the assistant surface is told about a turn.
 *
 * Message-row anatomy: user messages render as right-aligned bubbles (attached-context blocks
 * become chips), assistant messages render sanitized markdown plus tool-call chips, tool messages
 * surface failures only (ADR §11.3), the streaming tail renders as plain text with a cursor
 * (markdown parses once on finalize), and chat errors get a danger row with recovery advice and a
 * Retry. **None of that is markup here any more** — `surfaces/ai-chat.json` draws it and this
 * module decides what it says, which is the same split the file always had with a document on the
 * other side of it instead of a lit template.
 *
 * §7.4 (AI honesty) is why three things here are not what they were:
 *
 * - **A chip renders its OUTCOME.** `ToolCallRecord.result` has always been populated by the loop
 *   and ignored by this renderer, so a chip that said `update_style: ["children",0]` said exactly
 *   as much when the edit had been refused as when it had landed.
 * - **A turn renders what it CHANGED.** The changed-files summary comes off the write ledger
 *   (`services/ai-writes.ts`), which records whether each change went through a transaction or
 *   straight to disk — so the undo caveat is rendered to the human holding ⌘Z instead of being
 *   appended to the model-facing tool summary.
 * - **An error offers Retry.** `chatState.retryLast()` has been implemented, exported and called by
 *   nobody; the error row is where it belongs.
 *
 * §11.1 is why the three buttons here are not callbacks any more. History, New Chat and Retry were
 * closures this module received and invoked, so the capabilities existed ONLY as buttons: the
 * `Assistant` category held zero records, and nothing could reach them from the palette, a chord,
 * the automation runner or the generated commands sheet. They are {@link projectCommand} now, in
 * the idiom `surfaces/statusbar.ts` established — the record is the definition site, and this file
 * only decides where it is drawn and with which glyph.
 *
 * @license MIT
 */

import type { Message, ToolCallRecord } from "@jxsuite/ai/chat-state";
import { splitAttachedContext } from "./attached-context";
import { renderMarkdown } from "./chat-markdown";
import { summarizeWrites, writesForTurn } from "../../services/ai-writes";
import { activeRegistry } from "../../commands/active-registry";

import type { CommandRegistry } from "../../commands/registry";
import type { ImportRunRecord } from "../../services/import-run";
import type {
  ChatChangeView,
  ChatChipView,
  ChatCommandView,
  ChatContextChip,
  ChatRowView,
} from "../../surfaces/ai-chat";

// ─── Helpers (moved from ai-panel.ts) ────────────────────────────────────────

/**
 * Parse a tool result message content (JSON string) into its success/error shape. Returns null if
 * the content isn't a valid tool result.
 *
 * @param {string} content
 * @returns {{ success: boolean; error?: string; summary?: string } | null}
 */
export function tryParseToolResult(
  content: string,
): { success: boolean; error?: string; summary?: string } | null {
  try {
    const parsed = JSON.parse(content) as { success?: unknown; error?: string; summary?: string };
    if (parsed && typeof parsed.success === "boolean") {
      return parsed as { success: boolean; error?: string; summary?: string };
    }
  } catch {
    /* Not JSON — not a tool result */
  }
  return null;
}

/**
 * Label for an assistant tool call: the tool name plus the target path when present.
 *
 * @param {{ name: string; arguments: string }} tc
 * @returns {string}
 */
export function formatToolLabel(tc: { name: string; arguments: string }): string {
  let detail = "";
  try {
    const args = (tc.arguments ? JSON.parse(tc.arguments) : {}) as {
      path?: unknown;
      parentPath?: unknown;
    };
    if (Array.isArray(args.path)) {
      detail = `: ${JSON.stringify(args.path)}`;
    } else if (Array.isArray(args.parentPath)) {
      detail = `: ${JSON.stringify(args.parentPath)}`;
    }
  } catch {
    /* Partial/unparsed args — show name only */
  }
  return `${tc.name}${detail}`;
}

/**
 * Return actionable advice for common AI assistant errors so the user knows how to recover instead
 * of just seeing a raw error message.
 *
 * @param {string} error
 * @returns {string}
 */
export function formatErrorAdvice(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("no api key") || lower.includes("401")) {
    return "Use the settings button below the message box to add an OpenAI-compatible API key.";
  }
  if (lower.includes("network error") || lower.includes("fetch")) {
    return "Check that the dev server is running and reachable.";
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    return "The API rate limit was hit. Wait a moment and try again.";
  }
  if (lower.includes("500") || lower.includes("internal")) {
    return "The upstream API returned a server error. Try again in a moment.";
  }
  return "";
}

// ─── Commands as buttons ────────────────────────────────────────────────────

/** Where a projected command is drawn, and with what. */
export interface CommandButtonOptions {
  /** The kit glyph, by its name in the manifest. Empty for a text-only button. */
  icon?: string;
  /** Visible text. Empty on an icon-only button. */
  text?: string;
}

/**
 * One control that IS a command — `surfaces/statusbar.ts`'s `projectItem`, for the assistant.
 *
 * A command the registry does not hold, or whose `when` is false, projects to NOTHING rather than a
 * dead button; a visible-but-refused one projects disabled with its `requires` sentence in the
 * tooltip. That is what keeps the assistant a rendering of the registry instead of a second place
 * its capabilities are decided — and it is why `tests/ai-chat-view.test.ts` asserts the ids,
 * exactly as `tests/statusbar.test.ts` does: an id is not an interface between two files unless
 * something checks it.
 *
 * Before any registry exists (the bootstrap composes one at the END of `studio.ts`, and a reduced
 * test fixture may compose none) the button is simply absent. The chat is still readable, which is
 * the same bargain the status bar strikes for the frame it paints early.
 *
 * @param {string} id
 * @param {CommandButtonOptions} [opts]
 * @param {CommandRegistry | null} [registry] The registry to ask; the active one by default.
 * @returns {ChatCommandView | null}
 */
export function projectCommand(
  id: string,
  opts: CommandButtonOptions = {},
  registry: CommandRegistry | null = activeRegistry(),
): ChatCommandView | null {
  const command = registry?.get(id);
  if (!registry || !command || !registry.isVisible(id)) {
    return null;
  }
  const reason = registry.disabledReason(id);
  const chord = registry.keymap.formatBinding(id);
  const hint = reason
    ? `${command.title} — requires ${reason}`
    : chord
      ? `${command.title} (${chord})`
      : command.title;
  return {
    disabled: reason !== undefined,
    hint,
    icon: opts.icon ?? "",
    id,
    key: id,
    label: command.title,
    text: opts.text ?? "",
  };
}

/** The projections that survived, as a list — a `null` is a command that is not on offer. */
export function projectCommands(entries: readonly (ChatCommandView | null)[]): ChatCommandView[] {
  return entries.filter((entry): entry is ChatCommandView => entry !== null);
}

// ─── Header ─────────────────────────────────────────────────────────────────

/** Compact token count: 18400 → "18.4k". A four-digit number in a 28px header is noise. */
export function tokenLabel(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/**
 * The sentence behind the token readout.
 *
 * `services/context-manager.ts` has computed both numbers on every turn since it was written, and
 * `chat-state.ts` has stored them — with NO READER anywhere. Plan §11.6: "Context budget manager →
 * tokenCount / contextWarning actually rendered". So a conversation was silently trimmed, the
 * assistant forgot what you told it ten turns ago, and the two numbers that would have explained
 * why sat in the store.
 *
 * @param {number} tokens
 * @param {boolean} overBudget
 * @returns {string}
 */
export function tokenHint(tokens: number, overBudget: boolean): string {
  return overBudget
    ? `About ${tokens.toLocaleString()} tokens — past half the model's context. ` +
        "The oldest turns are dropped as this grows; start a new chat to keep them."
    : `About ${tokens.toLocaleString()} tokens of the model's context in use`;
}

// ─── Tool calls ─────────────────────────────────────────────────────────────

/** The tool whose chip is a question card rather than a chip. */
const ASK_TOOL = "ask_user";

/** The tool whose chip grows a live progress line while it runs. */
const IMPORT_TOOL = "import_site";

/** What `ask_user` was called with, as far as the arguments actually parse. */
interface AskArgs {
  question: string;
  options: string[];
  context: string;
}

/**
 * Read a question out of a tool call's arguments.
 *
 * Tolerant on purpose: the arguments are assembled from streamed fragments, so a chip can be asked
 * to render a call whose JSON is still half-written. A card with an empty question renders as an
 * ordinary chip rather than as an empty box.
 *
 * @param {ToolCallRecord} tc
 * @returns {AskArgs | null}
 */
export function parseAsk(tc: ToolCallRecord): AskArgs | null {
  let parsed: { question?: unknown; options?: unknown; context?: unknown };
  try {
    parsed = tc.arguments ? (JSON.parse(tc.arguments) as typeof parsed) : {};
  } catch {
    return null; // Still streaming, or malformed — the generic chip is the honest fallback.
  }
  if (typeof parsed.question !== "string" || !parsed.question.trim()) {
    return null;
  }
  return {
    context: typeof parsed.context === "string" ? parsed.context : "",
    options: Array.isArray(parsed.options)
      ? parsed.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [],
    question: parsed.question,
  };
}

/**
 * What became of one tool call.
 *
 * `"unanswered"` is the fourth value and it exists for `ask_user`. A question's promise lives in
 * memory, so a reload kills it while the transcript survives: without this the restored card is
 * indistinguishable from a live one and spins forever waiting for a loop that is gone. It is a
 * property of the RUN, not of the record, so the caller supplies whether this call is still live.
 *
 * @param {ToolCallRecord} tc
 * @param {boolean} [live] - Whether the loop is still waiting on this call. Only consulted for a
 *   result-less interactive call; every other pending call belongs to a turn still in flight.
 * @returns {"pending" | "unanswered" | "ok" | "failed"}
 */
export function toolOutcome(
  tc: ToolCallRecord,
  live = true,
): "pending" | "unanswered" | "ok" | "failed" {
  if (!tc.result) {
    return tc.name === ASK_TOOL && !live ? "unanswered" : "pending";
  }
  return tc.result.success ? "ok" : "failed";
}

/**
 * The one line a chip says about its outcome — the tool's own words where it has any.
 *
 * A tool that succeeded already writes a human sentence into `summary` for the model to read; there
 * is no reason the human could not have been reading it all along. A tool that failed writes
 * `error`, which was surfaced only through the separate tool-message row and only after the fact.
 *
 * @param {ToolCallRecord} tc
 * @returns {string}
 */
export function toolOutcomeText(tc: ToolCallRecord): string {
  const { result } = tc;
  if (!result) {
    return "";
  }
  return (result.success ? result.summary : result.error) ?? "";
}

/** How a question card reaches the store that resolves it, and an import its record. */
export interface AskHandlers {
  /** The id of the question the loop is still waiting on, or null. */
  pendingId?: string | null;
  /** The live record for an `import_site` call, if this renderer's host has one. */
  importRun?: (id: string) => ImportRunRecord | null;
}

/** The empty import fields every chip carries, so a `$switch` never reads an absent path. */
function noImport(): Pick<
  ChatChipView,
  | "hasPhase"
  | "importCount"
  | "importLog"
  | "importMessage"
  | "importOpen"
  | "importPhase"
  | "importProgress"
  | "importSpinner"
  | "importState"
> {
  return {
    hasPhase: false,
    importCount: "",
    importLog: [],
    importMessage: "",
    importOpen: false,
    importPhase: "",
    importProgress: "",
    importSpinner: "none",
    importState: "none",
  };
}

/**
 * A running import, under the chip that started it.
 *
 * An import takes minutes and says a line at a time. Rendering it under the chip rather than in the
 * modal it used to live in is what stops a successful run destroying its own account of what it
 * did: the chip and the progress are one thing, joined by the tool-call id.
 *
 * Projected for EVERY import chip, not only a running one. A finished run used to lose its whole
 * account of itself at the instant it finished — the record was fetched only while the call was
 * pending, so the log vanished on success. That is the failure the hand-off from the wizard to the
 * assistant was made to fix, reproduced one layer in.
 *
 * @param {ImportRunRecord} record
 * @returns {Partial<ChatChipView>}
 */
function projectImport(record: ImportRunRecord): Partial<ChatChipView> {
  const running = record.status === "running";
  const determinate = record.total !== null && record.current !== null;
  const outcome =
    record.status === "done"
      ? `Imported ${record.url}`
      : record.status === "failed"
        ? `Import failed — ${record.error || "the run did not say why"}`
        : record.status === "stopped"
          ? "Import stopped"
          : record.message;
  return {
    hasPhase: running && record.phase !== "",
    importCount: String(record.log.length),
    importLog: record.log.map((evt, index) => ({
      key: `${index}:${evt.phase}`,
      message: evt.message,
      phase: evt.phase,
    })),
    importMessage: outcome,
    importOpen: running,
    importPhase: record.phase,
    importProgress: determinate
      ? String(Math.round((record.current! / Math.max(record.total!, 1)) * 100))
      : "",
    importSpinner: running ? (determinate ? "progress" : "busy") : "none",
    importState: "run",
  };
}

/**
 * One tool call, as the transcript draws it.
 *
 * The question card IS the tool chip rather than a row beside it: the question, its options and its
 * answer are all facts about one tool call, and putting them anywhere else would give the
 * transcript two accounts of the same event that can disagree after a reload.
 *
 * @param {ToolCallRecord} tc
 * @param {AskHandlers} handlers
 * @returns {ChatChipView}
 */
export function projectChip(tc: ToolCallRecord, handlers: AskHandlers = {}): ChatChipView {
  const outcome = toolOutcome(tc, tc.id === handlers.pendingId || Boolean(tc.result));
  const text = toolOutcomeText(tc);
  const run = tc.name === IMPORT_TOOL ? (handlers.importRun?.(tc.id) ?? null) : null;
  const ask = tc.name === ASK_TOOL ? parseAsk(tc) : null;
  const answered = tc.result?.success
    ? ((tc.result.data as { answer?: string | null; skipped?: boolean } | undefined) ?? null)
    : null;
  const base: ChatChipView = {
    answer: answered ? (answered.skipped ? "You decide" : (answered.answer ?? "")) : "",
    askState: "none",
    context: ask?.context ?? "",
    hasContext: Boolean(ask?.context),
    hint: text || formatToolLabel(tc),
    key: tc.id,
    kind: ask ? "ask" : "chip",
    label: formatToolLabel(tc),
    mark: outcome === "ok" ? "✓" : "✗",
    options: (ask?.options ?? []).map((option) => ({ key: option, label: option })),
    outcome,
    outcomeState: outcome === "pending" || outcome === "unanswered" ? "hidden" : "shown",
    outcomeText: text,
    question: ask?.question ?? "",
    tool: tc.name,
    ...noImport(),
    ...(run ? projectImport(run) : {}),
  };
  if (ask) {
    /* The options are a shortcut, never the whole answer — the composer is always live beneath, and
       its placeholder says so. A question whose real answer is "neither, do this instead" must stay
       answerable, which is why `pending` draws the options AND leaves the field alone. */
    base.askState =
      outcome === "pending"
        ? "pending"
        : outcome === "unanswered"
          ? "unanswered"
          : answered
            ? "answered"
            : outcome === "failed"
              ? "failed"
              : "none";
  }
  return base;
}

// ─── Changed files ──────────────────────────────────────────────────────────

/**
 * The turn's changed-files summary, with the two things it can honestly offer.
 *
 * Projected only for a turn that changed something — "Changed 0 files" is noise, and a turn that
 * only read is the common case. **Restore to here** is offered only when every recorded change went
 * through a transaction: a disk write has no history behind it, so a button that claimed to restore
 * one would be the same lie the model-facing caveat used to be.
 *
 * @param {string} messageId
 * @returns {{
 *   changesState: string;
 *   changesSummary: string;
 *   canRestore: boolean;
 *   changes: ChatChangeView[];
 * }}
 */
export function projectChanges(messageId: string): {
  changesState: string;
  changesSummary: string;
  canRestore: boolean;
  changes: ChatChangeView[];
} {
  const writes = writesForTurn(messageId);
  const summary = writes.length > 0 ? summarizeWrites(writes) : "";
  if (!summary) {
    return { canRestore: false, changes: [], changesState: "none", changesSummary: "" };
  }
  return {
    canRestore: writes.every((w) => !w.disk),
    changes: writes.map((w, index) => ({
      disk: w.disk,
      key: `${index}:${w.path}`,
      note: w.ok ? w.tool : `failed — ${w.error ?? w.tool}`,
      ok: w.ok,
      path: w.path,
    })),
    changesState: "list",
    changesSummary: summary,
  };
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** Every field a row carries, so a `$switch` case never reads an absent path. */
function emptyRow(key: string, kind: string): ChatRowView {
  return {
    body: "",
    canRestore: false,
    changes: [],
    changesState: "none",
    changesSummary: "",
    chips: [],
    contextChips: [],
    hasChips: false,
    hasContextChips: false,
    key,
    kind,
    markdown: "",
  };
}

/** The attached-context block on a user turn, back apart into chips. */
function contextChips(lines: readonly string[]): ChatContextChip[] {
  return lines.map((line, index) => ({ key: `${index}:${line}`, label: line }));
}

export interface MessageListOptions {
  messages: readonly Message[];
  /** ChatState status — "streaming" projects the tail live. */
  status: string;
  /** The outstanding question and the import records, passed down rather than read here. */
  ask?: AskHandlers | undefined;
}

/**
 * The transcript, as rows.
 *
 * Keyed on `msg.id`, for two reasons a reader can see. The last assistant row swaps between the
 * streaming tail and the finished message the moment a stream completes, so an unkeyed list would
 * tear down and rebuild the longest node in the transcript every time one finishes. And an
 * assistant row holds the reader's OWN open/closed state on its changed-files disclosure, which
 * position-based reuse hands to a different message.
 *
 * A message that would draw nothing — an empty assistant turn with no tool calls, a successful tool
 * result — is absent rather than an empty row, which is the same thing the lit template's `nothing`
 * did and one fewer node for the runtime to reconcile.
 *
 * @param {MessageListOptions} opts
 * @returns {ChatRowView[]}
 */
export function projectRows(opts: MessageListOptions): ChatRowView[] {
  const ask = opts.ask ?? {};
  const lastIdx = opts.messages.length - 1;
  const rows: ChatRowView[] = [];
  for (const [i, msg] of opts.messages.entries()) {
    if (msg.role === "user") {
      const { body, contextLines } = splitAttachedContext(msg.content);
      rows.push({
        ...emptyRow(msg.id, "user"),
        body,
        contextChips: contextChips(contextLines),
        hasContextChips: contextLines.length > 0,
      });
      continue;
    }
    if (msg.role === "tool") {
      // Show only failed tool results so the user knows why an edit didn't land (ADR §11.3).
      // Successful tool results stay hidden to reduce noise.
      const parsed = tryParseToolResult(msg.content);
      if (parsed && !parsed.success) {
        rows.push({
          ...emptyRow(msg.id, "tool-error"),
          body: `⚠️ ${parsed.error || "Tool call failed"}`,
        });
      }
      continue;
    }
    if (msg.role !== "assistant") {
      continue;
    }
    const toolCalls = msg.toolCalls ?? [];
    const chips = toolCalls.map((tc) => projectChip(tc, ask));
    if (opts.status === "streaming" && i === lastIdx) {
      rows.push({
        ...emptyRow(msg.id, msg.content ? "streaming" : "typing"),
        body: msg.content,
        chips,
        hasChips: chips.length > 0,
      });
      continue;
    }
    if (!msg.content && toolCalls.length === 0) {
      continue;
    }
    rows.push({
      ...emptyRow(msg.id, "assistant"),
      chips,
      hasChips: chips.length > 0,
      markdown: msg.content ? renderMarkdown(msg.id, msg.content) : "",
      ...projectChanges(msg.id),
    });
  }
  return rows;
}
