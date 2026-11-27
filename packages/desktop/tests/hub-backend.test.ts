// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOptions, startBackend } from "../src/backend/backend";
import type { BackendIo } from "../src/backend/backend";
import { TRUST_EVERYTHING } from "./_hub-harness";
import type { BackendMessage, ShellMessage } from "../src/shared/protocol";
import type { WindowHub } from "../src/backend/window-hub";

const scratch = mkdtempSync(join(tmpdir(), "jx-backend-test-"));
const root = join(scratch, "site");
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "project.json"), '{"name":"site"}');

describe("importOptions", () => {
  test("a destination must be absolute: the webview resolves it before posting", () => {
    const options = importOptions(null);
    expect(options.resolveDest("/abs/dir")).toBe("/abs/dir");
    expect(() => options.resolveDest("relative/dir")).toThrow("absolute");
  });

  test("names the browser puppeteer drives when there is one, and none when there is not", () => {
    expect(importOptions("/usr/bin/chromium").chromePath).toBe("/usr/bin/chromium");
    expect("chromePath" in importOptions(null)).toBe(false);
  });
});

describe("startBackend", () => {
  let hub: WindowHub | undefined;
  afterEach(() => {
    hub?.dispose();
    hub = undefined;
  });

  /** A channel whose inbound side the test drives, and whose outbound side it reads. */
  function channel(env?: NodeJS.ProcessEnv) {
    const sent: BackendMessage[] = [];
    const listeners: ((message: ShellMessage) => void)[] = [];
    const io: BackendIo = {
      env: env ?? { JX_STUDIO_ASSETS: scratch },
      findBrowser: () => null,
      onMessage: (listener) => listeners.push(listener),
      send: (message) => sent.push(message),
      trust: TRUST_EVERYTHING,
    };
    const deliver = (message: ShellMessage): void => {
      for (const listener of listeners) {
        listener(message);
      }
    };
    return { deliver, io, sent };
  }

  test("announces itself, then opens what the shell asks for", async () => {
    const { deliver, io, sent } = channel();
    hub = startBackend(io);
    expect(sent).toEqual([{ type: "ready" }]);
    deliver({ root, type: "open-project" });
    await hub.idle();
    expect(sent[1]).toMatchObject({ id: 1, title: "site — Jx Studio", type: "open-window" });
    expect(hub.windows()).toEqual([{ id: 1, projectRoot: root }]);
  });

  /** Open a welcome window and call `methods` over its real socket, in order. */
  async function callOverSocket(
    deliver: (message: ShellMessage) => void,
    sent: BackendMessage[],
    methods: string[],
  ): Promise<void> {
    deliver({ root: null, type: "open-project" });
    await hub?.idle();
    const opened = sent.find((message) => message.type === "open-window");
    if (opened?.type !== "open-window") {
      throw new Error("no window was opened");
    }
    const url = new URL(opened.url);
    const socket = new WebSocket(`ws://${url.host}/?token=${url.searchParams.get("token") ?? ""}`);
    await new Promise((resolve) => {
      socket.addEventListener("open", resolve, { once: true });
    });
    let id = 0;
    for (const method of methods) {
      id += 1;
      const answered = new Promise((resolve) => {
        socket.addEventListener("message", resolve, { once: true });
      });
      socket.send(JSON.stringify({ id, method, params: {} }));
      await answered;
    }
    socket.close();
  }

  test("a boot probe from the environment records each window's requests and quits through the protocol", async () => {
    const report = join(scratch, "probe", "report.json");
    const { deliver, io, sent } = channel({
      JX_STUDIO_ASSETS: scratch,
      JX_STUDIO_BOOT_PROBE: report,
    });
    hub = startBackend(io);
    await callOverSocket(deliver, sent, ["githubToken"]);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({
      launcher: "electron",
      requests: ["githubToken"],
      settled: false,
    });
    expect(sent.some((message) => message.type === "quit")).toBe(false);
    await callOverSocket(deliver, sent, ["getSettings"]);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ settled: true });
    expect(sent.filter((message) => message.type === "quit")).toEqual([{ type: "quit" }]);
  });

  test("no probe when the environment has none", async () => {
    const { deliver, io, sent } = channel();
    hub = startBackend(io);
    await callOverSocket(deliver, sent, ["getSettings"]);
    expect(sent.some((message) => message.type === "quit")).toBe(false);
  });

  test("looks for a browser itself when none is injected, and starts either way", () => {
    const { io, sent } = channel({ CHROMIUM_BIN: "sh", JX_STUDIO_ASSETS: scratch });
    delete io.findBrowser;
    hub = startBackend(io);
    expect(sent).toEqual([{ type: "ready" }]);
  });

  test("serves studio assets from the checkout's staged directory when none is configured", () => {
    const { io, sent } = channel({});
    hub = startBackend(io);
    expect(sent).toEqual([{ type: "ready" }]);
  });
});

/** Stop `process.exit` ending the test process; the entry under test carries on past it. */
function mockExit() {
  // SAFETY: `exit` never returns in real use. The stand-in does, which is the point of it.
  return spyOn(process, "exit").mockImplementation(() => undefined as never);
}

/*
 * ONE evaluation of `main.ts` drives every line of it. Evaluating it twice under two query strings
 * gives Bun two modules, but Bun keeps one coverage
 * record per path, so the lines only the first evaluation ran (the no-channel branch) were
 * reported uncovered and failed this workspace's per-file gate. The entry reads `process.send` at
 * load and again at every send, so a channel that appears after a load without one reaches the
 * same code a channel present from the start does; `startBackend`'s own tests hold "ready".
 */
describe("main.ts", () => {
  test("with no IPC channel it says so and ends; a channel serves the shell, and closing it ends the backend", async () => {
    const sent: BackendMessage[] = [];
    const exit = mockExit();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const original = process.send;
    process.send = undefined;
    try {
      await import("../src/backend/main.ts");
      expect(error.mock.calls[0]?.[0]).toContain("No IPC channel");
      expect(exit).toHaveBeenCalledWith(1);
      // The entry carried on past the (mocked) exit. Give it a channel and it answers the shell.
      // SAFETY: the entry calls `process.send(message)` and reads nothing back but truthiness.
      process.send = ((message: BackendMessage) => {
        sent.push(message);
        return true;
      }) as NonNullable<typeof original>;
      process.emit("message", { root: null, type: "open-project" }, null);
      // The window is announced once its server has bound, which is a turn or two later.
      for (let tries = 0; !sent.some((message) => message.type === "open-window"); tries += 1) {
        expect(tries).toBeLessThan(200);
        await Bun.sleep(5);
      }
      expect(sent.find((message) => message.type === "open-window")).toMatchObject({
        title: "Jx Studio",
      });
      // A frame that is not one of the shell's messages is dropped at the channel.
      const before = sent.length;
      for (const frame of [null, "open-project", { type: "open-project" }, { type: "mystery" }]) {
        process.emit("message", frame, null);
      }
      expect(sent).toHaveLength(before);
      process.emit("disconnect");
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      process.send = original;
      exit.mockRestore();
      error.mockRestore();
      rmSync(scratch, { force: true, recursive: true });
    }
  });
});
