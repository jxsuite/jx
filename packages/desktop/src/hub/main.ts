/**
 * The backend's entry: hands the real IPC channel to `startBackend`.
 *
 * Run by the Electron main process (`electron-shell/app.ts`) with the channel Electron opened,
 * under Bun. Standing alone it has no parent to speak to, so it says so and ends.
 *
 * @docs studio/desktop
 */
import { startBackend } from "./backend";
import { isShellMessage } from "./protocol";
import type { BackendMessage } from "./protocol";

if (!process.send) {
  console.error("[backend] No IPC channel: this process is started by the Electron shell.");
  // oxlint-disable-next-line unicorn/no-process-exit -- a backend without a parent has no work
  process.exit(1);
}

const hub = startBackend({
  env: process.env,
  onMessage: (listener) => {
    process.on("message", (frame) => {
      // The peer is a process this app started, but the guard is still the boundary.
      if (isShellMessage(frame)) {
        listener(frame);
      }
    });
  },
  send: (message: BackendMessage) => {
    process.send?.(message);
  },
});

// The shell going away closes the channel, and a backend with no windows to serve has nothing to do.
process.on("disconnect", () => {
  hub.dispose();
  // oxlint-disable-next-line unicorn/no-process-exit -- the parent is gone; exit is the interface
  process.exit(0);
});
