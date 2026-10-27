/**
 * The backend's entry: hands the real message channel to `startBackend`.
 *
 * The Electron main process starts it as a utility process (`electron-shell/backend-process.ts`),
 * on the Node inside Electron, and talks to it over `process.parentPort`. A plain Node child
 * started with an IPC channel (`child_process.fork`, which is how `scripts/smoke-backend.ts` starts
 * the staged bundle) has `process.send` instead, and the same messages travel over it. Standing
 * alone it has no parent to speak to, so it says so and ends.
 *
 * @docs studio/desktop
 */
import { startBackend } from "./backend";
import { isShellMessage } from "./protocol";
import type { BackendMessage, ShellMessage } from "./protocol";

/** The two channels a parent can open, reduced to what the backend uses. */
interface Channel {
  /** Deliver each frame that is a shell message; anything else is dropped at the channel. */
  onMessage: (listener: (message: ShellMessage) => void) => void;
  send: (message: BackendMessage) => void;
  /** Run `listener` when the parent goes away, where the channel can tell. */
  onClose: (listener: () => void) => void;
}

/**
 * The channel this process was started with: the utility process's port when Electron started it,
 * and Node's IPC channel otherwise. The IPC channel reads `process.send` at each send rather than
 * once, so it is the same code whether the channel is there at load or arrives later.
 */
function channel(): Channel {
  const { parentPort: port } = process;
  if (port) {
    return {
      // Electron ends a utility process with its parent, so there is no close to listen for.
      onClose: () => {},
      onMessage: (listener) => {
        port.on("message", (event) => {
          // The peer is a process this app started, but the guard is still the boundary.
          if (isShellMessage(event.data)) {
            listener(event.data);
          }
        });
      },
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process channel
      send: (message) => port.postMessage(message),
    };
  }
  return {
    onClose: (listener) => {
      process.on("disconnect", listener);
    },
    onMessage: (listener) => {
      process.on("message", (frame) => {
        if (isShellMessage(frame)) {
          listener(frame);
        }
      });
    },
    send: (message) => {
      process.send?.(message);
    },
  };
}

if (!process.parentPort && !process.send) {
  console.error("[backend] No IPC channel: this process is started by the Electron shell.");
  // oxlint-disable-next-line unicorn/no-process-exit -- a backend without a parent has no work
  process.exit(1);
}

const parent = channel();
const hub = startBackend({
  env: process.env,
  onMessage: (listener) => parent.onMessage(listener),
  send: (message) => parent.send(message),
});

// The shell going away closes the channel, and a backend with no windows to serve has nothing to do.
parent.onClose(() => {
  hub.dispose();
  // oxlint-disable-next-line unicorn/no-process-exit -- the parent is gone; exit is the interface
  process.exit(0);
});
