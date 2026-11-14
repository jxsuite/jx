/**
 * `@jxsuite/ai/sessions`: where a host keeps its conversations (specs/ai.md §3.13).
 *
 * A {@link SessionStore} is the one contract every store meets, whatever is behind it: a browser's
 * localStorage, IndexedDB, a desktop application's files, or nothing but memory. It is asynchronous
 * because most of those are, and it reports a save that failed rather than swallowing it. The
 * stores that touch a browser or a disk live with their hosts; this module holds the contract, the
 * in-memory store, and the write queue that keeps a store's writes in the order they were asked
 * for.
 *
 * Worker-safe: it imports `./messages` and nothing host-bound (`tests/worker-safety.test.ts`).
 *
 * @module @jxsuite/ai/sessions
 * @docs extending/embedding/assistant-harness
 */

import { DEFAULT_SESSION_TITLE, persistWindow, sessionTitle } from "./messages/persist.ts";
import type { LiveMessage } from "./messages/types.ts";

/** What every store keeps to: how many conversations, how much of each, and how long a title. */
export const SESSION_LIMITS = { messages: 50, sessions: 20, titleChars: 60 } as const;

/** What a store's index holds of one conversation. */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * What a save came to. A failure is an answer, never an exception and never silence: `quota` means
 * the store is full, `unavailable` that there is no store to write to, and `not_in_index` that the
 * conversation was deleted (or never created) and so was not written.
 */
export type SaveResult =
  | { readonly ok: true; readonly meta: SessionMeta }
  | {
      readonly ok: false;
      readonly reason: "not_in_index" | "quota" | "unavailable";
      readonly message: string;
    };

/** Where a host keeps its conversations, per root (a project, or `""` for none). */
export interface SessionStore {
  /** Whether what is saved outlives the process. False for the in-memory store. */
  readonly durable: boolean;
  /** The root's conversations, most recently updated first. */
  list: (root: string) => Promise<SessionMeta[]>;
  /** A conversation's messages in the current shape, or null when there is none to read. */
  load: (root: string, id: string) => Promise<LiveMessage[] | null>;
  /** Save a conversation's window, and refresh its entry. Writes nothing for an unknown id. */
  save: (root: string, id: string, messages: readonly LiveMessage[]) => Promise<SaveResult>;
  /** Create a conversation and make it the active one, evicting the oldest past the limit. */
  create: (root: string, firstText: string) => Promise<SessionMeta>;
  remove: (root: string, id: string) => Promise<void>;
  /** Move a conversation between roots, making it the target's active one. Safe to repeat. */
  move: (fromRoot: string, toRoot: string, id: string) => Promise<void>;
  /** The conversation to restore next time, or null for a fresh one. */
  getActive: (root: string) => Promise<string | null>;
  setActive: (root: string, id: string | null) => Promise<void>;
}

/** Runs a store's operations one at a time, in the order they were asked for. */
export interface WriteQueue {
  /**
   * Run `task` after every task queued before it has settled. When nothing is queued it starts at
   * once, so a store whose operations are synchronous behaves as if there were no queue at all. A
   * task that fails rejects its own promise and does not hold up the ones behind it.
   */
  run: <Result>(task: () => Result | Promise<Result>) => Promise<Result>;
}

/**
 * A queue that serializes a store's operations. Without one, a save still in flight when the
 * conversation is deleted would land afterwards and bring it back.
 *
 * @returns {WriteQueue}
 */
export function createWriteQueue(): WriteQueue {
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();
  const settle = () => {
    pending -= 1;
  };
  /** Keep `result` in line: the next task waits for it, whether it resolves or rejects. */
  const follow = <Result>(result: Promise<Result>): Promise<Result> => {
    pending += 1;
    tail = result.then(settle, settle);
    return result;
  };
  return {
    run<Result>(task: () => Result | Promise<Result>): Promise<Result> {
      if (pending > 0) {
        return follow(tail.then(task));
      }
      /* Nothing is waiting, so the task starts now. One that finishes synchronously leaves
         nothing in flight, and the queue is idle again before this returns: a store whose
         operations are synchronous sees each write the moment it is asked for. */
      let outcome: Result | Promise<Result>;
      try {
        outcome = task();
      } catch (error) {
        return Promise.reject(error);
      }
      return outcome instanceof Promise ? follow(outcome) : Promise.resolve(outcome);
    },
  };
}

/** One root's conversations in memory. */
interface MemoryRoot {
  activeId: string | null;
  metas: SessionMeta[];
  payloads: Map<string, LiveMessage[]>;
}

/**
 * A store that keeps everything in memory: for a headless run, an eval, or a test. It holds to the
 * same limits and the same answers as a durable one.
 *
 * @param {{ newId?: () => string; now?: () => number }} [options] - The id and the clock a new
 *   conversation is given; defaults suit a process that keeps one store
 * @returns {SessionStore}
 */
export function createMemorySessionStore(
  options: { readonly newId?: () => string; readonly now?: () => number } = {},
): SessionStore {
  const roots = new Map<string, MemoryRoot>();
  let minted = 0;
  const now = options.now ?? Date.now;
  const newId =
    options.newId ??
    (() => {
      minted += 1;
      return `s_${String(now())}_${String(minted)}`;
    });
  const rootOf = (root: string): MemoryRoot => {
    let held = roots.get(root);
    if (!held) {
      held = { activeId: null, metas: [], payloads: new Map() };
      roots.set(root, held);
    }
    return held;
  };
  const newestFirst = (metas: SessionMeta[]): SessionMeta[] =>
    metas.toSorted((a, b) => b.updatedAt - a.updatedAt);

  return {
    durable: false,
    create(root, firstText) {
      const held = rootOf(root);
      const at = now();
      const meta: SessionMeta = {
        createdAt: at,
        id: newId(),
        messageCount: 0,
        title: sessionTitle(firstText, SESSION_LIMITS.titleChars),
        updatedAt: at,
      };
      held.metas.push(meta);
      held.payloads.set(meta.id, []);
      while (held.metas.length > SESSION_LIMITS.sessions) {
        const [oldest] = held.metas.toSorted((a, b) => a.updatedAt - b.updatedAt);
        held.metas = held.metas.filter((entry) => entry !== oldest);
        held.payloads.delete(oldest!.id);
      }
      held.activeId = meta.id;
      return Promise.resolve({ ...meta });
    },
    getActive: (root) => Promise.resolve(rootOf(root).activeId),
    // A copy, so a caller that changes an entry changes nothing the store holds.
    list(root) {
      const listed = newestFirst(rootOf(root).metas);
      return Promise.resolve(structuredClone(listed));
    },
    load(root, id) {
      const payload = rootOf(root).payloads.get(id);
      return Promise.resolve(payload ? structuredClone(payload) : null);
    },
    move(fromRoot, toRoot, id) {
      const from = rootOf(fromRoot);
      const meta = from.metas.find((entry) => entry.id === id);
      const payload = from.payloads.get(id);
      if (fromRoot !== toRoot && meta && payload) {
        from.metas = from.metas.filter((entry) => entry !== meta);
        from.payloads.delete(id);
        if (from.activeId === id) {
          from.activeId = null;
        }
        const to = rootOf(toRoot);
        to.metas = [...to.metas.filter((entry) => entry.id !== id), meta];
        to.payloads.set(id, payload);
        to.activeId = id;
      }
      return Promise.resolve();
    },
    remove(root, id) {
      const held = rootOf(root);
      held.metas = held.metas.filter((entry) => entry.id !== id);
      held.payloads.delete(id);
      if (held.activeId === id) {
        held.activeId = null;
      }
      return Promise.resolve();
    },
    save(root, id, messages) {
      const held = rootOf(root);
      const meta = held.metas.find((entry) => entry.id === id);
      if (!meta) {
        return Promise.resolve({
          message: "This conversation is no longer in the store, so it was not saved.",
          ok: false,
          reason: "not_in_index",
        });
      }
      const window = persistWindow(messages, SESSION_LIMITS.messages);
      held.payloads.set(id, structuredClone(window));
      meta.updatedAt = now();
      meta.messageCount = window.length;
      if (meta.title === DEFAULT_SESSION_TITLE) {
        const first = window.find((message) => message.role === "user");
        if (first) {
          meta.title = sessionTitle(first.content, SESSION_LIMITS.titleChars);
        }
      }
      return Promise.resolve({ meta: { ...meta }, ok: true });
    },
    setActive(root, id) {
      rootOf(root).activeId = id;
      return Promise.resolve();
    },
  };
}
