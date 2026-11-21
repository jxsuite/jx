/**
 * Project-session-watch.test.ts — which roots the session agrees to watch.
 *
 * A root with no project.json is not a project: `probeRootProject` says so and the window shows the
 * welcome screen. Watching one recursively is a scan of somebody's directory tree for a project
 * that is never opened — `jx-studio ~` is how that was found. `createFsWatcher` is mocked so the
 * decision itself is what is under test, rather than a real inotify race.
 */

import { authorized } from "./_authorized";
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const watched: string[] = [];
const closed = mock(() => Promise.resolve());
const applyRename = mock(() => Promise.resolve({ edits: [] }));
/** The last watcher's `ready` resolver and `onError`, so a test can finish its scan or fail it. */
let finishScan: () => void = () => {};
let lastOnError: ((error: Error) => void) | undefined;
let lastSink: ((events: unknown[]) => void) | undefined;

void mock.module("@jxsuite/server/refactor", () => ({
  applyRename,
  createFsWatcher: (
    root: string,
    sink: (events: unknown[]) => void,
    opts: { onError?: (error: Error) => void } = {},
  ) => {
    watched.push(root);
    lastOnError = opts.onError;
    lastSink = sink;
    const ready = new Promise<void>((settle) => {
      finishScan = settle;
    });
    return { close: closed, ready };
  },
  findReferences: () => Promise.resolve({ files: [] }),
}));

const { createProjectSession } = await import("../src/backend/project-session");

const FIXTURES = resolve(import.meta.dir, "_fixtures_session_watch");
const PROJECT = resolve(FIXTURES, "a-project");
const BARE = resolve(FIXTURES, "just-a-directory");

rmSync(FIXTURES, { force: true, recursive: true });
mkdirSync(PROJECT, { recursive: true });
mkdirSync(BARE, { recursive: true });
writeFileSync(resolve(PROJECT, "project.json"), '{"name":"a-project"}');

afterAll(() => {
  rmSync(FIXTURES, { force: true, recursive: true });
});

/** Run `fn` with console.log captured, returning the lines it wrote. */
function capturingLogs(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

beforeEach(() => {
  watched.length = 0;
  closed.mockClear();
});

describe("the session watches a project", () => {
  test("registering the sink starts the watcher on a root holding a project.json", () => {
    const session = createProjectSession(authorized(PROJECT));
    const logs = capturingLogs(() => session.setFileEventSink(() => {}));
    expect(watched).toEqual([PROJECT]);
    expect(logs.filter((line) => line.includes("not watching"))).toEqual([]);
    void session.dispose();
  });

  test("a sink is what starts it — a root alone watches nothing", () => {
    const session = createProjectSession(authorized(PROJECT));
    expect(watched).toEqual([]);
    void session.dispose();
  });
});

/**
 * The watcher announces nothing written before its scan finished, and a project being created or
 * opened is written exactly then. Its readiness is told to the hub, which tells the page to
 * re-list.
 */
describe("the session says when its watcher is live", () => {
  const flush = () => Bun.sleep(0);

  test("the watching hook runs once the scan is done, not before", async () => {
    const session = createProjectSession(authorized(PROJECT));
    const told: string[] = [];
    session.setFileEventSink(
      () => {},
      () => told.push("watching"),
    );
    await flush();
    expect(told).toEqual([]);
    finishScan();
    await flush();
    expect(told).toEqual(["watching"]);
    await session.dispose();
  });

  test("a re-root onto the folder already watched keeps the watcher and announces again", async () => {
    const session = createProjectSession(authorized(PROJECT));
    const watching = mock(() => {});
    session.setFileEventSink(() => {}, watching);
    finishScan();
    await flush();
    // What creating a project does: the session binds the folder, then Studio binds the window.
    session.setProjectRoot(authorized(PROJECT));
    await flush();
    expect(watched).toEqual([PROJECT]);
    expect(closed).not.toHaveBeenCalled();
    expect(watching).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  test("a watcher replaced before its scan finished announces nothing", async () => {
    const session = createProjectSession(authorized(PROJECT));
    const told: string[] = [];
    session.setFileEventSink(
      () => {},
      () => told.push("watching"),
    );
    const firstScan = finishScan;
    capturingLogs(() => session.setProjectRoot(authorized(BARE)));
    firstScan();
    await flush();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(told).toEqual([]);
    await session.dispose();
  });

  test("a sink registered after the watcher started is the one its batches reach", async () => {
    const session = createProjectSession(authorized(PROJECT));
    const first = mock((_events: unknown[]) => {});
    const second = mock((_events: unknown[]) => {});
    session.setFileEventSink(first);
    session.setFileEventSink(second);
    expect(watched).toEqual([PROJECT]);
    lastSink?.([{ isDir: false, path: "a.json", type: "add" }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await session.dispose();
  });

  test("a watch error is logged with the root, and is not fatal", async () => {
    const session = createProjectSession(authorized(PROJECT));
    session.setFileEventSink(() => {});
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      lastOnError?.(new Error("EMFILE: too many open files"));
      const [line] = errors.mock.calls.map((call) => String(call[0]));
      expect(line).toContain(PROJECT);
      expect(line).toContain("EMFILE");
    } finally {
      errors.mockRestore();
      await session.dispose();
    }
  });
});

describe("the session refuses a root that is not a project", () => {
  test("no project.json means no watcher, and a line saying why", () => {
    const session = createProjectSession(authorized(BARE));
    const logs = capturingLogs(() => session.setFileEventSink(() => {}));
    expect(watched).toEqual([]);
    expect(logs.some((line) => line.includes("not watching") && line.includes(BARE))).toBe(true);
    void session.dispose();
  });

  test("the refusal is logged once per root, not once per attempt to arm", () => {
    const session = createProjectSession(authorized(BARE));
    const logs = capturingLogs(() => {
      session.setFileEventSink(() => {});
      // Re-arming the same root — what a second sink registration or a no-op re-root does.
      session.setFileEventSink(() => {});
      session.setProjectRoot(authorized(BARE));
    });
    expect(logs.filter((line) => line.includes("not watching"))).toHaveLength(1);
    void session.dispose();
  });

  test("re-rooting onto a real project arms the watcher that the bare root did not", () => {
    const session = createProjectSession(authorized(BARE));
    capturingLogs(() => {
      session.setFileEventSink(() => {});
      expect(watched).toEqual([]);
      session.setProjectRoot(authorized(PROJECT));
    });
    expect(watched).toEqual([PROJECT]);
    void session.dispose();
  });

  test("leaving a project for a bare root closes the watcher it had", () => {
    const session = createProjectSession(authorized(PROJECT));
    capturingLogs(() => {
      session.setFileEventSink(() => {});
      expect(watched).toEqual([PROJECT]);
      session.setProjectRoot(authorized(BARE));
    });
    expect(closed).toHaveBeenCalled();
    void session.dispose();
  });
});

/**
 * `renameFile`'s own try/catch: the file move on disk happens FIRST and unconditionally, then a
 * project-wide reference rewrite runs over it. A failure in that second pass (a corrupt sibling
 * document, the format registry throwing, …) must not turn an already-successful move into an error
 * — it degrades to a bare report instead, which is the contract this suite exercises.
 */
describe("renameFile degrades to a bare report when the refactor pass fails", () => {
  test("the move already happened, so a failed reference rewrite still reports success", async () => {
    const session = createProjectSession(authorized(PROJECT));
    writeFileSync(resolve(PROJECT, "old.txt"), "content");
    applyRename.mockImplementationOnce(() => Promise.reject(new Error("refactor engine blew up")));
    try {
      const report = await session.handleRenameFile({ from: "old.txt", to: "new.txt" });
      // The move on disk already happened; only the reference-rewrite pass failed.
      expect(existsSync(resolve(PROJECT, "old.txt"))).toBe(false);
      expect(existsSync(resolve(PROJECT, "new.txt"))).toBe(true);
      expect(report).toEqual({
        errors: [],
        from: "old.txt",
        isDir: false,
        ok: true,
        references: { files: [], filesChanged: 0, refsUpdated: 0 },
        to: "new.txt",
      });
    } finally {
      rmSync(resolve(PROJECT, "new.txt"), { force: true });
      void session.dispose();
    }
  });
});
