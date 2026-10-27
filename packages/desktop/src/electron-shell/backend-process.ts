/**
 * The backend as the Electron main process sees it: a utility process with a message channel.
 *
 * The backend runs on the Node inside Electron, started with `utilityProcess.fork()`
 * (specs/desktop.md §9.7). Being an Electron helper rather than a foreign binary is what lets a Mac
 * App Store build sign it with the inherited sandbox entitlements and hand it the folder grants the
 * main process holds. Wrapped so the app talks to four verbs rather than to `UtilityProcess`, which
 * is what lets its tests substitute an array for a process.
 *
 * @docs studio/desktop
 */
import type { UtilityProcessFork } from "electron";
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
export type SpawnBackend = (script: string, env: NodeJS.ProcessEnv) => BackendProcess;

/**
 * Start `script` as a utility process with a message channel to this process.
 *
 * Standard output and error are inherited, so the backend's log lines land where the app's do.
 *
 * @param utilityProcess Electron's `utilityProcess` module.
 * @returns A {@link SpawnBackend} that forks through it.
 */
export function utilityBackend(utilityProcess: UtilityProcessFork): SpawnBackend {
  return (script, env) => {
    const child = utilityProcess.fork(script, [], {
      env,
      serviceName: "Jx Studio Backend",
      stdio: "inherit",
    });
    let alive = true;
    child.on("exit", () => {
      alive = false;
    });
    return {
      kill: () => {
        child.kill();
      },
      onExit: (listener) => {
        child.on("exit", listener);
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
        if (alive) {
          // A channel to a process, not a window: there is no origin to name.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          child.postMessage(message);
        }
      },
    };
  };
}
