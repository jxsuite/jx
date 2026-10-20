/**
 * The Bun backend as the Electron main process sees it: a child with a JSON message channel.
 *
 * Wrapped so the app talks to four verbs rather than to `ChildProcess`, which is what lets its
 * tests substitute an array for a process, and so the one place `serialization: "json"` has to be
 * said is this one: Bun is not Node, and the two only agree on the channel's framing in JSON mode.
 *
 * @docs studio/desktop
 */
import { spawn } from "node:child_process";
import { isBackendMessage } from "../hub/protocol";
import type { BackendMessage, ShellMessage } from "../hub/protocol";

/** What the app needs of the backend. */
export interface BackendProcess {
  /** End the backend. */
  kill: () => void;
  /** Run `listener` when the backend exits or cannot start. */
  onExit: (listener: () => void) => void;
  /** Run `listener` for each message the backend sends; a frame that is not one is dropped here. */
  onMessage: (listener: (message: BackendMessage) => void) => void;
  /** Send the backend a message. */
  send: (message: ShellMessage) => void;
}

/** How a backend is started; a parameter of the app so a test never starts a process. */
export type SpawnBackend = (bin: string, script: string, env: NodeJS.ProcessEnv) => BackendProcess;

/**
 * Start `script` under `bin` (Bun) with a JSON IPC channel to this process.
 *
 * Standard output and error are inherited, so the backend's log lines land where the app's do.
 *
 * @param bin The runtime to run the backend under.
 * @param script The backend entry (`hub/main.ts`, or its bundle).
 * @param env The backend's environment.
 */
export const spawnBackend: SpawnBackend = (bin, script, env) => {
  const child = spawn(bin, [script], {
    env,
    serialization: "json",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  return {
    kill: () => {
      child.kill();
    },
    onExit: (listener) => {
      child.on("exit", listener);
      child.on("error", listener);
    },
    onMessage: (listener) => {
      // The channel's peer is a process this app started, but the guard is still the boundary.
      child.on("message", (frame) => {
        if (isBackendMessage(frame)) {
          listener(frame);
        }
      });
    },
    send: (message) => {
      if (child.connected) {
        child.send(message);
      }
    },
  };
};
