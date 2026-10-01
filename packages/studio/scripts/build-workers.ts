/**
 * Build-workers.ts — bundle Monaco's web workers into dist/workers.
 *
 * Resolves monaco-editor through node resolution (its package.json exposes a "./*" export map)
 * rather than a hardcoded "./node_modules/monaco-editor/..." path. The literal path only works when
 * bun creates a per-package symlink under packages/studio/node_modules; in CI the dependency is
 * hoisted to the repo-root node_modules and that symlink is absent, so the hardcoded path fails
 * while resolution (which walks up to the root) still succeeds.
 */

import { resolve } from "node:path";
import type { BuildConfig } from "bun";

/* The 0.56 export-map paths (`"./*" → ./esm/vs/*.js`), not the deep `esm/vs/...` ones. The output
   FILENAMES are unchanged — `editor.worker.js` / `json.worker.js` / `ts.worker.js` — because three
   consumers address them literally: `workerUrl()` in src/services/monaco-setup.ts, the desktop
   bundle config, and the desktop asset staging. */
const WORKERS = [
  "monaco-editor/editor/editor.worker",
  "monaco-editor/languages/features/json/json.worker",
  "monaco-editor/languages/features/typescript/ts.worker",
];

/**
 * Where the workers land — `packages/studio/dist/workers`, resolved off this script's own location
 * rather than the cwd so importers (the dev server) get the same output as `bun run build`.
 * src/services/monaco-setup.ts loads them from here, relative to the studio document.
 */
export const WORKER_OUTDIR = resolve(import.meta.dir, "..", "dist", "workers");

/**
 * Bundle Monaco's web workers into {@link WORKER_OUTDIR}. One Bun.build per worker: a single
 * multi-entry build roots its output at the entrypoints' common ancestor (`esm/vs`) and would nest
 * them under `editor/` and `language/json/`, which the flat `dist/workers/<name>.worker.js` lookup
 * in monaco-setup.ts does not expect.
 *
 * The workers are built with linked source maps, like the entries, so a minified release worker is
 * as debuggable as a minified chunk. The maps are about 21 MB, most of it the TS worker's, and they
 * reach no host: staging and the bundle budget skip them by the same `**\/*.map` rule that already
 * covers `dist/chunks`, and package.json publishes `dist/workers/*.js` rather than the directory,
 * because a `files` entry cannot subtract. That last rule is the one npm sees, and nothing else
 * would notice its absence — check-studio-package.ts (rule 5) holds `files` to it.
 *
 * @param release What the release build adds — `studioReleaseOptions` from build-config.ts, i.e.
 *   minification. The dev server calls this with nothing, so its workers stay readable on the same
 *   rule as its watcher's bundles; `scripts/build.ts` passes the release options.
 * @returns {Promise<void>} Resolves once all three workers are written
 */
export async function buildMonacoWorkers(release: Partial<BuildConfig> = {}): Promise<void> {
  for (const spec of WORKERS) {
    const entry = Bun.resolveSync(spec, import.meta.dir);
    const result = await Bun.build({
      ...release,
      entrypoints: [entry],
      naming: "[name].[ext]",
      outdir: WORKER_OUTDIR,
      sourcemap: "linked",
      target: "browser",
    });
    if (!result.success) {
      for (const log of result.logs) {
        console.error(log);
      }
      process.exit(1);
    }
  }
}

// Direct invocation (`bun run scripts/build-workers.ts`) still builds; importers call the export.
if (import.meta.main) {
  await buildMonacoWorkers();
}
