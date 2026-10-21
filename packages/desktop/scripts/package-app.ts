/**
 * Package Jx Studio: stage, then run electron-builder.
 *
 *     bun run package [--target mac|mas|win|linux] [--arch arm64|x64] [-- <electron-builder args>]
 *
 * With no target it builds for the machine it runs on. Anything after the options goes to
 * electron-builder unchanged, so `--dir` produces an unpacked application to run or inspect, and
 * `--publish never` is what a release lane passes. Signing and notarization read their credentials
 * from the environment (`CSC_LINK`, `APPLE_API_KEY`, …) and are skipped, loudly, when absent.
 */
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const PLATFORMS = { linux: "linux", mac: "darwin", mas: "darwin", win: "win32" } as const;
type Target = keyof typeof PLATFORMS;

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const own = split === -1 ? argv : argv.slice(0, split);
const passthrough = split === -1 ? [] : argv.slice(split + 1);

/** The value of `--name <value>` or `--name=<value>` among this script's own options. */
function option(name: string): string | undefined {
  const index = own.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index === -1) {
    return undefined;
  }
  const arg = own[index] ?? "";
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : own[index + 1];
}

const hostTarget: Target =
  process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
/* SAFETY: validated against `PLATFORMS` on the next line before anything reads it as a `Target`. */
const target = (option("target") ?? hostTarget) as Target;
if (!(target in PLATFORMS)) {
  console.error(`[package] --target must be one of ${Object.keys(PLATFORMS).join(", ")}.`);
  process.exit(1);
}
const arch = option("arch") ?? process.arch;
if (arch !== "x64" && arch !== "arm64") {
  console.error("[package] --arch must be x64 or arm64.");
  process.exit(1);
}

const run = async (command: string[]): Promise<void> => {
  const child = Bun.spawn(command, {
    cwd: desktopDir,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    process.exit(code);
  }
};

await run([
  process.execPath,
  "run",
  "scripts/stage-app.ts",
  "--platform",
  PLATFORMS[target],
  "--arch",
  arch,
]);
await run([
  process.execPath,
  "x",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  // Electron-builder has no `--mas` switch: the Mac App Store build is `--mac mas`.
  ...(target === "mas" ? ["--mac", "mas"] : [`--${target}`]),
  `--${arch}`,
  ...passthrough,
]);
