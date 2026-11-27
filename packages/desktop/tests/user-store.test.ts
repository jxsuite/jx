/**
 * Tests for src/backend/user-store.ts — the shared user-level JSON store primitive.
 *
 * The three properties here are the ones no consumer exercises in ordinary single-window use, and
 * each of them is a defect the stores this replaced actually had: an interrupted write leaving torn
 * JSON, a store keeping a world-readable mode forever, and two concurrent read-modify-writes each
 * reading the same base so the second dropped the first's edit.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  readJsonStore,
  readStringStore,
  StoreLockTimeoutError,
  updateStore,
  withFileLock,
  writeStore,
} from "../src/backend/user-store";

const DIR = mkdtempSync(join(process.env.TMPDIR || "/tmp", "jx-user-store-"));

function storeFile(name = "store.json"): string {
  return join(DIR, name);
}

beforeEach(() => {
  for (const entry of readdirSync(DIR)) {
    rmSync(join(DIR, entry), { force: true, recursive: true });
  }
});

afterAll(() => {
  rmSync(DIR, { force: true, recursive: true });
});

describe("readStringStore", () => {
  test("returns {} for a missing file", async () => {
    expect(await readStringStore(storeFile())).toEqual({});
  });

  test("returns {} for torn or non-object JSON", async () => {
    writeFileSync(storeFile(), '{"a": "1', "utf8");
    expect(await readStringStore(storeFile())).toEqual({});
    writeFileSync(storeFile(), '["nope"]', "utf8");
    expect(await readStringStore(storeFile())).toEqual({});
    writeFileSync(storeFile(), "null", "utf8");
    expect(await readStringStore(storeFile())).toEqual({});
  });

  test("drops non-string values rather than coercing them", async () => {
    writeFileSync(storeFile(), JSON.stringify({ n: 3, nested: { a: 1 }, ok: "yes" }), "utf8");
    expect(await readStringStore(storeFile())).toEqual({ ok: "yes" });
  });
});

describe("readJsonStore", () => {
  test("returns the parsed value when accept admits it", async () => {
    writeFileSync(storeFile(), JSON.stringify([1, 2]), "utf8");
    const accept = (v: unknown): v is number[] => Array.isArray(v);
    expect(await readJsonStore<number[]>(storeFile(), [], accept)).toEqual([1, 2]);
  });

  test("falls back when the file is missing or accept refuses", async () => {
    const accept = (v: unknown): v is number[] => Array.isArray(v);
    expect(await readJsonStore(storeFile(), [7], accept)).toEqual([7]);
    writeFileSync(storeFile(), JSON.stringify({ not: "an array" }), "utf8");
    expect(await readJsonStore(storeFile(), [7], accept)).toEqual([7]);
  });
});

describe("atomicity and permissions", () => {
  test("writeStore round-trips and leaves no temp file behind", async () => {
    await writeStore(storeFile(), { a: "1" });
    const written = readFileSync(storeFile(), "utf8");
    expect(JSON.parse(written)).toEqual({ a: "1" });
    expect(readdirSync(DIR).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  test("creates missing parent directories", async () => {
    const nested = join(DIR, "a", "b", "store.json");
    await writeStore(nested, { deep: "yes" });
    const written = readFileSync(nested, "utf8");
    expect(JSON.parse(written)).toEqual({ deep: "yes" });
  });

  /**
   * `writeFile`'s `mode` applies only when it CREATES the file, so a store that arrived
   * world-readable stayed that way through every later write. Renaming a fresh inode into place is
   * what makes the 0600 promise hold for a file that already exists.
   */
  test("repairs the mode of an existing world-readable store", async () => {
    if (process.platform === "win32") {
      return;
    }
    writeFileSync(storeFile(), "{}", { mode: 0o644 });
    chmodSync(storeFile(), 0o644);
    await writeStore(storeFile(), { a: "1" });
    // oxlint-disable-next-line no-bitwise -- masking the permission bits out of st_mode
    expect(statSync(storeFile()).mode & 0o777).toBe(0o600);
  });
});

describe("the per-path lock", () => {
  /**
   * The defect: a read-modify-write that released between the halves. Two of these each read the
   * same empty base, and the second overwrote the first's key.
   */
  test("concurrent updates to one file compose instead of overwriting", async () => {
    await Promise.all(
      ["a", "b", "c"].map((key) =>
        updateStore(storeFile(), readStringStore, (current) => ({ ...current, [key]: key })),
      ),
    );
    expect(await readStringStore(storeFile())).toEqual({ a: "a", b: "b", c: "c" });
  });

  test("updateStore answers with the store as it then stands", async () => {
    await updateStore(storeFile(), readStringStore, () => ({ a: "1" }));
    const result = await updateStore(storeFile(), readStringStore, (c) => ({ ...c, b: "2" }));
    expect(result).toEqual({ a: "1", b: "2" });
  });

  /** A rejected update must not strand every write queued behind it. */
  test("a failed update does not poison the chain", async () => {
    await updateStore(storeFile(), readStringStore, () => ({ a: "1" }));
    let failure: Error | undefined;
    try {
      await updateStore(storeFile(), readStringStore, () => {
        throw new Error("mutate failed");
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        failure = error;
      }
    }
    expect(failure?.message).toBe("mutate failed");
    await updateStore(storeFile(), readStringStore, (c) => ({ ...c, b: "2" }));
    expect(await readStringStore(storeFile())).toEqual({ a: "1", b: "2" });
  });

  /** The lock is per PATH — two different stores must not serialize behind each other. */
  test("different files do not block each other", async () => {
    await Promise.all([
      updateStore(storeFile("one.json"), readStringStore, () => ({ which: "one" })),
      updateStore(storeFile("two.json"), readStringStore, () => ({ which: "two" })),
    ]);
    expect(await readStringStore(storeFile("one.json"))).toEqual({ which: "one" });
    expect(await readStringStore(storeFile("two.json"))).toEqual({ which: "two" });
  });
});

function deadPid(): number {
  return Bun.spawnSync(["true"]).pid;
}

function age(path: string, seconds: number): void {
  const when = new Date(Date.now() - seconds * 1000);
  utimesSync(path, when, when);
}

async function timeoutOf(attempt: Promise<unknown>): Promise<StoreLockTimeoutError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof StoreLockTimeoutError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a StoreLockTimeoutError");
}

const FAST = { staleMs: 60_000, waitMs: 80 };

describe("the cross-process lock", () => {
  test("holds a lockfile beside the store for the length of the work", async () => {
    const store = storeFile();
    let seen = "";
    await withFileLock(store, async () => {
      seen = readFileSync(`${store}.lock`, "utf8");
    });
    expect(seen.startsWith(`${process.pid} `)).toBe(true);
    expect(readdirSync(DIR).filter((n) => n.endsWith(".lock") || n.endsWith(".stale"))).toEqual([]);
  });

  test("waits while another live process holds the lock", async () => {
    const store = storeFile();
    writeFileSync(`${store}.lock`, `${process.pid} someone-else`);
    const pending = updateStore(store, readStringStore, (c) => ({ ...c, a: "1" }));
    await Bun.sleep(60);
    expect(readdirSync(DIR)).not.toContain("store.json");
    rmSync(`${store}.lock`);
    expect(await pending).toEqual({ a: "1" });
  });

  test("breaks a lock whose holder has exited", async () => {
    const store = storeFile();
    writeFileSync(`${store}.lock`, `${deadPid()} gone`);
    expect(await updateStore(store, readStringStore, (c) => ({ ...c, a: "1" }))).toEqual({
      a: "1",
    });
    expect(readdirSync(DIR)).not.toContain("store.json.lock");
  });

  test("breaks a lock older than the stale bound although its pid is alive", async () => {
    const store = storeFile();
    writeFileSync(`${store}.lock`, `${process.pid} old`);
    age(`${store}.lock`, 60);
    expect(await updateStore(store, readStringStore, (c) => ({ ...c, a: "1" }))).toEqual({
      a: "1",
    });
  });

  test("an empty lock counts as held until it is stale", async () => {
    const store = storeFile();
    writeFileSync(`${store}.lock`, "");
    let ran = false;
    const work = async () => {
      ran = true;
      return 1;
    };
    const error = await timeoutOf(withFileLock(store, work, FAST));
    expect(error.holder).toBeNull();
    expect(ran).toBe(false);
    age(`${store}.lock`, 120);
    expect(await withFileLock(store, work, FAST)).toBe(1);
  });

  test("gives up rather than writing without the lock", async () => {
    const store = storeFile();
    writeFileSync(`${store}.lock`, `${process.pid} someone-else`);
    let ran = false;
    const error = await timeoutOf(
      withFileLock(
        store,
        async () => {
          ran = true;
        },
        FAST,
      ),
    );
    expect(error.holder).toBe(process.pid);
    expect(ran).toBe(false);
    expect(readFileSync(`${store}.lock`, "utf8")).toBe(`${process.pid} someone-else`);
  });

  test("a lock path it cannot read times out", async () => {
    const store = storeFile();
    mkdirSync(`${store}.lock`);
    const error = await timeoutOf(withFileLock(store, async () => 1, FAST));
    expect(error.holder).toBeNull();
  });

  test("release leaves a lock it no longer holds", async () => {
    const store = storeFile();
    await withFileLock(store, async () => {
      writeFileSync(`${store}.lock`, `${process.pid} successor`);
    });
    expect(readFileSync(`${store}.lock`, "utf8")).toBe(`${process.pid} successor`);
  });

  test("release tolerates a lock that is already gone", async () => {
    const store = storeFile();
    const value = await withFileLock(store, async () => {
      rmSync(`${store}.lock`);
      return 7;
    });
    expect(value).toBe(7);
    expect(readdirSync(DIR).filter((n) => n.endsWith(".lock") || n.endsWith(".stale"))).toEqual([]);
  });

  test("a lockfile error other than contention rejects at once", async () => {
    const store = join(DIR, `${"x".repeat(251)}`);
    let code = "";
    try {
      await updateStore(store, readStringStore, (c) => c);
    } catch (error) {
      code = error instanceof Error && "code" in error ? String(error.code) : "";
    }
    expect(code).toBe("ENAMETOOLONG");
  });
});

describe("across processes", () => {
  test("two processes patching disjoint keys of one store keep every key", async () => {
    const store = storeFile();
    const barrier = join(DIR, "barrier");
    mkdirSync(barrier);
    const writer = join(import.meta.dir, "_store-writer.ts");
    const children = ["a", "b"].map((prefix) =>
      Bun.spawn([process.execPath, writer, store, prefix, "40", barrier], {
        stderr: "inherit",
        stdout: "inherit",
      }),
    );
    while (readdirSync(barrier).length < 2) {
      await Bun.sleep(5);
    }
    writeFileSync(join(barrier, "go"), "");
    expect(await Promise.all(children.map((child) => child.exited))).toEqual([0, 0]);
    expect(Object.keys(await readStringStore(store))).toHaveLength(80);
  }, 30_000);
});
