import {
  addPackage,
  codeService,
  discoverComponents,
  fetchPluginSchema,
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
  handleCreateDirectory,
  handleDeleteFile,
  handleReadFile,
  handleRenameFile,
  handleResolveSiteContext,
  handleUploadFile,
  handleWriteFile,
  listDirectory,
  listPackages,
  locateFile,
  openProject,
  removePackage,
  setProjectRoot,
} from "./_session";
import type { RpcHandler, RpcRequestFrame, RpcResult } from "@jxsuite/server/project-server";

/**
 * One method of this server. The project server's handler contract, widened to admit the handlers
 * that answer nothing (git and package mutations resolve `void`), which reply `null`.
 */
type TestRpcHandler = (params: Parameters<RpcHandler>[0]) => Promise<RpcResult> | Promise<void>;

const projectRoot = process.argv[2] || process.cwd();
setProjectRoot(projectRoot);

/* SAFETY: trust boundary of a test fixture. The only client of this server is the chromium RPC
   transport under test, which sends each method the params StudioRPC declares for it; whatever a
   handler throws is answered with an error frame below. */
const handlers = new Map<string, TestRpcHandler>([
  ["addPackage", (params) => addPackage(params as { name: string })],
  ["codeService", () => codeService()],
  ["createDirectory", (params) => handleCreateDirectory(params as { path: string })],
  ["deleteFile", (params) => handleDeleteFile(params as { path: string })],
  ["discoverComponents", (params) => discoverComponents(params as { dir?: string })],
  [
    "fetchPluginSchema",
    (params) => fetchPluginSchema(params as { src: string; prototype?: string; base?: string }),
  ],
  ["gitBranches", () => gitBranches()],
  ["gitCheckout", (params) => gitCheckout(params as { branch: string })],
  ["gitCommit", (params) => gitCommit(params as { message: string })],
  ["gitCreateBranch", (params) => gitCreateBranch(params as { name: string })],
  ["gitDiff", (params) => gitDiff(params as { path?: string })],
  ["gitDiscard", (params) => gitDiscard(params as { files: string[] })],
  ["gitFetch", () => gitFetch()],
  ["gitLog", (params) => gitLog(params as { limit?: number })],
  ["gitPull", () => gitPull()],
  ["gitPush", () => gitPush()],
  ["gitStage", (params) => gitStage(params as { files: string[] })],
  ["gitStatus", () => gitStatus()],
  ["gitUnstage", (params) => gitUnstage(params as { files: string[] })],
  ["listDirectory", (params) => listDirectory(params as { dir: string })],
  ["listPackages", () => listPackages()],
  ["locateFile", (params) => locateFile(params as { name: string })],
  ["openProject", () => openProject()],
  ["readFile", (params) => handleReadFile(params as { path: string })],
  ["removePackage", (params) => removePackage(params as { name: string })],
  ["renameFile", (params) => handleRenameFile(params as { from: string; to: string })],
  ["resolveSiteContext", (params) => handleResolveSiteContext(params as { filePath: string })],
  ["uploadFile", (params) => handleUploadFile(params as { path: string; data: string })],
  ["writeFile", (params) => handleWriteFile(params as { path: string; content: string })],
]);

const server = Bun.serve({
  async fetch(req, srv) {
    if (srv.upgrade(req)) {
      return;
    }
    return new Response("Not Found", { status: 404 });
  },
  port: 0,
  websocket: {
    async message(ws, raw) {
      let msg: RpcRequestFrame;
      try {
        /* SAFETY: the transport under test sends `{ id, method, params }` frames, and JSON.parse
           yields a JSON value; a binary frame decodes as UTF-8, as JSON.parse's own coercion would. */
        msg = JSON.parse(raw.toString()) as RpcRequestFrame;
      } catch {
        ws.send(JSON.stringify({ error: "Invalid JSON", id: 0 }));
        return;
      }

      const handler = handlers.get(msg.method);
      if (!handler) {
        await Bun.sleep(0);
        ws.send(
          JSON.stringify({
            error: `Unknown method: ${msg.method}`,
            id: msg.id,
          }),
        );
        return;
      }

      try {
        const result = await handler(msg.params);
        ws.send(JSON.stringify({ id: msg.id, result: result ?? null }));
      } catch (error: unknown) {
        await Bun.sleep(0);
        ws.send(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            id: msg.id,
          }),
        );
      }
    },
  },
});

console.log(`[test-server] port=${server.port}`);
