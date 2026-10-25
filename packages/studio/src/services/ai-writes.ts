/**
 * Ai-writes.ts — what the assistant changed, per turn, and whether you can take it back.
 *
 * `ai.md` §3.2 (the accountable turn). Two facts about an assistant turn were legible only to the
 * model:
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
 *
 * @docs studio/ai/chat
 */

import type { LiveMessage } from "@jxsuite/ai/messages";
import { createLedger } from "@jxsuite/ai/tools";
import type { AiWrite, WriteLedger } from "@jxsuite/ai/tools";
import { undo } from "../tabs/transact";
import type { BatchReceipt } from "../tabs/transact";
import type { Tab } from "../tabs/tab";

export type { AiWrite } from "@jxsuite/ai/tools";

/** Every write recorded during one assistant turn, in the order the tools made them. */
export interface AiTurn {
  /** The id of the assistant message the turn produced — how the panel finds its own ledger. */
  id: string;
  writes: AiWrite[];
  /** Where each of the turn's undo steps landed, oldest first: what Restore takes back. */
  batches: BatchReceipt[];
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
 * @param {readonly BatchReceipt[]} [batches] - The receipts its batch lane returned on close
 * @returns {AiWrite[]} What was filed
 */
export function fileTurn(
  anchor: string,
  writes: readonly AiWrite[],
  batches: readonly BatchReceipt[] = [],
): AiWrite[] {
  if (writes.length === 0) {
    return [];
  }
  const turn: AiTurn = { batches: [...batches], id: anchor, writes: [...writes] };
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
 * Undo every step one turn left, across every document it wrote, or nothing at all.
 *
 * `ai.md` §3.2. The turn's batch lane closed one step per document it wrote (two when a person's
 * edit split it), and each receipt names its entry. A step is taken back only while it is the top
 * of its tab's history, newest first, so Restore never undoes an edit that is not the turn's: a
 * person's edit made since, a step already undone, a closed tab or a shared document whose undo the
 * session owns each refuse the whole Restore with a sentence naming the document. Every receipt is
 * checked before anything is undone, because a Restore that took back SOME of a turn would be worse
 * than one that refused.
 *
 * @param {string} id - The message the turn is filed under
 * @returns {string | Tab[]} Why it refused, or the tabs it undid
 */
export function restoreTurn(id: string): string | Tab[] {
  const turn = turns.find((filed) => filed.id === id);
  const lost = "There is no longer a record of what that turn changed.";
  if (!turn) {
    return lost;
  }
  const disk = turn.writes.filter((w) => w.disk).map((w) => w.path);
  if (disk.length > 0) {
    return (
      `Cannot restore: ${disk.join(", ")} ${disk.length === 1 ? "was" : "were"} written straight ` +
      "to disk, which undo cannot reach."
    );
  }
  if (turn.batches.length === 0) {
    return lost;
  }
  const byTab = new Map<Tab, BatchReceipt[]>();
  for (const receipt of turn.batches) {
    byTab.set(receipt.tab, [...(byTab.get(receipt.tab) ?? []), receipt]);
  }
  for (const [tab, receipts] of byTab) {
    const refusal = refuseTab(tab, receipts);
    if (refusal) {
      return refusal;
    }
  }
  for (const [tab, receipts] of byTab) {
    for (const _ of receipts) {
      undo(tab);
    }
  }
  return [...byTab.keys()];
}

/** Why `tab`'s steps from one turn cannot be undone, or null when they are its newest entries. */
function refuseTab(tab: Tab, receipts: readonly BatchReceipt[]): string | null {
  const path = tab.documentPath ?? "(untitled)";
  if (tab.scope.active === false) {
    return `Cannot restore: ${path} was closed after that turn.`;
  }
  if (receipts.some((receipt) => receipt.entry === null)) {
    return (
      `Cannot restore: ${path} is shared live, and Restore cannot check its undo history. ` +
      "Undo it in the document instead."
    );
  }
  const { index, snapshots } = tab.history;
  const top = snapshots.slice(index - receipts.length + 1, index + 1);
  const matches =
    index - receipts.length >= 0 && receipts.every((receipt, at) => top[at] === receipt.entry);
  if (matches) {
    return null;
  }
  return snapshots.indexOf(receipts.at(-1)!.entry!) > index
    ? `Cannot restore: that turn's change to ${path} was already undone.`
    : `Cannot restore: ${path} has edits made since that turn began, which Restore would undo too.`;
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
  const diskPaths = new Set(applied.flatMap((w) => (w.disk ? [w.path] : [])));
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

/**
 * Drop every ledger: New Chat (the messages they are drawn under are gone), leaving a project
 * (their paths name the project left behind; `setWorkspaceProject`), and tests.
 */
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
 * @param {readonly LiveMessage[]} messages
 * @param {string} [userId] - The id of the user message this turn answers; without one, the whole
 *   transcript is the turn
 * @returns {string | null} Null when the turn drew nothing (so it ran no tool either), or when its
 *   user message has left the transcript
 */
export function turnAnchor(messages: readonly LiveMessage[], userId?: string): string | null {
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
