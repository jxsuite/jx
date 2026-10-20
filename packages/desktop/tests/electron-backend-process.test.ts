import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnBackend } from "../src/electron-shell/backend-process";

const scratch = mkdtempSync(join(tmpdir(), "jx-backend-process-test-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

/*
 * The real adapter against a real Bun child, because the one thing it exists to get right is a
 * channel whose framing both ends agree on, and a fake cannot disagree with it. The child echoes
 * what it is sent and exits when told to.
 */
const script = join(scratch, "echo.ts");
writeFileSync(
  script,
  `process.on("message", (m) => {
     process.send?.({ id: 5, type: "focus-window", echo: m });
     if (m.type === "dialog-result") process.exit(3);
   });
   process.send?.({ type: "mystery" });
   process.send?.({ id: "not-a-number", partition: "p", title: "t", type: "open-window", url: "u" });
   process.send?.({ type: "ready" });`,
);

/** Wait until `done()` holds, polling: a child's messages arrive when they arrive. */
async function until(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !done(); attempt += 1) {
    await Bun.sleep(50);
  }
  expect(done()).toBe(true);
}

describe("spawnBackend", () => {
  test("carries JSON messages both ways, and reports the child's exit", async () => {
    const backend = spawnBackend(process.execPath, script, { ...process.env });
    const received: unknown[] = [];
    const exited = new Promise<void>((resolve) => {
      backend.onExit(resolve);
    });
    backend.onMessage((message) => received.push(message));

    await until(() => received.length > 0);
    /* The child sent two frames that are not the backend's messages before this one, and neither
       reached the listener. */
    expect(received).toEqual([{ type: "ready" }]);

    backend.send({ root: "/p", type: "open-project" });
    await until(() => received.length >= 2);
    expect(received[1]).toEqual({
      echo: { root: "/p", type: "open-project" },
      id: 5,
      type: "focus-window",
    });

    backend.send({ path: null, requestId: 1, type: "dialog-result" });
    await exited;
    // A send to a child that is gone is dropped, not thrown.
    expect(() => backend.send({ root: null, type: "open-project" })).not.toThrow();
  });

  test("kill ends the child", async () => {
    const backend = spawnBackend(process.execPath, script, { ...process.env });
    const exited = new Promise<void>((resolve) => {
      backend.onExit(resolve);
    });
    await Bun.sleep(200);
    backend.kill();
    await exited;
  });

  test("a child that cannot start counts as exited", async () => {
    const backend = spawnBackend(join(scratch, "no-such-runtime"), script, { ...process.env });
    await new Promise<void>((resolve) => {
      backend.onExit(resolve);
    });
  });
});
