/**
 * main.ts — JSONsx Studio desktop entry point (Electrobun Bun process)
 *
 * 1. Determines the initial project root (CLI arg, env var, or CWD)
 * 2. Starts the embedded HTTP server for studio assets + /__studio/* API
 * 3. Registers RPC handlers so the webview can call PAL methods directly
 * 4. Opens a BrowserWindow with the Studio UI
 *
 * See spec/desktop.md §7 for the architecture overview.
 */

import { BrowserView, BrowserWindow } from "electrobun/bun";
import type { StudioRPCSchema } from "./rpc-schema.ts";
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
} from "./handlers.ts";
import { startStudioServer } from "./server.ts";
import PATHS from "electrobun/bun";

// ─── Determine project root ───────────────────────────────────────────────────

const projectRoot =
  process.argv[2] ||
  process.env.JSONSX_PROJECT_ROOT ||
  process.cwd();

setProjectRoot(projectRoot);

// ─── Start embedded HTTP server ───────────────────────────────────────────────
// The server handles:
//   /studio/*           → bundled Studio assets (HTML, JS, CSS)
//   /__jsonsx_resolve__  → $prototype/$src module proxy
//   /__jsonsx_server__   → timing:"server" function proxy
//   /__studio/*          → fallback file API (used by devserver adapter)

const server = await startStudioServer(PATHS.VIEWS_FOLDER, projectRoot);

// ─── Register RPC handlers ────────────────────────────────────────────────────
// The webview's DesktopPlatform adapter calls these via ElectroBun's RPC bridge.
// Each handler maps 1:1 to a StudioPlatform interface method (spec §3.1).

const rpc = BrowserView.defineRPC<StudioRPCSchema>({
  handlers: {
    requests: {
      openProject: async () => {
        const result = await openProject();
        return result;
      },
      listDirectory: async (params) => {
        return listDirectory(params);
      },
      readFile: async (params) => {
        return handleReadFile(params);
      },
      writeFile: async (params) => {
        return handleWriteFile(params);
      },
      deleteFile: async (params) => {
        return handleDeleteFile(params);
      },
      renameFile: async (params) => {
        return handleRenameFile(params);
      },
      createDirectory: async (params) => {
        return handleCreateDirectory(params);
      },
      discoverComponents: async (params) => {
        return discoverComponents(params);
      },
      codeService: async (params) => {
        return codeService(params);
      },
      locateFile: async (params) => {
        return locateFile(params);
      },
      fetchPluginSchema: async (params) => {
        return fetchPluginSchema(params);
      },
    },
    messages: {},
  },
});

// ─── Open the main window ─────────────────────────────────────────────────────

new BrowserWindow({
  title: "JSONsx Studio",
  url: `http://localhost:${server.port}/studio/index.html`,
  frame: { x: 0, y: 0, width: 1400, height: 900 },
  rpc,
});
