/**
 * The Electron shell's main-process entry: hands the real Electron API to `startShell`.
 *
 * Bundled to CommonJS by `bundle.ts` with `electron` left external, because the runtime provides
 * that module and nothing else here may reach outside the bundle.
 *
 * @docs studio/desktop
 */
import * as electron from "electron";
import { startShell } from "./shell";

/** Start, and quit rather than leave a windowless process behind if starting fails. */
async function main(): Promise<void> {
  try {
    await startShell(electron, process.argv);
  } catch (error) {
    console.error("[electron-shell]", error);
    electron.app.quit();
  }
}

// The bundle is CommonJS (see bundle.ts), where a top-level await cannot exist.
// oxlint-disable-next-line unicorn/prefer-top-level-await
void main();
