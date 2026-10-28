/**
 * Run the multi-window Electron app from a checkout: `bun run desktop:electron [project]`.
 *
 * Bundles the app's main process, preload and backend into a directory of its own, then starts
 * Electron on it. The backend is bundled exactly as an installer stages it (`bundleBackend`),
 * because Electron's Node runs it and cannot run the TypeScript sources; its packages resolve from
 * the checkout's own `node_modules`, so nothing is staged beside it. Needs `ELECTRON_BIN`: the
 * Electron binary is never taken from `node_modules`, because installing the npm package downloads
 * one of ~100 MB.
 */
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleElectronApp } from "../src/main/bundle";
import { bundleBackend } from "./lib/backend-bundle";
import { electronAppCommand, findElectron, shellEnv, shellIcon } from "../src/main/command";

const electron = findElectron(process.env);
if (!electron) {
  console.error("[electron-app] Set ELECTRON_BIN to an Electron executable.");
  process.exit(1);
}

const bundle = await bundleElectronApp();
/* Inside the checkout, so its `node_modules` resolves what the bundle leaves external. */
const buildDir = resolve(import.meta.dir, "../build");
mkdirSync(buildDir, { recursive: true });
const backendDir = mkdtempSync(join(buildDir, "dev-backend-"));
const { entry: backend } = await bundleBackend(backendDir, { stageModules: false });
const command = electronAppCommand(
  electron,
  {
    backend,
    icon: shellIcon(),
    ...bundle,
  },
  process.argv[2] ? resolve(process.argv[2]) : null,
);
const child = spawn(command.bin, command.args, { env: shellEnv(process.env), stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill());
}
