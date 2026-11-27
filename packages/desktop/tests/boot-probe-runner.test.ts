import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  killTree,
  locateApp,
  probeEnvironment,
  runBootProbe,
  screenshotCommand,
} from "../scripts/boot-probe-runner";
import type { KillDeps } from "../scripts/boot-probe-runner";

const scratch = mkdtempSync(join(tmpdir(), "jx-boot-runner-test-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

/** Make `files` under a fresh tree, executable or not. */
function tree(name: string, files: Record<string, boolean>): string {
  const dir = join(scratch, name);
  for (const [file, executable] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "x");
    chmodSync(path, executable ? 0o755 : 0o644);
  }
  return dir;
}

describe("locateApp", () => {
  test("finds the application in each OS's unpacked layout", () => {
    const linux = tree("linux", {
      "linux-unpacked/chrome-sandbox": true,
      "linux-unpacked/jx-studio": true,
      "linux-unpacked/resources.pak": false,
    });
    expect(locateApp(linux, "linux").path).toBe(join(linux, "linux-unpacked/jx-studio"));
    const mac = tree("mac", { "mac-arm64/Jx Studio.app/Contents/MacOS/Jx Studio": true });
    expect(locateApp(mac, "darwin").path).toBe(
      join(mac, "mac-arm64/Jx Studio.app/Contents/MacOS/Jx Studio"),
    );
    const win = tree("win", {
      "win-unpacked/Jx Studio.exe": false,
      "win-unpacked/Uninstall Jx Studio.exe": false,
    });
    expect(locateApp(win, "win32").path).toBe(join(win, "win-unpacked/Jx Studio.exe"));
  });

  test("lists every pattern it searched on a miss", () => {
    const empty = tree("empty", { "unrelated/file": false });
    const result = locateApp(empty, "linux");
    expect(result.path).toBeNull();
    expect(result.searched).toEqual([join(empty, "linux*-unpacked/*")]);
  });
});

describe("per-OS tools", () => {
  test("screenshotCommand and killTree choose each OS's tool", () => {
    expect(screenshotCommand("linux", "a.png")).toEqual(["import", "-window", "root", "a.png"]);
    expect(screenshotCommand("darwin", "a.png")).toEqual(["screencapture", "-x", "a.png"]);
    expect(screenshotCommand("win32", "a.png")).toBeNull();

    const calls: string[] = [];
    const deps: KillDeps = {
      kill: (pid, signal) => calls.push(`kill ${pid} ${signal}`),
      spawnSync: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { status: 0 };
      },
    };
    killTree(42, "linux", deps);
    killTree(42, "darwin", deps);
    killTree(42, "win32", deps);
    expect(calls).toEqual(["kill -42 SIGKILL", "kill -42 SIGKILL", "taskkill /T /F /PID 42"]);
  });

  test("killTree falls back to the process alone when the group is gone", () => {
    const calls: number[] = [];
    killTree(7, "linux", {
      kill: (pid) => {
        calls.push(pid);
        if (pid < 0) {
          throw new Error("ESRCH");
        }
      },
      spawnSync: () => ({ status: 0 }),
    });
    expect(calls).toEqual([-7, 7]);
  });

  test("the real kill dependencies end a real process", async () => {
    const child = Bun.spawn([process.execPath, "-e", "setInterval(()=>{},1000)"]);
    killTree(child.pid, "win32", {
      kill: () => {},
      spawnSync: () => ({ status: 0 }),
    });
    killTree(child.pid, "linux", {
      kill: (pid, signal) => process.kill(pid, signal),
      spawnSync: () => ({ status: 0 }),
    });
    await child.exited;
    expect(child.killed || child.exitCode !== 0 || child.signalCode !== null).toBe(true);
  });
});

describe("probeEnvironment", () => {
  test("isolates the profile and forces a welcome window", () => {
    const base = { ELECTRON_RUN_AS_NODE: "1", JSONSX_PROJECT_ROOT: "/p", PATH: "/bin" };
    const posix = probeEnvironment(base, "/t", "linux");
    expect(posix).toMatchObject({
      HOME: "/t",
      JX_STUDIO_BOOT_PROBE: join("/t", "boot-report.json"),
      PATH: "/bin",
      XDG_CONFIG_HOME: join("/t", "config"),
    });
    expect("JSONSX_PROJECT_ROOT" in posix).toBe(false);
    expect("ELECTRON_RUN_AS_NODE" in posix).toBe(false);
    expect("APPDATA" in posix).toBe(false);
    const win = probeEnvironment(base, "/t", "win32");
    expect(win.APPDATA).toBe(join("/t", "AppData", "Roaming"));
    expect(win.LOCALAPPDATA).toBe(join("/t", "AppData", "Local"));
    // The caller's environment is not touched.
    expect(base.JSONSX_PROJECT_ROOT).toBe("/p");
  });
});

describe("runBootProbe", () => {
  const settledReport = JSON.stringify({
    firstRequestMs: 1,
    launcher: "electron",
    requests: ["githubToken", "getSettings"],
    settled: true,
    settledMs: 5,
  });

  /** A launch whose child runs `script` under Bun, with the report path as its argument. */
  function launch(
    name: string,
    script: string,
    extra: Partial<Parameters<typeof runBootProbe>[0]> = {},
  ) {
    const reportPath = join(scratch, `${name}.json`);
    return {
      reportPath,
      run: () =>
        runBootProbe({
          command: [process.execPath, "-e", script, reportPath],
          env: process.env,
          reportPath,
          timeoutMs: 20_000,
          ...extra,
        }),
    };
  }

  test("passes a launcher that settles", async () => {
    const { run } = launch(
      "pass",
      `require("fs").writeFileSync(process.argv[1], ${JSON.stringify(settledReport)}); console.log("hello")`,
    );
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.log).toContain("hello");
  });

  test("kills a launcher that never settles and judges its partial report", async () => {
    const partial = JSON.stringify({
      firstRequestMs: 1,
      launcher: "electron",
      requests: ["githubToken"],
      settled: false,
      settledMs: null,
    });
    const shots: string[] = [];
    const { run } = launch(
      "hang",
      `require("fs").writeFileSync(process.argv[1], ${JSON.stringify(partial)}); setInterval(() => {}, 1000)`,
      {
        screenshot: (file) => shots.push(file),
        screenshotPath: join(scratch, "hang.png"),
        timeoutMs: 1500,
      },
    );
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.summary).toContain("githubToken");
    expect(result.summary).toContain("timed out");
    expect(shots).toEqual([join(scratch, "hang.png")]);
  });

  test("fails a launcher that exits without a report", async () => {
    const { run } = launch("silent", `console.log("bye")`);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.summary).toContain("never started a probe");
  });

  test("a torn report reads as none", async () => {
    const { run } = launch("torn", `require("fs").writeFileSync(process.argv[1], "{")`);
    const result = await run();
    expect(result.report).toBeNull();
  });

  test("a failed screenshot is logged, not fatal", async () => {
    const logPath = join(scratch, "shot.log");
    const { run } = launch("shot", `setInterval(() => {}, 1000)`, {
      logPath,
      screenshot: () => {
        throw new Error("no display");
      },
      screenshotPath: join(scratch, "shot.png"),
      timeoutMs: 1000,
    });
    const result = await run();
    expect(result.timedOut).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain("screenshot failed: Error: no display");
  });

  test("a command that cannot start is logged and judged", async () => {
    const reportPath = join(scratch, "missing.json");
    const result = await runBootProbe({
      command: [join(scratch, "does-not-exist")],
      env: process.env,
      reportPath,
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
    expect(result.log).toContain("spawn failed");
  });
});
