/**
 * main.js — Jx Studio desktop entry point (Electrobun Bun process)
 *
 * 1. Determines the initial project root (CLI arg, env var, or CWD)
 * 2. Starts the embedded HTTP server for studio assets + /__studio/* API
 * 3. Registers RPC handlers so the webview can call PAL methods directly
 * 4. Opens a BrowserWindow with the Studio UI
 *
 * See spec/desktop.md §7 for the architecture overview.
 */

import { BrowserView, BrowserWindow, PATHS } from "electrobun/bun";
import {
  setProjectRoot,
  openProject,
  listDirectory,
  handleReadFile,
  handleWriteFile,
  handleDeleteFile,
  handleRenameFile,
  handleCreateDirectory,
  discoverComponents,
  codeService,
  locateFile,
  fetchPluginSchema,
} from "./handlers.js";
import { startStudioServer } from "./server.js";

// ─── Determine project root ───────────────────────────────────────────────────

const projectRoot =
  process.argv[2] ||
  process.env.JSONSX_PROJECT_ROOT ||
  process.cwd();

setProjectRoot(projectRoot);

// ─── Start embedded HTTP server ───────────────────────────────────────────────
// The server handles:
//   /studio/*           → bundled Studio assets (HTML, JS, CSS)
//   /__jx_resolve__  → $prototype/$src module proxy
//   /__jx_server__   → timing:"server" function proxy
//   /__studio/*          → fallback file API (used by devserver adapter)

const server = /** @type {{ port: number }} */ (
  await startStudioServer(PATHS.VIEWS_FOLDER, projectRoot)
);

// ─── Register RPC handlers ────────────────────────────────────────────────────
// The webview's DesktopPlatform adapter calls these via ElectroBun's RPC bridge.
// Each handler maps 1:1 to a StudioPlatform interface method (spec §3.1).

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      openProject: () => openProject(),
      listDirectory: (/** @type {any} */ params) => listDirectory(params),
      readFile: (/** @type {any} */ params) => handleReadFile(params),
      writeFile: (/** @type {any} */ params) => handleWriteFile(params),
      deleteFile: (/** @type {any} */ params) => handleDeleteFile(params),
      renameFile: (/** @type {any} */ params) => handleRenameFile(params),
      createDirectory: (/** @type {any} */ params) => handleCreateDirectory(params),
      discoverComponents: (/** @type {any} */ params) => discoverComponents(params),
      codeService: (/** @type {any} */ params) => codeService(params),
      locateFile: (/** @type {any} */ params) => locateFile(params),
      fetchPluginSchema: (/** @type {any} */ params) => fetchPluginSchema(params),
    },
    messages: {},
  },
});

// ─── Open the main window ─────────────────────────────────────────────────────

new BrowserWindow({
  title: "Jx Studio",
  url: `http://localhost:${server.port}/studio/index.html`,
  frame: { x: 0, y: 0, width: 1400, height: 900 },
  rpc,
});
