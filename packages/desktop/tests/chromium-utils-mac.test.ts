import { describe, expect, mock, test } from "bun:test";
import {
  chooseViaAppleScript,
  openDirectoryDialog,
  openFileDialog,
  runOsascript,
} from "../src/chromium/utils";
import type { RunAppleScript } from "../src/chromium/utils";

/** A runner that answers once and records the script it was given. */
function runner(stdout: string, exitCode = 0): RunAppleScript & ReturnType<typeof mock> {
  return mock((_script: string) => Promise.resolve({ exitCode, stdout }));
}

describe("chooseViaAppleScript", () => {
  test("a file pick asks for JSON and resolves the POSIX path", async () => {
    const run = runner("/Users/me/site/project.json\n");
    const picked = await chooseViaAppleScript({ directory: false, title: "Open it" }, run);
    expect(picked).toBe("/Users/me/site/project.json");
    expect(run).toHaveBeenCalledWith(
      'POSIX path of (choose file with prompt "Open it" of type {"public.json"})',
    );
  });

  test("a folder pick drops the trailing slash AppleScript adds", async () => {
    const run = runner("/Users/me/Sites/\n");
    expect(await chooseViaAppleScript({ directory: true, title: "Where" }, run)).toBe(
      "/Users/me/Sites",
    );
    expect(run).toHaveBeenCalledWith('POSIX path of (choose folder with prompt "Where")');
  });

  test("the volume root stays a path", async () => {
    expect(await chooseViaAppleScript({ directory: true, title: "t" }, runner("/\n"))).toBe("/");
  });

  test("cancel (osascript's -128, a non-zero exit) is null", async () => {
    expect(await chooseViaAppleScript({ directory: false, title: "t" }, runner("", 1))).toBeNull();
  });

  test("an empty answer is null", async () => {
    expect(await chooseViaAppleScript({ directory: false, title: "t" }, runner("\n"))).toBeNull();
  });
});

describe("the launcher's pickers on macOS", () => {
  test("openFileDialog uses the open panel, not the portal", async () => {
    const run = runner("/p/project.json\n");
    expect(await openFileDialog(undefined, "darwin", run)).toBe("/p/project.json");
    expect(String(run.mock.calls[0]?.[0])).toContain("choose file");
  });

  test("openDirectoryDialog uses the folder panel", async () => {
    const run = runner("/p/\n");
    expect(await openDirectoryDialog("darwin", run)).toBe("/p");
    expect(String(run.mock.calls[0]?.[0])).toContain("choose folder");
  });
});

describe("runOsascript", () => {
  // Bun stands in for osascript, which only macOS has: its `-e` runs a script too.
  test("passes the script as -e and resolves stdout", async () => {
    expect(await runOsascript("console.log('/picked')", process.execPath)).toEqual({
      exitCode: 0,
      stdout: "/picked\n",
    });
  });

  test("resolves a failing script's exit code rather than throwing", async () => {
    const { exitCode } = await runOsascript("process.exit(1)", process.execPath);
    expect(exitCode).toBe(1);
  });
});
