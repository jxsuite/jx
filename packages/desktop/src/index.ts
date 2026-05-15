import { BrowserView, BrowserWindow, PATHS } from "electrobun/bun";
import type { StudioRPC } from "./rpc-schema";
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
} from "./handlers";
import { startStudioServer } from "./server";

// ─── Determine project root ───────────────────────────────────────────────────

const projectRoot = process.argv[2] || process.env.JSONSX_PROJECT_ROOT || process.cwd();

setProjectRoot(projectRoot);

// ─── Start embedded HTTP server ───────────────────────────────────────────────

const _server = await startStudioServer(PATHS.VIEWS_FOLDER, projectRoot);

// ─── Register RPC handlers ────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<StudioRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      openProject: () => openProject(),
      listDirectory: (params) => listDirectory(params),
      readFile: (params) => handleReadFile(params),
      writeFile: (params) => handleWriteFile(params),
      deleteFile: (params) => handleDeleteFile(params),
      renameFile: (params) => handleRenameFile(params),
      createDirectory: (params) => handleCreateDirectory(params),
      discoverComponents: (params) => discoverComponents(params),
      codeService: (params) => codeService(params),
      locateFile: (params) => locateFile(params),
      fetchPluginSchema: (params) => fetchPluginSchema(params),
    },
    messages: {},
  },
});

// ─── Open the main window ─────────────────────────────────────────────────────

new BrowserWindow({
  title: "Jx Studio",
  url: `views://studio/index.html`,
  frame: { x: 0, y: 0, width: 1400, height: 900 },
  navigationRules: "views://*,^*",
  rpc,
});
