/**
 * Message-id.ts — the one source of message ids in a process.
 *
 * Chat-state stamps every message it creates with `msg_<epoch ms>_<n>`, and the harness mints the
 * ids of the messages a turn adds in the same scheme. One counter serves both, so an id the harness
 * minted can never collide with one chat-state minted, and a host can adopt either kind into the
 * other's transcript.
 *
 * @license MIT
 */

let counter = 0;

/**
 * The next message id: `msg_<epoch ms>_<n>`, where `n` only ever increases.
 *
 * @returns {string}
 */
export function nextMessageId(): string {
  counter += 1;
  return `msg_${Date.now()}_${counter}`;
}
