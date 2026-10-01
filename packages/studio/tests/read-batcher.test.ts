/**
 * The read batcher (src/platforms/read-batcher.ts), driven entirely through its injected seams.
 *
 * `schedule` is captured rather than run, so each test decides when a flush happens and can say
 * exactly which reads shared a window. `fetchBatch` and `fetchOne` are recorders whose answers the
 * test controls, including holding one open to issue reads "during" it.
 */
import { describe, expect, test } from "bun:test";
import { READ_FILES_MAX_PATHS } from "@jxsuite/protocol";
import type { ReadFilesResult } from "@jxsuite/protocol";
import { createReadBatcher } from "../src/platforms/read-batcher";
import type { BatchAnswer, ReadBatcherOptions } from "../src/platforms/read-batcher";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

/** Let every queued microtask (and the ones they queue) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/** Answer every requested path with content derived from its name. */
function answerAll(paths: string[]): ReadFilesResult {
  return { files: paths.map((path) => [path, { content: `<${path}>` }]), omitted: [] };
}

interface Harness {
  batches: string[][];
  singles: string[];
  /** Run the flush the batcher scheduled; throws when none is pending. */
  flush: () => void;
  /** How many flushes are waiting. */
  scheduled: () => number;
  read: (path: string) => Promise<string>;
}

function harness(
  overrides: Partial<ReadBatcherOptions> & {
    batch?: (paths: string[]) => Promise<BatchAnswer>;
    one?: (path: string) => Promise<string>;
  } = {},
): Harness {
  const batches: string[][] = [];
  const singles: string[] = [];
  const queue: (() => void)[] = [];
  const { batch, one, ...rest } = overrides;
  const batcher = createReadBatcher({
    fetchBatch: async (paths) => {
      batches.push(paths);
      return batch ? batch(paths) : answerAll(paths);
    },
    fetchOne: async (path) => {
      singles.push(path);
      return one ? one(path) : `single:${path}`;
    },
    schedule: (fn) => {
      queue.push(fn);
    },
    ...rest,
  });
  return {
    batches,
    flush: () => {
      const fn = queue.shift();
      if (!fn) {
        throw new Error("no flush was scheduled");
      }
      fn();
    },
    read: (path) => batcher.read(path),
    scheduled: () => queue.length,
    singles,
  };
}

describe("coalescing", () => {
  test("N reads in one window become ONE batch request, each resolving to its own content", async () => {
    const h = harness();
    const reads = ["a.json", "b.json", "c.json"].map((path) => h.read(path));
    // One flush scheduled for the whole window, not one per read.
    expect(h.scheduled()).toBe(1);
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a.json>", "<b.json>", "<c.json>"]);
    expect(h.batches).toEqual([["a.json", "b.json", "c.json"]]);
    expect(h.singles).toEqual([]);
  });

  test("same-path reads in one window share one request and one result", async () => {
    const h = harness();
    const reads = [h.read("a.json"), h.read("a.json"), h.read("b.json")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a.json>", "<a.json>", "<b.json>"]);
    expect(h.batches).toEqual([["a.json", "b.json"]]);
  });

  test("a lone read is today's single request, not a batch of one", async () => {
    const h = harness();
    const read = h.read("a.json");
    h.flush();
    expect(await read).toBe("single:a.json");
    expect(h.batches).toEqual([]);
    expect(h.singles).toEqual(["a.json"]);
  });

  test("two reads of ONE path are still a single read — dedupe happens before the count", async () => {
    const h = harness();
    const reads = [h.read("a.json"), h.read("a.json")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a.json", "single:a.json"]);
    expect(h.singles).toEqual(["a.json"]);
  });

  test("a lone read's failure is the single read's own error", async () => {
    const h = harness({
      one: async () => {
        throw new Error("No such file: a.json");
      },
    });
    const read = h.read("a.json");
    h.flush();
    expect(String(await read.catch((error: unknown) => error))).toBe("Error: No such file: a.json");
  });

  test("defaults to queueMicrotask, so a Promise.all needs no help to coalesce", async () => {
    const batches: string[][] = [];
    const batcher = createReadBatcher({
      fetchBatch: async (paths) => {
        batches.push(paths);
        return answerAll(paths);
      },
      fetchOne: async (path) => `single:${path}`,
    });
    expect(await Promise.all([batcher.read("x"), batcher.read("y")])).toEqual(["<x>", "<y>"]);
    expect(batches).toEqual([["x", "y"]]);
  });

  test("reads issued while a batch is in flight start a NEW batch rather than joining it", async () => {
    const gate = deferred<BatchAnswer>();
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        return calls === 1 ? gate.promise : answerAll(paths);
      },
    });
    const first = [h.read("a"), h.read("b")];
    h.flush();
    await settle();
    // The first batch is open; these two are a second window, and a second request.
    const second = [h.read("a"), h.read("c")];
    expect(h.scheduled()).toBe(1);
    h.flush();
    expect(await Promise.all(second)).toEqual(["<a>", "<c>"]);
    gate.resolve(answerAll(["a", "b"]));
    expect(await Promise.all(first)).toEqual(["<a>", "<b>"]);
    // No cache: "a" was read twice, because it was asked for twice in two windows.
    expect(h.batches).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });

  test("nothing is cached once a read settles — files are mutable", async () => {
    let version = 0;
    const h = harness({ one: async () => `v${version}` });
    const first = h.read("a");
    h.flush();
    expect(await first).toBe("v0");
    version = 1;
    const second = h.read("a");
    h.flush();
    expect(await second).toBe("v1");
  });
});

describe("chunking and concurrency", () => {
  test("defaults to the protocol's path limit", async () => {
    const h = harness();
    const paths = Array.from({ length: READ_FILES_MAX_PATHS + 1 }, (_, i) => `f${i}`);
    const reads = paths.map((path) => h.read(path));
    h.flush();
    await Promise.all(reads);
    expect(h.batches.map((b) => b.length)).toEqual([READ_FILES_MAX_PATHS, 1]);
  });

  test("a window larger than maxPaths is split into chunks, in order", async () => {
    const h = harness({ maxPaths: 2 });
    const reads = ["a", "b", "c", "d", "e"].map((path) => h.read(path));
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a>", "<b>", "<c>", "<d>", "<e>"]);
    expect(h.batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  test("no more than maxInFlight batch requests are open at once", async () => {
    const gates: Deferred<BatchAnswer>[] = [];
    let open = 0;
    let peak = 0;
    const h = harness({
      batch: async () => {
        open += 1;
        peak = Math.max(peak, open);
        const gate = deferred<BatchAnswer>();
        gates.push(gate);
        const answer = await gate.promise;
        open -= 1;
        return answer;
      },
      maxInFlight: 2,
      maxPaths: 2,
    });
    const paths = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const reads = paths.map((path) => h.read(path));
    h.flush();
    await settle();
    // Four chunks, two slots: only two requests have gone out.
    expect(h.batches).toHaveLength(2);
    for (let released = 0; released < 4; released += 1) {
      const gate = gates[released]!;
      gate.resolve(answerAll(h.batches[released]!));
      await settle();
    }
    expect(await Promise.all(reads)).toEqual(paths.map((p) => `<${p}>`));
    expect(h.batches).toHaveLength(4);
    expect(peak).toBe(2);
  });

  test("the in-flight cap holds ACROSS windows, not just within one", async () => {
    const gate = deferred<BatchAnswer>();
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        return calls === 1 ? gate.promise : answerAll(paths);
      },
      maxInFlight: 1,
    });
    const first = [h.read("a"), h.read("b")];
    h.flush();
    await settle();
    const second = [h.read("c"), h.read("d")];
    h.flush();
    await settle();
    // The second window's chunk waits for the slot the first one holds.
    expect(h.batches).toEqual([["a", "b"]]);
    gate.resolve(answerAll(["a", "b"]));
    expect(await Promise.all([...first, ...second])).toEqual(["<a>", "<b>", "<c>", "<d>"]);
    expect(h.batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("partial answers", () => {
  test("omitted paths are asked for again in the next flush", async () => {
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        if (calls === 1) {
          return { files: [["a", { content: "<a>" }]], omitted: ["b", "c"] };
        }
        return answerAll(paths);
      },
    });
    const reads = [h.read("a"), h.read("b"), h.read("c")];
    h.flush();
    await settle();
    expect(await reads[0]).toBe("<a>");
    // The omissions re-entered the queue and scheduled their own flush.
    expect(h.scheduled()).toBe(1);
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a>", "<b>", "<c>"]);
    expect(h.batches).toEqual([
      ["a", "b", "c"],
      ["b", "c"],
    ]);
  });

  test("an omitted path joins reads of it issued meanwhile — one request serves them all", async () => {
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        return calls === 1
          ? { files: [["a", { content: "<a>" }]], omitted: ["b"] }
          : answerAll(paths);
      },
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    // Issued before the first batch answers: it waits in the next window.
    const later = [h.read("b"), h.read("z")];
    await settle();
    h.flush();
    expect(await Promise.all([...reads, ...later])).toEqual(["<a>", "<b>", "<b>", "<z>"]);
    expect(h.batches).toEqual([
      ["a", "b"],
      ["b", "z"],
    ]);
  });

  test("progress guard: an answer that settles nothing reads its first omission singly", async () => {
    // A backend breaking "the first path is always answered" must not loop the client forever.
    const h = harness({ batch: async (paths) => ({ files: [], omitted: paths }) });
    const reads = [h.read("a"), h.read("b"), h.read("c")];
    h.flush();
    await settle();
    expect(h.singles).toEqual(["a"]);
    expect(await reads[0]).toBe("single:a");
    h.flush(); // ["b", "c"] again, omitted again: "b" goes singly.
    await settle();
    h.flush(); // ["c"] alone is a single read.
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b", "single:c"]);
    expect(h.batches).toEqual([
      ["a", "b", "c"],
      ["b", "c"],
    ]);
    expect(h.singles).toEqual(["a", "b", "c"]);
  });

  test("per-path errors reject only that path's readers", async () => {
    const h = harness({
      batch: async () => ({
        files: [
          ["ok.json", { content: "{}" }],
          ["gone.json", { error: { code: "not_found", message: "No such file", status: 404 } }],
          ["logo.png", { error: { code: "binary", message: "Binary file", status: 415 } }],
        ],
        omitted: [],
      }),
    });
    const ok = h.read("ok.json");
    const gone = [h.read("gone.json"), h.read("gone.json")];
    const binary = h.read("logo.png");
    h.flush();
    const [okOutcome, ...rest] = await Promise.allSettled([ok, ...gone, binary]);
    expect(okOutcome).toEqual({ status: "fulfilled", value: "{}" });
    expect(rest.map((o) => String((o as PromiseRejectedResult).reason))).toEqual([
      "Error: No such file",
      "Error: No such file",
      "Error: Binary file",
    ]);
  });

  test("an error with no message names the path, as a single read's fallback does", async () => {
    const h = harness({
      batch: async () => ({
        files: [
          ["a", { error: { message: "", status: 502 } }],
          ["b", { content: "<b>" }],
        ],
        omitted: [],
      }),
    });
    const a = h.read("a");
    const b = h.read("b");
    h.flush();
    expect(String(await a.catch((error: unknown) => error))).toBe("Error: Failed to read file: a");
    expect(await b).toBe("<b>");
  });

  test("a malformed answer never hangs a reader: unaccounted paths are read singly", async () => {
    // `{}` at 200 — no files, no omitted. Rows naming paths nobody asked for are ignored.
    const h = harness({
      batch: async () => ({ files: [["stranger", { content: "?" }]] }) as unknown as BatchAnswer,
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b"]);
  });

  test("a null answer (a 200 whose JSON body is null) reads its chunk singly; batching stays on", async () => {
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        return calls === 1 ? (null as never) : answerAll(paths);
      },
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b"]);
    const next = [h.read("c"), h.read("d")];
    h.flush();
    expect(await Promise.all(next)).toEqual(["<c>", "<d>"]);
  });

  test("any non-object answer — a string, a number — is read singly rather than trusted", async () => {
    for (const answer of ["surprise", 42, undefined]) {
      const h = harness({ batch: async () => answer as never });
      const reads = [h.read("a"), h.read("b")];
      h.flush();
      expect(await Promise.all(reads)).toEqual(["single:a", "single:b"]);
    }
  });

  test("a throw while settling an answer never strands a reader", async () => {
    /* A getter that throws stands in for any bug inside settleAnswer: nothing it had not already
       settled may be left pending, and nothing it HAD settled is read a second time. */
    const h = harness({
      batch: async () =>
        ({
          get files(): never {
            throw new Error("boom");
          },
        }) as unknown as BatchAnswer,
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b"]);
    expect(h.singles).toEqual(["a", "b"]);
  });

  test("a throw part-way through settling re-reads only the paths still unsettled", async () => {
    const h = harness({
      batch: async () =>
        ({
          files: [["a", { content: "<a>" }]],
          get omitted(): never {
            throw new Error("boom");
          },
        }) as unknown as BatchAnswer,
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a>", "single:b"]);
    expect(h.singles).toEqual(["b"]);
  });

  test("a non-array row or a duplicated row is skipped rather than trusted", async () => {
    const h = harness({
      batch: async () =>
        ({
          files: ["junk", ["a", { content: "<a>" }], ["a", { content: "second" }]],
          omitted: [],
        }) as unknown as BatchAnswer,
    });
    const reads = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(reads)).toEqual(["<a>", "single:b"]);
  });
});

describe("fallbacks", () => {
  test('"unsupported" serves the chunk singly and turns batching off for good', async () => {
    const h = harness({ batch: async () => "unsupported" });
    const first = [h.read("a"), h.read("b")];
    h.flush();
    expect(await Promise.all(first)).toEqual(["single:a", "single:b"]);
    const second = [h.read("c"), h.read("d")];
    h.flush();
    expect(await Promise.all(second)).toEqual(["single:c", "single:d"]);
    // Asked once, never again.
    expect(h.batches).toEqual([["a", "b"]]);
    expect(h.singles).toEqual(["a", "b", "c", "d"]);
  });

  test('a chunk queued behind an "unsupported" answer goes singly without asking', async () => {
    const h = harness({ batch: async () => "unsupported", maxInFlight: 1, maxPaths: 2 });
    const reads = ["a", "b", "c", "d"].map((path) => h.read(path));
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b", "single:c", "single:d"]);
    expect(h.batches).toEqual([["a", "b"]]);
  });

  test('"retry-singly" re-serves only its own chunk, and batching stays on', async () => {
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        return calls === 1 ? "retry-singly" : answerAll(paths);
      },
      maxPaths: 2,
    });
    const reads = ["a", "b", "c", "d"].map((path) => h.read(path));
    h.flush();
    expect(await Promise.all(reads)).toEqual(["single:a", "single:b", "<c>", "<d>"]);
    expect(h.singles).toEqual(["a", "b"]);
    const next = [h.read("e"), h.read("f")];
    h.flush();
    expect(await Promise.all(next)).toEqual(["<e>", "<f>"]);
  });

  test("a network failure rejects every reader of that chunk, and only that chunk", async () => {
    let calls = 0;
    const h = harness({
      batch: async (paths) => {
        calls += 1;
        if (calls === 1) {
          throw new TypeError("Failed to fetch");
        }
        return answerAll(paths);
      },
      maxPaths: 2,
    });
    const failed = [h.read("a"), h.read("a"), h.read("b")];
    const fine = h.read("c");
    h.flush();
    const outcomes = await Promise.allSettled(failed);
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected", "rejected"]);
    for (const outcome of outcomes) {
      expect(String((outcome as PromiseRejectedResult).reason)).toContain("Failed to fetch");
    }
    expect(await fine).toBe("<c>");
    // Not a verdict on the route: the next window batches again.
    const next = [h.read("d"), h.read("e")];
    h.flush();
    expect(await Promise.all(next)).toEqual(["<d>", "<e>"]);
    expect(h.singles).toEqual([]);
  });
});
