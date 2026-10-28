/**
 * The Electron application's main-process entry: hands the real Electron API to `startApp`.
 *
 * Bundled to CommonJS by `bundle.ts` with `electron` left external, like `main.ts`, because the
 * runtime provides that module and nothing else here may reach outside the bundle.
 *
 * @docs studio/desktop
 */
import * as electron from "electron";
import { startApp } from "./app";

/** Start, and quit rather than leave a windowless process behind if starting fails. */
async function main(): Promise<void> {
  try {
    await startApp(electron, process.argv);
  } catch (error) {
    console.error("[electron-app]", error);
    electron.app.quit();
  }
}

// The bundle is CommonJS (see bundle.ts), where a top-level await cannot exist.
// oxlint-disable-next-line unicorn/prefer-top-level-await
void main();
