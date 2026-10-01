import { $ } from "bun";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import {
  DEV_CERT_FILENAME,
  DEV_CERT_PASSWORD,
  renderAppxManifest,
  toQuadVersion,
} from "./msix-identity.ts";
import {
  WINDOWS_RUNTIME_FILES,
  describeRuntimeSearch,
  electrobunVersion,
  resolveWindowsRuntime,
} from "./electrobun-runtime.ts";
import { patchLauncherMain } from "./msix-launcher-patch.ts";

if (process.platform !== "win32") {
  console.log("[build-msix] Skipping MSIX build (not Windows)");
  process.exit(0);
}

const desktopDir = resolve(import.meta.dir, "..");
const certPath = join(desktopDir, "certs", DEV_CERT_FILENAME);
const certPassword = DEV_CERT_PASSWORD;

const distDir = join(desktopDir, "dist");
const artifactsDir = join(desktopDir, "artifacts");
await mkdir(distDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

const buildDir = join(desktopDir, "build", "stable-win-x64", "JxStudio");
if (!existsSync(buildDir)) {
  console.error(
    "[build-msix] Build dir not found. Run 'bun run build:stable' (electrobun build --env=stable) first.",
  );
  process.exit(1);
}

// Electrobun 2 keeps no runtime in node_modules; Hutch caches it per release. The version is
// Read from the installed electrobun package, which is what selected the toolchain. See
// Scripts/electrobun-runtime.ts for the cache layout and the fallback search.
const { dir: electrobunDist, searched } = resolveWindowsRuntime(electrobunVersion());
if (!electrobunDist) {
  console.error(`[build-msix] ${describeRuntimeSearch(searched)}`);
  process.exit(1);
}

// --- Step 1: Decompress tar.zst archive if needed ---
const resourcesDir = join(buildDir, "Resources");
if (existsSync(resourcesDir) && !existsSync(join(resourcesDir, "app"))) {
  const files = readdirSync(resourcesDir);
  const tarZstFile = files.find((f) => f.endsWith(".tar.zst"));
  if (tarZstFile) {
    const zstdPath = join(electrobunDist, "zig-zstd.exe");
    const tarZstPath = join(resourcesDir, tarZstFile);
    const tarPath = tarZstPath.replace(".zst", "");
    console.log(`[build-msix] Decompressing: ${tarZstFile}`);
    await $`${zstdPath} decompress -i ${tarZstPath} -o ${tarPath}`;
    await $`C:\\Windows\\System32\\tar.exe -xf ${tarPath} -C ${join(buildDir, "..")}`;
    unlinkSync(tarPath);
    unlinkSync(tarZstPath);
  }
}

// --- Step 2: Place runtime files from the Hutch release cache ---
const binDir = join(buildDir, "bin");
// No bun.exe here: step 3 compiles the patched launcher into one instead.
for (const file of WINDOWS_RUNTIME_FILES) {
  const src = join(electrobunDist, file);
  if (existsSync(src)) {
    await copyFile(src, join(binDir, file));
  }
}

// Copy CEF files if present (bundleCEF: true)
const cefSrcDir = join(electrobunDist, "cef");
if (existsSync(cefSrcDir)) {
  console.log("[build-msix] Copying CEF runtime files...");
  await cp(cefSrcDir, join(binDir, "cef"), { recursive: true });
}

// --- Step 3: Patch main.js and compile into standalone exe ---
// MSIX Workers get EPERM reading files from C:\Program Files\WindowsApps.
// We patch the flat-files branch to copy the app entrypoint to %TEMP% before
// Spawning the Worker, then compile the patched main.js into bun.exe.
const mainJsPath = join(buildDir, "Resources", "main.js");
// A launcher the patch cannot be applied to throws here and fails the build. The header of
// The patch module explains why: warning and shipping the unpatched launcher is how an MSIX that
// Cannot start reached the Store.
const mainJsSrc = await readFile(mainJsPath, "utf8");
await writeFile(mainJsPath, patchLauncherMain(mainJsSrc), "utf8");
console.log("[build-msix] Patched main.js (flat-files → temp copy for MSIX Worker EPERM fix)");

const compiledExe = join(binDir, "bun.exe");
await $`bun build ${mainJsPath} --compile --outfile ${compiledExe}`;
console.log("[build-msix] Compiled main.js → bun.exe (standalone)");

// --- Step 4: Stage flat directory for MSIX ---
const msixStageDir = join(distDir, "msix-stage");
if (existsSync(msixStageDir)) {
  await rm(msixStageDir, { recursive: true });
}
await cp(buildDir, msixStageDir, { recursive: true });

// Remove build tools, cross-platform artifacts, and unused libs
const junkFiles = ["zig-zstd.exe", "bspatch.exe", "Info.plist", "libasar.dll", "libasar-arm64.dll"];
for (const name of junkFiles) {
  for (const dir of [join(msixStageDir, "bin"), msixStageDir]) {
    const p = join(dir, name);
    if (existsSync(p)) {
      unlinkSync(p);
    }
  }
}
const extensionlessLauncher = join(msixStageDir, "bin", "launcher");
if (existsSync(extensionlessLauncher)) {
  unlinkSync(extensionlessLauncher);
}

// --- Step 5: Copy pre-generated asset PNGs ---
const assetsDir = join(msixStageDir, "Assets");
await mkdir(assetsDir, { recursive: true });
for (const file of readdirSync(join(desktopDir, "msix-assets"))) {
  await copyFile(join(desktopDir, "msix-assets", file), join(assetsDir, file));
}

// --- Step 6: Generate AppxManifest.xml ---
const pkg = JSON.parse(await readFile(join(desktopDir, "package.json"), "utf8")) as {
  version: string;
};
const { version } = pkg;
const quadVersion = toQuadVersion(version);

// The manifest's Publisher and the signing cert's Subject must match EXACTLY; both come from
// Scripts/msix-identity.ts so they cannot drift. See that file's header.
const manifest = renderAppxManifest(version);

await writeFile(join(msixStageDir, "AppxManifest.xml"), manifest, "utf8");
console.log("[build-msix] Generated AppxManifest.xml");

// --- Step 7: Run makeappx ---
function findSdkTool(name: string): string {
  const kitsDir = String.raw`C:\Program Files (x86)\Windows Kits\10\bin`;
  if (existsSync(kitsDir)) {
    const versions = readdirSync(kitsDir)
      .filter((d) => d.startsWith("10."))
      .toSorted()
      .toReversed();
    for (const ver of versions) {
      const p = join(kitsDir, ver, "x64", `${name}.exe`);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return name;
}

const makeappx = findSdkTool("makeappx");
const outputMsix = join(distDir, `JxStudio_${quadVersion}_x64.msix`);
await $`${makeappx} pack /d ${msixStageDir} /p ${outputMsix} /o`;
console.log(`[build-msix] Created: ${outputMsix}`);

// --- Step 8: Sign if certificate exists ---
let signed = false;
if (existsSync(certPath)) {
  const signtool = findSdkTool("signtool");
  try {
    await $`${signtool} sign /f ${certPath} /p ${certPassword} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 ${outputMsix}`;
    console.log("[build-msix] Signed MSIX");
    signed = true;
  } catch {
    console.error(
      "[build-msix] ⚠ Signing FAILED — shipping an UNSIGNED MSIX. SmartScreen will warn.",
    );
  }
} else {
  console.warn(
    "[build-msix] ⚠ No signing certificate — shipping an UNSIGNED MSIX. SmartScreen will warn on first run.",
  );
}
// Record the honest signing status next to the artifact so a release job (and the marketing-claims
// Gate via packages/desktop/release-assets.json) can verify it rather than assume.
await Bun.write(join(artifactsDir, "msix-signing.json"), JSON.stringify({ signed }, null, 2));

// --- Step 9: Copy artifacts ---
const msixName = `JxStudio_${quadVersion}_x64.msix`;
await cp(outputMsix, join(artifactsDir, msixName));
console.log(`[build-msix] Done → artifacts/${msixName}`);
