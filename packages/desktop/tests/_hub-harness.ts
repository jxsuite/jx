/**
 * A real hub over real servers, with only the IPC channel and the settings watch faked: the shared
 * fixture for the hub's tests, which drive each window's RPC over its actual WebSocket.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppInfo } from "@jxsuite/protocol";
import type { ImportApiOptions } from "@jxsuite/server/import-api";
import type { JsonValue } from "@jxsuite/schema/types";
import { createWindowHub } from "../src/backend/window-hub";
import type { WindowHub, WindowHubOptions } from "../src/backend/window-hub";
import type { OpenOutcome } from "../src/backend/handlers";
import type { BackendMessage } from "../src/shared/protocol";

/** A message the hub sent, narrowed by its `type`. */
export type Sent<T extends BackendMessage["type"]> = Extract<BackendMessage, { type: T }>;

/** A frame the server sent first, rather than in answer to a request. */
export interface Push {
  method: string;
  params: JsonValue;
}

/** One frame off a window's socket: an answer (`id`, then `result` or `error`) or a push. */
interface Frame {
  error?: string;
  id?: number;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
}

/** One connected window RPC socket. */
export interface WindowSocket {
  call: (method: string, params?: JsonValue) => Promise<JsonValue>;
  close: () => void;
  /**
   * Resolve with the first server-pushed frame whose `method` is `method` and whose params satisfy
   * `match` (any, by default): a watcher may report an earlier write before the one under test.
   */
  push: (
    method: string,
    match?: (params: JsonValue) => boolean,
    timeoutMs?: number,
  ) => Promise<Push>;
}

export interface Fixture {
  appInfo: AppInfo;
  /** Every window's socket is closed at teardown. */
  connect: (window: Sent<"open-window">) => Promise<WindowSocket>;
  hub: WindowHub;
  /** `hub.openProject`, then wait for the window it opens to be announced (`hub.idle`). */
  open: (root: string | null) => Promise<OpenOutcome>;
  /** Make a project directory under the fixture's scratch directory. */
  makeProject: (name: string) => string;
  /** The `open-window` messages sent so far. */
  opened: () => Sent<"open-window">[];
  sent: BackendMessage[];
  /** The listeners `watchSettings` was given, and how many times it was stopped. */
  settings: { listeners: ((settings: Record<string, string>) => void)[]; stops: number };
  teardown: () => void;
}

/** Build the fixture; `importApi` turns on the site-import route, as a found browser does. */
export function hubFixture(importApi?: ImportApiOptions): Fixture {
  const scratch = mkdtempSync(join(tmpdir(), "jx-hub-test-"));
  const studioDir = join(scratch, "studio");
  mkdirSync(studioDir);
  const sent: BackendMessage[] = [];
  const settings: Fixture["settings"] = { listeners: [], stops: 0 };
  const appInfo: AppInfo = { channel: "test", hash: "abc", version: "1.2.3" };
  const sockets: WebSocket[] = [];
  const options: WindowHubOptions = {
    appInfo: () => appInfo,
    send: (message) => sent.push(message),
    studioDir,
    watchSettings: (listener) => {
      settings.listeners.push(listener);
      return () => {
        settings.stops += 1;
      };
    },
  };
  if (importApi) {
    options.importApi = importApi;
  }
  const hub = createWindowHub(options);

  return {
    appInfo,
    open: async (root) => {
      const outcome = hub.openProject(root);
      await hub.idle();
      return outcome;
    },
    connect: (window) =>
      new Promise((resolve, reject) => {
        const url = new URL(window.url);
        const token = url.searchParams.get("token") ?? "";
        const socket = new WebSocket(`ws://${url.host}/?token=${token}`);
        sockets.push(socket);
        const waiters = new Map<number, (answer: JsonValue) => void>();
        const pushes: Push[] = [];
        const listeners: ((push: Push) => void)[] = [];
        let nextId = 1;
        socket.addEventListener("message", (event) => {
          // SAFETY: the test's own server answers with JSON frames of this shape.
          const frame = JSON.parse(String(event.data)) as Frame;
          if (frame.id !== undefined) {
            waiters.get(frame.id)?.(
              frame.error === undefined ? (frame.result ?? null) : { error: frame.error },
            );
          } else if (frame.method) {
            const push: Push = { method: frame.method, params: frame.params ?? null };
            pushes.push(push);
            for (const listener of listeners) {
              listener(push);
            }
          }
        });
        socket.addEventListener("error", () => reject(new Error("socket error")));
        socket.addEventListener("open", () => {
          resolve({
            call: (method, params) =>
              new Promise((answer) => {
                const id = nextId;
                nextId += 1;
                waiters.set(id, answer);
                socket.send(JSON.stringify({ id, method, params }));
              }),
            close: () => socket.close(),
            push: (method, match = () => true, timeoutMs = 10_000) =>
              new Promise((answer, fail) => {
                const wanted = (push: Push): boolean =>
                  push.method === method && match(push.params);
                const seen = pushes.find((push) => wanted(push));
                if (seen) {
                  answer(seen);
                  return;
                }
                const timer = setTimeout(() => fail(new Error(`no ${method} push`)), timeoutMs);
                listeners.push((push) => {
                  if (wanted(push)) {
                    clearTimeout(timer);
                    answer(push);
                  }
                });
              }),
          });
        });
      }),
    hub,
    makeProject: (name) => {
      const root = join(scratch, name);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "project.json"), JSON.stringify({ name }));
      return root;
    },
    opened: () =>
      sent.filter((message): message is Sent<"open-window"> => message.type === "open-window"),
    sent,
    settings,
    teardown: () => {
      for (const socket of sockets) {
        socket.close();
      }
      hub.dispose();
      rmSync(scratch, { force: true, recursive: true });
    },
  };
}
