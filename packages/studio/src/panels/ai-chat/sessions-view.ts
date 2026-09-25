/**
 * Sessions-view.ts — the chat history pane's projection.
 *
 * Turns the stored session metadata into the rows the assistant surface draws: a title, and one
 * sentence saying when the chat was last touched and how big it is. State and storage live in
 * ai-panel / document-assistant; what a row DOES — open, delete — is a pair of actions the panel
 * hands the surface, because each addresses one session.
 *
 * New Chat is not here at all, and that is the point: it is `assistant.newChat`, the same record
 * the chat header runs, projected once by `panels/ai-panel.ts`. The two headers draw the same
 * button, so a second definition site is exactly how they would come to disagree about its name,
 * its chord, or when it is offered.
 *
 * @license MIT
 */

import { now } from "../../services/clock";
import type { ChatSessionView } from "../../surfaces/ai-chat";
import type { SessionMeta } from "../../services/ai-session-store";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Human relative timestamp: "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a locale
 * date.
 *
 * @param {number} ts
 * @param {number} [at] Epoch milliseconds to measure against; defaults to the {@link now} seam.
 * @returns {string}
 */
export function relativeTime(ts: number, at: number = now()): string {
  const delta = Math.max(0, at - ts);
  if (delta < MINUTE) {
    return "just now";
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m ago`;
  }
  if (delta < DAY) {
    return `${Math.floor(delta / HOUR)}h ago`;
  }
  if (delta < 2 * DAY) {
    return "yesterday";
  }
  if (delta < 7 * DAY) {
    return `${Math.floor(delta / DAY)}d ago`;
  }
  return new Date(ts).toLocaleDateString();
}

/**
 * One stored session, as the surface reads it.
 *
 * @param {SessionMeta} session
 * @returns {ChatSessionView}
 */
export function projectSession(session: SessionMeta): ChatSessionView {
  const count = session.messageCount;
  return {
    key: session.id,
    meta: `${relativeTime(session.updatedAt)} · ${count} ${count === 1 ? "message" : "messages"}`,
    title: session.title,
  };
}

/**
 * The chat history, in the order the store keeps it.
 *
 * @param {readonly SessionMeta[]} sessions
 * @returns {ChatSessionView[]}
 */
export function projectSessions(sessions: readonly SessionMeta[]): ChatSessionView[] {
  return sessions.map((session) => projectSession(session));
}
