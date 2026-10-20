// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOptions, startBackend } from "../src/hub/backend";
import type { BackendIo } from "../src/hub/backend";
import type { BackendMessage, ShellMessage } from "../src/hub/protocol";
import type { WindowHub } from "../src/hub/window-hub";

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
    };
    const deliver = (message: ShellMessage): void => {
      for (const listener of listeners) {
        listener(message);
      }
    };
    return { deliver, io, sent };
  }

  test("announces itself, then opens what the shell asks for", () => {
    const { deliver, io, sent } = channel();
    hub = startBackend(io);
    expect(sent).toEqual([{ type: "ready" }]);
    deliver({ root, type: "open-project" });
    expect(sent[1]).toMatchObject({ id: 1, title: "site — Jx Studio", type: "open-window" });
    expect(hub.windows()).toEqual([{ id: 1, projectRoot: root }]);
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

/** `main.ts` under a query string: Bun evaluates each as a module of its own, as a test needs. */
function entry(tag: string): string {
  return `../src/hub/main.ts?${tag}`;
}

/** Stop `process.exit` ending the test process; the entry under test carries on past it. */
function mockExit() {
  // SAFETY: `exit` never returns in real use. The stand-in does, which is the point of it.
  return spyOn(process, "exit").mockImplementation(() => undefined as never);
}

describe("main.ts", () => {
  const sent: BackendMessage[] = [];

  test("with no IPC channel it says so and ends", async () => {
    const exit = mockExit();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const original = process.send;
    process.send = undefined;
    try {
      await import(entry("no-channel"));
      expect(error.mock.calls[0]?.[0]).toContain("No IPC channel");
      expect(exit).toHaveBeenCalledWith(1);
      // The entry carried on past the (mocked) exit; ending the channel stops what it started.
      process.emit("disconnect");
    } finally {
      process.send = original;
      exit.mockRestore();
      error.mockRestore();
    }
  });

  test("with a channel it starts the backend, and the channel closing ends it", async () => {
    const exit = mockExit();
    const original = process.send;
    // SAFETY: the entry calls `process.send(message)` and reads nothing back but truthiness.
    process.send = ((message: BackendMessage) => {
      sent.push(message);
      return true;
    }) as typeof process.send;
    try {
      await import(entry("channel"));
      expect(sent).toContainEqual({ type: "ready" });
      process.emit("message", { root, type: "open-project" }, null);
      expect(sent.at(-1)).toMatchObject({ title: "site — Jx Studio", type: "open-window" });
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
      rmSync(scratch, { force: true, recursive: true });
    }
  });
});
