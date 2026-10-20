/**
 * Run the multi-window Electron app from a checkout: `bun run desktop:electron [project]`.
 *
 * Bundles the app's main process and preload into a directory of its own, then starts Electron on
 * it with this checkout's Bun and backend. Needs `ELECTRON_BIN`: the Electron binary is never taken
 * from `node_modules`, because installing the npm package downloads one of ~100 MB.
 */
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { bundleElectronApp } from "../src/electron-shell/bundle";
import {
  electronAppCommand,
  findElectron,
  shellEnv,
  shellIcon,
} from "../src/chromium/shell-command";

const electron = findElectron(process.env);
if (!electron) {
  console.error("[electron-app] Set ELECTRON_BIN to an Electron executable.");
  process.exit(1);
}

const bundle = await bundleElectronApp();
const command = electronAppCommand(
  electron,
  {
    backend: resolve(import.meta.dir, "../src/hub/main.ts"),
    bun: process.execPath,
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
