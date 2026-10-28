/**
 * `main.ts` as Electron starts it: a utility process, whose channel is `process.parentPort`.
 *
 * A file of its own because the entry runs at import, and `hub-backend.test.ts` evaluates it with
 * Node's IPC channel instead; under `--isolate` each file is its own process, so each evaluation is
 * the first.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendMessage } from "../src/shared/protocol";

/** A frame as the port delivers it. */
type Frame = { readonly type?: string } | null;

test("talks to the shell over the utility process's port, and drops frames that are not messages", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "jx-backend-port-"));
  const root = join(scratch, "site");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "project.json"), '{"name":"site"}');
  const posted: BackendMessage[] = [];
  const listeners: ((event: { data: Frame }) => void)[] = [];
  process.parentPort = {
    on: (_event, listener) => {
      listeners.push(listener);
    },
    postMessage: (message) => {
      // SAFETY: the entry posts only `BackendMessage`s; the port's declared type is their common shape.
      posted.push(message as BackendMessage);
    },
  };
  const deliver = (data: Frame): void => {
    for (const listener of listeners) {
      listener({ data });
    }
  };
  try {
    await import("../src/backend/main.ts");
    expect(posted).toEqual([{ type: "ready" }]);
    deliver({ type: "mystery" });
    deliver(null);
    expect(posted).toHaveLength(1);
    // SAFETY: an `open-project` message, the shape the shell sends; the port types frames loosely.
    deliver({ root, type: "open-project" } as Frame);
    for (let tries = 0; !posted.some((message) => message.type === "open-window"); tries += 1) {
      expect(tries).toBeLessThan(200);
      await Bun.sleep(5);
    }
    expect(posted.at(-1)).toMatchObject({ title: "site — Jx Studio", type: "open-window" });
  } finally {
    delete process.parentPort;
    rmSync(scratch, { force: true, recursive: true });
  }
});
