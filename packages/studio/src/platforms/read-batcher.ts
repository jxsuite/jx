/**
 * Read coalescing for an adapter whose every read is a network round trip (specs/desktop.md §10.1).
 *
 * Studio reads files one path at a time — `readFile(path)` is the PAL member and stays the only one
 * — and a surface that needs many reads issues them together: component discovery fires up to four
 * hundred at once, a collection grid dozens. Against a loopback backend that is free. Against a
 * remote session it is four hundred HTTP requests, each paying the gateway, the session lookup and
 * the TLS hop on its own. This module turns the reads issued in one tick into one `POST
 * /files/read` (`filesRead` in `@jxsuite/protocol`), WITHOUT a new interface member: callers still
 * call `readFile`, and only the adapter knows a batch happened (specs/desktop.md §3.1).
 *
 * Transport-agnostic on purpose. It is handed two functions — read a batch, read one — and knows
 * nothing about fetch, URLs or status codes, so every rule below is unit-testable without a mock
 * server. The adapter maps HTTP onto {@link BatchAnswer}.
 *
 * There is NO content cache. Files are mutable — the author saves, a collaborator saves, a pull
 * lands — and a cached read would be a stale read with no event to invalidate it. Coalescing only
 * ever shares a read between callers that asked in the same window, all of whom would otherwise
 * have received the same bytes anyway.
 */

import { READ_FILES_MAX_PATHS } from "@jxsuite/protocol";
import type { ReadFilesResult } from "@jxsuite/protocol";

/**
 * What one batch request came back as.
 *
 * - A {@link ReadFilesResult} — the route answered; per-path outcomes plus any omitted paths.
 * - `"unsupported"` — the backend does not have the route (an older platform). Batching turns off for
 *   good, because asking again would only cost a wasted request per flush.
 * - `"retry-singly"` — the route exists but this call failed (a 5xx, a 429). Only that chunk falls
 *   back to single reads; the next flush tries a batch again.
 */
export type BatchAnswer = ReadFilesResult | "unsupported" | "retry-singly";

export interface ReadBatcherOptions {
  /** Read many paths in one request. A REJECTION means the network failed: the chunk rejects. */
  fetchBatch: (paths: string[]) => Promise<BatchAnswer>;
  /** Read one path the old way. Its errors are the errors a single read has always surfaced. */
  fetchOne: (path: string) => Promise<string>;
  /** Paths per batch request. Defaults to the protocol's own limit. */
  maxPaths?: number;
  /** Batch requests allowed in flight at once, across every flush. Defaults to 4. */
  maxInFlight?: number;
  /**
   * Defers a flush. `queueMicrotask` by default: everything a caller issues synchronously — a
   * `Promise.all` over a map, a loop of un-awaited reads — lands in one window, and the flush runs
   * before any timer or I/O callback, so coalescing costs no measurable latency.
   */
  schedule?: (fn: () => void) => void;
}

export interface ReadBatcher {
  /** Read one path's text; resolves or rejects exactly as a single read would have. */
  read: (path: string) => Promise<string>;
}

interface Waiter {
  resolve: (content: string) => void;
  reject: (error: unknown) => void;
}

/** Path → every caller waiting on it. Same-path reads in one window share ONE request and result. */
type Pending = Map<string, Waiter[]>;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Create a batcher. One per adapter instance: its "unsupported" verdict is about that adapter's
 * backend, and must not leak to another session.
 */
export function createReadBatcher(options: ReadBatcherOptions): ReadBatcher {
  const maxPaths = Math.max(1, options.maxPaths ?? READ_FILES_MAX_PATHS);
  const maxInFlight = Math.max(1, options.maxInFlight ?? 4);
  const schedule = options.schedule ?? queueMicrotask;

  let pending: Pending = new Map();
  let flushScheduled = false;
  /* Cleared the first time the backend says it has no batch route; never set again. An older
     platform does not grow the route mid-session, and probing it on every flush would add a
     request to every read instead of removing them. */
  let batching = true;
  /* Chunks waiting for a request slot, and how many slots are taken. The cap is across flushes,
     not per flush: two surfaces opening at once must not double the load one surface is allowed. */
  const queued: Pending[] = [];
  let inFlight = 0;

  function enqueue(path: string, waiters: Waiter[]): void {
    const existing = pending.get(path);
    if (existing) {
      existing.push(...waiters);
    } else {
      pending.set(path, waiters);
    }
    if (!flushScheduled) {
      flushScheduled = true;
      schedule(flush);
    }
  }

  /** Serve one path through `fetchOne`, settling every waiter on it with the same answer. */
  function single(path: string, waiters: readonly Waiter[]): void {
    options.fetchOne(path).then(
      (content) => {
        for (const waiter of waiters) {
          waiter.resolve(content);
        }
      },
      (error: unknown) => {
        for (const waiter of waiters) {
          waiter.reject(error);
        }
      },
    );
  }

  function flush(): void {
    flushScheduled = false;
    const batch = pending;
    pending = new Map();
    /* One path is not a batch. It goes out as today's single read — the same request, the same
       error text — so an editor opening one file sees no difference at all. */
    if (!batching || batch.size === 1) {
      for (const [path, waiters] of batch) {
        single(path, waiters);
      }
      return;
    }
    let chunk: Pending = new Map();
    for (const [path, waiters] of batch) {
      chunk.set(path, waiters);
      if (chunk.size === maxPaths) {
        queued.push(chunk);
        chunk = new Map();
      }
    }
    if (chunk.size > 0) {
      queued.push(chunk);
    }
    pump();
  }

  /** Start queued chunks while there are free request slots. */
  function pump(): void {
    while (inFlight < maxInFlight && queued.length > 0) {
      start(queued.shift()!);
    }
  }

  /** Run one chunk in a request slot, handing the slot on when it settles. */
  function start(chunk: Pending): void {
    inFlight += 1;
    void runChunk(chunk).finally(() => {
      inFlight -= 1;
      pump();
    });
  }

  async function runChunk(chunk: Pending): Promise<void> {
    /* Batching may have been turned off by another chunk's answer while this one waited for a
       slot; it would only be told "unsupported" again. */
    if (!batching) {
      for (const [path, waiters] of chunk) {
        single(path, waiters);
      }
      return;
    }
    let answer: BatchAnswer;
    try {
      answer = await options.fetchBatch([...chunk.keys()]);
    } catch (error) {
      /* The request itself failed — offline, a dropped connection. Single reads issued now would
         fail the same way, so the chunk fails as a whole, with the transport's own error. */
      for (const waiters of chunk.values()) {
        for (const waiter of waiters) {
          waiter.reject(error);
        }
      }
      return;
    }
    /* Anything that is not an object cannot be a ReadFilesResult (a `null` body, a bare string).
       The route did not answer this chunk, so it is served singly — the same as a failed call. */
    if (answer === "retry-singly" || answer === "unsupported" || !isObject(answer)) {
      if (answer === "unsupported") {
        batching = false;
      }
      for (const [path, waiters] of chunk) {
        single(path, waiters);
      }
      return;
    }
    try {
      settleAnswer(chunk, answer);
    } catch {
      /* A batcher bug must never strand a reader: every path settleAnswer had not yet taken out
         of the chunk gets the single read. Paths it already settled or re-queued are gone from
         the chunk, so nothing is read twice. */
      for (const [path, waiters] of chunk) {
        single(path, waiters);
      }
    }
  }

  function settleAnswer(chunk: Pending, answer: ReadFilesResult): void {
    let answered = 0;
    for (const entry of Array.isArray(answer.files) ? answer.files : []) {
      const [path, outcome] = Array.isArray(entry) ? entry : [];
      const waiters = path === undefined ? undefined : chunk.get(path);
      if (path === undefined || !waiters) {
        continue; // A path nobody asked for, or one already settled by a duplicate row.
      }
      chunk.delete(path);
      answered += 1;
      if (typeof (outcome as { content?: unknown } | undefined)?.content === "string") {
        const { content } = outcome as { content: string };
        for (const waiter of waiters) {
          waiter.resolve(content);
        }
      } else {
        // Per path: one missing file (404), one binary file (415) fails ITS readers and no others.
        const message = (outcome as { error?: { message?: string } } | undefined)?.error?.message;
        const error = new Error(message || `Failed to read file: ${path}`);
        for (const waiter of waiters) {
          waiter.reject(error);
        }
      }
    }

    const omitted = (Array.isArray(answer.omitted) ? answer.omitted : []).filter((path) =>
      chunk.has(path),
    );
    /* Progress guard. The contract says the first path is always answered, so an answer that
       settled nothing yet omitted something is a backend breaking that promise — and re-queueing
       everything would ask it the same question forever. Take one path out of the loop by reading
       it singly; the rest go round again, smaller by one each time. */
    if (answered === 0 && omitted.length > 0) {
      const first = omitted.shift()!;
      single(first, chunk.get(first)!);
      chunk.delete(first);
    }
    for (const path of omitted) {
      enqueue(path, chunk.get(path)!);
      chunk.delete(path);
    }
    /* Anything still here was neither answered nor omitted: a malformed answer. Hanging its
       readers forever would be the worst possible outcome, so they get the single read instead. */
    for (const [path, waiters] of chunk) {
      single(path, waiters);
    }
  }

  return {
    read(path: string): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        enqueue(path, [{ reject, resolve }]);
      });
    },
  };
}
