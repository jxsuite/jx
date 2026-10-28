/**
 * Bundle the backend into a directory, for a build that ships it inside an install which already
 * resolves its native packages (the Nix package):
 *
 *     bun run scripts/bundle-backend.ts <outdir>
 *
 * The same `bundleBackend` the installers stage with (`stage-app.ts`), without staging the
 * `node_modules`: the bundle's external packages resolve from the install it sits in.
 */
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { resolve } from "node:path";
import { bundleBackend } from "./lib/backend-bundle";

const outdir = process.argv.at(2);
if (!outdir) {
  console.error("usage: bun run scripts/bundle-backend.ts <outdir>");
  process.exit(2);
}
const { entry } = await bundleBackend(resolve(outdir), { stageModules: false });
console.log(`[bundle-backend] ${entry}`);
