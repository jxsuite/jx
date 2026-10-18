/**
 * What the Electron shell's preload hands the page, and the channels it reaches the main process
 * by.
 *
 * Shared by both sides of the shell — `shell.ts` registers a handler per channel, `preload.ts`
 * exposes {@link shellBridge} — so a channel name exists in exactly one place. Kept free of any
 * value import: the preload runs sandboxed, where `require` answers only `electron` itself.
 *
 * @docs studio/desktop
 */
import type { ContextBridge, IpcRenderer } from "electron";

/** IPC channel per window action. */
export const SHELL_CHANNELS = {
  close: "jx-shell:close",
  focus: "jx-shell:focus",
  maximize: "jx-shell:maximize",
  minimize: "jx-shell:minimize",
} as const;

/** The global the preload publishes the bridge on. */
export const SHELL_GLOBAL = "__jxShell";

/**
 * The window actions Studio's command bar calls.
 *
 * The shape of the launcher-only `windowControls` extra of the desktop adapter (specs/desktop.md
 * §3.1). There is no `getFrame`/`setFrame`: a frameless Electron window is resized by the window
 * system from its own edges, so Studio's page-drawn resize edges (which key on `getFrame`) stay
 * off.
 */
export interface ShellWindowControls {
  close: () => Promise<void>;
  maximize: () => Promise<void>;
  minimize: () => Promise<void>;
}

/** Everything the page can reach in the shell. */
export interface ShellBridge {
  /** Raise this window: the target of the launcher's `focusWindow` push. */
  focus: () => Promise<void>;
  windowControls: ShellWindowControls;
}

declare global {
  /** Published by the Electron shell's preload; absent in every other host. */
  var __jxShell: ShellBridge | undefined;
}

/**
 * Build the bridge over the renderer's IPC.
 *
 * @param ipc The preload's `ipcRenderer`.
 */
export function shellBridge(ipc: IpcRenderer): ShellBridge {
  return {
    focus: () => ipc.invoke(SHELL_CHANNELS.focus),
    windowControls: {
      close: () => ipc.invoke(SHELL_CHANNELS.close),
      maximize: () => ipc.invoke(SHELL_CHANNELS.maximize),
      minimize: () => ipc.invoke(SHELL_CHANNELS.minimize),
    },
  };
}

/**
 * Publish the bridge into the page's world (the preload's whole job).
 *
 * @param bridge The preload's `contextBridge`.
 * @param ipc The preload's `ipcRenderer`.
 */
export function exposeShell(bridge: ContextBridge, ipc: IpcRenderer): void {
  bridge.exposeInMainWorld(SHELL_GLOBAL, shellBridge(ipc));
}
