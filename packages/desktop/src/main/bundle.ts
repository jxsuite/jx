/**
 * Compile the Electron shell for the runtime that will load it.
 *
 * Electron runs JavaScript, and a sandboxed preload must be CommonJS whose only `require` is
 * `electron`, so the two entries are bundled to CJS with `electron` external. It happens at launch,
 * into a directory of this process's own, rather than at package time: the sources are already in
 * the installed tree (the backend runs from them in a checkout), the build takes milliseconds, and
 * the dev checkout and the Nix package then run the same code by the same path.
 *
 * @docs studio/desktop
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where the bundled entries landed. */
export interface ShellBundle {
  main: string;
  preload: string;
}

/** A fresh directory for this process's bundle, removed when the process exits. */
function ownedDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "jx-electron-shell-"));
  process.once("exit", () => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

/**
 * Bundle `app-main.ts` and `preload.ts`: the multi-window application.
 *
 * @param outDir Where to write them; by default a directory of this process's own.
 * @throws {AggregateError} With the bundler's own messages when the build fails.
 */
export async function bundleElectronApp(outDir = ownedDirectory()): Promise<ShellBundle> {
  const result = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "app-main.ts"),
      join(import.meta.dir, "../preload/preload.ts"),
    ],
    external: ["electron"],
    format: "cjs",
    naming: "[name].js",
    outdir: outDir,
    target: "node",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Bundling the Electron shell failed.");
  }
  return { main: join(outDir, "app-main.js"), preload: join(outDir, "preload.js") };
}
