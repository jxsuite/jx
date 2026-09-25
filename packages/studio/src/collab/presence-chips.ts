/**
 * Presence chips — who else is in this co-editing session, the sync-status pill that replaces the
 * dirty dot for collab tabs, and the two states co-editing had no way to announce (§7.4).
 *
 * Pure projections of `collabState(tab)`: the Command Bar surface draws the cluster and the pane's
 * own chrome draws the banner, and both are documents, so nothing here renders.
 *
 * **What was invisible.** Three things:
 *
 * - **The source-canonical freeze.** While a peer holds the code view, structural edits are refused.
 *   The whole rendering of that was a three-second grey status line the moment you tried — which is
 *   precisely what a bug looks like. It gets a persistent indicator, so the refusal has a visible
 *   cause standing beside it for as long as it is true.
 * - **Read-only guests.** Their edits applied locally and were dropped at the publish gate. They now
 *   get a banner that says so before they type, not a silence after. The banner itself lives in
 *   `surfaces/pane-context.json`, drawn from `collabState(tab)` by the pane's own chrome: the
 *   sentence has to stand above the editing surface and inside the band the stage is offset by, and
 *   that band is a document now. What stays here is everything the TOOLBAR draws.
 * - **A failed attach.** It set `status = "detached"` — the same value a solo document carries — so a
 *   dead relay was indistinguishable from nobody having shared the file. `"failed"` and
 *   `"unavailable"` are now separate states with separate sentences.
 *
 * **Undo says what it does.** The Y.UndoManager is constructed with `trackedOrigins:
 * {LOCAL_ORIGIN}`, so ⌘Z reaches your own actions and never a peer's. That is the correct behaviour
 * and it is also surprising, so the status pill's title states it — §13 lists this as adopted
 * precisely because silently undoing someone else's work is worse than not undoing.
 */

import { collabState } from "./collab-state";
import type { CollabTabStatus, PeerPresence } from "./collab-state";
import type { Tab } from "../tabs/tab";

function initialOf(peer: PeerPresence): string {
  const name = peer.state.user.name ?? peer.state.user.login;
  return (name[0] ?? "?").toUpperCase();
}

function titleOf(peer: PeerPresence, docPath: string | null): string {
  const { user } = peer.state;
  const who = user.name ? `${user.name} (${user.login})` : user.login;
  const here = peer.state.focusedPath && peer.state.focusedPath === docPath;
  return here ? who : `${who} — ${peer.state.focusedPath ?? "browsing"}`;
}

/** One line per status. Every state says what it is; none of them say nothing. */
const STATUS_LABEL: Readonly<Record<CollabTabStatus, string>> = {
  connecting: "Connecting…",
  detached: "Solo",
  failed: "Not connected",
  offline: "Offline — changes sync on reconnect",
  synced: "Live",
  unavailable: "",
};

/**
 * The sentence behind the pill — including the one undo fact nobody would guess.
 *
 * @param {CollabTabStatus} status
 * @param {string} attachError
 * @returns {string}
 */
export function statusTitle(status: CollabTabStatus, attachError: string): string {
  if (status === "failed") {
    return (
      `Live collaboration could not start${attachError ? ` — ${attachError}` : ""}. ` +
      "Your edits are saved to this machine as usual."
    );
  }
  if (status === "synced" || status === "offline") {
    return `${STATUS_LABEL[status]}. Undo only takes back your own edits, never a collaborator's.`;
  }
  return STATUS_LABEL[status];
}

/** One peer, as the Command Bar draws it: a coloured chip with the person's initial or avatar. */
export interface PresencePeerProjection {
  /** The awareness client id, the row key. */
  key: number;
  color: string;
  /** Who, and where they are when it is not this document. */
  title: string;
  initial: string;
  avatarUrl: string;
  hasAvatar: boolean;
}

/** The presence cluster, projected for the `commandbar` surface. */
export interface PresenceProjection {
  status: CollabTabStatus;
  /** The status word: Live, Solo, Offline… */
  label: string;
  /** The sentence behind the cluster, from {@link statusTitle}. */
  title: string;
  readOnly: boolean;
  /** Someone holds the code view, so structural edits are paused. */
  frozen: boolean;
  peers: PresencePeerProjection[];
}

/**
 * The presence cluster for a tab, or null when there is nothing to say.
 *
 * "unavailable" is the only silent state: this build has no collaboration, so there is nothing to
 * be honest ABOUT. Every other state — including solo and failed — says which one it is.
 */
export function presenceProjection(tab: Tab | null): PresenceProjection | null {
  if (!tab) {
    return null;
  }
  const state = collabState(tab);
  if (state.status === "unavailable") {
    return null;
  }
  return {
    frozen: state.sourceCanonical,
    label: STATUS_LABEL[state.status] || state.status,
    peers: state.peers.map((peer) => ({
      avatarUrl: peer.state.user.avatarUrl ?? "",
      color: peer.state.user.color,
      hasAvatar: Boolean(peer.state.user.avatarUrl),
      initial: initialOf(peer),
      key: peer.clientId,
      title: titleOf(peer, tab.documentPath),
    })),
    readOnly: state.readOnly,
    status: state.status,
    title: statusTitle(state.status, state.attachError),
  };
}
