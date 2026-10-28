/**
 * The Electron shell's preload: publishes the window bridge and nothing else.
 *
 * Project I/O never crosses here. It stays on the launcher's token-authenticated WebSocket RPC,
 * exactly as under Chromium `--app`; the preload only adds what a page cannot do for itself, which
 * is minimizing, maximizing, closing and raising its own frameless window.
 *
 * @docs studio/desktop
 */
import { contextBridge, ipcRenderer } from "electron";
import { exposeShell } from "../shared/bridge";

exposeShell(contextBridge, ipcRenderer);
