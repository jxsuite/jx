/**
 * main.ts — JSONsx Studio desktop entry point (Electrobun main/bun process)
 *
 * Starts an embedded HTTP server that serves the studio UI and its backend
 * API routes, then opens a native BrowserWindow pointing at it.
 *
 * The project root defaults to CWD but can be overridden by:
 *   - CLI argument:          jsonsx-studio /path/to/project
 *   - Environment variable:  JSONSX_PROJECT_ROOT=/path/to/project
 */

import PATHS from "electrobun/bun";
import { BrowserWindow } from "electrobun/bun";
import { startStudioServer } from "./server.ts";

const projectRoot =
  process.argv[2] ||
  process.env.JSONSX_PROJECT_ROOT ||
  process.cwd();

const server = await startStudioServer(PATHS.VIEWS_FOLDER, projectRoot);

new BrowserWindow({
  title: "JSONsx Studio",
  url: `http://localhost:${server.port}/studio/index.html`,
  width: 1400,
  height: 900,
});
