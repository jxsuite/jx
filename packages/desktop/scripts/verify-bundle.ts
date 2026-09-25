/**
 * Packaged-bundle completeness check, run from the electrobun postBuild hook (post-build.ts).
 *
 * The Bun bundler only inlines the JS module graph into app/bun/index.js; every static data
 * directory the bundled code reads off disk (create templates, starter sites, staged studio assets)
 * must be placed by electrobun.config.ts `build.copy` — and electrobun's copy step only logs a
 * missing source and continues. This check turns any omission into a hard build failure instead of
 * a runtime ENOENT on the tester's machine.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_ASSETS, STUDIO_WORKERS } from "@jxsuite/studio/hosting/layout";
import { initBundleProblems } from "./init-bundle";

/**
 * Paths every packaged app-code dir must contain, relative to the bundle's `app/` dir.
 *
 * The studio half is DERIVED from `@jxsuite/studio`'s manifest rather than listed here. It used to
 * be listed, and it was the third copy of the same list — after `stage-studio-assets.ts` and
 * `electrobun.config.ts`'s copy block — so it could only ever assert what someone had remembered to
 * write in all three. `dist/codicon.ttf` was in none of them.
 *
 * `dist/workers` is expanded to its three filenames rather than collapsed to a directory check, and
 * that granularity is load-bearing: a worker that is absent does not 404 loudly, it leaves the
 * packaged code view with no JSON language service at all.
 */
const STUDIO_REQUIRED = STUDIO_ASSETS.filter((a) => a.required).flatMap((a) =>
  a.path === "dist/workers"
    ? STUDIO_WORKERS.map((w) => `views/studio/dist/workers/${w}`)
    : [`views/studio/${a.path}`],
);

/** The launcher's init bundle, the one required file whose CONTENT is judged as well. */
export const INIT_BUNDLE = "views/studio/dist/init.js";

export const REQUIRED = [
  "bun/index.js",
  // @jxsuite/create resolves these next to its bundled module (app/bun/).
  "bun/template/gitignore",
  "bun/template/layouts/base.json",
  "bun/template/pages/index.md",
  "bun/templates/mobile-app/layouts/base.json",
  // @jxsuite/starters reads the registry the same way; per-starter trees are checked against it.
  "bun/registry.json",
  ...STUDIO_REQUIRED,
  /* The launcher's own PAL-init bundle, which is the one studio-tree file the manifest does NOT
     know about: the desktop builds it and stages it into studio's dist/. Without it the packaged
     app boots with no platform registered. */
  INIT_BUNDLE,
];

/**
 * @returns One line per defect, empty when the bundle is complete: a missing required path
 *   (relative to appDir), or `views/studio/dist/init.js: <problem>` for an init bundle that is
 *   present but would not boot. Every line starts with the path it is about, so the post-build
 *   report stays one path per line.
 */
export function verifyBundle(appDir: string): string[] {
  const missing = REQUIRED.filter((rel) => !existsSync(join(appDir, rel)));

  /* Existence alone passed every 5.x release, whose init.js was present and threw on import — it
     had inlined node_modules/electrobun's throwing stub instead of the vendored view SDK. Judged
     here again, on the packaged copy, so a bundle that skipped pre-build's check (or was staged by
     some other route) still cannot ship. */
  const initPath = join(appDir, INIT_BUNDLE);
  if (existsSync(initPath)) {
    for (const problem of initBundleProblems(readFileSync(initPath, "utf8"), {
      electrobun: true,
    })) {
      missing.push(`${INIT_BUNDLE}: ${problem}`);
    }
  }

  // Every starter listed in the staged registry must have its project tree staged too, or the
  // New Project starter gallery offers clones that fail. Deriving ids from the registry keeps
  // Future starters covered automatically.
  const registryPath = join(appDir, "bun", "registry.json");
  if (existsSync(registryPath)) {
    const starters = JSON.parse(readFileSync(registryPath, "utf8")) as { id: string }[];
    for (const { id } of starters) {
      if (!existsSync(join(appDir, "bun", "sites", id, "project.json"))) {
        missing.push(`bun/sites/${id}/project.json`);
      }
    }
  }
  return missing;
}
