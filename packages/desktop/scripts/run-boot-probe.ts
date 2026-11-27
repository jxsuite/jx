/**
 * Boot the packaged application's window and fail unless Studio runs on the desktop adapter
 * (`specs/desktop.md` §3.3).
 *
 *     bun run boot-probe electron [--timeout-ms N] [--out DIR]
 *
 * Run `bun run desktop:build -- --dir` first. The report, launcher log and, on a timeout, a
 * screenshot are left in `--out`. Exits 1 on failure.
 */
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { locateApp, probeEnvironment, runBootProbe, screenshotCommand } from "./boot-probe-runner";

const desktopDir = resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
if (argv[0] !== "electron") {
  console.error("usage: boot-probe electron [--timeout-ms N] [--out DIR]");
  process.exit(2);
}

function option(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const scratchOut = mkdtempSync(join(tmpdir(), "jx-boot-probe-"));
const out = resolve(option("out") ?? scratchOut);
mkdirSync(out, { recursive: true });
const located = locateApp(join(desktopDir, "artifacts"));
if (!located.path) {
  console.error(
    `[boot-probe] no unpacked application found; searched ${located.searched.join(", ")}`,
  );
  process.exit(1);
}
const profile = mkdtempSync(join(tmpdir(), "jx-boot-profile-"));
const env = probeEnvironment(process.env, profile);
const reportPath = join(out, "boot-report.json");
env.JX_STUDIO_BOOT_PROBE = reportPath;
const result = await runBootProbe({
  command: [located.path],
  env,
  logPath: join(out, "launcher.log"),
  reportPath,
  screenshot: (file) => {
    const command = screenshotCommand(process.platform, file);
    if (command) {
      Bun.spawnSync(command, { env: process.env });
    }
  },
  screenshotPath: join(out, "screen.png"),
  timeoutMs: Number(option("timeout-ms") ?? 120_000),
});
console.log(`[boot-probe] ${result.ok ? "pass" : "FAIL"}: ${result.summary}`);
if (!result.ok) {
  console.log(result.log);
}
process.exit(result.ok ? 0 : 1);
