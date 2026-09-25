/**
 * Ai-writes.ts — what the assistant changed, per turn, and whether you can take it back.
 *
 * §7.4 (AI honesty). Two facts about an assistant turn were legible only to the model:
 *
 * 1. **Which files it changed.** The loop collected `result.summary` strings and fed them back into
 *    the conversation; the human got a paragraph of prose in which "I updated the hero" and "I
 *    rewrote layouts/base.json" are the same shape of sentence.
 * 2. **Which of those changes undo can reach.** Document tools mutate through `transactDoc`, so ⌘Z
 *    covers them. `write_file` and `write_project_config` go straight to disk through the platform,
 *    where there is no history and never was — and the caveat was appended to the MODEL-facing tool
 *    summary, telling the party that cannot press ⌘Z and not the party that can.
 *
 * A ledger rather than a parse of the summaries, because a summary is prose the model reads and a
 * ledger is a record the UI renders — deriving one from the other would make the panel's honesty
 * depend on the wording of a sentence written for somebody else.
 *
 * The tools record; the loop bounds the turn; the panel renders. Nothing here knows about lit, and
 * nothing here imports the loop, so a tool can be honest without either.
 */

import type { Message } from "@jxsuite/ai/chat-state";
import { createLedger } from "@jxsuite/ai/tools";
import type { AiWrite, WriteLedger } from "@jxsuite/ai/tools";

export type { AiWrite } from "@jxsuite/ai/tools";

/** Every write recorded during one assistant turn, in the order the tools made them. */
export interface AiTurn {
  /** The id of the assistant message the turn produced — how the panel finds its own ledger. */
  id: string;
  writes: AiWrite[];
}

/** Completed turns, oldest first. Bounded: a session's history is the session store's job. */
const turns: AiTurn[] = [];

/** How many turns of ledger are kept. Older ones drop their summary; the messages remain. */
export const MAX_TURNS = 50;

/** One turn's ledger, named for the turn it records. */
export interface TurnLedger extends WriteLedger {
  readonly turnId: string;
}

/**
 * A fresh ledger for one turn. The loop opens it when the turn starts, hands it to every call as
 * `ctx.ledger`, and files it with {@link fileTurn} when the turn ends.
 *
 * Per turn, not a module slot: the slot this replaced was one ledger for the whole window, so a
 * tool run outside the loop recorded into whichever turn happened to be open, and two turns could
 * not each keep their own.
 *
 * @param {string} turnId - The turn it records, which also names the actor its calls run as
 * @returns {TurnLedger}
 */
export function openTurnLedger(turnId: string): TurnLedger {
  return Object.assign(createLedger(), { turnId });
}

/**
 * File a finished turn's writes under `anchor`, the message the transcript draws its summary under.
 *
 * The anchor arrives at the END because it is an assistant message's id, which does not exist when
 * the turn starts. A turn with no drawn message is filed under `""`, which no message has, so the
 * transcript draws its changes nowhere. A turn that wrote nothing files nothing.
 *
 * @param {string} anchor - The message the turn's changes are drawn under
 * @param {readonly AiWrite[]} writes - The turn's ledger
 * @returns {AiWrite[]} What was filed
 */
export function fileTurn(anchor: string, writes: readonly AiWrite[]): AiWrite[] {
  if (writes.length === 0) {
    return [];
  }
  const turn: AiTurn = { id: anchor, writes: [...writes] };
  turns.push(turn);
  while (turns.length > MAX_TURNS) {
    turns.shift();
  }
  return turn.writes;
}

/**
 * What the turn that produced this assistant message changed. Empty for a turn that changed
 * nothing, which is why the panel renders no summary at all rather than "Changed 0 files".
 *
 * @param {string} id
 * @returns {AiWrite[]}
 */
export function writesForTurn(id: string): AiWrite[] {
  return turns.find((turn) => turn.id === id)?.writes ?? [];
}

/**
 * The one-line summary the panel puts above the expander.
 *
 * Counts DISTINCT paths, not writes: a turn that edits the same document six times changed one
 * file, and saying "Changed 6 files" would be the same dishonesty in the other direction. Disk
 * writes are called out separately because they are the ones undo cannot reach.
 *
 * @param {AiWrite[]} writes
 * @returns {string}
 */
export function summarizeWrites(writes: AiWrite[]): string {
  const applied = writes.filter((w) => w.ok);
  const paths = new Set(applied.map((w) => w.path));
  const failed = writes.length - applied.length;
  if (paths.size === 0) {
    return failed > 0 ? `${failed} change${failed === 1 ? "" : "s"} failed` : "";
  }
  const files = `Changed ${paths.size} file${paths.size === 1 ? "" : "s"}`;
  const diskPaths = new Set(applied.filter((w) => w.disk).map((w) => w.path));
  const parts = [files];
  if (diskPaths.size > 0) {
    parts.push(
      `${diskPaths.size} written to disk — undo cannot reach ${diskPaths.size === 1 ? "it" : "them"}`,
    );
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return parts.join(" · ");
}

/** Drop every ledger. For tests and for the "new chat" / "close project" paths. */
export function resetAiWrites(): void {
  turns.splice(0);
}

/**
 * The message a turn's changes are filed under: its last DRAWN assistant message, which is the one
 * the transcript renders the changed-files summary beneath (panels/ai-chat/chat-view.ts), and so
 * the id {@link fileTurn} is given.
 *
 * Not simply the last message. A turn can end on a `tool` reply (a Stop during the last call, or a
 * cap reached with nothing applied), on a final round that said nothing, or after a stream error
 * removed its round's partial; filed under any of those, the summary and Restore were drawn under
 * nothing and the author never saw what the turn changed. The cap message counts: it is drawn.
 *
 * **An anchor is only ever this turn's.** The scan must MEET the message the turn answers, and only
 * what it passed on the way counts. A transcript that no longer holds that message was replaced
 * under the turn (another chat opened from Chat History while it waited on a tool), and every
 * message in it belongs to some other conversation: filing there would draw "Changed 1 file", and
 * Restore, under a reply that changed nothing.
 *
 * @param {readonly Message[]} messages
 * @param {string} [userId] - The id of the user message this turn answers; without one, the whole
 *   transcript is the turn
 * @returns {string | null} Null when the turn drew nothing (so it ran no tool either), or when its
 *   user message has left the transcript
 */
export function turnAnchor(messages: readonly Message[], userId?: string): string | null {
  let anchor: string | null = null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.id === userId) {
      return anchor;
    }
    const drawn =
      message.role === "assistant" && (message.content || (message.toolCalls?.length ?? 0) > 0);
    if (anchor === null && drawn) {
      anchor = message.id;
    }
  }
  return userId === undefined ? anchor : null;
}
