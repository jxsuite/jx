/**
 * Assemble everything electron-builder packs, under `packages/desktop/build/`.
 *
 *     build/app/            what becomes app.asar: the main process, the preload, package.json
 *     build/resources/      what stays a real file beside it (see src/electron-shell/layout.ts)
 *       backend/index.js      the backend, one Node bundle, with its data and node_modules beside it
 *       studio/               the studio assets the backend serves
 *
 * `electron-builder.yml` places those, and `package-app.ts` runs this and then electron-builder.
 * Run on its own it stages for the host, which is what to do to inspect a build without packaging.
 * It only ever stages for the host: the backend's native packages are the host's.
 *
 *     bun run stage [--platform darwin|linux|win32] [--arch arm64|x64]
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { bundleElectronApp } from "../src/electron-shell/bundle";
import { bundleBackend } from "./lib/backend-bundle";

const desktopDir = resolve(import.meta.dir, "..");
const buildDir = join(desktopDir, "build");
const appDir = join(buildDir, "app");
const resourcesDir = join(buildDir, "resources");

/** The value of `--name <value>` or `--name=<value>`, if given. */
function option(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index === -1) {
    return undefined;
  }
  const arg = argv[index] ?? "";
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
}

/**
 * The main process and preload, bundled to CommonJS, beside the package.json Electron starts from.
 * electron-updater is bundled in, so the asar needs no node_modules.
 */
async function stageApp(): Promise<void> {
  const bundle = await bundleElectronApp(appDir);
  console.log(`[stage] app: ${bundle.main}`);
  // SAFETY: this package's own committed manifest, whose fields are strings.
  const pkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8")) as {
    author: string;
    description: string;
    license: string;
    version: string;
  };
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify(
      {
        author: pkg.author,
        description: pkg.description,
        license: pkg.license,
        main: "app-main.js",
        name: "jx-studio",
        productName: "Jx Studio",
        version: pkg.version,
      },
      null,
      2,
    )}\n`,
  );
}

/** The backend as one Node bundle, with its data and its staged packages beside it. */
async function stageBackend(): Promise<void> {
  const { entry } = await bundleBackend(join(resourcesDir, "backend"), { stageModules: true });
  console.log(`[stage] backend: ${entry}`);
}

const platform = option("platform") ?? process.platform;
const arch = option("arch") ?? process.arch;
/* The staged packages carry this host's native binaries (esbuild's, sharp's, oxfmt's), so an
   installer for another platform would ship binaries that cannot load there. The release lanes
   build on native runners. */
if (platform !== process.platform || arch !== process.arch) {
  throw new Error(
    `Staging for ${platform}-${arch} on a ${process.platform}-${process.arch} host would ship this host's native modules; stage on the target platform.`,
  );
}

rmSync(appDir, { force: true, recursive: true });
rmSync(resourcesDir, { force: true, recursive: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

// The studio assets every launcher serves, built and staged by the same script the checkout runners use.
await $`bun run scripts/pre-build-rpc.ts`.cwd(desktopDir);
cpSync(join(desktopDir, "assets/studio"), join(resourcesDir, "studio"), { recursive: true });

await stageApp();
await stageBackend();
console.log(`[stage] done for ${platform}-${arch}`);
