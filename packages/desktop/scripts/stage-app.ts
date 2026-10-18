/**
 * Assemble everything electron-builder packs, under `packages/desktop/build/`.
 *
 *     build/app/            what becomes app.asar: the main process, the preload, package.json
 *     build/resources/      what stays a real file beside it (see src/electron-shell/layout.ts)
 *       backend/index.js      the backend, one Bun bundle, with its data beside it
 *       studio/               the studio assets the backend serves
 *       bun/bun[.exe]         the pinned Bun that runs the backend
 *
 * `electron-builder.yml` places those, and `package-app.ts` runs this and then electron-builder.
 * Run on its own it stages for the host, which is what to do to inspect a build without packaging.
 *
 *     bun run stage [--platform darwin|linux|win32] [--arch arm64|x64]
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { bundleElectronEntry } from "../src/electron-shell/bundle";
import { BACKEND_DATA, BACKEND_EXTERNALS, BACKEND_MODULES } from "./lib/backend-bundle";
import { bunRuntimeFor, matchesChecksum } from "./lib/bun-runtime";

const desktopDir = resolve(import.meta.dir, "..");
const buildDir = join(desktopDir, "build");
const appDir = join(buildDir, "app");
const resourcesDir = join(buildDir, "resources");
const cacheDir = join(buildDir, "cache");

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
  const bundle = await bundleElectronEntry("app-main", appDir);
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

/** The backend as one Bun bundle, with the data the inlined modules read beside it. */
async function stageBackend(): Promise<void> {
  const outdir = join(resourcesDir, "backend");
  const result = await Bun.build({
    entrypoints: [join(desktopDir, "src/hub/main.ts")],
    external: [...BACKEND_EXTERNALS],
    naming: "index.js",
    outdir,
    target: "bun",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Bundling the backend failed.");
  }
  for (const { from, to } of BACKEND_DATA) {
    cpSync(join(desktopDir, from), join(outdir, to), { recursive: true });
  }
  for (const name of BACKEND_MODULES) {
    // Hoisted to the repository root by the workspace install.
    const source = join(desktopDir, "../../node_modules", name);
    if (!existsSync(source)) {
      throw new Error(`${name} is not installed; run \`bun install\` before staging.`);
    }
    cpSync(source, join(outdir, "node_modules", name), { recursive: true });
  }
  console.log(`[stage] backend: ${join(outdir, "index.js")}`);
}

/** The pinned Bun, downloaded once into the cache and verified before it is trusted. */
async function stageBun(platform: string, arch: string): Promise<void> {
  const runtime = bunRuntimeFor(platform, arch);
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, `${runtime.file}-${runtime.version}.zip`);
  const cached = existsSync(archive) ? new Uint8Array(await Bun.file(archive).arrayBuffer()) : null;
  if (!cached || !matchesChecksum(cached, runtime.sha256)) {
    console.log(`[stage] downloading ${runtime.url}`);
    const response = await fetch(runtime.url);
    if (!response.ok) {
      throw new Error(`Downloading Bun failed: ${response.status} ${runtime.url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!matchesChecksum(bytes, runtime.sha256)) {
      throw new Error(
        `The Bun archive at ${runtime.url} is not the pinned release (SHA-256 mismatch).`,
      );
    }
    writeFileSync(archive, bytes);
  }
  const extracted = join(cacheDir, `${runtime.file}-${runtime.version}`);
  rmSync(extracted, { force: true, recursive: true });
  mkdirSync(extracted, { recursive: true });
  // Windows' own tar reads zip; the Unix runners have unzip.
  await (process.platform === "win32"
    ? $`tar -xf ${archive} -C ${extracted}`
    : $`unzip -q -o ${archive} -d ${extracted}`);
  const bunDir = join(resourcesDir, "bun");
  mkdirSync(bunDir, { recursive: true });
  const target = join(bunDir, runtime.binary);
  cpSync(join(extracted, runtime.file, runtime.binary), target);
  chmodSync(target, 0o755);
  console.log(`[stage] bun ${runtime.version}: ${target}`);
}

const platform = option("platform") ?? process.platform;
const arch = option("arch") ?? process.arch;

rmSync(appDir, { force: true, recursive: true });
rmSync(resourcesDir, { force: true, recursive: true });
mkdirSync(appDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

// The studio assets every launcher serves, built and staged by the same script the checkout runners use.
await $`bun run scripts/pre-build-rpc.ts`.cwd(desktopDir);
cpSync(join(desktopDir, "assets/studio"), join(resourcesDir, "studio"), { recursive: true });

await stageApp();
await stageBackend();
await stageBun(platform, arch);
console.log(`[stage] done for ${platform}-${arch}`);
