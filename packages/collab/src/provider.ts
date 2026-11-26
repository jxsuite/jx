/**
 * Provider contract types — what `StudioPlatform.collab?.(docPath)` resolves to. Type-only on
 * purpose: Studio's base bundle imports this without pulling yjs in; the runtime lives behind a
 * dynamic import of the concrete provider.
 */

import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { CollabPermission } from "./envelope.ts";

export type CollabStatus = "connecting" | "connected" | "offline";

/**
 * A save the server refused because the file is no longer what the room was loaded from or last
 * saved (`project-state.md` §5): what is on disk now, both `null` when nothing is.
 */
export interface CollabConflict {
  diskHash: string | null;
  docId: string | null;
}

export interface CollabIdentity {
  login: string;
  name?: string;
  avatarUrl?: string;
  color: string;
  permission: CollabPermission;
}

/**
 * A live co-editing session for one document. The Y.Doc starts EMPTY and fills from the provider
 * (server-seeded source; client-derived structure) — never seed it locally before whenSynced.
 */
export interface CollabHandle {
  doc: Y.Doc;
  /** The connection's shared project-level awareness (one instance across all open docs). */
  awareness: Awareness;
  /** Resolves after the initial sync handshake completes for this doc. */
  whenSynced: Promise<void>;
  /** Identity issued by the server's hello; null until the connection greeted. */
  identity: () => CollabIdentity | null;
  /**
   * Ask the provider to persist this doc to durable storage now (Cmd+S). Resolves once the text is
   * durable; rejects with the reason when nothing was written, or when no answer can arrive (the
   * socket is down, the document reset, or the handle or connection was destroyed; collab.md §1.2).
   * `baseHash` names the bytes the save replaces in place of the room's own base (`null`: nothing
   * is there), which is how the author keeps the room's edits over a file that changed under it
   * (`project-state.md` §6.1).
   */
  flush: (options?: { baseHash?: string | null }) => Promise<void>;
  /**
   * Discard the room's unsaved edits and reseed it from storage (`project-state.md` §6.1, taking
   * the disk's copy). Resolves once the server reset the room, which every participant sees as
   * `onReset`. Optional: a provider whose rooms never refuse a save has no conflict to resolve.
   */
  revert?: () => Promise<void>;
  /** Connection status changes (shared per connection). Returns an unsubscribe. */
  onStatus: (cb: (status: CollabStatus) => void) => () => void;
  /**
   * The server reset this doc's history (epoch bump after discard/pull/external write). The handle
   * is dead: destroy it and re-acquire a fresh one via platform.collab.
   */
  onReset: (cb: () => void) => () => void;
  /**
   * Room-level unsaved state changed: any peer edited since the last persist, or a persist cleared
   * it. Fires immediately with the current value on subscribe (the server sends it during the open
   * handshake, so the callback must run synchronously to win that race). Returns an unsubscribe.
   */
  onDirty: (cb: (dirty: boolean) => void) => () => void;
  /**
   * A save of the room was refused (`doc-conflict`): the file changed under it. The room stays
   * dirty, and its participants decide whose bytes win (`project-state.md` §6.1). Optional: a
   * provider whose server never refuses a save has nothing to report. Returns an unsubscribe.
   */
  onConflict?: (cb: (conflict: CollabConflict) => void) => () => void;
  destroy: () => void;
}

/**
 * The platform's `collab` member. Three answers, each one state in collab.md §4: a handle joins;
 * `null` means no room serves this document here and nothing went wrong (unavailable); a rejection
 * means an attach was tried and could not complete, and its message is the reason (failed).
 */
export type CollabCapability = (docPath: string) => Promise<CollabHandle | null>;
