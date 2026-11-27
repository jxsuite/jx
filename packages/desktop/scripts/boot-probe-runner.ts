/**
 * The boot probe's runner: locate a packaged application, launch it with `JX_STUDIO_BOOT_PROBE`
 * set, and judge the report it wrote (`specs/desktop.md` §3.3). Every per-OS choice takes an
 * explicit `platform` and its process calls are injectable, so each OS's branch is tested from a
 * Linux run. `run-boot-probe.ts` is the thin CLI over this file.
 *
 * @docs extending/contributing/monorepo
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnSyncReturns } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { BOOT_PROBE_ENV, judgeBootReport } from "../src/boot-probe";
import type { BootReport } from "../src/boot-probe";

/** The glob patterns, under the artifacts directory, that hold each OS's unpacked executable. */
const APP_PATTERNS = {
  darwin: "mac*/*.app/Contents/MacOS/*",
  linux: "linux*-unpacked/*",
  win32: "win-unpacked/*.exe",
};

/** Whether the current user may run `file`. */
function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where the application was looked for. */
export interface LocatedApp {
  path: string | null;
  searched: string[];
}

/** Files in an unpacked tree that are not the application. */
const NOT_THE_APP = /(?:chrome-sandbox|chrome_crashpad_handler|uninstall|\.so(?:\.|$))/i;

/**
 * Find the unpacked application electron-builder left.
 *
 * @param artifactsDir `packages/desktop/artifacts`.
 * @param platform The OS the application was packaged for.
 */
export function locateApp(artifactsDir: string, platform: string = process.platform): LocatedApp {
  const pattern =
    platform === "darwin" || platform === "win32" ? APP_PATTERNS[platform] : APP_PATTERNS.linux;
  const searched = [join(artifactsDir, pattern)];
  const found = [...new Bun.Glob(pattern).scanSync({ absolute: true, cwd: artifactsDir })]
    .filter((file) => !NOT_THE_APP.test(file.slice(file.lastIndexOf("/") + 1)))
    // An unpacked Linux tree also holds data files; the application is the executable one.
    .filter((file) => platform !== "linux" || isExecutable(file))
    .toSorted();
  return { path: found[0] ?? null, searched };
}

/**
 * The environment a probe launch runs in: its own profile, and a welcome window.
 *
 * @param base The caller's environment.
 * @param tmpDir A scratch directory this launch owns.
 * @param platform The OS being launched on.
 */
export function probeEnvironment(
  base: NodeJS.ProcessEnv,
  tmpDir: string,
  platform: string = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: tmpDir,
    [BOOT_PROBE_ENV]: join(tmpDir, "boot-report.json"),
    XDG_CONFIG_HOME: join(tmpDir, "config"),
    XDG_DATA_HOME: join(tmpDir, "data"),
  };
  if (platform === "win32") {
    env.APPDATA = join(tmpDir, "AppData", "Roaming");
    env.LOCALAPPDATA = join(tmpDir, "AppData", "Local");
    env.USERPROFILE = tmpDir;
  }
  delete env.JSONSX_PROJECT_ROOT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** The two process calls the runner makes after a spawn. */
export interface KillDeps {
  kill: (pid: number, signal: NodeJS.Signals) => void;
  spawnSync: (command: string, args: string[]) => Pick<SpawnSyncReturns<string>, "status">;
}

const realKillDeps: KillDeps = {
  kill: (pid, signal) => process.kill(pid, signal),
  spawnSync: (command, args) => spawnSync(command, args, { stdio: "ignore" }),
};

/**
 * The command that photographs the screen, or null where there is no tool.
 *
 * @param platform The OS.
 * @param file Where the image goes.
 */
export function screenshotCommand(platform: string, file: string): string[] | null {
  if (platform === "darwin") {
    return ["screencapture", "-x", file];
  }
  if (platform === "win32") {
    return null;
  }
  return ["import", "-window", "root", file];
}

/**
 * End a process and everything it started.
 *
 * @param pid The process id.
 * @param platform The OS.
 * @param deps Its process calls.
 */
export function killTree(
  pid: number,
  platform: string = process.platform,
  deps: KillDeps = realKillDeps,
): void {
  if (platform === "win32") {
    deps.spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)]);
    return;
  }
  try {
    // The spawn made a process group (`detached`), so the negative pid is the whole tree.
    deps.kill(-pid, "SIGKILL");
  } catch {
    deps.kill(pid, "SIGKILL");
  }
}

/** What a probe run is given. */
export interface RunOptions {
  command: string[];
  env: NodeJS.ProcessEnv;
  /** Where the launcher's output goes; beside the report by default. */
  logPath?: string;
  platform?: string;
  reportPath: string;
  /** Photograph the screen to this path on a timeout. */
  screenshot?: (file: string) => void;
  screenshotPath?: string;
  spawn?: (command: string, args: string[], env: NodeJS.ProcessEnv, fd: number) => ChildProcess;
  timeoutMs?: number;
}

/** What a probe run found. */
export interface RunResult {
  log: string;
  ok: boolean;
  report: BootReport | null;
  summary: string;
  timedOut: boolean;
}

function readReport(path: string): BootReport | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    /* SAFETY: written by `createBootProbe`; a torn or foreign file fails the parse and reads as none. */
    return JSON.parse(readFileSync(path, "utf8")) as BootReport;
  } catch {
    return null;
  }
}

/**
 * Launch, wait, judge.
 *
 * @param options The command, its environment, and the report to read.
 */
export async function runBootProbe(options: RunOptions): Promise<RunResult> {
  const { command, env, reportPath, timeoutMs = 120_000 } = options;
  const platform = options.platform ?? process.platform;
  const logPath = options.logPath ?? `${reportPath}.log`;
  const [file = "", ...args] = command;
  const fd = openSync(logPath, "w");
  const launch =
    options.spawn ??
    ((cmd, argv, environment, out) =>
      spawn(cmd, argv, {
        detached: platform !== "win32",
        env: environment,
        stdio: ["ignore", out, out],
      }));
  const child = launch(file, args, env, fd);
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", (error) => {
      writeSync(fd, `spawn failed: ${error.message}\n`);
      resolve();
    });
  });
  const state = { timedOut: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      state.timedOut = true;
      resolve();
    }, timeoutMs);
  });
  await Promise.race([exited, deadline]);
  clearTimeout(timer);
  if (state.timedOut) {
    if (options.screenshot && options.screenshotPath) {
      try {
        options.screenshot(options.screenshotPath);
      } catch (error) {
        writeSync(fd, `screenshot failed: ${String(error)}\n`);
      }
    }
    if (child.pid !== undefined) {
      killTree(child.pid, platform);
    }
  }
  closeSync(fd);
  const report = readReport(reportPath);
  const verdict = judgeBootReport(report);
  const log = readFileSync(logPath, "utf8");
  return {
    log: log.slice(-4000),
    ok: verdict.ok,
    report,
    summary: state.timedOut
      ? `${verdict.summary} (timed out after ${timeoutMs} ms)`
      : verdict.summary,
    timedOut: state.timedOut,
  };
}
